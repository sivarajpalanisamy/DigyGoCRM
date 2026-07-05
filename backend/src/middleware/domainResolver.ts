import { Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { getCachedTenantId, setCachedTenantId } from '../utils/domainCache';

export async function resolveDomain(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const hostname = req.hostname;

  // Fast exit for main domain and local dev — zero DB hit, zero latency
  if (
    !hostname ||
    hostname === 'app.hawcus.com' ||
    hostname === 'crm.digygo.in' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local')
  ) {
    return next();
  }

  // Cache hit — instant, no DB
  const cached = getCachedTenantId(hostname);
  if (cached) {
    (req as any).resolvedCustomDomain = hostname;
    (req as any).resolvedTenantIdFromDomain = cached;
    return next();
  }

  // Cache miss — query DB once, then cache for 5 min
  try {
    const r = await query(
      "SELECT id FROM tenants WHERE custom_domain=$1 AND domain_status='ssl_active' LIMIT 1",
      [hostname]
    );
    if (r.rows[0]) {
      setCachedTenantId(hostname, r.rows[0].id);
      (req as any).resolvedCustomDomain = hostname;
      (req as any).resolvedTenantIdFromDomain = r.rows[0].id;
    }
  } catch {
    // Non-fatal — continue without domain resolution
  }

  next();
}
