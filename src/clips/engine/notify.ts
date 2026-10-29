/** Avisos al movil (Discord y Telegram). */
import { fmtTime } from '../analysis/detect';
import { pickClips } from '../analysis/story';
import { type Candidate, log, notice, settings, type Source } from './core';
import { dupOf } from './profile';
import { exportClip } from './render';

// ---------- avisos al celular ----------
export async function alertPhone(text: string) {
  const post = (url: string, body: unknown, who: string) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error(`${who} respondió ${r.status}`); });
  const jobs: Promise<void>[] = [];
  if (/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(settings.discord)) jobs.push(post(settings.discord, { content: text }, 'Discord'));
  if (settings.telegramToken && settings.telegramChat) jobs.push(post(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, { chat_id: settings.telegramChat, text }, 'Telegram'));
  if (!jobs.length) return false;
  const res = await Promise.allSettled(jobs);
  for (const r of res) if (r.status === 'rejected') log('Aviso al celular: ' + String(r.reason?.message || r.reason).slice(0, 160));
  return res.some((r) => r.status === 'fulfilled');
}
export async function testAlert() {
  if (!(await alertPhone('Clipper: aviso de prueba. Si lees esto, los avisos funcionan.'))) throw new Error('No se pudo enviar el aviso. Revisa el enlace de Discord o los datos de Telegram; el detalle está en el registro.');
}
export function alertNew(s: Source, list: Candidate[]) {
  for (const c of list) {
    if (c.alerted || c.by === 'manual' || c.score < settings.notifyScore) continue;
    c.alerted = true;
    alertPhone(`Momento ${c.score.toFixed(1)} en ${s.name} (${fmtTime(c.start)}): ${c.why}`).catch(() => {});
  }
}
/** «Hacer los clips solo»: los mejores momentos (story.ts › pickClips), auto editados y exportados (sin subirlos), una vez. */
export function makeClips(s: Source) {
  s.autoClips = false;
  const best = pickClips(s.candidates.filter((c) => !c.exported && !c.hidden && !c.wait && !dupOf(s, c)), s.duration || s.analyzedTo);
  for (const c of best) { try { exportClip({ sid: s.id, candidateId: c.id, start: c.start, end: c.end, title: c.title }); } catch { /* se ignora */ } }
  if (best.length) log(`${s.name}: haciendo ${best.length} clip${best.length > 1 ? 's' : ''} con auto edición`);
  // Sin nada nuevo (sus mejores momentos ya estan exportados): se dice, para no dejar esperando.
  else notice('mal', `${s.name}: no hice clips nuevos; sus mejores momentos ya estaban exportados.`);
}
export function autoExport(s: Source, list: Candidate[]) {
  if (!(settings.autoScore > 0)) return;
  for (const c of list) {
    if (c.score < settings.autoScore || c.exported || c.hidden || c.wait || dupOf(s, c)) continue;
    try { exportClip({ sid: s.id, candidateId: c.id, start: c.start, end: c.end, title: c.title }, { auto: true }); log(`Exportando solo el momento de ${fmtTime(c.start)}`); } catch { /* se ignora */ }
  }
}
