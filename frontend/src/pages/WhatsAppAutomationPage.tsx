import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Plus, Trash2, X, Check, ChevronDown, ChevronRight, MessageCircle, GitBranch, Zap, Play, Pause, ArrowDown, MoreHorizontal, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────
type NodeType = 'send_message' | 'condition' | 'action' | 'end';
type TriggerType = 'keyword' | 'button_click' | 'first_message' | 'opt_in';
type ActionType = 'assign_lead' | 'add_tag' | 'change_stage' | 'notify_staff';

interface Button { id: string; label: string; payload: string; nextNodeId: string | null; }
interface FlowNode {
  id: string;
  type: NodeType;
  // send_message
  message?: string;
  buttons?: Button[];
  // condition
  conditionField?: string; // 'button_payload' | 'message_contains' | 'stage_is'
  conditionValue?: string;
  trueNodeId?: string | null;
  falseNodeId?: string | null;
  // action
  actionType?: ActionType;
  actionValue?: string;
  nextNodeId?: string | null;
}

interface BotFlow {
  id: string;
  name: string;
  trigger: TriggerType;
  triggerValue?: string;
  nodes: FlowNode[];
  rootNodeId: string;
  isActive: boolean;
  executionCount: number;
}

// ── Default Flows ──────────────────────────────────────────────────────────────
const defaultFlows: BotFlow[] = [
  {
    id: 'flow-1',
    name: 'Proposal Follow-up',
    trigger: 'button_click',
    triggerValue: 'proposal_reply',
    isActive: true,
    executionCount: 89,
    rootNodeId: 'n1',
    nodes: [
      {
        id: 'n1', type: 'send_message',
        message: 'Hi {%first_name%}! 👋 We sent you a proposal. Have you had a chance to review it?',
        buttons: [
          { id: 'b1', label: 'Yes, interested!', payload: 'interested', nextNodeId: 'n2' },
          { id: 'b2', label: 'Need more time', payload: 'more_time', nextNodeId: 'n3' },
          { id: 'b3', label: 'Not interested', payload: 'not_interested', nextNodeId: 'n4' },
        ],
      },
      {
        id: 'n2', type: 'send_message',
        message: 'That\'s great! 🎉 Let me connect you with our team right away. They\'ll reach out within 30 minutes.',
        nextNodeId: 'n5',
      },
      {
        id: 'n3', type: 'send_message',
        message: 'No worries at all! I\'ll follow up with you in 2 days. Feel free to reach out anytime.',
        nextNodeId: null,
      },
      {
        id: 'n4', type: 'send_message',
        message: 'Understood! If you ever change your mind or need a different solution, we\'re always here to help. Have a great day! 😊',
        nextNodeId: null,
      },
      {
        id: 'n5', type: 'action',
        actionType: 'change_stage',
        actionValue: 'Qualified',
        nextNodeId: null,
      },
    ],
  },
  {
    id: 'flow-2',
    name: 'Welcome New Lead',
    trigger: 'first_message',
    isActive: true,
    executionCount: 234,
    rootNodeId: 'n1',
    nodes: [
      {
        id: 'n1', type: 'send_message',
        message: 'Hi {%first_name%}! Welcome to NexCRM 👋 How can we help you today?',
        buttons: [
          { id: 'b1', label: 'Book a Demo', payload: 'book_demo', nextNodeId: 'n2' },
          { id: 'b2', label: 'Get Pricing', payload: 'get_pricing', nextNodeId: 'n3' },
          { id: 'b3', label: 'Talk to Support', payload: 'support', nextNodeId: 'n4' },
        ],
      },
      { id: 'n2', type: 'send_message', message: 'Sure! Here\'s my booking link: {%booking_link%}. Pick a time that works for you!', nextNodeId: null },
      { id: 'n3', type: 'send_message', message: 'Our plans start from ₹999/month. Let me send you the full pricing details. Want me to also schedule a call to walk you through it?', nextNodeId: null },
      { id: 'n4', type: 'send_message', message: 'I\'m connecting you with our support team now. They\'ll be with you in a moment! ⚡', nextNodeId: null },
    ],
  },
];

