import { useState, useEffect } from 'react';
import { Clock, Users, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, LabelList,
} from 'recharts';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useCrmStore } from '@/store/crmStore';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
];

interface Kpi {
  total_leads: number;
  avg_response_min: number | null;
  median_response_min: number | null;
  within_5min: number;
  within_30min: number;
  within_1hr: number;
  no_response: number;
}
interface StaffRow {
  staff_name: string;
  staff_id: string;
  total_leads: number;
  within_5min: number;
  within_30min: number;
  within_1hr: number;
  avg_response_min: number | null;
}
interface DailyRow { date: string; avg_response_min: number | null; total_leads: number; }

function formatMin(m: number | null): string {
  if (m == null) return '-';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}

export default function ResponseTimeReportPage() {
  const pipelines = useCrmStore((s) => s.pipelines);
  const [period, setPeriod] = useState('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const params: Record<string, string> = { period };
        if (period === 'custom' && from) params.date_from = from;
        if (period === 'custom' && to) params.date_to = to;
        if (pipelineId) params.pipeline_id = pipelineId;
        const { data } = await api.get('/api/reports/response-time', { params });
        setKpi(data.kpi);
        setStaff(data.staff ?? []);
        setDaily(data.daily ?? []);
      } catch {
        toast.error('Failed to load response time data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [period, from, to, pipelineId]);

  const pct = (n: number) => kpi && kpi.total_leads > 0 ? Math.round((n / kpi.total_leads) * 100) : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-5">
      <div>
        <h1 className="text-[22px] font-headline font-bold text-[#1c1410]">Lead Response Time</h1>
        <p className="text-[13px] text-[#7a6b5c] mt-0.5">How quickly your team contacts new leads</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
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
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-black/10 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:border-[var(--brand)] bg-white" />
            <span className="text-[12px] text-[#9a8a7a]">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-black/10 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:border-[var(--brand)] bg-white" />
          </div>
        )}
        <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}
          className="text-[12px] border border-black/10 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-[var(--brand)]">
          <option value="">All Pipelines</option>
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={Clock} label="Avg Response" value={formatMin(kpi.avg_response_min)} sub={`Median: ${formatMin(kpi.median_response_min)}`} accent />
            <KpiCard icon={CheckCircle2} label="Within 5 min" value={`${pct(kpi.within_5min)}%`} sub={`${kpi.within_5min} of ${kpi.total_leads} leads`} />
            <KpiCard icon={Users} label="Within 30 min" value={`${pct(kpi.within_30min)}%`} sub={`${kpi.within_30min} leads`} />
            <KpiCard icon={AlertTriangle} label="No Response" value={kpi.no_response} sub={`${pct(kpi.no_response)}% of leads`} />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Daily trend */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[14px] font-bold text-[#1c1410]">Response Time Trend</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Average response time per day (minutes)</p>
              </div>
              <div className="p-5">
                {daily.length === 0 ? (
                  <div className="h-[200px] flex items-center justify-center text-[13px] text-[#9a8a7a]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false}
                        tickFormatter={(v: string) => { const d = new Date(v); return `${d.getDate()}/${d.getMonth()+1}`; }} />
                      <YAxis tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }}
                        formatter={(v: number) => [`${v} min`, 'Avg Response']} />
                      <Line type="monotone" dataKey="avg_response_min" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Avg Response (min)" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Response distribution */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[14px] font-bold text-[#1c1410]">Response Distribution</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Leads by response time bucket</p>
              </div>
              <div className="p-5">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[
                    { bucket: '< 5 min', count: kpi.within_5min, fill: '#10b981' },
                    { bucket: '5-30 min', count: kpi.within_30min - kpi.within_5min, fill: '#3b82f6' },
                    { bucket: '30-60 min', count: kpi.within_1hr - kpi.within_30min, fill: '#f59e0b' },
                    { bucket: '> 1 hr', count: kpi.total_leads - kpi.within_1hr - kpi.no_response, fill: '#ef4444' },
                    { bucket: 'No Response', count: kpi.no_response, fill: '#9a8a7a' },
                  ]} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="bucket" width={90} tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#7a6b5c' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Staff table */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-black/5">
              <p className="text-[14px] font-bold text-[#1c1410]">Staff Response Times</p>
              <p className="text-[11px] text-[#9a8a7a] mt-0.5">Per-agent breakdown with benchmark targets</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-black/5 text-left text-[#7a6b5c]">
                    <th className="px-5 py-3 font-semibold">Staff</th>
                    <th className="px-3 py-3 font-semibold text-right">Leads</th>
                    <th className="px-3 py-3 font-semibold text-right">Avg Time</th>
                    <th className="px-3 py-3 font-semibold text-right">&lt; 5 min</th>
                    <th className="px-3 py-3 font-semibold text-right">&lt; 30 min</th>
                    <th className="px-3 py-3 font-semibold text-right">&lt; 1 hr</th>
                    <th className="px-3 py-3 font-semibold text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-[#9a8a7a]">No staff data</td></tr>
                  ) : staff.map((s) => {
                    const score = s.total_leads > 0 ? Math.round((s.within_5min / s.total_leads) * 100) : 0;
                    return (
                      <tr key={s.staff_id} className="border-b border-black/5 hover:bg-[#faf8f6]">
                        <td className="px-5 py-3 font-medium text-[#1c1410]">{s.staff_name ?? 'Unassigned'}</td>
                        <td className="px-3 py-3 text-right">{s.total_leads}</td>
                        <td className="px-3 py-3 text-right font-medium">{formatMin(s.avg_response_min)}</td>
                        <td className="px-3 py-3 text-right">{s.within_5min}</td>
                        <td className="px-3 py-3 text-right">{s.within_30min}</td>
                        <td className="px-3 py-3 text-right">{s.within_1hr}</td>
                        <td className="px-3 py-3 text-right">
                          <span className={cn(
                            'inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold',
                            score >= 70 ? 'bg-emerald-50 text-emerald-700' :
                            score >= 40 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700',
                          )}>
                            {score}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
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
        <h3 className="font-bold text-[24px] leading-tight tracking-tight text-white">{value}</h3>
        {sub && <p className="text-[10px] mt-0.5 opacity-65 text-white truncate">{sub}</p>}
      </div>
    </div>
  );
  return (
    <div className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3 border border-black/5 shadow-sm">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10"><Icon className="w-4 h-4 text-primary" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-[#7a6b5c] truncate">{label}</p>
        <h3 className="font-bold text-[24px] leading-tight tracking-tight text-[#1c1410]">{value}</h3>
        {sub && <p className="text-[10px] mt-0.5 text-[#9a8a7a] truncate">{sub}</p>}
      </div>
    </div>
  );
}
