import { Response, NextFunction } from 'express';
import { query } from '../db';
import { AuthRequest } from './auth';
import { publish, subscribe } from '../lib/redis';

// DigyGo platform super_admin bypasses all permission checks via JWT role.
// Business owners (role='owner') also bypass — role is in the JWT, no DB lookup needed.
// All other users resolve against user_permissions table only (no role fallback).
const SUPER_ROLES = new Set(['super_admin', 'owner']);

// Cache key includes tenantId to prevent cross-tenant bleed during impersonation.
// Format: `${tenantId ?? 'null'}:${userId}:${permKey}`
const permCache = new Map<string, { allowed: boolean; ts: number }>();
const CACHE_TTL_MS = 60_000;

function makeCacheKey(tenantId: string | null | undefined, userId: string, permKey: string): string {
  return `${tenantId ?? 'null'}:${userId}:${permKey}`;
}

export function checkPermission(permKey: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user!;

    if (SUPER_ROLES.has(user.role)) { next(); return; }

    const cacheKey = makeCacheKey(user.tenantId, user.userId, permKey);
    const cached = permCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      if (cached.allowed) { next(); return; }
      res.status(403).json({ error: 'Forbidden', required: permKey });
      return;
    }

    try {
      const allowed = await resolvePermission(user.userId, permKey, user.tenantId);
      permCache.set(cacheKey, { allowed, ts: Date.now() });
      if (allowed) { next(); return; }
      res.status(403).json({ error: 'Forbidden', required: permKey });
    } catch {
      res.status(500).json({ error: 'Server error checking permissions' });
    }
  };
}

// Route guard that passes if the user has ANY of the given permission keys.
// Used for granular splits with backward compatibility (e.g. a master key OR a
// specific sub-key both grant access).
export function checkAnyPermission(...permKeys: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user!;
    if (SUPER_ROLES.has(user.role)) { next(); return; }
    try {
      for (const permKey of permKeys) {
        const cacheKey = makeCacheKey(user.tenantId, user.userId, permKey);
        const cached = permCache.get(cacheKey);
        let allowed: boolean;
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
          allowed = cached.allowed;
        } else {
          allowed = await resolvePermission(user.userId, permKey, user.tenantId);
          permCache.set(cacheKey, { allowed, ts: Date.now() });
        }
        if (allowed) { next(); return; }
      }
      res.status(403).json({ error: 'Forbidden', required: permKeys.join(' | ') });
    } catch {
      res.status(500).json({ error: 'Server error checking permissions' });
    }
  };
}

// Resolves whether userId has permKey, scoped to tenantId when provided.
// owner/super_admin are already bypassed in checkPermission() before this is called.
async function resolvePermission(userId: string, permKey: string, tenantId?: string | null): Promise<boolean> {
  const result = await query(
    `SELECT (up.permissions->>$2)::boolean AS user_allowed
     FROM users u
     LEFT JOIN user_permissions up ON up.user_id = u.id
     WHERE u.id = $1 AND ($3::uuid IS NULL OR u.tenant_id = $3::uuid)
     LIMIT 1`,
    [userId, permKey, tenantId ?? null]
  );
  const row = result.rows[0];
  if (!row) return false;
  return row.user_allowed === true;
}

// For use inside route handlers (data-level filtering, not route guards).
// Always pass tenantId from req.user so the cache key is properly scoped.
export async function hasPermission(
  userId: string,
  permKey: string,
  tenantId?: string | null,
): Promise<boolean> {
  const cacheKey = makeCacheKey(tenantId, userId, permKey);
  const cached = permCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.allowed;

  const allowed = await resolvePermission(userId, permKey, tenantId);
  permCache.set(cacheKey, { allowed, ts: Date.now() });
  return allowed;
}

// Invalidate all cached entries for a specific user (+ optionally tenant-scoped).
// Call after updating user_permissions.
// Local-only L1 eviction (no broadcast). Used by both the public invalidator and
// the pub/sub handler that applies invalidations from other instances.
function clearUserPermCacheLocal(userId: string, tenantId?: string | null): void {
  const tenantPrefix = tenantId !== undefined
    ? `${tenantId ?? 'null'}:${userId}:`
    : null;

  for (const key of permCache.keys()) {
    const matches = tenantPrefix
      ? key.startsWith(tenantPrefix)
      : key.includes(`:${userId}:`);
    if (matches) permCache.delete(key);
  }
}

export function clearUserPermCache(userId: string, tenantId?: string | null): void {
  clearUserPermCacheLocal(userId, tenantId);
  // Broadcast so every instance drops its L1 entry (no-op when Redis disabled).
  publish('cache:perm', JSON.stringify(tenantId === undefined ? { userId } : { userId, tenantId }));
}

// Apply invalidations published by other instances. Idempotent — receiving our
// own message just re-clears already-cleared keys.
subscribe('cache:perm', (msg) => {
  try { const d = JSON.parse(msg); clearUserPermCacheLocal(d.userId, 'tenantId' in d ? d.tenantId : undefined); } catch {}
});
