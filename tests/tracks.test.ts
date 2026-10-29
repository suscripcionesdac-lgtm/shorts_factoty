import { describe, expect, it } from 'vitest';
import { buildArgs } from '../src/clips/media/fast';
import { defaultTemplate, sanitize } from '../src/clips/media/spec';

const base = defaultTemplate(1920, 1080, 'x');
const render = (extra: any) => {
  const r = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 20, ...extra }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
  return { ...r, graph: r.args[r.args.indexOf('-filter_complex') + 1], args: r.args.join(' ') };
};
const items = {
  texts: [{ id: 't1', text: 'HOLA', x: 0.5, y: 0.5, size: 80, color: '#FFFFFF', box: false, a: 1, b: 3 }],
  sfx: [{ id: 'f1', file: 'pop.wav', t: 2, vol: 1 }],
};

describe('pistas ocultas, silenciadas y bloqueadas', () => {
  it('sin cambios en las pistas, todo sale', () => {
    const r = render(items);
    expect(r.ass).toContain('HOLA');
    expect(r.args).toContain('pop.wav');
    expect(r.graph).not.toMatch(/stereo[^[]*volume=0[,[]/);
  });
  it('lo de una pista oculta o silenciada no sale en el video, pero sigue guardado', () => {
    const spec = sanitize({ sid: 'x', start: 0, end: 20, ...items, tracks: { txt: { hide: true }, sfx: { mute: true }, video: { mute: true } } }, base);
    expect(spec.texts).toHaveLength(1); // no se pierde: al volver a mostrar la pista, esta ahi
    const r = render({ ...items, tracks: { txt: { hide: true }, sfx: { mute: true }, video: { mute: true } } });
    expect(r.ass).not.toContain('HOLA');
    expect(r.args).not.toContain('pop.wav');
    expect(r.graph).toMatch(/\[0:a\][^;]*volume=0/); // el sonido original, en silencio
  });
  it('solo se guardan pistas y opciones conocidas', () => {
    const s = sanitize({ sid: 'x', start: 0, end: 20, tracks: { txt: { hide: 1, x: 2 }, nada: { hide: true }, stk: {} } as any }, base);
    expect(s.tracks).toEqual({ txt: { hide: true, mute: false, lock: false } });
  });
  it('los marcadores se limpian y no se cuelan cosas raras', () => {
    const s = sanitize({ sid: 'x', start: 0, end: 20, markers: [{ id: 'm', t: 4.5, label: 'Grito', color: '#ff0000' }, { t: 'x' }, { t: 2, color: 'rojo', label: 'x'.repeat(80) }] as any }, base);
    expect(s.markers).toHaveLength(2);
    expect(s.markers![0]).toEqual({ id: 'm', t: 4.5, label: 'Grito', color: '#ff0000' });
    expect(s.markers![1].color).toBe('#FFB23E');
    expect(s.markers![1].label.length).toBe(40);
  });
});
