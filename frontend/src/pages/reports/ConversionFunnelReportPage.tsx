import { useState, useEffect } from 'react';
import { GitBranch, TrendingUp, Clock, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, FunnelChart, Funnel, LabelList, Cell,
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

const FUNNEL_COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ea580c', '#f43f5e', '#8b5cf6', '#84cc16', '#0ea5e9'];

interface StageRow {
  stage_id: string;
  stage_name: string;
  stage_order: number;
  is_won: boolean;
  current_count: number;
  total_entered: number;
  conversion_pct: number;
  avg_days_in_stage: number;
}

export default function ConversionFunnelReportPage() {
  const pipelines = useCrmStore((s) => s.pipelines);
  const [pipelineId, setPipelineId] = useState('');
  const [period, setPeriod] = useState('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [pipelineName, setPipelineName] = useState('');
  const [stages, setStages] = useState<StageRow[]>([]);

  useEffect(() => {
    if (pipelines.length > 0 && !pipelineId) {
      setPipelineId(pipelines[0].id);
    }
  }, [pipelines, pipelineId]);

  useEffect(() => {
    if (!pipelineId) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const params: Record<string, string> = { pipeline_id: pipelineId, period };
        if (period === 'custom' && from) params.date_from = from;
        if (period === 'custom' && to) params.date_to = to;
        const { data } = await api.get('/api/reports/conversion-funnel-detail', { params });
        setPipelineName(data.pipeline_name ?? '');
        setStages(data.stages ?? []);
      } catch {
        toast.error('Failed to load funnel data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [pipelineId, period, from, to]);

  const totalLeads = stages.length > 0 ? (stages[0].total_entered || stages[0].current_count || 0) : 0;
  const wonStage = stages.find((s) => s.is_won);
  const convRate = totalLeads > 0 && wonStage ? Math.round(((wonStage.total_entered || wonStage.current_count) / totalLeads) * 100) : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-5">
      <div>
        <h1 className="text-[22px] font-headline font-bold text-[#1c1410]">Conversion Funnel</h1>
        <p className="text-[14px] text-[#7a6b5c] mt-0.5">Drop-off rate at each pipeline stage</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}
          className="text-[13px] border border-black/10 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-[var(--brand)] font-semibold">
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
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
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-black/10 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--brand)] bg-white" />
            <span className="text-[13px] text-[#9a8a7a]">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-black/10 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--brand)] bg-white" />
          </div>
        )}
      </div>

      {loading && stages.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-5 h-5 animate-spin text-[var(--brand-dark)]" />
        </div>
      ) : stages.length === 0 ? (
        <div className="text-center py-20 text-[14px] text-[#9a8a7a]">Select a pipeline to view funnel</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={GitBranch} label="Pipeline" value={pipelineName} accent />
            <KpiCard icon={TrendingUp} label="Total Leads" value={totalLeads} />
            <KpiCard icon={TrendingUp} label="Conversion Rate" value={`${convRate}%`} />
            <KpiCard icon={Clock} label="Stages" value={stages.length} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Funnel visualization */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[15px] font-bold text-[#1c1410]">Stage Funnel</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Lead count at each stage</p>
              </div>
              <div className="p-5">
                <ResponsiveContainer width="100%" height={Math.max(280, stages.length * 50)}>
                  <BarChart data={stages} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="stage_name" width={110} tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }}
                      formatter={(v: number, _n: string, p: any) => [`${v} leads (${p.payload.conversion_pct}%)`, 'Count']} />
                    <Bar dataKey="current_count" radius={[0, 4, 4, 0]} barSize={24}>
                      {stages.map((_, i) => (
                        <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                      ))}
                      <LabelList dataKey="conversion_pct" position="right" style={{ fontSize: 10, fill: '#7a6b5c' }}
                        formatter={(v: number) => `${v}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Stage-to-stage drop-off */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-black/5">
                <p className="text-[15px] font-bold text-[#1c1410]">Stage Drop-off</p>
                <p className="text-[11px] text-[#9a8a7a] mt-0.5">Conversion between consecutive stages</p>
              </div>
              <div className="p-5 space-y-3">
                {stages.map((s, i) => {
                  const prev = i > 0 ? (stages[i-1].total_entered || stages[i-1].current_count || 1) : null;
                  const curr = s.total_entered || s.current_count || 0;
                  const dropPct = prev ? Math.round((1 - curr / prev) * 100) : 0;
                  const fillPct = s.conversion_pct;

                  return (
                    <div key={s.stage_id ?? i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] font-medium text-[#1c1410]">{s.stage_name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-[#7a6b5c]">{curr} leads</span>
                          {i > 0 && (
                            <span className={cn(
                              'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                              dropPct > 50 ? 'bg-red-50 text-red-600' :
                              dropPct > 20 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
                            )}>
                              -{dropPct}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-2 bg-[#f0ebe4] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${Math.max(fillPct, 2)}%`,
                          backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                        }} />
                      </div>
                      {s.avg_days_in_stage > 0 && (
                        <p className="text-[10px] text-[#9a8a7a] mt-0.5">Avg {s.avg_days_in_stage}d in stage</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Detailed table */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-black/5">
              <p className="text-[15px] font-bold text-[#1c1410]">Stage Details</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-black/5 text-left text-[#7a6b5c]">
                    <th className="px-5 py-3 font-semibold">Stage</th>
                    <th className="px-3 py-3 font-semibold text-right">Current Leads</th>
                    <th className="px-3 py-3 font-semibold text-right">Total Entered</th>
                    <th className="px-3 py-3 font-semibold text-right">Conversion %</th>
                    <th className="px-3 py-3 font-semibold text-right">Avg Days</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((s, i) => (
                    <tr key={s.stage_id ?? i} className="border-b border-black/5 hover:bg-[#faf8f6]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }} />
                          <span className="font-medium text-[#1c1410]">{s.stage_name}</span>
                          {s.is_won && <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">Won</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">{s.current_count}</td>
                      <td className="px-3 py-3 text-right">{s.total_entered || '-'}</td>
                      <td className="px-3 py-3 text-right font-semibold">{s.conversion_pct}%</td>
                      <td className="px-3 py-3 text-right text-[#7a6b5c]">{s.avg_days_in_stage}d</td>
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
