/** Perfil de cada streamer: sus palabras, clips de ejemplo, tendencias y repetidos. */
import { extraWords, heuristicScore, smooth, zscores } from '../analysis/detect';
import { type Trend, type TrendItem, trendOf } from '../analysis/trends';
import { parseNames } from '../media/subfix';
import path from 'node:path';
import fs from 'node:fs';
import { energyPerSecond, FFMPEG, probe, run } from '../media/ff';
import { sceneScores } from '../ai/vision';
import { measureStyle } from '../analysis/refstyle';
import { capture, channelInfo, communityClips } from './community';
import { type Candidate, clamp, clips, DATA, enqueueA, type Example, key, listen, log, median, type Profile, saveSettings, settings, type Source, sources } from './core';
import { ensureYtdlp, YTDLP } from './tools';

// ---------- perfil por streamer: sus palabras y sus clips de ejemplo ----------
const STOP = new Set('para pero como porque cuando donde este esta esto estos estas tiene tienes tengo vamos algo todo toda todos nada bien aqui aquí ahora entonces tambien también sobre desde hasta solo sólo ellos ella nosotros usted ustedes cual quien estoy estamos está están estaba hacer hace hizo dijo dice mira bueno pues unos unas with that this have what'.split(' '));
export function prof(k: string): Profile {
  return (settings.profiles[k] ||= { words: [], counts: {}, examples: [], useLength: true });
}
/** Cuenta en cuantos clips buenos aparece cada palabra, para sugerir las muletillas del streamer. */
export function countWords(k: string, text: string) {
  const p = prof(k);
  for (const w of new Set(text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/))) if (w.length >= 4 && !STOP.has(w)) p.counts[w] = (p.counts[w] || 0) + 1;
  const e = Object.entries(p.counts);
  if (e.length > 300) p.counts = Object.fromEntries(e.sort((a, b) => b[1] - a[1]).slice(0, 200));
}
export const suggestions = (p: Profile) => Object.entries(p.counts).filter(([w, n]) => n >= 3 && !p.words.includes(w)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
const examplesFor = (streamer: string) => [...(settings.profiles[key(streamer)]?.useLength === false ? [] : settings.profiles[key(streamer)]?.examples || []), ...(key(streamer) !== 'general' && settings.profiles.general?.useLength !== false ? settings.profiles.general?.examples || [] : [])];
/** Cuanto se guarda antes y despues del pico: por defecto 28 + 12 s; con ejemplos, lo que duran ellos. */
export function lengthFor(ex: Pick<Example, 'seconds' | 'peakPos'>[]): [number, number] {
  if (ex.length < 2) return [28, 12];
  const d = clamp(median(ex.map((e) => e.seconds)), 12, 90), pos = clamp(median(ex.map((e) => e.peakPos)), 0.3, 0.9);
  return [Math.round(d * pos), Math.max(4, Math.round(d * (1 - pos)))];
}

/** Duracion de los momentos: la de tus clips de ejemplo; sin ejemplos, la de los Shorts que mas funcionan ahora. */
export function clipLength(streamer: string): [number, number] {
  const ex = examplesFor(streamer), t = trendFor(streamer);
  if (ex.length >= 2 || !t || settings.profiles[key(streamer)]?.useLength === false) return lengthFor(ex);
  return lengthFor([{ seconds: t.seconds, peakPos: 0.7 }, { seconds: t.seconds, peakPos: 0.7 }]);
}
/** Palabras que suben la nota: las del streamer y las de sus Shorts mas vistos. */
export const scoreWords = (streamer: string) => extraWords([...(settings.profiles[key(streamer)]?.words || []), ...(trendFor(streamer)?.words || [])]);

// ---------- tendencias ----------
export const trendFor = (streamer: string): Trend | null => settings.trends?.[key(streamer)] || null;
const trendBusy = new Set<string>();
/**
 * Busca los Shorts recientes del streamer en YouTube (y sus clips mas vistos de la semana en Twitch o Kick, si se
 * conoce su canal) y guarda lo que tienen en comun los que mas funcionan.
 */
export async function refreshTrends(streamer: string): Promise<Trend | null> {
  const k = key(streamer);
  if (!streamer || k === 'general' || trendBusy.has(k)) return trendFor(streamer);
  trendBusy.add(k);
  try {
    await ensureYtdlp();
    const out = await capture(YTDLP, ['--flat-playlist', '--no-warnings', '-J', `ytsearch60:${streamer} #shorts`]);
    const items: TrendItem[] = (JSON.parse(out || '{}').entries || []).map((x: any) => ({ title: String(x.title || ''), views: +x.view_count || 0, seconds: +x.duration || 0 }));
    const origin = [...sources.values()].find((s) => key(s.streamer) === k && channelInfo(s.origin))?.origin;
    if (origin) items.push(...(await communityClips(origin, false).catch(() => [])).map((c) => ({ title: c.title, views: c.views, seconds: c.seconds })));
    const t = trendOf(items, streamer);
    if (t) { (settings.trends ||= {})[k] = t; saveSettings(); log(`Tendencias de ${streamer}: ${t.n} clips, duración ideal ${t.seconds} s`); }
    return t ?? trendFor(streamer);
  } finally { trendBusy.delete(k); }
}
/** Se actualizan solas una vez al dia, sin esperar (al analizar un directo de ese streamer). */
export function trendsSoon(streamer: string) {
  const t = trendFor(streamer);
  if (!t || Date.now() - +new Date(t.at) > 24 * 3600_000) refreshTrends(streamer).catch((e) => log('Tendencias: ' + (e as Error).message.slice(0, 120)));
}

export function setProfile(streamer: string, p: { words?: string[] | string; useLength?: boolean; names?: string[] | string; unfix?: string }) {
  const pr = prof(key(streamer));
  if (p.unfix != null && pr.fixes) delete pr.fixes[String(p.unfix)];
  if (p.names != null) pr.names = parseNames(p.names);
  if (p.words != null) pr.words = [...new Set((Array.isArray(p.words) ? p.words : String(p.words).split(/[,\n]+/)).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2))].slice(0, 40);
  if (p.useLength != null) pr.useLength = !!p.useLength;
  saveSettings();
}
export function removeExample(streamer: string, id: string) {
  const pr = prof(key(streamer));
  pr.examples = pr.examples.filter((e) => e.id !== id);
  saveSettings();
}
/** Analiza un clip de ejemplo (enlace o archivo): solo se guardan sus medidas, el video se borra. */
export function addExample(streamer: string, value: string) {
  const k = key(streamer);
  value = String(value || '').trim().replace(/^"|"$/g, '');
  if (!value) throw new Error('Pega el enlace de un clip o la ruta de un archivo');
  return enqueueA('Analizando un clip de ejemplo', async () => {
    const id = Date.now().toString(36);
    const d = path.join(DATA, 'examples', id);
    fs.mkdirSync(d, { recursive: true });
    try {
      let file = value, title = path.basename(value);
      if (/^https?:\/\//.test(value)) {
        await ensureYtdlp();
        const r = await run(YTDLP, ['--no-playlist', '--no-warnings', '-f', 'b[height<=720]/bv*[height<=720]+ba/b', '--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG, '--max-filesize', '300M', '--print', 'after_move:%(title)s', '-o', path.join(d, 'ex.%(ext)s'), value]);
        const f = fs.readdirSync(d).find((x) => x.startsWith('ex.') && !x.endsWith('.part'));
        const lines = r.stderr.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!f) throw new Error('No pude descargar ese clip: ' + (lines.filter((l) => /ERROR/.test(l)).pop() || 'enlace no compatible').slice(0, 200));
        file = path.join(d, f);
        title = lines.filter((l) => !/^(ERROR|WARNING|\[)/.test(l)).pop() || value;
      } else if (!fs.existsSync(file)) throw new Error('No existe el archivo: ' + file);
      const p = await probe(file);
      if (!(p.duration >= 4 && p.duration <= 300)) throw new Error('Un ejemplo debe ser un clip corto, de entre 4 segundos y 5 minutos.');
      const az = smooth(zscores(await energyPerSecond(file, 0)), 1);
      let pk = 0;
      az.forEach((v, i) => { if (v > az[pk]) pk = i; });
      const scene = await sceneScores(file, 0).catch(() => [] as number[]);
      let text = '';
      try { text = (await listen(file, 0, Math.min(p.duration, 120))).map((w) => w.text).join(' '); } catch { /* sin modelo de voz se mide lo demas */ }
      const h = heuristicScore(Math.max(0, az[pk] || 0), text, Math.min(p.duration, 120), 0, 0, null);
      // Su estilo de edicion (ritmo, zooms, transiciones): la auto edicion de este streamer lo imitara.
      const style = await measureStyle(file).catch(() => undefined);
      const ex: Example = { id, url: value, title: title.slice(0, 80), seconds: Math.round(p.duration), peakPos: az.length ? Math.round((pk / az.length) * 100) / 100 : 0.7,
        wps: Math.round(h.features.density * 10) / 10, hype: h.features.hype, cuts: Math.round((scene.filter((v) => v > 0.3).length / Math.max(0.2, p.duration / 60)) * 10) / 10, at: new Date().toISOString(), style };
      const pr = prof(k);
      pr.examples = [ex, ...pr.examples].slice(0, 30);
      if (text) countWords(k, text);
      saveSettings();
      log(`Ejemplo analizado: ${ex.title} (${ex.seconds} s)`);
      return ex;
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
}

// ---------- repetidos ----------
const wordSet = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3));
export function similar(a: string, b: string) {
  const A = wordSet(a), B = wordSet(b);
  if (A.size < 6 || B.size < 6) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
/** Si este momento ya esta en un clip: mismo tramo de la misma fuente, o mismas palabras en otra (un resubido). */
export function dupOf(s: Source, c: Candidate): string | undefined {
  if (c.exported) return;
  for (const k of clips.values()) {
    if (k.kind !== 'clip' || k.status === 'error') continue;
    if (k.sid === s.id) {
      if ((Math.min(c.end, k.end) - Math.max(c.start, k.start)) / Math.max(1, c.end - c.start) >= 0.5) return k.title || 'otro clip';
    } else if (c.text && k.text && similar(c.text, k.text) >= 0.6) return k.title || 'otro clip';
  }
}
