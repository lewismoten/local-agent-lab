export type CatalogModel = {
  id: string;
  label: string;
  family: string;
  company: string;
  country: string;
  companyUrl: string;
  version: string;
  parameters: number;
  quantization: string;
  contextTokens: number;
  toolUse: 'documented' | 'confirmed-browser-test' | 'confirmed-constrained' | 'unconfirmed' | 'failed-browser-test';
  thinking: 'documented' | 'no-mode' | 'unconfirmed';
  browserChecks?: { text?: boolean; tools?: boolean; reasoningTask?: boolean; thinkingMode?: boolean };
  runtime?: 'browser' | 'local-server';
  warnings?: string[];
  visionProjector?: { name: string; bytes: number; source: string };
  license: string;
  licenseUrl: string;
  name: string;
  bytes: number;
  reason: string;
  url: string;
  source: string;
};

// File sizes are exact bytes from the linked Hugging Face GGUF repositories.
// Context limits come from publishers. Capability labels include documented
// features and specific browser-test failures where observed. Browser-check
// badges record passed diagnostics supplied by the user, not publisher claims.
export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'spark-x25-17b', label: 'Spark-X 1.7B · Q4_K_M', family: 'Spark-X', company: 'SparkLLM', country: 'Unconfirmed', companyUrl: 'https://www.xhtoken.ai/', version: '2.5', parameters: 1.7,
    quantization: 'Q4_K_M', contextTokens: 1048576, toolUse: 'documented', thinking: 'documented', browserChecks: { text: true, thinkingMode: true }, runtime: 'browser',
    license: 'Apache 2.0', licenseUrl: 'https://github.com/XHToken/Spark-X2.5/blob/main/LICENSE',
    name: 'Spark-X2.5-1.7B-Q4_K_M.gguf', bytes: 1107457856,
    reason: 'Compact multilingual model for reasoning and tool use.',
    url: 'https://huggingface.co/XHToken/Spark-X2.5-1.7B-GGUF/resolve/main/Spark-X2.5-1.7B-Q4_K_M.gguf',
    source: 'https://huggingface.co/XHToken/Spark-X2.5-1.7B-GGUF/blob/main/Spark-X2.5-1.7B-Q4_K_M.gguf',
  },
  {
    id: 'minicpm5-1b', label: 'MiniCPM5 1B · Q4_K_M', family: 'MiniCPM', company: 'OpenBMB', country: 'China', companyUrl: 'https://github.com/OpenBMB', version: '5', parameters: 1.08,
    quantization: 'Q4_K_M', contextTokens: 131072, toolUse: 'documented', thinking: 'documented', runtime: 'browser',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/openbmb/MiniCPM5-1B-GGUF',
    name: 'MiniCPM5-1B-Q4_K_M.gguf', bytes: 688065920,
    reason: 'Compact bilingual chat and structured prompts.',
    url: 'https://huggingface.co/openbmb/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q4_K_M.gguf',
    source: 'https://huggingface.co/openbmb/MiniCPM5-1B-GGUF/blob/main/MiniCPM5-1B-Q4_K_M.gguf',
  },
  {
    id: 'minicpm5-2b', label: 'MiniCPM5 2B · Q4_K_M', family: 'MiniCPM', company: 'OpenBMB', country: 'China', companyUrl: 'https://github.com/OpenBMB', version: '5', parameters: 2.52,
    quantization: 'Q4_K_M', contextTokens: 131072, toolUse: 'documented', thinking: 'documented', runtime: 'browser',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/openbmb/MiniCPM5-2B-GGUF',
    name: 'MiniCPM5-2B-Q4_K_M.gguf', bytes: 1561318368,
    reason: 'Larger bilingual model with structured prompting.',
    url: 'https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/resolve/main/MiniCPM5-2B-Q4_K_M.gguf',
    source: 'https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/blob/main/MiniCPM5-2B-Q4_K_M.gguf',
  },
  {
    id: 'bonsai2-2b', label: 'Bonsai 2 2B · PTQ1_0', family: 'Bonsai', company: 'Prism ML', country: 'United States', companyUrl: 'https://prismml.com/', version: '2', parameters: 1.88,
    quantization: 'PTQ1_0', contextTokens: 262144, toolUse: 'unconfirmed', thinking: 'documented', browserChecks: { text: true, thinkingMode: true }, runtime: 'browser',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/LICENSE',
    name: 'Ternary-Bonsai-2-2B-PTQ1_0.gguf', bytes: 429183456,
    visionProjector: { name: 'Ternary-Bonsai-2-2B-mmproj-Q8_0.gguf', bytes: 364664352, source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/Ternary-Bonsai-2-2B-mmproj-Q8_0.gguf' },
    reason: 'Dense 1-bit packing; smaller Bonsai 2 file.',
    warnings: ['The browser test returned text and a separate thinking stream, but no executable tool call. Its reasoning task was incorrect, and its thinking answer reached the output limit before completion.'],
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/resolve/main/Ternary-Bonsai-2-2B-PTQ1_0.gguf',
    source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/Ternary-Bonsai-2-2B-PTQ1_0.gguf',
  },
  {
    id: 'bonsai2-q2-server', label: 'Bonsai 2 2B · Q2_0 · local server', family: 'Bonsai', company: 'Prism ML', country: 'United States', companyUrl: 'https://prismml.com/', version: '2', parameters: 1.88,
    quantization: 'Q2_0', contextTokens: 262144, toolUse: 'unconfirmed', thinking: 'documented', runtime: 'local-server',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/LICENSE',
    name: 'Ternary-Bonsai-2-2B-Q2_0.gguf', bytes: 546689504,
    visionProjector: { name: 'Ternary-Bonsai-2-2B-mmproj-Q8_0.gguf', bytes: 364664352, source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/Ternary-Bonsai-2-2B-mmproj-Q8_0.gguf' },
    reason: 'Q2 packing for compatible local servers.',
    warnings: ['The browser WebGPU engine rejects Q2_0 tensors. Use PTQ1_0 for browser loading.'],
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/resolve/main/Ternary-Bonsai-2-2B-Q2_0.gguf',
    source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/Ternary-Bonsai-2-2B-Q2_0.gguf',
  },
  {
    id: 'bonsai2-2b-pq2', label: 'Bonsai 2 2B · PQ2_0', family: 'Bonsai', company: 'Prism ML', country: 'United States', companyUrl: 'https://prismml.com/', version: '2', parameters: 1.88,
    quantization: 'PQ2_0', contextTokens: 262144, toolUse: 'unconfirmed', thinking: 'documented', runtime: 'browser',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/LICENSE',
    name: 'Ternary-Bonsai-2-2B-PQ2_0.gguf', bytes: 517312992,
    visionProjector: { name: 'Ternary-Bonsai-2-2B-mmproj-Q8_0.gguf', bytes: 364664352, source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/Ternary-Bonsai-2-2B-mmproj-Q8_0.gguf' },
    reason: '2-bit slot packing; possible speed tradeoff.',
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/resolve/main/Ternary-Bonsai-2-2B-PQ2_0.gguf',
    source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf/blob/main/Ternary-Bonsai-2-2B-PQ2_0.gguf',
  },
  {
    id: 'bonsai2-4b-ptq', label: 'Bonsai 2 4B · PTQ1_0', family: 'Bonsai', company: 'Prism ML', country: 'United States', companyUrl: 'https://prismml.com/', version: '2', parameters: 4.21,
    quantization: 'PTQ1_0', contextTokens: 262144, toolUse: 'unconfirmed', thinking: 'documented', runtime: 'browser',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-gguf/blob/main/LICENSE',
    name: 'Ternary-Bonsai-2-4B-PTQ1_0.gguf', bytes: 949549920,
    visionProjector: { name: 'Ternary-Bonsai-2-4B-mmproj-Q8_0.gguf', bytes: 366894624, source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-gguf/blob/main/Ternary-Bonsai-2-4B-mmproj-Q8_0.gguf' },
    reason: '4B model with dense 1-bit packing.',
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-gguf/resolve/main/Ternary-Bonsai-2-4B-PTQ1_0.gguf',
    source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-gguf/blob/main/Ternary-Bonsai-2-4B-PTQ1_0.gguf',
  },
  {
    id: 'bonsai2-4b-pq2', label: 'Bonsai 2 4B · PQ2_0', family: 'Bonsai', company: 'Prism ML', country: 'United States', companyUrl: 'https://prismml.com/', version: '2', parameters: 4.21,
    quantization: 'PQ2_0', contextTokens: 262144, toolUse: 'unconfirmed', thinking: 'documented', runtime: 'browser',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-gguf/blob/main/LICENSE',
    name: 'Ternary-Bonsai-2-4B-PQ2_0.gguf', bytes: 1146465120,
    visionProjector: { name: 'Ternary-Bonsai-2-4B-mmproj-Q8_0.gguf', bytes: 366894624, source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-gguf/blob/main/Ternary-Bonsai-2-4B-mmproj-Q8_0.gguf' },
    reason: '4B model with 2-bit slot packing.',
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-gguf/resolve/main/Ternary-Bonsai-2-4B-PQ2_0.gguf',
    source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-gguf/blob/main/Ternary-Bonsai-2-4B-PQ2_0.gguf',
  },
  {
    id: 'bonsai2-9b-ptq', label: 'Bonsai 2 9B · PTQ1_0', family: 'Bonsai', company: 'Prism ML', country: 'United States', companyUrl: 'https://prismml.com/', version: '2', parameters: 8.95,
    quantization: 'PTQ1_0', contextTokens: 262144, toolUse: 'unconfirmed', thinking: 'documented', runtime: 'browser',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-9B-gguf/blob/main/LICENSE',
    name: 'Ternary-Bonsai-2-9B-PTQ1_0.gguf', bytes: 1997486976,
    visionProjector: { name: 'Ternary-Bonsai-2-9B-mmproj-Q8_0.gguf', bytes: 624229664, source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-9B-gguf/blob/main/Ternary-Bonsai-2-9B-mmproj-Q8_0.gguf' },
    reason: 'Largest listed Bonsai 2 variant.',
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-9B-gguf/resolve/main/Ternary-Bonsai-2-9B-PTQ1_0.gguf',
    source: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-9B-gguf/blob/main/Ternary-Bonsai-2-9B-PTQ1_0.gguf',
  },
  {
    id: 'bonsai-8b', label: 'Bonsai 8B · Q1_0', family: 'Bonsai', company: 'Prism ML', country: 'United States', companyUrl: 'https://prismml.com/news/prismml-launches-worlds-first-1-bit-ai-model', version: 'Original', parameters: 8.19,
    quantization: 'Q1_0', contextTokens: 65536, toolUse: 'confirmed-browser-test', thinking: 'unconfirmed', browserChecks: { text: true, tools: true, reasoningTask: true },
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/prism-ml/Bonsai-8B-gguf/blob/main/LICENSE',
    name: 'Bonsai-8B-Q1_0.gguf', bytes: 1158654496,
    reason: '8B parameters in a compact 1-bit file.',
    warnings: ['Prism ML’s 8B launcher disables thinking; a separate thinking stream has not been confirmed in this browser.', 'The browser reasoning task has produced both correct and incorrect answers across runs.'],
    url: 'https://huggingface.co/prism-ml/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf',
    source: 'https://huggingface.co/prism-ml/Bonsai-8B-gguf/blob/main/Bonsai-8B-Q1_0.gguf',
  },
  {
    id: 'qwen35-2b', label: 'Qwen3.5 2B · Q4_K_M', family: 'Qwen', company: 'Alibaba Cloud', country: 'China', companyUrl: 'https://www.alibabacloud.com/en/about/index-2026', version: '3.5', parameters: 2,
    quantization: 'Q4_K_M', contextTokens: 262144, toolUse: 'confirmed-browser-test', thinking: 'documented', browserChecks: { text: true, tools: true, reasoningTask: true, thinkingMode: true },
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/Qwen/Qwen3.5-2B',
    name: 'Qwen3.5-2B-Q4_K_M.gguf', bytes: 1280835840,
    reason: 'Long context, tools, and thinking mode.',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    source: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/blob/main/Qwen3.5-2B-Q4_K_M.gguf',
  },
  {
    id: 'qwen3-17b', label: 'Qwen3 1.7B · Q4_K_M', family: 'Qwen', company: 'Alibaba Cloud', country: 'China', companyUrl: 'https://www.alibabacloud.com/en/about/index-2026', version: '3', parameters: 1.7,
    quantization: 'Q4_K_M', contextTokens: 32768, toolUse: 'confirmed-browser-test', thinking: 'documented', browserChecks: { text: true, tools: true, reasoningTask: true, thinkingMode: true },
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B',
    name: 'Qwen3-1.7B-Q4_K_M.gguf', bytes: 1282439264,
    reason: 'Compact model with native thinking mode.',
    warnings: ['The browser confirmed a separate reasoning stream. Its 1,024-token thinking test used the entire output limit before reaching a final answer.'],
    url: 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    source: 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/blob/main/Qwen3-1.7B-Q4_K_M.gguf',
  },
  {
    id: 'qwen25-3b', label: 'Qwen2.5 3B · Q4_K_M', family: 'Qwen', company: 'Alibaba Cloud', country: 'China', companyUrl: 'https://www.alibabacloud.com/en/about/index-2026', version: '2.5', parameters: 3,
    quantization: 'Q4_K_M', contextTokens: 32768, toolUse: 'confirmed-browser-test', thinking: 'no-mode', browserChecks: { text: true, tools: true, reasoningTask: true },
    license: 'Qwen Research', licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/main/LICENSE',
    name: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf', bytes: 1929903264,
    reason: 'Larger Qwen2.5 instruction model.',
    warnings: ['One prompted-steps browser test gave an incorrect final answer despite a correct explanation.', 'No dedicated thinking mode is documented for this release.'],
    url: 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    source: 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/blob/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'qwen25-15b', label: 'Qwen2.5 1.5B · Q4_K_M', family: 'Qwen', company: 'Alibaba Cloud', country: 'China', companyUrl: 'https://www.alibabacloud.com/en/about/index-2026', version: '2.5', parameters: 1.5,
    quantization: 'Q4_K_M', contextTokens: 32768, toolUse: 'confirmed-browser-test', thinking: 'no-mode', browserChecks: { text: true, tools: true, reasoningTask: true },
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct',
    name: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', bytes: 1117320736,
    reason: 'Smaller Qwen2.5 instruction model.',
    warnings: ['The browser reasoning task has produced both correct and incorrect answers across runs.', 'No dedicated thinking mode is documented for this release.'],
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    source: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'smollm3-3b', label: 'SmolLM3 3B · Q4_K_M', family: 'SmolLM', company: 'Hugging Face', country: 'France / United States', companyUrl: 'https://huggingface.co/blog/smollm3', version: '3', parameters: 3,
    quantization: 'Q4_K_M', contextTokens: 65536, toolUse: 'documented', thinking: 'documented', browserChecks: { text: true, thinkingMode: true },
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM3-3B',
    name: 'SmolLM3-Q4_K_M.gguf', bytes: 1915305312,
    reason: '3B model with native thinking mode.',
    warnings: ['Browser diagnostics observed a thinking stream, but this run reached the output limit without a correct final answer. Tool calling remains unconfirmed.'],
    url: 'https://huggingface.co/ggml-org/SmolLM3-3B-GGUF/resolve/main/SmolLM3-Q4_K_M.gguf',
    source: 'https://huggingface.co/ggml-org/SmolLM3-3B-GGUF/blob/main/SmolLM3-Q4_K_M.gguf',
  },
  {
    id: 'granite41-3b', label: 'Granite 4.1 3B · Q3_K_M', family: 'Granite', company: 'IBM', country: 'United States', companyUrl: 'https://www.ibm.com/granite/docs/models/granite4-1', version: '4.1', parameters: 3,
    quantization: 'Q3_K_M', contextTokens: 131072, toolUse: 'confirmed-constrained', thinking: 'no-mode', browserChecks: { text: true, tools: true, reasoningTask: true },
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/ibm-granite/granite-4.1-3b',
    name: 'granite-4.1-3b-Q3_K_M.gguf', bytes: 1725577824,
    reason: 'Structured extraction and constrained tool calls.',
    warnings: ['A browser tool call passed only with a GBNF format constraint. Tool use in ordinary chat has not been confirmed.', 'This is one browser test, not a reliability measure.'],
    url: 'https://huggingface.co/ibm-granite/granite-4.1-3b-GGUF/resolve/main/granite-4.1-3b-Q3_K_M.gguf',
    source: 'https://huggingface.co/ibm-granite/granite-4.1-3b-GGUF/blob/main/granite-4.1-3b-Q3_K_M.gguf',
  },
  {
    id: 'gemma3-1b', label: 'Gemma 3 1B · Q4_K_M', family: 'Gemma', company: 'Google', country: 'United States', companyUrl: 'https://ai.google.dev/gemma', version: '3', parameters: 1,
    quantization: 'Q4_K_M', contextTokens: 32768, toolUse: 'failed-browser-test', thinking: 'no-mode', browserChecks: { text: true },
    license: 'Gemma terms', licenseUrl: 'https://ai.google.dev/gemma/terms',
    name: 'gemma-3-1b-it-Q4_K_M.gguf', bytes: 806058240,
    reason: 'Compact general-purpose chat model.',
    warnings: ['A structured tool-call browser test failed: the model wrote Python code instead of returning an executable tool call.', 'The browser reasoning task and thinking-mode answer were incorrect; no separate thinking stream appeared.', 'Use this model for simple text tasks unless later tests confirm stronger capabilities.'],
    url: 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf',
    source: 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/blob/main/gemma-3-1b-it-Q4_K_M.gguf',
  },
  {
    id: 'eurollm-17b', label: 'EuroLLM 1.7B · Q4_K_M', family: 'EuroLLM', company: 'EuroLLM consortium', country: 'Europe', companyUrl: 'https://huggingface.co/utter-project/EuroLLM-1.7B-Instruct', version: '1.7B', parameters: 1.7,
    quantization: 'Q4_K_M', contextTokens: 4096, toolUse: 'unconfirmed', thinking: 'unconfirmed',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/utter-project/EuroLLM-1.7B-Instruct',
    name: 'EuroLLM-1.7B-Instruct.Q4_K_M.gguf', bytes: 1045156992,
    reason: 'European-language multilingual chat.',
    url: 'https://huggingface.co/QuantFactory/EuroLLM-1.7B-Instruct-GGUF/resolve/main/EuroLLM-1.7B-Instruct.Q4_K_M.gguf',
    source: 'https://huggingface.co/QuantFactory/EuroLLM-1.7B-Instruct-GGUF/blob/main/EuroLLM-1.7B-Instruct.Q4_K_M.gguf',
  },
  {
    id: 'sailor2-1b', label: 'Sailor2 1B · Q4_K_M', family: 'Sailor', company: 'Sea AI Lab', country: 'Singapore', companyUrl: 'https://sail.sea.com/', version: '2', parameters: 1,
    quantization: 'Q4_K_M', contextTokens: 4096, toolUse: 'unconfirmed', thinking: 'unconfirmed',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/sail/Sailor2-1B-Chat',
    name: 'Sailor2-1B-Chat-Q4_K_M.gguf', bytes: 738628576,
    reason: 'Southeast Asian language support.',
    url: 'https://huggingface.co/bartowski/Sailor2-1B-Chat-GGUF/resolve/main/Sailor2-1B-Chat-Q4_K_M.gguf',
    source: 'https://huggingface.co/bartowski/Sailor2-1B-Chat-GGUF/blob/main/Sailor2-1B-Chat-Q4_K_M.gguf',
  },
  {
    id: 'ministral3-3b', label: 'Ministral 3 3B · Q3_K_M', family: 'Ministral', company: 'Mistral AI', country: 'France', companyUrl: 'https://mistral.ai/', version: '3', parameters: 3.4,
    quantization: 'Q3_K_M', contextTokens: 262144, toolUse: 'documented', thinking: 'no-mode',
    license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512',
    name: 'mistralai_Ministral-3-3B-Instruct-2512-Q3_K_M.gguf', bytes: 1795553248,
    reason: 'Multilingual 3B model with optional vision.',
    visionProjector: { name: 'mmproj-mistralai_Ministral-3-3B-Instruct-2512-bf16.gguf', bytes: 849889920, source: 'https://huggingface.co/bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF/blob/main/mmproj-mistralai_Ministral-3-3B-Instruct-2512-bf16.gguf' },
    url: 'https://huggingface.co/bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF/resolve/main/mistralai_Ministral-3-3B-Instruct-2512-Q3_K_M.gguf',
    source: 'https://huggingface.co/bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF/blob/main/mistralai_Ministral-3-3B-Instruct-2512-Q3_K_M.gguf',
  },
];

export function browserCheckBadges(model: CatalogModel): string {
  const checks = model.browserChecks;
  if (!checks) return '';
  return [checks.text && '💬', checks.tools && '🔧', checks.reasoningTask && '🧩', checks.thinkingMode && '🧠'].filter(Boolean).join(' ');
}
