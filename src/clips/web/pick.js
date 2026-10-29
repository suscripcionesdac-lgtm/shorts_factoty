// «Sacar clips»: elige entre los momentos ya encontrados los que piden la duración y el tipo, sin volver a analizar.

/** Duración de cada clip: [mínimo, máximo] en segundos; «auto» deja la que trae cada momento. */
export const DURS = { auto: null, corto: [15, 30], medio: [30, 60], largo: [60, 180] };

const LAUGH = /\b(?:ja){2,}|\bjsjs|\bxd+\b|\blol\b|\brisa|\bkek|\blul\b/i;
const words = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-zñ0-9]{4,}/g) || [];

/** Encaja un momento en la duración pedida, alrededor de su pico y sin salirse del vídeo. */
export function fit(c, dur, total = Infinity) {
  const r = DURS[dur], len = c.end - c.start;
  if (!r || (len >= r[0] && len <= r[1])) return { start: c.start, end: c.end };
  const want = Math.min(Math.max(len, r[0]), r[1]);
  let a = Math.max(0, Math.min(c.peak - want / 2, total - want));
  if (want < len) a = Math.min(Math.max(a, c.start), c.end - want); // al acortar, dentro del momento
  const r1 = (x) => Math.round(x * 10) / 10;
  return { start: r1(a), end: r1(a + want) };
}

/** Lo que más pesa en cada tipo de momento. */
const RANK = {
  fuertes: (c) => c.score,
  graciosos: (c) => c.score / 2 + (c.features?.hype || 0) + (LAUGH.test(c.text || '') ? 3 : 0),
  chat: (c) => c.score / 2 + (c.by === 'chat' ? 5 : 0) + (c.features?.chat || 0),
  historias: (c) => c.score / 2 + Math.min(4, (c.end - c.start) / 20) + Math.min(2, words(c.text).length / 60),
};

/** Los mejores momentos para lo pedido, con su tramo ya encajado en la duración. */
export function pickClips(cands, { kind = 'fuertes', dur = 'auto', hint = '', total } = {}, n = 8) {
  const want = [...new Set(words(hint))];
  const rank = (c) => {
    if (!want.length) return RANK[kind](c);
    const has = new Set(words(`${c.title} ${c.text} ${c.why} ${c.label || ''}`));
    // Cada palabra de las indicaciones que aparece suma (las de relleno, como «cuando», casi nunca coinciden).
    return RANK[kind](c) + Math.min(8, 4 * want.filter((w) => has.has(w)).length);
  };
  return cands
    .filter((c) => !c.hidden && !c.dup && !c.wait && (kind !== 'chat' || c.by === 'chat' || (c.features?.chat || 0) >= 2))
    .map((c) => ({ c, rank: rank(c), ...fit(c, dur, total) }))
    // Los ya exportados se ven (por si se quieren en otra duración), pero al final.
    .sort((a, b) => (a.c.exported ? 1 : 0) - (b.c.exported ? 1 : 0) || b.rank - a.rank)
    .slice(0, n);
}
