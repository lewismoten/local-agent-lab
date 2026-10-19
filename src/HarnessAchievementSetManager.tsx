import { useEffect, useRef, useState } from 'react';
import { Download, Sparkles, Upload, X } from 'lucide-react';
import { useConfirmDialog } from './ConfirmDialog.tsx';
import { ACHIEVEMENTS } from './harnessAchievements.ts';
import {
  activeAchievementSet,
  achievementArtworkKey,
  createAchievementSet,
  validAchievementSet,
  type AchievementSet,
  type AchievementSetLibrary,
} from './harnessAchievementSets.ts';
import { exportAchievementSetPack, packedIconBlob, readAchievementSetPack, type AchievementPackedIcon } from './harnessAchievementPack.ts';
import { compactIdentityAvatar } from './harnessIdentityAvatar.ts';
import type { SurfaceArtworkEntry, SurfaceArtworkMap } from './harnessSurfaceArtwork.ts';
import {
  ACHIEVEMENT_TONES,
  achievementDirection,
  generateAchievementSetDraft,
  type AchievementTone,
} from './harnessAchievementGeneration.ts';
import type { AIConfig } from './ai.ts';
import type { HarnessStore } from './harnessStore.ts';
import { showCompletionToast } from './toastStore.ts';
import './harnessAchievementSets.css';

