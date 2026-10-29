/** Acciones de los botones (data-e) y eventos globales del editor. */
import { $, api, ask, fmt, go, ranges, refresh, S, toast, vt } from '/web/app.js';
import { tourHere } from '/web/help.js';
import { cutRange, restoreRange } from '/web/cuts.js';
import { isCen } from './censor.js';
import { canvasDown, deselect, frameRegion, isCanvasSel, layerMove, lockedItem, scaleRegion, selectCanvas } from './direct.js';
import { camAt, camIdxAt, CAMLAYS, camList, capManual, findScenes, overlap, sceneAt, sceneCams, segs, selScene, selSeg, setCamAt, setScene, tAtX, tlLen, toSrc, toView } from './geometry.js';
import { change, pushUndo, rvFeedback, shot, undo } from './history.js';
import { LIB, renderLib, replay } from './library.js';
import { loadMedia } from './open.js';
import { openTool, renderTabs, setMode, syncLib } from './panels.js';
import { liveWords, pkey, seek, snap, togglePlay, video } from './playback.js';
import { applyParts, keepMine, rebuildReview, renderFloat, renderPanel, renderSum, reviewParts } from './review.js';
import { segAt, segEdit } from './segments.js';
import { clamp, drag, E, H, isKeyword, KIND_TOOL, PRESETS, setDrag, setTplTimer, STYLE_PRESETS, TOOLS, tplTimer, uid } from './state.js';
import { foundRanges, refreshFound, wordRange } from './textedit.js';
import { ATTRS, closeCtx, ctxFor, endSkim, hookRange, isSel, locked, marquee, MK_COLORS, openCtx, pref, renderTl, selected, setPref, setTlZoom, skimAt, snapList, snapTo, toggleSel } from './timeline.js';
import { transInfo } from './transitions.js';
import { closeZones, openPicker, zdown, zframe, zpaint } from './zones.js';

// ---------- acciones ----------
export const at = () => clamp(E.t || 0, 0, E.dur);
const span = (len) => { const a = clamp(at(), 0, Math.max(0, E.dur - 0.5)); return { a, b: Math.min(E.dur, a + len) }; };
// Solo las listas (textos, stickers, zooms…): el titulo es un texto y los subtitulos un objeto, no se buscan aqui.
export const findItem = (kind, id) => { const l = E.spec[kind]; return Array.isArray(l) ? l.find((x) => x.id === id) : undefined; };
/** Selecciona un elemento y abre la herramienta que lo edita. */
export function select(kind, id) {
  E.sel = { kind, id }; E.multi = []; renderFloat();
  const t = kind === 'seg' ? null : KIND_TOOL[kind];
  if (t && t !== E.tool) { E.tool = t; renderTabs(); $('epanel').scrollTop = 0; }
}

async function setRange(k, d) {
  const ns = k === 'start' ? Math.max(0, E.start + d) : E.start, ne = k === 'end' ? E.end + d : E.end;
  if (ne - ns < 3) return toast('El clip debe durar al menos 3 segundos.');
  if (ne > (E.src.duration || E.src.analyzedTo || ne)) return toast('No hay más video grabado después de ese punto.');
  change(() => {
    const shift = ns - E.start;
    E.spec.blurs = E.spec.blurs.map((z) => (z.all ? { ...z, a: 0, b: ne - ns } : { ...z, a: z.a - shift, b: z.b - shift })).filter((z) => z.b > 0 && z.a < ne - ns);
    for (const key of ['texts', 'stickers', 'zooms', 'punches', 'scenes']) E.spec[key] = (E.spec[key] || []).map((x) => ({ ...x, a: x.a - shift, b: x.b - shift })).filter((x) => x.b > 0 && x.a < ne - ns);
    E.spec.sfx = E.spec.sfx.map((x) => ({ ...x, t: x.t - shift })).filter((x) => x.t >= 0 && x.t < ne - ns);
    E.spec.segments = null; E.spec.reframe = null; E.spec.camTrack = null; E.spec.captions.words = undefined;
    Object.assign(E, { start: ns, end: ne, dur: ne - ns });
  });
  loadMedia();
}

/** Aviso que se queda en pantalla mientras dura una tarea larga, con su avance. */
function working(text) {
  const el = document.createElement('div');
  el.className = 'toast work';
  el.innerHTML = '<i class="spin" aria-hidden="true"></i><span></span>';
  el.lastChild.textContent = text;
  $('toasts').appendChild(el);
  return { set: (t) => (el.lastChild.textContent = t), done: () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); } };
}
let detecting = false;
/**
 * Camaras de los participantes y quien habla en cada momento. Lo calcula el servidor (con el video original a
 * resolucion completa), que ademas descarta las fotos fijas del marcador de un juego y ajusta la zona al marco.
 */
export async function detectCams(quiet = false) {
  if (detecting) return quiet || toast('Ya estoy mirando las caras; tarda unos segundos.');
  detecting = true; E.facesState = 'buscando';
  if (!quiet) E.camsTouched = false; // pedirlo a mano es querer lo detectado
  const range = E.start + '-' + E.end, stale = () => range !== E.start + '-' + E.end, w8 = quiet ? null : working('Buscando las cámaras…');
  const body = { sid: E.src.id, start: E.start, end: E.end };
  // Las camaras detectadas mandan; las añadidas a mano (y solo esas) se conservan si no coinciden con ninguna.
  // Si mientras tanto se tocaron las camaras a mano, lo detectado en segundo plano no lo pisa.
  const apply = (cams, track) => { if (E.camsTouched) return; change(() => {
    const mine = (E.spec.cams || []).filter((m) => m.manual && !cams.some((d) => overlap(d, m) > 0.3));
    E.spec.cams = [...cams, ...mine].slice(0, 12);
    // Si la zona marcada a mano coincide con una camara detectada, se conserva tal cual; si no, la mayor.
    if (!camList().length) E.spec.cam = E.spec.cams[0];
    if (track) E.spec.camTrack = E.spec.follow && track.length ? track : null;
  }); setTimeout(findScenes, 0); }; // con las camaras ya conocidas, se mira si el directo cambia de escena
  renderPanel();
  try {
    // 1) Donde estan las camaras: normalmente ya estan guardadas y llegan al instante.
    // Al pulsar «Detectar cámaras» se buscan de nuevo; al abrir el clip valen las ya guardadas.
    const c = await api('/api/faces', { ...body, camsOnly: true, fresh: !quiet });
    if (stale()) return;
    if (!c.cams.length) { E.facesState = 'nada'; return quiet || toast('No encontré ninguna cámara en este clip. Márcala a mano con «Dibujar zonas en grande».', 'bad'); }
    apply(c.cams, null);
    // 2) Quien habla (solo si se sigue): tarda mas, pero la imagen ya muestra las camaras mientras tanto.
    if (E.spec.follow) {
      E.facesState = 'hablando'; w8?.set('Mirando quién habla…'); renderPanel();
      const r = await api('/api/faces', { ...body, words: E.spec.captions.words });
      if (stale()) return;
      E.faces = r;
      if (r.cams.length) apply(r.cams, r.track);
    }
    E.facesState = 'ok';
    if (!quiet) toast(E.spec.cams.length > 1 ? `${E.spec.cams.length} cámaras.${E.spec.follow ? '' : ' Elige «Quien habla» para pasar de una a otra.'}` : 'Cámara detectada. Ajusta la zona si hace falta.', 'good');
  } catch (e) { E.facesState = 'error'; if (!quiet) toast('No se pudieron mirar las caras: ' + e.message, 'bad'); }
  finally { detecting = false; w8?.done(); renderPanel(); }
}
/** «Seguir la cara»: el servidor calcula el recorrido (reframe.ts), igual que la auto edicion. */
async function trackFace() {
  const w8 = working('Siguiendo a la persona…');
  let keys;
  try { keys = (await api('/api/follow', { sid: E.src.id, start: E.start, end: E.end })).keys; } finally { w8.done(); }
  if (!keys?.length) return toast('No encontré la cara suficientes veces para seguirla.', 'bad');
  change(() => (E.spec.reframe = keys));
  toast(`El recorte sigue a la persona en ${keys.length} puntos.`, 'good');
}

