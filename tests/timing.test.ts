import { describe, expect, it } from 'vitest';
import { buildTimeline, chunkWords, wordsFromAlignment, wordsProportional } from '../src/shared/timing';
import { Script } from '../src/shorts/types';
import { similarity } from '../src/shorts/stages/qa';

describe('tiempos', () => {
  it('reparte las palabras dentro de la frase sin huecos ni solapes', () => {
    const w = wordsProportional('Hola, esto es una prueba.', 1000, 2000);
    expect(w).toHaveLength(5);
    expect(w[0].startMs).toBe(1000);
    expect(w.at(-1)!.endMs).toBe(3000);
    for (let i = 1; i < w.length; i++) expect(w[i].startMs).toBe(w[i - 1].endMs);
  });
  it('convierte marcas por caracter en palabras', () => {
    const chars = [...'ya va'];
    const w = wordsFromAlignment({ chars, starts: [0, 0.1, 0.2, 0.3, 0.4], ends: [0.1, 0.2, 0.3, 0.4, 0.5] }, 500);
    expect(w).toEqual([{ text: 'ya', startMs: 500, endMs: 700 }, { text: 'va', startMs: 800, endMs: 1000 }]);
  });
  it('encadena las frases en la linea de tiempo', () => {
    const { slots, totalFrames } = buildTimeline([1, 2], 30, 0.2, 0.5);
    expect(slots[0]).toMatchObject({ startFrame: 0, durationFrames: 36 });
    expect(slots[1].startFrame).toBe(36);
    expect(totalFrames).toBe(36 + 66 + 15);
  });
  it('agrupa en bloques de hasta 3 palabras y corta en el punto', () => {
    const w = wordsProportional('Uno dos. Tres cuatro cinco seis', 0, 3000);
    expect(chunkWords(w).map((c) => c.map((x) => x.text).join(' '))).toEqual(['Uno dos.', 'Tres cuatro cinco', 'seis']);
  });
});

describe('guion', () => {
  const base = {
    format: 'guia', hook: 'h', title: 't', description: 'd',
    beats: [1, 2, 3].map(() => ({ narration: 'una frase', visual: { kind: 'card' } })),
  };
  it('acepta un guion minimo', () => expect(Script.safeParse(base).success).toBe(true));
  it('rechaza un hecho confirmado sin fuente', () => {
    const r = Script.safeParse({ ...base, claims: [{ id: 'c1', text: 'x', status: 'confirmado' }] });
    expect(r.success).toBe(false);
  });
  it('rechaza un clip sin archivo', () => {
    const beats = [...base.beats.slice(1), { narration: 'otra frase', visual: { kind: 'clip' } }];
    expect(Script.safeParse({ ...base, beats }).success).toBe(false);
  });
  it('detecta guiones casi iguales', () => {
    expect(similarity('Rockstar confirma fecha lanzamiento noviembre', 'rockstar confirma la fecha de lanzamiento en noviembre')).toBeGreaterThan(0.8);
    expect(similarity('Rockstar confirma fecha', 'comparacion mapas ciudades distintas')).toBe(0);
  });
});
