// Identidad de Clipper: contraste WCAG AA de los colores reales y capturas de cada pantalla.
// Se ejecuta con `npm run test:ui -- neon` (usa el mismo Clipper aislado que app.pw.ts).
import { expect, test } from '@playwright/test';

/** Luminancia relativa y contraste WCAG (1 a 21) de dos colores #RRGGBB. */
function lum(hex: string) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Pares de texto y fondo reales de la interfaz: minimo 4,5:1 (texto normal).
const TEXT_PAIRS: [string, string, string][] = [
  ['texto sobre fondo', '--text', '--bg'],
  ['texto sobre superficie', '--text', '--surface-1'],
  ['texto sobre superficie elevada', '--text', '--surface-2'],
  ['texto sobre superficie hover', '--text', '--surface-hover'],
  ['secundario sobre superficie', '--mut', '--surface-1'],
  ['secundario sobre superficie elevada', '--mut', '--surface-2'],
  ['secundario sobre superficie hover', '--mut', '--surface-hover'],
  ['apagado sobre superficie', '--mut2', '--surface-1'],
  ['apagado sobre superficie elevada', '--mut2', '--surface-2'],
  ['texto de los botones sobre el azul de boton', '--accText', '--acc-bg'],
  ['texto de los botones sobre su hover', '--accText', '--acc-hover'],
  ['texto sobre ambar (progreso)', '--onFill', '--warn'],
  ['texto sobre coral (grabacion)', '--onFill', '--rec'],
  ['texto sobre verde (listo)', '--onFill', '--ok'],
  ['texto sobre azul (trabajando)', '--onFill', '--info'],
  ['azul como enlace o foco sobre superficie', '--acc', '--surface-1'],
  ['error sobre superficie', '--recText', '--surface-1'],
  ['info sobre superficie', '--info', '--surface-1'],
  ['ok sobre superficie', '--ok', '--surface-1'],
  ['ambar sobre superficie', '--warn', '--surface-1'],
];
// Componentes graficos (iconos, foco, bordes de control): minimo 3:1.
const GRAPHIC_PAIRS: [string, string, string][] = [
  ['foco naranja sobre fondo', '--acc', '--bg'],
  ['foco naranja sobre superficie', '--acc', '--surface-1'],
  ['tinte del icono de seccion (coral) sobre fondo', '--c-live', '--bg'],
  ['tinte del icono de seccion (azul) sobre fondo', '--c-clips', '--bg'],
  ['tinte del icono de seccion (verde) sobre fondo', '--c-watch', '--bg'],
];

