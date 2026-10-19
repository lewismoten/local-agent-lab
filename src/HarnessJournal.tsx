import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { BookOpen, ChevronRight, Image as ImageIcon, RefreshCw, Sparkles } from 'lucide-react';
import { complete, type AIConfig } from './ai.ts';
import { HarnessAvatarGallery } from './HarnessAvatarGallery.tsx';
import { useAvatarAssetUrl } from './HarnessIdentityAvatar.tsx';
import type { AvatarAsset } from './harnessAvatarLibrary.ts';
import { compactIdentityAvatar } from './harnessIdentityAvatar.ts';
import { generateImage, type ImageConfig } from './imageGeneration.ts';
import { withModelLease } from './harnessLease.ts';
import { ensureBrowserModelReady } from './modelSession.ts';
import JournalStyleGallery from './JournalStyleGallery.tsx';
import { JOURNAL_STYLES, defaultJournalStyleSettings, effectiveJournalIconPrompt, effectiveJournalPrompt, journalArtworkPrompt, journalFactRevision, journalStyleRequest, type JournalRenderings, type JournalStyleId, type JournalStyleSettings } from './harnessJournalStyles.ts';
import { showCompletionToast, showToast } from './toastStore.ts';
import { openToastImagePreview } from './toastImagePreview.ts';
import type { HarnessAgent, HarnessProject } from './harnessData.ts';
import { journalTarget, journalTopics, type JournalDay, type JournalIndex } from './harnessJournal.ts';
import type { ConversationMeta } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';
import './harnessJournal.css';

