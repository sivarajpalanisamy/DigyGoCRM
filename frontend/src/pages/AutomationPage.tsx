import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '@/store/crmStore';
import { useHeaderSearch } from '@/store/headerSearchStore';
import { usePermission } from '@/hooks/usePermission';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import {
  Plus, Zap, MoreVertical, X, CheckCircle2, Clock,
  Users, Activity, Pencil, Copy, Trash2, ChevronRight,
  ToggleRight, ToggleLeft, SkipForward, Loader2, User, TrendingUp,
  ChevronDown, ChevronUp, Play, RefreshCw, AlertTriangle, Send,
  Check, Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal';

export type { WFFolder, WFNode, WFRecord } from '@/types/workflow';

// ── Contact Sidebar ────────────────────────────────────────────────────────────
type SidebarFilter = 'all' | 'completed' | 'completed_with_errors' | 'failed' | 'pending' | 'skipped';

function ContactSidebar({
  workflow, filterStatus, onClose,
}: { workflow: WFRecord; filterStatus: SidebarFilter; onClose: () => void }) {
  const [logs, setLogs]           = useState<any[]>([]);
  const [allLogs, setAllLogs]     = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [rerunning, setRerunning] = useState(false);
  // per-row re-run status: 'running' | 'done' | 'error'
  const [rowStatus, setRowStatus] = useState<Record<string, 'running' | 'done' | 'error'>>({});

  const loadLogs = useCallback(() => {
    setLoading(true);
    api.get<any[]>(`/api/workflows/${workflow.id}/logs`)
      .then((data) => {
        const raw = data ?? [];
        setAllLogs(raw);
        // Deduplicate by lead_id - keep only the latest execution per contact
        // (backend returns DESC order so first occurrence = newest).
        // Null-lead_id rows (test-modal runs) are kept individually by execution id.
        const seen = new Set<string>();
        const deduped = raw.filter((log: any) => {
          const key = log.lead_id ?? `_exec_${log.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setLogs(deduped);
      })
      .catch(() => { setLogs([]); setAllLogs([]); })
      .finally(() => setLoading(false));
  }, [workflow.id]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const filtered = filterStatus === 'completed'
    ? allLogs.filter((l) => l.status === 'completed')
    : filterStatus === 'completed_with_errors'
    ? allLogs.filter((l) => l.status === 'completed_with_errors')
    : filterStatus === 'skipped'
    ? allLogs.filter((l) => l.status === 'skipped')
    : logs.filter((l) => {
        if (filterStatus === 'all')     return true;
        if (filterStatus === 'failed')  return l.status === 'failed';
        if (filterStatus === 'pending') return l.status === 'running';
        return false;
      });

  // ── Selection helpers ────────────────────────────────────────────────────────
  const allIds      = filtered.map((l) => l.id as string);
  const allChecked  = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = allIds.some((id) => selected.has(id)) && !allChecked;

  const toggleAll = () => {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Re-execute selected leads ────────────────────────────────────────────────
  const handleRerun = async () => {
    const targets = filtered.filter((l) => selected.has(l.id));
    if (!targets.length) return;

    setRerunning(true);
    // Mark all selected as 'running' immediately for visual feedback
    setRowStatus((prev) => {
      const next = { ...prev };
      targets.forEach((l) => { next[l.id] = 'running'; });
      return next;
    });

    let successCount = 0;
    let failCount = 0;

    for (const log of targets) {
      try {
        await api.post(`/api/workflows/${workflow.id}/test`, {
          ...(log.lead_id
            ? { lead_id: log.lead_id }
            : { name: log.lead_name ?? 'Unknown Contact' }),
        });
        setRowStatus((prev) => ({ ...prev, [log.id]: 'done' }));
        successCount++;
      } catch {
        setRowStatus((prev) => ({ ...prev, [log.id]: 'error' }));
        failCount++;
      }
    }

    setRerunning(false);
    setSelected(new Set());

    if (failCount === 0) {
      toast.success(`Re-executed for ${successCount} contact${successCount !== 1 ? 's' : ''}`);
    } else {
      toast.error(`${successCount} succeeded, ${failCount} failed`);
    }

    // Refresh logs after a short delay so new executions show up
    setTimeout(() => { loadLogs(); setRowStatus({}); }, 1500);
  };

  // ── UI helpers ───────────────────────────────────────────────────────────────
  const actionNodes = workflow.nodes.filter((n: any) => n.type !== 'trigger');

  // Recursive map of ALL nodes (including nested branch nodes) by ID
  const allNodesMap = (() => {
    const map = new Map<string, any>();
    const walk = (ns: any[]) => {
      for (const n of ns) {
        map.set(n.id, n);
        if (n.branches?.yes) walk(n.branches.yes);
        if (n.branches?.no)  walk(n.branches.no);
      }
    };
    walk(workflow.nodes);
    return map;
  })();

  const bgPalette = ['#f5ede3','#dbeafe','#dcfce7','#ede9fe','#fce7f3'];
  const fgPalette = ['#c2410c','#1d4ed8','#15803d','#7c3aed','#be185d'];

  const labelConfig: Record<SidebarFilter, { label: string; dot: string }> = {
    all:                    { label: 'All Contacts',            dot: 'bg-gray-400' },
    completed:              { label: 'Done',                    dot: 'bg-emerald-400' },
    completed_with_errors:  { label: 'Done with Errors',        dot: 'bg-amber-400' },
    failed:                 { label: 'Failed',                  dot: 'bg-red-400' },
    pending:                { label: 'Pending',                 dot: 'bg-blue-400' },
    skipped:                { label: 'Skipped / Reentry Blocked', dot: 'bg-amber-400' },
  };

  const execStatusBadge = (log: any) => {
    const { status, steps } = log;
    const skippedCount = (steps ?? []).filter((s: any) => s.status === 'skipped').length;
    return (
      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
        {status === 'completed' && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" /> Done
          </span>
        )}
        {status === 'completed_with_errors' && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
            <AlertTriangle className="w-3 h-3" /> Done w/ Errors
          </span>
        )}
        {status === 'failed' && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
            <X className="w-3 h-3" /> Failed
          </span>
        )}
        {status === 'running' && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
            <Clock className="w-3 h-3" /> Pending
          </span>
        )}
        {status === 'skipped' && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
            <SkipForward className="w-3 h-3" /> Reentry blocked
          </span>
        )}
        {status !== 'skipped' && skippedCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
            <SkipForward className="w-3 h-3" /> {skippedCount} skipped
          </span>
        )}
      </div>
    );
  };

  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative z-50 w-full max-w-[420px] bg-white h-full flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-black/5 flex items-center gap-3">
          <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-[#1c1410] text-[15px] truncate">{workflow.name}</h3>
            <p className="text-[11px] text-[#7a6b5c] mt-0.5 flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full inline-block', labelConfig[filterStatus].dot)} />
              {labelConfig[filterStatus].label}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-primary transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats + select-all bar */}
        <div className="shrink-0 px-5 py-2.5 bg-[var(--app-bg)] border-b border-black/5 flex items-center gap-3">
          {/* Select-all checkbox */}
          {filtered.length > 0 && (
            <button
              onClick={toggleAll}
              className={cn(
                'w-4.5 h-4.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                allChecked
                  ? 'bg-primary border-primary'
                  : someChecked
                    ? 'bg-primary/30 border-primary'
                    : 'border-gray-300 bg-white hover:border-primary/60'
              )}
              style={{ width: 18, height: 18 }}
              title="Select all"
            >
              {(allChecked || someChecked) && (
                allChecked
                  ? <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  : <Minus className="w-2.5 h-2.5 text-white" strokeWidth={3} />
              )}
            </button>
          )}
          <div className="flex items-center gap-1.5 flex-1">
            <Users className="w-3.5 h-3.5 text-[#7a6b5c]" />
            <span className="text-[13px] font-semibold text-[#1c1410]">
              {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
            </span>
            {selectedCount > 0 && (
              <span className="text-[11px] text-primary font-semibold ml-1">
                · {selectedCount} selected
              </span>
            )}
          </div>
          {/* Refresh button */}
          <button
            onClick={loadLogs}
            className="p-1.5 rounded-lg text-[#b09e8d] hover:text-primary hover:bg-[var(--accent-tint)] transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center text-[14px] text-[#7a6b5c] flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center px-6">
              <div className="w-12 h-12 bg-[var(--accent-tint)] rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <p className="text-[15px] font-semibold text-[#1c1410] mb-1">No contacts yet</p>
              <p className="text-[13px] text-[#7a6b5c]">No one in this status yet.</p>
            </div>
          ) : (
            <div>
              {filtered.map((log, idx) => {
                const name       = (log.lead_name && log.lead_name.trim()) ? log.lead_name : '(deleted lead)';
                const phone      = log.lead_phone ?? '-';
                const enrolledAt = log.enrolled_at ? format(new Date(log.enrolled_at), 'dd MMM yyyy, h:mm a') : '';
                const initial    = (name as string).charAt(0)?.toUpperCase() || '?';
                const ci         = idx % bgPalette.length;
                const isOpen     = expanded === log.id;
                const isChecked  = selected.has(log.id);
                const rStatus    = rowStatus[log.id];

                const stepStatusMap: Record<string, { status: string; message: string }> = {};
                (log.steps ?? []).forEach((s: any) => {
                  if (s.node_id) stepStatusMap[s.node_id] = { status: s.status, message: s.message ?? '' };
                });

                return (
                  <div
                    key={log.id}
                    className={cn(
                      'border-b border-black/5 last:border-0 transition-colors',
                      isChecked && 'bg-primary/[0.03]',
                      rStatus === 'done'    && 'bg-emerald-50/60',
                      rStatus === 'error'   && 'bg-red-50/60',
                      rStatus === 'running' && 'bg-blue-50/40',
                    )}
                  >
                    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--app-bg)] transition-colors">
                      {/* Checkbox */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleOne(log.id); }}
                        className={cn(
                          'rounded border-2 flex items-center justify-center shrink-0 transition-all',
                          isChecked
                            ? 'bg-primary border-primary'
                            : 'border-gray-300 bg-white hover:border-primary/60'
                        )}
                        style={{ width: 18, height: 18 }}
                      >
                        {isChecked && (
                          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        )}
                      </button>

                      {/* Avatar */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold"
                        style={{ background: bgPalette[ci], color: fgPalette[ci] }}
                      >
                        {rStatus === 'running'
                          ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: fgPalette[ci] }} />
                          : rStatus === 'done'
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            : rStatus === 'error'
                              ? <X className="w-4 h-4 text-red-500" />
                              : initial}
                      </div>

                      {/* Info */}
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : log.id)}
                      >
                        <p className="text-[14px] font-semibold text-[#1c1410] truncate">{name}</p>
                        <p className="text-[11px] text-[#7a6b5c]"><a href={`tel:${phone}`} className="hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>{phone}</a>{enrolledAt ? ` · ${enrolledAt}` : ''}</p>
                      </div>

                      {/* Right side */}
                      <div
                        className="flex items-center gap-2 shrink-0 cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : log.id)}
                      >
                        {filterStatus === 'all' && execStatusBadge(log)}
                        {isOpen
                          ? <ChevronUp className="w-3.5 h-3.5 text-[#b09e8d]" />
                          : <ChevronDown className="w-3.5 h-3.5 text-[#b09e8d]" />}
                      </div>
                    </div>

                    {/* Steps expanded */}
                    {isOpen && (
                      <div className="px-5 pb-3 pt-1 space-y-2 bg-[var(--app-bg)]">
                        {/* Execution-level error - shown when the whole run crashed */}
                        {log.error && (
                          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-1">
                            <X className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-red-700 font-mono break-all select-text">{log.error}</p>
                          </div>
                        )}
                        {(log.steps ?? []).length === 0 && actionNodes.length === 0 ? (
                          <p className="text-[11px] text-[#b09e8d] py-2">No steps configured.</p>
                        ) : (log.steps ?? []).length > 0 ? (
                          // Render actual executed steps in order - includes nested branch steps
                          (log.steps as any[]).map((step, ni) => {
                            const node     = allNodesMap.get(step.node_id);
                            const label    = node?.label || step.action_type || 'Action';
                            const isDone   = step.status === 'completed';
                            const isFailed = step.status === 'failed';
                            const isSkip   = step.status === 'skipped';
                            return (
                              <div key={step.node_id || ni} className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-400 text-[9px] flex items-center justify-center font-bold shrink-0">
                                    {ni + 1}
                                  </span>
                                  <div className="min-w-0">
                                    <span className="text-[13px] text-[#1c1410] truncate block">{label}</span>
                                    {(isFailed || isSkip) && step.message && (
                                      <span className={`text-[10px] break-all block select-text font-mono ${isFailed ? 'text-red-600' : 'text-[#b09e8d]'}`}>
                                        {step.message}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isDone ? (
                                  <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full shrink-0">
                                    <CheckCircle2 className="w-3 h-3" /> Done
                                  </span>
                                ) : isFailed ? (
                                  <span className="flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full shrink-0">
                                    <X className="w-3 h-3" /> Failed
                                  </span>
                                ) : isSkip ? (
                                  <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full shrink-0">
                                    <SkipForward className="w-3 h-3" /> Skipped
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
                                    Pending
                                  </span>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          // Fallback: no step logs yet - show top-level nodes as pending
                          actionNodes.map((node: any, ni: number) => (
                            <div key={node.id} className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-400 text-[9px] flex items-center justify-center font-bold shrink-0">
                                  {ni + 1}
                                </span>
                                <span className="text-[13px] text-[#1c1410] truncate block">{node.label}</span>
                              </div>
                              <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">Pending</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Re-execute footer - shown when contacts are selected ── */}
        {selectedCount > 0 && (
          <div className="shrink-0 px-4 py-3 border-t border-black/5 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-[#1c1410]">
                  {selectedCount} contact{selectedCount !== 1 ? 's' : ''} selected
                </p>
                <p className="text-[11px] text-[#7a6b5c]">Workflow will restart from step 1</p>
              </div>
              <button
                onClick={() => setSelected(new Set())}
                className="px-3 py-2 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors shrink-0"
              >
                Clear
              </button>
              <button
                onClick={handleRerun}
                disabled={rerunning}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-bold text-white transition-all disabled:opacity-60 shrink-0"
                style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))', boxShadow: '0 3px 10px rgba(194,65,12,0.3)' }}
              >
                {rerunning
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
                  : <><Play className="w-3.5 h-3.5" /> Re-execute</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Toggle ─────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={cn('relative w-9 h-5 rounded-full transition-all duration-200 shrink-0', checked ? 'bg-emerald-400' : 'bg-gray-200')}
    >
      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

// ── Workflow Row ───────────────────────────────────────────────────────────────
function WorkflowRow({ wf, onOpen, onToggle, onDuplicate, onDelete, menuOpen, onToggleMenu, onContactPanel, onAnalytics, onRetry, onRetryErrors, onToggleReentry, selected, onSelect, onRunBroadcast }: {
  wf: WFRecord; onOpen: () => void; onToggle: () => void; onDuplicate: () => void;
  onDelete: () => void; menuOpen: boolean; onToggleMenu: () => void;
  onContactPanel: (status: SidebarFilter) => void;
  onAnalytics: () => void;
  onRetry: () => void;
  onRetryErrors: () => void;
  onToggleReentry: () => void;
  selected: boolean;
  onSelect: () => void;
  onRunBroadcast: () => void;
}) {
  const canManageAutomation = usePermission('automation:manage');
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  const menuBtnRef = React.useRef<HTMLButtonElement>(null);
  const [flipUp, setFlipUp] = React.useState(false);

  const triggerNode = wf.nodes.find((n) => n.type === 'trigger');
  const triggerDesc = triggerNode?.actionType
    ? triggerNode.actionType === 'lead_created'        ? 'Trigger will fire when a new lead is created'
    : triggerNode.actionType === 'meta_form'           ? 'Trigger will fire when selected facebook form is submitted'
    : triggerNode.actionType === 'appointment_booked'  ? 'When an appointment is booked automation will trigger'
    : triggerNode.actionType === 'pipeline_stage_change' ? 'When a contact is added to selected pipeline automation will trigger'
    : triggerNode.actionType === 'broadcast_to_group'  ? 'Broadcast to group - click Run Broadcast to start sending'
    : triggerNode.label && triggerNode.label !== 'Select Trigger' ? triggerNode.label
    : 'No trigger configured'
    : 'No trigger configured';

  return (
    <div
      onClick={onOpen}
      className={cn(
        'group flex items-center border-b border-black/[0.04] hover:bg-[var(--app-bg)] cursor-pointer transition-colors',
        selected && 'bg-orange-50/40'
      )}
    >
      {/* Row selection checkbox */}
      <div className="w-10 flex items-center justify-center shrink-0 py-4" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onSelect}
          className={cn(
            'w-4 h-4 rounded border-2 flex items-center justify-center transition-all',
            selected ? 'bg-primary border-primary' : 'border-gray-300 bg-white hover:border-primary/60'
          )}
        >
          {selected && (
            <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
          )}
        </button>
      </div>

      {/* Automation Name */}
      <div className="flex-1 min-w-0 py-4 pr-4">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-[14px] text-[#1c1410] truncate">{wf.name}</p>
          {wf.status === 'inactive' && (
            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 leading-none">
              Draft
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#7a6b5c] mt-0.5 truncate">
          {wf.status === 'inactive'
            ? 'Not published - toggle to activate'
            : triggerDesc}
        </p>
      </div>

      {/* Allow Re-entry checkbox */}
      <div className="w-32 flex items-center justify-center shrink-0 py-4" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onToggleReentry}
          title={wf.allowReentry ? 'Re-entry allowed - click to disable' : 'Re-entry blocked - click to allow'}
          className={cn(
            'w-4 h-4 rounded border-2 flex items-center justify-center transition-all',
            wf.allowReentry ? 'bg-primary border-primary' : 'border-gray-300 bg-white hover:border-primary/60'
          )}
        >
          {wf.allowReentry && (
            <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
          )}
        </button>
      </div>

      {/* Done */}
      <div className="w-20 shrink-0 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onContactPanel('completed')} className="w-full text-center hover:opacity-70 transition-opacity">
          <p className="text-[15px] font-bold text-[#1c1410]">{wf.completed}</p>
          <p className="text-[11px] text-[#7a6b5c]">Done</p>
        </button>
      </div>

      {/* Errors */}
      <div className="w-20 shrink-0 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onContactPanel('completed_with_errors')} className="w-full text-center hover:opacity-70 transition-opacity">
          <p className={cn('text-[15px] font-bold', wf.completedWithErrors > 0 ? 'text-amber-500' : 'text-[#1c1410]')}>
            {wf.completedWithErrors}
          </p>
          <p className="text-[11px] text-[#7a6b5c]">Errors</p>
        </button>
      </div>

      {/* Skipped */}
      <div className="w-20 shrink-0 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onContactPanel('skipped')} className="w-full text-center hover:opacity-70 transition-opacity">
          <p className="text-[15px] font-bold text-[#1c1410]">{wf.skipped}</p>
          <p className="text-[11px] text-[#7a6b5c]">Skipped</p>
        </button>
      </div>

      {/* Contacts */}
      <div className="w-24 shrink-0 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onContactPanel('all')} className="w-full text-center hover:opacity-70 transition-opacity">
          <p className="text-[15px] font-bold text-[#1c1410]">{wf.totalContacts}</p>
          <p className="text-[11px] text-[#7a6b5c]">Contacts</p>
        </button>
      </div>

      {/* Failed */}
      <div className="w-20 shrink-0 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onContactPanel('failed')} className="w-full text-center hover:opacity-70 transition-opacity">
          <p className="text-[15px] font-bold text-[#1c1410]">{wf.failed}</p>
          <p className="text-[11px] text-[#7a6b5c]">Failed</p>
        </button>
      </div>

      {/* Status toggle */}
      <div className="w-20 flex items-center justify-center shrink-0 py-4" onClick={(e) => e.stopPropagation()}>
        <Toggle checked={wf.status === 'active'} onChange={onToggle} />
      </div>

      {/* 3-dot menu */}
      <div className="w-10 relative shrink-0 flex items-center justify-center py-4" onClick={(e) => e.stopPropagation()}>
        <button
          ref={menuBtnRef}
          onClick={stop(() => {
            if (!menuOpen && menuBtnRef.current) {
              const rect = menuBtnRef.current.getBoundingClientRect();
              setFlipUp(rect.bottom + 240 > window.innerHeight);
            }
            onToggleMenu();
          })}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#7a6b5c] hover:bg-white hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={stop(onToggleMenu)} />
            <div className={`absolute right-0 z-40 w-44 bg-white rounded-xl border border-black/5 shadow-xl py-1 overflow-hidden ${flipUp ? 'bottom-9' : 'top-9'}`}>
              {canManageAutomation && (
                <button onClick={stop(onOpen)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors text-left">
                  <Pencil className="w-3.5 h-3.5 text-[#7a6b5c]" /> Edit
                </button>
              )}
              <button onClick={stop(onAnalytics)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors text-left">
                <TrendingUp className="w-3.5 h-3.5 text-[#7a6b5c]" /> Analytics
              </button>
              {canManageAutomation && (
                <button onClick={stop(onDuplicate)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors text-left">
                  <Copy className="w-3.5 h-3.5 text-[#7a6b5c]" /> Duplicate
                </button>
              )}
              {canManageAutomation && triggerNode?.actionType === 'broadcast_to_group' && (
                <button onClick={stop(onRunBroadcast)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-emerald-600 hover:bg-emerald-50 transition-colors text-left">
                  <Send className="w-3.5 h-3.5" /> Run Broadcast
                </button>
              )}
              {canManageAutomation && (
                <button onClick={stop(onRetry)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--brand-dark)] hover:bg-orange-50 transition-colors text-left">
                  <RefreshCw className="w-3.5 h-3.5" /> Retry skipped
                </button>
              )}
              {canManageAutomation && wf.completedWithErrors > 0 && (
                <button onClick={stop(onRetryErrors)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-amber-600 hover:bg-amber-50 transition-colors text-left">
                  <AlertTriangle className="w-3.5 h-3.5" /> Retry {wf.completedWithErrors} error{wf.completedWithErrors !== 1 ? 's' : ''}
                </button>
              )}
              {canManageAutomation && (
                <>
                  <div className="border-t border-black/5 my-1" />
                  <button onClick={stop(onDelete)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 transition-colors text-left">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AutomationPage() {
  const navigate = useNavigate();
  const { wfFolders: storeFolders } = useCrmStore();
  const canManageAutomation = usePermission('automation:manage');

  const [workflows, setWorkflows] = useState<WFRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useHeaderSearch('Search workflows');
  const [statusFilter, setStatusFilter] = useState('All');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [noTriggerPopup, setNoTriggerPopup] = useState(false);
  const [contactPanel, setContactPanel] = useState<{ wf: WFRecord; status: SidebarFilter } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchWorkflows = () => {
    api.get<any[]>('/api/workflows')
      .then((rows) => {
        const mapped: WFRecord[] = (rows ?? []).map((r) => {
          const total               = r.total_contacts        ?? 0;
          const completed           = r.completed             ?? 0;
          const completedWithErrors = r.completed_with_errors ?? 0;
          const failed              = r.failed                ?? 0;
          const skipped             = r.skipped               ?? 0;
          return {
            id: r.id,
            name: r.name,
            description: r.description ?? '',
            allowReentry: r.allow_reentry ?? false,
            totalContacts: total,
            completed,
            completedWithErrors,
            failed,
            skipped,
            pending: Math.max(0, total - completed - completedWithErrors - failed),
            completedNodes: r.nodes?.filter((n: any) => n.type !== 'trigger').length ?? 0,
            lastUpdated: r.updated_at ? format(new Date(r.updated_at), 'dd MMM') : '-',
            status: r.status as 'active' | 'inactive',
            nodes: r.nodes ?? [],
            apiToken: r.api_token ?? '',
          };
        });
        setWorkflows(mapped);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchWorkflows(); }, []);
  // Live-refresh workflows on any tenant data change (no manual reload).
  useLiveRefresh(() => { fetchWorkflows(); });

  const filtered = useMemo(() => {
    let list = [...workflows];
    if (search) list = list.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()) || w.description.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter === 'Active') list = list.filter((w) => w.status === 'active');
    if (statusFilter === 'Paused') list = list.filter((w) => w.status === 'inactive');
    return list;
  }, [workflows, search, statusFilter]);

  const stats = useMemo(() => ({
    total: workflows.length,
    active: workflows.filter((w) => w.status === 'active').length,
    paused: workflows.filter((w) => w.status === 'inactive').length,
    contacts: workflows.reduce((s, w) => s + w.totalContacts, 0),
    completed: workflows.reduce((s, w) => s + w.completed, 0),
  }), [workflows]);

  const FORM_TRIGGERS = ['opt_in_form', 'meta_form', 'product_enquired'];

  const toggleStatus = async (id: string) => {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) return;
    const newStatus = wf.status === 'active' ? 'inactive' : 'active';
    if (newStatus === 'active') {
      const triggerNode = wf.nodes.find((n) => n.type === 'trigger' && n.actionType);
      if (!triggerNode) { setNoTriggerPopup(true); return; }
      // Form triggers require at least one form - blank = must stay inactive
      if (FORM_TRIGGERS.includes(triggerNode.actionType)) {
        const forms = triggerNode.config?.forms as string[] | undefined;
        if (!forms || forms.length === 0) {
          toast.error('Select at least one form before activating this workflow.');
          return;
        }
      }
    }
    setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, status: newStatus as 'active' | 'inactive' } : w));
    await api.patch(`/api/workflows/${id}`, { status: newStatus }).catch(() => null);
    toast.success(newStatus === 'active' ? 'Workflow activated' : 'Workflow paused');
  };

  const deleteWorkflow = async (id: string) => {
    const wf = workflows.find((w) => w.id === id);
    try {
      await api.delete(`/api/workflows/${id}`);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      toast.success(`"${wf?.name}" deleted`);
    } catch {
      toast.error('Failed to delete workflow');
    }
    setDeleteConfirmId(null);
    setOpenMenu(null);
  };

  const bulkDelete = async () => {
    const ids = [...selectedRows];
    if (!ids.length) return;
    setBulkDeleting(true);
    const results = await Promise.allSettled(ids.map((id) => api.delete(`/api/workflows/${id}`)));
    const okIds = ids.filter((_, i) => results[i].status === 'fulfilled');
    const failCount = ids.length - okIds.length;
    if (okIds.length) {
      const okSet = new Set(okIds);
      setWorkflows((prev) => prev.filter((w) => !okSet.has(w.id)));
    }
    setSelectedRows(new Set());
    setBulkDeleting(false);
    setBulkDeleteConfirm(false);
    if (failCount === 0) toast.success(`${okIds.length} workflow${okIds.length > 1 ? 's' : ''} deleted`);
    else if (okIds.length) toast.error(`Deleted ${okIds.length}, ${failCount} failed`);
    else toast.error('Failed to delete workflows');
  };

  const retryErrors = async (wf: WFRecord) => {
    try {
      const logs = await api.get<any[]>(`/api/workflows/${wf.id}/logs`);
      const seen = new Set<string>();
      const errorLeadIds: string[] = [];
      for (const log of logs ?? []) {
        if (log.status === 'completed_with_errors' && log.lead_id && !seen.has(log.lead_id)) {
          seen.add(log.lead_id);
          errorLeadIds.push(log.lead_id);
        }
      }
      if (errorLeadIds.length === 0) {
        toast.info('No error contacts to retry');
        return;
      }
      await api.post(`/api/workflows/${wf.id}/bulk-trigger`, { lead_ids: errorLeadIds, force: true });
      toast.success(`Retrying ${errorLeadIds.length} contact${errorLeadIds.length !== 1 ? 's' : ''} with errors`);
      setTimeout(fetchWorkflows, 1500);
    } catch {
      toast.error('Failed to retry error contacts');
    }
    setOpenMenu(null);
  };

  const retrySkipped = async (wf: WFRecord) => {
    try {
      const logs = await api.get<any[]>(`/api/workflows/${wf.id}/logs`);
      const seen = new Set<string>();
      const skippedLeadIds: string[] = [];
      for (const log of logs ?? []) {
        if (log.status === 'skipped' && log.lead_id && !seen.has(log.lead_id)) {
          seen.add(log.lead_id);
          skippedLeadIds.push(log.lead_id);
        }
      }
      if (skippedLeadIds.length === 0) {
        toast.info('No skipped contacts to retry');
        return;
      }
      await api.post(`/api/workflows/${wf.id}/bulk-trigger`, { lead_ids: skippedLeadIds, force: true });
      toast.success(`Retrying ${skippedLeadIds.length} skipped contact${skippedLeadIds.length !== 1 ? 's' : ''}`);
      setTimeout(fetchWorkflows, 1500);
    } catch {
      toast.error('Failed to retry skipped contacts');
    }
    setOpenMenu(null);
  };

  const toggleReentry = async (wf: WFRecord) => {
    const newVal = !wf.allowReentry;
    setWorkflows((prev) => prev.map((w) => w.id === wf.id ? { ...w, allowReentry: newVal } : w));
    await api.patch(`/api/workflows/${wf.id}`, { allow_reentry: newVal }).catch(() => null);
    toast.success(newVal ? 'Re-entry enabled' : 'Re-entry disabled');
  };

  const runBroadcast = async (wf: WFRecord) => {
    const triggerNode = wf.nodes.find((n) => n.type === 'trigger');
    if (!triggerNode?.config?.group_id) {
      toast.error('No contact group configured - edit the workflow trigger first.');
      return;
    }
    try {
      const result = await api.post<any>(`/api/workflows/${wf.id}/broadcast-group`);
      const mins = result.estimated_minutes ?? 0;
      toast.success(
        `Broadcast started - ${result.queued} messages queued for "${result.group}". ${mins > 0 ? `Est. ${mins} min to complete.` : 'Sending now.'}`
      );
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to start broadcast');
    }
    setOpenMenu(null);
  };

  const duplicateWorkflow = async (wf: WFRecord) => {
    try {
      const created = await api.post<any>('/api/workflows', {
        name: `${wf.name} (Copy)`, description: wf.description,
        nodes: wf.nodes, status: 'inactive', allow_reentry: wf.allowReentry,
      });
      setWorkflows((prev) => [{
        ...wf, id: created.id, name: `${wf.name} (Copy)`,
        totalContacts: 0, completed: 0, completedWithErrors: 0, failed: 0, skipped: 0, pending: 0,
        status: 'inactive', lastUpdated: 'just now',
      }, ...prev]);
      toast.success('Workflow duplicated');
    } catch { toast.error('Failed to duplicate'); }
    setOpenMenu(null);
  };

  const handleNew = async () => {
    try {
      const created = await api.post<any>('/api/workflows', {
        name: 'Untitled Automation', description: '',
        nodes: [{ id: 'n1', type: 'trigger', actionType: '', label: 'Select Trigger', config: {} }],
        status: 'inactive', allow_reentry: false,
      });
      const newWF: WFRecord = {
        id: created.id, name: created.name, description: '',
        allowReentry: false, totalContacts: 0, completed: 0, completedWithErrors: 0, failed: 0, skipped: 0, pending: 0,
        completedNodes: 0, lastUpdated: 'just now', status: 'inactive',
        nodes: created.nodes ?? [],
      };
      setWorkflows((prev) => [newWF, ...prev]);
      navigate(`/automation/editor/${created.id}`, { state: { workflow: newWF } });
    } catch { toast.error('Failed to create workflow'); }
  };

  const shadowStyle = { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' };

  return (
    <div className="flex flex-col flex-1 animate-fade-in min-h-0">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between pb-4">
        {/* Filter cards */}
        <div className="flex items-center gap-3">
          {/* Total Workflows */}
          <button
            onClick={() => setStatusFilter('All')}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all',
              statusFilter === 'All'
                ? 'bg-[#1c1410] border-[#1c1410] text-white shadow-sm'
                : 'bg-white border-black/[0.07] text-[#1c1410] hover:border-black/20'
            )}
          >
            <Zap className={cn('w-4 h-4', statusFilter === 'All' ? 'text-orange-300' : 'text-primary')} />
            <div className="text-left">
              <p className="text-[15px] font-bold leading-tight">{stats.total}</p>
              <p className={cn('text-[10px]', statusFilter === 'All' ? 'text-white/60' : 'text-[#7a6b5c]')}>Total Workflows</p>
            </div>
          </button>

          {/* Active */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'Active' ? 'All' : 'Active')}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all',
              statusFilter === 'Active'
                ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                : 'bg-white border-black/[0.07] text-[#1c1410] hover:border-emerald-200'
            )}
          >
            <ToggleRight className={cn('w-4 h-4', statusFilter === 'Active' ? 'text-white' : 'text-emerald-500')} />
            <div className="text-left">
              <p className="text-[15px] font-bold leading-tight">{stats.active}</p>
              <p className={cn('text-[10px]', statusFilter === 'Active' ? 'text-white/70' : 'text-[#7a6b5c]')}>Active</p>
            </div>
          </button>

          {/* Inactive */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'Paused' ? 'All' : 'Paused')}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all',
              statusFilter === 'Paused'
                ? 'bg-gray-500 border-gray-500 text-white shadow-sm'
                : 'bg-white border-black/[0.07] text-[#1c1410] hover:border-gray-300'
            )}
          >
            <ToggleLeft className={cn('w-4 h-4', statusFilter === 'Paused' ? 'text-white' : 'text-gray-400')} />
            <div className="text-left">
              <p className="text-[15px] font-bold leading-tight">{stats.paused}</p>
              <p className={cn('text-[10px]', statusFilter === 'Paused' ? 'text-white/70' : 'text-[#7a6b5c]')}>Inactive</p>
            </div>
          </button>
        </div>

        {canManageAutomation && (
          <button onClick={handleNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-bold text-white transition-all hover:-translate-y-0.5 shrink-0" style={shadowStyle}>
            <Plus className="w-4 h-4" /> Create Workflow
          </button>
        )}
      </div>

      {/* Workflow search moved to the navbar (context-aware header search). */}

      {/* ── Bulk action bar ── */}
      {canManageAutomation && selectedRows.size > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/20">
          <p className="text-[14px] font-semibold text-[#1c1410]">
            {selectedRows.size} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedRows(new Set())}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-[#7a6b5c] hover:bg-black/5 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete selected ({selectedRows.size})
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="flex flex-1 min-h-0 rounded-2xl border border-black/[0.06] overflow-hidden bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

        {/* List */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {/* Column header */}
          <div className="flex items-center border-b border-black/[0.06] bg-[var(--app-bg)] sticky top-0 z-10">
            {/* Select-all checkbox */}
            <div className="w-10 flex items-center justify-center shrink-0 py-2.5">
              <button
                onClick={() => {
                  const allIds = filtered.map((w) => w.id);
                  const allSelected = allIds.length > 0 && allIds.every((id) => selectedRows.has(id));
                  setSelectedRows(allSelected ? new Set() : new Set(allIds));
                }}
                className={cn(
                  'w-4 h-4 rounded border-2 flex items-center justify-center transition-all',
                  filtered.length > 0 && filtered.every((w) => selectedRows.has(w.id))
                    ? 'bg-primary border-primary'
                    : filtered.some((w) => selectedRows.has(w.id))
                      ? 'bg-primary/30 border-primary'
                      : 'border-gray-300 bg-white hover:border-primary/60'
                )}
              >
                {filtered.length > 0 && filtered.some((w) => selectedRows.has(w.id)) && (
                  filtered.every((w) => selectedRows.has(w.id))
                    ? <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    : <Minus className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                )}
              </button>
            </div>
            <p className="flex-1 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] py-2.5">Automation Name</p>
            <p className="w-32 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] text-center shrink-0 py-2.5">Allow Re-entry</p>
            <p className="w-20 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] text-center shrink-0 py-2.5">Done</p>
            <p className="w-20 text-[11px] font-bold uppercase tracking-wider text-amber-500 text-center shrink-0 py-2.5">Errors</p>
            <p className="w-20 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] text-center shrink-0 py-2.5">Skipped</p>
            <p className="w-24 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] text-center shrink-0 py-2.5">Contacts</p>
            <p className="w-20 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] text-center shrink-0 py-2.5">Failed</p>
            <p className="w-20 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] text-center shrink-0 py-2.5">Status</p>
            <div className="w-10 shrink-0" />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <p className="text-[15px] font-bold text-[#1c1410] mb-1">{search ? 'No results' : 'No workflows yet'}</p>
              <p className="text-[13px] text-[#7a6b5c] mb-4">{search ? 'Try a different search.' : 'Create your first workflow to start automating.'}</p>
              {!search && canManageAutomation && (
                <button onClick={handleNew} className="flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-bold text-white" style={shadowStyle}>
                  <Plus className="w-4 h-4" /> Create Workflow
                </button>
              )}
            </div>
          ) : (
            filtered.map((wf) => (
              <WorkflowRow
                key={wf.id} wf={wf}
                onOpen={() => navigate(`/automation/editor/${wf.id}`, { state: { workflow: wf } })}
                onToggle={() => toggleStatus(wf.id)}
                onDuplicate={() => duplicateWorkflow(wf)}
                onDelete={() => { setOpenMenu(null); setDeleteConfirmId(wf.id); }}
                menuOpen={openMenu === wf.id}
                onToggleMenu={() => setOpenMenu(openMenu === wf.id ? null : wf.id)}
                onContactPanel={(status) => setContactPanel({ wf, status })}
                onAnalytics={() => navigate(`/automation/analytics/${wf.id}`)}
                onRetry={() => retrySkipped(wf)}
                onRetryErrors={() => retryErrors(wf)}
                onToggleReentry={() => toggleReentry(wf)}
                selected={selectedRows.has(wf.id)}
                onSelect={() => setSelectedRows((prev) => { const n = new Set(prev); n.has(wf.id) ? n.delete(wf.id) : n.add(wf.id); return n; })}
                onRunBroadcast={() => runBroadcast(wf)}
              />
            ))
          )}
        </div>
      </div>

      {contactPanel && (
        <ContactSidebar
          workflow={contactPanel.wf}
          filterStatus={contactPanel.status}
          onClose={() => setContactPanel(null)}
        />
      )}

      {noTriggerPopup && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setNoTriggerPopup(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <span className="text-amber-600 text-lg font-bold">!</span>
            </div>
            <h3 className="text-[15px] font-bold text-[#1c1410] mb-2">No Trigger Set</h3>
            <p className="text-[14px] text-[#7a6b5c] mb-6">A workflow must have a trigger before it can be activated. Open the editor and choose a trigger first.</p>
            <button
              onClick={() => setNoTriggerPopup(false)}
              className="w-full py-2.5 rounded-xl bg-[var(--brand-dark)] hover:bg-[var(--brand)] text-white text-[14px] font-bold transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
      {deleteConfirmId && (() => {
        const wf = workflows.find((w) => w.id === deleteConfirmId);
        return (
          <ConfirmDeleteModal
            title="Delete Workflow?"
            message={<>Delete <span className="font-semibold text-[#1c1410]">"{wf?.name}"</span>? All execution history will be lost. This cannot be undone.</>}
            confirmLabel="Yes, Delete"
            onConfirm={() => deleteWorkflow(deleteConfirmId)}
            onClose={() => setDeleteConfirmId(null)}
          />
        );
      })()}

      {bulkDeleteConfirm && (
        <ConfirmDeleteModal
          title={`Delete ${selectedRows.size} Workflow${selectedRows.size > 1 ? 's' : ''}?`}
          message={<>Delete <span className="font-semibold text-[#1c1410]">{selectedRows.size}</span> selected workflow{selectedRows.size > 1 ? 's' : ''}? All their execution history will be lost. This cannot be undone.</>}
          confirmLabel={bulkDeleting ? 'Deleting…' : 'Yes, Delete'}
          onConfirm={bulkDelete}
          onClose={() => { if (!bulkDeleting) setBulkDeleteConfirm(false); }}
        />
      )}
    </div>
  );
}
