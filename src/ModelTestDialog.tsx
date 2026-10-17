import { useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import type { AIConfig } from './ai';
import { getModelSession, isModelReady, modelFingerprint, subscribeModelSession, testModel } from './modelSession';
import { showCompletionToast } from './toastStore';
import type { RouteIntent } from './router';
type Props = { config: AIConfig; profiles: AIConfig[]; intent: RouteIntent; onSelect: (id: string) => void; onClose: () => void; onSettings: () => void };
export default function ModelTestDialog({ config, profiles, intent, onSelect, onClose, onSettings }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const session = useSyncExternalStore(subscribeModelSession, getModelSession);
  const ready = isModelReady(config);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal model-test-dialog" role="dialog" aria-modal="true" aria-label="Test AI model" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={20}/></button><div className="eyebrow">AI CONNECTION</div><h2>Test the selected model</h2><p>AI features become available after this model answers a short request in the current browser session.</p>{intent === 'image' && <p>Image generation has a separate generator and test in AI profiles.</p>}<label className="field"><span>Profile</span><select value={config.id} onChange={event => { onSelect(event.target.value); setError(''); }}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label><p className="muted">Selected model: {config.model || 'none'} · {config.provider}</p><div className="settings-actions"><button className="button primary" disabled={busy || !config.model} onClick={() => { setBusy(true); setError(''); const startedAt = performance.now(); void testModel(config).then(() => showCompletionToast(`${config.model} passed its model test.`, startedAt)).catch(value => setError(value instanceof Error ? value.message : String(value))).finally(() => setBusy(false)); }}>{busy ? 'Testing…' : 'Test model'}</button><button className="button secondary" onClick={onSettings}>Configure model</button>{ready && <button className="button secondary" onClick={onClose}>Continue</button>}</div>{busy && <div className="model-test-progress" role="status"><span>Waiting for the model response…</span><progress aria-label="Testing model"/></div>}<p role="status" className={error ? 'model-error' : 'muted'}>{error || (ready ? `${config.model} responded in this browser session.` : session.fingerprint === modelFingerprint(config) && session.state === 'testing' ? session.message : 'No successful test for this selection yet.')}</p></div></div>;
}
