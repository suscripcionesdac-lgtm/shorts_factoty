/** Copia de seguridad de los ajustes. */
import path from 'node:path';
import fs from 'node:fs';
import { writeJson } from '../../shared/fs';
import { cleanTiktok } from '../analysis/school';
import { STYLES } from '../media/fast';
import { fmtTime } from '../analysis/detect';
import { faces } from './analysis';
import { checkWatch, watchState } from './community';
import { active, type ClipMeta, clips, DATA, log, logs, notices, procs, replaceTemplates, saveSettings, settings, type Settings, SETTINGS, sources, taps, templates, TEMPLATES } from './core';
import { clean, disk } from './disk';
import { labState } from './lab';
import { dupOf, lengthFor, suggestions } from './profile';
import { accountsState } from './publish';
import { channelOf } from './sources';
import { school, schoolState } from './study';
import { tools } from './tools';

// ---------- copia de seguridad ----------
export const backup = () => ({ app: 'clipper', version: 1, at: new Date().toISOString(), settings, templates });
const BACKUPS = path.join(DATA, 'backups');
/** Una copia al dia en data/backups (se guardan las 7 ultimas), por si se estropea o se borra la configuracion. */
export function autoBackup() {
  try {
    if (!fs.existsSync(SETTINGS)) return;
    const f = path.join(BACKUPS, `clipper-${new Date().toISOString().slice(0, 10)}.json`);
    if (fs.existsSync(f)) return;
    writeJson(f, backup());
    for (const old of fs.readdirSync(BACKUPS).filter((x) => /^clipper-.*\.json$/.test(x)).sort().slice(0, -7)) fs.rmSync(path.join(BACKUPS, old), { force: true });
  } catch { /* la copia automatica nunca debe impedir que la app arranque */ }
}
const lastBackup = () => { try { return fs.readdirSync(BACKUPS).filter((x) => /^clipper-.*\.json$/.test(x)).sort().pop()?.slice(8, 18) || ''; } catch { return ''; } };

export function restore(b: any) {
  if (!b || b.app !== 'clipper' || typeof b.settings !== 'object') throw new Error('Ese archivo no es una copia de seguridad de Clipper.');
  Object.assign(settings, b.settings, { models: b.settings.models || {}, profiles: b.settings.profiles || {}, watch: Array.isArray(b.settings.watch) ? b.settings.watch : [] });
  if (b.templates && typeof b.templates === 'object') { replaceTemplates(b.templates); writeJson(TEMPLATES, templates); }
  saveSettings();
  log('Copia de seguridad restaurada');
}

