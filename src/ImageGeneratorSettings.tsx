import { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { generateImage, imageConfigured, IMAGE_PRESETS, type ImageConfig, type ImagePreset } from './imageGeneration';
import { isImageReady, markImageReady } from './imageSession';
import { showCompletionToast } from './toastStore';
import { browserImagePreviewDataUrl } from './browserImage';

type Props = { config: ImageConfig; onChange: (config: ImageConfig) => void };
const choices: { id: ImagePreset; label: string; source?: string; license?: string; note?: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'openai', label: 'OpenAI image API', source: 'https://platform.openai.com/docs/guides/image-generation' },
  { id: 'bonsai', label: 'Bonsai Image 4B', source: 'https://github.com/PrismML-Eng/Bonsai-Image-Demo', license: 'Apache 2.0', note: 'Start the official server and this app’s local browser relay. Choose the backend installed on your machine.' },
  { id: 'tiny-sd', label: 'Tiny Stable Diffusion · test model', source: 'https://huggingface.co/diffusers/tiny-stable-diffusion-torch', license: 'Apache 2.0', note: 'A tiny development model for testing the image pipeline; expect low image quality. Start the included local service.' },
  { id: 'small-sd', label: 'Small Stable Diffusion', source: 'https://huggingface.co/OFA-Sys/small-stable-diffusion-v0', license: 'OpenRAIL', note: 'A compact image model for actual references. Start the included local service.' },
  { id: 'pixart-delta', label: 'PixArt-δ (LCM)', source: 'https://huggingface.co/PixArt-alpha/PixArt-LCM-XL-2-1024-MS', license: 'OpenRAIL++', note: 'Connect a local service exposing OpenAI-compatible /images/generations for this model.' },
  { id: 'browser-sd15', label: 'Stable Diffusion 1.5 · browser', source: 'https://huggingface.co/microsoft/stable-diffusion-v1.5-webnn', license: 'CreativeML Open RAIL-M', note: 'Download the ONNX image engine in Engines and Stable Diffusion 1.5 in Catalog, then test here.' },
];

export default function ImageGeneratorSettings({ config, onChange }: Props) {
  const helpRef = useRef<HTMLDialogElement>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [stages, setStages] = useState<{ step: number; url: string }[]>([]);
  const [phase, setPhase] = useState('');
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const update = (patch: Partial<ImageConfig>) => { setError(''); setPreview(''); setStages([]); onChange({ ...config, ...patch }); };
  const choice = choices.find(item => item.id === config.preset)!;
  async function test() {
    setTesting(true); setError(''); setPreview(''); setStages([]);
    const startedAt = performance.now();
    try {
      const image = await generateImage(config, 'A simple green leaf on a plain white background.', undefined, setPhase, value => {
        setStages(current => [...current, { step: value.step, url: browserImagePreviewDataUrl(value.imageData) }]);
      });
      if (image.size === 0) throw new Error('The image generator returned an empty image.');
      const bitmap = await createImageBitmap(image);
      bitmap.close();
      setPreview(URL.createObjectURL(image));
      markImageReady(config);
      showCompletionToast('Image generator test complete.', startedAt);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setTesting(false); setPhase(''); }
  }
  return <div className="settings-card image-generator-settings">
    <div className="image-generator-heading"><h2>Image generator</h2><button className="model-limit-info" type="button" title="Image generator setup" aria-label="Image generator setup" onClick={() => helpRef.current?.showModal()}><CircleHelp size={17}/></button></div>
    <div className="two-col"><label className="field"><span>Generator</span><select value={config.preset} onChange={event => { const next = IMAGE_PRESETS[event.target.value as ImagePreset]; onChange({ ...next, apiKey: '' }); setError(''); setPreview(''); }}>{choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
    {config.preset !== 'none' && <>
      {choice.note && <p className="muted">{choice.note}</p>}
      {config.provider !== 'browser' && <div className="two-col"><label className="field"><span>API base URL</span><input type="url" value={config.endpoint} onChange={event => update({ endpoint: event.target.value })}/></label><label className="field"><span>Model ID</span><input value={config.model} onChange={event => update({ model: event.target.value })}/></label></div>}
      {config.provider === 'bonsai' && <label className="field"><span>Bonsai backend</span><select value={config.backend || 'bonsai-ternary-mlx'} onChange={event => update({ backend: event.target.value })}><option value="bonsai-ternary-mlx">Ternary · Apple Silicon</option><option value="bonsai-binary-mlx">Binary · Apple Silicon</option><option value="bonsai-ternary-gemlite">Ternary · NVIDIA</option><option value="bonsai-binary-gemlite">Binary · NVIDIA</option></select></label>}
      {config.provider !== 'bonsai' && config.provider !== 'browser' && <label className="field"><span>API key {config.provider === 'compatible' ? '(optional)' : ''}</span><input type="password" autoComplete="off" value={config.apiKey} onChange={event => update({ apiKey: event.target.value })}/></label>}
      <div className="settings-actions"><button className="button secondary compact" type="button" disabled={!imageConfigured(config) || testing} onClick={() => void test()}>{testing ? 'Generating test…' : 'Test image'}</button><span className="muted" role="status">{isImageReady(config) ? 'Ready in this session' : 'Test required'}</span>{choice.source && <a href={choice.source} target="_blank" rel="noreferrer">Model and setup</a>}{choice.license && <span className="muted">{choice.license}</span>}</div>
      {testing && <div role="status"><progress aria-label="Generating test image"/>{phase && <span>{phase}</span>}</div>}{error && <p className="model-error" role="alert">{error}</p>}{(stages.length > 0 || preview) && <div className="image-preview-sequence"><figure><img className="image-generator-preview" src={preview || stages[stages.length - 1].url} alt={preview ? 'Generated test leaf' : `Test image preview after step ${stages[stages.length - 1].step}`}/><figcaption>{preview ? 'Finished image' : `Step ${stages[stages.length - 1].step}/20 · preview`}</figcaption></figure>{stages.length > 0 && <div className="image-preview-strip" aria-label="Image generation stages">{stages.map(item => <figure key={item.step}><img src={item.url} alt={`Step ${item.step} of 20`}/><figcaption>{item.step}/20</figcaption></figure>)}</div>}</div>}
    </>}
    <dialog ref={helpRef} className="model-limit-dialog image-generator-help"><h2>Local image models</h2><p>Browser Stable Diffusion 1.5 uses the optional ONNX engine and model saved in your working folder. Download the engine in Engines and the model in Catalog. A WebGPU browser and <code>shader-f16</code> GPU support are required. Loading it unloads local text and tool models to free memory; load them again when needed.</p><p>Bonsai Image uses its official local server plus <code>python scripts/image_server.py --kind bonsai-proxy --port 8003</code> to permit browser requests. Select the installed backend here.</p><p>Tiny Stable Diffusion, Small Stable Diffusion, and PixArt-δ use the same script with <code>--kind tiny-sd</code>, <code>--kind small-sd</code>, or <code>--kind pixart-delta</code> and <code>--model-path</code>.</p><p>See <code>docs/image-generation.md</code> for commands. The models and server dependencies are optional and are not included in the website.</p><form method="dialog"><button className="button primary compact" type="submit">Close</button></form></dialog>
  </div>;
}
