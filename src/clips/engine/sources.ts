/** Fuentes: importar archivos y enlaces, descargar, grabar directos y medirlos mientras se graban. */
import fs from 'node:fs';
import { readJson, slug, writeJson } from '../../shared/fs';
import path from 'node:path';
import { backfillNumbers, smooth, zscores } from '../analysis/detect';
import { energyPerSecond, FFMPEG, probe } from '../media/ff';
import { spawn } from 'node:child_process';
import { ChatTap, chatZ, parseChatFile } from '../analysis/chat';
import { analyze, camCache, liveShot } from './analysis';
import { autoBackup } from './backup';
import { community, stoppedLive, streamStartOf } from './community';
import { analyzing, type Candidate, clamp, clips, CLIPS, dir, jsonFile, loadArr, log, MEDIA, momSeq, nextMom, procs, replaceTemplates, save, settings, type Settings, SETTINGS, type Source, sources, taps, TEMPLATES } from './core';
import { disk } from './disk';
import { alertPhone } from './notify';
import { src } from './preview';
import { ensureYtdlp, YTDLP } from './tools';

/** Un VOD que se llama como su identificador («01a17413-f760-…»): el streamer y el titulo del directo, en segundo plano. */
export const idLike = (name: string) => /^[0-9a-f]{8}-[0-9a-f-]{8,}$|^v?\d{6,}$/i.test(name);
export function nameVods() {
  for (const s of sources.values()) if (idLike(s.name) && /twitch\.tv|kick\.com/.test(s.origin) && !s.live) void streamStartOf(s).then(() => { if (!idLike(s.name)) save(s); }).catch(() => {});
}
export function loadAll() {
  if (fs.existsSync(SETTINGS)) Object.assign(settings, readJson<Settings>(SETTINGS));
  if (fs.existsSync(TEMPLATES)) replaceTemplates(readJson(TEMPLATES));
  for (const [root, map] of [[MEDIA, sources], [CLIPS, clips]] as const) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) {
      const f = path.join(root, d, 'meta.json');
      if (!fs.existsSync(f)) continue;
      const m = readJson<any>(f);
      // Si la carpeta del proyecto se movio (otro disco), las grabaciones propias se usan desde su sitio nuevo.
      const own = map === sources && m.file ? path.join(dir(m.id), path.basename(m.file)) : '';
      if (own && path.resolve(m.file) !== own && fs.existsSync(own)) m.file = own;
      // Lo que quedo a medias al cerrar la app se marca como interrumpido.
      if (map === sources && recAlive(m)) { m.status = 'grabando'; m.progress = undefined; (map as Map<string, any>).set(m.id, m); continue; }
      if (map === sources && ['descargando', 'grabando', 'analizando'].includes(m.status)) {
        const ok = m.file && fs.existsSync(m.file), rec = m.status === 'grabando' || (m.status === 'analizando' && m.live);
        Object.assign(m, { status: ok ? 'listo' : 'error', error: ok ? undefined : 'Interrumpido', progress: undefined, live: false });
        // Un directo cortado al cerrar la app: se ofrece seguir grabandolo.
        if (rec && ok) m.cut = true;
      }
      // El estado del chat en directo no sobrevive a un cierre: sin grabacion activa, solo queda lo que se guardo.
      if (map === sources && m.chat === 'leyendo chat') m.chat = fs.existsSync(path.join(root, d, 'chat.json')) ? 'chat guardado' : undefined;
      if (map === clips) {
        if (m.status !== 'listo' && m.status !== 'error') Object.assign(m, { status: 'error', error: 'Interrumpido al cerrar la app' });
        // Una subida cortada al cerrar la app no sigue en ningun sitio: si no se suelta, el clip queda «en cola» para siempre.
        Object.assign(m, { uploading: false, tiktokUploading: false, ytPct: undefined, ttPct: undefined, ttStep: undefined });
        m.kind = m.kind || 'clip';
      }
      (map as Map<string, any>).set(m.id, m);
      // Los momentos de antes de llevar numero de generacion lo reciben por orden del video.
      if (map === sources) {
        const cands: Candidate[] = m.candidates || [];
        if (cands.some((c) => !c.n)) { momSeq.set(m.id, backfillNumbers(cands)); save(m); }
        else momSeq.set(m.id, cands.reduce((x, c) => Math.max(x, c.n || 0), 0) + 1);
      }
    }
  }
  for (const s of sources.values()) if (s.status === 'grabando') reattach(s);
  autoBackup();
}

