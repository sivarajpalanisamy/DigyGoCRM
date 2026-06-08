import { useBillingStore } from '@/store/billingStore';
import { useAuthStore } from '@/store/authStore';
import { AlertTriangle, ShieldCheck, LogOut } from 'lucide-react';

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}
function daysOverdue(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

export function PaymentDuePage() {
  const info = useBillingStore((s) => s.info);
  const currentUser = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const isOwner = currentUser?.role === 'owner';

  const cycleLabel = info?.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly';
  const overdue = daysOverdue(info?.expires_at);

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 bg-[var(--app-bg)]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-black/5 overflow-hidden">
        <div className="px-6 py-5 text-center" style={{ background: 'linear-gradient(135deg, var(--brand-dark, #9a3412) 0%, var(--brand, #ea580c) 100%)' }}>
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-white font-bold text-[18px]">Subscription Payment Due</h1>
          {info?.business_name && <p className="text-white/85 text-[13px] mt-0.5">{info.business_name}</p>}
        </div>

        <div className="px-6 py-5 space-y-4">
          <dl className="rounded-xl border border-black/5 divide-y divide-black/[0.06] text-[13px]">
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-[#7a6b5c]">Plan</dt><dd className="font-semibold text-[#1c1410]">{cycleLabel}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-[#7a6b5c]">Expired on</dt><dd className="font-semibold text-[#1c1410]">{fmtDate(info?.expires_at)}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-[#7a6b5c]">Overdue</dt><dd className="font-semibold text-red-600">{overdue} day{overdue !== 1 ? 's' : ''}</dd>
            </div>
            {info?.amount_due != null && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <dt className="text-[#7a6b5c]">Amount due</dt><dd className="font-bold text-[#1c1410]">₹{info.amount_due}</dd>
              </div>
            )}
          </dl>

          <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[12px] text-emerald-800 leading-relaxed">
              Your data is safe. New leads are still being captured and your automations are still running in the background — nothing is lost.
            </p>
          </div>

          <p className="text-[13px] text-[#3d3128] text-center">
            {isOwner
              ? 'Please renew your subscription to restore access to the CRM.'
              : 'Access is paused. Please contact your account owner to renew the subscription.'}
          </p>

          <div className="flex flex-col gap-2 pt-1">
            {isOwner && (
              <a href="mailto:admin@digygo.in?subject=Subscription%20Renewal"
                className="w-full text-center px-4 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark, #9a3412), var(--brand, #ea580c))' }}>
                Contact us to renew
              </a>
            )}
            <button onClick={logout}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] bg-gray-100 hover:bg-gray-200 transition-colors">
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
