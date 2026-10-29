/** Publicar, cuentas conectadas y resultados de TikTok. */
import path from 'node:path';
import { checkTikTok, hasSubirTikTok, installSubirTikTok, subirTikTok, subirTikTokLogin, subirTikTokReady } from '../publish/subirtiktok';
import { newModel, train } from '../analysis/learn';
import { analyze as analyzeStats, bestHours, type EditInfo, merge as mergeStats, nextSlot, type Report as StatsReport, titleOf, type TtVideo, viewsAtDay } from '../analysis/stats';
import fs from 'node:fs';
import { readJson, writeJson } from '../../shared/fs';
import { rescore } from './analysis';
import { report, state, updateSettings } from './backup';
import { suggestTitles } from './captions';
import { capture, community } from './community';
import { type ClipMeta, clips, CLIPS, DATA, key, log, makeQueue, median, notice, saveClip, saveSettings, settings, sources } from './core';
import { alertPhone } from './notify';
import { ensureYtdlp, hasYoutube, YTDLP } from './tools';

// ---------- publicar y resultados ----------
export function updateClip(cid: string, p: { title?: string; description?: string; scheduledAt?: string | null; viewsOther?: number }) {
  const c = clips.get(cid);
  if (!c) throw new Error('Clip desconocido');
  if (p.title != null) c.title = p.title;
  if (p.description != null) c.description = p.description;
  if (p.scheduledAt !== undefined) c.scheduledAt = p.scheduledAt || undefined;
  if (p.viewsOther != null) c.viewsOther = Math.max(0, Math.round(p.viewsOther) || 0);
  saveClip(c);
  if (p.viewsOther != null) learnFromViews();
  return c;
}

export async function uploadClip(cid: string) {
  const c = clips.get(cid);
  if (!c?.file) throw new Error('El clip no está listo');
  if (c.youtubeId) throw new Error('Este clip ya se subió');
  if (!hasYoutube()) throw new Error('YouTube no está configurado: sigue el apartado "YouTube" del README.');
  c.uploading = true;
  notice('curso', `Subiendo a YouTube: ${c.title || cid}`, cid);
  try {
    const { uploadFile } = await import('../../shorts/stages/publish');
    const at = c.scheduledAt && +new Date(c.scheduledAt) > Date.now() + 60_000 ? c.scheduledAt : undefined;
    c.ytPct = 0;
    c.youtubeId = await uploadFile(path.join(CLIPS, cid, 'clip.mp4'), { title: c.title || 'Clip', description: (c.description || '') + '\n#shorts', at }, (p) => (c.ytPct = p));
    log(`Subido a YouTube: ${c.title || cid}${at ? ' (programado)' : ' (privado)'}`);
    notice('ok', `Subido a YouTube${at ? ' (programado)' : ' (privado)'}: ${c.title || cid}`, cid, `https://youtube.com/shorts/${c.youtubeId}`);
  } catch (e) {
    notice('mal', `Falló la subida a YouTube de «${c.title || cid}»: ${(e as Error).message.slice(0, 140)}`, cid);
    throw e;
  } finally {
    c.uploading = false; c.ytPct = undefined;
    saveClip(c);
  }
  return c;
}

