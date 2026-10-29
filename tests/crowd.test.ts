import { describe, expect, it } from 'vitest';
import { clipCrowd } from '../src/clips/analysis/detect';

describe('cuántas personas clipearon cada momento', () => {
  const span = (end: number, len = 30) => ({ a: end - len, b: end });
  it('un momento que clipea mucha gente sale con su número de personas y su tramo típico', () => {
    const spans = [...Array.from({ length: 12 }, (_, i) => span(600 + (i % 5), 30 + (i % 3) * 10)), span(2000)];
    const [m] = clipCrowd(spans, 3600, { min: 5, gap: 60 });
    expect(m.n).toBe(12);
    expect(m.t > 570 && m.t < 605).toBe(true);
    expect(m.a < m.t && m.b > m.t, 'el tramo cubre el pico').toBe(true);
  });
  it('un clip suelto no es un momento', () => {
    expect(clipCrowd([span(1000)], 3600, { min: 2, gap: 60 })).toEqual([]);
  });
  it('dos momentos separados salen los dos, en orden', () => {
    const spans = [...Array.from({ length: 6 }, () => span(500)), ...Array.from({ length: 9 }, () => span(1500))];
    expect(clipCrowd(spans, 3600, { min: 5, gap: 60 }).map((m) => m.n)).toEqual([6, 9]);
  });
});
