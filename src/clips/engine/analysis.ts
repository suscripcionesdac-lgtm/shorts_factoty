/** Deteccion de momentos: audio, chat, imagen, caras y aprendizaje. */
import { blend, newModel, train } from '../analysis/learn';
import { spawn } from 'node:child_process';
import { FFMPEG, probe } from '../media/ff';
import { type CapWord, overlap, type Rect, type Spec } from '../media/spec';
import fs from 'node:fs';
import { readJson, writeJson } from '../../shared/fs';
import { type FaceInfo, faceScan, findCams, followFrames, infoFromSamples, type Sample } from '../ai/faces';
import { FOLLOW, followKeys } from '../media/reframe';
import { adFlags, adSpans, clipRequests, sceneScores, sceneZ, withoutAds } from '../ai/vision';
import { clipCrowd, combine, faceWhy, fmtTime, heuristicScore, introSpans, newPeaks, peaksOf, smooth, windowFor, zscores } from '../analysis/detect';
import { type ChatData, chatZ } from '../analysis/chat';
import { autoClipsCap, snapToPhrases, storyContext, storyWindow } from '../analysis/story';
import { phrasesOf } from '../analysis/agent';
import { describeFrames, hasVision, judge, llmName } from '../ai/llm';
import { channelInfo, clipWindow, communityRange, streamStartOf } from './community';
import { active, analyzing, type Candidate, enqueueA, jsonFile, key, loadArr, log, nextMom, pinned, procs, save, saveSettings, settings, type Source, sources, taps } from './core';
import { alertNew, autoExport, makeClips } from './notify';
import { hearingOf, inflight, sameStory, src, textIn } from './preview';
import { clipLength, countWords, scoreWords, trendsSoon } from './profile';
import { energyOf, measure } from './sources';

let asrWarned = false;

// ---------- deteccion ----------
const maxIn = (a: number[] | null, from: number, to: number) => {
  let m = 0;
  if (a) for (let i = Math.max(0, from); i <= Math.min(a.length - 1, to); i++) m = Math.max(m, a[i]);
  return m;
};

export function rescore(s: Source, c: Candidate) {
  if (pinned(c) || !c.features) return;
  // Si la comunidad clipeo el momento, cuenta mas cuanta mas gente lo clipeo (`clipped`: personas), y se dice. Antes
  // un clip suelto con 1 vista sumaba 1,5: en un directo de Westcol, 43 de 57 momentos pasaban de 8.
  c.score = Math.min(10, blend(c.base ?? c.score, settings.models[key(s.streamer)], c.features) + Math.min(2, (c.clipped || 0) / 8));
  c.why = c.why.replace(/^la comunidad lo clipeó \(\d+ vistas\), /, ''); // el texto de antes, con las vistas de un clip suelto
  if ((c.clipped || 0) >= 2 && !/lo clipearon/.test(c.why)) c.why = `${c.clipped} personas lo clipearon, ${c.why}`;
}

const jpegAt = (file: string, t: number) =>
  new Promise<Buffer>((resolve) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-f', 'image2', '-c:v', 'mjpeg', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const b: Buffer[] = [];
    p.stdout.on('data', (d) => b.push(d));
    p.on('close', () => resolve(Buffer.concat(b)));
    p.on('error', () => resolve(Buffer.alloc(0)));
  });

// ---------- caras: camaras de los participantes, quien habla y reacciones ----------
/**
 * Buscar las camaras es lo mas caro (varios segundos). Se guardan por momento en cams.json (una lista: un directo
 * cambia de escena y cada escena tiene sus camaras) y solo se reutilizan a menos de un minuto de donde se buscaron.
 */
