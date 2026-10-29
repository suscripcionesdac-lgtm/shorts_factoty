import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../shared/fs';
import { parseCount } from '../analysis/school';

/**
 * TikTok para la escuela del agente. El usuario inicia sesion EL MISMO en una ventana de navegador propia de Clipper
 * (perfil aparte en data/tiktok-perfil, solo en este PC): Clipper nunca ve ni guarda la contraseña, y la sesion no sale
 * de esa ventana. Con ella se miran las paginas de los creadores y hashtags elegidos y se apuntan los videos publicos y
 * sus vistas; yt-dlp los descarga como cualquier video publico (sin sesion). Va despacio, como una persona.
 */
const DATA = path.join(ROOT, 'data');
const PROFILE = path.join(DATA, 'tiktok-perfil'), FLAG = path.join(DATA, 'tiktok.json');
let connecting = false, busy = false, lastError = '', watching = 0;

export const connected = () => fs.existsSync(FLAG) && fs.existsSync(PROFILE);
export function status() {
  const since = connected() ? String((JSON.parse(fs.readFileSync(FLAG, 'utf8')) as { at?: string }).at || '') : '';
  return { connected: connected(), since, connecting, error: lastError, watching };
}

export type TikTokVideo = { id: string; url: string; title: string; views: number; seconds: number };
/**
 * Videos dentro de los datos que recibe la pagina de TikTok (listas de un creador, de un hashtag, del «Para ti», de
 * una busqueda): cada uno trae id, autor, vistas, duracion y descripcion. Se buscan en cualquier parte de la respuesta.
 */
export function itemsIn(o: any, add: (v: TikTokVideo) => void, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 7) return;
  const id = String(o.id || ''), who = String(o.author?.uniqueId || '');
  if (/^\d{8,}$/.test(id) && who && o.stats) {
    add({ id: 'tt:' + id, url: `https://www.tiktok.com/@${who}/video/${id}`, title: String(o.desc || '').replace(/\s+/g, ' ').trim().slice(0, 150),
      views: +(o.stats.playCount ?? o.statsV2?.playCount ?? 0) || 0, seconds: +(o.video?.duration || 0) || 0 });
    return;
  }
  for (const v of Array.isArray(o) ? o : Object.values(o)) itemsIn(v, add, depth + 1);
}
const DATA_URL = /\/api\/(.*item_list|search\/|post\/|user\/post)/;

/** Abre la ventana de Clipper (Edge, que viene con Windows; si no, el Chromium de Playwright). */
async function open(where: 'visible' | 'apartada') {
  const { chromium } = await import('playwright');
  const opts = { headless: false, viewport: null, args: where === 'apartada' ? ['--window-position=-32000,-32000', '--window-size=1100,900'] : ['--window-position=120,60', '--window-size=1100,900'] };
  fs.mkdirSync(PROFILE, { recursive: true });
  try { return await chromium.launchPersistentContext(PROFILE, { ...opts, channel: 'msedge' }); } catch { return await chromium.launchPersistentContext(PROFILE, opts); }
}
type Ctx = Awaited<ReturnType<typeof open>>;
/** ¿Hay sesion iniciada en la ventana de Clipper? (Solo se mira si existe, nada mas.) */
const loggedIn = async (ctx: Ctx) => (await ctx.cookies('https://www.tiktok.com')).some((c) => c.name === 'sessionid' && !!c.value);

/** Edge instalado (viene con Windows). */
function edgePath() {
  const dirs = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean) as string[];
  return dirs.map((d) => path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((f) => fs.existsSync(f)) || '';
}

/**
 * Abre TikTok en una ventana de Edge normal (sin control de Clipper: Google y TikTok dejan entrar con cualquier metodo
 * y no hay captchas de robot). Sirve para iniciar sesion y para «mirar TikTok con Clipper»: el usuario navega como
 * siempre y Clipper solo escucha los datos que la pagina recibe, para apuntar los videos que pasan por la pantalla con
 * sus vistas. No toca la ventana ni la maneja. Al cerrarla, comprueba la sesion y entrega lo apuntado a `onVideos`.
 * Sin Edge, se usa la ventana de Playwright (ahi Google no deja entrar: QR, telefono o correo si).
 */
