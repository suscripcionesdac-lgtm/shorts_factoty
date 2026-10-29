import { describe, expect, it } from 'vitest';
import { localTitles, trendHashtags, trendOf } from '../src/clips/analysis/trends';
import { HYPE } from '../src/clips/analysis/detect';

const items = [
  { title: 'AURON SE CABREA con el CHAT 😱 #auronplay #shorts', views: 900_000, seconds: 32 },
  { title: 'AURON PIERDE la APUESTA 😂 #auronplay', views: 700_000, seconds: 28 },
  { title: 'El CHAT no se lo cree 😱 #shorts', views: 650_000, seconds: 35 },
  { title: 'auronplay hablando de su perro', views: 3_000, seconds: 58 },
  { title: 'Lo mejor de AuronPlay #shorts', views: 20, seconds: 60 },
  { title: 'auronplay en directo parte 2', views: 15, seconds: 61 },
  { title: 'video largo del directo', views: 1_000_000, seconds: 1200 }, // no es un Short: no cuenta
];

describe('tendencias en Shorts', () => {
  it('saca la duracion, las palabras y el estilo de los mas vistos', () => {
    const t = trendOf(items, 'auronplay')!;
    expect(t.n).toBe(6);
    expect(t.seconds).toBe(32);
    expect(t.words).toContain('chat');
    expect(t.words).not.toContain('auronplay'); // el nombre del streamer no es una tendencia
    expect(t.hashtags[0]).toBe('#auronplay');
    expect(t.caps).toBeGreaterThanOrEqual(0.5);
    expect(t.emoji).toBe(1);
    expect(t.titles[0].v).toBe(900_000);
  });
  it('con pocos Shorts no inventa tendencias', () => {
    expect(trendOf(items.slice(0, 3), 'auronplay')).toBeNull();
  });
  it('titulos sin IA: la frase mas intensa, con el estilo de la tendencia', () => {
    const t = trendOf(items, 'auronplay')!;
    const titles = localTitles('bueno pues nada vamos a ver esto no puede ser que el chat haga esto jajaja', 'Auron', t, HYPE);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles[0]).toBe(titles[0].toUpperCase()); // los mas vistos van en mayusculas
    expect(titles[0]).toMatch(/NO PUEDE SER/);
    for (const x of titles) expect(x.length).toBeLessThanOrEqual(60);
  });
  it('hashtags: como los canales de clips (#<streamer>clips, #clipsvirales, el del streamer), sin #shorts ni repetir', () => {
    expect(trendHashtags(trendOf(items, 'auronplay'), 'AuronPlay')).toEqual(['#auronplayclips', '#clipsvirales', '#auronplay']);
    expect(trendHashtags(null, 'ibai')).toEqual(['#ibaiclips', '#clipsvirales', '#ibai']);
  });
});
