import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useCrmStore } from '@/store/crmStore';
import { api } from '@/lib/api';
import {
  ChevronLeft, ChevronRight, Plus, Video, Phone as PhoneIcon, Users, Clock,
  Copy, Trash2, Settings2, ChevronDown, Search, X, Check, Pencil,
  UserCheck, Ban, CalendarDays, AlertTriangle, ExternalLink, Link, UserCog, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, copyToClipboard } from '@/lib/utils';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday,
  addMonths, subMonths, addWeeks, subWeeks, addDays, getDay,
  parseISO,
} from 'date-fns';
import { toast } from 'sonner';
import { confirmDialog } from '@/lib/confirm';
import type { CalendarEvent } from '@/data/mockData';
import type { EventType } from './CalendarEditPage';

// ── Styles ────────────────────────────────────────────────────────────────────
const gradStyle   = { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' };
const shadowStyle = { ...gradStyle, boxShadow: '0 4px 14px rgba(234,88,12,0.28)' };

// ── Status system ─────────────────────────────────────────────────────────────
type ApptStatus = 'scheduled' | 'showup' | 'noshow' | 'cancelled' | 'rescheduled';
type CalView    = 'day' | 'week' | 'month';

const AS: Record<ApptStatus, { bar: string; bg: string; text: string; label: string; dot: string; border: string; check: string }> = {
  scheduled:   { bar: 'bg-blue-400',   bg: 'bg-blue-50',   text: 'text-blue-700',   label: 'Scheduled',   dot: 'bg-blue-400',   border: 'border-blue-200',   check: '#60a5fa' },
  showup:      { bar: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700',  label: 'Show Up',     dot: 'bg-green-500',  border: 'border-green-200',  check: '#22c55e' },
  noshow:      { bar: 'bg-amber-400',  bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'No Show',     dot: 'bg-amber-400',  border: 'border-amber-200',  check: '#fbbf24' },
  cancelled:   { bar: 'bg-red-400',    bg: 'bg-red-50',    text: 'text-red-600',    label: 'Cancelled',   dot: 'bg-red-400',    border: 'border-red-200',    check: '#f87171' },
  rescheduled: { bar: 'bg-purple-400', bg: 'bg-purple-50', text: 'text-purple-700', label: 'Rescheduled', dot: 'bg-purple-400', border: 'border-purple-200', check: '#a78bfa' },
};

function getApptStatus(e: CalendarEvent): ApptStatus {
  if (e.status === 'completed')   return 'showup';
  if (e.status === 'no-show')     return 'noshow';
  if (e.status === 'cancelled')   return 'cancelled';
  if (e.status === 'rescheduled') return 'rescheduled';
  return 'scheduled';
}

const fmt12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const typeColors: Record<string, string> = { meeting: 'bg-primary', demo: 'bg-purple-500', call: 'bg-green-500' };
const typeIcons: Record<string, React.ElementType> = { meeting: Users, demo: Video, call: PhoneIcon };

// ── API event mapper ──────────────────────────────────────────────────────────
function mapApiEvent(r: any): CalendarEvent {
  const start = new Date(r.start_time);
  const end   = new Date(r.end_time ?? r.start_time);
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60000) || 30;
  return {
    id: r.id, title: r.title ?? '', type: r.type ?? 'meeting',
    leadName: r.lead_name ?? r.guest_name ?? '',
    email: r.lead_email ?? '',
    assignedTo: r.assigned_to ?? '',
    date: format(start, 'yyyy-MM-dd'), time: format(start, 'HH:mm'),
    duration: durationMin, status: r.status ?? 'scheduled',
    meetingLink: r.meeting_link ?? undefined,
  };
}

// ── Appointment Pill ──────────────────────────────────────────────────────────
function ApptPill({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const st = getApptStatus(event);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-full text-left flex items-stretch rounded overflow-hidden leading-tight transition-all hover:brightness-95 active:scale-[0.98]">
      <span className={cn('w-[3px] shrink-0', AS[st].bar)} />
      <span className={cn('flex-1 px-2 py-[3.5px] text-[11px] font-medium truncate', AS[st].bg, AS[st].text)}>
        {event.leadName} · {fmt12(event.time)}
      </span>
    </button>
  );
}

// ── Popup time slots ─────────────────────────────────────────────────────────
const POPUP_TIMES: string[] = [];
for (let h = 6; h <= 22; h++) {
  POPUP_TIMES.push(`${String(h).padStart(2,'0')}:00`);
  POPUP_TIMES.push(`${String(h).padStart(2,'0')}:30`);
}

// ── Appointment Popup ─────────────────────────────────────────────────────────
function ApptPopup({ event, onClose, onStatusChange, onDelete, onUpdate, staff }: {
  event: CalendarEvent;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<CalendarEvent>) => void;
  staff: any[];
}) {
  const [editing, setEditing] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [editForm, setEditForm] = useState({
    date: event.date, time: event.time,
    type: event.type as 'call' | 'demo' | 'meeting',
    duration: event.duration,
    assignedTo: event.assignedTo ?? '',
    meetingLink: event.meetingLink ?? '',
  });
  const [saving, setSaving] = useState(false);

  type PendingAction = { type: 'status'; status: string; label: string; msg: string } | { type: 'delete' };
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const handleSaveEdit = async () => {
    setSaving(true);
    const startIso = `${editForm.date}T${editForm.time}:00`;
    const endDate  = new Date(startIso);
    endDate.setMinutes(endDate.getMinutes() + editForm.duration);
    try {
      const payload: any = {
        type: editForm.type,
        start_time: startIso,
        end_time: endDate.toISOString(),
        assigned_to: editForm.assignedTo || null,
        meeting_link: editForm.meetingLink.trim() || null,
      };
      if (isRescheduling) payload.status = 'rescheduled';
      await api.patch(`/api/calendar/${event.id}`, payload);
      onUpdate(event.id, {
        type: editForm.type,
        date: editForm.date, time: editForm.time,
        duration: editForm.duration,
        assignedTo: editForm.assignedTo,
        meetingLink: editForm.meetingLink.trim() || undefined,
        ...(isRescheduling ? { status: 'rescheduled' } : {}),
      });
      toast.success(isRescheduling ? 'Appointment rescheduled' : 'Event updated');
      onClose();
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.toLowerCase().includes('already has a booking')) toast.error('Staff already has a booking at this time');
      else toast.error('Failed to update event');
    } finally { setSaving(false); }
  };

  const st    = getApptStatus(event);
  const sData = AS[st];
  const assignedName = staff.find((s) => s.id === event.assignedTo)?.name;
  const Icon = typeIcons[event.type] || Users;
  const ef = (k: keyof typeof editForm, v: unknown) => setEditForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[380px] bg-white rounded-2xl border border-black/8 overflow-hidden"
          style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
          <div className={cn('h-1.5', sData.bar)} />
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0', typeColors[event.type])}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-[#1c1410] leading-snug truncate">{event.leadName || 'Unknown Lead'}</p>
                  <p className="text-[11px] text-[#7a6b5c]">{event.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditing((v) => !v)}
                  className={cn('p-1.5 rounded-lg transition-colors', editing ? 'bg-orange-100 text-[var(--brand-dark)]' : 'hover:bg-[var(--accent-tint)] text-[#7a6b5c]')}>
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {!editing ? (
              <div className="space-y-2.5 pl-1">
                <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border', sData.bg, sData.text, sData.border)}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', sData.dot)} />{sData.label}
                </span>
                <div className="flex items-center gap-2 text-[13px] text-[#7a6b5c]">
                  <CalendarDays className="w-3.5 h-3.5 shrink-0 text-[#9c8f84]" />
                  <span>{format(parseISO(event.date), 'EEEE, MMM d')} · {fmt12(event.time)} · {event.duration} min · <span className="text-[11px]">IST</span></span>
                </div>
                {event.email && (
                  <div className="flex items-center gap-2 text-[13px] text-[#7a6b5c]">
                    <span className="text-[#9c8f84] text-[11px]">@</span>
                    <span>{event.email}</span>
                  </div>
                )}
                {event.meetingLink && (
                  <a href={event.meetingLink} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg,#4285F4 0%,#0ea5e9 100%)' }}>
                    <ExternalLink className="w-3 h-3" /> Join Meeting
                  </a>
                )}
                {assignedName && (
                  <div className="flex items-center gap-2 text-[13px] text-[#7a6b5c]">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[8px] font-bold text-primary shrink-0">
                      {assignedName[0]}
                    </div>
                    <span>{assignedName}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[13px]">
                  {event.createdByName ? (
                    <>
                      <UserCog className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                      <span className="text-amber-700 font-medium">Booked by {event.createdByName}</span>
                    </>
                  ) : (
                    <>
                      <Link className="w-3.5 h-3.5 shrink-0 text-teal-500" />
                      <span className="text-teal-700 font-medium">Self-booked via calendar link</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Date</label>
                    <input type="date" value={editForm.date} onChange={(e) => ef('date', e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Time</label>
                    {/* input[type=time] handles any HH:MM - select would miss non-30-min times (FIX #19) */}
                    <input type="time" value={editForm.time} onChange={(e) => ef('time', e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Type</label>
                    <select value={editForm.type} onChange={(e) => ef('type', e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40 bg-white">
                      <option value="call">Call</option>
                      <option value="demo">Demo</option>
                      <option value="meeting">Meeting</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Duration</label>
                    <select value={editForm.duration} onChange={(e) => ef('duration', Number(e.target.value))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40 bg-white">
                      {[15,30,45,60,90].map((d) => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Staff</label>
                  <select value={editForm.assignedTo} onChange={(e) => ef('assignedTo', e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40 bg-white">
                    <option value="">Unassigned</option>
                    {staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Meeting Link</label>
                  <input value={editForm.meetingLink} onChange={(e) => ef('meetingLink', e.target.value)}
                    placeholder="https://meet.google.com/…"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40 placeholder:text-[#c4b09e]" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => { setEditing(false); setIsRescheduling(false); }}
                    className="flex-1 py-2 rounded-xl text-[13px] font-bold text-[#7a6b5c] border border-black/10 bg-white hover:bg-[var(--app-bg)]">Cancel</button>
                  <button onClick={handleSaveEdit} disabled={saving}
                    className="flex-1 py-2 rounded-xl text-[13px] font-bold text-white disabled:opacity-50" style={shadowStyle}>
                    {saving ? 'Saving…' : isRescheduling ? 'Reschedule' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {!editing && (st === 'scheduled' || st === 'rescheduled') && (
            <div className="px-5 py-3 border-t border-[#f5f0eb] flex flex-wrap gap-2">
              <button onClick={() => setPendingAction({ type: 'status', status: 'completed', label: 'Show Up', msg: 'Mark this appointment as shown up?' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-green-600 bg-green-50 border border-green-200 hover:bg-green-100 transition-colors">
                <UserCheck className="w-3 h-3" /> Show Up
              </button>
              <button onClick={() => setPendingAction({ type: 'status', status: 'no-show', label: 'No Show', msg: 'Mark this appointment as no-show?' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors">
                <AlertTriangle className="w-3 h-3" /> No Show
              </button>
              {st === 'scheduled' && (
                <button onClick={() => { setIsRescheduling(true); setEditing(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-purple-600 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Reschedule
                </button>
              )}
              <button onClick={() => setPendingAction({ type: 'status', status: 'cancelled', label: 'Cancel', msg: 'Are you sure you want to cancel this appointment?' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors">
                <Ban className="w-3 h-3" /> Cancel
              </button>
            </div>
          )}
          {!editing && (
            <div className="px-5 py-2.5 border-t border-[#f5f0eb] flex justify-end">
              <button onClick={() => setPendingAction({ type: 'delete' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 className="w-3 h-3" /> Delete Event
              </button>
            </div>
          )}

          {/* ── Confirm modal ── */}
          {pendingAction && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}>
              <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden">
                <div className="px-6 pt-6 pb-4 text-center">
                  <div className={cn(
                    'w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4',
                    pendingAction.type === 'delete' ? 'bg-red-100' :
                    pendingAction.status === 'completed' ? 'bg-green-100' :
                    pendingAction.status === 'no-show'   ? 'bg-amber-100' : 'bg-red-100'
                  )}>
                    {pendingAction.type === 'delete'
                      ? <Trash2 className="w-5 h-5 text-red-500" />
                      : pendingAction.status === 'completed'
                        ? <UserCheck className="w-5 h-5 text-green-600" />
                        : pendingAction.status === 'no-show'
                          ? <AlertTriangle className="w-5 h-5 text-amber-500" />
                          : <Ban className="w-5 h-5 text-red-500" />
                    }
                  </div>
                  <h3 className="text-[15px] font-bold text-[#1c1410] mb-1">
                    {pendingAction.type === 'delete' ? 'Delete Event?' : `Mark as ${pendingAction.label}?`}
                  </h3>
                  <p className="text-[13px] text-[#7a6b5c]">
                    {pendingAction.type === 'delete'
                      ? 'This event will be permanently deleted. This cannot be undone.'
                      : pendingAction.msg}
                  </p>
                </div>
                <div className="px-6 pb-5 flex gap-2">
                  <button onClick={() => setPendingAction(null)}
                    className="flex-1 py-2.5 rounded-xl text-[14px] font-bold text-[#7a6b5c] border border-black/10 bg-white hover:bg-[var(--app-bg)] transition-colors">
                    Go Back
                  </button>
                  <button
                    onClick={() => {
                      if (pendingAction.type === 'delete') {
                        onDelete(event.id); onClose();
                      } else {
                        onStatusChange(event.id, pendingAction.status); onClose();
                      }
                      setPendingAction(null);
                    }}
                    className={cn(
                      'flex-1 py-2.5 rounded-xl text-[14px] font-bold text-white transition-colors',
                      pendingAction.type === 'delete' || pendingAction.status === 'cancelled' ? 'bg-red-500 hover:bg-red-600' :
                      pendingAction.status === 'no-show' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-500 hover:bg-green-600'
                    )}>
                    {pendingAction.type === 'delete' ? 'Yes, Delete' : `Yes, ${pendingAction.label}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Mini Calendar (sidebar) ───────────────────────────────────────────────────
function MiniCal({ cursor, onDayClick }: { cursor: Date; onDayClick: (d: Date) => void }) {
  const [miniMonth, setMiniMonth] = useState(() => startOfMonth(cursor));
  useEffect(() => { setMiniMonth(startOfMonth(cursor)); }, [format(cursor, 'yyyy-MM')]);
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(miniMonth), { weekStartsOn: 0 });
    const end   = endOfWeek(endOfMonth(miniMonth),     { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [miniMonth]);
  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <button onClick={() => setMiniMonth((m) => subMonths(m, 1))} className="p-1 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors"><ChevronLeft className="w-3 h-3" /></button>
        <p className="text-[11px] font-bold text-[#1c1410]">{format(miniMonth, 'MMM yyyy')}</p>
        <button onClick={() => setMiniMonth((m) => addMonths(m, 1))} className="p-1 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors"><ChevronRight className="w-3 h-3" /></button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="text-center text-[9px] font-bold text-[#b09e8d] py-0.5">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day) => {
          const inM = isSameMonth(day, miniMonth);
          const tod = isToday(day);
          const sel = isSameDay(day, cursor);
          return (
            <button key={day.toISOString()} onClick={() => onDayClick(day)}
              className={cn('w-7 h-7 mx-auto flex items-center justify-center rounded-full text-[10.5px] font-medium transition-all',
                sel && tod  ? 'bg-[var(--brand-dark)] text-white font-bold' :
                sel         ? 'bg-[var(--accent-tint)] text-[var(--brand-dark)] font-bold ring-1 ring-primary/30' :
                tod         ? 'bg-[#fff0e6] text-[var(--brand-dark)] font-bold' :
                inM         ? 'text-[#1c1410] hover:bg-[var(--accent-tint)]' :
                              'text-[#c9bdb6]',
              )}>
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Week View ─────────────────────────────────────────────────────────────────
function CalWeekView({ cursor, byDay, visibleStatuses, onEventClick, onDayClick }: {
  cursor: Date; byDay: Map<string, CalendarEvent[]>; visibleStatuses: Set<ApptStatus>;
  onEventClick: (e: CalendarEvent) => void; onDayClick: (d: Date) => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[#f0ebe5] bg-white shrink-0">
        {days.map((day) => (
          <div key={day.toISOString()} className="border-r border-[#f0ebe5] last:border-r-0 py-3 flex flex-col items-center gap-1">
            <p className="text-[10px] font-bold text-[#9c8f84] uppercase tracking-widest">{format(day, 'EEE')}</p>
            <button onClick={() => onDayClick(day)} className={cn('w-9 h-9 rounded-full flex items-center justify-center text-[19px] font-extrabold transition-all',
              isToday(day) ? 'bg-[var(--brand-dark)] text-white shadow-md' : 'text-[#1c1410] hover:bg-[var(--accent-tint)]')}>
              {format(day, 'd')}
            </button>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-7 min-h-full">
          {days.map((day) => {
            const key      = format(day, 'yyyy-MM-dd');
            const dayItems = (byDay.get(key) ?? []).filter((e) => visibleStatuses.has(getApptStatus(e)));
            const visible  = dayItems.slice(0, 3);
            const more     = dayItems.length - visible.length;
            return (
              <div key={key} className={cn('border-r border-[#f0ebe5] last:border-r-0 p-1.5 space-y-[3px] min-h-[460px]',
                isToday(day) ? 'bg-orange-50/25' : 'hover:bg-[var(--app-bg)]')}>
                {visible.map((e) => <ApptPill key={e.id} event={e} onClick={() => onEventClick(e)} />)}
                {more > 0 && (
                  <button type="button" onClick={() => onDayClick(day)}
                    className="w-full text-left text-[10px] font-semibold text-[#7a6b5c] pl-2 py-[2px] hover:text-[var(--brand-dark)] transition-colors">
                    +{more} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Month View ────────────────────────────────────────────────────────────────
function CalMonthView({ cursor, byDay, visibleStatuses, onEventClick, onDayClick }: {
  cursor: Date; byDay: Map<string, CalendarEvent[]>; visibleStatuses: Set<ApptStatus>;
  onEventClick: (e: CalendarEvent) => void; onDayClick: (d: Date) => void;
}) {
  const month = startOfMonth(cursor);
  const days  = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end   = endOfWeek(endOfMonth(cursor),     { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[#f0ebe5] shrink-0">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="text-center py-2.5 text-[10px] font-bold text-[#9c8f84] uppercase tracking-widest border-r border-[#f0ebe5] last:border-r-0">{d}</div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key      = format(day, 'yyyy-MM-dd');
            const dayItems = (byDay.get(key) ?? []).filter((e) => visibleStatuses.has(getApptStatus(e)));
            const inMonth  = isSameMonth(day, month);
            const visible  = dayItems.slice(0, 3);
            const more     = dayItems.length - visible.length;
            return (
              <div key={day.toISOString()} onClick={() => onDayClick(day)}
                className={cn('border-r border-b border-[#f0ebe5] last:border-r-0 min-h-[110px] p-1.5 cursor-pointer',
                  isToday(day) ? 'bg-orange-50/30' : !inMonth ? 'bg-[#fdfcfb]' : 'hover:bg-[var(--app-bg)]')}>
                <div className="flex justify-start mb-1">
                  <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-semibold',
                    isToday(day) ? 'bg-[var(--brand-dark)] text-white font-extrabold' :
                    inMonth ? 'text-[#1c1410]' : 'text-[#c9bdb6]')}>
                    {format(day, 'd')}
                  </span>
                </div>
                <div className="space-y-[3px]">
                  {visible.map((e) => <ApptPill key={e.id} event={e} onClick={() => onEventClick(e)} />)}
                  {more > 0 && <p className="text-[10px] text-[#7a6b5c] pl-1 font-medium">+{more} more</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Day View ──────────────────────────────────────────────────────────────────
function CalDayView({ cursor, byDay, visibleStatuses, onEventClick }: {
  cursor: Date; byDay: Map<string, CalendarEvent[]>; visibleStatuses: Set<ApptStatus>;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const key   = format(cursor, 'yyyy-MM-dd');
  const items = (byDay.get(key) ?? []).filter((e) => visibleStatuses.has(getApptStatus(e)));
  const Icon  = (type: string) => typeIcons[type] || Users;
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-[#ede8e2] overflow-hidden">
        <div className={cn('px-6 py-5 border-b border-[#f0ebe5]', isToday(cursor) && 'bg-orange-50/40')}>
          <p className="text-[10px] font-bold text-[#9c8f84] uppercase tracking-widest">{format(cursor, 'EEEE')}</p>
          <div className="flex items-end justify-between mt-1">
            <p className={cn('text-[38px] font-extrabold font-headline leading-none', isToday(cursor) ? 'text-[var(--brand-dark)]' : 'text-[#1c1410]')}>{format(cursor, 'd')}</p>
            <p className="text-[14px] text-[#7a6b5c] mb-1">{format(cursor, 'MMMM yyyy')}</p>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center">
              <CalendarDays className="w-6 h-6 text-[var(--brand-dark)]" />
            </div>
            <p className="text-[15px] font-bold text-[#1c1410]">Nothing scheduled</p>
            <p className="text-[13px] text-[#7a6b5c]">No appointments for this day</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f5f0eb]">
            {items.map((e) => {
              const st = getApptStatus(e);
              const IIcon = Icon(e.type);
              return (
                <button key={e.id} type="button" onClick={() => onEventClick(e)}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-[var(--app-bg)] transition-colors text-left">
                  <span className={cn('w-[3px] h-10 rounded-full shrink-0', AS[st].bar)} />
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0', typeColors[e.type])}>
                    <IIcon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#1c1410]">{e.leadName || 'Unknown'}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-[#7a6b5c] flex items-center gap-1"><Clock className="w-3 h-3" />{fmt12(e.time)} · {e.duration} min</span>
                    </div>
                  </div>
                  <span className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0', AS[st].bg, AS[st].text, AS[st].border)}>{AS[st].label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Time options for new event modal ─────────────────────────────────────────
const TIME_OPTIONS: string[] = [];
for (let h = 8; h <= 17; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:00`);
  if (h < 17) TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:30`);
}

// ── Status badge styles for Appointments tab ──────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  booked:       'bg-blue-50 text-blue-700 border-blue-200',
  cancelled:    'bg-red-50 text-red-600 border-red-200',
  'show-up':    'bg-green-50 text-green-700 border-green-200',
  'no-show':    'bg-amber-50 text-amber-700 border-amber-200',
  rescheduled:  'bg-purple-50 text-purple-700 border-purple-200',
};
const STATUS_LBL: Record<string, string>  = { booked: 'Booked', cancelled: 'Cancelled', 'show-up': 'Show Up', 'no-show': 'No Show', rescheduled: 'Rescheduled' };
const DOT_COLOR:  Record<string, string>  = { booked: 'bg-blue-500', cancelled: 'bg-red-500', 'show-up': 'bg-green-500', 'no-show': 'bg-amber-400', rescheduled: 'bg-purple-400' };

interface Appointment {
  id: string; eventTypeName: string; leadName: string; email: string;
  date: string; startTime: string; endTime: string;
  status: 'booked' | 'cancelled' | 'show-up' | 'no-show' | 'rescheduled'; timezone: string;
}

// ── Main CalendarPage ─────────────────────────────────────────────────────────
export default function CalendarPage() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { staff, leads } = useCrmStore();
  const [searchParams] = useSearchParams();
  const tab = (searchParams.get('tab') ?? 'dashboard') as 'dashboard' | 'create-edit' | 'appointments';

  // ── Shared state ──────────────────────────────────────────────────────────
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => {
    const from = format(subMonths(new Date(), 3), 'yyyy-MM-dd');
    const to   = format(addMonths(new Date(), 6), 'yyyy-MM-dd');
    api.get<any[]>(`/api/calendar?from=${from}&to=${to}`)
      .then((rows) => setCalendarEvents(rows.map(mapApiEvent)))
      .catch(() => {});
  }, []);

  const updateEventStatus = useCallback(async (id: string, status: string) => {
    try {
      await api.patch(`/api/calendar/${id}`, { status });
      setCalendarEvents((prev) => prev.map((e) => e.id === id ? { ...e, status: status as any } : e));
      toast.success(`Marked ${status}`);
    } catch { toast.error('Failed to update'); }
  }, []);

  const deleteEvent = useCallback(async (id: string) => {
    try {
      await api.delete(`/api/calendar/${id}`);
      setCalendarEvents((prev) => prev.filter((e) => e.id !== id));
      toast.success('Event deleted');
    } catch { toast.error('Failed to delete event'); }
  }, []);

  const updateEventLocal = useCallback((id: string, updates: Partial<CalendarEvent>) => {
    setCalendarEvents((prev) => prev.map((e) => e.id === id ? { ...e, ...updates } : e));
  }, []);


  // ── Dashboard state ───────────────────────────────────────────────────────
  const [view,             setView]             = useState<CalView>('week');
  const [cursor,           setCursor]           = useState(new Date());
  const [search,           setSearch]           = useState('');
  const [visibleStatuses,  setVisibleStatuses]  = useState<Set<ApptStatus>>(new Set(['scheduled','showup','noshow','cancelled','rescheduled']));
  const [selectedEvent,    setSelectedEvent]    = useState<CalendarEvent | null>(null);
  const [showNewEvent,     setShowNewEvent]     = useState(false);
  const [newEventForm, setNewEventForm] = useState({ date: format(new Date(), 'yyyy-MM-dd'), time: '09:00', leadName: '', leadId: '', type: 'call' as 'call'|'demo'|'meeting', duration: 30, assignedTo: '', meetingLink: '' });
  const [leadSearch,    setLeadSearch]    = useState('');
  const [showLeadDrop,  setShowLeadDrop]  = useState(false);

  const filteredEvents = useMemo(() => {
    let result = calendarEvents;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => e.leadName.toLowerCase().includes(q) || e.title.toLowerCase().includes(q));
    }
    return result.filter((e) => visibleStatuses.has(getApptStatus(e)));
  }, [calendarEvents, search, visibleStatuses]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of filteredEvents) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [filteredEvents]);

  const dashStats = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const total     = calendarEvents.length;
    const scheduled = calendarEvents.filter((e) => getApptStatus(e) === 'scheduled').length;
    const showup    = calendarEvents.filter((e) => getApptStatus(e) === 'showup').length;
    const noshow    = calendarEvents.filter((e) => getApptStatus(e) === 'noshow').length;
    const cancelled = calendarEvents.filter((e) => getApptStatus(e) === 'cancelled').length;
    const today     = calendarEvents.filter((e) => e.date === todayStr && getApptStatus(e) === 'scheduled').length;
    const upcoming  = calendarEvents.filter((e) => e.date > todayStr && getApptStatus(e) === 'scheduled').length;
    const showupRate = total > 0 ? Math.round((showup / total) * 100) : 0;
    return { total, scheduled, showup, noshow, cancelled, today, upcoming, showupRate };
  }, [calendarEvents]);

  // ── Old-style dashboard state ─────────────────────────────────────────────
  const calRef = useRef<HTMLDivElement>(null);
  const [calHeight, setCalHeight] = useState(0);
  useEffect(() => {
    if (!calRef.current) return;
    const ro = new ResizeObserver(([e]) => setCalHeight(e.target.getBoundingClientRect().height));
    ro.observe(calRef.current);
    return () => ro.disconnect();
  }, [tab]);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [calendarFilter, setCalendarFilter] = useState<string>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');

  const calDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const allDays    = eachDayOfInterval({ start: monthStart, end: endOfMonth(currentMonth) });
    const padding    = Array.from({ length: getDay(monthStart) }, () => null as null);
    return [...padding, ...allDays];
  }, [currentMonth]);

  const selectedEvents = useMemo(() => {
    if (!selectedDate) return [] as CalendarEvent[];
    return calendarEvents.filter((e) =>
      isSameDay(new Date(e.date), selectedDate) &&
      (calendarFilter === 'all' || e.type === calendarFilter) &&
      (staffFilter    === 'all' || e.assignedTo === staffFilter)
    );
  }, [selectedDate, calendarEvents, calendarFilter, staffFilter]);

  const goBack    = () => { if (view === 'day') setCursor((d) => addDays(d,-1)); else if (view === 'week') setCursor((d) => subWeeks(d,1)); else setCursor((d) => subMonths(d,1)); };
  const goForward = () => { if (view === 'day') setCursor((d) => addDays(d,1));  else if (view === 'week') setCursor((d) => addWeeks(d,1));  else setCursor((d) => addMonths(d,1)); };

  const headerTitle = useMemo(() => {
    if (view === 'day')   return format(cursor, 'MMMM d, yyyy');
    if (view === 'month') return format(cursor, 'MMMM yyyy');
    const ws = startOfWeek(cursor, { weekStartsOn: 0 });
    const we = endOfWeek(cursor,   { weekStartsOn: 0 });
    return format(ws, 'MMM yyyy') === format(we, 'MMM yyyy')
      ? `${format(ws, 'MMM d')} – ${format(we, 'd, yyyy')}`
      : `${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`;
  }, [view, cursor]);

  const toggleStatus = (st: ApptStatus) =>
    setVisibleStatuses((prev) => { const next = new Set(prev); next.has(st) ? next.delete(st) : next.add(st); return next; });

  const handleCreateEvent = async () => {
    if (newEventForm.leadName.trim().length < 2) { toast.error('Enter a lead name'); return; }
    const startIso = `${newEventForm.date}T${newEventForm.time}:00`;
    const endDate  = new Date(startIso);
    endDate.setMinutes(endDate.getMinutes() + newEventForm.duration);
    const title = `${newEventForm.type === 'demo' ? 'Demo Call' : newEventForm.type === 'meeting' ? 'Meeting' : 'Follow-up Call'} – ${newEventForm.leadName}`;
    try {
      const created = await api.post<any>('/api/calendar', {
        title, type: newEventForm.type,
        start_time: startIso, end_time: endDate.toISOString(),
        assigned_to: newEventForm.assignedTo || undefined,
        meeting_link: newEventForm.meetingLink.trim() || undefined,
        lead_id: newEventForm.leadId || undefined,
        guest_name: newEventForm.leadName,
      });
      const linkedLead = newEventForm.leadId ? leads.find((l) => l.id === newEventForm.leadId) : null;
      setCalendarEvents((prev) => [...prev, {
        id: created.id, title, type: newEventForm.type,
        leadName: newEventForm.leadName, email: linkedLead?.email ?? '',
        assignedTo: newEventForm.assignedTo,
        date: newEventForm.date, time: newEventForm.time,
        duration: newEventForm.duration, status: 'scheduled',
        meetingLink: newEventForm.meetingLink.trim() || undefined,
      }]);
      setShowNewEvent(false);
      setNewEventForm({ date: format(new Date(), 'yyyy-MM-dd'), time: '09:00', leadName: '', leadId: '', type: 'call', duration: 30, assignedTo: '', meetingLink: '' });
      setLeadSearch('');
      toast.success('Event created');
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.toLowerCase().includes('already has a booking')) toast.error('Staff member already has a booking at this time');
      else toast.error('Failed to create event');
    }
  };


  // ── Create/Edit state ──────────────────────────────────────────────────────
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [etLoading,  setEtLoading]  = useState(false);

  useEffect(() => {
    if (tab !== 'create-edit') return;
    setEtLoading(true);
    api.get<any[]>('/api/calendar/event-types')
      .then((rows) => setEventTypes(rows.map((r) => ({
        id: r.id, name: r.name, duration: r.duration, description: r.description ?? '',
        slug: r.slug, staffType: r.staff_type as EventType['staffType'],
        assignmentMode: r.assignment_mode as EventType['assignmentMode'],
        staffEmails: r.staff_emails ?? [], meetingType: r.meeting_type ?? 'Google Meet',
        meetingLink: r.meeting_link ?? undefined,
        schedulingType: r.scheduling_type as EventType['schedulingType'],
        daysInFuture: r.days_in_future ?? 30, timeZone: r.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        schedule: r.schedule ?? {}, bufferTime: r.buffer_time ?? 0,
        isActive: r.is_active ?? true, formFields: r.form_fields ?? [],
        dateOverrides: r.date_overrides ?? {},
        redirectUrl: r.redirect_url ?? undefined,
        dateRangeStart: r.date_range_start ?? undefined,
        dateRangeEnd: r.date_range_end ?? undefined,
        maxPerDay: r.max_per_day ?? 0,
        minNoticeValue: r.min_notice_value ?? 2,
        minNoticeUnit: r.min_notice_unit ?? 'days',
        capacityPerSlot: r.capacity_per_slot ?? 1,
      }))))
      .catch(() => {})
      .finally(() => setEtLoading(false));
  }, [tab]);

  useEffect(() => {
    if (location.state?.savedEventType) {
      const saved = location.state.savedEventType as EventType;
      setEventTypes((p) => p.some((e) => e.id === saved.id) ? p.map((e) => e.id === saved.id ? saved : e) : [...p, saved]);
      navigate('/calendar?tab=create-edit', { replace: true });
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // ── Appointments tab state ─────────────────────────────────────────────────
  const [apptFilter, setApptFilter] = useState<'all'|'booked'|'show-up'|'no-show'|'cancelled'|'rescheduled'>('all');

  const appointments = useMemo<Appointment[]>(() => {
    const statusMap: Record<string, Appointment['status']> = {
      scheduled: 'booked', completed: 'show-up',
      cancelled: 'cancelled', 'no-show': 'no-show', rescheduled: 'rescheduled',
    };
    return calendarEvents.map((e) => {
      const [h, m] = e.time.split(':').map(Number);
      // Cap at 23:59 - events don't cross midnight in this CRM context (FIX #18)
      const endMin = Math.min(h * 60 + m + e.duration, 23 * 60 + 59);
      const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      // Use browser timezone - not hardcoded Asia/Kolkata (FIX #17)
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return { id: e.id, eventTypeName: e.title, leadName: e.leadName || 'Unknown',
        email: e.email ?? '', date: e.date, startTime: e.time, endTime,
        status: statusMap[e.status] ?? 'booked', timezone: localTz };
    });
  }, [calendarEvents]);

  const filteredApts = useMemo(() => apptFilter === 'all' ? appointments : appointments.filter((a) => a.status === apptFilter), [appointments, apptFilter]);
  const groupedApts  = useMemo(() => {
    const groups: Record<string, Appointment[]> = {};
    [...filteredApts].sort((a, b) => b.date.localeCompare(a.date)).forEach((a) => { (groups[a.date] ??= []).push(a); });
    return groups;
  }, [filteredApts]);
  const apptStats = useMemo(() => ({
    total: appointments.length,
    booked: appointments.filter((a) => a.status === 'booked').length,
    showUp: appointments.filter((a) => a.status === 'show-up').length,
    noShow: appointments.filter((a) => a.status === 'no-show').length,
    cancelled: appointments.filter((a) => a.status === 'cancelled').length,
    rescheduled: appointments.filter((a) => a.status === 'rescheduled').length,
  }), [appointments]);

  // OTHER TABS
  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">

      {/* ═══════════ DASHBOARD TAB ═══════════ */}
      {tab === 'dashboard' && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              { label: 'Total Events', value: dashStats.total,     Icon: CalendarDays, color: 'text-primary',     bg: 'bg-primary/10'  },
              { label: 'Scheduled',    value: dashStats.scheduled, Icon: Clock,        color: 'text-primary',    bg: 'bg-primary/10'  },
              { label: 'Show Up',      value: dashStats.showup,    Icon: UserCheck,    color: 'text-primary',    bg: 'bg-primary/10'  },
              { label: 'Upcoming',     value: dashStats.upcoming,  Icon: Users,        color: 'text-primary',    bg: 'bg-primary/10'  },
            ] as const).map((s) => (
              <div key={s.label} className="bg-white rounded-2xl px-4 py-3.5 border border-black/5 flex items-center gap-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', s.bg)}>
                  <s.Icon className={cn('w-4 h-4', s.color)} />
                </div>
                <div>
                  <p className="text-[11px] text-[#b09e8d]">{s.label}</p>
                  <p className="text-[20px] font-semibold text-[#1c1410] leading-tight">{s.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Filters + Add Event */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select value={calendarFilter} onChange={(e) => setCalendarFilter(e.target.value)}
                className="appearance-none pl-4 pr-10 py-2.5 bg-white border border-black/10 rounded-xl text-[14px] font-semibold text-[#1c1410] outline-none hover:border-primary/40 focus:border-primary/40 cursor-pointer min-w-[160px]"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <option value="all">All Calendars</option>
                <option value="demo">Demos</option>
                <option value="meeting">Meetings</option>
                <option value="call">Calls</option>
              </select>
              <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[#7a6b5c] pointer-events-none" />
            </div>
            <div className="relative">
              <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}
                className={cn(
                  'appearance-none pl-4 pr-10 py-2.5 bg-white border border-black/10 rounded-xl text-[14px] font-semibold outline-none hover:border-primary/40 focus:border-primary/40 cursor-pointer min-w-[160px]',
                  staffFilter === 'all' ? 'text-[#b09e8d]' : 'text-[#1c1410]'
                )}
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <option value="all">All Staff</option>
                {staff.filter((s) => s.status === 'active').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[#7a6b5c] pointer-events-none" />
            </div>
            <button className="ml-auto flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white"
              style={shadowStyle}
              onClick={() => { setNewEventForm((f) => ({ ...f, date: format(new Date(), 'yyyy-MM-dd') })); setShowNewEvent(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Add Event
            </button>
          </div>

          {/* Calendar + Events panel */}
          <div className="flex gap-5 items-start">
            {/* Left: month grid */}
            <div ref={calRef} className="flex-[2] bg-white rounded-2xl border border-black/5 p-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-headline text-[17px] font-semibold text-[#1c1410]">{format(currentMonth, 'MMMM yyyy')}</h3>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="w-8 h-8 rounded-lg hover:bg-[var(--accent-tint)] flex items-center justify-center text-[#7a6b5c]">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => { setCurrentMonth(new Date()); setSelectedDate(new Date()); }} className="px-3 py-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[13px] font-semibold text-[#1c1410]">Today</button>
                  <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="w-8 h-8 rounded-lg hover:bg-[var(--accent-tint)] flex items-center justify-center text-[#7a6b5c]">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
                  <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider text-[#7a6b5c] pb-1.5">{d}</div>
                ))}
                {calDays.map((day, i) => {
                  if (!day) return <div key={'pad-' + i} className="min-h-[50px]" />;
                  const dayEvts = calendarEvents.filter((e) =>
                    isSameDay(new Date(e.date), day) &&
                    (calendarFilter === 'all' || e.type === calendarFilter) &&
                    (staffFilter    === 'all' || e.assignedTo === staffFilter)
                  );
                  const isSel = !!(selectedDate && isSameDay(day, selectedDate));
                  const isTod = isSameDay(day, new Date()) && !isSel;
                  return (
                    <button key={day.toISOString()} onClick={() => setSelectedDate(day)}
                      className={cn('rounded-lg min-h-[50px] flex flex-col items-center justify-center gap-1 transition-colors',
                        isSel ? 'bg-primary text-white shadow-sm' :
                        isTod ? 'bg-[#faf0e8] text-[#1c1410]' :
                                'hover:bg-[var(--app-bg)] text-[#1c1410]',
                        !isSameMonth(day, currentMonth) && 'opacity-40'
                      )}>
                      <span className="font-semibold text-[14px] tabular-nums">{format(day, 'd')}</span>
                      {dayEvts.length > 0 && (
                        <div className="flex gap-0.5">
                          {dayEvts.slice(0, 3).map((e) => (
                            <div key={e.id} className={cn('w-1 h-1 rounded-full', isSel ? 'bg-white/90' : (typeColors[e.type] ?? 'bg-primary'))} />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: events panel - same height as calendar, scrolls internally */}
            <div className="flex-1 bg-white rounded-2xl border border-black/5 flex flex-col"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)', height: calHeight > 0 ? calHeight : undefined, maxHeight: calHeight > 0 ? calHeight : 600 }}>
              <div className="px-4 pt-4 pb-2.5 shrink-0 border-b border-black/[0.04]">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-[14px] text-[#1c1410]">
                    {selectedDate ? format(selectedDate, 'EEEE, MMM d') : 'Select a date'}
                  </h3>
                  {selectedEvents.length > 0 && (
                    <span className="text-[11px] font-medium text-[#7a6b5c] bg-black/[0.06] rounded-full px-2 py-0.5">{selectedEvents.length}</span>
                  )}
                </div>
              </div>
              {selectedEvents.length === 0 ? (
                <div className="text-center py-10 flex-1">
                  <Clock className="w-10 h-10 mx-auto mb-2 text-[#c4b09e] opacity-40" />
                  <p className="text-[14px] text-[#7a6b5c]">No events for this date</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto px-3 pt-2 pb-1 space-y-2">
                  {selectedEvents.map((event) => {
                    const EvIcon = typeIcons[event.type] || Users;
                    const assignedName = staff.find((s) => s.id === event.assignedTo)?.name;
                    const st = getApptStatus(event);
                    return (
                      <div key={event.id} className="p-3 rounded-xl border border-black/5 hover:shadow-sm transition-shadow cursor-pointer"
                        onClick={() => setSelectedEvent(event)}>
                        <div className="flex items-start gap-2.5">
                          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0', typeColors[event.type] ?? 'bg-primary')}>
                            <EvIcon className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1">
                              <p className="font-semibold text-[13px] text-[#1c1410] leading-tight">{event.title}</p>
                              <span className={cn('text-[9px] border rounded-full font-medium shrink-0 ml-1 px-2 py-0.5', AS[st].bg, AS[st].text, AS[st].border)}>
                                {AS[st].label}
                              </span>
                            </div>
                            <p className="text-[10px] text-[#7a6b5c] mt-0.5">
                              {fmt12(event.time)} · {event.duration} min{assignedName ? ' · ' + assignedName : ''}
                            </p>
                            <p className="text-[10px] text-[#7a6b5c]">{event.leadName}</p>
                            {event.meetingLink && (
                              <a href={event.meetingLink} target="_blank" rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[10px] text-primary flex items-center gap-0.5 hover:underline font-semibold mt-1">
                                <ExternalLink className="w-2.5 h-2.5" /> Join
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ═══════════ CREATE / EDIT TAB ═══════════ */}
      {tab === 'create-edit' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => navigate('/calendar/edit/new')}><Plus className="w-4 h-4 mr-1" /> New Calendar</Button>
          </div>
          {etLoading ? (
            <div className="py-20 text-center text-[14px] text-[#b09e8d]">Loading…</div>
          ) : eventTypes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-black/5 py-20 flex flex-col items-center gap-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <CalendarDays className="w-10 h-10 text-[#c4b09e]" />
              <p className="text-[15px] font-semibold text-[#1c1410]">No calendars yet</p>
              <p className="text-[13px] text-[#7a6b5c]">Create a calendar - a shareable booking link is auto-generated</p>
              <button onClick={() => navigate('/calendar/edit/new')} className="mt-2 px-5 py-2.5 rounded-xl text-[14px] font-bold text-white" style={shadowStyle}><Plus className="w-4 h-4 inline mr-1" /> New Calendar</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {eventTypes.map((et) => {
                const bookingUrl = `${window.location.origin}/book/${et.slug}`;
                return (
                  <div key={et.id}
                    onClick={() => navigate(`/calendar/edit/${et.id}`, { state: { eventType: et } })}
                    className="bg-white rounded-2xl border border-black/[0.06] flex flex-col hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden"
                    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div className="h-[3px] w-full bg-gradient-to-r from-orange-400 to-orange-300" />
                    <div className="p-5 flex-1 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-headline font-bold text-[15px] text-[#1c1410] mb-0.5">{et.name}</h3>
                          <p className="text-[13px] text-[#7a6b5c]">{et.duration} min · {et.meetingType}</p>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/calendar/edit/${et.id}`, { state: { eventType: et } }); }}
                          className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#b09e8d] hover:text-primary transition-colors" title="Edit">
                          <Settings2 className="w-4 h-4" />
                        </button>
                      </div>
                      {et.description && <p className="text-[13px] text-[#7a6b5c] line-clamp-2">{et.description}</p>}

                      {/* Auto-generated booking link */}
                      <div className="flex items-center gap-1.5 px-3 py-2 bg-[var(--app-bg)] rounded-xl border border-black/[0.04] cursor-pointer hover:bg-[#f0ebe5] transition-colors" onClick={(e) => { e.stopPropagation(); window.open(bookingUrl, '_blank'); }}>
                        <ExternalLink className="w-3 h-3 text-[#b09e8d] shrink-0" />
                        <span className="text-[10px] text-[#7a6b5c] font-mono truncate flex-1">/book/{et.slug}</span>
                        <button onClick={(e) => { e.stopPropagation(); copyToClipboard(bookingUrl); toast.success('Link copied!'); }}
                          className="p-1 rounded hover:bg-[#f0ebe5] text-[#b09e8d] hover:text-primary transition-colors shrink-0">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="px-5 py-3 border-t border-black/[0.04] bg-[var(--app-bg)] flex items-center justify-between">
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await api.patch(`/api/calendar/event-types/${et.id}`, { is_active: !et.isActive });
                            setEventTypes((p) => p.map((x) => x.id === et.id ? { ...x, isActive: !x.isActive } : x));
                            toast.success(et.isActive ? 'Set to Inactive' : 'Set to Active');
                          } catch { toast.error('Failed'); }
                        }} className="relative rounded-full transition-colors duration-200 shrink-0"
                          style={{ width: 36, height: 20, background: et.isActive ? '#22c55e' : '#d1d5db' }}>
                          <span className="absolute top-[2px] rounded-full bg-white shadow-sm transition-all duration-200"
                            style={{ width: 16, height: 16, left: et.isActive ? 18 : 2 }} />
                        </button>
                        <span className={cn('text-[13px] font-semibold', et.isActive ? 'text-green-600' : 'text-[#b09e8d]')}>{et.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        if (!(await confirmDialog({ message: `Delete "${et.name}"? All booking links will stop working.` }))) return;
                        try { await api.delete(`/api/calendar/event-types/${et.id}`); setEventTypes((p) => p.filter((x) => x.id !== et.id)); toast.success('Deleted'); }
                        catch { toast.error('Failed to delete'); }
                      }} className="p-1.5 rounded-lg hover:bg-red-50 text-[#c4b09e] hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ APPOINTMENTS TAB ═══════════ */}
      {tab === 'appointments' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            {([
              { key: 'all',          label: 'All',          count: apptStats.total       },
              { key: 'booked',       label: 'Booked',       count: apptStats.booked      },
              { key: 'show-up',      label: 'Show Up',      count: apptStats.showUp      },
              { key: 'no-show',      label: 'No Show',      count: apptStats.noShow      },
              { key: 'rescheduled',  label: 'Rescheduled',  count: apptStats.rescheduled },
              { key: 'cancelled',    label: 'Cancelled',    count: apptStats.cancelled   },
            ] as const).map((f) => (
              <button key={f.key} onClick={() => setApptFilter(f.key)}
                className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold border transition-all',
                  apptFilter === f.key ? 'text-white border-transparent' : 'text-[#7a6b5c] border-black/10 bg-white hover:bg-[var(--app-bg)]')}
                style={apptFilter === f.key ? shadowStyle : { boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                {f.label}
                <span className={cn('text-[10px] rounded-full px-1.5 py-0.5 min-w-[20px] text-center font-bold',
                  apptFilter === f.key ? 'bg-white/20' : 'bg-black/[0.06] text-[#7a6b5c]')}>{f.count}</span>
              </button>
            ))}
          </div>

          {Object.keys(groupedApts).length === 0 ? (
            <div className="bg-white rounded-2xl border border-black/5 py-20 text-center" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <Clock className="w-10 h-10 mx-auto text-[#c4b09e] mb-3" />
              <p className="text-[15px] font-semibold text-[#1c1410]">No appointments</p>
              <p className="text-[14px] text-[#7a6b5c] mt-1">No {apptFilter === 'all' ? '' : apptFilter} appointments found.</p>
            </div>
          ) : (
            Object.entries(groupedApts).map(([date, apts]) => (
              <div key={date}>
                <p className="text-[13px] font-bold uppercase tracking-wider text-[#7a6b5c] mb-2 px-1">{format(parseISO(date), 'EEEE, MMMM d, yyyy')}</p>
                <div className="space-y-3">
                  {apts.map((apt) => (
                    <div key={apt.id} className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                      <div className="px-6 py-4 flex items-center gap-5 cursor-pointer hover:bg-[var(--app-bg)] transition-colors"
                        onClick={() => { const e = calendarEvents.find((ce) => ce.id === apt.id); if (e) setSelectedEvent(e); }}>
                        <div className={cn('w-3 h-3 rounded-full shrink-0', DOT_COLOR[apt.status])} />
                        <div className="flex-1 min-w-0 flex items-center gap-6 flex-wrap">
                          <div className="min-w-[180px]">
                            <p className="text-[15px] font-bold text-[#1c1410]">{apt.leadName}</p>
                            <p className="text-[13px] text-[#7a6b5c]">{apt.email}</p>
                          </div>
                          <div className="flex items-center gap-1.5 text-[13px] text-[#7a6b5c]">
                            <Clock className="w-3.5 h-3.5" /> {fmt12(apt.startTime)} - {fmt12(apt.endTime)}
                          </div>
                          <span className="text-[13px] text-primary font-semibold">{apt.eventTypeName}</span>
                          <span className="text-[11px] text-[#b09e8d]">{apt.timezone}</span>
                        </div>
                        <span className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0', STATUS_BADGE[apt.status])}>{STATUS_LBL[apt.status]}</span>
                      </div>
                      <div className="px-6 py-3 border-t border-black/[0.04] bg-[var(--app-bg)] flex items-center gap-2 flex-wrap">
                        {(apt.status === 'booked' || apt.status === 'rescheduled') && [
                          { label: 'Show Up',  status: 'completed', Icon: UserCheck,    cls: 'text-green-600 bg-green-50 border-green-200 hover:bg-green-100' },
                          { label: 'No Show',  status: 'no-show',   Icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100' },
                          { label: 'Cancel',   status: 'cancelled', Icon: Ban,           cls: 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100' },
                        ].map(({ label, status, Icon, cls }) => (
                          <button key={status} onClick={async () => {
                            try { await api.patch(`/api/calendar/${apt.id}`, { status }); setCalendarEvents((p) => p.map((e) => e.id === apt.id ? { ...e, status: status as any } : e)); toast.success(label); }
                            catch { toast.error('Failed'); }
                          }} className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold border transition-colors', cls)}>
                            <Icon className="w-3.5 h-3.5" /> {label}
                          </button>
                        ))}
                        {apt.status === 'booked' && (
                          <button onClick={() => { const e = calendarEvents.find((ce) => ce.id === apt.id); if (e) setSelectedEvent(e); }}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold border transition-colors text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100">
                            <RefreshCw className="w-3.5 h-3.5" /> Reschedule
                          </button>
                        )}
                        <button onClick={async () => {
                          if (!(await confirmDialog({ message: 'Delete this event?' }))) return;
                          try { await deleteEvent(apt.id); } catch { toast.error('Failed'); }
                        }} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-bold text-red-500 hover:bg-red-50 border border-transparent transition-colors">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}


      {/* ═══════════ NEW EVENT MODAL ═══════════ */}
      {showNewEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowNewEvent(false); setLeadSearch(''); setShowLeadDrop(false); } }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-black/[0.05] flex items-center justify-between">
              <h3 className="font-headline font-semibold text-[16px] text-[#1c1410]">New Event</h3>
              <button onClick={() => { setShowNewEvent(false); setLeadSearch(''); setShowLeadDrop(false); }} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c]"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Date</label>
                  <input type="date" value={newEventForm.date} onChange={(e) => setNewEventForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-primary/40" />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Time</label>
                  <select value={newEventForm.time} onChange={(e) => setNewEventForm((f) => ({ ...f, time: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-primary/40 bg-white">
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmt12(t)}</option>)}
                  </select>
                </div>
              </div>
              <div className="relative">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Lead</label>
                <div className="relative">
                  <input
                    value={leadSearch}
                    onChange={(e) => { const v = e.target.value; setLeadSearch(v); setNewEventForm((f) => ({ ...f, leadId: '', leadName: v })); setShowLeadDrop(true); }}
                    onFocus={() => setShowLeadDrop(true)}
                    onBlur={() => setTimeout(() => setShowLeadDrop(false), 150)}
                    placeholder="Search lead name or email…"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[14px] outline-none focus:border-primary/40 placeholder:text-[#c4b09e]" />
                  {newEventForm.leadId && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500"><Check className="w-3.5 h-3.5" /></span>}
                </div>
                {showLeadDrop && leadSearch.length > 0 && (() => {
                  const q = leadSearch.toLowerCase();
                  const matches = leads.filter((l) =>
                    (l.firstName + ' ' + l.lastName).toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q)
                  ).slice(0, 6);
                  return (
                    <div className="absolute left-0 right-0 top-full mt-1 z-[60] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-44 overflow-y-auto">
                      {matches.length > 0 ? matches.map((l) => (
                        <button key={l.id} type="button"
                          onMouseDown={() => { const name = (l.firstName + ' ' + l.lastName).trim(); setLeadSearch(name); setNewEventForm((f) => ({ ...f, leadId: l.id, leadName: name })); setShowLeadDrop(false); }}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--app-bg)] transition-colors">
                          <p className="text-[13px] font-semibold text-[#1c1410]">{l.firstName} {l.lastName}</p>
                          {l.email && <p className="text-[11px] text-[#9c8f84]">{l.email}</p>}
                        </button>
                      )) : (
                        <p className="px-3 py-2 text-[13px] text-[#9c8f84]">No match - will save as guest name</p>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Type</label>
                <div className="flex gap-2">
                  {(['call','demo','meeting'] as const).map((t) => (
                    <button key={t} onClick={() => setNewEventForm((f) => ({ ...f, type: t }))}
                      className={cn('flex-1 py-2 rounded-xl text-[13px] font-bold border capitalize transition-all',
                        newEventForm.type === t ? 'text-white border-transparent' : 'text-[#7a6b5c] border-black/10 bg-white hover:bg-[var(--app-bg)]')}
                      style={newEventForm.type === t ? shadowStyle : {}}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Duration</label>
                <div className="flex gap-2">
                  {[15,30,60].map((d) => (
                    <button key={d} onClick={() => setNewEventForm((f) => ({ ...f, duration: d }))}
                      className={cn('flex-1 py-2 rounded-xl text-[13px] font-bold border transition-all',
                        newEventForm.duration === d ? 'text-white border-transparent' : 'text-[#7a6b5c] border-black/10 bg-white hover:bg-[var(--app-bg)]')}
                      style={newEventForm.duration === d ? shadowStyle : {}}>{d} min</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Assign Staff <span className="normal-case text-[#b09e8d] font-normal">(optional)</span></label>
                <select value={newEventForm.assignedTo} onChange={(e) => setNewEventForm((f) => ({ ...f, assignedTo: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-primary/40 bg-white">
                  <option value="">Unassigned</option>
                  {staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#5c5245] mb-1 block">Meeting Link <span className="normal-case text-[#b09e8d] font-normal">(optional)</span></label>
                <input value={newEventForm.meetingLink} onChange={(e) => setNewEventForm((f) => ({ ...f, meetingLink: e.target.value }))}
                  placeholder="https://meet.google.com/xxx-yyy-zzz"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[14px] outline-none focus:border-primary/40 placeholder:text-[#c4b09e]" />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-2">
              <button onClick={() => setShowNewEvent(false)} className="flex-1 py-2.5 rounded-xl text-[14px] font-bold text-[#7a6b5c] border border-black/10 bg-white hover:bg-[var(--app-bg)]">Cancel</button>
              <button onClick={handleCreateEvent} disabled={newEventForm.leadName.trim().length < 2}
                className="flex-1 py-2.5 rounded-xl text-[14px] font-bold text-white disabled:opacity-40 transition-opacity" style={shadowStyle}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ APPOINTMENTS POPUP (from Appointments tab) ═══════════ */}
      {selectedEvent && (
        <ApptPopup event={selectedEvent} onClose={() => setSelectedEvent(null)} onStatusChange={updateEventStatus} onDelete={deleteEvent} onUpdate={updateEventLocal} staff={staff} />
      )}

    </div>
  );
}
