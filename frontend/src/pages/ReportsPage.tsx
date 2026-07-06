import { useState, useEffect, useRef } from 'react';
import {
  TrendingUp, CheckCircle2, Check, Target, Clock, Users, RefreshCw,
  ChevronDown, CalendarClock,
} from 'lucide-react';
import {
  ComposedChart, Bar, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Line, LabelList, BarChart,
} from 'recharts';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useUserLevel } from '@/hooks/useUserLevel';
import { brandHex } from '@/lib/brand';

// ── Types ─────────────────────────────────────────────────────────────────────
interface KpiShape {
  total_leads: number; won: number; active: number;
  conv_pct: number; avg_days_to_close: number;
}
interface StageRow    { stage_name: string; stage_order: number; is_won: boolean; lead_count: number; avg_days: number; }
interface SourceRow   { source: string; total: number; contacted: number; won: number; conv_pct: number; }
interface WinLossRow  { month: string; new_leads: number; won: number; }
interface StaffRow    { id: string; name: string; assigned: number; contacted: number; won: number; followups: number; conv_pct: number; contact_pct: number; }
interface OverdueRow  { lead_name: string; lead_id?: string; staff_name?: string; title?: string; due_at: string; overdue_days: number; }
interface FuSummary   { total: number; completed: number; pending: number; overdue: number; overdue_list: OverdueRow[]; }
interface StaleShape  { stale_count: number; max_days: number; list: { id: string; name: string; stage_name: string; assigned_name: string; days_stale: number }[]; }

interface PipelineData {
  kpi:       KpiShape;
  stages:    StageRow[];
  sources:   SourceRow[];
  lead_flow: { day: string; count: number }[];
  win_loss:  WinLossRow[];
  quality:   { quality: string; count: number }[];
  staff:     StaffRow[];
  followups: FuSummary;
  stale:     StaleShape;
  automation: { id: string; name: string; total: number; completed: number; failed: number; leads_enrolled: number }[];
  tags:      { name: string; color: string; total: number; won: number; conv_pct: number }[];
  aging:     { bucket: string; count: number }[];
  calls:     { direction: string; outcome: string; count: number; avg_duration: number; total_duration: number }[];
}

interface StaffData {
  kpi:          KpiShape;
  stages:       StageRow[];
  sources:      { source: string; total: number; won: number; conv_pct: number }[];
  win_loss:     WinLossRow[];
  overdue_list: OverdueRow[];
  followups:    { total: number; completed: number; pending: number; overdue: number };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PERIODS = [
  { value: 'yesterday',    label: 'Yesterday'    },
  { value: 'today',        label: 'Today'        },
  { value: 'this_week',    label: 'This Week'    },
  { value: 'this_month',   label: 'This Month'   },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'all_time',     label: 'All Time'     },
  { value: 'custom',       label: 'Custom'       },
];

const SOURCE_COLORS = ['#ea580c','#6366f1','#3b82f6','#10b981','#f59e0b','#06b6d4','#8b5cf6','#f43f5e'];
const STAGE_COLORS  = ['#6366f1','#3b82f6','#06b6d4','#8b5cf6','#f59e0b','#ea580c','#f43f5e','#84cc16'];

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <RefreshCw className="w-5 h-5 animate-spin text-[var(--brand-dark)]" />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex items-center justify-center h-[120px] text-[14px] text-[#9a8a7a]">{text}</div>;
}

// Period Filter
function PeriodFilter({ period, onChange, from, to, onFrom, onTo }: {
  period: string; onChange: (v: string) => void;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {PERIODS.map((p) => (
          <button key={p.value} onClick={() => onChange(p.value)}
            className={cn(
              'text-[13px] font-semibold px-3.5 py-1.5 rounded-lg border transition-all',
              period === p.value
                ? 'bg-[var(--brand)] text-white border-[var(--brand)] shadow-sm'
                : 'bg-white text-[#7a6b5c] border-black/10 hover:border-primary/40 hover:text-[var(--brand)]',
            )}>
            {p.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={(e) => onFrom(e.target.value)}
            className="border border-black/10 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--brand)] transition-colors bg-white" />
          <span className="text-[13px] text-[#9a8a7a] font-medium">to</span>
          <input type="date" value={to} onChange={(e) => onTo(e.target.value)}
            className="border border-black/10 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--brand)] transition-colors bg-white" />
        </div>
      )}
    </div>
  );
}

// KPI Card
function KpiCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: boolean;
}) {
  const body = (
    <div className="min-w-0 flex-1">
      <p className={cn('text-[11px] truncate', accent ? 'opacity-75 text-white' : 'text-[#7a6b5c]')}>{label}</p>
      <h3 className={cn('font-bold text-[24px] leading-tight tracking-tight', accent ? 'text-white' : 'text-[#1c1410]')}>
        {value}
      </h3>
      {sub && <p className={cn('text-[10px] mt-0.5 truncate', accent ? 'opacity-65 text-white' : 'text-[#9a8a7a]')}>{sub}</p>}
    </div>
  );
  if (accent) return (
    <div className="rounded-xl px-4 py-3.5 flex items-center gap-3"
      style={{ background: 'linear-gradient(135deg,var(--brand-dark) 0%,var(--brand) 55%,var(--brand-light) 100%)', boxShadow: '0 4px 20px rgba(234,88,12,0.25)' }}>
      <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-white" />
      </div>
      {body}
    </div>
  );
  return (
    <div className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3 border border-black/5 shadow-sm">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      {body}
    </div>
  );
}

