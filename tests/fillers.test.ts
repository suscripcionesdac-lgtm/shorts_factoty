import { describe, expect, it } from 'vitest';
import { cutFillers, findFillers } from '../src/clips/analysis/fillers';

/** Palabras con tiempos: [segundo de inicio, texto]; cada palabra dura 0,25 s. */
const at = (...p: [number, string][]) => p.map(([t, text]) => ({ text, startMs: Math.round(t * 1000), endMs: Math.round((t + 0.25) * 1000) }));
const seq = (t0: number, s: string) => s.split(' ').map((w, i) => [t0 + i * 0.3, w] as [number, string]);

describe('muletillas y repeticiones', () => {
  it('quita los sonidos de duda siempre', () => {
    const c = findFillers(at(...seq(0, 'y entonces'), [0.7, 'eh,'], ...seq(1.0, 'fuimos al super'), [2.0, 'Mmm.']));
    expect(c.map((x) => [x.kind, x.text])).toEqual([['muletilla', 'eh,'], ['muletilla', 'Mmm.']]);
    expect(c[0].a).toBeCloseTo(0.7);
    expect(c[0].b).toBeCloseTo(1.0); // hasta que empieza la siguiente palabra: tambien se va su pausa
  });
  it('las muletillas con significado solo se quitan sueltas', () => {
    // «este juego» y «pues claro» son frase; «...este...» suelto entre pausas es una duda.
    const c = findFillers(at(...seq(0, 'este juego mola pues claro'), [2.5, 'este'], ...seq(3.2, 'no se que decir'), [5, 'o'], [5.3, 'sea'], ...seq(6, 'me encanta')));
    expect(c.map((x) => x.text)).toEqual(['este', 'o sea']);
  });
  it('quita tartamudeos y arranques en falso, no el enfasis', () => {
    const c = findFillers(at(...seq(0, 'que que paso es que es que vamos no no no')));
    expect(c.map((x) => [x.kind, x.text])).toEqual([['repeticion', 'que'], ['repeticion', 'es que']]);
    expect(findFillers(at(...seq(0, 'si si claro vamos vamos jaja jaja'))).length).toBe(0);
  });
  it('una repeticion con una pausa larga en medio ya es otra frase', () => {
    expect(findFillers(at([0, 'hola'], [3, 'hola'])).length).toBe(0);
  });
});

describe('cortar sin perder voz', () => {
  it('quita la muletilla del tramo', () => {
    const r = cutFillers([{ a: 0, b: 10 }], [{ a: 4, b: 4.5, kind: 'muletilla', text: 'eh' }]);
    expect(r.segments).toEqual([{ a: 0, b: 4 }, { a: 4.5, b: 10 }]);
    expect(r.applied).toHaveLength(1);
  });
  it('no corta si dejaria un trozo diminuto, y lo ya quitado no cuenta', () => {
    const r = cutFillers([{ a: 0, b: 5 }, { a: 7, b: 10 }], [
      { a: 0.2, b: 0.5, kind: 'muletilla', text: 'eh' }, // dejaria 0,2 s sueltos al principio
      { a: 5.5, b: 6, kind: 'muletilla', text: 'em' }, // cae en un silencio ya quitado
      { a: 7, b: 7.4, kind: 'repeticion', text: 'que' }, // al borde: no deja trozo a la izquierda
    ]);
    expect(r.segments).toEqual([{ a: 0, b: 5 }, { a: 7.4, b: 10 }]);
    expect(r.applied.map((c) => c.text)).toEqual(['que']);
  });
});

describe('lo que vimos en transcripciones reales', () => {
  it('«¿eh?» de pregunta y el «ah» de una reaccion se quedan', () => {
    expect(findFillers(at(...seq(0, 'que locura,'), [0.7, '¿eh?'], ...seq(1.2, 'debo regresar')))).toEqual([]);
    expect(findFillers(at([0, 'Ah,'], ...seq(0.3, 'no pusieron el beso')))).toEqual([]);
  });
  it('un arranque en falso con una palabra en medio', () => {
    const c = findFillers(at(...seq(0, 'llevo una racha que'), [1.2, '...'], ...seq(2.6, 'Llevo una racha complicada.')));
    expect(c.map((x) => [x.kind, x.text])).toEqual([['repeticion', 'llevo una racha que']]);
    expect(c[0].b).toBeCloseTo(1.45); // como mucho 0,3 s de la pausa: el resto lo deciden los silencios
  });
});
