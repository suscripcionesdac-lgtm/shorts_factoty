import { describe, expect, it } from 'vitest';
import { camRect, edgeMaps, faceGroups, motion, pickCams, reactionOf, snapToWords, speakerTrack, turnsPerMin, type Gray, type Sample } from '../src/clips/ai/faces';
import { buildArgs, camSpans } from '../src/clips/media/fast';
import { camList, defaultTemplate, sanitize } from '../src/clips/media/spec';
import { heuristicScore } from '../src/clips/analysis/detect';

// Fotograma sintetico de 320x180: "juego" con ruido que cambia en cada instante y una camara con marco recto.
const GW = 320, GH = 180;
function frame(seed: number, cam: { x0: number; y0: number; x1: number; y1: number } | null, photo = true): Gray {
  const g = new Uint8Array(GW * GH);
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  // El juego se mueve: el damero se desplaza en cada instante, asi que sus bordes no quedan fijos.
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) g[y * GW + x] = 60 + Math.floor(rnd() * 25) + ((((x + seed * 5) >> 4) + ((y + seed * 3) >> 4)) % 2) * 50;
  if (cam) for (let y = cam.y0; y < cam.y1; y++) for (let x = cam.x0; x < cam.x1; x++) g[y * GW + x] = 200 + ((x + seed * 3) % 7); // la persona se mueve un poco
  // Foto fija del marcador del juego: identica en todos los instantes.
  if (photo) for (let y = 140; y < 160; y++) for (let x = 280; x < 296; x++) g[y * GW + x] = 30 + ((x * 7 + y * 3) % 40);
  return { t: seed, g };
}
const CAM = { x0: 20, y0: 70, x1: 120, y1: 160 };
const grays = [1, 2, 3, 4, 5].map((s) => frame(s, CAM));

describe('camaras de los participantes', () => {
  it('agrupa la misma cara vista en varios instantes', () => {
    const g = faceGroups([
      { t: 1, faces: [{ x: 0.2, y: 0.5, w: 0.05, h: 0.1, score: 0.9 }, { x: 0.8, y: 0.1, w: 0.05, h: 0.1, score: 0.8 }] },
      { t: 2, faces: [{ x: 0.21, y: 0.51, w: 0.05, h: 0.1, score: 0.95 }] },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].seen).toBe(2);
    expect(g[1].seen).toBe(1);
  });
  it('una foto fija no se mueve; una camara en directo si', () => {
    const live = [1, 2, 3].map((s) => frame(s, CAM, false));
    for (const g of live) for (let y = 80; y < 100; y++) for (let x = 50; x < 70; x++) g.g[y * GW + x] = (g.t * 80) % 255;
    expect(motion(grays, GW, GH, { x: 280 / GW, y: 140 / GH, w: 16 / GW, h: 20 / GH })).toBeLessThan(1);
    expect(motion(live, GW, GH, { x: 50 / GW, y: 80 / GH, w: 20 / GW, h: 20 / GH })).toBeGreaterThan(6);
  });
  it('la zona de la camara se ajusta a su marco recto', () => {
    const r = camRect({ x: 55 / GW, y: 90 / GH, w: 24 / GW, h: 30 / GH }, edgeMaps(grays, GW, GH));
    expect(Math.abs(r.x * GW - CAM.x0)).toBeLessThanOrEqual(2);
    expect(Math.abs((r.x + r.w) * GW - CAM.x1)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y * GH - CAM.y0)).toBeLessThanOrEqual(2);
    expect(Math.abs((r.y + r.h) * GH - CAM.y1)).toBeLessThanOrEqual(2);
  });
  it('una puerta recta dentro de la camara no se confunde con su marco', () => {
    // Una linea vertical fija junto a la cara que ocupa algo mas de la mitad del alto de la camara (como el marco de
    // una puerta detras del streamer): el borde es el marco de la camara, mas afuera.
    const gs = [1, 2, 3, 4].map((s) => { const g = frame(s, CAM); for (let y = 85; y < 133; y++) for (let x = 44; x < 47; x++) g.g[y * GW + x] = 40; return g; });
    const r = camRect({ x: 55 / GW, y: 90 / GH, w: 24 / GW, h: 30 / GH }, edgeMaps(gs, GW, GH));
    expect(Math.abs(r.x * GW - CAM.x0)).toBeLessThanOrEqual(2);
    expect(Math.abs((r.x + r.w) * GW - CAM.x1)).toBeLessThanOrEqual(2);
  });
  it('una camara pegada a una esquina llega hasta el borde de la imagen', () => {
    const corner = { x0: 230, y0: 0, x1: 320, y1: 70 };
    const gs = [1, 2, 3, 4].map((s) => frame(s, corner));
    const r = camRect({ x: 265 / GW, y: 15 / GH, w: 22 / GW, h: 28 / GH }, edgeMaps(gs, GW, GH));
    expect(Math.abs(r.x * GW - 230)).toBeLessThanOrEqual(2);
    expect(r.y).toBe(0);
    expect(r.x + r.w).toBeCloseTo(1, 2);
    expect(Math.abs((r.y + r.h) * GH - 70)).toBeLessThanOrEqual(2);
  });
  it('sin marco visible usa un margen proporcional a la cara', () => {
    const plain = [1, 2, 3].map((s) => frame(s, null, false));
    const r = camRect({ x: 0.45, y: 0.4, w: 0.06, h: 0.12 }, edgeMaps(plain, GW, GH));
    expect(r.w).toBeCloseTo(0.06 * 2.9, 2);
    expect(r.h).toBeCloseTo(0.12 * 2.4, 2);
  });
  it('descarta las fotos fijas y une dos caras de la misma camara', () => {
    for (const g of grays) for (let y = 85; y < 105; y++) for (let x = 55; x < 80; x++) g.g[y * GW + x] = (g.t * 70) % 255; // la cara cambia
    const faces = (t: number) => ({ t, faces: [
      { x: 55 / GW, y: 88 / GH, w: 24 / GW, h: 30 / GH, score: 0.95 },
      { x: 85 / GW, y: 92 / GH, w: 22 / GW, h: 28 / GH, score: 0.9 }, // otra persona en el mismo sofa
      { x: 280 / GW, y: 140 / GH, w: 16 / GW, h: 20 / GH, score: 0.6 }, // foto del marcador
    ] });
    const cams = pickCams([1, 2, 3, 4, 5].map(faces), grays, GW, GH);
    expect(cams).toHaveLength(1);
    expect(Math.abs(cams[0].x * GW - CAM.x0)).toBeLessThanOrEqual(2);
  });
});

