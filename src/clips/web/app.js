// Clipper: sala de control, biblioteca y ajustes. El editor vive en editor.js.
import { openEditor, editorKey, pvWindow, previewUrl } from '/web/editor.js';
import { openHelp, closeHelp, helpBtn, tour } from '/web/help.js';
import { icon } from '/web/icons.js';
import { pickClips } from '/web/pick.js';
import { disliked, kindName } from '/web/prefs.js';
import { dlShort } from '/web/progress.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
export const parseT = (t) => String(t).trim().split(':').map(Number).reduce((a, v) => a * 60 + (v || 0), 0);
export async function api(path, data) {
  const r = await fetch(path, data ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : undefined);
  let j;
  try { j = await r.json(); }
  catch {
    // Una ruta que el servidor no conoce: la pagina es mas nueva que el servidor que esta abierto.
    throw new Error(r.status === 404 ? 'Esta función es nueva: cierra el Clipper (la ventana negra) y vuelve a abrirlo.' : `El servidor respondió algo inesperado (${r.status}).`);
  }
  if (j && j.error) throw new Error(j.error);
  return j;
}
export function toast(msg, kind = '') {
  const el = document.createElement('div'), box = $('toasts');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  // Un error no desaparece solo: se queda hasta que se cierra, para dar tiempo a leerlo o copiarlo.
  // Los avisos normales duran unos segundos, y el reloj se para mientras el puntero o el foco esten encima.
  if (kind === 'bad') {
    el.setAttribute('role', 'alert');
    const x = document.createElement('button');
    x.className = 'tx'; x.type = 'button'; x.setAttribute('aria-label', 'Cerrar aviso'); x.textContent = '×'; x.onclick = close;
    el.appendChild(x);
    [...box.querySelectorAll('.toast.bad')].slice(0, -2).forEach((o) => o.remove());
  } else {
    let t = setTimeout(close, 5000);
    el.onmouseenter = () => clearTimeout(t);
    el.onmouseleave = () => (t = setTimeout(close, 2500));
  }
  box.appendChild(el);
}

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/**
 * Cambia la pantalla con una transicion del navegador (View Transitions): lo que tiene el mismo nombre
 * en el antes y el despues (la miniatura de un momento y el visor del editor) se transforma de uno en otro.
 * `dir`: 'fwd' o 'back' desliza la pantalla; 'none' solo anima los elementos con nombre.
 */
export function vt(fn, dir = 'none') {
  if (!document.startViewTransition || calm()) return Promise.resolve(fn());
  document.documentElement.dataset.vt = dir;
  // Si la ventana cambia de tamaño a mitad de transicion, el navegador la aborta: no es un error.
  const t = document.startViewTransition(fn);
  t.ready.catch(() => {});
  return t.finished.catch(() => {});
}
/** La pastilla de los selectores segmentados se desliza desde la opcion anterior hasta la nueva. */
const segPos = new Map();
export function segs(root = document) {
  root.querySelectorAll('.seg').forEach((s) => {
    const on = s.querySelector('button.on');
    if (!on) return;
    const key = [...s.querySelectorAll('button')].map((b) => Object.entries(b.dataset).map((e) => e.join('=')).join(',') || b.textContent.trim()).join('|');
    let t = s.querySelector(':scope > .thumb');
    const to = { x: on.offsetLeft, w: on.offsetWidth }, from = segPos.get(key);
    if (!to.w) return;
    if (!t) {
      t = document.createElement('i'); t.className = 'thumb'; s.prepend(t); s.classList.add('thumbed');
      // Recien creada: arranca donde estaba la opcion anterior y se desliza a la nueva.
      const start = from && !calm() ? from : to;
      t.style.transition = 'none'; t.style.transform = `translateX(${start.x}px)`; t.style.width = start.w + 'px'; void t.offsetWidth; t.style.transition = '';
    }
    t.style.transform = `translateX(${to.x}px)`; t.style.width = to.w + 'px';
    segPos.set(key, to);
  });
}

/** Pinta el tramo relleno de los deslizadores (la variable --p que usa el CSS). */
export function ranges(root = document) { root.querySelectorAll('input[type=range]').forEach((r) => r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min || 1)) * 100 + '%')); }
document.addEventListener('input', (e) => { if (e.target.type === 'range') { ranges(e.target.parentNode); if (e.target.dataset.show) slv(); } });
/** Texto de los deslizadores de Ajustes: el numero y lo que significa. */
function slv() {
  const say = { notify: (v) => (v >= 9 ? 'solo lo excepcional' : v >= 7 ? 'lo muy bueno' : v >= 5 ? 'casi todo' : 'todo'), auto: (v) => (v === 0 ? 'nunca' : v >= 9 ? 'solo lo excepcional' : v >= 7 ? 'lo muy bueno' : 'casi todo'), days: (v) => (v === 0 ? 'nunca' : 'a los ' + v + ' días') };
  document.querySelectorAll('input[type=range][data-show]').forEach((r) => { const v = +r.value, o = $(r.dataset.show); if (o) o.textContent = r.dataset.kind === 'days' ? say.days(v) : (v === 0 && r.dataset.kind === 'auto' ? 'nunca' : String(v).replace('.', ',') + ' · ' + say[r.dataset.kind](v)); });
  ranges(); // el relleno de la barra, con el valor ya cargado
}

/**
 * Ventanas propias en lugar de las del navegador. `ask` devuelve el texto escrito (o null si se cancela);
 * sin `value` es una confirmación y devuelve true o false.
 */
