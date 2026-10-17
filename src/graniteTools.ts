import type { ChatCompletionMessage, ChatCompletionResponse, ChatCompletionTool, ChatCompletionToolCall } from './browserEngineTypes';

export const GRANITE_TOOL_TEMPERATURE = 0.1;

// The required-tool diagnostic uses a grammar so Q3_K_M must generate a
// complete tagged JSON call. The argument value remains the model's choice.
export const GRANITE_COUNT_LETTERS_GRAMMAR = String.raw`root ::= "<tool_call>" ws "{" ws "\"name\"" ws ":" ws "\"count_letters\"" ws "," ws "\"arguments\"" ws ":" ws "{" ws "\"word\"" ws ":" ws json-string ws "}" ws "}" ws "</tool_call>"
ws ::= [ \t\n]*
json-string ::= "\"" json-char* "\""
json-char ::= [^"\\\n] | "\\" ["\\/bfnrt] | "\\u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]`;

// Granite 4.1 expects tool definitions in the system turn and tagged JSON calls.
// Wllama receives ordinary chat messages here; the app validates tagged calls.
export function graniteToolMessages(messages: ChatCompletionMessage[], tools: ChatCompletionTool[], toolChoice: 'auto' | 'required' = 'auto'): ChatCompletionMessage[] {
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  const instructions = [
    'You have access to these tools. Their function signatures are inside <tools> tags:',
    '<tools>',
    ...tools.map(tool => JSON.stringify(tool)),
    '</tools>',
    toolChoice === 'required' ? 'Call one listed tool for this request. Return only the tagged call; do not answer in prose.' : 'If a tool is needed, call only a listed tool.',
    'To call a tool, return a JSON object with its name and arguments inside <tool_call> and </tool_call> tags:',
    '<tool_call>\n{"name":"function_name","arguments":{}}\n</tool_call>',
  ].join('\n');
  const formatted: ChatCompletionMessage[] = [{ role: 'system', content: [system, instructions].filter(Boolean).join('\n\n') }];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      formatted.push({ role: 'user', content: `<tool_response>\n${message.content}\n</tool_response>` });
    } else if (message.role === 'assistant') {
      const calls = (message.tool_calls || []).map(call => {
        try { return `<tool_call>\n${JSON.stringify({ name: call.function.name, arguments: JSON.parse(call.function.arguments) })}\n</tool_call>`; }
        catch { return ''; }
      }).filter(Boolean).join('\n');
      formatted.push({ role: 'assistant', content: [message.content || '', calls].filter(Boolean).join('\n') });
    } else {
      formatted.push(message);
    }
  }
  return formatted;
}

export function parseGraniteToolCalls(text: string, tools: ChatCompletionTool[]): ChatCompletionToolCall[] {
  const allowed = new Set(tools.map(tool => tool.function.name));
  const calls: ChatCompletionToolCall[] = [];
  for (const match of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    try {
      const value: unknown = JSON.parse(match[1]);
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const call = value as Record<string, unknown>;
      if (typeof call.name !== 'string' || !allowed.has(call.name)) continue;
      const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      if (!args || typeof args !== 'object' || Array.isArray(args)) continue;
      calls.push({ id: `granite-${calls.length + 1}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(args) } });
    } catch { /* Incomplete or malformed text is never executable. */ }
  }
  return calls;
}

export function normalizeGraniteToolResponse(response: ChatCompletionResponse, tools: ChatCompletionTool[]): ChatCompletionResponse {
  const choice = response.choices[0];
  const text = choice?.message.content || '';
  const remainingText = text.replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, '').trim();
  // A call mixed with prose or cut off at the output limit is ambiguous.
  if (!choice || choice.finish_reason === 'length' || remainingText) return response;
  const calls = parseGraniteToolCalls(text, tools);
  if (!calls.length) return response;
  return { ...response, choices: response.choices.map((item, index) => index === 0 ? {
    ...item,
    message: { ...item.message, content: '', tool_calls: calls },
    finish_reason: 'tool_calls' as const,
  } : item) };
}
