import { useState, useEffect } from 'react';
import { Target, TrendingUp, Clock, Users, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, Cell, LabelList,
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

const SOURCE_COLORS = ['#ea580c', '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#f43f5e', '#84cc16', '#0ea5e9'];

interface SourceRow {
  source: string;
  total_leads: number;
  contacted: number;
  won: number;
  conv_pct: number;
  avg_days_to_convert: number;
}
interface MonthlyRow { month: string; source: string; count: number; }

export default function SourceRoiReportPage() {
  const [period, setPeriod] = useState('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);

  useEffect(() => {
    const load = async () => {
      // Keep current data visible on filter changes; spinner shows only on first mount.
      try {
        const params: Record<string, string> = { period };
        if (period === 'custom' && from) params.date_from = from;
        if (period === 'custom' && to) params.date_to = to;
        const { data } = await api.get('/api/reports/source-roi-detail', { params });
        setSources(data.sources ?? []);
        setMonthly(data.monthly ?? []);
      } catch {
        toast.error('Failed to load source ROI data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [period, from, to]);

  const totalLeads = sources.reduce((s, r) => s + r.total_leads, 0);
  const totalWon = sources.reduce((s, r) => s + r.won, 0);
  const overallConv = totalLeads > 0 ? Math.round((totalWon / totalLeads) * 100) : 0;
  const topSource = sources.length > 0 ? sources[0].source : '-';

  // Build monthly trend data (pivot sources into columns)
  const sourceNames = [...new Set(monthly.map((m) => m.source))];
  const monthMap = new Map<string, Record<string, number>>();
  for (const m of monthly) {
    if (!monthMap.has(m.month)) monthMap.set(m.month, {});
    monthMap.get(m.month)![m.source] = m.count;
  }
  const trendData = [...monthMap.entries()].map(([month, data]) => ({ month, ...data }));

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-5">
      <div>
        <h1 className="text-[22px] font-headline font-bold text-[#1c1410]">Source ROI</h1>
        <p className="text-[14px] text-[#7a6b5c] mt-0.5">Leads per source with conversion rate and time-to-convert</p>
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
            <KpiCard icon={Target} label="Top Source" value={topSource} accent />
            <KpiCard icon={Users} label="Total Leads" value={totalLeads} />
            <KpiCard icon={TrendingUp} label="Overall Conversion" value={`${overallConv}%`} />
            <KpiCard icon={Clock} label="Sources" value={sources.length} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Source bar chart */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[15px] font-bold text-[#1c1410]">Leads by Source</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Total leads and won leads per source</p>
              </div>
              <div className="p-5">
                {sources.length === 0 ? (
                  <div className="h-[240px] flex items-center justify-center text-[14px] text-[#9a8a7a]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(240, sources.length * 40)}>
                    <BarChart data={sources} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="source" width={100} tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }} />
                      <Bar dataKey="total_leads" fill="#3b82f6" name="Total" radius={[0, 2, 2, 0]} barSize={12} />
                      <Bar dataKey="won" fill="#10b981" name="Won" radius={[0, 2, 2, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Monthly trend */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[15px] font-bold text-[#1c1410]">Monthly Source Trend</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Lead volume by source over time</p>
              </div>
              <div className="p-5">
                {trendData.length === 0 ? (
                  <div className="h-[240px] flex items-center justify-center text-[14px] text-[#9a8a7a]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {sourceNames.slice(0, 6).map((name, i) => (
                        <Line key={name} type="monotone" dataKey={name} stroke={SOURCE_COLORS[i % SOURCE_COLORS.length]}
                          strokeWidth={2} dot={{ r: 2 }} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Conversion comparison */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-black/5">
              <p className="text-[15px] font-bold text-[#1c1410]">Source Conversion Comparison</p>
              <p className="text-[11px] text-[#9a8a7a] mt-0.5">Conversion rate per source</p>
            </div>
            <div className="p-5">
              {sources.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-[14px] text-[#9a8a7a]">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={sources}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                    <XAxis dataKey="source" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false}
                      tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }}
                      formatter={(v: number) => [`${v}%`, 'Conversion']} />
                    <Bar dataKey="conv_pct" radius={[4, 4, 0, 0]} barSize={32}>
                      {sources.map((_, i) => (
                        <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                      ))}
                      <LabelList dataKey="conv_pct" position="top" style={{ fontSize: 10, fill: '#7a6b5c' }}
                        formatter={(v: number) => `${v}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Detailed table */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-black/5">
              <p className="text-[15px] font-bold text-[#1c1410]">Source Details</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-black/5 text-left text-[#7a6b5c]">
                    <th className="px-5 py-3 font-semibold">Source</th>
                    <th className="px-3 py-3 font-semibold text-right">Total Leads</th>
                    <th className="px-3 py-3 font-semibold text-right">Contacted</th>
                    <th className="px-3 py-3 font-semibold text-right">Won</th>
                    <th className="px-3 py-3 font-semibold text-right">Conversion</th>
                    <th className="px-3 py-3 font-semibold text-right">Avg Days to Convert</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-[#9a8a7a]">No source data</td></tr>
                  ) : sources.map((s, i) => (
                    <tr key={s.source} className="border-b border-black/5 hover:bg-[#faf8f6]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                          <span className="font-medium text-[#1c1410]">{s.source}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">{s.total_leads}</td>
                      <td className="px-3 py-3 text-right">{s.contacted}</td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-600">{s.won}</td>
                      <td className="px-3 py-3 text-right">
                        <span className={cn(
                          'inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold',
                          s.conv_pct >= 30 ? 'bg-emerald-50 text-emerald-700' :
                          s.conv_pct >= 10 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700',
                        )}>
                          {s.conv_pct}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-[#7a6b5c]">{s.avg_days_to_convert}d</td>
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
      <div className="min-w-0 flex-1"><p className="text-[11px] opacity-75 text-white truncate">{label}</p><h3 className="font-bold text-[20px] leading-tight text-white truncate">{value}</h3></div>
    </div>
  );
  return (
    <div className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3 border border-black/5 shadow-sm">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10"><Icon className="w-4 h-4 text-primary" /></div>
      <div className="min-w-0 flex-1"><p className="text-[11px] text-[#7a6b5c] truncate">{label}</p><h3 className="font-bold text-[24px] leading-tight text-[#1c1410]">{value}</h3></div>
    </div>
  );
}
