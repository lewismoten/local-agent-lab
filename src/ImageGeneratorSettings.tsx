import { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { generateImage, imageConfigured, IMAGE_PRESETS, type ImageConfig, type ImagePreset } from './imageGeneration';
import { clearImageReady, isImageReady, markImageReady } from './imageSession';
import { showCompletionToast } from './toastStore';
import { browserImagePreviewDataUrl } from './browserImage';
import { browserImageDefaultGuidance, browserImageDefaultSteps, browserImageOutputSize } from './browserImageAssets';
import { inspectGreenLeafTestImage } from './imageTestQuality';
import { DEFAULT_IMAGE_TEST_PROMPT, isReferenceImagePrompt, loadImageTestPrompt, saveImageTestPrompt } from './imageTestPrompt';

type Props = { config: ImageConfig; onChange: (config: ImageConfig) => void; folder: FileSystemDirectoryHandle | null };
const choices: { id: ImagePreset; label: string; source?: string; license?: string; note?: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'openai', label: 'OpenAI image API', source: 'https://platform.openai.com/docs/guides/image-generation' },
  { id: 'bonsai', label: 'Bonsai Image 4B', source: 'https://github.com/PrismML-Eng/Bonsai-Image-Demo', license: 'Apache 2.0', note: 'Start the official server and this app’s local browser relay. Choose the backend installed on your machine.' },
  { id: 'tiny-sd', label: 'Tiny Stable Diffusion · local server test', source: 'https://huggingface.co/diffusers/tiny-stable-diffusion-torch', license: 'Apache 2.0', note: 'A tiny development model for testing the local server pipeline; expect low image quality. Start the included local service.' },
  { id: 'small-sd', label: 'Small Stable Diffusion', source: 'https://huggingface.co/OFA-Sys/small-stable-diffusion-v0', license: 'OpenRAIL', note: 'A compact image model for actual references. Start the included local service.' },
  { id: 'pixart-delta', label: 'PixArt-δ (LCM)', source: 'https://huggingface.co/PixArt-alpha/PixArt-LCM-XL-2-1024-MS', license: 'OpenRAIL++', note: 'Connect a local service exposing OpenAI-compatible /images/generations for this model.' },
  { id: 'browser-sd15', label: 'Stable Diffusion 1.5 · browser', source: 'https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn', license: 'CreativeML Open RAIL-M', note: 'Download the ONNX image engine in Engines and Stable Diffusion 1.5 in Catalog, then test here.' },
  { id: 'browser-tiny-q4', label: 'Tiny-SD Q4 · browser', source: 'https://huggingface.co/cursedhelm/aderpy-deepdreamer-onnx', license: 'CreativeML Open RAIL-M', note: 'Smallest download. This Q4 export may produce gray patterns; use FP16 if the image test fails.' },
  { id: 'browser-tiny-fp16', label: 'Tiny-SD FP16 · browser', source: 'https://huggingface.co/cursedhelm/aderpy-deepdreamer-onnx', license: 'CreativeML Open RAIL-M', note: 'A larger Tiny-SD variant with FP16 weights. Download it in Catalog, then test it here.' },
  { id: 'browser-sdxs', label: 'SDXS DreamShaper · browser', source: 'https://huggingface.co/skillsafeai/sdxs-512-dreamshaper-onnx-webgpu', license: 'Open RAIL++-M', note: 'A one-step model for quick 512×512 story image drafts. Download it in Catalog, then test it here.' },
  { id: 'browser-lcm', label: 'DreamShaper 8 LCM · browser', source: 'https://huggingface.co/skillsafeai/dreamshaper-8-lcm-onnx-webgpu', license: 'CreativeML Open RAIL-M', note: 'Four-step 512×512 image drafts.' },
  { id: 'browser-supra-mobile', label: 'Supra2-IMG Mobile · browser', source: 'https://huggingface.co/mikhsol/Supra2-IMG-mobile-onnx', license: 'Apache 2.0', note: 'Compact 256×256 image generator for English prompts.' },
];

