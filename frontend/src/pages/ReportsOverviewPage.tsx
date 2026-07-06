import { useNavigate } from 'react-router-dom';
import { Clock, Users, GitBranch, CheckSquare, Target } from 'lucide-react';

const REPORTS = [
  {
    title: 'Pipeline Report',
    description: 'Stage-wise lead distribution, win/loss trends, source performance, and staff activity for each pipeline.',
    icon: GitBranch,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    path: '/reports/pipeline',
  },
  {
    title: 'Lead Response Time',
    description: 'How quickly your team contacts new leads. Benchmark against 5min / 30min / 1hr targets per staff.',
    icon: Clock,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    path: '/reports/response-time',
  },
  {
    title: 'Staff Scorecard',
    description: 'Calls, messages, follow-ups, stage moves, and conversions per staff member. Daily and weekly trends.',
    icon: Users,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    path: '/reports/staff-scorecard',
  },
  {
    title: 'Conversion Funnel',
    description: 'Drop-off rate at each pipeline stage. Find where leads get stuck and optimize your sales process.',
    icon: GitBranch,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    path: '/reports/conversion-funnel',
  },
  {
    title: 'Follow-up Compliance',
    description: 'Scheduled vs completed vs overdue follow-ups by staff. Accountability and compliance tracking.',
    icon: CheckSquare,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    path: '/reports/followup-compliance',
  },
  {
    title: 'Source ROI',
    description: 'Leads per source with conversion rate, time-to-convert, and monthly trends. Know which channels work.',
    icon: Target,
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    path: '/reports/source-roi',
  },
];

export default function ReportsOverviewPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="mb-6">
        <h1 className="text-[22px] font-headline font-bold text-[#1c1410]">Reports</h1>
        <p className="text-[14px] text-[#7a6b5c] mt-0.5">Analytics and insights to drive your sales performance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <button
            key={r.path}
            onClick={() => navigate(r.path)}
            className="text-left bg-white rounded-2xl border border-black/[0.07] p-5 hover:border-primary/30 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
                <r.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#1c1410] group-hover:text-primary transition-colors">{r.title}</h3>
                <p className="text-[13px] text-[#7a6b5c] mt-1 leading-relaxed">{r.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
