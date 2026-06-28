import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import {
  Plus, Trash2, GripVertical, Search, Pencil, Copy, X, Eye,
  Layers, ChevronRight, MoreHorizontal,
} from 'lucide-react';
import { useCrmStore } from '@/store/crmStore';
import { Pipeline, PipelineStage } from '@/data/mockData';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─── Sortable Stage Row (inside modal) ────────────────────────────────────────
function SortableStageRow({ stage, idx, onUpdate, onRemove, onToggleWon }: {
  stage: PipelineStage; idx: number;
  onUpdate: (id: string, field: keyof PipelineStage, value: string) => void;
  onRemove: (id: string) => void;
  onToggleWon: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-2 group"
    >
      <button
        {...attributes} {...listeners}
        className="p-1 rounded text-[#c4b09e] hover:text-[#7a6b5c] cursor-grab active:cursor-grabbing transition-colors shrink-0"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-primary/40 bg-white transition-colors">
        <span className="text-[11px] text-[#b09e8d] w-5 shrink-0 font-medium">{idx + 1}.</span>
        <input
          className="flex-1 text-[13px] text-[#1c1410] outline-none bg-transparent placeholder:text-gray-300"
          placeholder="Stage name"
          value={stage.name}
          onChange={(e) => onUpdate(stage.id, 'name', e.target.value)}
        />
        <button
          onClick={() => onToggleWon(stage.id)}
          title={stage.is_won ? 'Won stage (click to unset)' : 'Mark as Won stage'}
          className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors shrink-0',
            stage.is_won
              ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
              : 'bg-gray-50 border-gray-200 text-[#b09e8d] hover:border-emerald-300 hover:text-emerald-600'
          )}
        >
          Won
        </button>
      </div>
      <button
        onClick={() => onRemove(stage.id)}
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-[#c4b09e] hover:text-red-500 transition-all shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Pipeline Modal ────────────────────────────────────────────────────────────
function PipelineModal({ pipeline, onClose }: { pipeline?: Pipeline; onClose: () => void }) {
  const { addPipeline, updatePipeline } = useCrmStore();
  const isEdit = !!pipeline;
  const [name, setName] = useState(pipeline?.name ?? '');
  const [stages, setStages] = useState<PipelineStage[]>(
    pipeline?.stages ?? [{ id: `s-${Date.now()}`, name: '', color: '#ea580c' }]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setStages((prev) => {
        const oldIdx = prev.findIndex((s) => s.id === active.id);
        const newIdx = prev.findIndex((s) => s.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  const addStage = () =>
    setStages((prev) => [...prev, { id: `s-${Date.now()}-${prev.length}`, name: '', color: '#ea580c' }]);

  const updateStage = (id: string, field: keyof PipelineStage, value: string) =>
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));

  const toggleWon = (id: string) =>
    setStages((prev) => prev.map((s) =>
      s.id === id ? { ...s, is_won: !s.is_won } : { ...s, is_won: false }
    ));

  const removeStage = (id: string) =>
    setStages((prev) => prev.filter((s) => s.id !== id));

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Pipeline name is required'); return; }
    if (stages.some((s) => !s.name.trim())) { toast.error('All stages must have a name'); return; }
    try {
      if (isEdit) {
        await updatePipeline(pipeline!.id, { name: name.trim(), stages });
        toast.success('Pipeline updated');
      } else {
        await addPipeline({ id: '', name: name.trim(), stages });
        toast.success('Pipeline created');
      }
      onClose();
    } catch {
      toast.error('Failed to save pipeline. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5 shrink-0">
          <h3 className="font-headline font-bold text-[#1c1410] text-[17px]">
            {isEdit ? 'Edit Pipeline' : '+ New Pipeline'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="text-[12px] font-semibold text-[#7a6b5c] mb-1.5 block">Pipeline Name <span className="text-red-400">*</span></label>
            <input
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] text-[#1c1410] outline-none focus:border-primary/40 placeholder:text-gray-400"
              placeholder="e.g. Sales Pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12px] font-semibold text-[#7a6b5c]">Stages</label>
              <span className="text-[11px] text-[#b09e8d]">{stages.length} stage{stages.length !== 1 ? 's' : ''} · drag to reorder</span>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {stages.map((stage, idx) => (
                    <SortableStageRow key={stage.id} stage={stage} idx={idx} onUpdate={updateStage} onRemove={removeStage} onToggleWon={toggleWon} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <button onClick={addStage} className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:opacity-80 transition-opacity">
              <Plus className="w-4 h-4" /> Add Stage
            </button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5 shrink-0">
          <button onClick={onClose} className="px-5 py-2 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_LIMIT = 4;

// ─── All Stages Modal ──────────────────────────────────────────────────────────
function AllStagesModal({ pipeline, totalLeads, stageStats, onClose, onOpen }: {
  pipeline: Pipeline;
  totalLeads: number;
  stageStats: { id: string; name: string; count: number }[];
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/5 shrink-0">
          <div>
            <h3 className="font-headline font-bold text-[#1c1410] text-[17px]">{pipeline.name}</h3>
            <p className="text-[12px] text-[#7a6b5c] mt-0.5">
              {totalLeads} total leads · {pipeline.stages.length} stages
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-[#7a6b5c] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* All stages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {stageStats.map((stage, idx) => (
            <div key={stage.id} className="flex items-center justify-between gap-3 py-2 border-b border-black/[0.04] last:border-0">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-[#b09e8d] w-5 shrink-0">{idx + 1}.</span>
                <span className="text-[13px] text-[#1c1410] font-medium">{stage.name}</span>
              </div>
              <span className="text-[13px] tabular-nums shrink-0">
                <span className={cn('font-bold', stage.count > 0 ? 'text-[#1c1410]' : 'text-[#c4b09e]')}>
                  {stage.count}
                </span>
                <span className="text-[#b09e8d]">/{totalLeads} leads</span>
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-black/5 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-[#7a6b5c] hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
          <button
            onClick={onOpen}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 12px rgba(234,88,12,0.25)' }}
          >
            Open Pipeline
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline Card ─────────────────────────────────────────────────────────────
function PipelineCard({ pipeline, onEdit, onClone, onDelete, onView, canManage, stageCounts, total }: {
  pipeline: Pipeline;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  onView: () => void;
  canManage: boolean;
  stageCounts: Record<string, number>;  // stageId -> count (server-side, view-scoped)
  total: number;                        // total leads in this pipeline
}) {
  const [showAllStages, setShowAllStages] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const totalLeads = total;

  const stageStats = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    count: stageCounts[stage.id] ?? 0,
  }));

  const hasMore = stageStats.length > PREVIEW_LIMIT;
  const visible = stageStats.slice(0, PREVIEW_LIMIT);
  const hiddenCount = stageStats.length - PREVIEW_LIMIT;

  return (
    <>
      <div
        onClick={onView}
        className="bg-white rounded-2xl border border-black/[0.06] card-shadow hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col cursor-pointer"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-black/[0.04] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-headline font-bold text-[#1c1410] text-[16px] leading-tight">{pipeline.name}</h3>
              <p className="text-[12px] text-[#7a6b5c] mt-1 whitespace-nowrap">
                {totalLeads} leads · {pipeline.stages.length} stages
              </p>
            </div>

            {/* ⋯ menu — only visible when user can manage pipelines */}
            {canManage && (
              <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setShowMenu((v) => !v)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#b09e8d] hover:bg-[#faf0e8] hover:text-primary transition-colors"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {showMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 top-8 z-50 w-44 bg-white rounded-xl border border-black/5 shadow-xl overflow-hidden py-1">
                      <button onClick={() => { setShowMenu(false); onView(); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors text-left">
                        <Eye className="w-3.5 h-3.5 text-[#7a6b5c]" /> Open Pipeline
                      </button>
                      <button onClick={() => { setShowMenu(false); onEdit(); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors text-left">
                        <Pencil className="w-3.5 h-3.5 text-[#7a6b5c]" /> Edit
                      </button>
                      <button onClick={() => { setShowMenu(false); onClone(); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[#faf0e8] transition-colors text-left">
                        <Copy className="w-3.5 h-3.5 text-[#7a6b5c]" /> Clone
                      </button>
                      <div className="border-t border-black/5 my-1" />
                      <button onClick={() => { setShowMenu(false); onDelete(); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-red-500 hover:bg-red-50 transition-colors text-left">
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stage list — first 5 preview */}
        <div className="px-5 py-4 space-y-2.5 flex-1">
          {visible.map((stage) => (
            <div key={stage.id} className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-[#4a3f35] font-medium truncate">{stage.name}</span>
              <span className="text-[13px] tabular-nums shrink-0">
                <span className={cn('font-bold', stage.count > 0 ? 'text-[#1c1410]' : 'text-[#c4b09e]')}>
                  {stage.count}
                </span>
                <span className="text-[#b09e8d] font-normal">/{totalLeads} leads</span>
              </span>
            </div>
          ))}

          {hasMore && (
            <p className="text-[11px] text-[#b09e8d] pt-0.5">
              +{hiddenCount} more stage{hiddenCount !== 1 ? 's' : ''}
            </p>
          )}

          {totalLeads === 0 && (
            <p className="text-[12px] text-[#b09e8d] py-1">No leads yet</p>
          )}
        </div>

        {/* Footer — two permanent buttons */}
        <div className="px-4 pb-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowAllStages(true)}
            className="flex-1 py-2 rounded-xl text-[12px] font-semibold text-[#7a6b5c] bg-black/[0.04] hover:bg-black/[0.07] transition-colors"
          >
            All Stages
          </button>
          <button
            onClick={onView}
            className="flex-1 py-2 rounded-xl text-[12px] font-bold text-primary bg-orange-50 hover:bg-orange-100 transition-colors"
          >
            Go to Board
          </button>
        </div>
      </div>

      {showAllStages && (
        <AllStagesModal
          pipeline={pipeline}
          totalLeads={totalLeads}
          stageStats={stageStats}
          onClose={() => setShowAllStages(false)}
          onOpen={() => { setShowAllStages(false); onView(); }}
        />
      )}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function LeadManagementOverviewPage() {
  const navigate = useNavigate();
  const { pipelines, deletePipeline, clonePipeline } = useCrmStore();
  // Lead counts come from the server (view-scoped) so the page doesn't depend on
  // every lead being loaded into the store.
  const [counts, setCounts] = useState<{ stages: Record<string, number>; pipelines: Record<string, number> }>({ stages: {}, pipelines: {} });
  useEffect(() => {
    api.get<{ stages: Record<string, number>; pipelines: Record<string, number> }>('/api/leads/pipeline-counts')
      .then((d) => setCounts({ stages: d.stages ?? {}, pipelines: d.pipelines ?? {} }))
      .catch(() => {});
  }, []);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editPipeline, setEditPipeline] = useState<Pipeline | null>(null);
  const [deletePipelineTarget, setDeletePipelineTarget] = useState<Pipeline | null>(null);
  const permissions = useAuthStore((s) => s.permissions);
  const permAll = useAuthStore((s) => s.permAll);
  const canManage = permAll || permissions['pipeline:manage'] === true;

  const filtered = pipelines.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Toolbar — search + pipeline filter + new button */}
      <div className="flex items-center gap-3">

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b09e8d]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pipelines…"
            className="w-full pl-9 pr-4 py-2.5 text-[13px] bg-white border border-black/10 rounded-xl outline-none focus:border-primary/40 placeholder:text-gray-400 transition-all"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          />
        </div>

        {/* Pipeline filter dropdown */}
        <select
          className="pl-3 pr-8 py-2.5 text-[13px] bg-white border border-black/10 rounded-xl outline-none focus:border-primary/40 text-[#1c1410] appearance-none cursor-pointer"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          onChange={(e) => setSearch(e.target.value === 'all' ? '' : e.target.value)}
          defaultValue="all"
        >
          <option value="all">All Pipelines</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.name}>{p.name}</option>
          ))}
        </select>

        <div className="flex-1" />

        {/* New Pipeline — only for users with pipeline:manage */}
        {canManage && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:shadow-lg hover:-translate-y-0.5 shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 12px rgba(234,88,12,0.3)' }}
          >
            <Plus className="w-4 h-4" /> New Pipeline
          </button>
        )}
      </div>

      {/* Pipeline cards grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5" style={{ gridAutoRows: '1fr' }}>
          {filtered.map((p) => (
            <PipelineCard
              key={p.id}
              pipeline={p}
              canManage={canManage}
              stageCounts={counts.stages}
              total={counts.pipelines[p.id] ?? 0}
              onView={() => navigate(`/leads?pipeline=${p.id}`)}
              onEdit={() => setEditPipeline(p)}
              onClone={() => { clonePipeline(p.id); toast.success('Pipeline cloned'); }}
              onDelete={() => setDeletePipelineTarget(p)}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/5 card-shadow py-20 flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Layers className="w-7 h-7 text-primary" />
          </div>
          {canManage ? (
            <>
              <p className="font-semibold text-[#1c1410] text-[15px]">No pipelines yet</p>
              <p className="text-[13px] text-[#7a6b5c] max-w-xs">Create your first pipeline to start organising leads by stage</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
              >
                <Plus className="w-4 h-4" /> Create Pipeline
              </button>
            </>
          ) : (
            <>
              <p className="font-semibold text-[#1c1410] text-[15px]">No pipelines assigned to you</p>
              <p className="text-[13px] text-[#7a6b5c] max-w-xs">You can only view pipelines where leads are assigned to you</p>
            </>
          )}
        </div>
      )}

      {showCreate && <PipelineModal onClose={() => setShowCreate(false)} />}
      {editPipeline && <PipelineModal pipeline={editPipeline} onClose={() => setEditPipeline(null)} />}

      {deletePipelineTarget && (
        <ConfirmDeleteModal
          title="Delete Pipeline?"
          message={<>Delete <span className="font-semibold text-[#1c1410]">"{deletePipelineTarget.name}"</span>? All leads in this pipeline will lose their stage assignment. This cannot be undone.</>}
          confirmLabel="Yes, Delete"
          onConfirm={async () => {
            await deletePipeline(deletePipelineTarget.id);
            toast.success('Pipeline deleted');
            setDeletePipelineTarget(null);
          }}
          onClose={() => setDeletePipelineTarget(null)}
        />
      )}
    </div>
  );
}
