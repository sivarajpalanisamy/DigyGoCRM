import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  CheckCircle2, Circle, Plus, Search, X, Clock,
  Calendar, Loader2, Phone, User, ChevronDown, Check,
} from 'lucide-react';
import {
  format, isToday, isBefore, startOfDay, parseISO, isSameDay,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';
import { useCrmStore } from '@/store/crmStore';
import { Lead } from '@/data/mockData';
import { LeadDetailPanel } from './LeadsPage';
import { useUserLevel } from '@/hooks/useUserLevel';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FUItem {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  title: string;
  description?: string;
  dueAt: string;
  completed: boolean;
  assignedTo?: string;
  assignedName?: string;
}

type FUFilter = 'all' | 'overdue' | 'today' | 'upcoming' | 'completed';
type FUStatus = 'overdue' | 'today' | 'upcoming' | 'completed';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStatus(fu: FUItem): FUStatus {
  if (fu.completed) return 'completed';
  const due = startOfDay(parseISO(fu.dueAt));
  const now = startOfDay(new Date());
  if (isBefore(due, now)) return 'overdue';
  if (isSameDay(due, now)) return 'today';
  return 'upcoming';
}

function mapApi(f: any): FUItem {
  return {
    id:          f.id,
    leadId:      f.lead_id,
    leadName:    f.lead_name  ?? 'Unknown Lead',
    leadPhone:   f.lead_phone ?? '',
    title:       f.title,
    description: f.description ?? undefined,
    dueAt:       f.due_at,
    completed:   f.completed ?? false,
    assignedTo:  f.assigned_to  ?? undefined,
    assignedName: f.assigned_name ?? undefined,
  };
}

const S: Record<FUStatus, { bar: string; bg: string; text: string; border: string; label: string }> = {
  overdue:   { bar: 'bg-red-400',    bg: 'bg-red-50',     text: 'text-red-600',    border: 'border-red-200',    label: 'Overdue'   },
  today:     { bar: 'bg-[var(--brand-dark)]',  bg: 'bg-orange-50',  text: 'text-[var(--brand-dark)]', border: 'border-orange-200', label: 'Today'     },
  upcoming:  { bar: 'bg-violet-400', bg: 'bg-violet-50',  text: 'text-violet-700', border: 'border-violet-200', label: 'Upcoming'  },
  completed: { bar: 'bg-gray-300',   bg: 'bg-gray-100',   text: 'text-gray-500',   border: 'border-gray-200',   label: 'Done'      },
};

// ── Create Follow-up Modal ─────────────────────────────────────────────────────

function CreateModal({
  onClose,
  onCreated,
  currentUserId,
  preselectedLead,
}: {
  onClose: () => void;
  onCreated: (fu: FUItem) => void;
  currentUserId: string;
  preselectedLead?: { id: string; name: string; phone: string };
}) {
  const [step, setStep]               = useState<'search' | 'form'>(preselectedLead ? 'form' : 'search');
  const [search, setSearch]           = useState('');
  const [results, setResults]         = useState<any[]>([]);
  const [searching, setSearching]     = useState(false);
  const [selectedLead, setSelectedLead] = useState<{ id: string; name: string; phone: string } | null>(preselectedLead ?? null);
  const [title, setTitle]             = useState('');
  const [date, setDate]               = useState(format(new Date(), 'yyyy-MM-dd'));
  const [time, setTime]               = useState('09:00');
  const [note, setNote]               = useState('');
  const [saving, setSaving]           = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.get<any[]>(`/api/leads?search=${encodeURIComponent(search)}&limit=20`);
        setResults(data ?? []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
  }, [search]);

  const selectLead = (lead: any) => {
    setSelectedLead({ id: lead.id, name: lead.name, phone: lead.phone ?? '' });
    setStep('form');
  };

  const submit = async () => {
    if (!selectedLead || !title.trim() || !date || !time) return;
    setSaving(true);
    try {
      const due_at = new Date(`${date}T${time}:00`).toISOString();
      const created = await api.post<any>(`/api/leads/${selectedLead.id}/followups`, {
        title: title.trim(),
        description: note.trim() || undefined,
        due_at,
        assigned_to: currentUserId,
      });
      onCreated(mapApi({ ...created, lead_name: selectedLead.name, lead_phone: selectedLead.phone }));
      toast.success('Follow-up scheduled');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to create follow-up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#f0ebe5]">
          <div>
            <h3 className="text-[15px] font-bold text-[#1c1410]">
              {step === 'search' ? 'New Follow-up' : `Follow-up · ${selectedLead?.name}`}
            </h3>
            {step === 'form' && selectedLead?.phone && (
              <a href={`tel:${selectedLead.phone}`} className="text-[12px] text-[#7a6b5c] mt-0.5 hover:text-primary transition-colors block">{selectedLead.phone}</a>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 'form' && !preselectedLead && (
              <button onClick={() => setStep('search')}
                className="text-[12px] text-[#7a6b5c] hover:text-[var(--brand-dark)] transition-colors font-medium">
                Change lead
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Step 1 — Lead Search */}
        {step === 'search' && (
          <div className="px-5 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#b09e8d]" />
              <input
                autoFocus
                placeholder="Search lead by name or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 h-11 rounded-xl border border-black/10 text-[13px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
              />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--brand-dark)] animate-spin" />}
            </div>

            <div className="mt-3 max-h-60 overflow-y-auto space-y-1">
              {search.trim().length < 2 ? (
                <p className="text-[12px] text-[#b09e8d] text-center py-6">Type at least 2 characters to search</p>
              ) : results.length === 0 && !searching ? (
                <p className="text-[12px] text-[#b09e8d] text-center py-6">No leads found</p>
              ) : results.map((lead) => (
                <button key={lead.id} onClick={() => selectLead(lead)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#faf0e8] transition-colors text-left">
                  <div className="w-8 h-8 rounded-full bg-[var(--accent-tint)] flex items-center justify-center text-[11px] font-bold text-[var(--brand-dark)] shrink-0">
                    {(lead.name ?? '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#1c1410] truncate">{lead.name}</p>
                    {lead.phone && <a href={`tel:${lead.phone}`} className="text-[11px] text-[#7a6b5c] hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>{lead.phone}</a>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Form */}
        {step === 'form' && (
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1.5">
                What to follow up on *
              </label>
              <input
                autoFocus
                placeholder="e.g. Call back after demo"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 h-10 rounded-xl border border-black/10 text-[13px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1.5">Date *</label>
                <input
                  type="date"
                  value={date}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 h-10 rounded-xl border border-black/10 text-[13px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1.5">Time *</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3 h-10 rounded-xl border border-black/10 text-[13px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1.5">Note</label>
              <textarea
                placeholder="Optional note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-black/10 text-[13px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all resize-none"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={onClose}
                className="flex-1 h-10 rounded-xl border border-black/10 text-[13px] font-semibold text-[#7a6b5c] hover:bg-[var(--accent-tint)] transition-colors">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={saving || !title.trim() || !date || !time}
                className="flex-1 h-10 rounded-xl text-[13px] font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Schedule</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Complete Modal ─────────────────────────────────────────────────────────────

function CompleteModal({
  fu,
  currentUserId,
  onDone,
  onCancel,
}: {
  fu: FUItem;
  currentUserId: string;
  onDone: (created?: FUItem) => void;
  onCancel: () => void;
}) {
  const [date, setDate]   = useState('');
  const [time, setTime]   = useState('09:00');
  const [note, setNote]   = useState('');
  const [saving, setSaving] = useState(false);

  const markDoneOnly = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/leads/${fu.leadId}/followups/${fu.id}`, { completed: true });
      toast.success('Marked as done');
      onDone();
    } catch {
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const markDoneAndSchedule = async () => {
    if (!date) return;
    setSaving(true);
    try {
      await api.patch(`/api/leads/${fu.leadId}/followups/${fu.id}`, { completed: true });
      const due_at = new Date(`${date}T${time}:00`).toISOString();
      const created = await api.post<any>(`/api/leads/${fu.leadId}/followups`, {
        title: note.trim() || 'Follow-up',
        due_at,
        assigned_to: currentUserId,
      });
      toast.success('Done · next follow-up scheduled');
      onDone(mapApi({ ...created, lead_name: fu.leadName, lead_phone: fu.leadPhone }));
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-[#f0ebe5]">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide mb-1">Mark as Done</p>
            <h3 className="text-[15px] font-bold text-[#1c1410] truncate">{fu.leadName}</h3>
            {fu.leadPhone && <p className="text-[12px] text-[#7a6b5c] mt-0.5">{fu.leadPhone}</p>}
            <p className="text-[11px] text-[#b09e8d] mt-1.5 line-clamp-1">"{fu.title}"</p>
          </div>
          <button onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Schedule next */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-[13px] font-bold text-[#1c1410]">Schedule next follow-up</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1.5">Date</label>
              <input
                autoFocus
                type="date"
                value={date}
                min={format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 h-10 rounded-xl border border-black/10 text-[13px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1.5">Time</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 h-10 rounded-xl border border-black/10 text-[13px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1.5">Note</label>
            <input
              placeholder="What to follow up on…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 h-10 rounded-xl border border-black/10 text-[13px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={markDoneOnly}
              disabled={saving}
              className="flex-1 h-10 rounded-xl border border-black/10 text-[12px] font-semibold text-[#7a6b5c] hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-50"
            >
              No Follow-up Needed
            </button>
            <button
              onClick={markDoneAndSchedule}
              disabled={saving || !date}
              className="flex-1 h-10 rounded-xl text-[13px] font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Done &amp; Schedule</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Follow-up Card ─────────────────────────────────────────────────────────────

function FollowUpCard({
  fu,
  showAssignee,
  onToggle,
  onNavigate,
}: {
  fu: FUItem;
  showAssignee: boolean;
  onToggle: (fu: FUItem) => void;
  onNavigate: (leadId: string) => void;
}) {
  const st = getStatus(fu);
  const [toggling, setToggling] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setToggling(true);
    await onToggle(fu);
    setToggling(false);
  };

  const formattedDate = (() => {
    try {
      const d = parseISO(fu.dueAt);
      if (isToday(d)) return `Today · ${format(d, 'h:mm a')}`;
      return format(d, 'dd MMM · h:mm a');
    } catch { return fu.dueAt; }
  })();

  return (
    <div
      onClick={() => onNavigate(fu.leadId)}
      className={cn(
        'group flex items-stretch bg-white rounded-xl border transition-all cursor-pointer hover:shadow-md hover:-translate-y-[1px]',
        fu.completed ? 'border-black/5 opacity-60' : 'border-black/8',
        st === 'overdue' && !fu.completed && 'border-red-200',
      )}
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
    >
      {/* Left status bar */}
      <div className={cn('w-1 rounded-l-xl shrink-0', S[st].bar)} />

      {/* Content */}
      <div className="flex-1 min-w-0 px-4 py-3">
        {/* Lead name + phone */}
        <div className="flex items-center gap-2 mb-1">
          <p className={cn('text-[13px] font-bold truncate', fu.completed ? 'line-through text-gray-400' : 'text-[#1c1410]')}>
            {fu.leadName}
          </p>
          <span className={cn('shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border', S[st].bg, S[st].text, S[st].border)}>
            {S[st].label}
          </span>
        </div>

        {fu.leadPhone && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <Phone className="w-3 h-3 text-[#b09e8d]" />
            <span className="text-[11px] text-[#7a6b5c]">{fu.leadPhone}</span>
          </div>
        )}

        {/* Title */}
        <p className={cn('text-[12px] font-medium', fu.completed ? 'text-gray-400 line-through' : 'text-[#4a3c30]')}>
          {fu.title}
        </p>

        {/* Note */}
        {fu.description && (
          <p className="text-[11px] text-[#7a6b5c] mt-0.5 line-clamp-1">{fu.description}</p>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-[#b09e8d]" />
            <span className={cn('text-[11px]', st === 'overdue' && !fu.completed ? 'text-red-500 font-semibold' : 'text-[#7a6b5c]')}>
              {formattedDate}
            </span>
          </div>
          {showAssignee && fu.assignedName && (
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3 text-[#b09e8d]" />
              <span className="text-[11px] text-[#7a6b5c]">{fu.assignedName}</span>
            </div>
          )}
        </div>
      </div>

      {/* Complete button */}
      <div className="flex items-center pr-4 pl-2 shrink-0" onClick={handleToggle}>
        <button
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center transition-all',
            fu.completed
              ? 'bg-gray-100 text-gray-400 hover:bg-gray-200'
              : 'bg-[#fff0e6] text-[var(--brand-dark)] hover:bg-[var(--accent-tint)] group-hover:scale-110',
          )}
          title={fu.completed ? 'Mark as pending' : 'Mark as done'}
        >
          {toggling
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : fu.completed
              ? <CheckCircle2 className="w-5 h-5" />
              : <Circle className="w-5 h-5" />
          }
        </button>
      </div>
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className={cn('text-[11px] font-bold uppercase tracking-wider', color)}>{label}</span>
      <span className="text-[11px] font-bold text-[#b09e8d]">{count}</span>
      <div className="flex-1 h-px bg-black/5" />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function FollowUpsPage() {
  const { currentUser } = useAuthStore();
  const { staff, pipelines } = useCrmStore();
  const level = useUserLevel();

  const [items, setItems]           = useState<FUItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState<FUFilter>('today');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [pipelineFilter, setPipelineFilter] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [search, setSearch]         = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [pendingComplete, setPendingComplete] = useState<FUItem | null>(null);
  const [openLead, setOpenLead]     = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(false);

  const isAdminOrOwner = level !== 'staff';

  const selectedPipelineStages = pipelineFilter
    ? pipelines.find((p) => p.id === pipelineFilter)?.stages ?? []
    : [];

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (pipelineFilter) params.set('pipeline_id', pipelineFilter);
      if (stageFilter) params.set('stage_id', stageFilter);
      const qs = params.toString();
      const rows = await api.get<any[]>(`/api/leads/followups${qs ? `?${qs}` : ''}`);
      setItems((rows ?? []).map(mapApi));
    } catch {
      toast.error('Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [pipelineFilter, stageFilter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // ── Toggle complete ──
  // Completing → open modal (no API yet). Un-completing → direct API call.
  const handleToggle = useCallback(async (fu: FUItem) => {
    if (!fu.completed) {
      setPendingComplete(fu);
      return;
    }
    // Un-complete: optimistic revert
    setItems((prev) => prev.map((f) => f.id === fu.id ? { ...f, completed: false } : f));
    try {
      await api.patch(`/api/leads/${fu.leadId}/followups/${fu.id}`, { completed: false });
    } catch {
      setItems((prev) => prev.map((f) => f.id === fu.id ? { ...f, completed: true } : f));
      toast.error('Failed to update follow-up');
    }
  }, []);

  // ── After complete modal resolves ──
  const handleCompleteDone = useCallback((created?: FUItem) => {
    if (pendingComplete) {
      setItems((prev) => prev.map((f) => f.id === pendingComplete.id ? { ...f, completed: true } : f));
    }
    if (created) setItems((prev) => [created, ...prev]);
    setPendingComplete(null);
  }, [pendingComplete]);

  // ── Filtered items ──
  const visible = useMemo(() => {
    let list = [...items];

    // Staff filter (admin only)
    if (isAdminOrOwner && staffFilter !== 'all') {
      list = list.filter((f) => f.assignedTo === staffFilter);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((f) =>
        f.leadName.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.leadPhone.includes(q)
      );
    }

    // Status filter
    if (filter === 'overdue')   return list.filter((f) => getStatus(f) === 'overdue');
    if (filter === 'today')     return list.filter((f) => getStatus(f) === 'today');
    if (filter === 'upcoming')  return list.filter((f) => getStatus(f) === 'upcoming');
    if (filter === 'completed') return list.filter((f) => getStatus(f) === 'completed');
    return list;
  }, [items, filter, staffFilter, search, isAdminOrOwner]);

  // ── Stats ──
  const stats = useMemo(() => {
    const base = isAdminOrOwner && staffFilter !== 'all'
      ? items.filter((f) => f.assignedTo === staffFilter)
      : items;
    return {
      overdue:   base.filter((f) => getStatus(f) === 'overdue').length,
      today:     base.filter((f) => getStatus(f) === 'today').length,
      upcoming:  base.filter((f) => getStatus(f) === 'upcoming').length,
      completed: base.filter((f) => getStatus(f) === 'completed').length,
    };
  }, [items, staffFilter, isAdminOrOwner]);

  // ── Grouped (for "All" tab) ──
  const grouped = useMemo(() => {
    if (filter !== 'all') return null;
    return {
      overdue:   visible.filter((f) => getStatus(f) === 'overdue'),
      today:     visible.filter((f) => getStatus(f) === 'today'),
      upcoming:  visible.filter((f) => getStatus(f) === 'upcoming'),
      completed: visible.filter((f) => getStatus(f) === 'completed'),
    };
  }, [visible, filter]);

  const handleLeadClick = async (leadId: string) => {
    if (loadingLead) return;
    setLoadingLead(true);
    try {
      const l = await api.get<any>(`/api/leads/${leadId}`);
      const stageMap: Record<string, string> = {};
      pipelines.forEach((p) => p.stages.forEach((s) => { stageMap[s.id] = s.name; }));
      const parts = (l.name ?? '').split(' ');
      const lead: Lead = {
        id: l.id,
        firstName: l.first_name ?? parts[0] ?? '',
        lastName: l.last_name ?? parts.slice(1).join(' ') ?? '',
        email: l.email ?? '',
        phone: l.phone ?? '',
        stage: stageMap[l.stage_id] ?? l.stage_name ?? 'New Lead',
        stageId: l.stage_id ?? '',
        pipelineId: l.pipeline_id ?? '',
        source: l.source ?? 'Manual',
        tags: l.tags ?? [],
        assignedTo: l.assigned_to ?? '',
        assignedName: l.assigned_name ?? '',
        createdAt: l.created_at ?? new Date().toISOString(),
        lastActivity: l.updated_at ?? l.created_at ?? new Date().toISOString(),
        businessName: '',
        city: '',
        notes: l.notes ?? '',
        dealValue: Number(l.deal_value ?? 0),
        value: 0,
        probability: 0,
        nextFollowUp: null,
        customFields: {},
      };
      setOpenLead(lead);
    } catch {
      toast.error('Failed to load lead details');
    } finally {
      setLoadingLead(false);
    }
  };

  const TABS: { key: FUFilter; label: string; count: number; color: string }[] = [
    { key: 'all',       label: 'All',       count: items.length,      color: 'text-[#1c1410]' },
    { key: 'overdue',   label: 'Overdue',   count: stats.overdue,     color: 'text-red-600'   },
    { key: 'today',     label: 'Today',     count: stats.today,       color: 'text-[var(--brand-dark)]' },
    { key: 'upcoming',  label: 'Upcoming',  count: stats.upcoming,    color: 'text-violet-600' },
    { key: 'completed', label: 'Completed', count: stats.completed,   color: 'text-gray-500'  },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Top Bar ── */}
      <div className="flex items-start justify-between gap-4 pb-4 flex-wrap">
        <div>
          <h2 className="font-headline text-[24px] font-extrabold text-[#1c1410] leading-tight">Follow-ups</h2>
          <p className="text-[12px] text-[#7a6b5c] mt-0.5">{items.length} total tasks</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Staff filter — admin/owner only */}
          {isAdminOrOwner && staff.length > 0 && (
            <div className="relative">
              <select
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-8 rounded-xl border border-black/10 text-[12px] font-medium text-[#1c1410] bg-white outline-none focus:border-primary/40 cursor-pointer transition-all"
              >
                <option value="all">All Staff</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#7a6b5c] pointer-events-none" />
            </div>
          )}

          {/* Pipeline filter */}
          {pipelines.length > 0 && (
            <div className="relative">
              <select
                value={pipelineFilter}
                onChange={(e) => { setPipelineFilter(e.target.value); setStageFilter(''); }}
                className="appearance-none h-9 pl-3 pr-8 rounded-xl border border-black/10 text-[12px] font-medium text-[#1c1410] bg-white outline-none focus:border-primary/40 cursor-pointer transition-all"
              >
                <option value="">All Pipelines</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#7a6b5c] pointer-events-none" />
            </div>
          )}

          {/* Stage filter */}
          {pipelineFilter && selectedPipelineStages.length > 0 && (
            <div className="relative">
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-8 rounded-xl border border-black/10 text-[12px] font-medium text-[#1c1410] bg-white outline-none focus:border-primary/40 cursor-pointer transition-all"
              >
                <option value="">All Stages</option>
                {selectedPipelineStages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#7a6b5c] pointer-events-none" />
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b09e8d]" />
            <input
              placeholder="Search lead or task…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 h-9 rounded-xl border border-black/10 text-[12px] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 bg-white transition-all w-48"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-[#b09e8d]" />
              </button>
            )}
          </div>

          {/* New follow-up */}
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 h-9 px-4 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 12px rgba(194,65,12,0.3)' }}
          >
            <Plus className="w-4 h-4" /> New Follow-up
          </button>
        </div>
      </div>

      {/* ── Filter Tabs ── */}
      <div className="flex items-center gap-1 pb-4 border-b border-[#f0ebe5] overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold whitespace-nowrap transition-all',
              filter === tab.key
                ? 'bg-[#1c1410] text-white'
                : 'text-[#7a6b5c] hover:bg-[var(--accent-tint)] hover:text-[#1c1410]'
            )}
          >
            {tab.label}
            <span className={cn(
              'text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none',
              filter === tab.key ? 'bg-white/20 text-white' : 'bg-[#f0ebe5] text-[#7a6b5c]'
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto pt-4 pb-24">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center mb-3">
              <Calendar className="w-6 h-6 text-[var(--brand-dark)]" />
            </div>
            <p className="text-[15px] font-bold text-[#1c1410] mb-1">
              {filter === 'today' ? 'Nothing due today' : `No ${filter} follow-ups`}
            </p>
            <p className="text-[12px] text-[#7a6b5c]">
              {search ? 'Try a different search term.' : 'You\'re all caught up!'}
            </p>
          </div>
        ) : filter === 'all' && grouped ? (
          // Grouped view for "All" tab
          <div className="space-y-6 max-w-2xl">
            {grouped.overdue.length > 0 && (
              <div>
                <SectionHeader label="Overdue" count={grouped.overdue.length} color="text-red-500" />
                <div className="space-y-2">
                  {grouped.overdue.map((fu) => (
                    <FollowUpCard key={fu.id} fu={fu} showAssignee={isAdminOrOwner} onToggle={handleToggle} onNavigate={handleLeadClick} />
                  ))}
                </div>
              </div>
            )}
            {grouped.today.length > 0 && (
              <div>
                <SectionHeader label="Today" count={grouped.today.length} color="text-[var(--brand-dark)]" />
                <div className="space-y-2">
                  {grouped.today.map((fu) => (
                    <FollowUpCard key={fu.id} fu={fu} showAssignee={isAdminOrOwner} onToggle={handleToggle} onNavigate={handleLeadClick} />
                  ))}
                </div>
              </div>
            )}
            {grouped.upcoming.length > 0 && (
              <div>
                <SectionHeader label="Upcoming" count={grouped.upcoming.length} color="text-violet-600" />
                <div className="space-y-2">
                  {grouped.upcoming.map((fu) => (
                    <FollowUpCard key={fu.id} fu={fu} showAssignee={isAdminOrOwner} onToggle={handleToggle} onNavigate={handleLeadClick} />
                  ))}
                </div>
              </div>
            )}
            {grouped.completed.length > 0 && (
              <div>
                <SectionHeader label="Completed" count={grouped.completed.length} color="text-gray-400" />
                <div className="space-y-2">
                  {grouped.completed.map((fu) => (
                    <FollowUpCard key={fu.id} fu={fu} showAssignee={isAdminOrOwner} onToggle={handleToggle} onNavigate={handleLeadClick} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          // Flat list for filtered tabs
          <div className="space-y-2 max-w-2xl">
            {visible.map((fu) => (
              <FollowUpCard key={fu.id} fu={fu} showAssignee={isAdminOrOwner} onToggle={handleToggle} onNavigate={handleLeadClick} />
            ))}
          </div>
        )}
      </div>

      {/* ── Mobile FAB ── */}
      <button
        onClick={() => setCreateOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg sm:hidden transition-all active:scale-95"
        style={{ background: 'linear-gradient(135deg, var(--brand-dark), var(--brand))', boxShadow: '0 6px 20px rgba(194,65,12,0.4)' }}
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* ── Modals ── */}
      {(createOpen || scheduleFor) && (
        <CreateModal
          onClose={() => { setCreateOpen(false); setScheduleFor(null); }}
          onCreated={(fu) => { setItems((prev) => [fu, ...prev]); setScheduleFor(null); }}
          currentUserId={currentUser?.id ?? ''}
          preselectedLead={scheduleFor ?? undefined}
        />
      )}

      {pendingComplete && (
        <CompleteModal
          fu={pendingComplete}
          currentUserId={currentUser?.id ?? ''}
          onDone={handleCompleteDone}
          onCancel={() => setPendingComplete(null)}
        />
      )}

      {/* ── Lead Detail Panel ── */}
      {openLead && (
        <LeadDetailPanel
          lead={openLead}
          onClose={() => setOpenLead(null)}
          onLeadUpdated={(id, updates) =>
            setOpenLead((prev) => prev ? { ...prev, ...updates } : prev)
          }
        />
      )}
    </div>
  );
}
