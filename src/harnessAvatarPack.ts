import { cleanTags } from './harnessData.ts';

export type AvatarPackKind = 'mixed' | 'people' | 'robots' | 'symbols' | 'animals' | 'fantasy' | 'objects';
export type AvatarPackAge = 'any' | 'young-adult' | 'middle-aged' | 'older-adult';
export type AvatarPackGender = 'varied' | 'women' | 'men' | 'nonbinary';
export type AvatarPackOptions = { age?: AvatarPackAge; gender?: AvatarPackGender };
export type AvatarPackItem = { title: string; tags: string[]; prompt: string };

/** Save each image before requesting the next one so a stopped pack keeps its completed work. */
export async function runAvatarPack<T>(items: AvatarPackItem[], signal: AbortSignal,
  generate: (item: AvatarPackItem, index: number) => Promise<Blob>,
  save: (image: Blob, item: AvatarPackItem, index: number) => Promise<T>,
  onSaved: (asset: T, completed: number) => void): Promise<number> {
  let completed = 0;
  for (const [index, item] of items.entries()) {
    if (signal.aborted) break;
    const image = await generate(item, index);
    if (signal.aborted) break;
    const asset = await save(image, item, index);
    completed++;
    onSaved(asset, completed);
  }
  return completed;
}

const SUBJECTS = {
  people: [
    { name: 'Young guide', role: 'guide with a warm expression', age: 'young-adult', agePhrase: 'young adult', tags: ['Person', 'Young Adult'] },
    { name: 'Young inventor', role: 'inventor with an inquisitive expression', age: 'young-adult', agePhrase: 'young adult', tags: ['Person', 'Young Adult'] },
    { name: 'Young storyteller', role: 'storyteller with a lively expression', age: 'young-adult', agePhrase: 'young adult', tags: ['Person', 'Young Adult'] },
    { name: 'Seasoned builder', role: 'builder with a thoughtful expression', age: 'middle-aged', agePhrase: 'middle-aged', tags: ['Person', 'Middle Aged'] },
    { name: 'Creative collaborator', role: 'creative collaborator with a confident expression', age: 'middle-aged', agePhrase: 'middle-aged', tags: ['Person', 'Middle Aged'] },
    { name: 'Field navigator', role: 'field navigator with a focused expression', age: 'middle-aged', agePhrase: 'middle-aged', tags: ['Person', 'Middle Aged'] },
    { name: 'Senior researcher', role: 'researcher with a curious expression', age: 'older-adult', agePhrase: 'older adult', tags: ['Person', 'Older Adult'] },
    { name: 'Senior explorer', role: 'explorer with a spirited expression', age: 'older-adult', agePhrase: 'older adult', tags: ['Person', 'Older Adult'] },
    { name: 'Senior archivist', role: 'archivist with a reflective expression', age: 'older-adult', agePhrase: 'older adult', tags: ['Person', 'Older Adult'] },
  ],
  robots: [
    { name: 'Friendly android', detail: 'a friendly android head with expressive eyes', tags: ['Android', 'Robot'] },
    { name: 'Compact robot', detail: 'a compact helper robot with a distinctive faceplate', tags: ['Robot'] },
    { name: 'Research droid', detail: 'a curious research droid with subtle sensor details', tags: ['Robot', 'Research'] },
    { name: 'Builder automaton', detail: 'a practical builder automaton with a clear silhouette', tags: ['Robot', 'Builder'] },
  ],
  symbols: [
    { name: 'Code emblem', detail: 'an abstract code-bracket emblem with circuit traces', tags: ['Code', 'Symbol'] },
    { name: 'Brain emblem', detail: 'a stylized luminous brain emblem', tags: ['Brain', 'Symbol'] },
    { name: 'Compass emblem', detail: 'a crisp compass rose emblem', tags: ['Compass', 'Symbol'] },
    { name: 'Shield emblem', detail: 'a protective shield emblem', tags: ['Shield', 'Symbol'] },
    { name: 'Spark emblem', detail: 'a radiant spark constellation emblem', tags: ['Spark', 'Symbol'] },
  ],
  animals: [
    { name: 'Corgi companion', detail: 'a cheerful corgi with a distinctive expression', tags: ['Animal', 'Dog'] },
    { name: 'Forest fox', detail: 'an alert fox with expressive eyes', tags: ['Animal', 'Fox'] },
    { name: 'Reef fish', detail: 'a colorful reef fish with a clear silhouette', tags: ['Animal', 'Fish'] },
    { name: 'Garden beetle', detail: 'an iridescent beetle with delicate antennae', tags: ['Animal', 'Bug'] },
    { name: 'Owl scholar', detail: 'an anthropomorphic owl with a curious expression', tags: ['Animal', 'Anthropomorphic'] },
  ],
  fantasy: [
    { name: 'Friendly spirit', detail: 'a gentle translucent spirit with a distinctive expression', tags: ['Spirit', 'Fantasy'] },
    { name: 'Moon visitor', detail: 'an imaginative alien visitor with expressive eyes', tags: ['Alien', 'Fantasy'] },
    { name: 'Story monster', detail: 'a friendly imaginary monster with a playful silhouette', tags: ['Monster', 'Fantasy'] },
    { name: 'Hologram guide', detail: 'a luminous holographic guide with an original face', tags: ['Hologram', 'Fantasy'] },
  ],
  objects: [
    { name: 'Vintage radio', detail: 'a vintage radio with expressive controls and a clear silhouette', tags: ['Object', 'Radio'] },
    { name: 'Clockwork doll', detail: 'an original clockwork doll with expressive features', tags: ['Object', 'Doll'] },
    { name: 'Tiny race car', detail: 'a playful miniature car with a distinct front profile', tags: ['Object', 'Car'] },
    { name: 'Potted fern', detail: 'a lush potted fern with a lively character-like silhouette', tags: ['Object', 'Plant'] },
    { name: 'Brass trumpet', detail: 'a polished brass trumpet with a distinctive curved profile', tags: ['Object', 'Instrument'] },
    { name: 'Space action figure', detail: 'an original articulated space explorer action figure', tags: ['Object', 'Action Figure', 'Toy'] },
    { name: 'Wind-up toy', detail: 'an original wind-up toy with a playful expression', tags: ['Object', 'Toy'] },
    { name: 'Brain sculpture', detail: 'a stylized brain sculpture with expressive contours', tags: ['Object', 'Brain'] },
  ],
};

