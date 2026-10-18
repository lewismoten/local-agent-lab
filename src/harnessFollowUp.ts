const FOLLOW_UP = /^(?:(?:yes|yeah|yep|okay|ok|sure|please)[,.!? ]*)?(?:go ahead|do (?:it|that|this)|proceed|continue|keep going|finish (?:it|that|this)|try (?:it|that|this) again|make (?:that|those) changes|yes|yeah|yep|okay|ok|sure|please)[.!? ]*$/i;

/** Short replies depend on the preceding exchange for their actual task. */
export const isBriefFollowUp = (text: string): boolean => FOLLOW_UP.test(text.trim());

/** Use the task behind a short approval for library retrieval, never the approval word itself. */
export function followUpLibraryQuery(query: string, turns: { role: string; content: string }[], archivedHint = ''): string {
  if (!isBriefFollowUp(query)) return query;
  const task = [...turns].reverse().find(turn => turn.role === 'user' && !isBriefFollowUp(turn.content));
  if (task) return task.content.slice(0, 1000);
  const archivedTask = /\[Recent archived exchange[^\n]*· user\]\n([\s\S]*?)(?=\n\n\[|$)/.exec(archivedHint)?.[1];
  if (archivedTask) return archivedTask.slice(0, 1000);
  const topic = /\[Recent archived topic[^\n]*\]\n([\s\S]*?)(?=\n\n\[|$)/.exec(archivedHint)?.[1];
  return topic?.slice(0, 1000) || '';
}
