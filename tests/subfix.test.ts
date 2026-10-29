import { describe, expect, it } from 'vitest';
import { aiFix, alignText, countChanges, editDistance, ruleFix, sameRatio } from '../src/clips/media/subfix';
const W = (t: string) => t.split(' ').map((text, i) => ({ text, startMs: i * 400, endMs: i * 400 + 380 }));
const T = (w: { text: string; del?: boolean }[]) => w.filter((x) => !x.del).map((x) => x.text).join(' ');

describe('corrección de subtítulos', () => {
  it('reglas: tildes seguras, abreviaturas, mayúscula y signos de apertura', () => {
    expect(T(ruleFix(W('no puede ser tambien lo habia visto.')))).toBe('No puede ser también lo había visto.');
    expect(T(ruleFix(W('que es esto? no lo creo!')))).toBe('¿Que es esto? ¡No lo creo!');
    expect(T(ruleFix(W('hoy estuvo muy brutal todo lo que paso pero que es esto?')))).toBe('Hoy estuvo muy brutal todo lo que paso pero ¿que es esto?');
    expect(T(ruleFix(W('y entonces me fui para la casa de mi amigo a jugar un rato?')))).toBe('Y entonces me fui para la casa de mi amigo a jugar un rato?');
    const once = ruleFix(W('que es esto? tambien vino.'));
    expect(T(ruleFix(once))).toBe(T(once));
    expect(T(ruleFix(W('¿ya viste? xq no')))).toBe('¿Ya viste? Porque no');
  });
  it('reglas: no toca palabras ambiguas', () => {
    expect(T(ruleFix(W('si tu quieres mas esta bien')))).toBe('Si tu quieres mas esta bien');
  });
  it('reglas: nombres propios, también con una letra mal', () => {
    expect(T(ruleFix(W('hoy juega wescol en kik contra westcol'), ['Westcol', 'Kick']))).toBe('Hoy juega Westcol en kik contra Westcol');
    expect(T(ruleFix(W('vamos a jugar faifa y fifo'), ['FIFA']))).toBe('Vamos a jugar FIFA y fifo');
  });
  it('reglas: quita marcas del transcriptor y conserva los tiempos', () => {
    const r = ruleFix(W('[Música] hola parce'));
    expect(r[0].del).toBe(true);
    expect(r[1]).toMatchObject({ text: 'Hola', startMs: 400, endMs: 780 });
  });
  it('alinear: mismo número de palabras conserva cada tiempo', () => {
    const w = W('ola como estas parsero');
    const r = alignText(w, 'Hola, ¿cómo estás, parcero?');
    expect(r.map((x) => x.startMs)).toEqual(w.map((x) => x.startMs));
    expect(T(r)).toBe('Hola, ¿cómo estás, parcero?');
    expect(alignText(W('ola parse oy'), 'Hola, parce, hoy').map((x) => x.startMs)).toEqual([0, 400, 800]);
  });
  it('alinear: dos palabras que pasan a ser una se reparten el tiempo del tramo', () => {
    const w = W('eso fue en gran teft auto ayer');
    const r = alignText(w, 'eso fue en Grand Theft Auto ayer');
    expect(T(r)).toBe('eso fue en Grand Theft Auto ayer');
    expect(r[r.length - 1]).toMatchObject({ text: 'ayer', startMs: w[6].startMs });
    const r2 = alignText(W('a ver por que no'), 'a ver porque no');
    expect(r2).toHaveLength(4);
    expect(r2[2]).toMatchObject({ text: 'porque', startMs: 800, endMs: 1580 });
  });
  it('parecido y distancia', () => {
    expect(editDistance('wescol', 'westcol')).toBe(1);
    expect(sameRatio(W('hola como estas'), 'Hola, ¿cómo estás?')).toBe(1);
    expect(sameRatio(W('hola como estas hoy parce'), 'Buenas tardes a todos')).toBeLessThan(0.3);
  });
  it('IA: acepta una corrección fiel y rechaza una que reescribe', async () => {
    const w = W('ola parse como estas oy');
    const ok = await aiFix(w, [], '', async () => '{"text":"Hola, parce, ¿cómo estás hoy?"}');
    expect(T(ok.words)).toBe('Hola, parce, ¿cómo estás hoy?');
    expect(ok.applied).toBe(1);
    const bad = await aiFix(w, [], '', async () => '{"text":"El streamer saluda a su audiencia con mucho entusiasmo."}');
    expect(bad.rejected).toBe(1);
    expect(T(bad.words)).toBe(T(w));
    const broken = await aiFix(w, [], '', async () => 'no es json');
    expect(broken.rejected).toBe(1);
    expect(countChanges(w, ok.words)).toBe(5);
  });
});