export default function ImageGeneratorSettings({ config, onChange, folder }: Props) {
  const helpRef = useRef<HTMLDialogElement>(null);
  const testController = useRef<AbortController | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [previewExtension, setPreviewExtension] = useState('png');
  const [stages, setStages] = useState<{ step: number; url: string }[]>([]);
  const [phase, setPhase] = useState('');
  const [step, setStep] = useState(0);
  const [promptText, setPromptText] = useState(() => loadImageTestPrompt(config.preset));
  useEffect(() => () => testController.current?.abort(), []);
  useEffect(() => { setPromptText(loadImageTestPrompt(config.preset)); }, [config.preset]);
  const group = config.preset === 'browser-sdxs' ? 'sdxs' : config.preset === 'browser-lcm' ? 'lcm' : config.preset === 'browser-supra-mobile' ? 'supra-mobile' : 'model';
  const browserSteps = config.steps ?? browserImageDefaultSteps(group);
  const stepOptions = config.preset === 'browser-sd15' ? [20, 25, 50] : config.preset === 'browser-supra-mobile' ? [12, 16, 20, 30, 40] : [10, 20, 25, 30, 40, 50];
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const update = (patch: Partial<ImageConfig>) => { setError(''); setPhase(''); setPreview(''); setStages([]); onChange({ ...config, ...patch }); };
  const choice = choices.find(item => item.id === config.preset)!;
  async function test() {
    const runPrompt = promptText.trim();
    if (testing || !runPrompt) return;
    const controller = new AbortController();
    testController.current = controller;
    clearImageReady();
    setTesting(true); setError(''); setPreview(''); setStages([]); setStep(0); setPhase('Preparing image model…');
    const startedAt = performance.now();
    try {
      const image = await generateImage(config, runPrompt, controller.signal, setPhase, value => {
        setStages(current => [...current, { step: value.step, url: browserImagePreviewDataUrl(value.imageData) }]);
      }, folder, value => setStep(value), 42);
      if (controller.signal.aborted) throw new DOMException('Image generation stopped.', 'AbortError');
      if (image.size === 0) throw new Error('The image generator returned an empty image.');
      const bitmap = await createImageBitmap(image);
      const width = bitmap.width, height = bitmap.height;
      bitmap.close();
      setPreview(URL.createObjectURL(image));
      setPreviewExtension(image.type === 'image/jpeg' ? 'jpg' : image.type === 'image/webp' ? 'webp' : 'png');
      if (config.provider === 'browser' && (width !== browserImageOutputSize(group) || height !== browserImageOutputSize(group))) throw new Error(`The image was ${width} × ${height}; expected ${browserImageOutputSize(group)} × ${browserImageOutputSize(group)}.`);
      if (config.provider === 'browser' && isReferenceImagePrompt(runPrompt)) {
        const check = await inspectGreenLeafTestImage(image);
        if (!check.passed) throw new Error(`The test image decoded, but only ${check.greenPercent}% of its pixels were green.${config.preset === 'browser-tiny-q4' ? ' Try Tiny-SD FP16 for usable images.' : ' Review the preview before using this model.'}`);
      }
      markImageReady(config);
      showCompletionToast(isReferenceImagePrompt(runPrompt) ? 'Image generator test complete.' : 'Image generation complete.', startedAt);
    } catch (cause) { if (controller.signal.aborted) setPhase('Stopped.'); else setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (testController.current === controller) testController.current = null; setTesting(false); if (!controller.signal.aborted) setPhase(''); }
  }
  return <div className="settings-card image-generator-settings">
    <div className="image-generator-heading"><h2>Image generator</h2><button className="model-limit-info" type="button" title="Image generator setup" aria-label="Image generator setup" onClick={() => helpRef.current?.showModal()}><CircleHelp size={17}/></button></div>
      <div className="two-col"><label className="field"><span>Generator</span><select value={config.preset} disabled={testing} onChange={event => { const next = IMAGE_PRESETS[event.target.value as ImagePreset]; onChange({ ...next, apiKey: '' }); setError(''); setPhase(''); setPreview(''); }}>{choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
    {config.preset !== 'none' && <>
      {choice.note && <p className="muted">{choice.note}</p>}
      {config.provider !== 'browser' && <div className="two-col"><label className="field"><span>API base URL</span><input type="url" value={config.endpoint} onChange={event => update({ endpoint: event.target.value })}/></label><label className="field"><span>Model ID</span><input value={config.model} onChange={event => update({ model: event.target.value })}/></label></div>}
      {config.provider === 'bonsai' && <label className="field"><span>Bonsai backend</span><select value={config.backend || 'bonsai-ternary-mlx'} onChange={event => update({ backend: event.target.value })}><option value="bonsai-ternary-mlx">Ternary · Apple Silicon</option><option value="bonsai-binary-mlx">Binary · Apple Silicon</option><option value="bonsai-ternary-gemlite">Ternary · NVIDIA</option><option value="bonsai-binary-gemlite">Binary · NVIDIA</option></select></label>}
      {config.provider !== 'bonsai' && config.provider !== 'browser' && <label className="field"><span>API key {config.provider === 'compatible' ? '(optional)' : ''}</span><input type="password" autoComplete="off" value={config.apiKey} onChange={event => update({ apiKey: event.target.value })}/></label>}
      {config.provider === 'browser' && config.preset !== 'browser-sdxs' && config.preset !== 'browser-lcm' && <div className="two-col"><label className="field"><span>Steps</span><select value={browserSteps} disabled={testing} onChange={event => update({ steps: Number(event.target.value) })}>{stepOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="field"><span>Prompt strength · {(config.guidanceScale ?? browserImageDefaultGuidance(group)).toFixed(1)}</span><input type="range" min="1" max="12" step="0.5" value={config.guidanceScale ?? browserImageDefaultGuidance(group)} disabled={testing} onChange={event => update({ guidanceScale: Number(event.target.value) })}/></label></div>}
      <label className="field image-test-prompt"><span>Prompt</span><textarea rows={2} maxLength={4000} value={promptText} disabled={testing} onChange={event => { setPromptText(event.target.value); saveImageTestPrompt(config.preset, event.target.value); }}/></label>
      <div className="settings-actions"><button className="button secondary compact" type="button" disabled={!imageConfigured(config) || testing || !promptText.trim()} onClick={() => void test()}>{testing ? 'Generating…' : isReferenceImagePrompt(promptText) ? 'Test image' : 'Generate image'}</button>{testing && <button className="button danger compact" type="button" disabled={testController.current?.signal.aborted} onClick={() => { testController.current?.abort(); setPhase('Stopping…'); }}>Stop</button>}<button className="button secondary compact" type="button" disabled={testing || isReferenceImagePrompt(promptText)} onClick={() => { setPromptText(DEFAULT_IMAGE_TEST_PROMPT); saveImageTestPrompt(config.preset, DEFAULT_IMAGE_TEST_PROMPT); }}>Reset prompt</button><span className="muted" role="status">{isImageReady(config) ? 'Ready in this session' : 'Test required'}</span>{choice.source && <a href={choice.source} target="_blank" rel="noreferrer">Model and setup</a>}{choice.license && <span className="muted">{choice.license}</span>}</div>
      {testing && <div className="image-step-progress" role="status"><progress aria-label="Generating test image" value={config.provider === 'browser' ? step : undefined} max={config.provider === 'browser' ? browserSteps : undefined}/>{config.provider === 'browser' && <span>{step}/{browserSteps}</span>}{phase && !phase.startsWith('Generating image ·') && <span>{phase}</span>}</div>}{!testing && phase === 'Stopped.' && <p role="status">Stopped.</p>}{error && <p className="model-error" role="alert">{error}</p>}{(stages.length > 0 || preview) && <div className="image-preview-sequence"><figure><img className="image-generator-preview" src={preview || stages[stages.length - 1].url} alt={preview ? 'Finished image' : `Test image preview after step ${stages[stages.length - 1].step}`}/><figcaption>{preview ? 'Finished image' : `Step ${stages[stages.length - 1].step}/${browserSteps} · preview`}</figcaption></figure>{preview && <a className="button secondary compact" href={preview} download={`${config.preset}-image.${previewExtension}`}>Download image</a>}{stages.length > 0 && <div className="image-preview-strip" aria-label="Image generation stages">{stages.map(item => <figure key={item.step}><img src={item.url} alt={`Step ${item.step} of ${browserSteps}`}/><figcaption>{item.step}/{browserSteps}</figcaption></figure>)}</div>}</div>}
    </>}
    <dialog ref={helpRef} className="model-limit-dialog image-generator-help"><h2>Local image models</h2><p>Browser image models use the optional ONNX engine and files saved in your working folder. Download the engine in Engines and a model in Catalog. A WebGPU browser and <code>shader-f16</code> GPU support are required. Loading an image model unloads local text and tool models to free memory; load them again when needed.</p><p>Steps control generation time and detail. Prompt strength controls how closely the image follows the words; high values can distort images. SDXS uses one step and DreamShaper LCM uses four, both fixed. Supra2 produces 256×256 images; the others produce 512×512. These settings cannot repair a broken model export or image pipeline.</p><p>Bonsai Image uses its official local server plus <code>python scripts/image_server.py --kind bonsai-proxy --port 8003</code> to permit browser requests. Select the installed backend here.</p><p>Tiny Stable Diffusion, Small Stable Diffusion, and PixArt-δ use the same script with <code>--kind tiny-sd</code>, <code>--kind small-sd</code>, or <code>--kind pixart-delta</code> and <code>--model-path</code>.</p><p>See <code>docs/image-generation.md</code> for commands. The models and server dependencies are optional and are not included in the website.</p><form method="dialog"><button className="button primary compact" type="submit">Close</button></form></dialog>
  </div>;
}
