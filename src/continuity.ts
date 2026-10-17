import { complete, parseJson, type AIConfig } from './ai';
import type { BrowserTools } from './browserModel';
import { now, projectFiles, uid, type ContinuityIssue, type ContinuityReport, type Project } from './model';

const categories = ['Continuity error', 'Paradox', 'Conflicting fact', 'Plot hole', 'Anachronism', 'Internal inconsistency', 'Unreliable narrator', 'Retroactive continuity'];
function issue(category: string, summary: string, evidence: string, paths: string[], question: string): ContinuityIssue {
  return { id: uid(), category, severity: 'medium', summary, evidence, paths, question, status: 'open', resolution: '' };
}
function ruleFindings(project: Project): ContinuityIssue[] {
  const found: ContinuityIssue[] = [];
  const names = new Map<string, string>();
  const positions = new Map<number, string>();
  for (const character of project.characters) {
    const path = `world/characters/${character.id}.json`;
    const key = character.name.trim().toLowerCase();
    if (key && names.has(key)) found.push(issue('Conflicting fact', `Two character records use “${character.name}”.`, 'Duplicate canonical character name.', [names.get(key)!, path], 'Are these the same person, or should one name change?'));
    if (key) names.set(key, path);
    for (const relation of character.relationships) if (relation.characterId && !project.characters.some(x => x.id === relation.characterId)) found.push(issue('Internal inconsistency', `${character.name} has a relationship to a missing character.`, relation.description, [path], 'Should the missing character be restored or this relationship removed?'));
  }
  for (const book of project.books) {
    const bookPath = `books/${book.id}/book.json`;
    if (positions.has(book.position)) found.push(issue('Continuity error', `Two books occupy series position ${book.position}.`, 'Duplicate series position.', [positions.get(book.position)!, bookPath], 'What is the intended reading order?'));
    positions.set(book.position, bookPath);
    for (const ref of book.referenceBookIds) {
      if (ref === book.id) found.push(issue('Paradox', `${book.title} references itself as an earlier book.`, 'Self-reference in referenceBookIds.', [bookPath], 'Should this reference be removed?'));
      else if (!project.books.some(x => x.id === ref)) found.push(issue('Internal inconsistency', `${book.title} references a missing book.`, `Reference ID: ${ref}`, [bookPath], 'Which book should this reference point to?'));
    }
    for (const sourceId of book.sourceIds) if (!project.sources.some(x => x.id === sourceId)) found.push(issue('Internal inconsistency', `${book.title} references a missing source.`, `Source ID: ${sourceId}`, [bookPath], 'Should this source be restored or unlinked?'));
    const numbers = new Map<number, string>();
    for (const chapter of book.chapters) {
      const path = `books/${book.id}/chapters/${chapter.id}.json`;
      if (numbers.has(chapter.number)) found.push(issue('Continuity error', `${book.title} has two chapters numbered ${chapter.number}.`, 'Duplicate chapter number.', [numbers.get(chapter.number)!, path], 'What is the intended chapter order?'));
      numbers.set(chapter.number, path);
    }
  }
  return found;
}

