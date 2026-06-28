import Redis from 'ioredis';
import { config } from '../config';

/**
 * Resilient shared Redis client.
 *
 * Design goals for a LIVE single-VPS app moving toward horizontal scaling:
 *  - If REDIS_URL is unset, Redis is simply disabled (callers fall back to
 *    in-memory). No connection attempts, no noise.
 *  - If Redis is configured but down/blips, the app NEVER hard-fails: every
 *    helper swallows errors and the cache/limiter layer degrades to in-memory.
 *  - One client for commands, plus a lazily-created second client for pub/sub
 *    (a subscribed connection can't run normal commands).
 */

let client: Redis | null = null;
let subscriber: Redis | null = null;
let publisher: Redis | null = null;
let healthy = false;

export const redisEnabled = !!config.redisUrl;

function build(label: string): Redis {
  const r = new Redis(config.redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    // Buffer commands issued before the socket is ready (e.g. rate-limit-redis's
    // SCRIPT LOAD at boot, pub/sub subscribes) so they run once connected instead
    // of throwing. Down-state is handled by try/catch + isRedisHealthy +
    // passOnStoreError, so this never wedges the app.
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  r.on('ready', () => { if (label === 'main') healthy = true; console.log(`[redis:${label}] ready`); });
  r.on('error', (e) => { if (label === 'main') healthy = false; /* avoid log spam */ if ((e as any)?.code !== 'ECONNREFUSED') console.warn(`[redis:${label}]`, e.message); });
  r.on('end', () => { if (label === 'main') healthy = false; });
  return r;
}

export function getRedis(): Redis | null {
  if (!redisEnabled) return null;
  if (!client) client = build('main');
  return client;
}

/** True only when Redis is configured AND currently connected. */
export function isRedisHealthy(): boolean {
  return redisEnabled && healthy;
}

/** Dedicated publisher connection (pub/sub). */
export function getPublisher(): Redis | null {
  if (!redisEnabled) return null;
  if (!publisher) publisher = build('pub');
  return publisher;
}

/**
 * Subscribe to a channel. Returns a cleanup fn. No-op (returns null) when Redis
 * is disabled. Errors are swallowed so a subscribe failure never crashes boot.
 */
export function subscribe(channel: string, handler: (message: string) => void): (() => void) | null {
  if (!redisEnabled) return null;
  if (!subscriber) subscriber = build('sub');
  const sub = subscriber;
  sub.subscribe(channel).catch((e) => console.warn('[redis:sub] subscribe failed', e.message));
  const listener = (ch: string, msg: string) => { if (ch === channel) { try { handler(msg); } catch {} } };
  sub.on('message', listener);
  return () => { sub.off('message', listener); sub.unsubscribe(channel).catch(() => {}); };
}

/** Fire-and-forget publish. Safe when Redis is disabled/down. */
export function publish(channel: string, message: string): void {
  const p = getPublisher();
  if (!p) return;
  p.publish(channel, message).catch(() => {});
}