// ---------- fuentes ----------
function newSource(name: string, streamer: string, origin: string, live: boolean): Source {
  const id = `${new Date().toISOString().slice(5, 19).replace(/[-T:]/g, '')}-${slug(name).slice(0, 30) || 'fuente'}`;
  const s: Source = { id, name, streamer, origin, file: '', live, status: 'descargando', duration: 0, width: 0, height: 0, analyzedTo: 0, candidates: [], createdAt: new Date().toISOString() };
  fs.mkdirSync(dir(id), { recursive: true });
  sources.set(id, s);
  save(s);
  return s;
}

async function ready(s: Source) {
  const p = await probe(s.file);
  Object.assign(s, { duration: p.duration, width: p.width, height: p.height, status: 'listo', progress: undefined });
  // Un clip de la comunidad ya es el momento: entero, listo para pasarlo a vertical.
  // Si se bajo del directo con margen (`at`), el momento es justo lo que clipeo la gente: alrededor queda sitio para alargarlo.
  const at = s.community?.at, [ca, cb] = at ? [Math.min(at[0], p.duration), Math.min(at[1], p.duration)] : [0, p.duration];
  if (s.community && !s.candidates.length) s.candidates.push({ id: 'k0', n: nextMom(s), peak: (ca + cb) / 2, z: 0, start: ca, end: cb, score: 9, why: `clip de la comunidad · ${s.community.views} vistas${at ? ' · aquí empieza y acaba el original; alárgalo en el editor' : ''}`, title: s.community.title.replace(/ · en el directo$/, ''), text: '', by: 'comunidad' });
  save(s);
  analyze(s.id);
}

export async function addFile(file: string, streamer: string, autoClips = false) {
  const abs = path.resolve(file.replace(/^"|"$/g, ''));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('No existe el archivo: ' + abs);
  const s = newSource(path.basename(abs, path.extname(abs)), streamer, abs, false);
  s.file = abs;
  if (autoClips) s.autoClips = true;
  await ready(s);
  return s;
}

export const channelOf = (url: string) => { try { return new URL(url).pathname.split('/').filter(Boolean)[0] || ''; } catch { return ''; } };

