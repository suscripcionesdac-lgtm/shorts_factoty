import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Un error de sintaxis en un archivo del navegador deja la app en blanco, y solo lo veia la prueba de interfaz a los
// 10 minutos (pasó con un comentario que anulo media linea de app.js). Aqui se ve en un segundo.
const WEB = path.resolve('src/clips/web');
describe('los archivos del navegador no tienen errores de sintaxis', () => {
  for (const f of fs.readdirSync(WEB, { recursive: true }).map(String).filter((x) => x.endsWith('.js'))) {
    it(f, () => {
      const tmp = path.join(os.tmpdir(), `clipper-sintaxis-${process.pid}-${f.replace(/[\\/]/g, '-').replace(/\.js$/, '.mjs')}`);
      fs.copyFileSync(path.join(WEB, f), tmp);
      const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      fs.rmSync(tmp, { force: true });
      expect(r.status, r.stderr).toBe(0);
    });
  }
});
