import { describe, expect, it } from 'vitest';
import { AUTO_LEVELS, autoLevel, compareEdits, pickSilences, removedOf } from '../src/clips/media/spec';

const sil = (...l: [number, number][]) => l.map(([a, d]) => ({ a, b: a + d }));

describe('laboratorio de la auto edicion', () => {
  it('lo quitado se lee de los tramos que se conservan', () => {
    expect(removedOf([{ a: 1, b: 10 }, { a: 12, b: 20 }], 25)).toEqual([{ a: 0, b: 1 }, { a: 10, b: 12 }, { a: 20, b: 25 }]);
    expect(removedOf(null, 25)).toEqual([]);
  });
  it('dos ediciones iguales se parecen al 100 %', () => {
    const e = { segments: [{ a: 0, b: 10 }, { a: 12, b: 30 }], hook: true, layout: 'split', zooms: [{}, {}] as any, punches: [] as any };
    expect(compareEdits(e as any, e as any, 30).score).toBe(1);
  });
  it('si la auto edicion corta donde tu no, baja la nota de cortes y dice cuanto quita cada uno', () => {
    const mine = { segments: [{ a: 0, b: 10 }, { a: 12, b: 30 }], layout: 'split' };
    const auto = { segments: [{ a: 0, b: 5 }, { a: 7, b: 10 }, { a: 12, b: 20 }, { a: 22, b: 30 }], layout: 'split' };
    const r = compareEdits(mine as any, auto as any, 30);
    expect(r.cutMine).toBeCloseTo(2, 5);
    expect(r.cutAuto).toBeCloseTo(6, 5);
    expect(r.areas.cortes).toBeCloseTo(2 / 6, 5);
    expect(r.areas.encuadre).toBe(1);
  });
  it('la agresividad cambia cuanto se quita: suave < normal < intensa', () => {
    const pauses = sil([4, 0.8], [9, 1.1], [15, 1.6], [22, 1.2], [28, 0.9], [34, 2]);
    const removed = (i: number) => {
      const lv = AUTO_LEVELS[i];
      const p = pickSilences(pauses, 40, { minSil: lv.minSil, maxCuts: Math.round((40 / 60) * lv.perMin), minSeg: lv.minSeg, pad: lv.pad, maxRemove: 40 * lv.maxRemove });
      return p.reduce((t, x) => t + Math.max(0, x.b - x.a - 2 * lv.pad), 0);
    };
    expect(removed(0)).toBeLessThan(removed(1));
    expect(removed(1)).toBeLessThan(removed(2));
    expect(removed(2)).toBeLessThanOrEqual(40 * AUTO_LEVELS[2].maxRemove);
  });
  it('un nivel desconocido es «Normal»', () => {
    expect(autoLevel(undefined).name).toBe('Normal');
    expect(autoLevel(7).name).toBe('Normal');
    expect(autoLevel(0).name).toBe('Suave');
  });
});
