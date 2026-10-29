import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FFMPEG } from '../src/clips/media/ff';
import { buildArgs, concatArgs, renderSpec } from '../src/clips/media/fast';
import { defaultTemplate, sanitize } from '../src/clips/media/spec';
import { TRANSITIONS, xfadeGraph } from '../src/clips/media/transitions';

const base = defaultTemplate(1920, 1080, 'x');
const graphOf = (extra: any, hookAt?: number) => {
  const r = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 30, ...extra }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080, hookAt });
  return { ...r, graph: r.args[r.args.indexOf('-filter_complex') + 1] };
};
/** Duracion real de un video (segundos), leida de FFmpeg. */
const durationOf = (file: string) => {
  const m = String(spawnSync(FFMPEG, ['-hide_banner', '-i', file]).stderr).match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
};

describe('transiciones', () => {
  it('el catalogo tiene todas las familias y nombres unicos', () => {
    expect(TRANSITIONS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(TRANSITIONS.map((t) => t.id)).size).toBe(TRANSITIONS.length);
    expect(new Set(TRANSITIONS.map((t) => t.cat))).toEqual(new Set(['Básico', 'Deslizar', 'Máscara', 'Cámara', 'Desenfocar', 'Luz', 'Falla', 'Distorsión', 'Superposición'].filter((c) => TRANSITIONS.some((t) => t.cat === c))));
  });
  it('descarta transiciones que no existen y limita la duracion', () => {
    const s = sanitize({ sid: 'x', start: 0, end: 30, transition: 'nada', transDur: 9, transCuts: true }, base);
    expect(s.transition).toBe('');
    expect(s.transCuts).toBe(false);
    expect(sanitize({ sid: 'x', start: 0, end: 30, transition: 'smoke', transDur: 9 }, base).transDur).toBe(1.2);
  });
  it('sin transicion el gancho se pega con un corte seco, como antes', () => {
    const { graph, total } = graphOf({ hook: true, segments: [{ a: 0, b: 10 }, { a: 15, b: 30 }] }, 8);
    expect(total).toBeCloseTo(25 + 2.8, 3);
    expect(graph).toContain('concat=n=2:v=1:a=1');
    expect(graph).not.toContain('xfade');
  });
  it('con transicion el gancho se funde con el clip y la duracion baja lo que se solapa', () => {
    const { graph, total } = graphOf({ hook: true, transition: 'flash', transDur: 0.4, segments: [{ a: 0, b: 10 }, { a: 15, b: 30 }] }, 8);
    expect(total).toBeCloseTo(25 + 2.8 - 0.4, 3);
    expect(graph).toContain('acrossfade=d=0.400');
    expect(graph).toContain("select='between(t,0.000,10.000)+between(t,15.000,30.000)'");
  });
  it('en cada corte: una union por corte y tramos cortos con transicion mas corta', () => {
    const { graph, total } = graphOf({ transition: 'fade', transDur: 0.5, transCuts: true, segments: [{ a: 0, b: 10 }, { a: 12, b: 20 }, { a: 22, b: 30 }] });
    expect(total).toBeCloseTo(26 - 2 * 0.5, 3);
    expect(graph.match(/xfade=transition=fade/g)).toHaveLength(2);
    expect(graph).not.toContain("select='");
    // Un tramo de 0,6 s no puede llevar una transicion de 0,5 s: se acorta a 0,6 / 2,2.
    const short = graphOf({ transition: 'fade', transDur: 0.5, transCuts: true, segments: [{ a: 0, b: 10 }, { a: 12, b: 12.6 }, { a: 22, b: 30 }] });
    expect(short.total).toBeCloseTo(18.6 - 2 * (0.6 / 2.2), 3);
  });
  it('en un corte concreto: solo ese se funde, los demas siguen en seco', () => {
    const segments = [{ a: 0, b: 10 }, { a: 12, b: 20 }, { a: 22, b: 30 }];
    const { graph, total } = graphOf({ transition: 'fade', transDur: 0.5, transAt: [22], segments });
    expect(graph.match(/xfade=transition=fade/g)).toHaveLength(1);
    expect(graph).toContain('[sv1][sa1]concat=n=2'); // el corte de 0:12 sigue en seco
    expect(total).toBeCloseTo(26 - 0.5, 3);
    // Un corte que ya no existe (se movio el tramo) no hace nada.
    expect(graphOf({ transition: 'fade', transDur: 0.5, transAt: [17], segments }).graph).not.toContain('xfade');
  });
  it('el montaje con transicion recodifica y suma las duraciones menos los solapes', () => {
    const { args, total } = concatArgs(['a.mp4', 'b.mp4', 'c.mp4'], [10, 12, 8], 'whip-left', 0.4);
    expect(total).toBeCloseTo(30 - 0.8, 3);
    expect(args).toContain('libx264');
  });

  it('todas las transiciones se renderizan con la duracion esperada', async () => {
    const run = (id: string, d: number) => new Promise<number>((resolve) => {
      const g = `[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];${xfadeGraph('a', 'b', 'v', id, d, 1.5)}`;
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-stats', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=1.5', '-f', 'lavfi', '-i', 'smptehdbars=s=1080x1920:r=30:d=1.5', '-filter_complex', g, '-map', '[v]', '-f', 'null', '-']);
      let err = '';
      p.stderr.on('data', (x) => (err += x));
      p.on('close', (code) => resolve(code === 0 ? +([...err.matchAll(/frame=\s*(\d+)/g)].pop()?.[1] ?? 0) : -1));
    });
    const queue = [...TRANSITIONS], bad: string[] = [];
    await Promise.all(Array.from({ length: Math.max(2, Math.min(6, os.cpus().length / 2)) }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const frames = await run(t.id, t.dur), want = Math.round((3 - t.dur) * 30);
        if (Math.abs(frames - want) > 2) bad.push(`${t.id}: ${frames}/${want} fotogramas`);
      }
    }));
    expect(bad).toEqual([]);
  }, 240_000);

  it('un clip real con gancho, cortes y humo se exporta y dura lo calculado', async () => {
    // Dentro del proyecto, como los clips de verdad: la ruta de las fuentes de los subtitulos es relativa y no puede cambiar de unidad.
    fs.mkdirSync('test-results', { recursive: true });
    const dir = path.resolve(fs.mkdtempSync(path.join('test-results', 'trans-')));
    const src = path.join(dir, 'in.mp4');
    spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=20', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
    const spec = sanitize({ sid: 'x', start: 0, end: 20, hook: true, transition: 'smoke', transDur: 0.5, transCuts: true, captions: { ...base.captions, on: false }, segments: [{ a: 0, b: 8 }, { a: 10, b: 20 }] }, base);
    const total = await renderSpec({ spec, file: src, outDir: dir, srcW: 1920, srcH: 1080, hookAt: 6, fast: true });
    expect(total).toBeCloseTo(18 + 2.8 - 2 * 0.5, 3);
    expect(Math.abs(durationOf(path.join(dir, 'clip.mp4')) - total)).toBeLessThan(0.15);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
