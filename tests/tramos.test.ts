import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FFMPEG } from '../src/clips/media/ff';
import { buildArgs, renderSpec } from '../src/clips/media/fast';
import { defaultTemplate, normalizeSegments, sanitize } from '../src/clips/media/spec';
import { totalOut } from '../src/clips/web/segtime.js';

// Exporta de verdad y mira los fotogramas: que al reves, espejo, congelar y velocidad salgan en el video, no solo en el editor.
const base = defaultTemplate(1920, 1080, 'x');
let dir = '', src = '';
const durationOf = (file: string) => { const m = String(spawnSync(FFMPEG, ['-hide_banner', '-i', file]).stderr).match(/Duration: (\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN; };
/** Fotograma en gris de 32x32 en el segundo t. */
const frame = (file: string, t: number) => spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=32:32,format=gray', '-f', 'rawvideo', '-']).stdout as Buffer;
const diff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const flipH = (a: Buffer) => { const o = Buffer.alloc(a.length); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) o[y * 32 + x] = a[y * 32 + 31 - x]; return o; };
async function render(name: string, segments: any[], extra: any = {}) {
  const out = path.join(dir, name);
  fs.mkdirSync(out, { recursive: true });
  const spec = sanitize({ sid: 'x', start: 0, end: 20, captions: { ...base.captions, on: false }, segments, ...extra }, base);
  const total = await renderSpec({ spec, file: src, outDir: out, srcW: 1920, srcH: 1080, fast: true });
  return { file: path.join(out, 'clip.mp4'), total };
}

beforeAll(() => {
  // Dentro del proyecto, como los clips de verdad (la ruta de las fuentes es relativa y no puede cambiar de unidad).
  fs.mkdirSync('test-results', { recursive: true });
  dir = path.resolve(fs.mkdtempSync(path.join('test-results', 'tramos-')));
  src = path.join(dir, 'in.mp4');
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=20', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('tramos: velocidad, curva, al reves, congelado, espejo y giro', () => {
  it('se guardan solo valores validos y los tramos iguales y pegados se unen', () => {
    const s = normalizeSegments([{ a: 0, b: 5, speed: 9 } as any, { a: 5, b: 8, speed: 4 } as any, { a: 8, b: 10, rot: 450, flip: 'x', curve: 'nada', hold: 50 } as any], 20);
    expect(s).toEqual([{ a: 0, b: 8, speed: 4 }, { a: 8, b: 10, rot: 90, hold: 10 }]);
  });
  it('al reves: el principio del tramo sale al final', async () => {
    const n = await render('normal', [{ a: 6, b: 10 }]), r = await render('reves', [{ a: 6, b: 10, rev: true }]);
    expect(Math.abs(durationOf(r.file) - 4)).toBeLessThan(0.15);
    const back = frame(r.file, 0.5);
    expect(diff(back, frame(n.file, 3.5)), 'el segundo 0,5 al reves es el 3,5 normal').toBeLessThan(diff(back, frame(n.file, 0.5)) / 3);
  }, 120_000);
  it('espejo: la imagen sale volteada; y congelar deja quieto el ultimo fotograma', async () => {
    const n = path.join(dir, 'normal', 'clip.mp4');
    const m = await render('espejo', [{ a: 6, b: 10, flip: 'h' }]);
    const fm = frame(m.file, 1), fn = frame(n, 1);
    expect(diff(fm, flipH(fn)), 'coincide con el normal volteado').toBeLessThan(diff(fm, fn) / 3);
    const h = await render('congelar', [{ a: 6, b: 10, hold: 1.5 }]);
    expect(Math.abs(durationOf(h.file) - 5.5)).toBeLessThan(0.15);
    expect(diff(frame(h.file, 4.4), frame(h.file, 5.2)), 'quieto').toBeLessThan(1);
  }, 120_000);
  it('variacion: espejo, zoom 2% y x1.015 en el video exportado', async () => {
    const n = path.join(dir, 'normal', 'clip.mp4');
    const v = await render('variacion', [{ a: 6, b: 10 }], { vary: true });
    expect(v.total).toBeCloseTo(4 / 1.015, 3);
    expect(Math.abs(durationOf(v.file) - 4 / 1.015)).toBeLessThan(0.15);
    const fv = frame(v.file, 1), fn = frame(n, 1.015);
    expect(diff(fv, flipH(fn)), 'coincide con el normal volteado').toBeLessThan(diff(fv, fn) / 2);
  }, 120_000);
  it('velocidad fija y en curva, giro y todo junto: dura lo calculado', async () => {
    const segs = [{ a: 0, b: 4, speed: 2 }, { a: 6, b: 10, rev: true, hold: 1 }, { a: 12, b: 16, curve: 'rampa', flip: 'h', rot: 90 }];
    const r = await render('todo', segs);
    expect(r.total).toBeCloseTo(totalOut(segs as any), 3);
    expect(Math.abs(durationOf(r.file) - r.total)).toBeLessThan(0.2);
    // El giro y el espejo van en el grafo, solo en su tramo.
    const g = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 20, segments: segs }, base), file: 'in.mp4', outDir: dir, srcW: 1920, srcH: 1080 }).args.join(' ');
    expect(g).toContain("hflip=enable='between(t,12.000,16.000)'");
    expect(g).toMatch(/rotate=1\.571:c=black:enable='between\(t,12\.000,16\.000\)'/);
  }, 120_000);
});