export function updateSettings(p: Partial<Settings>) {
  if (p.autoScore != null) settings.autoScore = Math.max(0, Math.min(10, +p.autoScore));
  if (p.notifyScore != null) settings.notifyScore = Math.max(0, Math.min(10, +p.notifyScore));
  if (p.cleanDays != null) settings.cleanDays = Math.max(0, Math.round(+p.cleanDays));
  if (p.visual != null) settings.visual = !!p.visual;
  if (p.faces != null) settings.faces = !!p.faces;
  if (p.watch) settings.watch = p.watch.filter((w) => /^https?:\/\//.test(w.url)).map((w) => ({ url: w.url.trim(), streamer: (w.streamer || channelOf(w.url)).trim() }));
  if (p.fast != null) settings.fast = !!p.fast;
  if (p.school != null) settings.school = !!p.school;
  if (p.tiktok != null) settings.tiktok = cleanTiktok(p.tiktok);
  if (p.tiktokAccount != null) {
    const account = String(p.tiktokAccount).trim().replace(/^@/, '');
    if (account && !/^[a-z0-9._]{1,24}$/i.test(account)) throw new Error('Escribe un nombre de usuario de TikTok válido.');
    settings.tiktokAccount = account;
  }
  if (p.tiktokVisibility != null) {
    if (!['everyone', 'friends', 'private'].includes(p.tiktokVisibility)) throw new Error('La visibilidad de TikTok no es válida.');
    settings.tiktokVisibility = p.tiktokVisibility;
  }
  if (p.tiktokAuto != null) settings.tiktokAuto = !!p.tiktokAuto;
  if (p.tiktokSmart != null) settings.tiktokSmart = !!p.tiktokSmart;
  if (p.discord != null) settings.discord = String(p.discord).trim();
  if (p.telegramToken != null) settings.telegramToken = String(p.telegramToken).trim();
  if (p.telegramChat != null) settings.telegramChat = String(p.telegramChat).trim();
  saveSettings();
  if (p.watch) checkWatch().catch(() => {});
  clean();
}

const BY: Record<string, string> = { audio: 'Detectado por volumen', ia: 'Elegido por la IA', manual: 'Guardado por ti', chat: 'Pedido por el chat', comunidad: 'Clipeado por la comunidad' };
export const VAR: Record<string, string> = { A: 'Sin gancho', B: 'Con gancho', C: 'Directo a la acción' };
const LAY: Record<string, string> = { split: 'Cámara + juego', half: 'Mitad y mitad', pip: 'Cámara redonda', fit: 'Completo', crop: 'Pantalla llena', cam: 'Solo cámara', duo: 'Varias cámaras', float: 'Cámaras flotantes', montaje: 'Montaje' };

/** Que tipo de clip rinde mas: media de vistas por origen del momento, encuadre y duracion. */
export function report(list: (ClipMeta & { views: number })[]) {
  const withViews = list.filter((c) => c.views > 0);
  const group = (name: string, keyOf: (c: ClipMeta) => string) => {
    const m = new Map<string, { n: number; v: number }>();
    for (const c of withViews) { const k = keyOf(c); const g = m.get(k) || { n: 0, v: 0 }; g.n++; g.v += (c as any).views; m.set(k, g); }
    return { name, rows: [...m.entries()].map(([k, g]) => ({ k, n: g.n, avg: Math.round(g.v / g.n) })).sort((a, b) => b.avg - a.avg) };
  };
  return {
    clips: withViews.length,
    groups: [
      group('Origen del momento', (c) => BY[c.by || ''] || 'Tramo elegido a mano'),
      group('Encuadre', (c) => LAY[c.layout] || c.layout),
      group('Duración', (c) => ((c.seconds || c.end - c.start) < 25 ? 'Menos de 25 s' : (c.seconds || c.end - c.start) < 45 ? '25 a 45 s' : 'Más de 45 s')),
      group('Hora de publicación', (c) => (c.scheduledAt ? new Date(c.scheduledAt).getHours() + ':00' : 'Sin programar')),
      group('Inicio del clip', (c) => VAR[c.variant || ''] || (c.spec?.hook ? 'Con gancho' : 'Sin gancho')),
    ].filter((g) => g.rows.length),
  };
}

/** Se muestra en Ajustes, para confirmar de un vistazo que version esta abierta. */
export const VERSION = '12 oct · v14';
export const state = () => {
  const cl = [...clips.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => {
    const views = (c.viewsYt || 0) + (c.viewsOther || 0);
    const { spec: _s, features: _f, text: _t, viewLabel: _v, ...rest } = c;
    return { ...rest, views };
  });
  const d = disk();
  const toolInfo = tools();
  return {
    version: VERSION,
    disk: { free: Number.isFinite(d.free) ? d.free : null, total: d.total, low: d.free < 5e9 },
    tools: toolInfo,
    busy: [...active].filter(Boolean).join(' · '),
    logs: logs.slice(-40),
    notices: notices.slice(-60),
    accounts: accountsState(),
    lab: labState(),
    styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v])),
    settings: { notifyScore: settings.notifyScore, autoScore: settings.autoScore, cleanDays: settings.cleanDays, visual: settings.visual, faces: settings.faces,
      fast: settings.fast, discord: settings.discord, telegramToken: settings.telegramToken, telegramChat: settings.telegramChat,
      tiktokAccount: settings.tiktokAccount, tiktokVisibility: settings.tiktokVisibility || 'everyone', tiktokAuto: !!settings.tiktokAuto, tiktokSmart: settings.tiktokSmart !== false,
      lastBackup: lastBackup(), trends: settings.trends || {},
      profiles: Object.fromEntries(Object.entries(settings.profiles).map(([k, p]) => [k, { words: p.words, names: p.names || [], suggest: suggestions(p), examples: p.examples, useLength: p.useLength, fixes: Object.entries(p.fixes || {}).sort((a, b) => b[1].n - a[1].n).slice(0, 60).map(([from, f]) => ({ from, to: f.to, n: f.n })), length: lengthFor(p.useLength ? p.examples : []) }])), watch: settings.watch.map((w) => ({ ...w, state: watchState[w.url] || 'pendiente' })), learned: Object.fromEntries(Object.entries(settings.models).map(([k, m]) => [k, m.n])) },
    sources: [...sources.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((s) => ({
      ...s,
      chat: taps.get(s.id)?.status ?? s.chat,
      active: procs.has(s.id),
      recSeconds: s.status === 'grabando' ? Math.max(0, Math.round((Date.now() - +new Date(s.createdAt)) / 1000)) : 0,
      candidates: s.candidates.filter((c) => !c.hidden).map(({ words, alerted, endWant, ...c }) => ({ ...c, at: fmtTime(c.start), len: Math.round(c.end - c.start), dup: dupOf(s, c) })),
    })),
    clips: cl,
    report: report(cl as any),
    school: schoolState(),
  };
};
