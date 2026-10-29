import { describe, expect, it } from 'vitest';
import { buildPrompt, phrasesOf } from '../src/clips/analysis/agent';
import type { StyleEvents } from '../src/clips/analysis/refstyle';
import { MAX_CASES, cleanTiktok, hookExamples, looksSpanish, nextTiktok, parseCount, parseHandles, keepBest, learnFrom, lessonFor, lessonLines, nextSearch, pickVideos, studyCase, TOPICS, type Case } from '../src/clips/analysis/school';

/** Palabras con tiempos: cada frase empieza en su segundo y sus palabras van cada 0,3 s. */
const say = (...frases: [number, string][]) => frases.flatMap(([t, f]) => f.split(' ').map((w, i) => ({ text: w, startMs: Math.round((t + i * 0.3) * 1000), endMs: Math.round((t + i * 0.3 + 0.25) * 1000) })));
/** Volumen por segundo: normal, con gritos en los segundos indicados. */
const loud = (n: number, at: number[]) => Array.from({ length: n }, (_, i) => (at.includes(i) ? -8 : -30 + (i % 3)));

// Un short editado como los buenos: empieza con pregunta, zoom 0,4 s despues de cada grito, cortes en las pausas.
const words = say([0.2, '¿sabes cuanto gana un streamer?'], [3, 'pues te lo voy a contar'], [7, 'gana muchisimo dinero'], [11, 'y lo peor es que no hace nada'], [16, 'increible de verdad']);
const ev: StyleEvents = {
  seconds: 20,
  changes: [{ t: 2.0, gradual: false }, { t: 6.4, gradual: false }, { t: 10.5, gradual: false }, { t: 15.5, gradual: true }],
  zooms: [{ t: 7.6, s: 1.3, punch: true }, { t: 12.6, s: 1.2, punch: false }],
  lufs: -14,
};
const base = { id: 'a', title: 'Cuanto gana un streamer', views: 2_000_000, topic: 'podcast', ev, words, energy: loud(20, [7, 12]) };

describe('escuela del agente: estudiar un short', () => {
  it('mide como empieza, que hace tras los momentos fuertes y donde corta', () => {
    const c = studyCase(base);
    expect(c.hook.kind).toBe('pregunta');
    expect(c.hook.text).toContain('streamer');
    expect(c.hook.shot).toBe(2);
    expect(c.peaks).toBeGreaterThanOrEqual(2);
    expect(c.peakZoom).toBe(2); // los dos gritos llevan zoom
    expect(c.delays.every((d) => d >= 0 && d <= 1.5)).toBe(true);
    expect(c.cuts).toBe(3); // la transicion no es un corte seco
    expect(c.cutPause).toBe(3); // los tres caen entre frases
    expect(c.style.cutsPerMin).toBeGreaterThan(0);
  });
  it('un corte a mitad de palabra no cuenta como pausa; sin voz al principio el gancho es la imagen', () => {
    const c = studyCase({ ...base, words: say([4, 'esto es una frase bastante larga que sigue y sigue sin parar nunca']), ev: { ...ev, changes: [{ t: 5.2, gradual: false }] } });
    expect(c.hook.kind).toBe('sin voz');
    expect(c.cuts).toBe(1);
    expect(c.cutPause).toBe(0);
  });
});

const fake = (i: number, o: Partial<Case> = {}): Case => ({
  id: 'v' + i, title: 't' + i, views: 100_000 * (i + 1), topic: i % 2 ? 'podcast' : 'humor', at: '', mood: 'charla', wps: 2.5,
  style: { seconds: 30, cutsPerMin: 20, shotMed: 2, transRatio: 0.1, zoomsPerMin: 4, zoomScale: 1.3, lufs: -14 },
  hook: { text: 'te voy a contar algo', kind: 'afirmacion', shot: 1.5 }, peaks: 3, peakZoom: 2, peakCut: 1, delays: [0.4, 0.5], cuts: 6, cutPause: 5, ...o,
});

