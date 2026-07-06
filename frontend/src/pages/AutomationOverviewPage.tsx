import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Zap, LayoutTemplate, ArrowRight, Activity, CheckCircle, Users } from 'lucide-react';
import { api } from '@/lib/api';

const channels = [
  {
    label: 'Workflows',
    description: 'Build automated sequences to nurture and follow up with leads',
    icon: Zap,
    path: '/automation/workflows',
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  {
    label: 'Templates',
    description: 'Start fast with pre-built automation templates',
    icon: LayoutTemplate,
    path: '/automation/templates',
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
];

export default function AutomationOverviewPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);

  useEffect(() => {
    api.get<any[]>('/api/workflows').then((rows) => setWorkflows(rows ?? [])).catch(() => null);
    api.get<{ total: number }>('/api/leads/summary').then((d) => setTotalLeads(d.total ?? 0)).catch(() => null);
  }, []);

  const totalWorkflows  = workflows.length;
  const activeWorkflows = workflows.filter((w) => w.status === 'active').length;

  const statCards = [
    { label: 'Total Workflows', value: totalWorkflows.toLocaleString(),               icon: Zap,          color: 'text-primary' },
    { label: 'Active',          value: activeWorkflows.toLocaleString(),              icon: Activity,     color: 'text-emerald-500' },
    { label: 'Paused',          value: (totalWorkflows - activeWorkflows).toLocaleString(), icon: CheckCircle, color: 'text-purple-500' },
    { label: 'Total Leads',     value: totalLeads.toLocaleString(),                   icon: Users,        color: 'text-primary' },
  ];

  return (
    <div className="space-y-8">

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl px-6 py-5 flex flex-col justify-between text-white hover:-translate-y-1 transition-all duration-300 cursor-pointer"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 8px 32px rgba(234,88,12,0.28)' }}
          >
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-4">
              <s.icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[14px] opacity-80 mb-1">{s.label}</p>
              <h3 className="font-headline text-[28px] font-bold tracking-tight">{s.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Channel Cards */}
      <div>
        <h3 className="font-headline font-bold text-[#1c1410] text-[15px] mb-4">Automation Tools</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {channels.map((item) => (
            <div
              key={item.label}
              onClick={() => navigate(item.path)}
              className="group bg-white rounded-2xl border border-black/5 card-shadow p-5 cursor-pointer hover:-translate-y-1 transition-all duration-300 flex items-center gap-4"
            >
              <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center shrink-0`}>
                <item.icon className={`w-5 h-5 ${item.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-[#1c1410] text-[14px]">{item.label}</h4>
                <p className="text-[11px] text-[#7a6b5c] mt-0.5 leading-relaxed">{item.description}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-[#c4b09e] group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
