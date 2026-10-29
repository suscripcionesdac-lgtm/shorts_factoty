/**
 * Subida a TikTok con la libreria tiktokautouploader (Python + Phantomwright). No tiene nada que ver
 * con ./tiktok.ts (que mira TikTok para aprender): esto publica clips en tu cuenta.
 * La primera vez por cuenta hay que conectarse: se abre una ventana del navegador, te logueas y las
 * cookies quedan en secrets/TK_cookies_<cuenta>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from '../../shared/fs';

const COOKIES = path.join(ROOT, 'secrets');
const SCRIPT = path.join(ROOT, 'tools', 'subirtiktok.py');
let installed: boolean | null = null;

function checkedAccount(account: string): string {
  const value = String(account || '').trim().replace(/^@/, '');
  if (!/^[a-z0-9._]{1,24}$/i.test(value)) throw new Error('Escribe un nombre de usuario de TikTok válido.');
  return value;
}

/** Busca python en Windows (python o py) y en el resto. */
function pythonCmd(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    for (const c of ['python', 'py']) {
      try {
        if (spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0) return { cmd: c, args: [] };
      } catch { /* sigue con el siguiente */ }
    }
    throw new Error('No encuentro Python. Instálalo desde https://python.org (marca "Add to PATH").');
  }
  return { cmd: 'python3', args: [] };
}

/** Si la libreria de Python esta instalada. */
export function hasSubirTikTok(): boolean {
  if (installed != null) return installed;
  try {
    const { cmd, args } = pythonCmd();
    installed = spawnSync(cmd, [...args, '-c', 'import tiktokautouploader, phantomwright'], { encoding: 'utf8' }).status === 0;
  } catch {
    installed = false;
  }
  return installed;
}

/** El motivo legible de un fallo: lo que explica el puente, luego el error de Python, y si no, el final de la salida. */
export function bridgeError(out: string): string {
  const lines = out.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const own = lines.filter((l) => /^TIKTOK_(DETALLE|ERROR):/.test(l)).map((l) => l.replace(/^TIKTOK_\w+:\s*/, ''));
  if (own.length) return own.join(' · ').slice(0, 300);
  const py = lines.filter((l) => /^[\w.]*(Error|Exception)\b.*:/.test(l)).pop();
  const what = lines.find((l) => /waiting for locator\(/.test(l));
  if (py) return [py.replace(/^[\w.]+\._errors\./, ''), what].filter(Boolean).join(' · ').slice(0, 300);
  return lines.slice(-2).join(' · ').slice(0, 300);
}

/** Corre tools/subirtiktok.py con un subcomando. Devuelve la salida; falla si el proceso falla o tarda mas de `ms`. */
function runBridge(a: string[], onLog: (m: string) => void = () => {}, ms = 30 * 60_000): Promise<string> {
  const { cmd, args } = pythonCmd();
  return new Promise((resolve, reject) => {
    // Sin PYTHONUNBUFFERED, Python guarda la salida hasta terminar y el progreso no llega ("en cola 0 %" toda la subida).
    let out = '';
    const p = spawn(cmd, [...args, SCRIPT, ...a], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } });
    // Un navegador colgado no puede bloquear para siempre la cola de TikTok (las siguientes subidas esperan detras).
    const limit = setTimeout(() => { out += `\nTIKTOK_ERROR: TikTok no terminó en ${Math.round(ms / 60_000)} minutos; se canceló. Vuelve a intentarlo.`; p.kill(); }, ms);
    p.on('close', () => clearTimeout(limit));
    // El registro guarda en que segundo llego cada linea: asi se ve que paso de la subida es el lento.
    const t0 = Date.now(); let timed = '';
    const take = (d: unknown) => { const s = String(d).trim(); if (!s) return; onLog(s.slice(0, 300)); out += d; timed += s.split(/\r?\n/).map((l) => `[${((Date.now() - t0) / 1000).toFixed(1)} s] ${l}`).join('\n') + '\n'; };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('close', (code) => {
      try { fs.mkdirSync(COOKIES, { recursive: true }); fs.writeFileSync(path.join(COOKIES, `tiktok-${a[0]}.log`), timed); } catch { /* el registro es solo ayuda */ }
      if (code === 0 && /OK\s*$/.test(out)) return resolve(out.trim());
      reject(new Error(bridgeError(out) || `El proceso terminó con código ${code}`));
    });
    p.on('error', (e) => reject(new Error(`No pude iniciar Python: ${e.message}`)));
  });
}

