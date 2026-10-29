import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import open from 'open';
import { PUBLIC, ROOT } from '../shared/fs';
import { ensurePreview, warmPreviews } from './media/transprev';
import * as E from './engine';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.bin': 'application/octet-stream', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};
const WEB = path.join(ROOT, 'src/clips/web');

/** Sirve un archivo con soporte de rangos, para que el navegador pueda saltar dentro del video. */
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, download?: string) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end('no existe');
  const size = fs.statSync(file).size;
  const head: Record<string, string | number> = { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (download) head['content-disposition'] = `attachment; filename="${download}"`;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return void fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'content-length': size });
  fs.createReadStream(file).pipe(res);
}

/** Envia un archivo que otro proceso todavia esta escribiendo, hasta que termina (vista previa al vuelo). */
async function growing(res: http.ServerResponse, tmp: string, out: string, done: Promise<string>) {
  let finished = false, failed = false, closed = false, pos = 0;
  done.then(() => (finished = true), () => (finished = failed = true));
  res.on('close', () => (closed = true));
  res.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'no-store' });
  const buf = Buffer.alloc(1 << 20), wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (!closed) {
    const file = fs.existsSync(tmp) ? tmp : fs.existsSync(out) ? out : '';
    let n = 0;
    if (file) { const fd = fs.openSync(file, 'r'); try { n = fs.readSync(fd, buf, 0, buf.length, pos); } finally { fs.closeSync(fd); } }
    if (n > 0) { pos += n; if (!res.write(buf.subarray(0, n))) await new Promise((r) => res.once('drain', r)); continue; }
    if (finished || failed) break;
    await wait(80);
  }
  res.end();
}

/** Archivo dentro de una carpeta permitida; nunca fuera de ella. */
function under(root: string, rel: string) {
  const f = path.normalize(path.join(root, decodeURIComponent(rel)));
  return f.startsWith(root) ? f : null;
}

const body = (req: http.IncomingMessage) =>
  new Promise<any>((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });

