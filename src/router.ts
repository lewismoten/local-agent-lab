import { useSyncExternalStore } from 'react';
export type RouteView = 'chat' | 'overview' | 'books' | 'characters' | 'world' | 'sources' | 'influences' | 'settings' | 'story-profile' | 'ai-profiles' | 'project-files';
export type RouteDialog = 'help' | 'ai' | null;
export type RouteIntent = 'image' | null;
const views = new Set<RouteView>(['chat', 'overview', 'books', 'characters', 'world', 'sources', 'influences', 'settings', 'story-profile', 'ai-profiles', 'project-files']);
const readHash = () => window.location.hash || '#/chat';
const subscribe = (listener: () => void) => { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); };
export function parseRoute(hash: string): { view: RouteView; dialog: RouteDialog; intent: RouteIntent } {
  const [path, query] = hash.replace(/^#\/?/, '').split('?');
  const view = views.has(path as RouteView) ? path as RouteView : 'chat';
  const rawDialog = new URLSearchParams(query || '').get('dialog');
  const rawIntent = new URLSearchParams(query || '').get('intent');
  return { view, dialog: rawDialog === 'help' || rawDialog === 'ai' ? rawDialog : null, intent: rawIntent === 'image' ? 'image' : null };
}
export function useRoute() {
  const hash = useSyncExternalStore(subscribe, readHash, () => '#/chat');
  const route = parseRoute(hash);
  const navigate = (view: RouteView) => { window.location.hash = `/${view}`; };
  const openDialog = (dialog: Exclude<RouteDialog, null>, intent?: RouteIntent) => { window.location.hash = `/${route.view}?dialog=${dialog}${intent ? `&intent=${intent}` : ''}`; };
  const closeDialog = () => { window.location.hash = `/${route.view}`; };
  return { ...route, navigate, openDialog, closeDialog };
}
