/**
 * Caras de los participantes: que camaras hay en el video, quien habla en cada momento y como reaccionan.
 * La inferencia va en un hilo aparte (faceworker.mjs); aqui queda la logica, en funciones puras probadas en tests.
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { FFMPEG } from '../media/ff';
import { ROOT } from '../../shared/fs';
import { overlap, type Rect } from '../media/spec';

export type Box = Rect & { score: number };
export type Gray = { t: number; g: Uint8Array };
/** Por muestra y camara: [boca, neutral, alegria, tristeza, enfado, miedo, asco, sorpresa, confianza] o null si no se ve la cara. */
export type Obs = number[] | null;
export type Sample = { t: number; obs: Obs[] };
export type CamKey = { t: number; cam: number };
export type FaceInfo = {
  cams: Rect[];
  /** A partir de `t` (segundos desde el inicio del tramo) habla quien esta en la camara `cam`. */
  track: CamKey[];
  /** Cambios de quien habla por minuto. */
  turns: number;
  /** Intensidad de la reaccion mas fuerte, 0..5 (como las demas señales). */
  react: number;
  label: string;
  at: number;
  /** Camara (indice en `cams`) de la reaccion mas fuerte; -1 si no hay. */
  cam: number;
  /** Varias camaras reaccionan a la vez. */
  together: boolean;
  /** Por camara, en que parte de las muestras se vio una cara (0..1). */
  seen: number[];
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const quantile = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };

// ---------- camaras ----------
export type Group = { cx: number; cy: number; w: number; h: number; seen: number; score: number; list: (Box & { t: number })[] };
/** Agrupa las caras por posicion: una camara es una cara que aparece en el mismo sitio en varios instantes. */
export function faceGroups(frames: { t: number; faces: Box[] }[]): Group[] {
  const groups: Group[] = [];
  for (const fr of frames) for (const f of fr.faces) {
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const g = groups.find((x) => Math.abs(x.cx - cx) < Math.max(0.04, x.w * 0.8) && Math.abs(x.cy - cy) < Math.max(0.05, x.h * 0.8));
    if (g) g.list.push({ ...f, t: fr.t }); else groups.push({ cx, cy, w: f.w, h: f.h, seen: 0, score: 0, list: [{ ...f, t: fr.t }] });
  }
  for (const g of groups) {
    g.seen = new Set(g.list.map((f) => f.t)).size;
    g.score = Math.max(...g.list.map((f) => f.score));
    g.w = median(g.list.map((f) => f.w)); g.h = median(g.list.map((f) => f.h));
    g.cx = median(g.list.map((f) => f.x + f.w / 2)); g.cy = median(g.list.map((f) => f.y + f.h / 2));
  }
  return groups.sort((a, b) => b.seen - a.seen || b.score - a.score);
}

/**
 * Cuanto cambia la zona de la cara entre los instantes en que se vio (mediana, 0..255). Una camara en directo
 * cambia mucho (15 o mas); una foto fija (los retratos del marcador de un juego, un avatar) casi nada (menos de 3).
 * Solo se comparan instantes en que la cara estaba: si el marcador se oculta, lo que se ve detras no cuenta.
 */
export function motion(grays: Gray[], gw: number, gh: number, r: Rect) {
  const x0 = Math.floor(r.x * gw), x1 = Math.ceil((r.x + r.w) * gw), y0 = Math.floor(r.y * gh), y1 = Math.ceil((r.y + r.h) * gh), d: number[] = [];
  for (let i = 1; i < grays.length; i++) {
    let s = 0, n = 0;
    for (let y = Math.max(0, y0); y < Math.min(gh, y1); y++) for (let x = Math.max(0, x0); x < Math.min(gw, x1); x++) { s += Math.abs(grays[i].g[y * gw + x] - grays[i - 1].g[y * gw + x]); n++; }
    if (n) d.push(s / n);
  }
  return median(d);
}

/** Bordes que no cambian: el marco de una camara queda; el juego y la persona, que se mueven, se difuminan. */
export function edgeMaps(grays: Gray[], gw: number, gh: number) {
  const gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh);
  for (const { g } of grays) for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const k = y * gw + x;
    gx[k] += Math.abs(g[k + 1] - g[k - 1]) / grays.length;
    gy[k] += Math.abs(g[k + gw] - g[k - gw]) / grays.length;
  }
  return { gx, gy, gw, gh };
}