export default function HarnessAchievementSetManager({
  store,
  library,
  config,
  onWrite,
  onChanged,
  onArtworkChanged,
}: {
  store: HarnessStore;
  library: AchievementSetLibrary;
  config: AIConfig | null;
  onWrite: <T>(action: () => Promise<T>) => Promise<T>;
  onChanged: (library: AchievementSetLibrary) => void;
  onArtworkChanged: (artwork: SurfaceArtworkMap) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const confirmAction = useConfirmDialog();
  const [draft, setDraft] = useState<AchievementSet | null>(null);
  const [importIcons, setImportIcons] = useState<Record<string, AchievementPackedIcon>>({});
  const [importProgress, setImportProgress] = useState('');
  const [tone, setTone] = useState<AchievementTone>('custom');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  const active = activeAchievementSet(library);
  const open = () => {
    setError('');
    dialog.current?.showModal();
  };
  const close = () => {
    if (busy) return;
    dialog.current?.close();
    setDraft(null);
    setImportIcons({});
    setImportProgress('');
    setError('');
  };
  const newSet = () => {
    try {
      setDraft(createAchievementSet('New set', 'Original, clear milestone copy.'));
      setImportIcons({});
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const save = async () => {
    if (!draft || busy) return;
    if (!validAchievementSet(draft)) {
      setError('Add a name, direction, title, description, and icon prompt for every achievement.');
      return;
    }
    setBusy(true);
    setError('');
    const started = performance.now();
    try {
      const imported = Object.entries(importIcons);
      if (imported.length) {
        const prepared: { id: string; image: Blob; prompt: string }[] = [];
        for (const [id, icon] of imported) prepared.push({
          id, image: await compactIdentityAvatar(packedIconBlob(icon)), prompt: icon.prompt,
        });
        const artworkEntries: Record<string, SurfaceArtworkEntry> = {};
        for (const [index, item] of prepared.entries()) {
          setImportProgress(`Saving icon ${index + 1} of ${prepared.length}…`);
          const asset = await onWrite(() => store.saveAvatarAsset(item.image, {
            title: `${draft.entries[item.id].title} icon`, tags: ['Achievement', 'Icon'],
            source: 'uploaded', prompt: item.prompt,
          }));
          artworkEntries[achievementArtworkKey(draft.id, item.id)] = { assetId: asset.id, prompt: item.prompt };
        }
        onArtworkChanged(await onWrite(() => store.saveSurfaceArtworkBatch(artworkEntries)));
      }
      const next = await onWrite(() =>
        store.updateAchievementSets((current) => ({
          version: 1,
          activeId: draft.id,
          sets: current.sets.some((set) => set.id === draft.id)
            ? current.sets.map((set) => (set.id === draft.id ? draft : set))
            : [...current.sets, draft],
        })),
      );
      onChanged(next);
      setDraft(null);
      setImportIcons({});
      setImportProgress('');
      if (imported.length) showCompletionToast('Achievement set and icons imported.', started);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const select = async (id: string | null) => {
    setBusy(true);
    setError('');
    try {
      onChanged(
        await onWrite(() => store.updateAchievementSets((current) => ({ ...current, activeId: id }))),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !active ||
      busy ||
      !(await confirmAction(
        `Delete “${active.name}” from this workspace? Export it first if you want a copy.`,
        { title: 'Delete achievement set', confirmLabel: 'Delete', destructive: true },
      ))
    )
      return;
    setBusy(true);
    setError('');
    try {
      onChanged(
        await onWrite(() =>
          store.updateAchievementSets((current) => ({
            version: 1,
            activeId: null,
            sets: current.sets.filter((set) => set.id !== active.id),
          })),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const exportSet = async () => {
    if (!active || busy) return;
    const started = performance.now();
    setBusy(true); setError(''); setImportProgress('Packing icons…');
    try {
      const pack = await exportAchievementSetPack(store, active);
      const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${active.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'achievements'}.achievements.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showCompletionToast('Achievement set exported.', started);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setImportProgress(''); }
  };
  const importSet = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 16_000_000) throw new Error('Achievement sets must be smaller than 16 MB.');
      const value: unknown = JSON.parse(await file.text());
      const pack = readAchievementSetPack(value);
      setDraft({ ...pack.set, id: crypto.randomUUID() });
      setImportIcons(pack.icons);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const generate = async () => {
    if (!draft || !config || busy) return;
    const direction = draft.direction.trim();
    if (!direction) {
      setError('Describe the direction first.');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setProgress({ done: 0, total: ACHIEVEMENTS.length });
    try {
      const generated = await generateAchievementSetDraft(
        config,
        draft.name,
        direction,
        abort.signal,
        (done, total) => setProgress({ done, total }),
      );
      if (!abort.signal.aborted) setDraft({ ...generated, id: draft.id, createdAt: draft.createdAt });
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(false);
      setProgress({ done: 0, total: 0 });
    }
  };
  const changeEntry = (id: string, field: 'title' | 'description' | 'imagePrompt', value: string) =>
    setDraft((current) =>
      current
        ? { ...current, entries: { ...current.entries, [id]: { ...current.entries[id], [field]: value } } }
        : null,
    );

  return (
    <>
      <button className="harness-secondary" type="button" onClick={open}>
        <Sparkles size={15} /> Sets
      </button>
      <dialog
        ref={dialog}
        className="harness-dialog harness-achievement-sets-dialog"
        aria-label="Achievement sets"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else close();
        }}
      >
        <header>
          <div>
            <span className="harness-overline">ACHIEVEMENTS</span>
            <h2>Achievement sets</h2>
          </div>
          <button
            className="harness-icon"
            type="button"
            aria-label="Close achievement sets"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        {!draft ? (
          <>
            <label className="harness-achievement-set-choice">
              Current set
              <select
                aria-label="Current achievement set"
                value={library.activeId || ''}
                disabled={busy}
                onChange={(event) => void select(event.target.value || null)}
              >
                <option value="">Original</option>
                {library.sets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="harness-achievement-set-actions">
              <button
                className="harness-secondary"
                type="button"
                disabled={busy || library.sets.length >= 24}
                onClick={newSet}
              >
                New set
              </button>
              <button
                className="harness-secondary"
                type="button"
                disabled={!active || busy}
                onClick={() => { setImportIcons({}); if (active) setDraft(structuredClone(active)); }}
              >
                Edit
              </button>
              <button
                className="harness-secondary"
                type="button"
                disabled={!active || busy}
                onClick={() => void exportSet()}
              >
                <Download size={15} /> Export
              </button>
              <button
                className="harness-secondary"
                type="button"
                disabled={busy || library.sets.length >= 24}
                onClick={() => importInput.current?.click()}
              >
                <Upload size={15} /> Import
              </button>
              <input
                ref={importInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  void importSet(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <button
                className="harness-secondary"
                type="button"
                disabled={!active || busy}
                onClick={() => {
                  close();
                  location.hash = '/images?batch=achievements';
                }}
              >
                Regenerate icons
              </button>
              <button
                className="harness-danger"
                type="button"
                disabled={!active || busy}
                onClick={() => void remove()}
              >
                Delete
              </button>
            </div>
            <p>Sets change names, descriptions, and icon prompts. Milestone progress stays the same.</p>
          </>
        ) : (
          <>
            <div className="harness-achievement-set-form">
              <label>
                Set name
                <input
                  maxLength={80}
                  value={draft.name}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                Direction
                <textarea
                  maxLength={600}
                  value={draft.direction}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft({ ...draft, direction: event.target.value });
                    setTone('custom');
                  }}
                />
              </label>
              <div className="harness-achievement-set-generate">
                <label>
                  AI tone
                  <select
                    value={tone}
                    disabled={busy}
                    onChange={(event) => {
                      const selected = event.target.value as AchievementTone;
                      setTone(selected);
                      if (selected !== 'custom')
                        setDraft({ ...draft, direction: achievementDirection(selected, '') });
                    }}
                  >
                    {ACHIEVEMENT_TONES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="harness-secondary"
                  type="button"
                  disabled={!config || busy}
                  title={!config ? 'Load a chat model first' : 'Draft all achievement copy and icon subjects'}
                  onClick={() => void generate()}
                >
                  <Sparkles size={15} /> Generate all
                </button>
              </div>
              {busy && progress.total > 0 && (
                <div className="harness-achievement-set-progress">
                  <progress
                    value={progress.done}
                    max={progress.total}
                    aria-label="Achievement generation progress"
                  />
                  <span>
                    {progress.done}/{progress.total}
                  </span>
                  <button
                    className="harness-danger"
                    type="button"
                    onClick={() => controller.current?.abort()}
                  >
                    Stop
                  </button>
                </div>
              )}
            </div>
            <div className="harness-achievement-set-entries">
              {ACHIEVEMENTS.map((achievement) => (
                <fieldset key={achievement.id}>
                  <legend>
                    {achievement.icon} {achievement.id}
                    {achievement.secret ? ' · hidden' : ''}
                  </legend>
                  <label>
                    Title
                    <input
                      maxLength={80}
                      value={draft.entries[achievement.id]?.title || ''}
                      disabled={busy}
                      onChange={(event) => changeEntry(achievement.id, 'title', event.target.value)}
                    />
                  </label>
                  <label>
                    Description
                    <input
                      maxLength={280}
                      value={draft.entries[achievement.id]?.description || ''}
                      disabled={busy}
                      onChange={(event) => changeEntry(achievement.id, 'description', event.target.value)}
                    />
                  </label>
                  <label>
                    Icon subject
                    <input
                      maxLength={600}
                      value={draft.entries[achievement.id]?.imagePrompt || ''}
                      disabled={busy}
                      onChange={(event) => changeEntry(achievement.id, 'imagePrompt', event.target.value)}
                    />
                  </label>
                </fieldset>
              ))}
            </div>
            <footer>
              <button
                className="harness-secondary"
                type="button"
                disabled={busy}
                onClick={() => { setDraft(null); setImportIcons({}); setImportProgress(''); }}
              >
                Back
              </button>
              <button className="harness-primary" type="button" disabled={busy} onClick={() => void save()}>
                Save and use set
              </button>
            </footer>
          </>
        )}
        {importProgress && <p role="status" className="harness-muted">{importProgress}</p>}
        {draft && Object.keys(importIcons).length > 0 && !importProgress && <p className="harness-muted">{Object.keys(importIcons).length} icons will be saved with this set.</p>}
        {error && (
          <p className="harness-git-error" role="alert">
            {error}
          </p>
        )}
      </dialog>
    </>
  );
}
