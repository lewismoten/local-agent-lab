import { useState, useSyncExternalStore } from 'react';
import { BROWSER_IMAGE_GROUPS, browserImageAssetsManager, browserImageTotal, getBrowserImageAssets, imageModelAcceptsPreviousEngine, imagePackageCanOverride, subscribeBrowserImageAssets } from './browserImageAssets';
import { ensureWritableFolder } from './storage';
import DownloadRing from './DownloadRing';
import { useConfirmDialog } from './ConfirmDialog';
import { VISUAL_PACKAGE_LIMIT_BYTES } from './visualLimit.ts';

const groups = ['engine', ...BROWSER_IMAGE_GROUPS] as const;
const labels = { engine: 'ONNX image engine', model: 'Stable Diffusion', 'tiny-q4': 'Tiny-SD Q4', 'tiny-fp16': 'Tiny-SD FP16', sdxs: 'SDXS DreamShaper', lcm: 'DreamShaper 8 LCM', 'supra-mobile': 'Supra2-IMG Mobile' };

export default function BrowserImageDownloadQueue({ folder }: { folder: FileSystemDirectoryHandle | null }) {
  const state = useSyncExternalStore(subscribeBrowserImageAssets, getBrowserImageAssets);
  const [actionError, setActionError] = useState('');
  const confirmAction = useConfirmDialog();
  if (!folder || state.folder !== folder) return null;
  const pending = groups.filter(group => !state.installed[group] && (state.active === group || state.queue.includes(group) || state.saved[group] > 0 && !(group === 'engine' && state.legacyInstalled)));
  if (!pending.length) return null;
  const ordered = [...pending].sort((a, b) => {
    const rank = (group: typeof groups[number]) => state.active === group ? -1 : state.queue.includes(group) ? state.queue.indexOf(group) : groups.indexOf(group) + state.queue.length;
    return rank(a) - rank(b);
  });
  async function resume(group: typeof groups[number]) {
    if (!folder) return;
    setActionError('');
    try {
      const packageBytes = group === 'engine' ? 0 : browserImageTotal(group) + browserImageTotal('engine');
      const override = packageBytes > VISUAL_PACKAGE_LIMIT_BYTES && group !== 'engine' && imagePackageCanOverride(group);
      if (override && !await confirmAction(`${labels[group]} needs ${(packageBytes / 1e9).toFixed(2)} GB including its engine, above the usual 2 GB limit. Resume it?`, { title: 'Large image model', confirmLabel: 'Resume' })) return;
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to resume image downloads.');
      if (group !== 'engine' && !state.installed.engine && !(state.legacyInstalled && imageModelAcceptsPreviousEngine(group))) browserImageAssetsManager.queue(folder, 'engine');
      browserImageAssetsManager.queue(folder, group, override);
      browserImageAssetsManager.resume(folder);
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
  }
  return <div className="model-queue-order" aria-label="Image download queue"><strong>Image downloads</strong>
    {ordered.map(group => {
      const active = state.active === group;
      const index = state.queue.indexOf(group);
      const queued = index >= 0;
      const total = browserImageTotal(group);
      const saved = state.saved[group];
      const status = active ? 'Downloading' : queued ? state.paused ? index === 0 && state.error ? 'Needs retry' : 'Queued · paused' : `Queued #${index + 1}` : 'Partial saved';
      const canResume = !active && (!queued || state.paused && index === 0);
      const action = active ? 'pause' : canResume ? 'resume' : undefined;
      return <div className="model-queue-item image-download-item" key={group}>
        <span>{labels[group]} · {status}</span>
        {(active || saved > 0 || canResume) && <DownloadRing bytes={saved} total={total} label={`${labels[group]} download progress`} action={action} onAction={active ? () => browserImageAssetsManager.pause() : canResume ? () => void resume(group) : undefined}/>}
      </div>;
    })}
    {(actionError || state.error) && <p className="model-error" role="alert">{actionError || state.error}</p>}
  </div>;
}
