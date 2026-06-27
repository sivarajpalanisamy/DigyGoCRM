import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { useSearchParams, useLocation } from 'react-router-dom';
import { useCrmStore, LeadActivity } from '@/store/crmStore';
import { useAuthStore } from '@/store/authStore';
import { usePermission } from '@/hooks/usePermission';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, downloadBlob, fetchBlob } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { Lead, Pipeline } from '@/data/mockData';
import {
  Search, Filter, Plus, GripVertical, Phone, X, MessageCircle, Calendar,
  FileText, User, Tag, DollarSign, ChevronDown, Trash2, Check,
  Mail, Pencil, CheckSquare, RotateCcw, LayoutGrid, List, EyeOff, Eye,
  Star, ChevronRight, ArrowLeft, ArrowRight, Settings, Download, Package, Zap, Copy, ArrowUpDown, Layers,
  CalendarPlus, MoreHorizontal, UserX, ArrowLeftRight, UserCheck, UserPlus, Circle, Clock, Users, Smartphone,
  Play, Pause, Send, Megaphone, MousePointerClick,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal';
import { ExportModal } from '@/components/ui/ExportModal';
import { cn, copyToClipboard } from '@/lib/utils';
import { brandHex } from '@/lib/brand';
import { formatDistanceToNow, format, isPast } from 'date-fns';
import {
  DndContext, closestCorners, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverlay, DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';

function getSourceLabel(lead: { source: string; meta_form_name?: string }) {
  const s = lead.source ?? '';
  if (s.startsWith('calendar:')) return s.slice(9);
  if (s.startsWith('form:'))     return s.slice(5);
  if (s === 'calendar_booking')  return 'Calendar Booking';
  if (s === 'Custom Form')       return 'Custom Form';
  if (s === 'meta_form') return 'Meta';
  if (s === 'whatsapp' || s === 'WhatsApp') return 'WhatsApp';
  if (s === 'Landing Page') return 'Landing Page';
  return s || 'Manual';
}

function getSourceColor(source: string) {
  const s = source ?? '';
  if (s.startsWith('calendar:') || s === 'calendar_booking') return 'bg-teal-50 text-teal-600';
  if (s.startsWith('form:') || s === 'Custom Form')          return 'bg-purple-50 text-purple-600';
  if (s === 'meta_form')    return 'bg-blue-50 text-blue-600';
  if (s === 'whatsapp' || s === 'WhatsApp') return 'bg-emerald-50 text-emerald-600';
  if (s === 'Manual')       return 'bg-[#faf0e8] text-primary';
  if (s === 'Landing Page') return 'bg-amber-50 text-amber-600';
  return 'bg-gray-100 text-gray-500';
}

const SOURCE_COLORS: Record<string, string> = {
  'meta_form':        'bg-blue-50 text-blue-600',
  'Meta Forms':       'bg-blue-50 text-blue-600',
  'WhatsApp':         'bg-emerald-50 text-emerald-600',
  'whatsapp':         'bg-emerald-50 text-emerald-600',
  'Custom Form':      'bg-purple-50 text-purple-600',
  'Manual':           'bg-[#faf0e8] text-primary',
  'Landing Page':     'bg-amber-50 text-amber-600',
  'calendar_booking': 'bg-teal-50 text-teal-600',
};

const TAG_COLORS: Record<string, string> = {
  'Hot Lead': 'bg-red-100 text-red-700', 'Enterprise': 'bg-purple-100 text-purple-700',
  'SMB': 'bg-blue-100 text-blue-700', 'Follow Up': 'bg-yellow-100 text-yellow-700',
  'Demo Scheduled': 'bg-green-100 text-green-700', 'Price Sent': 'bg-orange-100 text-orange-700',
  'Urgent': 'bg-red-100 text-red-700', 'VIP': 'bg-amber-100 text-amber-700',
};

// ─── Add Lead Modal ────────────────────────────────────────────────────────────
function AddLeadModal({ onClose }: { onClose: () => void }) {
  const { addLead, pipelines, leads, staff, tags: storeTags } = useCrmStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const now = new Date().toISOString();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '+91 ',
    city: '', pipelineId: pipelines[0]?.id ?? '', stage: pipelines[0]?.stages[0]?.name ?? '',
    tags: [] as string[], tagInput: '', dealValue: 0, source: 'Manual',
    assignedTo: [] as string[], leadQuality: '',
  });
  const [staffDropOpen, setStaffDropOpen] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [tagDropOpen, setTagDropOpen] = useState(false);

  // Build assignable list: owner (current user if owner) + all staff
  const assignableStaff = (() => {
    const list = [...staff];
    if (currentUser && !list.some((s: any) => s.id === currentUser.id)) {
      list.unshift({ id: currentUser.id, name: currentUser.name } as any);
    }
    return list;
  })();

  const selectedPipeline = pipelines.find((p) => p.id === form.pipelineId);

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.phone.trim()) { toast.error('Name and phone are required'); return; }
    const normalizedPhone = form.phone.replace(/\D/g, '');
    if (normalizedPhone.length > 4) {
      const dup = leads.find((l) => l.phone.replace(/\D/g, '') === normalizedPhone);
      if (dup) { toast.error(`Phone already exists: ${dup.firstName} ${dup.lastName}`); return; }
    }
    setSaving(true);
    try {
      const stageId = selectedPipeline?.stages.find((s) => s.name === form.stage)?.id;
      const created = await api.post<any>('/api/leads', {
        name: `${form.firstName} ${form.lastName}`.trim(),
        email: form.email,
        phone: form.phone,
        source: form.source,
        pipeline_id: form.pipelineId || undefined,
        stage_id: stageId || undefined,
        assigned_to: form.assignedTo[0] || undefined,
        team_members: form.assignedTo.length > 0 ? form.assignedTo : undefined,
        tags: form.tags,
        custom_fields: form.leadQuality ? { lead_quality: form.leadQuality } : undefined,
      });
      addLead({
        id: created.id,
        firstName: form.firstName, lastName: form.lastName,
        email: form.email, phone: form.phone,
        pipelineId: form.pipelineId, stage: form.stage,
        source: form.source, dealValue: form.dealValue,
        tags: form.tags, score: 0, notes: [],
        // Use the assignee the backend actually set (it auto-assigns to the creator
        // when none is chosen and the creator can't view all leads) so the new lead
        // shows under the right owner immediately, not as unassigned until refresh.
        assignedTo: created.assigned_to ?? form.assignedTo[0] ?? '',
        assignedName: created.assigned_name ?? '',
        leadQuality: form.leadQuality || undefined,
        createdAt: created.created_at ?? now, lastActivity: created.created_at ?? now,
      });
      toast.success('Lead added');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to add lead');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-[#faf8f6] border border-black/10 rounded-xl px-3.5 py-2.5 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 focus:bg-white transition-all placeholder:text-[#b09e8d]';
  const lbl = (text: string, required = false) => (
    <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">{text}{required && <span className="text-primary ml-0.5">*</span>}</label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] border border-black/5">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Plus className="w-4 h-4 text-primary" /></div>
            <h3 className="text-[16px] font-bold text-[#1c1410]">Add Lead</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 text-[#7a6b5c] flex items-center justify-center transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <div className="sm:col-span-2">
              {lbl('Contact Name', true)}
              <input className={inputCls} placeholder="e.g. Priya Sharma" value={`${form.firstName} ${form.lastName}`.trim()} onChange={(e) => { const [f, ...l] = e.target.value.split(' '); setForm({ ...form, firstName: f, lastName: l.join(' ') }); }} />
            </div>
            <div>
              {lbl('Phone', true)}
              <div className="flex items-center gap-2 bg-[#faf8f6] border border-black/10 rounded-xl px-3.5 py-2.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 focus-within:bg-white transition-all">
                <span className="text-[13px] font-semibold text-[#7a6b5c] shrink-0">🇮🇳 +91</span>
                <input className="flex-1 min-w-0 text-[13px] text-[#1c1410] outline-none bg-transparent placeholder:text-[#b09e8d]" placeholder="81234 56789" value={form.phone.replace('+91 ', '')} onChange={(e) => setForm({ ...form, phone: '+91 ' + e.target.value })} />
              </div>
            </div>
            <div>
              {lbl('Email')}
              <input className={inputCls} type="email" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              {lbl('Pipeline', true)}
              <select className={inputCls} value={form.pipelineId} onChange={(e) => {
                const pl = pipelines.find((p) => p.id === e.target.value);
                setForm({ ...form, pipelineId: e.target.value, stage: pl?.stages[0]?.name ?? '' });
              }}>
                <option value="">Select Pipeline</option>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              {lbl('Stage', true)}
              <select className={inputCls} value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {(selectedPipeline?.stages ?? []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              {lbl('City')}
              <input className={inputCls} placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              {lbl('Lead Quality')}
              <select className={inputCls} value={form.leadQuality} onChange={(e) => setForm({ ...form, leadQuality: e.target.value })}>
                <option value="">Select quality…</option>
                <option value="Hot">Hot</option>
                <option value="Warm">Warm</option>
                <option value="Cold">Cold</option>
                <option value="Unqualified">Unqualified</option>
              </select>
            </div>
            <div>
              {lbl('Lead Value')}
              <input className={inputCls} type="number" placeholder="0" value={form.dealValue || ''} onChange={(e) => setForm({ ...form, dealValue: Number(e.target.value) })} />
            </div>
            {/* Assign To — multi-select chips */}
            <div className="sm:col-span-2 relative">
              {lbl('Assign To')}
              <div
                className="bg-[#faf8f6] border border-black/10 rounded-xl px-3.5 py-2.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 focus-within:bg-white transition-all cursor-text"
                onClick={() => setStaffDropOpen(true)}
              >
                {form.assignedTo.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {form.assignedTo.map((id) => {
                      const s = assignableStaff.find((x: any) => x.id === id);
                      return (
                        <span key={id} className="text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md flex items-center gap-1">
                          {s?.name ?? 'Unknown'}
                          <button type="button" onClick={(e) => { e.stopPropagation(); setForm({ ...form, assignedTo: form.assignedTo.filter((x) => x !== id) }); }} className="hover:text-red-500">×</button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <input
                  className="w-full text-[13px] outline-none bg-transparent placeholder:text-[#b09e8d]"
                  placeholder={form.assignedTo.length === 0 ? 'Search staff…' : ''}
                  value={staffSearch}
                  onChange={(e) => { setStaffSearch(e.target.value); setStaffDropOpen(true); }}
                  onFocus={() => setStaffDropOpen(true)}
                />
              </div>
              {staffDropOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStaffDropOpen(false)} />
                  <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-black/10 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {assignableStaff
                      .filter((s: any) => s.name.toLowerCase().includes(staffSearch.toLowerCase()))
                      .map((s: any) => {
                        const selected = form.assignedTo.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`w-full text-left px-3.5 py-2 text-[13px] flex items-center justify-between hover:bg-gray-50 transition-colors ${selected ? 'text-primary font-semibold' : 'text-[#1c1410]'}`}
                            onClick={() => {
                              setForm({ ...form, assignedTo: selected ? form.assignedTo.filter((x) => x !== s.id) : [...form.assignedTo, s.id] });
                            }}
                          >
                            {s.name}
                            {selected && <span className="text-primary">✓</span>}
                          </button>
                        );
                      })
                    }
                    {assignableStaff.filter((s: any) => s.name.toLowerCase().includes(staffSearch.toLowerCase())).length === 0 && (
                      <p className="px-3.5 py-2 text-[12px] text-[#b09e8d]">No staff found</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Tags — chips + dropdown */}
            <div className="sm:col-span-2 relative">
              {lbl('Tags')}
              <div
                className="bg-[#faf8f6] border border-black/10 rounded-xl px-3.5 py-2.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 focus-within:bg-white transition-all cursor-text"
                onClick={() => setTagDropOpen(true)}
              >
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {form.tags.map((t) => (
                      <span key={t} className="text-[11px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-md flex items-center gap-1">
                        {t}<button type="button" onClick={(e) => { e.stopPropagation(); setForm({ ...form, tags: form.tags.filter((x) => x !== t) }); }} className="hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  className="w-full text-[13px] outline-none bg-transparent placeholder:text-[#b09e8d]"
                  placeholder={form.tags.length === 0 ? 'Search or type a tag…' : ''}
                  value={form.tagInput}
                  onChange={(e) => { setForm({ ...form, tagInput: e.target.value }); setTagDropOpen(true); }}
                  onFocus={() => setTagDropOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && form.tagInput.trim()) {
                      e.preventDefault();
                      if (!form.tags.includes(form.tagInput.trim())) {
                        setForm({ ...form, tags: [...form.tags, form.tagInput.trim()], tagInput: '' });
                      }
                    }
                  }}
                />
              </div>
              {tagDropOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTagDropOpen(false)} />
                  <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-black/10 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {storeTags
                      .filter((t) => t.name.toLowerCase().includes(form.tagInput.toLowerCase()))
                      .map((t) => {
                        const selected = form.tags.includes(t.name);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={`w-full text-left px-3.5 py-2 text-[13px] flex items-center justify-between hover:bg-gray-50 transition-colors ${selected ? 'text-primary font-semibold' : 'text-[#1c1410]'}`}
                            onClick={() => {
                              setForm({ ...form, tags: selected ? form.tags.filter((x) => x !== t.name) : [...form.tags, t.name], tagInput: '' });
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color || '#ea580c' }} />
                              {t.name}
                            </span>
                            {selected && <span className="text-primary">✓</span>}
                          </button>
                        );
                      })
                    }
                    {form.tagInput.trim() && !storeTags.some((t) => t.name.toLowerCase() === form.tagInput.trim().toLowerCase()) && (
                      <button
                        type="button"
                        className="w-full text-left px-3.5 py-2 text-[13px] text-primary hover:bg-gray-50 transition-colors"
                        onClick={() => { setForm({ ...form, tags: [...form.tags, form.tagInput.trim()], tagInput: '' }); }}
                      >
                        + Create "{form.tagInput.trim()}"
                      </button>
                    )}
                    {storeTags.filter((t) => t.name.toLowerCase().includes(form.tagInput.toLowerCase())).length === 0 && !form.tagInput.trim() && (
                      <p className="px-3.5 py-2 text-[12px] text-[#b09e8d]">No tags available</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-black/5 shrink-0">
          <p className="hidden sm:block text-[11px] text-[#b09e8d]">Created {format(new Date(now), 'dd MMM yyyy, hh:mm aa')}</p>
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={onClose} className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] bg-white border border-black/10 hover:bg-gray-50 active:scale-95 transition-all">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-[13px] font-bold text-white bg-primary hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60">{saving ? 'Saving…' : 'Save Lead'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Panel ──────────────────────────────────────────────────────────────
const DATE_RANGES = ['Today', 'Yesterday', 'This Week', 'Last Week', 'Last 7 Days', 'Last 30 Days', 'This Month', 'Last Month', 'This Year', 'Last Year', 'Custom'];
const LEAD_QUALITIES = ['Hot', 'Warm', 'Cold', 'Unqualified'];
const OPP_VALUES = ['Less than ₹1,000', '₹1,000 - ₹5,000', '₹5,001 - ₹10,000', '₹10,001 - ₹50,000', 'More than ₹50,000', 'Custom'];

const emptyFilters = {
  assignedTo: [] as string[],
  contactType: [] as string[],
  stage: [] as string[],
  tags: [] as string[],
  leadQuality: [] as string[],
  opportunityValue: [] as string[],
  initialCallDate: '',
  createdOn: '',
  createdFrom: '',   // yyyy-MM-dd, used when createdOn === 'Custom'
  createdTo: '',     // yyyy-MM-dd, used when createdOn === 'Custom'
  updatedOn: '',
  calendar: '',
  followUp: '',
};
type FilterState = typeof emptyFilters;

const FILTER_CATS = [
  { key: 'assignedTo',     label: 'Assigned to',       Icon: User },
  { key: 'contactType',    label: 'Lead | Customer',    Icon: FileText },
  { key: 'stage',          label: 'Filter by Stage',    Icon: Layers },
  { key: 'tags',           label: 'Filter by Tag',      Icon: Tag },
  { key: 'leadQuality',    label: 'Lead Quality',       Icon: Star },
  { key: 'opportunityValue', label: 'Opportunity Value', Icon: DollarSign },
  { key: 'initialCallDate', label: 'Initial Call Date', Icon: Calendar },
  { key: 'createdOn',      label: 'Created on',         Icon: Calendar },
  { key: 'updatedOn',      label: 'Updated on',         Icon: Calendar },
  { key: 'calendar',       label: 'Calendar',           Icon: Calendar },
  { key: 'followUp',       label: 'Follow Up',          Icon: Calendar },
];

function FilterPanel({ filters, onChange, onClose, stages }: { filters: FilterState; onChange: (f: FilterState) => void; onClose: () => void; stages: string[] }) {
  const { tags: storeTags, staff } = useCrmStore();
  const [local, setLocal] = useState<FilterState>(filters);
  const [subPanel, setSubPanel] = useState('');
  const [subSearch, setSubSearch] = useState('');

  const apply = () => { onChange(local); onClose(); };
  const clearAll = () => setLocal({ ...emptyFilters });

  const toggleArr = (key: keyof FilterState, val: string) => {
    const arr = local[key] as string[];
    setLocal({ ...local, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] });
  };
  const setRadio = (key: keyof FilterState, val: string) => {
    setLocal({ ...local, [key]: (local[key] as string) === val ? '' : val });
  };

  const hasActive = (key: string) => { const v = (local as any)[key]; return Array.isArray(v) ? v.length > 0 : !!v; };
  const hasSearch = ['assignedTo', 'tags', 'stage'].includes(subPanel);
  const activeCat = FILTER_CATS.find((c) => c.key === subPanel);

  const CheckItem = ({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) => (
    <button onClick={onClick} className={cn('w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors', checked ? 'bg-green-50' : 'hover:bg-gray-50')}>
      <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0', checked ? 'border-primary bg-primary' : 'border-gray-300')}>
        {checked && <Check className="w-2.5 h-2.5 text-white" />}
      </div>
      <span className="text-[14px] text-[#1c1410]">{label}</span>
    </button>
  );

  const RadioItem = ({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) => (
    <button onClick={onClick} className={cn('w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors', selected ? 'bg-green-50' : 'hover:bg-gray-50')}>
      <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0', selected ? 'border-primary' : 'border-gray-300')}>
        {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
      </div>
      <span className="text-[14px] text-[#1c1410]">{label}</span>
    </button>
  );

  const renderSubContent = () => {
    if (subPanel === 'assignedTo') {
      const opts = [{ id: 'none', name: 'Assigned to None' }, ...staff.map((s) => ({ id: s.id, name: s.name }))];
      return opts.filter((o) => o.name.toLowerCase().includes(subSearch.toLowerCase())).map((o) => (
        <CheckItem key={o.id} checked={local.assignedTo.includes(o.id)} label={o.name} onClick={() => toggleArr('assignedTo', o.id)} />
      ));
    }
    if (subPanel === 'contactType') {
      return ['Lead', 'Customer'].map((o) => (
        <CheckItem key={o} checked={local.contactType.includes(o)} label={o} onClick={() => toggleArr('contactType', o)} />
      ));
    }
    if (subPanel === 'stage') {
      return stages.filter((s) => s.toLowerCase().includes(subSearch.toLowerCase())).map((s) => (
        <CheckItem key={s} checked={local.stage.includes(s)} label={s} onClick={() => toggleArr('stage', s)} />
      ));
    }
    if (subPanel === 'tags') {
      const allTags = storeTags.map((t) => t.name);
      return allTags.filter((t) => t.toLowerCase().includes(subSearch.toLowerCase())).map((t) => (
        <CheckItem key={t} checked={local.tags.includes(t)} label={t} onClick={() => toggleArr('tags', t)} />
      ));
    }
    if (subPanel === 'leadQuality') {
      return LEAD_QUALITIES.map((q) => (
        <CheckItem key={q} checked={local.leadQuality.includes(q)} label={q} onClick={() => toggleArr('leadQuality', q)} />
      ));
    }
    if (subPanel === 'opportunityValue') {
      return OPP_VALUES.map((v) => (
        <CheckItem key={v} checked={local.opportunityValue.includes(v)} label={v} onClick={() => toggleArr('opportunityValue', v)} />
      ));
    }
    if (['initialCallDate', 'createdOn', 'updatedOn', 'calendar', 'followUp'].includes(subPanel)) {
      return DATE_RANGES.map((d) => (
        <RadioItem key={d} selected={(local as any)[subPanel] === d} label={d} onClick={() => setRadio(subPanel as keyof FilterState, d)} />
      ));
    }
    return null;
  };

  const BottomBar = () => (
    <div className="flex items-center gap-1.5 px-3 py-3 border-t border-black/5 shrink-0">
      <button onClick={clearAll} className="text-[12px] font-semibold text-red-500 hover:text-red-600 transition-colors shrink-0 mr-1">Clear all</button>
      <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] font-semibold text-[#1c1410] hover:bg-gray-50 transition-colors shrink-0">Cancel</button>
      <button onClick={apply} className="flex-1 py-1.5 rounded-lg text-[12px] font-bold text-white whitespace-nowrap" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 100%)' }}>Apply & Save</button>
      <button onClick={apply} className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%)' }}>Apply</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ backdropFilter: 'blur(3px)', backgroundColor: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className="bg-white w-[340px] h-full flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-black/5 shrink-0">
          <div className="flex items-center gap-3">
            {subPanel && (
              <button onClick={() => { setSubPanel(''); setSubSearch(''); }} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <ArrowLeft className="w-4 h-4 text-[#7a6b5c]" />
              </button>
            )}
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
              <Filter className="w-4 h-4 text-blue-500" />
            </div>
            <span className="font-bold text-[15px] text-[#1c1410]">{subPanel ? activeCat?.label : 'Filters'}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-[#7a6b5c]" />
          </button>
        </div>

        {/* Sub-panel search */}
        {subPanel && hasSearch && (
          <div className="px-4 py-2.5 border-b border-black/5 shrink-0">
            <input
              autoFocus
              className="w-full px-3 py-2 text-[13px] bg-gray-50 border border-gray-100 rounded-lg outline-none focus:border-primary/30 placeholder:text-gray-400"
              placeholder="Search"
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto divide-y divide-black/[0.04]">
          {!subPanel
            ? FILTER_CATS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => { setSubPanel(key); setSubSearch(''); }}
                  className={cn('w-full flex items-center gap-3 px-5 py-4 text-left transition-colors', hasActive(key) ? 'bg-green-50' : 'hover:bg-gray-50')}
                >
                  <Icon className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="flex-1 text-[14px] text-[#1c1410]">{label}</span>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </button>
              ))
            : renderSubContent()
          }
        </div>

        <BottomBar />
      </div>
    </div>
  );
}

// ─── Compact Filter Popover (kept for deep filter) ─────────────────────────────
function FilterPopover({ filters, onChange, onClose, stages, anchorRef, isMobile }: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  onClose: () => void;
  stages: string[];
  anchorRef: React.RefObject<HTMLButtonElement>;
  isMobile?: boolean;
}) {
  const { tags: storeTags, staff } = useCrmStore();
  const [expanded, setExpanded] = useState<string>('assignedTo');
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<FilterState>(filters);

  // Sync draft when parent filters change externally (e.g. chip removal)
  useEffect(() => { setDraft(filters); }, [filters]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, [onClose, anchorRef]);

  const toggleArr = (k: keyof FilterState, v: string) => {
    setDraft((d) => {
      const a = d[k] as string[];
      return { ...d, [k]: a.includes(v) ? a.filter((x) => x !== v) : [...a, v] };
    });
  };
  const setRadio = (k: keyof FilterState, v: string) => {
    setDraft((d) => ({ ...d, [k]: (d[k] as string) === v ? '' : v }));
  };
  const clearAll = () => setDraft({ ...emptyFilters });
  const applyFilters = () => { onChange(draft); onClose(); };
  const total = Object.values(draft).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : v ? 1 : 0), 0);
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(filters);

  const sections: { key: keyof FilterState; label: string; type: 'multi' | 'single'; options: { value: string; label: string }[] }[] = [
    { key: 'assignedTo', label: 'Assignee', type: 'multi', options: [{ value: 'none', label: 'Unassigned' }, ...staff.map((s) => ({ value: s.id, label: s.name }))] },
    { key: 'stage', label: 'Stage', type: 'multi', options: stages.map((s) => ({ value: s, label: s })) },
    { key: 'tags', label: 'Tags', type: 'multi', options: storeTags.map((t) => ({ value: t.name, label: t.name })) },
    { key: 'contactType', label: 'Type', type: 'multi', options: [{ value: 'Lead', label: 'Lead' }, { value: 'Customer', label: 'Customer' }] },
    { key: 'leadQuality', label: 'Lead Quality', type: 'multi', options: LEAD_QUALITIES.map((q) => ({ value: q, label: q })) },
    { key: 'opportunityValue', label: 'Deal Value', type: 'multi', options: OPP_VALUES.map((v) => ({ value: v, label: v })) },
    { key: 'createdOn', label: 'Created', type: 'single', options: DATE_RANGES.map((d) => ({ value: d, label: d })) },
    { key: 'followUp', label: 'Follow-up due', type: 'single', options: DATE_RANGES.map((d) => ({ value: d, label: d })) },
  ];

  const q = search.toLowerCase();
  const matching = sections.map((s) => ({ ...s, options: q ? s.options.filter((o) => o.label.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)) : s.options })).filter((s) => !q || s.options.length > 0);

  const countFor = (key: string) => { const v = (draft as any)[key]; return Array.isArray(v) ? v.length : (v ? 1 : 0); };

  const node = (
    <>
    {isMobile && <div className="fixed inset-0 z-[60] bg-black/40 animate-fade-in" onClick={onClose} />}
    <div
      ref={ref}
      className={cn('bg-white overflow-hidden flex flex-col',
        isMobile
          ? 'fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl animate-slide-up'
          : 'absolute right-0 top-11 z-50 w-[340px] rounded-2xl border border-black/5')}
      style={isMobile ? { maxHeight: '85vh', boxShadow: '0 -8px 30px rgba(0,0,0,0.18)' } : { maxHeight: '70vh', boxShadow: '0 12px 40px rgba(0,0,0,0.14)' }}
    >
      {isMobile && <div className="flex justify-center pt-2 pb-1 shrink-0"><div className="w-10 h-1 rounded-full bg-black/15" /></div>}
      <div className="px-4 py-3 border-b border-black/5 flex items-center gap-2 shrink-0">
        <Filter className="w-4 h-4 text-primary" />
        <h4 className="text-[14px] font-bold text-[#1c1410] flex-1">Filters</h4>
        {total > 0 && (
          <button onClick={clearAll} className="text-[11px] font-semibold text-red-500 hover:underline">Clear all · {total}</button>
        )}
        <button onClick={onClose} className="w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center text-[#7a6b5c]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 py-2 border-b border-black/5 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b09e8d]" />
          <input
            autoFocus={!isMobile}
            className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-[var(--app-bg)] border border-transparent rounded-lg outline-none focus:border-primary/30 focus:bg-white placeholder:text-gray-400"
            placeholder="Search filters..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-black/[0.05]">
        {matching.map((s) => {
          const isOpen = expanded === s.key || !!q;
          const sel = countFor(s.key);
          return (
            <div key={s.key}>
              <button onClick={() => setExpanded(isOpen ? '' : s.key)} className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--app-bg)] transition-colors">
                <span className="flex-1 text-left text-[13px] font-semibold text-[#1c1410]">{s.label}</span>
                {sel > 0 && <span className="text-[10px] font-bold bg-primary/10 text-primary rounded-full px-2 py-0.5">{sel}</span>}
                <ChevronDown className={cn('w-3.5 h-3.5 text-[#b09e8d] transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="px-3 pb-2 pt-0.5 space-y-0.5 max-h-52 overflow-y-auto">
                  {s.options.length === 0 && <p className="text-[11px] text-[#b09e8d] py-2 italic px-2">No options</p>}
                  {s.options.map((o) => {
                    const isOn = s.type === 'multi' ? (draft[s.key] as string[]).includes(o.value) : (draft[s.key] as string) === o.value;
                    return (
                      <button
                        key={o.value}
                        onClick={() => s.type === 'multi' ? toggleArr(s.key, o.value) : setRadio(s.key, o.value)}
                        className={cn('w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors',
                          isOn ? 'bg-[#faf0e8] text-primary' : 'hover:bg-[var(--app-bg)] text-[#1c1410]')}
                      >
                        {s.type === 'multi' ? (
                          <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0', isOn ? 'bg-primary border-primary' : 'border-gray-300')}>
                            {isOn && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                        ) : (
                          <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0', isOn ? 'border-primary' : 'border-gray-300')}>
                            {isOn && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                          </div>
                        )}
                        <span className="text-[12.5px] font-medium flex-1">{o.label}</span>
                      </button>
                    );
                  })}
                  {/* Custom date range picker for the Created filter */}
                  {s.key === 'createdOn' && draft.createdOn === 'Custom' && (
                    <div className="flex items-center gap-1.5 px-2.5 pt-2">
                      <input type="date" value={draft.createdFrom} max={draft.createdTo || undefined}
                        onChange={(e) => setDraft((d) => ({ ...d, createdFrom: e.target.value }))}
                        className="flex-1 min-w-0 h-8 px-2 text-[11px] rounded-lg border border-black/10 bg-white outline-none focus:border-primary/40" title="From date" />
                      <span className="text-[11px] text-[#9a8a7a] shrink-0">→</span>
                      <input type="date" value={draft.createdTo} min={draft.createdFrom || undefined}
                        onChange={(e) => setDraft((d) => ({ ...d, createdTo: e.target.value }))}
                        className="flex-1 min-w-0 h-8 px-2 text-[11px] rounded-lg border border-black/10 bg-white outline-none focus:border-primary/40" title="To date" />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {matching.length === 0 && <p className="text-[12px] text-[#b09e8d] text-center py-6">No filters match "{search}"</p>}
      </div>

      <div className={cn('px-4 border-t border-black/5 shrink-0 flex items-center gap-2',
        isMobile ? 'py-3' : 'py-2.5')}
        style={isMobile ? { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' } : undefined}
      >
        <button onClick={applyFilters}
          className={cn('flex-1 py-2 rounded-xl text-[13px] font-bold transition-colors',
            hasChanges ? 'bg-primary text-white active:scale-95' : 'bg-primary/60 text-white/80')}
        >Apply{total > 0 ? ` (${total})` : ''}</button>
        {total > 0 && (
          <button onClick={clearAll} className="px-3 py-2 rounded-xl text-[12px] font-semibold text-red-500 hover:bg-red-50 transition-colors">Clear</button>
        )}
      </div>
    </div>
    </>
  );
  return isMobile ? createPortal(node, document.body) : node;
}

// ─── Removable Filter Chip ─────────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary/10 text-primary">
      {label}
      <button onClick={onRemove} className="hover:bg-primary/20 rounded-full p-0.5 transition-colors">
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

// ─── Workflow Modal ─────────────────────────────────────────────────────────────
function WorkflowModal({ leadIds, onClose }: { leadIds: string[]; onClose: () => void }) {
  const { workflows } = useCrmStore();
  const activeWorkflows = workflows.filter((w) => (w as any).status === 'active');
  const [selected, setSelected] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!selected) { toast.error('Please select a workflow'); return; }
    const wf = activeWorkflows.find((w) => w.id === selected);
    setSending(true);
    try {
      await api.post(`/api/workflows/${selected}/bulk-trigger`, { lead_ids: leadIds });
      toast.success(`${leadIds.length} contact${leadIds.length !== 1 ? 's' : ''} pushed to "${wf?.name}" - automation is executing`);
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to trigger workflow');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5">
          <h3 className="font-bold text-[17px] text-[#1c1410]">Trigger Workflow</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X className="w-4 h-4 text-[#7a6b5c]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <label className="text-[13px] font-semibold text-[#1c1410] block">Select Active Workflow</label>
          <div className="relative">
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white appearance-none pr-10">
              <option value="">- Choose a workflow -</option>
              {activeWorkflows.map((wf) => <option key={wf.id} value={wf.id}>{wf.name}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
          {activeWorkflows.length === 0 && (
            <p className="text-[12px] text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              No active workflows found. Set a workflow to Active in Automation first.
            </p>
          )}
          <p className="text-[12px] text-blue-500 flex items-start gap-1.5 pt-1">
            <Settings className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {leadIds.length} contact{leadIds.length !== 1 ? 's' : ''} selected - all will be pushed through the chosen workflow.
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5">
          <button onClick={onClose} className="px-6 py-2 rounded-lg bg-gray-200 text-[13px] font-bold text-gray-600 hover:bg-gray-300 transition-colors uppercase tracking-wide">Close</button>
          <button onClick={send} disabled={sending || !selected} className="px-6 py-2 rounded-lg bg-green-500 text-[13px] font-bold text-white hover:bg-green-600 disabled:opacity-50 transition-colors uppercase tracking-wide">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Import Modal ──────────────────────────────────────────────────────────────

type ImportResult = { imported: number; updated: number; skipped: number; errors: Array<{ row: number; reason: string }> };
type CustomField  = { id: string; name: string; slug: string };

function ImportModal({ onClose }: { onClose: () => void }) {
  const { pipelines } = useCrmStore();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [file, setFile]                       = useState<File | null>(null);
  const [pipelineId, setPipelineId]           = useState('');
  const [defaultStageId, setDefaultStageId]   = useState('');
  const [duplicateHandling, setDuplicateHandling] = useState<'skip' | 'update' | 'create'>('skip');
  const [dragOver, setDragOver]               = useState(false);

  // Step 2 state
  const [headers, setHeaders]   = useState<string[]>([]);
  const [allRows, setAllRows]   = useState<string[][]>([]);
  const [mapping, setMapping]   = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // Step 3 state
  const [result, setResult]     = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);
  const stages = (selectedPipeline as any)?.stages ?? [];

  // Load custom fields once
  useEffect(() => {
    api.get<any[]>('/api/fields/custom').then((data) => {
      setCustomFields((data ?? []).filter((f: any) => f.slug).map((f: any) => ({ id: f.id, name: f.name, slug: f.slug })));
    }).catch(() => {});
  }, []);

  // Available CRM mapping options (standard + custom)
  const crmOptions = useMemo(() => [
    { key: 'name',       label: 'Full Name',   group: 'Standard' },
    { key: 'first_name', label: 'First Name',  group: 'Standard' },
    { key: 'last_name',  label: 'Last Name',   group: 'Standard' },
    { key: 'phone',      label: 'Phone',       group: 'Standard' },
    { key: 'email',      label: 'Email',       group: 'Standard' },
    { key: 'source',     label: 'Source',      group: 'Standard' },
    { key: 'deal_value', label: 'Deal Value',  group: 'Standard' },
    { key: 'tags',       label: 'Tags',        group: 'Standard' },
    { key: 'notes',      label: 'Notes',       group: 'Standard' },
    { key: 'stage',      label: 'Stage',       group: 'Standard' },
    ...customFields.map((cf) => ({ key: `custom:${cf.slug}`, label: `${cf.name}`, group: 'Custom Field' })),
    { key: 'skip',       label: '-- Skip --',  group: 'Skip' },
  ], [customFields]);

  // Auto-map a single header string to a CRM field key
  const autoMap = useCallback((h: string): string => {
    const lo = h.toLowerCase().trim().replace(/\s+/g, '_');
    if (/^(full_?)?name$/.test(lo)) return 'name';
    if (/first_?name|^first$/.test(lo)) return 'first_name';
    if (/last_?name|^last$/.test(lo)) return 'last_name';
    if (/phone|mobile|mob|cell/.test(lo)) return 'phone';
    if (/email|mail/.test(lo)) return 'email';
    if (/source|channel|medium/.test(lo)) return 'source';
    if (/deal|value|budget|amount/.test(lo)) return 'deal_value';
    if (/tag|label/.test(lo)) return 'tags';
    if (/note|comment|remark/.test(lo)) return 'notes';
    if (/stage/.test(lo)) return 'stage';
    for (const cf of customFields) {
      if (lo === cf.slug || lo === cf.name.toLowerCase().replace(/\s+/g, '_') || lo === cf.name.toLowerCase()) {
        return `custom:${cf.slug}`;
      }
    }
    return 'skip';
  }, [customFields]);

  // Parse file using xlsx (handles both CSV and Excel)
  const parseFile = useCallback((f: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        const wb = f.name.endsWith('.csv')
          ? XLSX.read(data as string, { type: 'string' })
          : XLSX.read(new Uint8Array(data as ArrayBuffer), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (!jsonData.length) { toast.error('File appears empty'); return; }
        const hdrs = (jsonData[0] as any[]).map((h) => String(h ?? '').trim()).filter(Boolean);
        const rows = (jsonData.slice(1) as any[][])
          .filter((r) => r.some((c) => c !== '' && c != null))
          .map((r) => hdrs.map((_, i) => String(r[i] ?? '').trim()));
        setHeaders(hdrs);
        setAllRows(rows);
        const m: Record<string, string> = {};
        hdrs.forEach((h) => { m[h] = autoMap(h); });
        setMapping(m);
      } catch {
        toast.error('Could not parse file. Please check the format.');
      }
    };
    if (f.name.endsWith('.csv')) reader.readAsText(f);
    else reader.readAsArrayBuffer(f);
  }, [autoMap]);

  const handleFilePick = (f: File) => {
    if (f.size > 10 * 1024 * 1024) { toast.error('File size exceeds 10 MB'); return; }
    if (!f.name.match(/\.(csv|xlsx|xls)$/i)) { toast.error('Please upload a CSV or Excel file'); return; }
    setFile(f);
    parseFile(f);
  };

  const downloadTemplate = () => {
    downloadBlob('/api/leads/import-template', 'leads_import_template.xlsx');
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const rows = allRows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          const key = mapping[h];
          if (!key || key === 'skip') return;
          obj[key] = row[i] ?? '';
        });
        if ((obj.first_name || obj.last_name) && !obj.name) {
          obj.name = `${obj.first_name ?? ''} ${obj.last_name ?? ''}`.trim();
          delete obj.first_name;
          delete obj.last_name;
        }
        return obj;
      });
      const res = await api.post<ImportResult>('/api/leads/import', {
        rows,
        pipeline_id: pipelineId || null,
        stage_id: defaultStageId || null,
        duplicate_handling: duplicateHandling,
      });
      setResult(res);
      setStep(3);
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  const previewRows = allRows.slice(0, 3);
  const btnStyle = { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-[15px] text-[#1c1410]">Import Leads</h3>
            <div className="flex items-center gap-1.5">
              {(['Upload', 'Map Columns', 'Result'] as const).map((label, i) => (
                <div key={label} className="flex items-center gap-1.5">
                  {i > 0 && <div className="w-6 h-px bg-gray-200" />}
                  <span className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-full',
                    step === i + 1 ? 'bg-primary/10 text-primary' : step > i + 1 ? 'text-green-600 bg-green-50' : 'text-gray-400'
                  )}>{step > i + 1 ? '✓ ' : ''}{label}</span>
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X className="w-4 h-4 text-[#7a6b5c]" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── STEP 1: Upload ── */}
          {step === 1 && (
            <div className="space-y-5">
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFilePick(f); }}
                className={cn('border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer',
                  dragOver ? 'border-primary bg-primary/5' : file ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-primary/40 hover:bg-gray-50'
                )}
                onClick={() => document.getElementById('import-file-input')?.click()}
              >
                <input id="import-file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }} />
                {file ? (
                  <>
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2"><Check className="w-5 h-5 text-green-600" /></div>
                    <p className="font-semibold text-[14px] text-green-700">{file.name}</p>
                    <p className="text-[12px] text-gray-400 mt-1">{allRows.length} rows detected - click to change</p>
                  </>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2"><Download className="w-5 h-5 text-gray-400" /></div>
                    <p className="font-semibold text-[14px] text-[#1c1410]">Drag & drop your file here</p>
                    <p className="text-[12px] text-gray-400 mt-1">or click to browse - CSV or Excel (.xlsx) - max 10 MB</p>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Pipeline */}
                <div>
                  <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Import into Pipeline</label>
                  <select value={pipelineId} onChange={(e) => { setPipelineId(e.target.value); setDefaultStageId(''); }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40 bg-white">
                    <option value="">No Pipeline</option>
                    {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {/* Default Stage */}
                <div>
                  <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Default Stage</label>
                  <select value={defaultStageId} onChange={(e) => setDefaultStageId(e.target.value)}
                    disabled={!pipelineId}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-primary/40 bg-white disabled:opacity-40">
                    <option value="">First Stage</option>
                    {stages.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Duplicate handling */}
              <div>
                <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">If duplicate found (same phone or email)</label>
                <div className="grid grid-cols-3 gap-2">
                  {([['skip','Skip duplicate'],['update','Update existing'],['create','Always create']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setDuplicateHandling(val)}
                      className={cn('py-2.5 px-3 rounded-xl border text-[12px] font-semibold transition-all',
                        duplicateHandling === val ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-[#7a6b5c] hover:border-gray-300'
                      )}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Download template */}
              <button onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-primary/20 text-[13px] font-semibold text-primary hover:bg-primary/5 transition-colors">
                <Download className="w-4 h-4" /> Download Template (with your custom fields)
              </button>
            </div>
          )}

          {/* ── STEP 2: Map Columns ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-[#7a6b5c]">Map each CSV column to a CRM field. Custom fields are included.</p>
                <span className="text-[12px] font-semibold text-primary bg-primary/5 px-2.5 py-1 rounded-full">{allRows.length} rows</span>
              </div>

              {/* Mapping table */}
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="grid grid-cols-3 gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">CSV Column</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Maps to</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Sample Value</span>
                </div>
                <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                  {headers.map((h, hi) => (
                    <div key={h} className="grid grid-cols-3 gap-3 px-4 py-2.5 items-center hover:bg-gray-50/50">
                      <span className="text-[13px] text-[#1c1410] font-medium truncate">{h}</span>
                      <select value={mapping[h] ?? 'skip'}
                        onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                        className={cn('border rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-primary/40',
                          mapping[h] && mapping[h] !== 'skip' ? 'border-primary/30 bg-primary/5 text-primary font-semibold' : 'border-gray-200 text-[#7a6b5c]'
                        )}>
                        <optgroup label="── Standard ──">
                          {crmOptions.filter(o => o.group === 'Standard').map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </optgroup>
                        {customFields.length > 0 && (
                          <optgroup label="── Custom Fields ──">
                            {crmOptions.filter(o => o.group === 'Custom Field').map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="──────────">
                          <option value="skip">-- Skip --</option>
                        </optgroup>
                      </select>
                      <span className="text-[12px] text-gray-400 truncate">{previewRows[0]?.[hi] ?? '-'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {previewRows.length > 0 && (
                <div>
                  <p className="text-[12px] font-semibold text-[#7a6b5c] mb-2">Preview - first {previewRows.length} rows</p>
                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-50">
                        <tr>{headers.filter((h) => mapping[h] !== 'skip').map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-bold text-[#7a6b5c] whitespace-nowrap">
                            {crmOptions.find(o => o.key === mapping[h])?.label ?? h}
                          </th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {previewRows.map((row, ri) => (
                          <tr key={ri} className="hover:bg-gray-50">
                            {headers.map((h, hi) => mapping[h] !== 'skip' && (
                              <td key={h} className="px-3 py-2 text-[#1c1410] max-w-[140px] truncate">{row[hi]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Result ── */}
          {step === 3 && result && (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="font-extrabold text-[20px] text-[#1c1410]">Import Complete!</h3>
              <div className="flex gap-6 mt-1">
                <div className="text-center px-5 py-4 bg-green-50 rounded-2xl">
                  <p className="text-[28px] font-extrabold text-green-600">{result.imported}</p>
                  <p className="text-[12px] text-green-700 font-semibold">Imported</p>
                </div>
                {result.updated > 0 && (
                  <div className="text-center px-5 py-4 bg-blue-50 rounded-2xl">
                    <p className="text-[28px] font-extrabold text-blue-600">{result.updated}</p>
                    <p className="text-[12px] text-blue-700 font-semibold">Updated</p>
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="text-center px-5 py-4 bg-amber-50 rounded-2xl">
                    <p className="text-[28px] font-extrabold text-amber-600">{result.skipped}</p>
                    <p className="text-[12px] text-amber-700 font-semibold">Skipped</p>
                  </div>
                )}
                {result.errors.length > 0 && (
                  <div className="text-center px-5 py-4 bg-red-50 rounded-2xl">
                    <p className="text-[28px] font-extrabold text-red-500">{result.errors.length}</p>
                    <p className="text-[12px] text-red-600 font-semibold">Errors</p>
                  </div>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="w-full max-h-36 overflow-y-auto text-[11px] text-red-600 space-y-1 border border-red-100 rounded-xl p-3 bg-red-50">
                  {result.errors.map((e) => <div key={e.row}>Row {e.row}: {e.reason}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-black/5 shrink-0">
          <div>
            {step === 2 && (
              <p className="text-[12px] text-gray-400">
                {headers.filter(h => mapping[h] && mapping[h] !== 'skip').length} of {headers.length} columns mapped
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button onClick={() => setStep(1)} className="px-5 py-2 rounded-xl border border-gray-200 text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-50 transition-colors">Back</button>
            )}
            {step === 1 && (
              <button onClick={() => { if (!file) { toast.error('Please upload a file first'); return; } setStep(2); }}
                className="px-6 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5" style={btnStyle}>
                Next: Map Columns →
              </button>
            )}
            {step === 2 && (
              <button onClick={doImport} disabled={importing}
                className="px-6 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60" style={btnStyle}>
                {importing ? 'Importing…' : `Import ${allRows.length} Leads →`}
              </button>
            )}
            {step === 3 && (
              <button onClick={onClose} className="px-6 py-2.5 rounded-xl text-[13px] font-bold text-white" style={btnStyle}>Done</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Note Modal ────────────────────────────────────────────────────────────────
function NoteModal({ leadId, onClose, onCreated }: { leadId: string; onClose: () => void; onCreated?: (note: any) => void }) {
  const { addNote } = useCrmStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const inputCls = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 placeholder:text-gray-300';
  const submit = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!content.trim()) { toast.error('Note content is required'); return; }
    setSaving(true);
    try {
      const created = await api.post<any>(`/api/leads/${leadId}/notes`, { title: title.trim(), content: content.trim() });
      addNote({ id: created.id, leadId, content: `[${title.trim()}] ${content.trim()}`, createdBy: currentUser?.id ?? '', createdAt: created.created_at ?? new Date().toISOString() });
      onCreated?.(created);
      toast.success('Note added');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h3 className="font-headline font-bold text-[#1c1410] text-[17px]">Add Note</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Title <span className="text-red-400">*</span></label>
            <input className={inputCls} placeholder="e.g. Follow-up call" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Description <span className="text-red-400">*</span></label>
            <textarea className={inputCls + ' resize-none min-h-[100px]'} placeholder="Write your note..." value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5">
          <button onClick={onClose} className="px-5 py-2 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-6 py-2 rounded-xl text-[13px] font-bold text-white hover:-translate-y-0.5 transition-all disabled:opacity-60" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}>{saving ? 'Saving…' : 'Save Note'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Follow-Up Modal ───────────────────────────────────────────────────────────
function FollowUpModal({ leadId, onClose, onCreated, onNoteCreated, editItem, onUpdated }: {
  leadId: string; onClose: () => void; onCreated?: (fu: any) => void; onNoteCreated?: (note: any) => void;
  editItem?: { kind: 'note' | 'followup'; id: string; title?: string; notes?: string; dueAt?: string };
  onUpdated?: (item: any) => void;
}) {
  const { addFollowUp } = useCrmStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const isEdit = !!editItem;
  const [isNote, setIsNote] = useState(editItem?.kind === 'note');
  const [title, setTitle] = useState(editItem?.title ?? '');
  const [notes, setNotes] = useState(editItem?.notes ?? '');
  const [dueAt, setDueAt] = useState(editItem?.dueAt ?? '');
  const [saving, setSaving] = useState(false);
  const inputCls = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 placeholder:text-gray-300';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // ── EDIT existing note / follow-up (PATCH) ──
    if (isEdit && editItem) {
      if (editItem.kind === 'note') {
        const content = notes.trim() || title.trim();
        if (!content) { toast.error('Note content is required'); return; }
        setSaving(true);
        try {
          await api.patch(`/api/leads/${leadId}/notes/${editItem.id}`, { title: title.trim() || undefined, content });
          onUpdated?.({ id: editItem.id, title: title.trim(), content });
          toast.success('Note updated'); onClose();
        } catch (err: any) { toast.error(err.message ?? 'Failed to update note'); } finally { setSaving(false); }
        return;
      }
      if (!title.trim()) { toast.error('Title is required'); return; }
      setSaving(true);
      try {
        const due = dueAt ? new Date(dueAt).toISOString() : undefined;
        await api.patch(`/api/leads/${leadId}/followups/${editItem.id}`, { title: title.trim(), description: notes.trim(), due_at: due });
        onUpdated?.({ id: editItem.id, title: title.trim(), description: notes.trim(), dueAt: due });
        toast.success('Follow-up updated'); onClose();
      } catch (err: any) { toast.error(err.message ?? 'Failed to update follow-up'); } finally { setSaving(false); }
      return;
    }
    if (isNote) {
      const content = notes.trim() || title.trim();
      if (!content) { toast.error('Note content is required'); return; }
      setSaving(true);
      try {
        const created = await api.post<any>(`/api/leads/${leadId}/notes`, {
          title: title.trim() || undefined,
          content,
        });
        onNoteCreated?.({ ...created, created_by_name: currentUser?.name ?? '' });
        toast.success('Note added');
        onClose();
      } catch (err: any) {
        toast.error(err.message ?? 'Failed to add note');
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const created = await api.post<any>(`/api/leads/${leadId}/followups`, {
        title: title.trim(),
        description: notes.trim() || undefined,
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
        assigned_to: currentUser?.id,
      });
      const fu = {
        id: created.id, leadId,
        dueAt: created.due_at,
        note: title.trim(),
        completed: false,
        assignedTo: currentUser?.id ?? '',
        createdAt: created.created_at ?? new Date().toISOString(),
      };
      addFollowUp(fu);
      onCreated?.(fu);
      toast.success('Follow-up scheduled');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to schedule follow-up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h3 className="font-headline font-bold text-[#1c1410] text-[17px]">{isEdit ? (isNote ? 'Edit Note' : 'Edit Follow-Up') : (isNote ? 'Add Note' : 'Set Follow-Up')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {/* Note toggle — hidden in edit mode (can't convert a note↔follow-up) */}
          {!isEdit && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={isNote}
                onChange={(e) => setIsNote(e.target.checked)}
                className="w-4 h-4 rounded accent-primary cursor-pointer"
              />
              <span className="text-[13px] font-medium text-[#6b4f30]">Save as note instead of follow-up</span>
            </label>
          )}

          <div>
            <label className="text-[12px] font-semibold text-[#1c1410] mb-1.5 block">
              Title {!isNote && <span className="text-red-400">*</span>}
            </label>
            <input className={inputCls} placeholder="e.g. Call back for pre-sales pitch" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#1c1410] mb-1.5 block">
              {isNote ? <>Note Content <span className="text-red-400">*</span></> : 'Notes'}
            </label>
            <textarea className={inputCls + ' resize-none h-20'} placeholder={isNote ? 'Write your note...' : 'Add any notes...'} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {!isNote && (
            <div>
              <label className="text-[12px] font-semibold text-[#1c1410] mb-1.5 block">Due Date & Time</label>
              <input type="datetime-local" className={inputCls} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
          )}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-6 py-2 rounded-xl text-[13px] font-bold text-white hover:-translate-y-0.5 transition-all disabled:opacity-60" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : isNote ? 'Save Note' : 'Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Assign Modal ──────────────────────────────────────────────────────────────
function AssignModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { updateLead, staff } = useCrmStore();
  const [selected, setSelected] = useState(lead.assignedTo);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/leads/${lead.id}`, { assigned_to: selected || null });
      const name = staff.find((s) => s.id === selected)?.name ?? '';
      updateLead(lead.id, { assignedTo: selected, assignedName: name });
      toast.success(name ? `Lead assigned to ${name}` : 'Lead unassigned');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to assign lead');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-black/5">
          <h3 className="font-semibold">Assign Lead</h3><button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="p-4 space-y-2">
          {staff.filter((s) => s.status === 'active').map((s) => (
            <button key={s.id} onClick={() => setSelected(s.id)} className={cn('w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left', selected === s.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-[var(--accent-tint)]')}>
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">{s.avatar}</div>
              <div><p className="text-sm font-medium">{s.name}</p><p className="text-[11px] text-[#7a6b5c] capitalize">{s.role}</p></div>
              {selected === s.id && <Check className="w-4 h-4 text-primary ml-auto" />}
            </button>
          ))}
          <div className="flex gap-2 pt-2"><Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button><Button className="flex-1" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Assign'}</Button></div>
        </div>
      </div>
    </div>
  );
}

// ─── Opportunity Modal ─────────────────────────────────────────────────────────
function OpportunityModal({ leadId, onClose, onCreated }: { leadId: string; onClose: () => void; onCreated?: (opp: any) => void }) {
  const { addOpportunity } = useCrmStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [form, setForm] = useState({ title: '', value: '', probability: '50', expectedCloseDate: '' });
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.value) { toast.error('Title and value are required'); return; }
    setSaving(true);
    try {
      const created = await api.post<any>('/api/opportunities', {
        lead_id: leadId,
        title: form.title,
        value: Number(form.value),
        probability: Number(form.probability),
        expected_close_date: form.expectedCloseDate || undefined,
        assigned_to: currentUser?.id,
      });
      addOpportunity({ id: created.id, leadId, title: form.title, value: Number(form.value), status: 'open', probability: Number(form.probability), expectedCloseDate: form.expectedCloseDate, assignedTo: currentUser?.id ?? '', createdAt: created.created_at ?? new Date().toISOString() });
      toast.success('Opportunity created');
      onCreated?.(created);
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to create opportunity');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-black/5">
          <h3 className="font-semibold">Create Opportunity</h3><button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Title *</label><Input placeholder="e.g. Enterprise License" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Deal Value (₹) *</label><Input type="number" placeholder="250000" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Win Probability (%)</label><Input type="number" min="0" max="100" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} /></div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Expected Close Date</label><Input type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} /></div>
          <div className="flex gap-2"><Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button></div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Lead Modal ─────────────────────────────────────────────────────────
function DeleteLeadModal({ lead, onClose, onDeleted }: { lead: Lead; onClose: () => void; onDeleted: () => void }) {
  const { updateLead } = useCrmStore();

  const handleConfirm = async () => {
    await api.patch(`/api/leads/${lead.id}`, { pipeline_id: null, stage_id: null });
    updateLead(lead.id, { pipeline: '', stage: '', stageId: '', pipelineId: '' } as any);
    toast.success('Removed from pipeline - contact data preserved');
    onDeleted();
  };

  return (
    <ConfirmModal
      title="Remove from Pipeline?"
      message={<><span className="font-semibold text-[#1c1410]">{lead.firstName} {lead.lastName}</span> will be removed from the pipeline. Their contact data, notes, and history will be kept.</>}
      confirmLabel="Yes, Remove"
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}

// ─── Edit Lead Modal ───────────────────────────────────────────────────────────
function EditLeadModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { updateLead, deleteLead, moveLeadStage, pipelines, calendarEvents, addNote, updateNote, deleteNote, addFollowUp, addCalendarEvent, bookingLinks } = useCrmStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  type Tab = 'opportunity' | 'additional' | 'followup' | 'notes' | 'appointments';
  const [activeTab, setActiveTab] = useState<Tab>('opportunity');
  const [noteContent, setNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');

  const [form, setForm] = useState({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    stage: lead.stage,
    pipelineId: lead.pipelineId,
    source: lead.source,
    dealValue: lead.dealValue,
    tags: [...lead.tags],
    tagInput: '',
    city: '',
    // Additional Info
    businessName: '', gstNo: '', businessAddress: '', state: '', postalCode: '', pincode: '',
    // Follow-up
    fuTitle: '', fuDesc: '', fuDue: '',
    // Notes
    noteTitle: '', noteTag: '',
    // Appointments
    apptEvent: '', apptLocation: '', apptLink: '', apptDate: '', apptTz: 'Asia/Kolkata', apptSlot: '',
  });

  const [leadNotes, setLeadNotes] = useState<any[]>([]);
  const [leadFollowUps, setLeadFollowUps] = useState<any[]>([]);
  const [editFu, setEditFu] = useState<{ id: string; title: string; notes: string; dueAt: string } | null>(null);
  useEffect(() => {
    api.get<any[]>(`/api/leads/${lead.id}/notes`).then(setLeadNotes).catch(() => null);
    api.get<any[]>(`/api/leads/${lead.id}/followups`).then((data) =>
      setLeadFollowUps(data.map((f) => ({ id: f.id, leadId: lead.id, dueAt: f.due_at, note: f.title, description: f.description, completed: f.completed, assignedTo: f.assigned_to, createdAt: f.created_at })))
    ).catch(() => null);
  }, [lead.id]);
  const leadEvents = calendarEvents?.filter((e) => e.leadName === `${lead.firstName} ${lead.lastName}`) ?? [];

  const handleUpdate = async () => {
    try {
      const pipeline = pipelines.find((p) => p.id === form.pipelineId);
      const stageId = pipeline?.stages.find((s) => s.name === form.stage)?.id;
      await api.patch(`/api/leads/${lead.id}`, {
        name: `${form.firstName} ${form.lastName}`.trim(),
        email: form.email,
        phone: form.phone,
        source: form.source,
        pipeline_id: form.pipelineId || undefined,
        stage_id: stageId || undefined,
        tags: form.tags,
      });
      updateLead(lead.id, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        stage: form.stage,
        pipelineId: form.pipelineId,
        source: form.source,
        dealValue: Number(form.dealValue),
        tags: form.tags,
      });
      if (form.stage !== lead.stage) moveLeadStage(lead.id, form.stage);
      toast.success('Lead updated');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update lead');
    }
  };


  const addTag = () => {
    const t = form.tagInput.trim();
    if (t && !form.tags.includes(t)) setForm({ ...form, tags: [...form.tags, t], tagInput: '' });
    else setForm({ ...form, tagInput: '' });
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'opportunity', label: 'Opportunity' },
    { key: 'additional', label: 'Additional Info' },
    { key: 'followup', label: 'Follow-up' },
  ];

  const field = (label: string, child: React.ReactNode, required = false) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] text-[#7a6b5c]">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {child}
    </div>
  );

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] text-[#1c1410] bg-white outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300 transition-all placeholder:text-gray-300';
  const readonlyCls = 'w-full border border-gray-100 rounded-lg px-3 py-2.5 text-[13px] text-gray-400 bg-gray-50 outline-none cursor-not-allowed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[88vh]" style={{ boxShadow: '0 25px 80px rgba(0,0,0,0.18)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-[11px] text-gray-400 mb-0.5">+ Add opportunity</p>
            <h3 className="text-[15px] font-bold text-[#1c1410]">
              Contact Info (Edit) <span className="font-normal text-gray-400 mx-1">|</span> Contact Type: <span className="text-primary">Lead</span>
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-100 overflow-x-auto scrollbar-hide">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-all',
                activeTab === t.key
                  ? 'bg-[#1c1410] text-white'
                  : 'text-gray-500 bg-gray-100 hover:bg-gray-200 hover:text-[#1c1410]'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-white">

          {activeTab === 'opportunity' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              {field('Opportunity Name', <input className={inputCls} value={`${form.firstName} ${form.lastName}`} onChange={(e) => { const [f, ...l] = e.target.value.split(' '); setForm({ ...form, firstName: f, lastName: l.join(' ') }); }} />, true)}
              {field('Contact Name', <input className={readonlyCls} value={`${form.firstName} ${form.lastName}`} readOnly />, true)}
              {field('Email', <input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />)}
              {field('Phone', <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />)}
              {field('City', <input className={inputCls} placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />)}
              {field('Pipeline', (
                <select className={inputCls} value={form.pipelineId} onChange={(e) => {
                  const newPipeline = pipelines.find((p) => p.id === e.target.value);
                  const firstStage = newPipeline?.stages[0]?.name ?? '';
                  setForm({ ...form, pipelineId: e.target.value, stage: firstStage });
                }}>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ), true)}
              {field('Stage', (
                <select className={inputCls} value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                  {(pipelines.find((p) => p.id === form.pipelineId)?.stages ?? []).map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              ), true)}
              {field('Created At', <input className={readonlyCls} type="datetime-local" defaultValue={format(new Date(lead.createdAt), "yyyy-MM-dd'T'HH:mm")} readOnly />)}
              {field('Updated At', <input className={readonlyCls} type="datetime-local" defaultValue={format(new Date(lead.lastActivity), "yyyy-MM-dd'T'HH:mm")} readOnly />)}
              {field('Tags', (
                <div className="border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus-within:border-gray-400 focus-within:ring-1 focus-within:ring-gray-300 transition-all">
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {form.tags.map((tag) => (
                      <span key={tag} className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-md flex items-center gap-1 font-medium">
                        {tag}
                        <button onClick={() => setForm({ ...form, tags: form.tags.filter((t) => t !== tag) })} className="hover:text-red-500 ml-0.5 leading-none">×</button>
                      </span>
                    ))}
                  </div>
                  <input
                    className="w-full text-[13px] text-[#1c1410] outline-none bg-transparent placeholder:text-gray-300"
                    placeholder="Type & press Enter to add tags"
                    value={form.tagInput}
                    onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  />
                </div>
              ))}
              {field('Type', (
                <select className={inputCls}>
                  <option>Lead</option>
                  <option>Contact</option>
                </select>
              ))}
              {field('Lead Value', <input className={inputCls} type="number" value={form.dealValue} onChange={(e) => setForm({ ...form, dealValue: Number(e.target.value) })} />)}
            </div>
          )}

          {/* ── Additional Info ── */}
          {activeTab === 'additional' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                {field('First Name', <input className={inputCls} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />, true)}
                {field('Last Name', <input className={inputCls} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />)}
                {field('Email', <input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />, true)}
                {field('Phone', <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />, true)}
                {field('Contact Type', (
                  <select className={inputCls}>
                    <option>Lead</option>
                    <option>Contact</option>
                    <option>Customer</option>
                  </select>
                ))}
                {field('Business Name', <input className={inputCls} placeholder="Business name" value={form.businessName ?? ''} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />)}
                {field('GST No', <input className={inputCls} placeholder="GST number" value={form.gstNo ?? ''} onChange={(e) => setForm({ ...form, gstNo: e.target.value })} />)}
                {field('State', <input className={inputCls} placeholder="State" value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} />)}
              </div>
              {field('Business Address', <input className={inputCls} placeholder="Business address" value={form.businessAddress ?? ''} onChange={(e) => setForm({ ...form, businessAddress: e.target.value })} />)}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                {field('Postal Code', <input className={inputCls} placeholder="Postal code" value={form.postalCode ?? ''} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />)}
                {field('Pincode', <input className={inputCls} placeholder="Pincode" value={form.pincode ?? ''} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />)}
              </div>
            </div>
          )}

          {/* ── Follow-up ── */}
          {activeTab === 'followup' && (
            <div className="flex gap-8">
              {/* Left: add form */}
              <div className="w-64 shrink-0 space-y-4 bg-gray-50 rounded-xl p-5 border border-gray-100 self-start">
                <p className="text-[13px] font-bold text-[#1c1410] mb-1">Add Follow-Up</p>
                <div>
                  <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Title <span className="text-red-400">*</span></label>
                  <input className={inputCls} placeholder="Enter follow-up title" value={form.fuTitle ?? ''} onChange={(e) => setForm({ ...form, fuTitle: e.target.value })} />
                </div>
                <div>
                  <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Notes</label>
                  <textarea className={inputCls + ' resize-none h-20'} placeholder="Add any notes..." value={form.fuDesc ?? ''} onChange={(e) => setForm({ ...form, fuDesc: e.target.value })} />
                </div>
                <div>
                  <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Due Date <span className="text-red-400">*</span></label>
                  <input className={inputCls} type="datetime-local" value={form.fuDue ?? ''} onChange={(e) => setForm({ ...form, fuDue: e.target.value })} />
                </div>
                <button
                  onClick={async () => {
                    if (!form.fuTitle?.trim() || !form.fuDue) { toast.error('Title and due date required'); return; }
                    try {
                      const created = await api.post<any>(`/api/leads/${lead.id}/followups`, {
                        title: form.fuTitle.trim(),
                        description: form.fuDesc?.trim() || undefined,
                        due_at: new Date(form.fuDue).toISOString(),
                        assigned_to: currentUser?.id,
                      });
                      const fu = { id: created.id, leadId: lead.id, dueAt: created.due_at, note: form.fuTitle.trim(), completed: false, assignedTo: currentUser?.id ?? '', createdAt: created.created_at };
                      addFollowUp(fu);
                      setLeadFollowUps((prev) => [...prev, fu]);
                      toast.success('Follow-up added');
                      setForm({ ...form, fuTitle: '', fuDesc: '', fuDue: '' });
                    } catch (err: any) { toast.error(err.message ?? 'Failed to add follow-up'); }
                  }}
                  className="w-full py-2 rounded-xl text-white text-[13px] font-bold transition-all hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
                >ADD</button>
              </div>

              {/* Right: existing list */}
              <div className="flex-1 min-w-0">
                <h4 className="font-headline font-bold text-[#1c1410] text-[15px] mb-3">Follow-up Tasks</h4>
                {leadFollowUps.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-10 h-10 rounded-2xl bg-[#faf0e8] flex items-center justify-center mb-2">
                      <CheckSquare className="w-5 h-5 text-primary" />
                    </div>
                    <p className="text-[13px] text-[#7a6b5c]">No follow-ups yet.</p>
                  </div>
                )}
                <div className="space-y-2">
                  {leadFollowUps.map((f) => {
                    const isOverdue = !f.completed && isPast(new Date(f.dueAt));
                    const isDone = f.completed;
                    const isPending = !f.completed && !isOverdue;

                    const cardCls = isDone
                      ? 'bg-emerald-50 border-emerald-200'
                      : isOverdue
                      ? 'bg-red-50 border-red-200'
                      : 'bg-amber-50 border-amber-200';

                    const dotCls = isDone ? 'bg-emerald-500' : isOverdue ? 'bg-red-500' : 'bg-amber-400';

                    const badge = isDone
                      ? { label: 'Done', cls: 'bg-emerald-100 text-emerald-700' }
                      : isOverdue
                      ? { label: 'Overdue', cls: 'bg-red-100 text-red-600' }
                      : { label: 'Pending', cls: 'bg-amber-100 text-amber-700' };

                    return (
                      <div key={f.id} className={cn('p-3 rounded-xl border', cardCls)}>
                        <div className="flex items-start gap-2">
                          <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', dotCls)} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[13px] font-semibold text-[#1c1410] truncate">{f.note || 'Follow-up'}</p>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', badge.cls)}>{badge.label}</span>
                                <button onClick={() => setEditFu({ id: f.id, title: f.note || '', notes: f.description || '', dueAt: format(new Date(f.dueAt), "yyyy-MM-dd'T'HH:mm") })}
                                  className="p-1 rounded text-[#7a6b5c] hover:bg-white hover:text-primary" title="Edit follow-up"><Pencil className="w-3.5 h-3.5" /></button>
                              </div>
                            </div>
                            <p className="text-[11px] text-[#7a6b5c] mt-0.5">Due: {format(new Date(f.dueAt), 'dd MMM yyyy, h:mm a')}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Edit Follow-up — reuses the same modal as Add */}
          {editFu && (
            <FollowUpModal
              leadId={lead.id}
              editItem={{ kind: 'followup', id: editFu.id, title: editFu.title, notes: editFu.notes, dueAt: editFu.dueAt }}
              onUpdated={(u) => setLeadFollowUps((prev) => prev.map((f) => f.id === u.id ? { ...f, note: u.title, description: u.description, dueAt: u.dueAt } : f))}
              onClose={() => setEditFu(null)}
            />
          )}


          {/* ── Appointments ── */}
          {activeTab === 'appointments' && (() => {
            const apptET = bookingLinks.find((b) => b.id === (form.apptEvent ?? '')) as any | undefined;
            const apptSlots = apptET && form.apptDate ? genSlots(apptET.schedule ?? {}, form.apptDate, apptET.duration ?? 30) : [];
            return (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <div className="sm:col-span-2">
                  <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Calendar Event <span className="text-red-400">*</span></label>
                  <select className={inputCls} value={form.apptEvent ?? ''} onChange={(e) => {
                    const et = bookingLinks.find((b) => b.id === e.target.value) as any | undefined;
                    setForm({ ...form, apptEvent: e.target.value, apptLink: et?.meetingLink ?? '', apptSlot: '' });
                  }}>
                    <option value="">Select Event</option>
                    {bookingLinks.filter((b) => (b as any).isActive !== false).map((b) => (
                      <option key={b.id} value={b.id}>{(b as any).name ?? b.title}</option>
                    ))}
                  </select>
                </div>

                {form.apptEvent && (<>
                  <div>
                    <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Meeting Type</label>
                    <input className="w-full border border-gray-100 rounded-lg px-3 py-2 text-[13px] text-[#7a6b5c] bg-gray-50 outline-none" value={apptET?.meetingType || '-'} readOnly />
                  </div>
                  <div>
                    <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Meeting Link / Address</label>
                    <input className={inputCls} placeholder="Meeting link or address" value={form.apptLink ?? ''} onChange={(e) => setForm({ ...form, apptLink: e.target.value })} />
                  </div>
                </>)}

                <div>
                  <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Event Date <span className="text-red-400">*</span></label>
                  <input className={inputCls} type="date" value={form.apptDate ?? ''} onChange={(e) => setForm({ ...form, apptDate: e.target.value, apptSlot: '' })} />
                </div>

                <div>
                  <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Timezone</label>
                  <select className={inputCls} value={form.apptTz ?? 'Asia/Kolkata'} onChange={(e) => setForm({ ...form, apptTz: e.target.value })}>
                    <option value="Asia/Kolkata">Asia/Kolkata</option>
                    <option value="Asia/Dubai">Asia/Dubai</option>
                    <option value="UTC">UTC</option>
                    <option value="America/New_York">America/New_York</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">Timeslot <span className="text-red-400">*</span></label>
                  <select className={inputCls} value={form.apptSlot ?? ''} onChange={(e) => setForm({ ...form, apptSlot: e.target.value })} disabled={!form.apptEvent || !form.apptDate}>
                    <option value="">{!form.apptEvent ? 'Select a calendar first' : !form.apptDate ? 'Select a date first' : apptSlots.length === 0 ? 'No slots available this day' : 'Pick a timeslot'}</option>
                    {apptSlots.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={async () => {
                    if (!form.apptEvent || !form.apptDate || !form.apptSlot) { toast.error('Please fill all required fields'); return; }
                    const bookingName = apptET?.name ?? 'Appointment';
                    const slotParts = (form.apptSlot as string).split(' ');
                    const [hhStr, mmStr] = slotParts[0].split(':');
                    let hh = parseInt(hhStr, 10);
                    const mm = parseInt(mmStr, 10);
                    if (slotParts[1] === 'PM' && hh !== 12) hh += 12;
                    else if (slotParts[1] === 'AM' && hh === 12) hh = 0;
                    const time24 = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
                    const startIso = `${form.apptDate}T${time24}:00`;
                    const endDate = new Date(startIso);
                    endDate.setMinutes(endDate.getMinutes() + (apptET?.duration ?? 30));
                    try {
                      const created = await api.post<any>('/api/calendar', {
                        title: `${bookingName} - ${lead.firstName} ${lead.lastName}`,
                        type: apptET?.eventType ?? 'meeting',
                        start_time: startIso,
                        end_time: endDate.toISOString(),
                        lead_id: lead.id,
                        assigned_to: lead.assignedTo || undefined,
                        event_type_id: form.apptEvent,
                        meeting_link: form.apptLink || undefined,
                      });
                      addCalendarEvent({
                        id: created.id,
                        title: `${bookingName} - ${lead.firstName} ${lead.lastName}`,
                        type: (apptET?.eventType as 'meeting' | 'demo' | 'call') ?? 'meeting',
                        leadName: `${lead.firstName} ${lead.lastName}`,
                        assignedTo: lead.assignedTo,
                        date: form.apptDate as string,
                        time: time24,
                        duration: apptET?.duration ?? 30,
                        status: 'scheduled',
                        meetingLink: form.apptLink,
                      });
                      toast.success('Appointment booked');
                      setForm({ ...form, apptEvent: '', apptDate: '', apptSlot: '', apptLink: '', apptLocation: '' });
                    } catch (err: any) {
                      toast.error(err.message ?? 'Failed to book appointment');
                    }
                  }}
                  className="px-8 py-2 rounded-xl text-white text-[13px] font-bold transition-all hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
                >Book Appointment</button>
              </div>

              {/* Existing appointments */}
              {leadEvents.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-black/5">
                  <p className="text-[12px] font-semibold text-[#7a6b5c]">Existing Appointments</p>
                  {leadEvents.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--app-bg)] border border-black/5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[13px] font-medium text-[#1c1410]">{ev.title}</p>
                        <p className="text-[11px] text-[#7a6b5c]">{ev.date} · {ev.time} · {ev.duration} min</p>
                      </div>
                      <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-md', ev.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : ev.status === 'no-show' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600')}>{ev.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })()}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-gray-100">
          <p className="text-[11px] text-gray-400">
            Created On: {format(new Date(lead.createdAt), 'dd/MM/yyyy hh:mm aa')}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteModal(true)}
              className="px-5 py-2 rounded-lg text-[13px] font-bold text-red-500 border border-red-200 hover:bg-red-50 transition-all"
            >DELETE</button>
            <button
              onClick={handleUpdate}
              className="px-5 py-2 rounded-lg text-[13px] font-bold text-white bg-[#1c1410] hover:bg-[#2d1f18] transition-all"
            >UPDATE</button>
          </div>
        </div>
      </div>
      {showDeleteModal && (
        <DeleteLeadModal lead={lead} onClose={() => setShowDeleteModal(false)} onDeleted={onClose} />
      )}
    </div>
  );
}

// ─── Edit Fields Drawer ─────────────────────────────────────────────────────────

type FieldDef = { id: string; name: string; slug: string; type: string };

function EditFieldsDrawer({ lead, onClose, onSaved }: {
  lead: Lead;
  onClose: () => void;
  onSaved: (fields: { label: string; value: string; fieldId: string }[]) => void;
}) {
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [values, setValues]       = useState<Record<string, string>>({});
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<FieldDef[]>('/api/fields/custom'),
      api.get<any[]>(`/api/leads/${lead.id}/fields`),
    ]).then(([defs, vals]) => {
      setFieldDefs(defs ?? []);
      const map: Record<string, string> = {};
      (lead.customFields ?? []).forEach((f) => { if (f.fieldId) map[f.fieldId] = f.value; });
      // Only key by a real field_id. JSONB-only values (imports/API/forms) come back with
      // field_id=null; without this guard they'd all collapse into map[null] and clobber
      // each other. They remain display-only (shown in the panel) until defined as fields.
      (vals ?? []).forEach((v: any) => { if (v.field_id) map[v.field_id] = v.value ?? ''; });
      setValues(map);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [lead.id]);

  const handleSave = async () => {
    const entries = Object.entries(values).filter(([, v]) => v.trim() !== '');
    if (!entries.length) { onClose(); return; }
    setSaving(true);
    try {
      await api.patch(`/api/leads/${lead.id}/fields`, {
        values: entries.map(([field_id, value]) => ({ field_id, value })),
      });
      const updated = fieldDefs
        .filter((d) => values[d.id] !== undefined && values[d.id] !== '')
        .map((d) => ({ label: d.name, value: values[d.id], fieldId: d.id }));
      onSaved(updated);
      toast.success('Fields saved');
      onClose();
    } catch {
      toast.error('Failed to save fields');
    } finally {
      setSaving(false);
    }
  };

  const activeDefs = fieldDefs.filter((d) => (d as any).is_active !== false);

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md bg-white h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <div>
            <h3 className="font-headline font-bold text-[15px] text-[#1c1410]">Edit Fields</h3>
            <p className="text-[11px] text-[#7a6b5c] mt-0.5">{activeDefs.length} fields available</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] transition-colors">
            <X className="w-4 h-4 text-[#7a6b5c]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[13px] text-[#7a6b5c]">Loading fields…</div>
          ) : activeDefs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <FileText className="w-8 h-8 text-primary/30" />
              <p className="text-[13px] font-semibold text-[#1c1410]">No fields defined yet</p>
              <p className="text-[12px] text-[#7a6b5c]">Go to Settings → Fields to create custom fields</p>
            </div>
          ) : (
            activeDefs.map((def) => (
              <div key={def.id}>
                <label className="block text-[12px] font-semibold text-[#1c1410] mb-1.5">{def.name}</label>
                <input
                  value={values[def.id] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [def.id]: e.target.value }))}
                  placeholder={`Enter ${def.name.toLowerCase()}…`}
                  className="w-full px-3 py-2 rounded-lg border border-black/10 bg-white text-[13px] text-[#1c1410] placeholder:text-[#7a6b5c]/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors"
                />
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-black/5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors border border-black/10">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 12px rgba(234,88,12,0.25)' }}
          >
            {saving ? 'Saving…' : 'Save Fields'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Additional Info Section (pipeline questionnaire) ──────────────────────────
function AdditionalInfoSection({ lead, onUpdate }: { lead: Lead; onUpdate: (fields: { label: string; value: string }[]) => void }) {
  const { additionalFields } = useCrmStore();
  // Include the lead's pipeline-specific questions + global questions (pipelineId === 'all')
  const pipelineQuestions = additionalFields.filter((q) => q.pipelineId === lead.pipelineId || q.pipelineId === 'all');

  // Build answer map from lead.customFields (label -> value)
  const existingAnswers: Record<string, string> = {};
  (lead.customFields ?? []).forEach((f) => { existingAnswers[f.label] = f.value; });

  const [answers, setAnswers] = useState<Record<string, string>>(existingAnswers);

  // Field values load asynchronously (and can be refreshed by the store). Merge newly
  // arrived values in, but keep any answer the user is currently editing on top so we
  // never overwrite in-progress typing.
  useEffect(() => {
    const incoming: Record<string, string> = {};
    (lead.customFields ?? []).forEach((f) => { incoming[f.label] = f.value; });
    setAnswers((prev) => ({ ...incoming, ...prev }));
  }, [lead.customFields]);

  const saveAnswer = (fieldId: string, question: string, value: string) => {
    const next = { ...answers, [question]: value };
    setAnswers(next);
    const fieldList = Object.entries(next)
      .filter(([, v]) => v !== '')
      .map(([label, val]) => ({ label, value: val }));
    onUpdate(fieldList);
    // Persist to API
    if (fieldId) {
      api.patch(`/api/leads/${lead.id}/fields`, { values: [{ field_id: fieldId, value }] }).catch(() => null);
    }
  };

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white';

  // Empty state — no questions configured for this pipeline
  if (pipelineQuestions.length === 0) {
    return (
      <div className="px-5 py-4 border-b border-black/5">
        <h4 className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-2">Additional Info</h4>
        <p className="text-[12px] text-[#b09e8d] italic">
          No questions configured for this pipeline.{' '}
          <a href="/fields" className="text-primary font-semibold hover:underline">Set them up in Fields → Additional Fields</a>
        </p>
      </div>
    );
  }

  const filledCount = pipelineQuestions.filter((q) => answers[q.question] && answers[q.question].trim() !== '').length;

  return (
    <div className="px-5 py-4 border-b border-black/5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider">
          Additional Info
          <span className="text-[#b09e8d] font-normal ml-1">· {filledCount}/{pipelineQuestions.length} filled</span>
        </h4>
      </div>

      <div className="space-y-3">
        {pipelineQuestions.map((q) => {
          const value = answers[q.question] ?? '';
          const filled = value.trim() !== '';
          return (
            <div key={q.id}>
              <label className="text-[12px] font-semibold text-[#1c1410] mb-1 flex items-center gap-1">
                {q.question}
                {q.required && <span className="text-red-500">*</span>}
                {filled && <Check className="w-3 h-3 text-green-500 ml-auto" />}
              </label>

              {/* Render input based on type */}
              {q.type === 'Multi Line' && (
                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white resize-none"
                  rows={2}
                  placeholder="Type answer..."
                  value={value}
                  onChange={(e) => saveAnswer(q.id, q.question, e.target.value)}
                />
              )}
              {q.type === 'Dropdown' && (
                <select className={inputCls} value={value} onChange={(e) => saveAnswer(q.id, q.question, e.target.value)}>
                  <option value="">Choose...</option>
                  {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {q.type === 'Multi-select' && (
                <div className="flex flex-wrap gap-1.5">
                  {(q.options ?? []).map((o) => {
                    const selected = (value ?? '').split(',').map((x) => x.trim()).includes(o);
                    return (
                      <button
                        key={o}
                        onClick={() => {
                          const current = value ? value.split(',').map((x) => x.trim()) : [];
                          const next = selected ? current.filter((x) => x !== o) : [...current, o];
                          saveAnswer(q.id, q.question, next.join(', '));
                        }}
                        className={cn('px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors',
                          selected ? 'bg-primary text-white border-primary' : 'bg-white text-[#7a6b5c] border-black/10 hover:border-primary/30')}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              )}
              {q.type === 'Radio' && (
                <div className="space-y-1.5">
                  {(q.options ?? []).map((o) => (
                    <label key={o} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`radio-${q.id}`}
                        checked={value === o}
                        onChange={() => saveAnswer(q.id, q.question, o)}
                        className="w-4 h-4 accent-primary"
                      />
                      <span className="text-[13px] text-[#1c1410]">{o}</span>
                    </label>
                  ))}
                </div>
              )}
              {q.type === 'Multi-Checkbox' && (
                <div className="space-y-1.5">
                  {(q.options ?? []).map((o) => {
                    const selected = (value ?? '').split(',').map((x) => x.trim()).includes(o);
                    return (
                      <label key={o} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            const current = value ? value.split(',').map((x) => x.trim()).filter(Boolean) : [];
                            const next = selected ? current.filter((x) => x !== o) : [...current, o];
                            saveAnswer(q.id, q.question, next.join(', '));
                          }}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-[13px] text-[#1c1410]">{o}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {q.type === 'Checkbox' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={value === 'true'} onChange={(e) => saveAnswer(q.id, q.question, e.target.checked ? 'true' : 'false')} className="w-4 h-4 accent-primary" />
                  <span className="text-[13px] text-[#1c1410]">Yes</span>
                </label>
              )}
              {q.type === 'Date' && (
                <input className={inputCls} type="date" value={value} onChange={(e) => saveAnswer(q.id, q.question, e.target.value)} />
              )}
              {q.type === 'Number' && (
                <input className={inputCls} type="number" placeholder="0" value={value} onChange={(e) => saveAnswer(q.id, q.question, e.target.value)} />
              )}
              {q.type === 'Monetary' && (
                <input className={inputCls} type="number" placeholder="₹" value={value} onChange={(e) => saveAnswer(q.id, q.question, e.target.value)} />
              )}
              {q.type === 'Phone' && (
                <input className={inputCls} type="tel" placeholder="+91" value={value} onChange={(e) => saveAnswer(q.id, q.question, e.target.value)} />
              )}
              {q.type === 'Email' && (
                <input className={inputCls} type="email" placeholder="name@example.com" value={value} onChange={(e) => saveAnswer(q.id, q.question, e.target.value)} />
              )}
              {q.type === 'URL' && (
                <input className={inputCls} type="url" placeholder="https://" value={value} onChange={(e) => saveAnswer(q.id, q.question, e.target.value)} />
              )}
              {/* Default: Single Line + File Upload (text for now) */}
              {(q.type === 'Single Line' || q.type === 'File Upload') && (
                <input className={inputCls} placeholder="Type answer..." value={value} onChange={(e) => saveAnswer(q.id, q.question, e.target.value)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Lead Detail Panel ─────────────────────────────────────────────────────────
export function LeadDetailPanel({ lead, onClose, onLeadUpdated }: {
  lead: Lead;
  onClose: () => void;
  onLeadUpdated?: (id: string, updates: { pipelineId: string; stage: string; stageId: string | undefined; tags: string[] }) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showFuModal, setShowFuModal] = useState(false);
  const [showApptModal, setShowApptModal] = useState(false);
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  // Real API data for this lead
  const [leadNotes, setLeadNotes] = useState<any[]>([]);
  const [leadFollowUps, setLeadFollowUps] = useState<any[]>([]);
  const [leadActivities, setLeadActivities] = useState<any[]>([]);
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [editNote, setEditNote] = useState<{ id: string; title: string; content: string } | null>(null);
  const [editFu, setEditFu] = useState<{ id: string; title: string; notes: string; dueAt: string } | null>(null);
  const [showTagAdd, setShowTagAdd] = useState(false);
  const [tagAddInput, setTagAddInput] = useState('');
  const [savingTag, setSavingTag] = useState(false);

  const { calendarEvents, updateLead, deleteLead, addActivity, pipelines, tags: storeTags, staff, bookingLinks, addCalendarEvent } = useCrmStore();
  const waPersonalStatus = useCrmStore((s) => s.waPersonalStatus);
  const currentUser = useAuthStore((s) => s.currentUser);
  const canEditLead   = usePermission('leads:edit');
  const canDeleteLead = usePermission('leads:delete');
  const canAssign     = usePermission('leads:assign');
  const canManageStaff = usePermission('staff:manage');
  const isManagerView = currentUser?.role === 'super_admin' || currentUser?.role === 'owner' || canManageStaff;
  const [editTeamDropOpen, setEditTeamDropOpen] = useState(false);
  const [editTeamSearch, setEditTeamSearch] = useState('');
  const [editTagDropOpen, setEditTagDropOpen] = useState(false);

  // Include owner in assignable staff list
  const allStaffForPanel = (() => {
    const list = [...staff];
    if (currentUser && !list.some((s: any) => s.id === currentUser.id)) {
      list.unshift({ id: currentUser.id, name: currentUser.name } as any);
    }
    return list;
  })();

  const [showStageTl, setShowStageTl] = useState(false);
  const [stageTl, setStageTl] = useState<{ created_at: string | null; history: any[] } | null>(null);
  const [stageTlLoading, setStageTlLoading] = useState(false);
  const loadStageTl = () => {
    if (stageTl || stageTlLoading) return;
    setStageTlLoading(true);
    api.get<any>(`/api/leads/${lead.id}/stage-history`)
      .then((d) => setStageTl(d))
      .catch(() => setStageTl({ created_at: null, history: [] }))
      .finally(() => setStageTlLoading(false));
  };
  const fmtDur = (ms: number) => {
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    const remH = hrs % 24;
    return remH > 0 && days < 3 ? `${days}d ${remH}h` : `${days} day${days !== 1 ? 's' : ''}`;
  };
  const loadEnquiries = () => {
    if (enquiryData || enquiryLoading) return;
    setEnquiryLoading(true);
    api.get<{ enquiries: any[]; leads: any[] }>(`/api/contacts/journey/by-lead/${lead.id}`)
      .then(setEnquiryData)
      .catch(() => setEnquiryData({ enquiries: [], leads: [] }))
      .finally(() => setEnquiryLoading(false));
  };

  const [showWaDropdown, setShowWaDropdown] = useState(false);
  const [showWaSendModal, setShowWaSendModal] = useState(false);
  const [waMessage, setWaMessage] = useState('');
  const [waSending, setWaSending] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCustomFields, setShowCustomFields] = useState(false);
  const [showEditFields,   setShowEditFields]   = useState(false);
  const [showEnquiries, setShowEnquiries] = useState(false);
  const [enquiryData, setEnquiryData] = useState<{ enquiries: any[]; leads: any[] } | null>(null);
  const [enquiryLoading, setEnquiryLoading] = useState(false);
  const [cfStatus, setCfStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  // Field values live in LOCAL state — the single source of truth for this panel's
  // "Additional Fields" display. This is deliberately NOT read from the global store:
  // store refreshes (30s poll, apiLeads snapshot, initFromApi, socket lead:updated,
  // object swaps for not-yet-in-store leads) used to blank lead.customFields and make
  // the values vanish a few seconds after opening. Local state can't be wiped by any
  // of those. We still mirror into the store for other views, but display uses `fields`.
  const [fields, setFields] = useState<{ label: string; value: string; fieldId: string | null }[]>(
    () => (lead.customFields as any) ?? []
  );

  // Load persisted custom field values — tracks status so we can tell
  // "still loading" / "failed to load" apart from "genuinely empty".
  const loadFields = useCallback(() => {
    setCfStatus('loading');
    api.get<any[]>(`/api/leads/${lead.id}/fields`).then((rows) => {
      const customFields = rows.map((r) => ({ label: r.field_name ?? r.slug, value: r.value, fieldId: r.field_id }));
      setFields(customFields);                       // local — what the panel renders
      updateLead(lead.id, { customFields });         // mirror to store for other views
      setCfStatus('loaded');
    }).catch((e) => { console.warn('[lead fields] load failed', e); setCfStatus('error'); });
  }, [lead.id, updateLead]);

  useEffect(() => {
    api.get<any[]>(`/api/leads/${lead.id}/notes`).then(setLeadNotes).catch(() => null);
    api.get<any[]>(`/api/leads/${lead.id}/followups`).then((data) =>
      setLeadFollowUps(data.map((f) => ({ id: f.id, leadId: lead.id, dueAt: f.due_at, note: f.title, description: f.description, completed: f.completed, assignedTo: f.assigned_to, createdAt: f.created_at })))
    ).catch(() => null);
    api.get<any[]>(`/api/leads/${lead.id}/activities`).then((data) =>
      setLeadActivities(data.map((a) => ({ id: a.id, leadId: lead.id, type: a.type, title: a.title, detail: a.type === 'call' ? null : a.detail, timestamp: a.created_at, createdBy: a.created_by_name ?? a.created_by, callLogId: a.type === 'call' ? a.detail : undefined, hasRecording: a.has_recording === true })))
    ).catch(() => null);
    setFields((lead.customFields as any) ?? []); // seed from store for the (possibly new) lead, then refresh
    loadFields();
  }, [lead.id]);

  // Option B: re-fetch activities whenever this lead is updated (from any source/window)
  useEffect(() => {
    const socket = getSocket();
    const onLeadUpdated = (updated: any) => {
      if (updated.id !== lead.id) return;
      api.get<any[]>(`/api/leads/${lead.id}/activities`).then((data) =>
        setLeadActivities(data.map((a) => ({
          id: a.id, leadId: lead.id, type: a.type, title: a.title,
          detail: a.type === 'call' ? null : a.detail, timestamp: a.created_at,
          createdBy: a.created_by_name ?? a.created_by,
          callLogId: a.type === 'call' ? a.detail : undefined,
          hasRecording: a.has_recording === true,
        })))
      ).catch(() => null);
      // NOTE: deliberately do NOT reload fields here. Field values are in local state and
      // only change via the Edit Fields drawer; auto-reloading on every lead:updated was a
      // cause of the values flickering/blanking. Edits update `fields` directly.
    };
    socket.on('lead:updated', onLeadUpdated);
    return () => { socket.off('lead:updated', onLeadUpdated); };
  }, [lead.id]);

  const assignedStaff = staff.find((s) => s.id === lead.assignedTo);
  const assignedDisplayName = assignedStaff?.name || lead.assignedName || '';
  const pipelineName = pipelines.find((p) => p.id === lead.pipelineId)?.name ?? lead.pipelineId;

  const leadAppointments = calendarEvents.filter((e) => e.leadName === `${lead.firstName} ${lead.lastName}`.trim());

  // Edit form state
  const [editForm, setEditForm] = useState({
    firstName: lead.firstName, lastName: lead.lastName,
    phone: lead.phone, email: lead.email,
    dealValue: lead.dealValue, source: lead.source,
    assignedTo: lead.assignedTo ?? '',
    tags: [...lead.tags], tagInput: '',
    leadQuality: lead.leadQuality ?? '',
    teamMembers: [...(lead.teamMembers ?? [])],
  });

  const handleSaveEdit = async () => {
    try {
      const pipeline = pipelines.find((p) => p.id === lead.pipelineId);
      const stageId = pipeline?.stages.find((s) => s.name === lead.stage)?.id;
      await api.patch(`/api/leads/${lead.id}`, {
        name: `${editForm.firstName} ${editForm.lastName}`.trim(),
        email: editForm.email,
        phone: editForm.phone,
        stage_id: stageId || undefined,
        assigned_to: editForm.assignedTo || null,
        tags: editForm.tags,
        deal_value: editForm.dealValue !== undefined ? Number(editForm.dealValue) : undefined,
        custom_fields: { lead_quality: editForm.leadQuality || null },
        team_members: editForm.teamMembers,
      });
      updateLead(lead.id, {
        firstName: editForm.firstName, lastName: editForm.lastName,
        phone: editForm.phone, email: editForm.email,
        dealValue: Number(editForm.dealValue),
        assignedTo: editForm.assignedTo,
        assignedName: staff.find((s) => s.id === editForm.assignedTo)?.name ?? '',
        tags: editForm.tags,
        leadQuality: editForm.leadQuality || undefined,
        teamMembers: editForm.teamMembers,
      });
      setEditMode(false);
      toast.success('Lead updated');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update lead');
    }
  };

  const logActivity = (type: LeadActivity['type'], title: string, detail?: string) => {
    const act = {
      id: `act-${Date.now()}`, leadId: lead.id, type, title, detail,
      timestamp: new Date().toISOString(), createdBy: currentUser?.id ?? '',
    };
    addActivity(act);
    setLeadActivities((prev) => [act, ...prev]);
  };

  // Inline tag add/remove right from the detail view — no need to enter Edit mode.
  // Optimistic update with rollback, persisted via the same PATCH as edit mode.
  const persistTags = async (next: string[]) => {
    const prev = lead.tags;
    setSavingTag(true);
    updateLead(lead.id, { tags: next });
    try {
      await api.patch(`/api/leads/${lead.id}`, { tags: next });
      onLeadUpdated?.(lead.id, { pipelineId: lead.pipelineId, stage: lead.stage, stageId: lead.stageId, tags: next });
    } catch (e: any) {
      updateLead(lead.id, { tags: prev });
      toast.error(e?.message ?? 'Failed to update tags');
    } finally {
      setSavingTag(false);
    }
  };

  const addTagInline = (raw: string) => {
    const t = raw.trim();
    setTagAddInput('');
    if (!t || lead.tags.includes(t)) return;
    logActivity('tag_added', `Tag added: ${t}`);
    persistTags([...lead.tags, t]);
  };

  const removeTagInline = (t: string) => {
    persistTags(lead.tags.filter((x) => x !== t));
  };

  const handleCall = () => {
    logActivity('call', 'Called', lead.phone);
    window.open(`tel:${lead.phone}`);
  };

  const handleWhatsApp = () => {
    logActivity('whatsapp', 'WhatsApp', lead.phone);
    window.open(`https://wa.me/${lead.phone.replace(/\D/g, '')}`, '_blank');
  };

  const handleSendPersonalWa = async () => {
    if (!waMessage.trim() || waSending) return;
    setWaSending(true);
    try {
      await api.post('/api/whatsapp-personal/send', {
        lead_id: lead.id,
        phone: lead.phone,
        message: waMessage.trim(),
      });
      logActivity('whatsapp', 'Sent via Personal WhatsApp', waMessage.trim());
      toast.success('Message sent via Personal WhatsApp');
      setShowWaSendModal(false);
      setWaMessage('');
    } catch {
      toast.error('Failed to send via Personal WhatsApp');
    } finally {
      setWaSending(false);
    }
  };

  const cleanActivityTitle = (t: string) => t
    .replace(/^Lead added\/updated in CRM and verified\s*→\s*stage:\s*/i, 'Added to CRM · ')
    .replace(/^Tags added and verified:\s*/i, 'Tags added: ')
    .replace(/^Tags removed and verified:\s*/i, 'Tags removed: ')
    .replace(/^Assigned and verified:\s*/i, 'Assigned: ')
    .replace(/^Staff assignment removed and verified$/i, 'Staff unassigned')
    .replace(/^Lead quality set and verified:\s*/i, 'Quality: ')
    .replace(/^Attributes updated and verified:\s*/i, 'Updated: ')
    .replace(/^Lead soft-deleted and verified$/i, 'Lead removed')
    .replace(/^Note created and verified:\s*/i, 'Note: ')
    .replace(/^Follow-up created and verified:\s*/i, 'Follow-up: ')
    .replace(/^Notification sent and verified:\s*/i, 'Notified: ')
    .replace(/^Appointment status changed and verified:\s*/i, 'Appointment: ')
    .replace(/^Stage changed and verified:\s*/i, 'Moved to ')
    .replace(/^Stage changed to\s+/i, 'Moved to ')
    .replace(/^Stage →\s*/i, 'Moved to ');

  // Build timeline from all sources
  type TimelineEntry = { id: string; type: LeadActivity['type']; title: string; detail?: string; timestamp: string; createdBy?: string; callLogId?: string; hasRecording?: boolean };
  const timeline: TimelineEntry[] = [
    { id: 'created', type: 'created', title: `Joined · ${pipelineName}`, detail: getSourceLabel(lead), timestamp: lead.createdAt },
    ...leadActivities.filter((a) => a.type !== 'note' && a.type !== 'followup').map((a) => ({ id: a.id, type: a.type, title: cleanActivityTitle(a.title), detail: a.detail, timestamp: a.timestamp, createdBy: a.createdBy, callLogId: a.callLogId, hasRecording: a.hasRecording })),
    ...leadNotes.map((n) => ({ id: `note-${n.id}`, type: 'note' as const, title: n.title || 'Note', detail: n.content, timestamp: n.created_at, createdBy: n.created_by_name ?? n.created_by })),
    ...leadFollowUps.map((f) => ({ id: `fu-${f.id}`, type: 'followup' as const, title: f.note || 'Follow-up', detail: `Due: ${format(new Date(f.dueAt), 'dd MMM yyyy, h:mm a')}${f.completed ? ' · Done' : ''}${f.description ? `\n${f.description}` : ''}`, timestamp: f.createdAt || f.dueAt, createdBy: undefined as string | undefined })),
    ...leadAppointments.map((a) => ({
      id: `appt-${a.id}`, type: 'appointment' as const,
      title: (a.title ?? '').split(' - ')[0],
      detail: `${format(new Date(a.date), 'dd MMM yyyy')} · ${a.time}`,
      timestamp: a.date,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const iconForType = (type: LeadActivity['type']) => {
    switch (type) {
      case 'call': return { Icon: Phone, bg: 'bg-orange-100', color: 'text-primary' };
      case 'whatsapp': return { Icon: MessageCircle, bg: 'bg-emerald-100', color: 'text-emerald-600' };
      case 'email': return { Icon: Mail, bg: 'bg-blue-100', color: 'text-blue-600' };
      case 'note': return { Icon: FileText, bg: 'bg-purple-100', color: 'text-purple-600' };
      case 'followup': return { Icon: Clock, bg: 'bg-amber-100', color: 'text-amber-600' };
      case 'appointment': return { Icon: Calendar, bg: 'bg-indigo-100', color: 'text-indigo-600' };
      case 'stage_change': return { Icon: ArrowLeftRight, bg: 'bg-slate-100', color: 'text-slate-600' };
      case 'tag_added': return { Icon: Tag, bg: 'bg-pink-100', color: 'text-pink-600' };
      case 'assigned': return { Icon: UserCheck, bg: 'bg-teal-100', color: 'text-teal-600' };
      case 'created': return { Icon: UserPlus, bg: 'bg-orange-100', color: 'text-primary' };
      case 'wa_broadcast': return { Icon: Megaphone, bg: 'bg-emerald-100', color: 'text-emerald-600' };
      case 'wa_template_sent': return { Icon: Send, bg: 'bg-emerald-100', color: 'text-emerald-600' };
      case 'wa_message_in': return { Icon: MessageCircle, bg: 'bg-emerald-100', color: 'text-emerald-600' };
      case 'wa_button_click': return { Icon: MousePointerClick, bg: 'bg-violet-100', color: 'text-violet-600' };
      default: return { Icon: Circle, bg: 'bg-gray-100', color: 'text-gray-500' };
    }
  };

  const timestampLabel = (ts: string) => {
    const d = new Date(ts);
    const today = new Date();
    const yday = new Date(today); yday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return `Today, ${format(d, 'h:mm a')}`;
    if (d.toDateString() === yday.toDateString()) return `Yesterday, ${format(d, 'h:mm a')}`;
    return format(d, 'MMM d, h:mm a');
  };

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white';

  return (
    <>
    <div className="fixed inset-0 z-50 flex justify-end" style={{ backdropFilter: 'blur(3px)', backgroundColor: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
    <div className="w-full max-w-[480px] bg-white h-full flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>

      {/* Header */}
      <div className="px-5 py-4 border-b border-black/5 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[17px] text-[#1c1410]">Lead Details</h2>
          <div className="flex items-center gap-1">
            {lead.source && (
              <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-semibold', getSourceColor(lead.source))}>
                {getSourceLabel(lead)}
              </span>
            )}
            {!editMode && canEditLead && (
              <button onClick={() => setEditMode(true)} title="Edit" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-primary transition-colors">
                <Pencil className="w-4 h-4" />
              </button>
            )}
            {canDeleteLead && (
              <button onClick={() => setShowDeleteModal(true)} title="Delete" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-[#c4b09e] hover:text-red-500 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            {showDeleteModal && (
              <DeleteLeadModal lead={lead} onClose={() => setShowDeleteModal(false)} onDeleted={onClose} />
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-[var(--accent-tint)] rounded-lg transition-colors">
              <X className="w-5 h-5 text-[#7a6b5c]" />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">

        {/* Profile */}
        {!editMode ? (
          <div className="px-5 py-5 border-b border-black/5">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-[16px] shrink-0" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
                {lead.firstName[0]}{lead.lastName?.[0] ?? ''}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-[17px] text-[#1c1410] leading-tight">{lead.firstName} {lead.lastName}</h3>
                <p className="text-[13px] text-[#7a6b5c] mt-0.5">Deal value: <span className="font-semibold text-[#1c1410]">₹{lead.dealValue.toLocaleString()}</span></p>
              </div>
            </div>

            <div className="space-y-3">
              {[
                { Icon: User, value: `${lead.firstName} ${lead.lastName}`, href: undefined as string | undefined },
                { Icon: Phone, value: lead.phone, href: `tel:${lead.phone}` },
                { Icon: Mail, value: lead.email || '-', href: undefined as string | undefined },
                { Icon: Layers, value: lead.stage ? `${lead.stage} · ${pipelineName}` : pipelineName, href: undefined as string | undefined },
                { Icon: UserCheck, value: assignedDisplayName ? `Assigned to ${assignedDisplayName}` : 'Unassigned', href: undefined as string | undefined },
                { Icon: Tag, value: getSourceLabel(lead), href: undefined as string | undefined },
              ].map(({ Icon, value, href }, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-[#7a6b5c] shrink-0" />
                  {href ? (
                    <a href={href} className="text-[13px] text-[#1c1410] font-medium flex-1 break-words hover:text-primary transition-colors">{value}</a>
                  ) : (
                    <span className="text-[13px] text-[#1c1410] font-medium flex-1 break-words">{value}</span>
                  )}
                </div>
              ))}


              {/* Team Members */}
              {(lead.teamMembers ?? []).length > 0 && (
                <div className="flex items-start gap-3">
                  <Users className="w-4 h-4 text-[#7a6b5c] shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {(lead.teamMembers ?? []).map((id) => {
                      const m = allStaffForPanel.find((s) => s.id === id);
                      return m ? (
                        <span key={id} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-medium">{m.name}</span>
                      ) : null;
                    })}
                  </div>
                </div>
              )}

              {/* Tags — add/remove inline so staff can tag without entering Edit mode */}
              <div className="pt-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {lead.tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-50 text-[var(--brand-dark)] border border-orange-100">
                      <Tag className="w-2.5 h-2.5" />{t}
                      {canEditLead && (
                        <button onClick={() => removeTagInline(t)} disabled={savingTag} className="ml-0.5 hover:text-red-500 disabled:opacity-40" title="Remove tag"><X className="w-2.5 h-2.5" /></button>
                      )}
                    </span>
                  ))}
                  {canEditLead && !showTagAdd && (
                    <button onClick={() => setShowTagAdd(true)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-primary border border-dashed border-primary/40 hover:bg-[var(--accent-tint)] transition-colors">
                      <Plus className="w-2.5 h-2.5" /> Add tag
                    </button>
                  )}
                  {lead.tags.length === 0 && !canEditLead && (
                    <span className="text-[12px] text-[#b09e8d] italic">No tags</span>
                  )}
                </div>
                {canEditLead && showTagAdd && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={tagAddInput}
                        onChange={(e) => setTagAddInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addTagInline(tagAddInput); }
                          else if (e.key === 'Escape') { setShowTagAdd(false); setTagAddInput(''); }
                        }}
                        placeholder="Type a tag, press Enter"
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-[12px] text-[#1c1410] outline-none focus:border-primary/40 bg-white"
                      />
                      <button onClick={() => addTagInline(tagAddInput)} disabled={!tagAddInput.trim() || savingTag} className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[12px] font-semibold hover:bg-primary/20 transition-colors disabled:opacity-40">Add</button>
                      <button onClick={() => { setShowTagAdd(false); setTagAddInput(''); }} className="px-2 py-1.5 rounded-lg text-[#7a6b5c] text-[12px] hover:bg-black/5">Cancel</button>
                    </div>
                    {/* Quick-pick from existing tenant tags */}
                    {(() => {
                      const suggestions = storeTags
                        .filter((tg) => !lead.tags.includes(tg.name) && (!tagAddInput.trim() || tg.name.toLowerCase().includes(tagAddInput.trim().toLowerCase())))
                        .slice(0, 12);
                      return suggestions.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {suggestions.map((tg) => (
                            <button key={tg.id} onClick={() => addTagInline(tg.name)} disabled={savingTag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white text-[#7a6b5c] border border-black/10 hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-40">
                              <Tag className="w-2.5 h-2.5" />{tg.name}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>

              {/* Additional custom fields */}
              <div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setShowCustomFields((v) => !v)}
                    className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:text-[var(--brand-dark)] transition-colors"
                  >
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${showCustomFields ? 'rotate-90' : ''}`} />
                    Additional Fields {fields.length > 0 ? `(${fields.length})` : ''}
                  </button>
                  {canEditLead && (
                    <button
                      onClick={() => setShowEditFields(true)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-[#7a6b5c] hover:text-[var(--brand-dark)] transition-colors px-2 py-1 rounded-lg hover:bg-[var(--accent-tint)]"
                    >
                      <Pencil className="w-3 h-3" /> Edit Fields
                    </button>
                  )}
                </div>
                {showCustomFields && (
                  <div className="mt-2 space-y-2 pl-1">
                    {fields.length > 0 ? (
                      fields.map((f, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <FileText className="w-4 h-4 text-[#7a6b5c] shrink-0 mt-1" />
                          <div className="flex-1 min-w-0">
                            <span className="text-[12px] text-[#7a6b5c]">{f.label}:</span>
                            <span className="ml-1.5 text-[12px] font-semibold bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded-md inline-block break-words mt-0.5">
                              {/https?:\/\/\S+/.test(f.value) ? (
                                <a href={f.value.match(/https?:\/\/\S+/)?.[0]} target="_blank" rel="noreferrer" className="text-blue-600 underline hover:text-blue-800 break-all">{f.value}</a>
                              ) : f.value}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : cfStatus === 'loading' ? (
                      <p className="text-[12px] text-[#7a6b5c] pl-1 italic">Loading field values…</p>
                    ) : cfStatus === 'error' ? (
                      <button onClick={loadFields} className="text-[12px] text-red-500 pl-1 italic hover:underline">Couldn't load fields - tap to retry</button>
                    ) : (
                      <p className="text-[12px] text-[#7a6b5c] pl-1 italic">No field values yet - click Edit Fields to add</p>
                    )}
                  </div>
                )}
              </div>

              {/* Enquiry Journey */}
              <div>
                <button
                  onClick={() => { setShowEnquiries((v) => !v); loadEnquiries(); }}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:text-[var(--brand-dark)] transition-colors"
                >
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${showEnquiries ? 'rotate-90' : ''}`} />
                  Enquiry Journey {enquiryData && enquiryData.enquiries.length > 0 ? `(${enquiryData.enquiries.length})` : ''}
                </button>
                {showEnquiries && (
                  <div className="mt-2 space-y-2 pl-1">
                    {enquiryLoading ? (
                      <p className="text-[12px] text-[#7a6b5c] pl-1 italic">Loading…</p>
                    ) : !enquiryData || enquiryData.enquiries.length === 0 ? (
                      <p className="text-[12px] text-[#7a6b5c] pl-1 italic">No enquiry history recorded yet</p>
                    ) : (
                      <>
                        {enquiryData.leads.length > 1 && (
                          <div className="text-[11px] text-[#7a6b5c] bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mb-1">
                            This person has <span className="font-bold text-amber-700">{enquiryData.leads.length} leads</span> across different pipelines
                          </div>
                        )}
                        {enquiryData.enquiries.map((e: any) => (
                          <div key={e.id} className="flex items-start gap-2.5 group">
                            <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: e.is_duplicate ? '#f59e0b' : 'var(--brand, #c2410c)' }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12px] font-semibold text-[#1c1410]">{e.form_name || e.form_type}</span>
                                {e.is_duplicate && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Re-enquiry</span>}
                              </div>
                              <p className="text-[11px] text-[#7a6b5c]">
                                {e.pipeline_name ? `${e.pipeline_name}${e.stage_name ? ` → ${e.stage_name}` : ''}` : ''}
                                {' · '}
                                {format(new Date(e.created_at), 'dd MMM yyyy, hh:mm a')}
                              </p>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Lead Quality */}
              {lead.leadQuality && (
                <div className="flex items-center gap-3">
                  <Star className="w-4 h-4 text-[#7a6b5c] shrink-0" />
                  <span className={cn(
                    'inline-flex items-center text-[12px] font-semibold px-2.5 py-1 rounded-full',
                    lead.leadQuality === 'Hot'         ? 'bg-red-100 text-red-700'     :
                    lead.leadQuality === 'Warm'        ? 'bg-amber-100 text-amber-700' :
                    lead.leadQuality === 'Cold'        ? 'bg-blue-100 text-blue-700'   :
                    lead.leadQuality === 'Unqualified' ? 'bg-gray-100 text-gray-500'   :
                    'bg-emerald-100 text-emerald-700'
                  )}>
                    {lead.leadQuality}
                  </span>
                </div>
              )}

              {/* Timestamps */}
              <div className="pt-1 border-t border-black/5 mt-1 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#7a6b5c]">Created at</span>
                  <span className="text-[11px] font-medium text-[#1c1410]">{format(new Date(lead.createdAt), 'dd MMM yyyy, hh:mm:ss a')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#7a6b5c]">Updated at</span>
                  <span className="text-[11px] font-medium text-[#1c1410]">{format(new Date(lead.lastActivity), 'dd MMM yyyy, hh:mm:ss a')}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* EDIT MODE — sectioned structure */
          <div className="border-b border-black/5">

            {/* ═══ CONTACT SECTION ═══ */}
            <div className="px-5 py-4 border-b border-black/[0.05]">
              <h4 className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-3">Contact</h4>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-[#7a6b5c] mb-1 block font-medium">First name</label>
                    <input className={inputCls} value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#7a6b5c] mb-1 block font-medium">Last name</label>
                    <input className={inputCls} value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-[#7a6b5c] mb-1 block font-medium">Phone</label>
                  <input className={inputCls} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                </div>

                <div>
                  <label className="text-[11px] text-[#7a6b5c] mb-1 block font-medium">Email</label>
                  <input className={inputCls} type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-[#7a6b5c] mb-1 block font-medium">Deal value (₹)</label>
                    <input className={inputCls} type="number" value={editForm.dealValue} onChange={(e) => setEditForm({ ...editForm, dealValue: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#7a6b5c] mb-1 block font-medium">Source</label>
                    <div className={inputCls + ' bg-gray-50 text-[#7a6b5c] cursor-default select-none'}>
                      <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full', getSourceColor(lead.source))}>
                        {getSourceLabel(lead)}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-[#7a6b5c] mb-1 block font-medium">Assigned to</label>
                  {canAssign ? (
                    <select className={inputCls} value={editForm.assignedTo} onChange={(e) => setEditForm({ ...editForm, assignedTo: e.target.value })}>
                      <option value="">Unassigned</option>
                      {allStaffForPanel.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : (
                    <div className={cn(inputCls, 'bg-gray-50 text-[#7a6b5c] cursor-not-allowed')} title="You don't have permission to reassign leads">
                      {staff.find((s) => s.id === editForm.assignedTo)?.name ?? 'Unassigned'}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[11px] text-[#7a6b5c] mb-1 block font-medium">Lead Quality</label>
                  <select className={inputCls} value={editForm.leadQuality} onChange={(e) => setEditForm({ ...editForm, leadQuality: e.target.value })}>
                    <option value="">- None -</option>
                    <option value="Hot">Hot</option>
                    <option value="Warm">Warm</option>
                    <option value="Cold">Cold</option>
                    <option value="Unqualified">Unqualified</option>
                  </select>
                </div>

                {/* Team Members — multi-select with chips */}
                <div className="relative">
                  <label className="text-[11px] text-[#7a6b5c] mb-1.5 block font-medium">Team Members</label>
                  {editForm.teamMembers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {editForm.teamMembers.map((id) => {
                        const m = allStaffForPanel.find((s) => s.id === id);
                        return (
                          <span key={id} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
                            {m?.name ?? 'Unknown'}
                            <button type="button" onClick={() => setEditForm({ ...editForm, teamMembers: editForm.teamMembers.filter((x) => x !== id) })}><X className="w-3 h-3" /></button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div
                    className={`${inputCls} cursor-text`}
                    onClick={() => setEditTeamDropOpen(true)}
                  >
                    <input
                      className="w-full text-[12px] outline-none bg-transparent placeholder:text-gray-400"
                      placeholder="Search staff..."
                      value={editTeamSearch}
                      onChange={(e) => { setEditTeamSearch(e.target.value); setEditTeamDropOpen(true); }}
                      onFocus={() => setEditTeamDropOpen(true)}
                    />
                  </div>
                  {editTeamDropOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setEditTeamDropOpen(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-black/10 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {allStaffForPanel
                          .filter((s) => s.id !== editForm.assignedTo && !editForm.teamMembers.includes(s.id) && s.name.toLowerCase().includes(editTeamSearch.toLowerCase()))
                          .map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className="w-full text-left px-3.5 py-2 text-[12px] hover:bg-gray-50 transition-colors text-[#1c1410]"
                              onClick={() => { setEditForm({ ...editForm, teamMembers: [...editForm.teamMembers, s.id] }); setEditTeamSearch(''); }}
                            >
                              {s.name}
                            </button>
                          ))
                        }
                        {allStaffForPanel.filter((s) => s.id !== editForm.assignedTo && !editForm.teamMembers.includes(s.id) && s.name.toLowerCase().includes(editTeamSearch.toLowerCase())).length === 0 && (
                          <p className="px-3.5 py-2 text-[11px] text-[#b09e8d]">No staff available</p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Tags — chips + dropdown */}
                <div className="relative">
                  <label className="text-[11px] text-[#7a6b5c] mb-1.5 block font-medium">Tags</label>
                  {editForm.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {editForm.tags.map((t) => (
                        <span key={t} className={cn('flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold', TAG_COLORS[t] ?? 'bg-gray-100 text-gray-600')}>
                          {t}
                          <button onClick={() => setEditForm({ ...editForm, tags: editForm.tags.filter((x) => x !== t) })}><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    className={`${inputCls} cursor-text`}
                    onClick={() => setEditTagDropOpen(true)}
                  >
                    <input
                      className="w-full text-[12px] outline-none bg-transparent placeholder:text-gray-400"
                      placeholder="Search or type a tag..."
                      value={editForm.tagInput}
                      onChange={(e) => { setEditForm({ ...editForm, tagInput: e.target.value }); setEditTagDropOpen(true); }}
                      onFocus={() => setEditTagDropOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const v = editForm.tagInput.trim();
                          if (v && !editForm.tags.includes(v)) setEditForm({ ...editForm, tags: [...editForm.tags, v], tagInput: '' });
                        }
                      }}
                    />
                  </div>
                  {editTagDropOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setEditTagDropOpen(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-black/10 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {storeTags
                          .filter((t) => t.name.toLowerCase().includes(editForm.tagInput.toLowerCase()))
                          .map((t) => {
                            const selected = editForm.tags.includes(t.name);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                className={`w-full text-left px-3.5 py-2 text-[12px] flex items-center justify-between hover:bg-gray-50 transition-colors ${selected ? 'text-primary font-semibold' : 'text-[#1c1410]'}`}
                                onClick={() => {
                                  setEditForm({ ...editForm, tags: selected ? editForm.tags.filter((x) => x !== t.name) : [...editForm.tags, t.name], tagInput: '' });
                                }}
                              >
                                <span className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color || '#ea580c' }} />
                                  {t.name}
                                </span>
                                {selected && <span className="text-primary">✓</span>}
                              </button>
                            );
                          })
                        }
                        {editForm.tagInput.trim() && !storeTags.some((t) => t.name.toLowerCase() === editForm.tagInput.trim().toLowerCase()) && (
                          <button
                            type="button"
                            className="w-full text-left px-3.5 py-2 text-[12px] text-primary hover:bg-gray-50 transition-colors"
                            onClick={() => { setEditForm({ ...editForm, tags: [...editForm.tags, editForm.tagInput.trim()], tagInput: '' }); }}
                          >
                            + Create "{editForm.tagInput.trim()}"
                          </button>
                        )}
                        {storeTags.filter((t) => t.name.toLowerCase().includes(editForm.tagInput.toLowerCase())).length === 0 && !editForm.tagInput.trim() && (
                          <p className="px-3.5 py-2 text-[11px] text-[#b09e8d]">No tags available</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ═══ ADDITIONAL INFO SECTION ═══ */}
            <AdditionalInfoSection lead={lead} onUpdate={(customFields) => updateLead(lead.id, { customFields })} />

            {/* ═══ FOOTER · Save / Cancel ═══ */}
            <div className="flex gap-2 px-5 py-4 bg-[var(--app-bg)] sticky bottom-0 border-t border-black/5">
              <button
                onClick={() => { setEditMode(false); setEditForm({ firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone, email: lead.email, dealValue: lead.dealValue, source: lead.source, assignedTo: lead.assignedTo ?? '', tags: [...lead.tags], tagInput: '', leadQuality: lead.leadQuality ?? '', teamMembers: [...(lead.teamMembers ?? [])] }); }}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors"
              >Cancel</button>
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 12px rgba(234,88,12,0.25)' }}
              >Save Changes</button>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        {!editMode && (
          <div className="px-5 py-4 border-b border-black/5">
            <h4 className="text-[13px] font-bold text-[#1c1410] mb-3">Quick Actions</h4>
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => setShowPipelineModal(true)}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl border border-black/[0.07] bg-white hover:bg-[#faf0e8] hover:border-primary/30 transition-colors">
                <Layers className="w-4 h-4 text-[#7a6b5c]" />
                <span className="text-[10px] font-medium text-[#7a6b5c]">Pipeline</span>
              </button>

              {/* WhatsApp — dropdown when personal WA is also connected */}
              <div className="relative">
                <button
                  onClick={waPersonalStatus === 'connected' ? () => setShowWaDropdown((v) => !v) : handleWhatsApp}
                  className="w-full flex flex-col items-center gap-1 py-2.5 rounded-xl border border-black/[0.07] bg-white hover:bg-[#faf0e8] hover:border-primary/30 transition-colors">
                  <MessageCircle className="w-4 h-4 text-[#7a6b5c]" />
                  <span className="text-[10px] font-medium text-[#7a6b5c]">WhatsApp</span>
                </button>
                {showWaDropdown && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowWaDropdown(false)} />
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-white border border-black/10 rounded-xl shadow-xl z-40 w-52 py-1">
                      <button onClick={() => { handleWhatsApp(); setShowWaDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--accent-tint)] flex items-center gap-2">
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        Open WhatsApp Business
                      </button>
                      <button onClick={() => { setShowWaDropdown(false); setShowWaSendModal(true); }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--accent-tint)] flex items-center gap-2">
                        <Smartphone className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        Send via Personal WA
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button onClick={() => setShowFuModal(true)}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl border border-black/[0.07] bg-white hover:bg-[#faf0e8] hover:border-primary/30 transition-colors">
                <Clock className="w-4 h-4 text-[#7a6b5c]" />
                <span className="text-[10px] font-medium text-[#7a6b5c]">Follow-up</span>
              </button>
              <button onClick={() => setShowApptModal(true)}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl border border-black/[0.07] bg-white hover:bg-[#faf0e8] hover:border-primary/30 transition-colors">
                <CalendarPlus className="w-4 h-4 text-[#7a6b5c]" />
                <span className="text-[10px] font-medium text-[#7a6b5c]">Appointment</span>
              </button>
            </div>
          </div>
        )}

        {/* Personal WA send modal */}
        {showWaSendModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => { setShowWaSendModal(false); setWaMessage(''); }}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-headline font-bold text-[#1c1410] flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-teal-600" /> Send via Personal WhatsApp
                </h3>
                <button onClick={() => { setShowWaSendModal(false); setWaMessage(''); }} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-[#7a6b5c] mb-3">To: <strong>{lead.phone}</strong></p>
              <textarea
                className="w-full border border-black/10 rounded-xl px-3 py-2 text-sm min-h-[100px] resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/20 mb-4"
                placeholder="Type your message..."
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowWaSendModal(false); setWaMessage(''); }}
                  className="px-4 py-2 text-sm border border-black/10 rounded-xl hover:bg-[var(--accent-tint)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleSendPersonalWa} disabled={!waMessage.trim() || waSending}
                  className="px-4 py-2 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors">
                  {waSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Stage Timeline — manager view only; collapsible (shows time spent in each stage) */}
        {!editMode && isManagerView && (
          <div className="px-5 py-4 border-t border-black/5">
            <button
              onClick={() => { const n = !showStageTl; setShowStageTl(n); if (n) loadStageTl(); }}
              className="w-full flex items-center justify-between text-left"
            >
              <span className="text-[13px] font-bold text-[#1c1410] flex items-center gap-1.5">
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showStageTl ? 'rotate-90' : ''}`} />
                Stage Timeline
              </span>
              <span className="text-[11px] text-[#9e8e7e]">time in each stage</span>
            </button>
            {showStageTl && (
              <div className="mt-3 pl-1">
                {stageTlLoading ? (
                  <p className="text-[12px] text-[#7a6b5c] italic">Loading…</p>
                ) : !stageTl || stageTl.history.length === 0 ? (
                  <p className="text-[12px] text-[#b09e8d] italic">No stage history yet</p>
                ) : (
                  <div className="space-y-2.5">
                    {stageTl.history.map((s: any, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className={cn('w-2.5 h-2.5 rounded-full mt-1 shrink-0', s.is_current ? 'bg-primary ring-2 ring-primary/25' : 'bg-[#cbb9a8]')} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-[#1c1410] truncate">{s.stage_name || 'Unknown stage'}</span>
                            <span className={cn('text-[11px] font-bold shrink-0 px-2 py-0.5 rounded-full',
                              s.duration_ms > 7 * 864e5 ? 'bg-red-50 text-red-600' : s.duration_ms > 3 * 864e5 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>
                              {fmtDur(s.duration_ms)}{s.is_current ? ' · ongoing' : ''}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#9e8e7e]">Entered {format(new Date(s.entered_at), 'dd MMM yyyy, h:mm a')}</span>
                        </div>
                      </div>
                    ))}
                    <div className="pt-1.5 mt-1 border-t border-black/5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#7a6b5c]">Total in pipeline</span>
                      <span className="text-[11px] font-bold text-[#1c1410]">
                        {fmtDur(stageTl.history.reduce((a: number, s: any) => a + s.duration_ms, 0))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Activity Timeline */}
        {!editMode && (
          <div className="px-5 py-4">
            <h4 className="text-[13px] font-bold text-[#1c1410] mb-3">Activity Timeline</h4>
            {timeline.length === 0 ? (
              <p className="text-[12px] text-[#b09e8d] text-center py-4">No activity yet</p>
            ) : (
              <div className="space-y-3">
                {timeline.map((entry) => {
                  const { Icon, bg, color } = iconForType(entry.type);
                  const isNote = entry.type === 'note' && entry.id.startsWith('note-');
                  const noteId = isNote ? entry.id.slice(5) : '';
                  const isFu = entry.type === 'followup' && entry.id.startsWith('fu-');
                  const fuId = isFu ? entry.id.slice(3) : '';
                  const isCall = entry.type === 'call' && !!entry.callLogId;
                  return (
                    <div key={entry.id} className="flex gap-3">
                      <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0', bg, color)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 pt-0.5 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-semibold text-[#1c1410]">{entry.title}</p>
                          {isNote && canEditLead && (
                            <button onClick={() => setEditNote({ id: noteId, title: entry.title === 'Note' ? '' : entry.title, content: entry.detail ?? '' })}
                              className="p-1 rounded text-[#7a6b5c] hover:bg-[var(--accent-tint)] hover:text-primary shrink-0" title="Edit note"><Pencil className="w-3.5 h-3.5" /></button>
                          )}
                          {isFu && canEditLead && (
                            <button onClick={() => { const f = leadFollowUps.find((x) => x.id === fuId); if (f) setEditFu({ id: f.id, title: f.note || '', notes: f.description || '', dueAt: format(new Date(f.dueAt), "yyyy-MM-dd'T'HH:mm") }); }}
                              className="p-1 rounded text-[#7a6b5c] hover:bg-[var(--accent-tint)] hover:text-primary shrink-0" title="Edit follow-up"><Pencil className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                        {entry.detail && <p className="text-[12px] text-[#7a6b5c] mt-0.5 break-words whitespace-pre-wrap">{entry.detail}</p>}
                        {/* Call recording Play/Download */}
                        {isCall && entry.hasRecording && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <button
                              onClick={async () => {
                                const cid = entry.callLogId!;
                                if (playingCallId === cid) { setPlayingCallId(null); return; }
                                if (audioUrls[cid]) { setPlayingCallId(cid); return; }
                                try {
                                  const blob = await fetchBlob(`/api/calls/${cid}/recording`);
                                  const url = URL.createObjectURL(blob);
                                  setAudioUrls((prev) => ({ ...prev, [cid]: url }));
                                  setPlayingCallId(cid);
                                } catch { toast.error('Recording not available'); }
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 text-[11px] font-semibold transition-colors"
                            >
                              {playingCallId === entry.callLogId ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              {playingCallId === entry.callLogId ? 'Stop' : 'Play'}
                            </button>
                            <button
                              onClick={() => downloadBlob(`/api/calls/${entry.callLogId}/download`, `call-recording.mp3`)}
                              className="text-[11px] text-[#7a6b5c] hover:text-primary transition-colors"
                            >Download</button>
                          </div>
                        )}
                        {isCall && playingCallId === entry.callLogId && audioUrls[entry.callLogId!] && (
                          <audio
                            src={audioUrls[entry.callLogId!]}
                            autoPlay
                            controls
                            className="w-full h-8 mt-1.5"
                            onEnded={() => setPlayingCallId(null)}
                          />
                        )}
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-[11px] text-[#b09e8d] flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {timestampLabel(entry.timestamp)}
                          </p>
                          <span className="text-[11px] text-[#7a6b5c] font-medium">
                            ~ {entry.createdBy || 'Automation'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Edit Note — reuses the same modal as Add */}
        {editNote && (
          <FollowUpModal
            leadId={lead.id}
            editItem={{ kind: 'note', id: editNote.id, title: editNote.title, notes: editNote.content }}
            onUpdated={(u) => setLeadNotes((prev) => prev.map((n) => n.id === u.id ? { ...n, title: u.title, content: u.content } : n))}
            onClose={() => setEditNote(null)}
          />
        )}

        {/* Edit Follow-up — reuses the same modal as Add */}
        {editFu && (
          <FollowUpModal
            leadId={lead.id}
            editItem={{ kind: 'followup', id: editFu.id, title: editFu.title, notes: editFu.notes, dueAt: editFu.dueAt }}
            onUpdated={(u) => setLeadFollowUps((prev) => prev.map((f) => f.id === u.id ? { ...f, note: u.title, description: u.description, dueAt: u.dueAt } : f))}
            onClose={() => setEditFu(null)}
          />
        )}


      </div>
    </div>
    </div>
    {showNoteModal && <NoteModal leadId={lead.id} onClose={() => setShowNoteModal(false)} onCreated={(n) => setLeadNotes((prev) => [n, ...prev])} />}
    {showEditFields && (
      <EditFieldsDrawer
        lead={lead}
        onClose={() => setShowEditFields(false)}
        onSaved={(saved) => {
          setFields(saved as any);                    // local — drives the panel display
          updateLead(lead.id, { customFields: saved }); // mirror to store
          setCfStatus('loaded');
          setShowCustomFields(true);
        }}
      />
    )}
    {showPipelineModal && <QuickEditModal lead={lead} onClose={() => setShowPipelineModal(false)} onSaved={(updates) => onLeadUpdated?.(lead.id, updates)} />}
    {showFuModal && <FollowUpModal leadId={lead.id} onClose={() => setShowFuModal(false)}
      onCreated={(fu) => {
        setLeadFollowUps((prev) => [...prev, fu]);
        setTimeout(() => {
          api.get<any[]>(`/api/leads/${lead.id}/activities`).then((data) =>
            setLeadActivities(data.map((a) => ({ id: a.id, leadId: lead.id, type: a.type, title: a.title, detail: a.detail, timestamp: a.timestamp ?? a.created_at, createdBy: a.created_by_name ?? a.created_by })))
          ).catch(() => null);
        }, 400);
      }}
      onNoteCreated={(note) => {
        setLeadNotes((prev) => [note, ...prev]);
        setTimeout(() => {
          api.get<any[]>(`/api/leads/${lead.id}/activities`).then((data) =>
            setLeadActivities(data.map((a) => ({ id: a.id, leadId: lead.id, type: a.type, title: a.title, detail: a.detail, timestamp: a.timestamp ?? a.created_at, createdBy: a.created_by_name ?? a.created_by })))
          ).catch(() => null);
        }, 400);
      }}
    />}
    {showApptModal && <AppointmentModal lead={lead} onClose={() => setShowApptModal(false)} onBooked={() => {
      setTimeout(() => {
        api.get<any[]>(`/api/leads/${lead.id}/activities`).then((data) =>
          setLeadActivities(data.map((a) => ({ id: a.id, leadId: lead.id, type: a.type, title: a.title, detail: a.detail, timestamp: a.created_at, createdBy: a.created_by_name ?? a.created_by })))
        ).catch(() => null);
      }, 500);
    }} />}
    </>
  );
}

// ─── Kanban Card ───────────────────────────────────────────────────────────────
// ─── Quick Edit Modal ──────────────────────────────────────────────────────────
function QuickEditModal({ lead, onClose, onSaved }: {
  lead: Lead;
  onClose: () => void;
  onSaved?: (updates: { pipelineId: string; stage: string; stageId: string | undefined; tags: string[] }) => void;
}) {
  const { updateLead, moveLeadStage, pipelines, tags: storeTags } = useCrmStore();
  const [pipelineId, setPipelineId] = useState(lead.pipelineId);
  const [stage, setStage] = useState(lead.stage);
  const [tags, setTags] = useState<string[]>([...lead.tags]);
  const [tagInput, setTagInput] = useState('');

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);
  const stageOptions = selectedPipeline?.stages.map((s) => s.name) ?? [];

  const addTag = (t: string) => {
    const val = t.trim();
    if (val && !tags.includes(val)) setTags([...tags, val]);
    setTagInput('');
  };

  const handleSave = async () => {
    const stageId = selectedPipeline?.stages.find((s) => s.name === stage)?.id;
    try {
      await api.patch(`/api/leads/${lead.id}`, {
        pipeline_id: pipelineId || undefined,
        stage_id: stageId || undefined,
        tags,
      });
    } catch { /* best-effort */ }
    updateLead(lead.id, { pipelineId, stage, stageId, tags });
    if (stage !== lead.stage) moveLeadStage(lead.id, stage, stageId);
    onSaved?.({ pipelineId, stage, stageId, tags });
    toast.success('Lead updated');
    onClose();
  };

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 transition-colors bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col" style={{ boxShadow: '0 25px 80px rgba(0,0,0,0.18)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <div>
            <p className="text-[11px] text-[#b09e8d]">Pipeline / Stage / Tags</p>
            <h3 className="font-bold text-[15px] text-[#1c1410]">{lead.firstName} {lead.lastName}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Pipeline */}
          <div>
            <label className="text-[12px] text-[#7a6b5c] mb-1.5 block font-semibold">Pipeline</label>
            <select className={inputCls} value={pipelineId} onChange={(e) => { setPipelineId(e.target.value); setStage(''); }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Stage */}
          <div>
            <label className="text-[12px] text-[#7a6b5c] mb-1.5 block font-semibold">Stage</label>
            <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">Select stage</option>
              {stageOptions.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="text-[12px] text-[#7a6b5c] mb-1.5 block font-semibold">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 bg-primary/10 text-primary text-[11px] font-semibold px-2.5 py-1 rounded-full">
                  {t}
                  <button onClick={() => setTags(tags.filter((x) => x !== t))}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {tags.length === 0 && <span className="text-[12px] text-[#c4b09e]">No tags</span>}
            </div>
            <div className="flex gap-2">
              <input
                className={inputCls + ' flex-1'}
                placeholder="Add tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag(tagInput)}
                list="tag-suggestions"
              />
              <datalist id="tag-suggestions">
                {storeTags.map((t) => <option key={t.id} value={t.name} />)}
              </datalist>
              <button onClick={() => addTag(tagInput)} disabled={!tagInput.trim()} className="px-3 py-2 rounded-xl bg-primary/10 text-primary text-[12px] font-semibold hover:bg-primary/20 transition-colors disabled:opacity-40">
                Add
              </button>
            </div>
          </div>

          {/* Created date — read only */}
          <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-[var(--app-bg)] border border-black/5">
            <span className="text-[12px] font-semibold text-[#7a6b5c]">Created</span>
            <span className="text-[12px] font-bold text-[#1c1410]">
              {new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">Cancel</button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
            Update
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Appointment Modal ─────────────────────────────────────────────────────────
const SHORT_DAYS_APPT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function genSlots(schedule: Record<string, { enabled: boolean; slots: { start: string; end: string }[] }>, date: string, duration: number): string[] {
  const dayName = SHORT_DAYS_APPT[new Date(date + 'T12:00:00').getDay()];
  const day = schedule[dayName];
  if (!day?.enabled) return [];
  const result: string[] = [];
  for (const w of day.slots) {
    let [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    const endMins = eh * 60 + em;
    while (sh * 60 + sm + duration <= endMins) {
      const hh = sh % 12 === 0 ? 12 : sh % 12;
      const ampm = sh < 12 ? 'AM' : 'PM';
      result.push(`${String(hh).padStart(2,'0')}:${String(sm).padStart(2,'0')} ${ampm}`);
      const total = sh * 60 + sm + duration;
      sh = Math.floor(total / 60); sm = total % 60;
    }
  }
  return result;
}

function AppointmentModal({ lead, onClose, onBooked }: { lead: Lead; onClose: () => void; onBooked?: () => void }) {
  const { addCalendarEvent, bookingLinks } = useCrmStore();
  const [form, setForm] = useState({
    event: '', locationValue: '', date: '', tz: 'Asia/Kolkata', slot: '',
  });

  const selectedET = bookingLinks.find((b) => b.id === form.event) as any | undefined;
  const location   = selectedET?.meetingType ?? '';
  const slots      = selectedET && form.date ? genSlots(selectedET.schedule ?? {}, form.date, selectedET.duration ?? 30) : [];

  const handleSelectEvent = (id: string) => {
    const et = bookingLinks.find((b) => b.id === id) as any | undefined;
    setForm((f) => ({ ...f, event: id, locationValue: et?.meetingLink ?? '', slot: '' }));
  };

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 transition-colors bg-white';
  const lbl = (text: string, required = true) => (
    <label className="text-[12px] font-semibold text-[#1c1410] mb-1.5 block">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );

  const handleBook = async () => {
    if (!form.event || !form.date || !form.slot) {
      toast.error('Please select a calendar, date and timeslot'); return;
    }
    const bookingName = selectedET?.name ?? 'Appointment';
    const slotParts = form.slot.split(' ');
    const [hhStr, mmStr] = slotParts[0].split(':');
    let hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr, 10);
    if (slotParts[1] === 'PM' && hh !== 12) hh += 12;
    else if (slotParts[1] === 'AM' && hh === 12) hh = 0;
    const time24 = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const startIso = `${form.date}T${time24}:00`;
    const endDate = new Date(startIso);
    endDate.setMinutes(endDate.getMinutes() + (selectedET?.duration ?? 30));
    try {
      const created = await api.post<any>('/api/calendar', {
        title: `${bookingName} - ${lead.firstName} ${lead.lastName}`,
        type: selectedET?.eventType ?? 'meeting',
        start_time: startIso,
        end_time: endDate.toISOString(),
        lead_id: lead.id,
        assigned_to: lead.assignedTo || undefined,
        event_type_id: form.event,
        meeting_link: form.locationValue || undefined,
      });
      addCalendarEvent({
        id: created.id,
        title: `${bookingName} - ${lead.firstName} ${lead.lastName}`,
        type: (selectedET?.eventType as 'meeting' | 'demo' | 'call') ?? 'meeting',
        date: form.date, time: time24, duration: selectedET?.duration ?? 30,
        leadName: `${lead.firstName} ${lead.lastName}`, status: 'scheduled',
      });
      toast.success('Appointment booked');
      onClose();
      onBooked?.();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to book appointment');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ boxShadow: '0 25px 80px rgba(0,0,0,0.18)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5">
          <h3 className="font-bold text-[17px] text-[#1c1410]">Appointment Booking</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Lead name — read only */}
          <input
            className="w-full border border-gray-100 rounded-lg px-3 py-2.5 text-[13px] text-[#7a6b5c] bg-gray-50 outline-none cursor-default"
            value={`${lead.firstName} ${lead.lastName}`}
            readOnly
          />

          {/* Calendar Event */}
          <div>
            {lbl('Calendar Event')}
            <select className={inputCls} value={form.event} onChange={(e) => handleSelectEvent(e.target.value)}>
              <option value="">Select Event</option>
              {bookingLinks.filter((b) => (b as any).isActive !== false).map((b) => (
                <option key={b.id} value={b.id}>{(b as any).name ?? b.title}</option>
              ))}
            </select>
          </div>

          {/* Location — auto-filled from calendar, editable */}
          {form.event && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                {lbl('Meeting Type', false)}
                <input
                  className="w-full border border-gray-100 rounded-lg px-3 py-2.5 text-[13px] text-[#7a6b5c] bg-gray-50 outline-none cursor-default"
                  value={location || '-'}
                  readOnly
                />
              </div>
              <div>
                {lbl('Meeting Link / Address', false)}
                <input
                  className={inputCls}
                  placeholder="Meeting link or address"
                  value={form.locationValue}
                  onChange={(e) => setForm({ ...form, locationValue: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* Event Date + Timezone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              {lbl('Event Date')}
              <input
                className={inputCls}
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value, slot: '' })}
              />
            </div>
            <div>
              {lbl('Timezone', false)}
              <select className={inputCls} value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })}>
                <option value="Asia/Kolkata">Asia/Kolkata</option>
                <option value="Asia/Dubai">Asia/Dubai</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
                <option value="Europe/London">Europe/London</option>
              </select>
            </div>
          </div>

          {/* Timeslots — from calendar schedule */}
          <div>
            {lbl('Timeslot')}
            <select
              className={inputCls}
              value={form.slot}
              onChange={(e) => setForm({ ...form, slot: e.target.value })}
              disabled={!form.event || !form.date}
            >
              <option value="">
                {!form.event ? 'Select a calendar first' : !form.date ? 'Select a date first' : slots.length === 0 ? 'No slots available this day' : 'Pick a timeslot'}
              </option>
              {slots.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 pb-6">
          <button
            onClick={handleBook}
            className="px-8 py-2.5 rounded-lg text-[13px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}
          >
            Book Appointment
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Kanban Card ───────────────────────────────────────────────────────────────
function LeadCard({ lead, onClick, onFollowUp, onNote, onAssign, showPhone, highlighted, canAssign = true }: { lead: Lead; onClick: () => void; onFollowUp: () => void; onNote: () => void; onAssign: () => void; showPhone: boolean; highlighted?: boolean; canAssign?: boolean }) {
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } = useSortable({ id: lead.id });
  const cardRef = useRef<HTMLDivElement>(null);
  const stopAnd = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  const { staff: allStaff, followUps } = useCrmStore();

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);
  const assignedStaff = allStaff.find((s) => s.id === lead.assignedTo);
  const assignedCardName = assignedStaff?.name || lead.assignedName || '';
  const assignedCardAvatar = assignedStaff?.avatar || assignedCardName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '';
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [showAppointment, setShowAppointment] = useState(false);
  const [showCardMenu, setShowCardMenu] = useState(false);

  const initials = `${lead.firstName[0] ?? ''}${lead.lastName[0] ?? ''}`.toUpperCase() || '?';
  const bgPalette = ['#f5ede3','#dbeafe','#dcfce7','#ede9fe','#fce7f3','#fef9c3'];
  const fgPalette = ['#c2410c','#1d4ed8','#15803d','#7c3aed','#be185d','#a16207'];
  const ci = (lead.firstName.charCodeAt(0) ?? 0) % bgPalette.length;

  // ── Follow-up & days calculations ──
  const now = new Date();
  const leadFUs = followUps.filter((f) => f.leadId === lead.id);
  const lastFU = leadFUs
    .filter((f) => new Date(f.dueAt) <= now)
    .sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime())[0] ?? null;
  const nextFU = leadFUs
    .filter((f) => !f.completed && new Date(f.dueAt) > now)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null;
  const created = new Date(lead.createdAt);
  const daysInPipeline = Math.max(0, Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
     Date.UTC(created.getFullYear(), created.getMonth(), created.getDate())) / (1000 * 60 * 60 * 24)
  ));
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    const diffDays = Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    if (diffDays === 0) return `${dateStr} (today)`;
    if (diffDays > 0) return `${dateStr} (${diffDays}d ago)`;
    return `${dateStr} (in ${Math.abs(diffDays)}d)`;
  };
  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' +
      d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  };
  const fmtFUDateTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const base = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' +
      d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    const diffMs = d.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return `${base} (today)`;
    if (diffDays > 0) return `${base} (in ${diffDays}d)`;
    return `${base} (${Math.abs(diffDays)}d ago)`;
  };
  const daysBg = daysInPipeline <= 2 ? 'bg-emerald-50 text-emerald-700' : daysInPipeline <= 7 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600';

  // Follow-up urgency detection
  const hasOverdueFU = leadFUs.some((f) => !f.completed && new Date(f.dueAt) < now);
  const hasTodayFU = !hasOverdueFU && leadFUs.some((f) => {
    if (f.completed) return false;
    const d = new Date(f.dueAt);
    return d.toDateString() === now.toDateString();
  });
  const fuUrgency: 'overdue' | 'today' | null = hasOverdueFU ? 'overdue' : hasTodayFU ? 'today' : null;

  return (<>
    <div
      ref={(el) => { setSortableRef(el); (cardRef as any).current = el; }}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.25 : 1 }}
      className={cn(
        'group bg-white rounded-xl border shadow-sm hover:shadow-md transition-all duration-150 cursor-grab active:cursor-grabbing',
        highlighted ? 'border-primary ring-2 ring-primary/30 bg-primary/[0.02]'
          : fuUrgency === 'overdue' ? 'border-l-[3px] border-l-red-500 border-t-gray-100 border-r-gray-100 border-b-gray-100 bg-[#fff5f5]'
          : fuUrgency === 'today' ? 'border-l-[3px] border-l-amber-500 border-t-gray-100 border-r-gray-100 border-b-gray-100 bg-[#fffbeb]'
          : 'border-gray-100',
      )}
      onClick={onClick}
    >
      <div className="p-2.5">
        {/* Row 1: avatar + name/phone (left) | staff avatar + 3-dot menu (right) */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
              style={{ background: bgPalette[ci], color: fgPalette[ci] }}>
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#1c1410] truncate leading-tight">
                {lead.firstName} {lead.lastName}
              </p>
              <p className="text-[11px] text-[#7a6b5c] truncate">
                {showPhone ? lead.phone : lead.phone.replace(/\d(?=\d{4})/g, '*')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {assignedCardName && (
              <div title={`Assigned: ${assignedCardName}`}
                className="w-5 h-5 rounded-full bg-[var(--accent-tint)] flex items-center justify-center text-[9px] font-bold text-primary">
                {assignedCardAvatar}
              </div>
            )}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowCardMenu((v) => !v)}
                className="w-6 h-6 rounded-md flex items-center justify-center text-[#1c1410] hover:bg-orange-50 hover:text-primary transition-colors">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {showCardMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowCardMenu(false)} />
                  <div className="absolute right-0 top-7 z-40 w-44 bg-white rounded-xl border border-black/5 shadow-xl overflow-hidden py-1">
                    <button onClick={() => { setShowCardMenu(false); setShowQuickEdit(true); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                      <Pencil className="w-3 h-3 text-[#7a6b5c]" /> Edit
                    </button>
                    <button onClick={() => { setShowCardMenu(false); onFollowUp(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                      <CheckSquare className="w-3 h-3 text-[#7a6b5c]" /> Follow-up
                    </button>
                    <button onClick={() => { setShowCardMenu(false); setShowAppointment(true); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                      <CalendarPlus className="w-3 h-3 text-[#7a6b5c]" /> Book Appointment
                    </button>
                    {!assignedCardName && canAssign && (
                      <button onClick={() => { setShowCardMenu(false); onAssign(); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                        <User className="w-3 h-3 text-[#7a6b5c]" /> Assign
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Quality badge */}
        {lead.leadQuality && (
          <div className="mt-1.5">
            <span className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
              lead.leadQuality === 'Hot' ? 'bg-red-100 text-red-700' :
              lead.leadQuality === 'Warm' ? 'bg-amber-100 text-amber-700' :
              lead.leadQuality === 'Cold' ? 'bg-blue-100 text-blue-700' :
              lead.leadQuality === 'Unqualified' ? 'bg-gray-100 text-gray-500' :
              'bg-emerald-100 text-emerald-700'
            }`}>
              {lead.leadQuality}
            </span>
          </div>
        )}

        {/* Row 2 — Created/Updated (left) · Last/Next follow-up (right) — sleek, not bold */}
        <div className="flex items-start justify-between gap-3 mt-2 pt-2 border-t border-black/[0.05]">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] font-medium text-[#b0a294] uppercase tracking-wide leading-none mb-0.5">Created</span>
              <span className="text-[11px] font-medium text-[#5c5245] truncate">{fmtDateTime(lead.createdAt)}</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] font-medium text-[#b0a294] uppercase tracking-wide leading-none mb-0.5">Updated</span>
              <span className="text-[11px] font-medium text-[#5c5245] truncate">{fmtDateTime(lead.lastActivity)}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1 min-w-0 items-end text-right">
            <div className="flex flex-col min-w-0 items-end">
              <span className={cn("text-[9px] font-medium uppercase tracking-wide leading-none mb-0.5",
                hasOverdueFU && lastFU && !lastFU.completed ? 'text-red-500' : 'text-[#b0a294]')}>Last Follow</span>
              <span className={cn("text-[11px] font-medium truncate",
                lastFU && !lastFU.completed && new Date(lastFU.dueAt) < now ? 'text-red-600 font-semibold' : 'text-[#5c5245]')}>
                {lastFU ? fmtFUDateTime(lastFU.dueAt) : <span className="text-[#c4b09e]">-</span>}
              </span>
            </div>
            <div className="flex flex-col min-w-0 items-end">
              <span className={cn("text-[9px] font-medium uppercase tracking-wide leading-none mb-0.5",
                fuUrgency === 'today' ? 'text-amber-600' : 'text-[#b0a294]')}>Next Follow</span>
              <span className={cn("text-[11px] font-medium truncate",
                nextFU && new Date(nextFU.dueAt).toDateString() === now.toDateString() ? 'text-amber-600 font-semibold' : 'text-[#5c5245]')}>
                {nextFU ? fmtFUDateTime(nextFU.dueAt) : <span className="text-[#c4b09e]">-</span>}
              </span>
            </div>
          </div>
        </div>

      </div>

    </div>

    {showQuickEdit && <QuickEditModal lead={lead} onClose={() => setShowQuickEdit(false)} />}
    {showAppointment && <AppointmentModal lead={lead} onClose={() => setShowAppointment(false)} />}
  </>);
}

// ─── Mobile Lead Card ───────────────────────────────────────────────────────────
// Full-width, touch-first card used on phones. No drag — tap to open, menu to act.
function MobileLeadCard({ lead, stages, accent, showPhone, onClick, onEdit, onFollowUp, onAppointment, onAssign, onMove, selectionMode, selected, onToggleSelect, onEnterSelect, canAssign = true }: {
  lead: Lead; stages: string[]; accent: string; showPhone: boolean;
  onClick: () => void; onEdit: () => void; onFollowUp: () => void;
  onAppointment: () => void; onAssign: () => void; onMove: (stage: string) => void;
  selectionMode?: boolean; selected?: boolean; onToggleSelect?: () => void; onEnterSelect?: () => void; canAssign?: boolean;
}) {
  const { staff: allStaff, followUps } = useCrmStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired = useRef(false);

  // Long-press (≈450ms) enters multi-select mode and selects this lead.
  const startLongPress = () => {
    if (selectionMode) return;
    lpFired.current = false;
    lpTimer.current = setTimeout(() => { lpFired.current = true; onEnterSelect?.(); }, 450);
  };
  const cancelLongPress = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };

  const assignedStaff = allStaff.find((s) => s.id === lead.assignedTo);
  const assignedName = assignedStaff?.name || lead.assignedName || '';
  const assignedAvatar = assignedStaff?.avatar || assignedName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const initials = `${lead.firstName[0] ?? ''}${lead.lastName[0] ?? ''}`.toUpperCase() || '?';
  const bgPalette = ['#f5ede3', '#dbeafe', '#dcfce7', '#ede9fe', '#fce7f3', '#fef9c3'];
  const fgPalette = ['#c2410c', '#1d4ed8', '#15803d', '#7c3aed', '#be185d', '#a16207'];
  const ci = (lead.firstName.charCodeAt(0) ?? 0) % bgPalette.length;

  const now = new Date();
  const leadFUs = followUps.filter((f) => f.leadId === lead.id);
  const lastFU = leadFUs.filter((f) => new Date(f.dueAt) <= now).sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime())[0] ?? null;
  const nextFU = leadFUs.filter((f) => !f.completed && new Date(f.dueAt) > now).sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null;
  const created = new Date(lead.createdAt);
  const daysInPipeline = Math.max(0, Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
     Date.UTC(created.getFullYear(), created.getMonth(), created.getDate())) / (1000 * 60 * 60 * 24)
  ));
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    const diff = Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    const ds = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    if (diff === 0) return `${ds} · today`;
    if (diff > 0) return `${ds} · ${diff}d ago`;
    return `${ds} · in ${Math.abs(diff)}d`;
  };
  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' +
      d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  };
  const fmtFUDateTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const base = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' +
      d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    const diffMs = d.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return `${base} (today)`;
    if (diffDays > 0) return `${base} (in ${diffDays}d)`;
    return `${base} (${Math.abs(diffDays)}d ago)`;
  };
  const ageColor = daysInPipeline <= 2 ? 'text-emerald-600' : daysInPipeline <= 7 ? 'text-amber-600' : 'text-red-500';
  const phoneShown = showPhone ? lead.phone : lead.phone.replace(/\d(?=\d{4})/g, '*');

  const hasOverdueFU = leadFUs.some((f) => !f.completed && new Date(f.dueAt) < now);
  const hasTodayFU = !hasOverdueFU && leadFUs.some((f) => {
    if (f.completed) return false;
    const d = new Date(f.dueAt);
    return d.toDateString() === now.toDateString();
  });
  const fuUrgency: 'overdue' | 'today' | null = hasOverdueFU ? 'overdue' : hasTodayFU ? 'today' : null;

  const act = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(false); setMoveOpen(false); fn(); };

  return (
    <div
      onClick={() => { if (lpFired.current) { lpFired.current = false; return; } if (selectionMode) { onToggleSelect?.(); } else { onClick(); } }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerMove={cancelLongPress}
      className={cn('relative rounded-2xl border shadow-sm active:bg-[#fcfaf8] transition-colors',
        selected ? 'border-primary ring-2 ring-primary/30'
          : 'border-black/[0.06] bg-white')}
    >
      {/* accent edge */}
      <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full" style={{ background: fuUrgency === 'overdue' ? '#ef4444' : fuUrgency === 'today' ? '#f59e0b' : accent }} />

      <div className="pl-4 pr-2.5 py-3">
        {/* Row 1 — identity + menu */}
        <div className="flex items-start gap-3">
          {selectionMode ? (
            <div className={cn('w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
              selected ? 'bg-primary border-primary text-white' : 'border-black/20 text-transparent')}>
              <Check className="w-5 h-5" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold shrink-0"
              style={{ background: bgPalette[ci], color: fgPalette[ci] }}>
              {initials}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-bold text-[#1c1410] truncate leading-tight">{lead.firstName} {lead.lastName}</p>
              {lead.leadQuality && (
                <span className={cn('shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                  lead.leadQuality === 'Hot' ? 'bg-red-100 text-red-700' :
                  lead.leadQuality === 'Warm' ? 'bg-amber-100 text-amber-700' :
                  lead.leadQuality === 'Cold' ? 'bg-blue-100 text-blue-700' :
                  lead.leadQuality === 'Unqualified' ? 'bg-gray-100 text-gray-500' : 'bg-emerald-100 text-emerald-700'
                )}>{lead.leadQuality}</span>
              )}
            </div>
            <a href={`tel:${lead.phone}`} onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 mt-0.5 text-[13px] font-semibold text-primary">
              <Phone className="w-3 h-3" /> {phoneShown}
            </a>
          </div>

          <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Lead actions" onClick={() => { setMenuOpen((v) => !v); setMoveOpen(false); }}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[#7a6b5c] active:bg-orange-50 active:text-primary">
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setMenuOpen(false); setMoveOpen(false); }} />
                <div className="absolute right-0 top-10 z-50 w-52 bg-white rounded-2xl border border-black/5 shadow-xl overflow-hidden py-1">
                  {!moveOpen ? (
                    <>
                      {onEnterSelect && <button onClick={act(() => onEnterSelect())} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] active:bg-[#faf0e8]"><CheckSquare className="w-4 h-4 text-[#7a6b5c]" /> Select</button>}
                      <button onClick={act(onEdit)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] active:bg-[#faf0e8]"><Pencil className="w-4 h-4 text-[#7a6b5c]" /> Edit</button>
                      <button onClick={act(onFollowUp)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] active:bg-[#faf0e8]"><CheckSquare className="w-4 h-4 text-[#7a6b5c]" /> Add Follow-up</button>
                      <button onClick={act(onAppointment)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] active:bg-[#faf0e8]"><CalendarPlus className="w-4 h-4 text-[#7a6b5c]" /> Book Appointment</button>
                      <button onClick={(e) => { e.stopPropagation(); setMoveOpen(true); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] active:bg-[#faf0e8]"><ArrowLeftRight className="w-4 h-4 text-[#7a6b5c]" /> Move to stage <ChevronRight className="w-3.5 h-3.5 ml-auto text-[#b09e8d]" /></button>
                      {!assignedName && canAssign && (
                        <button onClick={act(onAssign)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] active:bg-[#faf0e8]"><User className="w-4 h-4 text-[#7a6b5c]" /> Assign</button>
                      )}
                    </>
                  ) : (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); setMoveOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-[#7a6b5c] border-b border-black/5"><ArrowLeft className="w-3.5 h-3.5" /> Move to…</button>
                      <div className="max-h-56 overflow-y-auto">
                        {stages.filter((s) => s !== lead.stage).map((s) => (
                          <button key={s} onClick={act(() => onMove(s))} className="w-full text-left px-4 py-2.5 text-[13px] text-[#1c1410] active:bg-[#faf0e8] truncate">{s}</button>
                        ))}
                        {stages.filter((s) => s !== lead.stage).length === 0 && <p className="px-4 py-3 text-[12px] text-[#b09e8d]">No other stages</p>}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Row 2 — meta line: age + assignee */}
        <div className="flex items-center gap-2 flex-wrap mt-2.5 pl-[52px]">
          <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', ageColor)}>
            <Clock className="w-3 h-3" /> {daysInPipeline}d
          </span>
          {assignedName && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7a6b5c]">
              <span className="w-4 h-4 rounded-full bg-[var(--accent-tint)] flex items-center justify-center text-[8px] font-bold text-primary">{assignedAvatar}</span>
              {assignedName.split(' ')[0]}
            </span>
          )}
        </div>

        {/* Row 3 — Created/Updated (left) · Last/Next follow-up (right) — sleek, not bold */}
        <div className="flex items-start justify-between gap-3 mt-2.5 pt-2.5 pl-[52px] border-t border-black/[0.05]">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] font-medium text-[#b0a294] uppercase tracking-wide leading-none mb-0.5">Created</span>
              <span className="text-[11px] font-medium text-[#5c5245] truncate">{fmtDateTime(lead.createdAt)}</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] font-medium text-[#b0a294] uppercase tracking-wide leading-none mb-0.5">Updated</span>
              <span className="text-[11px] font-medium text-[#5c5245] truncate">{fmtDateTime(lead.lastActivity)}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1 min-w-0 items-end text-right">
            <div className="flex flex-col min-w-0 items-end">
              <span className={cn("text-[9px] font-medium uppercase tracking-wide leading-none mb-0.5",
                hasOverdueFU && lastFU && !lastFU.completed ? 'text-red-500' : 'text-[#b0a294]')}>Last Follow</span>
              <span className={cn("text-[11px] font-medium truncate",
                lastFU && !lastFU.completed && new Date(lastFU.dueAt) < now ? 'text-red-600 font-semibold' : 'text-[#5c5245]')}>
                {lastFU ? fmtFUDateTime(lastFU.dueAt) : <span className="text-[#c4b09e]">-</span>}
              </span>
            </div>
            <div className="flex flex-col min-w-0 items-end">
              <span className={cn("text-[9px] font-medium uppercase tracking-wide leading-none mb-0.5",
                fuUrgency === 'today' ? 'text-amber-600' : 'text-[#b0a294]')}>Next Follow</span>
              <span className={cn("text-[11px] font-medium truncate",
                nextFU && new Date(nextFU.dueAt).toDateString() === now.toDateString() ? 'text-amber-600 font-semibold' : 'text-[#5c5245]')}>
                {nextFU ? fmtFUDateTime(nextFU.dueAt) : <span className="text-[#c4b09e]">-</span>}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stage Column ──────────────────────────────────────────────────────────────
const STAGE_ACCENT_COLORS = [
  '#ea580c', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#f43f5e', '#06b6d4', '#84cc16', '#ec4899', '#0ea5e9',
];

function StageColumn({ stage, leads: stageLeads, onLeadClick, onFollowUp, onNote, onAssign, showPhone, stageIndex, highlightId, canAssign = true }: {
  stage: string; leads: Lead[]; onLeadClick: (l: Lead) => void;
  onFollowUp: (l: Lead) => void; onNote: (l: Lead) => void; onAssign: (l: Lead) => void;
  showPhone: boolean; stageIndex: number; highlightId?: string | null; canAssign?: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: stage });
  // First stage uses the tenant's brand color; remaining stages use the distinct palette
  const accent  = (stageIndex % STAGE_ACCENT_COLORS.length) === 0
    ? brandHex()
    : STAGE_ACCENT_COLORS[stageIndex % STAGE_ACCENT_COLORS.length];
  const isEmpty = stageLeads.length === 0;

  return (
    <div
      className="min-w-[280px] w-[280px] flex-shrink-0 flex flex-col self-stretch rounded-2xl overflow-hidden border"
      style={{ background: isEmpty ? '#f8f6f3' : '#f2efeb', borderColor: 'rgba(0,0,0,0.07)' }}
    >
      {/* Colored top accent strip */}
      <div className="h-[3px] shrink-0" style={{ background: accent }} />

      {/* Column header */}
      <div className="px-4 pt-3 pb-2.5 flex items-center justify-between shrink-0 border-b border-black/[0.06]">
        <h3 className="text-[13px] font-bold text-[#1c1410] truncate leading-tight">{stage}</h3>
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white shrink-0 ml-2 tabular-nums"
          style={{ background: accent }}
        >
          {stageLeads.length}
        </span>
      </div>

      {/* Drop zone + cards */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/20 [&::-webkit-scrollbar-track]:bg-transparent',
          isEmpty ? 'flex flex-col items-center justify-center' : 'space-y-2.5'
        )}
      >
        <SortableContext items={stageLeads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {stageLeads.map((lead) => (
            <LeadCard key={lead.id} lead={lead}
              onClick={() => onLeadClick(lead)}
              onFollowUp={() => onFollowUp(lead)}
              onNote={() => onNote(lead)}
              onAssign={() => onAssign(lead)}
              canAssign={canAssign}
              showPhone={showPhone}
              highlighted={highlightId === lead.id}
            />
          ))}
        </SortableContext>
        {isEmpty && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 w-full">
            <div
              className="w-10 h-10 rounded-xl border-2 border-dashed flex items-center justify-center"
              style={{ borderColor: accent + '50' }}
            >
              <User className="w-4 h-4" style={{ color: accent + '90' }} />
            </div>
            <p className="text-[11px] font-semibold text-[#c4b09e]">No leads</p>
            <p className="text-[10px] text-[#d4c4b4]">Drag here to move</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── New Pipeline Modal ────────────────────────────────────────────────────────
// ─── Sortable Stage Row ────────────────────────────────────────────────────────
function SortableStageRow({
  stage, index, total,
  onRename, onRemove,
}: {
  stage: { id: string; name: string };
  index: number;
  total: number;
  onRename: (id: string, val: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={cn(
        'flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-white transition-shadow',
        isDragging ? 'shadow-lg border-primary/30' : 'border-gray-100 hover:border-gray-200'
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 text-gray-300 hover:text-gray-500 transition-colors shrink-0 touch-none"
        tabIndex={-1}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Index */}
      <span className="text-[11px] text-[#b09e8d] w-5 shrink-0 select-none">{index + 1}.</span>

      {/* Stage name input */}
      <input
        className="flex-1 text-[13px] text-[#1c1410] outline-none bg-transparent placeholder:text-gray-300"
        value={stage.name}
        onChange={(e) => onRename(stage.id, e.target.value)}
        placeholder="Stage name"
      />

      {/* Remove */}
      <button
        onClick={() => onRemove(stage.id)}
        disabled={total <= 1}
        className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── New Pipeline Modal ────────────────────────────────────────────────────────
function NewPipelineModal({ onClose }: { onClose: () => void }) {
  const { addPipeline, pipelines } = useCrmStore();
  const [name, setName] = useState('');
  const ts = Date.now();
  const [stages, setStages] = useState([
    { id: `s1-${ts}`, name: 'New Lead' },
    { id: `s2-${ts}`, name: 'Contacted' },
    { id: `s3-${ts}`, name: 'Qualified' },
  ]);
  const [stageInput, setStageInput] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = stages.findIndex((s) => s.id === active.id);
    const newIdx = stages.findIndex((s) => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = [...stages];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved);
    setStages(next);
  };

  const addStage = () => {
    const n = stageInput.trim();
    if (!n) return;
    setStages([...stages, { id: `s${Date.now()}`, name: n }]);
    setStageInput('');
  };

  const removeStage = (id: string) => setStages(stages.filter((s) => s.id !== id));
  const renameStage = (id: string, val: string) =>
    setStages(stages.map((s) => (s.id === id ? { ...s, name: val } : s)));

  const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#3b82f6', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899'];

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Pipeline name is required'); return; }
    if (stages.length === 0) { toast.error('Add at least one stage'); return; }
    if (pipelines.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) {
      toast.error('A pipeline with this name already exists'); return;
    }
    try {
      const stagesWithColor = stages.map((s, i) => ({ ...s, color: COLORS[i % COLORS.length] }));
      await addPipeline({ id: '', name: name.trim(), stages: stagesWithColor });
      toast.success(`Pipeline "${name.trim()}" created`);
      onClose();
    } catch {
      toast.error('Failed to create pipeline. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col" style={{ boxShadow: '0 25px 80px rgba(0,0,0,0.18)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <p className="text-[11px] text-gray-400 mb-0.5">Lead Management</p>
            <h3 className="text-[16px] font-bold text-[#1c1410]">Create New Pipeline</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[60vh]">

          {/* Pipeline Name */}
          <div>
            <label className="text-[12px] text-[#7a6b5c] mb-1.5 block">
              Pipeline Name <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] text-[#1c1410] outline-none focus:border-primary/50 transition-colors"
              placeholder="e.g. Sales Pipeline, Support Pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>

          {/* Stages */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] text-[#7a6b5c]">
                Stages <span className="text-[11px] text-gray-400">({stages.length})</span>
              </label>
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <GripVertical className="w-3 h-3" /> drag to reorder
              </span>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
              <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5 mb-3">
                  {stages.map((stage, idx) => (
                    <SortableStageRow
                      key={stage.id}
                      stage={stage}
                      index={idx}
                      total={stages.length}
                      onRename={renameStage}
                      onRemove={removeStage}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Add stage input */}
            <div className="flex items-center gap-2 mt-1">
              <input
                className="flex-1 border border-dashed border-gray-300 rounded-xl px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/50 transition-colors placeholder:text-gray-400 bg-gray-50"
                placeholder="+ Type a stage name and press Enter"
                value={stageInput}
                onChange={(e) => setStageInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addStage()}
              />
              <button
                onClick={addStage}
                disabled={!stageInput.trim()}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40 transition-all hover:-translate-y-0.5 shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 100%)' }}
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}
          >
            Create Pipeline
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Query Builder Helpers (S2.3.1 / S2.3.3) ──────────────────────────────────
function dateRangeToIso(range: string): { date_from?: string; date_to?: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const iso = (d: Date) => d.toISOString();
  switch (range) {
    case 'Today':      return { date_from: iso(today) };
    case 'Yesterday': { const y = new Date(today); y.setDate(y.getDate() - 1); return { date_from: iso(y), date_to: iso(today) }; }
    case 'This Week':  { const w = new Date(today); w.setDate(w.getDate() - w.getDay()); return { date_from: iso(w) }; }
    case 'Last Week':  { const ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay() - 7); const we = new Date(today); we.setDate(we.getDate() - we.getDay()); return { date_from: iso(ws), date_to: iso(we) }; }
    case 'Last 7 Days':  { const d = new Date(today); d.setDate(d.getDate() - 7);  return { date_from: iso(d) }; }
    case 'Last 30 Days': { const d = new Date(today); d.setDate(d.getDate() - 30); return { date_from: iso(d) }; }
    case 'This Month': return { date_from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
    case 'Last Month': { const ms = new Date(now.getFullYear(), now.getMonth() - 1, 1); const me = new Date(now.getFullYear(), now.getMonth(), 1); return { date_from: iso(ms), date_to: iso(me) }; }
    case 'This Year':  return { date_from: iso(new Date(now.getFullYear(), 0, 1)) };
    case 'Last Year':  { const ys = new Date(now.getFullYear() - 1, 0, 1); const ye = new Date(now.getFullYear(), 0, 1); return { date_from: iso(ys), date_to: iso(ye) }; }
    default: return {};
  }
}

function buildLeadsParams(
  filters: FilterState,
  search: string,
  pipelineId: string | null,
  selectedPipeline: Pipeline | undefined,
  cursor = '',
): URLSearchParams {
  const p = new URLSearchParams();
  p.set('after', cursor);          // triggers cursor-mode response
  p.set('limit', '2000');
  if (pipelineId) p.set('pipeline_id', pipelineId);
  if (search)     p.set('search', search);
  // Single-selection filters map directly to API (including 'none' for unassigned)
  if (filters.assignedTo.length === 1) p.set('assigned_to', filters.assignedTo[0]);
  if (filters.stage.length === 1) {
    const stageId = selectedPipeline?.stages.find((s) => s.name === filters.stage[0])?.id;
    if (stageId) p.set('stage', stageId);
  }
  if (filters.tags.length === 1) p.set('tag', filters.tags[0]);
  if (filters.createdOn === 'Custom') {
    if (filters.createdFrom) p.set('date_from', new Date(filters.createdFrom + 'T00:00:00').toISOString());
    if (filters.createdTo)   p.set('date_to',   new Date(filters.createdTo + 'T23:59:59.999').toISOString());
  } else if (filters.createdOn) {
    const { date_from, date_to } = dateRangeToIso(filters.createdOn);
    if (date_from) p.set('date_from', date_from);
    if (date_to)   p.set('date_to',   date_to);
  }
  return p;
}

function mapApiLeadsToStore(rows: any[], stageMap: Record<string, string>): Lead[] {
  return rows.map((l) => {
    const parts = (l.name ?? '').split(' ');
    const stageName = stageMap[l.stage_id] ?? l.stage_name ?? 'New Lead';
    return {
      id: l.id,
      firstName: l.first_name ?? parts[0] ?? '',
      lastName: l.last_name ?? parts.slice(1).join(' ') ?? '',
      email: l.email ?? '',
      phone: l.phone ?? '',
      stage: stageName,
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
      customFields: [],
    } as Lead;
  });
}

const LEAD_EXPORT_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'source', label: 'Source' },
  { key: 'status', label: 'Lead Status' },
  { key: 'quality', label: 'Quality' },
  { key: 'pipeline_name', label: 'Pipeline' },
  { key: 'stage_name', label: 'Stage' },
  { key: 'created_at', label: 'Created At' },
  { key: 'deal_value', label: 'Deal Value' },
  { key: 'lead_updated_at', label: 'Last Updated' },
];

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const { leads, moveLeadStage, followUps, completeFollowUp, pipelines, updateLead, deleteLead, staff, bookingLinks } = useCrmStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const canViewOwn    = usePermission('leads:view_own');
  const canViewAll    = usePermission('leads:view_all');
  const canCreateLead = usePermission('leads:create');
  const canEditLead   = usePermission('leads:edit');
  const canDeleteLead = usePermission('leads:delete');
  const canAssign     = usePermission('leads:assign');
  const canExport     = usePermission('leads:export');
  const [search, setSearch] = useState('');
  const [pipelineSearch, setPipelineSearch] = useState('');
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const dashFilter = searchParams.get('filter') as 'stale' | 'converted' | null;
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(
    () => searchParams.get('pipeline') ?? localStorage.getItem('crm_selected_pipeline') ?? null
  );

  // Persist pipeline selection across refreshes
  const setPipeline = (id: string) => {
    setSelectedPipelineId(id);
    localStorage.setItem('crm_selected_pipeline', id);
  };

  // Sync selected pipeline when real pipelines load from API
  // If ?pipeline= param is present, it takes priority over localStorage
  useEffect(() => {
    if (pipelines.length === 0) return;
    const fromUrl = searchParams.get('pipeline');
    if (fromUrl && pipelines.find((p) => p.id === fromUrl)) {
      setPipeline(fromUrl);
      return;
    }
    // If already on a valid pipeline, do nothing — don't reset on every 30s poll
    if (selectedPipelineId && pipelines.find((p) => p.id === selectedPipelineId)) return;
    // Pipeline was deleted or nothing selected yet — fall back to saved or first
    const saved = localStorage.getItem('crm_selected_pipeline');
    const valid = saved && pipelines.find((p) => p.id === saved);
    setPipeline(valid ? saved! : pipelines[0].id);
  }, [pipelines]);

  // Highlight lead from notification click — switch to its pipeline and flash the card
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightParam = searchParams.get('highlight');
  useEffect(() => {
    if (!highlightParam || leads.length === 0 || pipelines.length === 0) return;
    const lead = leads.find((l) => l.id === highlightParam);
    if (!lead) return;
    if (lead.pipelineId && lead.pipelineId !== selectedPipelineId) {
      setPipeline(lead.pipelineId);
    }
    setHighlightId(highlightParam);
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightParam, leads, pipelines]);
  const [kanbanView, setKanbanView] = useState(!dashFilter);
  const isMobile = useIsMobile();
  const [mobileStage, setMobileStage] = useState<string>('');
  const [mobileSelectMode, setMobileSelectMode] = useState(false);
  const mobileTabsRef = useRef<HTMLDivElement>(null);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const [showPhone, setShowPhone] = useState(true);
  const location = useLocation();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [stateOpenLead, setStateOpenLead] = useState<Lead | null>(null);
  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? stateOpenLead;

  // Auto-open lead panel when navigated from FollowUpsPage with state.openLeadId
  useEffect(() => {
    const openId = (location.state as any)?.openLeadId;
    if (!openId) return;
    window.history.replaceState({}, ''); // clear state so back/forward don't re-trigger
    const fromStore = leads.find((l) => l.id === openId);
    if (fromStore) { setSelectedLeadId(fromStore.id); return; }
    Promise.all([
      api.get<any>(`/api/leads/${openId}`),
      api.get<any[]>(`/api/leads/${openId}/fields`).catch(() => []),
    ]).then(([l, fieldRows]) => {
      const parts = (l.name ?? '').split(' ');
      const customFields = (fieldRows ?? []).map((r: any) => ({ label: r.field_name ?? r.slug, value: r.value, fieldId: r.field_id }));
      setStateOpenLead({
        id: l.id,
        firstName: l.first_name ?? parts[0] ?? '',
        lastName: l.last_name ?? parts.slice(1).join(' ') ?? '',
        email: l.email ?? '',
        phone: l.phone ?? '',
        stage: l.stage_name ?? 'New Lead',
        stageId: l.stage_id ?? '',
        pipelineId: l.pipeline_id ?? '',
        source: l.source ?? 'Manual',
        tags: l.tags ?? [],
        assignedTo: l.assigned_to ?? '',
        assignedName: l.assigned_name ?? '',
        createdAt: l.created_at ?? new Date().toISOString(),
        lastActivity: l.updated_at ?? l.created_at ?? new Date().toISOString(),
        businessName: '', city: '', notes: l.notes ?? '',
        dealValue: Number(l.deal_value ?? 0), value: 0, probability: 0, nextFollowUp: null, customFields,
      } as Lead);
    }).catch(() => null);
  }, [location.state]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showNewPipeline, setShowNewPipeline] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showBulkStage, setShowBulkStage] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  // Keyboard shortcut Cmd/Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
        setSearch('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close overflow menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMoreMenu(false);
    };
    if (showMoreMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  const stageMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of pipelines) for (const s of p.stages) m[s.id] = s.name;
    return m;
  }, [pipelines]);

  // Real-time: update leads live when others create/edit them
  useEffect(() => {
    const socket = getSocket();

    const onLeadCreated = (lead: any) => {
      const stageName = stageMap[lead.stage_id] ?? lead.stage_name ?? '';
      useCrmStore.getState().addLead({
        id: lead.id,
        firstName: (lead.name ?? '').split(' ')[0],
        lastName: (lead.name ?? '').split(' ').slice(1).join(' '),
        email: lead.email ?? '',
        phone: lead.phone ?? '',
        pipelineId: lead.pipeline_id ?? '',
        stage: stageName,
        source: lead.source ?? '',
        dealValue: lead.deal_value ?? 0,
        tags: lead.tags ?? [],
        score: 0,
        notes: [],
        assignedTo: lead.assigned_to ?? '',
        assignedName: lead.assigned_name ?? '',
        teamMembers: lead.team_members ?? [],
        createdAt: lead.created_at ?? new Date().toISOString(),
        lastActivity: lead.updated_at ?? new Date().toISOString(),
      });
    };

    const onLeadUpdated = (lead: any) => {
      const stageName = stageMap[lead.stage_id] ?? lead.stage_name ?? '';
      const parts = (lead.name ?? '').split(' ');
      useCrmStore.getState().updateLead(lead.id, {
        firstName: parts[0] ?? '',
        lastName: parts.slice(1).join(' ') ?? '',
        email: lead.email ?? '',
        phone: lead.phone ?? '',
        stage: stageName,
        stageId: lead.stage_id ?? '',
        pipelineId: lead.pipeline_id ?? '',
        tags: lead.tags ?? [],
        assignedTo: lead.assigned_to ?? '',
        assignedName: lead.assigned_name ?? '',
        teamMembers: lead.team_members ?? [],
        dealValue: Number(lead.deal_value ?? 0),
        lastActivity: lead.updated_at ?? new Date().toISOString(),
        leadQuality: lead.custom_fields?.lead_quality ?? undefined,
      });
    };

    socket.on('lead:created', onLeadCreated);
    socket.on('lead:updated', onLeadUpdated);
    return () => {
      socket.off('lead:created', onLeadCreated);
      socket.off('lead:updated', onLeadUpdated);
    };
  }, [stageMap]);

  const exportLeads = () => setShowExportModal(true);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({ ...emptyFilters });
  const [quickEditLead, setQuickEditLead] = useState<Lead | null>(null);
  const [quickNoteLead, setQuickNoteLead] = useState<Lead | null>(null);
  const [quickFollowUpLead, setQuickFollowUpLead] = useState<Lead | null>(null);
  const [quickAssignLead, setQuickAssignLead] = useState<Lead | null>(null);
  const [quickApptLead, setQuickApptLead] = useState<Lead | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId) ?? pipelines[0];
  const activeStages = selectedPipeline?.stages.map((s) => s.name) ?? [];

  // ── Server-side filter state (S2.3.1 + S2.3.3) ──────────────────────────────
  const [apiLeads, setApiLeads] = useState<Lead[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);

  const hasServerFilter = !!(
    search || selectedPipelineId ||
    filters.assignedTo.length || filters.stage.length ||
    filters.tags.length || filters.createdOn
  );

  useEffect(() => {
    if (!hasServerFilter) { setApiLeads(null); setFilterLoading(false); return; }

    let cancelled = false;
    const delay = search ? 300 : 0;
    setFilterLoading(true);
    const t = setTimeout(async () => {
      try {
        let allLeads: any[] = [];
        let cursor = '';
        while (true) {
          const params = buildLeadsParams(filters, search, selectedPipelineId, selectedPipeline, cursor);
          const data = await api.get<{ leads: any[]; nextCursor: string | null }>(`/api/leads?${params}`);
          if (cancelled) return;
          allLeads = [...allLeads, ...data.leads];
          if (!data.nextCursor) break;
          cursor = data.nextCursor;
        }
        setApiLeads(mapApiLeadsToStore(allLeads, stageMap));
      } catch { /* ignore */ }
      if (!cancelled) setFilterLoading(false);
    }, delay);
    return () => { cancelled = true; clearTimeout(t); };
    // `leads.length` is intentionally a dep: when a new lead enters the store
    // (realtime lead:created socket → addLead, the manual Add Lead modal, or the
    // 30s background poll), this re-fetches the server-filtered apiLeads snapshot
    // so the board shows it immediately instead of only after a manual refresh.
  }, [filters, search, selectedPipelineId, selectedPipeline?.id, hasServerFilter, leads.length]);

  const filteredLeads = useMemo(() => {
    // Dashboard quick-filter — cross-pipeline, bypasses server fetch
    if (dashFilter === 'stale') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return leads.filter((l) => new Date(l.lastActivity) < sevenDaysAgo);
    }
    if (dashFilter === 'converted') {
      const wonStageIds = new Set(pipelines.flatMap((p) => p.stages.filter((s) => s.is_won).map((s) => s.id)));
      return wonStageIds.size > 0 ? leads.filter((l) => wonStageIds.has(l.stageId)) : [];
    }

    // Use server-fetched leads when active filters exist, otherwise use store leads
    let result = apiLeads ?? leads;

    // Client-side-only filters (no backend equivalent)
    if (filters.contactType.length) result = result.filter((l) => filters.contactType.includes('Customer') ? l.stage === 'Closed Won' : l.stage !== 'Closed Won');
    if (filters.opportunityValue.length) result = result.filter((l) => {
      const v = l.dealValue;
      return filters.opportunityValue.some((r) =>
        r === 'Less than ₹1,000' ? v < 1000 :
        r === '₹1,000 - ₹5,000' ? v >= 1000 && v <= 5000 :
        r === '₹5,001 - ₹10,000' ? v >= 5001 && v <= 10000 :
        r === '₹10,001 - ₹50,000' ? v >= 10001 && v <= 50000 :
        r === 'More than ₹50,000' ? v > 50000 : true
      );
    });

    // When no apiLeads (store-based), apply ALL filters client-side.
    // When apiLeads exist, the API already handled single-value filters;
    // apply multi-value filters (>1 selection) client-side as a second pass.
    const assigneeFilter = (l: Lead) => {
      const sel = filters.assignedTo;
      const hasNone = sel.includes('none');
      const staffIds = sel.filter((v) => v !== 'none');
      // Match unassigned OR matching staff
      return (hasNone && !l.assignedTo) || staffIds.includes(l.assignedTo ?? '');
    };

    if (!apiLeads) {
      if (selectedPipelineId) result = result.filter((l) => l.pipelineId === selectedPipelineId);
      if (search) { const s = search.toLowerCase(); result = result.filter((l) => `${l.firstName} ${l.lastName}`.toLowerCase().includes(s) || l.phone.includes(s) || l.email.toLowerCase().includes(s)); }
      if (filters.assignedTo.length) result = result.filter(assigneeFilter);
      if (filters.stage.length) result = result.filter((l) => filters.stage.includes(l.stage));
      if (filters.tags.length) result = result.filter((l) => filters.tags.some((t) => l.tags.includes(t)));
      if (filters.createdOn) {
        const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        result = result.filter((l) => {
          const d = new Date(l.createdAt);
          if (filters.createdOn === 'Today') return d >= today;
          if (filters.createdOn === 'Yesterday') { const y = new Date(today); y.setDate(y.getDate() - 1); return d >= y && d < today; }
          if (filters.createdOn === 'This Week') { const w = new Date(today); w.setDate(w.getDate() - w.getDay()); return d >= w; }
          if (filters.createdOn === 'This Month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
          if (filters.createdOn === 'Last 7 Days') { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
          if (filters.createdOn === 'Last 30 Days') { const m = new Date(today); m.setDate(m.getDate() - 30); return d >= m; }
          return true;
        });
      }
    } else {
      // API handled single-value; apply multi-value client-side
      if (filters.assignedTo.length > 1) result = result.filter(assigneeFilter);
      if (filters.stage.length > 1) result = result.filter((l) => filters.stage.includes(l.stage));
      if (filters.tags.length > 1) result = result.filter((l) => filters.tags.some((t) => l.tags.includes(t)));
    }

    return result;
  }, [leads, apiLeads, selectedPipelineId, search, filters, dashFilter, pipelines]);

  const totalCount = filteredLeads.length;
  const customerCount = useMemo(() => filteredLeads.reduce((n, l) => n + (l.stage === 'Closed Won' ? 1 : 0), 0), [filteredLeads]);
  const leadCount = totalCount - customerCount;

  // Precompute earliest incomplete follow-up time per lead ONCE, so the kanban sort
  // comparator is O(1) instead of scanning the whole followUps array per comparison
  // (was effectively O(N²·log N) per board render).
  const nextFollowUpByLead = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of followUps) {
      if (f.completed) continue;
      const t = new Date(f.dueAt).getTime();
      const prev = m.get(f.leadId);
      if (prev === undefined || t < prev) m.set(f.leadId, t);
    }
    return m;
  }, [followUps]);
  const activeFiltersCount = Object.values(filters).filter((v) => (Array.isArray(v) ? v.length > 0 : !!v)).length;

  // List-view pagination — render one page of rows, not all leads at once.
  // (Kanban columns are per-stage and already scroll independently.)
  const LIST_PAGE_SIZE = 50;
  const [listPage, setListPage] = useState(1);
  useEffect(() => { setListPage(1); }, [filteredLeads.length, search, selectedPipelineId]);
  const listTotalPages = Math.max(1, Math.ceil(filteredLeads.length / LIST_PAGE_SIZE));
  const listSafePage = Math.min(listPage, listTotalPages);
  const pagedListLeads = useMemo(() => filteredLeads.slice((listSafePage - 1) * LIST_PAGE_SIZE, listSafePage * LIST_PAGE_SIZE), [filteredLeads, listSafePage]);

  const filteredPipelines = pipelines.filter((p) =>
    p.name.toLowerCase().includes(pipelineSearch.toLowerCase())
  );

  const handleDragStart = (e: DragStartEvent) => setActiveDragId(e.active.id as string);

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const leadId = active.id as string;
    const overId = over.id as string;

    let newStage: string | undefined;
    let newStageId: string | undefined;

    if (activeStages.includes(overId)) {
      newStage = overId;
      newStageId = selectedPipeline?.stages.find((s) => s.name === overId)?.id;
    } else {
      const targetLead = (apiLeads ?? leads).find((l) => l.id === overId);
      const srcLead = (apiLeads ?? leads).find((l) => l.id === leadId);
      if (targetLead && targetLead.stage !== srcLead?.stage) {
        newStage = targetLead.stage;
        newStageId = targetLead.stageId;
      }
    }

    if (!newStage) return;

    // Update store leads
    moveLeadStage(leadId, newStage, newStageId);

    // Also update apiLeads so filteredLeads (which reads apiLeads ?? leads) reflects the move
    if (apiLeads) {
      setApiLeads((prev) =>
        (prev ?? []).map((l) => l.id === leadId ? { ...l, stage: newStage!, stageId: newStageId ?? l.stageId } : l)
      );
    }

    toast.success(`Lead moved to ${newStage}`);
    if (newStageId) api.patch(`/api/leads/${leadId}`, { stage_id: newStageId }).catch(() => null);
  };

  // Move a single lead to a stage (mobile menu — no drag). Mirrors handleDragEnd.
  const moveSingleLeadStage = (leadId: string, stage: string) => {
    const pl = pipelines.find((p) => p.id === selectedPipelineId) ?? pipelines[0];
    const stageId = pl?.stages.find((s) => s.name === stage)?.id;
    moveLeadStage(leadId, stage, stageId);
    if (apiLeads) {
      setApiLeads((prev) => (prev ?? []).map((l) => l.id === leadId ? { ...l, stage, stageId: stageId ?? l.stageId } : l));
    }
    toast.success(`Lead moved to ${stage}`);
    if (stageId) api.patch(`/api/leads/${leadId}`, { stage_id: stageId }).catch(() => null);
  };

  // Leads of one stage, sorted: overdue follow-ups first, then newest. Shared by board + mobile.
  const stageLeadsFor = (stage: string) => {
    const now = Date.now();
    return filteredLeads
      .filter((l) => l.stage === stage)
      .sort((a, b) => {
        const ta = nextFollowUpByLead.get(a.id);
        const tb = nextFollowUpByLead.get(b.id);
        const aOverdue = ta !== undefined && ta < now;
        const bOverdue = tb !== undefined && tb < now;
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        if (aOverdue && bOverdue) return ta! - tb!;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  };

  // Active stage tab on mobile — fall back to first stage if the stored one is gone.
  const currentMobileStage = activeStages.includes(mobileStage) ? mobileStage : (activeStages[0] ?? '');

  // Keep the active stage tab scrolled into view (e.g. after a swipe).
  useEffect(() => {
    if (!isMobile) return;
    const el = mobileTabsRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [currentMobileStage, isMobile]);

  // Swipe left/right on the list to move to the adjacent stage.
  const goAdjacentStage = (dir: -1 | 1) => {
    const i = activeStages.indexOf(currentMobileStage);
    const next = i + dir;
    if (next >= 0 && next < activeStages.length) setMobileStage(activeStages[next]);
  };
  const onListTouchStart = (e: React.TouchEvent) => { swipeStartX.current = e.touches[0].clientX; swipeStartY.current = e.touches[0].clientY; };
  const onListTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) goAdjacentStage(dx < 0 ? 1 : -1);
  };

  const activeLead = activeDragId ? (apiLeads ?? leads).find((l) => l.id === activeDragId) : null;

  const pipelineLeads = selectedPipelineId ? leads.filter((l) => l.pipelineId === selectedPipelineId) : leads;

  // Bulk actions
  const bulkMove = async (stage: string) => {
    const ids = [...selectedIds];
    const pl = pipelines.find((p) => p.id === selectedPipelineId) ?? pipelines[0];
    const stageId = pl?.stages.find((s) => s.name === stage)?.id;
    ids.forEach((id) => moveLeadStage(id, stage, stageId));
    toast.success(`${ids.length} leads moved to ${stage}`);
    setSelectedIds([]); setShowBulkStage(false);
    if (stageId) {
      await Promise.all(ids.map((id) => api.patch(`/api/leads/${id}`, { stage_id: stageId }).catch(() => null)));
    }
  };
  const bulkAssign = async (staffId: string) => {
    const ids = [...selectedIds];
    ids.forEach((id) => updateLead(id, { assignedTo: staffId }));
    const name = staffId ? staff.find((s: any) => s.id === staffId)?.name : 'unassigned';
    toast.success(`${ids.length} leads ${staffId ? 'assigned to ' + name : 'unassigned'}`);
    setSelectedIds([]); setShowBulkAssign(false);
    await Promise.all(ids.map((id) => api.patch(`/api/leads/${id}`, { assigned_to: staffId || null }).catch(() => null)));
  };
  const bulkDelete = async () => {
    let failed = 0;
    await Promise.all(selectedIds.map((id) =>
      api.delete(`/api/leads/${id}`).then(() => deleteLead(id)).catch(() => { failed++; })
    ));
    const done = selectedIds.length - failed;
    if (done > 0) toast.success(`${done} contact${done !== 1 ? 's' : ''} deleted`);
    if (failed > 0) toast.error(`${failed} could not be deleted`);
    setSelectedIds([]);
    setShowBulkDeleteConfirm(false);
  };

  const role = currentUser?.role;
  const noAccess = role === 'staff' && !canViewOwn && !canViewAll;

  if (noAccess) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center p-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <EyeOff className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-[18px] font-bold text-[#1c1410] mb-2">No access to leads</h2>
        <p className="text-[14px] text-[#7a6b5c] max-w-sm">You don't have permission to view leads. Contact your admin to request access.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 animate-fade-in">

      {/* ── Dashboard filter banner ── */}
      {dashFilter && (
        <div className={`flex items-center gap-3 mb-3 px-4 py-2.5 rounded-xl border text-[13px] font-medium ${dashFilter === 'stale' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
          <span className="flex-1">
            {dashFilter === 'stale'
              ? `Showing ${filteredLeads.length} stale lead${filteredLeads.length !== 1 ? 's' : ''} - no activity in 7+ days`
              : `Showing ${filteredLeads.length} converted lead${filteredLeads.length !== 1 ? 's' : ''} - in won stage`}
          </span>
          <a href="/leads" className="text-[11px] font-semibold underline underline-offset-2 opacity-70 hover:opacity-100">Clear filter</a>
        </div>
      )}

      {/* ── Smart Toolbar ── */}
      <div className="sticky top-0 z-20 bg-[var(--app-bg)] pt-2 pb-3 space-y-2.5">

        {/* Row 1: Contextual bar — bulk actions when leads selected, else default toolbar */}
        {(isMobile && mobileSelectMode) ? (
          /* ── Mobile Selection Bar ── */
          <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-primary/30 animate-fade-in" style={{ background: 'linear-gradient(to right, #faf0e8, #fff)' }}>
            <span className="w-6 h-6 shrink-0 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center tabular-nums">{selectedIds.length}</span>
            <div className="relative">
              <button onClick={() => { setShowBulkStage((v) => !v); setShowBulkAssign(false); }} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] font-semibold text-[#1c1410] active:bg-white whitespace-nowrap"><ArrowLeftRight className="w-3.5 h-3.5" /> Stage</button>
              {showBulkStage && (<><div className="fixed inset-0 z-30" onClick={() => setShowBulkStage(false)} /><div className="absolute left-0 top-10 z-40 bg-white rounded-xl border border-black/5 shadow-xl w-44 py-1 max-h-60 overflow-y-auto">{activeStages.map((s) => (<button key={s} onClick={() => { bulkMove(s); setMobileSelectMode(false); }} className="w-full text-left px-3 py-2 text-[12px] active:bg-[#faf0e8]">{s}</button>))}</div></>)}
            </div>
            <div className="relative">
              <button onClick={() => { setShowBulkAssign((v) => !v); setShowBulkStage(false); }} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] font-semibold text-[#1c1410] active:bg-white whitespace-nowrap"><User className="w-3.5 h-3.5" /> Assign</button>
              {showBulkAssign && (<><div className="fixed inset-0 z-30" onClick={() => setShowBulkAssign(false)} /><div className="absolute left-0 top-10 z-40 bg-white rounded-xl border border-black/5 shadow-xl w-48 py-1 max-h-60 overflow-y-auto"><button onClick={() => { bulkAssign(''); setMobileSelectMode(false); }} className="w-full text-left px-3 py-2 text-[12px] italic text-[#7a6b5c] active:bg-gray-50">Unassign</button><div className="border-t border-black/5 my-1" />{staff.map((s) => (<button key={s.id} onClick={() => { bulkAssign(s.id); setMobileSelectMode(false); }} className="w-full flex items-center gap-2 text-left px-3 py-2 text-[12px] active:bg-[#faf0e8]"><span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[9px] font-bold flex items-center justify-center">{s.avatar}</span>{s.name}</button>))}</div></>)}
            </div>
            {canDeleteLead && (
              <button aria-label="Delete selected" onClick={() => setShowBulkDeleteConfirm(true)} className="flex items-center px-2 py-1.5 rounded-lg text-[12px] font-semibold text-red-500 active:bg-red-50 shrink-0"><Trash2 className="w-4 h-4" /></button>
            )}
            {showBulkDeleteConfirm && (
              <ConfirmModal title={`Delete ${selectedIds.length} contact${selectedIds.length !== 1 ? 's' : ''}?`} message="This will permanently remove them from the CRM. This cannot be undone." confirmLabel="Yes, Delete" onConfirm={() => { bulkDelete(); setMobileSelectMode(false); }} onClose={() => setShowBulkDeleteConfirm(false)} />
            )}
            <div className="flex-1" />
            <button onClick={() => { setSelectedIds([]); setMobileSelectMode(false); }} className="shrink-0 px-3 py-1.5 rounded-lg bg-primary text-white text-[12px] font-bold active:scale-95">Done</button>
          </div>
        ) : selectedIds.length > 0 ? (
          /* ── Bulk Action Bar ── */
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-primary/30 animate-fade-in"
            style={{ background: 'linear-gradient(to right, #faf0e8, #fff)', boxShadow: '0 2px 8px rgba(234,88,12,0.08)' }}
          >
            <div className="flex items-center gap-2 pr-3 border-r border-primary/20">
              <div className="w-6 h-6 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">{selectedIds.length}</div>
              <span className="text-[12px] font-semibold text-[#1c1410]">selected</span>
            </div>

            {/* Change Stage */}
            <div className="relative">
              <button onClick={() => { setShowBulkStage((v) => !v); setShowBulkAssign(false); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#1c1410] hover:bg-white transition-colors">
                <ArrowLeftRight className="w-3.5 h-3.5" /> Change Stage <ChevronDown className="w-3 h-3" />
              </button>
              {showBulkStage && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowBulkStage(false)} />
                  <div className="absolute left-0 top-10 z-40 bg-white rounded-xl border border-black/5 shadow-xl w-44 py-1 overflow-hidden">
                    {activeStages.map((s) => (
                      <button key={s} onClick={() => bulkMove(s)} className="w-full text-left px-3 py-2 text-[12px] hover:bg-[#faf0e8] hover:text-primary transition-colors">{s}</button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Assign */}
            <div className="relative">
              <button onClick={() => { setShowBulkAssign((v) => !v); setShowBulkStage(false); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#1c1410] hover:bg-white transition-colors">
                <User className="w-3.5 h-3.5" /> Assign <ChevronDown className="w-3 h-3" />
              </button>
              {showBulkAssign && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowBulkAssign(false)} />
                  <div className="absolute left-0 top-10 z-40 bg-white rounded-xl border border-black/5 shadow-xl w-48 py-1 overflow-hidden max-h-60 overflow-y-auto">
                    <button onClick={() => bulkAssign('')} className="w-full text-left px-3 py-2 text-[12px] text-[#7a6b5c] hover:bg-gray-50 transition-colors italic">Unassign</button>
                    <div className="border-t border-black/5 my-1" />
                    {staff.map((s) => (
                      <button key={s.id} onClick={() => bulkAssign(s.id)} className="w-full flex items-center gap-2 text-left px-3 py-2 text-[12px] hover:bg-[#faf0e8] hover:text-primary transition-colors">
                        <div className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[9px] font-bold flex items-center justify-center">{s.avatar}</div>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Workflow */}
            <button onClick={() => setShowWorkflow(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#1c1410] hover:bg-white transition-colors">
              <Zap className="w-3.5 h-3.5" /> Trigger Workflow
            </button>

            <div className="flex-1" />

            {/* Delete */}
            {canDeleteLead && (
              <button onClick={() => setShowBulkDeleteConfirm(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            {showBulkDeleteConfirm && (
              <ConfirmDeleteModal
                title={`Delete ${selectedIds.length} contact${selectedIds.length !== 1 ? 's' : ''}?`}
                message="This will permanently remove them from the CRM. This cannot be undone."
                confirmLabel="Yes, Delete"
                onConfirm={bulkDelete}
                onClose={() => setShowBulkDeleteConfirm(false)}
              />
            )}

            {/* Clear selection */}
            <button onClick={() => setSelectedIds([])} className="p-1.5 rounded-lg hover:bg-white transition-colors text-[#7a6b5c]">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* ── Default Toolbar (responsive: wraps to 2 rows on phones) ── */
          <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:gap-3">

            {/* Pipeline selector */}
            <div className="relative shrink-0">
              <button
                onClick={() => { setPipelineOpen((o) => !o); setPipelineSearch(''); }}
                className="flex items-center gap-2.5 pl-3 pr-2.5 h-10 rounded-xl bg-white border border-black/10 text-[13px] font-semibold text-[#1c1410] hover:border-primary/40 hover:bg-orange-50/30 transition-all"
              >
                <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="truncate max-w-[130px]">{selectedPipeline?.name ?? 'Select pipeline'}</span>
                <span className="text-[11px] font-bold bg-primary/10 text-primary rounded-md px-1.5 py-0.5 min-w-[22px] text-center">{pipelineLeads.length}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#9a8a7a]" />
              </button>

              {pipelineOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPipelineOpen(false)} />
                  <div className="absolute left-0 top-12 z-40 bg-white rounded-2xl border border-black/5 shadow-2xl w-64 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-black/5">
                      <Search className="w-3.5 h-3.5 text-[#b09e8d] shrink-0" />
                      <input autoFocus className="flex-1 text-[12px] outline-none text-[#1c1410] placeholder:text-gray-400" placeholder="Search pipeline..." value={pipelineSearch} onChange={(e) => setPipelineSearch(e.target.value)} />
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1.5">
                      {filteredPipelines.map((p) => {
                        const cnt = leads.filter((l) => l.pipelineId === p.id).length;
                        return (
                          <button key={p.id} onClick={() => { setPipeline(p.id); setPipelineOpen(false); }}
                            className={cn('w-full text-left px-4 py-2.5 text-[13px] transition-colors flex items-center gap-2', p.id === selectedPipelineId ? 'bg-[#faf0e8] text-primary font-semibold' : 'text-[#1c1410] hover:bg-[var(--app-bg)]')}>
                            {p.id === selectedPipelineId && <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                            <span className="flex-1 truncate">{p.name}</span>
                            <span className="text-[10px] text-[#b09e8d] font-normal">{cnt}</span>
                          </button>
                        );
                      })}
                      {filteredPipelines.length === 0 && <p className="px-4 py-3 text-[12px] text-[#7a6b5c]">No pipelines found</p>}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Search — full-width second row on phones, inline on desktop */}
            <div className="relative order-last w-full md:order-none md:flex-1 md:max-w-xs">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b09e8d] pointer-events-none" />
              <input
                ref={searchInputRef}
                className="w-full h-10 pl-9 pr-8 text-[13px] bg-white border border-black/10 rounded-xl outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 placeholder:text-[#b09e8d] transition-all"
                placeholder="Search leads…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full hover:bg-gray-100 flex items-center justify-center text-[#b09e8d]"><X className="w-3 h-3" /></button>
              )}
            </div>

            <div className="hidden md:block flex-1" />

            {/* Right action group */}
            <div className="flex items-center gap-2 shrink-0 ml-auto md:ml-0">

              {/* View toggle — labeled pill (desktop only; phones are board-only) */}
              <div className="hidden md:flex items-center h-10 bg-gray-100 rounded-xl p-1 gap-0.5">
                <button onClick={() => setKanbanView(true)}
                  className={cn('flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-semibold transition-all', kanbanView ? 'bg-white shadow-sm text-primary' : 'text-[#7a6b5c] hover:text-[#1c1410]')}>
                  <LayoutGrid className="w-3.5 h-3.5" /> Board
                </button>
                <button onClick={() => setKanbanView(false)}
                  className={cn('flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-semibold transition-all', !kanbanView ? 'bg-white shadow-sm text-primary' : 'text-[#7a6b5c] hover:text-[#1c1410]')}>
                  <List className="w-3.5 h-3.5" /> List
                </button>
              </div>

              {/* Filter */}
              <div className="relative">
                <button ref={filterBtnRef} onClick={() => setShowFilters((v) => !v)}
                  className={cn('relative flex items-center gap-1.5 px-3 h-10 rounded-xl border text-[12px] font-semibold transition-all',
                    activeFiltersCount > 0 || showFilters ? 'bg-orange-50 border-primary/30 text-primary' : 'bg-white border-black/10 text-[#7a6b5c] hover:border-primary/30 hover:text-primary'
                  )}>
                  <Filter className="w-3.5 h-3.5" />
                  Filter
                  {activeFiltersCount > 0 && <span className="bg-primary text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{activeFiltersCount}</span>}
                </button>
                {showFilters && <FilterPopover filters={filters} onChange={setFilters} onClose={() => setShowFilters(false)} stages={activeStages} anchorRef={filterBtnRef} isMobile={isMobile} />}
              </div>

              {/* More */}
              <div className="relative" ref={moreMenuRef}>
                <button onClick={() => setShowMoreMenu((v) => !v)}
                  className={cn('flex items-center justify-center w-10 h-10 rounded-xl border transition-all', showMoreMenu ? 'bg-orange-50 border-primary/30 text-primary' : 'bg-white border-black/10 text-[#7a6b5c] hover:border-primary/30 hover:text-primary')}>
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {showMoreMenu && (
                  <div className="absolute right-0 top-12 z-40 w-56 bg-white rounded-xl border border-black/5 shadow-xl overflow-hidden py-1">
                    <button onClick={() => { setShowMoreMenu(false); setShowImport(true); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                      <Package className="w-3.5 h-3.5 text-[#7a6b5c]" /> Import leads
                    </button>
                    {canExport && (
                      <button onClick={() => { setShowMoreMenu(false); exportLeads(); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                        <Download className="w-3.5 h-3.5 text-[#7a6b5c]" /> Export leads
                      </button>
                    )}
                    <div className="border-t border-black/5 my-1" />
                    <button onClick={() => { setShowMoreMenu(false); setShowWorkflow(true); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                      <Zap className="w-3.5 h-3.5 text-[#7a6b5c]" /> Trigger Workflow
                    </button>
                    <button onClick={() => { setShowMoreMenu(false); setShowPhone((v) => !v); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                      {showPhone ? <EyeOff className="w-3.5 h-3.5 text-[#7a6b5c]" /> : <Eye className="w-3.5 h-3.5 text-[#7a6b5c]" />}
                      {showPhone ? 'Hide contact info' : 'Show contact info'}
                    </button>
                    <div className="border-t border-black/5 my-1" />
                    <button onClick={() => { setShowMoreMenu(false); setSearch(''); setFilters({ ...emptyFilters }); setSelectedIds([]); toast.success('Reset'); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors">
                      <RotateCcw className="w-3.5 h-3.5 text-[#7a6b5c]" /> Reset filters
                    </button>
                  </div>
                )}
              </div>

              {/* Add Lead (desktop button; phones use the floating + button) */}
              {canCreateLead && (
                <button onClick={() => setShowAddLead(true)}
                  className="hidden md:flex items-center gap-2 px-4 h-10 rounded-xl text-[13px] font-bold text-white bg-primary hover:bg-primary/90 transition-all active:scale-95 shrink-0">
                  <Plus className="w-4 h-4" /> Add Lead
                </button>
              )}
            </div>
          </div>
        )}

        {/* Active filter chips — one per value, instant remove */}
        {selectedIds.length === 0 && activeFiltersCount > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-[#7a6b5c] font-semibold uppercase tracking-wide mr-1">Filtered by:</span>
            {filters.assignedTo.map((id) => {
              const name = id === 'none' ? 'Unassigned' : staff.find((s) => s.id === id)?.name ?? id;
              return <FilterChip key={`a-${id}`} label={`Assignee: ${name}`} onRemove={() => setFilters({ ...filters, assignedTo: filters.assignedTo.filter((x) => x !== id) })} />;
            })}
            {filters.stage.map((s) => (
              <FilterChip key={`s-${s}`} label={`Stage: ${s}`} onRemove={() => setFilters({ ...filters, stage: filters.stage.filter((x) => x !== s) })} />
            ))}
            {filters.tags.map((t) => (
              <FilterChip key={`t-${t}`} label={`Tag: ${t}`} onRemove={() => setFilters({ ...filters, tags: filters.tags.filter((x) => x !== t) })} />
            ))}
            {filters.contactType.map((t) => (
              <FilterChip key={`ct-${t}`} label={`Type: ${t}`} onRemove={() => setFilters({ ...filters, contactType: filters.contactType.filter((x) => x !== t) })} />
            ))}
            {filters.leadQuality.map((q) => (
              <FilterChip key={`lq-${q}`} label={`Quality: ${q}`} onRemove={() => setFilters({ ...filters, leadQuality: filters.leadQuality.filter((x) => x !== q) })} />
            ))}
            {filters.opportunityValue.map((v) => (
              <FilterChip key={`ov-${v}`} label={`Value: ${v}`} onRemove={() => setFilters({ ...filters, opportunityValue: filters.opportunityValue.filter((x) => x !== v) })} />
            ))}
            {filters.createdOn && <FilterChip label={`Created: ${filters.createdOn}`} onRemove={() => setFilters({ ...filters, createdOn: '' })} />}
            {filters.followUp && <FilterChip label={`Follow-up: ${filters.followUp}`} onRemove={() => setFilters({ ...filters, followUp: '' })} />}
            <button onClick={() => setFilters({ ...emptyFilters })} className="ml-1 text-[11px] text-red-500 font-semibold hover:underline">Clear all</button>
          </div>
        )}
      </div>

      {/* ── Loading progress bar ── */}
      {filterLoading && (
        <div className="w-full h-[3px] bg-primary/10 overflow-hidden rounded-full shrink-0">
          <div className="h-full w-[40%] bg-primary rounded-full animate-progress" />
        </div>
      )}

      {/* ── Board ── */}
      <div className={cn('flex-1 flex flex-col min-h-0 overflow-hidden -mb-6 transition-opacity duration-200', filterLoading && 'opacity-50 pointer-events-none')}>
      {isMobile ? (
        /* ── Mobile Board — stage tabs + single-stage list ── */
        <div className="flex flex-col flex-1 min-h-0">
          {/* Stage tabs */}
          <div ref={mobileTabsRef} className="flex gap-2 overflow-x-auto pb-2.5 shrink-0 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {activeStages.map((stage, i) => {
              const cnt = filteredLeads.filter((l) => l.stage === stage).length;
              const acc = (i % STAGE_ACCENT_COLORS.length) === 0 ? brandHex() : STAGE_ACCENT_COLORS[i % STAGE_ACCENT_COLORS.length];
              const active = currentMobileStage === stage;
              return (
                <button key={stage} data-active={active ? 'true' : 'false'} onClick={() => setMobileStage(stage)}
                  className={cn('shrink-0 flex items-center gap-1.5 pl-3.5 pr-2 h-9 rounded-full border text-[13px] font-semibold transition-all active:scale-95',
                    active ? 'text-white border-transparent shadow-sm' : 'bg-white text-[#7a6b5c] border-black/10')}
                  style={active ? { background: acc } : undefined}>
                  <span className="truncate max-w-[150px]">{stage}</span>
                  <span className={cn('text-[11px] font-bold rounded-full px-1.5 min-w-[20px] text-center tabular-nums', active ? 'bg-white/25 text-white' : 'bg-black/[0.06] text-[#7a6b5c]')}>{cnt}</span>
                </button>
              );
            })}
          </div>
          {/* Active-stage lead list (swipe left/right to change stage) */}
          <div onTouchStart={onListTouchStart} onTouchEnd={onListTouchEnd}
            className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-28 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {(() => {
              const list = stageLeadsFor(currentMobileStage);
              const i = activeStages.indexOf(currentMobileStage);
              const acc = (i % STAGE_ACCENT_COLORS.length) === 0 ? brandHex() : STAGE_ACCENT_COLORS[i % STAGE_ACCENT_COLORS.length];
              if (list.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center text-center gap-2 py-20">
                    <div className="w-14 h-14 rounded-2xl border-2 border-dashed border-black/10 flex items-center justify-center">
                      <User className="w-6 h-6 text-[#c4b09e]" />
                    </div>
                    <p className="text-[14px] font-semibold text-[#7a6b5c]">No leads in {currentMobileStage || 'this stage'}</p>
                    {canCreateLead && <p className="text-[12px] text-[#b09e8d]">Tap + to add one</p>}
                  </div>
                );
              }
              return list.map((lead) => (
                <MobileLeadCard
                  key={lead.id} lead={lead} stages={activeStages} accent={acc} showPhone={showPhone}
                  onClick={() => setSelectedLeadId(lead.id)}
                  onEdit={() => setQuickEditLead(lead)}
                  onFollowUp={() => setQuickFollowUpLead(lead)}
                  onAppointment={() => setQuickApptLead(lead)}
                  onAssign={() => setQuickAssignLead(lead)}
                  canAssign={canAssign}
                  onMove={(s) => moveSingleLeadStage(lead.id, s)}
                  selectionMode={mobileSelectMode}
                  selected={selectedIds.includes(lead.id)}
                  onEnterSelect={() => { setMobileSelectMode(true); setSelectedIds((prev) => prev.includes(lead.id) ? prev : [...prev, lead.id]); }}
                  onToggleSelect={() => setSelectedIds((prev) => prev.includes(lead.id) ? prev.filter((x) => x !== lead.id) : [...prev, lead.id])}
                />
              ));
            })()}
          </div>
        </div>
      ) : kanbanView ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-scroll overflow-y-hidden flex-1 min-h-0 items-stretch [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-black/[0.06] [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-black/45">
            {activeStages.map((stage, stageIndex) => (
              <StageColumn
                key={stage} stage={stage}
                leads={stageLeadsFor(stage)}
                onLeadClick={(l) => setSelectedLeadId(l.id)}
                onFollowUp={setQuickFollowUpLead}
                onNote={setQuickNoteLead}
                onAssign={setQuickAssignLead}
                canAssign={canAssign}
                showPhone={showPhone}
                stageIndex={stageIndex}
                highlightId={highlightId}
              />
            ))}
          </div>
          <DragOverlay>{activeLead && <div className="bg-card rounded-lg border-2 border-primary p-3 shadow-2xl opacity-90 w-[280px]"><span className="font-semibold text-sm">{activeLead.firstName} {activeLead.lastName}</span></div>}</DragOverlay>
        </DndContext>
      ) : (
        /* ── List View ── */
        <div className="bg-white rounded-2xl border border-black/5 card-shadow overflow-y-auto flex-1 min-h-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--app-bg)] border-b border-black/5">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox"
                    checked={filteredLeads.length > 0 && selectedIds.length === filteredLeads.length}
                    onChange={() => setSelectedIds(selectedIds.length === filteredLeads.length ? [] : filteredLeads.map((l) => l.id))}
                    className="w-4 h-4 accent-primary"
                  />
                </th>
                {[['Lead Name', '180px'], ['Contact Email', '210px'], ['Contact Phone', '160px'], ['Pipeline', '170px'], ['Stage', '110px'], ['Quality', '100px'], ['Created', '150px'], ['Updated', '150px']].map(([col]) => (
                  <th key={col} className="px-3 py-3 text-left">
                    <button className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] hover:text-[#1c1410] transition-colors">
                      {col} <ArrowUpDown className="w-3 h-3 opacity-50" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {filteredLeads.length === 0 && (
                <tr><td colSpan={9} className="py-16 text-center">
                  <User className="w-8 h-8 text-[#c4b09e] mx-auto mb-2" />
                  <p className="text-[13px] text-[#7a6b5c]">No leads found</p>
                </td></tr>
              )}
              {pagedListLeads.map((lead) => {
                const isSelected = selectedIds.includes(lead.id);
                const maskedPhone = showPhone ? lead.phone : lead.phone.replace(/\d(?=\d{4})/g, '*');
                const maskedEmail = showPhone ? lead.email : lead.email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => a + b.replace(/./g, '*') + c);
                const initials = `${lead.firstName[0] ?? ''}${lead.lastName[0] ?? ''}`.toUpperCase();
                const pipeline = pipelines.find((p) => p.id === lead.pipelineId);
                return (
                  <tr key={lead.id} className={cn('hover:bg-[var(--app-bg)] transition-colors', isSelected && 'bg-primary/[0.03]')}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected}
                        onChange={() => setSelectedIds(isSelected ? selectedIds.filter((x) => x !== lead.id) : [...selectedIds, lead.id])}
                        className="w-4 h-4 accent-primary"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg, var(--brand-dark), var(--brand))' }}>{initials}</div>
                        <button onClick={() => setSelectedLeadId(lead.id)} className="text-primary font-semibold hover:underline text-[13px] truncate max-w-[140px]">
                          {lead.firstName} {lead.lastName}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#3d3128] truncate max-w-[160px]">{maskedEmail}</span>
                        <button onClick={() => { copyToClipboard(lead.email); toast.success('Email copied'); }} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-primary font-medium">{maskedPhone}</span>
                        <button onClick={() => { copyToClipboard(lead.phone); toast.success('Phone copied'); }} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[#3d3128] truncate max-w-[170px]">{pipeline?.name ?? '-'}</td>
                    <td className="px-3 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-primary">{lead.stage}</span></td>
                    <td className="px-3 py-3">
                      {lead.leadQuality ? (
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold',
                          lead.leadQuality === 'Hot'         ? 'bg-red-100 text-red-700'     :
                          lead.leadQuality === 'Warm'        ? 'bg-amber-100 text-amber-700' :
                          lead.leadQuality === 'Cold'        ? 'bg-blue-100 text-blue-700'   :
                          lead.leadQuality === 'Unqualified' ? 'bg-gray-100 text-gray-500'   :
                          'bg-emerald-100 text-emerald-700'
                        )}>{lead.leadQuality}</span>
                      ) : <span className="text-[#c4b09e]">-</span>}
                    </td>
                    <td className="px-3 py-3 text-[#7a6b5c] whitespace-nowrap">{format(new Date(lead.createdAt), 'dd/MM/yyyy hh:mm aa')}</td>
                    <td className="px-3 py-3 text-[#7a6b5c] whitespace-nowrap">{format(new Date(lead.lastActivity), 'dd/MM/yyyy hh:mm aa')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {listTotalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-black/[0.04]">
              <p className="text-[12px] text-[#7a6b5c]">
                Showing {filteredLeads.length === 0 ? 0 : (listSafePage - 1) * LIST_PAGE_SIZE + 1}–{Math.min(listSafePage * LIST_PAGE_SIZE, filteredLeads.length)} of {filteredLeads.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setListPage((p) => Math.max(1, p - 1))} disabled={listSafePage <= 1}
                  className="px-3 py-1.5 rounded-lg border border-black/10 text-[12px] font-medium text-[#1c1410] disabled:opacity-40 hover:border-primary/40 transition-colors">Prev</button>
                <span className="text-[12px] text-[#7a6b5c]">Page {listSafePage} / {listTotalPages}</span>
                <button onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))} disabled={listSafePage >= listTotalPages}
                  className="px-3 py-1.5 rounded-lg border border-black/10 text-[12px] font-medium text-[#1c1410] disabled:opacity-40 hover:border-primary/40 transition-colors">Next</button>
              </div>
            </div>
          )}
          {selectedIds.length > 0 && (
            <div className="px-5 py-2.5 bg-blue-50 border-t border-blue-100 flex items-center gap-2">
              <Settings className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <p className="text-[12px] text-blue-600">
                {selectedIds.length} contact(s) selected.{' '}
                <button onClick={() => setShowWorkflow(true)} className="font-bold underline hover:text-blue-800">Trigger Workflow</button>
              </p>
            </div>
          )}
        </div>
      )}
      </div>{/* end flex-1 board wrapper */}

      {selectedLead && <LeadDetailPanel lead={selectedLead} onClose={() => { setSelectedLeadId(null); setStateOpenLead(null); }} onLeadUpdated={(id, updates) => {
        if (apiLeads) {
          setApiLeads((prev) => prev?.map((l) => l.id === id ? { ...l, ...updates } : l) ?? null);
        }
      }} />}
      {showAddLead && <AddLeadModal onClose={() => setShowAddLead(false)} />}
      {showNewPipeline && <NewPipelineModal onClose={() => setShowNewPipeline(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showExportModal && (
        <ExportModal
          title="Export Leads"
          fields={LEAD_EXPORT_FIELDS}
          buildUrl={(fields, format) => `/api/leads/export?fields=${fields.join(',')}&format=${format}${selectedPipelineId ? `&pipeline_id=${selectedPipelineId}` : ''}`}
          onClose={() => setShowExportModal(false)}
        />
      )}
      {showWorkflow && <WorkflowModal leadIds={selectedIds.length > 0 ? selectedIds : filteredLeads.map((l) => l.id)} onClose={() => setShowWorkflow(false)} />}
      {quickEditLead && <EditLeadModal lead={quickEditLead} onClose={() => setQuickEditLead(null)} />}
      {quickNoteLead && <NoteModal leadId={quickNoteLead.id} onClose={() => setQuickNoteLead(null)} />}
      {quickFollowUpLead && <FollowUpModal leadId={quickFollowUpLead.id} onClose={() => setQuickFollowUpLead(null)} />}
      {quickAssignLead && <AssignModal lead={quickAssignLead} onClose={() => setQuickAssignLead(null)} />}
      {quickApptLead && <AppointmentModal lead={quickApptLead} onClose={() => setQuickApptLead(null)} />}

      {/* Mobile floating Add Lead button */}
      {isMobile && canCreateLead && !mobileSelectMode && selectedIds.length === 0 && (
        <button
          onClick={() => setShowAddLead(true)}
          aria-label="Add lead"
          className="md:hidden fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-primary text-white shadow-lg shadow-primary/30 flex items-center justify-center active:scale-95 transition-transform"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
