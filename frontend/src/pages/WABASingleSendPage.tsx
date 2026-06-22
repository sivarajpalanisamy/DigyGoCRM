import { useState, useEffect, useRef } from 'react';
import { Send, Search, MessageSquare, X, Check, Loader2, ChevronDown, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type WABATemplate = {
  id: string; name: string; meta_name: string | null; body: string;
  header?: string | null; footer?: string | null; status: string;
  buttons?: any; language: string; category: string;
};
type ContactResult = { id: string; name: string; phone: string; type: 'lead' | 'contact' };

export default function WABASingleSendPage() {
  const [templates, setTemplates] = useState<WABATemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [loading, setLoading] = useState(true);
  const [wabaConnected, setWabaConnected] = useState(false);

  // Receiver
  const [receiverPhone, setReceiverPhone] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverLeadId, setReceiverLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ContactResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Load WABA templates + check connection
  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<WABATemplate[]>('/api/templates').catch(() => []),
      api.get<any[]>('/api/integrations/wa-numbers').catch(() => []),
    ]).then(([tpls, numbers]) => {
      const wabaTemplates = (Array.isArray(tpls) ? tpls : []).filter(
        (t: any) => t.template_type === 'waba' && t.status === 'approved' && t.meta_name,
      );
      setTemplates(wabaTemplates);
      const hasWaba = (Array.isArray(numbers) ? numbers : []).some(
        (n: any) => n.type === 'waba' && n.connected,
      );
      setWabaConnected(hasWaba);
    }).finally(() => setLoading(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced contact search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const leads = await api.get<any[]>(`/api/leads?search=${encodeURIComponent(searchQuery)}&limit=10`);
        const results: ContactResult[] = [];
        if (Array.isArray(leads)) {
          for (const l of leads) {
            if (l.phone) results.push({ id: l.id, name: l.name || l.phone, phone: l.phone, type: 'lead' });
          }
        }
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {} finally { setSearching(false); }
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  const selectContact = (c: ContactResult) => {
    setReceiverPhone(c.phone);
    setReceiverName(c.name);
    setReceiverLeadId(c.id);
    setSearchQuery(c.name + ' — ' + c.phone);
    setShowDropdown(false);
  };

  const clearReceiver = () => {
    setReceiverPhone(''); setReceiverName(''); setReceiverLeadId(null); setSearchQuery('');
  };

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const sendMessage = async () => {
    const phone = receiverPhone.trim();
    if (!phone) { toast.error('Select a receiver'); return; }
    if (!templateId) { toast.error('Select a template'); return; }

    setSending(true);
    try {
      await api.post('/api/conversations/waba-single-send', {
        phone,
        template_id: templateId,
        lead_id: receiverLeadId || undefined,
      });
      setSent(true);
      toast.success(`Template sent to ${receiverName || phone}`);
      setTimeout(() => setSent(false), 3000);
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to send');
    } finally { setSending(false); }
  };

  const parseButtons = (b: any): Array<{ type: string; text: string }> => {
    if (!b) return [];
    const arr = typeof b === 'string' ? (() => { try { return JSON.parse(b); } catch { return []; } })() : Array.isArray(b) ? b : [];
    return arr.map((btn: any) => ({ type: btn.type ?? '', text: btn.label ?? btn.text ?? '' }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="font-headline font-bold text-[17px] text-[#1c1410]">WABA Single Send</h2>
          <p className="text-[12px] text-[#9e8e7e]">Send an approved template message to a single contact via WhatsApp Business API</p>
        </div>
      </div>

      {!wabaConnected && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-semibold text-amber-800">WABA not connected</p>
            <p className="text-[12px] text-amber-700">Connect your WhatsApp Business account from the WABA Dashboard first.</p>
          </div>
        </div>
      )}

      {templates.length === 0 && wabaConnected && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200">
          <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-semibold text-blue-800">No approved templates</p>
            <p className="text-[12px] text-blue-700">Create and get a template approved by Meta before sending. Go to WABA → Templates.</p>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        {/* Row 1: Receiver + Template */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
          {/* Receiver */}
          <div ref={dropdownRef} className="relative">
            <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-1.5 flex items-center gap-1">
              Message To (Receiver)
            </label>
            {receiverPhone ? (
              <div className="flex items-center gap-2 border border-black/10 rounded-lg px-3 py-2.5 bg-white">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[#1c1410] truncate">{receiverName || receiverPhone}</p>
                  {receiverName && <p className="text-[11px] text-[#9e8e7e]">{receiverPhone}</p>}
                </div>
                <button onClick={clearReceiver} className="text-[#9e8e7e] hover:text-red-500 p-0.5"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9e8e7e]" />
                  <input
                    className="w-full pl-9 pr-3 py-2.5 text-[13px] border border-black/10 rounded-lg outline-none focus:border-emerald-500 transition-colors"
                    placeholder="Search lead by name or enter phone..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !showDropdown && searchQuery.trim()) {
                        setReceiverPhone(searchQuery.trim());
                        setReceiverName('');
                        setReceiverLeadId(null);
                      }
                    }}
                  />
                  {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9e8e7e] animate-spin" />}
                </div>
                {showDropdown && searchResults.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-black/10 shadow-lg max-h-[200px] overflow-y-auto">
                    {searchResults.map((c) => (
                      <button
                        key={c.id}
                        className="w-full text-left px-4 py-2.5 hover:bg-[var(--accent-tint)] transition-colors border-b border-black/5 last:border-0"
                        onClick={() => selectContact(c)}
                      >
                        <p className="text-[13px] font-semibold text-[#1c1410]">{c.name}</p>
                        <p className="text-[11px] text-[#9e8e7e]">{c.phone}</p>
                      </button>
                    ))}
                  </div>
                )}
                {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                  <p className="text-[11px] text-[#9e8e7e] mt-1">No leads found. Press Enter to use as phone number.</p>
                )}
              </>
            )}
          </div>

          {/* Template selector */}
          <div>
            <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-1.5 flex items-center gap-1">
              Select Template
            </label>
            <div className="relative">
              <select
                className="w-full border border-black/10 rounded-lg px-3 py-2.5 text-[13px] bg-white outline-none focus:border-emerald-500 transition-colors appearance-none pr-8"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">— Select an approved template —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.language}) — {t.category}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9e8e7e] pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Template preview */}
        {selectedTemplate && (
          <div className="px-5 pb-5">
            <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-2 block">
              Template Preview
            </label>
            <div className="bg-[#e5ddd5] rounded-xl p-4 max-w-sm">
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                {selectedTemplate.header && (
                  <div className="px-3 pt-3 pb-1">
                    <p className="text-[13px] font-bold text-[#1c1410]">{selectedTemplate.header}</p>
                  </div>
                )}
                <div className="px-3 py-2">
                  <p className="text-[13px] text-[#1c1410] whitespace-pre-wrap">{selectedTemplate.body}</p>
                </div>
                {selectedTemplate.footer && (
                  <div className="px-3 pb-2">
                    <p className="text-[11px] text-[#9e8e7e]">{selectedTemplate.footer}</p>
                  </div>
                )}
                {parseButtons(selectedTemplate.buttons).length > 0 && (
                  <div className="border-t border-black/5">
                    {parseButtons(selectedTemplate.buttons).map((btn, i) => (
                      <div key={i} className="text-center py-2 border-b border-black/5 last:border-0">
                        <span className="text-[13px] text-[#128C7E] font-medium">{btn.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-black/5 bg-[var(--app-bg)] flex items-center justify-between">
          <div className="text-[11px] text-[#9e8e7e]">
            {wabaConnected ? (
              <span>Sending via <strong>WhatsApp Business API</strong></span>
            ) : (
              <span className="text-amber-600">WABA not connected</span>
            )}
          </div>
          <button
            onClick={sendMessage}
            disabled={sending || !templateId || !receiverPhone || !wabaConnected}
            className={cn(
              'flex items-center gap-2 text-[13px] font-bold text-white px-6 py-2.5 rounded-lg transition-all',
              sent
                ? 'bg-emerald-500'
                : sending || !templateId || !receiverPhone || !wabaConnected
                ? 'bg-emerald-600/40 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 shadow-sm hover:shadow',
            )}
          >
            {sent ? <><Check className="w-4 h-4" />Sent!</> : sending ? <><Loader2 className="w-4 h-4 animate-spin" />Sending...</> : <><Send className="w-4 h-4" />Send Template</>}
          </button>
        </div>
      </div>
    </div>
  );
}
