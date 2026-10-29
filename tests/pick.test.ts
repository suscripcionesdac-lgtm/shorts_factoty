import { describe, expect, it } from 'vitest';
import { fit, pickClips } from '../src/clips/web/pick.js';

const m = (o: Partial<Parameters<typeof fit>[0]> & { id: string }) => ({ peak: 50, start: 30, end: 70, score: 5, by: 'audio', text: '', ...o });

describe('sacar clips', () => {
  it('encaja la duración alrededor del pico, dentro del vídeo y del momento', () => {
    expect(fit(m({ id: 'a' }), 'auto')).toEqual({ start: 30, end: 70 });
    expect(fit(m({ id: 'a' }), 'medio')).toEqual({ start: 30, end: 70 }); // ya cabe
    expect(fit(m({ id: 'a' }), 'corto')).toEqual({ start: 35, end: 65 }); // 30 s centrados en el pico
    expect(fit(m({ id: 'a', peak: 32 }), 'corto')).toEqual({ start: 30, end: 60 }); // sin salirse del momento
    expect(fit(m({ id: 'a', start: 0, end: 20, peak: 5 }), 'largo')).toEqual({ start: 0, end: 60 }); // alarga sin bajar de 0
    expect(fit(m({ id: 'a', start: 80, end: 95, peak: 90 }), 'largo', 100)).toEqual({ start: 40, end: 100 }); // ni pasar del final
  });
  it('ordena según lo pedido y las indicaciones', () => {
    const list = [
      m({ id: 'fuerte', score: 9 }),
      m({ id: 'risa', score: 6, text: 'jajaja no puede ser', features: { hype: 2 } }),
      m({ id: 'chat', score: 4, by: 'chat' }),
      m({ id: 'larga', score: 6, start: 0, end: 120, peak: 60, text: 'la historia del red dead redemption '.repeat(30) }),
      m({ id: 'hecho', score: 10, exported: true }),
    ];
    expect(pickClips(list)[0].c.id).toBe('fuerte');
    expect(pickClips(list).at(-1)!.c.id, 'lo ya exportado, al final').toBe('hecho');
    expect(pickClips(list, { kind: 'graciosos' })[0].c.id).toBe('risa');
    expect(pickClips(list, { kind: 'chat' }).map((x) => x.c.id)).toEqual(['chat']);
    expect(pickClips(list, { kind: 'historias' })[0].c.id).toBe('larga');
    expect(pickClips(list, { hint: 'cuando habla de Red Dead' })[0].c.id).toBe('larga');
  });
});
