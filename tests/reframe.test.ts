import { describe, expect, it } from 'vitest';
import { followKeys, subjectTrack } from '../src/clips/media/reframe';

const face = (cx: number, size = 0.1, y = 0.3) => ({ x: cx - size / 2, y, w: size, h: size * 1.6 });
const W = 0.316; // recorte 9:16 de una imagen 16:9

describe('el recorte sigue a la persona', () => {
  it('sigue a la cara mas grande y no salta a otra por poco', () => {
    const tr = subjectTrack([
      { t: 0, faces: [face(0.3, 0.1), face(0.7, 0.08)] },
      { t: 1, faces: [face(0.31, 0.1), face(0.7, 0.11)] }, // la otra crece un poco: se sigue con la misma
      { t: 2, faces: [face(0.32, 0.1), face(0.7, 0.16)] }, // ahora claramente mayor: se cambia
    ]);
    expect(tr.map((x) => x!.toFixed(2))).toEqual(['0.30', '0.31', '0.70']);
  });
  it('si un instante no se ve a nadie, se queda donde estaba', () => {
    expect(subjectTrack([{ t: 0, faces: [face(0.4)] }, { t: 1, faces: [] }])).toEqual([0.4, 0.4]);
    expect(subjectTrack([{ t: 0, faces: [] }])).toEqual([null]);
  });
  it('se mueve cuando la persona sale de la franja central, y no tiembla por pasos pequeños', () => {
    const frames = [0.5, 0.505, 0.495, 0.51, 0.8, 0.8, 0.8].map((c, i) => ({ t: i * 1.5, faces: [face(c)] }));
    const k = followKeys(frames, W);
    expect(new Set(k.slice(0, 3).map((x) => x.x)).size, 'quieto mientras se mueve poco').toBe(1);
    expect(k[k.length - 1].x, 'al final la sigue a la derecha').toBeGreaterThan(0.85);
    expect(k.every((x) => x.x >= 0 && x.x <= 1)).toBe(true);
  });
});

describe('dos personas: una arriba y otra abajo', () => {
  const frames = (l: (i: number) => number, r: (i: number) => number, n = 12) => Array.from({ length: n }, (_, i) => ({ t: i, faces: [face(l(i), 0.08), face(r(i), 0.08)] }));
  it('dos personas quietas y separadas: un recuadro para cada una, con su cara dentro', async () => {
    const { twoShot } = await import('../src/clips/media/reframe');
    const two = twoShot(frames(() => 0.25, () => 0.75), 16 / 9)!;
    expect(two).not.toBeNull();
    const [l, r] = two;
    expect(l.x < 0.25 && l.x + l.w > 0.25, 'la de la izquierda dentro de su recuadro').toBe(true);
    expect(r.x < 0.75 && r.x + r.w > 0.75, 'la de la derecha dentro del suyo').toBe(true);
    expect((l.w * 16) / 9 / l.h, 'proporcion de media pantalla vertical (1080 x 960)').toBeCloseTo(1080 / 960, 1);
  });
  it('no apila si se mueven mucho, si caben juntas en un recorte o si casi siempre hay una sola', async () => {
    const { twoShot } = await import('../src/clips/media/reframe');
    expect(twoShot(frames((i) => 0.1 + i * 0.03, () => 0.75), 16 / 9), 'se mueve').toBeNull();
    expect(twoShot(frames(() => 0.45, () => 0.55), 16 / 9), 'juntas').toBeNull();
    expect(twoShot(Array.from({ length: 12 }, (_, i) => ({ t: i, faces: i < 3 ? [face(0.25), face(0.75)] : [face(0.25)] })), 16 / 9), 'una sola').toBeNull();
  });
});

describe('¿cámara en la mano o webcam fija?', () => {
  it('una webcam no se mueve de su sitio; con la cámara en la mano, sí', async () => {
    const { handheld } = await import('../src/clips/media/reframe');
    const at = (cx: number, cy: number) => ({ x: cx - 0.05, y: cy - 0.08, w: 0.1, h: 0.16 });
    const still = Array.from({ length: 10 }, (_, i) => ({ t: i, faces: [at(0.8 + (i % 2) * 0.01, 0.2)] }));
    const moving = Array.from({ length: 10 }, (_, i) => ({ t: i, faces: [at(0.3 + i * 0.03, 0.4 + (i % 3) * 0.04)] }));
    expect(handheld(still), 'webcam').toBe(false);
    expect(handheld(moving), 'IRL').toBe(true);
    expect(handheld(Array.from({ length: 10 }, (_, i) => ({ t: i, faces: [] }))), 'sin caras no se sabe').toBe(false);
  });
});
