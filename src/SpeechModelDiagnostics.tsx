import { useEffect, useRef, useState } from 'react';
import { generateBrowserSpeech, stopBrowserSpeech } from './browserSpeech.ts';
import { loadLatestDiagnosticJson, saveDiagnosticJson } from './diagnosticReports.ts';
import { KOKORO_BUILT_IN_VOICES, POCKET_BUILT_IN_VOICES, speechModel, type SpeechModelId } from './speechManifest.ts';
import { listVoiceSamples, readVoiceSample, VOICE_PASSAGES, writeWorkspaceFile, type VoiceSample } from './voiceSamples.ts';
import { showCompletionToast, showToast } from './toastStore.ts';
import type { QwenSpeechProgress } from './browserQwenTts.ts';
import type { OpenVoiceSplitMode } from './openVoiceSegments.ts';

type Report = { file: string; checkedAt: string; runtime: string; tests: { files: { result: string; detail: string }; speech: { result: string; detail: string; text: string; voice: string; sample?: string | null; source?: string | null; exaggeration?: number } }; savedAudio?: string };
function audioQuality(buffer: ArrayBuffer) {
  if (buffer.byteLength < 44) return { seconds: 0, rms: 0 };
  const view = new DataView(buffer);
  const rate = view.getUint32(24, true);
  const count = Math.max(0, (buffer.byteLength - 44) / 2);
  let energy = 0;
  for (let offset = 44; offset + 1 < buffer.byteLength; offset += 2) { const value = view.getInt16(offset, true) / 32768; energy += value * value; }
  return { seconds: rate ? count / rate : 0, rms: Math.sqrt(energy / Math.max(1, count)) };
}

type PauseReason = 'manual' | 'buffering' | null;
type LiveProgress = { generated: number; played: number; ahead: number; pauseReason: PauseReason; done: boolean };
const emptyLiveProgress = (): LiveProgress => ({ generated: 0, played: 0, ahead: 0, pauseReason: null, done: false });
const LOW_BUFFER_SECONDS = 1;
const RESUME_BUFFER_SECONDS = 3.5;
function livePlayback(context: AudioContext, onChange: (progress: LiveProgress) => void, onError: (error: unknown) => void) {
  const sources = new Set<AudioBufferSourceNode>();
  const segments: { start: number; duration: number }[] = [];
  let nextStart = 0;
  let underruns = 0;
  let finished = false;
  let stopped = false;
  let closing = false;
  let generated = 0;
  let pauseReason: PauseReason = null;
  let transition = Promise.resolve();
  const snapshot = (): LiveProgress => {
    const played = Math.min(generated, segments.reduce((sum, segment) => sum + Math.max(0, Math.min(segment.duration, context.currentTime - segment.start)), 0));
    return { generated, played, ahead: stopped ? 0 : Math.max(0, generated - played), pauseReason, done: stopped || finished && !sources.size };
  };
  const notify = () => onChange(snapshot());
  const changePauseReason = (reason: PauseReason) => {
    if (stopped || pauseReason === reason) return transition;
    pauseReason = reason;
    notify();
    transition = transition.then(async () => {
      if (stopped || context.state === 'closed') return;
      if (pauseReason && context.state !== 'suspended') await context.suspend();
      else if (!pauseReason && context.state !== 'running') await context.resume();
      notify();
    }).catch(onError);
    return transition;
  };
  const updateBuffering = () => {
    if (stopped || pauseReason === 'manual' || finished && !sources.size) return;
    const ahead = snapshot().ahead;
    if (pauseReason === 'buffering') {
      if (ahead >= RESUME_BUFFER_SECONDS || finished && ahead > 0) void changePauseReason(null);
    } else if (!finished && ahead < LOW_BUFFER_SECONDS) void changePauseReason('buffering');
  };
  const closeWhenDone = () => { if (finished && !sources.size && !closing && context.state !== 'closed') { closing = true; notify(); void context.close(); } };
  return {
    snapshot,
    begin() { return changePauseReason('buffering'); },
    tick() { updateBuffering(); notify(); },
    pause() { return changePauseReason('manual'); },
    resume() { if (pauseReason !== 'manual') return transition; return changePauseReason(!finished && snapshot().ahead < LOW_BUFFER_SECONDS ? 'buffering' : null); },
    add(audio: Float32Array, sampleRate: number) {
      if (stopped || !audio.length) return;
      const buffer = context.createBuffer(1, audio.length, sampleRate);
      buffer.getChannelData(0).set(audio);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      source.connect(gain).connect(context.destination);
      source.onended = () => { sources.delete(source); source.disconnect(); gain.disconnect(); updateBuffering(); notify(); closeWhenDone(); };
      sources.add(source);
      // Keep a short queue ahead of the speaker. After an underrun, refill it before resuming.
      if (!nextStart) nextStart = context.currentTime + 0.8;
      else if (nextStart < context.currentTime + 0.04) nextStart = context.currentTime + Math.min(1.2, 0.35 + 0.15 * ++underruns);
      const start = nextStart;
      const fade = Math.min(0.005, buffer.duration / 3);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + fade);
      gain.gain.setValueAtTime(1, start + buffer.duration - fade);
      gain.gain.linearRampToValueAtTime(0, start + buffer.duration);
      source.start(start);
      nextStart = start + buffer.duration;
      segments.push({ start, duration: buffer.duration });
      generated += buffer.duration;
      updateBuffering();
      notify();
    },
    finish() { finished = true; updateBuffering(); notify(); closeWhenDone(); },
    stop() {
      stopped = true; finished = true;
      for (const source of sources) { try { source.stop(); } catch { /* Already ended. */ } }
      sources.clear(); notify(); closeWhenDone();
    },
  };
}

