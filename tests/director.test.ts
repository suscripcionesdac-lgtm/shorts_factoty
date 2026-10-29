import { describe, expect, it } from 'vitest';
import { direct, readClip, type DirectorInput } from '../src/clips/analysis/director';
import { TRANSITIONS } from '../src/clips/media/transitions';

/** Palabras cada 0,4 s a partir de un texto; las que empiezan por * se dicen a partir del segundo indicado. */
const say = (text: string, from = 0) => text.split(' ').map((t, i) => ({ text: t, startMs: Math.round((from + i * 0.4) * 1000), endMs: Math.round((from + i * 0.4 + 0.35) * 1000) }));
const base = (over: Partial<DirectorInput>): DirectorInput => ({
  words: [], energyZ: Array(40).fill(0), dur: 40, react: null, multiCam: false, hook: true,
  sfx: ['boom.wav', 'ding.wav', 'pop.wav', 'riser.wav', 'whoosh.wav'], styles: ['amarillo', 'limpio', 'neon', 'caja', 'impacto', 'recuadro', 'cursiva'], seed: 'a', ...over,
});
const ids = new Set(TRANSITIONS.map((t) => t.id));

describe('director de la auto edicion', () => {
  it('reconoce un clip de risa y pone pops en las risas', () => {
    const words = [...say('mira lo que hizo este', 1), ...say('jajajaja', 6), ...say('no puede ser jajaja', 12), ...say('jajajaj xd', 20), ...say('jaja', 30)];
    const r = direct(base({ words, seed: 'risa' }));
    expect(r.read.mood).toBe('risa');
    expect(r.patch.sfx!.some((x) => x.file === 'pop.wav')).toBe(true);
    expect(r.patch.zooms!.length).toBeGreaterThanOrEqual(2);
  });
  it('un clip a gritos va a tope: subida y golpe en el pico y zooms fuertes', () => {
    const energyZ = Array(40).fill(0.2);
    energyZ[8] = 3.5; energyZ[19] = 4.2; energyZ[30] = 3;
    const r = direct(base({ energyZ, words: say('¡vamos! ¡dale! ¡gana!', 18), seed: 'hype' }));
    expect(r.read.mood).toBe('hype');
    const boom = r.patch.sfx!.find((x) => x.file === 'boom.wav')!, riser = r.patch.sfx!.find((x) => x.file === 'riser.wav')!;
    expect(boom.t).toBeGreaterThan(18.5);
    expect(boom.t - riser.t).toBeCloseTo(1.4, 1);
    expect(Math.max(...r.patch.zooms!.map((z) => z.scale))).toBeGreaterThanOrEqual(1.45);
    expect(r.patch.flash).toBe(false);
  });
  it('una charla tranquila lleva zooms suaves y largos, y pocos', () => {
    const words = say('bueno pues hoy os quiero contar una cosa que me paso el otro dia en el directo porque fue increible de verdad', 1);
    const r = direct(base({ words, seed: 'charla' }));
    expect(r.read.mood).toBe('charla');
    for (const z of r.patch.zooms || []) { expect(z.scale).toBeLessThanOrEqual(1.18); expect(z.b - z.a).toBeGreaterThanOrEqual(2.4); }
    expect(r.patch.transCuts).toBe(false);
  });
  it('los efectos respetan la separacion minima y no caen en lo cortado', () => {
    const energyZ = Array(40).fill(0); for (const s of [3, 5, 7, 9, 11, 13, 25, 27]) energyZ[s] = 3;
    const segments = [{ a: 0, b: 15 }, { a: 22, b: 40 }];
    const r = direct(base({ energyZ, segments, seed: 'gap' }));
    const starts = (r.patch.zooms || []).map((z) => z.a).sort((a, b) => a - b);
    for (let k = 1; k < starts.length; k++) expect(starts[k] - starts[k - 1]).toBeGreaterThanOrEqual(1.5);
    for (const x of [...(r.patch.zooms || []).map((z) => z.a + 0.12), ...(r.patch.sfx || []).map((s) => s.t)]) expect(x < 15 || x > 22).toBe(true);
  });
  it('la reaccion fuerte con varias camaras es un golpe a la cara que reacciona', () => {
    const r = direct(base({ react: { at: 12, react: 4, cam: 1 }, multiCam: true, seed: 'golpe' }));
    expect(r.patch.punches).toEqual([expect.objectContaining({ cam: 1, a: 11.7 })]);
  });
  it('cada clip sale distinto, el mismo clip siempre igual, y no repite el estilo del anterior', () => {
    const energyZ = Array(40).fill(0.2); energyZ[19] = 4;
    const looks = new Set(Array.from({ length: 12 }, (_, k) => { const r = direct(base({ energyZ, seed: 'clip' + k })); return `${r.patch.captions!.style}|${r.patch.transition}`; }));
    expect(looks.size).toBeGreaterThan(3);
    expect(direct(base({ energyZ, seed: 'x' })).patch).toEqual(direct(base({ energyZ, seed: 'x' })).patch);
    for (let k = 0; k < 10; k++) {
      const first = direct(base({ energyZ, seed: 's' + k })).patch;
      const next = direct(base({ energyZ, seed: 's' + k, last: { style: first.captions!.style, transition: first.transition } })).patch;
      expect(next.captions!.style).not.toBe(first.captions!.style);
    }
  });
  it('como mucho una transicion (la del gancho): nunca en cada corte ni destellos en cada cambio de camara', () => {
    for (let k = 0; k < 30; k++) {
      const energyZ = Array(40).fill(0.2); energyZ[(k * 7) % 40] = 4;
      const r = direct(base({ energyZ, hook: k % 2 === 0, segments: [{ a: 0, b: 8 }, { a: 10, b: 20 }, { a: 22, b: 40 }], seed: 'c' + k }));
      expect(r.patch.transCuts).toBe(false);
      expect(r.patch.flash).toBe(false);
      if (k % 2) expect(r.patch.transition).toBeUndefined();
    }
  });
  it('solo usa transiciones que existen', () => {
    for (let k = 0; k < 30; k++) {
      const energyZ = Array(40).fill(0); energyZ[(k * 7) % 40] = k % 3 ? 4 : 0;
      const r = direct(base({ energyZ, words: k % 2 ? say('jajaja jajaja', 5) : [], segments: k % 4 ? [{ a: 0, b: 10 }, { a: 12, b: 40 }] : undefined, seed: 't' + k }));
      if (r.patch.transition) expect(ids.has(r.patch.transition)).toBe(true);
    }
  });
  it('lee los momentos de enfasis sin amontonarlos', () => {
    const r = readClip({ words: say('no no no', 5), energyZ: [0, 0, 0, 0, 0, 3, 0], dur: 7, react: null });
    expect(r.beats.length).toBeLessThanOrEqual(2);
  });
});

describe('propuestas: la misma lectura, distinta intensidad', () => {
  it('la dinamica pone mas efectos que la equilibrada, y esta mas que la sobria', () => {
    const energyZ = Array(60).fill(0.2);
    for (const s of [5, 9, 14, 19, 24, 29, 33, 38, 43, 48, 53]) energyZ[s] = 2.5 + (s % 3) * 0.4;
    const words = [...say('jajaja no puede ser', 4), ...say('jajaja mira eso', 18), ...say('jajaja que fuerte', 32), ...say('jajaja otra vez', 47)];
    const fx = (k: number) => { const r = direct(base({ words, energyZ, dur: 60, seed: 'v', intensity: k })); return (r.patch.zooms?.length || 0) + (r.patch.punches?.length || 0) + (r.patch.sfx?.length || 0); };
    const [sobria, normal, dinamica] = [fx(0.4), fx(1), fx(1.8)];
    expect(dinamica).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(sobria);
    expect(sobria).toBeGreaterThanOrEqual(1); // sobria no es «nada»
  });
});
