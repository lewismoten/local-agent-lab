import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { finishBrowserTranscriptionSamples, getBrowserTranscriptionStatus, isBrowserTranscriptionLoadedFrom, loadBrowserTranscription, saveBrowserTranscript, subscribeBrowserTranscription, transcribeBrowserAudio, transcribeBrowserSamples, unloadBrowserTranscription, type TranscriptionResult, type TranscriptionSegment } from './browserTranscription.ts';
import { getTranscriptionAssets, subscribeTranscriptionAssets, transcriptionAssetsManager } from './transcriptionAssets.ts';
import { ensureWritableFolder } from './storage.ts';
import { transcriptionModel, type TranscriptionModelId } from './transcriptionManifest.ts';
import SherpaArchiveImport from './SherpaArchiveImport.tsx';
import { useConfirmDialog } from './ConfirmDialog.tsx';

type Capture = {
  folder: FileSystemDirectoryHandle;
  stream: MediaStream;
  context: AudioContext;
  node: AudioWorkletNode;
  recorder: MediaRecorder;
  recorded: Blob[];
  samples: Float32Array[];
  sampleCount: number;
  consumed: number;
  pending: Promise<void>;
  stopped: boolean;
  discarded: boolean;
};
const MIC_WINDOW_SECONDS = 6;
const workletSource = `class TranscriptionMicTap extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(4096); this.length = 0;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        if (this.length) this.port.postMessage(this.buffer.slice(0, this.length));
        this.length = 0;
        this.port.postMessage('flushed');
      }
    };
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (channels?.length) {
      for (let i = 0; i < channels[0].length; i++) {
        let value = 0;
        for (const channel of channels) value += channel[i] || 0;
        this.buffer[this.length++] = value / channels.length;
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(4096); this.length = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('transcription-mic-tap', TranscriptionMicTap);`;
function takeSamples(capture: Capture, count: number) {
  const out = new Float32Array(count); let offset = 0;
  while (offset < count) {
    const first = capture.samples[0];
    const amount = Math.min(first.length, count - offset);
    out.set(first.subarray(0, amount), offset); offset += amount;
    if (amount === first.length) capture.samples.shift();
    else capture.samples[0] = first.subarray(amount);
  }
  capture.sampleCount -= count;
  return out;
}

