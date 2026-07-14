import { useState, useEffect } from 'react';
import { Users, Phone, MessageSquare, CheckSquare, TrendingUp, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, LabelList,
} from 'recharts';
import { api } from '@/lib/api';
import ChartTooltip from '@/components/charts/ChartTooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';

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
        <h1 className="text-[22px] font-headline font-bold text-[#111318]">Staff Scorecard</h1>
        <p className="text-[15px] text-[#6b7280] mt-0.5">Activity metrics and performance per staff member</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] p-1 flex-wrap">
        {PERIODS.map((p) => (
          <button key={p.value} onClick={() => setPeriod(p.value)}
            className={cn(
              'text-[14px] font-semibold px-3.5 py-1.5 rounded-full transition-all',
              period === p.value
                ? 'bg-primary text-white shadow-sm'
                : 'text-[#6b7280] hover:text-[#111318]',
            )}>
            {p.label}
          </button>
        ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <DatePicker value={from} onChange={setFrom} placeholder="Start date" />
            <span className="text-[14px] text-[#8b929c]">to</span>
            <DatePicker value={to} onChange={setTo} placeholder="End date" />
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
            <div className="lg:col-span-2 bg-white rounded-2xl border border-[var(--hairline)] card-shadow overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--hairline)]">
                <p className="text-[16px] font-bold text-[#111318]">Activity Comparison</p>
                <p className="text-[12px] text-[#8b929c] mt-0.5">Calls, messages, and follow-ups per staff</p>
              </div>
              <div className="p-5">
                {staff.length === 0 ? (
                  <div className="h-[260px] flex items-center justify-center text-[15px] text-[#8b929c]">No staff data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(260, staff.length * 40)}>
                    <BarChart data={staff} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="staff_name" width={100} tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="calls_made" fill="#3b82f6" name="Calls" radius={[0, 2, 2, 0]} barSize={10} />
                      <Bar dataKey="messages_sent" fill="#10b981" name="Messages" radius={[0, 2, 2, 0]} barSize={10} />
                      <Bar dataKey="followups_completed" fill="#f59e0b" name="Follow-ups" radius={[0, 2, 2, 0]} barSize={10} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Radar chart for selected staff */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--hairline)]">
                <p className="text-[16px] font-bold text-[#111318]">Staff Profile</p>
                <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)}
                  className="mt-1 text-[14px] border border-[var(--hairline)] rounded-xl px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
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
                      <PolarGrid stroke="#e5e7eb" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <PolarRadiusAxis tick={{ fontSize: 9, fill: '#8b929c' }} />
                      <Radar dataKey="value" stroke="#ea580c" fill="#ea580c" fillOpacity={0.2} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-[15px] text-[#8b929c]">Select a staff member</div>
                )}
              </div>
            </div>
          </div>

          {/* Staff table */}
          <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--hairline)]">
              <p className="text-[16px] font-bold text-[#111318]">Detailed Scorecard</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-[var(--hairline)] text-left text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">
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
                    <tr><td colSpan={8} className="text-center py-8 text-[#8b929c]">No staff data</td></tr>
                  ) : staff.map((s) => (
                    <tr key={s.staff_id} className="border-b border-[var(--hairline)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer" onClick={() => setSelected(s.staff_id)}>
                      <td className="px-5 py-3 font-medium text-[#111318]">{s.staff_name}</td>
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
      <div><p className="text-[12px] opacity-75 text-white">{label}</p><h3 className="font-bold text-[24px] leading-tight text-white">{value}</h3></div>
    </div>
  );
  return (
    <div className="bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 border border-[var(--hairline)] card-shadow">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10"><Icon className="w-4 h-4 text-primary" /></div>
      <div><p className="text-[12px] text-[#6b7280]">{label}</p><h3 className="font-bold text-[24px] leading-tight text-[#111318]">{value}</h3></div>
    </div>
  );
}
