import { useState } from 'react';
import {
  X, ArrowLeft, Plus, Trash2, Check,
  Type, AlignLeft, Hash, Phone as PhoneIcon, IndianRupee,
  ChevronDown, ChevronsUpDown, CircleDot, SquareCheck,
  CalendarDays, FileUp, Mail, Link as LinkIcon, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ElementType } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DataType =
  | 'Single Line' | 'Multi Line' | 'Number' | 'Phone' | 'Monetary'
  | 'Email' | 'URL' | 'Dropdown' | 'Multi-select' | 'Radio'
  | 'Multi-Checkbox' | 'Checkbox' | 'Date' | 'File Upload';

export interface CreatedField {
  id: string;
  name: string;
  slug: string;
  type: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DATA_TYPES: { label: DataType; Icon: ElementType; hint: string; hasOptions?: boolean }[] = [
  { label: 'Single Line',    Icon: Type,           hint: 'Short text (e.g. name)'         },
  { label: 'Multi Line',     Icon: AlignLeft,      hint: 'Long text (notes, description)' },
  { label: 'Email',          Icon: Mail,           hint: 'Email address'                  },
  { label: 'URL',            Icon: LinkIcon,       hint: 'Website or link'                },
  { label: 'Number',         Icon: Hash,           hint: 'Any whole or decimal number'    },
  { label: 'Phone',          Icon: PhoneIcon,      hint: 'Phone number (E.164)'           },
  { label: 'Monetary',       Icon: IndianRupee,    hint: 'Currency amount (₹)'            },
  { label: 'Dropdown',       Icon: ChevronDown,    hint: 'Pick one from a list',          hasOptions: true },
  { label: 'Multi-select',   Icon: ChevronsUpDown, hint: 'Pick many from a dropdown',     hasOptions: true },
  { label: 'Radio',          Icon: CircleDot,      hint: 'Pick one — all options visible', hasOptions: true },
  { label: 'Multi-Checkbox', Icon: SquareCheck,    hint: 'Pick many — all options visible', hasOptions: true },
  { label: 'Checkbox',       Icon: Check,          hint: 'Simple Yes / No toggle'         },
  { label: 'Date',           Icon: CalendarDays,   hint: 'Date picker'                    },
  { label: 'File Upload',    Icon: FileUp,         hint: 'Attach a file'                  },
];

const slugify = (s: string): string => {
  const ascii = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  if (ascii) return ascii;
  // Non-ASCII input (Tamil, etc.): stable hash so the slug never changes for the same name
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return 'field_' + Math.abs(h).toString(36).slice(0, 8);
};

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 bg-white';

// ── FieldSelector ─────────────────────────────────────────────────────────────

function FieldSelector({ value, onChange }: { value: DataType; onChange: (t: DataType) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {DATA_TYPES.map((d) => {
        const active = value === d.label;
        return (
          <button
            key={d.label}
            type="button"
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

// ── OptionBuilder ─────────────────────────────────────────────────────────────

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
            />
            <button
              type="button"
              onClick={() => removeOption(idx)}
              disabled={options.length <= 1}
              className="w-9 h-9 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#c4b09e] hover:text-red-500 transition-colors disabled:opacity-30"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-primary hover:bg-primary/5 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add option
        </button>
      </div>
    </div>
  );
}

// ── AddCustomFieldModal ───────────────────────────────────────────────────────

export function AddCustomFieldModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (field: CreatedField) => void;
}) {
  const [step, setStep]       = useState<'pick' | 'detail'>('pick');
  const [type, setType]       = useState<DataType>('Single Line');
  const [name, setName]       = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<OptionItem[]>([{ name: '', value: '' }]);
  const [saving, setSaving]   = useState(false);

  const typeInfo = DATA_TYPES.find((d) => d.label === type) ?? DATA_TYPES[0];
  const slug = slugify(name);

  const pickType = (t: DataType) => { setType(t); setStep('detail'); };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const validOptions = options.map((o) => o.name.trim()).filter(Boolean);
    if (typeInfo.hasOptions && validOptions.length === 0) {
      toast.error('Add at least one option'); return;
    }
    setSaving(true);
    try {
      const created = await api.post<CreatedField>('/api/fields/custom', {
        name: name.trim(), type, slug,
        placeholder: placeholder.trim() || undefined,
        options: typeInfo.hasOptions ? validOptions : undefined,
        required,
      });
      toast.success(`Field "${created.name}" created`);
      onCreated(created);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create field');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className={cn(
        'bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[88vh]',
        step === 'pick' ? 'max-w-xl' : 'max-w-md'
      )}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5">
          <div className="flex items-center gap-2.5">
            {step === 'detail' && (
              <button type="button" onClick={() => setStep('pick')} className="p-1 rounded-lg hover:bg-gray-100 text-[#7a6b5c]">
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <div>
              <h3 className="font-bold text-[#1c1410] text-[15px] leading-tight">
                {step === 'pick' ? 'Choose field type' : `New Custom Field — ${type}`}
              </h3>
              {step === 'pick' && (
                <p className="text-[11px] text-[#7a6b5c] mt-0.5">Pick a data type that fits what you want to capture</p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-[#7a6b5c]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Step 1: Type picker */}
        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <FieldSelector value={type} onChange={pickType} />
          </div>
        )}

        {/* Step 2: Details */}
        {step === 'detail' && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div>
              <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                autoFocus
                className={inputCls}
                placeholder="e.g. Company Size"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
              {slug && (
                <p className="text-[11px] text-[#b09e8d] mt-1.5">
                  Key: <code className="bg-muted px-1.5 rounded text-primary font-semibold">{`{%${slug}%}`}</code>
                </p>
              )}
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">
                Placeholder <span className="text-[#b09e8d] font-normal">(optional)</span>
              </label>
              <input
                className={inputCls}
                placeholder="Hint shown inside the empty field"
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
              />
            </div>

            {typeInfo.hasOptions && (
              <OptionBuilder options={options} onChange={setOptions} />
            )}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-[13px] text-[#1c1410]">Mark as required</span>
            </label>
          </div>
        )}

        {/* Footer */}
        {step === 'detail' && (
          <div className="flex gap-2 px-6 py-4 border-t border-black/5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white disabled:opacity-60 flex items-center justify-center gap-1.5"
              style={{ background: 'linear-gradient(135deg, #c2410c 0%, #ea580c 55%, #f97316 100%)' }}
            >
              {saving
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Creating…</>
                : <><Check className="w-3.5 h-3.5" /> Create Field</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
