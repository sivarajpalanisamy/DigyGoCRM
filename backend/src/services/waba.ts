// ── WhatsApp Business (Cloud API) service ───────────────────────────────────────
// Centralised credential resolution + send helpers for the official Meta WABA API.
//
// Credentials are resolved in this order:
//   1. The tenant's own row in `waba_integrations` (token stored encrypted)
//   2. A global account configured via environment variables (WABA_* in .env)
//
// The env fallback lets a single-business deployment send WhatsApp without each
// tenant pasting credentials in the UI — set WABA_PHONE_NUMBER_ID / WABA_ID /
// WABA_ACCESS_TOKEN in backend/.env and every tenant without its own row uses it.

import https from 'https';
import { query } from '../db';
import { decrypt } from '../utils/crypto';

const API_VERSION = process.env.META_API_VERSION || 'v21.0';

export interface WabaCreds {
  phoneNumberId: string;
  token: string;
  phoneNumber: string;
  wabaId: string;
  source: 'db' | 'env';
}

/** Read the global WABA account from environment variables (if fully configured). */
export function getEnvWabaCreds(): WabaCreds | null {
  const phoneNumberId = process.env.WABA_PHONE_NUMBER_ID?.trim();
  const token = process.env.WABA_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !token) return null;
  return {
    phoneNumberId,
    token,
    phoneNumber: process.env.WABA_PHONE_NUMBER?.trim() || '',
    wabaId: process.env.WABA_ID?.trim() || '',
    source: 'env',
  };
}

/** Resolve sendable WABA credentials for a tenant: DB row first, env fallback. */
export async function getWabaCreds(tenantId: string): Promise<WabaCreds | null> {
  const res = await query(
    `SELECT phone_number, phone_number_id, waba_id, access_token
     FROM waba_integrations WHERE tenant_id=$1 AND is_active=TRUE LIMIT 1`,
    [tenantId],
  ).catch(() => null);
  const row = res?.rows?.[0];
  if (row?.phone_number_id && row?.access_token) {
    let token = '';
    try { token = decrypt(row.access_token); } catch { token = ''; }
    if (token) {
      return {
        phoneNumberId: row.phone_number_id,
        token,
        phoneNumber: row.phone_number || '',
        wabaId: row.waba_id || '',
        source: 'db',
      };
    }
  }
  return getEnvWabaCreds();
}

function graphPostMessage(phoneNumberId: string, token: string, payload: object): Promise<any> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/${API_VERSION}/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from WhatsApp API')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Send a free-form text message (only delivers inside the 24h customer-service window). */
export function sendWAText(phoneNumberId: string, token: string, toPhone: string, text: string): Promise<any> {
  return graphPostMessage(phoneNumberId, token, {
    messaging_product: 'whatsapp',
    to: toPhone.replace(/\D/g, ''),
    type: 'text',
    text: { body: text },
  });
}

/**
 * Send a pre-approved template message. This is the path required for
 * business-initiated messages (e.g. messaging a brand-new lead from an ad).
 * `bodyParams` fill the template's {{1}}, {{2}}… placeholders in order.
 */
export function sendWATemplate(
  phoneNumberId: string,
  token: string,
  toPhone: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[] = [],
): Promise<any> {
  const template: any = {
    name: templateName,
    language: { code: languageCode || 'en_US' },
  };
  if (bodyParams.length > 0) {
    template.components = [{
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text: String(text ?? '') })),
    }];
  }
  return graphPostMessage(phoneNumberId, token, {
    messaging_product: 'whatsapp',
    to: toPhone.replace(/\D/g, ''),
    type: 'template',
    template,
  });
}

/**
 * Send a WhatsApp AUTHENTICATION template carrying a one-time code. Meta's
 * authentication templates require the code BOTH in the body and on the copy-code /
 * autofill button, so we pass it twice. This is the path needed to OTP a brand-new
 * number (free-form text only delivers inside the 24h customer-service window).
 */
export function sendWAAuthTemplate(
  phoneNumberId: string,
  token: string,
  toPhone: string,
  templateName: string,
  languageCode: string,
  code: string,
  withButton = true,
): Promise<any> {
  const components: any[] = [
    { type: 'body', parameters: [{ type: 'text', text: String(code) }] },
  ];
  if (withButton) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: String(code) }],
    });
  }
  return graphPostMessage(phoneNumberId, token, {
    messaging_product: 'whatsapp',
    to: toPhone.replace(/\D/g, ''),
    type: 'template',
    template: { name: templateName, language: { code: languageCode || 'en_US' }, components },
  });
}

/**
 * High-level OTP delivery over WhatsApp for a tenant. Resolves the tenant's WABA
 * credentials (DB row → env fallback) and sends the code.
 *
 * Uses the approved authentication template named by WABA_OTP_TEMPLATE when set
 * (the only way to reach a number outside the 24h window); otherwise falls back to
 * a free-form text message (useful for testing within an open conversation).
 * Returns a result object instead of throwing so the caller can degrade gracefully.
 */
export async function sendOtpViaWhatsApp(
  tenantId: string,
  toPhone: string,
  code: string,
): Promise<{ sent: boolean; error?: string }> {
  const creds = await getWabaCreds(tenantId);
  if (!creds) return { sent: false, error: 'WhatsApp (WABA) is not configured' };

  const template = process.env.WABA_OTP_TEMPLATE?.trim();
  const lang = process.env.WABA_OTP_TEMPLATE_LANG?.trim() || 'en_US';
  const withButton = (process.env.WABA_OTP_TEMPLATE_HAS_BUTTON ?? 'true').toLowerCase() !== 'false';

  try {
    let resp: any;
    if (template) {
      resp = await sendWAAuthTemplate(creds.phoneNumberId, creds.token, toPhone, template, lang, code, withButton);
    } else {
      resp = await sendWAText(
        creds.phoneNumberId, creds.token, toPhone,
        `Your Hawcus verification code is ${code}. It expires in 10 minutes.`,
      );
    }
    if (resp?.error) {
      return { sent: false, error: resp.error?.message || JSON.stringify(resp.error) };
    }
    const ok = Array.isArray(resp?.messages) && resp.messages.length > 0;
    return ok ? { sent: true } : { sent: false, error: 'WhatsApp API did not confirm delivery' };
  } catch (e: any) {
    return { sent: false, error: e?.message || 'WhatsApp send failed' };
  }
}

/** Fetch message templates from Meta for a WABA account (all statuses). */
export function listWATemplates(wabaId: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates?limit=200&access_token=${encodeURIComponent(token)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from WhatsApp API')); }
      });
    }).on('error', reject);
  });
}

/** Pull the BODY component text out of a Meta template definition. */
export function templateBodyText(tpl: any): string {
  const comp = (tpl?.components ?? []).find((c: any) => c.type === 'BODY');
  return comp?.text ?? '';
}

/** Count the highest {{n}} placeholder in a template body (= number of params to supply). */
export function templateBodyParamCount(tpl: any): number {
  const matches = templateBodyText(tpl).match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  const indices = matches.map((m) => parseInt(m.replace(/[^\d]/g, ''), 10));
  return indices.length ? Math.max(...indices) : 0;
}
