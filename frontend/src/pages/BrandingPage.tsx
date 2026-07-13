import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Upload, X, Check, Image as ImageIcon, LayoutDashboard, Users, Workflow } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { usePermission } from '@/hooks/usePermission';
import { useBrandingStore, derivePalette } from '@/store/brandingStore';
import { useCompanyStore } from '@/store/companyStore';

const COLOR_PRESETS = [
  '#c2410c', '#ea580c', '#9a3412', '#7f1d1d', '#dc2626',
  '#e11d48', '#db2777', '#a21caf', '#9333ea', '#7c3aed',
  '#4f46e5', '#2563eb', '#0284c7', '#0891b2', '#0d9488',
  '#059669', '#16a34a', '#65a30d', '#a16207', '#78350f',
  '#1e3a8a', '#334155', '#111318',
];

interface BrandingForm {
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
  banner_url: string | null;
  brand_color: string;
  login_bg_color: string | null;
  tab_title: string | null;
  app_bg_color: string | null;
  accent_color: string | null;
}

export default function BrandingPage() {
  const navigate = useNavigate();
  const canManage = usePermission('settings:manage');
  const applyTenantBranding = useBrandingStore((s) => s.applyTenantBranding);
  const setCompanyName = useCompanyStore((s) => s.setCompanyName);
  const setLogo = useCompanyStore((s) => s.setLogo);

  const [form, setForm] = useState<BrandingForm>({
    name: '', logo_url: null, favicon_url: null, banner_url: null,
    brand_color: '#c2410c', login_bg_color: null, tab_title: null,
    app_bg_color: null, accent_color: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const logoRef = useRef<HTMLInputElement>(null);
  const faviconRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<any>('/api/settings/branding')
      .then((d) => setForm({
        name: d.name ?? '',
        logo_url: d.logoUrl ?? null,
        favicon_url: d.faviconUrl ?? null,
        banner_url: d.bannerUrl ?? null,
        brand_color: d.brandColor ?? '#c2410c',
        login_bg_color: d.loginBgColor ?? null,
        tab_title: d.tabTitle ?? null,
        app_bg_color: d.appBgColor ?? null,
        accent_color: d.accentColor ?? null,
      }))
      .catch(() => toast.error('Failed to load branding'))
      .finally(() => setLoading(false));
  }, []);

  const upd = (k: keyof BrandingForm, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleFile = (key: 'logo_url' | 'favicon_url' | 'banner_url', maxMB: number) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > maxMB * 1024 * 1024) { toast.error(`Image must be under ${maxMB} MB`); return; }
      const reader = new FileReader();
      reader.onload = (ev) => upd(key, ev.target?.result as string);
      reader.readAsDataURL(file);
    };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings/branding', {
        name: form.name,
        logo_url: form.logo_url,
        favicon_url: form.favicon_url,
        banner_url: form.banner_url,
        brand_color: form.brand_color,
        tab_title: form.tab_title,
        // Theme is fully derived from brand_color - clear any legacy manual overrides
        app_bg_color: null,
        accent_color: null,
        login_bg_color: null,
      });
      applyTenantBranding({
        name: form.name, logoUrl: form.logo_url, faviconUrl: form.favicon_url,
        bannerUrl: form.banner_url, brandColor: form.brand_color, tabTitle: form.tab_title,
      });
      setCompanyName(form.name || 'CRM');
      setLogo(form.logo_url);
      toast.success('Branding saved');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return <div className="p-8 text-center text-[#6b7280]">You don't have permission to manage branding.</div>;
  }

  const pal = derivePalette(form.brand_color);
  const inp = 'w-full px-3 py-2 rounded-xl border border-[var(--hairline)] text-[15px] text-[#111318] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20 bg-white transition';
  const labelCls = 'text-[14px] font-semibold text-[#111318] mb-1 block';
  const hintCls = 'text-[12px] text-[#8b929c] mt-1';

  const Uploader = ({ url, onPick, onClear, size }: { url: string | null; onPick: () => void; onClear: () => void; size: string }) => (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onPick}
        className={`relative ${size} rounded-xl overflow-hidden group border-2 border-dashed border-[var(--hairline)] hover:border-primary/40 transition-colors bg-[var(--surface-2)] flex items-center justify-center shrink-0`}>
        {url ? <img src={url} alt="" className="w-full h-full object-contain" /> : <ImageIcon className="w-5 h-5 text-[#c3c8cf]" />}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100">
          <Upload className="w-4 h-4 text-white" />
        </div>
      </button>
      {url && (
        <button type="button" onClick={onClear} className="text-[12px] text-red-500 hover:text-red-700 flex items-center gap-1">
          <X className="w-3 h-3" /> Remove
        </button>
      )}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/settings')} className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] text-[#6b7280] transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-headline font-bold text-[#111318] text-lg leading-tight">Branding</h1>
            <p className="text-[14px] text-[#6b7280]">Customize your CRM's logo, colors, and identity</p>
          </div>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="px-5 py-2 rounded-xl text-white text-[15px] font-semibold bg-primary hover:bg-primary/90 active:scale-[0.98] transition disabled:opacity-60 shrink-0">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">

          {/* ── Left: form ── */}
          <div className="space-y-4">

            {/* Identity */}
            <section className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <h2 className="font-semibold text-[#111318] text-[15px] mb-3">Identity</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Company Name</label>
                  <input value={form.name} onChange={(e) => upd('name', e.target.value)} placeholder="Your Company" className={inp} />
                </div>
                <div>
                  <label className={labelCls}>Browser Tab Title</label>
                  <input value={form.tab_title ?? ''} onChange={(e) => upd('tab_title', e.target.value)} placeholder="Your Company CRM" className={inp} />
                </div>
              </div>
            </section>

            {/* Images */}
            <section className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <h2 className="font-semibold text-[#111318] text-[15px] mb-3">Images</h2>
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={handleFile('logo_url', 2)} />
              <input ref={faviconRef} type="file" accept="image/png,image/x-icon,image/svg+xml" hidden onChange={handleFile('favicon_url', 1)} />
              <input ref={bannerRef} type="file" accept="image/*" hidden onChange={handleFile('banner_url', 3)} />
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div><label className={labelCls}>Logo</label><p className={hintCls}>Sidebar & header · PNG/SVG · max 2 MB</p></div>
                  <Uploader url={form.logo_url} onPick={() => logoRef.current?.click()} onClear={() => upd('logo_url', null)} size="w-16 h-16" />
                </div>
                <div className="flex items-center justify-between gap-4 pt-3 border-t border-[var(--hairline)]">
                  <div><label className={labelCls}>Favicon</label><p className={hintCls}>Browser tab &amp; collapsed sidebar · square, e.g. 128×128 · max 1 MB. If empty, your company initial is shown.</p></div>
                  <Uploader url={form.favicon_url} onPick={() => faviconRef.current?.click()} onClear={() => upd('favicon_url', null)} size="w-10 h-10" />
                </div>
                <div className="flex items-center justify-between gap-4 pt-3 border-t border-[var(--hairline)]">
                  <div><label className={labelCls}>Login Banner</label><p className={hintCls}>Login page banner · max 3 MB</p></div>
                  <Uploader url={form.banner_url} onPick={() => bannerRef.current?.click()} onClear={() => upd('banner_url', null)} size="w-24 h-12" />
                </div>
              </div>
            </section>

            {/* Brand Color - one color drives the whole palette */}
            <section className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <h2 className="font-semibold text-[#111318] text-[15px] mb-1">Brand Color</h2>
              <p className={`${hintCls} mb-3 mt-0`}>Pick one color - the system automatically builds a matching palette (background, accents, charts) across your whole CRM.</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {COLOR_PRESETS.map((c) => (
                  <button key={c} type="button" onClick={() => upd('brand_color', c)}
                    className="w-8 h-8 rounded-md border-2 transition-all flex items-center justify-center"
                    style={{ background: c, borderColor: form.brand_color.toLowerCase() === c.toLowerCase() ? '#111318' : 'transparent' }}>
                    {form.brand_color.toLowerCase() === c.toLowerCase() && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="color" value={form.brand_color} onChange={(e) => upd('brand_color', e.target.value)}
                  className="w-9 h-9 rounded-xl border border-[var(--hairline)] cursor-pointer p-0.5 shrink-0" />
                <input value={form.brand_color} onChange={(e) => upd('brand_color', e.target.value)}
                  placeholder="#c2410c" className={`${inp} max-w-[130px] font-mono`} />
              </div>

              {/* Derived palette swatches */}
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-[var(--hairline)]">
                <span className="text-[12px] text-[#8b929c]">Auto palette:</span>
                {(() => { const p = derivePalette(form.brand_color); return (
                  <div className="flex items-center gap-1.5">
                    {[['Primary', p.brand], ['Dark', p.brandDark], ['Light', p.brandLight], ['Accent', p.accentTint], ['Surface', p.appBg]].map(([label, c]) => (
                      <div key={label} className="flex flex-col items-center gap-1">
                        <div className="w-7 h-7 rounded-md border border-[var(--hairline)]" style={{ background: c as string }} />
                        <span className="text-[9px] text-[#8b929c]">{label}</span>
                      </div>
                    ))}
                  </div>
                ); })()}
              </div>
            </section>
          </div>

          {/* ── Right: live preview (sticky) ── */}
          <div className="lg:sticky lg:top-4">
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <h2 className="font-semibold text-[#111318] text-[15px] mb-3">Live Preview</h2>

              {/* Browser tab mock */}
              <div className="flex items-center gap-1.5 bg-[#eceef1] rounded-t-lg px-2 py-1.5 w-fit max-w-full">
                <div className="w-4 h-4 rounded-sm overflow-hidden bg-white flex items-center justify-center shrink-0">
                  {form.favicon_url ? <img src={form.favicon_url} alt="" className="w-full h-full object-contain" /> : <div className="w-2 h-2 rounded-full" style={{ background: form.brand_color }} />}
                </div>
                <span className="text-[12px] text-[#4a4f57] truncate max-w-[160px]">{form.tab_title || form.name || 'Your Company CRM'}</span>
                <X className="w-3 h-3 text-[#8b929c] shrink-0" />
              </div>

              {/* App mock: sidebar + content */}
              <div className="border border-[#eceef1] rounded-b-lg rounded-tr-lg overflow-hidden flex h-[260px]">
                {/* mini sidebar */}
                <div className="w-[88px] border-r border-black/5 flex flex-col shrink-0" style={{ background: pal.appBg }}>
                  <div className="h-12 flex items-center justify-center border-b border-black/5 px-1">
                    {form.logo_url
                      ? <img src={form.logo_url} alt="" className="max-h-8 max-w-full object-contain" />
                      : <span className="text-[10px] font-bold text-[#111318] text-center leading-tight truncate">{form.name || 'Logo'}</span>}
                  </div>
                  <div className="p-1.5 space-y-1">
                    <div className="flex items-center gap-1 px-1.5 py-1 rounded-md" style={{ background: form.brand_color }}>
                      <LayoutDashboard className="w-3 h-3 text-white" /><span className="text-[9px] text-white font-medium">Dashboard</span>
                    </div>
                    <div className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[#6b7280]" style={{ background: pal.accentTint }}>
                      <Users className="w-3 h-3" /><span className="text-[9px]">Leads</span>
                    </div>
                    <div className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[#6b7280]">
                      <Workflow className="w-3 h-3" /><span className="text-[9px]">Automation</span>
                    </div>
                  </div>
                </div>
                {/* mini content */}
                <div className="flex-1 bg-white p-3 flex flex-col gap-2">
                  <div className="h-2.5 w-20 rounded-full bg-[#eceef1]" />
                  <div className="flex gap-1.5">
                    <div className="h-9 flex-1 rounded-md border border-black/5" style={{ background: pal.appBg }} />
                    <div className="h-9 flex-1 rounded-md border border-black/5" style={{ background: pal.appBg }} />
                  </div>
                  <button className="text-[10px] text-white font-semibold rounded-md px-2 py-1.5 w-fit" style={{ background: form.brand_color }}>
                    + Add Lead
                  </button>
                  <div className="space-y-1 mt-1">
                    <div className="h-2 w-full rounded-full bg-[#eef1f4]" />
                    <div className="h-2 w-4/5 rounded-full bg-[#eef1f4]" />
                    <div className="h-2 w-3/5 rounded-full bg-[#eef1f4]" />
                  </div>
                </div>
              </div>

              <p className="text-[12px] text-[#8b929c] mt-3 text-center">Changes apply across your whole CRM after saving.</p>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
