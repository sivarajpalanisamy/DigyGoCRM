import { useState, useEffect } from 'react';
import { Users, Phone, MessageSquare, CheckSquare, TrendingUp, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, LabelList,
} from 'recharts';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
];

interface StaffRow {
  staff_id: string;
  staff_name: string;
  total_leads: number;
  calls_made: number;
  messages_sent: number;
  followups_completed: number;
  followups_overdue: number;
  stages_moved: number;
  leads_won: number;
}

export default function StaffScorecardReportPage() {
  const [period, setPeriod] = useState('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      // Keep current data visible on filter changes; spinner shows only on first mount.
      try {
        const params: Record<string, string> = { period };
        if (period === 'custom' && from) params.date_from = from;
        if (period === 'custom' && to) params.date_to = to;
        const { data } = await api.get('/api/reports/staff-scorecard', { params });
        setStaff(data.staff ?? []);
      } catch {
        toast.error('Failed to load staff scorecard');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [period, from, to]);

  const totals = staff.reduce((acc, s) => ({
    leads: acc.leads + s.total_leads,
    calls: acc.calls + s.calls_made,
    messages: acc.messages + s.messages_sent,
    won: acc.won + s.leads_won,
  }), { leads: 0, calls: 0, messages: 0, won: 0 });

  const selectedStaff = selected ? staff.find((s) => s.staff_id === selected) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-5">
      <div>
        <h1 className="text-[22px] font-headline font-bold text-[#1c1410]">Staff Scorecard</h1>
        <p className="text-[14px] text-[#7a6b5c] mt-0.5">Activity metrics and performance per staff member</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PERIODS.map((p) => (
          <button key={p.value} onClick={() => setPeriod(p.value)}
            className={cn(
              'text-[13px] font-semibold px-3.5 py-1.5 rounded-lg border transition-all',
              period === p.value
                ? 'bg-[var(--brand)] text-white border-[var(--brand)] shadow-sm'
                : 'bg-white text-[#7a6b5c] border-black/10 hover:border-primary/40',
            )}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-black/10 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--brand)] bg-white" />
            <span className="text-[13px] text-[#9a8a7a]">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-black/10 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--brand)] bg-white" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-5 h-5 animate-spin text-[var(--brand-dark)]" />
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={Users} label="Total Leads" value={totals.leads} accent />
            <KpiCard icon={Phone} label="Calls Made" value={totals.calls} />
            <KpiCard icon={MessageSquare} label="Messages Sent" value={totals.messages} />
            <KpiCard icon={TrendingUp} label="Leads Won" value={totals.won} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Activity chart */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[15px] font-bold text-[#1c1410]">Activity Comparison</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Calls, messages, and follow-ups per staff</p>
              </div>
              <div className="p-5">
                {staff.length === 0 ? (
                  <div className="h-[260px] flex items-center justify-center text-[14px] text-[#9a8a7a]">No staff data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(260, staff.length * 40)}>
                    <BarChart data={staff} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="staff_name" width={100} tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }} />
                      <Bar dataKey="calls_made" fill="#3b82f6" name="Calls" radius={[0, 2, 2, 0]} barSize={10} />
                      <Bar dataKey="messages_sent" fill="#10b981" name="Messages" radius={[0, 2, 2, 0]} barSize={10} />
                      <Bar dataKey="followups_completed" fill="#f59e0b" name="Follow-ups" radius={[0, 2, 2, 0]} barSize={10} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Radar chart for selected staff */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[15px] font-bold text-[#1c1410]">Staff Profile</p>
                <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)}
                  className="mt-1 text-[13px] border border-black/10 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-[var(--brand)]">
                  <option value="">Select staff</option>
                  {staff.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.staff_name}</option>)}
                </select>
              </div>
              <div className="p-5">
                {selectedStaff ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={[
                      { metric: 'Leads', value: selectedStaff.total_leads },
                      { metric: 'Calls', value: selectedStaff.calls_made },
                      { metric: 'Messages', value: selectedStaff.messages_sent },
                      { metric: 'Follow-ups', value: selectedStaff.followups_completed },
                      { metric: 'Won', value: selectedStaff.leads_won },
                      { metric: 'Stages', value: selectedStaff.stages_moved },
                    ]}>
                      <PolarGrid stroke="#e8e0d8" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: '#7a6b5c' }} />
                      <PolarRadiusAxis tick={{ fontSize: 9, fill: '#9a8a7a' }} />
                      <Radar dataKey="value" stroke="#ea580c" fill="#ea580c" fillOpacity={0.2} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-[14px] text-[#9a8a7a]">Select a staff member</div>
                )}
              </div>
            </div>
          </div>

          {/* Staff table */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-black/5">
              <p className="text-[15px] font-bold text-[#1c1410]">Detailed Scorecard</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-black/5 text-left text-[#7a6b5c]">
                    <th className="px-5 py-3 font-semibold">Staff</th>
                    <th className="px-3 py-3 font-semibold text-right">Leads</th>
                    <th className="px-3 py-3 font-semibold text-right">Calls</th>
                    <th className="px-3 py-3 font-semibold text-right">Messages</th>
                    <th className="px-3 py-3 font-semibold text-right">Follow-ups Done</th>
                    <th className="px-3 py-3 font-semibold text-right">Overdue</th>
                    <th className="px-3 py-3 font-semibold text-right">Stages Moved</th>
                    <th className="px-3 py-3 font-semibold text-right">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-[#9a8a7a]">No staff data</td></tr>
                  ) : staff.map((s) => (
                    <tr key={s.staff_id} className="border-b border-black/5 hover:bg-[#faf8f6] cursor-pointer" onClick={() => setSelected(s.staff_id)}>
                      <td className="px-5 py-3 font-medium text-[#1c1410]">{s.staff_name}</td>
                      <td className="px-3 py-3 text-right">{s.total_leads}</td>
                      <td className="px-3 py-3 text-right">{s.calls_made}</td>
                      <td className="px-3 py-3 text-right">{s.messages_sent}</td>
                      <td className="px-3 py-3 text-right">{s.followups_completed}</td>
                      <td className="px-3 py-3 text-right">
                        {s.followups_overdue > 0 ? (
                          <span className="text-red-600 font-semibold">{s.followups_overdue}</span>
                        ) : '0'}
                      </td>
                      <td className="px-3 py-3 text-right">{s.stages_moved}</td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-600">{s.leads_won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, accent }: {
  label: string; value: string | number; icon: React.ElementType; accent?: boolean;
}) {
  if (accent) return (
    <div className="rounded-xl px-4 py-3.5 flex items-center gap-3"
      style={{ background: 'linear-gradient(135deg,var(--brand-dark) 0%,var(--brand) 55%,var(--brand-light) 100%)', boxShadow: '0 4px 20px rgba(234,88,12,0.25)' }}>
      <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-white" /></div>
      <div><p className="text-[11px] opacity-75 text-white">{label}</p><h3 className="font-bold text-[24px] leading-tight text-white">{value}</h3></div>
    </div>
  );
  return (
    <div className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3 border border-black/5 shadow-sm">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10"><Icon className="w-4 h-4 text-primary" /></div>
      <div><p className="text-[11px] text-[#7a6b5c]">{label}</p><h3 className="font-bold text-[24px] leading-tight text-[#1c1410]">{value}</h3></div>
    </div>
  );
}
