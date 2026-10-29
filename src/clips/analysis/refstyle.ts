import { spawn } from 'node:child_process';
import { FFMPEG } from '../media/ff';

/**
 * Estilo de edicion medido en un video de referencia (un short que funciona): ritmo de cortes, cuantos cambios son
 * transiciones, zooms (acercamientos y zooms de golpe) y volumen. Se miden patrones, no se copia nada del video.
 */
export type StyleSample = {
  seconds: number;
  /** Cambios de plano por minuto y duracion mediana de un plano (s). */
  cutsPerMin: number; shotMed: number;
  /** Parte de los cambios de plano que son transiciones (no cortes secos), 0..1. */
  transRatio: number;
  /** Zooms por minuto (acercamientos y zooms de golpe) y cuanto acercan (mediana). */
  zoomsPerMin: number; zoomScale: number;
  /** Volumen integrado (LUFS). */
  lufs: number | null;
};
export type StyleProfile = StyleSample & { n: number; /** Parte de las referencias que estan editadas (con cortes). */ edited: number };

const GW = 96, GH = 170; // fotogramas pequeños en gris: suficiente para ritmo y zooms, y muy rapido
/** Ejecuta FFmpeg; `onLine` recibe cada linea de su salida de texto (asi no se pierde nada en videos largos). */
function ff(args: string[], onOut?: (d: Buffer) => void, onLine?: (l: string) => void) {
  return new Promise<string>((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', onOut ? 'pipe' : 'ignore', 'pipe'] });
    let err = '', part = '';
    if (onOut) p.stdout!.on('data', onOut);
    p.stderr!.on('data', (d) => {
      err = (err + d).slice(-20_000);
      if (!onLine) return;
      const ls = (part + d).split('\n');
      part = ls.pop() || '';
      for (const l of ls) onLine(l);
    });
    p.on('error', reject);
    p.on('close', () => resolve(err));
  });
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Diferencia media entre el fotograma b y el a ampliado s veces desde el centro (solo la zona central, que siempre existe). */
function scaledDiff(a: Uint8Array, b: Uint8Array, s: number) {
  let sum = 0, n = 0;
  for (let y = Math.floor(GH * 0.2); y < GH * 0.8; y += 2) for (let x = Math.floor(GW * 0.2); x < GW * 0.8; x += 2) {
    const ax = Math.round(GW / 2 + (x - GW / 2) / s), ay = Math.round(GH / 2 + (y - GH / 2) / s);
    sum += Math.abs(a[ay * GW + ax] - b[y * GW + x]); n++;
  }
  return sum / n;
}
const SCALES = [1.06, 1.12, 1.2, 1.3, 1.45];
/** Cuanto se acerca b respecto de a (1 si no hay zoom claro). */
export function zoomBetween(a: Uint8Array, b: Uint8Array) {
  const base = scaledDiff(a, b, 1);
  let best = 1, bestD = base;
  for (const s of SCALES) { const d = scaledDiff(a, b, s); if (d < bestD) (bestD = d), (best = s); }
  // Solo cuenta si el zoom explica claramente el cambio y la imagen es la misma (no otro plano).
  return best > 1 && bestD < base * 0.7 && bestD < 18 ? best : 1;
}

/**
 * Zoom de golpe en un corte: el plano nuevo es un trozo ampliado del anterior (normalmente la cara), en cualquier
 * sitio del cuadro. Se busca la escala y la posicion que mejor lo explican. Devuelve la escala, o 1 si no lo es.
 */
export function punchBetween(a: Uint8Array, b: Uint8Array) {
  const diff = (s: number, cx: number, cy: number) => {
    let sum = 0, n = 0;
    for (let y = 4; y < GH - 4; y += 4) for (let x = 4; x < GW - 4; x += 4) {
      const ax = Math.round(cx + (x - GW / 2) / s), ay = Math.round(cy + (y - GH / 2) / s);
      if (ax < 0 || ay < 0 || ax >= GW || ay >= GH) return Infinity;
      sum += Math.abs(a[ay * GW + ax] - b[y * GW + x]); n++;
    }
    return sum / n;
  };
  const base = diff(1, GW / 2, GH / 2);
  let best = 1, bestD = base;
  for (const s of [1.3, 1.6, 2, 2.5]) for (let cy = GH / (2 * s); cy <= GH - GH / (2 * s); cy += GH / 16) for (let cx = GW / (2 * s); cx <= GW - GW / (2 * s); cx += GW / 12) {
    const d = diff(s, cx, cy);
    if (d < bestD) (bestD = d), (best = s);
  }
  return best > 1 && bestD < base * 0.6 && bestD < 24 ? best : 1;
}

/** Lo que pasa en un video, con su instante: cambios de plano (cortes o transiciones) y zooms (de golpe o progresivos). */
export type StyleEvents = { seconds: number; changes: { t: number; gradual: boolean }[]; zooms: { t: number; s: number; punch: boolean }[]; lufs: number | null };

/** Mide el estilo de un video. `fps` de muestreo para los zooms. */
export async function measureStyle(file: string, fps = 6): Promise<StyleSample> {
  return summarizeStyle(await measureEvents(file, fps));
}

/** Mide cuando corta, cuando hace zoom y cuanto, y el volumen. */
export async function measureEvents(file: string, fps = 6): Promise<StyleEvents> {
  // 1) Cambios de plano: puntuacion de escena de cada fotograma.
  const score: [number, number][] = [];
  let t = 0;
  await ff(['-hide_banner', '-nostdin', '-i', file, '-an', '-vf', `scale=160:-2,select='gte(scene,0)',metadata=print`, '-f', 'null', '-'], undefined, (l) => {
    const m = l.match(/pts_time:([\d.]+)/); if (m) t = +m[1];
    const s = l.match(/scene_score=([\d.]+)/); if (s) score.push([t, +s[1]]);
  });
  const seconds = score.length ? score[score.length - 1][0] : 0;
  const changes: { t: number; gradual: boolean }[] = [];
  score.forEach(([ts, v], i) => {
    if (v < 0.3 || (changes.length && ts - changes[changes.length - 1].t < 0.4)) return;
    let act = 0;
    for (let k = Math.max(0, i - 8); k <= Math.min(score.length - 1, i + 8); k++) if (k !== i && score[k][1] > 0.06) act++;
    changes.push({ t: ts, gradual: act >= 5 });
  });
  // 2) Zooms: fotogramas pequeños en gris, comparando cada uno con el anterior (dentro del plano y en los cortes).
  const size = GW * GH, frames: Uint8Array[] = [];
  let buf = Buffer.alloc(0);
  await ff(['-hide_banner', '-nostdin', '-i', file, '-an', '-vf', `fps=${fps},scale=${GW}:${GH}:force_original_aspect_ratio=increase,crop=${GW}:${GH},format=gray`, '-f', 'rawvideo', '-'], (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= size) { frames.push(new Uint8Array(buf.subarray(0, size))); buf = buf.subarray(size); }
  });
  const zooms: StyleEvents['zooms'] = [];
  // En cada corte seco: ¿el plano nuevo es un trozo ampliado del anterior? (el ultimo fotograma de antes contra el
  // primero de despues).
  for (const c of changes) {
    if (c.gradual) continue;
    const i = Math.round(c.t * fps), a = frames[i - 1], b = frames[i + 1];
    if (a && b) { const s = punchBetween(a, b); if (s > 1) zooms.push({ t: c.t, s, punch: true }); }
  }
  let inZoom = false;
  for (let i = 1; i < frames.length; i++) {
    const s = zoomBetween(frames[i - 1], frames[i]);
    if (s > 1 && !inZoom) zooms.push({ t: i / fps, s, punch: false });
    else if (s > 1 && inZoom) zooms[zooms.length - 1].s = Math.max(zooms[zooms.length - 1].s, s);
    inZoom = s > 1;
  }
  // 3) Volumen integrado.
  const lo = await ff(['-hide_banner', '-nostdin', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-']).catch(() => '');
  const lufs = [...lo.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  zooms.sort((a, b) => a.t - b.t);
  return { seconds, changes, zooms, lufs: lufs ? +lufs[1] : null };
}

/** Resume los sucesos de un video en su estilo: ritmo, transiciones, zooms y volumen. */
export function summarizeStyle({ seconds, changes, zooms, lufs }: StyleEvents): StyleSample {
  const bounds = [0, ...changes.map((c) => c.t), seconds], shots = bounds.slice(1).map((b, i) => b - bounds[i]).filter((x) => x > 0.05);
  const min = Math.max(1, seconds) / 60;
  return {
    seconds: Math.round(seconds),
    cutsPerMin: Math.round((changes.length / min) * 10) / 10,
    shotMed: Math.round(median(shots) * 10) / 10,
    transRatio: changes.length ? Math.round((changes.filter((c) => c.gradual).length / changes.length) * 100) / 100 : 0,
    zoomsPerMin: Math.round((zooms.length / min) * 10) / 10,
    zoomScale: zooms.length ? Math.round(median(zooms.map((z) => z.s)) * 100) / 100 : 1,
    lufs,
  };
}

/**
 * Perfil de estilo de varias referencias. Las frecuencias (zooms, transiciones) son la media de todas: con muchas
 * tomas sin editar la mediana daria cero aunque los editados los usen. El ritmo de cortes es la mediana de los
 * editados, y cuanto acercan los zooms, la mediana de los que tienen.
 */
export function styleProfile(list: StyleSample[]): StyleProfile | null {
  if (!list.length) return null;
  const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100;
  const mean = (k: 'zoomsPerMin' | 'transRatio') => list.reduce((s, x) => s + x[k], 0) / list.length;
  const edited = list.filter((x) => x.cutsPerMin > 0), zoomed = list.filter((x) => x.zoomsPerMin > 0), loud = list.map((x) => x.lufs).filter((v): v is number => v != null);
  return {
    n: list.length, edited: r2(edited.length / list.length), seconds: Math.round(median(list.map((x) => x.seconds))),
    cutsPerMin: r1(median(edited.map((x) => x.cutsPerMin))), shotMed: r1(median(edited.map((x) => x.shotMed))),
    transRatio: r2(mean('transRatio')), zoomsPerMin: r1(mean('zoomsPerMin')), zoomScale: zoomed.length ? r2(median(zoomed.map((x) => x.zoomScale))) : 1,
    lufs: loud.length ? r1(median(loud)) : null,
  };
}
