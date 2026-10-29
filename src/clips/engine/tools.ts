/** Herramientas externas (yt-dlp) y recursos disponibles (stickers, sonidos, musica). */
import path from 'node:path';
import { PUBLIC, ROOT } from '../../shared/fs';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hasVision, llmName } from '../ai/llm';
import { asrError, asrModel } from '../ai/transcribe';
import { faceError } from '../ai/faces';
import { hasSubirTikTok, subirTikTokReady } from '../publish/subirtiktok';
import { autoStickerItems, BAD_WORDS, type CapWord, PLATFORMS } from '../media/spec';
import { TRANSITIONS } from '../media/transitions';
import { settings } from './core';

// ---------- herramientas ----------
const TOOLS = path.join(ROOT, 'tools');
const localYtdlp = path.join(TOOLS, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
export let YTDLP = process.env.YTDLP_PATH || (fs.existsSync(localYtdlp) ? localYtdlp : 'yt-dlp');
let ytdlpOk: boolean | null = null;
export function hasYtdlp() {
  // El de tools/ basta con que exista: arrancarlo para ver la version bloquea el servidor un segundo.
  if (ytdlpOk === null) ytdlpOk = (YTDLP === localYtdlp && fs.existsSync(localYtdlp)) || spawnSync(YTDLP, ['--version']).status === 0;
  return ytdlpOk;
}
/** Si yt-dlp no esta instalado, se descarga solo a la carpeta tools/ (una vez). */
export async function ensureYtdlp(onProgress: (t: string) => void = () => {}) {
  if (hasYtdlp()) return;
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
  onProgress('instalando el descargador (solo la primera vez)');
  const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`);
  if (!res.ok) throw new Error(`No pude descargar yt-dlp (${res.status}). Instálalo a mano: winget install yt-dlp`);
  fs.mkdirSync(TOOLS, { recursive: true });
  fs.writeFileSync(localYtdlp, Buffer.from(await res.arrayBuffer()));
  fs.chmodSync(localYtdlp, 0o755);
  YTDLP = localYtdlp;
  ytdlpOk = null;
  if (spawnSync(YTDLP, ['--version']).status !== 0) throw new Error('yt-dlp se descargó pero no arranca. Instálalo a mano: winget install yt-dlp');
}
export const hasYoutube = () => fs.existsSync(path.join(ROOT, process.env.YOUTUBE_CLIENT_SECRET_FILE || 'secrets/client_secret.json'));
export const tools = () => ({ ytdlp: hasYtdlp(), ia: llmName(), vision: hasVision(), voz: asrError(), vozModelo: asrModel(), caras: faceError(), youtube: hasYoutube(), tiktokUploader: hasSubirTikTok(), tiktokReady: hasSubirTikTok() && subirTikTokReady(settings.tiktokAccount || '') });

const listDir = (d: string, re: RegExp) => (fs.existsSync(path.join(PUBLIC, d)) ? fs.readdirSync(path.join(PUBLIC, d)).filter((f) => re.test(f) && !f.startsWith('_')).sort() : []);
/** Stickers, efectos de sonido y musica disponibles. Puedes anadir los tuyos en public/stickers, public/sfx y public/music. */
export const assets = () => ({ stickers: listDir('stickers', /\.png$/i), sfx: listDir('sfx', /\.(wav|mp3)$/i), music: listDir('music', /\.(mp3|wav|m4a|ogg)$/i), bad: BAD_WORDS, platforms: PLATFORMS, transitions: TRANSITIONS.map(({ id, name, cat, dur }) => ({ id, name, cat, dur })) });
export const autoStickers = (words: CapWord[], dur: number) => autoStickerItems(words || [], +dur || 0, assets().stickers);
