/** Optional network audit. Checks publisher metadata and pinned catalog sidecars without downloading model weights. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MODEL_CATALOG } from '../src/catalogModels.ts';
import { ensureModelLicenseFiles, GEMMA_TERMS_VERSION } from '../src/modelLicenses.ts';
import { modelFolderName } from '../src/modelFolders.ts';
import { readBlob } from '../src/storage.ts';
import apache2License from '../src/licenses/apache2License.ts';
import qwen35License from '../src/licenses/qwen35License.ts';
import qwen3License from '../src/licenses/qwen3License.ts';
import qwen25License from '../src/licenses/qwen25License.ts';
import qwenResearchLicense from '../src/licenses/qwenResearchLicense.ts';
import sparkXLicense from '../src/licenses/sparkXLicense.ts';
import gemmaTerms from '../src/licenses/gemmaTerms.ts';
import gemmaPolicy from '../src/licenses/gemmaPolicy.ts';
import { BROWSER_IMAGE_ENGINE_ASSETS, BROWSER_IMAGE_MODEL_ASSETS, BROWSER_TINY_Q4_ASSETS, BROWSER_TINY_FP16_ASSETS, BROWSER_SDXS_ASSETS, BROWSER_LCM_ASSETS, BROWSER_SUPRA_ASSETS } from '../src/browserImageAssets.ts';
import { SPEECH_MODELS, SPEECH_ENGINE_ASSETS, KOKORO_ENGINE_ASSETS, CHATTERBOX_ENGINE_ASSETS, QWEN_TTS_ENGINE_ASSETS, OPENVOICE_ENGINE_ASSETS } from '../src/speechManifest.ts';
import { TRANSCRIPTION_MODELS, TRANSCRIPTION_ENGINE_ASSETS } from '../src/transcriptionManifest.ts';
import { MOTION_MODELS } from '../src/motionAssets.ts';
import { NEEDLE_ENGINE_ASSETS, NEEDLE_MODEL_ASSETS } from '../src/needleAssets.ts';
import { PRISM_ASSETS } from '../src/prismEngine.ts';
import { WLLAMA_ASSETS } from '../src/wllamaEngine.ts';

const fetchText = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
};
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const requireSameText = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: pinned text changed upstream (${digest(expected)} locally; ${digest(actual)} upstream).`);
};
const expectedTag = { 'Apache 2.0': 'apache-2.0', 'Qwen Research': 'qwen-research' };
const repositories = new Map();
for (const model of MODEL_CATALOG) {
  const url = new URL(model.licenseUrl);
  if (url.hostname !== 'huggingface.co') continue;
  const [owner, name] = url.pathname.split('/').filter(Boolean);
  const repo = `${owner}/${name}`;
  if (repositories.has(repo)) assert.equal(repositories.get(repo), model.license, `${repo} has conflicting catalog labels`);
  repositories.set(repo, model.license);
}
for (const [repo, label] of repositories) {
  const card = JSON.parse(await fetchText(`https://huggingface.co/api/models/${repo}`));
  const observed = card.cardData?.license === 'other' ? card.cardData?.license_name : card.cardData?.license;
  assert.equal(observed, expectedTag[label], `${repo}: catalog license label differs from the publisher's model card`);
}

const pinned = [
  ['Qwen/Qwen3.5-2B', qwen35License],
  ['Qwen/Qwen3-1.7B', qwen3License],
  ['Qwen/Qwen2.5-1.5B-Instruct', qwen25License],
  ['Qwen/Qwen2.5-3B-Instruct', qwenResearchLicense],
];
for (const [repo, local] of pinned) {
  requireSameText(await fetchText(`https://huggingface.co/${repo}/resolve/main/LICENSE`), local, repo);
}
requireSameText(await fetchText('https://www.apache.org/licenses/LICENSE-2.0.txt'), apache2License, 'Apache 2.0');
requireSameText(await fetchText('https://raw.githubusercontent.com/XHToken/Spark-X2.5/main/LICENSE'), sparkXLicense, 'Spark-X2.5');

class MemoryFile {
  kind = 'file';
  constructor(name) { this.name = name; this.blob = new Blob([]); }
  async getFile() { return new File([this.blob], this.name); }
  async createWritable() { return { write: async value => { this.blob = value instanceof Blob ? value : new Blob([value]); }, close: async () => {} }; }
}
class MemoryDirectory {
  kind = 'directory';
  children = new Map();
  async getDirectoryHandle(name, options = {}) {
    let value = this.children.get(name);
    if (!value && options.create) { value = new MemoryDirectory(); this.children.set(name, value); }
    if (!value || value.kind !== 'directory') throw new DOMException('Missing folder', 'NotFoundError');
    return value;
  }
  async getFileHandle(name, options = {}) {
    let value = this.children.get(name);
    if (!value && options.create) { value = new MemoryFile(name); this.children.set(name, value); }
    if (!value || value.kind !== 'file') throw new DOMException('Missing file', 'NotFoundError');
    return value;
  }
}
const folder = new MemoryDirectory();
const bonsaiModels = MODEL_CATALOG.filter(model => model.id === 'bonsai-8b' || model.id.startsWith('bonsai2-'));
const bonsaiRepos = new Set();
for (const model of bonsaiModels) {
  const url = new URL(model.licenseUrl);
  const [owner, name] = url.pathname.split('/').filter(Boolean);
  const repo = `${owner}/${name}`;
  if (bonsaiRepos.has(repo)) continue;
  bonsaiRepos.add(repo);
  await ensureModelLicenseFiles(folder, model.url);
  const sidecar = await (await readBlob(folder, `models/${modelFolderName(model.name)}/NOTICE.txt`)).text();
  requireSameText(await fetchText(`https://huggingface.co/${repo}/resolve/main/NOTICE.txt`), sidecar, `${repo} NOTICE`);
}

const gemmaPages = [
  ['terms', gemmaTerms, ['Gemma is provided under and subject to the Gemma Terms of Use', 'Gemma Prohibited Use Policy']],
  ['prohibited_use_policy', gemmaPolicy, ['You may not use nor allow others to use Gemma or Model Derivatives']],
];
const gemmaDate = html => {
  const match = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').match(/Last modified:\s*(\w+ \d{1,2}, \d{4})/i);
  assert.ok(match, 'Gemma page has no recognizable modification date');
  return new Date(`${match[1]} 00:00:00 GMT`).toISOString().slice(0, 10);
};
const gemmaText = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
for (const [name, local, requiredText] of gemmaPages) {
  const upstream = await fetchText(`https://ai.google.dev/gemma/${name}`);
  assert.equal(gemmaDate(upstream), gemmaDate(local), `Gemma ${name}: upstream date differs from bundled copy; review the terms and refresh the consent gate`);
  for (const phrase of requiredText) {
    assert.ok(gemmaText(upstream).includes(phrase) && gemmaText(local).includes(phrase), `Gemma ${name}: required text changed or is missing from bundled copy`);
  }
  if (name === 'terms') assert.equal(gemmaDate(local), GEMMA_TERMS_VERSION, 'Gemma consent version differs from the bundled terms');
}
const imageGroups = [BROWSER_IMAGE_ENGINE_ASSETS, BROWSER_IMAGE_MODEL_ASSETS, BROWSER_TINY_Q4_ASSETS, BROWSER_TINY_FP16_ASSETS, BROWSER_SDXS_ASSETS, BROWSER_LCM_ASSETS, BROWSER_SUPRA_ASSETS];
const imageLicenseAssets = new Map(imageGroups.flatMap(group => group.filter(asset => /license|notice/i.test(asset.name)).map(asset => [asset.url, asset])));
const speechGroups = [...SPEECH_MODELS.map(model => model.assets), SPEECH_ENGINE_ASSETS, KOKORO_ENGINE_ASSETS, CHATTERBOX_ENGINE_ASSETS, QWEN_TTS_ENGINE_ASSETS, OPENVOICE_ENGINE_ASSETS];
const transcriptionGroups = [...TRANSCRIPTION_MODELS.map(model => model.assets), TRANSCRIPTION_ENGINE_ASSETS];
const otherLicenseAssets = new Map([...speechGroups, ...transcriptionGroups].flatMap(group => group.filter(asset => /license|notice/i.test(asset.name)).map(asset => [asset.url, asset])));
const motionLicenseAssets = new Map(Object.values(MOTION_MODELS).flatMap(model => model.assets.filter(asset => /license|notice/i.test(asset.name)).map(asset => [asset.url, asset])));
const browserEngineLicenseAssets = new Map([NEEDLE_ENGINE_ASSETS, ...Object.values(NEEDLE_MODEL_ASSETS), PRISM_ASSETS, WLLAMA_ASSETS].flatMap(group => group.filter(asset => /licen[sc]e|notice/i.test(asset.name)).map(asset => [asset.url, asset])));
for (const asset of new Map([...imageLicenseAssets, ...otherLicenseAssets, ...motionLicenseAssets, ...browserEngineLicenseAssets]).values()) {
  const bytes = new Uint8Array(await (await fetch(asset.url, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })).arrayBuffer());
  assert.equal(bytes.length, asset.bytes, `${asset.name}: pinned size changed`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `${asset.name}: pinned hash changed`);
}
const imageRepos = new Map([
  ['microsoft/stable-diffusion-v1.5-webnn', 'creativeml-openrail-m'],
  ['cursedhelm/aderpy-deepdreamer-onnx', 'creativeml-openrail-m'],
  ['skillsafeai/sdxs-512-dreamshaper-onnx-webgpu', 'openrail++'],
  ['skillsafeai/dreamshaper-8-lcm-onnx-webgpu', 'creativeml-openrail-m'],
  ['mikhsol/Supra2-IMG-mobile-onnx', 'apache-2.0'],
]);
for (const [repo, expected] of imageRepos) {
  const card = JSON.parse(await fetchText(`https://huggingface.co/api/models/${repo}`));
  assert.equal(card.cardData?.license, expected, `${repo}: image catalog license differs from publisher metadata`);
}
const mediaRepos = new Map([
  ['vlapky/pocket-tts-onnx', 'cc-by-4.0'],
  ['onnx-community/Kokoro-82M-v1.0-ONNX', 'apache-2.0'],
  ['onnx-community/chatterbox-ONNX', 'mit'],
  ['ResembleAI/chatterbox-turbo-ONNX', 'mit'],
  ['TigreGotico/voiceclonnx-openvoice-v2', 'mit'],
  ['Xenova/whisper-tiny.en', 'apache-2.0'],
  ['onnx-community/moonshine-tiny-ONNX', 'mit'],
  ['onnx-community/moonshine-base-ONNX', 'mit'],
]);
for (const [repo, expected] of mediaRepos) {
  const card = JSON.parse(await fetchText(`https://huggingface.co/api/models/${repo}`));
  assert.equal(card.cardData?.license, expected, `${repo}: media catalog license differs from publisher metadata`);
}
const motionRepos = new Map([
  ['onnx-community/depth-anything-v2-small', 'apache-2.0'],
  ['edgetools/rife', 'mit'],
  ['cgb/triposr-onnx-webgpu', 'mit'],
]);
for (const [repo, expected] of motionRepos) {
  const card = JSON.parse(await fetchText(`https://huggingface.co/api/models/${repo}`));
  assert.equal(card.cardData?.license, expected, `${repo}: motion catalog license differs from publisher metadata`);
}
console.log(`Upstream model license audit passed: ${repositories.size} text-model repositories, ${pinned.length} Qwen licenses, ${bonsaiRepos.size} Bonsai notices, ${imageRepos.size} image-model repositories and ${imageLicenseAssets.size} image license/notice files, ${mediaRepos.size} speech/transcription repositories and ${otherLicenseAssets.size} license/notice files, ${motionRepos.size} motion/3D repositories and ${motionLicenseAssets.size} license files, ${browserEngineLicenseAssets.size} browser-engine/Needle license files, Apache 2.0, Spark-X2.5, and Gemma page dates/required text.`);
console.log('Gemma terms still require manual review for same-date edits and legal meaning; unlabelled derivative model cards, use obligations, and other optional model types also require manual review.');
