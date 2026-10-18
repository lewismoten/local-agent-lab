import { MESSAGE_CHUNK_SIZE, type HarnessManifest } from './harnessData.ts';
import type { HarnessStore } from './harnessStore.ts';

export type AchievementMetric = 'conversations' | 'messagesSent' | 'messagesReceived' | 'inputTokens' | 'outputTokens' | 'responseSeconds' | 'models' | 'modelTypes' | 'generatedArtwork' | 'toolCalls' | 'projects';
export type AchievementCounts = Record<AchievementMetric, number>;
export type Achievement = { id: string; title: string; description: string; icon: string; metric: AchievementMetric; target: number; follows?: string; secret?: boolean };

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-conversation', title: 'First contact', description: 'Start a conversation.', icon: '💬', metric: 'conversations', target: 1 },
  { id: 'five-conversations', title: 'Conversation trail', description: 'Start 5 conversations.', icon: '🗺️', metric: 'conversations', target: 5, follows: 'first-conversation' },
  { id: 'twenty-five-conversations', title: 'Many paths', description: 'Start 25 conversations.', icon: '🪐', metric: 'conversations', target: 25, follows: 'five-conversations', secret: true },
  { id: 'first-message', title: 'Say hello', description: 'Send a message.', icon: '✉️', metric: 'messagesSent', target: 1 },
  { id: 'hundred-messages', title: 'The long conversation', description: 'Send 100 messages.', icon: '📚', metric: 'messagesSent', target: 100, follows: 'first-message' },
  { id: 'first-answer', title: 'A reply arrives', description: 'Receive a model answer.', icon: '✨', metric: 'messagesReceived', target: 1 },
  { id: 'input-1k', title: 'A thousand in', description: 'Process 1,000 recorded input tokens.', icon: '⌨️', metric: 'inputTokens', target: 1_000 },
  { id: 'input-10k', title: 'Deep context', description: 'Process 10,000 recorded input tokens.', icon: '📥', metric: 'inputTokens', target: 10_000, follows: 'input-1k' },
  { id: 'input-100k', title: 'Long memory', description: 'Process 100,000 recorded input tokens.', icon: '🧠', metric: 'inputTokens', target: 100_000, follows: 'input-10k', secret: true },
  { id: 'output-1k', title: 'A thousand out', description: 'Receive 1,000 recorded output tokens.', icon: '📝', metric: 'outputTokens', target: 1_000 },
  { id: 'output-10k', title: 'Pages of answers', description: 'Receive 10,000 recorded output tokens.', icon: '📖', metric: 'outputTokens', target: 10_000, follows: 'output-1k' },
  { id: 'response-minute', title: 'Patient listener', description: 'Accumulate 1 minute of recorded model response time.', icon: '⏱️', metric: 'responseSeconds', target: 60 },
  { id: 'response-hour', title: 'Long session', description: 'Accumulate 1 hour of recorded model response time.', icon: '⌛', metric: 'responseSeconds', target: 3_600, follows: 'response-minute', secret: true },
  { id: 'two-models', title: 'Model explorer', description: 'Receive answers from 2 different models.', icon: '🔭', metric: 'models', target: 2 },
  { id: 'five-models', title: 'Model collector', description: 'Receive answers from 5 different models.', icon: '🤖', metric: 'models', target: 5, follows: 'two-models' },
  { id: 'two-model-types', title: 'Crossed signals', description: 'Receive answers through 2 model or provider types.', icon: '🎛️', metric: 'modelTypes', target: 2 },
  { id: 'first-image', title: 'First image', description: 'Generate an image.', icon: '🎨', metric: 'generatedArtwork', target: 1 },
  { id: 'ten-images', title: 'Gallery maker', description: 'Generate 10 images.', icon: '🖼️', metric: 'generatedArtwork', target: 10, follows: 'first-image' },
  { id: 'fifty-images', title: 'Visual world', description: 'Generate 50 images.', icon: '🌌', metric: 'generatedArtwork', target: 50, follows: 'ten-images', secret: true },
  { id: 'first-tool', title: 'Tool maker', description: 'Use a model tool.', icon: '🛠️', metric: 'toolCalls', target: 1 },
  { id: 'twenty-five-tools', title: 'Tools at work', description: 'Use 25 model tools.', icon: '⚙️', metric: 'toolCalls', target: 25, follows: 'first-tool' },
  { id: 'two-projects', title: 'New territory', description: 'Create a second project.', icon: '🧭', metric: 'projects', target: 2 },
  { id: 'five-projects', title: 'Many worlds', description: 'Create 5 projects.', icon: '🌐', metric: 'projects', target: 5, follows: 'two-projects' },
];

