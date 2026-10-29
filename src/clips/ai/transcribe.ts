import { Worker } from 'node:worker_threads';
import { pcm16k } from '../media/ff';
import type { Word } from '../../shared/timing';
import { ROOT } from '../../shared/fs';

/**
 * Reconocimiento de voz local y gratuito (Whisper con transformers.js). Dos modelos:
 *  - grande (large-v3-turbo) en la grafica (DirectML): entiende mucho mejor acentos y jerga, y en una grafica normal
 *    va tan rapido como el pequeño en la CPU. Se descarga una vez (~1,6 GB) a ./models;
 *  - pequeño (small) en la CPU (~250 MB): si no hay grafica compatible, si el grande falla, o mientras el grande se
 *    descarga la primera vez (para no esperar).
 * WHISPER_MODEL fuerza un modelo concreto (en la CPU), como antes.
 * La inferencia va en un hilo aparte (asrworker.mjs): en el hilo del servidor lo congelaba durante segundos.
 */
type St = { bigState: string; bigError: string; failed: string | null };
let st: St = { bigState: 'sin probar', bigError: '', failed: null };
let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, { ok: (c: any[]) => void; ko: (e: Error) => void }>();

function hilo() {
  if (worker) return worker;
  const w = new Worker(new URL('./asrworker.mjs', import.meta.url), { workerData: { root: ROOT } });
  w.unref();
  w.on('message', (m: { id: number; chunks?: any[]; error?: string; st: St }) => {
    st = m.st;
    const p = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) p?.ko(new Error(m.error)); else p?.ok(m.chunks || []);
  });
  // Si el hilo se cae, lo pendiente falla y el siguiente uso arranca otro.
  w.on('error', (e) => { for (const p of waiting.values()) p.ko(e as Error); waiting.clear(); worker = null; });
  w.on('exit', () => { worker = null; });
  return (worker = w);
}

/** Que modelo de voz se esta usando, para mostrarlo. */
export const asrModel = () => (st.bigState === 'listo' ? 'grande, en la gráfica' : st.bigState === 'cargando' ? 'pequeño (descargando el grande)' : st.bigError ? 'pequeño (la gráfica no sirvió: ' + st.bigError.slice(0, 60) + ')' : 'pequeño');

/** Transcribe un tramo y devuelve palabras con tiempos absolutos (ms desde el inicio del archivo). */
export async function transcribe(file: string, start: number, duration: number): Promise<Word[]> {
  const audio = await pcm16k(file, start, duration);
  if (audio.length < 1600) return [];
  const w = hilo(), id = ++seq;
  w.ref(); // mientras transcribe, el proceso no se cierra
  const chunks = await new Promise<any[]>((ok, ko) => { waiting.set(id, { ok, ko }); w.postMessage({ id, audio }); }).finally(() => { if (!waiting.size) w.unref(); });
  const words: Word[] = [];
  for (const c of chunks) {
    const text = String(c.text || '').trim();
    const [a, b] = c.timestamp || [];
    if (!text || a == null) continue;
    const s = Math.round((start + a) * 1000);
    words.push({ text, startMs: s, endMs: Math.round((start + (b ?? a + 0.3)) * 1000) });
  }
  return words;
}

export const asrError = () => st.failed;
