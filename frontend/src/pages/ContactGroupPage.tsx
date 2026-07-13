import { useState, useEffect, useMemo } from 'react';
import {
  Layers, Users, Plus, Search, X, Pencil, Trash2, UserPlus, UserMinus,
  ChevronRight, Check, FolderPlus, Filter, Loader2, Download, Megaphone,
  MessageCircle, Mail, Send, CheckCircle2, AlertCircle, SkipForward,
} from 'lucide-react';
import { useCrmStore } from '@/store/crmStore';
import { usePermission } from '@/hooks/usePermission';
import { api } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { confirmDialog } from '@/lib/confirm';
import { format } from 'date-fns';
import { Lead } from '@/data/mockData';
import { LeadDetailPanel } from './LeadsPage';
import { DatePicker } from '@/components/ui/date-picker';

const gradStyle   = { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' };
const shadowStyle = { ...gradStyle, boxShadow: '0 4px 14px rgba(234,88,12,0.28)' };

const GROUP_COLORS = ['#ea580c', '#ef4444', '#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1', '#d97706'];

const SOURCES = [
  { value: 'Manual',           label: 'Manual' },
  { value: 'meta_form',        label: 'Meta Form' },
  { value: 'Custom Form',      label: 'Custom Form' },
  { value: 'WhatsApp',         label: 'WhatsApp' },
  { value: 'Import',           label: 'Import' },
  { value: 'landing_page',     label: 'Landing Page' },
  { value: 'calendar_booking', label: 'Calendar Booking' },
  { value: 'Referral',         label: 'Referral' },
  { value: 'Website',          label: 'Website' },
];

interface ContactGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  member_count: number;
  created_by_name: string;
  created_at: string;
}

interface GroupMember {
  id: string;
  lead_id: string;
  added_by: string;
  added_at: string;
  lead_name: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  tags: string[];
  pipeline_name: string;
  stage_name: string;
}

