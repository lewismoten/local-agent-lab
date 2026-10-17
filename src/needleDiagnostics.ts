import { NEEDLE_LABELS, NEEDLE_MODEL_ASSETS, NEEDLE_MODEL_PATHS, assertNeedleFiles, readNeedleWeight, type NeedleVersion } from './needleAssets.ts';
import { loadNeedle, runNeedle } from './needleRuntime.ts';
import { recordCapability, type CapabilityResult } from './capabilityLedger.ts';
import { diagnosticReportPath, saveDiagnosticJson } from './diagnosticReports.ts';

export const NEEDLE_TESTS = ['fileSize', 'license', 'text', 'tools', 'reasoningTask', 'thinking'] as const;
export const NEEDLE_SCORING_VERSION = 3;
export type NeedleTestKey = typeof NEEDLE_TESTS[number];
export type NeedleTestResult = { result: CapabilityResult; detail: string; argumentAccuracy?: 'passed' | 'failed'; input?: { query: string; tools: unknown }; output?: string; error?: string };
export type NeedleReport = { file: string; checkedAt: string; runtime: 'Needle browser engine'; tests: Partial<Record<NeedleTestKey, NeedleTestResult>>; savedPath?: string; error?: string; scoringVersion?: number; rescoredAt?: string; originalScores?: Partial<Record<NeedleTestKey, { result: CapabilityResult; detail: string }>> };
const failIfStopped = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Tests stopped.', 'AbortError'); };
const resultText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
export const needleToolCalls = (output: string): { name?: string; arguments?: Record<string, unknown> }[] => {
  const withoutThinking = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const tagged = [...withoutThinking.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)].map(match => match[1]);
  const payloads = tagged.length ? tagged : [withoutThinking];
  return payloads.flatMap(payload => {
    try {
    const parsed = JSON.parse(payload) as unknown;
    let calls: unknown[] = [];
    if (Array.isArray(parsed)) calls = parsed;
    if (parsed && typeof parsed === 'object') {
      const object = parsed as Record<string, unknown>;
      for (const key of ['function_calls', 'tool_calls', 'calls']) if (Array.isArray(object[key])) { calls = object[key] as unknown[]; break; }
      if (!calls.length && (typeof object.name === 'string' || typeof object.tool === 'string' || typeof object.tool_name === 'string' || typeof object.function === 'string')) calls = [object];
    }
    return calls.filter(value => !!value && typeof value === 'object').map(value => {
      const call = value as Record<string, unknown>;
      const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : call;
      let args = fn.arguments ?? fn.parameters ?? fn.args ?? fn.input;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = undefined; } }
      return { name: String(fn.name ?? call.tool ?? call.tool_name ?? call.function ?? ''), arguments: args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : undefined };
    });
    } catch { return []; }
  });
};
export function needleVisibleText(output: string): string {
  const visible = output.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
  try {
    const parsed = JSON.parse(visible) as unknown;
    if (parsed && typeof parsed === 'object') return '';
  } catch { /* Plain text is visible. */ }
  return visible;
}
export function scoreNeedleText(output: string): NeedleTestResult {
  const visible = needleVisibleText(output);
  return { result: visible ? 'passed' : 'inconclusive', detail: visible ? 'Visible text returned.' : 'No plain chat response; this model is specialized for tool routing.' };
}
export function scoreNeedleToolCall(output: string): NeedleTestResult {
  const calls = needleToolCalls(output);
  if (!calls.length) return { result: 'inconclusive', detail: 'No structured save_character call returned.' };
  const call = calls.find(item => item.name === 'save_character');
  if (!call) return { result: 'failed', detail: `Expected save_character; received ${calls.map(item => item.name || 'an unnamed call').join(', ')}.` };
  if (!call.arguments) return { result: 'failed', detail: 'save_character returned without structured arguments.' };
  const name = call?.arguments?.name;
  const role = call?.arguments?.role;
  const exact = calls.length === 1 && typeof name === 'string' && name.trim().toLowerCase() === 'mira' && typeof role === 'string' && role.trim().toLowerCase() === 'protagonist';
  return { result: 'passed', argumentAccuracy: exact ? 'passed' : 'failed', detail: exact ? 'Structured save_character call returned with correct arguments.' : `Structured save_character call returned. Argument check failed: name ${JSON.stringify(name)}, role ${JSON.stringify(role)}; expected Mira and protagonist${calls.length > 1 ? `, with one call rather than ${calls.length}` : ''}.` };
}
export function scoreNeedleReasoningTask(output: string): NeedleTestResult {
  const calls = needleToolCalls(output);
  if (!calls.length) return { result: 'inconclusive', detail: 'No submit_answer tool call returned.' };
  if (calls.length !== 1) return { result: 'failed', detail: `Expected one submit_answer call; received ${calls.length}.` };
  const call = calls[0];
  if (call.name !== 'submit_answer') return { result: 'failed', detail: `Expected submit_answer; received ${call.name || 'an unnamed call'}.` };
  const minutes = call.arguments?.minutes;
  return { result: minutes === 5 ? 'passed' : 'failed', detail: `Submitted ${JSON.stringify(minutes)} minutes; expected 5.` };
}
const reasoningText = (output: string) => {
  const tagged = output.match(/<think>([\s\S]*?)<\/think>/i)?.[1]?.trim();
  if (tagged) return tagged;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return resultText(parsed.reasoning || parsed.thinking || parsed.reasoning_content || '');
  } catch { return ''; }
};
export function scoreNeedleThinking(output: string): NeedleTestResult {
  const trace = reasoningText(output);
  return { result: trace ? 'passed' : 'inconclusive', detail: trace ? 'A separate reasoning segment was returned.' : 'No separate reasoning segment was returned.' };
}
export function rescoreNeedleReport(report: NeedleReport): NeedleReport {
  if (report.scoringVersion === NEEDLE_SCORING_VERSION) return report;
  const scorers = { text: scoreNeedleText, tools: scoreNeedleToolCall, reasoningTask: scoreNeedleReasoningTask, thinking: scoreNeedleThinking };
  const tests = { ...report.tests };
  const originalScores = { ...report.originalScores };
  let changed = false;
  for (const key of Object.keys(scorers) as (keyof typeof scorers)[]) {
    const previous = tests[key];
    if (!previous || typeof previous.output !== 'string' || previous.error) continue;
    const score = scorers[key](previous.output);
    if (score.result !== previous.result || score.detail !== previous.detail || score.argumentAccuracy !== previous.argumentAccuracy) {
      originalScores[key] = { result: previous.result, detail: previous.detail };
      tests[key] = { ...previous, ...score };
      changed = true;
    }
  }
  return { ...report, tests, scoringVersion: NEEDLE_SCORING_VERSION, ...(changed ? { rescoredAt: new Date().toISOString(), originalScores } : {}) };
}

