import { describe, expect, it } from 'vitest';
import { blend, newModel, predict, train } from '../src/clips/analysis/learn';
import { chatZ } from '../src/clips/analysis/chat';
import { combine, peaksOf, smooth, zscores } from '../src/clips/analysis/detect';
import { buildArgs, buildAss, chunk, geometry, layoutChain, reframeExpr, zoomExpr } from '../src/clips/media/fast';
import { applyText, defaultTemplate, isKeyword, keptDuration, normalizeSegments, sanitize, segmentsFromSilences, splitAt } from '../src/clips/media/spec';
import { adSpans, clipRequests, isAdFrame, sceneZ, withoutAds } from '../src/clips/ai/vision';

describe('aprendizaje', () => {
  it('aprende que para este streamer manda el chat y no el volumen', () => {
    let m = newModel();
    for (let i = 0; i < 30; i++) {
      m = train(m, { audio: 4, chat: 0, hype: 0, density: 1 }, 0);
      m = train(m, { audio: 1, chat: 4, hype: 1, density: 1 }, 1);
    }
    expect(predict(m, { audio: 1, chat: 4, hype: 1, density: 1 })).toBeGreaterThan(0.8);
    expect(predict(m, { audio: 4, chat: 0, hype: 0, density: 1 })).toBeLessThan(0.2);
  });
  it('no cambia la puntuacion hasta tener suficientes decisiones', () => {
    const m = train(newModel(), { audio: 1, chat: 1, hype: 1, density: 1 }, 0);
    expect(blend(7, m, { audio: 1, chat: 1, hype: 1, density: 1 })).toBe(7);
  });
  it('acepta modelos guardados por versiones anteriores (4 pesos)', () => {
    const old = { w: [1, 1, 1, 1], b: 0, n: 10 };
    expect(predict(old, { audio: 2, chat: 2, hype: 1, density: 1, visual: 4 })).toBeGreaterThan(0.5);
    expect(train(old, { audio: 2, chat: 2, hype: 1, density: 1, visual: 4 }, 1).w).toHaveLength(7);
    // Las señales de caras (reaccion y cambios de quien habla) tambien se aprenden.
    expect(train(old, { audio: 2, chat: 2, hype: 1, density: 1, face: 4, turns: 10 }, 1).w.slice(5).every((x) => x > 0)).toBe(true);
  });
});

describe('señales de deteccion', () => {
  it('un estallido de mensajes destaca sobre el ritmo normal', () => {
    const rate = Array.from({ length: 300 }, (_, i) => 2 + (i % 3));
    for (let i = 150; i < 156; i++) rate[i] = 40;
    const z = chatZ(rate, 300);
    expect(z[152]).toBeGreaterThan(5);
    expect(Math.abs(z[50])).toBeLessThan(2);
  });
  it('el chat revela un momento que el volumen no ve', () => {
    const db = Array.from({ length: 300 }, (_, i) => -30 + Math.sin(i / 5));
    const rate = Array.from({ length: 300 }, () => 3);
    for (let i = 205; i < 212; i++) rate[i] = 50;
    const az = smooth(zscores(db), 2);
    expect(peaksOf(az)).toHaveLength(0);
    expect(peaksOf(combine(az, chatZ(rate, 300))).some((p) => p.t >= 190 && p.t <= 212)).toBe(true);
  });
  it('un cambio brusco de imagen tambien crea un momento', () => {
    const db = Array.from({ length: 300 }, (_, i) => -30 + Math.sin(i / 5));
    const scene = Array.from({ length: 300 }, (_, i) => (i % 2 ? 0.05 + (i % 7) * 0.004 : 0));
    scene[121] = 0.9;
    const az = smooth(zscores(db), 2), vz = sceneZ(scene, 300);
    expect(vz[121]).toBeGreaterThan(5);
    expect(peaksOf(combine(az, null, 12, vz)).some((p) => Math.abs(p.t - 121) <= 3)).toBe(true);
  });
  it('varios "clip" seguidos en el chat cuentan como pedido, uno suelto no', () => {
    const c = Array.from({ length: 200 }, () => 0);
    c[20] = 1;
    c[100] = 1; c[102] = 1; c[104] = 2;
    expect(clipRequests(c)).toEqual([104]);
  });
});

