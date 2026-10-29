import { describe, expect, it } from 'vitest';
import { cutRange, restoreRange } from '../src/clips/web/cuts.js';

describe('editar desde el texto: quitar y recuperar trozos del video', () => {
  it('quita un rango dentro de un tramo y cruzando varios', () => {
    expect(cutRange([{ a: 0, b: 30 }], 10, 12)).toEqual([{ a: 0, b: 10 }, { a: 12, b: 30 }]);
    expect(cutRange([{ a: 0, b: 10 }, { a: 15, b: 30 }], 8, 20)).toEqual([{ a: 0, b: 8 }, { a: 20, b: 30 }]);
    // Un trozo suelto de menos de 0,15 s no se queda.
    expect(cutRange([{ a: 0, b: 30 }], 0.1, 5)).toEqual([{ a: 5, b: 30 }]);
    // Fuera de lo que se ve, no cambia nada.
    expect(cutRange([{ a: 0, b: 10 }, { a: 15, b: 30 }], 11, 14)).toEqual([{ a: 0, b: 10 }, { a: 15, b: 30 }]);
  });
  it('recuperar une con los tramos de al lado', () => {
    expect(restoreRange([{ a: 0, b: 10 }, { a: 12, b: 30 }], 10, 12, 30)).toEqual([{ a: 0, b: 30 }]);
    expect(restoreRange([{ a: 0, b: 10 }, { a: 20, b: 30 }], 12, 14, 30)).toEqual([{ a: 0, b: 10 }, { a: 12, b: 14 }, { a: 20, b: 30 }]);
    expect(restoreRange([{ a: 5, b: 10 }], -1, 6, 8)).toEqual([{ a: 0, b: 10 }]);
  });
});