test.describe('Estudio grafito de Clipper', () => {
  test('la paleta cumple WCAG AA en sus combinaciones reales', async ({ page }) => {
    await page.goto('/');
    const tok = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return Object.fromEntries(['--bg', '--text', '--mut', '--mut2', '--surface-1', '--surface-2', '--surface-hover', '--acc', '--acc-hover', '--accText', '--acc-bg', '--onFill', '--warn', '--rec', '--ok', '--info', '--recText', '--c-live', '--c-clips', '--c-watch']
        .map((k) => [k, cs.getPropertyValue(k).trim()]));
    });
    // getComputedStyle devuelve «#hex» tal cual lo escribimos en los tokens
    const hex = (k: string) => { const v = tok[k]; expect(v, `token ${k}`).toMatch(/^#[0-9A-Fa-f]{6}$/); return v; };
    const fails: string[] = [];
    for (const [name, a, b] of TEXT_PAIRS) { const r = ratio(hex(a), hex(b)); if (r < 4.5) fails.push(`${name}: ${r.toFixed(2)}:1 (min 4,5)`); }
    for (const [name, a, b] of GRAPHIC_PAIRS) { const r = ratio(hex(a), hex(b)); if (r < 3) fails.push(`${name}: ${r.toFixed(2)}:1 (min 3)`); }
    expect(fails, fails.join('\n')).toEqual([]);
  });

  test('usa el fondo grafito del tema oscuro', async ({ page }) => {
    await page.goto('/');
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    expect(scheme).toBe('dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(21, 26, 29)'); // token --bg: #151A1D
  });

  test('mantiene opacas las superficies de trabajo', async ({ page }) => {
    await page.goto('/');
    const filters = await page.evaluate(() =>
      [...document.querySelectorAll('html, body, #app, #app *')]
        .map((el) => getComputedStyle(el).backdropFilter),
    );
    expect(filters.filter((filter) => filter !== 'none')).toEqual([]);
  });

  test('mantiene los colores propios de las páginas y herramientas', async ({ page }) => {
    await page.goto('/');
    const colors = await page.evaluate(() => ({
      media: getComputedStyle(document.querySelector('.pages [data-view=live] svg.ico')!).color,
      editor: getComputedStyle(document.querySelector('.pages [data-view=editor] svg.ico')!).color,
      deliver: getComputedStyle(document.querySelector('.pages [data-view=clips] svg.ico')!).color,
      learn: getComputedStyle(document.querySelector('.pages [data-view=agent] svg.ico')!).color,
      utility: getComputedStyle(document.querySelector('#appbar #notiBtn svg.ico')!).color,
    }));
    expect(colors.media).toBe('rgb(100, 210, 255)');
    expect(colors.editor).toBe('rgb(191, 90, 242)');
    expect(colors.deliver).toBe('rgb(255, 159, 10)');
    expect(colors.learn).toBe('rgb(255, 214, 10)');
    expect(colors.utility).toBe('rgb(255, 159, 10)');
  });

  // Reglas de diseño en cada pantalla (lo que fallo de verdad: «Añadir» cortado por una casilla nueva, una casilla
  // desactivada que parecia activa). Tamaño minimo de control en escritorio: 20 x 20 (apple-design, accessibility.md).
  test('diseño: nada cortado, controles de tamaño minimo y lo desactivado se ve desactivado', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#tour .tip', { timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 16 && (await page.locator('#tour').count()); i++) await page.click('#tour [data-t=next]');
    // Un clip de la comunidad (el enlace no existe: se queda con error), para que aparezcan las pestañas
    // «Directos | Comunidad»: un elemento nuevo solo se comprueba si sale en pantalla.
    await page.request.post('/api/source', { data: { value: 'https://www.twitch.tv/prueba/clip/NoExisteEsteClipDePrueba', streamer: 'prueba', community: { title: 'Un clip de la comunidad con un título bastante largo', views: 3 } } });
    await page.reload();
    await expect(page.locator('.srctabs [data-srctab]'), 'pestañas de la lista').toHaveCount(2);
    const fails: string[] = [];
    for (const view of ['live', 'clips', 'agent', 'lab', 'stats', 'settings']) {
      await page.evaluate((v) => (document.querySelector(`[data-view=${v}]`) as HTMLElement | null)?.click(), view);
      await page.waitForTimeout(500);
      fails.push(...(await page.evaluate((v) => {
        const out: string[] = [];
        const name = (el: Element) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || el.id || el.tagName).trim().slice(0, 40);
        for (const el of document.querySelectorAll<HTMLElement>(`#v-${v} button, #v-${v} a.btn, #v-${v} input:not([type=hidden]), #v-${v} select, #appbar button`)) {
          const r = el.getBoundingClientRect();
          if (!el.offsetParent || r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
          // El panel que lo recorta (overflow hidden), salvo los que se desplazan a proposito.
          let p = el.parentElement;
          while (p && !['hidden', 'clip'].includes(getComputedStyle(p).overflowX)) p = p.parentElement;
          if (p) { const pr = p.getBoundingClientRect(); if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push(`${v}: «${name(el)}» se sale de su panel`); }
          // El texto de un boton cabe en el boton (las pestañas «Directos y vídeos | Clips de la comunidad» se pisaban).
          // Los nombres que escribe el usuario (fuentes, clips) pueden acortarse con «…»: no cuentan.
          if (el.tagName === 'BUTTON' && !el.closest('.srcchip, .one') && el.scrollWidth > el.clientWidth + 1) out.push(`${v}: el texto de «${name(el)}» no cabe en su botón`);
          const box = el.type === 'checkbox' || el.type === 'radio' ? el.closest('label') || el : el;
          const br = box.getBoundingClientRect();
          if (br.width < 20 || br.height < 20) out.push(`${v}: «${name(el)}» mide ${Math.round(br.width)}x${Math.round(br.height)} (minimo 20x20)`);
          if ((el as HTMLButtonElement).disabled) {
            let o = 1;
            for (let x: HTMLElement | null = el; x; x = x.parentElement) o *= +getComputedStyle(x).opacity;
            if (o > 0.7) out.push(`${v}: «${name(el)}» esta desactivado pero no lo parece (opacidad ${o.toFixed(2)})`);
          }
        }
        return out;
      }, view)));
    }
    // La lista de directos y videos: todas las filas con la misma forma (un «listo» que saltaba de linea las
    // descuadraba) y la elegida sin barra de color a un lado (impeccable: nada de bordes de color en filas).
    await page.evaluate(() => (document.querySelector('[data-view=live]') as HTMLElement).click());
    await page.click('[data-srctab=com]');
    await page.click('.lv-src .srcchip[data-sid]:not([data-sid="*"])');
    fails.push(...(await page.evaluate(() => {
      const out: string[] = [], rows = [...document.querySelectorAll<HTMLElement>('.lv-src .srcchip[data-sid]:not([data-sid="*"])')];
      const hs = rows.map((r) => Math.round(r.getBoundingClientRect().height));
      if (new Set(hs).size > 1) out.push(`live: las filas de la lista no miden lo mismo (${hs.join(', ')} px)`);
      const on = document.querySelector<HTMLElement>('.lv-src .srcchip.on');
      if (on && /inset \d+px 0px 0px/.test(getComputedStyle(on).boxShadow)) out.push('live: la fila elegida lleva una barra de color a un lado');
      return out;
    })));
    expect([...new Set(fails)], [...new Set(fails)].join('\n')).toEqual([]);
  });

  test('capturas de cada pantalla para revisar la identidad', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // el recorrido de bienvenida sale la primera vez y tapa la app: se recorre hasta el final
    await page.waitForSelector('#tour .tip', { timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 16 && (await page.locator('#tour').count()); i++) await page.click('#tour [data-t=next]');
    await expect(page.locator('#tour')).toHaveCount(0);
    for (const view of ['live', 'clips', 'agent', 'lab', 'stats', 'settings', 'editor']) {
      if (view === 'editor') {
        await page.locator('.nav[data-view=live]').click();
        const candidate = await page.evaluate(async () => {
          const state = await fetch('/api/state').then((r) => r.json());
          return state.sources.find((source) => source.name === 'prueba')?.candidates[0]?.id;
        });
        if (candidate) {
          const moment = page.locator(`[data-open$="|${candidate}"]`);
          await moment.scrollIntoViewIfNeeded();
          if (await moment.getAttribute('aria-expanded') !== 'true') await moment.click();
          await page.click(`[data-edit="${candidate}"]`);
          await page.waitForSelector('#cv');
          await page.waitForFunction(() => {
            const video = document.querySelector('#pv') as HTMLVideoElement | null;
            return video && video.readyState >= 2 && !video.seeking && !document.querySelector('#pvHint')?.textContent;
          }, null, { timeout: 30_000 });
          await page.waitForSelector('#tour .tip', { timeout: 1000 }).catch(() => {});
          for (let i = 0; i < 16 && (await page.locator('#tour').count()); i++) await page.click('#tour [data-t=next]');
          await expect(page.locator('#tour')).toHaveCount(0);
        }
      } else {
        const nav = page.locator(`.nav[data-view=${view}]`);
        if (await nav.count()) await nav.click();
      }
      await page.waitForTimeout(400);
      await page.screenshot({ path: info.outputPath(`studio-${view}.png`), fullPage: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const mobileOverflow = await page.evaluate(() => {
      const header = document.querySelector('.ehead')!;
      const transport = document.querySelector('.transport')!;
      return {
        header: header.scrollWidth > header.clientWidth + 1,
        transport: transport.scrollWidth > transport.clientWidth + 1,
      };
    });
    expect(mobileOverflow).toEqual({ header: false, transport: false });
    await page.screenshot({ path: info.outputPath('studio-editor-mobile.png'), fullPage: false });
  });
});
