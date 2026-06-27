import { useState, useEffect } from 'react';
import { ArrowLeft, Trash2, ShieldCheck, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { usePermission } from '@/hooks/usePermission';

interface VerifiedNumber {
  id: string;
  phone_number: string;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
  user_name: string;
  user_email: string;
}

export default function DevicesPage() {
  const navigate = useNavigate();
  const canView = usePermission('devices:view');
  const canManage = usePermission('devices:manage');

  const [numbers, setNumbers] = useState<VerifiedNumber[]>([]);
  const [loading, setLoading] = useState(true);

  // Verify-a-number form
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<{ numbers: VerifiedNumber[] }>('/api/devices/numbers')
      .then((d) => setNumbers(d.numbers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const sendOtp = async () => {
    if (phone.trim().length < 8) { toast.error('Enter a valid mobile number with country code'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ sent: boolean; channel: 'email' | null; sentTo: string | null; devOtp?: string }>('/api/devices/number/request-otp', { phone });
      setOtpSent(true);
      if (r.devOtp) toast.success(`OTP (dev): ${r.devOtp}`, { duration: 10000 });
      else if (r.channel === 'whatsapp') toast.success(`OTP sent on WhatsApp${r.sentTo ? ` to ${r.sentTo}` : ''}`);
      else if (r.channel === 'email') toast.success(`WhatsApp unavailable - OTP emailed${r.sentTo ? ` to ${r.sentTo}` : ''}`);
      else toast.success('OTP sent');
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send OTP');
    } finally { setBusy(false); }
  };

  const verifyOtp = async () => {
    if (!otp.trim()) { toast.error('Enter the OTP'); return; }
    setBusy(true);
    try {
      await api.post('/api/devices/number/verify-otp', { phone, otp });
      toast.success('Number verified - it can now connect from the app');
      setPhone(''); setOtp(''); setOtpSent(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Verification failed');
    } finally { setBusy(false); }
  };

  const deleteNumber = async (id: string) => {
    if (!confirm('Remove this number? Calls from it will no longer sync/record.')) return;
    try { await api.delete(`/api/devices/number/${id}`); toast.success('Removed'); load(); }
    catch (e: any) { toast.error(e.message ?? 'Failed'); }
  };

  if (!canView) {
    return <div className="p-8 text-center text-[#7a6b5c]">You don't have permission to view this page.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/settings')} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-headline font-bold text-[#1c1410] text-lg leading-tight">Dialer Device Pair</h1>
          <p className="text-[12px] text-[#7a6b5c]">Verify a mobile number with OTP, then connect that SIM from the DigyGo Dialer app to record its calls</p>
        </div>
      </div>

      {/* Verify a number */}
      {canManage && (
        <section className="bg-white rounded-xl border border-black/5 p-5 mb-6">
          <h2 className="font-semibold text-[#1c1410] text-[14px] mb-1">Verify a mobile number</h2>
          <p className="text-[12px] text-[#7a6b5c] mb-4">
            Enter the number with country code (e.g. +9198…). We'll email a 6-digit OTP to your registered email. Once verified here and SIM-verified in the app, that number's calls are recorded into the CRM.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              disabled={otpSent}
              className="flex-1 border border-black/10 rounded-lg px-3 py-2.5 text-[14px] disabled:bg-black/5"
            />
            {!otpSent ? (
              <button onClick={sendOtp} disabled={busy}
                className="bg-gradient-to-r from-[#c2410c] to-[#ea580c] text-white text-[13px] font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-60">
                {busy ? 'Sending…' : 'Send OTP'}
              </button>
            ) : (
              <button onClick={() => { setOtpSent(false); setOtp(''); }}
                className="border border-black/10 text-[#1c1410] text-[13px] font-semibold px-5 py-2.5 rounded-lg hover:bg-black/5">
                Change
              </button>
            )}
          </div>
          {otpSent && (
            <div className="flex flex-col sm:flex-row gap-3 mt-3">
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 6-digit OTP"
                inputMode="numeric"
                className="flex-1 border border-black/10 rounded-lg px-3 py-2.5 text-[14px] tracking-widest"
              />
              <button onClick={verifyOtp} disabled={busy}
                className="bg-emerald-600 text-white text-[13px] font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-60">
                {busy ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#7a6b5c] mb-2">Verified numbers</h3>
          {numbers.length === 0 ? (
            <div className="bg-white rounded-xl border border-black/5 p-6 text-center text-[13px] text-[#7a6b5c]">
              No numbers yet. Verify one above.
            </div>
          ) : (
            <div className="space-y-2">
              {numbers.map((n) => (
                <div key={n.id} className="bg-white rounded-xl border border-black/5 p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${n.verified ? 'bg-emerald-100 text-emerald-600' : 'bg-yellow-100 text-yellow-600'}`}>
                    {n.verified ? <ShieldCheck className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#1c1410] text-[14px]">{n.phone_number}</p>
                    <p className="text-[12px] text-[#7a6b5c] truncate">{n.user_name} · {n.verified ? 'Verified' : 'Pending OTP'}</p>
                  </div>
                  {canManage && (
                    <button onClick={() => deleteNumber(n.id)} className="p-2 rounded-lg text-red-500 hover:bg-red-50 shrink-0" title="Remove">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
