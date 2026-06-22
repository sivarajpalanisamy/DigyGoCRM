import { useState, useEffect } from 'react';
import {
  Send, Search, Loader2, X, Check, ChevronDown, Users, Megaphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  pipeline_name?: string;
  stage_name?: string;
}

interface Template {
  id: string;
  name: string;
  meta_name: string;
  language: string;
  body: string;
  status: string;
}

interface BroadcastResult {
  sent: number;
  failed: number;
  skipped: number;
  total: number;
  errors: string[];
}

export default function WABABroadcastPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [showTplPicker, setShowTplPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Lead[]>('/api/leads?limit=2000'),
      api.get<Template[]>('/api/templates?type=waba'),
    ]).then(([l, t]) => {
      setLeads(Array.isArray(l) ? l : []);
      setTemplates((Array.isArray(t) ? t : []).filter((x) => x.meta_name && x.status === 'approved'));
    }).catch(() => toast.error('Failed to load data')).finally(() => setLoading(false));
  }, []);

  const filtered = leads.filter((l) => {
    if (!l.phone) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return l.name?.toLowerCase().includes(q) || l.phone.includes(q) || l.email?.toLowerCase().includes(q);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((l) => l.id)));
    }
  };

  const handleBroadcast = async () => {
    if (!selectedTemplate) { toast.error('Select a template first'); return; }
    if (selectedIds.size === 0) { toast.error('Select at least one lead'); return; }
    setSending(true);
    setResult(null);
    try {
      const res = await api.post<BroadcastResult>('/api/conversations/broadcast', {
        template_id: selectedTemplate.id,
        lead_ids: Array.from(selectedIds),
      });
      setResult(res);
      toast.success(`Broadcast sent: ${res.sent} delivered, ${res.failed} failed, ${res.skipped} skipped`);
    } catch (e: any) {
      toast.error(e.message ?? 'Broadcast failed');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-headline font-bold text-[#1c1410]">WABA Broadcast</h1>
          <p className="text-sm text-[#7a6b5c] mt-0.5">Send approved WhatsApp templates to multiple leads at once</p>
        </div>
        <Button onClick={handleBroadcast} disabled={sending || !selectedTemplate || selectedIds.size === 0}>
          {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Megaphone className="w-4 h-4 mr-2" />}
          Send to {selectedIds.size} lead{selectedIds.size !== 1 ? 's' : ''}
        </Button>
      </div>

      {/* Result banner */}
      {result && (
        <div className="bg-white rounded-xl border border-black/5 p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-lg font-bold text-emerald-600">{result.sent}</p>
              <p className="text-[11px] text-[#7a6b5c]">Sent</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-red-500">{result.failed}</p>
              <p className="text-[11px] text-[#7a6b5c]">Failed</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-amber-500">{result.skipped}</p>
              <p className="text-[11px] text-[#7a6b5c]">Skipped</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <details className="text-xs text-red-600 max-w-md">
              <summary className="cursor-pointer hover:underline">{result.errors.length} error(s)</summary>
              <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
          <button onClick={() => setResult(null)} className="p-1 rounded hover:bg-black/5">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Template selection */}
        <div className="lg:col-span-1 space-y-3">
          <h2 className="text-sm font-semibold text-[#1c1410]">Template</h2>
          <div className="relative">
            <button
              onClick={() => setShowTplPicker(!showTplPicker)}
              className="w-full border border-black/10 rounded-xl px-4 py-3 text-left flex items-center justify-between hover:border-primary/30 transition-colors bg-white"
            >
              {selectedTemplate ? (
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#1c1410] truncate">{selectedTemplate.name}</p>
                  <p className="text-[11px] text-[#7a6b5c] truncate">{selectedTemplate.meta_name} ({selectedTemplate.language})</p>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Select a template...</span>
              )}
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
            {showTplPicker && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-black/10 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {templates.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">No approved WABA templates. Sync or create templates first.</p>
                ) : templates.map((t) => (
                  <button key={t.id} onClick={() => { setSelectedTemplate(t); setShowTplPicker(false); }}
                    className={cn('w-full text-left px-4 py-2.5 hover:bg-[#faf8f6] transition-colors border-b border-black/5 last:border-0',
                      selectedTemplate?.id === t.id && 'bg-emerald-50')}>
                    <p className="text-sm font-medium text-[#1c1410]">{t.name}</p>
                    <p className="text-xs text-[#7a6b5c] mt-0.5 line-clamp-2">{t.body}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Template preview */}
          {selectedTemplate && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-700 mb-1">Preview</p>
              <p className="text-sm text-[#4a3c30] whitespace-pre-line">{selectedTemplate.body}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge className="border-0 text-[10px] bg-emerald-100 text-emerald-700">{selectedTemplate.language}</Badge>
                <Badge className="border-0 text-[10px] bg-green-100 text-green-700">Approved</Badge>
              </div>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-700">
              Only <strong>approved</strong> WABA templates can be used for broadcast.
              Leads without a phone number will be skipped. Max 500 per broadcast.
            </p>
          </div>
        </div>

        {/* Lead selection */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1c1410]">
              Recipients
              <span className="ml-2 text-xs font-normal text-[#7a6b5c]">
                {selectedIds.size} of {filtered.length} selected
              </span>
            </h2>
            <button onClick={toggleAll} className="text-xs text-primary hover:underline">
              {selectedIds.size === filtered.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name, phone, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="bg-white border border-black/5 rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No leads with phone numbers found</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#faf8f6] sticky top-0 z-10">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0}
                        onChange={toggleAll} className="rounded border-gray-300" />
                    </th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-[#7a6b5c]">Name</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-[#7a6b5c]">Phone</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-[#7a6b5c] hidden md:table-cell">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} onClick={() => toggleSelect(l.id)}
                      className={cn('border-t border-black/5 cursor-pointer transition-colors',
                        selectedIds.has(l.id) ? 'bg-primary/5' : 'hover:bg-[#faf8f6]')}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelect(l.id)}
                          className="rounded border-gray-300" />
                      </td>
                      <td className="px-3 py-2 font-medium text-[#1c1410]">{l.name || 'Unknown'}</td>
                      <td className="px-3 py-2 text-[#7a6b5c] font-mono text-xs">{l.phone}</td>
                      <td className="px-3 py-2 text-[#7a6b5c] text-xs hidden md:table-cell">{l.email || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
