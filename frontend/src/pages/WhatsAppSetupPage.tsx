import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageCircle, Check, Eye, EyeOff, RefreshCw, Copy,
  ExternalLink, AlertCircle, ArrowLeft, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';

interface WabaStatus {
  connected: boolean;
  phoneNumber?: string;
  phoneNumberId?: string;
  wabaId?: string;
  isActive?: boolean;
}

export default function WhatsAppSetupPage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<WabaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [showToken, setShowToken] = useState(false);

  const [autoAssign, setAutoAssign] = useState(true);
  const [autoReply, setAutoReply] = useState(true);

  const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
  const webhookUrl = `${baseUrl}/api/webhooks/whatsapp`;
  const verifyToken = import.meta.env.VITE_META_WEBHOOK_VERIFY_TOKEN ?? '(set META_WEBHOOK_VERIFY_TOKEN in env)';

  useEffect(() => {
    api.get<WabaStatus>('/api/integrations/waba/status')
      .then((s) => {
        setStatus(s);
        if (s.connected) {
          setPhoneNumber(s.phoneNumber ?? '');
          setPhoneNumberId(s.phoneNumberId ?? '');
          setWabaId(s.wabaId ?? '');
        }
      })
      .catch(() => toast.error('Failed to load WhatsApp status'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!phoneNumberId || !wabaId || !accessToken) {
      toast.error('Phone Number ID, WABA ID and Access Token are required');
      return;
    }
    setSaving(true);
    try {
      const result = await api.post<{ success: boolean; phoneNumber: string }>('/api/integrations/waba/setup', {
        phone_number: phoneNumber || undefined,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        access_token: accessToken,
      });
      setStatus({
        connected: true,
        phoneNumber: result.phoneNumber,
        phoneNumberId,
        wabaId,
        isActive: true,
      });
      setAccessToken('');
      toast.success('WhatsApp Business connected successfully');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-16 text-[13px] text-[#7a6b5c]">Loading…</div>;
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[#1c1410] transition-colors shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="font-headline font-bold text-[#1c1410] text-[16px]">WhatsApp Setup</h2>
          <p className="text-[12px] text-[#7a6b5c]">Connect your WhatsApp Business API account</p>
        </div>
      </div>

      {/* Status Banner */}
      {status?.connected ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <MessageCircle className="w-5 h-5 text-green-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">WhatsApp Business Connected</p>
            <p className="text-xs text-green-700 mt-0.5">{status.phoneNumber || status.phoneNumberId}</p>
          </div>
          <Badge className="bg-green-100 text-green-700 border-green-200 shrink-0">
            <Check className="w-3 h-3 mr-1" /> Active
          </Badge>
          <button
            onClick={() => { setStatus({ connected: false }); setAccessToken(''); }}
            className="p-1.5 rounded-lg hover:bg-green-100 text-green-600 transition-colors"
            title="Reconfigure"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">WhatsApp is not connected. Fill in your WABA credentials below.</p>
        </div>
      )}

      {/* WABA Credentials */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-headline font-bold text-[#1c1410]">WABA Credentials</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('https://developers.facebook.com/docs/whatsapp/getting-started', '_blank')}
          >
            <ExternalLink className="w-3 h-3 mr-1" /> Meta Docs
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Phone Number</label>
            <Input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">WABA ID *</label>
            <Input
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              placeholder="WhatsApp Business Account ID"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Phone Number ID *</label>
            <Input
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="Phone Number ID from Meta"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Access Token *{status?.connected && <span className="text-[11px] text-[#b09e8d] ml-1">(leave blank to keep existing)</span>}
            </label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={status?.connected ? '••••••••' : 'EAABwzLix…'}
                className="pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Webhook Configuration */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-6 space-y-4">
        <h3 className="font-headline font-bold text-[#1c1410]">Webhook Configuration</h3>
        <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#7a6b5c]">
            Add these in your Meta App Dashboard under <strong>WhatsApp → Configuration</strong>.
          </p>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">Inbound Webhook URL</label>
          <div className="flex gap-2">
            <Input value={webhookUrl} readOnly className="flex-1 font-mono text-sm bg-[var(--app-bg)]" />
            <Button variant="outline" onClick={() => { copyToClipboard(webhookUrl); toast.success('URL copied'); }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">Webhook Verify Token</label>
          <div className="flex gap-2">
            <Input value={verifyToken} readOnly className="flex-1 font-mono text-sm bg-[var(--app-bg)]" />
            <Button variant="outline" onClick={() => { copyToClipboard(verifyToken); toast.success('Copied'); }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Automation Settings */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-6 space-y-4">
        <h3 className="font-headline font-bold text-[#1c1410]">Automation Settings</h3>
        <div className="space-y-4">
          {[
            {
              label: 'Auto-create Lead',
              description: 'Create a new lead in CRM for every new WhatsApp contact',
              value: true,
              onChange: () => toast.info('Auto-lead creation is always enabled'),
            },
            {
              label: 'Auto-assign to Agent',
              description: 'Use assignment rules to route incoming WhatsApp leads',
              value: autoAssign,
              onChange: () => { setAutoAssign((v) => !v); toast.success('Setting updated'); },
            },
            {
              label: 'Auto-reply on First Contact',
              description: 'Send a welcome message when a new contact messages you',
              value: autoReply,
              onChange: () => { setAutoReply((v) => !v); toast.success('Setting updated'); },
            },
          ].map((setting) => (
            <div key={setting.label} className="flex items-center justify-between py-3 border-b border-black/5 last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{setting.label}</p>
                <p className="text-[11px] text-[#7a6b5c] mt-0.5">{setting.description}</p>
              </div>
              <Switch checked={setting.value} onCheckedChange={setting.onChange} />
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || (status?.connected && !accessToken && !phoneNumberId && !wabaId)}>
          {saving
            ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
            : <><Check className="w-4 h-4 mr-1" /> {status?.connected ? 'Update Configuration' : 'Save & Connect'}</>
          }
        </Button>
      </div>
    </div>
  );
}
