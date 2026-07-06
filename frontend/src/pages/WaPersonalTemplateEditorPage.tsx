import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ChevronDown, Search, Upload, X, FileText, Film, Loader2, Check } from 'lucide-react';
import { Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getAccessToken, BASE } from '@/lib/api';
import { cn } from '@/lib/utils';

interface WaPersonalTemplate {
  id: string;
  name: string;
  message: string;
  file_path?: string | null;
  file_type?: string | null;
  file_name?: string | null;
  created_at: string;
}

// Matches the slugify() in FieldsPage - same formula the backend uses to resolve value_tokens
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

// Static standard variables always available
const STANDARD_VARS = [
  { key: 'first_name',     label: 'First Name' },
  { key: 'last_name',      label: 'Last Name' },
  { key: 'full_name',      label: 'Full Name' },
  { key: 'phone',          label: 'Phone' },
  { key: 'email',          label: 'Email' },
  { key: 'stage',          label: 'Stage' },
  { key: 'pipeline',       label: 'Pipeline' },
  { key: 'assigned_staff', label: 'Assigned Staff' },
  { key: 'source',         label: 'Source' },
  { key: 'today',          label: 'Today\'s Date' },
];

const CALENDAR_VARS = [
  { key: 'appointment_date',       label: 'Appointment Date' },
  { key: 'appointment_start_time', label: 'Start Time' },
  { key: 'appointment_end_time',   label: 'End Time' },
  { key: 'appointment_timezone',   label: 'Timezone' },
  { key: 'calendar_name',          label: 'Calendar Name' },
  { key: 'meeting_link',           label: 'Meeting Link' },
];

const BASE_SAMPLE: Record<string, string> = {
  first_name:             'Ravi',
  last_name:              'Kumar',
  full_name:              'Ravi Kumar',
  phone:                  '+91 98765 43210',
  email:                  'ravi@example.com',
  stage:                  'Qualified',
  pipeline:               'Sales',
  assigned_staff:         'Roshan',
  source:                 'Meta Form',
  today:                  new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
  appointment_date:       '13 May 2026',
  appointment_start_time: '10:30 AM',
  appointment_end_time:   '11:00 AM',
  appointment_timezone:   'Asia/Kolkata',
  calendar_name:          'Discovery Call',
  meeting_link:           'https://meet.google.com/abc-xyz',
};

function renderHtml(text: string, sample: Record<string, string>): string {
  if (!text) return '';
  let t = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Substitute {%key%} value tokens (Values tab)
  t = t.replace(/\{%(\w+)%\}/g, (match, key) =>
    key in sample
      ? `<span style="color:var(--brand-dark);font-weight:500">${sample[key]}</span>`
      : `<span style="color:var(--brand-light)">${match}</span>`
  );
  // Substitute {key} lead variables
  t = t.replace(/\{(\w+)\}/g, (match, key) =>
    key in sample
      ? `<span style="color:var(--brand-dark);font-weight:500">${sample[key]}</span>`
      : `<span style="color:var(--brand-light)">${match}</span>`
  );
  t = t.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  t = t.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  t = t.replace(/~([^~\n]+)~/g, '<del>$1</del>');
  t = t.replace(/\n/g, '<br>');
  return t;
}