export default function ContactGroupPage() {
  const { leads, pipelines, tags: allTags } = useCrmStore();
  const canRead   = usePermission('contact_groups:read');
  const canManage = usePermission('contact_groups:manage');

  const [groups, setGroups]               = useState<ContactGroup[]>([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [members, setMembers]             = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Member search + bulk select
  const [memberSearch, setMemberSearch]   = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [bulkRemoving, setBulkRemoving]   = useState(false);

  // Lead detail panel
  const [openLead, setOpenLead]           = useState<Lead | null>(null);

  // Create modal
  const [showCreate, setShowCreate]       = useState(false);
  const [createStep, setCreateStep]       = useState<1 | 2>(1);
  const [createName, setCreateName]       = useState('');
  const [createDesc, setCreateDesc]       = useState('');
  const [createColor, setCreateColor]     = useState(GROUP_COLORS[0]);
  const [createSearch, setCreateSearch]   = useState('');
  const [createSelected, setCreateSelected] = useState<string[]>([]);
  const [creating, setCreating]           = useState(false);
  // Create modal - filter tab
  const [createTab, setCreateTab]         = useState<'search' | 'filter'>('search');
  const [cfPipelineId, setCfPipelineId]   = useState('');
  const [cfStageId, setCfStageId]         = useState('');
  const [cfTags, setCfTags]               = useState<string[]>([]);
  const [cfSource, setCfSource]           = useState('');
  const [cfDateFrom, setCfDateFrom]       = useState('');
  const [cfDateTo, setCfDateTo]           = useState('');
  const [cfPreviewCount, setCfPreviewCount] = useState<number | null>(null);
  const [cfPreviewing, setCfPreviewing]   = useState(false);

  // Edit inline
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editName, setEditName]           = useState('');
  const [editDesc, setEditDesc]           = useState('');
  const [editColor, setEditColor]         = useState(GROUP_COLORS[0]);

  // Add members modal
  const [showAddMembers, setShowAddMembers] = useState(false);

  // Broadcast modal
  const [showBroadcast, setShowBroadcast] = useState(false);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  // Clear selection when group changes
  useEffect(() => { setSelectedMembers(new Set()); setMemberSearch(''); }, [selectedGroupId]);

  // ── Fetch groups ────────────────────────────────────────────────────────────
  const fetchGroups = async () => {
    try {
      const data = await api.get<ContactGroup[]>('/api/contact-groups');
      setGroups(data);
    } catch {
      toast.error('Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); }, []);
  // Live-refresh groups on any tenant data change (no manual reload).
  useLiveRefresh(() => { fetchGroups(); });

  // ── Fetch members when group selected ──────────────────────────────────────
  useEffect(() => {
    if (!selectedGroupId) { setMembers([]); return; }
    setMembersLoading(true);
    api.get<GroupMember[]>(`/api/contact-groups/${selectedGroupId}/members`)
      .then(setMembers)
      .catch(() => toast.error('Failed to load members'))
      .finally(() => setMembersLoading(false));
  }, [selectedGroupId]);

  // ── Filtered members (search) ───────────────────────────────────────────────
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      m.lead_name.toLowerCase().includes(q) ||
      (m.email ?? '').toLowerCase().includes(q) ||
      (m.phone ?? '').includes(q)
    );
  }, [members, memberSearch]);

  // ── Create ──────────────────────────────────────────────────────────────────
  const cfHasFilter = !!(cfPipelineId || cfStageId || cfTags.length || cfSource || cfDateFrom || cfDateTo);

  const handleCreateFilterPreview = async () => {
    setCfPreviewing(true); setCfPreviewCount(null);
    try {
      const res = await api.post<{ count: number }>('/api/contact-groups/filter-count', {
        pipeline_id: cfPipelineId || undefined, stage_id: cfStageId || undefined,
        tags: cfTags.length ? cfTags : undefined, source: cfSource || undefined,
        date_from: cfDateFrom || undefined, date_to: cfDateTo || undefined,
      });
      setCfPreviewCount(res.count);
    } catch { toast.error('Preview failed'); }
    finally { setCfPreviewing(false); }
  };

  const handleCreate = async () => {
    if (!createName.trim()) { toast.error('Name is required'); return; }
    setCreating(true);
    try {
      const group = await api.post<ContactGroup>('/api/contact-groups', {
        name: createName.trim(), description: createDesc.trim(), color: createColor,
      });
      let memberCount = 0;
      if (createTab === 'search' && createSelected.length > 0) {
        const r = await api.post<{ added: number }>(`/api/contact-groups/${group.id}/members`, { lead_ids: createSelected });
        memberCount = r.added;
      } else if (createTab === 'filter' && cfHasFilter) {
        const r = await api.post<{ added: number; total: number }>(`/api/contact-groups/${group.id}/members/filter`, {
          pipeline_id: cfPipelineId || undefined, stage_id: cfStageId || undefined,
          tags: cfTags.length ? cfTags : undefined, source: cfSource || undefined,
          date_from: cfDateFrom || undefined, date_to: cfDateTo || undefined,
          preview: false,
        });
        memberCount = r.added;
      }
      group.member_count = memberCount;
      setGroups((p) => [{ ...group }, ...p]);
      toast.success(`"${group.name}" created${memberCount > 0 ? ` with ${memberCount} member(s)` : ' (empty)'}`);
      resetCreate();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  const resetCreate = () => {
    setShowCreate(false); setCreateStep(1); setCreateName(''); setCreateDesc('');
    setCreateColor(GROUP_COLORS[0]); setCreateSelected([]); setCreateSearch('');
    setCreateTab('search');
    setCfPipelineId(''); setCfStageId(''); setCfTags([]); setCfSource('');
    setCfDateFrom(''); setCfDateTo(''); setCfPreviewCount(null);
  };

  // ── Edit ────────────────────────────────────────────────────────────────────
  const startEdit = (g: ContactGroup) => {
    setEditingId(g.id);
    setEditName(g.name);
    setEditDesc(g.description);
    setEditColor(g.color);
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) { toast.error('Name is required'); return; }
    try {
      await api.patch(`/api/contact-groups/${id}`, { name: editName.trim(), description: editDesc.trim(), color: editColor });
      setGroups((p) => p.map((g) => g.id === id ? { ...g, name: editName.trim(), description: editDesc.trim(), color: editColor } : g));
      setEditingId(null);
      toast.success('Group updated');
    } catch { toast.error('Failed to update group'); }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteGroup = async (id: string) => {
    if (!(await confirmDialog({ message: 'Delete this group? Members will not be deleted.' }))) return;
    try {
      await api.delete(`/api/contact-groups/${id}`);
      setGroups((p) => p.filter((g) => g.id !== id));
      if (selectedGroupId === id) setSelectedGroupId(null);
      toast.success('Group deleted');
    } catch { toast.error('Failed to delete group'); }
  };

  // ── Remove single member ────────────────────────────────────────────────────
  const removeMember = async (groupId: string, leadId: string) => {
    try {
      await api.delete(`/api/contact-groups/${groupId}/members/${leadId}`);
      setMembers((p) => p.filter((m) => m.lead_id !== leadId));
      setGroups((p) => p.map((g) => g.id === groupId ? { ...g, member_count: g.member_count - 1 } : g));
      setSelectedMembers((p) => { const n = new Set(p); n.delete(leadId); return n; });
      toast.success('Member removed');
    } catch { toast.error('Failed to remove member'); }
  };

  // ── Bulk remove ─────────────────────────────────────────────────────────────
  const handleBulkRemove = async () => {
    if (selectedMembers.size === 0 || !selectedGroupId) return;
    if (!(await confirmDialog({ message: `Remove ${selectedMembers.size} member(s) from this group?`, confirmText: 'Remove' }))) return;
    setBulkRemoving(true);
    try {
      const lead_ids = Array.from(selectedMembers);
      const res = await api.post<{ removed: number }>(`/api/contact-groups/${selectedGroupId}/members/bulk-remove`, { lead_ids });
      setMembers((p) => p.filter((m) => !selectedMembers.has(m.lead_id)));
      setGroups((p) => p.map((g) => g.id === selectedGroupId ? { ...g, member_count: g.member_count - res.removed } : g));
      setSelectedMembers(new Set());
      toast.success(`${res.removed} member(s) removed`);
    } catch { toast.error('Failed to remove members'); }
    finally { setBulkRemoving(false); }
  };

  // ── Export CSV ──────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!selectedGroup || members.length === 0) return;
    const header = ['Name', 'Email', 'Phone', 'Pipeline', 'Stage', 'Source', 'Tags', 'Added By', 'Added At'];
    const rows = members.map((m) => [
      m.lead_name ?? '',
      m.email ?? '',
      m.phone ?? '',
      m.pipeline_name ?? '',
      m.stage_name ?? '',
      m.source ?? '',
      (m.tags ?? []).join('; '),
      m.added_by ?? '',
      m.added_at ? format(new Date(m.added_at), 'dd MMM yyyy HH:mm') : '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${selectedGroup.name.replace(/[^a-z0-9]/gi, '_')}_members.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Click member → lead detail panel ───────────────────────────────────────
  const handleMemberClick = (m: GroupMember) => {
    const lead = leads.find((l) => l.id === m.lead_id);
    if (lead) {
      setOpenLead(lead);
    } else {
      // construct minimal Lead from member data if not in store
      const nameParts = (m.lead_name ?? '').trim().split(' ');
      const firstName = nameParts[0] ?? '';
      const lastName  = nameParts.slice(1).join(' ');
      setOpenLead({
        id: m.lead_id, firstName, lastName,
        email: m.email ?? '', phone: m.phone ?? '',
        stage: m.stage_name ?? '', stageId: '',
        pipelineId: '', assignedTo: '', assignedName: '',
        source: m.source ?? '', tags: m.tags ?? [],
        score: 0, dealValue: 0,
        createdAt: m.added_at, lastActivity: m.added_at,
        notes: [],
      });
    }
  };

  // ── After add members (refresh) ─────────────────────────────────────────────
  const handleMembersAdded = async (_added: number) => {
    setShowAddMembers(false);
    if (!selectedGroupId) return;
    // Re-fetch groups to get accurate server-side member_count (avoids drift from ON CONFLICT skips)
    fetchGroups();
    setMembersLoading(true);
    api.get<GroupMember[]>(`/api/contact-groups/${selectedGroupId}/members`)
      .then(setMembers)
      .catch(() => null)
      .finally(() => setMembersLoading(false));
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q));
  }, [groups, search]);

  const filteredCreateLeads = useMemo(() => {
    const q = createSearch.trim().toLowerCase();
    return leads.filter((l) => {
      if (!q) return true;
      return (`${l.firstName} ${l.lastName}`).toLowerCase().includes(q)
        || (l.email ?? '').toLowerCase().includes(q)
        || (l.phone ?? '').includes(q);
    });
  }, [leads, createSearch]);

  const totalMembers = groups.reduce((s, g) => s + g.member_count, 0);
  const emptyGroups  = groups.filter((g) => g.member_count === 0).length;
  const allFilteredSelected = filteredMembers.length > 0 && filteredMembers.every((m) => selectedMembers.has(m.lead_id));

  if (!canRead) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Layers className="w-12 h-12 text-[#c3c8cf] mb-3" />
        <p className="text-[16px] font-semibold text-[#111318]">No access</p>
        <p className="text-[15px] text-[#6b7280] mt-1">You don't have permission to view contact groups.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Groups',  value: groups.length,  icon: Layers,     color: 'text-primary' },
          { label: 'Total Members', value: totalMembers,   icon: Users,      color: 'text-emerald-500' },
          { label: 'Empty Groups',  value: emptyGroups,    icon: FolderPlus, color: 'text-amber-500' },
          { label: 'All Contacts',  value: leads.length,   icon: Users,      color: 'text-primary' },
        ].map((s, idx) => (
          idx === 3 ? (
            <div key={s.label} className="rounded-2xl px-5 py-4 flex items-center gap-4 text-white"
              style={{ ...gradStyle, boxShadow: '0 6px 24px rgba(234,88,12,0.25)' }}>
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><s.icon className="w-5 h-5 text-white" /></div>
              <div><p className="text-[14px] opacity-80">{s.label}</p><h3 className="font-headline text-[22px] font-bold tracking-tight leading-tight">{s.value}</h3></div>
            </div>
          ) : (
            <div key={s.label} className="bg-white rounded-2xl px-5 py-4 border border-[var(--hairline)] card-shadow flex items-center gap-4">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0"><s.icon className={cn('w-5 h-5', s.color)} /></div>
              <div><p className="text-[14px] text-[#6b7280]">{s.label}</p><h3 className="font-headline text-[22px] font-bold text-[#111318] tracking-tight leading-tight">{s.value}</h3></div>
            </div>
          )
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9ca3af]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search groups..."
            className="w-full pl-9 pr-10 py-2.5 text-[15px] bg-white border border-[var(--hairline)] rounded-full outline-none focus:border-primary/40 placeholder:text-gray-400 transition-all"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }} />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full hover:bg-black/5 flex items-center justify-center text-[#9ca3af]"><X className="w-3 h-3" /></button>}
        </div>
        <div className="flex-1" />
        {canManage && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[15px] font-bold text-white transition-all hover:-translate-y-0.5 active:scale-[0.98]"
            style={shadowStyle}>
            <Plus className="w-4 h-4" /> New Group
          </button>
        )}
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">

        {/* Groups list */}
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary/40" /></div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow py-16 text-center">
              <Layers className="w-10 h-10 mx-auto text-[#c3c8cf] mb-3" />
              <p className="text-[16px] font-semibold text-[#111318]">{search ? 'No groups match' : 'No groups yet'}</p>
              <p className="text-[14px] text-[#6b7280] mt-1">{search ? 'Try a different search.' : 'Create your first group to get started.'}</p>
            </div>
          ) : filtered.map((g) => {
            const isActive = selectedGroupId === g.id;
            return (
              <div key={g.id} onClick={() => setSelectedGroupId(g.id)}
                className={cn('bg-white rounded-2xl border p-4 cursor-pointer card-shadow transition-all hover:shadow-md active:scale-[0.99]',
                  isActive ? 'border-primary/40 shadow-sm ring-1 ring-primary/20' : 'border-[var(--hairline)] hover:border-black/10'
                )}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: g.color + '18' }}>
                    <Layers className="w-4 h-4" style={{ color: g.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingId === g.id ? (
                      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                          className="w-full text-[15px] font-semibold border border-primary/30 rounded-lg px-2.5 py-1.5 outline-none focus:border-primary/50" />
                        <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description"
                          className="w-full text-[14px] text-[#6b7280] border border-[var(--hairline)] rounded-lg px-2.5 py-1.5 outline-none focus:border-primary/30" />
                        <div className="flex gap-1.5 flex-wrap">
                          {GROUP_COLORS.map((c) => (
                            <button key={c} onClick={() => setEditColor(c)}
                              className={cn('w-5 h-5 rounded-full transition-all', editColor === c ? 'ring-2 ring-offset-1 ring-[#111318] scale-110' : 'hover:scale-110')}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => saveEdit(g.id)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-bold text-white bg-primary hover:bg-primary/90"><Check className="w-3 h-3" /> Save</button>
                          <button onClick={() => setEditingId(null)} className="px-2.5 py-1 rounded-lg text-[12px] font-semibold text-[#6b7280] hover:bg-[var(--accent-tint)]">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-[15px] font-bold text-[#111318] truncate">{g.name}</p>
                        <p className="text-[12px] text-[#6b7280] mt-0.5 line-clamp-1">{g.description || 'No description'}</p>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-center">
                      <p className="font-headline text-[16px] font-bold text-[#111318] leading-tight">{g.member_count}</p>
                      <p className="text-[10px] text-[#6b7280] uppercase tracking-wider">members</p>
                    </div>
                    <ChevronRight className={cn('w-4 h-4 transition-colors', isActive ? 'text-primary' : 'text-[#c3c8cf]')} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow overflow-hidden flex flex-col">
          {!selectedGroup ? (
            <div className="flex flex-col items-center justify-center py-24 text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Users className="w-7 h-7 text-primary/50" />
              </div>
              <p className="text-[16px] font-semibold text-[#111318] mb-1">Select a group</p>
              <p className="text-[14px] text-[#6b7280] max-w-xs">Click a group on the left to view and manage its members.</p>
            </div>
          ) : (
            <>
              {/* Panel header */}
              <div className="px-6 py-5 border-b border-[var(--hairline)] flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: selectedGroup.color + '18' }}>
                    <Layers className="w-5 h-5" style={{ color: selectedGroup.color }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-headline font-bold text-[16px] text-[#111318] truncate">{selectedGroup.name}</h3>
                    <p className="text-[14px] text-[#6b7280] mt-0.5">
                      {selectedGroup.member_count} members · Created {format(new Date(selectedGroup.created_at), 'dd MMM yyyy')}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => startEdit(selectedGroup)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b7280] hover:bg-[var(--accent-tint)] hover:text-primary transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={handleExportCSV} disabled={members.length === 0}
                      title="Export CSV"
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b7280] hover:bg-[var(--accent-tint)] hover:text-primary transition-colors disabled:opacity-40">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setShowBroadcast(true)} disabled={selectedGroup.member_count === 0}
                      title="Broadcast to group"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[14px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%)', boxShadow: '0 4px 14px rgba(109,40,217,0.28)' }}>
                      <Megaphone className="w-3.5 h-3.5" /> Broadcast
                    </button>
                    <button onClick={() => setShowAddMembers(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[14px] font-bold text-white transition-all hover:-translate-y-0.5" style={shadowStyle}>
                      <UserPlus className="w-3.5 h-3.5" /> Add
                    </button>
                    <button onClick={() => deleteGroup(selectedGroup.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#c3c8cf] hover:bg-red-50 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Members search bar */}
              {members.length > 0 && (
                <div className="px-6 py-3 border-b border-[var(--hairline)] shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9ca3af]" />
                    <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search members by name, email, phone..."
                      className="w-full pl-9 pr-9 py-2 text-[15px] bg-[var(--surface-2)] border border-[var(--hairline)] rounded-xl outline-none focus:border-primary/30 placeholder:text-gray-400" />
                    {memberSearch && (
                      <button onClick={() => setMemberSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#6b7280]">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Bulk action bar */}
              {selectedMembers.size > 0 && canManage && (
                <div className="px-6 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center gap-3 shrink-0">
                  <span className="text-[14px] font-semibold text-primary">{selectedMembers.size} selected</span>
                  <div className="flex-1" />
                  <button onClick={() => setSelectedMembers(new Set())}
                    className="text-[14px] text-[#6b7280] hover:text-[#111318] transition-colors">Clear</button>
                  <button onClick={handleBulkRemove} disabled={bulkRemoving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[14px] font-bold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-60">
                    {bulkRemoving ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserMinus className="w-3 h-3" />}
                    Remove {selectedMembers.size}
                  </button>
                </div>
              )}

              {/* Members list */}
              {membersLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-primary/40" /></div>
              ) : members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center mb-3">
                    <UserPlus className="w-6 h-6 text-[#c3c8cf]" />
                  </div>
                  <p className="text-[15px] font-semibold text-[#111318] mb-1">Empty group</p>
                  <p className="text-[14px] text-[#6b7280] mb-4">Add contacts manually or via automation.</p>
                  {canManage && (
                    <button onClick={() => setShowAddMembers(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-bold text-white" style={shadowStyle}>
                      <UserPlus className="w-3.5 h-3.5" /> Add Members
                    </button>
                  )}
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                  <Search className="w-8 h-8 text-[#c3c8cf] mb-2" />
                  <p className="text-[15px] font-semibold text-[#111318]">No members match</p>
                  <p className="text-[14px] text-[#6b7280] mt-0.5">Try a different search term.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  {/* Select-all header row */}
                  {canManage && (
                    <div className="flex items-center gap-3 px-6 py-2.5 border-b border-[var(--hairline)] bg-[var(--surface-2)]">
                      <input type="checkbox" checked={allFilteredSelected}
                        onChange={() => {
                          if (allFilteredSelected) {
                            setSelectedMembers((p) => {
                              const n = new Set(p);
                              filteredMembers.forEach((m) => n.delete(m.lead_id));
                              return n;
                            });
                          } else {
                            setSelectedMembers((p) => {
                              const n = new Set(p);
                              filteredMembers.forEach((m) => n.add(m.lead_id));
                              return n;
                            });
                          }
                        }}
                        className="w-4 h-4 accent-primary cursor-pointer" />
                      <span className="text-[12px] text-[#6b7280] font-semibold">
                        {allFilteredSelected ? 'Deselect all' : `Select all ${filteredMembers.length}`}
                      </span>
                    </div>
                  )}
                  <div className="divide-y divide-[var(--hairline)]">
                    {filteredMembers.map((m) => {
                      const checked = selectedMembers.has(m.lead_id);
                      return (
                        <div key={m.id}
                          className="flex items-center gap-3 px-6 py-3.5 hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                          onClick={() => handleMemberClick(m)}>
                          {canManage && (
                            <input type="checkbox" checked={checked}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => setSelectedMembers((p) => {
                                const n = new Set(p);
                                if (checked) n.delete(m.lead_id); else n.add(m.lead_id);
                                return n;
                              })}
                              className="w-4 h-4 accent-primary cursor-pointer shrink-0" />
                          )}
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-[12px] font-bold text-primary shrink-0">
                            {((m.lead_name || '?')[0] ?? '?').toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[15px] font-semibold text-[#111318] truncate">{m.lead_name}</p>
                            <p className="text-[12px] text-[#6b7280] truncate">{m.email || m.phone}</p>
                          </div>
                          <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0">
                            {m.pipeline_name && <span className="text-[11px] text-[#6b7280] bg-[var(--surface-2)] px-2 py-0.5 rounded-full">{m.pipeline_name}</span>}
                            {m.stage_name    && <span className="text-[11px] text-primary/70 bg-primary/5 px-2 py-0.5 rounded-full">{m.stage_name}</span>}
                          </div>
                          <span className="text-[11px] text-[#6b7280] hidden md:block capitalize">{m.added_by}</span>
                          {canManage && (
                            <button onClick={(e) => { e.stopPropagation(); removeMember(selectedGroup.id, m.lead_id); }}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#c3c8cf] hover:bg-red-50 hover:text-red-500 transition-colors shrink-0">
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── CREATE GROUP MODAL ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
              <div>
                <h3 className="font-headline font-bold text-[16px] text-[#111318]">
                  {createStep === 1 ? 'Create Group' : 'Add Members'}
                </h3>
                <p className="text-[12px] text-[#6b7280] mt-0.5">Step {createStep} of 2 - {createStep === 1 ? 'Name & details' : 'Optional: add contacts now'}</p>
              </div>
              <button onClick={resetCreate} className="p-2 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280]"><X className="w-4 h-4" /></button>
            </div>

            {createStep === 1 ? (
              <div className="p-6 space-y-5">
                <div>
                  <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Group Name <span className="text-red-500">*</span></label>
                  <input autoFocus value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. Batch 1, VIP Clients..."
                    className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 placeholder:text-gray-400" />
                </div>
                <div>
                  <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Description</label>
                  <input value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="What is this group for?"
                    className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 placeholder:text-gray-400" />
                </div>
                <div>
                  <label className="text-[14px] font-semibold text-[#111318] mb-2 block">Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {GROUP_COLORS.map((c) => (
                      <button key={c} onClick={() => setCreateColor(c)}
                        className={cn('w-8 h-8 rounded-full transition-all', createColor === c ? 'ring-2 ring-offset-2 ring-[#111318] scale-110' : 'hover:scale-110')}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={resetCreate} className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)]">Cancel</button>
                  <button onClick={() => { if (!createName.trim()) { toast.error('Name is required'); return; } setCreateStep(2); }}
                    className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-bold text-white transition-all hover:-translate-y-0.5" style={shadowStyle}>
                    Next
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col" style={{ maxHeight: '75vh' }}>
                {/* Group name chip */}
                <div className="px-6 pt-4 pb-0 shrink-0">
                  <div className="flex items-center gap-2 p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--hairline)] mb-3">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: createColor + '18' }}>
                      <Layers className="w-3.5 h-3.5" style={{ color: createColor }} />
                    </div>
                    <span className="text-[15px] font-bold text-[#111318]">{createName}</span>
                    {createTab === 'search' && createSelected.length > 0 && (
                      <span className="ml-auto text-[12px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{createSelected.length} selected</span>
                    )}
                    {createTab === 'filter' && cfPreviewCount !== null && (
                      <span className="ml-auto text-[12px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{cfPreviewCount} leads</span>
                    )}
                  </div>
                </div>
                {/* Tabs */}
                <div className="flex border-b border-[var(--hairline)] shrink-0 px-6">
                  {(['search', 'filter'] as const).map((t) => (
                    <button key={t} onClick={() => setCreateTab(t)}
                      className={cn('flex-1 py-2.5 text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-colors',
                        createTab === t ? 'text-primary border-b-2 border-primary' : 'text-[#6b7280] hover:text-[#111318]'
                      )}>
                      {t === 'search' ? <><Search className="w-3.5 h-3.5" /> Search & Select</> : <><Filter className="w-3.5 h-3.5" /> From Pipeline / Filter</>}
                    </button>
                  ))}
                </div>

                {/* Search tab */}
                {createTab === 'search' && (<>
                  <div className="px-6 pt-3 pb-2 shrink-0">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9ca3af]" />
                      <input value={createSearch} onChange={(e) => setCreateSearch(e.target.value)} placeholder="Search contacts..."
                        className="w-full pl-9 pr-4 py-2.5 text-[15px] bg-white border border-[var(--hairline)] rounded-xl outline-none focus:border-primary/40 placeholder:text-gray-400" />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-[var(--hairline)] px-2">
                    {filteredCreateLeads.map((l) => {
                      const checked = createSelected.includes(l.id);
                      return (
                        <label key={l.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)] cursor-pointer rounded-xl transition-colors">
                          <input type="checkbox" checked={checked}
                            onChange={() => setCreateSelected((p) => checked ? p.filter((x) => x !== l.id) : [...p, l.id])}
                            className="w-4 h-4 accent-primary" />
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                            {l.firstName[0]}{l.lastName[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[15px] font-semibold text-[#111318] truncate">{l.firstName} {l.lastName}</p>
                            <p className="text-[12px] text-[#6b7280] truncate">{l.email || l.phone}</p>
                          </div>
                          <span className="text-[11px] text-[#6b7280] bg-[var(--surface-2)] px-2 py-0.5 rounded-full">{l.source}</span>
                        </label>
                      );
                    })}
                    {filteredCreateLeads.length === 0 && <p className="text-center py-8 text-[15px] text-[#6b7280]">No contacts found.</p>}
                  </div>
                </>)}

                {/* Filter tab */}
                {createTab === 'filter' && (
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <div>
                      <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Pipeline</label>
                      <select value={cfPipelineId} onChange={(e) => { setCfPipelineId(e.target.value); setCfStageId(''); setCfPreviewCount(null); }}
                        className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 bg-white">
                        <option value="">Any pipeline</option>
                        {pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Stage</label>
                      <select value={cfStageId} onChange={(e) => { setCfStageId(e.target.value); setCfPreviewCount(null); }}
                        disabled={!cfPipelineId}
                        className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 bg-white disabled:opacity-50">
                        <option value="">Any stage</option>
                        {(pipelines.find((p: any) => p.id === cfPipelineId)?.stages ?? []).map((s: any) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Tags</label>
                      <div className="flex flex-wrap gap-1.5">
                        {allTags.map((t: any) => { const tag = typeof t === 'string' ? t : t.name; return (
                          <button key={tag} onClick={() => { setCfTags((p) => p.includes(tag) ? p.filter((x) => x !== tag) : [...p, tag]); setCfPreviewCount(null); }}
                            className={cn('px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors',
                              cfTags.includes(tag) ? 'bg-primary text-white border-primary' : 'bg-white text-[#6b7280] border-[var(--hairline)] hover:border-primary/30'
                            )}>{tag}</button>
                        ); })}
                        {allTags.length === 0 && <p className="text-[14px] text-[#6b7280]">No tags available</p>}
                      </div>
                    </div>
                    <div>
                      <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Source</label>
                      <select value={cfSource} onChange={(e) => { setCfSource(e.target.value); setCfPreviewCount(null); }}
                        className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 bg-white">
                        <option value="">Any source</option>
                        {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Created From</label>
                        <DatePicker value={cfDateFrom} onChange={(v) => { setCfDateFrom(v); setCfPreviewCount(null); }}
                          placeholder="Created from" className="w-full" />
                      </div>
                      <div>
                        <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Created To</label>
                        <DatePicker value={cfDateTo} onChange={(v) => { setCfDateTo(v); setCfPreviewCount(null); }}
                          placeholder="Created to" className="w-full" />
                      </div>
                    </div>
                    {cfPreviewCount !== null && (
                      <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-xl border border-primary/20">
                        <Users className="w-4 h-4 text-primary shrink-0" />
                        <p className="text-[15px] font-semibold text-primary">{cfPreviewCount} lead(s) match your filter</p>
                      </div>
                    )}
                    <button onClick={handleCreateFilterPreview} disabled={cfPreviewing}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)] disabled:opacity-60 transition-colors">
                      {cfPreviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
                      Preview Count
                    </button>
                  </div>
                )}

                {/* Footer */}
                <div className="px-6 py-4 border-t border-[var(--hairline)] flex gap-3 shrink-0">
                  <button onClick={() => setCreateStep(1)} className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)]">Back</button>
                  <button onClick={handleCreate} disabled={creating}
                    className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60" style={shadowStyle}>
                    {creating ? 'Creating...'
                      : createTab === 'search' && createSelected.length > 0 ? `Create with ${createSelected.length} member(s)`
                      : createTab === 'filter' && cfPreviewCount !== null ? `Create with ${cfPreviewCount} lead(s)`
                      : createTab === 'filter' && cfHasFilter ? 'Create with Filter'
                      : 'Create Empty Group'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ADD MEMBERS MODAL ── */}
      {showAddMembers && selectedGroup && (
        <AddMembersModal
          groupId={selectedGroup.id}
          groupName={selectedGroup.name}
          existingLeadIds={members.map((m) => m.lead_id)}
          leads={leads}
          pipelines={pipelines}
          allTags={allTags}
          onAdded={handleMembersAdded}
          onClose={() => setShowAddMembers(false)}
        />
      )}

      {/* ── BROADCAST MODAL ── */}
      {showBroadcast && selectedGroup && (
        <BroadcastModal
          groupId={selectedGroup.id}
          groupName={selectedGroup.name}
          memberCount={selectedGroup.member_count}
          onClose={() => setShowBroadcast(false)}
        />
      )}

      {/* ── LEAD DETAIL PANEL ── */}
      {openLead && (
        <LeadDetailPanel
          lead={openLead}
          onClose={() => setOpenLead(null)}
          onLeadUpdated={(id, updates) =>
            setOpenLead((prev) => prev ? { ...prev, ...updates } : prev)
          }
        />
      )}
    </div>
  );
}

// ── Add Members Modal ─────────────────────────────────────────────────────────
function AddMembersModal({ groupId, groupName, existingLeadIds, leads, pipelines, allTags, onAdded, onClose }: {
  groupId: string;
  groupName: string;
  existingLeadIds: string[];
  leads: any[];
  pipelines: any[];
  allTags: any[];
  onAdded: (added: number) => void;
  onClose: () => void;
}) {
  const [tab, setTab]                     = useState<'search' | 'filter'>('search');
  const [search, setSearch]               = useState('');
  const [selected, setSelected]           = useState<string[]>([]);
  const [saving, setSaving]               = useState(false);

  // Filter tab state
  const [pipelineId, setPipelineId]       = useState('');
  const [stageId, setStageId]             = useState('');
  const [selectedTags, setSelectedTags]   = useState<string[]>([]);
  const [source, setSource]               = useState('');
  const [dateFrom, setDateFrom]           = useState('');
  const [dateTo, setDateTo]               = useState('');
  const [previewCount, setPreviewCount]   = useState<number | null>(null);
  const [previewing, setPreviewing]       = useState(false);

  const availableStages = pipelines.find((p: any) => p.id === pipelineId)?.stages ?? [];

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (existingLeadIds.includes(l.id)) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (`${l.firstName} ${l.lastName}`).toLowerCase().includes(q)
        || (l.email ?? '').toLowerCase().includes(q)
        || (l.phone ?? '').includes(q);
    });
  }, [leads, existingLeadIds, search]);

  const toggle = (id: string) => setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const handleAddManual = async () => {
    if (selected.length === 0) { toast.error('Select at least one contact'); return; }
    setSaving(true);
    try {
      const res = await api.post<{ added: number }>(`/api/contact-groups/${groupId}/members`, { lead_ids: selected });
      toast.success(`${res.added} member(s) added`);
      onAdded(res.added);
    } catch { toast.error('Failed to add members'); }
    finally { setSaving(false); }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewCount(null);
    try {
      const res = await api.post<{ count: number }>(`/api/contact-groups/${groupId}/members/filter`, {
        pipeline_id: pipelineId || undefined,
        stage_id:    stageId    || undefined,
        tags:        selectedTags.length ? selectedTags : undefined,
        source:      source     || undefined,
        date_from:   dateFrom   || undefined,
        date_to:     dateTo     || undefined,
        preview: true,
      });
      setPreviewCount(res.count);
    } catch { toast.error('Preview failed'); }
    finally { setPreviewing(false); }
  };

  const handleAddFilter = async () => {
    setSaving(true);
    try {
      const res = await api.post<{ added: number; total: number }>(`/api/contact-groups/${groupId}/members/filter`, {
        pipeline_id: pipelineId || undefined,
        stage_id:    stageId    || undefined,
        tags:        selectedTags.length ? selectedTags : undefined,
        source:      source     || undefined,
        date_from:   dateFrom   || undefined,
        date_to:     dateTo     || undefined,
        preview: false,
      });
      toast.success(`${res.added} new member(s) added (${res.total} matched filter)`);
      onAdded(res.added);
    } catch { toast.error('Failed to add members'); }
    finally { setSaving(false); }
  };

  const tagNames = allTags.map((t: any) => (typeof t === 'string' ? t : t.name));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)] shrink-0">
          <div>
            <h3 className="font-headline font-bold text-[16px] text-[#111318]">Add to "{groupName}"</h3>
            {tab === 'search' && selected.length > 0 && <p className="text-[12px] text-primary font-semibold mt-0.5">{selected.length} selected</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280]"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--hairline)] shrink-0">
          {(['search', 'filter'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('flex-1 py-2.5 text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-colors',
                tab === t ? 'text-primary border-b-2 border-primary' : 'text-[#6b7280] hover:text-[#111318]'
              )}>
              {t === 'search' ? <><Search className="w-3.5 h-3.5" /> Search & Select</> : <><Filter className="w-3.5 h-3.5" /> From Filter</>}
            </button>
          ))}
        </div>

        {/* Tab: Search & Select */}
        {tab === 'search' && (<>
          <div className="px-6 pt-3 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9ca3af]" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, phone..."
                className="w-full pl-9 pr-4 py-2.5 text-[15px] bg-white border border-[var(--hairline)] rounded-xl outline-none focus:border-primary/40 placeholder:text-gray-400" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--hairline)] px-2">
            {filteredLeads.map((l) => {
              const checked = selected.includes(l.id);
              return (
                <label key={l.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)] cursor-pointer rounded-xl transition-colors">
                  <input type="checkbox" checked={checked} onChange={() => toggle(l.id)} className="w-4 h-4 accent-primary" />
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                    {l.firstName[0]}{l.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-[#111318] truncate">{l.firstName} {l.lastName}</p>
                    <p className="text-[12px] text-[#6b7280] truncate">{l.email || l.phone}</p>
                  </div>
                  <span className="text-[11px] text-[#6b7280] bg-[var(--surface-2)] px-2 py-0.5 rounded-full">{l.source}</span>
                </label>
              );
            })}
            {filteredLeads.length === 0 && <p className="text-center py-8 text-[15px] text-[#6b7280]">No contacts available to add.</p>}
          </div>
          <div className="px-6 py-4 border-t border-[var(--hairline)] flex gap-3 shrink-0">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)]">Cancel</button>
            <button onClick={handleAddManual} disabled={selected.length === 0 || saving}
              className={cn('flex-1 px-4 py-2.5 rounded-xl text-[15px] font-bold text-white transition-all', selected.length > 0 && !saving ? 'hover:-translate-y-0.5' : 'opacity-50 cursor-not-allowed')}
              style={shadowStyle}>
              {saving ? 'Adding...' : `Add ${selected.length > 0 ? `${selected.length} Member(s)` : 'Members'}`}
            </button>
          </div>
        </>)}

        {/* Tab: From Filter */}
        {tab === 'filter' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Pipeline</label>
                <select value={pipelineId} onChange={(e) => { setPipelineId(e.target.value); setStageId(''); setPreviewCount(null); }}
                  className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 bg-white">
                  <option value="">Any pipeline</option>
                  {pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Stage</label>
                <select value={stageId} onChange={(e) => { setStageId(e.target.value); setPreviewCount(null); }}
                  disabled={!pipelineId}
                  className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 bg-white disabled:opacity-50">
                  <option value="">Any stage</option>
                  {availableStages.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Tags</label>
                <div className="flex flex-wrap gap-1.5">
                  {tagNames.map((tag: string) => (
                    <button key={tag} onClick={() => { setSelectedTags((p) => p.includes(tag) ? p.filter((x) => x !== tag) : [...p, tag]); setPreviewCount(null); }}
                      className={cn('px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors',
                        selectedTags.includes(tag) ? 'bg-primary text-white border-primary' : 'bg-white text-[#6b7280] border-[var(--hairline)] hover:border-primary/30'
                      )}>
                      {tag}
                    </button>
                  ))}
                  {tagNames.length === 0 && <p className="text-[14px] text-[#6b7280]">No tags available</p>}
                </div>
              </div>
              <div>
                <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Source</label>
                <select value={source} onChange={(e) => { setSource(e.target.value); setPreviewCount(null); }}
                  className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 bg-white">
                  <option value="">Any source</option>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Created From</label>
                  <DatePicker value={dateFrom} onChange={(v) => { setDateFrom(v); setPreviewCount(null); }}
                    placeholder="Created from" className="w-full" />
                </div>
                <div>
                  <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Created To</label>
                  <DatePicker value={dateTo} onChange={(v) => { setDateTo(v); setPreviewCount(null); }}
                    placeholder="Created to" className="w-full" />
                </div>
              </div>
              {previewCount !== null && (
                <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-xl border border-primary/20">
                  <Users className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-[15px] font-semibold text-primary">{previewCount} lead(s) match your filter</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--hairline)] flex gap-3 shrink-0">
              <button onClick={handlePreview} disabled={previewing}
                className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)] disabled:opacity-60 flex items-center justify-center gap-2">
                {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
                Preview Count
              </button>
              <button onClick={handleAddFilter} disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60" style={shadowStyle}>
                {saving ? 'Adding...' : previewCount !== null ? `Add ${previewCount} Lead(s)` : 'Add All Matches'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Broadcast Modal ───────────────────────────────────────────────────────────
interface BroadcastResult { sent: number; failed: number; skipped: number; total: number; errors: string[]; }

function BroadcastModal({ groupId, groupName, memberCount, onClose }: {
  groupId: string;
  groupName: string;
  memberCount: number;
  onClose: () => void;
}) {
  const [tab, setTab]             = useState<'whatsapp' | 'email'>('whatsapp');
  const [message, setMessage]     = useState('');
  const [subject, setSubject]     = useState('');
  const [sending, setSending]     = useState(false);
  const [result, setResult]       = useState<BroadcastResult | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string; body: string }[]>([]);

  // Load templates for quick-fill
  useEffect(() => {
    api.get<any[]>('/api/templates').then((data) => {
      setTemplates((data ?? []).map((t) => ({ id: t.id, name: t.name, body: t.body ?? '' })));
    }).catch(() => null);
  }, []);

  const handleSend = async () => {
    if (!message.trim()) { toast.error('Message is required'); return; }
    if (tab === 'email' && !subject.trim()) { toast.error('Subject is required'); return; }
    setSending(true);
    setResult(null);
    try {
      const res = await api.post<BroadcastResult>(`/api/contact-groups/${groupId}/broadcast`, {
        type: tab,
        message: message.trim(),
        subject: tab === 'email' ? subject.trim() : undefined,
      });
      setResult(res);
    } catch (e: any) {
      toast.error(e.message ?? 'Broadcast failed');
    } finally {
      setSending(false);
    }
  };

  const canSend = message.trim().length > 0 && (tab === 'whatsapp' || subject.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
              style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%)' }}>
              <Megaphone className="w-4.5 h-4.5 w-[18px] h-[18px]" />
            </div>
            <div>
              <h3 className="font-headline font-bold text-[16px] text-[#111318]">Broadcast to "{groupName}"</h3>
              <p className="text-[12px] text-[#6b7280] mt-0.5">{memberCount} member{memberCount !== 1 ? 's' : ''} in this group</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280]"><X className="w-4 h-4" /></button>
        </div>

        {/* Result screen */}
        {result ? (
          <div className="flex-1 flex flex-col p-6 gap-4">
            <p className="text-[16px] font-bold text-[#111318] text-center">Broadcast Complete</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center gap-1.5 p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                <span className="font-headline text-[22px] font-bold text-emerald-600">{result.sent}</span>
                <span className="text-[12px] text-emerald-600 font-semibold">Sent</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-4 bg-red-50 rounded-2xl border border-red-100">
                <AlertCircle className="w-6 h-6 text-red-500" />
                <span className="font-headline text-[22px] font-bold text-red-600">{result.failed}</span>
                <span className="text-[12px] text-red-600 font-semibold">Failed</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <SkipForward className="w-6 h-6 text-gray-400" />
                <span className="font-headline text-[22px] font-bold text-gray-500">{result.skipped}</span>
                <span className="text-[12px] text-gray-500 font-semibold">Skipped</span>
              </div>
            </div>
            {result.skipped > 0 && (
              <p className="text-[12px] text-[#6b7280] text-center">
                {result.skipped} member{result.skipped !== 1 ? 's' : ''} skipped - no {tab === 'whatsapp' ? 'phone number' : 'email address'} on record
              </p>
            )}
            {result.errors.length > 0 && (
              <div className="bg-red-50 rounded-xl border border-red-100 p-3 max-h-28 overflow-y-auto">
                <p className="text-[12px] font-bold text-red-600 mb-1.5">Errors:</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-[12px] text-red-500 leading-relaxed">{e}</p>
                ))}
              </div>
            )}
            <div className="flex gap-3 mt-auto">
              <button onClick={() => setResult(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)]">
                Send Again
              </button>
              <button onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%)' }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Channel tabs */}
            <div className="flex border-b border-[var(--hairline)] shrink-0">
              {(['whatsapp', 'email'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={cn('flex-1 py-2.5 text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-colors',
                    tab === t ? 'text-primary border-b-2 border-primary' : 'text-[#6b7280] hover:text-[#111318]'
                  )}>
                  {t === 'whatsapp'
                    ? <><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</>
                    : <><Mail className="w-3.5 h-3.5" /> Email</>}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Template quick-fill */}
              {templates.length > 0 && (
                <div>
                  <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Use a template</label>
                  <select onChange={(e) => {
                    const t = templates.find((x) => x.id === e.target.value);
                    if (t) setMessage(t.body);
                  }} defaultValue=""
                    className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 bg-white">
                    <option value="">- pick a template -</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}

              {/* Email subject */}
              {tab === 'email' && (
                <div>
                  <label className="text-[14px] font-semibold text-[#111318] mb-1.5 block">Subject <span className="text-red-500">*</span></label>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Special offer for you"
                    className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 placeholder:text-gray-400" />
                </div>
              )}

              {/* Message */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[14px] font-semibold text-[#111318]">Message <span className="text-red-500">*</span></label>
                  <span className="text-[12px] text-[#6b7280]">{message.length} chars</span>
                </div>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder={tab === 'whatsapp'
                    ? 'Hi {first_name}, we have an exciting offer for you...'
                    : 'Dear {full_name},\n\nWe have an update for you...'}
                  rows={6}
                  className="w-full border border-[var(--hairline)] rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/40 placeholder:text-gray-400 resize-none" />
                <p className="text-[12px] text-[#6b7280] mt-1">
                  Variables: <code className="bg-gray-100 px-1 rounded text-[11px]">{'{first_name}'}</code>{' '}
                  <code className="bg-gray-100 px-1 rounded text-[11px]">{'{full_name}'}</code>{' '}
                  <code className="bg-gray-100 px-1 rounded text-[11px]">{'{phone}'}</code>{' '}
                  <code className="bg-gray-100 px-1 rounded text-[11px]">{'{email}'}</code>
                </p>
              </div>

              {/* Warning for large groups */}
              {memberCount > 100 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[14px] text-amber-700">
                    This group has <strong>{memberCount}</strong> members. The broadcast may take a moment to complete.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[var(--hairline)] flex gap-3 shrink-0">
              <button onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#6b7280] border border-[var(--hairline)] hover:bg-[var(--accent-tint)]">
                Cancel
              </button>
              <button onClick={handleSend} disabled={!canSend || sending}
                className="flex-1 px-4 py-2.5 rounded-xl text-[15px] font-bold text-white flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%)', boxShadow: canSend && !sending ? '0 4px 14px rgba(109,40,217,0.28)' : undefined }}>
                {sending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</>
                  : <><Send className="w-3.5 h-3.5" /> Send to {memberCount} member{memberCount !== 1 ? 's' : ''}</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
