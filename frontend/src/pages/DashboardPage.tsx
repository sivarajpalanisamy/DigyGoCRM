import { useState, useEffect, useMemo } from 'react';
import {
  Users, AlertTriangle, Clock, Target, CheckCircle, Star, PhoneOff, Phone,
} from 'lucide-react';
import { useCrmStore } from '@/store/crmStore';
import { useCompanyStore } from '@/store/companyStore';
import { useUserLevel } from '@/hooks/useUserLevel';
import { api } from '@/lib/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Bar, ComposedChart, LabelList,
} from 'recharts';
import {
  formatDistanceToNow, format, subDays, startOfDay, isToday, isPast,
  addDays, getDaysInMonth, subMonths, startOfMonth,
} from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { brandHex } from '@/lib/brand';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Analytics {
  total_leads:          number;
  leads_this_month:     number;
  leads_last_month:     number;
  growth_pct:           number;
  range_leads:          number;
  range:                string;
  range_label:          string;
  converted_leads:      number;
  conversion_rate:      number;
  stale_leads:          number;
  overdue_followups:    number;
  leads_not_contacted:  number;
  best_source:          { source: string; count: number } | null;
  source_breakdown:     Array<{ source: string; count: number }>;
  source_conversion:    Array<{ source: string; total: number; won: number; pct_of_total: number; conv_pct: number }>;
  pipeline_funnels:     Array<{ id: string; name: string; stages: Array<{ stage: string; count: number; is_won: boolean }> }>;
  staff_leaderboard:    Array<{ id: string; name: string; assigned_count: number; converted: number; new_in_range: number; conversion_rate_pct: number }>;
  staff_accountability: Array<{ id: string; name: string; assigned: number; contacted: number; won: number; contacted_pct: number; conv_pct: number }>;
  today_followups:      Array<{ id: string; lead_name: string; due_at: string; title: string; description: string; lead_id: string }>;
  stale_leads_list:     Array<{ id: string; name: string; source: string; stage: string; assigned_name: string; updated_at: string; days_stale: number }>;
  untouched_leads:      Array<{ id: string; name: string; source: string; stage: string; assigned_name: string; created_at: string; hours_waiting: number }>;
  calls_total:          number;
  calls_answered:       number;
  calls_missed:         number;
  role:                 string;
}

function sourceLabel(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  if (raw === 'meta_form')                       return 'Meta Forms';
  if (raw === 'whatsapp' || raw === 'WhatsApp')  return 'WhatsApp';
  if (raw === 'calendar_booking')                return 'Calendar Booking';
  if (raw.startsWith('calendar:'))               return raw.slice(9);
  if (raw.startsWith('form:'))                   return raw.slice(5);
  return raw;
}

const FILTER_PRESETS = [
  { value: 'yesterday',    label: 'Yesterday'    },
  { value: 'today',        label: 'Today'        },
  { value: 'this_week',    label: 'This Week'    },
  { value: 'this_month',   label: 'This Month'   },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'custom',       label: 'Custom'       },
];