describe('escuela del agente: aprender de muchos', () => {
  it('con pocos videos no saca conclusiones', () => {
    expect(learnFrom([fake(1), fake(2)])).toBeNull();
    expect(lessonLines(null)).toEqual([]);
  });
  it('resume lo comun y lo cuenta en frases', () => {
    const k = learnFrom(Array.from({ length: 10 }, (_, i) => fake(i)))!;
    expect(k.n).toBe(10);
    expect(k.topics).toEqual({ humor: 5, podcast: 5 });
    expect(k.all.peakZoom).toBeCloseTo(2 / 3, 2);
    expect(k.all.cutPause).toBeCloseTo(5 / 6, 2);
    expect(k.all.style.shotMed).toBe(2);
    const lines = lessonLines(k).join('\n');
    expect(lines).toContain('10 shorts');
    expect(lines).toContain('67 %'); // zoom tras los momentos fuertes
    expect(lines).toContain('una afirmación directa');
  });
  it('los mas vistos pesan mas', () => {
    const cs = [...Array.from({ length: 5 }, (_, i) => fake(i, { views: 60_000, style: { ...fake(0).style, shotMed: 4 } })),
      ...Array.from({ length: 4 }, (_, i) => fake(10 + i, { views: 20_000_000, style: { ...fake(0).style, shotMed: 1.5 } }))];
    expect(learnFrom(cs)!.all.style.shotMed).toBe(1.5);
  });
  it('cada tono tiene sus lecciones cuando hay videos suficientes', () => {
    const cs = [...Array.from({ length: 6 }, (_, i) => fake(i, { mood: 'risa', hook: { text: 'jajaja no puede ser', kind: 'exclamacion', shot: 1 } })), ...Array.from({ length: 3 }, (_, i) => fake(20 + i))];
    const k = learnFrom(cs)!;
    expect(lessonFor(k, 'risa')!.n).toBe(6);
    expect(lessonFor(k, 'sorpresa')).toBe(k.all); // sin videos de ese tono, lo de todos
    expect(lessonLines(k, 'risa')[0]).toContain('risa');
    expect(hookExamples(k, 'risa')[0]).toMatch(/^«jajaja no puede ser» \(.+ vistas, (humor|podcast)\)$/);
  });
  it('lo aprendido llega al encargo del agente', () => {
    const k = learnFrom(Array.from({ length: 10 }, (_, i) => fake(i)))!;
    const { system, user } = buildPrompt({ phrases: phrasesOf(words), beats: [], dur: 20, maxBeats: 2, lessons: lessonLines(k), hooks: hookExamples(k) });
    expect(system).toContain('podcast');
    expect(user).toContain('LO APRENDIDO:');
    expect(user).toContain('Ganchos que funcionaron:');
    expect(buildPrompt({ phrases: phrasesOf(words), beats: [], dur: 20, maxBeats: 2 }).user).not.toContain('LO APRENDIDO');
  });
});

describe('escuela del agente: que estudiar', () => {
  it('rota por el tema menos estudiado, incluidos los streamers del usuario', () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(6);
    const first = nextSearch([], 0);
    const many = TOPICS.flatMap((t) => (t.topic === first.topic ? [] : [fake(0, { topic: t.topic })]));
    expect(nextSearch([fake(0, { topic: first.topic }), ...many], 0, ['auronplay'])).toEqual({ topic: 'tus streamers', q: 'auronplay clips' });
    expect(nextSearch([], 1).q).not.toBe(nextSearch([], 0).q); // cada ronda, otra busqueda del tema
  });
  it('elige shorts con vistas que no se han visto, los mas vistos primero', () => {
    const es = 'me paso esto en el podcast';
    const list = [
      { id: 'a', title: es, views: 900_000, seconds: 40 }, { id: 'b', title: '¿Cuánto gana un streamer?', views: 3_000_000, seconds: 30 },
      { id: 'c', title: es, views: 5_000_000, seconds: 300 }, { id: 'd', title: es, views: 1_000, seconds: 30 }, { id: 'e', title: es, views: 8_000_000, seconds: 20 },
      { id: 'f', title: 'What she said on the podcast was crazy', views: 9_000_000, seconds: 40 }, { id: 'g', title: 'What he said to me was crazy', views: 9_000_000, seconds: 30 },
    ];
    expect(pickVideos(list, new Set(['e']), 2).map((x) => x.id)).toEqual(['b', 'a']); // ni el muy largo, ni el de pocas vistas, ni los de ingles
  });
  it('distingue titulos en español de titulos en ingles', () => {
    expect(looksSpanish('AURON PIERDE la APUESTA')).toBe(true);
    expect(looksSpanish('Lo que nadie te cuenta del dinero #shorts')).toBe(true);
    expect(looksSpanish('The best podcast moment of the year')).toBe(false);
    expect(looksSpanish('DHARIUS entrevista')).toBe(true); // nombres y palabras sueltas: se aceptan
    expect(looksSpanish('Elo Podcast Ninfa Ice Challenge')).toBe(true);
  });
  it('si hay demasiados, salen los menos vistos del tema con mas videos', () => {
    const cs = Array.from({ length: MAX_CASES + 3 }, (_, i) => fake(i, { topic: i < 10 ? 'raro' : 'comun' }));
    const kept = keepBest(cs);
    expect(kept).toHaveLength(MAX_CASES);
    expect(kept.filter((c) => c.topic === 'raro')).toHaveLength(10);
    expect(kept.some((c) => c.id === 'v10')).toBe(false); // el menos visto de «comun»
  });
});