const tiktokQueue = makeQueue();
const tiktokTags = (c: ClipMeta) => {
  const clean = (value?: string) => String(value || '').replace(/^#+/, '').replace(/[^a-z0-9_áéíóúñ]/gi, '');
  const st = clean(c.streamer).toLowerCase();
  return [...new Set([st ? st + 'clips' : '', 'clipsvirales', st].map(clean).filter(Boolean))].slice(0, 5);
};

export function uploadClipTikTok(cid: string, o: { now?: boolean } = {}) {
  const c = clips.get(cid);
  if (!c?.file || c.status !== 'listo') throw new Error('El clip no está listo');
  if (c.tiktokAt) throw new Error('Este clip ya se subió a TikTok');
  if (c.tiktokUploading) throw new Error('Este clip ya se está subiendo a TikTok');
  if (c.note?.startsWith('TikTok:')) { c.note = undefined; saveClip(c); }
  const account = settings.tiktokAccount;
  if (!account) throw new Error('Pon tu cuenta de TikTok en Ajustes.');
  if (!hasSubirTikTok()) throw new Error('Instala la librería de TikTok desde Ajustes.');
  if (!subirTikTokReady(account)) throw new Error(`Conecta la cuenta ${account} en Ajustes.`);

  c.tiktokUploading = true;
  saveClip(c);
  c.ttPct = 0; c.ttStep = 'en cola';
  notice('cola', `En cola para TikTok: ${c.title || cid}`, cid);
  return tiktokQueue(`TikTok: ${c.title || cid}`, async () => {
    notice('curso', `Subiendo a TikTok: ${c.title || cid}`, cid);
    c.ttPct = 3; c.ttStep = 'abriendo el navegador';
    try {
      let at: string | undefined, day: number | undefined, when = c.scheduledAt && +new Date(c.scheduledAt) > Date.now() + 15 * 60_000 ? c.scheduledAt : '';
      // Sin hora elegida: la mejor franja segun tus resultados, y nunca a menos de 1 h de otro video tuyo.
      if (!when && !o.now && settings.tiktokSmart !== false) {
        const slot = await smartTikTokSlot().catch(() => null);
        if (slot) { when = new Date(slot).toISOString(); c.tiktokPlan = when; saveClip(c); }
      }
      if (when) {
        const date = new Date(when);
        date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
        at = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        day = date.getDate();
      }
      const description = `${c.title || 'Clip'}${c.description ? ' ' + c.description : ''}`.slice(0, 2200);
      const result = await subirTikTok({
        file: path.join(CLIPS, cid, 'clip.mp4'),
        account,
        description,
        hashtags: tiktokTags(c),
        at,
        day,
        visibility: settings.tiktokVisibility || 'everyone',
        onStep: (pct, what) => { c.ttPct = pct; c.ttStep = what; },
      });
      c.tiktokAt = new Date().toISOString();
      if (!at) c.tiktokPlan = c.tiktokAt;
      log(`TikTok publicado: ${c.title || cid}${at ? ` (programado para las ${at})` : ''} · ${result}`);
      alertPhone(`TikTok: ${c.title || 'clip'}${at ? ' (programado)' : ''}.`).catch(() => {});
      notice('ok', `Subido a TikTok${at ? ` (programado para las ${at})` : ''}: ${c.title || cid}`, cid, `https://www.tiktok.com/@${account}`);
      return c;
    } catch (e) {
      // La libreria a veces no sabe confirmar una subida que si hizo (sobre todo las programadas: «Done scheduling video»
      // y luego «Cannot confirm»). Se da por subida con un aviso, para no subirla dos veces (TikTok lo veria repetido).
      if (/Cannot confirm if uploaded/i.test((e as Error).message)) {
        c.tiktokAt = new Date().toISOString();
        c.note = `TikTok no confirmó la subida${c.tiktokPlan ? ` (programada para las ${new Date(c.tiktokPlan).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })})` : ''}: compruébalo en tu perfil o en TikTok Studio antes de volver a subirla.`;
        notice('ok', `Subido a TikTok, sin confirmar: ${c.title || cid}. Compruébalo en tu perfil.`, cid, `https://www.tiktok.com/@${account}`);
        return c;
      }
      c.note = `TikTok: ${(e as Error).message.slice(0, 200)}`;
      c.tiktokPlan = undefined; // la hora elegida queda libre para el siguiente
      log(`Falló la subida a TikTok: ${(e as Error).message.slice(0, 200)}`);
      notice('mal', `Falló la subida a TikTok de «${c.title || cid}»: ${(e as Error).message.slice(0, 140)}`, cid);
      throw e;
    } finally {
      c.tiktokUploading = false; c.ttPct = undefined; c.ttStep = undefined;
      saveClip(c);
    }
  });
}

export function queueAutoTikTokUpload(c: ClipMeta) {
  if (!settings.tiktokAuto || !settings.tiktokAccount || c.tiktokAt) return;
  // Lo que TikTok trataria como repetido no se sube solo: se avisa para que lo cambies o lo subas tu.
  const { risks } = tiktokRisks(c.id);
  if (risks.length) { c.note = 'TikTok: no lo subí solo. ' + risks[0]; saveClip(c); notice('mal', `No subí solo «${c.title || c.id}» a TikTok: ${risks[0]}`, c.id); return; }
  void Promise.resolve().then(() => uploadClipTikTok(c.id)).catch((e) => {
    const message = (e as Error).message.slice(0, 200);
    if (!c.note?.startsWith('TikTok:')) {
      c.note = `TikTok: ${message}`;
      saveClip(c);
      log(`Falló la subida automática a TikTok: ${message}`);
      notice('mal', `No se pudo subir a TikTok «${c.title || c.id}»: ${message.slice(0, 140)}`, c.id);
    }
  });
}

