import { spawn } from 'node:child_process';
import { FFMPEG } from '../media/ff';

/**
 * Luz y color automaticos (como el «智能调色/补光» de CapCut): se mide el brillo, el contraste y la saturacion de unos
 * fotogramas del clip y se corrige hacia una imagen clara y con algo de color, sin pasarse. Solo funciones de medida
 * y una regla pura (probada en tests/look.test.ts).
 */
export type LookStats = { y: number; low: number; high: number; sat: number };
export type Color = { brightness: number; contrast: number; saturation: number };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Correccion para unos fotogramas medidos (brillo medio y extremos 0..255, saturacion media 0..~180). */
export function autoColor(frames: LookStats[]): { color: Color; needed: boolean; why: string[] } {
  // Sin medidas no se toca nada.
  if (!frames.length) return { color: { brightness: 0, contrast: 1, saturation: 1 }, needed: false, why: [] };
  const n = frames.length, avg = (k: keyof LookStats) => frames.reduce((t, f) => t + f[k], 0) / n;
  const y = avg('y'), range = avg('high') - avg('low'), sat = avg('sat');
  const why: string[] = [];
  // Brillo hacia ~120 (ni oscuro ni lavado); solo si se aparta de verdad.
  let brightness = 0;
  if (y < 95) { brightness = clamp(((120 - y) / 255) * 0.9, 0, 0.18); why.push('estaba oscuro'); }
  else if (y > 170) { brightness = clamp(((140 - y) / 255) * 0.8, -0.12, 0); why.push('estaba quemado'); }
  // Contraste si la imagen se ve plana (poca diferencia entre lo mas oscuro y lo mas claro).
  let contrast = 1;
  if (range < 150) { contrast = clamp(1 + (150 - range) / 400, 1, 1.25); why.push('se veía plano'); }
  // Color: un poco mas vivo si esta apagado; algo menos si esta saturado de mas.
  let saturation = 1;
  if (sat < 35) { saturation = clamp(1 + (35 - sat) / 60, 1, 1.35); why.push('tenía poco color'); }
  else if (sat > 95) { saturation = 0.92; why.push('tenía el color saturado'); }
  const color = { brightness: r2(brightness), contrast: r2(contrast), saturation: r2(saturation) };
  return { color, needed: Math.abs(color.brightness) >= 0.03 || Math.abs(color.contrast - 1) >= 0.05 || Math.abs(color.saturation - 1) >= 0.06, why };
}

/** Mide `n` fotogramas repartidos por el tramo (rapido: imagenes pequeñas). */
export function measureLook(file: string, start: number, dur: number, n = 6): Promise<LookStats[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-ss', String(start), '-t', String(dur), '-i', file, '-an', '-vf', `fps=${(n / Math.max(1, dur)).toFixed(4)},scale=320:-2,signalstats,metadata=print`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const out: LookStats[] = [];
    let cur: Partial<LookStats> = {}, part = '';
    const num = (l: string, k: string) => { const i = l.indexOf('lavfi.signalstats.' + k + '='); return i < 0 ? null : parseFloat(l.slice(i + 19 + k.length)); };
    p.stderr.on('data', (d) => {
      const ls = (part + d).split('\n'); part = ls.pop() || '';
      for (const l of ls) {
        const y = num(l, 'YAVG'), lo = num(l, 'YLOW'), hi = num(l, 'YHIGH'), s = num(l, 'SATAVG');
        if (y != null) cur.y = y; if (lo != null) cur.low = lo; if (hi != null) cur.high = hi;
        if (s != null) { cur.sat = s; if (cur.y != null && cur.low != null && cur.high != null) out.push(cur as LookStats); cur = {}; }
      }
    });
    p.on('error', reject);
    p.on('close', () => resolve(out));
  });
}
