import { useEffect, useState } from 'react';
import HarnessSurfaceArtwork, { SurfaceArtworkButton } from './HarnessSurfaceArtwork.tsx';
import { emptySurfaceArtwork, type SurfaceArtworkMap } from './harnessSurfaceArtwork.ts';
import type { HarnessStore } from './harnessStore.ts';
import type { ImageConfig } from './imageGeneration.ts';
import { showToast } from './toastStore.ts';

export default function HarnessProjectArtwork({ store, projectId, name, folder, imageOptions, onWrite }: {
  store: HarnessStore;
  projectId: string;
  name: string;
  folder: FileSystemDirectoryHandle | null;
  imageOptions: ImageConfig[];
  onWrite: <T,>(action: () => Promise<T>) => Promise<T>;
}) {
  const [artwork, setArtwork] = useState<SurfaceArtworkMap>(emptySurfaceArtwork);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let active = true;
    void store.surfaceArtwork().then(saved => { if (active) setArtwork(saved); })
      .catch(() => { if (active) showToast('Could not load the project icon.'); });
    return () => { active = false; };
  }, [store, projectId]);
  const key = `project:${projectId}`;
  return <>
    <SurfaceArtworkButton store={store} title={name} assetId={artwork.items[key]?.assetId} onOpen={() => setEditing(true)}/>
    {editing && <HarnessSurfaceArtwork key={key} store={store} surfaceKey={key} title={name} kind="project" entry={artwork.items[key]} imageOptions={imageOptions} folder={folder} onWrite={onWrite} onSaved={setArtwork} onClose={() => setEditing(false)}/>}
  </>;
}
