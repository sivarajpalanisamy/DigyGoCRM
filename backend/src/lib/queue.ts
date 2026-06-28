import { Queue, Worker, Job, JobsOptions, Processor, ConnectionOptions } from 'bullmq';
import { config } from '../config';
import { redisEnabled } from './redis';

/**
 * BullMQ job queues with a graceful no-Redis fallback.
 *
 * BullMQ HARD-requires Redis (no in-memory mode). To keep the app working
 * without Redis, every queue is optional: when REDIS_URL is set we run a real
 * BullMQ Queue + Worker (durable, retried, dead-lettered); when it's not, the
 * processor runs INLINE at enqueue time, preserving the previous behavior
 * (the work still happens, just without durable retry).
 *
 * Producers stay thin — they call enqueue(name, data) and never know which mode
 * is active.
 */

// Build BullMQ connection OPTIONS from REDIS_URL and let BullMQ manage its own
// ioredis (bullmq bundles its own copy — sharing an instance trips a dual-package
// type/instanceof mismatch). maxRetriesPerRequest:null is required by BullMQ.
let connOpts: ConnectionOptions | null | undefined;
function getConnection(): ConnectionOptions | null {
  if (!redisEnabled) return null;
  if (connOpts === undefined) {
    try {
      const u = new URL(config.redisUrl);
      connOpts = {
        host: u.hostname,
        port: u.port ? parseInt(u.port, 10) : 6379,
        username: u.username || undefined,
        password: u.password || undefined,
        db: u.pathname && u.pathname.length > 1 ? parseInt(u.pathname.slice(1), 10) || 0 : 0,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
      } as ConnectionOptions;
    } catch (e: any) {
      console.warn('[queue] invalid REDIS_URL, queues disabled:', e?.message);
      connOpts = null;
    }
  }
  return connOpts;
}

const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 }, // 5s, 10s, 20s, 40s, 80s
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 5_000 },                 // keep failures for dead-letter inspection
};

interface Registered { queue: Queue | null; worker: Worker | null; processor: Processor }
const registry = new Map<string, Registered>();

/**
 * Register a queue + its worker. With Redis: creates a BullMQ Queue and a Worker
 * bound to `processor`. Without Redis: records the processor only, for inline
 * fallback in enqueue().
 */
export function registerQueue(name: string, processor: Processor, opts?: { concurrency?: number }): void {
  const conn = getConnection();
  if (!conn) { registry.set(name, { queue: null, worker: null, processor }); return; }

  const queue = new Queue(name, { connection: conn, defaultJobOptions: DEFAULT_JOB_OPTS });
  const worker = new Worker(name, processor, { connection: conn, concurrency: opts?.concurrency ?? 5 });
  worker.on('failed', (job, err) =>
    console.warn(`[queue:${name}] job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}):`, err?.message));
  worker.on('error', (err) => { if ((err as any)?.code !== 'ECONNREFUSED') console.warn(`[queue:${name}] worker error`, err.message); });
  registry.set(name, { queue, worker, processor });
  console.log(`[queue:${name}] BullMQ worker started (concurrency ${opts?.concurrency ?? 5})`);
}

export function queueActive(name: string): boolean {
  return !!registry.get(name)?.queue;
}

/**
 * Enqueue a job. Redis on → add to BullMQ (returns immediately, processed by the
 * worker with retry/backoff). Redis off → run the processor inline now. Never
 * throws (failures are logged) so producers can fire-and-forget.
 */
export async function enqueue(name: string, data: unknown, jobOpts?: JobsOptions): Promise<void> {
  const reg = registry.get(name);
  if (!reg) { console.warn(`[queue] enqueue to unregistered queue "${name}"`); return; }
  try {
    if (reg.queue) {
      await reg.queue.add(name, data, jobOpts);
    } else {
      // Inline fallback — minimal Job shape (processors only read job.data here).
      await reg.processor({ data } as Job);
    }
  } catch (e: any) {
    console.warn(`[queue:${name}] enqueue/inline failed:`, e?.message);
  }
}
