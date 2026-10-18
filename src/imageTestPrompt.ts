export const DEFAULT_IMAGE_TEST_PROMPT = 'A simple green leaf on a plain white background.';

export function isReferenceImagePrompt(prompt: string): boolean {
  return prompt.trim() === DEFAULT_IMAGE_TEST_PROMPT;
}

const keyFor = (preset: string) => `rivers-of-memory:image-test-prompt:${preset}`;

export function loadImageTestPrompt(preset: string): string {
  try { return localStorage.getItem(keyFor(preset)) || DEFAULT_IMAGE_TEST_PROMPT; }
  catch { return DEFAULT_IMAGE_TEST_PROMPT; }
}

export function saveImageTestPrompt(preset: string, prompt: string): void {
  try { localStorage.setItem(keyFor(preset), prompt); }
  catch { /* Prompt remains editable in this tab when storage is unavailable. */ }
}
