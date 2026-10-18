import { useEffect, useRef, useState } from 'react';
import { SPEECH_MODELS, type SpeechModelId } from './speechManifest.ts';
import { readVoiceSample, listVoiceSamples, saveVoiceSample, updateVoiceSample, VOICE_PASSAGES, type VoiceSample, type VoiceSampleDetails } from './voiceSamples.ts';
import { ensureWritableFolder } from './storage.ts';
import { showToast } from './toastStore.ts';

const MIN_SECONDS = 3;
const SWEET_SECONDS = 5;
const WARN_SECONDS = 8;
const MAX_SECONDS = 10;
const defaultDetails = (): VoiceSampleDetails => ({ name: 'Narrator', language: 'english_2026-04', text: VOICE_PASSAGES['english_2026-04'][0], version: '1.0', company: '', license: '' });
const formatSize = (bytes?: number) => bytes == null ? '—' : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatDuration = (seconds?: number) => seconds == null || !Number.isFinite(seconds) ? '—' : `${seconds.toFixed(1)}s`;

async function audioDuration(blob: Blob): Promise<number | undefined> {
  const url = URL.createObjectURL(blob);
  try {
    const metadataDuration = await new Promise<number | undefined>(resolve => {
      const audio = new Audio();
      const timeout = window.setTimeout(() => finish(undefined), 5000);
      const finish = (duration?: number) => { window.clearTimeout(timeout); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute('src'); audio.load(); resolve(duration); };
      audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : undefined);
      audio.onerror = () => finish(undefined);
      audio.src = url;
    });
    if (metadataDuration != null) return metadataDuration;
    try {
      const context = new AudioContext();
      try { return (await context.decodeAudioData(await blob.arrayBuffer())).duration; }
      finally { await context.close(); }
    } catch { return undefined; }
  } finally { URL.revokeObjectURL(url); }
}

