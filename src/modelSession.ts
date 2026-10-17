import { complete, type AIConfig } from './ai';
import { getBrowserModelStatus, quickBrowserModelCheck } from './browserModel';
import { browserThinkingBudget, browserThinkingMode } from './browserThinking';
import { browserContextWindow } from './browserContext';
export type ModelSession = { state: 'untested' | 'testing' | 'ready' | 'failed'; fingerprint: string; message: string };
let status: ModelSession = { state: 'untested', fingerprint: '', message: 'Test this model before using AI features.' };
let testSequence = 0;
const readyFingerprints = new Set<string>();
const listeners = new Set<() => void>();
const publish = (value: ModelSession) => { status = value; listeners.forEach(listener => listener()); };
export const getModelSession = () => status;
export const subscribeModelSession = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
// The key is held only in memory and is never serialized or shown in the UI.
export const modelFingerprint = (config: AIConfig) => [config.id, config.provider, config.model, config.endpoint, config.provider === 'browser' ? browserContextWindow(config.model, config.contextWindow) : config.contextWindow, config.runtimePreset,
  config.provider === 'browser' ? browserThinkingBudget(config) : config.maxOutputTokens,
  config.effort, config.provider === 'browser' ? browserThinkingMode(config) : config.thinkingTokens, config.apiKey].join('\u0000');
export const isModelReady = (config: AIConfig) => {
  if (!readyFingerprints.has(modelFingerprint(config))) return false;
  if (config.provider === 'browser') {
    const browser = getBrowserModelStatus();
    return browser.state === 'ready' && browser.path === config.model && browser.contextWindow === browserContextWindow(config.model, config.contextWindow) && (browser.thinkingBudgetTokens ?? 0) === browserThinkingBudget(config);
  }
  return true;
};
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