export default function WaPersonalTemplateEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [existingFile, setExistingFile] = useState<{ path: string; name: string; type: string } | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<Array<{ slug: string; name: string }>>([]);
  const [valueTokens, setValueTokens] = useState<Array<{ name: string; replace_with: string }>>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'Standard' | 'CRM' | 'Custom' | 'Values'>('Standard');
  const [linkPreview, setLinkPreview] = useState<{ title: string | null; description: string | null; image: string | null; siteName: string | null; url: string } | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const linkPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-fetch custom fields and value tokens every time the modal opens so new fields appear immediately
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

  useEffect(() => {
    if (!isEdit) return;
    const t = state?.template as WaPersonalTemplate | undefined;
    if (t) {
      setName(t.name);
      setMessage(t.message);
      if (t.file_path && t.file_name && t.file_type) {
        setExistingFile({ path: t.file_path, name: t.file_name, type: t.file_type });
      }
      setLoading(false);
      return;
    }
    const tok = getAccessToken();
    fetch(`${BASE}/api/wa-personal-templates`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((list: WaPersonalTemplate[]) => {
        const found = Array.isArray(list) ? list.find((x) => x.id === id) : null;
        if (found) {
          setName(found.name);
          setMessage(found.message);
          if (found.file_path && found.file_name && found.file_type) {
            setExistingFile({ path: found.file_path, name: found.file_name, type: found.file_type });
          }
        } else {
          toast.error('Template not found');
          navigate('/automation/templates?tab=wa_personal');
        }
      })
      .catch(() => toast.error('Failed to load template'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [file]);

  // Detect first URL in message, debounce 800ms, fetch link preview from backend proxy
  useEffect(() => {
    if (linkPreviewTimer.current) clearTimeout(linkPreviewTimer.current);
    const match = message.match(/https?:\/\/[^\s]+/);
    if (!match) { setLinkPreview(null); return; }
    const url = match[0];
    linkPreviewTimer.current = setTimeout(async () => {
      setLinkPreviewLoading(true);
      try {
        const tok = getAccessToken();
        const r = await fetch(`${BASE}/api/fields/link-preview?url=${encodeURIComponent(url)}`, {
          headers: tok ? { Authorization: `Bearer ${tok}` } : {},
          credentials: 'include',
        });
        if (r.ok) setLinkPreview(await r.json());
        else setLinkPreview(null);
      } catch { setLinkPreview(null); }
      finally { setLinkPreviewLoading(false); }
    }, 800);
    return () => { if (linkPreviewTimer.current) clearTimeout(linkPreviewTimer.current); };
  }, [message]);

  const wrapSelection = (wrap: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = message.slice(start, end);
    const newMsg = message.slice(0, start) + wrap + selected + wrap + message.slice(end);
    setMessage(newMsg);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + wrap.length, end + wrap.length);
    }, 0);
  };

  const insertVariable = (slug: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    const val = `{%${slug}%}`;
    const newMsg = message.slice(0, pos) + val + message.slice(pos);
    setMessage(newMsg);
    setPickerOpen(false);
    setSearch('');
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(pos + val.length, pos + val.length);
    }, 0);
  };

  const handleFile = (f: File) => {
    const type = f.type;
    const maxMB = type.startsWith('image/') ? 5
      : type.startsWith('video/') ? 16
      : type.startsWith('audio/') ? 16
      : 100;
    if (f.size > maxMB * 1024 * 1024) {
      toast.error(`File too large - max ${maxMB} MB for ${type.startsWith('image/') ? 'images' : type.startsWith('video/') ? 'videos' : type.startsWith('audio/') ? 'audio' : 'documents'}`);
      return;
    }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const allowedExt = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp4'];
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/') && !f.type.startsWith('application/') && !allowedExt.includes(ext)) {
      toast.error('Unsupported file type');
      return;
    }
    setFile(f);
    setRemoveFile(false);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Template name is required'); return; }
    if (!message.trim()) { toast.error('Message is required'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('message', message.trim());
      if (removeFile) fd.append('removeFile', 'true');
      if (file) fd.append('file', file);
      const tok = getAccessToken();
      const url = isEdit ? `/api/wa-personal-templates/${id}` : '/api/wa-personal-templates';
      const method = isEdit ? 'PATCH' : 'POST';
      const resp = await fetch(`${BASE}${url}`, {
        method,
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        credentials: 'include',
        body: fd,
      });
      if (resp.status === 413) throw new Error('File too large - exceeds WhatsApp size limit');
      const isJson = resp.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await resp.json() : null;
      if (!resp.ok) throw new Error(data?.error || `Save failed (${resp.status} ${resp.statusText})`);
      toast.success(isEdit ? 'Template updated' : 'Template created');
      navigate('/automation/templates?tab=wa_personal');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Build the live sample map: base + custom field placeholders + value tokens
  const sample = {
    ...BASE_SAMPLE,
    ...Object.fromEntries(customFields.map((f) => [f.slug, `[${f.name}]`])),
    ...Object.fromEntries(valueTokens.map((v) => [slugify(v.name), v.replace_with])),
  };

  // Field categories for the modal
  type PickerField = { name: string; slug: string; preview: string };
  const modalCategories: Record<'Standard' | 'CRM' | 'Custom' | 'Values', PickerField[]> = {
    Standard: STANDARD_VARS.filter((v) => !['stage', 'pipeline', 'assigned_staff'].includes(v.key))
      .map((v) => ({ name: v.label, slug: v.key, preview: BASE_SAMPLE[v.key] ?? '' })),
    CRM: [
      ...STANDARD_VARS.filter((v) => ['stage', 'pipeline', 'assigned_staff'].includes(v.key))
        .map((v) => ({ name: v.label, slug: v.key, preview: BASE_SAMPLE[v.key] ?? '' })),
      ...CALENDAR_VARS.map((v) => ({ name: v.label, slug: v.key, preview: BASE_SAMPLE[v.key] ?? '' })),
    ],
    Custom: customFields.map((f) => ({ name: f.name, slug: f.slug, preview: '' })),
    Values: valueTokens.map((v) => ({ name: v.name, slug: slugify(v.name), preview: v.replace_with })),
  };

  // For the legend on the right panel - flat list of all fields
  const allPickerFields = [
    ...modalCategories.Standard,
    ...modalCategories.CRM,
    ...modalCategories.Custom,
    ...modalCategories.Values,
  ];

  const q = search.trim().toLowerCase();
  // When searching: show all matching across all categories with section headers
  // When not searching: show only the active tab
  const searchResults = q
    ? (['Standard', 'CRM', 'Custom', 'Values'] as const)
        .map((cat) => ({
          label: cat,
          items: modalCategories[cat].filter(
            (f) => f.name.toLowerCase().includes(q) || f.slug.toLowerCase().includes(q)
          ),
        }))
        .filter((g) => g.items.length > 0)
    : [{ label: activeTab, items: modalCategories[activeTab] }];

  const attachType: 'image' | 'video' | 'doc' | null = (() => {
    const t = file?.type ?? existingFile?.type ?? '';
    const n = file?.name ?? existingFile?.name ?? '';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/') || n.toLowerCase().endsWith('.mp4')) return 'video';
    if (t || n) return 'doc';
    return null;
  })();

  const attachName = file?.name ?? existingFile?.name ?? '';
  const attachImgSrc = previewUrl ?? (existingFile?.type?.startsWith('image/') ? `${BASE}${existingFile.path}` : null);
  const showAttach = attachType !== null && !(removeFile && !file);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    // Negative margins cancel AppLayout's padding so the editor fills edge-to-edge
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden -mx-3 -my-4 md:-mx-6 md:-my-5">

      {/* ── Header ── */}
      <header className="bg-white border-b border-orange-100 px-5 py-0 flex items-center justify-between shrink-0 h-14">

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={() => navigate('/automation/templates?tab=wa_personal')}
            className="flex items-center gap-1.5 text-[14px] text-[#7a6b5c] hover:text-[var(--brand-dark)] transition-colors group shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span>Templates</span>
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-[#7a6b5c]/30 shrink-0" />
          <span className="text-[14px] font-semibold text-[#1c1410] truncate">
            {isEdit ? 'Edit Template' : 'New Template'}
          </span>
          <span className="ml-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-[11px] font-medium text-green-700 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            WA Personal
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/automation/templates?tab=wa_personal')}
            className="h-8 text-[14px] border-orange-200 text-[#7a6b5c] hover:bg-orange-50 hover:border-orange-300"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="h-8 text-[14px] bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white border-0 shadow-sm px-4"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
              : <><Check className="w-3.5 h-3.5 mr-1.5" />{isEdit ? 'Save Changes' : 'Create Template'}</>}
          </Button>
        </div>
      </header>

      {/* ── Body: two columns ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT - Compose */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8 space-y-7">

            {/* 1 · Template Details */}
            <section>
              <SectionLabel n={1} title="Template Details" />
              <div className="bg-white rounded-2xl border border-orange-100 p-5">
                <label className="text-sm font-medium text-[#1c1410] mb-1.5 block">
                  Template Name <span className="text-red-400">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Welcome Message, Follow Up Reminder, Brochure Send"
                  className="border-orange-100 focus:border-orange-300 focus:ring-1 focus:ring-orange-200 bg-[#fffbf7]"
                />
                <p className="text-[11px] text-[#7a6b5c] mt-1.5">
                  Only visible to your team - not sent to the lead.
                </p>
              </div>
            </section>

            {/* 2 · Message */}
            <section>
              <SectionLabel n={2} title="Message" />
              <div className="bg-white rounded-2xl border border-orange-100 overflow-hidden">

                {/* Formatting toolbar */}
                <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-orange-50 bg-[#fffbf7]">
                  <span className="text-[11px] font-medium text-[#7a6b5c] mr-1">Format:</span>
                  <FormatBtn onClick={() => wrapSelection('*')} title="Bold  *text*">
                    <span className="font-bold text-[14px]">B</span>
                  </FormatBtn>
                  <FormatBtn onClick={() => wrapSelection('_')} title="Italic  _text_">
                    <span className="italic text-[14px]">I</span>
                  </FormatBtn>
                  <FormatBtn onClick={() => wrapSelection('~')} title="Strikethrough  ~text~">
                    <span className="line-through text-[14px]">S</span>
                  </FormatBtn>
                  <div className="h-4 w-px bg-orange-200 mx-1" />
                  <span className="text-[11px] text-[#7a6b5c] hidden sm:block">Select text then click to format</span>
                  <span className="ml-auto text-[11px] text-[#7a6b5c]">{message.length} / 4096</span>
                </div>

                {/* Textarea */}
                <div className="px-4 pt-4 pb-2">
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={4096}
                    rows={9}
                    placeholder={"Hi {%first_name%}! 👋\n\nThank you for reaching out to us.\n\nHere's what we'd love to share with you..."}
                    className="w-full text-[14px] text-[#1c1410] placeholder:text-[#7a6b5c]/40 bg-transparent outline-none resize-none leading-relaxed"
                  />
                </div>

                {/* Insert Variable trigger */}
                <div className="px-4 pb-4 pt-2 border-t border-orange-50">
                  <button
                    onClick={() => { setPickerOpen(true); setSearch(''); setActiveTab('Standard'); }}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-orange-700 hover:text-orange-900 transition-colors"
                  >
                    <span className="w-5 h-5 rounded-md bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-[14px] leading-none">+</span>
                    Insert Variable
                    <span className="text-[10px] text-[#7a6b5c] font-normal ml-0.5">({allPickerFields.length} fields)</span>
                  </button>
                </div>
              </div>
            </section>

            {/* 3 · Attachment */}
            <section>
              <SectionLabel n={3} title="Attachment" subtitle="optional" />
              <div className="bg-white rounded-2xl border border-orange-100 p-5 space-y-4">

                {/* Existing file (edit mode) */}
                {existingFile && !removeFile && !file && (
                  <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                    <FileTypeIcon type={existingFile.type} name={existingFile.name} className="w-5 h-5 text-orange-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1c1410] truncate">{existingFile.name}</p>
                      <p className="text-[11px] text-[#7a6b5c]">Current attachment</p>
                    </div>
                    <button
                      onClick={() => setRemoveFile(true)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-[#7a6b5c] hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Newly selected file */}
                {file && (
                  <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl border border-orange-200">
                    <FileTypeIcon type={file.type} name={file.name} className="w-5 h-5 text-orange-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1c1410] truncate">{file.name}</p>
                      <p className="text-[11px] text-[#7a6b5c]">{(file.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button
                      onClick={() => setFile(null)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-[#7a6b5c] hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all select-none',
                    dragOver
                      ? 'border-orange-400 bg-orange-50'
                      : 'border-orange-200 bg-[#fffbf7] hover:border-orange-300 hover:bg-orange-50/60',
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-5 h-5 text-orange-500" />
                  </div>
                  <p className="text-sm font-medium text-[#1c1410]">
                    Drop file here or <span className="text-orange-600 underline underline-offset-2">browse</span>
                  </p>
                  <p className="text-[11px] text-[#7a6b5c] mt-1">
                    Images (5 MB) · Video (16 MB) · Audio (16 MB) · Documents (100 MB)
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,video/mp4,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                />
              </div>
            </section>

            <div className="h-8" />
          </div>
        </div>

        {/* RIGHT - Live Preview (independent scroll) */}
        <div className="w-[380px] shrink-0 border-l border-orange-100 bg-[#fff7f0] overflow-y-auto">
          <div className="p-6 space-y-5">

            <h2 className="text-[11px] font-bold text-[#92400e] uppercase tracking-widest">Live Preview</h2>

            {/* WhatsApp mockup */}
            <div className="rounded-2xl overflow-hidden shadow-md border border-black/[0.08]">

              {/* WA Header */}
              <div className="bg-[#075e54] px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#128c7e] border-2 border-white/20 flex items-center justify-center shrink-0">
                  <span className="text-white text-xs font-bold">WA</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-[14px] font-semibold leading-tight">Hawcus CRM</p>
                  <p className="text-green-300 text-[10px]">online</p>
                </div>
                <div className="flex gap-2.5">
                  <div className="w-3.5 h-3.5 rounded-full bg-white/15" />
                  <div className="w-3.5 h-3.5 rounded-full bg-white/15" />
                </div>
              </div>

              {/* Chat area */}
              <div className="min-h-[260px] p-3 flex flex-col gap-2" style={{ backgroundColor: '#efeae2' }}>
                {!message.trim() ? (
                  <div className="flex-1 flex items-center justify-center py-10">
                    <p className="text-[13px] text-[#9e9e9e] text-center leading-relaxed">
                      Start typing your message<br />to see the preview here
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-start">
                    <div className="max-w-[90%] bg-white rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">

                      {/* Attachment in preview */}
                      {showAttach && attachType === 'image' && attachImgSrc && (
                        <img src={attachImgSrc} alt="" className="w-full max-h-40 object-cover" />
                      )}
                      {showAttach && attachType === 'video' && (
                        <div className="flex items-center gap-2 bg-gray-100 px-3 py-2.5">
                          <Film className="w-5 h-5 text-gray-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-gray-700 truncate max-w-[180px]">{attachName}</p>
                            <p className="text-[10px] text-gray-500">Video</p>
                          </div>
                        </div>
                      )}
                      {showAttach && attachType === 'doc' && (
                        <div className="flex items-center gap-2.5 border-b border-orange-100 bg-orange-50 px-3 py-2.5">
                          <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4 text-orange-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-gray-800 truncate max-w-[180px]">{attachName}</p>
                            <p className="text-[10px] text-gray-500">{attachName.split('.').pop()?.toUpperCase() || 'FILE'}</p>
                          </div>
                        </div>
                      )}

                      {/* Message text */}
                      <div className="px-3 py-2">
                        <p
                          className="text-[13px] text-gray-800 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: renderHtml(message, sample) || '&nbsp;' }}
                        />

                        {/* Link preview card - shown when message contains a URL */}
                        {linkPreviewLoading && (
                          <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 flex items-center gap-2">
                            <Loader2 className="w-3 h-3 animate-spin text-gray-400 shrink-0" />
                            <span className="text-[10px] text-gray-400">Loading preview…</span>
                          </div>
                        )}
                        {!linkPreviewLoading && linkPreview && (
                          <div className="mt-2 rounded-lg border border-gray-200 overflow-hidden bg-white">
                            {linkPreview.image && (
                              <img
                                src={linkPreview.image}
                                alt=""
                                className="w-full max-h-28 object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                            <div className="px-2.5 py-2 border-t border-gray-100 bg-[#f7f7f7]">
                              {linkPreview.siteName && (
                                <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">{linkPreview.siteName}</p>
                              )}
                              {linkPreview.title && (
                                <p className="text-[11px] font-semibold text-gray-800 leading-tight line-clamp-2">{linkPreview.title}</p>
                              )}
                              {linkPreview.description && (
                                <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2 leading-snug">{linkPreview.description}</p>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-1 mt-1.5">
                          <span className="text-[10px] text-gray-400">10:30 AM</span>
                          <span className="text-[10px] text-blue-400">✓✓</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Fake WA input bar */}
              <div className="bg-[#f0f0f0] px-3 py-2 flex items-center gap-2">
                <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-[11px] text-gray-400">
                  Type a message
                </div>
                <div className="w-7 h-7 rounded-full bg-[#25d366] flex items-center justify-center shrink-0">
                  <span className="text-white text-[10px] ml-0.5">▶</span>
                </div>
              </div>
            </div>

            {/* Variable legend - all categories, all use {%slug%} */}
            <div className="bg-white rounded-2xl border border-orange-100 p-4">
              <h3 className="text-[10px] font-bold text-[#92400e] uppercase tracking-widest mb-3">
                Preview Sample Values
              </h3>
              <div className="space-y-1.5">
                {allPickerFields.map((f) => (
                  <div key={f.slug} className="flex items-center justify-between text-[11px] gap-2">
                    <span className="font-mono shrink-0 text-orange-600">{`{%${f.slug}%}`}</span>
                    <span className="text-[#7a6b5c] text-right truncate">{f.preview || `[${f.name}]`}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Formatting tips */}
            <div className="bg-orange-50 rounded-2xl border border-orange-100 p-4">
              <h3 className="text-[10px] font-bold text-[#92400e] uppercase tracking-widest mb-3">
                WhatsApp Formatting
              </h3>
              <div className="space-y-2 text-[13px] text-[#7a6b5c]">
                <div className="flex items-center gap-2">
                  <code className="bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded text-[11px]">*text*</code>
                  <span>→</span>
                  <strong className="text-[#1c1410]">bold</strong>
                </div>
                <div className="flex items-center gap-2">
                  <code className="bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded text-[11px]">_text_</code>
                  <span>→</span>
                  <em className="text-[#1c1410]">italic</em>
                </div>
                <div className="flex items-center gap-2">
                  <code className="bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded text-[11px]">~text~</code>
                  <span>→</span>
                  <del className="text-[#1c1410]">strikethrough</del>
                </div>
                <p className="text-[11px] pt-1.5 border-t border-orange-100 text-[#7a6b5c]">
                  Emoji can be typed or pasted directly - 👋 🎉 📎 ✅
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Variable Picker Modal ── */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setPickerOpen(false); setSearch(''); } }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-w-full max-h-[80vh] flex flex-col overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-orange-100 shrink-0">
              <div>
                <h3 className="text-[15px] font-semibold text-[#1c1410]">Insert Variable</h3>
                <p className="text-[11px] text-[#7a6b5c] mt-0.5">Click any field - inserts <code className="bg-orange-50 px-1 rounded text-orange-700">{'{%slug%}'}</code> at cursor</p>
              </div>
              <button
                onClick={() => { setPickerOpen(false); setSearch(''); }}
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
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search across ${allPickerFields.length} fields…`}
                  className="flex-1 text-[13px] bg-transparent outline-none text-[#1c1410] placeholder:text-[#7a6b5c]/50"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-[#7a6b5c] hover:text-[#1c1410]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Segment tabs - only shown when not searching */}
            {!search && (
              <div className="flex border-b border-orange-100 px-4 shrink-0 bg-white">
                {(['Standard', 'CRM', 'Custom', 'Values'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      'px-3 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap',
                      activeTab === tab
                        ? 'border-[var(--brand)] text-[var(--brand)]'
                        : 'border-transparent text-[#7a6b5c] hover:text-[#1c1410]'
                    )}
                  >
                    {tab}
                    <span className="ml-1.5 text-[10px] font-normal opacity-60">
                      ({modalCategories[tab].length})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Field list */}
            <div className="flex-1 overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center mb-3">
                    <Search className="w-4 h-4 text-orange-300" />
                  </div>
                  <p className="text-[14px] font-medium text-[#1c1410]">No fields found</p>
                  <p className="text-[11px] text-[#7a6b5c] mt-1">Try a different search term</p>
                </div>
              ) : (
                searchResults.map((group) => (
                  <div key={group.label}>
                    {/* Section header - only shown when searching (shows category label) */}
                    {search && (
                      <div className="px-4 py-2 bg-orange-50/60 border-b border-orange-50 sticky top-0">
                        <span className="text-[10px] font-bold text-[#92400e] uppercase tracking-widest">{group.label}</span>
                      </div>
                    )}
                    {group.items.map((item) => (
                      <button
                        key={item.slug}
                        onClick={() => insertVariable(item.slug)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-50 transition-colors border-b border-orange-50/80 last:border-0 text-left gap-4 group"
                      >
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-[#1c1410] truncate">{item.name}</p>
                          {item.preview && (
                            <p className="text-[11px] text-[#7a6b5c] mt-0.5 truncate">e.g. {item.preview}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-[11px] font-mono text-orange-700 bg-orange-50 border border-orange-200 px-2 py-1 rounded-lg group-hover:bg-orange-100 group-hover:border-orange-300 transition-colors">
                          {`{%${item.slug}%}`}
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

// ── Small helpers ─────────────────────────────────────────────────────────────

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

function FormatBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-md hover:bg-orange-100 text-[#1c1410] transition-colors flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function FileTypeIcon({ type, name, className }: { type: string; name: string; className?: string }) {
  if (type.startsWith('image/')) return <ImageIcon className={className} />;
  if (type.startsWith('video/') || name.toLowerCase().endsWith('.mp4')) return <Film className={className} />;
  return <FileText className={className} />;
}
