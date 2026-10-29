/** Vista previa, fotogramas y datos para el editor. */
import fs from 'node:fs';
import path from 'node:path';
import { cut, ffmpeg } from '../media/ff';
import { makeHearing } from '../ai/hearing';
import { mergeStories } from '../analysis/story';
import { type Word } from '../../shared/timing';
import { type CapWord, pickSilences, segmentsFromSilences } from '../media/spec';
import { applyFixes } from '../media/subfix';
import { phrasesOf, pickPhrases } from '../analysis/agent';
import { ollamaReady } from '../ai/llm';
import { condense } from '../analysis/condense';
import { zscores } from '../analysis/detect';
import { autoColor, measureLook } from '../analysis/look';
import { detectSilences } from '../media/fast';
import { addDecisions } from '../web/prefs.js';
import { type ChatData } from '../analysis/chat';
import { readJson } from '../../shared/fs';
import { sceneZ } from '../ai/vision';
import { toSpanish } from './captions';
import { type Candidate, dir, jsonFile, key, listen, loadArr, saveSettings, settings, type Source, sources, taps } from './core';
import { prof } from './profile';
import { energyOf } from './sources';

// ---------- vista previa, fotogramas y datos para el editor ----------
// El navegador suele pedir el mismo archivo dos veces a la vez: se genera una sola vez y a un nombre temporal.
export const inflight = new Map<string, Promise<string>>();
const tmpOf = (out: string) => out.replace(/(\.\w+)$/, '.tmp$1');
function once(out: string, make: (tmp: string) => Promise<unknown>) {
  if (fs.existsSync(out)) return Promise.resolve(out);
  let p = inflight.get(out);
  if (!p) {
    const tmp = tmpOf(out);
    p = make(tmp).then(() => { fs.renameSync(tmp, out); return out; }).finally(() => inflight.delete(out));
    inflight.set(out, p);
  }
  return p;
}
export const src = (sid: string) => { const s = sources.get(sid); if (!s) throw new Error('Fuente desconocida'); return s; };