// Muestras de dos camaras a 5 por segundo: `talk(c, i)` dice si la persona de la camara c habla en la muestra i.
const obs = (mouth: number, expr: Partial<Record<'neutral' | 'happy' | 'surprised', number>> = {}) =>
  [mouth, expr.neutral ?? 0.95, expr.happy ?? 0.02, 0, 0, 0, 0, expr.surprised ?? 0.01, 0.9];
const talks = (n: number, talk: (c: number, i: number) => boolean): Sample[] =>
  Array.from({ length: n }, (_, i) => ({ t: i / 5, obs: [0, 1].map((c) => obs(talk(c, i) ? (i % 2 ? 0.35 : 0.08) : 0.05 + (i % 3) * 0.003)) }));

describe('quien habla', () => {
  it('cambia a la camara cuya boca se mueve', () => {
    const tr = speakerTrack(talks(100, (c, i) => (i < 50 ? c === 0 : c === 1)), 2, 5);
    expect(tr[0]).toEqual({ t: 0, cam: 0 });
    expect(tr).toHaveLength(2);
    expect(tr[1].cam).toBe(1);
    expect(Math.abs(tr[1].t - 10)).toBeLessThanOrEqual(1);
  });
  it('no salta por un instante suelto: los planos duran al menos 2,4 s', () => {
    const tr = speakerTrack(talks(100, (c, i) => (i >= 40 && i < 45 ? c === 1 : c === 0)), 2, 5);
    expect(tr).toEqual([{ t: 0, cam: 0 }]);
  });
  it('con una sola camara no hay a quien cambiar', () => {
    expect(speakerTrack(talks(50, () => true), 1, 5)).toEqual([]);
  });
  it('el cambio de camara cae al empezar la frase mas cercana', () => {
    const words = [{ a: 1, b: 1.4 }, { a: 1.5, b: 2 }, { a: 5.6, b: 6 }, { a: 6.05, b: 6.5 }, { a: 12, b: 12.3 }];
    // 6,1 s esta a mitad de frase: se lleva a 5,5 (inicio de la frase, con un pequeño margen). 9 s no tiene frase cerca.
    expect(snapToWords([{ t: 0, cam: 0 }, { t: 6.1, cam: 1 }, { t: 9, cam: 0 }], words)).toEqual([{ t: 0, cam: 0 }, { t: 5.5, cam: 1 }, { t: 9, cam: 0 }]);
    expect(snapToWords([{ t: 0, cam: 0 }, { t: 3, cam: 1 }], [])).toEqual([{ t: 0, cam: 0 }, { t: 3, cam: 1 }]);
  });
  it('cuenta los cambios por minuto', () => {
    expect(turnsPerMin([{ t: 0, cam: 0 }, { t: 5, cam: 1 }, { t: 10, cam: 0 }], 30)).toBe(4);
    expect(turnsPerMin([], 30)).toBe(0);
  });
});

