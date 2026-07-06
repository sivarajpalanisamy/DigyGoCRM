import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Facebook, FileText, Users, Zap, ChevronDown, ChevronUp,
  Search, ArrowRight, Clock, Copy, Check, ExternalLink, RefreshCw,
  TrendingUp, Star,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatDistanceToNow, format } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { brandHex } from '@/lib/brand';

// ── Types ─────────────────────────────────────────────────────────────────────
interface FormRow {
  id: string;
  name: string;
  channel: 'meta' | 'custom';
  status: string;
  page_name: string | null;
  slug: string | null;
  leads_today: number;
  leads_week: number;
  leads_month: number;
  leads_total: number;
  last_lead_at: string | null;
}

interface Overview {
  summary: {
    total_leads: number;
    active_forms_count: number;
    leads_today: number;
    best_form: { name: string; channel: string; count: number } | null;
  };
  dead_forms: Array<{ id: string; name: string; channel: string; last_lead_at: string | null }>;
  forms: FormRow[];
}

interface SparklineData {
  sparkline: Array<{ day: string; count: number }>;
  recent_leads: Array<{ id: string; name: string; phone: string; email: string; created_at: string }>;
}

type SortKey = 'leads_month' | 'leads_week' | 'leads_today' | 'last_lead_at' | 'name';

// ── Helpers ───────────────────────────────────────────────────────────────────
function lastLeadLabel(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
}

