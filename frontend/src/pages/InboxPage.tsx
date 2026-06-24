import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useCrmStore } from '@/store/crmStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import {
  Search, Send, Paperclip, Check, CheckCheck, MessageCircle, Clock,
  ArrowLeft, StickyNote, Zap, ChevronDown, UserCheck, X, Smartphone, AlertCircle,
  Loader2, Download, Filter, FileText, RefreshCw, ListOrdered, MapPin, Contact,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';
import { toast } from 'sonner';

type FilterTab = 'all' | 'mine' | 'unread' | 'unassigned' | 'resolved';
type ChannelFilter = 'all' | 'waba' | 'personal_wa';

interface ApiConversation {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  channel: string;
  status: 'open' | 'pending' | 'resolved';
  assigned_to: string | null;
  assigned_name: string | null;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  wa_account: string | null;
}

interface ApiMessage {
  id: string;
  conversation_id: string;
  sender: 'agent' | 'customer';
  body: string;
  is_note: boolean;
  is_deleted?: boolean;
  media_url?: string | null;
  metadata?: Record<string, any> | null;
  status: string;
  error_reason?: string | null;
  created_at: string;
}

// Renders WA media fetched with auth headers → blob URL
function MediaMessage({ msgId }: { msgId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isImg, setIsImg] = useState(false);

  useEffect(() => {
    let mounted = true;
    let objectUrl: string | null = null;
    const token = localStorage.getItem('dg_tok');
    fetch(`/api/conversations/media/${msgId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok || !mounted) return null;
        const ct = r.headers.get('content-type') ?? '';
        if (mounted) setIsImg(ct.startsWith('image/'));
        return r.blob();
      })
      .then((blob) => {
        if (blob && mounted) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      })
      .catch(() => null)
      .finally(() => { if (mounted) setLoading(false); });

    return () => {
      mounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [msgId]);

  if (loading) return <div className="w-36 h-24 rounded-lg bg-black/10 animate-pulse" />;
  if (!src) return null;
  if (isImg) return <img src={src} alt="media" className="max-w-[220px] rounded-lg" />;
  return (
    <a href={src} download className="flex items-center gap-2 text-sm underline">
      <Download className="w-4 h-4" /> Download file
    </a>
  );
}

const PAGE_SIZE = 50;

export default function InboxPage() {
  const { staff, quickReplies } = useCrmStore();
  const currentUser = useAuthStore((s) => s.currentUser);

  const [conversations, setConversations]   = useState<ApiConversation[]>([]);
  const [messages, setMessages]             = useState<ApiMessage[]>([]);
  const [selectedId, setSelectedId]         = useState<string | null>(null);
  const [search, setSearch]                 = useState('');
  const [filterTab, setFilterTab]           = useState<FilterTab>('all');
  const [channelFilter, setChannelFilter]   = useState<ChannelFilter>('all');
  const [messageText, setMessageText]       = useState('');
  const [isNote, setIsNote]                 = useState(false);
  const [showAssign, setShowAssign]         = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showList, setShowList]             = useState(true);
  const [sending, setSending]               = useState(false);
  const [hasMore, setHasMore]               = useState(false);
  const [loadingMore, setLoadingMore]       = useState(false);
  const [waAccountFilter, setWaAccountFilter] = useState<string | null>(null);
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);

  const messagesEndRef       = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const selectedIdRef        = useRef<string | null>(null);
  const typingTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef         = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Template picker state (WABA + WA Personal)
  interface WabaTemplate { id: string; name: string; meta_name: string | null; language: string; body: string; header: string | null; status: string; meta_components: any[] | null }
  interface WaPersonalTemplate { id: string; name: string; message: string; file_path?: string | null }
  const [wabaTemplates, setWabaTemplates] = useState<WabaTemplate[]>([]);
  const [waPersonalTemplates, setWaPersonalTemplates] = useState<WaPersonalTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WabaTemplate | null>(null);
  const [templateParamValues, setTemplateParamValues] = useState<Record<string, string[]>>({});
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [showInteractive, setShowInteractive] = useState(false);
  const [interactiveType, setInteractiveType] = useState<'button' | 'list'>('button');
  const [interactiveBody, setInteractiveBody] = useState('');
  const [interactiveButtons, setInteractiveButtons] = useState<Array<{ id: string; title: string }>>([{ id: '1', title: '' }]);
  const [interactiveListTitle, setInteractiveListTitle] = useState('');
  const [interactiveSections, setInteractiveSections] = useState<Array<{ title: string; rows: Array<{ id: string; title: string; description: string }> }>>([
    { title: 'Options', rows: [{ id: '1', title: '', description: '' }] },
  ]);

  const [showNewChat, setShowNewChat]     = useState(false);
  const [newChatPhone, setNewChatPhone]   = useState('');
  const [newChatText, setNewChatText]     = useState('');
  const [newChatSending, setNewChatSending] = useState(false);
  const [waContactSuggestions, setWaContactSuggestions] = useState<{ id: string; name: string; phone: string }[]>([]);

  // Keep ref in sync so socket handlers don't stale-close
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected && !showList) setShowList(true);
  }, [selected]);

  const loadConversations = useCallback(() => {
    api.get<ApiConversation[]>('/api/conversations')
      .then(setConversations)
      .catch(() => toast.error('Failed to load conversations'));
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load a page of messages; `before` is an ISO timestamp for the oldest visible message
  const loadMessages = useCallback(async (convId: string, before?: string) => {
    const url = `/api/conversations/${convId}/messages?limit=${PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const rows = await api.get<ApiMessage[]>(url);
    return rows;
  }, []);

  // When conversation changes: load latest messages, mark read, scroll to bottom
  useEffect(() => {
    if (!selectedId) { setMessages([]); setHasMore(false); return; }
    loadMessages(selectedId).then((rows) => {
      setMessages(rows);
      setHasMore(rows.length >= PAGE_SIZE);
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }));
    }).catch(() => {});
    api.patch(`/api/conversations/${selectedId}/read`, {}).catch(() => {});
    setConversations((prev) =>
      prev.map((c) => c.id === selectedId ? { ...c, unread_count: 0 } : c),
    );
  }, [selectedId, loadMessages]);

  // Scroll to bottom on new outgoing message
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.sender === 'agent') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Load older messages when scrolled to top
  const handleLoadMore = useCallback(async () => {
    if (!selectedId || loadingMore || !hasMore) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingMore(true);
    const container = messagesContainerRef.current;
    const prevHeight = container?.scrollHeight ?? 0;
    try {
      const older = await loadMessages(selectedId, oldest.created_at);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= PAGE_SIZE);
      // Preserve scroll position after prepend
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevHeight;
        }
      });
    } catch {
      toast.error('Failed to load older messages');
    } finally {
      setLoadingMore(false);
    }
  }, [selectedId, messages, loadingMore, hasMore, loadMessages]);

  // Socket: real-time events
  useEffect(() => {
    const socket = getSocket();

    const sortByRecent = (list: ApiConversation[]) =>
      [...list].sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });

    const onNewMessage = (msg: ApiMessage) => {
      setMessages((prev) => {
        if (msg.conversation_id !== selectedIdRef.current) return prev;
        if (prev.some((m) => m.id === msg.id)) return prev; // deduplicate
        return [...prev, msg];
      });
      setConversations((prev) =>
        sortByRecent(prev.map((c) =>
          c.id === msg.conversation_id
            ? {
                ...c,
                last_message:    msg.body,
                last_message_at: msg.created_at,
                unread_count:    msg.sender === 'customer' && c.id !== selectedIdRef.current
                  ? c.unread_count + 1
                  : c.unread_count,
              }
            : c,
        )),
      );
    };

    const onMessageUpdated = (update: Partial<ApiMessage> & { id: string }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === update.id ? { ...m, ...update } : m),
      );
    };

    const onConvUpdated = (conv: ApiConversation) => {
      setConversations((prev) => {
        const base = prev.some((c) => c.id === conv.id)
          ? prev.map((c) => c.id === conv.id ? { ...c, ...conv } : c)
          : [conv, ...prev];
        return sortByRecent(base);
      });
    };

    const onReaction = (data: { message_id: string; conversation_id: string; emoji: string | null }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === data.message_id
          ? { ...m, metadata: { ...m.metadata, reaction: data.emoji ?? undefined } }
          : m),
      );
    };

    socket.on('message:new',     onNewMessage);
    socket.on('message:updated', onMessageUpdated);
    socket.on('message:reaction', onReaction);
    socket.on('conversation:updated', onConvUpdated);
    return () => {
      socket.off('message:new',     onNewMessage);
      socket.off('message:updated', onMessageUpdated);
      socket.off('message:reaction', onReaction);
      socket.off('conversation:updated', onConvUpdated);
    };
  }, []);

  // Load WABA + WA Personal templates on mount
  useEffect(() => {
    api.get<any[]>('/api/templates').then((rows) => {
      const waba = (rows ?? []).filter((t: any) => t.template_type === 'waba' && t.status === 'approved');
      setWabaTemplates(waba);
    }).catch(() => {});
    api.get<any[]>('/api/wa-personal-templates').then((rows) => {
      if (Array.isArray(rows)) setWaPersonalTemplates(rows);
    }).catch(() => {});
  }, []);

  // Count {{N}} placeholders in text
  const countParams = (text: string | null): number => {
    if (!text) return 0;
    const matches = text.match(/\{\{\d+\}\}/g);
    return matches ? new Set(matches).size : 0;
  };

  // Handle template selection
  const handleTemplateSelect = (tpl: WabaTemplate) => {
    setSelectedTemplate(tpl);
    setShowTemplatePicker(false);
    // Pre-fill param values with empty strings
    const bodyCount = countParams(tpl.body);
    const headerCount = countParams(tpl.header);
    const vals: Record<string, string[]> = {};
    if (bodyCount > 0) vals.body = Array(bodyCount).fill('');
    if (headerCount > 0) vals.header = Array(headerCount).fill('');
    setTemplateParamValues(vals);
  };

  // Cancel template selection
  const clearTemplate = () => {
    setSelectedTemplate(null);
    setTemplateParamValues({});
  };

  // Sync WABA templates from Meta
  const syncTemplates = async () => {
    setSyncingTemplates(true);
    try {
      await api.post('/api/templates/sync-waba', {});
      const rows = await api.get<any[]>('/api/templates');
      const waba = (rows ?? []).filter((t: any) => t.template_type === 'waba' && t.status === 'approved');
      setWabaTemplates(waba);
      toast.success(`Synced ${waba.length} template(s) from Meta`);
    } catch {
      toast.error('Failed to sync templates');
    } finally {
      setSyncingTemplates(false);
    }
  };

  // Send template message
  const handleTemplateSend = async () => {
    if (!selectedTemplate || !selectedId || sending) return;
    setSending(true);
    try {
      // Build components array for Meta API
      const components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> = [];
      for (const [compType, values] of Object.entries(templateParamValues)) {
        if (values.length > 0) {
          components.push({
            type: compType,
            parameters: values.map((v) => ({ type: 'text', text: v })),
          });
        }
      }

      const msg = await api.post<ApiMessage>(`/api/conversations/${selectedId}/messages`, {
        body: selectedTemplate.body,
        template_id: selectedTemplate.id,
        template_params: components,
      });
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      setConversations((prev) =>
        prev.map((c) => c.id === selectedId
          ? { ...c, last_message: selectedTemplate.body, last_message_at: new Date().toISOString() }
          : c,
        ),
      );
      clearTemplate();
      toast.success('Template message sent');
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to send template');
    } finally {
      setSending(false);
    }
  };

  const handleSendInteractive = async () => {
    if (!selectedId || !interactiveBody.trim() || sending) return;

    let payload: any;
    if (interactiveType === 'button') {
      const validButtons = interactiveButtons.filter((b) => b.title.trim());
      if (!validButtons.length) { toast.error('Add at least one button'); return; }
      payload = {
        type: 'button',
        body: interactiveBody.trim(),
        buttons: validButtons.map((b, i) => ({ id: String(i + 1), title: b.title.trim() })),
      };
    } else {
      // List type
      const validSections = interactiveSections.map((s) => ({
        title: s.title.trim() || 'Options',
        rows: s.rows.filter((r) => r.title.trim()).map((r) => ({
          id: r.id,
          title: r.title.trim(),
          description: r.description.trim() || undefined,
        })),
      })).filter((s) => s.rows.length > 0);
      if (!validSections.length) { toast.error('Add at least one list item'); return; }
      payload = {
        type: 'list',
        body: interactiveBody.trim(),
        button_text: interactiveListTitle.trim() || 'View Options',
        sections: validSections,
      };
    }

    setSending(true);
    try {
      const msg = await api.post<ApiMessage>(`/api/conversations/${selectedId}/interactive`, payload);
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      setShowInteractive(false);
      setInteractiveBody('');
      setInteractiveType('button');
      setInteractiveButtons([{ id: '1', title: '' }]);
      setInteractiveListTitle('');
      setInteractiveSections([{ title: 'Options', rows: [{ id: '1', title: '', description: '' }] }]);
      toast.success('Interactive message sent');
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  // 24h window detection for WABA conversations
  // Meta only allows free-text within 24h of last customer message
  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null;
  const isWaba = selectedConv?.channel === 'whatsapp';
  const isPersonalWa = selectedConv?.channel === 'personal_wa';

  // Compute last customer message time for window countdown
  const lastCustomerMsgTime = useMemo(() => {
    if (!isWaba) return null;
    const lastCustMsg = [...messages].reverse().find((m) => m.sender === 'customer');
    return lastCustMsg ? new Date(lastCustMsg.created_at).getTime() : null;
  }, [isWaba, messages]);

  // Live countdown ticker (updates every 30s)
  const [windowTick, setWindowTick] = useState(Date.now());
  useEffect(() => {
    if (!isWaba || !lastCustomerMsgTime) return;
    const remaining = (lastCustomerMsgTime + 24 * 60 * 60 * 1000) - Date.now();
    if (remaining <= 0) return;
    const timer = setInterval(() => setWindowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [isWaba, lastCustomerMsgTime]);

  // Check if WABA 24h window is still open
  const wabaWindowOpen = (() => {
    if (!isWaba) return true;
    if (!lastCustomerMsgTime) return false;
    return (lastCustomerMsgTime + 24 * 60 * 60 * 1000) > windowTick;
  })();

  // Remaining time in the window (ms)
  const wabaWindowRemaining = (() => {
    if (!isWaba || !lastCustomerMsgTime) return 0;
    return Math.max(0, (lastCustomerMsgTime + 24 * 60 * 60 * 1000) - windowTick);
  })();

  // Format remaining time as "Xh Ym"
  const windowCountdown = (() => {
    if (wabaWindowRemaining <= 0) return '';
    const totalMins = Math.floor(wabaWindowRemaining / 60_000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  })();

  // For WABA with expired window, force template-only mode
  const forceTemplateMode = isWaba && !wabaWindowOpen;

  const getInitials = (name: string | null | undefined, phone: string | null | undefined) => {
    const display = name || phone || '?';
    return display.split(' ').map((n) => n[0] || '').join('').slice(0, 2).toUpperCase() || '?';
  };

  // Derive distinct WA personal accounts from conversation list
  const waAccounts = Array.from(
    new Set(conversations.filter((c) => c.channel === 'personal_wa' && c.wa_account).map((c) => c.wa_account!))
  );

  const filtered = conversations.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      const matchName  = (c.lead_name  || '').toLowerCase().includes(q);
      const matchPhone = (c.lead_phone || '').toLowerCase().includes(q);
      if (!matchName && !matchPhone) return false;
    }
    if (channelFilter === 'waba'        && c.channel !== 'whatsapp')    return false;
    if (channelFilter === 'personal_wa' && c.channel !== 'personal_wa') return false;
    if (waAccountFilter && c.wa_account !== waAccountFilter)            return false;
    if (filterTab === 'mine')       return c.assigned_to === currentUser?.id;
    if (filterTab === 'unread')     return c.unread_count > 0;
    if (filterTab === 'unassigned') return !c.assigned_to;
    if (filterTab === 'resolved')   return c.status === 'resolved';
    return true;
  });

  const handleSend = async () => {
    if (!messageText.trim() || !selectedId || sending) return;
    setSending(true);
    // Stop any typing presence update
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    try {
      const msg = await api.post<ApiMessage>(`/api/conversations/${selectedId}/messages`, {
        body: messageText.trim(),
        is_note: isNote,
      });
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      if (!isNote) {
        setConversations((prev) =>
          prev.map((c) => c.id === selectedId
            ? { ...c, last_message: messageText.trim(), last_message_at: new Date().toISOString() }
            : c,
          ),
        );
      }
      if (msg.status === 'failed') {
        toast.error('Message saved but could not be delivered — check WhatsApp Personal connection');
      }
      setMessageText('');
      setIsNote(false);
      setShowQuickReplies(false);
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Typing indicator — sends presence once per 3s typing session (not on every keypress)
  const handleTypingChange = (val: string) => {
    setMessageText(val);
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (conv?.channel !== 'personal_wa' || !conv.lead_phone) return;
    if (!typingTimeoutRef.current) {
      // Only call the API at the START of a new typing session
      api.post(`/api/conversations/${selectedId}/typing`, {}).catch(() => null);
    } else {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null;
    }, 3000);
  };

  const handleFileUpload = async (file: File) => {
    if (!selectedId || uploading) return;
    const MAX_MB = 25;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`File too large — max ${MAX_MB} MB`);
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('dg_tok');
      const res   = await fetch(`/api/conversations/${selectedId}/media`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        toast.error(err.error ?? 'Upload failed');
        return;
      }
      const msg: ApiMessage = await res.json();
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
      if (msg.status === 'failed') {
        toast.error('File saved but could not be delivered — check WhatsApp Personal connection');
      }
    } catch {
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleNewChat = async () => {
    const digits = newChatPhone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      toast.error('Enter a valid phone number (7–15 digits)');
      return;
    }
    if (!newChatText.trim()) {
      toast.error('Enter a message to send');
      return;
    }
    setNewChatSending(true);
    try {
      // POST to a new-conversation endpoint (creates conv + sends first message)
      const res = await api.post<{ conversation_id: string; message: ApiMessage }>(
        '/api/conversations/new',
        { phone: digits, body: newChatText.trim() },
      );
      await loadConversations();
      setSelectedId(res.conversation_id);
      setShowList(false);
      setShowNewChat(false);
      setNewChatPhone('');
      setNewChatText('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to start conversation');
    } finally {
      setNewChatSending(false);
    }
  };

  const handleAssign = async (staffId: string) => {
    if (!selectedId) return;
    const isUnassign = !staffId;
    try {
      await api.patch(`/api/conversations/${selectedId}/assign`, { assigned_to: isUnassign ? null : staffId });
      const member = staff.find((s) => s.id === staffId);
      setConversations((prev) =>
        prev.map((c) => c.id === selectedId
          ? { ...c, assigned_to: isUnassign ? null : staffId, assigned_name: isUnassign ? null : (member?.name ?? null) }
          : c,
        ),
      );
      toast.success(isUnassign ? 'Unassigned' : `Assigned to ${member?.name ?? 'staff'}`);
    } catch { toast.error('Failed to assign'); }
    setShowAssign(false);
  };

  const handleStatus = async (status: 'open' | 'resolved') => {
    if (!selectedId) return;
    try {
      await api.patch(`/api/conversations/${selectedId}/status`, { status });
      setConversations((prev) =>
        prev.map((c) => c.id === selectedId ? { ...c, status } : c),
      );
      toast.success(status === 'resolved' ? 'Conversation resolved' : 'Conversation reopened');
    } catch { toast.error('Failed to update status'); }
  };

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    setShowList(false);
  };

  const handleBack = () => {
    setShowList(true);
    setSelectedId(null);
  };

  const formatMsgDate = (ts: string) => {
    const d = new Date(ts);
    if (isToday(d))     return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMM d');
  };

  const unreadCount = conversations.filter((c) => c.unread_count > 0).length;
  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'mine', label: 'Mine' },
    { key: 'unread', label: 'Unread', count: unreadCount },
    { key: 'unassigned', label: 'Unassigned' },
    { key: 'resolved', label: 'Resolved' },
  ];

  const assignedStaff = selected ? staff.find((s) => s.id === selected.assigned_to) : null;

  return (
    <div className="animate-fade-in -mx-3 -my-4 md:-mx-6 md:-my-5 flex min-w-0" style={{ height: 'calc(100dvh - 64px)', overflow: 'hidden' }}>

      {/* Conversation List */}
      <div className={cn('w-full sm:w-80 border-r border-black/5 flex flex-col bg-[#fdf9f7] shrink-0', !showList && 'hidden sm:flex')}>
        <div className="px-3 pt-4 pb-3 border-b border-orange-100 space-y-2.5 bg-[#faf4ef]">
          {/* Row 1: search bar + New button */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/50" />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-orange-200 bg-white placeholder:text-[#b8a89a] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
                placeholder="Search conversations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              onClick={() => setShowNewChat(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
              title="Start a new chat">
              <span className="text-base leading-none">+</span> New
            </button>
          </div>

          {/* Row 2: status tabs + funnel filter icon */}
          <div className="flex items-center gap-1">
            <div className="flex gap-1 overflow-x-auto flex-1 pb-0.5 scrollbar-hide">
              {tabs.map(({ key, label }) => {
                const count = key === 'unread'     ? conversations.filter((c) => c.unread_count > 0).length
                  : key === 'unassigned' ? conversations.filter((c) => !c.assigned_to).length : 0;
                return (
                  <button key={key} onClick={() => setFilterTab(key)}
                    className={cn('px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors flex items-center gap-1',
                      filterTab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-[var(--accent-tint)]')}>
                    {label}
                    {count > 0 && <span className={cn('text-[10px] rounded-full px-1', filterTab === key ? 'bg-white/20' : 'bg-primary/10 text-primary')}>{count}</span>}
                  </button>
                );
              })}
            </div>

            {/* Channel filter — funnel icon only, highlights when active */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowChannelDropdown((v) => !v)}
                title="Filter by channel"
                className={cn('w-7 h-7 rounded-full flex items-center justify-center transition-colors',
                  channelFilter !== 'all' || waAccountFilter
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-[var(--accent-tint)]')}>
                <Filter className="w-3.5 h-3.5" />
              </button>
              {showChannelDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowChannelDropdown(false)} />
                  <div className="absolute right-0 top-9 z-50 bg-card border border-black/10 rounded-xl shadow-xl w-44 py-1">
                    <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Channel</p>
                    {([
                      { key: 'all' as ChannelFilter, label: 'All Channels' },
                      { key: 'waba' as ChannelFilter, label: 'WA Business', Icon: MessageCircle, color: 'text-emerald-600' },
                      { key: 'personal_wa' as ChannelFilter, label: 'WA Personal', Icon: Smartphone, color: 'text-teal-600' },
                    ]).map(({ key, label, Icon: Ic, color }) => (
                      <button key={key}
                        onClick={() => { setChannelFilter(key); if (key !== 'personal_wa') setWaAccountFilter(null); setShowChannelDropdown(false); }}
                        className={cn('w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--accent-tint)] transition-colors',
                          channelFilter === key && !waAccountFilter ? 'text-primary font-medium' : 'text-foreground')}>
                        {Ic ? <Ic className={cn('w-3.5 h-3.5', color)} /> : <div className="w-3.5" />}
                        {label}
                        {channelFilter === key && !waAccountFilter && <Check className="w-3 h-3 ml-auto text-primary" />}
                      </button>
                    ))}
                    {waAccounts.length > 1 && (
                      <div className="border-t border-black/5 mt-1 pt-1">
                        <p className="px-3 pt-0.5 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Account</p>
                        <button
                          onClick={() => { setChannelFilter('personal_wa'); setWaAccountFilter(null); setShowChannelDropdown(false); }}
                          className={cn('w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--accent-tint)] transition-colors',
                            channelFilter === 'personal_wa' && !waAccountFilter ? 'text-primary font-medium' : 'text-foreground')}>
                          <Smartphone className="w-3.5 h-3.5 text-teal-600" /> All Numbers
                          {channelFilter === 'personal_wa' && !waAccountFilter && <Check className="w-3 h-3 ml-auto text-primary" />}
                        </button>
                        {waAccounts.map((acc) => (
                          <button key={acc}
                            onClick={() => { setChannelFilter('personal_wa'); setWaAccountFilter(acc); setShowChannelDropdown(false); }}
                            className={cn('w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--accent-tint)] transition-colors',
                              waAccountFilter === acc ? 'text-primary font-medium' : 'text-foreground')}>
                            <Smartphone className="w-3.5 h-3.5 text-teal-600" /> +{acc.slice(-10)}
                            {waAccountFilter === acc && <Check className="w-3 h-3 ml-auto text-primary" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
              <MessageCircle className="w-10 h-10 text-orange-200 mb-1" />
              <p className="text-[13px] font-semibold text-[#1c1410]">No conversations yet</p>
              <p className="text-[12px] text-[#7a6b5c]">Connect WhatsApp in <strong>Settings → WhatsApp Setup</strong> to start receiving messages here.</p>
            </div>
          )}
          {filtered.map((conv) => (
            <button key={conv.id} onClick={() => handleSelectConversation(conv.id)}
              className={cn('w-full text-left px-4 py-3 border-b border-orange-50 hover:bg-[#fef3ea] transition-colors flex gap-3',
                conv.id === selectedId ? 'bg-[var(--accent-tint)] border-l-2 border-l-primary' : 'border-l-2 border-l-transparent')}>
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                {getInitials(conv.lead_name, conv.lead_phone)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <span className="font-medium text-sm text-foreground truncate">{conv.lead_name || conv.lead_phone || 'Unknown'}</span>
                  {conv.last_message_at && (() => {
                    const d = new Date(conv.last_message_at);
                    return (
                      <div className="text-right shrink-0">
                        {!isToday(d) && (
                          <p className="text-[10px] text-[#7a6b5c]">{isYesterday(d) ? 'Yesterday' : format(d, 'MMM d')}</p>
                        )}
                        <p className="text-[10px] text-[#7a6b5c]">{format(d, 'h:mm a')}</p>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-1">
                  {conv.channel === 'personal_wa'
                    ? <Smartphone className="w-3 h-3 text-teal-500 shrink-0" />
                    : <MessageCircle className="w-3 h-3 text-green-500 shrink-0" />}
                  <p className="text-[11px] text-[#7a6b5c] truncate">
                    {conv.last_message?.replace(/^\[Template:\s*[^\]]+\]\s*/, '') || conv.last_message}
                  </p>
                </div>
              </div>
              {conv.unread_count > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-semibold shrink-0 self-center">
                  {conv.unread_count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Message Thread */}
      <div className={cn('flex-1 flex flex-col bg-[#fdf9f7]', showList && 'hidden sm:flex')}>
        {selected ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-orange-100 bg-[#faf4ef]">
              <div className="flex items-center gap-3">
                <button onClick={handleBack} className="sm:hidden p-1 hover:bg-[var(--accent-tint)] rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold">
                  {getInitials(selected.lead_name, selected.lead_phone)}
                </div>
                <div>
                  <h3 className="font-headline font-bold text-[#1c1410]">{selected.lead_name || selected.lead_phone || 'Unknown'}</h3>
                  {selected.lead_phone && (
                    <a href={`tel:${selected.lead_phone}`} className="text-[11px] text-[#7a6b5c] hover:text-primary transition-colors">{selected.lead_phone}</a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={cn('text-xs',
                  selected.status === 'open'     && 'bg-green-100 text-green-700',
                  selected.status === 'pending'  && 'bg-yellow-100 text-yellow-700',
                  selected.status === 'resolved' && 'bg-muted text-muted-foreground')}>
                  {selected.status}
                </Badge>

                {/* 24h window countdown for WABA */}
                {isWaba && lastCustomerMsgTime && (
                  wabaWindowOpen ? (
                    <Badge variant="secondary" className={cn('text-[10px] gap-1 font-mono',
                      wabaWindowRemaining < 2 * 60 * 60_000
                        ? 'bg-red-50 text-red-600 border border-red-200'
                        : wabaWindowRemaining < 6 * 60 * 60_000
                        ? 'bg-amber-50 text-amber-600 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-600 border border-emerald-200')}>
                      <Clock className="w-3 h-3" />
                      {windowCountdown}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] bg-red-50 text-red-500 border border-red-200 gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Expired
                    </Badge>
                  )
                )}

                {/* Assign dropdown */}
                <div className="relative">
                  <Button variant="outline" size="sm" onClick={() => setShowAssign(!showAssign)} className="flex items-center gap-1 border-orange-200 hover:bg-[#fef3ea]">
                    <UserCheck className="w-4 h-4" />
                    <span className="hidden sm:inline">{assignedStaff ? assignedStaff.name.split(' ')[0] : selected.assigned_name ? selected.assigned_name.split(' ')[0] : 'Assign'}</span>
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                  {showAssign && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowAssign(false)} />
                      <div className="absolute right-0 top-10 bg-white border border-orange-100 rounded-xl shadow-xl z-50 w-52 py-1">
                        <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[#7a6b5c] uppercase tracking-wider">Assign to</p>
                        {staff.filter((s) => s.status === 'active').length === 0 ? (
                          <p className="px-3 py-3 text-xs text-[#7a6b5c] text-center">No active staff members</p>
                        ) : (
                          staff.filter((s) => s.status === 'active').map((s) => (
                            <button key={s.id} onClick={() => handleAssign(s.id)}
                              className={cn('w-full text-left px-3 py-2 text-sm hover:bg-[#fef3ea] flex items-center gap-2 transition-colors',
                                selected.assigned_to === s.id && 'text-primary font-medium bg-orange-50')}>
                              <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                                {getInitials(s.name, null)}
                              </div>
                              <span className="truncate">{s.name}</span>
                              {selected.assigned_to === s.id && <Check className="w-3.5 h-3.5 ml-auto shrink-0 text-primary" />}
                            </button>
                          ))
                        )}
                        {selected.assigned_to && (
                          <div className="border-t border-orange-50 mt-1 pt-1">
                            <button onClick={() => handleAssign('')}
                              className="w-full text-left px-3 py-2 text-xs text-[#7a6b5c] hover:bg-[#fef3ea] transition-colors flex items-center gap-2">
                              <X className="w-3.5 h-3.5" /> Unassign
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {selected.status === 'resolved'
                  ? <Button variant="outline" size="sm" onClick={() => handleStatus('open')}>Reopen</Button>
                  : <Button variant="outline" size="sm" onClick={() => handleStatus('resolved')}>Resolve</Button>
                }
              </div>
            </div>

            {/* Messages */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#fdf9f7]">
              {/* Load older messages */}
              {hasMore && (
                <div className="flex justify-center py-2">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="text-xs text-[#7a6b5c] hover:text-primary flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-50">
                    {loadingMore
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                      : 'Load older messages'}
                  </button>
                </div>
              )}

              {messages.map((msg, i) => {
                const showDate = i === 0 || formatMsgDate(msg.created_at) !== formatMsgDate(messages[i - 1].created_at);
                const isDeleted = msg.is_deleted;
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="text-center my-4">
                        <span className="text-[11px] text-[#7a6b5c] bg-muted px-3 py-1 rounded-full">{formatMsgDate(msg.created_at)}</span>
                      </div>
                    )}
                    <div className={cn('flex', msg.sender === 'agent' ? 'justify-end' : 'justify-start')}>
                      <div className="relative">
                      <div className={cn('max-w-[70%] p-3 text-sm',
                        isDeleted                 ? 'bg-muted rounded-2xl'
                          : msg.is_note           ? 'bg-yellow-50 border border-yellow-200 rounded-2xl'
                          : msg.sender === 'customer' ? 'bg-muted rounded-2xl rounded-tl-sm'
                          : msg.status === 'failed'   ? 'bg-red-500/80 text-white rounded-2xl rounded-tr-sm'
                          : 'bg-primary text-primary-foreground rounded-2xl rounded-tr-sm')}>

                        {msg.is_note && !isDeleted && (
                          <p className="text-[10px] font-semibold text-yellow-600 mb-1 flex items-center gap-1">
                            <StickyNote className="w-3 h-3" /> Internal Note
                          </p>
                        )}

                        {/* Media attachment (if downloaded) */}
                        {msg.media_url && !isDeleted && (
                          <div className="mb-1.5">
                            <MediaMessage msgId={msg.id} />
                          </div>
                        )}

                        {/* Location message */}
                        {msg.metadata?.type === 'location' && !isDeleted && (
                          <a
                            href={`https://maps.google.com/?q=${msg.metadata.latitude},${msg.metadata.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block mb-1.5 rounded-lg overflow-hidden border border-black/10 hover:opacity-90 transition-opacity"
                          >
                            <img
                              src={`https://maps.googleapis.com/maps/api/staticmap?center=${msg.metadata.latitude},${msg.metadata.longitude}&zoom=15&size=280x150&markers=color:red%7C${msg.metadata.latitude},${msg.metadata.longitude}&key=`}
                              alt="Location"
                              className="w-full h-[100px] object-cover bg-gray-100"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            <div className="px-3 py-2 flex items-start gap-2">
                              <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                {msg.metadata.name && <p className="text-xs font-semibold text-[#1c1410] truncate">{msg.metadata.name}</p>}
                                <p className="text-[11px] text-[#7a6b5c] truncate">
                                  {msg.metadata.address || `${msg.metadata.latitude}, ${msg.metadata.longitude}`}
                                </p>
                              </div>
                            </div>
                          </a>
                        )}

                        {/* Contact card message */}
                        {msg.metadata?.type === 'contacts' && !isDeleted && (
                          <div className="mb-1.5 space-y-1.5">
                            {(msg.metadata.contacts ?? []).map((ct: any, ci: number) => (
                              <div key={ci} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-black/10 bg-white/50">
                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                  <Contact className="w-4 h-4 text-blue-600" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-[#1c1410] truncate">{ct.name}</p>
                                  {ct.phones?.[0]?.phone && (
                                    <p className="text-[11px] text-[#7a6b5c]">{ct.phones[0].phone}</p>
                                  )}
                                  {ct.emails?.[0]?.email && (
                                    <p className="text-[11px] text-[#7a6b5c] truncate">{ct.emails[0].email}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {(() => {
                          // Detect template messages: "[Template: name] body"
                          const tplMatch = !isDeleted && !msg.is_note && msg.body?.match(/^\[Template:\s*([^\]]+)\]\s*([\s\S]*)$/);
                          if (tplMatch) {
                            const tplName = tplMatch[1].trim();
                            const tplBody = tplMatch[2].trim();
                            return (
                              <div>
                                <div className={cn(
                                  'flex items-center gap-1.5 mb-1.5 pb-1.5 border-b',
                                  msg.sender === 'agent' ? 'border-primary-foreground/20' : 'border-black/10',
                                )}>
                                  <FileText className={cn('w-3 h-3 shrink-0', msg.sender === 'agent' ? 'text-primary-foreground/70' : 'text-muted-foreground')} />
                                  <span className={cn('text-[10px] font-semibold uppercase tracking-wide', msg.sender === 'agent' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                                    Template: {tplName}
                                  </span>
                                </div>
                                <p className="whitespace-pre-wrap">{tplBody}</p>
                              </div>
                            );
                          }
                          return (
                            <p className={cn(
                              'whitespace-pre-wrap',
                              msg.is_note && !isDeleted    ? 'text-yellow-800' : '',
                              isDeleted                    ? 'text-muted-foreground italic text-xs' : '',
                            )}>
                              {msg.body}
                            </p>
                          );
                        })()}

                        <div className={cn('flex items-center gap-1 mt-1', msg.sender === 'agent' ? 'justify-end' : '')}>
                          <span className={cn('text-xs',
                            isDeleted                    ? 'text-muted-foreground'
                              : msg.is_note              ? 'text-yellow-600'
                              : msg.sender === 'customer'? 'text-muted-foreground'
                              : 'text-primary-foreground/70')}>
                            {format(new Date(msg.created_at), 'HH:mm')}
                          </span>
                          {msg.sender === 'agent' && !msg.is_note && !isDeleted && msg.status === 'read'      && <CheckCheck className="w-3 h-3 text-blue-300" />}
                          {msg.sender === 'agent' && !msg.is_note && !isDeleted && msg.status === 'delivered' && <CheckCheck className="w-3 h-3 text-primary-foreground/50" />}
                          {msg.sender === 'agent' && !msg.is_note && !isDeleted && msg.status === 'sent'      && <Check className="w-3 h-3 text-primary-foreground/50" />}
                          {msg.sender === 'agent' && !msg.is_note && !isDeleted && msg.status === 'failed'    && (
                            <AlertCircle className="w-3 h-3 text-red-200" title={msg.error_reason || 'Delivery failed'} />
                          )}
                        </div>
                        {msg.sender === 'agent' && msg.status === 'failed' && msg.error_reason && (
                          <p className="text-[10px] text-red-300 mt-0.5">{msg.error_reason}</p>
                        )}
                      </div>
                      {/* Reaction emoji badge */}
                      {msg.metadata?.reaction && (
                        <div className={cn('absolute -bottom-2.5 bg-white border border-black/10 rounded-full px-1.5 py-0.5 shadow-sm text-sm leading-none',
                          msg.sender === 'agent' ? 'left-1' : 'right-1')}>
                          {msg.metadata.reaction}
                        </div>
                      )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Replies */}
            {showQuickReplies && (
              <div className="border-t border-black/5 bg-[var(--app-bg)] p-3 max-h-48 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c]">Quick Replies</p>
                  <button onClick={() => setShowQuickReplies(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
                </div>
                <div className="space-y-1.5">
                  {quickReplies.map((qr) => (
                    <button key={qr.id} onClick={() => { setMessageText(qr.content); setShowQuickReplies(false); }}
                      className="w-full text-left p-2 rounded-lg hover:bg-background border border-black/5 text-sm transition-colors">
                      <p className="font-medium text-foreground text-xs">{qr.title}</p>
                      <p className="text-muted-foreground text-xs truncate">{qr.content}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className={cn('border-t border-orange-100 p-3 bg-[#faf4ef] relative', isNote && 'bg-yellow-50')}>
              {/* 24h window expired banner for WABA */}
              {forceTemplateMode && !isNote && !selectedTemplate && (() => {
                const hasCustomerMsg = messages.some((m) => m.sender === 'customer');
                return (
                  <div className="mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {hasCustomerMsg
                        ? '24h conversation window expired. '
                        : 'Waiting for customer reply to open the conversation window. '}
                      You can only send an <button onClick={() => setShowTemplatePicker(true)} className="font-bold underline">approved template</button>{hasCustomerMsg ? ' to re-open it' : ' or wait for a reply'}.
                    </span>
                  </div>
                );
              })()}
              {isNote && (
                <p className="text-xs font-semibold text-yellow-600 mb-2 flex items-center gap-1">
                  <StickyNote className="w-3 h-3" /> Internal Note — not visible to customer
                </p>
              )}
              <div className="flex items-end gap-2">
                <div className="flex gap-1">
                  <button onClick={() => setShowQuickReplies(!showQuickReplies)}
                    className={cn('p-2 rounded-lg transition-colors', showQuickReplies ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-[var(--accent-tint)]')}
                    title="Quick replies"><Zap className="w-5 h-5" /></button>
                  <button onClick={() => setIsNote(!isNote)}
                    className={cn('p-2 rounded-lg transition-colors', isNote ? 'bg-yellow-200 text-yellow-700' : 'text-muted-foreground hover:text-foreground hover:bg-[var(--accent-tint)]')}
                    title="Internal note"><StickyNote className="w-5 h-5" /></button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || isNote}
                    className={cn('p-2 rounded-lg transition-colors',
                      uploading || isNote
                        ? 'text-muted-foreground/40 cursor-not-allowed'
                        : 'text-muted-foreground hover:text-foreground hover:bg-[var(--accent-tint)]')}
                    title="Send image or file">
                    {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                  />
                  {/* Template picker button — for WABA and Personal WA conversations */}
                  {(isWaba || isPersonalWa) && !isNote && (
                    <button
                      onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                      className={cn('p-2 rounded-lg transition-colors',
                        showTemplatePicker || selectedTemplate
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'text-muted-foreground hover:text-foreground hover:bg-[var(--accent-tint)]')}
                      title="Send template message">
                      <FileText className="w-5 h-5" />
                    </button>
                  )}
                  {/* Interactive message button — WABA only */}
                  {isWaba && !isNote && (
                    <button
                      onClick={() => setShowInteractive(!showInteractive)}
                      className={cn('p-2 rounded-lg transition-colors',
                        showInteractive
                          ? 'bg-violet-100 text-violet-700'
                          : 'text-muted-foreground hover:text-foreground hover:bg-[var(--accent-tint)]')}
                      title="Send buttons / interactive message">
                      <ListOrdered className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {/* Template picker dropdown — channel-aware */}
                {showTemplatePicker && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 mx-3 bg-white rounded-xl border border-black/10 shadow-lg z-30 max-h-72 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-black/5">
                      <span className="text-xs font-semibold text-[#1c1410]">
                        {isWaba ? 'WABA Templates' : 'WA Personal Templates'}
                      </span>
                      <div className="flex items-center gap-1">
                        {isWaba && (
                          <button onClick={syncTemplates} disabled={syncingTemplates}
                            className="text-xs text-[#c2410c] hover:underline flex items-center gap-1">
                            <RefreshCw className={cn('w-3 h-3', syncingTemplates && 'animate-spin')} />
                            Sync
                          </button>
                        )}
                        <button onClick={() => setShowTemplatePicker(false)} className="p-1 rounded hover:bg-black/5">
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {isWaba ? (
                        wabaTemplates.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            <p>No approved WABA templates found.</p>
                            <button onClick={syncTemplates} disabled={syncingTemplates}
                              className="mt-2 text-[#c2410c] hover:underline text-xs">
                              {syncingTemplates ? 'Syncing...' : 'Sync from Meta'}
                            </button>
                          </div>
                        ) : wabaTemplates.map((tpl) => (
                          <button key={tpl.id} onClick={() => handleTemplateSelect(tpl)}
                            className="w-full text-left px-3 py-2.5 border-b border-black/5 last:border-0 hover:bg-[#faf8f6] transition-colors">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-[#1c1410]">{tpl.name}</span>
                              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">{tpl.language}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tpl.body}</p>
                          </button>
                        ))
                      ) : (
                        waPersonalTemplates.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            <p>No personal templates found.</p>
                            <p className="text-xs mt-1">Create templates under Automation → Templates → WA Personal.</p>
                          </div>
                        ) : waPersonalTemplates.map((tpl) => (
                          <button key={tpl.id} onClick={() => { setMessageText(tpl.message); setShowTemplatePicker(false); }}
                            className="w-full text-left px-3 py-2.5 border-b border-black/5 last:border-0 hover:bg-[#faf8f6] transition-colors">
                            <span className="text-sm font-medium text-[#1c1410]">{tpl.name}</span>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tpl.message}</p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Interactive message composer — WABA only */}
                {showInteractive && isWaba && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 mx-3 bg-white rounded-xl border border-black/10 shadow-lg z-30 p-3 space-y-3 max-h-80 overflow-y-auto">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#1c1410]">Interactive Message</span>
                        <select value={interactiveType} onChange={(e) => setInteractiveType(e.target.value as 'button' | 'list')}
                          className="text-xs border border-black/10 rounded-md px-2 py-0.5 bg-white">
                          <option value="button">Buttons</option>
                          <option value="list">List Menu</option>
                        </select>
                      </div>
                      <button onClick={() => setShowInteractive(false)} className="p-1 rounded hover:bg-black/5">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <textarea
                      className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-violet-300"
                      rows={2}
                      placeholder="Message body text..."
                      value={interactiveBody}
                      onChange={(e) => setInteractiveBody(e.target.value)}
                    />

                    {interactiveType === 'button' ? (
                      <div className="space-y-2">
                        <span className="text-[11px] font-medium text-[#7a6b5c]">Reply Buttons (max 3)</span>
                        {interactiveButtons.map((btn, idx) => (
                          <div key={btn.id} className="flex items-center gap-2">
                            <Input className="flex-1 text-sm h-8" placeholder={`Button ${idx + 1} label`} maxLength={20}
                              value={btn.title} onChange={(e) => {
                                const copy = [...interactiveButtons];
                                copy[idx] = { ...copy[idx], title: e.target.value };
                                setInteractiveButtons(copy);
                              }} />
                            {interactiveButtons.length > 1 && (
                              <button onClick={() => setInteractiveButtons(interactiveButtons.filter((_, i) => i !== idx))}
                                className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                        {interactiveButtons.length < 3 && (
                          <button onClick={() => setInteractiveButtons([...interactiveButtons, { id: String(interactiveButtons.length + 1), title: '' }])}
                            className="text-xs text-violet-600 hover:underline">+ Add button</button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input className="text-sm h-8" placeholder="Menu button text (e.g. View Options)" maxLength={20}
                          value={interactiveListTitle} onChange={(e) => setInteractiveListTitle(e.target.value)} />
                        {interactiveSections.map((sec, si) => (
                          <div key={si} className="border border-black/5 rounded-lg p-2 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Input className="flex-1 text-xs h-7" placeholder="Section title"
                                value={sec.title} onChange={(e) => {
                                  const copy = [...interactiveSections];
                                  copy[si] = { ...copy[si], title: e.target.value };
                                  setInteractiveSections(copy);
                                }} />
                              {interactiveSections.length > 1 && (
                                <button onClick={() => setInteractiveSections(interactiveSections.filter((_, i) => i !== si))}
                                  className="p-0.5 rounded text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                              )}
                            </div>
                            {sec.rows.map((row, ri) => (
                              <div key={row.id} className="flex items-center gap-1.5 pl-2">
                                <Input className="flex-1 text-xs h-7" placeholder="Item title" maxLength={24}
                                  value={row.title} onChange={(e) => {
                                    const copy = [...interactiveSections];
                                    copy[si].rows[ri] = { ...row, title: e.target.value };
                                    setInteractiveSections(copy);
                                  }} />
                                <Input className="flex-1 text-xs h-7" placeholder="Description (optional)" maxLength={72}
                                  value={row.description} onChange={(e) => {
                                    const copy = [...interactiveSections];
                                    copy[si].rows[ri] = { ...row, description: e.target.value };
                                    setInteractiveSections(copy);
                                  }} />
                                {sec.rows.length > 1 && (
                                  <button onClick={() => {
                                    const copy = [...interactiveSections];
                                    copy[si] = { ...copy[si], rows: copy[si].rows.filter((_, i) => i !== ri) };
                                    setInteractiveSections(copy);
                                  }} className="p-0.5 rounded text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                                )}
                              </div>
                            ))}
                            {sec.rows.length < 10 && (
                              <button onClick={() => {
                                const copy = [...interactiveSections];
                                copy[si] = { ...copy[si], rows: [...copy[si].rows, { id: String(Date.now()), title: '', description: '' }] };
                                setInteractiveSections(copy);
                              }} className="text-[11px] text-violet-600 hover:underline pl-2">+ Add item</button>
                            )}
                          </div>
                        ))}
                        {interactiveSections.length < 10 && (
                          <button onClick={() => setInteractiveSections([...interactiveSections, { title: '', rows: [{ id: String(Date.now()), title: '', description: '' }] }])}
                            className="text-xs text-violet-600 hover:underline">+ Add section</button>
                        )}
                      </div>
                    )}

                    <Button onClick={handleSendInteractive} disabled={!interactiveBody.trim() || sending} className="w-full bg-violet-600 hover:bg-violet-700">
                      {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                      Send {interactiveType === 'button' ? 'Buttons' : 'List'}
                    </Button>
                  </div>
                )}

                {/* Selected template preview + param fill */}
                {selectedTemplate ? (
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-emerald-700">Template: {selectedTemplate.name}</span>
                        <button onClick={clearTemplate} className="text-muted-foreground hover:text-foreground">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-[#4a3c30] whitespace-pre-line">{selectedTemplate.body}</p>
                    </div>
                    {/* Parameter inputs */}
                    {Object.entries(templateParamValues).map(([compType, values]) =>
                      values.map((val, idx) => (
                        <Input
                          key={`${compType}-${idx}`}
                          className="text-sm"
                          placeholder={`${compType === 'header' ? 'Header' : 'Body'} parameter {{${idx + 1}}}`}
                          value={val}
                          onChange={(e) => {
                            const copy = { ...templateParamValues };
                            copy[compType] = [...copy[compType]];
                            copy[compType][idx] = e.target.value;
                            setTemplateParamValues(copy);
                          }}
                        />
                      ))
                    )}
                    <Button onClick={handleTemplateSend} disabled={sending} className="w-full">
                      {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                      Send Template
                    </Button>
                  </div>
                ) : forceTemplateMode && !isNote ? (
                  <div className="flex-1 flex items-center gap-2">
                    <Button variant="outline" onClick={() => setShowTemplatePicker(true)} className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50">
                      <FileText className="w-4 h-4 mr-2" />
                      Select a Template to Send
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      className={cn('flex-1', isNote && 'border-yellow-300 bg-yellow-50 focus-visible:ring-yellow-200')}
                      placeholder={isNote ? 'Write an internal note...' : 'Type a message...'}
                      value={messageText}
                      onChange={(e) => handleTypingChange(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    />
                    <Button onClick={handleSend} disabled={!messageText.trim() || sending}
                      className={isNote ? 'bg-yellow-500 hover:bg-yellow-600' : ''}>
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="font-medium">Select a conversation</p>
              <p className="text-sm mt-1">Choose from the list to start messaging</p>
            </div>
          </div>
        )}
      </div>
      {/* New Chat Modal */}
      {showNewChat && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#1c1410]">New Chat</h3>
              <button onClick={() => { setShowNewChat(false); setWaContactSuggestions([]); }}>
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="relative">
                <label className="text-xs font-semibold text-[#7a6b5c] mb-1 block">Search contact or enter number</label>
                <Input
                  placeholder="Name or phone with country code"
                  value={newChatPhone}
                  onChange={(e) => {
                    setNewChatPhone(e.target.value);
                    const q = e.target.value.trim();
                    if (q.length >= 2) {
                      api.get<{ id: string; name: string; phone: string }[]>(`/api/conversations/wa-contacts?q=${encodeURIComponent(q)}`)
                        .then(setWaContactSuggestions)
                        .catch(() => setWaContactSuggestions([]));
                    } else {
                      setWaContactSuggestions([]);
                    }
                  }}
                />
                {waContactSuggestions.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-card border border-black/10 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {waContactSuggestions.map((c) => (
                      <button key={c.id}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--accent-tint)] transition-colors flex items-center gap-2"
                        onClick={() => { setNewChatPhone(c.phone); setWaContactSuggestions([]); }}>
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#1c1410]">{c.name}</p>
                          <p className="text-[11px] text-muted-foreground">+{c.phone}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Digits only for direct entry, e.g. 91XXXXXXXXXX</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#7a6b5c] mb-1 block">First Message</label>
                <textarea
                  className="w-full border border-input rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                  rows={3}
                  placeholder="Type your message..."
                  value={newChatText}
                  onChange={(e) => setNewChatText(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setShowNewChat(false); setWaContactSuggestions([]); }}>Cancel</Button>
              <Button onClick={handleNewChat} disabled={newChatSending}>
                {newChatSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
