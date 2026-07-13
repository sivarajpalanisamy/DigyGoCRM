import { useEffect, useRef } from 'react';
import { useDialogStore } from '@/lib/confirm';
import { cn } from '@/lib/utils';

/**
 * Single mount point for the imperative confirmDialog() / alertDialog() API.
 * Renders a centered, brand-styled popup - the app-wide replacement for the native
 * window.confirm / window.alert dialogs. Mounted once at the app root.
 */
export function ConfirmHost() {
  const { open, kind, title, message, confirmText, cancelText, okText, danger, _respond } = useDialogStore();
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); _respond(false); }
      else if (e.key === 'Enter') { e.preventDefault(); _respond(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, _respond]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) _respond(false); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-150"
      >
        {title && <h3 className="text-[16px] font-bold text-[#111318] mb-2">{title}</h3>}
        <div className="text-[15px] text-[#6b7280] mb-6 leading-relaxed">{message}</div>
        <div className="flex gap-2.5">
          {kind === 'confirm' && (
            <button
              onClick={() => _respond(false)}
              className="flex-1 py-2.5 rounded-xl border border-black/10 text-[15px] font-semibold text-[#6b7280] hover:bg-[var(--app-bg)] transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            ref={confirmBtn}
            onClick={() => _respond(true)}
            className={cn(
              'flex-1 py-2.5 rounded-xl text-[15px] font-bold text-white transition-colors',
              danger && kind === 'confirm'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-primary hover:bg-[var(--brand-dark)]'
            )}
          >
            {kind === 'alert' ? okText : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