// ── Compact horizontal Stat Card ──────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, accent = false, warn = false, danger = false, smallValue = false, onClick }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: boolean; warn?: boolean; danger?: boolean;
  smallValue?: boolean; onClick?: () => void;
}) {
  const clickClass = onClick ? 'cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-150' : '';

  if (accent) return (
    <div
      onClick={onClick}
      className={`rounded-xl px-4 py-3 flex items-center gap-3 text-white ${clickClass}`}
      style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 20px rgba(234,88,12,0.25)' }}
    >
      <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] opacity-75 truncate">{label}</p>
        <h3 className={`font-headline font-bold leading-tight tracking-tight ${smallValue ? 'text-[14px] truncate' : 'text-[22px]'}`}>{value}</h3>
        {sub && <p className="text-[10px] opacity-65 truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  );

  if (danger) return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl px-4 py-3 flex items-center gap-3 card-shadow border border-red-200 ${clickClass}`}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-red-50">
        <Icon className="w-4 h-4 text-red-500" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-red-400 truncate">{label}</p>
        <h3 className={`font-headline font-bold text-red-600 leading-tight tracking-tight ${smallValue ? 'text-[14px] truncate' : 'text-[22px]'}`}>{value}</h3>
        {sub && <p className="text-[10px] text-red-400 truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  );

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl px-4 py-3 flex items-center gap-3 card-shadow border ${warn ? 'border-amber-200' : 'border-black/5'} ${clickClass}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${warn ? 'bg-amber-50' : 'bg-primary/10'}`}>
        <Icon className={`w-4 h-4 ${warn ? 'text-amber-500' : 'text-primary'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-[#7a6b5c] truncate">{label}</p>
        <h3 className={`font-headline font-bold text-[#1c1410] leading-tight tracking-tight ${smallValue ? 'text-[14px] truncate' : 'text-[22px]'}`}>{value}</h3>
        {sub && <p className="text-[10px] text-[#9a8a7a] truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const PIE_COLORS = ['#ea580c', '#3b82f6', '#10b981', '#7c3aed', '#f59e0b', '#ec4899', '#0ea5e9', '#14b8a6'];

// ── Date Filter Bar ───────────────────────────────────────────────────────────
function DateFilterBar({ range, setRange, customFrom, setCustomFrom, customTo, setCustomTo }: {
  range: string; setRange: (r: string) => void;
  customFrom: string; setCustomFrom: (v: string) => void;
  customTo: string;   setCustomTo:   (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FILTER_PRESETS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setRange(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors border ${
            range === opt.value
              ? 'bg-primary text-white border-primary shadow-sm'
              : 'bg-white text-[#1c1410] border-black/10 hover:border-primary/40'
          }`}
        >
          {opt.label}
        </button>
      ))}
      {range === 'custom' && (
        <div className="flex items-center gap-1.5 ml-1">
          <input
            type="date"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="text-[12px] border border-black/10 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 bg-white cursor-pointer"
          />
          <span className="text-[11px] text-[#7a6b5c] font-medium">to</span>
          <input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => setCustomTo(e.target.value)}
            className="text-[12px] border border-black/10 rounded-lg px-2 py-1.5 outline-none focus:border-primary/40 bg-white cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}

// ── Pipeline funnel with drop-off indicators ──────────────────────────────────
function PipelineFunnelVisual({ funnels }: { funnels: Analytics['pipeline_funnels'] }) {
  const [selectedId, setSelectedId] = useState('');
  const list = funnels ?? [];
  const pipeline = list.find((f) => f.id === selectedId) ?? list[0] ?? null;
  if (!pipeline) return <p className="text-[12px] text-[#b09e8d]">No pipeline data.</p>;

  const first = pipeline.stages[0]?.count ?? 1;

  return (
    <div>
      {list.length > 1 && (
        <div className="flex gap-1 mb-3 flex-wrap">
          {list.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                pipeline.id === p.id ? 'bg-primary text-white' : 'bg-[var(--app-bg)] text-[#7a6b5c] hover:bg-primary/10'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {pipeline.stages.map((stage, i) => {
          const barPct  = first === 0 ? 0 : Math.max((stage.count / first) * 100, stage.count > 0 ? 4 : 0);
          const ofFirst = first === 0 ? 0 : Math.round((stage.count / first) * 100);
          const prev    = pipeline.stages[i - 1];
          const dropped = prev ? prev.count - stage.count : 0;
          const dropPct = prev && prev.count > 0 ? Math.round((dropped / prev.count) * 100) : 0;
          return (
            <div key={i}>
              {i > 0 && (
                <div className="ml-[84px] py-0.5">
                  {dropped > 0
                    ? <span className="text-[9px] font-semibold text-red-400">↓ {dropped} left ({dropPct}% drop-off)</span>
                    : <span className="text-[9px] text-[#c0b0a0]">↓</span>}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#7a6b5c] font-medium w-20 shrink-0 text-right truncate">{stage.stage}</span>
                <div className="flex-1 h-7 bg-[#f0ece8] rounded-lg overflow-hidden">
                  <div
                    className={`h-full rounded-lg flex items-center justify-end pr-2 ${stage.is_won ? 'bg-emerald-500' : 'bg-primary'}`}
                    style={{ width: `${barPct}%`, minWidth: stage.count > 0 ? '2rem' : '0' }}
                  >
                    {stage.count > 0 && <span className="text-white text-[11px] font-bold">{stage.count}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-[#9a8a7a] w-8 shrink-0 text-right">{ofFirst}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Management Dashboard — Owner / Super Admin — aggregate only, NO individual lead names ──
function ManagementDashboard({ analytics, lineData }: {
  analytics: Analytics; lineData: any[];
}) {
  const superfoneEnabled = useCompanyStore((s) => s.superfoneEnabled);
  const accountability = analytics.staff_accountability ?? [];
  const totalAssigned  = accountability.reduce((s, a) => s + a.assigned, 0);
  const totalContacted = accountability.reduce((s, a) => s + a.contacted, 0);
  const teamContactRate = totalAssigned > 0 ? Math.round((totalContacted / totalAssigned) * 100) : 0;

  const srcConv     = analytics.source_conversion ?? [];
  const grandTotal  = srcConv.reduce((s, x) => s + x.total, 0);
  const bestConvSrc = [...srcConv].filter((s) => s.total >= 3).sort((a, b) => b.conv_pct - a.conv_pct)[0] ?? null;
  const srcData     = srcConv.slice(0, 8).map((s) => ({
    name: sourceLabel(s.source).slice(0, 11), fullName: sourceLabel(s.source),
    total: s.total, conv: s.conv_pct, pct: s.pct_of_total,
  }));

  const growth    = analytics.growth_pct;
  const growthBadge = growth > 0
    ? <span className="text-[12px] font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700">↑ +{growth}% vs last month</span>
    : growth < 0
    ? <span className="text-[12px] font-bold px-2.5 py-1 rounded-lg bg-red-50 text-red-600">↓ {Math.abs(growth)}% vs last month</span>
    : <span className="text-[12px] font-bold px-2.5 py-1 rounded-lg bg-[var(--app-bg)] text-[#7a6b5c]">→ Same as last month</span>;

  return (
    <div className="space-y-5">

      {/* ── 1. Business Health KPIs — all aggregate, zero individual lead names ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="New Leads" value={analytics.range_leads ?? 0}
          sub={`${analytics.range_label} · ${analytics.total_leads} total all-time`}
          icon={Users} accent
        />
        <StatCard
          label="Team Contact Rate" value={`${teamContactRate}%`}
          sub={totalAssigned > 0 ? `${totalContacted} of ${totalAssigned} leads contacted` : 'No leads assigned yet'}
          icon={PhoneOff}
          danger={teamContactRate < 50 && totalAssigned > 0}
          warn={teamContactRate >= 50 && teamContactRate < 75 && totalAssigned > 0}
        />
        <StatCard
          label="Conversion Rate" value={`${analytics.conversion_rate}%`}
          sub={`${analytics.converted_leads} deals closed`}
          icon={Target}
        />
        <StatCard
          label="Best ROI Source"
          value={bestConvSrc ? sourceLabel(bestConvSrc.source) : analytics.best_source ? sourceLabel(analytics.best_source.source) : 'N/A'}
          sub={bestConvSrc ? `${bestConvSrc.conv_pct}% conv · ${bestConvSrc.total} leads` : analytics.best_source ? `${analytics.best_source.count} leads` : 'No data yet'}
          icon={Star}
          smallValue
        />
        {superfoneEnabled && (
          <StatCard
            label="Calls"
            value={analytics.calls_total ?? 0}
            sub={`${analytics.calls_answered ?? 0} answered · ${analytics.calls_missed ?? 0} missed`}
            icon={Phone}
          />
        )}
      </div>

      {/* ── 2. Business Growth Trend (full width) ────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Business Growth</h3>
            <p className="text-[11px] text-[#7a6b5c]">
              {analytics.range_label} ·{' '}
              <span className="font-bold text-[#1c1410]">{analytics.range_leads ?? 0}</span> new leads ·{' '}
              <span className="font-bold text-[#1c1410]">{analytics.total_leads}</span> total all-time
            </p>
          </div>
          {growthBadge}
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={lineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(lineData.length / 6))} />
            <YAxis tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
            <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }} />
            <Line type="monotone" dataKey="leads" stroke={brandHex()} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── 3. Pipeline Funnel + Source Intelligence ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="mb-3">
            <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Pipeline Funnel</h3>
            <p className="text-[11px] text-[#7a6b5c]">Where leads are — and where they drop off</p>
          </div>
          <PipelineFunnelVisual funnels={analytics.pipeline_funnels} />
        </div>

        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="mb-3">
            <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Source Intelligence</h3>
            <p className="text-[11px] text-[#7a6b5c]">{grandTotal} leads total · volume & conversion by channel</p>
          </div>
          {srcConv.length === 0
            ? <p className="text-[12px] text-[#b09e8d]">No leads in this period.</p>
            : (
              <div className="space-y-2.5">
                {srcConv.slice(0, 6).map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-[11px] font-semibold text-[#1c1410] w-28 shrink-0 truncate">{sourceLabel(s.source)}</span>
                    <div className="flex-1 h-2 bg-[#f0ece8] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${s.pct_of_total}%`, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    </div>
                    <span className="text-[11px] font-bold text-[#1c1410] w-7 text-right shrink-0">{s.total}</span>
                    <span className="text-[10px] text-[#9a8a7a] w-9 text-right shrink-0">({s.pct_of_total}%)</span>
                    {s.conv_pct > 0
                      ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md shrink-0 w-14 text-center">{s.conv_pct}% conv</span>
                      : <span className="w-14 shrink-0" />}
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>

      {/* ── 4. Source ROI — Volume vs Conversion Rate ─────────────────────────── */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
        <div className="mb-3">
          <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Source ROI — Volume vs Conversion Rate</h3>
          <p className="text-[11px] text-[#7a6b5c]">Bars = lead count · Line = conversion % — identify your highest-return channels</p>
        </div>
        {srcData.length === 0
          ? <p className="text-[12px] text-[#b09e8d]">No leads in this period.</p>
          : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={srcData} margin={{ top: 18, right: 36, bottom: 4, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#8a7c6e' }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#10b981' }} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" width={30} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }}
                  formatter={(val: any, name: string, p: any) =>
                    name === 'conv'
                      ? [`${val}%`, 'Conversion Rate']
                      : [`${val} leads (${p.payload.pct}% of total)`, 'Volume']
                  }
                  labelFormatter={(_: any, p: any) => p?.[0]?.payload?.fullName ?? _}
                />
                <Bar yAxisId="left" dataKey="total" fill={brandHex()} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: '#1c1410', fontWeight: 700 }} />
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="conv" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
      </div>

      {/* ── 5. Team Health — aggregate bars, no individual lead lists ────────────── */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Team Health</h3>
            <p className="text-[11px] text-[#7a6b5c]">
              Team contact rate:{' '}
              <span className={`font-bold ${teamContactRate >= 70 ? 'text-emerald-600' : teamContactRate >= 50 ? 'text-amber-500' : 'text-red-500'}`}>{teamContactRate}%</span>
              {' '}· {totalContacted} of {totalAssigned} leads contacted across all staff
            </p>
          </div>
          <span className={`text-[12px] font-bold px-3 py-1 rounded-full ${teamContactRate >= 70 ? 'bg-emerald-50 text-emerald-700' : teamContactRate >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
            {teamContactRate >= 70 ? 'Healthy' : teamContactRate >= 50 ? 'At Risk' : 'Action Needed'}
          </span>
        </div>
        {accountability.length === 0
          ? <p className="text-[12px] text-[#b09e8d]">No staff yet.</p>
          : (
            <div className="space-y-3">
              {accountability.map((s) => {
                const barColor  = s.contacted_pct >= 70 ? '#10b981' : s.contacted_pct >= 40 ? '#f59e0b' : '#ef4444';
                const textColor = s.contacted_pct >= 70 ? 'text-emerald-600' : s.contacted_pct >= 40 ? 'text-amber-500' : 'text-red-500';
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                      {s.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-[12px] font-semibold text-[#1c1410] w-32 shrink-0 truncate">{s.name}</span>
                    <div className="flex-1 h-2 bg-[#f0ece8] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${s.contacted_pct}%`, background: barColor }} />
                    </div>
                    <span className={`text-[12px] font-bold w-10 text-right shrink-0 ${textColor}`}>{s.contacted_pct}%</span>
                    <span className="text-[10px] text-[#9a8a7a] w-24 text-right shrink-0 whitespace-nowrap">{s.contacted}/{s.assigned} · {s.won} won</span>
                  </div>
                );
              })}
            </div>
          )}
      </div>

    </div>
  );
}

// ── Sales Manager Dashboard — operational team oversight, staff+lead names OK ─
function ManagerDashboard({ analytics, lineData }: { analytics: Analytics; lineData: any[] }) {
  const superfoneEnabled = useCompanyStore((s) => s.superfoneEnabled);
  const navigate   = useNavigate();
  const rangeLabel = analytics.range_label ?? 'This Period';
  const accountability = analytics.staff_accountability ?? [];

  const untouchedByStaff = accountability
    .map((s) => ({ name: s.name.split(' ')[0], untouched: s.assigned - s.contacted, assigned: s.assigned }))
    .filter((s) => s.untouched > 0)
    .sort((a, b) => b.untouched - a.untouched);

  return (
    <div className="space-y-4">
      {/* ── 1. Operational KPIs ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Overdue Follow-ups" value={analytics.overdue_followups}
          sub={analytics.overdue_followups > 0 ? 'Team needs to act now' : 'All caught up ✓'}
          icon={Clock} danger={analytics.overdue_followups > 0}
          onClick={() => navigate('/lead-management/followups')}
        />
        <StatCard
          label="Not Yet Contacted" value={analytics.leads_not_contacted ?? 0}
          sub={(analytics.leads_not_contacted ?? 0) > 0 ? 'Leads with zero touchpoint' : 'All leads contacted ✓'}
          icon={PhoneOff} danger={(analytics.leads_not_contacted ?? 0) > 0}
        />
        <StatCard
          label="Stale Leads" value={analytics.stale_leads}
          sub="No activity in 7+ days" icon={AlertTriangle}
          warn={analytics.stale_leads > 0}
          onClick={() => navigate('/leads?filter=stale')}
        />
        <StatCard
          label="New Leads" value={analytics.range_leads ?? 0}
          sub={`${rangeLabel} · ${analytics.conversion_rate}% conv rate`}
          icon={Users} accent
          onClick={() => navigate('/leads')}
        />
        {superfoneEnabled && (
          <StatCard
            label="Calls"
            value={analytics.calls_total ?? 0}
            sub={`${analytics.calls_answered ?? 0} answered · ${analytics.calls_missed ?? 0} missed`}
            icon={Phone}
            onClick={() => navigate('/calls')}
          />
        )}
      </div>

      {/* ── 2. Staff Performance + Untouched by Staff ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="mb-4">
            <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Staff Performance</h3>
            <p className="text-[11px] text-[#7a6b5c]">Assigned · Contacted · Won — all time</p>
          </div>
          {accountability.length === 0
            ? <p className="text-[12px] text-[#b09e8d]">No staff yet.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[10px] text-[#b09e8d] font-semibold uppercase border-b border-black/5">
                      <th className="text-left py-2 px-1">Staff</th>
                      <th className="text-right py-2 px-1">Assigned</th>
                      <th className="text-right py-2 px-1 whitespace-nowrap">Contacted</th>
                      <th className="text-right py-2 px-1">Won</th>
                      <th className="py-2 px-1 w-20">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountability.map((s) => {
                      const barColor  = s.contacted_pct >= 70 ? '#10b981' : s.contacted_pct >= 40 ? '#f59e0b' : '#ef4444';
                      const textColor = s.contacted_pct >= 70 ? 'text-emerald-600' : s.contacted_pct >= 40 ? 'text-amber-500' : 'text-red-500';
                      return (
                        <tr key={s.id} className="border-b border-black/[0.03] hover:bg-[var(--app-bg)] transition-colors">
                          <td className="py-2 px-1">
                            <div className="flex items-center gap-1.5">
                              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                                {s.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                              <span className="font-semibold text-[#1c1410] truncate">{s.name}</span>
                            </div>
                          </td>
                          <td className="text-right px-1 font-bold text-[#1c1410]">{s.assigned}</td>
                          <td className={`text-right px-1 font-bold ${textColor}`}>
                            {s.contacted}/{s.assigned}
                            <span className="text-[10px] ml-0.5 font-normal">({s.contacted_pct}%)</span>
                          </td>
                          <td className="text-right px-1 font-bold text-emerald-600">{s.won}</td>
                          <td className="px-1">
                            <div className="h-1.5 bg-[#f0ece8] rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${s.contacted_pct}%`, background: barColor }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="mb-4">
            <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Untouched Leads — by Staff</h3>
            <p className="text-[11px] text-[#7a6b5c]">Assigned but never contacted — who needs to act?</p>
          </div>
          {untouchedByStaff.length === 0
            ? <p className="text-[12px] text-emerald-600 font-medium">All leads contacted by their assigned staff ✓</p>
            : (
              <div className="space-y-2.5">
                {untouchedByStaff.map((s, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="text-[12px] font-semibold text-[#1c1410] w-24 shrink-0 truncate">{s.name}</span>
                    <div className="flex-1 h-7 bg-[#f0ece8] rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-red-400 rounded-lg flex items-center justify-end pr-2"
                        style={{ width: s.assigned > 0 ? `${Math.max((s.untouched / s.assigned) * 100, 10)}%` : '0%', minWidth: '2.5rem' }}
                      >
                        <span className="text-white text-[11px] font-bold">{s.untouched}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-[#9a8a7a] w-16 text-right shrink-0 whitespace-nowrap">of {s.assigned}</span>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>

      {/* ── 3. Pipeline Health + Today's Follow-ups ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="mb-3">
            <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Pipeline Health</h3>
            <p className="text-[11px] text-[#7a6b5c]">Stage distribution with drop-off</p>
          </div>
          <PipelineFunnelVisual funnels={analytics.pipeline_funnels} />
        </div>

        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Team's Follow-ups Today</h3>
              <p className="text-[11px] text-[#7a6b5c]">
                <span className="font-bold text-[#1c1410]">{analytics.today_followups.length}</span> due ·{' '}
                <span className="font-bold text-red-500">{analytics.overdue_followups}</span> overdue
              </p>
            </div>
            <button onClick={() => navigate('/lead-management/followups')} className="text-[11px] text-primary font-semibold hover:opacity-70">View all →</button>
          </div>
          {analytics.today_followups.length === 0
            ? <p className="text-[12px] text-[#b09e8d]">No follow-ups due today.</p>
            : (
              <div className="space-y-1 overflow-y-auto" style={{ maxHeight: 220 }}>
                {analytics.today_followups.map((f) => {
                  const overdue = isPast(new Date(f.due_at)) && !isToday(new Date(f.due_at));
                  return (
                    <div
                      key={f.id}
                      onClick={() => navigate(`/leads?lead=${f.lead_id}`)}
                      className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--app-bg)] cursor-pointer transition-colors"
                    >
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${overdue ? 'bg-red-400' : 'bg-emerald-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-[#1c1410] truncate">{f.lead_name}</p>
                        <p className="text-[10px] text-[#8a7c6e] truncate">{f.title}</p>
                      </div>
                      <span className={`text-[10px] shrink-0 font-medium whitespace-nowrap ${overdue ? 'text-red-500' : 'text-[#8a7c6e]'}`}>
                        {formatDistanceToNow(new Date(f.due_at), { addSuffix: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </div>

      {/* ── 4. Lead Inflow Trend ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">Lead Inflow</h3>
            <p className="text-[11px] text-[#7a6b5c]">{rangeLabel}</p>
          </div>
          <span className="text-[13px] font-bold text-[#1c1410]">{analytics.range_leads ?? 0} leads</span>
        </div>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={lineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(lineData.length / 6))} />
            <YAxis tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
            <Tooltip contentStyle={{ borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }} />
            <Line type="monotone" dataKey="leads" stroke={brandHex()} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Staff Dashboard — personal task view, individual lead names appropriate ────
function StaffDashboard({ analytics }: { analytics: Analytics }) {
  const navigate = useNavigate();
  const superfoneEnabled = useCompanyStore((s) => s.superfoneEnabled);
  const todayDue = analytics.today_followups.filter((f) => isToday(new Date(f.due_at)));

  return (
    <div className="space-y-4">
      {/* ── Personal KPIs ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Follow-ups Today" value={todayDue.length}
          sub={todayDue.length === 0 ? 'All clear for today' : `${analytics.overdue_followups} overdue`}
          icon={CheckCircle} accent
          onClick={() => navigate('/lead-management/followups')}
        />
        <StatCard
          label="Overdue" value={analytics.overdue_followups}
          sub="Need your attention now" icon={Clock}
          danger={analytics.overdue_followups > 0}
          onClick={() => navigate('/lead-management/followups')}
        />
        <StatCard
          label="My Leads" value={analytics.total_leads}
          sub={`${analytics.range_leads ?? 0} in ${analytics.range_label ?? 'this period'}`}
          icon={Users}
          onClick={() => navigate('/leads')}
        />
        <StatCard
          label="Converted" value={analytics.converted_leads}
          sub={`${analytics.conversion_rate}% conversion rate`}
          icon={Target}
          onClick={() => navigate('/leads?filter=converted')}
        />
        {superfoneEnabled && (
          <StatCard
            label="My Calls"
            value={analytics.calls_total ?? 0}
            sub={`${analytics.calls_answered ?? 0} answered · ${analytics.calls_missed ?? 0} missed`}
            icon={Phone}
            onClick={() => navigate('/calls')}
          />
        )}
      </div>

      {/* ── Today's tasks + My Numbers ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-headline font-bold text-[#1c1410] text-[14px]">My Follow-ups</h3>
              <p className="text-[11px] text-[#7a6b5c]">Today's action list — your personal tasks</p>
            </div>
            <button onClick={() => navigate('/lead-management/followups')} className="text-[11px] text-primary font-semibold hover:opacity-80 transition-opacity">
              View all →
            </button>
          </div>
          {analytics.today_followups.length === 0
            ? <p className="text-[12px] text-[#b09e8d]">No follow-ups due today. All clear!</p>
            : (
              <div className="space-y-1">
                {analytics.today_followups.map((f) => {
                  const isOverdue = isPast(new Date(f.due_at)) && !isToday(new Date(f.due_at));
                  return (
                    <div
                      key={f.id}
                      onClick={() => navigate(`/leads?lead=${f.lead_id}`)}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--app-bg)] cursor-pointer transition-colors"
                    >
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOverdue ? 'bg-red-400' : 'bg-emerald-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-[#1c1410] truncate">{f.lead_name}</p>
                        <p className="text-[10px] text-[#8a7c6e] truncate">{f.title}{f.description ? ` · ${f.description}` : ''}</p>
                      </div>
                      <span className={`text-[10px] shrink-0 font-medium ${isOverdue ? 'text-red-500' : 'text-[#8a7c6e]'}`}>
                        {formatDistanceToNow(new Date(f.due_at), { addSuffix: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <h3 className="font-headline font-bold text-[#1c1410] text-[14px] mb-3">My Numbers</h3>
          <div className="grid grid-cols-1 gap-2.5">
            <div className="rounded-xl bg-[var(--app-bg)] px-4 py-3">
              <p className="text-[11px] text-[#7a6b5c] mb-0.5">Total Leads</p>
              <p className="font-headline text-[22px] font-bold text-[#1c1410]">{analytics.total_leads}</p>
            </div>
            <div className="rounded-xl bg-[var(--app-bg)] px-4 py-3">
              <p className="text-[11px] text-[#7a6b5c] mb-0.5">{analytics.range_label ?? 'This Period'}</p>
              <p className="font-headline text-[22px] font-bold text-[#1c1410]">{analytics.range_leads ?? 0}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 px-4 py-3">
              <p className="text-[11px] text-emerald-600 mb-0.5">Converted</p>
              <p className="font-headline text-[22px] font-bold text-emerald-700">{analytics.converted_leads}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard Page ───────────────────────────────────────────────────────
export default function DashboardPage() {
  const { leads }     = useCrmStore();
  const level          = useUserLevel();

  const [analytics,  setAnalytics]  = useState<Analytics | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [range,      setRange]      = useState('this_week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');

  const apiUrl = useMemo(() => {
    if (range === 'custom' && customFrom && customTo) {
      return `/api/dashboard/analytics?range=custom&from=${customFrom}&to=${customTo}`;
    }
    return `/api/dashboard/analytics?range=${range}`;
  }, [range, customFrom, customTo]);

  useEffect(() => {
    if (range === 'custom' && (!customFrom || !customTo)) return;
    setLoading(true);
    api.get<Analytics>(apiUrl)
      .then((r) => setAnalytics(r))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const lineData = useMemo(() => {
    const today = startOfDay(new Date());

    if (range === 'today') {
      return Array.from({ length: 24 }, (_, h) => {
        const count = leads.filter((l) => {
          const d = new Date(l.createdAt);
          return isToday(d) && d.getHours() === h;
        }).length;
        return { day: `${h}:00`, leads: count };
      });
    }

    if (range === 'yesterday') {
      const yesterday = subDays(today, 1);
      return Array.from({ length: 24 }, (_, h) => {
        const count = leads.filter((l) => {
          const d = new Date(l.createdAt);
          return format(d, 'yyyy-MM-dd') === format(yesterday, 'yyyy-MM-dd') && d.getHours() === h;
        }).length;
        return { day: `${h}:00`, leads: count };
      });
    }

    if (range === 'this_week') {
      const now = new Date();
      const dow  = now.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      const weekStart = startOfDay(addDays(today, diff));
      return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const dayStr = format(d, 'yyyy-MM-dd');
        const count = d > now ? 0 : leads.filter((l) => format(startOfDay(new Date(l.createdAt)), 'yyyy-MM-dd') === dayStr).length;
        return { day: format(d, 'EEE'), leads: count };
      });
    }

    if (range === 'this_month') {
      const dim = getDaysInMonth(today);
      return Array.from({ length: dim }, (_, i) => {
        const day    = new Date(today.getFullYear(), today.getMonth(), i + 1);
        const dayStr = format(day, 'yyyy-MM-dd');
        const count  = leads.filter((l) => format(startOfDay(new Date(l.createdAt)), 'yyyy-MM-dd') === dayStr).length;
        return { day: String(i + 1), leads: count };
      });
    }

    if (range === 'custom' && customFrom && customTo) {
      const fromDate  = startOfDay(new Date(customFrom));
      const toDate    = startOfDay(new Date(customTo));
      const diffDays  = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
      const numPoints = Math.min(diffDays, 60);
      return Array.from({ length: numPoints }, (_, i) => {
        const d      = addDays(fromDate, i);
        const dayStr = format(d, 'yyyy-MM-dd');
        const count  = leads.filter((l) => format(startOfDay(new Date(l.createdAt)), 'yyyy-MM-dd') === dayStr).length;
        return { day: diffDays > 20 ? format(d, 'MMM d') : format(d, 'M/d'), leads: count };
      });
    }

    if (range === 'this_quarter') {
      const quarter      = Math.floor(today.getMonth() / 3);
      const quarterStart = startOfDay(new Date(today.getFullYear(), quarter * 3, 1));
      const daysSince    = Math.ceil((today.getTime() - quarterStart.getTime()) / 86400000);
      const numWeeks     = Math.max(1, Math.ceil(daysSince / 7));
      return Array.from({ length: numWeeks }, (_, i) => {
        const weekStart = addDays(quarterStart, i * 7);
        const weekEnd   = addDays(weekStart, 6);
        const count     = leads.filter((l) => {
          const d = startOfDay(new Date(l.createdAt));
          return d >= weekStart && d <= (weekEnd > today ? today : weekEnd);
        }).length;
        return { day: format(weekStart, 'MMM d'), leads: count };
      });
    }

    if (range === '90d') {
      return Array.from({ length: 13 }, (_, i) => {
        const weekStart = subDays(today, (12 - i) * 7);
        const weekEnd   = addDays(weekStart, 6);
        const count = leads.filter((l) => {
          const d = startOfDay(new Date(l.createdAt));
          return d >= weekStart && d <= weekEnd;
        }).length;
        return { day: format(weekStart, 'MMM d'), leads: count };
      });
    }

    if (range === 'all') {
      return Array.from({ length: 12 }, (_, i) => {
        const month    = startOfMonth(subMonths(today, 11 - i));
        const monthStr = format(month, 'yyyy-MM');
        const count    = leads.filter((l) => format(new Date(l.createdAt), 'yyyy-MM') === monthStr).length;
        return { day: format(month, 'MMM'), leads: count };
      });
    }

    return Array.from({ length: 30 }, (_, i) => {
      const day    = subDays(today, 29 - i);
      const dayStr = format(day, 'yyyy-MM-dd');
      const count  = leads.filter((l) => format(startOfDay(new Date(l.createdAt)), 'yyyy-MM-dd') === dayStr).length;
      return { day: format(day, 'd'), leads: count };
    });
  }, [leads, range, customFrom, customTo]);

  // owner → strategic view; manager (staff:manage) → operational view; staff → personal view

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="font-headline text-[22px] font-extrabold tracking-tight text-[#1c1410] shrink-0">Dashboard</h2>
        <DateFilterBar
          range={range} setRange={setRange}
          customFrom={customFrom} setCustomFrom={setCustomFrom}
          customTo={customTo}     setCustomTo={setCustomTo}
        />
      </div>

      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl px-4 py-3 card-shadow border border-black/5 h-16 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && analytics && (
        <>
          {level === 'owner'   && <ManagementDashboard analytics={analytics} lineData={lineData} />}
          {level === 'manager' && <ManagerDashboard    analytics={analytics} lineData={lineData} />}
          {level === 'staff'   && <StaffDashboard      analytics={analytics} />}
        </>
      )}

      {!loading && !analytics && (
        <div className="text-center py-20 text-[#b09e8d] text-[14px]">Could not load dashboard data.</div>
      )}
    </div>
  );
}