describe('edicion', () => {
  it('une tramos que se tocan y recorta al clip', () => {
    expect(normalizeSegments([{ a: 5, b: 10 }, { a: -2, b: 5 }, { a: 20, b: 99 }], 30)).toEqual([{ a: 0, b: 10 }, { a: 20, b: 30 }]);
    expect(normalizeSegments(undefined, 30)).toEqual([{ a: 0, b: 30 }]);
  });
  it('quitar silencios conserva el habla con un pequeño margen', () => {
    const keep = segmentsFromSilences([{ a: 4, b: 7 }, { a: 15, b: 16 }], 20);
    expect(keep).toHaveLength(3);
    expect(keep[0]).toEqual({ a: 0, b: 4.12 });
    expect(keptDuration(keep)).toBeLessThan(20);
    expect(keptDuration(keep)).toBeGreaterThan(15.5);
  });
  it('cortar divide solo el tramo que contiene el cursor', () => {
    expect(splitAt([{ a: 0, b: 10 }, { a: 12, b: 20 }], 15)).toEqual([{ a: 0, b: 10 }, { a: 12, b: 15 }, { a: 15, b: 20 }]);
    expect(splitAt([{ a: 0, b: 10 }], 10)).toHaveLength(1);
  });
  it('reconoce palabras clave y conserva los tiempos al corregir texto', () => {
    expect(isKeyword('NOOO')).toBe(true);
    expect(isKeyword('jajaja')).toBe(true);
    expect(isKeyword('mesa')).toBe(false);
    const w = [{ text: 'ola', startMs: 0, endMs: 300 }, { text: 'mundo', startMs: 300, endMs: 700 }];
    expect(applyText(w, 'hola mundo', 1000)[0]).toEqual({ text: 'hola', startMs: 0, endMs: 300 });
    expect(applyText(w, 'hola a todo el mundo', 1000)).toHaveLength(5);
  });
  it('descarta lo que llega mal formado de la interfaz', () => {
    const s = sanitize({ sid: 'x', start: 10, end: 40, layout: 'raro', stickers: [{ id: 'a', file: '../../etc/passwd', x: 0, y: 0, w: 1, a: 0, b: 5 }, { id: 'b', file: 'lol.png', x: 0.5, y: 0.5, w: 0.3, a: 2, b: 99 }], zooms: [{ id: 'z', a: 1, b: 3, scale: 9 }] }, defaultTemplate());
    expect(s.layout).toBe('fit');
    expect(s.stickers).toHaveLength(1);
    expect(s.stickers[0].b).toBe(30);
    expect(s.zooms[0].scale).toBe(2.5);
  });
});

