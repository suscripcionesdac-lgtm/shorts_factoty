/** Abrir el editor con un momento o un clip guardado. */
import { $, api, esc, fmt, toast } from '/web/app.js';
import { icon } from '/web/icons.js';
import { helpBtn, tourHere } from '/web/help.js';
import { detectCams } from './actions.js';
import { CAMLAYS, findScenes, segs } from './geometry.js';
import { renderLib } from './library.js';
import { renderTabs, setMode } from './panels.js';
import { loop, seek } from './playback.js';
import { INTRO, renderPanel, renderSum } from './review.js';
import { assetsCache, CH, CW, E, FN_TOOLS, raf, setAssetsCache, setE, setRaf, ticon, TOOLS } from './state.js';
import { pref, renderTl, splitter } from './timeline.js';

// ---------- abrir ----------
/** `saved`: los ajustes de un clip ya exportado (desde «Clips»), en lugar de la plantilla del streamer. */
export async function openEditor(src, cand, saved = null) {
  cancelAnimationFrame(raf);
  const tpl = await api('/api/template?streamer=' + encodeURIComponent(src.streamer || ''));
  setAssetsCache(assetsCache || (await api('/api/assets')));
  setE({ src, cand, start: saved ? saved.start : Math.round(cand.start), end: saved ? saved.end : Math.round(cand.end), tool: 'clip', sel: null, selWord: -1, undo: [], redo: [], wave: [], wordsState: 'cargando', capSig: '', ovSig: '', faces: null, facesState: '',
    guide: '', plats: new Set(), hookTest: false, modal: null, tlZoom: 1, magnet: pref('magnet', true),
    spec: { ...tpl, title: cand.title || '', description: '', texts: [], stickers: [], sfx: [], zooms: [], segments: null, reframe: null, cams: undefined, camTrack: null, punches: [], mutes: undefined, captions: { ...tpl.captions, words: undefined } } });
  E.dur = E.end - E.start;
  E.spec.blurs = (tpl.blurs || []).map((z) => ({ ...z, a: 0, b: E.dur, all: true }));
  if (saved) E.spec = { ...E.spec, ...saved, mutes: undefined, captions: { ...E.spec.captions, ...saved.captions, words: undefined } };
  const ads = saved ? 0 : cutAds(src.ads || []);
  E.base = JSON.parse(JSON.stringify(E.spec)); // como estaba al abrir: lo que difiera lo cambiaste tu (ver keepMine)
  build();
  loadMedia();
  if (ads) toast(`Quité ${Math.round(ads)} s de anuncio de Twitch. «Restaurar todo» en Recorte lo devuelve.`, 'good');
}
/** Quita del clip los tramos de anuncio de Twitch (en segundos de la grabacion). Devuelve cuantos segundos quito. */
function cutAds(spans) {
  let segs = [{ a: 0, b: E.dur }];
  for (const [x, y] of spans) {
    const a = x - E.start, b = y - E.start;
    if (b <= 0 || a >= E.dur) continue;
    segs = segs.flatMap((s) => (b <= s.a || a >= s.b ? [s] : [{ a: s.a, b: Math.max(s.a, a) }, { a: Math.min(s.b, b), b: s.b }])).filter((s) => s.b - s.a >= 0.5);
  }
  const kept = segs.reduce((n, s) => n + s.b - s.a, 0);
  if (!segs.length || E.dur - kept < 0.5) return 0;
  E.spec.segments = segs;
  return E.dur - kept;
}

/**
 * Tramo de la vista previa: desde el inicio del momento (asi se ve en cuanto empieza a generarse) hasta su final con
 * margen, redondeado a 20 s. Recortar el inicio hacia delante o mover el fin reutiliza el mismo archivo: es instantaneo.
 */
export const pvWindow = (start, end, total) => ({ a: Math.max(0, start), b: Math.min(Math.max(total || 0, end), Math.ceil((end + 10) / 20) * 20) });
export const previewUrl = (sid, w) => `/api/preview?sid=${sid}&start=${w.a}&end=${w.b}`;

