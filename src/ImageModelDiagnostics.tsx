import { useEffect, useRef, useState } from 'react';
import { BROWSER_IMAGE_MODEL_PATHS, assertBrowserImageFiles, browserImageAssets, browserImageDefaultSteps, browserImageLicenseLinks, browserImageModelLabel, browserImageOutputSize, browserImageTotal, type BrowserImageModelGroup } from './browserImageAssets';
import { browserImagePreviewDataUrl } from './browserImage';
import { acquireModel } from './harnessLease.ts';
import { recordCapability } from './capabilityLedger';
import { saveDiagnosticJson } from './diagnosticReports';
import { inspectGreenLeafTestImage } from './imageTestQuality';
import { showCompletionToast, showToast } from './toastStore';
import { clearImageReadyForPreset, markImageReady } from './imageSession';
import { IMAGE_PRESETS, browserImagePresetForGroup, generateImage, type ImageConfig } from './imageGeneration';
import { imageRunProvenance, saveImageOutput } from './imageProvenance.ts';
import { DEFAULT_IMAGE_TEST_PROMPT, isReferenceImagePrompt, loadImageTestPrompt, saveImageTestPrompt } from './imageTestPrompt';
import { captureVisualTestEnvironment, type VisualTestEnvironment } from './visualTestEnvironment.ts';

type Result = { file: string; checkedAt: string; runtime: string; scheduler: string; scoringVersion: number; environment: VisualTestEnvironment; inferenceBackend?: 'WebGPU'; tests: { files: { result: string; detail: string }; imageGeneration: { result: string; detail: string; prompt: string; seed: number; evaluation: 'reference' | 'preview'; greenPercent?: number } }; provenance?: ReturnType<typeof imageRunProvenance>; outputPath?: string; outputMetadataPath?: string; outputSaveError?: string; savedPath?: string };
type Props = { group: BrowserImageModelGroup; folder: FileSystemDirectoryHandle | null; imageConfig: ImageConfig; disabled?: boolean; openRequest?: { path: string; token: number } | null; onOpenRequestHandled?: () => void };
const seed = 42;