describe('reacciones en la cara', () => {
  const calm = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i / 3, obs: [obs(0.05), obs(0.05)] as Sample['obs'] }));
  it('encuentra la sorpresa y cuando ocurre', () => {
    const s = calm(30);
    for (let i = 20; i < 23; i++) s[i].obs[1] = obs(0.6, { neutral: 0.05, surprised: 0.9 });
    const r = reactionOf(s, 2, 3);
    expect(r.label).toBe('sorpresa');
    expect(r.react).toBeGreaterThan(3);
    expect(Math.abs(r.at - 7)).toBeLessThanOrEqual(1);
    expect(r.together).toBe(false);
  });
  it('una cara que siempre sonrie no cuenta como reaccion; varias a la vez si', () => {
    const s = calm(30).map((x) => ({ ...x, obs: [obs(0.05, { neutral: 0.2, happy: 0.8 }), obs(0.05)] as Sample['obs'] }));
    expect(reactionOf(s, 2, 3).react).toBeLessThan(1);
    for (let i = 10; i < 13; i++) s[i].obs = [obs(0.6, { neutral: 0, happy: 1 }), obs(0.5, { neutral: 0.1, happy: 0.9 })];
    expect(reactionOf(s, 2, 3).together).toBe(true);
  });
});

describe('seguir a quien habla al exportar', () => {
  const base = defaultTemplate(1920, 1080, 'x');
  const cams = [{ x: 0.77, y: 0, w: 0.23, h: 0.33 }, { x: 0.01, y: 0.38, w: 0.18, h: 0.3 }];
  const spec = (more: object) => sanitize({ sid: 'a', start: 0, end: 30, ...base, layout: 'split', cam: cams[0], cams, camTrack: [{ t: 0, cam: 0 }, { t: 6.4, cam: 1 }, { t: 19.6, cam: 0 }], ...more }, base);
  it('cada camara se ve en sus tramos', () => {
    expect(camSpans([{ t: 0, cam: 0 }, { t: 6.4, cam: 1 }, { t: 19.6, cam: 0 }], 2, 30)).toEqual(['between(t,0.000,6.399)+between(t,19.600,29.999)', 'between(t,6.400,19.599)']);
  });
  it('el video alterna las camaras con superposiciones', () => {
    const { args } = buildArgs({ spec: spec({ follow: true }), file: 'in.mp4', outDir: '.', srcW: 1920, srcH: 1080 });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain("overlay=0:0:enable='between(t,6.400,19.599)'");
    expect(fc).toContain('crop=iw*0.1800:ih*0.3000:iw*0.0100:ih*0.3800');
  });
  it('sin «seguir a quien habla» se queda la camara principal', () => {
    const s = spec({ follow: false });
    expect(s.camTrack).toBeUndefined();
    const { args } = buildArgs({ spec: s, file: 'in.mp4', outDir: '.', srcW: 1920, srcH: 1080 });
    expect(args[args.indexOf('-filter_complex') + 1]).not.toContain('enable=\'between(t,6.400');
  });
  it('la camara principal conserva el ajuste a mano y se descartan indices invalidos', () => {
    const mine = { x: 0.76, y: 0, w: 0.24, h: 0.32 };
    expect(camList({ cam: mine, cams })[0]).toBe(mine);
    expect(camList({ cam: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, cams })).toEqual([]);
    expect(spec({ follow: true, camTrack: [{ t: 0, cam: 0 }, { t: 3, cam: 7 }] }).camTrack).toEqual([{ t: 0, cam: 0 }]);
  });
});

describe('las caras en la puntuacion', () => {
  it('una reaccion clara y una conversacion animada suben la nota y se explican', () => {
    const plain = heuristicScore(2, 'vamos a ver', 30);
    const face = heuristicScore(2, 'vamos a ver', 30, 0, 0, null, { react: 4, label: 'sorpresa', turns: 10, together: true });
    expect(face.score).toBeGreaterThan(plain.score + 1.5);
    expect(face.why).toContain('sorpresa en cámara');
    expect(face.why).toContain('reaccionan varios a la vez');
    expect(face.features.face).toBe(4);
    expect(heuristicScore(2, 'vamos a ver', 30, 0, 0, null, { react: 0.5, label: '', turns: 2, together: false }).score).toBe(plain.score);
  });
});

