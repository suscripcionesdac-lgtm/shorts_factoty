/** Clips de la comunidad (Twitch y Kick), su sitio dentro del VOD y los canales vigilados. */
import { spawn } from 'node:child_process';
import { log, settings, type Source, sources } from './core';
import { src } from './preview';
import { addUrl, idLike } from './sources';
import { ensureYtdlp, YTDLP } from './tools';

// ---------- clips de la comunidad (Twitch y Kick) ----------
export type CommunityClip = { id: string; title: string; views: number; seconds: number; at: string; thumb: string; video: string; platform: 'twitch' | 'kick' };
/**
 * Clips de la comunidad hechos entre `from` y `to` (ms): en Kick se piden paginas hacia atras (la lista publica da 20
 * por pagina; un directo de 3 h puede tener cientos) hasta pasar `from`; en Twitch, los de la semana.
 */
export async function communityRange(origin: string, from: number, to: number): Promise<CommunityClip[]> {
  const c = channelInfo(origin);
  if (!c) return [];
  const inRange = (k: CommunityClip) => +new Date(k.at) >= from && +new Date(k.at) <= to + 120_000;
  if (c.platform === 'twitch') {
    await ensureYtdlp();
    const out = await capture(YTDLP, ['--flat-playlist', '--no-warnings', '--playlist-end', '500', '-J', `https://www.twitch.tv/${c.channel}/clips?filter=clips&range=7d`]);
    return (JSON.parse(out || '{}').entries || []).map((x: any) => ({ id: String(x.id), title: x.title || 'Clip', views: x.view_count || 0, seconds: x.duration || 0, at: new Date((x.timestamp || 0) * 1000).toISOString(), thumb: x.thumbnail || '', video: x.url, platform: 'twitch' as const })).filter(inRange);
  }
  const out: CommunityClip[] = [];
  let cursor = '';
  for (let page = 0; page < 80; page++) {
    const d = await kickJson(`https://kick.com/api/v2/channels/${encodeURIComponent(c.channel)}/clips${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`);
    const list: CommunityClip[] = (d.clips || []).map((x: any) => ({ id: String(x.id), title: x.title || 'Clip', views: x.views || 0, seconds: x.duration || 0, at: x.created_at, thumb: x.thumbnail_url || '', video: x.video_url || x.clip_url, platform: 'kick' as const }));
    out.push(...list.filter(inRange));
    cursor = d.nextCursor ? (typeof d.nextCursor === 'string' ? d.nextCursor : JSON.stringify(d.nextCursor)) : '';
    if (!list.length || !cursor || list.every((k) => +new Date(k.at) < from)) break;
  }
  return out;
}
/** Cuando empezo el directo de un VOD (y su canal, que en Twitch no va en el enlace): se pregunta una vez a yt-dlp. */
export async function streamStartOf(s: Source) {
  if ((s.streamStart != null && !idLike(s.name)) || !/twitch\.tv|kick\.com/.test(s.origin)) return s.streamStart || 0;
  try {
    await ensureYtdlp();
    const [ts, up, ...title] = (await capture(YTDLP, ['--skip-download', '--no-warnings', '--print', '%(timestamp)s|%(uploader_id)s|%(title)s', s.origin])).trim().split('|');
    s.streamStart = +ts > 0 ? +ts * 1000 : 0;
    if (up && up !== 'NA') s.streamChannel = up;
    // Un VOD que se llama como su identificador («01a17413-f760-…»): el streamer y el titulo del directo.
    const t = title.join('|').trim();
    if (idLike(s.name) && t && t !== 'NA') s.name = `${s.streamer || s.streamChannel || ''}${s.streamer || s.streamChannel ? ' · ' : ''}${t}`.slice(0, 90);
  } catch { s.streamStart = 0; }
  return s.streamStart;
}
/** Plataforma y canal de un enlace de Twitch o Kick. */
export function channelInfo(url: string): { platform: 'twitch' | 'kick'; channel: string } | null {
  try {
    const u = new URL(url), channel = u.pathname.split('/').filter(Boolean)[0];
    if (!channel) return null;
    if (/(^|\.)twitch\.tv$/.test(u.hostname)) return { platform: 'twitch', channel };
    if (/(^|\.)kick\.com$/.test(u.hostname)) return { platform: 'kick', channel };
  } catch { /* no es un enlace */ }
  return null;
}
const commCache = new Map<string, { t: number; list: CommunityClip[] }>();
/** Salida de un programa, sin bloquear el servidor mientras responde (como mucho 60 s). */
export const capture = (cmd: string, args: string[]) => new Promise<string>((ok, no) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let d = '';
  const t = setTimeout(() => p.kill(), 60_000);
  p.stdout.on('data', (x) => (d += x));
  p.on('error', no);
  p.on('close', () => { clearTimeout(t); ok(d); });
});
/** Tramo de una grabacion que recoge un clip de la comunidad: los segundos anteriores al momento en que se creo. */
export function clipWindow(k: Pick<CommunityClip, 'at' | 'seconds'>, recStart: number, total: number) {
  const len = k.seconds || 30, end = (+new Date(k.at) - recStart) / 1000, a = Math.max(0, end - len);
  // Fuera de la grabacion (antes de empezar o despues de terminar) no cuenta, ni si la mayor parte de lo que se clipeo
  // paso antes de empezar a grabar: lo grabado en ese tramo seria otra cosa (a menudo, la pantalla de anuncios).
  return end < 5 || end < len * 0.7 || a >= total ? null : { a, b: Math.min(total, end) };
}
/**
 * Los clips que la gente hizo de un canal: los mas vistos de la semana, o los mas recientes (para cruzarlos con una
 * grabacion). Sin iniciar sesion: Kick tiene una lista publica y Twitch se lee con yt-dlp. Se guardan 10 minutos.
 */
