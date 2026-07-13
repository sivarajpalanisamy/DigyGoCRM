import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface TrashedLead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  stage_name: string | null;
  pipeline_name: string | null;
  assigned_name: string | null;
  updated_at: string;
}

/**
 * Recover soft-deleted leads. Leads are never hard-deleted (is_deleted=TRUE), so
 * this lists the trash and restores via POST /api/leads/:id/restore. Restored
 * leads re-appear on the board in real time via the lead:created socket event.
 */
export default function LeadTrashModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<TrashedLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get<TrashedLead[]>('/api/leads/trash')
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch(() => toast.error('Could not load trash'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const restore = async (lead: TrashedLead) => {
    setRestoringId(lead.id);
    try {
      await api.post(`/api/leads/${lead.id}/restore`, {});
      setItems((prev) => prev.filter((l) => l.id !== lead.id));
      toast.success(`Restored ${lead.name || 'lead'}`);
    } catch {
      toast.error('Restore failed');
    } finally {
      setRestoringId(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col bg-white rounded-2xl border border-black/5 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-[#c2410c]" />
            <h2 className="text-[16px] font-bold text-[#111318]">Trash</h2>
            {!loading && <span className="text-[14px] text-[#6b7280]">({items.length})</span>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[#6b7280] hover:bg-black/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[#6b7280]"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Trash2 className="w-8 h-8 text-black/15 mb-2" />
              <p className="text-[15px] text-[#6b7280]">Trash is empty</p>
              <p className="text-[14px] text-[#6b7280] mt-1">Deleted leads can be recovered here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-black/5">
              {items.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-[#111318] truncate">{l.name || 'Unnamed lead'}</p>
                    <p className="text-[14px] text-[#6b7280] truncate">
                      {[l.phone, l.pipeline_name, l.stage_name].filter(Boolean).join(' · ') || '-'}
                    </p>
                  </div>
                  <button
                    onClick={() => restore(l)}
                    disabled={restoringId === l.id}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[14px] font-bold text-[#c2410c] border border-[#c2410c]/30 hover:bg-orange-50 disabled:opacity-50 shrink-0"
                  >
                    {restoringId === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
