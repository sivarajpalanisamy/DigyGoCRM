import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db';
import { requireAuth, requireTenant, AuthRequest } from '../middleware/auth';
import { checkPermission, checkAnyPermission, clearUserPermCache } from '../middleware/permissions';
import { checkUsage, incrementUsage, decrementUsage } from '../middleware/plan';
import { emitToUser } from '../socket';
import { sendEmail, getTenantEmailIdentity } from '../services/email';

// Helper: resolve the correct frontend URL for a tenant (custom domain > default)
export async function getTenantFrontendUrl(tenantId: string): Promise<string> {
  try {
    const r = await query(
      "SELECT custom_domain, domain_status FROM tenants WHERE id=$1 LIMIT 1",
      [tenantId]
    );
    const t = r.rows[0];
    if (t?.domain_status === 'ssl_active' && t?.custom_domain) {
      return `https://${t.custom_domain}`;
    }
  } catch { /* non-fatal */ }
  return process.env.FRONTEND_URL ?? 'https://crm.digygo.in';
}

// Canonical full-access permissions — all keys true except the two that default off.
export const FULL_PERMISSIONS: Record<string, boolean> = {
  'dashboard:total_leads': true, 'dashboard:active_staff': true,
  'dashboard:conversations': true, 'dashboard:appointments': true,
  'meta_forms:read': true, 'meta_forms:create': true, 'meta_forms:edit': true, 'meta_forms:delete': true,
  'custom_forms:read': true, 'custom_forms:create': true, 'custom_forms:edit': true, 'custom_forms:delete': true,
  'landing_pages:read': true, 'landing_pages:create': true, 'landing_pages:edit': true, 'landing_pages:delete': true,
  'whatsapp_setup:read': true, 'whatsapp_setup:manage': true,
  'leads:view_all': true, 'leads:create': true, 'leads:edit': true, 'leads:delete': true, 'leads:view_own': true,
  'leads:assign': true,
  'leads:only_assigned': false, 'leads:mask_phone': false, 'leads:export': true,
  'followups:view': true, 'pipeline:view': true,
  'contacts:read': true, 'contacts:create': true, 'contacts:edit': true, 'contacts:delete': true, 'contacts:export': true,
  'contact_groups:read': true, 'contact_groups:manage': true,
  'opportunities:read': true, 'opportunities:create': true, 'opportunities:edit': true, 'opportunities:delete': true,
  'tags:view': true, 'tags:manage': true,
  'automation:view': true, 'automation:manage': true,
  'automation_templates:read': true, 'automation_templates:manage': true,
  'whatsapp_automation:read': true, 'whatsapp_automation:manage': true,
  'assignment_rules:view': true, 'assignment_rules:manage': true,
  'routing:view': true, 'routing:manage': true,
  'whatsapp_flows:view': true, 'whatsapp_flows:manage': true,
  'inbox:view_all': true, 'inbox:send': true, 'inbox:assign': true,
  'fields:view': true, 'fields:manage': true,
  'staff:view': true, 'staff:manage': true,
  'settings:manage': true, 'settings:company': true, 'settings:branding': true, 'settings:security': true,
  'calendar:manage': true, 'calendar:view': true, 'pipeline:manage': true,
  'integrations:view': true, 'integrations:manage': true,
  'calls:view_all': true, 'calls:view_own': true, 'calls:recordings': true,
};

