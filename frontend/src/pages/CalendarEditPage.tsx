import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, Copy, ChevronDown, X, Check, ExternalLink, Pencil,
  Search, Mail, Phone, Type, Hash, AlignLeft, GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCrmStore } from '@/store/crmStore';
import { format, parseISO } from 'date-fns';

const gradStyle  = { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' };
const shadowStyle = { ...gradStyle, boxShadow: '0 4px 14px rgba(234,88,12,0.28)' };

interface TimeSlot   { start: string; end: string; }
interface DaySchedule { enabled: boolean; slots: TimeSlot[]; }
interface FormField {
  id: string; label: string; required: boolean; enabled: boolean;
  type?: 'text' | 'email' | 'phone' | 'number' | 'textarea';
  placeholder?: string;
  mapTo?: string;
}
export interface EventType {
  id: string; name: string; duration: number; description: string; slug: string;
  staffType: 'single' | 'multi'; assignmentMode: 'round-robin' | 'priority';
  staffEmails: string[]; meetingType: string; meetingLink?: string;
  schedulingType: 'days' | 'range' | 'indefinite'; daysInFuture: number;
  dateRangeStart?: string; dateRangeEnd?: string;
  redirectUrl?: string;
  maxPerDay: number; minNoticeValue: number; minNoticeUnit: string;
  capacityPerSlot: number;
  timeZone: string; schedule: Record<string, DaySchedule>; bufferTime: number;
  isActive: boolean; formFields: FormField[];
  dateOverrides?: Record<string, DaySchedule>;
}

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_SCHEDULE: Record<string, DaySchedule> = {
  Sun: { enabled: true,  slots: [{ start: '09:30', end: '10:00' }, { start: '11:00', end: '11:30' }, { start: '16:00', end: '16:30' }] },
  Mon: { enabled: true,  slots: [{ start: '09:30', end: '10:00' }, { start: '11:00', end: '11:30' }, { start: '16:00', end: '16:30' }] },
  Tue: { enabled: true,  slots: [{ start: '09:00', end: '09:30' }, { start: '12:00', end: '12:30' }, { start: '16:00', end: '16:30' }] },
  Wed: { enabled: true,  slots: [{ start: '09:30', end: '10:00' }, { start: '11:00', end: '11:30' }, { start: '16:00', end: '16:30' }] },
  Thu: { enabled: true,  slots: [{ start: '09:30', end: '10:00' }, { start: '11:00', end: '11:30' }, { start: '16:00', end: '16:30' }] },
  Fri: { enabled: true,  slots: [{ start: '09:30', end: '10:00' }, { start: '11:00', end: '11:30' }, { start: '16:00', end: '16:30' }] },
  Sat: { enabled: false, slots: [] },
};
const DEFAULT_FIELDS: FormField[] = [
  { id: 'ff1', label: 'Name',  required: true, enabled: true, type: 'text',  mapTo: 'name',  placeholder: 'Your name' },
  { id: 'ff2', label: 'Email', required: true, enabled: true, type: 'email', mapTo: 'email', placeholder: 'your@email.com' },
  { id: 'ff3', label: 'Phone', required: true, enabled: true, type: 'phone', mapTo: 'phone', placeholder: '+91 98765 43210' },
];

const STANDARD_PICKER_FIELDS = [
  { slug: 'name',          label: 'Name',          type: 'text'    as const, Icon: Type },
  { slug: 'email',         label: 'Email',         type: 'email'   as const, Icon: Mail },
  { slug: 'phone',         label: 'Phone',         type: 'phone'   as const, Icon: Phone },
  { slug: 'business_name', label: 'Business Name', type: 'text'    as const, Icon: Type },
  { slug: 'postal_code',   label: 'Postal Code',   type: 'text'    as const, Icon: Hash },
  { slug: 'notes',         label: 'Notes / Message', type: 'textarea' as const, Icon: AlignLeft },
];

const FIELD_TYPE_ICON: Record<string, React.ElementType> = {
  email: Mail, phone: Phone, number: Hash, textarea: AlignLeft,
};

function FieldIcon({ type }: { type?: string }) {
  const Icon = type ? (FIELD_TYPE_ICON[type] ?? Type) : Type;
  return <Icon className="w-3.5 h-3.5 text-primary" />;
}

function CalendarFieldPickerModal({
  usedMapTos,
  customFields,
  onAdd,
  onClose,
}: {
  usedMapTos: string[];
  customFields: { id: string; name: string; slug: string; type: string }[];
  onAdd: (field: FormField) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();

  const filteredStd    = STANDARD_PICKER_FIELDS.filter((f) => f.label.toLowerCase().includes(q));
  const filteredCustom = customFields.filter((f) => f.name.toLowerCase().includes(q));

  const mapTypeToFieldType = (t: string): FormField['type'] => {
    if (t === 'Email' || t === 'email') return 'email';
    if (t === 'Phone' || t === 'phone') return 'phone';
    if (t === 'Number' || t === 'number') return 'number';
    if (t === 'Multi Line' || t === 'textarea') return 'textarea';
    return 'text';
  };

  const Row = ({ slug, label, type, Icon }: { slug: string; label: string; type: FormField['type']; Icon: React.ElementType }) => {
    const added = usedMapTos.includes(slug);
    return (
      <button
        disabled={added}
        onClick={() => {
          onAdd({ id: `ff-${Date.now()}`, label, type, mapTo: slug, required: false, enabled: true, placeholder: '' });
          onClose();
        }}
        className={cn(
          'flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl border transition-all',
          added ? 'border-emerald-200 bg-emerald-50 cursor-not-allowed'
                : 'border-black/8 bg-white hover:border-primary/30 hover:bg-primary/5',
        )}
      >
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', added ? 'bg-emerald-100' : 'bg-primary/10')}>
          {added ? <Check className="w-4 h-4 text-emerald-600" /> : <Icon className="w-4 h-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-[13px] font-semibold truncate', added ? 'text-emerald-700' : 'text-[#1c1410]')}>{label}</p>
          <p className="text-[10px] text-[#b09e8d] capitalize">{type}</p>
        </div>
        {added && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">Added</span>}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <div>
            <h3 className="font-bold text-[#1c1410] text-[15px]">Add a Field</h3>
            <p className="text-[11px] text-[#7a6b5c] mt-0.5">Pick a CRM field to add to the booking form</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 bg-[var(--app-bg)] border border-black/8 rounded-xl px-3 py-2">
            <Search className="w-3.5 h-3.5 text-[#b09e8d] shrink-0" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fields…"
              className="flex-1 text-[13px] bg-transparent outline-none text-[#1c1410] placeholder:text-[#b09e8d]" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {filteredStd.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#7a6b5c] mb-2">Standard Fields</p>
              <div className="space-y-1.5">
                {filteredStd.map((f) => <Row key={f.slug} slug={f.slug} label={f.label} type={f.type} Icon={f.Icon} />)}
              </div>
            </div>
          )}
          {filteredCustom.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#7a6b5c] mb-2">Custom Fields</p>
              <div className="space-y-1.5">
                {filteredCustom.map((f) => (
                  <Row key={f.slug} slug={f.slug} label={f.name} type={mapTypeToFieldType(f.type)} Icon={FIELD_TYPE_ICON[mapTypeToFieldType(f.type) ?? ''] ?? Type} />
                ))}
              </div>
            </div>
          )}
          {filteredStd.length === 0 && filteredCustom.length === 0 && (
            <p className="text-center text-[13px] text-[#b09e8d] py-6">No fields match "{search}"</p>
          )}
        </div>
      </div>
    </div>
  );
}

function BlueToggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className="relative rounded-full transition-colors duration-200 shrink-0"
      style={{ width: 40, height: 22, background: on ? '#3b82f6' : '#d1d5db' }}>
      <span className="absolute top-[2px] rounded-full bg-white shadow-sm transition-all duration-200"
        style={{ width: 18, height: 18, left: on ? 20 : 2 }} />
    </button>
  );
}

export default function CalendarEditPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { staff, customFields } = useCrmStore();
  const activeStaff = staff.filter((s) => s.status === 'active');
  const [showFieldPicker, setShowFieldPicker] = useState(false);

  const et = location.state?.eventType as EventType | undefined;
  const isEdit = !!et;

  const [section, setSection] = useState<'details' | 'availability' | 'fields'>('details');
  const [form, setForm] = useState<EventType>(et ? (() => {
    const copy: EventType = JSON.parse(JSON.stringify(et));
    if (!copy.formFields || copy.formFields.length === 0) {
      copy.formFields = JSON.parse(JSON.stringify(DEFAULT_FIELDS));
    }
    return copy;
  })() : {
    id: `et-${Date.now()}`, name: '', duration: 30, description: '', slug: '',
    staffType: 'single', assignmentMode: 'round-robin',
    staffEmails: [],
    meetingType: 'Google Meet', schedulingType: 'days', daysInFuture: 40,
    timeZone: 'Asia/Kolkata', schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
    bufferTime: 0, isActive: true, formFields: JSON.parse(JSON.stringify(DEFAULT_FIELDS)),
    dateOverrides: {}, maxPerDay: 0, minNoticeValue: 2, minNoticeUnit: 'days', capacityPerSlot: 1,
    redirectUrl: undefined, dateRangeStart: undefined, dateRangeEnd: undefined,
  });

  // Location link modal state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [pendingLocationType, setPendingLocationType] = useState('');
  const [locationLinkDraft, setLocationLinkDraft] = useState('');

  const openLocationModal = (type: string) => {
    setPendingLocationType(type);
    setLocationLinkDraft(form.meetingLink ?? '');
    setShowLocationModal(true);
  };
  const confirmLocation = () => {
    upd('meetingType', pendingLocationType);
    upd('meetingLink', locationLinkDraft.trim() || undefined);
    setShowLocationModal(false);
  };

  // Date override modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideDate, setOverrideDate] = useState('');
  const [overrideDay, setOverrideDay] = useState<DaySchedule>({ enabled: true, slots: [{ start: '09:00', end: '17:00' }] });

  const upd = (k: keyof EventType, v: unknown) => setForm((p) => ({ ...p, [k]: v }));
  const toggleDay  = (day: string) => setForm((p) => ({ ...p, schedule: { ...p.schedule, [day]: { ...p.schedule[day], enabled: !p.schedule[day].enabled } } }));
  const addSlot    = (day: string) => setForm((p) => ({ ...p, schedule: { ...p.schedule, [day]: { ...p.schedule[day], slots: [...p.schedule[day].slots, { start: '09:00', end: '09:30' }] } } }));
  const removeSlot = (day: string, i: number) => setForm((p) => ({ ...p, schedule: { ...p.schedule, [day]: { ...p.schedule[day], slots: p.schedule[day].slots.filter((_, si) => si !== i) } } }));
  const updateSlot = (day: string, i: number, f: 'start' | 'end', v: string) => setForm((p) => ({ ...p, schedule: { ...p.schedule, [day]: { ...p.schedule[day], slots: p.schedule[day].slots.map((s, si) => si === i ? { ...s, [f]: v } : s) } } }));

  const validateOverlaps = (): string | null => {
    for (const [day, ds] of Object.entries(form.schedule)) {
      if (!ds.enabled || ds.slots.length < 2) continue;
      const sorted = [...ds.slots].sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].end > sorted[i + 1].start) return day;
      }
    }
    return null;
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Calendar name is required'); return; }
    const overlapDay = validateOverlaps();
    if (overlapDay) { toast.error(`Overlapping time slots on ${overlapDay} - fix before saving`); return; }

    const payload = {
      ...form,
      slug: form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      form_fields:       form.formFields,
      date_overrides:    form.dateOverrides    ?? {},
      meeting_link:      form.meetingLink      ?? null,
      date_range_start:  form.dateRangeStart   ?? null,
      date_range_end:    form.dateRangeEnd     ?? null,
      redirect_url:      form.redirectUrl      ?? null,
      max_per_day:        form.maxPerDay,
      min_notice_value:   form.minNoticeValue,
      min_notice_unit:    form.minNoticeUnit,
      capacity_per_slot:  form.capacityPerSlot,
    };
    setSaving(true);
    try {
      let saved: EventType;
      if (isEdit) {
        const updated = await api.patch<any>(`/api/calendar/event-types/${form.id}`, payload);
        saved = { ...payload, id: updated.id ?? form.id };
      } else {
        const created = await api.post<any>('/api/calendar/event-types', payload);
        saved = { ...payload, id: created.id };
      }
      toast.success(isEdit ? 'Calendar updated' : 'Calendar created');
      navigate('/calendar?tab=create-edit', { state: { savedEventType: saved } });
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.toLowerCase().includes('slug')) toast.error('This URL slug is already taken - change the calendar name or edit the slug field');
      else toast.error(msg || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const inp = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40 bg-white transition-colors';

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/calendar')}
            className="p-2 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[#1c1410] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-headline text-[18px] font-bold text-[#1c1410]">
            {isEdit ? form.name || 'Edit Calendar' : 'New Calendar'}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/calendar')}
            className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] border border-black/10 bg-white hover:bg-[var(--accent-tint)] transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
            style={shadowStyle}>
            <Check className="w-4 h-4" /> {saving ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex border-b border-black/5">
        {(['details', 'availability', 'fields'] as const).map((s) => (
          <button key={s} onClick={() => setSection(s)}
            className={cn('px-5 py-3 text-[13px] font-semibold border-b-2 transition-colors',
              section === s ? 'border-primary text-primary' : 'border-transparent text-[#7a6b5c] hover:text-[#1c1410]')}>
            {s === 'details' ? 'Details' : s === 'availability' ? 'Availability' : 'Form Fields'}
          </button>
        ))}
      </div>

      {/* ── DETAILS ── */}
      {section === 'details' && (
        <div className="bg-white rounded-2xl border border-black/5 p-8 space-y-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">
            <div className="space-y-5">
              <div>
                <label className="text-[13px] font-semibold text-[#1c1410] mb-1.5 block">Calendar name <span className="text-red-500">*</span></label>
                <input className={inp} placeholder="DigyGoSlotBooking" value={form.name} onChange={(e) => upd('name', e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#1c1410] mb-2 block">Assign Staff</label>
                <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                  {activeStaff.length === 0 ? (
                    <p className="px-4 py-3 text-[13px] text-[#b09e8d]">No active staff found. Add staff in the Staff section.</p>
                  ) : activeStaff.map((member) => (
                    <label key={member.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--app-bg)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.staffEmails.includes(member.email)}
                        onChange={(e) => upd('staffEmails', e.target.checked
                          ? [...form.staffEmails, member.email]
                          : form.staffEmails.filter((em) => em !== member.email)
                        )}
                        className="w-4 h-4 accent-primary rounded"
                      />
                      <span className="text-[13px] text-[#1c1410]">{member.name}</span>
                      <span className="text-[11px] text-[#b09e8d] ml-1">{member.email}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#1c1410] mb-1.5 block">Description</label>
                <textarea className={cn(inp, 'resize-none min-h-[120px]')} placeholder="Describe this calendar..." value={form.description} onChange={(e) => upd('description', e.target.value)} />
              </div>
            </div>
            <div className="space-y-5">
              {/* Staff type cards */}
              <div>
                <label className="text-[13px] font-semibold text-[#1c1410] mb-2 block">Staff Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'single', title: 'Single Staff', desc: 'One person owns all bookings' },
                    { key: 'multi',  title: 'Multi Staff',  desc: 'Share across your team' },
                  ] as const).map(({ key, title, desc }) => (
                    <button key={key} type="button" onClick={() => upd('staffType', key)}
                      className={cn('text-left px-4 py-3 rounded-xl border-2 transition-all',
                        form.staffType === key
                          ? 'border-primary bg-orange-50'
                          : 'border-gray-200 bg-white hover:border-gray-300')}>
                      <p className={cn('text-[13px] font-bold', form.staffType === key ? 'text-primary' : 'text-[#1c1410]')}>{title}</p>
                      <p className="text-[11px] text-[#7a6b5c] mt-0.5">{desc}</p>
                    </button>
                  ))}
                </div>
                {form.staffType === 'multi' && (
                  <div className="mt-3">
                    <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block uppercase tracking-wide">Assignment Mode</label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: 'round-robin', title: 'Round Robin',  desc: 'Distribute evenly' },
                        { key: 'priority',    title: 'Priority',     desc: 'Top person first' },
                      ] as const).map(({ key, title, desc }) => (
                        <button key={key} type="button" onClick={() => upd('assignmentMode', key)}
                          className={cn('text-left px-3 py-2.5 rounded-xl border-2 transition-all',
                            form.assignmentMode === key
                              ? 'border-blue-400 bg-blue-50'
                              : 'border-gray-200 bg-white hover:border-gray-300')}>
                          <p className={cn('text-[12px] font-bold', form.assignmentMode === key ? 'text-blue-600' : 'text-[#1c1410]')}>{title}</p>
                          <p className="text-[10px] text-[#7a6b5c] mt-0.5">{desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#1c1410] mb-2 block">Location <span className="text-red-500">*</span></label>

                {/* Selected location pill */}
                {form.meetingType && (
                  <div className="flex items-center gap-2.5 border border-gray-200 rounded-xl px-3 py-2.5 mb-2 bg-white">
                    <div className="w-5 h-5 rounded shrink-0 flex items-center justify-center text-[10px] font-bold" style={{ background: 'linear-gradient(135deg,#4285F4 0%,#0F9D58 50%,#EA4335 100%)' }}>
                      <span className="text-white text-[8px] font-extrabold">G</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#1c1410] font-medium">{form.meetingType}</p>
                      {form.meetingLink
                        ? <p className="text-[11px] text-blue-500 truncate">{form.meetingLink}</p>
                        : <p className="text-[11px] text-[#b09e8d]">No link added</p>
                      }
                    </div>
                    <button onClick={() => openLocationModal(form.meetingType)}
                      className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#b09e8d] hover:text-primary transition-colors" title="Edit link">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { upd('meetingType', ''); upd('meetingLink', undefined); }}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-[#b09e8d] hover:text-red-400 transition-colors" title="Remove">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Dropdown to pick / change location */}
                <div className="relative">
                  <select className={cn(inp, 'appearance-none pr-8')}
                    value=""
                    onChange={(e) => { if (e.target.value) openLocationModal(e.target.value); }}>
                    <option value="">{form.meetingType ? 'Change location…' : 'Add a location'}</option>
                    {['Google Meet', 'Zoom', 'Microsoft Teams', 'Phone Call', 'In-Person'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#b09e8d] pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#1c1410] mb-1.5 block">Duration (min)</label>
                <select className={inp} value={form.duration} onChange={(e) => upd('duration', Number(e.target.value))}>
                  {[15, 20, 30, 45, 60, 90, 120].map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#1c1410] mb-1.5 block">Max Bookings Per Day <span className="text-[#b09e8d] font-normal">(0 = unlimited)</span></label>
                <input type="number" min={0} className={inp} value={form.maxPerDay} onChange={(e) => upd('maxPerDay', Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#1c1410] mb-1.5 block">Capacity Per Slot <span className="text-[#b09e8d] font-normal">(1 = private · N = group · 0 = unlimited)</span></label>
                <input type="number" min={0} className={inp} value={form.capacityPerSlot} onChange={(e) => upd('capacityPerSlot', Number(e.target.value))} />
              </div>
            </div>
          </div>
          <div className="border-t border-black/[0.04] pt-6 grid grid-cols-2 gap-8">
            <div>
              <label className="text-[13px] font-semibold text-[#1c1410] mb-1.5 block">Minimum Scheduling Notice</label>
              <div className="flex items-center gap-2">
                <input type="number" className="w-24 border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40" value={form.minNoticeValue} onChange={(e) => upd('minNoticeValue', Number(e.target.value))} />
                <div className="relative">
                  <select className="border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none appearance-none pr-8 bg-white" value={form.minNoticeUnit} onChange={(e) => upd('minNoticeUnit', e.target.value)}>
                    {['minutes', 'hours', 'days'].map((u) => <option key={u}>{u}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b09e8d] pointer-events-none" />
                </div>
              </div>
            </div>
            <div>
              <label className="text-[13px] font-semibold text-[#1c1410] mb-1.5 block">Time Zone</label>
              <select className={inp} value={form.timeZone} onChange={(e) => upd('timeZone', e.target.value)}>
                {['Asia/Kolkata','UTC','America/New_York','Europe/London','Asia/Singapore'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Scheduling window */}
          <div className="border-t border-black/[0.04] pt-6 space-y-3">
            <div>
              <label className="text-[13px] font-semibold text-[#1c1410] mb-1 block">Invitees can schedule…</label>
              <p className="text-[11px] text-[#7a6b5c] mb-3">How far into the future can someone book an appointment?</p>
              <div className="flex gap-2 flex-wrap">
                {([
                  { key: 'days',       label: 'Days into future',        desc: 'e.g. next 30 days' },
                  { key: 'range',      label: 'Within a date range',     desc: 'Specific start–end' },
                  { key: 'indefinite', label: 'Indefinitely',            desc: 'No limit' },
                ] as const).map(({ key, label, desc }) => (
                  <button key={key} type="button" onClick={() => upd('schedulingType', key)}
                    className={cn('flex-1 min-w-[140px] text-left px-4 py-3 rounded-xl border-2 transition-all',
                      form.schedulingType === key
                        ? 'border-primary bg-orange-50'
                        : 'border-gray-200 bg-white hover:border-gray-300')}>
                    <p className={cn('text-[12px] font-bold', form.schedulingType === key ? 'text-primary' : 'text-[#1c1410]')}>{label}</p>
                    <p className="text-[11px] text-[#9c8f84] mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {form.schedulingType === 'days' && (
              <div className="flex items-center gap-3 pl-1">
                <input type="number" min={1} max={365}
                  className="w-24 border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40"
                  value={form.daysInFuture}
                  onChange={(e) => upd('daysInFuture', Number(e.target.value))} />
                <span className="text-[13px] text-[#7a6b5c]">calendar days into the future</span>
              </div>
            )}

            {form.schedulingType === 'range' && (
              <div className="flex items-center gap-3 pl-1 flex-wrap">
                <div>
                  <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1">From</label>
                  <input type="date"
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40"
                    value={form.dateRangeStart ?? ''}
                    onChange={(e) => upd('dateRangeStart', e.target.value)} />
                </div>
                <span className="text-[#b09e8d] mt-5">→</span>
                <div>
                  <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide block mb-1">To</label>
                  <input type="date"
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40"
                    value={form.dateRangeEnd ?? ''}
                    onChange={(e) => upd('dateRangeEnd', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Redirect URL */}
          <div className="border-t border-black/[0.04] pt-6 space-y-1.5">
            <label className="text-[13px] font-semibold text-[#1c1410] block">Redirect URL <span className="text-[#b09e8d] font-normal text-[12px] normal-case">(optional)</span></label>
            <p className="text-[11px] text-[#7a6b5c]">After a successful booking, send the invitee to this URL (e.g. a thank-you page or payment link).</p>
            <input type="url"
              className={inp}
              placeholder="https://yoursite.com/thank-you"
              value={form.redirectUrl ?? ''}
              onChange={(e) => upd('redirectUrl', e.target.value)} />
          </div>

          <div className="flex items-center justify-between py-3 border-t border-black/[0.04]">
            <div>
              <p className="text-[13px] font-semibold text-[#1c1410]">Active</p>
              <p className="text-[11px] text-[#7a6b5c]">Allow invitees to book this calendar</p>
            </div>
            <BlueToggle on={form.isActive} onChange={() => upd('isActive', !form.isActive)} />
          </div>
        </div>
      )}

      {/* ── AVAILABILITY ── */}
      {section === 'availability' && (
        <div className="bg-white rounded-2xl border border-black/5 p-8" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-8">
            <div>
              <p className="text-[14px] font-bold text-[#1c1410] mb-5">Set your weekly hours</p>
              <div className="space-y-0 divide-y divide-black/[0.04]">
                {DAYS_SHORT.map((day) => {
                  const ds = form.schedule[day];
                  return (
                    <div key={day} className="py-3">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center gap-2 w-20 shrink-0 pt-0.5">
                          <input type="checkbox" checked={ds.enabled} onChange={() => toggleDay(day)} className="w-4 h-4 accent-primary cursor-pointer" />
                          <span className={cn('text-[13px] font-bold', ds.enabled ? 'text-[#1c1410]' : 'text-[#b09e8d]')}>{day}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {!ds.enabled ? (
                            <span className="text-[13px] text-[#b09e8d]">Unavailable</span>
                          ) : (
                            <div className="space-y-1.5">
                              {ds.slots.map((slot, si) => (
                                <div key={si} className="flex items-center gap-2">
                                  <input type="time" value={slot.start} onChange={(e) => updateSlot(day, si, 'start', e.target.value)}
                                    className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-primary/40 w-28" />
                                  <span className="text-[12px] text-[#b09e8d]">-</span>
                                  <input type="time" value={slot.end} onChange={(e) => updateSlot(day, si, 'end', e.target.value)}
                                    className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-primary/40 w-28" />
                                  <button onClick={() => removeSlot(day, si)} className="p-1 rounded hover:bg-red-50 text-[#c4b09e] hover:text-red-400 transition-colors ml-1">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {ds.enabled && (
                          <div className="flex items-center gap-1 shrink-0 pt-0.5">
                            <button onClick={() => addSlot(day)} className="p-1.5 rounded hover:bg-[var(--accent-tint)] text-[#b09e8d] hover:text-primary transition-colors" title="Add slot">
                              <Plus className="w-4 h-4" />
                            </button>
                            <button onClick={() => {
                              const src = form.schedule[day].slots;
                              DAYS_SHORT.filter((d) => d !== day && form.schedule[d].enabled).forEach((d) => {
                                setForm((p) => ({ ...p, schedule: { ...p.schedule, [d]: { ...p.schedule[d], slots: JSON.parse(JSON.stringify(src)) } } }));
                              });
                              toast.success(`Copied ${day} slots to all active days`);
                            }} className="p-1.5 rounded hover:bg-[var(--accent-tint)] text-[#b09e8d] hover:text-primary transition-colors" title="Copy to all days">
                              <Copy className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border-l border-black/[0.04] pl-8 pt-8">
              <p className="text-[13px] font-bold text-[#1c1410] mb-1">Date overrides</p>
              <p className="text-[12px] text-[#7a6b5c] mb-4 leading-relaxed">Set specific dates where your availability differs from the weekly schedule.</p>

              {Object.keys(form.dateOverrides ?? {}).length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {Object.entries(form.dateOverrides ?? {}).sort().map(([date, ds]) => (
                    <div key={date} className="flex items-center justify-between px-3 py-2 bg-[var(--app-bg)] rounded-xl border border-black/[0.04]">
                      <span className="text-[12px] font-semibold text-[#1c1410]">{format(parseISO(date), 'MMM d, yyyy')}</span>
                      <span className="text-[11px] text-[#7a6b5c]">{ds.enabled ? `${ds.slots.length} slot(s)` : 'Off'}</span>
                      <button onClick={() => {
                        const updated = { ...(form.dateOverrides ?? {}) };
                        delete updated[date];
                        upd('dateOverrides', updated);
                      }} className="p-1 hover:bg-red-50 rounded text-[#c4b09e] hover:text-red-400 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setOverrideDate('');
                  setOverrideDay({ enabled: true, slots: [{ start: '09:00', end: '17:00' }] });
                  setShowOverrideModal(true);
                }}
                className="w-full border border-gray-200 rounded-xl py-2.5 text-[13px] text-[#7a6b5c] hover:bg-[var(--app-bg)] transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add a date override
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FORM FIELDS ── */}
      {section === 'fields' && (
        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {/* Header */}
          <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-bold text-[#1c1410]">Booking Form Fields</p>
              <p className="text-[12px] text-[#7a6b5c] mt-0.5">
                {form.formFields.filter(f => f.enabled).length} active · each maps to a lead field automatically
              </p>
            </div>
            <button
              onClick={() => setShowFieldPicker(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90"
              style={gradStyle}
            >
              <Plus className="w-3.5 h-3.5" /> Add Field
            </button>
          </div>

          {/* Field rows */}
          <div className="divide-y divide-black/[0.04]">
            {form.formFields.map((f) => {
              const isDefault = ['ff1','ff2','ff3'].includes(f.id);
              return (
                <div key={f.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--app-bg)] transition-colors group">
                  {/* Drag handle (visual only) */}
                  <GripVertical className="w-4 h-4 text-[#c4b09e] shrink-0 cursor-grab" />

                  {/* Enable toggle */}
                  <BlueToggle on={f.enabled}
                    onChange={() => setForm((p) => ({ ...p, formFields: p.formFields.map((ff) => ff.id === f.id ? { ...ff, enabled: !ff.enabled } : ff) }))} />

                  {/* Type icon */}
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FieldIcon type={f.type} />
                  </div>

                  {/* Label (editable) */}
                  <div className="flex-1 min-w-0">
                    <input
                      value={f.label}
                      onChange={(e) => setForm((p) => ({ ...p, formFields: p.formFields.map((ff) => ff.id === f.id ? { ...ff, label: e.target.value } : ff) }))}
                      className="text-[13px] font-semibold text-[#1c1410] bg-transparent border-0 outline-none w-full focus:bg-white focus:border focus:border-primary/30 focus:rounded-lg focus:px-2 focus:py-0.5 transition-all"
                    />
                    {f.mapTo && (
                      <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-md">
                        → {f.mapTo}
                      </span>
                    )}
                  </div>

                  {/* Required toggle — only when enabled */}
                  {f.enabled && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setForm((p) => ({ ...p, formFields: p.formFields.map((ff) => ff.id === f.id ? { ...ff, required: !ff.required } : ff) }))}
                        className="relative rounded-full transition-colors duration-200 shrink-0"
                        style={{ width: 34, height: 19, background: f.required ? '#ea580c' : '#d1d5db' }}>
                        <span className="absolute top-[2.5px] rounded-full bg-white shadow transition-all duration-200" style={{ width: 14, height: 14, left: f.required ? 17 : 2.5 }} />
                      </button>
                      <span className="text-[11px] text-[#7a6b5c] w-14">Required</span>
                    </div>
                  )}

                  {/* Delete — hidden for ff1/ff2/ff3 defaults */}
                  {!isDefault ? (
                    <button
                      onClick={() => setForm((p) => ({ ...p, formFields: p.formFields.filter((ff) => ff.id !== f.id) }))}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-[#c4b09e] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <div className="w-7 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {form.formFields.length === 0 && (
            <div className="px-6 py-10 text-center text-[13px] text-[#b09e8d]">
              No fields. Click <strong>Add Field</strong> to get started.
            </div>
          )}
        </div>
      )}

      {showFieldPicker && (
        <CalendarFieldPickerModal
          usedMapTos={form.formFields.map((f) => f.mapTo ?? f.label.toLowerCase())}
          customFields={customFields}
          onAdd={(field) => setForm((p) => ({ ...p, formFields: [...p.formFields, field] }))}
          onClose={() => setShowFieldPicker(false)}
        />
      )}

      {/* ── LOCATION LINK MODAL ── */}
      {showLocationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowLocationModal(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-black/[0.05] flex items-center justify-between">
              <div>
                <h3 className="font-headline font-semibold text-[16px] text-[#1c1410]">{pendingLocationType}</h3>
                <p className="text-[12px] text-[#7a6b5c] mt-0.5">Paste your meeting link (optional)</p>
              </div>
              <button onClick={() => setShowLocationModal(false)} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <input
                type="url"
                value={locationLinkDraft}
                onChange={(e) => setLocationLinkDraft(e.target.value)}
                placeholder="https://meet.google.com/xxx-yyy-zzz"
                autoFocus
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40 placeholder:text-[#c4b09e]"
              />
              {locationLinkDraft.trim() && (
                <a href={locationLinkDraft.trim()} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] text-blue-500 hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Test link
                </a>
              )}
            </div>
            <div className="px-6 pb-5 flex gap-2">
              <button onClick={() => setShowLocationModal(false)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-[#7a6b5c] border border-black/10 bg-white hover:bg-[var(--app-bg)]">
                Cancel
              </button>
              <button onClick={confirmLocation}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white"
                style={shadowStyle}>
                <Check className="w-4 h-4 inline mr-1" /> Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DATE OVERRIDE MODAL ── */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowOverrideModal(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-black/[0.05]">
              <h3 className="font-headline font-semibold text-[16px] text-[#1c1410]">Date Override</h3>
              <p className="text-[12px] text-[#7a6b5c] mt-0.5">Set availability for a specific date</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#5c5245] mb-1.5 block">Date</label>
                <input type="date" value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[#1c1410]">Available on this date</span>
                <BlueToggle on={overrideDay.enabled} onChange={() => setOverrideDay((p) => ({ ...p, enabled: !p.enabled }))} />
              </div>
              {overrideDay.enabled && (
                <div className="space-y-2">
                  {overrideDay.slots.map((slot, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" value={slot.start}
                        onChange={(e) => setOverrideDay((p) => ({ ...p, slots: p.slots.map((s, si) => si === i ? { ...s, start: e.target.value } : s) }))}
                        className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-primary/40 w-28" />
                      <span className="text-[12px] text-[#b09e8d]">-</span>
                      <input type="time" value={slot.end}
                        onChange={(e) => setOverrideDay((p) => ({ ...p, slots: p.slots.map((s, si) => si === i ? { ...s, end: e.target.value } : s) }))}
                        className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-primary/40 w-28" />
                      {overrideDay.slots.length > 1 && (
                        <button onClick={() => setOverrideDay((p) => ({ ...p, slots: p.slots.filter((_, si) => si !== i) }))}
                          className="p-1 rounded hover:bg-red-50 text-[#c4b09e] hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setOverrideDay((p) => ({ ...p, slots: [...p.slots, { start: '09:00', end: '09:30' }] }))}
                    className="text-[12px] text-[#7a6b5c] flex items-center gap-1 hover:text-primary transition-colors mt-1">
                    <Plus className="w-3.5 h-3.5" /> Add time slot
                  </button>
                </div>
              )}
            </div>
            <div className="px-6 pb-5 flex gap-2">
              <button onClick={() => setShowOverrideModal(false)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-[#7a6b5c] border border-black/10 bg-white hover:bg-[var(--app-bg)]">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!overrideDate) { toast.error('Please select a date'); return; }
                  if ((form.dateOverrides ?? {})[overrideDate]) { toast.error('Override already exists for this date'); return; }
                  upd('dateOverrides', { ...(form.dateOverrides ?? {}), [overrideDate]: overrideDay });
                  setShowOverrideModal(false);
                  toast.success('Date override added');
                }}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white transition-opacity"
                style={shadowStyle}>
                Save Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