/**
 * La zona de la camara a partir de la cara. El marco de una camara superpuesta es una linea perfectamente recta;
 * los bordes de lo que se ve dentro (un estante, una puerta) casi nunca lo son del todo. A cada lado se toma la
 * primera linea recta y continua desde la cara; si no la hay, el borde de la imagen si esta cerca, y si no,
 * un margen proporcional a la cara (camaras con el fondo quitado, sin marco).
 */
export function camRect(face: Rect, e: ReturnType<typeof edgeMaps>): Rect {
  const { gx, gy, gw, gh } = e;
  const fx = face.x * gw, fy = face.y * gh, fw = face.w * gw, fh = face.h * gh, cx = fx + fw / 2, cy = fy + fh / 2;
  // Una cara muy grande es una camara a pantalla completa (directo de charla o IRL).
  if (face.h > 0.3) return { x: 0, y: 0, w: 1, h: 1 };
  const T = 30;
  // Fraccion de una columna o fila (entre a y b) que es borde nitido, sin margen de un pixel: asi solo cuentan las rectas exactas.
  const col = (x: number, a: number, b: number) => { let n = 0, m = 0; for (let y = Math.max(1, Math.round(a)); y < Math.min(gh - 1, Math.round(b)); y++, m++) if (gx[y * gw + x] > T) n++; return m ? n / m : 0; };
  const row = (y: number, a: number, b: number) => { let n = 0, m = 0; for (let x = Math.max(1, Math.round(a)); x < Math.min(gw - 1, Math.round(b)); x++, m++) if (gy[y * gw + x] > T) n++; return m ? n / m : 0; };
  // La primera recta desde la cara. Con `strict`, si esa primera es dudosa y mas afuera hay una claramente mas
  // fuerte cerca (a menos de `near`), esa es el marco y la primera era algo de dentro de la camara (una puerta, un mueble).
  const first = (from: number, to: number, score: (v: number) => number, limit: number, strict = false, near = 0) => {
    const step = to > from ? 1 : -1;
    let found: number | null = null;
    for (let v = Math.round(clamp(from, 1, limit - 2)); step > 0 ? v <= Math.min(to, limit - 2) : v >= Math.max(to, 1); v += step) {
      const s = score(v), at = v + (step > 0 ? 1 : 0);
      if (found == null && s >= 0.55) { if (!strict || s >= 0.65) return at; found = at; }
      else if (found != null && Math.abs(at - found) > near) break;
      else if (found != null && s >= 0.8) return at;
    }
    return found;
  };
  // Primero se mide a la altura (o anchura) de la cara, que siempre queda dentro de la camara; despues, a lo largo
  // de todo el lado encontrado, que descarta las rectas cortas de dentro (un estante a la altura de la cabeza).
  let vb = [cy - fh * 0.9, cy + fh * 0.9], hb = [cx - fw * 0.9, cx + fw * 0.9], L = 0, R = gw, Tp = 0, B = gh;
  for (let pass = 0; pass < 2; pass++) {
    const l = first(fx - fw * 0.15, cx - fw * 5, (x) => col(x, vb[0], vb[1]), gw, pass > 0, fw * 1.5);
    const r = first(fx + fw * 1.15, cx + fw * 5, (x) => col(x, vb[0], vb[1]), gw, pass > 0, fw * 1.5);
    const t = first(fy - fh * 0.3, cy - fh * 3.5, (y) => row(y, hb[0], hb[1]), gh, pass > 0, fh * 1.5);
    const b = first(fy + fh * 1.3, cy + fh * 5, (y) => row(y, hb[0], hb[1]), gh, pass > 0, fh * 1.5);
    // Sin marco visible: el borde de la imagen si queda cerca; si no, hombros y algo de aire.
    L = l ?? (cx - fw * 4 <= 0 ? 0 : cx - fw * 1.45);
    R = r ?? (cx + fw * 4 >= gw ? gw : cx + fw * 1.45);
    Tp = t ?? (cy - fh * 3 <= 0 ? 0 : cy - fh * 1.0);
    B = b ?? (cy + fh * 4 >= gh ? gh : cy + fh * 1.4);
    vb = [Tp + (B - Tp) * 0.05, B - (B - Tp) * 0.05]; hb = [L + (R - L) * 0.05, R - (R - L) * 0.05];
  }
  const rect = { x: L / gw, y: Tp / gh, w: (R - L) / gw, h: (B - Tp) / gh };
  // Un resultado sin sentido (demasiado estrecho o alargado) vuelve al margen proporcional.
  const ar = (rect.w * gw) / Math.max(1, rect.h * gh);
  if (ar < 0.45 || ar > 2.6 || rect.w < face.w * 1.3 || rect.h < face.h * 1.3) return clampRect({ x: (cx - fw * 1.45) / gw, y: (cy - fh * 1.0) / gh, w: (fw * 2.9) / gw, h: (fh * 2.4) / gh });
  return clampRect(rect);
}
const clampRect = (r: Rect): Rect => {
  const x = clamp(r.x, 0, 0.98), y = clamp(r.y, 0, 0.98);
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +clamp(r.w, 0.02, 1 - x).toFixed(4), h: +clamp(r.h, 0.02, 1 - y).toFixed(4) };
};

