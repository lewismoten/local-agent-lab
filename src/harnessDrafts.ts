import type { HarnessStore } from './harnessStore.ts';

type DraftStore = Pick<HarnessStore, 'draft' | 'saveDraft'>;
type Target = { store: DraftStore; projectId: string; sessionId: string; text: string; dirty: boolean };

/** Keep one editable draft active while serializing writes before a workspace switch. */
export class HarnessDrafts {
  private current: Target | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> = Promise.resolve();
  private generation = 0;
  private readonly onError: (error: unknown) => void;
  private readonly delayMs: number;

  constructor(onError: (error: unknown) => void, delayMs = 450) {
    this.onError = onError;
    this.delayMs = delayMs;
  }

  async open(store: DraftStore, projectId: string, sessionId: string): Promise<string | null> {
    const run = ++this.generation;
    await this.flush();
    if (run !== this.generation) return null;
    if (this.current?.store === store && this.current.projectId === projectId && this.current.sessionId === sessionId) return this.current.text;
    const text = await store.draft(projectId, sessionId);
    if (run !== this.generation) return null;
    this.current = { store, projectId, sessionId, text, dirty: false };
    return text;
  }

  update(text: string): void {
    const current = this.current;
    if (!current || current.text === text) return;
    current.text = text;
    current.dirty = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(this.onError); }, this.delayMs);
  }

  appendTo(store: DraftStore, projectId: string, sessionId: string, text: string): string | null {
    const current = this.current;
    if (!current || current.store !== store || current.projectId !== projectId || current.sessionId !== sessionId) return null;
    const next = [current.text.trimEnd(), text.trim()].filter(Boolean).join('\n\n');
    this.update(next);
    return next;
  }

  /** Restore a failed send to its original conversation, even after navigation. */
  async restoreTo(store: DraftStore, projectId: string, sessionId: string, text: string): Promise<boolean> {
    const current = this.current;
    if (current?.store === store && current.projectId === projectId && current.sessionId === sessionId) {
      this.update(text);
      await this.flush();
      return true;
    }
    await this.pending;
    await store.saveDraft(projectId, sessionId, text);
    return false;
  }

  async flush(): Promise<void> {
    for (;;) {
      if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
      const current = this.current;
      if (!current) { await this.pending; return; }
      if (!current.dirty) {
        await this.pending;
        if (this.current === current && !current.dirty) return;
        continue;
      }
      current.dirty = false;
      const text = current.text;
      const task = this.pending.catch(() => {}).then(() => current.store.saveDraft(current.projectId, current.sessionId, text));
      this.pending = task;
      try { await task; }
      catch (error) { current.dirty = true; throw error; }
    }
  }
}
