/** CLIP byte-pair tokenizer for the pinned browser image models. */
export function clipTokenizer(data: unknown) {
  const parsed = data as { model?: { vocab?: Record<string, number>; merges?: (string | [string, string])[] }; pre_tokenizer?: { type?: string } };
  const vocab = parsed.model?.vocab;
  const merges = parsed.model?.merges;
  if (!vocab || !merges || vocab['<|endoftext|>'] === undefined) throw new Error('The saved CLIP tokenizer is invalid.');
  const ranks = new Map(merges.map((pair, index) => [Array.isArray(pair) ? pair.join(' ') : pair, index]));
  const byteLevel = parsed.pre_tokenizer?.type === 'Sequence';
  const initialBytes = [
    ...Array.from({ length: 94 }, (_, index) => index + 33),
    ...Array.from({ length: 12 }, (_, index) => index + 161),
    ...Array.from({ length: 82 }, (_, index) => index + 174),
  ];
  const byteAlphabet = new Array<string>(256);
  let extra = 256;
  for (const value of initialBytes) byteAlphabet[value] = String.fromCodePoint(value);
  for (let value = 0; value < 256; value++) if (!byteAlphabet[value]) byteAlphabet[value] = String.fromCodePoint(extra++);
  const cache = new Map<string, number[]>();
  const tokenizeWord = (word: string): number[] => {
    const cached = cache.get(word); if (cached) return cached;
    const symbols = Array.from(byteLevel ? Array.from(new TextEncoder().encode(word), byte => byteAlphabet[byte]).join('') : word);
    if (!symbols.length) return [];
    symbols[symbols.length - 1] += '</w>';
    while (symbols.length > 1) {
      let best = Infinity; let at = -1;
      for (let i = 0; i < symbols.length - 1; i++) {
        const rank = ranks.get(`${symbols[i]} ${symbols[i + 1]}`);
        if (rank !== undefined && rank < best) { best = rank; at = i; }
      }
      if (at < 0) break;
      symbols.splice(at, 2, symbols[at] + symbols[at + 1]);
    }
    const ids = symbols.map(symbol => vocab[symbol] ?? vocab['<|endoftext|>']);
    cache.set(word, ids);
    return ids;
  };
  const end = vocab['<|endoftext|>'];
  const start = vocab['<|startoftext|>'];
  return async (text: string) => {
    const ids: number[] = byteLevel && start !== undefined ? [start] : [];
    const normalized = text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
    const tokens = byteLevel
      ? normalized.matchAll(/'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu)
      : normalized.matchAll(/\S+/gu);
    for (const match of tokens) {
      ids.push(...tokenizeWord(match[0]));
      if (ids.length >= 76) break;
    }
    ids.length = Math.min(76, ids.length);
    ids.push(end);
    while (ids.length < 77) ids.push(end);
    return { input_ids: { data: Int32Array.from(ids) } };
  };
}
