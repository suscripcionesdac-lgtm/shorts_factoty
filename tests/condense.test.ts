import { describe, expect, it } from 'vitest';
import { condense } from '../src/clips/analysis/condense';

/** Frases de 3 s seguidas (con 0,3 s entre una y otra) a partir de textos. */
const phr = (texts: string[]) => texts.map((text, n) => ({ i: n + 1, a: n * 3.3, b: n * 3.3 + 3, text }));
const texts = ['bueno pues hoy vamos a jugar', 'estaba tranquilo en la partida', 'y de repente me salta uno', '¡no puede ser! jajaja', 'en fin seguimos', 'ahora toca farmear un rato', 'me compro la espada', 'y otra vez el mismo tio', '¡pero que hace este! jajaja', 'bueno ya esta'];
const energy = (n: number, loudAt: number[]) => Array.from({ length: n }, (_, s) => (loudAt.includes(s) ? 3 : 0));

describe('condensar un tramo largo', () => {
  it('se queda con los momentos fuertes y su preparacion, en orden y cerca de la duracion pedida', () => {
    const ph = phr(texts);
    const r = condense({ phrases: ph, energyZ: energy(34, [10, 11, 27, 28]), target: 12 });
    const kept = r.picked.map((p) => p.i);
    expect(kept).toEqual([...kept].sort((a, b) => a - b)); // en orden
    expect(kept).toContain(4); // el primer remate
    expect(kept).toContain(9); // el segundo
    expect(kept).toContain(3); // la preparacion del primero
    expect(r.picked.find((p) => p.i === 3)?.setup).toBe(true);
    const total = r.segments.reduce((t, s) => t + s.b - s.a, 0);
    expect(total).toBeGreaterThan(12 * 0.85);
    expect(total).toBeLessThan(12 * 1.35); // con el aire de cada frase
  });
  it('frases pegadas van en un solo tramo (sin saltos innecesarios)', () => {
    const r = condense({ phrases: phr(texts), energyZ: energy(34, [10, 11]), target: 6 });
    expect(r.segments).toHaveLength(1);
  });
  it('lo que elige el agente manda si suma una duracion razonable; si no, se ignora', () => {
    const ph = phr(texts);
    expect(condense({ phrases: ph, energyZ: energy(34, []), target: 9, prefer: [2, 3, 4] }).picked.map((p) => p.i)).toEqual([2, 3, 4]);
    expect(condense({ phrases: ph, energyZ: energy(34, [27]), target: 9, prefer: [1] }).picked.map((p) => p.i)).not.toEqual([1]);
  });
});
