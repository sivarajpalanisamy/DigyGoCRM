import { useEffect, useState, useCallback } from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Download, Play, Pause, Filter, X, Search, Phone, PhoneOff, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { api, downloadBlob, fetchBlob } from '@/lib/api';
import { useCrmStore } from '@/store/crmStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell,
} from 'recharts';

interface CallLog {
  id: string;
  cdr_id: number;
  direction: string;
  outcome: string;
  caller_phone: string;
  superfone_number: string;
  duration_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
  staff_name: string | null;
  recording_url: string | null;
  recording_path: string | null;
  recording_downloaded: boolean;
  is_unknown: boolean;
  created_at: string;
  lead_id: string | null;
  lead_name: string | null;
  notes: string | null;
  disposition: string | null;
  disposition_key: string | null;
  source: string | null;
  pipeline_name: string | null;
  stage_name: string | null;
}

interface CallStats {
  kpi: { total: number; answered: number; missed: number; avg_duration: number; unknown_calls: number; outbound: number; inbound: number };
  daily: { date: string; inbound: number; outbound: number }[];
  outcomes: { outcome: string; count: number }[];
  agents: { staff_name: string; total: number; answered: number; missed: number }[];
  dispositions: { disposition_key: string; disposition: string; count: number }[];
  pipelines: { pipeline_name: string; count: number }[];
}

const OUTCOME_COLORS: Record<string, string> = {
  ANSWERED: '#10b981', MISSED: '#ef4444', NO_ANSWER: '#f59e0b', REJECTED: '#f43f5e',
  BUSY: '#8b5cf6', IVR_TIMEOUT: '#6b7280', UNKNOWN: '#9ca3af',
};

