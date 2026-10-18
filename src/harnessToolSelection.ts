import type { ChatCompletionTool } from './browserEngineTypes.ts';
import type { ChatTurn } from './ai.ts';
import { isBriefFollowUp } from './harnessFollowUp.ts';

const TOKEN_CHARS = 4;
export const toolSchemaTokens = (definitions: ChatCompletionTool[]): number => definitions.length ? Math.ceil(JSON.stringify(definitions).length / TOKEN_CHARS) : 0;

/** Retain function guidance and parameter structure, but save tiny contexts from repeated field descriptions. */
function compactToolDefinition(definition: ChatCompletionTool): ChatCompletionTool {
  return {
    ...definition,
    function: {
      ...definition.function,
      parameters: JSON.parse(JSON.stringify(definition.function.parameters, (key, value) => key === 'description' ? undefined : value)),
    },
  };
}

/** A brief approval refers to the task just discussed, including tools the assistant proposed. */
export function harnessToolIntent(turns: Pick<ChatTurn, 'role' | 'content'>[], archivedHint = ''): string {
  let latestIndex = turns.length - 1;
  while (latestIndex >= 0 && turns[latestIndex].role !== 'user') latestIndex--;
  if (latestIndex < 0) return '';
  const latest = turns[latestIndex].content.trim();
  if (!isBriefFollowUp(latest)) return latest;
  const recent = turns.slice(Math.max(0, latestIndex - 8), latestIndex);
  const previousUser = [...recent].reverse().find(turn => turn.role === 'user' && !isBriefFollowUp(turn.content));
  const assistant = [...recent].reverse().find(turn => turn.role === 'assistant');
  return [latest, previousUser?.content.slice(0, 1800), assistant?.content.slice(-800), !previousUser ? archivedHint.slice(-1600) : ''].filter(Boolean).join('\n');
}

// The entire tool catalog can occupy half of a small model's useful input.
// Keep relevant tools available, including the read tools needed before an edit.
export function selectHarnessToolDefinitions(definitions: ChatCompletionTool[], request: string, contextWindow: number, requiredNames: string[] = [], maxOutputTokens = 0): ChatCompletionTool[] {
  const availableInput = Math.max(0, contextWindow - maxOutputTokens - 384);
  const budget = Math.max(280, Math.min(6000, Math.floor(contextWindow * .2), Math.floor(availableInput * .35)));
  const compact = budget < 600;
  const text = request.toLowerCase();
  const file = /\b(files?|folders?|code|coding|repository|repo|projects?|source|bugs?|build|tests?|implement|fix|refactor|edit|write|create|change|update|inspect|review|open|read|shell|terminal|command|ls|cat|pwd)\b/.test(text);
  const edit = /\b(edit|write|create|build|change|update|implement|fix|refactor|modify|patch|add)\b/.test(text);
  const remove = /\b(delete|remove|erase)\b/.test(text);
  const move = /\b(move|rename|relocate)\b/.test(text);
  const git = /\b(git|branch|commits?|committing|unstag(?:e|ed|ing)|stag(?:e|ed|ing)|diff|repository|repo)\b/.test(text);
  const library = /\b(library|document|pdf|notes|reference|research|excerpt)\b/.test(text);
  const history = /\b(earlier|previous|remember|past|history|last time|decid(?:e|ed|ing)|decisions?|agreed|you said)\b/.test(text);
  const memory = /\b(memory|memories|remember|preferences?|decid(?:e|ed|ing)|decisions?|agree(?:d|ment)?|saved? notes?)\b/.test(text);
  const recovery = /\b(restore|undo|backup|backups|recover|recovery|revert)\b/.test(text);
  const image = /\b(images?|pictures?|photos?|illustrat\w*|draw\w*|artwork|visual|render|diagram|logo|icon|sprite|poster|portrait|painting|graphic)\b/.test(text);
  const syntax = /\b(syntax|parsing?|compile|lint|validate|verify)\b/.test(text) || /\bcheck\b/.test(text) && /\.(?:jsx?|tsx?|mjs|cjs|json)\b/.test(text);
  const scores: Record<string, number> = {};
  const score = (name: string, value: number) => { scores[name] = Math.max(scores[name] || 0, value); };
  if (file || edit || remove || move || git) {
    score('read_file', 10); score('search_files', 9); score('list_files', 8);
    score('shell_readonly', /\b(shell|terminal|command|ls|cat|pwd)\b/.test(text) ? 12 : 7);
  }
  if (edit) { score('replace_in_file', 9); score('write_file', 7); score('apply_patch', /\b(patch|diff|multiple|several|refactor)\b/.test(text) ? 10 : 6); }
  if (compact && edit && /\b[\w.-]+(?:\/[\w.-]+)*\.(?:ts|tsx|js|jsx|py|json|css|html|md)\b/.test(text)) {
    score('read_file', 12); score('replace_in_file', 11);
  }
  if (syntax) { score('check_syntax', 14); score('read_file', 10); }
  if (file && /\b(new|create|add|build)\b/.test(text)) score('write_file', 11);
  if (/\b(multiple|several|across|all replacements)\b/.test(text) && edit) score('replace_many_in_file', 9);
  if (remove) score('delete_file', 13);
  if (move) score('move_file', 13);
  if (git) { score('git_status', 12); score('git_diff', /\bdiff\b/.test(text) ? 18 : 11); }
  if (git && (/\b(init|initializ\w*|initialis\w*)\b/.test(text) || /\b(create|start|set up|new)\b/.test(text) && /\b(repository|repo)\b/.test(text))) score('git_init', 16);
  if (git && /\b(commits|history|log|previous|earlier)\b/.test(text)) score('git_history', 18);
  if (git && /\b(stage|staging|add to git)\b/.test(text)) score('git_stage', 17);
  if (git && /\b(unstage|unstaging)\b/.test(text)) score('git_unstage', 18);
  if (git && /\b(commit|committing)\b/.test(text)) { score('git_commit', 19); score('git_stage', 10); }
  if (git && /\b(branch|branches)\b/.test(text) && /\b(create|make|start|new)\b/.test(text)) score('git_create_branch', 16);
  if (library) { score('search_library', 12); score('read_file', 7); }
  if (history) { score('search_history', 13); score('read_history', 12); score('list_history_topics', 10); }
  if (memory) { score('search_memory', 14); score('read_memory', 11); if (/\b(remember|save|store|keep|note)\b/.test(text)) score('propose_memory', 16); }
  if (recovery) { score('list_backups', 18); score('inspect_backup', 17); score('file_info', 16); score('restore_backup', 15); }
  if (image) score('generate_image', 14);
  const required = new Set(requiredNames);
  const ranked = definitions.map((original, index) => ({ definition: compact ? compactToolDefinition(original) : original, index, score: scores[original.function.name] || 0 }))
    .filter(item => item.score > 0 || required.has(item.definition.function.name))
    .sort((a, b) => Number(required.has(b.definition.function.name)) - Number(required.has(a.definition.function.name))
      || b.score - a.score || a.index - b.index);
  const selected: ChatCompletionTool[] = [];
  for (const item of ranked) {
    const next = [...selected, item.definition];
    if (toolSchemaTokens(next) + next.length * 16 <= budget || !selected.length) selected.push(item.definition);
  }
  return selected;
}