// Default custom permissions for newly created staff (read-only access to most modules).
const CUSTOM_DEFAULT_PERMISSIONS: Record<string, boolean> = {
  'dashboard:total_leads': true, 'dashboard:active_staff': false,
  'dashboard:conversations': false, 'dashboard:appointments': false,
  'meta_forms:read': true, 'meta_forms:create': false, 'meta_forms:edit': false, 'meta_forms:delete': false,
  'custom_forms:read': true, 'custom_forms:create': false, 'custom_forms:edit': false, 'custom_forms:delete': false,
  'landing_pages:read': true, 'landing_pages:create': false, 'landing_pages:edit': false, 'landing_pages:delete': false,
  'whatsapp_setup:read': true, 'whatsapp_setup:manage': false,
  'leads:view_all': true, 'leads:create': true, 'leads:edit': true, 'leads:delete': false, 'leads:view_own': true,
  'leads:assign': false,
  'leads:only_assigned': false, 'leads:mask_phone': false, 'leads:export': false,
  'followups:view': true, 'pipeline:view': true,
  'contacts:read': true, 'contacts:create': false, 'contacts:edit': false, 'contacts:delete': false, 'contacts:export': false,
  'contact_groups:read': true, 'contact_groups:manage': false,
  'opportunities:read': false, 'opportunities:create': false, 'opportunities:edit': false, 'opportunities:delete': false,
  'tags:view': true, 'tags:manage': false,
  'automation:view': true, 'automation:manage': false,
  'automation_templates:read': true, 'automation_templates:manage': false,
  'whatsapp_automation:read': false, 'whatsapp_automation:manage': false,
  'assignment_rules:view': false, 'assignment_rules:manage': false,
  'routing:view': false, 'routing:manage': false,
  'whatsapp_flows:view': false, 'whatsapp_flows:manage': false,
  'inbox:view_all': true, 'inbox:send': true, 'inbox:assign': false,
  'fields:view': true, 'fields:manage': false,
  'staff:view': true, 'staff:manage': false,
  'settings:manage': false, 'settings:company': false, 'settings:branding': false, 'settings:security': false,
  'calendar:manage': false, 'calendar:view': true, 'pipeline:manage': false,
  'integrations:view': true, 'integrations:manage': false,
  'calls:view_all': false, 'calls:view_own': true, 'calls:recordings': false,
};

// Reserved key (inside the permissions JSON) recording the admin's explicit choice
// of access type. It is NEVER a permission — the resolver only reads specific
// permission keys (permissions->>$key), so this is ignored by access checks.
const ACCESS_KEY = '_access_type';

// Server-side "is this full access?" — compares stored perms to the canonical
// FULL_PERMISSIONS (the source of truth lives here), so the frontend never has to
// guess and key-set drift cannot cause a wrong answer. Used only as a fallback for
// legacy rows saved before the explicit marker existed.
function isFullPerms(p: Record<string, any> | null | undefined): boolean {
  if (!p) return false;
  return Object.keys(FULL_PERMISSIONS).every((k) => (p[k] ?? false) === FULL_PERMISSIONS[k]);
}

async function sendInviteEmail(to: string, token: string, tenantId: string) {
  try {
    const frontendUrl = await getTenantFrontendUrl(tenantId);
    const { fromName, replyTo } = await getTenantEmailIdentity(tenantId);
    const brand = fromName || 'DigyGo CRM';
    const link = `${frontendUrl}/accept-invite?token=${token}`;
    await sendEmail({
      to,
      subject: `You've been invited to ${brand}`,
      fromName,
      replyTo,
      tenantId,
      html: `<p>You've been invited to join your team on <strong>${brand}</strong>.</p>
             <p><a href="${link}">Click here to set your password and get started</a></p>
             <p>This link expires in 48 hours.</p>`,
    });
  } catch (err) {
    console.error('Failed to send invite email:', err);
  }
}