export const actions = {
  // Al volver, el visor se encoge hasta la miniatura del momento en la lista.
  back: () => go('live', () => { const im = document.querySelector(`[data-open="${E.src.id}|${E.cand.id}"] img`); if (im) { im.style.viewTransitionName = 'hero'; setTimeout(() => (im.style.viewTransitionName = ''), 700); } }),
  // Auto edicion: el servidor decide encuadre, cortes, efectos, subtitulos y titulo; se aplica como un solo cambio (Ctrl+Z lo deshace).
  autoedit: async (el) => {
    if (el.disabled) return;
    el.disabled = true;
    const w8 = working('Editando el clip solo…');
    // Porcentaje y paso (escuchar, caras, silencios, el agente…): el servidor dice por donde va.
    const poll = setInterval(() => api(`/api/autoedit/progress?sid=${encodeURIComponent(E.src.id)}&start=${Math.round(E.start)}`).then((p) => p && w8.set(`Editando el clip solo… ${p.pct} % · ${p.label}`)).catch(() => {}), 1000);
    try {
      const r = await api('/api/autoedit', { sid: E.src.id, start: E.start, end: E.end, candidateId: E.cand.id });
      const { captions, ...p } = r.patch;
      // Una transicion elegida a mano se respeta.
      if (E.spec.transition) { delete p.transition; delete p.transDur; delete p.transCuts; }
      if (!r.done.length) return toast('No encontré nada que mejorar en este tramo.', 'good');
      if (captions?.words) E.wordsState = 'ok';
      if (p.cams) { E.facesState = 'ok'; E.faces = null; }
      const before = JSON.parse(JSON.stringify(E.spec));
      if (keepMine(before, p, captions)) r.done.push('respeté lo que ya habías cambiado a mano');
      // Las propuestas (equilibrada, dinamica, sobria): cada una con sus casillas; se empieza por la que sueles elegir.
      const variants = (r.variants || []).map((v) => {
        const { captions: vc, ...vp } = v.patch;
        if (E.spec.transition) { delete vp.transition; delete vp.transDur; delete vp.transCuts; }
        keepMine(before, vp, vc);
        return { id: v.id, name: v.name, parts: reviewParts(before, vp, vc || null, r.fillers || []) };
      });
      const vi = Math.max(0, variants.findIndex((v) => v.id === r.prefer));
      const parts = variants[vi]?.parts || reviewParts(before, p, captions || null, r.fillers || []);
      pushUndo();
      E.sel = null;
      if (pref('autoReview', true)) {
        E.review = { before, parts, variants, vi, style: r.style, agent: r.agent, done: r.done, learned: r.done.filter((d) => d.endsWith('sueles quitarlo')) };
        rebuildReview();
        toast(`Auto edición lista: ${parts.length} cambio${parts.length === 1 ? '' : 's'}. Revísalos a la derecha y pulsa «Aplicar».`, 'good');
      } else {
        E.spec = applyParts(before, parts);
        change(() => {}, false);
        toast('Auto edición: ' + r.done.join(', ') + '. Ctrl+Z lo deshace.', 'good');
      }
      seek(segs()[0]?.a || 0);
    } catch (e) { toast('Auto edición: ' + e.message, 'bad'); }
    finally { clearInterval(poll); el.disabled = false; w8?.done(); }
  },
  sugmenu: (el) => { const m = $('sugMenu'), open = m.hidden; m.hidden = !open; el.setAttribute('aria-expanded', String(open)); if (open) m.querySelector('button')?.focus(); },
  rvgo: (el) => { video()?.pause(); seek(+el.dataset.k); },
  rvvar: (el) => { const k = +el.dataset.k, v = E.review.variants?.[k]; if (!v) return; E.review.vi = k; E.review.parts = v.parts; rebuildReview(); },
  rvall: (el) => { const on = el.dataset.k === '1'; E.review.parts.forEach((x) => (x.on = on)); rebuildReview(); },
  rvok: () => { const n = E.review.parts.filter((x) => x.on).length;
    rvFeedback(); E.review = null; change(() => {}, false); toast(n ? `Aplicados ${n} cambios. Ctrl+Z los deshace.` : 'Sin cambios.', 'good'); },
  rvno: () => { E.spec = JSON.parse(JSON.stringify(E.review.before)); E.review = null; E.undo.pop(); change(() => {}, false); toast('Auto edición descartada.'); },
  rvpref: (el) => setPref('autoReview', el.checked),
  rvforget: async () => { await api('/api/autoedit/feedback', { streamer: E.src.streamer || '', forget: true }); E.review.learned = []; renderPanel(); toast('Olvidado: la próxima auto edición vuelve a proponerlo todo.'); },
  undo: () => undo(),
  redo: () => undo(true),
  edtour: () => tourHere(true),
  play: togglePlay,
  seek: (el) => seek(at() + +el.dataset.d),
  settrans: (el) => { const k = el.dataset.k, t = transInfo(k); change(() => { E.spec.transition = k; if (!k) { E.spec.transCuts = false; E.spec.transAt = []; } else { E.spec.transDur = t?.dur || 0.4; if (E.joinPick != null) (E.spec.transAt ||= []).push(E.joinPick); } }); E.joinPick = null; },
  transjoin: (el) => {
    const a = +el.dataset.k;
    if (!E.spec.transition) { E.joinPick = a; openTool('trans'); return toast(`Elige una transición a la izquierda: se pondrá en el corte de ${fmt(a)}.`); }
    change(() => { const l = (E.spec.transAt ||= []), i = l.findIndex((t) => Math.abs(t - a) < 0.05); if (i >= 0) l.splice(i, 1); else l.push(a); });
    openTool('trans');
  },
  magnet: () => { E.magnet = !E.magnet; setPref('magnet', E.magnet); const b = document.querySelector('[data-e=magnet]'); if (b) { b.classList.toggle('on', E.magnet); b.setAttribute('aria-pressed', E.magnet); } toast(E.magnet ? 'Imán activado: los bordes se ajustan solos' : 'Imán desactivado'); },
  tlzoom: (el) => setTlZoom((E.tlZoom || 1) * +el.dataset.k),
  tlfit: () => setTlZoom(1),
  tcat: (el) => { E.tcat = el.dataset.k; renderLib(); },
  tool: (el) => { const ix = (k) => TOOLS.findIndex((t) => t[0] === k), down = ix(el.dataset.k) >= ix(E.tool); if (E.sel && (el.dataset.k === 'clip' || KIND_TOOL[E.sel.kind] !== el.dataset.k || isCanvasSel())) { E.sel = null; E.multi = []; renderTl(); } E.tool = el.dataset.k; syncLib(); renderTabs(); renderPanel(); renderLib(); $('epanel').scrollTop = 0; replay($('epanel'), down ? 'in-up' : 'in-down'); },
  range: (el) => setRange(el.dataset.k, +el.dataset.d),
  layout: (el) => {
    const sc = selScene();
    if (sc) { snap(); return change(() => (sc.layout = el.dataset.k)); }
    const sg = selSeg();
    if (sg) { snap(); return change(() => setScene(sg.a, sg.b, el.dataset.k)); }
    // Sin tramo elegido, el encuadre es el de todo el clip: las partes con otro encuadre (de la auto edicion) se quitan,
    // o taparian el cambio y pareceria que no hace nada. Ctrl+Z las recupera.
    const n = E.spec.scenes?.length || 0;
    snap(); change(() => { E.spec.layout = el.dataset.k; E.spec.scenes = undefined; });
    if (n) toast(`Encuadre de todo el clip (${n > 1 ? `quitadas ${n} partes` : 'quitada 1 parte'} aparte). Ctrl+Z la${n > 1 ? 's' : ''} recupera.`);
    // «Dos camaras» y «Camaras flotantes» necesitan las dos: si no estan marcadas, se buscan solas.
    const two = ['duo', 'float', 'grid'].includes(E.spec.layout) && camList().length < 2;
    if (!E.faces && ((E.spec.follow && CAMLAYS.includes(E.spec.layout)) || two)) detectCams(true);
  },
  // Pista «Encuadre»: desde el cursor, 3 s con solo la camara que se ve ahi (se alarga o acorta arrastrando los bordes).
  sceneadd: () => {
    const a = clamp(at(), 0, Math.max(0, E.dur - 1)), next = (E.spec.scenes || []).filter((x) => x.a > a).sort((x, y) => x.a - y.a)[0];
    if (sceneAt(a)) return toast('Aquí ya hay un cambio de encuadre: elígelo en la pista «Encuadre» para cambiarlo.');
    const b = Math.min(E.dur, a + 3, next ? next.a : Infinity), id = uid();
    if (b - a < 0.5) return toast('No cabe otro cambio de encuadre aquí.');
    snap(); change(() => { E.spec.scenes = [...(E.spec.scenes || []), { id, a, b, layout: 'cam', cam: camAt(a), cams: E.spec.cams }].sort((x, y) => x.a - y.a); select('scenes', id); });
  },
  // Clic en una cara de la vista previa → «Ver solo a esta persona»: desde el cursor, 3 s con solo esa camara.
  solocam: () => {
    const f = (E.frames || []).find((x) => x.key === E.sel?.id);
    if (!f?.r) return;
    const a = at(), b = Math.min(E.dur, a + 3), cams = sceneAt(a)?.cams || E.spec.cams;
    if (b - a < 0.5) return toast('Está casi al final del clip: mueve el cursor un poco antes.');
    snap(); change(() => { setScene(a, b, 'cam'); const sc = E.spec.scenes.find((x) => Math.abs(x.a - a) < 1e-6); Object.assign(sc, { cam: { ...f.r }, cams }); select('scenes', sc.id); });
  },
  scenemain: () => { deselect(); renderTl(); },
  scenecam: (el) => { const sc = selScene(); if (sc) { snap(); change(() => (sc.cam = sceneCams(sc)[+el.dataset.k])); } },
  scenedel: () => { const sc = selScene(); if (sc) { snap(); change(() => { E.spec.scenes = E.spec.scenes.filter((x) => x !== sc); E.sel = null; }); } },
  sceneoff: () => { const sg = selSeg(); if (sg) { snap(); change(() => setScene(sg.a, sg.b, null)); } },
  preset: (el) => { snap(); change(() => (E.spec.color = { ...PRESETS[el.dataset.k][1] })); },
  openpick: (el) => { const pk = $('picker'); if (pk) pk.style.viewTransitionName = 'zone'; return vt(() => { if (pk) pk.style.viewTransitionName = ''; openPicker(el.dataset.k || 'cam'); }); },
  speed: (el) => change(() => (E.spec.speed = +el.dataset.k)),
  titlefor: (el) => change(() => (E.spec.titleFor = +el.dataset.k || undefined)),
  quality: (el) => change(() => (E.spec.quality = el.dataset.k)),
  guide: (el) => { E.guide = el.dataset.k; E.ovSig = ''; renderPanel(); },
  plat: (el) => { E.plats.has(el.dataset.k) ? E.plats.delete(el.dataset.k) : E.plats.add(el.dataset.k); if (E.plats.size === 1) { E.guide = [...E.plats][0]; E.ovSig = ''; } renderPanel(); },
  intro: () => { change(() => { const id = uid(); E.spec.texts.push({ id, text: (E.spec.title || 'MIRA ESTO').toUpperCase(), x: 0.5, y: 0.22, size: 96, color: '#FFFFFF', box: true, a: 0, b: Math.min(E.dur, 2.5) }); E.sel = { kind: 'texts', id }; }); seek(0.1); },
  autostickers: async () => {
    const words = liveWords();
    if (!words.length) return toast('Hace falta la transcripción del clip para saber dónde ponerlos.');
    const r = await api('/api/autostickers', { words, dur: E.dur });
    if (!r.stickers.length) return toast('En este clip no se dice nada que pida sticker (jajaja, nooo, gg, wtf…).');
    change(() => E.spec.stickers.push(...r.stickers.map((x) => ({ ...x, id: uid() }))));
    toast(`Añadidos ${r.stickers.length} stickers. Muévelos o bórralos en la línea de tiempo.`, 'good');
  },
  wordcen: () => change(() => { const w = E.spec.captions.words[E.selWord]; w.cen = !isCen(w); }),
  blurall: (el) => change(() => { const z = findItem('blurs', el.dataset.id); if (!z) return; z.all = !z.all; Object.assign(z, z.all ? { a: 0, b: E.dur } : span(4)); }),
  blurdel: (el) => change(() => (E.spec.blurs = E.spec.blurs.filter((x) => x.id !== el.dataset.id))),
  zmode: (el) => { const M = E.modal; M.mode = el.dataset.k; M.sel = M.mode === 'blur' ? E.spec.blurs[0]?.id ?? null : M.mode; zpaint(); },
  zcorner: (el) => { const k = el.dataset.k, w = 0.26, h = 0.34; Object.assign(E.spec.cam, { w, h, x: k.includes('r') ? 1 - w : 0, y: k.includes('b') ? 1 - h : 0 }); E.modal.sel = 'cam'; zpaint(); },
  zdel: () => { const M = E.modal; E.spec.blurs = E.spec.blurs.filter((z) => z.id !== M.sel); M.sel = E.spec.blurs[0]?.id ?? null; zpaint(); },
  zdetect: async () => { await detectCams(); if (E.modal) { E.modal.mode = E.modal.sel = 'cam'; zpaint(); } },
  zaddcam: () => {
    const sp = E.spec, M = E.modal;
    if (!camList().length) sp.cams = [sp.cam];
    // En el hueco que menos tape a las demas camaras (si no, varias nuevas quedarian apiladas y no se verian).
    const W = 0.24, H = 0.3, over = (r) => sp.cams.reduce((t, c) => t + Math.max(0, Math.min(r.x + W, c.x + c.w) - Math.max(r.x, c.x)) * Math.max(0, Math.min(r.y + H, c.y + c.h) - Math.max(r.y, c.y)), 0);
    const spots = [[0.38, 0.35], [0.06, 0.06], [0.7, 0.06], [0.06, 0.64], [0.7, 0.64], [0.38, 0.06], [0.38, 0.64], [0.06, 0.35], [0.7, 0.35]].map(([x, y]) => ({ x, y }));
    const at = spots.reduce((best, r) => (over(r) < over(best) - 1e-6 ? r : best), spots[0]);
    sp.cams.push({ ...at, w: W, h: H, manual: true }); E.camsTouched = true;
    M.mode = 'cam'; M.sel = 'cam:' + (sp.cams.length - 1);
    zpaint();
  },
  zdelcam: () => {
    const sp = E.spec, M = E.modal, i = +String(M.sel).slice(4);
    if (!String(M.sel).startsWith('cam:') || !sp.cams?.[i]) return;
    sp.cams.splice(i, 1); E.camsTouched = true;
    sp.camTrack = null; // los turnos de quien habla apuntaban a otras posiciones de la lista
    M.sel = 'cam';
    zpaint();
  },
  zcancel: () => closeZones(false),
  zdone: () => closeZones(true),
  detectcam: () => detectCams(),
  cammode: (el) => { const auto = el.dataset.k === 'auto'; snap(); change(() => { E.spec.follow = auto; E.spec.camTrack = auto && E.faces?.track.length ? E.faces.track : null; }); if (auto && !E.faces && CAMLAYS.includes(E.spec.layout)) detectCams(true); },
  setcam: (el) => { snap(); change(() => setCamAt(at(), +el.dataset.k)); },
  spk: (el) => { const k = E.spec.camTrack?.[+el.dataset.k], n = camList().length; if (k && n) { snap(); change(() => setCamAt(k.t, (k.cam + 1) % n)); } },
  maincam: (el) => { const c = camList()[+el.dataset.k]; if (c) { snap(); change(() => (E.spec.cam = { ...c })); } },
  facetrack: () => trackFace().catch((e) => toast('No se pudo usar el detector de caras: ' + e.message, 'bad')),
  untrack: () => change(() => (E.spec.reframe = null)),
  capstyle: (el) => { const k = el.dataset.k; if (E.hoverStyle != null) { E.spec.captions.style = E.hoverStyle; E.spec.captions.on = E.hoverOn; E.hoverStyle = null; } change(() => { E.spec.captions.style = k; E.spec.captions.on = true; }); },
  lib: (el) => { E.lib = el.dataset.k; renderLib(); openTool(LIB.find(([k]) => k === E.lib)?.[3]); },
  mode: (el) => { setMode(el.dataset.k); setPref('edMode', el.dataset.k); },
  word: (el, ev) => { const k = +el.dataset.k; if (ev?.shiftKey && E.selWord >= 0) E.selTo = k; else { E.selWord = k; E.selTo = null; } seek(E.spec.captions.words[k].startMs / 1000 + 0.02); renderPanel(); $('wordList')?.querySelector(`[data-k="${k}"]`)?.focus(); },
  wordcut: () => {
    const ws = E.spec.captions.words, [i0, i1] = wordRange(), next = cutRange(segs(), ws[i0].startMs / 1000 - 0.03, ws[i1].endMs / 1000 + 0.03);
    if (!next.length) return toast('No se puede quitar todo el clip.');
    if (JSON.stringify(next) === JSON.stringify(segs())) return toast('Eso ya no está en el vídeo.');
    change(() => (E.spec.segments = next)); E.selTo = null;
    toast(`Quitado del vídeo: «${ws.slice(i0, i1 + 1).map((x) => x.text).join(' ')}». Ctrl+Z lo deshace.`, 'good');
  },
  wordrestore: () => { const ws = E.spec.captions.words, [i0, i1] = wordRange(); change(() => (E.spec.segments = restoreRange(segs(), ws[i0].startMs / 1000 - 0.03, ws[i1].endMs / 1000 + 0.03, E.dur))); toast('Recuperado en el vídeo.', 'good'); },
  subnext: () => { const ws = E.spec.captions.words, fr = foundRanges(), now = at() * 1000; const r = fr.find(([i]) => ws[i].startMs > now + 50) || fr[0]; if (!r) return; E.selWord = r[0]; E.selTo = r[1]; seek(ws[r[0]].startMs / 1000 + 0.02); renderPanel(); },
  subcutall: () => {
    const ws = E.spec.captions.words, fr = foundRanges();
    let sg = segs(); for (const [i0, i1] of fr) sg = cutRange(sg, ws[i0].startMs / 1000 - 0.03, ws[i1].endMs / 1000 + 0.03);
    if (!sg.length) return toast('No se puede quitar todo el clip.');
    change(() => (E.spec.segments = sg));
    toast(`Quitad${fr.length > 1 ? 'as' : 'a'} ${fr.length} del vídeo. Ctrl+Z lo deshace.`, 'good');
  },
  wordhi: () => change(() => { const w = E.spec.captions.words[E.selWord]; w.hi = !(w.hi ?? (E.spec.captions.keywords && isKeyword(w.text))); }),
  worddel: () => change(() => { const w = E.spec.captions.words[E.selWord]; w.del = !w.del; }),
  typewords: async () => {
    const cur = (E.spec.captions.words || []).map((w) => w.text).join(' '), text = await ask('Texto de los subtítulos', { text: 'Escribe o corrige todo lo que se dice. Ctrl+Enter para aplicar.', value: cur, multiline: true, ok: 'Aplicar' });
    if (text == null) return;
    const tok = text.trim().split(/\s+/).filter(Boolean), old = E.spec.captions.words || [];
    change(() => {
      if (tok.length === old.length) old.forEach((w, i) => { if (w.text !== tok[i]) { if (w.was == null) w.was = w.text; w.text = tok[i]; } });
      else { const a = old[0]?.startMs ?? 300, b = old[old.length - 1]?.endMs ?? E.dur * 1000 - 300, st = Math.max(120, (b - a) / Math.max(1, tok.length)); E.spec.captions.words = tok.map((t, i) => ({ text: t, startMs: Math.round(a + i * st), endMs: Math.round(a + (i + 1) * st) })); }
      E.wordsState = 'ok';
    });
  },
  fixsubs: async () => {
    const before = E.spec.captions.words || [];
    if (!before.length) return;
    const w8 = working(S.tools.ia ? 'Corrigiendo con IA… puede tardar un poco' : 'Corrigiendo…');
    try {
      const r = await api('/api/subfix', { streamer: E.src.streamer || '', words: before });
      if (!r.changed) return toast(r.note || 'No encontré nada que corregir.');
      // Se marcan las palabras que cambiaron, para revisarlas de un vistazo.
      E.fixed = new Set(r.words.map((x, i) => (r.words.length === before.length ? (before[i].text !== x.text || !!before[i].del !== !!x.del ? i : -1) : before.some((b) => b.text === x.text && b.startMs === x.startMs) ? -1 : i)).filter((i) => i >= 0));
      change(() => (E.spec.captions.words = r.words)); E.selWord = -1; E.capSig = ''; renderPanel(); renderTl();
      toast(`${r.changed} ${r.changed === 1 ? 'corrección' : 'correcciones'}${r.ai ? ' con IA' : ''}. Están subrayadas; Ctrl+Z las deshace.`, 'good');
      if (r.note) toast(r.note);
    } finally { w8.done(); }
  },
  translate: async () => { const lang = await ask('Traducir los subtítulos', { text: '¿A qué idioma?', value: 'inglés', ok: 'Traducir' }); if (!lang) return; const r = await api('/api/translate', { words: liveWords(), lang }); change(() => (E.spec.captions.words = r.words)); toast('Subtítulos traducidos', 'good'); },
  addtext: () => change(() => { const id = uid(); E.spec.texts.push({ id, text: 'TU TEXTO', x: 0.5, y: 0.78, size: 80, color: '#FFFFFF', box: false, ...span(2.5) }); E.sel = { kind: 'texts', id }; E.tool = 'texto'; renderTabs(); }),
  addsticker: (el) => change(() => { const id = uid(); E.spec.stickers.push({ id, file: el.dataset.k, x: 0.72, y: 0.55, w: 0.3, ...span(2.5) }); E.sel = { kind: 'stickers', id }; }),
  addsfx: (el) => { new Audio('/assets/sfx/' + el.dataset.k).play().catch(() => {}); change(() => { const id = uid(); E.spec.sfx.push({ id, file: el.dataset.k, t: at(), vol: 1 }); E.sel = { kind: 'sfx', id }; }); },
  addzoom: () => change(() => { const id = uid(); E.spec.zooms.push({ id, scale: 1.35, ...span(2) }); E.sel = { kind: 'zooms', id }; E.tool = 'zoom'; renderTabs(); }),
  stylepreset: (el) => {
    const [, p] = STYLE_PRESETS[el.dataset.k];
    snap(); change(() => { const { captions, ...rest } = p; Object.assign(E.spec, rest); Object.assign(E.spec.captions, captions); if (!rest.follow) E.spec.camTrack = null; else if (E.faces?.track.length) E.spec.camTrack = E.faces.track; });
    if (E.spec.follow && CAMLAYS.includes(E.spec.layout) && !E.faces) detectCams(true);
    toast('Estilo aplicado. Queda guardado para este streamer.', 'good');
  },
  punch: () => change(() => { const id = uid(), a = clamp(at(), 0, Math.max(0, E.dur - 1.5)); E.spec.punches.push({ id, a, b: Math.min(E.dur, a + 1.5), cam: Math.max(-1, camIdxAt(at())) }); E.sel = { kind: 'punches', id }; }),
  punchreact: async () => {
    if (!E.faces) await detectCams(true);
    const r = E.faces;
    if (!r || r.cam < 0 || r.react < 1) return toast('No encontré una reacción clara en las caras de este clip.');
    change(() => { const id = uid(); E.spec.punches.push({ id, a: Math.max(0, r.at - 0.3), b: Math.min(E.dur, r.at + 1.2), cam: r.cams.length > 1 ? r.cam : -1 }); E.sel = { kind: 'punches', id }; });
    seek(Math.max(0, r.at - 0.5));
    toast(r.label ? 'Golpe en la ' + r.label + '.' : 'Golpe añadido en la reacción.', 'good');
  },
  zoompeak: () => { const p = clamp((E.cand.peak ?? E.start) - E.start, 0.5, E.dur - 2); change(() => { const id = uid(); E.spec.zooms.push({ id, scale: 1.4, a: Math.max(0, p - 0.5), b: Math.min(E.dur, p + 2) }); E.sel = { kind: 'zooms', id }; }); seek(p); },
  sel: (el) => { select(el.dataset.kind, el.dataset.id); const it = findItem(E.sel.kind, E.sel.id); if (it) seek((it.a ?? it.t) + 0.05); renderPanel(); renderTl(); E.ovSig = ''; },
  split: () => { const t = at(), before = segs().length; change(() => (E.spec.segments = segs().flatMap((s) => (t > s.a + 0.2 && t < s.b - 0.2 ? [{ ...s, b: t, hold: undefined }, { ...s, a: t }] : [s])))); if (segs().length === before) toast('Pon el cursor dentro de un tramo para cortarlo.'); },
  delseg: () => {
    const s = segs(), i = E.sel?.kind === 'seg' ? E.sel.id : s.findIndex((x) => at() >= x.a && at() < x.b);
    if (i < 0) return toast('El cursor no está sobre ningún tramo.');
    if (s.length === 1) return toast('Primero corta el clip: «Cortar aquí» divide el tramo en el cursor.');
    change(() => { E.spec.segments = s.filter((_, k) => k !== i); E.sel = null; });
  },
  resetseg: () => change(() => (E.spec.segments = null)),
  // 2,5 s alrededor del cursor (desplazados si el cursor esta cerca de un borde, para que siempre dure lo mismo).
  replayhere: () => { const L = Math.min(2.5, E.dur), a = Math.min(Math.max(0, (E.t ?? 0) - 1.2), E.dur - L), b = a + L; change(() => (E.spec.replay = { a, b, speed: 0.5 })); toast(`Al final se repetirá a cámara lenta ${fmt(a)}–${fmt(b)}. Se ve al exportar.`, 'good'); },
  noreplay: () => change(() => (E.spec.replay = null)),
  replayspeed: (el) => { if (E.spec.replay) change(() => (E.spec.replay.speed = +el.dataset.k)); },
  autolook: async () => {
    const w8 = working('Midiendo la luz y el color…');
    try {
      const r = await api('/api/autolook', { sid: E.src.id, start: E.start, end: E.end });
      if (!r.needed) return toast('La imagen ya está bien: no hace falta corregir nada.', 'good');
      change(() => (E.spec.color = r.color));
      toast('Luz y color corregidos: ' + r.why.join(', ') + '. Ctrl+Z lo deshace.', 'good');
    } catch (e) { toast(e.message); } finally { w8.done(); }
  },
  condense: async (el) => {
    const target = +el.dataset.k, w8 = working(`Eligiendo lo mejor para ${target} s…`);
    try {
      const r = await api('/api/condense', { sid: E.src.id, start: E.start, end: E.end, target });
      change(() => (E.spec.segments = r.segments));
      toast(`Condensado a ${r.kept} s: ${r.phrases} de ${r.of} frases, ${r.by === 'agente' ? 'elegidas por el agente' : 'las más intensas con su contexto'}. Ctrl+Z lo deshace.`, 'good');
    } catch (e) { toast(e.message); } finally { w8.done(); }
  },
  silences: async () => { const r = await api('/api/silences', { sid: E.src.id, start: E.start, end: E.end }); if (!r.silences.length) return toast('No encontré silencios de más de medio segundo.'); change(() => (E.spec.segments = r.segments)); toast(`Quitados ${r.silences.length} silencios`, 'good'); },
  delsel: () => {
    if (!E.sel) return toast('Selecciona algo en la vista previa o en la línea de tiempo.');
    if (E.sel.kind === 'seg') return locked('seg') ? toast('La pista de vídeo está bloqueada.') : actions.delseg();
    if (E.sel.kind === 'title') { change(() => { E.spec.title = ''; E.sel = null; }); return toast('Título quitado. Ctrl+Z lo recupera.'); }
    if (E.sel.kind === 'captions') return actions.capoff();
    if (E.sel.kind === 'frame') return toast('Las zonas del vídeo no se borran: cambia el encuadre en la barra de encima de la vista previa.');
    const all = selected().filter((m) => !lockedItem(m.kind, m.id));
    if (!all.length) return toast('Está bloqueado: desbloquéalo con su candado para borrarlo.');
    change(() => { for (const m of all) E.spec[m.kind] = E.spec[m.kind].filter((x) => x.id !== m.id); E.sel = null; E.multi = []; });
  },
  // Copia justo despues del original (o donde quepa), con lo demas igual.
  segspeed: (el) => segEdit((x) => { x.speed = +el.dataset.k; }),
  segcurve: (el) => segEdit((x) => { x.curve = el.dataset.k || undefined; }),
  segrev: () => { closeCtx(); segEdit((x) => { x.rev = !x.rev; }); if (segAt()?.rev) toast('Este tramo saldrá al revés en el vídeo exportado (la vista previa no puede reproducir hacia atrás).'); },
  segflip: (el) => { closeCtx(); segEdit((x) => { const f = new Set((x.flip || '').split('')); f.has(el.dataset.k) ? f.delete(el.dataset.k) : f.add(el.dataset.k); x.flip = ['h', 'v'].filter((c) => f.has(c)).join('') || undefined; }); },
  segrot: (el) => { closeCtx(); segEdit((x) => { x.rot = ((((x.rot || 0) + +el.dataset.k + 180) % 360) + 360) % 360 - 180 || undefined; }); },
  freezehere: (el) => {
    closeCtx();
    const t = el?.dataset?.k != null ? +el.dataset.k : at(), s0 = segs(), i = s0.findIndex((x) => t > x.a + 0.2 && t < x.b - 0.05);
    if (i < 0) return toast('Pon el cursor dentro de un tramo para congelar esa imagen.');
    change(() => { const x = s0[i]; E.spec.segments = [...s0.slice(0, i), { ...x, b: t, hold: 2 }, ...(x.b - t >= 0.2 ? [{ ...x, a: t, hold: x.hold }] : []), ...s0.slice(i + 1)].map((y) => ({ ...y })); E.sel = { kind: 'seg', id: i }; });
    toast(`Imagen congelada 2 s en ${fmt(t)}. Ajusta cuánto dura en «Recorte».`, 'good');
  },
  hookgo: () => {
    const h = hookRange();
    if (!h) return;
    seek(h.a + 0.05); E.tool = 'recorte'; renderTabs(); renderPanel();
    toast(`El gancho: ${fmt(h.a)}–${fmt(h.b)} se ve al principio del clip. Desmarca «Gancho» aquí para quitarlo.`);
  },
  setvol: (el) => change(() => (E.spec.volume = +el.dataset.k / 100)),
  track: (el) => { const k = el.dataset.k, p = el.dataset.p; change(() => { const t = (E.spec.tracks ||= {}); t[k] = { ...t[k], [p]: !t[k]?.[p] }; }); },
  tlgaps: (el) => { const on = !pref('tlGaps', false); setPref('tlGaps', on); el.setAttribute('aria-pressed', String(on)); el.classList.toggle('on', on); renderTl(); },
  tall: (el) => { E.tall = !E.tall; el.setAttribute('aria-pressed', String(E.tall)); el.classList.toggle('on', E.tall); renderTl(); },
  skim: (el) => { const on = !pref('skim', true); setPref('skim', on); el.setAttribute('aria-pressed', String(on)); el.classList.toggle('on', on); if (!on) endSkim(); },
  ctxsel: (el) => { const b = el.getBoundingClientRect(), s = selected()[0]; if (!s) return; const node = s.kind === 'seg' ? $('tracks').querySelector(`.blk[data-kind=seg][data-id="${s.id}"]`) : $('tracks').querySelector(`.blk[data-kind="${s.kind}"][data-id="${s.id}"]`); const items = node && ctxFor(node, node.getBoundingClientRect().left + 4, b.bottom); if (items) openCtx(b.left, b.bottom + 4, items); },
  splitat: (el) => { closeCtx(); seek(+el.dataset.k); actions.split(); },
  addmarker: (el) => { closeCtx(); const t = el?.dataset?.k != null ? +el.dataset.k : at(), n = (E.spec.markers || []).length; change(() => (E.spec.markers ||= []).push({ id: uid(), t: Math.round(t * 100) / 100, label: `Marca ${n + 1}`, color: MK_COLORS[n % MK_COLORS.length] })); toast(`Marcador en ${fmt(t)}. Clic derecho para cambiarle el nombre o el color.`); },
  mkgo: (el) => { closeCtx(); video()?.pause(); seek(+el.dataset.k); renderTl(); },
  mkname: async (el) => { closeCtx(); const m = E.spec.markers.find((x) => x.id === el.dataset.id); if (!m) return; const v = await ask('Nombre del marcador', { value: m.label, ok: 'Guardar' }); if (v != null) change(() => (m.label = v.trim().slice(0, 40) || m.label)); },
  mkcolor: (el) => { closeCtx(); const m = E.spec.markers.find((x) => x.id === el.dataset.id); if (m) change(() => (m.color = el.dataset.k)); },
  mkdel: (el) => { closeCtx(); change(() => (E.spec.markers = E.spec.markers.filter((x) => x.id !== el.dataset.id))); },
  copyattr: () => { closeCtx(); const s0 = selected()[0], it = s0 && findItem(s0.kind, s0.id), keys = ATTRS[s0?.kind]; if (!it || !keys) return toast('Selecciona un texto, sticker, zoom o sonido para copiar su estilo.'); E.attrs = { kind: s0.kind, data: Object.fromEntries(keys.map((k) => [k, it[k]])) }; toast('Atributos copiados. Selecciona otros del mismo tipo y pulsa Ctrl+Alt+V.'); },
  pasteattr: () => { closeCtx(); const a = E.attrs, all = selected().filter((m) => m.kind === a?.kind && !locked(m.kind)); if (!a || !all.length) return toast(a ? 'Selecciona elementos del mismo tipo para pegar los atributos.' : 'Primero copia los atributos de un elemento (Ctrl+Alt+C).'); change(() => { for (const m of all) Object.assign(findItem(m.kind, m.id), a.data); }); toast(`Atributos pegados en ${all.length}.`); },
  fullscreen: () => { const st = root().querySelector('.estage'); if (document.fullscreenElement) document.exitFullscreen(); else st?.requestFullscreen?.().catch(() => toast('El navegador no deja poner la pantalla completa.')); },
  dupsel: () => {
    const all = selected().filter((m) => m.kind !== 'seg' && findItem(m.kind, m.id));
    if (!all.length) return toast('Selecciona un texto, sticker, zoom o efecto en la línea de tiempo.');
    change(() => {
      const copies = all.map((m) => {
        const it = findItem(m.kind, m.id), id = uid(), c = { ...it, id };
        if ('t' in it) c.t = clamp(it.t + 1, 0, E.dur - 0.05);
        else { const len = it.b - it.a; c.a = it.b + len <= E.dur ? it.b : Math.max(0, E.dur - len); c.b = c.a + len; c.all = false; }
        E.spec[m.kind].push(c); return { kind: m.kind, id };
      });
      E.sel = copies[copies.length - 1]; E.multi = copies.length > 1 ? copies : [];
    });
  },
  // Lo elegido en la vista previa: capa, bloqueo, visibilidad, posicion y tiempo.
  layerfront: () => layerMove(1),
  layerback: () => layerMove(-1),
  itemlock: (el) => { const k = el?.dataset?.kind || E.sel?.kind, id = el?.dataset?.id || E.sel?.id, it = findItem(k, id); if (it) change(() => { it.lock = !it.lock || undefined; }); },
  itemhide: (el) => {
    const k = el?.dataset?.kind || E.sel?.kind, id = el?.dataset?.id || E.sel?.id, it = findItem(k, id);
    if (!it) return;
    change(() => { it.hide = !it.hide || undefined; });
    if (it.hide) toast('Oculto: no sale en la vista previa ni en el vídeo. Vuelve a mostrarlo en «Capas», a la izquierda.');
  },
  layerpick: (el) => {
    const k = el.dataset.kind, id = el.dataset.id, it = findItem(k, id);
    if (it && 'a' in it && !(at() >= it.a && at() <= it.b)) { video()?.pause(); seek(it.a + 0.05); }
    selectCanvas(k, id);
  },
  inlineedit: () => { const el = $('ov')?.querySelector(E.sel?.kind === 'title' ? '.ov-title' : `[data-ov=texts][data-id="${E.sel?.id}"]`); el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); },
  textcolor: (el) => { const t = findItem('texts', E.sel?.id); if (t) change(() => { t.color = el.dataset.k; }); },
  center: () => { const it = findItem(E.sel?.kind, E.sel?.id); if (it && !lockedItem(E.sel.kind, it.id)) change(() => { it.x = 0.5; }); },
  straight: () => { const it = findItem(E.sel?.kind, E.sel?.id); if (it) change(() => { it.rot = undefined; }); },
  tfrom: () => { const it = findItem(E.sel?.kind, E.sel?.id); if (!it) return; if (at() > it.b - 0.3) return toast('El cursor está después de su final: mueve el cursor antes.'); change(() => { it.a = Math.round(at() * 100) / 100; }); },
  tto: () => { const it = findItem(E.sel?.kind, E.sel?.id); if (!it) return; if (at() < it.a + 0.3) return toast('El cursor está antes de su inicio: mueve el cursor después.'); change(() => { it.b = Math.round(at() * 100) / 100; }); },
  titlereset: () => change(() => { E.spec.titleY = undefined; }),
  zoomreset: () => { const z = findItem('zooms', E.sel?.id); if (z) change(() => { delete z.fx; delete z.fy; }); },
  gamereset: () => { change(() => { E.spec.game = undefined; }); toast('La zona del juego vuelve a ser automática.'); },
  capoff: () => { change(() => { E.spec.captions.on = false; if (E.sel?.kind === 'captions') E.sel = null; }); toast('Subtítulos ocultos. Vuelve a ponerlos en «Subtítulos» o con Ctrl+Z.'); },
  titles: async () => {
    const r = await api('/api/titles', { sid: E.src.id, text: liveWords().map((w) => w.text).join(' ') });
    // Se guardan en E para que sigan ahi aunque el panel se vuelva a dibujar.
    E.titleSug = r.titles;
    if (!r.titles.length) toast('No encontré una frase clara en la transcripción para el título.');
    change(() => (E.spec.description = `${r.description} ${r.hashtags.join(' ')}`.trim()), false);
  },
  usetitle: (el) => change(() => (E.spec.title = el.dataset.k)),
  export: async () => {
    const n = (E.plats.size || 1) * (E.hookTest ? 3 : 1);
    await api('/api/export', { ...E.spec, sid: E.src.id, candidateId: E.cand.id, start: E.start, end: E.end, edited: true, hookTest: E.hookTest, platforms: [...E.plats] });
    await api('/api/template', { streamer: E.src.streamer || '', template: E.spec }).catch(() => {});
    toast(n > 1 ? `Exportando ${n} versiones…` : 'Exportando el clip…', 'good');
    go('clips');
  },
};

