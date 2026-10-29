// Reconocimiento de voz en un hilo aparte (lo usa transcribe.ts). Whisper ocupa la CPU durante segundos seguidos:
// en el hilo principal del servidor congelaba todo lo demas (la vista previa del editor no recibia video).
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

const SMALL = 'onnx-community/whisper-small_timestamped', BIG = 'onnx-community/whisper-large-v3-turbo_timestamped';
const BIG_OPTS = { device: 'dml', dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' } };
const MODELS = path.join(workerData.root, 'models');
const bigCached = () => ['encoder_model_fp16.onnx', 'decoder_model_merged_fp16.onnx'].every((f) => fs.existsSync(path.join(MODELS, ...BIG.split('/'), 'onnx', f)));

let small = null, big = null, bigLoading = null;
const st = { bigState: process.env.WHISPER_MODEL || process.env.WHISPER_NO_GPU ? 'no disponible' : 'sin probar', bigError: '', failed: null };
let failedAt = 0;

async function lib() {
  const t = await import('@huggingface/transformers');
  t.env.cacheDir = MODELS;
  return t;
}
/** Carga el modelo grande en la grafica (en segundo plano la primera vez, mientras se descarga). */
function loadBig() {
  if (st.bigState !== 'sin probar') return bigLoading;
  st.bigState = 'cargando';
  bigLoading = lib()
    .then((t) => t.pipeline('automatic-speech-recognition', BIG, BIG_OPTS))
    .then((m) => { big = m; st.bigState = 'listo'; })
    .catch((e) => { st.bigState = 'no disponible'; st.bigError = e.message.slice(0, 200); });
  return bigLoading;
}
async function loadSmall() {
  // Tras un fallo se reintenta pasados dos minutos (por si era la conexion).
  if (st.failed && Date.now() - failedAt < 120_000) throw new Error(st.failed);
  st.failed = null;
  if (small) return small;
  try {
    const t = await lib();
    small = await t.pipeline('automatic-speech-recognition', process.env.WHISPER_MODEL || SMALL, { dtype: 'q8' });
    return small;
  } catch (e) {
    failedAt = Date.now();
    st.failed = 'no se pudo cargar el modelo de voz (la primera vez se descarga de internet): ' + e.message;
    throw new Error(st.failed);
  }
}
/** El mejor modelo disponible ahora: el grande si ya esta (o si esta descargado y solo falta cargarlo). */
async function load() {
  const p = loadBig();
  if (st.bigState === 'cargando' && bigCached()) await p;
  if (st.bigState === 'listo') return big;
  return loadSmall();
}

async function run(audio) {
  const model = await load();
  // Siempre en español (o el fijado): esta libreria no detecta el idioma (sin el, supone ingles), y en un directo mezclado
  // el modo español entendio mejor las frases en ingles que el modo ingles («magic bow» frente a «magic both»).
  const opts = { language: process.env.WHISPER_LANGUAGE || 'spanish', task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 };
  try { return await model(audio, opts); }
  catch (e) {
    // Si la grafica falla a mitad (memoria, controlador), se sigue con el pequeño en la CPU.
    if (model !== big) throw e;
    big = null; st.bigState = 'no disponible'; st.bigError = e.message.slice(0, 200);
    return (await loadSmall())(audio, opts);
  }
}

parentPort.on('message', async ({ id, audio }) => {
  try {
    const out = await run(audio);
    parentPort.postMessage({ id, chunks: (out.chunks || []).map((c) => ({ text: c.text, timestamp: c.timestamp })), st });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message, st });
  }
});
