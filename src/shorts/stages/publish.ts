import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { google } from 'googleapis';
import open from 'open';
import { ROOT, listRuns, loadScript, loadState, markStage, readJson, runFile, saveState, writeJson } from '../runs';
import type { VoiceFile } from '../types';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const TOKEN = path.join(ROOT, 'secrets/youtube_token.json');

async function auth() {
  const secretFile = path.join(ROOT, process.env.YOUTUBE_CLIENT_SECRET_FILE || 'secrets/client_secret.json');
  if (!fs.existsSync(secretFile)) throw new Error(`No encuentro ${secretFile}. Sigue el apartado "YouTube" del README.`);
  const raw = readJson<any>(secretFile);
  const c = raw.installed || raw.web;
  const port = 4322;
  const client = new google.auth.OAuth2(c.client_id, c.client_secret, `http://localhost:${port}`);
  if (fs.existsSync(TOKEN)) {
    client.setCredentials(readJson(TOKEN));
    try {
      await client.getAccessToken();
      return client;
    } catch {
      console.log('  El permiso de YouTube caduco; hay que autorizar de nuevo.');
    }
  }
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://localhost:${port}`);
      const code = u.searchParams.get('code');
      res.end(code ? 'Autorizado. Ya puedes cerrar esta pestana.' : 'Falta el codigo.');
      if (code) server.close(), resolve(code);
      else if (u.searchParams.get('error')) server.close(), reject(new Error(u.searchParams.get('error')!));
    });
    server.listen(port, () => {
      const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
      console.log(`\n  Autoriza el acceso a tu canal en el navegador:\n  ${url}\n`);
      open(url).catch(() => {});
    });
  });
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  writeJson(TOKEN, tokens);
  return client;
}

/** Comprueba el permiso de YouTube sin abrir el navegador. Devuelve el nombre del canal si funciona. */
export async function youtubeCheck(): Promise<{ state: 'ok' | 'mal' | 'falta'; msg: string }> {
  const secretFile = path.join(ROOT, process.env.YOUTUBE_CLIENT_SECRET_FILE || 'secrets/client_secret.json');
  if (!fs.existsSync(secretFile)) return { state: 'falta', msg: 'Sin configurar (falta secrets/client_secret.json).' };
  if (!fs.existsSync(TOKEN)) return { state: 'mal', msg: 'Falta autorizar el canal: sube un clip para abrir la autorización.' };
  const c = readJson<any>(secretFile).installed || readJson<any>(secretFile).web;
  const client = new google.auth.OAuth2(c.client_id, c.client_secret);
  client.setCredentials(readJson(TOKEN));
  try {
    const r = await google.youtube({ version: 'v3', auth: client }).channels.list({ part: ['snippet'], mine: true });
    const name = r.data.items?.[0]?.snippet?.title;
    return { state: 'ok', msg: name ? `Canal «${name}».` : 'Permiso válido.' };
  } catch (e) {
    return { state: 'mal', msg: `El permiso caducó o fue retirado: ${(e as Error).message.slice(0, 100)}` };
  }
}

export async function publishStage(id: string, opts: { at?: string; public?: boolean }) {
  const script = loadScript(id);
  const st = loadState(id);
  if (st.youtube) throw new Error(`Este video ya se subio (https://youtu.be/${st.youtube.videoId}).`);
  const voice = readJson<VoiceFile>(runFile(id, 'voice.json'));
  const youtube = google.youtube({ version: 'v3', auth: await auth() });
  const tags = script.hashtags.map((h) => h.replace(/^#/, ''));
  const description = `${script.description}\n\n${script.hashtags.join(' ')}`.trim();
  const publishAt = opts.at ? new Date(opts.at).toISOString() : undefined;
  if (publishAt && new Date(publishAt) <= new Date()) throw new Error('--at debe ser una fecha futura, por ejemplo 2026-10-12T18:00:00-05:00');

  console.log('  subiendo a YouTube...');
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: script.title, description, tags, categoryId: '20', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
      status: {
        // Sin fecha queda en privado para que lo revises en YouTube Studio.
        privacyStatus: opts.public && !publishAt ? 'public' : 'private',
        publishAt,
        selfDeclaredMadeForKids: false,
        // Voz clonada = contenido sintetico declarado.
        containsSyntheticMedia: voice.mode === 'clone',
      } as any,
    },
    media: { body: fs.createReadStream(runFile(id, 'video.mp4')) },
  });
  const videoId = res.data.id!;
  const s = loadState(id);
  s.youtube = { videoId, publishAt };
  saveState(s);
  markStage(id, 'publish', { info: { videoId, publishAt } });
  return videoId;
}

/** Sube cualquier MP4 al canal (lo usa el Clipper). Sin fecha queda en privado. */
export async function uploadFile(file: string, m: { title: string; description?: string; tags?: string[]; at?: string; public?: boolean }, onProgress?: (pct: number) => void) {
  const youtube = google.youtube({ version: 'v3', auth: await auth() });
  const size = Math.max(1, fs.statSync(file).size);
  const publishAt = m.at ? new Date(m.at).toISOString() : undefined;
  if (publishAt && new Date(publishAt) <= new Date()) throw new Error('La fecha de publicacion debe ser futura');
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: m.title.slice(0, 100), description: m.description || '', tags: m.tags || [], categoryId: '20', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
      status: { privacyStatus: m.public && !publishAt ? 'public' : 'private', publishAt, selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(file) },
  }, { onUploadProgress: (e: { bytesRead: number }) => onProgress?.(Math.min(99, Math.round((e.bytesRead / size) * 100))) });
  return res.data.id!;
}

/** Vistas actuales de una lista de videos del canal. */
export async function videoViews(ids: string[]) {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const youtube = google.youtube({ version: 'v3', auth: await auth() });
  for (let i = 0; i < ids.length; i += 50) {
    const res = await youtube.videos.list({ part: ['statistics'], id: ids.slice(i, i + 50) });
    for (const v of res.data.items || []) out.set(v.id!, Number(v.statistics?.viewCount || 0));
  }
  return out;
}

/** Descarga vistas, me gusta y comentarios de todos los videos publicados. */
export async function pullMetrics() {
  const runs = listRuns().map(loadState).filter((s) => s.youtube);
  if (!runs.length) return [];
  const youtube = google.youtube({ version: 'v3', auth: await auth() });
  const rows: any[] = [];
  for (let i = 0; i < runs.length; i += 50) {
    const batch = runs.slice(i, i + 50);
    const res = await youtube.videos.list({ part: ['statistics', 'status'], id: batch.map((s) => s.youtube!.videoId) });
    for (const v of res.data.items || []) {
      const s = batch.find((b) => b.youtube!.videoId === v.id)!;
      rows.push({
        id: s.id, videoId: v.id, estado: v.status?.privacyStatus,
        vistas: Number(v.statistics?.viewCount || 0), likes: Number(v.statistics?.likeCount || 0),
        comentarios: Number(v.statistics?.commentCount || 0),
      });
    }
  }
  const file = path.join(ROOT, 'public/runs/metrics.jsonl');
  fs.appendFileSync(file, rows.map((r) => JSON.stringify({ at: new Date().toISOString(), ...r })).join('\n') + '\n');
  return rows;
}
