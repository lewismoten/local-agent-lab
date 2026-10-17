import type { AIConfig } from './ai';
import { catalogModelForPath } from './modelLicenses.ts';

export type BrowserThinkingMode = 'none' | 'light' | 'medium' | 'heavy';

const shares: Record<BrowserThinkingMode, number> = { none: 0, light: 0.25, medium: 0.5, heavy: 0.75 };

export function browserOutputSliderExponent(tokens: number): number {
  const requested = Number.isFinite(tokens) && tokens > 0 ? tokens : 512;
  return Math.max(7, Math.min(14, Math.round(Math.log2(requested))));
}

export function supportsBrowserThinking(config: AIConfig): boolean {
  // The profile can request a thinking mode even when browser support is not
  // confirmed yet. Diagnostics determine what the selected GGUF actually does.
  return config.provider === 'browser';
}

export function browserThinkingMode(config: AIConfig): BrowserThinkingMode {
  if (!supportsBrowserThinking(config)) return 'none';
  if (config.browserThinkingMode) return config.browserThinkingMode;
  // Older saved browser profiles stored an absolute token cap. Keep the
  // closest preset when first opening them after this setting changes.
  if (!config.thinkingTokens) return 'none';
  const share = config.thinkingTokens / Math.max(1, config.maxOutputTokens);
  return share < 0.375 ? 'light' : share < 0.625 ? 'medium' : 'heavy';
}

export function browserThinkingBudget(config: AIConfig): number {
  return Math.floor(Math.max(128, config.maxOutputTokens) * shares[browserThinkingMode(config)]);
}

export function browserThinkingOptions(config: AIConfig): { chat_template_kwargs: { enable_thinking: boolean } } | Record<string, never> {
  if (config.provider !== 'browser' || !supportsBrowserThinking(config)) return {};
  const enabled = browserThinkingMode(config) !== 'none';
  if (!enabled && catalogModelForPath(config.model)?.thinking !== 'documented') return {};
  return { chat_template_kwargs: { enable_thinking: enabled } };
}
