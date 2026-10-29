/** Revisar la auto edicion: cada propuesta se acepta o se descarta. */
import { cutFillers } from '/web/cuts.js';
import { $, esc, fmt, ranges, S, segs as segThumbs, signals } from '/web/app.js';
import { kindOf } from '/web/prefs.js';
import { icon } from '/web/icons.js';
import { VOICES } from '/web/voices.js';
import { helpBtn } from '/web/help.js';
import { censored, isCen } from './censor.js';
import { elementPanel, isCanvasSel } from './direct.js';
import { CAMLAYS, camList, faceThumb, finalDur, ONE_CAM, sceneAt, sceneCamIdx, sceneCams, segs, selScene, selSeg } from './geometry.js';
import { camsPanel, num } from './library.js';
import { badge, renderTabs } from './panels.js';
import { pkey } from './playback.js';
import { segPanel } from './segments.js';
import { assetsCache, E, GROUPS, ICON, isKeyword, LAYOUTS, PRESETS, SFX_NAMES, STYLE_PRESETS, uid, ZC } from './state.js';
import { foundHtml, inVideo, wordCls, wordRange } from './textedit.js';
import { pref, renderTl } from './timeline.js';
import { transInfo, transPanel } from './transitions.js';

// ---------- revisar la auto edicion: cada propuesta se acepta o se descarta ----------
export const LAY_NAME = { split: 'Cámara + juego', half: 'Mitad y mitad', pip: 'Cámara redonda', fit: 'Completo', crop: 'Pantalla llena', cam: 'Solo cámara', duo: 'Varias cámaras', float: 'Cámaras flotantes', grid: 'Cuadrícula' };
const RV_GROUPS = ['Encuadre', 'Cortes', 'Inicio', 'Efectos', 'Sonido', 'Stickers', 'Subtítulos', 'Texto', 'Acabado'];
/**
 * Convierte los cambios de la auto edicion en propuestas sueltas. La transcripcion no es una propuesta: va siempre.
 * Los zooms, golpes, sonidos y stickers propuestos sustituyen a los que habia (como al aplicarla directamente).
 */
export function reviewParts(before, p, captions, fillers = []) {
  const L = [], fresh = (x) => ({ ...x, id: uid() });
  const add = (group, label, apply, t, kind) => L.push({ id: 'rv' + L.length, group, label, apply, t, kind, on: true });
  const camKeys = ['layout', 'cams', 'cam', 'follow', 'camTrack', 'game', 'scenes', 'cropX', 'reframe'];
  if (camKeys.some((k) => p[k] !== undefined)) add('Encuadre', (LAY_NAME[p.layout || before.layout] || 'Encuadre') + (p.follow ? ' · sigue a quien habla' : '') + (p.reframe?.length ? ' · sigue a la persona' : '') + (p.scenes?.length ? ` · ${p.scenes.length} parte${p.scenes.length > 1 ? 's' : ''} con otro encuadre (${p.scenes.map((x) => LAY_NAME[x.layout]).join(', ')})` : ''), (s) => camKeys.forEach((k) => { if (p[k] !== undefined) s[k] = p[k]; }), undefined, 'encuadre');
  if (p.segments) add('Cortes', `Quitar silencios (${Math.max(1, p.segments.length - 1)} cortes)`, (s) => (s.segments = p.segments), undefined, 'silencios');
  // Muletillas y repeticiones: despues de los silencios (si se quitan los silencios, se cortan sobre lo que queda).
  if (fillers.length) {
    const m = fillers.filter((f) => f.kind === 'muletilla').length, r = fillers.length - m;
    add('Cortes', 'Quitar ' + [m ? `${m} muletilla${m > 1 ? 's' : ''}` : '', r ? `${r} repetici${r > 1 ? 'ones' : 'ón'}` : ''].filter(Boolean).join(' y ') + ' (' + fillers.slice(0, 3).map((f) => '«' + f.text + '»').join(', ') + (fillers.length > 3 ? '…' : '') + ')', (s) => (s.segments = cutFillers(s.segments?.length ? s.segments : [{ a: 0, b: E.dur }], fillers).segments), fillers[0].a, 'muletillas');
  }
  if (p.hook) add('Inicio', p.hookSeg ? `Gancho elegido por el agente (${fmt(p.hookSeg.a)}, en ámbar en la línea de tiempo)` : 'Gancho: empezar con lo más intenso (en ámbar en la línea de tiempo)', (s) => { s.hook = true; s.hookSeg = p.hookSeg || null; }, p.hookSeg?.a, 'gancho');
  if (p.transition) add(p.transAt?.length ? 'Encuadre' : 'Inicio', `${p.transAt?.length ? 'Transición en los cambios de escena' : 'Transición del gancho'}: ${transInfo(p.transition)?.name || p.transition}`, (s) => Object.assign(s, { transition: p.transition, transDur: p.transDur || 0.4, transCuts: !!p.transCuts, ...(p.transAt ? { transAt: p.transAt } : {}) }), undefined, kindOf.transition(p.transition));
  for (const k of ['zooms', 'punches', 'sfx', 'stickers']) if (p[k]) for (const x of p[k]) {
    const it = fresh(x), t = k === 'sfx' ? x.t : x.a;
    const label = (k === 'zooms' ? `Zoom ×${x.scale.toFixed(2)}` : k === 'punches' ? 'Golpe de reacción' : k === 'sfx' ? `Sonido: ${SFX_NAMES[x.file.replace(/\.\w+$/, '')] || x.file}` : `Sticker «${x.file.replace('.png', '')}»`) + (x.why ? ` · ${x.why}` : '');
    const kind = k === 'zooms' ? kindOf.zoom(x.scale) : k === 'punches' ? 'golpe' : k === 'sfx' ? kindOf.sfx(x.file) : 'sticker';
    add(k === 'sfx' ? 'Sonido' : k === 'stickers' ? 'Stickers' : 'Efectos', label, (s) => (s[k] = [...(s[k] || []), it]), t, kind);
  }
  if (captions) {
    const { words, on, ...look } = captions;
    if (Object.keys(look).length) add('Subtítulos', `Estilo ${S.styles[look.style]?.name || look.style || ''}${look.anim === 'pop' ? ', con rebote' : ''}${look.perChunk ? `, ${look.perChunk} palabra${look.perChunk > 1 ? 's' : ''} por bloque` : ''}`, (s) => (s.captions = { ...s.captions, ...look }), undefined, look.style ? kindOf.captions(look.style) : undefined);
  }
  if (p.title) add('Texto', `Título: «${p.title}»`, (s) => { s.title = p.title; if (p.description) s.description = p.description; }, undefined, 'titulo');
  if (p.titleFor) add('Texto', `Título como gancho en caja los primeros ${p.titleFor} s (como OpusClip)`, (s) => { Object.assign(s, { titleStyle: p.titleStyle, titleFor: p.titleFor }); if (p.titleY != null) s.titleY = p.titleY; }, undefined, 'titulo-gancho');
  if (p.brand?.on) add('Acabado', `Marco del canal con «${p.brand.text}» arriba y abajo`, (s) => (s.brand = { ...p.brand }), undefined, 'marco');
  if (p.replay) add('Acabado', `Repetición a cámara lenta al final (${fmt(p.replay.a)}–${fmt(p.replay.b)})`, (s) => (s.replay = { ...p.replay }), p.replay.a, 'repeticion');
  if (p.color) add('Acabado', `Luz y color corregidos (brillo ${p.color.brightness >= 0 ? '+' : ''}${Math.round(p.color.brightness * 100)}, contraste ${Math.round(p.color.contrast * 100)} %, color ${Math.round(p.color.saturation * 100)} %)`, (s) => (s.color = { ...p.color }), undefined, 'luz');
  if (p.fadeOut !== undefined && p.fadeOut !== before.fadeOut) add('Acabado', `Desvanecido al final (${String(p.fadeOut).replace('.', ',')} s)`, (s) => (s.fadeOut = p.fadeOut), undefined, 'final');
  if (p.progress !== undefined && p.progress !== before.progress) add('Acabado', p.progress ? 'Barra de progreso arriba' : 'Sin barra de progreso', (s) => (s.progress = p.progress), undefined, 'barra');
  if (p.flash !== undefined && p.flash !== before.flash) add('Acabado', p.flash ? 'Destello en los cambios de cámara' : 'Sin destellos en los cambios de cámara', (s) => (s.flash = p.flash), undefined, 'destello');
  // Lo que se sustituye: la base parte sin esos elementos, y la transcripcion nueva va siempre.
  L.base = (s) => {
    for (const k of ['zooms', 'punches', 'sfx', 'stickers']) if (p[k]) s[k] = [];
    if (captions?.words) s.captions = { ...s.captions, words: captions.words, on: captions.on ?? true };
  };
  return L;
}
/** Los trozos de A que tambien estan en B (con la velocidad y demas de A). */
const andSegs = (A, B) => A.flatMap((x) => B.map((y) => ({ ...x, a: Math.max(x.a, y.a), b: Math.min(x.b, y.b) }))).filter((s) => s.b - s.a >= 0.3);
/**
 * Lo que cambiaste a mano desde que abriste el clip (lo que difiere de E.base) no lo pisa la auto edicion: tus cortes
 * se quedan (los silencios se quitan solo dentro de ellos), y tu encuadre, titulo, color, estilo de subtitulos… tambien.
 * Zooms, golpes, sonidos y stickers se suman a los tuyos. Devuelve si respeto algo.
 * shortcut: lo que puso una auto edicion anterior tambien cuenta como tuyo; si se quiere rehacer, Ctrl+Z antes.
 */
