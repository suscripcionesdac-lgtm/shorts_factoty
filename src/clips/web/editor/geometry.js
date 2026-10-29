/** Geometria del lienzo, igual que el exportador. */
import { applyTracks } from '/web/tracks.js';
import { api, fmt, toast } from '/web/app.js';
import { toOut as segToOut, toSrc as segToSrc, totalOut } from '/web/segtime.js';
import { change } from './history.js';
import { LAY_NAME } from './review.js';
import { clamp, E, H, uid, W } from './state.js';
import { isSel, laneBox, pct, pref, pw } from './timeline.js';

// ---------- geometria (igual que el exportador) ----------
const even = (n) => Math.round(n / 2) * 2;
export function geometry(sp, sw, sh) {
  if (sp.layout === 'split') { const camH = even(Math.max(H * 0.25, Math.min(H * 0.5, (W * sp.cam.h * sh) / (sp.cam.w * sw)))); return { camH, titleY: camH }; } // titulo en la union
  if (sp.layout === 'half') return { camH: H / 2, titleY: H / 2 };
  if (sp.layout === 'duo') return { camH: H / 2, titleY: 190 };
  if (sp.layout === 'fit') { const vh = even((W * sh) / sw), top = Math.round((H - vh) / 2) - 90; return { camH: 0, top, vh, titleY: Math.max(190, top - 150) }; }
  return { camH: 0, titleY: 220 };
}
export const strip = (sw, sh, bw, bh, cx) => { const w = Math.min(1, bw / bh / (sw / sh)); return { x: (1 - w) * clamp(cx, 0, 1), y: 0, w, h: 1 }; };
export function zoomAt(t) { let z = 1; for (const k of applyTracks(E.spec).zooms) if (t >= k.a && t <= k.b) z += (k.scale - 1) * Math.min(1, (t - k.a) / 0.25) * Math.min(1, (k.b - t) / 0.25); return z; }
export function reframeAt(t) {
  const k = E.spec.reframe;
  if (!k || k.length < 2) return k?.[0]?.x ?? E.spec.cropX;
  if (t <= k[0].t) return k[0].x;
  for (let i = 0; i < k.length - 1; i++) if (t >= k[i].t && t <= k[i + 1].t) return k[i].x + ((k[i + 1].x - k[i].x) * (t - k[i].t)) / Math.max(0.05, k[i + 1].t - k[i].t);
  return k[k.length - 1].x;
}
export const overlap = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? (w * h) / (a.w * a.h + b.w * b.h - w * h) : 0; };
/** Camaras de los participantes; la principal es la zona `cam` tal como la dejo el usuario (igual que el exportador). */
export function camList() {
  const sp = E.spec;
  if (!sp.cams?.length) return [];
  let k = -1, best = 0.2;
  sp.cams.forEach((c, i) => { const o = overlap(c, sp.cam); if (o > best) { best = o; k = i; } });
  return k < 0 ? [] : sp.cams.map((c, i) => (i === k ? sp.cam : c));
}
export const mainCam = () => camList().indexOf(E.spec.cam);
/** Indice (en camList) de la camara que se ve en t. */
export function camIdxAt(t) {
  const k = E.spec.follow ? E.spec.camTrack : null;
  if (!k?.length) return mainCam();
  let c = k[0].cam;
  for (const x of k) if (x.t <= t) c = x.cam;
  return c;
}
/** Cambio de camara a mano: desde t se ve la camara c (une tramos iguales seguidos). */
export function setCamAt(t, c) {
  const k = (E.spec.camTrack?.length ? E.spec.camTrack : [{ t: 0, cam: Math.max(0, mainCam()) }]).filter((x) => Math.abs(x.t - t) > 0.3 || x.t === 0);
  if (t < 0.3) k[0] = { t: 0, cam: c }; else k.push({ t: Math.round(t * 100) / 100, cam: c });
  k.sort((p, q) => p.t - q.t);
  E.spec.camTrack = k.filter((x, i) => i === 0 || x.cam !== k[i - 1].cam);
}
/** La camara que se ve en el instante t: la de quien habla si se sigue, y si no la principal. */
export const camAt = (t) => camList()[camIdxAt(t)] || E.spec.cam;
export const CAMLAYS = ['split', 'half', 'pip', 'cam', 'duo', 'float', 'grid'];
/** Escena (otro encuadre y otras camaras) que cubre el instante t del clip, si la hay. */
export const sceneAt = (t) => (E.spec.tracks?.scene?.hide ? [] : E.spec.scenes || []).find((x) => t >= x.a && t < x.b);
/** Ejecuta fn como si el clip tuviera el encuadre de la escena de t (igual que el exportador). */
export function withScene(t, fn) {
  const sc = sceneAt(t);
  if (!sc) return fn();
  const keep = E.spec;
  E.spec = { ...keep, layout: sc.layout, cam: sc.cam || keep.cam, cams: sc.cams, follow: false, camTrack: null };
  try { return fn(); } finally { E.spec = keep; }
}
/** De a a b, el encuadre `layout` (null: el del clip). Conserva las camaras que ya tuviera esa escena. */
export function setScene(a, b, layout) {
  const old = sceneAt((a + b) / 2);
  const list = (E.spec.scenes || []).flatMap((x) => (x.b <= a || x.a >= b ? [x] : [...(x.a < a ? [{ ...x, b: a }] : []), ...(x.b > b ? [{ ...x, a: b, id: uid() }] : [])]));
  if (layout) list.push({ id: uid(), a, b, layout, cam: old?.cam || E.spec.cam, cams: old?.cams || E.spec.cams });
  E.spec.scenes = list.filter((x) => x.b - x.a >= 0.3).sort((x, y) => x.a - y.a);
}
/** El tramo elegido en la linea de tiempo (solo si el clip tiene varios). */
export const selSeg = () => (E.sel?.kind === 'seg' && segs().length > 1 ? segs()[E.sel.id] : null);
/** La parte de la pista «Encuadre» elegida. */
export const selScene = () => (E.sel?.kind === 'scenes' ? (E.spec.scenes || []).find((x) => x.id === E.sel.id) : null);
/** Encuadres de una sola camara: en ellos se elige cual se ve. */
export const ONE_CAM = ['cam', 'split', 'half', 'pip'];
export const sceneCams = (x) => (x.cams?.length ? x.cams : E.spec.cams || []);
export const sceneCamIdx = (x) => sceneCams(x).findIndex((c) => x.cam && overlap(c, x.cam) > 0.5);
/** Miniatura de la cara: el fotograma de ese momento recortado a la camara r (solo CSS, sin pedir otra imagen). */
export const faceThumb = (t, r, cls = 'fthumb') => (r ? `<span class="${cls}" aria-hidden="true" style="background-image:url(/api/frame?sid=${E.src.id}&t=${Math.round(E.start + t)}&sm=1);background-size:${(100 / r.w).toFixed(1)}% ${(100 / r.h).toFixed(1)}%;background-position:${r.w < 1 ? ((r.x / (1 - r.w)) * 100).toFixed(1) : 0}% ${r.h < 1 ? ((r.y / (1 - r.h)) * 100).toFixed(1) : 0}%"></span>` : '');
export const MULTI = ['duo', 'float', 'grid'];
/** Que se ve con un encuadre: «Todas (9)», «Persona 3» con su cara, o el nombre del encuadre. */
function seenLabel(layout, cam, cams, t) {
  if (MULTI.includes(layout) && cams.length > 1) return `<span class="fmini" aria-hidden="true">${'<i></i>'.repeat(Math.min(9, cams.length))}</span><span>Todas (${cams.length})</span>`;
  const k = cams.findIndex((c) => cam && overlap(c, cam) > 0.5);
  if (ONE_CAM.includes(layout) && cam) return `${faceThumb(t, cam)}<span>${k >= 0 && cams.length > 1 ? `Persona ${k + 1}` : 'Solo'}${layout === 'cam' ? '' : ' · ' + LAY_NAME[layout]}</span>`;
  return `<span>${LAY_NAME[layout]}</span>`;
}
const sceneLabel = (x) => seenLabel(x.layout, x.cam, sceneCams(x), x.a + 0.5);
/**
 * Al abrir un clip de varias camaras sin partes aparte: se busca donde cambia la escena del directo (en segundo plano)
 * y cada parte recibe su encuadre, para que no queden camaras recortando sitios vacios.
 */