// ── Node Rendering ─────────────────────────────────────────────────────────────
const CONDITION_FIELDS = [
  { value: 'button_payload', label: 'Button Clicked' },
  { value: 'message_contains', label: 'Message Contains' },
  { value: 'stage_is', label: 'Lead Stage Is' },
];
const STAGES = ['New Leads', 'Contacted', 'Qualified', 'Proposal Sent', 'Closed Won'];
const ACTION_LABELS: Record<ActionType, string> = {
  assign_lead: 'Assign to Agent', add_tag: 'Add Tag', change_stage: 'Move to Stage', notify_staff: 'Notify Staff',
};
const ACTION_ICONS: Record<ActionType, string> = {
  assign_lead: '👤', add_tag: '🏷️', change_stage: '🔀', notify_staff: '🔔',
};

// ── Flow Builder Modal ─────────────────────────────────────────────────────────
function FlowBuilderModal({ initial, onClose, onSave }: {
  initial?: BotFlow | null;
  onClose: () => void;
  onSave: (flow: Omit<BotFlow, 'id' | 'executionCount'>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [trigger, setTrigger] = useState<TriggerType>(initial?.trigger ?? 'first_message');
  const [triggerValue, setTriggerValue] = useState(initial?.triggerValue ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [nodes, setNodes] = useState<FlowNode[]>(
    initial?.nodes ?? [{ id: 'n1', type: 'send_message', message: '', buttons: [], nextNodeId: null }]
  );
  const [rootNodeId] = useState(initial?.rootNodeId ?? 'n1');

  const TRIGGER_OPTIONS: { value: TriggerType; label: string; desc: string }[] = [
    { value: 'first_message', label: 'First Message', desc: 'When a contact messages for the first time' },
    { value: 'keyword', label: 'Keyword Match', desc: 'When message contains a specific keyword' },
    { value: 'button_click', label: 'Button Clicked', desc: 'When user clicks a reply button' },
    { value: 'opt_in', label: 'Opt-in', desc: 'When a lead opts in via a form or link' },
  ];

  const addNode = (type: NodeType) => {
    const id = `n-${Date.now()}`;
    const node: FlowNode = { id, type };
    if (type === 'send_message') node.buttons = [];
    if (type === 'condition') { node.conditionField = 'button_payload'; node.conditionValue = ''; node.trueNodeId = null; node.falseNodeId = null; }
    if (type === 'action') { node.actionType = 'change_stage'; node.actionValue = ''; node.nextNodeId = null; }
    setNodes([...nodes, node]);
  };

  const updateNode = (id: string, updates: Partial<FlowNode>) => setNodes(nodes.map((n) => n.id === id ? { ...n, ...updates } : n));
  const deleteNode = (id: string) => { if (nodes.length === 1) { toast.error('Flow must have at least one node'); return; } setNodes(nodes.filter((n) => n.id !== id)); };

  const addButton = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId)!;
    if ((node.buttons?.length ?? 0) >= 3) { toast.error('Max 3 buttons per message'); return; }
    updateNode(nodeId, { buttons: [...(node.buttons ?? []), { id: `b-${Date.now()}`, label: '', payload: '', nextNodeId: null }] });
  };
  const updateButton = (nodeId: string, btnId: string, updates: Partial<Button>) => {
    const node = nodes.find((n) => n.id === nodeId)!;
    updateNode(nodeId, { buttons: node.buttons?.map((b) => b.id === btnId ? { ...b, ...updates } : b) });
  };
  const deleteButton = (nodeId: string, btnId: string) => {
    const node = nodes.find((n) => n.id === nodeId)!;
    updateNode(nodeId, { buttons: node.buttons?.filter((b) => b.id !== btnId) });
  };

  const handleSave = () => {
    if (!name.trim()) { toast.error('Flow name is required'); return; }
    if (trigger === 'keyword' && !triggerValue.trim()) { toast.error('Keyword is required'); return; }
    onSave({ name, trigger, triggerValue: triggerValue || undefined, isActive, nodes, rootNodeId });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card rounded-2xl border border-[var(--hairline)] w-full max-w-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--hairline)] shrink-0">
          <h3 className="font-headline font-bold text-[#111318]">{initial ? 'Edit Flow' : 'Create WhatsApp Flow'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--accent-tint)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Name + Status */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-[15px] font-medium text-foreground mb-1.5 block">Flow Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Proposal Follow-up" />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <span className="text-[15px] text-[#6b7280]">Active</span>
            </div>
          </div>

          {/* Trigger */}
          <div>
            <label className="text-[15px] font-medium text-foreground mb-2 block">Trigger - when should this flow start?</label>
            <div className="grid grid-cols-2 gap-2">
              {TRIGGER_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTrigger(t.value)}
                  className={cn('flex flex-col items-start p-3 rounded-xl border text-left transition-all', trigger === t.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-[var(--accent-tint)]')}
                >
                  <p className={cn('text-[15px] font-medium', trigger === t.value ? 'text-primary' : 'text-foreground')}>{t.label}</p>
                  <p className="text-[12px] text-[#6b7280] mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
            {trigger === 'keyword' && (
              <div className="mt-3">
                <label className="text-[13px] font-medium text-muted-foreground mb-1 block">Keyword to match</label>
                <Input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder="e.g. DEMO, pricing, hello" />
              </div>
            )}
            {trigger === 'button_click' && (
              <div className="mt-3">
                <label className="text-[13px] font-medium text-muted-foreground mb-1 block">Button payload to match (optional - leave blank for any)</label>
                <Input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder="e.g. proposal_reply" className="font-mono text-[15px]" />
              </div>
            )}
          </div>

          {/* Nodes */}
          <div>
            <label className="text-[15px] font-medium text-foreground mb-2 block">Flow Steps</label>
            <div className="space-y-3">
              {nodes.map((node, idx) => (
                <div key={node.id} className={cn('rounded-xl border p-4 space-y-3', node.type === 'send_message' ? 'border-green-200 bg-green-50/50' : node.type === 'condition' ? 'border-yellow-200 bg-yellow-50/50' : node.type === 'action' ? 'border-blue-200 bg-blue-50/50' : 'border-border bg-[var(--app-bg)]')}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold uppercase tracking-wider text-[#6b7280] bg-muted px-2 py-0.5 rounded-full">Step {idx + 1}</span>
                      <span className={cn('text-[13px] font-medium capitalize px-2 py-0.5 rounded-full', node.type === 'send_message' ? 'bg-green-100 text-green-700' : node.type === 'condition' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700')}>
                        {node.type === 'send_message' ? '💬 Send Message' : node.type === 'condition' ? '🔀 Condition' : '⚡ Action'}
                      </span>
                    </div>
                    <button onClick={() => deleteNode(node.id)} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>

                  {/* Send Message */}
                  {node.type === 'send_message' && (
                    <div className="space-y-3">
                      <textarea
                        className="w-full border border-[var(--hairline)] rounded-xl px-3 py-2 text-[15px] bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none resize-none"
                        rows={3}
                        value={node.message ?? ''}
                        onChange={(e) => updateNode(node.id, { message: e.target.value })}
                        placeholder="Type your message… Use {%first_name%}, {%booking_link%} etc."
                      />
                      <div className="space-y-2">
                        <p className="text-[13px] font-medium text-muted-foreground">Reply Buttons (max 3) - each button leads to the next step</p>
                        {node.buttons?.map((btn) => (
                          <div key={btn.id} className="flex gap-2 items-center">
                            <Input value={btn.label} onChange={(e) => updateButton(node.id, btn.id, { label: e.target.value })} placeholder="Button label" className="flex-1 text-[15px]" />
                            <Input value={btn.payload} onChange={(e) => updateButton(node.id, btn.id, { payload: e.target.value })} placeholder="payload" className="w-32 text-[13px] font-mono" />
                            <button onClick={() => deleteButton(node.id, btn.id)} className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        {(node.buttons?.length ?? 0) < 3 && (
                          <button onClick={() => addButton(node.id)} className="text-[13px] text-primary flex items-center gap-1 hover:underline"><Plus className="w-3 h-3" /> Add Button</button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Condition */}
                  {node.type === 'condition' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[13px] font-medium text-muted-foreground mb-1 block">Condition</label>
                        <select className="w-full border border-[var(--hairline)] rounded-xl px-2 py-1.5 text-[15px] bg-card outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" value={node.conditionField} onChange={(e) => updateNode(node.id, { conditionField: e.target.value })}>
                          {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[13px] font-medium text-muted-foreground mb-1 block">Value</label>
                        {node.conditionField === 'stage_is' ? (
                          <select className="w-full border border-[var(--hairline)] rounded-xl px-2 py-1.5 text-[15px] bg-card outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" value={node.conditionValue} onChange={(e) => updateNode(node.id, { conditionValue: e.target.value })}>
                            {STAGES.map((s) => <option key={s}>{s}</option>)}
                          </select>
                        ) : (
                          <Input value={node.conditionValue ?? ''} onChange={(e) => updateNode(node.id, { conditionValue: e.target.value })} placeholder={node.conditionField === 'button_payload' ? 'e.g. interested' : 'keyword'} className="text-[15px]" />
                        )}
                      </div>
                      <div className="col-span-2 grid grid-cols-2 gap-2">
                        <div className="p-2 bg-green-50 border border-green-200 rounded-lg text-center text-[13px] font-medium text-green-700">✓ If True → next step</div>
                        <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-center text-[13px] font-medium text-red-600">✗ If False → next step</div>
                      </div>
                    </div>
                  )}

                  {/* Action */}
                  {node.type === 'action' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[13px] font-medium text-muted-foreground mb-1 block">Action Type</label>
                        <select className="w-full border border-[var(--hairline)] rounded-xl px-2 py-1.5 text-[15px] bg-card outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" value={node.actionType} onChange={(e) => updateNode(node.id, { actionType: e.target.value as ActionType })}>
                          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[13px] font-medium text-muted-foreground mb-1 block">Value</label>
                        {node.actionType === 'change_stage' ? (
                          <select className="w-full border border-[var(--hairline)] rounded-xl px-2 py-1.5 text-[15px] bg-card outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" value={node.actionValue} onChange={(e) => updateNode(node.id, { actionValue: e.target.value })}>
                            {STAGES.map((s) => <option key={s}>{s}</option>)}
                          </select>
                        ) : (
                          <Input value={node.actionValue ?? ''} onChange={(e) => updateNode(node.id, { actionValue: e.target.value })} placeholder={node.actionType === 'add_tag' ? 'Tag name' : node.actionType === 'assign_lead' ? 'Agent name' : 'Value'} className="text-[15px]" />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add Step */}
            <div className="flex gap-2 mt-3">
              <button onClick={() => addNode('send_message')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-green-300 text-[15px] text-green-700 hover:bg-green-50 transition-colors">
                <MessageCircle className="w-3.5 h-3.5" /> Message
              </button>
              <button onClick={() => addNode('condition')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-yellow-300 text-[15px] text-yellow-700 hover:bg-yellow-50 transition-colors">
                <GitBranch className="w-3.5 h-3.5" /> Condition
              </button>
              <button onClick={() => addNode('action')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-blue-300 text-[15px] text-blue-700 hover:bg-blue-50 transition-colors">
                <Zap className="w-3.5 h-3.5" /> Action
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--hairline)] shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}><Check className="w-4 h-4 mr-1" /> {initial ? 'Save Changes' : 'Create Flow'}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Flow Preview Card ──────────────────────────────────────────────────────────
function FlowVisual({ flow }: { flow: BotFlow }) {
  const [expanded, setExpanded] = useState(false);
  const rootNode = flow.nodes.find((n) => n.id === flow.rootNodeId);

  const triggerLabel: Record<TriggerType, string> = {
    first_message: '💬 First Message',
    keyword: `🔤 Keyword: "${flow.triggerValue}"`,
    button_click: `🖱️ Button: "${flow.triggerValue || 'any'}"`,
    opt_in: '✅ Opt-in',
  };

  return (
    <div className="space-y-1">
      {/* Trigger */}
      <div className="flex justify-center">
        <div className="bg-primary/10 border border-primary/20 text-primary text-[13px] font-semibold px-3 py-1.5 rounded-full">
          {triggerLabel[flow.trigger]}
        </div>
      </div>
      <div className="flex justify-center"><ArrowDown className="w-4 h-4 text-muted-foreground" /></div>

      {/* Root node */}
      {rootNode && (
        <div className="flex justify-center">
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 max-w-xs w-full">
            <p className="text-[13px] font-semibold text-green-700 mb-1">💬 Send Message</p>
            <p className="text-[13px] text-gray-700 line-clamp-2">{rootNode.message}</p>
            {rootNode.buttons && rootNode.buttons.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {rootNode.buttons.map((btn) => (
                  <span key={btn.id} className="text-[13px] bg-white border border-green-200 text-green-700 px-2 py-0.5 rounded-full">{btn.label}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {flow.nodes.length > 1 && (
        <div className="flex flex-col items-center gap-1 mt-1">
          <ArrowDown className="w-4 h-4 text-muted-foreground" />
          <button onClick={() => setExpanded(!expanded)} className="text-[12px] text-[#6b7280] hover:text-foreground flex items-center gap-1">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {expanded ? 'Hide' : 'Show'} {flow.nodes.length - 1} more step{flow.nodes.length - 1 !== 1 ? 's' : ''}
          </button>
          {expanded && (
            <div className="space-y-1 w-full max-w-xs">
              {flow.nodes.slice(1).map((node) => (
                <div key={node.id} className={cn('rounded-xl border p-2.5', node.type === 'send_message' ? 'bg-green-50 border-green-200' : node.type === 'condition' ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200')}>
                  <p className={cn('text-[13px] font-semibold mb-0.5', node.type === 'send_message' ? 'text-green-700' : node.type === 'condition' ? 'text-yellow-700' : 'text-blue-700')}>
                    {node.type === 'send_message' ? '💬 Message' : node.type === 'condition' ? '🔀 Condition' : `⚡ ${ACTION_LABELS[node.actionType!] ?? 'Action'}`}
                  </p>
                  <p className="text-[12px] text-[#6b7280] line-clamp-1">
                    {node.type === 'send_message' ? node.message : node.type === 'condition' ? `If ${node.conditionField} = "${node.conditionValue}"` : node.actionValue}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
function mapFlow(r: any): BotFlow {
  return {
    id: r.id,
    name: r.name,
    trigger: r.trigger as TriggerType,
    triggerValue: r.trigger_value ?? undefined,
    isActive: r.is_active ?? false,
    nodes: r.nodes ?? [],
    rootNodeId: r.root_node_id ?? '',
    executionCount: r.execution_count ?? 0,
  };
}

export default function WhatsAppAutomationPage() {
  const navigate = useNavigate();
  const [flows, setFlows] = useState<BotFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editFlow, setEditFlow] = useState<BotFlow | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<BotFlow | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    api.get<any[]>('/api/whatsapp-flows')
      .then((rows) => {
        const mapped = (rows ?? []).map(mapFlow);
        setFlows(mapped);
        if (mapped.length > 0) setSelectedFlow(mapped[0]);
      })
      .catch(() => { setFlows(defaultFlows); setSelectedFlow(defaultFlows[0]); })
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async (data: Omit<BotFlow, 'id' | 'executionCount'>) => {
    try {
      const created = await api.post<any>('/api/whatsapp-flows', {
        name: data.name, trigger: data.trigger, trigger_value: data.triggerValue,
        is_active: data.isActive, nodes: data.nodes, root_node_id: data.rootNodeId,
      });
      const newFlow = mapFlow(created);
      setFlows((prev) => [newFlow, ...prev]);
      setSelectedFlow(newFlow);
      setShowModal(false);
      toast.success(`Flow "${data.name}" created`);
    } catch { toast.error('Failed to create flow'); }
  };

  const handleEdit = async (data: Omit<BotFlow, 'id' | 'executionCount'>) => {
    if (!editFlow) return;
    try {
      await api.patch(`/api/whatsapp-flows/${editFlow.id}`, {
        name: data.name, trigger: data.trigger, trigger_value: data.triggerValue,
        is_active: data.isActive, nodes: data.nodes, root_node_id: data.rootNodeId,
      });
      const updated = { ...editFlow, ...data };
      setFlows((prev) => prev.map((f) => f.id === editFlow.id ? updated : f));
      if (selectedFlow?.id === editFlow.id) setSelectedFlow(updated);
      setEditFlow(null);
      toast.success('Flow updated');
    } catch { toast.error('Failed to update flow'); }
  };

  const toggleFlow = async (id: string) => {
    const flow = flows.find((f) => f.id === id);
    if (!flow) return;
    const newActive = !flow.isActive;
    try {
      await api.patch(`/api/whatsapp-flows/${id}`, { is_active: newActive });
      const updated = flows.map((f) => f.id === id ? { ...f, isActive: newActive } : f);
      setFlows(updated);
      if (selectedFlow?.id === id) setSelectedFlow(updated.find((f) => f.id === id)!);
      toast.success('Flow status updated');
    } catch { toast.error('Failed to update flow'); }
  };

  const deleteFlow = async (id: string) => {
    const flow = flows.find((f) => f.id === id);
    try {
      await api.delete(`/api/whatsapp-flows/${id}`);
      setFlows((prev) => prev.filter((f) => f.id !== id));
      if (selectedFlow?.id === id) setSelectedFlow(flows.find((f) => f.id !== id) ?? null);
      toast.success(`"${flow?.name}" deleted`);
    } catch { toast.error('Failed to delete flow'); }
  };

  const triggerBadge: Record<TriggerType, string> = {
    first_message: 'bg-green-100 text-green-700',
    keyword: 'bg-blue-100 text-blue-700',
    button_click: 'bg-purple-100 text-purple-700',
    opt_in: 'bg-orange-100 text-orange-700',
  };
  const triggerShort: Record<TriggerType, string> = {
    first_message: 'First Msg', keyword: 'Keyword', button_click: 'Button', opt_in: 'Opt-in',
  };

  return (
    <div className="animate-fade-in -m-4 md:-m-8 flex flex-col md:flex-row h-[calc(100vh-64px)]">
      {/* Left: Flow List */}
      <div className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-[var(--hairline)] flex flex-col bg-card max-h-[45vh] md:max-h-none">
        <div className="p-4 border-b border-[var(--hairline)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/automation')}
                className="p-1.5 rounded-xl hover:bg-[var(--accent-tint)] text-[#6b7280] hover:text-[#111318] transition-colors shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            </div>
            <Button size="sm" onClick={() => setShowModal(true)}><Plus className="w-3.5 h-3.5 mr-1" /> New</Button>
          </div>
          <p className="text-[12px] text-[#6b7280]">{flows.filter((f) => f.isActive).length} active · {flows.length} total</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {flows.map((flow) => (
            <button
              key={flow.id}
              onClick={() => setSelectedFlow(flow)}
              className={cn('w-full text-left px-4 py-3 border-b border-[var(--hairline)] hover:bg-[var(--surface-2)] transition-colors', selectedFlow?.id === flow.id && 'bg-accent/30 border-l-2 border-l-primary')}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-[15px] font-medium text-foreground truncate flex-1">{flow.name}</p>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={cn('w-2 h-2 rounded-full', flow.isActive ? 'bg-green-500' : 'bg-muted-foreground')} />
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === flow.id ? null : flow.id); }}
                      className="p-0.5 rounded hover:bg-[var(--accent-tint)] text-muted-foreground"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                    {openMenu === flow.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpenMenu(null); }} />
                        <div className="absolute right-0 top-6 bg-card border border-[var(--hairline)] rounded-xl shadow-xl z-50 w-36 py-1">
                          <button onClick={(e) => { e.stopPropagation(); setEditFlow(flow); setOpenMenu(null); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--accent-tint)]">Edit Flow</button>
                          <button onClick={(e) => { e.stopPropagation(); toggleFlow(flow.id); setOpenMenu(null); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--accent-tint)]">{flow.isActive ? 'Pause' : 'Activate'}</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteFlow(flow.id); setOpenMenu(null); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-red-50 text-destructive">Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge className={cn('border-0 text-[11px] px-1.5 py-0', triggerBadge[flow.trigger])}>{triggerShort[flow.trigger]}</Badge>
                <span className="text-[12px] text-muted-foreground">{flow.nodes.length} steps · {flow.executionCount} runs</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Flow Detail */}
      <div className="flex-1 overflow-y-auto bg-[var(--app-bg)]">
        {selectedFlow ? (
          <div className="p-6 space-y-6 max-w-lg mx-auto">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-foreground">{selectedFlow.name}</h2>
                <p className="text-[15px] text-[#6b7280] mt-0.5">{selectedFlow.nodes.length} steps · {selectedFlow.executionCount} executions</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditFlow(selectedFlow)}>Edit Flow</Button>
                <Button variant="outline" size="sm" onClick={() => toggleFlow(selectedFlow.id)}>
                  {selectedFlow.isActive ? <><Pause className="w-3.5 h-3.5 mr-1" /> Pause</> : <><Play className="w-3.5 h-3.5 mr-1" /> Activate</>}
                </Button>
              </div>
            </div>

            <div className="bg-card rounded-2xl border border-[var(--hairline)] card-shadow p-5">
              <p className="text-[12px] font-bold uppercase tracking-wider text-[#6b7280] mb-4 uppercase tracking-wide">Flow Preview</p>
              <FlowVisual flow={selectedFlow} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Runs', value: selectedFlow.executionCount },
                { label: 'Steps', value: selectedFlow.nodes.length },
                { label: 'Buttons', value: selectedFlow.nodes.reduce((s, n) => s + (n.buttons?.length ?? 0), 0) },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow p-3 text-center">
                  <p className="text-xl font-bold text-foreground">{s.value}</p>
                  <p className="text-[12px] text-[#6b7280]">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="font-medium">Select a flow</p>
              <p className="text-[15px] mt-1">Choose a flow from the left to preview it</p>
            </div>
          </div>
        )}
      </div>

      {showModal && <FlowBuilderModal onClose={() => setShowModal(false)} onSave={handleCreate} />}
      {editFlow && <FlowBuilderModal initial={editFlow} onClose={() => setEditFlow(null)} onSave={handleEdit} />}
    </div>
  );
}
