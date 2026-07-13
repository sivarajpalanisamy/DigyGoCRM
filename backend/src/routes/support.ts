import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { query } from '../db';
import { sendEmail, canSendEmail } from '../services/email';
import { config } from '../config';

const router = Router();
router.use(requireAuth);

// Basic escaping so user-supplied text can't inject HTML into the ticket email.
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// POST /api/support/ticket — raise a support ticket. Emails the Hawcus admin inbox
// (config.supportEmail) with Reply-To set to the requesting user so admins can reply directly.
router.post('/ticket', async (req: AuthRequest, res: Response) => {
  const { userId, tenantId, role } = req.user!;
  const subject = String(req.body?.subject ?? '').trim();
  const message = String(req.body?.message ?? '').trim();

  if (!subject || !message) {
    res.status(400).json({ error: 'Subject and message are required' });
    return;
  }
  if (subject.length > 200) { res.status(400).json({ error: 'Subject is too long (max 200 chars)' }); return; }
  if (message.length > 5000) { res.status(400).json({ error: 'Message is too long (max 5000 chars)' }); return; }

  try {
    // Look up the requester + tenant so the admin knows who filed it.
    const u = await query('SELECT name, email FROM users WHERE id=$1 LIMIT 1', [userId]);
    const user = u.rows[0] ?? {};
    let tenantName = '';
    if (tenantId) {
      const t = await query('SELECT name FROM tenants WHERE id=$1 LIMIT 1', [tenantId]);
      tenantName = t.rows[0]?.name ?? '';
    }

    // Global send (no tenantId) so this comes from the Hawcus sending identity, not the
    // tenant's SMTP, and doesn't consume their email credits.
    if (!(await canSendEmail())) {
      res.status(503).json({ error: 'Email is not configured on the server. Please contact support directly.' });
      return;
    }

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111318;line-height:1.6">
        <h2 style="margin:0 0 12px">New Support Ticket</h2>
        <table style="border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">From</td><td><strong>${esc(user.name ?? 'Unknown')}</strong> &lt;${esc(user.email ?? 'no-email')}&gt;</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Company</td><td>${esc(tenantName || '—')}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Role</td><td>${esc(role)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Subject</td><td><strong>${esc(subject)}</strong></td></tr>
        </table>
        <div style="padding:14px 16px;background:#f4f5f7;border-radius:10px;white-space:pre-wrap">${esc(message)}</div>
      </div>`;

    const text = `New Support Ticket\n\nFrom: ${user.name ?? 'Unknown'} <${user.email ?? 'no-email'}>\nCompany: ${tenantName || '-'}\nRole: ${role}\nSubject: ${subject}\n\n${message}`;

    await sendEmail({
      to: config.supportEmail,
      subject: `[Support] ${subject}`,
      html,
      text,
      // Admin can hit "Reply" and reach the user directly.
      replyTo: user.email || undefined,
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[support:ticket]', err?.message ?? err);
    res.status(500).json({ error: 'Failed to send your ticket. Please try again later.' });
  }
});

export default router;