/** Instala la libreria (6.1 sin dependencias pesadas) y el navegador que usa. */
export async function installSubirTikTok(onLog: (m: string) => void = () => {}): Promise<void> {
  await runBridge(['install'], onLog);
  installed = null;
  if (!hasSubirTikTok()) throw new Error('La instalación terminó, pero Python no puede importar TikTokAutoUploader.');
}

/** Cuenta conectada: existe su archivo de cookies. */
export const subirTikTokReady = (account: string) => {
  try { return fs.existsSync(path.join(COOKIES, `TK_cookies_${checkedAccount(account)}.json`)); }
  catch { return false; }
};

/** Lanza el login de una cuenta: abre una ventana para entrar en TikTok y guarda las cookies en secrets/. */
export async function subirTikTokLogin(account: string, onLog: (m: string) => void = () => {}): Promise<void> {
  account = checkedAccount(account);
  if (!hasSubirTikTok()) throw new Error('La librería de TikTok no está instalada: pulsa «Instalar» primero.');
  fs.mkdirSync(COOKIES, { recursive: true });
  await runBridge(['login', '--account', account, '--dir', COOKIES], onLog);
  if (!subirTikTokReady(account)) throw new Error(`TikTok no guardó la sesión de ${account}. Vuelve a conectar la cuenta.`);
}

/** Comprueba la sesion sin publicar: abre la pagina de subida con las cookies guardadas. */
export async function checkTikTok(account: string): Promise<'ok' | 'caducada' | 'falta' | 'duda'> {
  account = checkedAccount(account);
  if (!hasSubirTikTok()) return 'falta';
  const out = await runBridge(['check', '--account', account, '--dir', COOKIES], undefined, 5 * 60_000);
  return (/TIKTOK_ESTADO:\s*(\w+)/.exec(out)?.[1] as any) || 'duda';
}

/** Sube (o programa) un video. Devuelve el texto de resultado. */
/** Etapas de la subida a TikTok segun lo que va diciendo el puente, con el porcentaje que representan. */
export const TIKTOK_STEPS: [RegExp, number, string][] = [
  [/Uploading to account/i, 10, 'abriendo TikTok'],
  [/Entered File/i, 30, 'subiendo el vídeo y poniendo la descripción'],
  [/Description and Hashtags added|TikTok sigue procesando/i, 55, 'TikTok procesa el vídeo'],
  [/done loading file onto servers/i, 75, 'pulsando «Publicar»'],
  [/Esperando a que TikTok termine/i, 85, 'TikTok revisa el contenido'],
  [/Done uploading|Confirmado/i, 99, 'publicando'],
];
export async function subirTikTok(o: { file: string; account: string; description: string; hashtags?: string[]; at?: string; day?: number; visibility?: string; onStep?: (pct: number, what: string) => void }): Promise<string> {
  o.account = checkedAccount(o.account);
  const visibility = o.visibility || 'everyone';
  if (!['everyone', 'friends', 'private'].includes(visibility)) throw new Error('La visibilidad de TikTok no es válida.');
  if (!hasSubirTikTok()) throw new Error('La librería de TikTok no está instalada: instálala en Ajustes.');
  if (!subirTikTokReady(o.account)) throw new Error(`Conecta primero la cuenta ${o.account} en Ajustes.`);
  const a = ['upload', '--video', o.file, '--account', o.account, '--desc', o.description, '--dir', COOKIES];
  if (o.hashtags?.length) a.push('--tags', o.hashtags.join(','));
  if (o.at) { a.push('--at', o.at); if (o.day) a.push('--day', String(o.day)); }
  a.push('--visibility', visibility);
  return runBridge(a, (m) => { for (const [re, pct, what] of TIKTOK_STEPS) if (re.test(m)) o.onStep?.(pct, what); });
}
