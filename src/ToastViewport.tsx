import { useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { dismissToast, getToasts, subscribeToasts } from './toastStore';
import './toast.css';

export default function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  if (!toasts.length) return null;
  return <div className="toast-stack" aria-live="polite">
    {toasts.slice(0, 4).map(toast => <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} key={toast.id}>
      {toast.kind === 'error' ? <AlertCircle size={17}/> : toast.kind === 'info' ? <Info size={17}/> : <CheckCircle2 size={17}/>}
      <span>{toast.message}</span>
      {toast.action && <button type="button" className="toast-action" onClick={() => { dismissToast(toast.id); toast.action?.onClick(); }}>{toast.action.label}</button>}
      <button type="button" className="toast-dismiss" aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)}><X size={15}/></button>
    </div>)}
  </div>;
}
