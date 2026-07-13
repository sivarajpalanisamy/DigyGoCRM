import { useState, useEffect, KeyboardEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  GripVertical, Plus, Trash2, Check, X, Search,
  Type, Mail, Phone, Hash, AlignLeft, ChevronDown, ToggleLeft,
  Tag, Link2, Palette, Database, FileCheck, ArrowLeft, CalendarDays, RefreshCw,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useCrmStore } from '@/store/crmStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ─── Form field types ─────────────────────────────────────────────────────────
type FieldType = 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'dropdown' | 'radio' | 'multiselect' | 'checkbox' | 'date';

interface FormField {
  id: string;
  label: string;
  type: FieldType;
  placeholder: string;
  required: boolean;
  mapTo: string;
  options?: string[];
}

const FIELD_ICONS: Record<FieldType, React.ElementType> = {
  text: Type, email: Mail, phone: Phone, number: Hash,
  textarea: AlignLeft, dropdown: ChevronDown, radio: ChevronDown, multiselect: ChevronDown, checkbox: ToggleLeft,
  date: CalendarDays,
};

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text', email: 'Email', phone: 'Phone', number: 'Number',
  textarea: 'Long Text', dropdown: 'Dropdown', radio: 'Radio', multiselect: 'Multi-select', checkbox: 'Checkbox',
  date: 'Date',
};

// ─── Standard CRM fields available for forms ─────────────────────────────────
const PICKER_STD = [
  { slug: 'first_name',   name: 'First Name',    type: 'text'     as FieldType, Icon: Type },
  { slug: 'last_name',    name: 'Last Name',     type: 'text'     as FieldType, Icon: Type },
  { slug: 'email',        name: 'Email',         type: 'email'    as FieldType, Icon: Mail },
  { slug: 'phone',        name: 'Phone',         type: 'phone'    as FieldType, Icon: Phone },
  { slug: 'business_name',name: 'Business Name', type: 'text'     as FieldType, Icon: Type },
  { slug: 'street_address',name: 'Address',      type: 'textarea' as FieldType, Icon: AlignLeft },
  { slug: 'postal_code',  name: 'Postal Code',   type: 'text'     as FieldType, Icon: Hash },
  { slug: 'date_of_birth',name: 'Date of Birth', type: 'date'     as FieldType, Icon: CalendarDays },
];

// ─── Types for inline field creation (mirrors FieldsPage) ────────────────────
type DataType = 'Single Line' | 'Multi Line' | 'Email' | 'Phone' | 'Number' | 'Dropdown' | 'Radio' | 'Multi-select' | 'Checkbox' | 'Date';

const CREATOR_TYPES: { label: DataType; Icon: React.ElementType; hint: string }[] = [
  { label: 'Single Line',  Icon: Type,         hint: 'Short text' },
  { label: 'Multi Line',   Icon: AlignLeft,    hint: 'Long text / notes' },
  { label: 'Email',        Icon: Mail,         hint: 'Email address' },
  { label: 'Phone',        Icon: Phone,        hint: 'Phone number' },
  { label: 'Number',       Icon: Hash,         hint: 'Numeric value' },
  { label: 'Dropdown',     Icon: ChevronDown,  hint: 'Pick one (select box)' },
  { label: 'Radio',        Icon: ChevronDown,  hint: 'Pick one (radio buttons)' },
  { label: 'Multi-select', Icon: ChevronDown,  hint: 'Pick many (checkboxes)' },
  { label: 'Checkbox',     Icon: ToggleLeft,   hint: 'Yes / No toggle' },
  { label: 'Date',         Icon: CalendarDays, hint: 'Date picker' },
];

const HAS_OPTIONS: DataType[] = ['Dropdown', 'Radio', 'Multi-select'];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

const dataTypeToFieldType = (dt: DataType): FieldType => {
  if (dt === 'Email')        return 'email';
  if (dt === 'Phone')        return 'phone';
  if (dt === 'Number')       return 'number';
  if (dt === 'Multi Line')   return 'textarea';
  if (dt === 'Dropdown')     return 'dropdown';
  if (dt === 'Radio')        return 'radio';
  if (dt === 'Multi-select') return 'multiselect';
  if (dt === 'Checkbox')     return 'checkbox';
  if (dt === 'Date')         return 'date';
  return 'text';
};

// ─── Inline helpers ───────────────────────────────────────────────────────────
const STANDARD_CRM_FIELDS = [
  { slug: 'first_name',    name: 'First Name' },
  { slug: 'last_name',     name: 'Last Name' },
  { slug: 'email',         name: 'Email' },
  { slug: 'phone',         name: 'Phone' },
  { slug: 'date_of_birth', name: 'DOB' },
  { slug: 'business_name', name: 'Business Name' },
  { slug: 'postal_code',   name: 'Postal Code' },
];

