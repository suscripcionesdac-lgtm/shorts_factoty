import { describe, expect, it } from 'vitest';
import { buildArgs, focusExpr } from '../src/clips/media/fast';
import { defaultTemplate, sanitize } from '../src/clips/media/spec';

// Lo que se edita en la vista previa (giro, opacidad, letra, capas, ocultar, foco del zoom, altura del titulo) sale igual en el video.
const base = defaultTemplate(1920, 1080, 'x');
const render = (extra: any) => {
  const r = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 20, ...extra }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
  return { ...r, graph: r.args[r.args.indexOf('-filter_complex') + 1] };
};
const txt = (o: any = {}) => ({ id: 't1', text: 'HOLA', x: 0.5, y: 0.5, size: 80, color: '#FFFFFF', box: false, a: 1, b: 3, ...o });
const stk = (o: any = {}) => ({ id: 's1', file: 'jaja.png', x: 0.5, y: 0.5, w: 0.3, a: 1, b: 3, ...o });

describe('capas editables en la vista previa', () => {
  it('texto girado, translucido y con otra letra', () => {
    const { ass } = render({ texts: [txt({ rot: 12, op: 0.5, font: 'Anton' })] });
    const line = ass.split('\n').find((l) => l.includes('HOLA'))!;
    expect(line).toContain('\\fnAnton');
    expect(line).toContain('\\frz-12'); // ASS gira al reves que CSS
    expect(line).toContain('\\alpha&H80&');
  });
  it('sin giro ni opacidad, el texto sale como siempre', () => {
    const line = render({ texts: [txt()] }).ass.split('\n').find((l) => l.includes('HOLA'))!;
    expect(line).not.toMatch(/\\frz|\\alpha|\\fn/);
  });
  it('una letra que no existe no se cuela', () => {
    const s = sanitize({ sid: 'x', start: 0, end: 20, texts: [txt({ font: 'Comic Sans' })] }, base);
    expect(s.texts[0].font).toBeUndefined();
  });
  it('lo oculto no sale, pero se guarda', () => {
    const spec = { texts: [txt({ hide: true }), txt({ id: 't2', text: 'ADIOS' })], stickers: [stk({ hide: true })] };
    expect(sanitize({ sid: 'x', start: 0, end: 20, ...spec }, base).texts).toHaveLength(2);
    const r = render(spec);
    expect(r.ass).not.toContain('HOLA');
    expect(r.ass).toContain('ADIOS');
    expect(r.args.join(' ')).not.toContain('jaja.png');
  });
  it('el orden de la lista es el de las capas: el ultimo, delante', () => {
    const { ass } = render({ texts: [txt({ text: 'ATRAS' }), txt({ id: 't2', text: 'DELANTE' })] });
    expect(ass.indexOf('ATRAS')).toBeLessThan(ass.indexOf('DELANTE'));
  });
  it('sticker girado y translucido, sin recortar las esquinas', () => {
    const { graph } = render({ stickers: [stk({ rot: 30, op: 0.6 })] });
    expect(graph).toMatch(/scale=\d+:-1,format=rgba,rotate=0\.524:c=none:ow=rotw\(0\.524\):oh=roth\(0\.524\),colorchannelmixer=aa=0\.600\[/);
  });
  it('el titulo a la altura elegida', () => {
    const { ass } = render({ title: 'MI TITULO', titleY: 900 });
    expect(ass).toMatch(/\\pos\(540,900\)\}MI TITULO/);
    expect(sanitize({ sid: 'x', start: 0, end: 20, titleY: 99999 }, base).titleY).toBe(1840);
  });
  it('el zoom acerca hacia el punto elegido y solo mientras dura', () => {
    const zooms = [{ id: 'z', a: 2, b: 4, scale: 1.4, fx: 0.8, fy: 0.2 }];
    expect(focusExpr(zooms, 'fx', 0.5)).toBe('0.500+0.300*between(it,2.000,4.000)');
    expect(focusExpr([{ id: 'z', a: 2, b: 4, scale: 1.4 }], 'fx', 0.5)).toBe('0.500');
    const { graph } = render({ layout: 'crop', zooms });
    expect(graph).toContain("x='(iw-iw/zoom)*(0.500+0.300*between(it,2.000,4.000))'");
    expect(graph).toContain("y='(ih-ih/zoom)*(0.380+-0.180*between(it,2.000,4.000))'");
  });
  it('giro y opacidad fuera de rango se limitan', () => {
    const s = sanitize({ sid: 'x', start: 0, end: 20, texts: [txt({ rot: 400, op: 7 })], zooms: [{ id: 'z', a: 1, b: 3, scale: 1.3, fx: 3, fy: -1 }] }, base);
    expect(s.texts[0].rot).toBe(180);
    expect(s.texts[0].op).toBe(1);
    expect([s.zooms[0].fx, s.zooms[0].fy]).toEqual([1, 0]);
  });
});