export default function VoiceProfiles({ folder }: { folder: FileSystemDirectoryHandle | null }) {
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [metrics, setMetrics] = useState<Record<string, { bytes: number; seconds?: number }>>({});
  const [editing, setEditing] = useState<VoiceSample | null>(null);
  const [details, setDetails] = useState<VoiceSampleDetails>(defaultDetails);
  const [pendingAudio, setPendingAudio] = useState<Blob | null>(null);
  const [pendingDuration, setPendingDuration] = useState<number | undefined>();
  const [pendingUrl, setPendingUrl] = useState('');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState('');
  const [paused, setPaused] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const recorder = useRef<{ media: MediaRecorder; stream: MediaStream; timer: number; start: number; discard: boolean } | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null);
  const playbackUrl = useRef('');
  const playRequest = useRef(0);

  useEffect(() => {
    let current = true;
    const refresh = () => {
      if (!folder) { setSamples([]); setMetrics({}); return; }
      void listVoiceSamples(folder).then(items => { if (current) setSamples(items); }).catch(reason => { if (current) setError(String(reason)); });
    };
    refresh();
    window.addEventListener('voice-samples-changed', refresh);
    return () => { current = false; window.removeEventListener('voice-samples-changed', refresh); };
  }, [folder]);

  useEffect(() => {
    if (!folder) return;
    let current = true;
    for (const sample of samples) {
      if (sample.fileBytes != null && sample.durationSeconds != null) continue;
      void readVoiceSample(folder, sample).then(async file => {
        const seconds = sample.durationSeconds ?? await audioDuration(file);
        if (current) setMetrics(previous => ({ ...previous, [sample.id]: { bytes: file.size, seconds } }));
      }).catch(() => {});
    }
    return () => { current = false; };
  }, [folder, samples]);

  useEffect(() => {
    if (!pendingAudio) { setPendingUrl(''); return; }
    const url = URL.createObjectURL(pendingAudio);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAudio]);

  function stopPlayback() {
    playRequest.current += 1;
    if (playback.current) { playback.current.ontimeupdate = null; playback.current.onended = null; playback.current.onerror = null; }
    playback.current?.pause();
    playback.current = null;
    if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current);
    playbackUrl.current = '';
    setPlayingId(''); setPaused(false); setPlayProgress(0);
  }
  function discardRecording() {
    const active = recorder.current;
    if (!active) return;
    active.discard = true;
    window.clearInterval(active.timer);
    if (active.media.state !== 'inactive') active.media.stop();
    active.stream.getTracks().forEach(track => track.stop());
    recorder.current = null;
    setRecording(false); setElapsed(0);
  }
  useEffect(() => () => {
    const active = recorder.current;
    if (active) { active.discard = true; window.clearInterval(active.timer); if (active.media.state !== 'inactive') active.media.stop(); active.stream.getTracks().forEach(track => track.stop()); }
    playback.current?.pause();
    if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current);
  }, []);

  function openEditor(sample?: VoiceSample) {
    discardRecording();
    setEditing(sample || null);
    setDetails(sample ? { name: sample.name, language: sample.language, text: sample.text, version: sample.version || '', company: sample.company || '', license: sample.license || '' } : defaultDetails());
    setPendingAudio(null); setPendingDuration(undefined); setElapsed(0); setError('');
    dialog.current?.showModal();
  }
  function closeEditor() { discardRecording(); setPendingAudio(null); setPendingDuration(undefined); setError(''); dialog.current?.close(); }
  async function play(sample: VoiceSample) {
    if (playingId === sample.id && playback.current) {
      if (playback.current.paused) { await playback.current.play(); setPaused(false); }
      else { playback.current.pause(); setPaused(true); }
      return;
    }
    stopPlayback();
    const request = playRequest.current;
    if (!folder) return;
    try {
      const file = await readVoiceSample(folder, sample);
      if (request !== playRequest.current) return;
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      playbackUrl.current = url; playback.current = audio;
      audio.ontimeupdate = () => setPlayProgress(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.currentTime / audio.duration : 0);
      audio.onended = () => stopPlayback();
      audio.onerror = () => { setError(`Could not play ${sample.name}.`); stopPlayback(); };
      setPlayingId(sample.id); setPaused(false); setPlayProgress(0);
      await audio.play();
    } catch (reason) { if (request === playRequest.current) { stopPlayback(); setError(reason instanceof Error ? reason.message : String(reason)); } }
  }
  async function beginRecording() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      const start = performance.now();
      const timer = window.setInterval(() => {
        const seconds = (performance.now() - start) / 1000;
        setElapsed(Math.min(seconds, MAX_SECONDS));
        if (seconds >= MAX_SECONDS && media.state === 'recording') media.stop();
      }, 100);
      const active = { media, stream, timer, start, discard: false };
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = () => {
        window.clearInterval(timer); stream.getTracks().forEach(track => track.stop());
        if (recorder.current === active) recorder.current = null;
        setRecording(false);
        const seconds = Math.min((performance.now() - start) / 1000, MAX_SECONDS);
        setElapsed(seconds);
        if (active.discard) return;
        if (seconds < MIN_SECONDS) { setError(`Record at least ${MIN_SECONDS} seconds.`); return; }
        if (chunks.length) { setPendingAudio(new Blob(chunks, { type: media.mimeType || 'audio/webm' })); setPendingDuration(seconds); }
        else setError('The microphone did not return audio. Try again.');
      };
      recorder.current = active;
      media.start(); setPendingAudio(null); setPendingDuration(undefined); setElapsed(0); setRecording(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function upload(file: File) {
    setError('');
    if (file.size > 30 * 1024 * 1024) { setError('Keep voice samples under 30 MB.'); return; }
    setPendingAudio(file); setPendingDuration(await audioDuration(file));
  }
  async function save() {
    if (!folder || recording) return;
    if (!details.name.trim()) { setError('Enter a profile name.'); return; }
    if (!pendingAudio && !editing) { setError('Record or upload audio first.'); return; }
    setBusy(true); setError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the voice profile.');
      if (pendingAudio) await saveVoiceSample(folder, details, pendingAudio, pendingDuration, editing || undefined);
      else if (editing) await updateVoiceSample(folder, editing, details);
      showToast(editing ? 'Voice profile updated.' : 'Voice profile saved.');
      closeEditor();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const recordingClass = elapsed < MIN_SECONDS ? 'early' : elapsed < WARN_SECONDS ? 'sweet' : 'ending';
  return <section className="speech-studio voice-profiles" aria-label="Voice profiles">
    <div className="model-catalog-toolbar"><button className="button secondary compact" type="button" disabled={!folder} onClick={() => openEditor()}>New voice</button></div>
    <div className="model-catalog-scroll voice-table-scroll"><table className="model-catalog-table voice-table"><thead><tr><th scope="col">Profile</th><th scope="col">Language</th><th scope="col">Version</th><th scope="col">Company</th><th scope="col">License</th><th scope="col">Duration</th><th scope="col">File</th><th scope="col">Play</th><th scope="col">Edit</th></tr></thead><tbody>
      {samples.map(sample => {
        const isPlaying = playingId === sample.id;
        const data = metrics[sample.id];
        return <tr key={sample.id}><td><strong>{sample.name}</strong></td><td>{SPEECH_MODELS.find(model => model.id === sample.language)?.language || sample.language}</td><td>{sample.version || '—'}</td><td>{sample.company || '—'}</td><td>{sample.license || '—'}</td><td>{formatDuration(sample.durationSeconds ?? data?.seconds)}</td><td>{formatSize(sample.fileBytes ?? data?.bytes)}</td><td><button className={`voice-play-button${isPlaying && !paused ? ' playing' : ''}`} type="button" title={isPlaying && !paused ? 'Pause voice' : 'Play voice'} aria-label={`${isPlaying && !paused ? 'Pause' : 'Play'} ${sample.name}`} style={{ '--voice-play-progress': `${Math.max(0, Math.min(1, isPlaying ? playProgress : 0)) * 100}%` } as React.CSSProperties} onClick={() => void play(sample)}>{isPlaying && !paused ? '⏸' : '▶'}</button></td><td><button className="button secondary compact" type="button" onClick={() => openEditor(sample)}>Edit</button></td></tr>;
      })}
      {!samples.length && <tr><td colSpan={9} className="voice-empty">{folder ? 'No voices saved yet.' : 'Connect a project folder to save voices.'}</td></tr>}
    </tbody></table></div>
    {error && !dialog.current?.open && <p className="model-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="model-limit-dialog voice-editor-dialog" aria-label={editing ? 'Edit voice profile' : 'New voice profile'} onCancel={event => { event.preventDefault(); if (!busy) closeEditor(); }}>
      <h2>{editing ? 'Edit voice' : 'New voice'}</h2>
      <div className="voice-editor-fields"><label className="field"><span>Name</span><input value={details.name} onChange={event => setDetails({ ...details, name: event.target.value })}/></label><label className="field"><span>Language</span><select value={details.language} onChange={event => { const language = event.target.value as SpeechModelId; setDetails({ ...details, language, text: VOICE_PASSAGES[language][0] }); }}>{SPEECH_MODELS.filter(model => model.engine !== 'kokoro').map(model => <option key={model.id} value={model.id}>{model.engine === 'chatterbox' ? 'English · Chatterbox' : model.engine === 'qwen' ? 'English · Qwen3-TTS' : model.engine === 'openvoice' ? 'English · OpenVoice' : model.engine ? model.language : `${model.language} · Pocket`}</option>)}</select></label><label className="field"><span>Version</span><input value={details.version || ''} onChange={event => setDetails({ ...details, version: event.target.value })}/></label><label className="field"><span>Company</span><input value={details.company || ''} onChange={event => setDetails({ ...details, company: event.target.value })}/></label><label className="field"><span>License</span><input value={details.license || ''} onChange={event => setDetails({ ...details, license: event.target.value })}/></label></div>
      <label className="field"><span>Text to read</span><textarea rows={3} value={details.text} onChange={event => setDetails({ ...details, text: event.target.value })}/></label>
      <div className="model-buttons">{VOICE_PASSAGES[details.language].map((passage, index) => <button className="button secondary compact" type="button" key={passage} onClick={() => setDetails({ ...details, text: passage })}>Passage {index + 1}</button>)}</div>
      <div className="voice-recording-actions"><button className={`button ${recording ? 'danger' : 'secondary'} compact`} type="button" disabled={busy} onClick={() => recording ? recorder.current?.media.stop() : void beginRecording()}>{recording ? 'Stop recording' : editing ? 'Re-record' : 'Record'}</button><label className="voice-upload-button button secondary compact">Upload audio<input type="file" accept="audio/*" disabled={busy || recording} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }}/></label></div>
      {(recording || elapsed > 0) && <div className="voice-recording-meter" role="status"><div className={`voice-recording-track ${recordingClass}${recording ? ' active' : ''}`}><span style={{ width: `${Math.min(100, elapsed / MAX_SECONDS * 100)}%` }}/></div><div><span>{elapsed.toFixed(1)}s</span><span>{SWEET_SECONDS}–{WARN_SECONDS}s ideal · {MAX_SECONDS}s max</span></div></div>}
      {pendingUrl && <div className="voice-preview"><span>New recording · {formatDuration(pendingDuration)} · {formatSize(pendingAudio?.size)}</span><audio controls src={pendingUrl} aria-label="Preview voice recording"/></div>}
      {editing && !pendingAudio && <small className="muted">Save details, or replace the audio before saving.</small>}
      {error && <p className="model-error" role="alert">{error}</p>}
      <div className="voice-editor-footer"><button className="button secondary compact" type="button" disabled={busy} onClick={closeEditor}>Cancel</button><button className="button primary compact" type="button" disabled={busy || recording} onClick={() => void save()}>{busy ? 'Saving…' : 'Save voice'}</button></div>
    </dialog>
  </section>;
}
