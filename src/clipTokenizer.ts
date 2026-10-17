/** A small CLIP byte-pair tokenizer for the pinned SD 1.5 tokenizer.json. */
export function clipTokenizer(data: unknown) {
  const parsed = data as { model?: { vocab?: Record<string, number>; merges?: string[] } };
  const vocab = parsed.model?.vocab;
  const merges = parsed.model?.merges;
  if (!vocab || !merges || vocab['<|endoftext|>'] === undefined) throw new Error('The saved CLIP tokenizer is invalid.');
  const ranks = new Map(merges.map((pair, index) => [pair, index]));
  const cache = new Map<string, number[]>();
  const tokenizeWord = (word: string): number[] => {
    const cached = cache.get(word); if (cached) return cached;
    const symbols = Array.from(word);
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
  return async (text: string) => {
    const ids: number[] = [];
    // The pinned tokenizer.json uses WhitespaceSplit before byte-level BPE.
    for (const match of text.toLowerCase().matchAll(/\S+/gu)) {
      ids.push(...tokenizeWord(match[0]));
      if (ids.length >= 76) break;
    }
    ids.length = Math.min(76, ids.length);
    ids.push(end);
    while (ids.length < 77) ids.push(end);
    return { input_ids: { data: Int32Array.from(ids) } };
  };
}
