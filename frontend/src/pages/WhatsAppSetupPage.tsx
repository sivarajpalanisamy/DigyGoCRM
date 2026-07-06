import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageCircle, Check, Eye, EyeOff, RefreshCw, Copy,
  ExternalLink, AlertCircle, X, FileText, MessageSquare,
  Send, ChevronDown, ChevronUp, Inbox, Zap, BarChart3, Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';

interface WabaStatus {
  connected: boolean;
  phoneNumber?: string;
  phoneNumberId?: string;
  wabaId?: string;
  isActive?: boolean;
  webhookUrl?: string;
  verifyToken?: string;
}

interface WabaStats {
  templates: number;
  conversations: number;
  totalMessages: number;
  messagesToday: number;
}

interface TemplateAnalytics {
  id: string;
  name: string;
  meta_name: string;
  status: string;
  language: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

interface QualityData {
  connected: boolean;
  qualityRating?: string;
  messagingLimitTier?: string;
  verifiedName?: string;
  displayPhoneNumber?: string;
  nameStatus?: string;
  accountStatus?: string;
  error?: string;
}

const qualityColor: Record<string, string> = {
  GREEN: 'text-green-600 bg-green-50 border-green-200',
  YELLOW: 'text-amber-600 bg-amber-50 border-amber-200',
  RED: 'text-red-600 bg-red-50 border-red-200',
  UNKNOWN: 'text-gray-500 bg-gray-50 border-gray-200',
};

const tierLabel: Record<string, string> = {
  TIER_NOT_SET: 'Not set',
  TIER_50: '50 / day',
  TIER_250: '250 / day',
  TIER_1K: '1,000 / day',
  TIER_10K: '10,000 / day',
  TIER_100K: '100,000 / day',
  TIER_UNLIMITED: 'Unlimited',
};

export default function WhatsAppSetupPage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<WabaStatus | null>(null);
  const [stats, setStats] = useState<WabaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [showToken, setShowToken] = useState(false);

  const [autoAssign, setAutoAssign] = useState(true);
  const [autoReply, setAutoReply] = useState(true);
  const [tplAnalytics, setTplAnalytics] = useState<TemplateAnalytics[]>([]);
  const [quality, setQuality] = useState<QualityData | null>(null);

  const webhookUrl = status?.webhookUrl || '';
  const verifyToken = status?.verifyToken || '';

