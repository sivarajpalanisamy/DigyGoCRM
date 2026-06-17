import { Router, Response, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { query, pool } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, hasPermission } from '../middleware/permissions';
import { triggerWorkflows } from './workflows';
import { sendNewLeadNotification } from '../utils/notifications';
import { emitLeadCreated } from '../utils/leadEvents';
import { sendEmail, getTenantEmailIdentity } from '../services/email';

const router = Router();

// Public booking rate limit: 30 req / 15 min per IP (#49)
const publicBookingLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === 'production' ? 30 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = new Date(d + 'T12:00:00');
  return !isNaN(dt.getTime());
}

function isValidTime(t: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function checkMinNotice(et: any, startMs: number): string | null {
  if (!et.min_notice_value) return null;
  const unit: string = et.min_notice_unit ?? 'hours';
  const msMap: Record<string, number> = {
    minutes: 60_000,
    hours:   3_600_000,
    days:    86_400_000,
  };
  const noticeMsRequired = et.min_notice_value * (msMap[unit] ?? 3_600_000);
  if (Date.now() + noticeMsRequired > startMs) {
    return `Booking requires at least ${et.min_notice_value} ${unit} notice`;
  }
  return null;
}

function checkSchedulingWindow(et: any, date: string, time: string, duration: number): string | null {
  const schedule = typeof et.schedule === 'string' ? JSON.parse(et.schedule) : (et.schedule ?? {});
  const SHORT_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const LONG_DAYS  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const idx      = new Date(date + 'T12:00:00').getDay();
  const shortDay = SHORT_DAYS[idx];
  const longDay  = LONG_DAYS[idx];
  const day = schedule[shortDay] ?? schedule[longDay];
  if (!day || !day.enabled) return `No availability on ${shortDay}`;

  const [h, m] = time.split(':').map(Number);
  const slotStart = h * 60 + m;
  const slotEnd   = slotStart + (duration ?? 30);

  // New format: slots array [{start, end}] — check requested time fits inside any slot
  if (Array.isArray(day.slots) && day.slots.length > 0) {
    const fits = day.slots.some((s: { start: string; end: string }) => {
      const [sh, sm] = s.start.split(':').map(Number);
      const [eh, em] = s.end.split(':').map(Number);
      return slotStart >= sh * 60 + sm && slotEnd <= eh * 60 + em;
    });
    if (!fits) return `Requested time is outside the available slots for ${shortDay}`;
    return null;
  }

  // Legacy format: day.start / day.end
  const wStart   = (day.start ?? '00:00').split(':').map(Number);
  const wEnd     = (day.end   ?? '23:59').split(':').map(Number);
  const winStart = wStart[0] * 60 + (wStart[1] ?? 0);
  const winEnd   = wEnd[0]   * 60 + (wEnd[1]   ?? 59);
  if (slotStart < winStart || slotEnd > winEnd) {
    return `Requested time is outside available hours (${day.start} – ${day.end})`;
  }
  return null;
}

function checkDateOverrides(et: any, date: string): string | null {
  const overrides = typeof et.date_overrides === 'string' ? JSON.parse(et.date_overrides) : (et.date_overrides ?? {});
  const ov = overrides[date];
  if (ov?.closed) return 'This date is unavailable';
  return null;
}

function checkBookingWindow(et: any, date: string, startMs: number): string | null {
  if (et.scheduling_type === 'days' && et.days_in_future) {
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + et.days_in_future);
    if (new Date(date + 'T23:59:59') > maxDate) {
      return `Bookings are only available up to ${et.days_in_future} days in advance`;
    }
  }
  if (et.scheduling_type === 'date_range' || et.scheduling_type === 'range') {
    if (et.date_range_start && date < et.date_range_start) {
      return `Bookings open on ${et.date_range_start}`;
    }
    if (et.date_range_end && date > et.date_range_end) {
      return `Bookings closed after ${et.date_range_end}`;
    }
  }
  return null;
}

// Valid status transitions: from → allowed next states
const STATUS_TRANSITIONS: Record<string, string[]> = {
  scheduled:   ['completed', 'cancelled', 'no-show', 'rescheduled'],
  rescheduled: ['completed', 'cancelled', 'no-show', 'scheduled'],
  completed:   ['cancelled'],
  'no-show':   ['scheduled', 'cancelled'],
  cancelled:   [],
};
const VALID_STATUSES = new Set(Object.keys(STATUS_TRANSITIONS));

// ── PUBLIC BOOKING ROUTES (no auth required) ─────────────────────────────────

