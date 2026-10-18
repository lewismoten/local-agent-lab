/** Tool names whose successful calls leave a change in the portable workspace. */
const MUTATING_TOOLS = new Set([
  'write_file', 'replace_in_file', 'replace_many_in_file', 'apply_patch',
  'move_file', 'delete_file', 'restore_backup', 'generate_image',
  'git_init', 'git_stage', 'git_unstage', 'git_commit', 'git_create_branch',
  'claim_task', 'add_task_note', 'set_task_status',
  'queue_model_download', 'queue_browser_engine', 'set_model_download_speed', 'set_model_preferences',
  'set_journal_enabled',
]);

export const isMutatingToolName = (name: string): boolean => MUTATING_TOOLS.has(name);

export function isSavedChangeEvent(event: string): boolean {
  const colon = event.indexOf(':');
  return colon > 0 && isMutatingToolName(event.slice(0, colon));
}
