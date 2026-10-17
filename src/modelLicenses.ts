import { MODEL_CATALOG, type CatalogModel } from './catalogModels.ts';
import { readBlob, writeBlob } from './storage.ts';
import apache2License from './licenses/apache2License.ts';
import qwen35License from './licenses/qwen35License.ts';
import qwen3License from './licenses/qwen3License.ts';
import qwen25License from './licenses/qwen25License.ts';
import qwenResearchLicense from './licenses/qwenResearchLicense.ts';
import gemmaTerms from './licenses/gemmaTerms.ts';
import gemmaPolicy from './licenses/gemmaPolicy.ts';
import { modelFolderName } from './modelFolders.ts';

type LicenseFile = { suffix: string; content: string; type: string };
const plain = (suffix: string, content: string): LicenseFile => ({ suffix, content, type: 'text/plain' });
const html = (suffix: string, content: string): LicenseFile => ({ suffix, content, type: 'text/html' });
const qwenNotice = 'Qwen is licensed under the Qwen RESEARCH LICENSE AGREEMENT, Copyright (c) Alibaba Cloud. All Rights Reserved.\n';
const gemmaNotice = 'Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms\n';
const bonsaiNotice = 'This software is copyright 2026-present Prism ML, Inc. It is available under the Apache 2.0 license.\r\nIf you publicly deploy or redistribute this software, we would appreciate attribution such as: “Created using Bonsai by Prism ML."\r\n\r\nThis software is built from Qwen3-8B, Copyright 2024 Alibaba Cloud, which is available under the Apache 2.0 License: https://huggingface.co/Qwen/Qwen3-8B/blob/main/LICENSE';
const bonsai2Notice = (size: '2B' | '4B' | '9B') =>
  `This software is copyright 2026-present Prism ML, Inc. It is available under the Apache 2.0 license.\nIf you publicly deploy or redistribute this software, we would appreciate attribution such as: "Created using Bonsai by Prism ML."\n\nThis software is built from Qwen3.5-${size}, Copyright 2026 Alibaba Cloud, which is available under the Apache 2.0 License: https://huggingface.co/Qwen/Qwen3.5-${size}/blob/main/LICENSE\n${size === '2B' ? '' : `The DFlash draft model is built from z-lab/Qwen3.5-${size}-DFlash, Copyright 2026 Z Lab and Modal, which is available under the Apache 2.0 License: https://huggingface.co/z-lab/Qwen3.5-${size}-DFlash\n`}`;

function filesFor(model: CatalogModel): LicenseFile[] {
  const license = model.id === 'qwen35-2b' ? qwen35License
    : model.id === 'qwen3-17b' ? qwen3License
    : model.id === 'qwen25-15b' ? qwen25License
    : model.id === 'qwen25-3b' ? qwenResearchLicense : apache2License;
  const files = model.id === 'gemma3-1b'
    ? [html('.LICENSE.html', gemmaTerms), html('.PROHIBITED-USE.html', gemmaPolicy), plain('.NOTICE.txt', gemmaNotice)]
    : [plain('.LICENSE.txt', license)];
  if (model.id === 'qwen25-3b') files.push(plain('.NOTICE.txt', qwenNotice));
  if (model.id === 'bonsai-8b') files.push(plain('.NOTICE.txt', bonsaiNotice));
  if (model.id.startsWith('bonsai2-')) {
    const size = model.name.match(/Ternary-Bonsai-2-(2B|4B|9B)-/)?.[1] as '2B' | '4B' | '9B' | undefined;
    if (size) files.push(plain('.NOTICE.txt', bonsai2Notice(size)));
  }
  files.push(plain('.SOURCE.txt', `${model.label}\nGGUF file: ${model.source}\nBase model/license: ${model.licenseUrl}\n`));
  return files;
}

async function ensureTextFile(folder: FileSystemDirectoryHandle, path: string, file: LicenseFile) {
  try { if (await (await readBlob(folder, path)).text() === file.content) return; }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  await writeBlob(folder, path, new Blob([file.content], { type: file.type }));
}
const sidecarPath = (name: string, suffix: string) => `models/${modelFolderName(name)}/${MODEL_CATALOG.some(model => model.visionProjector?.name === name) ? 'PROJECTOR-' : ''}${suffix.slice(1)}`;
async function readSidecar(folder: FileSystemDirectoryHandle, name: string, suffix: string) {
  try { return await readBlob(folder, sidecarPath(name, suffix)); }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  return readBlob(folder, `models/${name}${suffix}`);
}

export const catalogModelForPath = (path: string) => MODEL_CATALOG.find(model => path === `models/${model.name}`);
export const catalogModelForUrl = (url: string) => MODEL_CATALOG.find(model => url === model.url);
export const visionProjectorDownloadUrl = (model: CatalogModel) => model.visionProjector?.source.replace('/blob/', '/resolve/') || '';
export const catalogModelsForProjectorUrl = (url: string) => MODEL_CATALOG.filter(model => model.visionProjector && visionProjectorDownloadUrl(model) === url);
export const isCatalogVisionProjector = (name: string) => /(?:^|[-_.])mmproj(?:[-_.]|$)/i.test(name) || MODEL_CATALOG.some(model => model.visionProjector?.name === name);