describe('exportacion', () => {
  const cam = { x: 0, y: 0.7, w: 0.25, h: 0.3 };
  const base = defaultTemplate(1920, 1080, 'x');
  const words = [{ text: 'no', startMs: 0, endMs: 300 }, { text: 'puede', startMs: 300, endMs: 700 }, { text: 'ser', startMs: 700, endMs: 1000 }];
  it('la franja de camara respeta la proporcion elegida y es par', () => {
    const g = geometry('split', 1920, 1080, cam);
    expect(g.camH % 2).toBe(0);
    expect(g.camH).toBeGreaterThanOrEqual(1920 * 0.25);
    expect(g.camH).toBeLessThanOrEqual(1920 * 0.5);
    expect(geometry('half', 1920, 1080, cam).camH).toBe(960);
  });
  it('cada encuadre genera su cadena de filtros', () => {
    const o = { ...base, cam, srcW: 1920, srcH: 1080, accent: '#FFD400', maskIn: '1:v' };
    expect(layoutChain('b', 'o', { ...o, layout: 'split' })).toContain('vstack');
    expect(layoutChain('b', 'o', { ...o, layout: 'fit' })).toContain('boxblur');
    expect(layoutChain('b', 'o', { ...o, layout: 'pip' })).toContain('alphamerge');
    expect(layoutChain('b', 'o', { ...o, layout: 'crop', reframe: [{ t: 0, x: 0 }, { t: 5, x: 1 }] })).toContain('between(t,0.000,4.999)');
  });
  it('con dos imagenes apiladas el titulo va en la union', () => {
    const g = geometry('split', 1920, 1080, cam);
    expect(g.titleY).toBe(g.camH);
    expect(geometry('half', 1920, 1080, cam).titleY).toBe(960);
    expect(geometry('crop', 1920, 1080, cam).titleY).toBe(220);
  });
  it('el zoom entra y sale suave y el seguimiento interpola', () => {
    expect(zoomExpr([])).toBe('');
    expect(zoomExpr([{ id: 'z', a: 2, b: 5, scale: 1.4 }])).toContain('0.400*between(it,2.000,5.000)');
    expect(reframeExpr([{ t: 3, x: 0.2 }], 0.5)).toBe('0.200');
  });
  it('los subtitulos resaltan una palabra cada vez y las borradas no salen', () => {
    const spec = { captions: { ...base.captions, words: [...words, { text: 'fuera', startMs: 1000, endMs: 1300, del: true }] }, title: 'Titulo', credit: '@x', texts: [] };
    const ass = buildAss(spec, geometry('fit', 1920, 1080, cam), 5000);
    const caps = ass.split('\n').filter((l) => l.includes(',Cap,'));
    expect(caps).toHaveLength(3);
    expect(caps[1]).toContain('{\\c&H0000D4FF&}PUEDE');
    expect(ass).not.toContain('FUERA');
    expect(ass).toContain(',Title,');
  });
  it('el titulo como gancho solo se ve los primeros 5 s del video final (lo recortado no cuenta) y se desvanece', () => {
    const spec = { captions: { ...base.captions, words }, title: 'Hola', credit: '', titleFor: 5, segments: [{ a: 2, b: 20 }], texts: [] };
    const t = buildAss(spec, geometry('fit', 1920, 1080, cam), 30000).split('\n').find((l) => l.includes(',Title,'))!;
    expect(t).toMatch(/^Dialogue: 2,0:00:02\.00,0:00:07\.00,Title,/);
    expect(t).toContain('\\fad(0,250)');
    const all = buildAss({ ...spec, titleFor: undefined }, geometry('fit', 1920, 1080, cam), 30000).split('\n').find((l) => l.includes(',Title,'))!;
    expect(all, 'sin duracion: todo el clip').toMatch(/^Dialogue: 2,0:00:00\.00,0:00:30\.00,Title,/);
  });
  it('agrupa por numero de palabras y corta en el punto', () => {
    const w = 'uno dos. tres cuatro cinco seis'.split(' ').map((t, i) => ({ text: t, startMs: i * 300, endMs: i * 300 + 250 }));
    expect(chunk(w, 3).map((c) => c.map((x) => x.text).join(' '))).toEqual(['uno dos.', 'tres cuatro cinco', 'seis']);
  });
  it('la musica empieza donde se indica (su parte con fuerza) y el final se desvanece', () => {
    const spec = sanitize({ sid: 'x', start: 0, end: 20, music: { file: 'tema.mp3', vol: 0.2, start: 6.4 }, fadeOut: 0.5 }, base);
    expect(spec.music).toEqual({ file: 'tema.mp3', vol: 0.2, duck: true, start: 6.4 });
    const r = buildArgs({ spec, file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    const i = r.args.findIndex((a) => /tema\.mp3$/.test(a));
    expect(r.args.slice(i - 5, i)).toEqual(['-stream_loop', '-1', '-ss', '6.400', '-i']);
    const graph = r.args[r.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('afade=t=out:st=19.500:d=0.500');
    // Sin inicio indicado, la pista empieza desde el principio (sin -ss).
    const r2 = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 20, music: { file: 'tema.mp3', vol: 0.2 } }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    expect(r2.args.includes('-ss') && r2.args[r2.args.indexOf('-ss') + 1] === '6.400').toBe(false);
  });
  it('repeticion a camara lenta al final: dentro del clip, de 0,8 a 4 s, y suma su duracion ralentizada', () => {
    const spec = sanitize({ sid: 'x', start: 0, end: 20, replay: { a: 6, b: 8, speed: 0.5 } }, base);
    const r = buildArgs({ spec, file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    expect(r.total).toBeCloseTo(24, 3);
    const graph = r.args[r.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('trim=start=6.000:end=8.000,setpts=(PTS-STARTPTS)/0.500,framerate=fps=30[rv]');
    expect(graph).toContain('atempo=0.500');
    // Fuera de limites se recoloca; mas lento que 0,5 encadena dos atempo (el filtro no baja de 0,5).
    expect(sanitize({ sid: 'x', start: 0, end: 20, replay: { a: 19.9, b: 40, speed: 0.1 } }, base).replay).toEqual({ a: 19.2, b: 20, speed: 0.3 });
    expect(sanitize({ sid: 'x', start: 0, end: 20, replay: { a: 5, b: 30 } }, base).replay).toEqual({ a: 5, b: 9, speed: 0.5 });
    const slow = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 20, replay: { a: 6, b: 8, speed: 0.3 } }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    expect(slow.args[slow.args.indexOf('-filter_complex') + 1]).toContain('atempo=0.500,atempo=0.600');
    expect(sanitize({ sid: 'x', start: 0, end: 20 }, base).replay).toBeNull();
  });
  it('efecto de voz: en todo el clip o solo en la repeticion; uno que no existe se ignora', () => {
    const graph = (raw: any) => { const r = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 20, ...raw }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 }); return r.args[r.args.indexOf('-filter_complex') + 1]; };
    expect(graph({ voice: { fx: 'ardilla', on: 'todo' } })).toContain('aformat=channel_layouts=stereo,asetrate=69600,aresample=48000,atempo=0.6897[a0]');
    const only = graph({ voice: { fx: 'grave', on: 'repeticion' }, replay: { a: 6, b: 8, speed: 0.5 } });
    expect(only).toContain('atempo=0.500,asetrate=36000,aresample=48000,atempo=1.3333,volume=0.85[ra]');
    expect(only).not.toContain('asetrate=36000,aresample=48000,atempo=1.3333[a0]');
    expect(sanitize({ sid: 'x', start: 0, end: 20, voice: { fx: 'inventado', on: 'todo' } }, base).voice).toBeNull();
  });
  it('estabilizar va primero, sobre el video original', () => {
    const r = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 10, stabilize: true }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    expect(r.args[r.args.indexOf('-filter_complex') + 1].startsWith('[0:v]trim=start=0.000:duration=10.000,setpts=PTS-0.000/TB,fps=30,deshake=edge=mirror')).toBe(true);
    const r2 = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 10 }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    expect(r2.args[r2.args.indexOf('-filter_complex') + 1]).not.toContain('deshake');
  });
  it('con cortes y gancho la duracion final es la suma de lo conservado', () => {
    const spec = sanitize({ sid: 'x', start: 0, end: 30, hook: true, segments: [{ a: 0, b: 10 }, { a: 15, b: 30 }], sfx: [{ id: 'f', file: 'boom.wav', t: 3, vol: 1 }] }, base);
    const r = buildArgs({ spec, file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080, hookAt: 8 });
    expect(r.total).toBeCloseTo(25 + 2.8, 3);
    const graph = r.args[r.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('concat=n=2');
    expect(graph).toContain("select='between(t,0.000,10.000)+between(t,15.000,30.000)'");
    expect(graph).toContain('adelay=3000');
  });
});

