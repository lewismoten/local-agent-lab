import type { Project, ProposalStatus, Source, StoryGraph } from './model';
import './sourceAnalysis.css';

type Kind = keyof StoryGraph;
type Props = {
  project: Project; source: Source; paused: boolean; busy: boolean;
  onStatus: (kind: Kind, id: string, status: ProposalStatus) => void;
  onAcceptAll: () => void; onReanalyze: () => void; onEnrich: () => void;
  onCreateCharacter: (name: string) => void; onApplyStructure: () => void;
};

export default function SourceAnalysisPanel({ project, source, paused, busy, onStatus, onAcceptAll, onReanalyze, onEnrich, onCreateCharacter, onApplyStructure }: Props) {
  const graph = project.storyGraph;
  const units = graph.units.filter(x => x.sourceId === source.id && x.status !== 'dismissed');
  const arcs = graph.arcs.filter(x => x.sourceId === source.id && x.status !== 'dismissed');
  const mentions = graph.mentions.filter(x => x.sourceId === source.id && x.status !== 'dismissed');
  const events = graph.events.filter(x => x.sourceId === source.id && x.status !== 'dismissed');
  const findings = [...units, ...arcs, ...mentions, ...events];
  const pendingCount = findings.filter(x => x.status === 'proposed' && !x.stale).length;
  const staleCount = findings.filter(x => x.status === 'proposed' && x.stale).length;
  const unitName = (id?: string) => units.find(x => x.id === id)?.title || '';
  const row = (kind: Kind, item: StoryGraph[Kind][number], title: string, detail: string) => <div className="analysis-row" key={item.id}>
    <div><strong>{title}</strong><p>{detail}</p><small>{item.evidence}</small></div>
    <div className="analysis-actions"><span className={`analysis-status ${item.status}`}>{'stale' in item && item.stale ? 'Evidence changed' : item.status}</span>{item.status === 'proposed' && <><button onClick={() => onStatus(kind, item.id, 'accepted')}>Accept</button><button onClick={() => onStatus(kind, item.id, 'dismissed')}>Dismiss</button></>}{item.status === 'accepted' && <button onClick={() => onStatus(kind, item.id, 'proposed')}>Review again</button>}</div>
  </div>;
  return <section className="page source-analysis-page">
    <div className="subsection-heading"><div><h3>Story map from {source.name}</h3><p>Accept this document’s findings together, or open a section to review them.</p></div><div>
      <button className="button primary compact" disabled={!pendingCount} title="Accept proposed findings from this document. Changed evidence stays for review." onClick={onAcceptAll}>Accept all{pendingCount ? ` (${pendingCount})` : ''}</button>
      <button className="button secondary compact" onClick={onReanalyze}>Analyze again</button>
      <button className="button secondary compact" disabled={busy} onClick={onEnrich}>Find more with AI</button>
      <button className="button secondary compact" disabled={!units.some(x => x.status === 'accepted' && x.kind === 'book')} onClick={onApplyStructure}>Apply accepted books and chapters</button>
    </div></div>
    <p className="analysis-progress" role="status">{paused && (source.analysisStatus === 'pending' || source.analysisStatus === 'running') ? 'Paused while you chat' : source.analysisStatus === 'running' ? 'Analyzing in the background…' : source.analysisStatus === 'pending' || !source.analysisStatus ? 'Waiting to analyze…' : source.analysisStatus === 'error' ? `Analysis failed: ${source.analysisError}` : `${units.length} sections · ${arcs.length} arcs · ${mentions.length} mentions · ${events.length} events${staleCount ? ` · ${staleCount} changed findings need review` : ''}`}</p>
    {!!units.length && <details className="analysis-card"><summary><strong>Books, parts, stories, chapters, and themes</strong><span>{units.length}</span></summary><div className="analysis-tree">{units.map(unit => <div className="analysis-tree-item" key={unit.id} style={{ marginLeft: unit.kind === 'book' ? 0 : unit.kind === 'part' ? 16 : unit.kind === 'story' ? 32 : unit.kind === 'chapter' ? 48 : 16 }}><span>{unit.kind}</span><strong>{unit.title}</strong><small>{unit.stale ? 'Evidence changed · ' : ''}{unit.parentId ? `in ${unitName(unit.parentId)}` : ''}</small><button onClick={() => onStatus('units', unit.id, unit.status === 'accepted' ? 'proposed' : 'accepted')}>{unit.status === 'accepted' ? 'Accepted' : 'Accept'}</button></div>)}</div></details>}
    {!!arcs.length && <details className="analysis-card"><summary><strong>Arcs</strong><span>{arcs.length}</span></summary>{arcs.map(x => row('arcs', x, x.title, `${unitName(x.startUnitId) || 'Start unclear'} → ${unitName(x.endUnitId) || 'End unclear'}`))}</details>}
    {!!mentions.length && <details className="analysis-card"><summary><strong>People and places across the story</strong><span>{mentions.length}</span></summary>{mentions.map(x => <div key={x.id}>{row('mentions', x, `${x.kind === 'character' ? 'Person' : 'Place'}: ${x.name}`, [unitName(x.unitId), x.age, x.health, x.location, x.timeframe, x.characterId ? 'Linked to character file' : '', `${graph.mentions.filter(y => y.entityKey === x.entityKey && y.status !== 'dismissed').length} linked mention(s)`].filter(Boolean).join(' · '))}{x.kind === 'character' && !x.characterId && <button className="analysis-create" onClick={() => onCreateCharacter(x.name)}>Create character file</button>}</div>)}</details>}
    {!!events.length && <details className="analysis-card"><summary><strong>Events and time clues</strong><span>{events.length}</span></summary>{events.map(x => row('events', x, x.title, [unitName(x.unitId), x.timeframe, x.location, ...(x.characterNames || [])].filter(Boolean).join(' · ')))}</details>}
    {!findings.length && source.analysisStatus === 'ready' && <p className="muted">No explicit headings or entity labels were found. Add Book, Chapter, Character, Location, Arc, or Event labels in the source text and analyze again.</p>}
  </section>;
}
