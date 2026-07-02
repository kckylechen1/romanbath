/**
 * Imperative, promise-based dialog service.
 *
 * Replaces window.confirm / window.prompt / window.alert so the dialogs
 * match RomanBath's glassmorphic style instead of the browser chrome.
 *
 * Usage from any hook or component without prop-drilling:
 *
 *   const ok = await confirm({ title: "Delete?", danger: true });
 *   if (!ok) return;
 *
 * Rendering is handled by <DialogHost />, which is mounted once at the
 * app root and subscribes to this service.
 */

export type DialogKind = 'confirm' | 'prompt' | 'alert';

interface BaseState {
  id: string;
  kind: DialogKind;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

export interface ConfirmState extends BaseState {
  kind: 'confirm';
  resolve: (ok: boolean) => void;
}

export interface PromptState extends BaseState {
  kind: 'prompt';
  defaultValue: string;
  placeholder?: string;
  multiline?: boolean;
  resolve: (value: string | null) => void;
}

export interface AlertState extends BaseState {
  kind: 'alert';
  resolve: () => void;
}

export type DialogState = ConfirmState | PromptState | AlertState;

let current: DialogState | null = null;
const subscribers = new Set<(state: DialogState | null) => void>();

const notify = (): void => {
  for (const fn of subscribers) fn(current);
};

export const subscribe = (fn: (state: DialogState | null) => void): (() => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

export const getCurrentDialog = (): DialogState | null => current;

const newId = (): string => `dialog-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const close = (): void => {
  current = null;
  notify();
};

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export const confirm = (opts: ConfirmOptions): Promise<boolean> => {
  // If a dialog is already open, close-resolve it conservatively (treat as
  // dismiss) before opening the new one. We don't queue — overlapping
  // modals from the same app are a bug we'd rather expose than hide.
  if (current) {
    const prev = current;
    close();
    if (prev.kind === 'confirm') prev.resolve(false);
    else if (prev.kind === 'prompt') prev.resolve(null);
    else prev.resolve();
  }

  return new Promise<boolean>((resolve) => {
    current = {
      id: newId(),
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: opts.danger,
      resolve,
    };
    notify();
  });
};

export interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const prompt = (opts: PromptOptions): Promise<string | null> => {
  if (current) {
    const prev = current;
    close();
    if (prev.kind === 'confirm') prev.resolve(false);
    else if (prev.kind === 'prompt') prev.resolve(null);
    else prev.resolve();
  }

  return new Promise<string | null>((resolve) => {
    current = {
      id: newId(),
      kind: 'prompt',
      title: opts.title,
      message: opts.message,
      defaultValue: opts.defaultValue ?? '',
      placeholder: opts.placeholder,
      multiline: opts.multiline,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      resolve,
    };
    notify();
  });
};

export interface AlertOptions {
  title: string;
  message?: string;
  okLabel?: string;
}

export const alert = (opts: AlertOptions): Promise<void> => {
  if (current) {
    const prev = current;
    close();
    if (prev.kind === 'confirm') prev.resolve(false);
    else if (prev.kind === 'prompt') prev.resolve(null);
    else prev.resolve();
  }

  return new Promise<void>((resolve) => {
    current = {
      id: newId(),
      kind: 'alert',
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.okLabel ?? 'OK',
      cancelLabel: '',
      resolve,
    };
    notify();
  });
};

// Called by <DialogHost /> when the user clicks a button. Dispatches the
// right resolution for the active dialog kind.
export const resolveDialog = (value: boolean | string | null): void => {
  if (!current) return;
  const active = current;
  close();
  if (active.kind === 'confirm') {
    active.resolve(typeof value === 'boolean' ? value : false);
  } else if (active.kind === 'prompt') {
    active.resolve(typeof value === 'string' ? value : null);
  } else {
    active.resolve();
  }
};
