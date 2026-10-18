import { useEffect, useState } from 'react';
import { BookOpen, Compass, FlaskConical, List, Map, Music2, PenLine, Sparkles } from 'lucide-react';
import { useAvatarAssetUrl } from './HarnessIdentityAvatar.tsx';
import { JOURNAL_STYLES, effectiveJournalIconPrompt, effectiveJournalPrompt, type JournalStyleId, type JournalStyleSettings } from './harnessJournalStyles.ts';
import type { HarnessStore } from './harnessStore.ts';

const ICONS = { book: BookOpen, compass: Compass, flask: FlaskConical, list: List, spark: Sparkles, pen: PenLine, map: Map, music: Music2 };

function StyleCard({ style, settings, store, busy, onSelect, onPrompt, onIconPrompt, onGenerateIcon }: {
  style: typeof JOURNAL_STYLES[number];
  settings: JournalStyleSettings;
  store: HarnessStore;
  busy: boolean;
  onSelect: (id: JournalStyleId) => void;
  onPrompt: (id: JournalStyleId, text: string) => void;
  onIconPrompt: (id: JournalStyleId, text: string) => void;
  onGenerateIcon: (id: JournalStyleId, prompt: string) => void;
}) {
  const Icon = ICONS[style.icon];
  const image = useAvatarAssetUrl(store, settings.iconAssetIds[style.id]);
  const savedPrompt = effectiveJournalPrompt(settings, style.id);
  const savedIconPrompt = effectiveJournalIconPrompt(settings, style.id);
  const [prompt, setPrompt] = useState(savedPrompt);
  const [iconPrompt, setIconPrompt] = useState(savedIconPrompt);
  useEffect(() => setPrompt(savedPrompt), [savedPrompt]);
  useEffect(() => setIconPrompt(savedIconPrompt), [savedIconPrompt]);
  return <article className={`harness-journal-style-card${settings.selected === style.id ? ' active' : ''}`}>
    <button type="button" className="harness-journal-style-select" aria-pressed={settings.selected === style.id} onClick={() => onSelect(style.id)}>
      <span className="harness-journal-style-icon" aria-hidden="true">{image ? <img src={image} alt=""/> : <Icon size={23}/>}</span>
      <strong>{style.title}</strong><small>{style.description}</small>
    </button>
    <details><summary>Prompts</summary><label>Writing prompt<textarea rows={4} maxLength={1200} value={prompt} onChange={event => setPrompt(event.target.value)} onBlur={() => { if (prompt.trim() !== savedPrompt) onPrompt(style.id, prompt); }}/></label><label>Icon prompt<textarea rows={3} maxLength={1200} value={iconPrompt} onChange={event => setIconPrompt(event.target.value)} onBlur={() => { if (iconPrompt.trim() !== savedIconPrompt) onIconPrompt(style.id, iconPrompt); }}/></label><button type="button" className="harness-secondary" disabled={busy} onClick={() => { if (iconPrompt.trim() !== savedIconPrompt) onIconPrompt(style.id, iconPrompt); onGenerateIcon(style.id, iconPrompt); }}>{settings.iconAssetIds[style.id] ? 'Regenerate icon' : 'Generate icon'}</button></details>
  </article>;
}

export default function JournalStyleGallery(props: Omit<Parameters<typeof StyleCard>[0], 'style'>) {
  return <div className="harness-journal-style-grid" aria-label="Journal styles">{JOURNAL_STYLES.map(style => <StyleCard key={style.id} {...props} style={style}/>)}</div>;
}