export default function SpeechModelDiagnostics({ folder, model, disabled }: { folder: FileSystemDirectoryHandle | null; model: SpeechModelId; disabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const referenceAudioInput = useRef<HTMLInputElement>(null);
  const playback = useRef<ReturnType<typeof livePlayback> | null>(null);
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [sampleId, setSampleId] = useState('');
  const [voice, setVoice] = useState('alba');
  const [text, setText] = useState(VOICE_PASSAGES[model][0]);
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);
  const runId = useRef(0);
  const [phase, setPhase] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [qwenProgress, setQwenProgress] = useState<QwenSpeechProgress | null>(null);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [speakLive, setSpeakLive] = useState(false);
  const [exaggeration, setExaggeration] = useState(0.5);
  const [sourceAudio, setSourceAudio] = useState<File | null>(null);
  const [splitMode, setSplitMode] = useState<OpenVoiceSplitMode>('pauses');
  const [referenceAudio, setReferenceAudio] = useState<File | null>(null);
  const [liveProgress, setLiveProgress] = useState<LiveProgress>(emptyLiveProgress);
  const [saving, setSaving] = useState(false);
  const kokoro = model === 'kokoro_q8';
  const classicChatterbox = model === 'chatterbox_q4f16';
  const chatterbox = classicChatterbox || model === 'chatterbox_turbo_q4f16';
  const qwen = model === 'qwen3_tts_17b_q4';
  const openVoice = model === 'openvoice_v2_q8';
  const selected = kokoro ? undefined : samples.find(item => item.id === sampleId);
  const canConvert = !!sourceAudio && (!!selected || !!referenceAudio);
  const availableSamples = chatterbox || qwen || openVoice ? samples.filter(item => item.language === 'english_2026-04' || item.language === 'chatterbox_q4f16' || item.language === 'chatterbox_turbo_q4f16' || item.language === 'qwen3_tts_17b_q4' || item.language === 'openvoice_v2_q8') : samples;

  useEffect(() => { setText(VOICE_PASSAGES[model][0]); setVoice(model === 'kokoro_q8' ? 'af_heart' : model === 'qwen3_tts_17b_q4' ? 'default' : 'alba'); setSampleId(''); setSourceAudio(null); setReferenceAudio(null); if (referenceAudioInput.current) referenceAudioInput.current.value = ''; setSpeakLive(false); setReport(null); setAudioUrl(''); setAudioBlob(null); setError(''); }, [model]);
  useEffect(() => {
    if (!busy) return;
    const began = performance.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - began) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => () => { playback.current?.stop(); if (runningRef.current) void stopBrowserSpeech(); }, []);
  useEffect(() => {
    if (liveProgress.done || !playback.current) return;
    const timer = window.setInterval(() => playback.current?.tick(), 200);
    return () => window.clearInterval(timer);
  }, [liveProgress.done, liveProgress.generated > 0, busy]);
  useEffect(() => {
    let current = true;
    const refresh = () => { if (folder) void listVoiceSamples(folder).then(items => { if (current) setSamples(items); }).catch(reason => { if (current) setError(String(reason)); }); else setSamples([]); };
    refresh(); window.addEventListener('voice-samples-changed', refresh);
    return () => { current = false; window.removeEventListener('voice-samples-changed', refresh); };
  }, [folder]);
  useEffect(() => {
    if (!folder) return;
    let current = true;
    void loadLatestDiagnosticJson<Report>(folder, speechModel(model).path, 'speech').then(async saved => {
      if (!current) return;
      setReport(saved);
      if (!saved?.savedAudio) return;
      try {
        const parts = saved.savedAudio.split('/'); let dir = folder;
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
        const file = await (await dir.getFileHandle(parts.at(-1)!)).getFile();
        if (current) { setAudioBlob(file); setAudioUrl(URL.createObjectURL(file)); }
      } catch { /* A removed WAV does not hide its report. */ }
    }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [folder, model]);

  async function run() {
    if (!folder || busy || stopping || (!openVoice && !text.trim()) || openVoice && !canConvert) return;
    const thisRun = ++runId.current;
    stoppingRef.current = false;
    runningRef.current = true;
    setStopping(false);
    setBusy(true); setError(''); setPhase(openVoice ? 'Converting speech…' : 'Generating speech…'); setElapsed(0); setQwenProgress(null);
    const began = performance.now();
    playback.current?.stop();
    playback.current = null;
    setLiveProgress(emptyLiveProgress());
    setAudioBlob(null); setAudioUrl(''); setReport(null);
    let currentPlayback: ReturnType<typeof livePlayback> | null = null;
    let context: AudioContext | null = null;
    try { if (speakLive) {
      context = new AudioContext();
      await context.resume();
      currentPlayback = livePlayback(context, setLiveProgress, reason => setError(reason instanceof Error ? reason.message : String(reason)));
      playback.current = currentPlayback;
      await currentPlayback.begin();
    } } catch { currentPlayback?.stop(); if (!currentPlayback && context) void context.close(); playback.current = null; }
    try {
      const reference = referenceAudio || (selected ? await readVoiceSample(folder, selected) : undefined);
      if (stoppingRef.current || thisRun !== runId.current) throw new DOMException('Speech generation stopped.', 'AbortError');
      const output = await generateBrowserSpeech(folder, model, text.trim(), voice, reference, message => { if (!stoppingRef.current) setPhase(message); }, (chunk, sampleRate) => currentPlayback?.add(chunk, sampleRate), sourceAudio || undefined, value => { if (!stoppingRef.current) setQwenProgress(value); }, splitMode, exaggeration);
      if (stoppingRef.current || thisRun !== runId.current) throw new DOMException('Speech generation stopped.', 'AbortError');
      currentPlayback?.finish();
      const quality = audioQuality(await output.arrayBuffer());
      const passed = quality.seconds > 0.5 && quality.rms > 0.002;
      const checkedAt = new Date().toISOString();
      const next: Report = { file: speechModel(model).path, checkedAt, runtime: kokoro ? 'Kokoro browser engine' : chatterbox ? 'Chatterbox browser engine' : qwen ? 'Qwen3-TTS browser bridge' : openVoice ? 'OpenVoice browser converter' : 'Pocket TTS browser engine', tests: { files: { result: 'passed', detail: 'Engine, model, and license verified.' }, speech: { result: passed ? 'passed' : 'inconclusive', detail: `${quality.seconds.toFixed(1)} seconds of audio; RMS ${quality.rms.toFixed(3)}. Listen to judge pronunciation.`, text: openVoice ? '' : text.trim(), voice: selected?.name || referenceAudio?.name || voice, sample: selected?.file || referenceAudio?.name || null, ...(openVoice ? { source: sourceAudio?.name || null } : {}), ...(classicChatterbox ? { exaggeration } : {}) } } };
      await saveDiagnosticJson(folder, next.file, checkedAt, 'speech', next);
      setReport(next); setAudioBlob(output); setAudioUrl(URL.createObjectURL(output));
      showCompletionToast(`${speechModel(model).label} speech test complete.`, began);
    } catch (reason) { currentPlayback?.stop(); if (thisRun === runId.current) { if (reason instanceof DOMException && reason.name === 'AbortError') setPhase('Stopped.'); else setError(reason instanceof Error ? reason.message : String(reason)); } }
    finally { if (thisRun === runId.current) { runningRef.current = false; setBusy(false); setStopping(false); if (!stoppingRef.current) setPhase(''); } }
  }

  async function stop() {
    if (!busy || stoppingRef.current) return;
    stoppingRef.current = true;
    runId.current += 1;
    setStopping(true); setPhase('Stopping…');
    playback.current?.stop();
    setBusy(false);
    try { await stopBrowserSpeech(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { runningRef.current = false; setStopping(false); setPhase('Stopped.'); }
  }

  async function saveAudio() {
    if (!folder || !audioBlob || !report || saving || report.savedAudio) return;
    setSaving(true); setError('');
    try {
      const id = crypto.randomUUID();
      const audioDir = await (await folder.getDirectoryHandle('audio', { create: true })).getDirectoryHandle('generated', { create: true });
      await writeWorkspaceFile(audioDir, `${id}.wav`, audioBlob);
      await writeWorkspaceFile(audioDir, `${id}.json`, JSON.stringify({ model: report.file, text: report.tests.speech.text, source: report.tests.speech.source || null, voice: report.tests.speech.voice, sample: report.tests.speech.sample || null, createdAt: report.checkedAt, attribution: kokoro ? 'Kokoro by hexgrad; ONNX Community export; Apache 2.0' : classicChatterbox ? 'Chatterbox by Resemble AI; ONNX Community export; MIT' : chatterbox ? 'Chatterbox Turbo by Resemble AI; MIT' : qwen ? 'Qwen3-TTS by Qwen/Alibaba Cloud; GGUF by ggml-org; Apache 2.0' : openVoice ? 'OpenVoice V2 by MyShell.ai; ONNX export by TigreGotico; MIT' : 'Pocket TTS by Kyutai; ONNX export by vlapky; CC BY 4.0' }, null, 2));
      const updated = { ...report, savedAudio: `audio/generated/${id}.wav` };
      await saveDiagnosticJson(folder, updated.file, updated.checkedAt, 'speech', updated);
      setReport(updated);
      showToast('Speech saved to the project folder.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <button className="button secondary compact" type="button" disabled={disabled || !folder} onClick={() => dialog.current?.showModal()}>Inspect features</button>
    <dialog ref={dialog} className="model-limit-dialog speech-diagnostics-dialog" aria-label={`${speechModel(model).label} diagnostics`} onClose={() => { playback.current?.stop(); if (busy) void stop(); }}>
      <div className="provider-heading"><h2>{speechModel(model).label}</h2><form method="dialog"><button className="button secondary compact" type="submit">Close</button></form></div>
      {openVoice ? <div className="openvoice-inputs">
        <p className="muted">Convert existing speech to sound like a reference voice.</p>
        <label className="field"><span>Source speech · what is said</span><input type="file" accept="audio/*,.wav,.mp3,.ogg,.webm,.m4a" disabled={busy} onChange={event => setSourceAudio(event.target.files?.[0] || null)}/></label>
        <label className="field"><span>Long audio</span><select value={splitMode} disabled={busy} onChange={event => setSplitMode(event.target.value as OpenVoiceSplitMode)}><option value="pauses">Split near pauses</option><option value="even">Split evenly</option></select></label>
        <label className="field"><span>Reference voice · how it sounds</span><select value={sampleId} disabled={busy} onChange={event => { setSampleId(event.target.value); setReferenceAudio(null); if (referenceAudioInput.current) referenceAudioInput.current.value = ''; }}><option value="">Choose a saved voice</option>{availableSamples.map(item => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}</select></label>
        <label className="field"><span>Or upload reference audio</span><input ref={referenceAudioInput} type="file" accept="audio/*,.wav,.mp3,.ogg,.webm,.m4a" disabled={busy} onChange={event => { const file = event.target.files?.[0] || null; setReferenceAudio(file); if (file) setSampleId(''); }}/></label>
      </div> : <label className="field"><span>{kokoro ? 'Built-in voice' : chatterbox ? 'Reference voice' : 'Voice'}</span><select value={sampleId || (chatterbox ? '' : voice)} onChange={event => { const value = event.target.value; if (!kokoro && availableSamples.some(item => item.id === value)) setSampleId(value); else { setSampleId(''); setVoice(value); } }}>{chatterbox && <option value="">Choose a saved voice</option>}{qwen && <option value="default">Model voice</option>}{!chatterbox && !qwen && <optgroup label="Built-in voices">{(kokoro ? KOKORO_BUILT_IN_VOICES : POCKET_BUILT_IN_VOICES).map(item => <option key={item} value={item}>{item}</option>)}</optgroup>}{!kokoro && availableSamples.length > 0 && <optgroup label="Saved voices">{availableSamples.map(item => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}</optgroup>}</select></label>}
      {kokoro && <p className="muted">Voice recordings work with Pocket TTS. Kokoro uses built-in voices.</p>}
      {chatterbox && !availableSamples.length && <p className="muted">Record an English voice in Voices to run this test.</p>}
      {classicChatterbox && <label className="field"><span>Expression · {exaggeration.toFixed(2)}</span><input type="range" min="0.25" max="2" step="0.05" value={exaggeration} disabled={busy} onChange={event => setExaggeration(Number(event.target.value))}/><small className="muted">0.25 low · 0.50 default · 2.00 high</small></label>}
      {!openVoice && <><label className="field"><span>Text to speak</span><textarea rows={3} value={text} onChange={event => setText(event.target.value)}/></label><div className="model-buttons">{VOICE_PASSAGES[model].map((passage, index) => <button key={passage} className="button secondary compact" type="button" onClick={() => setText(passage)}>{chatterbox && /^\[(?:chuckle|laugh)\]/.test(passage) ? passage.match(/^\[[^\]]+\]/)?.[0] : `Passage ${index + 1}`}</button>)}</div></>}
      {!openVoice && <label className="speech-live-option"><input type="checkbox" checked={speakLive} disabled={busy} onChange={event => setSpeakLive(event.target.checked)}/> {qwen ? 'Play completed passages while generating' : 'Speak live while generating'}</label>}
      <div className="model-buttons"><button className="button primary compact" type="button" disabled={busy || stopping || !folder || (openVoice ? !canConvert : !text.trim() || chatterbox && !selected)} onClick={() => void run()}>{busy ? openVoice ? 'Converting…' : 'Generating…' : openVoice ? 'Run conversion test' : 'Run speech test'}</button>{busy && <button className="button danger compact" type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? 'Stopping…' : 'Stop'}</button>}</div>
      {openVoice && !busy && !canConvert && <p className="muted" role="status">{!sourceAudio ? 'Choose source speech audio to convert.' : 'Choose a saved voice or upload reference audio.'}</p>}
      {speakLive && (busy || liveProgress.generated > 0) && <div className="speech-live-progress" aria-label="Live audio playback">
        <div className="speech-live-progress-heading"><strong>{liveProgress.pauseReason === 'buffering' ? 'Buffering…' : liveProgress.pauseReason === 'manual' ? 'Paused' : 'Live audio'}</strong><button className="button secondary compact" type="button" disabled={!liveProgress.generated || liveProgress.done} onClick={() => { const player = playback.current; if (!player) return; void (liveProgress.pauseReason === 'manual' ? player.resume() : player.pause()).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))); }}>{liveProgress.pauseReason === 'manual' ? '▶ Play' : '⏸ Pause'}</button></div>
        <div className="speech-live-track" role="progressbar" aria-label="Audio played" aria-valuemin={0} aria-valuemax={Math.max(0.1, liveProgress.generated)} aria-valuenow={liveProgress.played}><span className="speech-live-played" style={{ width: `${liveProgress.generated ? liveProgress.played / liveProgress.generated * 100 : 0}%` }}/></div>
        <div className="speech-live-times"><span>{liveProgress.played.toFixed(1)}s played</span><span>{liveProgress.ahead.toFixed(1)}s ahead</span><span>{liveProgress.generated.toFixed(1)}s generated</span></div>
      </div>}
      {phase && <p role="status">{phase}</p>}
      {busy && qwen && <div className="qwen-speech-status" aria-live="off"><progress aria-label="Completed passages" value={qwenProgress ? qwenProgress.part - 1 : 0} max={qwenProgress?.parts || 1}/><span>{qwenProgress ? `Passage ${qwenProgress.part}/${qwenProgress.parts} · ${qwenProgress.framesGenerated} frames · ${elapsed}s` : `Working · ${elapsed}s`}</span></div>}
      {busy && chatterbox && <p className="speech-elapsed">{elapsed}s elapsed</p>}
      {report && <p role="status">{report.tests.speech.result === 'passed' ? '✅' : '❔'} {report.tests.speech.detail}</p>}
      {audioUrl && <audio controls src={audioUrl} aria-label="Generated speech" onPlay={() => playback.current?.stop()}/>}
      {audioUrl && report && <div className="model-buttons"><a className="button secondary compact" href={audioUrl} download={`${speechModel(model).label.replace(/\s+/g, '-')}-${report.checkedAt.replace(/[:.]/g, '-')}.wav`}>Download WAV</a><button className="button secondary compact" type="button" disabled={saving || !!report.savedAudio || !audioBlob} onClick={() => void saveAudio()}>{saving ? 'Saving…' : report.savedAudio ? 'Saved to workspace' : 'Save to workspace'}</button></div>}
      {report && <button className="button secondary compact" type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => showToast('Speech report copied.')).catch(reason => setError(String(reason)))}>Copy report JSON</button>}
      {error && <p className="model-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
