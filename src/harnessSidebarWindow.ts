import type { ConversationMeta } from './harnessData.ts';

export const SIDEBAR_SESSION_HEIGHT = 56;
const OVERSCAN = 6;

export function sortedSidebarSessions(sessions: ConversationMeta[]): ConversationMeta[] {
  return [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || b.updatedAt.localeCompare(a.updatedAt)
    || a.id.localeCompare(b.id));
}

export function sidebarSessionWindow(total: number, scrollTop: number, viewportHeight: number) {
  const top = Math.max(0, scrollTop);
  const height = Math.max(SIDEBAR_SESSION_HEIGHT, viewportHeight);
  const start = Math.max(0, Math.floor(top / SIDEBAR_SESSION_HEIGHT) - OVERSCAN);
  const end = Math.min(total, Math.ceil((top + height) / SIDEBAR_SESSION_HEIGHT) + OVERSCAN);
  return { start, end, height: total * SIDEBAR_SESSION_HEIGHT };
}

export function sidebarScrollForSelection(index: number, scrollTop: number, viewportHeight: number) {
  if (index < 0) return scrollTop;
  const top = index * SIDEBAR_SESSION_HEIGHT;
  const bottom = top + SIDEBAR_SESSION_HEIGHT;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}
