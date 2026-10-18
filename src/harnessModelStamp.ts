import { MODEL_CATALOG } from './catalogModels.ts';
import { browserContextWindow } from './browserContext.ts';
import type { AIConfig } from './ai.ts';
import type { ModelStamp } from './harnessData.ts';

/** Store the configuration used for a reply, including catalog details available at the time. */
export function modelStamp(profile: AIConfig): ModelStamp {
  const filename = profile.model.split('/').at(-1);
  const catalog = profile.provider === 'browser' ? MODEL_CATALOG.find(item => item.name === filename && item.runtime !== 'local-server') : undefined;
  const engine = profile.provider === 'browser' ? catalog?.id.startsWith('bonsai2-') ? 'PrismML WebGPU' : 'Wllama Wasm'
    : profile.provider === 'ollama' ? 'Ollama'
      : profile.provider === 'compatible' ? 'OpenAI-compatible server'
        : profile.provider === 'codex' || profile.provider === 'openai' ? 'OpenAI API'
          : `${profile.provider} API`;
  return {
    profileId: profile.id,
    profileLabel: profile.label,
    provider: profile.provider,
    model: profile.model,
    thinking: profile.provider === 'browser' ? profile.browserThinkingMode || (profile.thinkingTokens ? `${profile.thinkingTokens} tokens` : 'none') : profile.effort !== 'default' ? profile.effort : String(profile.thinkingTokens || 'none'),
    contextWindow: profile.provider === 'browser' ? browserContextWindow(profile.model, profile.contextWindow) : profile.contextWindow,
    maxOutputTokens: profile.maxOutputTokens,
    engine,
    ...(catalog ? { modelLabel: catalog.label, family: catalog.family, version: catalog.version, parametersB: catalog.parameters, quantization: catalog.quantization, license: catalog.license } : {}),
  };
}

export function modelStampLabel(stamp: ModelStamp): string {
  return stamp.modelLabel || stamp.model.split('/').at(-1) || stamp.model;
}

export function modelStampDetails(stamp: ModelStamp): string {
  return [
    stamp.modelLabel || stamp.model,
    `Profile: ${stamp.profileLabel || stamp.profileId}`,
    `Provider: ${stamp.provider}`,
    stamp.engine && `Engine: ${stamp.engine}`,
    stamp.version && `Version: ${stamp.version}`,
    stamp.parametersB && `Parameters: ${stamp.parametersB}B`,
    stamp.quantization && `Quantization: ${stamp.quantization}`,
    stamp.license && `License: ${stamp.license}`,
    `Model ID/file: ${stamp.model}`,
    `Thinking: ${stamp.thinking}`,
    `Context: ${stamp.contextWindow.toLocaleString()} tokens`,
    `Max output: ${stamp.maxOutputTokens.toLocaleString()} tokens`,
  ].filter(Boolean).join('\n');
}
