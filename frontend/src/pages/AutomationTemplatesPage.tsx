import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, Copy, X, Check, Eye, ArrowLeft, Send,
  Paperclip, Upload, Loader2, FileText, Image as ImageIcon, Film, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn, copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import { api, getAccessToken, BASE } from '@/lib/api';
import { usePermission } from '@/hooks/usePermission';

// ── Types ──────────────────────────────────────────────────────────────────────
type TemplateType = 'waba' | 'email' | 'sms' | 'wa_personal';
type WABACategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
interface WABAButton { id: string; type: 'QUICK_REPLY' | 'CALL_TO_ACTION'; label: string; value: string; }
interface Template {
  id: string;
  name: string;
  template_type: TemplateType;
  category: string;
  language: string;
  status: 'approved' | 'pending' | 'rejected';
  subject?: string | null;
  body: string;
  header?: string | null;
  footer?: string | null;
  buttons: WABAButton[] | string;
  meta_name?: string | null;
  meta_template_id?: string | null;
  meta_components?: any[] | null;
  file_path?: string | null;
  file_type?: string | null;
  file_name?: string | null;
  created_at: string;
}

interface WaPersonalTemplate {
  id: string;
  name: string;
  message: string;
  file_path?: string | null;
  file_type?: string | null;
  file_name?: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseButtons(b: WABAButton[] | string | undefined | null): WABAButton[] {
  if (!b) return [];
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return []; } }
  if (Array.isArray(b)) return b;
  return [];
}

function fileIcon(type: string | null | undefined) {
  if (!type) return <FileText className="w-3.5 h-3.5" />;
  if (type.startsWith('image/')) return <ImageIcon className="w-3.5 h-3.5" />;
  if (type.startsWith('video/')) return <Film className="w-3.5 h-3.5" />;
  return <FileText className="w-3.5 h-3.5" />;
}