function statusBadge(channel: 'meta' | 'custom', status: string) {
  if (channel === 'meta') {
    const s = (status ?? 'ACTIVE').toUpperCase();
    if (s === 'ACTIVE')   return { label: 'Active',   cls: 'bg-emerald-50 text-emerald-600' };
    if (s === 'ARCHIVED') return { label: 'Archived', cls: 'bg-amber-50 text-amber-600' };
    if (s === 'DRAFT')    return { label: 'Draft',    cls: 'bg-blue-50 text-blue-500' };
    if (s === 'DELETED')  return { label: 'Deleted',  cls: 'bg-red-50 text-red-500' };
    return { label: s, cls: 'bg-gray-100 text-gray-500' };
  }
  return status === 'active'
    ? { label: 'Published', cls: 'bg-emerald-50 text-emerald-600' }
    : { label: 'Inactive',  cls: 'bg-gray-100 text-gray-400' };
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, accent = false }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: boolean;
}) {
  if (accent) return (
    <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-white"
      style={{ background: 'linear-gradient(135deg,var(--brand-dark) 0%,var(--brand) 55%,var(--brand-light) 100%)', boxShadow: '0 4px 20px rgba(234,88,12,0.2)' }}>
      <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] opacity-75 truncate">{label}</p>
        <h3 className="font-headline text-[22px] font-bold leading-tight">{value}</h3>
        {sub && <p className="text-[10px] opacity-65 truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  );
  return (
    <div className="bg-white rounded-xl px-4 py-3 flex items-center gap-3 card-shadow border border-black/5">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-[#7a6b5c] truncate">{label}</p>
        <h3 className="font-headline text-[22px] font-bold text-[#1c1410] leading-tight">{value}</h3>
        {sub && <p className="text-[10px] text-[#9a8a7a] truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Expanded row (sparkline + recent leads) ───────────────────────────────────
type SparkPeriod = '7d' | 'month' | 'all';
const SPARK_PERIODS: { value: SparkPeriod; label: string }[] = [
  { value: '7d',    label: 'Last 7 Days' },
  { value: 'month', label: 'This Month'  },
  { value: 'all',   label: 'All Time'    },
];

function ExpandedRow({ form }: { form: FormRow }) {
  const navigate = useNavigate();
  const [copied,  setCopied]  = useState(false);
  const [period,  setPeriod]  = useState<SparkPeriod>('7d');
  const [data,    setData]    = useState<SparklineData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    const params = form.channel === 'meta'
      ? `channel=meta&id=${encodeURIComponent(form.id)}&period=${period}`
      : `channel=custom&id=${encodeURIComponent(form.id)}&name=${encodeURIComponent(form.name)}&period=${period}`;
    api.get<SparklineData>(`/api/lead-generation/sparkline?${params}`)
      .then(d => setData(d))
      .catch(() => setData({ sparkline: [], recent_leads: [] }))
      .finally(() => setLoading(false));
  }, [form.id, form.channel, form.name, period]);

  const copyLink = () => {
    const url = `${window.location.origin}/f/${form.slug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const tickFmt = (v: string) => {
    try {
      const d = new Date(v);
      if (period === 'all')   return format(d, 'MMM yy');
      if (period === 'month') return format(d, 'd');
      return format(d, 'EEE');
    } catch { return v; }
  };

  const tooltipFmt = (v: string) => {
    try {
      const d = new Date(v);
      if (period === 'all')   return format(d, 'MMM yyyy');
      return format(d, 'dd MMM');
    } catch { return v; }
  };

  const maxCount = data ? Math.max(...data.sparkline.map(d => d.count), 1) : 1;
  const hasData  = data && data.sparkline.some(d => d.count > 0);

  return (
    <div className="px-4 py-4 bg-[var(--app-bg)] border-t border-black/[0.06]">
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">

        {/* Sparkline */}
        <div className="bg-white rounded-xl border border-black/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider">Lead Inflow</p>
            {/* Period picker */}
            <div className="flex items-center gap-1 bg-[#f5f0eb] rounded-lg p-0.5">
              {SPARK_PERIODS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                    period === opt.value
                      ? 'bg-white text-[#1c1410] shadow-sm'
                      : 'text-[#9a8a7a] hover:text-[#1c1410]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="h-[100px] bg-[#f5f0eb] rounded-lg animate-pulse" />
          ) : !hasData ? (
            <p className="text-[13px] text-[#b09e8d] py-6 text-center">No leads in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={data!.sparkline} barSize={period === 'all' ? 18 : period === 'month' ? 8 : 20}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 9, fill: '#9a8a7a' }}
                  tickFormatter={tickFmt}
                  axisLine={false} tickLine={false}
                  interval={period === 'month' ? Math.floor((data!.sparkline.length) / 6) : 0}
                />
                <YAxis hide allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 }}
                  labelFormatter={tooltipFmt}
                  formatter={(v) => [v, 'Leads']}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {data!.sparkline.map((entry, i) => (
                    <Cell key={i} fill={entry.count > 0 ? brandHex() : '#f0ece8'} />
                  ))}
                  <LabelList
                    dataKey="count"
                    position="top"
                    formatter={(v: number) => (v > 0 ? v : '')}
                    style={{ fontSize: 10, fontWeight: 700, fill: '#1c1410' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent leads */}
        <div className="bg-white rounded-xl border border-black/5 p-4">
          <p className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-3">Recent Leads</p>
          {!data ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-8 bg-[#f5f0eb] rounded-lg animate-pulse" />)}
            </div>
          ) : data.recent_leads.length === 0 ? (
            <p className="text-[13px] text-[#b09e8d] py-4 text-center">No leads yet from this form.</p>
          ) : (
            <div className="space-y-1.5">
              {data.recent_leads.map(lead => (
                <div
                  key={lead.id}
                  onClick={() => navigate('/leads')}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--app-bg)] transition-colors cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand-light))' }}>
                    {(lead.name ?? '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#1c1410] truncate">{lead.name}</p>
                    <p className="text-[10px] text-[#9a8a7a] truncate">{lead.phone || lead.email || '-'}</p>
                  </div>
                  <span className="text-[10px] text-[#b09e8d] shrink-0 whitespace-nowrap">
                    {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button onClick={() => navigate('/leads')} className="flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:opacity-70 transition-opacity">
          <ExternalLink className="w-3.5 h-3.5" /> View Leads
        </button>
        {form.channel === 'custom' && form.slug && (
          <button onClick={copyLink} className="flex items-center gap-1.5 text-[13px] font-semibold text-[#7a6b5c] hover:text-primary transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        )}
        {form.channel === 'meta' && (
          <button onClick={() => navigate('/lead-generation/meta-forms')} className="flex items-center gap-1.5 text-[13px] font-semibold text-[#7a6b5c] hover:text-primary transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Meta Forms
          </button>
        )}
        {form.channel === 'custom' && (
          <button onClick={() => navigate('/lead-generation/custom-forms')} className="flex items-center gap-1.5 text-[13px] font-semibold text-[#7a6b5c] hover:text-primary transition-colors">
            <ArrowRight className="w-3.5 h-3.5" /> Edit Form
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sort header button ────────────────────────────────────────────────────────
function SortBtn({ col, current, dir, onSort, children }: {
  col: SortKey; current: SortKey; dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void; children: React.ReactNode;
}) {
  const active = col === current;
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${active ? 'text-primary' : 'text-[#b09e8d] hover:text-[#7a6b5c]'}`}
    >
      {children}
      {active && (dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LeadGenerationPage() {
  const navigate = useNavigate();

  const [overview,   setOverview]   = useState<Overview | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState<'all' | 'meta' | 'custom'>('all');
  const [search,     setSearch]     = useState('');
  const [sortBy,     setSortBy]     = useState<SortKey>('leads_month');
  const [sortDir,    setSortDir]    = useState<'asc' | 'desc'>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Overview>('/api/lead-generation/overview')
      .then(d => setOverview(d))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(key); setSortDir('desc'); }
  };

  const handleExpand = (form: FormRow) => {
    setExpandedId(id => id === form.id ? null : form.id);
  };

  const filteredForms = useMemo(() => {
    if (!overview) return [];
    let rows = overview.forms;
    if (tab !== 'all') rows = rows.filter(f => f.channel === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(f =>
        f.name.toLowerCase().includes(q) ||
        (f.page_name ?? '').toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      let av: any = a[sortBy as keyof FormRow] ?? '';
      let bv: any = b[sortBy as keyof FormRow] ?? '';
      if (sortBy === 'last_lead_at') {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      }
      if (av < bv) return sortDir === 'desc' ? 1 : -1;
      if (av > bv) return sortDir === 'desc' ? -1 : 1;
      return 0;
    });
  }, [overview, tab, search, sortBy, sortDir]);

  const { summary } = overview ?? { summary: null };

  const tabCounts = useMemo(() => ({
    all:    overview?.forms.length ?? 0,
    meta:   overview?.forms.filter(f => f.channel === 'meta').length ?? 0,
    custom: overview?.forms.filter(f => f.channel === 'custom').length ?? 0,
  }), [overview]);

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-headline text-[22px] font-extrabold tracking-tight text-[#1c1410]">Lead Generation</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/lead-generation/meta-forms')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-semibold text-[#1c1410] hover:border-primary/40 transition-colors shadow-sm"
          >
            <Facebook className="w-3.5 h-3.5 text-blue-500" /> Meta Forms
          </button>
          <button
            onClick={() => navigate('/lead-generation/custom-forms')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-semibold text-white transition-colors shadow-sm"
            style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand-light))' }}
          >
            <FileText className="w-3.5 h-3.5" /> New Form
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl px-4 py-3 h-16 animate-pulse border border-black/5 card-shadow" />
          ))}
        </div>
      ) : summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Total Leads"   value={summary.total_leads}        sub="All sources, all time" icon={Users}      accent />
          <KpiCard label="Active Forms"  value={summary.active_forms_count} sub="Meta + Custom"         icon={FileText}   accent />
          <KpiCard label="Leads Today"   value={summary.leads_today}        sub="Across all forms"      icon={TrendingUp} accent />
          <KpiCard
            label="Best This Month"
            value={summary.best_form ? summary.best_form.name : '-'}
            sub={summary.best_form ? `${summary.best_form.count} leads` : 'No data yet'}
            icon={Star}
            accent
          />
        </div>
      )}


      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 pt-4 pb-3 border-b border-black/[0.06]">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-[#f5f0eb] rounded-lg p-0.5">
            {(['all', 'meta', 'custom'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-[13px] font-semibold transition-colors capitalize ${
                  tab === t ? 'bg-white text-[#1c1410] shadow-sm' : 'text-[#7a6b5c] hover:text-[#1c1410]'
                }`}
              >
                {t === 'all' ? 'All' : t === 'meta' ? 'Meta Forms' : 'Custom Forms'}
                <span className="ml-1.5 text-[10px] text-[#b09e8d]">
                  {tabCounts[t]}
                </span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b09e8d]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search forms…"
              className="w-full pl-8 pr-3 py-1.5 text-[13px] border border-black/10 rounded-lg outline-none focus:border-primary/40 bg-white"
            />
          </div>

          <button onClick={load} className="ml-auto text-[#b09e8d] hover:text-primary transition-colors shrink-0">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[2fr_1fr_60px_60px_80px_110px_40px] gap-2 items-center px-4 py-2 border-b border-black/[0.04] bg-[var(--app-bg)]">
          <SortBtn col="name"         current={sortBy} dir={sortDir} onSort={handleSort}>Form</SortBtn>
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#b09e8d]">Status</span>
          <SortBtn col="leads_today"  current={sortBy} dir={sortDir} onSort={handleSort}>Today</SortBtn>
          <SortBtn col="leads_week"   current={sortBy} dir={sortDir} onSort={handleSort}>Week</SortBtn>
          <SortBtn col="leads_month"  current={sortBy} dir={sortDir} onSort={handleSort}>Month</SortBtn>
          <SortBtn col="last_lead_at" current={sortBy} dir={sortDir} onSort={handleSort}>Last Lead</SortBtn>
          <span />
        </div>

        {/* Rows */}
        {loading ? (
          <div className="divide-y divide-black/[0.04]">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 h-4 bg-[#f0ece8] rounded animate-pulse" />
                <div className="w-16 h-4 bg-[#f0ece8] rounded animate-pulse" />
                <div className="w-10 h-4 bg-[#f0ece8] rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : filteredForms.length === 0 ? (
          <div className="py-16 text-center">
            <Zap className="w-8 h-8 text-[#e8d5c4] mx-auto mb-2" />
            <p className="text-[14px] text-[#b09e8d]">
              {search ? 'No forms match your search.' : 'No forms yet - connect Meta or create a custom form.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {filteredForms.map(form => {
              const badge    = statusBadge(form.channel, form.status);
              const expanded = expandedId === form.id;

              return (
                <div key={form.id}>
                  <div
                    onClick={() => handleExpand(form)}
                    className="grid grid-cols-[2fr_1fr_60px_60px_80px_110px_40px] gap-2 items-center px-4 py-3 hover:bg-[var(--app-bg)] cursor-pointer transition-colors"
                  >
                    {/* Name + channel */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${form.channel === 'meta' ? 'bg-blue-50' : 'bg-primary/10'}`}>
                        {form.channel === 'meta'
                          ? <Facebook className="w-3.5 h-3.5 text-blue-500" />
                          : <FileText  className="w-3.5 h-3.5 text-primary" />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-[#1c1410] truncate">
                          {form.name}
                        </p>
                        {form.page_name && (
                          <p className="text-[10px] text-[#9a8a7a] truncate">{form.page_name}</p>
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold w-fit ${badge.cls}`}>
                      {badge.label}
                    </span>

                    {/* Counts */}
                    <span className="text-[14px] font-semibold text-[#1c1410] text-right">{form.leads_today}</span>
                    <span className="text-[14px] font-semibold text-[#1c1410] text-right">{form.leads_week}</span>
                    <span className="text-[14px] font-bold text-primary text-right">{form.leads_month}</span>

                    {/* Last lead */}
                    <span className="text-[11px] truncate flex items-center gap-1 text-[#9a8a7a]">
                      {form.last_lead_at && <Clock className="w-3 h-3 shrink-0" />}
                      {lastLeadLabel(form.last_lead_at)}
                    </span>

                    {/* Expand toggle */}
                    {expanded
                      ? <ChevronUp className="w-4 h-4 text-[#b09e8d] justify-self-end" />
                      : <ChevronDown className="w-4 h-4 text-[#b09e8d] justify-self-end" />
                    }
                  </div>

                  {expanded && <ExpandedRow form={form} />}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer count */}
        {!loading && filteredForms.length > 0 && (
          <div className="px-4 py-2.5 border-t border-black/[0.04] bg-[var(--app-bg)]">
            <p className="text-[11px] text-[#b09e8d]">
              {filteredForms.length} form{filteredForms.length !== 1 ? 's' : ''}
              {search ? ` matching "${search}"` : ''}
            </p>
          </div>
        )}
      </div>

      {/* ── Quick links ── */}
      {!loading && overview?.forms.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            {
              label: 'Connect Meta Forms',
              desc: 'Sync leads from Facebook & Instagram ad forms automatically.',
              icon: Facebook, iconCls: 'bg-blue-50 text-blue-500',
              path: '/lead-generation/meta-forms', cta: 'Connect Now',
            },
            {
              label: 'Create Custom Form',
              desc: 'Build forms with drag-and-drop. Embed anywhere or share as a link.',
              icon: FileText, iconCls: 'bg-primary/10 text-primary',
              path: '/lead-generation/custom-forms', cta: 'Create Form',
            },
          ].map(item => (
            <div
              key={item.label}
              onClick={() => navigate(item.path)}
              className="group bg-white rounded-2xl border border-black/5 card-shadow p-5 flex flex-col gap-3 cursor-pointer hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.iconCls}`}>
                <item.icon className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-[#1c1410] text-[15px]">{item.label}</h4>
                <p className="text-[13px] text-[#7a6b5c] mt-1 leading-relaxed">{item.desc}</p>
              </div>
              <div className="flex items-center gap-1 text-[13px] font-semibold text-primary mt-auto">
                {item.cta} <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
