import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, ChevronDown, Plus, X, Loader2, Check, Send,
  Upload, Paperclip, FileText, Image as ImageIcon, Film, Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { api, getAccessToken, BASE } from '@/lib/api';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────
type WABACategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
interface WABAButton { id: string; type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; label: string; value: string; }
interface Template {
  id: string; name: string; template_type: string; category: string; language: string;
  status: string; body: string; header?: string | null; footer?: string | null;
  buttons: WABAButton[] | string; meta_template_id?: string | null; meta_name?: string | null;
  variables?: any; file_path?: string | null; file_type?: string | null; file_name?: string | null;
  meta_components?: any;
}

const LANGUAGES = ['en', 'hi', 'ta', 'te', 'kn', 'mr'];
const WABA_CATS: WABACategory[] = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

const STANDARD_VARS = [
  { key: 'first_name', label: 'First Name', sample: 'Ravi' },
  { key: 'last_name', label: 'Last Name', sample: 'Kumar' },
  { key: 'full_name', label: 'Full Name', sample: 'Ravi Kumar' },
  { key: 'phone', label: 'Phone', sample: '+91 98765 43210' },
  { key: 'email', label: 'Email', sample: 'ravi@example.com' },
  { key: 'source', label: 'Source', sample: 'Meta Form' },
  { key: 'today', label: "Today's Date", sample: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) },
];

const CRM_VARS = [
  { key: 'stage', label: 'Stage', sample: 'Qualified' },
  { key: 'pipeline', label: 'Pipeline', sample: 'Sales' },
  { key: 'assigned_staff', label: 'Assigned Staff', sample: 'Roshan' },
  { key: 'appointment_date', label: 'Appointment Date', sample: '13 May 2026' },
  { key: 'appointment_start_time', label: 'Start Time', sample: '10:30 AM' },
  { key: 'appointment_end_time', label: 'End Time', sample: '11:00 AM' },
  { key: 'appointment_timezone', label: 'Timezone', sample: 'Asia/Kolkata' },
  { key: 'calendar_name', label: 'Calendar Name', sample: 'Discovery Call' },
  { key: 'meeting_link', label: 'Meeting Link', sample: 'https://meet.google.com/abc-xyz' },
];

function parseButtons(b: WABAButton[] | string | undefined | null): WABAButton[] {
  if (!b) return [];
  let arr: any[];
  if (typeof b === 'string') { try { arr = JSON.parse(b); } catch { return []; } }
  else if (Array.isArray(b)) { arr = b; }
  else { return []; }
  return arr.map((btn: any, i: number) => ({
    id: btn.id || `b-${i}-${Date.now()}`,
    type: btn.type ?? 'QUICK_REPLY',
    label: btn.label ?? btn.text ?? '',
    value: btn.value ?? btn.url ?? btn.phone_number ?? '',
  }));
}

// Meta character limits
const LIMITS = { name: 512, header: 60, body: 1024, footer: 60, buttonLabel: 25 };
const META_NAME_RE = /^[a-z0-9_]*$/;

