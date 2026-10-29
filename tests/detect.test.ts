import { describe, expect, it } from 'vitest';
import { findPeaks, heuristicScore, windowFor, zscores } from '../src/clips/analysis/detect';

// Directo sintetico: voz normal a -30 dB con dos gritos y un silencio.
const stream = () => {
  const db = Array.from({ length: 600 }, (_, i) => -30 + Math.sin(i / 7) * 1.5);
  for (let i = 198; i < 204; i++) db[i] = -12;
  for (let i = 448; i < 453; i++) db[i] = -9;
  for (let i = 300; i < 320; i++) db[i] = -80;
  return db;
};

describe('deteccion de momentos', () => {
  it('encuentra los dos gritos y nada mas', () => {
    const peaks = findPeaks(stream());
    expect(peaks).toHaveLength(2);
    expect(Math.abs(peaks[0].t - 201)).toBeLessThanOrEqual(2);
    expect(Math.abs(peaks[1].t - 450)).toBeLessThanOrEqual(2);
  });
  it('el silencio no cuenta como pico ni distorsiona la referencia', () => {
    const z = zscores(stream());
    expect(z[310]).toBeLessThan(0);
    expect(Math.abs(z[100])).toBeLessThan(2);
  });
  it('separa los picos cercanos', () => {
    const db = stream();
    for (let i = 215; i < 219; i++) db[i] = -11;
    expect(findPeaks(db, { minGap: 45 })).toHaveLength(2);
  });
  it('la ventana empieza antes del pico y respeta los limites', () => {
    expect(windowFor(100, 600)).toEqual({ start: 72, end: 112 });
    expect(windowFor(10, 600).start).toBe(0);
    expect(windowFor(595, 600).end).toBe(600);
  });
  it('las reacciones habladas suben la puntuacion', () => {
    const plain = heuristicScore(2, 'vamos a revisar el inventario ahora', 40).score;
    const hype = heuristicScore(2, 'nooo no puede ser jajaja que locura bro!', 40).score;
    expect(hype).toBeGreaterThan(plain);
  });
});

import { newPeaks } from '../src/clips/analysis/detect';
describe('momentos estables entre analisis', () => {
  const old = [{ peak: 100, start: 72, end: 112 }, { peak: 400, start: 372, end: 412 }];
  it('un pico cerca de un momento existente, o dentro de su tramo, no crea otro', () => {
    expect(newPeaks(old, [{ t: 108, z: 3 }, { t: 80, z: 2 }, { t: 395, z: 4 }])).toEqual([]);
  });
  it('un pico en otra parte si es nuevo, y lo anterior no depende de seguir entre los picos', () => {
    expect(newPeaks(old, [{ t: 250, z: 3 }])).toEqual([{ t: 250, z: 3 }]);
    expect(newPeaks(old, [])).toEqual([]);
  });
});