export async function communityClips(origin: string, recent = false): Promise<CommunityClip[]> {
  const c = channelInfo(origin);
  if (!c) throw new Error('Los clips de la comunidad solo están para canales de Twitch y Kick.');
  const k = `${c.platform}:${c.channel}:${recent}`, hit = commCache.get(k);
  if (hit && Date.now() - hit.t < 600_000) return hit.list;
  let list: CommunityClip[];
  if (c.platform === 'kick') {
    // Kick rechaza (403) las peticiones de Node por su huella de conexion; curl (incluido en Windows 10 y 11) si pasa.
    const url = `https://kick.com/api/v2/channels/${encodeURIComponent(c.channel)}/clips${recent ? '' : '?sort=view&time=week'}`;
    let data: any;
    try { data = JSON.parse(await capture('curl', ['-s', '-m', '20', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', '-H', 'Accept: application/json', url])); }
    catch { throw new Error('Kick no devolvió la lista de clips (¿existe el canal?, ¿hay internet?)'); }
    list = (data.clips || []).map((x: any) => ({ id: String(x.id), title: x.title || 'Clip', views: x.views || 0, seconds: x.duration || 0, at: x.created_at, thumb: x.thumbnail_url || '', video: x.video_url || x.clip_url, platform: 'kick' as const }));
  } else {
    await ensureYtdlp();
    const out = await capture(YTDLP, ['--flat-playlist', '--no-warnings', '--playlist-end', recent ? '50' : '100', '-J', `https://www.twitch.tv/${c.channel}/clips?filter=clips&range=${recent ? '24hr' : '7d'}`]);
    list = (JSON.parse(out || '{}').entries || []).map((x: any) => ({ id: String(x.id), title: x.title || 'Clip', views: x.view_count || 0, seconds: x.duration || 0, at: new Date((x.timestamp || 0) * 1000).toISOString(), thumb: x.thumbnail || '', video: x.url, platform: 'twitch' as const }));
  }
  list.sort((a, b) => (recent ? +new Date(b.at) - +new Date(a.at) : b.views - a.views));
  commCache.set(k, { t: Date.now(), list });
  return list;
}

/** Para la pantalla «En vivo»: los clips de la comunidad del canal de una fuente. */
export async function community(sid: string) {
  // Los de la semana van por vistas: uno recien hecho tiene pocas y no entraba. Se juntan con los de las ultimas 24 h.
  const o = src(sid).origin, [week, day] = await Promise.all([communityClips(o, false), communityClips(o, true).catch(() => [] as CommunityClip[])]);
  const seen = new Set(week.map((k) => k.id));
  return [...week, ...day.filter((k) => !seen.has(k.id))];
}

// ---------- un clip de la comunidad dentro de su directo (VOD) ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const kickJson = async (url: string) => JSON.parse(await capture('curl', ['-s', '-m', '20', '-A', UA, '-H', 'Accept: application/json', url]) || '{}');
/** Segundo del VOD en que empieza un clip de Kick: Kick no lo da, se saca de la hora del clip y la del directo. */
export const kickOffset = (clipCreated: string, vodStart: string, len: number) => Math.max(0, Math.round((Date.parse(clipCreated) - Date.parse(vodStart.replace(' ', 'T') + 'Z')) / 1000 - len));
/**
 * Donde cae un clip de la comunidad en su directo. `ref`: el enlace del clip en Twitch, o el id de un clip de Kick
 * (clip_…, tambien dentro de su enlace). Twitch dice el segundo exacto; en Kick se calcula con las horas (± unos segundos).
 */
export async function clipInVod(ref: string): Promise<{ vod: string; at: number; len: number }> {
  const kick = /clip_[A-Za-z0-9]+/.exec(ref)?.[0];
  if (kick) {
    const c = (await kickJson(`https://kick.com/api/v2/clips/${kick}`)).clip;
    if (!c) throw new Error('Kick no encuentra ese clip.');
    const slug = c.channel?.slug, list = await kickJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/videos`);
    const v = (Array.isArray(list) ? list : []).find((x: any) => String(x.id) === String(c.livestream_id));
    if (!v?.video?.uuid) throw new Error('El directo de ese clip ya no está guardado en Kick.');
    if (!v.duration) throw new Error('Ese directo sigue en vivo: su VOD estará cuando termine.');
    const len = c.duration || 30, at = kickOffset(c.created_at, v.start_time, len);
    // Un clip hecho despues desde el VOD tiene una hora de creacion posterior al final del directo: su minuto no se sabe.
    if (at + len > v.duration / 1000 + 60) throw new Error('Este clip se hizo después, desde el VOD, y Kick no dice en qué minuto está.');
    return { vod: `https://kick.com/${slug}/videos/${v.video.uuid}`, at, len };
  }
  const slug = /twitch\.tv\/(?:[\w-]+\/)?clip\/([\w-]+)|clips\.twitch\.tv\/([\w-]+)/.exec(ref);
  if (!slug) throw new Error('Solo se pueden buscar clips de Twitch o Kick.');
  // El mismo Client-ID publico que usa la web de Twitch (y yt-dlp) para leer datos sin iniciar sesion.
  const r = await fetch('https://gql.twitch.tv/gql', { method: 'POST', headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ query: `{ clip(slug: ${JSON.stringify(slug[1] || slug[2])}) { durationSeconds videoOffsetSeconds video { id } } }` }) }).then((x) => x.json()).catch(() => null);
  const c = r?.data?.clip;
  if (!c) throw new Error('Twitch no encuentra ese clip.');
  if (!c.video?.id || c.videoOffsetSeconds == null) throw new Error('El directo de ese clip ya no está guardado en Twitch (o es solo para suscriptores).');
  // videoOffsetSeconds es donde ACABA el clip (comprobado comparando fotogramas con dos clips de 51 y 13 s).
  const len = c.durationSeconds || 30;
  return { vod: `https://www.twitch.tv/videos/${c.video.id}`, at: Math.max(0, c.videoOffsetSeconds - len), len };
}
/** Baja del VOD el tramo del clip con un minuto antes y otro despues, y marca donde estaba el clip original. */
export async function findInVod(ref: string, streamer: string, title: string, views: number) {
  const { vod, at, len } = await clipInVod(ref), M = 60, a = Math.max(0, at - M);
  return addUrl(vod, streamer, false, `${a}-${at + len + M}`, { title: `${title} · en el directo`, views, at: [at - a, at - a + len] });
}

// ---------- canales vigilados ----------
const isLive = (url: string) =>
  new Promise<boolean>((resolve) => {
    const p = spawn(YTDLP, ['--no-warnings', '--skip-download', '-O', '%(is_live)s', url], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const t = setTimeout(() => p.kill(), 45_000);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(false));
    p.on('close', () => { clearTimeout(t); resolve(/true/i.test(out)); });
  });

export const watchState: Record<string, string> = {};
/** Canales cuya grabacion detuviste tu: la vigilancia no la vuelve a empezar hasta que ese directo termine. */
export const stoppedLive = new Set<string>();
export async function checkWatch() {
  if (!settings.watch.length) return;
  try { await ensureYtdlp(); } catch { return; }
  for (const w of settings.watch) {
    const act = [...sources.values()].some((s) => s.origin === w.url && ['grabando', 'descargando'].includes(s.status));
    if (act) { watchState[w.url] = 'grabando'; continue; }
    const live = await isLive(w.url);
    watchState[w.url] = live ? 'en vivo' : 'sin directo';
    if (!live) stoppedLive.delete(w.url);
    else if (stoppedLive.has(w.url)) watchState[w.url] = 'en vivo · detenido por ti';
    else { log(`${w.streamer} entró en directo: empiezo a grabar`); addUrl(w.url, w.streamer, true); }
  }
}
setInterval(() => checkWatch().catch(() => {}), 180_000).unref();
