export type AIConfig = { provider: 'ollama' | 'openai'; model: string; endpoint: string; apiKey: string };
const SYSTEM = `You are a careful story-development collaborator. Create original material. Do not imitate any named creator's style or reproduce protected story elements. Treat influence descriptions as high-level preferences only. Maintain consistency with the supplied canon. Return only the requested content, without commentary.`;
export async function generate(config: AIConfig, prompt: string): Promise<string> {
  if (config.provider === 'openai' && !config.apiKey) throw new Error('Enter an OpenAI API key in Settings.');
  const endpoint = config.provider === 'openai'
    ? (config.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions'
    : (config.endpoint || 'http://localhost:11434').replace(/\/$/, '') + '/api/chat';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.provider === 'openai' ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(config.provider === 'openai'
      ? { model: config.model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }
      : { model: config.model, stream: false, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const body = await response.json();
  const text = config.provider === 'openai' ? body.choices?.[0]?.message?.content : body.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('The AI provider returned no text.');
  return text.trim();
}
export function parseJson<T>(text: string): T {
  const clean = text.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
  return JSON.parse(clean) as T;
}
export async function generateImage(config: AIConfig, prompt: string): Promise<Blob> {
  if (config.provider !== 'openai' || !config.apiKey) throw new Error('Select OpenAI and enter an API key to generate an image.');
  const endpoint = (config.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '') + '/images/generations';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024' }),
  });
  if (!response.ok) throw new Error(`Image request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const body = await response.json();
  const encoded = body.data?.[0]?.b64_json;
  if (typeof encoded !== 'string') throw new Error('The image provider returned no image.');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}
