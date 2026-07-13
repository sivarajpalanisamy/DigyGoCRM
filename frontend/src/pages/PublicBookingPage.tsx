import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  format, addDays, parseISO, isToday, startOfDay, isBefore,
  addMonths, subMonths, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, startOfMonth, endOfMonth, getDay, startOfWeek,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, Clock, Video, Phone, Users, CalendarDays,
  MapPin, CheckCircle2, ArrowLeft, User, Mail, PhoneCall,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BASE = import.meta.env.VITE_API_URL ?? '';

async function publicGet<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? 'Request failed');
  return d as T;
}
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? 'Request failed');
  return d as T;
}

interface TimeSlot    { start: string; end: string; }
interface DaySchedule { enabled: boolean; slots: TimeSlot[]; }
interface FormField {
  id: string; label: string; required: boolean; enabled: boolean;
  type?: string; placeholder?: string; mapTo?: string;
}
interface PublicET {
  id: string; name: string; slug: string; duration: number; description: string;
  meeting_type: string; meeting_link?: string;
  scheduling_type: 'days' | 'range' | 'indefinite'; days_in_future: number;
  date_range_start?: string; date_range_end?: string;
  timezone: string; schedule: Record<string, DaySchedule>; buffer_time: number;
  form_fields: FormField[]; date_overrides: Record<string, DaySchedule>;
  min_notice_value: number; min_notice_unit: string; redirect_url?: string;
}

const fmt12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_FIELDS: FormField[] = [
  { id: 'ff1', label: 'Name',  required: true, enabled: true },
  { id: 'ff2', label: 'Email', required: true, enabled: true },
  { id: 'ff3', label: 'Phone', required: true, enabled: true },
];

function getSlots(et: PublicET, date: Date): string[] {
  const dayName  = DAY_NAMES[getDay(date)];
  const dateStr  = format(date, 'yyyy-MM-dd');
  const override = et.date_overrides?.[dateStr];
  let slots: TimeSlot[] = [];
  if (override !== undefined) {
    if (!override.enabled) return [];
    slots = override.slots ?? [];
  } else {
    const ds = et.schedule?.[dayName];
    if (!ds?.enabled) return [];
    slots = ds.slots ?? [];
  }
  const times: string[] = [];
  const step = et.duration + (et.buffer_time ?? 0);
  for (const s of slots) {
    const [sh, sm] = s.start.split(':').map(Number);
    const [eh, em] = s.end.split(':').map(Number);
    let cur = sh * 60 + sm;
    while (cur + et.duration <= eh * 60 + em) {
      times.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
      cur += step;
    }
  }
  if (isToday(date) && et.min_notice_value) {
    const now  = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    const unit = et.min_notice_unit ?? 'days';
    const noticeM = unit === 'minutes' ? et.min_notice_value : unit === 'hours' ? et.min_notice_value * 60 : et.min_notice_value * 1440;
    return times.filter((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m > nowM + noticeM; });
  }
  return times;
}

function isDateAllowed(et: PublicET, date: Date): boolean {
  const today = startOfDay(new Date());
  if (isBefore(date, today)) return false;
  if (et.scheduling_type === 'days') return !isBefore(addDays(today, et.days_in_future ?? 30), date);
  if (et.scheduling_type === 'range') {
    const s = et.date_range_start ? parseISO(et.date_range_start) : today;
    const e = et.date_range_end   ? parseISO(et.date_range_end)   : addDays(today, 365);
    return !isBefore(date, s) && !isBefore(e, date);
  }
  return true;
}

