import { describe, expect, it } from 'vitest';
import { autoColor } from '../src/clips/analysis/look';

const f = (y: number, low: number, high: number, sat: number) => ({ y, low, high, sat });

describe('luz y color automaticos', () => {
  it('una imagen bien expuesta no se toca', () => {
    const r = autoColor([f(120, 10, 235, 50), f(125, 12, 240, 55)]);
    expect(r.needed).toBe(false);
    expect(r.color).toEqual({ brightness: 0, contrast: 1, saturation: 1 });
  });
  it('oscura, plana y apagada: mas luz, contraste y color, sin pasarse', () => {
    const r = autoColor([f(60, 20, 150, 15)]);
    expect(r.needed).toBe(true);
    expect(r.color.brightness).toBeGreaterThan(0.1);
    expect(r.color.brightness).toBeLessThanOrEqual(0.18);
    expect(r.color.contrast).toBeGreaterThan(1);
    expect(r.color.contrast).toBeLessThanOrEqual(1.25);
    expect(r.color.saturation).toBeGreaterThan(1.2);
    expect(r.why).toEqual(['estaba oscuro', 'se veía plano', 'tenía poco color']);
  });
  it('quemada o saturada de mas: baja un poco', () => {
    const r = autoColor([f(200, 60, 255, 120)]);
    expect(r.color.brightness).toBeLessThan(0);
    expect(r.color.saturation).toBeLessThan(1);
  });
});
