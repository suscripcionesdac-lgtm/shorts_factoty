/** Laboratorio de la auto edicion y estilo aprendido de videos de referencia. */
import { AUTO_LEVELS, autoLevel, compareEdits, type EditAreas, type Spec } from '../media/spec';
import path from 'node:path';
import { readJson, ROOT, writeJson } from '../../shared/fs';
import { measureStyle, styleProfile, type StyleProfile, type StyleSample } from '../analysis/refstyle';
import fs from 'node:fs';
import { autoEdit } from './autoedit';
import { clips, DATA, key, log, notice, saveSettings, settings, sources } from './core';
import { prof } from './profile';
import { knowledge, SCHOOL_FROM } from './study';

// ---------- Laboratorio: entrenar y medir la auto edicion ----------
type LabRow = { cid: string; title: string; streamer: string; score: number; areas: EditAreas; cutMine: number; cutAuto: number };
const lab = { running: false, done: 0, total: 0, streamer: '', at: '', rows: [] as LabRow[] };
export function labState() {
  const avg = (f: (r: LabRow) => number) => (lab.rows.length ? lab.rows.reduce((t, r) => t + f(r), 0) / lab.rows.length : 0);
  const areas = lab.rows.length ? (Object.fromEntries(Object.keys(lab.rows[0].areas).map((k) => [k, avg((r) => r.areas[k as keyof EditAreas])])) as EditAreas) : null;
  const mine = avg((r) => r.cutMine), auto = avg((r) => r.cutAuto);
  const tip = !lab.rows.length ? '' : auto > mine * 1.4 + 0.5 ? `La auto edición quita ${auto.toFixed(1)} s por clip y tú ${mine.toFixed(1)} s: prueba la agresividad «Suave».` : mine > auto * 1.4 + 0.5 ? `Tú quitas ${mine.toFixed(1)} s por clip y la auto edición ${auto.toFixed(1)} s: prueba la agresividad «Intensa».` : 'Recorta más o menos lo mismo que tú.';
  const learned = Object.fromEntries(Object.entries(settings.profiles).filter(([, p]) => p.auto || p.autoLevel != null).map(([k, p]) => [k, { level: p.autoLevel ?? 1, auto: p.auto || {} }]));
  return { ...lab, score: avg((r) => r.score), areas, tip, levels: AUTO_LEVELS.map((l) => l.name), learned };
}
/** Vuelve a pasar la auto edicion por los ultimos clips exportados y la compara con como quedaron al final. */
export function labRun(streamer = '', n = 6) {
  if (lab.running) return labState();
  const list = [...clips.values()].filter((c) => c.kind === 'clip' && c.status === 'listo' && c.spec && sources.has(c.sid) && (!streamer || key(c.streamer || '') === key(streamer)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n);
  if (!list.length) throw new Error(streamer ? `No hay clips exportados de ${streamer} con su grabación todavía guardada.` : 'No hay clips exportados con su grabación todavía guardada.');
  Object.assign(lab, { running: true, done: 0, total: list.length, streamer, rows: [] });
  void (async () => {
    for (const c of list) {
      try {
        const r = await autoEdit(c.sid, c.start, c.end, c.cand);
        const cmp = compareEdits(c.spec as Partial<Spec>, r.patch, c.end - c.start);
        lab.rows.push({ cid: c.id, title: c.title || c.id, streamer: c.streamer || '', ...cmp });
      } catch (e) { log(`Laboratorio: ${c.title || c.id}: ${(e as Error).message.slice(0, 160)}`); }
      lab.done++;
    }
    lab.running = false; lab.at = new Date().toISOString();
    notice('ok', `Laboratorio: la auto edición se parece un ${Math.round(labState().score * 100)} % a tus ediciones (${lab.rows.length} clips).`);
  })();
  return labState();
}
export function labLevel(streamer: string, level: number) {
  if (!streamer.trim()) throw new Error('Elige un streamer.');
  prof(key(streamer)).autoLevel = AUTO_LEVELS.indexOf(autoLevel(level));
  saveSettings();
  return labState();
}

/** Olvida lo aprendido en las revisiones de un streamer. */
export function autoForget(streamer: string) { delete prof(key(streamer)).auto; saveSettings(); return { ok: true }; }

/** Estilo y transicion del ultimo clip auto editado de cada streamer, para que el siguiente no salga igual. */
export const lastAuto = new Map<string, { style?: string; transition?: string }>();

// ---------- estilo aprendido de videos de referencia ----------
// Los videos de la carpeta videos-referencia se miden una vez (en segundo plano) y se vuelven a medir solo los nuevos.
const REF_DIR = path.join(ROOT, 'videos-referencia'), REF_FILE = path.join(DATA, 'style-refs.json');
type RefStyle = { samples: (StyleSample & { file: string; size: number })[]; profile: StyleProfile | null; at: string };
let refStyle: RefStyle | null = fs.existsSync(REF_FILE) ? readJson<RefStyle>(REF_FILE) : null, refBusy = false;
const refFiles = () => (fs.existsSync(REF_DIR) ? fs.readdirSync(REF_DIR).filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f)).map((f) => ({ file: f, size: fs.statSync(path.join(REF_DIR, f)).size })) : []);
/** Vuelve a medir las referencias si cambio la carpeta (o siempre, con `force`). */
export async function refreshRefStyle(force = false) {
  if (refBusy) return refStyle;
  const files = refFiles(), sig = (l: { file: string; size: number }[]) => l.map((x) => x.file + ':' + x.size).sort().join('|');
  if (!force && refStyle && sig(refStyle.samples) === sig(files)) return refStyle;
  refBusy = true;
  try {
    const samples: RefStyle['samples'] = [];
    for (const f of files) {
      const had = !force && refStyle?.samples.find((x) => x.file === f.file && x.size === f.size);
      if (had) { samples.push(had); continue; }
      try { samples.push({ ...(await measureStyle(path.join(REF_DIR, f.file))), ...f }); } catch (e) { log('Referencia sin medir: ' + f.file + ': ' + (e as Error).message.slice(0, 100)); }
    }
    refStyle = { samples, profile: styleProfile(samples), at: new Date().toISOString() };
    writeJson(REF_FILE, refStyle);
    if (refStyle.profile) log(`Estilo de ${samples.length} referencias: ${refStyle.profile.cutsPerMin} cortes/min, ${refStyle.profile.zoomsPerMin} zooms/min, ${Math.round(refStyle.profile.transRatio * 100)} % transiciones`);
    return refStyle;
  } finally { refBusy = false; }
}
/** Estilo para un streamer: el de sus ejemplos si tiene al menos dos medidos; si no, el de la carpeta de referencias. */
export function styleFor(streamer: string): { profile: StyleProfile; from: string } | null {
  const ex = (settings.profiles[key(streamer)]?.examples || []).map((e) => e.style).filter((x): x is StyleSample => !!x);
  const own = ex.length >= 2 ? styleProfile(ex) : null;
  if (own) return { profile: own, from: `${ex.length} ejemplos de ${streamer}` };
  if (refStyle?.profile) return { profile: refStyle.profile, from: `${refStyle.samples.length} videos de referencia` };
  return knowledge ? { profile: knowledge.all.style, from: SCHOOL_FROM(knowledge.n) } : null;
}
if (!process.env.VITEST) setTimeout(() => void refreshRefStyle().catch(() => {}), 20_000).unref();