export function keepMine(before, p, captions) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null), mine = (k) => !same(before[k], E.base[k]);
  const cam = ['layout', 'cams', 'cam', 'follow', 'camTrack', 'game', 'scenes', 'cropX', 'reframe'];
  let kept = false;
  if (cam.some(mine)) { for (const k of cam) if (k in p) { delete p[k]; kept = true; } }
  for (const k of Object.keys(p)) if (!['segments', 'zooms', 'punches', 'sfx', 'stickers', ...cam].includes(k) && mine(k)) { delete p[k]; kept = true; }
  if (p.segments && before.segments?.length && mine('segments')) { p.segments = andSegs(before.segments, p.segments); kept = true; }
  if (captions) for (const k of Object.keys(captions)) if (k !== 'words' && k !== 'on' && !same(before.captions?.[k], E.base.captions?.[k])) { delete captions[k]; kept = true; }
  return kept;
}
export function applyParts(before, parts) {
  const s = JSON.parse(JSON.stringify(before));
  parts.base?.(s);
  for (const x of parts) if (x.on) x.apply(s);
  return s;
}
export function rebuildReview() {
  E.spec = applyParts(E.review.before, E.review.parts);
  renderTabs(); renderPanel(); renderTl(); renderSum();
  E.ovSig = E.capSig = ''; E.force = true;
}
function reviewPanel() {
  const parts = E.review.parts, n = parts.filter((x) => x.on).length;
  const row = (x) => `<div class="rvrow"><label class="c rvc"><input type="checkbox" data-rv="${x.id}" ${x.on ? 'checked' : ''} /> <span>${esc(x.label)}</span></label>${x.t != null ? `<button class="sm ghost fix mono rvt" data-e="rvgo" data-k="${x.t}" title="Ver este momento">${fmt(x.t)}</button>` : '<span class="rvt" aria-hidden="true"></span>'}</div>`;
  return `<h2>Revisar la auto edición</h2>
    <div class="mut" style="margin:6px 0 10px">Ya ves el resultado en la vista previa. Desmarca lo que no quieras y se quita al momento.</div>
    ${E.review.done?.length ? `<details class="cmore rvdone"><summary>Qué hizo</summary><div class="mut">${esc(E.review.done.join(', '))}.</div></details>` : ''}
    ${E.review.style ? `<div class="rvstyle"><b>Estilo aprendido de ${esc(E.review.style.from)}</b><span>Planos de ${E.review.style.shotMed} s · ${E.review.style.zoomsPerMin} zooms/min · ${Math.round(E.review.style.transRatio * 100)} % transiciones${E.review.style.zoomScale >= 1.8 ? ' · zooms de golpe' : ''}</span></div>` : `<div class="rvstyle"><b>Estilo por defecto</b><span>Pon clips que te gusten en la carpeta videos-referencia y la auto edición imitará su ritmo.</span></div>`}
    ${E.review.agent ? `<div class="rvstyle"><b>Plan del agente editor</b>${E.review.agent.hook ? `<span>Gancho: ${esc(E.review.agent.hook)}</span>` : ''}${E.review.agent.drops.map((d) => `<span>Quita ${fmt(d.a)}–${fmt(d.b)}: ${esc(d.why)}</span>`).join('')}${!E.review.agent.hook && !E.review.agent.drops.length ? '<span>Ha elegido los momentos a remarcar.</span>' : ''}</div>` : ''}
    ${E.review.learned?.length ? `<div class="rvstyle"><b>Aprendido de tus revisiones</b><span>${E.review.learned.map((x) => esc(x[0].toUpperCase() + x.slice(1))).join('. ')}.</span><button class="sm ghost fix" data-e="rvforget" style="align-self:flex-start;margin-top:4px">Olvidar lo aprendido</button></div>` : ''}
    ${E.review.variants?.length > 1 ? `<h3 style="margin-top:4px">Propuestas</h3><div class="chips rvvars" role="group" aria-label="Propuestas de edición">${E.review.variants.map((v, i) => `<button class="sm ${i === E.review.vi ? 'on' : ''}" data-e="rvvar" data-k="${i}" aria-pressed="${i === E.review.vi}">${esc(v.name)} <span class="mut">${v.parts.filter((x) => ['Efectos', 'Sonido'].includes(x.group)).length}</span></button>`).join('')}</div><div class="mut" style="margin:4px 0 10px">El número es cuántos efectos y sonidos lleva cada una. Cambia y mira la vista previa.</div>` : ''}
    <div class="row" style="gap:6px;margin-bottom:6px"><button class="sm fix" data-e="rvall" data-k="1">Marcar todo</button><button class="sm fix" data-e="rvall" data-k="0">Desmarcar todo</button></div>
    ${RV_GROUPS.filter((g) => parts.some((x) => x.group === g)).map((g) => `<h3 style="margin-top:12px">${g}</h3>${parts.filter((x) => x.group === g).map(row).join('')}`).join('')}
    <div class="rvbar"><button class="pri" data-e="rvok">${n ? `Aplicar ${n} cambio${n > 1 ? 's' : ''}` : 'Aplicar sin cambios'}</button><button class="ghost" data-e="rvno">Descartar</button></div>
    <label class="c" style="margin-top:10px"><input type="checkbox" data-e="rvpref" ${pref('autoReview', true) ? 'checked' : ''} /> Revisar siempre antes de aplicar</label>
    <div class="mut">Desmárcalo para que «Auto edición» aplique los cambios directamente.</div>`;
}
document.addEventListener('change', (e) => {
  const id = e.target.dataset?.rv;
  if (!id || !E?.review) return;
  const x = E.review.parts.find((p) => p.id === id);
  if (x) { x.on = e.target.checked; rebuildReview(); }
});

