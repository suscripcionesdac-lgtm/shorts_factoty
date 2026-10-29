import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FFMPEG } from '../src/clips/media/ff';
import { renderSpec } from '../src/clips/media/fast';
import { defaultTemplate, sanitize, sceneSpans } from '../src/clips/media/spec';
import { gridBoxes } from '../src/clips/web/place.js';

// Varios encuadres en un clip: cuando el directo cambia de escena, cada trozo se exporta con el suyo.
const base = defaultTemplate(1920, 1080, 'x');
let dir = '', src = '';
const durationOf = (file: string) => { const m = String(spawnSync(FFMPEG, ['-hide_banner', '-i', file]).stderr).match(/Duration: (\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN; };
const frame = (file: string, t: number) => spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=32:32,format=gray', '-f', 'rawvideo', '-']).stdout as Buffer;
const diff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
async function render(name: string, extra: any) {
  const out = path.join(dir, name);
  fs.mkdirSync(out, { recursive: true });
  const spec = sanitize({ sid: 'x', start: 0, end: 20, captions: { ...base.captions, on: false }, layout: 'fit', ...extra }, base);
  await renderSpec({ spec, file: src, outDir: out, srcW: 1920, srcH: 1080, fast: true });
  return path.join(out, 'clip.mp4');
}

beforeAll(() => {
  fs.mkdirSync('test-results', { recursive: true });
  dir = path.resolve(fs.mkdtempSync(path.join('test-results', 'escenas-')));
  src = path.join(dir, 'in.mp4');
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=20', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('escenas: otro encuadre en una parte del clip', () => {
  it('cubre el clip entero sin huecos ni solapes', () => {
    expect(sceneSpans([{ a: 0.02, b: 5, layout: 'cam' }, { a: 4, b: 9, layout: 'duo' }], 20).map((x) => [x.a, x.b, x.sc?.layout])).toEqual([[0, 5, 'cam'], [5, 9, 'duo'], [9, 20, undefined]]);
    expect(sceneSpans(undefined, 20)).toEqual([{ a: 0, b: 20 }]);
  });
  it('el trozo de la escena sale con su encuadre y el resto igual; dura lo mismo', async () => {
    const cam = { x: 0, y: 0, w: 0.3, h: 0.3 };
    const plain = await render('plain', {});
    const mixed = await render('mixed', { scenes: [{ a: 8, b: 13, layout: 'cam', cam }, { a: 15, b: 18, layout: 'pip', cam }] });
    expect(Math.abs(durationOf(mixed) - 20)).toBeLessThan(0.15);
    expect(diff(frame(plain, 4), frame(mixed, 4))).toBeLessThan(6);
    expect(diff(frame(plain, 10.5), frame(mixed, 10.5))).toBeGreaterThan(15);
    expect(diff(frame(plain, 16.5), frame(mixed, 16.5))).toBeGreaterThan(8);
    expect(diff(frame(plain, 19.5), frame(mixed, 19.5))).toBeLessThan(6);
  }, 120_000);
  it('cuadricula: segun cuantas camaras, sin solaparse y dentro del video; y se exporta', async () => {
    for (let n = 2; n <= 12; n++) {
      const g = gridBoxes(n);
      expect(g.xy).toHaveLength(n);
      for (const [x, y] of g.xy) { expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0); expect(x + g.cw).toBeLessThanOrEqual(1080); expect(y + g.ch).toBeLessThanOrEqual(1920); }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const [a, b] = [g.xy[i], g.xy[j]]; expect(Math.abs(a[0] - b[0]) >= g.cw || Math.abs(a[1] - b[1]) >= g.ch).toBe(true); }
    }
    expect(gridBoxes(3).cw).toBe(1080); // hasta 3, una encima de otra
    expect(gridBoxes(8).cw).toBeLessThan(540); // 8: dos columnas
    expect(gridBoxes(10).cw).toBeLessThan(360); // 10: tres columnas
    const cams = [0, 1, 2, 3, 4].map((i) => ({ x: (i % 3) * 0.33, y: Math.floor(i / 3) * 0.5, w: 0.3, h: 0.45 }));
    const out = await render('grid', { layout: 'grid', cam: cams[0], cams });
    expect(Math.abs(durationOf(out) - 20)).toBeLessThan(0.15);
    expect(diff(frame(await render('plain3', {}), 5), frame(out, 5))).toBeGreaterThan(15);
  }, 120_000);
  it('fundido en el cambio de escena aunque caiga dentro de un tramo', async () => {
    const cam = { x: 0, y: 0, w: 0.3, h: 0.3 };
    const out = await render('fade', { scenes: [{ a: 10, b: 20, layout: 'cam', cam }], transition: 'fade', transDur: 0.4, transAt: [10] });
    // El fundido solapa 0,4 s: el clip dura eso menos, y antes y despues del cambio se ve cada encuadre.
    expect(Math.abs(durationOf(out) - 19.6)).toBeLessThan(0.15);
    const plain = await render('plain2', {});
    expect(diff(frame(plain, 5), frame(out, 5))).toBeLessThan(6);
    expect(diff(frame(plain, 15), frame(out, 15))).toBeGreaterThan(15);
  }, 120_000);
});
