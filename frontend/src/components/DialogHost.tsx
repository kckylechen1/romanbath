/**
 * DialogHost — single mount point for the imperative dialog service.
 *
 * Subscribes to dialogService and renders whatever confirm/prompt/alert
 * is currently active. Mount this once near the app root (App.tsx).
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  type DialogState,
  getCurrentDialog,
  resolveDialog,
  subscribe,
} from '../services/dialogService';

const useSyncDialog = (): DialogState | null => {
  const [state, setState] = useState<DialogState | null>(getCurrentDialog());
  useEffect(() => subscribe((next) => setState(next)), []);
  return state;
};

const ConfirmView: React.FC<{ state: Extract<DialogState, { kind: 'confirm' }> }> = ({ state }) => {
  const cancel = () => resolveDialog(false);
  const confirm = () => resolveDialog(true);

  return (
    <DialogShell
      onClose={cancel}
      title={state.title}
      icon={state.danger ? <AlertTriangle className="text-red-400" size={20} /> : undefined}
    >
      {state.message && <p className="text-sm text-stone-300 leading-relaxed">{state.message}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <DialogButton onClick={cancel} variant="ghost">
          {state.cancelLabel}
        </DialogButton>
        <DialogButton onClick={confirm} variant={state.danger ? 'danger' : 'primary'}>
          {state.confirmLabel}
        </DialogButton>
      </div>
    </DialogShell>
  );
};

const AlertView: React.FC<{ state: Extract<DialogState, { kind: 'alert' }> }> = ({ state }) => {
  const close = () => resolveDialog(null);

  return (
    <DialogShell onClose={close} title={state.title}>
      {state.message && <p className="text-sm text-stone-300 leading-relaxed">{state.message}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <DialogButton onClick={close} variant="primary">
          {state.confirmLabel}
        </DialogButton>
      </div>
    </DialogShell>
  );
};

const PromptView: React.FC<{ state: Extract<DialogState, { kind: 'prompt' }> }> = ({ state }) => {
  const [value, setValue] = useState(state.defaultValue);
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // Autofocus + select on mount so the user can immediately type / overwrite.
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const cancel = () => resolveDialog(null);
  const submit = () => resolveDialog(value);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Enter submits only on single-line; on multiline, Cmd/Ctrl+Enter submits.
    if (e.key === 'Enter') {
      if (!state.multiline || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        submit();
      }
    }
  };

  return (
    <DialogShell onClose={cancel} title={state.title}>
      {state.message && (
        <p className="text-sm text-stone-300 leading-relaxed mb-3">{state.message}</p>
      )}
      {state.multiline ? (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={state.placeholder}
          rows={4}
          className="w-full bg-stone-900/80 text-stone-200 px-4 py-3 rounded-xl border border-white/10 focus:border-bath-500/40 focus:outline-none focus:ring-2 focus:ring-bath-500/20 resize-none text-sm leading-relaxed"
        />
      ) : (
        <input
          ref={(el) => {
            inputRef.current = el;
          }}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={state.placeholder}
          className="w-full bg-stone-900/80 text-stone-200 px-4 py-3 rounded-xl border border-white/10 focus:border-bath-500/40 focus:outline-none focus:ring-2 focus:ring-bath-500/20 text-sm"
        />
      )}
      <div className="flex justify-end gap-2 mt-4">
        <DialogButton onClick={cancel} variant="ghost">
          {state.cancelLabel}
        </DialogButton>
        <DialogButton onClick={submit} variant="primary" disabled={!value.trim()}>
          {state.confirmLabel}
        </DialogButton>
      </div>
    </DialogShell>
  );
};

const DialogShell: React.FC<{
  title: string;
  onClose: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, onClose, icon, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="bg-[#0e1217]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
          <h2 className="text-lg font-semibold text-white flex-1">{title}</h2>
          <button
            onClick={onClose}
            className="text-stone-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const DialogButton: React.FC<{
  onClick: () => void;
  variant: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, variant, disabled, children }) => {
  const cls =
    variant === 'primary'
      ? 'bg-gradient-to-r from-bath-600 to-bath-700 hover:from-bath-500 hover:to-bath-600 text-white shadow-lg shadow-bath-900/40'
      : variant === 'danger'
        ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white shadow-lg shadow-red-900/40'
        : 'bg-white/5 hover:bg-white/10 text-stone-300 hover:text-white border border-white/10';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${cls}`}
    >
      {children}
    </button>
  );
};

export const DialogHost: React.FC = () => {
  const state = useSyncDialog();
  if (!state) return null;

  if (state.kind === 'confirm') return <ConfirmView key={state.id} state={state} />;
  if (state.kind === 'alert') return <AlertView key={state.id} state={state} />;
  return <PromptView key={state.id} state={state} />;
};

export default DialogHost;
