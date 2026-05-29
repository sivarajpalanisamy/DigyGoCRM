import { query } from '../db';
import { decrypt } from './crypto';

/**
 * POST a newly created CRM lead to the tenant's configured Superfone lead-push endpoint.
 * Fire-and-forget: never throws, silently skips if not configured or endpoint missing.
 */
export async function pushLeadToSuperfone(
  tenantId: string,
  lead: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    source?: string | null;
    notes?: string | null;
  }
): Promise<void> {
  try {
    const result = await query(
      `SELECT api_key_enc, superfone_endpoint_url
       FROM superfone_settings
       WHERE tenant_id=$1::uuid AND is_connected=TRUE AND superfone_endpoint_url IS NOT NULL`,
      [tenantId]
    );
    if (!result.rows[0]) return;

    const { api_key_enc, superfone_endpoint_url } = result.rows[0] as {
      api_key_enc: string | null;
      superfone_endpoint_url: string;
    };

    const parts = (lead.name ?? '').trim().split(/\s+/);
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');

    const body = JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      email: lead.email ? [lead.email] : [],
      phones: lead.phone ? [lead.phone] : [],
      additional_info: lead.notes ?? '',
      source: lead.source ?? 'CRM',
      source_type: 'CRM',
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (api_key_enc) {
      try { headers['x-api-key'] = decrypt(api_key_enc); } catch { /* ignore bad key */ }
    }

    const resp = await fetch(superfone_endpoint_url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      console.error(`[superfone push] HTTP ${resp.status} — ${superfone_endpoint_url}`);
    }
  } catch (err: any) {
    console.error('[superfone push]', err.message);
  }
}
