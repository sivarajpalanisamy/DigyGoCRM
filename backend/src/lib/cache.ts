import { getRedis, isRedisHealthy } from './redis';

/**
 * Cache facade used across the app. Backed by Redis when healthy, otherwise a
 * bounded in-memory Map with TTL — so a missing/blipping Redis degrades to the
 * previous single-process behavior instead of failing requests.
 *
 * Everything here swallows Redis errors and falls back; callers never need a
 * try/catch around cache ops.
 */

interface MemEntry { v: string; exp: number }
const mem = new Map<string, MemEntry>();
const MEM_MAX = 5000; // hard cap so the fallback can't grow unbounded

function memGet(key: string): string | null {
  const e = mem.get(key);
  if (!e) return null;
  if (e.exp < Date.now()) { mem.delete(key); return null; }
  return e.v;
}
function memSet(key: string, v: string, ttlSec: number): void {
  if (mem.size >= MEM_MAX) {
    for (const [k, e] of mem) if (e.exp < Date.now()) mem.delete(k); // sweep expired
    if (mem.size >= MEM_MAX) { const oldest = mem.keys().next().value; if (oldest) mem.delete(oldest); }
  }
  mem.set(key, { v, exp: Date.now() + ttlSec * 1000 });
}

// ── Raw string get/set/del ───────────────────────────────────────────────────
export async function cacheGetRaw(key: string): Promise<string | null> {
  if (isRedisHealthy()) {
    try { return await getRedis()!.get(key); } catch { /* fall through */ }
  }
  return memGet(key);
}

export async function cacheSetRaw(key: string, val: string, ttlSec: number): Promise<void> {
  if (isRedisHealthy()) {
    try { await getRedis()!.set(key, val, 'EX', ttlSec); return; } catch { /* fall through */ }
  }
  memSet(key, val, ttlSec);
}

export async function cacheDel(key: string): Promise<void> {
  mem.delete(key);
  if (isRedisHealthy()) { try { await getRedis()!.del(key); } catch {} }
}

// ── JSON get/set + get-or-compute ────────────────────────────────────────────
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await cacheGetRaw(key);
  if (raw == null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function cacheSet<T>(key: string, val: T, ttlSec: number): Promise<void> {
  await cacheSetRaw(key, JSON.stringify(val), ttlSec);
}

/** Get-or-compute. Caches only non-null results (so transient empties aren't pinned). */
export async function cacheJson<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const fresh = await fn();
  if (fresh !== null && fresh !== undefined) await cacheSet(key, fresh, ttlSec);
  return fresh;
}

// ── Tenant-scoped versioning (bust all of a tenant's report caches at once) ───
// Report cache keys embed this version; bumping it makes every prior key a miss
// (the old entries then expire on their own TTL). One cheap INCR per write event.
export async function tenantCacheVersion(tenantId: string): Promise<number> {
  const key = `cachever:${tenantId}`;
  const raw = await cacheGetRaw(key);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

export async function bumpTenantCacheVersion(tenantId: string): Promise<void> {
  const key = `cachever:${tenantId}`;
  if (isRedisHealthy()) {
    try { await getRedis()!.incr(key); await getRedis()!.expire(key, 86400); return; } catch {}
  }
  const cur = memGet(key);
  memSet(key, String((cur ? parseInt(cur, 10) || 0 : 0) + 1), 86400);
}

/** Stable hash for query-param objects → part of a cache key. */
export function paramsHash(obj: Record<string, unknown>): string {
  const norm = Object.keys(obj).sort().map((k) => `${k}=${obj[k] ?? ''}`).join('&');
  let h = 0;
  for (let i = 0; i < norm.length; i++) { h = (h * 31 + norm.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}
