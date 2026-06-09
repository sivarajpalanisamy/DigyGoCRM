import { useState, useEffect } from 'react';
import { Shuffle, Plus, Trash2, GripVertical, ArrowLeft, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '@/store/crmStore';
import { api } from '@/lib/api';

type AssignMethod = 'round-robin' | 'source' | 'stage' | 'manual';

interface AssignRule {
  id: string;
  name: string;
  method: AssignMethod;
  condition: string;
  assign_to: string | null;
  assign_to_name?: string;
  is_active: boolean;
}

const SOURCES = ['Meta Forms', 'WhatsApp', 'Custom Form', 'Manual', 'Landing Page', 'Google Ads', 'Referral'];
const STAGES  = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];

function RuleModal({ onClose, onSave, staffList }: {
  onClose: () => void;
  onSave: (r: Omit<AssignRule, 'id' | 'assign_to_name'>) => Promise<void>;
  staffList: Array<{ id: string; name: string }>;
}) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState<AssignMethod>('source');
  const [condition, setCondition] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Rule name is required'); return; }
    if (method !== 'round-robin' && method !== 'manual' && !condition) { toast.error('Condition is required'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), method, condition, assign_to: assignTo || null, is_active: true });
      onClose();
    } catch { toast.error('Failed to add rule'); }
    finally { setSaving(false); }
  };

  const conditionOptions = method === 'source' ? SOURCES : method === 'stage' ? STAGES : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-black/5 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h3 className="font-headline font-bold text-[#1c1410]">Add Assignment Rule</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--accent-tint)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Rule Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WhatsApp Leads → Priya" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Assignment Method</label>
            <div className="grid grid-cols-2 gap-2">
              {(['round-robin', 'source', 'stage', 'manual'] as const).map((m) => (
                <button key={m} onClick={() => setMethod(m)}
                  className={cn('p-2.5 rounded-xl border text-sm font-medium transition-all capitalize', method === m ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-[var(--accent-tint)]')}>
                  {m.replace('-', ' ')}
                </button>
              ))}
            </div>
          </div>
          {(method === 'source' || method === 'stage') && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">When {method === 'source' ? 'Source is' : 'Stage is'}</label>
              <select className="w-full border border-black/5 rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none" value={condition} onChange={(e) => setCondition(e.target.value)}>
                <option value="">Select…</option>
                {conditionOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          )}
          {method !== 'round-robin' && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Assign To</label>
              <select className="w-full border border-black/5 rounded-lg px-3 py-2 text-sm bg-card focus:border-primary outline-none" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Select agent…</option>
                {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {method === 'round-robin' && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-[11px] text-[#7a6b5c]">Leads will be distributed evenly across all active agents automatically.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-black/5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}><Check className="w-4 h-4 mr-1" /> {saving ? 'Adding…' : 'Add Rule'}</Button>
        </div>
      </div>
    </div>
  );
}

export default function AssignmentRulesPage() {
  const navigate = useNavigate();
  const { staff: storeStaff } = useCrmStore();
  const [rules, setRules] = useState<AssignRule[]>([]);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string }>>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any[]>('/api/assignment-rules')
      .then((rows) => setRules(rows.map((r) => ({
        id: r.id, name: r.name, method: r.method as AssignMethod,
        condition: r.condition ?? '', assign_to: r.assign_to ?? null,
        assign_to_name: r.assign_to_name ?? '', is_active: r.is_active,
      }))))
      .catch(() => {})
      .finally(() => setLoading(false));

    // Prefer store staff (already loaded), fallback to API
    if (storeStaff.length > 0) {
      setStaffList(storeStaff.filter((s) => s.status === 'active').map((s) => ({ id: s.id, name: s.name })));
    } else {
      api.get<any[]>('/api/settings/staff')
        .then((rows) => setStaffList(rows.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name }))))
        .catch(() => {});
    }
  }, [storeStaff]);

  const toggleRule = async (rule: AssignRule) => {
    const next = !rule.is_active;
    try {
      await api.patch(`/api/assignment-rules/${rule.id}`, { is_active: next });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: next } : r));
    } catch { toast.error('Failed to update rule'); }
  };

  const deleteRule = async (rule: AssignRule) => {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await api.delete(`/api/assignment-rules/${rule.id}`);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast.success(`Rule deleted`);
    } catch { toast.error('Failed to delete rule'); }
  };

  const handleAdd = async (data: Omit<AssignRule, 'id' | 'assign_to_name'>) => {
    const created = await api.post<any>('/api/assignment-rules', {
      name: data.name, method: data.method, condition: data.condition || null,
      assign_to: data.assign_to || null, sort_order: rules.length,
    });
    const assigneeName = staffList.find((s) => s.id === created.assign_to)?.name ?? '';
    setRules((prev) => [...prev, {
      id: created.id, name: created.name, method: created.method,
      condition: created.condition ?? '', assign_to: created.assign_to,
      assign_to_name: assigneeName, is_active: created.is_active,
    }]);
    toast.success(`Rule "${created.name}" added`);
  };

  const methodBadge: Record<AssignMethod, string> = {
    'round-robin': 'bg-blue-100 text-blue-700',
    source:  'bg-purple-100 text-purple-700',
    stage:   'bg-yellow-100 text-yellow-700',
    manual:  'bg-muted text-muted-foreground',
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/settings')} className="p-2 rounded-lg hover:bg-[var(--accent-tint)] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Button className="ml-auto" onClick={() => setShowModal(true)}><Plus className="w-4 h-4 mr-1" /> Add Rule</Button>
      </div>

      <div className="p-4 bg-muted/40 rounded-xl border border-black/5 text-[13px] text-[#7a6b5c]">
        Rules are evaluated in order. The first matching rule wins. Toggle off to disable without deleting.
      </div>

      <div className="bg-white rounded-2xl border border-black/5 card-shadow overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-[13px] text-[#b09e8d]">Loading…</div>
        ) : rules.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Shuffle className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No assignment rules yet</p>
            <p className="text-sm mt-1">Add rules to automate lead distribution</p>
          </div>
        ) : (
          rules.map((rule, i) => (
            <div key={rule.id} className={cn('flex items-center gap-3 px-4 py-3.5 border-b border-black/5 last:border-0 hover:bg-[var(--app-bg)] transition-colors', !rule.is_active && 'opacity-60')}>
              <button className="cursor-grab text-muted-foreground"><GripVertical className="w-4 h-4" /></button>
              <span className="text-[11px] text-[#7a6b5c] w-5 shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{rule.name}</p>
                <p className="text-[11px] text-[#7a6b5c] mt-0.5">
                  {rule.method === 'round-robin'
                    ? 'Distribute evenly across all agents'
                    : `${rule.method === 'source' ? 'Source' : rule.method === 'stage' ? 'Stage' : 'Condition'}: ${rule.condition || '—'} → ${rule.assign_to_name || 'Unassigned'}`}
                </p>
              </div>
              <Badge className={cn('border-0 text-xs shrink-0 capitalize', methodBadge[rule.method])}>
                {rule.method.replace('-', ' ')}
              </Badge>
              <Switch checked={rule.is_active} onCheckedChange={() => toggleRule(rule)} />
              <button onClick={() => deleteRule(rule)} className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {showModal && <RuleModal onClose={() => setShowModal(false)} onSave={handleAdd} staffList={staffList} />}
    </div>
  );
}
