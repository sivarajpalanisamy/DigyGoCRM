import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Facebook, RefreshCw, Plus, Eye, Trash2, Check,
  X, User, Mail, Phone, Calendar, Search, Link, Key, Shuffle,
  ArrowLeft, Settings2, Zap, History, CalendarDays, Download, AlertTriangle,
  ChevronDown, GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AddCustomFieldModal, type CreatedField } from '@/components/fields/AddCustomFieldModal';
import { api } from '@/lib/api';
import { useCrmStore } from '@/store/crmStore';
import { type PipelineStage } from '@/data/mockData';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface MetaStatus {
  connected: boolean;
  tokenExpiry?: string;
  tokenExpired?: boolean;
  tokenDaysLeft?: number | null;
  connectedAt?: string | null;
  needsReconnect?: boolean;
  lastError?: string | null;
  lastErrorAt?: string | null;
  lastSuccessAt?: string | null;
  connectedPages?: Array<{ id: string; name: string }>;
  blockedPages?: Array<{ id: string; name: string }>;
}

interface MetaFormRow {
  id: string;
  page_id: string;
  page_name: string;
  form_id: string;
  form_name: string;
  is_active: boolean;
  leads_count: number;
  last_sync_at: string | null;
  pipeline_id?: string | null;
  stage_id?: string | null;
  pipeline_name?: string | null;
  stage_name?: string | null;
  field_mapping?: Array<{ fb_field: string; crm_field: string }> | null;
  meta_status?: string | null;
}

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
}

interface FbQuestion {
  key: string;
  label: string;
  type: string;
}

interface CustomField {
  id: string;
  name: string;
  slug: string;
  type: string;
}

interface FieldMapping {
  fb_field: string;
  crm_field: string;
}

