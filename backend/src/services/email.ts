import nodemailer from 'nodemailer';
import { config } from '../config';
import { query } from '../db';
import { decrypt } from '../utils/crypto';
import { enqueue } from '../lib/queue';

let _transporter: nodemailer.Transporter | null = null;

// Resolve a tenant's white-label email identity: From-name = company name, Reply-To = their reply_to_email.
// Used so recipients see the client's brand and replies reach the client (not DigyGo).
export async function getTenantEmailIdentity(tenantId: string | null | undefined): Promise<{ fromName?: string; replyTo?: string }> {
  if (!tenantId) return {};
  try {
    const r = await query('SELECT name, reply_to_email FROM tenants WHERE id=$1 LIMIT 1', [tenantId]);
    const t = r.rows[0];
    if (!t) return {};
    return {
      fromName: t.name || undefined,
      replyTo:  t.reply_to_email || undefined,
    };
  } catch { return {}; }
}

// ── Tenant SMTP config from DB ─────────────────────────────────────────────────

interface TenantSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;  // encrypted
  from_email: string;
  from_name?: string;
  encryption?: 'tls' | 'ssl' | 'none';
}

// Cache tenant transporters so we don't create one per email (max 100 tenants cached)
const _tenantTransporters = new Map<string, { transporter: nodemailer.Transporter; ts: number }>();
const TENANT_CACHE_TTL = 10 * 60 * 1000; // 10 min

async function getTenantSmtpConfig(tenantId: string): Promise<TenantSmtpConfig | null> {
  try {
    const r = await query(
      `SELECT config_json FROM integration_configs
       WHERE tenant_id=$1::uuid AND integration_id='smtp' AND is_active=TRUE LIMIT 1`,
      [tenantId]
    );
    const cfg = r.rows[0]?.config_json;
    if (!cfg || !cfg.host || !cfg.user || !cfg.password) return null;
    return cfg as TenantSmtpConfig;
  } catch { return null; }
}

function getTenantTransporter(tenantId: string, cfg: TenantSmtpConfig): nodemailer.Transporter {
  const cached = _tenantTransporters.get(tenantId);
  if (cached && (Date.now() - cached.ts) < TENANT_CACHE_TTL) return cached.transporter;

  // Decrypt password
  let pass: string;
  try { pass = decrypt(cfg.password); } catch { pass = cfg.password; }

  // Determine secure flag from encryption field or legacy secure boolean
  let secure = cfg.secure ?? false;
  let port = cfg.port ?? 587;
  if (cfg.encryption === 'ssl') { secure = true; port = cfg.port ?? 465; }
  else if (cfg.encryption === 'tls') { secure = false; port = cfg.port ?? 587; }
  else if (cfg.encryption === 'none') { secure = false; }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port,
    secure,
    auth: { user: cfg.user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });

  // Evict oldest if cache grows too large
  if (_tenantTransporters.size >= 100) {
    const oldest = [..._tenantTransporters.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _tenantTransporters.delete(oldest[0]);
  }
  _tenantTransporters.set(tenantId, { transporter, ts: Date.now() });
  return transporter;
}

/** Flush cached transporter for a tenant (call after SMTP config changes) */
export function invalidateTenantSmtpCache(tenantId: string) {
  _tenantTransporters.delete(tenantId);
}

// ── Email credits ──────────────────────────────────────────────────────────────

/** Increment emails_sent counter only (no credit deduction). Used when tenant has own SMTP. */
function trackEmailSent(tenantId: string) {
  query(
    'UPDATE tenant_usage SET emails_sent = emails_sent + 1, updated_at = NOW() WHERE tenant_id=$1::uuid',
    [tenantId]
  ).catch(() => {});
}

/** Check and decrement email credits. Returns true if allowed to send. -1 = unlimited. Used only for global SMTP/Resend. */
async function consumeEmailCredit(tenantId: string): Promise<boolean> {
  try {
    const r = await query('SELECT email_credits FROM tenants WHERE id=$1::uuid', [tenantId]);
    const credits = r.rows[0]?.email_credits ?? -1;
    if (credits === -1) {
      // Unlimited — just increment counter
      await query(
        'UPDATE tenant_usage SET emails_sent = emails_sent + 1, updated_at = NOW() WHERE tenant_id=$1::uuid',
        [tenantId]
      );
      return true;
    }
    if (credits <= 0) return false;
    // Atomic decrement
    const upd = await query(
      'UPDATE tenants SET email_credits = email_credits - 1 WHERE id=$1::uuid AND email_credits > 0 RETURNING email_credits',
      [tenantId]
    );
    if (upd.rowCount === 0) return false;
    await query(
      'UPDATE tenant_usage SET emails_sent = emails_sent + 1, updated_at = NOW() WHERE tenant_id=$1::uuid',
      [tenantId]
    );
    return true;
  } catch { return true; } // fail open — don't block sends on counter errors
}

// ── Global SMTP transporter ────────────────────────────────────────────────────

