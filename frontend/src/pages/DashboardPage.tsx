import { useState, useEffect, useMemo } from 'react';
import {
  Users, AlertTriangle, Clock, Target, CheckCircle, Star, PhoneOff, Phone, ChevronDown, Check, Layers,
  TrendingUp, TrendingDown,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermission';
import { useUserLevel } from '@/hooks/useUserLevel';
import { useHeaderSearch } from '@/store/headerSearchStore';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import ChartTooltip from '@/components/charts/ChartTooltip';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import {
  formatDistanceToNow, format, subDays, startOfDay, isToday, isPast,
  addDays, getDaysInMonth, subMonths, startOfMonth,
} from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { brandHex } from '@/lib/brand';
import { DatePicker } from '@/components/ui/date-picker';

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

// ── Business Growth area chart + footer stats (shared by dashboards) ───────────
function BusinessGrowthChart({ data, growthPct, height = 230 }: { data: { day: string; leads: number }[]; growthPct: number; height?: number }) {
  const total = data.reduce((s, d) => s + (d.leads || 0), 0);
  const avg = data.length ? total / data.length : 0;
  const best = data.reduce<{ day: string; leads: number } | null>((m, d) => (d.leads > (m?.leads ?? -1) ? d : m), null);
  const up = growthPct >= 0;
  const brand = brandHex();
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 12, right: 10, left: -14, bottom: 0 }}>
          <defs>
            <linearGradient id="bgGrowthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={brand} stopOpacity={0.34} />
              <stop offset="100%" stopColor={brand} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#eceef1" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} dy={6} interval={Math.max(0, Math.floor(data.length / 8))} />
          <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} width={34} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: brand, strokeOpacity: 0.25, strokeWidth: 1 }} />
          <Area
            type="linear" dataKey="leads" stroke={brand} strokeWidth={2.5} fill="url(#bgGrowthFill)"
            dot={{ r: 4, fill: '#fff', stroke: brand, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: '#fff', stroke: brand, strokeWidth: 2.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 pt-4 border-t border-[var(--hairline)] grid grid-cols-2 sm:grid-cols-4 divide-x divide-[var(--hairline)]">
        {[
          { label: 'Average / Day', value: avg.toFixed(1), cls: 'text-[#111318]' },
          { label: 'Best Day', value: best && best.leads > 0 ? `${best.day} (${best.leads})` : 'NIL', cls: 'text-[#111318]' },
          { label: 'Total', value: String(total), cls: 'text-[#111318]' },
          { label: 'vs Last Month', value: `${up ? '↑' : '↓'} ${Math.abs(growthPct)}%`, cls: up ? 'text-emerald-600' : 'text-red-500' },
        ].map((s) => (
          <div key={s.label} className="px-3 text-center">
            <p className="text-[11.5px] text-[#9ca3af] mb-0.5">{s.label}</p>
            <p className={`text-[15px] font-bold ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Compact horizontal Stat Card ──────────────────────────────────────────────
// ── Calls KPI ────────────────────────────────────────────────────────────────
// call_logs is fed by the mobile Dialer as well as the Superfone CDR webhook, so
// this card must not hang off the Superfone feature flag - doing so hid it from
// every company that had not switched Superfone on, whether or not they had calls.
// A company with no calls yet keeps the card and reads NIL instead of losing it.
const callsValue = (total: number): string | number => (total > 0 ? total : 'NIL');
const callsSub = (total: number, answered: number, missed: number): string =>
  total > 0 ? `${answered} answered · ${missed} missed` : 'No calls logged yet';

function StatCard({ label, value, sub, icon: Icon, accent = false, warn = false, danger = false, smallValue = false, onClick }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: boolean; warn?: boolean; danger?: boolean;
  smallValue?: boolean; onClick?: () => void;
}) {
  const clickClass = onClick ? 'cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-150' : '';

  if (accent) return (
    <div
      onClick={onClick}
      className={`rounded-2xl px-4 py-3.5 flex items-center gap-3 text-white ${clickClass}`}
      style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 8px 24px rgba(234,88,12,0.24)' }}
    >
      <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] opacity-80 truncate">{label}</p>
        <h3 className={`font-headline font-bold leading-tight tracking-tight ${smallValue ? 'text-[16px] truncate' : 'text-[22px]'}`}>{value}</h3>
        {sub && <p className="text-[13px] opacity-70 truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  );

  if (danger) return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 card-shadow border border-red-200 ${clickClass}`}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-red-50">
        <Icon className="w-4 h-4 text-red-500" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-red-400 truncate">{label}</p>
        <h3 className={`font-headline font-bold text-red-600 leading-tight tracking-tight ${smallValue ? 'text-[16px] truncate' : 'text-[22px]'}`}>{value}</h3>
        {sub && <p className="text-[13px] text-red-400 truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  );

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 card-shadow border ${warn ? 'border-amber-200' : 'border-[var(--hairline)]'} ${clickClass}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${warn ? 'bg-amber-50' : 'bg-primary/10'}`}>
        <Icon className={`w-4 h-4 ${warn ? 'text-amber-500' : 'text-primary'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-[#6b7280] truncate">{label}</p>
        <h3 className={`font-headline font-bold text-[#111318] leading-tight tracking-tight ${smallValue ? 'text-[16px] truncate' : 'text-[22px]'}`}>{value}</h3>
        {sub && <p className="text-[13px] text-[#8b929c] truncate mt-0.5">{sub}</p>}
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
          className={`px-3.5 py-1.5 rounded-full text-[14px] font-semibold transition-all active:scale-[0.98] border ${
            range === opt.value
              ? 'bg-primary text-white border-primary shadow-sm'
              : 'bg-white text-[#111318] border-[var(--hairline)] hover:border-primary/40 hover:bg-[var(--surface-2)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
      {range === 'custom' && (
        <div className="flex items-center gap-1.5 ml-1">
          <DatePicker
            value={customFrom}
            max={customTo || undefined}
            onChange={setCustomFrom}
            placeholder="Start date"
          />
          <span className="text-[12px] text-[#6b7280] font-medium">to</span>
          <DatePicker
            value={customTo}
            min={customFrom || undefined}
            onChange={setCustomTo}
            placeholder="End date"
            align="end"
          />
        </div>
      )}
    </div>
  );
}

// ── Pipeline funnel with drop-off indicators ──────────────────────────────────
function PipelineFunnelVisual({ funnels, title, subtitle }: { funnels: Analytics['pipeline_funnels']; title: string; subtitle: string }) {
  const [selectedId, setSelectedId] = useState('');
  const [open, setOpen] = useState(false);
  const list = funnels ?? [];
  const pipeline = list.find((f) => f.id === selectedId) ?? list[0] ?? null;

  // Card header: title on the left, custom themed pipeline dropdown on the top-right.
  const header = (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h3 className="font-headline font-bold text-[#111318] text-[16px]">{title}</h3>
        <p className="text-[12px] text-[#6b7280]">{subtitle}</p>
      </div>
      {list.length > 1 && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full border border-[var(--hairline)] bg-white text-[12.5px] font-semibold text-[#111318] hover:bg-[var(--surface-2)] transition-colors max-w-[160px]"
          >
            <span className="truncate">{pipeline?.name ?? 'Select'}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-[#6b7280] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-9 z-50 w-52 max-h-[220px] overflow-y-auto thin-scroll bg-white rounded-2xl border border-[var(--hairline)] py-1.5 shadow-[0_12px_40px_rgba(16,24,40,0.16)]">
                {list.map((p) => {
                  const active = pipeline?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSelectedId(p.id); setOpen(false); }}
                      className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] transition-colors ${
                        active ? 'bg-primary/10 text-primary font-semibold' : 'text-[#2b2f36] hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  if (!pipeline) return <div>{header}<p className="text-[14px] text-[#9ca3af]">No pipeline data.</p></div>;

  const stages = pipeline.stages ?? [];
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  return (
    <div>
      {header}

      {stages.length === 0 ? (
        <p className="text-[14px] text-[#9ca3af]">No stages in this pipeline.</p>
      ) : (() => {
        /* ── Vertical funnel histogram with a grey descending silhouette behind the bars ── */
        const N = stages.length;
        const BAND = 184;                                  // px height of the bar band
        const barH = (c: number) => Math.max((c / maxCount) * 72, c > 0 ? 6 : 2); // reserve headroom for the count + % pill above each bar
        // KDE-style density curve: a sum of Gaussian kernels centred on each stage,
        // weighted by that stage's lead count, sampled smoothly across the band.
        const gid = 'kdeFill-' + title.replace(/\s+/g, '');
        const SAMPLES = 72;
        const cxFrac = (i: number) => (i + 0.5) / N;                 // stage centre in 0..1
        const bw = Math.max(0.06, (1 / N) * 0.72);                   // kernel bandwidth
        const gauss = (d: number) => Math.exp(-(d * d) / (2 * bw * bw));
        const density = (xf: number) => stages.reduce((s, st, i) => s + st.count * gauss(xf - cxFrac(i)), 0);
        const samples = Array.from({ length: SAMPLES + 1 }, (_, k) => {
          const xf = k / SAMPLES;
          return { x: xf * 100, d: density(xf) };
        });
        const maxD = Math.max(1e-6, ...samples.map((p) => p.d));
        const yOf = (d: number) => 100 - (d / maxD) * 80;            // peak reaches ~20% from top
        const kdePath =
          'M 0,100 ' +
          samples.map((p) => `L ${p.x.toFixed(2)},${yOf(p.d).toFixed(2)}`).join(' ') +
          ' L 100,100 Z';
        return (
          <div>
            {/* Stage pills */}
            <div className="flex gap-1.5 mb-2.5">
              {stages.map((stage, i) => (
                <div key={i} className="flex-1 min-w-0 flex justify-center">
                  <span
                    className={`w-full text-center truncate text-[10px] font-bold uppercase tracking-wide rounded-full px-1.5 py-1 ${
                      stage.is_won ? 'bg-green-100 text-green-700' : 'bg-[var(--surface-2)] text-[#6b7280]'
                    }`}
                    title={stage.stage}
                  >
                    {stage.stage}
                  </span>
                </div>
              ))}
            </div>
            {/* Bar band - grey funnel silhouette sits behind the bars */}
            <div className="relative" style={{ height: BAND }}>
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={kdePath} fill={`url(#${gid})`} stroke="var(--brand)" strokeOpacity="0.35" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </svg>
              <div className="relative flex items-stretch gap-1.5 h-full">
                {stages.map((stage, i) => {
                  const prev = stages[i - 1];
                  // One % per stage: entry stage = 100% baseline; each later stage = conversion from the previous stage.
                  const conv = i === 0
                    ? 100
                    : prev && prev.count > 0
                      ? Math.round((stage.count / prev.count) * 100)
                      : stage.count > 0 ? 100 : 0;
                  const barColor = stage.is_won ? '#10b981' : 'var(--brand)';
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end min-w-0 relative">
                      {/* Count label */}
                      <span className="text-[12px] font-bold text-[#111318] leading-none">{stage.count}</span>
                      {/* Conversion % - one pill per stage, centered above its bar */}
                      <span
                        className="mt-1 mb-1.5 z-10 text-[10px] font-bold text-[#6b7280] bg-white border border-[var(--hairline)] rounded-full px-1.5 py-0.5 shadow-sm whitespace-nowrap"
                        title={i === 0 ? 'Entry stage' : `Conversion from ${prev?.stage ?? 'previous'}`}
                      >
                        {conv}%
                      </span>
                      {/* Bar */}
                      <div
                        className="w-full max-w-[48px] rounded-t-xl transition-all duration-300"
                        style={{ height: `${barH(stage.count)}%`, background: barColor }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Follow-up Priority widget - Overdue / Due Today / Upcoming, click to filter Leads ──
const FUP_CATS = [
  { key: 'overdue',   label: 'Overdue',   sub: 'Past their due date',    color: '#ef4444', dot: 'bg-red-500',     quick: 'followup_overdue' },
  { key: 'due_today', label: 'Due Today', sub: 'Action needed today',    color: '#f59e0b', dot: 'bg-amber-500',   quick: 'followup_today' },
  { key: 'upcoming',  label: 'Upcoming',  sub: 'Scheduled for later',    color: '#10b981', dot: 'bg-emerald-500', quick: 'followup_upcoming' },
] as const;

function FollowupPriorityCard() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ overdue: number; due_today: number; upcoming: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api.get<{ overdue: number; due_today: number; upcoming: number; total: number }>('/api/dashboard/followup-priority')
      .then((r) => { if (alive) { setData(r); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const total = data?.total ?? 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return (
    <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5 flex flex-col">
      <div className="mb-4">
        <h3 className="font-headline font-bold text-[#111318] text-[16px]">Follow-up Priority</h3>
        <p className="text-[12px] text-[#6b7280]">Leads requiring your attention</p>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center py-10"><span className="text-[13px] text-[#9ca3af]">Loading…</span></div>
      ) : total === 0 ? (
        <div className="flex-1 flex items-center justify-center py-10"><p className="text-[14px] text-[#9ca3af]">No follow-ups scheduled.</p></div>
      ) : (
        <>
          <div className="space-y-2.5">
            {FUP_CATS.map((c) => {
              const count = (data as any)?.[c.key] ?? 0;
              return (
                <button
                  key={c.key}
                  onClick={() => navigate(`/leads?filter=${c.quick}`)}
                  className="w-full flex items-center gap-3 rounded-2xl border border-[var(--hairline)] bg-white p-3 text-left hover:border-primary/30 hover:bg-[var(--surface-2)] transition-colors card-shadow-sm"
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-[#111318] leading-tight">{c.label}</p>
                    <p className="text-[11px] text-[#8b929c] truncate">{c.sub}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[18px] font-bold text-[#111318] leading-none">{count}</p>
                    <p className="text-[11px] text-[#8b929c] mt-0.5">{pct(count)}%</p>
                  </div>
                </button>
              );
            })}
          </div>
          {/* Horizontal stacked distribution bar */}
          <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            {FUP_CATS.map((c) => {
              const count = (data as any)?.[c.key] ?? 0;
              const w = pct(count);
              return w > 0
                ? <div key={c.key} style={{ width: `${w}%`, background: c.color }} className="h-full" title={`${c.label}: ${count} (${w}%)`} />
                : null;
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Lead Aging widget - active leads bucketed by age, click a bar to filter Leads ──
type AgingBucket = { key: string; label: string; count: number; quick: string };
const AGE_COLORS = ['#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444'];

function LeadAgingCard() {
  const navigate = useNavigate();
  const [buckets, setBuckets] = useState<AgingBucket[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState('');          // '' = all active stages
  const [stages, setStages] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    // Note: no setLoading(true) here - on a stage change we keep the current bars
    // visible and swap the data in place once it arrives, so the card never flickers
    // back to the loading state. The loading state is only for the very first render.
    const url = stage ? `/api/dashboard/lead-aging?stage=${encodeURIComponent(stage)}` : '/api/dashboard/lead-aging';
    api.get<{ buckets: AgingBucket[]; total: number; stages?: string[] }>(url)
      .then((r) => {
        if (!alive) return;
        setBuckets(r.buckets ?? []);
        setTotal(r.total ?? 0);
        if (r.stages) setStages(r.stages);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [stage]);
  const maxCount = buckets ? Math.max(...buckets.map((b) => b.count), 1) : 1;
  return (
    <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-headline font-bold text-[#111318] text-[16px]">Lead Aging</h3>
          <p className="text-[12px] text-[#6b7280]">Identify neglected leads</p>
        </div>
        {/* Stage filter dropdown */}
        <div className="relative shrink-0">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full border border-[var(--hairline)] bg-white text-[12.5px] font-semibold text-[#111318] hover:bg-[var(--surface-2)] transition-colors max-w-[160px]"
          >
            <span className="truncate">{stage || 'All stages'}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-[#6b7280] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-9 z-50 w-52 max-h-[220px] overflow-y-auto thin-scroll bg-white rounded-2xl border border-[var(--hairline)] py-1.5 shadow-[0_12px_40px_rgba(16,24,40,0.16)]">
                {[''].concat(stages).map((opt) => {
                  const selected = opt === stage;
                  return (
                    <button
                      key={opt || '__all__'}
                      onClick={() => { setStage(opt); setOpen(false); }}
                      className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] transition-colors ${
                        selected ? 'bg-primary/10 text-primary font-semibold' : 'text-[#2b2f36] hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <span className="truncate">{opt || 'All stages'}</span>
                      {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center py-10"><span className="text-[13px] text-[#9ca3af]">Loading…</span></div>
      ) : total === 0 ? (
        <div className="flex-1 flex items-center justify-center py-10"><p className="text-[14px] text-[#9ca3af]">{stage ? `No active leads in ${stage}.` : 'No active leads.'}</p></div>
      ) : (
        <div className="flex-1 flex flex-col justify-center gap-2.5">
          {buckets!.map((b, i) => {
            const w = Math.round((b.count / maxCount) * 100);
            const p = total > 0 ? Math.round((b.count / total) * 100) : 0;
            const color = AGE_COLORS[i % AGE_COLORS.length];
            return (
              <button
                key={b.key}
                onClick={() => navigate(`/leads?filter=${b.quick}${stage ? `&stage_name=${encodeURIComponent(stage)}` : ''}`)}
                title={`${b.label}: ${b.count} leads (${p}%)`}
                className="w-full group flex items-center gap-3 text-left"
              >
                <span className="w-[68px] shrink-0 text-[12px] font-medium text-[#6b7280] group-hover:text-[#111318] transition-colors">{b.label}</span>
                <div className="flex-1 h-7 rounded-lg bg-[var(--surface-2)] overflow-hidden">
                  <div className="h-full rounded-lg transition-all group-hover:brightness-95" style={{ width: `${b.count > 0 ? Math.max(w, 6) : 0}%`, background: color }} />
                </div>
                <span className="w-8 shrink-0 text-right text-[13px] font-bold text-[#111318]">{b.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Management Dashboard - Owner / Super Admin - aggregate only, NO individual lead names ──
function ManagementDashboard({ analytics, lineData }: {
  analytics: Analytics; lineData: any[];
}) {
  // Mirrors the sidebar's Calls item and the /calls page: owner/super_admin get
  // permAll, so the card is always there for them.
  const perm = usePermissions();
  const canViewCalls = perm('calls:view_all') || perm('calls:view_own');
  const accountability = analytics.staff_accountability ?? [];
  const totalAssigned  = accountability.reduce((s, a) => s + a.assigned, 0);
  const totalContacted = accountability.reduce((s, a) => s + a.contacted, 0);
  const teamContactRate = totalAssigned > 0 ? Math.round((totalContacted / totalAssigned) * 100) : 0;

  const srcConv     = analytics.source_conversion ?? [];
  const grandTotal  = srcConv.reduce((s, x) => s + x.total, 0);
  const bestConvSrc = [...srcConv].filter((s) => s.total >= 3).sort((a, b) => b.conv_pct - a.conv_pct)[0] ?? null;

  const growth    = analytics.growth_pct;
  const growthBadge = (
    <span
      className={
        'inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1.5 rounded-full ' +
        (growth > 0
          ? 'bg-emerald-50 text-emerald-700'
          : growth < 0
          ? 'bg-red-50 text-red-600'
          : 'bg-primary/10 text-primary')
      }
    >
      {growth > 0 && <TrendingUp className="w-4 h-4" strokeWidth={2.5} />}
      {growth < 0 && <TrendingDown className="w-4 h-4" strokeWidth={2.5} />}
      {growth > 0 ? `+${growth}% vs last month` : growth < 0 ? `${growth}% vs last month` : '0% vs last month'}
    </span>
  );

  return (
    <div className="space-y-5">

      {/* ── 1. Business Health KPIs - all aggregate, zero individual lead names ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="New Leads" value={analytics.range_leads ?? 0}
          sub={`${analytics.range_label} · ${analytics.total_leads} total all-time`}
          icon={Users} accent
        />
        <StatCard
          label="Team Contact Rate" value={`${teamContactRate}%`}
          sub={totalAssigned > 0 ? `${totalContacted} of ${totalAssigned} leads contacted` : 'No leads assigned yet'}
          icon={PhoneOff} accent
        />
        <StatCard
          label="Conversion Rate" value={`${analytics.conversion_rate}%`}
          sub={`${analytics.converted_leads} deals closed`}
          icon={Target} accent
        />
        <StatCard
          label="Best ROI Source"
          value={bestConvSrc ? sourceLabel(bestConvSrc.source) : analytics.best_source ? sourceLabel(analytics.best_source.source) : 'N/A'}
          sub={bestConvSrc ? `${bestConvSrc.conv_pct}% conv · ${bestConvSrc.total} leads` : analytics.best_source ? `${analytics.best_source.count} leads` : 'No data yet'}
          icon={Star} accent
          smallValue
        />
        {canViewCalls && (
          <StatCard
            label="Calls"
            value={callsValue(analytics.calls_total ?? 0)}
            sub={callsSub(analytics.calls_total ?? 0, analytics.calls_answered ?? 0, analytics.calls_missed ?? 0)}
            icon={Phone} accent
          />
        )}
      </div>

      {/* ── 2. Business Growth Trend (full width) ────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-headline font-bold text-[#111318] text-[16px]">Business Growth</h3>
            <p className="text-[12px] text-[#6b7280]">
              {analytics.range_label} ·{' '}
              <span className="font-bold text-[#111318]">{analytics.range_leads ?? 0}</span> new leads ·{' '}
              <span className="font-bold text-[#111318]">{analytics.total_leads}</span> total all-time
            </p>
          </div>
          {growthBadge}
        </div>
        <BusinessGrowthChart data={lineData} growthPct={growth} />
      </div>

      {/* ── 3. Pipeline Funnel + Source Intelligence ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5">
          <PipelineFunnelVisual funnels={analytics.pipeline_funnels} title="Pipeline Funnel" subtitle="Where leads are - and where they drop off" />
        </div>

        <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5 flex flex-col">
          <div className="mb-3">
            <h3 className="font-headline font-bold text-[#111318] text-[16px]">Source Intelligence</h3>
            <p className="text-[12px] text-[#6b7280]">{grandTotal} leads total · volume & conversion by channel</p>
          </div>
          {srcConv.length === 0
            ? (
              <div className="flex-1 flex flex-col sm:flex-row items-center gap-5">
                {/* Grey empty-state donut */}
                <div className="relative shrink-0" style={{ width: 148, height: 148 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[{ name: 'No data', value: 1 }]}
                        dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={40} outerRadius={70} stroke="none" isAnimationActive={false}
                      >
                        <Cell fill="#e5e7eb" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[24px] font-bold text-[#c3c8cf] leading-none">0</span>
                    <span className="text-[11px] text-[#9ca3af] mt-0.5">leads</span>
                  </div>
                </div>
                <p className="text-[13px] text-[#9ca3af] font-medium">No source data in this period yet.</p>
              </div>
            )
            : (() => {
              const donutData = srcConv.slice(0, 6).map((s) => ({ name: sourceLabel(s.source), value: s.total, pct: s.pct_of_total }));
              const topChannel = [...srcConv].sort((a, b) => b.total - a.total)[0] ?? null;
              const channelCount = srcConv.length;
              return (
                <div className="flex-1 flex flex-col sm:flex-row items-center gap-5">
                  {/* Donut */}
                  <div className="relative shrink-0" style={{ width: 148, height: 148 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          dataKey="value" nameKey="name" cx="50%" cy="50%"
                          innerRadius={40} outerRadius={70} paddingAngle={2} stroke="none"
                        >
                          {donutData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip hideLabel formatter={(val: any, _n: any, p: any) => [`${val} leads (${p.payload.pct}%)`, p.payload.name]} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[24px] font-bold text-[#111318] leading-none">{grandTotal}</span>
                      <span className="text-[11px] text-[#6b7280] mt-0.5">leads</span>
                    </div>
                  </div>
                  {/* Legend - compact so counts sit right next to the names */}
                  <div className="min-w-0 space-y-2 shrink-0">
                    {srcConv.slice(0, 6).map((s, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-[13px] font-semibold text-[#111318] w-24 truncate">{sourceLabel(s.source)}</span>
                        {s.conv_pct > 0 && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md shrink-0">{s.conv_pct}% conv</span>
                        )}
                        <span className="text-[13px] font-bold text-[#111318] shrink-0 w-5 text-right">{s.total}</span>
                        <span className="text-[11px] text-[#8b929c] shrink-0 w-11 text-right">({s.pct_of_total}%)</span>
                      </div>
                    ))}
                  </div>
                  {/* Extra metrics - two stacked stat tiles that fill the remaining width */}
                  <div className="flex-1 w-full flex flex-col gap-2.5 min-w-0">
                    <div className="rounded-2xl border border-[var(--hairline)] bg-white p-3.5 min-w-0 flex items-start gap-3 card-shadow-sm">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Star className="w-[18px] h-[18px] text-primary" /></div>
                      <div className="min-w-0">
                        <p className="text-[11.5px] text-[#6b7280] truncate">Top Channel</p>
                        <p className="text-[16px] font-bold text-[#111318] leading-tight truncate">{topChannel ? sourceLabel(topChannel.source) : 'NIL'}</p>
                        <p className="text-[10.5px] text-[#8b929c] truncate mt-0.5">{topChannel ? `${topChannel.total} leads · ${topChannel.pct_of_total}%` : 'No data'}</p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--hairline)] bg-white p-3.5 min-w-0 flex items-start gap-3 card-shadow-sm">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Layers className="w-[18px] h-[18px] text-primary" /></div>
                      <div className="min-w-0">
                        <p className="text-[11.5px] text-[#6b7280] truncate">Active Channels</p>
                        <p className="text-[16px] font-bold text-[#111318] leading-tight truncate">{channelCount || 'NIL'}</p>
                        <p className="text-[10.5px] text-[#8b929c] truncate mt-0.5">producing leads</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>
      </div>

      {/* ── 4. Follow-up Priority + Lead Aging ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FollowupPriorityCard />
        <LeadAgingCard />
      </div>

      {/* ── 5. Team Health - aggregate bars, no individual lead lists ────────────── */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-headline font-bold text-[#111318] text-[16px]">Team Health</h3>
            <p className="text-[12px] text-[#6b7280]">
              Team contact rate:{' '}
              <span className={`font-bold ${teamContactRate >= 70 ? 'text-emerald-600' : teamContactRate >= 50 ? 'text-amber-500' : 'text-red-500'}`}>{teamContactRate}%</span>
              {' '}· {totalContacted} of {totalAssigned} leads contacted across all staff
            </p>
          </div>
          <span className={`text-[14px] font-bold px-3 py-1 rounded-full ${teamContactRate >= 70 ? 'bg-emerald-50 text-emerald-700' : teamContactRate >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
            {teamContactRate >= 70 ? 'Healthy' : teamContactRate >= 50 ? 'At Risk' : 'Action Needed'}
          </span>
        </div>
        {accountability.length === 0
          ? <p className="text-[14px] text-[#9ca3af]">No staff yet.</p>
          : (
            <div className="space-y-3">
              {accountability.map((s) => {
                const barColor  = s.contacted_pct >= 70 ? '#10b981' : s.contacted_pct >= 40 ? '#f59e0b' : '#ef4444';
                const textColor = s.contacted_pct >= 70 ? 'text-emerald-600' : s.contacted_pct >= 40 ? 'text-amber-500' : 'text-red-500';
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                      {s.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-[14px] font-semibold text-[#111318] w-32 shrink-0 truncate">{s.name}</span>
                    <div className="flex-1 h-2 bg-[#eceef1] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${s.contacted_pct}%`, background: barColor }} />
                    </div>
                    <span className={`text-[14px] font-bold w-10 text-right shrink-0 ${textColor}`}>{s.contacted_pct}%</span>
                    <span className="text-[11px] text-[#8b929c] w-24 text-right shrink-0 whitespace-nowrap">{s.contacted}/{s.assigned} · {s.won} won</span>
                  </div>
                );
              })}
            </div>
          )}
      </div>

    </div>
  );
}

// ── Sales Manager Dashboard - operational team oversight, staff+lead names OK ─
function ManagerDashboard({ analytics, lineData }: { analytics: Analytics; lineData: any[] }) {
  // Mirrors the sidebar's Calls item and the /calls page: owner/super_admin get
  // permAll, so the card is always there for them.
  const perm = usePermissions();
  const canViewCalls = perm('calls:view_all') || perm('calls:view_own');
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
        {canViewCalls && (
          <StatCard
            label="Calls"
            value={callsValue(analytics.calls_total ?? 0)}
            sub={callsSub(analytics.calls_total ?? 0, analytics.calls_answered ?? 0, analytics.calls_missed ?? 0)}
            icon={Phone}
            onClick={() => navigate('/calls')}
          />
        )}
      </div>

      {/* ── 2. Staff Performance + Untouched by Staff ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="mb-4">
            <h3 className="font-headline font-bold text-[#111318] text-[16px]">Staff Performance</h3>
            <p className="text-[12px] text-[#6b7280]">Assigned · Contacted · Won - all time</p>
          </div>
          {accountability.length === 0
            ? <p className="text-[14px] text-[#9ca3af]">No staff yet.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="text-[11px] text-[#9ca3af] font-semibold uppercase border-b border-black/5">
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
                              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                {s.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                              <span className="font-semibold text-[#111318] truncate">{s.name}</span>
                            </div>
                          </td>
                          <td className="text-right px-1 font-bold text-[#111318]">{s.assigned}</td>
                          <td className={`text-right px-1 font-bold ${textColor}`}>
                            {s.contacted}/{s.assigned}
                            <span className="text-[11px] ml-0.5 font-normal">({s.contacted_pct}%)</span>
                          </td>
                          <td className="text-right px-1 font-bold text-emerald-600">{s.won}</td>
                          <td className="px-1">
                            <div className="h-1.5 bg-[#eceef1] rounded-full overflow-hidden">
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
            <h3 className="font-headline font-bold text-[#111318] text-[16px]">Untouched Leads - by Staff</h3>
            <p className="text-[12px] text-[#6b7280]">Assigned but never contacted - who needs to act?</p>
          </div>
          {untouchedByStaff.length === 0
            ? <p className="text-[14px] text-emerald-600 font-medium">All leads contacted by their assigned staff ✓</p>
            : (
              <div className="space-y-2.5">
                {untouchedByStaff.map((s, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="text-[14px] font-semibold text-[#111318] w-24 shrink-0 truncate">{s.name}</span>
                    <div className="flex-1 h-7 bg-[#eceef1] rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-red-400 rounded-lg flex items-center justify-end pr-2"
                        style={{ width: s.assigned > 0 ? `${Math.max((s.untouched / s.assigned) * 100, 10)}%` : '0%', minWidth: '2.5rem' }}
                      >
                        <span className="text-white text-[12px] font-bold">{s.untouched}</span>
                      </div>
                    </div>
                    <span className="text-[11px] text-[#8b929c] w-16 text-right shrink-0 whitespace-nowrap">of {s.assigned}</span>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>

      {/* ── 3. Pipeline Health + Today's Follow-ups ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5">
          <PipelineFunnelVisual funnels={analytics.pipeline_funnels} title="Pipeline Health" subtitle="Stage distribution with drop-off" />
        </div>

        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-headline font-bold text-[#111318] text-[16px]">Team's Follow-ups Today</h3>
              <p className="text-[12px] text-[#6b7280]">
                <span className="font-bold text-[#111318]">{analytics.today_followups.length}</span> due ·{' '}
                <span className="font-bold text-red-500">{analytics.overdue_followups}</span> overdue
              </p>
            </div>
            <button onClick={() => navigate('/lead-management/followups')} className="text-[12px] text-primary font-semibold hover:opacity-70">View all →</button>
          </div>
          {analytics.today_followups.length === 0
            ? <p className="text-[14px] text-[#9ca3af]">No follow-ups due today.</p>
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
                        <p className="text-[14px] font-semibold text-[#111318] truncate">{f.lead_name}</p>
                        <p className="text-[11px] text-[#6b7280] truncate">{f.title}</p>
                      </div>
                      <span className={`text-[11px] shrink-0 font-medium whitespace-nowrap ${overdue ? 'text-red-500' : 'text-[#6b7280]'}`}>
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
            <h3 className="font-headline font-bold text-[#111318] text-[16px]">Lead Inflow</h3>
            <p className="text-[12px] text-[#6b7280]">{rangeLabel}</p>
          </div>
          <span className="text-[15px] font-bold text-[#111318]">{analytics.range_leads ?? 0} leads</span>
        </div>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={lineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eceef1" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(lineData.length / 6))} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="leads" stroke={brandHex()} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Staff Dashboard - personal task view, individual lead names appropriate ────
function StaffDashboard({ analytics }: { analytics: Analytics }) {
  const navigate = useNavigate();
  // Mirrors the sidebar's Calls item and the /calls page: owner/super_admin get
  // permAll, so the card is always there for them.
  const perm = usePermissions();
  const canViewCalls = perm('calls:view_all') || perm('calls:view_own');
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
        {canViewCalls && (
          <StatCard
            label="My Calls"
            value={callsValue(analytics.calls_total ?? 0)}
            sub={callsSub(analytics.calls_total ?? 0, analytics.calls_answered ?? 0, analytics.calls_missed ?? 0)}
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
              <h3 className="font-headline font-bold text-[#111318] text-[16px]">My Follow-ups</h3>
              <p className="text-[12px] text-[#6b7280]">Today's action list - your personal tasks</p>
            </div>
            <button onClick={() => navigate('/lead-management/followups')} className="text-[12px] text-primary font-semibold hover:opacity-80 transition-opacity">
              View all →
            </button>
          </div>
          {analytics.today_followups.length === 0
            ? <p className="text-[14px] text-[#9ca3af]">No follow-ups due today. All clear!</p>
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
                        <p className="text-[14px] font-semibold text-[#111318] truncate">{f.lead_name}</p>
                        <p className="text-[11px] text-[#6b7280] truncate">{f.title}{f.description ? ` · ${f.description}` : ''}</p>
                      </div>
                      <span className={`text-[11px] shrink-0 font-medium ${isOverdue ? 'text-red-500' : 'text-[#6b7280]'}`}>
                        {formatDistanceToNow(new Date(f.due_at), { addSuffix: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        <div className="bg-white rounded-2xl border border-black/5 card-shadow p-5">
          <h3 className="font-headline font-bold text-[#111318] text-[16px] mb-3">My Numbers</h3>
          <div className="grid grid-cols-1 gap-2.5">
            <div className="rounded-xl bg-[var(--app-bg)] px-4 py-3">
              <p className="text-[12px] text-[#6b7280] mb-0.5">Total Leads</p>
              <p className="font-headline text-[22px] font-bold text-[#111318]">{analytics.total_leads}</p>
            </div>
            <div className="rounded-xl bg-[var(--app-bg)] px-4 py-3">
              <p className="text-[12px] text-[#6b7280] mb-0.5">{analytics.range_label ?? 'This Period'}</p>
              <p className="font-headline text-[22px] font-bold text-[#111318]">{analytics.range_leads ?? 0}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 px-4 py-3">
              <p className="text-[12px] text-emerald-600 mb-0.5">Converted</p>
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
  const level          = useUserLevel();
  const navigate       = useNavigate();
  // The dashboard has no list of its own, so its navbar search does a global lead
  // lookup: pressing Enter jumps to the Leads page filtered by the query.
  useHeaderSearch('Search leads by name or phone', {
    onSubmit: (q) => { const t = q.trim(); if (t) navigate(`/leads?search=${encodeURIComponent(t)}`); },
  });

  const [analytics,  setAnalytics]  = useState<Analytics | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [range,      setRange]      = useState('this_week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  // Lead-count time series for the growth chart - server-side & view-scoped, so
  // the chart no longer iterates every lead in the store.
  const [timeline, setTimeline] = useState<{ daily: Record<string, number>; hourly: Record<string, number> }>({ daily: {}, hourly: {} });

  const apiUrl = useMemo(() => {
    if (range === 'custom' && customFrom && customTo) {
      return `/api/dashboard/analytics?range=custom&from=${customFrom}&to=${customTo}`;
    }
    return `/api/dashboard/analytics?range=${range}`;
  }, [range, customFrom, customTo]);

  useEffect(() => {
    if (range === 'custom' && (!customFrom || !customTo)) return;
    // Show the skeleton only on the first load; on date/filter changes keep the
    // current data visible while the new data loads (no loading flash).
    if (!analytics) setLoading(true);
    api.get<Analytics>(apiUrl)
      .then((r) => setAnalytics(r))
      .catch(() => null)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  useEffect(() => {
    if (range === 'custom' && (!customFrom || !customTo)) return;
    const tlUrl = range === 'custom' && customFrom && customTo
      ? `/api/dashboard/lead-timeline?range=custom&from=${customFrom}&to=${customTo}`
      : `/api/dashboard/lead-timeline?range=${range}`;
    api.get<{ daily: Record<string, number>; hourly: Record<string, number> }>(tlUrl)
      .then((r) => setTimeline({ daily: r.daily ?? {}, hourly: r.hourly ?? {} }))
      .catch(() => setTimeline({ daily: {}, hourly: {} }));
  }, [apiUrl]);

  // Live refresh: when a lead is created/updated/deleted anywhere (realtime socket,
  // manual add, import), re-pull the analytics + timeline so the dashboard reflects
  // it immediately - no page reload needed. Debounced to coalesce bursts (e.g. import).
  useEffect(() => {
    if (range === 'custom' && (!customFrom || !customTo)) return;
    const socket = getSocket();
    const tlUrl = range === 'custom' && customFrom && customTo
      ? `/api/dashboard/lead-timeline?range=custom&from=${customFrom}&to=${customTo}`
      : `/api/dashboard/lead-timeline?range=${range}`;
    let t: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        api.get<Analytics>(apiUrl).then((r) => setAnalytics(r)).catch(() => null);
        api.get<{ daily: Record<string, number>; hourly: Record<string, number> }>(tlUrl)
          .then((r) => setTimeline({ daily: r.daily ?? {}, hourly: r.hourly ?? {} }))
          .catch(() => null);
      }, 800);
    };
    const events = ['lead:created', 'lead:updated', 'lead:deleted', 'data:changed'];
    events.forEach((e) => socket.on(e, refresh));
    return () => { if (t) clearTimeout(t); events.forEach((e) => socket.off(e, refresh)); };
  }, [apiUrl, range, customFrom, customTo]);

  const lineData = useMemo(() => {
    const today = startOfDay(new Date());
    const dayCount  = (d: Date) => timeline.daily[format(startOfDay(d), 'yyyy-MM-dd')] ?? 0;
    const hourCount = (h: number) => timeline.hourly[String(h)] ?? 0;
    const sumDaily  = (fromD: Date, toD: Date) => {
      let n = 0;
      for (let d = startOfDay(fromD); d <= toD; d = addDays(d, 1)) n += dayCount(d);
      return n;
    };

    if (range === 'today' || range === 'yesterday') {
      return Array.from({ length: 24 }, (_, h) => ({ day: `${h}:00`, leads: hourCount(h) }));
    }

    if (range === 'this_week') {
      const now = new Date();
      const dow  = now.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      const weekStart = startOfDay(addDays(today, diff));
      return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        return { day: format(d, 'EEE'), leads: d > now ? 0 : dayCount(d) };
      });
    }

    if (range === 'this_month') {
      const dim = getDaysInMonth(today);
      return Array.from({ length: dim }, (_, i) => {
        const day = new Date(today.getFullYear(), today.getMonth(), i + 1);
        return { day: String(i + 1), leads: dayCount(day) };
      });
    }

    if (range === 'custom' && customFrom && customTo) {
      const fromDate  = startOfDay(new Date(customFrom));
      const toDate    = startOfDay(new Date(customTo));
      const diffDays  = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
      const numPoints = Math.min(diffDays, 60);
      return Array.from({ length: numPoints }, (_, i) => {
        const d = addDays(fromDate, i);
        return { day: diffDays > 20 ? format(d, 'MMM d') : format(d, 'M/d'), leads: dayCount(d) };
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
        return { day: format(weekStart, 'MMM d'), leads: sumDaily(weekStart, weekEnd > today ? today : weekEnd) };
      });
    }

    if (range === '90d') {
      return Array.from({ length: 13 }, (_, i) => {
        const weekStart = subDays(today, (12 - i) * 7);
        const weekEnd   = addDays(weekStart, 6);
        return { day: format(weekStart, 'MMM d'), leads: sumDaily(weekStart, weekEnd) };
      });
    }

    if (range === 'all') {
      return Array.from({ length: 12 }, (_, i) => {
        const month    = startOfMonth(subMonths(today, 11 - i));
        const monthStr = format(month, 'yyyy-MM');
        const count    = Object.entries(timeline.daily)
          .reduce((n, [k, v]) => (k.startsWith(monthStr) ? n + v : n), 0);
        return { day: format(month, 'MMM'), leads: count };
      });
    }

    return Array.from({ length: 30 }, (_, i) => {
      const day = subDays(today, 29 - i);
      return { day: format(day, 'd'), leads: dayCount(day) };
    });
  }, [timeline, range, customFrom, customTo]);

  // owner → strategic view; manager (staff:manage) → operational view; staff → personal view

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="font-headline text-[22px] font-extrabold tracking-tight text-[#111318] shrink-0">Dashboard</h2>
        <DateFilterBar
          range={range} setRange={setRange}
          customFrom={customFrom} setCustomFrom={setCustomFrom}
          customTo={customTo}     setCustomTo={setCustomTo}
        />
      </div>

      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl px-4 py-3.5 card-shadow border border-[var(--hairline)] h-16 animate-pulse" />
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
        <div className="text-center py-20 text-[#9ca3af] text-[16px]">Could not load dashboard data.</div>
      )}
    </div>
  );
}
