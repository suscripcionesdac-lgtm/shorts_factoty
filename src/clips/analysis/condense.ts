import type { Seg } from '../media/spec';
import type { Phrase } from './agent';

/**
 * Condensar (como el «视频浓缩» de CapCut): de un tramo largo, un short de la duracion pedida con lo mejor, en orden y
 * con su contexto. Cada frase se puntua por su volumen, sus risas o gritos y sus palabras clave; se eligen las mejores
 * y, con cada una, la frase de antes si la prepara (sin preparacion un remate no se entiende). Funciones puras.
 */
export type Picked = Phrase & { score: number; setup?: boolean };

const LAUGH = /\b(?:[jh][aeiou]){2,}[jh]?\b|\bxd+\b/i;
const KEY = /[!¡?¿]|\b(no puede ser|madre m[ií]a|qu[eé] fuerte|dios|hostia|wtf|increíble|increible|brutal|locura|en serio|mira|ojo|atenci[oó]n)\b/i;

/** Puntuacion de una frase: lo que engancha en un short. */
export function scorePhrase(p: Phrase, energyZ: number[]) {
  const secs = energyZ.slice(Math.floor(p.a), Math.max(Math.floor(p.a) + 1, Math.ceil(p.b)));
  const loud = secs.length ? Math.max(0, Math.max(...secs)) : 0;
  const len = p.b - p.a;
  return loud * 1.2 + (LAUGH.test(p.text) ? 2 : 0) + (KEY.test(p.text) ? 1 : 0) + Math.min(1, p.text.split(/\s+/).length / 8) - (len < 0.8 ? 0.8 : 0);
}

/**
 * Elige frases hasta `target` segundos (entre el 85 % y el 115 %), en orden, y devuelve los tramos a conservar.
 * `prefer`: numeros de frase que el agente eligio (mandan si suman una duracion razonable).
 */
export function condense(o: { phrases: Phrase[]; energyZ: number[]; target: number; prefer?: number[] }): { segments: Seg[]; picked: Picked[] } {
  const ph = o.phrases.filter((p) => p.b - p.a > 0.2);
  const len = (l: Phrase[]) => l.reduce((t, p) => t + (p.b - p.a), 0);
  const scored: Picked[] = ph.map((p) => ({ ...p, score: scorePhrase(p, o.energyZ) }));
  let picked: Picked[] = [];
  // Lo que eligio el agente, si tiene sentido (frases que existen y una duracion cercana a la pedida).
  if (o.prefer?.length) {
    const want = new Set(o.prefer);
    const l = scored.filter((p) => want.has(p.i));
    if (l.length && len(l) >= o.target * 0.6 && len(l) <= o.target * 1.3) picked = l;
  }
  if (!picked.length) {
    const chosen = new Set<number>(), setups = new Set<number>();
    for (const p of [...scored].sort((x, y) => y.score - x.score)) {
      if (len(scored.filter((x) => chosen.has(x.i))) >= o.target * 0.85) break;
      const add = [p];
      // La frase de antes, si va pegada (la preparacion del momento).
      const prev = scored.find((x) => x.i === p.i - 1);
      if (prev && !chosen.has(prev.i) && p.a - prev.b < 1.5) add.unshift(prev);
      const total = len(scored.filter((x) => chosen.has(x.i))) + len(add);
      if (total > o.target * 1.15) { if (len(scored.filter((x) => chosen.has(x.i))) + len([p]) <= o.target * 1.15) chosen.add(p.i); continue; }
      for (const x of add) chosen.add(x.i);
      if (add.length > 1) setups.add(add[0].i);
    }
    picked = scored.filter((x) => chosen.has(x.i)).map((x) => (setups.has(x.i) ? { ...x, setup: true } : x));
  }
  picked.sort((x, y) => x.a - y.a);
  // Tramos: cada frase con un poco de aire; las que estan casi pegadas se juntan (asi no hay saltos innecesarios).
  const segs: Seg[] = [];
  for (const p of picked) {
    const a = Math.max(0, p.a - 0.12), b = p.b + 0.2, last = segs[segs.length - 1];
    if (last && a - last.b < 0.8) last.b = Math.max(last.b, b);
    else segs.push({ a: Math.round(a * 100) / 100, b: Math.round(b * 100) / 100 });
  }
  for (const s of segs) s.b = Math.round(s.b * 100) / 100;
  return { segments: segs, picked };
}
