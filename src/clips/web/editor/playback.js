/** Reproduccion y dibujo del lienzo. */
import { $, esc, fmt, S } from '/web/app.js';
import { applyTracks, videoMuted } from '/web/tracks.js';
import { captionBox, captionY, faceZones, gridBoxes, SAFE, titleZone, zonesAt } from '/web/place.js';
import { pieces, toSrc as segToSrc } from '/web/segtime.js';
import { icon } from '/web/icons.js';
import { root } from './actions.js';
import { isCen, isMuted, maskW } from './censor.js';
import { updateSel } from './direct.js';
import { camAt, camIdxAt, camList, geometry, kept, keptBefore, reframeAt, segs, strip, tlLen, toView, withScene, zoomAt } from './geometry.js';
import { assetsCache, CH, clamp, CW, E, FONTS, H, isKeyword, PRESETS, setRaf, W } from './state.js';
import { headLeft } from './timeline.js';

// ---------- reproduccion y lienzo ----------
export const video = () => $('pv');
// El cursor se mueve en el acto (no en el siguiente fotograma pintado): asi el iman o «Cortar» justo despues usan el sitio nuevo.
export function seek(t) { const v = video(); if (v && E.ready) { const c = clamp(t, 0, Math.max(0, E.dur - 0.05)); v.currentTime = E.off + c; E.t = c; E.force = true; } }
export function togglePlay() { const v = video(); if (!E.ready) return; clearTimeout(E.holdT); E.held = null; if (v.paused) { if (v.currentTime - E.off >= E.dur - 0.1 || v.currentTime < E.off) v.currentTime = E.off + segs()[0].a; v.play(); } else v.pause(); }

let off = null;
/** El fotograma actual con las zonas difuminadas ya aplicadas (igual que el exportador: antes del encuadre). */
function frameSrc(t) {
  const v = video(), zs = (E.spec.blurs || []).filter((z) => z.all || (t >= z.a && t <= z.b));
  if (!zs.length) return v;
  off = off || document.createElement('canvas');
  if (off.width !== v.videoWidth || off.height !== v.videoHeight) { off.width = v.videoWidth; off.height = v.videoHeight; }
  const o = off.getContext('2d');
  o.filter = 'none';
  o.drawImage(v, 0, 0);
  for (const z of zs) { o.save(); o.beginPath(); o.rect(z.x * off.width, z.y * off.height, z.w * off.width, z.h * off.height); o.clip(); o.filter = `blur(${Math.max(6, Math.round(off.height / 36))}px)`; o.drawImage(v, 0, 0); o.restore(); }
  return off;
}
function region(g, v, r, dx, dy, dw, dh, zoom = 1, fy = 0.38, fx = 0.5) {
  const vw = v.videoWidth || v.width, vh = v.videoHeight || v.height;
  const sw0 = r.w * vw, sh0 = r.h * vh, sc = Math.max(dw / sw0, dh / sh0);
  let sw = dw / sc, sh = dh / sc, sx = r.x * vw + (sw0 - sw) / 2, sy = r.y * vh + (sh0 - sh) / 2;
  if (zoom > 1) { const zw = sw / zoom, zh = sh / zoom; sx += (sw - zw) * fx; sy += (sh - zh) * fy; sw = zw; sh = zh; }
  g.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
}
/**
 * Fondo desenfocado: el video en un lienzo diminuto y estirado (casi gratis). El filtro blur() del lienzo costaba
 * cada fotograma lo bastante para que la reproduccion no fuera fluida.
 */
function blurBg(g, v, sw, sh, dark) {
  const c = (E.bgc = E.bgc || Object.assign(document.createElement('canvas'), { width: 27, height: 48 }));
  region(c.getContext('2d'), v, strip(sw, sh, W, H, 0.5), 0, 0, 27, 48);
  g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, CW, CH);
  g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(0, 0, CW, CH);
}
/** Hacia donde acerca el zoom activo en t, como focusExpr del exportador: [fy, fx], con fy0 por defecto. */
function focusAt(t, fy0) {
  let fx = 0.5, fy = fy0;
  for (const k of applyTracks(E.spec).zooms) if (t >= k.a && t <= k.b) { if (k.fx != null) fx += k.fx - 0.5; if (k.fy != null) fy += k.fy - fy0; }
  return [fy, fx];
}
/** Clave de una camara para seleccionarla: la principal es «cam»; las demas, su posicion en la lista. */
const camKey = (r) => { const i = (E.spec.cams || []).indexOf(r); return r === E.spec.cam || i < 0 ? 'cam' : 'cam:' + i; };

