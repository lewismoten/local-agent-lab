import { NEEDLE_CONTEXT_TOKENS, NEEDLE_MODEL_ASSETS, type NeedleVersion } from './needleAssets';

export type NeedleAssetGroup = 'engine' | NeedleVersion;

export const NEEDLE_DETAILS: Record<NeedleAssetGroup, { label: string; description: string; source: string }> = {
  engine: { label: 'Needle browser engine', description: 'WebAssembly engine for Needle 1, 2, and 3 · 0.6 MB', source: 'https://github.com/Geekgineer/needle-rs' },
  needle: { label: 'Needle', description: '26M · 22.4 MB · basic tool routing', source: 'https://huggingface.co/Abdalrahman/needle-rs-safetensors' },
  needle2: { label: 'Needle 2', description: '45M · 13.7 MB · tool routing and extraction', source: 'https://huggingface.co/Cactus-Compute/needle2' },
  needle3: { label: 'Needle 3', description: '121M · 35.3 MB · tool calling with reasoning', source: 'https://huggingface.co/Cactus-Compute/needle3' },
};

export const NEEDLE_CATALOG = ([
  { id: 'needle', family: 'Needle', label: 'Needle', version: '1', parameters: 0.026, contextTokens: NEEDLE_CONTEXT_TOKENS.needle, quantization: 'INT4', license: 'MIT', licenseUrl: 'https://github.com/cactus-compute/needle/blob/main/LICENSE', reason: 'A compact specialist for basic tool routing.', thinking: 'no-mode' },
  { id: 'needle2', family: 'Needle', label: 'Needle 2', version: '2', parameters: 0.045, contextTokens: NEEDLE_CONTEXT_TOKENS.needle2, quantization: 'CQ2', license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/Cactus-Compute/needle2/blob/main/LICENSE', reason: 'Small tool routing with structured extraction.', thinking: 'unconfirmed' },
  { id: 'needle3', family: 'Needle', label: 'Needle 3', version: '3', parameters: 0.121, contextTokens: NEEDLE_CONTEXT_TOKENS.needle3, quantization: 'CQ2', license: 'Apache 2.0', licenseUrl: 'https://huggingface.co/Cactus-Compute/needle3/blob/main/LICENSE', reason: 'Larger tool specialist with a reasoning trace.', thinking: 'documented' },
] as const).map(item => ({ ...item, company: 'Cactus Compute', country: '—', companyUrl: 'https://cactuscompute.com/', toolUse: 'documented' as const, bytes: NEEDLE_MODEL_ASSETS[item.id].reduce((total, asset) => total + asset.bytes, 0), name: NEEDLE_MODEL_ASSETS[item.id][1].name, source: NEEDLE_DETAILS[item.id].source }));