export async function connect(onVideos?: (list: TikTokVideo[]) => void) {
  if (connecting || busy) return status();
  connecting = true; lastError = ''; watching = 0;
  const edge = edgePath();
  if (edge) {
    try {
      fs.mkdirSync(PROFILE, { recursive: true });
      const { spawn } = await import('node:child_process');
      const PORT = 9339; // solo en este PC (127.0.0.1), y solo mientras la ventana esta abierta
      // Posicion y tamaño explicitos: Edge recuerda la de la ventana apartada (fuera de la pantalla) que usa Clipper al mirar.
      const p = spawn(edge, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--new-window', '--window-position=120,60', '--window-size=1100,900',
        connected() ? 'https://www.tiktok.com/foryou' : 'https://www.tiktok.com/login'], { stdio: 'ignore' });
      let exited = false;
      const done = new Promise<void>((ok) => { const t = setTimeout(() => { p.kill(); ok(); }, 90 * 60_000); p.on('exit', () => { exited = true; clearTimeout(t); ok(); }); p.on('error', () => { exited = true; clearTimeout(t); ok(); }); });
      // Escuchar lo que recibe la pagina mientras el usuario navega.
      const seen = new Map<string, TikTokVideo>();
      const { chromium } = await import('playwright');
      let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
      for (let i = 0; i < 20 && !exited && !browser; i++) {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
        if (!browser) await new Promise((ok) => setTimeout(ok, 1000));
      }
      const hook = (pg: import('playwright').Page) => pg.on('response', async (r) => {
        if (!DATA_URL.test(r.url())) return;
        itemsIn(await r.json().catch(() => null), (v) => { if (!seen.has(v.id) || !seen.get(v.id)!.views) seen.set(v.id, v); });
        watching = seen.size;
      });
      for (const c of browser?.contexts() || []) { c.pages().forEach(hook); c.on('page', hook); }
      await done;
      await browser?.close().catch(() => {});
      if (seen.size && onVideos) onVideos([...seen.values()]);
      await new Promise((ok) => setTimeout(ok, 1500)); // que Edge suelte el perfil
      const ctx = await open('apartada');
      try {
        if (await loggedIn(ctx)) fs.writeFileSync(FLAG, JSON.stringify({ at: new Date().toISOString() }));
        else lastError = 'Se cerró la ventana sin iniciar sesión en TikTok.';
      } finally { await ctx.close().catch(() => {}); }
    } catch (e) {
      lastError = 'No pude abrir la ventana de TikTok: ' + (e as Error).message.slice(0, 160);
    } finally { connecting = false; }
    return status();
  }
  let ctx: Ctx | null = null;
  try {
    ctx = await open('visible');
    let closed = false;
    ctx.on('close', () => (closed = true));
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    for (let i = 0; i < 300 && !closed; i++) {
      if (await loggedIn(ctx).catch(() => false)) {
        fs.writeFileSync(FLAG, JSON.stringify({ at: new Date().toISOString() }));
        await new Promise((ok) => setTimeout(ok, 2500));
        return status();
      }
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    lastError = closed ? 'Se cerró la ventana sin iniciar sesión.' : 'No se inició sesión en 10 minutos.';
    return status();
  } catch (e) {
    lastError = 'No pude abrir la ventana de TikTok: ' + (e as Error).message.slice(0, 160);
    return status();
  } finally {
    connecting = false;
    await ctx?.close().catch(() => {});
  }
}
/** Cierra la sesion en Clipper: borra su perfil (tu cuenta de TikTok no cambia). */
export function disconnect() {
  if (busy || connecting) throw new Error('Espera a que termine lo que está haciendo con TikTok.');
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.rmSync(FLAG, { force: true });
  lastError = '';
  return status();
}

