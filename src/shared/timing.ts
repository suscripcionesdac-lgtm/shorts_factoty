/** Funciones puras de tiempos: se prueban en tests/timing.test.ts */
export type Word = { text: string; startMs: number; endMs: number };

export const WORDS_PER_SECOND = 2.6;

export const countWords = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export const estimateSeconds = (t: string) => Math.max(1, countWords(t) / WORDS_PER_SECOND);

/** Reparte las palabras en la duracion de la frase, en proporcion a su longitud. */
export function wordsProportional(text: string, startMs: number, durationMs: number): Word[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  // Las pausas de puntuacion cuentan como caracteres extra.
  const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1 + (/[.,;:!?]$/.test(w) ? 3 : 0);
  const total = tokens.reduce((a, w) => a + weight(w), 0);
  let t = startMs;
  return tokens.map((w) => {
    const d = (weight(w) / total) * durationMs;
    const word = { text: w, startMs: Math.round(t), endMs: Math.round(t + d) };
    t += d;
    return word;
  });
}

/** Convierte marcas por caracter (ElevenLabs) en marcas por palabra. */
export function wordsFromAlignment(
  a: { chars: string[]; starts: number[]; ends: number[] },
  offsetMs: number,
): Word[] {
  const out: Word[] = [];
  let cur = '';
  let start = 0;
  let end = 0;
  const flush = () => {
    if (cur) out.push({ text: cur, startMs: Math.round(offsetMs + start * 1000), endMs: Math.round(offsetMs + end * 1000) });
    cur = '';
  };
  a.chars.forEach((ch, i) => {
    if (/\s/.test(ch)) return flush();
    if (!cur) start = a.starts[i];
    cur += ch;
    end = a.ends[i];
  });
  flush();
  return out;
}

export type Slot = { startFrame: number; durationFrames: number; startMs: number; durationMs: number };

/** Coloca cada frase en la linea de tiempo, con una pausa corta entre frases. */
export function buildTimeline(durationsSec: number[], fps: number, gapSec = 0.18, tailSec = 0.5) {
  let frame = 0;
  const slots: Slot[] = durationsSec.map((d) => {
    const durationFrames = Math.ceil((d + gapSec) * fps);
    const s = { startFrame: frame, durationFrames, startMs: (frame / fps) * 1000, durationMs: d * 1000 };
    frame += durationFrames;
    return s;
  });
  return { slots, totalFrames: frame + Math.ceil(tailSec * fps) };
}

/** Agrupa palabras en bloques cortos para mostrarlos en pantalla. */
export function chunkWords(words: Word[], maxWords = 3, maxChars = 16): Word[][] {
  const chunks: Word[][] = [];
  let cur: Word[] = [];
  let chars = 0;
  for (const w of words) {
    const endsSentence = cur.length > 0 && /[.!?]$/.test(cur[cur.length - 1].text);
    if (cur.length >= maxWords || (cur.length > 0 && chars + w.text.length > maxChars) || endsSentence) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(w);
    chars += w.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
