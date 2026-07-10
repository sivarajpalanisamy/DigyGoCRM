import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, RefreshCw, Search, LogIn, Pencil, Mail, MoreVertical,
  CheckCircle2, XCircle, Building2, Users, TrendingUp, X, ChevronDown,
  Globe, AlertTriangle, Copy, Trash2, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';
import { confirmDialog } from '@/lib/confirm';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Tenant {
  id: string;
  name: string;
  email: string;
  plan: string;
  is_active: boolean;
  subscription_status: string;
  subscription_expires_at: string | null;
  billing_cycle?: string | null;
  plan_price?: number | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  user_count: number;
  lead_count: number;
  admin_name: string | null;
  admin_email: string | null;
  last_login_at: string | null;
  domain_status?: string | null;
  custom_domain?: string | null;
  superfone_enabled?: boolean;
  email_credits?: number;
  max_users?: number;
  hidden_integrations?: string[];
}

// Plans are Monthly / Yearly only (the billing cycle). The old tier field is retired.
const CYCLE_BADGE: Record<string, string> = {
  monthly: 'bg-blue-100 text-blue-700',
  yearly:  'bg-green-100 text-green-700',
};
const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly',
  yearly:  'Yearly',
};
const cycleOf = (t: { billing_cycle?: string | null }) => (t.billing_cycle === 'yearly' ? 'yearly' : 'monthly');

// CNAME target a client points their custom domain at. Must match the primary app
// domain that resolves to the server (backend returns the same value from POST /domain).
const CNAME_TARGET = 'app.hawcus.com';

// Live subscription state for the admin list (blocked = end-of-day expiry passed or manual).
function subState(t: { subscription_status: string; subscription_expires_at: string | null }) {
  const exp = t.subscription_expires_at ? new Date(t.subscription_expires_at).getTime() : null;
  const now = Date.now();
  const blocked = t.subscription_status === 'suspended' || t.subscription_status === 'expired' || (exp !== null && now >= exp);
  const daysLeft = exp !== null ? Math.ceil((exp - now) / 86_400_000) : null;
  if (blocked) return { tone: 'red' as const, label: t.subscription_status === 'suspended' ? 'Suspended' : 'Blocked - expired' };
  if (daysLeft !== null && daysLeft <= 7) return { tone: 'amber' as const, label: `Expiring in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` };
  return { tone: 'green' as const, label: 'Active Subscription' };
}

// ── Domain Management Modal ───────────────────────────────────────────────────

interface DomainInfo {
  custom_domain: string | null;
  domain_status: string;
  domain_error: string | null;
  domain_verified_at: string | null;
  domain_ssl_expires_at: string | null;
  domain_cert_attempts: number;
  domain_last_attempt_at: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
}

