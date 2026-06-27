import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, CheckCircle, XCircle, SkipForward, Activity, Clock, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface AnalyticsData {
  workflow: {
    id: string; name: string; status: string;
    total_contacts: number; completed: number; failed: number; skipped: number;
  };
  daily: Array<{ day: string; completed: number; failed: number; total: number }>;
  steps: Array<{ action_type: string; completed: number; skipped: number; failed: number; total: number }>;
  recent: Array<{ id: string; lead_name: string; trigger_type: string; status: string; enrolled_at: string; completed_at: string | null }>;
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function WorkflowAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.get(`/api/workflows/${id}/analytics`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error || !data) return (
    <div className="p-8 text-center text-destructive">{error || 'Failed to load analytics'}</div>
  );

  const { workflow, daily, steps, recent } = data;
  const successRate = workflow.total_contacts > 0
    ? Math.round((workflow.completed / workflow.total_contacts) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-muted rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold">{workflow.name}</h1>
          <p className="text-xs text-muted-foreground">Workflow Analytics</p>
        </div>
        <div className="ml-auto">
          <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold',
            workflow.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground')}>
            {workflow.status}
          </span>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Enrolled" value={workflow.total_contacts} icon={Users} color="bg-blue-100 text-blue-600" />
          <StatCard label="Completed" value={workflow.completed} icon={CheckCircle} color="bg-green-100 text-green-600" />
          <StatCard label="Failed" value={workflow.failed} icon={XCircle} color="bg-red-100 text-red-600" />
          <StatCard label="Skipped" value={workflow.skipped} icon={SkipForward} color="bg-amber-100 text-amber-600" />
        </div>

        {/* Success rate */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Completion Rate</span>
            </div>
            <span className="text-2xl font-bold text-primary">{successRate}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${successRate}%` }} />
          </div>
        </div>

        {/* Daily activity (last 30 days) */}
        {daily.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Daily Enrollments (last 30 days)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-2 font-medium">Date</th>
                    <th className="text-right py-2 font-medium">Total</th>
                    <th className="text-right py-2 font-medium">Completed</th>
                    <th className="text-right py-2 font-medium">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 text-muted-foreground">{new Date(row.day).toLocaleDateString()}</td>
                      <td className="py-2 text-right font-medium">{row.total}</td>
                      <td className="py-2 text-right text-green-600">{row.completed}</td>
                      <td className="py-2 text-right text-red-500">{row.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Step breakdown */}
        {steps.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Action Step Breakdown</span>
            </div>
            <div className="space-y-2">
              {steps.map((s, i) => {
                const rate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-32 text-xs text-muted-foreground truncate">{s.action_type}</div>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${rate}%` }} />
                    </div>
                    <div className="text-xs w-16 text-right">
                      <span className="text-green-600">{s.completed}</span>
                      <span className="text-muted-foreground">/{s.total}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent executions */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Recent Executions</span>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No executions yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-2 font-medium">Contact</th>
                    <th className="text-left py-2 font-medium">Trigger</th>
                    <th className="text-left py-2 font-medium">Status</th>
                    <th className="text-left py-2 font-medium">Enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 font-medium">{r.lead_name || '-'}</td>
                      <td className="py-2 text-muted-foreground">{r.trigger_type}</td>
                      <td className="py-2">
                        <span className={cn('px-2 py-0.5 rounded-full font-semibold',
                          r.status === 'completed' ? 'bg-green-100 text-green-700' :
                          r.status === 'failed'    ? 'bg-red-100 text-red-600' :
                          'bg-amber-100 text-amber-700')}>
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">{new Date(r.enrolled_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
