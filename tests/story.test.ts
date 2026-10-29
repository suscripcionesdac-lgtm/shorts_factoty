import { describe, expect, it } from 'vitest';
import { STORY, fit, mergeStories, snapToPhrases, storyContext, storyWindow } from '../src/clips/analysis/story';
import { makeHearing, uncovered } from '../src/clips/ai/hearing';

// Frases de 4 s separadas por 1 s de pausa: 1) 100-104, 2) 105-109, ... 20) 195-199.
const ph = Array.from({ length: 20 }, (_, i) => ({ i: i + 1, a: 100 + i * 5, b: 104 + i * 5, text: `frase ${i + 1}` }));

describe('cortar por historias', () => {
  it('el momento va de 30 s antes del pico a 15 s despues, y se escucha con margen, sin salirse del directo', () => {
    expect(storyWindow(150, 1000)).toEqual({ start: 120, end: 165 });
    expect(storyContext(150, 1000)).toEqual({ start: 115, end: 170 });
    expect(storyWindow(20, 30)).toEqual({ start: 0, end: 30 });
  });
  it('el corte cae al principio y al final de frases completas', () => {
    // 117 cae dentro de la frase 4 (115-119): empieza en 115; 141 cae en la 9 (140-144): acaba en 144 (+1 s de remate).
    expect(snapToPhrases(ph, 117, 141, 130)).toEqual({ start: 115, end: 145 });
  });
  it('dura entre 15 y 90 s y nunca pierde el pico', () => {
    const long = fit(0, 200, 190);
    expect(long.end - long.start).toBe(STORY.max);
    expect(long.start <= 190 && long.end >= 190).toBe(true);
    const short = fit(100, 104, 102);
    expect(short.end - short.start).toBe(STORY.min);
    const early = fit(0, 200, 20);
    expect(early.start <= 20 && early.end >= 20, 'el pico al principio').toBe(true);
  });
  it('tres momentos de la misma historia se quedan en uno, con el tramo de todos', () => {
    // Como en la prueba con OpusClip: su clip de 90 s eran varios momentos de Clipper que, ya alargados, casi coinciden.
    const list = [
      { id: 'a', start: 255, end: 300, score: 10 },
      { id: 'b', start: 250, end: 295, score: 9 },
      { id: 'c', start: 262, end: 310, score: 8 },
      { id: 'otro', start: 400, end: 430, score: 7 },
    ];
    const drop = mergeStories(list).map((x) => x.id);
    expect(drop.sort()).toEqual(['b', 'c']);
    expect(list[0]).toMatchObject({ start: 250, end: 310 });
    expect(list[3]).toMatchObject({ start: 400, end: 430 });
  });
  it('si juntos pasan de 90 s, se queda el mejor con su tramo', () => {
    const list = [{ id: 'a', start: 0, end: 60, score: 9 }, { id: 'b', start: 20, end: 110, score: 5 }];
    expect(mergeStories(list).map((x) => x.id)).toEqual(['b']);
    expect(list[0]).toMatchObject({ start: 0, end: 60 });
  });
});

describe('escuchar cada trozo del directo una sola vez', () => {
  it('sabe que partes faltan', () => {
    expect(uncovered([], 10, 20)).toEqual([{ start: 10, end: 20 }]);
    expect(uncovered([{ start: 12, end: 15 }, { start: 18, end: 30 }], 10, 20)).toEqual([{ start: 10, end: 12 }, { start: 15, end: 18 }]);
    expect(uncovered([{ start: 0, end: 50 }], 10, 20)).toEqual([]);
  });
  it('dos momentos que se solapan no transcriben dos veces lo mismo, ni duplican palabras', async () => {
    const calls: [number, number][] = [];
    // Reconocimiento de voz falso: una palabra por segundo, con tiempos absolutos.
    const hear = makeHearing(async (a, d) => {
      calls.push([a, d]);
      return Array.from({ length: Math.floor(d) }, (_, i) => ({ text: `w${Math.floor(a) + i}`, startMs: (Math.floor(a) + i) * 1000 + 100, endMs: (Math.floor(a) + i) * 1000 + 700 }));
    });
    const w1 = await hear(100, 155);
    const w2 = await hear(130, 185);
    expect(calls).toEqual([[99, 57], [154, 32]]);
    expect(w1).toHaveLength(55);
    expect(w2.map((w) => w.text)).toEqual(Array.from({ length: 55 }, (_, i) => `w${130 + i}`));
  });
});

describe('«Hacer los clips solo»: cuántos', async () => {
  const { pickClips, autoClipsCap } = await import('../src/clips/analysis/story');
  const mom = (i: number, score: number, start = i * 100) => ({ id: 'm' + i, start, end: start + 40, score });
  it('como mucho uno cada 5 minutos, y al menos 3', () => {
    expect(autoClipsCap(30 * 60)).toBe(6);
    expect(autoClipsCap(4 * 3600)).toBe(48);
    expect(autoClipsCap(10 * 60)).toBe(3);
  });
  it('los de nota 8 o más, sin pasar del tope (en un directo donde casi todo pasa de 8)', () => {
    const list = Array.from({ length: 40 }, (_, i) => mom(i, 9.9 - i * 0.02));
    expect(pickClips(list, 20 * 60)).toHaveLength(4);
  });
  it('si casi nada llega a 8, se completa hasta 3 con los mejores', () => {
    const got = pickClips([mom(0, 8.5), mom(1, 5), mom(2, 6), mom(3, 4)], 60 * 60);
    expect(got.map((c) => c.id)).toEqual(['m0', 'm2', 'm1']);
  });
  it('no hace dos clips del mismo rato', () => {
    const got = pickClips([mom(0, 9.5, 100), mom(1, 9.4, 110), mom(2, 9, 500)], 30 * 60);
    expect(got.map((c) => c.id), 'm1 pisa a m0: fuera, aunque falte uno para llegar a 3').toEqual(['m0', 'm2']);
  });
});