// v: version del detector. Al mejorarlo se sube, y lo guardado con una version anterior se vuelve a buscar.
type CamCache = { at: number; cams: Rect[]; v?: number };
const CAMS_V = 2;
const NEAR = 60;
export const camCache = new Map<string, CamCache[]>();
function camsList(s: Source) {
  let l = camCache.get(s.id);
  if (!l) {
    const f = jsonFile(s.id, 'cams'), raw = fs.existsSync(f) ? readJson<CamCache | CamCache[]>(f) : [];
    l = Array.isArray(raw) ? raw : [raw]; // las versiones anteriores guardaban una sola
    camCache.set(s.id, l);
  }
  return l;
}
/** Las camaras guardadas mas cercanas a este momento, si estan a menos de un minuto. */
const camsCached = (s: Source, at: number) => camsList(s).filter((c) => c.v === CAMS_V && Math.abs(c.at - at) < NEAR).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
async function camsFresh(s: Source, start: number, end: number) {
  if (!s.width) Object.assign(s, await probe(s.file).then((p) => ({ width: p.width, height: p.height })));
  const c = { at: start, cams: await findCams(s.file, start, end, s.width, s.height), v: CAMS_V };
  const l = camsList(s).filter((x) => Math.abs(x.at - start) >= NEAR);
  l.push(c);
  camCache.set(s.id, l.slice(-40));
  writeJson(jsonFile(s.id, 'cams'), l.slice(-40));
  return c;
}
/** Solo donde estan las camaras (sin mirar quien habla): las ya encontradas en este momento, o se buscan (siempre con `fresh`). */
export async function camsOnly(sid: string, start: number, end: number, fresh = false) {
  const s = src(sid);
  return { cams: ((!fresh && camsCached(s, start)) || (await camsFresh(s, start, end))).cams };
}

/** Escenas de un clip ya editado (al abrirlo en el editor): se buscan una vez por tramo y se recuerdan. */
const scenesSeen = new Map<string, Promise<NonNullable<Spec['scenes']>>>();
export function scenesOf(sid: string, start: number, end: number, cams: Rect[], layout: Spec['layout']) {
  const s = src(sid), k = `${sid}:${start}:${end}:${camKey(cams)}:${layout}`;
  if (!scenesSeen.has(k)) scenesSeen.set(k, (async () => {
    if (!s.width) Object.assign(s, await probe(s.file).then((p) => ({ width: p.width, height: p.height })));
    return findScenes(s, start, end, cams, layout);
  })().catch((e) => { scenesSeen.delete(k); throw e; }));
  return scenesSeen.get(k)!;
}
/** Cortes de imagen (cambios de escena del directo) entre start y end, en segundos del clip. */
function hardCuts(file: string, start: number, end: number) {
  return new Promise<number[]>((resolve) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-ss', String(start), '-t', String(end - start), '-i', file, '-an', '-vf', "fps=5,scale=160:90,select='gt(scene,0.45)',metadata=mode=print:file=-", '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve([]));
    p.on('close', () => resolve([...out.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1])));
  });
}
/** Si una camara es mucho mayor que las demas (vista de orador de Discord: uno en grande y miniaturas abajo), solo cuenta esa. */
const mainCams = (c: Rect[]) => { const big = Math.max(0, ...c.map((x) => x.w * x.h)); return c.filter((x) => x.w * x.h >= big / 6); };
const sameCams = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((c) => b.some((d) => overlap(c, d) > 0.5));
/**
 * Escenas del clip: donde el directo cambia de escena (de 4 camaras a una, de juego a camara...) ese trozo lleva su
 * propio encuadre, con las camaras que de verdad se ven ahi. Las partes con las camaras del clip (`main`) no cambian.
 */
export async function findScenes(s: Source, start: number, end: number, main: Rect[], mainLayout: Spec['layout']): Promise<NonNullable<Spec['scenes']>> {
  const dur = end - start, cuts: number[] = [];
  for (const t of await hardCuts(s.file, start, end)) if (t > 2 && t < dur - 2 && t - (cuts[cuts.length - 1] ?? 0) >= 2.5) cuts.push(t);
  if (!cuts.length) return [];
  const edges = [0, ...cuts.slice(0, 6), dur], parts: { a: number; b: number; cams: Rect[] }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1], cams = mainCams(await findCams(s.file, start + a + 0.3, start + b - 0.3, s.width, s.height));
    const last = parts[parts.length - 1];
    if (last && sameCams(last.cams, cams)) last.b = b; else parts.push({ a, b, cams });
  }
  if (parts.length < 2) return [];
  return parts.filter((x) => !(sameCams(x.cams, main) && mainLayout !== 'fit') && !(!x.cams.length && mainLayout === 'fit')).map((x) => {
    const c = x.cams;
    // De 4 camaras en adelante, en cuadricula; 2 o 3, apiladas. Una: si ocupa casi toda la imagen, a pantalla completa; si no, arriba con el juego abajo.
    const layout: Spec['layout'] = c.length >= 4 ? 'grid' : c.length >= 2 ? 'duo' : c.length === 1 ? (c[0].w * c[0].h > 0.3 ? 'cam' : 'split') : 'fit';
    return { id: 'sc' + Math.round(x.a * 10), a: x.a, b: x.b, layout, ...(c.length ? { cam: c[0], cams: c.slice(0, 12) } : {}) };
  }).filter((x) => !(x.layout === mainLayout && ['duo', 'grid', 'float'].includes(x.layout) && x.cams?.length === main.length)); // igual que lo de siempre: no hace falta
}
/**
 * Muestras de caras ya analizadas (a 10 por segundo), por fuente: quien habla en cualquier tramo que caiga dentro se
 * recalcula al instante. Los mejores momentos se analizan en segundo plano al terminar el analisis del directo,
 * asi que al abrirlos en el editor ya esta todo.
 */
