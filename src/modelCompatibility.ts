// This exact GGUF repeatedly aborted during first-token inference in Wllama.
// Match its filename in either a local models/ path or a download URL.
const GRANITE_40_FILE = 'granite-4.0-1b-Q4_K_M.gguf';
export const GRANITE_40_WARNING = `${GRANITE_40_FILE} was tested and failed during inference. It is not supported.`;

export function isKnownIncompatibleGranite(value: string): boolean {
  try {
    const path = new URL(value).pathname;
    return /(?:^|\/)granite-4\.0-1b-Q4_K_M\.gguf$/i.test(decodeURIComponent(path));
  } catch {
    return /(?:^|\/)granite-4\.0-1b-Q4_K_M\.gguf$/i.test(value);
  }
}

export const BONSAI_2_BROWSER_WARNING = 'Bonsai 2 uses the optional PrismML WebGPU engine. Download it in Engines before loading this model.';
export function isBonsai2BrowserUnsupported(value: string): boolean {
  try { return /(?:^|\/)Ternary-Bonsai-2-[^/]+\.gguf$/i.test(decodeURIComponent(new URL(value).pathname)); }
  catch { return /(?:^|\/)Ternary-Bonsai-2-[^/]+\.gguf$/i.test(value); }
}

export const BONSAI_2_Q2_BROWSER_WARNING = 'This GGUF is not supported by the browser engine.';
export function isBonsai2Q2BrowserUnsupported(value: string): boolean {
  try { return /(?:^|\/)Ternary-Bonsai-2-[^/]+-Q2_0\.gguf$/i.test(decodeURIComponent(new URL(value).pathname)); }
  catch { return /(?:^|\/)Ternary-Bonsai-2-[^/]+-Q2_0\.gguf$/i.test(value); }
}