function DomainModal({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const [info, setInfo] = useState<DomainInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [domainInput, setDomainInput] = useState('');
  const [logoInput, setLogoInput] = useState('');
  const [colorInput, setColorInput] = useState('#c2410c');
  const [replyToInput, setReplyToInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchInfo = useCallback(async () => {
    try {
      const data = await api.get<DomainInfo>(`/api/auth/tenants/${tenant.id}/domain`);
      setInfo(data);
      setDomainInput(data.custom_domain ?? '');
      setLogoInput(data.logo_url ?? '');
      setColorInput(data.brand_color ?? '#c2410c');
      setReplyToInput(data.reply_to_email ?? '');
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [tenant.id]);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  // Poll every 3s while verifying
  useEffect(() => {
    if (info?.domain_status === 'verifying') {
      pollRef.current = setInterval(() => fetchInfo(), 3000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [info?.domain_status, fetchInfo]);

  const handleSetDomain = async () => {
    if (!domainInput.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/auth/tenants/${tenant.id}/domain`, {
        custom_domain: domainInput.trim(),
        logo_url: logoInput.trim() || undefined,
        brand_color: colorInput,
        reply_to_email: replyToInput.trim() || undefined,
      });
      toast.success('Domain saved');
      await fetchInfo();
    } catch (err: any) { toast.error(err.message ?? 'Failed to set domain'); }
    finally { setSaving(false); }
  };

  const handleSaveBranding = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/auth/tenants/${tenant.id}`, {
        logo_url: logoInput.trim() || null,
        brand_color: colorInput,
        reply_to_email: replyToInput.trim() || null,
      });
      toast.success('Branding saved');
    } catch (err: any) { toast.error(err.message ?? 'Failed to save branding'); }
    finally { setSaving(false); }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await api.post(`/api/auth/tenants/${tenant.id}/domain/verify`, {});
      toast.success('Domain activated successfully!');
      await fetchInfo();
    } catch (err: any) { toast.error(err.message ?? 'Verification failed'); await fetchInfo(); }
    finally { setVerifying(false); }
  };

  const handleRemove = async () => {
    if (!(await confirmDialog({ message: `Remove domain ${info?.custom_domain}? The domain will stop working immediately.`, confirmText: 'Remove' }))) return;
    setRemoving(true);
    try {
      await api.delete(`/api/auth/tenants/${tenant.id}/domain`);
      toast.success('Domain removed');
      await fetchInfo();
    } catch (err: any) { toast.error(err.message ?? 'Failed to remove domain'); }
    finally { setRemoving(false); }
  };

  const status = info?.domain_status ?? 'none';
  const attemptsLeft = Math.max(0, 4 - (info?.domain_cert_attempts ?? 0));
  const subdomain = info?.custom_domain
    ? info.custom_domain.split('.').length > 2
      ? info.custom_domain.split('.').slice(0, -2).join('.')
      : '@'
    : 'admin';

  const inp = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-[#1c1410] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#1c1410] flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" /> Custom Domain
            </h3>
            <p className="text-[11px] text-[#7a6b5c] mt-0.5">{tenant.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-5 space-y-5">

            {/* Status badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#7a6b5c]">Status:</span>
              {status === 'none' && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">No domain set</span>}
              {status === 'dns_pending' && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⏳ DNS Pending</span>}
              {status === 'verifying' && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 animate-pulse"><Loader2 className="w-3 h-3 animate-spin" /> Verifying SSL...</span>}
              {status === 'ssl_active' && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> Active</span>}
              {status === 'failed' && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700"><XCircle className="w-3 h-3" /> Failed</span>}
              {info?.domain_verified_at && status === 'ssl_active' && (
                <span className="text-[10px] text-[#b09e8d]">since {new Date(info.domain_verified_at).toLocaleDateString()}</span>
              )}
            </div>

            {/* Error message */}
            {status === 'failed' && info?.domain_error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-700 font-mono break-all">{info.domain_error}</p>
              </div>
            )}

            {/* Attempt counter warning */}
            {(info?.domain_cert_attempts ?? 0) >= 3 && status !== 'ssl_active' && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700">
                  {info?.domain_cert_attempts}/4 verification attempts used this week.
                  Let's Encrypt permanently blocks after 5 failures.
                  {attemptsLeft === 0 && ' Limit reached - try again next Monday.'}
                </p>
              </div>
            )}

            {/* Domain input */}
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Custom Domain</label>
              <div className="flex gap-2">
                <input
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="admin.yourcompany.com"
                  className={`${inp} flex-1`}
                />
                <button onClick={handleSetDomain} disabled={saving || !domainInput.trim()}
                  className="px-3 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0">
                  {saving ? '…' : 'Save'}
                </button>
              </div>
            </div>

            {/* DNS instructions */}
            {(status === 'dns_pending' || status === 'failed') && info?.custom_domain && (
              <div className="p-3 bg-[#faf8f6] rounded-lg border border-[#e8ddd4] space-y-2">
                <p className="text-xs font-semibold text-[#1c1410]">DNS Setup Instructions</p>
                <p className="text-[11px] text-[#7a6b5c]">Add this record in your domain's DNS settings:</p>
                <div className="grid grid-cols-3 gap-1 text-[11px] font-mono bg-white rounded-lg border border-gray-100 p-2">
                  <span className="text-gray-400">Type</span>
                  <span className="text-gray-400">Name</span>
                  <span className="text-gray-400">Value</span>
                  <span className="font-bold">CNAME</span>
                  <span className="font-bold">{subdomain}</span>
                  <span className="font-bold">{CNAME_TARGET}</span>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(CNAME_TARGET); toast.success('Copied!'); }}
                  className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80">
                  <Copy className="w-3 h-3" /> Copy value
                </button>
              </div>
            )}

            {/* Verify button */}
            {(status === 'dns_pending' || status === 'failed') && (
              <button
                onClick={handleVerify}
                disabled={verifying || attemptsLeft === 0}
                className="w-full h-10 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {verifying ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Checking DNS & provisioning SSL...</>
                ) : attemptsLeft === 0 ? 'Attempt limit reached' : 'Verify & Activate SSL'}
              </button>
            )}

            {/* Remove domain button */}
            {info?.custom_domain && status !== 'none' && (
              <button onClick={handleRemove} disabled={removing}
                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
                {removing ? 'Removing...' : 'Remove domain'}
              </button>
            )}

            {/* Branding section */}
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-bold text-[#1c1410]">White-Label Branding</p>
              <div>
                <label className="text-xs font-semibold text-[#7a6b5c] mb-1 block">Logo URL <span className="font-normal">(hosted image URL)</span></label>
                <input value={logoInput} onChange={(e) => setLogoInput(e.target.value)}
                  placeholder="https://cdn.yourcompany.com/logo.png" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#7a6b5c] mb-1 block">Brand Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={colorInput} onChange={(e) => setColorInput(e.target.value)}
                      className="w-9 h-9 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
                    <input value={colorInput} onChange={(e) => setColorInput(e.target.value)}
                      placeholder="#c2410c" className={`${inp} flex-1`} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#7a6b5c] mb-1 block">Reply-To Email</label>
                  <input value={replyToInput} onChange={(e) => setReplyToInput(e.target.value)}
                    placeholder="info@yourcompany.com" className={inp} />
                </div>
              </div>
              <button onClick={handleSaveBranding} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-60">
                {saving ? 'Saving…' : 'Save Branding'}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit Tenant Modal ──────────────────────────────────────────────────────────

function EditTenantModal({ tenant, onClose, onSaved }: { tenant: Tenant; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: tenant.name,
    billing_cycle: (tenant.billing_cycle === 'yearly' ? 'yearly' : 'monthly'),
    plan_price: tenant.plan_price != null ? String(tenant.plan_price) : '',
    subscription_status: tenant.subscription_status,
    subscription_expires_at: tenant.subscription_expires_at ? tenant.subscription_expires_at.slice(0, 10) : '',
    phone: tenant.phone ?? '',
    address: tenant.address ?? '',
    owner_name: tenant.admin_name ?? '',
    owner_email: tenant.admin_email ?? '',
    superfone_enabled: !!tenant.superfone_enabled,
    email_credits: tenant.email_credits != null ? String(tenant.email_credits) : '-1',
    max_users: tenant.max_users != null ? String(tenant.max_users) : '5',
    hidden_integrations: tenant.hidden_integrations ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/auth/tenants/${tenant.id}`, {
        ...form,
        plan_price: form.plan_price === '' ? null : Number(form.plan_price),
        email_credits: form.email_credits === '' || form.email_credits === '-1' ? -1 : Number(form.email_credits),
        max_users: Number(form.max_users) || 5,
        subscription_expires_at: form.subscription_expires_at || null,
      });
      toast.success('Account updated');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleRenew = async () => {
    setRenewing(true);
    try {
      const r = await api.post<any>(`/api/auth/tenants/${tenant.id}/renew`, { billing_cycle: form.billing_cycle });
      toast.success('Subscription renewed');
      onSaved();
      onClose();
      void r;
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to renew');
    } finally {
      setRenewing(false);
    }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-[#1c1410] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header (fixed) */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-bold text-[#1c1410]">Edit Business</h3>
            <p className="text-[11px] text-[#7a6b5c] mt-0.5">{tenant.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        {/* Body - horizontal 2-column grid, scrolls if it overflows */}
        <div className="px-4 sm:px-6 py-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          {/* ── Business ── */}
          <div className="sm:col-span-2 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Business</div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Business Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inp} />
          </div>

          {/* ── Account Owner (login) ── */}
          <div className="sm:col-span-2 mt-1 pt-4 border-t border-gray-100 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Account Owner (login)</div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Owner Name</label>
            <input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Owner Email <span className="font-normal text-[#7a6b5c]">(login)</span></label>
            <input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} className={inp} />
          </div>
          <p className="sm:col-span-2 -mt-1.5 text-[10px] text-[#b09e8d]">Changing the owner email changes how they sign in - both the old and new addresses are notified.</p>

          {/* ── Subscription ── */}
          <div className="sm:col-span-2 mt-1 pt-4 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Subscription</span>
            <button type="button" onClick={handleRenew} disabled={renewing}
              className="px-3 py-1.5 rounded-lg text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-60">
              {renewing ? 'Renewing…' : `Renew +1 ${form.billing_cycle === 'yearly' ? 'year' : 'month'}`}
            </button>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Plan</label>
            <select value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })} className={inp}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Status</label>
            <select value={form.subscription_status} onChange={(e) => setForm({ ...form, subscription_status: e.target.value })} className={inp}>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="suspended">Suspended</option>
              <option value="trial">Trial</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Expires At <span className="font-normal text-[#7a6b5c]">(blank = never)</span></label>
            <input type="date" value={form.subscription_expires_at} onChange={(e) => setForm({ ...form, subscription_expires_at: e.target.value })} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Price (₹ / period)</label>
            <input type="number" value={form.plan_price} onChange={(e) => setForm({ ...form, plan_price: e.target.value })} className={inp} placeholder="e.g. 1499" />
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-black/10 bg-[var(--app-bg)] cursor-pointer">
              <span>
                <span className="text-xs font-semibold text-[#1c1410] block">Superfone</span>
                <span className="text-[11px] text-[#7a6b5c]">Enable the Superfone integration for this account</span>
              </span>
              <input type="checkbox" className="w-5 h-5 accent-primary"
                checked={form.superfone_enabled}
                onChange={(e) => setForm({ ...form, superfone_enabled: e.target.checked })} />
            </label>
          </div>

          {/* Integration Visibility */}
          <div className="sm:col-span-2 mt-1 pt-4 border-t border-gray-100 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Integration Visibility</div>
          <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { key: 'facebook', label: 'Facebook' },
              { key: 'instagram', label: 'Instagram' },
              { key: 'whatsapp_business', label: 'WhatsApp Business' },
              { key: 'whatsapp_personal', label: 'WhatsApp Personal' },
              { key: 'email_smtp', label: 'Email (SMTP)' },
              { key: 'google_sheets', label: 'Google Sheets' },
              { key: 'razorpay', label: 'Razorpay' },
            ].map(({ key, label }) => {
              const hidden = form.hidden_integrations.includes(key);
              return (
                <label key={key} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-black/10 bg-[var(--app-bg)] cursor-pointer text-xs">
                  <input type="checkbox" className="w-4 h-4 accent-primary"
                    checked={!hidden}
                    onChange={() => setForm({
                      ...form,
                      hidden_integrations: hidden
                        ? form.hidden_integrations.filter((k) => k !== key)
                        : [...form.hidden_integrations, key],
                    })}
                  />
                  <span className={hidden ? 'text-[#9e8e7e] line-through' : 'text-[#1c1410] font-semibold'}>{label}</span>
                </label>
              );
            })}
          </div>
          <p className="sm:col-span-2 text-[11px] text-[#7a6b5c] -mt-1">Unchecked integrations will be hidden from this tenant's Integrations page.</p>

          {/* User License */}
          <div className="sm:col-span-2 mt-1 pt-4 border-t border-gray-100 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">User License</div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Max Users <span className="font-normal text-[#7a6b5c]">(including owner)</span></label>
            <input type="number" min="1" value={form.max_users} onChange={(e) => setForm({ ...form, max_users: e.target.value })} className={inp} placeholder="5" />
          </div>
          <div className="flex items-end pb-1">
            <p className="text-[11px] text-[#7a6b5c]">
              Currently {tenant.user_count} active user{tenant.user_count !== 1 ? 's' : ''} of {form.max_users} allowed
            </p>
          </div>

          {/* Email Credits */}
          <div className="sm:col-span-2 mt-1 pt-4 border-t border-gray-100 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Email Credits</div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Credits <span className="font-normal text-[#7a6b5c]">(-1 = Unlimited)</span></label>
            <input type="number" value={form.email_credits} onChange={(e) => setForm({ ...form, email_credits: e.target.value })} className={inp} placeholder="-1" />
          </div>
          <div className="flex items-end pb-1">
            <p className="text-[11px] text-[#7a6b5c]">
              {form.email_credits === '-1' ? 'Unlimited emails' : Number(form.email_credits) === 0 ? 'No credits - sending blocked' : `${form.email_credits} emails remaining`}
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Address</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inp} />
          </div>
        </div>

        {/* Footer (fixed) */}
        <div className="flex items-center justify-end gap-2 px-4 sm:px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-60">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Row Actions Dropdown ────────────────────────────────────────────────────────

function RowMenu({ tenant, onEdit, onRefresh }: { tenant: Tenant; onEdit: () => void; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const handleToggleActive = async () => {
    setOpen(false);
    try {
      if (tenant.is_active) {
        await api.delete(`/api/auth/tenants/${tenant.id}`);
        toast.success('Account suspended');
      } else {
        await api.post(`/api/auth/tenants/${tenant.id}/restore`, {});
        toast.success('Account restored');
      }
      onRefresh();
    } catch (err: any) { toast.error(err.message ?? 'Failed'); }
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 bg-white border border-gray-100 rounded-xl shadow-xl z-50 w-44 py-1">
          <button onClick={() => { setOpen(false); onEdit(); }}
            className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 text-[#1c1410]">
            <Pencil className="w-3.5 h-3.5 text-gray-400" /> Edit Details
          </button>
          <button onClick={() => {
            setOpen(false);
            window.location.href = `mailto:${tenant.admin_email ?? tenant.email}`;
          }} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 text-[#1c1410]">
            <Mail className="w-3.5 h-3.5 text-gray-400" /> Send Email
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button onClick={handleToggleActive}
            className={cn('w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
              tenant.is_active ? 'hover:bg-red-50 text-red-600' : 'hover:bg-green-50 text-green-700')}>
            {tenant.is_active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {tenant.is_active ? 'Suspend Account' : 'Restore Account'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SuperAdminPage() {
  const navigate = useNavigate();
  const { impersonateTenant } = useAuthStore();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('');
  const [filterSub, setFilterSub] = useState('_active');
  const [editTenant, setEditTenant] = useState<Tenant | null>(null);
  const [domainTenant, setDomainTenant] = useState<Tenant | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Tenant[]>(`/api/auth/tenants?deleted=${showDeleted}`);
      setTenants(data);
    } catch {
      toast.error('Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, [showDeleted]);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  const handleImpersonate = async (tenant: Tenant) => {
    setImpersonatingId(tenant.id);
    try {
      const ok = await impersonateTenant(tenant.id);
      if (ok) {
        toast.success(`Viewing as ${tenant.name}`);
        navigate('/dashboard');
      } else {
        toast.error('No active admin found for this account');
      }
    } catch {
      toast.error('Impersonation failed');
    } finally {
      setImpersonatingId(null);
    }
  };

  // Filter
  const filtered = tenants.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.name.toLowerCase().includes(q) ||
      (t.admin_email ?? '').toLowerCase().includes(q) ||
      (t.admin_name ?? '').toLowerCase().includes(q) ||
      (t.phone ?? '').includes(q);
    const matchPlan = !filterPlan || cycleOf(t) === filterPlan;
    const matchSub  = !filterSub
      || (filterSub === '_suspended' ? !t.is_active : filterSub === '_active' ? t.is_active : t.subscription_status === filterSub);
    return matchSearch && matchPlan && matchSub;
  });

  const activeCount = tenants.filter((t) => t.is_active).length;
  const inactiveCount = tenants.filter((t) => !t.is_active).length;
  const totalUsers = tenants.reduce((a, t) => a + Number(t.user_count), 0);
  const totalLeads = tenants.reduce((a, t) => a + Number(t.lead_count), 0);

  return (
    <div className="space-y-5 pb-10">

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Active Accounts', value: activeCount, icon: Building2, color: 'text-primary', bg: 'bg-primary/10' },
          { label: 'Inactive Accounts', value: inactiveCount, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
          { label: 'Total Users', value: totalUsers, icon: Users, color: 'text-purple-500', bg: 'bg-purple-50' },
          { label: 'Total Leads', value: totalLeads, icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl px-5 py-4 border border-black/5 flex items-center gap-4"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', s.bg)}>
              <s.icon className={cn('w-5 h-5', s.color)} />
            </div>
            <div>
              <p className="text-[11px] text-[#7a6b5c]">{s.label}</p>
              <p className="font-headline text-[24px] font-bold text-[#1c1410] leading-tight">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main panel */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>

        {/* Tabs + Create button */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 pt-4 pb-0">
          <div className="flex gap-2">
            <button onClick={() => setShowDeleted(false)}
              className={cn('px-3 sm:px-4 py-1.5 rounded-full text-[13px] sm:text-[14px] font-semibold transition-all',
                !showDeleted ? 'bg-primary text-white' : 'bg-transparent text-[#7a6b5c] hover:bg-gray-100')}>
              All Accounts
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchTenants} disabled={loading}
              className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-primary transition-colors">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button onClick={() => navigate('/admin/create')}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-white text-[14px] font-bold transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#c2410c 0%,#ea580c 55%,#f97316 100%)', boxShadow: '0 4px 14px rgba(234,88,12,.28)' }}>
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">CREATE WHITE LABEL</span>
              <span className="sm:hidden">CREATE</span>
            </button>
          </div>
        </div>

        {/* Sub-header */}
        <div className="px-4 sm:px-5 pt-4 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1 h-4 rounded-full bg-primary" />
            <h2 className="font-headline font-bold text-[#1c1410] text-[15px]">Business Accounts</h2>
          </div>
          <p className="text-[13px] text-[#7a6b5c]">You have total <span className="font-semibold text-[#1c1410]">{filtered.length}</span></p>
        </div>

        {/* Filters */}
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          {/* Plan filter */}
          <div className="relative">
            <select value={filterPlan} onChange={(e) => setFilterPlan(e.target.value)}
              className="pl-3 pr-7 py-1.5 rounded-lg border border-gray-200 text-[13px] text-[#1c1410] outline-none bg-white appearance-none cursor-pointer hover:border-gray-300 transition-colors">
              <option value="">Plan</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
          </div>
          {/* Subscription filter */}
          <div className="relative">
            <select value={filterSub} onChange={(e) => setFilterSub(e.target.value)}
              className="pl-3 pr-7 py-1.5 rounded-lg border border-gray-200 text-[13px] text-[#1c1410] outline-none bg-white appearance-none cursor-pointer hover:border-gray-300 transition-colors">
              <option value="">Status</option>
              <option value="_active">Active Accounts</option>
              <option value="_suspended">Suspended Accounts</option>
              <option value="active">Sub: Active</option>
              <option value="expired">Sub: Expired</option>
              <option value="suspended">Sub: Suspended</option>
              <option value="trial">Sub: Trial</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
          </div>
          {(filterPlan || filterSub || search) && (
            <button onClick={() => { setFilterPlan(''); setFilterSub(''); setSearch(''); }}
              className="text-[11px] text-primary font-medium hover:underline">
              Clear
            </button>
          )}
          {/* Search */}
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 bg-white ml-auto w-full sm:w-auto">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts…"
              className="text-[13px] text-[#1c1410] outline-none bg-transparent placeholder:text-gray-300 flex-1 sm:w-44" />
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="py-20 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-gray-300 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 flex flex-col items-center gap-3">
            <Building2 className="w-10 h-10 text-gray-200" />
            <p className="text-sm font-semibold text-gray-400">
              {search || filterPlan || filterSub ? 'No accounts match your filters' : 'No accounts yet'}
            </p>
            {!search && !filterPlan && !filterSub && (
              <button onClick={() => navigate('/admin/create')}
                className="mt-1 flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#c2410c 0%,#ea580c 100%)' }}>
                <Plus className="w-4 h-4" /> Create Account
              </button>
            )}
          </div>
        ) : (
          <>
          <div className="sm:hidden divide-y divide-gray-50">
            {filtered.map((t, idx) => {
              const st = subState(t);
              const tone = st.tone === 'green' ? 'text-green-700' : st.tone === 'amber' ? 'text-amber-600' : 'text-red-500';
              return (
                <div key={t.id} className="px-4 py-4 space-y-3">
                  {/* Top row: avatar + name + actions */}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-[11px] font-bold text-gray-400 shrink-0">
                      {t.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-[#1c1410] text-[15px] truncate">{t.name}</p>
                        {!t.is_active && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600 uppercase tracking-wide shrink-0">Suspended</span>}
                      </div>
                      <p className="text-[11px] text-[#7a6b5c] truncate">{t.admin_name ?? '-'} · {t.admin_email ?? t.email}</p>
                    </div>
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0', CYCLE_BADGE[cycleOf(t)])}>
                      {CYCLE_LABEL[cycleOf(t)]}
                    </span>
                  </div>
                  {/* Subscription status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {st.tone === 'green'
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        : <XCircle className={cn('w-3.5 h-3.5 shrink-0', st.tone === 'amber' ? 'text-amber-500' : 'text-red-400')} />}
                      <span className={cn('text-[13px] font-semibold', tone)}>{st.label}</span>
                      <span className="text-[11px] text-[#7a6b5c]">
                        · {t.subscription_expires_at ? format(new Date(t.subscription_expires_at), 'MMM dd, yyyy') : 'No expiry'}
                      </span>
                    </div>
                  </div>
                  {/* Info row */}
                  <p className="text-[11px] text-[#7a6b5c]">
                    {t.last_login_at
                      ? `Last login: ${format(new Date(t.last_login_at), 'MMM dd hh:mm aa')}`
                      : 'Never logged in'}
                    {t.phone ? ` · ${t.phone}` : ''}
                    {` · ${t.user_count}/${t.max_users ?? 5} users`}
                  </p>
                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => handleImpersonate(t)} disabled={impersonatingId === t.id || !t.is_active}
                      className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all',
                        t.is_active ? 'border-gray-200 text-primary hover:bg-primary/5' : 'border-gray-100 text-gray-300 cursor-not-allowed')}>
                      {impersonatingId === t.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <LogIn className="w-3 h-3" />}
                      Login
                    </button>
                    <button onClick={() => setEditTenant(t)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 text-[#7a6b5c] hover:bg-gray-50 transition-all">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => setDomainTenant(t)}
                      className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all',
                        t.domain_status === 'ssl_active'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                          : 'border-gray-200 text-[#7a6b5c] hover:bg-gray-50')}>
                      <Globe className="w-3 h-3" /> Domain
                    </button>
                    <div className="ml-auto">
                      <RowMenu tenant={t} onEdit={() => setEditTenant(t)} onRefresh={fetchTenants} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop table layout ── */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[900px] text-[14px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['#', 'Business Name', 'Active Subscription', 'Owner Details', 'Info', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] whitespace-nowrap bg-[#faf8f6]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((t, idx) => (
                  <tr key={t.id} className="hover:bg-[#fafaf9] transition-colors group">
                    {/* # */}
                    <td className="px-4 py-4 text-[#7a6b5c] text-[13px] w-10">{idx + 1}</td>

                    {/* Business Name */}
                    <td className="px-4 py-4 min-w-[160px]">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-[11px] font-bold text-gray-400 shrink-0">
                          {t.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-[#1c1410] truncate">{t.name}</p>
                            {!t.is_active && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600 uppercase tracking-wide shrink-0">Suspended</span>}
                          </div>
                          {t.phone && <p className="text-[11px] text-[#7a6b5c]">{t.phone}</p>}
                          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide', CYCLE_BADGE[cycleOf(t)])}>
                            {CYCLE_LABEL[cycleOf(t)]}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Active Subscription */}
                    <td className="px-4 py-4 min-w-[150px]">
                      {(() => {
                        const st = subState(t);
                        const tone = st.tone === 'green'
                          ? 'text-green-700' : st.tone === 'amber' ? 'text-amber-600' : 'text-red-500';
                        return (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              {st.tone === 'green'
                                ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                                : <XCircle className={cn('w-4 h-4 shrink-0', st.tone === 'amber' ? 'text-amber-500' : 'text-red-400')} />}
                              <span className={cn('text-[13px] font-semibold', tone)}>{st.label}</span>
                            </div>
                            <p className="text-[11px] text-[#7a6b5c] pl-5">
                              {t.billing_cycle ? (t.billing_cycle === 'yearly' ? 'Yearly · ' : 'Monthly · ') : ''}
                              {t.subscription_expires_at ? format(new Date(t.subscription_expires_at), 'MMM dd, yyyy') : 'No expiry'}
                            </p>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Owner Details */}
                    <td className="px-4 py-4 min-w-[180px]">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-[11px] font-bold text-gray-500 shrink-0">
                          {(t.admin_name ?? t.name).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1c1410] text-[14px] truncate">{t.admin_name ?? '-'}</p>
                          <p className="text-[11px] text-[#7a6b5c] truncate">{t.admin_email ?? t.email}</p>
                          {t.phone && <p className="text-[11px] text-[#7a6b5c]">{t.phone}</p>}
                        </div>
                      </div>
                    </td>

                    {/* Info */}
                    <td className="px-4 py-4 min-w-[160px]">
                      <p className="text-[11px] text-[#7a6b5c] mb-1">
                        {t.last_login_at
                          ? `Last Login: ${format(new Date(t.last_login_at), 'MMM dd, yyyy hh:mm aa')}`
                          : 'Never logged in'}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', CYCLE_BADGE[cycleOf(t)])}>
                          {CYCLE_LABEL[cycleOf(t)]}
                        </span>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                          t.user_count >= (t.max_users ?? 5) ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600')}>
                          {t.user_count}/{t.max_users ?? 5} users
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleImpersonate(t)} disabled={impersonatingId === t.id || !t.is_active} title="Login as User"
                          className={cn('w-8 h-8 flex items-center justify-center rounded-lg border transition-all',
                            t.is_active
                              ? 'border-gray-200 hover:border-primary hover:bg-primary/5 text-gray-400 hover:text-primary'
                              : 'border-gray-100 text-gray-200 cursor-not-allowed')}>
                          {impersonatingId === t.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => setEditTenant(t)} title="Edit"
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:border-primary/50 hover:bg-primary/5 text-gray-400 hover:text-primary transition-all">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDomainTenant(t)} title="Custom Domain"
                          className={cn('w-8 h-8 flex items-center justify-center rounded-lg border transition-all',
                            t.domain_status === 'ssl_active'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300'
                              : 'border-gray-200 hover:border-primary/50 hover:bg-primary/5 text-gray-400 hover:text-primary')}>
                          <Globe className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => window.location.href = `mailto:${t.admin_email ?? t.email}`} title="Email"
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all">
                          <Mail className="w-3.5 h-3.5" />
                        </button>
                        <RowMenu tenant={t} onEdit={() => setEditTenant(t)} onRefresh={fetchTenants} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}

        {/* Footer count */}
        {!loading && filtered.length > 0 && (
          <div className="px-4 sm:px-5 py-3 border-t border-gray-50 bg-[#faf8f6]">
            <p className="text-[11px] text-[#7a6b5c]">
              Showing <span className="font-semibold text-[#1c1410]">{filtered.length}</span> of{' '}
              <span className="font-semibold text-[#1c1410]">{tenants.length}</span> accounts
            </p>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editTenant && (
        <EditTenantModal tenant={editTenant} onClose={() => setEditTenant(null)} onSaved={fetchTenants} />
      )}

      {/* Domain Modal */}
      {domainTenant && (
        <DomainModal tenant={domainTenant} onClose={() => setDomainTenant(null)} />
      )}
    </div>
  );
}