/** Videos de una pagina de TikTok (creador o hashtag) con sus vistas. Baja unas pocas veces, como una persona. */
export async function listVideos(url: string, max = 30): Promise<TikTokVideo[]> {
  if (!connected()) throw new Error('TikTok no está conectado.');
  if (busy || connecting) throw new Error('TikTok está ocupado.');
  busy = true;
  let ctx: Ctx | null = null;
  try {
    ctx = await open('apartada');
    if (!(await loggedIn(ctx))) { fs.rmSync(FLAG, { force: true }); throw new Error('La sesión de TikTok caducó: vuelve a pulsar «Conectar TikTok».'); }
    const page = ctx.pages()[0] || (await ctx.newPage());
    const seen = new Map<string, TikTokVideo>();
    // Los datos que la propia pagina recibe al cargar los videos (lista de un creador o de un hashtag): traen vistas,
    // duracion y descripcion. Es mas estable que leer lo que se dibuja, que TikTok cambia a menudo.
    const add = (v: TikTokVideo) => { if (!seen.has(v.id) || !seen.get(v.id)!.views) seen.set(v.id, v); };
    page.on('response', async (r) => { if (DATA_URL.test(r.url())) itemsIn(await r.json().catch(() => null), add); });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(3500 + Math.random() * 2000);
    // Lo que venga ya dentro de la pagina (la primera tanda de un creador suele venir incrustada).
    itemsIn(await page.evaluate(() => {
      const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      try { return el ? JSON.parse(el.textContent || '{}') : null; } catch { return null; }
    }).catch(() => null), add);
    for (let i = 0; i < 5 && seen.size < max; i++) {
      const found = await page.evaluate(() => [...document.querySelectorAll('a[href*="/video/"]')].map((a) => {
        const item = a.closest('[data-e2e$="-item"]') || a.parentElement;
        const views = item?.querySelector('[data-e2e="video-views"], strong')?.textContent || '';
        const desc = item?.querySelector('[data-e2e$="-desc"]')?.textContent || a.querySelector('img')?.getAttribute('alt') || '';
        return { href: (a as HTMLAnchorElement).href, views, desc };
      }));
      for (const f of found) {
        const m = f.href.match(/tiktok\.com\/@([\w.]+)\/video\/(\d+)/);
        // Lo leido de la pagina solo completa: lo de los datos (con vistas de verdad) manda.
        if (m && !seen.has('tt:' + m[2])) seen.set('tt:' + m[2], { id: 'tt:' + m[2], url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`, title: f.desc.replace(/\s+/g, ' ').trim().slice(0, 150), views: parseCount(f.views), seconds: 0 });
      }
      await page.mouse.wheel(0, 1500 + Math.random() * 800);
      await page.waitForTimeout(1800 + Math.random() * 1500);
    }
    if (!seen.size) {
      // Sin videos: se guarda lo que se vio (solo en este PC) para saber por que, y se mira si es un captcha de verdad
      // (TikTok tiene elementos «captcha» ocultos en paginas normales: solo cuenta si se ve y tiene tamaño).
      await page.screenshot({ path: path.join(DATA, 'tiktok-ultima.png') }).catch(() => {});
      const captcha = await page.evaluate(() => [...document.querySelectorAll('[id*="captcha" i], [class*="captcha" i], iframe[src*="captcha"]')].some((el) => {
        const r = el.getBoundingClientRect(), st = getComputedStyle(el);
        return r.width > 150 && r.height > 100 && st.visibility !== 'hidden' && st.display !== 'none' && +st.opacity > 0;
      })).catch(() => false);
      throw new Error(captcha
        ? 'TikTok pide un captcha. Pulsa «Abrir la ventana», resuélvelo si aparece y ciérrala. Si no aparece, TikTok solo lo muestra a la ventana automática: mejor espera unas horas.'
        : 'No encontré videos en ' + url.replace('https://www.', '') + ' (¿existe la cuenta o el hashtag?). Lo que se vio está en data/tiktok-ultima.png.');
    }
    lastError = '';
    return [...seen.values()].slice(0, max);
  } catch (e) {
    lastError = (e as Error).message.slice(0, 200);
    throw e;
  } finally {
    busy = false;
    await ctx?.close().catch(() => {});
  }
}