import { parseChatFile } from '../src/clips/analysis/chat';
import { extraWords, heuristicScore, squash } from '../src/clips/analysis/detect';
import { buildOutroAss, creditTag } from '../src/clips/media/fast';
import { autoStickerItems, censorRanges, fitPlatform, isBad, maskWord } from '../src/clips/media/spec';
import { lengthFor, similar } from '../src/clips/engine';

describe('censura', () => {
  const cz = { on: true, mode: 'pitido' as const, text: true, extra: 'acme' };
  const w = (text: string, startMs: number, extra = {}) => ({ text, startMs, endMs: startMs + 300, ...extra });
  it('reconoce groserias con signos y mayusculas, y las palabras añadidas', () => {
    expect(isBad('¡MIERDA!')).toBe(true);
    expect(isBad('mesa')).toBe(false);
    expect(isBad('Acme', 'acme, otra')).toBe(true);
    expect(maskWord('¡mierda!')).toBe('¡m*****!');
  });
  it('calcula los tramos a tapar, une los pegados y respeta lo marcado a mano', () => {
    const words = [w('que', 0), w('mierda', 1000), w('hijueputa', 1320), w('acme', 5000), w('puta', 8000, { cen: false }), w('mesa', 9000, { cen: true })];
    const r = censorRanges(words, cz, 20);
    expect(r).toHaveLength(3);
    expect(r[0].a).toBeCloseTo(0.96, 2);
    expect(r[0].b).toBeCloseTo(1.66, 2);
    expect(r[2].a).toBeCloseTo(8.96, 2);
    expect(censorRanges(words, { ...cz, on: false }, 20)).toEqual([]);
  });
  it('el exportador silencia, pita y oculta la palabra en los subtitulos', () => {
    const base = defaultTemplate(1920, 1080, 'x');
    const words = [w('que', 0), w('mierda', 1000)];
    const spec = sanitize({ sid: 'x', start: 0, end: 20, censor: cz, mutes: censorRanges(words, cz, 20), captions: { ...base.captions, words } }, base);
    const r = buildArgs({ spec, file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    const graph = r.args[r.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain("volume=0:enable='between(t,0.960,1.340)'");
    expect(graph).toContain('sine=frequency=1000');
    expect(r.ass).toContain('M*****');
    expect(r.ass).not.toContain('MIERDA');
    const quiet = buildArgs({ spec: { ...spec, censor: { ...cz, mode: 'silencio' } }, file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    expect(quiet.args[quiet.args.indexOf('-filter_complex') + 1]).not.toContain('sine=');
  });
  it('variacion: tapa la groseria en los subtitulos sin tocar el audio; gamma y contraste +2%', () => {
    const base = defaultTemplate(1920, 1080, 'x');
    const words = [w('que', 0), w('mierda', 1000)];
    const spec = sanitize({ sid: 'x', start: 0, end: 20, vary: true, captions: { ...base.captions, words } }, base);
    const r = buildArgs({ spec, file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    const graph = r.args[r.args.indexOf('-filter_complex') + 1];
    expect(r.ass).toContain('M*****');
    expect(graph).not.toContain('sine=');
    expect(graph).toContain('contrast=1.020');
    expect(graph).toContain('gamma=1.02');
    expect(graph).toContain('hflip,scale=1102:1958,crop=1080:1920');
  });
});

describe('acabados del clip', () => {
  const base = defaultTemplate(1920, 1080, 'x');
  const graphOf = (extra: any) => {
    const r = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 30, ...extra }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080 });
    return { ...r, graph: r.args[r.args.indexOf('-filter_complex') + 1] };
  };
  it('sin opciones nuevas no añade filtros de mas', () => {
    const { graph, total } = graphOf({});
    expect(total).toBe(30);
    for (const f of ['gblur', 'saturation=', 'atempo', 'tpad', 'fade=', 'sidechaincompress', '[pbar]']) expect(graph).not.toContain(f);
  });
  it('la velocidad y el cierre cambian la duracion final', () => {
    const { graph, total, outroAss } = graphOf({ speed: 1.5, outro: { on: true, text: 'Sígueme', seconds: 2 }, progress: true, fadeOut: 1 });
    expect(total).toBeCloseTo(22, 3);
    expect(graph).toContain('atempo=1.500');
    expect(graph).toContain('tpad=stop_mode=clone:stop_duration=2.000');
    expect(graph).toContain("overlay=x='-w+w*t/22.000'");
    expect(graph).toContain('fade=t=out:st=21.000:d=1.000');
    expect(outroAss).toContain('SÍGUEME');
    expect(outroAss).toContain('0:00:20.00,0:00:22.00');
  });
  it('las zonas difuminadas se aplican antes del encuadre y solo en su tramo', () => {
    const { graph } = graphOf({ blurs: [{ id: 'a', x: 0.7, y: 0.1, w: 0.3, h: 0.5, a: 2, b: 9 }, { id: 'b', x: 0, y: 0, w: 0.2, h: 0.1, a: 5, b: 6, all: true }] });
    expect(graph).toContain("overlay=x=main_w*0.7000:y=main_h*0.1000:enable='between(t,2.000,9.000)'[base1]");
    expect(graph).toContain("enable='between(t,0.000,30.000)'[base2]");
    expect(graph.indexOf('gblur')).toBeLessThan(graph.indexOf('boxblur'));
  });
  it('el color, la musica que baja sola y el credito en una esquina', () => {
    const { graph, ass } = graphOf({ color: { brightness: 0, contrast: 1.1, saturation: 0 }, music: { file: 'pista.mp3', vol: 0.2 }, credit: '@yo', creditPos: 'tr' });
    expect(graph).toContain('eq=brightness=0.000:contrast=1.100:saturation=0.000,ass=');
    expect(graph).toContain('sidechaincompress');
    expect(ass).toContain(creditTag('tr') + '@yo');
    expect(buildOutroAss('hola', '', 0, 1000)).not.toContain('Small,,');
  });
  it('la version de cada plataforma saca subtitulos y credito de debajo de los botones', () => {
    const t = fitPlatform({ ...base, captions: { ...base.captions, posY: 92 }, texts: [{ id: 't', text: 'x', x: 0.5, y: 0.97, size: 70, color: '#fff', box: false, a: 0, b: 2 }] }, 'tiktok');
    expect(t.captions.posY).toBeLessThan(75);
    expect(t.creditLift).toBeGreaterThanOrEqual(420);
    expect(t.texts[0].y).toBeLessThan(0.8);
    expect(fitPlatform(base, 'otra')).toBe(base);
  });
  it('los stickers automaticos salen donde se dice la palabra, sin amontonarse', () => {
    const ws = ['hola', 'jajaja', 'jajaja', 'bueno', 'nooo', 'gg'].map((text, i) => ({ text, startMs: [0, 2000, 3000, 9000, 10000, 20000][i], endMs: [0, 2000, 3000, 9000, 10000, 20000][i] + 300 }));
    const s = autoStickerItems(ws, 30, ['jajaja.png', 'nooo.png']);
    expect(s.map((x) => x.file)).toEqual(['jajaja.png', 'nooo.png']);
    expect(s[0].a).toBeCloseTo(1.9, 2);
  });
});

describe('deteccion y aprendizaje nuevos', () => {
  it('por encima de 8 la puntuacion se comprime en vez de empatar en 10', () => {
    expect(squash(6)).toBe(6);
    expect(squash(10)).toBeLessThan(squash(12));
    expect(squash(14.5)).toBeLessThan(10);
    const a = heuristicScore(5, 'nooo jajaja wtf no puede ser', 10, 4, 5).score, b = heuristicScore(5, 'nooo jajaja wtf no puede ser brutal imposible', 10, 8, 6).score;
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(10);
  });
  it('las palabras propias del streamer suben la puntuacion', () => {
    const re = extraWords(['qué chimba', 'parcero']);
    const plain = heuristicScore(2, 'eso estuvo qué chimba parcero', 20);
    const own = heuristicScore(2, 'eso estuvo qué chimba parcero', 20, 0, 0, re);
    expect(own.score).toBeGreaterThan(plain.score);
    expect(own.why).toContain('2 palabras típicas');
    expect(extraWords([])).toBeNull();
  });
  it('lee el chat guardado de Twitch y de YouTube', () => {
    const twitch = JSON.stringify([{ content_offset_seconds: 5.2, message: { body: 'clip eso' } }, { content_offset_seconds: 5.9, message: { body: 'jajaja' } }, { content_offset_seconds: 130, message: { body: 'hola' } }]);
    const t = parseChatFile(twitch);
    expect(t.rate[5]).toBe(2);
    expect(t.clip![5]).toBe(1);
    expect(t.rate).toHaveLength(131);
    expect(parseChatFile(twitch, 100).rate[30]).toBe(1);
    const yt = [{ replayChatItemAction: { videoOffsetTimeMsec: '61000', actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text: 'NOOO ' }, { text: 'xd' }] } } } } }] } }, { otra: 1 }].map((x) => JSON.stringify(x)).join('\n');
    const y = parseChatFile(yt + '\n{roto');
    expect(y.rate[61]).toBe(1);
    expect(y.hype[61]).toBe(1);
  });
  it('los ejemplos marcan cuanto se guarda antes y despues del pico', () => {
    expect(lengthFor([])).toEqual([28, 12]);
    expect(lengthFor([{ seconds: 30, peakPos: 0.8 }])).toEqual([28, 12]);
    expect(lengthFor([{ seconds: 20, peakPos: 0.75 }, { seconds: 24, peakPos: 0.8 }, { seconds: 60, peakPos: 0.5 }])).toEqual([18, 6]);
  });
  it('detecta el mismo momento contado con las mismas palabras', () => {
    const a = 'no puede ser que haya ganado esa partida con un solo punto de vida';
    expect(similar(a, a + ' jajaja')).toBeGreaterThan(0.6);
    expect(similar(a, 'vamos a revisar el inventario antes de salir del pueblo ahora')).toBeLessThan(0.2);
    expect(similar('hola', 'hola')).toBe(0);
  });
});