export function loadMedia() {
  const v = $('pv'), keep = E.pv && E.pv.a <= E.start && E.pv.b >= E.end && v.getAttribute('src');
  if (!keep) {
    E.pv = pvWindow(E.start, E.end, E.src.duration || E.src.analyzedTo);
    E.ready = false; E.pvRetry = false;
    $('pvHint').textContent = 'Preparando la vista previa…';
    const url = previewUrl(E.src.id, E.pv);
    // los fotogramas de la V1 esperan a la vista previa: si no, sus ffmpeg le quitan tiempo al abrir
    const ready = () => { E.ready = true; $('pvHint').textContent = ''; if (!E.filmOn) { E.filmOn = true; renderTl(); findScenes(); } };
    v.src = url;
    // Empieza en el primer tramo que se ve (si se quito el principio, por ejemplo un anuncio).
    v.onloadeddata = () => { ready(); seek(segs()[0]?.a || 0); };
    // Mientras se genera llega al vuelo y no se puede saltar en ella; al terminar se cambia, sin cortes, al archivo completo.
    // Si ya estaba generada se puede saltar desde el principio y no hace falta cambiar nada.
    api(url.replace('/api/preview', '/api/preview-ready')).then(() => {
      const swap = () => {
        if (v.getAttribute('src') !== url || (v.seekable.length && v.seekable.end(0) > 0)) return;
        const t = v.currentTime, playing = !v.paused;
        v.onloadeddata = () => { ready(); v.currentTime = t; if (playing) v.play().catch(() => {}); };
        v.src = url + '&full=1';
      };
      if (v.readyState >= 1) swap(); else v.addEventListener('loadedmetadata', swap, { once: true });
    }).catch(() => {});
  }
  // Segundo 0 del clip dentro del archivo de la vista previa.
  E.off = E.start - E.pv.a;
  if (keep && E.ready) seek(0);
  // Mientras se genera, la vista previa llega al vuelo y esa descarga puede cortarse: se reintenta una vez con el archivo
  // terminado, y solo se avisa si de verdad no hay nada que ver.
  v.onerror = () => {
    const u = (v.getAttribute('src') || '').replace('&full=1', ''), fail = () => ($('pvHint').textContent = 'No se pudo generar la vista previa.');
    if (E.pvRetry || !u) return v.readyState >= 2 ? undefined : fail();
    E.pvRetry = true;
    const t = v.currentTime, playing = !v.paused;
    api(u.replace('/api/preview', '/api/preview-ready')).then(() => {
      v.onloadeddata = () => { E.ready = true; $('pvHint').textContent = ''; v.currentTime = t; if (playing) v.play().catch(() => {}); };
      v.src = u + '&full=1';
    }).catch(fail);
  };
  api(`/api/wave?sid=${E.src.id}&start=${E.start}&end=${E.end}`).then((w) => { E.wave = w; renderTl(); }).catch(() => {});
  E.wordsState = 'cargando';
  renderPanel();
  api('/api/words', { sid: E.src.id, start: E.start, end: E.end }).then((r) => { E.spec.captions.words = r.words; E.wordsState = 'ok'; renderPanel(); renderTl(); })
    .catch((e) => { E.wordsState = 'error'; E.wordsError = e.message; renderPanel(); });
  cancelAnimationFrame(raf);
  setRaf(requestAnimationFrame(loop));
  // Quien habla depende del tramo: se calcula de nuevo para el tramo nuevo.
  E.faces = null; E.facesState = '';
  if (E.spec.follow && CAMLAYS.includes(E.spec.layout)) detectCams(true);
}