/**
 * De las caras encontradas, las camaras: caras en el mismo sitio en varios instantes y que se mueven.
 * Dos caras dentro de la misma camara (dos personas en un sofa) cuentan como una sola camara.
 */
export function pickCams(frames: { t: number; faces: Box[] }[], grays: Gray[], gw: number, gh: number, minSeen = 2): Rect[] {
  const groups = faceGroups(frames).filter((g) => g.seen >= Math.min(minSeen, frames.length));
  // Los marcos se buscan solo en los instantes con caras: un anuncio o una pantalla de transicion en medio no tiene
  // marcos, y al promediarla con los demas los bordes se quedarian a medias.
  const live = grays.filter((x) => frames.some((f) => f.t === x.t && f.faces.length));
  const e = edgeMaps(live.length ? live : grays, gw, gh);
  const cams: (Rect & { area: number })[] = [];
  for (const g of groups) {
    const face = { x: g.cx - g.w / 2, y: g.cy - g.h / 2, w: g.w, h: g.h };
    const seen = grays.filter((x) => g.list.some((f) => f.t === x.t));
    if (seen.length >= 2 && motion(seen, gw, gh, face) < 6) continue; // foto fija
    const r = camRect(face, e);
    const same = cams.find((c) => overlap(c, r) > 0.4 || (Math.abs(c.x - r.x) < 0.02 && Math.abs(c.w - r.w) < 0.03 && Math.abs(c.y - r.y) < 0.03));
    if (same) continue;
    cams.push({ ...r, area: r.w * r.h });
  }
  // Una zona casi entera dentro de otra camara mas grande no es otra camara: es algo de su fondo (una figura, un
  // poster) o la misma persona vista dos veces.
  const inside = (a: Rect, b: Rect) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? (w * h) / (a.w * a.h) : 0; };
  const kept = cams.filter((c) => !cams.some((o) => o !== c && o.area > c.area && inside(c, o) > 0.6));
  // Primero la mas grande (suele ser la del streamer), despues de izquierda a derecha.
  return kept.sort((a, b) => b.area - a.area).map(({ area, ...r }) => r);
}

// ---------- quien habla ----------
/** Movimiento de la boca por muestra y camara: cuanto cambia su apertura alrededor de cada instante. */
export function lipActivity(samples: Sample[], cams: number, fps: number): (number | null)[][] {
  const half = Math.max(1, Math.round(fps * 0.6));
  return samples.map((_, i) => Array.from({ length: cams }, (_, c) => {
    let s = 0, n = 0, seen = 0;
    for (let j = Math.max(1, i - half); j <= Math.min(samples.length - 1, i + half); j++) {
      const a = samples[j - 1].obs[c], b = samples[j].obs[c];
      if (b) seen++;
      if (a && b) { s += Math.abs(b[0] - a[0]); n++; }
    }
    return n && seen >= half ? s / n : null;
  }));
}