// ─── ColorPicker ─────────────────────────────────────────────────────────────
function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280] mb-2">{label}</label>
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="flex-1 h-9 rounded-xl border border-[var(--hairline)] relative overflow-hidden" style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
        </div>
        <span className="text-[12px] font-mono text-[#6b7280] shrink-0 w-16">{value}</span>
      </label>
    </div>
  );
}

// ─── AddFieldPickerModal ──────────────────────────────────────────────────────
function AddFieldPickerModal({
  customFields,
  mappedSlugs,
  onAdd,
  onCreateNew,
  onClose,
}: {
  customFields: { id: string; name: string; slug: string; type: string }[];
  mappedSlugs: string[];
  onAdd: (slug: string, name: string, type: FieldType) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();

  const filteredStd = PICKER_STD.filter((f) => f.name.toLowerCase().includes(q));
  const filteredCustom = customFields.filter((f) => f.name.toLowerCase().includes(q));

  const customTypeToFieldType = (t: string): FieldType => {
    if (t === 'email')    return 'email';
    if (t === 'phone')    return 'phone';
    if (t === 'number')   return 'number';
    if (t === 'textarea') return 'textarea';
    if (t === 'dropdown') return 'dropdown';
    if (t === 'checkbox') return 'checkbox';
    return 'text';
  };

  const FieldCard = ({
    slug, name, type, Icon,
  }: { slug: string; name: string; type: FieldType; Icon: React.ElementType }) => {
    const added = mappedSlugs.includes(slug);
    return (
      <button
        onClick={() => { if (!added) { onAdd(slug, name, type); onClose(); } }}
        disabled={added}
        className={cn(
          'flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl border transition-all',
          added
            ? 'border-emerald-200 bg-emerald-50 cursor-not-allowed'
            : 'border-[var(--hairline)] bg-white hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm',
        )}
      >
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
          added ? 'bg-emerald-100' : 'bg-primary/10'
        )}>
          {added
            ? <Check className="w-4 h-4 text-emerald-600" />
            : <Icon className="w-4 h-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-[15px] font-semibold truncate', added ? 'text-emerald-700' : 'text-[#111318]')}>{name}</p>
          <p className="text-[11px] text-[#9ca3af] capitalize">{type}</p>
        </div>
        {added && <span className="text-[11px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">Added</span>}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--hairline)]">
          <div>
            <h3 className="font-bold text-[#111318] text-[16px]">Add a Field</h3>
            <p className="text-[12px] text-[#6b7280] mt-0.5">Pick an existing CRM field or create a new one</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#6b7280]"><X className="w-4 h-4" /></button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 bg-[var(--app-bg)] border border-[var(--hairline)] rounded-xl px-3 py-2">
            <Search className="w-3.5 h-3.5 text-[#9ca3af] shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fields…"
              className="flex-1 text-[15px] bg-transparent outline-none text-[#111318] placeholder:text-[#9ca3af]"
            />
          </div>
        </div>

        {/* Field list */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-4">

          {/* Standard Fields */}
          {filteredStd.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280] mb-2">Standard Fields</p>
              <div className="space-y-1.5">
                {filteredStd.map((f) => (
                  <FieldCard key={f.slug} slug={f.slug} name={f.name} type={f.type} Icon={f.Icon} />
                ))}
              </div>
            </div>
          )}

          {/* Custom Fields */}
          {filteredCustom.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280] mb-2">Custom Fields</p>
              <div className="space-y-1.5">
                {filteredCustom.map((f) => {
                  const FIcon = FIELD_ICONS[customTypeToFieldType(f.type)] ?? Type;
                  return (
                    <FieldCard
                      key={f.slug}
                      slug={f.slug}
                      name={f.name}
                      type={customTypeToFieldType(f.type)}
                      Icon={FIcon}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {filteredStd.length === 0 && filteredCustom.length === 0 && (
            <p className="text-center text-[15px] text-[#9ca3af] py-6">No fields match "{search}"</p>
          )}
        </div>

        {/* Footer - Create new */}
        <div className="shrink-0 px-5 py-4 border-t border-[var(--hairline)]">
          <button
            onClick={() => { onClose(); onCreateNew(); }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[15px] font-bold text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
          >
            <Plus className="w-4 h-4" /> Create New Field
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CreateFieldModal (2-step, same UX as FieldsPage) ────────────────────────
function CreateFieldModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (field: { id: string; name: string; slug: string; type: string; options?: string[] }) => void;
}) {
  const [step, setStep] = useState<'pick' | 'detail'>('pick');
  const [dataType, setDataType] = useState<DataType>('Single Line');
  const [name, setName] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<string[]>(['', '']);
  const [saving, setSaving] = useState(false);

  const slug = slugify(name);
  const needsOptions = HAS_OPTIONS.includes(dataType);

  const updateOption = (idx: number, val: string) => {
    const next = [...options]; next[idx] = val; setOptions(next);
  };
  const addOption = () => setOptions([...options, '']);
  const removeOption = (idx: number) => { if (options.length > 1) setOptions(options.filter((_, i) => i !== idx)); };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Field name is required'); return; }
    if (!slug) { toast.error('Name must contain letters or numbers'); return; }
    const validOpts = options.map((o) => o.trim()).filter(Boolean);
    if (needsOptions && validOpts.length < 1) { toast.error('Add at least one option'); return; }
    setSaving(true);
    const fieldType = dataTypeToFieldType(dataType);
    try {
      const created = await api.post<any>('/api/fields/custom', {
        name: name.trim(),
        type: fieldType,
        slug,
        placeholder: placeholder.trim() || undefined,
        options: needsOptions ? validOpts : undefined,
        required,
      });
      toast.success(`Field "${name}" created`);
      onCreate({ id: created.id, name: name.trim(), slug, type: fieldType, options: needsOptions ? validOpts : undefined });
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create field');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className={cn('bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[88vh]',
        step === 'pick' ? 'max-w-lg' : 'max-w-md'
      )}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--hairline)]">
          <div className="flex items-center gap-2.5">
            {step === 'detail' && (
              <button onClick={() => setStep('pick')} className="p-1 rounded-lg hover:bg-gray-100 text-[#6b7280]">
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <div>
              <h3 className="font-bold text-[#111318] text-[16px] leading-tight">
                {step === 'pick' ? 'Choose field type' : `New Field - ${dataType}`}
              </h3>
              <p className="text-[12px] text-[#6b7280] mt-0.5">
                {step === 'pick' ? 'Pick the type of data this field will capture' : "Name it - it'll be saved to your Fields page too"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#6b7280]"><X className="w-4 h-4" /></button>
        </div>

        {/* Step 1: Type picker */}
        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {CREATOR_TYPES.map((t) => {
                const active = dataType === t.label;
                return (
                  <button
                    key={t.label}
                    onClick={() => { setDataType(t.label); setStep('detail'); }}
                    className={cn(
                      'flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl border transition-all text-center',
                      active
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-[var(--hairline)] hover:border-primary/40 hover:bg-primary/5 text-[#6b7280] hover:text-primary'
                    )}
                  >
                    <t.Icon className="w-4 h-4" />
                    <span className="text-[11px] font-semibold leading-tight">{t.label}</span>
                    <span className="text-[10px] text-[#9ca3af] leading-tight hidden sm:block">{t.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Field details */}
        {step === 'detail' && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div>
              <label className="text-[14px] font-semibold text-[#6b7280] mb-1.5 block">
                Field Name <span className="text-red-400">*</span>
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Age Group, Course Name…"
                className="w-full border border-[var(--hairline)] rounded-lg px-3 py-2 text-[15px] text-[#111318] outline-none focus:border-primary/40 bg-white"
              />
              {slug && (
                <p className="text-[12px] text-[#9ca3af] mt-1">
                  Slug: <code className="bg-[var(--app-bg)] px-1 py-0.5 rounded font-mono">{slug}</code>
                </p>
              )}
            </div>

            {/* Placeholder - only for non-option types */}
            {!needsOptions && (
              <div>
                <label className="text-[14px] font-semibold text-[#6b7280] mb-1.5 block">
                  Placeholder <span className="text-[#9ca3af] font-normal">(optional)</span>
                </label>
                <input
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                  placeholder="Hint shown inside the empty field"
                  className="w-full border border-[var(--hairline)] rounded-lg px-3 py-2 text-[15px] text-[#111318] outline-none focus:border-primary/40 bg-white"
                />
              </div>
            )}

            {/* Options builder for Dropdown / Radio / Multi-select */}
            {needsOptions && (
              <div>
                <label className="text-[14px] font-semibold text-[#6b7280] mb-2 block">Options <span className="text-red-400">*</span></label>
                <div className="space-y-2">
                  {options.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-[12px] text-[#9ca3af] w-5 shrink-0 text-right">{idx + 1}.</span>
                      <input
                        value={opt}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={`Option ${idx + 1}`}
                        className="flex-1 border border-[var(--hairline)] rounded-lg px-3 py-2 text-[15px] text-[#111318] outline-none focus:border-primary/40 bg-white"
                      />
                      <button
                        onClick={() => removeOption(idx)}
                        disabled={options.length <= 1}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-[#c3c8cf] hover:text-red-500 transition-colors disabled:opacity-30"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addOption}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-[14px] font-semibold text-primary hover:bg-primary/5 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add option
                </button>
              </div>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="w-4 h-4 accent-primary" />
              <span className="text-[15px] text-[#111318]">Mark as required</span>
            </label>
          </div>
        )}

        {/* Footer */}
        {step === 'detail' && (
          <div className="flex gap-2 px-6 py-4 border-t border-[var(--hairline)]">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-[15px] font-semibold text-[#6b7280] hover:bg-gray-100 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-[15px] font-bold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
            >
              {saving ? 'Creating…' : 'Create & Add to Form'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function SortableFieldItem({ id, children }: { id: string; children: (dragHandleProps: Record<string, any>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

export default function CustomFormDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pipelines, customFields, addCustomField, refreshPipelines } = useCrmStore();
  const [refreshingPipelines, setRefreshingPipelines] = useState(false);
  const handleRefreshPipelines = async () => {
    setRefreshingPipelines(true);
    await refreshPipelines().catch(() => null);
    setRefreshingPipelines(false);
  };

  const allCrmFields = [
    ...STANDARD_CRM_FIELDS,
    ...customFields.map((cf) => ({ slug: cf.slug, name: cf.name })),
  ];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form metadata
  const [formName, setFormName] = useState('');
  const [submitLabel, setSubmitLabel] = useState('Submit');
  const [redirectLink, setRedirectLink] = useState('');
  const [btnColor, setBtnColor] = useState('#ea580c');
  const [btnTextColor, setBtnTextColor] = useState('#ffffff');
  const [transparentForm, setTransparentForm] = useState(false);
  const [formBgColor, setFormBgColor] = useState('#ffffff');
  const [formTextColor, setFormTextColor] = useState('#111318');
  const [thankYouMessage, setThankYouMessage] = useState('Thank you for your submission!');

  // Fields
  const [fields, setFields] = useState<FormField[]>([
    { id: 'f1', label: 'Full Name', type: 'text', placeholder: 'Your name', required: true, mapTo: 'first_name' },
    { id: 'f2', label: 'Phone', type: 'phone', placeholder: 'Your phone number', required: true, mapTo: 'phone' },
  ]);

  // Drag-and-drop sensors (distance constraint avoids conflict with inputs)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const handleFieldDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFields((prev) => {
        const oldIdx = prev.findIndex((f) => f.id === active.id);
        const newIdx = prev.findIndex((f) => f.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  // Modals
  const [showPicker, setShowPicker] = useState(false);
  const [showCreator, setShowCreator] = useState(false);

  // CRM mapping
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Declaration
  const [declarationEnabled, setDeclarationEnabled] = useState(false);
  const [policyTitle, setPolicyTitle] = useState('');
  const [policyLink, setPolicyLink] = useState('');

  const isNew = id === 'new';

  useEffect(() => {
    if (!id || isNew) { setLoading(false); return; }
    api.get<any>(`/api/forms/${id}`)
      .then((form) => {
        setFormName(form.name ?? '');
        setSubmitLabel(form.submit_label ?? 'Submit');
        setRedirectLink(form.redirect_url ?? '');
        setBtnColor(form.btn_color ?? '#ea580c');
        setBtnTextColor(form.btn_text_color ?? '#ffffff');
        setFormBgColor(form.form_bg_color ?? '#ffffff');
        setFormTextColor(form.form_text_color ?? '#111318');
        setPipelineId(form.pipeline_id ?? '');
        setStageId(form.stage_id ?? '');
        setTags(Array.isArray(form.tags) ? form.tags : []);
        setThankYouMessage(form.thank_you_message ?? 'Thank you for your submission!');
        setDeclarationEnabled(form.declaration_enabled ?? false);
        setPolicyTitle(form.declaration_title ?? '');
        setPolicyLink(form.declaration_link ?? '');
        const rawFields: any[] = Array.isArray(form.fields) ? form.fields : [];
        if (rawFields.length > 0) {
          setFields(rawFields.map((f: any, i: number) => ({
              id: f.id ?? `f${i}`,
              label: f.label ?? '',
              type: (f.type as FieldType) ?? 'text',
              placeholder: f.placeholder ?? '',
              required: f.required ?? false,
              mapTo: f.mapTo ?? '',
              options: f.options,
          })));
        }
      })
      .catch(() => toast.error('Failed to load form'))
      .finally(() => setLoading(false));
  }, [id]);

  const updateField = (fid: string, changes: Partial<FormField>) => {
    // If trying to un-require a phone/email field, check there's still at least one required phone/email
    const target = fields.find((f) => f.id === fid);
    if (target && changes.required === false && (target.mapTo === 'phone' || target.mapTo === 'email')) {
      const otherRequired = fields.some((f) => f.id !== fid && (f.mapTo === 'phone' || f.mapTo === 'email') && f.required);
      if (!otherRequired) {
        toast.error('At least one Phone or Email field must be required');
        return;
      }
    }
    setFields(fields.map((f) => f.id === fid ? { ...f, ...changes } : f));
  };

  const removeField = (fid: string) => {
    if (fields.length === 1) { toast.error('A form must have at least one field'); return; }
    const target = fields.find((f) => f.id === fid);
    if (target && (target.mapTo === 'phone' || target.mapTo === 'email')) {
      const remaining = fields.filter((f) => f.id !== fid);
      if (!remaining.some((f) => f.mapTo === 'phone' || f.mapTo === 'email')) {
        toast.error('Form must have at least a Phone or Email field');
        return;
      }
    }
    setFields(fields.filter((f) => f.id !== fid));
  };

  // Called from AddFieldPickerModal
  const handleAddFromPicker = (slug: string, name: string, type: FieldType) => {
    const autoRequired = slug === 'email' || slug === 'phone';
    setFields((prev) => [...prev, {
      id: `nf-${Date.now()}`,
      label: name,
      type,
      placeholder: '',
      required: autoRequired ? true : false,
      mapTo: slug,
    }]);
  };

  // Called from CreateFieldModal after API save
  const handleCreateField = (newField: { id: string; name: string; slug: string; type: string; options?: string[] }) => {
    addCustomField({
      id: newField.id,
      name: newField.name,
      slug: newField.slug,
      type: newField.type as any,
      required: false,
      visible: true,
      orderIndex: customFields.length,
    });
    const fType: FieldType = newField.type as FieldType;
    setFields((prev) => [...prev, {
      id: `nf-${Date.now()}`,
      label: newField.name,
      type: fType,
      placeholder: '',
      required: false,
      mapTo: newField.slug,
      options: newField.options,
    }]);
    setShowCreator(false);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) { setTagInput(''); return; }
    setTags([...tags, t]);
    setTagInput('');
  };

  const handleTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast.error('Form name is required'); return; }
    const hasRequiredPhoneOrEmail = fields.some((f) => (f.mapTo === 'phone' || f.mapTo === 'email') && f.required);
    if (!hasRequiredPhoneOrEmail) { toast.error('At least one Phone or Email field must be required'); return; }
    setSaving(true);
    const payload = {
      name: formName.trim(),
      fields,
      pipeline_id: pipelineId || null,
      stage_id: stageId || null,
      submit_label: submitLabel,
      redirect_url: redirectLink || null,
      btn_color: btnColor,
      btn_text_color: btnTextColor,
      form_bg_color: transparentForm ? null : formBgColor,
      form_text_color: formTextColor,
      declaration_enabled: declarationEnabled,
      declaration_title: policyTitle || null,
      declaration_link: policyLink || null,
      tags,
      thank_you_message: thankYouMessage || 'Thank you for your submission!',
    };
    try {
      if (isNew) {
        await api.post<any>('/api/forms', payload);
        toast.success('Form created successfully');
        navigate('/lead-generation/custom-forms', { replace: true });
      } else {
        await api.patch(`/api/forms/${id}`, payload);
        toast.success('Form saved successfully');
      }
    } catch {
      toast.error('Failed to save form');
    } finally {
      setSaving(false);
    }
  };

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);
  const previewBg = transparentForm ? 'transparent' : formBgColor;
  const mappedSlugs = fields.map((f) => f.mapTo).filter(Boolean);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[15px] text-[#6b7280]">Loading form…</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col -m-5 md:-m-8">

      {/* Top bar */}
      <div className="shrink-0 bg-white border-b border-[var(--hairline)] px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => navigate('/lead-generation/custom-forms')}
          className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280] hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-headline text-[17px] font-bold text-[#111318] truncate">
            {formName || 'Untitled Form'}
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Settings ── */}
        <div className="w-full lg:w-[55%] overflow-y-auto border-r border-[var(--hairline)] bg-[var(--app-bg)]">
          <div className="p-6 space-y-5">

            {/* Form Name */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5">
              <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-2">Form Name *</label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Contact Us, Demo Request…" />
            </div>

            {/* ── Form Fields ── */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--hairline)] flex items-center justify-between">
                <div>
                  <h3 className="font-headline font-bold text-[#111318] text-[16px]">Form Fields</h3>
                  <p className="text-[12px] text-[#6b7280] mt-0.5">
                    {fields.length} field{fields.length !== 1 ? 's' : ''} · each maps to a CRM field automatically
                  </p>
                </div>
                <button
                  onClick={() => setShowPicker(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px] font-bold text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
                >
                  <Plus className="w-3.5 h-3.5" /> Add Field
                </button>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFieldDragEnd}>
              <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-[var(--hairline)]">
                {fields.map((field) => {
                  const Icon = FIELD_ICONS[field.type] ?? Type;
                  const mappedName = allCrmFields.find((f) => f.slug === field.mapTo)?.name;
                  return (
                    <SortableFieldItem key={field.id} id={field.id}>
                      {(dragHandleProps) => (
                    <div className="px-5 py-4">
                      {/* Top row: drag handle, icon, label, placeholder, delete */}
                      <div className="flex items-center gap-2.5">
                        <button {...dragHandleProps} className="shrink-0 cursor-grab active:cursor-grabbing text-[#9ca3af] hover:text-[#6b7280] transition-colors touch-none">
                          <GripVertical className="w-4 h-4" />
                        </button>
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5 text-primary" />
                        </div>

                        <div className="flex-1 grid grid-cols-2 gap-3 min-w-0">
                          <div>
                            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280] mb-1">Label</label>
                            <Input value={field.label} onChange={(e) => updateField(field.id, { label: e.target.value })}
                              placeholder="Field label" className="h-9 text-[15px]" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280] mb-1">Placeholder</label>
                            <Input value={field.placeholder} onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                              placeholder="Hint text" className="h-9 text-[15px]" />
                          </div>
                        </div>

                        <button onClick={() => removeField(field.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-[#9ca3af] hover:text-red-500 transition-colors shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Options (for dropdown / radio / multi-select) */}
                      {(field.type === 'dropdown' || field.type === 'radio' || field.type === 'multiselect') && (
                        <div className="mt-2.5 ml-[54px]">
                          <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280] mb-1.5">
                            Options
                            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] normal-case font-semibold">
                              {field.type === 'dropdown' ? 'Select' : field.type === 'radio' ? 'Radio' : 'Multi-select'}
                            </span>
                          </label>
                          <div className="space-y-1.5">
                            {(field.options ?? ['']).map((opt, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="text-[12px] text-[#9ca3af] w-4 shrink-0 text-right">{idx + 1}.</span>
                                <input
                                  value={opt}
                                  onChange={(e) => {
                                    const next = [...(field.options ?? [''])];
                                    next[idx] = e.target.value;
                                    updateField(field.id, { options: next });
                                  }}
                                  placeholder={`Option ${idx + 1}`}
                                  className="flex-1 border border-[var(--hairline)] rounded-lg px-2.5 py-1.5 text-[14px] bg-[var(--app-bg)] outline-none focus:border-primary/40"
                                />
                                <button
                                  onClick={() => {
                                    const next = (field.options ?? ['']).filter((_, i) => i !== idx);
                                    updateField(field.id, { options: next.length ? next : [''] });
                                  }}
                                  className="p-1 rounded hover:bg-red-50 text-[#c3c8cf] hover:text-red-500 transition-colors"
                                ><X className="w-3 h-3" /></button>
                              </div>
                            ))}
                            <button
                              onClick={() => updateField(field.id, { options: [...(field.options ?? ['']), ''] })}
                              className="flex items-center gap-1 text-[12px] font-semibold text-primary hover:bg-primary/5 px-2 py-1 rounded-lg transition-colors"
                            >
                              <Plus className="w-3 h-3" /> Add option
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Bottom row: CRM mapping + Required toggle */}
                      <div className="mt-2.5 ml-[54px] flex items-center gap-4">
                        {/* Mapping */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-4 h-4 rounded bg-emerald-50 flex items-center justify-center shrink-0">
                            <svg className="w-2.5 h-2.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          </div>
                          <select
                            value={field.mapTo}
                            onChange={(e) => {
                              const mapTo = e.target.value;
                              const autoRequired = mapTo === 'email' || mapTo === 'phone';
                              updateField(field.id, { mapTo, ...(autoRequired ? { required: true } : {}) });
                            }}
                            className="text-[12px] border border-emerald-200 rounded-lg px-2 py-1 bg-emerald-50 text-emerald-800 outline-none focus:border-emerald-400 font-medium max-w-[200px]"
                          >
                            <option value="">- Not mapped -</option>
                            <optgroup label="Standard Fields">
                              {STANDARD_CRM_FIELDS.map((f) => (
                                <option key={f.slug} value={f.slug}>{f.name}</option>
                              ))}
                            </optgroup>
                            {customFields.length > 0 && (
                              <optgroup label="Custom Fields">
                                {customFields.map((cf) => (
                                  <option key={cf.slug} value={cf.slug}>{cf.name}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>

                        {/* Required toggle - locked ON for email/phone mapped fields */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Switch
                            checked={field.required}
                            onCheckedChange={(v) => updateField(field.id, { required: v })}
                          />
                          <span className="text-[12px] font-medium text-[#6b7280]">Required</span>
                        </div>
                      </div>
                    </div>
                      )}
                    </SortableFieldItem>
                  );
                })}
              </div>
              </SortableContext>
              </DndContext>

              {/* Empty state */}
              {fields.length === 0 && (
                <div className="px-5 py-10 text-center text-[15px] text-[#9ca3af]">
                  No fields yet. Click <strong>Add Field</strong> to get started.
                </div>
              )}
            </div>

            {/* Add to CRM */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Database className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-headline font-bold text-[#111318] text-[16px]">Add to CRM</h3>
                  <p className="text-[12px] text-[#6b7280]">Auto-create a lead when this form is submitted</p>
                </div>
                <button
                  onClick={handleRefreshPipelines}
                  disabled={refreshingPipelines}
                  title="Refresh pipelines"
                  className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280] hover:text-primary transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingPipelines ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div>
                <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-2">Pipeline</label>
                <select
                  value={pipelineId}
                  onChange={(e) => { setPipelineId(e.target.value); setStageId(''); }}
                  className="w-full text-[15px] border border-[var(--hairline)] rounded-xl px-3 py-2.5 bg-[var(--app-bg)] text-[#111318] outline-none focus:border-primary/30"
                >
                  <option value="">- Select a pipeline -</option>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-2">Initial Stage</label>
                <select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  disabled={!pipelineId}
                  className="w-full text-[15px] border border-[var(--hairline)] rounded-xl px-3 py-2.5 bg-[var(--app-bg)] text-[#111318] outline-none focus:border-primary/30 disabled:opacity-40"
                >
                  <option value="">- Select a stage -</option>
                  {(selectedPipeline?.stages ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {!pipelineId && <p className="text-[12px] text-[#9ca3af] mt-1">Select a pipeline first</p>}
              </div>

              <div>
                <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-2 flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Tags
                </label>
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl border border-[var(--hairline)] bg-[var(--app-bg)] min-h-[42px]">
                  {tags.map((t) => (
                    <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/10 text-primary text-[12px] font-medium">
                      {t}
                      <button onClick={() => setTags(tags.filter((x) => x !== t))} className="hover:text-red-500 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKey} onBlur={addTag}
                    placeholder={tags.length === 0 ? 'Type a tag and press Enter…' : 'Add more…'}
                    className="flex-1 min-w-[120px] text-[15px] bg-transparent outline-none text-[#111318] placeholder:text-[#9ca3af]"
                  />
                </div>
              </div>
            </div>

            {/* Declaration */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileCheck className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-headline font-bold text-[#111318] text-[16px]">Declaration</h3>
                    <p className="text-[12px] text-[#6b7280]">Show a consent / policy checkbox to users</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={declarationEnabled} onCheckedChange={setDeclarationEnabled} />
                  <span className="text-[14px] font-medium text-[#6b7280]">{declarationEnabled ? 'Enabled' : 'Off'}</span>
                </div>
              </div>
              {declarationEnabled && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-2">Policy Title</label>
                    <Input value={policyTitle} onChange={(e) => setPolicyTitle(e.target.value)}
                      placeholder="e.g. I agree to the Terms & Privacy Policy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-2">Policy Link</label>
                    <Input value={policyLink} onChange={(e) => setPolicyLink(e.target.value)}
                      placeholder="https://yoursite.com/privacy-policy" />
                  </div>
                </div>
              )}
            </div>

            {/* Button */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Link2 className="w-3.5 h-3.5 text-primary" />
                </div>
                <h3 className="font-headline font-bold text-[#111318] text-[16px]">Button</h3>
              </div>
              <div>
                <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-2">Button Title</label>
                <Input value={submitLabel} onChange={(e) => setSubmitLabel(e.target.value)} placeholder="e.g. Submit, Enquire Now" />
              </div>
              <div>
                <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-2">Thank You Message</label>
                <Input value={thankYouMessage} onChange={(e) => setThankYouMessage(e.target.value)} placeholder="Thank you for your submission!" />
              </div>
              <div>
                <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] mb-1">Redirect Link</label>
                <p className="text-[12px] text-[#9ca3af] mb-2">Where to send the user after form is submitted (optional)</p>
                <Input value={redirectLink} onChange={(e) => setRedirectLink(e.target.value)} placeholder="https://yoursite.com/thank-you" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ColorPicker label="Button Color" value={btnColor} onChange={setBtnColor} />
                <ColorPicker label="Button Text Color" value={btnTextColor} onChange={setBtnTextColor} />
              </div>
            </div>

            {/* Form Colors */}
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Palette className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <h3 className="font-headline font-bold text-[#111318] text-[16px]">Form Colors</h3>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={transparentForm} onChange={(e) => setTransparentForm(e.target.checked)}
                    className="w-4 h-4 rounded accent-orange-500" />
                  <span className="text-[14px] font-medium text-[#6b7280]">Transparent background</span>
                </label>
              </div>
              <div className={`grid grid-cols-2 gap-4 transition-opacity ${transparentForm ? 'opacity-40 pointer-events-none' : ''}`}>
                <ColorPicker label="Form Background" value={formBgColor} onChange={setFormBgColor} />
                <ColorPicker label="Form Text Color" value={formTextColor} onChange={setFormTextColor} />
              </div>
            </div>

            {/* Save button */}
            <div className="pb-2">
              <Button onClick={handleSave} disabled={saving} className="w-full py-3 text-[16px]">
                <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Form'}
              </Button>
            </div>

          </div>
        </div>

        {/* ── Right: Live Preview ── */}
        <div className="hidden lg:flex flex-1 flex-col overflow-y-auto bg-[var(--accent-tint)]/30 sticky top-0">
          <div className="p-6">
            <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#6b7280] mb-5">Live Preview</p>

            <div className="rounded-2xl border border-[var(--hairline)] card-shadow p-6 max-w-sm mx-auto"
              style={{ background: previewBg, color: formTextColor }}>
              <h3 className="font-headline text-[17px] font-bold mb-5" style={{ color: formTextColor }}>
                {formName || 'Untitled Form'}
              </h3>
              <div className="space-y-4">
                {fields.map((field) => (
                  <div key={field.id}>
                    <label className="block text-[14px] font-semibold mb-1.5" style={{ color: formTextColor }}>
                      {field.label || 'Field'}
                      {field.required && <span className="text-red-400 ml-0.5">*</span>}
                      {field.mapTo && (
                        <span className="ml-2 text-[11px] font-normal text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                          → {allCrmFields.find((f) => f.slug === field.mapTo)?.name ?? field.mapTo}
                        </span>
                      )}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea disabled placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                        className="w-full h-20 px-3 py-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--hairline)] text-[15px] text-[#6b7280] placeholder:text-[#9ca3af] resize-none outline-none" />
                    ) : field.type === 'dropdown' ? (
                      <select disabled className="w-full px-3 py-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--hairline)] text-[15px] text-[#6b7280] outline-none">
                        <option>- Select -</option>
                        {(field.options ?? []).map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : field.type === 'radio' ? (
                      <div className="space-y-1.5 pt-1">
                        {(field.options ?? []).map((o) => (
                          <label key={o} className="flex items-center gap-2">
                            <input type="radio" disabled className="w-3.5 h-3.5" style={{ accentColor: btnColor }} />
                            <span className="text-[14px]" style={{ color: formTextColor }}>{o}</span>
                          </label>
                        ))}
                        {(!field.options || field.options.length === 0) && <p className="text-[12px] text-[#9ca3af] italic">No options added</p>}
                      </div>
                    ) : field.type === 'multiselect' ? (
                      <div className="space-y-1.5 pt-1">
                        {(field.options ?? []).map((o) => (
                          <label key={o} className="flex items-center gap-2">
                            <input type="checkbox" disabled className="w-3.5 h-3.5 rounded" style={{ accentColor: btnColor }} />
                            <span className="text-[14px]" style={{ color: formTextColor }}>{o}</span>
                          </label>
                        ))}
                        {(!field.options || field.options.length === 0) && <p className="text-[12px] text-[#9ca3af] italic">No options added</p>}
                      </div>
                    ) : field.type === 'checkbox' ? (
                      <div className="flex items-center gap-2">
                        <input type="checkbox" disabled className="w-4 h-4 rounded" style={{ accentColor: btnColor }} />
                        <span className="text-[15px]" style={{ color: formTextColor }}>{field.placeholder || field.label}</span>
                      </div>
                    ) : (
                      <input disabled type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'date' ? 'date' : 'text'}
                        placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                        className="w-full px-3 py-2.5 rounded-xl bg-[var(--app-bg)] border border-[var(--hairline)] text-[15px] text-[#6b7280] placeholder:text-[#9ca3af] outline-none" />
                    )}
                  </div>
                ))}
              </div>

              {declarationEnabled && policyTitle && (
                <div className="flex items-start gap-2 mt-4">
                  <input type="checkbox" disabled className="w-4 h-4 mt-0.5 rounded shrink-0" />
                  <span className="text-[14px]" style={{ color: formTextColor }}>
                    {policyTitle}
                    {policyLink && <span className="underline ml-1 opacity-60">View Policy</span>}
                  </span>
                </div>
              )}

              <button disabled className="mt-6 w-full py-3 rounded-xl text-[16px] font-semibold"
                style={{ background: btnColor, color: btnTextColor }}>
                {submitLabel || 'Submit'}
              </button>
            </div>

            {(pipelineId || tags.length > 0) && (
              <div className="mt-5 max-w-sm mx-auto bg-emerald-50 border border-emerald-100 rounded-2xl p-4 space-y-1.5">
                <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-emerald-700">CRM Mapping</p>
                {selectedPipeline && (
                  <p className="text-[14px] text-emerald-800">
                    Pipeline: <span className="font-semibold">{selectedPipeline.name}</span>
                    {stageId && selectedPipeline.stages && (
                      <> → <span className="font-semibold">
                        {selectedPipeline.stages.find((s) => s.id === stageId)?.name ?? stageId}
                      </span></>
                    )}
                  </p>
                )}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tags.map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700 text-[12px] font-medium">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── Modals ── */}
      {showPicker && (
        <AddFieldPickerModal
          customFields={customFields}
          mappedSlugs={mappedSlugs}
          onAdd={handleAddFromPicker}
          onCreateNew={() => setShowCreator(true)}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showCreator && (
        <CreateFieldModal
          onClose={() => setShowCreator(false)}
          onCreate={handleCreateField}
        />
      )}

    </div>
  );
}