// ---------- cuentas conectadas: se comprueban de verdad, sin publicar nada ----------
type AccountState = { state: 'ok' | 'mal' | 'falta' | 'duda'; msg: string; at?: string };
type AccountKey = 'tiktok' | 'youtube' | 'discord' | 'telegram';
const ACCOUNT_NAMES: Record<AccountKey, string> = { tiktok: 'TikTok', youtube: 'YouTube', discord: 'Discord', telegram: 'Telegram' };
const accounts: Record<AccountKey, AccountState> = { tiktok: { state: 'falta', msg: 'Sin comprobar todavía.' }, youtube: { state: 'falta', msg: 'Sin comprobar todavía.' }, discord: { state: 'falta', msg: 'Sin comprobar todavía.' }, telegram: { state: 'falta', msg: 'Sin comprobar todavía.' } };
let accountsChecking: Promise<void> | null = null;
export const accountsState = () => ({ ...accounts, checking: !!accountsChecking });

async function checkTikTokAccount(): Promise<AccountState> {
  const acc = settings.tiktokAccount;
  if (!acc) return { state: 'falta', msg: 'Escribe tu usuario y conecta la cuenta.' };
  if (!hasSubirTikTok()) return { state: 'falta', msg: 'Falta instalar la librería.' };
  if (!subirTikTokReady(acc)) return { state: 'mal', msg: `@${acc} sin conectar: pulsa «Conectar cuenta».` };
  const r = await tiktokQueue('TikTok: comprobar cuenta', () => checkTikTok(acc));
  if (r === 'ok') return { state: 'ok', msg: `@${acc} conectada y lista para publicar.` };
  if (r === 'caducada') return { state: 'mal', msg: `La sesión de @${acc} caducó: pulsa «Reconectar cuenta».` };
  return { state: 'duda', msg: 'TikTok no respondió a tiempo; se vuelve a comprobar en 30 minutos.' };
}
async function checkDiscord(): Promise<AccountState> {
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(settings.discord || '')) return { state: 'falta', msg: settings.discord ? 'El enlace no es un webhook de Discord.' : 'Sin configurar.' };
  const r = await fetch(settings.discord, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return { state: 'mal', msg: `Discord no reconoce el webhook (${r.status}). Crea otro y pégalo.` };
  const j: any = await r.json().catch(() => ({}));
  return { state: 'ok', msg: j.name ? `Webhook «${j.name}».` : 'Webhook válido.' };
}
async function checkTelegram(): Promise<AccountState> {
  if (!settings.telegramToken || !settings.telegramChat) return { state: 'falta', msg: settings.telegramToken || settings.telegramChat ? 'Faltan el token o el chat id.' : 'Sin configurar.' };
  const base = `https://api.telegram.org/bot${settings.telegramToken}`;
  const me: any = await fetch(`${base}/getMe`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null);
  if (!me?.ok) return { state: 'mal', msg: 'Telegram no reconoce el token del bot.' };
  const chat: any = await fetch(`${base}/getChat?chat_id=${encodeURIComponent(settings.telegramChat)}`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => null);
  if (!chat?.ok) return { state: 'mal', msg: `El bot @${me.result.username} no puede escribir a ese chat: ábrelo en Telegram y pulsa «Iniciar».` };
  return { state: 'ok', msg: `Bot @${me.result.username}.` };
}