async function fetchApi(url: string, method: string, body: FormData): Promise<Template> {
  const tok = getAccessToken();
  const resp = await fetch(`${BASE}${url}`, {
    method,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    credentials: 'include',
    body,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Request failed');
  return data as Template;
}

async function fetchWaPersonalApi(url: string, method: string, body: FormData): Promise<WaPersonalTemplate> {
  const tok = getAccessToken();
  const resp = await fetch(`${BASE}${url}`, {
    method,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    credentials: 'include',
    body,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Request failed');
  return data as WaPersonalTemplate;
}

const LANGUAGES = ['en', 'hi', 'ta', 'te', 'kn', 'mr'];
const WABA_CATS: WABACategory[] = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const catColor: Record<string, string> = {
  MARKETING: 'bg-purple-100 text-purple-700',
  UTILITY: 'bg-blue-100 text-blue-700',
  AUTHENTICATION: 'bg-orange-100 text-orange-700',
};
const statusColor: Record<string, string> = {
  approved: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
};

// ── Shared file attachment picker ─────────────────────────────────────────────
function AttachRow({
  accept, label, existingName,
  onFile, onRemoveExisting,
}: {
  accept: string; label: string;
  existingName?: string | null;
  onFile: (f: File | null) => void;
  onRemoveExisting: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);

  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1.5 block">{label}</label>
      {existingName && !removed && !picked && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 mb-2">
          <Paperclip className="w-4 h-4 shrink-0" />
          <span className="flex-1 truncate">{existingName}</span>
          <button type="button" onClick={() => { setRemoved(true); onRemoveExisting(); }} className="text-xs text-destructive hover:underline shrink-0">Remove</button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => ref.current?.click()} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border rounded-lg hover:bg-muted/30 transition-colors">
          <Upload className="w-4 h-4" />
          {picked ? picked.name : existingName && !removed ? 'Replace file' : 'Choose file'}
        </button>
        {picked && <button type="button" onClick={() => { setPicked(null); onFile(null); }} className="text-xs text-muted-foreground hover:underline">Clear</button>}
      </div>
      <input ref={ref} type="file" className="hidden" accept={accept} onChange={(e) => { const f = e.target.files?.[0] ?? null; setPicked(f); onFile(f); e.target.value = ''; }} />
      <p className="text-xs text-muted-foreground mt-1">Max 25 MB.</p>
    </div>
  );
}

// ── WABA Modal ─────────────────────────────────────────────────────────────────
function WABAModal({ initial, onClose, onSaved }: { initial?: Template | null; onClose: () => void; onSaved: (t: Template) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<WABACategory>((initial?.category as WABACategory) ?? 'UTILITY');
  const [language, setLanguage] = useState(initial?.language ?? 'en');
  const [header, setHeader] = useState(initial?.header ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [footer, setFooter] = useState(initial?.footer ?? '');
  const [buttons, setButtons] = useState<WABAButton[]>(parseButtons(initial?.buttons));
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitMeta, setSubmitMeta] = useState(!initial); // default ON for new templates

  const addBtn = () => {
    if (buttons.length >= 3) { toast.error('Max 3 buttons allowed'); return; }
    setButtons([...buttons, { id: `b-${Date.now()}`, type: 'QUICK_REPLY', label: '', value: '' }]);
  };
  const upd = (id: string, k: keyof WABAButton, v: string) => setButtons(buttons.map((b) => b.id === id ? { ...b, [k]: v } : b));
  const del = (id: string) => setButtons(buttons.filter((b) => b.id !== id));

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Template name required'); return; }
    if (!body.trim()) { toast.error('Body text required'); return; }
    setSaving(true);
    try {
      // If submitting to Meta, use the submit-to-meta endpoint directly
      if (submitMeta && !initial) {
        const metaButtons = buttons.filter((b) => b.label.trim()).map((b) => ({
          type: b.type === 'CALL_TO_ACTION' ? 'URL' : 'QUICK_REPLY',
          text: b.label,
          ...(b.type === 'CALL_TO_ACTION' ? { url: b.value } : {}),
        }));
        const saved = await api.post<Template>('/api/templates/submit-to-meta', {
          name: name.trim(),
          category,
          language,
          body: body.trim(),
          header: header.trim() || undefined,
          footer: footer.trim() || undefined,
          buttons: metaButtons.length ? metaButtons : undefined,
        });
        toast.success('Template submitted to Meta for approval');
        onSaved(saved);
        return;
      }

      // Local save only (or editing existing template)
      const fd = new FormData();
      fd.append('name', name.trim().toLowerCase().replace(/\s+/g, '_'));
      fd.append('template_type', 'waba');
      fd.append('category', category);
      fd.append('language', language);
      fd.append('body', body);
      if (header.trim()) fd.append('header', header.trim());
      if (footer.trim()) fd.append('footer', footer.trim());
      fd.append('buttons', JSON.stringify(buttons));
      if (removeFile) fd.append('removeFile', 'true');
      if (file) fd.append('file', file);
      const saved = await fetchApi(
        initial?.id ? `/api/templates/${initial.id}` : '/api/templates',
        initial?.id ? 'PATCH' : 'POST', fd,
      );
      toast.success(initial ? 'Template updated' : 'Template saved locally');
      onSaved(saved);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 shrink-0">
          <h3 className="font-bold text-[#1c1410]">{initial ? 'Edit WABA Template' : 'Create WABA Template'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--accent-tint)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Name / Category / Language */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="text-sm font-medium text-foreground mb-1.5 block">Template Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. welcome_lead" className="font-mono text-sm" />
              <p className="text-[11px] text-[#7a6b5c] mt-1">Lowercase, underscores only</p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Category</label>
              <select className="w-full border border-black/5 rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none" value={category} onChange={(e) => setCategory(e.target.value as WABACategory)}>
                {WABA_CATS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Language</label>
              <select className="w-full border border-black/5 rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Header Text <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="Bold header text displayed above body" />
          </div>

          <AttachRow
            accept="image/*,video/*,.pdf,.doc,.docx"
            label="Media Header (optional) — image, video, PDF or document"
            existingName={initial?.file_name}
            onFile={setFile}
            onRemoveExisting={() => setRemoveFile(true)}
          />

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-foreground">Body Text *</label>
              <span className="text-xs text-muted-foreground">{body.length}/1024</span>
            </div>
            <textarea
              className="w-full border border-black/5 rounded-lg px-3 py-2 text-sm bg-card focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none"
              rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024}
              placeholder="Message body. Use {%first_name%}, {%assigned_to%}, etc."
            />
            <p className="text-[11px] text-[#7a6b5c] mt-1">Variables: {'{%first_name%} {%last_name%} {%assigned_to%} {%deal_value%} {%stage%}'}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Footer <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="e.g. Reply STOP to unsubscribe" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-foreground">Buttons <span className="text-muted-foreground font-normal text-xs">(max 3)</span></label>
              <button onClick={addBtn} className="text-xs text-primary flex items-center gap-1 hover:underline"><Plus className="w-3 h-3" />Add Button</button>
            </div>
            <div className="space-y-2">
              {buttons.map((btn) => (
                <div key={btn.id} className="flex gap-2 items-center p-2.5 rounded-xl border border-black/5 bg-[var(--app-bg)]">
                  <select className="border border-black/5 rounded-lg px-2 py-1.5 text-xs bg-card outline-none shrink-0" value={btn.type} onChange={(e) => upd(btn.id, 'type', e.target.value)}>
                    <option value="QUICK_REPLY">Quick Reply</option>
                    <option value="CALL_TO_ACTION">CTA</option>
                  </select>
                  <Input value={btn.label} onChange={(e) => upd(btn.id, 'label', e.target.value)} placeholder="Button label" className="flex-1 text-xs" />
                  <Input value={btn.value} onChange={(e) => upd(btn.id, 'value', e.target.value)} placeholder={btn.type === 'CALL_TO_ACTION' ? 'https://...' : 'payload'} className="flex-1 text-xs font-mono" />
                  <button onClick={() => del(btn.id)} className="p-1 text-muted-foreground hover:text-destructive rounded"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              {buttons.length === 0 && <p className="text-[11px] text-[#7a6b5c] py-2 text-center border border-dashed border-border rounded-lg">No buttons added. Quick Reply buttons let users respond with one tap.</p>}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-black/5 shrink-0">
          {!initial && (
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={submitMeta} onChange={(e) => setSubmitMeta(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary/30" />
              <span className="text-[#7a6b5c]">Submit to Meta for approval</span>
            </label>
          )}
          {initial && <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving…</> :
                <><Check className="w-4 h-4 mr-1" />{initial ? 'Save Changes' : submitMeta ? 'Submit to Meta' : 'Save Locally'}</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email Modal ────────────────────────────────────────────────────────────────
function EmailModal({ initial, onClose, onSaved }: { initial?: Template | null; onClose: () => void; onSaved: (t: Template) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Template name required'); return; }
    if (!subject.trim()) { toast.error('Subject required'); return; }
    if (!body.trim()) { toast.error('Body required'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('template_type', 'email');
      fd.append('category', 'EMAIL');
      fd.append('language', 'en');
      fd.append('body', body);
      fd.append('subject', subject.trim());
      if (removeFile) fd.append('removeFile', 'true');
      if (file) fd.append('file', file);
      const saved = await fetchApi(
        initial?.id ? `/api/templates/${initial.id}` : '/api/templates',
        initial?.id ? 'PATCH' : 'POST', fd,
      );
      toast.success('Template saved');
      onSaved(saved);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 shrink-0">
          <h3 className="font-bold text-[#1c1410]">{initial ? 'Edit Email Template' : 'Create Email Template'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--accent-tint)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Template Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome Email" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Subject Line *</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Welcome, {%first_name%}!" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Email Body *</label>
            <textarea
              className="w-full border border-black/5 rounded-lg px-3 py-2 text-sm bg-card focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none"
              rows={8} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Email body. Supports {%first_name%}, {%assigned_to%}, {%deal_value%}, etc."
            />
            <p className="text-[11px] text-[#7a6b5c] mt-1">Variables: {'{%first_name%} {%last_name%} {%email%} {%assigned_to%} {%deal_value%}'}</p>
          </div>
          <AttachRow
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv"
            label="Attachment (optional) — image, PDF, Word, Excel, PowerPoint, ZIP, etc."
            existingName={initial?.file_name}
            onFile={setFile}
            onRemoveExisting={() => setRemoveFile(true)}
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-black/5 shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving…</> : <><Check className="w-4 h-4 mr-1" />{initial ? 'Save Changes' : 'Create'}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── SMS Modal ─────────────────────────────────────────────────────────────────
function SMSModal({ initial, onClose, onSaved }: { initial?: Template | null; onClose: () => void; onSaved: (t: Template) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Template name required'); return; }
    if (!body.trim()) { toast.error('Body required'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('template_type', 'sms');
      fd.append('category', 'SMS');
      fd.append('language', 'en');
      fd.append('body', body);
      const saved = await fetchApi(
        initial?.id ? `/api/templates/${initial.id}` : '/api/templates',
        initial?.id ? 'PATCH' : 'POST', fd,
      );
      toast.success('Template saved');
      onSaved(saved);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h3 className="font-bold text-[#1c1410]">{initial ? 'Edit SMS Template' : 'Create SMS Template'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--accent-tint)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Template Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome SMS" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-foreground">Message Body *</label>
              <span className={cn('text-xs', body.length > 160 ? 'text-destructive font-medium' : 'text-muted-foreground')}>{body.length}/160 · {body.length > 160 ? '2 SMS' : '1 SMS'}</span>
            </div>
            <textarea
              className="w-full border border-black/5 rounded-lg px-3 py-2 text-sm bg-card focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none"
              rows={4} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Short message. Use {%first_name%}, {%phone%} for personalization."
            />
            <p className="text-[11px] text-[#7a6b5c] mt-1">Variables: {'{%first_name%} {%last_name%} {%phone%} {%email%}'}</p>
          </div>
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
            <span className="shrink-0 mt-0.5">ℹ️</span>
            <span>SMS does not support file attachments. Use Email or WhatsApp templates for media.</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-black/5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving…</> : <><Check className="w-4 h-4 mr-1" />{initial ? 'Save Changes' : 'Create'}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── WA Personal Modal ─────────────────────────────────────────────────────────
function WAPersonalModal({ initial, onClose, onSaved }: { initial?: WaPersonalTemplate | null; onClose: () => void; onSaved: (t: WaPersonalTemplate) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Template name required'); return; }
    if (!message.trim()) { toast.error('Message required'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('message', message.trim());
      if (removeFile) fd.append('removeFile', 'true');
      if (file) fd.append('file', file);
      const url = initial?.id ? `/api/wa-personal-templates/${initial.id}` : '/api/wa-personal-templates';
      const method = initial?.id ? 'PATCH' : 'POST';
      const saved = await fetchWaPersonalApi(url, method, fd);
      toast.success('Template saved');
      onSaved(saved);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 shrink-0">
          <h3 className="font-bold text-[#1c1410]">{initial ? 'Edit WA Personal Template' : 'Create WA Personal Template'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--accent-tint)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Template Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome Message" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-foreground">Message *</label>
              <span className="text-xs text-muted-foreground">{message.length}/4096</span>
            </div>
            <textarea
              className="w-full border border-black/5 rounded-lg px-3 py-2 text-sm bg-card focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none"
              rows={6} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4096}
              placeholder="Message text. Use {first_name}, {phone}, {email}, {assigned_staff}, etc."
            />
            <p className="text-[11px] text-[#7a6b5c] mt-1">Variables: {'{first_name} {last_name} {phone} {email} {assigned_staff} {stage}'}</p>
          </div>
          <AttachRow
            accept="image/*,.pdf,.doc,.docx"
            label="Attachment (optional) — image, PDF or document"
            existingName={initial?.file_name}
            onFile={setFile}
            onRemoveExisting={() => setRemoveFile(true)}
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-black/5 shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving…</> : <><Check className="w-4 h-4 mr-1" />{initial ? 'Save Changes' : 'Create'}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── WABA Preview ───────────────────────────────────────────────────────────────
function WABAPreview({ template, onClose }: { template: Template; onClose: () => void }) {
  const btns = parseButtons(template.buttons);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h3 className="font-bold text-[#1c1410]">Preview</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--accent-tint)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">
          <div className="bg-[#e5ddd5] rounded-2xl p-4 min-h-40">
            <div className="bg-white rounded-2xl rounded-tl-sm p-3 max-w-[85%] shadow-sm">
              {template.file_name && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 rounded-lg px-2 py-1.5 mb-2">
                  {fileIcon(template.file_type)}
                  <span className="truncate">{template.file_name}</span>
                </div>
              )}
              {template.header && <p className="font-semibold text-sm text-gray-900 mb-1">{template.header}</p>}
              <p className="text-sm text-gray-800 whitespace-pre-line">{template.body.replace(/{%(\w+)%}/g, (_, k) => `[${k}]`)}</p>
              {template.footer && <p className="text-xs text-gray-500 mt-1.5">{template.footer}</p>}
              <p className="text-[10px] text-gray-400 mt-1 text-right">10:30 AM</p>
            </div>
            {btns.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {btns.map((btn) => (
                  <div key={btn.id} className="bg-white rounded-xl py-2 text-center text-sm font-medium text-blue-600 shadow-sm">{btn.label}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AutomationTemplatesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = usePermission('automation_templates:manage');

  const isWabaRoute = location.pathname === '/automation/waba-templates';
  const defaultTab: TemplateType = (searchParams.get('tab') as TemplateType) ?? (isWabaRoute ? 'waba' : 'wa_personal');
  const [tab, setTab] = useState<TemplateType>(defaultTab);

  const handleTabChange = (t: TemplateType) => {
    setTab(t);
    setSearchParams({ tab: t }, { replace: true });
  };
  const [templates, setTemplates] = useState<Template[]>([]);
  const [waPersonalTemplates, setWaPersonalTemplates] = useState<WaPersonalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState<Template | null>(null);
  const [editWaPersonal, setEditWaPersonal] = useState<WaPersonalTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const [syncing, setSyncing] = useState(false);

  const syncFromMeta = async () => {
    setSyncing(true);
    try {
      const res = await api.post<{ synced: number; total: number }>('/api/templates/sync-waba', {});
      toast.success(`Synced ${res.synced} template(s) from Meta`);
      load();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to sync templates from Meta');
    } finally {
      setSyncing(false);
    }
  };

  const load = () => {
    setLoading(true);
    const tok = getAccessToken();
    const headers: Record<string, string> = tok ? { Authorization: `Bearer ${tok}` } : {};
    Promise.all([
      fetch(`${BASE}/api/templates`, { headers, credentials: 'include' }).then((r) => r.json()).catch(() => []),
      fetch(`${BASE}/api/wa-personal-templates`, { headers, credentials: 'include' }).then((r) => r.json()).catch(() => []),
    ]).then(([general, wap]) => {
      if (Array.isArray(general)) setTemplates(general);
      if (Array.isArray(wap)) setWaPersonalTemplates(wap);
    }).catch(() => toast.error('Failed to load templates')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const byType = (t: TemplateType) => templates.filter((x) => (x.template_type ?? 'waba') === t);
  const waba = byType('waba');
  const email = byType('email');
  const sms = byType('sms');

  const tabs = [
    { key: 'waba' as TemplateType, label: 'WhatsApp (WABA)', count: waba.length },
    { key: 'email' as TemplateType, label: 'Email', count: email.length },
    { key: 'sms' as TemplateType, label: 'SMS', count: sms.length },
    { key: 'wa_personal' as TemplateType, label: 'WA Personal', count: waPersonalTemplates.length },
  ];

  const handleSaved = (saved: Template) => {
    setTemplates((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      return idx >= 0 ? prev.map((t) => t.id === saved.id ? saved : t) : [saved, ...prev];
    });
    setEditItem(null);
    setShowCreate(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    const tok = getAccessToken();
    try {
      const resp = await fetch(`${BASE}/api/templates/${id}`, {
        method: 'DELETE',
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        credentials: 'include',
      });
      if (!resp.ok) throw new Error();
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success('Template deleted');
    } catch { toast.error('Delete failed'); }
  };

  const handleSubmitToMeta = async (t: Template) => {
    if (!confirm(`Submit "${t.name}" to Meta for approval? This will create the template on your WABA account.`)) return;
    try {
      const btns = parseButtons(t.buttons);
      const metaButtons = btns.map((b) => ({
        type: b.type === 'CALL_TO_ACTION' ? 'URL' : 'QUICK_REPLY',
        text: b.label,
        ...(b.type === 'CALL_TO_ACTION' ? { url: b.value } : {}),
      }));
      const saved = await api.post<Template>('/api/templates/submit-to-meta', {
        name: t.name,
        category: t.category,
        language: t.language,
        body: t.body,
        header: t.header || undefined,
        footer: t.footer || undefined,
        buttons: metaButtons.length ? metaButtons : undefined,
      });
      setTemplates((prev) => prev.map((x) => x.id === t.id ? saved : x));
      toast.success('Template submitted to Meta for approval');
    } catch (e: any) { toast.error(e.message || 'Submit failed'); }
  };

  const handleDeleteFromMeta = async (t: Template) => {
    if (!confirm(`Delete "${t.name}" from Meta? This removes the template from both Meta and your local database.`)) return;
    try {
      await api.delete(`/api/templates/${t.id}/meta`);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      toast.success('Template deleted from Meta');
    } catch (e: any) { toast.error(e.message || 'Delete failed'); }
  };

  const handleWaPersonalSaved = (saved: WaPersonalTemplate) => {
    setWaPersonalTemplates((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      return idx >= 0 ? prev.map((t) => t.id === saved.id ? saved : t) : [saved, ...prev];
    });
    setEditWaPersonal(null);
    setShowCreate(false);
  };

  const handleWaPersonalDelete = async (id: string) => {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    const tok = getAccessToken();
    try {
      const resp = await fetch(`${BASE}/api/wa-personal-templates/${id}`, {
        method: 'DELETE',
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        credentials: 'include',
      });
      if (!resp.ok) throw new Error();
      setWaPersonalTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success('Template deleted');
    } catch { toast.error('Delete failed'); }
  };

  const emptyLabel: Record<TemplateType, string> = {
    waba: 'No WhatsApp (WABA) templates yet',
    email: 'No Email templates yet',
    sms: 'No SMS templates yet',
    wa_personal: 'No WA Personal templates yet',
  };
  const emptyDesc: Record<TemplateType, string> = {
    waba: 'Create approved message templates — with images, videos or documents — for automated WhatsApp campaigns.',
    email: 'Build reusable email templates with file attachments for automated outreach.',
    sms: 'Create short SMS templates for quick automated notifications.',
    wa_personal: 'Create reusable message templates for your personal WhatsApp (QR-linked) number. Supports images, PDFs and documents.',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-[#1c1410] transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-[#1c1410]">Templates</h1>
            <p className="text-sm text-[#7a6b5c]">Reusable message templates for WhatsApp, Email and SMS</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && tab === 'waba' && (
            <Button variant="outline" onClick={syncFromMeta} disabled={syncing}>
              <RefreshCw className={cn('w-4 h-4 mr-1', syncing && 'animate-spin')} />
              {syncing ? 'Syncing...' : 'Sync from Meta'}
            </Button>
          )}
          {canManage && (
            <Button onClick={() => tab === 'wa_personal' ? navigate('/automation/templates/wa-personal/new') : setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" />New Template
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-black/5">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => handleTabChange(t.key)} className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.label}
            <span className={cn('text-xs rounded-full px-1.5 py-0.5', tab === t.key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : tab === 'wa_personal' ? (
        waPersonalTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center">
              <FileText className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground">{emptyLabel.wa_personal}</p>
            <p className="text-sm text-muted-foreground max-w-sm">{emptyDesc.wa_personal}</p>
            {canManage && (
              <Button onClick={() => navigate('/automation/templates/wa-personal/new')}>
                <Plus className="w-4 h-4 mr-1" />Create First Template
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {waPersonalTemplates.map((t) => (
              <div key={t.id} className="bg-white rounded-2xl border border-black/5 p-4 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-[#1c1410]">{t.name}</p>
                      {t.file_name && (
                        <span className="flex items-center gap-1 text-[11px] text-teal-700 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded-md">
                          {fileIcon(t.file_type)}
                          <span className="max-w-[130px] truncate">{t.file_name}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-[#7a6b5c] mt-1 line-clamp-2 whitespace-pre-line">{t.message}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { copyToClipboard(t.name); toast.success('Template name copied'); }} className="p-1.5 rounded-md hover:bg-[var(--accent-tint)] text-muted-foreground hover:text-foreground transition-colors" title="Copy name"><Copy className="w-4 h-4" /></button>
                    {canManage && <button onClick={() => navigate(`/automation/templates/wa-personal/${t.id}`, { state: { template: t } })} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>}
                    {canManage && <button onClick={() => handleWaPersonalDelete(t.id)} className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (() => {
        const current = tab === 'waba' ? waba : tab === 'email' ? email : sms;
        return current.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center">
              <FileText className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground">{emptyLabel[tab]}</p>
            <p className="text-sm text-muted-foreground max-w-sm">{emptyDesc[tab]}</p>
            {canManage && (
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4 mr-1" />Create First Template
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {current.map((t) => {
              const btns = parseButtons(t.buttons);
              return (
                <div key={t.id} className="bg-white rounded-2xl border border-black/5 p-4 hover:shadow-md transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={cn('text-sm font-bold text-[#1c1410]', tab === 'waba' && t.meta_name && 'font-mono')}>{t.name}</p>
                        {tab === 'waba' && t.meta_name && (
                          <Badge className="border-0 text-[10px] bg-emerald-50 text-emerald-700">Synced</Badge>
                        )}
                        {tab === 'waba' && !t.meta_name && (
                          <Badge className="border-0 text-[10px] bg-gray-100 text-gray-500">Local</Badge>
                        )}
                        {tab === 'waba' && t.category && !['EMAIL','SMS'].includes(t.category) && (
                          <Badge className={cn('border-0 text-xs', catColor[t.category] ?? 'bg-gray-100 text-gray-700')}>{t.category}</Badge>
                        )}
                        {tab === 'waba' && (
                          <Badge className={cn('border-0 text-xs capitalize', statusColor[t.status] ?? 'bg-gray-100 text-gray-700')}>{t.status}</Badge>
                        )}
                        {tab === 'waba' && t.language && <span className="text-[11px] text-[#7a6b5c] uppercase">{t.language}</span>}
                        {t.file_name && (
                          <span className="flex items-center gap-1 text-[11px] text-teal-700 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded-md">
                            {fileIcon(t.file_type)}
                            <span className="max-w-[130px] truncate">{t.file_name}</span>
                          </span>
                        )}
                      </div>
                      {tab === 'email' && t.subject && (
                        <p className="text-[11px] text-[#7a6b5c] mt-0.5 font-medium">Subject: {t.subject}</p>
                      )}
                      {tab === 'waba' && t.meta_name && <p className="text-[11px] text-[#7a6b5c] mt-0.5 font-mono">Meta: {t.meta_name}</p>}
                      {tab === 'waba' && t.header && <p className="text-sm font-semibold text-[#1c1410] mt-2">{t.header}</p>}
                      <p className="text-[13px] text-[#7a6b5c] mt-1 line-clamp-2 whitespace-pre-line">{t.body}</p>
                      {tab === 'waba' && btns.length > 0 && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {btns.map((btn) => (
                            <span key={btn.id} className={cn('text-xs px-2.5 py-1 rounded-lg border font-medium', btn.type === 'QUICK_REPLY' ? 'border-primary/30 text-primary bg-primary/5' : 'border-blue-200 text-blue-600 bg-blue-50')}>
                              {btn.type === 'CALL_TO_ACTION' ? '🔗 ' : ''}{btn.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {tab === 'sms' && (
                        <p className="text-[11px] text-[#7a6b5c] mt-1">{t.body.length}/160 chars · {t.body.length > 160 ? '2 SMS' : '1 SMS'}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {tab === 'waba' && <button onClick={() => setPreview(t)} className="p-1.5 rounded-md hover:bg-[var(--accent-tint)] text-muted-foreground hover:text-foreground transition-colors" title="Preview"><Eye className="w-4 h-4" /></button>}
                      <button onClick={() => { copyToClipboard(t.name); toast.success('Template name copied'); }} className="p-1.5 rounded-md hover:bg-[var(--accent-tint)] text-muted-foreground hover:text-foreground transition-colors" title="Copy name"><Copy className="w-4 h-4" /></button>
                      {canManage && tab === 'waba' && !t.meta_template_id && (
                        <button onClick={() => handleSubmitToMeta(t)} className="p-1.5 rounded-md hover:bg-emerald-50 text-muted-foreground hover:text-emerald-600 transition-colors" title="Submit to Meta for approval"><Send className="w-4 h-4" /></button>
                      )}
                      {canManage && <button onClick={() => setEditItem(t)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>}
                      {canManage && tab === 'waba' && t.meta_template_id ? (
                        <button onClick={() => handleDeleteFromMeta(t)} className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-destructive transition-colors" title="Delete from Meta"><Trash2 className="w-4 h-4" /></button>
                      ) : canManage && (
                        <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Create modal */}
      {showCreate && tab === 'waba'        && <WABAModal        onClose={() => setShowCreate(false)} onSaved={handleSaved} />}
      {showCreate && tab === 'email'       && <EmailModal       onClose={() => setShowCreate(false)} onSaved={handleSaved} />}
      {showCreate && tab === 'sms'         && <SMSModal         onClose={() => setShowCreate(false)} onSaved={handleSaved} />}
      {/* wa_personal → full-page editor (navigate instead of modal) */}

      {/* Edit modal */}
      {editItem && editItem.template_type === 'waba'  && <WABAModal  initial={editItem} onClose={() => setEditItem(null)} onSaved={handleSaved} />}
      {editItem && editItem.template_type === 'email' && <EmailModal initial={editItem} onClose={() => setEditItem(null)} onSaved={handleSaved} />}
      {editItem && editItem.template_type === 'sms'   && <SMSModal   initial={editItem} onClose={() => setEditItem(null)} onSaved={handleSaved} />}

      {/* WABA preview */}
      {preview && <WABAPreview template={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
