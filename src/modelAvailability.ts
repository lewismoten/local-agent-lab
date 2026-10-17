export async function listOllamaModels(endpoint: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(endpoint.replace(/\/$/, '') + '/api/tags', { signal });
  if (!response.ok) throw new Error(`Ollama model list failed (${response.status}).`);
  const body = await response.json() as { models?: { name?: string; model?: string }[] };
  if (!Array.isArray(body.models)) throw new Error('Ollama returned an invalid model list.');
  return body.models.map(x => x.name || x.model || '').filter(Boolean).sort();
}
export function hasOllamaModel(models: string[], model: string): boolean {
  const wanted = model.includes(':') ? model : `${model}:latest`;
  return models.some(name => (name.includes(':') ? name : `${name}:latest`) === wanted);
}
