import React, { useState, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Plus, Pencil, ShieldCheck, User, X, Check, MoreHorizontal,
  Mail, UserMinus, UserCheck, Upload, ChevronDown, Eye, EyeOff, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCrmStore } from '@/store/crmStore';
import { StaffMember } from '@/data/mockData';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { usePermission } from '@/hooks/usePermission';

// ── Permission group types ───────────────────────────────────────────────────

type FlatItem  = { key: string; label: string };
type SimpleRow = { label: string; keys: FlatItem[] };
type CrudRow   = { label: string; keys: (string | null)[] };
type FlatGroup = { type: 'flat'; label: string; items: FlatItem[] };
type CrudGroup = {
  type: 'crud'; label: string;
  columns: string[];
  rows: CrudRow[];
  simpleRows?: SimpleRow[];
};
type PermGroup = FlatGroup | CrudGroup;

const ONLY_ASSIGNED_KEY = 'leads:only_assigned';
const MASK_PHONE_KEY    = 'leads:mask_phone';

const PERM_GROUPS: PermGroup[] = [
  {
    type: 'flat',
    label: 'Dashboard Stats',
    items: [
      { key: 'dashboard:total_leads',   label: 'Total Leads' },
      { key: 'dashboard:active_staff',  label: 'Active Staff' },
      { key: 'dashboard:conversations', label: 'Conversations' },
      { key: 'dashboard:appointments',  label: 'Appointments' },
    ],
  },
  {
    type: 'crud',
    label: 'Lead Generation',
    columns: ['Read', 'Create', 'Edit', 'Delete'],
    rows: [
      { label: 'Meta Forms',    keys: ['meta_forms:read',    'meta_forms:create',    'meta_forms:edit',    'meta_forms:delete'] },
      { label: 'Custom Forms',  keys: ['custom_forms:read',  'custom_forms:create',  'custom_forms:edit',  'custom_forms:delete'] },
      { label: 'Landing Pages', keys: ['landing_pages:read', 'landing_pages:create', 'landing_pages:edit', 'landing_pages:delete'] },
    ],
    simpleRows: [
      { label: 'WhatsApp Setup', keys: [{ key: 'whatsapp_setup:read', label: 'Read' }, { key: 'whatsapp_setup:manage', label: 'Manage' }] },
    ],
  },
  {
    type: 'crud',
    label: 'Lead Management',
    columns: ['Read', 'Create', 'Edit', 'Delete'],
    rows: [
      { label: 'Leads', keys: ['leads:view_all', 'leads:create', 'leads:edit', 'leads:delete'] },
      { label: 'Contacts', keys: ['contacts:read',  'contacts:create', 'contacts:edit', 'contacts:delete'] },
      { label: 'Opportunities', keys: ['opportunities:read', 'opportunities:create', 'opportunities:edit', 'opportunities:delete'] },
    ],
    simpleRows: [
      { label: 'Contact Groups', keys: [{ key: 'contact_groups:read', label: 'Read' }, { key: 'contact_groups:manage', label: 'Manage' }] },
      { label: 'Tags',           keys: [{ key: 'tags:view', label: 'View' }, { key: 'tags:manage', label: 'Manage' }] },
      { label: 'Follow-ups',     keys: [{ key: 'followups:view', label: 'View' }] },
      { label: 'Assignment',     keys: [{ key: 'leads:assign', label: 'Assign / Reassign Leads' }] },
      { label: 'Export',         keys: [{ key: 'leads:export', label: 'Export Leads' }, { key: 'contacts:export', label: 'Export Contacts' }] },
    ],
  },
  {
    type: 'flat',
    label: 'Automation',
    items: [
      { key: 'automation:view',               label: 'View Workflows' },
      { key: 'automation:manage',             label: 'Manage Workflows' },
      { key: 'automation_templates:read',     label: 'View Templates' },
      { key: 'automation_templates:manage',   label: 'Manage Templates' },
      { key: 'whatsapp_automation:read',      label: 'View WA Automation' },
      { key: 'whatsapp_automation:manage',    label: 'Manage WA Automation' },
      { key: 'assignment_rules:view',         label: 'View Assignment Rules' },
      { key: 'assignment_rules:manage',       label: 'Manage Assignment Rules' },
      { key: 'routing:view',                  label: 'View Routing' },
      { key: 'routing:manage',                label: 'Manage Routing' },
      { key: 'whatsapp_flows:view',           label: 'View WhatsApp Flows' },
      { key: 'whatsapp_flows:manage',         label: 'Manage WhatsApp Flows' },
    ],
  },
  {
    type: 'flat',
    label: 'Communications',
    items: [
      { key: 'inbox:view_all', label: 'View All Conversations' },
      { key: 'inbox:send',     label: 'Send Messages' },
      { key: 'inbox:assign',   label: 'Assign Conversations' },
    ],
  },
  {
    type: 'flat',
    label: 'Calls',
    items: [
      { key: 'calls:view_own', label: 'View Own Calls' },
      { key: 'calls:view_all', label: 'View All Calls' },
      { key: 'calls:recordings', label: 'Call Recordings' },
    ],
  },
  {
    type: 'flat',
    label: 'Administration',
    items: [
      { key: 'fields:view',        label: 'View Fields' },
      { key: 'fields:manage',      label: 'Manage Fields' },
      { key: 'staff:view',         label: 'View Staff' },
      { key: 'staff:manage',       label: 'Manage Staff' },
      { key: 'settings:manage',    label: 'Manage Settings (all)' },
      { key: 'settings:company',   label: 'Company Settings' },
      { key: 'settings:branding',  label: 'Branding' },
      { key: 'settings:security',  label: 'Security' },
      { key: 'calendar:view',      label: 'View Calendar' },
      { key: 'calendar:manage',    label: 'Manage Calendar' },
      { key: 'pipeline:view',      label: 'View Pipelines' },
      { key: 'pipeline:manage',    label: 'Manage Pipelines' },
      { key: 'integrations:view',  label: 'View Integrations' },
      { key: 'integrations:manage', label: 'Manage Integrations' },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getGroupKeys(group: PermGroup): string[] {
  if (group.type === 'flat') return group.items.map((i) => i.key);
  const keys: string[] = [];
  for (const row of group.rows) keys.push(...(row.keys.filter(Boolean) as string[]));
  for (const row of group.simpleRows ?? []) keys.push(...row.keys.map((k) => k.key));
  return keys;
}

function getAllPermKeys(): string[] {
  return [ONLY_ASSIGNED_KEY, MASK_PHONE_KEY, ...PERM_GROUPS.flatMap(getGroupKeys)];
}

const FULL_ACCESS_EXCLUDED = new Set([ONLY_ASSIGNED_KEY, MASK_PHONE_KEY]);
const CUSTOM_DEFAULTS = new Set([
  'dashboard:total_leads',
  'meta_forms:read', 'custom_forms:read', 'landing_pages:read', 'whatsapp_setup:read',
  'leads:view_all', 'leads:create', 'leads:edit', 'leads:view_own',
  'contacts:read', 'contact_groups:read', 'tags:view', 'followups:view', 'pipeline:view', 'calendar:view',
  'automation:view', 'automation_templates:read',
  'inbox:view_all', 'inbox:send',
  'calls:view_own',
  'fields:view', 'staff:view',
]);

const buildDefaultPerms = (full_access: boolean): Record<string, boolean> => {
  const result: Record<string, boolean> = {};
  for (const key of getAllPermKeys()) {
    if (full_access) {
      result[key] = !FULL_ACCESS_EXCLUDED.has(key);
    } else {
      result[key] = CUSTOM_DEFAULTS.has(key);
    }
  }
  return result;
};

// ── Invite / Edit Staff Modal ──────────────────────────────────────────────────

interface StaffModalProps {
  initial?: StaffMember | null;
  onClose: () => void;
  onSave: (data: { name: string; email: string; full_access: boolean; password?: string; phone?: string; staff_id?: string; login_pin?: string }) => void;
}

const COUNTRY_CODES = [
  { flag: '🇮🇳', code: '+91', country: 'IN' },
  { flag: '🇺🇸', code: '+1',  country: 'US' },
  { flag: '🇬🇧', code: '+44', country: 'GB' },
  { flag: '🇦🇪', code: '+971', country: 'AE' },
  { flag: '🇸🇬', code: '+65', country: 'SG' },
];

function StaffModal({ initial, onClose, onSave }: StaffModalProps) {
  const isEdit = !!initial;
  const [firstName,  setFirstName]  = useState(initial ? initial.name.split(' ')[0] : '');
  const [lastName,   setLastName]   = useState(initial ? initial.name.split(' ').slice(1).join(' ') : '');
  const [email,      setEmail]      = useState(initial?.email ?? '');
  const [fullAccess, setFullAccess] = useState(true);
  const [phone,      setPhone]      = useState(initial?.phone ?? '');
  const [password,   setPassword]   = useState('');
  const [countryCode, setCountryCode] = useState(COUNTRY_CODES[0]);
  const [showCountryDrop, setShowCountryDrop] = useState(false);
  const [staffId,       setStaffId]      = useState(initial?.staff_id ?? '');
  const [avatarUrl,     setAvatarUrl]    = useState<string | null>(null);
  const [errors,        setErrors]       = useState<Record<string, string>>({});
  const [showPassword,  setShowPassword] = useState(false);
  const [loginPin,      setLoginPin]     = useState('');
  const [clearPin,      setClearPin]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = 'Required';
    if (!lastName.trim())  e.lastName  = 'Required';
    if (!email.trim() || !email.includes('@')) e.email = 'Valid email required';
    if (loginPin && !/^\d{4}$/.test(loginPin)) e.loginPin = 'PIN must be 4 digits';
    // Password is OPTIONAL on create — if left blank, the staff gets an invite email to set their own.
    return e;
  };

  const handleSave = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const fullPhone = phone.trim() ? `${countryCode.code}${phone.trim()}` : undefined;
    onSave({
      name: `${firstName.trim()} ${lastName.trim()}`,
      email: email.trim(),
      full_access: fullAccess,
      ...(password.trim() ? { password: password.trim() } : {}),
      ...(fullPhone ? { phone: fullPhone } : {}),
      ...(staffId.trim() ? { staff_id: staffId.trim() } : { staff_id: '' }),
      ...(loginPin.trim() ? { login_pin: loginPin.trim() } : clearPin ? { login_pin: '' } : {}),
    });
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarUrl(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const iCls = (err?: string) =>
    cn('w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none transition-all placeholder:text-[#b09e8d]',
      err ? 'border-red-400 ring-2 ring-red-100' : 'border-[#e8ddd4] focus:border-primary focus:ring-2 focus:ring-primary/10');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-[#f9f5f0] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-[#ede6dd]">
          <div>
            <h3 className="font-headline font-bold text-[#1c1410] text-base">
              {isEdit ? 'Edit Staff Member' : 'Add Staff Member'}
            </h3>
            <p className="text-[11px] text-[#7a6b5c]">
              {isEdit ? 'Update details or change access password' : 'Staff will log in using email + password below'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] transition-colors">
            <X className="w-4 h-4 text-[#7a6b5c]" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">First Name <span className="text-red-500">*</span></label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="e.g. Ranjith" className={iCls(errors.firstName)} />
              {errors.firstName && <p className="text-[10px] text-red-500 mt-0.5">{errors.firstName}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Last Name <span className="text-red-500">*</span></label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="e.g. Kumar" className={iCls(errors.lastName)} />
              {errors.lastName && <p className="text-[10px] text-red-500 mt-0.5">{errors.lastName}</p>}
            </div>
          </div>

          {/* Email + Phone row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Email <span className="text-red-500">*</span></label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="ranjith@company.com" className={iCls(errors.email)} />
              {errors.email && <p className="text-[10px] text-red-500 mt-0.5">{errors.email}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Phone</label>
              <div className={cn('flex items-center rounded-xl border bg-white overflow-hidden transition-all',
                'border-[#e8ddd4] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10')}>
                <div className="relative">
                  <button type="button" onClick={() => setShowCountryDrop(!showCountryDrop)}
                    className="flex items-center gap-1 px-2 py-2 border-r border-[#e8ddd4] hover:bg-[var(--accent-tint)] text-xs text-[#7a6b5c]">
                    <span>{countryCode.flag}</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {showCountryDrop && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowCountryDrop(false)} />
                      <div className="absolute top-full left-0 mt-1 bg-white border border-[#e8ddd4] rounded-xl shadow-xl z-50 py-1 w-32">
                        {COUNTRY_CODES.map((c) => (
                          <button key={c.country} type="button" onClick={() => { setCountryCode(c); setShowCountryDrop(false); }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-[var(--accent-tint)]">
                            <span>{c.flag}</span><span className="text-[#7a6b5c]">{c.code}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <span className="pl-1.5 text-xs text-[#7a6b5c] select-none">{countryCode.code}</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210"
                  className="flex-1 px-1.5 py-2 text-sm outline-none bg-transparent placeholder:text-[#b09e8d]" />
              </div>
            </div>
          </div>

          {/* Staff ID */}
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Staff ID <span className="text-[#b09e8d] font-normal">(optional — your company reference ID)</span></label>
            <input value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder="e.g. EMP-001" className={iCls()} />
          </div>

          {/* Password + Profile Image */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">
                {isEdit ? 'New Password' : 'Password'} {!isEdit && <span className="text-[#b09e8d] font-normal">(optional)</span>}
              </label>
              <div className="relative">
                <input value={password} onChange={(e) => setPassword(e.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isEdit ? 'Leave blank to keep current' : 'Leave blank to send invite'}
                  className={cn(iCls(errors.password), 'pr-9')} />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#b09e8d] hover:text-[#7a6b5c] transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password
                ? <p className="text-[10px] text-red-500 mt-0.5">{errors.password}</p>
                : <p className="text-[10px] text-[#7a6b5c] mt-0.5">{isEdit ? 'Only fill to change access' : 'Blank = email them an invite to set their own'}</p>}
            </div>
            {!isEdit && (
              <div>
                <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Access Level</label>
                <div className="flex gap-2">
                  {([true, false] as const).map((fa) => (
                    <button key={String(fa)} type="button" onClick={() => setFullAccess(fa)}
                      className={cn(
                        'flex-1 py-2 rounded-xl text-xs font-semibold border transition-all',
                        fullAccess === fa
                          ? 'border-primary bg-primary text-white'
                          : 'border-[#e8ddd4] bg-white text-[#7a6b5c] hover:border-primary/40',
                      )}>
                      {fa ? 'Full Access' : 'Custom'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#7a6b5c] mt-1">
                  {fullAccess ? 'All permissions granted — can be customised later' : 'Basic read-only defaults — edit permissions after adding'}
                </p>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Profile Image</label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full h-[38px] rounded-xl border-2 border-dashed border-[#e8ddd4] bg-white hover:border-primary/50 hover:bg-[var(--accent-tint)] transition-all flex items-center justify-center gap-1.5 text-xs text-[#7a6b5c]">
                {avatarUrl
                  ? <img src={avatarUrl} className="w-6 h-6 rounded-full object-cover" />
                  : <><Upload className="w-3.5 h-3.5" /> Upload photo</>}
              </button>
            </div>
          </div>

          {/* Login PIN (2FA) */}
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">
              Login PIN <span className="text-[#b09e8d] font-normal">(optional — used at login when 2FA is on)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                maxLength={4}
                value={loginPin}
                onChange={(e) => { setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setClearPin(false); }}
                placeholder={isEdit && initial?.has_login_pin ? '•••• (PIN set — type to change)' : '4-digit PIN'}
                className={cn(iCls(errors.loginPin), 'flex-1 tracking-[0.3em]')}
              />
              <button type="button"
                onClick={() => { setLoginPin(String(Math.floor(1000 + Math.random() * 9000))); setClearPin(false); }}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-colors whitespace-nowrap">
                Generate
              </button>
              {isEdit && initial?.has_login_pin && (
                <button type="button"
                  onClick={() => { setLoginPin(''); setClearPin(true); }}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 transition-colors whitespace-nowrap">
                  Remove
                </button>
              )}
            </div>
            {errors.loginPin
              ? <p className="text-[10px] text-red-500 mt-0.5">{errors.loginPin}</p>
              : <p className="text-[10px] text-[#7a6b5c] mt-0.5">
                  {clearPin ? 'PIN will be removed on save.' : 'Share this PIN with the staff member. They can also get a one-time PIN by email at login.'}
                </p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 bg-white border-t border-[#ede6dd]">
          <button type="button" onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-[#7a6b5c] bg-[#f0ebe5] hover:bg-[#e8ddd4] transition-colors uppercase tracking-wide">
            Cancel
          </button>
          <button type="button" onClick={handleSave}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary/90 transition-colors uppercase tracking-wide">
            <User className="w-3.5 h-3.5" />
            {isEdit ? 'Save Changes' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Deactivate Confirm ─────────────────────────────────────────────────────────

function DeactivateDialog({ member, onClose, onConfirm }: { member: StaffMember; onClose: () => void; onConfirm: () => void }) {
  const isActive = member.status === 'active';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 w-full max-w-sm shadow-2xl p-6">
        <div className={cn('w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4', isActive ? 'bg-red-100' : 'bg-green-100')}>
          {isActive ? <UserMinus className="w-5 h-5 text-destructive" /> : <UserCheck className="w-5 h-5 text-success" />}
        </div>
        <h3 className="font-headline font-bold text-[#1c1410] text-center mb-2">{isActive ? 'Deactivate' : 'Reactivate'} {member.name}?</h3>
        <p className="text-[13px] text-[#7a6b5c] text-center mb-6">
          {isActive
            ? 'This member will lose access to the CRM immediately. Their data and lead assignments will be preserved.'
            : 'This member will regain access to the CRM with their previous role and permissions.'}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant={isActive ? 'destructive' : 'default'} className="flex-1" onClick={onConfirm}>
            {isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Modal ───────────────────────────────────────────────────────

function DeleteConfirmModal({ member, onClose, onConfirm }: { member: StaffMember; onClose: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim().toLowerCase() === member.name.trim().toLowerCase();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 w-full max-w-sm shadow-2xl p-6">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <Trash2 className="w-5 h-5 text-red-600" />
        </div>
        <h3 className="font-headline font-bold text-[#1c1410] text-center mb-1">Delete {member.name}?</h3>
        <p className="text-[13px] text-[#7a6b5c] text-center mb-5">
          This will permanently remove their account and revoke all access. Their assigned leads will become unassigned. This cannot be undone.
        </p>
        <div className="mb-5">
          <p className="text-[12px] text-[#7a6b5c] mb-1.5">
            Type <span className="font-semibold text-[#1c1410]">{member.name}</span> to confirm
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={member.name}
            className="text-sm"
            autoFocus
          />
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={!confirmed}
            onClick={onConfirm}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Permissions Modal ──────────────────────────────────────────────────────────

function PermissionsModal({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const blankPerms = () => Object.fromEntries(getAllPermKeys().map((k) => [k, false]));
  const [permissions, setPermissions] = useState<Record<string, boolean>>(blankPerms);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [accessType, setAccessType] = useState<'full' | 'custom'>('custom');

  const isFullAccessPerms = (perms: Record<string, boolean>) =>
    getAllPermKeys().filter((k) => !FULL_ACCESS_EXCLUDED.has(k)).every((k) => perms[k] === true) &&
    [...FULL_ACCESS_EXCLUDED].every((k) => perms[k] === false);

  React.useEffect(() => {
    setLoading(true);
    api.get<{ permissions: Record<string, boolean>; access_type?: 'full' | 'custom' }>(`/api/settings/staff/${member.id}/permissions`)
      .then((data) => {
        const perms = { ...blankPerms(), ...(data.permissions ?? {}) };
        setPermissions(perms);
        // Trust the server's explicit access type; fall back to value-based detection
        // only for legacy responses without the field.
        setAccessType(data.access_type ?? (isFullAccessPerms(perms) ? 'full' : 'custom'));
      })
      .catch(() => { setPermissions(blankPerms()); setAccessType('custom'); })
      .finally(() => setLoading(false));
  }, [member.id]);

  const handleGrantFullAccess = async () => {
    setSaving(true);
    try {
      await api.delete(`/api/settings/staff/${member.id}/permissions`);
      const data = await api.get<{ permissions: Record<string, boolean>; access_type?: 'full' | 'custom' }>(`/api/settings/staff/${member.id}/permissions`);
      const perms = { ...blankPerms(), ...(data.permissions ?? {}) };
      setPermissions(perms);
      setAccessType(data.access_type ?? 'full');
      toast.success('Full access granted');
    } catch { toast.error('Failed to update permissions'); }
    finally { setSaving(false); }
  };

  const togglePerm = (key: string) => {
    setAccessType('custom'); // any manual edit means custom access
    setPermissions((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Mutual exclusion: only_assigned and leads:view_all cannot both be true.
      // Turning ON only_assigned → force view_all OFF (restriction wins over broad access).
      // Turning ON leads:view_all → force only_assigned OFF.
      if (key === ONLY_ASSIGNED_KEY && next[ONLY_ASSIGNED_KEY]) {
        next['leads:view_all'] = false;
      }
      if (key === 'leads:view_all' && next['leads:view_all']) {
        next[ONLY_ASSIGNED_KEY] = false;
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/api/settings/staff/${member.id}/permissions`, { permissions });
      toast.success('Permissions saved');
      onClose();
    } catch {
      toast.error('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-[#f9f5f0] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-[#ede6dd] shrink-0">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0',
              member.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {member.avatar}
            </div>
            <div>
              <h3 className="font-headline font-bold text-[#1c1410] text-[15px] leading-tight">{member.name}</h3>
              <p className="text-[11px] text-[#7a6b5c]">{member.email} · Permissions</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] transition-colors">
            <X className="w-4 h-4 text-[#7a6b5c]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="animate-spin w-6 h-6 rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="bg-white m-4 rounded-2xl border border-[#ede8e2] divide-y divide-[#f2ede8] overflow-hidden">

              {/* Access Type Toggle */}
              <div className="p-5">
                <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-widest block mb-2.5">Access Type</label>
                <div className="flex gap-2">
                  {(['full', 'custom'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        if (type === accessType) return;
                        if (type === 'full') { handleGrantFullAccess(); }
                        else { setAccessType('custom'); }
                      }}
                      className={cn(
                        'flex-1 py-2 rounded-xl text-xs font-semibold border transition-all',
                        accessType === type
                          ? 'border-primary bg-primary text-white'
                          : 'border-[#e8ddd4] bg-white text-[#7a6b5c] hover:border-primary/40 hover:bg-[#fdf5f0]',
                      )}
                    >
                      {type === 'full' ? 'Full Access' : 'Custom'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#7a6b5c] mt-1.5">
                  {accessType === 'full'
                    ? 'All permissions enabled — switch to Custom to restrict specific access.'
                    : 'Configure individual permissions below, then click Save.'}
                </p>
              </div>

              {/* Only Assigned Leads + extras */}
              <div className="p-5 space-y-4">
                <div
                  onClick={() => togglePerm(ONLY_ASSIGNED_KEY)}
                  className={cn(
                    'flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all select-none',
                    permissions[ONLY_ASSIGNED_KEY]
                      ? 'bg-orange-50 border-orange-200'
                      : 'bg-[var(--app-bg)] border-[#e8ddd4] hover:border-orange-200 hover:bg-orange-50/40',
                  )}
                >
                  <PermCheckbox checked={permissions[ONLY_ASSIGNED_KEY] ?? false} onChange={() => togglePerm(ONLY_ASSIGNED_KEY)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#1c1410]">Only Assigned Leads</p>
                    <p className="text-[11px] text-[#7a6b5c] mt-0.5 leading-relaxed">
                      Staff can only view leads assigned to them — applies to Pipeline, Contacts &amp; Automation
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between px-1">
                  <button type="button" onClick={() => togglePerm(MASK_PHONE_KEY)}
                    className="flex items-center gap-2.5 cursor-pointer select-none group">
                    <PermCheckbox checked={permissions[MASK_PHONE_KEY] ?? false} onChange={() => togglePerm(MASK_PHONE_KEY)} />
                    <span className="text-[13px] text-[#1c1410] group-hover:text-primary transition-colors">Phone Number Masking</span>
                    <span className="text-[11px] text-[#b09e8d]">— last digits hidden</span>
                  </button>
                  <button type="button"
                    onClick={() => {
                      setAccessType('custom');
                      const all = getAllPermKeys().every((k) => permissions[k]);
                      setPermissions(Object.fromEntries(getAllPermKeys().map((k) => [k, !all])));
                    }}
                    className="flex items-center gap-2.5 cursor-pointer select-none group">
                    <PermCheckbox
                      checked={getAllPermKeys().every((k) => permissions[k])}
                      onChange={() => {
                        setAccessType('custom');
                        const all = getAllPermKeys().every((k) => permissions[k]);
                        setPermissions(Object.fromEntries(getAllPermKeys().map((k) => [k, !all])));
                      }}
                    />
                    <span className="text-[13px] font-semibold text-[#1c1410] group-hover:text-primary transition-colors">Select All</span>
                  </button>
                </div>
              </div>

              {/* Permission groups */}
              {PERM_GROUPS.map((group) => {
                const groupKeys  = getGroupKeys(group);
                const allEnabled = groupKeys.length > 0 && groupKeys.every((k) => permissions[k]);
                const toggleAll  = () => {
                  setAccessType('custom');
                  const val = !allEnabled;
                  setPermissions((prev) => ({ ...prev, ...Object.fromEntries(groupKeys.map((k) => [k, val])) }));
                };
                return (
                  <div key={group.label} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-widest">{group.label}</h4>
                      <button type="button" onClick={toggleAll}
                        className="flex items-center gap-2 cursor-pointer select-none group">
                        <PermCheckbox checked={allEnabled} onChange={toggleAll} />
                        <span className="text-[11px] text-[#7a6b5c] group-hover:text-primary transition-colors">All</span>
                      </button>
                    </div>

                    {group.type === 'flat' && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2.5 gap-x-4">
                        {group.items.map((item) => (
                          <button key={item.key} type="button" onClick={() => togglePerm(item.key)}
                            className="flex items-center gap-2.5 cursor-pointer select-none group text-left">
                            <PermCheckbox checked={permissions[item.key] ?? false} onChange={() => togglePerm(item.key)} />
                            <span className="text-[13px] text-[#2c1f14] group-hover:text-primary transition-colors">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {group.type === 'crud' && (
                      <div className="overflow-x-auto -mx-1 px-1">
                        <div style={{ minWidth: 420 }}>
                          <div className="grid rounded-lg bg-[#f7f3ef] px-3 py-2 mb-1"
                            style={{ gridTemplateColumns: '1fr 80px 80px 80px 80px' }}>
                            <div />
                            {group.columns.map((col) => (
                              <div key={col} className="text-center text-[10px] font-bold text-[#9c8f84] uppercase tracking-widest">{col}</div>
                            ))}
                          </div>
                          {group.rows.map((row, i) => (
                            <div key={row.label}
                              className={cn('grid items-center px-3 py-2.5 rounded-lg transition-colors hover:bg-[var(--app-bg)]', i % 2 === 1 && 'bg-[#fdfcfb]')}
                              style={{ gridTemplateColumns: '1fr 80px 80px 80px 80px' }}>
                              <span className="text-[13px] font-medium text-[#1c1410]">{row.label}</span>
                              {row.keys.map((key, j) => (
                                <div key={j} className="flex justify-center">
                                  {key
                                    ? <PermCheckbox checked={permissions[key] ?? false} onChange={() => togglePerm(key)} />
                                    : <span className="text-[#ddd4cc] text-sm leading-none">—</span>
                                  }
                                </div>
                              ))}
                            </div>
                          ))}
                          {(group.simpleRows ?? []).length > 0 && (
                            <div className="mt-1 pt-2 border-t border-[#f0ebe5] space-y-0.5">
                              {group.simpleRows!.map((row, i) => (
                                <div key={row.label}
                                  className={cn('flex items-center px-3 py-2.5 rounded-lg transition-colors hover:bg-[var(--app-bg)]', i % 2 === 1 && 'bg-[#fdfcfb]')}>
                                  <span className="text-[13px] font-medium text-[#1c1410] flex-1">{row.label}</span>
                                  <div className="flex items-center gap-6">
                                    {row.keys.map(({ key, label }) => (
                                      <button key={key} type="button" onClick={() => togglePerm(key)}
                                        className="flex items-center gap-2 cursor-pointer select-none group">
                                        <PermCheckbox checked={permissions[key] ?? false} onChange={() => togglePerm(key)} />
                                        <span className="text-[12px] text-[#7a6b5c] group-hover:text-primary transition-colors">{label}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 bg-white border-t border-[#ede6dd] shrink-0">
          <button type="button" onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-[#7a6b5c] bg-[#f0ebe5] hover:bg-[#e8ddd4] transition-colors uppercase tracking-wide">
            Cancel
          </button>
          {accessType === 'custom' ? (
            <button type="button" onClick={handleSave} disabled={saving || loading}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-50 transition-colors uppercase tracking-wide">
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save Permissions'}
            </button>
          ) : (
            <button type="button" onClick={onClose}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary/90 transition-colors uppercase tracking-wide">
              <Check className="w-3.5 h-3.5" />
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

function mapApiStaff(r: any): StaffMember {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role === 'admin' ? 'admin' : 'staff',
    status: r.is_active ? 'active' : 'inactive',
    leadsAssigned: r.leads_assigned ?? 0,
    lastActive: r.last_active ?? r.created_at ?? new Date().toISOString(),
    avatar: r.avatar_url ?? r.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
    phone: r.phone ?? undefined,
    staff_id: r.staff_id ?? undefined,
    has_login_pin: r.has_login_pin ?? false,
  };
}

// ── Custom styled checkbox ────────────────────────────────────────────────────
function PermCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={cn(
        'w-[17px] h-[17px] rounded border-[1.5px] inline-flex items-center justify-center transition-all shrink-0 cursor-pointer',
        checked ? 'bg-[var(--brand-dark)] border-[var(--brand-dark)]' : 'border-[#c9bdb6] bg-white hover:border-[var(--brand-dark)]',
      )}
    >
      {checked && <Check className="w-[9px] h-[9px] text-white" strokeWidth={3.5} />}
    </span>
  );
}

export default function StaffPage() {
  const { staff: storeStaff, addStaff, updateStaff, deactivateStaff, removeStaff } = useCrmStore();
  const [staff, setStaff] = useState<StaffMember[]>(storeStaff);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = (searchParams.get('tab') ?? 'team') as 'team' | 'roles' | 'performance';
  const [showInviteModal, setShowInviteModal] = useState(false);
  const canManageStaff = usePermission('staff:manage');

  React.useEffect(() => {
    api.get<any[]>('/api/settings/staff')
      .then((rows) => setStaff(rows.map(mapApiStaff)))
      .catch(() => {});
  }, []);

  const [editMember,       setEditMember]       = useState<StaffMember | null>(null);
  const [deactivateMember, setDeactivateMember] = useState<StaffMember | null>(null);
  const [deleteMember,     setDeleteMember]     = useState<StaffMember | null>(null);
  const [permsMember,      setPermsMember]      = useState<StaffMember | null>(null);
  const [openMenuId,       setOpenMenuId]       = useState<string | null>(null);

  // Stable performance data — no Math.random() in render
  const perfData = useMemo(() => {
    return staff.filter((s) => s.status === 'active').map((s, i) => ({
      id: s.id,
      name: s.name,
      leadsHandled: s.leadsAssigned,
      converted: Math.floor(s.leadsAssigned * 0.3),
      avgResponse: [8, 12, 5, 22, 15, 9, 18, 11][i % 8],
      conversations: [87, 64, 110, 42, 95, 73, 58, 102][i % 8],
      followUps: [28, 19, 35, 12, 41, 22, 16, 31][i % 8],
    }));
  }, [staff]);

  const handleInvite = async (data: { name: string; email: string; full_access: boolean; password?: string; phone?: string; staff_id?: string; login_pin?: string }) => {
    try {
      const res = await api.post<{ id: string; name: string; email: string; role: string }>('/api/settings/staff', {
        name: data.name, email: data.email, full_access: data.full_access, password: data.password,
        ...(data.phone ? { phone: data.phone } : {}),
        ...(data.login_pin ? { login_pin: data.login_pin } : {}),
      });
      const initials = data.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
      const newMember: StaffMember = {
        id: res.id, name: res.name, email: res.email, role: 'staff',
        status: 'active', leadsAssigned: 0, lastActive: new Date().toISOString(), avatar: initials,
        has_login_pin: !!data.login_pin,
      };
      setStaff((prev) => [...prev, newMember]);
      addStaff(newMember);
      setShowInviteModal(false);
      const inviteNote = data.password ? '' : ' — invite email sent';
      toast.success(`${data.name} added${inviteNote}${!data.full_access ? ' — customise their permissions below' : ''}`);
      if (!data.full_access) navigate('/staff?tab=roles');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to add staff');
    }
  };

  const handleEdit = async (data: { name: string; email: string; full_access: boolean; password?: string; phone?: string; staff_id?: string; login_pin?: string }) => {
    if (!editMember) return;
    const initials = data.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
    const pinUpdate = data.login_pin !== undefined ? { has_login_pin: data.login_pin !== '' } : {};
    const updates = { name: data.name, email: data.email, avatar: initials, phone: data.phone, staff_id: data.staff_id, ...pinUpdate };
    try {
      await api.patch(`/api/settings/staff/${editMember.id}`, {
        name: data.name, email: data.email,
        ...(data.password ? { password: data.password } : {}),
        phone: data.phone ?? '',
        staff_id: data.staff_id ?? '',
        ...(data.login_pin !== undefined ? { login_pin: data.login_pin } : {}),
      });
      setStaff((prev) => prev.map((m) => m.id === editMember.id ? { ...m, ...updates } : m));
      updateStaff(editMember.id, updates);
      toast.success('Staff member updated');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update staff');
    }
    setEditMember(null);
  };

  const handleDeactivate = async () => {
    if (!deactivateMember) return;
    const newActive = deactivateMember.status !== 'active';
    try {
      await api.patch(`/api/settings/staff/${deactivateMember.id}`, { is_active: newActive });
      const newStatus = newActive ? 'active' : 'inactive';
      setStaff((prev) => prev.map((m) => m.id === deactivateMember.id ? { ...m, status: newStatus } : m));
      if (!newActive) { deactivateStaff(deactivateMember.id); toast.success(`${deactivateMember.name} deactivated`); }
      else { updateStaff(deactivateMember.id, { status: 'active' }); toast.success(`${deactivateMember.name} reactivated`); }
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update staff');
    }
    setDeactivateMember(null);
  };

  const handleDelete = async () => {
    if (!deleteMember) return;
    try {
      await api.delete(`/api/settings/staff/${deleteMember.id}`);
      setStaff((prev) => prev.filter((m) => m.id !== deleteMember.id));
      removeStaff(deleteMember.id);
      toast.success(`${deleteMember.name} has been deleted`);
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to delete staff member');
    }
    setDeleteMember(null);
  };

  return (
    <div className="space-y-6">

      {/* Team Tab */}
      {tab === 'team' && (
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-headline text-[17px] font-bold text-[#1c1410]">Team Members</h3>
              <p className="text-[12px] text-[#7a6b5c] mt-0.5">
                {staff.filter((s) => s.status === 'active').length} active
                {staff.filter((s) => s.status === 'inactive').length > 0 && ` · ${staff.filter((s) => s.status === 'inactive').length} inactive`}
              </p>
            </div>
            {canManageStaff && (
              <Button className="btn-hover shrink-0" onClick={() => setShowInviteModal(true)}>
                <Plus className="w-4 h-4 mr-1" /> New Staff
              </Button>
            )}
          </div>

          {/* Staff list */}
          {staff.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#ede8e2] flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center">
                <User className="w-6 h-6 text-[var(--brand-dark)]" />
              </div>
              <p className="text-[14px] font-bold text-[#1c1410]">No team members yet</p>
              <p className="text-[12px] text-[#7a6b5c]">Add your first staff member to get started</p>
              {canManageStaff && (
                <Button className="btn-hover mt-1" onClick={() => setShowInviteModal(true)}>
                  <Plus className="w-4 h-4 mr-1" /> New Staff
                </Button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-black/5 card-shadow divide-y divide-black/5">
              {staff.map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--app-bg)] transition-colors">

                  {/* Avatar */}
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                    s.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}>
                    {s.avatar}
                  </div>

                  {/* Name + email + status */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn('text-sm font-semibold', s.status === 'inactive' ? 'text-muted-foreground' : 'text-[#1c1410]')}>
                        {s.name}
                      </p>
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold',
                        s.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500',
                      )}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', s.status === 'active' ? 'bg-green-500' : 'bg-gray-400')} />
                        {s.status === 'active' ? 'Active' : s.status === 'pending' ? 'Pending' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#7a6b5c] truncate mt-0.5">{s.email}</p>
                  </div>

                  {/* Stats */}
                  <div className="hidden md:flex items-center gap-6 shrink-0">
                    <div className="text-center w-14">
                      <p className="text-sm font-semibold text-[#1c1410]">{s.leadsAssigned}</p>
                      <p className="text-[10px] text-[#7a6b5c] mt-0.5">Leads</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12px] font-medium text-[#1c1410] whitespace-nowrap">
                        {formatDistanceToNow(new Date(s.lastActive), { addSuffix: true })}
                      </p>
                      <p className="text-[10px] text-[#7a6b5c] mt-0.5">Last Active</p>
                    </div>
                  </div>

                  {/* Actions */}
                  {canManageStaff && (
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button
                        onClick={() => setEditMember(s)}
                        className="p-2 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[var(--brand-dark)] transition-colors"
                        title="Edit member"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setPermsMember(s)}
                        className="p-2 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[var(--brand-dark)] transition-colors"
                        title="Edit permissions"
                      >
                        <ShieldCheck className="w-4 h-4" />
                      </button>
                      <div className="relative">
                        <button
                          onClick={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
                          className="p-2 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-foreground transition-colors"
                          title="More actions"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {openMenuId === s.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
                            <div className="absolute right-0 top-10 bg-white border border-black/8 rounded-xl shadow-lg z-50 w-44 py-1 overflow-hidden">
                              {s.status === 'pending' && (
                                <button
                                  onClick={() => {
                                    api.post(`/api/settings/staff/${s.id}/resend-invite`, {})
                                      .then(() => toast.success(`Invite resent to ${s.email}`))
                                      .catch(() => toast.error('Failed to resend invite'));
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 hover:bg-[var(--app-bg)] transition-colors text-[#1c1410]"
                                >
                                  <Mail className="w-4 h-4 text-[#7a6b5c]" />
                                  Resend Invite
                                </button>
                              )}
                              <button
                                onClick={() => { setDeactivateMember(s); setOpenMenuId(null); }}
                                className={cn(
                                  'w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 transition-colors',
                                  s.status === 'active' ? 'hover:bg-red-50 text-red-600' : 'hover:bg-green-50 text-green-700',
                                )}
                              >
                                {s.status === 'active'
                                  ? <UserMinus className="w-4 h-4" />
                                  : <UserCheck className="w-4 h-4" />}
                                {s.status === 'active' ? 'Deactivate' : 'Reactivate'}
                              </button>
                              <div className="border-t border-black/5 my-1" />
                              <button
                                onClick={() => { setDeleteMember(s); setOpenMenuId(null); }}
                                className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 hover:bg-red-50 text-red-600 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Roles & Permissions Tab */}
      {tab === 'roles' && (
        <div className="space-y-5">
          <div>
            <h3 className="font-headline text-[17px] font-bold text-[#1c1410]">Roles &amp; Permissions</h3>
            <p className="text-[12px] text-[#7a6b5c] mt-0.5">Click a staff member to edit their individual access</p>
          </div>

          {staff.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#ede8e2] flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-[var(--brand-dark)]" />
              </div>
              <p className="text-[14px] font-bold text-[#1c1410]">No staff yet</p>
              <p className="text-[12px] text-[#7a6b5c]">Add team members first to configure their permissions</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {staff.map((s) => (
                <div key={s.id}
                  className="bg-white rounded-2xl border border-[#ede8e2] p-5 flex items-center gap-4 hover:border-primary/30 hover:shadow-sm transition-all group">
                  <div className={cn(
                    'w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0',
                    s.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}>
                    {s.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#1c1410] truncate">{s.name}</p>
                    <p className="text-[11px] text-[#7a6b5c] truncate">{s.email}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={cn('w-1.5 h-1.5 rounded-full', s.status === 'active' ? 'bg-green-500' : 'bg-gray-300')} />
                      <span className="text-[10px] text-[#9c8f84] capitalize">{s.status}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPermsMember(s)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-[var(--brand-dark)] bg-orange-50 border border-orange-100 hover:bg-orange-100 transition-colors shrink-0 group-hover:border-primary/40"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Permissions
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Performance Tab */}
      {tab === 'performance' && (
        <div className="bg-white rounded-2xl border border-black/5 card-shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-black/5 bg-[var(--app-bg)]">
                  {['Name', 'Leads Handled', 'Converted', 'Conv. Rate', 'Avg Response', 'Conversations', 'Follow-ups'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perfData.map((p) => {
                  const convRate = Math.round((p.converted / p.leadsHandled) * 100);
                  return (
                    <tr key={p.id} className="border-b border-black/5 last:border-0 hover:bg-[var(--app-bg)] transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{p.name}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{p.leadsHandled}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{p.converted}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden w-16">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${convRate}%` }} />
                          </div>
                          <span className="text-[11px] text-[#7a6b5c]">{convRate}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#7a6b5c]">{p.avgResponse} min</td>
                      <td className="px-4 py-3 text-sm text-foreground">{p.conversations}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{p.followUps}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {showInviteModal && <StaffModal onClose={() => setShowInviteModal(false)} onSave={handleInvite} />}
      {editMember && <StaffModal initial={editMember} onClose={() => setEditMember(null)} onSave={handleEdit} />}
      {deactivateMember && <DeactivateDialog member={deactivateMember} onClose={() => setDeactivateMember(null)} onConfirm={handleDeactivate} />}
      {deleteMember && <DeleteConfirmModal member={deleteMember} onClose={() => setDeleteMember(null)} onConfirm={handleDelete} />}
      {permsMember && <PermissionsModal member={permsMember} onClose={() => setPermsMember(null)} />}
    </div>
  );
}
