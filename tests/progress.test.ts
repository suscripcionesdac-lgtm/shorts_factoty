import { describe, expect, it } from 'vitest';
import { dlShort } from '../src/clips/web/progress.js';

describe('avance de la descarga en la ficha del video', () => {
  it('porcentaje y lo que queda, a partir de la linea de yt-dlp', () => {
    expect(dlShort('45.3% of ~ 1.20GiB at 3.10MiB/s ETA 02:10 (frag 3/50)')).toBe('descargando 45 % · quedan 2:10');
    expect(dlShort('99.9% of 800.00MiB at 5.00MiB/s ETA 00:00')).toBe('descargando 99 %');
    expect(dlShort('7.0% of 3.10GiB at 2.00MiB/s ETA 1:02:33')).toBe('descargando 7 % · quedan 1:02:33');
  });
  it('sin porcentaje, el aviso tal cual', () => {
    expect(dlShort('preparando el video (unos minutos si es largo)')).toBe('preparando el video (unos minutos si es largo)');
    expect(dlShort(undefined)).toBe('descargando');
  });
});
