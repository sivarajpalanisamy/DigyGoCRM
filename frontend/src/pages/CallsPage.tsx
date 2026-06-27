import { useEffect, useState, useCallback } from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Download, Play, Pause, Filter, X, Search } from 'lucide-react';
import { api, downloadBlob, fetchBlob } from '@/lib/api';
import { useCrmStore } from '@/store/crmStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  source: string | null;
}

const OUTCOMES = ['ANSWERED', 'MISSED', 'NO_ANSWER', 'REJECTED', 'BUSY', 'IVR_TIMEOUT', 'UNKNOWN'];
const NOT_CONNECTED = new Set(['MISSED', 'NO_ANSWER', 'REJECTED', 'BUSY']);
function outcomeLabel(o: string) {
  return ({ NO_ANSWER: 'Not Answered', IVR_TIMEOUT: 'IVR Timeout' } as Record<string, string>)[o] ?? o;
}
const DIRECTIONS = ['INBOUND', 'OUTBOUND'];

function durLabel(sec: number | null) {
  if (!sec || sec <= 0) return '—';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function dateLabel(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function CallsPage() {
  const { staff } = useCrmStore();

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
  const [showFilters, setShowFilters] = useState(false);

  // Audio
  const [playingId, setPlayingId]   = useState<string | null>(null);
  const [audioUrls, setAudioUrls]   = useState<Record<string, string>>({});

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(LIMIT) });
      if (direction) params.set('direction', direction);
      if (outcome)   params.set('outcome', outcome);
      if (staffName) params.set('staff_name', staffName);
      if (dateFrom)  params.set('date_from', dateFrom);
      if (dateTo)    params.set('date_to', dateTo);
      const data = await api.get<{ calls: CallLog[]; total: number }>(`/api/calls?${params}`);
      setCalls(data.calls);
      setTotal(data.total);
      setPage(pg);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load calls');
    } finally {
      setLoading(false);
    }
  }, [direction, outcome, staffName, dateFrom, dateTo]);

  useEffect(() => { load(1); }, [load]);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (direction) params.set('direction', direction);
      if (outcome)   params.set('outcome', outcome);
      if (staffName) params.set('staff_name', staffName);
      if (dateFrom)  params.set('date_from', dateFrom);
      if (dateTo)    params.set('date_to', dateTo);
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

  const clearFilters = () => {
    setDirection(''); setOutcome(''); setStaffName(''); setDateFrom(''); setDateTo('');
  };

  const activeFilterCount = [direction, outcome, staffName, dateFrom, dateTo].filter(Boolean).length;

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
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-headline font-bold text-[#1c1410]">Call Logs</h1>
          <p className="text-[13px] text-[#7a6b5c] mt-0.5">{total} total calls</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-semibold text-[#1c1410] hover:bg-[#faf0e8] hover:border-primary/30 transition-colors"
        >
          <Download className="w-4 h-4" /> Export Excel
        </button>
      </div>

      {/* Toolbar */}
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
        <div className="bg-white border border-black/[0.07] rounded-2xl p-4 mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
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
            <input className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              placeholder="Search agent..." value={staffName} onChange={(e) => setStaffName(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">From Date</label>
            <input type="date" className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#7a6b5c] mb-1 block">To Date</label>
            <input type="date" className="w-full border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1c1410] bg-white outline-none"
              value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
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
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Direction</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Outcome</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Duration</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Agent</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Date & Time</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Note</th>
                <th className="text-left px-4 py-3 font-semibold text-[#7a6b5c]">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-[#b09e8d]">Loading...</td></tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-16">
                    <PhoneIncoming className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-[14px] font-semibold text-[#7a6b5c]">No calls found</p>
                    <p className="text-[12px] text-[#b09e8d] mt-1">Calls will appear here after Superfone syncs</p>
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
                        <p className="font-semibold text-[#1c1410] truncate max-w-[160px]">{c.lead_name ?? '—'}</p>
                        <p className="text-[11px] text-[#b09e8d]">{c.caller_phone ?? ''}</p>
                      </td>
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
                      <td className="px-4 py-3 text-[#7a6b5c]">{c.staff_name ?? '—'}</td>
                      <td className="px-4 py-3 text-[#7a6b5c]">{dateLabel(c.started_at ?? c.created_at)}</td>
                      <td className="px-4 py-3 max-w-[200px]">
                        {c.notes ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[#1c1410] whitespace-pre-wrap break-words" title={c.notes}>{c.notes}</span>
                            {c.disposition && (
                              <span className="self-start px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700">{c.disposition}</span>
                            )}
                          </div>
                        ) : c.disposition ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700">{c.disposition}</span>
                        ) : (
                          <span className="text-[11px] text-[#b09e8d]">—</span>
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
                        <td colSpan={9} className="px-4 py-2">
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
