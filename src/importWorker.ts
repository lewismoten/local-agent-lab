import { analyzeDocument } from './importAnalysis';
type Job = { sourceId: string; updatedAt: string; text: string; characters: { id: string; name: string }[] };
const jobs: Job[] = [];
let paused = false;
let working = false;
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function run() {
  if (working) return;
  working = true;
  while (jobs.length) {
    const job = jobs.shift()!;
    postMessage({ type: 'started', sourceId: job.sourceId });
    try {
      // Yield between slices so pause messages can interrupt long imports.
      for (let offset = 0; offset < job.text.length; offset += 16000) {
        while (paused) await new Promise<void>(resolve => setTimeout(resolve, 80));
        await delay();
      }
      while (paused) await new Promise<void>(resolve => setTimeout(resolve, 80));
      const graph = await analyzeDocument(job.sourceId, job.text, job.characters, async () => {
        while (paused) await new Promise<void>(resolve => setTimeout(resolve, 80));
        await delay();
      });
      postMessage({ type: 'done', sourceId: job.sourceId, updatedAt: job.updatedAt, graph });
    } catch (error) { postMessage({ type: 'error', sourceId: job.sourceId, error: String(error) }); }
  }
  working = false;
}
self.onmessage = (event: MessageEvent<{ type: 'enqueue' | 'pause' | 'resume'; job?: Job }>) => {
  if (event.data.type === 'pause') paused = true;
  if (event.data.type === 'resume') { paused = false; void run(); }
  if (event.data.type === 'enqueue' && event.data.job) { jobs.push(event.data.job); void run(); }
};