// Section card
function Card({ title, sub, children, className }: {
  title: string; sub?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden', className)}>
      <div className="px-5 py-4 border-b border-black/5">
        <p className="text-[15px] font-bold text-[#1c1410]">{title}</p>
        {sub && <p className="text-[11px] text-[#9a8a7a] mt-0.5">{sub}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// Trend chart - Bar (new leads, blue) + Area (won, orange)
function TrendChart({ data }: { data: WinLossRow[] }) {
  if (!data.length) return <EmptyState text="No trend data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe5" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9a8a7a' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#9a8a7a' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #f0ebe5', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Bar dataKey="new_leads" name="New Leads" fill="#bfdbfe" radius={[3, 3, 0, 0]} maxBarSize={32} />
        <Area dataKey="won" name="Won" type="monotone" fill="rgba(234,88,12,0.12)" stroke={brandHex()} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// Horizontal bar list (sources, staff, stages)
function HBarList({ items, getLabel, getRight, getWidth, getColor, avatar }: {
  items: any[];
  getLabel:  (item: any) => string;
  getRight?: (item: any) => React.ReactNode;
  getWidth:  (item: any) => number;
  getColor?: (item: any, i: number) => string;
  avatar?:   (item: any) => string;
}) {
  if (!items.length) return <EmptyState text="No data" />;
  return (
    <div className="flex flex-col gap-3.5">
      {items.map((item, i) => {
        const color = getColor ? getColor(item, i) : '#ea580c';
        return (
          <div key={i} className="flex items-center gap-2.5">
            {avatar && (
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ background: `${color}18` }}>
                <span className="text-[10px] font-bold" style={{ color }}>
                  {avatar(item).charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#1c1410] truncate">{getLabel(item)}</p>
              <div className="mt-0.5">
                <div className="h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.max(getWidth(item), 2)}%`, background: color, minWidth: 4 }} />
              </div>
            </div>
            {getRight && <div className="shrink-0 text-right">{getRight(item)}</div>}
          </div>
        );
      })}
    </div>
  );
}

// Stage funnel with drop-off, bottleneck detection, and cumulative conversion
function StageFunnel({ stages }: { stages: StageRow[] }) {
  if (!stages.length) return <EmptyState text="No stage data" />;
  const maxCount = Math.max(...stages.map((s) => s.lead_count), 1);
  const firstCount = stages[0]?.lead_count ?? 0;

  // Find bottleneck (highest % drop between consecutive stages)
  let bottleneckIdx = -1;
  let worstDropPct = 0;
  stages.forEach((stage, i) => {
    if (i === 0) return;
    const prev = stages[i - 1];
    if (prev.lead_count > 0 && !prev.is_won) {
      const dp = Math.round((1 - stage.lead_count / prev.lead_count) * 100);
      if (dp > worstDropPct) { worstDropPct = dp; bottleneckIdx = i; }
    }
  });

  const wonStage = stages.find((s) => s.is_won);
  const overallConv = firstCount > 0 && wonStage ? Math.round((wonStage.lead_count / firstCount) * 100) : 0;
  const totalLeads = stages.reduce((s, st) => s + st.lead_count, 0);
  const slowestStage = [...stages].filter((s) => !s.is_won && s.lead_count > 0).sort((a, b) => (b.avg_days ?? 0) - (a.avg_days ?? 0))[0];

  return (
    <div>
      {/* Summary insights */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f4efe9]">
          <span className="text-[10px] text-[#9a8a7a] font-semibold uppercase">Entry</span>
          <span className="text-[14px] font-bold text-[#1c1410]">{firstCount}</span>
        </div>
        {wonStage && (
          <>
            <span className="text-[#d0c0b0] text-[11px]">→</span>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50">
              <span className="text-[10px] text-emerald-600 font-semibold uppercase">Won</span>
              <span className="text-[14px] font-bold text-emerald-700">{wonStage.lead_count}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
              style={{ background: overallConv >= 15 ? '#f0fdf4' : overallConv >= 5 ? '#fefce8' : '#fef2f2' }}>
              <span className="text-[10px] font-semibold uppercase"
                style={{ color: overallConv >= 15 ? '#16a34a' : overallConv >= 5 ? '#ca8a04' : '#ef4444' }}>Conv Rate</span>
              <span className="text-[14px] font-bold"
                style={{ color: overallConv >= 15 ? '#15803d' : overallConv >= 5 ? '#a16207' : '#dc2626' }}>{overallConv}%</span>
            </div>
          </>
        )}
        {bottleneckIdx >= 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50">
            <span className="text-[10px] text-red-500 font-semibold uppercase">Bottleneck</span>
            <span className="text-[13px] font-bold text-red-600">{stages[bottleneckIdx].stage_name} ({worstDropPct}%)</span>
          </div>
        )}
        {slowestStage && (slowestStage.avg_days ?? 0) > 3 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50">
            <span className="text-[10px] text-amber-600 font-semibold uppercase">Slowest</span>
            <span className="text-[13px] font-bold text-amber-700">{slowestStage.stage_name} ({slowestStage.avg_days}d avg)</span>
          </div>
        )}
      </div>

      {/* Funnel visualization */}
      <div className="flex flex-col gap-2.5">
        {stages.map((stage, i) => {
          const prev = stages[i - 1];
          const dropPct = prev && prev.lead_count > 0
            ? Math.round((1 - stage.lead_count / prev.lead_count) * 100) : null;
          const cumulConv = firstCount > 0 && i > 0 ? Math.round((stage.lead_count / firstCount) * 100) : null;
          const barW = Math.max(Math.round((stage.lead_count / maxCount) * 100), stage.lead_count > 0 ? 3 : 0);
          const color = stage.is_won ? '#10b981' : STAGE_COLORS[i % STAGE_COLORS.length];
          const idle = stage.avg_days ?? 0;
          const [idleBg, idleColor] = idle > 7 ? ['#fef2f2','#ef4444'] : idle > 2 ? ['#fefce8','#ca8a04'] : ['#f0fdf4','#16a34a'];
          const isBottleneck = i === bottleneckIdx;
          return (
            <div key={stage.stage_name}>
              {dropPct !== null && dropPct > 0 && (
                <div className="flex items-center gap-1.5 my-1 pl-1">
                  <div className={`w-px h-3 ${isBottleneck ? 'bg-red-300' : 'bg-[#e5d5c5]'}`} />
                  <span className={`text-[10px] font-medium ${isBottleneck ? 'text-red-500 font-bold' : 'text-[#b0a090]'}`}>
                    ↓ {dropPct}% drop-off{isBottleneck ? ' - bottleneck' : ''}
                  </span>
                </div>
              )}
              <div className={`flex items-center gap-3 ${isBottleneck ? 'ring-1 ring-red-200 rounded-xl px-2 py-1 -mx-2 bg-red-50/30' : ''}`}>
                <span className="text-[11px] font-semibold text-[#4a3a2a] w-[90px] shrink-0 truncate">{stage.stage_name}</span>
                <div className="flex-1 bg-[#f4efe9] rounded-full h-7 overflow-hidden">
                  <div className="h-full rounded-full flex items-center justify-end pr-2.5 transition-all duration-500"
                    style={{ width: `${barW}%`, background: color }}>
                    {barW > 14 && <span className="text-[11px] font-bold text-white">{stage.lead_count}</span>}
                  </div>
                </div>
                {barW <= 14 && <span className="text-[13px] font-bold text-[#1c1410] w-5 text-right">{stage.lead_count}</span>}
                {cumulConv !== null && (
                  <span className="text-[9px] font-semibold text-[#9a8a7a] w-8 text-right shrink-0">{cumulConv}%</span>
                )}
                <span className="text-[10px] font-bold px-2 py-1 rounded-lg shrink-0"
                  style={{ background: stage.is_won ? '#f0fdf4' : idleBg, color: stage.is_won ? '#16a34a' : idleColor }}>
                  {stage.is_won ? <span className="inline-flex items-center gap-0.5">Won <Check className="w-2.5 h-2.5" strokeWidth={3} /></span> : `${idle}d avg`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[#c0b0a0] mt-2 pt-2 border-t border-black/[0.04]">
        % = cumulative conversion from entry · Avg = mean days leads sit in stage · Bottleneck = highest drop-off point
      </p>
    </div>
  );
}

// Lead breakdown bar
function LeadBreakdown({ total, won, active }: { total: number; won: number; active: number }) {
  if (!total) return null;
  const wonPct    = Math.round((won / total) * 100);
  const activePct = Math.round((active / total) * 100);
  const lostPct   = Math.max(100 - wonPct - activePct, 0);
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[14px] font-bold text-[#1c1410]">Lead Breakdown</p>
        <span className="text-[11px] text-[#9a8a7a]">{total} total leads</span>
      </div>
      <div className="flex h-3.5 rounded-full overflow-hidden gap-0.5">
        {wonPct > 0    && <div style={{ width: `${wonPct}%`,    background: '#10b981' }} className="transition-all duration-700" />}
        {activePct > 0 && <div style={{ width: `${activePct}%`, background: '#6366f1' }} className="transition-all duration-700" />}
        {lostPct > 0   && <div style={{ width: `${lostPct}%`,   background: '#f4efe9' }} className="transition-all duration-700" />}
      </div>
      <div className="flex items-center gap-4 mt-2.5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#10b981]" />
          <span className="text-[11px] text-[#9a8a7a]">Won {wonPct}% ({won})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#6366f1]" />
          <span className="text-[11px] text-[#9a8a7a]">Active {activePct}% ({active})</span>
        </div>
        {lostPct > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#e5d5c5]" />
            <span className="text-[11px] text-[#9a8a7a]">Other {lostPct}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Source ROI Chart - volume bars + conversion line + contact rate + detail table
function SourceROIChart({ sources }: { sources: SourceRow[] }) {
  if (!sources.length) return <EmptyState text="No source data" />;

  const chartData = sources.slice(0, 8).map((s) => ({
    name: (s.source || 'Unknown').slice(0, 14),
    fullName: s.source || 'Unknown',
    total: s.total, contacted: s.contacted, won: s.won,
    conv: s.conv_pct,
    contactRate: s.total > 0 ? Math.round((s.contacted / s.total) * 100) : 0,
  }));

  const bestConv = [...sources].filter((s) => s.total >= 3).sort((a, b) => b.conv_pct - a.conv_pct)[0];
  const highestVol = sources[0];
  const bestContact = [...sources].filter((s) => s.total >= 3).sort((a, b) => {
    return (b.total > 0 ? b.contacted / b.total : 0) - (a.total > 0 ? a.contacted / a.total : 0);
  })[0];

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {highestVol && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50">
            <span className="text-[10px] text-blue-500 font-semibold uppercase">Top Volume</span>
            <span className="text-[13px] font-bold text-blue-700">{highestVol.source || 'Unknown'} ({highestVol.total})</span>
          </div>
        )}
        {bestConv && bestConv.conv_pct > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50">
            <span className="text-[10px] text-emerald-500 font-semibold uppercase">Best Conversion</span>
            <span className="text-[13px] font-bold text-emerald-700">{bestConv.source || 'Unknown'} ({bestConv.conv_pct}%)</span>
          </div>
        )}
        {bestContact && bestContact.contacted > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50">
            <span className="text-[10px] text-violet-500 font-semibold uppercase">Best Contact Rate</span>
            <span className="text-[13px] font-bold text-violet-700">{bestContact.source || 'Unknown'} ({bestContact.total > 0 ? Math.round(bestContact.contacted / bestContact.total * 100) : 0}%)</span>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 18, right: 40, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe5" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8a7c6e' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#8a7c6e' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#10b981' }} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" width={34} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #f0ebe5', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
            formatter={(val: any, name: string) => {
              if (name === 'conv') return [`${val}%`, 'Conversion'];
              if (name === 'contactRate') return [`${val}%`, 'Contact Rate'];
              return [val, 'Volume'];
            }}
            labelFormatter={(_: any, p: any) => p?.[0]?.payload?.fullName ?? _}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Bar yAxisId="left" dataKey="total" name="Volume" fill="#bfdbfe" radius={[3, 3, 0, 0]} maxBarSize={36}>
            <LabelList dataKey="total" position="top" style={{ fontSize: 10, fill: '#1c1410', fontWeight: 700 }} />
          </Bar>
          <Line yAxisId="right" type="monotone" dataKey="conv" name="Conv %" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3.5, fill: '#10b981' }} />
          <Line yAxisId="right" type="monotone" dataKey="contactRate" name="Contact %" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3, fill: '#8b5cf6' }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] text-[#9a8a7a] uppercase font-semibold border-b border-black/5">
              <th className="text-left py-2 px-2">Source</th>
              <th className="text-right py-2 px-2">Total</th>
              <th className="text-right py-2 px-2">Contacted</th>
              <th className="text-right py-2 px-2">Won</th>
              <th className="text-right py-2 px-2">Contact %</th>
              <th className="text-right py-2 px-2">Conv %</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => {
              const contactPct = s.total > 0 ? Math.round((s.contacted / s.total) * 100) : 0;
              return (
                <tr key={i} className="border-b border-black/[0.03] hover:bg-[var(--app-bg)]">
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                      <span className="font-semibold text-[#1c1410]">{s.source || 'Unknown'}</span>
                    </div>
                  </td>
                  <td className="text-right px-2 font-bold text-[#1c1410]">{s.total}</td>
                  <td className="text-right px-2 text-[#1c1410]">{s.contacted}</td>
                  <td className="text-right px-2 font-bold text-emerald-600">{s.won}</td>
                  <td className="text-right px-2">
                    <span className={`font-semibold ${contactPct >= 60 ? 'text-violet-600' : contactPct >= 30 ? 'text-[#1c1410]' : 'text-red-500'}`}>{contactPct}%</span>
                  </td>
                  <td className="text-right px-2">
                    <span className={`font-bold px-2 py-0.5 rounded-md text-[11px] ${s.conv_pct >= 20 ? 'bg-emerald-50 text-emerald-700' : s.conv_pct >= 5 ? 'bg-amber-50 text-amber-700' : 'bg-[#f4efe9] text-[#9a8a7a]'}`}>
                      {s.conv_pct}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Staff Leaderboard - sortable table with rankings, performance badges, contact bars
function StaffLeaderboard({ staff }: { staff: StaffRow[] }) {
  const [sortBy, setSortBy] = useState<keyof StaffRow>('conv_pct');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const active = staff.filter((s) => s.assigned > 0);
  const sorted = [...active].sort((a, b) => {
    const av = (a as any)[sortBy] as number;
    const bv = (b as any)[sortBy] as number;
    return sortDir === 'desc' ? bv - av : av - bv;
  });
  const toggle = (key: keyof StaffRow) => {
    if (sortBy === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortBy(key); setSortDir('desc'); }
  };
  if (!active.length) return <EmptyState text="No staff with assigned leads" />;

  const getPerf = (s: StaffRow) => {
    if (s.conv_pct >= 25 && s.contact_pct >= 60) return { label: 'Star', bg: '#fefce8', color: '#ca8a04', border: '#fde047' };
    if (s.conv_pct >= 10 || s.contact_pct >= 50) return { label: 'Good', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' };
    if (s.contact_pct < 25 && s.assigned >= 5) return { label: 'At Risk', bg: '#fef2f2', color: '#ef4444', border: '#fecaca' };
    return { label: 'Steady', bg: '#f0f4ff', color: '#6366f1', border: '#c7d2fe' };
  };

  const SortHead = ({ label, field }: { label: string; field: keyof StaffRow }) => (
    <th className="py-2.5 px-2 cursor-pointer select-none hover:text-[#1c1410] transition-colors text-right"
      onClick={() => toggle(field)}>
      <div className="flex items-center gap-1 justify-end">
        <span>{label}</span>
        {sortBy === field && <span className="text-[8px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}
      </div>
    </th>
  );

  const avgConv = active.length ? Math.round(active.reduce((s, x) => s + x.conv_pct, 0) / active.length) : 0;
  const avgContact = active.length ? Math.round(active.reduce((s, x) => s + x.contact_pct, 0) / active.length) : 0;
  const totalWon = active.reduce((s, x) => s + x.won, 0);
  const totalAssigned = active.reduce((s, x) => s + x.assigned, 0);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f4efe9]">
          <span className="text-[10px] text-[#9a8a7a] font-semibold uppercase">Team</span>
          <span className="text-[14px] font-bold text-[#1c1410]">{active.length} members</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f4efe9]">
          <span className="text-[10px] text-[#9a8a7a] font-semibold uppercase">Assigned</span>
          <span className="text-[14px] font-bold text-[#1c1410]">{totalAssigned}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50">
          <span className="text-[10px] text-emerald-600 font-semibold uppercase">Won</span>
          <span className="text-[14px] font-bold text-emerald-700">{totalWon}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50">
          <span className="text-[10px] text-violet-500 font-semibold uppercase">Avg Contact</span>
          <span className="text-[14px] font-bold text-violet-700">{avgContact}%</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
          style={{ background: avgConv >= 15 ? '#f0fdf4' : avgConv >= 5 ? '#fefce8' : '#fef2f2' }}>
          <span className="text-[10px] font-semibold uppercase"
            style={{ color: avgConv >= 15 ? '#16a34a' : avgConv >= 5 ? '#ca8a04' : '#ef4444' }}>Avg Conv</span>
          <span className="text-[14px] font-bold"
            style={{ color: avgConv >= 15 ? '#15803d' : avgConv >= 5 ? '#a16207' : '#dc2626' }}>{avgConv}%</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10px] text-[#9a8a7a] uppercase font-semibold border-b border-black/5">
              <th className="text-left py-2.5 px-2 w-8">#</th>
              <th className="text-left py-2.5 px-2">Staff</th>
              <SortHead label="Assigned" field="assigned" />
              <SortHead label="Contacted" field="contact_pct" />
              <SortHead label="Won" field="won" />
              <SortHead label="Follow-ups" field="followups" />
              <SortHead label="Conv %" field="conv_pct" />
              <th className="text-center py-2.5 px-2">Rating</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => {
              const perf = getPerf(s);
              const rank = i + 1;
              const rankStyle = rank === 1 ? 'bg-amber-100 text-amber-800'
                : rank === 2 ? 'bg-gray-200 text-gray-700'
                : rank === 3 ? 'bg-orange-100 text-orange-700'
                : 'bg-[#f4efe9] text-[#9a8a7a]';
              return (
                <tr key={s.id} className="border-b border-black/[0.03] hover:bg-[var(--app-bg)] transition-colors">
                  <td className="py-2.5 px-2">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-[10px] font-bold ${rankStyle}`}>{rank}</span>
                  </td>
                  <td className="py-2.5 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-primary">{s.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}</span>
                      </div>
                      <span className="font-semibold text-[#1c1410] truncate">{s.name}</span>
                    </div>
                  </td>
                  <td className="text-right px-2 font-bold text-[#1c1410]">{s.assigned}</td>
                  <td className="text-right px-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-14 h-1.5 bg-[#f0ece8] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${s.contact_pct}%`, background: s.contact_pct >= 60 ? '#10b981' : s.contact_pct >= 30 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                      <span className={`font-semibold w-8 text-right ${s.contact_pct >= 60 ? 'text-emerald-600' : s.contact_pct >= 30 ? 'text-amber-500' : 'text-red-500'}`}>{s.contact_pct}%</span>
                    </div>
                  </td>
                  <td className="text-right px-2 font-bold text-emerald-600">{s.won}</td>
                  <td className="text-right px-2 text-[#1c1410]">{s.followups}</td>
                  <td className="text-right px-2">
                    <span className={`font-bold px-2 py-0.5 rounded-md text-[11px] ${s.conv_pct >= 20 ? 'bg-emerald-50 text-emerald-700' : s.conv_pct >= 5 ? 'bg-amber-50 text-amber-700' : 'bg-[#f4efe9] text-[#9a8a7a]'}`}>{s.conv_pct}%</span>
                  </td>
                  <td className="text-center px-2">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-lg border"
                      style={{ background: perf.bg, color: perf.color, borderColor: perf.border }}>{perf.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Tag Intelligence - bars with color dots, lead count, won, conv%
function TagIntelligence({ tags }: { tags: PipelineData['tags'] }) {
  if (!tags.length) return <EmptyState text="No tags used in this pipeline" />;
  const maxTotal = Math.max(...tags.map((t) => t.total), 1);
  return (
    <div className="flex flex-col gap-3">
      {tags.map((tag, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: tag.color || SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
          <span className="text-[13px] font-semibold text-[#1c1410] w-28 shrink-0 truncate">{tag.name}</span>
          <div className="flex-1 bg-[#f4efe9] rounded-full h-5 overflow-hidden">
            <div className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
              style={{ width: `${Math.max(Math.round((tag.total / maxTotal) * 100), 3)}%`, background: tag.color || SOURCE_COLORS[i % SOURCE_COLORS.length] }}>
              {tag.total > 0 && <span className="text-[10px] font-bold text-white">{tag.total}</span>}
            </div>
          </div>
          <div className="shrink-0 text-right w-20">
            <span className="text-[11px] font-bold text-emerald-600">{tag.won} won</span>
            <span className="text-[10px] text-[#9a8a7a] ml-1">({tag.conv_pct}%)</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Automation Effectiveness - workflow execution table
function AutomationEffectiveness({ workflows }: { workflows: PipelineData['automation'] }) {
  if (!workflows.length) return <EmptyState text="No automation activity in this period" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[10px] text-[#9a8a7a] uppercase font-semibold border-b border-black/5">
            <th className="text-left py-2 px-2">Workflow</th>
            <th className="text-right py-2 px-2">Runs</th>
            <th className="text-right py-2 px-2">Done</th>
            <th className="text-right py-2 px-2">Failed</th>
            <th className="text-right py-2 px-2">Leads</th>
            <th className="py-2 px-2 w-24">Success</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((w, i) => {
            const successPct = w.total > 0 ? Math.round((w.completed / w.total) * 100) : 0;
            return (
              <tr key={i} className="border-b border-black/[0.03] hover:bg-[var(--app-bg)]">
                <td className="py-2 px-2 font-semibold text-[#1c1410] truncate max-w-[200px]">{w.name}</td>
                <td className="text-right px-2 font-bold text-[#1c1410]">{w.total}</td>
                <td className="text-right px-2 text-emerald-600 font-bold">{w.completed}</td>
                <td className="text-right px-2 text-red-500 font-bold">{w.failed || 0}</td>
                <td className="text-right px-2 text-[#1c1410]">{w.leads_enrolled}</td>
                <td className="px-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#f0ece8] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${successPct}%`, background: successPct >= 80 ? '#10b981' : successPct >= 50 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                    <span className="text-[10px] font-semibold w-8 text-right" style={{ color: successPct >= 80 ? '#10b981' : successPct >= 50 ? '#f59e0b' : '#ef4444' }}>{successPct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Lead Quality - stacked bar + legend
function LeadQualityChart({ quality }: { quality: PipelineData['quality'] }) {
  if (!quality.length) return <EmptyState text="No quality data" />;
  const total = quality.reduce((s, q) => s + q.count, 0);
  const qualityColors: Record<string, string> = {
    hot: '#ef4444', warm: '#f59e0b', cold: '#3b82f6', unqualified: '#9ca3af', unknown: '#d1d5db',
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-8 rounded-xl overflow-hidden gap-0.5">
        {quality.map((q, i) => {
          const pct = total > 0 ? (q.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div key={i} className="h-full flex items-center justify-center transition-all"
              style={{ width: `${pct}%`, background: qualityColors[q.quality?.toLowerCase()] || SOURCE_COLORS[i % SOURCE_COLORS.length], minWidth: pct > 0 ? 24 : 0 }}>
              {pct > 8 && <span className="text-[10px] font-bold text-white">{q.count}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        {quality.map((q, i) => {
          const pct = total > 0 ? Math.round((q.count / total) * 100) : 0;
          const color = qualityColors[q.quality?.toLowerCase()] || SOURCE_COLORS[i % SOURCE_COLORS.length];
          return (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              <span className="text-[11px] font-semibold text-[#1c1410] capitalize">{q.quality || 'Unknown'}</span>
              <span className="text-[10px] text-[#9a8a7a]">{q.count} ({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Lead Aging - horizontal bars by days-in-pipeline buckets
function LeadAgingChart({ aging }: { aging: PipelineData['aging'] }) {
  if (!aging?.length) return <EmptyState text="No active leads" />;
  const maxCount = Math.max(...aging.map((a) => a.count), 1);
  const bucketColors: Record<string, string> = {
    '0-2d': '#10b981', '3-7d': '#3b82f6', '8-14d': '#f59e0b', '15-30d': '#f97316', '30d+': '#ef4444',
  };
  const total = aging.reduce((s, a) => s + a.count, 0);
  return (
    <div>
      <div className="flex flex-col gap-2.5">
        {aging.map((a, i) => {
          const barW = Math.max(Math.round((a.count / maxCount) * 100), a.count > 0 ? 3 : 0);
          const color = bucketColors[a.bucket] || STAGE_COLORS[i % STAGE_COLORS.length];
          const pct = total > 0 ? Math.round((a.count / total) * 100) : 0;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-[#4a3a2a] w-14 shrink-0">{a.bucket}</span>
              <div className="flex-1 bg-[#f4efe9] rounded-full h-6 overflow-hidden">
                <div className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
                  style={{ width: `${barW}%`, background: color }}>
                  {barW > 12 && <span className="text-[10px] font-bold text-white">{a.count}</span>}
                </div>
              </div>
              {barW <= 12 && <span className="text-[11px] font-bold text-[#1c1410] w-6 text-right">{a.count}</span>}
              <span className="text-[10px] text-[#9a8a7a] w-8 text-right shrink-0">{pct}%</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[#c0b0a0] mt-2 pt-2 border-t border-black/[0.04]">
        Active leads only (excludes won) · Grouped by days since creation
      </p>
    </div>
  );
}

// Call Analytics - KPI cards + direction breakdown
function CallAnalytics({ calls }: { calls: PipelineData['calls'] }) {
  if (!calls?.length) return <EmptyState text="No call data in this period" />;
  const totalCalls = calls.reduce((s, c) => s + c.count, 0);
  const answered = calls.filter((c) => c.outcome === 'ANSWERED').reduce((s, c) => s + c.count, 0);
  const missed = calls.filter((c) => c.outcome === 'MISSED').reduce((s, c) => s + c.count, 0);
  const inbound = calls.filter((c) => c.direction === 'INBOUND').reduce((s, c) => s + c.count, 0);
  const outbound = calls.filter((c) => c.direction === 'OUTBOUND').reduce((s, c) => s + c.count, 0);
  const answeredCalls = calls.filter((c) => c.outcome === 'ANSWERED');
  const avgDur = answeredCalls.length > 0
    ? Math.round(answeredCalls.reduce((s, c) => s + c.avg_duration * c.count, 0) / Math.max(answered, 1))
    : 0;
  const answerRate = totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : 0;
  const fmtDur = (secs: number) => secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl bg-[#f4efe9] px-3 py-2.5 text-center">
          <p className="text-[18px] font-bold text-[#1c1410]">{totalCalls}</p>
          <p className="text-[10px] text-[#9a8a7a]">Total Calls</p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-center">
          <p className="text-[18px] font-bold text-emerald-700">{answered}</p>
          <p className="text-[10px] text-emerald-600">Answered ({answerRate}%)</p>
        </div>
        <div className="rounded-xl bg-red-50 px-3 py-2.5 text-center">
          <p className="text-[18px] font-bold text-red-600">{missed}</p>
          <p className="text-[10px] text-red-500">Missed</p>
        </div>
        <div className="rounded-xl bg-blue-50 px-3 py-2.5 text-center">
          <p className="text-[18px] font-bold text-blue-700">{fmtDur(avgDur)}</p>
          <p className="text-[10px] text-blue-500">Avg Duration</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#9a8a7a] w-16 shrink-0">Inbound</span>
          <div className="flex-1 bg-[#f4efe9] rounded-full h-5 overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full flex items-center justify-end pr-2"
              style={{ width: `${totalCalls > 0 ? Math.max((inbound / totalCalls) * 100, inbound > 0 ? 8 : 0) : 0}%` }}>
              {inbound > 0 && <span className="text-[10px] font-bold text-white">{inbound}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#9a8a7a] w-16 shrink-0">Outbound</span>
          <div className="flex-1 bg-[#f4efe9] rounded-full h-5 overflow-hidden">
            <div className="h-full bg-violet-400 rounded-full flex items-center justify-end pr-2"
              style={{ width: `${totalCalls > 0 ? Math.max((outbound / totalCalls) * 100, outbound > 0 ? 8 : 0) : 0}%` }}>
              {outbound > 0 && <span className="text-[10px] font-bold text-white">{outbound}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Lead Inflow - daily bar chart
function LeadInflowChart({ data }: { data: { day: string; count: number }[] }) {
  if (!data.length) return <EmptyState text="No lead inflow data" />;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe5" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#9a8a7a' }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(data.length / 8))} />
        <YAxis tick={{ fontSize: 9, fill: '#9a8a7a' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f0ebe5', fontSize: 12 }} />
        <Bar dataKey="count" name="Leads" fill="#bfdbfe" radius={[3, 3, 0, 0]} maxBarSize={24}>
          <LabelList dataKey="count" position="top" style={{ fontSize: 9, fill: '#1c1410', fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Overdue list
function OverdueList({ items }: { items: OverdueRow[] }) {
  if (!items.length) return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <CheckCircle2 className="w-8 h-8 text-[#10b981]" />
      <p className="text-[14px] font-semibold text-[#10b981]">No overdue follow-ups</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center justify-between p-3 bg-[#fefce8] rounded-xl border border-[#fef08a]">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#1c1410] truncate">{item.lead_name}</p>
            <p className="text-[10px] text-[#9a8a7a] mt-0.5">{item.staff_name ?? item.title ?? ''}</p>
          </div>
          <span className="text-[11px] font-bold text-[#ca8a04] shrink-0 ml-3 bg-white px-2 py-1 rounded-lg border border-[#fde047]">
            {item.overdue_days}d late
          </span>
        </div>
      ))}
    </div>
  );
}

// Stale/idle leads list
function StaleList({ stale }: { stale: StaleShape }) {
  if (!stale?.stale_count) return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <CheckCircle2 className="w-8 h-8 text-[#10b981]" />
      <p className="text-[14px] font-semibold text-[#10b981]">All leads active</p>
      <p className="text-[11px] text-[#9a8a7a]">No leads stuck for 7+ days</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-[#9a8a7a] mb-1">{stale.stale_count} leads stuck · max {stale.max_days}d</p>
      {stale.list?.map((l, i) => (
        <div key={i} className="flex items-center justify-between p-3 bg-[#fef2f2] rounded-xl border border-[#fee2e2]">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#1c1410] truncate">{l.name}</p>
            <p className="text-[10px] text-[#9a8a7a] mt-0.5">{l.stage_name ?? '-'} · {l.assigned_name ?? 'Unassigned'}</p>
          </div>
          <span className="text-[11px] font-bold text-[#ef4444] shrink-0 ml-3 bg-white px-2 py-1 rounded-lg border border-[#fecaca]">
            {l.days_stale}d
          </span>
        </div>
      ))}
    </div>
  );
}

// Follow-up summary 4-box
function FollowupSummary({ fu }: { fu: { total: number; completed: number; pending: number; overdue: number } }) {
  const items = [
    { label: 'Total',     value: fu.total ?? 0,     color: '#6366f1' },
    { label: 'Completed', value: fu.completed ?? 0, color: '#10b981' },
    { label: 'Pending',   value: fu.pending ?? 0,   color: '#f59e0b' },
    { label: 'Overdue',   value: fu.overdue ?? 0,   color: '#ef4444' },
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map(({ label, value, color }) => (
        <div key={label} className="text-center p-3 rounded-xl" style={{ background: `${color}0f` }}>
          <p className="text-[22px] font-bold" style={{ color }}>{value}</p>
          <p className="text-[11px] text-[#9a8a7a] mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}

// Pipeline dropdown
function PipelineDropdown({ pipelines, selected, onChange }: {
  pipelines: { id: string; name: string }[];
  selected: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = pipelines.find((p) => p.id === selected)?.name ?? 'Select Pipeline';

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-white border border-black/10 rounded-xl px-4 py-2 text-[14px] font-semibold text-[#1c1410] hover:border-primary/40 transition-colors min-w-[180px] shadow-sm">
        <span className="flex-1 text-left truncate">{name}</span>
        <ChevronDown className={cn('w-4 h-4 text-[#9e8e7e] shrink-0 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full mt-1.5 left-0 min-w-[200px] bg-white border border-black/8 rounded-xl shadow-xl z-50 py-1.5 max-h-64 overflow-y-auto">
          {pipelines.map((pl) => (
            <button key={pl.id} onClick={() => { onChange(pl.id); setOpen(false); }}
              className={cn('w-full text-left px-4 py-2.5 text-[14px] transition-colors',
                pl.id === selected ? 'bg-primary/8 text-primary font-semibold' : 'text-[#1c1410] hover:bg-[var(--app-bg)] font-medium')}>
              {pl.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Owner Report ──────────────────────────────────────────────────────────────
function OwnerReport() {
  const [pipelines, setPipelines]   = useState<{ id: string; name: string }[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [period, setPeriod]         = useState('this_month');
  const [from, setFrom]             = useState('');
  const [to, setTo]                 = useState('');
  const [data, setData]             = useState<PipelineData | null>(null);
  const [loading, setLoading]       = useState(false);
  const [plLoading, setPlLoading]   = useState(true);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/api/reports/pipelines')
      .then((rows) => { setPipelines(rows); if (rows.length) setPipelineId(rows[0].id); })
      .catch(() => toast.error('Failed to load pipelines'))
      .finally(() => setPlLoading(false));
  }, []);

  useEffect(() => {
    if (!pipelineId) return;
    if (period === 'custom' && (!from || !to)) return;
    setLoading(true); setData(null);
    const params = new URLSearchParams({ pipeline_id: pipelineId, range: period });
    if (period === 'custom') { params.set('from', from); params.set('to', to); }
    api.get<PipelineData>(`/api/reports/pipeline-analytics?${params}`)
      .then(setData).catch(() => toast.error('Failed to load analytics')).finally(() => setLoading(false));
  }, [pipelineId, period, from, to]);

  return (
    <div className="flex flex-col gap-5 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-bold text-[#1c1410]">Business Analytics</h1>
          <p className="text-[13px] text-[#9a8a7a] mt-0.5">Full pipeline performance · owner view</p>
        </div>
        {!plLoading && pipelines.length > 0 && (
          <PipelineDropdown pipelines={pipelines} selected={pipelineId} onChange={setPipelineId} />
        )}
      </div>

      <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />

      {(plLoading || loading) && <Spinner />}
      {!plLoading && !loading && pipelines.length === 0 && (
        <div className="text-center py-20 text-[14px] text-[#9a8a7a]">No pipelines found. Create a pipeline first.</div>
      )}

      {data && !loading && (
        <div className="flex flex-col gap-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Total Leads"     value={data.kpi.total_leads}             sub={`${data.kpi.active} active`}              icon={TrendingUp}   accent />
            <KpiCard label="Won"             value={data.kpi.won}                     sub={`${data.kpi.conv_pct}% conversion`}       icon={CheckCircle2} />
            <KpiCard label="Active Leads"    value={data.kpi.active}                  sub="Not yet in a won stage"                   icon={Users} />
            <KpiCard label="Avg Days to Win" value={`${data.kpi.avg_days_to_close}d`} sub="From lead creation to won"                icon={Clock} />
          </div>

          {/* Breakdown bar */}
          <LeadBreakdown total={data.kpi.total_leads} won={data.kpi.won} active={data.kpi.active} />

          {/* Trend */}
          <Card title="New Leads vs Won - Monthly" sub="Volume trend over the selected period">
            <TrendChart data={data.win_loss} />
          </Card>

          {/* Source ROI */}
          <Card title="Source ROI - Volume, Contact Rate & Conversion" sub={`${data.sources.length} sources tracked · bars = volume, lines = rates`}>
            <SourceROIChart sources={data.sources} />
          </Card>

          {/* Pipeline Funnel */}
          <Card title="Pipeline Funnel" sub="Stage distribution, drop-off & idle time">
            <StageFunnel stages={data.stages} />
          </Card>

          {/* Staff Leaderboard */}
          <Card title="Staff Leaderboard" sub="Team performance ranked by conversion - click headers to sort">
            <StaffLeaderboard staff={data.staff} />
          </Card>

          {/* Lead Aging + Lead Quality */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Lead Aging" sub="How long open leads have been sitting">
              <LeadAgingChart aging={data.aging} />
            </Card>
            <Card title="Lead Quality Breakdown" sub="Hot / Warm / Cold / Unqualified split">
              <LeadQualityChart quality={data.quality} />
            </Card>
          </div>

          {/* Tag Intelligence + Call Analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Tag Intelligence" sub="Conversion performance by tag">
              <TagIntelligence tags={data.tags} />
            </Card>
            <Card title="Call Analytics" sub="Call volume, direction and outcomes">
              <CallAnalytics calls={data.calls} />
            </Card>
          </div>

          {/* Lead Inflow */}
          <Card title="Daily Lead Inflow" sub="New leads created per day">
            <LeadInflowChart data={data.lead_flow} />
          </Card>

          {/* Automation Effectiveness */}
          <Card title="Automation Effectiveness" sub="Workflow execution success rates">
            <AutomationEffectiveness workflows={data.automation} />
          </Card>

          {/* Stale + Overdue */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Idle Leads" sub="No activity in 7+ days">
              <StaleList stale={data.stale} />
            </Card>
            <Card title="Overdue Follow-ups" sub="All current overdue tasks">
              <OverdueList items={data.followups.overdue_list} />
            </Card>
          </div>

          {/* Follow-up summary */}
          <Card title="Follow-up Summary" sub="Period-scoped follow-up activity">
            <FollowupSummary fu={data.followups} />
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Manager Report ────────────────────────────────────────────────────────────
function ManagerReport() {
  const [pipelines, setPipelines]   = useState<{ id: string; name: string }[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [period, setPeriod]         = useState('this_month');
  const [from, setFrom]             = useState('');
  const [to, setTo]                 = useState('');
  const [data, setData]             = useState<PipelineData | null>(null);
  const [loading, setLoading]       = useState(false);
  const [plLoading, setPlLoading]   = useState(true);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/api/reports/pipelines')
      .then((rows) => { setPipelines(rows); if (rows.length) setPipelineId(rows[0].id); })
      .catch(() => toast.error('Failed to load pipelines'))
      .finally(() => setPlLoading(false));
  }, []);

  useEffect(() => {
    if (!pipelineId) return;
    if (period === 'custom' && (!from || !to)) return;
    setLoading(true); setData(null);
    const params = new URLSearchParams({ pipeline_id: pipelineId, range: period });
    if (period === 'custom') { params.set('from', from); params.set('to', to); }
    api.get<PipelineData>(`/api/reports/pipeline-analytics?${params}`)
      .then(setData).catch(() => toast.error('Failed to load analytics')).finally(() => setLoading(false));
  }, [pipelineId, period, from, to]);

  return (
    <div className="flex flex-col gap-5 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-bold text-[#1c1410]">Team Analytics</h1>
          <p className="text-[13px] text-[#9a8a7a] mt-0.5">Your team's pipeline and performance metrics</p>
        </div>
        {!plLoading && pipelines.length > 0 && (
          <PipelineDropdown pipelines={pipelines} selected={pipelineId} onChange={setPipelineId} />
        )}
      </div>

      <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />

      {(plLoading || loading) && <Spinner />}

      {data && !loading && (
        <div className="flex flex-col gap-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Team Leads"      value={data.kpi.total_leads}          sub={`${data.kpi.active} active`}              icon={Users}        accent />
            <KpiCard label="Won"             value={data.kpi.won}                  sub={`${data.kpi.conv_pct}% conversion`}       icon={CheckCircle2} />
            <KpiCard label="Team Conv. Rate" value={`${data.kpi.conv_pct}%`}       sub="Leads converted to won stage"             icon={Target} />
            <KpiCard label="Overdue Tasks"   value={data.followups.overdue ?? 0}   sub="Follow-ups past due date"                 icon={CalendarClock} />
          </div>

          {/* Trend + Overdue */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card title="Team Monthly Trend" sub="New leads vs won over time" className="lg:col-span-3">
              <TrendChart data={data.win_loss} />
            </Card>
            <Card title="Overdue Follow-ups" sub="Team tasks past due date" className="lg:col-span-2">
              <OverdueList items={data.followups.overdue_list} />
            </Card>
          </div>

          {/* Pipeline Funnel */}
          <Card title="Pipeline Funnel" sub="Stage distribution, drop-off & idle time">
            <StageFunnel stages={data.stages} />
          </Card>

          {/* Source ROI */}
          <Card title="Source ROI" sub="Lead sources with contact & conversion rates">
            <SourceROIChart sources={data.sources} />
          </Card>

          {/* Staff Leaderboard */}
          <Card title="Staff Leaderboard" sub="Team performance ranked by conversion - click headers to sort">
            <StaffLeaderboard staff={data.staff} />
          </Card>

          {/* Lead Aging + Lead Quality */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Lead Aging" sub="How long open leads have been sitting">
              <LeadAgingChart aging={data.aging} />
            </Card>
            <Card title="Lead Quality Breakdown" sub="Hot / Warm / Cold / Unqualified split">
              <LeadQualityChart quality={data.quality} />
            </Card>
          </div>

          {/* Tag Intelligence + Call Analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Tag Intelligence" sub="Conversion performance by tag">
              <TagIntelligence tags={data.tags} />
            </Card>
            <Card title="Call Analytics" sub="Call volume, direction and outcomes">
              <CallAnalytics calls={data.calls} />
            </Card>
          </div>

          {/* Lead Inflow */}
          <Card title="Daily Lead Inflow" sub="New leads created per day">
            <LeadInflowChart data={data.lead_flow} />
          </Card>

          {/* Automation Effectiveness */}
          <Card title="Automation Effectiveness" sub="Workflow execution success rates">
            <AutomationEffectiveness workflows={data.automation} />
          </Card>

          {/* Follow-up Summary */}
          <Card title="Follow-up Summary" sub="Period-scoped task breakdown">
            <FollowupSummary fu={data.followups} />
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Staff Report ──────────────────────────────────────────────────────────────
function StaffReport() {
  const [period, setPeriod]   = useState('all_time');
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  const [data, setData]       = useState<StaffData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (period === 'custom' && (!from || !to)) return;
    setLoading(true); setData(null);
    const params = new URLSearchParams({ range: period });
    if (period === 'custom') { params.set('from', from); params.set('to', to); }
    api.get<StaffData>(`/api/reports/staff-analytics?${params}`)
      .then(setData).catch(() => toast.error('Failed to load your analytics')).finally(() => setLoading(false));
  }, [period, from, to]);

  const maxSource = data ? Math.max(...(data.sources?.map((s) => s.total) ?? [1]), 1) : 1;
  const maxStage  = data ? Math.max(...(data.stages?.map((s) => s.lead_count) ?? [1]), 1) : 1;
  const activeStages = data?.stages.filter((s) => s.lead_count > 0) ?? [];

  return (
    <div className="flex flex-col gap-5 pb-10">
      {/* Header */}
      <div>
        <h1 className="text-[18px] font-bold text-[#1c1410]">My Performance</h1>
        <p className="text-[13px] text-[#9a8a7a] mt-0.5">Your personal lead analytics</p>
      </div>

      <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />

      {loading && <Spinner />}

      {data && !loading && (
        <div className="flex flex-col gap-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="My Leads"      value={data.kpi.total_leads}              sub={`${data.kpi.active} active`}               icon={TrendingUp}    accent />
            <KpiCard label="My Won"        value={data.kpi.won}                      sub={`${data.kpi.conv_pct}% conversion`}         icon={CheckCircle2} />
            <KpiCard label="Conv. Rate"    value={`${data.kpi.conv_pct}%`}           sub={`Avg ${data.kpi.avg_days_to_close}d to win`} icon={Target} />
            <KpiCard label="My Overdue"    value={data.followups.overdue ?? 0}       sub="Follow-ups past due date"                   icon={CalendarClock} />
          </div>

          {/* Breakdown bar */}
          <LeadBreakdown total={data.kpi.total_leads} won={data.kpi.won} active={data.kpi.active} />

          {/* Trend + Sources */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card title="My Monthly Trend" sub="My leads assigned vs won" className="lg:col-span-3">
              <TrendChart data={data.win_loss} />
            </Card>
            <Card title="My Lead Sources" sub="Where my leads come from" className="lg:col-span-2">
              <HBarList
                items={data.sources}
                getLabel={(s) => s.source}
                getWidth={(s) => Math.round((s.total / maxSource) * 100)}
                getColor={(_, i) => SOURCE_COLORS[i % SOURCE_COLORS.length]}
                getRight={(s) => (
                  <>
                    <p className="text-[13px] font-bold text-[#1c1410]">{s.total}</p>
                    <p className="text-[10px] text-[#9a8a7a]">{s.conv_pct}% conv</p>
                  </>
                )}
                avatar={(s) => s.source}
              />
            </Card>
          </div>

          {/* Stage distribution + Overdue */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <Card title="My Stage Distribution" sub="Where my leads currently are" className="lg:col-span-3">
              {activeStages.length === 0 ? (
                <EmptyState text="No leads in any stage" />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {activeStages.map((stage, i) => {
                    const barW = Math.max(Math.round((stage.lead_count / maxStage) * 100), 3);
                    const color = stage.is_won ? '#10b981' : STAGE_COLORS[i % STAGE_COLORS.length];
                    return (
                      <div key={stage.stage_name} className="flex items-center gap-3">
                        <span className="text-[11px] font-semibold text-[#4a3a2a] w-[90px] shrink-0 truncate">{stage.stage_name}</span>
                        <div className="flex-1 bg-[#f4efe9] rounded-full h-7 overflow-hidden">
                          <div className="h-full rounded-full flex items-center justify-end pr-2.5 transition-all duration-500"
                            style={{ width: `${barW}%`, background: color }}>
                            {barW > 14 && <span className="text-[11px] font-bold text-white">{stage.lead_count}</span>}
                          </div>
                        </div>
                        {barW <= 14 && <span className="text-[13px] font-bold text-[#1c1410] w-5 text-right">{stage.lead_count}</span>}
                        {stage.is_won && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">Won <Check className="w-2.5 h-2.5" strokeWidth={3} /></span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <Card title="My Overdue Follow-ups" sub="Tasks past due date" className="lg:col-span-2">
              <OverdueList items={data.overdue_list.map((o) => ({ ...o, staff_name: o.title }))} />
            </Card>
          </div>

          {/* Follow-up summary */}
          <Card title="My Follow-up Summary" sub="Period-scoped task activity">
            <FollowupSummary fu={data.followups} />
          </Card>
        </div>
      )}

      {data && !loading && data.kpi.total_leads === 0 && (
        <div className="text-center py-10 text-[14px] text-[#9a8a7a]">No leads assigned to you in this period.</div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const level = useUserLevel();
  if (level === 'staff')   return <StaffReport />;
  if (level === 'manager') return <ManagerReport />;
  return <OwnerReport />;
}