export default function TranscriptionPanel({ folder, model }: { folder: FileSystemDirectoryHandle | null; model: TranscriptionModelId }) {
  const confirmAction = useConfirmDialog();
  const assets = useSyncExternalStore(subscribeTranscriptionAssets, getTranscriptionAssets);
  const runtime = useSyncExternalStore(subscribeBrowserTranscription, getBrowserTranscriptionStatus);
  const dialog = useRef<HTMLDialogElement>(null);
  const captureRef = useRef<Capture | null>(null);
  const transcriptRef = useRef('');
  const segmentsRef = useRef<TranscriptionSegment[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [liveText, setLiveText] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const ready = !!folder && isBrowserTranscriptionLoadedFrom(folder, model);
  const installed = !!folder && assets.folder === folder && (model === 'sherpa' || assets.installed.engine) && assets.installed[model];
  const busy = runtime.state === 'loading' || runtime.state === 'transcribing' || processing;
  const fileRunning = useRef(false);
  async function load() {
    if (!folder) return;
    setError('');
    try { await loadBrowserTranscription(folder, model); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function queue() {
    if (!folder) return;
    setError('');
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the model.');
      if (model !== 'sherpa' && !assets.installed.engine) transcriptionAssetsManager.queue(folder, 'engine');
      if (!assets.installed[model]) transcriptionAssetsManager.queue(folder, model);
      if (assets.paused) transcriptionAssetsManager.resume(folder);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function runFile() {
    if (!folder || !file || fileRunning.current) return;
    fileRunning.current = true; setError(''); setResult(null);
    try {
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the transcript.');
      setResult(await transcribeBrowserAudio(folder, file, model));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { fileRunning.current = false; }
  }
  function enqueueAudio(capture: Capture, samples: Float32Array) {
    const offset = capture.consumed / capture.context.sampleRate;
    capture.consumed += samples.length;
    capture.pending = capture.pending.then(async () => {
      const result = await transcribeBrowserSamples(capture.folder, samples, capture.context.sampleRate, offset, model);
      if (capture.discarded) return;
      if (result.text) {
        transcriptRef.current = model === 'sherpa' ? result.text : `${transcriptRef.current} ${result.text}`.trim();
        if (model !== 'sherpa') segmentsRef.current.push(...result.chunks);
        setLiveText(transcriptRef.current);
      }
    }).catch(reason => { if (!capture.discarded) setError(reason instanceof Error ? reason.message : String(reason)); });
  }
  function drain(capture: Capture, flush = false) {
    const length = Math.round(capture.context.sampleRate * (model === 'sherpa' ? 0.5 : MIC_WINDOW_SECONDS));
    while (capture.sampleCount >= length) enqueueAudio(capture, takeSamples(capture, length));
    if (flush && capture.sampleCount >= capture.context.sampleRate * (model === 'sherpa' ? 0.1 : 1)) enqueueAudio(capture, takeSamples(capture, capture.sampleCount));
  }
  async function startRecording() {
    if (!folder || captureRef.current) return;
    setError(''); setResult(null); setLiveText(''); setRecordedSeconds(0);
    transcriptRef.current = ''; segmentsRef.current = [];
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let node: AudioWorkletNode | null = null;
    try {
      if (!ready) throw new Error(`Load ${transcriptionModel(model).label} before recording.`);
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.MediaRecorder) throw new Error('Microphone recording is unavailable in this browser.');
      if (!await ensureWritableFolder(folder)) throw new Error('Allow write access to save the recording and transcript.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      context = new AudioContext();
      const url = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      node = new AudioWorkletNode(context, 'transcription-mic-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const source = context.createMediaStreamSource(stream); source.connect(node); node.connect(context.destination);
      const recorder = new MediaRecorder(stream);
      const capture: Capture = { folder, stream, context, node, recorder, recorded: [], samples: [], sampleCount: 0, consumed: 0, pending: Promise.resolve(), stopped: false, discarded: false };
      node.port.onmessage = event => {
        if (capture.stopped) return;
        if (event.data === 'flushed') return;
        const samples = event.data as Float32Array;
        capture.samples.push(samples); capture.sampleCount += samples.length;
        const seconds = (capture.consumed + capture.sampleCount) / capture.context.sampleRate;
        setRecordedSeconds(Math.floor(seconds)); drain(capture);
      };
      recorder.ondataavailable = event => { if (event.data.size) capture.recorded.push(event.data); };
      recorder.start(1000);
      captureRef.current = capture;
      setRecording(true);
    } catch (reason) {
      node?.disconnect(); if (context) await context.close().catch(() => {});
      stream?.getTracks().forEach(track => track.stop());
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function stopRecording() {
    const capture = captureRef.current;
    if (!capture || capture.stopped) return;
    captureRef.current = null; setRecording(false); setProcessing(true);
    try {
      if (capture.recorder.state !== 'inactive') await new Promise<void>(resolve => {
        capture.recorder.addEventListener('stop', () => resolve(), { once: true });
        capture.recorder.stop();
      });
      await new Promise<void>(resolve => {
        const previous = capture.node.port.onmessage;
        capture.node.port.onmessage = event => {
          if (event.data === 'flushed') { capture.node.port.onmessage = previous; resolve(); }
          else previous?.call(capture.node.port, event);
        };
        capture.node.port.postMessage('flush');
      });
      capture.stopped = true;
      capture.node.disconnect(); capture.stream.getTracks().forEach(track => track.stop());
      drain(capture, true);
      await capture.pending;
      if (model === 'sherpa') transcriptRef.current = await finishBrowserTranscriptionSamples(capture.folder, model);
      const audio = new Blob(capture.recorded, { type: capture.recorder.mimeType || 'audio/webm' });
      const text = transcriptRef.current;
      const savedPath = await saveBrowserTranscript(capture.folder, 'microphone', text || '(No speech recognized.)', segmentsRef.current, audio, model);
      setResult({ text: text || '(No speech recognized.)', chunks: [...segmentsRef.current], savedPath });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { await capture.context.close().catch(() => {}); setProcessing(false); }
  }
  async function discardRecording() {
    const capture = captureRef.current;
    if (!capture || capture.stopped) return;
    captureRef.current = null;
    capture.discarded = true; capture.stopped = true;
    setRecording(false); setProcessing(true); setLiveText(''); setResult(null); setRecordedSeconds(0);
    transcriptRef.current = ''; segmentsRef.current = [];
    try {
      capture.recorder.ondataavailable = null;
      if (capture.recorder.state !== 'inactive') { try { capture.recorder.stop(); } catch { /* Tracks are stopped below. */ } }
      capture.node.port.onmessage = null;
      capture.node.disconnect();
      capture.stream.getTracks().forEach(track => track.stop());
      capture.samples = []; capture.sampleCount = 0; capture.recorded = [];
      await capture.pending;
      if (model === 'sherpa') await finishBrowserTranscriptionSamples(capture.folder, model);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { await capture.context.close().catch(() => {}); setProcessing(false); }
  }
  async function requestDiscard() {
    if (!captureRef.current || !await confirmAction('Discard this recording and its live transcript?', { title: 'Discard transcription', confirmLabel: 'Discard', destructive: true })) return;
    await discardRecording();
  }
  async function requestClose() {
    if (captureRef.current) {
      if (!await confirmAction('Discard this recording and its live transcript?', { title: 'Discard transcription', confirmLabel: 'Discard and close', destructive: true })) return;
      void discardRecording();
    }
    dialog.current?.close();
  }
  useEffect(() => () => { if (captureRef.current) void discardRecording(); }, []);
  return <>
    {!installed && model === 'sherpa' && <SherpaArchiveImport folder={folder}/>}
    {!installed && model !== 'sherpa' && <button className="button secondary compact" type="button" disabled={!folder || assets.active !== null} onClick={() => void queue()}>{assets.saved[model] || assets.saved.engine ? 'Resume download' : `Download ${transcriptionModel(model).label}`}</button>}
    <button className="button primary compact" type="button" disabled={!installed || runtime.state === 'loading' || ready} onClick={() => void load()}>{runtime.state === 'loading' ? 'Loading…' : ready ? 'Loaded' : 'Load'}</button>
    <button className="button secondary compact" type="button" onClick={() => dialog.current?.showModal()}>Transcribe</button>
    <button className="button secondary compact" type="button" disabled={!ready || recording || busy} onClick={() => void unloadBrowserTranscription()}>Unload</button>
    <dialog ref={dialog} className="model-limit-dialog speech-diagnostics-dialog transcription-dialog" aria-label="Audio transcription" onCancel={event => { event.preventDefault(); void requestClose(); }} onClose={() => { if (captureRef.current) void discardRecording(); }}>
      <div className="provider-heading"><h2>Transcribe audio</h2><button className="button secondary compact" type="button" onClick={() => void requestClose()}>Close</button></div>
      {!installed && model !== 'sherpa' && <div className="model-buttons"><button className="button secondary compact" type="button" disabled={!folder || assets.active !== null} onClick={() => void queue()}>{assets.saved[model] || assets.saved.engine ? 'Resume download' : `Download ${transcriptionModel(model).label}`}</button><span className="muted">Download the model and engine to this workspace.</span></div>}
      {installed && !ready && <button className="button primary compact" type="button" disabled={runtime.state === 'loading'} onClick={() => void load()}>{runtime.state === 'loading' ? 'Loading…' : `Load ${transcriptionModel(model).label}`}</button>}
      {(runtime.state === 'loading' || processing) && <div className="model-test-progress" role="status"><span>{processing ? 'Finishing recording…' : runtime.message}</span><progress aria-label="Transcription progress" max={runtime.progress == null ? undefined : 100} value={runtime.progress ?? undefined}/></div>}
      <div className="transcription-inputs">
        <section><h3>Microphone</h3><div className="model-buttons"><button className="button primary compact" type="button" disabled={!ready || recording || processing || fileRunning.current} onClick={() => void startRecording()}>Start recording</button>{recording && <button className="button secondary compact" type="button" onClick={() => void stopRecording()}>Stop and save</button>}{recording && <button className="button danger compact" type="button" onClick={() => void requestDiscard()}>Discard</button>}{recording && <span role="status" className="transcription-recording-time">● {Math.floor(recordedSeconds / 60).toString().padStart(2, '0')}:{(recordedSeconds % 60).toString().padStart(2, '0')}</span>}</div><p className="muted">{model === 'sherpa' ? 'Live text updates as speech is decoded.' : 'Live text updates about every six seconds, plus processing time.'}</p></section>
        <section><h3>Audio file</h3><label className="field"><span>Choose audio</span><input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" disabled={!ready || recording || busy} onChange={event => { setFile(event.target.files?.[0] || null); setResult(null); }}/></label><button className="button primary compact" type="button" disabled={!ready || !file || recording || busy} onClick={() => void runFile()}>{runtime.state === 'transcribing' && !recording ? 'Transcribing…' : 'Transcribe file'}</button></section>
      </div>
      {(error || runtime.state === 'error' && runtime.message) && <p className="model-error" role="alert">{error || runtime.message}</p>}
      {(recording || liveText || result) && <div className="transcription-result"><label className="field"><span>{recording ? 'Live transcript' : 'Transcript'}</span><textarea readOnly rows={10} value={recording ? liveText : result?.text || liveText}/></label>{result && <p className="muted">Saved to {result.savedPath}</p>}{!recording && <button className="button secondary compact" type="button" onClick={() => void navigator.clipboard.writeText(result?.text || liveText)}>Copy text</button>}</div>}
    </dialog>
  </>;
}
