import { complete, type AIConfig } from './ai';
import { getBrowserModelStatus, isBrowserModelLoadedFrom, loadBrowserModel, quickBrowserModelCheck, unloadBrowserModel } from './browserModel';
import { browserThinkingBudget } from './browserThinking';
import { browserContextWindow } from './browserContext';
import { profileConfirmationKey } from './harnessProfileEligibility';
import { assertModelLicenseFiles } from './modelLicenses';
import { isBonsai2BrowserUnsupported } from './modelCompatibility';
import { assertPrismEngineFiles } from './prismEngine';
import { assertWllamaEngineFiles } from './wllamaEngine';
export type ModelSession = { state: 'untested' | 'testing' | 'ready' | 'failed'; fingerprint: string; message: string };
let status: ModelSession = { state: 'untested', fingerprint: '', message: 'Test this model before using AI features.' };
let testSequence = 0;
const readyFingerprints = new Set<string>();
const listeners = new Set<() => void>();
const publish = (value: ModelSession) => { status = value; listeners.forEach(listener => listener()); };
export const getModelSession = () => status;
export const subscribeModelSession = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
// The key is held only in memory and is never serialized or shown in the UI.
// Output, context, and thinking changes apply on the next request without
// requiring another connection test. Browser loading still checks those settings.
export const modelFingerprint = profileConfirmationKey;
/** A successful check remains valid until the workspace changes or this page closes. */
export const isModelConfirmed = (config: AIConfig) => readyFingerprints.has(modelFingerprint(config));
export const isModelReady = (config: AIConfig) => {
  if (!isModelConfirmed(config)) return false;
  if (config.provider === 'browser') {
    const browser = getBrowserModelStatus();
    return browser.state === 'ready' && browser.path === config.model && browser.contextWindow === browserContextWindow(config.model, config.contextWindow) && (browser.thinkingBudgetTokens ?? 0) === browserThinkingBudget(config);
  }
  return true;
};
/** Call while holding the shared model lease. A prior check in this tab remains valid after a temporary unload. */
export async function ensureBrowserModelReady(config: AIConfig, folder: FileSystemDirectoryHandle): Promise<void> {
  if (config.provider !== 'browser' || !config.model.trim()) throw new Error('Choose a browser model first.');
  try {
    await assertModelLicenseFiles(folder, config.model);
    if (isBonsai2BrowserUnsupported(config.model)) await assertPrismEngineFiles(folder);
    else await assertWllamaEngineFiles(folder);
    if (!isBrowserModelLoadedFrom(folder, config.model, config.contextWindow, browserThinkingBudget(config))) {
      await loadBrowserModel(folder, config.model, config.contextWindow, browserThinkingBudget(config));
    }
    if (!isModelReady(config)) await testModel(config);
  } catch (error) {
    readyFingerprints.delete(modelFingerprint(config));
    publish({ state: 'failed', fingerprint: modelFingerprint(config), message: error instanceof Error ? error.message : String(error) });
    await unloadBrowserModel().catch(() => {});
    throw error;
  }
}
export async function testModel(config: AIConfig) {
  const sequence = ++testSequence;
  const fingerprint = modelFingerprint(config);
  if (!config.model.trim()) { publish({ state: 'failed', fingerprint, message: 'Choose a model first.' }); throw new Error('Choose a model first.'); }
  publish({ state: 'testing', fingerprint, message: `Testing ${config.model}…` });
  try {
    const result = config.provider === 'browser'
      ? await quickBrowserModelCheck(config)
      : await complete(config.runtimePreset === 'bonsai2'
        ? { ...config, thinkingTokens: 0, maxOutputTokens: 64 }
        : { ...config, maxOutputTokens: Math.min(Math.max(config.maxOutputTokens, 512), 1024) },
      [{ role: 'user', content: 'Reply with one short word: ready.' }], 'This is a connection test. Reply with one short word.');
    if (!result.text.trim()) throw new Error('The model returned no text.');
    readyFingerprints.add(fingerprint);
    if (sequence === testSequence) publish({ state: 'ready', fingerprint, message: `${config.model} responded in this browser session.` });
    return result.text.trim();
  } catch (error) {
    readyFingerprints.delete(fingerprint);
    if (sequence === testSequence) publish({ state: 'failed', fingerprint, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
export function invalidateModelSession() { testSequence++; readyFingerprints.clear(); publish({ state: 'untested', fingerprint: '', message: 'Test this model before using AI features.' }); }