/** Con «quien habla», la camara que no habla se apaga un poco (igual que el exportador). */
function dimCam(g, c, t, x, y, w, h) { if (E.spec.follow && E.spec.camTrack?.length && camIdxAt(t) !== c) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y, w, h); } }
function paint(t) { withScene(t, () => paintNow(t)); if (E.vw) E.geo = geometry(applyTracks(E.spec), E.vw, E.vh); } // titulo y subtitulos: con la geometria del clip, como el exportador
function paintNow(t) {
  const g = $('cv').getContext('2d'), sp = applyTracks(E.spec), sw = video().videoWidth, sh = video().videoHeight;
  if (!sw) return;
  const v = frameSrc(t), col = sp.color || PRESETS.normal[1];
  const css = col.brightness || col.contrast !== 1 || col.saturation !== 1 ? `brightness(${(1 + col.brightness * 1.6).toFixed(3)}) contrast(${col.contrast}) saturate(${col.saturation})` : '';
  if (E.css !== css) $('cv').style.filter = E.css = css;
  const geo = geometry(sp, sw, sh), z = zoomAt(t), k = CW / W, full = { x: 0, y: 0, w: 1, h: 1 }, F = (fy0) => focusAt(t, fy0);
  // Cada zona del video que se ve, para poder tocarla y encuadrarla en la vista previa (en px del lienzo).
  const fr = [], frame = (key, r, x, y, w, h, o = {}) => fr.push({ key, r, x, y, w, h, ...o });
  g.fillStyle = '#000'; g.fillRect(0, 0, CW, CH);
  if (sp.layout === 'crop') { const st = strip(sw, sh, W, H, 0); st.x = (1 - st.w) * clamp(reframeAt(t), 0, 1); region(g, v, st, 0, 0, CW, CH, z, ...F(0.38)); frame('crop', st, 0, 0, CW, CH, { zoom: true }); }
  else if (sp.layout === 'cam') { region(g, v, camAt(t), 0, 0, CW, CH, z, ...F(0.38)); frame(camKey(camAt(t)), camAt(t), 0, 0, CW, CH, { zoom: true }); }
  else if (sp.layout === 'split' || sp.layout === 'half') {
    const ch = geo.camH * k, game = sp.game || strip(sw, sh, W, H - geo.camH, sp.cropX);
    region(g, v, camAt(t), 0, 0, CW, ch, z, ...F(0.4));
    region(g, v, game, 0, ch, CW, CH - ch);
    frame(camKey(camAt(t)), camAt(t), 0, 0, CW, ch, { zoom: true }); frame('game', game, 0, ch, CW, CH - ch);
    g.fillStyle = '#FFB020'; g.fillRect(0, ch - 2, CW, 4);
  } else if (sp.layout === 'pip') {
    const game = sp.game || strip(sw, sh, W, H, sp.cropX);
    region(g, v, game, 0, 0, CW, CH);
    const D = 400 * k, m = 44 * k, px = sp.pipPos.includes('r') ? CW - D - m : m, py = sp.pipPos.includes('b') ? CH - D - 420 * k : 150 * k;
    g.save(); g.beginPath(); g.arc(px + D / 2, py + D / 2, D / 2, 0, Math.PI * 2); g.clip(); region(g, v, camAt(t), px, py, D, D, z, ...F(0.4)); g.restore();
    frame('game', game, 0, 0, CW, CH); frame(camKey(camAt(t)), camAt(t), px, py, D, D, { round: true, zoom: true });
  } else if (sp.layout === 'duo') {
    const cams = camList(), m = cams.indexOf(sp.cam);
    if (cams.length < 2 || m < 0) { region(g, v, camAt(t), 0, 0, CW, CH, z, ...F(0.38)); frame(camKey(camAt(t)), camAt(t), 0, 0, CW, CH, { zoom: true }); }
    else {
      // Igual que el exportador: hasta 4 camaras apiladas, la principal arriba.
      const order = [m, ...cams.map((_, i) => i).filter((i) => i !== m)].slice(0, 4), h = CH / order.length;
      order.forEach((c, i) => { region(g, v, cams[c], 0, i * h, CW, h, z, ...F(0.4)); dimCam(g, c, t, 0, i * h, CW, h); frame(camKey(cams[c]), cams[c], 0, i * h, CW, h, { zoom: i === 0 }); });
      g.fillStyle = '#FFB020'; for (let i = 1; i < order.length; i++) g.fillRect(0, i * h - 2, CW, 4);
    }
  } else if (sp.layout === 'grid' && camList().length >= 2) {
    // Igual que el exportador (gridBoxes en place.js): todas las camaras en cuadricula sobre el video desenfocado.
    blurBg(g, v, sw, sh, 0.5);
    const cams = camList(), m = Math.max(0, cams.indexOf(sp.cam)), order = [m, ...cams.map((_, i) => i).filter((i) => i !== m)].slice(0, 12), b = gridBoxes(order.length);
    order.forEach((c, i) => { const [x, y] = b.xy[i]; region(g, v, cams[c], x * k, y * k, b.cw * k, b.ch * k, z, ...F(0.4)); dimCam(g, c, t, x * k, y * k, b.cw * k, b.ch * k); frame(camKey(cams[c]), cams[c], x * k, y * k, b.cw * k, b.ch * k, { zoom: i === 0 }); });
  } else if (sp.layout === 'grid') { region(g, v, camAt(t), 0, 0, CW, CH, z, ...F(0.38)); frame(camKey(camAt(t)), camAt(t), 0, 0, CW, CH, { zoom: true });
  } else if (sp.layout === 'float') {
    const game = sp.game || strip(sw, sh, W, H, sp.cropX);
    region(g, v, game, 0, 0, CW, CH);
    frame('game', game, 0, 0, CW, CH);
    // Igual que el exportador (floatBoxes en fast.ts): hasta tres camaras en fila, la principal primero.
    const cams = camList(), m = cams.indexOf(sp.cam), many = cams.length >= 2 && m >= 0, y = 140 * k;
    const boxes = many ? [m, ...cams.map((_, i) => i).filter((i) => i !== m)].slice(0, 3) : [-1], n = boxes.length;
    const bw = (n >= 3 ? 330 : n === 2 ? 480 : 640) * k, bh = (n >= 3 ? 290 : n === 2 ? 380 : 480) * k, xs = (n >= 3 ? [22, 375, 728] : n === 2 ? [40, 560] : [220]).map((x) => x * k);
    boxes.map((c, i) => [c, xs[i]]).forEach(([c, x], i) => {
      const r = c < 0 ? camAt(t) : cams[c];
      g.save(); g.beginPath(); g.roundRect(x, y, bw, bh, 36 * k); g.clip(); region(g, v, r, x, y, bw, bh, z, ...F(0.4)); if (c >= 0) dimCam(g, c, t, x, y, bw, bh); g.restore();
      frame(camKey(r), r, x, y, bw, bh, { zoom: i === 0 });
    });
  } else {
    if (sp.fitBg !== 'negro') blurBg(g, v, sw, sh, 0.4);
    region(g, v, full, 0, geo.top * k, CW, geo.vh * k, z, ...F(0.38));
    frame('full', null, 0, geo.top * k, CW, geo.vh * k, { zoom: true });
  }
  E.frames = fr; E.vw = sw; E.vh = sh;
  const p = (sp.punches || []).find((x) => t >= x.a && t <= x.b);
  if (p) region(g, v, camList()[p.cam] || sp.cam, 0, 0, CW, CH, 1 + 0.25 * Math.min(1, (t - p.a) / 0.25) * Math.min(1, (p.b - t) / 0.25), 0.4);
  if (sp.flash && [...(sp.camTrack || []).slice(1).map((x) => x.t), ...(sp.punches || []).map((x) => x.a)].some((x) => t >= x && t <= x + 0.12)) { g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(0, 0, CW, CH); }
  E.geo = geo;
  // Marco del canal (igual que el exportador: BRAND_H en spec.ts): franjas con textura y el @ repetido.
  if (sp.brand?.on) {
    const B = 64 * k, t = (sp.brand.text || '').toUpperCase(); // BRAND_H
    // Como el exportador (brandTop en fast.ts): con la camara arriba se baja la imagen en vez de taparle la cabeza.
    if (sp.layout === 'split' || sp.layout === 'half') g.drawImage($('cv'), 0, 0, CW, CH - 2 * B, 0, B, CW, CH - 2 * B);
    for (const y0 of [0, CH - B]) {
      g.fillStyle = '#0B1A22'; g.fillRect(0, y0, CW, B);
      g.strokeStyle = 'rgba(34,211,238,.06)'; g.lineWidth = 1;
      for (let x = 0; x < CW; x += 54 * k) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + B); g.stroke(); }
      for (let y = 0; y < B; y += 54 * k) { g.beginPath(); g.moveTo(0, y0 + y); g.lineTo(CW, y0 + y); g.stroke(); }
      if (t) { g.fillStyle = 'rgba(255,255,255,.16)'; g.font = `${30 * k}px 'Montserrat Black'`; g.textBaseline = 'top'; const row = Array(7).fill(t).join('       '); g.fillText(row, (y0 ? -110 : -40) * k, y0 + 17 * k); }
    }
    const lg = g.createLinearGradient(0, 0, CW, 0); lg.addColorStop(0, '#22D3EE'); lg.addColorStop(1, '#FF2D7A');
    g.fillStyle = lg; g.fillRect(0, B - 4 * k, CW, 4 * k); g.fillRect(0, CH - B, CW, 4 * k);
    // Tu logo en la franja de arriba (el mismo archivo que usa el exportador).
    const lo = (E.logoImg ||= Object.assign(new Image(), { src: '/assets/brand/logo.png' }));
    if (lo.complete && lo.naturalWidth) g.drawImage(lo, (CW - 48 * k) / 2, 8 * k, 48 * k, 48 * k);
  }
  // Fundido entre el encuadre anterior y el nuevo.
  if (E.snapT) { const a = 1 - (performance.now() - E.snapT) / 300; if (a > 0) { g.globalAlpha = a * a; g.drawImage(E.snap, 0, 0); g.globalAlpha = 1; } else E.snapT = 0; }
}
/** Guarda lo que se ve ahora en el visor, para fundirlo con lo que venga despues. */
export function snap() {
  const c = $('cv');
  if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  E.snap = E.snap || document.createElement('canvas');
  E.snap.width = c.width; E.snap.height = c.height;
  E.snap.getContext('2d').drawImage(c, 0, 0);
  E.snapT = performance.now();
}

