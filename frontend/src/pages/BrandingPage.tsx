import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Upload, X, Check, Image as ImageIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { usePermission } from '@/hooks/usePermission';
import { useBrandingStore } from '@/store/brandingStore';
import { useCompanyStore } from '@/store/companyStore';

const COLOR_PRESETS = [
  '#c2410c', '#ea580c', '#dc2626', '#e11d48', '#db2777',
  '#9333ea', '#7c3aed', '#4f46e5', '#2563eb', '#0284c7',
  '#0891b2', '#059669', '#16a34a', '#65a30d', '#ca8a04',
  '#1c1410', '#374151', '#0f172a',
];

interface BrandingForm {
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
  banner_url: string | null;
  brand_color: string;
  login_bg_color: string | null;
  tab_title: string | null;
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
        login_bg_color: form.login_bg_color,
        tab_title: form.tab_title,
      });
      // Apply immediately so the change is visible without reload
      applyTenantBranding({
        name: form.name,
        logoUrl: form.logo_url,
        faviconUrl: form.favicon_url,
        bannerUrl: form.banner_url,
        brandColor: form.brand_color,
        loginBgColor: form.login_bg_color,
        tabTitle: form.tab_title,
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
    return <div className="p-8 text-center text-[#7a6b5c]">You don't have permission to manage branding.</div>;
  }

  const inp = 'w-full px-3 py-2 rounded-xl border border-[#e8ddd4] text-sm text-[#1c1410] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 bg-white';

  const UploadBox = ({ url, onPick, onClear, label, hint, aspect }: {
    url: string | null; onPick: () => void; onClear: () => void; label: string; hint: string; aspect: string;
  }) => (
    <div>
      <label className="text-xs font-semibold text-[#1c1410] mb-1.5 block">{label}</label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onPick}
          className={`relative ${aspect} rounded-xl overflow-hidden group border-2 border-dashed border-black/10 hover:border-primary/40 transition-colors bg-[#faf8f6] flex items-center justify-center shrink-0`}>
          {url
            ? <img src={url} alt={label} className="w-full h-full object-contain" />
            : <ImageIcon className="w-6 h-6 text-[#c4b09e]" />}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100">
            <Upload className="w-5 h-5 text-white" />
          </div>
        </button>
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-[#7a6b5c]">{hint}</p>
          {url && (
            <button type="button" onClick={onClear} className="text-[11px] text-red-500 hover:text-red-700 flex items-center gap-1 w-fit">
              <X className="w-3 h-3" /> Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/settings')} className="p-1.5 rounded-lg hover:bg-[#f5ede3] text-[#7a6b5c]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-headline font-bold text-[#1c1410] text-lg">Branding</h1>
          <p className="text-[12px] text-[#7a6b5c]">Customize your CRM's logo, colors, and identity</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Identity */}
          <section className="bg-white rounded-2xl border border-black/5 p-5 space-y-4">
            <h2 className="font-semibold text-[#1c1410] text-sm">Identity</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-[#1c1410] mb-1.5 block">Company Name</label>
                <input value={form.name} onChange={(e) => upd('name', e.target.value)} placeholder="Your Company" className={inp} />
                <p className="text-[11px] text-[#7a6b5c] mt-1">Shown in the sidebar, header, and login page.</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#1c1410] mb-1.5 block">Browser Tab Title</label>
                <input value={form.tab_title ?? ''} onChange={(e) => upd('tab_title', e.target.value)} placeholder="Your Company CRM" className={inp} />
                <p className="text-[11px] text-[#7a6b5c] mt-1">Text shown on the browser tab.</p>
              </div>
            </div>
          </section>

          {/* Images */}
          <section className="bg-white rounded-2xl border border-black/5 p-5 space-y-5">
            <h2 className="font-semibold text-[#1c1410] text-sm">Images</h2>
            <input ref={logoRef} type="file" accept="image/*" hidden onChange={handleFile('logo_url', 2)} />
            <input ref={faviconRef} type="file" accept="image/png,image/x-icon,image/svg+xml" hidden onChange={handleFile('favicon_url', 1)} />
            <input ref={bannerRef} type="file" accept="image/*" hidden onChange={handleFile('banner_url', 3)} />

            <UploadBox url={form.logo_url} onPick={() => logoRef.current?.click()} onClear={() => upd('logo_url', null)}
              label="Logo" hint="Shown in sidebar & header. PNG/SVG, max 2 MB." aspect="w-20 h-20" />
            <UploadBox url={form.favicon_url} onPick={() => faviconRef.current?.click()} onClear={() => upd('favicon_url', null)}
              label="Favicon" hint="Browser tab icon. Square PNG/ICO, max 1 MB." aspect="w-12 h-12" />
            <UploadBox url={form.banner_url} onPick={() => bannerRef.current?.click()} onClear={() => upd('banner_url', null)}
              label="Login Banner" hint="Banner image on the login page. Max 3 MB." aspect="w-32 h-16" />
          </section>

          {/* Colors */}
          <section className="bg-white rounded-2xl border border-black/5 p-5 space-y-4">
            <h2 className="font-semibold text-[#1c1410] text-sm">Colors</h2>

            <div>
              <label className="text-xs font-semibold text-[#1c1410] mb-2 block">Primary / CRM Color</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {COLOR_PRESETS.map((c) => (
                  <button key={c} type="button" onClick={() => upd('brand_color', c)}
                    className="w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center"
                    style={{ background: c, borderColor: form.brand_color.toLowerCase() === c.toLowerCase() ? '#1c1410' : 'transparent' }}>
                    {form.brand_color.toLowerCase() === c.toLowerCase() && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="color" value={form.brand_color} onChange={(e) => upd('brand_color', e.target.value)}
                  className="w-10 h-10 rounded-lg border border-[#e8ddd4] cursor-pointer p-0.5" />
                <input value={form.brand_color} onChange={(e) => upd('brand_color', e.target.value)}
                  placeholder="#c2410c" className={`${inp} max-w-[140px] font-mono`} />
                {/* Live preview */}
                <span className="px-4 py-2 rounded-lg text-white text-sm font-semibold ml-2" style={{ background: form.brand_color }}>
                  Preview
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-black/5">
              <label className="text-xs font-semibold text-[#1c1410] mb-2 block">Login Page Background</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.login_bg_color ?? '#faf8f6'} onChange={(e) => upd('login_bg_color', e.target.value)}
                  className="w-10 h-10 rounded-lg border border-[#e8ddd4] cursor-pointer p-0.5" />
                <input value={form.login_bg_color ?? ''} onChange={(e) => upd('login_bg_color', e.target.value || null)}
                  placeholder="Leave blank for default" className={`${inp} max-w-[220px] font-mono`} />
                {form.login_bg_color && (
                  <button type="button" onClick={() => upd('login_bg_color', null)} className="text-[11px] text-red-500 hover:text-red-700">Reset</button>
                )}
              </div>
              <p className="text-[11px] text-[#7a6b5c] mt-1">Only applies on your custom domain's login page.</p>
            </div>
          </section>

          {/* Save */}
          <div className="flex justify-end">
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold bg-primary hover:bg-primary/90 transition-colors disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Branding'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
