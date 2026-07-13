import { useState, useEffect } from 'react';
import {
  Building2, Users, Target, TrendingUp, RefreshCw,
  AlertTriangle, Clock, ChevronDown, ArrowUpRight,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, LabelList, Legend,
} from 'recharts';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

// ── Types ────────────────────────────────────────────────────────────────────

interface Kpi {
  total_accounts: number;
  total_leads: number;
  total_users: number;
  total_won: number;
}

interface Account {
  id: string;
  name: string;
  plan: string;
  billing_cycle: string | null;
  subscription_status: string;
  subscription_expires_at: string | null;
  created_at: string;
  user_count: number;
  lead_count: number;
  won_count: number;
  pipeline_count: number;
  form_count: number;
  workflow_count: number;
  last_lead_at: string | null;
}

interface GrowthAccount {
  account: string;
  total: number;
  data: { day: string; count: number }[];
}

interface InactiveAccount {
  id: string;
  name: string;
  plan: string;
  billing_cycle: string | null;
  last_lead_at: string | null;
  inactive_days: number;
}

interface DashboardData {
  kpi: Kpi;
  accounts: Account[];
  plan_distribution: { plan_name: string; count: number }[];
  growth: GrowthAccount[];
  inactive: InactiveAccount[];
  usage: { id: string; name: string; plan: string; lead_count: number; user_count: number }[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const PIE_COLORS = ['#ea580c', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
const GROWTH_COLORS = ['#ea580c', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
const PLAN_LIMITS: Record<string, { leads: number; users: number }> = {
  starter: { leads: 500, users: 5 },
  growth: { leads: 2000, users: 15 },
  pro: { leads: 10000, users: 50 },
  enterprise: { leads: Infinity, users: Infinity },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: string | null): string {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function pct(a: number, b: number): string {
  if (!b) return '0%';
  return `${Math.round((a / b) * 100)}%`;
}

const cycleBadge = (c: string | null) => {
  if (c === 'yearly') return { cls: 'bg-green-100 text-green-700', label: 'Yearly' };
  return { cls: 'bg-blue-100 text-blue-700', label: 'Monthly' };
};

// ── Components ───────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub }: {
  icon: typeof Building2; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-2xl p-5 flex items-start gap-4 text-white"
      style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 20px rgba(234,88,12,0.25)' }}>
      <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-[14px] opacity-80 font-medium">{label}</p>
        <p className="font-headline text-[22px] font-bold leading-tight mt-0.5">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        {sub && <p className="text-[13px] opacity-70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Card({ title, sub, children, className }: {
  title: string; sub?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5', className)}>
      <div className="mb-4">
        <h3 className="text-[16px] font-bold text-[#111318]">{title}</h3>
        {sub && <p className="text-[12px] text-[#8b929c] mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SuperAdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<keyof Account>('lead_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const navigate = useNavigate();

  const fetchData = () => {
    setLoading(true);
    api.get<DashboardData>('/api/auth/tenants/dashboard')
      .then(setData)
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const toggleSort = (key: keyof Account) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = data?.accounts?.slice().sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  }) ?? [];

  // Build merged growth chart data (all top 5 on same X axis)
  const growthChartData: Record<string, any>[] = [];
  if (data?.growth?.length) {
    const daySet = new Set<string>();
    for (const acct of data.growth) for (const d of acct.data) daySet.add(d.day);
    const days = Array.from(daySet).sort();
    for (const day of days) {
      const row: Record<string, any> = { day: day.slice(5) }; // MM-DD
      for (const acct of data.growth) {
        const found = acct.data.find(d => d.day === day);
        row[acct.account] = found?.count ?? 0;
      }
      growthChartData.push(row);
    }
  }

  // Accounts nearing limits
  const nearingLimits = (data?.usage ?? []).filter(u => {
    const limits = PLAN_LIMITS[u.plan] ?? PLAN_LIMITS.starter;
    return (u.lead_count / limits.leads >= 0.8) || (u.user_count / limits.users >= 0.8);
  }).slice(0, 10);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--brand-dark)]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-32 text-[15px] text-[#8b929c]">
        Failed to load dashboard data.
      </div>
    );
  }

  const convPct = data.kpi.total_leads > 0
    ? Math.round((data.kpi.total_won / data.kpi.total_leads) * 100)
    : 0;

  const SortIcon = ({ col }: { col: keyof Account }) => (
    <ChevronDown className={cn(
      'w-3 h-3 inline-block ml-0.5 transition-transform',
      sortKey === col ? 'text-[var(--brand)]' : 'text-gray-300',
      sortKey === col && sortDir === 'asc' && 'rotate-180',
    )} />
  );

  return (
    <div className="flex flex-col gap-5 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-[#111318]">Super Admin Dashboard</h1>
          <p className="text-[14px] text-[#8b929c] mt-0.5">Cross-account analytics and health overview</p>
        </div>
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--hairline)] bg-white text-[14px] font-semibold text-[#111318] hover:bg-[var(--surface-2)] hover:text-primary active:scale-[0.98] transition">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Building2} label="Total Accounts" value={data.kpi.total_accounts} color="#6366f1" />
        <KpiCard icon={Target} label="Total Leads" value={data.kpi.total_leads} sub={`${convPct}% conversion`} color="#ea580c" />
        <KpiCard icon={Users} label="Total Users" value={data.kpi.total_users} color="#3b82f6" />
        <KpiCard icon={TrendingUp} label="Total Won" value={data.kpi.total_won} color="#10b981" />
      </div>

      {/* Row: Plan Distribution + Most Active */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Plan Distribution */}
        <Card title="Plan Distribution" sub="Accounts by billing cycle">
          {data.plan_distribution.length === 0 ? (
            <p className="text-[14px] text-[#8b929c] text-center py-8">No data</p>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={data.plan_distribution} dataKey="count" nameKey="plan_name"
                    cx="50%" cy="50%" outerRadius={70} innerRadius={40} strokeWidth={2}>
                    {data.plan_distribution.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [v, 'Accounts']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2">
                {data.plan_distribution.map((p, i) => (
                  <div key={p.plan_name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-[14px] font-medium text-[#111318] capitalize">{p.plan_name}</span>
                    <span className="text-[14px] text-[#8b929c] ml-auto pl-3">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Most Active Accounts (bar chart) */}
        <Card title="Most Active Accounts" sub="Top 10 by lead count">
          {sorted.length === 0 ? (
            <p className="text-[14px] text-[#8b929c] text-center py-8">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sorted.slice(0, 10)} layout="vertical"
                margin={{ left: 0, right: 30, top: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={120}
                  tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Leads']} />
                <Bar dataKey="lead_count" fill="#ea580c" radius={[0, 6, 6, 0]} barSize={16}>
                  <LabelList dataKey="lead_count" position="right"
                    style={{ fontSize: 11, fontWeight: 600, fill: '#111318' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Lead Growth Trend - Top 5 accounts */}
      <Card title="Lead Growth Trend (30 days)" sub="Top 5 accounts by new leads">
        {growthChartData.length === 0 ? (
          <p className="text-[14px] text-[#8b929c] text-center py-8">No data in last 30 days</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={growthChartData} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f4" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#8b929c' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#8b929c' }} tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {data.growth.map((acct, i) => (
                <Line key={acct.account} type="monotone" dataKey={acct.account}
                  stroke={GROWTH_COLORS[i % GROWTH_COLORS.length]}
                  strokeWidth={2} dot={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Account-wise Table */}
      <Card title="Account-wise Breakdown" sub="Click column headers to sort">
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[1000px] text-[14px]">
            <thead>
              <tr className="border-b border-[var(--hairline)] text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">
                {([
                  ['name', 'Account'],
                  ['billing_cycle', 'Plan'],
                  ['user_count', 'Users'],
                  ['lead_count', 'Leads'],
                  ['won_count', 'Won'],
                  ['pipeline_count', 'Pipelines'],
                  ['form_count', 'Forms'],
                  ['workflow_count', 'Workflows'],
                  ['last_lead_at', 'Last Activity'],
                ] as [keyof Account, string][]).map(([key, label]) => (
                  <th key={key}
                    onClick={() => toggleSort(key)}
                    className="text-left py-2.5 px-2 font-semibold cursor-pointer hover:text-[var(--brand)] select-none whitespace-nowrap">
                    {label}<SortIcon col={key} />
                  </th>
                ))}
                <th className="text-left py-2.5 px-2 font-semibold whitespace-nowrap">Conv %</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const badge = cycleBadge(a.billing_cycle);
                const conv = a.lead_count > 0 ? Math.round((a.won_count / a.lead_count) * 100) : 0;
                return (
                  <tr key={a.id} className="border-b border-[var(--hairline)] hover:bg-[var(--surface-2)] transition-colors">
                    <td className="py-2.5 px-2 font-semibold text-[#111318] whitespace-nowrap">
                      <button onClick={() => navigate('/admin')}
                        className="hover:text-[var(--brand)] transition-colors flex items-center gap-1">
                        {a.name} <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                      </button>
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', badge.cls)}>{badge.label}</span>
                    </td>
                    <td className="py-2.5 px-2 text-[#111318] font-medium">{a.user_count}</td>
                    <td className="py-2.5 px-2 text-[#111318] font-bold">{a.lead_count.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-green-700 font-medium">{a.won_count}</td>
                    <td className="py-2.5 px-2 text-[#111318]">{a.pipeline_count}</td>
                    <td className="py-2.5 px-2 text-[#111318]">{a.form_count}</td>
                    <td className="py-2.5 px-2 text-[#111318]">{a.workflow_count}</td>
                    <td className="py-2.5 px-2 text-[#8b929c] whitespace-nowrap">{timeAgo(a.last_lead_at)}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-14 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            width: `${Math.min(conv, 100)}%`,
                            background: conv >= 20 ? '#10b981' : conv >= 10 ? '#f59e0b' : '#ef4444',
                          }} />
                        </div>
                        <span className="text-[12px] font-medium text-[#111318]">{conv}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Row: Inactive Accounts + Near Limits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inactive Accounts */}
        <Card title="Inactive Accounts" sub="No leads in 30+ days - churn risk">
          {data.inactive.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[14px] text-[#8b929c]">
              All accounts are active
            </div>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {data.inactive.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-red-50/60 border border-red-100">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-[#111318] truncate">{a.name}</p>
                      <p className="text-[11px] text-[#8b929c]">
                        {a.last_lead_at ? `Last lead: ${timeAgo(a.last_lead_at)}` : 'No leads ever'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className="text-[15px] font-bold text-red-600">{a.inactive_days}d</span>
                    <p className="text-[11px] text-red-500">inactive</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Nearing Plan Limits */}
        <Card title="Nearing Plan Limits" sub="Accounts at 80%+ of plan capacity">
          {nearingLimits.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[14px] text-[#8b929c]">
              No accounts near limits
            </div>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {nearingLimits.map((a) => {
                const limits = PLAN_LIMITS[a.plan] ?? PLAN_LIMITS.starter;
                const leadPct = Math.min(Math.round((a.lead_count / limits.leads) * 100), 100);
                const userPct = Math.min(Math.round((a.user_count / limits.users) * 100), 100);
                return (
                  <div key={a.id} className="px-3 py-2.5 rounded-xl bg-amber-50/60 border border-amber-100">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[14px] font-semibold text-[#111318]">{a.name}</p>
                      <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full capitalize">{a.plan}</span>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-[#8b929c]">Leads</span>
                          <span className="font-medium text-[#111318]">{a.lead_count}/{limits.leads === Infinity ? '∞' : limits.leads}</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{
                            width: `${leadPct}%`,
                            background: leadPct >= 90 ? '#ef4444' : '#f59e0b',
                          }} />
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-[#8b929c]">Users</span>
                          <span className="font-medium text-[#111318]">{a.user_count}/{limits.users === Infinity ? '∞' : limits.users}</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{
                            width: `${userPct}%`,
                            background: userPct >= 90 ? '#ef4444' : '#f59e0b',
                          }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