const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const u = new URL(req.url || '/', `http://localhost:${E.PORT}`);
  const q = (k: string) => u.searchParams.get(k) || '';
  const json = (v: unknown, code = 200) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(v));
  try {
    if (req.method === 'GET') {
      const p = u.pathname;
      if (p === '/') return sendFile(req, res, path.join(WEB, 'index.html'));
      if (p === '/favicon.ico') return sendFile(req, res, path.join(PUBLIC, 'clipper.ico'));
      for (const [prefix, root] of [['/web/', WEB], ['/clips/', E.CLIPS], ['/assets/', PUBLIC]] as const) {
        if (!p.startsWith(prefix)) continue;
        const f = under(root, p.slice(prefix.length));
        if (!f) return void res.writeHead(403).end();
        return sendFile(req, res, f, q('dl') || undefined);
      }
      switch (p) {
        case '/api/state': return json(E.state());
        case '/api/autoedit/progress': return json(E.autoProgress(q('sid'), +q('start')));
        case '/api/pulse': return json(E.pulse(q('sid')));
        case '/api/live.jpg': { const b = await E.liveJpeg(q('sid')); if (b.length < 500) return void res.writeHead(404).end(); return void res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'content-length': b.length }).end(b); }
        case '/api/storage': return json(E.storage());
        case '/api/assets': return json(E.assets());
        case '/api/timeline': return json(E.timeline(q('sid')));
        case '/api/community': return json(await E.community(q('sid')));
        case '/api/tiktokstats': return json(await E.tiktokStats(q('refresh') === '1'));
        case '/api/wave': return json(E.wave(q('sid'), +q('start'), +q('end')));
        case '/api/template': return json(E.getTemplate(q('streamer')));
        case '/api/clip': return json(E.clipSpec(q('cid')));
        case '/api/backup': return void res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="clipper-copia-${new Date().toISOString().slice(0, 10)}.json"` }).end(JSON.stringify(E.backup(), null, 1));
        case '/api/transprev': warmPreviews(); return sendFile(req, res, await ensurePreview(q('id'), q('kind') === 'mp4' ? 'mp4' : 'jpg'));
        case '/api/frame': return sendFile(req, res, await E.frame(q('sid'), +q('t'), q('hd') === '1', q('sm') === '1'));
        // Responde cuando la vista previa esta generada del todo (el editor cambia entonces al archivo completo).
        case '/api/preview-ready': await E.preview(q('sid'), +q('start'), +q('end')); return json({ ok: true });
        case '/api/preview': {
          // Mientras se genera, se envia segun se escribe: el editor empieza a mostrarla al instante.
          const j = E.previewJob(q('sid'), +q('start'), +q('end')), from = +(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0);
          if (j.ready || !j.stream || from > 0) return sendFile(req, res, await j.p);
          return growing(res, j.tmp, j.out, j.p);
        }
      }
    }
    if (req.method === 'POST') {
      const b = await body(req);
      switch (u.pathname) {
        case '/api/community/vod':
          return json(await E.findInVod(String(b.ref || ''), String(b.streamer || ''), String(b.title || 'Clip').slice(0, 80), Math.max(0, Math.round(+b.views) || 0)));
        case '/api/source': {
          const v = String(b.value || '').trim();
          if (!v) throw new Error('Escribe un enlace o la ruta de un archivo');
          const community = b.community ? { title: String(b.community.title || 'Clip').slice(0, 80), views: Math.max(0, Math.round(+b.community.views) || 0) } : undefined;
          const n = !!b.autoClips; // «Hacer los clips solo»
          return json(/^https?:\/\//.test(v) ? E.addUrl(v, b.streamer || '', !!b.live, b.section || undefined, community, n) : await E.addFile(v, b.streamer || '', n));
        }
        case '/api/analyze': E.analyze(b.sid); return json({ ok: true });
        case '/api/source/lang': return json(E.setSourceLang(String(b.sid || ''), String(b.lang || '')));
        case '/api/stop': E.stop(b.sid); return json({ ok: true });
        case '/api/remove': E.remove(b.sid); return json({ ok: true });
        case '/api/mark': return json(E.mark(b.sid, b.start, b.end, b.last ? +b.last : 45));
        case '/api/discard': E.discard(b.sid, b.cid); return json({ ok: true });
        case '/api/words': return json({ words: await E.wordsFor(b.sid, +b.start, +b.end) });
        case '/api/autolook': return json(await E.autoLook(b.sid, +b.start, +b.end));
        case '/api/condense': return json(await E.condenseRange(b.sid, +b.start, +b.end, +b.target));
        case '/api/silences': return json(await E.silences(b.sid, +b.start, +b.end));
        case '/api/follow': return json({ keys: await E.followFace(b.sid, +b.start, +b.end) });
        case '/api/faces': return json(b.camsOnly ? await E.camsOnly(b.sid, +b.start, +b.end, !!b.fresh) : await E.faces(b.sid, +b.start, +b.end, b.words));
        case '/api/scenes': return json({ scenes: await E.scenesOf(b.sid, +b.start, +b.end, b.cams || [], b.layout) });
        case '/api/autoedit': return json(await E.autoEdit(b.sid, +b.start, +b.end, b.candidateId));
        case '/api/trends': return json(await E.refreshTrends(String(b.streamer || '')));
        case '/api/titles': return json(await E.suggestTitles(b.sid, String(b.text || '')));
        case '/api/subfix': return json(await E.fixSubs(String(b.streamer || ''), b.words || [], b.ai !== false));
        case '/api/translate': return json({ words: await E.translate(b.words || [], String(b.lang || 'inglés')) });
        case '/api/template': E.setTemplate(String(b.streamer || ''), b.template || {}); return json({ ok: true });
        // Un clip, o varios de golpe (lote): los del lote usan la plantilla del streamer.
        case '/api/export': return json(Array.isArray(b.items) ? b.items.map((it: any) => { try { return E.exportClip(it); } catch (e) { return { error: (e as Error).message }; } }) : b.hookTest || b.platforms?.length ? E.exportMany(b) : E.exportClip(b));
        case '/api/autostickers': return json({ stickers: E.autoStickers(b.words, +b.dur) });
        case '/api/profile': E.setProfile(String(b.streamer || ''), b); return json({ ok: true });
        case '/api/storage/clear': return json({ freed: E.clearCache(b.sid || undefined) });
        case '/api/storage/remove': return json({ removed: E.removeMany(b.sids || []) });
        case '/api/example': if (b.remove) { E.removeExample(String(b.streamer || ''), String(b.remove)); return json({ ok: true }); } return json(await E.addExample(String(b.streamer || ''), String(b.value || '')));
        case '/api/alert/test': await E.testAlert(); return json({ ok: true });
        case '/api/restore': E.restore(b); return json({ ok: true });
        case '/api/autoedit/feedback': return json(b.forget ? E.autoForget(String(b.streamer || '')) : E.autoFeedback(String(b.streamer || ''), b.items || []));
        case '/api/montage': return json(E.montage(b.cids || [], String(b.title || ''), String(b.transition || ''), +b.transDur || 0.4));
        case '/api/clip/remove': E.removeClip(b.cid); return json({ ok: true });
        case '/api/clip/update': return json(E.updateClip(b.cid, b));
        case '/api/upload': return json(await E.uploadClip(b.cid));
        case '/api/tiktok-upload/install': return json(await E.tiktokUploadInstall());
        case '/api/tiktok-upload/connect': return json(await E.tiktokUploadConnect(String(b.account || '')));
        case '/api/tiktok-upload': return json(await E.uploadClipTikTok(String(b.cid || ''), { now: !!b.now }));
        case '/api/tiktok-slot': return json(await E.tiktokSlotInfo());
        case '/api/tiktok-risks': return json(await E.tiktokRisksTitled(String(b.cid || '')));
        case '/api/tiktok': if (b.creators != null || b.tags != null) E.updateSettings({ tiktok: { creators: b.creators ?? '', tags: b.tags ?? '' } as any }); if (b.test) return json(await E.tiktokTest()); if (b.connect) return json(E.tiktokConnect()); if (b.disconnect) return json(E.tiktokDisconnect()); return json(E.schoolState());
        case '/api/school': if (b.links) return json(E.studyLinks(String(b.links))); if (b.on != null) E.updateSettings({ school: !!b.on }); if (b.study) void E.study(5, true); return json(E.schoolState());
        case '/api/views':await E.refreshViews(); return json({ ok: true });
        case '/api/settings': E.updateSettings(b); if (['discord', 'telegramToken', 'telegramChat', 'tiktokAccount'].some((k) => k in b)) void E.checkAccounts(); return json({ ok: true });
        case '/api/lab': return json(E.labState());
        case '/api/lab/run': return json(E.labRun(String(b.streamer || '')));
        case '/api/lab/level': return json(E.labLevel(String(b.streamer || ''), +b.level));
        case '/api/lab/forget': E.autoForget(String(b.streamer || '')); return json(E.labState());
        case '/api/accounts/check': await E.checkAccounts(); return json(E.accountsState());
      }
    }
    res.writeHead(404).end('no encontrado');
  } catch (e) {
    json({ error: (e as Error).message }, 400);
  }
};
const server = http.createServer(handler);
E.loadAll();
E.nameVods();
setTimeout(() => E.checkWatch().catch(() => {}), 5000);
server.listen(E.PORT, '127.0.0.1', () => {
  const url = `http://localhost:${E.PORT}`;
  console.log(`\n  Clipper abierto en ${url}\n  (deja esta ventana abierta; Ctrl+C para cerrar)\n`);
  if (!process.env.NO_OPEN) open(url).catch(() => {});
});
