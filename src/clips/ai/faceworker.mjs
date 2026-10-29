// Hilo aparte para el detector de caras (face-api con TensorFlow.js): asi la inferencia no frena el servidor.
// Es JavaScript sin dependencias locales para que funcione en cualquier version de Node, con o sin tsx.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import util from 'node:util';
import { spawn } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';

const { root, ffmpeg } = workerData;
const MODELS = path.join(root, 'node_modules/@vladmandic/face-api/model');
const WASM_DIR = path.join(root, 'models/tfjs-wasm');
// El mismo archivo que publica TensorFlow.js en npm (version 4.22.0, la que trae face-api), comprobado por su huella.
const WASM_FILE = 'tfjs-backend-wasm-simd.wasm';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/${WASM_FILE}`;
const WASM_SHA256 = '77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b';
const EXPR = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'];

/**
 * El paquete de face-api es el del navegador: si detecta Node usa modulos vacios y su cargador WASM instala
 * manejadores globales de errores. Mientras se carga se le oculta Node (solo en este hilo).
 */
async function asBrowser(fn) {
  const d = Object.getOwnPropertyDescriptor(process, 'versions');
  Object.defineProperty(process, 'versions', { value: { ...process.versions, node: undefined }, configurable: true });
  try { return await fn(); } finally { Object.defineProperty(process, 'versions', d); }
}

async function wasmReady() {
  const file = path.join(WASM_DIR, WASM_FILE);
  const ok = (b) => crypto.createHash('sha256').update(b).digest('hex') === WASM_SHA256;
  if (fs.existsSync(file) && ok(fs.readFileSync(file))) return true;
  const res = await fetch(WASM_URL);
  if (!res.ok) throw new Error(`descarga ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  if (!ok(b)) throw new Error('el archivo descargado no coincide con el oficial');
  fs.mkdirSync(WASM_DIR, { recursive: true });
  fs.writeFileSync(file, b);
  return true;
}

let F = null, backend = '';
async function load() {
  if (F) return F;
  const f = await asBrowser(() => import('@vladmandic/face-api/dist/face-api.esm.js'));
  const tf = f.tf, enc = new util.TextEncoder();
  // Plataforma minima para TensorFlow.js; los archivos locales se leen del disco.
  new Response(new Uint8Array(1)); // carga ya el fetch de Node, que tambien mira process.versions
  tf.env().setPlatform('node', {
    fetch: (u, o) => (/^https?:/.test(String(u)) ? fetch(u, o) : Promise.resolve(new Response(fs.readFileSync(String(u)), { headers: { 'content-type': 'application/wasm' } }))),
    now: () => performance.now(), encode: (t) => enc.encode(t), decode: (b, e) => new util.TextDecoder(e).decode(b),
    isTypedArray: (a) => ArrayBuffer.isView(a) && !(a instanceof DataView),
  });
  f.env.setEnv(f.env.createNodejsEnv());
  // WebAssembly va unas 20 veces mas rapido que JavaScript puro; sin el archivo se usa el procesador igualmente.
  try {
    await wasmReady();
    tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
    tf.setWasmPaths(WASM_DIR.split(path.sep).join('/') + '/', true);
    if (await asBrowser(async () => { const ok = await tf.setBackend('wasm'); await tf.ready(); return ok; })) backend = 'wasm';
  } catch (e) { parentPort.postMessage({ log: 'Caras: sin WebAssembly (' + e.message + '), uso el procesador, más lento.' }); }
  if (!backend) { await tf.setBackend('cpu'); await tf.ready(); backend = 'cpu'; }
  for (const [net, name] of [[f.nets.tinyFaceDetector, 'tiny_face_detector_model'], [f.nets.ssdMobilenetv1, 'ssd_mobilenetv1_model'], [f.nets.faceLandmark68TinyNet, 'face_landmark_68_tiny_model'], [f.nets.faceExpressionNet, 'face_expression_model']]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(MODELS, name + '-weights_manifest.json'), 'utf8'));
    const bin = fs.readFileSync(path.join(MODELS, name + '.bin'));
    net.loadFromWeightMap(tf.io.decodeWeights(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length), manifest.flatMap((g) => g.weights)));
  }
  return (F = f);
}