/**
 * Quien habla en cada momento: la camara cuya boca se mueve claramente mas que las demas. Si no esta claro
 * se mantiene la camara anterior, y los planos duran al menos `minShot` segundos para que la imagen no salte.
 * Ajustado con un directo real de dos camaras, contrastado con el tono de voz (hombre y mujer): 79 % a 10 muestras/s,
 * 76 % a 5. Limitar a los instantes con voz (volumen o palabras de la transcripcion) no mejoraba: mirar si suena
 * voz empeoraba el resultado (el juego y los demas jugadores tambien suenan), asi que solo cuentan los labios.
 */
export function speakerTrack(samples: Sample[], cams: number, fps: number, minShot = 2.4): CamKey[] {
  if (cams < 2 || !samples.length) return [];
  const act = lipActivity(samples, cams, fps);
  // Cada camara tiene su propio ruido (resolucion, cara de perfil): se resta su nivel en reposo. Con un tope (el doble
  // del de la camara mas tranquila) para que quien habla casi todo el rato no se anule a si mismo.
  const q = Array.from({ length: cams }, (_, c) => quantile(act.map((a) => a[c]).filter((v): v is number => v != null), 0.1));
  const floor = q.map((v) => Math.min(v, 2 * Math.min(...q) + 0.005));
  const raw = act.map((a) => {
    const order = a.map((x, c) => [x == null ? -1 : x - floor[c], c]).sort((p, q) => q[0] - p[0]);
    return order[0][0] - order[1][0] > 0.01 ? order[0][1] : -1;
  });
  // Mayoria en una ventana de un segundo y medio; sin mayoria, quien hablaba antes.
  const w = Math.max(1, Math.round(fps * 0.5));
  const vote = raw.map((_, i) => {
    const n = new Array(cams).fill(0);
    for (let j = Math.max(0, i - w); j <= Math.min(raw.length - 1, i + w); j++) if (raw[j] >= 0) n[raw[j]]++;
    const m = Math.max(...n);
    return m > 0 && n.filter((x) => x === m).length === 1 ? n.indexOf(m) : -1;
  });
  const first = vote.find((v) => v >= 0) ?? -1;
  if (first < 0) return [];
  let cur = first;
  const lab = vote.map((v) => (cur = v >= 0 ? v : cur));
  const segs: { a: number; b: number; cam: number }[] = [];
  lab.forEach((c, i) => { const s = segs[segs.length - 1]; if (s && s.cam === c) s.b = i + 1; else segs.push({ a: i, b: i + 1, cam: c }); });
  // Los planos cortos se unen al anterior (o al siguiente, si es el primero).
  const min = Math.round(minShot * fps);
  for (let changed = true; changed && segs.length > 1;) {
    changed = false;
    const i = segs.findIndex((s) => s.b - s.a < min);
    if (i < 0) break;
    const into = i > 0 ? i - 1 : i + 1;
    segs[into].a = Math.min(segs[into].a, segs[i].a); segs[into].b = Math.max(segs[into].b, segs[i].b);
    segs.splice(i, 1);
    for (let k = segs.length - 1; k > 0; k--) if (segs[k].cam === segs[k - 1].cam) { segs[k - 1].b = segs[k].b; segs.splice(k, 1); }
    changed = true;
  }
  return segs.map((s) => ({ t: Math.round((s.a / fps) * 100) / 100, cam: s.cam }));
}

/**
 * Los labios se mueven un poco antes o despues de que se oiga la frase: cada cambio de camara se lleva al inicio
 * de la frase mas cercana (una palabra tras una pausa), si hay una a menos de un segundo. Tiempos en segundos.
 */
export function snapToWords(track: CamKey[], words: { a: number; b: number }[]): CamKey[] {
  const starts = words.filter((w, i) => i === 0 || w.a - words[i - 1].b >= 0.15).map((w) => Math.max(0, w.a - 0.1));
  return track.map((k, i) => {
    if (i === 0) return k;
    const s = starts.reduce((best, x) => (Math.abs(x - k.t) < Math.abs(best - k.t) ? x : best), Infinity);
    const t = Math.abs(s - k.t) <= 1 && s > track[i - 1].t + 1 && s < (track[i + 1]?.t ?? Infinity) - 1 ? s : k.t;
    return { t: Math.round(t * 100) / 100, cam: k.cam };
  });
}

