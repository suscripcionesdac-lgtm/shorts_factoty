import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = process.cwd();
export const PUBLIC = path.join(ROOT, 'public');

export const hash = (v: unknown) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
export const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8'));
export const writeJson = (f: string, v: unknown) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2));
};

export function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