describe('estilos de los clips de referencia', () => {
  const base = defaultTemplate(1920, 1080, 'x');
  const cams = [{ x: 0.77, y: 0, w: 0.23, h: 0.33 }, { x: 0.01, y: 0.38, w: 0.18, h: 0.3 }];
  const fc = (more: object) => { const { args } = buildArgs({ spec: sanitize({ sid: 'a', start: 0, end: 20, ...base, cam: cams[0], cams, ...more }, base), file: 'in.mp4', outDir: '.', srcW: 1920, srcH: 1080 }); return args[args.indexOf('-filter_complex') + 1]; };
  it('dos camaras apiladas; la que no habla se apaga', () => {
    const g = fc({ layout: 'duo', follow: true, camTrack: [{ t: 0, cam: 0 }, { t: 8, cam: 1 }] });
    expect(g).toContain('vstack');
    expect(g).toContain("eq=brightness=-0.16:saturation=0.7:enable='not(between(t,0.000,7.999))'");
  });
  it('camaras flotantes con esquinas redondeadas', () => {
    const g = fc({ layout: 'float' });
    expect(g.match(/alphamerge/g)).toHaveLength(2);
    expect(g).toContain('geq=lum=');
  });
  it('con tres camaras, las tres flotan en fila', () => {
    const g = fc({ layout: 'float', cams: [...cams, { x: 0.18, y: 0.14, w: 0.11, h: 0.34 }] });
    expect(g.match(/alphamerge/g)).toHaveLength(3);
    for (const x of [22, 375, 728]) expect(g).toContain(`overlay=${x}:140`);
  });
  it('fondo negro, golpe de reaccion y destello', () => {
    expect(fc({ layout: 'fit', fitBg: 'negro' })).toContain(':black,setsar=1');
    const g = fc({ layout: 'split', flash: true, punches: [{ id: 'p', a: 5, b: 6.5, cam: 1 }] });
    expect(g).toContain("overlay=0:0:enable='between(t,5.000,6.500)'");
    expect(g).toContain('crop=iw*0.1800:ih*0.3000:iw*0.0100:ih*0.3800');
    expect(g).toContain("color=white@0.55:t=fill:enable='between(t,5.000,5.120)'");
  });
});

describe('varias camaras apiladas', () => {
  it('apila hasta 4 camaras, la principal arriba, con una linea entre cada una', () => {
    const base = defaultTemplate(1920, 1080, 'x');
    const cams = [{ x: 0.77, y: 0, w: 0.23, h: 0.33 }, { x: 0.01, y: 0.38, w: 0.18, h: 0.3 }, { x: 0.4, y: 0.6, w: 0.2, h: 0.3 }];
    const { args } = buildArgs({ spec: sanitize({ sid: 'a', start: 0, end: 20, ...base, layout: 'duo', cam: cams[1], cams }, base), file: 'in.mp4', outDir: '.', srcW: 1920, srcH: 1080 });
    const g = args[args.indexOf('-filter_complex') + 1];
    expect(g).toContain('vstack=inputs=3');
    expect(g).toContain('drawbox=x=0:y=636:');
    expect(g).toContain('drawbox=x=0:y=1276:');
    // La principal (la segunda de la lista) va primero
    expect(g.indexOf('crop=iw*0.1800')).toBeLessThan(g.indexOf('crop=iw*0.2300'));
  });
});

describe('caras dentro de otra camara', () => {
  it('una cara que se mueve dentro de una camara mas grande (una figura, un poster) no es otra camara', () => {
    const gs = [1, 2, 3, 4, 5].map((s) => frame(s, CAM, false));
    for (const g of gs) {
      for (let y = 85; y < 105; y++) for (let x = 55; x < 80; x++) g.g[y * GW + x] = (g.t * 70) % 255; // la persona
      for (let y = 140; y < 146; y++) for (let x = 98; x < 103; x++) g.g[y * GW + x] = (g.t * 90) % 255; // carita del fondo
    }
    const faces = (t: number) => ({ t, faces: [
      { x: 55 / GW, y: 88 / GH, w: 24 / GW, h: 30 / GH, score: 0.95 },
      { x: 98 / GW, y: 140 / GH, w: 5 / GW, h: 6 / GH, score: 0.7 },
    ] });
    const cams = pickCams([1, 2, 3, 4, 5].map(faces), gs, GW, GH);
    expect(cams).toHaveLength(1);
    expect(Math.abs(cams[0].x * GW - CAM.x0)).toBeLessThanOrEqual(2);
  });
});
