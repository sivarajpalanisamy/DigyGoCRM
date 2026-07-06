import { useState } from 'react';
import { Type, AlignLeft, Mail, Phone, Hash, ChevronDown, ToggleLeft, CalendarDays, X, ArrowLeft, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// Mirrors the custom-form builder's field creator so fields created from anywhere
// (forms, Google Sheets mapping, …) are identical CRM-wide.
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

const dataTypeToFieldType = (dt: DataType): string => {
  if (dt === 'Email')        return 'email';
  if (dt === 'Phone')        return 'phone';
  if (dt === 'Number')       return 'number';
  if (dt === 'Multi Line')   return 'textarea';
  if (dt === 'Dropdown')     return 'dropdown';
  if (dt === 'Radio')        return 'radio';
  if (dt === 'Multi-select') return 'multiselect';
  if (dt === 'Checkbox')     return 'checkbox';
  return 'text';
};

export default function CreateCustomFieldModal({
  initialName = '',
  onClose,
  onCreate,
}: {
  initialName?: string;
  onClose: () => void;
  onCreate: (field: { id: string; name: string; slug: string; type: string; options?: string[] }) => void;
}) {
  const [step, setStep] = useState<'pick' | 'detail'>('pick');
  const [dataType, setDataType] = useState<DataType>('Single Line');
  const [name, setName] = useState(initialName);
  const [placeholder, setPlaceholder] = useState('');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<string[]>(['', '']);
  const [saving, setSaving] = useState(false);

  const slug = slugify(name);
  const needsOptions = HAS_OPTIONS.includes(dataType);

  const updateOption = (idx: number, val: string) => { const next = [...options]; next[idx] = val; setOptions(next); };
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
      // If the slug already exists, treat it as a successful pick of that field.
      if (/exist/i.test(err?.message ?? '')) {
        toast.message(`Using existing field "${slug}"`);
        onCreate({ id: '', name: name.trim(), slug, type: fieldType, options: needsOptions ? validOpts : undefined });
      } else {
        toast.error(err?.message ?? 'Failed to create field');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className={cn('bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[88vh]', step === 'pick' ? 'max-w-lg' : 'max-w-md')}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <div className="flex items-center gap-2.5">
            {step === 'detail' && (
              <button onClick={() => setStep('pick')} className="p-1 rounded-lg hover:bg-gray-100 text-[#7a6b5c]">
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <div>
              <h3 className="font-bold text-[#1c1410] text-[15px] leading-tight">
                {step === 'pick' ? 'Choose field type' : `New Field - ${dataType}`}
              </h3>
              <p className="text-[11px] text-[#7a6b5c] mt-0.5">
                {step === 'pick' ? 'Pick the type of data this field will capture' : "Name it - it'll be saved to your Fields page too"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-4 h-4" /></button>
        </div>

        {/* Step 1: Type picker */}
        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-4 gap-2">
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
                        : 'border-black/[0.06] hover:border-primary/40 hover:bg-primary/5 text-[#7a6b5c] hover:text-primary'
                    )}
                  >
                    <t.Icon className="w-4 h-4" />
                    <span className="text-[10px] font-semibold leading-tight">{t.label}</span>
                    <span className="text-[9px] text-[#b09e8d] leading-tight hidden sm:block">{t.hint}</span>
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
              <label className="text-[13px] font-semibold text-[#7a6b5c] mb-1.5 block">
                Field Name <span className="text-red-400">*</span>
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Age Group, Course Name…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[14px] text-[#1c1410] outline-none focus:border-primary/40 bg-white"
              />
              {slug && (
                <p className="text-[11px] text-[#b09e8d] mt-1">
                  Slug: <code className="bg-[var(--app-bg)] px-1 py-0.5 rounded font-mono">{slug}</code>
                </p>
              )}
            </div>

            {!needsOptions && (
              <div>
                <label className="text-[13px] font-semibold text-[#7a6b5c] mb-1.5 block">
                  Placeholder <span className="text-[#b09e8d] font-normal">(optional)</span>
                </label>
                <input
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                  placeholder="Hint shown inside the empty field"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[14px] text-[#1c1410] outline-none focus:border-primary/40 bg-white"
                />
              </div>
            )}

            {needsOptions && (
              <div>
                <label className="text-[13px] font-semibold text-[#7a6b5c] mb-2 block">Options <span className="text-red-400">*</span></label>
                <div className="space-y-2">
                  {options.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-[11px] text-[#b09e8d] w-5 shrink-0 text-right">{idx + 1}.</span>
                      <input
                        value={opt}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={`Option ${idx + 1}`}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[14px] text-[#1c1410] outline-none focus:border-primary/40 bg-white"
                      />
                      <button
                        onClick={() => removeOption(idx)}
                        disabled={options.length <= 1}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-[#c4b09e] hover:text-red-500 transition-colors disabled:opacity-30"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addOption}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold text-primary hover:bg-primary/5 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add option
                </button>
              </div>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="w-4 h-4 accent-primary" />
              <span className="text-[14px] text-[#1c1410]">Mark as required</span>
            </label>
          </div>
        )}

        {/* Footer */}
        {step === 'detail' && (
          <div className="flex gap-2 px-6 py-4 border-t border-black/5">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-[14px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-[14px] font-bold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
            >
              {saving ? 'Creating…' : 'Create & Use Field'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
