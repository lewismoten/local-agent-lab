import { completeMetadata, type AIConfig } from './ai.ts';
import { withModelLease } from './harnessLease.ts';
import type { CustomTheme } from './customTheme.ts';
import { applyThemeStage, repairThemeContrast, themeStageRequest, type ThemeStage } from './themeGeneration.ts';

/** Keep a single model slot while repairing a malformed or unreadable proposal. */
export function generateThemeProposal(config: AIConfig, stage: ThemeStage, draft: CustomTheme, signal: AbortSignal): Promise<{ text: string; note?: string }> {
  return withModelLease(`theme:${stage}`, async () => {
    const request = themeStageRequest(stage, draft);
    let user = request.user;
    let lastError: Error | null = null;
    let lastResponse = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw signal.reason || new DOMException('Stopped.', 'AbortError');
      const response = await completeMetadata(config, [{ role: 'user', content: user }], request.system, signal, 384);
      lastResponse = response.text;
      try { applyThemeStage(stage, draft, response.text); return { text: response.text }; }
      catch (cause) {
        lastError = cause instanceof Error ? cause : new Error(String(cause));
        user = `${request.user}\nYour previous JSON failed validation: ${lastError.message}\nPrevious JSON: ${response.text.slice(0, 900)}\nReturn one corrected JSON object only. For dark surfaces, use light text and muted text.`;
      }
    }
    if (stage === 'colors') {
      const repaired = repairThemeContrast(draft, lastResponse);
      if (repaired) return { text: repaired, note: 'Some colors were adjusted to keep text readable.' };
    }
    throw lastError || new Error('The model did not produce a valid theme proposal.');
  }, signal);
}
