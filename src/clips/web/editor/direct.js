/** Seleccion y edicion directa sobre la vista previa. */
import { $, esc, fmt, S, toast } from '/web/app.js';
import { icon } from '/web/icons.js';
import { applyTracks } from '/web/tracks.js';
import { at, findItem, root, select } from './actions.js';
import { camList, capManual, MULTI, withScene } from './geometry.js';
import { change, pushUndo, shot } from './history.js';
import { camsPanel, renderLib } from './library.js';
import { renderTabs } from './panels.js';
import { video } from './playback.js';
import { LAY_NAME, renderFloat, renderPanel } from './review.js';
import { CANVAS_KINDS, clamp, CW, E, FONTS, H, KIND_NAME, KIND_TOOL, setDrag, SWATCHES, W } from './state.js';
import { isSel, locked, renderTl } from './timeline.js';

// ---------- escribir encima de la vista previa (doble clic en un texto o en el titulo) ----------
document.addEventListener('dblclick', (e) => {
  if (!E || root().hidden) return;
  const el = e.target.closest('#ov .ov-item[data-ov=texts], #ov [data-ov=title]');
  if (!el) return;
  const isTitle = el.dataset.ov === 'title', it = isTitle ? null : findItem('texts', el.dataset.id);
  if (!isTitle && (!it || locked('texts'))) return;
  e.preventDefault();
  video().pause();
  const old = isTitle ? E.spec.title : it.text;
  E.inlineEdit = true;
  el.contentEditable = 'plaintext-only';
  el.classList.add('editing');
  el.focus();
  document.getSelection()?.selectAllChildren(el);
  const done = (save) => {
    el.removeEventListener('keydown', key); el.removeEventListener('blur', blur);
    E.inlineEdit = false;
    // los textos admiten varias lineas (Intro); el titulo va en una
    const v = (isTitle ? el.textContent.replace(/\s+/g, ' ') : el.innerText.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')).trim();
    if (save && v && v !== old) change(() => { if (isTitle) E.spec.title = v.slice(0, 60); else it.text = v.slice(0, 120); });
    E.ovSig = ''; renderPanel();
  };
  const key = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' && (isTitle || ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); el.blur(); } // Intro sola: nueva linea
    else if (ev.key === 'Escape') { ev.preventDefault(); done(false); el.blur(); }
  };
  const blur = () => done(true);
  el.addEventListener('keydown', key); el.addEventListener('blur', blur);
});

// ---------- seleccion y edicion directa en la vista previa ----------
// Todo lo que se ve encima del video (textos, stickers, titulo, subtitulos, zooms) y cada zona del video (camara, juego)
// se elige tocandolo en la vista previa: aparece su caja con tiradores, una barra de acciones encima y sus propiedades
// en el inspector. Lo mismo se elige desde «Capas» y desde la linea de tiempo; la seleccion es una sola para todos.
export const isCanvasSel = () => {
  const s = E?.sel;
  if (!s || !CANVAS_KINDS.includes(s.kind)) return false;
  if (s.kind === 'title') return !!E.spec.title;
  if (s.kind === 'captions' || s.kind === 'frame') return true;
  return !!findItem(s.kind, s.id);
};
export const lockedItem = (kind, id) => locked(kind) || !!findItem(kind, id)?.lock;
const frameName = (k) => (k === 'game' ? 'Zona del juego' : k === 'crop' ? 'Recorte' : k === 'full' ? 'Vídeo' : k.startsWith('cam:') ? `Cámara ${+k.slice(4) + 1}` : camList().length > 1 ? 'Cámara principal' : 'Zona de la cámara');
/** Nombre de lo seleccionado, para el inspector, la barra de acciones y «Capas». */
export function selName(s = E.sel) {
  if (!s) return '';
  const it = findItem(s.kind, s.id);
  if (s.kind === 'texts') return `Texto «${(it?.text || '').slice(0, 18)}»`;
  if (s.kind === 'stickers') return `Sticker «${(it?.file || '').replace('.png', '')}»`;
  if (s.kind === 'zooms') return `Zoom ×${(it?.scale || 1).toFixed(2)}`;
  if (s.kind === 'frame') return frameName(s.id);
  return KIND_NAME[s.kind];
}
/** La zona del video original que se encuadra (la del exportador). `make`: el juego automatico pasa a ser una zona propia. */
export function frameRegion(key, make = false) {
  const sp = E.spec;
  if (key === 'cam') return sp.cam;
  if (key.startsWith('cam:')) return sp.cams?.[+key.slice(4)];
  if (key === 'game') { if (!sp.game && make) { const f = (E.frames || []).find((x) => x.key === 'game'); if (f) sp.game = { x: f.r.x, y: f.r.y, w: f.r.w, h: f.r.h }; } return sp.game || (E.frames || []).find((x) => x.key === 'game')?.r; }
  return null;
}
/** Agranda o achica una zona sin cambiar su forma ni su centro. */
export function scaleRegion(r, k) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, ar = r.h / r.w;
  let w = clamp(r.w * k, 0.04, 1), h = w * ar;
  if (h > 1) { h = 1; w = h / ar; }
  Object.assign(r, { w, h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) });
}
/** Elegir algo de la vista previa (o de «Capas»): abre sus propiedades en el inspector. */
export function selectCanvas(kind, id) {
  select(kind, id);
  E.selSig = '';
  renderTabs(); renderPanel(); renderTl();
  if (E.lib === 'capas') renderLib();
}
export function deselect() {
  if (!E.sel && !(E.multi || []).length) return;
  E.sel = null; E.multi = []; E.selSig = ''; renderFloat();
  if (CANVAS_KINDS.some((k) => KIND_TOOL[k] === E.tool)) E.tool = 'clip';
  renderTabs(); renderPanel(); renderTl();
  if (E.lib === 'capas') renderLib();
}

