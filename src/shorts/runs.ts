import fs from 'node:fs';
import path from 'node:path';
import { Asset, Script } from './types';
import { PUBLIC, readJson, slug, writeJson } from '../shared/fs';

export { ROOT, PUBLIC, hash, readJson, slug, writeJson } from '../shared/fs';

export const RUNS = path.join(PUBLIC, 'runs');
export const ASSETS = path.join(PUBLIC, 'assets');

export const STAGES = ['script', 'approved', 'voice', 'build', 'render', 'qa', 'publish'] as const;
export type Stage = (typeof STAGES)[number];

export type State = {
  id: string;
  topic: string;
  createdAt: string;
  stages: Partial<Record<Stage, { at: string; hash?: string; info?: unknown }>>;
  costs: { stage: string; provider: string; units: number; unit: string; usd: number; at: string }[];
  youtube?: { videoId: string; publishAt?: string };
};

export const runDir = (id: string) => path.join(RUNS, id);
export const runFile = (id: string, f: string) => path.join(runDir(id), f);

export function createRun(topic: string): State {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '') + '-' + d.toTimeString().slice(0, 5).replace(':', '');
  const st: State = { id: `${stamp}-${slug(topic)}`, topic, createdAt: d.toISOString(), stages: {}, costs: [] };
  saveState(st);
  return st;
}

/** Acepta el id completo o un prefijo/fragmento unico. */
export function resolveId(partial: string): string {
  const all = listRuns();
  const hit = all.filter((r) => r === partial);
  const matches = hit.length ? hit : all.filter((r) => r.includes(partial));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No existe ningun video con "${partial}". Usa "list".`);
  throw new Error(`"${partial}" coincide con varios: ${matches.join(', ')}`);
}

export const listRuns = () =>
  fs.existsSync(RUNS) ? fs.readdirSync(RUNS).filter((d) => fs.existsSync(path.join(RUNS, d, 'state.json'))).sort() : [];

export const loadState = (id: string) => readJson<State>(runFile(id, 'state.json'));
export const saveState = (s: State) => writeJson(runFile(s.id, 'state.json'), s);

export function markStage(id: string, stage: Stage, extra: { hash?: string; info?: unknown } = {}) {
  const s = loadState(id);
  s.stages[stage] = { at: new Date().toISOString(), ...extra };
  // Rehacer una etapa invalida las posteriores.
  for (const later of STAGES.slice(STAGES.indexOf(stage) + 1)) delete s.stages[later];
  saveState(s);
}

export function requireStage(id: string, stage: Stage, hint: string) {
  if (!loadState(id).stages[stage]) throw new Error(`Falta la etapa "${stage}". ${hint}`);
}

export function addCost(id: string, stage: string, provider: string, units: number, unit: string, usd: number) {
  const s = loadState(id);
  s.costs.push({ stage, provider, units, unit, usd: Number(usd.toFixed(4)), at: new Date().toISOString() });
  saveState(s);
}

export const totalCost = (s: State) => s.costs.reduce((a, c) => a + c.usd, 0);

export function loadScript(id: string): Script {
  const r = Script.safeParse(readJson(runFile(id, 'script.json')));
  if (!r.success) throw new Error('script.json no es valido:\n' + r.error.issues.map((i) => ` - ${i.path.join('.')} ${i.message}`).join('\n'));
  return r.data;
}

export function loadAssets(): Asset[] {
  const f = path.join(ASSETS, 'assets.json');
  if (!fs.existsSync(f)) return [];
  return Asset.array().parse(readJson(f));
}
