export async function enableQwenIsolation() {
  if (crossOriginIsolated) return;
  if (!('serviceWorker' in navigator)) throw new Error('This browser cannot enable the memory64 runtime on this site.');
  await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}coi-serviceworker.js`, { scope: import.meta.env.BASE_URL });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('Browser isolation did not activate. Reload the page and try again.')); }, 10000);
    const changed = () => { window.clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
  });
  window.location.reload();
}
