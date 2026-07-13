import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, X, Copy, Link, Code2, Pencil,
  FileText, Users, Calendar, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePermission } from '@/hooks/usePermission';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { copyToClipboard } from '@/lib/utils';

interface FormField {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  required: boolean;
  mapTo: string;
  options?: string[];
}

interface CustomForm {
  id: string;
  name: string;
  slug: string;
  fields: FormField[];
  pipeline_id: string | null;
  pipeline_name: string | null;
  stage_id: string | null;
  stage_name: string | null;
  is_active: boolean;
  submission_count: number;
  created_at: string;
  btn_color: string;
  btn_text_color: string;
  form_bg_color: string | null;
  form_text_color: string;
  submit_label: string;
  thank_you_message: string;
  redirect_url: string | null;
  declaration_enabled: boolean;
  declaration_title: string | null;
  declaration_link: string | null;
}

interface Submission {
  id: string;
  form_id: string;
  data: Record<string, string>;
  submitted_at: string;
}

function SubmissionRow({ sub }: { sub: Submission }) {
  const [expanded, setExpanded] = useState(false);
  const data = sub.data ?? {};
  const keys = Object.keys(data);

  const name =
    data['Full Name'] ?? data['Name'] ?? data['first_name'] ?? data['name'] ??
    data[keys.find((k) => /name/i.test(k)) ?? ''] ?? '-';
  const phone =
    data['Phone'] ?? data['phone'] ?? data[keys.find((k) => /phone/i.test(k)) ?? ''] ?? '-';

  return (
    <div className="border-b border-[var(--hairline)] last:border-0">
      {/* Summary row */}
      <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--app-bg)] transition-colors">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[14px] font-bold text-primary uppercase">
          {(name as string).charAt(0) || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-[#111318] truncate">{name as string}</p>
          <p className="text-[12px] text-[#6b7280]">{phone}</p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1.5 rounded-lg hover:bg-primary/10 text-[#9ca3af] hover:text-primary transition-colors shrink-0"
        >
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5" />
            : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded fields */}
      {expanded && (
        <div className="px-5 pb-4 pt-1 space-y-2 bg-[var(--app-bg)]">
          {keys.map((k) => (
            <div key={k} className="flex items-start gap-2">
              <span className="text-[12px] font-semibold text-[#6b7280] w-28 shrink-0 pt-0.5">{k}</span>
              <span className="text-[14px] text-[#111318] break-all flex-1">{data[k] || '-'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CustomFormsPage() {
  const navigate = useNavigate();
  const canManageForms = usePermission('custom_forms:create');
  const canDeleteForms = usePermission('custom_forms:delete');
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [loading, setLoading] = useState(true);

  // Submissions panel state
  const [panelForm, setPanelForm] = useState<CustomForm | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [subLoading, setSubLoading] = useState(false);

  // Embed/Share modal state
  const [embedFormId, setEmbedFormId] = useState<string | null>(null);
  const [embedTab, setEmbedTab] = useState<'iframe' | 'html'>('iframe');
  const [shareLinkFormId, setShareLinkFormId] = useState<string | null>(null);
  const [copiedFormId, setCopiedFormId] = useState<string | null>(null);

  const copyFormLink = (e: React.MouseEvent, form: CustomForm) => {
    e.stopPropagation();
    if (!form.slug) return;
    copyToClipboard(getShareLink(form));
    setCopiedFormId(form.id);
    setTimeout(() => setCopiedFormId(null), 2000);
  };

  // Clone confirm modal
  const [cloneTarget, setCloneTarget] = useState<CustomForm | null>(null);
  const [cloning, setCloning] = useState(false);

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<CustomForm | null>(null);
  const [deleting, setDeleting] = useState(false);

  const publicUrl = import.meta.env.VITE_PUBLIC_URL ?? 'http://localhost:5173';

  const embedForm = forms.find((f) => f.id === embedFormId);
  const shareLinkForm = forms.find((f) => f.id === shareLinkFormId);
  const totalSubmissions = forms.reduce((s, f) => s + (f.submission_count ?? 0), 0);

  const [liveTick, setLiveTick] = useState(0);
  // Live-refresh forms on any tenant data change (no manual reload).
  useLiveRefresh(() => setLiveTick((n) => n + 1));
  useEffect(() => {
    api.get<CustomForm[]>('/api/forms')
      .then((data) => setForms(data))
      .catch(() => toast.error('Failed to load forms'))
      .finally(() => setLoading(false));
  }, [liveTick]);

  const openPanel = (form: CustomForm) => {
    setPanelForm(form);
    setSubmissions([]);
    setSubLoading(true);
    api.get<Submission[]>(`/api/forms/${form.id}/submissions`)
      .then((data) => setSubmissions(data))
      .catch(() => toast.error('Failed to load submissions'))
      .finally(() => setSubLoading(false));
  };

  const closePanel = () => { setPanelForm(null); setSubmissions([]); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/forms/${deleteTarget.id}`);
      setForms(forms.filter((f) => f.id !== deleteTarget.id));
      if (panelForm?.id === deleteTarget.id) closePanel();
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete form');
    } finally {
      setDeleting(false);
    }
  };

  const handleClone = async () => {
    if (!cloneTarget) return;
    setCloning(true);
    try {
      const created = await api.post<CustomForm>('/api/forms', {
        name: `${cloneTarget.name} (Copy)`,
        pipeline_id: cloneTarget.pipeline_id,
        stage_id: cloneTarget.stage_id,
      });
      setForms((prev) => [...prev, created]);
      toast.success(`"${cloneTarget.name}" cloned successfully`);
      setCloneTarget(null);
    } catch {
      toast.error('Failed to clone form');
    } finally {
      setCloning(false);
    }
  };

  const embedApiBase = (import.meta.env.VITE_API_URL as string) || publicUrl;

  const getShareLink = (form: CustomForm) => `${publicUrl}/f/${form.slug}`;
  const getIframeCode = (form: CustomForm) =>
    `<iframe src="${publicUrl}/f/${form.slug}" width="100%" height="600" frameborder="0" style="border:none;border-radius:16px;display:block"></iframe>`;

  const generateHTMLSnippet = (form: CustomForm): string => {
    const bg      = form.form_bg_color  ?? '#ffffff';
    const text    = form.form_text_color ?? '#111318';
    const btn     = form.btn_color       ?? '#ea580c';
    const btnTxt  = form.btn_text_color  ?? '#ffffff';
    const uid     = `dgf_${form.slug.replace(/-/g, '_')}`;
    const label   = form.submit_label    || 'Submit';
    const api     = `${embedApiBase}/api/public/forms/${form.slug}/submit`;
    const redir   = form.redirect_url   ? `'${form.redirect_url}'` : 'null';

    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const fieldsHtml = (form.fields ?? []).map((f) => {
      const lbl = esc(f.label);
      const ph  = esc(f.placeholder ?? '');
      const req = f.required ? ' required' : '';
      const star = f.required ? `<span class="dgf-req">*</span>` : '';
      let inp = '';
      if (f.type === 'textarea') {
        inp = `<textarea class="dgf-input" data-label="${lbl}" placeholder="${ph}"${req}></textarea>`;
      } else if (f.type === 'dropdown') {
        const opts = (f.options ?? []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
        inp = `<select class="dgf-input" data-label="${lbl}"${req}><option value="">- Select -</option>${opts}</select>`;
      } else if (f.type === 'radio') {
        inp = (f.options ?? []).map((o) =>
          `<label class="dgf-radio"><input type="radio" name="${uid}_${f.id}" value="${esc(o)}" data-label="${lbl}"${req}> ${esc(o)}</label>`
        ).join('');
      } else if (f.type === 'multiselect') {
        inp = (f.options ?? []).map((o) =>
          `<label class="dgf-chk"><input type="checkbox" data-ms="${lbl}" value="${esc(o)}" onchange="${uid}_ms('${esc(lbl).replace(/'/g, "\\'")}',this)"> ${esc(o)}</label>`
        ).join('');
      } else if (f.type === 'checkbox') {
        inp = `<label class="dgf-chk"><input type="checkbox" data-label="${lbl}"> ${esc(f.placeholder || f.label)}</label>`;
      } else {
        const t = f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
        inp = `<input type="${t}" class="dgf-input" data-label="${lbl}" placeholder="${ph}"${req}>`;
      }
      const reqAttr = f.required ? ' data-req="1"' : '';
      return `<div class="dgf-field"${reqAttr}><label class="dgf-label">${lbl}${star}</label>${inp}</div>`;
    }).join('\n');

    const declHtml = (form.declaration_enabled && form.declaration_title)
      ? `<div class="dgf-field dgf-decl"><input type="checkbox" id="${uid}_d" data-declaration="1" required style="width:16px;height:16px;margin-top:2px;accent-color:${btn};flex-shrink:0"><label for="${uid}_d" style="font-size:12px;color:${text};cursor:pointer">${esc(form.declaration_title)}${form.declaration_link ? ` <a href="${esc(form.declaration_link)}" target="_blank" rel="noreferrer" style="text-decoration:underline;opacity:0.7">View Policy</a>` : ''}</label></div>`
      : '';

    const declCheck = form.declaration_enabled
      ? `var d=document.getElementById('${uid}_d');if(!d.checked){alert('Please accept the declaration to continue.');return;}`
      : '';

    return `<!-- Hawcus Form: ${form.name} -->
<div id="${uid}" style="font-family:system-ui,-apple-system,sans-serif;max-width:448px;margin:0 auto">
<style>
#${uid} *{box-sizing:border-box}
#${uid} .dgf-wrap{background:${bg};border-radius:16px;padding:32px;box-shadow:0 20px 25px -5px rgba(0,0,0,.1),0 8px 10px -6px rgba(0,0,0,.1)}
#${uid} .dgf-title{font-size:22px;font-weight:700;color:${text};margin:0 0 24px;font-family:inherit}
#${uid} .dgf-field{margin-bottom:16px}
#${uid} .dgf-label{display:block;font-size:12px;font-weight:600;color:${text};margin-bottom:6px}
#${uid} .dgf-req{color:#ef4444;margin-left:2px}
#${uid} .dgf-input{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.7);font-size:13px;color:${text};outline:none;font-family:inherit;transition:border-color .15s}
#${uid} .dgf-input:focus{border-color:${btn}}
#${uid} textarea.dgf-input{resize:none;height:80px}
#${uid} .dgf-radio,#${uid} .dgf-chk{display:flex;align-items:center;gap:10px;margin-bottom:8px;cursor:pointer;font-size:13px;color:${text}}
#${uid} input[type=radio],#${uid} input[type=checkbox]{accent-color:${btn};width:16px;height:16px;flex-shrink:0}
#${uid} .dgf-btn{width:100%;padding:12px;border-radius:12px;border:none;font-size:14px;font-weight:600;cursor:pointer;background:${btn};color:${btnTxt};margin-top:8px;font-family:inherit;transition:opacity .2s}
#${uid} .dgf-btn:disabled{opacity:.6;cursor:not-allowed}
#${uid} .dgf-decl{display:flex;align-items:flex-start;gap:8px}
#${uid} .dgf-ok{text-align:center;padding:32px 16px}
#${uid} .dgf-ok-icon{width:64px;height:64px;border-radius:50%;background:${btn};display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
#${uid} .dgf-ok-msg{font-size:18px;font-weight:700;color:${text}}
</style>
<div class="dgf-wrap">
<p class="dgf-title">${esc(form.name)}</p>
<form id="${uid}_f">
${fieldsHtml}
${declHtml}
<button type="submit" class="dgf-btn">${esc(label)}</button>
</form>
</div>
<script>
(function(){
var _m={};
window.${uid}_ms=function(k,el){_m[k]=_m[k]||[];var i=_m[k].indexOf(el.value);el.checked?i<0&&_m[k].push(el.value):i>=0&&_m[k].splice(i,1);};
document.getElementById('${uid}_f').addEventListener('submit',function(e){
e.preventDefault();${declCheck}
var missing=[];e.target.querySelectorAll('[required]').forEach(function(el){if(el.type==='radio'){var nm=el.name;if(!e.target.querySelector('input[name="'+nm+'"]:checked')){var l=el.getAttribute('data-label')||'Field';if(missing.indexOf(l)<0)missing.push(l.replace(/\\*$/,'').trim());}return;}if(!el.value||!el.value.trim()){var l=el.getAttribute('data-label')||el.closest('.dgf-field')?.querySelector('.dgf-label')?.textContent||'Field';missing.push(l.replace(/\\*$/,'').trim());}});
e.target.querySelectorAll('.dgf-field[data-req] [data-ms]').forEach(function(el){var k=el.getAttribute('data-ms');if(!_m[k]||!_m[k].length){if(missing.indexOf(k)<0)missing.push(k);}});
if(missing.length){alert('Please fill in: '+missing.join(', '));return;}
var btn=e.target.querySelector('button[type=submit]');
btn.disabled=true;btn.textContent='Submitting…';
var data={};
e.target.querySelectorAll('[data-label]').forEach(function(el){
var k=el.getAttribute('data-label');
if(el.type==='radio'){if(el.checked)data[k]=el.value;}
else if(el.type==='checkbox'&&!el.dataset.declaration){data[k]=el.checked?'true':'';}
else if(el.type!=='checkbox'){data[k]=el.value;}
});
Object.keys(_m).forEach(function(k){data[k]=_m[k].join(',');});
fetch('${api}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:data})})
.then(function(r){return r.json();})
.then(function(j){
document.getElementById('${uid}').querySelector('.dgf-wrap').innerHTML='<div class="dgf-ok"><div class="dgf-ok-icon"><svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="${btnTxt}" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div><p class="dgf-ok-msg">'+(j.message||'Thank you!')+'</p></div>';
if(${redir})setTimeout(function(){location.href=${redir};},2000);
})
.catch(function(){btn.disabled=false;btn.textContent='${esc(label)}';alert('Submission failed. Please try again.');});
});
})();
<\/script>
</div>`;
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-headline font-bold text-[#111318] text-[16px]">Custom Forms</h2>
          <p className="text-[14px] text-[#6b7280] mt-0.5">
            {forms.length} forms · {totalSubmissions.toLocaleString()} submissions
          </p>
        </div>
        {canManageForms && (
          <Button onClick={() => navigate('/lead-generation/custom-forms/new')}>
            <Plus className="w-4 h-4" /> Create Form
          </Button>
        )}
      </div>

      {loading && (
        <div className="text-center py-16 text-[#6b7280] text-[15px]">Loading forms…</div>
      )}

      {!loading && forms.length === 0 && (
        <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow px-8 py-16 text-center">
          <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-7 h-7 text-primary" />
          </div>
          <h3 className="font-headline font-bold text-[#111318] text-[16px] mb-1">No forms yet</h3>
          <p className="text-[15px] text-[#6b7280] mb-5 max-w-xs mx-auto">
            Create your first form and start capturing leads from your website or landing pages.
          </p>
          {canManageForms && (
            <Button onClick={() => navigate('/lead-generation/custom-forms/new')}>
              <Plus className="w-4 h-4" /> Create your first form
            </Button>
          )}
        </div>
      )}

      {!loading && forms.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.map((form) => (
            <div
              key={form.id}
              className="group bg-white rounded-2xl border border-[var(--hairline)] card-shadow card-hover flex flex-col hover:-translate-y-0.5 transition-all duration-200"
            >
              {/* Card body - opens submissions panel */}
              <div
                className="flex-1 p-5 cursor-pointer"
                onClick={() => openPanel(form)}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-[#111318] text-[16px] truncate group-hover:text-primary transition-colors">
                        {form.name}
                      </h4>
                      <p className="text-[12px] text-[#6b7280] mt-0.5 truncate">
                        {form.pipeline_name
                          ? `${form.pipeline_name}${form.stage_name ? ` → ${form.stage_name}` : ''}`
                          : 'No pipeline'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 bg-[var(--surface-2)] border border-[var(--hairline)] rounded-full px-2 py-1 shrink-0">
                    <Users className="w-3 h-3 text-[#6b7280]" />
                    <span className="text-[14px] font-bold text-[#111318]">
                      {(form.submission_count ?? 0).toLocaleString()}
                    </span>
                  </div>
                </div>
                <p className="text-[12px] text-[#6b7280] leading-relaxed line-clamp-2">
                  {form.slug ? getShareLink(form) : ''}
                </p>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-1 px-4 py-3 border-t border-[var(--hairline)]">
                <button
                  onClick={(e) => copyFormLink(e, form)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 transition-colors"
                >
                  <Link className="w-3 h-3" /> {copiedFormId === form.id ? 'Copied' : 'Copy Link'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setEmbedFormId(form.id); }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100 transition-colors"
                >
                  <Code2 className="w-3 h-3" /> Embed
                </button>
                <div className="flex-1" />
                {canManageForms && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCloneTarget(form); }}
                    className="p-1.5 rounded-lg text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)] hover:text-primary transition-colors"
                    title="Clone"
                  ><Copy className="w-3.5 h-3.5" /></button>
                )}
                {canManageForms && (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/lead-generation/custom-forms/${form.id}`); }}
                    className="p-1.5 rounded-lg text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)] hover:text-primary transition-colors"
                    title="Edit"
                  ><Pencil className="w-3.5 h-3.5" /></button>
                )}
                {canDeleteForms && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(form); }}
                    className="p-1.5 rounded-lg text-[#6b7280] border border-[var(--hairline)] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                    title="Delete"
                  ><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            </div>
          ))}

          {/* New form card */}
          {canManageForms && (
            <button
              onClick={() => navigate('/lead-generation/custom-forms/new')}
              className="group bg-white rounded-2xl border border-dashed border-[var(--hairline)] p-5 flex flex-col items-center justify-center gap-2 text-center hover:border-primary hover:bg-primary/5 transition-all duration-200 min-h-[140px]"
            >
              <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <Plus className="w-4 h-4 text-primary" />
              </div>
              <span className="text-[15px] font-semibold text-[#6b7280] group-hover:text-primary transition-colors">New Form</span>
            </button>
          )}
        </div>
      )}

      {/* ── Submissions Side Panel ─────────────────────────────────────────── */}
      {panelForm && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={closePanel}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30" />

          {/* Panel */}
          <div
            className="relative z-50 w-full max-w-[420px] bg-white h-full flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)] flex items-center gap-3">
              <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-headline font-bold text-[#111318] text-[16px] truncate">{panelForm.name}</h3>
                <p className="text-[12px] text-[#6b7280]">
                  {submissions.length} submission{submissions.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => navigate(`/lead-generation/custom-forms/${panelForm.id}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--accent-tint)] text-primary hover:bg-primary/20 transition-colors shrink-0"
              >
                <Pencil className="w-3 h-3" /> Edit Form
              </button>
              <button onClick={closePanel} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280] hover:text-primary transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Stats bar */}
            <div className="shrink-0 px-5 py-3 bg-[var(--app-bg)] border-b border-[var(--hairline)] flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#6b7280]" />
                <span className="text-[14px] font-semibold text-[#111318]">{panelForm.submission_count} total</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#6b7280]" />
                <span className="text-[14px] text-[#6b7280]">
                  {panelForm.pipeline_name
                    ? `${panelForm.pipeline_name}${panelForm.stage_name ? ` → ${panelForm.stage_name}` : ''}`
                    : 'No pipeline'}
                </span>
              </div>
            </div>

            {/* Submissions list */}
            <div className="flex-1 overflow-y-auto">
              {subLoading && (
                <div className="py-16 text-center text-[15px] text-[#6b7280]">Loading submissions…</div>
              )}

              {!subLoading && submissions.length === 0 && (
                <div className="py-16 text-center px-6">
                  <div className="w-12 h-12 bg-[var(--accent-tint)] rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <p className="text-[16px] font-semibold text-[#111318] mb-1">No submissions yet</p>
                  <p className="text-[14px] text-[#6b7280]">
                    Share the form link to start collecting responses.
                  </p>
                  <button
                    onClick={() => { copyToClipboard(getShareLink(panelForm)); toast.success('Link copied!'); }}
                    className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl text-[14px] font-semibold bg-primary text-white mx-auto hover:bg-primary/90 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy Form Link
                  </button>
                </div>
              )}

              {!subLoading && submissions.length > 0 && (
                <div>
                  {submissions.map((sub) => (
                    <SubmissionRow key={sub.id} sub={sub} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {!subLoading && submissions.length > 0 && (
              <div className="shrink-0 px-5 py-3 border-t border-[var(--hairline)] bg-[var(--app-bg)]">
                <button
                  onClick={() => { copyToClipboard(getShareLink(panelForm)); toast.success('Link copied!'); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[14px] font-semibold border border-[var(--hairline)] text-[#6b7280] hover:bg-white hover:text-primary transition-colors"
                >
                  <Link className="w-3.5 h-3.5" /> Copy Form Link
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share Link Modal */}
      {shareLinkForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl border border-[var(--hairline)] w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
              <div>
                <h3 className="font-headline font-bold text-[#111318]">Share "{shareLinkForm.name}"</h3>
                <p className="text-[12px] text-[#6b7280] mt-0.5">Public link to this form</p>
              </div>
              <button onClick={() => setShareLinkFormId(null)} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280] hover:text-primary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                <Link className="w-4 h-4 text-amber-500 shrink-0" />
                <p className="text-[14px] text-amber-700 font-medium flex-1 break-all">{getShareLink(shareLinkForm)}</p>
              </div>
              <p className="text-[14px] text-[#6b7280]">Share this link via email, WhatsApp, or social media.</p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--hairline)]">
              <Button variant="outline" onClick={() => setShareLinkFormId(null)}>Close</Button>
              <Button onClick={() => { copyToClipboard(getShareLink(shareLinkForm)); toast.success('Link copied!'); }}>
                <Copy className="w-4 h-4" /> Copy Link
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-[var(--hairline)] w-full max-w-sm shadow-2xl">
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-headline font-bold text-[#111318] text-[16px]">Delete this form?</h3>
              <p className="text-[15px] text-[#6b7280] mt-2">
                <span className="font-semibold text-[#111318]">"{deleteTarget.name}"</span> will be permanently deleted.
              </p>
              {(deleteTarget.submission_count ?? 0) > 0 && (
                <p className="text-[12px] text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3">
                  This form has <span className="font-bold">{deleteTarget.submission_count} submission{deleteTarget.submission_count !== 1 ? 's' : ''}</span> - it will be deactivated instead of deleted.
                </p>
              )}
            </div>
            <div className="flex gap-2 px-6 py-5">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--surface-2)] transition active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-[15px] font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 transition active:scale-[0.98]"
              >
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clone Confirm Modal */}
      {cloneTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-[var(--hairline)] w-full max-w-sm shadow-2xl">
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Copy className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-headline font-bold text-[#111318] text-[16px]">Clone this form?</h3>
              <p className="text-[15px] text-[#6b7280] mt-2">
                A copy of <span className="font-semibold text-[#111318]">"{cloneTarget.name}"</span> will be created with all fields and settings intact.
              </p>
              <p className="text-[12px] text-[#9ca3af] mt-1.5">
                It will be named <span className="font-medium text-[#6b7280]">"{cloneTarget.name} (Copy)"</span>
              </p>
            </div>
            <div className="flex gap-2 px-6 py-5">
              <button
                onClick={() => setCloneTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--surface-2)] transition active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={handleClone}
                disabled={cloning}
                className="flex-1 py-2.5 rounded-xl text-[15px] font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition active:scale-[0.98]"
              >
                {cloning ? 'Cloning…' : 'Yes, Clone it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embed Code Modal */}
      {embedForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl border border-[var(--hairline)] w-full max-w-xl shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
              <div>
                <h3 className="font-headline font-bold text-[#111318]">Embed "{embedForm.name}"</h3>
                <p className="text-[12px] text-[#6b7280] mt-0.5">Copy and paste into your website</p>
              </div>
              <button
                onClick={() => { setEmbedFormId(null); setEmbedTab('iframe'); }}
                className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280] hover:text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-6 pt-4">
              {(['iframe', 'html'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setEmbedTab(tab)}
                  className={`px-4 py-1.5 rounded-full text-[14px] font-semibold transition active:scale-[0.98] ${
                    embedTab === tab
                      ? 'bg-primary text-white'
                      : 'bg-[var(--surface-2)] text-[#6b7280] hover:text-[#111318]'
                  }`}
                >
                  {tab === 'iframe' ? 'iFrame' : 'HTML Code'}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="px-6 py-4 space-y-3">
              {embedTab === 'iframe' ? (
                <>
                  <p className="text-[14px] text-[#6b7280]">
                    Paste this wherever you want the form to appear. Works in any CMS (WordPress, Webflow, Wix, etc.).
                  </p>
                  <div className="relative">
                    <pre className="bg-[var(--surface-2)] rounded-xl p-4 text-[13px] font-mono text-[#111318] overflow-x-auto border border-[var(--hairline)] whitespace-pre-wrap break-all">
                      {getIframeCode(embedForm)}
                    </pre>
                    <button
                      onClick={() => { copyToClipboard(getIframeCode(embedForm)); toast.success('iFrame code copied'); }}
                      className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white border border-[var(--hairline)] hover:bg-[var(--accent-tint)] text-[#6b7280] hover:text-primary transition-colors"
                    ><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                  <p className="text-[12px] text-[#9ca3af]">
                    Always shows the latest version of your form - no re-embedding needed after edits.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[14px] text-[#6b7280]">
                    Paste anywhere on your page - no external JS required. Fields, colors and styles match your form exactly.
                  </p>
                  <div className="relative">
                    <pre className="bg-[var(--surface-2)] rounded-xl p-4 text-[13px] font-mono text-[#111318] overflow-x-auto border border-[var(--hairline)] max-h-64 whitespace-pre-wrap break-all">
                      {generateHTMLSnippet(embedForm)}
                    </pre>
                    <button
                      onClick={() => { copyToClipboard(generateHTMLSnippet(embedForm)); toast.success('HTML code copied'); }}
                      className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white border border-[var(--hairline)] hover:bg-[var(--accent-tint)] text-[#6b7280] hover:text-primary transition-colors"
                    ><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                  <p className="text-[12px] text-[#9ca3af]">
                    Fields are baked into the code. Re-copy after editing your form to get updated code.
                  </p>
                </>
              )}
            </div>

            <div className="flex justify-end px-6 py-4 border-t border-[var(--hairline)]">
              <Button onClick={() => { setEmbedFormId(null); setEmbedTab('iframe'); }}>Done</Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