export async function findScenes() {
  const sp = E.spec, me = E;
  if (E.scAsked || sp.scenes?.length || (sp.cams || []).length < 2) return;
  E.scAsked = true;
  const key = () => JSON.stringify([E.spec.cams, E.spec.cam, E.spec.scenes || []]), k0 = key();
  const r = await api('/api/scenes', { sid: E.src.id, start: E.start, end: E.end, cams: camList(), layout: sp.layout }).catch(() => null);
  // Si mientras tanto se tocaron las camaras o las partes aparte, no se pisa: lo de ahora manda.
  if (me !== E || !r?.scenes?.length || key() !== k0 || E.review) return;
  change(() => (E.spec.scenes = r.scenes));
  toast(`El directo cambia de escena ${r.scenes.length > 1 ? r.scenes.length + ' veces' : 'una vez'} en este clip: cada parte tiene ya su encuadre (pista «Cámara»). Ctrl+Z para quitarlo.`, 'good');
}
/**
 * Mover los subtitulos a mano (arrastrar, flechas, altura): manda esa altura. Con «Apartar de las caras» Clipper los
 * recolocaba solo y parecia que no se movian (en la cuadricula casi todo son caras).
 */
export function capManual() {
  const c = E.spec.captions;
  if (c.smart === false) return;
  c.smart = false;
  document.querySelectorAll('[data-i="cap.smart"]').forEach((x) => (x.checked = false)); // el panel no se redibuja mientras se arrastra
  toast('Subtítulos a la altura que elijas: «Apartar de las caras» queda desactivado (actívalo y se colocarán solos).');
}
/** Pista «Cámara»: todo el clip en bloques seguidos con lo que se ve en cada momento (el del clip y cada parte aparte). */
export function camLane() {
  const sp = E.spec, out = [], cams = sp.cams || [], main = (a, b) => out.push(`<div class="cmain" data-e="scenemain" style="left:${pct(a)}%;width:${pw(a, b)}%" title="Lo de siempre en este clip. Para cambiar un momento: elige una cara en la vista previa o pulsa «Cambiar desde aquí».">${seenLabel(sp.layout, sp.cam, cams, a + 0.5)}</div>`);
  let t = 0;
  for (const x of [...(sp.scenes || [])].sort((p, q) => p.a - q.a)) {
    if (x.a - t >= 0.05) main(t, x.a);
    const sel = isSel('scenes', x.id) ? 'sel' : '';
    out.push(`<div class="blk sc ${sel}" data-kind="scenes" data-id="${x.id}" style="left:${pct(x.a)}%;width:${pw(x.a, x.b)}%" title="${fmt(x.a)}–${fmt(x.b)}. Clic: elegir qué se ve. Arrastra los bordes para alargarlo.">${sceneLabel(x)}</div>`);
    // Donde el directo cambia de escena (lo encontro Clipper): una linea discontinua.
    if (String(x.id).startsWith('sc')) out.push(`<span class="scut" style="left:${pct(x.a)}%" title="Aquí cambia la escena del directo"></span>`);
    t = Math.max(t, x.b);
  }
  if (E.dur - t >= 0.05) main(t, E.dur);
  return out.join('');
}
export const segs = () => (E.spec.segments && E.spec.segments.length ? E.spec.segments : [{ a: 0, b: E.dur }]);
export const kept = () => segs().reduce((t, s) => t + (s.b - s.a), 0);
export const keptBefore = (t) => segs().reduce((n, s) => n + clamp(t - s.a, 0, s.b - s.a), 0);
// Linea de tiempo magnetica, como la pista principal de CapCut: enseña el tiempo final, sin los huecos de lo quitado, y lo
// de encima (textos, stickers, zooms, sonidos, subtitulos) va pegado al video. «Ver lo quitado» vuelve al tiempo original.
export const magnet = () => !pref('tlGaps', false);
export const tlLen = () => (magnet() ? Math.max(0.1, totalOut(segs())) : E.dur);
export const toView = (t) => (magnet() ? segToOut(segs(), t) : t);
export const toSrc = (v) => (magnet() ? segToSrc(segs(), v) : v);
/** Instante del clip bajo la coordenada x de la pantalla. */
export const tAtX = (x) => { const r = laneBox(); return toSrc(clamp((x - r.left) / r.width, 0, 1) * tlLen()); };
/** Duracion del video final: cortes, gancho, velocidad y tarjeta de cierre. */
// Cada union con transicion se solapa: resta su duracion (aproximado, el exportador la acorta en tramos muy cortos).
export const joinOn = (a) => { const sp = E.spec; return !!sp.transition && (sp.transCuts || (sp.transAt || []).some((t) => Math.abs(t - a) < 0.05)); };
const transCut = () => { const sp = E.spec, d = sp.transition ? sp.transDur || 0.4 : 0, hook = sp.hook && E.dur >= 12; return d * ((hook ? 1 : 0) + segs().slice(1).filter((x) => joinOn(x.a)).length); };
export const finalDur = () => (totalOut(segs()) + (E.spec.hook && E.dur >= 12 ? 2.8 : 0) - transCut() + (E.spec.replay ? (E.spec.replay.b - E.spec.replay.a) / (E.spec.replay.speed || 0.5) : 0)) / ((E.spec.speed || 1) * (E.spec.vary ? 1.015 : 1)) + (E.spec.outro?.on && E.spec.outro.text.trim() ? E.spec.outro.seconds : 0);