/** Fotogramas RGB de un tramo, uno detras de otro, sin guardarlos en disco. */
function frames(file, start, dur, fps, w, h, onFrame) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-ss', String(Math.max(0, start)), '-t', String(dur), '-i', file, '-an', '-vf', `fps=${fps},scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const size = w * h * 3;
    let buf = Buffer.allocUnsafe(size), have = 0, n = 0, chain = Promise.resolve(), failed = false;
    p.stdout.on('data', (d) => {
      for (let off = 0; off < d.length;) {
        const k = Math.min(size - have, d.length - off);
        d.copy(buf, have, off, off + k);
        have += k; off += k;
        if (have < size) continue;
        const fr = buf, i = n++;
        buf = Buffer.allocUnsafe(size); have = 0;
        // Se procesa en orden; si el analisis va mas lento que la lectura, se pausa la lectura.
        p.stdout.pause();
        chain = chain.then(() => (failed ? null : onFrame(fr, i))).then(() => p.stdout.resume(), (e) => { failed = true; p.kill(); reject(e); });
      }
    });
    p.on('error', reject);
    p.on('close', () => chain.then(() => resolve(n), reject));
  });
}
const oneFrame = (file, t, w, h) => new Promise((resolve, reject) => {
  const p = spawn(ffmpeg, ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-an', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const b = [];
  p.stdout.on('data', (d) => b.push(d));
  p.on('error', reject);
  p.on('close', () => { const x = Buffer.concat(b); resolve(x.length === w * h * 3 ? x : null); });
});

/** Recorte de un fotograma RGB como tensor (copiando solo las filas de la zona). */
function crop(tf, rgb, W, H, r) {
  const x = Math.max(0, Math.round(r.x * W)), y = Math.max(0, Math.round(r.y * H));
  const w = Math.max(8, Math.min(W - x, Math.round(r.w * W))), h = Math.max(8, Math.min(H - y, Math.round(r.h * H)));
  const out = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) out.set(rgb.subarray(((y + j) * W + x) * 3, ((y + j) * W + x + w) * 3), j * w * 3);
  return { t: tf.tensor3d(out, [h, w, 3], 'int32'), x, y, w, h };
}
const gray = (rgb, W, H, gw, gh) => {
  const g = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = (Math.floor((j * H) / gh) * W + Math.floor((i * W) / gw)) * 3;
    g[j * gw + i] = (rgb[k] * 77 + rgb[k + 1] * 150 + rgb[k + 2] * 29) >> 8;
  }
  return g;
};

/**
 * Busca caras en varios instantes: el fotograma entero y sus cuatro cuartos ampliados (las camaras de los streamers
 * suelen ser pequeñas). Devuelve las caras y una version en gris de cada fotograma para medir bordes y movimiento.
 */
async function cams({ file, times, W, H, gw, gh, fine }) {
  const f = await load(), tf = f.tf, out = [], grays = [];
  const zones = [[0, 0, 1, 1], [0, 0, 0.55, 0.56], [0.45, 0, 0.55, 0.56], [0, 0.44, 0.55, 0.56], [0.45, 0.44, 0.55, 0.56]];
  const grid = [0, 0.3, 0.6].flatMap((x) => [0, 0.3, 0.6].map((y) => [x, y, 0.4, 0.4]));
  for (let i = 0; i < times.length; i++) {
    const rgb = await oneFrame(file, times[i], W, H);
    if (!rgb) continue;
    grays.push({ t: times[i], g: gray(rgb, W, H, gw, gh) });
    const found = [];
    for (const [zx, zy, zw, zh] of fine ? grid : zones) {
      const c = crop(tf, rgb, W, H, { x: zx, y: zy, w: zw, h: zh });
      try {
        const opt = new f.SsdMobilenetv1Options({ minConfidence: fine ? 0.3 : 0.4 });
        for (const d of await f.detectAllFaces(c.t, opt)) found.push({ x: (c.x + d.box.x) / W, y: (c.y + d.box.y) / H, w: d.box.width / W, h: d.box.height / H, score: d.score });
      } finally { c.t.dispose(); }
    }
    // La misma cara sale en varias zonas: se queda la de mas confianza.
    found.sort((a, b) => b.score - a.score);
    const faces = [];
    for (const c of found) if (!faces.some((o) => Math.abs(o.x + o.w / 2 - c.x - c.w / 2) < Math.max(o.w, c.w) * 0.5 && Math.abs(o.y + o.h / 2 - c.y - c.h / 2) < Math.max(o.h, c.h) * 0.5)) faces.push(c);
    out.push({ t: times[i], faces });
  }
  return { frames: out, grays, gw, gh, backend };
}