describe('calidad alta y voz clara', () => {
  const base = defaultTemplate(1920, 1080, 'x');
  const run = (extra: any, fast = false) => { const r = buildArgs({ spec: sanitize({ sid: 'x', start: 0, end: 30, layout: 'split', ...extra }, base), file: 'in.mp4', outDir: '/tmp/x', srcW: 1920, srcH: 1080, fast }); return { args: r.args, graph: r.args[r.args.indexOf('-filter_complex') + 1] }; };
  it('en normal no se añade nitidez, pero todo se amplia con lanczos y con buena compresion', () => {
    const { args, graph } = run({});
    for (const f of ['cas=', 'accurate_rnd', 'deblock', 'hqdn3d']) expect(graph).not.toContain(f);
    expect(graph, 'el volumen siempre a -14 LUFS').toContain('loudnorm=I=-14');
    expect(graph, 'la camara se amplia con lanczos tambien en normal').toContain('flags=lanczos,');
    expect(graph, 'el juego tambien').not.toMatch(/force_original_aspect_ratio=increase,crop/);
    expect(args[args.indexOf('-crf') + 1]).toBe('19');
    expect(args[args.indexOf('-preset') + 1]).toBe('fast');
  });
  it('en alta la camara se limpia, se amplia mejor y se afila mas que el juego', () => {
    const { args, graph } = run({ quality: 'alta' });
    expect(graph).toContain('deblock=filter=weak');
    expect(graph).toContain('hqdn3d=1.2:1.2:3:3,scale=1080:');
    expect(graph).toContain('flags=lanczos+accurate_rnd');
    expect(graph).toContain('cas=0.6');
    expect(graph).toContain('cas=0.35');
    expect(graph).toContain('loudnorm=I=-14');
    expect(args[args.indexOf('-crf') + 1]).toBe('17');
    expect(args[args.indexOf('-preset') + 1]).toBe('medium');
  });
  it('el modo rapido manda sobre la calidad alta', () => {
    const { args, graph } = run({ quality: 'alta' }, true);
    expect(graph).not.toContain('cas=');
    expect(args[args.indexOf('-preset') + 1]).toBe('superfast');
    expect(args[args.indexOf('-crf') + 1]).toBe('21');
  });
  it('la voz clara usa el modelo de voz, realza y nivela', () => {
    const { graph } = run({ cleanAudio: true });
    expect(graph).toContain('arnndn=m=');
    expect(graph).toContain('voz.rnnn');
    expect(graph).toContain('acompressor');
    expect(graph).toContain('loudnorm=I=-14');
  });
});