const typeIcons: Record<string, React.ElementType> = {
  'Google Meet': Video, 'Zoom': Video, 'Phone Call': PhoneCall, 'In-Person': MapPin,
};
const gradStyle  = { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' };
const gradShadow = { ...gradStyle, boxShadow: '0 4px 14px rgba(234,88,12,0.30)' };

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }: { step: 0 | 1 | 2 }) {
  const steps = [
    { label: 'Select Date',  icon: CalendarDays },
    { label: 'Select Time',  icon: Clock },
    { label: 'Your Details', icon: User },
  ];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map(({ label, icon: Icon }, i) => {
        const done    = i < step;
        const active  = i === step;
        const pending = i > step;
        return (
          <React.Fragment key={i}>
            <div className="flex items-center gap-2 shrink-0">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center transition-all',
                done    ? 'bg-green-500' :
                active  ? 'text-white' : 'bg-[#eef1f4]'
              )} style={active ? gradStyle : {}}>
                {done
                  ? <CheckCircle2 className="w-4 h-4 text-white" />
                  : <Icon className={cn('w-3.5 h-3.5', pending ? 'text-[#9ca3af]' : 'text-white')} />
                }
              </div>
              <span className={cn('text-[14px] font-semibold hidden sm:block',
                active  ? 'text-[var(--brand-dark)]' :
                done    ? 'text-green-600'  : 'text-[#9ca3af]'
              )}>{label}</span>
            </div>
            {i < 2 && (
              <div className={cn('flex-1 h-[2px] mx-2', done ? 'bg-green-300' : 'bg-[#eceef1]')} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [et,         setEt]         = useState<PublicET | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [notFound,   setNotFound]   = useState(false);
  const [calMonth,   setCalMonth]   = useState(() => startOfMonth(new Date()));
  const [selDate,    setSelDate]    = useState<Date | null>(null);
  const [selTime,    setSelTime]    = useState<string | null>(null);
  const [formData,   setFormData]   = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmed,  setConfirmed]  = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [formError,    setFormError]    = useState('');
  const [bookedTimes,  setBookedTimes]  = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  useEffect(() => {
    publicGet<PublicET>(`/api/calendar/public/event-type/${slug}`)
      .then((data) => { setEt(data); setLoading(false); })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [slug]);

  // Fetch already-booked times whenever the selected date changes
  useEffect(() => {
    if (!et || !selDate) { setBookedTimes([]); return; }
    let cancelled = false;
    setSlotsLoading(true);
    const dateStr = format(selDate, 'yyyy-MM-dd');
    publicGet<string[]>(`/api/calendar/public/booked-slots?event_type_id=${et.id}&date=${dateStr}`)
      .then((times) => { if (!cancelled) setBookedTimes(times); })
      .catch(() => { if (!cancelled) setBookedTimes([]); })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  }, [et?.id, selDate]);

  const calDays = useMemo(() => {
    const start = startOfWeek(calMonth, { weekStartsOn: 0 });
    const end   = endOfWeek(endOfMonth(calMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [calMonth]);

  const rawSlots       = useMemo(() => (et && selDate ? getSlots(et, selDate) : []), [et, selDate]);
  const availableSlots = useMemo(() => rawSlots.filter((t) => !bookedTimes.includes(t)), [rawSlots, bookedTimes]);
  const enabledFields  = useMemo(() => {
    const active = (et?.form_fields ?? []).filter((f) => f.enabled);
    return active.length > 0 ? active : DEFAULT_FIELDS;
  }, [et]);

  const step: 0 | 1 | 2 = selDate && selTime ? 2 : selDate ? 1 : 0;

  const handleSubmit = async () => {
    if (!et || !selDate || !selTime) return;
    setFormError('');
    for (const f of enabledFields.filter((f) => f.required)) {
      if (!formData[f.id]?.trim()) { setFormError(`${f.label} is required`); return; }
    }
    setSubmitting(true);
    try {
      // Match by mapTo first (reliable), fall back to label string match (legacy)
      const nameField  = enabledFields.find((f) => f.mapTo === 'name'  || f.label.toLowerCase() === 'name');
      const emailField = enabledFields.find((f) => f.mapTo === 'email' || f.label.toLowerCase() === 'email');
      const phoneField = enabledFields.find((f) => f.mapTo === 'phone' || f.label.toLowerCase() === 'phone');

      const coreIds = new Set([nameField?.id, emailField?.id, phoneField?.id].filter(Boolean));
      const extraFields: Record<string, string> = {};
      for (const f of enabledFields) {
        if (!coreIds.has(f.id) && f.mapTo && formData[f.id]?.trim()) {
          extraFields[f.mapTo] = formData[f.id].trim();
        }
      }

      const guestName = nameField ? (formData[nameField.id] ?? '') : '';
      const res = await publicPost<any>('/api/calendar/public/book', {
        event_type_id: et.id,
        guest_name:    guestName,
        guest_email:   emailField ? (formData[emailField.id] ?? undefined) : undefined,
        guest_phone:   phoneField ? (formData[phoneField.id] ?? undefined) : undefined,
        extra_fields:  Object.keys(extraFields).length > 0 ? extraFields : undefined,
        date: format(selDate, 'yyyy-MM-dd'),
        time: selTime,
      });
      setConfirmed(true);
      if (res.redirect_url) {
        setRedirectUrl(res.redirect_url);
        setTimeout(() => { window.location.href = res.redirect_url; }, 3000);
      }
    } catch (err: any) {
      setFormError(err.message ?? 'Booking failed. Please try again.');
    } finally { setSubmitting(false); }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
      <div className="w-8 h-8 rounded-full border-[3px] border-[var(--brand-dark)] border-t-transparent animate-spin" />
    </div>
  );

  // ── Not found ──────────────────────────────────────────────────────────────
  if (notFound || !et) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--app-bg)] gap-4 p-6">
      <div className="w-16 h-16 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center">
        <CalendarDays className="w-8 h-8 text-[var(--brand-dark)]" />
      </div>
      <h2 className="text-[20px] font-extrabold text-[#111318]">Calendar not found</h2>
      <p className="text-[16px] text-[#6b7280] text-center max-w-xs">
        This booking link may be inactive or the URL is incorrect.
      </p>
    </div>
  );

  const TypeIcon = typeIcons[et.meeting_type] || Users;

  // ── Confirmation screen ────────────────────────────────────────────────────
  if (confirmed) return (
    <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-10 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 className="w-8 h-8 text-green-500" />
        </div>
        <h2 className="text-[22px] font-extrabold text-[#111318] mb-1">You're booked!</h2>
        <p className="text-[15px] text-[#6b7280] mb-7">
          A confirmation has been recorded. See you soon!
        </p>
        <div className="bg-[var(--app-bg)] rounded-2xl p-5 text-left space-y-3 mb-6">
          <div className="flex items-center gap-3 text-[15px] text-[#111318]">
            <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
              <CalendarDays className="w-4 h-4 text-[var(--brand-dark)]" />
            </div>
            <div>
              <p className="font-bold">{selDate ? format(selDate, 'EEEE, MMMM d, yyyy') : ''}</p>
              <p className="text-[14px] text-[#6b7280]">{selTime ? fmt12(selTime) : ''} · {et.duration} min</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[15px] text-[#111318]">
            <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
              <TypeIcon className="w-4 h-4 text-[var(--brand-dark)]" />
            </div>
            <p className="font-medium">{et.meeting_type}</p>
          </div>
          {et.meeting_link && (
            <a href={et.meeting_link} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 text-[15px] text-blue-500 hover:text-blue-600 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <Video className="w-4 h-4" />
              </div>
              <span className="font-medium underline underline-offset-2">Join Meeting</span>
            </a>
          )}
        </div>
        {redirectUrl && (
          <p className="text-[14px] text-[#6b7280]">Redirecting you shortly…</p>
        )}
      </div>
    </div>
  );

  // ── Main booking page ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fcfcfd] via-white to-[var(--app-bg)]">

      {/* Top bar */}
      <header className="bg-white/90 backdrop-blur-sm border-b border-black/[0.06] sticky top-0 z-20"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
        <div className="max-w-5xl mx-auto px-5 py-3.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0" style={gradStyle}>
            <CalendarDays className="w-4 h-4" />
          </div>
          <span className="text-[16px] font-bold text-[#111318]">Book an Appointment</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-[5fr_7fr] gap-6 items-start">

          {/* ── Left: Event Info ──────────────────────────────────────────── */}
          <div className="md:sticky md:top-20">
            <div className="bg-white rounded-2xl overflow-hidden border border-[var(--hairline)]"
              style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>

              {/* Gradient header */}
              <div className="px-6 pt-6 pb-7 relative overflow-hidden" style={gradStyle}>
                {/* Decorative circles */}
                <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
                <div className="absolute -right-4 top-10 w-16 h-16 rounded-full bg-white/10" />
                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-4 relative z-10">
                  <TypeIcon className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-[20px] font-extrabold text-white leading-snug relative z-10">{et.name}</h1>
              </div>

              {/* Info body */}
              <div className="px-6 py-5 space-y-5">
                {et.description && (
                  <p className="text-[15px] text-[#6b7280] leading-relaxed"
                    style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {et.description}
                  </p>
                )}

                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                      <Clock className="w-4 h-4 text-[var(--brand-dark)]" />
                    </div>
                    <span className="text-[15px] text-[#4a4f57] font-medium">{et.duration} minutes</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                      <TypeIcon className="w-4 h-4 text-[var(--brand-dark)]" />
                    </div>
                    <span className="text-[15px] text-[#4a4f57] font-medium">{et.meeting_type}</span>
                  </div>
                  {et.meeting_link && (
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                        <Video className="w-4 h-4 text-[var(--brand-dark)]" />
                      </div>
                      <span className="text-[15px] text-[#4a4f57] font-medium">Meeting link provided</span>
                    </div>
                  )}
                </div>

                {/* Selected slot summary - appears dynamically */}
                {selDate && selTime && (
                  <div className="pt-4 border-t border-[#eef1f4]">
                    <p className="text-[11px] font-extrabold text-[var(--brand-dark)] uppercase tracking-widest mb-2.5">
                      Your Selection
                    </p>
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-3.5 space-y-1">
                      <p className="text-[15px] font-bold text-[#111318]">
                        {format(selDate, 'EEEE, MMMM d, yyyy')}
                      </p>
                      <p className="text-[14px] text-[#6b7280]">
                        {fmt12(selTime)} · {et.duration} min
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: Booking flow ───────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Step indicator */}
            <StepBar step={step} />

            {/* Calendar + slots - side-by-side inside one card */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] overflow-hidden"
              style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
              <div className="flex flex-col sm:flex-row">

                {/* ── Calendar (left) ── */}
                <div className={cn(
                  'flex-1 min-w-0 px-5 pt-5 pb-4 transition-all duration-300',
                  selDate && 'sm:border-r border-[#eef1f4]'
                )}>
                  {/* Month nav */}
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={() => setCalMonth((m) => subMonths(m, 1))}
                      className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-[var(--accent-tint)] text-[#6b7280] transition-colors">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <p className="text-[16px] font-extrabold text-[#111318]">
                      {format(calMonth, 'MMMM yyyy')}
                    </p>
                    <button onClick={() => setCalMonth((m) => addMonths(m, 1))}
                      className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-[var(--accent-tint)] text-[#6b7280] transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Day headers */}
                  <div className="grid grid-cols-7 mb-1">
                    {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d) => (
                      <div key={d} className="text-center text-[11px] font-bold text-[#c3c8cf] py-1 tracking-wide">{d}</div>
                    ))}
                  </div>

                  {/* Days grid */}
                  <div className="grid grid-cols-7 gap-y-0.5">
                    {calDays.map((day) => {
                      const inMonth  = isSameMonth(day, calMonth);
                      const hasSlots = inMonth && isDateAllowed(et, day) && getSlots(et, day).length > 0;
                      const isSel    = selDate ? isSameDay(day, selDate) : false;
                      const todayDay = isToday(day);
                      return (
                        <div key={day.toISOString()} className="flex flex-col items-center py-0.5">
                          <button
                            disabled={!hasSlots}
                            onClick={() => { setSelDate(day); setSelTime(null); }}
                            className={cn(
                              'w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-semibold transition-all duration-150',
                              isSel
                                ? 'text-white scale-110 shadow-md'
                                : todayDay && hasSlots
                                  ? 'ring-2 ring-primary/40 text-[var(--brand-dark)] font-bold hover:scale-105'
                                  : hasSlots
                                    ? 'text-[#111318] hover:bg-[var(--accent-tint)] hover:scale-105 cursor-pointer'
                                    : inMonth
                                      ? 'text-[#e5e7eb] cursor-not-allowed'
                                      : 'text-[#eceef1] cursor-default',
                            )}
                            style={isSel ? gradShadow : {}}>
                            {format(day, 'd')}
                          </button>
                          {hasSlots && !isSel && (
                            <span className="w-1 h-1 rounded-full bg-[var(--brand-dark)] mt-0.5 opacity-50" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Slots panel (right) - slides in when date is picked ── */}
                {selDate && (
                  <div className="w-full sm:w-52 shrink-0 flex flex-col border-t sm:border-t-0 border-[#eef1f4]">
                    {/* Slots header */}
                    <div className="px-4 pt-4 pb-3 border-b border-[#eef1f4]">
                      <p className="text-[15px] font-extrabold text-[#111318] leading-tight">
                        {format(selDate, 'EEE, MMM d')}
                      </p>
                      <p className="text-[12px] text-[#8b929c] mt-0.5">
                        {slotsLoading
                          ? 'Loading…'
                          : availableSlots.length > 0
                            ? `${availableSlots.length} slot${availableSlots.length !== 1 ? 's' : ''} available`
                            : rawSlots.length > 0 ? 'All times booked' : 'No slots'}
                      </p>
                    </div>

                    {/* Slot list */}
                    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 max-h-72 sm:max-h-none"
                      style={{ scrollbarWidth: 'thin' }}>
                      {slotsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <span className="w-5 h-5 rounded-full border-2 border-[var(--brand-dark)] border-t-transparent animate-spin" />
                        </div>
                      ) : availableSlots.length === 0 ? (
                        <div className="text-center py-6">
                          <Clock className="w-7 h-7 text-[#c3c8cf] mx-auto mb-2" />
                          <p className="text-[14px] text-[#6b7280] font-medium">
                            {rawSlots.length > 0 ? 'All times are booked' : 'No slots available'}
                          </p>
                          <p className="text-[12px] text-[#9ca3af] mt-0.5">Try another date</p>
                        </div>
                      ) : (
                        availableSlots.map((t) => (
                          <button key={t} onClick={() => setSelTime(t)}
                            className={cn(
                              'w-full py-2.5 rounded-xl text-[15px] font-semibold border transition-all duration-150',
                              selTime === t
                                ? 'text-white border-transparent shadow-sm scale-[1.02]'
                                : 'text-[#111318] border-[var(--hairline)] hover:border-orange-300 hover:bg-orange-50 bg-white'
                            )}
                            style={selTime === t ? gradShadow : {}}>
                            {fmt12(t)}
                          </button>
                        ))
                      )}
                    </div>

                    {/* Change date link */}
                    <div className="px-3 pb-3 pt-2 border-t border-[#eef1f4]">
                      <button
                        onClick={() => { setSelDate(null); setSelTime(null); }}
                        className="w-full flex items-center justify-center gap-1.5 text-[12px] text-[#8b929c] hover:text-[var(--brand-dark)] transition-colors font-medium py-1.5">
                        <ArrowLeft className="w-3 h-3" /> Change date
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* ── Details form - appears once slot is selected ── */}
            {selDate && selTime && (
              <div className="bg-white rounded-2xl border border-[var(--hairline)] overflow-hidden"
                style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>

                {/* Form header */}
                <div className="px-6 pt-5 pb-4 border-b border-[var(--accent-tint)] flex items-center justify-between">
                  <div>
                    <p className="text-[16px] font-extrabold text-[#111318]">Your details</p>
                    <p className="text-[14px] text-[#8b929c] mt-0.5">
                      {format(selDate, 'EEE, MMM d')} at {fmt12(selTime)}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelTime(null)}
                    className="flex items-center gap-1.5 text-[14px] text-[#6b7280] hover:text-[var(--brand-dark)] transition-colors font-medium">
                    <ArrowLeft className="w-3.5 h-3.5" /> Change time
                  </button>
                </div>

                <div className="px-6 py-5 space-y-4">
                  {enabledFields.map((f) => {
                    const mt = f.mapTo ?? f.label.toLowerCase();
                    const isEmail = mt === 'email'  || f.type === 'email';
                    const isPhone = mt === 'phone'  || f.type === 'phone';
                    const isArea  = f.type === 'textarea';
                    const FieldIcon = isEmail ? Mail : isPhone ? Phone : User;
                    const inputType = isEmail ? 'email' : isPhone ? 'tel' : f.type === 'number' ? 'number' : 'text';
                    const placeholder = f.placeholder || `Enter your ${f.label.toLowerCase()}`;
                    return (
                      <div key={f.id}>
                        <label className="text-[12px] font-bold text-[#4a4f57] uppercase tracking-wider block mb-1.5">
                          {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <div className="relative">
                          {!isArea && <FieldIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" />}
                          {isArea ? (
                            <textarea
                              value={formData[f.id] ?? ''}
                              onChange={(e) => setFormData((p) => ({ ...p, [f.id]: e.target.value }))}
                              placeholder={placeholder}
                              rows={3}
                              className="w-full border border-[var(--hairline)] rounded-xl px-3 py-2.5 text-[15px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-none"
                            />
                          ) : (
                            <input
                              type={inputType}
                              value={formData[f.id] ?? ''}
                              onChange={(e) => setFormData((p) => ({ ...p, [f.id]: e.target.value }))}
                              placeholder={placeholder}
                              className="w-full border border-[var(--hairline)] rounded-xl pl-9 pr-3 py-2.5 text-[15px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Error */}
                  {formError && (
                    <p className="text-[14px] text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                      {formError}
                    </p>
                  )}

                  {/* Submit */}
                  <button onClick={handleSubmit} disabled={submitting}
                    className="w-full py-3 rounded-xl text-[16px] font-bold text-white disabled:opacity-60 transition-all hover:-translate-y-0.5 mt-2"
                    style={gradShadow}>
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Confirming…
                      </span>
                    ) : 'Confirm Booking'}
                  </button>
                </div>
              </div>
            )}

          </div>
          {/* ── End right column ─────────────────────────────────────────── */}
        </div>
      </main>
    </div>
  );
}