export function addUrl(url: string, streamer: string, live: boolean, section?: string, community?: Source['community'], autoClips = false) {
  if (!/^https?:\/\//.test(url)) throw new Error('La dirección debe empezar por http');
  if (live) stoppedLive.delete(url); // grabarlo a mano vuelve a dejar que la vigilancia lo retome
  const st = streamer || (live ? channelOf(url) : '');
  const s = newSource(community?.title || st || new URL(url).pathname.split('/').filter(Boolean).pop() || 'directo', st, url, live);
  if (community) s.community = community;
  if (autoClips && !live) s.autoClips = true; // en directo no: no termina
  const fail = (e: unknown) => { Object.assign(s, { status: 'error', error: (e as Error).message, progress: undefined }); save(s); };
  ensureYtdlp((t) => (s.progress = t)).then(() => startDownload(s, url, live, section)).catch(fail);
  return s;
}

const stopped = new Set<string>();
function startDownload(s: Source, url: string, live: boolean, section?: string) {
  s.progress = live ? 'conectando con el directo' : 'empezando la descarga';
  const out = live ? path.join(dir(s.id), 'live.ts') : path.join(dir(s.id), 'source.%(ext)s');
  const args = live
    ? ['--no-part', '--hls-use-mpegts', '--ffmpeg-location', FFMPEG, '-o', out, url]
    : ['--no-playlist', '--newline', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG, ...(section ? ['--download-sections', `*${section}`] : []), '-o', out, url];
  // En directo, el grabador va por libre (detached): si se cierra o se reinicia la app, sigue grabando. Sus mensajes van
  // a rec.log, de donde se saca el error si falla.
  const p = live
    ? spawn(YTDLP, args, { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', fs.openSync(path.join(dir(s.id), 'rec.log'), 'a')] })
    : spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  procs.set(s.id, p);
  let err = '';
  if (live) {
    s.recPid = p.pid;
    p.unref();
    // Se marca como "grabando" desde el principio, para que el boton Detener este siempre disponible.
    Object.assign(s, { file: out, status: 'grabando', progress: 'conectando con el directo' });
    const t = setInterval(() => {
      if (!procs.has(s.id)) return clearInterval(t);
      if (fs.existsSync(out)) {
        clearInterval(t);
        // Este instante es el segundo 0 de la grabacion.
        Object.assign(s, { progress: undefined, createdAt: new Date().toISOString() });
        save(s);
        log(`Grabando ${s.name}`);
        listenChat(s);
      }
    }, 1000);
  }
  p.stdout?.on('data', (d) => {
    const m = String(d).match(/\[download\]\s+([\d.]+%.*?)(?:\r|\n|$)/);
    if (m && !live) s.progress = m[1].trim();
    // Tras el 100 %, ffmpeg une/arregla el video: en uno de horas tarda minutos y parecia colgado.
    else if (!live && /\[(Merger|Fixup\w*)\]/.test(String(d))) s.progress = 'preparando el video (unos minutos si es largo)';
  });
  p.stderr?.on('data', (d) => (err = (err + d).slice(-800)));
  p.on('error', (e) => { procs.delete(s.id); Object.assign(s, { status: 'error', error: e.message }); save(s); log(`Error al lanzar yt-dlp: ${e.message}`); });
  p.on('close', async (code) => {
    if (live) return finishLive(s, code);
    procs.delete(s.id);
    const lastErr = stopped.has(s.id) ? 'Detenido por ti' : err.split('\n').filter((l) => /ERROR/.test(l)).pop() || err.split('\n').filter(Boolean).pop();
    log(`Descarga de ${s.name} terminada${code ? ' (código ' + code + ')' : ''}`);
    try {
      {
        const f = fs.readdirSync(dir(s.id)).find((x) => x.startsWith('source.') && !x.endsWith('.part'));
        if (code !== 0 || !f) throw new Error(lastErr || 'yt-dlp no pudo descargar el video');
        s.file = path.join(dir(s.id), f);
        await fetchVodChat(s, url, section).catch(() => {});
        await ready(s);
      }
    } catch (e) {
      Object.assign(s, { status: 'error', error: (e as Error).message, progress: undefined });
      save(s);
      log(`${s.name}: ${(e as Error).message}`);
    }
  });
  save(s);
}

/** Lee el chat del directo. Al volver a engancharse se sigue sumando a lo ya guardado. */
function listenChat(s: Source) {
  const tap = new ChatTap(s.origin, () => +new Date(s.createdAt));
  if (fs.existsSync(jsonFile(s.id, 'chat'))) tap.data = readJson(jsonFile(s.id, 'chat'));
  taps.set(s.id, tap);
  tap.start().then(() => log(`Chat de ${s.name}: ${tap.status}`));
}
/** ¿Sigue vivo el grabador de una sesion anterior? Su pid existe y el archivo crecio hace poco (no es otro proceso con el mismo pid). */
function recAlive(m: Partial<Source>) {
  if (m.status !== 'grabando' || !m.recPid || !m.file || !fs.existsSync(m.file)) return false;
  try { process.kill(m.recPid, 0); } catch { return false; }
  return Date.now() - fs.statSync(m.file).mtimeMs < 90_000;
}
/** Vuelve a enganchar una grabacion que siguio mientras la app estaba cerrada: chat, analisis y aviso al terminar. */
function reattach(s: Source) {
  const pid = s.recPid!;
  procs.set(s.id, { pid, kill: () => { try { process.kill(pid); } catch { /* ya termino */ } return true; } });
  log(`Grabación de ${s.name} recuperada: siguió grabando mientras Clipper estaba cerrado`);
  listenChat(s);
  const t = setInterval(() => {
    try { process.kill(pid, 0); } catch { clearInterval(t); finishLive(s, null); }
  }, 3000);
}
/** El directo termino (o se detuvo): se guarda el chat y se analiza lo grabado. */
async function finishLive(s: Source, code: number | null) {
  if (!procs.has(s.id)) return;
  procs.delete(s.id);
  const out = s.file, tap = taps.get(s.id);
  if (tap) { writeJson(jsonFile(s.id, 'chat'), tap.data); tap.stop(); taps.delete(s.id); s.chat = undefined; }
  let err = '';
  try { err = fs.readFileSync(path.join(dir(s.id), 'rec.log'), 'utf8').slice(-2000); } catch { /* sin registro */ }
  const lines = err.split(/\r?\n/).filter(Boolean);
  const lastErr = stopped.has(s.id) ? 'Detenido por ti' : lines.filter((l) => l.includes('ERROR')).pop() || lines.pop();
  log(`Grabación de ${s.name} terminada${code ? ' (código ' + code + ')' : ''}`);
  s.recPid = undefined;
  try {
    if (!fs.existsSync(out) || fs.statSync(out).size < 200_000) throw new Error(stopped.has(s.id) ? 'Detenido antes de grabar nada' : lastErr || 'El directo no empezó a grabarse (¿está en vivo?)');
    s.live = false;
    const p2 = await probe(out);
    Object.assign(s, { status: 'listo', width: p2.width, height: p2.height, duration: p2.duration || s.analyzedTo });
    save(s);
    analyze(s.id);
  } catch (e) {
    Object.assign(s, { status: 'error', error: (e as Error).message, progress: undefined });
    save(s);
    log(`${s.name}: ${(e as Error).message}`);
  }
}

export function stop(sid: string) {
  const p = procs.get(sid);
  if (!p) return;
  stopped.add(sid);
  const s = sources.get(sid);
  if (s?.live) stoppedLive.add(s.origin);
  // En Windows, yt-dlp lanza otro proceso que sigue grabando si no se cierra el arbol completo.
  if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill('SIGINT');
}

/** Quita la fuente de la lista y borra sus archivos de trabajo (nunca tu archivo original). */
export function remove(sid: string) {
  stop(sid);
  sources.delete(sid);
  momSeq.delete(sid);
  energyMem.delete(sid);
  liveShot.delete(sid);
  camCache.delete(sid);
  if (sid && !sid.includes('..')) fs.rmSync(dir(sid), { recursive: true, force: true });
}

/**
 * Chat guardado de un directo ya terminado (Twitch y YouTube lo conservan; Kick no lo ofrece).
 * Lo descarga yt-dlp junto al video, para que el chat tambien cuente al puntuar un resubido.
 */
async function fetchVodChat(s: Source, url: string, section?: string) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return; }
  if (!/twitch\.tv|youtube\.com|youtu\.be/.test(host)) return;
  s.progress = 'leyendo el chat guardado';
  await new Promise<void>((resolve) => {
    const p = spawn(YTDLP, ['--skip-download', '--no-playlist', '--no-warnings', '--write-subs', '--sub-langs', 'live_chat,rechat', '-o', path.join(dir(s.id), 'vodchat'), url], { stdio: 'ignore' });
    const t = setTimeout(() => p.kill(), 90_000); // el chat no debe retrasar mas de minuto y medio el analisis
    const done = () => { clearTimeout(t); resolve(); };
    p.on('error', done);
    p.on('close', done);
  });
  const f = fs.readdirSync(dir(s.id)).find((x) => /^vodchat\..*(live_chat|rechat)\.json$/.test(x));
  if (!f) return;
  const off = section ? String(section).split('-')[0].split(':').map(Number).reduce((a, v) => a * 60 + (v || 0), 0) : 0;
  const data = parseChatFile(fs.readFileSync(path.join(dir(s.id), f), 'utf8'), off);
  const n = data.rate.reduce((a, b) => a + b, 0);
  if (n > 20) { writeJson(jsonFile(s.id, 'chat'), data); s.chat = 'chat guardado leído'; log(`${s.name}: chat guardado leído (${n} mensajes)`); }
}

// ---------- medicion continua del directo ----------
// El volumen se mide cada 5 s (es barato); el analisis completo va cada minuto (20 s en modo rapido),
// o en cuanto el volumen y el chat se disparan, para que el momento aparezca a los pocos segundos.
const energyMem = new Map<string, number[]>();
const measuring = new Map<string, Promise<void>>();
export const energyOf = (sid: string) => energyMem.get(sid) ?? loadArr(sid, 'energy');
/** Mide el volumen de lo nuevo. Las llamadas a una misma fuente van en fila: nunca dos a la vez. */
export function measure(s: Source, live: boolean) {
  const p = (measuring.get(s.id) || Promise.resolve()).then(async () => {
    const energy = energyOf(s.id);
    const fresh = await energyPerSecond(s.file, energy.length);
    // En directo se descartan los ultimos segundos, que pueden estar a medio escribir.
    if (live) fresh.splice(-3);
    if (fresh.length) { energy.push(...fresh); writeJson(jsonFile(s.id, 'energy'), energy); }
    energyMem.set(s.id, energy);
    s.analyzedTo = energy.length;
  }).catch((e) => { if (process.env.DEBUG_CLIPPER) console.log('measure', e); });
  measuring.set(s.id, p);
  return p;
}

const WIN = 1200; // el "volumen normal" se calcula sobre los ultimos 20 minutos
/** Como esta el directo ahora mismo: volumen y chat de los ultimos 2 minutos, y un "calor" de 0 a 100. */
export function heatOf(energy: number[], rate: number[] | null, win = 8) {
  const n = energy.length, from = Math.max(0, n - WIN);
  const az = smooth(zscores(energy.slice(from)), 1);
  const cz = rate && rate.length ? chatZ(Array.from({ length: n - from }, (_, i) => rate[from + i] ?? 0), n - from) : null;
  const a = Math.max(0, ...az.slice(-win)), c = cz ? Math.max(0, ...cz.slice(-win - 4)) : 0;
  const z = a + 0.7 * Math.min(8, c);
  return { az, cz, a, c, z, heat: Math.round(clamp(z / 6, 0, 1) * 100) };
}
export function pulse(sid: string) {
  const s = src(sid), energy = energyOf(sid), tap = taps.get(sid), n = energy.length;
  const rate = tap?.data.rate ?? null;
  const h = heatOf(energy, rate);
  const tail = <T,>(a: T[]) => a.slice(-120);
  return {
    t: n, recSeconds: s.status === 'grabando' ? Math.max(0, Math.round((Date.now() - +new Date(s.createdAt)) / 1000)) : 0,
    heat: n < 20 ? 0 : h.heat, hot: n >= 30 && h.z >= HOT,
    audio: tail(h.az).map((v) => Math.round(clamp(v, -2, 8) * 10) / 10),
    chat: rate ? tail(Array.from({ length: n }, (_, i) => rate[i] ?? 0)) : [],
    chatNow: rate ? Math.round((rate.slice(Math.max(0, n - 5), n + 3).reduce((x, y) => x + y, 0) / 5) * 10) / 10 : null,
    why: [h.a >= 4 ? 'volumen muy alto' : h.a >= 2 ? 'volumen alto' : 'volumen normal', rate ? (h.c >= 3 ? 'el chat se disparó' : h.c >= 1.5 ? 'el chat se anima' : 'chat tranquilo') : ''].filter(Boolean).join(' · '),
    chatStatus: tap?.status ?? s.chat ?? '', msgs: tap ? tap.recent.slice(-40) : [],
  };
}
const HOT = 3.6;

const lastLive = new Map<string, number>();
const ticking = new Set<string>();
let diskWarned = 0;
setInterval(() => {
  const every = (settings.fast ? 20 : Number(process.env.LIVE_ANALYZE_SECONDS || 60)) * 1000;
  const rec = [...sources.values()].filter((s) => s.status === 'grabando' && fs.existsSync(s.file));
  if (rec.length) {
    // Con el disco casi lleno se avisa; si queda menos de 1 GB se detiene la grabacion para no perderla.
    const free = disk().free;
    if (free < 1e9) { for (const s of rec) { log(`Disco casi lleno: detengo la grabación de ${s.name} para no perderla`); stop(s.id); } return; }
    if (free < 5e9 && Date.now() - diskWarned > 600_000) { diskWarned = Date.now(); log(`Queda poco espacio en disco (${(free / 1e9).toFixed(1)} GB). Libera espacio en Ajustes.`); alertPhone(`Clipper: queda poco espacio en disco (${(free / 1e9).toFixed(1)} GB).`).catch(() => {}); }
  }
  for (const s of rec) {
    if (ticking.has(s.id) || analyzing.has(s.id)) continue;
    ticking.add(s.id);
    measure(s, true).then(() => {
      if (analyzing.has(s.id) || s.status !== 'grabando') return;
      const since = Date.now() - (lastLive.get(s.id) || 0), n = s.analyzedTo;
      const hot = n >= 30 && since >= 12_000 && heatOf(energyOf(s.id), taps.get(s.id)?.data.rate ?? null, 14).z >= HOT;
      // Un momento que se detecto con el final a medias se completa en cuanto hay grabacion suficiente.
      const pending = since >= 6000 && s.candidates.some((c) => c.endWant && c.end < c.endWant && n >= c.endWant);
      if (since < every && !hot && !pending) return;
      lastLive.set(s.id, Date.now());
      analyze(s.id);
    }).finally(() => ticking.delete(s.id));
  }
}, 5000).unref();
