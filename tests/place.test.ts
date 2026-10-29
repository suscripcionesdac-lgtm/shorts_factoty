import { describe, expect, it } from 'vitest';
import { SAFE, captionBox, captionY, faceZones, zonesAt, type Box } from '../src/clips/web/place.js';
import { buildAss, geometry } from '../src/clips/media/fast';
import { defaultTemplate, sanitize } from '../src/clips/media/spec';

const cap = captionBox('QUE POBRECITO', 92);
/** Si el bloque de subtitulos centrado en y pisa alguna zona. */
const hits = (zones: Box[], y: number) => zones.some((z) => Math.min(0.5 + cap.w / 2, z.x + z.w) > Math.max(0.5 - cap.w / 2, z.x) && Math.min(y + cap.h / 2, z.y + z.h) > Math.max(y - cap.h / 2, z.y));
const inSafe = (y: number, safe = SAFE.todas) => y - cap.h / 2 >= safe[0] / 1920 - 1e-9 && y + cap.h / 2 <= 1 - safe[1] / 1920 + 1e-9;
const geo = (layout: string, cam = { x: 0, y: 0.6, w: 0.3, h: 0.35 }) => geometry(layout, 1920, 1080, cam);

describe('subtitulos que esquivan caras', () => {
  it('si a la altura preferida no hay ninguna cara, se quedan ahi', () => {
    const z = faceZones({ layout: 'split' }, geo('split'), []);
    expect(captionY(z, 0.7, cap)).toBeCloseTo(0.7, 5);
  });
  it('camara arriba y juego abajo: no se ponen sobre la camara', () => {
    const z = faceZones({ layout: 'split' }, geo('split'), []);
    const y = captionY(z, 0.2, cap);
    expect(hits(z, y)).toBe(false);
    expect(inSafe(y)).toBe(true);
  });
  it('varias camaras apiladas: van al hueco entre dos caras, cerca de donde se querian', () => {
    const cams = [{ x: 0, y: 0, w: 0.3, h: 0.3 }, { x: 0.6, y: 0, w: 0.3, h: 0.3 }];
    const z = faceZones({ layout: 'duo' }, geo('duo'), cams);
    const y = captionY(z, 0.45, cap);
    expect(hits(z, y)).toBe(false);
    expect(Math.abs(y - 0.5)).toBeLessThan(0.08);
  });
  it('durante un golpe de reaccion la cara ocupa la pantalla y se recolocan', () => {
    const sp = { layout: 'split', punches: [{ a: 10, b: 12 }] };
    const base = faceZones(sp, geo('split'), []);
    const before = captionY(zonesAt(sp, base, 5, 6), 0.62, cap), during = captionY(zonesAt(sp, base, 10.5, 11), 0.62, cap);
    expect(during).not.toBeCloseTo(before, 2);
    expect(hits(zonesAt(sp, base, 10.5, 11), during)).toBe(false);
  });
  it('nunca salen de la zona segura de la app elegida', () => {
    for (const k of ['todas', 'tiktok', 'shorts', 'reels'] as const) for (const pref of [0.02, 0.5, 0.98]) {
      const y = captionY(faceZones({ layout: 'cam' }, geo('cam'), []), pref, cap, SAFE[k]);
      expect(inSafe(y, SAFE[k])).toBe(true);
    }
  });
  it('una camara pequeña en una esquina no aparta un subtitulo centrado', () => {
    const z = faceZones({ layout: 'pip', pipPos: 'tr' }, geo('pip'), []);
    const c2 = captionBox('SI', 92);
    expect(captionY(z, 0.18, c2)).toBeCloseTo(0.18, 5);
  });
  it('imagen completa sin camaras detectadas: no se mueven', () => {
    expect(faceZones({ layout: 'fit', cam: { x: 0, y: 0.6, w: 0.3, h: 0.35 } }, geo('fit'), [])).toEqual([]);
  });
  it('el exportador escribe cada bloque a su altura (y la vuelve a cambiar en el golpe)', () => {
    const base = defaultTemplate(1920, 1080, 'x');
    const words = [{ text: 'que', startMs: 1000, endMs: 1300 }, { text: 'pasa', startMs: 1300, endMs: 1600 }, { text: 'tio', startMs: 10200, endMs: 10500 }];
    const spec = sanitize({ sid: 'x', start: 0, end: 20, layout: 'split', punches: [{ id: 'p', a: 10, b: 12, cam: -1 }], captions: { ...base.captions, posY: 20, perChunk: 2, anim: 'ninguna', words } }, base);
    const ass = buildAss(spec, geometry('split', 1920, 1080, spec.cam), 20000);
    const ys = [...ass.matchAll(/,Cap,,.*?\\pos\(540,(\d+)\)/g)].map((m) => +m[1]);
    expect(ys).toHaveLength(2);
    const face = faceZones({ layout: 'split' }, geometry('split', 1920, 1080, spec.cam), [])[0];
    expect(ys[0] / 1920 - captionBox('que pasa', 92).h / 2, 'por debajo de la cara de la camara').toBeGreaterThanOrEqual(face.y + face.h);
    expect(ys[1]).not.toBe(ys[0]);
    const off = buildAss({ ...spec, captions: { ...spec.captions, smart: false } }, geometry('split', 1920, 1080, spec.cam), 20000);
    expect([...off.matchAll(/,Cap,,.*?\\pos\(540,(\d+)\)/g)].map((m) => +m[1])).toEqual([384, 384]);
  });
});
