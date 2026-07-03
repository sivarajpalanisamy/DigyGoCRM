import { useState, useEffect } from 'react';
import { CheckSquare, AlertTriangle, Clock, TrendingUp, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, LabelList, Cell,
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

interface Kpi {
  total: number;
  completed: number;
  overdue: number;
  pending: number;
  compliance_pct: number;
}
interface StaffRow {
  staff_name: string;
  staff_id: string;
  total: number;
  completed: number;
  overdue: number;
  pending: number;
  compliance_pct: number;
}
interface OverdueRow {
  id: string;
  title: string;
  due_at: string;
  lead_name: string;
  lead_id: string;
  staff_name: string;
  overdue_days: number;
}
interface DailyRow { date: string; completed: number; pending: number; }

export default function FollowupComplianceReportPage() {
  const [period, setPeriod] = useState('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [overdueList, setOverdueList] = useState<OverdueRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const params: Record<string, string> = { period };
        if (period === 'custom' && from) params.date_from = from;
        if (period === 'custom' && to) params.date_to = to;
        const { data } = await api.get('/api/reports/followup-compliance', { params });
        setKpi(data.kpi);
        setStaff(data.staff ?? []);
        setOverdueList(data.overdue_list ?? []);
        setDaily(data.daily ?? []);
      } catch {
        toast.error('Failed to load follow-up compliance data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [period, from, to]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-5">
      <div>
        <h1 className="text-[22px] font-headline font-bold text-[#1c1410]">Follow-up Compliance</h1>
        <p className="text-[13px] text-[#7a6b5c] mt-0.5">Scheduled vs completed vs overdue follow-ups by staff</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PERIODS.map((p) => (
          <button key={p.value} onClick={() => setPeriod(p.value)}
            className={cn(
              'text-[12px] font-semibold px-3.5 py-1.5 rounded-lg border transition-all',
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
              className="border border-black/10 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:border-[var(--brand)] bg-white" />
            <span className="text-[12px] text-[#9a8a7a]">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-black/10 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:border-[var(--brand)] bg-white" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-5 h-5 animate-spin text-[var(--brand-dark)]" />
        </div>
      ) : !kpi ? (
        <div className="text-center py-20 text-[13px] text-[#9a8a7a]">No data available</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard icon={CheckSquare} label="Total Follow-ups" value={kpi.total} accent />
            <KpiCard icon={TrendingUp} label="Completed" value={kpi.completed} sub={`${kpi.compliance_pct}% rate`} />
            <KpiCard icon={Clock} label="Pending" value={kpi.pending} />
            <KpiCard icon={AlertTriangle} label="Overdue" value={kpi.overdue} />
            <KpiCard icon={TrendingUp} label="Compliance" value={`${kpi.compliance_pct}%`}
              sub={kpi.compliance_pct >= 80 ? 'Good' : kpi.compliance_pct >= 50 ? 'Needs improvement' : 'Critical'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Daily trend */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[14px] font-bold text-[#1c1410]">Daily Follow-up Trend</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Completed vs pending per day</p>
              </div>
              <div className="p-5">
                {daily.length === 0 ? (
                  <div className="h-[220px] flex items-center justify-center text-[13px] text-[#9a8a7a]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false}
                        tickFormatter={(v: string) => { const d = new Date(v); return `${d.getDate()}/${d.getMonth()+1}`; }} />
                      <YAxis tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="completed" fill="#10b981" name="Completed" radius={[2, 2, 0, 0]} stackId="a" />
                      <Bar dataKey="pending" fill="#f59e0b" name="Pending" radius={[2, 2, 0, 0]} stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Staff compliance chart */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[14px] font-bold text-[#1c1410]">Staff Compliance Rate</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Completion percentage per agent</p>
              </div>
              <div className="p-5">
                {staff.length === 0 ? (
                  <div className="h-[220px] flex items-center justify-center text-[13px] text-[#9a8a7a]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(220, staff.length * 36)}>
                    <BarChart data={staff} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false}
                        tickFormatter={(v: number) => `${v}%`} />
                      <YAxis type="category" dataKey="staff_name" width={100} tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }}
                        formatter={(v: number) => [`${v}%`, 'Compliance']} />
                      <Bar dataKey="compliance_pct" radius={[0, 4, 4, 0]} barSize={18}>
                        {staff.map((s, i) => (
                          <Cell key={i} fill={s.compliance_pct >= 80 ? '#10b981' : s.compliance_pct >= 50 ? '#f59e0b' : '#ef4444'} />
                        ))}
                        <LabelList dataKey="compliance_pct" position="right" style={{ fontSize: 10, fill: '#7a6b5c' }}
                          formatter={(v: number) => `${v}%`} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Staff table */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-black/5">
              <p className="text-[14px] font-bold text-[#1c1410]">Staff Breakdown</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-black/5 text-left text-[#7a6b5c]">
                    <th className="px-5 py-3 font-semibold">Staff</th>
                    <th className="px-3 py-3 font-semibold text-right">Total</th>
                    <th className="px-3 py-3 font-semibold text-right">Completed</th>
                    <th className="px-3 py-3 font-semibold text-right">Pending</th>
                    <th className="px-3 py-3 font-semibold text-right">Overdue</th>
                    <th className="px-3 py-3 font-semibold text-right">Compliance</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-[#9a8a7a]">No staff data</td></tr>
                  ) : staff.map((s) => (
                    <tr key={s.staff_id} className="border-b border-black/5 hover:bg-[#faf8f6]">
                      <td className="px-5 py-3 font-medium text-[#1c1410]">{s.staff_name}</td>
                      <td className="px-3 py-3 text-right">{s.total}</td>
                      <td className="px-3 py-3 text-right text-emerald-600 font-semibold">{s.completed}</td>
                      <td className="px-3 py-3 text-right">{s.pending}</td>
                      <td className="px-3 py-3 text-right">
                        {s.overdue > 0 ? <span className="text-red-600 font-semibold">{s.overdue}</span> : '0'}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={cn(
                          'inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold',
                          s.compliance_pct >= 80 ? 'bg-emerald-50 text-emerald-700' :
                          s.compliance_pct >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700',
                        )}>
                          {s.compliance_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Overdue list */}
          {overdueList.length > 0 && (
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[14px] font-bold text-[#1c1410]">Overdue Follow-ups</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Top 20 most overdue tasks</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-black/5 text-left text-[#7a6b5c]">
                      <th className="px-5 py-3 font-semibold">Lead</th>
                      <th className="px-3 py-3 font-semibold">Task</th>
                      <th className="px-3 py-3 font-semibold">Staff</th>
                      <th className="px-3 py-3 font-semibold text-right">Due Date</th>
                      <th className="px-3 py-3 font-semibold text-right">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueList.map((o) => (
                      <tr key={o.id} className="border-b border-black/5 hover:bg-[#faf8f6]">
                        <td className="px-5 py-3 font-medium text-[#1c1410]">{o.lead_name}</td>
                        <td className="px-3 py-3 text-[#7a6b5c]">{o.title || '-'}</td>
                        <td className="px-3 py-3 text-[#7a6b5c]">{o.staff_name || '-'}</td>
                        <td className="px-3 py-3 text-right text-[#7a6b5c]">{new Date(o.due_at).toLocaleDateString()}</td>
                        <td className="px-3 py-3 text-right">
                          <span className="text-red-600 font-semibold">{o.overdue_days}d</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string | number; sub?: string; icon: React.ElementType; accent?: boolean;
}) {
  if (accent) return (
    <div className="rounded-xl px-4 py-3.5 flex items-center gap-3"
      style={{ background: 'linear-gradient(135deg,var(--brand-dark) 0%,var(--brand) 55%,var(--brand-light) 100%)', boxShadow: '0 4px 20px rgba(234,88,12,0.25)' }}>
      <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-white" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] opacity-75 text-white truncate">{label}</p>
        <h3 className="font-bold text-[24px] leading-tight text-white">{value}</h3>
        {sub && <p className="text-[10px] mt-0.5 opacity-65 text-white truncate">{sub}</p>}
      </div>
    </div>
  );
  return (
    <div className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3 border border-black/5 shadow-sm">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10"><Icon className="w-4 h-4 text-primary" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-[#7a6b5c] truncate">{label}</p>
        <h3 className="font-bold text-[24px] leading-tight text-[#1c1410]">{value}</h3>
        {sub && <p className="text-[10px] mt-0.5 text-[#9a8a7a] truncate">{sub}</p>}
      </div>
    </div>
  );
}