// Campos de formulario: data-i dice que propiedad cambian.
function setField(el) {
  if (el.type === 'number' && (el.value === '' || !Number.isFinite(+el.value))) return; // a medio escribir
  const k = el.dataset.i, v = el.type === 'checkbox' ? el.checked : el.value, sp = E.spec, live = el.type === 'range' || el.type === 'number' || el.type === 'color' || el.type === 'text' || el.tagName === 'TEXTAREA';
  const apply = () => {
    if (k === 'hook') sp.hook = v;
    else if (k === 'cropX') { sp.cropX = v / 100; sp.reframe = null; }
    else if (k === 'pipPos') sp.pipPos = v;
    else if (k === 'cleanAudio') sp.cleanAudio = v;
    else if (k === 'title' || k === 'description' || k === 'credit') sp[k] = v;
    else if (k === 'voiceFx') sp.voice = v ? { fx: v, on: sp.voice?.on || 'todo' } : null;
    else if (k === 'voiceReplay') { if (sp.voice) sp.voice.on = v ? 'repeticion' : 'todo'; }
    else if (k === 'music') sp.music = v ? { file: v, vol: sp.music?.vol ?? 0.15 } : null;
    else if (k === 'musicVol') sp.music.vol = v / 100;
    else if (k === 'volume') sp.volume = v / 100;
    else if (k === 'sfxVol') { const x = sp.sfx.find((y) => y.id === E.sel?.id); if (x) x.vol = v / 100; }
    else if (k === 'musicDuck') sp.music.duck = v;
    else if (k === 'progress' || k === 'stabilize' || k === 'vary' || k === 'autoStickers' || k === 'autoZoom' || k === 'autoPunch' || k === 'flash') sp[k] = v;
    else if (k === 'noAuto') sp.noAuto = !v; // la casilla dice «con auto edicion»
    else if (k === 'titleStyle' || k === 'fitBg') sp[k] = v;
    else if (k === 'brand.on') sp.brand = v ? { on: true, text: sp.brand?.text || (S.settings.tiktokAccount ? '@' + S.settings.tiktokAccount.replace(/^@/, '') : '') } : undefined;
    else if (k === 'brand.text') sp.brand = { on: true, text: String(v).slice(0, 24) };
    else if (k === 'fadeIn' || k === 'fadeOut') sp[k] = v / 10;
    else if (k === 'transDur') { sp.transDur = v / 10; const o = $('tdur'); if (o) o.textContent = sp.transDur.toFixed(1) + ' s'; }
    else if (k === 'transCuts') sp.transCuts = v;
    else if (k.startsWith('color.')) sp.color[k.slice(6)] = v / 100;
    else if (k === 'outro.on') sp.outro.on = v;
    else if (k === 'outro.text') sp.outro.text = v;
    else if (k === 'outro.seconds') sp.outro.seconds = v / 10;
    else if (k === 'creditPos') sp.creditPos = v;
    else if (k.startsWith('censor.')) sp.censor[k.slice(7)] = v;
    else if (k === 'hookTest') E.hookTest = v;
    else if (k === 'cap.posY') { capManual(); sp.captions.posY = +v; }
    else if (k.startsWith('cap.')) { const f = k.slice(4); sp.captions[f] = ['on', 'keywords', 'fix', 'smart'].includes(f) ? v : ['size', 'posY', 'perChunk'].includes(f) ? +v : v; }
    else if (k === 'word.text') { const w = sp.captions.words[E.selWord]; if (w.was == null) w.was = w.text; w.text = v; } // was: lo que habia, para aprender la correccion
    else if (k.startsWith('text.') || k.startsWith('sticker.')) {
      const t = findItem(k.startsWith('text.') ? 'texts' : 'stickers', E.sel?.id), f = k.slice(k.indexOf('.') + 1);
      if (t) t[f] = f === 'x' || f === 'y' ? clamp(+v / 100, 0, 1) : f === 'w' ? clamp(+v / 100, 0.05, 1) : f === 'size' ? clamp(+v, 20, 240)
        : f === 'op' ? (+v >= 100 ? undefined : clamp(+v / 100, 0.05, 1)) : f === 'rot' ? (+v ? clamp(+v, -180, 180) : undefined) : v;
    }
    else if (k === 'title.y') sp.titleY = Math.round(clamp(+v / 100, 0.05, 0.92) * H);
    else if (k.startsWith('frame.')) {
      const r = frameRegion(E.sel?.id || '', true), f = k.slice(6);
      if (r) { if (f === 'size') scaleRegion(r, clamp(+v / 100, 0.04, 1) / r.w); else if (f === 'x') r.x = clamp(+v / 100 - r.w / 2, 0, 1 - r.w); else r.y = clamp(+v / 100 - r.h / 2, 0, 1 - r.h); if (E.sel.id.startsWith('cam')) E.camsTouched = true; }
    }
    else if (k === 'zoom.fx' || k === 'zoom.fy') { const z = findItem('zooms', E.sel?.id); if (z) z[k.slice(5)] = clamp(+v / 100, 0, 1); }
    else if (k === 'seg.rot' || k === 'seg.hold') { const x = segAt(); if (x) { if (k === 'seg.rot') x.rot = +v; else x.hold = +v / 2; } }
    else if (k === 'zoom.scale') { const z = findItem('zooms', E.sel?.id); if (z) z.scale = clamp(v / 100, 1.05, 2.5); }
  };
  // Mientras se arrastra un deslizador o se escribe, se actualiza la vista previa sin redibujar el panel (no se pierde el foco).
  // El numero y el deslizador de una misma propiedad se siguen el uno al otro.
  if (live) { apply(); E.ovSig = E.capSig = ''; E.force = true; renderTl(); renderSum();
    if (el.closest('#epanel')) { root().querySelectorAll(`#epanel [data-i="${k}"]`).forEach((x) => { if (x !== el && x.type !== 'checkbox') x.value = el.value; }); ranges($('epanel')); } clearTimeout(tplTimer); setTplTimer(setTimeout(() => api('/api/template', { streamer: E.src.streamer || '', template: E.spec }).catch(() => {}), 800)); }
  else change(apply);
}

