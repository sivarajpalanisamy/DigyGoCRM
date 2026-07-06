import { useState, useMemo, useEffect } from 'react';
import {
  Users, UserCheck, UserPlus, Phone, Mail, MoreVertical, User,
  MessageCircle, Pencil, Trash2, ArrowRightLeft, Filter, X, Download,
  ChevronDown, Tag, FileText, Loader2, Zap, Settings, History, ExternalLink,
} from 'lucide-react';
import { useCrmStore } from '@/store/crmStore';
import { usePermission } from '@/hooks/usePermission';
import { useDebounce } from '@/hooks/useDebounce';
import { useHeaderSearch } from '@/store/headerSearchStore';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { api } from '@/lib/api';
import { ExportModal } from '@/components/ui/ExportModal';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Lead } from '@/data/mockData';
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal';
import { LeadDetailPanel } from './LeadsPage';

function getSourceLabel(lead: { source: string; meta_form_name?: string }) {
  const s = lead.source ?? '';
  if (s.startsWith('calendar:')) return s.slice(9);
  if (s.startsWith('form:'))     return s.slice(5);
  if (s === 'calendar_booking')  return 'Calendar Booking';
  if (s === 'Custom Form')       return 'Custom Form';
  if (s === 'meta_form') return lead.meta_form_name ? `Meta · ${lead.meta_form_name}` : 'Meta Form';
  if (s === 'whatsapp' || s === 'WhatsApp') return 'WhatsApp';
  if (s === 'Landing Page') return 'Landing Page';
  return s || 'Manual';
}

function getSourceColor(source: string) {
  const s = source ?? '';
  if (s.startsWith('calendar:') || s === 'calendar_booking') return 'bg-teal-50 text-teal-600 border border-teal-200';
  if (s.startsWith('form:') || s === 'Custom Form')          return 'bg-purple-50 text-purple-600 border border-purple-200';
  if (s === 'meta_form')    return 'bg-blue-50 text-blue-600 border border-blue-200';
  if (s === 'whatsapp' || s === 'WhatsApp') return 'bg-green-50 text-green-600 border border-green-200';
  if (s === 'Manual')       return 'bg-gray-100 text-gray-600 border border-gray-200';
  if (s === 'Landing Page') return 'bg-amber-50 text-amber-600 border border-amber-200';
  return 'bg-gray-100 text-gray-600 border border-gray-200';
}

const SOURCE_COLORS: Record<string, string> = {
  'meta_form':        'bg-blue-50 text-blue-600 border border-blue-200',
  'Meta Forms':       'bg-blue-50 text-blue-600 border border-blue-200',
  'WhatsApp':         'bg-green-50 text-green-600 border border-green-200',
  'whatsapp':         'bg-green-50 text-green-600 border border-green-200',
  'Custom Form':      'bg-purple-50 text-purple-600 border border-purple-200',
  'Manual':           'bg-gray-100 text-gray-600 border border-gray-200',
  'Landing Page':     'bg-amber-50 text-amber-600 border border-amber-200',
  'calendar_booking': 'bg-teal-50 text-teal-600 border border-teal-200',
};

const TYPE_OPTIONS = ['All', 'Lead', 'Customer'] as const;
const DATE_OPTIONS = ['All time', 'Today', 'This week', 'This month', 'Last 30 days', 'Custom range'] as const;