/** Para que sirve cada herramienta, en una frase que entienda cualquiera. */
export const INTRO = {
  recorte: 'Elige qué partes del momento se quedan. Lo que quitas no sale en el vídeo.',
  encuadre: 'Cómo se coloca la imagen en el vídeo vertical: la cámara, el juego o los dos.',
  subs: 'El texto de lo que se dice, palabra a palabra, como en TikTok.',
  texto: 'Títulos y textos encima del vídeo.',
  stickers: 'Dibujos y emojis encima del vídeo.',
  sonido: 'Efectos de sonido, música de fondo y efectos de voz.',
  zoom: 'Acerca la imagen en los momentos fuertes para darles fuerza.',
  trans: 'Cómo se pasa de un trozo a otro.',
  lento: 'Repite al final, despacio, el mejor momento, como en las repeticiones del deporte.',
  imagen: 'Luz, color, velocidad y acabado del vídeo.',
  censura: 'Tapa palabrotas, nombres o partes de la imagen.',
  publicar: 'Título, descripción y subida a tus redes.',
};
export function renderPanel() {
  if (!E || !$('epanel')) return;
  const sp = E.spec, c = sp.captions, A = assetsCache;
  let h = '';
  if (E.review) h = reviewPanel();
  else if (isCanvasSel()) h = elementPanel();
  else if (E.tool === 'clip') h = clipPanel();
  else if (E.tool === 'recorte') {
    h = `<h2>Recorte</h2>
      <div class="row" style="margin-top:10px"><label class="f" style="margin:0">Inicio<div class="row"><button class="sm fix" data-e="range" data-k="start" data-d="-5">−5</button><button class="sm fix" data-e="range" data-k="start" data-d="-1">−1</button><b class="mono">${fmt(E.start)}</b><button class="sm fix" data-e="range" data-k="start" data-d="1">+1</button><button class="sm fix" data-e="range" data-k="start" data-d="5">+5</button></div></label></div>
      <div class="row"><label class="f">Fin<div class="row"><button class="sm fix" data-e="range" data-k="end" data-d="-5">−5</button><button class="sm fix" data-e="range" data-k="end" data-d="-1">−1</button><b class="mono">${fmt(E.end)}</b><button class="sm fix" data-e="range" data-k="end" data-d="1">+1</button><button class="sm fix" data-e="range" data-k="end" data-d="5">+5</button></div></label></div>
      <div class="mut" style="margin-top:8px">Cambiar el inicio o el fin recarga la vista previa y los subtítulos.</div>
      <h3 style="margin-top:16px">Cortes dentro del clip</h3>
      <div class="row wrap"><button class="fix" data-e="split">Cortar en el cursor</button><button class="fix" data-e="delseg">Quitar el tramo del cursor</button><button class="fix" data-e="freezehere" title="Congela la imagen del cursor 2 segundos y luego sigue">Congelar aquí</button></div>
      <div class="row wrap" style="margin-top:8px"><button class="fix" data-e="silences">Quitar silencios</button><button class="fix ghost" data-e="resetseg">Restaurar todo</button></div>
      ${[15, 20, 30, 45, 60].some((t) => E.end - E.start > t + 5) ? `<h3 style="margin-top:16px">${icon('sparkle', 'sm')} Hacerlo más corto</h3>
      <div class="mut" style="margin-bottom:6px">Se queda con lo mejor (y lo que lo prepara) hasta la duración que elijas.</div>
      <div class="chips">${[15, 20, 30, 45, 60].filter((t) => E.end - E.start > t + 5).slice(-3).map((t) => `<button class="sm" data-e="condense" data-k="${t}">${t} s</button>`).join('')}</div>` : ''}
      ${segPanel()}
      <label class="c" style="margin-top:14px"><input type="checkbox" data-i="hook" ${sp.hook ? 'checked' : ''} /> Gancho: empezar con los 3 segundos más intensos</label>
      <div class="mut">Duración final: ${fmt(finalDur())} (${segs().length} tramo${segs().length > 1 ? 's' : ''}).</div>`;
  } else if (E.tool === 'encuadre') {
    const zones = CAMLAYS.includes(sp.layout);
    h = `<h2>Encuadre</h2>
      <div class="layinfo">${(() => { const [, n, m] = LAYOUTS.find(([k]) => k === sp.layout) || LAYOUTS[0]; return `<span class="mini" aria-hidden="true"><i style="left:${m[0]}%;top:${m[1]}%;width:${m[2]}%;height:${m[3]}%;border-radius:${m[4] || 0}%"></i></span><span><b>${n}</b><br><span class="mut">Cámbialo en la barra de encima de la vista previa.</span></span>`; })()}</div>
      ${zones ? `${camsPanel()}<h3 style="margin-top:16px">Zonas del video original</h3>${zoneThumb('cam')}
        <div class="row wrap" style="margin-top:8px"><button class="pri fix" data-e="openpick" data-k="cam">Dibujar zonas en grande</button></div>
        <div class="mut" style="margin-top:6px">Se abre el fotograma a pantalla completa para marcar la cámara${sp.layout !== 'cam' ? ' y el juego' : ''} con precisión.</div>` : `<div class="mut" style="margin-top:12px">Este encuadre usa la imagen entera. Para tapar el chat o un nombre, ve a «Censura».</div>${sp.layout === 'fit' ? `<label class="f">Fondo<select data-i="fitBg"><option value="blur" ${sp.fitBg !== 'negro' ? 'selected' : ''}>El propio video, difuminado</option><option value="negro" ${sp.fitBg === 'negro' ? 'selected' : ''}>Negro</option></select></label>` : ''}`}
      ${sp.layout === 'pip' ? `<label class="f">Posición de la cámara<select data-i="pipPos"><option value="tr">Arriba a la derecha</option><option value="tl">Arriba a la izquierda</option><option value="br">Abajo a la derecha</option><option value="bl">Abajo a la izquierda</option></select></label>` : ''}
      ${sp.layout === 'crop' ? `${num('cropX', 'Posición horizontal del recorte', sp.cropX * 100, 0, 100)}<div class="row wrap" style="margin-top:10px"><button class="fix" data-e="facetrack">Seguir la cara</button>${sp.reframe ? `<button class="fix ghost" data-e="untrack">Quitar seguimiento</button>` : ''}</div><div class="mut" style="margin-top:6px">${sp.reframe ? `El recorte sigue la cara en ${sp.reframe.length} puntos del clip.` : 'Busca la cara a lo largo del clip y mueve el recorte para que no se salga.'}</div>` : ''}
      <h3 style="margin-top:18px">Marco del canal</h3><label class="c"><input type="checkbox" data-i="brand.on" ${sp.brand?.on ? 'checked' : ''} /> Franjas arriba y abajo con tu nombre repetido</label>${sp.brand?.on ? `<label class="f" style="margin-top:6px">Texto<input type="text" data-i="brand.text" maxlength="24" value="${esc(sp.brand.text || '')}" /></label>` : ''}<div class="mut" style="margin-top:4px">Como los canales de clips: hace que el vídeo sea tuyo y no una copia del de otros.</div>
      <h3 style="margin-top:18px">Estilos rápidos</h3><div class="mut" style="margin-bottom:6px">Encuadre, subtítulos y efectos de un clic, sacados de clips que funcionan.</div><div class="chips">${Object.entries(STYLE_PRESETS).map(([k, [n]]) => `<button class="sm" data-e="stylepreset" data-k="${k}">${n}</button>`).join('')}</div>`;
  } else if (E.tool === 'lento') {
    const r = sp.replay, SPEEDS = [[0.3, 'Muy lenta'], [0.5, 'Lenta'], [0.7, 'Un poco lenta']];
    h = `<h2>Cámara lenta</h2>
      ${r ? `<div class="rvstyle"><b>Se repite ${fmt(r.a)}–${fmt(r.b)} al final</b><span>Añade ${fmt((r.b - r.a) / (r.speed || 0.5))} al vídeo</span></div>
        <h3 style="margin-top:12px">Velocidad</h3><div class="chips">${SPEEDS.map(([v, n]) => `<button class="sm ${Math.abs((r.speed || 0.5) - v) < 0.01 ? 'on' : ''}" data-e="replayspeed" data-k="${v}" aria-pressed="${Math.abs((r.speed || 0.5) - v) < 0.01}">${n}</button>`).join('')}</div>
        <div class="row wrap" style="margin-top:12px"><button class="fix" data-e="replayhere">${icon('slow')}Usar lo del cursor</button><button class="fix ghost" data-e="noreplay">Quitar</button></div>`
      : `<div class="row wrap" style="margin-top:6px"><button class="pri fix" data-e="replayhere">${icon('slow')}Repetir lo del cursor a cámara lenta</button></div>
        <div class="mut" style="margin-top:8px">Pon el cursor en el remate o el grito y pulsa: se repiten 2,5 segundos alrededor.</div>`}
      <div class="mut" style="margin-top:14px">¿Voz de monstruo en la repetición? En «Sonido» elige un efecto de voz y marca «Solo en la repetición».</div>`;
  } else if (E.tool === 'imagen') {
    const col = sp.color, same = (x) => Math.abs(x.brightness - col.brightness) < 0.005 && Math.abs(x.contrast - col.contrast) < 0.005 && Math.abs(x.saturation - col.saturation) < 0.005;
    h = `<h2>Imagen</h2><h3 style="margin-top:12px">Color</h3>
      <div class="row wrap" style="margin-bottom:8px"><button class="fix" data-e="autolook">${icon('sparkle')}Luz y color automáticos</button></div>
      <div class="chips">${Object.entries(PRESETS).map(([k, [n, v]]) => `<button class="sm ${same(v) ? 'on' : ''}" data-e="preset" data-k="${k}">${n}</button>`).join('')}</div>
      ${num('color.brightness', 'Brillo', Math.round(col.brightness * 100), -30, 30)}${num('color.contrast', 'Contraste', Math.round(col.contrast * 100), 60, 160)}${num('color.saturation', 'Saturación', Math.round(col.saturation * 100), 0, 200)}
      <h3 style="margin-top:18px">Velocidad</h3>
      <div class="chips">${[0.75, 1, 1.15, 1.25, 1.5].map((v) => `<button class="sm ${Math.abs((sp.speed || 1) - v) < 0.01 ? 'on' : ''}" data-e="speed" data-k="${v}">${v === 1 ? 'Normal' : '×' + v}</button>`).join('')}</div>
      <div class="mut" style="margin-top:6px">La voz conserva su tono. Duración final: ${fmt(finalDur())}.</div>
      <h3 style="margin-top:18px">Acabado</h3>
      <label class="c"><input type="checkbox" data-i="stabilize" ${sp.stabilize ? 'checked' : ''} /> Estabilizar: quitar temblores de cámara</label>
      <div class="mut" style="margin-bottom:8px">Para vídeos grabados a mano. Se aplica al exportar (la vista previa no lo muestra) y la exportación tarda bastante más: casi el doble de lo que dura el clip.</div>
      <label class="c"><input type="checkbox" data-i="vary" ${sp.vary ? 'checked' : ''} /> Variación: espejo, zoom 2 %, un poco más rápido y color +2 %</label>
      <div class="mut" style="margin-bottom:8px">La voz conserva su tono y las groserías se tapan en los subtítulos (m*****), sin pitido. Se aplica al exportar.</div>
      <label class="c"><input type="checkbox" data-i="progress" ${sp.progress ? 'checked' : ''} /> Barra de progreso arriba</label>
      <label class="c"><input type="checkbox" data-i="flash" ${sp.flash ? 'checked' : ''} /> Destello en los cambios de cámara y en los golpes de reacción</label>
      <div class="row">${num('fadeIn', 'Fundido de entrada', Math.round((sp.fadeIn || 0) * 10), 0, 20)}${num('fadeOut', 'Fundido de salida', Math.round((sp.fadeOut || 0) * 10), 0, 20)}</div>
      <div class="mut" style="margin-top:6px">Los fundidos van de 0 a 2 segundos y solo se ven en el clip exportado.</div>`;
  } else if (E.tool === 'trans') {
    h = transPanel('insp');
  } else if (E.tool === 'censura') {
    const cz = sp.censor, found = censored(), w = (c.words || [])[E.selWord];
    h = `<h2>Censura</h2><label class="c" style="margin-top:8px"><input type="checkbox" data-i="censor.on" ${cz.on ? 'checked' : ''} /> Tapar groserías en este streamer</label>
      ${cz.on ? `<label class="f">Cómo se tapan en el audio<select data-i="censor.mode"><option value="pitido">Con un pitido</option><option value="silencio">En silencio</option></select></label>
        <label class="c" style="margin-top:8px"><input type="checkbox" data-i="censor.text" ${cz.text ? 'checked' : ''} /> Ocultarlas también en los subtítulos (m*****)</label>
        <label class="f">Otras palabras que quieres tapar, separadas por comas<input type="text" data-i="censor.extra" value="${esc(cz.extra)}" placeholder="ej. nombre, marca" /></label>
        <h3 style="margin-top:14px">En este clip</h3>
        ${E.wordsState === 'cargando' ? '<div class="mut">Transcribiendo para encontrarlas…</div>' : E.wordsState === 'error' ? '<div class="err">Sin transcripción no se pueden encontrar las groserías.</div>' : found.length ? `<div class="words">${found.map(({ w: x, i }) => `<button class="hi ${E.selWord === i ? 'now' : ''}" data-e="word" data-k="${i}">${esc(x.text)} <span class="mut mono">${fmt(x.startMs / 1000)}</span></button>`).join('')}</div>` : '<div class="mut">No encontré ninguna en la transcripción.</div>'}
        ${w ? `<div class="item sel"><span class="grow">«${esc(w.text)}»</span><button class="sm fix" data-e="wordcen">${isCen(w) ? 'No tapar esta' : 'Tapar esta'}</button></div>` : '<div class="mut" style="margin-top:6px">Para tapar una palabra que no está en la lista, selecciónala en «Subtítulos» y pulsa «Tapar».</div>'}`
        : '<div class="mut">Desactivado: el audio y los subtítulos salen tal cual.</div>'}
      <h3 style="margin-top:18px">Zonas difuminadas</h3>
      <div class="mut">Para tapar el chat, nombres o donaciones del video original.</div>
      <button class="pri" data-e="openpick" data-k="blur" style="width:100%;margin-top:8px">Dibujar zona a difuminar</button>
      ${sp.blurs.map((z, i) => `<div class="item"><span class="grow">Zona ${i + 1}<span class="mut"> · ${z.all ? 'todo el clip' : fmt(z.a) + '–' + fmt(z.b)}</span></span><label class="c fix mut"><input type="checkbox" data-e="blurall" data-id="${z.id}" ${z.all ? 'checked' : ''} /> siempre</label><button class="sm ghost icon fix" data-e="blurdel" data-id="${z.id}" aria-label="Quitar zona ${i + 1}">×</button></div>`).join('')}
      ${sp.blurs.length ? zoneThumb('blur') + '<div class="mut" style="margin-top:6px">Las zonas marcadas «siempre» se recuerdan para los próximos clips de este streamer.</div>' : ''}`;
  } else if (E.tool === 'subs') {
    const ws = c.words || [], w = ws[E.selWord];
    h = `<h2>Subtítulos</h2><label class="c" style="margin-top:6px"><input type="checkbox" data-i="cap.on" ${c.on ? 'checked' : ''} /> Mostrar subtítulos</label>
      <div class="mut" style="margin-top:6px">Estilo: <b>${esc(S.styles[c.style]?.name || c.style)}</b>. Elige otro en «Textos», a la izquierda.</div>
      <div class="row">${num('cap.size', 'Tamaño', c.size, 50, 200)}${num('cap.posY', c.smart !== false ? 'Altura preferida' : 'Altura', c.posY, 8, 92)}</div>
      <label class="c" style="margin-top:8px"><input type="checkbox" data-i="cap.smart" ${c.smart !== false ? 'checked' : ''} /> Apartar de las caras</label>
      <div class="mut">${c.smart !== false ? 'Cada frase se mueve lo justo para no tapar ninguna cara (también en los golpes de reacción) y vuelve a su altura en cuanto puede.' : 'Los subtítulos se quedan siempre a la misma altura.'}</div>
      <label class="f">Zona segura<select data-i="cap.safe" aria-label="Zona segura de los subtítulos">${[['todas', 'Todas las apps'], ['tiktok', 'TikTok'], ['shorts', 'YouTube Shorts'], ['reels', 'Instagram Reels'], ['ninguna', 'Sin zona segura']].map(([k, n]) => `<option value="${k}" ${(c.safe || 'todas') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="row"><label class="f">Palabras por bloque<select data-i="cap.perChunk">${[1, 2, 3, 4, 5].map((n) => `<option ${c.perChunk === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">Animación<select data-i="cap.anim"><option value="resaltar">Resaltar palabra</option><option value="pop">Resaltar con rebote</option><option value="ninguna">Sin animación</option></select></label></div>
      <label class="c" style="margin-top:8px"><input type="checkbox" data-i="cap.keywords" ${c.keywords ? 'checked' : ''} /> Resaltar palabras clave en otro color</label>
      <div class="row" style="margin-top:10px"><span class="mut">Texto</span><button class="sm fix light" data-e="fixsubs" ${ws.length ? '' : 'disabled'}>${icon('sparkle')}Corregir ortografía</button><button class="sm fix" data-e="translate">Traducir</button></div>
      ${E.wordsState === 'cargando' ? '<div class="mut" style="margin-top:8px">Transcribiendo lo que se dice…</div>' : E.wordsState === 'error' ? `<div class="err" style="margin-top:8px">No hay transcripción: ${esc(E.wordsError || '')}</div><button class="sm" data-e="typewords" style="margin-top:6px">Escribir el texto a mano</button>`
        : `<input type="search" id="subQ" value="${esc(E.subQ || '')}" placeholder="Buscar en lo que se dice…" aria-label="Buscar en los subtítulos" style="margin-top:8px" autocomplete="off" />
        <div class="row wrap subqn" id="subQn" aria-live="polite">${foundHtml()}</div>
        <div class="words" id="wordList" style="margin-top:6px">${ws.map((x, i) => `<button class="${x.del ? 'del' : ''} ${(x.hi ?? (c.keywords && isKeyword(x.text))) ? 'hi' : ''} ${wordCls(i)}" data-e="word" data-k="${i}" ${E.fixed?.has(i) ? 'data-fx title="Corregida"' : ''}>${esc(x.text)}</button>`).join('') || '<span class="mut">No se detectó voz en este tramo.</span>'}</div>
        ${w && E.selTo != null && E.selTo !== E.selWord ? (() => { const [i0, i1] = wordRange(), gone = ws.slice(i0, i1 + 1).every((x) => !inVideo(x)); return `<div class="item sel" style="flex-wrap:wrap"><span class="grow">«${esc(ws.slice(i0, i1 + 1).map((x) => x.text).join(' '))}» <span class="mut">(${i1 - i0 + 1} palabras)</span></span><button class="sm fix ${gone ? '' : 'pri'}" data-e="${gone ? 'wordrestore' : 'wordcut'}">${gone ? 'Recuperar en el vídeo' : 'Quitar del vídeo'}</button></div>`; })()
        : w ? `<div class="item sel" style="flex-wrap:wrap"><input type="text" data-i="word.text" value="${esc(w.text)}" aria-label="Corregir palabra" style="flex:1 1 120px" /><button class="sm fix" data-e="${inVideo(w) ? 'wordcut' : 'wordrestore'}" title="Corta del vídeo lo que dura esta palabra (imagen y sonido)">${inVideo(w) ? 'Quitar del vídeo' : 'Recuperar en el vídeo'}</button><button class="sm fix" data-e="wordhi">${w.hi ? 'Quitar resalte' : 'Resaltar'}</button><button class="sm fix" data-e="worddel" title="Solo deja de salir en el subtítulo; el vídeo no cambia">${w.del ? 'Mostrar en el subtítulo' : 'Ocultar del subtítulo'}</button><button class="sm fix" data-e="wordcen" title="Tapa esta palabra en el audio cuando la censura está activada">${isCen(w) ? 'No tapar' : 'Tapar'}</button></div>` : '<div class="mut" style="margin-top:6px">Toca una palabra para corregirla o quitarla del vídeo. Mayús + clic elige varias seguidas; Supr las quita.</div>'}
        <button class="sm" data-e="typewords" style="margin-top:8px">Reescribir todo el texto</button>`}
      <label class="f" style="margin-top:14px">Nombres y palabras propias<input type="text" data-names value="${esc((S.settings.profiles?.[pkey()]?.names || []).join(', '))}" placeholder="Westcol, Kick, parcero" /></label>
      <div class="mut">Separados por comas, escritos como deben salir. La corrección los respeta siempre, aunque el reconocimiento de voz los escriba mal.</div>
      <label class="c" style="margin-top:10px"><input type="checkbox" data-i="cap.fix" ${c.fix !== false ? 'checked' : ''} /> Corregir también en «Exportar ya» y en los lotes</label>
      <div class="mut">${S.tools.ia ? 'Con IA (' + esc(S.tools.ia) + '): corrige ortografía, tildes y palabras mal reconocidas por el contexto.' : 'Sin IA activa se corrigen tildes seguras, mayúsculas, signos y tus nombres propios. Con Ollama corrige también palabras mal reconocidas.'}</div>`;
  } else if (E.tool === 'texto') {
    const t = sp.texts.find((x) => x.id === E.sel?.id);
    h = `<h2>Texto</h2><button class="pri" data-e="addtext" style="margin-top:10px;width:100%">Añadir texto en el cursor</button>
      ${sp.texts.map((x) => `<div class="item ${E.sel?.id === x.id ? 'sel' : ''}"><button class="ghost grow" data-e="sel" data-kind="texts" data-id="${x.id}" style="text-align:left">${esc(x.text)}</button><span class="mut fix mono">${fmt(x.a)}–${fmt(x.b)}</span></div>`).join('') || '<div class="mut" style="margin-top:10px">Aún no hay textos. Se pueden arrastrar sobre la vista previa.</div>'}
      ${t ? `<label class="f">Texto<textarea rows="2" data-i="text.text">${esc(t.text)}</textarea></label>${num('text.size', 'Tamaño', t.size, 30, 160)}
        <div class="row"><label class="f">Color<input type="color" data-i="text.color" value="${t.color}" style="width:100%;min-height:40px;padding:2px" /></label><label class="c" style="margin-top:22px"><input type="checkbox" data-i="text.box" ${t.box ? 'checked' : ''} /> Caja blanca</label></div>
        <div class="mut" style="margin-top:8px">Muévelo arrastrándolo en la vista previa; su duración, en la línea de tiempo.</div>` : ''}
      <h3 style="margin-top:16px">Título fijo</h3><input type="text" data-i="title" value="${esc(sp.title)}" placeholder="Título en pantalla (opcional)" maxlength="60" aria-label="Título en pantalla" />
      <label class="f">Estilo del título<select data-i="titleStyle"><option value="caja" ${sp.titleStyle !== 'meme' ? 'selected' : ''}>Caja blanca</option><option value="meme" ${sp.titleStyle === 'meme' ? 'selected' : ''}>Meme (letras blancas grandes)</option><option value="gancho" ${sp.titleStyle === 'gancho' ? 'selected' : ''}>Gancho (amarillo en el centro)</option></select></label>
      <div class="f">Cuánto se ve el título<div class="chips" style="margin-top:4px">${[[0, 'Todo el clip'], [5, 'Primeros 5 s']].map(([k, n]) => `<button class="sm ${(sp.titleFor || 0) === k ? 'on' : ''}" data-e="titlefor" data-k="${k}" aria-pressed="${(sp.titleFor || 0) === k}">${n}</button>`).join('')}</div></div>
      <button data-e="intro" style="margin-top:8px;width:100%">Añadir título de entrada (2,5 s)</button>
      <h3 style="margin-top:16px">Cierre</h3>
      <label class="c"><input type="checkbox" data-i="outro.on" ${sp.outro.on ? 'checked' : ''} /> Tarjeta de cierre al final</label>
      ${sp.outro.on ? `<input type="text" data-i="outro.text" value="${esc(sp.outro.text)}" maxlength="60" aria-label="Texto del cierre" />${num('outro.seconds', 'Cuánto dura', Math.round(sp.outro.seconds * 10), 10, 40)}<div class="mut" style="margin-top:6px">Al exportar se congela el último fotograma, se oscurece y aparece este texto con tu crédito.</div>` : ''}
      <h3 style="margin-top:16px">Crédito o marca</h3>
      <div class="row"><input type="text" data-i="credit" value="${esc(sp.credit)}" placeholder="@tu_cuenta" aria-label="Crédito o marca" /><select data-i="creditPos" aria-label="Posición del crédito" style="max-width:150px"><option value="bc">Abajo, centro</option><option value="tl">Arriba izq.</option><option value="tr">Arriba der.</option><option value="bl">Abajo izq.</option><option value="br">Abajo der.</option></select></div>`;
  } else if (E.tool === 'stickers') {
    const s = sp.stickers.find((x) => x.id === E.sel?.id);
    h = `<h2>Stickers</h2><div class="mut" style="margin-top:8px">Elige uno en «Stickers», a la izquierda: se añade en el cursor durante 2,5 s. Puedes poner los tuyos (PNG) en la carpeta <span class="mono">public/stickers</span>.</div>
      ${sp.stickers.map((x) => `<div class="item ${E.sel?.id === x.id ? 'sel' : ''}"><button class="ghost grow" data-e="sel" data-kind="stickers" data-id="${x.id}" style="text-align:left">${esc(x.file.replace('.png', ''))}</button><span class="mono mut fix">${fmt(x.a)}–${fmt(x.b)}</span></div>`).join('')}
      ${s ? num('sticker.w', 'Tamaño del sticker seleccionado', s.w * 100, 8, 80) : ''}
      <h3 style="margin-top:16px">Automáticos</h3>
      <button data-e="autostickers" style="width:100%">Poner stickers según lo que se dice</button>
      <div class="mut" style="margin-top:6px">«jajaja», «nooo», «gg», «wtf»… ponen su sticker en el momento en que se dicen.</div>
      <label class="c" style="margin-top:6px"><input type="checkbox" data-i="autoStickers" ${sp.autoStickers ? 'checked' : ''} /> Hacerlo también en «Exportar ya» y en los lotes</label>`;
  } else if (E.tool === 'sonido') {
    const pv = Math.round((sp.volume ?? 1) * 100), fx = sp.sfx.find((x) => x.id === E.sel?.id);
    h = `<h2>Sonido</h2><h3 style="margin-top:10px">Volumen del vídeo</h3>
      ${num('volume', `Sonido original: <b>${pv} %</b>`, pv, 0, 200, 5)}
      <div class="chips" style="margin-top:6px">${[[0, 'Mudo'], [50, '50 %'], [100, 'Normal'], [150, '150 %']].map(([v, n]) => `<button class="sm ${pv === v ? 'on' : ''}" data-e="setvol" data-k="${v}" aria-pressed="${pv === v}">${n}</button>`).join('')}</div>
      <div class="mut" style="margin-top:4px">Por encima del 100 % solo se nota en el vídeo exportado.</div>
      <h3 style="margin-top:16px">Efectos en el clip</h3>${sp.sfx.length ? '' : '<div class="mut">Elige uno en «Sonidos», a la izquierda: se añade en el cursor.</div>'}
      ${sp.sfx.map((x) => `<div class="item ${E.sel?.id === x.id ? 'sel' : ''}"><button class="ghost grow" data-e="sel" data-kind="sfx" data-id="${x.id}" style="text-align:left">${esc(SFX_NAMES[x.file.replace(/\.\w+$/, '')] || x.file)}</button><span class="mono mut fix">${fmt(x.t)}</span></div>`).join('')}
      ${fx ? num('sfxVol', `Volumen de «${esc(SFX_NAMES[fx.file.replace(/\.\w+$/, '')] || fx.file)}»: <b>${Math.round(fx.vol * 100)} %</b>`, Math.round(fx.vol * 100), 0, 200, 5) : ''}
      <h3 style="margin-top:16px">Música de fondo</h3>
      <h3 style="margin-top:4px">Efecto de voz</h3>
      <select data-i="voiceFx" aria-label="Efecto de voz"><option value="">Sin efecto</option>${Object.entries(VOICES).map(([k, [n]]) => `<option value="${k}" ${sp.voice?.fx === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${sp.voice && sp.replay ? `<label class="c" style="margin-top:6px"><input type="checkbox" data-i="voiceReplay" ${sp.voice.on === 'repeticion' ? 'checked' : ''} /> Solo en la repetición a cámara lenta</label>` : ''}
      <div class="mut" style="margin:6px 0 14px">Se oye en el vídeo exportado (la vista previa suena normal).</div>
      <select data-i="music" aria-label="Música de fondo"><option value="">Sin música</option>${A.music.map((f) => `<option ${sp.music?.file === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
      ${sp.music ? num('musicVol', 'Volumen de la música', sp.music.vol * 100, 2, 60) + `<label class="c" style="margin-top:6px"><input type="checkbox" data-i="musicDuck" ${sp.music.duck !== false ? 'checked' : ''} /> Bajar la música cuando alguien habla</label>` : `<div class="mut" style="margin-top:6px">${A.music.length ? '' : 'Pon tus pistas (MP3) en la carpeta public/music; usa música con licencia para tus clips.'}</div>`}
      <label class="c" style="margin-top:14px"><input type="checkbox" data-i="cleanAudio" ${sp.cleanAudio ? 'checked' : ''} /> Voz clara</label>
      <div class="mut">Un modelo de IA ligero separa la voz del ruido y baja el sonido del juego; después realza la voz y nivela el volumen. Se oye en el clip exportado.</div>`;
  } else if (E.tool === 'zoom') {
    const z = sp.zooms.find((x) => x.id === E.sel?.id);
    h = `<h2>Zoom</h2><div class="row wrap" style="margin-top:10px"><button class="pri fix" data-e="addzoom">Zoom en el cursor</button><button class="fix" data-e="zoompeak">Zoom en la reacción</button></div>
      <div class="mut" style="margin-top:6px">En los encuadres con cámara, el zoom acerca la cámara del streamer; en los demás, la imagen entera.</div>
      <label class="c" style="margin-top:10px"><input type="checkbox" data-i="autoZoom" ${sp.autoZoom ? 'checked' : ''} /> Zoom automático en la reacción en «Exportar ya» y en los lotes</label>
      <div class="mut">Un acercamiento suave justo en el pico del momento. Queda guardado en la plantilla de este streamer.</div>
      <h3 style="margin-top:18px">Golpe de reacción</h3><div class="mut">Un instante a pantalla completa de la cara que reacciona, con un acercamiento rápido.</div>
      <div class="row wrap" style="margin-top:8px"><button class="fix" data-e="punch">Golpe en el cursor</button><button class="fix" data-e="punchreact">Golpe en la reacción</button></div>
      <label class="c" style="margin-top:8px"><input type="checkbox" data-i="autoPunch" ${sp.autoPunch ? 'checked' : ''} /> Golpe automático en «Exportar ya» y en los lotes</label>
      ${sp.zooms.map((x) => `<div class="item ${E.sel?.id === x.id ? 'sel' : ''}"><button class="ghost grow" data-e="sel" data-kind="zooms" data-id="${x.id}" style="text-align:left">Zoom ×${x.scale.toFixed(2)}</button><span class="mono mut fix">${fmt(x.a)}–${fmt(x.b)}</span></div>`).join('')}
      ${z ? num('zoom.scale', 'Cuánto acerca', z.scale * 100, 110, 220) : ''}`;
  } else {
    const n = (E.plats.size || 1) * (E.hookTest ? 3 : 1);
    h = `<h2>Publicar</h2><div class="row" style="margin-top:10px"><span class="mut">Título</span><button class="sm fix" data-e="titles" title="Con el estilo de los Shorts que más funcionan ahora con este streamer">${icon('sparkle')}Sugerir títulos</button></div>
      <input type="text" data-i="title" value="${esc(sp.title)}" placeholder="Título del clip (también sale en pantalla)" maxlength="60" aria-label="Título" style="margin-top:6px" />
      <div id="titleSug">${(E.titleSug || []).map((t) => `<button class="sm" data-e="usetitle" data-k="${esc(t)}" style="display:block;width:100%;text-align:left;margin-top:6px">${esc(t)}</button>`).join('')}</div>
      <label class="f">Descripción y hashtags<textarea data-i="description" rows="3" placeholder="Descripción y hashtags">${esc(sp.description || '')}</textarea></label>
      <h3 style="margin-top:16px">Zonas seguras</h3>
      <div class="chips">${[['', 'Ninguna'], ...Object.entries(A.platforms || {}).map(([k, v]) => [k, v.name])].map(([k, n2]) => `<button class="sm ${E.guide === k ? 'on' : ''}" data-e="guide" data-k="${k}">${n2}</button>`).join('')}</div>
      <div class="mut" style="margin-top:6px">Marca en rojo lo que tapan los botones de esa app (aproximado).</div>
      <h3 style="margin-top:16px">Auto edición</h3>
      <label class="c"><input type="checkbox" data-i="noAuto" ${sp.noAuto ? '' : 'checked'} /> Auto edición completa en «Exportar ya» y en los lotes</label>
      <div class="mut">Encuadre según las cámaras, sin silencios, gancho, golpe o zoom en la reacción, subtítulos dinámicos, stickers, título y hashtags. Queda guardado para este streamer.</div>
      <h3 style="margin-top:16px">Calidad</h3>
      <div class="chips"><button class="sm ${sp.quality !== 'alta' ? 'on' : ''}" data-e="quality" data-k="normal">Normal</button><button class="sm ${sp.quality === 'alta' ? 'on' : ''}" data-e="quality" data-k="alta">Alta</button></div>
      <div class="mut" style="margin-top:6px">${sp.quality === 'alta' ? 'Alta: más nitidez (sobre todo en la cámara), menos compresión y volumen nivelado. Tarda en exportar el doble o más.' : 'Normal: rápida y suficiente para la mayoría de clips.'}</div>
      <h3 style="margin-top:16px">Versiones</h3>
      <div class="mut">Exportar una versión ajustada a las zonas seguras de:</div>
      <div class="chips" style="margin-top:6px">${Object.entries(A.platforms || {}).map(([k, v]) => `<button class="sm ${E.plats.has(k) ? 'on' : ''}" data-e="plat" data-k="${k}" aria-pressed="${E.plats.has(k)}">${v.name}</button>`).join('')}</div>
      <label class="c" style="margin-top:8px"><input type="checkbox" data-i="hookTest" ${E.hookTest ? 'checked' : ''} /> Prueba de ganchos: 3 versiones con distinto inicio</label>
      ${E.hookTest ? '<div class="mut">A sin gancho, B con gancho, C directo a la acción. Luego comparas sus vistas en «Clips y publicación».</div>' : ''}
      <button class="pri" data-e="export" style="width:100%;margin-top:16px">${n > 1 ? `Exportar ${n} versiones` : 'Exportar clip'}</button>
      <div class="mut" style="margin-top:8px">Al exportar pasa a «Clips y publicación», donde puedes programarlo y subirlo.</div>`;
  }
  // La explicacion va justo debajo del titulo de la herramienta (no en la revision de la auto edicion).
  if (!E.review && INTRO[E.tool]) h = h.replace('</h2>', `</h2><p class="intro">${INTRO[E.tool]}</p>`);
  $('epanel').innerHTML = h;
  $('epanel').dataset.tool = E.review ? 'revision' : E.tool;
  // Cada herramienta lleva su «?» junto al titulo.
  const h2 = $('epanel').querySelector('h2');
  if (h2 && !E.review && E.tool !== 'clip') { const row = document.createElement('div'); row.className = 'row'; h2.replaceWith(row); row.append(h2); h2.classList.add('grow'); row.insertAdjacentHTML('beforeend', helpBtn(E.tool)); }
  ranges($('epanel'));
  segThumbs($('epanel'));
  for (const [sel, val] of [['[data-i="pipPos"]', sp.pipPos], ['[data-i="cap.anim"]', c.anim], ['[data-i="creditPos"]', sp.creditPos], ['[data-i="censor.mode"]', sp.censor.mode]]) { const el = $('epanel').querySelector(sel); if (el) el.value = val; }
}

/** Miniatura del fotograma con las zonas marcadas; al pulsarla se abre el selector en grande. */
function zoneThumb(mode) {
  const sp = E.spec, box = (r, c) => (r ? `<div style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;border:2px solid ${c};background:${c}22"></div>` : '');
  const cam = CAMLAYS.includes(sp.layout), game = ['split', 'half', 'pip', 'float'].includes(sp.layout);
  return `<div id="picker" data-e="openpick" data-k="${mode}" role="button" tabindex="0" aria-label="Abrir el selector de zonas en grande" title="Clic para dibujar en grande">
    <img alt="" draggable="false" width="640" height="360" src="/api/frame?sid=${E.src.id}&t=${Math.round((E.start + E.end) / 2)}" />${cam ? box(sp.cam, ZC.cam[0]) + camList().filter((c) => c !== sp.cam).map((c) => box(c, ZC.cam[0]).replace('solid', 'dashed')).join('') : ''}${game ? box(sp.game, ZC.game[0]) : ''}${sp.blurs.map((z) => box(z, ZC.blur[0])).join('')}<span class="zopen">Ampliar</span></div>`;
}

/** Barra flotante sobre el visor: el encuadre siempre a mano. */
export function renderFloat() {
  if (!$('efloat')) return;
  // Con un tramo elegido, el encuadre es solo el de ese tramo (su escena); si no, el de todo el clip.
  const sc = selScene(), sg = !sc && selSeg(), own = sc || (sg && sceneAt((sg.a + sg.b) / 2)), cur = own ? own.layout : E.spec.layout;
  const camRow = sc && ONE_CAM.includes(sc.layout) && sceneCams(sc).length > 1 ? `<span class="mut" style="padding:0 4px 0 8px">Se ve</span><div class="seg">${sceneCams(sc).map((c, i) => `<button class="${sceneCamIdx(sc) === i ? 'on' : ''}" data-e="scenecam" data-k="${i}" aria-pressed="${sceneCamIdx(sc) === i}" aria-label="Persona ${i + 1}" title="Persona ${i + 1}">${faceThumb(sc.a + 0.5, c, 'fthumb lg')}</button>`).join('')}</div>` : '';
  $('efloat').innerHTML = `<span class="mut" style="padding:0 4px 0 8px">${sc ? 'Encuadre de esta parte' : sg ? 'Encuadre del tramo' : E.spec.scenes?.length ? `Encuadre · ${E.spec.scenes.length} parte${E.spec.scenes.length > 1 ? 's' : ''} con otro` : 'Encuadre'}</span><div class="seg">${LAYOUTS.map(([k, n, m]) => `<button class="${cur === k ? 'on' : ''}" data-e="layout" data-k="${k}" title="${n}" aria-label="${n}" aria-pressed="${cur === k}"><span class="mini" aria-hidden="true"><i style="left:${m[0]}%;top:${m[1]}%;width:${m[2]}%;height:${m[3]}%;border-radius:${m[4] || 0}%"></i></span>${cur === k ? n : ''}</button>`).join('')}</div>
    ${sc ? `${camRow}<button class="sm ghost" data-e="scenedel" title="Esta parte vuelve a tener el encuadre del resto del clip">Quitar</button>` : own ? '<button class="sm ghost" data-e="sceneoff" title="Este tramo vuelve a tener el encuadre del resto del clip">Como el resto</button>' : '<button class="sm" data-e="sceneadd" title="Desde el cursor, 3 s con otro encuadre (por ejemplo, solo la persona que reacciona); luego vuelve al de siempre. También: clic en una cara de la vista previa">Cambiar desde aquí</button>'}
    <span aria-hidden="true" style="width:1px;height:18px;background:var(--line2)"></span><button class="sm" data-e="openpick" data-k="cam">Dibujar zonas</button>`;
  segThumbs($('efloat'));
}

/** El inspector sin nada elegido: como va el clip y todas las herramientas, cada una con lo que hace. */
function clipPanel() {
  const sp = E.spec, c = E.cand, n = (a, s, p) => (a.length ? `${a.length} ${a.length === 1 ? s : p}` : '');
  const parts = [LAYOUTS.find((l) => l[0] === sp.layout)?.[1], sp.captions.on ? 'subtítulos ' + (S.styles[sp.captions.style]?.name || '') : 'sin subtítulos', sp.hook ? 'gancho' : '', n(sp.texts, 'texto', 'textos'), n(sp.stickers, 'sticker', 'stickers'), n(sp.zooms, 'zoom', 'zooms'), n(sp.sfx, 'sonido', 'sonidos'), sp.music ? 'música' : '', sp.transition ? 'transición' : '', sp.replay ? 'cámara lenta' : '', (sp.speed || 1) !== 1 ? 'velocidad ×' + sp.speed : '', sp.censor.on ? 'groserías tapadas' : '', n(sp.blurs, 'zona difuminada', 'zonas difuminadas')].filter(Boolean);
  const row = ([k, name]) => { const b = badge(k); return `<button class="trow" data-e="tool" data-k="${k}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg><span class="grow"><b>${name}</b><span class="mut">${INTRO[k] || ''}</span></span>${b ? `<span class="tbadge${b === true ? ' dot' : ''}">${b === true ? '' : b}</span>` : ''}${icon('right', 'sm')}</button>`; };
  return `<h2>Clip</h2>
    <div class="cbox"><div class="row"><span class="mono fix" style="font-size:24px;font-weight:500">${fmt(finalDur())}</span><span class="mut grow">duración final</span>${c.score == null ? '' : `<span class="score fix ${c.score >= 8 ? 'hi' : c.score >= 6 ? 'mid' : ''}">${c.score.toFixed(1)}</span>`}</div><div class="mut" style="line-height:1.6">${parts.map(esc).join(' · ')}</div></div>
    ${GROUPS.map(([g, tools]) => `<h3>${g}</h3><div class="tlist">${tools.map(row).join('')}</div>`).join('')}
    <details class="cmore"><summary>Por qué este momento</summary>${signals(c, 'rows')}<div class="mut">${esc(c.why || 'Tramo elegido a mano.')}</div></details>
    <details class="cmore"><summary>Atajos de teclado</summary><div class="mut" style="line-height:1.9">Espacio: reproducir · ←/→: 1 s (Mayús: 5 s) · , .: fotograma · S: cortar · 1–0: herramientas · Supr: borrar · Ctrl+D: duplicar · Ctrl+Z / Ctrl+Mayús+Z: deshacer / rehacer</div></details>`;
}
export function renderSum() {
  renderFloat();
  // Lo que la vista previa no puede mostrar (se aplica al exportar): que nadie piense que no ha hecho nada.
  if ($('pvExport')) {
    const sp0 = E.spec, only = [sp0.replay ? 'repetición a cámara lenta al final' : '', sp0.voice ? 'voz «' + (VOICES[sp0.voice.fx]?.[0] || sp0.voice.fx) + '»' + (sp0.voice.on === 'repeticion' ? ' en la repetición' : '') : '', sp0.stabilize ? 'estabilizado' : '', segs().some((x) => x.rev) ? 'tramos al revés' : ''].filter(Boolean);
    $('pvExport').innerHTML = only.length ? `${icon('sparkle', 'sm')}<span>Al exportar también: ${only.join(' · ')}</span>` : '';
  }
  $('tlInfo').textContent = `Duración final ${fmt(finalDur())}`;
}
