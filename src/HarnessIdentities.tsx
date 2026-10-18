import { useEffect, useRef, useState } from 'react';
import { Plus, Sparkles, Upload, X } from 'lucide-react';
import { identityAvatarPath, isoNow, newId, type HarnessIdentity } from './harnessData.ts';
import { IDENTITY_ICONS, compactIdentityAvatar, identityAvatarPrompt, identityDraft } from './harnessIdentityAvatar.ts';
import { IdentityAvatar, useIdentityAvatarUrl } from './HarnessIdentityAvatar.tsx';
import { generateImage, type ImageConfig } from './imageGeneration.ts';
import { withModelLease } from './harnessLease.ts';
import type { HarnessStore } from './harnessStore.ts';

function IdentityCard({ identity, store, selected, onEdit, onSelect }: { identity: HarnessIdentity; store: HarnessStore; selected: boolean; onEdit: () => void; onSelect: () => void }) {
  const url = useIdentityAvatarUrl(store, identity);
  return <article className="harness-card harness-identity-card"><div><IdentityAvatar identity={identity} url={url} size={42}/><span className="harness-overline">{identity.focus.toUpperCase()}</span></div><h2>{identity.name}</h2><p>{identity.instructions}</p><div><button className="harness-secondary" onClick={onEdit}>Edit</button><button className="harness-secondary" disabled={selected} onClick={onSelect}>{selected ? 'Chat default' : 'Use for chat'}</button></div></article>;
}

