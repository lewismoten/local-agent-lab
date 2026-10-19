import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Download, Palette, Plus, Sparkles, Upload, X } from 'lucide-react';
import { useConfirmDialog } from './ConfirmDialog.tsx';
import { cleanCustomTheme, cleanThemeWallpaper, colorContrast, customThemeVariables, newCustomTheme, readThemePack, themePack, type CustomTheme, type ThemeColors } from './customTheme.ts';
import { applyThemeStage, type ThemeStage } from './themeGeneration.ts';
import { THEMES, type ThemeId } from './themeOptions.ts';

const colors: { key: keyof ThemeColors; label: string }[] = [
  { key: 'background', label: 'Background' }, { key: 'panel', label: 'Panel' }, { key: 'raised', label: 'Raised surface' },
  { key: 'text', label: 'Text' }, { key: 'muted', label: 'Muted text' }, { key: 'accent', label: 'Accent' }, { key: 'border', label: 'Border' },
];
const minimumReadingContrast = (ink: string, theme: CustomTheme) => Math.min(...(['background', 'panel', 'raised'] as const).map(key => colorContrast(ink, theme.colors[key])));

export default function ThemePicker({ value, customThemes, onChange, onSave, onDelete, onPreview, onGenerate, onConfigureModel }: {
  value: ThemeId;
  customThemes: CustomTheme[];
  onChange: (theme: ThemeId) => void;
  onSave: (theme: CustomTheme) => void;
  onDelete: (id: string) => void;
  onPreview: (theme: CustomTheme | null) => void;
  onGenerate?: (stage: ThemeStage, draft: CustomTheme, signal: AbortSignal) => Promise<{ text: string; note?: string }>;
  onConfigureModel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const wallpaperInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [error, setError] = useState('');
  const [generationNote, setGenerationNote] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState<ThemeStage | null>(null);
  const generator = useRef<AbortController | null>(null);
  const confirmAction = useConfirmDialog();
  useEffect(() => () => generator.current?.abort(), []);
  useEffect(() => { if (draft && !previewing && !editor.current?.open) editor.current?.showModal(); }, [draft, previewing]);
  const edit = (theme: CustomTheme) => { dialog.current?.close(); setError(''); setGenerationNote(''); setPreviewing(false); onPreview(null); setDraft(structuredClone(theme)); };
  const closeEditor = () => { generator.current?.abort(); generator.current = null; editor.current?.close(); onPreview(null); setPreviewing(false); setDraft(null); setError(''); setGenerationNote(''); setGenerating(null); };
  const preview = () => {
    const cleaned = cleanCustomTheme(draft);
    if (!cleaned) { setError('Complete the name and use valid colors and settings.'); return; }
    editor.current?.close(); setPreviewing(true); onPreview(cleaned);
  };
  const resumeEdit = () => { onPreview(null); setPreviewing(false); };
  const generate = async (stage: ThemeStage) => {
    if (!draft || !onGenerate || generating) return;
    const controller = new AbortController();
    generator.current = controller;
    setGenerating(stage); setError(''); setGenerationNote('');
    try {
      const response = await onGenerate(stage, draft, controller.signal);
      if (!controller.signal.aborted && draftRef.current) { setDraft(applyThemeStage(stage, draftRef.current, response.text)); setGenerationNote(response.note || ''); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generator.current === controller) { generator.current = null; setGenerating(null); }
    }
  };
  const save = () => {
    const cleaned = cleanCustomTheme(draft);
    if (!cleaned) { setError('Complete the name and use valid colors and settings.'); return; }
    onSave(cleaned);
    onChange(`custom:${cleaned.id}`);
    closeEditor();
  };
  const verifyWallpaper = (url: string) => new Promise<void>((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => picture.naturalWidth <= 1600 && picture.naturalHeight <= 1600 && picture.naturalWidth * picture.naturalHeight <= 1_600_000 ? resolve() : reject(new Error('The PNG dimensions are too large.'));
    picture.onerror = () => reject(new Error('The PNG could not be opened.'));
    picture.src = url;
  });
  const loadWallpaper = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('Theme PNGs must be smaller than 100 KB.');
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the PNG.'));
        reader.onerror = () => reject(new Error('Could not read the PNG.'));
        reader.readAsDataURL(file);
      });
      if (!cleanThemeWallpaper(url)) throw new Error('Use a PNG up to 1600 × 1600 pixels.');
      await verifyWallpaper(url);
      setDraft(current => current ? { ...current, wallpaper: url } : null);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const importPack = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 250_000) throw new Error('Theme packs must be smaller than 250 KB.');
      const theme = readThemePack(JSON.parse(await file.text()));
      if (!theme) throw new Error('This theme pack is invalid or uses a newer format.');
      if (theme.wallpaper) await verifyWallpaper(theme.wallpaper);
      edit({ ...theme, id: crypto.randomUUID() });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); if (!dialog.current?.open) dialog.current?.showModal(); }
  };
  const exportPack = (theme: CustomTheme) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(themePack(theme), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${theme.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'theme'}.theme.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const remove = async (theme: CustomTheme) => {
    if (!await confirmAction(`Delete “${theme.name}” from this workspace? Export it first if you want to keep a copy.`, { title: 'Delete theme', confirmLabel: 'Delete', destructive: true })) return;
    onDelete(theme.id);
    if (value === `custom:${theme.id}`) onChange('cyberpunk');
  };
  return <>
    <button className="harness-theme-trigger harness-icon" type="button" title="Appearance" aria-label="Choose appearance" onClick={() => previewing ? resumeEdit() : dialog.current?.showModal()}><Palette size={18}/></button>
    {previewing && draft && createPortal(<div className="harness-theme-preview-bar" role="status"><div><strong>Previewing {draft.name}</strong><span>Not saved · explore the workspace</span></div><button type="button" onClick={resumeEdit}>Edit</button><button className="save" type="button" onClick={save}>Save theme</button><button type="button" onClick={closeEditor}>Discard</button></div>, document.body)}
    <dialog ref={dialog} className="harness-dialog harness-theme-dialog" aria-labelledby="theme-dialog-title">
      <header><div><span className="harness-overline">APPEARANCE</span><h2 id="theme-dialog-title">Choose a theme</h2></div><button className="harness-icon" type="button" aria-label="Close appearance" onClick={() => dialog.current?.close()}><X size={19}/></button></header>
      <div className="harness-theme-options">{THEMES.map(theme => <button key={theme.id} className={`harness-theme-option theme-preview-${theme.id}`} type="button" aria-pressed={value === theme.id} onClick={() => { onChange(theme.id); dialog.current?.close(); }}>
        <span className="harness-theme-swatch" aria-hidden="true"><i/><i/><i/></span><strong>{theme.name}</strong><small>{theme.description}</small>
      </button>)}{customThemes.map(theme => <div key={theme.id} className="harness-theme-custom-row"><button className="harness-theme-option theme-preview-custom" type="button" aria-pressed={value === `custom:${theme.id}`} onClick={() => { onChange(`custom:${theme.id}`); dialog.current?.close(); }} style={customThemeVariables(theme) as CSSProperties}>
        <span className="harness-theme-swatch" aria-hidden="true"><i/><i/><i/></span><strong>{theme.name}</strong><small>{theme.description || 'Custom workspace theme'}</small>
      </button><div><button className="harness-secondary" type="button" onClick={() => edit(theme)}>Edit</button><button className="harness-secondary" type="button" onClick={() => exportPack(theme)} title={`Export ${theme.name}`} aria-label={`Export ${theme.name}`}><Download size={15}/></button><button className="harness-danger" type="button" onClick={() => void remove(theme)}>Delete</button></div></div>)}</div>
      <footer><button className="harness-secondary" type="button" onClick={() => edit(newCustomTheme())}><Plus size={15}/> New theme</button><button className="harness-secondary" type="button" onClick={() => importInput.current?.click()}><Upload size={15}/> Import pack</button><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={event => { void importPack(event.target.files?.[0]); event.target.value = ''; }}/></footer>
      {error && <p className="model-error" role="alert">{error}</p>}
    </dialog>
    <dialog ref={editor} className="harness-dialog harness-theme-dialog harness-theme-editor" aria-labelledby="theme-editor-title" onCancel={event => { event.preventDefault(); closeEditor(); }}>
      {draft && <><header><div><span className="harness-overline">CUSTOM THEME</span><h2 id="theme-editor-title">{customThemes.some(theme => theme.id === draft.id) ? 'Edit theme' : 'New theme'}</h2></div><button className="harness-icon" type="button" aria-label="Close theme editor" onClick={closeEditor}><X size={19}/></button></header>
        <div className="harness-theme-editor-grid"><label>Name<input maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label><label>Description<input maxLength={240} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label><label>Font<select value={draft.font} onChange={event => setDraft({ ...draft, font: event.target.value as CustomTheme['font'] })}><option value="sans">Modern sans</option><option value="serif">Book serif</option><option value="mono">Monospace</option></select></label><label>Motion<select value={draft.motion} onChange={event => setDraft({ ...draft, motion: event.target.value as CustomTheme['motion'] })}><option value="none">None</option><option value="subtle">Subtle</option><option value="full">Full</option></select></label><label>Corner radius · {draft.radius}px<input type="range" min="0" max="24" value={draft.radius} onChange={event => setDraft({ ...draft, radius: Number(event.target.value) })}/></label><label>Reading size · {draft.readingScale}%<input type="range" min="90" max="130" step="5" value={draft.readingScale} onChange={event => setDraft({ ...draft, readingScale: Number(event.target.value) })}/></label><label>Tags<input value={draft.tags.join(', ')} onChange={event => setDraft({ ...draft, tags: event.target.value.split(',').map(tag => tag.trim()).slice(0, 12) })} placeholder="quiet, paper, playful"/></label></div>
        <div className="harness-theme-colors">{colors.map(({ key, label }) => <label key={key}><span>{label}</span><input type="color" value={draft.colors[key]} onChange={event => setDraft({ ...draft, colors: { ...draft.colors, [key]: event.target.value } })}/><code>{draft.colors[key]}</code></label>)}</div>
        <div className="harness-theme-wallpaper"><span>Background PNG</span>{draft.wallpaper && <img src={draft.wallpaper} alt="Selected theme background"/>}<button className="harness-secondary" type="button" onClick={() => wallpaperInput.current?.click()}>{draft.wallpaper ? 'Replace' : 'Upload PNG'}</button>{draft.wallpaper && <button className="harness-danger" type="button" onClick={() => setDraft({ ...draft, wallpaper: undefined })}>Remove</button>}<small>Stored in theme pack</small><input ref={wallpaperInput} type="file" accept="image/png,.png" hidden onChange={event => { void loadWallpaper(event.target.files?.[0]); event.target.value = ''; }}/></div>
        <p className="harness-theme-contrast" role="status">Minimum contrast · text {minimumReadingContrast(draft.colors.text, draft).toFixed(1)}:1 · muted {minimumReadingContrast(draft.colors.muted, draft).toFixed(1)}:1{Math.min(minimumReadingContrast(draft.colors.text, draft), minimumReadingContrast(draft.colors.muted, draft)) < 4.5 ? ' · low contrast' : ''}</p>
        <label>Design direction<textarea rows={2} maxLength={2000} value={draft.prompt} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder="Describe the mood and visual references for future AI-assisted edits."/></label>
        <div className="harness-theme-generation"><div><Sparkles size={16}/><strong>Build with AI</strong><span>Review each step before saving.</span></div>{onGenerate ? <div className="harness-theme-generation-actions">{([['identity', '1. Name & style'], ['colors', '2. Palette'], ['details', '3. Details']] as const).map(([stage, label]) => <button className="harness-secondary" type="button" key={stage} disabled={!!generating} onClick={() => void generate(stage)}>{generating === stage ? 'Generating…' : label}</button>)}{generating && <button className="harness-secondary" type="button" onClick={() => generator.current?.abort()}>Stop</button>}</div> : <button className="harness-secondary" type="button" onClick={() => { closeEditor(); onConfigureModel(); }}>Set up a model</button>}</div>
        {generationNote && <p className="harness-theme-contrast" role="status">{generationNote}</p>}
        <div className="harness-theme-live-preview" style={customThemeVariables(draft) as CSSProperties}><div><small>{draft.name}</small><strong>Preview your workspace</strong><p>{draft.description || 'A place for your next story.'}</p></div><button type="button" tabIndex={-1}>Accent action</button></div>
        {error && <p className="model-error" role="alert">{error}</p>}
        <div className="harness-dialog-actions"><button className="harness-secondary" type="button" onClick={closeEditor}>Cancel</button><button className="harness-secondary" type="button" onClick={preview}>Preview workspace</button><button className="harness-primary" type="button" onClick={save}>Save theme</button></div>
      </>}
    </dialog>
  </>;
}
