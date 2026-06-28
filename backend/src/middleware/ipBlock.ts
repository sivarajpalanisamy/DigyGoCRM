import { Request, Response, NextFunction } from 'express';
import { getRedis, isRedisHealthy } from '../lib/redis';
import { cacheGetRaw, cacheSetRaw, cacheDel } from '../lib/cache';

/**
 * Lightweight IP blocking + auto-block on abuse.
 *
 * - A blocked IP (Redis key `blocked:ip:<ip>` = "1", or in-memory fallback) is
 *   rejected with 403 before it reaches any route.
 * - Every response with status 401 (failed auth) or 429 (rate-limited) is a
 *   "strike". STRIKE_LIMIT strikes within STRIKE_WINDOW auto-blocks the IP for
 *   BLOCK_TTL. Thresholds are deliberately high so a normal user's occasional
 *   401-then-refresh never trips it.
 * - Super admins can block/unblock manually via the exported helpers.
 *
 * Backed by Redis (cross-instance) when available; degrades to in-memory.
 */

const BLOCK_TTL = 60 * 60;      // blocked for 1 hour
const STRIKE_WINDOW = 10 * 60;  // strikes counted over 10 minutes
const STRIKE_LIMIT = 50;        // 50 abusive responses in the window → block

// In-memory fallback strike counter (used only when Redis is down/disabled).
const memStrikes = new Map<string, { n: number; exp: number }>();

export function clientIp(req: Request): string {
  const xf = (req.headers['x-forwarded-for'] as string) || '';
  const first = xf.split(',')[0].trim();
  return first || req.ip || req.socket?.remoteAddress || 'unknown';
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  return (await cacheGetRaw(`blocked:ip:${ip}`)) === '1';
}

export async function blockIp(ip: string, ttlSec = BLOCK_TTL): Promise<void> {
  await cacheSetRaw(`blocked:ip:${ip}`, '1', ttlSec);
  console.warn(`[ipBlock] blocked ${ip} for ${ttlSec}s`);
}

export async function unblockIp(ip: string): Promise<void> {
  await cacheDel(`blocked:ip:${ip}`);
}

/** List currently-blocked IPs (Redis SCAN). Returns [] when Redis is disabled. */
export async function listBlockedIps(): Promise<string[]> {
  if (!isRedisHealthy()) return [];
  try {
    const r = getRedis()!;
    const out: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await r.scan(cursor, 'MATCH', 'blocked:ip:*', 'COUNT', 200);
      cursor = next;
      for (const k of keys) out.push(k.replace(/^blocked:ip:/, ''));
    } while (cursor !== '0');
    return out;
  } catch { return []; }
}

async function recordStrike(ip: string): Promise<void> {
  if (isRedisHealthy()) {
    try {
      const r = getRedis()!;
      const key = `strikes:${ip}`;
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, STRIKE_WINDOW);
      if (n >= STRIKE_LIMIT) await blockIp(ip);
      return;
    } catch { /* fall through to memory */ }
  }
  const now = Date.now();
  const cur = memStrikes.get(ip);
  if (!cur || cur.exp < now) { memStrikes.set(ip, { n: 1, exp: now + STRIKE_WINDOW * 1000 }); return; }
  cur.n += 1;
  if (cur.n >= STRIKE_LIMIT) { void blockIp(ip); memStrikes.delete(ip); }
}

export async function ipBlockGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.path === '/health') { next(); return; }
  const ip = clientIp(req);
  (req as any).clientIp = ip;

  if (await isIpBlocked(ip)) {
    res.status(403).json({ error: 'Your IP has been temporarily blocked due to suspicious activity.' });
    return;
  }

  // Count abusive responses after they're sent (non-blocking).
  res.on('finish', () => {
    if (res.statusCode === 401 || res.statusCode === 429) void recordStrike(ip);
  });

  next();
}