export default function HarnessIdentities({ identities, chatIdentityId, store, folder, imageOptions, onSave, onSelectChat, onSaveAvatar, onOpenModels }: {
  identities: HarnessIdentity[];
  chatIdentityId: string;
  store: HarnessStore;
  folder: FileSystemDirectoryHandle | null;
  imageOptions: ImageConfig[];
  onSave: (identity: HarnessIdentity) => Promise<void>;
  onSelectChat: (id: string) => Promise<void>;
  onSaveAvatar: (id: string, blob: Blob) => Promise<string>;
  onOpenModels: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState<HarnessIdentity | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<Blob | null>(null);
  const [pendingUrl, setPendingUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const savedUrl = useIdentityAvatarUrl(store, draft || undefined);
  useEffect(() => {
    if (!pendingAvatar) { setPendingUrl(''); return; }
    const url = URL.createObjectURL(pendingAvatar);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAvatar]);
  const edit = (identity?: HarnessIdentity) => {
    const now = isoNow();
    const next = identity || { id: newId(), name: '', focus: 'general' as const, icon: 'person' as const, instructions: '', createdAt: now, updatedAt: now };
    setDraft(next); setPendingAvatar(null); setPrompt(identityAvatarPrompt(next)); setProgress(''); setError(''); dialog.current?.showModal();
  };
  const surprise = () => {
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    edit(identityDraft(random, identities.map(identity => identity.name)));
  };
  const close = () => { generation.current?.abort(); dialog.current?.close(); setDraft(null); setPendingAvatar(null); setProgress(''); };
  const save = async () => {
    if (!draft?.name.trim() || !draft.instructions.trim() || busy || generating) return;
    setBusy(true); setError('');
    try {
      const avatarPath = pendingAvatar ? await onSaveAvatar(draft.id, pendingAvatar) : draft.avatarPath;
      await onSave({ ...draft, name: draft.name.trim().slice(0, 80), instructions: draft.instructions.trim().slice(0, 4000), avatarPath, updatedAt: isoNow() });
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const selectChat = async (id: string) => {
    setError('');
    try { await onSelectChat(id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const upload = async (file: File | undefined) => {
    if (!file || !draft) return;
    setBusy(true); setError('');
    try { setPendingAvatar(await compactIdentityAvatar(file)); setDraft({ ...draft, avatarPath: identityAvatarPath(draft.id) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const generate = async (identity: HarnessIdentity | null = draft, imagePrompt = prompt) => {
    if (!identity || !imageOptions.length || generating) return;
    const controller = new AbortController();
    generation.current = controller;
    setGenerating(true); setProgress('Waiting for image model…'); setError('');
    try {
      const result = await withModelLease(`avatar:${identity.id}`, async () => {
        const failures: string[] = [];
        for (const option of imageOptions) {
          if (option.provider === 'browser' && !folder) { failures.push(`${option.model}: connect a model folder`); continue; }
          try { return await generateImage(option, imagePrompt.trim() || identityAvatarPrompt(identity), controller.signal, setProgress, undefined, folder); }
          catch (cause) { if (controller.signal.aborted) throw cause; failures.push(`${option.model}: ${cause instanceof Error ? cause.message : String(cause)}`); }
        }
        throw new Error(`No image generator completed the avatar. ${failures.join(' | ')}`);
      }, controller.signal);
      if (!controller.signal.aborted) {
        setPendingAvatar(await compactIdentityAvatar(result));
        setDraft(current => current?.id === identity.id ? { ...current, avatarPath: identityAvatarPath(current.id) } : current);
        setProgress('Avatar ready. Save the identity to keep it.');
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (generation.current === controller) generation.current = null; setGenerating(false); }
  };
  return <section className="harness-page">
    <div className="harness-heading harness-identity-heading"><div><span className="harness-overline">REUSABLE GUIDANCE</span><h1>Identities</h1><p>Choose how chat and agents work. Project instructions can add local context.</p></div><div className="harness-identity-generate"><button className="harness-secondary" onClick={surprise}><Sparkles size={16}/> Surprise me</button>{imageOptions.length > 0 && <button className="harness-secondary" onClick={() => { const random = crypto.getRandomValues(new Uint32Array(1))[0]; const next = identityDraft(random, identities.map(identity => identity.name)); edit(next); void generate(next, identityAvatarPrompt(next)); }}><Sparkles size={16}/> Surprise + avatar</button>}<button className="harness-primary" onClick={() => edit()}><Plus size={16}/> New identity</button></div></div>
    <div className="harness-card harness-identity-default"><label>Workspace chat identity<select aria-label="Workspace chat identity" value={chatIdentityId} onChange={event => void selectChat(event.target.value)}><option value="">No identity</option>{identities.map(identity => <option key={identity.id} value={identity.id}>{identity.name}</option>)}</select></label><small>Projects can override this in Project settings.</small>{error && !dialog.current?.open && <p role="alert" className="harness-git-error">{error}</p>}</div>
    <div className="harness-identity-grid">{identities.map(identity => <IdentityCard key={identity.id} identity={identity} store={store} selected={chatIdentityId === identity.id} onEdit={() => edit(identity)} onSelect={() => void selectChat(identity.id)}/>)}</div>
    <dialog ref={dialog} className="harness-dialog harness-identity-dialog" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="harness-identity-dialog-head"><h2>{identities.some(item => item.id === draft?.id) ? 'Edit identity' : 'New identity'}</h2><button className="harness-icon" aria-label="Close identity editor" onClick={close}><X size={16}/></button></div>
      {draft && <><div className="harness-identity-avatar-controls"><IdentityAvatar identity={draft} url={draft.avatarPath ? pendingUrl || savedUrl : undefined} size={64}/><button className="harness-secondary" disabled={busy || generating} onClick={() => fileInput.current?.click()}><Upload size={14}/> Upload image</button><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/>{draft.avatarPath && <button className="harness-secondary" disabled={busy || generating} onClick={() => { setPendingAvatar(null); setDraft({ ...draft, avatarPath: undefined }); }}>Use icon</button>}</div>
        <span className="harness-overline">ICON</span><div className="harness-identity-icon-grid">{IDENTITY_ICONS.map(item => <button key={item.id} type="button" aria-label={`${item.label} icon`} aria-pressed={(draft.icon || 'person') === item.id && !draft.avatarPath} onClick={() => { setPendingAvatar(null); setDraft({ ...draft, icon: item.id, avatarPath: undefined }); }}><IdentityAvatar identity={{ ...draft, icon: item.id }} size={27}/>{item.label}</button>)}</div>
        <label>Name<input value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label><label>Focus<select value={draft.focus} onChange={event => setDraft({ ...draft, focus: event.target.value as HarnessIdentity['focus'] })}><option value="coding">Coding</option><option value="research">Research</option><option value="review">Review</option><option value="general">General</option></select></label><label>Instructions<textarea value={draft.instructions} rows={5} maxLength={4000} onChange={event => setDraft({ ...draft, instructions: event.target.value })}/></label>
        <div className="harness-identity-avatar-prompt"><label>Image prompt<textarea rows={2} value={prompt} onChange={event => setPrompt(event.target.value)}/></label><div className="harness-identity-generate">{imageOptions.length ? <button className="harness-secondary" disabled={busy || generating} onClick={() => void generate()}>{generating ? 'Generating…' : 'Generate avatar'}</button> : <button className="harness-secondary" onClick={() => { close(); onOpenModels(); }}>Set up image model</button>}{generating && <button className="harness-danger" onClick={() => generation.current?.abort()}>Stop</button>}<span className="harness-identity-avatar-progress" role="status">{progress}</span></div>{imageOptions.length > 0 && <small className="harness-identity-avatar-progress">Image prompt goes to {imageOptions[0].provider === 'browser' ? 'your browser model' : imageOptions[0].provider === 'openai' ? 'OpenAI' : 'your configured image endpoint'} when you choose Generate avatar.</small>}</div>
        {error && <p role="alert" className="harness-git-error">{error}</p>}<div className="harness-dialog-actions"><button className="harness-secondary" disabled={busy} onClick={close}>Cancel</button><button className="harness-primary" disabled={busy || generating || !draft.name.trim() || !draft.instructions.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save identity'}</button></div></>}
    </dialog>
  </section>;
}
