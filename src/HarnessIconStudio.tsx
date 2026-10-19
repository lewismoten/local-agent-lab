import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { AvatarAsset, AvatarAssetInput } from './harnessAvatarLibrary.ts';
import { identityAvatarPath, isoNow, type HarnessIdentity } from './harnessData.ts';
import {
  iconStudioPrompt,
  iconStudioTargets,
  plannedIconStudioTargets,
  type IconStudioKind,
  type IconStudioScope,
} from './harnessIconStudioPlan.ts';
import { compactIdentityAvatar } from './harnessIdentityAvatar.ts';
import {
  activeAchievementSet,
  emptyAchievementSetLibrary,
  type AchievementSetLibrary,
} from './harnessAchievementSets.ts';
import type { HarnessStore } from './harnessStore.ts';
import { emptySurfaceArtwork, type SurfaceArtworkMap } from './harnessSurfaceArtwork.ts';
import { withModelLease } from './harnessLease.ts';
import { generateImage, type ImageConfig } from './imageGeneration.ts';
import { showCompletionToast } from './toastStore.ts';
import './harnessIconStudio.css';

const STYLE_PRESETS = [
  { id: 'neon', label: 'Neon signal', prompt: 'Dark background, luminous cyan and violet, crisp edges' },
  { id: 'awards', label: 'Awards', prompt: 'A polished award emblem with a clear central symbol' },
  { id: 'trophies', label: 'Trophies', prompt: 'A sculptural trophy motif with a clear central symbol' },
  { id: 'medals', label: 'Medals', prompt: 'A collectible medal with a clear central symbol' },
  { id: 'pixel', label: 'Pixel art', prompt: 'Readable 8-bit pixel art with a compact palette' },
  { id: 'boxed', label: 'Box icons', prompt: 'A dimensional square icon with a strong silhouette' },
  { id: 'custom', label: 'Custom', prompt: '' },
] as const;
const KIND_OPTIONS: { id: IconStudioKind; label: string }[] = [
  { id: 'models', label: 'Model families' },
  { id: 'achievements', label: 'Achievements, including hidden' },
  { id: 'identities', label: 'Identities' },
];

