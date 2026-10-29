/** Selector de zonas en grande. */
import { $, fmt, ranges, segs as segThumbs, vt } from '/web/app.js';
import { actions, at, root } from './actions.js';
import { deselect, isCanvasSel, nudge } from './direct.js';
import { CAMLAYS, camList } from './geometry.js';
import { change, pushUndo, shot, undo } from './history.js';
import { editorEmpty } from './open.js';
import { seek, togglePlay, video } from './playback.js';
import { clamp, E, setDrag, TOOLS, uid, ZC } from './state.js';
import { closeCtx, jumpMarker, selectAll, shuttle } from './timeline.js';
import { closeSug } from './transitions.js';

// ---------- selector de zonas en grande ----------
const MINZ = 0.03;
function zlist() {
  const sp = E.spec, M = E.modal, out = [];
  if (M.cam) {
    const cams = camList();
    if (cams.length > 1) cams.forEach((c, i) => out.push({ k: 'cam', id: c === sp.cam ? 'cam' : 'cam:' + sp.cams.indexOf(c), r: c, n: i + 1, main: c === sp.cam }));
    else out.push({ k: 'cam', id: 'cam', r: sp.cam });
  }
  if (M.game && sp.game) out.push({ k: 'game', id: 'game', r: sp.game });
  sp.blurs.forEach((z, i) => out.push({ k: 'blur', id: z.id, r: z, n: i + 1 }));
  return out;
}
export function openPicker(mode) {
  // En pantalla completa solo se ve la vista previa: el selector (que va fuera) quedaba oculto y se cerraba. Se sale antes.
  if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {}).then(() => openPicker(mode));
  const sp = E.spec, cam = CAMLAYS.includes(sp.layout), game = ['split', 'half', 'pip', 'float'].includes(sp.layout);
  if (mode !== 'blur' && !cam) mode = 'blur';
  video()?.pause();
  // Si el anterior aun se esta cerrando (con animacion), se cierra ya: si no, los dos convivirian con el mismo id.
  if (E.modal) closePicker(true);
  E.modal = { mode, sel: mode === 'blur' ? sp.blurs[0]?.id ?? null : mode, t: Math.round(clamp(E.t ?? E.dur / 2, 0, E.dur)), back: JSON.stringify({ cam: sp.cam, game: sp.game, blurs: sp.blurs, cams: sp.cams, camTrack: sp.camTrack }), cam, game };
  const m = document.createElement('div');
  m.id = 'zmodal'; m.className = 'zmodal';
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Zonas del video original');
  root().appendChild(m);
  zrender();
}
function closePicker(keep, M = E.modal) {
  if (!M || M.closed) return;
  M.closed = true;
  const before = JSON.parse(M.back);
  E.modal = null;
  $('zmodal')?.remove();
  if (!keep) Object.assign(E.spec, before);
  else {
    E.spec.blurs = E.spec.blurs.filter((z) => z.w >= MINZ * 0.6 && z.h >= MINZ * 0.6);
    pushUndo(shot({ ...E.spec, ...before }));
  }
  change(() => {}, false);
}
/** Cierra el selector: la imagen grande vuelve a su miniatura del panel. */
export function closeZones(keep) {
  const M = E.modal; // el cierre llega tras la animacion: que no cierre otro selector abierto mientras tanto
  return vt(() => { closePicker(keep, M); const pk = $('picker'); if (pk) pk.style.viewTransitionName = 'zone'; }).then(() => { const pk = $('picker'); if (pk) pk.style.viewTransitionName = ''; });
}
function zrender() {
  const M = E.modal, modes = [...(M.cam ? ['cam'] : []), ...(M.game ? ['game'] : []), 'blur'];
  $('zmodal').innerHTML = `<div class="zbox">
    <div class="row wrap"><h2 class="fix">Zonas del video original</h2>
      <div class="seg fix">${modes.map((k) => `<button class="${M.mode === k ? 'on' : ''}" data-e="zmode" data-k="${k}"><i class="dot" style="background:${ZC[k][0]}"></i>${ZC[k][1]}</button>`).join('')}</div>
      <span class="grow"></span>
      ${M.cam ? '<button class="fix" data-e="zdetect">Detectar cámara</button>' : ''}
      <button class="fix" data-e="zcancel">Cancelar</button><button class="pri fix" data-e="zdone" style="min-width:110px">Listo</button></div>
    <div class="mut" id="zhint"></div>
    <div class="zwrap"><div class="zstage" id="zstage" style="--ar:${((E.src.width || 16) / (E.src.height || 9)).toFixed(4)}"><img id="zimg" alt="Fotograma del video original" draggable="false" width="1280" height="720" src="/api/frame?sid=${E.src.id}&t=${Math.round(E.start + M.t)}&hd=1" /><div id="zrects"></div></div></div>
    <div class="row wrap"><span class="mut fix">Fotograma</span><input type="range" id="zt" min="0" max="${Math.floor(E.dur)}" step="1" value="${M.t}" aria-label="Instante del clip que se muestra" style="flex:1 1 220px" /><span class="mono fix" id="ztl">${fmt(M.t)}</span><span id="zextra" class="row fix"></span></div></div>`;
  ranges($('zmodal'));
  zpaint();
}
export function zpaint() {
  const M = E.modal;
  if (!M || !$('zrects')) return;
  $('zrects').innerHTML = zlist().map((z) => `<div class="zr ${M.sel === z.id ? 'sel' : ''} ${z.k === M.mode ? '' : 'off'} ${z.r.y < 0.06 ? 'in' : ''}" data-z="${z.id}" style="left:${z.r.x * 100}%;top:${z.r.y * 100}%;width:${z.r.w * 100}%;height:${z.r.h * 100}%;--c:${ZC[z.k][0]}"><span>${ZC[z.k][1]}${z.n ? ' ' + z.n : ''}${z.main ? ' · principal' : ''}</span>${M.sel === z.id ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<i class="zh ${h}" data-h="${h}"></i>`).join('') : ''}</div>`).join('');
  document.querySelectorAll('#zmodal [data-e="zmode"]').forEach((b) => b.classList.toggle('on', b.dataset.k === M.mode));
  segThumbs($('zmodal'));
  $('zhint').textContent = M.mode === 'blur' ? 'Arrastra sobre la imagen para marcar lo que quieres tapar (el chat, un nombre, una donación). Puedes marcar varias zonas.'
    : `Arrastra sobre la imagen para marcar ${M.mode === 'cam' ? 'la cámara del streamer (si salen varios, «Añadir cámara» para cada uno)' : 'la parte del juego'}. Luego muévela o estírala por los puntos blancos; las flechas del teclado la ajustan al milímetro.`;
  $('zextra').innerHTML = M.mode === 'cam' ? `<button class="sm fix" data-e="zaddcam" ${(E.spec.cams?.length || 1) >= 12 ? 'disabled' : ''}>Añadir cámara</button><button class="sm fix" data-e="zdelcam" ${String(M.sel).startsWith('cam:') ? '' : 'disabled'}>Quitar esta cámara</button><span class="mut fix">Principal en la esquina</span>${[['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']].map(([k, a]) => `<button class="sm icon fix" data-e="zcorner" data-k="${k}" aria-label="Cámara en la esquina ${k}">${a}</button>`).join('')}`
    : M.mode === 'blur' ? `<button class="sm fix" data-e="zdel" ${E.spec.blurs.some((z) => z.id === M.sel) ? '' : 'disabled'}>Borrar esta zona</button>` : '';
}
let zTimer = 0;
export function zframe(t) {
  E.modal.t = t;
  $('ztl').textContent = fmt(t);
  clearTimeout(zTimer);
  zTimer = setTimeout(() => { if (E.modal) $('zimg').src = `/api/frame?sid=${E.src.id}&t=${Math.round(E.start + t)}&hd=1`; }, 180);
}
export function zdown(e) {
  const M = E.modal;
  if (!e.target.closest('#zstage')) return;
  e.preventDefault();
  const b = $('zimg').getBoundingClientRect(), p = (ev) => ({ x: clamp((ev.clientX - b.left) / b.width, 0, 1), y: clamp((ev.clientY - b.top) / b.height, 0, 1) }), s = p(e);
  // Solo se pueden mover las zonas del modo activo: asi se puede dibujar una zona nueva encima de otra (tapar algo dentro del juego).
  const hit = e.target.closest('.zr:not(.off)'), h = e.target.closest('.zh')?.dataset.h;
  const node = (id) => $('zrects').querySelector(`[data-z="${id}"]`);
  const place = (el, r) => el && Object.assign(el.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
  if (hit) {
    const z = zlist().find((x) => x.id === hit.dataset.z), r = z.r, o = { x: r.x, y: r.y, w: r.w, h: r.h };
    M.sel = z.id; M.mode = z.k;
    zpaint();
    setDrag({ move: (ev) => {
      const q = p(ev), dx = q.x - s.x, dy = q.y - s.y;
      if (!h) { r.x = clamp(o.x + dx, 0, 1 - o.w); r.y = clamp(o.y + dy, 0, 1 - o.h); }
      else {
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (h.includes('w')) x0 = clamp(o.x + dx, 0, x1 - MINZ);
        if (h.includes('e')) x1 = clamp(x1 + dx, x0 + MINZ, 1);
        if (h.includes('n')) y0 = clamp(o.y + dy, 0, y1 - MINZ);
        if (h.includes('s')) y1 = clamp(y1 + dy, y0 + MINZ, 1);
        Object.assign(r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
      place(node(z.id), r);
    }, up: zpaint });
    return;
  }
  // Arrastre sobre una zona vacia: dibuja la zona del modo actual (o una zona difuminada nueva).
  let r = null;
  setDrag({ move: (ev) => {
    const q = p(ev);
    if (!r && Math.abs(q.x - s.x) < 0.012 && Math.abs(q.y - s.y) < 0.012) return;
    if (!r) {
      if (M.mode === 'blur') { r = { id: uid(), x: s.x, y: s.y, w: 0, h: 0, a: 0, b: E.dur, all: true }; E.spec.blurs.push(r); M.sel = r.id; }
      else if (M.mode === 'cam' && String(M.sel).startsWith('cam:') && E.spec.cams?.[+M.sel.slice(4)]) r = E.spec.cams[+M.sel.slice(4)];
      else { r = E.spec[M.mode] = E.spec[M.mode] || { x: 0, y: 0, w: 0.2, h: 0.2 }; M.sel = M.mode; }
      zpaint();
    }
    Object.assign(r, { x: Math.min(s.x, q.x), y: Math.min(s.y, q.y), w: Math.max(MINZ, Math.abs(q.x - s.x)), h: Math.max(MINZ, Math.abs(q.y - s.y)) });
    r.w = Math.min(r.w, 1 - r.x); r.h = Math.min(r.h, 1 - r.y);
    place(node(M.sel), r);
  }, up: zpaint });
}
function zkey(e) {
  const M = E.modal, z = zlist().find((x) => x.id === M.sel), d = e.shiftKey ? 0.02 : 0.004;
  if (e.key === 'Escape') return closeZones(false);
  if (e.key === 'Enter') return closeZones(true);
  if ((e.key === 'Delete' || e.key === 'Backspace') && z?.k === 'blur') return actions.zdel();
  if (!z || !e.key.startsWith('Arrow')) return;
  e.preventDefault();
  if (e.key === 'ArrowLeft') z.r.x = clamp(z.r.x - d, 0, 1 - z.r.w);
  if (e.key === 'ArrowRight') z.r.x = clamp(z.r.x + d, 0, 1 - z.r.w);
  if (e.key === 'ArrowUp') z.r.y = clamp(z.r.y - d, 0, 1 - z.r.h);
  if (e.key === 'ArrowDown') z.r.y = clamp(z.r.y + d, 0, 1 - z.r.h);
  zpaint();
}

export function editorKey(e) {
  if (!E) return;
  if (E.modal) return zkey(e);
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod) {
    if (k === 'z') { e.preventDefault(); undo(e.shiftKey); }
    else if (k === 'y') { e.preventDefault(); undo(true); }
    else if (k === 'd') { e.preventDefault(); actions.dupsel(); }
    else if (k === 'a') { e.preventDefault(); selectAll(); }
    else if (e.altKey && k === 'c') { e.preventDefault(); actions.copyattr(); }
    else if (e.altKey && k === 'v') { e.preventDefault(); actions.pasteattr(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); jumpMarker(e.key === 'ArrowLeft' ? -1 : 1); }
    return;
  }
  if (e.altKey) return;
  if (E.canvasFocus && isCanvasSel() && e.key.startsWith('Arrow')) { e.preventDefault(); return nudge(e.key, e.shiftKey); }
  if (e.key === 'Escape' && closeSug(true)) return;
  if (e.code === 'Space') { e.preventDefault(); shuttle(0); togglePlay(); }
  else if (k === 'j' || k === 'k' || k === 'l') shuttle(k === 'j' ? -1 : k === 'l' ? 1 : 0);
  else if (k === 'm') actions.addmarker();
  else if (k === 'f') actions.fullscreen();
  else if ((e.code === 'Comma' || e.code === 'Period') && e.shiftKey) { const v = video(); if (v && !v.paused) v.pause(); seek(at() + (e.code === 'Comma' ? -10 : 10) / 30); }
  else if (k === 's') actions.split();
  else if ((e.key === 'Delete' || e.key === 'Backspace') && E.tool === 'subs' && E.selWord >= 0 && document.activeElement?.closest?.('#wordList')) actions.wordcut();
  else if (e.key === 'Delete' || e.key === 'Backspace') actions.delsel();
  else if (e.key === 'Escape' && closeCtx()) return;
  else if (e.key === 'Escape' && E.sel) { deselect(); E.ovSig = ''; }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(at() + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1)); }
  else if (e.key === ',' || e.key === '.') { const v = video(); if (v && !v.paused) v.pause(); seek(at() + (e.key === ',' ? -1 : 1) / 30); }
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'End') seek(E.dur);
  else if (/^[0-9]$/.test(e.key)) { const t = e.key === '0' ? TOOLS[TOOLS.length - 1] : TOOLS[+e.key - 1]; if (t) actions.tool({ dataset: { k: t[0] } }); }
}

// Al entrar en la pestaña del editor sin clip abierto se muestra una pantalla de ayuda.
const host = document.getElementById('v-editor');
new MutationObserver(() => { if (!host.hidden) editorEmpty(); }).observe(host, { attributes: true, attributeFilter: ['hidden'] });