type Scan = { a: number; b: number; key: string; fps: number; samples: Sample[] };
const scans = new Map<string, Scan[]>(), scanning = new Map<string, Promise<unknown>>();
const camKey = (cams: Rect[]) => cams.map((c) => [c.x, c.y, c.w, c.h].map((v) => v.toFixed(3)).join(',')).join('|');
function fromScan(sc: Scan, cams: Rect[], start: number, end: number, words?: { a: number; b: number }[]) {
  const samples = sc.samples.map((x) => ({ ...x, t: Math.round((x.t + sc.a - start) * 1000) / 1000 })).filter((x) => x.t >= -1e-6 && x.t < end - start);
  return infoFromSamples(samples, cams, sc.fps, end - start, words);
}
/** Caras del tramo cada ~1 s (t desde el inicio del tramo) y el ancho del recorte vertical en esa imagen. */
export async function faceTrack(sid: string, start: number, end: number) {
  const s = src(sid);
  if (!s.width) Object.assign(s, await probe(s.file).then((p) => ({ width: p.width, height: p.height })));
  // El tramo se lee de una vez y se busca en la imagen entera (faces.ts › followFrames): 5 veces mas rapido que saltar
  // a cada instante, con la misma precision (data/opus/seguir4.ts). Como mucho FOLLOW.max puntos.
  const dur = end - start, aspect = (s.width || 1920) / (s.height || 1080), fps = Math.min(1 / FOLLOW.every, FOLLOW.max / Math.max(1, dur));
  const frames = await followFrames(s.file, start, dur, fps, s.width || 1920, s.height || 1080);
  return { frames, aspect, w: Math.min(1, 1080 / 1920 / aspect) };
}
/** Recorrido del recorte vertical siguiendo a la persona principal (reframe.ts): «Seguir la cara» del editor. */
export async function followFace(sid: string, start: number, end: number) {
  const { frames, w } = await faceTrack(sid, start, end);
  return followKeys(frames, w);
}
export async function faceInfo(s: Source, start: number, end: number, fps: number, words?: CapWord[], o2: { parts?: number } = {}): Promise<FaceInfo> {
  if (!s.width) Object.assign(s, await probe(s.file).then((p) => ({ width: p.width, height: p.height })));
  // Palabras del subtitulo (ms desde el inicio del clip): los cambios de camara caen al empezar una frase.
  const o = { srcW: s.width, srcH: s.height, fps, parts: o2.parts, words: (Array.isArray(words) ? words : []).slice(0, 3000).filter((w) => !w.del && Number.isFinite(+w.startMs) && Number.isFinite(+w.endMs)).map((w) => ({ a: +w.startMs / 1000, b: +w.endMs / 1000 })) };
  const fresh = () => camsFresh(s, start, end);
  const cached = camsCached(s, start), c = cached ?? (await fresh());
  if (!c.cams.length) return { cams: [], track: [], turns: 0, react: 0, label: '', at: 0, cam: -1, together: false, seen: [] };
  const key = camKey(c.cams), find = () => (scans.get(s.id) || []).find((x) => x.key === key && x.fps >= fps && x.a <= start + 0.05 && x.b >= end - 0.05);
  // Si ese tramo se esta analizando ahora (en segundo plano), se espera a que termine en vez de repetirlo.
  const busy = [...scanning.entries()].find(([k]) => { const [sid, a, b, kk] = k.split('#'); return sid === s.id && kk === key && +a <= start + 0.05 && +b >= end - 0.05; });
  if (busy) await busy[1].catch(() => {});
  const hit = find();
  if (hit) return fromScan(hit, c.cams, start, end, o.words);
  const job = faceScan(s.file, start, end, { ...o, cams: c.cams });
  const tag = [s.id, start, end, key].join('#');
  scanning.set(tag, job);
  const r = await job.finally(() => scanning.delete(tag));
  if (r.samples.length) scans.set(s.id, [...(scans.get(s.id) || []).filter((x) => !(x.key === key && x.a >= start && x.b <= end)), { a: start, b: end, key, fps: r.fps, samples: r.samples }].slice(-30));
  const { samples: _s, fps: _f, ...info } = r;
  // Si alguna camara guardada ya no muestra una cara, la escena cambio: se buscan de nuevo (una sola vez).
  if (!cached || Math.min(...info.seen) >= 0.2) return info;
  const again = await fresh();
  if (!again.cams.length) return { ...info, cams: [], track: [] };
  const r2 = await faceScan(s.file, start, end, { ...o, cams: again.cams });
  const { samples: _s2, fps: _f2, ...info2 } = r2;
  return info2;
}
/** Hay algo en primer plano (una vista previa o un fotograma generandose, o una exportacion): lo de fondo espera. */
export const foreground = () => inflight.size > 0 || [...active].some((l) => !l.startsWith('Analizando'));
/**
 * En segundo plano: quien habla en los mejores momentos, para que abrirlos en el editor sea instantaneo. Cede el paso
 * a lo que el usuario esta haciendo y usa un solo hilo, para no frenar la vista previa ni las exportaciones.
 */