/**
 * Caras de un tramo para seguir a una persona (camara en la mano): el tramo se lee de una vez (un solo ffmpeg, sin
 * saltar a cada instante) y se busca solo en la imagen entera, sin las cuatro zonas ampliadas de `cams` (alli se buscan
 * webcams pequeñas; aqui las caras son grandes). Un fotograma cada 1/fps segundos, desde `start`.
 */
async function follow({ file, start, dur, fps, W, H }) {
  const f = await load(), tf = f.tf, out = [];
  const opt = new f.SsdMobilenetv1Options({ minConfidence: 0.4 });
  await frames(file, start, dur, fps, W, H, async (rgb, i) => {
    const c = crop(tf, rgb, W, H, { x: 0, y: 0, w: 1, h: 1 });
    try { out.push({ t: i / fps, faces: (await f.detectAllFaces(c.t, opt)).map((d) => ({ x: d.box.x / W, y: d.box.y / H, w: d.box.width / W, h: d.box.height / H, score: d.score })) }); }
    finally { c.t.dispose(); }
  });
  return { frames: out };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Apertura de la boca: distancia entre los labios por dentro, relativa al ancho de la boca. */
function mouthOpen(p) {
  const w = dist(p[48], p[54]) || 1;
  return (dist(p[61], p[67]) + dist(p[62], p[66]) + dist(p[63], p[65])) / 3 / w;
}

/**
 * Sigue las caras dentro de cada camara a lo largo del tramo: apertura de la boca (para saber quien habla)
 * y las siete expresiones del modelo (para las reacciones). Por muestra y camara: [boca, ...expresiones] o null.
 */
async function track({ id, file, start, dur, fps, W, H, cams }) {
  const f = await load(), tf = f.tf, samples = [], total = Math.max(1, Math.round(dur * fps));
  // Detectar la cara es lo mas caro: se hace una vez por segundo y entre medias se sigue con los puntos de la cara.
  // Las expresiones cambian mas despacio que los labios: se miran en una muestra de cada dos.
  const every = Math.max(1, Math.round(fps)), st = cams.map(() => ({ box: null, age: 0, score: 0, ex: null }));
  await frames(file, start, dur, fps, W, H, async (rgb, i) => {
    const obs = [];
    for (let k = 0; k < cams.length; k++) {
      const c = crop(tf, rgb, W, H, cams[k]), s = st[k];
      try {
        if (!s.box || s.age >= every) {
          // La cara ocupa buena parte de la camara: basta una entrada pequeña, que es mucho mas rapida.
          const det = await f.detectSingleFace(c.t, new f.TinyFaceDetectorOptions({ inputSize: Math.max(c.w, c.h) > 400 ? 320 : 224, scoreThreshold: 0.35 }));
          Object.assign(s, det ? { box: det.box, score: det.score, age: 0, ex: null } : { box: null, ex: null });
        }
        if (!s.box) { obs.push(null); continue; }
        s.age++;
        const b = s.box, [ft] = await f.extractFaceTensors(c.t, [new f.Rect(b.x, b.y, b.width, b.height)]);
        try {
          const pts = (await f.nets.faceLandmark68TinyNet.detectLandmarks(ft)).forSize(b.width, b.height).shiftBy(b.x, b.y).positions;
          if (!s.ex || i % 2 === 0) s.ex = await f.nets.faceExpressionNet.predictExpressions(ft);
          obs.push([mouthOpen(pts), ...EXPR.map((e) => s.ex[e] || 0), s.score].map((v) => Math.round(v * 1000) / 1000));
          // El recuadro sigue al centro de los puntos (mismo tamaño), para la siguiente muestra.
          const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
          const dx = mx - (b.x + b.width / 2), dy = my - (b.y + b.height * 0.58);
          s.box = new f.Rect(Math.max(0, Math.min(c.w - b.width, b.x + dx)), Math.max(0, Math.min(c.h - b.height, b.y + dy)), b.width, b.height);
        } finally { ft.dispose(); }
      } finally { c.t.dispose(); }
    }
    samples.push({ t: i / fps, obs });
    if (i % 10 === 0) parentPort.postMessage({ id, progress: Math.min(99, Math.round((i / total) * 100)) });
  });
  return { samples, backend };
}

const JOBS = { cams, track, follow };
let chain = Promise.resolve();
parentPort.on('message', (m) => {
  // Los trabajos van de uno en uno.
  chain = chain.then(async () => {
    try { parentPort.postMessage({ id: m.id, result: await JOBS[m.type](m) }); }
    catch (e) { parentPort.postMessage({ id: m.id, error: String(e?.message || e) }); }
  });
});
