// Tiempo de cada tramo en el video final: velocidad (fija o en curva), al reves y congelado al final.
// Compartido por la exportacion (fast.ts) y la linea de tiempo del editor, para que midan igual.

/** Curvas de velocidad: [posicion en el tramo 0..1, velocidad]. */
export const CURVES = {
  rampa: [[0, 1], [0.35, 0.35], [0.65, 0.35], [1, 1]],
  subidon: [[0, 0.5], [1, 2]],
  frenazo: [[0, 2], [1, 0.4]],
  bala: [[0, 2], [0.42, 0.25], [0.58, 0.25], [1, 2]],
};
export const CURVE_NAMES = { rampa: 'Rampa lenta', subidon: 'Subidón', frenazo: 'Frenazo', bala: 'Tiempo bala' };
const PIECES = 8;

function curveAt(c, x) {
  for (let i = 1; i < c.length; i++) if (x <= c[i][0]) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1); }
  return c[c.length - 1][1];
}

/** Trozos del tramo con su velocidad: uno si es fija; una curva se reparte en 8 trozos. */
export function pieces(s) {
  const k = s.speed || 1, c = s.curve && CURVES[s.curve];
  if (!c) return [{ a: s.a, b: s.b, k }];
  const L = (s.b - s.a) / PIECES;
  return Array.from({ length: PIECES }, (_, i) => ({ a: s.a + i * L, b: s.a + (i + 1) * L, k: Math.min(4, Math.max(0.2, k * curveAt(c, (i + 0.5) / PIECES))) }));
}

/** Cuanto dura el tramo en el video final (sin contar la congelacion del final). */
export const segPlay = (s) => pieces(s).reduce((t, p) => t + (p.b - p.a) / p.k, 0);
/** Cuanto dura el tramo en el video final, con la congelacion. */
export const segOut = (s) => segPlay(s) + (s.hold || 0);
export const totalOut = (segs) => segs.reduce((t, s) => t + segOut(s), 0);

/** Segundos de video final que hay hasta el instante t del clip (lo quitado no cuenta). */
export function toOut(segs, t) {
  let o = 0;
  for (const s of segs) {
    if (t <= s.a) return o;
    if (t < s.b) {
      let d = 0;
      for (const p of pieces(s)) { if (t <= p.a) break; d += (Math.min(t, p.b) - p.a) / p.k; }
      return o + (s.rev ? segPlay(s) - d : d);
    }
    o += segOut(s);
  }
  return o;
}

/** Instante del clip que se ve en el segundo v del video final (en una congelacion, su ultimo fotograma). */
export function toSrc(segs, v) {
  let o = 0;
  for (const s of segs) {
    const play = segPlay(s);
    if (v < o + segOut(s) || s === segs[segs.length - 1]) {
      let d = Math.min(Math.max(0, v - o), play);
      if (s.rev) d = play - d;
      for (const p of pieces(s)) { const l = (p.b - p.a) / p.k; if (d <= l) return p.a + d * p.k; d -= l; }
      return s.b;
    }
    o += segOut(s);
  }
  return segs.length ? segs[segs.length - 1].b : 0;
}

/** Cadena de atempo para cualquier velocidad (cada atempo admite de 0,5 a 2). */
export function atempo(k) {
  const out = [];
  while (k > 2) { out.push(2); k /= 2; }
  while (k < 0.5) { out.push(0.5); k /= 0.5; }
  out.push(k);
  return out.map((x) => `atempo=${x.toFixed(4)}`).join(',');
}
