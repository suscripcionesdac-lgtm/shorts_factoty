import { describe, expect, it } from 'vitest';
import { musicEntry } from '../src/clips/media/music';

/** Volumen cada 50 ms: `quiet` s flojos y luego fuerte (con un golpe al entrar). */
const track = (quiet: number, loudSecs = 20) => [...Array(Math.round(quiet / 0.05)).fill(0.02), 0.9, ...Array(Math.round(loudSecs / 0.05)).fill(0.6)];

describe('musica que entra a ritmo', () => {
  it('se salta la intro floja y entra en el golpe', () => {
    expect(musicEntry(track(6.4))).toBeCloseTo(6.4, 1);
  });
  it('si la pista empieza fuerte, desde el principio', () => {
    expect(musicEntry(track(0))).toBe(0);
  });
  it('pistas raras: muy cortas, en silencio o con una intro de mas de 30 s', () => {
    expect(musicEntry([0.1, 0.2])).toBe(0);
    expect(musicEntry(Array(400).fill(0))).toBe(0);
    expect(musicEntry(track(40))).toBe(0);
  });
});
