import type { SpeechModelId } from './speechManifest.ts';

export type VoiceSample = {
  id: string; name: string; language: SpeechModelId; text: string; file: string; recordedAt: string;
  version?: string; company?: string; license?: string; fileBytes?: number; durationSeconds?: number;
};
export type VoiceSampleDetails = Pick<VoiceSample, 'name' | 'language' | 'text' | 'version' | 'company' | 'license'>;
export const VOICE_PASSAGES: Record<SpeechModelId, string[]> = {
  'english_2026-04': [
    'The river remembers every name. Mara paused, breathed in, and said, “We can begin again.”',
    'On Thursday, October seventeenth, at 7:45, she counted twelve lanterns along the shore.',
    'A bright blue bird flew beyond the bridge; the quiet rain changed to thunder.',
  ],
  german: [
    'Der Fluss erinnert sich an jeden Namen. Mara hielt inne und sagte: „Wir können neu beginnen.“',
    'Am Donnerstag um sieben Uhr fünfundvierzig zählte sie zwölf Laternen am Ufer.',
    'Ein blauer Vogel flog über die Brücke, während der Regen stärker wurde.',
  ],
  spanish: [
    'El río recuerda cada nombre. Mara hizo una pausa y dijo: «Podemos empezar de nuevo».',
    'El jueves, a las siete y cuarenta y cinco, contó doce faroles junto a la orilla.',
    'Un pájaro azul cruzó el puente mientras la lluvia tranquila se convirtió en tormenta.',
  ],
  kokoro_q8: [
    'The river remembers every name. Mara paused, breathed in, and said, “We can begin again.”',
    'On Thursday, October seventeenth, at 7:45, she counted twelve lanterns along the shore.',
    'A bright blue bird flew beyond the bridge; the quiet rain changed to thunder.',
  ],
  chatterbox_q4f16: [
    'The river remembers every name. Mara paused, breathed in, and said, “We can begin again.”',
    'I thought the map was lost forever! Now we can finally go home.',
    'A bright blue bird flew beyond the bridge; the quiet rain changed to thunder.',
  ],
  chatterbox_turbo_q4f16: [
    'The river remembers every name. Mara paused, breathed in, and said, “We can begin again.”',
    '[chuckle] I never expected the old bridge to remember us.',
    'A bright blue bird flew beyond the bridge; the quiet rain changed to thunder.',
    '[laugh] You found the map! I thought it was lost forever.',
  ],
  openvoice_v2_q8: [
    'The river remembers every name. Mara paused, breathed in, and said, “We can begin again.”',
  ],
  qwen3_tts_17b_q4: [
    'The river remembers every name. Mara paused, breathed in, and said, “We can begin again.”',
    'On Thursday, October seventeenth, at 7:45, she counted twelve lanterns along the shore.',
    'A bright blue bird flew beyond the bridge; the quiet rain changed to thunder.',
  ],
};

export async function writeWorkspaceFile(dir: FileSystemDirectoryHandle, name: string, value: Blob | string) {
  const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writer.write(value);
  await writer.close();
}

async function sampleDirectory(folder: FileSystemDirectoryHandle, create = false) {
  const voices = await folder.getDirectoryHandle('voices', { create });
  return voices.getDirectoryHandle('samples', { create });
}

export async function listVoiceSamples(folder: FileSystemDirectoryHandle): Promise<VoiceSample[]> {
  let dir: FileSystemDirectoryHandle;
  try { dir = await sampleDirectory(folder); }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return []; throw error; }
  const items: VoiceSample[] = [];
  for await (const [name, handle] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    try {
      const item = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()) as VoiceSample;
      if (/^[\w-]+$/.test(item.id) && /^[\w-]+\.(?:ogg|wav|m4a|webm)$/i.test(item.file) && item.language && typeof item.text === 'string') items.push(item);
    } catch { /* Leave unrelated files alone. */ }
  }
  return items.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

function audioExtension(audio: Blob) {
  return audio.type.includes('ogg') ? 'ogg' : audio.type.includes('wav') ? 'wav' : audio.type.includes('mp4') ? 'm4a' : 'webm';
}

export async function saveVoiceSample(folder: FileSystemDirectoryHandle, details: VoiceSampleDetails, audio: Blob, durationSeconds?: number, previous?: VoiceSample) {
  if (!audio.size || audio.size > 30 * 1024 * 1024) throw new Error('Keep voice samples between 1 byte and 30 MB.');
  const id = previous?.id || crypto.randomUUID();
  const file = `${crypto.randomUUID()}.${audioExtension(audio)}`;
  const item: VoiceSample = { ...previous, id, ...details, name: details.name.trim() || 'Voice sample', version: details.version?.trim() || '', company: details.company?.trim() || '', license: details.license?.trim() || '', file, recordedAt: new Date().toISOString(), fileBytes: audio.size, durationSeconds: durationSeconds && Number.isFinite(durationSeconds) ? durationSeconds : undefined };
  const dir = await sampleDirectory(folder, true);
  await writeWorkspaceFile(dir, file, audio);
  await writeWorkspaceFile(dir, `${id}.json`, JSON.stringify(item, null, 2));
  if (previous?.file && previous.file !== file) await dir.removeEntry(previous.file).catch(() => {});
  window.dispatchEvent(new Event('voice-samples-changed'));
  return item;
}

export async function updateVoiceSample(folder: FileSystemDirectoryHandle, previous: VoiceSample, details: VoiceSampleDetails) {
  const item: VoiceSample = { ...previous, ...details, name: details.name.trim() || 'Voice sample', version: details.version?.trim() || '', company: details.company?.trim() || '', license: details.license?.trim() || '' };
  await writeWorkspaceFile(await sampleDirectory(folder), `${item.id}.json`, JSON.stringify(item, null, 2));
  window.dispatchEvent(new Event('voice-samples-changed'));
  return item;
}

export async function readVoiceSample(folder: FileSystemDirectoryHandle, item: VoiceSample) {
  return (await (await sampleDirectory(folder)).getFileHandle(item.file)).getFile();
}
