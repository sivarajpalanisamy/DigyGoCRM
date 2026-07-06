import { useState, useEffect, FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { alertDialog } from '@/lib/confirm';

interface FormField {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  required: boolean;
  mapTo: string;
}

interface FormDef {
  id: string;
  name: string;
  fields: FormField[];
  submit_label: string;
  redirect_url: string | null;
  thank_you_message: string;
  btn_color: string;
  btn_text_color: string;
  form_bg_color: string | null;
  form_text_color: string;
  declaration_enabled: boolean;
  declaration_title: string | null;
  declaration_link: string | null;
}

export default function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<FormDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [thankYou, setThankYou] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const apiBase = import.meta.env.VITE_API_URL ?? '';

  useEffect(() => {
    fetch(`${apiBase}/api/public/forms/${slug}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data) => { if (data) setForm(data); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const normalizePhone = (raw: string) => {
    let cleaned = raw.replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('+91')) cleaned = cleaned.slice(3);
    else if (cleaned.startsWith('91') && cleaned.length > 10) cleaned = cleaned.slice(2);
    else if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
    return cleaned;
  };

  const validate = (): boolean => {
    if (!form) return false;
    const errs: Record<string, string> = {};
    for (const field of form.fields) {
      const val = (values[field.label] ?? '').trim();
      if (field.required && !val) {
        errs[field.label] = `${field.label} is required`;
        continue;
      }
      if (field.required && field.type === 'multiselect' && !val.split(',').filter(Boolean).length) {
        errs[field.label] = `Please select at least one option`;
        continue;
      }
      if (val && (field.mapTo === 'email' || field.type === 'email')) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          errs[field.label] = 'Please enter a valid email address';
        }
      }
      if (val && (field.mapTo === 'phone' || field.type === 'phone')) {
        const digits = normalizePhone(val);
        if (!/^\d{10}$/.test(digits)) {
          errs[field.label] = 'Please enter a valid 10-digit phone number';
        }
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!validate()) return;
    if (form.declaration_enabled && !agreed) {
      await alertDialog({ message: 'Please accept the declaration to continue.' });
      return;
    }

    // Normalize phone values before submission
    const submitData = { ...values };
    for (const field of form.fields) {
      if ((field.mapTo === 'phone' || field.type === 'phone') && submitData[field.label]) {
        submitData[field.label] = normalizePhone(submitData[field.label]);
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/api/public/forms/${slug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: submitData }),
      });
      const json = await res.json();
      if (!res.ok) { await alertDialog({ title: 'Submission failed', message: json.error ?? 'Submission failed' }); return; }
      setThankYou(json.message ?? form.thank_you_message ?? 'Thank you!');
      setSubmitted(true);
      if (json.redirectUrl && /^https?:\/\//i.test(json.redirectUrl)) {
        setTimeout(() => { window.location.href = json.redirectUrl; }, 2000);
      }
    } catch {
      await alertDialog({ title: 'Submission failed', message: 'Submission failed. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const bg = form?.form_bg_color ?? '#ffffff';
  const textColor = form?.form_text_color ?? '#1c1410';
  const btnColor = form?.btn_color ?? '#ea580c';
  const btnText = form?.btn_text_color ?? '#ffffff';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
        <p className="text-[15px] text-[#7a6b5c]">Loading form…</p>
      </div>
    );
  }

  if (notFound || !form) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
        <div className="text-center">
          <p className="text-[18px] font-bold text-[#1c1410] mb-2">Form not found</p>
          <p className="text-[15px] text-[#7a6b5c]">This form is no longer active or the link is incorrect.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)]">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: btnColor }}>
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={btnText} strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-[18px] font-bold text-[#1c1410] mb-2">{thankYou}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl shadow-xl p-8" style={{ background: bg, color: textColor }}>
        <h1 className="text-[22px] font-bold mb-6" style={{ color: textColor }}>{form.name}</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {form.fields.map((field) => {
            const key = field.label;
            const val = values[key] ?? '';
            const err = errors[key];
            const set = (v: string) => { setValues((prev) => ({ ...prev, [key]: v })); setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; }); };

            return (
              <div key={field.id ?? field.label}>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: textColor }}>
                  {field.label}
                  {field.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    placeholder={field.placeholder}
                    required={field.required}
                    rows={3}
                    className={`w-full px-3 py-2.5 rounded-xl border bg-white/70 text-[14px] outline-none focus:border-orange-400 resize-none ${err ? 'border-red-400' : 'border-black/10'}`}
                    style={{ color: textColor }}
                  />
                ) : field.type === 'dropdown' ? (
                  <select
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    required={field.required}
                    className="w-full px-3 py-2.5 rounded-xl border border-black/10 bg-white/70 text-[14px] outline-none focus:border-orange-400"
                    style={{ color: textColor }}
                  >
                    <option value="">- Select -</option>
                    {(field as any).options?.map((opt: string) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : field.type === 'radio' ? (
                  <div className="space-y-2 pt-1">
                    {((field as any).options ?? []).map((opt: string) => (
                      <label key={opt} className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="radio"
                          name={field.id}
                          value={opt}
                          checked={val === opt}
                          onChange={() => set(opt)}
                          required={field.required}
                          className="w-4 h-4"
                          style={{ accentColor: btnColor }}
                        />
                        <span className="text-[14px]" style={{ color: textColor }}>{opt}</span>
                      </label>
                    ))}
                  </div>
                ) : field.type === 'multiselect' ? (
                  <div className="space-y-2 pt-1">
                    {((field as any).options ?? []).map((opt: string) => {
                      const selected = val.split(',').filter(Boolean);
                      const checked = selected.includes(opt);
                      return (
                        <label key={opt} className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = checked
                                ? selected.filter((s) => s !== opt)
                                : [...selected, opt];
                              set(next.join(','));
                            }}
                            className="w-4 h-4 rounded"
                            style={{ accentColor: btnColor }}
                          />
                          <span className="text-[14px]" style={{ color: textColor }}>{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : field.type === 'checkbox' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={val === 'true'}
                      onChange={(e) => set(e.target.checked ? 'true' : '')}
                      className="w-4 h-4 rounded"
                      style={{ accentColor: btnColor }}
                    />
                    <span className="text-[14px]" style={{ color: textColor }}>{field.placeholder || field.label}</span>
                  </div>
                ) : (
                  <input
                    type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    placeholder={field.placeholder}
                    required={field.required}
                    className={`w-full px-3 py-2.5 rounded-xl border bg-white/70 text-[14px] outline-none focus:border-orange-400 ${err ? 'border-red-400' : 'border-black/10'}`}
                    style={{ color: textColor }}
                  />
                )}
                {err && <p className="text-[11px] text-red-500 mt-1">{err}</p>}
              </div>
            );
          })}

          {form.declaration_enabled && form.declaration_title && (
            <div className="flex items-start gap-2 pt-1">
              <input
                type="checkbox"
                id="declaration"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded shrink-0"
                style={{ accentColor: btnColor }}
              />
              <label htmlFor="declaration" className="text-[13px] cursor-pointer" style={{ color: textColor }}>
                {form.declaration_title}
                {form.declaration_link && (
                  <a href={form.declaration_link} target="_blank" rel="noreferrer"
                    className="underline ml-1 opacity-70">View Policy</a>
                )}
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl text-[15px] font-semibold mt-2 disabled:opacity-60 transition-opacity"
            style={{ background: btnColor, color: btnText }}
          >
            {submitting ? 'Submitting…' : (form.submit_label || 'Submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
