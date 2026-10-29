import { describe, expect, it } from 'vitest';
import { atempo, pieces, segOut, toOut, toSrc, totalOut } from '../src/clips/web/segtime.js';

describe('tiempo de los tramos en el video final', () => {
  it('velocidad fija, congelado y al reves', () => {
    expect(segOut({ a: 0, b: 10 })).toBe(10);
    expect(segOut({ a: 0, b: 10, speed: 2 })).toBe(5);
    expect(segOut({ a: 0, b: 10, speed: 0.5, hold: 3 })).toBe(23);
    expect(totalOut([{ a: 0, b: 10, speed: 2 }, { a: 20, b: 30 }])).toBe(15);
    const segs = [{ a: 0, b: 10, speed: 2 }, { a: 20, b: 30, rev: true, hold: 2 }];
    expect(toOut(segs, 4)).toBe(2);
    expect(toOut(segs, 15)).toBe(5); // en lo quitado: donde empieza lo siguiente
    expect(toOut(segs, 21)).toBe(5 + 9); // al reves: el principio del tramo sale al final
    expect(toSrc(segs, 2)).toBe(4);
    expect(toSrc(segs, 5 + 9)).toBeCloseTo(21, 6);
    expect(toSrc(segs, 5 + 11)).toBe(20); // en la congelacion: el ultimo fotograma que se ve (al reves, el principio)
  });
  it('las curvas cambian la velocidad dentro del tramo y la ida y vuelta cuadra', () => {
    const s = { a: 0, b: 8, curve: 'rampa' };
    expect(pieces(s)).toHaveLength(8);
    expect(segOut(s)).toBeGreaterThan(8); // tiene una parte lenta
    for (const t of [0.5, 3, 4, 7.5]) expect(toSrc([s], toOut([s], t))).toBeCloseTo(t, 6);
    expect(segOut({ a: 0, b: 8, curve: 'subidon' })).not.toBe(8);
  });
  it('atempo encadena para velocidades fuera de 0,5–2', () => {
    expect(atempo(1.5)).toBe('atempo=1.5000');
    expect(atempo(4)).toBe('atempo=2.0000,atempo=2.0000');
    expect(atempo(0.25)).toBe('atempo=0.5000,atempo=0.5000');
  });
});
