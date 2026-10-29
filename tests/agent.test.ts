import { describe, expect, it } from 'vitest';
import { buildPrompt, checkPlan, dropFromSegments, phrasesOf } from '../src/clips/analysis/agent';
import { direct, type DirectorInput } from '../src/clips/analysis/director';

/** Palabras con tiempos: cada frase empieza en su segundo y sus palabras van cada 0,3 s. */
const say = (...frases: [number, string][]) => frases.flatMap(([t, f]) => f.split(' ').map((w, i) => ({ text: w, startMs: Math.round((t + i * 0.3) * 1000), endMs: Math.round((t + i * 0.3 + 0.25) * 1000) })));
const words = say([0, 'bueno a ver que estaba diciendo'], [4, 'el otro dia fui al super.'], [9, 'y me encuentro a mi ex'], [14, '¡con mi mejor amigo!'], [19, 'no me lo podia creer'], [24, 'en fin sigamos con el juego']);
const phrases = phrasesOf(words);

describe('agente editor: frases y red de seguridad', () => {
  it('agrupa la transcripcion en frases numeradas con su tiempo', () => {
    expect(phrases.map((p) => p.i)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(phrases[3].text).toBe('¡con mi mejor amigo!');
    expect(phrases[3].a).toBeCloseTo(14, 1);
    const { user } = buildPrompt({ phrases, beats: [{ t: 14.2, kind: 'grito', w: 3 }], dur: 30, maxBeats: 3 });
    expect(user).toContain('[4] 14.0–');
    expect(user).toContain('14.2 s: grito');
  });
  it('convierte un buen plan en tiempos exactos, con sus porques', () => {
    const p = checkPlan({
      tono: 'risa', gancho: { frase: 4, por_que: 'es el giro' },
      quitar: [{ frase: 1, por_que: 'arranque sin contenido' }, { frase: 6, por_que: 'cambia de tema' }],
      remarcar: [{ frase: 4, palabra: 'amigo', tipo: 'golpe', por_que: 'el remate' }, { frase: 5, palabra: 'creer', tipo: 'zoom', por_que: 'reaccion' }],
      resaltar: ['ex', 'amigo', 'palabra-que-no-esta'], titulo: 'Me encuentro a mi ex con mi mejor amigo',
    }, phrases, words, 30, 3);
    expect(p.mood).toBe('risa');
    expect(p.hook!.seg.a).toBeCloseTo(13.85, 2);
    expect(p.hook!.why).toBe('es el giro');
    expect(p.beats.map((b) => [b.kind, b.word])).toEqual([['golpe', 'amigo!'], ['zoom', 'creer']]);
    expect(p.beats[0].t).toBeCloseTo(14.9, 1); // la palabra exacta, no la mitad de la frase
    expect(p.drop.map((d) => d.why)).toEqual(['arranque sin contenido', 'cambia de tema']);
    expect(p.highlight).toEqual(['ex', 'amigo']); // solo palabras que existen en la transcripcion
    expect(p.title).toContain('mi ex');
  });
  it('descarta lo que no tiene sentido: frases inventadas, quitar el gancho o el remate, quitar demasiado', () => {
    const p = checkPlan({
      tono: 'raro', gancho: { frase: 99 },
      quitar: [{ frase: 4 }, { frase: 1 }, { frase: 2 }, { frase: 3 }, { frase: 6 }],
      remarcar: [{ frase: 4, palabra: 'amigo', tipo: 'golpe' }, { frase: 4, palabra: 'mejor', tipo: 'zoom' }, { frase: 5, tipo: 'explosion' }, { frase: 77, tipo: 'zoom' }],
    }, phrases, words, 30, 3);
    expect(p.mood).toBeUndefined();
    expect(p.hook).toBeUndefined();
    expect(p.beats).toHaveLength(1); // el segundo esta demasiado cerca, el tercero tiene un tipo desconocido, el cuarto no existe
    expect(p.drop.some((d) => d.seg.a >= 13.9 && d.seg.a <= 14.1)).toBe(false); // nunca la frase del remate
    expect(p.drop.reduce((t, d) => t + d.seg.b - d.seg.a, 0)).toBeLessThanOrEqual(30 * 0.25);
  });
  it('protege lo que vimos fallar con clips reales', () => {
    const w2 = say([0, 'oye una pregunta'], [3, '¿como le pondrias a tu hijo de nombre?'], [7, '¿que?'], [8.5, 'pues no se tio'], [12, 'yo lo meteria en una incubadora'], [17, 'bueno sigamos que si no']);
    const k = w2.findIndex((w) => w.text === 'nombre?');
    w2.splice(k + 1, 0, { text: '?', startMs: w2[k].endMs + 20, endMs: w2[k].endMs + 60 }); // la transcripcion separa los signos
    const ph2 = phrasesOf(w2);
    expect(ph2.some((p) => p.text === '?')).toBe(false); // un «?» suelto no es una frase
    const p = checkPlan({
      gancho: { frase: 1 }, // la primera frase no es un gancho
      quitar: [{ frase: 2 }, { frase: 3 }, { frase: 6 }], // la preparacion del chiste, una exclamacion corta y una frase que sobra
      remarcar: [{ frase: 5, palabra: 'incubadora', tipo: 'zoom' }, { frase: 2, palabra: '?', tipo: 'golpe' }],
    }, ph2, w2, 22, 3);
    expect(p.hook).toBeUndefined();
    expect(p.drop.map((d) => Math.round(d.seg.a))).toEqual([17]); // ni la pregunta que prepara el remate ni el «¿que?»
    expect(p.beats.find((b) => b.kind === 'golpe')?.word).toBeUndefined(); // un signo no es la palabra a remarcar
    expect(w2.some((w) => w.text.endsWith('nombre??'))).toBe(false); // las palabras de los subtitulos no se tocan
  });
  it('una respuesta vacia o rota no rompe nada', () => {
    expect(checkPlan(null, phrases, words, 30, 3)).toEqual({ drop: [], beats: [], highlight: [] });
    expect(checkPlan('texto', phrases, words, 30, 3).beats).toEqual([]);
  });
  it('quitar frases no deja trozos sueltos', () => {
    const segs = dropFromSegments([{ a: 0, b: 30 }], [{ a: 4, b: 7 }, { a: 7.8, b: 12 }], 1.5);
    expect(segs).toEqual([{ a: 0, b: 4 }, { a: 12, b: 30 }]); // el trozo de 0,8 s entre las dos se va tambien
  });
  it('el director usa el tono y los momentos del agente, con su porque', () => {
    const base: DirectorInput = { words, energyZ: Array(30).fill(0.2), dur: 30, react: { at: 14.9, react: 3, cam: 0 }, multiCam: true, hook: true, sfx: ['pop.wav', 'boom.wav'], styles: ['amarillo', 'impacto', 'neon'], seed: 'a' };
    const plan = checkPlan({ tono: 'risa', remarcar: [{ frase: 4, palabra: 'amigo', tipo: 'golpe', por_que: 'el remate' }, { frase: 5, palabra: 'creer', tipo: 'zoom', por_que: 'reaccion' }, { frase: 3, palabra: 'ex', tipo: 'sonido', por_que: 'sorpresa' }] }, phrases, words, 30, 3);
    const r = direct({ ...base, agent: plan });
    expect(r.read.mood).toBe('risa');
    expect(r.patch.punches![0].why).toBe('el remate');
    expect(r.patch.zooms!.some((z) => z.why === 'reaccion')).toBe(true);
    expect(r.patch.sfx!.find((x) => x.why === 'sorpresa')!.file).toBe('pop.wav');
    expect(r.done).toContain('momentos elegidos por el agente editor');
  });
});
