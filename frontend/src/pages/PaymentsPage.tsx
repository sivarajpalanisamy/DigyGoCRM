import { useEffect, useState, useCallback } from 'react';
import { IndianRupee, Download, Search, Filter, X, ChevronDown, ChevronUp, CreditCard, TrendingUp, ArrowDownRight, RefreshCw } from 'lucide-react';
import { api, downloadBlob } from '@/lib/api';
import ChartTooltip from '@/components/charts/ChartTooltip';
import { useCrmStore } from '@/store/crmStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

interface Payment {
  id: string;
  razorpay_payment_id: string;
  razorpay_order_id: string | null;
  amount: number; // paise
  currency: string;
  status: string;
  method: string | null;
  email: string | null;
  phone: string | null;
  customer_name: string | null;
  description: string | null;
  lead_id: string | null;
  lead_name: string | null;
  pipeline_name: string | null;
  stage_name: string | null;
  paid_at: string | null;
  created_at: string;
}

interface PaymentStats {
  kpi: {
    total_amount: number;
    total_count: number;
    avg_amount: number;
    refund_amount: number;
    refund_count: number;
    failed_count: number;
  };
  daily: { date: string; amount: number; count: number }[];
  methods: { method: string; count: number; amount: number }[];
}

function formatAmount(paise: number) {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function dateLabel(ts: string | null) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}


const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  captured: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  failed:   { bg: 'bg-red-50',     text: 'text-red-600' },
  refunded: { bg: 'bg-amber-50',   text: 'text-amber-700' },
};

const METHOD_COLORS: Record<string, string> = {
  upi: '#6366f1', card: '#3b82f6', netbanking: '#10b981', wallet: '#f59e0b', emi: '#8b5cf6',
};

const STATUSES = ['captured', 'failed', 'refunded'];
const METHODS = ['upi', 'card', 'netbanking', 'wallet', 'emi'];

