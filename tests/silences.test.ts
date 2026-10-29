import { describe, expect, it } from 'vitest';
import { pickSilences, segmentsFromSilences } from '../src/clips/media/spec';

/** Pausas de prueba en un clip de 40 s: [inicio, duracion]. */
const sil = (...l: [number, number][]) => l.map(([a, d]) => ({ a, b: a + d }));

describe('quitar silencios sin trocear el clip', () => {
  const many = sil([3, 0.8], [6, 1.2], [9, 0.9], [12, 2], [15, 0.7], [18, 1.5], [22, 1], [26, 0.75], [30, 1.8], [35, 1.1]);
  it('como mucho los cortes pedidos, quitando primero las pausas mas largas', () => {
    const p = pickSilences(many, 40, { maxCuts: 4, minSeg: 1.5 });
    expect(p).toHaveLength(4);
    expect(p.map((x) => +(x.b - x.a).toFixed(2)).sort()).toEqual([1.2, 1.5, 1.8, 2]);
  });
  it('nunca deja un trozo de menos del minimo entre dos cortes', () => {
    const close = sil([10, 1], [11.6, 1], [20, 1]);
    const segs = segmentsFromSilences(pickSilences(close, 40, { minSeg: 1.5 }), 40);
    expect(segs.every((g) => g.b - g.a >= 1.5)).toBe(true);
    expect(segs.length).toBe(3); // de las dos pausas pegadas solo se quita una
  });
  it('las pausas del principio y del final se recortan siempre (no son cortes)', () => {
    const p = pickSilences(sil([0, 2], [10, 1], [20, 1], [38, 2]), 40, { maxCuts: 1 });
    expect(p.map((x) => x.a)).toEqual([0, 10, 38]);
  });
  it('las pausas breves no se tocan', () => {
    expect(pickSilences(sil([10, 0.65], [20, 0.5]), 40, { minSil: 0.7 })).toEqual([]);
  });
  it('nunca quita mas de lo permitido, empezando por las pausas mas largas', () => {
    const p = pickSilences(sil([5, 3], [12, 2.5], [20, 2], [28, 1.5]), 40, { pad: 0.25, maxRemove: 5 });
    const kept = segmentsFromSilences(p, 40, 0.25).reduce((t, g) => t + g.b - g.a, 0);
    expect(40 - kept).toBeCloseTo(4.5, 2);
    expect(p.map((x) => x.a)).toEqual([5, 12]);
  });
  it('no toca las pausas dentro de una zona protegida (antes de la reaccion)', () => {
    const p = pickSilences(sil([8, 2], [18, 2]), 40, { protect: [{ a: 16, b: 22 }] });
    expect(p.map((x) => x.a)).toEqual([8]);
  });
  it('el margen deja respirar: con mas margen se quita menos de cada pausa', () => {
    const one = sil([10, 2]);
    const cut = (pad: number) => 40 - segmentsFromSilences(pickSilences(one, 40, { pad }), 40, pad).reduce((t, g) => t + g.b - g.a, 0);
    expect(cut(0.12)).toBeCloseTo(1.76, 2);
    expect(cut(0.25)).toBeCloseTo(1.5, 2);
  });
});
