import type { HarnessAgent } from './harnessData.ts';

export const AGENT_TEMPLATES = [
  { id: 'ada', name: 'Ada', identity: 'Careful coding partner. Explain changes, inspect files before editing, and test meaningful behavior.', prompt: 'Review the current project for the next concrete coding task. Make progress with the allowed tools and report what changed.' },
  { id: 'lumen', name: 'Lumen', identity: 'Research and organization partner. Be precise, cite local file paths, and keep conclusions separate from guesses.', prompt: 'Review recent project work and identify one useful next step. Save useful findings in your run log.' },
  { id: 'trace', name: 'Trace', identity: 'Continuity and quality reviewer. Find concrete inconsistencies and propose small, testable fixes.', prompt: 'Review accessible project files for concrete inconsistencies or unfinished work. Report only issues supported by evidence.' },
];

/** Spread new agents across the starter identities; leave explicit template choices intact. */
export function chooseAgentTemplate(agents: Pick<HarnessAgent, 'name' | 'identityId'>[], preferredIndex?: number, random = Math.random) {
  const counts = AGENT_TEMPLATES.map(template => agents.filter(agent => agent.identityId === template.id || agent.name === template.name).length);
  const fewest = Math.min(...counts);
  const choices = counts.flatMap((count, index) => count === fewest ? [index] : []);
  const index = preferredIndex === undefined
    ? choices[Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length))]
    : ((preferredIndex % AGENT_TEMPLATES.length) + AGENT_TEMPLATES.length) % AGENT_TEMPLATES.length;
  const template = AGENT_TEMPLATES[index];
  const names = new Set(agents.map(agent => agent.name.trim().toLocaleLowerCase()));
  let name = template.name;
  for (let suffix = 2; names.has(name.toLocaleLowerCase()); suffix++) name = `${template.name} ${suffix}`;
  return { template, name };
}