import { heatOf } from '../src/clips/engine';
describe('v10: medidor', () => {
  it('el medidor sube con un pico de volumen y con el chat', () => {
    const calm = Array.from({ length: 120 }, (_, i) => -50 + (i % 3));
    expect(heatOf(calm, null).heat).toBeLessThan(40);
    const loud = [...calm.slice(0, 115), -20, -20, -20, -20, -20];
    expect(heatOf(loud, null).heat).toBe(100);
    const rate = Array.from({ length: 120 }, (_, i) => (i > 112 ? 30 : 1));
    expect(heatOf(calm, rate).z).toBeGreaterThan(heatOf(calm, null).z);
  });
});

import { channelInfo, clipWindow } from '../src/clips/engine';
describe('clips de la comunidad', () => {
  it('reconoce canales de Twitch y Kick (y nada mas)', () => {
    expect(channelInfo('https://www.twitch.tv/auronplay')).toEqual({ platform: 'twitch', channel: 'auronplay' });
    expect(channelInfo('https://kick.com/westcol/clips')).toEqual({ platform: 'kick', channel: 'westcol' });
    expect(channelInfo('https://youtube.com/@x')).toBeNull();
    expect(channelInfo('D:/videos/a.mp4')).toBeNull();
  });
  it('un clip recoge los segundos anteriores al momento en que se creo, dentro de la grabacion', () => {
    const rec0 = Date.parse('2026-10-13T02:00:00Z');
    expect(clipWindow({ at: '2026-10-13T02:10:00Z', seconds: 30 }, rec0, 3600)).toEqual({ a: 570, b: 600 });
    expect(clipWindow({ at: '2026-10-13T01:59:00Z', seconds: 30 }, rec0, 3600)).toBeNull(); // antes de grabar
    // Casi todo antes de grabar (30 s que acaban a los 6 s): lo grabado ahi es otra cosa, a menudo la pantalla de anuncios.
    expect(clipWindow({ at: '2026-10-13T02:00:06Z', seconds: 30 }, rec0, 3600)).toBeNull();
    expect(clipWindow({ at: '2026-10-13T02:00:07Z', seconds: 8 }, rec0, 3600)).toEqual({ a: 0, b: 7 }); // la mayor parte dentro: vale
    expect(clipWindow({ at: '2026-10-13T03:30:00Z', seconds: 30 }, rec0, 3600)).toBeNull(); // despues de grabar
    expect(clipWindow({ at: '2026-10-13T03:00:20Z', seconds: 60 }, rec0, 3600)).toEqual({ a: 3560, b: 3600 }); // empieza dentro y acaba fuera: hasta el final
  });
});