export default function ImageModelDiagnostics({ group, folder, imageConfig, disabled, openRequest, onOpenRequestHandled }: Props) {
  const path = BROWSER_IMAGE_MODEL_PATHS[group];
  const label = browserImageModelLabel(group);
  const steps = browserImageDefaultSteps(group);
  const preset = browserImagePresetForGroup(group);
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [step, setStep] = useState(0);
  const [report, setReport] = useState<Result | null>(null);
  const [previews, setPreviews] = useState<{ step: number; url: string }[]>([]);
  const [finalImageUrl, setFinalImageUrl] = useState('');
  const [error, setError] = useState('');
  const [promptText, setPromptText] = useState(() => loadImageTestPrompt(preset));
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { for (const item of previews) if (item.url.startsWith('blob:')) URL.revokeObjectURL(item.url); }, [previews]);
  useEffect(() => { setReport(null); setPreviews([]); setFinalImageUrl(''); setError(''); setPromptText(loadImageTestPrompt(preset)); }, [preset]);
  useEffect(() => {
    if (!openRequest || openRequest.path !== path || !folder || disabled) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    onOpenRequestHandled?.();
  }, [openRequest?.token, folder, disabled, path]);
  async function inspect() {
    const runPrompt = promptText.trim();
    if (!folder || busy || !runPrompt) return;
    const reference = isReferenceImagePrompt(runPrompt);
    const run = new AbortController();
    controller.current = run;
    setBusy(true); setError(''); setPreviews([]); setFinalImageUrl(''); setStep(0); setPhase('Checking files…');
    const started = performance.now();
    const next: Result = {
      file: path, checkedAt: new Date().toISOString(), runtime: 'ONNX image engine', scheduler: group === 'model' ? 'Euler' : group === 'sdxs' ? 'One-step Euler' : group === 'lcm' ? 'LCM' : group === 'supra-mobile' ? 'Euler rectified flow' : 'DPM++ 2M', scoringVersion: 3, environment: captureVisualTestEnvironment(),
      tests: {
        files: { result: 'inconclusive', detail: 'Checking model and engine assets.' },
        imageGeneration: { result: 'inconclusive', detail: 'Not run.', prompt: runPrompt, seed, evaluation: reference ? 'reference' : 'preview' },
      },
    };
    let release: (() => void) | undefined;
    try {
      setPhase('Waiting for model…');
      release = await acquireModel(`diagnostics:image:${group}`, run.signal);
      await assertBrowserImageFiles(folder, group);
      if (run.signal.aborted) throw new DOMException('Image generation stopped.', 'AbortError');
      next.tests.files = { result: 'passed', detail: `${browserImageAssets(group).filter(asset => asset.name.endsWith('.onnx')).length} model components and the ONNX engine verified; license included.` };
      setReport({ ...next, tests: { ...next.tests } });
      const image = await generateImage(IMAGE_PRESETS[preset], runPrompt, run.signal, setPhase, value => {
        setPreviews(current => [...current, { step: value.step, url: browserImagePreviewDataUrl(value.imageData) }]);
      }, folder, value => setStep(value), seed);
      next.inferenceBackend = 'WebGPU';
      const quality = reference ? await inspectGreenLeafTestImage(image) : null;
      const bitmap = quality ? null : await createImageBitmap(image);
      const width = quality?.width ?? bitmap!.width, height = quality?.height ?? bitmap!.height;
      bitmap?.close();
      const size = `${width} × ${height}`;
      const imageUrl = URL.createObjectURL(image);
      setFinalImageUrl(imageUrl);
      setPreviews(current => [...current, { step: steps, url: imageUrl }]);
      const expected = browserImageOutputSize(group);
      const passed = width === expected && height === expected && (!reference || !!quality?.passed);
      const detail = width !== expected || height !== expected ? `Generated ${size}; expected ${expected} × ${expected}.`
        : reference ? passed ? `Generated a ${size} image with visible green content; review the preview for the leaf.` : `Decoded a ${size} image, but the green-leaf test found only ${quality!.greenPercent}% green pixels.${group === 'tiny-q4' ? ' Try Tiny-SD FP16.' : ' Review the preview.'}`
        : `Generated a ${size} image. Review the preview for prompt match.`;
      next.tests.imageGeneration = { result: passed ? 'passed' : 'failed', detail, prompt: runPrompt, seed, evaluation: reference ? 'reference' : 'preview', ...(quality ? { greenPercent: quality.greenPercent } : {}) };
      const outputPath = `outputs/images/${group}-${next.checkedAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.png`;
      next.provenance = imageRunProvenance(IMAGE_PRESETS[preset], runPrompt, outputPath, next.checkedAt, seed);
      try {
        const saved = await saveImageOutput(folder, image, IMAGE_PRESETS[preset], runPrompt, outputPath, next.checkedAt, seed);
        next.outputPath = outputPath;
        next.outputMetadataPath = saved.metadataPath;
      } catch (cause) {
        next.outputSaveError = cause instanceof Error ? cause.message : String(cause);
        setError(`Image generated, but could not save the output: ${next.outputSaveError}`);
      }
      if (passed && imageConfig.preset === preset) markImageReady(imageConfig);
      if (!passed) clearImageReadyForPreset(preset);
      if (reference) await recordCapability(folder, path, label, 'imageGeneration', passed ? 'passed' : 'failed', detail, browserImageTotal(group));
      if (passed) showCompletionToast(`${label} ${reference ? 'image test' : 'image generation'} complete.`, started);
      else showToast(reference ? `${label} image test did not match the prompt.` : `${label} image generation failed.`, 'error');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const stopped = run.signal.aborted;
      if (!stopped) setError(message);
      if (next.tests.files.result !== 'passed') next.tests.files = { result: stopped ? 'inconclusive' : 'failed', detail: stopped ? 'Stopped by user.' : message };
      else if (stopped) next.tests.imageGeneration = { result: 'inconclusive', detail: 'Stopped by user.', prompt: runPrompt, seed, evaluation: reference ? 'reference' : 'preview' };
      else {
        clearImageReadyForPreset(preset);
        next.tests.imageGeneration = { result: 'failed', detail: message, prompt: runPrompt, seed, evaluation: reference ? 'reference' : 'preview' };
        if (reference) await recordCapability(folder, path, label, 'imageGeneration', 'failed', message, browserImageTotal(group)).catch(() => {});
      }
    } finally {
      if (controller.current === run) controller.current = null;
      try { next.savedPath = await saveDiagnosticJson(folder, path, next.checkedAt, 'image', next); }
      catch (cause) { setError(current => `${current ? `${current} ` : ''}Could not save report: ${cause instanceof Error ? cause.message : String(cause)}`); }
      release?.();
      setReport({ ...next, tests: { ...next.tests } }); setBusy(false); setPhase('');
    }
  }
  async function copy() {
    if (!report) return;
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); showToast('Image report copied.'); }
    catch (cause) { setError(`Could not copy report: ${cause instanceof Error ? cause.message : String(cause)}`); }
  }
  return <>
    <button className="button secondary compact" type="button" disabled={!folder || disabled} onClick={() => dialog.current?.showModal()}>Inspect features</button>
    <dialog ref={dialog} className="model-limit-dialog image-model-diagnostics" aria-labelledby="image-model-diagnostics-title">
      <h2 id="image-model-diagnostics-title">{label}</h2>
      <p>🎨 Image generation · ONNX · {browserImageLicenseLinks(group).map((item, index) => <span key={item.url}>{index > 0 ? ' · ' : ''}<a href={item.url} target="_blank" rel="noreferrer">{item.label}</a></span>)}{group !== 'supra-mobile' && <span> · Use restrictions apply</span>}</p>
      <label className="field image-test-prompt"><span>Prompt</span><textarea rows={2} maxLength={4000} value={promptText} disabled={busy} onChange={event => { setPromptText(event.target.value); saveImageTestPrompt(preset, event.target.value); }}/></label>
      <div className="settings-actions"><button className="button primary compact" type="button" disabled={!folder || busy || !promptText.trim()} onClick={() => void inspect()}>{busy ? 'Generating…' : isReferenceImagePrompt(promptText) ? 'Run image test' : 'Generate image'}</button>{busy && <button className="button danger compact" type="button" disabled={controller.current?.signal.aborted} onClick={() => { controller.current?.abort(); setPhase('Stopping…'); }}>Stop</button>}<button className="button secondary compact" type="button" disabled={busy || isReferenceImagePrompt(promptText)} onClick={() => { setPromptText(DEFAULT_IMAGE_TEST_PROMPT); saveImageTestPrompt(preset, DEFAULT_IMAGE_TEST_PROMPT); }}>Reset prompt</button><button className="button secondary compact" type="button" disabled={!report || busy} onClick={() => void copy()}>Copy JSON</button><button className="button secondary compact" type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button></div>
      {busy && <div className="image-step-progress" role="status"><progress aria-label="Image test steps" value={step} max={steps}/><span>{step}/{steps}</span>{phase && !phase.startsWith('Generating image ·') && <span>{phase}</span>}</div>}
      {report && <div className="image-model-results"><p>{report.tests.files.result === 'passed' ? '✅' : report.tests.files.result === 'failed' ? '❌' : '❔'} Files: {report.tests.files.detail}</p><p>{report.tests.imageGeneration.result === 'passed' ? '✅' : report.tests.imageGeneration.result === 'failed' ? '❌' : '❔'} Image generation: {report.tests.imageGeneration.detail}</p><p><strong>Prompt used:</strong> {report.tests.imageGeneration.prompt}</p>{report.outputPath && <p className="muted">Image saved to {report.outputPath}</p>}{report.savedPath && <p className="muted">Report saved to {report.savedPath}</p>}</div>}
      {previews.length > 0 && <div className="image-preview-sequence"><figure><img className="image-generator-preview" src={previews[previews.length - 1].url} alt={`${label} test preview after step ${previews[previews.length - 1].step}`}/><figcaption>Step {previews[previews.length - 1].step}/{steps}{busy ? ' · preview' : ''}</figcaption></figure><div className="image-preview-strip" aria-label="Image generation stages">{previews.map(item => <figure key={item.step}><img src={item.url} alt={`Step ${item.step} of ${steps}`}/><figcaption>{item.step}/{steps}</figcaption></figure>)}</div></div>}
      {finalImageUrl && <a className="button secondary compact" href={finalImageUrl} download={`${group}-image.png`}>Download image</a>}
      {error && !Object.values(report?.tests || {}).some(test => test.detail === error) && <p className="model-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
