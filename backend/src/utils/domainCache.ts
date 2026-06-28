import { publish, subscribe } from '../lib/redis';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface BrandingData {
  tenantId: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
  replyToEmail: string | null;
  cachedAt: number;
}

const domainToTenantId = new Map<string, { id: string; cachedAt: number }>();
const domainToBranding = new Map<string, BrandingData>();

export function getCachedTenantId(domain: string): string | null {
  const entry = domainToTenantId.get(domain);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    domainToTenantId.delete(domain);
    return null;
  }
  return entry.id;
}

export function getCachedBranding(domain: string): BrandingData | null {
  const entry = domainToBranding.get(domain);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    domainToBranding.delete(domain);
    return null;
  }
  return entry;
}

export function setCachedDomain(domain: string, tenantId: string, branding: BrandingData): void {
  domainToTenantId.set(domain, { id: tenantId, cachedAt: Date.now() });
  domainToBranding.set(domain, { ...branding, cachedAt: Date.now() });
}

export function setCachedTenantId(domain: string, tenantId: string): void {
  domainToTenantId.set(domain, { id: tenantId, cachedAt: Date.now() });
}

function invalidateDomainCacheLocal(domain: string): void {
  domainToTenantId.delete(domain);
  domainToBranding.delete(domain);
}

export function invalidateDomainCache(domain: string): void {
  invalidateDomainCacheLocal(domain);
  publish('cache:domain', domain); // broadcast to other instances (no-op without Redis)
}

// Apply domain invalidations from other instances (idempotent).
subscribe('cache:domain', (domain) => invalidateDomainCacheLocal(domain));

// NOTE: L1 lives in-memory per instance; invalidations are broadcast over Redis
// pub/sub so multiple PM2 workers / instances stay in sync. Without REDIS_URL it
// behaves exactly like the old single-process cache.
