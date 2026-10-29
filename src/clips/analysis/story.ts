import type { Phrase } from './agent';

/**
 * Cortar por historias, no por reloj. Medido contra OpusClip con el mismo directo (data/opus/): Clipper encontraba los
 * mismos momentos pero empezaba tarde (10-40 s despues), sin el planteamiento, y partia una historia en varios clips.
 * Lo que mas se acerco (46 % de coincidencia frente a 34 %): desde 30 s antes del pico hasta 15 s despues, en frases
 * completas, y uniendo los momentos que son la misma historia. Cortar por cambio de tema (frases con significado
 * parecido) y dejar que qwen2.5:7b eligiera las frases salio peor. Aqui todo son funciones puras (sin disco ni IA).
 */
export const STORY = { min: 15, max: 90, before: 30, after: 15, margin: 5, tail: 1 };

export type Span = { start: number; end: number };

/** Tramo del momento alrededor del pico (antes de ajustarlo a frases). */
export const storyWindow = (peak: number, total: number): Span => ({
  start: Math.max(0, peak - STORY.before),
  end: Math.min(total || peak + STORY.after, peak + STORY.after),
});
/** Lo que se escucha: la ventana con margen, para ver donde empieza la primera frase y acaba la ultima. */
export const storyContext = (peak: number, total: number): Span => ({
  start: Math.max(0, peak - STORY.before - STORY.margin),
  end: Math.min(total || peak + STORY.after + STORY.margin, peak + STORY.after + STORY.margin),
});

/** Ajusta a min..max sin perder el pico; si sobra, se recorta por el principio (el remate va al final). */
export function fit(start: number, end: number, peak: number, total = Infinity): Span {
  let a = Math.max(0, start), b = Math.min(total, end + STORY.tail);
  if (b - a > STORY.max) a = Math.max(a, b - STORY.max);
  if (peak < a) { a = Math.max(0, peak - 5); b = Math.min(total, a + STORY.max); }
  if (b - a < STORY.min) b = Math.min(total, a + STORY.min);
  return { start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10 };
}

/** El inicio va al principio de su frase y el final al final de la suya. */
export function snapToPhrases(ph: Phrase[], start: number, end: number, peak: number, total = Infinity): Span {
  if (!ph.length) return { start, end };
  const first = ph.find((p) => p.b > start) ?? ph[0];
  const last = [...ph].reverse().find((p) => p.a < end) ?? ph[ph.length - 1];
  return fit(first.a, Math.max(last.b, first.a), peak, total);
}

type Story = Span & { id: string; score: number };
/**
 * Momentos que son la misma historia (se pisan mas de la mitad del mas corto): se queda el de mejor nota, con el
 * tramo de los dos si cabe en el maximo. Devuelve los que sobran.
 */
export function mergeStories<T extends Story>(list: T[]): T[] {
  const drop: T[] = [];
  const keep = [...list].sort((x, y) => y.score - x.score);
  for (let i = 0; i < keep.length; i++) {
    for (let j = i + 1; j < keep.length; j++) {
      const k = keep[i], o = keep[j];
      const ov = Math.min(k.end, o.end) - Math.max(k.start, o.start);
      if (ov <= 0.5 * Math.min(k.end - k.start, o.end - o.start)) continue;
      const a = Math.min(k.start, o.start), b = Math.max(k.end, o.end);
      if (b - a <= STORY.max) { k.start = a; k.end = b; }
      drop.push(o);
      keep.splice(j--, 1);
    }
  }
  return drop;
}

/** «Hacer los clips solo»: como mucho uno cada 5 min de video, y al menos 3 (`autoClipsCap`). */
export const AUTO = { min: 8, every: 300, atLeast: 3 };
export const autoClipsCap = (duration: number) => Math.max(AUTO.atLeast, Math.floor(duration / AUTO.every));
/**
 * Que momentos hacer: los de nota AUTO.min o mas, sin pasar del tope por duracion ni repetir el mismo rato (se pisan mas
 * de la mitad del mas corto); si no llegan a AUTO.atLeast, se completa con los mejores que queden. Las notas no son
 * comparables entre directos (en uno de Westcol 43 de 57 pasaban de 8; en uno de Auron, 1 de 44): por eso el tope.
 */
export function pickClips<T extends Story>(list: T[], duration: number): T[] {
  const cap = autoClipsCap(duration), out: T[] = [];
  const free = (c: T) => out.every((o) => Math.min(o.end, c.end) - Math.max(o.start, c.start) <= 0.5 * Math.min(o.end - o.start, c.end - c.start));
  const sorted = [...list].sort((a, b) => b.score - a.score);
  for (const c of sorted) if (out.length < cap && c.score >= AUTO.min && free(c)) out.push(c);
  for (const c of sorted) if (out.length < AUTO.atLeast && !out.includes(c) && free(c)) out.push(c);
  return out;
}
