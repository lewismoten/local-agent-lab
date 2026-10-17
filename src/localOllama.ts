let resident: { endpoint: string; model: string } | null = null;

export function noteLocalOllamaUse(endpoint: string, model: string) {
  try {
    const url = new URL(endpoint);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;
    resident = { endpoint: url.href.replace(/\/+$/, ''), model };
  } catch { /* An invalid endpoint cannot have loaded a model. */ }
}

export async function unloadLocalOllama() {
  const active = resident;
  if (!active) return;
  const response = await fetch(`${active.endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: active.model, prompt: '', keep_alive: 0, stream: false }),
  });
  if (!response.ok) throw new Error(`Could not unload local Ollama model ${active.model} (${response.status}).`);
  if (resident === active) resident = null;
}