export function chunks(words, per) {
  const out = []; let cur = [], chars = 0; const max = per <= 2 ? 14 : 18;
  for (const w of words) {
    const end = cur.length && /[.!?]$/.test(cur[cur.length - 1].text), gap = cur.length && w.startMs - cur[cur.length - 1].endMs > 900;
    if (cur.length >= per || (cur.length && chars + w.text.length > max) || end || gap) { out.push(cur); cur = []; chars = 0; }
    cur.push(w); chars += w.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}
export const pkey = () => (E.src.streamer || 'general').toLowerCase().replace(/^@/, '');
export const liveWords = () => (E.spec.captions.words || []).filter((w) => !w.del && w.text.trim());

function overlay(t) {
  if (E.inlineEdit) return; // escribiendo encima de la vista previa: no se redibuja
  const sp = applyTracks(E.spec), c = sp.captions, st = S.styles[c.style] || S.styles.amarillo, ms = t * 1000, ov = $('ov'), px = ov.clientWidth / W;
  // Elementos fijos y arrastrables: solo se reconstruyen cuando cambia lo que hay en pantalla.
  const on = (x) => t >= x.a && t <= x.b, zNow = sp.zooms.filter(on);
  const vis = [...sp.texts.filter(on).map((x) => 't' + x.id), ...sp.stickers.filter(on).map((x) => 's' + x.id), ...zNow.map((x) => 'z' + x.id)].join(',');
  // El titulo con duracion (gancho) solo se ve en esos primeros segundos del video final.
  const titleOn = !sp.titleFor || (t >= segs()[0].a - 0.05 && t <= segToSrc(segs(), sp.titleFor));
  const sig = [vis, sp.title, titleOn, sp.titleStyle, sp.titleY, sp.credit, sp.creditPos, sp.creditLift, sp.progress, E.guide, c.style, E.geo?.titleY, E.sel?.kind, E.sel?.id, px.toFixed(3), JSON.stringify(sp.texts), JSON.stringify(sp.stickers), JSON.stringify(zNow)].join('|');
  // Giro y opacidad: el centro del elemento se queda en (x, y), como en el exportador.
  const tf = (x) => `transform:translate(-50%,-50%)${x.rot ? ` rotate(${x.rot}deg)` : ''};${x.op != null && x.op < 1 ? `opacity:${x.op};` : ''}`;
  const lift = ((sp.creditLift || 150) / H) * 100, top = (60 / H) * 100, cp = sp.creditPos || 'bc';
  const cpos = cp === 'tl' ? `left:4%;top:${top}%` : cp === 'tr' ? `right:4%;top:${top}%` : cp === 'bl' ? `left:4%;bottom:${lift}%` : cp === 'br' ? `right:4%;bottom:${lift}%` : `left:0;right:0;bottom:${lift}%;text-align:center`;
  const gz = assetsCache.platforms?.[E.guide], red = 'position:absolute;background:rgba(255,66,103,.28);border:1px dashed #FF8FA3;pointer-events:none';
  if (sig !== E.ovSig) {
    E.ovSig = sig; E.capSig = '';
    ov.innerHTML = `${sp.title && titleOn ? `<div class="ov-title ${E.sel?.kind === 'title' ? 'sel' : ''}" data-ov="title" title="Clic: elegirlo · Arrastra para subirlo o bajarlo · Doble clic: escribir aquí" style="position:absolute;left:50%;top:${((sp.titleY ?? E.geo?.titleY ?? 200) / H) * 100}%;transform:translate(-50%,-50%);${sp.titleStyle === 'meme' ? `color:#fff;font:${76 * px}px Anton;text-transform:uppercase;-webkit-text-stroke:${6 * px}px #000;paint-order:stroke fill;text-align:center;width:90%` : sp.titleStyle === 'gancho' ? `color:#FFD60A;font:${68 * px}px 'Montserrat Black';text-transform:uppercase;-webkit-text-stroke:${7 * px}px #000;paint-order:stroke fill;text-align:center;width:90%;line-height:1.1` : `background:#fff;color:#111;border-radius:${5 * px * 3}px;padding:${16 * px}px ${22 * px}px;font:${(sp.titleFor ? 84 : 58) * px}px 'Montserrat Black';text-align:center;${sp.titleFor ? 'text-transform:uppercase;white-space:normal;max-width:17ch' : 'max-width:87%'}`}">${esc(sp.title)}</div>` : ''}
      ${sp.credit ? `<div style="position:absolute;${cpos};font:${34 * px}px 'Montserrat ExtraBold';text-shadow:0 1px 4px #000,0 0 2px #000">${esc(sp.credit)}</div>` : ''}
      ${sp.progress ? `<div id="pbar" style="position:absolute;left:0;top:0;height:${14 * px}px;width:0;background:${st.box || st.active === '#FFFFFF' ? '#FFD400' : st.active}"></div>` : ''}
      ${gz ? `<div style="${red};left:0;right:0;top:0;height:${(gz.top / H) * 100}%"></div><div style="${red};left:0;right:0;bottom:0;height:${(gz.bottom / H) * 100}%"></div><div style="${red};right:0;top:${(gz.top / H) * 100}%;bottom:${(gz.bottom / H) * 100}%;width:${(gz.right / W) * 100}%"></div>` : ''}
      ${sp.stickers.filter(on).map((x) => `<div class="ov-item ${E.sel?.id === x.id ? 'sel' : ''} ${x.lock ? 'lck' : ''}" data-ov="stickers" data-id="${x.id}" title="Arrastra para moverlo; las esquinas cambian el tamaño" style="left:${x.x * 100}%;top:${x.y * 100}%;width:${x.w * 100}%;${tf(x)}"><img alt="" width="96" height="96" src="/assets/stickers/${x.file}" /></div>`).join('')}
      ${sp.texts.filter(on).map((x) => `<div class="ov-item ${E.sel?.id === x.id ? 'sel' : ''} ${x.lock ? 'lck' : ''}" data-ov="texts" data-id="${x.id}" title="Arrastra para moverlo · Doble clic para escribir" style="left:${x.x * 100}%;top:${x.y * 100}%;font:${x.size * px}px '${FONTS.includes(x.font) ? x.font : FONTS[0]}';${tf(x)}${x.box ? `background:#fff;color:#111;padding:${14 * px}px ${18 * px}px;border-radius:${10 * px}px` : `color:${x.color};-webkit-text-stroke:${6 * px}px #000;paint-order:stroke fill`}">${esc(x.text)}</div>`).join('')}
      ${zNow.map((x, i) => `<button class="ov-zoom ${E.sel?.kind === 'zooms' && E.sel.id === x.id ? 'sel' : ''}" data-ov="zooms" data-id="${x.id}" style="top:${8 + i * 34}px" title="Elegir este zoom para cambiar cuánto y hacia dónde acerca">${icon('zoom', 'sm')}Zoom ×${x.scale.toFixed(2)}</button>`).join('')}
      <div class="ov-cap" id="cap" data-ov="captions"></div>`;
  }
  // Subtitulos: cambian con cada palabra.
  const cap = $('cap');
  let html = '', csig = '';
  if (c.on) {
    const cks = chunks(liveWords(), c.perChunk);
    const ci = cks.findIndex((ch, i) => ms >= ch[0].startMs && ms < Math.min(cks[i + 1]?.[0].startMs ?? Infinity, ch[ch.length - 1].endMs + 600));
    if (ci >= 0) {
      const ch = cks[ci], wi = ch.findIndex((w, i) => ms >= w.startMs && ms < (ch[i + 1]?.startMs ?? Infinity));
      csig = ci + ':' + wi;
      html = ch.map((w, i) => { const on = c.anim !== 'ninguna' && i === wi, key = w.hi ?? (c.keywords && isKeyword(w.text)); return `<span style="color:${on ? st.active : key ? st.key : st.base}${on && st.hl ? `;background:${st.hl};border-radius:${12 * px}px;padding:0 ${10 * px}px;-webkit-text-stroke:0` : ''}">${esc(sp.censor.on && sp.censor.text && isCen(w) ? maskW(w.text) : w.text)}</span>`; }).join(' ');
    }
  }
  // La misma colocacion que el exportador: el bloque se aparta de las caras sin salir de la zona segura.
  let capTop = c.posY;
  if (c.on && c.smart !== false && html && E.geo) {
    const cks = chunks(liveWords(), c.perChunk), ch = cks[+csig.split(':')[0]], end = Math.min(cks[+csig.split(':')[0] + 1]?.[0].startMs ?? Infinity, ch[ch.length - 1].endMs + 600);
    const t0 = ch[0].startMs / 1000, tz = titleZone(sp, E.geo);
    const zones = zonesAt(sp, [...withScene(t0, () => faceZones(E.spec, geometry(E.spec, E.vw, E.vh), camList())), ...(tz ? [tz] : [])], t0, end / 1000);
    capTop = captionY(zones, c.posY / 100, captionBox(ch.map((w) => w.text).join(' '), c.size), SAFE[c.safe] || SAFE.todas) * 100;
  }
  csig += c.style + c.size + capTop.toFixed(2) + c.anim + px.toFixed(3) + sp.censor.on + sp.censor.text + sp.censor.extra;
  if (csig !== E.capSig) {
    E.capSig = csig;
    cap.style.cssText = `top:${capTop}%;font:${st.italic ? 'italic ' : ''}${c.size * px}px '${st.font}'`;
    cap.innerHTML = html ? `<span style="${st.box ? `background:#fff;padding:${10 * px}px ${16 * px}px;border-radius:${8 * px}px;box-decoration-break:clone;-webkit-box-decoration-break:clone` : `-webkit-text-stroke:${7 * px}px #000;paint-order:stroke fill;text-shadow:0 ${3 * px}px ${6 * px}px rgba(0,0,0,.6)`}">${html}</span>` : '';
  }
  updateSel();
}

export function loop() {
  setRaf(requestAnimationFrame(loop));
  if (!E || $('v-editor').hidden || !$('pv')) return;
  const v = video();
  if (E.ready) {
    let t = v.currentTime - E.off;
    if (E.skim != null && v.paused) { if (t !== E.skimPainted) { E.skimPainted = t; paint(t); overlay(t); } return; }
    // Al reproducir se saltan los tramos quitados.
    if (!v.paused) {
      const s = segs(), inSeg = s.find((x) => t >= x.a - 0.03 && t < x.b);
      // Congelado al final del tramo: se queda quieto lo que dure y luego sigue.
      const ending = s.find((x) => x.hold && t >= x.b - 0.06 && t < x.b + 0.1);
      if (ending && E.held !== ending) { E.held = ending; v.pause(); const next = s.find((x) => x.a > ending.b); E.holdT = setTimeout(() => { if (E.held !== ending) return; if (next) { v.currentTime = E.off + next.a; v.play().catch(() => {}); } }, ending.hold * 1000); }
      if (!inSeg) { const next = s.find((x) => x.a > t); if (next) v.currentTime = E.off + (t = next.a); else { v.pause(); t = s[s.length - 1].b; } }
    }
    // En pausa y sin cambios no hace falta redibujar 60 veces por segundo: 4 bastan (ahorra CPU y bateria).
    const now = performance.now();
    if (v.paused && t === E.t && !E.snapT && !E.force && now - (E.painted || 0) < 250) return;
    E.t = t; E.force = false; E.painted = now;
    const sg = segs().find((x) => t >= x.a - 0.03 && t < x.b), pc = sg && pieces(sg).find((p) => t >= p.a - 0.03 && t < p.b);
    const rate = Math.min(16, Math.max(0.0625, (E.spec.speed || 1) * (E.shuttle || 1) * (pc?.k || 1))), mute = isMuted(t) || videoMuted(E.spec);
    const tf = sg ? `${sg.flip?.includes('h') ? 'scaleX(-1) ' : ''}${sg.flip?.includes('v') ? 'scaleY(-1) ' : ''}${sg.rot ? `rotate(${sg.rot}deg)` : ''}`.trim() : '';
    if ($('cv').style.transform !== tf) $('cv').style.transform = tf;
    if (v.playbackRate !== rate) v.playbackRate = rate;
    if (v.muted !== mute) v.muted = mute;
    const vol = Math.min(1, E.spec.volume ?? 1); if (Math.abs(v.volume - vol) > 0.01) v.volume = vol;
    paint(t); overlay(t);
    if ($('pbar')) $('pbar').style.width = clamp(keptBefore(t) / Math.max(0.1, kept()), 0, 1) * 100 + '%';
    $('head').style.left = headLeft(t);
    // Con zoom, al reproducir la pista se desplaza para que el cursor no salga de la vista.
    if (!v.paused && (E.tlZoom || 1) > 1) { const sc = $('tlScroll'), x = 134 + (sc.scrollWidth - 134) * (toView(t) / tlLen()); if (x < sc.scrollLeft + 134 || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - 134 - sc.clientWidth * 0.15; }
    $('clock').textContent = `${fmt(toView(t))} / ${fmt(tlLen())}`;
    $('playBtn').innerHTML = icon(v.paused ? 'play' : 'pause');
    if (root().classList.contains('playing') === v.paused) root().classList.toggle('playing', !v.paused);
    if (E.tool === 'subs') markWord(t);
  }
}
function markWord(t) {
  const ws = E.spec.captions.words || [], i = ws.findIndex((w) => t * 1000 >= w.startMs && t * 1000 < w.endMs);
  if (i === E.nowWord) return;
  E.nowWord = i;
  document.querySelectorAll('#wordList button').forEach((b, k) => b.classList.toggle('now', k === i));
}