const DISPOSITION_STYLES: Record<string, { bg: string; text: string }> = {
  interested:     { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  callback_later: { bg: 'bg-blue-50',     text: 'text-blue-700' },
  not_reachable:  { bg: 'bg-amber-50',    text: 'text-amber-700' },
  not_interested: { bg: 'bg-gray-100',    text: 'text-gray-600' },
  hot_lead:       { bg: 'bg-orange-50',   text: 'text-orange-700' },
  deal_closed:    { bg: 'bg-purple-50',   text: 'text-purple-700' },
};

const DISPOSITION_CHART_COLORS: Record<string, string> = {
  interested: '#10b981', callback_later: '#3b82f6', not_reachable: '#f59e0b',
  not_interested: '#6b7280', hot_lead: '#f97316', deal_closed: '#8b5cf6',
};

const tooltipStyle = { borderRadius: 10, border: 'none', background: '#1c1410', color: '#fff', fontSize: 11 };

const OUTCOMES = ['ANSWERED', 'MISSED', 'NO_ANSWER', 'REJECTED', 'BUSY', 'IVR_TIMEOUT', 'UNKNOWN'];
const NOT_CONNECTED = new Set(['MISSED', 'NO_ANSWER', 'REJECTED', 'BUSY']);
function outcomeLabel(o: string) {
  return ({ NO_ANSWER: 'Not Answered', IVR_TIMEOUT: 'IVR Timeout' } as Record<string, string>)[o] ?? o;
}
const DIRECTIONS = ['INBOUND', 'OUTBOUND'];

function durLabel(sec: number | null) {
  if (!sec || sec <= 0) return '-';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function dateLabel(ts: string | null) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function CallsPage({ source }: { source?: 'mobile' | 'superfone' } = {}) {
  const { staff, pipelines } = useCrmStore();

  const [calls, setCalls] = useState<CallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  // Filters
  const [direction, setDirection] = useState('');
  const [outcome, setOutcome]     = useState('');
  const [staffName, setStaffName] = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [search, setSearch]       = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId]       = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Stats
  const [stats, setStats] = useState<CallStats | null>(null);
  const [showCharts, setShowCharts] = useState(false);
  const [quickDate, setQuickDate] = useState<'today' | 'yesterday' | '7days' | 'month' | ''>('');

  // Audio
  const [playingId, setPlayingId]   = useState<string | null>(null);
  const [audioUrls, setAudioUrls]   = useState<Record<string, string>>({});

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (source)     p.set('source', source);
    if (direction)  p.set('direction', direction);
    if (outcome)    p.set('outcome', outcome);
    if (staffName)  p.set('staff_name', staffName);
    if (dateFrom)   p.set('date_from', dateFrom);
    if (dateTo)     p.set('date_to', dateTo);
    if (pipelineId) p.set('pipeline_id', pipelineId);
    if (stageId)    p.set('stage_id', stageId);
    return p;
  }, [source, direction, outcome, staffName, dateFrom, dateTo, pipelineId, stageId]);

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = buildParams();
      params.set('page', String(pg));
      params.set('limit', String(LIMIT));
      const [data, statsData] = await Promise.all([
        api.get<{ calls: CallLog[]; total: number }>(`/api/calls?${params}`),
        api.get<CallStats>(`/api/calls/stats?${buildParams()}`).catch(() => null),
      ]);
      setCalls(data.calls);
      setTotal(data.total);
      setPage(pg);
      if (statsData) setStats(statsData);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load calls');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { load(1); }, [load]);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (source)     params.set('source', source);
      if (direction)  params.set('direction', direction);
      if (outcome)    params.set('outcome', outcome);
      if (staffName)  params.set('staff_name', staffName);
      if (dateFrom)   params.set('date_from', dateFrom);
      if (dateTo)     params.set('date_to', dateTo);
      if (pipelineId) params.set('pipeline_id', pipelineId);
      if (stageId)    params.set('stage_id', stageId);
      await downloadBlob(`/api/calls/export?${params}`, 'call-logs.xlsx');
      toast.success('Export downloaded');
    } catch (e: any) {
      toast.error(e.message ?? 'Export failed');
    }
  };

  const handlePlay = async (callId: string) => {
    if (playingId === callId) { setPlayingId(null); return; }
    if (audioUrls[callId])   { setPlayingId(callId); return; }
    try {
      const blob = await fetchBlob(`/api/calls/${callId}/recording`);
      const url  = URL.createObjectURL(blob);
      setAudioUrls((prev) => ({ ...prev, [callId]: url }));
      setPlayingId(callId);
    } catch { toast.error('Recording not available'); }
  };

  const applyQuickDate = (key: typeof quickDate) => {
    setQuickDate(key);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (key === 'today') {
      setDateFrom(fmt(today)); setDateTo(fmt(today));
    } else if (key === 'yesterday') {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      setDateFrom(fmt(y)); setDateTo(fmt(y));
    } else if (key === '7days') {
      const w = new Date(today); w.setDate(w.getDate() - 6);
      setDateFrom(fmt(w)); setDateTo(fmt(today));
    } else if (key === 'month') {
      const m = new Date(today.getFullYear(), today.getMonth(), 1);
      setDateFrom(fmt(m)); setDateTo(fmt(today));
    } else {
      setDateFrom(''); setDateTo('');
    }
  };

  const clearFilters = () => {
    setDirection(''); setOutcome(''); setStaffName(''); setDateFrom(''); setDateTo('');
    setPipelineId(''); setStageId(''); setQuickDate('');
  };

  const activeFilterCount = [direction, outcome, staffName, dateFrom, dateTo, pipelineId, stageId].filter(Boolean).length;

  const selectedPipelineStages = pipelineId
    ? pipelines.find((p) => p.id === pipelineId)?.stages ?? []
    : [];

  // Client-side search filter on lead_name / caller_phone
  const visible = search.trim()
    ? calls.filter((c) =>
        (c.lead_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (c.caller_phone ?? '').includes(search)
      )
    : calls;

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[22px] font-headline font-bold text-[#1c1410]">{source === 'superfone' ? 'Superfone Call Logs' : 'Dialer Call Logs'}</h1>
          <p className="text-[13px] text-[#7a6b5c] mt-0.5">{total} total calls</p>
        </div>
        <div className="flex items-center gap-2">
          {([
            ['today', 'Today'],
            ['yesterday', 'Yesterday'],
            ['7days', '7 Days'],
            ['month', 'This Month'],
            ['', 'All'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => applyQuickDate(key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors',
                quickDate === key
                  ? 'bg-primary text-white'
                  : 'bg-white border border-black/10 text-[#7a6b5c] hover:bg-[#faf0e8] hover:border-primary/30'
              )}
            >
              {label}
            </button>
          ))}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-semibold text-[#1c1410] hover:bg-[#faf0e8] hover:border-primary/30 transition-colors ml-2"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-black/10 bg-white text-[13px] text-[#1c1410] outline-none focus:border-primary/40 placeholder:text-gray-400"
            placeholder="Search lead or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl border text-[13px] font-semibold transition-colors',
            showFilters || activeFilterCount > 0
              ? 'bg-primary text-white border-primary'
              : 'bg-white border-black/10 text-[#1c1410] hover:bg-[#faf0e8]'
          )}
        >
          <Filter className="w-4 h-4" />
          Filter {activeFilterCount > 0 && `(${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-[12px] text-[#7a6b5c] hover:text-red-500 transition-colors">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white border border-black/[0.07] rounded-2xl p-4 mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">Direction</label>
            <select className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">All</option>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">Outcome</label>
            <select className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">All</option>
              {OUTCOMES.map((o) => <option key={o} value={o}>{outcomeLabel(o)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">Agent</label>
            <select className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={staffName} onChange={(e) => setStaffName(e.target.value)}>
              <option value="">All Agents</option>
              {staff.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">Pipeline</label>
            <select className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={pipelineId} onChange={(e) => { setPipelineId(e.target.value); setStageId(''); }}>
              <option value="">All Pipelines</option>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">Stage</label>
            <select className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={stageId} onChange={(e) => setStageId(e.target.value)}
              disabled={!pipelineId}>
              <option value="">All Stages</option>
              {selectedPipelineStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">From Date</label>
            <input type="date" className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setQuickDate(''); }} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">To Date</label>
            <input type="date" className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={dateTo} onChange={(e) => { setDateTo(e.target.value); setQuickDate(''); }} />
          </div>
        </div>
      )}

      {/* KPI Cards — always visible */}
      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-black/5 p-3">
            <div className="flex items-center gap-2 mb-0.5">
              <Phone className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[10px] font-medium text-[#7a6b5c]">Total Calls</span>
            </div>
            <p className="text-[20px] font-bold text-[#1c1410]">{stats.kpi.total.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-black/5 p-3">
            <div className="flex items-center gap-2 mb-0.5">
              <PhoneIncoming className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[10px] font-medium text-[#7a6b5c]">Inbound</span>
            </div>
            <p className="text-[20px] font-bold text-emerald-600">{(stats.kpi.inbound ?? 0).toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-black/5 p-3">
            <div className="flex items-center gap-2 mb-0.5">
              <PhoneOutgoing className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[10px] font-medium text-[#7a6b5c]">Outbound</span>
            </div>
            <p className="text-[20px] font-bold text-blue-600">{(stats.kpi.outbound ?? 0).toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-black/5 p-3">
            <div className="flex items-center gap-2 mb-0.5">
              <PhoneIncoming className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[10px] font-medium text-[#7a6b5c]">Answer Rate</span>
            </div>
            <p className="text-[20px] font-bold text-emerald-600">
              {stats.kpi.total ? Math.round((stats.kpi.answered / stats.kpi.total) * 100) : 0}%
            </p>
          </div>
          <div className="bg-white rounded-xl border border-black/5 p-3">
            <div className="flex items-center gap-2 mb-0.5">
              <Clock className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[10px] font-medium text-[#7a6b5c]">Avg Duration</span>
            </div>
            <p className="text-[20px] font-bold text-[#1c1410]">{durLabel(stats.kpi.avg_duration)}</p>
          </div>
          <div className="bg-white rounded-xl border border-black/5 p-3">
            <div className="flex items-center gap-2 mb-0.5">
              <PhoneOff className="w-3.5 h-3.5 text-red-500" />
              <span className="text-[10px] font-medium text-[#7a6b5c]">Missed Calls</span>
            </div>
            <p className="text-[20px] font-bold text-red-600">{stats.kpi.missed.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Analytics toggle */}
      <button
        onClick={() => setShowCharts((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:text-[var(--brand-dark)] mb-3 transition-colors"
      >
        {showCharts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showCharts ? 'Hide Charts' : 'Show Charts'}
      </button>

      {/* Charts — collapsible, default hidden */}
      {showCharts && stats && (
        <div className="space-y-4 mb-4">
          {/* Row 2: Call Volume + Outcome Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Call Volume Trend */}
            <div className="bg-white rounded-xl border border-black/5 p-4">
              <h3 className="text-[13px] font-semibold text-[#1c1410] mb-3">Call Volume Trend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={stats.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" />
                  <XAxis dataKey="date" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false}
                    tickFormatter={(v) => new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                  <YAxis fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="inbound" stroke="#10b981" strokeWidth={2} dot={false} name="Inbound" />
                  <Line type="monotone" dataKey="outbound" stroke="#3b82f6" strokeWidth={2} dot={false} name="Outbound" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Outcome Breakdown */}
            <div className="bg-white rounded-xl border border-black/5 p-4">
              <h3 className="text-[13px] font-semibold text-[#1c1410] mb-3">Outcome Breakdown</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats.outcomes} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" horizontal={false} />
                  <XAxis type="number" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="outcome" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} width={80}
                    tickFormatter={(v) => outcomeLabel(v)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [value, 'Calls']} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                    {stats.outcomes.map((entry) => (
                      <Cell key={entry.outcome} fill={OUTCOME_COLORS[entry.outcome] || '#9ca3af'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 3: Disposition Breakdown + Calls by Pipeline */}
          {((stats.dispositions && stats.dispositions.length > 0) || (stats.pipelines && stats.pipelines.length > 0)) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Disposition Breakdown */}
              {stats.dispositions && stats.dispositions.length > 0 && (
                <div className="bg-white rounded-xl border border-black/5 p-4">
                  <h3 className="text-[13px] font-semibold text-[#1c1410] mb-3">Disposition Breakdown</h3>
                  <ResponsiveContainer width="100%" height={Math.max(160, stats.dispositions.length * 36)}>
                    <BarChart data={stats.dispositions} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" horizontal={false} />
                      <XAxis type="number" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="disposition" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} width={110} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [value, 'Calls']} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                        {stats.dispositions.map((entry) => (
                          <Cell key={entry.disposition_key} fill={DISPOSITION_CHART_COLORS[entry.disposition_key] || '#9ca3af'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Calls by Pipeline */}
              {stats.pipelines && stats.pipelines.length > 0 && (
                <div className="bg-white rounded-xl border border-black/5 p-4">
                  <h3 className="text-[13px] font-semibold text-[#1c1410] mb-3">Calls by Pipeline</h3>
                  <ResponsiveContainer width="100%" height={Math.max(160, stats.pipelines.length * 36)}>
                    <BarChart data={stats.pipelines} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" horizontal={false} />
                      <XAxis type="number" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="pipeline_name" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} width={110} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [value, 'Calls']} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20} fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Row 4: Agent Performance */}
          {stats.agents.length > 0 && (
            <div className="bg-white rounded-xl border border-black/5 p-4">
              <h3 className="text-[13px] font-semibold text-[#1c1410] mb-3">Agent Performance</h3>
              <ResponsiveContainer width="100%" height={Math.max(160, stats.agents.length * 36)}>
                <BarChart data={stats.agents} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ece8" horizontal={false} />
                  <XAxis type="number" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="staff_name" fontSize={10} fill="#8a7c6e" axisLine={false} tickLine={false} width={120} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="answered" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} barSize={20} name="Answered" />
                  <Bar dataKey="missed" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20} name="Missed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 bg-white border border-black/[0.07] rounded-2xl overflow-hidden flex flex-col min-h-0">
        <div className="overflow-auto flex-1">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-[var(--app-bg)] border-b border-black/[0.07] z-10">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c] w-10">#</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Lead</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Pipeline</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Stage</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Direction</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Outcome</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Duration</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Agent</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Disposition</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Date & Time</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Note</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {loading ? (
                <tr><td colSpan={12} className="text-center py-12 text-[#b09e8d]">Loading...</td></tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-16">
                    <PhoneIncoming className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-[14px] font-semibold text-[#7a6b5c]">No calls found</p>
                    <p className="text-[12px] text-[#b09e8d] mt-1">{source === 'superfone' ? 'Calls will appear here after Superfone syncs' : 'Calls will appear here once the Hawcus Dialer app syncs'}</p>
                  </td>
                </tr>
              ) : visible.map((c, idx) => {
                const isAnswered    = c.outcome === 'ANSWERED';
                const notConnected  = NOT_CONNECTED.has(c.outcome);
                const isOutbound    = c.direction === 'OUTBOUND';
                const DirIcon    = isOutbound ? PhoneOutgoing : notConnected ? PhoneMissed : PhoneIncoming;
                const dirColor   = isOutbound ? 'text-blue-500' : notConnected ? 'text-red-500' : 'text-emerald-500';
                const hasRec     = !!(c.recording_path || c.recording_url);

                return (
                  <>
                    <tr key={c.id} className="hover:bg-[var(--app-bg)] transition-colors">
                      <td className="px-4 py-3 text-[#b09e8d]">{(page - 1) * LIMIT + idx + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#1c1410] truncate max-w-[160px]">{c.lead_name ?? '-'}</p>
                        <p className="text-[11px] text-[#b09e8d]">{c.caller_phone ?? ''}</p>
                      </td>
                      <td className="px-4 py-3 text-[#7a6b5c]">{c.pipeline_name ?? '-'}</td>
                      <td className="px-4 py-3 text-[#7a6b5c]">{c.stage_name ?? '-'}</td>
                      <td className="px-4 py-3">
                        <span className={cn('flex items-center gap-1.5 font-medium', dirColor)}>
                          <DirIcon className="w-4 h-4 shrink-0" />
                          {isOutbound ? 'Outbound' : 'Inbound'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-semibold',
                          isAnswered   ? 'bg-emerald-50 text-emerald-700' :
                          notConnected ? 'bg-red-50 text-red-600' :
                                         'bg-amber-50 text-amber-700'
                        )}>{outcomeLabel(c.outcome)}</span>
                      </td>
                      <td className="px-4 py-3 text-[#7a6b5c] font-medium">{durLabel(c.duration_seconds)}</td>
                      <td className="px-4 py-3 text-[#7a6b5c]">{c.staff_name ?? '-'}</td>
                      <td className="px-4 py-3">
                        {c.disposition_key ? (() => {
                          const s = DISPOSITION_STYLES[c.disposition_key!] ?? { bg: 'bg-orange-50', text: 'text-orange-700' };
                          return <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-semibold', s.bg, s.text)}>{c.disposition ?? c.disposition_key}</span>;
                        })() : c.disposition ? (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-orange-50 text-orange-700">{c.disposition}</span>
                        ) : (
                          <span className="text-[11px] text-[#b09e8d]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#7a6b5c]">{dateLabel(c.started_at ?? c.created_at)}</td>
                      <td className="px-4 py-3 max-w-[200px]">
                        {c.notes ? (
                          <span className="text-[#1c1410] whitespace-pre-wrap break-words line-clamp-2" title={c.notes}>{c.notes}</span>
                        ) : (
                          <span className="text-[11px] text-[#b09e8d]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {hasRec ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePlay(c.id)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 text-[11px] font-semibold transition-colors"
                            >
                              {playingId === c.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              {playingId === c.id ? 'Stop' : 'Play'}
                            </button>
                            <button
                              onClick={() => downloadBlob(`/api/calls/${c.id}/download`, `call-${c.cdr_id}.mp3`)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#b09e8d]">No recording</span>
                        )}
                      </td>
                    </tr>
                    {playingId === c.id && audioUrls[c.id] && (
                      <tr key={`${c.id}-audio`} className="bg-orange-50/50">
                        <td colSpan={12} className="px-4 py-2">
                          <audio
                            src={audioUrls[c.id]}
                            autoPlay
                            controls
                            className="w-full h-8"
                            onEnded={() => setPlayingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05] bg-[var(--app-bg)]">
            <span className="text-[12px] text-[#7a6b5c]">
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => load(page - 1)}
                className="px-3 py-1.5 rounded-lg border border-black/10 text-[12px] font-semibold text-[#1c1410] disabled:opacity-40 hover:bg-[#faf0e8] transition-colors"
              >Prev</button>
              <span className="text-[12px] text-[#7a6b5c]">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => load(page + 1)}
                className="px-3 py-1.5 rounded-lg border border-black/10 text-[12px] font-semibold text-[#1c1410] disabled:opacity-40 hover:bg-[#faf0e8] transition-colors"
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
