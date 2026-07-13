import React, { useState, useRef, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  title: string;
  message: React.ReactNode;
  /** What the user must type - defaults to "DELETE" */
  confirmWord?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDeleteModal({
  title,
  message,
  confirmWord = 'DELETE',
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
}: Props) {
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matched = typed === confirmWord;

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleConfirm = async () => {
    if (!matched || loading) return;
    setLoading(true);
    try { await onConfirm(); } finally { setLoading(false); }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <h3 className="text-[16px] font-bold text-[#111318]">{title}</h3>
        </div>

        <p className="text-[15px] text-[#6b7280] mb-4">{message}</p>

        <div className="mb-5">
          <p className="text-[14px] font-semibold text-[#111318] mb-1.5">
            Type <span className="font-mono bg-red-50 text-red-600 px-1.5 py-0.5 rounded">{confirmWord}</span> to confirm
          </p>
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matched) handleConfirm(); }}
            placeholder={confirmWord}
            className="w-full border border-black/10 rounded-lg px-3 py-2.5 text-[15px] outline-none focus:border-red-400 transition-colors font-mono tracking-wider"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-black/10 text-[15px] font-semibold text-[#6b7280] hover:bg-[var(--app-bg)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!matched || loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-[15px] font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-red-600"
          >
            {loading ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
