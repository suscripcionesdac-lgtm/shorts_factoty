/** Biblioteca: textos, stickers, sonidos y efectos. */
import { $, esc, fmt, S } from '/web/app.js';
import { icon } from '/web/icons.js';
import { at } from './actions.js';
import { layerRows } from './direct.js';
import { camIdxAt, camList, mainCam } from './geometry.js';
import { assetsCache, E, ICON, PRESETS, SFX_NAMES, STYLE_PRESETS, ticon } from './state.js';
import { transPanel } from './transitions.js';

// ---------- biblioteca ----------
export const LIB = [['textos', 'Textos', 'texto', 'subs'], ['stickers', 'Stickers', 'stickers', 'stickers'], ['sonidos', 'Sonidos', 'sonido', 'sonido'], ['trans', 'Transición', 'trans', 'trans'], ['efectos', 'Efectos', 'efectos', 'zoom'], ['capas', 'Capas', 'capas', null]];
ICON.capas = 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5';
/** Lo que se puede añadir al clip, a la vista: se toca y se ajusta en el inspector. */
export function renderLib() {
  if (!E || !$('elib')) return;
  const sp = E.spec, A = assetsCache || {}, k = E.lib || 'textos', c = sp.captions;
  const card = (attrs, prev, name, on = false) => `<button class="lcard ${on ? 'on' : ''}" ${attrs} ${on ? 'aria-pressed="true"' : ''}><span class="lprev">${prev}</span><span class="lname">${name}</span></button>`;
  const head = (t, n = '') => `<div class="lhead"><h3>${t}</h3>${n ? `<span class="mut">${n}</span>` : ''}</div>`;
  const frame = `/api/frame?sid=${E.src.id}&t=${Math.round(E.cand.peak ?? (E.start + E.end) / 2)}&sm=1`;
  let body = '';
  if (k === 'textos') {
    const st = Object.entries(S.styles || {});
    body = head('Subtítulos', `${st.length} estilos`) + `<div class="lgrid">${st.map(([id, x]) => card(`data-e="capstyle" data-k="${id}" data-t="subs"`, `<span style="font-family:'${x.font}';color:${x.box ? '#111' : x.active};${x.box ? 'background:#ECEDEF;padding:0 6px;border-radius:4px' : ''}">¡VAMOS!</span>`, esc(x.name), c.on && c.style === id)).join('')}</div>
      <div class="mut lnote">Pasa el ratón por un estilo para verlo en el vídeo; haz clic para usarlo.</div>`
      + head('Texto') + `<div class="lgrid">${card('data-e="addtext" data-t="texto"', 'Aa', 'Texto en el cursor')}${card('data-e="intro" data-t="texto"', '<span style="background:#fff;color:#111;padding:0 6px;border-radius:4px;font-size:13px">TÍTULO</span>', 'Título de entrada')}</div>`;
  } else if (k === 'stickers') {
    body = head('Stickers', `${(A.stickers || []).length}`) + `<div class="lgrid g3">${(A.stickers || []).map((x) => `<button class="lcard sq" data-e="addsticker" data-k="${x}" data-t="stickers" aria-label="Añadir sticker ${esc(x.replace('.png', ''))}"><img alt="" width="72" height="72" loading="lazy" src="/assets/stickers/${x}" /></button>`).join('')}</div>
      <div class="mut lnote">Se añaden en el cursor durante 2,5 s.</div><button class="lwide" data-e="autostickers" data-t="stickers">${icon('sparkle')}Ponerlos según lo que se dice</button>`;
  } else if (k === 'sonidos') {
    body = head('Efectos de sonido', `${(A.sfx || []).length}`) + `<div class="lgrid">${(A.sfx || []).map((x) => card(`data-e="addsfx" data-k="${x}" data-t="sonido"`, icon('music'), esc(SFX_NAMES[x.replace(/\.\w+$/, '')] || x.replace(/\.\w+$/, '')))).join('')}</div>
      <div class="mut lnote">Suenan al tocarlos y se añaden en el cursor.</div><button class="lwide" data-e="tool" data-k="sonido">Música, efecto de voz y voz clara</button>`;
  } else if (k === 'trans') {
    body = transPanel('lib');
  } else if (k === 'capas') {
    const rows = layerRows();
    body = head('Capas', 'de delante a atrás') + (rows.length ? `<div class="lyrs" role="list" aria-label="Capas del vídeo">${rows.join('')}</div>` : '<div class="mut lnote">Aún no hay nada encima del vídeo. Añade un texto o un sticker.</div>')
      + '<div class="mut lnote">Toca una capa para elegirla y verla en la vista previa. El ojo la oculta del vídeo; el candado evita moverla sin querer.</div>';
  } else {
    const col = (v) => `filter:brightness(${(1 + v.brightness).toFixed(2)}) contrast(${v.contrast}) saturate(${v.saturation})`;
    body = head('Movimiento') + `<div class="lgrid">${card('data-e="addzoom" data-t="zoom"', icon('plus'), 'Zoom en el cursor')}${card('data-e="zoompeak" data-t="zoom"', icon('sparkle'), 'Zoom en la reacción')}${card('data-e="punchreact" data-t="zoom"', '<b>¡!</b>', 'Golpe de reacción')}${card('data-e="replayhere" data-t="lento"', icon('slow'), 'Repetir a cámara lenta')}</div>`
      + head('Color') + `<div class="lgrid">${card('data-e="autolook" data-t="imagen"', icon('sparkle'), 'Luz y color automáticos')}${Object.entries(PRESETS).map(([id, [n, v]]) => card(`data-e="preset" data-k="${id}" data-t="imagen"`, `<img class="lthumb" alt="" width="112" height="63" loading="lazy" src="${frame}" style="${col(v)}" />`, esc(n))).join('')}</div>`
      + head('Estilos de un clic') + `<div class="chips">${Object.entries(STYLE_PRESETS).map(([id, [n]]) => `<button class="sm" data-e="stylepreset" data-k="${id}">${n}</button>`).join('')}</div>`
      + head('Tapar') + `<div class="lgrid">${card('data-e="openpick" data-k="blur" data-t="censura"', icon('eye'), 'Difuminar una zona')}${card('data-e="tool" data-k="censura"', '<b>#!*</b>', 'Tapar groserías')}</div>`;
  }
  $('elib').innerHTML = `<div class="ltabs" role="tablist" aria-label="Biblioteca" aria-orientation="vertical">${LIB.map(([id, n, ic]) => `<button role="tab" aria-selected="${k === id}" class="${k === id ? 'on' : ''} ${id === 'capas' ? 'lcap' : ''}" data-e="lib" data-k="${id}">${ticon(ic)}${n}</button>`).join('')}</div><div class="lbody" role="tabpanel">${body}</div>`;
}
// Pasar el raton por un estilo de subtitulos lo muestra en la vista previa; al salir vuelve el elegido.
document.addEventListener('pointerover', (e) => {
  const b = e.target.closest?.('#elib [data-e=capstyle]');
  if (!b || !E || E.hoverStyle != null) return;
  E.hoverStyle = E.spec.captions.style; E.hoverOn = E.spec.captions.on;
  E.spec.captions.style = b.dataset.k; E.spec.captions.on = true; E.capSig = ''; E.force = true;
  b.addEventListener('pointerleave', () => { if (E.hoverStyle == null) return; E.spec.captions.style = E.hoverStyle; E.spec.captions.on = E.hoverOn; E.hoverStyle = null; E.capSig = ''; E.force = true; }, { once: true });
});
/** Repite una animacion CSS quitando y volviendo a poner su clase. */
export function replay(el, cls, ms = 600) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }
export const num = (id, label, val, min, max, step = 1) => `<label class="f">${label}<input type="range" data-i="${id}" min="${min}" max="${max}" step="${step}" value="${val}" /></label>`;

