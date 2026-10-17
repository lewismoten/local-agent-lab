import { useEffect, useRef, useState } from 'react';
import { BROWSER_IMAGE_MODEL_PATH, BROWSER_IMAGE_MODEL_ASSETS, assertBrowserImageFiles, browserImageTotal } from './browserImageAssets';
import { browserImagePreviewDataUrl, generateBrowserImage } from './browserImage';
import { recordCapability } from './capabilityLedger';
import { saveDiagnosticJson } from './diagnosticReports';
import { showCompletionToast } from './toastStore';

type Result = { file: string; checkedAt: string; runtime: string; tests: { files: { result: string; detail: string }; imageGeneration: { result: string; detail: string; prompt: string } }; savedPath?: string };
type Props = { folder: FileSystemDirectoryHandle | null; disabled?: boolean; openRequest?: { path: string; token: number } | null; onOpenRequestHandled?: () => void };
const prompt = 'A simple green leaf on a plain white background.';

export default function ImageModelDiagnostics({ folder, disabled, openRequest, onOpenRequestHandled }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [report, setReport] = useState<Result | null>(null);
  const [previews, setPreviews] = useState<{ step: number; url: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => () => { for (const item of previews) if (item.url.startsWith('blob:')) URL.revokeObjectURL(item.url); }, [previews]);
  useEffect(() => {
    if (!openRequest || openRequest.path !== BROWSER_IMAGE_MODEL_PATH || !folder || disabled) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    onOpenRequestHandled?.();
  }, [openRequest?.token, folder, disabled]);
  async function inspect() {
    if (!folder || busy) return;
    setBusy(true); setError(''); setPreviews([]); setPhase('Checking files…');
    const started = performance.now();
    const next: Result = {
      file: BROWSER_IMAGE_MODEL_PATH, checkedAt: new Date().toISOString(), runtime: 'ONNX image engine',
      tests: {
        files: { result: 'inconclusive', detail: 'Checking model and engine assets.' },
        imageGeneration: { result: 'inconclusive', detail: 'Not run.', prompt },
      },
    };
    try {
      await assertBrowserImageFiles(folder);
      next.tests.files = { result: 'passed', detail: `${BROWSER_IMAGE_MODEL_ASSETS.length} model files and the ONNX engine verified; license included.` };
      setReport({ ...next, tests: { ...next.tests } });
      const image = await generateBrowserImage(prompt, undefined, setPhase, value => {
        setPreviews(current => [...current, { step: value.step, url: browserImagePreviewDataUrl(value.imageData) }]);
      });
      const bitmap = await createImageBitmap(image);
      const size = `${bitmap.width} × ${bitmap.height}`;
      bitmap.close();
      setPreviews(current => [...current, { step: 20, url: URL.createObjectURL(image) }]);
      next.tests.imageGeneration = { result: 'passed', detail: `Generated and decoded a ${size} image. Review the preview for quality.`, prompt };
      await recordCapability(folder, BROWSER_IMAGE_MODEL_PATH, 'Stable Diffusion 1.5', 'imageGeneration', 'passed', next.tests.imageGeneration.detail, browserImageTotal('model'));
      showCompletionToast('Stable Diffusion image test complete.', started);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      if (next.tests.files.result !== 'passed') next.tests.files = { result: 'failed', detail: message };
      else {
        next.tests.imageGeneration = { result: 'failed', detail: message, prompt };
        await recordCapability(folder, BROWSER_IMAGE_MODEL_PATH, 'Stable Diffusion 1.5', 'imageGeneration', 'failed', message, browserImageTotal('model')).catch(() => {});
      }
    } finally {
      try { next.savedPath = await saveDiagnosticJson(folder, BROWSER_IMAGE_MODEL_PATH, next.checkedAt, 'text', next); }
      catch (cause) { setError(current => `${current ? `${current} ` : ''}Could not save report: ${cause instanceof Error ? cause.message : String(cause)}`); }
      setReport({ ...next, tests: { ...next.tests } }); setBusy(false); setPhase('');
    }
  }
  return <>
    <button className="button secondary compact" type="button" disabled={!folder || disabled} onClick={() => dialog.current?.showModal()}>Inspect features</button>
    <dialog ref={dialog} className="model-limit-dialog image-model-diagnostics" aria-labelledby="image-model-diagnostics-title">
      <h2 id="image-model-diagnostics-title">Stable Diffusion 1.5</h2>
      <p>🎨 Image generation · ONNX · CreativeML Open RAIL-M</p>
      <div className="settings-actions"><button className="button primary compact" type="button" disabled={!folder || busy} onClick={() => void inspect()}>{busy ? 'Testing…' : 'Run image test'}</button><button className="button secondary compact" type="button" onClick={() => dialog.current?.close()}>Close</button></div>
      {busy && <p role="status"><progress aria-label="Image test running"/> {phase}</p>}
      {report && <div className="image-model-results"><p>{report.tests.files.result === 'passed' ? '✅' : report.tests.files.result === 'failed' ? '❌' : '❔'} Files: {report.tests.files.detail}</p><p>{report.tests.imageGeneration.result === 'passed' ? '✅' : report.tests.imageGeneration.result === 'failed' ? '❌' : '❔'} Image generation: {report.tests.imageGeneration.detail}</p><p><strong>Prompt:</strong> {prompt}</p>{report.savedPath && <p className="muted">Report saved to {report.savedPath}</p>}</div>}
      {previews.length > 0 && <div className="image-preview-sequence"><figure><img className="image-generator-preview" src={previews[previews.length - 1].url} alt={`Stable Diffusion test preview after step ${previews[previews.length - 1].step}`}/><figcaption>Step {previews[previews.length - 1].step}/20{busy ? ' · preview' : ''}</figcaption></figure><div className="image-preview-strip" aria-label="Image generation stages">{previews.map(item => <figure key={item.step}><img src={item.url} alt={`Step ${item.step} of 20`}/><figcaption>{item.step}/20</figcaption></figure>)}</div></div>}
      {error && <p className="model-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