export function checkAccounts() {
  if (accountsChecking) return accountsChecking;
  const set = (k: AccountKey, a: AccountState) => {
    const before = accounts[k].state;
    accounts[k] = { ...a, at: new Date().toISOString() };
    if (before === 'ok' && a.state === 'mal') { notice('mal', `${ACCOUNT_NAMES[k]}: ${a.msg}`); log(`${ACCOUNT_NAMES[k]}: ${a.msg}`); }
  };
  const run = (k: AccountKey, f: () => Promise<AccountState>) => f().then((a) => set(k, a)).catch((e) => set(k, { state: 'duda', msg: `No se pudo comprobar: ${(e as Error).message.slice(0, 120)}` }));
  accountsChecking = Promise.all([
    run('tiktok', checkTikTokAccount),
    run('youtube', async () => (await import('../../shorts/stages/publish')).youtubeCheck()),
    run('discord', checkDiscord),
    run('telegram', checkTelegram),
  ]).then(() => {}).finally(() => { accountsChecking = null; });
  return accountsChecking;
}
if (!process.env.VITEST) { setTimeout(() => void checkAccounts(), 20_000).unref(); setInterval(() => void checkAccounts(), 30 * 60_000).unref(); }

export function tiktokUploadConnect(account: string) {
  const name = String(account || '').trim().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,24}$/i.test(name)) throw new Error('Escribe un nombre de usuario de TikTok válido.');
  updateSettings({ tiktokAccount: name });
  return tiktokQueue('TikTok: conectar cuenta', async () => {
    await subirTikTokLogin(name, (m) => log(`TikTok: ${m.slice(0, 200)}`));
    log(`Cuenta de TikTok conectada: ${name}`);
    notice('ok', `Cuenta de TikTok conectada: @${name}`);
    setTimeout(() => void checkAccounts(), 0);
    return { ok: true };
  });
}

export function tiktokUploadInstall() {
  return tiktokQueue('TikTok: instalar librería', async () => {
    await installSubirTikTok((m) => log(`TikTok: ${m.slice(0, 200)}`));
    log('Librería para subir a TikTok instalada');
    return { ok: true };
  });
}

export async function refreshViews() {
  const up = [...clips.values()].filter((c) => c.youtubeId);
  if (!up.length) return;
  const { videoViews } = await import('../../shorts/stages/publish');
  const views = await videoViews(up.map((c) => c.youtubeId!));
  for (const c of up) if (views.has(c.youtubeId!)) (c.viewsYt = views.get(c.youtubeId!)), saveClip(c);
  learnFromViews();
}

const viewsOf = (c: ClipMeta) => (c.viewsYt || 0) + (c.viewsOther || 0) + (c.viewsTt || 0);
/**
 * Aprende de tus resultados: por streamer, los clips con mas vistas que la mediana cuentan como acierto
 * y los demas como fallo. Hace falta un minimo de 4 clips con vistas.
 */
export function learnFromViews() {
  const by = new Map<string, ClipMeta[]>();
  for (const c of clips.values()) if (c.features && viewsOf(c) > 0) by.set(key(c.streamer), [...(by.get(key(c.streamer)) || []), c]);
  let changed = false;
  for (const [k, list] of by) {
    if (list.length < 4) continue;
    const med = median(list.map(viewsOf));
    for (const c of list) {
      const label = viewsOf(c) >= med ? 1 : 0;
      if (c.viewLabel === label) continue;
      settings.models[k] = train(settings.models[k] ?? newModel(), c.features!, label, 0.4);
      c.viewLabel = label;
      saveClip(c);
      changed = true;
    }
  }
  if (!changed) return;
  saveSettings();
  for (const s of sources.values()) { s.candidates.forEach((x) => rescore(s, x)); s.candidates.sort((a, b) => b.score - a.score); }
  log('Puntuación ajustada con las vistas de tus clips');
}

// ---------- resultados de TikTok ----------
/**
 * Lee tu perfil publico de TikTok (yt-dlp, sin sesion: vistas, me gusta, comentarios, compartidos, guardados, hora y
 * duracion de cada video), lo junta con el historial y lo analiza. Cada video se une a su clip de Clipper por el titulo:
 * asi se sabe como se edito y sus vistas entrenan la puntuacion de los momentos.
 */