describe('anuncios de Twitch', () => {
  // Pantalla de anuncio sintetica: degradado con las letras del logo en blanco y su contorno en negro.
  const W1 = [1990, 2000, 2001, 2007, 2150, 2151, 2153, 2155, 2157, 2160, 2161, 2164, 2165, 2167, 2168, 2169, 2310, 2313, 2315, 2317, 2320, 2323, 2327, 2329, 2470, 2471, 2473, 2474, 2475, 2476, 2481, 2483, 2484, 2485, 2487, 2489];
  const D1 = [1831, 1845, 1846, 1848, 1992, 1994, 2003, 2311, 2312, 2322, 2325, 2328, 2488, 2637, 2640, 2643, 2648, 2791, 2792, 2793, 2794, 2795, 2796, 2797, 2798, 2799, 2800, 2801, 2802, 2803, 2804, 2805, 2806, 2807, 2808, 2809];
  it('reconoce la pantalla de anuncio y no un fotograma normal', () => {
    const ad = new Uint8Array(160 * 90).map((_, k) => 90 + (k % 160) / 4);
    for (const k of W1) ad[k] = 240;
    for (const k of D1) ad[k] = 20;
    expect(isAdFrame(ad)).toBe(true);
    const bright = new Uint8Array(160 * 90).fill(230); // una camara muy iluminada: blanco, pero sin el contorno
    expect(isAdFrame(bright)).toBe(false);
    expect(isAdFrame(new Uint8Array(160 * 90).map((_, k) => (k * 37) % 256))).toBe(false);
  });
  it('junta los segundos de anuncio en tramos con margen', () => {
    expect(adSpans([0, 0, 1, 1, 1, 0, 0, 0, 1, 1])).toEqual([[1, 6], [7, 11]]);
  });
  it('un momento que pisa un anuncio se queda con su parte limpia mas larga', () => {
    expect(withoutAds(5, 45, [[0, 31]])).toEqual({ a: 31, b: 45 });
    expect(withoutAds(440, 480, [[457, 519]])).toEqual({ a: 440, b: 457 });
    expect(withoutAds(100, 140, [[457, 519]])).toEqual({ a: 100, b: 140 });
    expect(withoutAds(20, 36, [[0, 31]]), 'lo que queda es demasiado corto').toBeNull();
  });
});
