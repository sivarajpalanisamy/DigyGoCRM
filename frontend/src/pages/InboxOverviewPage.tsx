import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Send, Inbox, Users, MessageSquare,
  TrendingUp, TrendingDown, Search, ChevronLeft, ChevronRight,
  RefreshCw, ArrowUpRight, ArrowDownLeft,
} from 'lucide-react';
import {
  ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { brandHex } from '@/lib/brand';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Analytics {
  sent:      { value: number; prev: number };
  received:  { value: number; prev: number };
  contacts:  { value: number; prev: number };
  replyRate: { value: number; totalInbound: number; replied: number };
}
interface VolumePoint { date: string; sent: number; received: number; }
interface TopContact  { contact_name: string; phone: string; total: number; sent: number; received: number; }
interface LogRow {
  id: string; sender: string; body: string; created_at: string;
  wa_account: string; remote_jid: string; status: string; type: string;
  contact_name: string; contact_phone: string; sent_by?: string;
}

// ── Periods ────────────────────────────────────────────────────────────────────
const PERIODS = [
  { value: 'yesterday', label: 'Yesterday'    },
  { value: 'today',     label: 'Today'        },
  { value: 'week',      label: 'This Week'    },
  { value: 'month',     label: 'This Month'   },
  { value: 'quarter',   label: 'This Quarter' },
];

// ── Trend badge ────────────────────────────────────────────────────────────────
function Trend({ value, prev }: { value: number; prev: number }) {
  if (prev === 0 && value === 0) return null;
  if (prev === 0) return <span className="text-[10px] text-emerald-600 font-semibold">New</span>;
  const pct = Math.round(((value - prev) / prev) * 100);
  if (pct === 0) return <span className="text-[10px] text-[#9a8a7a]">No change</span>;
  const up = pct > 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold', up ? 'text-emerald-600' : 'text-red-500')}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {up ? '+' : ''}{pct}% vs last period
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, prev, sub, icon: Icon, accent }: {
  label: string; value: number; prev?: number; sub?: string;
  icon: React.ElementType; accent?: boolean;
}) {
  const isRate = label.includes('Rate');
  const display = isRate ? `${value}%` : value.toLocaleString();

  const body = (
    <div className="min-w-0 flex-1">
      <p className={cn('text-[11px] truncate', accent ? 'opacity-75 text-white' : 'text-[#7a6b5c]')}>{label}</p>
      <h3 className={cn('font-bold text-[24px] leading-tight tracking-tight', accent ? 'text-white' : 'text-[#1c1410]')}>
        {display}
      </h3>
      {sub && <p className={cn('text-[10px] mt-0.5 truncate', accent ? 'opacity-65 text-white' : 'text-[#9a8a7a]')}>{sub}</p>}
      {prev !== undefined && !accent && <Trend value={value} prev={prev} />}
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

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function VolumeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-black/8 rounded-xl px-3 py-2.5 shadow-lg text-[12px]">
      <p className="font-semibold text-[#1c1410] mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-[#7a6b5c] capitalize">{p.name}:</span>
          <span className="font-semibold text-[#1c1410]">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Direction badge ────────────────────────────────────────────────────────────
function DirBadge({ sender }: { sender: string }) {
  const isSent = sender === 'agent';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap',
      isSent ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600',
    )}>
      {isSent ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownLeft className="w-2.5 h-2.5" />}
      {isSent ? 'Sent' : 'Received'}
    </span>
  );
}

