import { useState, useEffect } from 'react';
import { ArrowLeft, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

interface NotifSetting {
  id: string;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
}

const defaultSettings: NotifSetting[] = [
  { id: 'new_lead', label: 'New Lead Created', description: 'When a new lead is added from any source', inApp: true, email: true },
  { id: 'stage_change', label: 'Lead Stage Changed', description: 'When a lead moves to a different pipeline stage', inApp: true, email: false },
  { id: 'assigned', label: 'Lead Assigned to Me', description: 'When a lead is assigned to your account', inApp: true, email: true },
  { id: 'new_message', label: 'New WhatsApp Message', description: 'Incoming messages in your inbox', inApp: true, email: false },
  { id: 'follow_up_due', label: 'Follow-up Due', description: 'When a scheduled follow-up is about to expire', inApp: true, email: true },
  { id: 'appointment', label: 'Upcoming Appointment', description: '30 minutes before a scheduled meeting or demo', inApp: true, email: true },
  { id: 'workflow_error', label: 'Automation Errors', description: 'When a workflow fails to execute', inApp: true, email: true },
  { id: 'weekly_report', label: 'Weekly Performance Report', description: "Every Monday with your team's weekly summary", inApp: false, email: true },
  { id: 'team_activity', label: 'Team Activity Digest', description: "Daily summary of your team's actions", inApp: false, email: false },
];

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(defaultSettings);
  const [saving, setSaving] = useState(false);

  // Load saved prefs on mount
  useEffect(() => {
    api.get<Record<string, { inApp: boolean; email: boolean }>>('/api/settings/notifications')
      .then((prefs) => {
        if (Object.keys(prefs).length === 0) return;
        setSettings((prev) => prev.map((s) => prefs[s.id] ? { ...s, ...prefs[s.id] } : s));
      })
      .catch(() => {});
  }, []);

  const update = (id: string, channel: 'inApp' | 'email', val: boolean) => {
    setSettings(settings.map((s) => s.id === id ? { ...s, [channel]: val } : s));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const prefs: Record<string, { inApp: boolean; email: boolean }> = {};
      settings.forEach((s) => { prefs[s.id] = { inApp: s.inApp, email: s.email }; });
      await api.put('/api/settings/notifications', prefs);
      toast.success('Notification preferences saved');
    } catch {
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[#1c1410] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-black/5 card-shadow overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-5 py-3 border-b border-black/5 bg-[var(--app-bg)]">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Notification</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] text-center w-16">In-App</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] text-center w-28">
            Email
          </span>
        </div>
        {settings.map((s) => (
          <div
            key={s.id}
            className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-5 py-4 border-b border-black/5 last:border-0 hover:bg-[var(--app-bg)] transition-colors"
          >
            <div>
              <p className="text-[14px] font-semibold text-[#1c1410]">{s.label}</p>
              <p className="text-[11px] text-[#7a6b5c] mt-0.5">{s.description}</p>
            </div>
            <div className="flex justify-center w-16">
              <Switch checked={s.inApp} onCheckedChange={(v) => update(s.id, 'inApp', v)} />
            </div>
            <div className="flex justify-center w-28">
              <Switch checked={s.email} onCheckedChange={(v) => update(s.id, 'email', v)} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving
            ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
            : <><Check className="w-4 h-4 mr-1" /> Save Preferences</>}
        </Button>
        <Button variant="outline" onClick={() => { setSettings(defaultSettings); toast.info('Preferences reset to defaults'); }}>
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}
