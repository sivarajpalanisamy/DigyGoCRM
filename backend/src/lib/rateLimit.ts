import rateLimit, { Options, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis, redisEnabled } from './redis';

// Real client IP = leftmost X-Forwarded-For entry (what the browser actually is),
// NOT req.ip — behind Traefik→nginx (2 proxy hops, trust proxy=1) req.ip resolves
// to the proxy's internal address, which would bucket ALL users together. Mirrors
// middleware/ipBlock.ts clientIp(). Inlined here to avoid a cross-module import at
// boot. ipKeyGenerator normalizes IPv6 (required by express-rate-limit v8).
function realClientIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const xf = (req.headers['x-forwarded-for'] as string) || '';
  const first = xf.split(',')[0].trim();
  return first || req.ip || 'unknown';
}

/**
 * Build a rate limiter. When Redis is configured the counters live in Redis, so
 * limits hold across multiple backend instances and survive restarts; otherwise
 * it falls back to express-rate-limit's in-memory store (single process).
 *
 * `name` gives each limiter a DISTINCT Redis key namespace (`rl:<name>:`). This is
 * mandatory with a shared Redis store: without it every limiter shares `rl:<ip>`,
 * so the global limiter's per-request count trips the stricter auth cap → a 429
 * storm on login. (In-memory stores are per-limiter, so this only bit once Redis
 * was enabled.)
 *
 * `passOnStoreError: true` is critical on a live app: if Redis blips, requests
 * are allowed through (fail-open) instead of every user being locked out.
 */
export function makeLimiter(name: string, opts: Partial<Options>) {
  const base: Partial<Options> = {
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    keyGenerator: (req) => ipKeyGenerator(realClientIp(req)),
    ...opts,
  };

  if (redisEnabled) {
    const client = getRedis();
    if (client) {
      base.store = new RedisStore({
        prefix: `rl:${name}:`,
        // ioredis: forward the raw command. rate-limit-redis sends RESP args.
        sendCommand: (...args: string[]) => (client as any).call(...args),
      });
    }
  }

  return rateLimit(base);
}