  useEffect(() => {
    Promise.all([
      api.get<WabaStatus>('/api/integrations/waba/status'),
      api.get<WabaStats>('/api/integrations/waba/stats').catch(() => null),
    ])
      .then(([s, st]) => {
        setStatus(s);
        if (st) setStats(st);
        if (s.connected) {
          setPhoneNumber(s.phoneNumber ?? '');
          setPhoneNumberId(s.phoneNumberId ?? '');
          setWabaId(s.wabaId ?? '');
          // Fetch analytics + quality in background
          api.get<TemplateAnalytics[]>('/api/integrations/waba/template-analytics').then(setTplAnalytics).catch(() => null);
          api.get<QualityData>('/api/integrations/waba/quality').then(setQuality).catch(() => null);
        } else {
          setShowSetup(true);
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
      setShowSetup(false);
      toast.success('WhatsApp Business connected successfully');
      // Refresh stats
      api.get<WabaStats>('/api/integrations/waba/stats').then(setStats).catch(() => null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post('/api/templates/sync-waba', {});
      toast.success('Templates synced from Meta');
      api.get<WabaStats>('/api/integrations/waba/stats').then(setStats).catch(() => null);
    } catch {
      toast.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return <div className="text-center py-16 text-[14px] text-[#7a6b5c]">Loading...</div>;
  }

  const connected = status?.connected === true;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#1c1410]">WABA Dashboard</h1>
        <p className="text-sm text-[#7a6b5c] mt-0.5">WhatsApp Business API integration &amp; overview</p>
      </div>

      {/* Status Banner */}
      {connected ? (
        <div className="flex items-center gap-4 p-5 rounded-2xl bg-green-50 border border-green-200">
          <div className="w-11 h-11 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <MessageCircle className="w-6 h-6 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-green-800">WhatsApp Business Connected</p>
            <p className="text-[14px] text-green-700 mt-0.5 font-mono">{status.phoneNumber || status.phoneNumberId}</p>
          </div>
          <Badge className="bg-green-100 text-green-700 border-green-200 shrink-0 text-xs">
            <Check className="w-3 h-3 mr-1" /> Active
          </Badge>
        </div>
      ) : (
        <div className="flex items-center gap-4 p-5 rounded-2xl bg-amber-50 border border-amber-200">
          <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertCircle className="w-6 h-6 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-bold text-amber-800">Not Connected</p>
            <p className="text-[14px] text-amber-700 mt-0.5">Set up your WABA credentials to get started.</p>
          </div>
          {!showSetup && (
            <Button onClick={() => setShowSetup(true)} size="sm">
              Connect Now
            </Button>
          )}
        </div>
      )}

      {/* Stats Cards */}
      {connected && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Templates', value: stats.templates, icon: FileText, color: 'text-primary', bg: 'bg-primary/10', onClick: () => navigate('/automation/waba-templates') },
            { label: 'Conversations', value: stats.conversations, icon: MessageSquare, color: 'text-primary', bg: 'bg-primary/10', onClick: () => navigate('/inbox') },
            { label: 'Messages Today', value: stats.messagesToday, icon: Send, color: 'text-primary', bg: 'bg-primary/10' },
            { label: 'Total Messages', value: stats.totalMessages, icon: Inbox, color: 'text-primary', bg: 'bg-primary/10' },
          ].map((card) => (
            <button
              key={card.label}
              onClick={card.onClick}
              disabled={!card.onClick}
              className={cn(
                'bg-white rounded-2xl border border-black/5 p-4 text-left transition-all',
                card.onClick ? 'hover:border-black/10 hover:shadow-sm cursor-pointer' : 'cursor-default'
              )}
            >
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', card.bg)}>
                <card.icon className={cn('w-4.5 h-4.5', card.color)} />
              </div>
              <p className="text-2xl font-bold text-[#1c1410]">{card.value.toLocaleString()}</p>
              <p className="text-[13px] text-[#7a6b5c] mt-0.5">{card.label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      {connected && (
        <div className="bg-white rounded-2xl border border-black/5 p-5">
          <h3 className="text-[15px] font-bold text-[#1c1410] mb-4">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-3 p-3.5 rounded-xl border border-black/5 hover:bg-[var(--app-bg)] transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <RefreshCw className={cn('w-4 h-4 text-primary', syncing && 'animate-spin')} />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#1c1410]">{syncing ? 'Syncing...' : 'Sync Templates'}</p>
                <p className="text-[11px] text-[#7a6b5c]">Pull latest from Meta</p>
              </div>
            </button>
            <button
              onClick={() => navigate('/automation/waba-templates')}
              className="flex items-center gap-3 p-3.5 rounded-xl border border-black/5 hover:bg-[var(--app-bg)] transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#1c1410]">Manage Templates</p>
                <p className="text-[11px] text-[#7a6b5c]">View &amp; create templates</p>
              </div>
            </button>
            <button
              onClick={() => navigate('/inbox')}
              className="flex items-center gap-3 p-3.5 rounded-xl border border-black/5 hover:bg-[var(--app-bg)] transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#1c1410]">Open Inbox</p>
                <p className="text-[11px] text-[#7a6b5c]">View WABA conversations</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Quality Rating & Messaging Limits */}
      {connected && quality?.connected && !quality.error && (
        <div className="bg-white rounded-2xl border border-black/5 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4.5 h-4.5 text-[#7a6b5c]" />
            <h3 className="text-[15px] font-bold text-[#1c1410]">Quality & Limits</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className={cn('rounded-xl border p-3', qualityColor[quality.qualityRating ?? 'UNKNOWN'])}>
              <p className="text-[11px] font-medium opacity-70">Quality Rating</p>
              <p className="text-lg font-bold mt-0.5">{quality.qualityRating ?? 'N/A'}</p>
            </div>
            <div className="rounded-xl border border-black/5 p-3 bg-[#faf8f6]">
              <p className="text-[11px] font-medium text-[#7a6b5c]">Messaging Limit</p>
              <p className="text-lg font-bold text-[#1c1410] mt-0.5">
                {tierLabel[quality.messagingLimitTier ?? ''] ?? quality.messagingLimitTier ?? 'N/A'}
              </p>
            </div>
            <div className="rounded-xl border border-black/5 p-3 bg-[#faf8f6]">
              <p className="text-[11px] font-medium text-[#7a6b5c]">Verified Name</p>
              <p className="text-sm font-semibold text-[#1c1410] mt-1 truncate">{quality.verifiedName ?? 'N/A'}</p>
            </div>
            <div className="rounded-xl border border-black/5 p-3 bg-[#faf8f6]">
              <p className="text-[11px] font-medium text-[#7a6b5c]">Account Status</p>
              <p className="text-sm font-semibold text-[#1c1410] mt-1 capitalize">{quality.accountStatus?.toLowerCase() ?? 'N/A'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Template Analytics */}
      {connected && tplAnalytics.length > 0 && (
        <div className="bg-white rounded-2xl border border-black/5 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4.5 h-4.5 text-[#7a6b5c]" />
            <h3 className="text-[15px] font-bold text-[#1c1410]">Template Analytics</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5">
                  <th className="text-left py-2 px-3 text-[11px] font-semibold text-[#7a6b5c]">Template</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold text-[#7a6b5c]">Sent</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold text-[#7a6b5c]">Delivered</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold text-[#7a6b5c]">Read</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold text-[#7a6b5c]">Failed</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold text-[#7a6b5c]">Delivery %</th>
                </tr>
              </thead>
              <tbody>
                {tplAnalytics.map((t) => {
                  const deliveryRate = t.sent > 0 ? Math.round((t.delivered / t.sent) * 100) : 0;
                  return (
                    <tr key={t.id} className="border-b border-black/5 last:border-0 hover:bg-[#faf8f6] transition-colors">
                      <td className="py-2.5 px-3">
                        <p className="font-medium text-[#1c1410]">{t.name}</p>
                        <p className="text-[11px] text-[#7a6b5c] font-mono">{t.meta_name}</p>
                      </td>
                      <td className="text-right py-2.5 px-3 font-semibold text-[#1c1410]">{t.sent}</td>
                      <td className="text-right py-2.5 px-3 text-emerald-600 font-semibold">{t.delivered}</td>
                      <td className="text-right py-2.5 px-3 text-blue-600 font-semibold">{t.read}</td>
                      <td className="text-right py-2.5 px-3 text-red-500 font-semibold">{t.failed}</td>
                      <td className="text-right py-2.5 px-3">
                        {t.sent > 0 ? (
                          <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
                            deliveryRate >= 90 ? 'bg-green-50 text-green-700' :
                            deliveryRate >= 70 ? 'bg-amber-50 text-amber-700' :
                            'bg-red-50 text-red-700'
                          )}>{deliveryRate}%</span>
                        ) : <span className="text-xs text-[#7a6b5c]">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Setup / Credentials (collapsible when connected) */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        <button
          onClick={() => setShowSetup(!showSetup)}
          className="w-full flex items-center justify-between p-5 hover:bg-[var(--app-bg)] transition-colors"
        >
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-[#7a6b5c]" />
            <div className="text-left">
              <h3 className="text-[15px] font-bold text-[#1c1410]">WABA Credentials</h3>
              <p className="text-[11px] text-[#7a6b5c]">
                {connected ? 'Update your WhatsApp Business API configuration' : 'Enter your credentials to connect'}
              </p>
            </div>
          </div>
          {showSetup ? <ChevronUp className="w-4 h-4 text-[#7a6b5c]" /> : <ChevronDown className="w-4 h-4 text-[#7a6b5c]" />}
        </button>

        {showSetup && (
          <div className="px-5 pb-5 space-y-5 border-t border-black/5 pt-5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#7a6b5c]">Fill in your Meta WhatsApp Business Account details</span>
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
                  Access Token *{connected && <span className="text-[11px] text-[#b09e8d] ml-1">(leave blank to keep existing)</span>}
                </label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder={connected ? '••••••••' : 'EAABwzLix...'}
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

            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving
                  ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Saving...</>
                  : <><Check className="w-4 h-4 mr-1" /> {connected ? 'Update Configuration' : 'Save & Connect'}</>
                }
              </Button>
              {connected && (
                <Button variant="outline" onClick={() => setShowSetup(false)}>Cancel</Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Webhook Configuration */}
      <div className="bg-white rounded-2xl border border-black/5 p-5 space-y-4">
        <h3 className="text-[15px] font-bold text-[#1c1410]">Webhook Configuration</h3>
        <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#7a6b5c]">
            Add these in your Meta App Dashboard under <strong>WhatsApp &rarr; Configuration</strong>.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Inbound Webhook URL</label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="flex-1 font-mono text-sm bg-[var(--app-bg)]" />
              <Button variant="outline" size="icon" onClick={() => { copyToClipboard(webhookUrl); toast.success('URL copied'); }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Webhook Verify Token</label>
            <div className="flex gap-2">
              <Input value={verifyToken} readOnly className="flex-1 font-mono text-sm bg-[var(--app-bg)]" />
              <Button variant="outline" size="icon" onClick={() => { copyToClipboard(verifyToken); toast.success('Copied'); }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Automation Settings */}
      <div className="bg-white rounded-2xl border border-black/5 p-5 space-y-4">
        <h3 className="text-[15px] font-bold text-[#1c1410]">Automation Settings</h3>
        <div className="space-y-1">
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
    </div>
  );
}