/** Donde esta lo seleccionado dentro del visor (px del visor), o null si en este instante no se ve. */
function selGeom() {
  const s = E.sel, ph = $('phone'), ov = $('ov');
  if (!s || !ph || !ov) return null;
  const PW = ph.clientWidth, PH = ph.clientHeight, k = PW / CW, pr = ph.getBoundingClientRect();
  const rel = (el) => { const a = el.getBoundingClientRect(); return { x: a.left - pr.left + a.width / 2, y: a.top - pr.top + a.height / 2, w: a.width, h: a.height }; };
  if (s.kind === 'texts' || s.kind === 'stickers') {
    const el = ov.querySelector(`[data-ov="${s.kind}"][data-id="${s.id}"]`), it = findItem(s.kind, s.id);
    if (!el || !it) return null;
    return { x: it.x * PW, y: it.y * PH, w: el.offsetWidth, h: el.offsetHeight, rot: it.rot || 0, mode: lockedItem(s.kind, s.id) ? 'lock' : 'all' };
  }
  if (s.kind === 'title') { const el = ov.querySelector('.ov-title'); return el ? { ...rel(el), rot: 0, mode: 'v' } : null; }
  if (s.kind === 'captions') {
    const el = $('cap')?.firstElementChild;
    if (el) return { ...rel(el), rot: 0, mode: 'cap' };
    // Sin frase en este instante: se marca donde saldra.
    const c = E.spec.captions;
    return { x: PW / 2, y: ((parseFloat($('cap')?.style.top) || c.posY) / 100) * PH, w: PW * 0.78, h: c.size * (PW / W) * 1.4, rot: 0, mode: 'cap', ghost: true };
  }
  const f = s.kind === 'zooms' ? (E.frames || []).find((x) => x.zoom) : (E.frames || []).find((x) => x.key === s.id);
  if (!f) return null;
  return { x: (f.x + f.w / 2) * k, y: (f.y + f.h / 2) * k, w: f.w * k, h: f.h * k, rot: 0, mode: s.kind === 'zooms' ? 'focus' : f.r ? 'pan' : 'none', round: !!f.round, f };
}
/** Hacia donde acerca un zoom sin punto elegido (como el exportador: un poco arriba en las camaras). */
const zoomFy0 = (f) => (f?.key?.startsWith('cam') && !(E.spec.layout === 'cam' || (E.spec.layout === 'duo' && camList().length < 2)) ? 0.4 : 0.38);

