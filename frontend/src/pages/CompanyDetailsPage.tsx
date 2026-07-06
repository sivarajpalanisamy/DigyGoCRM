import { useState, useEffect, useRef } from 'react';
import {
  RefreshCw, Check, ArrowLeft, ShieldCheck, ChevronRight, ChevronDown,
  Globe, Phone, MapPin, Building2, Briefcase, Clock, DollarSign, CalendarDays, Camera,
  PhoneCall, Plus, Trash2, GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useCompanyStore } from '@/store/companyStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';

const EMOJI_OPTIONS = ['👍','📞','🔁','😐','👎','🤝','🎯','⏳','❌','✅','🔔','💬','📧','🏷️','⚡'];
const COLOR_OPTIONS = [
  { name: 'emerald', cls: 'bg-emerald-400' }, { name: 'blue', cls: 'bg-blue-400' },
  { name: 'amber', cls: 'bg-amber-400' }, { name: 'gray', cls: 'bg-gray-400' },
  { name: 'red', cls: 'bg-red-400' }, { name: 'purple', cls: 'bg-purple-400' },
  { name: 'orange', cls: 'bg-orange-400' }, { name: 'pink', cls: 'bg-pink-400' },
  { name: 'cyan', cls: 'bg-cyan-400' }, { name: 'yellow', cls: 'bg-yellow-400' },
];

interface DispositionItem {
  key: string; label: string; icon: string; color: string; lead_quality?: string | null;
}

const TIMEZONES = ['Asia/Kolkata (IST +5:30)', 'Asia/Dubai (GST +4:00)', 'Europe/London (GMT +0:00)', 'America/New_York (EST -5:00)', 'America/Los_Angeles (PST -8:00)'];
const CURRENCIES = ['INR - Indian Rupee (₹)', 'USD - US Dollar ($)', 'EUR - Euro (€)', 'GBP - British Pound (£)', 'AED - UAE Dirham (د.إ)'];
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

const labelCls = 'block text-[11px] font-bold uppercase tracking-[0.08em] text-[#7a6b5c] mb-1.5';
const inputCls = 'w-full bg-[#f5f0eb] border border-black/8 rounded-xl px-4 py-2.5 text-[14px] text-[#1c1410] outline-none focus:ring-2 focus:ring-primary/20 transition-shadow resize-none';

function Field({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>
        <span className="inline-flex items-center gap-1.5">
          <Icon className="w-3 h-3 text-[#9e8e7e]" />
          {label}
        </span>
      </label>
      {children}
    </div>
  );
}

function SelectField({ label, icon: Icon, value, onChange, options }: {
  label: string; icon: React.ElementType; value: string;
  onChange: (v: string) => void; options: string[];
}) {
  return (
    <Field label={label} icon={Icon}>
      <div className="relative">
        <select
          className={`${inputCls} appearance-none cursor-pointer pr-9`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => <option key={o}>{o}</option>)}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9e8e7e] pointer-events-none" />
      </div>
    </Field>
  );
}

function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <Button onClick={onClick} disabled={saving} size="sm">
      {saving
        ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
        : <><Check className="w-3.5 h-3.5 mr-1.5" /> Save Changes</>}
    </Button>
  );
}