const TT_STATS = path.join(DATA, 'tiktok-stats.json');
let ttReport: { at: number; report: StatsReport } | null = null, ttBusy: Promise<StatsReport> | null = null;
const normT = (t: string) => titleOf(t).toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function tiktokStats(refresh = false): Promise<StatsReport> {
  const acc = (settings.tiktokAccount || '').replace(/^@/, '').trim();
  if (!acc) return Promise.reject(new Error('Pon tu cuenta de TikTok en Ajustes › Cuentas para ver tus resultados.'));
  if (!refresh && ttReport && Date.now() - ttReport.at < 3 * 3600_000) return Promise.resolve(ttReport.report);
  return (ttBusy ||= (async () => {
    await ensureYtdlp();
    const hist = fs.existsSync(TT_STATS) ? readJson<{ videos: Record<string, TtVideo>; acc?: string; cid?: string }>(TT_STATS) : { videos: {} as Record<string, TtVideo> };
    // TikTok a veces no deja leer el perfil por su nombre: entonces se lee por su identificador (guardado la primera vez).
    const read = (u: string) => capture(YTDLP, ['--flat-playlist', '--no-warnings', '-J', u]).then((o) => JSON.parse(o || 'null')).catch(() => null);
    let raw = await read(`https://www.tiktok.com/@${acc}`);
    if (!raw?.entries?.length && hist.cid && hist.acc === acc) raw = await read('tiktokuser:' + hist.cid);
    if (!raw?.entries?.length) raw = await read(`https://www.tiktok.com/@${acc}`);
    if (!raw?.entries?.length) throw new Error(`TikTok no dejó leer @${acc} ahora mismo (¿es la cuenta correcta y es pública?). Prueba otra vez en unos minutos.`);
    if (raw.id && /^MS4w/.test(raw.id)) Object.assign(hist, { acc, cid: raw.id });
    const now = Math.round(Date.now() / 1000);
    const list = (raw.entries || []).map((e: any) => ({ id: String(e.id), desc: String(e.description || e.title || ''), ts: +e.timestamp || 0, dur: +e.duration || 0, views: +e.view_count || 0, likes: +e.like_count || 0, comments: +e.comment_count || 0, shares: +e.repost_count || 0, saves: +e.save_count || 0 }));
    mergeStats(hist.videos, list, now);
    writeJson(TT_STATS, { ...hist, at: now });
    // Cada video con su clip de Clipper: mismo titulo (sin hashtags) y subido despues de exportarlo.
    const edits: Record<string, EditInfo> = {}, byTitle = [...clips.values()].filter((c) => c.spec && c.status === 'listo');
    let learned = false;
    for (const v of Object.values(hist.videos)) {
      const t = normT(v.desc);
      if (t.length < 4) continue;
      const c = byTitle.find((c) => { const ct = normT(c.title || ''); return ct.length >= 4 && (t.startsWith(ct) || ct.startsWith(t)) && +new Date(c.createdAt) / 1000 <= v.ts + 600; });
      if (!c) continue;
      const sp = c.spec!;
      edits[v.id] = { layout: sp.layout, captions: !!sp.captions?.on, capStyle: sp.captions?.style, zooms: sp.zooms?.length || 0, punches: sp.punches?.length || 0, transition: !!sp.transition, scenes: sp.scenes?.length || 0, music: !!sp.music, hook: !!sp.hook };
      if (now - v.ts >= 24 * 3600) { const vv = Math.round(viewsAtDay(v)); if (c.viewsTt !== vv || c.tiktokId !== v.id) { Object.assign(c, { viewsTt: vv, tiktokId: v.id }); saveClip(c); learned = true; } }
    }
    if (learned) learnFromViews();
    const streamers = [...new Set([...[...sources.values()].map((s) => s.streamer), ...Object.keys(settings.profiles || {})].filter((x) => x && x.length >= 3))];
    const report = analyzeStats(Object.values(hist.videos), { now, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, localHour: (ts) => new Date(ts * 1000).getHours(), localDay: (ts) => new Date(ts * 1000).getDay(), edits, streamers });
    ttReport = { at: Date.now(), report };
    return report;
  })().finally(() => { ttBusy = null; }));
}
/**
 * Lo que puede hacer que TikTok no enseñe un clip: uno de la comunidad casi sin cambios, o con el titulo del clip de
 * Twitch, lo suben igual otras cuentas y TikTok lo trata como contenido repetido (no lo pone en «Para ti»).
 */
