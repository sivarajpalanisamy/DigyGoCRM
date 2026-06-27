import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, X, RefreshCw, Check, Mail, ExternalLink, Unplug, Eye, EyeOff, QrCode, Wifi, WifiOff, BarChart2, Plus, Trash2, ChevronLeft, Pencil } from 'lucide-react';
import { getSocket } from '@/lib/socket';
import { useCrmStore } from '@/store/crmStore';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import CreateCustomFieldModal from '@/components/CreateCustomFieldModal';

// ── Brand icons ────────────────────────────────────────────────────────────────

function FacebookIcon() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-[#1877F2] flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    </div>
  );
}

function InstagramIcon() {
  return (
    <div className="w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 50%, #8134af 100%)' }}>
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-[#25D366] flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    </div>
  );
}

function EmailIcon() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-[#6366f1] flex items-center justify-center shrink-0">
      <Mail className="w-6 h-6 text-white" />
    </div>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full',
      connected
        ? 'bg-emerald-50 text-emerald-600'
        : 'bg-[#f5f0eb] text-[#9e8e7e]'
    )}>
      {connected ? <><Check className="w-2.5 h-2.5" />Connected</> : 'Not connected'}
    </span>
  );
}

// ── Modal shell ────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, footer }: {
  title: string; onClose: () => void;
  children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
          <p className="text-[15px] font-bold text-[#1c1410]">{title}</p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">{children}</div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-black/5 bg-[var(--app-bg)]">{footer}</div>
      </div>
    </div>
  );
}

const labelCls = 'block text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245] mb-1';

// ── WABA modal ─────────────────────────────────────────────────────────────────

// Loads the Facebook JS SDK once and resolves with the FB global (initialised).
let fbSdkPromise: Promise<any> | null = null;
function loadFbSdk(appId: string, version: string): Promise<any> {
  const w = window as any;
  if (w.FB) return Promise.resolve(w.FB);
  if (fbSdkPromise) return fbSdkPromise;
  fbSdkPromise = new Promise((resolve, reject) => {
    w.fbAsyncInit = () => {
      w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(w.FB);
    };
    const id = 'facebook-jssdk';
    if (document.getElementById(id)) return;
    const js = document.createElement('script');
    js.id = id;
    js.src = 'https://connect.facebook.net/en_US/sdk.js';
    js.async = true; js.defer = true; js.crossOrigin = 'anonymous';
    js.onerror = () => { fbSdkPromise = null; reject(new Error('Failed to load Facebook SDK')); };
    document.body.appendChild(js);
  });
  return fbSdkPromise;
}

type EsConfig = { available: boolean; appId: string; configId: string; graphVersion: string };

function WabaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ phone_number_id: '', waba_id: '', access_token: '', phone_number: '' });
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [esConfig, setEsConfig] = useState<EsConfig | null>(null);
  const [esBusy, setEsBusy] = useState(false);
  const sessionInfoRef = useRef<{ waba_id?: string; phone_number_id?: string }>({});
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Load Embedded Signup config + listen for the WhatsApp session-info postMessage.
  useEffect(() => {
    api.get<EsConfig>('/api/integrations/waba/embedded-config')
      .then((c) => { setEsConfig(c); if (c?.available) loadFbSdk(c.appId, c.graphVersion).catch(() => {}); })
      .catch(() => {});

    const onMessage = (event: MessageEvent) => {
      if (typeof event.origin === 'string' && !event.origin.endsWith('facebook.com')) return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data?.data) {
          sessionInfoRef.current = { waba_id: data.data.waba_id, phone_number_id: data.data.phone_number_id };
        }
      } catch { /* not a JSON message we care about */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const launchSignup = async () => {
    if (!esConfig?.available) return;
    setEsBusy(true);
    try {
      const FB = await loadFbSdk(esConfig.appId, esConfig.graphVersion);
      FB.login((response: any) => {
        const code = response?.authResponse?.code;
        if (!code) { setEsBusy(false); toast.error('WhatsApp sign-up was cancelled'); return; }
        const { waba_id, phone_number_id } = sessionInfoRef.current;
        if (!waba_id || !phone_number_id) {
          setEsBusy(false);
          toast.error('Could not read your WhatsApp account info - please try again');
          return;
        }
        api.post('/api/integrations/waba/embedded-signup', { code, waba_id, phone_number_id })
          .then((r: any) => { toast.success(`WhatsApp connected${r?.phoneNumber ? ` (${r.phoneNumber})` : ''}!`); onSaved(); })
          .catch((e: any) => toast.error(e.message ?? 'Failed to finish WhatsApp signup'))
          .finally(() => setEsBusy(false));
      }, {
        config_id: esConfig.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      });
    } catch {
      setEsBusy(false);
      toast.error('Could not start Facebook sign-up');
    }
  };

  const handleSave = async () => {
    if (!form.phone_number_id.trim() || !form.waba_id.trim() || !form.access_token.trim()) {
      toast.error('Phone Number ID, WABA ID and Access Token are required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/integrations/waba/setup', {
        phone_number_id: form.phone_number_id.trim(),
        waba_id: form.waba_id.trim(),
        access_token: form.access_token.trim(),
        phone_number: form.phone_number.trim() || undefined,
      });
      toast.success('WhatsApp Business connected!');
      onSaved();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to connect WhatsApp Business');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Connect WhatsApp Business API" onClose={onClose} footer={
      <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Connecting…</> : <><Check className="w-3.5 h-3.5 mr-1.5" />Connect</>}
        </Button>
      </>
    }>
      {/* Embedded Signup — the recommended self-serve path */}
      {esConfig?.available && (
        <div className="rounded-xl border border-[#1877F2]/30 bg-[#1877F2]/5 p-3.5 mb-1">
          <p className="text-[12px] text-[#5c5245] mb-2.5 leading-relaxed">
            <strong className="text-[#1c1410]">Recommended.</strong> Connect your own WhatsApp number — Meta
            guides you through it in a popup. No tokens to copy.
          </p>
          <button
            type="button"
            onClick={launchSignup}
            disabled={esBusy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#1877F2] text-white text-sm font-semibold py-2.5 hover:bg-[#1568d8] disabled:opacity-60 transition-colors"
          >
            {esBusy
              ? <><RefreshCw className="w-4 h-4 animate-spin" />Connecting…</>
              : <>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                  Connect with Facebook
                </>}
          </button>
        </div>
      )}

      {esConfig?.available && (
        <div className="flex items-center gap-3 my-1">
          <div className="h-px flex-1 bg-black/10" />
          <span className="text-[10px] uppercase tracking-wider text-[#b09e8d]">or enter credentials manually</span>
          <div className="h-px flex-1 bg-black/10" />
        </div>
      )}

      <p className="text-[12px] text-[#7a6b5c]">Get these values from your Meta Business Manager → WhatsApp → API Setup.</p>
      <div>
        <label className={labelCls}>Phone Number ID *</label>
        <Input value={form.phone_number_id} onChange={(e) => set('phone_number_id', e.target.value)} placeholder="123456789012345" />
      </div>
      <div>
        <label className={labelCls}>WABA ID (Business Account ID) *</label>
        <Input value={form.waba_id} onChange={(e) => set('waba_id', e.target.value)} placeholder="987654321098765" />
      </div>
      <div>
        <label className={labelCls}>Permanent Access Token *</label>
        <div className="relative">
          <Input
            value={form.access_token}
            onChange={(e) => set('access_token', e.target.value)}
            type={showToken ? 'text' : 'password'}
            placeholder="EAAxxxxxxxxxxxxxxx"
            className="pr-9"
          />
          <button type="button" onClick={() => setShowToken((s) => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9e8e7e] hover:text-[#1c1410]">
            {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div>
        <label className={labelCls}>Phone Number (optional)</label>
        <Input value={form.phone_number} onChange={(e) => set('phone_number', e.target.value)} placeholder="+91 98765 43210" />
        <p className="text-[10px] text-[#b09e8d] mt-1">Leave blank to auto-resolve from Meta</p>
      </div>
    </Modal>
  );
}

// ── SMTP modal ─────────────────────────────────────────────────────────────────

function SmtpModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    host: '', port: '587', user: '', password: '', from_email: '', from_name: '',
    encryption: 'tls' as 'tls' | 'ssl' | 'none', enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [testTo, setTestTo] = useState('');
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Load existing config
  useEffect(() => {
    api.get<any>('/api/integrations/smtp/status').then((data) => {
      if (data.host) {
        setForm({
          host: data.host || '', port: String(data.port || 587),
          user: data.user || '', password: '',
          from_email: data.from_email || '', from_name: data.from_name || '',
          encryption: data.encryption || 'tls', enabled: data.enabled !== false,
        });
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    if (!form.host.trim() || !form.user.trim() || !form.password.trim()) {
      toast.error('Host, Username and Password are required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/integrations/smtp/setup', {
        host: form.host.trim(),
        port: parseInt(form.port) || (form.encryption === 'ssl' ? 465 : 587),
        secure: form.encryption === 'ssl',
        user: form.user.trim(),
        password: form.password,
        from_email: form.from_email.trim() || form.user.trim(),
        from_name: form.from_name.trim(),
        encryption: form.encryption,
      });
      toast.success('SMTP configuration saved!');
      onSaved();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save SMTP settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await api.post<any>('/api/integrations/smtp/test');
      if (r.success) toast.success(r.message || 'SMTP connection verified!');
      else toast.error(r.error || 'Connection test failed');
    } catch (err: any) { toast.error(err.message ?? 'Test failed'); }
    finally { setTesting(false); }
  };

  const handleSendTest = async () => {
    setSendingTest(true);
    try {
      const r = await api.post<any>('/api/integrations/smtp/send-test', { to: testTo.trim() || undefined });
      if (r.success) toast.success(r.message || 'Test email sent!');
      else toast.error(r.error || 'Failed to send test email');
    } catch (err: any) { toast.error(err.message ?? 'Send failed'); }
    finally { setSendingTest(false); }
  };

  const handleToggle = async () => {
    const newVal = !form.enabled;
    try {
      await api.put('/api/integrations/smtp/toggle', { enabled: newVal });
      set('enabled', newVal);
      toast.success(newVal ? 'Email configuration enabled' : 'Email configuration disabled');
    } catch { toast.error('Failed to toggle'); }
  };

  if (!loaded) return (
    <Modal title="Email Configuration" onClose={onClose} footer={null}>
      <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-primary" /></div>
    </Modal>
  );

  return (
    <Modal title="Email Configuration" onClose={onClose} footer={
      <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Check className="w-3.5 h-3.5 mr-1.5" />Save Configuration</>}
        </Button>
      </>
    }>
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-1">
        <p className="text-[12px] text-blue-700">
          <strong>Note:</strong> Make sure your SMTP settings are correct. Test the configuration and send a test email before enabling.
        </p>
      </div>

      <div>
        <label className={labelCls}>Email Provider</label>
        <select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:border-primary/50"
          value="smtp" disabled>
          <option value="smtp">SMTP</option>
        </select>
      </div>

      <div>
        <label className={labelCls}>SMTP Host *</label>
        <Input value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="mail.yourcompany.com" />
      </div>

      <div>
        <label className={labelCls}>SMTP Username *</label>
        <Input value={form.user} onChange={(e) => set('user', e.target.value)} placeholder="you@yourcompany.com" type="email" />
      </div>

      <div>
        <label className={labelCls}>SMTP Password *</label>
        <div className="relative">
          <Input
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            type={showPass ? 'text' : 'password'}
            placeholder="••••••••••••••••"
            className="pr-9"
          />
          <button type="button" onClick={() => setShowPass((s) => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9e8e7e] hover:text-[#1c1410]">
            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>SMTP Port</label>
          <Input value={form.port} onChange={(e) => set('port', e.target.value)} placeholder="587" type="number" />
        </div>
        <div>
          <label className={labelCls}>SMTP Encryption</label>
          <select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:border-primary/50"
            value={form.encryption}
            onChange={(e) => {
              const enc = e.target.value as 'tls' | 'ssl' | 'none';
              setForm((f) => ({ ...f, encryption: enc, port: enc === 'ssl' ? '465' : enc === 'tls' ? '587' : f.port }));
            }}>
            <option value="tls">TLS</option>
            <option value="ssl">SSL</option>
            <option value="none">None</option>
          </select>
          <p className="text-[10px] text-[#b09e8d] mt-1">Select TLS or SSL if your SMTP provider requires encryption. Choose None for no encryption.</p>
        </div>
      </div>

      <div>
        <label className={labelCls}>From Address</label>
        <Input value={form.from_email} onChange={(e) => set('from_email', e.target.value)} placeholder="noreply@yourcompany.com" type="email" />
        <p className="text-[10px] text-[#b09e8d] mt-1">Defaults to username if left blank</p>
      </div>

      <div>
        <label className={labelCls}>From Name</label>
        <Input value={form.from_name} onChange={(e) => set('from_name', e.target.value)} placeholder="Your Company Name" />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={handleTest} disabled={testing}
          className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[#3b82f6] hover:bg-[#2563eb] transition-colors disabled:opacity-60">
          {testing ? 'Testing…' : 'Test Configuration'}
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="recipient@email.com" className="text-sm flex-1" />
          <button onClick={handleSendTest} disabled={sendingTest}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[#7c3aed] hover:bg-[#6d28d9] transition-colors disabled:opacity-60 whitespace-nowrap">
            {sendingTest ? 'Sending…' : 'Send Test Email'}
          </button>
        </div>
      </div>

      {/* Enable/Disable toggle */}
      <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-100">
        <div>
          <p className="text-[13px] font-semibold text-[#1c1410]">Enable Email Configuration</p>
          <p className="text-[11px] text-[#7a6b5c]">Toggle to enable or disable your custom email config</p>
        </div>
        <div onClick={handleToggle}
          className={cn('w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer', form.enabled ? 'bg-primary' : 'bg-[#d4c9bc]')}>
          <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', form.enabled ? 'translate-x-5' : 'translate-x-0.5')} />
        </div>
      </div>
    </Modal>
  );
}


// ── WhatsApp Personal icon ──────────────────────────────────────────────────────

function WhatsAppPersonalIcon() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-[#128C7E] flex items-center justify-center shrink-0">
      <QrCode className="w-6 h-6 text-white" />
    </div>
  );
}

// ── WhatsApp Personal QR Modal ─────────────────────────────────────────────────

function WaPersonalModal({ onClose, onConnected, sessionId: initialSessionId }: { onClose: () => void; onConnected: () => void; sessionId?: string | null }) {
  const [qr, setQr] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [starting, setStarting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQrRef = useRef<string | null>(null);
  // Track the actual session ID (may be created by this modal)
  const sessionIdRef = useRef<string | null>(initialSessionId ?? null);
  const connectedRef = useRef(false);

  const clearTimers = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (countRef.current) clearInterval(countRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const onQrReceived = (qrData: string) => {
    setQr(qrData);
    if (qrData !== lastQrRef.current) {
      lastQrRef.current = qrData;
      setCountdown(60);
      setTimedOut(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  };

  // Cleanup: delete the session if user closes without connecting
  const handleClose = async () => {
    clearTimers();
    if (!connectedRef.current && sessionIdRef.current) {
      // User closed without scanning — remove the orphan session
      try { await api.delete(`/api/whatsapp-personal/sessions/${sessionIdRef.current}`); } catch {}
    }
    onClose();
  };

  const startSession = async () => {
    clearTimers();
    setStarting(true);
    setQr(null);
    lastQrRef.current = null;
    setTimedOut(false);
    try {
      let sid = sessionIdRef.current;
      // If no session yet, create one first
      if (!sid) {
        const { session_id } = await api.post<{ session_id: string }>('/api/whatsapp-personal/sessions', { name: 'New Device' });
        sid = session_id;
        sessionIdRef.current = sid;
      }

      await api.post(`/api/whatsapp-personal/sessions/${sid}/connect`, {});
      setCountdown(60);

      timeoutRef.current = setTimeout(() => setTimedOut(true), 60_000);

      pollRef.current = setInterval(async () => {
        try {
          const data = await api.get<{ qr: string | null }>(`/api/whatsapp-personal/sessions/${sid}/qr`);
          if (data.qr) onQrReceived(data.qr);
        } catch {}
      }, 1500);

      countRef.current = setInterval(() => {
        setCountdown((c) => (c <= 1 ? 60 : c - 1));
      }, 1000);
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to start session');
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    const socket = getSocket();
    const sid = sessionIdRef.current;

    const qrHandler = (data: { qr: string; sessionId?: string }) => {
      if (sessionIdRef.current && data.sessionId && data.sessionId !== sessionIdRef.current) return;
      if (data.qr) onQrReceived(data.qr);
    };
    const statusHandler = (data: { status: string; phone?: string; sessionId?: string }) => {
      if (sessionIdRef.current && data.sessionId && data.sessionId !== sessionIdRef.current) return;
      if (data.status === 'connected') {
        connectedRef.current = true;
        setConnected(true);
        setQr(null);
        clearTimers();
        setTimeout(() => { onConnected(); onClose(); }, 1500);
      }
    };
    socket.on('wa:qr', qrHandler);
    socket.on('wa:status', statusHandler);
    startSession();
    return () => {
      socket.off('wa:qr', qrHandler);
      socket.off('wa:status', statusHandler);
      clearTimers();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
          <p className="text-[15px] font-bold text-[#1c1410]">{initialSessionId ? 'Connect WhatsApp Device' : 'Add New WhatsApp Device'}</p>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c]"><X size={15} /></button>
        </div>

        <div className="p-6 flex flex-col items-center gap-4">
          {connected ? (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="text-[14px] font-bold text-emerald-600">Connected!</p>
              <p className="text-[12px] text-[#7a6b5c] text-center">WhatsApp Personal is now linked to your CRM.</p>
            </>
          ) : qr ? (
            <>
              <img src={qr} alt="WhatsApp QR Code" className="w-52 h-52 rounded-xl border border-black/10" />
              <div className="flex flex-col items-center gap-1">
                <p className="text-[13px] font-semibold text-[#1c1410]">Scan with WhatsApp on your phone</p>
                <p className="text-[11px] text-[#9e8e7e]">WhatsApp → Linked Devices → Link a Device</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <p className="text-[11px] text-[#9e8e7e]">QR refreshes in {countdown}s</p>
                </div>
              </div>
            </>
          ) : timedOut ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
                <X className="w-7 h-7 text-red-400" />
              </div>
              <p className="text-[13px] font-semibold text-[#1c1410]">QR generation timed out</p>
              <p className="text-[11px] text-[#9e8e7e] text-center">WhatsApp didn't respond in 60s. This is usually temporary throttling — wait a few minutes then try again.</p>
              <button
                onClick={startSession}
                className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#128C7E] rounded-lg px-4 py-1.5 hover:bg-[#0f7a6d] transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />Try Again
              </button>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-[#f5f0eb] flex items-center justify-center">
                {starting
                  ? <RefreshCw className="w-7 h-7 text-[#9e8e7e] animate-spin" />
                  : <RefreshCw className="w-7 h-7 text-[#9e8e7e] animate-spin" />
                }
              </div>
              <p className="text-[13px] text-[#7a6b5c] text-center">
                {starting ? 'Starting session…' : 'Generating QR code…'}
              </p>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-black/5 bg-[var(--app-bg)]">
          <p className="text-[10.5px] text-[#b09e8d] text-center leading-relaxed">
            Sends messages from your linked number. Avoid mass messaging to prevent WhatsApp from banning the number.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Integration card ───────────────────────────────────────────────────────────

// ── Google Sheets icon ────────────────────────────────────────────────────────

function GoogleSheetsIcon() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-[#0F9D58] flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
      </svg>
    </div>
  );
}

// ── Google Sheets modal ───────────────────────────────────────────────────────

function GoogleSheetsModal({ onClose, onSaved, configs: initialConfigs }: {
  onClose: () => void;
  onSaved: () => void;
  configs: any[];
}) {
  const [view, setView] = useState<'list' | 'add'>(initialConfigs.length === 0 ? 'add' : 'list');
  const [configs, setConfigs] = useState<any[]>(initialConfigs);

  // Add-sheet state
  const [url, setUrl]         = useState('');
  const [loading, setLoading] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [gid, setGid]         = useState('');
  const [name, setName]       = useState('');
  // Per-column destination: '' (ignore) | 'core:name|phone|email|source' | 'cf:<slug>' | 'new'
  const [colDest, setColDest] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<Array<{ name: string; slug: string }>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingHeader, setCreatingHeader] = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [sheetPipelineId, setSheetPipelineId] = useState<string>('');
  const [sheetStageId, setSheetStageId] = useState<string>('');
  const { pipelines } = useCrmStore();

  // Called after the rich field-creator persists a new custom field.
  const handleFieldCreated = (f: { name: string; slug: string }) => {
    setCustomFields((prev) => (prev.some((c) => c.slug === f.slug) ? prev : [...prev, { name: f.name, slug: f.slug }]));
    if (creatingHeader) setDest(creatingHeader, `cf:${f.slug}`);
    setCreatingHeader(null);
  };

  const slugify = (s: string) =>
    (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'field';

  // Guess destinations: core fields by header name, then existing custom fields.
  const buildAutoMap = (hdrs: string[], cfs: Array<{ name: string; slug: string }>): Record<string, string> => {
    const out: Record<string, string> = {};
    const usedCore = new Set<string>();
    const coreSyn: Array<[string, RegExp]> = [
      ['core:name',  /^(full ?name|lead ?name|name|customer|contact name)$/i],
      ['core:email', /e-?mail/i],
      ['core:phone', /(phone|mobile|whats ?app|contact ?number|^number$)/i],
      ['core:source',/source/i],
    ];
    for (const h of hdrs) {
      let dest = '';
      for (const [d, re] of coreSyn) {
        if (!usedCore.has(d) && re.test(h.trim())) { dest = d; usedCore.add(d); break; }
      }
      if (!dest) {
        const cf = cfs.find((c) => c.slug === slugify(h) || c.name.toLowerCase() === h.trim().toLowerCase());
        if (cf) dest = `cf:${cf.slug}`;
      }
      out[h] = dest;
    }
    return out;
  };

  // Rebuild per-column destinations from a saved column_mapping (for editing).
  const restoreFromMapping = (hdrs: string[], cm: any): Record<string, string> => {
    const m = cm || {};
    const custom = (m.custom && typeof m.custom === 'object') ? m.custom : {};
    const headerToSlug: Record<string, string> = {};
    for (const [slug, hdr] of Object.entries(custom)) headerToSlug[hdr as string] = slug;
    const out: Record<string, string> = {};
    for (const h of hdrs) {
      if (h === m.name) out[h] = 'core:name';
      else if (h === m.phone) out[h] = 'core:phone';
      else if (h === m.email) out[h] = 'core:email';
      else if (h === m.source) out[h] = 'core:source';
      else if (headerToSlug[h]) out[h] = `cf:${headerToSlug[h]}`;
      else out[h] = '';
    }
    return out;
  };

  const loadColumns = async (overrideUrl?: string, restoreFrom?: any) => {
    const u = (overrideUrl ?? url).trim();
    if (!u) { toast.error('Paste your Google Sheets URL first'); return; }
    setLoading(true);
    try {
      const [data, cfs] = await Promise.all([
        api.post<{ headers: string[]; spreadsheetId: string; gid: string; title?: string | null }>(
          '/api/integrations/sheets/preview', { url: u }
        ),
        api.get<Array<{ name: string; slug: string }>>('/api/fields/custom').catch(() => []),
      ]);
      setHeaders(data.headers);
      setSpreadsheetId(data.spreadsheetId);
      setGid(data.gid);
      setCustomFields(cfs ?? []);
      if (restoreFrom) {
        setColDest(restoreFromMapping(data.headers, restoreFrom));
      } else {
        setName(data.title ?? '');
        setColDest(buildAutoMap(data.headers, cfs ?? []));
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to load sheet columns');
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (config: any) => {
    resetAddState();
    setEditingId(config.id);
    setUrl(config.spreadsheet_url ?? '');
    setName(config.spreadsheet_name ?? '');
    setSheetPipelineId(config.pipeline_id ?? '');
    setSheetStageId(config.stage_id ?? '');
    setView('add');
    loadColumns(config.spreadsheet_url ?? '', config.column_mapping ?? {});
  };

  // Set a column's destination; a core field can only be used by one column.
  const setDest = (header: string, dest: string) => {
    setColDest((prev) => {
      const next = { ...prev, [header]: dest };
      if (dest.startsWith('core:')) {
        for (const k of Object.keys(next)) if (k !== header && next[k] === dest) next[k] = '';
      }
      return next;
    });
  };

  const captureRest = () => {
    setColDest((prev) => {
      const next = { ...prev };
      for (const h of headers) if (!next[h]) next[h] = 'new';
      return next;
    });
  };

  const resetAddState = () => {
    setUrl(''); setHeaders([]); setName(''); setColDest({}); setCustomFields([]); setEditingId(null);
    setSheetPipelineId(''); setSheetStageId('');
  };

  const saveConfig = async () => {
    const colMap: Record<string, string> = { name: '', phone: '', email: '', source: '' };
    const custom: Record<string, string> = {};
    const createFields: Array<{ name: string; slug: string }> = [];
    const taken = new Set<string>();
    for (const h of headers) {
      const d = colDest[h] || '';
      if (d.startsWith('core:')) {
        colMap[d.slice(5)] = h;
      } else if (d.startsWith('cf:')) {
        const slug = d.slice(3);
        custom[slug] = h; taken.add(slug);
      } else if (d === 'new') {
        let slug = slugify(h); let base = slug; let i = 2;
        while (taken.has(slug)) slug = `${base}_${i++}`;
        taken.add(slug);
        custom[slug] = h;
        createFields.push({ name: h.trim() || slug, slug });
      }
    }
    if (!colMap.name && !colMap.phone && !colMap.email) {
      toast.error('Map at least one of Lead Name, Phone, or Email');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const result = await api.patch<any>(`/api/integrations/sheets/configs/${editingId}`, {
          spreadsheet_name: name.trim() || undefined,
          column_mapping:  { ...colMap, custom },
          create_fields:   createFields,
          pipeline_id: sheetPipelineId || null,
          stage_id: sheetStageId || null,
        });
        setConfigs((prev) => prev.map((c) => (c.id === editingId ? { ...c, ...result } : c)));
        toast.success('Sheet updated');
      } else {
        const result = await api.post<any>('/api/integrations/sheets/configs', {
          spreadsheet_url: url.trim(),
          spreadsheet_id:  spreadsheetId,
          gid,
          spreadsheet_name: name.trim() || undefined,
          column_mapping:  { ...colMap, custom },
          create_fields:   createFields,
          pipeline_id: sheetPipelineId || undefined,
          stage_id: sheetStageId || undefined,
        });
        setConfigs((prev) => [result, ...prev]);
        toast.success('Sheet connected! New rows will be synced every 5 minutes.');
      }
      resetAddState();
      setView('list');
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save sheet config');
    } finally {
      setSaving(false);
    }
  };

  const deleteConfig = async (id: string) => {
    try {
      await api.delete(`/api/integrations/sheets/configs/${id}`);
      setConfigs((prev) => prev.filter((c) => c.id !== id));
      toast.success('Sheet removed');
    } catch {
      toast.error('Failed to remove sheet');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {view === 'add' && configs.length > 0 && (
              <button onClick={() => setView('list')} className="p-1 rounded hover:bg-[var(--accent-tint)] text-[#7a6b5c]">
                <ChevronLeft size={16} />
              </button>
            )}
            <p className="text-[15px] font-bold text-[#1c1410]">
              {view === 'list' ? 'Google Sheets' : (editingId ? 'Edit Sheet' : 'Connect a Sheet')}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c]"><X size={15} /></button>
        </div>

        {/* Body */}
        <div className="p-5 max-h-[65vh] overflow-y-auto">

          {view === 'list' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-[#7a6b5c]">{configs.length} sheet{configs.length !== 1 ? 's' : ''} connected</p>
                <Button size="sm" variant="outline" onClick={() => { resetAddState(); setView('add'); }}>
                  <Plus className="w-3.5 h-3.5 mr-1" />Add Sheet
                </Button>
              </div>
              <div className="space-y-2">
                {configs.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 bg-[var(--app-bg)] rounded-xl border border-black/5 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#1c1410] truncate">
                        {c.spreadsheet_name ?? c.spreadsheet_id}
                        {c.sheet_name ? <span className="text-[#9e8e7e] font-normal"> › {c.sheet_name}</span> : null}
                      </p>
                      <p className="text-[11px] text-[#9e8e7e]">Active · new rows sync every 5 min</p>
                    </div>
                    {(c.spreadsheet_url || c.spreadsheet_id) && (
                      <a href={c.spreadsheet_url || `https://docs.google.com/spreadsheets/d/${c.spreadsheet_id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-[#9e8e7e] hover:text-primary transition-colors p-1" title="Open in Google Sheets">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button onClick={() => openEdit(c)} className="text-[#9e8e7e] hover:text-primary transition-colors p-1" title="Edit mapping">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteConfig(c.id)} className="text-[#9e8e7e] hover:text-red-500 transition-colors p-1" title="Remove">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'add' && (
            <div className="space-y-4">
              {!editingId && (
                <>
                  <div className="bg-[#f5f0eb] rounded-xl p-3 space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245]">Before you paste</p>
                    <p className="text-[11px] text-[#7a6b5c] leading-relaxed">
                      Open your Google Sheet → Share → set to <strong>"Anyone with the link can view"</strong>. Then copy the URL from your browser address bar.
                    </p>
                  </div>

                  <div>
                    <label className={labelCls}>Google Sheets URL *</label>
                    <div className="flex gap-2">
                      <Input
                        value={url}
                        onChange={(e) => { setUrl(e.target.value); setHeaders([]); }}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        className="flex-1"
                      />
                      <Button variant="outline" onClick={() => loadColumns()} disabled={loading || !url.trim()} className="shrink-0">
                        {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Load Columns'}
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {editingId && loading && (
                <div className="flex items-center gap-2 text-[12px] text-[#7a6b5c] py-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading current columns & mapping…
                </div>
              )}

              {headers.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Sheet name</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Website Leads"
                    />
                    <p className="text-[11px] text-[#9e8e7e] mt-1">Shown in your connected-sheets list. Auto-filled from the spreadsheet title — edit if you like.</p>
                  </div>
                  {/* Pipeline & Stage selection */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Pipeline</label>
                      <select
                        className="w-full text-[12px] border border-border rounded-lg px-3 py-2 bg-white outline-none focus:border-primary/50"
                        value={sheetPipelineId}
                        onChange={(e) => { setSheetPipelineId(e.target.value); setSheetStageId(''); }}
                      >
                        <option value="">— Default —</option>
                        {pipelines.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Stage</label>
                      <select
                        className="w-full text-[12px] border border-border rounded-lg px-3 py-2 bg-white outline-none focus:border-primary/50"
                        value={sheetStageId}
                        onChange={(e) => setSheetStageId(e.target.value)}
                        disabled={!sheetPipelineId}
                      >
                        <option value="">— First stage —</option>
                        {sheetPipelineId && (pipelines.find((p: any) => p.id === sheetPipelineId) as any)?.stages?.map((s: any) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#9e8e7e] -mt-1">Imported leads land in this pipeline. Duplicates are checked within the same pipeline only.</p>

                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold text-[#1c1410]">Where should each column go?</p>
                    <button
                      type="button"
                      onClick={captureRest}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      + Capture rest as custom fields
                    </button>
                  </div>
                  <div className="space-y-2">
                    {headers.map((h) => {
                      const d = colDest[h] ?? '';
                      return (
                        <div key={h} className="grid grid-cols-2 gap-3 items-center">
                          <p className="text-[12px] font-semibold text-[#5c5245] truncate" title={h}>{h}</p>
                          <select
                            className="text-[12px] border border-border rounded-lg px-3 py-2 bg-white outline-none focus:border-primary/50"
                            value={d}
                            onChange={(e) => {
                              if (e.target.value === 'new') { setCreatingHeader(h); return; }
                              setDest(h, e.target.value);
                            }}
                          >
                            <option value="">— Don't import —</option>
                            <optgroup label="Core fields">
                              <option value="core:name">Lead Name</option>
                              <option value="core:phone">Phone</option>
                              <option value="core:email">Email</option>
                              <option value="core:source">Source</option>
                            </optgroup>
                            {customFields.length > 0 && (
                              <optgroup label="Custom fields">
                                {customFields.map((cf) => (
                                  <option key={cf.slug} value={`cf:${cf.slug}`}>{cf.name}</option>
                                ))}
                              </optgroup>
                            )}
                            <option value="new">➕ New custom field…</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-[#9e8e7e]">
                    Columns set to a custom field are saved on each lead and usable as <code className="text-[#7a6b5c]">{'{slug}'}</code> in automations. "New custom field" creates it automatically.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-black/5 bg-[var(--app-bg)]">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {view === 'add' && headers.length > 0 && (
            <Button onClick={saveConfig} disabled={saving}>
              {saving ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Check className="w-3.5 h-3.5 mr-1.5" />{editingId ? 'Save Changes' : 'Save Sheet'}</>}
            </Button>
          )}
        </div>
      </div>

      {creatingHeader !== null && (
        <CreateCustomFieldModal
          initialName={creatingHeader}
          onClose={() => setCreatingHeader(null)}
          onCreate={handleFieldCreated}
        />
      )}
    </div>
  );
}

// ── Superfone icon ────────────────────────────────────────────────────────────

function SuperfoneIcon() {
  return (
    <div className="w-12 h-12 rounded-2xl bg-[#1a1a2e] flex items-center justify-center shrink-0">
      <span className="text-white font-extrabold text-[11px] tracking-tight">SF</span>
    </div>
  );
}

// ── Superfone modal ───────────────────────────────────────────────────────────

function SuperfoneModal({ onClose, onSaved, tenantId }: { onClose: () => void; onSaved: () => void; tenantId: string }) {
  const [form, setForm] = useState({ api_key: '', superfone_endpoint_url: '', superfone_number: '' });
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const webhookUrl = `${window.location.origin}/api/webhooks/superfone/${tenantId}`;

  const handleSave = async () => {
    if (!form.superfone_number.trim()) {
      toast.error('Business phone number is required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/integrations/superfone/connect', {
        api_key: form.api_key.trim() || undefined,
        superfone_endpoint_url: form.superfone_endpoint_url.trim() || undefined,
        superfone_number: form.superfone_number.trim(),
      });
      toast.success('Superfone connected!');
      onSaved();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to connect Superfone');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Connect Superfone" onClose={onClose} footer={
      <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Connecting…</> : <><Check className="w-3.5 h-3.5 mr-1.5" />Connect</>}
        </Button>
      </>
    }>
      <p className="text-[12px] text-[#7a6b5c]">Connect your Superfone account to log calls, play recordings, and trigger automations.</p>

      {/* Webhook URL to copy */}
      <div className="bg-[#f5f0eb] rounded-xl p-3 space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245]">Your CRM Webhook URL</p>
        <p className="text-[11px] text-[#7a6b5c] leading-relaxed">Copy this URL into your Superfone dashboard under Webhook settings:</p>
        <div className="flex items-center gap-2 mt-1">
          <code className="text-[10.5px] text-[var(--brand-dark)] bg-white rounded-lg px-2.5 py-1.5 flex-1 break-all border border-black/5">{webhookUrl}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('Copied!'); }}
            className="shrink-0 text-[11px] font-semibold text-white bg-[var(--brand-dark)] rounded-lg px-2.5 py-1.5 hover:bg-[#a83808] transition-colors"
          >
            Copy
          </button>
        </div>
      </div>

      <div>
        <label className={labelCls}>Superfone Business Number *</label>
        <Input value={form.superfone_number} onChange={(e) => set('superfone_number', e.target.value)} placeholder="+919429694726" />
        <p className="text-[10px] text-[#b09e8d] mt-1">Your Superfone virtual number — used to match incoming call webhooks</p>
      </div>

      <div>
        <label className={labelCls}>API Key (optional — needed to push leads to Superfone)</label>
        <div className="relative">
          <Input
            value={form.api_key}
            onChange={(e) => set('api_key', e.target.value)}
            type={showKey ? 'text' : 'password'}
            placeholder="sk_••••••••••••"
            className="pr-9"
          />
          <button type="button" onClick={() => setShowKey((s) => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9e8e7e] hover:text-[#1c1410]">
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[10px] text-[#b09e8d] mt-1">Required only if you purchased the Superfone API Key add-on</p>
      </div>

      <div>
        <label className={labelCls}>Superfone Endpoint URL (optional)</label>
        <Input value={form.superfone_endpoint_url} onChange={(e) => set('superfone_endpoint_url', e.target.value)}
          placeholder="https://prod-api.superfone.co.in/superfone/webhook/integration/..." type="url" />
        <p className="text-[10px] text-[#b09e8d] mt-1">Superfone's webhook URL — required to push new leads from CRM to Superfone</p>
      </div>
    </Modal>
  );
}

type ModalType = 'waba' | 'smtp' | 'wa_personal' | 'superfone' | 'google_sheets';

interface IntegCardProps {
  icon: React.ReactNode;
  name: string;
  tagline: string;
  connected: boolean;
  onConnect: () => void;
  onConfigure?: () => void;
  onDisconnect: () => Promise<void>;
  configureLabel?: string;
  locked?: boolean;
  lockedNote?: string;
}

function IntegCard({ icon, name, tagline, connected, onConnect, onConfigure, onDisconnect, configureLabel = 'Configure', locked = false, lockedNote }: IntegCardProps) {
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try { await onDisconnect(); } finally { setDisconnecting(false); }
  };

  if (locked) {
    return (
      <div className="bg-white rounded-2xl border border-black/5 p-5 flex flex-col gap-4 opacity-70">
        <div className="flex items-start justify-between gap-2">
          <div className="grayscale">{icon}</div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#f3efe9] text-[#9e8e7e] text-[11px] font-medium">
            Not enabled
          </span>
        </div>
        <div className="flex-1">
          <p className="text-[14px] font-bold text-[#1c1410]">{name}</p>
          <p className="text-[12px] text-[#9e8e7e] mt-0.5 leading-relaxed">{lockedNote ?? tagline}</p>
        </div>
        <Button variant="outline" size="sm" className="flex-1" disabled>
          Contact DigyGo to enable
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-black/5 p-5 flex flex-col gap-4 hover:shadow-sm transition-all duration-200">
      <div className="flex items-start justify-between gap-2">
        {icon}
        <StatusBadge connected={connected} />
      </div>
      <div className="flex-1">
        <p className="text-[14px] font-bold text-[#1c1410]">{name}</p>
        <p className="text-[12px] text-[#9e8e7e] mt-0.5 leading-relaxed">{tagline}</p>
      </div>
      <div className="flex gap-2">
        {connected ? (
          <>
            {onConfigure && (
              <Button variant="outline" size="sm" className="flex-1" onClick={onConfigure}>
                <ExternalLink className="w-3 h-3 mr-1.5" />{configureLabel}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className={cn('text-destructive hover:bg-red-50 border-red-100', !onConfigure && 'flex-1')}
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <><Unplug className="w-3.5 h-3.5 mr-1" />Disconnect</>}
            </Button>
          </>
        ) : (
          <Button size="sm" className="flex-1" onClick={onConnect}>
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const navigate = useNavigate();
  const [modal, setModal] = useState<ModalType | null>(null);
  const { waPersonalStatus, waPersonalPhone, setWaPersonalStatus } = useCrmStore();
  const { currentUser } = useAuthStore();
  const superfoneEnabled = useCompanyStore((s) => s.superfoneEnabled);
  const [status, setStatus] = useState({
    meta: false,
    waba: false,
    smtp: false,
    superfone: false,
    sheets: false,
  });
  const [sheetsInfo, setSheetsInfo] = useState<{ email: string | null; configs: any[] }>({ email: null, configs: [] });
  const [metaHealth, setMetaHealth] = useState<{ needsReconnect: boolean; lastError: string | null }>({ needsReconnect: false, lastError: null });
  const [waSessions, setWaSessions] = useState<{ session_id: string; session_name: string; status: string; phone_number: string | null; connected_at: string | null }[]>([]);
  const [waQrSessionId, setWaQrSessionId] = useState<string | null>(null);
  const [editingWaSession, setEditingWaSession] = useState<string | null>(null);
  const [editingWaName, setEditingWaName] = useState('');

  const loadWaSessions = async () => {
    try {
      const sessions = await api.get<any[]>('/api/whatsapp-personal/sessions');
      if (Array.isArray(sessions)) setWaSessions(sessions);
    } catch {}
  };
  const addWaSession = () => {
    setWaQrSessionId(null); // no session yet — modal will create one
    setModal('wa_personal');
  };

  const loadStatus = async () => {
    const [meta, waba, smtp, configs, waPersStatus, superfone, sheets] = await Promise.allSettled([
      api.get<{ connected: boolean; needsReconnect?: boolean; lastError?: string | null }>('/api/integrations/meta/status'),
      api.get<{ connected: boolean }>('/api/integrations/waba/status'),
      api.get<{ connected: boolean }>('/api/integrations/smtp/status'),
      api.get<Record<string, { is_active: boolean }>>('/api/integrations/configs'),
      api.get<{ status: string; phone: string | null }>('/api/whatsapp-personal/status'),
      api.get<{ connected: boolean }>('/api/integrations/superfone/status'),
      api.get<{ connected: boolean; email: string | null; configs: any[] }>('/api/integrations/sheets/status'),
    ]);

    setStatus({
      meta:      meta.status      === 'fulfilled' && !!meta.value?.connected,
      waba:      waba.status      === 'fulfilled' && !!waba.value?.connected,
      smtp:      smtp.status      === 'fulfilled' && !!smtp.value?.connected,
      superfone: superfone.status === 'fulfilled' && !!superfone.value?.connected,
      sheets:    sheets.status    === 'fulfilled' && !!sheets.value?.connected,
    });

    if (meta.status === 'fulfilled' && meta.value) {
      setMetaHealth({ needsReconnect: !!meta.value.needsReconnect, lastError: meta.value.lastError ?? null });
    }

    if (sheets.status === 'fulfilled' && sheets.value) {
      setSheetsInfo({ email: sheets.value.email, configs: sheets.value.configs ?? [] });
    }

    if (waPersStatus.status === 'fulfilled') {
      setWaPersonalStatus(waPersStatus.value.status as any, waPersStatus.value.phone);
    }

    loadWaSessions();
  };


  useEffect(() => { loadStatus(); }, []);

  const disconnect = async (key: keyof typeof status, endpoint: string) => {
    try {
      await api.delete(endpoint);
      setStatus((s) => ({ ...s, [key]: false }));
      toast.success('Disconnected');
    } catch {
      toast.error('Failed to disconnect');
    }
  };

  const onSaved = (key: keyof typeof status) => {
    setStatus((s) => ({ ...s, [key]: true }));
    setModal(null);
  };

  return (
    <div className="space-y-6 pb-10">

      {/* Header */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => navigate('/settings')}
          className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[#1c1410] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="font-headline font-bold text-[17px] text-[#1c1410]">Integrations</h2>
          <p className="text-[12px] text-[#9e8e7e]">Connect your tools to DigyGo CRM</p>
        </div>
      </div>

      {/* Meta disconnected banner — lead capture is broken until reconnected */}
      {metaHealth.needsReconnect && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <span className="text-red-500 text-lg leading-none mt-0.5">⚠️</span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-red-700">Facebook lead capture is disconnected</p>
            <p className="text-[12px] text-red-600 mt-0.5">
              We can no longer pull leads from your Facebook page — new leads are <b>not</b> being captured.
              Reconnect Meta below to resume.{metaHealth.lastError ? ` (Meta: ${metaHealth.lastError})` : ''}
            </p>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

        <IntegCard
          icon={<FacebookIcon />}
          name="Facebook"
          tagline="Capture leads from Facebook Lead Ads and sync them automatically into CRM."
          connected={status.meta}
          onConnect={() => navigate('/lead-generation/meta-forms')}
          onConfigure={() => navigate('/lead-generation/meta-forms')}
          onDisconnect={() => disconnect('meta', '/api/integrations/meta/disconnect')}
          configureLabel="Manage Forms"
        />

        <IntegCard
          icon={<InstagramIcon />}
          name="Instagram"
          tagline="Capture leads from Instagram Lead Ads via Meta Business Manager."
          connected={status.meta}
          onConnect={() => navigate('/lead-generation/meta-forms')}
          onConfigure={() => navigate('/lead-generation/meta-forms')}
          onDisconnect={async () => toast.info('Facebook and Instagram share the same Meta connection')}
          configureLabel="Manage Forms"
        />

        <IntegCard
          icon={<WhatsAppIcon />}
          name="WhatsApp Business"
          tagline="Send and receive WhatsApp messages. Connect your WABA number for two-way conversations."
          connected={status.waba}
          onConnect={() => setModal('waba')}
          onConfigure={() => setModal('waba')}
          onDisconnect={() => disconnect('waba', '/api/integrations/waba/disconnect')}
        />

        {/* WhatsApp Personal (QR) — Multi-session */}
        <div className="bg-white rounded-2xl border border-black/5 p-5 flex flex-col gap-4 hover:shadow-sm transition-all duration-200">
          <div className="flex items-start justify-between gap-2">
            <WhatsAppPersonalIcon />
            <span className={cn(
              'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full',
              waSessions.some((s) => s.status === 'connected') ? 'bg-emerald-50 text-emerald-600'
              : waSessions.some((s) => s.status === 'connecting') ? 'bg-amber-50 text-amber-600'
              : 'bg-[#f5f0eb] text-[#9e8e7e]'
            )}>
              {waSessions.filter((s) => s.status === 'connected').length > 0
                ? <><Check className="w-2.5 h-2.5" />{waSessions.filter((s) => s.status === 'connected').length} connected</>
                : waSessions.some((s) => s.status === 'connecting') ? <><RefreshCw className="w-2.5 h-2.5 animate-spin" />Connecting…</>
                : 'Not connected'}
            </span>
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[#1c1410]">WhatsApp Personal (QR)</p>
            <p className="text-[12px] text-[#9e8e7e] mt-0.5 leading-relaxed">
              Link multiple WhatsApp numbers via QR scan. Send messages to any contact without WABA approval.
            </p>
          </div>

          {/* Session list */}
          {waSessions.length > 0 && (
            <div className="space-y-2">
              {waSessions.map((s) => (
                <div key={s.session_id} className="flex items-center gap-2 bg-[var(--app-bg)] rounded-xl border border-black/5 px-3 py-2">
                  <div className={cn('w-2 h-2 rounded-full shrink-0', s.status === 'connected' ? 'bg-emerald-500' : s.status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-gray-300')} />
                  <div className="flex-1 min-w-0">
                    {editingWaSession === s.session_id ? (
                      <form className="flex items-center gap-1" onSubmit={async (e) => {
                        e.preventDefault();
                        const trimmed = editingWaName.trim();
                        if (!trimmed) { setEditingWaSession(null); return; }
                        try {
                          await api.patch(`/api/whatsapp-personal/sessions/${s.session_id}`, { name: trimmed });
                          await loadWaSessions();
                          toast.success('Renamed');
                        } catch { toast.error('Failed to rename'); }
                        setEditingWaSession(null);
                      }}>
                        <input
                          autoFocus
                          className="text-[12px] font-semibold text-[#1c1410] bg-white border border-black/10 rounded px-1.5 py-0.5 w-full outline-none focus:border-[#128C7E]"
                          value={editingWaName}
                          onChange={(e) => setEditingWaName(e.target.value)}
                          onBlur={(e) => { (e.target.closest('form') as HTMLFormElement)?.requestSubmit(); }}
                          onKeyDown={(e) => { if (e.key === 'Escape') setEditingWaSession(null); }}
                        />
                      </form>
                    ) : (
                      <p className="text-[12px] font-semibold text-[#1c1410] truncate flex items-center gap-1">
                        {s.session_name}
                        <button
                          className="text-[#9e8e7e] hover:text-[#128C7E] transition-colors p-0.5 shrink-0"
                          title="Rename device"
                          onClick={() => { setEditingWaSession(s.session_id); setEditingWaName(s.session_name); }}
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                      </p>
                    )}
                    <p className="text-[10px] text-[#9e8e7e]">{s.phone_number || (s.status === 'connecting' ? 'Connecting...' : 'Disconnected')}</p>
                  </div>
                  {s.status === 'connected' ? (
                    <button
                      className="text-[10px] font-semibold text-red-500 hover:underline shrink-0"
                      onClick={async () => {
                        try {
                          await api.post(`/api/whatsapp-personal/sessions/${s.session_id}/disconnect`, {});
                          await loadWaSessions();
                          loadStatus();
                          toast.success('Disconnected');
                        } catch { toast.error('Failed'); }
                      }}
                    >Disconnect</button>
                  ) : (
                    <button
                      className="text-[10px] font-semibold text-[#128C7E] hover:underline shrink-0"
                      onClick={() => { setWaQrSessionId(s.session_id); setModal('wa_personal'); }}
                    >Connect</button>
                  )}
                  <button
                    className="text-[#9e8e7e] hover:text-red-500 transition-colors p-0.5 shrink-0"
                    title="Remove device"
                    onClick={async () => {
                      try {
                        await api.delete(`/api/whatsapp-personal/sessions/${s.session_id}`);
                        await loadWaSessions();
                        loadStatus();
                        toast.success('Device removed');
                      } catch { toast.error('Failed'); }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#128C7E] rounded-lg px-3 py-1.5 hover:bg-[#0f7a6d] transition-colors"
              onClick={addWaSession}
            >
              <Plus className="w-3.5 h-3.5" />Add New WhatsApp Device
            </button>
            <button
              className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#7a6b5c] border border-black/10 rounded-lg px-3 py-1.5 hover:bg-[var(--accent-tint)] hover:text-[var(--brand-dark)] transition-colors"
              onClick={() => navigate('/automation/devices')}
            >
              <BarChart2 className="w-3.5 h-3.5" />Manage Devices
            </button>
          </div>
        </div>

        <IntegCard
          icon={<EmailIcon />}
          name="Email (SMTP)"
          tagline="Configure your SMTP server to send automated emails from workflows and sequences."
          connected={status.smtp}
          onConnect={() => setModal('smtp')}
          onConfigure={() => setModal('smtp')}
          onDisconnect={() => disconnect('smtp', '/api/integrations/smtp/disconnect')}
        />

        <IntegCard
          icon={<SuperfoneIcon />}
          name="Superfone"
          tagline="Log inbound and outbound calls, play recordings, and trigger automations on missed or answered calls."
          connected={status.superfone}
          onConnect={() => setModal('superfone')}
          onConfigure={() => setModal('superfone')}
          onDisconnect={() => disconnect('superfone', '/api/integrations/superfone/disconnect')}
          locked={!superfoneEnabled}
          lockedNote="Calls & Superfone are not active on your account. Contact DigyGo to enable this add-on."
        />

        <IntegCard
          icon={<GoogleSheetsIcon />}
          name="Google Sheets"
          tagline="Automatically capture leads from any Google Sheet into the CRM every 5 minutes and trigger automations."
          connected={status.sheets}
          onConnect={() => setModal('google_sheets')}
          onConfigure={() => setModal('google_sheets')}
          onDisconnect={() => disconnect('sheets', '/api/integrations/sheets/disconnect')}
        />

      </div>

      {/* Modals */}
      {modal === 'waba'        && <WabaModal       onClose={() => setModal(null)} onSaved={() => onSaved('waba')}     />}
      {modal === 'smtp'        && <SmtpModal       onClose={() => setModal(null)} onSaved={() => onSaved('smtp')}     />}
      {modal === 'wa_personal' && <WaPersonalModal sessionId={waQrSessionId} onClose={() => { setModal(null); setWaQrSessionId(null); loadWaSessions(); }} onConnected={() => { loadWaSessions(); loadStatus(); }} />}
      {modal === 'superfone'   && <SuperfoneModal  onClose={() => setModal(null)} onSaved={() => onSaved('superfone')} tenantId={currentUser?.tenantId ?? ''} />}
      {modal === 'google_sheets' && (
        <GoogleSheetsModal
          onClose={() => setModal(null)}
          onSaved={() => { setStatus((s) => ({ ...s, sheets: true })); loadStatus(); }}
          configs={sheetsInfo.configs}
        />
      )}

    </div>
  );
}
