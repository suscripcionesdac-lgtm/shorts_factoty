/** Editar el video desde el texto. */
import { $ } from '/web/app.js';
import { segs } from './geometry.js';
import { E } from './state.js';

// ---------- editar el video desde el texto ----------
export const wordRange = () => { const a = E.selWord, b = E.selTo ?? E.selWord; return [Math.min(a, b), Math.max(a, b)]; };
/** La palabra sigue en el video (su mitad cae en un tramo que se conserva). */
export const inVideo = (w) => { const m = (w.startMs + w.endMs) / 2000; return segs().some((x) => m >= x.a && m < x.b); };
const normQ = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ]/g, '');
/** Donde aparece lo buscado (una palabra o varias seguidas): [primera, ultima]. La ultima puede estar a medio escribir. */
export function foundRanges() {
  const q = (E.subQ || '').split(/\s+/).map(normQ).filter(Boolean), ws = E.spec.captions.words || [], out = [];
  if (!q.length) return out;
  for (let i = 0; i + q.length <= ws.length; i++) if (q.every((t, k) => (k === q.length - 1 ? normQ(ws[i + k].text).startsWith(t) : normQ(ws[i + k].text) === t))) out.push([i, i + q.length - 1]);
  return out;
}
export function wordCls(i) {
  const ws = E.spec.captions.words, [a, b] = E.selTo != null ? wordRange() : [-1, -1];
  return [inVideo(ws[i]) ? '' : 'cut', foundRanges().some(([x, y]) => i >= x && i <= y) ? 'found' : '', i >= a && i <= b ? 'rng' : ''].join(' ');
}
export function foundHtml() {
  const n = foundRanges().length;
  return n ? `<span class="mut">${n} encontrad${n > 1 ? 'as' : 'a'}</span><button class="sm fix" data-e="subnext">Siguiente</button><button class="sm fix" data-e="subcutall">Quitar ${n > 1 ? 'las ' + n : 'esa'} del vídeo</button>` : E.subQ?.trim() ? '<span class="mut">No aparece en lo que se dice.</span>' : '';
}
export function refreshFound() {
  const l = $('wordList'); if (!l) return;
  l.querySelectorAll('[data-k]').forEach((b) => { const i = +b.dataset.k; b.classList.toggle('found', foundRanges().some(([x, y]) => i >= x && i <= y)); });
  $('subQn').innerHTML = foundHtml();
}
