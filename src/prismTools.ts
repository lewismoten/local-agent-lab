import type { ChatCompletionTool, ChatCompletionToolCall } from './browserEngineTypes';

export function parsePrismToolCalls(content: string, tools: ChatCompletionTool[] = []): ChatCompletionToolCall[] {
  if (!tools.length) return [];
  const calls: ChatCompletionToolCall[] = [];
  for (const match of content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    let name = '';
    let args: Record<string, unknown> = {};
    let valid = true;
    const body = match[1].trim();
    const xml = body.match(/^<function=([A-Za-z_][\w]*)>\s*([\s\S]*?)\s*<\/function>$/);
    if (xml) {
      name = xml[1];
      const tool = tools.find(item => item.function.name === name);
      if (!tool) continue;
      const parameters = [...xml[2].matchAll(/<parameter=([A-Za-z_][\w]*)>\s*([\s\S]*?)\s*<\/parameter>/g)];
      if (xml[2].replace(/<parameter=[A-Za-z_][\w]*>\s*[\s\S]*?\s*<\/parameter>/g, '').trim()) continue;
      if (new Set(parameters.map(item => item[1])).size !== parameters.length) continue;
      for (const [, key, value] of parameters) {
        const type = tool.function.parameters?.properties[key]?.type;
        if (!type) { valid = false; break; }
        const trimmed = value.trim();
        if (type === 'string') args[key] = trimmed;
        else {
          try { args[key] = JSON.parse(trimmed) as unknown; }
          catch { valid = false; break; }
          if (typeof args[key] !== type) { valid = false; break; }
        }
      }
    } else {
      try {
        const parsed = JSON.parse(body) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name !== 'string' || !parsed.arguments || typeof parsed.arguments !== 'object' || Array.isArray(parsed.arguments)) continue;
        name = parsed.name; args = parsed.arguments as Record<string, unknown>;
      } catch { continue; }
    }
    const tool = tools.find(item => item.function.name === name);
    if (!valid || !tool || tool.function.parameters?.required?.some(key => !(key in args))) continue;
    if (Object.entries(args).some(([key, value]) => !tool.function.parameters?.properties[key] || typeof value !== tool.function.parameters.properties[key].type)) continue;
    calls.push({ id: `prism-${crypto.randomUUID()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  }
  return calls;
}