// ---------- reacciones ----------
const LABEL = ['', 'risa', 'tristeza', 'enfado', 'susto', 'asco', 'sorpresa'];
/**
 * La reaccion mas fuerte del tramo: cuanto se aleja cada cara de su gesto habitual (lo que no es neutral),
 * con un extra si la boca se abre mucho (gritos, carcajadas). Cada camara se compara consigo misma.
 */
export function reactionOf(samples: Sample[], cams: number, fps: number) {
  let best = { v: 0, cam: -1, i: -1 };
  const peaks: { cam: number; i: number; v: number }[] = [];
  for (let c = 0; c < cams; c++) {
    const e = samples.map((s) => { const o = s.obs[c]; return o ? 1 - o[1] + Math.max(0, o[0] - 0.35) * 0.8 : null; });
    const sm = e.map((_, i) => { const w = e.slice(Math.max(0, i - 1), i + 2).filter((x): x is number => x != null); return w.length >= 2 ? w.reduce((a, b) => a + b, 0) / w.length : null; });
    const vals = sm.filter((x): x is number => x != null);
    if (vals.length < 3) continue;
    const base = median(vals);
    let top = { v: 0, i: -1 };
    sm.forEach((v, i) => { if (v != null && v - base > top.v) top = { v: v - base, i }; });
    if (top.i >= 0) peaks.push({ cam: c, ...top });
    if (top.v > best.v) best = { v: top.v, cam: c, i: top.i };
  }
  if (best.i < 0) return { react: 0, label: '', at: 0, cam: -1, together: false };
  // El gesto que domina alrededor del pico.
  const sum = new Array(7).fill(0);
  for (let i = Math.max(0, best.i - 1); i <= Math.min(samples.length - 1, best.i + 1); i++) { const o = samples[i].obs[best.cam]; if (o) for (let k = 1; k < 7; k++) sum[k] += o[k + 1]; }
  const k = sum.indexOf(Math.max(...sum.slice(1)));
  const together = peaks.filter((p) => p.v >= 0.3 && Math.abs(p.i - best.i) <= 2 * fps).length >= 2;
  return { react: Math.round(clamp(best.v * 6, 0, 5) * 10) / 10, label: LABEL[k] || '', at: Math.round((best.i / fps) * 10) / 10, cam: best.cam, together };
}

export const turnsPerMin = (track: CamKey[], seconds: number) => (seconds > 0 ? Math.round((Math.max(0, track.length - 1) / (seconds / 60)) * 10) / 10 : 0);

// ---------- hilos del detector ----------
// Varios hilos con el mismo modelo: seguir las caras de un tramo se reparte entre ellos (cada uno, un trozo).
// Se deja la mitad del procesador libre para grabar, exportar y la interfaz.
export const POOL = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 3)));
type Slot = { w: Worker | null; busy: number; idle?: NodeJS.Timeout };
const slots: Slot[] = Array.from({ length: POOL }, () => ({ w: null, busy: 0 }));
let seq = 0, failed: string | null = null, failedAt = 0, backend = '';
const pending = new Map<number, { ok: (v: any) => void; no: (e: Error) => void; progress?: (p: number) => void }>();
export const faceError = () => failed;
export const faceBackend = () => backend;
let onLog: (m: string) => void = () => {};
export const setFaceLog = (fn: (m: string) => void) => (onLog = fn);