export default function CompanyDetailsPage() {
  const navigate = useNavigate();
  const { setCompanyName } = useCompanyStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [plan, setPlan] = useState('');
  const [memberSince, setMemberSince] = useState('');
  const [form, setForm] = useState({
    name: '', legalName: '', website: '', phone: '',
    address: '', timezone: TIMEZONES[0], currency: CURRENCIES[0],
    dateFormat: DATE_FORMATS[0], industry: '',
  });
  const [dispositions, setDispositions] = useState<DispositionItem[]>([]);
  const [savingDisp, setSavingDisp] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    api.get<any>('/api/settings').then((s) => {
      if (!s) return;
      setOwnerName(s.owner_name ?? '');
      setPlan(s.plan ?? '');
      if (s.tenant_created_at) {
        setMemberSince(new Date(s.tenant_created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));
      }
      if (s.logo_url) setLogoPreview(s.logo_url);
      setForm({
        name:       s.workspace_name               ?? '',
        legalName:  s.legal_name                   ?? '',
        website:    s.website                      ?? '',
        phone:      s.tenant_phone ?? s.phone      ?? '',
        address:    s.tenant_address ?? s.address  ?? '',
        timezone:   s.timezone                     ?? TIMEZONES[0],
        currency:   s.currency                     ?? CURRENCIES[0],
        dateFormat: s.date_format                  ?? DATE_FORMATS[0],
        industry:   s.industry                     ?? '',
      });
    }).catch(() => null).finally(() => setLoading(false));
    const defaultDisps: DispositionItem[] = [
      { key: 'interested',      label: 'Interested',      icon: '👍', color: 'emerald', lead_quality: 'Hot'  },
      { key: 'callback_later',  label: 'Callback Later',  icon: '🕐', color: 'blue',    lead_quality: null   },
      { key: 'not_reachable',   label: 'Not Reachable',   icon: '📵', color: 'red',     lead_quality: null   },
      { key: 'not_interested',  label: 'Not Interested',  icon: '😕', color: 'gray',    lead_quality: 'Cold' },
      { key: 'deal_closed',     label: 'Deal Closed',     icon: '🤝', color: 'orange',  lead_quality: null   },
      { key: 'follow_up_set',   label: 'Follow-up Set',   icon: '📅', color: 'purple',  lead_quality: null   },
    ];
    api.get<DispositionItem[]>('/api/settings/dispositions')
      .then((d) => setDispositions(d?.length ? d : defaultDisps))
      .catch(() => setDispositions(defaultDisps));
  }, []);

  const update = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Logo must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Workspace name is required'); return; }
    setSaving(true);
    try {
      await api.put('/api/settings', {
        workspace_name: form.name.trim(),
        legal_name:     form.legalName,
        website:        form.website,
        phone:          form.phone,
        address:        form.address,
        timezone:       form.timezone,
        currency:       form.currency,
        date_format:    form.dateFormat,
        industry:       form.industry,
      });
      setCompanyName(form.name.trim());
      toast.success('Company details saved');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addDisposition = () => {
    const idx = dispositions.length + 1;
    setDispositions([...dispositions, { key: `custom_${Date.now()}`, label: '', icon: '📞', color: 'blue' }]);
  };
  const updateDisp = (i: number, patch: Partial<DispositionItem>) => {
    setDispositions((d) => d.map((item, idx) => idx === i ? { ...item, ...patch } : item));
  };
  const removeDisp = (i: number) => {
    if (dispositions.length <= 1) { toast.error('At least one outcome is required'); return; }
    setDispositions((d) => d.filter((_, idx) => idx !== i));
  };
  const handleDragStart = (i: number) => setDragIdx(i);
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    setDispositions((d) => {
      const copy = [...d];
      const [moved] = copy.splice(dragIdx, 1);
      copy.splice(i, 0, moved);
      return copy;
    });
    setDragIdx(i);
  };
  const saveDispositions = async () => {
    const invalid = dispositions.find((d) => !d.label.trim());
    if (invalid) { toast.error('All outcomes need a label'); return; }
    setSavingDisp(true);
    try {
      const cleaned = dispositions.map((d) => ({
        ...d,
        key: d.key || d.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label: d.label.trim(),
      }));
      await api.put('/api/settings/dispositions', { dispositions: cleaned });
      setDispositions(cleaned);
      toast.success('Call outcomes saved');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save');
    } finally {
      setSavingDisp(false);
    }
  };

  const initials = form.name.trim()
    ? form.name.trim().split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[#9e8e7e] text-sm">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => navigate('/settings')}
            className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[#1c1410] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="font-headline font-bold text-[17px] text-[#1c1410]">Company Details</h2>
        </div>
        <SaveButton saving={saving} onClick={handleSave} />
      </div>

      {/* Profile card - clean, no orange banner */}
      <div className="bg-white rounded-2xl border border-black/5 p-5 flex items-center gap-5">

        {/* Logo upload */}
        <div className="shrink-0">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleLogoChange}
          />
          <button
            onClick={() => logoInputRef.current?.click()}
            className="relative w-20 h-20 rounded-2xl overflow-hidden group border-2 border-dashed border-black/10 hover:border-primary/40 transition-colors bg-[var(--app-bg)] flex items-center justify-center"
            title="Upload company logo"
          >
            {logoPreview
              ? <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
              : (
                <span className="text-[22px] font-bold text-[#c4b09e] select-none">
                  {initials}
                </span>
              )
            }
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
              <Camera className="w-5 h-5 text-white" />
              <span className="text-[10px] text-white font-semibold">Upload</span>
            </div>
          </button>
          <p className="text-[10px] text-[#b09e8d] text-center mt-1.5">Max 2 MB</p>
        </div>

        {/* Company info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-headline font-bold text-[18px] text-[#1c1410] truncate leading-tight">
            {form.name || 'Your Company'}
          </h3>
          {ownerName && (
            <p className="text-[14px] text-[#7a6b5c] mt-0.5 truncate">{ownerName}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            {plan && (
              <span className="bg-primary/10 text-primary text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize">
                {plan} Plan
              </span>
            )}
            {memberSince && (
              <span className="text-[11px] text-[#b09e8d]">Member since {memberSince}</span>
            )}
          </div>
        </div>
      </div>

      {/* Business Information */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-black/5">
          <h3 className="font-headline font-semibold text-[15px] text-[#1c1410]">Business Information</h3>
          <p className="text-[11px] text-[#9e8e7e] mt-0.5">Your company profile and contact details</p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Workspace Name *" icon={Building2}>
            <Input
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Your Company Name"
              className="text-[14px]"
            />
          </Field>
          <Field label="Legal Name" icon={Briefcase}>
            <Input
              value={form.legalName}
              onChange={(e) => update('legalName', e.target.value)}
              placeholder="Legal entity name"
              className="text-[14px]"
            />
          </Field>
          <Field label="Website" icon={Globe}>
            <Input
              value={form.website}
              onChange={(e) => update('website', e.target.value)}
              placeholder="https://yourcompany.com"
              type="url"
              className="text-[14px]"
            />
          </Field>
          <Field label="Industry" icon={Briefcase}>
            <Input
              value={form.industry}
              onChange={(e) => update('industry', e.target.value)}
              placeholder="e.g. Technology, Retail"
              className="text-[14px]"
            />
          </Field>
          <Field label="Phone" icon={Phone}>
            <Input
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="+91 98765 43210"
              type="tel"
              className="text-[14px]"
            />
          </Field>
          <Field label="Business Address" icon={MapPin}>
            <textarea
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
              placeholder={"Street, City\nState, PIN"}
              rows={3}
              className={inputCls}
            />
          </Field>
        </div>
      </div>

      {/* Localization */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-black/5">
          <h3 className="font-headline font-semibold text-[15px] text-[#1c1410]">Localization</h3>
          <p className="text-[11px] text-[#9e8e7e] mt-0.5">Regional settings for dates, currency and time</p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SelectField label="Timezone" icon={Clock} value={form.timezone} onChange={(v) => update('timezone', v)} options={TIMEZONES} />
          <SelectField label="Currency" icon={DollarSign} value={form.currency} onChange={(v) => update('currency', v)} options={CURRENCIES} />
          <SelectField label="Date Format" icon={CalendarDays} value={form.dateFormat} onChange={(v) => update('dateFormat', v)} options={DATE_FORMATS} />
        </div>
      </div>

      {/* Call Dispositions */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
          <div>
            <h3 className="font-headline font-semibold text-[15px] text-[#1c1410] flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-[#9e8e7e]" /> Call Outcomes
            </h3>
            <p className="text-[11px] text-[#9e8e7e] mt-0.5">Configure the outcome options shown after a call</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={addDisposition} className="text-[13px] font-semibold text-primary hover:text-primary/80 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
            <Button onClick={saveDispositions} disabled={savingDisp} size="sm" variant="outline">
              {savingDisp ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
              Save
            </Button>
          </div>
        </div>
        <div className="p-5 space-y-2">
          {dispositions.map((d, i) => (
            <div
              key={d.key}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={() => setDragIdx(null)}
              className="flex items-center gap-3 bg-[#faf8f6] rounded-xl px-3 py-2.5 border border-black/5 group"
            >
              <GripVertical className="w-3.5 h-3.5 text-[#c4b09e] cursor-grab shrink-0" />

              {/* Emoji picker */}
              <div className="relative shrink-0">
                <button className="text-lg w-8 h-8 rounded-lg hover:bg-white flex items-center justify-center" title="Pick icon"
                  onClick={(e) => {
                    const el = e.currentTarget.nextElementSibling as HTMLElement;
                    el.classList.toggle('hidden');
                  }}>
                  {d.icon}
                </button>
                <div className="hidden absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-black/10 p-2 grid grid-cols-5 gap-1 z-50">
                  {EMOJI_OPTIONS.map((em) => (
                    <button key={em} className="w-8 h-8 text-lg hover:bg-gray-100 rounded-lg" onClick={(e) => {
                      updateDisp(i, { icon: em });
                      (e.currentTarget.parentElement as HTMLElement).classList.add('hidden');
                    }}>{em}</button>
                  ))}
                </div>
              </div>

              {/* Label */}
              <input
                value={d.label}
                onChange={(e) => updateDisp(i, { label: e.target.value })}
                placeholder="Outcome label"
                className="flex-1 min-w-0 bg-transparent text-[14px] text-[#1c1410] outline-none placeholder:text-gray-300"
              />

              {/* Color picker */}
              <div className="flex items-center gap-1 shrink-0">
                {COLOR_OPTIONS.map((c) => (
                  <button key={c.name} title={c.name}
                    className={`w-4 h-4 rounded-full ${c.cls} transition-all ${d.color === c.name ? 'ring-2 ring-offset-1 ring-current scale-125' : 'opacity-50 hover:opacity-100'}`}
                    onClick={() => updateDisp(i, { color: c.name })}
                  />
                ))}
              </div>

              {/* Lead quality */}
              <select
                value={d.lead_quality ?? ''}
                onChange={(e) => updateDisp(i, { lead_quality: e.target.value || null })}
                className="text-[11px] bg-white border border-gray-200 rounded-lg px-2 py-1 text-[#7a6b5c] outline-none shrink-0"
                title="Auto-set lead quality on this outcome"
              >
                <option value="">No quality change</option>
                <option value="Hot">Hot</option>
                <option value="Warm">Warm</option>
                <option value="Cold">Cold</option>
                <option value="Unqualified">Unqualified</option>
              </select>

              {/* Delete */}
              <button onClick={() => removeDisp(i)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all shrink-0" title="Remove">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {dispositions.length === 0 && (
            <p className="text-[13px] text-[#9e8e7e] text-center py-4">No outcomes configured. Click "Add" to create one.</p>
          )}
        </div>
      </div>

      {/* Bottom save - so users don't need to scroll back up */}
      <div className="flex justify-end pt-1">
        <SaveButton saving={saving} onClick={handleSave} />
      </div>

      {/* Super Admin panel link */}
      {isSuperAdmin && (
        <button
          onClick={() => navigate('/admin')}
          className="w-full bg-white rounded-2xl border border-black/5 p-4 flex items-center gap-3 hover:bg-[var(--app-bg)] transition-colors text-left group"
        >
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-[#1c1410]">Business Accounts</p>
            <p className="text-[11px] text-[#9e8e7e]">Manage all CRM accounts under Hawcus</p>
          </div>
          <ChevronRight className="w-4 h-4 text-[#c4b09e] group-hover:text-primary transition-colors shrink-0" />
        </button>
      )}

    </div>
  );
}
