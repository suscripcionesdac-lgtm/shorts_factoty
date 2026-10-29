/** Escuela del agente: estudiar shorts que funcionan. */
import path from 'node:path';
import { type Case, hookExamples, keepBest, learnFrom, lessonLines, nextSearch, nextTiktok, parseLinks, pickVideos, studyCase, TIKTOK_DAY } from '../analysis/school';
import fs from 'node:fs';
import { readJson, writeJson } from '../../shared/fs';
import * as TT from '../publish/tiktok';
import { energyPerSecond, FFMPEG, probe, run } from '../media/ff';
import { measureEvents } from '../analysis/refstyle';
import { type Word } from '../../shared/timing';
import { foreground } from './analysis';
import { capture } from './community';
import { DATA, key, listen, log, settings, sources } from './core';
import { ensureYtdlp, YTDLP } from './tools';

// ---------- escuela del agente ----------
// En segundo plano mira shorts que funcionan, de muchos temas (ver school.ts), mide como estan editados y lo aprende.
// Cede el paso a lo que hace el usuario, va sin prisa (para no molestar a YouTube) y borra cada video al terminar.
const SCHOOL_FILE = path.join(DATA, 'school.json'), SCHOOL_TMP = path.join(DATA, 'school-tmp');
const SCHOOL_DAY = 40; // como mucho, videos al dia en automatico
export const SCHOOL_FROM = (n: number) => `${n} shorts estudiados`;
type SchoolData = { cases: Case[]; tried: string[]; round: number; day: string; today: number; ttRound?: number; ttToday?: number; /** TikTok pidio captcha a la ventana automatica: no se insiste hasta esta fecha. */ ttPause?: string; queue?: QItem[] };
/** Pendiente de estudiar: un enlace que pego el usuario (sin datos aun) o un TikTok que vio con Clipper. */
type QItem = { url: string; topic: string; mine?: boolean; id?: string; title?: string; views?: number; seconds?: number };
export let school: SchoolData = { cases: [], tried: [], round: 0, day: '', today: 0, ...(fs.existsSync(SCHOOL_FILE) ? readJson<Partial<SchoolData>>(SCHOOL_FILE) : {}) };
export let knowledge = learnFrom(school.cases), schoolNow = '', schoolBusy = false;
const schoolOff = () => !!process.env.VITEST || process.env.CLIPPER_NO_AI === '1' || settings.school === false;
const today = () => new Date().toISOString().slice(0, 10);
const studiedToday = () => (school.day === today() ? school.today : 0);
const ttPaused = () => !!school.ttPause && Date.now() < +new Date(school.ttPause);
const tiktokToday = () => (school.day === today() ? school.ttToday || 0 : 0);
export function schoolState() {
  return {
    on: settings.school !== false, n: school.cases.length, today: studiedToday(), queue: school.queue?.length || 0, mine: school.cases.filter((c) => c.mine).length, busy: schoolBusy ? schoolNow || 'empezando' : '', topics: knowledge?.topics || {}, lines: lessonLines(knowledge), hooks: hookExamples(knowledge).slice(0, 3),
    tiktok: { ...TT.status(), pausedUntil: ttPaused() ? school.ttPause : '', creators: settings.tiktok?.creators || [], tags: settings.tiktok?.tags || [], today: tiktokToday(), max: TIKTOK_DAY },
  };
}
/** Descarga un short en baja calidad, lo mide y lo transcribe. Solo quedan las medidas. */
async function studyOne(v: { id: string; url: string; title: string; views: number; seconds: number }, topic: string, mine = false): Promise<Case> {
  const d = path.join(SCHOOL_TMP, v.id.replace(/[^\w-]/g, ''));
  fs.mkdirSync(d, { recursive: true });
  try {
    const r = await run(YTDLP, ['--no-playlist', '--no-warnings', '-f', 'b[height<=480]/bv*[height<=480]+ba/b', '--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG, '--max-filesize', '80M', '-o', path.join(d, 'v.%(ext)s'), v.url]);
    const f = fs.readdirSync(d).find((x) => x.startsWith('v.') && !x.endsWith('.part'));
    if (!f) throw new Error((r.stderr.split('\n').filter((l) => /ERROR/.test(l)).pop() || 'no se pudo descargar').slice(0, 160));
    // Un TikTok de fotos (carrusel con musica) solo trae el audio: no hay edicion de video que aprender.
    if (/\.(m4a|mp3|aac|opus|ogg|wav)$/i.test(f)) throw new Error('es de fotos con música (sin video), se salta');
    const file = path.join(d, f);
    // Solo se aprende del formato short: un video horizontal se edita de otra manera (y uno largo no es un short).
    const p = await probe(file);
    if (p.width >= p.height) throw new Error('no es vertical, no se estudia');
    if (p.duration > 185 || p.duration < 6) throw new Error('no dura lo que un short, no se estudia');
    const ev = await measureEvents(file);
    const energy = await energyPerSecond(file, 0);
    let words: Word[] = [];
    try { words = await listen(file, 0, Math.min(ev.seconds || v.seconds, 90)); } catch { /* sin voz se aprende igual la imagen */ }
    return studyCase({ ...v, topic, ev, words, energy, mine });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
/** Estudia `n` shorts nuevos. `manual`: lo pidio el usuario (sin limite diario y sin pausas largas). */
export async function study(n = 5, manual = false) {
  if (schoolBusy || process.env.CLIPPER_NO_AI === '1' || (!manual && schoolOff())) return schoolState();
  schoolBusy = true;
  try {
    await ensureYtdlp();
    const tried = new Set(school.tried);
    const streamers = [...new Set([...sources.values()].map((s) => s.streamer).filter((x) => x && key(x) !== 'general'))].slice(0, 5);
    let done = 0, misses = 0;
    // Primero lo pendiente: los enlaces que pego el usuario y los TikToks que vio con Clipper.
    while (school.queue?.length) {
      const q = school.queue.shift()!;
      writeJson(SCHOOL_FILE, school);
      while (foreground()) await new Promise((ok) => setTimeout(ok, 5000));
      let v = q.id && q.views != null ? { id: q.id, url: q.url, title: q.title || '', views: q.views, seconds: q.seconds || 0 } : null;
      if (!v) {
        // Un enlace pegado: primero sus datos (titulo, vistas, duracion), sin descargar.
        schoolNow = 'leyendo un enlace';
        const out = await capture(YTDLP, ['-J', '--no-playlist', '--no-warnings', q.url]).catch(() => '');
        let j: any = null;
        try { j = JSON.parse(out || 'null'); } catch { /* respuesta rota */ }
        if (!j?.id) { log('Escuela: no pude abrir el enlace ' + q.url.slice(0, 80) + ' (¿es público? ¿existe?)'); continue; }
        v = { id: `${String(j.extractor_key || j.extractor || 'web').toLowerCase().replace(/^tiktok.*/, 'tt')}:${j.id}`, url: q.url, title: String(j.title || j.description || ''), views: +j.view_count || 0, seconds: +j.duration || 0 };
      }
      if (school.cases.some((c) => c.id === v!.id)) { if (q.mine) log(`Escuela: «${v.title.slice(0, 40)}» ya estaba estudiado`); continue; }
      tried.add(v.id); school.tried = [...school.tried, v.id].slice(-5000);
      schoolNow = `estudiando «${v.title.slice(0, 50)}» (${q.topic})`;
      try {
        school.cases = keepBest([...school.cases, await studyOne(v, q.topic, !!q.mine)]);
        if (school.day !== today()) Object.assign(school, { day: today(), today: 0, ttToday: 0 });
        school.today++; done++;
        knowledge = learnFrom(school.cases);
        if (q.mine) log(`Escuela: estudiado el video que elegiste: «${v.title.slice(0, 50)}»`);
      } catch (e) {
        const m = (e as Error).message;
        log('Escuela: ' + v.title.slice(0, 40) + ': ' + (/not available|unavailable|private|removed/i.test(m) ? 'ya no está disponible (borrado, privado o bloqueado aquí), se salta' : m.slice(0, 120)));
      }
      writeJson(SCHOOL_FILE, school);
      // TikTok sin prisa (las descargas tambien cuentan); el resto, enseguida.
      await new Promise((ok) => setTimeout(ok, /tiktok\.com/.test(v!.url) ? 20_000 : 3000));
    }
    while (done < n && misses < 4) {
      const r = school.round++;
      // Una vuelta de cada dos, TikTok (si el usuario lo conecto, eligio creadores o hashtags y no se paso del dia).
      // (Si la ventana de «Mirar TikTok» esta abierta, TikTok espera a otra vuelta.)
      const tt = r % 2 === 0 && tiktokToday() < TIKTOK_DAY && !ttPaused() && TT.connected() && !TT.status().connecting ? nextTiktok(settings.tiktok, (school.ttRound = (school.ttRound || 0) + 1)) : null;
      let topic: string, list: { id: string; url: string; title: string; views: number; seconds: number }[];
      if (tt) {
        topic = tt.topic;
        while (foreground()) await new Promise((ok) => setTimeout(ok, 5000));
        schoolNow = `mirando ${topic}`;
        list = await TT.listVideos(tt.url).catch((e) => {
          const m = (e as Error).message;
          // Un captcha es TikTok frenando a la ventana automatica: no se insiste hasta mañana (insistir arriesga la cuenta).
          if (/captcha/i.test(m)) { school.ttPause = new Date(Date.now() + 20 * 3600_000).toISOString(); log('Escuela: TikTok pidió un captcha a la ventana automática; TikTok en pausa hasta mañana, se sigue con YouTube'); }
          else log('Escuela, TikTok: ' + m);
          misses++; return [];
        });
      } else {
        const s = nextSearch(school.cases, r, streamers);
        topic = s.topic;
        schoolNow = `buscando shorts de ${topic}`;
        // Primero la busqueda de YouTube filtrada a shorts; si devuelve poco (a veces falla), la busqueda normal.
        const found = async (url: string) => {
          const out = await capture(YTDLP, ['--flat-playlist', '--no-warnings', '--playlist-end', '50', '-J', url]).catch(() => '');
          // Solo lo que YouTube marca como short (enlace /shorts/): la busqueda normal mezcla videos largos y horizontales.
          try { return (JSON.parse(out || '{}').entries || []).filter((x: any) => String(x.url || '').includes('/shorts/')).map((x: any) => ({ id: String(x.id || ''), url: `https://www.youtube.com/shorts/${x.id}`, title: String(x.title || ''), views: +x.view_count || 0, seconds: +x.duration || 0 })); } catch { return []; }
        };
        list = await found(`https://www.youtube.com/results?search_query=${encodeURIComponent(s.q)}&sp=EgIQCQ%253D%253D`);
        if (list.length < 5) list = [...list, ...(await found(`ytsearch50:${s.q} #shorts`))];
      }
      const pick = pickVideos(list, tried, 2, tt ? 100_000 : 50_000);
      if (!pick.length) { if (!tt) misses++; continue; }
      for (const v of pick) {
        if (done >= n || (tt && tiktokToday() >= TIKTOK_DAY)) break;
        tried.add(v.id); school.tried = [...school.tried, v.id].slice(-5000);
        // Lo que el usuario esta haciendo va primero.
        while (foreground()) await new Promise((ok) => setTimeout(ok, 5000));
        schoolNow = `estudiando «${v.title.slice(0, 50)}» (${topic})`;
        try {
          school.cases = keepBest([...school.cases, await studyOne(v, topic)]);
          if (school.day !== today()) Object.assign(school, { day: today(), today: 0, ttToday: 0 });
          school.today++; done++;
          if (tt) school.ttToday = (school.ttToday || 0) + 1;
          knowledge = learnFrom(school.cases);
        } catch (e) {
          const m = (e as Error).message;
          // Borrado, privado o bloqueado en este pais: YouTube a veces aun lo muestra en la busqueda.
          log('Escuela: ' + v.title.slice(0, 40) + ': ' + (/not available|unavailable|private|removed/i.test(m) ? 'ya no está disponible (borrado, privado o bloqueado aquí), se salta' : m.slice(0, 120)));
        }
        writeJson(SCHOOL_FILE, school);
        // Sin prisa; con TikTok, mas despacio todavia (como alguien que mira un video y pasa al siguiente).
        await new Promise((ok) => setTimeout(ok, tt ? (manual ? 20_000 : 60_000) : manual ? 1000 : 15_000));
      }
    }
    if (done) log(`Escuela del agente: ${done} shorts estudiados (${school.cases.length} en total)`);
  } catch (e) { log('Escuela: ' + (e as Error).message.slice(0, 140)); } finally { schoolBusy = false; schoolNow = ''; }
  return schoolState();
}
/** TikTok: el usuario inicia sesion en una ventana de Clipper (no en las pruebas), o la cierra. */
export function tiktokConnect() {
  if (process.env.CLIPPER_NO_AI !== '1') void TT.connect(addWatched).then((s) => s.connected && log('Ventana de TikTok cerrada; sesión activa para la escuela del agente'));
  return schoolState();
}
/** Lo que el usuario vio en TikTok con Clipper: los de 100 mil vistas o mas, en español y no vistos, quedan para estudiar. */
function addWatched(list: TT.TikTokVideo[]) {
  const queued = new Set((school.queue || []).map((q) => q.id));
  const pick = pickVideos(list.filter((v) => !queued.has(v.id)), new Set(school.tried), 25, 100_000);
  school.queue = [...(school.queue || []), ...pick.map((v) => ({ ...v, topic: 'tiktok (lo que viste)' }))];
  writeJson(SCHOOL_FILE, school);
  log(`Viste ${list.length} TikToks con Clipper; ${pick.length} con 100 mil vistas o más quedan para estudiar`);
  if (pick.length) void study(0, true);
}
/** Enlaces pegados por el usuario: se estudian enseguida, en segundo plano, y pesan mas (son lo que quiere imitar). */
export function studyLinks(text: string) {
  const links = parseLinks(text);
  if (!links.length) return { added: 0, error: 'No encontré enlaces de TikTok, YouTube o Instagram en lo que pegaste.', ...schoolState() };
  const queued = new Set((school.queue || []).map((q) => q.url));
  const fresh = links.filter((u) => !queued.has(u));
  school.queue = [...(school.queue || []), ...fresh.map((url) => ({ url, topic: 'elegidos por ti', mine: true }))];
  writeJson(SCHOOL_FILE, school);
  void study(0, true);
  return { added: fresh.length, ...schoolState() };
}
export function tiktokDisconnect() { TT.disconnect(); log('TikTok desconectado de la escuela'); return schoolState(); }
/** Prueba la conexion: lista los videos de la primera pagina elegida (sin descargar nada). */
export async function tiktokTest() {
  const t = nextTiktok(settings.tiktok, 0);
  // Lo que falta o falla se cuenta como respuesta normal (no es un error de la app).
  if (!t) return { error: 'Escribe al menos un creador o un hashtag.' };
  if (!TT.connected()) return { error: 'Primero pulsa «Conectar TikTok» e inicia sesión.' };
  let list: TT.TikTokVideo[];
  try { list = await TT.listVideos(t.url); } catch (e) { return { error: (e as Error).message }; }
  const top = [...list].sort((a, b) => b.views - a.views);
  log(`Prueba de TikTok: ${list.length} videos en ${t.topic}; más vistos: ${top.slice(0, 3).map((v) => v.views.toLocaleString('es')).join(', ') || '—'} vistas; ${pickVideos(list, new Set(), 99, 100_000).length} con 100 mil o más`);
  return { page: t.topic, n: list.length, top: list.sort((a, b) => b.views - a.views).slice(0, 3).map((v) => ({ title: v.title.slice(0, 60), views: v.views })) };
}
/** Cada media hora, si toca, una tanda de 5 (hasta el limite diario). */
function schoolTick() { if (!schoolOff() && !schoolBusy && studiedToday() < SCHOOL_DAY) void study(5); }
if (!process.env.VITEST) { setTimeout(schoolTick, 3 * 60_000).unref(); setInterval(schoolTick, 30 * 60_000).unref(); }
