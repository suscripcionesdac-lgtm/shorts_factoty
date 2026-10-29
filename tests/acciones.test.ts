import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

// Dos acciones con el mismo nombre en el editor: la segunda pisa a la primera sin avisar
// (pasó con «track»: «Seguir la cara» encendía y apagaba pistas; y con «back»: «Volver» dejó de funcionar).
describe('acciones del editor', () => {
  it('cada data-e tiene una sola acción', () => {
    const src = fs.readFileSync('src/clips/web/editor/actions.js', 'utf8');
    const start = src.indexOf('const actions = {'), body = src.slice(start, src.indexOf('\n};', start));
    const keys = [...body.matchAll(/^ {2}([a-zA-Z]+): /gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});
