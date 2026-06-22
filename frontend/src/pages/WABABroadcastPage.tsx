import { useState, useEffect, useMemo } from 'react';
import {
  Send, Search, Loader2, X, Check, Users, Megaphone, Calendar,
  Filter, ChevronRight, ArrowLeft, Plus, RefreshCw, CheckCircle2,
  AlertTriangle, Eye, Clock, Mail, MailCheck, MailX, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

// ── Types ────────────────────────────────────────────────────────────────────
interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  created_at?: string;
  pipeline_name?: string;
  stage_name?: string;
}

interface Template {
  id: string;
  name: string;
  meta_name: string;
  language: string;
  body: string;
  header?: string;
  footer?: string;
  status: string;
}

interface Pipeline { id: string; name: string; stages: { id: string; name: string }[]; }
interface Tag { id: string; name: string; color: string; }
interface ContactGroup { id: string; name: string; member_count: number; }

interface BroadcastSummary {
  id: string;
  name: string;
  template_name: string;
  template_meta_name: string;
  total_leads: number;
  sent: number;
  failed: number;
  skipped: number;
  delivered: number;
  read_count: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  created_by_name: string | null;
}

interface BroadcastDetail extends BroadcastSummary {
  template_body: string;
  template_header: string | null;
  template_footer: string | null;
  filters: Record<string, any>;
  error_details: string[];
  delivery_stats: Record<string, number>;
  failure_breakdown: { reason: string; count: number }[];
}

interface BroadcastResult {
  id: string;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
  errors: string[];
}