// PREVIEW_WEBM=1 genera la vista previa en WebM, para navegadores sin H.264 (por ejemplo Chromium sin codecs).
const webmPreview = process.env.PREVIEW_WEBM === '1';
const previewFile = (sid: string, start: number, end: number) => path.join(dir(sid), `prev3-${Math.round(start)}-${Math.round(end)}.${webmPreview ? 'webm' : 'mp4'}`);
/** Vista previa pedida: si aun se esta generando, `tmp` es el archivo que va creciendo y `p` termina con el final. */
export function previewJob(sid: string, start: number, end: number) {
  const out = previewFile(sid, start, end), ready = fs.existsSync(out);
  return { ready, out, tmp: tmpOf(out), stream: !webmPreview, p: preview(sid, start, end) };
}
export function preview(sid: string, start: number, end: number) {
  const s = src(sid);
  const webm = webmPreview, out = previewFile(sid, start, end);
  return once(out, (tmp) => webm
    ? ffmpeg(['-ss', String(Math.max(0, start)), '-t', String(end - start), '-i', s.file, '-vf', "scale=-2:'min(720,ih)'", '-r', '30', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2000k', '-c:a', 'libvorbis', tmp])
    : cut(s.file, start, end - start, tmp, 1080, true));
}

export function frame(sid: string, t: number, wide = false, small = false) {
  const s = src(sid);
  // "wide" da el fotograma a resolucion completa: lo usa el detector de caras, que necesita detalle.
  // "small" es para las miniaturas de la lista (104 px en pantalla): 320 px cubren hasta pantallas 3x.
  const out = path.join(dir(sid), `frame-${Math.round(t)}${wide ? '-hd' : small ? '-sm' : ''}.jpg`);
  return once(out, (tmp) => ffmpeg(['-ss', String(Math.max(0, t)), '-i', s.file, '-frames:v', '1', '-vf', wide ? "scale='min(1920,iw)':-2" : small ? 'scale=320:-2' : 'scale=960:-2', '-q:v', wide ? '2' : '4', tmp]));
}

/** Lo que se dice dentro del tramo del momento (sus palabras se escucharon con margen alrededor). */
export const textIn = (c: Candidate) => (c.words || []).filter((w) => w.endMs > c.start * 1000 && w.startMs < c.end * 1000).map((w) => w.text).join(' ');
/** Lo ya escuchado de cada directo: los momentos cercanos comparten audio y no se transcribe dos veces. */
const hearings = new Map<string, ReturnType<typeof makeHearing>>();
export const hearingOf = (s: Source) => { let h = hearings.get(s.id); if (!h) hearings.set(s.id, (h = makeHearing((a, d) => listen(s.file, a, d)))); return h; };
/** Momentos que son la misma historia: se queda uno; los otros se ocultan (asi no vuelven a salir). */
export function sameStory(list: Candidate[]) {
  const drop = mergeStories(list.filter((c) => !c.exported && !c.hidden));
  for (const c of drop) Object.assign(c, { hidden: true, why: 'la misma historia que otro momento' });
  for (const c of list) if (c.words && !c.hidden) c.text = textIn(c);
  return drop.length;
}
export const relWords = (words: Word[], start: number, end: number): CapWord[] =>
  words.filter((w) => w.endMs > start * 1000 && w.startMs < end * 1000).map((w) => ({ text: w.text, startMs: Math.max(0, Math.round(w.startMs - start * 1000)), endMs: Math.round(w.endMs - start * 1000) }));

/** Palabras con sus tiempos (relativos al inicio del tramo), para editarlas en el editor. */
export async function wordsFor(sid: string, start: number, end: number): Promise<CapWord[]> {
  const s = src(sid);
  const cand = s.candidates.find((c) => c.words?.length && c.start <= start + 0.5 && c.end >= end - 0.5);
  // Con las correcciones que el usuario ya hizo antes con este streamer.
  return toSpanish(s, applyFixes(relWords(cand ? cand.words! : await listen(s.file, start, end - start), start, end), settings.profiles[key(s.streamer)]?.fixes));
}

/**
 * Condensar un tramo largo a unos `target` segundos (como el «视频浓缩» de CapCut): el agente (si hay Ollama) o las reglas
 * eligen las frases que cuentan la historia, en orden y con su preparacion. Devuelve los tramos a conservar.
 */
export async function condenseRange(sid: string, start: number, end: number, target: number) {
  const s = src(sid), dur = end - start;
  if (!(target >= 10 && target < dur - 3)) throw new Error('El tramo ya dura eso o menos.');
  const words = await wordsFor(sid, start, end);
  const phrases = phrasesOf(words);
  if (phrases.length < 3) throw new Error('Hace falta que se hable en el tramo para saber qué conservar.');
  const energy = energyOf(sid).slice(Math.max(0, Math.floor(start)), Math.ceil(end));
  const prefer = (await ollamaReady()) ? await pickPhrases(phrases, target, s.streamer) : null;
  const r = condense({ phrases, energyZ: energy.length ? zscores(energy) : [], target, prefer: prefer || undefined });
  const kept = r.segments.reduce((t, x) => t + x.b - x.a, 0);
  return { segments: r.segments, kept: Math.round(kept), phrases: r.picked.length, of: phrases.length, by: prefer && r.picked.length && r.picked.every((p) => prefer.includes(p.i)) ? 'agente' : 'reglas' };
}

/** Luz y color automaticos de un tramo (ver look.ts). */
export async function autoLook(sid: string, start: number, end: number) {
  const r = autoColor(await measureLook(src(sid).file, start, end - start));
  return { ...r };
}

export async function silences(sid: string, start: number, end: number) {
  // A mano se quitan todas las pausas, pero sin dejar trozos sueltos de menos de un segundo entre dos cortes.
  const sil = pickSilences(await detectSilences(src(sid).file, start, end - start), end - start, { minSil: 0.6, minSeg: 1 });
  return { silences: sil, segments: segmentsFromSilences(sil, end - start) };
}

/**
 * Auto edicion: lo que haria un editor con este tramo, todo local. Encuadre segun las camaras (varias apiladas
 * siguiendo a quien habla, una arriba con el juego debajo, o la imagen completa), sin silencios, gancho si el pico
 * llega tarde, golpe o zoom en la reaccion, stickers por lo que se dice, subtitulos dinamicos, titulo y hashtags
 * con el estilo de los Shorts que funcionan. Devuelve los cambios para la plantilla del clip y que se hizo.
 */
/** Guarda lo que se conservo y lo que se quito al revisar una auto edicion (la proxima vez se tiene en cuenta). */
export function autoFeedback(streamer: string, items: { kind?: unknown; on?: unknown }[]) {
  const pr = prof(key(streamer));
  pr.auto = addDecisions(pr.auto, (Array.isArray(items) ? items : []).slice(0, 300).filter((x) => typeof x?.kind === 'string').map((x) => ({ kind: String(x.kind).slice(0, 60), on: !!x.on })));
  saveSettings();
  return { ok: true };
}

/** Curva de volumen, chat e imagen reducida a ~600 puntos, para dibujar la linea de tiempo. */
export function timeline(sid: string) {
  const energy = loadArr(sid, 'energy');
  const n = energy.length;
  if (!n) return { seconds: 0, bucket: 1, audio: [], chat: [], visual: [] };
  const az = zscores(energy);
  const chatData: ChatData | null = fs.existsSync(jsonFile(sid, 'chat')) ? readJson(jsonFile(sid, 'chat')) : taps.get(sid)?.data ?? null;
  const vz = sceneZ(loadArr(sid, 'scene'), n);
  const bucket = Math.max(1, Math.ceil(n / 600));
  const audio: number[] = [], chat: number[] = [], visual: number[] = [];
  for (let i = 0; i < n; i += bucket) {
    let a = -9, c = 0, v = 0;
    for (let j = i; j < Math.min(n, i + bucket); j++) { a = Math.max(a, az[j]); c += chatData?.rate[j] ?? 0; v = Math.max(v, vz[j] || 0); }
    audio.push(Math.round(Math.max(-2, Math.min(8, a)) * 10) / 10);
    chat.push(Math.round((c / bucket) * 10) / 10);
    visual.push(v > 3 ? 1 : 0);
  }
  return { seconds: n, bucket, audio, chat: chatData ? chat : [], visual };
}

/** Volumen por segundo de un tramo, para pintar la onda en la linea de tiempo del editor. */
export function wave(sid: string, start: number, end: number) {
  const e = loadArr(sid, 'energy').slice(Math.floor(start), Math.ceil(end));
  const lo = Math.min(...e, -60), hi = Math.max(...e, -10);
  return e.map((v) => Math.round(((v - lo) / Math.max(1, hi - lo)) * 100) / 100);
}
