import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FFMPEG } from '../src/clips/media/ff';
import { measureStyle, punchBetween, styleProfile, zoomBetween, type StyleSample } from '../src/clips/analysis/refstyle';
import { direct, type DirectorInput } from '../src/clips/analysis/director';

const GW = 96, GH = 170;
/** Fotograma de prueba con formas y degradados (como una imagen real, con detalle en todas partes). */
const frame = (f: (x: number, y: number) => number) => { const a = new Uint8Array(GW * GH); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) a[y * GW + x] = Math.max(0, Math.min(255, Math.round(f(x, y)))); return a; };
const pic = (x: number, y: number) => 128 + 60 * Math.sin(x * 0.21) * Math.cos(y * 0.13) + 40 * Math.sin((x + y) * 0.07) + (Math.hypot(x - 30, y - 60) < 14 ? 50 : 0);
const sample = (o: Partial<StyleSample>): StyleSample => ({ seconds: 40, cutsPerMin: 10, shotMed: 3, transRatio: 0.1, zoomsPerMin: 2, zoomScale: 1.2, lufs: -16, ...o });

describe('estilo medido en videos de referencia', () => {
  it('reconoce un acercamiento desde el centro y uno de golpe a otra zona del cuadro', () => {
    const a = frame(pic);
    const zoomed = frame((x, y) => pic(GW / 2 + (x - GW / 2) / 1.2, GH / 2 + (y - GH / 2) / 1.2));
    expect(zoomBetween(a, zoomed)).toBeCloseTo(1.2, 1);
    // Zoom de golpe x2 hacia la parte alta izquierda (donde suele estar la cara de la camara).
    const punch = frame((x, y) => pic(30 + (x - GW / 2) / 2, 60 + (y - GH / 2) / 2));
    expect(punchBetween(a, punch)).toBe(2);
    // Otro plano sin relacion no es un zoom.
    const other = frame((x, y) => 128 + 70 * Math.cos(x * 0.5 + y * 0.31));
    expect(zoomBetween(a, other)).toBe(1);
    expect(punchBetween(a, other)).toBe(1);
  });
  it('el perfil no se deja arrastrar por las tomas sin editar', () => {
    const p = styleProfile([sample({ cutsPerMin: 12, shotMed: 2.5, zoomsPerMin: 3, zoomScale: 2.5 }), sample({ cutsPerMin: 8, shotMed: 4 }), sample({ cutsPerMin: 0, shotMed: 60, zoomsPerMin: 0, transRatio: 0 })])!;
    expect(p.edited).toBeCloseTo(0.67, 2);
    expect(p.shotMed).toBe(4);
    expect(p.cutsPerMin).toBe(12);
    expect(p.zoomsPerMin).toBeCloseTo((3 + 2 + 0) / 3, 1);
  });
  it('mide cortes y un zoom de golpe en un video real', () => {
    const dir = fs.mkdtempSync(path.join('test-results', 'style-'));
    const out = path.resolve(dir, 'ref.mp4');
    // Tres planos de 2 s: un patron, otro distinto y un zoom x2 del segundo (como un golpe a la cara).
    const g = "[0:v]trim=0:2,setpts=PTS-STARTPTS[a];[1:v]split[b0][b1];[b0]trim=0:2,setpts=PTS-STARTPTS[b];[b1]trim=2:4,setpts=PTS-STARTPTS,crop=iw/2:ih/2:iw/8:ih/8,scale=540:960[c];[a][b][c]concat=n=3:v=1[v]";
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'smptehdbars=s=540x960:r=30:d=2', '-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=30:d=4', '-filter_complex', g, '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', out]);
    return measureStyle(out).then((s) => {
      expect(s.seconds).toBeGreaterThanOrEqual(5);
      expect(s.cutsPerMin).toBeCloseTo(2 / (s.seconds / 60), 0);
      expect(s.zoomsPerMin).toBeGreaterThan(0);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }, 60_000);
});

describe('el director imita el estilo de las referencias', () => {
  const energyZ = Array(40).fill(0.2); for (const s of [5, 9, 13, 17, 21, 25, 29, 33]) energyZ[s] = 3.5;
  const base = (o: Partial<DirectorInput>): DirectorInput => ({ words: [], energyZ, dur: 40, react: null, multiCam: false, hook: true, sfx: [], styles: ['amarillo', 'impacto', 'neon', 'limpio'], seed: 'x', ...o });
  const calm = styleProfile([sample({ zoomsPerMin: 0.8, transRatio: 0.02, zoomScale: 2.5 })])!;
  it('con referencias de pocos zooms pone menos, y los fuertes son zooms de golpe', () => {
    const free = direct(base({})), styled = direct(base({ style: calm }));
    expect((styled.patch.zooms || []).length).toBeLessThan((free.patch.zooms || []).length);
    expect(Math.max(...(styled.patch.zooms || []).map((z) => z.scale))).toBeGreaterThan(1.6);
    expect(styled.done).toContain('estilo aprendido de 1 video');
  });
  it('si las referencias casi nunca usan transiciones, el gancho casi siempre corta en seco', () => {
    const withTrans = Array.from({ length: 40 }, (_, k) => direct(base({ style: calm, seed: 's' + k })).patch.transition).filter(Boolean).length;
    expect(withTrans).toBeLessThanOrEqual(12);
    expect(withTrans).toBeGreaterThan(0);
  });
});
