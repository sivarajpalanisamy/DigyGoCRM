import rateLimit, { Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis, redisEnabled } from './redis';

/**
 * Build a rate limiter. When Redis is configured the counters live in Redis, so
 * limits hold across multiple backend instances and survive restarts; otherwise
 * it falls back to express-rate-limit's in-memory store (single process).
 *
 * `passOnStoreError: true` is critical on a live app: if Redis blips, requests
 * are allowed through (fail-open) instead of every user being locked out.
 */
export function makeLimiter(opts: Partial<Options>) {
  const base: Partial<Options> = {
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    ...opts,
  };

  if (redisEnabled) {
    const client = getRedis();
    if (client) {
      base.store = new RedisStore({
        prefix: 'rl:',
        // ioredis: forward the raw command. rate-limit-redis sends RESP args.
        sendCommand: (...args: string[]) => (client as any).call(...args),
      });
    }
  }

  return rateLimit(base);
}
