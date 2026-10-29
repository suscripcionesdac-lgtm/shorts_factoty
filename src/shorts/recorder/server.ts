import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import open from 'open';
import { ROOT } from '../runs';

/**
 * Abre una pagina local para grabar con el microfono las frases indicadas.
 * El navegador convierte cada toma a WAV, asi que no hace falta FFmpeg.
 */
export function recordBeats(id: string, narrations: string[], pending: number[], fileFor: (i: number) => string, port = 4321) {
  const html = fs.readFileSync(path.join(ROOT, 'src/shorts/recorder/recorder.html'), 'utf8');
  return new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html.replace('__DATA__', JSON.stringify({ id, narrations, pending }).replace(/</g, '\\u003c')));
      }
      if (req.method === 'POST' && url.pathname === '/save') {
        const i = Number(url.searchParams.get('beat'));
        if (!Number.isInteger(i) || i < 0 || i >= narrations.length) return res.writeHead(400).end();
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.mkdirSync(path.dirname(fileFor(i)), { recursive: true });
          fs.writeFileSync(fileFor(i), Buffer.concat(chunks));
          res.writeHead(200).end('ok');
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/done') {
        res.writeHead(200).end('ok');
        const missing = pending.filter((i) => !fs.existsSync(fileFor(i)));
        server.close();
        server.closeAllConnections?.();
        return missing.length ? reject(new Error(`Faltan frases por grabar: ${missing.map((i) => i + 1).join(', ')}`)) : resolve();
      }
      res.writeHead(404).end();
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const u = `http://localhost:${port}/`;
      console.log(`\n  Grabadora abierta en ${u}\n  Graba cada frase y pulsa "Terminar". (Ctrl+C para cancelar)\n`);
      open(u).catch(() => {});
    });
  });
}