const router = Router();
router.use(requireAuth);
router.use(requireTenant); // super_admin must impersonate to access tenant settings (#44)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT cs.*,
              t.name        AS workspace_name,
              t.logo_url,
              t.email       AS tenant_email,
              t.phone       AS tenant_phone,
              t.address     AS tenant_address,
              t.plan,
              t.created_at  AS tenant_created_at,
              u.name        AS owner_name,
              u.email       AS owner_email
       FROM company_settings cs
       JOIN tenants t ON t.id = cs.tenant_id
       LEFT JOIN users u ON u.tenant_id = t.id AND u.is_owner = TRUE AND u.is_active = TRUE
       WHERE cs.tenant_id = $1`,
      [req.user!.tenantId]
    );
    res.json(result.rows[0] ?? {});
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/', checkAnyPermission('settings:manage','settings:company'), async (req: AuthRequest, res: Response) => {
  const { workspace_name, legal_name, website, phone, address, industry, timezone, currency, date_format, logo_url } = req.body;
  try {
    await query(
      `UPDATE company_settings SET legal_name=$1,website=$2,phone=$3,address=$4,
       industry=$5,timezone=$6,currency=$7,date_format=$8,updated_at=NOW()
       WHERE tenant_id=$9`,
      [legal_name, website, phone, address, industry, timezone, currency, date_format, req.user!.tenantId]
    );
    if (workspace_name || logo_url !== undefined) {
      const updates: string[] = [];
      const params: any[] = [];
      if (workspace_name) { params.push(workspace_name); updates.push(`name=$${params.length}`); }
      if (logo_url !== undefined) { params.push(logo_url); updates.push(`logo_url=$${params.length}`); }
      if (updates.length) {
        params.push(req.user!.tenantId);
        await query(`UPDATE tenants SET ${updates.join(',')} WHERE id=$${params.length}`, params);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Branding (tenant self-service) ────────────────────────────────────────────

// GET /api/settings/branding — current tenant's branding
router.get('/branding', async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT name, logo_url, favicon_url, banner_url, brand_color, login_bg_color, tab_title, app_bg_color, accent_color
       FROM tenants WHERE id=$1`,
      [req.user!.tenantId]
    );
    const t = r.rows[0] ?? {};
    res.json({
      name:         t.name ?? '',
      logoUrl:      t.logo_url ?? null,
      faviconUrl:   t.favicon_url ?? null,
      bannerUrl:    t.banner_url ?? null,
      brandColor:   t.brand_color ?? '#c2410c',
      loginBgColor: t.login_bg_color ?? null,
      tabTitle:     t.tab_title ?? null,
      appBgColor:   t.app_bg_color ?? null,
      accentColor:  t.accent_color ?? null,
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/settings/branding — update current tenant's branding
router.put('/branding', checkAnyPermission('settings:manage','settings:branding'), async (req: AuthRequest, res: Response) => {
  const { name, logo_url, favicon_url, banner_url, brand_color, login_bg_color, tab_title, app_bg_color, accent_color } = req.body;
  const updates: string[] = [];
  const params: any[] = [];
  if (name !== undefined)         { params.push(name || 'CRM');             updates.push(`name=$${params.length}`); }
  if (logo_url !== undefined)     { params.push(logo_url || null);          updates.push(`logo_url=$${params.length}`); }
  if (favicon_url !== undefined)  { params.push(favicon_url || null);       updates.push(`favicon_url=$${params.length}`); }
  if (banner_url !== undefined)   { params.push(banner_url || null);        updates.push(`banner_url=$${params.length}`); }
  if (brand_color !== undefined)  { params.push(brand_color || '#c2410c');  updates.push(`brand_color=$${params.length}`); }
  if (login_bg_color !== undefined) { params.push(login_bg_color || null);  updates.push(`login_bg_color=$${params.length}`); }
  if (tab_title !== undefined)    { params.push(tab_title || null);         updates.push(`tab_title=$${params.length}`); }
  if (app_bg_color !== undefined) { params.push(app_bg_color || null);      updates.push(`app_bg_color=$${params.length}`); }
  if (accent_color !== undefined) { params.push(accent_color || null);      updates.push(`accent_color=$${params.length}`); }
  if (!updates.length) { res.status(400).json({ error: 'No fields to update' }); return; }
  params.push(req.user!.tenantId);
  try {
    await query(`UPDATE tenants SET ${updates.join(',')} WHERE id=$${params.length}`, params);
    // Invalidate domain cache so custom-domain branding reflects immediately
    const dr = await query('SELECT custom_domain FROM tenants WHERE id=$1', [req.user!.tenantId]);
    const domain = dr.rows[0]?.custom_domain;
    if (domain) { try { const { invalidateDomainCache } = await import('../utils/domainCache'); invalidateDomainCache(domain); } catch {} }
    res.json({ success: true });
  } catch (err) { console.error('[branding update]', err); res.status(500).json({ error: 'Server error' }); }
});

// ── Security (2FA toggle) ─────────────────────────────────────────────────────

// GET /api/settings/security — current tenant's security settings
router.get('/security', async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT two_factor_enabled FROM tenants WHERE id=$1', [req.user!.tenantId]);
    res.json({ twoFactorEnabled: r.rows[0]?.two_factor_enabled === true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/settings/security — toggle email-OTP 2FA for the whole tenant
router.put('/security', checkAnyPermission('settings:manage','settings:security'), async (req: AuthRequest, res: Response) => {
  const enabled = req.body?.two_factor_enabled === true;
  try {
    await query('UPDATE tenants SET two_factor_enabled=$1 WHERE id=$2', [enabled, req.user!.tenantId]);
    res.json({ success: true, twoFactorEnabled: enabled });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/settings/staff — no permission guard: every tenant member needs this to display assignee names
router.get('/staff', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, email, role, avatar_url, is_active, phone, staff_id, created_at,
              (login_pin_hash IS NOT NULL) AS has_login_pin
       FROM users WHERE tenant_id=$1 AND is_owner IS NOT TRUE ORDER BY created_at ASC`,
      [req.user!.tenantId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/settings/staff
router.post('/staff', checkPermission('staff:manage'), checkUsage('staff'), async (req: AuthRequest, res: Response) => {
  const bcrypt = await import('bcryptjs');
  // full_access=true → all permissions granted; false → read-only custom defaults
  const { name, email, password, full_access = true, phone, login_pin } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: 'name and email required' }); return;
  }
  if (login_pin !== undefined && login_pin !== '' && login_pin !== null && !/^\d{4}$/.test(String(login_pin))) {
    res.status(400).json({ error: 'Login PIN must be 4 digits' }); return;
  }
  try {
    // Always create an invite token when an email is present, so the new staff
    // can set their own password via the invite link. A password is optional —
    // if the admin provides one the account also works immediately.
    let hash = '$invite$';
    const invite_token = crypto.randomBytes(32).toString('hex');
    const invite_expires_at = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const password_set = !!password;

    if (password) hash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role, invite_token, invite_expires_at, password_set, phone)
       VALUES ($1,$2,$3,$4,'staff',$5,$6,$7,$8) RETURNING id, name, email, role, invite_token`,
      [req.user!.tenantId, name, email.toLowerCase().trim(), hash, invite_token, invite_expires_at, password_set, phone ?? null]
    );
    const user = result.rows[0];

    // Auto-create user_permissions so the user can log in immediately
    const perms = full_access
      ? { ...FULL_PERMISSIONS, [ACCESS_KEY]: 'full' }
      : { ...CUSTOM_DEFAULT_PERMISSIONS, [ACCESS_KEY]: 'custom' };
    await query(
      `INSERT INTO user_permissions (user_id, tenant_id, permissions)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id, req.user!.tenantId, JSON.stringify(perms)]
    );

    // Optional admin-set login PIN (used at 2FA login alongside the emailed PIN)
    if (login_pin && /^\d{4}$/.test(String(login_pin))) {
      const pinHash = await bcrypt.hash(String(login_pin), 10);
      await query(
        `UPDATE users SET login_pin_hash=$1, login_pin_set_by=$2, login_pin_set_at=NOW(),
           login_pin_attempts=0, login_pin_locked_until=NULL WHERE id=$3 AND tenant_id=$4`,
        [pinHash, req.user!.userId, user.id, req.user!.tenantId]
      );
    }

    // Auto-send the invitation email to the new staff member
    const tenantId = req.user!.tenantId!;
    setImmediate(() => sendInviteEmail(email.toLowerCase().trim(), invite_token, tenantId));

    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
    setImmediate(() => incrementUsage(req.user!.tenantId!, 'staff').catch(() => null));
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'Email already exists' }); }
    else { res.status(500).json({ error: 'Server error' }); }
  }
});

// POST /api/settings/staff/:id/resend-invite
router.post('/staff/:id/resend-invite', checkPermission('staff:manage'), async (req: AuthRequest, res: Response) => {
  try {
    const invite_token = crypto.randomBytes(32).toString('hex');
    const invite_expires_at = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const result = await query(
      `UPDATE users SET invite_token=$1, invite_expires_at=$2, password_set=FALSE
       WHERE id=$3 AND tenant_id=$4 RETURNING email`,
      [invite_token, invite_expires_at, req.params.id, req.user!.tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    const tenantId = req.user!.tenantId!;
    const emailAddr = result.rows[0].email;
    setImmediate(() => sendInviteEmail(emailAddr, invite_token, tenantId));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/settings/staff/:id
router.patch('/staff/:id', checkPermission('staff:manage'), async (req: AuthRequest, res: Response) => {
  const bcrypt = await import('bcryptjs');
  const { name, email, role, is_active, password, phone, staff_id, login_pin } = req.body;
  if (login_pin !== undefined && login_pin !== '' && login_pin !== null && !/^\d{4}$/.test(String(login_pin))) {
    res.status(400).json({ error: 'Login PIN must be 4 digits' }); return;
  }

  // Prevent staff from modifying the business owner account
  try {
    const ownerCheck = await query(
      `SELECT role FROM users WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.user!.tenantId]
    );
    if (!ownerCheck.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    if (ownerCheck.rows[0].role === 'owner') {
      res.status(403).json({ error: 'Cannot modify the business owner account' }); return;
    }
  } catch (err) { res.status(500).json({ error: 'Server error' }); return; }

  const updates: string[] = [];
  const params: any[] = [];
  if (name !== undefined)      { params.push(name);                          updates.push(`name=$${params.length}`); }
  if (email !== undefined)     { params.push(email.toLowerCase().trim());    updates.push(`email=$${params.length}`); }
  if (role !== undefined)      { params.push(role);                          updates.push(`role=$${params.length}`); }
  if (is_active !== undefined) { params.push(is_active);                     updates.push(`is_active=$${params.length}`); }
  if (phone !== undefined)     { params.push(phone || null);                 updates.push(`phone=$${params.length}`); }
  if (staff_id !== undefined)  { params.push(staff_id?.trim() || null);      updates.push(`staff_id=$${params.length}`); }
  if (password)                {
    const hash = await bcrypt.hash(password, 10);
    params.push(hash);   updates.push(`password_hash=$${params.length}`);
    params.push(true);   updates.push(`password_set=$${params.length}`);
  }
  // Login PIN: 4-digit string sets it; empty string / null clears it; undefined = no change
  if (login_pin !== undefined) {
    if (login_pin === '' || login_pin === null) {
      updates.push(`login_pin_hash=NULL`);
      updates.push(`login_pin_set_by=NULL`);
      updates.push(`login_pin_set_at=NULL`);
      updates.push(`login_pin_attempts=0`);
      updates.push(`login_pin_locked_until=NULL`);
    } else {
      const pinHash = await bcrypt.hash(String(login_pin), 10);
      params.push(pinHash);            updates.push(`login_pin_hash=$${params.length}`);
      params.push(req.user!.userId);   updates.push(`login_pin_set_by=$${params.length}`);
      updates.push(`login_pin_set_at=NOW()`);
      updates.push(`login_pin_attempts=0`);
      updates.push(`login_pin_locked_until=NULL`);
    }
  }
  // Revoking access: wipe refresh tokens so the session ends immediately (#59)
  if (is_active === false) {
    updates.push(`refresh_token_hash=NULL`);
    updates.push(`refresh_token_prefix=NULL`);
  }
  if (!updates.length) { res.status(400).json({ error: 'No fields to update' }); return; }
  params.push(req.params.id, req.user!.tenantId);
  try {
    const result = await query(
      `UPDATE users SET ${updates.join(',')} WHERE id=$${params.length-1} AND tenant_id=$${params.length} RETURNING id,name,email,role,is_active`,
      params
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    // Audit: password reset by admin (#48)
    if (password) {
      query(
        `INSERT INTO audit_log (actor_id, target_tenant_id, target_user_id, action, metadata)
         VALUES ($1,$2,$3,'password_reset_by_admin',$4)`,
        [req.user!.userId, req.user!.tenantId, req.params.id, JSON.stringify({ by: req.user!.userId })]
      ).catch(() => {});
    }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/settings/staff/permissions (must be before /staff/:id)
router.get('/staff/permissions', checkPermission('staff:view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT role, permissions FROM role_permissions WHERE tenant_id=$1`,
      [req.user!.tenantId]
    );
    const perms: Record<string, any> = {};
    for (const row of result.rows) { perms[row.role] = row.permissions; }
    res.json(perms);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/settings/staff/permissions (must be before /staff/:id)
router.put('/staff/permissions', checkPermission('staff:manage'), async (req: AuthRequest, res: Response) => {
  const { role, permissions } = req.body as { role: string; permissions: Record<string, any> };
  if (!role || !permissions) { res.status(400).json({ error: 'role and permissions required' }); return; }
  try {
    await query(
      `INSERT INTO role_permissions (tenant_id, role, permissions)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, role) DO UPDATE SET permissions=$3, updated_at=NOW()`,
      [req.user!.tenantId, role, JSON.stringify(permissions)]
    );
    // Audit log for role-level permission change (#6)
    query(
      `INSERT INTO audit_log (actor_id, target_tenant_id, action, metadata)
       VALUES ($1,$2,'update_role_permissions',$3)`,
      [req.user!.userId, req.user!.tenantId, JSON.stringify({ role, permissions })]
    ).catch(() => {});
    // Invalidate cache and notify every affected user in real-time
    const affected = await query(
      `SELECT id FROM users WHERE tenant_id=$1 AND role=$2`,
      [req.user!.tenantId, role]
    );
    for (const row of affected.rows) {
      clearUserPermCache(row.id, req.user!.tenantId);
      emitToUser(row.id, 'permissions_updated', {});
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/settings/staff/:id/permissions
router.get('/staff/:id/permissions', checkPermission('staff:view'), async (req: AuthRequest, res: Response) => {
  try {
    const userRow = await query(
      `SELECT up.permissions
       FROM users u
       LEFT JOIN user_permissions up ON up.user_id = u.id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [req.params.id, req.user!.tenantId]
    );
    if (!userRow.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    const stored = userRow.rows[0].permissions as Record<string, any> | null;
    if (stored) {
      const { [ACCESS_KEY]: storedType, ...clean } = stored;
      const accessType = (storedType === 'full' || storedType === 'custom')
        ? storedType
        : (isFullPerms(clean) ? 'full' : 'custom'); // fallback for legacy rows
      res.json({ permissions: clean, access_type: accessType, has_custom: true });
    } else {
      // No row = no access (the resolver returns false for every key). Reflect that
      // honestly as an empty custom config instead of a misleading "full access".
      res.json({ permissions: {}, access_type: 'custom', has_custom: false });
    }
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/settings/staff/:id/permissions
router.put('/staff/:id/permissions', checkPermission('staff:manage'), async (req: AuthRequest, res: Response) => {
  const { permissions } = req.body as { permissions: Record<string, boolean> };
  if (!permissions || typeof permissions !== 'object') {
    res.status(400).json({ error: 'permissions object required' }); return;
  }

  // Enforce mutual exclusion: only_assigned and leads:view_all cannot both be true.
  const sanitized = { ...permissions };
  delete (sanitized as any)[ACCESS_KEY]; // never trust an incoming marker
  if (sanitized['leads:only_assigned'] && sanitized['leads:view_all']) {
    sanitized['leads:view_all'] = false;
  }
  // This endpoint is the explicit "Custom" save.
  (sanitized as any)[ACCESS_KEY] = 'custom';

  try {
    const check = await query(
      `SELECT id, role FROM users WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.user!.tenantId]
    );
    if (!check.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    if (check.rows[0].role === 'owner') {
      res.status(403).json({ error: 'Cannot edit permissions for the business owner' }); return;
    }

    await query(
      `INSERT INTO user_permissions (user_id, tenant_id, permissions, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (user_id) DO UPDATE SET permissions=$3, updated_at=NOW()`,
      [req.params.id, req.user!.tenantId, JSON.stringify(sanitized)]
    );
    // Audit log for user-level permission override (#6)
    query(
      `INSERT INTO audit_log (actor_id, target_tenant_id, target_user_id, action, metadata)
       VALUES ($1,$2,$3,'update_user_permissions',$4)`,
      [req.user!.userId, req.user!.tenantId, req.params.id, JSON.stringify({ permissions: sanitized })]
    ).catch(() => {});
    clearUserPermCache(req.params.id, req.user!.tenantId);
    emitToUser(req.params.id, 'permissions_updated', {});
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/settings/staff/:id/permissions — reset to full access
router.delete('/staff/:id/permissions', checkPermission('staff:manage'), async (req: AuthRequest, res: Response) => {
  try {
    const ownerCheck = await query(
      `SELECT role FROM users WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.user!.tenantId]
    );
    if (!ownerCheck.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    if (ownerCheck.rows[0].role === 'owner') {
      res.status(403).json({ error: 'Cannot modify permissions for the business owner' }); return;
    }
    await query(
      `INSERT INTO user_permissions (user_id, tenant_id, permissions)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET permissions=$3, updated_at=NOW()`,
      [req.params.id, req.user!.tenantId, JSON.stringify({ ...FULL_PERMISSIONS, [ACCESS_KEY]: 'full' })]
    );
    clearUserPermCache(req.params.id, req.user!.tenantId);
    emitToUser(req.params.id, 'permissions_updated', {});
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/settings/staff/:id — deactivate + revoke active session (#59)
router.delete('/staff/:id', checkPermission('staff:manage'), async (req: AuthRequest, res: Response) => {
  try {
    const staffRow = await query(
      `SELECT id, name, role FROM users WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, req.user!.tenantId]
    );
    if (!staffRow.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    if (staffRow.rows[0].role === 'owner') {
      res.status(403).json({ error: 'Cannot delete the business owner account' }); return;
    }
    if (req.params.id === req.user!.userId) {
      res.status(403).json({ error: 'You cannot delete your own account' }); return;
    }
    // Unassign all leads belonging to this staff member
    await query(
      `UPDATE leads SET assigned_to=NULL, updated_at=NOW()
       WHERE assigned_to=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, req.user!.tenantId]
    );
    // Delete permissions row
    await query(`DELETE FROM user_permissions WHERE user_id=$1::uuid`, [req.params.id]);
    // Hard-delete the user
    await query(
      `DELETE FROM users WHERE id=$1::uuid AND tenant_id=$2::uuid`,
      [req.params.id, req.user!.tenantId]
    );
    query(
      `INSERT INTO audit_log (actor_id, target_tenant_id, target_user_id, action)
       VALUES ($1,$2,$3,'delete_staff')`,
      [req.user!.userId, req.user!.tenantId, req.params.id]
    ).catch(() => {});
    decrementUsage(req.user!.tenantId!, 'staff').catch(() => null);
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /staff/:id]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/settings/staff/:id/revoke-session — force logout without deactivating (#7)
router.post('/staff/:id/revoke-session', checkPermission('staff:manage'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `UPDATE users
         SET refresh_token_hash=NULL, refresh_token_prefix=NULL
       WHERE id=$1 AND tenant_id=$2
       RETURNING id`,
      [req.params.id, req.user!.tenantId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    query(
      `INSERT INTO audit_log (actor_id, target_tenant_id, target_user_id, action)
       VALUES ($1,$2,$3,'revoke_session')`,
      [req.user!.userId, req.user!.tenantId, req.params.id]
    ).catch(() => {});
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/notifications
router.get('/notifications-feed', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM notifications WHERE tenant_id=$1 AND (user_id=$2 OR user_id IS NULL)
       ORDER BY created_at DESC LIMIT 50`,
      [req.user!.tenantId, req.user!.userId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/settings/notifications-feed/:id/read
router.patch('/notifications-feed/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    await query(
      `UPDATE notifications SET is_read=TRUE WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.user!.tenantId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/settings/notifications-feed/read-all
router.post('/notifications-feed/read-all', async (req: AuthRequest, res: Response) => {
  try {
    await query(
      `UPDATE notifications SET is_read=TRUE WHERE tenant_id=$1 AND (user_id=$2 OR user_id IS NULL)`,
      [req.user!.tenantId, req.user!.userId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/settings/notifications
router.get('/notifications', async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT prefs FROM notification_preferences WHERE user_id=$1',
      [req.user!.userId]
    );
    res.json(result.rows[0]?.prefs ?? {});
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/settings/notifications
router.put('/notifications', async (req: AuthRequest, res: Response) => {
  const prefs = req.body;
  if (typeof prefs !== 'object') { res.status(400).json({ error: 'prefs object required' }); return; }
  try {
    await query(
      `INSERT INTO notification_preferences (user_id, tenant_id, prefs)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET prefs=$3, updated_at=NOW()`,
      [req.user!.userId, req.user!.tenantId, JSON.stringify(prefs)]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/settings/webhook-url — returns the tenant's inbound webhook URL for external integrations
router.get('/webhook-url', async (req: AuthRequest, res: Response) => {
  const tenantId = req.user!.tenantId;
  const base = (process.env.WEBHOOK_BASE_URL ?? '').replace(/\/$/, '');
  res.json({
    webhookInbound:  `${base}/api/public/webhook-inbound/${tenantId}`,
    paymentReceived: `${base}/api/public/trigger/payment/${tenantId}`,
    courseEnrolled:  `${base}/api/public/trigger/course/${tenantId}`,
  });
});

export default router;
