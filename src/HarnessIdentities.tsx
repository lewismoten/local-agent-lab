import { useRef, useState } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import { isoNow, newId, type HarnessIdentity } from './harnessData.ts';

export default function HarnessIdentities({ identities, chatIdentityId, onSave, onSelectChat }: {
  identities: HarnessIdentity[];
  chatIdentityId: string;
  onSave: (identity: HarnessIdentity) => Promise<void>;
  onSelectChat: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<HarnessIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const edit = (identity?: HarnessIdentity) => {
    const now = isoNow();
    setDraft(identity || { id: newId(), name: '', focus: 'general', instructions: '', createdAt: now, updatedAt: now });
    setError(''); dialog.current?.showModal();
  };
  const save = async () => {
    if (!draft?.name.trim() || !draft.instructions.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await onSave({ ...draft, name: draft.name.trim().slice(0, 80), instructions: draft.instructions.trim().slice(0, 4000), updatedAt: isoNow() });
      dialog.current?.close(); setDraft(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const selectChat = async (id: string) => {
    setError('');
    try { await onSelectChat(id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section className="harness-page">
    <div className="harness-heading harness-identity-heading"><div><span className="harness-overline">REUSABLE GUIDANCE</span><h1>Identities</h1><p>Choose how chat and agents work. Project instructions can add local context.</p></div><button className="harness-primary" onClick={() => edit()}><Plus size={16}/> New identity</button></div>
    <div className="harness-card harness-identity-default"><label>Workspace chat identity<select aria-label="Workspace chat identity" value={chatIdentityId} onChange={event => void selectChat(event.target.value)}><option value="">No identity</option>{identities.map(identity => <option key={identity.id} value={identity.id}>{identity.name}</option>)}</select></label><small>Projects can override this in Project settings.</small>{error && !dialog.current?.open && <p role="alert" className="harness-git-error">{error}</p>}</div>
    <div className="harness-identity-grid">{identities.map(identity => <article className="harness-card harness-identity-card" key={identity.id}><div><Sparkles size={19}/><span className="harness-overline">{identity.focus.toUpperCase()}</span></div><h2>{identity.name}</h2><p>{identity.instructions}</p><div><button className="harness-secondary" onClick={() => edit(identity)}>Edit</button><button className="harness-secondary" disabled={chatIdentityId === identity.id} onClick={() => void selectChat(identity.id)}>{chatIdentityId === identity.id ? 'Chat default' : 'Use for chat'}</button></div></article>)}</div>
    <dialog ref={dialog} className="harness-dialog harness-identity-dialog" onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className="harness-identity-dialog-head"><h2>{identities.some(item => item.id === draft?.id) ? 'Edit identity' : 'New identity'}</h2><button className="harness-icon" aria-label="Close identity editor" disabled={busy} onClick={() => dialog.current?.close()}><X size={16}/></button></div>
      {draft && <><label>Name<input value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label><label>Focus<select value={draft.focus} onChange={event => setDraft({ ...draft, focus: event.target.value as HarnessIdentity['focus'] })}><option value="coding">Coding</option><option value="research">Research</option><option value="review">Review</option><option value="general">General</option></select></label><label>Instructions<textarea value={draft.instructions} rows={7} maxLength={4000} onChange={event => setDraft({ ...draft, instructions: event.target.value })}/></label>{error && <p role="alert" className="harness-git-error">{error}</p>}<div className="harness-dialog-actions"><button className="harness-secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button><button className="harness-primary" disabled={busy || !draft.name.trim() || !draft.instructions.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save identity'}</button></div></>}
    </dialog>
  </section>;
}