// ── Sent By badge ─────────────────────────────────────────────────────────
function SentByBadge({ sentBy }: { sentBy?: string }) {
  if (!sentBy) return <span className="text-[#b09e8d]">-</span>;
  const map: Record<string, { label: string; cls: string }> = {
    automation: { label: 'Automation', cls: 'bg-purple-50 text-purple-600' },
    manual:     { label: 'Manual',     cls: 'bg-[#f0ebe5] text-[#7a6b5c]'  },
    customer:   { label: 'Customer',   cls: 'bg-blue-50 text-blue-600'      },
    system:     { label: 'System',     cls: 'bg-gray-100 text-gray-500'     },
  };
  const cfg = map[sentBy] ?? { label: sentBy, cls: 'bg-gray-100 text-gray-500' };
  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap', cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

export default function InboxOverviewPage() {
  const [period, setPeriod]           = useState('week');
  const [analytics, setAnalytics]     = useState<Analytics | null>(null);
  const [volume, setVolume]           = useState<VolumePoint[]>([]);
  const [topContacts, setTopContacts] = useState<TopContact[]>([]);
  const [logs, setLogs]               = useState<LogRow[]>([]);
  const [logTotal, setLogTotal]       = useState(0);
  const [logPage, setLogPage]         = useState(0);
  const [direction, setDirection]     = useState<'all' | 'sent' | 'received'>('all');
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMain = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const [ana, vol, top] = await Promise.all([
        api.get<Analytics>(`/api/whatsapp-personal/analytics?period=${p}`),
        api.get<VolumePoint[]>(`/api/whatsapp-personal/volume?period=${p}`),
        api.get<TopContact[]>(`/api/whatsapp-personal/top-contacts?period=${p}&limit=7`),
      ]);
      setAnalytics(ana);
      setVolume(vol);
      setTopContacts(top);
    } catch {}
    finally { setLoading(false); }
  }, []);

  const fetchLogs = useCallback(async (p: string, dir: string, q: string, page: number) => {
    setLogsLoading(true);
    try {
      const data = await api.get<{ rows: LogRow[]; total: number }>(
        `/api/whatsapp-personal/logs?period=${p}&direction=${dir}&search=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      );
      setLogs(data.rows);
      setLogTotal(data.total);
    } catch { setLogs([]); setLogTotal(0); }
    finally { setLogsLoading(false); }
  }, []);

  useEffect(() => {
    setLogPage(0);
    fetchMain(period);
    fetchLogs(period, direction, search, 0);
  }, [period]);

  useEffect(() => { fetchLogs(period, direction, search, logPage); }, [direction, logPage]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setLogPage(0);
      fetchLogs(period, direction, search, 0);
    }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  const maxContact = topContacts[0]?.total ?? 1;

  const fmtDate = (d: string) => {
    try { return format(parseISO(d), 'dd MMM, h:mm a'); } catch { return d; }
  };
  const fmtVolumeDate = (d: string) => {
    try { return format(parseISO(d), 'EEE dd'); } catch { return d; }
  };

  const totalPages = Math.ceil(logTotal / PAGE_SIZE);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-[#1c1410]">WhatsApp Personal — Overview</h1>
          <p className="text-[12px] text-[#9a8a7a]">Message volume, contact activity and full send/receive log</p>
        </div>
        <button
          onClick={() => { fetchMain(period); fetchLogs(period, direction, search, logPage); }}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-[#7a6b5c] border border-black/10 rounded-lg px-3 py-1.5 hover:bg-[var(--accent-tint)] transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />Refresh
        </button>
      </div>

      {/* Period filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PERIODS.map((pr) => (
          <button key={pr.value} onClick={() => setPeriod(pr.value)}
            className={cn(
              'text-[12px] font-semibold px-3.5 py-1.5 rounded-lg border transition-all',
              period === pr.value
                ? 'bg-[var(--brand)] text-white border-[var(--brand)] shadow-sm'
                : 'bg-white text-[#7a6b5c] border-black/10 hover:border-primary/40 hover:text-[var(--brand)]',
            )}>
            {pr.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Messages Sent"
          value={analytics?.sent.value ?? 0}
          prev={analytics?.sent.prev}
          sub={`${analytics?.sent.prev ?? 0} in last period`}
          icon={Send}
          accent
        />
        <KpiCard
          label="Messages Received"
          value={analytics?.received.value ?? 0}
          prev={analytics?.received.prev}
          sub={`${analytics?.received.prev ?? 0} in last period`}
          icon={Inbox}
        />
        <KpiCard
          label="Active Contacts"
          value={analytics?.contacts.value ?? 0}
          prev={analytics?.contacts.prev}
          sub="Unique numbers"
          icon={Users}
        />
        <KpiCard
          label="Reply Rate"
          value={analytics?.replyRate.value ?? 0}
          sub={analytics ? `${analytics.replyRate.replied} of ${analytics.replyRate.totalInbound} replied` : 'Inbound conversations'}
          icon={MessageSquare}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Volume chart */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-black/5 p-5 shadow-sm">
          <div className="mb-4">
            <p className="text-[14px] font-bold text-[#1c1410]">Message Volume</p>
            <p className="text-[11px] text-[#9a8a7a] mt-0.5">Sent vs received over time</p>
          </div>
          {loading ? (
            <div className="h-[210px] flex items-center justify-center">
              <RefreshCw className="w-5 h-5 animate-spin text-[var(--brand-dark)]" />
            </div>
          ) : volume.length === 0 ? (
            <div className="h-[210px] flex items-center justify-center text-[13px] text-[#9a8a7a]">
              No data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart
                data={volume.map((v) => ({ ...v, date: fmtVolumeDate(v.date) }))}
                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe5" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9a8a7a' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9a8a7a' }} axisLine={false} tickLine={false} />
                <Tooltip content={<VolumeTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="received" name="Received" fill="#bfdbfe" radius={[3, 3, 0, 0]} maxBarSize={32} />
                <Area dataKey="sent" name="Sent" fill="rgba(234,88,12,0.12)" stroke={brandHex()} strokeWidth={2} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top contacts */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-black/5 p-5 shadow-sm">
          <div className="mb-4">
            <p className="text-[14px] font-bold text-[#1c1410]">Top Contacts</p>
            <p className="text-[11px] text-[#9a8a7a] mt-0.5">Most active numbers this period</p>
          </div>
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="animate-pulse flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#f0ebe5]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-2.5 bg-[#f0ebe5] rounded w-1/2" />
                    <div className="h-1.5 bg-[#f0ebe5] rounded w-full" />
                  </div>
                  <div className="h-2.5 bg-[#f0ebe5] rounded w-6" />
                </div>
              ))}
            </div>
          ) : topContacts.length === 0 ? (
            <div className="flex items-center justify-center h-[160px] text-[13px] text-[#9a8a7a]">
              No contacts yet
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {topContacts.map((c, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-primary">
                      {(c.contact_name || c.phone || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-[#1c1410] truncate">
                      {c.contact_name || c.phone || 'Unknown'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div
                        className="h-1.5 rounded-full bg-[var(--brand)] transition-all"
                        style={{ width: `${Math.round((c.total / maxContact) * 100)}%`, minWidth: 4 }}
                      />
                      <span className="text-[9px] text-[#9a8a7a] shrink-0">{c.sent}↑ {c.received}↓</span>
                    </div>
                  </div>
                  <span className="text-[12px] font-bold text-[#1c1410] shrink-0">{c.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Message Log */}
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        {/* Log header + filters */}
        <div className="px-5 py-4 border-b border-black/5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[#1c1410]">Message Log</p>
            <p className="text-[11px] text-[#9a8a7a]">{logTotal.toLocaleString()} messages</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Direction filter */}
            <div className="flex border border-black/10 rounded-lg overflow-hidden text-[11px] font-semibold">
              {(['all', 'sent', 'received'] as const).map((d) => (
                <button key={d} onClick={() => { setDirection(d); setLogPage(0); }}
                  className={cn(
                    'px-3 py-1.5 transition-colors capitalize',
                    direction === d ? 'bg-[var(--brand)] text-white' : 'text-[#7a6b5c] hover:bg-[var(--accent-tint)]',
                  )}>
                  {d}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9a8a7a]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contact or phone…"
                className="pl-8 pr-3 py-1.5 text-[12px] border border-black/10 rounded-lg w-48 focus:outline-none focus:border-[var(--brand)] transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        {logsLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--brand-dark)]" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-2">
            <MessageSquare className="w-8 h-8 text-[#d4c5b5]" />
            <p className="text-[13px] font-semibold text-[#7a6b5c]">No messages found</p>
            <p className="text-[11px] text-[#9a8a7a]">Try a different period or filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-black/5 text-[10px] font-bold uppercase tracking-wider text-[#9a8a7a]">
                  <th className="px-5 py-2.5 text-left">Contact</th>
                  <th className="px-3 py-2.5 text-left">Direction</th>
                  <th className="px-3 py-2.5 text-left">Message</th>
                  <th className="px-3 py-2.5 text-left">Via</th>
                  <th className="px-3 py-2.5 text-left">Sent By</th>
                  <th className="px-3 py-2.5 text-left">Time</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {logs.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--app-bg)] transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-[9px] font-bold text-primary">
                            {(row.contact_name || '?').charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1c1410] truncate max-w-[140px]">
                            {row.contact_name || 'Unknown'}
                          </p>
                          {row.contact_phone && (
                            <p className="text-[10px] text-[#9a8a7a] truncate">{row.contact_phone}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <DirBadge sender={row.sender} />
                    </td>
                    <td className="px-3 py-3 max-w-[240px]">
                      {row.body ? (
                        <p className="text-[#4a3f35] line-clamp-2 leading-relaxed">{row.body}</p>
                      ) : (
                        <span className="text-[#b09e8d] italic">
                          {row.type === 'image' ? '📷 Image' : row.type === 'video' ? '🎬 Video' : row.type === 'audio' ? '🎤 Audio' : row.type === 'document' ? '📎 File' : 'Media'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[#7a6b5c] whitespace-nowrap">
                      {row.wa_account ? (
                        <span className="text-[10px] bg-[#f0ebe5] text-[#7a6b5c] rounded px-1.5 py-0.5 font-mono">
                          {row.wa_account.replace(/^91/, '+91 ').replace(/(\d{5})(\d{5})$/, '$1 $2')}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-3">
                      <SentByBadge sentBy={row.sent_by} />
                    </td>
                    <td className="px-3 py-3 text-[#7a6b5c] whitespace-nowrap">
                      {fmtDate(row.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      {row.sender === 'agent' && row.status ? (
                        <span className={cn(
                          'text-[9px] font-bold px-1.5 py-0.5 rounded capitalize',
                          row.status === 'read'      ? 'bg-emerald-50 text-emerald-600' :
                          row.status === 'delivered' ? 'bg-blue-50 text-blue-500'       :
                                                       'bg-[#f0ebe5] text-[#9a8a7a]',
                        )}>
                          {row.status}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-black/5 flex items-center justify-between">
            <span className="text-[11px] text-[#9a8a7a]">
              Showing {logPage * PAGE_SIZE + 1}–{Math.min((logPage + 1) * PAGE_SIZE, logTotal)} of {logTotal.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button disabled={logPage === 0} onClick={() => setLogPage((p) => p - 1)}
                className="p-1.5 rounded-lg border border-black/10 hover:bg-[var(--accent-tint)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-semibold text-[#1c1410] px-2">{logPage + 1} / {totalPages}</span>
              <button disabled={logPage >= totalPages - 1} onClick={() => setLogPage((p) => p + 1)}
                className="p-1.5 rounded-lg border border-black/10 hover:bg-[var(--accent-tint)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
