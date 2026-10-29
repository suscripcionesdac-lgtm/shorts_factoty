import { describe, expect, it } from 'vitest';
import { introSpans } from '../src/clips/analysis/detect';

// Un directo de 60 min: cambios de plano por segundo (un golpe cada pocos segundos) y volumen en dB.
const stream = (o: { intro?: number; outro?: number; len?: number } = {}) => {
  const len = (o.len ?? 60) * 60, scene: number[] = [], energy: number[] = [];
  for (let t = 0; t < len; t++) {
    const inIntro = t < (o.intro ?? 0) || (o.outro != null && t >= len - o.outro);
    scene.push(inIntro ? (t % 4 === 0 ? 0.7 : 0) : t % 30 === 0 ? 0.5 : 0);
    energy.push(inIntro ? -12 : t % 7 === 0 ? -20 : -30);
  }
  return { scene, energy };
};

describe('intro y despedida del directo: sin momentos', () => {
  it('encuentra la intro del principio y corta donde acaba la musica', () => {
    const { scene, energy } = stream({ intro: 783 });
    const [span] = introSpans(scene, energy);
    expect(span[0]).toBe(0);
    expect(Math.abs(span[1] - 783), 'en el segundo en que cae el volumen').toBeLessThanOrEqual(2);
  });
  it('y la despedida del final', () => {
    const { scene, energy } = stream({ outro: 300 });
    const spans = introSpans(scene, energy);
    expect(spans).toHaveLength(1);
    expect(Math.abs(spans[0][0] - 3300)).toBeLessThanOrEqual(2);
    expect(spans[0][1]).toBe(3600);
  });
  it('sin intro, nada; y en videos cortos no se busca', () => {
    expect(introSpans(stream().scene, stream().energy)).toEqual([]);
    const short = stream({ intro: 120, len: 8 });
    expect(introSpans(short.scene, short.energy)).toEqual([]);
  });
});