function start(slot: Slot) {
  const w = new Worker(new URL('./faceworker.mjs', import.meta.url), { workerData: { root: ROOT, ffmpeg: FFMPEG } });
  w.unref();
  w.on('message', (m) => {
    if (m.log) return onLog(m.log);
    const p = pending.get(m.id);
    if (!p) return;
    if (m.progress != null) return p.progress?.(m.progress);
    pending.delete(m.id);
    if (m.result?.backend) backend = m.result.backend;
    if (m.error) p.no(new Error(m.error)); else p.ok(m.result);
  });
  const fail = (e: Error) => {
    slot.w = null;
    failed = 'el detector de caras no arrancó: ' + e.message.slice(0, 160);
    failedAt = Date.now();
    for (const p of pending.values()) p.no(new Error(failed));
    pending.clear();
  };
  w.on('error', fail);
  w.on('exit', (code) => { if (slot.busy) fail(new Error('se cerró (código ' + code + ')')); slot.w = null; });
  return (slot.w = w);
}
/** Manda un trabajo al hilo menos ocupado (o al indicado). */
function call<T>(msg: Record<string, unknown>, progress?: (p: number) => void, at?: number): Promise<T> {
  if (failed && Date.now() - failedAt < 120_000) return Promise.reject(new Error(failed));
  failed = null;
  const slot = at != null ? slots[at % POOL] : slots.reduce((m, x) => (x.busy < m.busy ? x : m));
  const w = slot.w || start(slot);
  clearTimeout(slot.idle);
  slot.busy++;
  const id = ++seq, done = () => { slot.busy--; arm(slot); };
  return new Promise<T>((ok, no) => {
    pending.set(id, { ok: (v) => { done(); ok(v); }, no: (e) => { done(); no(e); }, progress });
    w.postMessage({ id, ...msg });
  });
}
/** Sin uso durante tres minutos se cierra el hilo y se libera su memoria. */
function arm(slot: Slot) {
  clearTimeout(slot.idle);
  if (slot.busy) return;
  slot.idle = setTimeout(() => { slot.w?.terminate(); slot.w = null; }, 180_000);
  slot.idle.unref();
}

/** Tamaño al que se decodifica el video: toda la resolucion hasta 1080p, que es lo que permite ver caras pequeñas. */
const decodeSize = (srcW: number, srcH: number) => {
  const W = Math.min(1920, Math.round(srcW / 2) * 2 || 1920), H = Math.round((W * (srcH || 1080)) / (srcW || 1920) / 2) * 2;
  return { W, H, gw: 960, gh: Math.round((960 * H) / W) };
};

/**
 * Caras (fracciones 0..1 de la imagen) en cada uno de esos instantes: para seguir a una persona que se mueve.
 * `width`: a que ancho se decodifica (por defecto, la resolucion completa, que ve caras pequeñas; las de una camara en
 * la mano son grandes y bastan 960 px, mucho mas rapido).
 */
export async function faceFrames(file: string, times: number[], srcW: number, srcH: number, width?: number): Promise<{ t: number; faces: Box[] }[]> {
  const full = decodeSize(srcW, srcH), W = width ? Math.min(full.W, Math.round(width / 2) * 2) : full.W, H = Math.round((W * full.H) / full.W / 2) * 2;
  const { gw, gh } = full;
  return (await call<{ frames: { t: number; faces: Box[] }[] }>({ type: 'cams', file, times, W, H, gw, gh })).frames;
}

/**
 * Caras de un tramo cada 1/fps segundos (t desde `start`), para seguir a una persona: se lee el tramo de una vez y se
 * busca en la imagen entera a 960 px (las caras de una camara en la mano son grandes). Medido en un directo IRL: igual de
 * preciso que `faceFrames` (que salta a cada instante y busca tambien en cuatro zonas ampliadas) y mucho mas rapido.
 */
export async function followFrames(file: string, start: number, dur: number, fps: number, srcW: number, srcH: number, width = 960): Promise<{ t: number; faces: Box[] }[]> {
  const full = decodeSize(srcW, srcH), W = Math.min(full.W, width), H = Math.round((W * full.H) / full.W / 2) * 2;
  return (await call<{ frames: { t: number; faces: Box[] }[] }>({ type: 'follow', file, start, dur, fps, W, H })).frames;
}

/** Camaras de los participantes en un tramo: se mira en varios instantes, y de mas cerca si no aparece ninguna. */
export async function findCams(file: string, start: number, end: number, srcW: number, srcH: number, n = 5): Promise<Rect[]> {
  const { W, H, gw, gh } = decodeSize(srcW, srcH);
  const times = Array.from({ length: n }, (_, i) => start + ((end - start) * (i + 0.5)) / n);
  type R = { frames: { t: number; faces: Box[] }[]; grays: Gray[] };
  // Primero 3 instantes (cada pasada del detector cuesta ~2 s); los demas solo si no aparece ninguna camara.
  const r = await call<R>({ type: 'cams', file, times: [times[0], times[2], times[4]].filter((t) => t != null), W, H, gw, gh });
  let cams = pickCams(r.frames, r.grays, gw, gh);
  // Tambien se mira mas si algun instante salio sin ninguna cara (un anuncio, una transicion): con solo dos buenos,
  // una camara que no se vio en uno de ellos se perderia.
  if ((!cams.length || r.frames.some((f) => !f.faces.length)) && n > 3) {
    const more = await call<R>({ type: 'cams', file, times: [times[1], times[3]], W, H, gw, gh });
    cams = pickCams([...r.frames, ...more.frames].sort((a, b) => a.t - b.t), [...r.grays, ...more.grays].sort((a, b) => a.t - b.t), gw, gh);
  }
  if (!cams.length) {
    const fine = await call<{ frames: { t: number; faces: Box[] }[]; grays: Gray[] }>({ type: 'cams', file, times: times.slice(0, 3), W, H, gw, gh, fine: true });
    cams = pickCams(fine.frames, fine.grays, gw, gh);
  }
  return cams;
}