async function prepareFaces(s: Source, list: Candidate[]) {
  for (const c of list) {
    if (!sources.has(s.id)) return;
    for (let i = 0; i < 600 && foreground(); i++) await new Promise((r) => setTimeout(r, 1000));
    try { await faceInfo(s, c.start, c.end, 10, undefined, { parts: 1 }); }
    catch (e) { log('Caras (preparando): ' + (e as Error).message.slice(0, 120)); return; }
  }
}
/** Para el editor: camaras del tramo, quien habla en cada momento y la reaccion mas fuerte. */
export const faces = (sid: string, start: number, end: number, words?: CapWord[]) => faceInfo(src(sid), start, end, 10, words);

/** Ultima imagen del directo, sin guardarla en disco (se pide cada pocos segundos mientras se graba). */
export const liveShot = new Map<string, { t: number; p: Promise<Buffer> }>();
export function liveJpeg(sid: string) {
  const s = src(sid), t = Math.max(0, s.analyzedTo - 2), had = liveShot.get(sid);
  if (had && had.t === t) return had.p;
  const p = jpegAt(s.file, t);
  liveShot.set(sid, { t, p });
  return p;
}

export function analyze(sid: string) {
  const s = sources.get(sid);
  if (!s) throw new Error('Fuente desconocida');
  if (analyzing.has(sid)) return Promise.resolve();
  analyzing.add(sid);
  return enqueueA(`Analizando ${s.name}`, async () => {
    const wasLive = s.status === 'grabando';
    if (!wasLive) s.status = 'analizando';
    s.error = undefined;
    try {
      s.progress = 'midiendo el volumen';
      await measure(s, wasLive);
      const energy = [...energyOf(sid)];
      if (!s.width) Object.assign(s, await probe(s.file).then((p) => ({ width: p.width, height: p.height })).catch(() => ({})));
      // Nunca menos que lo ya analizado: si la duracion guardada se quedo corta, un momento no puede acabar antes de empezar.
      const total = wasLive ? energy.length : Math.max(s.duration || 0, energy.length);
      if (!wasLive && total > (s.duration || 0)) s.duration = total;

      // Imagen: cambios bruscos entre fotogramas clave.
      let scene = loadArr(sid, 'scene');
      if (settings.visual) {
        s.progress = 'mirando la imagen';
        const from = s.sceneTo || 0;
        const more = await sceneScores(s.file, from).catch(() => [] as number[]);
        scene = [...scene.slice(0, from), ...more].slice(0, energy.length);
        s.sceneTo = Math.max(0, scene.length - 2);
        writeJson(jsonFile(sid, 'scene'), scene);
      }
      // Anuncios de Twitch: sus tramos no pueden acabar en un clip.
      let adf = loadArr(sid, 'ads');
      if (s.file.endsWith('live.ts') || /twitch.tv/.test(s.origin)) {
        s.progress = 'buscando anuncios';
        const from = s.adsTo || 0, more = await adFlags(s.file, from).catch(() => [] as number[]);
        adf = [...adf.slice(0, from), ...more].slice(0, energy.length);
        s.adsTo = Math.max(0, adf.length - 4);
        writeJson(jsonFile(sid, 'ads'), adf);
        s.ads = adSpans(adf);
      }
      // La intro y la despedida del directo (video con musica, muchos cambios de plano) se tratan como los anuncios.
      const intro = introSpans(scene, energy);
      if (intro.length && JSON.stringify(intro) !== JSON.stringify(s.intro)) log(`${s.name}: ${intro.map(([a, b]) => (a ? 'despedida' : 'intro') + ` de ${fmtTime(a)} a ${fmtTime(b)}`).join(' y ')}, sin momentos`);
      s.intro = intro;
      const ads = [...(s.ads || []), ...intro];

      const tap = taps.get(sid);
      if (tap) { writeJson(jsonFile(sid, 'chat'), tap.data); s.chat = tap.status; }
      const chatData: ChatData | null = fs.existsSync(jsonFile(sid, 'chat')) ? readJson(jsonFile(sid, 'chat')) : null;
      const hasChat = !!chatData && chatData.rate.reduce((a, b) => a + b, 0) > 20;
      const az = smooth(zscores(energy), 2);
      const cz = hasChat ? chatZ(chatData!.rate, energy.length) : null;
      const vz = settings.visual && scene.length ? sceneZ(scene, energy.length) : null;

      trendsSoon(s.streamer);
      const extra = scoreWords(s.streamer);
      const [before, after] = clipLength(s.streamer);
      const autos = s.candidates.filter((c) => !pinned(c));
      // Los picos no se gastan en anuncios ni en la intro; y en un directo largo, mas momentos (1 cada 5 min, minimo 15).
      const comb = combine(az, cz, 12, vz);
      for (const [a, b] of ads) for (let t = Math.max(0, a); t < Math.min(comb.length, b); t++) comb[t] = 0;
      const peaks = peaksOf(comb, { max: Number(process.env.MAX_MOMENTS) || Math.max(15, Math.floor(total / 300)) });
      // Lo que ya estaba en la lista se conserva (tambien lo descartado, para que no vuelva a salir): en un directo,
      // un momento no puede desaparecer porque un analisis posterior ya no lo cuente entre los mejores.
      const next: Candidate[] = [...autos];
      const created: Candidate[] = [];
      // En directo un momento puede detectarse antes de que termine: su final se completa cuando hay mas grabado,
      // y entonces (no antes) se avisa y se exporta solo.
      const completed: Candidate[] = [];
      for (const c of autos) {
        if (!c.endWant || c.exported) { if (c.wait) { c.wait = false; completed.push(c); } continue; }
        if (c.end < c.endWant) c.end = Math.min(total, c.endWant);
        if (c.end >= c.endWant - 0.5 || !wasLive) {
          c.endWant = undefined;
          const h = heuristicScore(maxIn(az, c.peak - 3, c.peak + 3), c.text, c.end - c.start, maxIn(cz, c.peak, c.peak + 12), maxIn(vz, c.peak - 2, c.peak + 2), c.text ? scoreWords(s.streamer) : null, c.face);
          if (c.by === 'audio') Object.assign(c, { zChat: h.features.chat, score: h.score, base: h.score, why: h.why, features: h.features });
          if (c.wait) { c.wait = false; completed.push(c); }
        }
      }
      for (const p of newPeaks(autos, peaks.filter((p) => !ads.some(([a, b]) => p.t >= a && p.t < b)))) {
        const c: Candidate = { id: 'm' + p.t, n: nextMom(s), peak: p.t, z: maxIn(az, p.t - 3, p.t + 3), zChat: maxIn(cz, p.t, p.t + 12), zVis: maxIn(vz, p.t - 2, p.t + 2), ...windowFor(p.t, total, before, after), score: 0, why: '', title: '', text: '', by: 'audio' };
        if (wasLive && c.end < p.t + after - 0.5) Object.assign(c, { endWant: p.t + after, wait: true });
        const h = heuristicScore(c.z, '', c.end - c.start, c.zChat || 0, c.zVis || 0);
        Object.assign(c, { score: h.score, base: h.score, why: h.why, features: h.features });
        next.push(c);
        created.push(c);
      }
      // El chat pide clip: varios mensajes con "clip" en pocos segundos.
      const fixed = s.candidates.filter(pinned);
      for (const t of clipRequests(chatData?.clip || [])) {
        if ([...fixed, ...next].some((c) => t >= c.start - 5 && t <= c.end + 15)) continue;
        const c: Candidate = { id: 'c' + t, n: nextMom(s), peak: Math.max(0, t - 8), z: 0, start: Math.max(0, t - 40), end: Math.min(total, t + 5), score: 9, why: 'el chat pidió clip', title: '', text: '', by: 'chat' };
        fixed.push(c);
        created.push(c);
      }
      // La comunidad clipeo momentos (Twitch o Kick), en directo o en el VOD: cuantas personas clipearon cada uno
      // (detect.ts › clipCrowd). Varias a la vez es un momento seguro; un clip suelto apenas suma.
      const rec0 = s.file.endsWith('live.ts') ? +new Date(s.createdAt) : await streamStartOf(s);
      // En Twitch el enlace de un VOD (twitch.tv/videos/123) no lleva el canal: se usa el que dijo yt-dlp.
      const ci = channelInfo(s.origin);
      const chan = ci && ci.channel !== 'videos' ? s.origin : s.streamChannel ? `https://${/twitch/.test(s.origin) ? 'www.twitch.tv' : 'kick.com'}/${s.streamChannel}` : '';
      if (rec0 && chan) {
        try {
          const spans = (await communityRange(chan, rec0, rec0 + total * 1000)).map((k) => clipWindow(k, rec0, total)).filter((w): w is { a: number; b: number } => !!w);
          for (const m of clipCrowd(spans, total)) {
            const hit = [...fixed, ...next].find((c) => Math.min(c.end, m.b) - Math.max(c.start, m.a) > Math.min(8, (m.b - m.a) / 2));
            if (hit) { if (!pinned(hit) || hit.by === 'comunidad') hit.clipped = Math.max(hit.clipped || 0, m.n); continue; }
            if (m.n < 5 || ads.some(([x, y]) => m.t >= x && m.t < y)) continue;
            const c: Candidate = { id: 'k' + Math.round(m.t), n: nextMom(s), peak: m.t, z: 0, start: Math.max(0, m.a - 5), end: Math.min(total, m.b + 2), score: Math.min(10, 7 + m.n / 8), why: `${m.n} personas lo clipearon`, title: '', text: '', by: 'comunidad', clipped: m.n };
            fixed.push(c);
            created.push(c);
          }
        } catch (e) { log('Clips de la comunidad: ' + (e as Error).message.slice(0, 120)); }
      }
      // 1) Los momentos aparecen ya, puntuados por volumen, chat e imagen.
      const publish = () => {
        // Un momento que pisa un anuncio se queda con su parte limpia; si casi todo era anuncio, se quita.
        for (const c of [...next, ...fixed]) {
          const w = withoutAds(c.start, c.end, ads, pinned(c) ? 3 : 8);
          if (!w) {
            // Casi todo anuncio: fuera, tambien si lo pidio el chat o lo clipeo la comunidad (solo se respeta lo guardado
            // a mano y lo ya exportado).
            if (c.exported || c.by === 'manual') continue;
            const list = next.includes(c) ? next : fixed;
            list.splice(list.indexOf(c), 1);
            continue;
          }
          if (w.a !== c.start || w.b !== c.end) { c.start = w.a; c.end = w.b; c.peak = Math.min(Math.max(c.peak, w.a), w.b); c.noAds = true; c.words = undefined; }
        }
        next.forEach((c) => rescore(s, c));
        // Tope para directos de muchas horas: se quedan los 60 mejores (y siempre lo exportado).
        const visible = next.filter((c) => !c.hidden).sort((a, b) => b.score - a.score);
        for (const c of visible.slice(60)) if (!c.exported) next.splice(next.indexOf(c), 1);
        const mine = s.candidates.filter((c) => c.by === 'manual' && !fixed.includes(c));
        s.candidates = [...mine, ...fixed, ...next].sort((a, b) => b.score - a.score);
        save(s);
      };
      publish();
      if (created.length) log(`${s.name}: ${created.length} momentos nuevos`);
      // Modo rapido: en directo no se espera a la transcripcion para avisar ni para exportar.
      const ready = () => [...created, ...completed].filter((c) => !c.wait);
      if (wasLive && settings.fast) { alertNew(s, ready()); autoExport(s, ready()); }

      // 2) Despues se escucha lo que se dice en los mejores, y la puntuacion se afina sobre la marcha.
      // Lo que aun no tiene su final grabado se escucha cuando se complete, para no transcribir medio momento.
      // Con «Hacer los clips solo» se escuchan (y valora la IA) tantos como clips puede hacer, no solo los 8 mejores.
      const hearN = Math.max(Number(process.env.MAX_TRANSCRIBE || 8), s.autoClips ? autoClipsCap(total) : 0);
      const toHear = [...created.filter((c) => !c.wait), ...completed.filter((c) => !c.text)].sort((a, b) => b.score - a.score).slice(0, hearN);
      for (let i = 0; i < toHear.length; i++) {
        const c = toHear[i];
        s.progress = `escuchando el momento ${i + 1} de ${toHear.length}`;
        try {
          // Desde 30 s antes del pico hasta 15 s despues, en frases completas (story.ts); se escucha con margen.
          const ctx = pinned(c) ? c : storyContext(c.peak, total), win = storyWindow(c.peak, total);
          c.words = await hearingOf(s)(ctx.start, ctx.end);
          if (!pinned(c)) Object.assign(c, snapToPhrases(phrasesOf(c.words), win.start, win.end, c.peak, total));
          c.text = textIn(c);
          if (pinned(c)) continue;
          const h = heuristicScore(c.z, c.text, c.end - c.start, c.zChat || 0, c.zVis || 0, extra, c.face);
          Object.assign(c, { score: h.score, base: h.score, why: h.why, features: h.features });
          publish();
        } catch (e) {
          if (i === 0 && !asrWarned) (asrWarned = true), log('Sin reconocimiento de voz: ' + (e as Error).message.slice(0, 160));
          break; // sin modelo de voz no tiene sentido intentar los demas
        }
      }
      // 3) IA de texto: valora los que tienen transcripcion.
      if (sameStory(toHear.filter((c) => c.text && !pinned(c)))) publish();
      const heard = toHear.filter((c) => c.text && !pinned(c) && !c.hidden);
      if (llmName() && heard.length) {
        s.progress = 'la IA está valorando los momentos';
        try {
          const verdicts = await judge(s.streamer, heard.map((c) => ({ id: c.id, seconds: c.end - c.start, text: c.text })));
          for (const v of verdicts) {
            const c = heard.find((x) => x.id === v.id);
            if (c) Object.assign(c, { score: v.score, base: v.score, why: v.why, title: v.title, by: 'ia' });
          }
          publish();
        } catch (e) {
          log('La IA no respondió bien: ' + (e as Error).message.slice(0, 160));
        }
      }
      // 4) Caras: en los mejores momentos, como reacciona cada participante y cuanto cambia quien habla.
      // Se mira el tramo que rodea al pico (antes, lo que lo provoca; despues, la reaccion), a 3 muestras por segundo.
      if (settings.faces) {
        const look = [...created, ...completed].filter((c) => !c.wait && !c.face && !pinned(c)).sort((a, b) => b.score - a.score).slice(0, Number(process.env.MAX_FACES || 6));
        for (let i = 0; i < look.length; i++) {
          const c = look[i];
          s.progress = `mirando las caras del momento ${i + 1} de ${look.length}`;
          try {
            const r = await faceInfo(s, Math.max(c.start, c.peak - 12), Math.min(c.end, c.peak + 6), 3);
            if (!r.cams.length) break; // sin camaras en este directo
            c.face = { react: r.react, label: r.label, turns: r.turns, together: r.together, cams: r.cams.length };
            if (c.by === 'audio') {
              const h = heuristicScore(c.z, c.text, c.end - c.start, c.zChat || 0, c.zVis || 0, extra, c.face);
              Object.assign(c, { score: h.score, base: h.score, why: h.why, features: h.features });
            } else {
              // Elegido por la IA: su nota se respeta y la cara solo suma, como la IA de vision.
              if (c.features) c.features = { ...c.features, face: c.face.react, turns: c.face.turns };
              const boost = Math.min(1.5, Math.max(0, c.face.react - 1.5) * 0.5);
              if (boost > 0) { c.base = Math.min(10, (c.base ?? c.score) + boost); c.score = c.base; }
              const why = faceWhy(c.face).join(', ');
              if (why) c.why = `${why}, ${c.why}`;
            }
            publish();
          } catch (e) { log('Caras: ' + (e as Error).message.slice(0, 160)); break; }
        }
        // Sin esperar: quien habla en los mejores momentos, listo para cuando se abran en el editor.
        void prepareFaces(s, s.candidates.filter((c) => !c.wait).sort((a, b) => b.score - a.score).slice(0, Number(process.env.MAX_FACES || 6)));
      }
      // 5) IA de vision (opcional): que se ve en el pico (muerte, victoria, jugada...).
      if (hasVision()) {
        s.progress = 'la IA está mirando los momentos';
        for (const c of created.filter((x) => !pinned(x)).slice(0, 6)) {
          try {
            const frames = (await Promise.all([c.peak - 2, c.peak, c.peak + 2].map((t) => jpegAt(s.file, t)))).filter((b) => b.length > 1000);
            const r = frames.length ? await describeFrames(frames) : null;
            if (r && r.label !== 'nada' && r.label !== 'menu') {
              c.label = r.label;
              c.base = Math.min(10, (c.base ?? c.score) + r.boost);
              c.score = c.base;
              c.why = `${r.label}, ${c.why}`;
            }
          } catch (e) { log('IA de visión: ' + (e as Error).message.slice(0, 120)); break; }
        }
        publish();
      }
      s.status = wasLive && procs.has(sid) ? 'grabando' : s.status === 'analizando' ? 'listo' : s.status;

      // Aviso al celular y exportacion automatica con la plantilla del streamer.
      if (wasLive) alertNew(s, ready());
      autoExport(s, ready());
      if (s.status === 'listo' && s.autoClips) makeClips(s);
    } catch (e) {
      // En directo un fallo de analisis no debe cortar la grabacion.
      if (wasLive && procs.has(sid)) s.error = 'Análisis: ' + (e as Error).message;
      else Object.assign(s, { status: 'error', error: (e as Error).message });
      log(`${s.name}: falló el análisis: ${(e as Error).message}`);
    }
    s.progress = undefined;
    analyzing.delete(sid);
    save(s);
  });
}

