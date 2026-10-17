import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Confirmation = { message: string; title: string; confirmLabel: string; destructive: boolean };
type ConfirmOptions = Partial<Omit<Confirmation, 'message'>>;
type Confirm = (message: string, options?: ConfirmOptions) => Promise<boolean>;
const Context = createContext<Confirm | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolve = useRef<((accepted: boolean) => void) | null>(null);
  const [pending, setPending] = useState<Confirmation | null>(null);
  useEffect(() => {
    if (pending && !dialog.current?.open) dialog.current?.showModal();
  }, [pending]);
  const settle = (accepted: boolean) => {
    const finish = resolve.current;
    resolve.current = null;
    dialog.current?.close();
    setPending(null);
    finish?.(accepted);
  };
  const confirm: Confirm = (message, options = {}) => new Promise(result => {
    if (resolve.current) { result(false); return; }
    resolve.current = result;
    setPending({ message, title: options.title || 'Confirm action', confirmLabel: options.confirmLabel || 'Continue', destructive: options.destructive ?? false });
  });
  return <Context.Provider value={confirm}>
    {children}
    <dialog ref={dialog} className="model-limit-dialog" aria-labelledby="confirm-action-title" onCancel={event => { event.preventDefault(); settle(false); }}>
      <h2 id="confirm-action-title">{pending?.title}</h2>
      <p>{pending?.message}</p>
      <div className="settings-actions">
        <button className="button secondary" type="button" onClick={() => settle(false)}>Cancel</button>
        <button className={`button ${pending?.destructive ? 'danger' : 'primary'}`} type="button" onClick={() => settle(true)}>{pending?.confirmLabel}</button>
      </div>
    </dialog>
  </Context.Provider>;
}

export function useConfirmDialog(): Confirm {
  const confirm = useContext(Context);
  if (!confirm) throw new Error('ConfirmDialogProvider is missing.');
  return confirm;
}
