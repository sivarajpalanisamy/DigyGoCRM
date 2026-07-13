import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Workflow, LayoutTemplate, ArrowRight, Activity, CheckCircle, Users } from 'lucide-react';
import { api } from '@/lib/api';

const channels = [
  {
    label: 'Workflows',
    description: 'Build automated sequences to nurture and follow up with leads',
    icon: Workflow,
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
    { label: 'Total Workflows', value: totalWorkflows.toLocaleString(),                     icon: Workflow },
    { label: 'Active',          value: activeWorkflows.toLocaleString(),                    icon: Activity },
    { label: 'Paused',          value: (totalWorkflows - activeWorkflows).toLocaleString(), icon: CheckCircle },
    { label: 'Total Leads',     value: totalLeads.toLocaleString(),                         icon: Users },
  ];

  return (
    <div className="space-y-8">

      {/* Stat Cards - same compact style as the dashboard StatCard */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl px-4 py-3.5 flex items-center gap-3 text-white"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 8px 24px rgba(234,88,12,0.24)' }}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-white/20">
              <s.icon className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] opacity-80 truncate">{s.label}</p>
              <h3 className="font-headline font-bold leading-tight tracking-tight text-[22px]">{s.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Channel Cards */}
      <div>
        <h3 className="font-headline font-bold text-[#111318] text-[16px] mb-4">Automation Tools</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {channels.map((item) => (
            <div
              key={item.label}
              onClick={() => navigate(item.path)}
              className="group bg-white rounded-2xl border border-[var(--hairline)] card-shadow card-hover p-5 cursor-pointer transition flex items-center gap-4"
            >
              <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center shrink-0`}>
                <item.icon className={`w-5 h-5 ${item.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-[#111318] text-[15px]">{item.label}</h4>
                <p className="text-[12px] text-[#6b7280] mt-0.5 leading-relaxed">{item.description}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-[#c3c8cf] group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
