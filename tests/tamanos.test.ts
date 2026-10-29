import { describe, expect, it } from 'vitest';
import { autoCapSize, buildAss, geometry } from '../src/clips/media/fast';
import { hookLines } from '../src/clips/web/place.js';
import { defaultTemplate } from '../src/clips/media/spec';

const base = defaultTemplate(1920, 1080, 'x'), cam = { x: 0.7, y: 0.7, w: 0.25, h: 0.25 };

describe('subtitulos y gancho del tamaño de OpusClip', () => {
  it('el gancho va en MAYUSCULAS y en lineas cortas', () => {
    expect(hookLines('¿Bailar con un robot en pleno directo?')).toEqual(['¿BAILAR CON UN', 'ROBOT EN PLENO', 'DIRECTO?']);
    expect(hookLines('hola')).toEqual(['HOLA']);
    expect(hookLines('supercalifragilisticoespialidoso corto'), 'una palabra larga va sola').toEqual(['SUPERCALIFRAGILISTICOESPIALIDOSO', 'CORTO']);
  });
  it('en el video exportado el gancho sale partido en esas lineas; el titulo fijo, como siempre', () => {
    const spec = { captions: { ...base.captions, on: false }, title: '¿Bailar con un robot en pleno directo?', credit: '', texts: [] };
    const title = (s: any) => buildAss(s, geometry('fit', 1920, 1080, cam), 30000).split('\n').find((l) => l.includes(',Title,'))!;
    expect(title({ ...spec, titleFor: 5 })).toContain(String.raw`¿BAILAR CON UN\NROBOT EN PLENO\NDIRECTO?`);
    expect(title(spec)).toContain('¿Bailar con un robot en pleno directo?');
  });
  it('la auto edicion pone los subtitulos grandes: mas en las letras estrechas', () => {
    expect(autoCapSize('impacto')).toBe(160); // Bebas Neue
    expect(autoCapSize('neon')).toBe(160); // Anton
    expect(autoCapSize('amarillo')).toBe(130); // Montserrat Black
    expect(autoCapSize('no-existe')).toBe(130);
  });
});