export async function checkContinuity(project: Project, config: AIConfig, useAI: boolean, tools?: BrowserTools, focus = ''): Promise<ContinuityReport> {
  const files = projectFiles(project);
  const paths = Object.keys(files).filter(path => !path.startsWith('world/reviews/'));
  const findings = ruleFindings(project);
  let aiSections = 0;
  let totalSections = 0;
  let aiError = '';
  const reviewedPaths = new Set<string>();
  if (useAI) {
    const capacity = Math.max(1200, Math.min(12000, Math.floor((config.contextWindow - config.maxOutputTokens - 850) * 2.3)));
    const index = JSON.stringify({ title: project.title, format: project.format, premise: project.premise, audience: project.audience, readingLevel: project.readingLevel,
      characters: project.characters.map(x => `${x.name}: ${x.role}; ${x.background.slice(0, 120)}`),
      books: project.books.map(x => `${x.position}. ${x.title}: ${x.premise.slice(0, 120)}`),
      world: project.world.map(x => `${x.title}: ${x.details.slice(0, 120)}`),
    }).slice(0, Math.min(2200, Math.floor(capacity / 3)));
    const sections = paths.flatMap(path => {
      const text = files[path];
      const size = Math.max(900, capacity - index.length - 300);
      return Array.from({ length: Math.max(1, Math.ceil(text.length / size)) }, (_, n) => ({ path, text: `FILE ${path} · part ${n + 1}\n${text.slice(n * size, (n + 1) * size)}` }));
    });
    totalSections = sections.length;
    const partCounts = new Map<string, number>();
    const reviewedCounts = new Map<string, number>();
    sections.forEach(section => partCounts.set(section.path, (partCounts.get(section.path) || 0) + 1));
    for (const section of sections) {
      try {
        const prompt = `Review this story canon section against the project index. Look for evidenced continuity errors, paradoxes, conflicting facts, plot holes, anachronisms, internal inconsistencies, unreliable narrator discrepancies, and retroactive continuity. An unreliable narrator or deliberate retcon may be intentional: frame it as a question. Do not invent facts. Return only JSON: {"issues":[{"category":"one of ${categories.join(' | ')}","severity":"high | medium | low","summary":"brief","evidence":"specific conflicting facts or a short quote","paths":["exact file path"],"question":"what the writer should decide"}]}. Return an empty array when this section provides no evidence. Limit to 6 issues.\n\nWRITER'S FOCUS: ${focus.slice(0, 500)}\n\nPROJECT INDEX:\n${index}\n\n${section.text}`;
        const result = await complete({ ...config, maxOutputTokens: Math.min(config.maxOutputTokens, 1100) }, [{ role: 'user', content: prompt }], 'You are a careful continuity editor. Return valid JSON only. Flag uncertainty; never treat a possible intentional reveal as a proven error.', undefined, tools);
        const parsed = parseJson<{ issues?: Partial<ContinuityIssue>[] }>(result.text);
        for (const item of Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6) : []) {
          const cited = Array.isArray(item.paths) ? item.paths.filter(path => typeof path === 'string' && paths.includes(path)) : [];
          if (!item.summary || !item.evidence || !cited.length) continue;
          findings.push({ id: uid(), category: categories.includes(item.category || '') ? item.category! : 'Internal inconsistency', severity: ['high', 'medium', 'low'].includes(item.severity || '') ? item.severity! : 'medium', summary: String(item.summary).slice(0, 300), evidence: String(item.evidence).slice(0, 900), paths: cited, question: String(item.question || 'How should this be resolved?').slice(0, 400), status: 'open', resolution: '' });
        }
        aiSections++;
        const count = (reviewedCounts.get(section.path) || 0) + 1;
        reviewedCounts.set(section.path, count);
        if (count === partCounts.get(section.path)) reviewedPaths.add(section.path);
      } catch (error) { aiError = error instanceof Error ? error.message : String(error); break; }
    }
  }
  const deduped = [...new Map(findings.map(x => [`${x.category}|${x.summary.toLowerCase()}`, x])).values()];
  const summary = `${deduped.length ? `${deduped.length} possible issue${deduped.length === 1 ? '' : 's'} found.` : 'No issues found in the material checked.'} ${useAI ? `AI reviewed ${aiSections} of ${totalSections} file sections.${aiError ? ` Review stopped: ${aiError}` : ' This is a review aid, not a guarantee of perfect continuity.'}` : 'Only structural rules ran because no ready AI model was selected.'}`;
  return { id: uid(), updatedAt: now(), title: `Continuity review · ${new Date().toLocaleString()}`, checkedPaths: [...reviewedPaths], issues: deduped, summary, model: useAI ? `${config.provider}: ${config.model}` : 'Structural rules only' };
}
