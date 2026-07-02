import React, { useState, useMemo, useEffect } from 'react';
import { SYSTEM_STANDARD_FIELDS, SYSTEM_GROUPS, slugToVar } from '@/constants/systemFields';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Pencil, Copy, X, Check, ChevronDown, Trash2,
  Type, AlignLeft, Hash, Phone as PhoneIcon, IndianRupee,
  ChevronsUpDown, CircleDot, SquareCheck, CalendarDays,
  FileUp, Mail, Link as LinkIcon, AlertCircle, GripVertical,
  ArrowLeft, Eye, Tag,
} from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { useCrmStore, AdditionalField as StoreAdditionalField } from '@/store/crmStore';
import { api } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { cn, copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import type { ElementType } from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════════

type DataType =
  | 'Single Line' | 'Multi Line' | 'Number' | 'Phone' | 'Monetary'
  | 'Email' | 'URL' | 'Dropdown' | 'Multi-select' | 'Radio' | 'Multi-Checkbox' | 'Checkbox'
  | 'Date' | 'File Upload';

interface StandardField {
  id: string;
  name: string;
  type: DataType;
  slug: string;
  required: boolean;
  is_active?: boolean;
  isSystem?: boolean;
  options?: string[];
  group?: string;
  replaceWith?: string;
  placeholder?: string;
}

type AdditionalField = StoreAdditionalField;

interface ValueToken {
  id: string;
  name: string;         // friendly label e.g. "Google Meet link" — token is slugify(name)
  replaceWith: string;  // actual text
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Data-type catalog (with icons + help)
// ═══════════════════════════════════════════════════════════════════════════════

const DATA_TYPES: { label: DataType; Icon: ElementType; hint: string; hasOptions?: boolean; group: string }[] = [
  // Text Input
  { label: 'Single Line',   Icon: Type,          hint: 'Short text (e.g. name)',         group: 'Text Input' },
  { label: 'Multi Line',    Icon: AlignLeft,     hint: 'Long text (notes, description)', group: 'Text Input' },
  { label: 'Email',         Icon: Mail,          hint: 'Email address',                  group: 'Text Input' },
  { label: 'URL',           Icon: LinkIcon,      hint: 'Website or link',                group: 'Text Input' },

  // Numeric Values
  { label: 'Number',        Icon: Hash,          hint: 'Any whole or decimal number',    group: 'Numeric Values' },
  { label: 'Phone',         Icon: PhoneIcon,     hint: 'Phone number (E.164)',           group: 'Numeric Values' },
  { label: 'Monetary',      Icon: IndianRupee,   hint: 'Currency amount (₹)',            group: 'Numeric Values' },

  // Multiple Options
  { label: 'Dropdown',      Icon: ChevronDown,   hint: 'Pick one from a list',                group: 'Multiple Options', hasOptions: true },
  { label: 'Multi-select',  Icon: ChevronsUpDown,hint: 'Pick many from a dropdown',           group: 'Multiple Options', hasOptions: true },
  { label: 'Radio',         Icon: CircleDot,     hint: 'Pick one - all options visible',      group: 'Multiple Options', hasOptions: true },
  { label: 'Multi-Checkbox',Icon: SquareCheck,   hint: 'Pick many - all options visible',     group: 'Multiple Options', hasOptions: true },
  { label: 'Checkbox',      Icon: Check,         hint: 'Simple Yes / No toggle',              group: 'Multiple Options' },

  // Others
  { label: 'Date',          Icon: CalendarDays,  hint: 'Date picker',                    group: 'Others' },
  { label: 'File Upload',   Icon: FileUp,        hint: 'Attach a file',                  group: 'Others' },
];

const TYPE_GROUPS = ['Text Input', 'Numeric Values', 'Multiple Options', 'Others'];

const OPTION_PRESETS: { label: string; values: string[] }[] = [
  { label: 'Yes / No',              values: ['Yes', 'No'] },
  { label: 'High / Medium / Low',   values: ['High', 'Medium', 'Low'] },
  { label: 'Cold / Warm / Hot',     values: ['Cold', 'Warm', 'Hot'] },
  { label: 'Small / Medium / Large',values: ['Small', 'Medium', 'Large'] },
  { label: 'T-shirt sizes',         values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
];

const dataTypeInfo = (t: DataType) => DATA_TYPES.find((d) => d.label === t) ?? DATA_TYPES[0];

// ═══════════════════════════════════════════════════════════════════════════════
//  Default data
// ═══════════════════════════════════════════════════════════════════════════════

// System standard fields and groups come from the shared constants file.
const SYSTEM_STANDARD: StandardField[] = SYSTEM_STANDARD_FIELDS.map((f) => ({
  ...f,
  type: 'Single Line' as any,
  required: false,
}));

const INIT_CUSTOM_STANDARD: StandardField[] = [];

const INIT_ADDITIONAL: AdditionalField[] = [
  { id: 'a1', pipelineId: 'sales', question: 'What is their budget range?', type: 'Dropdown', slug: 'budget_range', options: ['< ₹50k', '₹50k – ₹2L', '₹2L – ₹10L', '> ₹10L'], required: true },
  { id: 'a2', pipelineId: 'sales', question: 'Expected timeline to decide?', type: 'Date',     slug: 'timeline',     required: false },
  { id: 'a3', pipelineId: 'sales', question: 'Who is the decision-maker?',   type: 'Single Line', slug: 'decision_maker', required: false },
  { id: 'a4', pipelineId: 'sales', question: 'Main pain point?',             type: 'Multi Line', slug: 'pain_point', required: false },
];

const INIT_VALUES: ValueToken[] = [
  { id: 'v1', name: 'Google Meet link',  replaceWith: 'https://meet.google.com/xyz-abc-def' },
  { id: 'v2', name: 'Email signature',   replaceWith: 'Best regards,\n- Team Hawcus' },
  { id: 'v3', name: 'Working hours',     replaceWith: 'Mon–Fri, 9am–6pm IST' },
];

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════════

const slugify = (s: string): string => {
  const ascii = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  if (ascii) return ascii;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return 'field_' + Math.abs(h).toString(36).slice(0, 8);
};

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white';

// ═══════════════════════════════════════════════════════════════════════════════
//  Modal: Standard Field (Create / Edit)
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
//  Reusable Component: FieldSelector — grouped type picker
// ═══════════════════════════════════════════════════════════════════════════════

function FieldSelector({ value, onChange }: { value: DataType; onChange: (t: DataType) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {DATA_TYPES.map((d) => {
        const active = value === d.label;
        return (
          <button
            key={d.label}
            onClick={() => onChange(d.label)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 rounded-lg border transition-all',
              active
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-black/[0.06] hover:border-primary/40 hover:bg-primary/5 text-[#7a6b5c] hover:text-primary'
            )}
          >
            <d.Icon className="w-4 h-4" />
            <span className="text-[11px] font-semibold leading-tight text-center">{d.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Reusable Component: OptionBuilder — Name + Value rows, presets, paste-split
// ═══════════════════════════════════════════════════════════════════════════════

type OptionItem = { name: string; value: string };

function OptionBuilder({ options, onChange }: {
  options: OptionItem[];
  onChange: (next: OptionItem[]) => void;
}) {
  const updateName = (idx: number, val: string) => {
    const next = [...options];
    next[idx] = { name: val, value: slugify(val) };
    onChange(next);
  };

  const addOption = () => onChange([...options, { name: '', value: '' }]);
  const removeOption = (idx: number) => onChange(options.filter((_, i) => i !== idx));

  const handlePaste = (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (text.includes(',') || text.includes('\n')) {
      e.preventDefault();
      const pieces = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const next = [...options];
      pieces.forEach((p, i) => {
        const target = idx + i;
        if (next[target]) next[target] = { name: p, value: slugify(p) };
        else next.push({ name: p, value: slugify(p) });
      });
      onChange(next);
    }
  };

  return (
    <div>
      <label className="text-[12px] font-semibold text-[#7a6b5c] mb-2 block">Options</label>
      <div className="space-y-1.5">
        {options.map((o, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              className={inputCls}
              placeholder={`Option ${idx + 1}`}
              value={o.name}
              onChange={(e) => updateName(idx, e.target.value)}
              onPaste={(e) => handlePaste(idx, e)}
            />
            <button
              onClick={() => removeOption(idx)}
              disabled={options.length <= 1}
              className="w-9 h-9 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#c4b09e] hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={addOption}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-primary hover:bg-primary/5 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add option
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Reusable Component: PreviewRenderer — live preview of the configured field
// ═══════════════════════════════════════════════════════════════════════════════

function PreviewRenderer({ name, type, placeholder, required, options }: {
  name: string;
  type: DataType;
  placeholder: string;
  required: boolean;
  options: OptionItem[];
}) {
  const typeInfo = dataTypeInfo(type);
  const displayOptions = options.filter((o) => o.name.trim());
  // Fallback placeholders when no options yet
  const previewOptions = displayOptions.length > 0 ? displayOptions : [{ name: 'Option 1', value: '1' }, { name: 'Option 2', value: '2' }];
  const ph = placeholder || typeInfo.hint;
  const pvInput = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] bg-white';

  return (
    <div className="bg-white rounded-xl border border-black/[0.06] p-4">
      <label className="text-[12px] font-semibold text-[#1c1410] mb-1.5 block">
        {name || 'Field name'}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      {type === 'Multi Line' && <textarea className={pvInput + ' resize-none'} rows={3} placeholder={ph} disabled />}
      {(type === 'Single Line' || type === 'File Upload') && <input className={pvInput} placeholder={ph} disabled />}
      {type === 'Email' && <input type="email" className={pvInput} placeholder={ph || 'name@example.com'} disabled />}
      {type === 'URL' && <input type="url" className={pvInput} placeholder={ph || 'https://'} disabled />}
      {type === 'Number' && <input type="number" className={pvInput} placeholder={ph || '0'} disabled />}
      {type === 'Phone' && <input className={pvInput} placeholder={ph || '+91 98765 43210'} disabled />}
      {type === 'Monetary' && <input type="number" className={pvInput} placeholder={ph || '₹ 0'} disabled />}
      {type === 'Date' && <input type="date" className={pvInput} disabled />}

      {type === 'Dropdown' && (
        <select className={pvInput} disabled>
          <option>{ph || 'Choose...'}</option>
          {previewOptions.map((o, i) => <option key={i}>{o.name}</option>)}
        </select>
      )}

      {type === 'Multi-select' && (
        <div className="flex flex-wrap gap-1.5 min-h-[40px] items-center">
          {previewOptions.map((o, i) => (
            <span key={i} className={cn('px-2.5 py-1 rounded-full text-[11px] font-semibold border',
              displayOptions.length === 0
                ? 'border-dashed border-[#c4b09e] text-[#c4b09e]'
                : 'border-black/10 bg-white text-[#7a6b5c]'
            )}>{o.name}</span>
          ))}
        </div>
      )}

      {type === 'Radio' && (
        <div className="space-y-2">
          {previewOptions.map((o, i) => (
            <label key={i} className="flex items-center gap-2">
              <input type="radio" name="preview-radio" disabled className="w-4 h-4 accent-primary" />
              <span className={cn('text-[13px]', displayOptions.length === 0 ? 'text-[#c4b09e] italic' : 'text-[#1c1410]')}>{o.name}</span>
            </label>
          ))}
        </div>
      )}

      {type === 'Multi-Checkbox' && (
        <div className="space-y-2">
          {previewOptions.map((o, i) => (
            <label key={i} className="flex items-center gap-2">
              <input type="checkbox" disabled className="w-4 h-4 accent-primary" />
              <span className={cn('text-[13px]', displayOptions.length === 0 ? 'text-[#c4b09e] italic' : 'text-[#1c1410]')}>{o.name}</span>
            </label>
          ))}
        </div>
      )}

      {type === 'Checkbox' && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="w-4 h-4 accent-primary" disabled />
          <span className="text-[13px] text-[#1c1410]">Yes</span>
        </label>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  StandardFieldModal — composes the 3 components
// ═══════════════════════════════════════════════════════════════════════════════

function StandardFieldModal({ field, onClose, onSave }: {
  field?: StandardField;
  onClose: () => void;
  onSave: (f: Omit<StandardField, 'id'>) => void;
}) {
  const [step, setStep]         = useState<'pick' | 'detail'>(field ? 'detail' : 'pick');
  const [name, setName]         = useState(field?.name ?? '');
  const [type, setType]         = useState<DataType>(field?.type ?? 'Single Line');
  const [required, setRequired] = useState(field?.required ?? false);
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? '');
  const [options, setOptions]   = useState<{ name: string; value: string }[]>(
    field?.options?.map((o) => ({ name: o, value: slugify(o) })) ?? [{ name: '', value: '' }]
  );

  const typeInfo = dataTypeInfo(type);
  const slug = slugify(name);

  const pickType = (t: DataType) => { setType(t); setStep('detail'); };

  const handleSave = () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const validOptions = options.map((o) => o.name.trim()).filter(Boolean);
    if (typeInfo.hasOptions && validOptions.length === 0) {
      toast.error('Add at least one option'); return;
    }
    onSave({
      name: name.trim(), type, slug, required,
      placeholder: placeholder.trim() || undefined,
      options: typeInfo.hasOptions ? validOptions : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className={cn('bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[88vh]',
        step === 'pick' ? 'max-w-xl' : 'max-w-md'
      )}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5">
          <div className="flex items-center gap-2.5">
            {step === 'detail' && !field && (
              <button onClick={() => setStep('pick')} className="p-1 rounded-lg hover:bg-gray-100 text-[#7a6b5c]">
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <div>
              <h3 className="font-bold text-[#1c1410] text-[15px] leading-tight">
                {field ? 'Edit Field' : step === 'pick' ? 'Choose field type' : `New Custom Field - ${type}`}
              </h3>
              {step === 'pick' && <p className="text-[11px] text-[#7a6b5c] mt-0.5">Pick a data type that fits what you want to capture</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-3.5 h-3.5" /></button>
        </div>

        {/* ── Step 1: Type picker (FieldSelector component) ── */}
        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <FieldSelector value={type} onChange={pickType} />
          </div>
        )}

        {/* ── Step 2: Simple form ── */}
        {step === 'detail' && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div>
              <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Name <span className="text-red-400">*</span></label>
              <input autoFocus className={inputCls} placeholder="e.g. Company Size" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Placeholder <span className="text-[#b09e8d] font-normal">(optional)</span></label>
              <input className={inputCls} placeholder="Hint shown inside the empty field" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
            </div>

            {typeInfo.hasOptions && (
              <OptionBuilder options={options} onChange={setOptions} />
            )}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="w-4 h-4 accent-primary" />
              <span className="text-[13px] text-[#1c1410]">Mark as required</span>
            </label>
          </div>
        )}

        {/* Footer */}
        {step === 'detail' && (
          <div className="flex gap-2 px-6 py-4 border-t border-black/5">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">Cancel</button>
            <button onClick={handleSave} className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
              {field ? 'Save Changes' : 'Create Field'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Modal: Additional Field (Pipeline Question)
// ═══════════════════════════════════════════════════════════════════════════════

function AdditionalFieldModal({ pipelineId, field, onClose, onSave }: {
  pipelineId: string;
  field?: AdditionalField;
  onClose: () => void;
  onSave: (f: Omit<AdditionalField, 'id'>) => void;
}) {
  const [step, setStep]           = useState<'pick' | 'detail'>(field ? 'detail' : 'pick');
  const [question, setQuestion]   = useState(field?.question ?? '');
  const [type, setType]           = useState<DataType>(field?.type ?? 'Single Line');
  const [required, setRequired]   = useState(field?.required ?? false);
  const [options, setOptions]     = useState<OptionItem[]>(
    field?.options?.map((o) => ({ name: o, value: slugify(o) })) ?? [{ name: '', value: '' }]
  );

  const typeInfo = dataTypeInfo(type);

  const pickType = (t: DataType) => { setType(t); setStep('detail'); };

  const handleSave = () => {
    if (!question.trim()) { toast.error('Question is required'); return; }
    const qSlug = slugify(question);
    if (!qSlug) { toast.error('Question must contain letters or numbers'); return; }
    const validOptions = options.map((o) => o.name.trim()).filter(Boolean);
    if (typeInfo.hasOptions && validOptions.length === 0) {
      toast.error('Add at least one option'); return;
    }
    onSave({
      pipelineId,
      question: question.trim(),
      type,
      slug: qSlug,
      required,
      options: typeInfo.hasOptions ? validOptions : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className={cn('bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[88vh]',
        step === 'pick' ? 'max-w-xl' : 'max-w-md'
      )}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5">
          <div className="flex items-center gap-2.5">
            {step === 'detail' && !field && (
              <button onClick={() => setStep('pick')} className="p-1 rounded-lg hover:bg-gray-100 text-[#7a6b5c]">
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <div>
              <h3 className="font-bold text-[#1c1410] text-[15px] leading-tight">
                {field ? 'Edit Question' : step === 'pick' ? 'Choose answer type' : `New Question - ${type}`}
              </h3>
              <p className="text-[11px] text-[#7a6b5c] mt-0.5">
                {step === 'pick' ? 'Pick a data type that fits the answer you want' : 'Staff fills this while talking to the lead'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-3.5 h-3.5" /></button>
        </div>

        {/* Step 1: Grouped type picker (reusing FieldSelector) */}
        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <FieldSelector value={type} onChange={pickType} />
          </div>
        )}

        {/* Step 2: Simple form */}
        {step === 'detail' && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div>
              <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Question <span className="text-red-400">*</span></label>
              <input autoFocus className={inputCls} placeholder="e.g. What is their budget range?" value={question} onChange={(e) => setQuestion(e.target.value)} />
            </div>

            {typeInfo.hasOptions && (
              <OptionBuilder options={options} onChange={setOptions} />
            )}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="w-4 h-4 accent-primary" />
              <span className="text-[13px] text-[#1c1410]">Required before moving to next stage</span>
            </label>
          </div>
        )}

        {/* Footer */}
        {step === 'detail' && (
          <div className="flex gap-2 px-6 py-4 border-t border-black/5">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">Cancel</button>
            <button onClick={handleSave} className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
              {field ? 'Save Changes' : 'Add Question'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Modal: Value (Token/Macro)
// ═══════════════════════════════════════════════════════════════════════════════

function ValueModal({ value, onClose, onSave }: {
  value?: ValueToken;
  onClose: () => void;
  onSave: (v: Omit<ValueToken, 'id'>) => void;
}) {
  const [name, setName]               = useState(value?.name ?? '');
  const [replaceWith, setReplaceWith] = useState(value?.replaceWith ?? '');

  const slug = slugify(name);

  const handleSave = () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!replaceWith.trim()) { toast.error('Replace-with value is required'); return; }
    onSave({ name: name.trim(), replaceWith });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">

        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5">
          <div>
            <h3 className="font-bold text-[#1c1410] text-[17px]">{value ? 'Edit Value' : 'New Value'}</h3>
            <p className="text-[12px] text-[#7a6b5c] mt-0.5">Use these as shortcuts in messages and templates</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Name <span className="text-red-400">*</span></label>
            <input autoFocus className={inputCls} placeholder="e.g. Google Meet link" value={name} onChange={(e) => setName(e.target.value)} />
            {slug && <p className="text-[11px] text-[#b09e8d] mt-1.5">Unique key: <code className="bg-muted px-1.5 rounded text-primary font-semibold">{`{%${slug}%}`}</code></p>}
          </div>

          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Replace with <span className="text-red-400">*</span></label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white resize-none"
              rows={3}
              placeholder="https://meet.google.com/xyz-abc-def"
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
            />
            <p className="text-[11px] text-[#b09e8d] mt-1.5">This text will replace the unique key when sending</p>
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-black/5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">Cancel</button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
            {value ? 'Save' : 'Create Value'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════════

type Tab = 'standard' | 'additional' | 'values' | 'tags';

export default function FieldsPage() {
  const {
    pipelines,
    addCustomField: storeAddCustomField,
    updateCustomField: storeUpdateCustomField,
    deleteCustomField: storeDeleteCustomField,
    addAdditionalField: storeAddAdditionalField,
    updateAdditionalField: storeUpdateAdditionalField,
    deleteAdditionalField: storeDeleteAdditionalField,
  } = useCrmStore();
  const [searchParams] = useSearchParams();
  const tab = (searchParams.get('tab') ?? 'standard') as Tab;
  const [search, setSearch] = useState('');

  // Standard Fields — custom tab
  const [customStandard, setCustomStandard] = useState<StandardField[]>([]);
  const [stdModal, setStdModal] = useState<{ open: boolean; editing?: StandardField }>({ open: false });
  const [activeGroup, setActiveGroup] = useState<string>('Contact');

  // Additional Fields — pipeline questions
  const [additional, setAdditional] = useState<AdditionalField[]>(INIT_ADDITIONAL);
  const [selectedPipeline, setSelectedPipeline] = useState<string>(pipelines[0]?.id ?? 'sales');
  const [addModal, setAddModal] = useState<{ open: boolean; editing?: AdditionalField }>({ open: false });

  // Values — token macros
  const [values, setValues] = useState<ValueToken[]>([]);
  const [valueModal, setValueModal] = useState<{ open: boolean; editing?: ValueToken }>({ open: false });

  // Tags
  const { tags: storeTags, addTag: storeAddTag, updateTag: storeUpdateTag, deleteTag: storeDeleteTag } = useCrmStore();
  const canManageTags = usePermission('tags:manage');
  const [tagEdit, setTagEdit] = useState<{ id: string; name: string; color: string } | null>(null);
  const [tagCreating, setTagCreating] = useState(false);
  const [tagNewName, setTagNewName] = useState('');
  const [tagNewColor, setTagNewColor] = useState('#94a3b8');
  const [tagSaving, setTagSaving] = useState(false);

  // Delete confirmation modal
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'custom' | 'question' | 'value' | 'tag'; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      if (deleteConfirm.type === 'custom') {
        await api.delete(`/api/fields/custom/${deleteConfirm.id}`);
        setCustomStandard((p) => p.filter((x) => x.id !== deleteConfirm.id));
        storeDeleteCustomField(deleteConfirm.id);
      } else if (deleteConfirm.type === 'question') {
        await api.delete(`/api/fields/questions/${deleteConfirm.id}`);
        setAdditional((p) => p.filter((x) => x.id !== deleteConfirm.id));
        storeDeleteAdditionalField(deleteConfirm.id);
      } else if (deleteConfirm.type === 'tag') {
        await api.delete(`/api/tags/${deleteConfirm.id}`);
        storeDeleteTag(deleteConfirm.id);
      } else {
        await api.delete(`/api/fields/values/${deleteConfirm.id}`);
        setValues((p) => p.filter((x) => x.id !== deleteConfirm.id));
      }
      toast.success('Deleted');
      setDeleteConfirm(null);
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  // Load from API
  const [liveTick, setLiveTick] = useState(0);
  // Live-refresh fields on any tenant data change (no manual reload).
  useLiveRefresh(() => setLiveTick((n) => n + 1));
  useEffect(() => {
    api.get<any[]>('/api/fields/custom').then((rows) => {
      setCustomStandard(rows.map((r) => ({
        id: r.id, name: r.name, type: r.type as DataType, slug: r.slug,
        placeholder: r.placeholder ?? undefined, options: r.options ?? undefined,
        required: r.required ?? false, is_active: r.is_active !== false, isSystem: false,
      })));
    }).catch(() => {});

    api.get<any[]>('/api/fields/questions').then((rows) => {
      setAdditional(rows.map((r) => ({
        id: r.id, pipelineId: r.pipeline_id, question: r.question,
        type: r.type as AdditionalField['type'], slug: r.slug,
        options: r.options ?? undefined, required: r.required ?? false,
      })));
    }).catch(() => {});

    api.get<any[]>('/api/fields/values').then((rows) => {
      setValues(rows.map((r) => ({ id: r.id, name: r.name, replaceWith: r.replace_with })));
    }).catch(() => {});
  }, [liveTick]);

  const filteredPipelineQuestions = useMemo(() => {
    // When "all" is selected → show only global questions
    // When a specific pipeline is selected → show global + that pipeline's questions
    return additional.filter((a) => {
      const matches = selectedPipeline === 'all' ? a.pipelineId === 'all' : (a.pipelineId === selectedPipeline || a.pipelineId === 'all');
      return matches && (!search || a.question.toLowerCase().includes(search.toLowerCase()));
    });
  }, [additional, selectedPipeline, search]);

  const filteredStandard = useMemo(() => {
    if (!search) return { system: SYSTEM_STANDARD, custom: customStandard };
    const s = search.toLowerCase();
    return {
      system: SYSTEM_STANDARD.filter((f) => f.name.toLowerCase().includes(s)),
      custom: customStandard.filter((f) => f.name.toLowerCase().includes(s)),
    };
  }, [customStandard, search]);

  const filteredValues = useMemo(() => {
    if (!search) return values;
    const s = search.toLowerCase();
    return values.filter((v) => v.name.toLowerCase().includes(s) || v.replaceWith.toLowerCase().includes(s));
  }, [values, search]);

  const copyToken = (token: string) => {
    copyToClipboard(`{%${token}%}`);
    toast.success(`Copied {%${token}%}`);
  };

  const tabsConfig = [
    { key: 'standard' as const,   label: 'Standard Fields',   count: SYSTEM_STANDARD.length + customStandard.length },
    { key: 'additional' as const, label: 'Additional Fields', count: additional.length },
    { key: 'values' as const,     label: 'Values',             count: values.length },
    { key: 'tags' as const,       label: 'Tags',               count: storeTags.length },
  ];

  const shadowStyle = { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 12px rgba(234,88,12,0.25)' };

  return (
    <div className="flex flex-col flex-1 animate-fade-in">

      {/* Action button row */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => {
            if (tab === 'standard') setStdModal({ open: true });
            else if (tab === 'additional') setAddModal({ open: true });
            else if (tab === 'tags') setTagCreating(true);
            else setValueModal({ open: true });
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5"
          style={shadowStyle}
        >
          <Plus className="w-4 h-4" />
          {tab === 'standard' && 'New Field'}
          {tab === 'additional' && 'New Question'}
          {tab === 'values' && 'New Value'}
          {tab === 'tags' && 'New Tag'}
        </button>
      </div>

      {/* Pipeline dropdown only on Additional tab */}
      {tab === 'additional' && (
        <div className="flex items-center pb-4">
          <div className="flex items-center gap-2 bg-white border border-black/10 rounded-xl px-3 py-2" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <span className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wide">Pipeline</span>
            <select
              value={selectedPipeline}
              onChange={(e) => setSelectedPipeline(e.target.value)}
              className="text-[13px] font-semibold text-[#1c1410] outline-none bg-transparent cursor-pointer"
            >
              <option value="all">All Pipelines</option>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ═══════════════════════ TAB 1: Standard Fields ═══════════════════════ */}
      {tab === 'standard' && (
        <div className="space-y-4">

          {/* Group pills at the top — Contact · Company · Calendar · Custom */}
          <div className="flex items-center gap-2 flex-wrap">
            {[...SYSTEM_GROUPS, 'Custom'].map((g) => {
              const active = activeGroup === g;
              return (
                <button
                  key={g}
                  onClick={() => setActiveGroup(g)}
                  className={cn(
                    'px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition-colors',
                    active
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'bg-white text-[#7a6b5c] border-black/10 hover:border-primary/30 hover:text-primary'
                  )}
                >
                  {g}
                </button>
              );
            })}
          </div>

          {/* ── Content for active group ── */}

          {/* System groups (Contact/Company/Calendar) */}
          {activeGroup !== 'Custom' && (
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {/* Column headers */}
              <div className="grid gap-3 px-4 py-2.5 border-b border-black/[0.06] bg-[var(--app-bg)] grid-cols-[1fr_1.3fr_80px]">
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Name</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Custom Value</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider text-right">Copy</span>
              </div>

              {filteredStandard.system.filter((f) => f.group === activeGroup).map((f) => {
                const d = dataTypeInfo(f.type);
                return (
                  <div key={f.id} className="grid gap-3 px-4 py-2.5 border-b border-black/[0.04] last:border-b-0 items-center hover:bg-[var(--app-bg)] transition-colors grid-cols-[1fr_1.3fr_80px]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-6 h-6 rounded-md bg-[var(--app-bg)] flex items-center justify-center text-[#7a6b5c] shrink-0">
                        <d.Icon className="w-3 h-3" />
                      </div>
                      <p className="text-[13px] text-[#1c1410] font-medium truncate">{f.name}</p>
                    </div>
                    <code className="text-[11px] font-mono text-[#7a6b5c] bg-[var(--app-bg)] px-2 py-1 rounded truncate inline-block">{`{%${f.slug}%}`}</code>
                    <div className="flex items-center justify-end">
                      <button onClick={() => copyToken(f.slug)} title="Copy unique key" className="w-7 h-7 rounded-lg hover:bg-[#faf0e8] flex items-center justify-center text-[#7a6b5c] hover:text-primary transition-colors">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {filteredStandard.system.filter((f) => f.group === activeGroup).length === 0 && (
                <div className="py-10 text-center">
                  <p className="text-[13px] text-[#b09e8d]">No fields in {activeGroup}</p>
                </div>
              )}
            </div>
          )}

          {/* Custom group */}
          {activeGroup === 'Custom' && (
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              <div className="grid grid-cols-[1fr_1.3fr_90px_130px] gap-3 px-4 py-2.5 border-b border-black/[0.06] bg-[var(--app-bg)]">
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Field Name</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Unique Key</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Status</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider text-right">Actions</span>
              </div>

              {filteredStandard.custom.length === 0 ? (
                <div className="py-12 text-center">
                  <Plus className="w-6 h-6 mx-auto text-[#c4b09e] mb-2" />
                  <p className="text-[13px] text-[#7a6b5c] mb-3">No custom fields yet</p>
                  <button onClick={() => setStdModal({ open: true })} className="px-4 py-1.5 rounded-lg text-[12px] font-bold text-white" style={shadowStyle}>
                    + Create first field
                  </button>
                </div>
              ) : (
                filteredStandard.custom.map((f) => {
                  const d = dataTypeInfo(f.type);
                  return (
                    <div key={f.id} className="group grid grid-cols-[1fr_1.3fr_90px_130px] gap-3 px-4 py-2.5 border-b border-black/[0.04] last:border-b-0 items-center hover:bg-[var(--app-bg)] transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <d.Icon className="w-3 h-3" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[#1c1410] truncate">{f.name}</p>
                          <p className="text-[10px] text-[#b09e8d]">{f.type}{f.options && f.options.length > 0 ? ` · ${f.options.length} options` : ''}</p>
                        </div>
                      </div>
                      <code className="text-[11px] font-mono text-[#7a6b5c] bg-[var(--app-bg)] px-2 py-1 rounded truncate inline-block">{`{%${f.slug}%}`}</code>
                      <button
                        onClick={async () => {
                          const next = !(f.is_active !== false);
                          setCustomStandard((p) => p.map((x) => x.id === f.id ? { ...x, is_active: next } : x));
                          try {
                            await api.patch(`/api/fields/custom/${f.id}`, { is_active: next });
                          } catch {
                            setCustomStandard((p) => p.map((x) => x.id === f.id ? { ...x, is_active: !next } : x));
                            toast.error('Failed to update status');
                          }
                        }}
                        title={(f.is_active !== false) ? 'Active (click to disable)' : 'Inactive (click to enable)'}
                        className={cn('relative w-9 h-5 rounded-full transition-colors', (f.is_active !== false) ? 'bg-primary' : 'bg-gray-200')}
                      >
                        <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
                          (f.is_active !== false) ? 'translate-x-[18px]' : 'translate-x-0.5'
                        )} />
                      </button>
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setStdModal({ open: true, editing: f })} title="Edit" className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-[#7a6b5c] hover:text-primary transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => copyToken(f.slug)} title="Copy unique key" className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-[#7a6b5c] hover:text-primary transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteConfirm({ type: 'custom', id: f.id, name: f.name })} title="Delete" className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#7a6b5c] hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ TAB 2: Additional Fields ═══════════════════════ */}
      {tab === 'additional' && (
        <div>
          {filteredPipelineQuestions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-black/10 py-12 text-center">
              <Plus className="w-7 h-7 mx-auto text-[#c4b09e] mb-2" />
              <p className="text-[14px] font-semibold text-[#1c1410]">No questions for this pipeline yet</p>
              <p className="text-[12px] text-[#7a6b5c] mt-1 mb-3">Add questions staff should ask leads in this stage.</p>
              <button onClick={() => setAddModal({ open: true })} className="px-4 py-1.5 rounded-lg text-[12px] font-bold text-white" style={shadowStyle}>
                + Add first question
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {filteredPipelineQuestions.map((f, idx) => {
                const d = dataTypeInfo(f.type);
                return (
                  <div key={f.id} className="group flex items-center gap-3 px-4 py-3.5 border-b border-black/[0.04] last:border-b-0 hover:bg-[var(--app-bg)] transition-colors">
                    <GripVertical className="w-4 h-4 text-[#c4b09e] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab" />
                    <span className="text-[11px] font-bold text-[#b09e8d] w-5 shrink-0">Q{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#1c1410] flex items-center gap-2">
                        {f.question}{f.required && <span className="text-red-500">*</span>}
                        {f.pipelineId === 'all' && selectedPipeline !== 'all' && (
                          <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded uppercase tracking-wider">All Pipelines</span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#7a6b5c] bg-[var(--app-bg)] px-1.5 py-0.5 rounded">
                          <d.Icon className="w-2.5 h-2.5" /> {f.type}
                        </span>
                        {f.options && f.options.length > 0 && <span className="text-[10px] text-[#b09e8d]">{f.options.length} options</span>}
                        <button onClick={() => copyToken(`custom.${f.slug}`)} className="text-[10px] font-mono text-[#b09e8d] hover:text-primary transition-colors">
                          {`{%custom.${f.slug}%}`}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => setAddModal({ open: true, editing: f })} title="Edit" className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-[#7a6b5c] hover:text-primary transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteConfirm({ type: 'question', id: f.id, name: f.question })} title="Delete" className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#7a6b5c] hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Clone from another pipeline */}
          {filteredPipelineQuestions.length > 0 && pipelines.length > 1 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  const other = pipelines.find((p) => p.id !== selectedPipeline);
                  if (!other) return;
                  const toCopy = additional.filter((a) => a.pipelineId === other.id);
                  if (toCopy.length === 0) { toast.info(`No questions in ${other.name} to copy`); return; }
                  Promise.all(toCopy.map((a) =>
                    api.post<any>('/api/fields/questions', {
                      pipeline_id: selectedPipeline, question: a.question, type: a.type,
                      slug: `${a.slug}_copy_${Date.now()}`.slice(0, 100),
                      options: a.options, required: a.required,
                    }).then((created) => ({ ...a, id: created.id, pipelineId: selectedPipeline }))
                  )).then((copied) => {
                    setAdditional((p) => [...p, ...copied]);
                    toast.success(`Copied ${copied.length} questions from ${other.name}`);
                  }).catch(() => toast.error('Failed to copy questions'));
                }}
                className="text-[12px] text-primary font-semibold hover:underline flex items-center gap-1 mx-auto"
              >
                <Copy className="w-3 h-3" /> Copy questions from another pipeline
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ TAB 3: Values ═══════════════════════ */}
      {tab === 'values' && (
        <div>
          {filteredValues.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-black/10 py-12 text-center">
              <Plus className="w-7 h-7 mx-auto text-[#c4b09e] mb-2" />
              <p className="text-[14px] font-semibold text-[#1c1410]">No values yet</p>
              <p className="text-[12px] text-[#7a6b5c] mt-1 mb-3">Create shortcuts for things you type often.</p>
              <button onClick={() => setValueModal({ open: true })} className="px-4 py-1.5 rounded-lg text-[12px] font-bold text-white" style={shadowStyle}>
                + Create first value
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {/* Table header */}
              <div className="hidden sm:grid grid-cols-[1fr_200px_1fr_100px] gap-3 px-4 py-2.5 border-b border-black/[0.04] bg-[var(--app-bg)]">
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Name</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Unique Key</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Replaces with</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider text-right">Actions</span>
              </div>

              {filteredValues.map((v) => {
                const token = slugify(v.name);
                return (
                <div key={v.id} className="group grid grid-cols-1 sm:grid-cols-[1fr_200px_1fr_100px] gap-3 px-4 py-3 border-b border-black/[0.04] last:border-b-0 hover:bg-[var(--app-bg)] transition-colors items-center">
                  <p className="text-[13px] text-[#1c1410] font-medium truncate">{v.name}</p>
                  <button onClick={() => copyToken(token)} className="text-left">
                    <code className="text-[11px] font-mono text-primary bg-primary/10 hover:bg-primary/15 px-2 py-1 rounded inline-block transition-colors">{`{%${token}%}`}</code>
                  </button>
                  <p className="text-[12px] text-[#7a6b5c] truncate">{v.replaceWith}</p>
                  <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setValueModal({ open: true, editing: v })} title="Edit" className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-[#7a6b5c] hover:text-primary transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteConfirm({ type: 'value', id: v.id, name: v.name })} title="Delete" className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#7a6b5c] hover:text-red-500 transition-colors">
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

      {/* ═══════════════════════ TAB 4: Tags ═══════════════════════ */}
      {tab === 'tags' && (
        <div>
          {storeTags.length === 0 && !tagCreating ? (
            <div className="bg-white rounded-2xl border border-dashed border-black/10 py-12 text-center">
              <Tag className="w-7 h-7 mx-auto text-[#c4b09e] mb-2" />
              <p className="text-[14px] font-semibold text-[#1c1410]">No tags yet</p>
              <p className="text-[12px] text-[#7a6b5c] mt-1 mb-3">Create tags to organize and categorize your leads.</p>
              {canManageTags && (
                <button onClick={() => setTagCreating(true)} className="px-4 py-1.5 rounded-lg text-[12px] font-bold text-white" style={shadowStyle}>
                  + Create first tag
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
              {/* Table header */}
              <div className="hidden sm:grid grid-cols-[auto_1fr_120px_120px_100px] gap-3 px-4 py-2.5 border-b border-black/[0.04] bg-[var(--app-bg)]">
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider w-8">Color</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider">Tag Name</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider text-center">Leads</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider text-center">Created</span>
                <span className="text-[10px] font-bold text-[#7a6b5c] uppercase tracking-wider text-right">Actions</span>
              </div>

              {/* New tag inline row */}
              {tagCreating && (
                <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_120px_120px_100px] gap-3 px-4 py-3 border-b border-black/[0.04] bg-amber-50/40 items-center">
                  <input
                    type="color"
                    value={tagNewColor}
                    onChange={(e) => setTagNewColor(e.target.value)}
                    className="w-8 h-8 rounded-lg border border-black/10 cursor-pointer p-0.5"
                  />
                  <input
                    autoFocus
                    value={tagNewName}
                    onChange={(e) => setTagNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagNewName.trim()) {
                        (async () => {
                          setTagSaving(true);
                          try {
                            const created = await api.post<any>('/api/tags', { name: tagNewName.trim(), color: tagNewColor });
                            storeAddTag({ id: created.id, name: created.name, color: created.color, count: 0 });
                            setTagNewName(''); setTagNewColor('#94a3b8'); setTagCreating(false);
                            toast.success(`Tag "${created.name}" created`);
                          } catch (err: any) {
                            toast.error(err.message ?? 'Failed to create tag');
                          } finally { setTagSaving(false); }
                        })();
                      } else if (e.key === 'Escape') {
                        setTagCreating(false); setTagNewName(''); setTagNewColor('#94a3b8');
                      }
                    }}
                    placeholder="Tag name..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white"
                  />
                  <span />
                  <span />
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      disabled={!tagNewName.trim() || tagSaving}
                      onClick={async () => {
                        setTagSaving(true);
                        try {
                          const created = await api.post<any>('/api/tags', { name: tagNewName.trim(), color: tagNewColor });
                          storeAddTag({ id: created.id, name: created.name, color: created.color, count: 0 });
                          setTagNewName(''); setTagNewColor('#94a3b8'); setTagCreating(false);
                          toast.success(`Tag "${created.name}" created`);
                        } catch (err: any) {
                          toast.error(err.message ?? 'Failed to create tag');
                        } finally { setTagSaving(false); }
                      }}
                      className="w-7 h-7 rounded-lg bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary disabled:opacity-40 transition-colors"
                      title="Save"
                    ><Check className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={() => { setTagCreating(false); setTagNewName(''); setTagNewColor('#94a3b8'); }}
                      className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#7a6b5c] hover:text-red-500 transition-colors"
                      title="Cancel"
                    ><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              )}

              {/* Tag rows */}
              {(search ? storeTags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) : storeTags).map((t) => {
                const isEditing = tagEdit?.id === t.id;
                return (
                  <div key={t.id} className="group grid grid-cols-1 sm:grid-cols-[auto_1fr_120px_120px_100px] gap-3 px-4 py-3 border-b border-black/[0.04] last:border-b-0 hover:bg-[var(--app-bg)] transition-colors items-center">
                    {isEditing ? (
                      <>
                        <input
                          type="color"
                          value={tagEdit!.color}
                          onChange={(e) => setTagEdit({ ...tagEdit!, color: e.target.value })}
                          className="w-8 h-8 rounded-lg border border-black/10 cursor-pointer p-0.5"
                        />
                        <input
                          autoFocus
                          value={tagEdit!.name}
                          onChange={(e) => setTagEdit({ ...tagEdit!, name: e.target.value })}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter' && tagEdit!.name.trim()) {
                              setTagSaving(true);
                              try {
                                await api.patch(`/api/tags/${t.id}`, { name: tagEdit!.name.trim(), color: tagEdit!.color });
                                storeUpdateTag(t.id, { name: tagEdit!.name.trim(), color: tagEdit!.color });
                                setTagEdit(null);
                                toast.success('Tag updated');
                              } catch (err: any) { toast.error(err.message ?? 'Failed to update'); }
                              finally { setTagSaving(false); }
                            } else if (e.key === 'Escape') { setTagEdit(null); }
                          }}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white"
                        />
                        <span className="text-[13px] text-[#7a6b5c] text-center">{t.count}</span>
                        <span />
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            disabled={!tagEdit!.name.trim() || tagSaving}
                            onClick={async () => {
                              setTagSaving(true);
                              try {
                                await api.patch(`/api/tags/${t.id}`, { name: tagEdit!.name.trim(), color: tagEdit!.color });
                                storeUpdateTag(t.id, { name: tagEdit!.name.trim(), color: tagEdit!.color });
                                setTagEdit(null);
                                toast.success('Tag updated');
                              } catch (err: any) { toast.error(err.message ?? 'Failed to update'); }
                              finally { setTagSaving(false); }
                            }}
                            className="w-7 h-7 rounded-lg bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary disabled:opacity-40 transition-colors"
                          ><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setTagEdit(null)} className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#7a6b5c] hover:text-red-500 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-8 h-8 rounded-lg border border-black/10 shrink-0" style={{ backgroundColor: t.color ?? '#94a3b8' }} />
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-[#1c1410] font-medium">{t.name}</span>
                        </div>
                        <span className="text-[13px] text-[#7a6b5c] text-center">{t.count}</span>
                        <span className="text-[12px] text-[#b09e8d] text-center">-</span>
                        {canManageTags && (
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setTagEdit({ id: t.id, name: t.name, color: t.color })} title="Edit" className="w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-[#7a6b5c] hover:text-primary transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm({ type: 'tag' as any, id: t.id, name: t.name })}
                              title="Delete"
                              className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#7a6b5c] hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ Modals ═══════════════════════ */}

      {stdModal.open && (
        <StandardFieldModal
          field={stdModal.editing}
          onClose={() => setStdModal({ open: false })}
          onSave={async (f) => {
            const editingId = stdModal.editing?.id;
            const allKeys = [
              ...SYSTEM_STANDARD.map((x) => x.slug.toLowerCase()),
              ...customStandard.filter((x) => x.id !== editingId).map((x) => x.slug.toLowerCase()),
              ...additional.map((a) => `custom.${a.slug}`.toLowerCase()),
              ...values.map((v) => slugify(v.name)),
            ];
            if (allKeys.includes(f.slug.toLowerCase())) {
              toast.error(`Key "{%${f.slug}%}" already exists. Pick a different name.`);
              return;
            }
            try {
              if (stdModal.editing) {
                await api.patch<any>(`/api/fields/custom/${stdModal.editing.id}`, {
                  name: f.name, type: f.type, placeholder: f.placeholder,
                  options: f.options, required: f.required,
                });
                setCustomStandard((p) => p.map((x) => x.id === stdModal.editing!.id ? { ...x, ...f, id: x.id } : x));
                storeUpdateCustomField(stdModal.editing.id, { name: f.name, type: f.type as any, slug: f.slug, required: f.required, options: f.options });
                toast.success('Field updated');
              } else {
                const created = await api.post<any>('/api/fields/custom', {
                  name: f.name, type: f.type, slug: f.slug, placeholder: f.placeholder,
                  options: f.options, required: f.required, is_active: true,
                });
                setCustomStandard((p) => [...p, { ...f, id: created.id, is_active: true }]);
                storeAddCustomField({ id: created.id, name: f.name, slug: f.slug, type: f.type as any, required: f.required ?? false, visible: true, options: f.options, orderIndex: 0 });
                toast.success(`Field "${f.name}" created`);
              }
              setStdModal({ open: false });
            } catch (err: any) {
              toast.error(err.message ?? 'Failed to save field');
            }
          }}
        />
      )}

      {addModal.open && (
        <AdditionalFieldModal
          pipelineId={selectedPipeline}
          field={addModal.editing}
          onClose={() => setAddModal({ open: false })}
          onSave={async (f) => {
            const editingId = addModal.editing?.id;
            const newKey = `custom.${f.slug}`.toLowerCase();
            const allKeys = [
              ...SYSTEM_STANDARD.map((x) => x.slug.toLowerCase()),
              ...customStandard.map((x) => x.slug.toLowerCase()),
              ...additional.filter((x) => x.id !== editingId).map((a) => `custom.${a.slug}`.toLowerCase()),
              ...values.map((v) => slugify(v.name)),
            ];
            if (allKeys.includes(newKey)) {
              toast.error(`Key "{%${newKey}%}" already exists. Pick a different question name.`);
              return;
            }
            try {
              if (addModal.editing) {
                await api.patch(`/api/fields/questions/${addModal.editing.id}`, {
                  question: f.question, type: f.type, options: f.options, required: f.required,
                });
                setAdditional((p) => p.map((x) => x.id === addModal.editing!.id ? { ...x, ...f } : x));
                storeUpdateAdditionalField(addModal.editing.id, { question: f.question, type: f.type as any, options: f.options, required: f.required });
                toast.success('Question updated');
              } else {
                const created = await api.post<any>('/api/fields/questions', {
                  pipeline_id: f.pipelineId, question: f.question, type: f.type,
                  slug: f.slug, options: f.options, required: f.required,
                });
                setAdditional((p) => [...p, { ...f, id: created.id }]);
                storeAddAdditionalField({ id: created.id, pipelineId: f.pipelineId, question: f.question, type: f.type as any, slug: f.slug, options: f.options, required: f.required ?? false });
                toast.success('Question added');
              }
              setAddModal({ open: false });
            } catch (err: any) {
              toast.error(err.message ?? 'Failed to save question');
            }
          }}
        />
      )}

      {valueModal.open && (
        <ValueModal
          value={valueModal.editing}
          onClose={() => setValueModal({ open: false })}
          onSave={async (v) => {
            const editingId = valueModal.editing?.id;
            const newToken = slugify(v.name);
            const allKeys = [
              ...values.filter((x) => x.id !== editingId).map((x) => slugify(x.name)),
              ...SYSTEM_STANDARD.map((f) => f.slug.toLowerCase()),
              ...customStandard.map((f) => f.slug.toLowerCase()),
              ...additional.map((a) => `custom.${a.slug}`.toLowerCase()),
            ];
            if (allKeys.includes(newToken)) {
              toast.error(`Unique key "{%${newToken}%}" already exists. Pick a different name.`);
              return;
            }
            try {
              if (valueModal.editing) {
                await api.patch(`/api/fields/values/${valueModal.editing.id}`, {
                  name: v.name, replace_with: v.replaceWith,
                });
                setValues((p) => p.map((x) => x.id === valueModal.editing!.id ? { ...x, ...v } : x));
                toast.success('Value updated');
              } else {
                const created = await api.post<any>('/api/fields/values', {
                  name: v.name, replace_with: v.replaceWith,
                });
                setValues((p) => [...p, { ...v, id: created.id }]);
                toast.success(`Value {%${newToken}%} created`);
              }
              setValueModal({ open: false });
            } catch (err: any) {
              toast.error(err.message ?? 'Failed to save value');
            }
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <h3 className="text-[15px] font-bold text-[#1c1410] mb-2">Delete Field</h3>
              <p className="text-[13px] text-[#7a6b5c]">
                Are you sure you want to delete <span className="font-semibold text-[#1c1410]">"{deleteConfirm.name}"</span>? This cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 px-6 py-4">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] bg-[#f0ebe5] hover:bg-[#e8ddd4] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
