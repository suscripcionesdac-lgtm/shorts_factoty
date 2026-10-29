import { describe, expect, it } from 'vitest';
import { addDecisions, disliked, kindOf } from '../src/clips/web/prefs.js';
import { direct, type DirectorInput } from '../src/clips/analysis/director';

describe('preferencias aprendidas en la revision', () => {
  it('cuenta lo conservado y lo quitado, y solo hace caso con suficientes decisiones', () => {
    let p = addDecisions({}, [{ kind: 'sonido:boom', on: false }, { kind: 'zoom-fuerte', on: true }, { on: true }]);
    expect(p).toEqual({ 'sonido:boom': [0, 1], 'zoom-fuerte': [1, 0] });
    expect(disliked(p, 'sonido:boom')).toBe(false); // una sola vez no basta
    p = addDecisions(p, [{ kind: 'sonido:boom', on: false }, { kind: 'sonido:boom', on: false }]);
    expect(disliked(p, 'sonido:boom')).toBe(true);
    // Si a veces lo conserva, no se deja de proponer.
    expect(disliked({ 'zoom-suave': [2, 3] }, 'zoom-suave')).toBe(false);
    expect(disliked(undefined, 'golpe')).toBe(false);
  });
  it('manda lo reciente: si antes se conservaba pero ahora se quita siempre, se deja de proponer', () => {
    let p = {};
    for (let k = 0; k < 2; k++) p = addDecisions(p, [{ kind: 'golpe', on: true }]);
    for (let k = 0; k < 3; k++) { p = addDecisions(p, [{ kind: 'golpe', on: false }]); }
    expect(disliked(p, 'golpe')).toBe(false);
    p = addDecisions(p, [{ kind: 'golpe', on: false }]);
    expect(disliked(p, 'golpe')).toBe(true);
  });
  it('lo que ya no se propone no vuelve a salir por revisiones en las que no aparece', () => {
    let p = addDecisions({}, [{ kind: 'sonido:boom', on: false }]);
    for (let k = 0; k < 2; k++) p = addDecisions(p, [{ kind: 'sonido:boom', on: false }]);
    expect(disliked(p, 'sonido:boom')).toBe(true);
    for (let k = 0; k < 10; k++) p = addDecisions(p, [{ kind: 'zoom-fuerte', on: true }]);
    expect(disliked(p, 'sonido:boom')).toBe(true);
  });
  it('el tipo de un zoom depende de cuanto acerca', () => {
    expect(kindOf.zoom(1.15)).toBe('zoom-suave');
    expect(kindOf.zoom(1.45)).toBe('zoom-fuerte');
    expect(kindOf.sfx('boom.wav')).toBe('sonido:boom');
  });
  it('el director deja de proponer lo que se quita casi siempre y dice por que', () => {
    const energyZ = Array(40).fill(0.2); energyZ[12] = 4; energyZ[25] = 3.5;
    const base: DirectorInput = { words: [], energyZ, dur: 40, react: null, multiCam: false, hook: true, sfx: ['boom.wav', 'riser.wav', 'whoosh.wav'], styles: ['impacto', 'neon', 'amarillo'], seed: 'p', segments: [{ a: 0, b: 20 }, { a: 22, b: 40 }] };
    const free = direct(base);
    expect((free.patch.sfx || []).some((x) => x.file === 'boom.wav')).toBe(true);
    const prefs = { 'sonido:boom': [0, 4], 'sonido:riser': [0, 3], 'subtitulos:impacto': [0, 5], 'zoom-fuerte': [0, 6] } as Record<string, [number, number]>;
    const learned = direct({ ...base, prefs });
    expect((learned.patch.sfx || []).map((x) => x.file)).not.toContain('boom.wav');
    expect((learned.patch.sfx || []).map((x) => x.file)).not.toContain('riser.wav');
    expect(learned.patch.captions!.style).not.toBe('impacto');
    expect((learned.patch.zooms || []).every((z) => z.scale < 1.3)).toBe(true);
    expect(learned.done.join(' ')).toContain('sueles quitarlo');
  });
});
