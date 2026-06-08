import nodemailer from 'nodemailer';
import { config } from '../config';
import { query } from '../db';

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

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;     // recipient "Reply" goes here (tenant's address for white-label)
  fromName?: string;    // overrides the default From display name (tenant company name)
}): Promise<{ messageId: string }> {
  // Prefer Resend when configured; otherwise fall back to SMTP (existing behavior).
  if (isResendConfigured()) {
    return sendViaResend(opts);
  }
  const transporter = getTransporter();
  if (!transporter) throw new Error('SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS in .env)');

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
