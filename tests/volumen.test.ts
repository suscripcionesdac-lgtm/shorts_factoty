import { describe, expect, it } from 'vitest';
import { buildArgs } from '../src/clips/media/fast';
import { defaultTemplate, sanitize } from '../src/clips/media/spec';

const base = defaultTemplate(1920, 1080, 'x');
const graph = (extra: object) => buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 20, ...extra }, base), file: 'in.mp4', outDir: 'test-results', srcW: 1920, srcH: 1080 }).args.join(' ');

describe('volumen del video', () => {
  it('el volumen elegido se aplica al sonido original', () => {
    expect(graph({ volume: 0.5 })).toMatch(/\[0:a\][^;]*volume=0\.500/);
    expect(graph({ volume: 1.5 })).toMatch(/\[0:a\][^;]*volume=1\.500/);
  });
  it('al 100 % no se añade nada, y se limita entre 0 y 200 %', () => {
    expect(graph({ volume: 1 })).not.toMatch(/\[0:a\][^;]*volume=1\.000/);
    expect(sanitize({ sid: 'x', start: 0, end: 20, volume: 9 } as any, base).volume).toBe(2);
    expect(sanitize({ sid: 'x', start: 0, end: 20, volume: 0 } as any, base).volume).toBe(0);
    expect(sanitize({ sid: 'x', start: 0, end: 20 } as any, base).volume).toBe(1);
  });
});
