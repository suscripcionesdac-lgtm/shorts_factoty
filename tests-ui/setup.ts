// Prepara un Clipper aislado para las pruebas en el navegador: carpeta temporal con datos vacios, un minuto de
// video y su propio servidor. Nunca toca data/, media/ ni los clips de la instalacion real.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

export const PORT = Number(process.env.CLIPPER_UI_PORT || 4399);
const ROOT = process.cwd();
const FF = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string);

/** Un video de prueba: el indicado en CLIPPER_TEST_VIDEO o una grabacion ya hecha con Clipper. */
function sourceVideo() {
  if (process.env.CLIPPER_TEST_VIDEO) return process.env.CLIPPER_TEST_VIDEO;
  const media = path.join(ROOT, 'media');
  const found: string[] = [];
  for (const d of fs.existsSync(media) ? fs.readdirSync(media) : []) {
    const f = fs.readdirSync(path.join(media, d)).find((x) => /^(live\.ts|source\.\w+)$/.test(x));
    if (f) found.push(path.join(media, d, f));
  }
  // Una grabacion que se esta escribiendo ahora (directo en curso) no sirve: recortarla da un trozo a medias.
  const done = found.find((f) => Date.now() - fs.statSync(f).mtimeMs > 120_000);
  if (done) return done;
  if (found.length) throw new Error('Solo hay grabaciones en curso (directos grabándose). Espera a que termine alguno, o indica un video con CLIPPER_TEST_VIDEO=ruta');
  throw new Error('Falta un video de prueba: graba o descarga algo con Clipper, o indica uno con CLIPPER_TEST_VIDEO=ruta');
}

/** Segundo de la grabacion donde Clipper ya encontro dos camaras o mas (cams.json o un momento analizado). */
function twoCamsAt(file: string): number | undefined {
  const read = (n: string) => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(file), n), 'utf8')); } catch { return null; } };
  const cams = read('cams.json'), meta = read('meta.json');
  if (cams?.cams?.length >= 2) return cams.at - 10;
  const c = (meta?.candidates || []).find((x: any) => x.face?.cams >= 2);
  return c ? c.start - 10 : undefined;
}

export default async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-ui-'));
  for (const d of ['src', 'node_modules', 'models', 'tools']) if (fs.existsSync(path.join(ROOT, d))) fs.symlinkSync(path.join(ROOT, d), path.join(tmp, d), 'junction');
  fs.cpSync(path.join(ROOT, 'public'), path.join(tmp, 'public'), { recursive: true, filter: (s) => !/[\\/]public[\\/](clips|runs)([\\/]|$)/.test(s) });
  fs.mkdirSync(path.join(tmp, 'data'));
  fs.mkdirSync(path.join(tmp, 'media'));
  // La escuela del agente con unos shorts ya estudiados (en las pruebas no se descarga nada).
  const studied = Array.from({ length: 8 }, (_, i) => ({
    id: 'p' + i, title: 'prueba ' + i, views: 200_000 * (i + 1), topic: i % 2 ? 'podcast' : 'entrevistas', at: '', mood: 'charla', wps: 2.5,
    style: { seconds: 35, cutsPerMin: 24, shotMed: 2.1, transRatio: 0.1, zoomsPerMin: 3, zoomScale: 1.3, lufs: -14 },
    hook: { text: '¿sabes lo que me paso ayer?', kind: 'pregunta', shot: 1.4 }, peaks: 3, peakZoom: 2, peakCut: 1, delays: [0.4], cuts: 6, cutPause: 5,
  }));
  fs.writeFileSync(path.join(tmp, 'data', 'school.json'), JSON.stringify({ cases: studied, tried: studied.map((c) => c.id), round: 0, day: '', today: 0 }));

  // Un minuto de video (sin recodificar: tarda menos de un segundo). Mejor donde ya se vieron dos camaras o mas,
  // para probarlas de verdad; si no se sabe, el centro del video.
  const src = sourceVideo();
  const dur = +(/Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(FF, ['-hide_banner', '-i', src], { encoding: 'utf8' }).stderr) || [0, 0, 0, 120]).slice(1).reduce((a, v) => a * 60 + +v, 0);
  const video = path.join(tmp, 'prueba.mp4');
  spawnSync(FF, ['-v', 'error', '-y', '-ss', String(Math.max(0, twoCamsAt(src) ?? dur / 2 - 30)), '-t', '60', '-i', src, '-c', 'copy', video]);
  if (!fs.existsSync(video)) throw new Error('No pude preparar el video de prueba a partir de ' + src);

  const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'src/clips/server.ts'], {
    cwd: tmp, env: { ...process.env, PORT: String(PORT), NO_OPEN: '1', CLIPPER_NO_AI: '1', YTDLP_PATH: path.join(ROOT, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp') }, // sin descargar yt-dlp en cada prueba stdio: ['ignore', fs.openSync(path.join(tmp, 'server.log'), 'w'), 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/api/state`).then((r) => r.ok, () => false)) break;
    if (i === 59) throw new Error(`El servidor de pruebas no arranco (puerto ${PORT} ocupado?). Registro: ${path.join(tmp, 'server.log')}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.env.CLIPPER_UI_VIDEO = video;

  return async () => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    else server.kill();
    // Primero los enlaces al proyecto, para que el borrado de la carpeta temporal nunca pueda entrar en ellos.
    for (const d of ['src', 'node_modules', 'models', 'tools']) { const p = path.join(tmp, d); if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(p); }
    if (['src', 'node_modules', 'models', 'tools'].some((d) => fs.existsSync(path.join(tmp, d)))) return console.warn('No borro ' + tmp + ': quedan enlaces al proyecto.');
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
  };
}
