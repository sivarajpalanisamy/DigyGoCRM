import { useState, useEffect } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { usePermission } from '@/hooks/usePermission';
import { Switch } from '@/components/ui/switch';

export default function SecurityPage() {
  const navigate = useNavigate();
  const canManage = usePermission('settings:manage');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ twoFactorEnabled: boolean }>('/api/settings/security')
      .then((d) => setEnabled(!!d.twoFactorEnabled))
      .catch(() => toast.error('Failed to load security settings'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (val: boolean) => {
    setEnabled(val);
    setSaving(true);
    try {
      await api.put('/api/settings/security', { two_factor_enabled: val });
      toast.success(val ? 'Two-factor authentication enabled' : 'Two-factor authentication disabled');
    } catch (err: any) {
      setEnabled(!val); // revert on failure
      toast.error(err.message ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return <div className="p-8 text-center text-[#7a6b5c]">You don't have permission to manage security.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/settings')} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-headline font-bold text-[#1c1410] text-lg leading-tight">Security</h1>
          <p className="text-[12px] text-[#7a6b5c]">Protect your team's accounts</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <section className="bg-white rounded-xl border border-black/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-[#1c1410] text-[14px]">Two-Factor Authentication (Email OTP)</h2>
                <p className="text-[12px] text-[#7a6b5c] mt-1 max-w-md">
                  When enabled, every team member must enter a 4-digit code emailed to them on login.
                  They can choose to remember their device for 30 days. Requires email (SMTP) to be working.
                </p>
              </div>
            </div>
            <div className="pt-1 shrink-0">
              <Switch checked={enabled} disabled={saving} onCheckedChange={toggle} />
            </div>
          </div>
          {enabled && (
            <div className="mt-4 pt-4 border-t border-black/5 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              ⚠️ 2FA is ON. Make sure email delivery is working — if codes can't be emailed, users won't be able to log in.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