function build() {
  $('v-editor').innerHTML = `
<header class="ehead">
      <div class="cap fix" style="padding-right:18px"><button class="icon fix" data-e="back" aria-label="Volver a los momentos" title="Volver a los momentos">${icon('backarrow')}</button>
        <div><div style="font-weight:600;font-size:13px">Momento ${fmt(E.start)}</div><div class="mut" style="font-size:11px">${esc(E.src.streamer || E.src.name)} · la plantilla se guarda sola</div></div></div>
      <span class="row ehsel" id="tlSel" aria-live="polite"></span>
      <div class="cap fix"><button class="icon fix" data-e="undo" aria-label="Deshacer" title="Deshacer (Ctrl+Z)">${icon('undo')}</button><button class="icon fix" data-e="redo" aria-label="Rehacer" title="Rehacer (Ctrl+Mayús+Z)">${icon('redo')}</button>
        <button class="icon fix" data-e="edtour" aria-label="Recorrido por el editor" title="Recorrido por el editor">${icon('help')}</button></div>
      <div class="seg fix emode" role="group" aria-label="Modo del editor"><button data-e="mode" data-k="rapido" title="Solo la vista previa y los ajustes: lo justo para retocar">Rápido</button><button data-e="mode" data-k="completo" title="Con la biblioteca de textos, stickers, sonidos, transiciones y efectos">Completo</button></div>
    </header>
    <div class="ebody">
      <aside class="elib" id="elib" aria-label="Biblioteca"></aside>
      <section class="estage" aria-label="Vista previa">
        <div class="vhead"><b>Vista previa</b><span class="mut">1080 × 1920</span><span class="mono mut" id="tlInfo"></span></div>
        <div class="float" id="efloat"></div>
        <div class="stagebox"><div class="glow" aria-hidden="true"></div><div class="phone" id="phone"><canvas id="cv" width="${CW}" height="${CH}"></canvas><div id="ov"></div><div id="guides" aria-hidden="true"></div><div id="selbox" hidden></div></div><div id="selbar" class="selbar" role="toolbar" aria-label="Acciones de lo seleccionado" hidden></div></div>
        <video id="pv" playsinline preload="auto" style="display:none"></video>
        <div class="glass transport"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="mono fix" id="clock" style="min-width:96px"></span>
          <button class="icon fix sm" data-e="seek" data-d="-5" aria-label="Retroceder 5 segundos">−5</button><button class="fix" data-e="play" id="playBtn" aria-label="Reproducir o pausar">${icon('play')}</button><button class="icon fix sm" data-e="seek" data-d="5" aria-label="Avanzar 5 segundos">+5</button><button class="icon fix sm" data-e="fullscreen" title="Pantalla completa (F)" aria-label="Pantalla completa">${icon('expand')}</button></div>
        <div class="mut" id="pvHint"></div>
        <div id="pvExport" class="pvexport" aria-live="polite"></div>
      </section>
      <aside class="einsp" aria-label="Inspector"><div class="ihead" id="etabs"></div><div class="epanel" id="epanel"></div></aside>
    </div>
    <div class="esplit" id="esplit" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Tamaño de la vista previa y de la línea de tiempo" title="Arrastra para agrandar la vista previa o la línea de tiempo (doble clic: como al principio)"></div>
    <section class="etl" aria-label="Línea de tiempo del clip">
      <div class="tlbar">
        <nav class="efn" id="efn" aria-label="Herramientas del clip">${FN_TOOLS.map((k) => `<button class="fnb" data-e="tool" data-k="${k}" aria-pressed="false" title="${esc(INTRO[k] || '')}">${ticon(k)}<span>${esc(TOOLS.find(([t]) => t === k)[1])}</span></button>`).join('')}</nav>
        <span class="tsep" aria-hidden="true"></span>
        <button class="fix sm" data-e="split">${icon('recorte')}Cortar <span class="mono mut" style="font-size:11px;border:1px solid var(--line2);border-radius:5px;padding:0 4px">S</span></button><button class="fix sm" data-e="delseg">Quitar tramo</button><button class="fix sm" data-e="addmarker" title="Marcador en el cursor (M). Ctrl+← y Ctrl+→ saltan entre marcadores">${icon('flag')}Marcador <span class="mono mut" style="font-size:11px;border:1px solid var(--line2);border-radius:5px;padding:0 4px">M</span></button>
        <span class="menuwrap fix"><button class="fix sm" data-e="sugmenu" aria-haspopup="menu" aria-expanded="false" aria-controls="sugMenu">${icon('sparkle')}Sugerencias${icon('down', 'sm')}</button>
          <span class="menu" id="sugMenu" role="menu" hidden><button role="menuitem" data-e="silences">Quitar silencios</button><button role="menuitem" data-e="zoompeak">Zoom en la reacción</button><button role="menuitem" data-e="replayhere">Repetir a cámara lenta (lo del cursor)</button>${[15, 20, 30, 45, 60].filter((t) => E.end - E.start > t + 5).slice(-3).map((t) => `<button role="menuitem" data-e="condense" data-k="${t}">Condensar a ${t} s</button>`).join('')}</span></span>
        <span class="row fix tlctl" role="group" aria-label="Vista de la línea de tiempo" style="margin-left:auto;gap:4px">
          <button class="sm icon fix ${E.magnet ? 'on' : ''}" data-e="magnet" aria-pressed="${E.magnet}" title="Imán: los bordes se ajustan al cursor, a los cortes y a otros bloques. Mantén Alt para moverlos libremente." aria-label="Imán">${icon('magnet')}</button>
          <button class="sm icon fix ${pref('skim', true) ? 'on' : ''}" data-e="skim" aria-pressed="${pref('skim', true)}" title="Ver al pasar el ratón: el visor enseña el fotograma bajo el ratón sin mover el cursor" aria-label="Ver al pasar el ratón">${icon('eye')}</button>
          <button class="sm fix ${pref('tlGaps', false) ? 'on' : ''}" data-e="tlgaps" aria-pressed="${pref('tlGaps', false)}" title="Ver también lo quitado, en el tiempo original (para recuperarlo). Sin marcar, la línea de tiempo es magnética: enseña el vídeo final sin huecos">Ver lo quitado</button>
          <button class="sm icon fix" data-e="tall" aria-pressed="false" title="Pistas más altas" aria-label="Pistas más altas">${icon('height')}</button>
          <button class="sm icon fix" data-e="tlzoom" data-k="0.8" title="Alejar (Ctrl + rueda)" aria-label="Alejar la línea de tiempo">−</button>
          <span class="mono mut" id="tlZoomV" style="min-width:34px;text-align:center">×1</span>
          <button class="sm icon fix" data-e="tlzoom" data-k="1.25" title="Acercar (Ctrl + rueda)" aria-label="Acercar la línea de tiempo">+</button>
          <button class="sm fix ghost" data-e="tlfit" title="Ver el clip entero">Ajustar</button>
        </span>
        ${helpBtn('tiempo')}
        <button class="fix" data-e="autoedit" title="Encuadre, silencios, gancho, efectos, subtítulos, título y hashtags de un clic">${icon('sparkle')}Auto edición</button>
        <button class="pri fix" data-e="export">${icon('publicar')}Exportar</button>
      </div>
      <div id="tlScroll" style="overflow-x:auto"><div class="tracks" id="tracks"></div></div>
    </section>`;
  setMode(pref('edMode', 'completo'));
  splitter();
  renderLib(); renderTabs(); renderPanel(); renderTl(); renderSum();
  setTimeout(() => tourHere(false), 900); // solo la primera vez
}

export function editorEmpty() {
  if (!E) $('v-editor').innerHTML = `<div class="view"><div class="card" style="max-width:560px"><h2>Editor</h2><p class="mut" style="font-size:14px">Abre un momento desde «En vivo» con el botón <b>Editar</b> y aparecerá aquí con su vista previa y su línea de tiempo.</p><button class="pri" data-view="live">Ir a En vivo</button></div></div>`;
}
