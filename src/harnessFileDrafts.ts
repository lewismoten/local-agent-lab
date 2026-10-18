import { emptyFileEditorDraft, type FileEditorDraft, type HarnessStore } from './harnessStore.ts';

type DraftStore = Pick<HarnessStore, 'fileEditorDraft' | 'saveFileEditorDraft'>;
type Area = 'files' | 'library';
type Target = { store: DraftStore; projectId: string; area: Area; draft: FileEditorDraft; dirty: boolean };

/** Flush the previous project's editor buffer before opening the next one. */
export class HarnessFileDrafts {
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

  async open(store: DraftStore, projectId: string, area: Area): Promise<FileEditorDraft | null> {
    const run = ++this.generation;
    await this.flush();
    if (run !== this.generation) return null;
    if (this.current?.store === store && this.current.projectId === projectId && this.current.area === area) return { ...this.current.draft };
    const draft = await store.fileEditorDraft(projectId, area);
    if (run !== this.generation) return null;
    this.current = { store, projectId, area, draft, dirty: false };
    return { ...draft };
  }

  update(draft: FileEditorDraft): void {
    const current = this.current;
    if (!current || Object.keys(draft).every(key => draft[key as keyof FileEditorDraft] === current.draft[key as keyof FileEditorDraft])) return;
    current.draft = { ...draft };
    current.dirty = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(this.onError); }, this.delayMs);
  }

  async clear(): Promise<void> {
    this.update(emptyFileEditorDraft());
    await this.flush();
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
      const draft = { ...current.draft };
      const task = this.pending.catch(() => {}).then(() => current.store.saveFileEditorDraft(current.projectId, current.area, draft));
      this.pending = task;
      try { await task; }
      catch (error) { current.dirty = true; throw error; }
    }
  }
}