/**
 * Analiza las caras de un tramo: camaras (o las indicadas), quien habla en cada momento y la reaccion mas fuerte.
 * `fps` marca la precision: 10 para seguir a quien habla (editor y exportar), 3 para puntuar momentos.
 * Con `words` (segundos desde el inicio del tramo) los cambios de camara caen al empezar una frase.
 */
export async function faceScan(file: string, start: number, end: number, o: { srcW: number; srcH: number; cams?: Rect[]; fps?: number; words?: { a: number; b: number }[]; onProgress?: (p: number) => void; parts?: number }): Promise<FaceInfo & { samples: Sample[]; fps: number }> {
  const cams = o.cams?.length ? o.cams.slice(0, 12) : await findCams(file, start, end, o.srcW, o.srcH);
  if (!cams.length) return { ...infoFromSamples([], cams, 1, end - start), samples: [], fps: 1 };
  // Con el procesador (sin WebAssembly) va mucho mas lento: se miran menos instantes.
  const fps = backend === 'cpu' ? Math.min(2, o.fps || 5) : o.fps || 5;
  // A resolucion completa: a 1280 px los labios se leen peor y quien habla acertaba bastante menos (75 % -> 58 %).
  const { W, H } = decodeSize(o.srcW, o.srcH), dur = end - start;
  // El tramo se reparte en trozos, uno por hilo, y las muestras se vuelven a juntar en orden. Cada trozo empieza
  // un segundo antes y descarta ese segundo: asi llega a su primera muestra con la cara ya encontrada y seguida, y
  // en la union no aparece un movimiento de labios falso (que se leeria como un cambio de quien habla).
  const parts = Math.max(1, Math.min(o.parts || POOL, POOL, Math.floor(dur / 6))), len = dur / parts, prog = new Array(parts).fill(0), warm = 1;
  const pieces = await Promise.all(Array.from({ length: parts }, (_, i) => {
    const k0 = Math.round(i * len * fps), k1 = Math.round((i + 1) * len * fps), pre = i ? Math.round(warm * fps) : 0;
    return call<{ samples: Sample[] }>({ type: 'track', file, start: start + (k0 - pre) / fps, dur: (k1 - k0 + pre) / fps, fps, W, H, cams }, (x) => { prog[i] = x; o.onProgress?.(Math.round(prog.reduce((s, v) => s + v, 0) / parts)); }, i)
      .then((r) => r.samples.slice(pre, pre + k1 - k0).map((x, n) => ({ ...x, t: Math.round(((k0 + n) / fps) * 1000) / 1000 })));
  }));
  const samples = pieces.flat();
  return { ...infoFromSamples(samples, cams, fps, dur, o.words), samples, fps };
}

/** Quien habla, reaccion y cuanto se ve cada camara a partir de las muestras de caras (es instantaneo). */
export function infoFromSamples(samples: Sample[], cams: Rect[], fps: number, dur: number, words?: { a: number; b: number }[]): FaceInfo {
  if (!cams.length || !samples.length) return { cams, track: [], turns: 0, react: 0, label: '', at: 0, cam: -1, together: false, seen: [] };
  const track = snapToWords(speakerTrack(samples, cams.length, fps), words || []);
  const seen = cams.map((_, c) => Math.round((samples.filter((x) => x.obs[c]).length / samples.length) * 100) / 100);
  return { cams, track, turns: turnsPerMin(track, dur), seen, ...reactionOf(samples, cams.length, fps) };
}
