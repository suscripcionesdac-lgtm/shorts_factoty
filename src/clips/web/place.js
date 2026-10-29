// Colocacion inteligente de subtitulos: donde no tapen ninguna cara y dentro de la zona segura de las apps.
// Lo usan el exportador (fast.ts) y la vista previa del editor, para que lo que se ve sea lo que se exporta.
// Todas las medidas son fracciones del video final (1080x1920): x e y de 0 a 1.

export const OUT_W = 1080, OUT_H = 1920;
/** Lo que tapa la interfaz de cada app (px arriba y abajo). «todas» es lo mas estricto de las tres. */
export const SAFE = { todas: [220, 430], tiktok: [150, 400], shorts: [180, 380], reels: [220, 430], ninguna: [60, 60] };

const box = (x, y, w, h) => ({ x, y, w, h });
/** Dentro de una camara, la cara y los hombros ocupan casi todo el recuadro: se deja un margen pequeño. */
const inCam = (x, y, w, h) => box(x + w * 0.1, y + h * 0.04, w * 0.8, h * 0.84);
/** Igual que floatBoxes en fast.ts. */
const FLOAT = (n) => (n >= 3 ? { bw: 330, bh: 290, xs: [22, 375, 728] } : n === 2 ? { bw: 480, bh: 380, xs: [40, 560] } : { bw: 640, bh: 480, xs: [220] });

/** Cuadricula segun cuantas camaras: hasta 3 una encima de otra; hasta 8 en dos columnas; mas, en tres (la ultima fila, centrada). En px del video final. */
export function gridBoxes(n) {
  const W = OUT_W, H = OUT_H, even = (v) => Math.round(v / 2) * 2, cols = n <= 3 ? 1 : n <= 8 ? 2 : 3, rows = Math.ceil(n / cols), gap = 12;
  const cw = cols === 1 ? W : even((W - gap * (cols - 1)) / cols), ch = even(Math.min(cols === 1 ? W * 0.75 : cw * 1.25, (H - 320 - gap * (rows - 1)) / rows));
  const top = Math.round((H - rows * ch - (rows - 1) * gap) / 2), rem = n % cols, left = (W - rem * cw - (rem - 1) * gap) / 2;
  const xy = Array.from({ length: n }, (_, i) => [rem && i >= n - rem ? left + (i - (n - rem)) * (cw + gap) : (i % cols) * (cw + gap), top + Math.floor(i / cols) * (ch + gap)]);
  return { cw, ch, xy };
}

/**
 * Donde hay caras en el video final segun el encuadre. `geo` es la geometria del encuadre (camH, top, vh) y
 * `cams` las camaras del video original (fracciones). En los directos la cara de cada persona esta siempre dentro de
 * su camara, asi que esquivar la camara entera vale aunque la persona se mueva.
 */
export function faceZones(sp, geo, cams) {
  const H = OUT_H, W = OUT_W, n = Math.max(1, Math.min(4, cams?.length || 1));
  switch (sp.layout) {
    case 'split': case 'half': return [inCam(0, 0, 1, geo.camH / H)];
    case 'grid': { const g = gridBoxes(Math.max(2, Math.min(12, cams?.length || 2))); return g.xy.map(([x, y]) => inCam(x / W, y / H, g.cw / W, g.ch / H)); }
    case 'duo': return Array.from({ length: n }, (_, i) => inCam(0, i / n, 1, 1 / n));
    case 'float': { const k = Math.min(3, n), f = FLOAT(k); return f.xs.slice(0, k).map((x) => inCam(x / W, 140 / H, f.bw / W, f.bh / H)); }
    case 'pip': { const D = 400, m = 44, px = (sp.pipPos || 'tr').includes('r') ? W - D - m : m, py = (sp.pipPos || 'tr').includes('b') ? H - D - 420 : 150; return [box(px / W, py / H, D / W, D / H)]; }
    // Solo camara o recorte vertical: la cabeza en la parte alta y central.
    case 'cam': return [box(0.14, 0.08, 0.72, 0.56)];
    case 'crop': return [box(0.2, 0.08, 0.6, 0.5)];
    default: {
      // Completo: las camaras detectadas que se ven dentro del video, en su sitio (la de la plantilla es solo una suposicion).
      const list = cams || [];
      return list.map((c) => inCam(c.x, (geo.top + c.y * geo.vh) / H, c.w, (c.h * geo.vh) / H));
    }
  }
}
/** Donde esta el titulo (arriba, con su caja): los subtitulos no deben taparlo ni quedar pegados. */
export function titleZone(sp, geo) {
  if (!sp.title) return null;
  const y = (sp.titleY ?? geo?.titleY ?? 200) / OUT_H;
  return box(0.06, y - 100 / OUT_H, 0.88, 200 / OUT_H);
}
/** Durante un golpe de reaccion la cara ocupa toda la pantalla: zonas en ese tramo (segundos del clip). */
export function zonesAt(sp, base, a, b) {
  return (sp.punches || []).some((p) => p.a < b && p.b > a) ? [box(0.12, 0.05, 0.76, 0.62)] : base;
}
/** Tamaño aproximado del bloque de subtitulos: ancho segun las letras (en mayusculas, que es como salen) y una o dos lineas. */
/**
 * El titulo como gancho, como OpusClip (medido en sus clips): en MAYUSCULAS y en lineas cortas (~16 letras), en una caja
 * estrecha; con el mismo tamaño de letra se lee mucho mas grande que una linea larga. Lo usan el exportador y el editor.
 */
export function hookLines(text, max = 16) {
  const lines = [];
  for (const w of text.toUpperCase().split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= max) lines[lines.length - 1] = last + ' ' + w;
    else lines.push(w);
  }
  return lines;
}
export function captionBox(text, size) {
  const px = text.length * size * 0.7, w = Math.min(0.92, px / OUT_W), lines = px > OUT_W * 0.92 ? 2 : 1;
  return { w: Math.max(0.15, w), h: (size * 1.3 * lines) / OUT_H };
}
/**
 * Altura (fraccion del centro) para un subtitulo: la preferida si no tapa ninguna cara; si la tapa, la libre mas
 * cercana dentro de la zona segura; y si no hay ninguna libre, la que menos tapa.
 */
export function captionY(zones, prefY, cap, safe = SAFE.todas) {
  const lo = safe[0] / OUT_H + cap.h / 2, hi = 1 - safe[1] / OUT_H - cap.h / 2, x0 = 0.5 - cap.w / 2, x1 = 0.5 + cap.w / 2, m = 0.012;
  const cover = (y) => zones.reduce((s, z) => {
    const ox = Math.min(x1, z.x + z.w) - Math.max(x0, z.x), oy = Math.min(y + cap.h / 2, z.y + z.h + m) - Math.max(y - cap.h / 2, z.y - m);
    return s + (ox > 0 && oy > 0 ? ox * oy : 0);
  }, 0);
  const p = Math.min(hi, Math.max(lo, prefY));
  if (!cover(p)) return p;
  for (let d = 0.005; d <= 1; d += 0.005) for (const y of [p + d, p - d]) if (y >= lo && y <= hi && !cover(y)) return y;
  let best = p;
  for (let y = lo; y <= hi; y += 0.005) if (cover(y) < cover(best) - 1e-9) best = y;
  return best;
}
