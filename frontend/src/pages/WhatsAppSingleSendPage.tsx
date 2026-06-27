import { useState, useEffect, useRef } from 'react';
import {
  Send, Search, MessageSquare, Paperclip, X, Check, Loader2, QrCode, Image,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Device = { session_id: string; session_name: string; status: string; phone_number: string | null };
type WaTemplate = { id: string; name: string; message: string; file_name?: string | null; file_path?: string | null; file_type?: string | null };
type ContactResult = { id: string; name: string; phone: string; type: 'lead' | 'contact' };

export default function WhatsAppSingleSendPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');

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

  // Message
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Load devices + templates
  useEffect(() => {
    api.get<Device[]>('/api/whatsapp-personal/sessions').then((rows) => {
      if (Array.isArray(rows)) {
        setDevices(rows);
        const connected = rows.find((d) => d.status === 'connected');
        if (connected) setDeviceId(connected.session_id);
      }
    }).catch(() => {});

    api.get<WaTemplate[]>('/api/wa-personal-templates').then((rows) => {
      if (Array.isArray(rows)) setTemplates(rows);
    }).catch(() => {});
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
    setSearchQuery(c.name + ' - ' + c.phone);
    setShowDropdown(false);
  };

  const clearReceiver = () => {
    setReceiverPhone('');
    setReceiverName('');
    setReceiverLeadId(null);
    setSearchQuery('');
  };

  const loadTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((t) => t.id === id);
    if (t) setMessage(t.message ?? '');
  };

  const sendMessage = async () => {
    const phone = receiverPhone.trim();
    if (!phone) { toast.error('Enter a receiver phone number'); return; }
    if (!message.trim()) { toast.error('Type a message'); return; }

    const connectedDevice = devices.find((d) => d.session_id === deviceId);
    if (!connectedDevice || connectedDevice.status !== 'connected') {
      toast.error('Selected device is not connected'); return;
    }

    setSending(true);
    try {
      await api.post('/api/whatsapp-personal/send', {
        phone,
        message: message.trim(),
        session_id: deviceId || undefined,
        lead_id: receiverLeadId || undefined,
        template_id: templateId || undefined,
      });
      setSent(true);
      toast.success(`Message sent to ${receiverName || phone}`);
      setTimeout(() => setSent(false), 3000);
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to send message');
    } finally { setSending(false); }
  };

  const selectedDevice = devices.find((d) => d.session_id === deviceId);
  const hasConnected = devices.some((d) => d.status === 'connected');

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#128C7E] flex items-center justify-center shrink-0">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="font-headline font-bold text-[17px] text-[#1c1410]">Send Custom Message</h2>
          <p className="text-[12px] text-[#9e8e7e]">Compose and send a message directly to a contact</p>
        </div>
      </div>

      {!hasConnected && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
          <QrCode className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-semibold text-amber-800">No active device</p>
            <p className="text-[12px] text-amber-700">Connect a WhatsApp device first from the WhatsApp Devices tab.</p>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
        {/* Row 1: Device + Receiver */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
          {/* Device */}
          <div>
            <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <span className="text-amber-500">📱</span> Select Device
            </label>
            <select
              className="w-full border border-black/10 rounded-lg px-3 py-2.5 text-[13px] bg-white outline-none focus:border-[#128C7E] transition-colors"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              <option value="">- Select a device -</option>
              {devices.map((d) => (
                <option key={d.session_id} value={d.session_id} disabled={d.status !== 'connected'}>
                  {d.session_name}{d.phone_number ? ` (${d.phone_number})` : ''}{d.status !== 'connected' ? ' - offline' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Receiver */}
          <div ref={dropdownRef} className="relative">
            <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <span className="text-emerald-500">👤</span> Message To (Receiver)
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
                    className="w-full pl-9 pr-3 py-2.5 text-[13px] border border-black/10 rounded-lg outline-none focus:border-[#128C7E] transition-colors"
                    placeholder="Search lead by name or enter phone number..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !showDropdown && searchQuery.trim()) {
                        // Treat as raw phone number
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
        </div>

        {/* Template loader */}
        <div className="px-5 pb-4">
          <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <span className="text-blue-500">📋</span> Load from Template
          </label>
          <select
            className="w-full max-w-md border border-black/10 rounded-lg px-3 py-2.5 text-[13px] bg-white outline-none focus:border-[#128C7E] transition-colors"
            value={templateId}
            onChange={(e) => loadTemplate(e.target.value)}
          >
            <option value="">Select a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Template attachment preview */}
        {templateId && (() => {
          const tpl = templates.find((t) => t.id === templateId);
          if (!tpl?.file_path) return null;
          const isImage = tpl.file_type?.startsWith('image/');
          return (
            <div className="px-5 pb-4">
              <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <span className="text-purple-500">📎</span> Attachment
              </label>
              <div className="flex items-center gap-3 border border-black/10 rounded-lg p-3 bg-[#faf8f6]">
                {isImage ? (
                  <img
                    src={`/api/wa-personal-templates/${tpl.id}/file`}
                    alt={tpl.file_name ?? 'attachment'}
                    className="w-20 h-20 object-cover rounded-lg border border-black/10"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center">
                    <Paperclip className="w-5 h-5 text-blue-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[#1c1410] truncate">{tpl.file_name}</p>
                  <p className="text-[11px] text-[#9e8e7e]">Will be sent with the message</p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Message area */}
        <div className="px-5 pb-5">
          <label className="text-[11px] font-bold text-[#7a6b5c] uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <span className="text-orange-500">✏️</span> Message
          </label>
          <div className="border border-black/10 rounded-xl overflow-hidden focus-within:border-[#128C7E] transition-colors">
            <textarea
              className="w-full px-4 py-3 text-[13px] min-h-[180px] resize-y outline-none bg-[#faf8f6]"
              placeholder="Type your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-[#9e8e7e] mt-1.5">
            {message.length} characters - Use *bold*, _italic_, ~strikethrough~ for WhatsApp formatting
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-black/5 bg-[var(--app-bg)] flex items-center justify-between">
          <div className="text-[11px] text-[#9e8e7e]">
            {selectedDevice ? (
              <span>Sending from <strong>{selectedDevice.session_name}</strong>{selectedDevice.phone_number ? ` (${selectedDevice.phone_number})` : ''}</span>
            ) : (
              <span>Select a device to send</span>
            )}
          </div>
          <button
            onClick={sendMessage}
            disabled={sending || !message.trim() || !receiverPhone || !deviceId}
            className={cn(
              'flex items-center gap-2 text-[13px] font-bold text-white px-6 py-2.5 rounded-lg transition-all',
              sent
                ? 'bg-emerald-500'
                : sending || !message.trim() || !receiverPhone || !deviceId
                ? 'bg-[#128C7E]/40 cursor-not-allowed'
                : 'bg-[#128C7E] hover:bg-[#0f7a6d] shadow-sm hover:shadow',
            )}
          >
            {sent ? <><Check className="w-4 h-4" />Sent!</> : sending ? <><Loader2 className="w-4 h-4 animate-spin" />Sending...</> : <><Send className="w-4 h-4" />Send Message</>}
          </button>
        </div>
      </div>
    </div>
  );
}
