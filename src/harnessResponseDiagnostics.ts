import type { AIConfig, ChatTurn, Completion, InferenceRound } from './ai.ts';
import type { ModelStamp } from './harnessData.ts';

export type ResponseDiagnostic = {
  version: 1 | 2;
  createdAt: string;
  model: ModelStamp;
  input: { system: string; turns: ChatTurn[]; note: string };
  output: { text: string; thinking: string | null; toolEvents: string[] };
  rounds?: InferenceRound[];
  usage: { inputTokens: number | null; outputTokens: number | null; elapsedMs: number; observedTokensPerSecond: number | null };
  sampling: { seed: number | null; temperature: number | null; note: string };
};

/** Keep credentials out of downloadable reports. Absent runtime settings stay unknown. */
export function responseDiagnostic(config: AIConfig, stamp: ModelStamp, prompt: { system: string; turns: ChatTurn[] }, completion: Completion, elapsedMs: number, observedTokensPerSecond?: number): ResponseDiagnostic {
  const bonsai = config.provider === 'compatible' && config.runtimePreset === 'bonsai2';
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    model: stamp,
    input: { ...prompt, note: 'Initial submitted prompt. Every subsequent model request is recorded in Model rounds.' },
    output: { text: completion.text, thinking: completion.thinkingText?.trim() || null, toolEvents: completion.toolEvents || [] },
    rounds: completion.rounds || [],
    usage: {
      inputTokens: completion.inputTokens ?? null,
      outputTokens: completion.outputTokens ?? null,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      observedTokensPerSecond: observedTokensPerSecond && Number.isFinite(observedTokensPerSecond) ? Math.round(observedTokensPerSecond * 10) / 10 : null,
    },
    sampling: {
      seed: null,
      temperature: bonsai ? config.thinkingTokens > 0 ? 1 : .7 : null,
      note: bonsai ? 'Bonsai 2 server preset; seed is not set by this app.' : 'Seed and temperature are not set by this app; the model runtime chooses its defaults.',
    },
  };
}