/** La barra de acciones de lo seleccionado: lo mas comun, con nombre, a un toque. */
function selBar() {
  const s = E.sel, it = findItem(s.kind, s.id);
  // El nombre va siempre en aria-label y title: en ventanas estrechas la barra enseña solo los iconos.
  const b = (e, ic, label, extra = '', cls = '') => `<button class="sm ${cls}" data-e="${e}" aria-label="${label}" title="${label}" ${extra}>${icon(ic, 'sm')}<span>${label}</span></button>`;
  const name = `<span class="selname">${esc(selName())}</span>`;
  if (s.kind === 'texts' || s.kind === 'stickers') return name + (s.kind === 'texts' ? b('inlineedit', 'pen', 'Escribir') : '') + b('dupsel', 'copy', 'Duplicar') + b('layerfront', 'front', 'Delante') + b('layerback', 'back', 'Detrás')
    + b('itemlock', it?.lock ? 'lock' : 'unlock', it?.lock ? 'Desbloquear' : 'Bloquear', `aria-pressed="${!!it?.lock}"`) + b('itemhide', 'eyeoff', 'Ocultar') + b('delsel', 'trash', 'Borrar', '', 'danger');
  if (s.kind === 'title') return name + b('inlineedit', 'pen', 'Escribir') + b('titlereset', 'center', 'A su sitio') + b('delsel', 'trash', 'Quitar', '', 'danger');
  if (s.kind === 'captions') return name + b('tool', 'pen', 'Corregir el texto', 'data-k="subs"') + b('capoff', 'eyeoff', 'Ocultar', '', 'danger');
  if (s.kind === 'zooms') return name + b('zoomreset', 'center', 'Al centro') + b('itemhide', 'eyeoff', 'Ocultar') + b('delsel', 'trash', 'Borrar', '', 'danger');
  if (s.id === 'full') return name + b('tool', 'move', 'Cambiar el encuadre', 'data-k="encuadre"');
  const many = s.id.startsWith('cam') && withScene(at(), () => MULTI.includes(E.spec.layout) && camList().length > 1);
  return name + (many ? b('solocam', 'zoom', 'Ver solo a esta persona', '', 'pri') : '') + (s.id === 'crop' ? b('facetrack', 'sparkle', 'Seguir la cara') : b('openpick', 'pen', 'Marcar en el original', 'data-k="cam"'))
    + (s.id.startsWith('cam') ? b('detectcam', 'sparkle', 'Detectar cámaras') : '') + (s.id === 'game' && E.spec.game ? b('gamereset', 'center', 'Automático') : '');
}
/** Coloca la caja de seleccion, sus tiradores y la barra de acciones (en cada fotograma: lo elegido puede moverse). */
export function updateSel() {
  const box = $('selbox'), bar = $('selbar');
  if (!box || !bar) return;
  const g = isCanvasSel() && !E.inlineEdit && !E.review ? selGeom() : null;
  if (!g) { if (!box.hidden) { box.hidden = true; bar.hidden = true; E.selSig = ''; } return; }
  const it = findItem(E.sel.kind, E.sel.id), sig = [E.sel.kind, E.sel.id, g.mode, g.round, !!it?.lock, !!it?.hide, E.spec.game ? 1 : 0, camList().length].join('|');
  if (sig !== E.selSig) {
    E.selSig = sig;
    const H4 = ['nw', 'ne', 'sw', 'se'].map((h) => `<i class="sh ${h}" data-h="${h}"></i>`).join('');
    box.className = `selbox ${g.mode} ${g.round ? 'round' : ''} ${g.ghost ? 'ghost' : ''}`;
    box.innerHTML = g.mode === 'all' ? H4 + '<i class="sh rot" data-h="rot" title="Girar (Mayús: de 15 en 15)"></i>' : g.mode === 'cap' ? H4 : g.mode === 'focus' ? '<i class="sfocus" data-h="focus" title="Arrastra: hacia dónde acerca el zoom"></i>' : g.mode === 'pan' ? `<span class="shint">${icon('move', 'sm')}Arrastra para encuadrar</span>` : '';
    bar.innerHTML = selBar();
  }
  box.hidden = false; bar.hidden = false;
  box.classList.toggle('ghost', !!g.ghost);
  Object.assign(box.style, { left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px', transform: `translate(-50%,-50%)${g.rot ? ` rotate(${g.rot}deg)` : ''}` });
  if (g.mode === 'focus') { const d = box.querySelector('.sfocus'); if (d && it) { d.style.left = (it.fx ?? 0.5) * 100 + '%'; d.style.top = (it.fy ?? zoomFy0(g.f)) * 100 + '%'; } }
  // La barra va encima de lo elegido (o debajo si no cabe), sin salirse de la zona del visor.
  const ph = $('phone'), sb = ph.parentElement, es = sb.closest('.estage') || sb, pr = ph.getBoundingClientRect(), sr = sb.getBoundingClientRect(), er = es.getBoundingClientRect();
  // Con tirador de giro, la barra se aparta lo que ocupa ese tirador para no taparlo.
  const bw = bar.offsetWidth, bh = bar.offsetHeight, half = (g.rot ? Math.hypot(g.w, g.h) / 2 : g.h / 2) + (g.mode === 'all' ? 38 : 0);
  const cy = pr.top - sr.top + g.y, cx = pr.left - sr.left + g.x;
  let top = cy - half - bh - 14;
  if (top < pr.top - sr.top + 4) top = Math.min(cy + half + 14, pr.bottom - sr.top - bh - 4);
  let left = clamp(cx - bw / 2, er.left - sr.left + 4, er.right - sr.left - bw - 4);
  // Las zonas del video ocupan media pantalla o mas: la barra va al lado del visor para no tapar la imagen que se arrastra.
  if (g.mode === 'pan' || g.mode === 'none' || g.mode === 'focus') {
    const side = pr.right - sr.left + 12;
    top = clamp(cy - g.h / 2, pr.top - sr.top, pr.bottom - sr.top - bh);
    if (side + bw <= er.right - sr.left - 4) left = side;
    else { left = clamp(cx - bw / 2, er.left - sr.left + 4, er.right - sr.left - bw - 4); top = clamp(cy - g.h / 2 + 8, pr.top - sr.top + 4, pr.bottom - sr.top - bh - 4); }
  }
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
}
/** Guias de alineacion (fracciones del visor) mientras se arrastra. */
function showGuides(xs = [], ys = []) { const g = $('guides'); if (g) g.innerHTML = xs.map((x) => `<i class="gv" style="left:${x * 100}%"></i>`).join('') + ys.map((y) => `<i class="gh" style="top:${y * 100}%"></i>`).join(''); }
/** El valor de la lista mas cercano a v, si esta a menos de tol. */
function snap1(v, list, tol) { let best = null; for (const t of list) if (Math.abs(t - v) <= tol && (best == null || Math.abs(t - v) < Math.abs(best - v))) best = t; return best; }

/** Pulsacion en el visor: tiradores, elementos, titulo, subtitulos, zooms y zonas del video. Devuelve si la ha usado. */
export function canvasDown(e) {
  const ph = $('phone');
  if (!ph || !ph.contains(e.target) || e.button !== 0) return false;
  const P = ph.getBoundingClientRect(), PW = P.width, PH = P.height, s0 = shot();
  const live = () => { E.ovSig = E.capSig = ''; E.force = true; };
  // El deshacer se guarda al empezar a mover (un simple clic no lo gasta ni borra lo rehecho).
  let moved = false;
  const first = (ev, x0, y0) => { if (moved) return true; if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return false; moved = true; pushUndo(s0); video()?.pause(); return true; };
  const end = () => { showGuides(); if (moved) change(() => {}, false); };
  const x0 = e.clientX, y0 = e.clientY, h = e.target.closest('#selbox [data-h]')?.dataset.h, s = E.sel;
  e.preventDefault();
  if (document.activeElement?.matches?.('input, select, textarea')) document.activeElement.blur(); // las flechas pasan a mover lo elegido
  // 1) Los tiradores de lo ya elegido: tamaño, giro y punto del zoom.
  if (h && s) {
    const g = selGeom(), it = findItem(s.kind, s.id), c = { x: P.left + g.x, y: P.top + g.y }, d0 = Math.max(4, Math.hypot(x0 - c.x, y0 - c.y));
    const o = { size: it?.size, w: it?.w, cap: E.spec.captions.size };
    setDrag({ move: (ev) => {
      if (!first(ev, x0, y0)) return;
      if (h === 'rot') {
        let a = (Math.atan2(ev.clientY - c.y, ev.clientX - c.x) * 180) / Math.PI + 90;
        a = ((a + 540) % 360) - 180;
        a = ev.shiftKey ? Math.round(a / 15) * 15 : snap1(a, [-180, -90, 0, 90, 180], 4) ?? Math.round(a);
        it.rot = a === 180 ? -180 : a || undefined;
      } else if (h === 'focus') {
        const fx = (ev.clientX - P.left - (g.x - g.w / 2)) / g.w, fy = (ev.clientY - P.top - (g.y - g.h / 2)) / g.h;
        it.fx = Math.round(clamp(fx, 0, 1) * 100) / 100; it.fy = Math.round(clamp(fy, 0, 1) * 100) / 100;
      } else {
        const k = Math.hypot(ev.clientX - c.x, ev.clientY - c.y) / d0;
        if (s.kind === 'texts') it.size = Math.round(clamp(o.size * k, 20, 240));
        else if (s.kind === 'stickers') it.w = Math.round(clamp(o.w * k, 0.05, 1) * 1000) / 1000;
        else if (s.kind === 'captions') E.spec.captions.size = Math.round(clamp(o.cap * k, 50, 150));
      }
      live();
    }, up: end });
    return true;
  }
  const el = e.target.closest('#ov [data-ov]'), kind = el?.dataset.ov, id = el?.dataset.id;
  // 2) Textos y stickers: mover, con guias en el centro y en los demas elementos (Alt: sin guias).
  if (kind === 'texts' || kind === 'stickers') {
    const it = findItem(kind, id);
    if (!it) return true;
    if (!isSel(kind, id) || !isCanvasSel()) selectCanvas(kind, id);
    if (lockedItem(kind, id)) { toast('Está bloqueado: desbloquéalo en la barra de encima para moverlo.'); return true; }
    const o = { x: it.x, y: it.y }, sp = applyTracks(E.spec), t = at();
    const others = [...sp.texts, ...sp.stickers].filter((x) => x.id !== it.id && t >= x.a && t <= x.b);
    const tx = [0.5, ...others.map((x) => x.x)], ty = [0.5, ...others.map((x) => x.y)];
    setDrag({ move: (ev) => {
      if (!first(ev, x0, y0)) return;
      let nx = clamp(o.x + (ev.clientX - x0) / PW, 0.02, 0.98), ny = clamp(o.y + (ev.clientY - y0) / PH, 0.02, 0.98);
      const sx = ev.altKey ? null : snap1(nx, tx, 6 / PW), sy = ev.altKey ? null : snap1(ny, ty, 6 / PH);
      it.x = Math.round((sx ?? nx) * 1000) / 1000; it.y = Math.round((sy ?? ny) * 1000) / 1000;
      showGuides(sx != null ? [sx] : [], sy != null ? [sy] : []); live();
    }, up: end });
    return true;
  }
  // 3) El titulo fijo: un clic lo elige (y deja su campo listo para escribir); arrastrarlo lo sube o lo baja.
  if (kind === 'title') {
    if (E.sel?.kind !== 'title') selectCanvas('title', 'title');
    const oy = E.spec.titleY ?? E.geo?.titleY ?? 200;
    setDrag({ move: (ev) => {
      if (!first(ev, x0, y0)) return;
      let y = clamp(oy + ((ev.clientY - y0) / PH) * H, 100, 1760);
      const sy = ev.altKey ? null : snap1(y / H, [0.5], 6 / PH);
      if (sy != null) y = sy * H;
      E.spec.titleY = Math.round(y); showGuides([], sy != null ? [sy] : []); live();
    }, up: () => { end(); if (!moved) setTimeout(() => root().querySelector('#epanel [data-i=title]')?.focus(), 0); } });
    return true;
  }
  // 4) Los subtitulos: arrastrarlos cambia su altura (la preferida, si se apartan de las caras).
  if (kind === 'captions') {
    if (E.sel?.kind !== 'captions') selectCanvas('captions', 'captions');
    const c = E.spec.captions, oy = parseFloat($('cap')?.style.top) || c.posY; // desde donde se ve ahora
    setDrag({ move: (ev) => {
      if (!first(ev, x0, y0)) return;
      capManual();
      let y = clamp(oy + ((ev.clientY - y0) / PH) * 100, 8, 92);
      const sy = ev.altKey ? null : snap1(y / 100, [0.5], 6 / PH);
      c.posY = Math.round(sy != null ? 50 : y); showGuides([], sy != null ? [0.5] : []); live();
    }, up: end });
    return true;
  }
  if (kind === 'zooms') { selectCanvas('zooms', id); return true; }
  // 5) Una zona del video (camara, juego o recorte): arrastrar mueve la imagen dentro de su recuadro.
  const k = CW / PW, cx = (x0 - P.left) * k, cy = (y0 - P.top) * k;
  // En «Completo», el fondo difuminado tambien es el video: elige «Vídeo».
  const f = [...(E.frames || [])].reverse().find((x) => (x.round ? Math.hypot(cx - x.x - x.w / 2, cy - x.y - x.h / 2) <= x.w / 2 : cx >= x.x && cx <= x.x + x.w && cy >= x.y && cy <= x.y + x.h)) || (E.frames || []).find((x) => x.key === 'full');
  if (!f) { deselect(); return true; }
  if (E.sel?.kind !== 'frame' || E.sel.id !== f.key) selectCanvas('frame', f.key);
  if (!f.r) return true;
  const sc = Math.max(f.w / (f.r.w * E.vw), f.h / (f.r.h * E.vh)), sp = E.spec;
  let r = null, o = null;
  setDrag({ move: (ev) => {
    if (!first(ev, x0, y0)) return;
    const dx = ((ev.clientX - x0) * k) / (sc * E.vw), dy = ((ev.clientY - y0) * k) / (sc * E.vh);
    if (f.key === 'crop') {
      if (!o) { o = { x: sp.cropX }; if (sp.reframe) toast('Quitado el seguimiento de la cara: el recorte se queda donde lo pongas. Ctrl+Z lo recupera.'); sp.reframe = null; }
      sp.cropX = Math.round(clamp(o.x - dx / Math.max(0.001, 1 - f.r.w), 0, 1) * 1000) / 1000;
    } else {
      if (!r) { r = frameRegion(f.key, true); o = { x: r.x, y: r.y }; if (f.key.startsWith('cam')) E.camsTouched = true; }
      r.x = Math.round(clamp(o.x - dx, 0, 1 - r.w) * 1000) / 1000; r.y = Math.round(clamp(o.y - dy, 0, 1 - r.h) * 1000) / 1000;
    }
    live();
  }, up: end });
  return true;
}
// La rueda sobre una zona elegida la acerca o la aleja (como pellizcar en CapCut).
document.addEventListener('wheel', (e) => {
  if (!E || root().hidden || E.sel?.kind !== 'frame' || !e.target.closest?.('#phone')) return;
  const r = frameRegion(E.sel.id, false);
  if (!r) return;
  e.preventDefault();
  if (performance.now() - (E.wheelT || 0) > 700) pushUndo();
  E.wheelT = performance.now();
  scaleRegion(frameRegion(E.sel.id, true), e.deltaY < 0 ? 1 / 1.08 : 1.08);
  E.ovSig = ''; E.force = true;
  clearTimeout(E.wheelR); E.wheelR = setTimeout(() => change(() => {}, false), 350);
}, { passive: false });
/** Flechas con algo elegido en la vista previa: lo mueven poco a poco (Mayús: diez veces mas). */
export function nudge(key, big) {
  const s = E.sel, it = findItem(s.kind, s.id), dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0, m = big ? 10 : 1;
  if (lockedItem(s.kind, s.id)) return toast('Está bloqueado: desbloquéalo para moverlo.');
  if (s.id === 'full') return;
  if (performance.now() - (E.nudgeT || 0) > 700) pushUndo();
  E.nudgeT = performance.now();
  if (s.kind === 'texts' || s.kind === 'stickers') { it.x = clamp(it.x + (dx * m * 4) / W, 0.02, 0.98); it.y = clamp(it.y + (dy * m * 4) / H, 0.02, 0.98); }
  else if (s.kind === 'title') E.spec.titleY = clamp(Math.round((E.spec.titleY ?? E.geo?.titleY ?? 200) + dy * m * 4), 100, 1760);
  else if (s.kind === 'captions') { capManual(); E.spec.captions.posY = clamp(E.spec.captions.posY + dy * (big ? 5 : 1), 8, 92); }
  else if (s.kind === 'zooms') { const f = (E.frames || []).find((x) => x.zoom); it.fx = clamp(Math.round(((it.fx ?? 0.5) + dx * 0.02 * m) * 100) / 100, 0, 1); it.fy = clamp(Math.round(((it.fy ?? zoomFy0(f)) + dy * 0.02 * m) * 100) / 100, 0, 1); }
  else if (s.id === 'crop') { E.spec.cropX = clamp(E.spec.cropX + dx * 0.01 * m, 0, 1); E.spec.reframe = null; }
  else { const r = frameRegion(s.id, true); if (r) { r.x = clamp(r.x - dx * 0.004 * m, 0, 1 - r.w); r.y = clamp(r.y - dy * 0.004 * m, 0, 1 - r.h); } }
  E.ovSig = E.capSig = ''; E.force = true;
  clearTimeout(E.nudgeR); E.nudgeR = setTimeout(() => change(() => {}, false), 400);
}
/** Delante o detras: en el orden de su lista, que es el que siguen la vista previa y el exportador. */
export function layerMove(d) {
  const s = E.sel, l = E.spec[s?.kind];
  if (!Array.isArray(l)) return;
  const i = l.findIndex((x) => x.id === s.id);
  if (i < 0) return;
  if (i === (d > 0 ? l.length - 1 : 0)) return toast(d > 0 ? 'Ya está delante de todo lo de su tipo.' : 'Ya está detrás de todo lo de su tipo.');
  change(() => { const [x] = l.splice(i, 1); if (d > 0) l.push(x); else l.unshift(x); });
}

/** Un campo numerico con su deslizador: se puede escribir el valor exacto o arrastrar (no hace falta arrastrar). */
const pf = (id, label, val, min, max, step = 1, unit = '') => `<div class="pf"><div class="pfh"><label for="pf-${id}">${label}</label><span class="pfv"><input type="number" id="pf-${id}" data-i="${id}" min="${min}" max="${max}" step="${step}" value="${val}" />${unit ? `<span class="mut">${unit}</span>` : ''}</span></div><input type="range" data-i="${id}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${label}" /></div>`;
/** El inspector de lo elegido en la vista previa: solo sus propiedades, en el orden en que se suelen cambiar. */
export function elementPanel() {
  const s = E.sel, sp = E.spec, it = findItem(s.kind, s.id), pc = (v) => Math.round(v * 100);
  const lockNote = it?.lock ? `<div class="twarn">${icon('lock', 'sm')} Bloqueado: no se mueve ni se borra sin querer. Desbloquéalo abajo.</div>` : '';
  const time = it && 'a' in it ? `<h3>Cuándo sale</h3><div class="row tspan"><span class="mut fix">De</span><b class="mono fix">${fmt(it.a)}</b><span class="mut fix">a</span><b class="mono fix">${fmt(it.b)}</b><span class="mut fix">(${(it.b - it.a).toFixed(1).replace('.', ',')} s)</span></div>
    <div class="row wrap" style="gap:6px;margin-top:6px"><button class="sm fix" data-e="tfrom">Empezar en el cursor</button><button class="sm fix" data-e="tto">Acabar en el cursor</button></div><div class="mut" style="margin-top:4px">También puedes arrastrar sus bordes en la línea de tiempo.</div>` : '';
  const layer = (note = '') => `<h3>Capa</h3><div class="row wrap" style="gap:6px"><button class="sm fix" data-e="layerfront">${icon('front', 'sm')}Delante</button><button class="sm fix" data-e="layerback">${icon('back', 'sm')}Detrás</button><button class="sm fix ${it.lock ? 'on' : ''}" data-e="itemlock" aria-pressed="${!!it.lock}">${icon(it.lock ? 'lock' : 'unlock', 'sm')}${it.lock ? 'Bloqueado' : 'Bloquear'}</button><button class="sm fix" data-e="itemhide">${icon('eyeoff', 'sm')}Ocultar</button><button class="sm fix" data-e="dupsel">${icon('copy', 'sm')}Duplicar</button><button class="sm fix danger" data-e="delsel">${icon('trash', 'sm')}Borrar</button></div>${note ? `<div class="mut" style="margin-top:4px">${note}</div>` : ''}`;
  const shape = (k) => `<div class="pgrid">${pf(k + '.x', 'Horizontal', pc(it.x), 0, 100, 1, '%')}${pf(k + '.y', 'Vertical', pc(it.y), 0, 100, 1, '%')}${pf(k + '.rot', 'Giro', it.rot || 0, -180, 180, 1, '°')}${pf(k + '.op', 'Opacidad', pc(it.op ?? 1), 5, 100, 1, '%')}</div>
    <div class="row wrap" style="gap:6px;margin-top:8px"><button class="sm fix" data-e="center">${icon('center', 'sm')}Centrar</button><button class="sm fix" data-e="straight" ${it.rot ? '' : 'disabled'}>${icon('rotate', 'sm')}Enderezar</button></div>
    <div class="mut" style="margin-top:4px">Arrástralo en la vista previa; las esquinas cambian el tamaño y el círculo de arriba lo gira. Las flechas del teclado lo mueven poco a poco.</div>`;
  if (s.kind === 'texts') return `<h2>Texto</h2>${lockNote}
    <h3>Contenido</h3><textarea rows="2" data-i="text.text" aria-label="Lo que dice el texto" maxlength="120">${esc(it.text)}</textarea>
    <div class="mut" style="margin-top:4px">O haz doble clic en el texto del vídeo y escribe encima.</div>
    <h3>Estilo</h3><label class="f">Letra<select data-i="text.font">${FONTS.map((f) => `<option value="${f}" ${(it.font || FONTS[0]) === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
    <div class="swrow" role="group" aria-label="Color del texto">${SWATCHES.map(([c, n]) => { const on = (it.color || '').toUpperCase() === c; return `<button class="sw ${on ? 'on' : ''}" data-e="textcolor" data-k="${c}" aria-label="${n}" aria-pressed="${on}" title="${n}" style="--sw:${c}"></button>`; }).join('')}<label class="swc" title="Otro color"><input type="color" data-i="text.color" value="${it.color || '#FFFFFF'}" aria-label="Otro color" /></label></div>
    <label class="c"><input type="checkbox" data-i="text.box" ${it.box ? 'checked' : ''} /> Caja blanca detrás</label>
    <h3>Tamaño y posición</h3>${pf('text.size', 'Tamaño', it.size, 20, 240)}${shape('text')}${time}${layer()}`;
  if (s.kind === 'stickers') return `<h2>Sticker</h2>${lockNote}
    <div class="stkprev"><img alt="" width="56" height="56" src="/assets/stickers/${it.file}" /><b>${esc(it.file.replace('.png', ''))}</b></div>
    <h3>Tamaño y posición</h3>${pf('sticker.w', 'Tamaño', pc(it.w), 5, 100, 1, '%')}${shape('sticker')}${time}${layer('Los textos van siempre por encima de los stickers.')}`;
  if (s.kind === 'zooms') {
    const f = (E.frames || []).find((x) => x.zoom);
    return `<h2>Zoom</h2>${pf('zoom.scale', 'Cuánto acerca', pc(it.scale), 105, 250, 1, '%')}
      <h3>Hacia dónde acerca</h3><div class="pgrid">${pf('zoom.fx', 'Horizontal', pc(it.fx ?? 0.5), 0, 100, 1, '%')}${pf('zoom.fy', 'Vertical', pc(it.fy ?? zoomFy0(f)), 0, 100, 1, '%')}</div>
      <div class="mut" style="margin-top:4px">Arrastra el punto azul en la vista previa (con el cursor dentro del zoom).</div>
      <div class="row wrap" style="gap:6px;margin-top:8px"><button class="sm fix" data-e="zoomreset">${icon('center', 'sm')}Al centro</button></div>
      ${time}<h3>Más</h3><div class="row wrap" style="gap:6px"><button class="sm fix" data-e="itemhide">${icon('eyeoff', 'sm')}Ocultar</button><button class="sm fix" data-e="dupsel">${icon('copy', 'sm')}Duplicar</button><button class="sm fix danger" data-e="delsel">${icon('trash', 'sm')}Borrar</button></div>`;
  }
  if (s.kind === 'captions') {
    const c = sp.captions;
    return `<h2>Subtítulos</h2><div class="mut">Arrastra la frase en la vista previa para subirla o bajarla; las esquinas cambian el tamaño.</div>
      <h3>Estilo</h3><div class="chips">${Object.entries(S.styles || {}).map(([k, x]) => `<button class="sm ${c.style === k ? 'on' : ''}" data-e="capstyle" data-k="${k}" aria-pressed="${c.style === k}">${esc(x.name)}</button>`).join('')}</div>
      <h3>Tamaño y posición</h3>${pf('cap.size', 'Tamaño', c.size, 50, 150)}${pf('cap.posY', c.smart !== false ? 'Altura preferida' : 'Altura', c.posY, 8, 92, 1, '%')}
      <label class="c" style="margin-top:6px"><input type="checkbox" data-i="cap.smart" ${c.smart !== false ? 'checked' : ''} /> Apartar de las caras</label>
      <label class="f">Zona segura<select data-i="cap.safe" aria-label="Zona segura de los subtítulos">${[['todas', 'Todas las apps'], ['tiktok', 'TikTok'], ['shorts', 'YouTube Shorts'], ['reels', 'Instagram Reels'], ['ninguna', 'Sin zona segura']].map(([k, n]) => `<option value="${k}" ${(c.safe || 'todas') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="row"><label class="f">Palabras por bloque<select data-i="cap.perChunk">${[1, 2, 3, 4, 5].map((n) => `<option ${c.perChunk === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">Animación<select data-i="cap.anim"><option value="resaltar">Resaltar palabra</option><option value="pop">Resaltar con rebote</option><option value="ninguna">Sin animación</option></select></label></div>
      <div class="row wrap" style="gap:6px;margin-top:12px"><button class="sm fix" data-e="tool" data-k="subs">${icon('pen', 'sm')}Corregir el texto</button><button class="sm fix danger" data-e="capoff">${icon('eyeoff', 'sm')}Ocultar los subtítulos</button></div>`;
  }
  if (s.kind === 'title') return `<h2>Título</h2><input type="text" data-i="title" value="${esc(sp.title)}" maxlength="60" aria-label="Título en pantalla" />
    <div class="mut" style="margin-top:4px">O haz doble clic en el título del vídeo y escribe encima.</div>
    <label class="f">Estilo<select data-i="titleStyle"><option value="caja" ${sp.titleStyle !== 'meme' ? 'selected' : ''}>Caja blanca</option><option value="meme" ${sp.titleStyle === 'meme' ? 'selected' : ''}>Meme (letras blancas grandes)</option><option value="gancho" ${sp.titleStyle === 'gancho' ? 'selected' : ''}>Gancho (amarillo en el centro)</option></select></label>
    <div class="f">Cuánto se ve el título<div class="chips" style="margin-top:4px">${[[0, 'Todo el clip'], [5, 'Primeros 5 s']].map(([k, n]) => `<button class="sm ${(sp.titleFor || 0) === k ? 'on' : ''}" data-e="titlefor" data-k="${k}" aria-pressed="${(sp.titleFor || 0) === k}">${n}</button>`).join('')}</div></div>
    <h3>Posición</h3>${pf('title.y', 'Altura', Math.round(((sp.titleY ?? E.geo?.titleY ?? 200) / H) * 100), 5, 92, 1, '%')}
    <div class="mut" style="margin-top:4px">Arrástralo arriba o abajo en la vista previa.</div>
    <div class="row wrap" style="gap:6px;margin-top:8px"><button class="sm fix" data-e="titlereset" ${sp.titleY == null ? 'disabled' : ''}>${icon('center', 'sm')}A su sitio</button><button class="sm fix danger" data-e="delsel">${icon('trash', 'sm')}Quitar el título</button></div>`;
  // Zonas del video
  if (s.id === 'full') return `<h2>Vídeo</h2><div class="mut">El encuadre «${esc(LAY_NAME[sp.layout] || '')}» usa la imagen entera. Para recortar la cámara o el juego, elige otro encuadre en la barra de encima de la vista previa.</div>`;
  if (s.id === 'crop') return `<h2>Recorte</h2><div class="mut">Arrastra la imagen de lado a lado para elegir qué parte se ve.</div>${pf('cropX', 'Posición horizontal', Math.round(sp.cropX * 100), 0, 100, 1, '%')}
    <div class="row wrap" style="gap:6px;margin-top:10px"><button class="sm fix" data-e="facetrack">${icon('sparkle', 'sm')}Seguir la cara</button>${sp.reframe ? '<button class="sm fix ghost" data-e="untrack">Quitar seguimiento</button>' : ''}</div><div class="mut" style="margin-top:6px">${sp.reframe ? `El recorte sigue la cara en ${sp.reframe.length} puntos del clip.` : 'O deja que busque la cara a lo largo del clip.'}</div>`;
  const r = frameRegion(s.id);
  if (!r) return '<h2>Zona del vídeo</h2>';
  return `<h2>${esc(frameName(s.id))}</h2><div class="mut">Arrastra la imagen dentro de su recuadro para encuadrarla. La rueda del ratón la acerca o la aleja.</div>
    <h3>Encuadre</h3>${pf('frame.size', 'Cuánto se ve del original', pc(r.w), 4, 100, 1, '%')}<div class="pgrid">${pf('frame.x', 'Horizontal', pc(r.x + r.w / 2), 0, 100, 1, '%')}${pf('frame.y', 'Vertical', pc(r.y + r.h / 2), 0, 100, 1, '%')}</div>
    <div class="row wrap" style="gap:6px;margin-top:10px"><button class="sm fix" data-e="openpick" data-k="cam">${icon('pen', 'sm')}Marcar en el original</button>${s.id === 'game' && sp.game ? `<button class="sm fix" data-e="gamereset">${icon('center', 'sm')}Automático</button>` : ''}</div>
    ${s.id.startsWith('cam') ? camsPanel() : ''}`;
}
/** «Capas»: lo que va encima del video, de delante a atras (el orden del exportador), con ojo y candado. */
export function layerRows() {
  const sp = E.spec, rows = [], cur = (k, id) => E.sel?.kind === k && E.sel.id === id;
  const row = (kind, id, name, color, time, it, canLock = true) => rows.push(`<div class="lyr ${cur(kind, id) ? 'on' : ''} ${it?.hide ? 'hid' : ''}" role="listitem">
    <button class="lyrn" data-e="layerpick" data-kind="${kind}" data-id="${id}" aria-current="${cur(kind, id)}"><i class="lyd" style="background:${color}" aria-hidden="true"></i><span class="grow">${esc(name)}</span>${time ? `<span class="mono mut">${time}</span>` : ''}</button>
    ${it ? `<button class="tbtn ${it.hide ? 'on' : ''}" data-e="itemhide" data-kind="${kind}" data-id="${id}" aria-pressed="${!!it.hide}" aria-label="${it.hide ? 'Mostrar' : 'Ocultar'} ${esc(name)}" title="${it.hide ? 'Mostrar' : 'Ocultar'}">${icon(it.hide ? 'eyeoff' : 'eye')}</button>` : ''}
    ${it && canLock ? `<button class="tbtn ${it.lock ? 'on' : ''}" data-e="itemlock" data-kind="${kind}" data-id="${id}" aria-pressed="${!!it.lock}" aria-label="${it.lock ? 'Desbloquear' : 'Bloquear'} ${esc(name)}" title="${it.lock ? 'Desbloquear' : 'Bloquear'}">${icon(it.lock ? 'lock' : 'unlock')}</button>` : ''}</div>`);
  [...sp.texts].reverse().forEach((x) => row('texts', x.id, `Texto «${x.text.slice(0, 16)}»`, '#FF8A50', `${fmt(x.a)}–${fmt(x.b)}`, x));
  if (sp.title) row('title', 'title', `Título «${sp.title.slice(0, 16)}»`, '#F5F5F7', 'siempre');
  if (sp.captions.on) row('captions', 'captions', 'Subtítulos', '#FFB020', 'al hablar');
  [...sp.stickers].reverse().forEach((x) => row('stickers', x.id, `Sticker «${x.file.replace('.png', '')}»`, '#34D399', `${fmt(x.a)}–${fmt(x.b)}`, x));
  sp.zooms.forEach((x) => row('zooms', x.id, `Zoom ×${x.scale.toFixed(2)}`, '#60A5FA', `${fmt(x.a)}–${fmt(x.b)}`, x, false));
  for (const f of E.frames || []) if (f.key !== 'full') row('frame', f.key, frameName(f.key), f.key === 'game' ? '#60A5FA' : '#FFB020', 'vídeo');
  return rows;
}