// GET /api/calendar/public/booked-slots?event_type_id=X&date=YYYY-MM-DD
// Returns FULL slot times (HH:MM) — slots where booking count >= capacity_per_slot
router.get('/public/booked-slots', publicBookingLimiter, async (req: Request, res: Response) => {
  const { event_type_id, date } = req.query as Record<string, string>;
  if (!event_type_id || !date || !isValidDate(date)) {
    res.status(400).json({ error: 'event_type_id and date required' }); return;
  }
  try {
    // Fetch capacity for this event type
    const etRes = await query('SELECT capacity_per_slot FROM event_types WHERE id=$1', [event_type_id]);
    const capacity: number = etRes.rows[0]?.capacity_per_slot ?? 1;

    // capacity = 0 means unlimited — no slot can ever be "full"
    if (capacity === 0) { res.json([]); return; }

    const dayStart = new Date(`${date}T00:00:00`).toISOString();
    const dayEnd   = new Date(`${date}T23:59:59.999`).toISOString();
    const result = await query(
      `SELECT start_time, COUNT(*) AS cnt
       FROM calendar_events
       WHERE event_type_id=$1 AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE
         AND start_time >= $2 AND start_time < $3
       GROUP BY start_time`,
      [event_type_id, dayStart, dayEnd]
    );
    // Only return slots that are at or beyond capacity
    const fullTimes = result.rows
      .filter((r: any) => Number(r.cnt) >= capacity)
      .map((r: any) => {
        const d = new Date(r.start_time);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      });
    res.json(fullTimes);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/calendar/public/event-type/:slug
router.get('/public/event-type/:slug', publicBookingLimiter, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, slug, duration, description, meeting_type, meeting_link,
              scheduling_type, days_in_future, date_range_start, date_range_end,
              timezone, schedule, buffer_time, form_fields, date_overrides, is_active,
              min_notice_value, min_notice_unit, redirect_url, max_per_day
       FROM event_types WHERE slug = $1 AND is_active = true AND is_deleted = FALSE ORDER BY created_at ASC LIMIT 1`,
      [req.params.slug]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Calendar not found' }); return; }
    const et = result.rows[0];
    ['schedule', 'form_fields', 'date_overrides'].forEach((k) => {
      if (typeof et[k] === 'string') try { et[k] = JSON.parse(et[k]); } catch { et[k] = {}; }
    });
    res.json(et);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/calendar/public/book
// FIX #1,#2: Atomic transaction with advisory lock — no double bookings
// FIX #3:    Date/time format validation
// FIX #4:    min_notice enforcement
// FIX #5:    days_in_future enforcement
// FIX #6:    date_range enforcement
// FIX #7:    schedule (working hours) enforcement
// FIX #8:    date_overrides enforcement
// FIX #10:   Email normalised to lowercase
// FIX #12:   Only create lead if email or phone provided
// FIX #14:   max_per_day counts only scheduled/rescheduled
async function storeExtraFields(leadId: string, tenantId: string, extra: Record<string, string>) {
  for (const [slug, value] of Object.entries(extra)) {
    if (!value) continue;
    try {
      let cfRes = await query('SELECT id FROM custom_fields WHERE tenant_id=$1 AND slug=$2 LIMIT 1', [tenantId, slug]);
      if (!cfRes.rows[0]) {
        const fieldName = slug.split(/[_\-]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        try {
          cfRes = await query(
            `INSERT INTO custom_fields (tenant_id, name, type, slug, required) VALUES ($1,$2,'Single Line',$3,false) RETURNING id`,
            [tenantId, fieldName, slug]
          );
        } catch {
          cfRes = await query('SELECT id FROM custom_fields WHERE tenant_id=$1 AND slug=$2 LIMIT 1', [tenantId, slug]);
        }
      }
      if (cfRes.rows[0]?.id) {
        await query(
          `INSERT INTO lead_field_values (lead_id, tenant_id, field_id, value)
           VALUES ($1,$2,$3,$4) ON CONFLICT (lead_id, field_id) DO UPDATE SET value=$4, updated_at=NOW()`,
          [leadId, tenantId, cfRes.rows[0].id, value]
        );
      }
    } catch (err) {
      console.error('[storeExtraFields] slug:', slug, err);
    }
  }
}

router.post('/public/book', publicBookingLimiter, async (req: Request, res: Response) => {
  let { event_type_id, guest_name, guest_email, guest_phone, date, time } = req.body;
  const extra_fields: Record<string, string> = req.body.extra_fields ?? {};

  if (!event_type_id || !guest_name || !date || !time) {
    res.status(400).json({ error: 'event_type_id, guest_name, date, time required' }); return;
  }
  if (!isValidDate(date)) {
    res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD required)' }); return;
  }
  if (!isValidTime(time)) {
    res.status(400).json({ error: 'Invalid time format (HH:MM required)' }); return;
  }
  if (guest_email) guest_email = guest_email.toLowerCase().trim();

  const startIso = `${date}T${time}:00`;
  const startMs  = new Date(startIso).getTime();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const etRes = await client.query(
      'SELECT * FROM event_types WHERE id=$1 AND is_active=true AND is_deleted=FALSE FOR UPDATE',
      [event_type_id]
    );
    const et = etRes.rows[0];
    if (!et) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Event type not found or inactive' }); return;
    }

    const startDate = new Date(startIso);
    const endDate   = new Date(startMs + et.duration * 60000);
    const bufMs     = (et.buffer_time ?? 0) * 60_000;
    const buffStart = new Date(startMs - bufMs);
    const buffEnd   = new Date(startMs + et.duration * 60000 + bufMs);

    const noticeErr = checkMinNotice(et, startMs);
    if (noticeErr) { await client.query('ROLLBACK'); res.status(400).json({ error: noticeErr }); return; }

    const windowErr = checkBookingWindow(et, date, startMs);
    if (windowErr) { await client.query('ROLLBACK'); res.status(400).json({ error: windowErr }); return; }

    const overrideErr = checkDateOverrides(et, date);
    if (overrideErr) { await client.query('ROLLBACK'); res.status(400).json({ error: overrideErr }); return; }

    const schedule = typeof et.schedule === 'string' ? JSON.parse(et.schedule) : (et.schedule ?? {});
    if (Object.keys(schedule).length > 0) {
      const schedErr = checkSchedulingWindow(et, date, time, et.duration);
      if (schedErr) { await client.query('ROLLBACK'); res.status(400).json({ error: schedErr }); return; }
    }

    // Slot capacity check — uses buffer time on both ends
    const capacity: number = et.capacity_per_slot ?? 1;
    if (capacity !== 0) {
      const slotCount = await client.query(
        `SELECT COUNT(*) AS cnt FROM calendar_events
         WHERE event_type_id=$1 AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE
           AND start_time < $2 AND end_time > $3`,
        [event_type_id, buffEnd.toISOString(), buffStart.toISOString()]
      );
      if (Number(slotCount.rows[0].cnt) >= capacity) {
        await client.query('ROLLBACK');
        res.status(409).json({
          error: capacity === 1
            ? 'This slot has just been taken — please choose another time'
            : `This slot is full (${capacity} / ${capacity} spots taken) — please choose another time`,
        }); return;
      }
    }

    if (et.max_per_day && et.max_per_day > 0) {
      const dayCount = await client.query(
        `SELECT COUNT(*) AS cnt FROM calendar_events
         WHERE event_type_id=$1 AND status IN ('scheduled','rescheduled') AND is_deleted=FALSE
           AND start_time::date = $2::date`,
        [event_type_id, date]
      );
      if (Number(dayCount.rows[0].cnt) >= et.max_per_day) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: `This calendar is fully booked for ${date} — please pick another day` }); return;
      }
    }

    // ── Staff auto-assignment (round-robin or priority) ───────────────────────
    let assignedUserId: string | null = null;
    const staffEmails: string[] = (() => {
      try { return Array.isArray(et.staff_emails) ? et.staff_emails : JSON.parse(et.staff_emails ?? '[]'); }
      catch { return []; }
    })();

    if (staffEmails.length > 0) {
      const staffRes = await client.query(
        `SELECT id, email FROM users WHERE email = ANY($1) AND tenant_id=$2 AND is_active=true`,
        [staffEmails, et.tenant_id]
      );
      const staffUsers: { id: string; email: string }[] = staffRes.rows;

      if (staffUsers.length > 0) {
        const dayOfWeek = startDate.getDay();

        // Helper: is this staff member free and within their working hours for this slot?
        const isAvailable = async (userId: string): Promise<boolean> => {
          // Calendar conflict check (with buffer time)
          const conflict = await client.query(
            `SELECT id FROM calendar_events WHERE assigned_to=$1 AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE AND start_time < $2 AND end_time > $3`,
            [userId, buffEnd.toISOString(), buffStart.toISOString()]
          );
          if (conflict.rows.length > 0) return false;
          // User availability check
          const avail = await client.query(
            `SELECT start_time, end_time FROM user_availability WHERE user_id=$1 AND day_of_week=$2 AND is_active=true LIMIT 1`,
            [userId, dayOfWeek]
          );
          if (avail.rows.length === 0) return true; // no availability set = always available
          const ua = avail.rows[0];
          const [avSH, avSM] = ua.start_time.substring(0, 5).split(':').map(Number);
          const [avEH, avEM] = ua.end_time.substring(0, 5).split(':').map(Number);
          const bookStartM = startDate.getHours() * 60 + startDate.getMinutes();
          const bookEndM   = endDate.getHours() * 60 + endDate.getMinutes();
          return bookStartM >= avSH * 60 + avSM && bookEndM <= avEH * 60 + avEM;
        };

        if (et.assignment_mode === 'priority') {
          // Priority: first staff in staffEmails order who is free
          for (const email of staffEmails) {
            const user = staffUsers.find((u) => u.email === email);
            if (user && await isAvailable(user.id)) { assignedUserId = user.id; break; }
          }
          // All busy → assign to first in list anyway
          if (!assignedUserId) assignedUserId = staffUsers[0]?.id ?? null;
        } else {
          // Round-robin: staff with fewest total bookings for this event type
          let minCount = Infinity;
          for (const user of staffUsers) {
            const c = await client.query(
              `SELECT COUNT(*) AS cnt FROM calendar_events WHERE event_type_id=$1 AND assigned_to=$2 AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE`,
              [event_type_id, user.id]
            );
            const cnt = Number(c.rows[0].cnt);
            if (cnt < minCount && await isAvailable(user.id)) { minCount = cnt; assignedUserId = user.id; }
          }
          // All busy → fall back to least-loaded regardless of conflict
          if (!assignedUserId) {
            let min = Infinity;
            for (const user of staffUsers) {
              const c = await client.query(
                `SELECT COUNT(*) AS cnt FROM calendar_events WHERE event_type_id=$1 AND assigned_to=$2 AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE`,
                [event_type_id, user.id]
              );
              const cnt = Number(c.rows[0].cnt);
              if (cnt < min) { min = cnt; assignedUserId = user.id; }
            }
          }
        }
      }
    }

    const title  = `${et.name} – ${guest_name}`;
    const result = await client.query(
      `INSERT INTO calendar_events
         (tenant_id, event_type_id, title, guest_name, guest_email, guest_phone,
          start_time, end_time, type, meeting_link, status, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'meeting',$9,'scheduled',$10) RETURNING *`,
      [et.tenant_id, event_type_id, title,
       guest_name, guest_email ?? null, guest_phone ?? null,
       startDate.toISOString(), endDate.toISOString(),
       et.meeting_link ?? null, assignedUserId]
    );
    const event = result.rows[0];
    await client.query('COMMIT');

    res.status(201).json({ ...event, redirect_url: et.redirect_url ?? null });

    // Post-commit: lead upsert, activity log, email confirmation, workflow triggers
    setImmediate(async () => {
      try {
        // ── Booking confirmation email to guest ───────────────────────────────
        if (guest_email) {
          const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          });
          const fmt12 = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
          };
          const bookingIdent = await getTenantEmailIdentity(et.tenant_id);
          sendEmail({
            to: guest_email,
            subject: `Booking Confirmed: ${et.name}`,
            fromName: bookingIdent.fromName,
            replyTo: bookingIdent.replyTo,
            tenantId: et.tenant_id,
            html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #ece5de">
  <div style="background:linear-gradient(135deg,#c2410c,#ea580c,#f97316);padding:32px 28px">
    <h1 style="color:#fff;margin:0;font-size:22px">You're booked!</h1>
    <p style="color:#fde8d8;margin:6px 0 0;font-size:14px">${et.name}</p>
  </div>
  <div style="padding:28px">
    <p style="color:#1c1410;font-size:15px;margin:0 0 20px">Hi ${guest_name},</p>
    <p style="color:#5c5245;font-size:14px;margin:0 0 24px">Your appointment has been confirmed. Here are the details:</p>
    <div style="background:#faf8f6;border-radius:10px;padding:20px;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#7a6b5c;font-size:13px;width:90px">Date</td><td style="padding:6px 0;color:#1c1410;font-size:13px;font-weight:600">${dateLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#7a6b5c;font-size:13px">Time</td><td style="padding:6px 0;color:#1c1410;font-size:13px;font-weight:600">${fmt12(time)} · ${et.duration} min</td></tr>
        <tr><td style="padding:6px 0;color:#7a6b5c;font-size:13px">Type</td><td style="padding:6px 0;color:#1c1410;font-size:13px;font-weight:600">${et.meeting_type}</td></tr>
        ${et.meeting_link ? `<tr><td style="padding:6px 0;color:#7a6b5c;font-size:13px">Link</td><td style="padding:6px 0;font-size:13px"><a href="${et.meeting_link}" style="color:#c2410c">${et.meeting_link}</a></td></tr>` : ''}
      </table>
    </div>
    ${et.description ? `<p style="color:#5c5245;font-size:13px;margin:0 0 20px">${et.description}</p>` : ''}
    <p style="color:#9c8f84;font-size:12px;margin:0">If you need to make changes please contact us directly.</p>
  </div>
</div>`,
          }).catch((err: any) => console.error('[calendar] confirmation email failed:', err));
        }

        // ── Lead find-or-create ───────────────────────────────────────────────
        if (guest_email || guest_phone) {
          const { upsertContact } = await import('../utils/contacts');
          let lead: any = null;

          if (guest_phone) {
            const r = await query(
              `SELECT * FROM leads WHERE tenant_id=$1 AND phone=$2 AND is_deleted=FALSE LIMIT 1`,
              [et.tenant_id, guest_phone]
            );
            lead = r.rows[0] ?? null;
          }
          if (!lead && guest_email) {
            const r = await query(
              `SELECT * FROM leads WHERE tenant_id=$1 AND LOWER(email)=$2 AND is_deleted=FALSE LIMIT 1`,
              [et.tenant_id, guest_email]
            );
            lead = r.rows[0] ?? null;
          }

          if (!lead) {
            try {
              const ins = await query(
                `INSERT INTO leads (tenant_id, name, email, phone, source) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
                [et.tenant_id, guest_name, guest_email ?? null, guest_phone ?? null, `calendar:${et.name}`]
              );
              lead = ins.rows[0];
              if (lead) {
                sendNewLeadNotification(et.tenant_id, lead, null).catch(() => null);
                emitLeadCreated(et.tenant_id, lead.id).catch(() => null);
              }
            } catch {
              if (guest_email) {
                const r = await query(
                  `SELECT * FROM leads WHERE tenant_id=$1 AND LOWER(email)=$2 AND is_deleted=FALSE LIMIT 1`,
                  [et.tenant_id, guest_email]
                );
                lead = r.rows[0] ?? null;
              }
            }
          }

          if (lead) {
            await query(`UPDATE calendar_events SET lead_id=$1 WHERE id=$2`, [lead.id, event.id]);
            // Sync lead assignment: if event was auto-assigned to staff but lead has no owner yet, assign them
            if (assignedUserId && !lead.assigned_to) {
              await query(`UPDATE leads SET assigned_to=$1, updated_at=NOW() WHERE id=$2`, [assignedUserId, lead.id]);
            }
            await upsertContact(et.tenant_id, lead.name, lead.email, lead.phone, lead.id);
            if (Object.keys(extra_fields).length > 0) {
              await storeExtraFields(lead.id, et.tenant_id, extra_fields);
            }
            await query(
              `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
               VALUES ($1,$2,'appointment',$3,$4,NULL)`,
              [lead.id, et.tenant_id,
               `Appointment booked via calendar link`,
               `${et.name} · ${date} at ${time}`]
            ).catch(() => null);
            // Build rich context so {appointment_date}, {appointment_start_time},
            // {appointment_end_time}, {meeting_link} resolve in WA/email templates.
            const fmt12 = (iso: string) => {
              const d = new Date(iso);
              const h = d.getHours(), m = d.getMinutes();
              return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
            };
            const apptContext = {
              ...lead,
              event_type_id,
              calendar_name:          et.name,
              appointment_date:       new Date(event.start_time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
              appointment_start_time: fmt12(event.start_time),
              appointment_end_time:   fmt12(event.end_time),
              appointment_timezone:   (et as any).timezone ?? '',
              meeting_link:           et.meeting_link ?? '',
            };
            await triggerWorkflows('calendar_form_submitted', apptContext, et.tenant_id, '', { triggerContext: { calendarId: event_type_id } }).catch(() => null);
            await triggerWorkflows('appointment_booked',      apptContext, et.tenant_id, '', { triggerContext: { calendarId: event_type_id } }).catch(() => null);
          }
        }
      } catch (err) {
        console.error('[calendar booking] post-insert error:', err);
      }
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null);
    console.error('[public book]', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── All routes below require authentication ───────────────────────────────────
router.use(requireAuth);
router.use(requireTenant);

// GET /api/calendar/availability
router.get('/availability', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT ua.* FROM user_availability ua
       JOIN users u ON u.id = ua.user_id
       WHERE u.tenant_id = $1
       ORDER BY ua.user_id, ua.day_of_week`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/calendar/my-availability
router.get('/my-availability', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM user_availability WHERE user_id=$1 ORDER BY day_of_week',
      [req.user!.userId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/calendar/my-availability
// FIX #23: Validate day_of_week range (0-6) and time format
router.put('/my-availability', async (req: AuthRequest, res: Response) => {
  const { slots } = req.body;
  if (!Array.isArray(slots)) { res.status(400).json({ error: 'slots array required' }); return; }

  for (const s of slots) {
    if (s.day_of_week === undefined) continue;
    const dow = Number(s.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      res.status(400).json({ error: `Invalid day_of_week: ${s.day_of_week} (must be 0–6)` }); return;
    }
    if (s.is_active && s.start_time && !isValidTime(String(s.start_time).substring(0, 5))) {
      res.status(400).json({ error: `Invalid start_time for day ${dow}` }); return;
    }
    if (s.is_active && s.end_time && !isValidTime(String(s.end_time).substring(0, 5))) {
      res.status(400).json({ error: `Invalid end_time for day ${dow}` }); return;
    }
  }

  try {
    await query('DELETE FROM user_availability WHERE user_id=$1', [req.user!.userId]);
    for (const s of slots) {
      if (s.day_of_week === undefined || !s.start_time || !s.end_time) continue;
      await query(
        `INSERT INTO user_availability (user_id, day_of_week, start_time, end_time, is_active)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.user!.userId, s.day_of_week, s.start_time, s.end_time, s.is_active ?? true]
      );
    }
    const result = await query(
      'SELECT * FROM user_availability WHERE user_id=$1 ORDER BY day_of_week',
      [req.user!.userId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.get('/', checkPermission('calendar:view'), async (req: AuthRequest, res: Response) => {
  const { from, to } = req.query as Record<string, string>;
  const { userId, tenantId, role } = req.user!;

  let onlyAssigned = false;
  if (role !== 'super_admin') {
    try {
      const ownerCheck = await query('SELECT is_owner FROM users WHERE id=$1 LIMIT 1', [userId]);
      const isOwner = ownerCheck.rows[0]?.is_owner === true;
      if (!isOwner) {
        onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId);
      }
    } catch { onlyAssigned = true; }
  }

  let sql = `
    SELECT e.*, u.name AS assigned_name, l.name AS lead_name, l.email AS lead_email,
           cu.name AS created_by_name
    FROM calendar_events e
    LEFT JOIN users u  ON u.id  = e.assigned_to
    LEFT JOIN users cu ON cu.id = e.created_by
    LEFT JOIN leads l  ON l.id  = e.lead_id
    WHERE e.tenant_id = $1 AND e.is_deleted = FALSE
`;
  const params: any[] = [tenantId];

  if (onlyAssigned) {
    params.push(userId);
    sql += ` AND (e.assigned_to = $${params.length} OR l.assigned_to = $${params.length})`;
  }

  if (from) { params.push(from); sql += ` AND e.start_time >= $${params.length}`; }
  if (to)   { params.push(to);   sql += ` AND e.end_time   <= $${params.length}`; }
  sql += ' ORDER BY e.start_time ASC';
  try {
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/calendar (admin event creation)
// FIX #16: Overlap check even for unassigned events (by event_type_id)
// FIX #7b: Buffer time respected if buffer_time passed in body
router.post('/', checkPermission('calendar:manage'), async (req: AuthRequest, res: Response) => {
  const {
    title, description, start_time, end_time, type,
    lead_id, assigned_to, meeting_link, guest_name, event_type_id, buffer_time,
  } = req.body;
  if (!title || !start_time || !end_time) {
    res.status(400).json({ error: 'title, start_time, end_time required' }); return;
  }
  try {
    // FIX #7b: Apply buffer time on both sides when checking overlap
    const bufMs   = (buffer_time ?? 0) * 60000;
    const bufferedStart = new Date(new Date(start_time).getTime() - bufMs).toISOString();
    const bufferedEnd   = new Date(new Date(end_time).getTime()   + bufMs).toISOString();

    // Always check staff conflict when assigned
    if (assigned_to) {
      const overlap = await query(
        `SELECT id FROM calendar_events
         WHERE tenant_id=$1 AND assigned_to=$2 AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE
           AND start_time < $3 AND end_time > $4`,
        [req.user!.tenantId, assigned_to, bufferedEnd, bufferedStart]
      );
      if (overlap.rows.length > 0) {
        res.status(409).json({ error: 'Staff member already has a booking at this time' }); return;
      }
    }

    // Always check event_type slot conflict regardless of assigned_to
    if (event_type_id) {
      const etCapRes = await query('SELECT capacity_per_slot FROM event_types WHERE id=$1', [event_type_id]);
      const slotCapacity: number = etCapRes.rows[0]?.capacity_per_slot ?? 1;
      if (slotCapacity !== 0) {
        const slotCount = await query(
          `SELECT COUNT(*) AS cnt FROM calendar_events
           WHERE tenant_id=$1 AND event_type_id=$2 AND status NOT IN ('cancelled','no-show') AND is_deleted=FALSE
             AND start_time < $3 AND end_time > $4`,
          [req.user!.tenantId, event_type_id, end_time, start_time]
        );
        if (Number(slotCount.rows[0].cnt) >= slotCapacity) {
          res.status(409).json({
            error: slotCapacity === 1
              ? 'This slot is already booked for this calendar'
              : `This slot is full (${slotCapacity} spots) — choose another time`,
          }); return;
        }
      }
    }

    const result = await query(
      `INSERT INTO calendar_events
         (tenant_id, title, description, start_time, end_time, type, lead_id, assigned_to,
          created_by, meeting_link, guest_name, event_type_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user!.tenantId, title, description, start_time, end_time, type ?? 'meeting',
       lead_id ?? null, assigned_to ?? null, req.user!.userId,
       meeting_link ?? null, guest_name ?? null, event_type_id ?? null]
    );
    const event = result.rows[0];
    res.status(201).json(event);
    if (lead_id) {
      const tenantId = req.user!.tenantId!;
      const userId   = req.user!.userId;
      setImmediate(async () => {
        try {
          const leadRes = await query('SELECT * FROM leads WHERE id=$1', [lead_id]).catch(() => null);
          const lead = leadRes?.rows[0] ?? { id: lead_id, name: '' };
          let calendarName = '';
          if (event_type_id) {
            const etRes = await query('SELECT name FROM event_types WHERE id=$1', [event_type_id]).catch(() => null);
            calendarName = etRes?.rows[0]?.name ?? '';
          }
          const staffRes = await query('SELECT name FROM users WHERE id=$1', [userId]).catch(() => null);
          const staffName = staffRes?.rows[0]?.name ?? 'Staff';
          await query(
            `INSERT INTO lead_activities (lead_id, tenant_id, type, title, detail, created_by)
             VALUES ($1,$2,'appointment',$3,$4,$5)`,
            [lead_id, tenantId,
             `Appointment booked by ${staffName}`,
             `${calendarName || title} · ${start_time.slice(0, 10)} at ${start_time.slice(11, 16)}`,
             userId]
          ).catch(() => null);
          const calendarContext = { ...lead, event_type_id: event_type_id ?? '', calendar_name: calendarName };
          await triggerWorkflows('calendar_form_submitted', calendarContext, tenantId, userId, { triggerContext: { calendarId: event_type_id ?? '' } }).catch(() => null);
          await triggerWorkflows('appointment_booked',      calendarContext, tenantId, userId, { triggerContext: { calendarId: event_type_id ?? '' } }).catch(() => null);
        } catch (err) {
          console.error('[calendar manual booking] trigger error:', err);
        }
      });
    }
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/calendar/:id
// FIX #13: Status transition validation
router.patch('/:id', checkPermission('calendar:manage'), async (req: AuthRequest, res: Response) => {
  const { title, description, start_time, end_time, type, lead_id, assigned_to, status, meeting_link } = req.body;

  // FIX #13: Validate status value and transition
  if (status !== undefined) {
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ error: `Invalid status "${status}". Allowed: ${[...VALID_STATUSES].join(', ')}` }); return;
    }
    // Check current status for transition guard
    const cur = await query(
      'SELECT status FROM calendar_events WHERE id=$1 AND tenant_id=$2 AND is_deleted=FALSE',
      [req.params.id, req.user!.tenantId]
    );
    const currentStatus: string = cur.rows[0]?.status;
    if (currentStatus && !STATUS_TRANSITIONS[currentStatus]?.includes(status)) {
      res.status(400).json({
        error: `Cannot transition from "${currentStatus}" to "${status}"`,
      }); return;
    }
  }

  const fields: string[] = [];
  const params: any[] = [];
  if (title        !== undefined) { params.push(title);        fields.push(`title=$${params.length}`); }
  if (description  !== undefined) { params.push(description);  fields.push(`description=$${params.length}`); }
  if (start_time   !== undefined) { params.push(start_time);   fields.push(`start_time=$${params.length}`); }
  if (end_time     !== undefined) { params.push(end_time);     fields.push(`end_time=$${params.length}`); }
  if (type         !== undefined) { params.push(type);         fields.push(`type=$${params.length}`); }
  if (lead_id      !== undefined) { params.push(lead_id);      fields.push(`lead_id=$${params.length}`); }
  if (assigned_to  !== undefined) { params.push(assigned_to);  fields.push(`assigned_to=$${params.length}`); }
  if (status       !== undefined) { params.push(status);       fields.push(`status=$${params.length}`); }
  if (meeting_link !== undefined) { params.push(meeting_link); fields.push(`meeting_link=$${params.length}`); }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }

  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE calendar_events SET ${fields.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND is_deleted=FALSE RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Event not found' }); return; }
    const event = result.rows[0];
    res.json(event);
    if (event.lead_id && status !== undefined) {
      const triggerMap: Record<string, string> = {
        'completed':   'appointment_showup',
        'no-show':     'appointment_noshow',
        'cancelled':   'appointment_cancelled',
        'rescheduled': 'appointment_rescheduled',
      };
      const wfTrigger = triggerMap[status];
      if (wfTrigger) {
        const leadRes = await query('SELECT * FROM leads WHERE id=$1', [event.lead_id]).catch(() => null);
        const lead = leadRes?.rows[0] ?? { id: event.lead_id, name: '' };
        const apptType   = (event.type as string) ?? '';
        const calendarId = (event.event_type_id as string) ?? '';
        setImmediate(() => triggerWorkflows(wfTrigger, lead, req.user!.tenantId!, req.user!.userId,
          { triggerContext: { apptType, calendarId } }
        ).catch(() => null));
      }
    }
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/calendar/:id — soft-delete to preserve audit trail (FIX #11)
router.delete('/:id', checkPermission('calendar:manage'), async (req: AuthRequest, res: Response) => {
  const { tenantId, userId } = req.user!;
  try {
    const existing = await query(
      'SELECT * FROM calendar_events WHERE id=$1 AND tenant_id=$2 AND is_deleted=FALSE',
      [req.params.id, tenantId]
    );
    const event = existing.rows[0];
    if (!event) { res.status(404).json({ error: 'Event not found' }); return; }
    await query(
      'UPDATE calendar_events SET is_deleted=TRUE, status=\'cancelled\' WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenantId]
    );
    res.json({ success: true });
    if (event.lead_id) {
      const leadRes = await query('SELECT * FROM leads WHERE id=$1', [event.lead_id]).catch(() => null);
      const lead = leadRes?.rows[0] ?? { id: event.lead_id, name: '' };
      const calendarId = (event.event_type_id as string) ?? '';
      setImmediate(() => triggerWorkflows('appointment_cancelled', lead, tenantId!, userId,
        { triggerContext: { calendarId } }
      ).catch(() => null));
    }
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Event Types ────────────────────────────────────────────────────────────────

const JSON_ET_FIELDS = new Set(['staff_emails', 'schedule', 'form_fields', 'date_overrides']);

router.get('/event-types', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM event_types WHERE tenant_id=$1 AND is_deleted=FALSE ORDER BY sort_order ASC, created_at ASC',
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/event-types', checkPermission('calendar:manage'), async (req: AuthRequest, res: Response) => {
  const {
    name, slug, duration, description, staff_type, assignment_mode, staff_emails,
    meeting_type, meeting_link, scheduling_type, days_in_future, date_range_start, date_range_end,
    timezone, schedule, buffer_time, is_active, form_fields, date_overrides,
    redirect_url, max_per_day, min_notice_value, min_notice_unit, capacity_per_slot,
  } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  const baseSlugVal = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let slugVal = baseSlugVal;
  try {
    // Ensure slug is globally unique across all tenants
    let sn = 1;
    while (true) {
      const chk = await query('SELECT id FROM event_types WHERE slug=$1', [slugVal]);
      if (!chk.rows.length) break;
      sn++;
      slugVal = `${baseSlugVal}-${sn}`;
    }
    const result = await query(
      `INSERT INTO event_types
         (tenant_id, name, slug, duration, description, staff_type, assignment_mode,
          staff_emails, meeting_type, meeting_link, scheduling_type, days_in_future,
          date_range_start, date_range_end, timezone, schedule, buffer_time, is_active,
          form_fields, date_overrides, redirect_url, max_per_day, min_notice_value, min_notice_unit,
          capacity_per_slot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [
        req.user!.tenantId, name, slugVal, duration ?? 30, description ?? '',
        staff_type ?? 'single', assignment_mode ?? 'round-robin',
        JSON.stringify(staff_emails ?? []), meeting_type ?? 'Google Meet', meeting_link ?? null,
        scheduling_type ?? 'days', days_in_future ?? 30,
        date_range_start ?? null, date_range_end ?? null,
        timezone ?? 'Asia/Kolkata', JSON.stringify(schedule ?? {}),
        buffer_time ?? 0, is_active ?? true,
        JSON.stringify(form_fields ?? []), JSON.stringify(date_overrides ?? {}),
        redirect_url ?? null, max_per_day ?? 0, min_notice_value ?? 2, min_notice_unit ?? 'days',
        capacity_per_slot ?? 1,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'Slug already exists — choose a different name' }); }
    else { res.status(500).json({ error: 'Server error' }); }
  }
});

router.patch('/event-types/:id', checkPermission('calendar:manage'), async (req: AuthRequest, res: Response) => {
  const allowed = [
    'name', 'slug', 'duration', 'description', 'staff_type', 'assignment_mode',
    'staff_emails', 'meeting_type', 'meeting_link', 'scheduling_type', 'days_in_future',
    'date_range_start', 'date_range_end', 'timezone', 'schedule', 'buffer_time',
    'is_active', 'form_fields', 'sort_order', 'date_overrides',
    'redirect_url', 'max_per_day', 'min_notice_value', 'min_notice_unit', 'capacity_per_slot',
  ];
  const fields: string[] = [];
  const params: any[] = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(JSON_ET_FIELDS.has(key) ? JSON.stringify(req.body[key]) : req.body[key]);
      fields.push(`${key}=$${params.length}`);
    }
  }
  if (!fields.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  fields.push('updated_at=NOW()');
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE event_types SET ${fields.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/event-types/:id', checkPermission('calendar:manage'), async (req: AuthRequest, res: Response) => {
  try {
    await query(
      'UPDATE event_types SET is_deleted=TRUE, is_active=FALSE, updated_at=NOW() WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.user!.tenantId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/calendar/booking-links — list active booking links for workflow trigger filter
router.get('/booking-links', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, slug FROM event_types WHERE tenant_id=$1 AND is_active=TRUE AND is_deleted=FALSE ORDER BY sort_order ASC, created_at ASC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;