const where = (c) => { const x = c.x + c.w / 2, y = c.y + c.h / 2; return [y < 0.34 ? 'arriba' : y > 0.66 ? 'abajo' : '', x < 0.34 ? 'izquierda' : x > 0.66 ? 'derecha' : 'centro'].filter(Boolean).join(' a la '); };
/**
 * Varias camaras (streamers que juegan juntos). «Quien habla»: la camara cambia sola a la persona que habla, y en
 * cualquier punto se puede forzar otra desde el cursor. «Fija»: se ve siempre la camara elegida.
 */
export function camsPanel() {
  const sp = E.spec, cams = camList(), main = mainCam(), k = sp.camTrack || [], auto = !!sp.follow;
  const busy = E.facesState === 'buscando';
  const info = busy ? 'Buscando las cámaras…' : E.facesState === 'hablando' ? 'Mirando quién habla… (las cámaras ya se ven).'
    : cams.length < 2 ? (E.facesState === 'ok' || E.facesState === 'nada' ? (['duo', 'float', 'grid'].includes(sp.layout) ? 'Solo encontré una cámara y este encuadre necesita dos o más. Márcalas con «Dibujar zonas en grande» → «Añadir cámara», o prueba «Cámara + juego».' : 'Solo encontré una cámara.') : auto ? 'Al exportar se buscan las cámaras y quién habla.' : 'Pulsa «Detectar cámaras» si salen varios streamers.')
    : !auto ? 'Se ve siempre la cámara marcada.'
    : k.length > 1 ? `Cambia de cámara ${k.length - 1} ${k.length === 2 ? 'vez' : 'veces'}. Pulsa un tramo de «Cámara» en la línea de tiempo para cambiarlo.` : 'Habla una sola persona en todo el clip.';
  const chip = (i, act, on) => `<button class="sm ${on ? 'on' : ''}" data-e="${act}" data-k="${i}" aria-pressed="${on}">Cámara ${i + 1} · ${where(cams[i])}</button>`;
  return `<h3 style="margin-top:14px">Cámaras</h3>
    <div class="chips" role="group" aria-label="Modo de cámara"><button class="sm ${auto ? 'on' : ''}" data-e="cammode" data-k="auto" aria-pressed="${auto}">Quien habla</button><button class="sm ${auto ? '' : 'on'}" data-e="cammode" data-k="fixed" aria-pressed="${!auto}">Fija</button><button class="sm fix" data-e="detectcam" ${busy ? 'disabled' : ''}>Detectar cámaras</button></div>
    ${cams.length > 1 ? (auto
      ? `<div class="mut" style="margin-top:8px">Desde el cursor (${fmt(at())}), pasar a:</div><div class="chips">${cams.map((_, i) => chip(i, 'setcam', camIdxAt(at()) === i)).join('')}</div>`
      : `<div class="chips" style="margin-top:8px">${cams.map((_, i) => chip(i, 'maincam', main === i)).join('')}</div>`) : ''}
    <div class="mut" style="margin-top:6px">${info}</div>`;
}