// ─── Contact Detail Modal ──────────────────────────────────────────────────────
function ContactDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { pipelines, updateLead } = useCrmStore();
  const [fields, setFields] = useState<{ field_name: string; field_type: string; slug: string; value: string }[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [activeTab, setActiveTab] = useState<'opportunity' | 'additional' | 'journey'>('opportunity');
  const [saving, setSaving] = useState(false);
  const [journey, setJourney] = useState<{ enquiries: any[]; leads: any[] } | null>(null);
  const [loadingJourney, setLoadingJourney] = useState(false);

  const [form, setForm] = useState({
    opportunityName: `${lead.firstName} ${lead.lastName}`,
    contactName: `${lead.firstName} ${lead.lastName}`,
    email: lead.email,
    phone: lead.phone,
    city: '',
    pipelineId: lead.pipelineId,
    stageId: lead.stageId,
  });

  useEffect(() => {
    const loadFields = async () => {
      let data = await api.get<any[]>(`/api/leads/${lead.id}/fields`).catch(() => [] as any[]);
      // Auto-backfill: if empty and this is a meta_form lead, trigger backfill then re-fetch
      if (data.length === 0 && lead.source === 'meta_form') {
        try {
          const fullLead = await api.get<any>(`/api/leads/${lead.id}`);
          if (fullLead?.meta_form_id) {
            await api.post(`/api/integrations/meta/forms/${fullLead.meta_form_id}/backfill`);
            data = await api.get<any[]>(`/api/leads/${lead.id}/fields`).catch(() => [] as any[]);
          }
        } catch { /* ignore - backfill is best-effort */ }
      }
      setFields(data);
    };
    loadFields().finally(() => setLoadingFields(false));
  }, [lead.id, lead.source]);

  useEffect(() => {
    if (activeTab !== 'journey' || journey) return;
    setLoadingJourney(true);
    api.get<{ enquiries: any[]; leads: any[] }>(`/api/contacts/journey/by-lead/${lead.id}`)
      .then(setJourney)
      .catch(() => setJourney({ enquiries: [], leads: [] }))
      .finally(() => setLoadingJourney(false));
  }, [activeTab, lead.id, journey]);

  const selectedPipeline = pipelines.find((p) => p.id === form.pipelineId);
  const selectedStages = selectedPipeline?.stages ?? [];

  const handleSave = async () => {
    setSaving(true);
    try {
      const [firstName, ...rest] = form.contactName.trim().split(' ');
      const lastName = rest.join(' ');
      await api.patch(`/api/leads/${lead.id}`, {
        name: form.contactName,
        email: form.email,
        phone: form.phone,
        pipeline_id: form.pipelineId,
        stage_id: form.stageId,
      });
      updateLead(lead.id, {
        firstName: firstName ?? form.contactName,
        lastName,
        email: form.email,
        phone: form.phone,
        pipelineId: form.pipelineId,
        stageId: form.stageId,
        stage: selectedStages.find((s) => s.id === form.stageId)?.name ?? lead.stage,
      });
      toast.success('Contact updated');
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-[#1c1410] placeholder-gray-300 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all bg-white';
  const labelCls = 'block text-[13px] font-medium text-[#555] mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-[17px] text-[#1c1410]">+ Edit Contact</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Tab buttons */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTab('opportunity')}
              className="px-5 py-2 rounded-lg text-[14px] font-bold text-white transition-all"
              style={{
                background: activeTab === 'opportunity'
                  ? 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 100%)'
                  : '#e5e7eb',
                color: activeTab === 'opportunity' ? '#fff' : '#555',
              }}
            >
              Opportunity
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('additional')}
              className="px-5 py-2 rounded-lg text-[14px] font-bold transition-all"
              style={{
                background: activeTab === 'additional'
                  ? 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 100%)'
                  : '#e5e7eb',
                color: activeTab === 'additional' ? '#fff' : '#555',
              }}
            >
              Additional Data
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('journey')}
              className="px-5 py-2 rounded-lg text-[14px] font-bold transition-all flex items-center gap-1.5"
              style={{
                background: activeTab === 'journey'
                  ? 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 100%)'
                  : '#e5e7eb',
                color: activeTab === 'journey' ? '#fff' : '#555',
              }}
            >
              <History className="w-3.5 h-3.5" />
              Journey
            </button>
          </div>

          {/* ── Opportunity tab ── */}
          {activeTab === 'opportunity' && (
            <>
              <h3 className="font-bold text-[15px] text-[#1c1410]">Contact Info</h3>

              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                <div>
                  <label className={labelCls}>Opportunity Name <span className="text-red-500">*</span></label>
                  <input
                    value={form.opportunityName}
                    onChange={(e) => setForm((f) => ({ ...f, opportunityName: e.target.value }))}
                    placeholder="Add Opportunity Name"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Contact Name <span className="text-red-500">*</span></label>
                  <input
                    value={form.contactName}
                    onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                    placeholder="Contact Name"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="Email"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Phone</label>
                  <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
                    <span className="px-3 py-2.5 text-[13px] font-semibold text-[#555] bg-gray-50 border-r border-gray-200 shrink-0 whitespace-nowrap">
                      IN +91
                    </span>
                    <input
                      value={form.phone.replace(/^\+?91/, '')}
                      onChange={(e) => setForm((f) => ({ ...f, phone: '+91' + e.target.value.replace(/\D/g, '') }))}
                      placeholder="81234 56789"
                      className="flex-1 px-3 py-2.5 text-[14px] text-[#1c1410] placeholder-gray-300 outline-none bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>City</label>
                  <input
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="City"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Pipeline <span className="text-red-500">*</span></label>
                  <select
                    value={form.pipelineId}
                    onChange={(e) => {
                      const first = pipelines.find((p) => p.id === e.target.value)?.stages[0]?.id ?? '';
                      setForm((f) => ({ ...f, pipelineId: e.target.value, stageId: first }));
                    }}
                    className={cn(inputCls, 'cursor-pointer appearance-none')}
                  >
                    <option value="">- Select pipeline -</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Stage <span className="text-red-500">*</span></label>
                  <select
                    value={form.stageId}
                    onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
                    className={cn(inputCls, 'cursor-pointer appearance-none')}
                  >
                    <option value="">- Select stage -</option>
                    {selectedStages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Created At</label>
                  <input
                    readOnly
                    value={format(new Date(lead.createdAt), 'dd-MM-yyyy HH:mm')}
                    className={cn(inputCls, 'bg-gray-50 cursor-default text-[#7a6b5c]')}
                  />
                </div>
              </div>
            </>
          )}

          {/* ── Additional Data tab ── */}
          {activeTab === 'additional' && (
            <div>
              {loadingFields ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : fields.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <div className="w-12 h-12 bg-[var(--app-bg)] rounded-2xl flex items-center justify-center">
                    <FileText className="w-5 h-5 text-gray-300" />
                  </div>
                  <p className="text-[14px] font-semibold text-[#1c1410]">No additional fields</p>
                  <p className="text-[13px] text-[#b09e8d]">No custom field data recorded for this contact.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                  {fields.map((f, i) => (
                    <div key={i}>
                      <label className={labelCls}>{f.field_name}</label>
                      <input
                        readOnly
                        value={f.value || '-'}
                        className={cn(inputCls, 'bg-gray-50 cursor-default text-[#7a6b5c]')}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Journey tab ── */}
          {activeTab === 'journey' && (
            <div>
              {loadingJourney ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : !journey || (journey.enquiries.length === 0 && journey.leads.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <div className="w-12 h-12 bg-[var(--app-bg)] rounded-2xl flex items-center justify-center">
                    <History className="w-5 h-5 text-gray-300" />
                  </div>
                  <p className="text-[14px] font-semibold text-[#1c1410]">No journey data</p>
                  <p className="text-[13px] text-[#b09e8d]">No enquiry history recorded for this contact yet.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Summary */}
                  <div className="flex items-center gap-4 p-3 bg-[var(--app-bg,#faf8f6)] rounded-xl">
                    <div className="text-center">
                      <p className="text-[18px] font-bold text-[#1c1410]">{journey.enquiries.length}</p>
                      <p className="text-[11px] text-[#7a6b5c]">Enquiries</p>
                    </div>
                    <div className="w-px h-8 bg-gray-200" />
                    <div className="text-center">
                      <p className="text-[18px] font-bold text-[#1c1410]">{journey.leads.length}</p>
                      <p className="text-[11px] text-[#7a6b5c]">Pipelines</p>
                    </div>
                    <div className="w-px h-8 bg-gray-200" />
                    <div className="text-center">
                      <p className="text-[18px] font-bold text-[#1c1410]">
                        {journey.enquiries.length > 0
                          ? format(new Date(journey.enquiries[journey.enquiries.length - 1].created_at), 'dd MMM yyyy')
                          : '-'}
                      </p>
                      <p className="text-[11px] text-[#7a6b5c]">First seen</p>
                    </div>
                  </div>

                  {/* Active leads across pipelines */}
                  {journey.leads.length > 0 && (
                    <div>
                      <h4 className="text-[13px] font-semibold text-[#7a6b5c] uppercase tracking-wide mb-2">Active Leads</h4>
                      <div className="space-y-2">
                        {journey.leads.map((l: any) => (
                          <div key={l.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl">
                            <div>
                              <p className="text-[14px] font-semibold text-[#1c1410]">{l.pipeline_name || 'No pipeline'}</p>
                              <p className="text-[11px] text-[#7a6b5c]">
                                Stage: {l.stage_name || '-'}
                                {l.assigned_name ? ` · Assigned: ${l.assigned_name}` : ''}
                                {l.lead_quality ? ` · ${l.lead_quality}` : ''}
                              </p>
                            </div>
                            <span className="text-[11px] text-[#b09e8d]">{format(new Date(l.created_at), 'dd MMM yyyy')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Enquiry timeline */}
                  {journey.enquiries.length > 0 && (
                    <div>
                      <h4 className="text-[13px] font-semibold text-[#7a6b5c] uppercase tracking-wide mb-2">Enquiry Timeline</h4>
                      <div className="relative pl-4 border-l-2 border-gray-200 space-y-4">
                        {journey.enquiries.map((e: any) => (
                          <div key={e.id} className="relative">
                            <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white"
                              style={{ backgroundColor: e.is_duplicate ? '#f59e0b' : 'var(--brand, #c2410c)' }} />
                            <div className="p-3 bg-white border border-gray-100 rounded-xl">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[14px] font-semibold text-[#1c1410]">
                                  {e.form_name || e.form_type}
                                </span>
                                <span className="text-[11px] text-[#b09e8d]">
                                  {format(new Date(e.created_at), 'dd MMM yyyy, hh:mm a')}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn(
                                  'px-2 py-0.5 rounded-full text-[10px] font-medium',
                                  e.form_type === 'meta_form' ? 'bg-blue-50 text-blue-600' :
                                  e.form_type === 'custom_form' ? 'bg-purple-50 text-purple-600' :
                                  e.form_type === 'landing_page' ? 'bg-amber-50 text-amber-600' :
                                  'bg-gray-100 text-gray-600'
                                )}>
                                  {e.form_type === 'meta_form' ? 'Meta Form' :
                                   e.form_type === 'custom_form' ? 'Custom Form' :
                                   e.form_type === 'landing_page' ? 'Landing Page' :
                                   e.form_type}
                                </span>
                                {e.pipeline_name && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                                    {e.pipeline_name}{e.stage_name ? ` → ${e.stage_name}` : ''}
                                  </span>
                                )}
                                {e.is_duplicate && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-600">
                                    Re-enquiry
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-[#7a6b5c]">
            Created On: {format(new Date(lead.createdAt), 'dd/MM/yyyy hh:mm aa').toUpperCase()}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-lg text-[14px] font-bold text-white bg-red-400 hover:bg-red-500 transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 rounded-lg text-[14px] font-bold text-white transition-colors disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 100%)' }}
            >
              {saving ? 'SAVING…' : 'SAVE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Workflow Trigger Modal ──────────────────────────────────────────────────
function WorkflowTriggerModal({ leadIds, workflows, onClose, onSuccess }: {
  leadIds: string[];
  workflows: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const activeWorkflows = workflows.filter((w) => w.status === 'active');
  const [selected, setSelected] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!selected) { toast.error('Please select a workflow'); return; }
    const wf = activeWorkflows.find((w) => w.id === selected);
    setSending(true);
    try {
      await api.post(`/api/workflows/${selected}/bulk-trigger`, { lead_ids: leadIds });
      toast.success(`${leadIds.length} contact${leadIds.length !== 1 ? 's' : ''} pushed to "${wf?.name}" - automation is executing`);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to trigger workflow');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5">
          <h3 className="font-bold text-[17px] text-[#1c1410]">Trigger Workflow</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"><X className="w-4 h-4 text-[#7a6b5c]" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <label className="text-[14px] font-semibold text-[#1c1410] block">Select Active Workflow</label>
          <div className="relative">
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] text-[#1c1410] outline-none focus:border-primary/40 bg-white appearance-none pr-10">
              <option value="">- Choose a workflow -</option>
              {activeWorkflows.map((wf) => <option key={wf.id} value={wf.id}>{wf.name}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
          {activeWorkflows.length === 0 && (
            <p className="text-[13px] text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              No active workflows found. Set a workflow to Active in Automation first.
            </p>
          )}
          <p className="text-[13px] text-blue-500 flex items-start gap-1.5 pt-1">
            <Settings className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {leadIds.length} contact{leadIds.length !== 1 ? 's' : ''} selected - all will be pushed through the chosen workflow.
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5">
          <button onClick={onClose} className="px-6 py-2 rounded-lg bg-gray-200 text-[14px] font-bold text-gray-600 hover:bg-gray-300 transition-colors uppercase tracking-wide">Close</button>
          <button onClick={send} disabled={sending || !selected} className="px-6 py-2 rounded-lg bg-green-500 text-[14px] font-bold text-white hover:bg-green-600 disabled:opacity-50 transition-colors uppercase tracking-wide">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Map an /api/leads row to the Lead shape the contacts table renders.
function mapContactRow(l: any): Lead {
  const parts = (l.name ?? '').split(' ');
  return {
    id: l.id,
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' ') ?? '',
    email: l.email ?? '',
    phone: l.phone ?? '',
    stage: l.stage_name ?? '',
    stageId: l.stage_id ?? '',
    pipelineId: l.pipeline_id ?? '',
    source: l.source ?? 'Manual',
    tags: l.tags ?? [],
    assignedTo: l.assigned_to ?? '',
    assignedName: l.assigned_name ?? '',
    createdAt: l.created_at ?? new Date().toISOString(),
    lastActivity: l.updated_at ?? l.created_at ?? new Date().toISOString(),
    businessName: '',
    city: '',
    notes: l.notes ?? '',
    dealValue: Number(l.deal_value ?? 0),
    value: 0,
    probability: 0,
    nextFollowUp: null,
    customFields: [],
    leadQuality: l.custom_fields?.lead_quality ?? '',
  } as Lead;
}

export default function ContactsPage() {
  const { pipelines, staff, updateLead, deleteLead, workflows } = useCrmStore();
  // Contacts are leads; fetch them server-side (cursor, capped, server search) so
  // the page doesn't depend on the whole leads array being in the store.
  const [apiContacts, setApiContacts] = useState<Lead[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [reloadContacts, setReloadContacts] = useState(0);
  // Live-refresh the list when contacts/leads change anywhere (no manual reload).
  useLiveRefresh(() => setReloadContacts((n) => n + 1), ['leads', 'contacts']);
  const canEditContact   = usePermission('leads:edit');
  const canDeleteContact = usePermission('leads:delete');
  const canExport        = usePermission('contacts:export');
  // Search lives in the navbar (context-aware header search).
  const [search, setSearch] = useHeaderSearch('Search name, email or phone');
  const debouncedSearch = useDebounce(search, 300);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState<typeof TYPE_OPTIONS[number]>('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [pipelineFilter, setPipelineFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState<typeof DATE_OPTIONS[number]>('All time');
  const [customFrom, setCustomFrom] = useState('');  // yyyy-MM-dd
  const [customTo, setCustomTo] = useState('');      // yyyy-MM-dd
  const [showFilters, setShowFilters] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const selectedContact = apiContacts.find((l) => l.id === selectedContactId) ?? null;
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);

  // Stats + facets come from the server (view-scoped) so the page doesn't depend
  // on every lead being in memory. Re-fetched when the lead set changes (socket /
  // poll bumps leads.length), so counts stay fresh.
  const [summary, setSummary] = useState<{ total: number; active: number; newThisMonth: number; whatsapp: number; sources: string[]; tags: string[] }>(
    { total: 0, active: 0, newThisMonth: 0, whatsapp: 0, sources: [], tags: [] },
  );
  useEffect(() => {
    api.get<typeof summary>('/api/leads/summary')
      .then((d) => setSummary({
        total: d.total ?? 0, active: d.active ?? 0, newThisMonth: d.newThisMonth ?? 0,
        whatsapp: d.whatsapp ?? 0, sources: d.sources ?? [], tags: d.tags ?? [],
      }))
      .catch(() => {});
  }, [reloadContacts]);

  // Fetch contacts (= leads) server-side: cursor-paginated, capped, server search.
  // Client-side facet filters below run on this loaded set (cap covers all but the
  // largest tenants; a search narrows the set server-side).
  useEffect(() => {
    let cancelled = false;
    setContactsLoading(true);
    const t = setTimeout(async () => {
      try {
        const MAX = 3000;
        let rows: any[] = [];
        let cursor = '';
        while (true) {
          const p = new URLSearchParams({ after: cursor, limit: '2000' });
          if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim());
          const data = await api.get<{ leads: any[]; nextCursor: string | null }>(`/api/leads?${p}`);
          if (cancelled) return;
          rows = [...rows, ...data.leads];
          if (!data.nextCursor || rows.length >= MAX) break;
          cursor = data.nextCursor;
        }
        setApiContacts(rows.map(mapContactRow));
      } catch { /* keep previous */ }
      if (!cancelled) setContactsLoading(false);
    }, debouncedSearch ? 0 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [debouncedSearch, reloadContacts]);

  const allSources = useMemo(() => ['All', ...summary.sources], [summary.sources]);
  const allTags = useMemo(() => ['All', ...summary.tags], [summary.tags]);
  const totalContacts = summary.total;
  const activeContacts = summary.active;
  const newThisMonth = summary.newThisMonth;
  const whatsappContacts = summary.whatsapp;

  const statCards = [
    { label: 'Total Contacts', value: totalContacts, icon: Users, color: 'text-primary' },
    { label: 'Active', value: activeContacts, icon: UserCheck, color: 'text-emerald-500' },
    { label: 'New This Month', value: newThisMonth, icon: UserPlus, color: 'text-purple-500' },
    { label: 'Via WhatsApp', value: whatsappContacts, icon: Phone, color: 'text-primary' },
  ];

  const filtered = useMemo(() => {
    const now = new Date();
    return apiContacts.filter((l) => {
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase();
        if (!(l.firstName.toLowerCase().includes(q) || l.lastName.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) || l.phone.toLowerCase().includes(q))) return false;
      }
      if (sourceFilter !== 'All' && l.source !== sourceFilter) return false;
      if (typeFilter === 'Customer' && l.stage !== 'Closed Won') return false;
      if (typeFilter === 'Lead' && l.stage === 'Closed Won') return false;
      if (tagFilter !== 'All' && !l.tags.includes(tagFilter)) return false;
      if (pipelineFilter !== 'All') {
        if (pipelineFilter === '__none__') { if (l.pipelineId) return false; }
        else if (l.pipelineId !== pipelineFilter) return false;
      }
      if (stageFilter !== 'All' && l.stageId !== stageFilter) return false;
      if (dateFilter !== 'All time') {
        const created = new Date(l.createdAt);
        if (dateFilter === 'Today' && created.toDateString() !== now.toDateString()) return false;
        if (dateFilter === 'This week') {
          const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
          if (created < weekAgo) return false;
        }
        if (dateFilter === 'This month' && (created.getMonth() !== now.getMonth() || created.getFullYear() !== now.getFullYear())) return false;
        if (dateFilter === 'Last 30 days') {
          const d30 = new Date(now); d30.setDate(now.getDate() - 30);
          if (created < d30) return false;
        }
        if (dateFilter === 'Custom range') {
          if (customFrom) { const from = new Date(customFrom + 'T00:00:00'); if (created < from) return false; }
          if (customTo)   { const to   = new Date(customTo   + 'T23:59:59.999'); if (created > to) return false; }
        }
      }
      return true;
    });
  }, [apiContacts, debouncedSearch, sourceFilter, typeFilter, tagFilter, pipelineFilter, stageFilter, dateFilter, customFrom, customTo]);

  const activeFiltersCount = [sourceFilter !== 'All', typeFilter !== 'All', tagFilter !== 'All', pipelineFilter !== 'All', stageFilter !== 'All', dateFilter !== 'All time'].filter(Boolean).length;

  // Client-side pagination - render one page of rows instead of all (thousands of)
  // DOM nodes at once. This is the main fix for the Contacts page being heavy.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, sourceFilter, typeFilter, tagFilter, pipelineFilter, stageFilter, dateFilter, customFrom, customTo, apiContacts.length]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [filtered, safePage]);

  const toggleAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map((l) => l.id));
  const toggleOne = (id: string) => setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const clearFilters = () => { setSourceFilter('All'); setTypeFilter('All'); setTagFilter('All'); setPipelineFilter('All'); setStageFilter('All'); setDateFilter('All time'); setCustomFrom(''); setCustomTo(''); };

  const bulkDelete = async () => {
    let failed = 0;
    await Promise.all(selected.map((id) =>
      api.delete(`/api/leads/${id}`).then(() => deleteLead(id)).catch(() => { failed++; })
    ));
    const done = selected.length - failed;
    if (done > 0) toast.success(`${done} contact${done !== 1 ? 's' : ''} deleted`);
    if (failed > 0) toast.error(`${failed} could not be deleted`);
    setApiContacts((prev) => prev.filter((l) => !selected.includes(l.id)));
    setSelected([]);
    setShowBulkDeleteConfirm(false);
  };

  const deleteSingle = async (id: string) => {
    await api.delete(`/api/leads/${id}`);
    deleteLead(id);
    setApiContacts((prev) => prev.filter((l) => l.id !== id));
    toast.success('Contact deleted');
    setOpenMenu(null);
    setDeleteTargetId(null);
  };

  const selectCls = 'appearance-none pl-3 pr-8 py-2 bg-white border border-black/10 rounded-xl text-[14px] font-medium text-[#1c1410] outline-none hover:border-primary/40 focus:border-primary/40 cursor-pointer';

  return (
    <>
    <div className="space-y-5">

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s, idx) => {
          const isHighlight = idx === statCards.length - 1;
          return isHighlight ? (
            <div key={s.label}
              className="rounded-2xl px-5 py-4 flex items-center gap-4 text-white hover:-translate-y-0.5 transition-all duration-300"
              style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 6px 24px rgba(234,88,12,0.25)' }}>
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <s.icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-[13px] opacity-80">{s.label}</p>
                <h3 className="font-headline text-[22px] font-bold tracking-tight leading-tight">{s.value}</h3>
              </div>
            </div>
          ) : (
            <div key={s.label}
              className="bg-white rounded-2xl px-5 py-4 card-shadow border border-black/5 flex items-center gap-4 hover:-translate-y-0.5 transition-all duration-300">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                <s.icon className={cn('w-5 h-5', s.color)} />
              </div>
              <div>
                <p className="text-[13px] text-[#7a6b5c]">{s.label}</p>
                <h3 className="font-headline text-[22px] font-bold text-[#1c1410] tracking-tight leading-tight">{s.value}</h3>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Search moved to the navbar (context-aware header search). */}

        {/* Type pills */}
        <div className="flex items-center bg-white rounded-xl border border-black/10 p-1 gap-0.5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          {TYPE_OPTIONS.map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={cn('px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
                typeFilter === t ? 'bg-primary text-white shadow-sm' : 'text-[#7a6b5c] hover:text-[#1c1410]'
              )}>
              {t}
            </button>
          ))}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn('flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-[14px] font-medium transition-all',
            showFilters || activeFiltersCount > 0 ? 'border-primary/40 bg-orange-50 text-primary' : 'border-black/10 bg-white text-[#7a6b5c] hover:border-primary/30 hover:text-primary'
          )}
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeFiltersCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">{activeFiltersCount}</span>
          )}
        </button>

        {/* Export */}
        {canExport && (
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-black/10 bg-white text-[14px] font-medium text-[#7a6b5c] hover:border-primary/30 hover:text-primary transition-all"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        )}
      </div>

      {/* Filter dropdowns row */}
      {showFilters && (
        <div className="flex items-center gap-3 flex-wrap animate-fade-in">
          <div className="relative">
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={selectCls} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              {allSources.map((s) => <option key={s} value={s}>{s === 'All' ? 'All Sources' : getSourceLabel({ source: s })}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9a8a7a] pointer-events-none" />
          </div>
          <div className="relative">
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className={selectCls} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              {allTags.map((t) => <option key={t} value={t}>{t === 'All' ? 'All Tags' : t}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9a8a7a] pointer-events-none" />
          </div>
          <div className="relative">
            <select value={pipelineFilter} onChange={(e) => { setPipelineFilter(e.target.value); setStageFilter('All'); }} className={selectCls} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <option value="All">All Pipelines</option>
              <option value="__none__">No Pipeline</option>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9a8a7a] pointer-events-none" />
          </div>
          {pipelineFilter !== 'All' && pipelineFilter !== '__none__' && (() => {
            const stages = pipelines.find((p) => p.id === pipelineFilter)?.stages ?? [];
            return stages.length > 0 ? (
              <div className="relative">
                <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className={selectCls} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                  <option value="All">All Stages</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9a8a7a] pointer-events-none" />
              </div>
            ) : null;
          })()}
          <div className="relative">
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)} className={selectCls} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              {DATE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9a8a7a] pointer-events-none" />
          </div>
          {dateFilter === 'Custom range' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 px-2 text-[13px] rounded-lg border border-black/10 bg-white text-[#1c1410] outline-none focus:border-primary/40"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }} title="From date" />
              <span className="text-[13px] text-[#9a8a7a]">→</span>
              <input type="date" value={customTo} min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 px-2 text-[13px] rounded-lg border border-black/10 bg-white text-[#1c1410] outline-none focus:border-primary/40"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }} title="To date" />
            </div>
          )}
          {activeFiltersCount > 0 && (
            <button onClick={clearFilters} className="text-[13px] text-red-500 font-semibold hover:underline">Clear all</button>
          )}
        </div>
      )}

      {/* Bulk actions bar */}
      {selected.length > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-primary/30 animate-fade-in"
          style={{ background: 'linear-gradient(to right, #faf0e8, #fff)', boxShadow: '0 2px 8px rgba(234,88,12,0.08)' }}
        >
          <div className="flex items-center gap-2 pr-3 border-r border-primary/20">
            <div className="w-6 h-6 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">{selected.length}</div>
            <span className="text-[13px] font-semibold text-[#1c1410]">selected</span>
          </div>
          <button onClick={() => setShowWorkflow(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-primary hover:bg-primary/10 transition-colors">
            <Zap className="w-3.5 h-3.5" /> Trigger Workflow
          </button>
          {canDeleteContact && (
            <button onClick={() => setShowBulkDeleteConfirm(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-red-500 hover:bg-red-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
          <div className="flex-1" />
          <button onClick={() => setSelected([])} className="p-1.5 rounded-lg hover:bg-white transition-colors text-[#7a6b5c]">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {/* Result count */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/[0.04]">
          <p className="text-[13px] text-[#7a6b5c]">
            Showing <span className="font-semibold text-[#1c1410]">{filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)}</span> of {filtered.length}{filtered.length !== totalContacts ? ` (filtered from ${totalContacts})` : ''} contacts
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
                className="px-3 py-1.5 rounded-lg border border-black/10 text-[13px] font-medium text-[#1c1410] disabled:opacity-40 hover:border-primary/40 transition-colors">Prev</button>
              <span className="text-[13px] text-[#7a6b5c]">Page {safePage} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-black/10 text-[13px] font-medium text-[#1c1410] disabled:opacity-40 hover:border-primary/40 transition-colors">Next</button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[14px]">
            <thead>
              <tr className="border-b border-black/5 bg-[var(--app-bg)]">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox"
                    checked={filtered.length > 0 && selected.length === filtered.length}
                    onChange={toggleAll}
                    className="w-4 h-4 accent-primary"
                  />
                </th>
                {['Contact', 'Source', 'Pipeline', 'Tags', 'Type', 'Created', 'Last Activity', ''].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center">
                        <Users className="w-6 h-6 text-[#c4b09e]" />
                      </div>
                      <p className="text-[14px] font-semibold text-[#1c1410]">No contacts found</p>
                      <p className="text-[13px] text-[#7a6b5c]">Try adjusting your search or filters.</p>
                    </div>
                  </td>
                </tr>
              )}
              {paged.map((lead) => {
                const isSelected = selected.includes(lead.id);
                const isCustomer = lead.stage === 'Closed Won';
                return (
                  <tr key={lead.id} className={cn('hover:bg-[var(--app-bg)] transition-colors', isSelected && 'bg-primary/[0.03]')}>

                    <td className="px-4 py-3.5">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(lead.id)} className="w-4 h-4 accent-primary" />
                    </td>

                    {/* Contact - name + email + phone stacked */}
                    <td className="px-4 py-3.5 min-w-[240px]">
                      <div className="flex items-center gap-3 cursor-pointer" onClick={() => setSelectedContactId(lead.id)}>
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                          {lead.firstName[0]}{lead.lastName[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[14px] text-[#1c1410] truncate hover:text-primary transition-colors">{lead.firstName} {lead.lastName}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            {lead.email && <span className="text-[11px] text-[#7a6b5c] truncate max-w-[160px]">{lead.email}</span>}
                            <a href={`tel:${lead.phone}`} className="text-[11px] text-[#7a6b5c] hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>{lead.phone}</a>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Source */}
                    <td className="px-4 py-3.5">
                      <span className={cn('text-[11px] font-medium px-2.5 py-1 rounded-lg whitespace-nowrap', getSourceColor(lead.source))}>
                        {getSourceLabel(lead)}
                      </span>
                    </td>

                    {/* Pipeline */}
                    <td className="px-4 py-3.5">
                      <span className="text-[13px] font-medium text-[#1c1410]">
                        {pipelines.find((p) => p.id === lead.pipelineId)?.name ?? '-'}
                      </span>
                    </td>

                    {/* Tags */}
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {lead.tags.length === 0
                          ? <span className="text-[#c4b09e] text-[11px]">-</span>
                          : lead.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{tag}</span>
                            ))
                        }
                        {lead.tags.length > 2 && <span className="text-[10px] text-[#7a6b5c]">+{lead.tags.length - 2}</span>}
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className={cn(
                        'text-[11px] font-semibold px-2 py-0.5 rounded-full',
                        isCustomer ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-[#7a6b5c]'
                      )}>
                        {isCustomer ? 'Customer' : 'Lead'}
                      </span>
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <p className="text-[13px] text-[#1c1410]">{format(new Date(lead.createdAt), 'dd MMM yyyy')}</p>
                      <p className="text-[11px] text-[#b09e8d]">{format(new Date(lead.createdAt), 'h:mm a')}</p>
                    </td>

                    {/* Last Activity */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <p className="text-[13px] text-[#7a6b5c]">{format(new Date(lead.lastActivity), 'dd MMM yyyy')}</p>
                      <p className="text-[11px] text-[#b09e8d]">{format(new Date(lead.lastActivity), 'h:mm a')}</p>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="relative">
                        <button
                          onClick={() => setOpenMenu(openMenu === lead.id ? null : lead.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#7a6b5c] hover:bg-[var(--accent-tint)] hover:text-primary transition-colors"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {openMenu === lead.id && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setOpenMenu(null)} />
                            <div className="absolute right-0 top-9 z-40 bg-white rounded-xl border border-black/5 shadow-xl w-44 py-1 overflow-hidden">
                              <button
                                onClick={() => { toast.info('Opening conversation…'); setOpenMenu(null); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors"
                              >
                                <MessageCircle className="w-3.5 h-3.5 text-[#7a6b5c]" /> Message
                              </button>
                              {canEditContact && (
                                <button
                                  onClick={() => { toast.info('Edit coming soon'); setOpenMenu(null); }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-[#7a6b5c]" /> Edit
                                </button>
                              )}
                              {canEditContact && (
                                <button
                                  onClick={async () => {
                                    const newStage = isCustomer ? 'Contacted' : 'Closed Won';
                                    const pipeline = pipelines.find((p) => p.id === lead.pipelineId) ?? pipelines[0];
                                    const stageId = pipeline?.stages.find((s) => s.name === newStage)?.id;
                                    try {
                                      await api.patch(`/api/leads/${lead.id}`, stageId ? { stage_id: stageId } : {});
                                      updateLead(lead.id, { stage: newStage, ...(stageId ? { stageId } : {}) });
                                      setApiContacts((prev) => prev.map((c) => c.id === lead.id ? { ...c, stage: newStage, ...(stageId ? { stageId } : {}) } : c));
                                      toast.success(isCustomer ? 'Converted to Lead' : 'Converted to Customer');
                                    } catch { toast.error('Failed to update contact'); }
                                    setOpenMenu(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5 text-[#7a6b5c]" />
                                  {isCustomer ? 'Convert to Lead' : 'Convert to Customer'}
                                </button>
                              )}
                              {canDeleteContact && (
                                <>
                                  <div className="border-t border-black/5 my-1" />
                                  <button
                                    onClick={() => { setDeleteTargetId(lead.id); setOpenMenu(null); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    {selectedContact && <LeadDetailPanel lead={selectedContact} onClose={() => { setSelectedContactId(null); setReloadContacts((n) => n + 1); }} />}

    {showExportModal && (
      <ExportModal
        title="Export Contacts"
        fields={[
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'company', label: 'Company' },
          { key: 'tags', label: 'Tags' },
          { key: 'created_at', label: 'Created At' },
          { key: 'source', label: 'Source' },
          { key: 'lead_status', label: 'Lead Status' },
          { key: 'assigned_name', label: 'Assigned To' },
          { key: 'pipeline_name', label: 'Pipeline' },
          { key: 'stage_name', label: 'Stage' },
          { key: 'lead_quality', label: 'Lead Quality' },
          { key: 'deal_value', label: 'Deal Value' },
          { key: 'last_activity', label: 'Last Activity' },
          { key: 'next_followup_date', label: 'Next Follow-up Date' },
          { key: 'followup_status', label: 'Follow-up Status' },
          { key: 'team_member_names', label: 'Team Members' },
          { key: 'lead_updated_at', label: 'Last Updated' },
          { key: 'notes', label: 'Notes' },
        ]}
        buildUrl={(fields, format) => {
          const p = new URLSearchParams({ fields: fields.join(','), format });
          if (sourceFilter !== 'All') p.set('source', sourceFilter);
          if (tagFilter !== 'All') p.set('tag', tagFilter);
          if (pipelineFilter !== 'All') p.set('pipeline_id', pipelineFilter);
          if (stageFilter !== 'All') p.set('stage_id', stageFilter);
          if (typeFilter !== 'All') p.set('type', typeFilter);
          if (dateFilter !== 'All time') {
            const now = new Date();
            if (dateFilter === 'Today') { const d = now.toISOString().slice(0, 10); p.set('date_from', d); p.set('date_to', d); }
            else if (dateFilter === 'This week') { const w = new Date(now); w.setDate(now.getDate() - 7); p.set('date_from', w.toISOString().slice(0, 10)); }
            else if (dateFilter === 'This month') { p.set('date_from', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`); }
            else if (dateFilter === 'Last 30 days') { const d = new Date(now); d.setDate(now.getDate() - 30); p.set('date_from', d.toISOString().slice(0, 10)); }
            else if (dateFilter === 'Custom range') { if (customFrom) p.set('date_from', customFrom); if (customTo) p.set('date_to', customTo); }
          }
          if (selected.length > 0) p.set('ids', selected.join(','));
          return `/api/contacts/export?${p.toString()}`;
        }}
        filename="contacts"
        onClose={() => setShowExportModal(false)}
      />
    )}

    {showWorkflow && (
      <WorkflowTriggerModal
        leadIds={selected}
        workflows={workflows}
        onClose={() => setShowWorkflow(false)}
        onSuccess={() => { setShowWorkflow(false); setSelected([]); }}
      />
    )}

    {showBulkDeleteConfirm && (
      <ConfirmDeleteModal
        title={`Delete ${selected.length} contact${selected.length !== 1 ? 's' : ''}?`}
        message="This will permanently remove them from the CRM. This cannot be undone."
        confirmLabel="Yes, Delete"
        onConfirm={bulkDelete}
        onClose={() => setShowBulkDeleteConfirm(false)}
      />
    )}

    {deleteTargetId && (() => {
      const lead = apiContacts.find((l) => l.id === deleteTargetId);
      return lead ? (
        <ConfirmDeleteModal
          title="Delete Contact?"
          message={<><span className="font-semibold text-[#1c1410]">{lead.firstName} {lead.lastName}</span> will be permanently removed from the CRM. This cannot be undone.</>}
          confirmLabel="Yes, Delete"
          onConfirm={() => deleteSingle(deleteTargetId)}
          onClose={() => setDeleteTargetId(null)}
        />
      ) : null;
    })()}
    </>
  );
}