export default function WABATemplateEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<WABACategory>('UTILITY');
  const [language, setLanguage] = useState('en');
  const [headerType, setHeaderType] = useState<'none' | 'text' | 'image' | 'video' | 'document'>('none');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<WABAButton[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [existingFile, setExistingFile] = useState<{ name: string } | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingToMeta, setSavingToMeta] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [submitMeta, setSubmitMeta] = useState(!isEdit);
  const [isMetaSynced, setIsMetaSynced] = useState(false);
  const [bodyExamples, setBodyExamples] = useState<Record<string, string>>({});
  const [testPhone, setTestPhone] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [showTestPanel, setShowTestPanel] = useState(false);
  // Variable mapping: {{N}} → CRM field key (e.g. "1" → "first_name")
  const [varMapping, setVarMapping] = useState<Record<string, string>>({});

  // Variable picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerTab, setPickerTab] = useState<'Standard' | 'CRM' | 'Custom' | 'Values'>('Standard');
  const [customFields, setCustomFields] = useState<Array<{ slug: string; name: string }>>([]);
  const [valueTokens, setValueTokens] = useState<Array<{ name: string; replace_with: string }>>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Fetch custom fields + value tokens when picker opens
  useEffect(() => {
    if (!pickerOpen) return;
    const tok = getAccessToken();
    const headers: Record<string, string> = tok ? { Authorization: `Bearer ${tok}` } : {};
    Promise.all([
      fetch(`${BASE}/api/fields/custom`, { headers, credentials: 'include' }).then((r) => r.json()).catch(() => []),
      fetch(`${BASE}/api/fields/values`, { headers, credentials: 'include' }).then((r) => r.json()).catch(() => []),
    ]).then(([cf, vt]) => {
      if (Array.isArray(cf)) setCustomFields(cf.map((f: any) => ({ slug: f.slug, name: f.name })));
      if (Array.isArray(vt)) setValueTokens(vt.map((v: any) => ({ name: v.name, replace_with: v.replace_with })));
    });
  }, [pickerOpen]);

  // Detect {{1}}, {{2}}, etc. in body text
  const bodyVars = Array.from(body.matchAll(/\{\{(\d+)\}\}/g))
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => Number(a) - Number(b));

  // Detect {{1}} in header text
  const headerVars = Array.from(header.matchAll(/\{\{(\d+)\}\}/g))
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => Number(a) - Number(b));

  // Build picker categories
  type PickerField = { key: string; label: string; sample: string };
  const pickerCategories: Record<'Standard' | 'CRM' | 'Custom' | 'Values', PickerField[]> = {
    Standard: STANDARD_VARS.map((v) => ({ key: v.key, label: v.label, sample: v.sample })),
    CRM: CRM_VARS.map((v) => ({ key: v.key, label: v.label, sample: v.sample })),
    Custom: customFields.map((f) => ({ key: f.slug, label: f.name, sample: '' })),
    Values: valueTokens.map((v) => ({ key: slugify(v.name), label: v.name, sample: v.replace_with })),
  };
  const allPickerFields = [...pickerCategories.Standard, ...pickerCategories.CRM, ...pickerCategories.Custom, ...pickerCategories.Values];

  const pq = pickerSearch.trim().toLowerCase();
  const pickerResults = pq
    ? (['Standard', 'CRM', 'Custom', 'Values'] as const)
        .map((cat) => ({ label: cat, items: pickerCategories[cat].filter((f) => f.label.toLowerCase().includes(pq) || f.key.toLowerCase().includes(pq)) }))
        .filter((g) => g.items.length > 0)
    : [{ label: pickerTab, items: pickerCategories[pickerTab] }];

  // Insert a variable via picker: adds {{N}} at cursor and auto-fills sample + mapping
  const insertPickerVar = (field: PickerField) => {
    const el = bodyRef.current;
    // Find next available {{N}} number
    const usedNums = Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
    let nextNum = 1;
    while (usedNums.includes(nextNum)) nextNum++;
    const numStr = String(nextNum);
    const token = `{{${numStr}}}`;

    // Insert at cursor or end
    const pos = el ? el.selectionStart : body.length;
    const newBody = body.slice(0, pos) + token + body.slice(pos);
    setBody(newBody);

    // Auto-fill sample value and store mapping
    setBodyExamples((prev) => ({ ...prev, [numStr]: field.sample || field.label }));
    setVarMapping((prev) => ({ ...prev, [numStr]: field.key }));

    setPickerOpen(false);
    setPickerSearch('');
    setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(pos + token.length, pos + token.length); } }, 0);
  };

  // Load existing template in edit mode
  useEffect(() => {
    if (!isEdit) return;
    const t = state?.template as Template | undefined;
    if (t) {
      populate(t);
      setLoading(false);
      return;
    }
    const tok = getAccessToken();
    fetch(`${BASE}/api/templates`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((list: Template[]) => {
        const found = Array.isArray(list) ? list.find((x) => x.id === id) : null;
        if (found) populate(found);
        else { toast.error('Template not found'); navigate('/automation/templates?tab=waba'); }
      })
      .catch(() => toast.error('Failed to load template'))
      .finally(() => setLoading(false));
  }, [id]);

  function populate(t: Template) {
    setName(t.name);
    setCategory((t.category as WABACategory) ?? 'UTILITY');
    setLanguage(t.language ?? 'en');
    setHeader(t.header ?? '');
    setBody(t.body ?? '');
    setFooter(t.footer ?? '');
    setButtons(parseButtons(t.buttons));
    if (t.file_name) setExistingFile({ name: t.file_name });
    if (t.meta_template_id) setIsMetaSynced(true);
    // Restore saved variable samples and mappings
    const vars = typeof t.variables === 'string' ? (() => { try { return JSON.parse(t.variables); } catch { return null; } })() : t.variables;
    if (vars) {
      if (vars.body_examples) setBodyExamples(vars.body_examples);
      if (vars.var_mapping) setVarMapping(vars.var_mapping);
      if (vars.header_type) setHeaderType(vars.header_type);
    }
    // Detect header type from existing data if not explicitly stored
    if (!vars?.header_type) {
      // Check meta_components for header format (synced from Meta)
      const comps = typeof t.meta_components === 'string'
        ? (() => { try { return JSON.parse(t.meta_components); } catch { return []; } })()
        : (t.meta_components ?? []);
      const hdrComp = Array.isArray(comps) ? comps.find((c: any) => c.type === 'HEADER') : null;
      if (hdrComp) {
        const fmt = (hdrComp.format ?? '').toLowerCase();
        if (fmt === 'image') setHeaderType('image');
        else if (fmt === 'video') setHeaderType('video');
        else if (fmt === 'document') setHeaderType('document');
        else if (fmt === 'text') setHeaderType('text');
        else setHeaderType('none');
      } else if (t.file_type?.startsWith('image')) setHeaderType('image');
      else if (t.file_type?.startsWith('video')) setHeaderType('video');
      else if (t.file_name) setHeaderType('document');
      else if (t.header) setHeaderType('text');
      else setHeaderType('none');
    }
  }

  // ── Button helpers ──
  const addBtn = () => {
    if (buttons.length >= 3) { toast.error('Max 3 buttons allowed'); return; }
    setButtons([...buttons, { id: `b-${Date.now()}`, type: 'QUICK_REPLY', label: '', value: '' }]);
  };
  const upd = (bid: string, k: keyof WABAButton, v: string) =>
    setButtons(buttons.map((b) => b.id === bid ? { ...b, [k]: v } : b));
  const del = (bid: string) => setButtons(buttons.filter((b) => b.id !== bid));

  // ── Save ──
  const handleSave = async (toMeta = false) => {
    if (!name.trim()) { toast.error('Template name required'); return; }
    if (!body.trim()) { toast.error('Body text required'); return; }
    if (['image', 'video', 'document'].includes(headerType) && !file && !existingFile) {
      if (toMeta || (submitMeta && !isEdit)) { toast.error(`Upload a ${headerType} file for the header before submitting to Meta`); return; }
    }
    const activeButtons = buttons.filter((b) => b.label.trim());
    const hasQR = activeButtons.some((b) => b.type === 'QUICK_REPLY');
    const hasCTA = activeButtons.some((b) => b.type === 'URL' || b.type === 'PHONE_NUMBER');
    if (hasQR && hasCTA) { toast.error('Cannot mix Quick Reply buttons with URL/Phone buttons'); return; }
    for (const b of activeButtons) {
      if (b.type === 'URL' && !b.value.trim()) { toast.error(`Button "${b.label}" needs a URL`); return; }
      if (b.type === 'PHONE_NUMBER' && !b.value.trim()) { toast.error(`Button "${b.label}" needs a phone number`); return; }
    }

    setSaving(true);
    if (toMeta) setSavingToMeta(true);
    try {
      const shouldSubmitMeta = toMeta || (submitMeta && !isEdit);
      if (shouldSubmitMeta) {
        const metaButtons = activeButtons.map((b) => ({
          type: b.type, text: b.label,
          ...(b.type === 'URL' ? { url: b.value } : {}),
          ...(b.type === 'PHONE_NUMBER' ? { phone_number: b.value } : {}),
        }));
        const bodyExampleValues = bodyVars.map((v) => bodyExamples[v]?.trim() || `Sample ${v}`);
        const submitPayload: any = {
          name: name.trim(), category, language,
          body: body.trim(),
          header: headerType === 'text' ? (header.trim() || undefined) : undefined,
          header_type: headerType,
          footer: footer.trim() || undefined,
          buttons: metaButtons.length ? metaButtons : undefined,
          body_examples: bodyExampleValues.length ? bodyExampleValues : undefined,
          variables: { body_examples: bodyExamples, var_mapping: varMapping, header_type: headerType },
        };
        // Determine endpoint: resubmit for existing Meta templates, submit-to-meta for new
        const endpoint = isEdit && isMetaSynced
          ? `/api/templates/${id}/resubmit-to-meta`
          : '/api/templates/submit-to-meta';
        // For media headers, use FormData to include the file
        if ((headerType === 'image' || headerType === 'video' || headerType === 'document') && file) {
          const fd = new FormData();
          Object.entries(submitPayload).forEach(([k, v]) => {
            if (v !== undefined) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
          });
          fd.append('header_file', file);
          const tok = getAccessToken();
          const resp = await fetch(`${BASE}${endpoint}`, {
            method: 'POST',
            headers: tok ? { Authorization: `Bearer ${tok}` } : {},
            credentials: 'include', body: fd,
          });
          if (resp.status === 413) throw new Error('File too large — exceeds upload limit');
          const data = resp.headers.get('content-type')?.includes('json') ? await resp.json() : null;
          if (!resp.ok) throw new Error(data?.error || `Submit failed (${resp.status})`);
        } else {
          await api.post(endpoint, submitPayload);
        }
        toast.success('Template submitted to Meta for approval');
      } else {
        const fd = new FormData();
        fd.append('name', name.trim().toLowerCase().replace(/\s+/g, '_'));
        fd.append('template_type', 'waba');
        fd.append('category', category);
        fd.append('language', language);
        fd.append('body', body);
        if (header.trim()) fd.append('header', header.trim());
        if (footer.trim()) fd.append('footer', footer.trim());
        fd.append('buttons', JSON.stringify(buttons));
        fd.append('variables', JSON.stringify({ body_examples: bodyExamples, var_mapping: varMapping, header_type: headerType }));
        if (removeFile) fd.append('removeFile', 'true');
        if (file) fd.append('file', file);
        const tok = getAccessToken();
        const url = isEdit ? `/api/templates/${id}` : '/api/templates';
        const resp = await fetch(`${BASE}${url}`, {
          method: isEdit ? 'PATCH' : 'POST',
          headers: tok ? { Authorization: `Bearer ${tok}` } : {},
          credentials: 'include', body: fd,
        });
        if (resp.status === 413) throw new Error('File too large — exceeds upload limit');
        const data = resp.headers.get('content-type')?.includes('json') ? await resp.json() : null;
        if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
        toast.success(isEdit ? 'Template updated locally' : 'Template saved locally');
      }
      navigate('/automation/templates?tab=waba');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); setSavingToMeta(false); }
  };

  // ── Test Send ──
  const handleTestSend = async () => {
    if (!testPhone.trim()) { toast.error('Enter a phone number'); return; }
    if (!id) { toast.error('Save the template first before testing'); return; }
    setTestSending(true);
    try {
      await api.post(`/api/templates/${id}/test-send`, { phone: testPhone.trim() });
      toast.success('Test message sent! Check your WhatsApp.');
    } catch (e: any) { toast.error(e.message ?? 'Test send failed'); }
    finally { setTestSending(false); }
  };

  // Preview blob URL for uploaded image file (avoids creating new blob URL every render)
  const filePreviewUrl = useMemo(() => {
    if (file && headerType === 'image') return URL.createObjectURL(file);
    return null;
  }, [file, headerType]);

  // Name validation
  const metaName = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
  const nameValid = name.trim() === '' || META_NAME_RE.test(name.trim());
  const nameWarning = !nameValid ? `Will be saved as "${metaName}"` : '';

  // ── WhatsApp preview renderer ──
  function renderPreview(text: string): string {
    if (!text) return '';
    let t = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Highlight {{N}} variables
    t = t.replace(/\{\{(\d+)\}\}/g, (_, n) => {
      const sample = bodyExamples[n];
      return sample
        ? `<span style="color:#c2410c;font-weight:600">${sample.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span>`
        : `<span style="color:#c2410c;font-weight:500">{{${n}}}</span>`;
    });
    t = t.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
    t = t.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    t = t.replace(/~([^~\n]+)~/g, '<del>$1</del>');
    t = t.replace(/\n/g, '<br>');
    return t;
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden -mx-3 -my-4 md:-mx-6 md:-my-5">

      {/* ── Header ── */}
      <header className="bg-white border-b border-orange-100 px-5 py-0 flex items-center justify-between shrink-0 h-14">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={() => navigate('/automation/templates?tab=waba')}
            className="flex items-center gap-1.5 text-[13px] text-[#7a6b5c] hover:text-[var(--brand-dark)] transition-colors group shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span>Templates</span>
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-[#7a6b5c]/30 shrink-0" />
          <span className="text-[13px] font-semibold text-[#1c1410] truncate">
            {isEdit ? 'Edit Template' : 'New Template'}
          </span>
          <span className="ml-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[11px] font-medium text-blue-700 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            WABA
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline" size="sm"
            onClick={() => navigate('/automation/templates?tab=waba')}
            className="h-8 text-[13px] border-orange-200 text-[#7a6b5c] hover:bg-orange-50 hover:border-orange-300"
          >
            Cancel
          </Button>
          {isEdit && isMetaSynced ? (
            <>
              <Button
                variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving}
                className="h-8 text-[13px] border-orange-200 text-[#7a6b5c] hover:bg-orange-50 hover:border-orange-300"
              >
                {saving && !savingToMeta ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                Save Locally
              </Button>
              <Button
                size="sm" onClick={() => handleSave(true)} disabled={saving}
                className="h-8 text-[13px] bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white border-0 shadow-sm px-4"
              >
                {savingToMeta ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Submitting...</> : <><Send className="w-3.5 h-3.5 mr-1.5" />Submit to Meta</>}
              </Button>
            </>
          ) : (
            <Button
              size="sm" onClick={() => handleSave(false)} disabled={saving}
              className="h-8 text-[13px] bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white border-0 shadow-sm px-4"
            >
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving...</>
                : <><Check className="w-3.5 h-3.5 mr-1.5" />{submitMeta ? 'Submit to Meta' : 'Save Locally'}</>}
            </Button>
          )}
        </div>
      </header>

      {/* ── Body: two columns ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — Compose */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8 space-y-7">

            {/* 1 - Template Details */}
            <section>
              <SectionLabel n={1} title="Template Details" />
              <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-[#1c1410] mb-1.5 block">
                    Template Name <span className="text-red-400">*</span>
                  </label>
                  <Input
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. welcome_lead"
                    className={cn(
                      'border-orange-100 focus:border-orange-300 focus:ring-1 focus:ring-orange-200 bg-[#fffbf7] font-mono text-sm',
                      !nameValid && 'border-amber-400 focus:border-amber-400'
                    )}
                  />
                  {nameWarning ? (
                    <p className="text-[11px] text-amber-600 mt-1">{nameWarning}</p>
                  ) : (
                    <p className="text-[11px] text-[#7a6b5c] mt-1">Lowercase, underscores only. No spaces or special characters.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-[#1c1410] mb-1.5 block">Category</label>
                    <div className="relative">
                      <select
                        value={category} onChange={(e) => setCategory(e.target.value as WABACategory)}
                        className="w-full border border-orange-100 rounded-lg px-3 py-2.5 text-sm bg-[#fffbf7] focus:border-orange-300 outline-none appearance-none pr-8"
                      >
                        {WABA_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7a6b5c] pointer-events-none" />
                    </div>
                    <p className="text-[10px] text-[#7a6b5c] mt-1">
                      {category === 'UTILITY' && 'Order updates, reminders, alerts. Higher delivery priority.'}
                      {category === 'MARKETING' && 'Promotions, offers, newsletters. May be rate-limited by Meta.'}
                      {category === 'AUTHENTICATION' && 'OTP / verification codes only. Special button type.'}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[#1c1410] mb-1.5 block">Language</label>
                    <div className="relative">
                      <select
                        value={language} onChange={(e) => setLanguage(e.target.value)}
                        className="w-full border border-orange-100 rounded-lg px-3 py-2.5 text-sm bg-[#fffbf7] focus:border-orange-300 outline-none appearance-none pr-8"
                      >
                        {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7a6b5c] pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 2 - Header */}
            <section>
              <SectionLabel n={2} title="Header" subtitle="optional" />
              <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-[#1c1410] mb-1.5 block">Header Type</label>
                  <div className="relative">
                    <select
                      value={headerType}
                      onChange={(e) => {
                        const v = e.target.value as typeof headerType;
                        const prev = headerType;
                        setHeaderType(v);
                        if (v === 'none') { setHeader(''); setFile(null); setRemoveFile(true); }
                        else if (v === 'text') { setFile(null); setRemoveFile(true); }
                        else { setHeader(''); }
                        // Clear file when switching between different media types
                        if (v !== prev && ['image', 'video', 'document'].includes(prev) && ['image', 'video', 'document'].includes(v)) {
                          setFile(null);
                        }
                      }}
                      className="w-full border border-orange-100 rounded-lg px-3 py-2.5 text-sm bg-[#fffbf7] focus:border-orange-300 outline-none appearance-none pr-8"
                    >
                      <option value="none">No Header</option>
                      <option value="text">Text</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="document">Document</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7a6b5c] pointer-events-none" />
                  </div>
                </div>

                {/* Text header input */}
                {headerType === 'text' && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium text-[#1c1410]">Header Text</label>
                      <span className={cn('text-[11px]', header.length > LIMITS.header ? 'text-red-500 font-medium' : 'text-[#7a6b5c]')}>
                        {header.length}/{LIMITS.header}
                      </span>
                    </div>
                    <Input
                      value={header} onChange={(e) => setHeader(e.target.value)}
                      maxLength={LIMITS.header}
                      placeholder="Bold header text displayed above body"
                      className={cn(
                        'border-orange-100 focus:border-orange-300 focus:ring-1 focus:ring-orange-200 bg-[#fffbf7]',
                        header.length > LIMITS.header && 'border-red-400'
                      )}
                    />
                    {headerVars.length > 0 && (
                      <p className="text-[11px] text-amber-600 mt-1.5">
                        Header variables detected: {headerVars.map((v) => `{{${v}}}`).join(', ')}
                      </p>
                    )}
                  </div>
                )}

                {/* Media header upload (image / video / document) */}
                {(headerType === 'image' || headerType === 'video' || headerType === 'document') && (
                  <div>
                    <label className="text-sm font-medium text-[#1c1410] mb-1.5 block">
                      Upload {headerType === 'image' ? 'Image' : headerType === 'video' ? 'Video' : 'Document'}
                    </label>
                    {existingFile && !removeFile && !file && (
                      <div className="flex items-center gap-2 text-sm text-[#7a6b5c] bg-orange-50 rounded-lg px-3 py-2 mb-2 border border-orange-100">
                        <Paperclip className="w-4 h-4 shrink-0" />
                        <span className="flex-1 truncate">{existingFile.name}</span>
                        <button onClick={() => setRemoveFile(true)} className="text-xs text-red-500 hover:underline shrink-0">Remove</button>
                      </div>
                    )}
                    {file && (
                      <div className="flex items-center gap-2 text-sm text-[#7a6b5c] bg-orange-50 rounded-lg px-3 py-2 mb-2 border border-orange-200">
                        <Paperclip className="w-4 h-4 shrink-0" />
                        <span className="flex-1 truncate">{file.name}</span>
                        <button onClick={() => setFile(null)} className="text-xs text-red-500 hover:underline shrink-0">Clear</button>
                      </div>
                    )}
                    <label className="flex items-center gap-1.5 text-sm px-3 py-2 border border-orange-100 rounded-lg hover:bg-orange-50 transition-colors cursor-pointer w-fit">
                      <Upload className="w-4 h-4 text-[#7a6b5c]" />
                      <span className="text-[#7a6b5c]">{file ? 'Replace' : `Upload ${headerType}`}</span>
                      <input
                        type="file" className="hidden"
                        accept={headerType === 'image' ? 'image/jpeg,image/png' : headerType === 'video' ? 'video/mp4' : '.pdf,.doc,.docx'}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            const maxMB = headerType === 'image' ? 5 : headerType === 'video' ? 16 : 100;
                            if (f.size > maxMB * 1024 * 1024) { toast.error(`File too large — max ${maxMB} MB for ${headerType}`); e.target.value = ''; return; }
                            setFile(f); setRemoveFile(false);
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <p className="text-[10px] text-[#7a6b5c] mt-1.5">
                      {headerType === 'image' && 'Supported: JPEG, PNG. Max 5 MB.'}
                      {headerType === 'video' && 'Supported: MP4. Max 16 MB.'}
                      {headerType === 'document' && 'Supported: PDF, DOC, DOCX. Max 100 MB.'}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* 3 - Body */}
            <section>
              <SectionLabel n={3} title="Body" />
              <div className="bg-white rounded-2xl border border-orange-100 overflow-hidden">
                {/* Formatting toolbar */}
                <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-orange-50 bg-[#fffbf7]">
                  <span className="text-[11px] font-medium text-[#7a6b5c] mr-1">Format:</span>
                  <FormatBtn label="B" title="Bold *text*" className="font-bold" />
                  <FormatBtn label="I" title="Italic _text_" className="italic" />
                  <FormatBtn label="S" title="Strikethrough ~text~" className="line-through" />
                  <div className="h-4 w-px bg-orange-200 mx-1" />
                  <span className="ml-auto text-[11px] text-[#7a6b5c]">{body.length} / 1024</span>
                </div>

                <div className="px-4 pt-4 pb-2">
                  <textarea
                    ref={bodyRef}
                    value={body} onChange={(e) => setBody(e.target.value)}
                    maxLength={1024} rows={7}
                    placeholder="Hi {{1}}, thanks for reaching out! Your appointment is on {{2}}."
                    className="w-full text-[13px] text-[#1c1410] placeholder:text-[#7a6b5c]/40 bg-transparent outline-none resize-none leading-relaxed"
                  />
                </div>

                <div className="px-4 pb-4 pt-2 border-t border-orange-50 flex items-center justify-between">
                  <button
                    onClick={() => { setPickerOpen(true); setPickerSearch(''); setPickerTab('Standard'); }}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-orange-700 hover:text-orange-900 transition-colors"
                  >
                    <span className="w-5 h-5 rounded-md bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-[13px] leading-none">+</span>
                    Insert Variable
                    <span className="text-[10px] text-[#7a6b5c] font-normal ml-0.5">({allPickerFields.length} fields)</span>
                  </button>
                  <p className="text-[11px] text-[#7a6b5c]">
                    or type {'{{1}}'}, {'{{2}}'} manually
                  </p>
                </div>
              </div>

              {/* Body variable samples */}
              {bodyVars.length > 0 && (
                <div className="mt-3 p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
                  <p className="text-xs font-semibold text-amber-800">Samples for body content</p>
                  {bodyVars.map((v) => (
                    <div key={v} className="space-y-1.5" >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-amber-700 bg-amber-100 px-2 py-1 rounded-lg shrink-0">{`{{${v}}}`}</span>
                        <div className="relative flex-1">
                          <select
                            value={varMapping[v] ?? ''}
                            onChange={(e) => {
                              const key = e.target.value;
                              setVarMapping((prev) => ({ ...prev, [v]: key }));
                              // Auto-fill sample from the selected field
                              const field = allPickerFields.find((f) => f.key === key);
                              if (field?.sample) setBodyExamples((prev) => ({ ...prev, [v]: field.sample }));
                            }}
                            className="w-full border border-amber-200 rounded-lg px-3 py-2 text-xs bg-white focus:border-amber-400 outline-none appearance-none pr-8"
                          >
                            <option value="">Select CRM field...</option>
                            <optgroup label="Standard">
                              {STANDARD_VARS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </optgroup>
                            <optgroup label="CRM">
                              {CRM_VARS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </optgroup>
                            {customFields.length > 0 && (
                              <optgroup label="Custom Fields">
                                {customFields.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-amber-500 pointer-events-none" />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pl-14">
                        <Input
                          value={bodyExamples[v] ?? ''}
                          onChange={(e) => setBodyExamples((prev) => ({ ...prev, [v]: e.target.value }))}
                          placeholder={`Sample value for {{${v}}}`}
                          className="flex-1 text-xs h-8 border-amber-200 bg-white focus:border-amber-400 focus:ring-1 focus:ring-amber-200"
                        />
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-amber-600">
                    Select a CRM field for each variable. The sample value is sent to Meta for review.
                  </p>
                </div>
              )}
            </section>

            {/* 4 - Footer */}
            <section>
              <SectionLabel n={4} title="Footer" subtitle="optional" />
              <div className="bg-white rounded-2xl border border-orange-100 p-5">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-[#1c1410]">Footer Text</label>
                  <span className={cn('text-[11px]', footer.length > LIMITS.footer ? 'text-red-500 font-medium' : 'text-[#7a6b5c]')}>
                    {footer.length}/{LIMITS.footer}
                  </span>
                </div>
                <Input
                  value={footer} onChange={(e) => setFooter(e.target.value)}
                  maxLength={LIMITS.footer}
                  placeholder="e.g. Reply STOP to unsubscribe"
                  className={cn(
                    'border-orange-100 focus:border-orange-300 focus:ring-1 focus:ring-orange-200 bg-[#fffbf7]',
                    footer.length > LIMITS.footer && 'border-red-400'
                  )}
                />
              </div>
            </section>

            {/* 5 - Buttons */}
            <section>
              <SectionLabel n={5} title="Buttons" subtitle="optional, max 3" />
              <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-3">
                {buttons.map((btn) => (
                  <div key={btn.id} className="flex gap-2 items-center p-3 rounded-xl border border-orange-100 bg-[#fffbf7]">
                    <div className="relative shrink-0">
                      <select
                        className="border border-orange-100 rounded-lg px-2 py-2 text-xs bg-white outline-none appearance-none pr-7"
                        value={btn.type} onChange={(e) => upd(btn.id, 'type', e.target.value)}
                      >
                        <option value="QUICK_REPLY">Quick Reply</option>
                        <option value="URL">URL</option>
                        <option value="PHONE_NUMBER">Phone</option>
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#7a6b5c] pointer-events-none" />
                    </div>
                    <div className="flex-1 relative">
                      <Input
                        value={btn.label} onChange={(e) => upd(btn.id, 'label', e.target.value)}
                        maxLength={LIMITS.buttonLabel}
                        placeholder="Button label"
                        className={cn('text-xs h-9 border-orange-100 bg-white pr-10', btn.label.length >= LIMITS.buttonLabel && 'border-red-300')}
                      />
                      <span className={cn('absolute right-2 top-1/2 -translate-y-1/2 text-[9px]', btn.label.length >= LIMITS.buttonLabel ? 'text-red-400' : 'text-[#7a6b5c]/50')}>
                        {btn.label.length}/{LIMITS.buttonLabel}
                      </span>
                    </div>
                    {btn.type !== 'QUICK_REPLY' && (
                      <Input
                        value={btn.value} onChange={(e) => upd(btn.id, 'value', e.target.value)}
                        placeholder={btn.type === 'URL' ? 'https://...' : '+919876543210'}
                        className="flex-1 text-xs h-9 border-orange-100 bg-white font-mono"
                      />
                    )}
                    {btn.type === 'QUICK_REPLY' && (
                      <Input
                        value={btn.value} onChange={(e) => upd(btn.id, 'value', e.target.value)}
                        placeholder="payload (optional)"
                        className="flex-1 text-xs h-9 border-orange-100 bg-white font-mono"
                      />
                    )}
                    <button onClick={() => del(btn.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-[#7a6b5c] hover:text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addBtn}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-orange-700 hover:text-orange-900 transition-colors"
                >
                  <span className="w-5 h-5 rounded-md bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-[13px] leading-none">+</span>
                  Add Button
                </button>
                {buttons.length === 0 && (
                  <p className="text-[11px] text-[#7a6b5c] py-2 text-center border border-dashed border-orange-200 rounded-lg">
                    No buttons added. Quick Reply buttons let users respond with one tap.
                  </p>
                )}
              </div>
            </section>

            {/* Submit to Meta checkbox */}
            {!isEdit && (
              <div className="bg-white rounded-2xl border border-orange-100 p-5">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox" checked={submitMeta} onChange={(e) => setSubmitMeta(e.target.checked)}
                    className="rounded border-orange-300 text-orange-600 focus:ring-orange-200 w-4 h-4"
                  />
                  <div>
                    <p className="text-sm font-medium text-[#1c1410]">Submit to Meta for approval</p>
                    <p className="text-[11px] text-[#7a6b5c] mt-0.5">Template will be sent to Meta for review. This usually takes a few minutes.</p>
                  </div>
                </label>
              </div>
            )}

            {/* 6 - Test Send (only for saved templates with meta_template_id) */}
            {isEdit && (
              <section>
                <SectionLabel n={6} title="Test Send" subtitle="send to your phone" />
                <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-3">
                  {!showTestPanel ? (
                    <button
                      onClick={() => setShowTestPanel(true)}
                      className="flex items-center gap-2 text-sm text-orange-700 hover:text-orange-900 font-medium transition-colors"
                    >
                      <span className="w-6 h-6 rounded-lg bg-green-100 flex items-center justify-center text-green-600 text-xs">&#9654;</span>
                      Send a test message to verify this template
                    </button>
                  ) : (
                    <>
                      <p className="text-[11px] text-[#7a6b5c]">
                        Send this template to your phone with sample values. Template must be approved by Meta first.
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          value={testPhone}
                          onChange={(e) => setTestPhone(e.target.value)}
                          placeholder="Phone with country code, e.g. 919876543210"
                          className="flex-1 text-sm h-10 border-orange-100 bg-[#fffbf7] font-mono"
                        />
                        <Button
                          size="sm" onClick={handleTestSend} disabled={testSending}
                          className="h-10 px-5 bg-green-600 hover:bg-green-700 text-white border-0"
                        >
                          {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Test'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            <div className="h-8" />
          </div>
        </div>

        {/* RIGHT — Live Preview */}
        <div className="w-[380px] shrink-0 border-l border-orange-100 bg-[#fff7f0] overflow-y-auto hidden lg:block">
          <div className="p-6 space-y-5">
            <h2 className="text-[11px] font-bold text-[#92400e] uppercase tracking-widest">Live Preview</h2>

            {/* WhatsApp mockup */}
            <div className="rounded-2xl overflow-hidden shadow-md border border-black/[0.08]">
              {/* WA Header bar */}
              <div className="bg-[#075e54] px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#128c7e] border-2 border-white/20 flex items-center justify-center shrink-0">
                  <span className="text-white text-xs font-bold">WA</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-[13px] font-semibold leading-tight">DigyGo CRM</p>
                  <p className="text-green-300 text-[10px]">online</p>
                </div>
              </div>

              {/* Chat area */}
              <div className="min-h-[260px] p-3 flex flex-col gap-2" style={{ backgroundColor: '#efeae2' }}>
                {!body.trim() && !header.trim() && headerType === 'none' ? (
                  <div className="flex-1 flex items-center justify-center py-10">
                    <p className="text-[12px] text-[#9e9e9e] text-center leading-relaxed">
                      Start typing your message<br />to see the preview here
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-start">
                    <div className="max-w-[90%] bg-white rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
                      {/* Header */}
                      {headerType === 'text' && header.trim() && (
                        <div className="px-3 pt-2.5 pb-0.5">
                          <p className="text-[13px] font-bold text-gray-900">{header}</p>
                        </div>
                      )}
                      {headerType === 'image' && (
                        <div className="bg-gray-100 flex items-center justify-center h-[140px]">
                          {file ? (
                            <img src={filePreviewUrl!} alt="Header" className="w-full h-full object-cover" />
                          ) : (
                            <div className="text-center">
                              <ImageIcon className="w-8 h-8 text-gray-300 mx-auto mb-1" />
                              <p className="text-[10px] text-gray-400">Image header</p>
                            </div>
                          )}
                        </div>
                      )}
                      {headerType === 'video' && (
                        <div className="bg-gray-800 flex items-center justify-center h-[140px]">
                          <div className="text-center">
                            <Film className="w-8 h-8 text-gray-400 mx-auto mb-1" />
                            <p className="text-[10px] text-gray-400">{file ? file.name : 'Video header'}</p>
                          </div>
                        </div>
                      )}
                      {headerType === 'document' && (
                        <div className="bg-gray-50 flex items-center gap-2 px-3 py-3 border-b border-gray-100">
                          <FileText className="w-6 h-6 text-red-400 shrink-0" />
                          <span className="text-[11px] text-gray-600 truncate">{file ? file.name : 'Document'}</span>
                        </div>
                      )}
                      {/* Body */}
                      <div className="px-3 py-2">
                        <p
                          className="text-[12px] text-gray-800 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: renderPreview(body) || '&nbsp;' }}
                        />
                      </div>
                      {/* Footer */}
                      {footer.trim() && (
                        <div className="px-3 pb-1">
                          <p className="text-[10px] text-gray-500">{footer}</p>
                        </div>
                      )}
                      {/* Timestamp */}
                      <div className="flex items-center justify-end gap-1 px-3 pb-2">
                        <span className="text-[10px] text-gray-400">10:30 AM</span>
                        <span className="text-[10px] text-blue-400">&#10003;&#10003;</span>
                      </div>
                      {/* Buttons */}
                      {buttons.filter((b) => b.label.trim()).length > 0 && (
                        <div className="border-t border-gray-100">
                          {buttons.filter((b) => b.label.trim()).map((btn) => (
                            <div key={btn.id} className="text-center py-2 border-b border-gray-50 last:border-0">
                              <span className="text-[12px] font-medium text-[#00a5f4]">{btn.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* WA input bar */}
              <div className="bg-[#f0f0f0] px-3 py-2 flex items-center gap-2">
                <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-[11px] text-gray-400">
                  Type a message
                </div>
                <div className="w-7 h-7 rounded-full bg-[#25d366] flex items-center justify-center shrink-0">
                  <span className="text-white text-[10px] ml-0.5">&#9654;</span>
                </div>
              </div>
            </div>

            {/* Variable legend */}
            {bodyVars.length > 0 && (
              <div className="bg-white rounded-2xl border border-orange-100 p-4">
                <h3 className="text-[10px] font-bold text-[#92400e] uppercase tracking-widest mb-3">Variable Mapping</h3>
                <div className="space-y-2">
                  {bodyVars.map((v) => {
                    const mappedKey = varMapping[v];
                    const mappedField = mappedKey ? allPickerFields.find((f) => f.key === mappedKey) : null;
                    return (
                      <div key={v} className="flex items-center justify-between text-[11px] gap-2">
                        <span className="font-mono text-orange-600 shrink-0">{`{{${v}}}`}</span>
                        <div className="text-right min-w-0">
                          {mappedField && (
                            <p className="text-[10px] text-orange-500 font-medium">{mappedField.label}</p>
                          )}
                          <p className="text-[#7a6b5c] truncate">{bodyExamples[v] || `[Sample ${v}]`}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Meta template tips */}
            <div className="bg-orange-50 rounded-2xl border border-orange-100 p-4">
              <h3 className="text-[10px] font-bold text-[#92400e] uppercase tracking-widest mb-3">Meta Template Tips</h3>
              <div className="space-y-2 text-[11px] text-[#7a6b5c] leading-relaxed">
                <p>Use <code className="bg-orange-100 text-orange-800 px-1 rounded">{'{{1}}'}</code>, <code className="bg-orange-100 text-orange-800 px-1 rounded">{'{{2}}'}</code> for dynamic content.</p>
                <p>Meta reviews templates before approval. Avoid promotional language in UTILITY templates.</p>
                <p>Quick Reply buttons let users tap to respond. URL buttons open links.</p>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Variable Picker Modal ── */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setPickerOpen(false); setPickerSearch(''); } }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-w-full max-h-[80vh] flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-orange-100 shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-[#1c1410]">Insert Variable</h3>
                <p className="text-[11px] text-[#7a6b5c] mt-0.5">
                  Click a field to insert <code className="bg-orange-50 px-1 rounded text-orange-700">{`{{N}}`}</code> at cursor with auto-filled sample
                </p>
              </div>
              <button
                onClick={() => { setPickerOpen(false); setPickerSearch(''); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-orange-50 text-[#7a6b5c] hover:text-[#1c1410] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-orange-50 shrink-0">
              <div className="flex items-center gap-2 bg-[#fffbf7] border border-orange-200 rounded-xl px-3 py-2">
                <Search className="w-3.5 h-3.5 text-[#7a6b5c] shrink-0" />
                <input
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder={`Search across ${allPickerFields.length} fields...`}
                  className="flex-1 text-[12px] bg-transparent outline-none text-[#1c1410] placeholder:text-[#7a6b5c]/50"
                />
                {pickerSearch && (
                  <button onClick={() => setPickerSearch('')} className="text-[#7a6b5c] hover:text-[#1c1410]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            {!pickerSearch && (
              <div className="flex border-b border-orange-100 px-4 shrink-0 bg-white">
                {(['Standard', 'CRM', 'Custom', 'Values'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setPickerTab(tab)}
                    className={cn(
                      'px-3 py-2.5 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap',
                      pickerTab === tab
                        ? 'border-[var(--brand)] text-[var(--brand)]'
                        : 'border-transparent text-[#7a6b5c] hover:text-[#1c1410]'
                    )}
                  >
                    {tab}
                    <span className="ml-1.5 text-[10px] font-normal opacity-60">
                      ({pickerCategories[tab].length})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Field list */}
            <div className="flex-1 overflow-y-auto">
              {pickerResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center mb-3">
                    <Search className="w-4 h-4 text-orange-300" />
                  </div>
                  <p className="text-[13px] font-medium text-[#1c1410]">No fields found</p>
                  <p className="text-[11px] text-[#7a6b5c] mt-1">Try a different search term</p>
                </div>
              ) : (
                pickerResults.map((group) => (
                  <div key={group.label}>
                    {pickerSearch && (
                      <div className="px-4 py-2 bg-orange-50/60 border-b border-orange-50 sticky top-0">
                        <span className="text-[10px] font-bold text-[#92400e] uppercase tracking-widest">{group.label}</span>
                      </div>
                    )}
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => insertPickerVar(item)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-50 transition-colors border-b border-orange-50/80 last:border-0 text-left gap-4 group"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[#1c1410] truncate">{item.label}</p>
                          {item.sample && (
                            <p className="text-[11px] text-[#7a6b5c] mt-0.5 truncate">e.g. {item.sample}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-[11px] font-mono text-orange-700 bg-orange-50 border border-orange-200 px-2 py-1 rounded-lg group-hover:bg-orange-100 group-hover:border-orange-300 transition-colors">
                          {`{{N}}`} = {item.key}
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────

function SectionLabel({ n, title, subtitle }: { n: number; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold text-orange-700">{n}</span>
      </div>
      <h2 className="text-[11px] font-bold text-[#92400e] uppercase tracking-widest">
        {title}
        {subtitle && <span className="text-[#7a6b5c] normal-case font-normal ml-1">· {subtitle}</span>}
      </h2>
    </div>
  );
}

function FormatBtn({ label, title, className }: { label: string; title: string; className?: string }) {
  return (
    <button
      title={title}
      className="w-7 h-7 rounded-md hover:bg-orange-100 text-[#1c1410] transition-colors flex items-center justify-center"
    >
      <span className={cn('text-[13px]', className)}>{label}</span>
    </button>
  );
}
