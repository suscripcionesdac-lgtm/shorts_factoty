import { spawn } from 'node:child_process';
import { FFMPEG } from '../media/ff';

/**
 * Cambio de imagen por segundo (0..1), mirando solo los fotogramas clave para que sea rapido.
 * Un salto grande suele ser una pantalla de muerte, de victoria, una explosion o un cambio de escena.
 */
export function sceneScores(file: string, from = 0): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-skip_frame', 'nokey', '-ss', String(from), '-i', file, '-an', '-fps_mode', 'passthrough',
      '-vf', "scale=160:90,select='gte(scene,0)',metadata=mode=print:file=-", '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const out: number[] = [];
    let buf = '', t = 0;
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const l of lines) {
        const pt = l.match(/pts_time:([\d.]+)/);
        if (pt) t = Math.floor(+pt[1]);
        const sc = l.match(/scene_score=([\d.]+)/);
        if (sc) { while (out.length <= t) out.push(0); out[t] = Math.max(out[t], +sc[1]); }
      }
    });
    p.on('error', reject);
    p.on('close', () => resolve(out));
  });
}

/** Puntuacion robusta del cambio de imagen: cuanto se sale cada segundo de lo normal en ese directo. */
export function sceneZ(scores: number[], length: number): number[] {
  const s = Array.from({ length }, (_, i) => scores[i] ?? 0);
  // Los fotogramas clave llegan cada 1-4 s: se reparte cada valor a sus vecinos.
  const spread = s.map((_, i) => Math.max(s[i], s[i - 1] ?? 0, s[i + 1] ?? 0));
  const nz = spread.filter((v) => v > 0).sort((a, b) => a - b);
  if (nz.length < 10) return s.map(() => 0);
  const med = nz[Math.floor(nz.length / 2)];
  const mad = nz.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[Math.floor(nz.length / 2)] || 0.02;
  return spread.map((v) => (v > 0 ? (v - med) / (1.4826 * mad) : 0));
}

/** Momentos en los que el chat pide un clip: varios mensajes con "clip" en pocos segundos. */
export function clipRequests(clip: number[], windowSec = 10, min = 3): number[] {
  const out: number[] = [];
  let lastHit = -999;
  for (let i = 0; i < clip.length; i++) {
    let sum = 0;
    for (let j = Math.max(0, i - windowSec + 1); j <= i; j++) sum += clip[j] || 0;
    if (sum >= min && i - lastHit > 45) { out.push(i); lastHit = i; }
  }
  return out;
}

// ---------- anuncios de Twitch ----------
// Mientras Twitch pone anuncios, la grabacion muestra su pantalla «Commercial break in progress»: un degradado que se
// mueve con el logo «twitch» fijo arriba. En el fotograma a 160x90 (gris), esos son los pixeles blancos de las letras
// y los oscuros de su contorno; en el directo normal casi nunca coinciden los dos a la vez.
const AD_WHITE = [1990, 2000, 2001, 2007, 2150, 2151, 2153, 2155, 2157, 2160, 2161, 2164, 2165, 2167, 2168, 2169, 2310, 2313, 2315, 2317, 2320, 2323, 2327, 2329, 2470, 2471, 2473, 2474, 2475, 2476, 2481, 2483, 2484, 2485, 2487, 2489];
const AD_DARK = [1831, 1845, 1846, 1848, 1992, 1994, 2003, 2311, 2312, 2322, 2325, 2328, 2488, 2637, 2640, 2643, 2648, 2791, 2792, 2793, 2794, 2795, 2796, 2797, 2798, 2799, 2800, 2801, 2802, 2803, 2804, 2805, 2806, 2807, 2808, 2809];
/** ¿Es este fotograma (160x90 gris) la pantalla de anuncios de Twitch? */
export function isAdFrame(g: Uint8Array) {
  const w = AD_WHITE.filter((k) => g[k] > 190).length / AD_WHITE.length, d = AD_DARK.filter((k) => g[k] < 70).length / AD_DARK.length;
  return w >= 0.85 && d >= 0.85;
}
/** 1 en cada segundo con anuncio (desde `from`), mirando solo los fotogramas clave para que sea rapido. */
export function adFlags(file: string, from = 0): Promise<number[]> {
  return new Promise((resolve, reject) => {
    // showinfo da el tiempo de cada fotograma (por stderr), en el mismo orden en que salen por stdout.
    const p = spawn(FFMPEG, ['-v', 'info', '-skip_frame', 'nokey', '-ss', String(from), '-i', file, '-an', '-fps_mode', 'passthrough', '-vf', 'scale=160:90,format=gray,showinfo', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const N = 160 * 90, times: number[] = [], flags: [number, boolean][] = [];
    let buf = Buffer.alloc(0), err = '';
    p.stderr.on('data', (d) => { err += d; const l = err.split('\n'); err = l.pop() || ''; for (const x of l) { const m = x.match(/pts_time:\s*([\d.]+)/); if (m) times.push(+m[1]); } });
    p.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= N) { flags.push([flags.length, isAdFrame(buf.subarray(0, N))]); buf = buf.subarray(N); }
    });
    p.on('error', reject);
    p.on('close', () => {
      const out: number[] = [];
      // Cada fotograma clave vale hasta el siguiente (llegan cada 1-4 s).
      flags.forEach(([i, ad]) => { const a = Math.floor(times[i] ?? i * 2), b = Math.floor(times[i + 1] ?? a + 2); while (out.length < b) out.push(0); if (ad) for (let t = a; t < b; t++) out[t] = 1; });
      resolve(out);
    });
  });
}
/** Tramos [inicio, fin] de anuncio, con un segundo de margen a cada lado (la transicion). */
export function adSpans(flags: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 0; t < flags.length; t++) {
    if (!flags[t]) continue;
    const a = t; while (t < flags.length && flags[t]) t++;
    out.push([Math.max(0, a - 1), t + 1]);
  }
  return out;
}
/**
 * El tramo [a, b] sin anuncios: si un anuncio lo pisa, se queda la parte limpia mas larga. null si lo que queda
 * es demasiado corto para ser un clip (menos de `min` segundos).
 */
export function withoutAds(a: number, b: number, spans: [number, number][], min = 8): { a: number; b: number } | null {
  const hit = spans.filter(([x, y]) => y > a && x < b);
  if (!hit.length) return { a, b };
  let best = { a, b: a }, cur = a;
  for (const [x, y] of [...hit].sort((p, q) => p[0] - q[0])) { if (Math.min(x, b) - cur > best.b - best.a) best = { a: cur, b: Math.min(x, b) }; cur = Math.max(cur, y); }
  if (b - cur > best.b - best.a) best = { a: cur, b };
  return best.b - best.a >= min ? best : null;
}
