/** Tramos: velocidad, curva, al reves, congelado, espejo y giro. */
import { CURVE_NAMES } from '/web/segtime.js';
import { fmt } from '/web/app.js';
import { at } from './actions.js';
import { segs } from './geometry.js';
import { change } from './history.js';
import { num } from './library.js';
import { E } from './state.js';

// ---------- tramos: velocidad, curva, al reves, congelado, espejo y giro ----------
/** El tramo elegido en la linea de tiempo (o el del cursor), dentro de una lista de tramos que se puede cambiar. */
export function segAt() {
  if (!E.spec.segments) E.spec.segments = segs().map((x) => ({ ...x }));
  const i = E.sel?.kind === 'seg' ? E.sel.id : E.spec.segments.findIndex((x) => at() >= x.a && at() < x.b);
  return E.spec.segments[i];
}
export function segEdit(fn) { change(() => { const x = segAt(); if (x) fn(x); }); }
export const segTags = (x) => [x.speed ? '×' + x.speed : '', x.curve ? CURVE_NAMES[x.curve] : '', x.rev ? 'al revés' : '', x.hold ? 'congelado ' + x.hold + ' s' : '', x.flip ? 'espejo' : '', x.rot ? x.rot + '°' : ''].filter(Boolean).map((t) => ` · ${t}`).join('');
export function segPanel() {
  const ss = segs(), i = E.sel?.kind === 'seg' ? E.sel.id : ss.findIndex((x) => at() >= x.a && at() < x.b), x = ss[i];
  if (!x) return '';
  const k = x.speed || 1, chip = (e, v, label, on) => `<button class="sm ${on ? 'on' : ''}" data-e="${e}" data-k="${v}" aria-pressed="${on}">${label}</button>`;
  return `<h3 style="margin-top:16px">Tramo ${i + 1} <span class="mut" style="text-transform:none;letter-spacing:0">${fmt(x.a)}–${fmt(x.b)}</span></h3>
    <div class="mut" style="margin-bottom:6px">Velocidad (la voz no cambia de tono)</div>
    <div class="chips">${[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((v) => chip('segspeed', v, v === 1 ? 'Normal' : '×' + v, Math.abs(k - v) < 0.01)).join('')}</div>
    <div class="mut" style="margin:8px 0 6px">Curva de velocidad</div>
    <div class="chips">${chip('segcurve', '', 'Ninguna', !x.curve)}${Object.entries(CURVE_NAMES).map(([c, n]) => chip('segcurve', c, n, x.curve === c)).join('')}</div>
    <div class="row wrap" style="margin-top:10px;gap:6px">${['segrev:Al revés:' + !!x.rev, 'segflip:Espejo:' + !!x.flip?.includes('h'), 'segflipv:Voltear:' + !!x.flip?.includes('v')].map((t) => { const [e, n, on] = t.split(':'); return `<button class="sm fix ${on === 'true' ? 'on' : ''}" data-e="${e === 'segflipv' ? 'segflip' : e}" ${e === 'segflip' ? 'data-k="h"' : e === 'segflipv' ? 'data-k="v"' : ''} aria-pressed="${on}">${n}</button>`; }).join('')}
      <button class="sm fix" data-e="segrot" data-k="-90" aria-label="Girar 90 grados a la izquierda">↺ 90°</button><button class="sm fix" data-e="segrot" data-k="90" aria-label="Girar 90 grados a la derecha">↻ 90°</button></div>
    ${num('seg.rot', `Giro: ${x.rot || 0}°`, x.rot || 0, -180, 180)}
    ${num('seg.hold', `Congelar al final: ${x.hold ? x.hold + ' s' : 'no'}`, Math.round((x.hold || 0) * 2), 0, 20)}
    ${x.rev ? '<div class="mut">«Al revés» se ve en el vídeo exportado; la vista previa no puede reproducir hacia atrás.</div>' : ''}`;
}