describe('escuela del agente: TikTok', () => {
  it('entiende creadores y hashtags escritos de cualquier forma', () => {
    expect(parseHandles('@auronplay, https://www.tiktok.com/@ibai/video/123  elrubius @auronplay', 'creator')).toEqual(['auronplay', 'ibai', 'elrubius']);
    expect(parseHandles('#podcast humor, https://www.tiktok.com/tag/entrevista #', 'tag')).toEqual(['podcast', 'humor', 'entrevista']);
    expect(parseHandles('<script>, @@', 'creator')).toEqual([]);
    expect(cleanTiktok({ creators: '@a.b', tags: ['#x1'] })).toEqual({ creators: ['a.b'], tags: ['x1'] });
  });
  it('lee las vistas como las escribe TikTok', () => {
    expect(parseCount('1.2M')).toBe(1_200_000);
    expect(parseCount('1,2 M')).toBe(1_200_000);
    expect(parseCount('850.4K')).toBe(850_400);
    expect(parseCount('15 mil')).toBe(15_000);
    expect(parseCount('9876')).toBe(9876);
    expect(parseCount('12.345')).toBe(12345);
    expect(parseCount('')).toBe(0);
  });
  it('rota por creadores y hashtags; sin ninguno, no hay TikTok', () => {
    const cfg = { creators: ['ibai'], tags: ['podcast'] };
    expect(nextTiktok(cfg, 0)).toEqual({ topic: 'tiktok @ibai', url: 'https://www.tiktok.com/@ibai' });
    expect(nextTiktok(cfg, 1)).toEqual({ topic: 'tiktok #podcast', url: 'https://www.tiktok.com/tag/podcast' });
    expect(nextTiktok({ creators: [], tags: [] }, 0)).toBeNull();
    expect(nextTiktok(undefined, 0)).toBeNull();
  });
  it('un TikTok sin duracion conocida se puede elegir (se comprueba al descargarlo)', () => {
    expect(pickVideos([{ id: 'tt:1', url: 'u', title: 'me paso esto', views: 2_000_000, seconds: 0 }], new Set(), 2)).toHaveLength(1);
  });
});

describe('escuela del agente: lo que elige el usuario', () => {
  it('saca los enlaces de video de lo que se pega, sin repetir', async () => {
    const { parseLinks } = await import('../src/clips/analysis/school');
    expect(parseLinks('mira https://www.tiktok.com/@a/video/123?lang=es y https://youtube.com/shorts/xyz.\nhttps://www.tiktok.com/@a/video/123?lang=es https://evil.com/x https://www.instagram.com/reel/abc/'))
      .toEqual(['https://www.tiktok.com/@a/video/123?lang=es', 'https://youtube.com/shorts/xyz', 'https://www.instagram.com/reel/abc/']);
    expect(parseLinks('nada por aqui')).toEqual([]);
  });
  it('lo que elige el usuario pesa mas que lo que encuentra sola', () => {
    // A partes iguales, lo elegido gana aunque no tenga vistas conocidas.
    const cs = [...Array.from({ length: 4 }, (_, i) => fake(i, { views: 5_000_000, style: { ...fake(0).style, shotMed: 4 } })),
      ...Array.from({ length: 4 }, (_, i) => fake(20 + i, { views: 0, mine: true, style: { ...fake(0).style, shotMed: 1.5 } }))];
    expect(learnFrom(cs)!.all.style.shotMed).toBe(1.5);
  });
  it('encuentra los videos en los datos que recibe TikTok, esten donde esten', async () => {
    const { itemsIn } = await import('../src/clips/publish/tiktok');
    const got: any[] = [];
    itemsIn({ data: [{ type: 1, item: { id: '7400000000000000001', desc: 'hola  mundo', author: { uniqueId: 'ibai' }, stats: { playCount: 1200000 }, video: { duration: 34 } } }], itemList: [{ id: '7400000000000000002', author: { uniqueId: 'x' }, stats: { playCount: 5 } }, { id: 'no', author: {}, stats: {} }] }, (v) => got.push(v));
    expect(got).toEqual([
      { id: 'tt:7400000000000000001', url: 'https://www.tiktok.com/@ibai/video/7400000000000000001', title: 'hola mundo', views: 1_200_000, seconds: 34 },
      { id: 'tt:7400000000000000002', url: 'https://www.tiktok.com/@x/video/7400000000000000002', title: '', views: 5, seconds: 0 },
    ]);
  });
});
