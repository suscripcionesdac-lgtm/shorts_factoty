/** Censura: la misma regla que el exportador. */
import { assetsCache, E } from './state.js';

// ---------- censura (misma regla que el exportador) ----------
const normW = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
let badSet = null, extraCache = ['', new Set()];
export function isCen(w) {
  if (w.cen != null) return w.cen;
  const n = normW(w.text), ex = E.spec.censor.extra || '';
  if (!n) return false;
  badSet = badSet || new Set((assetsCache.bad || '').split('|'));
  if (extraCache[0] !== ex) extraCache = [ex, new Set(ex.split(/[,\n]+/).map(normW).filter(Boolean))];
  return badSet.has(n) || extraCache[1].has(n);
}
export const maskW = (t) => t.replace(/[\p{L}\p{N}]+/u, (m) => m[0] + '*'.repeat(Math.max(1, m.length - 1)));
export const censored = () => (E.spec.captions.words || []).map((w, i) => ({ w, i })).filter((x) => !x.w.del && isCen(x.w));
export const isMuted = (t) => E.spec.censor.on && censored().some(({ w }) => t * 1000 >= w.startMs - 40 && t * 1000 <= Math.max(w.endMs, w.startMs + 250) + 40);
