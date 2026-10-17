import type { StoryGraph, StoryUnit, StoryMention } from './model';

type KnownCharacter = { id: string; name: string };
const idFor = (sourceId: string, kind: string, index: number, evidence = '') => {
  let hash = 2166136261;
  for (const char of evidence) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${sourceId}:${kind}:${index}:${(hash >>> 0).toString(36)}`;
};
const clean = (line: string) => line.replace(/^\s*(?:#{1,6}\s*|[-*]\s*)/, '').trim();
const heading = /^(?:(book|volume|novel|part|chapter|story|outline|theme|arc)\s*(?:#?\s*([0-9IVX]+))?\s*[:.\-–—]?\s*)(.*)$/i;
const titled = /^(?:character|person|pov|protagonist|location|place|setting|event|time|date)\s*:\s*(.+)$/i;
const timeframeOf = (line: string) => line.match(/\b(?:\d{4}\s*(?:BC|BCE|AD|CE)?|(?:spring|summer|autumn|fall|winter)\s+\d{4}|(?:morning|afternoon|evening|night)|(?:day|year|month)\s+\d+)\b/i)?.[0];
const ageOf = (line: string) => line.match(/\b(?:age(?:d)?\s*[: ]?\s*\d{1,3}|\d{1,3}\s*years?\s*old)\b/i)?.[0];
const healthOf = (line: string) => line.match(/\b(?:healthy|injured|wounded|ill|sick|pregnant|disabled|dying|recovered|blind|deaf)\b/i)?.[0];
const nameKey = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
export async function analyzeDocument(sourceId: string, text: string, knownCharacters: KnownCharacter[], checkpoint: () => Promise<void> = async () => {}): Promise<StoryGraph> {
  const graph: StoryGraph = { units: [], arcs: [], mentions: [], events: [], suggestions: [] };
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const properNames = new Map<string, number>();
  for (let index = 0; index < lines.length; index++) {
    if (index % 80 === 0) await checkpoint();
    for (const match of lines[index].matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g)) {
      const name = match[0];
      if (/^(?:Book|Chapter|Part|Story|Volume|Novel|Theme|Outline|Arc|The|This|That|New|Once|Event|Location|Character)\b/.test(name)) continue;
      properNames.set(name, (properNames.get(name) || 0) + 1);
    }
  }
  const repeatedNames = [...properNames].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 200);
  const current: Partial<Record<StoryUnit['kind'], string>> = {};
  const names = new Map(knownCharacters.filter(c => c.name.trim() && c.name !== 'New character').map(c => [nameKey(c.name), c]));
  const mentionKeys = new Set<string>();
  let activeUnit: string | undefined;
  let listMode: 'book' | 'story' | 'chapter' | undefined;
  const closest = (kind: StoryUnit['kind']) => current[kind];
  const parentFor = (kind: StoryUnit['kind']) => kind === 'book' ? undefined : kind === 'part' || kind === 'outline' || kind === 'theme' ? closest('book') : kind === 'story' ? closest('part') || closest('book') : closest('story') || closest('part') || closest('book');
  const addMention = (kind: StoryMention['kind'], name: string, line: string, unitId = activeUnit) => {
    name = name.replace(/[.,;:]+$/, '').trim();
    if (!name || name.length > 80) return;
    const key = `${kind}:${nameKey(name)}:${unitId || ''}:${line.slice(0, 70)}`;
    if (mentionKeys.has(key)) return;
    mentionKeys.add(key);
    const canonical = names.get(nameKey(name));
    graph.mentions.push({ id: idFor(sourceId, 'mention', graph.mentions.length, line), sourceId, kind, name, entityKey: `${kind}:${nameKey(name)}`, unitId, characterId: canonical?.id,
      age: kind === 'character' ? ageOf(line) : undefined, health: kind === 'character' ? healthOf(line) : undefined,
      location: line.match(/\b(?:in|at|near)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})/)?.[1], timeframe: timeframeOf(line), evidence: line.slice(0, 350), status: 'proposed' });
  };
  for (let index = 0; index < lines.length && index < 20000; index++) {
    const line = lines[index];
    if (index % 80 === 0) await checkpoint();
    if (/^(?:books|novels|stories|chapters)\s*:?$/i.test(line)) { listMode = /^(?:books|novels)/i.test(line) ? 'book' : /^stories/i.test(line) ? 'story' : 'chapter'; continue; }
    const listed = listMode && line.match(/^(\d+)[.)]\s+(.{2,100})$/);
    const match = listed ? [line, listMode, listed[1], listed[2]] : line.match(heading);
    if (match && (line.length < 125 || /^(?:book|part|chapter|story|arc)\b/i.test(line))) {
      const raw = match[1]!.toLowerCase();
      const kind: StoryUnit['kind'] | 'arc' = raw === 'volume' || raw === 'novel' ? 'book' : raw as StoryUnit['kind'] | 'arc';
      const title = (match[3] || '').trim() || `${raw[0].toUpperCase()}${raw.slice(1)} ${match[2] || ''}`.trim();
      if (kind === 'arc') graph.arcs.push({ id: idFor(sourceId, 'arc', graph.arcs.length, line), sourceId, title, unitId: activeUnit, evidence: line, status: 'proposed' });
      else {
        const unit: StoryUnit = { id: idFor(sourceId, 'unit', graph.units.length, line), sourceId, kind, title, parentId: parentFor(kind), ordinal: /^\d+$/.test(match[2] || '') ? Number(match[2]) : undefined, evidence: line, status: 'proposed' };
        graph.units.push(unit); activeUnit = unit.id; current[kind] = unit.id;
        if (kind === 'book') { delete current.part; delete current.story; delete current.chapter; }
        if (kind === 'part') { delete current.story; delete current.chapter; }
        if (kind === 'story') delete current.chapter;
      }
    }
    const field = line.match(titled);
    if (field) {
      const label = line.split(':')[0].toLowerCase();
      if (['character', 'person', 'pov', 'protagonist'].includes(label)) addMention('character', field[1].split(/[,;]|\s+\(/)[0], line);
      if (['location', 'place', 'setting'].includes(label)) addMention('place', field[1].split(/[,;]/)[0], line);
      if (label === 'event') graph.events.push({ id: idFor(sourceId, 'event', graph.events.length, line), sourceId, title: field[1].slice(0, 100), unitId: activeUnit, timeframe: timeframeOf(line), location: line.match(/\b(?:in|at|near)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})/)?.[1], characterNames: [...names.values()].filter(c => line.toLowerCase().includes(c.name.toLowerCase())).map(c => c.name), evidence: line.slice(0, 350), status: 'proposed' });
    }
    for (const character of knownCharacters) {
      if (character.name.length < 3 || character.name === 'New character') continue;
      const pattern = new RegExp(`(^|[^\\p{L}])${character.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu');
      if (pattern.test(line)) addMention('character', character.name, line);
    }
    for (const [name] of repeatedNames) {
      if (names.has(nameKey(name)) || !line.includes(name)) continue;
      if (/\b(?:in|at|near|from)\s+$/.test(line.slice(0, line.indexOf(name)))) addMention('place', name, line);
      else addMention('character', name, line);
    }
    if (/^(?:\d{4}\s*[:–-]|on\s+\w+\s+\d{1,2},?\s+\d{4}\s*[:–-])/i.test(line)) graph.events.push({ id: idFor(sourceId, 'event', graph.events.length, line), sourceId, title: line.slice(0, 100), unitId: activeUnit, timeframe: timeframeOf(line), characterNames: knownCharacters.filter(c => line.toLowerCase().includes(c.name.toLowerCase())).map(c => c.name), evidence: line.slice(0, 350), status: 'proposed' });
    if (/\b(?:visited|arrived|departed|left|died|born|met)\b/i.test(line) && !graph.events.some(x => x.evidence === line) && (timeframeOf(line) || graph.mentions.some(x => x.evidence === line))) {
      graph.events.push({ id: idFor(sourceId, 'event', graph.events.length, line), sourceId, title: line.slice(0, 100), unitId: activeUnit, timeframe: timeframeOf(line), location: line.match(/\b(?:in|at|near|to)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})/)?.[1], characterNames: graph.mentions.filter(x => x.kind === 'character' && x.evidence === line).map(x => x.name), evidence: line.slice(0, 350), status: 'proposed' });
    }
    if (/^theme\b/i.test(line) && graph.suggestions.length < 12) graph.suggestions.push({ id: idFor(sourceId, 'suggestion', graph.suggestions.length), sourceId, title: `Develop ${line.slice(0, 65)}`, detail: `Clarify how this theme changes characters' choices across the story: ${line.slice(0, 250)}`, category: 'Other', evidence: line, status: 'proposed' });
  }
  for (const arc of graph.arcs) {
    const at = lines.findIndex(line => line === arc.evidence);
    const context = lines.slice(at, at + 7).join(' ');
    const start = context.match(/\b(?:starts?|begins?|introduced)\s+(?:in|at)\s+((?:book|part|chapter|story)\s*\d+[^,;.]*?)(?=\s+(?:and|ends?|concludes?)\b|[.;]|$)/i)?.[1];
    const end = context.match(/\b(?:ends?|concludes?|resolves?)\s+(?:in|at)\s+((?:book|part|chapter|story)\s*\d+[^,;.]*)/i)?.[1];
    const bookOf = (unitId?: string): string | undefined => {
      let unit = graph.units.find(x => x.id === unitId);
      while (unit && unit.kind !== 'book') unit = graph.units.find(x => x.id === unit?.parentId);
      return unit?.id;
    };
    const arcBook = bookOf(arc.unitId);
    const resolve = (term?: string) => {
      if (!term) return undefined;
      const match = term.match(/^(book|part|chapter|story)\s*(\d+)/i);
      if (match) return graph.units.find(unit => unit.kind === match[1].toLowerCase() && unit.ordinal === Number(match[2]) && (unit.kind === 'book' || bookOf(unit.id) === arcBook))?.id || graph.units.find(unit => unit.kind === match[1].toLowerCase() && unit.ordinal === Number(match[2]))?.id;
      return graph.units.find(unit => term.toLowerCase().includes(unit.title.toLowerCase()) || unit.title.toLowerCase().includes(term.toLowerCase()))?.id;
    };
    arc.startUnitId = resolve(start); arc.endUnitId = resolve(end);
    if (start || end) arc.evidence = context.slice(0, 350);
  }
  if (graph.units.length && !graph.arcs.length) graph.suggestions.push({ id: idFor(sourceId, 'suggestion', graph.suggestions.length), sourceId, title: 'Trace a story arc', detail: 'Which chapter or story introduces a major change, and where does it resolve?', category: 'Other', evidence: graph.units[0].evidence, status: 'proposed' });
  return graph;
}