export async function runNeedleDiagnostics(folder: FileSystemDirectoryHandle, version: NeedleVersion, onProgress?: (finished: number, total: number, key: NeedleTestKey, report: NeedleReport) => void, signal?: AbortSignal): Promise<NeedleReport> {
  const path = NEEDLE_MODEL_PATHS[version];
  const weight = NEEDLE_MODEL_ASSETS[version][1];
  const report: NeedleReport = { file: path, checkedAt: new Date().toISOString(), runtime: 'Needle browser engine', scoringVersion: NEEDLE_SCORING_VERSION, tests: {} };
  let finished = 0;
  async function record(key: NeedleTestKey, result: NeedleTestResult) {
    report.tests[key] = result;
    await recordCapability(folder, path, NEEDLE_LABELS[version], key, result.result, result.detail, weight.bytes);
    onProgress?.(++finished, NEEDLE_TESTS.length, key, { ...report, tests: { ...report.tests } });
  }
  async function probe(key: NeedleTestKey, query: string, tools: unknown, score: (output: string) => NeedleTestResult) {
    failIfStopped(signal);
    const input = { query, tools };
    try {
      const output = await runNeedle(folder, version, query, JSON.stringify(tools));
      await record(key, { ...score(output), input, output });
    } catch (error) {
      await record(key, { result: 'inconclusive', detail: error instanceof Error ? error.message : String(error), input, error: String(error) });
    }
  }
  failIfStopped(signal);
  const file = await readNeedleWeight(folder, version);
  await record('fileSize', { result: file.size === weight.bytes ? 'passed' : 'failed', detail: `${file.size} bytes measured; ${weight.bytes} bytes expected` });
  failIfStopped(signal);
  try {
    await assertNeedleFiles(folder, version);
    await record('license', { result: 'passed', detail: 'Model and engine license files verified.' });
  } catch (error) {
    await record('license', { result: 'failed', detail: error instanceof Error ? error.message : String(error) });
    report.error = error instanceof Error ? error.message : String(error);
    report.savedPath = diagnosticReportPath(path, report.checkedAt, 'text');
    await saveDiagnosticJson(folder, path, report.checkedAt, 'text', report);
    return report;
  }
  try { await loadNeedle(folder, version); }
  catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.savedPath = diagnosticReportPath(path, report.checkedAt, 'text');
    await saveDiagnosticJson(folder, path, report.checkedAt, 'text', report);
    return report;
  }
  await probe('text', 'Reply with one word: ready.', [], scoreNeedleText);
  const characterTool = [{ name: 'save_character', description: 'Save a named character.', parameters: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' } }, required: ['name', 'role'] } }];
  await probe('tools', 'Save a character named Mira as the protagonist.', characterTool, scoreNeedleToolCall);
  const answerTool = [{ name: 'submit_answer', description: 'Return the number of minutes.', parameters: { type: 'object', properties: { minutes: { type: 'number' } }, required: ['minutes'] } }];
  await probe('reasoningTask', 'If 5 machines take 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets? Use submit_answer with the number of minutes.', answerTool, scoreNeedleReasoningTask);
  await probe('thinking', 'A stranger offers Mira a shortcut but will not say where it leads. Briefly weigh one benefit and one risk, then call submit_answer with minutes set to 5.', answerTool, scoreNeedleThinking);
  report.savedPath = diagnosticReportPath(path, report.checkedAt, 'text');
  await saveDiagnosticJson(folder, path, report.checkedAt, 'text', report);
  return report;
}
