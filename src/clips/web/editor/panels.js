/** Paneles de herramientas. */
import { $, esc } from '/web/app.js';
import { icon } from '/web/icons.js';
import { root } from './actions.js';
import { isCanvasSel, selName } from './direct.js';
import { camList, segs } from './geometry.js';
import { LIB, renderLib } from './library.js';
import { renderPanel } from './review.js';
import { E, KIND_TOOL, TOOLS } from './state.js';
import { renderTl } from './timeline.js';

// ---------- paneles ----------
/** Lo que ya tiene cada herramienta: un numero (cuantos elementos) o true (activa), para verlo sin abrirla. */
export function badge(k) {
  const sp = E.spec, col = sp.color;
  switch (k) {
    case 'recorte': return segs().length > 1 ? segs().length : !!sp.hook;
    case 'encuadre': return camList().length > 1 ? camList().length : false;
    case 'subs': return !!sp.captions.on;
    case 'texto': return sp.texts.length || !!(sp.title || sp.outro.on || sp.credit);
    case 'stickers': return sp.stickers.length;
    case 'sonido': return sp.sfx.length || !!(sp.music || sp.cleanAudio || sp.voice);
    case 'zoom': return sp.zooms.length + (sp.punches?.length || 0);
    case 'trans': return !!sp.transition;
    case 'lento': return !!sp.replay;
    case 'imagen': return !!(col.brightness || col.contrast !== 1 || col.saturation !== 1 || (sp.speed || 1) !== 1 || sp.progress || sp.flash);
    case 'censura': return sp.blurs.length || !!sp.censor.on;
  }
  return 0;
}
export function renderTabs() {
  const sel = !E.review && isCanvasSel();
  // Cada herramienta de la barra marca si ya tiene algo puesto (un punto), sin tener que abrirla.
  document.querySelectorAll('#efn [data-e=tool]').forEach((b) => { const on = !E.review && b.dataset.k === E.tool; b.classList.toggle('on', on); b.classList.toggle('has', !!badge(b.dataset.k)); b.setAttribute('aria-pressed', String(on)); });
  $('etabs').innerHTML = E.review || (E.tool === 'clip' && !sel) ? '' : `<button class="sm ghost fix iback" data-e="tool" data-k="clip">${icon('right', 'sm flip')}Clip</button><span class="mut">/</span><b class="crumb">${esc(sel ? selName() : TOOLS.find(([k]) => k === E.tool)?.[1] || '')}</b>`;
}
/** Rapido: sin biblioteca, todo el espacio para la vista previa y los ajustes. */
export function setMode(m) {
  root().classList.toggle('rapido', m === 'rapido');
  root().querySelectorAll('[data-e=mode]').forEach((b) => { b.classList.toggle('on', b.dataset.k === m); b.setAttribute('aria-pressed', String(b.dataset.k === m)); });
}
/** Abre una herramienta en el inspector. */
export function openTool(t) {
  if (!t) return;
  // Abrir otra herramienta deja de elegir lo de la vista previa (si no, el inspector seguiria enseñando sus propiedades).
  const away = E.sel && KIND_TOOL[E.sel.kind] !== t;
  if (away) { E.sel = null; E.multi = []; }
  if (t === E.tool && !away) return;
  E.tool = t; syncLib(); renderTabs(); renderPanel(); renderLib(); renderTl(); $('epanel').scrollTop = 0;
}
/** La biblioteca enseña la pestaña de la herramienta abierta (si tiene). */
export function syncLib() { const l = LIB.find((x) => x[3] === E.tool); if (l) E.lib = l[0]; }
