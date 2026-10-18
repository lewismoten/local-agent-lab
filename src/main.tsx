import React from 'react';
import { createRoot } from 'react-dom/client';
import './browserModel.css';
import './fileHistory.css';
import './style.css';
import './chat.css';
import './theme.css';
import HarnessApp from './HarnessApp';
import { ConfirmDialogProvider } from './ConfirmDialog';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfirmDialogProvider><HarnessApp /></ConfirmDialogProvider></React.StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const reloadKey = 'local-agent-lab-coi-reload';
  const reloadWhenControlled = () => {
    if (crossOriginIsolated) { sessionStorage.removeItem(reloadKey); return; }
    if (!navigator.serviceWorker.controller || sessionStorage.getItem(reloadKey)) return;
    sessionStorage.setItem(reloadKey, '1');
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reloadWhenControlled);
  const installOffline = () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}coi-serviceworker.js`, { scope: import.meta.env.BASE_URL })
      .then(() => navigator.serviceWorker.ready)
      .then(reloadWhenControlled)
      .catch(error => console.warn('Offline app setup failed:', error));
  };
  if (document.readyState === 'complete') installOffline();
  else window.addEventListener('load', installOffline, { once: true });
}
