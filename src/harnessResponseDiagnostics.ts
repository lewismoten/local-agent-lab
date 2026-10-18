import type { AIConfig, ChatTurn, Completion, InferenceRound } from './ai.ts';
import type { ModelStamp } from './harnessData.ts';

export type ResponseDiagnostic = {
  version: 1 | 2;
  createdAt: string;
  model: ModelStamp;
  input: { system: string; turns: ChatTurn[]; note: string };
  output: { text: string; thinking: string | null; toolEvents: string[] };
  rounds?: InferenceRound[];
  usage: { inputTokens: number | null; cachedInputTokens?: number | null; outputTokens: number | null; elapsedMs: number; observedTokensPerSecond: number | null };
  sampling: { seed: number | null; temperature: number | null; note: string };
};

function submittedNumber(rounds: InferenceRound[] | undefined, key: 'seed' | 'temperature'): number | null {
  const values = rounds?.map(round => round.request[key]);
  if (!values?.length || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return values.every(value => value === values[0]) ? values[0] as number : null;
}

/** Keep credentials out of downloadable reports. Absent runtime settings stay unknown. */
export function responseDiagnostic(_config: AIConfig, stamp: ModelStamp, prompt: { system: string; turns: ChatTurn[] }, completion: Completion, elapsedMs: number, observedTokensPerSecond?: number): ResponseDiagnostic {
  const seed = submittedNumber(completion.rounds, 'seed');
  const temperature = submittedNumber(completion.rounds, 'temperature');
  const varied = (['seed', 'temperature'] as const).filter(key => {
    const values = completion.rounds?.map(round => round.request[key]);
    return values && values.length > 1 && values.some(value => value !== values[0]);
  });
  const cachedRounds = completion.rounds?.map(round => round.response.cachedInputTokens);
  const cachedInputTokens = cachedRounds?.length && cachedRounds.every(value => typeof value === 'number' && Number.isFinite(value))
    ? cachedRounds.reduce<number>((total, value) => total + (value || 0), 0) : null;
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    model: stamp,
    input: { ...prompt, note: 'Initial submitted prompt. Every subsequent model request is recorded in Model rounds.' },
    output: { text: completion.text, thinking: completion.thinkingText?.trim() || null, toolEvents: completion.toolEvents || [] },
    rounds: completion.rounds || [],
    usage: {
      inputTokens: completion.inputTokens ?? null,
      cachedInputTokens,
      outputTokens: completion.outputTokens ?? null,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      observedTokensPerSecond: observedTokensPerSecond && Number.isFinite(observedTokensPerSecond) ? Math.round(observedTokensPerSecond * 10) / 10 : null,
    },
    sampling: {
      seed,
      temperature,
      note: varied.length
        ? `${varied.join(' and ')} varied between model rounds. See each request below for the submitted values.`
        : 'Values shown here were submitted in every model round. An omitted value uses the model runtime default.',
    },
  };
}
