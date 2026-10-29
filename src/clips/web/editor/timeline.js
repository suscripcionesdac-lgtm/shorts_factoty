/** Linea de tiempo por pistas, marcadores, menu contextual y gancho. */
import { $, esc, fmt, toast } from '/web/app.js';
import { segOut } from '/web/segtime.js';
import { TRACKS, videoMuted } from '/web/tracks.js';
import { icon } from '/web/icons.js';
import { at, findItem, root, select } from './actions.js';
import { censored, isMuted } from './censor.js';
import { isCanvasSel, selName } from './direct.js';
import { camLane, camList, joinOn, magnet, ONE_CAM, segs, tAtX, tlLen, toView } from './geometry.js';
import { chunks, liveWords, seek, video } from './playback.js';
import { renderFloat, renderPanel } from './review.js';
import { segAt, segTags } from './segments.js';
import { clamp, E, ICON, KIND_NAME, setDrag, SFX_NAMES, TCODE, uid } from './state.js';
import { transInfo } from './transitions.js';

// ---------- linea de tiempo ----------
/** Posicion del cursor de reproduccion: las pistas empiezan tras la columna de nombres (96 px + 10 de separacion). */
// Posicion de un instante en la linea de tiempo, medida sobre la pista real (asi el cursor y la guia del iman caen
// exactamente sobre los bordes de los bloques, sea cual sea el ancho de la ventana o el zoom).
export const headLeft = (t) => { const r = clamp(toView(t) / tlLen(), 0, 1); return E.lane ? `${(E.lane.x + E.lane.w * r).toFixed(2)}px` : `calc(134px + (100% - 134px) * ${r})`; };
window.addEventListener('resize', () => { if (E && $('tracks')) measureLane(); });
function measureLane() {
  const tr = $('tracks'), ln = tr?.querySelector('.lane[data-lane=video]');
  if (!ln) return;
  const a = tr.getBoundingClientRect(), b = ln.getBoundingClientRect();
  E.lane = { x: b.left - a.left, w: b.width, z: E.tlZoom || 1 };
  $('head').style.left = headLeft(E.t || 0);
  if (E.snapAt != null) $('snapline').style.left = headLeft(E.snapAt);
}
const SPK = ['#FFB020', '#60A5FA', '#34D399', '#FF8A50', '#FF4267', '#F5F5F7'];
export const pct = (t) => clamp((toView(t) / tlLen()) * 100, 0, 100);
/** Ancho (en %) de lo que va de a a b: lo que cae en un hueco quitado no ocupa sitio. */
export const pw = (a, b) => Math.abs(pct(b) - pct(a));
/** Donde empieza y cuanto ocupa (en %) el tramo i en la linea de tiempo. */
const segBox = (i) => { const ss = segs(); if (!magnet()) return [pct(ss[i].a), pw(ss[i].a, ss[i].b)]; const o = ss.slice(0, i).reduce((t, x) => t + segOut(x), 0), L = tlLen(); return [(o / L) * 100, (segOut(ss[i]) / L) * 100]; };
/** Preferencias de este navegador (si el almacenamiento no esta disponible, se usa el valor por defecto). */
/**
 * Separador entre la vista previa y la linea de tiempo (como en DaVinci): arrastrarlo da mas alto a una o a otra.
 * La linea de tiempo se desplaza por dentro si no cabe; el tamaño elegido se recuerda.
 */
