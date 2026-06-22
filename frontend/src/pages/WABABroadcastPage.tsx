import { useState, useEffect, useMemo } from 'react';
import {
  Send, Search, Loader2, X, Check, Users, Megaphone,
  Filter, ChevronRight, ArrowLeft, Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';

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

interface BroadcastResult {
  sent: number;
  failed: number;
  skipped: number;
  total: number;
  errors: string[];
}

type Step = 'leads' | 'template' | 'confirm';

// ── Component ────────────────────────────────────────────────────────────────
export default function WABABroadcastPage() {
  const [step, setStep] = useState<Step>('leads');

  // Filter data
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [groups, setGroups] = useState<ContactGroup[]>([]);

  // Filter values
  const [filterPipeline, setFilterPipeline] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [search, setSearch] = useState('');

  // Leads
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Sending
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);

  // Load filter options on mount
  useEffect(() => {
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
  }, []);

  // Fetch leads when filters change
  useEffect(() => {
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
  }, [filterPipeline, filterStage, filterTag, filterGroup, filterFromDate, filterToDate, search]);

  // Reset stage when pipeline changes
  useEffect(() => { setFilterStage(''); }, [filterPipeline]);

  const stages = useMemo(() => {
    if (!filterPipeline) return [];
    return pipelines.find((p) => p.id === filterPipeline)?.stages ?? [];
  }, [filterPipeline, pipelines]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === leads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads.map((l) => l.id)));
  };

  const clearFilters = () => {
    setFilterPipeline(''); setFilterStage(''); setFilterTag(''); setFilterGroup(''); setFilterFromDate(''); setFilterToDate(''); setSearch('');
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
      });
      setResult(res);
      setStep('confirm');
    } catch (e: any) {
      toast.error(e.message ?? 'Broadcast failed');
    } finally {
      setSending(false);
    }
  };

  // ── Step indicator ────────────────────────────────────────────────────────
  const steps: { key: Step; label: string }[] = [
    { key: 'leads', label: 'Select Leads' },
    { key: 'template', label: 'Select Template' },
    { key: 'confirm', label: 'Confirmation' },
  ];
  const stepIdx = steps.findIndex((s) => s.key === step);

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-xl font-headline font-bold text-[#1c1410]">Create Broadcast</h1>
          </div>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-center gap-0">
        {steps.map((s, i) => (
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
            {i < steps.length - 1 && (
              <div className={cn('w-12 h-0.5 mx-1', i < stepIdx ? 'bg-primary' : 'bg-gray-200')} />
            )}
          </div>
        ))}
      </div>

      {/* ── Step 1: Select Leads ─────────────────────────────────────────── */}
      {step === 'leads' && (
        <div className="space-y-4">
          {/* Filters */}
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
              <div className="relative col-span-1">
                <label className="text-[10px] font-medium text-[#7a6b5c] uppercase tracking-wide mb-0.5 block">Created From</label>
                <input type="date" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)}
                  max={filterToDate || undefined}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:border-primary outline-none w-full" />
              </div>
              <div className="relative col-span-1">
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

          {/* Search + Lead Table */}
          <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9 h-9" placeholder="Search by name, phone, or email..."
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#7a6b5c]">
                  {selectedIds.size} of {leads.length} selected
                </span>
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
                          <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelect(l.id)}
                            className="rounded border-gray-300" />
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

          {/* Next Button */}
          <div className="flex justify-center">
            <Button onClick={() => setStep('template')} disabled={selectedIds.size === 0}
              className="px-8 py-2.5 text-base">
              Select {selectedIds.size} Lead{selectedIds.size !== 1 ? 's' : ''}
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Select Template ──────────────────────────────────────── */}
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
                <button key={t.id}
                  onClick={() => setSelectedTemplate(t)}
                  className={cn('w-full text-left px-5 py-4 border-b border-black/5 last:border-0 transition-colors flex items-start gap-4',
                    selectedTemplate?.id === t.id ? 'bg-primary/5 border-l-4 border-l-primary' : 'hover:bg-[#faf8f6]')}
                >
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

          {/* Preview + Send */}
          {selectedTemplate && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
              <p className="text-xs font-semibold text-emerald-700">Template Preview</p>
              {selectedTemplate.header && <p className="text-sm font-bold text-[#1c1410]">{selectedTemplate.header}</p>}
              <p className="text-sm text-[#4a3c30] whitespace-pre-line">{selectedTemplate.body}</p>
              {selectedTemplate.footer && <p className="text-xs text-[#7a6b5c] italic">{selectedTemplate.footer}</p>}
            </div>
          )}

          <div className="flex justify-center">
            <Button onClick={handleBroadcast} disabled={!selectedTemplate || sending}
              className="px-8 py-2.5 text-base">
              {sending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Send to {selectedIds.size} Lead{selectedIds.size !== 1 ? 's' : ''}</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Confirmation ─────────────────────────────────────────── */}
      {step === 'confirm' && result && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-black/5 p-8 text-center space-y-4">
            <div className={cn('w-16 h-16 rounded-full mx-auto flex items-center justify-center',
              result.failed === 0 ? 'bg-emerald-100' : 'bg-amber-100')}>
              {result.failed === 0
                ? <Check className="w-8 h-8 text-emerald-600" />
                : <Megaphone className="w-8 h-8 text-amber-600" />
              }
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

            <Button onClick={() => {
              setStep('leads');
              setSelectedIds(new Set());
              setSelectedTemplate(null);
              setResult(null);
            }} variant="outline" className="mt-4">
              <Megaphone className="w-4 h-4 mr-2" /> New Broadcast
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