/** A reproducible set of different subjects; structured people filters also become searchable tags. */
export function avatarPackPlan(kind: AvatarPackKind, count: number, style = '', detail = '', options: AvatarPackOptions = {}): AvatarPackItem[] {
  const age = options.age || 'any';
  const gender = options.gender || 'varied';
  const people = SUBJECTS.people.filter(subject => age === 'any' || subject.age === age);
  const subjects = kind === 'mixed'
    ? [people[0], SUBJECTS.robots[0], SUBJECTS.symbols[0], SUBJECTS.animals[0], SUBJECTS.fantasy[0], SUBJECTS.objects[0],
      people[1 % people.length], SUBJECTS.robots[2], SUBJECTS.animals[4], SUBJECTS.fantasy[2], SUBJECTS.objects[5], SUBJECTS.symbols[1]]
    : kind === 'people' ? people : SUBJECTS[kind];
  const total = Math.max(1, Math.min(24, Math.floor(count) || 4));
  const styleText = style.trim().slice(0, 150);
  const detailText = detail.trim().slice(0, 300);
  const titleCounts = new Map<string, number>();
  let personIndex = 0;
  return Array.from({ length: total }, (_, index) => {
    const subject = subjects[index % subjects.length];
    const variant = (titleCounts.get(subject.name) || 0) + 1;
    titleCounts.set(subject.name, variant);
    const title = `${subject.name}${variant > 1 ? ` ${variant}` : ''}`;
    const isPerson = 'age' in subject;
    const chosenGender = gender === 'varied' ? (['women', 'men', 'nonbinary'] as const)[personIndex % 3] : gender;
    if (isPerson) personIndex++;
    const genderPhrase = chosenGender === 'women' ? 'a woman' : chosenGender === 'men' ? 'a man' : 'a nonbinary person';
    const genderTag = chosenGender === 'women' ? 'Woman' : chosenGender === 'men' ? 'Man' : 'Nonbinary';
    const subjectDetail = isPerson ? `a fictional ${subject.agePhrase} ${subject.role} who is ${genderPhrase}` : subject.detail;
    return {
      title,
      tags: cleanTags([...subject.tags, ...(isPerson ? [genderTag] : []), ...styleText.split(/[,;]/), ...detailText.split(/[,;]/)], 12),
      prompt: `Original square avatar illustration of ${subjectDetail}. ${detailText ? `${detailText}. ` : ''}${styleText ? `Visual direction: ${styleText}. ` : ''}Distinctive silhouette, centered composition, dark teal and violet background, subtle luminous accents, no words, no logos, no recognizable existing characters.`,
    };
  });
}