export const root = () => $('v-editor');
document.addEventListener('click', (e) => {
  if (!E || root().hidden || !root().contains(e.target)) return;
  const b = e.target.closest('[data-e]');
  if (b) { e.stopPropagation(); Promise.resolve(actions[b.dataset.e]?.(b, e)).then(() => { if (b.dataset.t) openTool(b.dataset.t); }).catch((err) => toast(err.message, 'bad')); }
}, true);
document.addEventListener('input', (e) => {
  if (!E || !root().contains(e.target)) return;
  if (e.target.id === 'zt') return zframe(+e.target.value);
  if (e.target.id === 'subQ') { E.subQ = e.target.value; refreshFound(); return; }
  if (e.target.dataset.i) setField(e.target);
});
document.addEventListener('change', (e) => {
  if (!E || !root().contains(e.target) || e.target.dataset.names == null) return;
  api('/api/profile', { streamer: pkey(), names: e.target.value }).then(() => { toast('Nombres guardados', 'good'); refresh(); }).catch((err) => toast(err.message, 'bad'));
});
document.addEventListener('focusin', (e) => { if (E && root().contains(e.target) && e.target.dataset.i && ['range', 'text', 'number'].includes(e.target.type)) pushUndo(); });

// Arrastres: bloques de la linea de tiempo, elementos sobre la vista previa, y zonas de camara/juego.
document.addEventListener('pointerdown', (e) => {
  if (!E || root().hidden || !root().contains(e.target)) return;
  if (E.modal) return zdown(e);
  if (e.target.closest('.tjoin, .tmark, .mk, .tbtn, .hookband, #ctx') || e.button === 2) return; // botones y menu: los maneja el clic, sin mover el cursor
  closeCtx();
  endSkim();
  // Las flechas mueven lo elegido solo si se esta trabajando en la vista previa; si no, mueven el cursor.
  E.canvasFocus = !!e.target.closest('#phone, #selbar');
  if (e.target.closest('[contenteditable=plaintext-only], [contenteditable=true]')) return; // escribiendo encima
  if (canvasDown(e)) return;
  // Un clic en el fondo, alrededor del visor, deja de elegir.
  if (e.target.closest('.estage') && !e.target.closest('#selbar, .float, .transport, button, input, select, a')) return deselect();
  const blk = e.target.closest('.blk'), lane = e.target.closest('.lane');
  if (blk && lane) {
    const kind = blk.dataset.kind, w = lane.getBoundingClientRect(), x0 = e.clientX, r = blk.getBoundingClientRect();
    if (locked(kind)) return scrubFrom(e); // pista bloqueada: solo se mueve el cursor
    if (kind === 'seg') {
      const i = +blk.dataset.id, edge = e.clientX - r.left < 8 ? 'a' : r.right - e.clientX < 8 ? 'b' : null;
      E.sel = { kind: 'seg', id: i }; E.multi = []; renderFloat(); // el encuadre pasa a ser el de ese tramo
      if (E.tool === 'recorte') renderPanel(); // el inspector enseña ese tramo
      if (!edge) return scrubFrom(e);
      // Recortar el tramo por su borde, con el iman y viendo el fotograma del borde en la vista previa.
      pushUndo();
      const s0 = segs().map((x) => ({ ...x })), lo = edge === 'a' ? (s0[i - 1]?.b ?? 0) : s0[i].a + 0.3, hi = edge === 'a' ? s0[i].b - 0.3 : (s0[i + 1]?.a ?? E.dur);
      const list = [0, E.dur, at(), ...s0.filter((_, k) => k !== i).flatMap((x) => [x.a, x.b])], o0 = s0[i][edge], L0 = tlLen();
      video().pause();
      setDrag({ move: (ev) => { const t = clamp(snapTo(o0 + ((ev.clientX - x0) / w.width) * L0, ev, list), lo, hi); s0[i][edge] = t; E.spec.segments = s0.map((x) => ({ ...x })); seek(t); renderTl(); },
        up: () => { E.snapAt = null; change(() => {}, false); } });
      return renderTl();
    }
    if (kind === 'chunk') { seek(+blk.dataset.id / 1000 + 0.02); E.sel = null; E.multi = []; E.tool = 'subs'; renderTabs(); return renderPanel(); }
    let it = findItem(kind, blk.dataset.id);
    if (!it) return;
    if (it.lock && !e.shiftKey && !e.ctrlKey && !e.metaKey) { select(kind, it.id); renderPanel(); renderTl(); return scrubFrom(e); } // bloqueado: se elige, no se mueve
    // Mayus o Ctrl + clic: añade o quita de la seleccion. Ctrl + arrastrar: duplica y mueve la copia.
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && !e.altKey) {
      const dupe = e.ctrlKey || e.metaKey;
      setDrag({ moved: false, move: (ev) => {
        if (drag.moved || !dupe || Math.abs(ev.clientX - x0) < 4) return;
        drag.moved = true;
        if (!isSel(kind, it.id)) select(kind, it.id);
        actions.dupsel(); // duplica lo seleccionado (uno o varios) y deja seleccionadas las copias
        const sel = E.sel; setDrag(null);
        blk.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ev.clientX, clientY: ev.clientY })); // y se sigue arrastrando la copia
        void sel;
      }, up: () => { if (!drag?.moved) toggleSel(kind, it.id); } });
      return;
    }
    const s0 = shot(); let pushed = false; // un clic sin mover solo selecciona: no deja un paso vacio en Ctrl+Z
    if (!isSel(kind, it.id)) select(kind, it.id);
    const group = (E.multi || []).filter((m) => !(m.kind === kind && m.id === it.id)).map((m) => findItem(m.kind, m.id)).filter(Boolean).map((x) => ({ x, a: x.a, b: x.b, t: x.t }));
    const mode = kind === 'sfx' ? 'move' : e.clientX - r.left < 8 ? 'l' : r.right - e.clientX < 8 ? 'r' : 'move', o = { a: it.a, b: it.b, t: it.t }, list = snapList(it);
    setDrag({ move: (ev) => {
      if (!pushed) {
        pushed = true; pushUndo(s0);
        if (kind === 'blurs' && it.all) Object.assign(it, { all: false, a: 0, b: E.dur }); // al arrastrarla deja de ser «siempre»
      }
      const dv = ((ev.clientX - x0) / w.width) * tlLen(), mv = (t0) => toSrc(clamp(toView(t0) + dv, 0, tlLen()));
      if (kind === 'sfx') it.t = clamp(snapTo(mv(o.t), ev, list), 0, E.dur - 0.05);
      else if (mode === 'l') it.a = clamp(snapTo(mv(o.a), ev, list), 0, it.b - 0.3);
      else if (mode === 'r') it.b = clamp(snapTo(mv(o.b), ev, list), it.a + 0.3, E.dur);
      else {
        // Al mover, se pega el borde (inicio o fin) que quede mas cerca de algo; la guia se queda en ese borde.
        const len = o.b - o.a, a = mv(o.a), sa = snapTo(a, ev, list), sb = snapTo(a + len, ev, list) - len;
        const da = Math.abs(sa - a), db = Math.abs(sb - a), useA = da > 0 && (db === 0 || da <= db), pick = useA ? sa : db > 0 ? sb : a;
        // Si pegado ahi no cabe (se saldria del clip), no se pega: la guia nunca marca un sitio al que el bloque no llega.
        const na = clamp(pick, 0, E.dur - len);
        E.snapAt = pick === a || na !== pick ? null : useA ? sa : sb + len;
        it.a = na; it.b = it.a + len;
        // Lo demas seleccionado se mueve lo mismo.
        const dd = it.a - o.a;
        for (const g of group) { if ('t' in g.x && g.t != null) g.x.t = clamp(g.t + dd, 0, E.dur - 0.05); else { const l = g.b - g.a; g.x.a = clamp(g.a + dd, 0, E.dur - l); g.x.b = g.x.a + l; } }
      }
      renderTl(); E.ovSig = '';
    }, up: () => { E.snapAt = null; change(() => {}, false); } });
  } else if (lane && !['ruler', 'video'].includes(lane.dataset.lane) && !e.shiftKey) marquee(e);
  else if (lane) scrubFrom(e);
});
/** Arrastrar sobre la regla o una pista mueve el cursor de reproduccion, viendo cada fotograma. */
function scrubFrom(e) {
  const go = (ev) => seek(tAtX(ev.clientX));
  video()?.pause();
  go(e);
  renderTl();
  setDrag({ move: go, up: () => {} });
}
// Junto al borde de un bloque que se puede recortar, el puntero lo indica.
document.addEventListener('pointermove', (e) => {
  if (drag || !E) return;
  const b = e.target.closest?.('.blk');
  if (!b || b.dataset.kind === 'sfx' || b.dataset.kind === 'chunk') return;
  const r = b.getBoundingClientRect(), near = e.clientX - r.left < 8 || r.right - e.clientX < 8;
  b.style.cursor = near ? 'ew-resize' : '';
});
// Ctrl + rueda: zoom de la linea de tiempo alrededor del puntero.
document.addEventListener('wheel', (e) => {
  if (!E || !e.ctrlKey || !e.target.closest?.('#tlScroll')) return;
  e.preventDefault();
  setTlZoom((E.tlZoom || 1) * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX);
}, { passive: false });
document.addEventListener('pointermove', (e) => { if (drag) return drag.move(e); skimAt(e); });
document.addEventListener('pointerup', () => { if (drag) { const d = drag; setDrag(null); d.up(); } });
