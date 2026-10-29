import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { ASSETS, listRuns, loadAssets, loadScript, markStage, readJson, runFile } from '../runs';
import { countWords } from '../../shared/timing';
import type { Script, VoiceFile } from '../types';

export type Check = { ok: boolean; level: 'error' | 'aviso'; msg: string };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3);
export function similarity(a: string, b: string) {
  const A = new Set(norm(a)), B = new Set(norm(b));
  const inter = [...A].filter((w) => B.has(w)).length;
  return A.size && B.size ? inter / Math.min(A.size, B.size) : 0;
}

export async function qaStage(id: string) {
  const checks: Check[] = [];
  const add = (ok: boolean, msg: string, level: Check['level'] = 'error') => checks.push({ ok, level, msg });
  const script = loadScript(id);
  const maxSec = Number(process.env.MAX_SECONDS || 60);

  // Guion y hechos
  const rumors = script.claims.filter((c) => c.status === 'rumor');
  add(script.claims.every((c) => c.status === 'opinion' || c.sources.length > 0), 'Toda afirmacion confirmada o rumor tiene fuente');
  if (rumors.length) add(/rumor|se dice|no est[aá] confirmad|filtraci/i.test(script.beats.map((b) => b.narration).join(' ')), 'La narracion avisa de que hay rumores');
  const text = script.beats.map((b) => b.narration).join(' ');
  add(countWords(text) >= 40, `El guion tiene sustancia (${countWords(text)} palabras, minimo 40)`, 'aviso');

  // Recursos
  const assets = new Map(loadAssets().map((a) => [a.file, a]));
  for (const b of script.beats) {
    if (!b.visual.asset) continue;
    add(fs.existsSync(path.join(ASSETS, b.visual.asset)), `Existe public/assets/${b.visual.asset}`);
    add(assets.has(b.visual.asset), `${b.visual.asset} esta registrado en assets.json con su origen`);
    const a = assets.get(b.visual.asset);
    if (a && (a.origen === 'permiso' || a.origen === 'oficial')) add(Boolean(a.autor && a.url), `${a.file}: autor y URL de origen anotados`, 'aviso');
  }
  const foreign = script.beats.filter((b) => b.visual.asset && assets.get(b.visual.asset)?.origen !== 'propio').length;
  add(foreign / script.beats.length <= 0.6, `Material ajeno en ${foreign} de ${script.beats.length} frases (maximo recomendado 60 %)`, 'aviso');

  // Duplicados
  for (const other of listRuns().filter((r) => r !== id)) {
    const f = runFile(other, 'script.json');
    if (!fs.existsSync(f)) continue;
    const o = readJson<Script>(f);
    const sim = similarity(text, (o.beats || []).map((b) => b.narration).join(' '));
    if (sim > 0.8) add(false, `El guion se parece un ${(sim * 100).toFixed(0)} % al de ${other}`);
  }

  // Voz y video
  const voiceFile = runFile(id, 'voice.json');
  if (fs.existsSync(voiceFile)) add(readJson<VoiceFile>(voiceFile).mode !== 'none', 'El video tiene voz (no es una prueba muda)', 'aviso');
  const video = runFile(id, 'video.mp4');
  if (fs.existsSync(video)) {
    const m = await parseFile(video, { duration: true });
    const tracks = (m.format.trackInfo ?? []) as any[];
    const d = m.format.duration ?? Math.max(0, ...tracks.map((t) => t.duration ?? 0));
    const dim = tracks.find((t) => t.video)?.video;
    add(d > 5 && d <= maxSec, `Duracion ${d.toFixed(1)} s (maximo ${maxSec})`);
    if (dim?.pixelWidth) add(dim.pixelWidth === 1080 && dim.pixelHeight === 1920, `Resolucion ${dim.pixelWidth}x${dim.pixelHeight} (vertical 1080x1920)`);
    add(fs.statSync(video).size > 50_000, 'El archivo de video no esta vacio');
  } else add(false, 'Existe video.mp4 (ejecuta "render")');

  const passed = checks.every((c) => c.ok || c.level === 'aviso');
  fs.writeFileSync(runFile(id, 'qa.json'), JSON.stringify({ passed, checks }, null, 2));
  if (passed) markStage(id, 'qa');
  return { passed, checks };
}
