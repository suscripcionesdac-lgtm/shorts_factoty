/** Cambios, deshacer y plantilla del streamer. */
import { api, toast } from '/web/app.js';
import { findItem } from './actions.js';
import { isCanvasSel } from './direct.js';
import { renderLib } from './library.js';
import { loadMedia } from './open.js';
import { renderTabs } from './panels.js';
import { renderPanel, renderSum } from './review.js';
import { E, setTplTimer, tplTimer } from './state.js';
import { renderTl } from './timeline.js';

// ---------- cambios, deshacer y plantilla ----------
export const shot = (spec = E.spec) => JSON.stringify({ spec, start: E.start, end: E.end });
/** Guarda el estado actual para poder deshacer; un cambio nuevo invalida lo rehecho. */
export function pushUndo(s = shot()) {
  // Editar a mano durante la revision (escribir, arrastrar, borrar…) da la auto edicion por aplicada: si no, la siguiente
  // casilla rehacia el clip desde antes y se perdia lo tuyo. Ctrl+Z deshace tu cambio y luego la auto edicion.
  if (E.review) { rvFeedback(); E.review = null; toast('Auto edición aplicada; tu cambio va encima.'); }
  E.undo.push(s); if (E.undo.length > 40) E.undo.shift(); E.redo = []; }
/** Lo aceptado y lo quitado en la revision, para que la auto edicion aprenda (ver autoFeedback). */
export const rvFeedback = () => api('/api/autoedit/feedback', { streamer: E.src.streamer || '', items: [...E.review.parts.map((x) => ({ kind: x.kind, on: x.on })), ...(E.review.variants || []).map((v, i) => ({ kind: 'propuesta:' + v.id, on: i === E.review.vi }))] }).catch(() => {});
export function change(fn, undo = true) {
  if (undo) pushUndo();
  fn();
  renderTabs(); renderPanel(); renderTl(); renderSum(); renderLib();
  E.ovSig = E.capSig = ''; E.force = true;
  clearTimeout(tplTimer);
  setTplTimer(setTimeout(() => api('/api/template', { streamer: E.src.streamer || '', template: E.spec }).catch(() => {}), 800));
}
/** Deshacer (from = undo, to = redo) o rehacer (al reves). */
export function undo(redo = false) {
  E.review = null;
  const [from, to] = redo ? [E.redo, E.undo] : [E.undo, E.redo], last = from.pop();
  if (!last) return toast(redo ? 'No hay nada que rehacer.' : 'No hay nada que deshacer.');
  to.push(shot());
  const s = JSON.parse(last), range = s.start !== E.start || s.end !== E.end;
  Object.assign(E, { spec: s.spec, start: s.start, end: s.end, dur: s.end - s.start });
  if (E.sel && E.sel.kind !== 'seg' && !findItem(E.sel.kind, E.sel.id) && !isCanvasSel()) E.sel = null;
  E.selSig = '';
  if (range) loadMedia();
  renderTabs(); renderPanel(); renderTl(); renderSum(); E.ovSig = E.capSig = ''; E.force = true;
}
