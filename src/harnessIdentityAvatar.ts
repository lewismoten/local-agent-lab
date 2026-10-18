import { identityAvatarPath, isoNow, newId, type HarnessIdentity } from './harnessData.ts';

export const IDENTITY_ICONS: { id: NonNullable<HarnessIdentity['icon']>; label: string }[] = [
  { id: 'person', label: 'Person' }, { id: 'robot', label: 'Robot' }, { id: 'code', label: 'Code' },
  { id: 'brain', label: 'Brain' }, { id: 'compass', label: 'Compass' }, { id: 'shield', label: 'Shield' }, { id: 'spark', label: 'Spark' },
];

const PERSONAS: Pick<HarnessIdentity, 'name' | 'focus' | 'icon' | 'instructions'>[] = [
  { name: 'Vega', focus: 'coding', icon: 'robot', instructions: 'Build in small, reviewable steps. Inspect the code before editing, explain tradeoffs, and verify behavior with focused checks.' },
  { name: 'Mira', focus: 'research', icon: 'compass', instructions: 'Explore a question from several angles. Distinguish observed evidence from inference and keep source references close to claims.' },
  { name: 'Quill', focus: 'general', icon: 'person', instructions: 'Help turn rough ideas into clear plans and drafts. Ask for missing details when they affect the result, and preserve the user’s voice.' },
  { name: 'Sable', focus: 'review', icon: 'shield', instructions: 'Look for concrete risks, edge cases, and contradictions. Report the highest impact findings first and suggest practical fixes.' },
  { name: 'Niko', focus: 'coding', icon: 'code', instructions: 'Prefer simple, maintainable code. Trace behavior through the relevant files and include a concise verification summary.' },
  { name: 'Lyra', focus: 'research', icon: 'brain', instructions: 'Connect related ideas across documents, note uncertainty, and suggest the next useful question or experiment.' },
];

export function identityDraft(index: number, existingNames: string[] = [], now = isoNow()): HarnessIdentity {
  const persona = PERSONAS[Math.abs(Math.trunc(index)) % PERSONAS.length];
  const taken = new Set(existingNames.map(name => name.toLocaleLowerCase()));
  let name = persona.name;
  for (let suffix = 2; taken.has(name.toLocaleLowerCase()); suffix++) name = `${persona.name} ${suffix}`;
  return { ...persona, name, id: newId(), createdAt: now, updatedAt: now };
}

export function identityAvatarPrompt(identity: Pick<HarnessIdentity, 'name' | 'focus' | 'icon'>): string {
  const focus = identity.focus === 'coding' ? 'software builder' : identity.focus === 'research' ? 'research guide' : identity.focus === 'review' ? 'careful reviewer' : 'creative assistant';
  const motif = {
    person: 'a friendly fictional person, centered head and shoulders',
    robot: 'an expressive robot head with distinctive features',
    code: 'an abstract code-bracket emblem with subtle circuit traces',
    brain: 'a stylized luminous brain emblem',
    compass: 'a crisp compass rose emblem',
    shield: 'a protective shield emblem',
    spark: 'a radiant spark or small constellation emblem',
  }[identity.icon || 'person'];
  return `Original square avatar illustration for a fictional ${focus}${identity.name.trim() ? ` named ${identity.name.trim()}` : ''}. Show ${motif}. Clear silhouette, dark teal and violet background, subtle luminous accents, clean illustration, no words, no logos.`;
}

/** Normalize uploads and generated images to a compact, portable PNG. */
export async function compactIdentityAvatar(source: Blob): Promise<Blob> {
  if (!source.type.startsWith('image/') || !source.size || source.size > 10_000_000) throw new Error('Choose an image under 10 MB.');
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot resize avatar images.');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode avatar image.')), 'image/png'));
    if (blob.size > 512_000) throw new Error('The avatar image is too large after resizing.');
    return blob;
  } finally { bitmap.close(); }
}

export const validIdentityAvatarPath = (identity: HarnessIdentity): boolean => identity.avatarPath === identityAvatarPath(identity.id);