function getTransporter(): nodemailer.Transporter | null {
  if (!config.smtp.host || !config.smtp.user) return null;
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host:   config.smtp.host,
    port:   config.smtp.port,
    secure: config.smtp.secure,
    auth:   { user: config.smtp.user, pass: config.smtp.pass },
  });
  return _transporter;
}

// Send via the Resend.com HTTPS API (no SDK dependency). Used when RESEND_API_KEY is set.
async function sendViaResend(opts: {
  to: string; subject: string; html: string; text?: string; replyTo?: string; fromName?: string;
}): Promise<{ messageId: string }> {
  // From must be on a Resend-verified domain. Only the display name is white-labeled.
  const configured = config.resend.from || `${config.smtp.fromName} <${config.smtp.fromEmail}>`;
  let from = configured;
  if (opts.fromName) {
    const m = configured.match(/<([^>]+)>/);
    const addr = m ? m[1] : configured;
    from = `${opts.fromName} <${addr}>`;
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Resend send failed (${resp.status}): ${detail.slice(0, 300)}`);
  }
  const data: any = await resp.json().catch(() => ({}));
  return { messageId: data?.id ?? 'resend' };
}

export function isResendConfigured(): boolean {
  return !!config.resend.apiKey;
}

// ── Main send function ─────────────────────────────────────────────────────────

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;     // recipient "Reply" goes here (tenant's address for white-label)
  fromName?: string;    // overrides the default From display name (tenant company name)
  tenantId?: string;    // when provided, uses tenant's own SMTP config from DB + tracks credits
}): Promise<{ messageId: string }> {

  // 1. If tenantId provided, try tenant-specific SMTP config first
  if (opts.tenantId) {
    const tenantCfg = await getTenantSmtpConfig(opts.tenantId);
    if (tenantCfg) {
      // Tenant's own SMTP — no credit deduction (they pay for their own server).
      // Just increment the sent counter for analytics.
      trackEmailSent(opts.tenantId);
      const transporter = getTenantTransporter(opts.tenantId, tenantCfg);
      const displayName = opts.fromName || tenantCfg.from_name || config.smtp.fromName;
      const fromEmail = tenantCfg.from_email || tenantCfg.user;
      const from = `"${displayName}" <${fromEmail}>`;

      const info = await transporter.sendMail({
        from,
        to:      opts.to,
        subject: opts.subject,
        html:    opts.html,
        text:    opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      });
      return { messageId: info.messageId };
    }
    // No tenant SMTP config — fall through to global methods (credits apply)
    const allowed = await consumeEmailCredit(opts.tenantId);
    if (!allowed) throw new Error('Email credits exhausted. Contact your administrator to purchase more credits.');
  }

  // 2. Prefer Resend when configured; otherwise fall back to SMTP (existing behavior).
  if (isResendConfigured()) {
    return sendViaResend(opts);
  }

  // 3. Global SMTP from .env
  const transporter = getTransporter();
  if (!transporter) throw new Error('SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS in .env or configure SMTP in Integrations)');

  // From address stays on our verified sending domain; only the display NAME is white-labeled.
  const displayName = opts.fromName || config.smtp.fromName;
  const from = config.smtp.fromEmail
    ? `"${displayName}" <${config.smtp.fromEmail}>`
    : config.smtp.user;

  const info = await transporter.sendMail({
    from,
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
    text:    opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  });
  return { messageId: info.messageId };
}

export function isSmtpConfigured(): boolean {
  return !!(config.smtp.host && config.smtp.user && config.smtp.pass);
}

/** Check if a tenant has any email sending capability (own SMTP, Resend, or global SMTP) */
export async function canSendEmail(tenantId?: string): Promise<boolean> {
  if (tenantId) {
    const cfg = await getTenantSmtpConfig(tenantId);
    if (cfg) return true;
  }
  return isResendConfigured() || isSmtpConfigured();
}

export const EMAIL_QUEUE = 'email';
type EmailOpts = Parameters<typeof sendEmail>[0];

/**
 * Fire-and-forget email through the queue. With Redis the send is durable +
 * retried/backed-off by the worker; without Redis it sends inline (previous
 * behavior). Use this for NON-interactive emails (notifications, alerts) where
 * the caller doesn't need the messageId or a synchronous success/fail result —
 * for those (login OTP, password reset, workflow logs) keep calling sendEmail.
 */
export function queueEmail(opts: EmailOpts): void {
  void enqueue(EMAIL_QUEUE, opts);
}

/** Test a tenant's SMTP connection (verifies credentials). */
export async function testTenantSmtp(tenantId: string): Promise<{ success: boolean; error?: string }> {
  const cfg = await getTenantSmtpConfig(tenantId);
  if (!cfg) return { success: false, error: 'No SMTP configuration found. Please save your settings first.' };
  try {
    const transporter = getTenantTransporter(tenantId, cfg);
    await transporter.verify();
    return { success: true };
  } catch (e: any) {
    invalidateTenantSmtpCache(tenantId);
    return { success: false, error: e.message ?? 'Connection failed' };
  }
}
