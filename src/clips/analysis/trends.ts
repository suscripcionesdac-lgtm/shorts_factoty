// Tendencias: que funciona ahora en Shorts con este streamer. Se buscan sus Shorts mas recientes (YouTube, sin cuenta)
// y de los mas vistos se saca la duracion, las palabras y hashtags que se repiten y como son sus titulos.
// Todo es local y sin IA: alimenta la puntuacion, la duracion de los clips, los titulos y la descripcion.

export type TrendItem = { title: string; views: number; seconds: number };
export type Trend = {
  at: string; n: number;
  /** Duracion que mejor funciona (mediana de los mas vistos), en segundos. */
  seconds: number;
  /** Palabras que se repiten en los titulos de los mas vistos y poco en los demas. */
  words: string[];
  hashtags: string[];
  /** Fraccion de titulos en MAYUSCULAS y con emoji, entre los mas vistos. */
  caps: number; emoji: number;
  titles: { t: string; v: number }[];
};

const STOP = new Set('el la los las un una unos unas de del al y o que en con por para su sus se le lo me te mi tu es son fue ser como mas más muy pero sin sobre este esta esto ese esa eso ya no si sí a the and of to in for is on with my your this that it be shorts short clips clip video viral parte part'.split(' '));
const EMOJI = /\p{Extended_Pictographic}/u;
const tokens = (t: string) => t.toLowerCase().replace(/#\S+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
// Titulo «en mayusculas»: al menos la mitad de sus palabras (sin hashtags) van enteras en mayusculas, como «AURON PIERDE la APUESTA».
const isCaps = (t: string) => { const w = t.replace(/#\S+/g, ' ').split(/\s+/).map((x) => x.replace(/[^\p{L}]/gu, '')).filter((x) => x.length >= 3); return w.length > 0 && w.filter((x) => x === x.toUpperCase()).length / w.length >= 0.5; };

/** Lo que tienen en comun los Shorts que mas funcionan (el tercio mas visto frente al resto). */
export function trendOf(items: TrendItem[], streamer = ''): Trend | null {
  const list = items.filter((x) => x.title && x.seconds > 0 && x.seconds <= 90 && x.views >= 0).sort((a, b) => b.views - a.views);
  if (list.length < 6) return null;
  const top = list.slice(0, Math.max(3, Math.ceil(list.length / 3))), rest = list.slice(top.length);
  // El nombre del streamer (y sus partes: «auron» de «auronplay») no es una tendencia.
  const sn = streamer.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''), name = { has: (w: string) => sn.length >= 3 && (sn.includes(w) || w.includes(sn)) };
  // Palabras: en cuantos titulos del tercio de arriba salen, menos lo que salen en el resto (proporcionalmente).
  const df = (l: TrendItem[]) => { const m = new Map<string, number>(); for (const x of l) for (const w of new Set(tokens(x.title))) m.set(w, (m.get(w) || 0) + 1); return m; };
  const dt = df(top), dr = df(rest);
  const words = [...dt].filter(([w, n]) => n >= 2 && !name.has(w)).map(([w, n]) => [w, n / top.length - (dr.get(w) || 0) / Math.max(1, rest.length)] as const)
    .filter(([, lift]) => lift > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  const tags = new Map<string, number>();
  for (const x of top) for (const h of new Set((x.title.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.toLowerCase()))) tags.set(h, (tags.get(h) || 0) + 1);
  return {
    at: new Date().toISOString(), n: list.length,
    seconds: Math.round(median(top.map((x) => x.seconds))),
    words, hashtags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h]) => h),
    caps: Math.round((top.filter((x) => isCaps(x.title)).length / top.length) * 100) / 100,
    emoji: Math.round((top.filter((x) => EMOJI.test(x.title)).length / top.length) * 100) / 100,
    titles: top.slice(0, 6).map((x) => ({ t: x.title.slice(0, 100), v: x.views })),
  };
}

/**
 * Titulos sin IA: la frase mas intensa de lo que se dice, con el nombre del streamer y el estilo de los Shorts que
 * mas funcionan (mayusculas, emoji). Con IA local (Ollama) se usan los titulos de tendencia como ejemplos.
 */
export function localTitles(text: string, streamer: string, t: Trend | null, hype: RegExp): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length < 3) return [];
  // Candidatas: las frases completas (entre signos de puntuacion) de 3 a 9 palabras y, por si no hay puntuacion,
  // ventanas de 4 a 7. Gana la que tiene mas reaccion y palabras de tendencia, y que no se corta a medias.
  const trendW = new Set(t?.words || []);
  const cands = new Map<string, number>();
  for (const f of text.split(/(?<=[.!?…])\s+|[\n]+/)) { const n = f.trim().split(/\s+/).length; if (n >= 3 && n <= 9) cands.set(f.trim(), 1); }
  for (let n = 4; n <= 7; n++) for (let i = 0; i + n <= words.length; i++) { const p = words.slice(i, i + n).join(' '); if (!cands.has(p)) cands.set(p, 0); }
  const START = /^(y|que|pero|entonces|pues|bueno|o|a|de|en|con|por|porque|ni)\b/i, END = /\b(que|de|del|el|la|los|las|lo|a|al|en|y|o|con|por|un|una|su|mi|tu|se|me|te|le|no|es|si|como|para|pero)[^\p{L}]*$/iu;
  let best = '', bestScore = -Infinity;
  for (const [p, whole] of cands) {
    const n = p.split(/\s+/).length, i = text.indexOf(p) / Math.max(1, text.length);
    const sc = (p.match(hype) || []).length * 2 + tokens(p).filter((w) => trendW.has(w)).length + (/[?!¿¡]/.test(p) ? 1 : 0) + whole
      - (START.test(p) ? 1 : 0) - (END.test(p) ? 1.5 : 0) - Math.abs(n - 6) * 0.15 - i * 0.3;
    if (sc > bestScore) (bestScore = sc), (best = p);
  }
  const clean = best.replace(/^[^\p{L}¿¡]+|[^\p{L}?!]+$/gu, '');
  const who = (streamer || '').trim();
  const caps = (s: string) => (t && t.caps >= 0.5 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));
  const emo = t && t.emoji >= 0.3 ? (/[?¿]/.test(clean) ? ' 😳' : /jaj|risa|xd/i.test(text) ? ' 😂' : ' 😱') : '';
  const out = [
    caps(who ? `${who}: «${clean}»` : `«${clean}»`) + emo,
    caps(who ? `${who} no se lo esperaba` : 'Nadie se lo esperaba') + emo,
    caps(`${clean}${/[?!]$/.test(clean) ? '' : '...'}`) + emo,
  ];
  return [...new Set(out.map((x) => x.slice(0, 60)))];
}

/** Hashtags para la descripcion: los de tendencia mas el del streamer y #shorts, sin repetir. */
export function trendHashtags(t: Trend | null, streamer: string) {
  const own = streamer ? '#' + streamer.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '') : '';
  // Como los canales de clips que funcionan: #<streamer>clips, #clipsvirales y el del streamer (no #shorts, que en TikTok no aporta).
  return [...new Set([own ? own + 'clips' : '', '#clipsvirales', own, ...(t?.hashtags || []).filter((h) => h.toLowerCase() !== '#shorts')].filter((h) => h && h.length > 1))].slice(0, 6);
}
