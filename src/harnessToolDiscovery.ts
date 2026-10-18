import type { ChatCompletionTool } from './browserEngineTypes.ts';
import { selectHarnessToolDefinitions } from './harnessToolSelection.ts';

export const TOOL_CATEGORIES = {
  files: ['list_files', 'search_files', 'read_file', 'file_info', 'check_syntax'],
  edit: ['read_file', 'replace_in_file', 'write_file', 'apply_patch', 'replace_many_in_file', 'move_file', 'delete_file'],
  git: ['git_status', 'git_diff', 'git_history', 'git_stage', 'git_unstage', 'git_commit', 'git_create_branch', 'git_init'],
  library: ['search_library', 'read_file'],
  history: ['search_history', 'read_history', 'list_history_topics'],
  memory: ['search_memory', 'read_memory', 'propose_memory'],
  recovery: ['list_backups', 'inspect_backup', 'restore_backup', 'file_info'],
  image: ['generate_image'],
  shell: ['shell_readonly'],
} as const;
export type ToolCategory = keyof typeof TOOL_CATEGORIES;

export const requestToolsTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'request_tools',
    description: 'Expose more permitted tools for this task. Choose a category; optionally name one tool.',
    parameters: { type: 'object', properties: {
      category: { type: 'string', description: 'files, edit, git, library, history, memory, recovery, image, or shell' },
      tool: { type: 'string' },
    }, required: ['category'] },
  },
};

export function initialDiscoverableTools(available: ChatCompletionTool[], request: string, contextWindow: number, maxOutputTokens: number, requiredNames: string[] = [], permitDiscovery = true): ChatCompletionTool[] {
  const initial = selectHarnessToolDefinitions(available, request, contextWindow, requiredNames, maxOutputTokens);
  if (!initial.length || !permitDiscovery || initial.length === available.length) return initial;
  const expanded = selectHarnessToolDefinitions([...available, requestToolsTool], request, contextWindow,
    [...requiredNames, 'request_tools'], maxOutputTokens);
  return expanded.some(item => item.function.name !== 'request_tools')
    && requiredNames.every(name => expanded.some(item => item.function.name === name)) ? expanded : initial;
}

export function discoverToolCategory(available: ChatCompletionTool[], category: string, tool: string, request: string, contextWindow: number, maxOutputTokens: number): ChatCompletionTool[] {
  const names = TOOL_CATEGORIES[category as ToolCategory];
  if (!names) throw new Error(`Unknown category. Choose: ${Object.keys(TOOL_CATEGORIES).join(', ')}.`);
  const candidates = names.map(name => available.find(item => item.function.name === name)).filter((item): item is ChatCompletionTool => !!item);
  if (!candidates.length) throw new Error(`No ${category} tools are available in this project and conversation.`);
  if (tool && !candidates.some(item => item.function.name === tool)) throw new Error(`${tool} is not an available ${category} tool.`);
  const required = tool ? [tool] : candidates.slice(0, 3).map(item => item.function.name);
  const selected = selectHarnessToolDefinitions([...candidates, requestToolsTool], `${request} ${category}`, contextWindow,
    [...required, 'request_tools'], maxOutputTokens);
  if (!selected.some(item => candidates.some(candidate => candidate.function.name === item.function.name))) {
    throw new Error(`The context window is too small to expose ${category} tools.`);
  }
  return selected;
}