export const emptyAchievementCounts = (): AchievementCounts => ({ conversations: 0, messagesSent: 0, messagesReceived: 0, inputTokens: 0, outputTokens: 0, responseSeconds: 0, models: 0, modelTypes: 0, generatedArtwork: 0, toolCalls: 0, projects: 0 });
export type AchievementLedger = { version: 1; counts: AchievementCounts; unlockedAt: Record<string, string>; modelsSeen?: string[]; modelTypesSeen?: string[] };
export const emptyAchievementLedger = (): AchievementLedger => ({ version: 1, counts: emptyAchievementCounts(), unlockedAt: {}, modelsSeen: [], modelTypesSeen: [] });

export function mergeAchievementLedger(previous: AchievementLedger, observed: AchievementCounts, now = new Date().toISOString()): AchievementLedger {
  const counts = emptyAchievementCounts();
  for (const key of Object.keys(counts) as AchievementMetric[]) counts[key] = Math.max(previous.counts[key] || 0, observed[key] || 0);
  const unlockedAt = { ...previous.unlockedAt };
  for (const achievement of ACHIEVEMENTS) if (counts[achievement.metric] >= achievement.target && !unlockedAt[achievement.id]) unlockedAt[achievement.id] = now;
  return { version: 1, counts, unlockedAt, modelsSeen: previous.modelsSeen || [], modelTypesSeen: previous.modelTypesSeen || [] };
}

export function incrementAchievementLedger(previous: AchievementLedger, delta: Partial<AchievementCounts>, now = new Date().toISOString()): AchievementLedger {
  const observed = { ...previous.counts };
  for (const key of Object.keys(observed) as AchievementMetric[]) {
    const amount = delta[key];
    if (amount === undefined) continue;
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid achievement increment for ${key}.`);
    observed[key] = Math.min(Number.MAX_SAFE_INTEGER, (observed[key] || 0) + amount);
  }
  return mergeAchievementLedger(previous, observed, now);
}

export function visibleAchievements(ledger: AchievementLedger): { achievement: Achievement; hidden: boolean; unlocked: boolean }[] {
  return ACHIEVEMENTS.map(achievement => ({
    achievement,
    unlocked: !!ledger.unlockedAt[achievement.id],
    hidden: !!achievement.secret && !ledger.unlockedAt[achievement.id] && !!achievement.follows && !ledger.unlockedAt[achievement.follows],
  }));
}

export type AchievementInventory = { counts: AchievementCounts; modelsSeen: string[]; modelTypesSeen: string[] };
/** Scan saved records in small batches so large conversations do not fill memory. */
export async function scanAchievementInventory(store: HarnessStore, manifest: HarnessManifest, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<AchievementInventory> {
  const counts = emptyAchievementCounts();
  counts.projects = manifest.projects.length;
  const sessions = (await Promise.all(manifest.projects.map(project => store.sessions(project.id)))).flat();
  counts.conversations = sessions.length;
  counts.generatedArtwork = (await store.avatarLibrary()).filter(asset => asset.source === 'generated').length;
  const models = new Set<string>();
  const kinds = new Set<string>();
  const total = sessions.reduce((count, session) => count + Math.ceil(session.messageCount / MESSAGE_CHUNK_SIZE), 0);
  let done = 0;
  onProgress?.(done, total);
  for (const session of sessions) {
    for (let start = 0; start < session.messageCount; start += MESSAGE_CHUNK_SIZE) {
      if (signal?.aborted) throw new DOMException('Achievement scan stopped.', 'AbortError');
      const messages = await store.messages(session, start, Math.min(start + MESSAGE_CHUNK_SIZE, session.messageCount));
      for (const message of messages) {
        if (message.role === 'user') counts.messagesSent++;
        if (message.role !== 'assistant') continue;
        counts.messagesReceived++;
        counts.inputTokens += Number.isFinite(message.inputTokens) ? Math.max(0, message.inputTokens || 0) : 0;
        counts.outputTokens += Number.isFinite(message.outputTokens) ? Math.max(0, message.outputTokens || 0) : 0;
        counts.toolCalls += message.toolEvents?.length || 0;
        if (message.model) {
          models.add(`${message.model.provider}:${message.model.model}`);
          kinds.add(message.model.engine || message.model.provider);
        }
        if (message.hasDiagnostics) {
          const report = await store.responseDiagnostic(session.projectId, session.id, message.id);
          if (report) counts.responseSeconds += Math.max(0, report.usage.elapsedMs) / 1000;
        }
      }
      onProgress?.(++done, total);
      if (done % 24 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  counts.responseSeconds = Math.floor(counts.responseSeconds);
  counts.models = models.size;
  counts.modelTypes = kinds.size;
  return { counts, modelsSeen: [...models], modelTypesSeen: [...kinds] };
}

export async function scanAchievements(store: HarnessStore, manifest: HarnessManifest, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<AchievementCounts> {
  return (await scanAchievementInventory(store, manifest, onProgress, signal)).counts;
}
