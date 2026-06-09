import { useState, useMemo } from 'react';
import {
  Clock, CheckCircle2, Plus, Calendar, AlarmClock, Layers,
  Trash2, Download, Search, MoreVertical, X, Mail, Phone, User,
  ChevronDown, Check,
} from 'lucide-react';
import { useCrmStore } from '@/store/crmStore';
import { staff } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { format, isPast, isToday, isFuture, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ─── Add Follow-Up Modal ───────────────────────────────────────────────────────
function AddFollowUpModal({ onClose }: { onClose: () => void }) {
  const { leads, addFollowUp } = useCrmStore();
  const [leadId, setLeadId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  const submit = async () => {
    if (!leadId) { toast.error('Please select a contact'); return; }
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!dueAt) { toast.error('Please set a due date'); return; }
    try {
      const created = await api.post<any>(`/api/leads/${leadId}/followups`, {
        title: title.trim(),
        description: description.trim() || undefined,
        due_at: new Date(dueAt).toISOString(),
        assigned_to: assignedTo || undefined,
      });
      addFollowUp({
        id: created.id,
        leadId,
        note: title.trim() + (description.trim() ? `\n${description.trim()}` : ''),
        dueAt: created.due_at ?? new Date(dueAt).toISOString(),
        completed: false,
        assignedTo: assignedTo || undefined,
        createdAt: created.created_at ?? new Date().toISOString(),
      });
      toast.success('Follow-up scheduled');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to schedule follow-up');
    }
  };

  const inputCls = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-[#1c1410] outline-none focus:border-primary/40 placeholder:text-gray-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h3 className="font-headline font-bold text-[#1c1410] text-[17px]">+ Add Follow-up</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c]"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Contact <span className="text-red-400">*</span></label>
            <select className={inputCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Select contact</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Title <span className="text-red-400">*</span></label>
            <input className={inputCls} placeholder="e.g. Call back" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Description</label>
            <input className={inputCls} placeholder="e.g. Pre sales pitch" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Due Date & Time <span className="text-red-400">*</span></label>
            <input type="datetime-local" className={inputCls} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Assign To</label>
            <select className={inputCls} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Unassigned</option>
              {staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5">
          <button onClick={onClose} className="px-5 py-2 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">Cancel</button>
          <button onClick={submit} className="px-6 py-2 rounded-xl text-[13px] font-bold text-white hover:-translate-y-0.5 transition-all" style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}>
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
type FilterTab = 'all' | 'due_today' | 'upcoming' | 'overdue' | 'completed';

export default function FollowUpPage() {
  const { followUps, leads, completeFollowUp } = useCrmStore();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [assignFilter, setAssignFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const enriched = useMemo(() => followUps.map((fu) => {
    const lead = leads.find((l) => l.id === fu.leadId);
    const due = new Date(fu.dueAt);
    const isOverdue = !fu.completed && isPast(due) && !isToday(due);
    const isDueToday = !fu.completed && isToday(due);
    const isUpcoming = !fu.completed && isFuture(due) && !isToday(due);
    const [rawTitle, ...descParts] = (fu.note ?? '').split('\n');
    return { ...fu, lead, due, isOverdue, isDueToday, isUpcoming, title: rawTitle, description: descParts.join(' ') };
  }), [followUps, leads]);

  const counts = useMemo(() => ({
    all: enriched.length,
    due_today: enriched.filter((f) => f.isDueToday).length,
    upcoming: enriched.filter((f) => f.isUpcoming).length,
    overdue: enriched.filter((f) => f.isOverdue).length,
    completed: enriched.filter((f) => f.completed).length,
  }), [enriched]);

  const filtered = useMemo(() => {
    let result = enriched;
    if (filter === 'due_today') result = result.filter((f) => f.isDueToday);
    else if (filter === 'upcoming') result = result.filter((f) => f.isUpcoming);
    else if (filter === 'overdue') result = result.filter((f) => f.isOverdue);
    else if (filter === 'completed') result = result.filter((f) => f.completed);

    if (assignFilter) result = result.filter((f) => f.assignedTo === assignFilter);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((f) =>
        f.title?.toLowerCase().includes(s) ||
        f.lead?.firstName?.toLowerCase().includes(s) ||
        f.lead?.lastName?.toLowerCase().includes(s) ||
        f.lead?.email?.toLowerCase().includes(s)
      );
    }
    result = [...result].sort((a, b) =>
      sortOrder === 'asc'
        ? new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
        : new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime()
    );
    return result;
  }, [enriched, filter, assignFilter, search, sortOrder]);

  const toggleAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map((f) => f.id));
  const toggleOne = (id: string) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const filterTabs = [
    { key: 'all' as FilterTab, label: 'All', icon: Layers, color: 'text-blue-500', border: 'border-blue-400', bg: 'bg-blue-50' },
    { key: 'due_today' as FilterTab, label: 'Due Today', icon: AlarmClock, color: 'text-blue-500', border: 'border-blue-200', bg: 'bg-white' },
    { key: 'upcoming' as FilterTab, label: 'Upcoming', icon: Calendar, color: 'text-blue-500', border: 'border-blue-200', bg: 'bg-white' },
    { key: 'overdue' as FilterTab, label: 'Overdue', icon: Clock, color: 'text-amber-500', border: 'border-amber-200', bg: 'bg-white' },
    { key: 'completed' as FilterTab, label: 'Completed', icon: CheckCircle2, color: 'text-green-500', border: 'border-green-200', bg: 'bg-white' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="section-label mb-0.5">Lead Management</p>
          <h2 className="font-headline text-[29px] font-extrabold tracking-tight text-[#1c1410]">Follow-up</h2>
          <p className="text-[13px] text-[#7a6b5c] mt-0.5">You have total {enriched.length} Task{enriched.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Filters: staff + sort */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={assignFilter}
            onChange={(e) => setAssignFilter(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2 text-[12px] text-[#1c1410] outline-none focus:border-primary/40 bg-white min-w-[180px]"
          >
            <option value="">Select assigned staff</option>
            {staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="relative">
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
              className="border border-gray-200 rounded-xl pl-4 pr-8 py-2 text-[12px] text-[#1c1410] outline-none focus:border-primary/40 bg-white appearance-none min-w-[170px]"
            >
              <option value="asc">Date Added (ASC)</option>
              <option value="desc">Date Added (DESC)</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#7a6b5c] pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Filter Tab Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {filterTabs.map((tab) => {
          const isActive = filter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 py-5 rounded-2xl border-2 transition-all hover:-translate-y-0.5',
                isActive ? `${tab.border} ${tab.bg} shadow-md` : 'border-black/5 bg-white hover:border-black/10'
              )}
            >
              <tab.icon className={cn('w-5 h-5', isActive ? tab.color : 'text-[#b09e8d]')} />
              <span className={cn('text-[13px] font-semibold', isActive ? tab.color : 'text-[#7a6b5c]')}>{tab.label}</span>
              <span className={cn('font-headline text-[22px] font-extrabold tracking-tight', isActive ? tab.color : 'text-[#1c1410]')}>
                {counts[tab.key]}
              </span>
              {isActive && (
                <span className="absolute bottom-2 right-2 bg-blue-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  Selected
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-black/5 card-shadow overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 gap-3 flex-wrap">
          <h3 className="font-headline font-bold text-[#1c1410] text-[15px]">Follow-up</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-[12px] font-bold transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 12px rgba(234,88,12,0.25)' }}
            >
              <Plus className="w-3.5 h-3.5" /> Follow-up
            </button>
            {selected.length > 0 && (
              <button className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-500 hover:bg-red-100 transition-colors" title="Delete selected">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button className="w-8 h-8 rounded-lg bg-[var(--app-bg)] flex items-center justify-center text-[#7a6b5c] hover:bg-gray-100 transition-colors" title="Export">
              <Download className="w-3.5 h-3.5" />
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b09e8d]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="pl-9 pr-4 py-1.5 text-[12px] bg-[var(--app-bg)] border border-black/5 rounded-xl outline-none focus:ring-1 focus:ring-primary/30 w-44"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[860px]">
            <thead>
              <tr className="border-b border-black/5 bg-[var(--app-bg)]">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox"
                    checked={filtered.length > 0 && selected.length === filtered.length}
                    onChange={toggleAll}
                    className="w-4 h-4 accent-primary"
                  />
                </th>
                {['Title & Description', 'Contact', 'Created On', 'Due Date', 'Status', 'Assign', 'Option'].map((col) => (
                  <th key={col} className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#7a6b5c] whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <CheckCircle2 className="w-8 h-8 text-[#c4b09e] mx-auto mb-2" />
                    <p className="text-[13px] text-[#7a6b5c]">No follow-ups found</p>
                  </td>
                </tr>
              )}
              {filtered.map((fu) => {
                const isSelected = selected.includes(fu.id);
                const assignedStaff = staff.find((s) => s.id === fu.assignedTo);
                const dueColor = fu.completed ? 'text-[#1c1410]' : fu.isOverdue ? 'text-red-500 font-semibold' : 'text-[#1c1410]';
                  const createdAt = fu.createdAt ? new Date(fu.createdAt) : null;

                return (
                  <tr key={fu.id} className={cn('hover:bg-[var(--app-bg)] transition-colors', isSelected && 'bg-primary/[0.03]')}>
                    {/* Checkbox */}
                    <td className="px-4 py-4">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(fu.id)} className="w-4 h-4 accent-primary" />
                    </td>

                    {/* Title & Description */}
                    <td className="px-3 py-4 min-w-[180px]">
                      <p className={cn('font-semibold text-[#1c1410]', fu.completed && 'line-through text-[#b09e8d]')}>
                        {fu.title || fu.note}
                      </p>
                      {fu.description && (
                        <p className="text-[11px] text-[#7a6b5c] mt-0.5">{fu.description}</p>
                      )}
                    </td>

                    {/* Contact */}
                    <td className="px-3 py-4 min-w-[210px]">
                      {fu.lead ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3 h-3 text-[#b09e8d] shrink-0" />
                            <span className="font-semibold text-primary text-[13px]">{fu.lead.firstName} {fu.lead.lastName}</span>
                          </div>
                          {fu.lead.email && (
                            <div className="flex items-center gap-1.5">
                              <Mail className="w-3 h-3 text-[#b09e8d] shrink-0" />
                              <span className="text-[11px] text-[#7a6b5c] truncate max-w-[160px]">{fu.lead.email}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3 text-[#b09e8d] shrink-0" />
                            <a href={`tel:${fu.lead.phone}`} className="text-[11px] text-[#7a6b5c] hover:text-primary transition-colors" onClick={(e) => e.stopPropagation()}>{fu.lead.phone}</a>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[#b09e8d] text-[12px]">Unknown contact</span>
                      )}
                    </td>

                    {/* Created On */}
                    <td className="px-3 py-4 whitespace-nowrap text-[#7a6b5c]">
                      {createdAt ? (
                        <>
                          <p className="text-[12px] font-medium text-[#1c1410]">{format(createdAt, 'dd/MM/yyyy')}</p>
                          <p className="text-[11px] text-[#7a6b5c]">at {format(createdAt, 'hh:mm aa')}</p>
                        </>
                      ) : <span className="text-[#b09e8d]">—</span>}
                    </td>

                    {/* Due Date */}
                    <td className="px-3 py-4 whitespace-nowrap">
                      <p className={cn('text-[12px] font-medium', dueColor)}>{format(fu.due, 'dd/MM/yyyy')}</p>
                      <p className={cn('text-[11px]', dueColor)}>at {format(fu.due, 'hh:mm aa')}</p>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-4">
                      <button
                        onClick={() => { if (!fu.completed) { completeFollowUp(fu.id, fu.leadId); toast.success('Marked complete'); } }}
                        disabled={fu.completed}
                        className={cn(
                          'w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all',
                          fu.completed
                            ? 'border-green-400 bg-green-400'
                            : fu.isOverdue
                            ? 'border-red-400 hover:border-red-500'
                            : 'border-[#c4b09e] hover:border-primary'
                        )}
                        title={fu.completed ? 'Completed' : 'Mark complete'}
                      >
                        {fu.completed && <Check className="w-4 h-4 text-white" />}
                      </button>
                    </td>

                    {/* Assign */}
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-1.5">
                        {assignedStaff ? (
                          <div className="w-7 h-7 rounded-full bg-[#1c1410] flex items-center justify-center text-[10px] font-bold text-white" title={assignedStaff.name}>
                            {assignedStaff.avatar}
                          </div>
                        ) : (
                          <button className="w-7 h-7 rounded-full bg-[#1c1410] flex items-center justify-center text-white hover:opacity-80 transition-opacity" title="Assign staff">
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Option */}
                    <td className="px-3 py-4">
                      <div className="relative">
                        <button
                          onClick={() => setOpenMenu(openMenu === fu.id ? null : fu.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#b09e8d] hover:bg-gray-100 hover:text-[#1c1410] transition-colors"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openMenu === fu.id && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setOpenMenu(null)} />
                            <div className="absolute right-0 top-8 z-40 bg-white rounded-xl border border-black/5 shadow-2xl w-36 py-1 overflow-hidden">
                              {!fu.completed && (
                                <button
                                  onClick={() => { completeFollowUp(fu.id, fu.leadId); toast.success('Marked complete'); setOpenMenu(null); }}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] text-[#1c1410] hover:bg-[var(--app-bg)]"
                                >
                                  <Check className="w-3.5 h-3.5 text-green-500" /> Complete
                                </button>
                              )}
                              <button
                                onClick={() => setOpenMenu(null)}
                                className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] text-red-500 hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                              </button>
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

      {showAdd && <AddFollowUpModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
