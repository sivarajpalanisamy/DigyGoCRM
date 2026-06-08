import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, RefreshCw, Search, LogIn, Pencil, Mail, MoreVertical,
  CheckCircle2, XCircle, Building2, Users, TrendingUp, X, ChevronDown,
  Globe, AlertTriangle, Copy, Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';
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
}

const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-gray-100 text-gray-600',
  pro:        'bg-green-100 text-green-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

const PLAN_LABEL: Record<string, string> = {
  starter:    'Starter',
  pro:        'Premium User',
  enterprise: 'Enterprise',
};

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
    if (!confirm(`Remove domain ${info?.custom_domain}? The domain will stop working immediately.`)) return;
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
              {status === 'verifying' && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 animate-pulse">🔵 Verifying SSL...</span>}
              {status === 'ssl_active' && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✅ Active</span>}
              {status === 'failed' && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">❌ Failed</span>}
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
                  {attemptsLeft === 0 && ' Limit reached — try again next Monday.'}
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
                  <span className="font-bold">crm.digygo.in</span>
                </div>
                <button onClick={() => { navigator.clipboard.writeText('crm.digygo.in'); toast.success('Copied!'); }}
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
    plan: tenant.plan,
    subscription_status: tenant.subscription_status,
    subscription_expires_at: tenant.subscription_expires_at ? tenant.subscription_expires_at.slice(0, 10) : '',
    phone: tenant.phone ?? '',
    address: tenant.address ?? '',
    owner_name: tenant.admin_name ?? '',
    owner_email: tenant.admin_email ?? '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/auth/tenants/${tenant.id}`, {
        ...form,
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

  const inp = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-[#1c1410] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-[#1c1410]">Edit Sub Account</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Business Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} />
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Account Owner (login)</p>
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Owner Name</label>
              <input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Owner Email <span className="font-normal text-[#7a6b5c]">(login email)</span></label>
              <input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} className={inp} />
              <p className="text-[10px] text-[#b09e8d] mt-1">Changing this changes how the owner signs in. Both old and new addresses are notified.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Plan</label>
              <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className={inp}>
                {['starter', 'pro', 'enterprise'].map((p) => (
                  <option key={p} value={p}>{PLAN_LABEL[p] ?? p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Subscription</label>
              <select value={form.subscription_status} onChange={(e) => setForm({ ...form, subscription_status: e.target.value })} className={inp}>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="suspended">Suspended</option>
                <option value="trial">Trial</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Subscription Expires At</label>
            <input type="date" value={form.subscription_expires_at} onChange={(e) => setForm({ ...form, subscription_expires_at: e.target.value })} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#1c1410] mb-1 block">Address</label>
            <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className={`${inp} resize-none`} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
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
  const [filterSub, setFilterSub] = useState('');
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
    const matchPlan = !filterPlan || t.plan === filterPlan;
    const matchSub  = !filterSub  || t.subscription_status === filterSub;
    return matchSearch && matchPlan && matchSub;
  });

  const totalUsers = tenants.reduce((a, t) => a + Number(t.user_count), 0);
  const totalLeads = tenants.reduce((a, t) => a + Number(t.lead_count), 0);

  return (
    <div className="space-y-5 pb-10">

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Accounts', value: tenants.length, icon: Building2, color: 'text-primary', bg: 'bg-primary/10' },
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
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <div className="flex gap-2">
            <button onClick={() => setShowDeleted(false)}
              className={cn('px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all',
                !showDeleted ? 'bg-primary text-white' : 'bg-transparent text-[#7a6b5c] hover:bg-gray-100')}>
              Active White Label
            </button>
            <button onClick={() => setShowDeleted(true)}
              className={cn('px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all border',
                showDeleted ? 'bg-primary text-white border-primary' : 'border-gray-200 text-[#7a6b5c] hover:bg-gray-50')}>
              Deleted White Label
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchTenants} disabled={loading}
              className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-primary transition-colors">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button onClick={() => navigate('/admin/create')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-[13px] font-bold transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#c2410c 0%,#ea580c 55%,#f97316 100%)', boxShadow: '0 4px 14px rgba(234,88,12,.28)' }}>
              <Plus className="w-4 h-4" /> CREATE WHITE LABEL
            </button>
          </div>
        </div>

        {/* Sub-header */}
        <div className="px-5 pt-4 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-1 h-4 rounded-full bg-primary" />
            <h2 className="font-headline font-bold text-[#1c1410] text-[15px]">White Label Sub Accounts List</h2>
          </div>
          <p className="text-[12px] text-[#7a6b5c]">You have total <span className="font-semibold text-[#1c1410]">{filtered.length}</span></p>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          {/* Plan filter */}
          <div className="relative">
            <select value={filterPlan} onChange={(e) => setFilterPlan(e.target.value)}
              className="pl-3 pr-7 py-1.5 rounded-lg border border-gray-200 text-[12px] text-[#1c1410] outline-none bg-white appearance-none cursor-pointer hover:border-gray-300 transition-colors">
              <option value="">Filter by Plan</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro / Premium</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
          </div>
          {/* Subscription filter */}
          <div className="relative">
            <select value={filterSub} onChange={(e) => setFilterSub(e.target.value)}
              className="pl-3 pr-7 py-1.5 rounded-lg border border-gray-200 text-[12px] text-[#1c1410] outline-none bg-white appearance-none cursor-pointer hover:border-gray-300 transition-colors">
              <option value="">Filter by Subscription</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="suspended">Suspended</option>
              <option value="trial">Trial</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
          </div>
          {/* Search */}
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 bg-white ml-auto">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts…"
              className="text-[12px] text-[#1c1410] outline-none bg-transparent placeholder:text-gray-300 w-44" />
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          </div>
          {(filterPlan || filterSub || search) && (
            <button onClick={() => { setFilterPlan(''); setFilterSub(''); setSearch(''); }}
              className="text-[11px] text-primary font-medium hover:underline">
              Clear filters
            </button>
          )}
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
                className="mt-1 flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#c2410c 0%,#ea580c 100%)' }}>
                <Plus className="w-4 h-4" /> Create Account
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['#', 'Sub Account Name', 'Active Subscription', 'Sub Account Details', 'Info', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] whitespace-nowrap bg-[#faf8f6]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((t, idx) => (
                  <tr key={t.id} className="hover:bg-[#fafaf9] transition-colors group">
                    {/* # */}
                    <td className="px-4 py-4 text-[#7a6b5c] text-[12px] w-10">{idx + 1}</td>

                    {/* Sub Account Name */}
                    <td className="px-4 py-4 min-w-[160px]">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-[11px] font-bold text-gray-400 shrink-0">
                          {t.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1c1410] truncate">{t.name}</p>
                          {t.phone && <p className="text-[11px] text-[#7a6b5c]">{t.phone}</p>}
                          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide', PLAN_BADGE[t.plan] ?? 'bg-gray-100 text-gray-500')}>
                            {t.plan?.replace('_', ' ') ?? 'starter'}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Active Subscription */}
                    <td className="px-4 py-4 min-w-[150px]">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          {t.subscription_status === 'active'
                            ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                            : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                          <span className={cn('text-[12px] font-semibold capitalize',
                            t.subscription_status === 'active' ? 'text-green-700' : 'text-red-500')}>
                            {t.subscription_status === 'active' ? 'Active Subscription' : t.subscription_status}
                          </span>
                        </div>
                        {t.subscription_expires_at && (
                          <p className="text-[11px] text-[#7a6b5c] pl-5">
                            {format(new Date(t.subscription_expires_at), 'MMM dd, yyyy hh:mm aa')}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Sub Account Details */}
                    <td className="px-4 py-4 min-w-[180px]">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-[11px] font-bold text-gray-500 shrink-0">
                          {(t.admin_name ?? t.name).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1c1410] text-[13px] truncate">{t.admin_name ?? '—'}</p>
                          <p className="text-[11px] text-[#7a6b5c] truncate">{t.admin_email ?? t.email}</p>
                          {t.phone && <p className="text-[11px] text-[#7a6b5c]">{t.phone}</p>}
                        </div>
                      </div>
                    </td>

                    {/* Info */}
                    <td className="px-4 py-4 min-w-[160px]">
                      <p className="text-[11px] text-[#7a6b5c] mb-1.5">
                        {t.last_login_at
                          ? `Last Login: ${format(new Date(t.last_login_at), 'MMM dd, yyyy hh:mm aa')}`
                          : 'Never logged in'}
                      </p>
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', PLAN_BADGE[t.plan] ?? 'bg-gray-100 text-gray-500')}>
                        {PLAN_LABEL[t.plan] ?? t.plan}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1">
                        {/* Login as User */}
                        <button
                          onClick={() => handleImpersonate(t)}
                          disabled={impersonatingId === t.id || !t.is_active}
                          title="Login as User"
                          className={cn('w-8 h-8 flex items-center justify-center rounded-lg border transition-all',
                            t.is_active
                              ? 'border-gray-200 hover:border-primary hover:bg-primary/5 text-gray-400 hover:text-primary'
                              : 'border-gray-100 text-gray-200 cursor-not-allowed')}>
                          {impersonatingId === t.id
                            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            : <LogIn className="w-3.5 h-3.5" />}
                        </button>
                        {/* Edit */}
                        <button onClick={() => setEditTenant(t)} title="Edit"
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:border-primary/50 hover:bg-primary/5 text-gray-400 hover:text-primary transition-all">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {/* Custom Domain */}
                        <button onClick={() => setDomainTenant(t)} title="Custom Domain"
                          className={cn('w-8 h-8 flex items-center justify-center rounded-lg border transition-all',
                            t.domain_status === 'ssl_active'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300'
                              : 'border-gray-200 hover:border-primary/50 hover:bg-primary/5 text-gray-400 hover:text-primary')}>
                          <Globe className="w-3.5 h-3.5" />
                        </button>
                        {/* Email */}
                        <button onClick={() => window.location.href = `mailto:${t.admin_email ?? t.email}`} title="Email"
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all">
                          <Mail className="w-3.5 h-3.5" />
                        </button>
                        {/* More */}
                        <RowMenu tenant={t} onEdit={() => setEditTenant(t)} onRefresh={fetchTenants} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!loading && filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-50 bg-[#faf8f6]">
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