export default function HarnessIconStudio({
  store,
  identities,
  folder,
  imageOptions,
  onWrite,
  onSaveIdentity,
  onSaveAvatar,
  onSaveAsset,
  onAssetSaved,
  onClose,
  initialKinds = ['models'],
  initialScope = 'missing',
}: {
  store: HarnessStore;
  identities: HarnessIdentity[];
  folder: FileSystemDirectoryHandle | null;
  imageOptions: ImageConfig[];
  onWrite: <T>(action: () => Promise<T>) => Promise<T>;
  onSaveIdentity: (identity: HarnessIdentity) => Promise<void>;
  onSaveAvatar: (id: string, blob: Blob) => Promise<string>;
  onSaveAsset: (blob: Blob, input: AvatarAssetInput) => Promise<AvatarAsset>;
  onAssetSaved: (asset: AvatarAsset) => void;
  onClose: () => void;
  initialKinds?: IconStudioKind[];
  initialScope?: IconStudioScope;
}) {
  const [artwork, setArtwork] = useState<SurfaceArtworkMap>(emptySurfaceArtwork);
  const [achievementSets, setAchievementSets] = useState<AchievementSetLibrary>(emptyAchievementSetLibrary);
  const [assets, setAssets] = useState<AvatarAsset[]>([]);
  const [kinds, setKinds] = useState<IconStudioKind[]>(initialKinds);
  const [scope, setScope] = useState<IconStudioScope>(initialScope);
  const [preset, setPreset] = useState<(typeof STYLE_PRESETS)[number]['id']>('neon');
  const [customStyle, setCustomStyle] = useState('');
  const [globalPrompt, setGlobalPrompt] = useState(
    'Square composition with a simple silhouette. Original artwork only. No words, letters, numbers, or logos.',
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([store.surfaceArtwork(), store.avatarLibrary(), store.achievementSets()])
      .then(([savedArtwork, savedAssets, savedSets]) => {
        if (active) {
          setArtwork(savedArtwork);
          setAssets(savedAssets);
          setAchievementSets(savedSets);
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [store]);
  const targets = useMemo(
    () => iconStudioTargets(artwork, identities, activeAchievementSet(achievementSets)),
    [artwork, identities, achievementSets],
  );
  const plan = useMemo(
    () => plannedIconStudioTargets(targets, kinds, scope, assets),
    [targets, kinds, scope, assets],
  );
  const selectedStyle =
    preset === 'custom' ? customStyle : STYLE_PRESETS.find((item) => item.id === preset)?.prompt || '';
  const toggleKind = (kind: IconStudioKind) =>
    setKinds((currentKinds) =>
      currentKinds.includes(kind) ? currentKinds.filter((item) => item !== kind) : [...currentKinds, kind],
    );

  const run = async () => {
    if (busy || !plan.length || !imageOptions.length) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setDone(0);
    setTotal(plan.length);
    setError('');
    setMessage('');
    const started = performance.now();
    let completed = 0;
    try {
      for (const target of plan) {
        if (abort.signal.aborted) break;
        setCurrent(target.label);
        const prompt = iconStudioPrompt(target, selectedStyle, globalPrompt);
        const image = await withModelLease(
          `icon-studio:${target.id}`,
          async () => {
            const failures: string[] = [];
            for (const option of imageOptions) {
              if (abort.signal.aborted) break;
              if (option.provider === 'browser' && !folder) {
                failures.push(`${option.model}: connect a model folder`);
                continue;
              }
              try {
                return await generateImage(
                  option,
                  prompt,
                  abort.signal,
                  (value) => setCurrent(`${target.label} · ${value}`),
                  undefined,
                  folder,
                );
              } catch (cause) {
                if (abort.signal.aborted) break;
                failures.push(`${option.model}: ${cause instanceof Error ? cause.message : String(cause)}`);
              }
            }
            throw new Error(`No image generator completed ${target.label}. ${failures.join(' | ')}`);
          },
          abort.signal,
        );
        if (abort.signal.aborted) break;
        const compact = await compactIdentityAvatar(image);
        const asset = await onSaveAsset(compact, {
          title: `${target.label} icon`,
          tags: [target.kind, 'Icon'],
          source: 'generated',
          prompt,
        });
        setAssets((previous) => [asset, ...previous]);
        onAssetSaved(asset);
        if (target.kind === 'identities' && target.identity) {
          await onSaveAvatar(target.identity.id, compact);
          await onSaveIdentity({
            ...target.identity,
            avatarPath: identityAvatarPath(target.identity.id),
            avatarAssetId: asset.id,
            updatedAt: isoNow(),
          });
        } else {
          setArtwork(
            await onWrite(() =>
              store.saveSurfaceArtwork(target.id, asset.id, prompt, target.legacyKeys || []),
            ),
          );
        }
        setDone(++completed);
      }
      if (abort.signal.aborted) setMessage(`Stopped after ${completed} of ${plan.length} icons.`);
      else {
        setMessage(`Saved ${completed} icons.`);
        showCompletionToast(`${completed} icons ready.`, started);
      }
    } catch (cause) {
      if (abort.signal.aborted) setMessage(`Stopped after ${completed} of ${plan.length} icons.`);
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === abort) controller.current = null;
      setCurrent('');
      setBusy(false);
      try {
        const [savedArtwork, savedAssets] = await Promise.all([
          store.surfaceArtwork(),
          store.avatarLibrary(),
        ]);
        setArtwork(savedArtwork);
        setAssets(savedAssets);
      } catch {
        /* Completed icon saves remain on disk; the next open reloads them. */
      }
    }
  };

  return (
    <section className="harness-icon-studio" aria-label="Batch icon studio">
      <div className="harness-icon-studio-head">
        <div>
          <span className="harness-overline">ICON STUDIO</span>
          <h3>Generate icons in a batch</h3>
        </div>
        <button
          className="harness-icon"
          type="button"
          aria-label="Close icon studio"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="harness-icon-studio-kinds">
        {KIND_OPTIONS.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={kinds.includes(item.id)}
              disabled={busy}
              onChange={() => toggleKind(item.id)}
            />
            {item.label}
          </label>
        ))}
      </div>
      <div className="harness-icon-studio-fields">
        <label>
          Which icons
          <select
            value={scope}
            disabled={busy}
            onChange={(event) => setScope(event.target.value as IconStudioScope)}
          >
            <option value="missing">Missing icons only</option>
            <option value="preserve-uploads">All except uploaded icons</option>
            <option value="all">All selected icons</option>
          </select>
        </label>
        <label>
          Style
          <select
            value={preset}
            disabled={busy}
            onChange={(event) => setPreset(event.target.value as typeof preset)}
          >
            {STYLE_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {preset === 'custom' && (
        <label>
          Custom style
          <input
            value={customStyle}
            maxLength={240}
            disabled={busy}
            onChange={(event) => setCustomStyle(event.target.value)}
            placeholder="Describe a visual style"
          />
        </label>
      )}
      <label>
        Global image instructions
        <textarea
          rows={2}
          maxLength={500}
          disabled={busy}
          value={globalPrompt}
          onChange={(event) => setGlobalPrompt(event.target.value)}
        />
      </label>
      <p className="harness-muted" role="status">
        {plan.length} icon{plan.length === 1 ? '' : 's'} selected
        {plan.length
          ? ` · ${plan
              .slice(0, 5)
              .map((item) => item.label)
              .join(', ')}${plan.length > 5 ? '…' : ''}`
          : ''}
      </p>
      {busy && (
        <div className="harness-icon-studio-progress">
          <progress max={Math.max(1, total)} value={done} aria-label="Batch icon progress" />
          <span>
            {done}/{total} · {current}
          </span>
        </div>
      )}
      <div className="harness-icon-studio-actions">
        {imageOptions.length ? (
          <button
            className="harness-primary"
            type="button"
            disabled={busy || !plan.length}
            onClick={() => void run()}
          >
            <Sparkles size={15} /> Generate {plan.length} icon{plan.length === 1 ? '' : 's'}
          </button>
        ) : (
          <span className="harness-muted">Set up an image generator in Models first.</span>
        )}
        {busy && (
          <button className="harness-danger" type="button" onClick={() => controller.current?.abort()}>
            Stop
          </button>
        )}
      </div>
      {message && (
        <p className="harness-muted" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="harness-git-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