export async function ensureVisionProjectorLicenseFiles(folder: FileSystemDirectoryHandle, model: CatalogModel) {
  if (!model.visionProjector) throw new Error('This model has no configured vision projector.');
  await assertModelLicenseFiles(folder, `models/${model.name}`);
  const baseLicense = await (await readSidecar(folder, model.name, '.LICENSE.txt')).text();
  await ensureTextFile(folder, sidecarPath(model.visionProjector.name, '.LICENSE.txt'), plain('.LICENSE.txt', baseLicense));
  await ensureTextFile(folder, sidecarPath(model.visionProjector.name, '.SOURCE.txt'), plain('.SOURCE.txt', `${model.label} vision projector\nGGUF file: ${model.visionProjector.source}\nBase model/license: ${model.licenseUrl}\n`));
}

export async function assertVisionProjectorLicenseFiles(folder: FileSystemDirectoryHandle, model: CatalogModel) {
  if (!model.visionProjector) throw new Error('This model has no configured vision projector.');
  const baseLicense = await (await readSidecar(folder, model.name, '.LICENSE.txt')).text();
  const projectorLicense = await (await readSidecar(folder, model.visionProjector.name, '.LICENSE.txt')).text();
  if (projectorLicense !== baseLicense) throw new Error('The vision projector license is missing or changed. Save its catalog license files before loading.');
  const source = await (await readSidecar(folder, model.visionProjector.name, '.SOURCE.txt')).text();
  if (!source.includes(model.visionProjector.source)) throw new Error('The vision projector source file is missing or changed.');
}

// Called before the first GGUF byte is fetched, and again when completing or skipping a download.
export async function ensureModelLicenseFiles(folder: FileSystemDirectoryHandle, url: string) {
  const model = catalogModelForUrl(url);
  if (!model) {
    const projectorModels = catalogModelsForProjectorUrl(url);
    if (projectorModels.length) {
      for (const candidate of projectorModels) {
        try { await assertModelLicenseFiles(folder, `models/${candidate.name}`); await ensureVisionProjectorLicenseFiles(folder, candidate); return; }
        catch { /* Another packing of this model may be the one installed here. */ }
      }
      throw new Error('Download a matching licensed model before its vision projector.');
    }
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    await assertModelLicenseFiles(folder, `models/${name}`);
    return;
  }
  if (model.id === 'gemma3-1b' && !hasGemmaConsent()) throw new Error('Accept the Gemma Terms in AI profiles before downloading this model.');
  if (model.id === 'qwen25-3b' && !hasQwenResearchConsent()) throw new Error('Acknowledge the Qwen Research License in AI profiles before downloading this model.');
  for (const file of filesFor(model)) await ensureTextFile(folder, sidecarPath(model.name, file.suffix), file);
}

// Also called before every inference so removing a sidecar disables an already loaded model.
export async function assertModelLicenseFiles(folder: FileSystemDirectoryHandle, path: string) {
  const model = catalogModelForPath(path);
  if (!model) {
    const name = path.split('/').pop() || '';
    try {
      const file = await readSidecar(folder, name, '.LICENSE.txt');
      if ((await file.text()).trim()) return;
    } catch { /* Fall through to a clear custom-model message. */ }
    throw new Error(`Add LICENSE.txt alongside ${name} before downloading or loading it.`);
  }
  for (const file of filesFor(model)) {
    const sidecar = sidecarPath(model.name, file.suffix);
    try {
      if (await (await readSidecar(folder, model.name, file.suffix)).text() === file.content) continue;
    } catch { /* A missing or inaccessible file fails the gate. */ }
    throw new Error(`Required model license file is missing or changed: ${sidecar}. Save the catalog license files before loading.`);
  }
}

export const GEMMA_TERMS_VERSION = '2026-04-01';
const GEMMA_CONSENT_KEY = `gemma-terms-accepted-${GEMMA_TERMS_VERSION}`;
const QWEN_RESEARCH_CONSENT_KEY = 'qwen-research-accepted-2024-09-19';
export function hasGemmaConsent() {
  try { return localStorage.getItem(GEMMA_CONSENT_KEY) === 'yes'; }
  catch { return false; }
}
export function acceptGemmaConsent() {
  localStorage.setItem(GEMMA_CONSENT_KEY, 'yes');
}
export function hasQwenResearchConsent() {
  try { return localStorage.getItem(QWEN_RESEARCH_CONSENT_KEY) === 'yes'; }
  catch { return false; }
}
export function acceptQwenResearchConsent() {
  localStorage.setItem(QWEN_RESEARCH_CONSENT_KEY, 'yes');
}