import { buildAss, geometry } from '../src/clips/media/fast';
import { defaultCaptions } from '../src/clips/media/spec';
describe('subtitulos de los clips de referencia', () => {
  const words = [{ text: 'hola', startMs: 0, endMs: 400 }, { text: 'amigos', startMs: 400, endMs: 900 }];
  const ass = (style: string, more = {}) => buildAss({ captions: { ...defaultCaptions(), style, words }, title: 'yo cuando', credit: '', texts: [], ...more }, geometry('fit', 1920, 1080, { x: 0, y: 0, w: 1, h: 1 }), 2000);
  it('recuadro activo: solo la palabra que suena lleva el recuadro de color', () => {
    const a = ass('recuadro');
    expect(a).toContain(String.raw`\3c&H00E43F7B&\bord18\shad0}HOLA`);
    expect(a).toContain(String.raw`\3c&H00000000&\bord7\shad3}AMIGOS`);
  });
  it('cursiva y titulo meme', () => {
    expect(ass('cursiva')).toMatch(/Style: Cap,Montserrat ExtraBold,\d+,[^,]+,[^,]+,[^,]+,[^,]+,-1,-1,/);
    expect(ass('amarillo', { titleStyle: 'meme' })).toContain(String.raw`,Meme,,0,0,0,,{\pos(540,`);
    expect(ass('amarillo', { titleStyle: 'meme' })).toContain('YO CUANDO');
  });
});

describe('correcciones aprendidas del usuario', () => {
  const w = (text: string, was?: string) => ({ text, startMs: 0, endMs: 300, ...(was != null ? { was } : {}) });
  it('aprende solo lo que el usuario cambio de verdad', async () => {
    const { learnFixes } = await import('../src/clips/media/subfix');
    const fx = {};
    expect(learnFixes(fx, [w('Westcol,', 'Wesco,'), w('parce', 'parse'), w('Hola', 'hola'), w('bien.', 'bien'), w('igual'), w('dos palabras', 'una')])).toBe(2);
    expect(fx).toEqual({ wesco: { to: 'Westcol', n: 1 }, parse: { to: 'parce', n: 1 } });
    learnFixes(fx, [w('parce', 'Parse')]);
    expect(fx).toEqual({ wesco: { to: 'Westcol', n: 1 }, parse: { to: 'parce', n: 2 } });
    learnFixes(fx, [w('parcero', 'parse')]); // una correccion distinta reemplaza a la anterior
    expect((fx as any).parse).toEqual({ to: 'parcero', n: 1 });
  });
  it('las aplica conservando signos y mayuscula inicial', async () => {
    const { applyFixes } = await import('../src/clips/media/subfix');
    const fx = { wesco: { to: 'Westcol', n: 2 }, parse: { to: 'parce', n: 1 } };
    expect(applyFixes([w('¿Wesco?'), w('Parse,'), w('parse'), w('casa')], fx).map((x) => x.text)).toEqual(['¿Westcol?', 'Parce,', 'parce', 'casa']);
    expect(applyFixes([w('parse')], undefined)[0].text).toBe('parse');
  });
});
