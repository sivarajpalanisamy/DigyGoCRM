import { create } from 'zustand';
import type { ReactNode } from 'react';

// Imperative, promise-based replacement for the browser's window.confirm / alert.
// Usage:
//   if (!(await confirmDialog({ message: 'Delete this?' }))) return;
//   await alertDialog({ message: 'Submission failed.' });
// Backed by a single <ConfirmHost /> mounted at the app root, so it works from any
// event handler (no per-page modal state) and always renders a centered popup.

export type DialogKind = 'confirm' | 'alert';

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button for destructive actions (default true). */
  danger?: boolean;
}

export interface AlertOptions {
  title?: string;
  message: ReactNode;
  okText?: string;
}

interface DialogState {
  open: boolean;
  kind: DialogKind;
  title?: string;
  message: ReactNode;
  confirmText: string;
  cancelText: string;
  okText: string;
  danger: boolean;
  _resolve: ((v: boolean) => void) | null;
  _show: (s: Partial<DialogState>) => Promise<boolean>;
  _respond: (v: boolean) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  open: false,
  kind: 'confirm',
  title: undefined,
  message: '',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  okText: 'OK',
  danger: true,
  _resolve: null,
  _show: (s) =>
    new Promise<boolean>((resolve) => {
      // Resolve any dialog already open (shouldn't normally happen) as cancelled.
      get()._resolve?.(false);
      set({ ...s, open: true, _resolve: resolve });
    }),
  _respond: (v) => {
    const r = get()._resolve;
    set({ open: false, _resolve: null });
    r?.(v);
  },
}));

/** Centered yes/no confirmation. Resolves true if confirmed, false otherwise. */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return useDialogStore.getState()._show({
    kind: 'confirm',
    title: o.title ?? 'Are you sure?',
    message: o.message,
    confirmText: o.confirmText ?? 'Confirm',
    cancelText: o.cancelText ?? 'Cancel',
    danger: o.danger ?? true,
  });
}

/** Centered single-button notice (replaces window.alert). */
export function alertDialog(o: AlertOptions): Promise<boolean> {
  return useDialogStore.getState()._show({
    kind: 'alert',
    title: o.title ?? 'Notice',
    message: o.message,
    okText: o.okText ?? 'OK',
  });
}