export function tiktokRisks(cid: string) {
  const c = clips.get(cid), s = c && sources.get(c.sid), risks: string[] = [];
  if (!c || !s?.community) return { risks, community: false };
  const ct = normT(c.title || ''), ot = normT(s.community.title || '');
  if (ct && ot && (ct === ot || ct.startsWith(ot) || ot.startsWith(ct))) risks.push(`El título es el mismo del clip de Twitch («${s.community.title}»): otras cuentas lo suben con ese título.`);
  const sp = c.spec, cut = (sp?.segments?.length || 0) > 1 || (s.duration > 0 && c.end - c.start < s.duration * 0.85);
  const edited = !!(sp?.captions?.on && sp.captions.words?.length) || !!sp?.texts?.length || !!sp?.zooms?.length || !!sp?.punches?.length || !!sp?.stickers?.length || cut;
  if (!edited) risks.push('Casi no tiene cambios respecto al clip de la comunidad (sin subtítulos, textos, zooms ni recortes): TikTok lo ve igual que los que suben otros.');
  const twin = [...clips.values()].find((x) => x.id !== cid && x.sid === c.sid && (x.tiktokAt || x.tiktokUploading));
  if (twin) risks.push(`Ya subiste otro clip de este mismo clip de la comunidad («${twin.title || twin.id}»).`);
  return { risks, community: true };
}
/** Los riesgos y, si el titulo es el de Twitch, uno nuevo propuesto con lo que se dice en el clip. */
export async function tiktokRisksTitled(cid: string) {
  const r = tiktokRisks(cid), c = clips.get(cid);
  const title = r.risks.some((x) => x.startsWith('El título')) && c?.text ? (await suggestTitles(c.sid, c.text).catch(() => null))?.titles?.[0] : undefined;
  return { ...r, title };
}
/** Para preguntar antes de subir: a que hora lo programaria Clipper y por que (sin hora: se publica ya). */
export async function tiktokSlotInfo() {
  if (settings.tiktokSmart === false) return { at: null, why: '' };
  const slot = await smartTikTokSlot().catch(() => null);
  if (!slot) return { at: null, why: '' };
  const best = bestHours(ttReport?.report || null), last = Math.max(0, ...[...clips.values()].map((c) => +new Date(c.tiktokPlan || c.tiktokAt || 0)));
  const why = best && new Date(slot).getHours() >= best[0] && new Date(slot).getHours() < best[1] ? `Tu mejor franja es de ${best[0]} a ${best[1]} h.` : last && slot - last < 2 * 3600_000 ? 'Tu último video salió hace menos de 1 hora y subirlos seguidos les quita vistas.' : 'Así queda separado de tus otros videos.';
  return { at: new Date(slot).toISOString(), why };
}
/** Cuando publicar en TikTok lo siguiente que se sube (null: ya). Ver nextSlot en stats.ts. */
async function smartTikTokSlot() {
  const rep = await tiktokStats().catch(() => ttReport?.report || null);
  const hist = fs.existsSync(TT_STATS) ? Object.values(readJson<{ videos: Record<string, TtVideo> }>(TT_STATS).videos || {}) : [];
  const busy = [...hist.map((v) => v.ts * 1000), ...[...clips.values()].map((c) => +new Date(c.tiktokPlan || c.tiktokAt || 0)).filter((t) => t > 0)];
  const local = (base: number, d: number, h: number, m: number) => { const x = new Date(base); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return +x; };
  return nextSlot(Date.now(), busy, bestHours(rep), local);
}
/** Tus titulos de TikTok que mejor funcionaron (para que la IA imite lo que le gusta a tu publico). */
export function ownBestTitles(n = 5) {
  if (!fs.existsSync(TT_STATS)) return [];
  const now = Date.now() / 1000, v = Object.values(readJson<{ videos: Record<string, TtVideo> }>(TT_STATS).videos || {}).filter((x) => now - x.ts >= 24 * 3600 && titleOf(x.desc).length >= 4);
  return v.sort((a, b) => viewsAtDay(b) - viewsAtDay(a)).slice(0, n).map((x) => ({ t: titleOf(x.desc), v: Math.round(viewsAtDay(x)) }));
}
// Se lee cada 6 h (y poco despues de abrir) para ir guardando como crece cada video.
if (!process.env.VITEST) { setTimeout(() => void tiktokStats(true).catch(() => {}), 5 * 60_000).unref(); setInterval(() => void tiktokStats(true).catch(() => {}), 6 * 3600_000).unref(); }