export default function PaymentsPage() {
  const { pipelines } = useCrmStore();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  // Filters
  const [status, setStatus]       = useState('');
  const [method, setMethod]       = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [search, setSearch]       = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Stats
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [showCharts, setShowCharts] = useState(true);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (status)     p.set('status', status);
    if (method)     p.set('method', method);
    if (dateFrom)   p.set('date_from', dateFrom);
    if (dateTo)     p.set('date_to', dateTo);
    if (pipelineId) p.set('pipeline_id', pipelineId);
    return p;
  }, [status, method, dateFrom, dateTo, pipelineId]);

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = buildParams();
      params.set('page', String(pg));
      params.set('limit', String(LIMIT));
      const [data, statsData] = await Promise.all([
        api.get<{ payments: Payment[]; total: number }>(`/api/payments?${params}`),
        api.get<PaymentStats>(`/api/payments/stats?${buildParams()}`).catch(() => null),
      ]);
      setPayments(data.payments);
      setTotal(data.total);
      setPage(pg);
      if (statsData) setStats(statsData);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { load(1); }, [load]);

  const handleExport = async () => {
    try {
      const params = buildParams();
      await downloadBlob(`/api/payments/export?${params}`, 'payments.xlsx');
      toast.success('Export downloaded');
    } catch (e: any) {
      toast.error(e.message ?? 'Export failed');
    }
  };

  const clearFilters = () => {
    setStatus(''); setMethod(''); setDateFrom(''); setDateTo(''); setPipelineId('');
  };

  const activeFilterCount = [status, method, dateFrom, dateTo, pipelineId].filter(Boolean).length;

  // Client-side search filter on customer_name / email / phone / lead_name
  const visible = search.trim()
    ? payments.filter((p) =>
        (p.lead_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (p.customer_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (p.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (p.phone ?? '').includes(search)
      )
    : payments;

  const totalPages = Math.ceil(total / LIMIT);

  const successRate = stats?.kpi
    ? stats.kpi.total_count + stats.kpi.failed_count > 0
      ? Math.round((stats.kpi.total_count / (stats.kpi.total_count + stats.kpi.failed_count)) * 100)
      : 0
    : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-headline font-bold text-[#111318]">Payments</h1>
          <p className="text-[15px] text-[#6b7280] mt-0.5">{total} total payments</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--hairline)] bg-white text-[15px] font-semibold text-[#111318] hover:bg-[var(--surface-2)] active:scale-[0.98] transition"
        >
          <Download className="w-4 h-4" /> Export Excel
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--hairline)] bg-white text-[15px] text-[#111318] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-gray-400"
            placeholder="Search customer or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl border text-[15px] font-semibold active:scale-[0.98] transition',
            showFilters || activeFilterCount > 0
              ? 'bg-primary text-white border-primary'
              : 'bg-white border-[var(--hairline)] text-[#111318] hover:bg-[var(--surface-2)]'
          )}
        >
          <Filter className="w-4 h-4" />
          Filter {activeFilterCount > 0 && `(${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-[14px] text-[#6b7280] hover:text-red-500 transition-colors">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white border border-[var(--hairline)] rounded-2xl card-shadow p-4 mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className="text-[12px] font-medium text-[#6b7280] mb-1 block">Status</label>
            <select className="w-full border border-[var(--hairline)] rounded-xl px-3 py-2 text-[14px] text-[#111318] bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#6b7280] mb-1 block">Method</label>
            <select className="w-full border border-[var(--hairline)] rounded-xl px-3 py-2 text-[14px] text-[#111318] bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">All</option>
              {METHODS.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#6b7280] mb-1 block">Pipeline</label>
            <select className="w-full border border-[var(--hairline)] rounded-xl px-3 py-2 text-[14px] text-[#111318] bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
              <option value="">All Pipelines</option>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#6b7280] mb-1 block">From Date</label>
            <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="From date" className="w-full" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#6b7280] mb-1 block">To Date</label>
            <DatePicker value={dateTo} onChange={setDateTo} placeholder="To date" className="w-full" />
          </div>
        </div>
      )}

      {/* Analytics toggle */}
      <button
        onClick={() => setShowCharts((v) => !v)}
        className="flex items-center gap-1.5 text-[14px] font-semibold text-[#6b7280] hover:text-[#111318] mb-3 transition-colors"
      >
        {showCharts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {showCharts ? 'Hide Analytics' : 'Show Analytics'}
      </button>

      {/* Analytics */}
      {showCharts && stats && (
        <div className="space-y-4 mb-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-primary rounded-2xl card-shadow p-4">
              <div className="flex items-center gap-2 mb-1">
                <IndianRupee className="w-4 h-4 text-white/80" />
                <span className="text-[12px] font-medium text-white/80">Total Collected</span>
              </div>
              <p className="text-[22px] font-bold text-white">Rs {formatAmount(stats.kpi.total_amount)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <div className="flex items-center gap-2 mb-1">
                <CreditCard className="w-4 h-4 text-blue-500" />
                <span className="text-[12px] font-medium text-[#6b7280]">Transactions</span>
              </div>
              <p className="text-[22px] font-bold text-blue-600">{stats.kpi.total_count.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-[#6b7280]" />
                <span className="text-[12px] font-medium text-[#6b7280]">Avg Ticket</span>
              </div>
              <p className="text-[22px] font-bold text-[#111318]">Rs {formatAmount(stats.kpi.avg_amount)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowDownRight className="w-4 h-4 text-amber-500" />
                <span className="text-[12px] font-medium text-[#6b7280]">Refunds</span>
              </div>
              <p className="text-[22px] font-bold text-amber-600">Rs {formatAmount(stats.kpi.refund_amount)}</p>
              <p className="text-[12px] text-[#6b7280]">{stats.kpi.refund_count} refund{stats.kpi.refund_count !== 1 ? 's' : ''}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <div className="flex items-center gap-2 mb-1">
                <IndianRupee className="w-4 h-4 text-emerald-500" />
                <span className="text-[12px] font-medium text-[#6b7280]">Success Rate</span>
              </div>
              <p className="text-[22px] font-bold text-emerald-600">{successRate}%</p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Revenue Trend */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <h3 className="text-[15px] font-semibold text-[#111318] mb-3">Revenue Trend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={stats.daily}>
                  <defs>
                    <linearGradient id="amountGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef1" />
                  <XAxis dataKey="date" fontSize={10} fill="#6b7280" axisLine={false} tickLine={false}
                    tickFormatter={(v) => new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                  <YAxis fontSize={10} fill="#6b7280" axisLine={false} tickLine={false} allowDecimals={false}
                    tickFormatter={(v) => `Rs ${(v / 100).toLocaleString('en-IN')}`} />
                  <Tooltip content={<ChartTooltip formatter={(value: number) => [`Rs ${formatAmount(value)}`, 'Revenue']} />} />
                  <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} fill="url(#amountGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Payment Methods */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-4">
              <h3 className="text-[15px] font-semibold text-[#111318] mb-3">Payment Methods</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats.methods} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef1" horizontal={false} />
                  <XAxis type="number" fontSize={10} fill="#6b7280" axisLine={false} tickLine={false} allowDecimals={false}
                    tickFormatter={(v) => `Rs ${(v / 100).toLocaleString('en-IN')}`} />
                  <YAxis type="category" dataKey="method" fontSize={10} fill="#6b7280" axisLine={false} tickLine={false} width={80}
                    tickFormatter={(v) => v ? v.charAt(0).toUpperCase() + v.slice(1) : '-'} />
                  <Tooltip content={<ChartTooltip formatter={(value: number) => [`Rs ${formatAmount(value)}`, 'Amount']} />} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={20}>
                    {stats.methods.map((entry) => (
                      <Cell key={entry.method} fill={METHOD_COLORS[entry.method] || '#9ca3af'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 bg-white border border-[var(--hairline)] rounded-2xl card-shadow overflow-hidden flex flex-col min-h-[480px]">
        <div className="overflow-auto flex-1">
          <table className="w-full text-[15px]">
            <thead className="sticky top-0 bg-[var(--surface-2)] border-b border-[var(--hairline)] z-10">
              <tr>
                <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af] w-10">#</th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Customer</th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Amount</th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Status</th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Method</th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Pipeline</th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Payment ID</th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-[#9ca3af]">Loading...</td></tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <CreditCard className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-[16px] font-semibold text-[#6b7280]">No payments found</p>
                    <p className="text-[14px] text-[#9ca3af] mt-1">Payments will appear here once Razorpay is connected</p>
                  </td>
                </tr>
              ) : visible.map((p, idx) => {
                const customerDisplay = p.lead_name || p.customer_name || p.email || '-';
                const statusStyle = STATUS_STYLES[p.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };

                return (
                  <tr key={p.id} className="hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-3 text-[#9ca3af]">{(page - 1) * LIMIT + idx + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#111318] truncate max-w-[160px]">{customerDisplay}</p>
                      {p.phone && <p className="text-[12px] text-[#9ca3af]">{p.phone}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#111318]">Rs {formatAmount(p.amount)}</p>
                      <p className="text-[11px] text-[#9ca3af]">{p.currency}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2.5 py-1 rounded-full text-[12px] font-semibold', statusStyle.bg, statusStyle.text)}>
                        {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#6b7280]">
                      {p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[#6b7280]">{p.pipeline_name ?? '-'}</p>
                      {p.stage_name && <p className="text-[11px] text-[#9ca3af]">{p.stage_name}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[#6b7280] text-[14px] truncate max-w-[140px]" title={p.razorpay_payment_id}>
                        {p.razorpay_payment_id}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[#6b7280]">{dateLabel(p.paid_at ?? p.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--hairline)] bg-[var(--surface-2)]">
            <span className="text-[14px] text-[#6b7280]">
              Showing {(page - 1) * LIMIT + 1}-{Math.min(page * LIMIT, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => load(page - 1)}
                className="px-3 py-1.5 rounded-xl border border-[var(--hairline)] text-[14px] font-semibold text-[#111318] disabled:opacity-40 hover:bg-[var(--surface-2)] active:scale-[0.98] transition"
              >Prev</button>
              <span className="text-[14px] text-[#6b7280]">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => load(page + 1)}
                className="px-3 py-1.5 rounded-xl border border-[var(--hairline)] text-[14px] font-semibold text-[#111318] disabled:opacity-40 hover:bg-[var(--surface-2)] active:scale-[0.98] transition"
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
