import type { Span } from '../analysis/story';

type Word = { text: string; startMs: number; endMs: number };

/** Partes de [a, b] que aun no estan en `done`. */
export function uncovered(done: Span[], a: number, b: number): Span[] {
  const out: Span[] = [];
  let t = a;
  for (const d of [...done].sort((x, y) => x.start - y.start)) {
    if (d.end <= t || d.start >= b) continue;
    if (d.start > t) out.push({ start: t, end: d.start });
    t = Math.max(t, d.end);
  }
  if (t < b) out.push({ start: t, end: b });
  return out;
}

/**
 * Escucha cada trozo de un directo una sola vez: los momentos cercanos se solapan y comparten lo que se dijo.
 * Cada trozo nuevo se escucha con 1 s de mas por cada lado (para no partir palabras) y se quedan solo las palabras
 * cuyo centro cae dentro.
 */
export function makeHearing(listen: (start: number, dur: number) => Promise<Word[]>) {
  const done: Span[] = [];
  let words: Word[] = [];
  return async (a: number, b: number): Promise<Word[]> => {
    for (const g of uncovered(done, a, b)) {
      if (g.end - g.start < 0.3) continue;
      const s0 = Math.max(0, g.start - 1);
      const got = (await listen(s0, g.end + 1 - s0)).filter((w) => { const m = (w.startMs + w.endMs) / 2000; return m >= g.start && m < g.end; });
      words = [...words, ...got].sort((x, y) => x.startMs - y.startMs);
      done.push(g);
    }
    return words.filter((w) => w.endMs > a * 1000 && w.startMs < b * 1000);
  };
}