type View = 'list' | 'create';
type Step = 'leads' | 'template' | 'confirm';

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}M ago`;
}

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

// ── Component ────────────────────────────────────────────────────────────────
export default function WABABroadcastPage() {
  const [view, setView] = useState<View>('list');

  // ── List view state ──
  const [broadcasts, setBroadcasts] = useState<BroadcastSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listSearch, setListSearch] = useState('');
  const [selectedBc, setSelectedBc] = useState<BroadcastDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ── Create wizard state ──
  const [step, setStep] = useState<Step>('leads');
  const [broadcastName, setBroadcastName] = useState('');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [filterPipeline, setFilterPipeline] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);

  // ── Load broadcasts list ──
  const fetchBroadcasts = () => {
    setLoadingList(true);
    const qs = listSearch.trim() ? `?search=${encodeURIComponent(listSearch.trim())}` : '';
    api.get<BroadcastSummary[]>(`/api/conversations/broadcasts${qs}`)
      .then((data) => setBroadcasts(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load broadcasts'))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => { fetchBroadcasts(); }, [listSearch]);

  // Socket listener for real-time broadcast completion
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const handler = () => fetchBroadcasts();
    s.on('broadcast:completed', handler);
    return () => { s.off('broadcast:completed', handler); };
  }, []);

  // ── Load broadcast detail ──
  const loadDetail = (id: string) => {
    setLoadingDetail(true);
    api.get<BroadcastDetail>(`/api/conversations/broadcasts/${id}`)
      .then((data) => setSelectedBc(data))
      .catch(() => toast.error('Failed to load broadcast details'))
      .finally(() => setLoadingDetail(false));
  };

  // ── Create wizard: load filter options ──
  useEffect(() => {
    if (view !== 'create') return;
    Promise.all([
      api.get<Pipeline[]>('/api/pipelines').catch(() => []),
      api.get<Tag[]>('/api/tags').catch(() => []),
      api.get<ContactGroup[]>('/api/contact-groups').catch(() => []),
      api.get<Template[]>('/api/templates?type=waba').catch(() => []),
    ]).then(([p, t, g, tpl]) => {
      setPipelines(Array.isArray(p) ? p : []);
      setTags(Array.isArray(t) ? t : []);
      setGroups(Array.isArray(g) ? g : []);
      setTemplates((Array.isArray(tpl) ? tpl : []).filter((x) => x.meta_name && x.status === 'approved'));
    });
  }, [view]);

  // ── Create wizard: fetch leads on filter change ──
  useEffect(() => {
    if (view !== 'create') return;
    const params = new URLSearchParams();
    if (filterPipeline) params.set('pipeline_id', filterPipeline);
    if (filterStage) params.set('stage_id', filterStage);
    if (filterTag) params.set('tag_id', filterTag);
    if (filterGroup) params.set('group_id', filterGroup);
    if (filterFromDate) params.set('from_date', filterFromDate);
    if (filterToDate) params.set('to_date', filterToDate);
    if (search.trim()) params.set('search', search.trim());

    setLoadingLeads(true);
    const qs = params.toString();
    api.get<Lead[]>(`/api/conversations/broadcast-leads${qs ? `?${qs}` : ''}`)
      .then((data) => setLeads(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load leads'))
      .finally(() => setLoadingLeads(false));
  }, [view, filterPipeline, filterStage, filterTag, filterGroup, filterFromDate, filterToDate, search]);

  useEffect(() => { setFilterStage(''); }, [filterPipeline]);

  const stages = useMemo(() => {
    if (!filterPipeline) return [];
    return pipelines.find((p) => p.id === filterPipeline)?.stages ?? [];
  }, [filterPipeline, pipelines]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selectedIds.size === leads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads.map((l) => l.id)));
  };
  const clearFilters = () => {
    setFilterPipeline(''); setFilterStage(''); setFilterTag(''); setFilterGroup('');
    setFilterFromDate(''); setFilterToDate(''); setSearch('');
  };
  const hasFilters = !!(filterPipeline || filterStage || filterTag || filterGroup || filterFromDate || filterToDate);

  const handleBroadcast = async () => {
    if (!selectedTemplate || selectedIds.size === 0) return;
    setSending(true);
    setResult(null);
    try {
      const res = await api.post<BroadcastResult>('/api/conversations/broadcast', {
        template_id: selectedTemplate.id,
        lead_ids: Array.from(selectedIds),
        name: broadcastName.trim() || undefined,
        filters: { pipeline: filterPipeline, stage: filterStage, tag: filterTag, group: filterGroup, from_date: filterFromDate, to_date: filterToDate },
      });
      setResult(res);
      setStep('confirm');
    } catch (e: any) {
      toast.error(e.message ?? 'Broadcast failed');
    } finally {
      setSending(false);
    }
  };

  const resetWizard = () => {
    setStep('leads'); setSelectedIds(new Set()); setSelectedTemplate(null); setResult(null);
    setBroadcastName(''); clearFilters();
  };

  const goBackToList = () => {
    setView('list');
    resetWizard();
    fetchBroadcasts();
  };

  // ── Wizard steps ──
  const wizardSteps: { key: Step; label: string }[] = [
    { key: 'leads', label: 'Select Leads' },
    { key: 'template', label: 'Select Template' },
    { key: 'confirm', label: 'Confirmation' },
  ];
  const stepIdx = wizardSteps.findIndex((s) => s.key === step);

  // ════════════════════════════════════════════════════════════════════════════
  // CREATE WIZARD VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === 'create') {
    return (
      <div className="space-y-5 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={goBackToList} className="p-1.5 rounded-lg hover:bg-black/5">
            <ArrowLeft className="w-4 h-4 text-[#7a6b5c]" />
          </button>
          <Megaphone className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-headline font-bold text-[#1c1410]">Create Broadcast</h1>
        </div>

        {/* Broadcast Name */}
        <div className="bg-white rounded-2xl border border-black/5 px-4 py-3">
          <label className="text-[11px] font-semibold text-[#7a6b5c] uppercase tracking-wide mb-1 block">Broadcast Name</label>
          <Input value={broadcastName} onChange={(e) => setBroadcastName(e.target.value)}
            placeholder="e.g. Diwali Offer 2026 — leave blank for auto-generated name"
            className="h-9" />
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-0">
          {wizardSteps.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => { if (i < stepIdx) setStep(s.key); }}
                disabled={i > stepIdx}
                className={cn('flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors',
                  i === stepIdx ? 'bg-primary text-white' :
                  i < stepIdx ? 'bg-primary/10 text-primary cursor-pointer hover:bg-primary/20' :
                  'bg-gray-100 text-gray-400 cursor-default'
                )}
              >
                <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                  i === stepIdx ? 'bg-white/20 text-white' :
                  i < stepIdx ? 'bg-primary text-white' : 'bg-gray-200 text-gray-400'
                )}>{i < stepIdx ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
                {s.label}
              </button>
              {i < wizardSteps.length - 1 && (
                <div className={cn('w-12 h-0.5 mx-1', i < stepIdx ? 'bg-primary' : 'bg-gray-200')} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Select Leads */}
        {step === 'leads' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-black/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-[#7a6b5c]" />
                  <span className="text-sm font-semibold text-[#1c1410]">Filter Leads</span>
                </div>
                {hasFilters && (
                  <button onClick={clearFilters} className="text-xs text-primary hover:underline">Clear all</button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <select value={filterPipeline} onChange={(e) => setFilterPipeline(e.target.value)}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:border-primary outline-none">
                  <option value="">All Pipelines</option>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)}
                  disabled={!filterPipeline}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:border-primary outline-none disabled:opacity-50">
                  <option value="">All Stages</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:border-primary outline-none">
                  <option value="">All Tags</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:border-primary outline-none">
                  <option value="">All Contact Groups</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.member_count})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] font-medium text-[#7a6b5c] uppercase tracking-wide mb-0.5 block">Created From</label>
                  <input type="date" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)}
                    max={filterToDate || undefined}
                    className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:border-primary outline-none w-full" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[#7a6b5c] uppercase tracking-wide mb-0.5 block">Created To</label>
                  <input type="date" value={filterToDate} onChange={(e) => setFilterToDate(e.target.value)}
                    min={filterFromDate || undefined}
                    className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:border-primary outline-none w-full" />
                </div>
              </div>
              {hasFilters && (
                <div className="flex flex-wrap gap-2">
                  {filterPipeline && (
                    <Badge className="bg-blue-50 text-blue-700 border-0 gap-1">
                      Pipeline: {pipelines.find((p) => p.id === filterPipeline)?.name}
                      <button onClick={() => setFilterPipeline('')}><X className="w-3 h-3" /></button>
                    </Badge>
                  )}
                  {filterStage && (
                    <Badge className="bg-purple-50 text-purple-700 border-0 gap-1">
                      Stage: {stages.find((s) => s.id === filterStage)?.name}
                      <button onClick={() => setFilterStage('')}><X className="w-3 h-3" /></button>
                    </Badge>
                  )}
                  {filterTag && (
                    <Badge className="bg-amber-50 text-amber-700 border-0 gap-1">
                      Tag: {tags.find((t) => t.id === filterTag)?.name}
                      <button onClick={() => setFilterTag('')}><X className="w-3 h-3" /></button>
                    </Badge>
                  )}
                  {filterGroup && (
                    <Badge className="bg-emerald-50 text-emerald-700 border-0 gap-1">
                      Group: {groups.find((g) => g.id === filterGroup)?.name}
                      <button onClick={() => setFilterGroup('')}><X className="w-3 h-3" /></button>
                    </Badge>
                  )}
                  {filterFromDate && (
                    <Badge className="bg-sky-50 text-sky-700 border-0 gap-1">
                      <Calendar className="w-3 h-3" /> From: {filterFromDate}
                      <button onClick={() => setFilterFromDate('')}><X className="w-3 h-3" /></button>
                    </Badge>
                  )}
                  {filterToDate && (
                    <Badge className="bg-sky-50 text-sky-700 border-0 gap-1">
                      <Calendar className="w-3 h-3" /> To: {filterToDate}
                      <button onClick={() => setFilterToDate('')}><X className="w-3 h-3" /></button>
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9 h-9" placeholder="Search by name, phone, or email..."
                    value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#7a6b5c]">{selectedIds.size} of {leads.length} selected</span>
                  <button onClick={toggleAll} className="text-xs text-primary hover:underline font-medium">
                    {selectedIds.size === leads.length && leads.length > 0 ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
              </div>
              <div className="max-h-[50vh] overflow-y-auto">
                {loadingLeads ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : leads.length === 0 ? (
                  <div className="p-10 text-center">
                    <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">No leads with phone numbers match your filters</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-[#faf8f6] sticky top-0 z-10">
                      <tr>
                        <th className="w-10 px-3 py-2.5">
                          <input type="checkbox" checked={selectedIds.size === leads.length && leads.length > 0}
                            onChange={toggleAll} className="rounded border-gray-300" />
                        </th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#7a6b5c] uppercase tracking-wide">Name</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#7a6b5c] uppercase tracking-wide">Phone</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#7a6b5c] uppercase tracking-wide hidden md:table-cell">Email</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#7a6b5c] uppercase tracking-wide hidden lg:table-cell">Pipeline / Stage</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#7a6b5c] uppercase tracking-wide hidden lg:table-cell">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((l) => (
                        <tr key={l.id} onClick={() => toggleSelect(l.id)}
                          className={cn('border-t border-black/5 cursor-pointer transition-colors',
                            selectedIds.has(l.id) ? 'bg-primary/5' : 'hover:bg-[#faf8f6]')}>
                          <td className="px-3 py-2.5">
                            <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelect(l.id)} className="rounded border-gray-300" />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-[#1c1410]">{l.name || 'Unknown'}</td>
                          <td className="px-3 py-2.5 text-[#7a6b5c] font-mono text-xs">{l.phone}</td>
                          <td className="px-3 py-2.5 text-[#7a6b5c] text-xs hidden md:table-cell">{l.email || '-'}</td>
                          <td className="px-3 py-2.5 text-[#7a6b5c] text-xs hidden lg:table-cell">
                            {l.pipeline_name ? `${l.pipeline_name} / ${l.stage_name || '-'}` : '-'}
                          </td>
                          <td className="px-3 py-2.5 text-[#7a6b5c] text-xs hidden lg:table-cell">
                            {l.created_at ? new Date(l.created_at).toLocaleDateString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            <div className="flex justify-center">
              <Button onClick={() => setStep('template')} disabled={selectedIds.size === 0} className="px-8 py-2.5 text-base">
                Select {selectedIds.size} Lead{selectedIds.size !== 1 ? 's' : ''}
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Select Template */}
        {step === 'template' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setStep('leads')} className="p-1.5 rounded-lg hover:bg-black/5">
                <ArrowLeft className="w-4 h-4 text-[#7a6b5c]" />
              </button>
              <span className="text-sm text-[#7a6b5c]">{selectedIds.size} leads selected</span>
            </div>
            <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-black/5">
                <h3 className="text-sm font-semibold text-[#1c1410]">Choose an approved WABA template</h3>
              </div>
              <div className="max-h-[55vh] overflow-y-auto">
                {templates.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    No approved WABA templates found. Create and submit templates first.
                  </div>
                ) : templates.map((t) => (
                  <button key={t.id} onClick={() => setSelectedTemplate(t)}
                    className={cn('w-full text-left px-5 py-4 border-b border-black/5 last:border-0 transition-colors flex items-start gap-4',
                      selectedTemplate?.id === t.id ? 'bg-primary/5 border-l-4 border-l-primary' : 'hover:bg-[#faf8f6]')}>
                    <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5',
                      selectedTemplate?.id === t.id ? 'border-primary bg-primary' : 'border-gray-300')}>
                      {selectedTemplate?.id === t.id && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-[#1c1410]">{t.name}</p>
                        <Badge className="border-0 text-[10px] bg-emerald-50 text-emerald-700">{t.language}</Badge>
                      </div>
                      <p className="text-xs text-[#7a6b5c] font-mono mt-0.5">{t.meta_name}</p>
                      <p className="text-[13px] text-[#4a3c30] mt-2 whitespace-pre-line line-clamp-3">{t.body}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {selectedTemplate && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
                <p className="text-xs font-semibold text-emerald-700">Template Preview</p>
                {selectedTemplate.header && <p className="text-sm font-bold text-[#1c1410]">{selectedTemplate.header}</p>}
                <p className="text-sm text-[#4a3c30] whitespace-pre-line">{selectedTemplate.body}</p>
                {selectedTemplate.footer && <p className="text-xs text-[#7a6b5c] italic">{selectedTemplate.footer}</p>}
              </div>
            )}
            <div className="flex justify-center">
              <Button onClick={handleBroadcast} disabled={!selectedTemplate || sending} className="px-8 py-2.5 text-base">
                {sending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Send to {selectedIds.size} Lead{selectedIds.size !== 1 ? 's' : ''}</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirmation */}
        {step === 'confirm' && result && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-black/5 p-8 text-center space-y-4">
              <div className={cn('w-16 h-16 rounded-full mx-auto flex items-center justify-center',
                result.failed === 0 ? 'bg-emerald-100' : 'bg-amber-100')}>
                {result.failed === 0
                  ? <Check className="w-8 h-8 text-emerald-600" />
                  : <Megaphone className="w-8 h-8 text-amber-600" />}
              </div>
              <h2 className="text-lg font-bold text-[#1c1410]">Broadcast Complete</h2>
              <p className="text-sm text-[#7a6b5c]">
                Template "{selectedTemplate?.name}" sent to {result.total} leads
              </p>
              <div className="flex items-center justify-center gap-8 py-4">
                <div className="text-center">
                  <p className="text-3xl font-bold text-emerald-600">{result.sent}</p>
                  <p className="text-xs text-[#7a6b5c] mt-1">Sent</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-red-500">{result.failed}</p>
                  <p className="text-xs text-[#7a6b5c] mt-1">Failed</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-amber-500">{result.skipped}</p>
                  <p className="text-xs text-[#7a6b5c] mt-1">Skipped</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <details className="text-left bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
                  <summary className="cursor-pointer text-red-700 font-medium">{result.errors.length} error(s) — click to expand</summary>
                  <ul className="mt-2 space-y-1 text-red-600 text-xs max-h-40 overflow-y-auto">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
              <div className="flex items-center justify-center gap-3 mt-4">
                <Button onClick={goBackToList} variant="outline">
                  <Eye className="w-4 h-4 mr-2" /> View Broadcasts
                </Button>
                <Button onClick={resetWizard}>
                  <Megaphone className="w-4 h-4 mr-2" /> New Broadcast
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LIST VIEW (default) — 2-panel layout
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col flex-1 min-h-0 -mx-6 -my-5">
      <div className="flex flex-1 min-h-0">
        {/* Left Panel: Broadcast List */}
        <div className="w-[380px] border-r border-black/5 flex flex-col bg-white min-h-0">
          {/* List Header */}
          <div className="px-4 py-3 border-b border-black/5 space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-bold text-[#1c1410]">Broadcasts</h2>
                <button onClick={fetchBroadcasts} className="p-1 rounded hover:bg-black/5" title="Refresh">
                  <RefreshCw className="w-3.5 h-3.5 text-[#7a6b5c]" />
                </button>
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={() => setView('create')}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Create Broadcast
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input className="pl-9 h-8 text-xs" placeholder="Search broadcast(s) by name"
                value={listSearch} onChange={(e) => setListSearch(e.target.value)} />
            </div>
            <p className="text-[11px] text-[#7a6b5c]">{broadcasts.length} Broadcast{broadcasts.length !== 1 ? 's' : ''}</p>
          </div>

          {/* List Body */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loadingList ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : broadcasts.length === 0 ? (
              <div className="p-8 text-center">
                <Megaphone className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No broadcasts yet</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setView('create')}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Create your first broadcast
                </Button>
              </div>
            ) : broadcasts.map((bc) => {
              const completePct = pct(bc.sent + bc.failed + bc.skipped, bc.total_leads);
              const isSelected = selectedBc?.id === bc.id;
              return (
                <button key={bc.id} onClick={() => loadDetail(bc.id)}
                  className={cn('w-full text-left px-4 py-3 border-b border-black/5 transition-colors hover:bg-[#faf8f6]',
                    isSelected && 'bg-primary/5 border-l-[3px] border-l-primary')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#1c1410] truncate">{bc.name}</p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-[#7a6b5c]">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(bc.created_at)}</span>
                        {bc.created_by_name && <span>{bc.created_by_name.split(' ')[0]}</span>}
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{bc.total_leads}</span>
                      </div>
                    </div>
                    {/* Circular progress */}
                    <div className="relative w-10 h-10 shrink-0">
                      <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15" fill="none"
                          stroke={completePct === 100 ? (bc.failed === 0 ? '#10b981' : '#f59e0b') : '#3b82f6'}
                          strokeWidth="3" strokeDasharray={`${completePct * 0.942} 100`} strokeLinecap="round" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[#1c1410]">
                        {completePct}%
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Broadcast Detail */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-[#faf8f6]">
          {loadingDetail ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !selectedBc ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <Megaphone className="w-12 h-12 text-muted-foreground/15 mb-3" />
              <p className="text-sm text-muted-foreground">Select a broadcast to view details</p>
              <p className="text-xs text-muted-foreground/70 mt-1">or create a new broadcast to get started</p>
            </div>
          ) : (
            <BroadcastDetailPanel bc={selectedBc} onRefresh={() => loadDetail(selectedBc.id)} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detail Panel Sub-component ───────────────────────────────────────────────
function BroadcastDetailPanel({ bc, onRefresh }: { bc: BroadcastDetail; onRefresh: () => void }) {
  const ds = bc.delivery_stats ?? {};
  const sentCount = ds['sent'] ?? 0;
  const deliveredCount = ds['delivered'] ?? 0;
  const readCount = ds['read'] ?? 0;
  const failedCount = ds['failed'] ?? 0;
  const pending = Math.max(0, bc.total_leads - (bc.sent + bc.failed + bc.skipped));
  const completePct = pct(bc.sent + bc.failed + bc.skipped, bc.total_leads);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold text-[#1c1410] break-all">{bc.name}</h2>
          <p className="text-xs text-[#7a6b5c] mt-0.5">
            Created on: {new Date(bc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
            {bc.created_by_name && ` by ${bc.created_by_name}`}
          </p>
        </div>
        <button onClick={onRefresh} className="p-1.5 rounded-lg hover:bg-black/5" title="Refresh stats">
          <RefreshCw className="w-4 h-4 text-[#7a6b5c]" />
        </button>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-2xl border border-black/5 p-5">
        <h3 className="text-xs font-semibold text-[#7a6b5c] uppercase tracking-wide mb-3">Summary</h3>
        <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm">
          <div className="flex justify-between">
            <span className="text-[#7a6b5c]">Attempted on</span>
            <span className="font-semibold text-primary">{bc.total_leads} leads</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#7a6b5c]">Status</span>
            <Badge className={cn('border-0 text-[10px]',
              bc.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700')}>
              {bc.status === 'completed' ? 'Completed' : 'Sending...'}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-[#7a6b5c]">Current progress</span>
            <span className="font-semibold text-[#1c1410]">{bc.sent + bc.failed + bc.skipped} / {bc.total_leads}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#7a6b5c]">Skipped (no phone)</span>
            <span className="font-semibold text-[#1c1410]">{bc.skipped}</span>
          </div>
        </div>
      </div>

      {/* Messaging Progress Report */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        <div className="px-5 py-3 border-b border-black/5 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[#7a6b5c] uppercase tracking-wide">Messaging Progress Report</h3>
          <span className="text-xs text-[#7a6b5c]">{completePct}% complete</span>
        </div>
        <div className="grid grid-cols-3 divide-x divide-black/5">
          <StatCard label="Sent" value={bc.sent} icon={<Mail className="w-4 h-4" />} color="text-blue-600" />
          <StatCard label="Failed" value={bc.failed} icon={<MailX className="w-4 h-4" />} color="text-red-500" />
          <StatCard label="Pending" value={pending} icon={<Clock className="w-4 h-4" />} color="text-gray-400" />
        </div>
      </div>

      {/* Delivery Report */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        <div className="px-5 py-3 border-b border-black/5">
          <h3 className="text-xs font-semibold text-[#7a6b5c] uppercase tracking-wide">Delivery Report</h3>
        </div>
        <div className="grid grid-cols-3 divide-x divide-black/5">
          <StatCard label="Sent" value={sentCount + deliveredCount + readCount} icon={<Check className="w-4 h-4" />} color="text-blue-600" sub="API accepted" />
          <StatCard label="Delivered" value={deliveredCount + readCount} icon={<MailCheck className="w-4 h-4" />} color="text-emerald-600" sub="To device" />
          <StatCard label="Read" value={readCount} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-600" sub="Blue ticks" />
        </div>
      </div>

      {/* Failure Report */}
      {(bc.failure_breakdown?.length > 0 || bc.failed > 0) && (
        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-black/5">
            <h3 className="text-xs font-semibold text-[#7a6b5c] uppercase tracking-wide">Failure Report</h3>
          </div>
          {bc.failure_breakdown?.length > 0 ? (
            <div className="grid grid-cols-2 gap-px bg-black/5">
              {bc.failure_breakdown.map((f, i) => (
                <div key={i} className="bg-white px-5 py-4">
                  <p className="text-xs text-red-500 font-medium truncate" title={f.reason}>{f.reason}</p>
                  <p className="text-2xl font-bold text-red-500 mt-1">{f.count}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-4">
              <p className="text-sm text-red-500 font-semibold">{bc.failed} message(s) failed</p>
            </div>
          )}
        </div>
      )}

      {/* Error Details (expandable) */}
      {bc.error_details?.length > 0 && (
        <details className="bg-white rounded-2xl border border-black/5 overflow-hidden">
          <summary className="px-5 py-3 cursor-pointer text-xs font-semibold text-[#7a6b5c] uppercase tracking-wide flex items-center justify-between hover:bg-[#faf8f6]">
            <span>Error Log ({bc.error_details.length})</span>
            <ChevronDown className="w-4 h-4" />
          </summary>
          <ul className="px-5 pb-4 space-y-1.5 max-h-60 overflow-y-auto">
            {bc.error_details.map((e, i) => (
              <li key={i} className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{e}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Template Preview */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        <div className="px-5 py-3 border-b border-black/5">
          <h3 className="text-xs font-semibold text-[#7a6b5c] uppercase tracking-wide">Template Used</h3>
        </div>
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-[#1c1410]">{bc.template_name}</p>
            <span className="text-xs text-[#7a6b5c] font-mono">({bc.template_meta_name})</span>
          </div>
          {bc.template_header && <p className="text-sm font-bold text-[#1c1410]">{bc.template_header}</p>}
          <p className="text-sm text-[#4a3c30] whitespace-pre-line">{bc.template_body}</p>
          {bc.template_footer && <p className="text-xs text-[#7a6b5c] italic">{bc.template_footer}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color, sub }: {
  label: string; value: number; icon: React.ReactNode; color: string; sub?: string;
}) {
  return (
    <div className="px-5 py-4 text-center">
      <div className={cn('flex items-center justify-center gap-1.5 text-xs font-medium mb-1', color)}>
        {icon} {label}
      </div>
      <p className={cn('text-3xl font-bold', color)}>{value}</p>
      {sub && <p className="text-[10px] text-[#7a6b5c] mt-0.5">{sub}</p>}
    </div>
  );
}