/** Dialogo propio. `alt` añade un tercer boton (devuelve 'alt'); Cancelar, Escape o clic fuera devuelven false. */
export function ask(title, { text = '', value, ok = 'Aceptar', danger = false, multiline = false, alt = '' } = {}) {
  return new Promise((resolve) => {
    const input = value != null, s = document.createElement('div');
    s.className = 'scrim';
    s.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
      ${input ? (multiline ? `<textarea rows="5" aria-label="${esc(title)}"></textarea>` : `<input type="text" aria-label="${esc(title)}" />`) : ''}
      <div class="row" style="justify-content:flex-end;margin-top:4px"><button class="fix" data-x="no">Cancelar</button>${alt ? `<button class="fix" data-x="alt">${esc(alt)}</button>` : ''}<button class="fix ${danger ? 'danger' : 'pri'}" data-x="yes" style="min-width:110px">${esc(ok)}</button></div></div>`;
    document.body.appendChild(s);
    const field = s.querySelector('input,textarea'), prev = document.activeElement;
    // En una acción destructiva el foco va a Cancelar: Intro no debe borrar nada por accidente.
    if (field) { field.value = value; field.focus(); field.select(); } else s.querySelector(danger ? '[data-x=no]' : '[data-x=yes]').focus();
    const done = (yes) => { const out = input ? (yes ? field.value : null) : yes; s.classList.add('out'); setTimeout(() => s.remove(), calm() ? 0 : 180); prev?.focus?.(); resolve(out); };
    s.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === s) return done(false); const x = e.target.closest('[data-x]'); if (x) x.dataset.x === 'alt' ? (s.classList.add('out'), setTimeout(() => s.remove(), calm() ? 0 : 180), prev?.focus?.(), resolve('alt')) : done(x.dataset.x === 'yes'); }, true);
    s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(false); if (e.key === 'Enter' && !(multiline && !e.ctrlKey)) { e.preventDefault(); done(danger ? document.activeElement?.dataset.x === 'yes' : document.activeElement?.dataset.x !== 'no'); } }, true);
  });
}

export let S = { sources: [], clips: [], tools: {}, settings: { watch: [], learned: {} }, styles: {}, logs: [], report: { groups: [] } };
let view = 'live', selSrc = null, filter = 'todos', picked = new Set(), pickedClips = new Set(), clipTab = 'pub', clipStreamer = '', TL = null, tlFor = '';
let clipKind = '', clipQ = '', openClip = null, showPerf = false;
/** Transiciones para los montajes (las mismas del editor) y la elegida. */
let transList = [], montTrans = '';
api('/api/assets').then((a) => { transList = a.transitions || []; }).catch(() => {});
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
let sortBy = pref('momSort', 'orden'), dense = pref('momDense', '1') === '1', openMom = null; const folded = new Set();
const justDone = new Set();
let seen = null, clipState = {}, settingsDrawn = false, profKey = '';
let STO = null;
const firstSeen = new Map();
const gb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.round(b / 1e6) + ' MB');
const VAR = { A: 'A · sin gancho', B: 'B · con gancho', C: 'C · directo' };
const PLAT = { tiktok: 'TikTok', shorts: 'Shorts', reels: 'Reels' };
const skey = (x) => (x || 'general').toLowerCase().replace(/^@/, '');
const last = {};
const draw = (key, html, el) => { if (last[key] !== html) { last[key] = html; el.innerHTML = html; return true; } return false; };
export const cur = () => S.sources.find((x) => x.id === selSrc);
const BADGE = { grabando: 'rec', listo: 'ok', error: 'bad', analizando: 'work', descargando: 'work' };
const BY = { ia: 'IA', manual: 'tuyo', chat: 'chat', audio: 'auto', comunidad: 'comunidad' };

const ORDER = ['live', 'editor', 'clips', 'agent', 'lab', 'stats', 'settings'];
/** Cambia de pantalla deslizando hacia el lado que toca. `after` se ejecuta dentro de la transicion (abrir el editor). */
export function go(v, after) {
  if (v === view && !after) return show(v);
  return vt(async () => { show(v); if (after) await after(); }, ORDER.indexOf(v) >= ORDER.indexOf(view) ? 'fwd' : 'back');
}
// ---------- barra de arriba: paneles de la pagina, titulo y accion principal (como en DaVinci Resolve) ----------
const TOGGLES = { live: [['src', 'Directos', 'panelL'], ['moms', 'Momentos', 'panelR'], ['tl', 'Línea', 'panelB']],
  clips: [['wsl', 'Biblioteca', 'panelL'], ['wsr', 'Detalles', 'panelR'], ['dock', 'Calendario', 'panelB']],
  agent: [['wsl', 'Escuela', 'panelL'], ['wsr', 'Cada streamer', 'panelR']] };
const NAMES = { live: 'Media', editor: 'Editar', clips: 'Clips', agent: 'Agente', lab: 'Laboratorio', stats: 'Resultados', settings: 'Ajustes' };
// Paginas de arriba (como las de Resolve) y las secciones que agrupa cada una.
const GROUP = { live: 'live', editor: 'editor', clips: 'clips', agent: 'agent', lab: 'agent', stats: 'agent', settings: 'settings' };
document.querySelectorAll('[data-ico]').forEach((e) => (e.outerHTML = icon(e.dataset.ico)));
const hiddenPanels = (v) => { try { return JSON.parse(localStorage.getItem('clipper.hide.' + v) || '[]'); } catch { return []; } };
function applyHidden(v) { const el = $('v-' + v), h = hiddenPanels(v); for (const [k] of TOGGLES[v] || []) el.classList.toggle('hide-' + k, h.includes(k)); }
/** Pinta la barra de arriba de la pagina `v` (solo si es la que se ve). `title` ya viene escapado. */
let lastBar = ['', '', ''];
function setBar(v, title, sub = '', acts = '') {
  if (v !== view) return;
  lastBar = [title, sub, acts];
  const h = hiddenPanels(v);
  draw('tbar', (TOGGLES[v] || []).map(([k, n, ic]) => `<button class="tog" data-ptog="${k}" aria-pressed="${!h.includes(k)}" title="Mostrar u ocultar ${n}">${icon(ic, 'sm')}<span>${n}</span></button>`).join(''), $('tbar'));
  draw('atitle', `<b>${title}</b>${sub ? `<span class="mut">${esc(sub)}</span>` : ''}`, $('atitle'));
  draw('aact', acts, $('aact'));
}
function show(v) {
  view = v;
  document.body.dataset.screen = v; // no «view»: data-view es el atributo de los botones que navegan
  applyHidden(v); setBar(v, NAMES[v]);
  for (const n of ORDER) $('v-' + n).hidden = n !== v;
  // La clase "enter" dispara las animaciones de entrada solo al cambiar de pantalla.
  const el = $('v-' + v); el.classList.add('enter'); clearTimeout(go.t); go.t = setTimeout(() => el.classList.remove('enter'), 900);
  $('fly').hidden = true; toggleNoti(false);
  document.body.dataset.group = GROUP[v];
  const mark = (b, on) => { b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); };
  document.querySelectorAll('.pg').forEach((b) => mark(b, b.dataset.pg === GROUP[v]));
  document.querySelectorAll('.sub, .nav[data-view=settings]').forEach((b) => mark(b, b.dataset.view === v));
  render();
}

function beep() { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.2, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.5); o.start(); o.stop(a.currentTime + 0.5); } catch {} }

function notify() {
  const ids = new Set();
  for (const s of S.sources) for (const c of s.candidates) {
    ids.add(s.id + c.id);
    if (seen && !seen.has(s.id + c.id)) { firstSeen.set(s.id + '|' + c.id, Date.now()); setTimeout(() => { firstSeen.delete(s.id + '|' + c.id); last.liveBody = null; }, 2600); }
    if (!seen || seen.has(s.id + c.id) || s.status !== 'grabando' || c.by === 'manual') continue;
    if (c.score >= S.settings.notifyScore) {
      beep();
      toast(`Momento ${c.score.toFixed(1)} en ${s.name} · ${c.at}`, 'good');
      if (window.Notification && Notification.permission === 'granted') new Notification('Momento detectado: ' + c.score.toFixed(1), { body: s.name + ' · ' + c.at + (c.why ? '\n' + c.why : '') });
    }
  }
  seen = ids;
  for (const c of S.clips) {
    const prev = clipState[c.id];
    if (prev && prev !== c.status && c.status === 'listo') { toast('Clip listo: ' + (c.title || 'sin título'), 'good'); justDone.add(c.id); setTimeout(() => justDone.delete(c.id), 2500); }
    if (prev && prev !== c.status && c.status === 'error') toast('Falló un clip: ' + (c.error || ''), 'bad');
    clipState[c.id] = c.status;
  }
}

// ---------- avisos ----------
const NOTI_KEY = 'clipper.notiSeen';
const notiSeen = () => { try { return localStorage.getItem(NOTI_KEY) || ''; } catch { return ''; } };
const NK = { cola: 'En cola', curso: 'En curso', ok: 'Hecho', mal: 'Falló' };
let notiShown = null, notiBefore = '';
function renderNoti() {
  const list = S.notices || [], open = !$('noti').hidden;
  // Con el panel abierto, lo que llega se da por visto; lo resaltado es lo que no se habia visto al abrir.
  if (open && list.length) { try { localStorage.setItem(NOTI_KEY, list.at(-1).at); } catch {} }
  const seenAt = open ? notiBefore : notiSeen(), unread = open ? [] : list.filter((n) => n.at > seenAt);
  $('navNoti').textContent = unread.length || '';
  $('navNoti').className = 'count' + (unread.some((n) => n.kind === 'mal') ? ' rec' : '');
  // Aviso de Windows solo para lo que termina (hecho o fallo) y solo si Clipper no esta a la vista.
  const fresh = notiShown == null ? [] : list.filter((n) => n.at > notiShown && (n.kind === 'ok' || n.kind === 'mal'));
  notiShown = list.at(-1)?.at || notiShown || '';
  if (document.hidden && window.Notification && Notification.permission === 'granted') for (const n of fresh) new Notification(n.kind === 'mal' ? 'Clipper: algo falló' : 'Clipper', { body: n.msg, tag: n.at });
  if ($('noti').hidden) return;
  const started = (cid) => list.some((n) => n.cid === cid && n.msg.startsWith('Subiendo a TikTok'));
  const now = [];
  for (const c of S.clips) {
    const t = esc(c.title || 'Clip');
    if (['en cola', 'auto edición', 'transcribiendo', 'renderizando'].includes(c.status)) now.push(`${c.status === 'en cola' ? 'En cola para exportar' : 'Exportando'} «${t}»${c.progress != null && c.status !== 'en cola' ? ` · ${Math.round(c.progress)} %` : ''}`);
    if (c.tiktokUploading) now.push(`${started(c.id) ? 'Subiendo a TikTok' : 'En cola para TikTok'} «${t}»`);
    if (c.uploading) now.push(`Subiendo a YouTube «${t}»`);
  }
  draw('notiNow', now.length ? `<div class="nhead">Ahora mismo</div>${now.map((x) => `<div class="nrow now"><span class="ndot" aria-hidden="true"></span><span class="grow">${x}</span></div>`).join('')}<div class="nhead">Historial</div>` : '', $('notiNow'));
  draw('notiList', list.length ? list.slice().reverse().map((n) => `<div class="nrow${n.at > seenAt ? ' new' : ''}" data-k="${n.kind}"><span class="nk">${NK[n.kind]}</span><span class="grow">${esc(n.msg)}${n.link ? ` · <a href="${esc(n.link)}" target="_blank" rel="noopener">Ver</a>` : ''}</span><time class="mut" datetime="${n.at}">${new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>`).join('') : '<div class="mut">Aquí verás cuándo un clip entra en cola, termina de exportarse y se sube a TikTok o YouTube.</div>', $('notiList'));
  draw('notiPerm', window.Notification && Notification.permission === 'default' ? '<button class="sm fix" data-notiperm style="margin-top:10px;width:100%">Avisarme también en Windows</button>' : '', $('notiPerm'));
}
function toggleNoti(open) {
  $('noti').hidden = !open; $('notiBtn').setAttribute('aria-expanded', String(open));
  if (!open) return;
  notiBefore = notiSeen();
  last.notiNow = last.notiList = last.notiPerm = null; renderNoti();
}

// ---------- laboratorio de la auto edicion ----------
let labStreamer = '';
const sname = (k) => (k === 'general' ? 'Sin streamer' : k);
const LEVEL_HELP = [
  'Quita solo pausas muy largas (más de 1,4 s) y como mucho el 8 % del clip. Para charlas en las que el silencio cuenta.',
  'Quita pausas de más de 1 s, hasta 3 cortes por minuto y como mucho el 15 % del clip. El punto de partida.',
  'Quita pausas desde 0,7 s, hasta 5 cortes por minuto y como mucho el 25 % del clip. Para un ritmo rápido.',
];
const AREA_NAME = { cortes: 'Cortes', gancho: 'Gancho', encuadre: 'Encuadre', zooms: 'Zooms', golpes: 'Golpes', luz: 'Luz y color' };
// ---------- resultados de tu TikTok ----------
const TTS = {};
async function loadStats(refresh) {
  Object.assign(TTS, { loading: true, error: '' }); render();
  try { TTS.r = await api('/api/tiktokstats' + (refresh ? '?refresh=1' : '')); } catch (e) { TTS.error = e.message; }
  TTS.loading = false; render();
}
/** Barras de un grupo (hora, dia, duracion...): la mediana de vistas del primer dia y cuantos videos hay. */
function statBars(title, list, note = '') {
  if (!list?.length) return '';
  const max = Math.max(1, ...list.map((g) => g.median));
  return `<div class="card stcard"><h3>${title}</h3>${note ? `<div class="mut" style="margin:-4px 0 8px">${note}</div>` : ''}<div class="stbars">${list.map((g) => `<div class="strow ${g.n < 3 ? 'few' : ''}" title="${g.n} video${g.n > 1 ? 's' : ''}${g.n < 3 ? ' (pocos: no cuentan para las conclusiones)' : ''}"><span class="stk">${esc(g.label)}</span><span class="lbar"><i style="width:${Math.round((g.median / max) * 100)}%"></i></span><b class="mono">${g.median.toLocaleString('es')}</b><span class="mut mono">${g.n}</span></div>`).join('')}</div></div>`;
}
function statsHtml() {
  const acc = (S.settings.tiktokAccount || '').replace(/^@/, '');
  if (!acc) return `<div class="card"><h2>Resultados de tu TikTok</h2><p class="mut">Pon tu cuenta de TikTok en Ajustes › Cuentas y aquí verás qué les va bien a tus videos: horas, días, duración, títulos, hashtags y cómo los editaste.</p></div>` + viewsCard();
  const r = TTS.r, pc = (v) => (v * 100).toLocaleString('es', { maximumFractionDigits: 1 }) + ' %';
  const head = `<div class="card sthead"><div class="grow"><h2 style="margin:0">Resultados de @${esc(acc)}</h2><div class="mut">${r ? `${r.n} videos · ${r.totalViews.toLocaleString('es')} vistas · se comparan los ${r.mature} con más de un día, con las vistas de su primer día${r.warmup ? ` (sin los ${r.warmup} de cuando la cuenta empezaba)` : ''} · hora de ${esc(r.tz)}` : 'Lee tu perfil público de TikTok (sin contraseña).'}</div></div><button class="fix" data-ttsrefresh ${TTS.loading ? 'disabled' : ''}>${TTS.loading ? 'Leyendo TikTok…' : 'Actualizar'}</button></div>`;
  if (TTS.error) return head + `<div class="card"><div class="err">${esc(TTS.error)}</div></div>` + viewsCard();
  if (!r) return head + `<div class="card mut">Leyendo tus videos de TikTok…</div>` + viewsCard();
  const kpi = (n, v) => `<div class="stkpi"><b>${v}</b><span class="mut">${n}</span></div>`;
  return head + `
    <div class="card"><h3>Qué hacer</h3><ul class="stnext">${r.next.map((t) => `<li>${esc(t)}</li>`).join('') || '<li class="mut">Aún no hay nada que destaque: sigue subiendo.</li>'}</ul></div>
    <div class="card"><h3>Lo que se ve en tus datos</h3>${r.findings.length ? `<ul class="stfind">${r.findings.map((f) => `<li><span class="chip ${f.strength === 'fuerte' ? 'ok' : ''}">${f.strength === 'fuerte' ? 'Claro' : 'Indicio'}</span>${esc(f.text)}</li>`).join('')}</ul>` : '<div class="mut">Nada destaca todavía (hacen falta al menos 3 videos en cada grupo).</div>'}
      <div class="mut" style="margin-top:8px">«Claro»: 6 videos o más; «Indicio»: de 3 a 5. Los videos de cuando la cuenta empezaba (antes del primero con 100 vistas) no cuentan: una cuenta nueva casi no sale al principio.</div></div>
    <div class="stkpis">${kpi('mediana el primer día', r.median.toLocaleString('es'))}${kpi('me gusta por vista', pc(r.engagement.likes))}${kpi('comentarios por vista', pc(r.engagement.comments))}${kpi('compartidos por vista', pc(r.engagement.shares))}${kpi('guardados por vista', pc(r.engagement.saves))}</div>
    <div class="stgrid">
      ${statBars('Hora de publicar', r.hours, 'Mediana de vistas el primer día · número de videos')}
      ${statBars('Día de la semana', r.days)}
      ${statBars('Duración', r.durations)}
      ${statBars('Título', r.title)}
      ${statBars('Hashtags', r.tags.slice(0, 10))}
      ${statBars('Streamer', r.streamers)}
      ${statBars('Cómo se subieron', r.batch)}
      ${statBars('Cómo se editaron (clips de Clipper)', r.edits)}
    </div>
    <div class="card"><h3>Tus videos con más vistas</h3><div class="sttop">${r.top.map((v) => `<a class="row" href="https://www.tiktok.com/@${esc(acc)}/video/${esc(v.id)}" target="_blank" rel="noopener"><span class="grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.desc)}</span><span class="mut mono fix">${new Date(v.at * 1000).toLocaleString('es', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><b class="mono fix">${v.views.toLocaleString('es')}</b><span class="mut mono fix">${v.likes.toLocaleString('es')} me gusta</span></a>`).join('')}</div></div>` + viewsCard();
}

function labHtml() {
  const L = S.lab || { rows: [], learned: {}, levels: ['Suave', 'Normal', 'Intensa'] };
  const streamers = [...new Set([...S.sources.map((s) => skey(s.streamer)), ...Object.keys(L.learned || {})])];
  if (!streamers.includes(labStreamer)) labStreamer = streamers[0] || '';
  const lv = L.learned?.[labStreamer]?.level ?? 1, prefs = L.learned?.[labStreamer]?.auto || {};
  const moments = S.sources.filter((s) => skey(s.streamer) === labStreamer).flatMap((s) => s.candidates.map((c) => [s, c])).sort((a, b) => b[1].score - a[1].score).slice(0, 5);
  const pct = (v) => Math.round(v * 100), bar = (v) => `<span class="lbar" aria-hidden="true"><i style="width:${pct(v)}%"></i></span>`;
  const share = ([, [k, r]]) => k / (k + r || 1);
  // Los cuatro pasos en orden, como una barra de progreso: hecho, el que toca y los que faltan.
  const done = [true, Object.keys(prefs).length > 0, L.rows.length > 0, Object.keys(prefs).length > 0], cur = done.indexOf(false);
  const steps = ['Cuánto recorta', 'Pruébala', 'Mide el parecido', 'Lo aprendido'].map((n, i) => `<span class="lstep ${done[i] ? 'done' : ''} ${i === cur ? 'cur' : ''}" ${i === cur ? 'aria-current="step"' : ''}><span class="n">${done[i] ? icon('check', 'sm') : i + 1}</span>${n}</span>`).join('');
  return `
    <section class="pnl dock"><div class="ph"><h2 class="sr">Laboratorio</h2><div class="lsteps" aria-label="Pasos">${steps}</div><span class="grow"></span>
      ${streamers.length ? `<label class="lsel fix">Streamer<select data-labstreamer>${streamers.map((k) => `<option value="${esc(k)}" ${k === labStreamer ? 'selected' : ''}>${esc(sname(k))}</option>`).join('')}</select></label>` : ''}</div>
      <div class="mut" style="padding:8px 12px">Aquí entrenas la auto edición sin tocar tus clips: eliges cuánto recorta, la pruebas en un momento y mides si se parece a cómo editas tú.</div></section>
    ${!streamers.length ? '<div class="card mut">Cuando grabes o importes el vídeo de un streamer, aparecerá aquí para entrenar su auto edición.</div>' : `<div class="lgrid2">
      <div class="card"><h3>1. Cuánto recorta</h3>
        <div class="seg fix" role="radiogroup" aria-label="Cuánto recorta" style="margin:10px 0">${L.levels.map((n, i) => `<button role="radio" aria-checked="${i === lv}" class="${i === lv ? 'on' : ''}" data-lablevel="${i}">${n}</button>`).join('')}</div>
        <div class="mut">${LEVEL_HELP[lv]}</div>
        <div class="mut" style="margin-top:6px">En los tres niveles respeta la pausa de justo antes de la reacción.</div></div>
      <div class="card"><h3>2. Pruébala en un momento</h3>
        <div class="mut" style="margin:6px 0 8px">Se abre el editor con la auto edición ya hecha. Marca o desmarca cada propuesta: así aprende lo que te gusta.</div>
        ${moments.length ? moments.map(([s, c]) => `<div class="lrow"><span class="score fix ${c.score >= 8 ? 'hi' : c.score >= 6 ? 'mid' : ''}">${c.score.toFixed(1)}</span><span class="grow">${esc(c.title || (c.text || '').slice(0, 60) || 'Momento en ' + c.at)}</span><button class="sm fix" data-labtry="${s.id}|${c.id}">Probar</button></div>`).join('') : '<div class="mut">Este streamer aún no tiene momentos detectados.</div>'}</div>
      <div class="card"><h3>3. ¿Se parece a cómo editas tú?</h3>
        <div class="mut" style="margin:6px 0 8px">Vuelve a pasar la auto edición por tus últimos clips exportados y la compara con cómo los dejaste. No cambia nada.</div>
        <button class="pri fix" data-labrun ${L.running ? 'disabled' : ''}>${L.running ? `Midiendo… ${L.done} de ${L.total}` : 'Medir ahora'}</button>
        ${L.rows.length && !L.running ? `<div class="lscore"><b>${pct(L.score)} %</b><span class="mut">de parecido en ${L.rows.length} clip${L.rows.length > 1 ? 's' : ''}${L.streamer ? ' de ' + esc(sname(L.streamer)) : ''}</span></div>
          ${Object.entries(L.areas).map(([k, v]) => `<div class="larea"><span>${AREA_NAME[k] || k}</span>${bar(v)}<span class="mono">${pct(v)} %</span></div>`).join('')}
          <div class="chk ${/Suave|Intensa/.test(L.tip) ? 'bad' : 'ok'}" style="margin-top:10px">${esc(L.tip)}</div>` : ''}</div>
      <div class="card"><h3>4. Lo que ha aprendido</h3>
        ${Object.keys(prefs).length ? Object.entries(prefs).sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]).map((e) => `<div class="larea"><span>${esc(kindName(e[0]))}</span>${bar(share(e))}<span class="mut">${disliked(prefs, e[0]) ? 'ya no lo propone' : `lo conservas el ${pct(share(e))} %`}</span></div>`).join('') + '<button class="sm ghost fix" data-labforget style="margin-top:10px">Olvidar lo aprendido</button>' : '<div class="mut" style="margin-top:6px">Todavía nada: prueba la auto edición en un momento y revisa sus propuestas.</div>'}</div>
    </div>`}`;
}
/** Abre el momento en el editor y lanza la auto edicion en cuanto el boton esta listo. */
async function labTry(sid, cid) {
  const s = S.sources.find((x) => x.id === sid), c = s?.candidates.find((x) => x.id === cid);
  if (!c) return toast('Ese momento ya no existe.');
  await toEditor(s, c, null);
  for (let i = 0; i < 100; i++) {
    const b = document.querySelector('#v-editor [data-e=autoedit]');
    if (b && !b.disabled && document.querySelector('#v-editor #epanel')) { b.click(); return; }
    await new Promise((r) => setTimeout(r, 200));
  }
  toast('El editor tardó en abrir: pulsa «Auto edición» tú mismo.');
}

// ---------- cuentas conectadas ----------
const ACC = {
  tiktok: ['TikTok', '#000', '<path d="M14.5 4v9.6a3.6 3.6 0 1 1-3.6-3.6"/><path d="M14.5 4c.5 2.6 2.3 4.2 4.8 4.4"/>'],
  youtube: ['YouTube', '#FF0033', '<rect x="3.5" y="6" width="17" height="12" rx="3.5"/><path d="M10.5 9.6v4.8l4-2.4z" fill="currentColor"/>'],
  discord: ['Discord', '#5865F2', '<path d="M6.5 7.5c3.6-1.6 7.4-1.6 11 0 1.4 2.4 2 5.2 1.8 8.3-1.4 1-2.8 1.6-4.3 2l-.9-1.6M6.5 7.5c-1.4 2.4-2 5.2-1.8 8.3 1.4 1 2.8 1.6 4.3 2l.9-1.6"/><circle cx="9.6" cy="12.6" r="1.1" fill="currentColor"/><circle cx="14.4" cy="12.6" r="1.1" fill="currentColor"/>'],
  telegram: ['Telegram', '#229ED9', '<path d="M20 5 3.8 11.4l5 1.8L18 7.6l-7.4 6.4.3 4.6 2.7-3.1 4 3z"/>'],
};
const ACC_STATE = { ok: ['ok', 'Conectada'], mal: ['bad', 'Revisar'], duda: ['warn', 'Sin respuesta'], falta: ['', 'Sin configurar'] };
const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - +new Date(iso)) / 60000); return m < 1 ? 'comprobado ahora' : m < 60 ? `comprobado hace ${m} min` : `comprobado hace ${Math.round(m / 60)} h`; };
function accHtml() {
  const a = S.accounts;
  if (!a) return '';
  return `<div class="row"><h2 class="fix">Cuentas conectadas</h2><span class="grow"></span><button class="sm fix" data-acccheck ${a.checking ? 'disabled' : ''}>${a.checking ? 'Comprobando…' : 'Comprobar ahora'}</button></div>
    <div class="mut" style="margin:6px 0 10px">Clipper comprueba cada 30 minutos que cada cuenta sigue funcionando, sin publicar nada. Si una deja de funcionar, te avisa en la campana.</div>
    ${Object.entries(ACC).map(([k, [name, color, glyph]]) => { const x = a[k] || { state: 'falta', msg: '' }, [cls, label] = ACC_STATE[x.state] || ACC_STATE.falta; return `<div class="acc">
      <span class="accic" style="background:${color}"><svg viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg></span>
      <span class="grow"><b>${name}</b><span class="mut">${esc(x.msg)}${x.at ? ` · ${ago(x.at)}` : ''}</span></span>
      <span class="accst ${cls}">${a.checking && x.state !== 'falta' ? 'Comprobando…' : label}</span></div>`; }).join('')}`;
}

// ---------- barra lateral ----------
function renderSide() {
  renderNoti();
  const rec = S.sources.filter((s) => s.status === 'grabando').length;
  $('navLive').textContent = rec || '';
  $('navLive').className = 'count' + (rec ? ' rec' : '');
  const pending = S.clips.filter((c) => c.status === 'listo' && !c.youtubeId).length;
  $('navClips').textContent = pending || '';
  const live = S.settings.watch.filter((w) => w.state === 'grabando' || w.state === 'en vivo').length;
  $('navWatch').textContent = live || S.settings.watch.length || '';
  $('navWatch').className = 'count' + (live ? ' rec' : '');
  draw('watch', S.settings.watch.map((w, i) => `<div class="wch"><b>${esc(w.streamer)}</b><span class="mut" style="color:${w.state === 'grabando' || w.state === 'en vivo' ? 'var(--recText)' : ''}">${esc(w.state)}</span><button class="sm ghost icon" data-unwatch="${i}" aria-label="Dejar de vigilar ${esc(w.streamer)}">×</button></div>`).join('') || '<div class="mut" style="padding:0 12px">Añade un canal y se grabará solo cuando entre en directo.</div>', $('watch'));
  const t = S.tools;
  draw('chips', [
    `<span><i class="${t.ytdlp ? 'ok' : ''}"></i>Enlaces ${t.ytdlp ? 'listos' : '(se instala al usar)'}</span>`,
    `<span title="Modelo de voz: ${esc(t.vozModelo || 'pequeño')}"><i class="${t.voz ? 'warn' : 'ok'}"></i>Subtítulos ${t.voz ? 'no disponibles' : /grande/.test(t.vozModelo || '') ? 'automáticos (modelo grande)' : 'automáticos'}</span>`,
    `<span><i class="${t.ia ? 'ok' : ''}"></i>IA ${t.ia ? esc(t.ia) : 'sin activar'}</span>`,
    `<span><i class="${t.youtube ? 'ok' : ''}"></i>YouTube ${t.youtube ? 'configurado' : 'sin configurar'}</span>`,
  ].join(''), $('chips'));
}

// ---------- En vivo ----------
// Como en DaVinci Resolve: a la izquierda lo que tienes (directos y vídeos, igual que su Media Pool), en el centro el
// visor, a la derecha los momentos y el chat, y debajo la linea del directo. Los paneles se muestran u ocultan arriba.
function liveHtml() {
  return `
    <div class="lvrow">
      <aside class="pnl lv-src" aria-label="Directos y vídeos">
        <div class="ph"><h2>Directos y vídeos</h2><span class="grow"></span><span class="count n" id="srcN"></span></div>
        <div class="pb">
          <div class="addbar">
            <svg aria-hidden="true" viewBox="0 0 24 24" style="color:var(--mut)"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>
            <input type="text" id="value" aria-label="Enlace o archivo" placeholder="Pega un enlace o la ruta de un archivo…" />
          </div>
          <div class="row" style="margin-top:6px"><label class="c fix mut" style="min-height:30px"><input type="checkbox" id="live" /> en vivo</label><span class="grow"></span><button class="pri fix sm" id="add">Añadir</button></div>
          <label class="c fix mut" style="min-height:30px" title="Al terminar de analizar el vídeo, sus mejores momentos (nota 8 o más; como mucho uno cada 5 minutos y al menos 3) se auto editan y quedan en «Clips». No se sube nada. En directo no aplica."><input type="checkbox" id="autoClips" ${pref('autoClips', '1') === '1' ? 'checked' : ''} /> Hacer los clips solo</label>
          <div class="mut" id="busy"></div><div class="mut" id="kind"></div>
          <div id="diskWarn"></div><div id="srcChips"></div>
        </div>
      </aside>
      <div id="liveBody"></div>
    </div>`;
}
/** El reproductor oficial del directo (fluido y con sonido) para Twitch y Kick; en el resto, la imagen de la grabacion. */
export function embedUrl(origin, host = location.hostname) {
  const m = /^https?:\/\/(?:www\.|m\.)?(twitch\.tv|kick\.com)\/([\w-]+)/i.exec(origin || '');
  if (!m || /^(videos|clip|clips)$/i.test(m[2])) return '';
  return /twitch/i.test(m[1]) ? `https://player.twitch.tv/?channel=${encodeURIComponent(m[2])}&parent=${encodeURIComponent(host)}&muted=true&autoplay=true` : `https://player.kick.com/${encodeURIComponent(m[2])}?muted=true&autoplay=true`;
}
const platOf = (o) => (/kick\.com/i.test(o || '') ? 'Kick' : 'Twitch');
let liveView = pref('liveView', 'directo');
// Varias grabaciones del mismo canal (por ejemplo, tras cortarse un directo): se numeran como partes para distinguirlas.
const sameName = (x) => S.sources.filter((y) => y.name === x.name).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const partOf = (x) => { const l = sameName(x); return l.length > 1 ? l.indexOf(x) + 1 : 0; };
/** Lo que funciona ahora en Shorts con este streamer (duracion, palabras, hashtags), con su boton para actualizar. */
function trendLine(s) {
  const k = (s.streamer || '').toLowerCase().replace(/^@/, '');
  if (!k) return '';
  const t = S.settings.trends?.[k], ago = t ? Math.round((Date.now() - +new Date(t.at)) / 3600_000) : 0;
  const tip = t ? t.titles.map((x) => `${x.v.toLocaleString('es')} vistas · ${x.t}`).join('\n') : '';
  return `<div class="trend row wrap"><b class="fix">Tendencias en Shorts</b>${t
    ? `<span class="grow mut" title="${esc(tip)}">Duración que funciona: <b>${t.seconds} s</b>${t.words.length ? ' · palabras: ' + t.words.slice(0, 5).map(esc).join(', ') : ''}${t.hashtags.length ? ' · ' + t.hashtags.slice(0, 3).map(esc).join(' ') : ''} · ${t.n} clips, hace ${ago < 1 ? 'menos de 1 h' : ago + ' h'}</span>`
    : `<span class="grow mut">Mira qué funciona ahora con ${esc(s.streamer)}: duración, palabras y títulos de sus Shorts más vistos.</span>`}<button class="sm fix" data-act="trends">${t ? 'Actualizar' : 'Ver tendencias'}</button></div>`;
}
// Dos pestañas: tus directos y videos (por estado) y los clips de la comunidad que importaste (no se mezclan).
let srcTab = pref('srcTab', 'own');
const SRC_GROUPS = [['grabando', 'Grabando ahora'], ['proceso', 'En proceso'], ['listo', 'Terminados']];
const srcGroup = (x) => (x.status === 'grabando' ? 'grabando' : x.status === 'descargando' || x.status === 'analizando' ? 'proceso' : 'listo');
// Cada fila con la misma forma, en dos lineas cortas (apple-design, listas: mejor una linea secundaria que cortar o que
// salte de linea): arriba el streamer y un dato discreto; abajo, en gris, el titulo o de donde viene. Sin «listo»: ya
// lo dice el grupo. Color solo para lo que importa: el punto rojo de lo que se graba ahora (impeccable, modo Operate).
const whenShort = (iso) => { const d = new Date(iso), t = new Date(); const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()); const n = Math.round((+day(t) - +day(d)) / 86_400_000); const h = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); return n === 0 ? `hoy ${h}` : n === 1 ? `ayer ${h}` : d.toLocaleDateString('es', { day: 'numeric', month: 'short' }); };
const unshout = (t) => (t.length > 8 && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t); // los titulos EN MAYUSCULAS gritan
const srcLines = (x) => {
  const name = String(x.name || ''), who = x.streamer || name.split(' · ')[0] || name;
  const rest = name.startsWith(who + ' · ') ? name.slice(who.length + 3) : name !== who ? name : '';
  const from = /kick\.com/.test(x.origin || '') ? 'Kick' : /twitch\.tv/.test(x.origin || '') ? 'Twitch' : 'Archivo';
  return { who, sub: rest ? unshout(rest) : `${from} · ${whenShort(x.createdAt)}` };
};
const srcMeta = (x) => x.status === 'grabando' ? `<span class="rd" aria-hidden="true"></span>${fmt(x.recSeconds)}`
  : x.status === 'descargando' ? esc(dlShort(x.progress).replace(/^descargando /, ''))
  : x.status === 'analizando' ? 'analizando' : x.status === 'error' ? '<span class="bad">error</span>' : x.duration ? fmt(x.duration) : '';
const chip = (x) => { const { who, sub } = srcLines(x); return `<button class="srcchip ${x.id === selSrc ? 'on' : ''}" data-sid="${x.id}" ${x.progress ? `title="${esc(x.progress)}"` : ''}>
  <span class="sr1"><b>${esc(who)}</b>${partOf(x) ? `<span class="sm2">parte ${partOf(x)}</span>` : ''}<span class="sm2">${srcMeta(x)}</span></span><span class="sr2">${esc(sub)}</span></button>`; };
const chipsHtml = () => {
  if (!S.sources.length) return '';
  const own = S.sources.filter((x) => !x.community), com = S.sources.filter((x) => x.community), tab = com.length ? srcTab : 'own';
  const tabs = com.length ? `<div class="seg srctabs" role="tablist" aria-label="Directos o clips de la comunidad">${[['own', 'Directos', own.length], ['com', 'Comunidad', com.length]].map(([k, n, c]) => `<button role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-srctab="${k}">${n}<span class="badge">${c}</span></button>`).join('')}</div>` : '';
  if (tab === 'com') return tabs + `<div class="srcs">${com.map((x) => `<div class="srcrow">${chip(x)}<button class="sm ghost icon fix" data-del="${x.id}" aria-label="Quitar ${esc(x.name)}" title="Quitar">${icon('x', 'sm')}</button></div>`).join('')}</div>`;
  const newest = (p, q) => String(q.createdAt).localeCompare(String(p.createdAt));
  return tabs + (own.length > 1 ? `<div class="srcs"><button class="srcchip ${selSrc === '*' ? 'on' : ''}" data-sid="*"><span class="sr1"><b>Todos</b></span><span class="sr2">${own.length} directos y vídeos</span></button></div>` : '')
    + SRC_GROUPS.map(([k, n]) => { const l = own.filter((x) => srcGroup(x) === k).sort(newest); return l.length ? `<div class="srcgt">${n}</div><div class="srcs">${l.map(chip).join('')}</div>` : ''; }).join('');
};
const START = `<div class="card" style="max-width:640px"><h2>Empieza por aquí</h2><ol class="steps" style="margin-top:10px">
      <li><b>Pega un enlace</b> en «Directos y vídeos»: el canal de un streamer en directo, o un video ya terminado.</li>
      <li><b>Espera los momentos.</b> La app mide el volumen, el chat y la imagen y te lista los mejores.</li>
      <li><b>Edita y exporta.</b> Sale un clip vertical con subtítulos, listo para publicar.</li></ol></div>`;

/**
 * El visor del directo: arriba «Directo» (el reproductor oficial, fluido y con sonido) o «Mi grabación» (lo que va
 * grabando Clipper, con las repeticiones); debajo el Hype y la barra para guardar lo que acaba de pasar.
 * Su HTML no cambia mientras se graba: lo actualiza pulseTick sin redibujarlo (el reproductor no se reinicia).
 */
const rtCard = (s) => {
  const emb = embedUrl(s.origin), mine = !emb || liveView === 'grabacion';
  return `<section class="pnl viewer rt" id="rtCard" aria-label="Visor del directo">
    <div class="ph"><span class="badge rec" id="rtRec">REC</span><h2 class="one">${esc(s.name)}</h2><span class="mut one" id="rtLag" style="font-size:12px"></span><span class="grow"></span>
      ${emb ? `<div class="seg fix" role="radiogroup" aria-label="Qué ver"><button role="radio" class="${mine ? '' : 'on'}" aria-checked="${!mine}" data-liveview="directo" title="El directo en el reproductor de ${platOf(s.origin)}: fluido y con sonido">Directo</button><button role="radio" class="${mine ? 'on' : ''}" aria-checked="${mine}" data-liveview="grabacion" title="Lo que lleva grabado Clipper, con las repeticiones">Mi grabación</button></div>
        <a class="fix" href="${esc(s.origin)}" target="_blank" rel="noopener" style="font-size:12px">Abrir en ${platOf(s.origin)}</a>` : ''}</div>
    <div class="livebox">${emb ? `<iframe id="rtEmbed" title="Directo de ${esc(s.name)} en ${platOf(s.origin)}" src="${esc(emb)}" allow="autoplay; fullscreen" allowfullscreen ${mine ? 'hidden' : ''}></iframe>` : ''}
      <div class="rtmine" id="rtMine" ${mine ? '' : 'hidden'}><img id="rtImg" alt="Imagen del directo" width="640" height="360" hidden /><video id="rtVid" playsinline controls hidden></video><span id="rtWait">La imagen aparece en cuanto haya algo grabado</span>
        <span class="rtbadge" id="rtBadge">En directo</span><span class="rtload" id="rtLoad" hidden>Preparando la repetición…</span></div></div>
    <div class="hype" id="rtHype"><span class="pulse" aria-hidden="true"></span><b class="hlbl">Hype</b>${helpBtn('directo')}<div class="hbar"><i id="rtHeatBar"></i></div><b class="mono" id="rtHeat">–</b>
      <span class="mut one" id="rtWhy">Midiendo…</span><canvas id="rtSpark" role="img" aria-label="Volumen y chat de los últimos dos minutos"></canvas></div>
    <div class="save" role="toolbar" aria-label="Guardar lo que acaba de pasar">
      <span class="grp" role="group" aria-label="Guardar lo último"><span class="glbl">Guardar</span><div class="quick">${[30, 45, 60, 90].map((n) => `<button data-mark="${n}" class="${n === 45 ? 'pri' : ''}">${n} s${n === 45 ? ' <span class="kbdk">Espacio</span>' : ''}</button>`).join('')}</div></span>
      <span class="grp" role="group" aria-label="Repetir"><span class="glbl">Repetir</span>${[[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min']].map(([n, l]) => `<button class="sm fix" data-rt="${n}">${l}${n === 30 ? ' <span class="kbdk">R</span>' : ''}</button>`).join('')}</span>
      <button class="sm fix pri" data-rt="save" id="rtSave" hidden>Guardar este tramo</button><button class="sm fix" data-rt="live" id="rtLive" hidden>Volver al directo</button>
      <span class="grow"></span>
      <button class="sm fix ${voice ? 'danger' : ''}" data-act="voice" aria-pressed="${!!voice}">${icon('voice', 'sm')}${voice ? 'Dejar de escuchar' : 'Di «clip»'}</button>
    </div>
  </section>`;
};
/** El chat del directo, en su pestaña junto a los momentos (lo rellena pulseTick). */
const chatHtml = () => `<div class="rtchat"><div class="row"><span class="mut" id="rtChatSt"></span></div><div class="chatlog" id="rtChat" aria-live="off"></div></div>`;
let rightTab = 'moms';

function liveBody() {
  const root = $('liveBody');
  if (!root) return;
  const mode = (m) => { if (root.dataset.mode === m) return false; root.dataset.mode = m; last.liveBody = null; return true; };
  if (selSrc === '*' && S.sources.length) { mode('all'); return allBody(); }
  const s = cur();
  if (!s) { mode('none'); setBar('live', NAMES.live); return draw('liveBody', S.sources.length ? '' : START, root); }
  const isRec = s.status === 'grabando';
  if (mode(s.id + (isRec ? ':rec' : ':vod')) || !$('lvHead')) {
    root.innerHTML = `<div class="lvcols"><div class="lvc"><div id="lvHead" class="lvslot"></div><div id="lvRt" class="lvslot"></div></div>
      <aside class="pnl lvr" aria-label="Momentos${isRec ? ' y chat' : ''}">${isRec ? `<div class="tabs" role="tablist"><button role="tab" data-rtab="moms" aria-selected="${rightTab === 'moms'}">Momentos</button><button role="tab" data-rtab="chat" aria-selected="${rightTab === 'chat'}">${icon('voice', 'sm')}Chat</button></div>` : ''}
        <div id="lvMoms" class="lvslot" ${isRec && rightTab === 'chat' ? 'hidden' : ''}></div>${isRec ? `<div id="lvChat" ${rightTab === 'chat' ? '' : 'hidden'}>${chatHtml()}</div>` : ''}</aside></div>
      <div id="lvTl" class="lvslot"></div><div id="lvCom" class="lvslot"></div>`;
    last.lvRt = null;
  }
  // Forzar el redibujado no toca el panel del directo: tiene un video que no debe reiniciarse.
  if (last.liveBody == null) last.lvHead = last.lvTl = last.lvMoms = null;
  last.liveBody = 'src';
  const cands = s.candidates.filter(byFilter);
  const frameT = Math.round((s.candidates[0]?.peak ?? s.duration / 2) || 0);
  // La fuente y sus acciones van en la barra de arriba (como el nombre del proyecto en Resolve).
  const info = [s.height ? `${s.height}p` : '', s.progress || '', isRec && s.active ? 'sigue grabando aunque cierres Clipper' : '', s.chat && !isRec ? 'chat: ' + s.chat : '', !isRec && s.duration ? fmt(s.duration) : ''].filter(Boolean).join(' · ');
  setBar('live', `${esc(s.name)}${partOf(s) ? ` · parte ${partOf(s)}` : ''}`, info, `
    ${!isRec && s.origin && /live\.ts$/.test(s.file || '') && !S.sources.some((x) => x.origin === s.origin && x.status === 'grabando') ? `<button class="pri fix sm" data-act="resume" title="Vuelve a conectar con el directo de este canal y lo graba con su chat${s.cut ? '. Se cortó al cerrar Clipper' : ''}">${s.cut ? 'Seguir grabando' : 'Grabar el directo otra vez'}</button>` : ''}
    ${s.active ? `<button class="danger fix sm" data-stop="${s.id}">${isRec ? 'Detener grabación' : 'Cancelar descarga'}</button>` : ''}
    ${s.community && !s.community.at && /twitch\.tv\/(?:[\w-]+\/)?clip\/|clips\.twitch\.tv\/|clip_[A-Za-z0-9]+/.test(s.origin || '') ? `<button class="fix sm" data-comvod="${s.id}" title="Baja del directo ese momento con 1 minuto antes y otro después">${icon('search', 'sm')}Buscar en el directo</button>` : ''}
    <label class="fix sm mut" title="Si el directo es en inglés o mezcla idiomas, los subtítulos de sus clips salen traducidos al español">Idioma <select data-srclang="${s.id}"><option value="">Español</option><option value="mix" ${s.lang === 'mix' ? 'selected' : ''}>Inglés o mezclado</option></select></label>
    <button class="fix sm" data-act="analyze" ${s.status === 'listo' || isRec ? '' : 'disabled'}>Analizar ahora</button>
    <button class="fix sm ghost" data-del="${s.id}">Quitar</button>`);
  const err = s.error ? `<div class="err pnote">${esc(s.error.slice(0, 300))}</div>` : '';
  // Un video ya terminado: su fotograma y, debajo, añadir un tramo a mano (como marcar entrada y salida en Resolve).
  const head = isRec ? err : `
    <section class="pnl viewer" aria-label="Vídeo">
      <div class="ph"><span class="badge fix ${BADGE[s.status] || ''}">${esc(s.status)}</span><h2 class="one">${esc(s.name)}</h2><span class="mut one" style="font-size:12px">${esc(info)}</span></div>
      ${err}
      <div class="livebox">${s.community && s.duration && s.status === 'listo' ? `<video controls preload="metadata" playsinline aria-label="Clip de la comunidad: ${esc(s.name)}" poster="/api/frame?sid=${s.id}&t=${frameT}" src="${previewUrl(s.id, pvWindow(0, s.duration, s.duration))}"></video>`
        : s.analyzedTo || s.duration ? `<img alt="Fotograma del video" width="640" height="360" src="/api/frame?sid=${s.id}&t=${frameT}" />` : 'La imagen aparece en cuanto haya algo descargado'}</div>
      <div class="save"><span class="glbl">Tramo a mano</span><input type="text" id="mFrom" placeholder="inicio 12:30" aria-label="Inicio del tramo" style="width:120px" /><input type="text" id="mTo" placeholder="fin 13:10" aria-label="Fin del tramo" style="width:120px" /><button class="sm fix" data-act="manual">Añadir tramo</button><span class="mut" style="font-size:12px">o haz clic en la línea del directo</span></div>
    </section>`;
  const tl = `
    <div class="card tlcard">
      ${trendLine(s)}
      <div class="legend"><h3 style="margin:0">Línea del directo</h3>${helpBtn('linea')}<span><i style="background:linear-gradient(90deg,#4A505C 50%,#D9DCE3 50%)"></i>Volumen (claro = alto)</span><span><i style="background:var(--info);height:3px;width:14px"></i>Chat</span><span><i style="background:var(--sigV)"></i>Imagen</span><span><i style="background:#F2F2F4;box-shadow:0 0 0 1px var(--line2)"></i>Momento</span><span style="margin-left:auto">Clic para crear un momento ahí</span></div>
      <canvas class="tl" id="tl" role="img" aria-label="Volumen, chat e imagen a lo largo del directo, con los momentos marcados"></canvas>
      <div class="row mono mut" style="justify-content:space-between;margin-top:6px"><span class="fix">0:00</span><span class="fix">${fmt((TL?.seconds || s.duration || 0) / 2)}</span><span class="fix">${fmt(TL?.seconds || s.duration || 0)}</span></div>
    </div>`;
  if (!['mFrom', 'mTo'].includes(document.activeElement?.id)) draw('lvHead', head, $('lvHead'));
  if (draw('lvRt', isRec ? rtCard(s) : '', $('lvRt')) && isRec) { rt = null; pulseTick(); }
  const tlNew = draw('lvTl', tl, $('lvTl'));
  draw('lvCom', comCard(s), $('lvCom'));
  const keep = $('momlist')?.scrollTop || 0;
  const momsNew = draw('lvMoms', momsCard(cands.map((c) => [s, c]), s, isRec), $('lvMoms'));
  if (momsNew && $('momlist')) $('momlist').scrollTop = keep;
  if (tlNew || momsNew) drawTl();
}

// ---------- clips de la comunidad ----------
/** Clips que la gente hizo en Twitch o Kick, por fuente: se piden al pulsar (no en cada refresco). */
const COM = {};
const isComOrigin = (o) => /^https?:\/\/([\w-]+\.)?(twitch\.tv|kick\.com)\//.test(o || '');
function comCard(s) {
  if (!isComOrigin(s.origin) || s.community) return '';
  const c = COM[s.id], plat = /kick\.com/.test(s.origin) ? 'Kick' : 'Twitch';
  if (!c) setTimeout(() => loadCom(s.id)); // se piden solos al abrir la fuente
  const by = c?.sort || 'views', sortBtn = (k, n) => `<button class="sm ${by === k ? 'on' : ''}" data-comsort="${s.id}|${k}" aria-pressed="${by === k}">${n}</button>`;
  const head = `<div class="legend"><h3 style="margin:0">Clips de la comunidad</h3>${c?.list?.length ? `<span class="mut" style="margin-left:auto">${c.list.length} de los últimos 7 días en ${plat}</span><div class="seg fix">${sortBtn('views', 'Más vistos')}${sortBtn('recent', 'Recientes')}</div>` : ''}</div>`;
  if (!c) return `<div class="card">${head}<div class="mut" style="margin:6px 0 10px">Los clips que la gente hizo de este canal en ${plat}: son los momentos que más gustaron. Impórtalos para pasarlos a vertical.</div><button data-comload="${s.id}">Ver los clips de la comunidad</button></div>`;
  if (c.loading) return `<div class="card">${head}<div class="mut" style="margin-top:6px">Buscando los clips…</div></div>`;
  if (c.error) return `<div class="card">${head}<div class="err" style="margin:6px 0 10px">${esc(c.error)}</div><button data-comload="${s.id}">Reintentar</button></div>`;
  if (!c.list.length) return `<div class="card">${head}<div class="mut" style="margin-top:6px">No hay clips de la comunidad esta semana.</div></div>`;
  // Ordenados como se pidio; cada boton guarda el indice en la lista original.
  const rows = c.list.map((k, i) => [k, i]).sort(([x], [y]) => (by === 'recent' ? +new Date(y.at) - +new Date(x.at) : y.views - x.views)), N = c.all ? rows.length : 16;
  return `<div class="card">${head}<div class="comgrid">${rows.slice(0, N).map(([k, i]) => `<div class="comclip">
      <img loading="lazy" alt="" width="160" height="90" src="${esc(k.thumb)}" /><b title="${esc(k.title)}">${esc(k.title)}</b>
      <div class="row"><span class="mut mono grow">${k.views.toLocaleString('es')} vistas · ${fmt(k.seconds)}${by === 'recent' ? ' · ' + clipAge(k.at) : ''}</span><button class="sm fix" data-comimp="${s.id}|${i}" ${c.imported?.[k.id] ? 'disabled' : ''}>${c.imported?.[k.id] ? 'Importado' : 'Importar'}</button></div>
      <a class="btn sm fix" href="${esc(k.platform === 'kick' ? `https://kick.com/${encodeURIComponent((s.origin.match(/kick\.com\/([\w-]+)/) || [])[1] || '')}/clips/${encodeURIComponent(k.id)}` : k.video)}" target="_blank" rel="noopener" title="Ver el clip en ${plat}">${icon('play', 'sm')}Ver</a>
      <button class="sm fix" data-comvod="${s.id}|${i}" title="Baja del directo ese momento con 1 minuto antes y otro después, para rehacerlo mejor o más largo">${icon('search', 'sm')}Buscar en el directo</button></div>`).join('')}</div>${rows.length > N ? `<button class="sm" data-comall="${s.id}" style="margin-top:10px">Ver todos (${rows.length})</button>` : ''}</div>`;
}
/** Hace cuanto se hizo un clip, en corto. */
const clipAge = (at) => { const m = Math.max(0, (Date.now() - +new Date(at)) / 60000); return m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
async function loadCom(sid) {
  if (COM[sid]?.loading) return;
  COM[sid] = { loading: true, sort: COM[sid]?.sort }; liveBody();
  try { COM[sid] = { list: await api('/api/community?sid=' + encodeURIComponent(sid)), imported: {}, sort: COM[sid].sort }; }
  catch (err) { COM[sid] = { error: err.message }; }
  liveBody();
}

// ---------- el directo en tiempo real ----------
let rt = null;
const HEAT = [[75, '¡Pico!', 'hot'], [45, 'Subiendo', 'warm'], [0, 'Tranquilo', '']];
async function pulseTick() {
  const s = cur();
  if (view !== 'live' || !s || s.status !== 'grabando' || !$('rtImg') || document.hidden) return;
  // El contador va aparte: si estuviera en el HTML de la tarjeta, la tarjeta (y el reproductor de Twitch o Kick, que
  // se recargaba y parpadeaba) se redibujaria cada segundo.
  if ($('rtRec')) $('rtRec').textContent = 'REC ' + fmt(s.recSeconds);
  let p;
  try { p = await api('/api/pulse?sid=' + s.id); } catch { return; }
  if (!$('rtImg') || cur()?.id !== s.id) return;
  if (!rt || rt.sid !== s.id) rt = { sid: s.id, replay: null, t: -1, chatSig: '' };
  rt.p = p;
  if (!rt.replay && p.t !== rt.t && p.t > 3) {
    rt.t = p.t;
    // La imagen nueva se carga aparte y se cambia de golpe, para que no parpadee.
    const im = new Image();
    im.onload = () => { const el = $('rtImg'); if (el && rt && !rt.replay) { el.src = im.src; el.hidden = false; $('rtWait').hidden = true; } };
    im.src = `/api/live.jpg?sid=${s.id}&t=${p.t}`;
  }
  const lag = Math.max(0, p.recSeconds - p.t);
  $('rtBadge').textContent = rt.replay ? `Repetición · ${fmt(rt.replay.start)} – ${fmt(rt.replay.end)}` : p.t > 3 ? `En directo · hace ${lag} s` : 'Conectando…';
  $('rtBadge').className = 'rtbadge' + (rt.replay ? ' rep' : '');
  if ($('rtLag')) $('rtLag').textContent = p.t > 3 ? `grabado hace ${lag} s` : 'conectando…';
  const lvl = HEAT.find((h) => p.heat >= h[0]);
  $('rtHeat').textContent = p.t < 20 ? '–' : p.heat;
  $('rtHeatBar').style.width = Math.max(3, p.heat) + '%';
  $('rtHype').className = 'hype ' + lvl[2];
  $('rtWhy').textContent = p.t < 20 ? 'Midiendo el volumen normal del directo…' : `${lvl[1]} · ${p.why}${p.chatNow != null ? ` · ${p.chatNow} msg/s` : ''}`;
  spark(p);
  $('rtChatSt').textContent = p.chatStatus || 'sin chat';
  const sig = p.msgs.length + ':' + (p.msgs[p.msgs.length - 1]?.t ?? '') + (p.msgs[p.msgs.length - 1]?.m ?? '');
  if (sig !== rt.chatSig) {
    rt.chatSig = sig;
    const box = $('rtChat'), stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    // Los emotes de Kick llegan como [emote:123:NOMBRE]: se ven como una etiqueta con su nombre.
    const emotes = (t) => esc(t).replace(/\[emote:\d+:([^\]]+)\]/g, '<span class="emote">$1</span>');
    box.innerHTML = p.msgs.length ? p.msgs.map((m) => `<div class="${m.h ? 'h' : ''}"><b>${esc(m.u || 'chat')}</b>${emotes(m.m)}</div>`).join('') : `<div class="mut">${/leyendo/.test(p.chatStatus) ? 'Esperando mensajes…' : 'Los mensajes aparecen aquí cuando el chat esté conectado (Kick y Twitch).'}</div>`;
    if (stick) box.scrollTop = box.scrollHeight;
  }
}
function spark(p) {
  const cv = $('rtSpark');
  if (!cv || !cv.clientWidth) return;
  const dpr = devicePixelRatio || 1, w = (cv.width = cv.clientWidth * dpr), h = (cv.height = cv.clientHeight * dpr), g = cv.getContext('2d'), n = 120, bw = w / n;
  g.clearRect(0, 0, w, h);
  const off = n - p.audio.length;
  p.audio.forEach((a, i) => { const v = Math.max(0.06, (a + 2) / 10); g.fillStyle = a >= 2 ? '#D9DCE3' : '#4A505C'; g.fillRect((i + off) * bw, h - v * h, Math.max(1, bw - dpr), v * h); });
  if (p.chat.length) { const c = p.chat.slice(-n), o = n - c.length, mx = Math.max(3, ...c); g.strokeStyle = '#60A5FA'; g.lineWidth = 1.5 * dpr; g.beginPath(); c.forEach((v, i) => { const y = h - (v / mx) * h * 0.85 - 2; i ? g.lineTo((i + o) * bw + bw / 2, y) : g.moveTo((i + o) * bw + bw / 2, y); }); g.stroke(); }
}
/** Directo (reproductor oficial) o Mi grabacion (imagen de lo grabado y repeticiones), sin recargar el reproductor. */
function showLiveView(mine) {
  if ($('rtEmbed')) $('rtEmbed').hidden = mine;
  if ($('rtMine')) $('rtMine').hidden = !mine;
  document.querySelectorAll('[data-liveview]').forEach((b) => { const on = (b.dataset.liveview === 'grabacion') === mine; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  segs();
}
/** Repite los ultimos segundos del directo dentro de la app, sin dejar de grabar. */
function replay(n) {
  const p = rt?.p, v = $('rtVid');
  if (!p || !v || p.t < 8) return toast('Aún no hay suficiente directo grabado para repetir.');
  showLiveView(true); // la repeticion es de la grabacion
  const end = p.t, start = Math.max(0, end - n);
  rt.replay = { start, end };
  $('rtLoad').hidden = false; $('rtImg').hidden = true; $('rtWait').hidden = true; v.hidden = false; $('rtSave').hidden = $('rtLive').hidden = false;
  v.onloadeddata = () => { if ($('rtLoad')) $('rtLoad').hidden = true; };
  v.onerror = () => { if (!rt?.replay) return; toast('No pude preparar la repetición. Prueba de nuevo en unos segundos.', 'bad'); backLive(); };
  v.src = `/api/preview?sid=${rt.sid}&start=${start}&end=${end}`;
  v.play().catch(() => {});
  pulseTick();
}
function backLive() {
  const v = $('rtVid');
  if (!v || !rt) return;
  rt.replay = null; rt.t = -1;
  showLiveView(!$('rtEmbed') || liveView === 'grabacion'); // vuelve a lo que habia elegido
  v.onerror = null; v.pause(); v.removeAttribute('src'); v.load(); v.hidden = true;
  $('rtLoad').hidden = $('rtSave').hidden = $('rtLive').hidden = true; $('rtImg').hidden = !$('rtImg').src;
  pulseTick();
}
setInterval(pulseTick, 2000);

// ---------- lista de momentos (de una fuente o de todas) ----------
const pk = (s, c) => s.id + '|' + c.id;
const byFilter = (c) => (filter === 'nuevos' ? !c.exported && !c.dup : filter === 'mios' ? c.by === 'manual' || c.by === 'chat' : true);
const thumb = (s, c) => `/api/frame?sid=${s.id}&t=${Math.round(c.by === 'manual' ? c.start + 2 : Math.min(c.peak, c.end - 1))}&sm=1`;
const acts = (c) => `<div class="row wrap"><button class="light fix sm" data-edit="${c.id}">Editar</button><button class="fix sm" data-quick="${c.id}">Exportar ya</button>
  <button class="fix ghost sm" data-discard="${c.id}" title="No es buen momento: la app aprende de esto" style="margin-left:auto">Descartar</button></div>`;
const tags = (c) => [c.wait ? 'en curso' : '', c.by === 'manual' ? 'tuyo' : c.by === 'chat' ? 'pidió el chat' : c.by === 'comunidad' || c.clipped ? 'comunidad' : '', /chat se dispar/.test(c.why) ? 'chat' : '', /volumen (muy )?alto/.test(c.why) ? 'gritos' : '', /imagen/.test(c.why) ? 'imagen' : '', /expresi|palabra/.test(c.why) ? 'reacción' : '', /en cámara|a la vez|idas y vueltas/.test(c.why) ? 'caras' : ''].filter(Boolean);
const marks = (c) => `${c.exported ? '<i class="done">exportado</i>' : ''}${c.dup ? `<i class="warn" title="Ya está en el clip «${esc(c.dup)}»">repetido</i>` : ''}`;
/** Desglose de la puntuación: cuánto pesó cada señal en este momento. */
export function signals(c, cls = 'sig') {
  const f = c.features;
  if (!f) return '';
  const m = (label, v, max, color) => (cls === 'sig' ? `<div><div class="meter"><b style="width:${Math.round(Math.max(0.04, Math.min(1, v / max)) * 100)}%;background:${color}"></b></div><span>${label}</span></div>`
    : `<div class="sigrow"><span>${label}</span><div class="meter"><b style="width:${Math.round(Math.max(0.04, Math.min(1, v / max)) * 100)}%;background:${color}"></b></div></div>`);
  return `<div class="${cls === 'sig' ? 'sig' : ''}">${m('Volumen', f.audio, 5, 'var(--text)')}${m('Chat', f.chat, 5, 'var(--info)')}${m('Reacción', f.hype + f.density / 2, 4, 'var(--sigR)')}${m('Imagen', f.visual || 0, 6, 'var(--sigV)')}${f.face != null ? m('Caras', f.face + Math.min(2, (f.turns || 0) / 6), 5, 'var(--sigF)') : ''}</div>`;
}
function momRow(s, c, all) {
  const open = openMom === pk(s, c), on = picked.has(pk(s, c));
  return `<article class="mrow ${on ? 'sel' : ''} ${open ? 'open' : ''} ${firstSeen.has(pk(s, c)) ? 'new' : ''}" data-src="${s.id}">
    <div class="mhead" data-open="${pk(s, c)}" role="button" tabindex="0" aria-expanded="${open}">
      <input class="fix" type="checkbox" data-pick="${pk(s, c)}" ${on ? 'checked' : ''} aria-label="Añadir al lote" />
      <img class="fix" loading="lazy" alt="" width="160" height="90" src="${thumb(s, c)}" />
      ${c.n ? `<span class="mnum fix" title="Número de generación">#${c.n}</span>` : ''}
      <span class="score fix ${c.score >= 8 ? 'hi' : c.score >= 6 ? 'mid' : ''}">${c.score.toFixed(1)}</span>
      <div class="grow"><div class="mt">${esc(c.title || c.text || 'Momento en ' + c.at)}</div>
        <div class="mut ms">${all ? `<b>${esc(s.name)}</b>` : ''}<span class="mono">${c.at} · ${c.len} s</span>${marks(c)}${tags(c).map((t) => `<i>${t}</i>`).join('')}</div></div>
    </div>
    ${open ? `<div class="mbody">${signals(c)}<div class="mut">${esc(c.why)}${c.dup ? ` · ya está en el clip «${esc(c.dup)}»` : ''}</div>${c.text ? `<div class="mtxt">${esc(c.text)}</div>` : ''}${acts(c)}</div>` : ''}
  </article>`;
}
function momBig(s, c, all) {
  const on = picked.has(pk(s, c));
  return `<article class="mom ${on ? 'sel' : ''} ${firstSeen.has(pk(s, c)) ? 'new' : ''}" data-src="${s.id}"><img loading="lazy" alt="" width="160" height="90" src="${thumb(s, c)}" />
    <div class="grow">
      <div class="row">${c.n ? `<span class="mnum fix" title="Número de generación">#${c.n}</span>` : ''}<span class="score fix ${c.score >= 8 ? 'hi' : c.score >= 6 ? 'mid' : ''}">${c.score.toFixed(1)}</span><b class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title || 'Momento en ' + c.at)}</b><span class="mut ms fix">${BY[c.by] || ''}${marks(c)}</span></div>
      <div class="mut" style="margin:4px 0 8px">${all ? esc(s.name) + ' · ' : ''}${c.at} · ${c.len} s · ${esc(c.why)}</div>
      ${c.text ? `<div class="mut" style="margin:-4px 0 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(c.text)}</div>` : ''}
      <div class="row wrap"><label class="c fix mut"><input type="checkbox" data-pick="${pk(s, c)}" ${on ? 'checked' : ''} /> lote</label></div>${acts(c)}
    </div></article>`;
}
/** Tarjeta de momentos. `pairs` son parejas [fuente, momento]; `one` es la fuente cuando la lista es de una sola. */
function momsCard(pairs, one, isRec) {
  const item = ([s, c]) => (dense ? momRow : momBig)(s, c, !one);
  let listHtml = '';
  if (sortBy === 'tiempo' && one) {
    // Por orden del directo se agrupan en bloques de 10 minutos que se pueden plegar.
    const groups = new Map();
    for (const x of [...pairs].sort((x, y) => x[1].start - y[1].start)) { const k = Math.floor(x[1].start / 600); (groups.get(k) || groups.set(k, []).get(k)).push(x); }
    listHtml = [...groups].map(([k, l]) => { const shut = folded.has(k); return `<button class="mgroup" data-fold="${k}" aria-expanded="${!shut}"><span>${icon(shut ? 'right' : 'down', 'sm')} ${fmt(k * 600)} – ${fmt(k * 600 + 600)}</span><span class="mut">${l.length} · mejor ${Math.max(...l.map((x) => x[1].score)).toFixed(1)}</span></button>${shut ? '' : l.map(item).join('')}`; }).join('');
  } else if (sortBy === 'tiempo') {
    // Con varias fuentes, "por minuto" agrupa por directo.
    const groups = new Map();
    for (const x of pairs) (groups.get(x[0].id) || groups.set(x[0].id, []).get(x[0].id)).push(x);
    listHtml = [...groups].map(([k, l]) => { const shut = folded.has(k); return `<button class="mgroup" data-fold="${k}" aria-expanded="${!shut}"><span>${icon(shut ? 'right' : 'down', 'sm')} ${esc(l[0][0].name)}</span><span class="mut">${l.length} · mejor ${Math.max(...l.map((x) => x[1].score)).toFixed(1)}</span></button>${shut ? '' : l.sort((x, y) => x[1].start - y[1].start).map(item).join('')}`; }).join('');
  } else if (sortBy === 'orden') {
    const groups = new Map();
    for (const x of pairs) {
      const group = x[1].by === 'comunidad' ? 'community' : 'generated';
      (groups.get(group) || groups.set(group, []).get(group)).push(x);
    }
    listHtml = [['generated', 'Generados'], ['community', 'De la comunidad']]
      .filter(([key]) => groups.has(key))
      .map(([key, title]) => {
        const rows = groups.get(key).sort((x, y) => (x[1].n || 0) - (y[1].n || 0));
        const foldKey = 'g:' + key;
        const shut = folded.has(foldKey);
        return `<button class="mgroup" data-fold="${foldKey}" aria-expanded="${!shut}"><span>${icon(shut ? 'right' : 'down', 'sm')} ${title}</span><span class="mut">${rows.length}</span></button>${shut ? '' : rows.map(item).join('')}`;
      }).join('');
  } else listHtml = [...pairs].sort((x, y) => y[1].score - x[1].score).map(item).join('');
  const seg = (attr, val, opts) => `<div class="seg fix">${opts.map(([k, n]) => `<button class="${val === k ? 'on' : ''}" data-${attr}="${k}">${n}</button>`).join('')}</div>`;
  const empty = !one ? 'Todavía no hay momentos en ninguna fuente.' : isRec ? 'Grabando. Los momentos aparecen solos en cuanto el volumen o el chat se disparen; mientras, usa los botones de guardar.' + (() => { const prev = sameName(one).filter((y) => y !== one && y.candidates.length); return prev.length ? `<div style="margin-top:12px">Los momentos de antes siguen en ${prev.map((y) => `<button class="sm" data-sid="${y.id}">${esc(y.name)} · parte ${partOf(y)} (${y.candidates.length})</button>`).join(' ')}</div>` : ''; })() : one.status === 'listo' ? 'No hay momentos en este filtro. Haz clic en la línea de tiempo para crear uno.' : one.status === 'error' ? 'Esta fuente falló. Mira el mensaje en rojo y el registro en Ajustes.' : 'Trabajando…';
  return `<div class="card moms">
      <div class="row wrap"><h2 class="fix">Momentos</h2><span class="count fix">${pairs.length}</span>${helpBtn('momentos')}<span class="grow"></span>${one && pairs.length ? `<button class="pri fix sm" data-act="sacar">${icon('sparkle')}Sacar clips</button>` : ''}${seg('filter', filter, [['todos', 'Todos'], ['nuevos', 'Sin exportar'], ['mios', 'Tuyos']])}</div>
      <div class="row wrap" style="margin-top:8px">${seg('sort', sortBy, [['orden', 'Por generación'], ['score', 'Mejores'], ['tiempo', one ? 'Por minuto' : 'Por directo']])}<span class="grow"></span>${seg('dense', dense ? '1' : '0', [['1', 'Compacta'], ['0', 'Detallada']])}</div>
      <div class="momlist" id="momlist">${pairs.length ? listHtml : `<div class="empty">${empty}</div>`}</div>
      <div class="batch"><span class="grow">${picked.size ? `<b>${picked.size} seleccionado${picked.size > 1 ? 's' : ''}</b>` : 'Marca momentos para exportarlos juntos'}<span class="mut"> · plantilla de ${one ? esc(one.streamer || 'esta fuente') : 'cada streamer'}</span></span>
        <button class="fix" data-act="top3" ${pairs.length ? '' : 'disabled'}>Los 3 mejores</button><button class="fix pri" data-act="batch" ${picked.size ? '' : 'disabled'}>Exportar el lote</button></div>
    </div>`;
}
const allPairs = () => S.sources.flatMap((s) => s.candidates.filter(byFilter).map((c) => [s, c]));
/** Vista "Todos": los momentos de todas las fuentes mezclados, para seguir varios directos a la vez. */
function allBody() {
  const rec = S.sources.filter((s) => s.status === 'grabando');
  setBar('live', 'Todos los directos', `${rec.length ? rec.length + ' grabando ahora' : 'ninguno grabando ahora'} · ${S.sources.length} fuentes`);
  const head = `<div class="card"><div class="row wrap"><h2 class="fix" style="font-size:22px">Todos los directos</h2><span class="mut grow">${rec.length ? rec.length + ' grabando ahora' : 'Ninguno grabando ahora'} · ${S.sources.length} fuentes</span></div>
    <div class="allsrc">${S.sources.map((s) => `<button class="srcline" data-sid="${s.id}"><b>${esc(s.name)}</b><span class="badge ${BADGE[s.status] || ''}">${s.status === 'grabando' ? 'REC ' + fmt(s.recSeconds) : esc(s.status)}</span><span class="mut grow">${esc(s.progress || '')}</span><span class="mut fix">${s.candidates.length} ${s.candidates.length === 1 ? "momento" : "momentos"}${s.candidates[0] ? ' · mejor ' + s.candidates[0].score.toFixed(1) : ''}</span></button>`).join('')}</div></div>`;
  const keep = $('momlist')?.scrollTop || 0;
  if (draw('liveBody', `<div class="cols"><div class="a">${head}</div><div class="b" style="flex:3 1 480px">${momsCard(allPairs(), null, false)}</div></div>`, $('liveBody')) && $('momlist')) $('momlist').scrollTop = keep;
}

// ---------- guardar por voz ----------
let voice = null;
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Este navegador no ofrece reconocimiento de voz. Usa Chrome o Edge.', 'bad');
  if (voice) { const v = voice; voice = null; v.onend = null; v.stop(); last.liveBody = null; return liveBody(); }
  const v = (voice = new SR());
  let lastHit = 0;
  Object.assign(v, { lang: 'es-CO', continuous: true, interimResults: false });
  v.onresult = (ev) => {
    const said = ev.results[ev.results.length - 1][0].transcript.toLowerCase();
    if (!/clip/.test(said) || Date.now() - lastHit < 8000) return;
    lastHit = Date.now();
    const s = (cur()?.status === 'grabando' && cur()) || S.sources.find((x) => x.status === 'grabando');
    if (s) api('/api/mark', { sid: s.id, last: 45 }).then(() => { beep(); toast(`Guardado por voz: últimos 45 s de ${s.name}`, 'good'); refresh(); }).catch((err) => toast(err.message, 'bad'));
  };
  v.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { voice = null; toast('Permite el micrófono en el navegador para guardar por voz.', 'bad'); last.liveBody = null; liveBody(); } };
  v.onend = () => { if (voice === v) try { v.start(); } catch {} };
  v.start();
  toast('Escuchando: di «clip» o «clipéalo» y se guardan los últimos 45 s.');
  last.liveBody = null; liveBody();
}

async function loadTl() {
  const s = cur();
  if (!s) return;
  try { TL = await api('/api/timeline?sid=' + s.id); tlFor = s.id; last.liveBody = null; liveBody(); } catch {}
}
function drawTl() {
  const cv = $('tl'), s = cur();
  if (!cv || !s) return;
  const dpr = devicePixelRatio || 1, w = (cv.width = cv.clientWidth * dpr), h = (cv.height = cv.clientHeight * dpr), g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!TL || tlFor !== s.id || !TL.audio.length) { g.fillStyle = '#92929F'; g.font = `${12 * dpr}px system-ui`; g.fillText('La línea de tiempo aparece tras el primer análisis.', 12 * dpr, h / 2); return; }
  const n = TL.audio.length, bw = w / n;
  for (const c of s.candidates) { const x0 = (c.start / TL.seconds) * w, x1 = (c.end / TL.seconds) * w; g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x0, 0, Math.max(2, x1 - x0), h); g.fillStyle = '#F2F2F4'; g.fillRect(x0, 0, 2 * dpr, h); }
  TL.audio.forEach((a, i) => { const v = Math.max(0.05, (a + 2) / 10); g.fillStyle = a >= 1.2 ? '#D9DCE3' : '#4A505C'; g.fillRect(i * bw, h - v * h * 0.86, Math.max(1, bw - 0.5), v * h * 0.86); });
  (TL.visual || []).forEach((v, i) => { if (v) { g.fillStyle = '#FF8A50'; g.fillRect(i * bw, 0, Math.max(2, bw), 5 * dpr); } });
  if (TL.chat.length) { const mx = Math.max(1, ...TL.chat); g.strokeStyle = '#60A5FA'; g.lineWidth = 1.5 * dpr; g.beginPath(); TL.chat.forEach((c, i) => { const y = h - (c / mx) * h * 0.8 - 3; i ? g.lineTo(i * bw + bw / 2, y) : g.moveTo(bw / 2, y); }); g.stroke(); }
}
addEventListener('resize', drawTl);
setInterval(() => { const s = cur(); if (view === 'live' && s && (s.status === 'grabando' || s.status === 'analizando' || tlFor !== s.id)) loadTl(); }, 8000);

// ---------- Clips y publicación ----------
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function slotHours() {
  // Las horas sugeridas salen de las horas en que tus clips tuvieron más vistas; si aún no hay datos, mediodía y noche.
  const g = (S.report.groups || []).find((x) => x.name === 'Hora de publicación');
  const best = (g?.rows || []).filter((r) => /^\d+:00$/.test(r.k)).slice(0, 2).map((r) => parseInt(r.k));
  return (best.length === 2 ? best : [12, 19]).sort((a, b) => a - b);
}
/** Una fila de «Publicar en»: icono de la app, en que va y que se puede hacer. */
function pubRow(c, app) {
  const [name, color, glyph] = ACC[app];
  const ic = `<span class="pubic" style="background:${color}"><svg viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg></span>`;
  const yt = app === 'youtube';
  const up = yt ? c.youtubeId : c.tiktokAt;
  const link = yt ? `https://youtu.be/${c.youtubeId}` : S.settings.tiktokAccount ? `https://www.tiktok.com/@${S.settings.tiktokAccount}` : '';
  const busy = yt ? c.uploading : c.tiktokUploading, pct = yt ? c.ytPct : c.ttPct;
  const failed = !yt && !busy && !c.tiktokAt && c.note?.startsWith('TikTok:') ? c.note.slice(7).trim() : '';
  const ready = yt ? S.tools.youtube : S.tools.tiktokReady;
  let state;
  if (up) state = `<span class="pubok grow">Publicado ✓</span>${link ? `<a class="sm fix" href="${link}" target="_blank" rel="noopener">Ver</a>` : ''}`;
  else if (busy) state = `<span class="pubbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct ?? 0}" aria-label="Subiendo a ${name}"><i style="width:${Math.max(4, pct ?? 0)}%"></i></span><span class="mono pubpct">${pct ?? 0} %</span>`;
  else if (!ready) state = `<span class="grow"></span><button class="sm ghost fix" data-gosettings title="${name} no está conectado: se conecta en Ajustes">Conectar</button>`;
  else if (failed) state = `<span class="puberr grow" title="${esc(failed)}">Falló: ${esc(failed.slice(0, 60))}</span><button class="sm fix" data-${yt ? 'up' : 'uptt'}="${c.id}">Reintentar</button>`;
  else state = `<span class="grow"></span><button class="sm pri fix" data-${yt ? 'up' : 'uptt'}="${c.id}" aria-label="Subir a ${name}" title="${yt ? (c.scheduledAt ? 'Se sube programado a su hora' : 'Se sube en privado') : 'Se publica en tu cuenta'}">Subir</button>`;
  const step = busy && !yt && c.ttStep ? `<div class="mut pubstep">${esc(c.ttStep)}</div>` : '';
  return `<div class="pubrow">${ic}<b>${name}</b>${state}</div>${step}`;
}
// Clips como el Media Pool + Inspector de Resolve: biblioteca (filtros) | galeria | detalles, y el calendario abajo.
const CTABS = { pub: (c) => !c.youtubeId && !c.tiktokAt && !c.scheduledAt, prog: (c) => !!c.scheduledAt && !c.youtubeId && !c.tiktokAt, hecho: (c) => !!(c.youtubeId || c.tiktokAt) };
const CTAB_N = { pub: 'Por publicar', prog: 'Programados', hecho: 'Publicados' };
const dlHref = (c) => `${c.file}?dl=${encodeURIComponent((c.title || c.id).replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '').trim() || c.id)}.mp4`;
const canEdit = (c) => c.kind === 'clip' && S.sources.some((x) => x.id === c.sid);
const byKind = (c) => !clipKind || (clipKind === 'montaje') === (c.kind === 'montaje');
const byStr = (c) => !clipStreamer || skey(c.streamer) === clipStreamer;
/** Los clips que se ven en la galeria con los filtros de la biblioteca y la busqueda. */
function clipList() { const q = clipQ.trim().toLowerCase(); return S.clips.filter((c) => CTABS[clipTab](c) && byStr(c) && byKind(c) && (!q || (c.title || '').toLowerCase().includes(q))); }
function clipCard(c) {
  const tag = c.status === 'listo' ? (c.youtubeId || c.tiktokAt ? ['', 'Publicado'] : c.scheduledAt ? ['prog', 'Programado'] : ['', c.kind === 'montaje' ? 'Montaje' : 'Listo']) : c.status === 'error' ? ['bad', 'Error'] : ['work', c.status];
  return `<article class="clip ${pickedClips.has(c.id) ? 'sel' : ''} ${openClip === c.id ? 'open' : ''} ${justDone.has(c.id) ? 'done' : ''}" draggable="${c.status === 'listo'}" data-drag="${c.id}" data-openclip="${c.id}" tabindex="0" aria-label="${esc(c.title || 'Clip')}: ver detalles">
    <div class="th">${c.file ? (c.cover ? `<img src="${c.cover}" alt="" loading="lazy" />` : `<video src="${c.file}#t=1" preload="metadata" muted></video>`) : c.status !== 'error' ? `<div class="thwork" role="status"><span class="ndot" aria-hidden="true"></span><b>${c.status === 'en cola' ? 'En cola' : 'Exportando'}</b><span class="mono">${c.progress != null && c.status !== 'en cola' ? Math.round(c.progress) + ' %' : ''}</span></div>` : ''}
      <span class="tag ${tag[0]}">${esc(tag[1])}</span>${c.seconds ? `<span class="len">${fmt(c.seconds)}</span>` : ''}
      ${c.status === 'listo' ? `<input class="pick" type="checkbox" data-pickclip="${c.id}" ${pickedClips.has(c.id) ? 'checked' : ''} aria-label="Seleccionar clip" />` : ''}</div>
    ${c.progress != null && c.status !== 'listo' ? `<div class="bar"><i style="width:${c.progress}%"></i></div>` : ''}
    <div class="cmeta"><b class="one">${esc(c.title || 'Sin título')}</b><span class="mut one">${esc(c.streamer || '')}${c.variant ? ' · ' + VAR[c.variant] : ''}${c.platform ? ' · ' + (PLAT[c.platform] || esc(c.platform)) : ''}</span></div>
    ${c.error ? `<div class="err">${esc(c.error)}</div>` : ''}
    ${c.file ? `<div class="row cacts"><a class="btn sm grow" href="${dlHref(c)}" download>${icon('dl', 'sm')}Descargar</a>${canEdit(c) ? `<button class="sm icon fix" data-editclip="${c.id}" aria-label="Editar el clip" title="Editar">${icon('pen', 'sm')}</button>` : ''}</div>`
      : c.status === 'error' ? `<button class="sm ghost" data-clipdel="${c.id}">Quitar</button>` : ''}
  </article>`;
}
function clipDet(c) {
  if (!c) return '<div class="pb"><div class="empty">Elige un clip para verlo, publicarlo o descargarlo.</div></div>';
  const when = c.scheduledAt ? new Date(c.scheduledAt).toLocaleString('es', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="pb">
    <div class="sect">${c.file ? `<video class="dvid" src="${c.file}" poster="${c.cover || ''}" preload="metadata" controls></video>` : ''}
      <input type="text" value="${esc(c.title)}" placeholder="Título del clip" data-title="${c.id}" aria-label="Título del clip" style="font-weight:600" /></div>
    <div class="sect"><dl class="kv"><dt>Streamer</dt><dd>${esc(c.streamer || '—')}</dd><dt>Duración</dt><dd class="mono">${c.seconds ? fmt(c.seconds) : '—'}</dd>
      ${c.variant ? `<dt>Versión</dt><dd>${VAR[c.variant]}</dd>` : ''}${c.platform ? `<dt>Para</dt><dd>${PLAT[c.platform] || esc(c.platform)}</dd>` : ''}${when ? `<dt>Programado</dt><dd>${when}</dd>` : ''}</dl>
      ${c.error ? `<div class="err">${esc(c.error)}</div>` : ''}${c.note && !c.note.startsWith('TikTok:') ? `<div class="mut">${esc(c.note)}</div>` : ''}</div>
    ${c.file ? `<div class="sect"><h3>Publicar</h3><div class="pubs" aria-label="Publicar en">${pubRow(c, 'youtube')}${pubRow(c, 'tiktok')}</div></div>
    <div class="sect row wrap"><a class="btn pri fix" href="${dlHref(c)}" download>${icon('dl', 'sm')}Descargar</a>${canEdit(c) ? `<button class="fix" data-editclip="${c.id}">${icon('pen', 'sm')}Editar</button>` : ''}<span class="grow"></span>
      <button class="fix danger icon" data-clipdel="${c.id}" aria-label="Borrar el clip" title="Borrar">${icon('trash', 'sm')}</button></div>` : ''}
  </div>`;
}
const galHtml = (list) => list.map(clipCard).join('') || `<div class="empty" style="grid-column:1/-1">${clipQ ? 'Ningún clip con ese título.' : 'No hay clips aquí todavía. Exporta un momento desde «Media».<div style="margin-top:12px"><button class="pri" data-view="live">Ir a Media</button></div>'}</div>`;
/** Lo que rinde: vistas por arranque (pruebas de gancho) y por origen, encuadre, duracion y hora. */
function perfHtml(done) {
  const tests = new Map();
  for (const c of done) if (c.variantOf && c.variant) tests.set(c.variantOf, [...(tests.get(c.variantOf) || []), c]);
  const total = done.reduce((t, c) => t + c.views, 0), best = (S.report.groups || []).find((g) => g.name === 'Inicio del clip')?.rows[0];
  return `<div class="pb">
    <div class="stats" style="margin-bottom:14px"><span><b>${total.toLocaleString('es')}</b> vistas de tus clips</span><span>Mejor arranque: <b>${best ? esc(best.k) : 'aún sin datos'}</b></span></div>
    ${tests.size ? `<h3>Pruebas de gancho</h3><div class="mut" style="margin:4px 0 8px">Publica las versiones y anota sus vistas en «Resultados»: aquí ves cuál arranque funciona mejor.</div>
      ${[...tests.values()].slice(0, 6).map((l) => { const mx = Math.max(...l.map((c) => c.views)); return `<div class="test"><b>${esc((l[0].title || 'Clip').slice(0, 40))}</b>${l.sort((x, y) => x.variant.localeCompare(y.variant) || (x.platform || '').localeCompare(y.platform || '')).map((c) => `<div class="row"><span class="grow">${VAR[c.variant]}${c.platform ? ' · ' + PLAT[c.platform] : ''}</span><span class="mono fix ${mx > 0 && c.views === mx ? 'win' : ''}">${c.views.toLocaleString('es')} vistas${mx > 0 && c.views === mx ? ' ' + icon('check', 'sm') : ''}</span></div>`).join('')}</div>`; }).join('')}` : ''}
    ${(S.report.groups || []).length ? S.report.groups.map((g) => `<h3 style="margin-top:12px">${esc(g.name)}</h3><table>${g.rows.map((r) => `<tr><td>${esc(r.k)}</td><td class="n">${r.n} clips</td><td class="n">${r.avg.toLocaleString('es')} vistas de media</td></tr>`).join('')}</table>`).join('') : '<div class="mut" style="margin-top:8px">Cuando tus clips tengan vistas, aquí verás qué origen, encuadre, duración y hora funcionan mejor.</div>'}
  </div>`;
}
function clipsHtml() {
  const list = clipList(), done = S.clips.filter((c) => c.status === 'listo');
  const oc = list.find((c) => c.id === openClip) || list[0];
  const streamers = [...new Set(S.clips.map((c) => skey(c.streamer)))];
  const nl = (attr, k, on, name, n) => `<button class="nl" data-${attr}="${esc(k)}" aria-pressed="${on}">${esc(name)}<span class="r">${n}</span></button>`;
  const cnt = (f) => S.clips.filter(f).length;
  const hours = slotHours(), today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() + i); return d; });
  const sched = S.clips.filter((c) => c.scheduledAt);
  const cal = week.map((d) => `<div class="day"><div class="dn">${DAYS[d.getDay()]} ${d.getDate()}</div>${hours.map((h) => {
    const at = new Date(d); at.setHours(h);
    const here = sched.filter((c) => Math.abs(+new Date(c.scheduledAt) - +at) < 1800_000);
    const past = +at < Date.now();
    return here.length ? here.map((c) => `<div class="slot busy" role="button" tabindex="0" aria-label="${esc(c.title || 'Clip')}, programado a las ${h}:00. Pulsa para quitarlo del calendario" title="${esc(c.title || 'Clip')} · clic para quitar del calendario" data-unsched="${c.id}">${h}:00 ${esc((c.title || 'clip').slice(0, 10))}</div>`).join('') : `<div class="slot" ${past ? 'style="opacity:.35" aria-hidden="true"' : `role="button" tabindex="0" aria-label="Programar el clip seleccionado el ${DAYS[d.getDay()]} ${d.getDate()} a las ${h}:00" data-slot="${at.toISOString()}"`}>${h}:00</div>`;
  }).join('')}</div>`).join('');
  const ready = list.filter((c) => c.status === 'listo'), all = ready.length && ready.every((c) => pickedClips.has(c.id));
  return `<div class="wsrow">
    <aside class="pnl wsl clib" aria-label="Biblioteca de clips"><div class="ph"><h2>Biblioteca</h2>${helpBtn('clips')}</div>
      <div class="pb navlist"><span class="lbl">Estado</span>${Object.keys(CTABS).map((k) => nl('cliptab', k, clipTab === k, CTAB_N[k], cnt((c) => CTABS[k](c) && byStr(c) && byKind(c)))).join('')}
        ${streamers.length > 1 ? `<span class="lbl">Streamer</span>${[['', 'Todos'], ...streamers.map((k) => [k, k === 'general' ? 'Sin streamer' : k])].map(([k, n]) => nl('clipstreamer', k, clipStreamer === k, n, cnt((c) => !k || skey(c.streamer) === k))).join('')}` : ''}
        <span class="lbl">Tipo</span>${[['', 'Todos'], ['clip', 'Clips'], ['montaje', 'Montajes']].map(([k, n]) => nl('clipkind', k, clipKind === k, n, cnt((c) => !k || (k === 'montaje') === (c.kind === 'montaje')))).join('')}</div></aside>
    <section class="pnl wsc" aria-label="${showPerf ? 'Qué rinde más' : 'Galería de clips'}">
      ${showPerf ? `<div class="ph"><h2>Qué rinde más</h2><span class="grow"></span><button class="sm fix" data-act="perf">Volver a la galería</button></div>${perfHtml(done)}` : `
      <div class="ph"><h2>${CTAB_N[clipTab]} · ${list.length}</h2><span class="grow"></span>
        <label class="field csearch">${icon('search', 'sm')}<input type="text" id="cq" value="${esc(clipQ)}" placeholder="Buscar por título…" aria-label="Buscar clips" /></label>
        ${ready.length ? `<button class="sm fix" data-act="pickall" data-k="${all ? 0 : 1}">${all ? 'Quitar selección' : 'Seleccionar todos'}</button>` : ''}</div>
      <div class="pb"><div class="grid" id="cgal">${galHtml(list)}</div></div>
      <div class="pfoot"><b class="psel ${pickedClips.size ? '' : 'none'}">${pickedClips.size ? `${pickedClips.size} elegido${pickedClips.size > 1 ? 's' : ''}` : 'Marca clips para hacer algo con varios'}</b><span class="grow"></span>
        ${pickedClips.size >= 2 && transList.length ? `<select class="fix" data-monttrans aria-label="Transición entre clips"><option value="">Sin transición</option>${transList.map((t) => `<option value="${t.id}" ${montTrans === t.id ? 'selected' : ''}>${esc(t.cat)} · ${esc(t.name)}</option>`).join('')}</select>` : ''}
        <button class="sm fix" data-act="dlpicked" ${pickedClips.size ? '' : 'disabled'}>${icon('dl', 'sm')}Descargar</button>
        <button class="sm fix" data-act="montage" ${pickedClips.size >= 2 ? '' : 'disabled'}>${icon('join', 'sm')}Unir en un montaje (${pickedClips.size})</button>
        <button class="sm fix danger" data-act="delpicked" ${pickedClips.size ? '' : 'disabled'} title="Borra los clips elegidos y sus archivos">Borrar (${pickedClips.size})</button></div>`}
    </section>
    <aside class="pnl wsr cdet" id="cdet" aria-label="Detalles del clip"><div class="ph"><h2>Detalles</h2></div>${clipDet(oc)}</aside>
  </div>
  <section class="pnl dock ccal" aria-label="Calendario"><div class="ph"><h2>Próximos 7 días</h2><span class="mut">arrastra un clip a un hueco</span><span class="grow"></span></div>
    <div class="pb"><div class="week">${cal}</div>
    <div class="mut" style="margin-top:10px">${S.tools.youtube ? 'Al pulsar «Subir programado», YouTube lo publica a esa hora.' : 'Sin YouTube configurado el calendario sirve de agenda: súbelos a mano a esa hora.'}</div></div></section>`;
}

// ---------- Vistas de cada clip (en Resultados) ----------
/** Las vistas de YouTube y las que se apuntan a mano de otras redes: con 4 clips con vistas, la nota de cada streamer aprende. */
function viewsCard() {
  const done = S.clips.filter((c) => c.status === 'listo');
  return `<div class="card"><div class="row"><h3 class="grow" style="margin:0">Vistas de cada clip</h3><button class="sm fix" data-act="views">Actualizar YouTube</button></div>
    <div style="overflow:auto;margin-top:8px"><table class="ctable"><thead><tr><th>Clip</th><th class="n">YouTube</th><th class="n">Otras redes</th><th></th></tr></thead><tbody>
      ${done.slice(0, 60).map((c) => `<tr><td><b>${esc((c.title || 'Clip').slice(0, 40))}</b>${c.variant || c.platform ? `<div class="mut">${[VAR[c.variant], PLAT[c.platform]].filter(Boolean).join(' · ')}</div>` : ''}</td>
        <td class="n mono">${c.youtubeId ? (c.viewsYt ?? 0).toLocaleString('es') : '—'}</td>
        <td class="n"><input type="number" data-views="${c.id}" value="${c.viewsOther || ''}" placeholder="0" aria-label="Vistas en otras redes" style="width:92px;min-height:30px;text-align:right" /></td>
        <td class="n">${c.file ? `<a class="btn sm icon" href="${dlHref(c)}" download aria-label="Descargar el clip" title="Descargar">${icon('dl', 'sm')}</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">Aún no hay clips exportados.</td></tr>'}</tbody></table></div>
    <div class="mut" style="margin-top:8px">Las de TikTok llegan solas. Con 4 clips con vistas o más, la puntuación de ese streamer se ajusta sola a lo que te funciona.</div></div>`;
}

// ---------- Agente ----------
/** Lo que Clipper aprende para editar solo: la escuela (shorts que funcionan, enlaces, TikTok) y cada streamer. */
function agentHtml() {
  const k = S.school || { n: 0 }, mine = k.mine || 0;
  const step = (n, ic, t, d) => `<div class="astep"><span class="anum" aria-hidden="true">${n}</span>${icon(ic, "aico")}<b>${t}</b><span class="mut">${d}</span></div>`;
  // Escuela | Enseñale | Cada streamer, con los tres pasos de lo que hace arriba.
  return `<div class="asteps">${step(1, "eye", "Mira shorts que funcionan", "Estudia solo los más vistos de muchos temas")}${step(2, "check", "Aprende de ti", mine ? mine + " videos elegidos por ti" : "De tus correcciones y de lo que eliges")}${step(3, "sparkle", "Edita como un pro", "Usa todo eso en cada «Auto edición»")}</div>
    <div class="wsrow">
    ${`<aside class="pnl wsl wsl-w" id="schoolCard" aria-label="Escuela del agente"><div class="ph"><h2>Escuela</h2>${helpBtn("escuela")}<span class="grow"></span><button class="sm fix" data-act2="study">Estudiar ahora</button></div><div class="pb" id="schoolBox"></div></aside>
    <section class="pnl wsc" aria-label="Enséñale"><div class="ph"><h2>Enséñale</h2></div><div class="pb">
      <div class="sect"><h3>Con enlaces</h3>
        <div class="mut">¿Viste un video muy bien editado? Pega su enlace (TikTok, YouTube Shorts o Reels de Instagram), o varios, uno por línea. Lo estudia enseguida, y lo que eliges tú pesa más que lo que encuentra sola.</div>
        <textarea id="lnk" rows="3" placeholder="https://www.tiktok.com/@creador/video/…" aria-label="Enlaces de videos bien editados"></textarea>
        <div class="row wrap"><button class="pri fix" data-act2="lnkgo">Estudiar estos</button></div></div>
      <div class="sect"><h3>Mirando TikTok</h3>
        <div class="mut">Pulsa «Mirar TikTok» y navega como siempre (Para ti, creadores, búsquedas) en la ventana que se abre: Clipper apunta los videos que pasan por tu pantalla y, al cerrarla, estudia los de 100 mil vistas o más. Inicias sesión tú: la contraseña no pasa por Clipper y la sesión se queda solo en este PC.</div>
        <div id="ttStatus"></div>
        <label class="f">Creadores a estudiar<input type="text" id="ttCreators" placeholder="@creador1, @creador2…" /></label>
        <label class="f">Hashtags<input type="text" id="ttTags" placeholder="#podcast, #humor, #entrevista…" /></label>
        <div class="row wrap"><button class="fix" data-act2="ttsave">Guardar</button><button class="fix" data-act2="tttest">Probar</button></div></div>
    </div></section>`}
    <aside class="pnl wsr" aria-label="Cada streamer"><div class="ph"><h2>Cada streamer</h2>${helpBtn("aprende")}</div><div class="pb"><div class="mut" id="learned" style="margin-bottom:8px"></div><div id="profBox"></div></div></aside>
    </div>`;
}

// ---------- Ajustes ----------
/** Estado de la conexion con TikTok (lo que cambia; los campos de texto se rellenan una vez). */
function ttHtml() {
  const t = S.school?.tiktok;
  if (!t) return '';
  const err = t.error ? `<div class="tterr">${esc(t.error)}</div>` : '';
  if (t.connecting) return `<div class="schbusy"><span class="dot"></span>${t.connected ? `Navega por TikTok como siempre. Videos apuntados: <b>${t.watching}</b>.` : 'Inicia sesión en la ventana de TikTok (con Google, el código QR o tu correo) y luego navega como siempre.'} <b>Cierra la ventana</b> al terminar.</div>` + err;
  if (!t.connected) return `<div class="row wrap" style="margin:10px 0"><button class="pri fix" data-act2="ttconnect">Conectar TikTok</button></div>` + err;
  return `<div class="row wrap" style="margin:10px 0"><button class="pri fix" data-act2="ttconnect">Mirar TikTok</button><span class="ttok">Sesión activa</span><span class="grow"></span><button class="sm fix danger" data-act2="ttoff">Desconectar</button></div>` + err;
}
/** Lo que el agente editor ha aprendido mirando shorts que funcionan, y si sigue estudiando solo. */
function schoolHtml() {
  const k = S.school || { on: true, n: 0, today: 0, busy: '', topics: {}, lines: [], hooks: [] };
  const topics = Object.entries(k.topics).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(' · ');
  return `<div class="mut" style="margin:6px 0 10px">Mira shorts que funcionan (podcast, entrevistas, streamers, humor, historias…), mide cómo están editados y lo usa al auto editar. Solo guarda las medidas: cada video se borra al terminar.</div>
    <label class="c"><input type="checkbox" id="sSchool" ${k.on ? 'checked' : ''} /> Estudiar sola en segundo plano (hasta 40 al día, sin frenar lo que estás haciendo)</label>
    ${k.busy ? `<div class="schbusy"><span class="dot"></span>${esc(k.busy)}</div>` : ''}
    ${k.queue ? `<div class="schn"><b>${k.queue}</b> pendiente${k.queue === 1 ? '' : 's'} de estudiar</div>` : ''}
    ${k.n ? `<div class="schn"><b>${k.n} shorts estudiados</b>${k.mine ? ` · ${k.mine} elegidos por ti` : ''}${k.today ? ` · ${k.today} hoy` : ''}<div class="mut">${esc(topics)}</div></div>` : '<div class="mut schn">Todavía no ha estudiado ninguno. Empieza sola a los pocos minutos, o pulsa «Estudiar ahora».</div>'}
    ${k.lines.length ? `<ul class="lessons">${k.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${k.hooks.length ? `<div class="mut" style="margin-top:8px">Ganchos que funcionaron</div><ul class="lessons">${k.hooks.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}`;
}
/** Secciones de Ajustes (clave, nombre, solo en este PC). Se ve una a la vez, como en los Ajustes de macOS. */
const SSECS = [['det', 'Detección y exportación'], ['avisos', 'Avisos al celular'], ['cuentas', 'Cuentas conectadas', 1], ['tiktok', 'Subir a TikTok', 1], ['disco', 'Espacio en disco'], ['copia', 'Copia de seguridad', 1], ['registro', 'Registro']];
let setSec = pref('setSec', 'det');
function applySec() {
  if (!document.querySelector(`#v-settings .ssec[data-sec="${setSec}"]`)) setSec = 'det';
  document.querySelectorAll('#v-settings .ssec').forEach((x) => (x.hidden = x.dataset.sec !== setSec));
  document.querySelectorAll('#v-settings [data-ssec]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.ssec === setSec));
}
const saveSettings = () => api('/api/settings', { autoScore: +$('sAuto').value, notifyScore: +$('sNotify').value, cleanDays: +$('sClean').value, visual: $('sVisual').checked, faces: $('sFaces').checked, fast: $('sFast').checked, discord: $('sDiscord').value, telegramToken: $('sTgToken').value, telegramChat: $('sTgChat').value, tiktokAccount: $('sTikTokAccount')?.value || '', tiktokVisibility: $('sTikTokVisibility')?.value || 'everyone', tiktokAuto: $('sTikTokAuto')?.checked || false, tiktokSmart: $('sTikTokSmart')?.checked ?? true });
const AUTOSAVE = new Set(['sAuto', 'sNotify', 'sClean', 'sVisual', 'sFaces', 'sFast', 'sDiscord', 'sTgToken', 'sTgChat', 'sTikTokAccount', 'sTikTokVisibility', 'sTikTokAuto', 'sTikTokSmart']);
function settingsHtml() {
  const secs = SSECS;
  return `<div class="wsrow"><aside class="pnl wsl" aria-label="Secciones de ajustes"><div class="ph"><h2>Ajustes</h2></div>
    <div class="pb navlist">${secs.map(([k, n]) => `<button class="nl" data-ssec="${k}" aria-pressed="false">${n}</button>`).join('')}</div>
    <div class="pfoot"><span class="mut">Clipper · ${esc(S.version || '')} · se guarda solo</span></div></aside>
    <section class="pnl wsc" aria-label="Ajuste elegido"><div class="pb">
    <div class="row only-m" style="margin-bottom:12px"><button data-fly>Canales vigilados</button><button data-help="">Ayuda</button></div>
    <div class="ssec" data-sec="det"><h2>Detección y exportación</h2>
      <label class="f">Avisarme de los momentos en vivo <b id="sNotifyV" class="slv"></b><input type="range" id="sNotify" min="0" max="10" step="0.5" data-show="sNotifyV" data-kind="notify" /></label>
      <label class="f">Exportar solos (con la plantilla del streamer) <b id="sAutoV" class="slv"></b><input type="range" id="sAuto" min="0" max="10" step="0.5" data-show="sAutoV" data-kind="auto" /></label>
      <div class="mut">Cada momento tiene una nota de 0 a 10: cuanto más alta, más fuerte (gritos, risas, el chat que explota).</div>
      <label class="c" style="margin-top:10px"><input type="checkbox" id="sFast" /> Modo en vivo rápido: revisa el directo cada 20 s y exporta sin esperar a la transcripción</label>
      <div class="mut">Pensado para subir antes que nadie. Necesita la exportación automática activada; el clip sale con algo menos de calidad.</div>
      <label class="c" style="margin-top:10px"><input type="checkbox" id="sVisual" /> Usar también la imagen para detectar momentos (cambios bruscos de escena)</label>
      <label class="c" style="margin-top:10px"><input type="checkbox" id="sFaces" /> Mirar las caras: cámara de cada participante, quién habla y sus reacciones (sorpresa, risa, susto)</label>
      <label class="f">Borrar grabaciones antiguas <b id="sCleanV" class="slv"></b><input type="range" id="sClean" min="0" max="60" step="1" data-show="sCleanV" data-kind="days" /></label>
    </div>
    <div class="ssec" data-sec="avisos"><h2>Avisos al celular</h2>
      <label class="f">Discord: enlace del webhook de un canal tuyo<input type="text" id="sDiscord" placeholder="https://discord.com/api/webhooks/…" /></label>
      <div class="row"><label class="f">Telegram: token del bot<input type="text" id="sTgToken" placeholder="123456:ABC…" /></label><label class="f">Telegram: tu chat id<input type="text" id="sTgChat" placeholder="123456789" /></label></div>
      <div class="row wrap" style="margin-top:14px"><button class="fix" id="sTest">Enviar aviso de prueba</button><button class="fix" id="sPerm">Permitir avisos del navegador</button></div>
    </div>
    <div class="ssec" data-sec="cuentas" id="accBox"></div>
    ${`<div class="ssec" data-sec="tiktok"><h2>Subir a TikTok</h2>
      <div class="mut" style="margin:6px 0 10px">Usa TikTokAutoUploader para publicar los clips. La primera vez instala la librería y conecta tu cuenta; la sesión queda guardada localmente en este equipo.</div>
      <label class="f">Nombre de usuario de TikTok<input type="text" id="sTikTokAccount" placeholder="@tu_usuario" autocomplete="off" /></label>
      <label class="f">Quién puede ver los videos<select id="sTikTokVisibility"><option value="everyone">Todos</option><option value="friends">Amigos</option><option value="private">Solo yo</option></select></label>
      <label class="c" style="margin-top:10px"><input type="checkbox" id="sTikTokAuto" ${S.tools.tiktokReady ? '' : 'disabled'} /> Subir automáticamente a TikTok cuando termine cada clip</label>
      <label class="c" style="margin-top:6px"><input type="checkbox" id="sTikTokSmart" /> Programar cada subida a mi mejor hora y con al menos 1 h entre videos <span class="mut">(si el clip no tiene hora puesta; la mejor hora sale de Aprender › Resultados)</span></label>
      <div class="row wrap" style="margin-top:12px"><button class="fix" data-ttinstall ${S.tools.tiktokUploader ? 'disabled' : ''}>${S.tools.tiktokUploader ? 'Librería instalada' : 'Instalar librería'}</button><button class="pri fix" data-ttconnect ${!S.tools.tiktokUploader ? 'disabled' : ''}>${S.tools.tiktokReady ? 'Reconectar cuenta' : 'Conectar cuenta'}</button></div>
      <div class="mut" style="margin-top:8px">${S.tools.tiktokReady ? 'Cuenta conectada y lista para subir.' : S.tools.tiktokUploader ? 'La librería está lista; conecta la cuenta para poder publicar.' : 'La librería todavía no está instalada.'} ${S.settings.tiktokAuto ? 'La subida automática está activada.' : 'La subida automática está apagada.'}</div>
    </div>`}
    <div class="ssec" data-sec="disco"><div class="row"><h2 class="fix">Espacio en disco</h2>${helpBtn('disco')}<span class="grow"></span><button class="sm fix" data-act2="sto">Actualizar</button></div><div id="stoBox"></div></div>
    ${`<div class="ssec" data-sec="copia"><h2>Copia de seguridad</h2><div class="mut" style="margin:6px 0 10px">Guarda tus ajustes, plantillas, perfiles y lo aprendido en un archivo. No incluye videos ni clips.</div>
      <div class="row wrap"><a class="btn fix" href="/api/backup" download>Descargar copia</a><label class="btn fix">Restaurar desde archivo<input type="file" id="sRestore" accept=".json,application/json" hidden /></label></div>
      <div class="mut" style="margin-top:10px">Además se guarda sola una copia al día en la carpeta <span class="mono">data/backups</span> (las 7 últimas)${S.settings.lastBackup ? '. Última: ' + esc(S.settings.lastBackup) : ''}.</div></div>`}
    <div class="ssec" data-sec="registro"><h2>Registro</h2><div class="mut" style="margin:6px 0 10px">Lo que va haciendo la app. Si algo falla, copia estas líneas.</div><div id="log"></div></div>
    </div></section></div>`;
}

function stoHtml() {
  if (!STO) return '<div class="mut" style="margin-top:8px">Calculando…</div>';
  const used = STO.total ? Math.round((1 - STO.free / STO.total) * 100) : 0, done = STO.sources.filter((x) => ['listo', 'error'].includes(x.status) && x.clips > 0 && !x.pending);
  const date = (d) => new Date(d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  return `${STO.total ? `<div class="row" style="margin-top:10px"><b class="mono fix" style="font-size:20px;color:${STO.free < 5e9 ? 'var(--recText)' : 'inherit'}">${gb(STO.free)}</b><span class="mut">libres de ${gb(STO.total)}</span></div><div class="meter" style="height:8px;margin:8px 0 12px"><b style="width:${used}%;background:${STO.free < 5e9 ? 'var(--rec)' : 'var(--acc)'}"></b></div>` : ''}
    <div class="stats"><span><b class="mono">${gb(STO.media)}</b> grabaciones</span><span><b class="mono">${gb(STO.clips)}</b> en ${STO.clipCount} clips</span><span><b class="mono">${gb(STO.cache)}</b> vistas previas</span></div>
    <div class="row wrap" style="margin-top:10px"><button class="fix" data-act2="stocache" ${STO.cache ? '' : 'disabled'}>Borrar vistas previas</button>${`<button class="fix" data-act2="stodone" ${done.length ? '' : 'disabled'}>Quitar grabaciones ya aprovechadas (${done.length})</button>`}</div>
    <div class="mut" style="margin-top:6px">Las vistas previas se vuelven a crear solas. «Ya aprovechadas»: terminadas, con clips exportados y sin momentos pendientes. Los clips nunca se borran aquí.</div>
    ${STO.sources.length ? `<div style="overflow-x:auto"><table style="margin-top:10px"><tr><th>Grabación</th><th class="n">Ocupa</th><th class="n">Clips</th><th class="n">Pendientes</th><th></th></tr>
      ${STO.sources.map((x) => `<tr><td>${esc(x.name.slice(0, 28))}<div class="mut">${date(x.createdAt)} · ${esc(x.status)}${x.own ? '' : ' · tu archivo original no se toca'}</div></td><td class="n mono">${gb(x.bytes)}</td><td class="n">${x.clips}</td><td class="n">${x.pending}</td><td>${!['listo', 'error'].includes(x.status) ? '' : `<button class="sm ghost" data-stodel="${x.id}">Quitar</button>`}</td></tr>`).join('')}</table></div>` : ''}`;
}
const loadSto = () => api('/api/storage').then((j) => { STO = j; render(); }).catch(() => {});

/** Perfil de un streamer: sus palabras y los clips de ejemplo de los que se copia la duracion. */
function profHtml() {
  const keys = [...new Set(['general', ...S.sources.map((s) => skey(s.streamer)), ...Object.keys(S.settings.profiles || {})])];
  if (!keys.includes(profKey)) profKey = keys.find((k) => k !== 'general') || 'general';
  const p = S.settings.profiles?.[profKey] || { words: [], suggest: [], examples: [], useLength: true, length: [28, 12] };
  const avg = p.examples.length ? Math.round(p.examples.reduce((t, e) => t + e.seconds, 0) / p.examples.length) : 0;
  return `<label class="f">Streamer<select id="pKey">${keys.map((k) => `<option ${k === profKey ? 'selected' : ''} value="${esc(k)}">${k === 'general' ? 'General (todos)' : esc(k)}</option>`).join('')}</select></label>
    <h3 style="margin-top:14px">Sus palabras</h3>
    <div class="mut">Muletillas, apodos o gritos típicos. Cuando se dicen, el momento sube de puntuación.</div>
    <div class="row" style="margin-top:6px"><input type="text" id="pWords" value="${esc(p.words.join(', '))}" placeholder="ej. qué chimba, parcero, vamos…" aria-label="Palabras del streamer" /><button class="fix" id="pSave">Guardar</button></div>
    ${p.suggest.length ? `<div class="chips" style="margin-top:8px"><span class="mut">Se repiten en tus clips:</span>${p.suggest.map((w) => `<button class="sm" data-pword="${esc(w)}">+ ${esc(w)}</button>`).join('')}</div>` : ''}
    <h3 style="margin-top:16px">Subtítulos: lo que corriges</h3>
    <div class="mut">Cuando corriges una palabra a mano en el editor, Clipper lo aprende al exportar y la próxima vez la escribe bien con este streamer.</div>
    ${(p.fixes || []).length ? `<div class="chips" style="margin-top:8px">${p.fixes.map((f) => `<span class="fixchip"><s>${esc(f.from)}</s> → <b>${esc(f.to)}</b>${f.n > 1 ? ` <span class="mut">×${f.n}</span>` : ''}<button class="sm ghost icon" data-unfix="${esc(f.from)}" aria-label="Olvidar esta corrección">×</button></span>`).join('')}</div>` : '<div class="mut" style="margin-top:6px">Todavía ninguna.</div>'}
    <h3 style="margin-top:16px">Clips de ejemplo</h3>
    <div class="mut">Pega el enlace de un clip que te guste (TikTok, Shorts, un clip del canal oficial) o la ruta de un archivo. Se mide cuánto dura, dónde cae el momento fuerte y cuánto se habla; el video no se guarda.</div>
    <div class="row" style="margin-top:6px"><input type="text" id="pEx" placeholder="https://… o C:\\clips\\ejemplo.mp4" aria-label="Enlace o archivo de ejemplo" /><button class="fix" id="pAdd">Analizar</button></div>
    ${p.examples.length ? `<div style="overflow-x:auto"><table style="margin-top:8px"><tr><th>Ejemplo</th><th class="n">Dura</th><th class="n">Pico</th><th class="n">Palabras/s</th><th class="n">Cortes/min</th><th></th></tr>
      ${p.examples.map((e) => `<tr><td title="${esc(e.url)}">${esc(e.title.slice(0, 34))}</td><td class="n">${e.seconds} s</td><td class="n">${Math.round(e.peakPos * 100)}%</td><td class="n">${e.wps}</td><td class="n">${e.cuts}</td><td><button class="sm ghost icon" data-exdel="${e.id}" aria-label="Quitar ejemplo">×</button></td></tr>`).join('')}</table></div>
      <label class="c" style="margin-top:8px"><input type="checkbox" id="pLen" ${p.useLength ? 'checked' : ''} /> Cortar los momentos nuevos como estos ejemplos</label>
      <div class="mut">${p.examples.length < 2 ? 'Con 2 ejemplos o más se aplica; ahora se usa el corte normal (28 s antes del pico y 12 después).' : p.useLength ? `Duran ${avg} s de media: los momentos nuevos guardan ${p.length[0]} s antes del pico y ${p.length[1]} s después.` : 'Desactivado: se usa el corte normal (28 s antes del pico y 12 después).'}</div>` : ''}`;
}

/** Quita de la seleccion lo que ya no existe, para que el contador nunca hable de momentos o clips que no se ven. */
function prune() {
  const alive = new Set(S.sources.flatMap((s) => s.candidates.map((c) => pk(s, c)))), clips = new Set(S.clips.map((c) => c.id));
  let changed = false;
  for (const k of [...picked]) if (!alive.has(k)) { picked.delete(k); changed = true; }
  for (const k of [...pickedClips]) if (!clips.has(k)) { pickedClips.delete(k); changed = true; }
  if (openMom && !alive.has(openMom)) openMom = null;
  if (changed) last.liveBody = last.clips = null;
}

export function render() {
  prune();
  renderSide();
  if (view === 'live') {
    // La barra de añadir tiene un campo de texto: solo se redibuja cuando cambia la lista de fuentes.
    // La barra de añadir y el panel del directo no se reconstruyen con cada refresco: solo cambia lo de dentro.
    if (!$('liveBody') || last.liveSig == null) { if (document.activeElement?.id !== 'value' || !$('liveBody')) { last.liveSig = 1; const v = $('value')?.value || ''; $('v-live').innerHTML = liveHtml(); if ($('value')) $('value').value = v; last.liveBody = last.srcChips = last.diskWarn = null; } }
    if ($('busy')) $('busy').textContent = S.busy || '';
    draw('srcChips', chipsHtml(), $('srcChips'));
    if ($('srcN')) $('srcN').textContent = S.sources.some((x) => x.community) ? '' : S.sources.length || ''; // con pestañas, cada una lleva su numero
    draw('diskWarn', S.disk?.low && S.sources.some((x) => x.status === 'grabando') ? `<div class="banner">Queda poco espacio en disco (${gb(S.disk.free)}). Libera espacio en Ajustes; con menos de 1 GB la grabación se detiene sola.</div>` : '', $('diskWarn'));
    liveBody();
  }
  // Mientras se escribe en un campo no se redibuja (se perderia lo escrito); marcar una casilla si redibuja.
  const typing = ['text', 'number'].includes(document.activeElement?.type) || document.activeElement?.tagName === 'TEXTAREA';
  if (view === 'clips') {
    setBar('clips', NAMES.clips, `${S.clips.filter(CTABS.pub).length} por publicar`, `<button class="sm fix" data-act="perf" aria-pressed="${showPerf}">${icon('chart', 'sm')}Qué rinde más</button>`);
    if (!typing) draw('clips', clipsHtml(), $('v-clips'));
  }
  if (view === 'settings' || view === 'clips') ranges($('v-' + view));
  segs();
  if (view === 'settings') {
    if (draw('settings', settingsHtml(), $('v-settings'))) { settingsDrawn = false; last.acc = last.lan = last.sto = null; applySec(); }
    setBar('settings', NAMES.settings, SSECS.find(([k]) => k === setSec)?.[1] || '');
    if ($('accBox')) draw('acc', accHtml(), $('accBox'));
    draw('sto', stoHtml(), $('stoBox'));
    if (!settingsDrawn) { loadSto(); last.sto = null; const g = S.settings; $('sAuto').value = g.autoScore; $('sNotify').value = g.notifyScore; $('sClean').value = g.cleanDays; $('sVisual').checked = g.visual; $('sFaces').checked = g.faces !== false; $('sFast').checked = !!g.fast; $('sDiscord').value = g.discord || ''; $('sTgToken').value = g.telegramToken || ''; $('sTgChat').value = g.telegramChat || ''; if ($('sTikTokAccount')) { $('sTikTokAccount').value = g.tiktokAccount || ''; $('sTikTokVisibility').value = g.tiktokVisibility || 'everyone'; $('sTikTokAuto').checked = !!g.tiktokAuto; if ($('sTikTokSmart')) $('sTikTokSmart').checked = g.tiktokSmart !== false; } slv(); settingsDrawn = true; last.prof = null; }
    $('log').textContent = (S.logs || []).slice().reverse().map((l) => l.at + '  ' + l.msg).join('\n') || 'Sin actividad todavía.';
  }
  if (view === 'lab') { draw('lab', labHtml(), $('v-lab')); setBar('lab', NAMES.lab, labStreamer ? sname(labStreamer) : ''); }
  // Sin cuenta de TikTok no hay nada que leer (y el servidor responderia con un error).
  if (view === 'stats') { if (S.settings.tiktokAccount && !TTS.r && !TTS.loading && !TTS.error) loadStats(false); draw('stats', statsHtml(), $('v-stats')); setBar('stats', NAMES.stats, S.settings.tiktokAccount ? '@' + S.settings.tiktokAccount.replace(/^@/, '') : ''); }
  if (view === 'agent') {
    setBar('agent', NAMES.agent, S.school?.n ? S.school.n + ' shorts estudiados' : 'aprendiendo desde cero');
    if (draw('agent', agentHtml(), $('v-agent'))) { last.prof = last.school = last.tt = null; if ($('ttCreators')) { $('ttCreators').value = (S.school?.tiktok?.creators || []).map((c) => '@' + c).join(', '); $('ttTags').value = (S.school?.tiktok?.tags || []).map((c) => '#' + c).join(', '); } }
    if (!(['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) && $('profBox').contains(document.activeElement))) draw('prof', profHtml(), $('profBox'));
    if ($('schoolBox')) { draw('school', schoolHtml(), $('schoolBox')); draw('tt', ttHtml(), $('ttStatus')); }
    const learned = Object.entries(S.settings.learned);
    $('learned').textContent = (learned.length ? 'Decisiones aprendidas: ' + learned.map(([k, n]) => `${k} (${n})`).join(', ') + '. Influyen en la puntuación a partir de 6.' : 'La app aprende de lo que exportas, de lo que descartas y de las vistas de tus clips.');
  }
}

export async function refresh() {
  try {
    S = await api('/api/state');
    if (!selSrc && S.sources[0]) { selSrc = S.sources[0].id; loadTl(); }
    if (selSrc && !cur() && !(selSrc === '*' && S.sources.length)) selSrc = S.sources[0]?.id || null;
    notify();
    render();
  } catch {}
}

const quick = (s, c) => ({ sid: s.id, candidateId: c.id, start: c.start, end: c.end });
/**
 * «Sacar clips»: se elige la duración y el tipo de momento, se ven al instante los mejores de este vídeo y se editan
 * todos de una vez con la plantilla del streamer (luego se revisan en «Clips»).
 */
function sacarClips(s) {
  const KINDS = [['fuertes', 'Los más fuertes', 'gritos, risas y chat'], ['graciosos', 'Los más graciosos', 'risas y chistes'], ['chat', 'Lo que pidió el chat', '«clip», «clipeen»'], ['historias', 'Historias completas', 'con su principio y su final']];
  const DUR = [['auto', 'Automática'], ['corto', '15–30 s'], ['medio', '30–60 s'], ['largo', '1–3 min']];
  const o = { dur: pref('sacarDur', 'auto'), kind: pref('sacarKind', 'fuertes'), hint: '' }, chosen = new Set(), prev = document.activeElement;
  let res = [];
  const sc = document.createElement('div');
  sc.className = 'scrim';
  sc.innerHTML = `<div class="dlg sacar" role="dialog" aria-modal="true" aria-labelledby="sacarT">
    <div class="row"><h2 id="sacarT" class="grow">Sacar clips</h2><span class="mut fix">${esc(s.streamer || s.name)} · ${fmt(s.duration || s.analyzedTo)} grabados</span></div>
    <h3>Duración de cada clip</h3><div class="seg" role="group" aria-label="Duración de cada clip">${DUR.map(([k, n]) => `<button type="button" data-dur="${k}">${n}</button>`).join('')}</div>
    <div class="mut" id="sacarDurN"></div>
    <h3>Qué momentos</h3><div class="skinds" role="radiogroup" aria-label="Qué momentos">${KINDS.map(([k, n, d]) => `<button type="button" role="radio" data-kind="${k}"><b>${n}</b><span class="mut">${d}</span></button>`).join('')}</div>
    <h3>Indicaciones (opcional)</h3><input type="text" id="sacarHint" autocomplete="off" placeholder="Ej.: cuando habla del Red Dead…" aria-label="Indicaciones" />
    <div class="row"><h3 class="grow" id="sacarN"></h3><span class="mut fix">ordenados por nota</span></div>
    <div class="sres" id="sacarList"></div>
    <div class="row sacarbar"><span class="mut grow" id="sacarNote"></span><button type="button" class="fix" data-x="no">Cancelar</button><button type="button" class="pri fix" data-x="go"></button></div></div>`;
  document.body.appendChild(sc);
  const q = (sel) => sc.querySelector(sel);
  const foot = () => {
    q('[data-x=go]').textContent = chosen.size ? `Editar ${chosen.size === 1 ? 'el elegido' : 'los ' + chosen.size}` : 'Elige alguno';
    q('[data-x=go]').disabled = !chosen.size;
    q('#sacarNote').textContent = chosen.size ? `Se editan solos con la plantilla de ${s.streamer || 'esta fuente'}; los revisas en «Clips» antes de publicar.` : '';
  };
  const draw = (reset) => {
    res = pickClips(s.candidates, { ...o, total: s.duration || s.analyzedTo });
    if (reset) { chosen.clear(); res.filter((r) => !r.c.exported).slice(0, 3).forEach((r) => chosen.add(r.c.id)); }
    sc.querySelectorAll('[data-dur]').forEach((b) => b.classList.toggle('on', b.dataset.dur === o.dur));
    sc.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === o.kind)));
    q('#sacarDurN').textContent = o.dur === 'auto' ? 'Automática: la que trae cada momento.' : 'Cada momento se recorta o se alarga alrededor de su punto fuerte.';
    q('#sacarN').textContent = res.length ? `${res.length} clip${res.length > 1 ? 's' : ''} encontrado${res.length > 1 ? 's' : ''}` : 'Ningún clip';
    q('#sacarList').innerHTML = res.length ? res.map((r) => `<div class="srow"><label class="c fix"><input type="checkbox" data-pick="${r.c.id}" ${chosen.has(r.c.id) ? 'checked' : ''} aria-label="Elegir «${esc(r.c.title || 'momento')}»" /></label>
      <img alt="" width="96" height="54" loading="lazy" src="${thumb(s, r.c)}" /><span class="grow"><b>«${esc(r.c.title || r.c.label || r.c.text || 'Momento')}»</b><span class="mut">${marks(r.c) ? marks(r.c) + ' · ' : ''}${fmt(r.start)} · ${Math.round(r.end - r.start)} s${tags(r.c).length ? ' · ' + esc(tags(r.c).join(', ')) : ''}</span></span>
      <span class="mono fix">${r.c.score.toFixed(1)}</span><button type="button" class="sm fix" data-open="${r.c.id}">Abrir</button></div>`).join('')
      : `<div class="empty">${o.kind === 'chat' ? 'El chat no ha pedido ningún clip todavía.' : 'Todavía no hay momentos en este vídeo.'}</div>`;
    foot();
  };
  const close = () => { sc.classList.add('out'); setTimeout(() => sc.remove(), calm() ? 0 : 180); prev?.focus?.(); };
  let typing = 0;
  sc.addEventListener('input', (e) => { if (e.target.id === 'sacarHint') { clearTimeout(typing); typing = setTimeout(() => { o.hint = e.target.value; draw(true); }, 250); } });
  sc.addEventListener('change', (e) => { const id = e.target.dataset.pick; if (id) { e.target.checked ? chosen.add(id) : chosen.delete(id); foot(); } });
  sc.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  sc.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (e.target === sc) return close();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dur) { o.dur = b.dataset.dur; setPref('sacarDur', o.dur); draw(true); }
    else if (b.dataset.kind) { o.kind = b.dataset.kind; setPref('sacarKind', o.kind); draw(true); }
    else if (b.dataset.open) { const r = res.find((x) => x.c.id === b.dataset.open); close(); if (r) toEditor(s, { ...r.c, start: r.start, end: r.end }); }
    else if (b.dataset.x === 'no') close();
    else if (b.dataset.x === 'go') {
      const list = res.filter((r) => chosen.has(r.c.id));
      await api('/api/export', { items: list.map((r) => ({ sid: s.id, candidateId: r.c.id, start: r.start, end: r.end })) });
      picked.clear(); close(); toast(`Editando ${list.length} clip${list.length > 1 ? 's' : ''} con la plantilla. Los verás en «Clips».`, 'good');
    }
  });
  draw(true);
  q('[data-dur].on')?.focus();
}
/**
 * Al desplegar un momento se empieza a preparar su vista previa (tarda unos segundos): al pulsar «Editar» suele estar lista.
 * Solo interesa que el servidor la genere, asi que la descarga se corta en cuanto responde.
 */
function prefetchPreview(id) {
  const [sid, cid] = id.split('|'), s = S.sources.find((x) => x.id === sid), c = s?.candidates.find((x) => x.id === cid);
  if (!c) return;
  const ac = new AbortController();
  fetch(previewUrl(sid, pvWindow(Math.round(c.start), Math.round(c.end), s.duration || s.analyzedTo)), { signal: ac.signal }).then(() => ac.abort(), () => {});
}
/** Abre el editor: la miniatura del momento se convierte en el visor. */
function toEditor(s, c, thumb, saved = null) {
  document.querySelectorAll('[style*="view-transition-name"]').forEach((x) => (x.style.viewTransitionName = ''));
  if (thumb) thumb.style.viewTransitionName = 'hero';
  return go('editor', async () => { if (thumb) thumb.style.viewTransitionName = ''; await openEditor(s, c, saved); });
}
/** La fuente a la que pertenece el elemento pulsado (en la vista "Todos" cada momento lleva la suya). */
const srcOf = (el) => S.sources.find((x) => x.id === (el.closest('[data-src]')?.dataset.src || selSrc));
const pair = (k) => { const [sid, cid] = k.split('|'), s = S.sources.find((x) => x.id === sid); return [s, s?.candidates.find((c) => c.id === cid)]; };

// ---------- eventos ----------
document.addEventListener('change', async (e) => {
  if (e.target.dataset?.labstreamer != null) { labStreamer = e.target.value; return render(); }
  const t = e.target;
  try {
    if (t.dataset.pick) { t.checked ? picked.add(t.dataset.pick) : picked.delete(t.dataset.pick); last.liveBody = null; liveBody(); }
    if ('monttrans' in t.dataset) montTrans = t.value;
    if (t.dataset.pickclip) { t.checked ? pickedClips.add(t.dataset.pickclip) : pickedClips.delete(t.dataset.pickclip); last.clips = null; render(); }
    if (t.dataset.views) { await api('/api/clip/update', { cid: t.dataset.views, viewsOther: +t.value || 0 }); refresh(); }
    if (AUTOSAVE.has(t.id)) {
      await saveSettings();
      toast($('sFast').checked && !(+$('sAuto').value > 0) ? 'Guardado. El modo rápido solo exporta solo si pones una puntuación en «Exportar solos».' : 'Guardado', 'good');
      return;
    }
    if (t.id === 'sSchool') { await api('/api/school', { on: t.checked }); toast(t.checked ? 'El agente estudiará solo en segundo plano' : 'Escuela en pausa'); return refresh(); }
    if (t.id === 'pKey') { profKey = t.value; last.prof = null; t.blur(); render(); }
    if (t.id === 'pLen') { await api('/api/profile', { streamer: profKey, useLength: t.checked }); t.blur(); await refresh(); }
    if (t.id === 'sRestore' && t.files[0]) {
      if (!(await ask('Restaurar la copia', { text: 'Reemplaza tus ajustes, plantillas y perfiles actuales.', ok: 'Restaurar' }))) return void (t.value = '');
      await api('/api/restore', JSON.parse(await t.files[0].text()));
      settingsDrawn = false; toast('Copia restaurada', 'good'); refresh();
    }
    if (t.dataset.title) { await api('/api/clip/update', { cid: t.dataset.title, title: t.value }); t.blur(); refresh(); }
  } catch (err) { toast(err.message, 'bad'); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'cq') { clipQ = e.target.value; draw('cgal', galHtml(clipList()), $('cgal')); }
  if (e.target.id !== 'value') return;
  const v = e.target.value.trim();
  let kind = '';
  try {
    if (/^https?:/.test(v)) {
      const u = new URL(v), parts = u.pathname.split('/').filter(Boolean);
      const channel = (/kick\.com|twitch\.tv/.test(u.hostname) && parts.length === 1) || /\/live$/.test(u.pathname);
      $('live').checked = channel;
      kind = channel ? 'Parece un canal: se grabará el directo mientras emite.' : 'Parece un video ya publicado: se descargará y analizará entero.';
    } else if (v) { $('live').checked = false; kind = 'Archivo de tu PC: se analiza sin descargar nada.'; }
  } catch {}
  $('kind').textContent = kind;
});

async function addSource() {
  // «Hacer los clips solo» (como el «un clic» de OpusClip): los mejores (story.ts › pickClips), auto editados; en directo no.
  const auto = !$('live').checked && $('autoClips')?.checked;
  const s = await api('/api/source', { value: $('value').value, live: $('live').checked, autoClips: auto });
  selSrc = s.id; $('value').value = ''; $('kind').textContent = ''; TL = null; last.liveBody = null;
  toast(s.live ? 'Conectando con el directo…' : auto ? 'Fuente añadida. Al terminar de analizarla haré sus mejores clips (no se sube nada).' : 'Fuente añadida');
  refresh();
}

// «Hacer los clips solo» se recuerda, y no tiene sentido en directo (un directo no termina).
document.addEventListener('change', (e) => {
  if (e.target.dataset?.srclang) api('/api/source/lang', { sid: e.target.dataset.srclang, lang: e.target.value }).then(() => { toast(e.target.value ? 'Inglés o mezclado: los subtítulos de sus clips saldrán en español.' : 'Idioma: español.', 'good'); refresh(); }).catch((x) => toast(x.message, 'bad'));
  if (e.target.id === 'autoClips') setPref('autoClips', e.target.checked ? '1' : '0');
  if (e.target.id === 'live' && $('autoClips')) $('autoClips').disabled = e.target.checked;
});
document.addEventListener('click', async (e) => {
  const q = (a) => e.target.closest(`[data-${a}]`);
  try {
    if (q('view')) return go(q('view').dataset.view);
    if (e.target.id === 'add') return await addSource();
    if (e.target.id === 'wAdd') { let url = $('wUrl').value.trim(); if (!url) { toast('Escribe el enlace del canal.'); return $('wUrl').focus(); } if (!/^https?:/.test(url)) url = 'https://' + url; await api('/api/settings', { watch: [...S.settings.watch, { url, streamer: '' }] }); $('wUrl').value = ''; toast('Canal vigilado'); return refresh(); }
    if (q('unwatch')) { await api('/api/settings', { watch: S.settings.watch.filter((_, i) => i != q('unwatch').dataset.unwatch) }); return refresh(); }
    if (q('ssec')) { setSec = q('ssec').dataset.ssec; setPref('setSec', setSec); applySec(); return render(); }
    if (e.target.id === 'sTest') { await saveSettings(); await api('/api/alert/test', {}); return toast('Aviso enviado: revisa tu celular.', 'good'); }
    if (e.target.id === 'pSave') { await api('/api/profile', { streamer: profKey, words: $('pWords').value }); document.activeElement?.blur(); toast('Palabras guardadas. Se aplican a los momentos nuevos.', 'good'); return refresh(); }
    if (q('pword')) { const p = S.settings.profiles?.[profKey]; await api('/api/profile', { streamer: profKey, words: [...(p?.words || []), q('pword').dataset.pword] }); last.prof = null; return refresh(); }
    if (e.target.id === 'pAdd') {
      const v = $('pEx').value.trim();
      if (!v) return toast('Pega un enlace o la ruta de un archivo.');
      e.target.disabled = true; e.target.textContent = 'Analizando…';
      try { const ex = await api('/api/example', { streamer: profKey, value: v }); toast(`Ejemplo analizado: dura ${ex.seconds} s y el momento fuerte cae al ${Math.round(ex.peakPos * 100)}%.`, 'good'); }
      finally { document.activeElement?.blur(); last.prof = null; await refresh(); }
      return;
    }
    if (q('exdel')) { await api('/api/example', { streamer: profKey, remove: q('exdel').dataset.exdel }); last.prof = null; return refresh(); }
    if (q('unfix')) { await api('/api/profile', { streamer: profKey, unfix: q('unfix').dataset.unfix }); toast('Corrección olvidada'); last.prof = null; return refresh(); }
    if (e.target.id === 'sPerm') { beep(); return window.Notification && Notification.requestPermission(); }
    if (q('ptog')) {
      const k = q('ptog').dataset.ptog, h = new Set(hiddenPanels(view));
      h.has(k) ? h.delete(k) : h.add(k);
      try { localStorage.setItem('clipper.hide.' + view, JSON.stringify([...h])); } catch {}
      applyHidden(view); last.tbar = null; setBar(view, ...lastBar);
      return drawTl();
    }
    if (q('liveview')) { liveView = q('liveview').dataset.liveview; setPref('liveView', liveView); return showLiveView(liveView === 'grabacion'); }
    if (q('rtab')) { rightTab = q('rtab').dataset.rtab; document.querySelectorAll('[data-rtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.rtab === rightTab))); if ($('lvMoms')) $('lvMoms').hidden = rightTab !== 'moms'; if ($('lvChat')) $('lvChat').hidden = rightTab !== 'chat'; return; }
    if (q('sid')) { selSrc = q('sid').dataset.sid; picked.clear(); folded.clear(); TL = null; last.liveBody = null; render(); return selSrc === '*' ? null : loadTl(); }
    if (q('stop')) { await api('/api/stop', { sid: q('stop').dataset.stop }); toast('Deteniendo…'); return refresh(); }
    if (q('del')) { if (await ask('¿Quitar esta fuente?', { text: 'Los clips ya exportados se conservan.', ok: 'Quitar', danger: true })) { await api('/api/remove', { sid: q('del').dataset.del }); selSrc = null; last.liveBody = null; refresh(); } return; }
    if (q('sort')) { sortBy = q('sort').dataset.sort; setPref('momSort', sortBy); liveBody(); return segs(); }
    if (q('dense')) { dense = q('dense').dataset.dense === '1'; setPref('momDense', dense ? '1' : '0'); liveBody(); return segs(); }
    if (q('fold')) { const value = q('fold').dataset.fold, k = value.startsWith('g:') || selSrc === '*' ? value : +value; folded.has(k) ? folded.delete(k) : folded.add(k); return liveBody(); }
    if (q('open') && !q('pick')) { const id = q('open').dataset.open; openMom = openMom === id ? null : id; if (openMom) prefetchPreview(id); liveBody(); const l = $('momlist'); if (l) { l.classList.add('fresh'); setTimeout(() => l.classList.remove('fresh'), 900); } return; }
    if (q('help')) return document.getElementById('sheet') && q('help').id === 'helpBtn' ? closeHelp() : openHelp(q('help').dataset.help);
    if (document.getElementById('sheet') && !e.target.closest('#sheet')) closeHelp();
    if (e.target.closest('#notiBtn')) return toggleNoti($('noti').hidden);
    if (q('lablevel')) { S.lab = await api('/api/lab/level', { streamer: labStreamer, level: +q('lablevel').dataset.lablevel }); toast(`Auto edición de ${sname(labStreamer)}: ${S.lab.levels[+q('lablevel').dataset.lablevel]}`, 'good'); return render(); }
    if (q('labrun')) { try { S.lab = await api('/api/lab/run', { streamer: labStreamer }); toast('Midiendo: la auto edición se está pasando por tus clips…'); } catch (err) { toast(err.message, 'bad'); } return render(); }
    if (q('labtry')) { const [sid, cid] = q('labtry').dataset.labtry.split('|'); return labTry(sid, cid); }
    if (q('labforget')) { if (await ask(`¿Olvidar lo que ha aprendido de ${sname(labStreamer)}?`, { ok: 'Olvidar', danger: true })) { S.lab = await api('/api/lab/forget', { streamer: labStreamer }); render(); } return; }
    if (e.target.closest('[data-acccheck]')) {
      S.accounts.checking = true; last.acc = null; render();
      try { S.accounts = await api('/api/accounts/check', {}); toast('Cuentas comprobadas', 'good'); } catch (err) { toast(err.message, 'bad'); }
      last.acc = null; return refresh();
    }
    if (e.target.closest('[data-notiperm]')) { Notification.requestPermission().then(() => { last.notiPerm = null; renderNoti(); }); return; }
    if (!$('noti').hidden && !e.target.closest('#noti')) toggleNoti(false);
    if (e.target.closest('#flyBtn,[data-fly]')) { const f = $('fly'); f.hidden = !f.hidden; $('flyBtn').setAttribute('aria-expanded', String(!f.hidden)); if (!f.hidden) $('wUrl').focus(); return; }
    if (!$('fly').hidden && !e.target.closest('#fly')) { $('fly').hidden = true; $('flyBtn').setAttribute('aria-expanded', 'false'); }
    if (q('filter')) { filter = q('filter').dataset.filter; last.liveBody = null; liveBody(); return segs(); }
    if (q('mark')) { const c = await api('/api/mark', { sid: selSrc, last: +q('mark').dataset.mark }); toast('Momento guardado', 'good'); await refresh(); return; }
    if (q('comload')) return loadCom(q('comload').dataset.comload);
    if (q('ttsrefresh')) return loadStats(true);
    if (q('comsort')) { const [sid, k] = q('comsort').dataset.comsort.split('|'); if (COM[sid]) COM[sid].sort = k; return liveBody(); }
    if (q('comall')) { const sid = q('comall').dataset.comall; if (COM[sid]) COM[sid].all = true; return liveBody(); }
    if (q('comimp')) {
      const [sid, i] = q('comimp').dataset.comimp.split('|'), c = COM[sid], k = c?.list[+i], s = S.sources.find((x) => x.id === sid);
      if (!k) return;
      await api('/api/source', { value: k.video, streamer: s?.streamer || '', community: { title: k.title, views: k.views } });
      c.imported[k.id] = true; liveBody();
      toast(`Importando «${k.title}»: aparecerá arriba como una fuente más, con el clip entero listo para editar.`, 'good');
      return refresh();
    }
    if (q('srctab')) { srcTab = q('srctab').dataset.srctab; setPref('srcTab', srcTab); return render(); }
    if (q('comvod')) {
      // Un clip de la lista (sid|i) o una fuente ya importada (su enlace): se busca su minuto en el VOD del directo.
      const b = q('comvod'), [sid, i] = b.dataset.comvod.split('|'), k = i != null ? COM[sid]?.list[+i] : null, s = S.sources.find((x) => x.id === sid);
      const ref = k ? (k.platform === 'kick' ? k.id : k.video) : s?.origin;
      if (!ref) return;
      b.disabled = true; b.textContent = 'Buscando…';
      try {
        const n = await api('/api/community/vod', { ref, streamer: s?.streamer || '', title: k?.title || s?.community?.title || s?.name || 'Clip', views: k?.views ?? s?.community?.views ?? 0 });
        selSrc = n.id; TL = null; last.liveBody = null;
        toast('Encontrado en el directo: bajando ese trozo con 1 minuto antes y otro después. El clip original sale marcado.', 'good');
      } catch (err) { toast(err.message, 'bad'); b.disabled = false; b.textContent = 'Buscar en el directo'; }
      return refresh();
    }
    if (q('editclip')) {
      const k = S.clips.find((x) => x.id === q('editclip').dataset.editclip), s = S.sources.find((x) => x.id === k?.sid);
      if (!k || !s) return toast('La grabación de este clip ya no está en «Media».', 'bad');
      const spec = await api('/api/clip?cid=' + encodeURIComponent(k.id));
      const cand = s.candidates.find((x) => x.id === k.cand) || { id: k.cand || 'clip', start: spec.start, end: spec.end, peak: spec.start, score: null, why: 'Clip ya exportado: al exportar de nuevo se crea otro clip y este no cambia.', title: k.title };
      return toEditor(s, cand, e.target.closest('article')?.querySelector('video'), spec);
    }
    if (q('edit')) { const s = srcOf(e.target), c = s.candidates.find((x) => x.id === q('edit').dataset.edit); return toEditor(s, c, e.target.closest('article')?.querySelector('img')); }
    if (q('quick')) { const s = srcOf(e.target), c = s.candidates.find((x) => x.id === q('quick').dataset.quick); await api('/api/export', quick(s, c)); toast('Exportando con la plantilla. Aparece en «Clips y publicación».'); return refresh(); }
    if (q('rt')) { const k = q('rt').dataset.rt; if (k === 'live') return backLive(); if (k === 'save') { const r = rt?.replay; if (!r) return; await api('/api/mark', { sid: rt.sid, start: r.start, end: r.end }); toast(`Guardado: ${fmt(r.start)} – ${fmt(r.end)}`, 'good'); return refresh(); } return replay(+k); }
    if (q('stodel')) { if (!(await ask('¿Quitar esta grabación?', { text: 'Se borra el video grabado y sus momentos. Los clips ya exportados se conservan.', ok: 'Quitar', danger: true }))) return; await api('/api/storage/remove', { sids: [q('stodel').dataset.stodel] }); toast('Grabación quitada', 'good'); await refresh(); return loadSto(); }
    if (q('act2')) {
      const a = q('act2').dataset.act2;
      if (a === 'sto') return loadSto();
      if (a === 'ttconnect') { const was = S.school?.tiktok?.connected; await api('/api/tiktok', { connect: true }); toast(was ? 'Se abre TikTok: navega como siempre y cierra la ventana al terminar.' : 'Se abre una ventana de TikTok: inicia sesión y ciérrala al terminar.'); return refresh(); }
      if (a === 'lnkgo') {
        const r = await api('/api/school', { links: $('lnk').value });
        if (r.error) return toast(r.error);
        $('lnk').value = '';
        toast(r.added ? `${r.added} video${r.added === 1 ? '' : 's'} para estudiar. Puedes seguir trabajando.` : 'Esos enlaces ya estaban en la lista.', 'good');
        return refresh();
      }
      if (a === 'ttoff') { if (!(await ask('¿Desconectar TikTok?', { text: 'Clipper olvida la sesión. Tu cuenta de TikTok no cambia.', ok: 'Desconectar' }))) return; await api('/api/tiktok', { disconnect: true }); toast('TikTok desconectado'); return refresh(); }
      if (a === 'ttsave' || a === 'tttest') {
        await api('/api/tiktok', { creators: $('ttCreators').value, tags: $('ttTags').value });
        const st = await api('/api/state'); $('ttCreators').value = st.school.tiktok.creators.map((c) => '@' + c).join(', '); $('ttTags').value = st.school.tiktok.tags.map((c) => '#' + c).join(', ');
        if (a === 'ttsave') { toast('Guardado', 'good'); return refresh(); }
        toast('Mirando TikTok… (tarda unos segundos)');
        const r = await api('/api/tiktok', { test: true });
        if (r.error) { toast(r.error); return refresh(); }
        toast(`Funciona: ${r.n} videos en ${r.page}${r.top[0] ? `. El más visto: «${r.top[0].title}» (${r.top[0].views.toLocaleString('es')} vistas)` : ''}`, 'good');
        return refresh();
      }
      if (a === 'study') { await api('/api/school', { study: true }); toast('Estudiando 5 shorts nuevos. Puedes seguir trabajando.'); return refresh(); }
      if (a === 'stocache') { const r = await api('/api/storage/clear', {}); toast(`Vistas previas borradas: ${gb(r.freed)} libres`, 'good'); return loadSto(); }
      if (a === 'stodone') { const ids = STO.sources.filter((x) => ['listo', 'error'].includes(x.status) && x.clips > 0 && !x.pending).map((x) => x.id); if (!(await ask(`¿Quitar ${ids.length} ${ids.length === 1 ? 'grabación' : 'grabaciones'}?`, { text: 'Se borran los videos grabados. Los clips ya exportados se conservan.', ok: 'Quitar', danger: true }))) return; await api('/api/storage/remove', { sids: ids }); toast('Espacio liberado', 'good'); await refresh(); return loadSto(); }
    }
    if (q('discard')) { await api('/api/discard', { sid: srcOf(e.target).id, cid: q('discard').dataset.discard }); return refresh(); }
    if (e.target.id === 'tl' && TL && TL.seconds) {
      const b = e.target.getBoundingClientRect(), t = Math.round(((e.clientX - b.left) / b.width) * TL.seconds), s = cur();
      let c = s.candidates.find((x) => t >= x.start && t <= x.end);
      if (!c) { const m = await api('/api/mark', { sid: selSrc, start: Math.max(0, t - 28), end: Math.min(TL.seconds, t + 12) }); await refresh(); c = cur().candidates.find((x) => x.id === m.id); }
      return toEditor(cur(), c);
    }
    if (q('cliptab')) { clipTab = q('cliptab').dataset.cliptab; last.clips = null; return render(); }
    if (q('clipstreamer')) { clipStreamer = q('clipstreamer').dataset.clipstreamer; last.clips = null; return render(); }
    if (q('clipkind')) { clipKind = q('clipkind').dataset.clipkind; return render(); }
    if (q('openclip') && !e.target.closest('a, button, input, video')) { openClip = q('openclip').dataset.openclip; return render(); }
    if (q('gosettings')) return go('settings');
    if (q('clipdel')) { if (await ask('¿Borrar este clip?', { ok: 'Borrar', danger: true })) { await api('/api/clip/remove', { cid: q('clipdel').dataset.clipdel }); pickedClips.delete(q('clipdel').dataset.clipdel); last.clips = null; refresh(); } return; }
    if (q('ttinstall')) {
      const button = q('ttinstall'); button.disabled = true; button.textContent = 'Instalando…';
      try { await api('/api/tiktok-upload/install', {}); toast('Librería para TikTok instalada', 'good'); }
      catch (err) { toast(err.message, 'bad'); }
      finally { settingsDrawn = false; await refresh(); }
      return;
    }
    if (q('ttconnect')) {
      const account = $('sTikTokAccount').value.trim();
      if (!account) return toast('Escribe primero tu usuario de TikTok.');
      q('ttconnect').disabled = true; q('ttconnect').textContent = 'Conectando…';
      let limit;
      const tooLong = new Promise((_, reject) => { limit = setTimeout(() => reject(new Error('La conexión tardó demasiado. Si ya entraste en TikTok, pulsa «Reconectar cuenta»; si no, reinicia Clipper.')), 300000); });
      try { await Promise.race([api('/api/tiktok-upload/connect', { account }), tooLong]); toast('Cuenta de TikTok conectada', 'good'); }
      catch (err) { toast(err.message, 'bad'); }
      finally { clearTimeout(limit); settingsDrawn = false; await refresh(); }
      return;
    }
    if (q('uptt')) {
      // Antes de subir: si TikTok lo puede tratar como repetido (clip de la comunidad sin cambios o con su titulo), se avisa.
      const cid = q('uptt').dataset.uptt, c = S.clips.find((x) => x.id === cid), r = await api('/api/tiktok-risks', { cid }).catch(() => ({ risks: [] }));
      if (r.risks.length) {
        const go = await ask('Puede que TikTok casi no lo enseñe', { text: r.risks.join(' ') + ' Mejor cámbiale el título y edítalo un poco (subtítulos, recorte, zoom). ¿Subirlo igual?', ok: 'Subir igual' });
        if (!go) return toast('No se subió. Ábrelo en el editor para cambiarlo, o cámbiale el título en su ficha.');
        if (r.risks.some((x) => x.startsWith('El título'))) {
          const nt = await ask('Título nuevo para TikTok', { text: 'Uno propio, distinto del de Twitch. Puedes cambiarlo.', value: r.title || c?.title || '', ok: 'Usar este título' });
          if (nt && nt.trim() && nt.trim() !== c?.title) await api('/api/clip/update', { cid, title: nt.trim() });
        }
      }
      // Si Clipper lo va a programar (mejor hora o 1 h desde el anterior), se elige: programado o ya.
      let now = false;
      const slot = await api('/api/tiktok-slot', {}).catch(() => null);
      if (slot?.at) {
        const hora = new Date(slot.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        const pick = await ask('¿Cuándo lo publico en TikTok?', { text: `${slot.why} Recomendado: programarlo para las ${hora}.`, ok: `Programar a las ${hora}`, alt: 'Subir ya' });
        if (!pick) return toast('No se subió.');
        now = pick === 'alt';
      }
      toast('Subiendo a TikTok…'); api('/api/tiktok-upload', { cid, now }).then(() => { toast('Subido a TikTok', 'good'); refresh(); }).catch((err) => { toast(err.message, 'bad'); refresh(); }); return setTimeout(refresh, 400); }
    if (q('up')) { toast('Subiendo a YouTube…'); api('/api/upload', { cid: q('up').dataset.up }).then(() => { toast('Subido a YouTube', 'good'); refresh(); }).catch((err) => toast(err.message, 'bad')); return setTimeout(refresh, 400); }
    if (q('unsched')) { await api('/api/clip/update', { cid: q('unsched').dataset.unsched, scheduledAt: null }); last.clips = null; return refresh(); }
    if (q('slot')) { if (pickedClips.size !== 1) return toast('Selecciona un solo clip (o arrástralo) para ponerlo en este hueco.'); await api('/api/clip/update', { cid: [...pickedClips][0], scheduledAt: q('slot').dataset.slot }); pickedClips.clear(); last.clips = null; toast('Programado', 'good'); return refresh(); }
    if (q('act')) {
      const a = q('act').dataset.act, s = cur();
      if (a === 'sacar') return sacarClips(s);
      if (a === 'pickall') {
        for (const c of clipList().filter((c) => c.status === 'listo')) q('act').dataset.k === '1' ? pickedClips.add(c.id) : pickedClips.delete(c.id);
        last.clips = null; return render();
      }
      if (a === 'perf') { showPerf = !showPerf; return render(); }
      if (a === 'dlpicked') {
        // uno a uno: el navegador puede preguntar una vez si se permiten varias descargas
        for (const c of S.clips.filter((x) => pickedClips.has(x.id) && x.file)) { const l = document.createElement('a'); l.href = dlHref(c); l.download = ''; document.body.append(l); l.click(); l.remove(); await new Promise((r) => setTimeout(r, 400)); }
        return;
      }
      if (a === 'delpicked') {
        const ids = [...pickedClips].filter((id) => { const c = S.clips.find((x) => x.id === id); return c && !c.uploading && !c.tiktokUploading; });
        const busy = pickedClips.size - ids.length;
        if (!ids.length) return toast('Esos clips se están subiendo; espera a que terminen para borrarlos.');
        if (!(await ask(`¿Borrar ${ids.length === 1 ? 'este clip' : `estos ${ids.length} clips`} y sus archivos? No se puede deshacer.${busy ? ` (${busy} se están subiendo y no se tocan.)` : ''}`, { ok: 'Borrar', danger: true }))) return;
        for (const id of ids) { await api('/api/clip/remove', { cid: id }); pickedClips.delete(id); }
        toast(`${ids.length === 1 ? 'Clip borrado' : `${ids.length} clips borrados`}`, 'good'); last.clips = null; return refresh();
      }
      if (a === 'manual') await api('/api/mark', { sid: selSrc, start: parseT($('mFrom').value), end: parseT($('mTo').value) });
      else if (a === 'batch' || a === 'top3') {
        // Los 3 mejores: de lo que se ve en la lista, sin los ya exportados ni los repetidos.
        const list = a === 'batch' ? [...picked].map(pair).filter((x) => x[1]) : (selSrc === '*' ? allPairs() : s.candidates.filter(byFilter).map((c) => [s, c])).filter((x) => !x[1].exported && !x[1].dup).sort((x, y) => y[1].score - x[1].score).slice(0, 3);
        if (!list.length) return toast('No queda ningún momento sin exportar en esta lista.');
        await api('/api/export', { items: list.map(([x, c]) => quick(x, c)) }); picked.clear(); toast(`Exportando ${list.length} clips con la plantilla`);
      } else if (a === 'montage') { const title = await ask('Título del montaje', { value: 'Mejores momentos', ok: 'Unir clips' }); if (title == null) return; await api('/api/montage', { cids: [...pickedClips], title, transition: montTrans }); pickedClips.clear(); toast('Uniendo clips…'); }
      else if (a === 'views') { await api('/api/views', {}); toast('Vistas actualizadas', 'good'); }
      else if (a === 'voice') return toggleVoice();
      else if (a === 'trends') { const b = q('act'); b.disabled = true; b.textContent = 'Buscando…'; const t = await api('/api/trends', { streamer: s.streamer }); toast(t ? `Tendencias de ${s.streamer}: ${t.n} clips, duración ideal ${t.seconds} s. Se usan al puntuar, en la duración y en los títulos.` : 'No encontré suficientes Shorts de este streamer.', t ? 'good' : 'bad'); }
      else if (a === 'resume') { const n = await api('/api/source', { value: s.origin, live: true, streamer: s.streamer || '' }); selSrc = n.id; TL = null; toast('Conectando con el directo… (la grabación sigue en una fuente nueva, con su chat)', 'good'); }
      else if (a === 'analyze') {
        // Con el video ya analizado termina en un segundo: se avisa del resultado para que se note que hizo algo.
        const b = q('act'), n0 = s.candidates.length;
        b.disabled = true; b.textContent = 'Analizando…';
        await api('/api/analyze', { sid: selSrc });
        let x = s;
        for (let i = 0; i < 600; i++) { await new Promise((r) => setTimeout(r, 600)); x = (await api('/api/state')).sources.find((y) => y.id === selSrc); if (!x || x.status !== 'analizando') break; }
        if (x?.error) toast(x.error, 'bad');
        else if (x) { const d = x.candidates.length - n0; toast(d > 0 ? `Análisis listo: ${d} momento${d > 1 ? 's' : ''} nuevo${d > 1 ? 's' : ''}` : `Análisis listo: sin momentos nuevos (${x.candidates.length} en total)`, 'good'); }
      }
      else await api('/api/' + a, { sid: selSrc });
      last.liveBody = last.clips = null;
      refresh();
    }
  } catch (err) { toast(err.message, 'bad'); }
});

// Arrastrar un clip a un hueco del calendario.
document.addEventListener('dragstart', (e) => { const d = e.target.closest?.('[data-drag]'); if (d) e.dataTransfer.setData('text/plain', d.dataset.drag); });
document.addEventListener('dragover', (e) => { const s = e.target.closest?.('[data-slot]'); if (s) { e.preventDefault(); s.classList.add('over'); } });
document.addEventListener('dragleave', (e) => e.target.closest?.('[data-slot]')?.classList.remove('over'));
document.addEventListener('drop', async (e) => {
  const s = e.target.closest?.('[data-slot]');
  if (!s) return;
  e.preventDefault();
  try { await api('/api/clip/update', { cid: e.dataTransfer.getData('text/plain'), scheduledAt: s.dataset.slot }); last.clips = null; toast('Programado', 'good'); refresh(); } catch (err) { toast(err.message, 'bad'); }
});

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || !!document.activeElement?.isContentEditable;
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.openclip) { e.preventDefault(); return e.target.click(); }
  // Esc cierra la ayuda aunque el cursor este en su buscador.
  if (e.key === 'Escape' && document.getElementById('sheet')) return closeHelp();
  if (e.key === 'Enter' && document.activeElement?.id === 'value') return addSource().catch((err) => toast(err.message, 'bad'));
  if (typing) return;
  if (document.querySelector('.scrim')) return;
  const act = document.activeElement;
  if ((e.key === 'Enter' || e.key === ' ') && act?.getAttribute?.('role') === 'button' && act.tagName !== 'BUTTON') { e.preventDefault(); return act.click(); }
  // Con el foco en un botón, Espacio es de ese botón, no un atajo global.
  if (e.key === ' ' && act?.tagName === 'BUTTON') return;
  if (e.key === '?') return openHelp(view === 'editor' ? '' : { live: 'empezar', clips: 'clips', settings: 'aprende' }[view]);
  if (view === 'editor') return editorKey(e);
  if (view === 'live' && (e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && cur()?.status === 'grabando') return replay(30);
  if (view === 'live' && e.code === 'Space' && cur()?.status === 'grabando') { e.preventDefault(); api('/api/mark', { sid: selSrc, last: 45 }).then(() => { toast('Guardados los últimos 45 s', 'good'); refresh(); }).catch((err) => toast(err.message, 'bad')); }
});

go('live');
refresh().then(() => setTimeout(() => tour(), 900));
setInterval(refresh, 2000);