/** Momento marcado a mano: un tramo concreto, o los ultimos segundos de un directo. */
export function mark(sid: string, start?: number, end?: number, last = 45) {
  const s = sources.get(sid);
  if (!s) throw new Error('Fuente desconocida');
  const now = s.status === 'grabando' ? Math.max(s.analyzedTo, Math.floor((Date.now() - +new Date(s.createdAt)) / 1000) - 8) : s.duration;
  const e = end ?? now;
  const st = start ?? Math.max(0, e - last);
  if (!(e > st)) throw new Error('El final debe ser posterior al inicio');
  if (e - st < 5) throw new Error('Espera unos segundos: aún no hay suficiente directo grabado para guardar un momento.');
  const c: Candidate = { id: 'x' + Date.now(), n: nextMom(s), peak: e, z: 0, start: st, end: e, score: 10, why: 'guardado por ti', title: '', text: '', by: 'manual' };
  s.candidates.unshift(c);
  save(s);
  return c;
}

/** Cambia el tramo de un momento (desde el editor). */
export function updateCandidate(sid: string, cid: string, p: { start?: number; end?: number; title?: string }) {
  const c = sources.get(sid)?.candidates.find((x) => x.id === cid);
  if (!c) return;
  if (p.title != null) c.title = p.title;
  save(sources.get(sid)!);
}

// ---------- aprendizaje ----------
export function feedback(s: Source, c: Candidate | undefined, label: 0 | 1) {
  if (!c?.features) return;
  const k = key(s.streamer);
  settings.models[k] = train(settings.models[k] ?? newModel(), c.features, label);
  if (label === 1 && c.text) countWords(k, c.text);
  saveSettings();
  s.candidates.forEach((x) => rescore(s, x));
  s.candidates.sort((a, b) => b.score - a.score);
}

export function discard(sid: string, cid: string) {
  const s = sources.get(sid);
  const c = s?.candidates.find((x) => x.id === cid);
  if (!s || !c) throw new Error('Momento desconocido');
  if (pinned(c)) s.candidates = s.candidates.filter((x) => x !== c);
  else c.hidden = true;
  feedback(s, c, 0);
  save(s);
}