const STANDARD_CRM_FIELDS = [
  { value: 'name', label: 'Full Name' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];

const CREATE_NEW = '__create_new__';

// ── Map Fields Modal ──────────────────────────────────────────────────────────

function MapFieldsModal({ form, onClose }: { form: MetaFormRow; onClose: () => void }) {
  const [questions, setQuestions] = useState<FbQuestion[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [mapping, setMapping] = useState<FieldMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createFieldOpen, setCreateFieldOpen] = useState(false);
  const [createForIndex, setCreateForIndex] = useState<number | null>(null);

  useEffect(() => {
    Promise.allSettled([
      api.get<{ questions: FbQuestion[]; form_name: string }>(`/api/integrations/meta/forms/${form.form_id}/questions`),
      api.get<CustomField[]>('/api/fields/custom'),
      api.get<FieldMapping[]>(`/api/integrations/meta/forms/${form.form_id}/mapping`),
    ]).then(([qRes, cfRes, mapRes]) => {
      const qData = qRes.status === 'fulfilled' ? qRes.value : null;
      const cfData = cfRes.status === 'fulfilled' ? cfRes.value : null;
      const savedMapping = mapRes.status === 'fulfilled' ? mapRes.value : null;
      const qs = qData?.questions ?? [];
      setQuestions(qs);
      setCustomFields(cfData ?? []);
      const saved: Record<string, string> = {};
      for (const m of (Array.isArray(savedMapping) ? savedMapping : [])) saved[m.fb_field] = m.crm_field;
      setMapping(qs.map((q) => ({
        fb_field: q.key,
        crm_field: saved[q.key] ?? '',
      })));
      if (qRes.status === 'rejected') toast.error('Could not load Facebook form fields');
    }).finally(() => setLoading(false));
  }, [form.form_id]);

  const handleSelectChange = (i: number, val: string) => {
    if (val === CREATE_NEW) {
      setCreateForIndex(i);
      setCreateFieldOpen(true);
    } else {
      setMapping((prev) => prev.map((m, idx) => idx === i ? { ...m, crm_field: val } : m));
    }
  };

  const handleFieldCreated = (cf: CreatedField) => {
    setCustomFields((prev) => [...prev, cf]);
    if (createForIndex !== null) {
      setMapping((prev) => prev.map((m, idx) => idx === createForIndex ? { ...m, crm_field: `custom:${cf.slug}` } : m));
    }
    setCreateFieldOpen(false);
    setCreateForIndex(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post(`/api/integrations/meta/forms/${form.form_id}/mapping`, { mapping: mapping.filter((m) => m.crm_field) });
      toast.success('Field mapping saved');
      onClose();
    } catch { toast.error('Failed to save mapping'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <div>
            <h3 className="font-headline font-bold text-[#1c1410] text-[15px]">Map Fields</h3>
            <p className="text-[11px] text-[#7a6b5c] mt-0.5">{form.form_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 px-6 py-3 bg-[var(--app-bg)] border-b border-black/5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Facebook Form Field</p>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">CRM Field</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-black/5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[13px] text-[#7a6b5c]">Loading fields…</div>
          ) : questions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-8">
              <Shuffle className="w-8 h-8 text-[#c4b09e]" />
              <p className="text-[13px] font-semibold text-[#1c1410]">No questions found</p>
              <p className="text-[12px] text-[#7a6b5c]">This form has no questions, or the Meta API returned no data.</p>
            </div>
          ) : (
            mapping.map((row, i) => {
              const q = questions.find((q) => q.key === row.fb_field);
              const label = q?.label ?? row.fb_field;
              return (
                <div key={row.fb_field} className={cn('px-6 py-4', i % 2 === 0 ? 'bg-[var(--app-bg)]/60' : 'bg-white')}>
                  <div className="grid grid-cols-2 gap-4 items-center">
                    <div>
                      <p className="text-[13px] text-[#1c1410] leading-snug">{label}</p>
                      {q?.type && q.type !== 'CUSTOM' && (
                        <p className="text-[10px] text-[#b09e8d] mt-0.5 uppercase">{q.type.replace(/_/g, ' ')}</p>
                      )}
                    </div>
                    <select
                      value={row.crm_field}
                      onChange={(e) => handleSelectChange(i, e.target.value)}
                      className="w-full border border-black/10 rounded-xl px-3 py-2.5 text-[13px] text-[#1c1410] bg-white outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="">- Select field -</option>
                      <optgroup label="Standard Fields">
                        {STANDARD_CRM_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </optgroup>
                      {customFields.length > 0 && (
                        <optgroup label="Custom Fields">
                          {customFields.map((cf) => (
                            <option key={cf.id} value={`custom:${cf.slug}`}>{cf.name}</option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="New">
                        <option value={CREATE_NEW}>＋ Create new field…</option>
                      </optgroup>
                    </select>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-black/5 bg-[var(--app-bg)]">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleSave} disabled={saving || loading || questions.length === 0}>
            {saving ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Check className="w-3.5 h-3.5 mr-1.5" />Save Mapping</>}
          </Button>
        </div>
      </div>
      {createFieldOpen && (
        <AddCustomFieldModal
          onClose={() => { setCreateFieldOpen(false); setCreateForIndex(null); }}
          onCreated={handleFieldCreated}
        />
      )}
    </div>
  );
}

// ── New Pipeline Modal (shared with Lead Management) ─────────────────────────

function SortableStageRow({ stage, idx, onUpdate, onRemove }: {
  stage: PipelineStage; idx: number;
  onUpdate: (id: string, value: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-2 group"
    >
      <button
        {...attributes} {...listeners}
        className="p-1 rounded text-[#c4b09e] hover:text-[#7a6b5c] cursor-grab active:cursor-grabbing transition-colors shrink-0"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-primary/40 bg-white transition-colors">
        <span className="text-[11px] text-[#b09e8d] w-5 shrink-0 font-medium">{idx + 1}.</span>
        <input
          className="flex-1 text-[13px] text-[#1c1410] outline-none bg-transparent placeholder:text-gray-300"
          placeholder="Stage name"
          value={stage.name}
          onChange={(e) => onUpdate(stage.id, e.target.value)}
        />
      </div>
      <button
        onClick={() => onRemove(stage.id)}
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-[#c4b09e] hover:text-red-500 transition-all shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function NewPipelineModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (pipelineId: string, stageId: string) => void;
}) {
  const { addPipeline } = useCrmStore();
  const [name, setName] = useState('');
  const [stages, setStages] = useState<PipelineStage[]>([
    { id: `s-${Date.now()}`, name: '', color: '#ea580c' },
  ]);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setStages((prev) => {
        const oldIdx = prev.findIndex((s) => s.id === active.id);
        const newIdx = prev.findIndex((s) => s.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  const addStage = () =>
    setStages((prev) => [...prev, { id: `s-${Date.now()}-${prev.length}`, name: '', color: '#ea580c' }]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Pipeline name is required'); return; }
    if (stages.some((s) => !s.name.trim())) { toast.error('All stages must have a name'); return; }
    setSaving(true);
    try {
      const before = new Set(useCrmStore.getState().pipelines.map((p) => p.id));
      await addPipeline({ id: '', name: name.trim(), stages });
      const newP = useCrmStore.getState().pipelines.find((p) => !before.has(p.id));
      toast.success(`Pipeline "${name.trim()}" created`);
      onCreated(newP?.id ?? '', newP?.stages[0]?.id ?? '');
    } catch {
      toast.error('Failed to create pipeline');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5 shrink-0">
          <h3 className="font-headline font-bold text-[#1c1410] text-[17px]">+ New Pipeline</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">
              Pipeline Name <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] text-[#1c1410] outline-none focus:border-primary/40 placeholder:text-gray-400"
              placeholder="e.g. Sales Pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12px] font-semibold text-[#7a6b5c]">Stages</label>
              <span className="text-[11px] text-[#b09e8d]">{stages.length} stage{stages.length !== 1 ? 's' : ''} · drag to reorder</span>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {stages.map((stage, idx) => (
                    <SortableStageRow
                      key={stage.id}
                      stage={stage}
                      idx={idx}
                      onUpdate={(id, val) => setStages((prev) => prev.map((s) => s.id === id ? { ...s, name: val } : s))}
                      onRemove={(id) => setStages((prev) => prev.filter((s) => s.id !== id))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <button
              onClick={addStage}
              className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:opacity-80 transition-opacity"
            >
              <Plus className="w-4 h-4" /> Add Stage
            </button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5 shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 rounded-xl text-[13px] font-bold text-white disabled:opacity-60 transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Import Config Modal ───────────────────────────────────────────────────────

function ImportConfigModal({
  form,
  type,
  onClose,
  onConfirm,
}: {
  form: MetaFormRow;
  type: 'old' | 'new';
  onClose: () => void;
  onConfirm: (pipelineId: string, stageId: string) => void;
}) {
  const { pipelines } = useCrmStore();

  const [selectedPipelineId, setSelectedPipelineId] = useState(form.pipeline_id ?? '');
  const [selectedStageId, setSelectedStageId] = useState(form.stage_id ?? '');
  const [showNewPipelineModal, setShowNewPipelineModal] = useState(false);

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const stages = selectedPipeline?.stages ?? [];

  useEffect(() => {
    if (!stages.find((s) => s.id === selectedStageId)) {
      setSelectedStageId(stages[0]?.id ?? '');
    }
  }, [selectedPipelineId]);

  const canImport = !!selectedPipelineId && !!selectedStageId;

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
            <div>
              <p className="text-[11px] text-[#7a6b5c]">{type === 'old' ? 'Import historical' : 'Import recent'} leads</p>
              <h3 className="font-bold text-[#1c1410] text-[15px] leading-tight">{form.form_name}</h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Pipeline row with + New Pipeline button */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-semibold text-[#1c1410]">
                  Pipeline <span className="text-red-500">*</span>
                </label>
                <button
                  onClick={() => setShowNewPipelineModal(true)}
                  className="flex items-center gap-1 text-[11px] font-bold text-primary hover:opacity-80 transition-opacity"
                >
                  <Plus className="w-3 h-3" /> New Pipeline
                </button>
              </div>
              <div className="relative">
                <select
                  value={selectedPipelineId}
                  onChange={(e) => setSelectedPipelineId(e.target.value)}
                  className="w-full appearance-none border border-black/10 rounded-xl px-3 py-2.5 pr-8 text-[13px] text-[#1c1410] bg-white outline-none focus:border-primary cursor-pointer"
                >
                  <option value="">Select pipeline…</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7a6b5c] pointer-events-none" />
              </div>
            </div>

            {/* Stage */}
            <div>
              <label className="text-[12px] font-semibold text-[#1c1410] mb-1.5 block">
                Stage <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={selectedStageId}
                  onChange={(e) => setSelectedStageId(e.target.value)}
                  disabled={!selectedPipelineId || stages.length === 0}
                  className="w-full appearance-none border border-black/10 rounded-xl px-3 py-2.5 pr-8 text-[13px] text-[#1c1410] bg-white outline-none focus:border-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <option value="">Select stage…</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7a6b5c] pointer-events-none" />
              </div>
            </div>

            {!canImport && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Select a pipeline and stage to continue. Leads will be placed here on import.
              </p>
            )}
          </div>

          <div className="flex gap-2 px-6 py-4 border-t border-black/5">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(selectedPipelineId, selectedStageId)}
              disabled={!canImport}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-40 transition-all"
              style={canImport ? { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' } : { background: '#d1cbc7' }}
            >
              {type === 'old' ? 'Import Old Leads' : 'Import New Leads'}
            </button>
          </div>
        </div>
      </div>

      {/* New Pipeline full modal — overlays ImportConfigModal */}
      {showNewPipelineModal && (
        <NewPipelineModal
          onClose={() => setShowNewPipelineModal(false)}
          onCreated={(pipelineId, stageId) => {
            setSelectedPipelineId(pipelineId);
            setSelectedStageId(stageId);
            setShowNewPipelineModal(false);
          }}
        />
      )}
    </>
  );
}

// ── Lead Detail Modal ─────────────────────────────────────────────────────────

interface FullLead extends Lead {
  source?: string;
  stage?: string;
  assigned_to?: string;
  deal_value?: number;
  tags?: string[];
  notes?: string;
  pipeline_name?: string;
  stage_name?: string;
  assigned_name?: string;
}

interface LeadField {
  field_name: string;
  field_type: string;
  slug: string;
  value: string;
}

function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [full, setFull] = useState<FullLead | null>(null);
  const [fields, setFields] = useState<LeadField[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get<FullLead>(`/api/leads/${lead.id}`),
      api.get<LeadField[]>(`/api/leads/${lead.id}/fields`),
    ]).then(([leadRes, fieldsRes]) => {
      if (leadRes.status === 'fulfilled') setFull(leadRes.value);
      if (fieldsRes.status === 'fulfilled') setFields(fieldsRes.value ?? []);
    }).finally(() => setLoading(false));
  }, [lead.id]);

  const initials = lead.name.split(' ').map((n) => n[0] ?? '').join('').slice(0, 2).toUpperCase();

  const SectionLabel = ({ text }: { text: string }) => (
    <p className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-2">{text}</p>
  );

  const Row = ({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) =>
    value ? (
      <div className="flex items-start gap-3 px-3 py-2.5 bg-[var(--app-bg)] rounded-xl">
        <Icon className="w-4 h-4 text-[#7a6b5c] shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-[#7a6b5c] font-medium uppercase tracking-wide">{label}</p>
          <p className="text-[13px] text-[#1c1410] font-medium break-words">{value}</p>
        </div>
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[14px] shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
              {initials}
            </div>
            <div>
              <h2 className="font-bold text-[15px] text-[#1c1410] leading-tight">{lead.name}</h2>
              <p className="text-[11px] text-[#7a6b5c] mt-0.5">
                {new Date(lead.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors shrink-0">
            <X className="w-4 h-4 text-[#7a6b5c]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Contact Info */}
              <div>
                <SectionLabel text="Contact Info" />
                <div className="space-y-2">
                  <Row icon={Phone} label="Phone" value={lead.phone} />
                  <Row icon={Mail} label="Email" value={lead.email} />
                </div>
              </div>

              {/* CRM Details */}
              {full && (full.stage_name || full.pipeline_name || full.assigned_name || full.deal_value) && (
                <div>
                  <SectionLabel text="CRM Details" />
                  <div className="space-y-2">
                    <Row icon={History} label="Pipeline" value={full.pipeline_name} />
                    <Row icon={Zap} label="Stage" value={full.stage_name ?? full.stage} />
                    <Row icon={User} label="Assigned To" value={full.assigned_name} />
                    {full.deal_value ? (
                      <Row icon={Key} label="Deal Value" value={`₹${Number(full.deal_value).toLocaleString()}`} />
                    ) : null}
                  </div>
                </div>
              )}

              {/* Tags */}
              {full?.tags && full.tags.length > 0 && (
                <div>
                  <SectionLabel text="Tags" />
                  <div className="flex flex-wrap gap-1.5">
                    {full.tags.map((t) => (
                      <span key={t} className="text-[11px] bg-primary/10 text-primary px-2.5 py-0.5 rounded-full font-medium">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional / Custom Fields */}
              <div>
                <SectionLabel text="Additional Fields" />
                {fields.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-3 bg-[var(--app-bg)] rounded-xl">
                    <Settings2 className="w-4 h-4 text-gray-300" />
                    <p className="text-[12px] text-[#b09e8d]">No additional fields recorded</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {fields.map((f, i) => (
                      <div key={i} className="flex items-start gap-3 px-3 py-2.5 bg-[var(--app-bg)] rounded-xl">
                        <Link className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] text-[#7a6b5c] font-medium uppercase tracking-wide">{f.field_name}</p>
                          <p className="text-[13px] text-[#1c1410] font-medium break-words">{f.value || '-'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Notes */}
              {full?.notes && (
                <div>
                  <SectionLabel text="Notes" />
                  <div className="px-3 py-2.5 bg-[var(--app-bg)] rounded-xl">
                    <p className="text-[13px] text-[#1c1410] whitespace-pre-wrap">{full.notes}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-black/5 flex justify-end shrink-0">
          <button
            onClick={() => { onClose(); window.location.href = `/leads?id=${lead.id}`; }}
            className="text-[12px] font-semibold text-primary hover:underline"
          >
            Open in Leads →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page Profile Picture ──────────────────────────────────────────────────────

function PageProfilePic({
  pageId, pageName, size = 'lg',
}: { pageId: string; pageName: string; size?: 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const sizeClass = size === 'lg' ? 'w-16 h-16 rounded-2xl' : 'w-8 h-8 rounded-xl';
  const iconClass = size === 'lg' ? 'w-7 h-7' : 'w-4 h-4';
  if (failed) {
    return (
      <div className={`${sizeClass} bg-[#1877F2] flex items-center justify-center shrink-0`}>
        <Facebook className={`${iconClass} text-white`} />
      </div>
    );
  }
  return (
    <img
      src={`https://graph.facebook.com/${pageId}/picture?type=square&width=200&height=200`}
      alt={pageName}
      className={`${sizeClass} object-cover shrink-0 bg-[#e8f0fe]`}
      onError={() => setFailed(true)}
    />
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MetaFormsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [forms, setForms] = useState<MetaFormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fetchingLeads, setFetchingLeads] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);

  // Detail view — which page is open (persisted in URL so refresh stays on same page)
  const [detailPage, setDetailPage] = useState<{ id: string; name: string } | null>(null);

  const openDetailPage = (page: { id: string; name: string }) => {
    setDetailPage(page);
    setSearchParams((p) => { p.set('page', page.id); return p; }, { replace: true });
  };
  const closeDetailPage = () => {
    setDetailPage(null);
    setSearchParams((p) => { p.delete('page'); return p; }, { replace: true });
  };


  // Blocked pages — visible via Business Manager but no page token
  const [blockedPages, setBlockedPages] = useState<Array<{ id: string; name: string }>>([]);
  const [connectBlockedPage, setConnectBlockedPage] = useState<{ id: string; name: string } | null>(null);
  const [blockedToken, setBlockedToken] = useState('');
  const [savingBlockedToken, setSavingBlockedToken] = useState(false);

  // Pre-OAuth instruction modal — shown before redirecting to Facebook
  // so users know to select ALL pages in the Facebook dialog
  const [oauthInstructionTarget, setOauthInstructionTarget] = useState<'connect' | 'add-page' | null>(null);

  const [openForm, setOpenForm] = useState<MetaFormRow | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [mapForm, setMapForm] = useState<MetaFormRow | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [triggerModal, setTriggerModal] = useState<MetaFormRow | null>(null);
  const [triggerWorkflows, setTriggerWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [triggerWorkflowId, setTriggerWorkflowId] = useState('');
  const [loadingTriggerWFs, setLoadingTriggerWFs] = useState(false);
  const [downloadModal, setDownloadModal] = useState(false);
  const [downloadFormId, setDownloadFormId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [historicalImportTarget, setHistoricalImportTarget] = useState<MetaFormRow | null>(null);
  const [disconnectPageTarget, setDisconnectPageTarget] = useState<{ id: string; name: string } | null>(null);
  const [disconnectingPage, setDisconnectingPage] = useState(false);
  const [deleteFormTarget, setDeleteFormTarget] = useState<MetaFormRow | null>(null);
  const [pushResult, setPushResult] = useState<{ formId: string; type: 'old'|'new'; pushed: number; created: number; existing: number; workflows: Array<{id:string;name:string}> } | null>(null);
  const [formLeads, setFormLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');

  useEffect(() => {
    const connectedParam = searchParams.get('connected');
    const needsTokenParam = searchParams.get('needs_token');
    const errorParam = searchParams.get('error');
    if (connectedParam === 'true') {
      if (needsTokenParam && Number(needsTokenParam) > 0) {
        toast.success(`Meta connected! ${needsTokenParam} page${Number(needsTokenParam) !== 1 ? 's' : ''} need a token to connect - see below.`);
      } else {
        toast.success('Meta connected - your pages are loading…');
      }
      // Clean URL so ?connected=true doesn't persist
      navigate('/lead-generation/meta-forms', { replace: true });
    } else if (errorParam === 'no_pages_selected') toast.error('No pages were connected. In the Facebook dialog, select the pages you want to grant access to.');
    else if (errorParam === 'no_pages_found') toast.error('No Facebook Business Pages found. You need a Page with Lead Ads enabled.');
    else if (errorParam) toast.error('Failed to connect Meta: ' + errorParam.replace(/_/g, ' '));

    // Load status first — shows connected pages immediately without waiting for form sync
    api.get<MetaStatus>('/api/integrations/meta/status')
      .then((s) => {
        if (s) {
          setStatus(s);
          setBlockedPages(s.blockedPages ?? []);
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));

    // Sync forms in background — shows spinner in the connected view while syncing
    setSyncing(true);
    api.get<MetaFormRow[]>('/api/integrations/meta/sync-forms')
      .catch(() => api.get<MetaFormRow[]>('/api/integrations/meta/connected-forms').catch(() => []))
      .then((f) => {
        const rows = f ?? [];
        setForms(rows);

        // Restore detail page from URL on refresh
        const pageIdFromUrl = searchParams.get('page');
        if (pageIdFromUrl && !detailPage) {
          const uniquePages = Array.from(new Map(rows.map((r) => [r.page_id, { id: r.page_id, name: r.page_name }])).values());
          const match = uniquePages.find((p) => p.id === pageIdFromUrl);
          if (match) setDetailPage(match);
        }

        // If no leads yet, poll every 5s up to 6 times while background fetch runs
        const totalLeads = rows.reduce((sum, r) => sum + (r.leads_count ?? 0), 0);
        if (rows.length > 0 && totalLeads === 0) {
          let attempts = 0;
          const poll = setInterval(async () => {
            attempts++;
            try {
              const fresh = await api.get<MetaFormRow[]>('/api/integrations/meta/connected-forms');
              setForms(fresh ?? []);
              const newTotal = (fresh ?? []).reduce((s, r) => s + (r.leads_count ?? 0), 0);
              if (newTotal > 0 || attempts >= 6) clearInterval(poll);
            } catch { clearInterval(poll); }
          }, 5000);
        }
      })
      .finally(() => setSyncing(false));
  }, [searchParams]);

  useEffect(() => {
    if (!openForm) { setFormLeads([]); return; }
    setLeadsLoading(true);

    const load = async () => {
      let leads = await api.get<Lead[]>(`/api/leads?source=meta_form&meta_form_id=${openForm.form_id}`).catch(() => [] as Lead[]);
      // If 0 results but form has known leads, auto-backfill meta_form_id + custom values
      if (leads.length === 0 && (openForm.leads_count ?? 0) > 0) {
        await api.post(`/api/integrations/meta/forms/${openForm.form_id}/backfill`).catch(() => null);
        leads = await api.get<Lead[]>(`/api/leads?source=meta_form&meta_form_id=${openForm.form_id}`).catch(() => [] as Lead[]);
      }
      return leads;
    };

    load().then(setFormLeads).catch(() => setFormLeads([])).finally(() => setLeadsLoading(false));
  }, [openForm]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { url } = await api.get<{ url: string }>('/api/integrations/meta/oauth-url');
      window.location.href = url;
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to get OAuth URL');
      setConnecting(false);
    }
  };

  const handleManualConnect = async () => {
    if (!manualToken.trim()) { toast.error('Paste a Page Access Token first'); return; }
    setSavingToken(true);
    try {
      const result = await api.post<{ pages: Array<{ id: string; name: string }> }>(
        '/api/integrations/meta/manual-connect', { access_token: manualToken.trim() }
      );
      const pageCount = result.pages?.length ?? 0;
      toast.success(`Connected ${pageCount} page${pageCount !== 1 ? 's' : ''}. Forms synced.`);
      const [s, f] = await Promise.all([
        api.get<MetaStatus>('/api/integrations/meta/status').catch(() => null),
        api.get<MetaFormRow[]>('/api/integrations/meta/sync-forms').catch(() => []),
      ]);
      if (s) setStatus(s);
      setForms(f ?? []);
      setShowManual(false);
      setManualToken('');
    } catch (err: any) {
      toast.error(err?.message ?? 'Invalid token');
    } finally {
      setSavingToken(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.delete('/api/integrations/meta/disconnect');
      setStatus({ connected: false });
      setForms([]);
      closeDetailPage();
      setShowDisconnectConfirm(false);
      toast.success('Meta disconnected');
    } catch { toast.error('Failed to disconnect'); }
  };

  const handleDisconnectPage = async () => {
    if (!disconnectPageTarget) return;
    setDisconnectingPage(true);
    try {
      const res = await api.delete<{ fullyDisconnected: boolean }>(`/api/integrations/meta/pages/${disconnectPageTarget.id}`);
      if (res.fullyDisconnected) {
        setStatus({ connected: false });
        setForms([]);
        closeDetailPage();
        toast.success('Meta disconnected - no pages remaining');
      } else {
        setStatus((prev) => ({
          ...prev,
          connectedPages: (prev?.connectedPages ?? []).filter((p) => p.id !== disconnectPageTarget.id),
        }));
        setForms((prev) => prev.filter((f) => f.page_id !== disconnectPageTarget.id));
        if (detailPage?.id === disconnectPageTarget.id) closeDetailPage();
        toast.success(`"${disconnectPageTarget.name}" disconnected`);
      }
      setDisconnectPageTarget(null);
    } catch { toast.error('Failed to disconnect page'); }
    finally { setDisconnectingPage(false); }
  };

  const handleConnectBlockedPage = async () => {
    if (!blockedToken.trim()) { toast.error('Paste a Page Access Token first'); return; }
    setSavingBlockedToken(true);
    try {
      const result = await api.post<{ pages: Array<{ id: string; name: string }>; needsToken: Array<{ id: string; name: string }> }>(
        '/api/integrations/meta/manual-connect', { access_token: blockedToken.trim() }
      );
      const pageCount = result.pages?.length ?? 0;
      toast.success(`Connected ${pageCount} page${pageCount !== 1 ? 's' : ''}. Forms synced.`);
      const [s, f] = await Promise.all([
        api.get<MetaStatus>('/api/integrations/meta/status').catch(() => null),
        api.get<MetaFormRow[]>('/api/integrations/meta/sync-forms').catch(() => forms),
      ]);
      if (s) {
        setStatus(s);
        setBlockedPages(s.blockedPages ?? []);
      }
      setForms(f ?? []);
      setConnectBlockedPage(null);
      setBlockedToken('');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to connect - check that the token is a valid Page Access Token');
    } finally {
      setSavingBlockedToken(false);
    }
  };

  const downloadExcel = (rows: Lead[], sheetName: string, filename: string) => {
    const data = rows.map((l) => ({
      'Name':  l.name  ?? '',
      'Email': l.email ?? '',
      'Phone': l.phone ?? '',
      'Date':  l.created_at ? new Date(l.created_at).toLocaleDateString() : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    // Auto-fit column widths
    ws['!cols'] = [{ wch: 28 }, { wch: 32 }, { wch: 18 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename);
  };

  const openTriggerModal = async (form: MetaFormRow) => {
    setTriggerWorkflowId('');
    setTriggerModal(form);
    setLoadingTriggerWFs(true);
    try {
      const wfs = await api.get<Array<{ id: string; name: string }>>(`/api/integrations/meta/forms/${form.form_id}/workflows`);
      setTriggerWorkflows(wfs);
    } catch {
      setTriggerWorkflows([]);
    } finally {
      setLoadingTriggerWFs(false);
    }
  };

  const handlePushToAutomation = async (form: MetaFormRow, type: 'old' | 'new', workflowId?: string) => {
    const key = `push-${form.form_id}-${type}`;
    setExportingId(`${form.form_id}-${type}`);
    setPushResult(null);
    setTriggerModal(null);
    toast.loading(`Fetching ${type === 'old' ? 'historical' : 'new'} leads from Meta…`, { id: key });
    try {
      const result = await api.post<{ pushed: number; created: number; existing: number; workflows: Array<{id:string;name:string}>; done?: number; skipped?: number; failed?: number }>(
        `/api/integrations/meta/forms/${form.form_id}/push-automation?type=${type}`,
        workflowId ? { workflow_id: workflowId } : {}
      );
      toast.dismiss(key);
      const { pushed, created, existing, workflows, done = 0, skipped = 0, failed = 0 } = result;

      if (pushed === 0) {
        const isArchived = form.meta_status && form.meta_status !== 'ACTIVE';
        toast.info(
          isArchived
            ? `No leads found - this form is ${form.meta_status?.toLowerCase()} in Meta. Sync first or check Meta Ads Manager.`
            : `No ${type === 'old' ? 'historical' : 'new'} leads found in Meta for this form`
        );
      } else if (workflows.length === 0) {
        setPushResult({ formId: form.form_id, type, pushed, created, existing, workflows: [] });
        toast.warning(`${pushed} lead${pushed !== 1 ? 's' : ''} added to CRM - no automation ran. Set up a workflow with a Meta Form trigger first.`);
      } else {
        setPushResult({ formId: form.form_id, type, pushed, created, existing, workflows });
        const parts = [`Done: ${done}`];
        if (skipped > 0) parts.push(`Skipped: ${skipped}`);
        if (failed > 0)  parts.push(`Failed: ${failed}`);
        const allSkipped = done === 0 && skipped > 0 && failed === 0;
        if (allSkipped) {
          toast.warning(`${pushed} lead${pushed !== 1 ? 's' : ''} pushed - all skipped (already enrolled). Enable "Allow Re-entry" on the workflow to re-run.`);
        } else {
          toast.success(`${pushed} lead${pushed !== 1 ? 's' : ''} pushed - ${parts.join(', ')}`);
        }
      }
      // Refresh from server for accurate count (backend recalculates from CRM leads)
      const fresh = await api.get<MetaFormRow[]>('/api/integrations/meta/connected-forms').catch(() => forms);
      setForms((prev) => prev.map((f) => {
        const updated = fresh.find((r) => r.id === f.id);
        return updated ?? f;
      }));
    } catch (err: any) {
      toast.dismiss(key);
      toast.error(err?.message ?? 'Failed to push leads to automation');
    } finally {
      setExportingId(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.get<{ forms: MetaFormRow[]; synced: number; failed: number; errors: string[] }>(
        '/api/integrations/meta/sync-forms?force=1'
      );
      setForms(res.forms);
      if (res.failed > 0 && res.errors.length > 0) {
        toast.error(`Sync issue: ${res.errors[0]}${res.errors.length > 1 ? ` (+${res.errors.length - 1} more)` : ''}`);
      } else if (res.forms.length === 0) {
        toast.warning('No forms found - create a Lead Ad form in Meta Ads Manager first, then sync again.');
      } else {
        toast.success(`Forms synced - ${res.synced} form${res.synced !== 1 ? 's' : ''} found across all pages`);
      }
    } catch { toast.error('Sync failed - your Meta token may have expired. Reconnect to fix.'); }
    finally { setSyncing(false); }
  };

  const handleFetchAllLeads = async () => {
    setFetchingLeads(true);
    try {
      const result = await api.post<{ totalInserted: number; forms: any[] }>(
        '/api/integrations/meta/fetch-all-leads', {}
      );
      toast.success(
        result.totalInserted > 0
          ? `Imported ${result.totalInserted} new lead${result.totalInserted !== 1 ? 's' : ''} from Meta`
          : 'All leads already up to date'
      );
      const fresh = await api.get<MetaFormRow[]>('/api/integrations/meta/connected-forms').catch(() => forms);
      setForms(fresh);
    } catch (err: any) { toast.error(err?.message ?? 'Failed to fetch leads from Meta'); }
    finally { setFetchingLeads(false); }
  };

  const handleDownloadLeads = async () => {
    if (!downloadFormId) return;
    setDownloading(true);
    try {
      const result = await api.get<{ form_name: string; leads: any[] }>(
        `/api/integrations/meta/forms/${downloadFormId}/download-leads`
      );
      const { form_name, leads } = result;
      if (leads.length === 0) { toast.info('No leads found for this form in Meta'); return; }

      // Collect all unique field names across every lead
      const fieldNames: string[] = [];
      const seenFields = new Set<string>();
      for (const lead of leads) {
        for (const f of lead.field_data ?? []) {
          if (!seenFields.has(f.name)) { seenFields.add(f.name); fieldNames.push(f.name); }
        }
      }

      const headers = ['Lead ID', 'Submitted At', ...fieldNames];
      const rows = leads.map((lead) => {
        const fieldMap: Record<string, string> = {};
        for (const f of lead.field_data ?? []) fieldMap[f.name] = (f.values ?? []).join(', ');
        const row: Record<string, string> = {
          'Lead ID': lead.id ?? '',
          'Submitted At': lead.created_time ? new Date(lead.created_time).toLocaleString('en-IN') : '',
        };
        for (const name of fieldNames) row[name] = fieldMap[name] ?? '';
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      ws['!cols'] = headers.map(() => ({ wch: 24 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, form_name.slice(0, 31));
      XLSX.writeFile(wb, `${form_name}_leads.xlsx`);
      toast.success(`Downloaded ${leads.length} lead${leads.length !== 1 ? 's' : ''} from "${form_name}"`);
      setDownloadModal(false);
      setDownloadFormId('');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to download leads');
    } finally {
      setDownloading(false);
    }
  };

  const toggleForm = async (form: MetaFormRow) => {
    if (!form.is_active) {
      const mappedCount = (form.field_mapping as any[] | null)?.length ?? 0;
      if (mappedCount === 0) {
        toast.error('Map fields first before activating this form');
        return;
      }
    }
    try {
      const updated = await api.patch<MetaFormRow>(`/api/integrations/meta/connected-forms/${form.id}`, {
        is_active: !form.is_active,
      });
      setForms((prev) => prev.map((f) => f.id === form.id ? { ...f, is_active: updated.is_active } : f));
      toast.success(`${form.form_name} ${updated.is_active ? 'auto-import ON - new leads will capture automatically' : 'auto-import OFF - manual import still works'}`);
    } catch { toast.error('Failed to update'); }
  };

  const deleteForm = async (form: MetaFormRow) => {
    setDeleteFormTarget(form);
  };

  const confirmDeleteForm = async () => {
    if (!deleteFormTarget) return;
    const form = deleteFormTarget;
    setDeleteFormTarget(null);
    try {
      await api.delete(`/api/integrations/meta/connected-forms/${form.id}`);
      setForms((prev) => prev.filter((f) => f.id !== form.id));
      if (openForm?.id === form.id) setOpenForm(null);
      toast.success(`"${form.form_name}" removed`);
    } catch { toast.error('Failed to remove form'); }
  };

  const pages = useMemo(() => {
    const blockedIds = new Set((status?.blockedPages ?? []).map((p) => p.id));
    const seen = new Map<string, string>();
    for (const p of status?.connectedPages ?? []) {
      if (!blockedIds.has(p.id)) seen.set(p.id, p.name);
    }
    for (const f of forms) {
      if (!blockedIds.has(f.page_id)) seen.set(f.page_id, f.page_name || seen.get(f.page_id) || f.page_id);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [forms, status]);

  const filteredLeads = useMemo(() => {
    if (!contactSearch.trim()) return formLeads;
    const q = contactSearch.toLowerCase();
    return formLeads.filter((l) =>
      l.name.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q) ||
      l.phone?.includes(q)
    );
  }, [formLeads, contactSearch]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="text-center py-16 text-[13px] text-[#7a6b5c]">Loading…</div>;
  }

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!status?.connected) {
    return (
      <>
      <div className="space-y-5">
        <div>
          <h2 className="font-headline font-bold text-[#1c1410] text-[16px]">Meta Forms</h2>
          <p className="text-[12px] text-[#7a6b5c] mt-0.5">Connect Facebook Lead Ads to auto-capture leads</p>
        </div>
        <div className="bg-white rounded-2xl border border-black/5 card-shadow px-8 py-16 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Facebook className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="font-headline font-bold text-[#1c1410] text-[16px] mb-2">Connect Meta Account</h3>
          <p className="text-[13px] text-[#7a6b5c] mb-6 max-w-xs mx-auto">
            Authorise DigyGo CRM to receive leads from your Facebook & Instagram Lead Ads in real time.
          </p>
          {!showManual ? (
            <div className="flex flex-col items-center gap-3">
              <Button onClick={() => setOauthInstructionTarget('connect')} disabled={connecting} className="bg-[#1877F2] hover:bg-[#166FE5] text-white">
                <Facebook className="w-4 h-4" />
                {connecting ? 'Redirecting…' : 'Connect with Facebook'}
              </Button>
              <button
                onClick={() => setShowManual(true)}
                className="flex items-center gap-1.5 text-[11px] text-[#7a6b5c] hover:text-primary transition-colors"
              >
                <Key className="w-3 h-3" /> Use Page Access Token manually
              </button>
            </div>
          ) : (
            <div className="w-full max-w-sm space-y-3">
              <p className="text-[12px] text-[#7a6b5c] text-left">
                Paste your <strong>Page Access Token</strong> from{' '}
                <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Graph API Explorer
                </a>
              </p>
              <textarea
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Paste token here…"
                rows={3}
                className="w-full border border-black/10 rounded-xl px-3 py-2 text-[12px] text-[#1c1410] resize-none outline-none focus:border-primary"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => { setShowManual(false); setManualToken(''); }}>
                  Cancel
                </Button>
                <Button size="sm" className="flex-1" onClick={handleManualConnect} disabled={savingToken}>
                  {savingToken ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pre-OAuth instruction modal */}
      {oauthInstructionTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#1877F2] flex items-center justify-center shrink-0">
                  <Facebook className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-[#1c1410] text-[15px]">Before you connect</h3>
                  <p className="text-[11px] text-[#7a6b5c] mt-0.5">Read this to connect all your pages</p>
                </div>
              </div>
              <button onClick={() => setOauthInstructionTarget(null)} className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[12px] text-amber-800 leading-relaxed">
                  <strong>Facebook only connects pages you explicitly select.</strong> If you skip the page selection or leave pages unchecked, those pages will not appear in the CRM.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-[12px] font-bold text-[#1c1410]">In the Facebook dialog that opens:</p>
                <ol className="space-y-2.5">
                  {[
                    { label: 'Click "Edit" next to the pages list', detail: 'Do not skip this - it shows all your pages' },
                    { label: 'Check EVERY page you want to connect', detail: 'Select all of them, not just a few' },
                    { label: 'Click "Continue" to confirm', detail: 'Then finish the authorization' },
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-[#1877F2] text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <div>
                        <p className="text-[12px] font-semibold text-[#1c1410]">{step.label}</p>
                        <p className="text-[11px] text-[#9a8a7c]">{step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setOauthInstructionTarget(null)} className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold text-[#7a6b5c] border border-black/10 hover:bg-[var(--app-bg)] transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => { setOauthInstructionTarget(null); handleConnect(); }}
                  disabled={connecting}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold text-white bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60 transition-colors"
                >
                  <Facebook className="w-4 h-4" />
                  {connecting ? 'Redirecting…' : 'Open Facebook →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  // ── Page Detail View ───────────────────────────────────────────────────────
  if (detailPage) {
    const pageForms = forms.filter((f) => f.page_id === detailPage.id);
    const activeCount = pageForms.filter((f) => f.is_active).length;
    const totalLeads = pageForms.reduce((s, f) => s + (f.leads_count ?? 0), 0);

    return (
      <div className="space-y-5">

        {/* Back button */}
        <button
          onClick={() => { closeDetailPage(); setOpenForm(null); }}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#7a6b5c] hover:text-[#1c1410] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All Pages
        </button>

        {/* Page header card */}
        <div className="bg-white rounded-2xl border border-black/5 card-shadow px-5 py-4 flex items-center gap-4">
          <PageProfilePic pageId={detailPage.id} pageName={detailPage.name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-headline font-bold text-[#1c1410] text-[18px] truncate">{detailPage.name}</h2>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                <Check className="w-2.5 h-2.5" /> Connected
              </span>
            </div>
            <p className="text-[12px] text-[#7a6b5c] mt-0.5">Lead Capture · Facebook Page</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => { setDownloadFormId(''); setDownloadModal(true); }}
              disabled={syncing}
              className="bg-primary hover:bg-primary/90 text-white"
            >
              <Download className="w-3.5 h-3.5" />Download Leads
            </Button>
            <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || fetchingLeads}>
              <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
              {syncing ? 'Syncing…' : 'Sync Forms'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open('https://business.facebook.com/latest/ads_manager/forms', '_blank')}
            >
              <Plus className="w-3.5 h-3.5" /> New Form in Meta
            </Button>
          </div>
        </div>

        {/* Forms list */}
        {/* Token expiry warning banner */}
        {status?.tokenExpired && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-red-800">Meta token expired - leads are no longer syncing</p>
              <p className="text-[11px] text-red-700 mt-0.5">Reconnect your Facebook account to resume automatic lead capture.</p>
            </div>
            <button
              onClick={() => closeDetailPage()}
              className="text-[11px] font-semibold text-red-700 underline shrink-0"
            >Reconnect</button>
          </div>
        )}
        {/* Connection unhealthy (token invalid / #190 / rate-limited) but not flagged expired */}
        {status?.needsReconnect && !status?.tokenExpired && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-red-800">Lead capture disconnected - new leads are NOT being captured</p>
              <p className="text-[11px] text-red-700 mt-0.5">
                {status.lastError ? `Meta error: ${status.lastError}. ` : ''}Reconnect your Facebook account to resume.
                {status.lastSuccessAt ? ` Last successful sync: ${new Date(status.lastSuccessAt).toLocaleString()}.` : ''}
              </p>
            </div>
            <button
              onClick={() => closeDetailPage()}
              className="text-[11px] font-semibold text-red-700 underline shrink-0"
            >Reconnect</button>
          </div>
        )}
        {!status?.tokenExpired && status?.tokenDaysLeft !== null && status?.tokenDaysLeft !== undefined && status.tokenDaysLeft <= 7 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-amber-800">Meta token expires in {status.tokenDaysLeft} day{status.tokenDaysLeft !== 1 ? 's' : ''}</p>
              <p className="text-[11px] text-amber-700 mt-0.5">Reconnect now to avoid disruption to lead capture.</p>
            </div>
            <button
              onClick={() => closeDetailPage()}
              className="text-[11px] font-semibold text-amber-700 underline shrink-0"
            >Reconnect</button>
          </div>
        )}


        {pageForms.length === 0 ? (
          <div className="bg-white rounded-2xl border border-black/5 card-shadow px-8 py-14 text-center">
            <div className="w-12 h-12 bg-[var(--accent-tint)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Link className="w-6 h-6 text-primary" />
            </div>
            <p className="text-[14px] font-semibold text-[#1c1410] mb-1">No forms yet</p>
            <p className="text-[12px] text-[#7a6b5c] max-w-xs mx-auto mb-4">
              Once you create a Lead Ad form for <strong>{detailPage.name}</strong> in Meta Ads Manager, it will appear here automatically.
            </p>
            <button
              onClick={() => window.open('https://business.facebook.com/latest/ads_manager/forms', '_blank')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold text-white bg-[#1877F2] hover:bg-[#166FE5] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Create a form in Meta
            </button>
          </div>
        ) : (
          /* Single unified table — all forms in one row each */
          <div className="bg-white rounded-2xl border border-black/5 card-shadow divide-y divide-black/5 overflow-hidden">
            {pageForms.map((form) => {
              const mappedCount = (form.field_mapping as any[] | null)?.length ?? 0;
              const isMapped = mappedCount > 0;
              const isActive = form.is_active;
              return (
                <div key={form.id} className="flex items-center gap-3 px-5 py-4 hover:bg-[var(--app-bg)] transition-colors">

                  {/* Icon */}
                  <div className="w-9 h-9 rounded-xl bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-primary" />
                  </div>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-[#1c1410] truncate">{form.form_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {isMapped ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <Check className="w-2.5 h-2.5" /> {mappedCount} fields mapped
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setMapForm(form); }}
                          className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer"
                        >
                          Fields not mapped - click to map
                        </button>
                      )}
                      {isMapped && (
                        <span className="text-[11px] text-[#b09e8d]">{(form.leads_count ?? 0).toLocaleString()} leads</span>
                      )}
                      {isActive && (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          live
                        </span>
                      )}
                      {form.meta_status && form.meta_status !== 'ACTIVE' && (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          {form.meta_status.toLowerCase()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Map Fields — always available */}
                  <button
                    onClick={() => setMapForm(form)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-[12px] font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    <Shuffle className="w-3.5 h-3.5" /> Map Fields
                  </button>

                  {/* Toggle — disabled until fields are mapped; controls real-time auto-import only */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[11px] font-medium ${isActive ? 'text-emerald-600' : 'text-[#b09e8d]'}`}>
                      {isActive ? 'Auto' : 'Manual'}
                    </span>
                    <span title={!isMapped ? 'Map fields first to enable auto-import' : isActive ? 'Auto ON - captures only NEW leads going forward. Does not import past leads.' : 'Enable to capture new leads from Meta ads in real time (past leads not imported)'}>
                      <Switch
                        checked={isActive}
                        onCheckedChange={() => isMapped && toggleForm(form)}
                        disabled={!isMapped}
                        className={!isMapped ? 'opacity-40 cursor-not-allowed' : ''}
                      />
                    </span>
                  </div>

                  {/* Import + View — available as soon as fields are mapped */}
                  {isMapped && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setHistoricalImportTarget(form)}
                        disabled={!!exportingId}
                        title="Import all leads ever submitted to this form from Meta (past leads)"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--accent-tint)] text-primary hover:bg-primary hover:text-white disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {exportingId === `${form.form_id}-old`
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <History className="w-3 h-3" />}
                        Import Historical Leads
                      </button>
                      <button
                        onClick={() => { setOpenForm(form); setContactSearch(''); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-tint)] text-primary hover:bg-[var(--accent-tint)] text-[12px] font-semibold transition-colors whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Leads
                      </button>
                    </div>
                  )}


                </div>
              );
            })}
          </div>
        )}

        {/* Leads slide-in panel */}
        {openForm && (
          <>
            <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpenForm(null)} />
            <div className="fixed right-0 top-0 h-full z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
              <div className="flex items-start justify-between px-6 py-5 border-b border-black/5">
                <div>
                  <h3 className="font-headline font-bold text-[#1c1410] text-[15px]">{openForm.form_name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-4 h-4 rounded bg-[#1877F2] flex items-center justify-center">
                      <Facebook className="w-2.5 h-2.5 text-white" />
                    </div>
                    <span className="text-[11px] text-[#7a6b5c]">{openForm.page_name}</span>
                    <span className="text-[11px] text-[#b09e8d]">·</span>
                    <span className="text-[11px] font-semibold text-[#1c1410]">{openForm.leads_count.toLocaleString()} leads</span>
                  </div>
                </div>
                <button
                  onClick={() => setOpenForm(null)}
                  className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[#1c1410] transition-colors mt-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-3 border-b border-black/5">
                <div className="flex items-center gap-2 bg-[var(--app-bg)] border border-black/8 rounded-xl px-3 py-2">
                  <Search className="w-3.5 h-3.5 text-[#b09e8d] shrink-0" />
                  <input
                    type="text"
                    placeholder="Search by name, email or phone…"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="flex-1 bg-transparent text-[12px] text-[#1c1410] placeholder-[#b09e8d] outline-none"
                  />
                  {contactSearch && (
                    <button onClick={() => setContactSearch('')} className="text-[#b09e8d] hover:text-primary transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {leadsLoading ? (
                  <div className="flex items-center justify-center h-full text-[13px] text-[#7a6b5c]">Loading leads…</div>
                ) : filteredLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                    <div className="w-12 h-12 bg-[var(--accent-tint)] rounded-2xl flex items-center justify-center">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <p className="text-[13px] font-semibold text-[#1c1410]">No leads found</p>
                    <p className="text-[12px] text-[#7a6b5c]">
                      {contactSearch ? 'Try a different search term.' : 'No leads from this form yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-black/5">
                    {filteredLeads.map((lead) => (
                      <div
                        key={lead.id}
                        className="flex items-start gap-3 px-5 py-4 hover:bg-[var(--app-bg)] transition-colors cursor-pointer group"
                        onClick={() => setSelectedLead(lead)}
                      >
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-[13px] font-bold text-primary">
                            {lead.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[#1c1410] group-hover:text-primary transition-colors truncate">
                            {lead.name}
                          </p>
                          {lead.email && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <Mail className="w-3 h-3 text-[#b09e8d] shrink-0" />
                              <span className="text-[11px] text-[#7a6b5c] truncate">{lead.email}</span>
                            </div>
                          )}
                          {lead.phone && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <Phone className="w-3 h-3 text-[#b09e8d] shrink-0" />
                              <a href={`tel:${lead.phone}`} className="text-[11px] text-[#7a6b5c] hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>{lead.phone}</a>
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="flex items-center gap-1 text-[10px] text-[#b09e8d]">
                            <Calendar className="w-3 h-3" />
                            <span className="whitespace-nowrap">{new Date(lead.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t border-black/5 flex items-center justify-between">
                <span className="text-[11px] text-[#7a6b5c]">{filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}</span>
                <Button size="sm" variant="outline" onClick={() => navigate('/leads?source=meta_form')}>
                  View All in Leads
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Lead detail modal */}
        {selectedLead && <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />}

        {/* Map Fields modal */}
        {mapForm && (
          <MapFieldsModal form={mapForm} onClose={() => {
            api.get<MetaFormRow[]>('/api/integrations/meta/connected-forms').then(setForms).catch(() => {});
            setMapForm(null);
          }} />
        )}

        {/* Download Leads modal */}
        {downloadModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-[16px] font-bold text-[#1c1410]">Download Leads</h3>
                  <p className="text-[11px] text-[#7a6b5c] mt-0.5">Download all lead data from Meta as Excel</p>
                </div>
                <button onClick={() => setDownloadModal(false)} className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245] mb-1.5">Select Form</label>
              <div className="relative">
                <select
                  value={downloadFormId}
                  onChange={(e) => setDownloadFormId(e.target.value)}
                  className="w-full appearance-none bg-[#f5f0eb] border border-black/8 rounded-xl px-4 py-2.5 text-[13px] text-[#1c1410] outline-none focus:ring-2 focus:ring-primary/20 pr-9 cursor-pointer"
                >
                  <option value="">- Choose a form -</option>
                  {forms.filter((f) => f.page_id === detailPage.id).map((f) => (
                    <option key={f.form_id} value={f.form_id}>{f.form_name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9e8e7e] pointer-events-none" />
              </div>
              <p className="text-[11px] text-[#9e8e7e] mt-2">All fields submitted by leads will be included as columns in the Excel file.</p>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setDownloadModal(false)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDownloadLeads}
                  disabled={!downloadFormId || downloading}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-40 flex items-center justify-center gap-1.5 transition-all"
                  style={downloadFormId && !downloading ? { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' } : { background: '#d1cbc7' }}
                >
                  {downloading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Downloading…</> : <><Download className="w-3.5 h-3.5" />Download</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Trigger Workflow modal */}
        {triggerModal && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-[16px] font-bold text-[#1c1410]">Trigger Workflow</h3>
                  <p className="text-[11px] text-[#7a6b5c] mt-0.5 truncate max-w-[240px]">{triggerModal.form_name}</p>
                </div>
                <button onClick={() => setTriggerModal(null)} className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[12px] text-[#7a6b5c] mb-3">Select the workflow to run for all imported leads. Only the selected workflow will execute.</p>
              <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245] mb-1.5">Select Active Workflow</label>
              {loadingTriggerWFs ? (
                <div className="flex items-center justify-center h-10 text-[#9e8e7e] text-[12px] gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading workflows…
                </div>
              ) : triggerWorkflows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-black/10 px-4 py-5 text-center">
                  <Zap className="w-6 h-6 text-[#d4c9bc] mx-auto mb-2" />
                  <p className="text-[12px] font-semibold text-[#1c1410]">No active workflows</p>
                  <p className="text-[11px] text-[#9e8e7e] mt-0.5 mb-3">Create a workflow with a Meta Form trigger and select this form.</p>
                  <button
                    onClick={() => { setTriggerModal(null); navigate('/automation/workflows'); }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-[#a33a0a] transition-colors"
                  >
                    <Zap className="w-3 h-3" /> Go to Automation
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={triggerWorkflowId}
                    onChange={(e) => setTriggerWorkflowId(e.target.value)}
                    className="w-full appearance-none bg-[#f5f0eb] border border-black/8 rounded-xl px-4 py-2.5 text-[13px] text-[#1c1410] outline-none focus:ring-2 focus:ring-primary/20 pr-9 cursor-pointer"
                  >
                    <option value="">- Choose a workflow -</option>
                    {triggerWorkflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>{wf.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9e8e7e] pointer-events-none" />
                </div>
              )}
              <div className="flex flex-col gap-2 mt-5">
                <div className="flex gap-2">
                  <button
                    onClick={() => setTriggerModal(null)}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handlePushToAutomation(triggerModal, 'old', triggerWorkflowId || undefined)}
                    disabled={!triggerWorkflowId}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-40 transition-all"
                    style={triggerWorkflowId ? { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' } : { background: '#d1cbc7' }}
                  >
                    Run Workflow
                  </button>
                </div>
                {triggerWorkflows.length > 0 && (
                  <button
                    onClick={() => handlePushToAutomation(triggerModal, 'old')}
                    className="w-full py-2 rounded-xl text-[12px] font-medium text-[#7a6b5c] border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                  >
                    Import leads + run all matching workflows
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // ── Pages Grid (main view) ─────────────────────────────────────────────────
  const totalLeadsAll = forms.reduce((s, f) => s + (f.leads_count ?? 0), 0);
  const activeForms = forms.filter((f) => f.is_active).length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-headline font-bold text-[#1c1410] text-[16px]">Meta Forms</h2>
          <p className="text-[12px] text-[#7a6b5c] mt-0.5">
            {pages.length} page{pages.length !== 1 ? 's' : ''} connected
            {blockedPages.length > 0 && (
              <span className="text-amber-600 font-semibold"> · {blockedPages.length} need{blockedPages.length === 1 ? 's' : ''} token</span>
            )}
            {' '}· {activeForms} active form{activeForms !== 1 ? 's' : ''} · {totalLeadsAll.toLocaleString()} leads
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Sync'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowDisconnectConfirm(true)} className="text-red-500 hover:bg-red-50 border-red-200">
            Disconnect
          </Button>
        </div>
      </div>

      {/* "Not all pages showing?" persistent hint */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-blue-800">
            <strong>Missing a page?</strong> Facebook only connects pages you selected during authorization.
            Click <button onClick={() => setOauthInstructionTarget('add-page')} className="underline font-bold hover:text-blue-600">Reconnect & Select All Pages</button> to open the Facebook dialog and tick every page you want.
          </p>
        </div>
      </div>

      {/* Page Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

        {pages.map((page) => {
          const pageForms = forms.filter((f) => f.page_id === page.id);
          const pageLeads = pageForms.reduce((s, f) => s + (f.leads_count ?? 0), 0);
          return (
            <div
              key={page.id}
              onClick={() => openDetailPage(page)}
              className="bg-white rounded-2xl border border-black/5 card-shadow p-5 flex flex-col gap-4 text-left cursor-pointer hover:border-blue-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 w-full relative"
            >
              {/* Top row: profile pic + Connected badge + disconnect icon */}
              <div className="flex items-start justify-between">
                <PageProfilePic pageId={page.id} pageName={page.name} />
                <div className="flex items-center gap-2">
                  {status?.needsReconnect ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200" title={status.lastError ?? 'Reconnect to resume lead capture'}>
                      <AlertTriangle className="w-2.5 h-2.5" /> Needs Reconnect
                    </span>
                  ) : status?.tokenExpired ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
                      <AlertTriangle className="w-2.5 h-2.5" /> Token Expired
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-2.5 h-2.5" /> Connected
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDisconnectPageTarget({ id: page.id, name: page.name }); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[#7a6b5c] hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="Disconnect page"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Page name + subtitle */}
              <div>
                <p className="text-[15px] font-bold text-[#1c1410] leading-snug">{page.name}</p>
                <p className="text-[12px] text-[#7a6b5c] mt-0.5">Lead Capture</p>
              </div>

              {/* Stats */}
              <p className="text-[12px] text-[#9a8a7c]">
                {pageForms.length} form{pageForms.length !== 1 ? 's' : ''} · {pageLeads.toLocaleString()} leads captured
              </p>
            </div>
          );
        })}

        {/* Blocked page cards — visible via BM but token needed */}
        {blockedPages.map((page) => (
          <div
            key={page.id}
            className="bg-white rounded-2xl border border-amber-200 card-shadow p-5 flex flex-col gap-4"
          >
            {/* Top row: profile pic + Needs Token badge */}
            <div className="flex items-start justify-between">
              <PageProfilePic pageId={page.id} pageName={page.name} />
              <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                <AlertTriangle className="w-2.5 h-2.5" /> Needs Token
              </span>
            </div>

            {/* Page name + subtitle */}
            <div>
              <p className="text-[15px] font-bold text-[#1c1410] leading-snug">{page.name}</p>
              <p className="text-[12px] text-[#7a6b5c] mt-0.5">Business Manager Page</p>
            </div>

            {/* Explanation */}
            <p className="text-[11px] text-[#9a8a7c] leading-relaxed">
              You have Business Manager access but no direct page token. Paste a Page Access Token to connect.
            </p>

            <button
              onClick={() => { setConnectBlockedPage(page); setBlockedToken(''); }}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors w-full"
            >
              <Key className="w-3.5 h-3.5" /> Connect with Token
            </button>
          </div>
        ))}

        {/* Add Page card */}
        <button
          onClick={() => setOauthInstructionTarget('add-page')}
          className="bg-white rounded-2xl border-2 border-dashed border-black/10 card-shadow p-5 flex flex-col gap-4 text-left hover:border-blue-300 hover:-translate-y-0.5 transition-all duration-150"
        >
          <div className="w-11 h-11 rounded-xl bg-[var(--app-bg)] flex items-center justify-center shrink-0">
            <Plus className="w-5 h-5 text-[#7a6b5c]" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-[#7a6b5c]">Add Page</p>
            <p className="text-[12px] text-[#b09e8d] mt-0.5">Lead Capture</p>
          </div>
          <p className="text-[12px] text-[#c4b09e]">Connect another Facebook page to capture leads</p>
          <div className="pt-1 border-t border-black/5">
            <span className="text-[13px] font-semibold text-[#7a6b5c]">+ Connect Page</span>
          </div>
        </button>
      </div>

      {/* Connect Blocked Page modal */}
      {connectBlockedPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-bold text-[#1c1410] text-[15px]">Connect Page</h3>
                  <p className="text-[11px] text-[#7a6b5c] mt-0.5 truncate max-w-[180px]">{connectBlockedPage.name}</p>
                </div>
              </div>
              <button
                onClick={() => { setConnectBlockedPage(null); setBlockedToken(''); }}
                className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[12px] text-amber-800">
                  <strong>{connectBlockedPage.name}</strong> is accessible through your Business Manager, but we need a Page Access Token to import leads from it.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-[#1c1410]">How to get the token:</p>
                <ol className="space-y-1">
                  {[
                    <>Open <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-primary underline font-semibold">Graph API Explorer</a></>,
                    <>Select your App → change "User or Page" to <strong>{connectBlockedPage.name}</strong></>,
                    <>Click <strong>Generate Access Token</strong> → copy it</>,
                    <>Paste below and click Connect</>,
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11px] text-[#5c5245]">
                      <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <textarea
                value={blockedToken}
                onChange={(e) => setBlockedToken(e.target.value)}
                placeholder="Paste Page Access Token here…"
                rows={3}
                className="w-full border border-black/10 rounded-xl px-3 py-2 text-[12px] text-[#1c1410] resize-none outline-none focus:border-primary"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setConnectBlockedPage(null); setBlockedToken(''); }}
                  className="flex-1 py-2 rounded-xl text-[12px] font-semibold text-[#7a6b5c] border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConnectBlockedPage}
                  disabled={savingBlockedToken || !blockedToken.trim()}
                  className="flex-1 py-2 rounded-xl text-[13px] font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-colors"
                >
                  {savingBlockedToken ? 'Connecting…' : 'Connect Page'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pre-OAuth instruction modal ── */}
      {oauthInstructionTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#1877F2] flex items-center justify-center shrink-0">
                  <Facebook className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-[#1c1410] text-[15px]">Before you connect</h3>
                  <p className="text-[11px] text-[#7a6b5c] mt-0.5">Read this to connect all your pages</p>
                </div>
              </div>
              <button onClick={() => setOauthInstructionTarget(null)} className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Critical warning */}
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[12px] text-amber-800 leading-relaxed">
                  <strong>Facebook only connects pages you explicitly select.</strong> If you skip the page selection or leave pages unchecked, those pages will not appear in the CRM.
                </p>
              </div>

              {/* Steps */}
              <div className="space-y-2">
                <p className="text-[12px] font-bold text-[#1c1410]">In the Facebook dialog that opens:</p>
                <ol className="space-y-2.5">
                  {[
                    { label: 'Click "Edit" next to the pages list', detail: 'Do not skip this - it shows all your pages' },
                    { label: 'Check EVERY page you want to connect', detail: 'Select all of them, not just a few' },
                    { label: 'Click "Continue" to confirm', detail: 'Then finish the authorization' },
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-[#1877F2] text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <div>
                        <p className="text-[12px] font-semibold text-[#1c1410]">{step.label}</p>
                        <p className="text-[11px] text-[#9a8a7c]">{step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Already connected note */}
              {pages.length > 0 && (
                <div className="rounded-xl bg-[var(--app-bg)] border border-black/5 px-4 py-3">
                  <p className="text-[11px] text-[#7a6b5c]">
                    You currently have <strong>{pages.length} page{pages.length !== 1 ? 's' : ''}</strong> connected. After reconnecting, all previously connected pages plus any newly selected ones will be kept.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setOauthInstructionTarget(null)}
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold text-[#7a6b5c] border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setOauthInstructionTarget(null);
                    handleConnect();
                  }}
                  disabled={connecting}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold text-white bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60 transition-colors"
                >
                  <Facebook className="w-4 h-4" />
                  {connecting ? 'Redirecting…' : 'Open Facebook →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historical import confirmation modal */}
      {historicalImportTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-[16px] font-bold text-[#1c1410] mb-2">Import Historical Leads?</h3>
            <p className="text-[13px] text-[#7a6b5c] mb-1">
              This will import <strong>all leads ever submitted</strong> to <strong>{historicalImportTarget.form_name}</strong> from Meta - including leads from before you connected this form.
            </p>
            <p className="text-[12px] text-[#9e8e7e] mb-5">Existing leads will be skipped. This is a one-time manual action and does not affect your Auto toggle.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setHistoricalImportTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-gray-100 text-[#1c1410] hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { const t = historicalImportTarget; setHistoricalImportTarget(null); openTriggerModal(t); }}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
              >
                Yes, Import All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect confirmation modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-[16px] font-bold text-[#1c1410] mb-2">Disconnect Meta?</h3>
            <p className="text-[13px] text-[#7a6b5c] mb-5">All linked forms will be removed and auto-import will stop. Your existing leads will remain in the CRM.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDisconnectConfirm(false)} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-gray-100 text-[#1c1410] hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button onClick={handleDisconnect} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-red-500 text-white hover:bg-red-600 transition-colors">
                Yes, Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect single page confirmation modal */}
      {disconnectPageTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-[16px] font-bold text-[#1c1410] mb-2">Disconnect Page?</h3>
            <p className="text-[13px] text-[#7a6b5c] mb-5">
              Are you sure you want to disconnect <span className="font-semibold text-[#1c1410]">"{disconnectPageTarget.name}"</span>? All forms linked to this page will be removed and lead capture will stop. Your existing leads will remain in the CRM.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDisconnectPageTarget(null)} disabled={disconnectingPage} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-gray-100 text-[#1c1410] hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button onClick={handleDisconnectPage} disabled={disconnectingPage} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-red-500 text-white hover:bg-red-600 disabled:opacity-60 transition-colors">
                {disconnectingPage ? 'Disconnecting…' : 'Yes, Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete form confirmation modal */}
      {deleteFormTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-[16px] font-bold text-[#1c1410] mb-2">Remove Form?</h3>
            <p className="text-[13px] text-[#7a6b5c] mb-5">Remove <strong>"{deleteFormTarget.form_name}"</strong>? Your existing leads will stay in the CRM.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteFormTarget(null)} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-gray-100 text-[#1c1410] hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button onClick={confirmDeleteForm} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-red-500 text-white hover:bg-red-600 transition-colors">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
