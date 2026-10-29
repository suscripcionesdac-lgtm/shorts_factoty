/** Limpieza y espacio en disco. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../shared/fs';
import { autoBackup } from './backup';
import { clips, CLIPS, dir, MEDIA, settings, sources } from './core';
import { remove } from './sources';

// ---------- limpieza de disco ----------
export function clean() {
  clearCache(undefined, 48 * 3_600_000);
  autoBackup();
  if (!(settings.cleanDays > 0)) return;
  const limit = Date.now() - settings.cleanDays * 86_400_000;
  for (const s of [...sources.values()]) if (['listo', 'error'].includes(s.status) && +new Date(s.createdAt) < limit) remove(s.id);
}
setInterval(clean, 3_600_000).unref();

const CACHE = /^(prev\d?-.*\.(mp4|webm)|frame-.*\.jpg)$/;
/** Borra vistas previas y fotogramas ya generados (se vuelven a crear solos cuando hacen falta). */
export function clearCache(sid?: string, olderMs = 0) {
  let freed = 0;
  for (const id of sid ? [sid] : [...sources.keys()]) {
    if (!fs.existsSync(dir(id))) continue;
    for (const f of fs.readdirSync(dir(id))) {
      if (!CACHE.test(f) || f.includes('.tmp.')) continue;
      const file = path.join(dir(id), f);
      try { const st = fs.statSync(file); if (Date.now() - st.mtimeMs < olderMs) continue; fs.rmSync(file, { force: true }); freed += st.size; } catch { /* en uso */ }
    }
  }
  diskAt = 0;
  return freed;
}
const sizeOf = (d: string): number => {
  let n = 0;
  try { for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? sizeOf(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size; } catch { /* carpeta que ya no existe */ }
  return n;
};
let diskAt = 0, diskVal = { free: Infinity, total: 0 };
/** Espacio libre en el disco donde se guardan las grabaciones. */
export function disk() {
  if (Date.now() - diskAt < 10_000) return diskVal;
  diskAt = Date.now();
  try { const st = fs.statfsSync(fs.existsSync(MEDIA) ? MEDIA : ROOT); diskVal = { free: Number(st.bavail) * Number(st.bsize), total: Number(st.blocks) * Number(st.bsize) }; } catch { /* sistema sin statfs */ }
  return diskVal;
}
/** Cuanto ocupa cada grabacion y los clips, para decidir que borrar. */
export function storage() {
  diskAt = 0;
  const list = [...sources.values()].map((s) => {
    const d = dir(s.id), own = !!s.file && path.resolve(s.file).startsWith(path.resolve(d));
    let cache = 0;
    try { for (const f of fs.readdirSync(d)) if (CACHE.test(f)) cache += fs.statSync(path.join(d, f)).size; } catch { /* sin carpeta */ }
    const made = [...clips.values()].filter((c) => c.sid === s.id && c.kind === 'clip' && c.status === 'listo').length;
    return { id: s.id, name: s.name, streamer: s.streamer, status: s.status, createdAt: s.createdAt, bytes: sizeOf(d), cache, own, clips: made, pending: s.candidates.filter((c) => !c.hidden && !c.exported).length };
  }).sort((a, b) => b.bytes - a.bytes);
  return { ...disk(), media: list.reduce((t, x) => t + x.bytes, 0), cache: list.reduce((t, x) => t + x.cache, 0), clips: sizeOf(CLIPS), clipCount: clips.size, sources: list };
}
/** Quita varias grabaciones de golpe (las que estan grabando o descargando no se tocan). */
export function removeMany(sids: string[]) {
  let n = 0;
  for (const id of sids || []) { const s = sources.get(id); if (s && ['listo', 'error'].includes(s.status)) { remove(id); n++; } }
  diskAt = 0;
  return n;
}