export default function HarnessJournal({ store, projects, agents, modelConfig, imageOptions, folder, onOpen, onWrite, onOpenModels }: {
  store: HarnessStore;
  projects: HarnessProject[];
  agents: HarnessAgent[];
  modelConfig: AIConfig | null;
  imageOptions: ImageConfig[];
  folder: FileSystemDirectoryHandle | null;
  onOpen: (projectId: string, sessionId: string, seq: number) => void;
  onWrite: <T,>(action: () => Promise<T>) => Promise<T>;
  onOpenModels: () => void;
}) {
  const [index, setIndex] = useState<JournalIndex | null>(null);
  const [date, setDate] = useState('');
  const [day, setDay] = useState<JournalDay | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [limit, setLimit] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [styles, setStyles] = useState<JournalStyleSettings>(defaultJournalStyleSettings);
  const [renderings, setRenderings] = useState<JournalRenderings | null>(null);
  const [writing, setWriting] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const [artworkBusy, setArtworkBusy] = useState(false);
  const [artworkPrompt, setArtworkPrompt] = useState('');
  const [artworkSearch, setArtworkSearch] = useState('');
  const [artworkLibrary, setArtworkLibrary] = useState<AvatarAsset[]>([]);
  const [styleProgress, setStyleProgress] = useState('');
  const writingAbort = useRef<AbortController | null>(null);
  const iconsAbort = useRef<AbortController | null>(null);
  const artworkAbort = useRef<AbortController | null>(null);
  const projectNames = useMemo(() => Object.fromEntries(projects.map(project => [project.id, project.name])), [projects]);
  const agentNames = useMemo(() => Object.fromEntries(agents.map(agent => [agent.id, agent.name])), [agents]);
  const topics = useMemo(() => day ? journalTopics(day, projectNames, sessions, agentNames, index?.timeZone) : [], [day, projectNames, sessions, agentNames, index?.timeZone]);
  const selectedPrompt = effectiveJournalPrompt(styles, styles.selected);
  const rendering = renderings?.entries[styles.selected];
  const renderingCurrent = !!day && !!rendering && rendering.factRevision === journalFactRevision(day) && rendering.prompt === selectedPrompt;
  const artworkUrl = useAvatarAssetUrl(store, renderings?.artworkAssetId);
  useEffect(() => () => { writingAbort.current?.abort(); iconsAbort.current?.abort(); artworkAbort.current?.abort(); }, []);
  useEffect(() => { setArtworkPrompt(renderings?.artworkPrompt || journalArtworkPrompt(styles.selected)); }, [date, renderings?.artworkPrompt, styles.selected]);
  useEffect(() => {
    let active = true;
    void store.avatarLibrary().then(assets => { if (active) setArtworkLibrary(assets); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [store, renderings?.artworkAssetId]);

  useEffect(() => {
    let active = true;
    void store.journalStyleSettings().then(current => { if (active) setStyles(current); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [store]);
  useEffect(() => {
    if (!date) { setRenderings(null); return; }
    let active = true;
    void store.journalRenderings(date).then(current => { if (active) setRenderings(current); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [store, date]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void store.journalIndex().then(current => {
        if (!active) return;
        setIndex(current);
        setDate(previous => previous && current.dates.includes(previous) ? previous : current.dates[0] || '');
      }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [store]);
  useEffect(() => {
    if (!date) { setDay(null); setSessions([]); setLoadingDay(false); return; }
    let active = true;
    setDay(null);
    setSessions([]);
    setLoadingDay(true);
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const current = await store.journalDay(date);
        if (!active) return;
        const projectIds = [...new Set((current?.facts || []).map(fact => fact.projectId))];
        const linked = (await Promise.all(projectIds.map(id => store.sessions(id)))).flat();
        if (active) { setDay(current); setSessions(linked); setLoadingDay(false); }
      } catch (cause) { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setLoadingDay(false); } }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [store, date]);

  async function toggle() {
    if (!index) return;
    setBusy(true); setError('');
    try { setIndex(await onWrite(() => store.setJournalEnabled(!index.enabled))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function saveStyleSettings(change: (current: JournalStyleSettings) => JournalStyleSettings) {
    setStyles(current => change(current));
    try { setStyles(await onWrite(() => store.updateJournalStyleSettings(change))); setError(''); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      void store.journalStyleSettings().then(setStyles).catch(() => {});
    }
  }
  async function generateEntry() {
    if (!day || !modelConfig?.model || writing || iconBusy || artworkBusy) return;
    const controller = new AbortController();
    writingAbort.current = controller;
    setWriting(true); setError(''); setStyleProgress('Waiting for model…');
    const startedAt = performance.now();
    const request = journalStyleRequest(day, topics, selectedPrompt, Math.min(16_000, Math.max(1_200, (modelConfig.contextWindow - modelConfig.maxOutputTokens) * 2)));
    try {
      const response = await withModelLease(`journal:${day.date}`, async () => {
        if (modelConfig.provider === 'browser') {
          if (!folder) throw new Error('Connect the folder containing this browser model first.');
          setStyleProgress('Loading browser model…');
          await ensureBrowserModelReady(modelConfig, folder);
        }
        setStyleProgress('Writing journal entry…');
        return complete({ ...modelConfig, maxOutputTokens: Math.max(512, modelConfig.maxOutputTokens) },
          [{ role: 'user', content: request.user }], request.system, controller.signal);
      }, controller.signal);
      if (controller.signal.aborted) return;
      const saved = await onWrite(() => store.saveJournalRendering(day.date, {
        styleId: styles.selected, text: response.text.trim(), prompt: selectedPrompt,
        factRevision: journalFactRevision(day), generatedAt: new Date().toISOString(),
        model: `${modelConfig.provider} · ${modelConfig.model}`, sourceTopics: request.includedTopics, totalTopics: request.totalTopics,
      }));
      setRenderings(saved);
      setStyleProgress('Entry saved.');
      showCompletionToast('Journal entry ready.', startedAt, 2000, { label: 'View entry', onClick: () => { location.hash = '/journal'; } });
    } catch (cause) {
      if (controller.signal.aborted) setStyleProgress('Stopped. Previous entry remains available.');
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (writingAbort.current === controller) writingAbort.current = null; setWriting(false); }
  }
  async function generateIcons(ids: JournalStyleId[], promptOverride?: string) {
    if (!imageOptions.length || iconBusy || writing || artworkBusy) return;
    const controller = new AbortController();
    iconsAbort.current = controller;
    setIconBusy(true); setError('');
    const startedAt = performance.now();
    let completed = 0;
    try {
      await withModelLease('journal-style-icons', async () => {
        for (const [index, id] of ids.entries()) {
          if (controller.signal.aborted) break;
          const prompt = promptOverride && ids.length === 1 ? promptOverride : effectiveJournalIconPrompt(styles, id);
          setStyleProgress(`Icon ${index + 1}/${ids.length} · ${JOURNAL_STYLES.find(style => style.id === id)?.title}…`);
          const failures: string[] = [];
          let image: Blob | null = null;
          for (const option of imageOptions) {
            if (controller.signal.aborted) break;
            if (option.provider === 'browser' && !folder) { failures.push(`${option.model}: connect a model folder`); continue; }
            try { image = await generateImage(option, prompt, controller.signal, message => setStyleProgress(`Icon ${index + 1}/${ids.length} · ${message}`), undefined, folder); break; }
            catch (cause) { if (controller.signal.aborted) break; failures.push(`${option.model}: ${cause instanceof Error ? cause.message : String(cause)}`); }
          }
          if (controller.signal.aborted) break;
          if (!image) throw new Error(`Could not generate ${id} icon. ${failures.join(' | ')}`);
          const compact = await compactIdentityAvatar(image);
          const asset = await onWrite(() => store.saveAvatarAsset(compact,
            { title: `${JOURNAL_STYLES.find(style => style.id === id)!.title} icon`, tags: ['Journal', 'Style', id], source: 'generated', prompt }));
          const updated = await onWrite(() => store.updateJournalStyleSettings(current => ({ ...current, iconAssetIds: { ...current.iconAssetIds, [id]: asset.id } })));
          setStyles(updated);
          completed++;
        }
      }, controller.signal);
      setStyleProgress(controller.signal.aborted ? `Stopped · ${completed} icons saved` : `${completed} icons ready`);
      if (controller.signal.aborted) showToast(`Journal icon generation stopped. ${completed} saved.`, 'success', { label: 'View icons', onClick: () => { location.hash = '/journal'; } });
      else showCompletionToast(`${completed} journal icon${completed === 1 ? '' : 's'} ready.`, startedAt, 2000, { label: 'View icons', onClick: () => { location.hash = '/journal'; } });
    } catch (cause) {
      if (controller.signal.aborted) showToast(`Journal icon generation stopped. ${completed} saved.`, 'success', { label: 'View icons', onClick: () => { location.hash = '/journal'; } });
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (iconsAbort.current === controller) iconsAbort.current = null; setIconBusy(false); }
  }
  async function saveArtwork(assetId: string | null, prompt = artworkPrompt) {
    if (!date || artworkBusy || writing || iconBusy) return;
    try { setRenderings(await onWrite(() => store.saveJournalArtwork(date, assetId, prompt))); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function generateArtwork() {
    if (!date || !imageOptions.length || artworkBusy || writing || iconBusy) return;
    const controller = new AbortController();
    artworkAbort.current = controller;
    setArtworkBusy(true); setError(''); setStyleProgress('Creating journal artwork…');
    const startedAt = performance.now();
    const prompt = artworkPrompt.trim().slice(0, 1200) || journalArtworkPrompt(styles.selected);
    try {
      const image = await withModelLease(`journal-artwork:${date}`, async () => {
        const failures: string[] = [];
        for (const option of imageOptions) {
          if (controller.signal.aborted) break;
          if (option.provider === 'browser' && !folder) { failures.push(`${option.model}: connect a model folder`); continue; }
          try { return await generateImage(option, prompt, controller.signal, message => setStyleProgress(message), undefined, folder); }
          catch (cause) { if (controller.signal.aborted) break; failures.push(`${option.model}: ${cause instanceof Error ? cause.message : String(cause)}`); }
        }
        throw new Error(`No image generator completed the artwork. ${failures.join(' | ')}`);
      }, controller.signal);
      if (controller.signal.aborted) return;
      const compact = await compactIdentityAvatar(image);
      const asset = await onWrite(() => store.saveAvatarAsset(compact,
        { title: `Journal · ${date}`, tags: ['Journal', 'Artwork', date], source: 'generated', prompt }));
      setArtworkLibrary(current => [asset, ...current]);
      setRenderings(await onWrite(() => store.saveJournalArtwork(date, asset.id, prompt)));
      setStyleProgress('Artwork saved.');
      showCompletionToast('Journal artwork ready.', startedAt, 2000, { label: 'View artwork', onClick: () => openToastImagePreview(compact, `Journal artwork · ${date}`) });
    } catch (cause) {
      if (controller.signal.aborted) setStyleProgress('Artwork stopped.');
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (artworkAbort.current === controller) artworkAbort.current = null; setArtworkBusy(false); }
  }
  const open = (projectId: string, sessionId: string, seq: number) => {
    const target = index ? journalTarget(index, projectId, sessionId) : { projectId, sessionId };
    onOpen(target.projectId, target.sessionId, seq);
  };
  const formatted = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return <section className="harness-page harness-journal-page">
    <div className="harness-heading"><div><span className="harness-overline">YOUR WORK, DAY BY DAY</span><h1>Journal</h1><p>A private record of projects, conversations, and agent work.</p></div><button className={index?.enabled ? 'harness-secondary' : 'harness-primary'} onClick={() => void toggle()} disabled={busy || !index}>{busy ? 'Saving…' : index?.enabled ? 'Pause journal' : 'Start journal'}</button></div>
    {error && <p className="harness-git-error" role="alert">{error}</p>}
    <div className="harness-journal-explain"><BookOpen size={17}/><span>{index?.enabled ? `Recording short excerpts from new messages in ${index.timeZone}.` : 'Off by default. Turn it on to record new activity; earlier entries stay available when paused.'} Everything stays in this workspace.</span><button className="harness-icon" aria-label="Refresh journal" title="Refresh journal" onClick={() => { void store.journalIndex().then(setIndex).catch(cause => setError(String(cause))); if (date) void store.journalDay(date).then(setDay).catch(cause => setError(String(cause))); }}><RefreshCw size={15}/></button></div>
    <section className="harness-journal-styles"><div className="harness-journal-styles-head"><div><span className="harness-overline">MAKE IT YOURS</span><h2>Journal style</h2></div><div className="harness-journal-style-actions">{imageOptions.length ? <><button className="harness-secondary" disabled={iconBusy || writing || artworkBusy || JOURNAL_STYLES.every(style => styles.iconAssetIds[style.id])} onClick={() => void generateIcons(JOURNAL_STYLES.map(style => style.id).filter(id => !styles.iconAssetIds[id]))}>Generate missing icons</button><button className="harness-secondary" disabled={iconBusy || writing || artworkBusy} onClick={() => void generateIcons(JOURNAL_STYLES.map(style => style.id))}>Regenerate all icons</button></> : <button className="harness-secondary" onClick={onOpenModels}>Set up image model</button>}{iconBusy && <button className="harness-danger" onClick={() => iconsAbort.current?.abort()}>Stop icons</button>}</div></div>
      <JournalStyleGallery store={store} settings={styles} busy={iconBusy || writing || artworkBusy || !imageOptions.length} onSelect={id => void saveStyleSettings(current => ({ ...current, selected: id }))} onPrompt={(id, text) => void saveStyleSettings(current => ({ ...current, prompts: { ...current.prompts, [id]: text.trim().slice(0, 1200) } }))} onIconPrompt={(id, text) => void saveStyleSettings(current => ({ ...current, iconPrompts: { ...current.iconPrompts, [id]: text.trim().slice(0, 1200) } }))} onGenerateIcon={(id, prompt) => void generateIcons([id], prompt)}/>
      <div className="harness-journal-style-actions">{day && (modelConfig?.model ? <button className="harness-primary" disabled={writing || iconBusy || artworkBusy} onClick={() => void generateEntry()}><Sparkles size={15}/>{rendering ? 'Regenerate entry' : 'Generate entry'}</button> : <button className="harness-secondary" onClick={onOpenModels}>Set up writing model</button>)}{writing && <button className="harness-danger" onClick={() => writingAbort.current?.abort()}>Stop writing</button>}<span role="status">{styleProgress}</span></div>
    </section>
    <div className="harness-journal-layout"><aside className="harness-journal-dates" aria-label="Journal dates">{index?.dates.slice(0, limit).map(item => <button key={item} className={date === item ? 'active' : ''} disabled={writing || artworkBusy || iconBusy} onClick={() => setDate(item)}><time dateTime={item}>{formatted(item)}</time><ChevronRight size={14}/></button>)}{index && index.dates.length > limit && <button className="harness-secondary" disabled={writing || artworkBusy || iconBusy} onClick={() => setLimit(current => current + 15)}>Older days</button>}</aside>
      <div className="harness-journal-entries">{!index && <div className="harness-card">Opening journal…</div>}{index && !index.dates.length && <div className="harness-card harness-journal-empty"><BookOpen size={31}/><h2>No journal entries yet</h2><p>{index.enabled ? 'Your next saved conversation will start today’s entry.' : 'Start the journal when you want to keep a day-by-day record.'}</p></div>}
        {index && !!date && !day && !error && <div className="harness-card" role="status">{loadingDay ? `Opening ${formatted(date)}…` : 'This day has no saved entry.'}</div>}
        {day && <article className="harness-card harness-journal-article"><header className="harness-journal-article-head"><div><span className="harness-overline">DAILY ENTRY · {JOURNAL_STYLES.find(style => style.id === styles.selected)?.title.toUpperCase()}</span><h2>{formatted(day.date)}</h2><p>{day.facts.length} saved message{day.facts.length === 1 ? '' : 's'} across {topics.length} conversation{topics.length === 1 ? '' : 's'}</p></div><div className="harness-journal-artwork-preview" aria-label={artworkUrl ? 'Journal artwork' : 'No journal artwork'}>{artworkUrl ? <img src={artworkUrl} alt={`Artwork for ${formatted(day.date)}`}/> : <ImageIcon size={28} aria-hidden="true"/>}</div></header>
          <details className="harness-journal-artwork"><summary>Journal artwork</summary><label>Image prompt<textarea rows={3} maxLength={1200} value={artworkPrompt} disabled={artworkBusy} onChange={event => setArtworkPrompt(event.target.value)} onBlur={() => { if (renderings && artworkPrompt.trim() !== (renderings.artworkPrompt || journalArtworkPrompt(styles.selected))) void saveArtwork(renderings.artworkAssetId || null); }}/></label><div className="harness-journal-style-actions">{imageOptions.length ? <button className="harness-secondary" disabled={artworkBusy || writing || iconBusy} onClick={() => void generateArtwork()}><Sparkles size={14}/>{artworkUrl ? 'Regenerate artwork' : 'Generate artwork'}</button> : <button className="harness-secondary" onClick={onOpenModels}>Set up image model</button>}{artworkBusy && <button className="harness-danger" onClick={() => artworkAbort.current?.abort()}>Stop</button>}{renderings?.artworkAssetId && <button className="harness-secondary" disabled={artworkBusy || writing || iconBusy} onClick={() => void saveArtwork(null)}>Remove artwork</button>}</div><details className="harness-journal-artwork-library"><summary>Choose saved image</summary><input aria-label="Search saved images for journal" value={artworkSearch} onChange={event => setArtworkSearch(event.target.value)} placeholder="Search images or tags…"/><HarnessAvatarGallery store={store} assets={artworkLibrary} legacy={[]} query={artworkSearch} onUseAsset={asset => void saveArtwork(asset.id)} onUseIdentity={() => {}}/></details></details>
          {rendering && <div className="harness-journal-rendering">{!renderingCurrent && <p className="harness-journal-stale">This draft predates new facts or a prompt change. Regenerate to update it.</p>}<div className="harness-journal-rendering-copy"><ReactMarkdown>{rendering.text}</ReactMarkdown></div><small>{rendering.model} · {rendering.sourceTopics} of {rendering.totalTopics} conversations included · {new Date(rendering.generatedAt).toLocaleString()}</small></div>}
          <details className="harness-journal-sources" open={rendering ? undefined : true}><summary>{rendering ? 'Source conversations' : 'Daily activity'}</summary>{topics.map(topic => <section key={`${topic.projectId}:${topic.sessionId}`} className="harness-journal-topic"><span>{topic.projectName}{topic.agentId ? ` · ${agentNames[topic.agentId] || 'Agent'}` : ''}</span><h3>{topic.sessionTitle}</h3><p>{topic.prose}</p><div className="harness-journal-links"><button onClick={() => open(topic.projectId, topic.sessionId, topic.firstSeq)}>Start of day’s work <ChevronRight size={13}/></button><button onClick={() => open(topic.projectId, topic.sessionId, topic.lastSeq)}>Latest message <ChevronRight size={13}/></button>{topic.chapterSeq !== undefined && <button onClick={() => open(topic.projectId, topic.sessionId, topic.chapterSeq!)}>Chapter <ChevronRight size={13}/></button>}</div></section>)}</details>
        </article>}
      </div>
    </div>
  </section>;
}
