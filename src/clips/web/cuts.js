// Cortes de muletillas y repeticiones sobre los tramos que se conservan. Compartido entre el servidor (auto edicion,
// fillers.ts) y el editor (revision: marcar o desmarcar la propuesta).

/**
 * Quita los cortes de los tramos sin perder nunca voz: un corte que dejaria un trozo de menos de `minPiece` segundos a
 * un lado no se hace (el salto quedaria peor que la muletilla). Devuelve los tramos y los cortes que se aplicaron.
 */
export function cutFillers(segs, cuts, minPiece = 0.5) {
  let out = segs.map((s) => ({ ...s }));
  const applied = [];
  for (const c of cuts) {
    const k = out.findIndex((s) => c.a < s.b && c.b > s.a);
    if (k < 0) continue; // ya estaba fuera (silencio o frase quitada)
    const s = out[k], left = Math.max(0, c.a - s.a), right = Math.max(0, s.b - c.b);
    if ((left > 0 && left < minPiece) || (right > 0 && right < minPiece)) continue;
    const pieces = [...(left > 0 ? [{ ...s, a: s.a, b: c.a, hold: undefined }] : []), ...(right > 0 ? [{ ...s, a: c.b, b: s.b }] : [])];
    out = [...out.slice(0, k), ...pieces, ...out.slice(k + 1)];
    applied.push(c);
  }
  return { segments: out, applied };
}

/** Quita del video el rango [a, b] (puede cruzar varios tramos). Los trozos de menos de `minPiece` s que quedarian sueltos tambien se van. */
export function cutRange(segs, a, b, minPiece = 0.15) {
  return segs.flatMap((s) => [{ ...s, a: s.a, b: Math.min(s.b, a), hold: undefined }, { ...s, a: Math.max(s.a, b), b: s.b }]).filter((s) => s.b - s.a >= minPiece);
}

/** Devuelve al video el rango [a, b] (dentro de 0..dur): se une con los tramos que toque. */
export function restoreRange(segs, a, b, dur) {
  const all = [...segs, { a: Math.max(0, a), b: Math.min(dur, b) }].sort((x, y) => x.a - y.a), out = [];
  for (const s of all) { const last = out[out.length - 1]; if (last && s.a <= last.b + 0.05) last.b = Math.max(last.b, s.b); else out.push({ ...s }); }
  return out;
}