export function splitter() {
  const el = $('esplit'), sc = $('tlScroll'), set = (h) => { if (h == null) sc.style.maxHeight = ''; else sc.style.maxHeight = clamp(Math.round(h), 80, innerHeight * 0.7) + 'px'; };
  set(pref('tlh', null));
  const save = () => setPref('tlh', sc.style.maxHeight ? parseFloat(sc.style.maxHeight) : null);
  el.onpointerdown = (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = sc.getBoundingClientRect().height;
    el.onpointermove = (ev) => set(h0 - (ev.clientY - y0));
    el.onpointerup = () => { el.onpointermove = el.onpointerup = null; save(); };
  };
  el.ondblclick = () => { set(null); save(); };
  el.onkeydown = (e) => { if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault(); set(sc.getBoundingClientRect().height + (e.key === 'ArrowUp' ? 30 : -30)); save(); };
}
export function pref(k, def) { try { const v = localStorage.getItem('clipper.' + k); return v == null ? def : JSON.parse(v); } catch { return def; } }
export function setPref(k, v) { try { localStorage.setItem('clipper.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }

/** Zoom de la linea de tiempo: el instante bajo el puntero (o el cursor) se queda en el mismo sitio de la pantalla. */
export function setTlZoom(z, cx) {
  const sc = $('tlScroll'), lane = () => $('tracks').querySelector('.lane[data-lane=video]');
  const r = lane()?.getBoundingClientRect();
  if (!sc || !r) return;
  const x = cx ?? r.left + r.width * clamp(toView(at()) / tlLen(), 0, 1), t = clamp((x - r.left) / r.width, 0, 1) * tlLen();
  E.tlZoom = clamp(z, 1, Math.max(1, E.dur / 3));
  renderTl();
  const r2 = lane().getBoundingClientRect();
  sc.scrollLeft += r2.left + (r2.width * t) / tlLen() - x;
}
/** Iman: si el instante t esta a menos de 8 px de un borde de la lista, se pega a el y se muestra la guia. */
/** Posicion y ancho de las pistas tal como estan ahora (renderTl las vuelve a crear en cada cambio). */
export const laneBox = () => $('tracks').querySelector('.lane[data-lane=video]').getBoundingClientRect();
export function snapTo(t, ev, list) {
  const g = $('snapline');
  if (!E.magnet || ev.altKey || !list.length) { E.snapAt = null; if (g) g.hidden = true; return t; }
  const tol = (8 / laneBox().width) * tlLen();
  let best = null;
  for (const x of list) if (Math.abs(x - t) <= tol && (best == null || Math.abs(x - t) < Math.abs(best - t))) best = x;
  E.snapAt = best;
  if (g) { g.hidden = best == null; if (best != null) g.style.left = headLeft(best); }
  return best ?? t;
}
/** Bordes a los que se puede pegar algo: inicio y fin, cursor, cortes y los bordes de los demas bloques (menos el propio). */
export function snapList(skip) {
  const sp = E.spec, out = [0, E.dur, at(), ...segs().flatMap((x) => [x.a, x.b])];
  for (const k of ['texts', 'stickers', 'zooms', 'punches', 'blurs', 'scenes']) for (const it of sp[k] || []) if (it !== skip && !it.all) out.push(it.a, it.b);
  for (const x of sp.sfx || []) if (x !== skip) out.push(x.t);
  return [...new Set(out.map((x) => Math.round(x * 1000) / 1000))];
}

/** Marcas de la linea de tiempo donde va la transicion: al inicio (tras el gancho) y en cada corte. Tocar una abre su panel. */
function transMarks(s) {
  const sp = E.spec, t = transInfo(sp.transition);
  const plus = s.slice(1).filter((x) => !joinOn(x.a)).map((x) => `<button class="tjoin" data-e="transjoin" data-k="${x.a}" style="left:${pct(x.a)}%" title="Poner una transición en este corte" aria-label="Transición en el corte de ${fmt(x.a)}">+</button>`).join('');
  if (!t) return plus;
  const at = [...(sp.hook && E.dur >= 12 ? [0] : []), ...s.slice(1).map((x) => x.a).filter(joinOn)];
  // Una etiqueta con su nombre (la del inicio, pegada al borde para que no la tape el gancho).
  return at.map((x) => `<div class="tmark ${x < 0.01 ? 'start' : ''}" data-e="tool" data-k="trans" role="button" tabindex="0" style="left:${pct(x)}%" title="Transición: ${esc(t.name)}" aria-label="Transición ${esc(t.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON.trans}"/></svg>${esc(t.name)}</div>`).join('') + plus;
}
export function renderTl() {
  if (!E || !$('tracks')) return;
  for (const x of E.spec.scenes || []) if (!x.id) x.id = uid(); // las de antes no tenian id
  // «Seguir a quien habla» con una sola camara a la vista ya no es otra pista: sus cambios pasan a ser bloques de «Cámara».
  const sp0 = E.spec;
  if (sp0.follow && sp0.camTrack?.length && ONE_CAM.includes(sp0.layout) && (sp0.cams || []).length > 1) {
    const cams = camList(), k = sp0.camTrack, busy = (a, b) => (sp0.scenes || []).some((x) => x.a < b && x.b > a);
    const extra = k.map((x, i) => ({ a: x.t, b: k[i + 1]?.t ?? E.dur, cam: cams[x.cam] })).filter((x) => x.cam && x.cam !== sp0.cam && x.b - x.a >= 0.3 && !busy(x.a, x.b));
    sp0.scenes = [...(sp0.scenes || []), ...extra.map((x) => ({ id: uid(), a: x.a, b: x.b, layout: sp0.layout, cam: x.cam, cams: sp0.cams }))].sort((x, y) => x.a - y.a);
    sp0.follow = false; sp0.camTrack = null;
  }
  const sp = E.spec, s = segs(), blk = (cls, a, b, label, kind, id) => `<div class="blk ${cls} ${isSel(kind, id) ? 'sel' : ''} ${findItem(kind, id)?.hide ? 'hid' : ''} ${findItem(kind, id)?.lock ? 'lck' : ''}" data-kind="${kind}" data-id="${id}" style="left:${Math.min(pct(a), pct(b))}%;width:${pw(a, b)}%" title="${esc(label)}">${esc(label)}</div>`;
  const gaps = []; let cur = 0; // solo se ven con «Ver lo quitado»
  for (const x of s) { if (x.a > cur + 0.01) gaps.push([cur, x.a]); cur = x.b; }
  if (cur < E.dur - 0.01) gaps.push([cur, E.dur]);
  if (magnet()) gaps.length = 0;
  // Con zoom, la pista es mas ancha que la ventana y se desplaza; las marcas se adaptan a los segundos que se ven.
  const z = E.tlZoom || 1, seen = tlLen() / z, step = [1, 2, 5, 10, 15, 30, 60].find((x) => seen / x <= 10) || 120;
  $('tracks').style.width = z > 1 ? z * 100 + '%' : '';
  $('tracks').classList.toggle('tall', !!E.tall);
  if (video()) video().muted = isMuted(E.t || 0) || videoMuted(sp);
  if ($('tlZoomV')) $('tlZoomV').textContent = '×' + (z < 10 ? Math.round(z * 10) / 10 : Math.round(z));
  const ticks = [];
  for (let v = 0; v <= tlLen(); v += step) ticks.push(`<span style="position:absolute;left:${(v / tlLen()) * 100}%">${fmt(v)}</span>`);
  const inKept = (t) => !magnet() || segs().some((x) => t >= x.a && t < x.b);
  const wave = E.wave.map((v, i) => (inKept(i + 0.5) ? `<i class="wavebar" style="left:${pct(i + 0.5)}%;height:${Math.round(v * 100)}%;width:${Math.max(1, (100 * E.dur) / E.wave.length / tlLen() - 0.3)}%"></i>` : '')).join('');
  const cks = sp.captions.on ? chunks(liveWords(), sp.captions.perChunk) : [];
  // Fotogramas reales de cada tramo, como la V1 de Resolve: uno cada ~100 px, asi con zoom salen mas juntos.
  const lw = ((E.lane?.w || 1000) / (E.lane?.z || 1)) * z, film = (x, i) => { if (!E.filmOn) return ''; const n = clamp(Math.round((segBox(i)[1] / 100) * lw / 100), 1, 60);
    return `<span class="strip" aria-hidden="true">${Array.from({ length: n }, (_, j) => `<img class="film" alt="" draggable="false" loading="lazy" src="/api/frame?sid=${E.src.id}&t=${Math.round(E.start + x.a + ((j + 0.5) * (x.b - x.a)) / n)}&sm=1" />`).join('')}</span>`; };
  const lane = (name, inner, k) => { const st = sp.tracks?.[k] || {}, p = TRACKS[k]; return `<div class="track ${p && st[p] ? 'off' : ''} ${st.lock ? 'locked' : ''}"><div class="tn"><b class="tcode">${TCODE[k] || ''}</b><span class="tname">${name}</span>${p ? trackBtns(k, name, st, p) : ''}</div><div class="lane" data-lane="${k}">${inner}</div></div>`; };
  $('tracks').innerHTML = `<div class="track"><div class="tn"></div><div class="lane ruler" data-lane="ruler">${ticks.join('')}${markerHtml()}</div></div>
    ${lane('Cámara', camLane(), 'scene')}
    ${lane('Video', wave + hookBand() + s.map((x, i) => `<div class="blk v ${E.sel?.kind === 'seg' && E.sel.id === i ? 'sel' : ''}" data-kind="seg" data-id="${i}" style="left:${segBox(i)[0]}%;width:${segBox(i)[1]}%">${film(x, i)}<span class="blab">Tramo ${i + 1}${segTags(x)}</span></div>`).join('') + gaps.map(([a, b]) => `<div class="gap" style="left:${pct(a)}%;width:${pw(a, b)}%" title="Tramo quitado"></div>`).join('') + transMarks(s), 'video')}
    ${lane('Subtítulos', cks.map((ch) => `<div class="blk c" data-kind="chunk" data-id="${ch[0].startMs}" style="left:${pct(ch[0].startMs / 1000)}%;width:${pw(ch[0].startMs / 1000, ch[ch.length - 1].endMs / 1000)}%">${esc(ch.map((w) => w.text).join(' '))}</div>`).join(''), 'subs')}
    ${!sp.texts.length ? '' : lane('Texto', sp.texts.map((x) => blk('t', x.a, x.b, x.text, 'texts', x.id)).join(''), 'txt')}
    ${!sp.stickers.length ? '' : lane('Stickers', sp.stickers.map((x) => blk('s', x.a, x.b, x.file.replace('.png', ''), 'stickers', x.id)).join(''), 'stk')}
    ${!sp.music && !sp.sfx.length ? '' : lane('Sonido', (sp.music ? `<div class="blk m" style="left:0;width:100%">Música: ${esc(sp.music.file)}</div>` : '') + sp.sfx.map((x) => `<div class="blk f ${isSel('sfx', x.id) ? 'sel' : ''}" data-kind="sfx" data-id="${x.id}" style="left:calc(${pct(x.t)}% - 11px)" title="${esc(SFX_NAMES[x.file.replace(/\.\w+$/, '')] || x.file)}">${icon('music')}</div>`).join(''), 'sfx')}
    ${!sp.punches?.length ? '' : lane('Golpe', sp.punches.map((x) => blk('z', x.a, x.b, 'Golpe', 'punches', x.id)).join(''), 'punch')}
    ${!sp.zooms.length ? '' : lane('Zoom', sp.zooms.map((x) => blk('z', x.a, x.b, '×' + x.scale.toFixed(2), 'zooms', x.id)).join(''), 'zoom')}
    ${sp.blurs.length ? lane('Difuminado', sp.blurs.map((x, i) => blk('bl', x.all ? 0 : x.a, x.all ? E.dur : x.b, 'Zona ' + (i + 1) + (x.all ? ' · siempre' : ''), 'blurs', x.id)).join(''), 'blur') : ''}
    ${sp.censor.on && censored().length ? lane('Tapado', censored().map(({ w }) => `<div class="blk cen" style="left:${pct(w.startMs / 1000)}%;width:${Math.max(0.6, pw(w.startMs / 1000, w.endMs / 1000))}%" title="${esc(w.text)}"></div>`).join(''), 'cen') : ''}
    <div id="head" style="left:${headLeft(E.t || 0)}"></div><div id="skimline" hidden></div><div id="snapline" ${E.snapAt == null ? 'hidden' : `style="left:${headLeft(E.snapAt)}"`}></div>`;
  measureLane();
  // Lo seleccionado y lo que se puede hacer con ello, junto a la linea de tiempo.
  const k = E.sel?.kind, ok = k === 'seg' ? E.sel.id < s.length : k && findItem(k, E.sel.id);
  const many = (E.multi || []).length;
  $('tlSel').innerHTML = ok ? `<span class="selchip">${many > 1 ? many + ' elementos' : KIND_NAME[k] + (k === 'seg' ? ' ' + (E.sel.id + 1) : '')}</span><button class="fix sm" data-e="ctxsel" aria-haspopup="menu" title="Más acciones (clic derecho en la línea de tiempo)">Más…</button>${k === 'seg' ? '' : '<button class="fix sm" data-e="dupsel" title="Duplicar (Ctrl+D)">Duplicar</button>'}<button class="fix sm" data-e="delsel" title="Borrar (Supr)">Borrar</button>`
    : isCanvasSel() ? `<span class="selchip">${esc(selName())}</span><span class="mut" style="font-size:12px">elegido en la vista previa</span>`
    : '<span class="mut" style="font-size:12px">Toca un bloque para editarlo, o algo en la vista previa</span>';
}

// ---------- linea de tiempo como en CapCut: pistas, marcadores, menu contextual, seleccion multiple ----------
const LANE_OF = { scenes: 'scene', seg: 'video', chunk: 'subs', texts: 'txt', stickers: 'stk', sfx: 'sfx', zooms: 'zoom', punches: 'punch', blurs: 'blur' };
export const locked = (kind) => !!E.spec.tracks?.[LANE_OF[kind]]?.lock;
export const isSel = (kind, id) => (E.sel?.kind === kind && E.sel.id === id) || (E.multi || []).some((m) => m.kind === kind && m.id === id);
/** Todo lo seleccionado: lo marcado con Mayus/Ctrl o con el rectangulo, o si no lo ultimo tocado. */
export const selected = () => ((E.multi || []).length ? E.multi : E.sel ? [E.sel] : []);
export function toggleSel(kind, id) {
  const l = selected().filter((m) => m.kind !== 'seg'), i = l.findIndex((m) => m.kind === kind && m.id === id);
  if (i >= 0) l.splice(i, 1); else l.push({ kind, id });
  E.multi = l; E.sel = l[l.length - 1] || null;
  renderTl(); renderPanel(); E.ovSig = '';
}
const ITEM_KINDS = ['texts', 'stickers', 'sfx', 'zooms', 'punches', 'blurs', 'scenes'];
export function selectAll() {
  const l = ITEM_KINDS.flatMap((k) => (E.spec[k] || []).filter((x) => !x.all && !locked(k)).map((x) => ({ kind: k, id: x.id })));
  E.multi = l; E.sel = l[l.length - 1] || null;
  renderTl(); renderPanel(); E.ovSig = '';
  if (l.length) toast(`${l.length} elementos seleccionados. Supr los borra, Ctrl+D los duplica y arrastrando uno se mueven todos.`);
}
/** Arrastrar sobre una pista vacia dibuja un rectangulo: selecciona los bloques que toca. */
export function marquee(e) {
  const tr = $('tracks'), box = tr.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
  const m = document.createElement('div'); m.className = 'marquee'; tr.appendChild(m);
  let moved = false;
  setDrag({ move: (ev) => {
    if (!moved && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
    moved = true;
    const l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY), r = Math.max(x0, ev.clientX), b = Math.max(y0, ev.clientY);
    Object.assign(m.style, { left: l - box.left + 'px', top: t - box.top + 'px', width: r - l + 'px', height: b - t + 'px' });
    const hits = [...tr.querySelectorAll('.blk[data-id]')].filter((x) => ITEM_KINDS.includes(x.dataset.kind) && !locked(x.dataset.kind)).filter((x) => { const q = x.getBoundingClientRect(); return q.right > l && q.left < r && q.bottom > t && q.top < b; });
    E.multi = hits.map((x) => ({ kind: x.dataset.kind, id: x.dataset.id }));
    tr.querySelectorAll('.blk[data-id]').forEach((x) => x.classList.toggle('sel', hits.includes(x)));
  }, up: () => { m.remove(); if (!moved) { E.multi = []; return scrubAt(x0); } E.sel = E.multi[E.multi.length - 1] || null; renderTl(); renderPanel(); } });
}
function scrubAt(x) { seek(tAtX(x)); renderTl(); }

/** Botones de una pista: bloquear, y ocultar (lo que se ve) o silenciar (lo que suena). */
function trackBtns(k, name, st, p) {
  const b = (what, on, ic, label) => `<button class="tbtn ${on ? 'on' : ''}" data-e="track" data-k="${k}" data-p="${what}" aria-pressed="${!!on}" aria-label="${label} la pista ${name}" title="${label}">${icon(ic)}</button>`;
  return `<span class="tbtns">${b('lock', st.lock, st.lock ? 'lock' : 'unlock', st.lock ? 'Desbloquear' : 'Bloquear')}${p === 'mute' ? b('mute', st.mute, st.mute ? 'mute' : 'vol', st.mute ? 'Activar el sonido de' : 'Silenciar') : b('hide', st.hide, st.hide ? 'eyeoff' : 'eye', st.hide ? 'Mostrar' : 'Ocultar')}</span>`;
}

// Marcadores: los tuyos (M) y el pico del momento, que pone la app.
export const MK_COLORS = ['#FFB020', '#34D399', '#60A5FA', '#FF4267', '#FF8A50'];
const peakAt = () => { const p = (E.cand.peak ?? NaN) - E.start; return p >= 0 && p <= E.dur ? p : null; };
function markerHtml() {
  const p = peakAt(), mk = (cls, t, label, color, id = '') => `<button class="mk ${cls}" data-e="mkgo" data-k="${t}" ${id ? `data-id="${id}"` : ''} style="left:${pct(t)}%;--c:${color}" title="${esc(label)} · ${fmt(t)}" aria-label="Marcador ${esc(label)} en ${fmt(t)}"></button>`;
  return (p == null ? '' : mk('peak', p, 'Pico del momento', '#F5F5F7')) + (E.spec.markers || []).map((m) => mk('', m.t, m.label, m.color, m.id)).join('');
}
export function jumpMarker(dir) {
  const ts = [...(E.spec.markers || []).map((m) => m.t), peakAt()].filter((t) => t != null).sort((a, b) => a - b), now = at();
  const t = dir < 0 ? ts.filter((x) => x < now - 0.05).pop() : ts.find((x) => x > now + 0.05);
  if (t == null) return toast(ts.length ? 'No hay más marcadores en esa dirección.' : 'Aún no hay marcadores: pulsa M para poner uno en el cursor.');
  video()?.pause(); seek(t); renderTl();
}

// Menu contextual (clic derecho o «Más…»): lo que se puede hacer con lo que hay debajo.
export function closeCtx() { const m = $('ctx'); if (!m) return false; m.remove(); return true; }
export function openCtx(x, y, items) {
  closeCtx();
  const m = document.createElement('div');
  m.id = 'ctx'; m.className = 'menu ctx'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it) => (it === '-' ? '<span class="msep" role="separator"></span>' : `<button role="menuitem" data-e="${it.e}" ${it.k != null ? `data-k="${esc(String(it.k))}"` : ''} ${it.id ? `data-id="${it.id}"` : ''} ${it.off ? 'disabled' : ''}>${it.sw ? `<i class="msw" style="background:${it.sw}"></i>` : ''}${it.label}${it.key ? `<span class="mut mkey">${it.key}</span>` : ''}</button>`)).join('');
  root().appendChild(m);
  const r = m.getBoundingClientRect();
  Object.assign(m.style, { left: Math.min(x, innerWidth - r.width - 8) + 'px', top: Math.min(y, innerHeight - r.height - 8) + 'px' });
  m.querySelector('button:not([disabled])')?.focus();
}
export function ctxFor(target, x, y) {
  const lane = target.closest('.lane'), blk = target.closest('.blk'), mk = target.closest('.mk');
  const t = tAtX(x);
  const base = [{ e: 'splitat', k: t, label: 'Cortar aquí', key: 'S' }, { e: 'addmarker', k: t, label: 'Añadir marcador aquí', key: 'M' }];
  if (mk?.dataset.id) {
    const id = mk.dataset.id;
    return [{ e: 'mkname', id, label: 'Cambiar nombre…' }, '-', ...MK_COLORS.map((c, i) => ({ e: 'mkcolor', id, k: c, sw: c, label: ['Ámbar', 'Verde', 'Azul', 'Rojo', 'Lila'][i] })), '-', { e: 'mkdel', id, label: 'Borrar marcador' }];
  }
  if (mk) return [{ e: 'mkgo', k: mk.dataset.k, label: 'Ir al pico del momento' }];
  if (blk?.dataset.kind === 'seg') {
    E.sel = { kind: 'seg', id: +blk.dataset.id }; E.multi = []; renderTl(); renderFloat();
    const x = segAt() || {};
    return [...base, { e: 'freezehere', k: t, label: 'Congelar aquí (2 s)' }, '-', { e: 'segrev', label: x.rev ? 'Quitar «al revés»' : 'Al revés' }, { e: 'segflip', k: 'h', label: x.flip?.includes('h') ? 'Quitar espejo' : 'Espejo' }, { e: 'segrot', k: 90, label: 'Girar 90°' }, { e: 'tool', k: 'recorte', label: 'Velocidad y más…' }, '-', { e: 'delseg', label: 'Quitar este tramo', key: 'Supr' }];
  }
  if (blk && ITEM_KINDS.includes(blk.dataset.kind)) {
    const kind = blk.dataset.kind, id = blk.dataset.id;
    if (!isSel(kind, id)) select(kind, id);
    renderTl();
    const n = selected().length, can = !!ATTRS[kind]?.length, clip = E.attrs?.kind === kind;
    return [{ e: 'dupsel', label: n > 1 ? `Duplicar los ${n}` : 'Duplicar', key: 'Ctrl+D' }, { e: 'copyattr', label: 'Copiar atributos', key: 'Ctrl+Alt+C', off: !can }, { e: 'pasteattr', label: n > 1 ? `Pegar atributos en los ${n}` : 'Pegar atributos', key: 'Ctrl+Alt+V', off: !clip },
      '-', ...base, '-', { e: 'delsel', label: n > 1 ? `Borrar los ${n}` : 'Borrar', key: 'Supr', off: locked(kind) }];
  }
  if (blk?.dataset.kind === 'chunk') return [{ e: 'tool', k: 'subs', label: 'Editar los subtítulos' }, '-', ...base];
  return lane ? base : null;
}
document.addEventListener('contextmenu', (e) => {
  if (!E || root().hidden || !e.target.closest?.('#tracks')) return;
  const items = ctxFor(e.target, e.clientX, e.clientY);
  if (!items) return;
  e.preventDefault();
  openCtx(e.clientX, e.clientY, items);
});
document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('#ctx')) closeCtx(); }, true);
document.addEventListener('keydown', (e) => {
  const m = $('ctx');
  if (!m || !m.contains(document.activeElement) || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  const b = [...m.querySelectorAll('button:not([disabled])')], i = b.indexOf(document.activeElement);
  b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus();
}, true);

// Copiar y pegar atributos: el estilo de un elemento a otros del mismo tipo.
export const ATTRS = { texts: ['size', 'color', 'box'], stickers: ['w'], zooms: ['scale'], sfx: ['vol'] };

// Vista al pasar el raton por la linea de tiempo (en pausa): el visor enseña ese instante; el cursor no se mueve.
let skimRaf = 0;
export function skimAt(e) {
  if (!E || !E.ready || E.modal || !pref('skim', true)) return;
  const v = video(), tr = e.target.closest?.('#tracks');
  if (!tr || !v.paused || e.target.closest('#ctx')) return endSkim();
  const r = laneBox();
  if (e.clientX < r.left || e.clientX > r.right) return endSkim();
  const t = tAtX(e.clientX);
  E.skim = t;
  const ln = $('skimline'); if (ln) { ln.hidden = false; ln.style.left = headLeft(t); }
  if (skimRaf) return;
  skimRaf = requestAnimationFrame(() => { skimRaf = 0; if (E.skim != null && !v.seeking) v.currentTime = E.off + E.skim; });
}
export function endSkim() {
  if (!E || E.skim == null) return;
  E.skim = null; E.skimPainted = null;
  const ln = $('skimline'); if (ln) ln.hidden = true;
  seek(E.t || 0);
}
document.addEventListener('pointerleave', (e) => { if (e.target?.id === 'tracks') endSkim(); }, true);

// J, K y L: atras, parar y adelante (cada L mas rapido: ×1, ×2, ×4).
let revTimer = 0;
export function shuttle(dir) {
  const v = video(); if (!v) return;
  clearInterval(revTimer); revTimer = 0;
  if (dir === 0) { E.shuttle = 1; v.pause(); return; }
  if (dir > 0) { E.shuttle = !v.paused && (E.shuttle || 1) < 4 ? (E.shuttle || 1) * 2 : 1; if (v.paused) v.play().catch(() => {}); return; }
  // Hacia atras no se puede reproducir: se va saltando hacia atras al mismo ritmo.
  v.pause(); E.shuttle = 1;
  revTimer = setInterval(() => { if (!E || at() <= 0.04) { clearInterval(revTimer); revTimer = 0; return; } seek(at() - 1 / 15); }, 66);
}

// ---------- el gancho en la linea de tiempo ----------
/** El trozo que se ve primero como gancho (mismo calculo que la exportacion), o null si no hay. */
export function hookRange() {
  const sp = E.spec;
  if (!sp.hook || E.dur < 12) return null;
  if (sp.hookSeg) return { a: sp.hookSeg.a, b: Math.min(E.dur, sp.hookSeg.b) };
  const p = peakAt();
  if (p == null || p <= 4) return null;
  const a = Math.max(0, p - 1.3);
  return { a, b: Math.min(E.dur, a + 2.8) };
}
function hookBand() {
  const h = hookRange();
  if (!h) return E.spec.hook && E.dur >= 12 ? '<button class="hookband start" data-e="hookgo" title="El clip empieza con su momento más fuerte">Gancho al inicio</button>' : '';
  return `<button class="hookband" data-e="hookgo" style="left:${Math.min(pct(h.a), pct(h.b))}%;width:${Math.max(pw(h.a, h.b), 3)}%" title="Este trozo (${fmt(h.a)}–${fmt(h.b)}) se ve primero, como gancho. Clic para ajustarlo">Gancho</button>`;
}
