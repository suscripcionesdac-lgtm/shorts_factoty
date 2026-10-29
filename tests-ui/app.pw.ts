// Recorrido completo de Clipper en el navegador, con limites de tiempo. Se ejecuta con `npm run test:ui`.
// Cada prueba usa lo que dejo la anterior (importar -> editar -> exportar), asi que van en orden.
import { expect, test, type Page } from '@playwright/test';
import { gridBoxes } from '../src/clips/web/place.js';

// Limites (ms). Holgados para un PC normal; si se superan, algo se ha vuelto lento de verdad.
const MAX = { abrirEditor: 2000, abrirEditorGuardada: 1000, efecto: 150, salto: 250, recorte: 500 };

let page: Page, sid = '', cid = '';
const errors: string[] = [];
const state = () => page.evaluate(() => fetch('/api/state').then((r) => r.json()));
/** Firma de lo que se ve en la vista previa (para saber si cambio). */
/** Abre una herramienta como lo haria el usuario: volver a «Clip» en el inspector y tocarla en la lista. */
const tool = async (k: string) => { const back = page.locator('#etabs [data-k=clip]'); if (await back.count()) await back.click(); await page.click(`#epanel [data-e=tool][data-k=${k}]`); };
const sign = () => page.evaluate(() => { const c = document.getElementById('cv') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4001) h = (h * 31 + d[i]) | 0; return h; });
/** Pulsa y mide cuanto tarda la vista previa en cambiar (-1 si no cambia en 2 s). */
const timeToChange = (sel: string) => page.evaluate(async (sel) => {
  const c = document.getElementById('cv') as HTMLCanvasElement, g = c.getContext('2d')!;
  const sample = document.createElement('canvas'); sample.width = 64; sample.height = 114;
  const sg = sample.getContext('2d', { willReadFrequently: true })!;
  const h = () => {
    sg.drawImage(c, 0, 0, sample.width, sample.height);
    const d = sg.getImageData(0, 0, sample.width, sample.height).data;
    let x = 0; for (let i = 0; i < d.length; i += 97) x = (x * 31 + d[i]) | 0;
    return x;
  };
  const h0 = h(), t0 = performance.now();
  (document.querySelector(sel) as HTMLElement).click();
  for (let i = 0; i < 120; i++) { await new Promise((r) => requestAnimationFrame(r)); if (h() !== h0) return Math.round(performance.now() - t0); }
  return -1;
}, sel);
const previewReady = () => page.waitForFunction(() => { const v = document.querySelector('#pv') as HTMLVideoElement; return v && v.readyState >= 2 && !v.seeking && !document.querySelector('#pvHint')!.textContent; }, null, { timeout: 30_000 });
/** El cursor de reproduccion debe estar sobre la pista, en la posicion del tiempo actual. */
async function expectPlayhead() {
  const [head, lane, t, dur] = await page.evaluate(() => {
    const hb = document.getElementById('head')!.getBoundingClientRect(), lb = document.querySelector('.lane[data-lane=video]')!.getBoundingClientRect();
    const [a, b] = document.getElementById('clock')!.textContent!.split('/').map((x) => x.trim().split(':').reduce((s, v) => s * 60 + +v, 0));
    return [hb.left, lb, a, b] as const;
  });
  expect(Math.abs(head - (lane.left + (lane.width * t) / dur)), 'cursor de reproduccion alineado con la pista').toBeLessThan(lane.width / dur + 4);
}
async function openMoment(id: string) {
  await page.evaluate((k) => { const h = document.querySelector(`[data-open$="|${k}"]`)!; h.scrollIntoView(); if (h.getAttribute('aria-expanded') !== 'true') (h as HTMLElement).click(); }, id);
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await page.click(`[data-edit="${id}"]`);
  // Nada mas abrir, aunque el video aun no haya cargado, el cursor ya debe estar al inicio de la pista.
  await page.waitForSelector('#head');
  const [h, l] = await page.evaluate(() => [document.getElementById('head')!.getBoundingClientRect().left, document.querySelector('.lane[data-lane=video]')!.getBoundingClientRect().left]);
  expect(Math.abs(h - l), 'cursor al inicio de la pista al abrir').toBeLessThan(6);
  await previewReady();
  return Date.now() - t0;
}

/** Cuanto tardan en responder reproducir y pausar (4 veces seguidas), desde el boton. */
async function playPause(page: Page, when: string) {
    await page.evaluate(() => (document.querySelector('#pv') as HTMLVideoElement).currentTime = 3);
    const r = await page.evaluate(async () => {
      const v = document.querySelector('#pv') as HTMLVideoElement, b = document.getElementById('playBtn')!, out: { play: number; pause: number }[] = [];
      const until = (ok: () => boolean) => new Promise<void>((res) => { const k = () => (ok() ? res() : requestAnimationFrame(k)); k(); });
      for (let i = 0; i < 4; i++) {
        const t = v.currentTime, p0 = performance.now(); b.click(); await until(() => !v.paused && v.currentTime > t + 0.01); const play = performance.now() - p0;
        await new Promise((res) => setTimeout(res, 400));
        const q0 = performance.now(); b.click(); await until(() => v.paused); const c = v.currentTime; await new Promise((res) => setTimeout(res, 150));
        out.push({ play: Math.round(play), pause: Math.round(performance.now() - q0 - 150 + (Math.abs(v.currentTime - c) > 0.01 ? 1000 : 0)) });
      }
      return out;
    });
    console.log(`    reproducir/pausar ${when} (ms):`, JSON.stringify(r));
    for (const x of r) { expect(x.play, 'reproducir').toBeLessThan(250); expect(x.pause, 'pausar (y quedarse quieto)').toBeLessThan(100); }
}

test.describe.serial('Clipper', () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Saltar' }).click({ timeout: 5000 }).catch(() => {});
  });

  test('importar un video desde «En vivo» y encontrar momentos', async () => {
    await page.fill('#value', process.env.CLIPPER_UI_VIDEO!);
    // «Hacer los clips solo» viene marcada; aqui no (haria clips en segundo plano durante las pruebas de rendimiento).
    await expect(page.locator('#autoClips'), 'marcada por defecto').toBeChecked();
    await page.uncheck('#autoClips');
    await page.click('#add');
    await expect.poll(async () => (await state()).sources.find((s: any) => s.name === 'prueba')?.status, { timeout: 240_000, intervals: [2000] }).toBe('listo');
    const s = (await state()).sources.find((x: any) => x.name === 'prueba');
    expect(s.candidates.length, 'momentos detectados').toBeGreaterThan(0);
    sid = s.id; cid = s.candidates[0].id;
    // La lista va por estado: el video ya analizado esta en «Terminados».
    await expect(page.locator('.lv-src .srcgt', { hasText: 'Terminados' })).toBeVisible();
    await page.click(`.srcchip[data-sid="${sid}"]`).catch(() => {});
    // Idioma del directo: «Inglés o mezclado» hace que los subtitulos salgan en español; se guarda en la fuente.
    await page.selectOption(`[data-srclang="${sid}"]`, 'mix');
    await expect.poll(async () => (await state()).sources.find((x: any) => x.id === sid)?.lang).toBe('mix');
    await page.selectOption(`[data-srclang="${sid}"]`, '');
    await expect.poll(async () => (await state()).sources.find((x: any) => x.id === sid)?.lang ?? '').toBe('');
    // «Analizar ahora» sobre un video ya analizado termina enseguida: tiene que avisar del resultado.
    await page.click('[data-act=analyze]');
    await expect(page.locator('#toasts').getByText(/Análisis listo/), 'aviso al terminar el análisis').toBeVisible({ timeout: 30_000 });
  });

  test('abrir el editor rapido, con la vista previa nueva y ya generada', async () => {
    const nueva = await openMoment(cid);
    expect(nueva, 'abrir el editor (vista previa nueva)').toBeLessThan(MAX.abrirEditor);
    // La primera vez sale el recorrido del editor; se recorre entero y no vuelve a salir.
    await page.waitForSelector('#tour .tip');
    let pasos = 1;
    for (; pasos < 12 && (await page.locator('#tour [data-t=next]').textContent()) !== 'Listo'; pasos++) await page.click('#tour [data-t=next]');
    expect(pasos, 'pasos del recorrido del editor').toBeGreaterThanOrEqual(5);
    await page.click('#tour [data-t=next]');
    await expect(page.locator('#tour')).toHaveCount(0);
    await expectPlayhead();
    await page.waitForTimeout(500); // la linea de tiempo se reconstruye al llegar la onda y los subtitulos
    await expectPlayhead();
    // Al terminar de generarse, la vista previa pasa al archivo completo (con saltos en todo el clip).
    await page.waitForFunction(() => { const v = document.querySelector('#pv') as HTMLVideoElement; return v.seekable.length > 0 && v.seekable.end(0) > 20; }, null, { timeout: 30_000 });
    await page.click('[data-e=back]');
    await page.waitForTimeout(800);
    const guardada = await openMoment(cid);
    expect(guardada, 'abrir el editor (vista previa ya generada)').toBeLessThan(MAX.abrirEditorGuardada);
    await page.waitForTimeout(1200);
    await expect(page.locator('#tour'), 'el recorrido solo sale la primera vez').toHaveCount(0);
  });

  test('encuadres, estilos y colores se ven al instante', async () => {
    await page.evaluate(() => { (document.querySelector('#pv') as HTMLVideoElement).currentTime = 5; });
    await page.waitForTimeout(500);
    for (const k of ['split', 'duo', 'float', 'cam', 'pip', 'half', 'crop', 'fit']) {
      const ms = await timeToChange(`#efloat [data-e=layout][data-k=${k}]`);
      expect(ms, `encuadre ${k}`).toBeGreaterThanOrEqual(0);
      expect(ms, `encuadre ${k}`).toBeLessThan(MAX.efecto);
    }
    await page.click('#elib [data-e=lib][data-k=efectos]'); // estilos de un clic: en la biblioteca, «Efectos»
    for (const k of ['charla', 'flotantes', 'meme']) {
      const ms = await timeToChange(`#elib [data-e=stylepreset][data-k=${k}]`);
      expect(ms, `estilo ${k}`).toBeGreaterThanOrEqual(0);
      expect(ms, `estilo ${k}`).toBeLessThan(MAX.efecto);
    }
    await tool('imagen');
    for (const [k, want] of [['vivo', /saturate\(1\.35\)/], ['bn', /saturate\(0\)/], ['normal', /^$/]] as const) {
      await page.click(`#epanel [data-e=preset][data-k=${k}]`);
      await expect.poll(() => page.evaluate(() => (document.getElementById('cv') as HTMLCanvasElement).style.filter), { timeout: MAX.efecto * 4 }).toMatch(want);
    }
  });

  test('saltar, reproducir sin cortes y parar al final', async () => {
    await tool('encuadre');
    await page.click('#efloat [data-e=layout][data-k=split]');
    const saltos = await page.evaluate(async () => {
      const v = document.querySelector('#pv') as HTMLVideoElement, out: number[] = [];
      for (const t of [3, 17, 8, 25]) { const t0 = performance.now(); await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; }); out.push(Math.round(performance.now() - t0)); }
      return out;
    });
    for (const ms of saltos) expect(ms, 'saltar dentro de la vista previa').toBeLessThan(MAX.salto);
    const q = await page.evaluate(() => new Promise<{ frames: number; dropped: number }>((res) => {
      const v = document.querySelector('#pv') as HTMLVideoElement, q0 = v.getVideoPlaybackQuality();
      v.currentTime = 2; v.play();
      setTimeout(() => { v.pause(); const q1 = v.getVideoPlaybackQuality(); res({ frames: q1.totalVideoFrames - q0.totalVideoFrames, dropped: q1.droppedVideoFrames - q0.droppedVideoFrames }); }, 3000);
    }));
    expect(q.frames, 'fotogramas reproducidos en 3 s').toBeGreaterThan(60);
    expect(q.dropped, 'fotogramas perdidos').toBeLessThanOrEqual(3);
    // Desde un segundo antes del final: debe pararse en el final del clip (el archivo de la vista previa sigue mas alla).
    const ruler = (await page.locator('.lane.ruler').boundingBox())!;
    const dur = await page.evaluate(() => document.getElementById('clock')!.textContent!.split('/')[1].trim().split(':').reduce((s, v) => s * 60 + +v, 0));
    await page.mouse.click(ruler.x + ruler.width * ((dur - 1.2) / dur), ruler.y + 6);
    await expect.poll(() => page.evaluate(() => document.getElementById('clock')!.textContent!.split('/')[0].trim().split(':').reduce((s, v) => s * 60 + +v, 0)), { message: 'clic en la regla salta a ese punto', timeout: 3000 }).toBeGreaterThanOrEqual(dur - 3);
    await page.click('[data-e=play]');
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => (document.querySelector('#pv') as HTMLVideoElement).paused), 'se para al final del clip').toBe(true);
    await expectPlayhead();
  });

  test('reproducir y pausar responden al instante, varias veces seguidas', async () => {
    await playPause(page, 'al abrir');
  });

  test('si la descarga de la vista previa se corta, se recupera sola y no deja un aviso falso', async () => {
    // Lo que pasa cuando la vista previa llega al vuelo y la conexion se corta: el video da error una vez.
    await page.evaluate(() => document.getElementById('pv')!.dispatchEvent(new Event('error')));
    await previewReady();
    await expect(page.locator('#pvHint')).not.toContainText('No se pudo');
    await expect.poll(() => page.$eval('#pv', (v: HTMLVideoElement) => v.getAttribute('src')), { message: 'reintenta con el archivo terminado' }).toContain('full=1');
    // Un segundo error con el video ya visible tampoco asusta.
    await page.evaluate(() => document.getElementById('pv')!.dispatchEvent(new Event('error')));
    await page.waitForTimeout(300);
    await expect(page.locator('#pvHint')).not.toContainText('No se pudo');
  });

  test('recortar el inicio es instantaneo y no descoloca el cursor', async () => {
    await tool('recorte');
    const t0 = Date.now();
    await page.click('#epanel [data-e=range][data-k=start][data-d="1"]');
    await previewReady();
    expect(Date.now() - t0, 'recortar 1 s el inicio').toBeLessThan(MAX.recorte);
    await page.waitForTimeout(600);
    await expectPlayhead();
  });

  test('«Varias cámaras» muestra las camaras al instante y se pueden añadir a mano', async () => {
    await tool('encuadre');
    await page.click('#efloat [data-e=layout][data-k=fit]');
    const t0 = Date.now();
    await page.click('#efloat [data-e=layout][data-k=duo]');
    // Las camaras ya se encontraron al analizar: no hay que esperar a ver quien habla.
    await page.waitForFunction(() => !/Buscando las cámaras/.test(document.querySelector('#epanel')!.textContent!), null, { timeout: 30_000 });
    expect(Date.now() - t0, 'camaras visibles en «Varias cámaras»').toBeLessThan(1500);
    await page.click('#epanel [data-e=cammode][data-k=fixed]');
    const chips = page.locator('#epanel [data-e=maincam]');
    // Añadir una camara a mano en el selector de zonas
    const addCam = async () => {
      await page.click('#epanel [data-e=openpick]');
      await page.waitForSelector('#zrects .zr'); // el selector se abre con una animacion
      const z0 = await page.locator('#zrects .zr').count();
      await page.click('#zmodal [data-e=zaddcam]');
      await expect(page.locator('#zrects .zr'), 'camara nueva en el selector').toHaveCount(z0 + 1);
      await page.click('#zmodal [data-e=zdone]');
      await expect(page.locator('#zmodal'), 'el selector se cierra (con animacion) antes de contar').toHaveCount(0);
    };
    // Si el video no traia dos camaras, se completan a mano (es justo lo que hay que poder hacer).
    for (let i = 0; i < 3 && (await chips.count()) < 2; i++) await addCam();
    const n0 = await chips.count();
    expect(n0, 'camaras para elegir la principal').toBeGreaterThanOrEqual(2);
    const sigBefore = await sign();
    await addCam();
    await expect(chips, 'la camara añadida cuenta en el panel').toHaveCount(n0 + 1);
    expect(await sign(), 'la vista previa apila la camara nueva').not.toBe(sigBefore);
    // Y se puede quitar (contando justo antes de quitarla).
    const n1 = await chips.count();
    await page.click('#epanel [data-e=openpick]');
    await page.waitForSelector('#zrects .zr');
    await page.click(`#zrects [data-z="cam:${n0}"]`, { position: { x: 10, y: 10 } });
    await page.click('#zmodal [data-e=zdelcam]');
    await page.click('#zmodal [data-e=zdone]');
    await expect(page.locator('#epanel [data-e=maincam]')).toHaveCount(n1 - 1);
  });

  test('camaras, zoom, texto y golpe de reaccion', async () => {
    await tool('encuadre');
    await page.click('#efloat [data-e=layout][data-k=duo]');
    await page.click('#epanel [data-e=cammode][data-k=auto]');
    await page.waitForFunction(() => !/Buscando las cámaras|Mirando quién habla/.test(document.querySelector('#epanel')!.textContent!), null, { timeout: 120_000 });
    await page.evaluate(() => { (document.querySelector('#pv') as HTMLVideoElement).currentTime = 8; });
    await page.waitForTimeout(400);
    await tool('zoom');
    expect(await timeToChange('#epanel [data-e=addzoom]'), 'zoom en el cursor').toBeLessThan(MAX.efecto);
    await tool('texto');
    await page.click('#epanel [data-e=addtext]');
    await expect(page.locator('#ov .ov-item'), 'texto sobre la vista previa').toHaveCount(1);
    await tool('zoom');
    await page.evaluate(() => { (document.querySelector('#pv') as HTMLVideoElement).currentTime = 14; });
    await page.waitForTimeout(400);
    expect(await timeToChange('#epanel [data-e=punch]'), 'golpe de reaccion').toBeLessThan(MAX.efecto);
    await expect(page.locator('[data-lane=punch] .blk'), 'carril del golpe').toHaveCount(1);
  });

  test('reproducir es fluido en todos los encuadres (60 fps, sin perder fotogramas)', async () => {
    await tool('encuadre');
    for (const k of ['fit', 'split', 'duo', 'float', 'crop', 'grid']) {
      await page.click(`#efloat [data-e=layout][data-k=${k}]`);
      await page.waitForTimeout(300);
      const r = await page.evaluate(async () => {
        const v = document.querySelector('#pv') as HTMLVideoElement, q0 = v.getVideoPlaybackQuality();
        const gaps: number[] = []; let last = performance.now(), run = true;
        const tick = () => { const n = performance.now(); gaps.push(n - last); last = n; if (run) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        await v.play(); await new Promise((r) => setTimeout(r, 3000)); run = false; v.pause();
        const q1 = v.getVideoPlaybackQuality(); gaps.sort((a, b) => a - b);
        return { p50: Math.round(gaps[Math.floor(gaps.length * 0.5)]), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), max: Math.round(gaps[gaps.length - 1]), dropped: q1.droppedVideoFrames - q0.droppedVideoFrames, total: q1.totalVideoFrames - q0.totalVideoFrames };
      });
      console.log(`    ${k}: fotograma p50 ${r.p50} ms, p95 ${r.p95} ms, max ${r.max} ms, perdidos ${r.dropped}/${r.total}`);
      expect(r.p95, `encuadre ${k}: un fotograma de cada 20 no puede pasar de 2 refrescos`).toBeLessThan(34);
      expect(r.dropped, `encuadre ${k}: fotogramas perdidos`).toBeLessThanOrEqual(Math.ceil(r.total * 0.05));
    }
    await page.click('#efloat [data-e=layout][data-k=duo]');
  });

  test('organizacion: sin la barra de secciones, inspector a la vista y sugerencias en un menu', async () => {
    await expect(page.locator('#side'), 'en el editor no se ve la barra de secciones').toBeHidden();
    await expect(page.locator('#elib'), 'biblioteca a la izquierda').toBeVisible();
    await expect(page.locator('#epanel'), 'inspector a la derecha').toBeVisible();
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    expect((await box('#elib')).x, 'biblioteca | visor | inspector').toBeLessThan((await box('#phone')).x);
    expect((await box('#epanel')).x).toBeGreaterThan((await box('#phone')).x);
    await page.click('[data-e=mode][data-k=rapido]');
    await expect(page.locator('#elib'), 'Rápido: sin biblioteca').toBeHidden();
    await page.click('[data-e=mode][data-k=completo]');
    await expect(page.locator('#elib')).toBeVisible();
    // La biblioteca: un estilo de subtítulos se ve al pasar el ratón y se usa al tocarlo; el inspector abre «Subtítulos».
    await page.click('#elib [data-e=lib][data-k=textos]');
    const st = page.locator('#elib [data-e=capstyle]');
    expect(await st.count(), 'estilos de subtítulos en tarjetas').toBeGreaterThan(3);
    const sigA = await sign();
    await st.nth(1).hover();
    await expect.poll(sign, { message: 'al pasar el ratón se ve en el vídeo' }).not.toBe(sigA);
    await st.nth(1).click();
    await expect(st.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#epanel h2')).toHaveText('Subtítulos');
    await page.click('#etabs [data-k=clip]');
    await expect(page.locator('#epanel h2')).toHaveText('Clip');
    // El encuadre se elige en la tira de encima de la vista previa; el panel solo dice cual es.
    await tool('encuadre');
    await expect(page.locator('#epanel [data-e=layout]')).toHaveCount(0);
    await expect(page.locator('#epanel .layinfo')).toContainText((await page.getAttribute('#efloat [data-e=layout].on', 'title')) || '');
    // Sugerencias: un menu que se abre, se recorre y se cierra con Esc o al hacer clic fuera.
    await page.click('[data-e=sugmenu]');
    // Quitar silencios, zoom en la reaccion y repeticion a camara lenta, mas condensar a las duraciones que caben (como mucho tres).
    await expect(page.locator('#sugMenu [role=menuitem]:not([data-e=condense])')).toHaveCount(3);
    expect(await page.locator('#sugMenu [data-e=condense]').count()).toBeLessThanOrEqual(3);
    await expect(page.locator('[data-e=sugmenu]')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#sugMenu')).toBeHidden();
    await page.click('[data-e=sugmenu]');
    await page.locator('#appbar .brand').click(); // zona neutra: un punto fijo caeria en la tira de encuadres
    await expect(page.locator('#sugMenu'), 'se cierra al hacer clic fuera').toBeHidden();
    await page.screenshot({ path: 'test-results/organizacion-editor.png' });
  });

  test('herramientas por grupos, atajos, seleccion, duplicar, deshacer y rehacer', async () => {
    const tool = () => page.$eval('#epanel', (e) => (e as HTMLElement).dataset.tool);
    // «Clip» en el inspector: todas las herramientas por grupos, cada una con lo que ya tiene (1 texto, zoom + golpe = 2)
    if (await page.locator('#etabs [data-k=clip]').count()) await page.click('#etabs [data-k=clip]');
    await expect(page.locator('#epanel h3')).toHaveText(['Clip', 'Contenido', 'Efectos', 'Final']);
    await expect(page.locator('#epanel [data-k=texto] .tbadge')).toHaveText('1');
    await expect(page.locator('#epanel [data-k=zoom] .tbadge')).toHaveText('2');
    // Las teclas 1-0 abren las herramientas en orden
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    for (const [k, want] of [['1', 'recorte'], ['3', 'subs'], ['7', 'zoom'], ['0', 'publicar']]) { await page.keyboard.press(k); expect(await tool(), 'tecla ' + k).toBe(want); }
    // Tocar un bloque de la linea de tiempo abre su herramienta y muestra Duplicar/Borrar
    await page.click('[data-lane=txt] .blk');
    expect(await tool(), 'el bloque de texto abre «Texto»').toBe('texto');
    await expect(page.locator('#tlSel')).toContainText('Texto');
    const textos = page.locator('[data-lane=txt] .blk');
    const t0 = Date.now();
    await page.keyboard.press('Control+d');
    await expect(textos, 'Ctrl+D duplica').toHaveCount(2);
    expect(Date.now() - t0, 'duplicar').toBeLessThan(MAX.efecto * 3);
    await page.keyboard.press('Control+z');
    await expect(textos, 'Ctrl+Z deshace').toHaveCount(1);
    await page.keyboard.press('Control+Shift+z');
    await expect(textos, 'Ctrl+Mayús+Z rehace').toHaveCount(2);
    await page.click('[data-e=undo]');
    await expect(textos).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#tlSel')).toContainText('Toca un bloque');
    // Mayus+flecha avanza 5 s
    const clock = () => page.evaluate(() => document.getElementById('clock')!.textContent!.split('/')[0].trim().split(':').reduce((s, v) => s * 60 + +v, 0));
    await page.keyboard.press('Home'); await expect.poll(clock).toBe(0);
    await page.keyboard.press('Shift+ArrowRight'); await expect.poll(clock).toBe(5);
  });

  test('linea de tiempo: zoom, arrastrar el cursor, fotograma a fotograma, recortar tramos e iman', async () => {
    const width = () => page.$eval('#tracks', (e) => e.getBoundingClientRect().width), view = () => page.$eval('#tlScroll', (e) => e.clientWidth);
    const vt = () => page.$eval('#pv', (v: HTMLVideoElement) => v.currentTime);
    // La pista de vídeo muestra fotogramas reales de cada tramo (tira de película), que cargan bien.
    const films = page.locator('[data-lane=video] .blk.v img.film');
    expect(await films.count(), 'unos cuantos fotogramas a lo ancho').toBeGreaterThan(5);
    expect(await page.locator('[data-lane=video] .blk.v:not(:has(img.film))').count(), 'cada tramo con los suyos').toBe(0);
    await expect.poll(() => page.$$eval('[data-lane=video] img.film', (im) => im.every((i) => (i as HTMLImageElement).naturalWidth > 0)), { timeout: 20000 }).toBe(true);
    // Zoom con los botones, con Ctrl + rueda, y «Ajustar» vuelve al clip entero.
    await page.click('[data-e=tlzoom][data-k="1.25"]'); await page.click('[data-e=tlzoom][data-k="1.25"]');
    await expect(page.locator('#tlZoomV')).toHaveText('×1.6');
    expect(await width()).toBeGreaterThan((await view()) * 1.4);
    const lane = await page.locator('[data-lane=video]').boundingBox();
    await page.mouse.move(lane!.x + lane!.width * 0.3, lane!.y + 5);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
    await expect(page.locator('#tlZoomV')).toHaveText('×2');
    await page.click('[data-e=tlfit]');
    await expect(page.locator('#tlZoomV')).toHaveText('×1');
    expect(Math.abs((await width()) - (await view()))).toBeLessThan(4);
    // Arrastrar sobre la regla mueve el cursor y la vista previa sigue al puntero.
    const ruler = (await page.locator('[data-lane=ruler]').boundingBox())!;
    await page.mouse.move(ruler.x + ruler.width * 0.2, ruler.y + 5); await page.mouse.down();
    const t0 = await vt();
    await page.mouse.move(ruler.x + ruler.width * 0.4, ruler.y + 5, { steps: 6 });
    await expect.poll(vt, { message: 'el cursor sigue al arrastre' }).toBeGreaterThan(t0 + 1);
    await page.mouse.up();
    // , y . avanzan y retroceden un fotograma (1/30 s).
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const f0 = await vt(); await page.keyboard.press('.'); 
    await expect.poll(async () => Math.round(((await vt()) - f0) * 30)).toBe(1);
    // Recortar el final del tramo arrastrando su borde. La linea de tiempo es magnetica: el clip se acorta sin dejar hueco;
    // con «Ver lo quitado» se ve el hueco. Ctrl+Z lo deshace.
    const total = () => page.evaluate(() => document.getElementById('clock')!.textContent!.split('/')[1].trim());
    await page.click('[data-e=tlgaps]');
    const gaps = await page.locator('[data-lane=video] .gap').count();
    await page.click('[data-e=tlgaps]');
    const tot0 = await total();
    const seg = (await page.locator('[data-lane=video] .blk[data-kind=seg]').last().boundingBox())!;
    await page.mouse.move(seg.x + seg.width - 3, seg.y + seg.height / 2); await page.mouse.down();
    await page.mouse.move(seg.x + seg.width - 80, seg.y + seg.height / 2, { steps: 5 }); await page.mouse.up();
    await expect.poll(total, { message: 'el clip se acorta' }).not.toBe(tot0);
    await expect(page.locator('[data-lane=video] .gap'), 'vista magnetica: sin huecos').toHaveCount(0);
    await page.click('[data-e=tlgaps]');
    await expect(page.locator('[data-lane=video] .gap'), 'con «Ver lo quitado» queda el hueco donde se recorto').toHaveCount(gaps + 1);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-lane=video] .gap')).toHaveCount(gaps);
    await page.click('[data-e=tlgaps]');
    // Iman: al arrastrar un bloque cerca del cursor aparece la guia, y al soltarlo uno de sus bordes queda justo en ella.
    if ((await page.getAttribute('[data-e=magnet]', 'aria-pressed')) !== 'true') await page.click('[data-e=magnet]');
    // El cursor en un sitio donde el bloque cabe entero (al final del clip no cabria y el iman no lo pega).
    const rl = (await page.locator('[data-lane=ruler]').boundingBox())!;
    await page.mouse.click(rl.x + rl.width * 0.3, rl.y + 5);
    const head = (await page.locator('#head').boundingBox())!.x + 1;
    const blk = page.locator('[data-lane=txt] .blk').first(), b = (await blk.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + (head + 5 - b.x), b.y + b.height / 2, { steps: 8 });
    await expect(page.locator('#snapline'), 'la guia del iman aparece').toBeVisible();
    const guide = (await page.locator('#snapline').boundingBox())!.x + 1;
    await page.mouse.up();
    await expect(page.locator('#snapline')).toBeHidden();
    const nb = (await blk.boundingBox())!;
    expect(Math.min(Math.abs(nb.x - guide), Math.abs(nb.x + nb.width - guide)), 'un borde del bloque queda en la guia').toBeLessThan(1.5);
    // Con Alt se mueve libre, sin pegarse.
    await page.keyboard.press('Control+z');
    const b2 = (await blk.boundingBox())!;
    await page.keyboard.down('Alt'); await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2 + (head + 5 - b2.x), b2.y + b2.height / 2, { steps: 8 });
    await expect(page.locator('#snapline')).toBeHidden();
    await page.mouse.up(); await page.keyboard.up('Alt');
    await page.keyboard.press('Control+z');
  });

  test('linea de tiempo como CapCut: pistas, marcadores, menu contextual, seleccion multiple y atajos', async () => {
    const blur = () => page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const texts = page.locator('[data-lane=txt] .blk');
    const nBefore = await texts.count();
    // Dos textos propios: uno al inicio y otro a los 5 s.
    await blur(); await page.keyboard.press('Home');
    await page.click('#elib [data-e=lib][data-k=textos]');
    await page.click('#elib [data-e=addtext]');
    await blur(); await page.keyboard.press('Shift+ArrowRight');
    await page.click('#elib [data-e=addtext]');
    await expect(texts).toHaveCount(nBefore + 2);
    const t1 = texts.nth(nBefore), t2 = texts.nth(nBefore + 1);

    // Ocultar la pista de texto: sale de la vista previa (y del video, ver tests/tracks.test.ts); se recupera al mostrarla.
    const ovTexts = page.locator('#ov [data-ov=texts]');
    await expect(ovTexts.first()).toBeVisible();
    await page.click('[data-e=track][data-k=txt][data-p=hide]');
    await expect(ovTexts).toHaveCount(0);
    await expect(page.locator('.track', { has: page.locator('[data-lane=txt]') })).toHaveClass(/\boff\b/);
    await page.click('[data-e=track][data-k=txt][data-p=hide]');
    await expect(ovTexts.first()).toBeVisible();
    // Silenciar la pista de video.
    await page.click('[data-e=track][data-k=video][data-p=mute]');
    await expect.poll(() => page.$eval('#pv', (v: HTMLVideoElement) => v.muted)).toBe(true);
    await page.click('[data-e=track][data-k=video][data-p=mute]');
    await expect.poll(() => page.$eval('#pv', (v: HTMLVideoElement) => v.muted)).toBe(false);
    // Bloquear: no se mueve ni se borra.
    await page.click('[data-e=track][data-k=txt][data-p=lock]');
    const left0 = await t1.evaluate((e) => (e as HTMLElement).style.left);
    const b1 = (await t1.boundingBox())!;
    await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2); await page.mouse.down(); await page.mouse.move(b1.x + b1.width / 2 + 120, b1.y + b1.height / 2, { steps: 4 }); await page.mouse.up();
    expect(await t1.evaluate((e) => (e as HTMLElement).style.left), 'bloqueado no se mueve').toBe(left0);
    await page.click('[data-e=track][data-k=txt][data-p=lock]');

    // Marcadores: M pone uno en el cursor; Ctrl+→ salta al siguiente; clic derecho: nombre, color y borrar.
    const mks = page.locator('.lane.ruler .mk:not(.peak)');
    await blur(); await page.keyboard.press('m');
    await expect(mks).toHaveCount(1);
    await page.keyboard.press('Home');
    const next = Math.min(...(await page.$$eval('.lane.ruler .mk', (l) => l.map((m) => +(m as HTMLElement).dataset.k!))).filter((t) => t > 0.05));
    await page.keyboard.press('Control+ArrowRight');
    await expect.poll(() => page.evaluate(() => document.getElementById('clock')!.textContent!.split('/')[0].trim())).toBe(`0:${String(Math.round(next)).padStart(2, '0')}`);
    await mks.first().click({ button: 'right' });
    await expect(page.locator('#ctx')).toContainText('Cambiar nombre');
    await page.locator('#ctx [role=menuitem]', { hasText: 'Azul' }).click();
    await expect(mks.first()).toHaveAttribute('style', /--c:#60A5FA/i);
    await mks.first().click({ button: 'right' });
    await page.locator('#ctx [role=menuitem]', { hasText: 'Borrar marcador' }).click();
    await expect(mks).toHaveCount(0);

    // Menu contextual de un texto y copiar/pegar atributos (el tamaño de uno al otro).
    await t1.click();
    await page.$eval('#epanel [data-i="text.size"]', (r: HTMLInputElement) => { r.value = '140'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await t1.click({ button: 'right' });
    await expect(page.locator('#ctx')).toContainText('Duplicar');
    await page.locator('#ctx [role=menuitem]', { hasText: 'Copiar atributos' }).click();
    await t2.click({ button: 'right' });
    await page.locator('#ctx [role=menuitem]', { hasText: 'Pegar atributos' }).click();
    await t2.click();
    await expect(page.locator('#epanel input[type=number][data-i="text.size"]')).toHaveValue('140');
    await page.keyboard.press('Escape');
    await expect(page.locator('#ctx')).toHaveCount(0);

    // Seleccion multiple: Mayus+clic y Supr borra los dos; Ctrl+Z los recupera.
    await t1.click(); await t2.click({ modifiers: ['Shift'] });
    await expect(page.locator('#tlSel')).toContainText('2 elementos');
    await page.keyboard.press('Delete');
    await expect(texts).toHaveCount(nBefore);
    await page.keyboard.press('Control+z');
    await expect(texts).toHaveCount(nBefore + 2);
    // Rectangulo sobre la pista de texto: selecciona lo que toca.
    await page.keyboard.press('Escape');
    const lane = (await page.locator('[data-lane=txt]').boundingBox())!;
    await page.mouse.move(lane.x + lane.width - 3, lane.y + lane.height / 2); await page.mouse.down();
    await page.mouse.move(lane.x + 3, lane.y + lane.height / 2, { steps: 6 }); await page.mouse.up();
    await expect(page.locator('#tlSel')).toContainText(/\d+ elementos/);

    // Ver al pasar el raton: el visor cambia, el cursor no se mueve.
    await page.keyboard.press('Escape'); await blur(); await page.keyboard.press('Home');
    await expect.poll(() => page.evaluate(() => document.getElementById('clock')!.textContent!.split('/')[0].trim())).toBe('0:00');
    await page.waitForTimeout(300);
    const head0 = await page.$eval('#head', (e) => (e as HTMLElement).style.left), v0 = await page.$eval('#pv', (v: HTMLVideoElement) => v.currentTime);
    const vl = (await page.locator('[data-lane=video]').boundingBox())!;
    await page.mouse.move(vl.x + vl.width * 0.7, vl.y + 4);
    await expect.poll(() => page.$eval('#pv', (v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(v0 + 1);
    expect(await page.$eval('#head', (e) => (e as HTMLElement).style.left), 'el cursor no se mueve').toBe(head0);
    await page.mouse.move(vl.x + vl.width * 0.5, vl.y - 200); // fuera de la linea de tiempo
    await expect.poll(() => page.$eval('#pv', (v: HTMLVideoElement) => v.currentTime), { message: 'al salir vuelve al cursor' }).toBeLessThan(v0 + 0.3);

    // J/K/L y Mayus+. (10 fotogramas).
    await blur();
    await page.keyboard.press('l');
    await expect.poll(() => page.$eval('#pv', (v: HTMLVideoElement) => v.paused)).toBe(false);
    await page.keyboard.press('k');
    await expect.poll(() => page.$eval('#pv', (v: HTMLVideoElement) => v.paused)).toBe(true);
    const c0 = await page.$eval('#pv', (v: HTMLVideoElement) => v.currentTime);
    await page.keyboard.press('Shift+Period');
    await expect.poll(async () => (await page.$eval('#pv', (v: HTMLVideoElement) => v.currentTime)) - c0).toBeGreaterThan(0.25);
    // J va hacia atras; K para.
    const c1 = await page.$eval('#pv', (v: HTMLVideoElement) => v.currentTime);
    await page.keyboard.press('j');
    await expect.poll(async () => c1 - (await page.$eval('#pv', (v: HTMLVideoElement) => v.currentTime)), { message: 'J retrocede' }).toBeGreaterThan(0.1);
    await page.keyboard.press('k');
    // Pistas mas altas.
    const h0 = (await page.locator('[data-lane=txt]').boundingBox())!.height;
    await page.click('[data-e=tall]');
    expect((await page.locator('[data-lane=txt]').boundingBox())!.height, 'pistas mas altas').toBeGreaterThan(h0 + 8);
    await page.click('[data-e=tall]');
    // Pantalla completa (en las pruebas se sustituye la llamada del navegador).
    await page.evaluate(() => { (Element.prototype as any).requestFullscreen = function () { (window as any).__fs = 1; return Promise.resolve(); }; });
    await page.click('[data-e=fullscreen]');
    expect(await page.evaluate(() => (window as any).__fs)).toBe(1);

    // Ctrl + arrastrar: duplica y mueve la copia.
    await page.keyboard.press('Escape');
    const bb = (await t2.boundingBox())!;
    await page.keyboard.down('Control');
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2, { steps: 6 }); await page.mouse.up();
    await page.keyboard.up('Control');
    await expect(texts, 'Ctrl+arrastrar duplica').toHaveCount(nBefore + 3);
    // Deja el clip como estaba: sin los textos de la prueba.
    await page.keyboard.press('Escape');
    await t1.click(); await t2.click({ modifiers: ['Shift'] }); await texts.nth(nBefore + 2).click({ modifiers: ['Shift'] }); await page.keyboard.press('Delete');
    await expect(texts).toHaveCount(nBefore);
    await page.screenshot({ path: 'test-results/linea-capcut.png' });
  });

  test('linea de tiempo magnetica: al quitar un tramo, lo de encima se mueve con el video y no quedan huecos', async () => {
    const blur = () => page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const secs = (x: string) => x.split(':').reduce((a, v) => a * 60 + +v, 0);
    const total = async () => secs(await page.evaluate(() => document.getElementById('clock')!.textContent!.split('/')[1].trim()));
    const texts = page.locator('[data-lane=txt] .blk'), nTexts = await texts.count();
    // Un corte en el segundo 10 y un texto en el 12.
    await blur(); await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
    await page.click('[data-e=split]');
    await blur(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await page.click('#elib [data-e=lib][data-k=textos]');
    await page.click('#elib [data-e=addtext]');
    await expect(texts).toHaveCount(nTexts + 1);
    const txt = texts.last(), dur = await total();
    const leftPct = () => txt.evaluate((e) => parseFloat((e as HTMLElement).style.left));
    expect(await leftPct()).toBeCloseTo((12 / dur) * 100, 0);
    // Quitar el primer tramo (0-10 s): el clip dura 10 s menos y el texto pasa al segundo 2, sin hueco delante.
    await page.locator('[data-lane=video] .blk[data-kind=seg][data-id="0"]').click({ position: { x: 30, y: 10 } });
    await page.click('[data-e=delseg]');
    await expect.poll(total, { message: 'el clip dura 10 s menos' }).toBe(dur - 10);
    await expect.poll(leftPct, { message: 'el texto se mueve con el video' }).toBeCloseTo((2 / (dur - 10)) * 100, 0);
    await expect(page.locator('[data-lane=video] .gap')).toHaveCount(0);
    expect(parseFloat(await page.locator('[data-lane=video] .blk[data-kind=seg]').first().evaluate((e) => (e as HTMLElement).style.left))).toBeCloseTo(0, 1);
    // «Ver lo quitado»: el tiempo original, con el hueco, y el texto en su segundo 12.
    await page.click('[data-e=tlgaps]');
    await expect(page.locator('[data-lane=video] .gap').first()).toBeVisible();
    expect(await leftPct()).toBeCloseTo((12 / dur) * 100, 0);
    await page.click('[data-e=tlgaps]');
    // Deja el clip como estaba.
    await blur();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    await expect(texts).toHaveCount(nTexts);
    await expect(page.locator('[data-lane=video] .blk[data-kind=seg]')).toHaveCount(1);
  });

  test('editar desde el texto: buscar, quitar palabras del video y recuperarlas', async () => {
    await tool('subs');
    const words = page.locator('#wordList [data-e=word]'), segsL = page.locator('[data-lane=video] .blk[data-kind=seg]');
    await expect(words.first()).toBeVisible({ timeout: 60_000 });
    const n = await words.count();
    expect(n, 'hay palabras para editar').toBeGreaterThan(10);
    // Una palabra de 4 letras o mas hacia la mitad (asi el corte deja video a los dos lados).
    let k = Math.floor(n / 2);
    for (; k < n - 4; k++) if (/^[\p{L}]{4,}/u.test((await words.nth(k).textContent()) || '')) break;
    const s0 = await segsL.count(), cut0 = await page.locator('#wordList .cut').count(); // puede haber algo ya fuera por pruebas anteriores
    // Buscar: marca donde aparece.
    const q = ((await words.nth(k).textContent()) || '').replace(/[^\p{L}\p{N}]/gu, '');
    await page.fill('#subQ', q);
    await expect(page.locator('#subQn')).toContainText('encontrad');
    await expect(page.locator('#wordList .found').first()).toBeVisible();
    // Elegir 4 palabras seguidas (Mayus + clic) y quitarlas del video: el tramo se parte y salen tachadas.
    await words.nth(k).click(); await words.nth(k + 3).click({ modifiers: ['Shift'] });
    await expect(page.locator('#epanel .item.sel')).toContainText('4 palabras');
    await page.locator('#epanel [data-e=wordcut]').click();
    await expect.poll(() => segsL.count(), { message: 'se corta el video' }).toBeGreaterThan(s0);
    await expect(words.nth(k)).toHaveClass(/\bcut\b/);
    await expect(words.nth(k + 3)).toHaveClass(/\bcut\b/);
    // Recuperarlas.
    await words.nth(k).click(); await words.nth(k + 3).click({ modifiers: ['Shift'] });
    await page.locator('#epanel [data-e=wordrestore]').click();
    await expect(segsL).toHaveCount(s0);
    await expect(words.nth(k)).not.toHaveClass(/\bcut\b/);
    // Supr con una palabra elegida la quita del video; Ctrl+Z la devuelve.
    await words.nth(k).click();
    await page.keyboard.press('Delete');
    await expect(words.nth(k)).toHaveClass(/\bcut\b/);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+z');
    await expect(words.nth(k)).not.toHaveClass(/\bcut\b/);
    // «Quitar … del vídeo» desde la busqueda quita todas las apariciones.
    await page.fill('#subQ', q);
    const found = await page.locator('#wordList .found').count();
    await page.locator('#subQn [data-e=subcutall]').click();
    await expect(page.locator('#wordList .found.cut')).toHaveCount(found);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+z');
    await expect(page.locator('#wordList .cut')).toHaveCount(cut0);
    await page.fill('#subQ', '');
    await expect(segsL).toHaveCount(s0);
  });

  test('tramos: congelar, velocidad, curva, espejo, girar y al reves', async () => {
    const blur = () => page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const total = async () => (await page.evaluate(() => document.getElementById('clock')!.textContent!.split('/')[1].trim())).split(':').reduce((a, v) => a * 60 + +v, 0);
    const near = (want: number) => async () => Math.abs((await total()) - want);
    const segsL = page.locator('[data-lane=video] .blk[data-kind=seg]'), n0 = await segsL.count();
    await tool('recorte');
    await blur(); await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
    const t0 = await total();
    // Congelar en el segundo 10: el clip dura 2 s mas y el tramo lo dice.
    await page.click('#epanel [data-e=freezehere]');
    await expect.poll(near(t0 + 2), { message: 'congelar suma 2 s' }).toBeLessThanOrEqual(1);
    await expect(segsL.first()).toContainText('congelado 2 s');
    // Velocidad ×2 en el primer tramo (0–10 s): 5 s menos.
    await segsL.first().click({ position: { x: 40, y: 10 } });
    await expect(page.locator('#epanel')).toContainText('Tramo 1');
    await page.click('#epanel [data-e=segspeed][data-k="2"]');
    await expect.poll(near(t0 + 2 - 5), { message: 'a doble velocidad dura la mitad' }).toBeLessThanOrEqual(1);
    await expect(segsL.first()).toContainText('×2');
    // Curva de velocidad.
    await page.click('#epanel [data-e=segcurve][data-k=rampa]');
    await expect(segsL.first()).toContainText('Rampa lenta');
    // Espejo y giro: la vista previa los enseña en ese tramo.
    await page.click('#epanel [data-e=segflip][data-k=h]');
    await page.click('#epanel [data-e=segrot][data-k="90"]');
    await blur(); await page.keyboard.press('Home');
    await expect.poll(() => page.$eval('#cv', (c) => (c as HTMLElement).style.transform)).toContain('scaleX(-1)');
    await expect.poll(() => page.$eval('#cv', (c) => (c as HTMLElement).style.transform)).toContain('rotate(90deg)');
    // Al reves desde el menu del tramo: se avisa de que se ve al exportar.
    await segsL.first().click({ button: 'right', position: { x: 40, y: 10 } });
    await page.locator('#ctx [role=menuitem]', { hasText: /^Al revés/ }).click();
    await expect(page.locator('#pvExport')).toContainText('al revés');
    await expect(segsL.first()).toContainText('al revés');
    // Deshacer todo lo de la prueba.
    await blur();
    for (let i = 0; i < 6; i++) await page.keyboard.press('Control+z');
    await expect.poll(near(t0)).toBeLessThanOrEqual(0);
    await expect(segsL).toHaveCount(n0);
    await expect.poll(() => page.$eval('#cv', (c) => (c as HTMLElement).style.transform)).toBe('');
  });

  test('pista «Encuadre»: otro encuadre un momento desde el cursor, elegirlo, cambiarlo y quitarlo', async () => {
    const blocks = page.locator('[data-lane=scene] .blk[data-kind=scenes]');
    await expect(page.locator('[data-lane=scene]')).toBeVisible();
    await expect(blocks).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Escape');
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+ArrowRight');
    await page.click('#efloat [data-e=sceneadd]');
    await expect(blocks).toHaveCount(1);
    await expect(page.locator('[data-lane=scene] .cmain').first(), 'lo de siempre, a los lados').toBeVisible();
    await expect(page.locator('#efloat')).toContainText('Encuadre de esta parte');
    await page.click('#efloat [data-e=layout][data-k=fit]');
    await expect(blocks.first()).toContainText('Completo');
    await page.click('#efloat [data-e=scenedel]');
    await expect(blocks).toHaveCount(0);
  });

  test('pista «Cámara»: clic en una cara de la cuadrícula → solo esa persona desde el cursor, con su cara en la pista', async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Escape');
    await tool('encuadre');
    const lay0 = await page.getAttribute('#efloat .seg [data-e=layout][aria-pressed=true]', 'data-k');
    await page.click('#efloat [data-e=layout][data-k=grid]');
    await page.waitForFunction(() => !/Buscando las cámaras/.test(document.querySelector('#epanel')!.textContent!), null, { timeout: 60_000 });
    // Con un directo real que cambia de escena (CLIPPER_WAIT_SCENES=1): esperar a que Clipper lo marque y capturarlo.
    if (process.env.CLIPPER_WAIT_SCENES) { await page.locator('[data-lane=scene] .scut').first().waitFor({ timeout: 120_000 }); await page.screenshot({ path: 'test-results/pista-escenas.png' }); }
    if (await page.locator('#epanel [data-e=cammode][data-k=fixed]').count()) await page.click('#epanel [data-e=cammode][data-k=fixed]');
    const n = await page.locator('#epanel [data-e=maincam]').count();
    if (n < 2) await page.click(`#efloat [data-e=layout][data-k=${lay0}]`);
    test.skip(n < 2, 'este video de prueba no tiene varias camaras');
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+ArrowRight');
    const cv = (await page.locator('#cv').boundingBox())!, g = gridBoxes(Math.min(12, n)), [x, y] = g.xy[1];
    await page.mouse.click(cv.x + ((x + g.cw / 2) / 1080) * cv.width, cv.y + ((y + g.ch / 2) / 1920) * cv.height);
    const blocks = page.locator('[data-lane=scene] .blk[data-kind=scenes]'), b0 = await blocks.count();
    await page.click('#selbar [data-e=solocam]');
    await expect(blocks).toHaveCount(b0 + 1);
    await expect(page.locator('[data-lane=scene] .blk.sc.sel .fthumb'), 'la cara de quien se ve').toHaveCount(1);
    await expect(page.locator('[data-lane=scene] .cmain').first()).toContainText('Todas');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'test-results/pista-camara.png' });
    await page.click('#efloat [data-e=scenedel]');
    await expect(blocks).toHaveCount(b0);
    await page.click(`#efloat [data-e=layout][data-k=${lay0}]`); // como estaba
  });

  test('«Dibujar zonas» desde la pantalla completa: sale de ella y el selector se queda abierto', async () => {
    await page.click('[data-e=fullscreen]');
    await page.waitForTimeout(500);
    test.skip(!(await page.evaluate(() => !!document.fullscreenElement)), 'este navegador de pruebas no deja poner la pantalla completa');
    await page.click('#efloat [data-e=openpick]');
    await expect(page.locator('#zmodal')).toBeVisible();
    expect(await page.evaluate(() => !!document.fullscreenElement), 'ya no está en pantalla completa').toBe(false);
    await page.waitForTimeout(800);
    await expect(page.locator('#zmodal'), 'no se cierra solo').toBeVisible();
    await page.click('#zmodal [data-e=zdone]');
    await expect(page.locator('#zmodal')).toHaveCount(0);
  });

  test('separador: arrastrarlo agranda la vista previa, y doble clic la deja como estaba', async () => {
    const ph = async () => (await page.locator('#phone').boundingBox())!.height;
    const h0 = await ph(), sp = (await page.locator('#esplit').boundingBox())!;
    await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2); await page.mouse.down();
    await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2 + 150, { steps: 6 }); await page.mouse.up();
    await expect.poll(ph, { message: 'la vista previa crece' }).toBeGreaterThan(h0 + 80);
    await page.screenshot({ path: 'test-results/separador.png' });
    await page.dblclick('#esplit');
    await expect.poll(ph).toBeLessThan(h0 + 5);
  });

  test('marco del canal: franjas arriba y abajo en la vista previa, y se quita', async () => {
    await tool('encuadre');
    const top = () => page.$eval('#cv', (c) => { const d = (c as HTMLCanvasElement).getContext('2d')!.getImageData(5, 5, 1, 1).data; return [d[0], d[1], d[2]]; });
    await page.locator('#epanel [data-i="brand.on"]').check();
    await expect(page.locator('#epanel [data-i="brand.text"]')).toBeVisible();
    await page.fill('#epanel [data-i="brand.text"]', '@prueba');
    await page.locator('#epanel [data-i="brand.text"]').press('Tab');
    await expect.poll(async () => (await top()).every((v, i) => Math.abs(v - [0x0b, 0x1a, 0x22][i]) < 14), { message: 'la franja de arriba es la del marco' }).toBe(true);
    await page.screenshot({ path: 'test-results/marco.png' });
    await page.locator('#epanel [data-i="brand.on"]').uncheck();
    await expect(page.locator('#epanel [data-i="brand.text"]')).toHaveCount(0);
  });

  test('dialogo con tres opciones (programar, subir ya, cancelar): cada boton devuelve lo suyo', async () => {
    const run = (btn: string) => page.evaluate(async (btn) => {
      const { ask } = await import('/web/app.js');
      const p = ask('¿Cuándo lo publico en TikTok?', { text: 'x', ok: 'Programar a las 20:35', alt: 'Subir ya' });
      await new Promise((r) => setTimeout(r, 50));
      const sc = [...document.querySelectorAll('.scrim')].pop()!; // el ultimo abierto (el nuestro)
      (sc.querySelector(`[data-x=${btn}]`) as HTMLElement).click();
      return Promise.race([p, new Promise((r) => setTimeout(() => r('sin respuesta'), 3000))]);
    }, btn);
    expect(await run('yes')).toBe(true);
    expect(await run('alt')).toBe('alt');
    expect(await run('no')).toBe(false);
    await expect(page.locator('.scrim')).toHaveCount(0, { timeout: 2000 });
  });

  test('encuadre por tramo: un tramo con otro encuadre y volver al del resto', async () => {
    const segsL = page.locator('[data-lane=video] .blk[data-kind=seg]'), n0 = await segsL.count();
    await tool('recorte');
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('s');
    await expect(segsL).toHaveCount(n0 + 1);
    await segsL.first().click({ position: { x: 40, y: 10 } });
    await expect(page.locator('#efloat')).toContainText('Encuadre del tramo');
    const other = await page.evaluate(() => (window as any).E?.spec?.layout === 'cam' ? 'fit' : 'cam');
    await page.click(`#efloat [data-e=layout][data-k=${other}]`);
    const sc = page.locator('[data-lane=scene] .blk[data-kind=scenes]');
    await expect(sc, 'el tramo tiene su parte en la pista «Cámara»').toHaveCount(1);
    // Sin tramo elegido, el encuadre vale para todo el clip y quita el del tramo (si no, no se veria el cambio).
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Escape');
    await expect(page.locator('#efloat')).toContainText('1 parte con otro');
    await page.click('#efloat .seg [data-e=layout]:not(.on)');
    await expect(sc).toHaveCount(0);
    await expect(page.locator('#efloat')).not.toContainText('parte con otro');
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+z');
    await segsL.first().click({ position: { x: 40, y: 10 } });
    await page.click('#efloat [data-e=sceneoff]');
    await expect(sc).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    await expect(segsL).toHaveCount(n0);
  });

  test('subtitulos: se apartan de las caras en la vista previa y respetan la zona segura', async () => {
    const layout = await page.getAttribute('#efloat [data-e=layout].on', 'data-k').catch(() => null);
    await tool('encuadre');
    await page.click('#efloat [data-e=layout][data-k=split]');
    // Tocar un bloque de subtitulos lleva el cursor a esa frase y abre «Subtítulos».
    await page.click('[data-lane=subs] .blk >> nth=0');
    await expect(page.locator('#epanel h2')).toHaveText('Subtítulos');
    const setRange = (sel: string, v: number) => page.$eval(sel, (el, v) => { (el as HTMLInputElement).value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    const pos0 = +(await page.getAttribute('#epanel [data-i="cap.posY"]', 'value'))!;
    const capTop = () => page.$eval('#cap', (e) => parseFloat((e as HTMLElement).style.top));
    await expect(page.locator('#cap span')).not.toHaveCount(0);
    // La altura que eliges manda, aunque caiga sobre la camara de arriba: «Apartar de las caras» se desactiva solo.
    await setRange('#epanel [data-i="cap.posY"]', 15);
    await expect.poll(capTop, { message: 'se queda a la altura pedida' }).toBeCloseTo(15, 0);
    await expect(page.locator('#epanel [data-i="cap.smart"]')).not.toBeChecked();
    // Arrastrarlos en la vista previa tambien los mueve.
    const cap = (await page.locator('#cap').boundingBox())!, ph = (await page.locator('#cv').boundingBox())!;
    await page.mouse.move(cap.x + cap.width / 2, cap.y + cap.height / 2); await page.mouse.down();
    await page.mouse.move(cap.x + cap.width / 2, cap.y + cap.height / 2 + ph.height * 0.3, { steps: 8 }); await page.mouse.up();
    await expect.poll(capTop, { message: 'arrastrar los baja' }).toBeGreaterThan(35);
    // Con «Apartar de las caras» otra vez, a 15 se apartan de la camara hacia el juego.
    await setRange('#epanel [data-i="cap.posY"]', 15);
    await page.locator('#epanel [data-i="cap.smart"]').check();
    await expect.poll(capTop, { message: 'se aparta de la camara' }).toBeGreaterThan(30);
    await expect(page.locator('#epanel [data-i="cap.safe"] option')).toHaveCount(5);
    await page.locator('#epanel').screenshot({ path: 'test-results/subtitulos-panel.png' });
    await page.screenshot({ path: 'test-results/subtitulos-editor.png' });
    // Se deja todo como estaba para las pruebas siguientes.
    await setRange('#epanel [data-i="cap.posY"]', pos0);
    await page.locator('#epanel [data-i="cap.smart"]').check();
    await tool('encuadre');
    await page.click(`#efloat [data-e=layout][data-k=${layout || 'duo'}]`);
  });

  test('auto edicion de un clic, y Ctrl+Z la deshace entera', async () => {
    if (await page.locator('#etabs [data-k=clip]').count()) await page.click('#etabs [data-k=clip]'); // el resumen esta en «Clip»
    // El resumen «de antes», cuando ya no cambia (la deteccion de quien habla puede terminar justo ahora).
    const sum = () => page.evaluate(() => document.querySelector('#epanel .cbox')?.textContent);
    let before = await sum();
    for (let k = 0; k < 20; k++) { await page.waitForTimeout(300); const now = await sum(); if (now === before) break; before = now; }
    await page.click('[data-e=autoedit]');
    // Mientras trabaja dice por donde va: porcentaje y paso.
    await expect(page.locator('#toasts .work'), 'avance de la auto edición').toContainText(/Editando el clip solo… \d+ % · \w/, { timeout: 30_000 });
    await expect(page.locator('#toasts').getByText(/Auto edición/), 'aviso con lo que hizo').toBeVisible({ timeout: 120_000 });
    await expect(page.locator('#tracks .blk.c').first(), 'subtitulos activos en la linea de tiempo').toBeVisible();
    // El director dice que tono leyo y reparte varios efectos (no uno solo).
    const said = await page.locator('#epanel .rvdone').textContent();
    console.log('    ' + said);
    expect(said).toMatch(/tono de (risa|subidón|sorpresa|charla)/);
    const fx = await page.locator('[data-lane=zoom] .blk, [data-lane=punch] .blk, [data-lane=sfx] .blk').count();
    console.log(`    efectos en la linea de tiempo: ${fx}`);
    expect(fx, 'varios efectos repartidos').toBeGreaterThanOrEqual(2);
    // Revision: cada propuesta con su casilla; al desmarcar una se quita al momento de la linea de tiempo.
    await expect(page.locator('#epanel h2')).toHaveText('Revisar la auto edición');
    // Dice de donde sale el estilo (aqui no hay referencias: el de por defecto, con la pista para añadirlas).
    await expect(page.locator('#epanel .rvstyle')).toContainText(/Estilo (aprendido|por defecto)/);
    // Los silencios no trocean el clip: solo pausas largas, como mucho 3 cortes por minuto y nunca junto al momento
    // fuerte. Si no quita ninguna, dice por que.
    const rowSil = page.locator('#epanel .rvrow', { hasText: 'Quitar silencios' });
    const cutsRow = (await rowSil.count()) ? await rowSil.first().textContent() : '';
    if (!cutsRow) expect(said, 'explica por que no quita pausas').toMatch(/sin pausas largas que quitar|pausas respetadas: /);
    else expect(cutsRow).toMatch(/Quitar silencios \(\d+ cortes?\)/);
    const nCuts = +(/\((\d+) cortes?\)/.exec(cutsRow || '')?.[1] || 0);
    console.log('    cortes por silencios: ' + nCuts);
    expect(nCuts, 'cortes por silencios').toBeLessThanOrEqual(4);
    // Las muletillas y repeticiones, si las hay, van en su propia fila (se aceptan o quitan aparte de los silencios).
    const said2 = await page.locator('#epanel .rvdone').textContent();
    const fillRow = page.locator('#epanel .rvrow', { hasText: /Quitar \d+ (muletilla|repetici)/ });
    expect(await fillRow.count(), 'fila de muletillas solo si las hay').toBe(/muletilla|repetici/.test(said2 || '') ? 1 : 0);
    // Final cuidado: desvanecido corto, con su propia fila.
    await expect(page.locator('#epanel .rvrow', { hasText: 'Desvanecido al final (0,5 s)' })).toHaveCount(1);
    // Tres propuestas: al cambiar a la dinamica hay mas efectos en la linea de tiempo, y se puede volver.
    const vars = page.locator('#epanel [data-e=rvvar]');
    await expect(vars).toHaveCount(3);
    await expect(vars).toHaveText([/Equilibrada/, /Dinámica/, /Sobria/]);
    const fxNow = () => page.locator('[data-lane=zoom] .blk, [data-lane=punch] .blk, [data-lane=sfx] .blk').count();
    const fx0 = await fxNow();
    await vars.nth(1).click();
    await expect(vars.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(fxNow, { message: 'la dinamica pone mas efectos' }).toBeGreaterThan(fx0);
    await vars.nth(2).click();
    await expect.poll(fxNow, { message: 'la sobria pone menos' }).toBeLessThanOrEqual(fx0);
    await vars.nth(0).click();
    await expect.poll(fxNow).toBe(fx0);
    const rows = page.locator('#epanel [data-rv]');
    expect(await rows.count(), 'una casilla por propuesta').toBeGreaterThanOrEqual(fx);
    // La primera propuesta de efecto que haya: con «Cámara + juego» no se proponen zooms (cortar por historias cambia
    // el tramo del momento, y con el el encuadre que elige la auto edicion).
    let fxRow = page.locator('#epanel .rvrow').first(), lane = '';
    for (const [txt, l] of [['Zoom ×', 'zoom'], ['Golpe de reacción', 'punch'], ['Sonido:', 'sfx']]) {
      const r = page.locator('#epanel .rvrow', { hasText: txt }).first();
      if (await r.count()) { fxRow = r; lane = l; break; }
    }
    expect(lane, 'alguna propuesta de efecto (zoom, golpe o sonido)').not.toBe('');
    const blocks = () => page.locator(`[data-lane=${lane}] .blk`).count(), b0 = await blocks();
    await fxRow.locator('input').uncheck();
    await expect.poll(blocks, { message: 'el efecto desmarcado desaparece' }).toBe(b0 - 1);
    // Saltar a una propuesta lleva el cursor a su momento.
    await fxRow.locator('[data-e=rvgo]').click();
    await fxRow.locator('input').check();
    await expect.poll(blocks).toBe(b0);
    await page.screenshot({ path: 'test-results/revision-panel.png' });
    // «Descartar» lo deja todo como estaba; repetir y «Aplicar» lo confirma, y Ctrl+Z lo deshace de una vez.
    await page.click('#epanel [data-e=rvno]');
    await expect.poll(() => page.evaluate(() => document.querySelector('#epanel .cbox')?.textContent), { message: 'Descartar deja el clip como estaba' }).toBe(before);
    await page.click('[data-e=autoedit]');
    await expect(page.locator('#epanel h2')).toHaveText('Revisar la auto edición', { timeout: 120_000 });
    await page.click('#epanel [data-e=rvok]');
    await expect(page.locator('#epanel h2').first()).not.toHaveText('Revisar la auto edición');
    await playPause(page, 'tras la auto edicion');
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => document.querySelector('#epanel .cbox')?.textContent), { message: 'Ctrl+Z deja el clip como estaba' }).toBe(before);
  });

  test('aprende de la revision: lo que se quita 3 veces deja de proponerse, y se puede olvidar', async () => {
    if (await page.locator('#etabs [data-k=clip]').count()) await page.click('#etabs [data-k=clip]'); // el resumen esta en «Clip»
    const esum = () => page.evaluate(() => document.querySelector('#epanel .cbox')?.textContent);
    const before = await esum();
    const sounds = page.locator('#epanel .rvrow', { hasText: 'Sonido:' });
    const review = async () => { await page.click('[data-e=autoedit]'); await expect(page.locator('#epanel h2')).toHaveText('Revisar la auto edición', { timeout: 120_000 }); };
    for (let k = 0; k < 3; k++) {
      await review();
      if (k === 0) expect(await sounds.count(), 'la auto edicion propone sonidos').toBeGreaterThan(0);
      for (const box of await sounds.locator('input').all()) await box.uncheck();
      await page.click('#epanel [data-e=rvok]');
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await page.keyboard.press('Control+z');
      await expect.poll(esum).toBe(before);
    }
    await review();
    await expect(sounds, 'ya no propone los sonidos que siempre quita').toHaveCount(0);
    await expect(page.locator('#epanel .rvstyle', { hasText: 'Aprendido de tus revisiones' })).toContainText('sueles quitarlo');
    await page.click('#epanel [data-e=rvforget]');
    await expect(page.locator('#epanel .rvstyle', { hasText: 'Aprendido de tus revisiones' })).toHaveCount(0);
    await page.click('#epanel [data-e=rvno]');
    await expect.poll(esum).toBe(before);
    await review();
    expect(await sounds.count(), 'tras olvidar vuelve a proponerlos').toBeGreaterThan(0);
    await page.click('#epanel [data-e=rvno]');
  });

  // Fallo real: la auto edicion pisaba lo editado a mano, y borrar algo durante la revision volvia a salir al tocar una casilla.
  test('auto edicion respeta lo que cambiaste a mano, y lo que editas durante la revision no se pierde', async () => {
    await tool('texto');
    await page.fill('#epanel [data-i=title]', 'Mi título a mano');
    await page.locator('#epanel [data-i=title]').blur();
    const fx = page.locator('[data-lane=zoom] .blk, [data-lane=punch] .blk, [data-lane=sfx] .blk'), nPrev = await fx.count();
    await page.click('[data-e=autoedit]');
    await expect(page.locator('#epanel h2')).toHaveText('Revisar la auto edición', { timeout: 120_000 });
    await expect(page.locator('#epanel .rvrow', { hasText: 'Título:' }), 'no propone otro título encima del tuyo').toHaveCount(0);
    await expect(page.locator('#epanel .rvdone')).toContainText('respeté lo que ya habías cambiado a mano');
    // Borrar un efecto a mano durante la revision: la revision se da por aplicada y el efecto no vuelve.
    const n0 = await fx.count();
    expect(n0, 'la auto edicion puso efectos').toBeGreaterThan(nPrev);
    await fx.first().click();
    await page.keyboard.press('Delete');
    await expect.poll(() => fx.count(), { message: 'el efecto borrado a mano se va' }).toBe(n0 - 1);
    await expect(page.locator('#epanel h2').first()).not.toHaveText('Revisar la auto edición');
    await page.waitForTimeout(500);
    expect(await fx.count(), 'y no vuelve').toBe(n0 - 1);
    // Ctrl+Z deshace primero tu borrado y despues la auto edicion entera.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+z');
    await expect.poll(() => fx.count()).toBe(n0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => fx.count()).toBe(nPrev);
  });

  test('transiciones: categorias, miniaturas que se mueven, elegir y marcar en la linea de tiempo', async () => {
    await tool('trans');
    const tabs = page.locator('#elib .tcats [role=tab]');
    await expect(tabs.first()).toHaveText('Populares');
    expect(await tabs.count(), 'una pestaña por familia').toBeGreaterThanOrEqual(9);
    // La miniatura se genera en el servidor la primera vez y se ve como imagen.
    const thumb = page.locator('#elib [data-e=settrans][data-k=smoke] img');
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 60_000 }).toBeGreaterThan(0);
    // Al pasar el raton se reproduce.
    await page.hover('#elib [data-e=settrans][data-k=flash]');
    await expect(page.locator('#elib [data-e=settrans][data-k=flash] video')).toHaveCount(1);
    // Cada pestaña muestra su familia.
    await page.click('#elib .tcats [data-k="Cámara"]');
    await expect(page.locator('#elib [data-e=settrans][data-k=spin]')).toBeVisible();
    await page.click('#elib .tcats [data-k=Populares]');
    // Elegir una muestra sus ajustes; sin gancho ni cortes avisa de que no se vera.
    await page.click('#elib [data-e=settrans][data-k=smoke]');
    await expect(page.locator('#elib [data-e=settrans][data-k=smoke]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#epanel .tset')).toContainText('Humo blanco');
    await expect(page.locator('#epanel [data-i=transDur]')).toBeVisible();
    const cuts = page.locator('#epanel [data-i=transCuts]');
    if (await cuts.isEnabled()) await cuts.check(); else await page.locator('#epanel [data-i=hook]').check();
    await expect(page.locator('#epanel .twarn')).toHaveCount(0);
    await expect(page.locator('[data-lane=video] .tmark').first()).toBeVisible();
    // Se ve entera, con su nombre, y nada la tapa (ni el gancho al inicio ni el borde de la pista).
    await expect(page.locator('[data-lane=video] .tmark').first()).toContainText('Humo blanco');
    const seen = await page.$eval('[data-lane=video] .tmark', (m) => { const r = m.getBoundingClientRect(), l = m.closest('.lane')!.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.left >= l.left && r.right <= l.right && !!top && m.contains(top); });
    expect(seen, 'la transicion se ve en la linea de tiempo').toBe(true);
    // Capturas para revisar el diseño a ojo (test-results/).
    await page.$eval('#epanel', (e) => (e.scrollTop = 0));
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/transiciones-editor.png' });
    await page.locator('#epanel').screenshot({ path: 'test-results/transiciones-panel.png' });
  });

  test('transicion en un corte concreto: el «+» del corte la pone justo ahi', async () => {
    // Un corte en el segundo 10.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
    await page.click('[data-e=split]');
    const plus = page.locator('[data-lane=video] .tjoin');
    await expect(plus, 'un «+» en el corte').toHaveCount(1);
    const marks = page.locator('[data-lane=video] .tmark');
    const n0 = await marks.count();
    await plus.click();
    await expect(marks, 'la transicion aparece en ese corte').toHaveCount(n0 + 1);
    await expect(plus).toHaveCount(0);
    await expect(page.locator('#epanel [data-e=transjoin]', { hasText: '' }).first()).toBeChecked();
    await expect(page.locator('#epanel label', { hasText: 'Corte en 0:10' })).toBeVisible();
    // Se quita desmarcandolo en el inspector.
    await page.locator('#epanel label', { hasText: 'Corte en 0:10' }).locator('input').click();
    await expect(marks).toHaveCount(n0);
    await expect(plus).toHaveCount(1);
    // Deja el clip como estaba (marcar, desmarcar y el corte).
    for (let i = 0; i < 3; i++) await page.click('[data-e=undo]');
    await expect(plus).toHaveCount(0);
  });

  test('volumen del video, textos editables en la vista previa y el gancho marcado en la linea de tiempo', async () => {
    // Volumen: botones rapidos; la vista previa suena mas bajo (hasta 100 %).
    await tool('sonido');
    await page.click('#epanel [data-e=setvol][data-k="50"]');
    await expect(page.locator('#epanel')).toContainText('Sonido original: 50 %');
    expect(await page.$eval('#pv', (v) => (v as HTMLVideoElement).volume)).toBeCloseTo(0.5, 2);
    await page.click('#epanel [data-e=setvol][data-k="100"]');
    expect(await page.$eval('#pv', (v) => (v as HTMLVideoElement).volume)).toBeCloseTo(1, 2);
    // Titulo fijo: un clic abre «Texto» con su campo; doble clic deja escribir encima de la vista previa.
    await tool('texto');
    await page.fill('#epanel [data-i=title]', 'Un título para probar');
    await page.locator('#ov .ov-title').click();
    await expect(page.locator('#epanel [data-i=title]')).toBeFocused();
    await page.locator('#ov .ov-title').dblclick();
    await expect(page.locator('#ov .ov-title[contenteditable]')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Escrito encima');
    await page.keyboard.press('Enter');
    await expect(page.locator('#epanel [data-i=title]')).toHaveValue('Escrito encima');
    await expect(page.locator('#ov .ov-title')).toHaveText('Escrito encima');
    // Gancho: con «Solo los primeros 5 s» el titulo se ve al principio y se va despues (como en el clip exportado).
    const clipAt = async (target: number) => page.evaluate((tg) => {
      const v = document.querySelector('#pv') as HTMLVideoElement;
      const now = document.getElementById('clock')!.textContent!.split('/')[0].trim().split(':').reduce((s, x) => s * 60 + +x, 0);
      v.currentTime += tg - now;
    }, target);
    await tool('texto');
    await page.click('#epanel [data-e=titlefor][data-k="5"]');
    await expect(page.locator('#epanel [data-e=titlefor][data-k="5"]')).toHaveAttribute('aria-pressed', 'true');
    await clipAt(1);
    await expect(page.locator('#ov .ov-title'), 'el gancho se ve al principio').toBeVisible();
    await clipAt(9);
    await expect(page.locator('#ov .ov-title'), 'y se va pasados 5 s').toHaveCount(0);
    await page.click('#epanel [data-e=titlefor][data-k="0"]');
    await expect(page.locator('#ov .ov-title'), '«Todo el clip» lo vuelve a mostrar').toBeVisible();
    // Un texto del clip: se lleva el cursor a su tramo y se cambia con doble clic.
    const blk = await page.locator('[data-lane=txt] .blk').first().boundingBox(), lane = await page.locator('.lane[data-lane=video]').boundingBox();
    await page.mouse.click(blk!.x + blk!.width / 2, lane!.y + lane!.height - 4);
    const txt = page.locator('#ov .ov-item[data-ov=texts]').first();
    await expect(txt).toBeVisible();
    await txt.dblclick();
    await page.keyboard.press('Control+A');
    // Intro hace otra linea (como en CapCut); Ctrl+Intro o hacer clic fuera termina.
    await page.keyboard.type('HO');
    await page.keyboard.press('Enter');
    await page.keyboard.type('LA');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#ov .ov-item[data-ov=texts]').first()).toHaveText('HO\nLA');
    const h2 = (await page.locator('#ov .ov-item[data-ov=texts]').first().boundingBox())!.height;
    await txt.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('HOLA');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#ov .ov-item[data-ov=texts]').first()).toHaveText('HOLA');
    expect(h2, 'dos lineas: casi el doble de alto que una').toBeGreaterThan((await page.locator('#ov .ov-item[data-ov=texts]').first().boundingBox())!.height * 1.6);
    // Gancho: con el gancho activado, una franja ambar marca que trozo se ve primero; al pulsarla se explica.
    await tool('recorte');
    const hook = page.locator('#epanel [data-i=hook]').first();
    if (!(await hook.isChecked())) await hook.check();
    await expect(page.locator('#tracks .hookband')).toBeVisible();
    await page.locator('#tracks .hookband').click();
    await expect(page.locator('#toasts')).toContainText('se ve al principio del clip');
    await page.locator('#epanel [data-i=hook]').first().uncheck();
    await expect(page.locator('#tracks .hookband')).toHaveCount(0);
    await page.locator('#epanel [data-i=hook]').first().check(); // como estaba, para la exportacion
    await expect(page.locator('#tracks .hookband')).toBeVisible();
  });

  test('edicion directa en la vista previa: elegir, mover, tamaño, giro, opacidad, bloquear, capas y zonas', async () => {
    const num = (k: string) => page.inputValue(`#epanel input[type=number][data-i="${k}"]`).then(Number);
    const dragBy = async (box: { x: number; y: number; width: number; height: number }, dx: number, dy: number) => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 }); await page.mouse.up();
    };
    await page.evaluate(() => (document.querySelector('#pv') as HTMLVideoElement).pause());
    await tool('texto');
    await page.click('#epanel [data-e=addtext]');
    const txt = page.locator('#ov .ov-item[data-ov=texts]').last(), id = (await txt.getAttribute('data-id'))!;
    // Tocarlo en la vista previa lo elige: caja con tiradores, barra de acciones y sus propiedades en el inspector.
    await txt.click();
    await expect(page.locator('#selbox')).toBeVisible();
    await expect(page.locator('#selbar')).toContainText('Texto');
    await expect(page.locator('#epanel h2')).toHaveText('Texto');
    await expect(page.locator('#etabs')).toContainText('Texto «');
    // Arrastrarlo lo mueve (y el inspector lo refleja); las flechas lo mueven poco a poco.
    const x0 = await num('text.x');
    await dragBy((await txt.boundingBox())!, -60, -40);
    expect(await num('text.x'), 'arrastrar a la izquierda').toBeLessThan(x0);
    const y1 = await num('text.y');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => num('text.y'), { message: 'Mayús+flecha abajo' }).toBeGreaterThan(y1);
    // La esquina cambia el tamaño; el circulo de arriba lo gira (se pega a 90°).
    const s0 = await num('text.size');
    await dragBy((await page.locator('#selbox .sh.se').boundingBox())!, 40, 30);
    expect(await num('text.size'), 'tirador de esquina').toBeGreaterThan(s0);
    const c = (await page.locator('#selbox').boundingBox())!, r = (await page.locator('#selbox .sh.rot').boundingBox())!;
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2 + 120, c.y + c.height / 2, { steps: 8 }); await page.mouse.up();
    await expect(page.locator('#epanel input[type=number][data-i="text.rot"]')).toHaveValue('90');
    await page.screenshot({ path: 'test-results/seleccion-texto.png' });
    // Escribir el valor exacto en el inspector cambia la vista previa al momento.
    await page.fill('#epanel input[type=number][data-i="text.rot"]', '0');
    await page.fill('#epanel input[type=number][data-i="text.op"]', '50');
    await expect(txt).toHaveCSS('opacity', '0.5');
    // Bloqueado no se mueve; desbloqueado si.
    await page.click('#selbar [data-e=itemlock]');
    const b1 = (await txt.boundingBox())!;
    await dragBy(b1, 50, 0);
    expect(Math.abs((await txt.boundingBox())!.x - b1.x), 'bloqueado no se mueve').toBeLessThan(2);
    await page.click('#selbar [data-e=itemlock]');
    // Capas: el ojo lo quita de la vista previa y lo devuelve; tocar la capa lo elige.
    await page.click('#elib [data-e=lib][data-k=capas]');
    const row = page.locator('#elib .lyr', { has: page.locator(`[data-e=layerpick][data-id="${id}"]`) });
    await row.locator('[data-e=itemhide]').click();
    await expect(page.locator(`#ov [data-ov=texts][data-id="${id}"]`), 'oculto').toHaveCount(0);
    await row.locator('[data-e=itemhide]').click();
    await expect(page.locator(`#ov [data-ov=texts][data-id="${id}"]`), 'visible otra vez').toHaveCount(1);
    await row.locator('[data-e=layerpick]').click();
    await expect(page.locator('#epanel h2')).toHaveText('Texto');
    // Tocar el video elige su zona (camara o juego): arrastrar mueve el encuadre, y Ctrl+Z lo deshace.
    await page.keyboard.press('Escape');
    await expect(page.locator('#selbox'), 'Escape deja de elegir').toBeHidden();
    const layout = await page.getAttribute('#efloat [data-e=layout].on', 'data-k');
    await page.click('#efloat [data-e=layout][data-k=split]');
    await page.waitForTimeout(400);
    // por el borde derecho: el texto «TU TEXTO» que se movio antes queda a la izquierda y taparia la imagen
    const ph = (await page.locator('#phone').boundingBox())!, spot = { x: ph.x + ph.width - 6, y: ph.y + ph.height * 0.6, width: 0, height: 0 };
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator('#epanel h2'), 'abajo, el juego').toHaveText('Zona del juego');
    await expect(page.locator('#selbox.pan')).toBeVisible();
    await page.screenshot({ path: 'test-results/seleccion-zona.png' });
    const fx = await num('frame.x');
    await dragBy(spot, 40, 0);
    await expect.poll(() => num('frame.x'), { message: 'arrastrar la imagen mueve el encuadre' }).not.toBe(fx);
    await page.keyboard.press('Control+z');
    await expect.poll(() => num('frame.x'), { message: 'Ctrl+Z lo deshace' }).toBe(fx);
    await page.keyboard.press('Escape');
    await page.click(`#efloat [data-e=layout][data-k=${layout || 'duo'}]`);
    await expect(page.locator('#selbox')).toBeHidden();
    // Se quita el texto de la prueba, para no cambiar las siguientes.
    await page.locator('#elib .lyr', { has: page.locator(`[data-e=layerpick][data-id="${id}"]`) }).locator('[data-e=layerpick]').click();
    await page.click('#selbar [data-e=delsel]');
    await expect(page.locator(`#ov [data-ov=texts][data-id="${id}"]`)).toHaveCount(0);
    await page.click('#elib [data-e=lib][data-k=textos]');
    await page.screenshot({ path: 'test-results/edicion-directa.png' });
  });

  test('imagen: luz y color automaticos y estabilizar', async () => {
    await tool('imagen');
    // El color de la vista previa va en un filtro CSS sobre el lienzo (no cambia sus pixeles).
    const look = () => page.$eval('#cv', (c) => getComputedStyle(c).filter);
    const before = await look();
    await page.click('#epanel [data-e=autolook]');
    const msg = page.locator('#toasts').getByText(/Luz y color corregidos|La imagen ya está bien/).first();
    await expect(msg).toBeVisible({ timeout: 30_000 });
    // Si corrigio, la vista previa cambia y Ctrl+Z lo deshace.
    if (/corregidos/.test((await msg.textContent()) || '')) {
      await expect.poll(look, { message: 'la vista previa muestra la corrección' }).not.toBe(before);
      await page.keyboard.press('Control+z');
    }
    // Repeticion a camara lenta desde Sugerencias: la duracion final crece, la vista previa avisa de que se vera al
    // exportar, y en la herramienta «Lento» se cambia la velocidad y se quita.
    const secs = (s: string) => s.split(':').reduce((t, v) => t * 60 + +v, 0);
    const finalDur = async () => secs((await page.locator('#tlInfo').textContent())!.replace(/[^\d:]/g, ''));
    const d0 = await finalDur();
    await page.click('[data-e=sugmenu]');
    await page.click('#sugMenu [data-e=replayhere]');
    await expect(page.locator('#toasts').getByText(/se repetirá a cámara lenta/)).toBeVisible();
    await expect.poll(finalDur, { message: 'la repeticion alarga el clip' }).toBeGreaterThanOrEqual(d0 + 4);
    await expect(page.locator('#pvExport')).toContainText('repetición a cámara lenta al final');
    await tool('lento');
    await expect(page.locator('#epanel .intro')).toContainText('repeticiones del deporte');
    const d1 = await finalDur();
    await page.click('#epanel [data-e=replayspeed][data-k="0.3"]');
    await expect.poll(finalDur, { message: 'mas lenta, mas larga' }).toBeGreaterThan(d1);
    await page.click('#epanel [data-e=noreplay]');
    await expect.poll(finalDur).toBe(d0);
    await expect(page.locator('#pvExport')).toBeEmpty();
    await tool('imagen');
    const stab = page.locator('#epanel [data-i=stabilize]');
    await stab.check();
    await expect(stab).toBeChecked();
    await stab.uncheck();
  });

  test('sonido: efecto de voz en todo el clip o solo en la repeticion', async () => {
    await tool('sonido');
    const sel = page.locator('#epanel [data-i=voiceFx]');
    await expect(sel.locator('option')).toHaveCount(8); // sin efecto + 7
    await sel.selectOption('grave');
    await page.click('#etabs [data-k=clip]');
    await expect(page.locator('#epanel [data-k=sonido] .tbadge'), '«Clip» marca que el sonido tiene un efecto').toHaveCount(1);
    await tool('sonido');
    // Con repeticion a camara lenta se puede dejar el efecto solo para ella.
    await page.click('[data-e=sugmenu]');
    await page.click('#sugMenu [data-e=replayhere]');
    await tool('sonido');
    const only = page.locator('#epanel [data-i=voiceReplay]');
    await only.check();
    await expect(only).toBeChecked();
    // Se deja como estaba: sin efecto y sin repeticion.
    await page.locator('#epanel [data-i=voiceFx]').selectOption('');
    await tool('lento');
    await page.click('#epanel [data-e=noreplay]');
  });

  test('condensar: de un tramo largo, un short de la duracion pedida', async () => {
    const secs = (s: string) => s.split(':').reduce((t, v) => t * 60 + +v, 0);
    const finalDur = async () => secs((await page.locator('#tlInfo').textContent())!.replace(/[^\d:]/g, ''));
    const before = await finalDur();
    await page.click('[data-e=sugmenu]');
    const items = page.locator('#sugMenu [data-e=condense]');
    const n = await items.count();
    console.log(`    clip de ${before} s; opciones de condensar: ${n}`);
    expect(n, 'se ofrece condensar en un tramo largo').toBeGreaterThan(0);
    const target = +(await items.first().getAttribute('data-k'))!;
    await items.first().click();
    await expect(page.locator('#toasts').getByText(/Condensado a \d+ s/)).toBeVisible({ timeout: 120_000 });
    const after = await finalDur();
    console.log(`    condensado a ${after} s (pedido ${target} s)`);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(target * 0.7);
    expect(after).toBeLessThanOrEqual(target * 1.4);
    await page.keyboard.press('Control+z');
    await expect.poll(finalDur).toBe(before);
  });

  test('exportar guarda todo y se puede reabrir desde «Clips»', async () => {
    const before = (await state()).clips.length;
    await page.click('[data-e=export]');
    await expect.poll(async () => { const c = (await state()).clips; return c.length > before ? c[0].status : ''; }, { timeout: 240_000, intervals: [2000] }).toBe('listo');
    const clip = (await state()).clips[0];
    const spec = await page.evaluate((id) => fetch('/api/clip?cid=' + id).then((r) => r.json()), clip.id);
    expect(spec.layout).toBe('duo');
    expect(spec.zooms).toHaveLength(1);
    expect(spec.texts).toHaveLength(1);
    expect(spec.punches).toHaveLength(1);
    expect(spec.transition).toBe('smoke');
    expect(spec.transCuts || spec.hook).toBe(true);
    // Avisos: la campana cuenta lo nuevo, y al abrirla se ve la cola y el final, con su hora; al abrirla se da por visto.
    await page.evaluate(() => { try { localStorage.removeItem('clipper.notiSeen'); } catch {} });
    await expect.poll(() => page.locator('#navNoti').textContent(), { timeout: 10_000 }).toMatch(/^[1-9]\d*$/);
    await page.click('#notiBtn');
    await expect(page.locator('#noti')).toBeVisible();
    await expect(page.locator('#notiList .nrow').filter({ hasText: 'En cola para exportar' }).first()).toBeVisible();
    await expect(page.locator('#notiList .nrow[data-k=ok]').filter({ hasText: `Clip exportado: ${clip.title || ''}` }).first()).toBeVisible();
    await expect(page.locator('#notiList .nrow time').first()).toHaveText(/\d{1,2}:\d{2}/);
    await expect(page.locator('#navNoti'), 'abrir la campana borra el numero').toHaveText('');
    await page.click('#notiBtn');
    await expect(page.locator('#noti'), 'se cierra con el mismo botón').toBeHidden();
    await page.evaluate(() => (document.querySelector('[data-view=clips]') as HTMLElement).click());
    // «Publicar en»: una fila por app, con su icono y lo que se puede hacer (subir, conectar o ver).
    // La galeria muestra el clip con su descarga; al elegirlo, «Detalles» tiene la descarga y una fila por app para publicar.
    const card = page.locator(`article.clip[data-openclip="${clip.id}"]`);
    await expect(card.locator('a[download]')).toHaveAttribute('href', /\?dl=.+\.mp4$/);
    await card.locator('.cmeta').click();
    await expect(card).toHaveClass(/open/);
    const det = page.locator('#cdet');
    await expect(det.locator('a[download]')).toBeVisible();
    await expect(det.locator('.pubrow b')).toHaveText(['YouTube', 'TikTok']);
    await expect(det.locator('.pubrow .pubic svg')).toHaveCount(2);
    for (const row of await det.locator('.pubrow').all()) await expect(row.locator('[data-up], [data-uptt], [data-gosettings], a')).toHaveCount(1);
    // Las vistas de cada clip (para que la nota aprenda) estan en «Resultados»: tabla con la descarga y las de otras redes.
    await page.evaluate(() => (document.querySelector('[data-view=stats]') as HTMLElement).click()); // esta en el grupo «Agente»
    await expect(page.locator('#v-stats .ctable a[download]').first()).toBeVisible();
    await expect(page.locator('#v-stats .ctable input[data-views]').first()).toBeVisible();
    await expect(page.locator('[data-view=camps]'), 'sin Campañas').toHaveCount(0);
    await page.evaluate(() => (document.querySelector('[data-view=clips]') as HTMLElement).click());
    await page.click(`#cdet [data-editclip="${clip.id}"]`);
    await previewReady();
    await expect(page.locator('#epanel'), 'el inspector abre en «Clip», con el resumen').toContainText('Varias cámaras');
  });

  test('escuela del agente: muestra lo aprendido, se pausa y se puede pedir estudiar', async () => {
    // Desde el editor: volver y abrir Ajustes en la barra lateral, como lo haria el usuario.
    await page.getByRole('button', { name: 'Volver a los momentos' }).click();
    await page.locator('.nav[data-view=agent]').click();
    const card = page.locator('#schoolCard');
    await expect(card).toBeVisible();
    // La pantalla Agente explica en tres pasos lo que hace.
    await expect(page.locator('#v-agent .astep')).toHaveCount(3);
    await expect(page.locator('#v-agent .astep').first()).toContainText('Mira shorts que funcionan');
    // Ajustes ya no lleva la escuela, y sus deslizadores dicen en palabras lo que significa cada valor.
    await page.locator('.nav[data-view=settings]').click();
    await expect(page.locator('#v-settings #schoolCard')).toHaveCount(0);
    await expect(page.locator('#sNotifyV')).toHaveText(/\d.* · (solo lo excepcional|lo muy bueno|casi todo|todo)/);
    // Una seccion a la vez, elegida en la lista; y cada cambio se guarda solo.
    await expect(page.locator('#v-settings .ssec:visible')).toHaveCount(1);
    await page.click('[data-ssec=disco]');
    await expect(page.locator('#v-settings .ssec:visible h2')).toHaveText('Espacio en disco');
    await expect(page.locator('#atitle')).toContainText('Espacio en disco');
    await page.click('[data-ssec=det]');
    await page.locator('#sAuto').fill('0');
    await expect(page.locator('#sAutoV')).toHaveText('nunca');
    await page.locator('#sVisual').setChecked(false);
    await expect(page.locator('#toasts').getByText('Guardado', { exact: true }).first()).toBeVisible();
    await expect.poll(async () => (await state()).settings.visual).toBe(false);
    await page.locator('#sVisual').setChecked(true);
    await expect.poll(async () => (await state()).settings.visual).toBe(true);
    await page.locator('.nav[data-view=agent]').click();
    await expect(card).toContainText('8 shorts estudiados');
    await expect(card).toContainText('podcast 4');
    await expect(card).toContainText('cambian de plano cada 2,1 s');
    await expect(card).toContainText('«¿sabes lo que me paso ayer?»');
    // Pausar y reanudar se guarda.
    await card.locator('#sSchool').uncheck();
    await expect.poll(async () => (await state()).school.on).toBe(false);
    await card.locator('#sSchool').check();
    await expect.poll(async () => (await state()).school.on).toBe(true);
    await card.getByRole('button', { name: 'Estudiar ahora' }).click();
    await expect(page.locator('#toasts').getByText(/Estudiando 5 shorts/)).toBeVisible();
    // Enséñale (panel del centro): enlaces y TikTok.
    const teach = page.locator('#v-agent .wsc');
    // TikTok: sin conectar, ofrece conectar; guarda creadores y hashtags limpios; probar sin sesion lo explica.
    await expect(teach.getByRole('button', { name: 'Conectar TikTok' })).toBeVisible();
    await teach.locator('#ttCreators').fill('https://www.tiktok.com/@ibai/video/1, auronplay');
    await teach.locator('#ttTags').fill('#podcast humor');
    await teach.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(teach.locator('#ttCreators')).toHaveValue('@ibai, @auronplay');
    await expect(teach.locator('#ttTags')).toHaveValue('#podcast, #humor');
    expect((await state()).school.tiktok.creators).toEqual(['ibai', 'auronplay']);
    await teach.getByRole('button', { name: 'Probar', exact: true }).click();
    await expect(page.locator('#toasts').getByText(/Primero pulsa «Conectar TikTok»/)).toBeVisible();
    // Enlaces pegados: se ponen en cola (en las pruebas no se descarga nada); lo que no es un enlace de video, se explica.
    await teach.locator('#lnk').fill('mira esto https://www.tiktok.com/@ibai/video/7400000000000000001\nhttps://youtube.com/shorts/abc123');
    await teach.getByRole('button', { name: 'Estudiar estos' }).click();
    await expect(page.locator('#toasts').getByText('2 videos para estudiar. Puedes seguir trabajando.')).toBeVisible();
    await expect(card).toContainText('2 pendientes de estudiar');
    await expect(teach.locator('#lnk')).toHaveValue('');
    await teach.locator('#lnk').fill('hola');
    await teach.getByRole('button', { name: 'Estudiar estos' }).click();
    await expect(page.locator('#toasts').getByText(/No encontré enlaces/)).toBeVisible();
    // Su ayuda explica que es.
    await card.locator('[data-help=escuela]').click();
    await expect(page.getByText('Aprende a editar solo, mirando shorts que funcionan.')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('subtitulos: lo que corriges a mano se aprende al exportar y se aplica la proxima vez', async () => {
    const s = (await state()).sources.find((x: any) => x.id === sid);
    const words = await page.evaluate((b) => fetch('/api/words', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()), { sid, start: s.candidates[0].start, end: s.candidates[0].start + 20 });
    const w = words.words.find((x: any) => /^\p{L}{4,}/u.test(x.text));
    expect(w, 'una palabra para corregir').toBeTruthy();
    // Como lo deja el editor: el texto corregido y lo que habia antes.
    const fixed = words.words.map((x: any) => (x === w ? { ...x, text: 'Clipperazo', was: x.text } : x));
    await page.evaluate((b) => fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()), { sid, start: s.candidates[0].start, end: s.candidates[0].start + 20, edited: true, captions: { on: true, words: fixed } });
    // Se ve en el perfil del streamer y se puede olvidar.
    await page.locator('.nav[data-view=agent]').click();
    const profiles = (await state()).settings.profiles;
    const pkey = Object.keys(profiles).find((k) => profiles[k].fixes?.some((f: any) => f.to === 'Clipperazo'));
    expect(pkey, 'perfil con la corrección aprendida').toBeTruthy();
    await page.locator('#pKey').selectOption(pkey!);
    const chip = page.locator('.fixchip', { hasText: 'Clipperazo' });
    await expect(chip).toBeVisible();
    // La proxima vez, esa palabra ya sale corregida.
    const again = await page.evaluate((b) => fetch('/api/words', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()), { sid, start: s.candidates[0].start, end: s.candidates[0].start + 20 });
    expect(again.words.some((x: any) => /Clipperazo/i.test(x.text))).toBe(true);
    await chip.locator('[data-unfix]').click();
    await expect(chip).toHaveCount(0);
  });

  test('sacar clips: duracion y tipo de momento, resultados al instante y editarlos de una vez', async () => {
    await page.locator('.nav[data-view=live]').click();
    await page.click('[data-act=sacar]');
    const dlg = page.getByRole('dialog', { name: 'Sacar clips' });
    await expect(dlg).toBeVisible();
    const rows = dlg.locator('.srow');
    expect(await rows.count(), 'momentos encontrados').toBeGreaterThan(0);
    await page.waitForTimeout(400); // tras la animación de entrada
    await page.screenshot({ path: 'test-results/sacar-clips.png' });
    // Los 3 mejores sin exportar ya vienen marcados y el botón dice cuántos se editan.
    const n = Math.min(3, await rows.filter({ hasNot: page.locator('i.done') }).count());
    await expect(dlg.locator('[data-pick]:checked')).toHaveCount(n);
    await expect(dlg.locator('[data-x=go]')).toHaveText(n === 0 ? 'Elige alguno' : n === 1 ? 'Editar el elegido' : `Editar los ${n}`);
    // 15–30 s: cada clip dura eso.
    await dlg.getByRole('button', { name: '15–30 s' }).click();
    for (const t of await rows.locator('.grow .mut').allTextContents()) {
      const sec = +(/· (\d+) s/.exec(t)?.[1] || 0);
      expect(sec, t).toBeGreaterThanOrEqual(15); expect(sec, t).toBeLessThanOrEqual(30);
    }
    await dlg.getByRole('radio', { name: /Historias completas/ }).click();
    await expect(dlg.getByRole('radio', { name: /Historias completas/ })).toHaveAttribute('aria-checked', 'true');
    // Marcar y desmarcar hasta dejar uno: se edita ese, con la plantilla, y aparece en «Clips».
    const before = (await state()).clips.length;
    const boxes = dlg.locator('[data-pick]:checked');
    while ((await boxes.count()) > 1) await boxes.last().uncheck();
    if (!(await boxes.count())) await dlg.locator('[data-pick]').first().check();
    await expect(dlg.locator('[data-x=go]')).toHaveText('Editar el elegido');
    await dlg.locator('[data-x=go]').click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(async () => (await state()).clips.length, { timeout: 15_000 }).toBe(before + 1);
    // Escape cierra sin hacer nada.
    await page.click('[data-act=sacar]');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Sacar clips' })).toHaveCount(0);
  });

  test('cuentas conectadas: cada app con su icono y su estado, y se comprueban al pulsar', async () => {
    await page.evaluate(() => (document.querySelector('[data-view=settings]') as HTMLElement).click());
    await page.click('[data-ssec=cuentas]');
    const box = page.locator('#accBox');
    await expect(box.locator('.acc')).toHaveCount(4);
    await expect(box.locator('.acc b')).toHaveText(['TikTok', 'YouTube', 'Discord', 'Telegram']);
    await expect(box.locator('.acc .accic svg')).toHaveCount(4);
    await box.locator('[data-acccheck]').click();
    await expect(page.locator('.toast').filter({ hasText: 'Cuentas comprobadas' })).toBeVisible({ timeout: 60_000 });
    await expect(box.locator('[data-acccheck]')).toHaveText('Comprobar ahora');
    for (const st of await box.locator('.accst').allTextContents()) expect(['Conectada', 'Revisar', 'Sin respuesta', 'Sin configurar']).toContain(st);
    await expect(box.locator('.acc').filter({ hasText: 'Discord' })).toContainText('comprobado');
  });

  test('laboratorio: elegir cuanto recorta, medir el parecido con tus clips y probar en un momento', async () => {
    await page.evaluate(() => (document.querySelector('[data-view=lab]') as HTMLElement).click());
    const lab = page.locator('#v-lab');
    await expect(lab.locator('h2').first()).toHaveText('Laboratorio');
    const who = await lab.locator('[data-labstreamer]').inputValue();
    // Agresividad: se guarda por streamer y cambia la explicacion.
    await lab.locator('[data-lablevel="0"]').click();
    await expect(lab.locator('[data-lablevel="0"]')).toHaveAttribute('aria-checked', 'true');
    await expect(lab).toContainText('más de 1,4 s');
    expect((await state()).lab.learned[who].level).toBe(0);
    await lab.locator('[data-lablevel="1"]').click();
    await expect(lab.locator('[data-lablevel="1"]')).toHaveAttribute('aria-checked', 'true');
    // Medir: pasa la auto edicion por los clips exportados y da una nota por area, sin tocar los clips.
    const before = JSON.stringify((await state()).clips.map((c: any) => c.id).sort());
    await lab.locator('[data-labrun]').click();
    await expect.poll(async () => { const l = (await state()).lab; return !l.running && l.rows.length > 0; }, { timeout: 240_000, intervals: [2000] }).toBe(true);
    await expect(lab.locator('.lscore b')).toHaveText(/^\d{1,3} %$/);
    await expect(lab.locator('.larea')).toHaveCount(6, { timeout: 10_000 }).catch(async () => expect(await lab.locator('.larea').count()).toBeGreaterThanOrEqual(6));
    await expect(lab.locator('.chk')).toContainText(/quita|Recorta/);
    expect(JSON.stringify((await state()).clips.map((c: any) => c.id).sort()), 'medir no crea ni borra clips').toBe(before);
    await page.screenshot({ path: 'test-results/laboratorio.png' });
    // Probar: abre el editor con la auto edicion hecha, lista para revisar.
    await lab.locator('[data-labtry]').first().click();
    await expect(page.locator('#epanel h2')).toHaveText('Revisar la auto edición', { timeout: 120_000 });
  });

  test('borrar exportados: seleccionar todos y borrarlos de una vez, con confirmación', async () => {
    await page.evaluate(() => (document.querySelector('[data-view=clips]') as HTMLElement).click());
    const ready = async () => (await state()).clips.filter((c: any) => c.status === 'listo' && !c.youtubeId && !c.scheduledAt).length;
    const n = await ready();
    expect(n, 'hay clips exportados por publicar').toBeGreaterThan(0);
    await expect(page.locator('#v-clips .pubs').first()).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'test-results/clips.png' });
    await expect(page.locator('[data-act=delpicked]')).toBeDisabled();
    await expect(page.locator('#v-clips .clip .pick'), 'la galeria ya muestra todos los exportados').toHaveCount(n, { timeout: 10_000 });
    await page.click('[data-act=pickall]');
    await expect(page.locator('[data-act=delpicked]')).toHaveText(`Borrar (${n})`);
    await expect(page.locator('[data-act=pickall]')).toHaveText('Quitar selección');
    await page.click('[data-act=delpicked]');
    await expect(page.getByRole('dialog')).toContainText(n === 1 ? 'este clip' : `estos ${n} clips`);
    await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
    await expect.poll(ready, { timeout: 15_000 }).toBe(0);
    await expect(page.locator('[data-act=delpicked]')).toHaveText('Borrar (0)');
  });

  test('«Seguir la cara» lo calcula el servidor (el mismo seguimiento que la auto edición)', async () => {
    const r = await page.request.post('/api/follow', { data: { sid, start: 0, end: 10 } });
    expect(r.ok(), await r.text()).toBe(true);
    const { keys } = await r.json();
    expect(Array.isArray(keys)).toBe(true);
    for (const k of keys) expect(k.x >= 0 && k.x <= 1 && k.t >= 0 && k.t <= 10).toBe(true);
  });

  test('«Hacer los clips solo»: pegar, Añadir y los mejores clips salen auto editados sin tocar nada más', async () => {
    test.setTimeout(900_000); // analisis + 3 auto ediciones completas
    await page.click('[data-view=live]');
    await page.check('#live');
    await expect(page.locator('#autoClips'), 'en directo no aplica').toBeDisabled();
    await page.uncheck('#live');
    await page.check('#autoClips');
    // Los momentos de este video que ya se exportaron no se repiten: se borran antes para probar el caso normal.
    for (const c of (await state()).clips) await page.request.post('/api/clip/remove', { data: { cid: c.id } });
    const before = new Set((await state()).sources.map((s: any) => s.id));
    await page.fill('#value', process.env.CLIPPER_UI_VIDEO!);
    await page.click('#add');
    await expect(page.locator('#toasts').getByText(/haré sus mejores clips/)).toBeVisible();
    const fresh = async () => (await state()).sources.find((s: any) => !before.has(s.id))?.id;
    await expect.poll(fresh, { timeout: 30_000 }).toBeTruthy();
    const nsid = await fresh();
    // Al terminar el analisis se ponen en cola solos...
    await expect.poll(async () => (await state()).clips.filter((c: any) => c.sid === nsid).length, { message: 'clips en cola al terminar el análisis', timeout: 300_000, intervals: [3000] }).toBeGreaterThan(0).catch(async (e) => {
      const st = await state(), src = st.sources.find((s: any) => s.id === nsid);
      console.log('DIAG fuente', JSON.stringify({ status: src?.status, progress: src?.progress, error: src?.error, autoClips: src?.autoClips, cands: src?.candidates?.length, hidden: src?.candidates?.filter((c: any) => c.hidden).length, exported: src?.candidates?.filter((c: any) => c.exported).length }));
      console.log('DIAG logs', JSON.stringify((st.logs || []).slice(-15)));
      throw e;
    });
    // ...y salen auto editados (con su nota), sin subir nada.
    await expect.poll(async () => (await state()).clips.filter((c: any) => c.sid === nsid && c.status === 'listo').length, { message: 'el primero, terminado', timeout: 540_000, intervals: [5000] }).toBeGreaterThan(0);
    const mine = (await state()).clips.filter((c: any) => c.sid === nsid);
    expect(mine.length, 'como mucho uno cada 5 min (y al menos 3)').toBeLessThanOrEqual(3);
    for (const c of mine) expect(c.tiktokId || c.ytId, 'no se sube nada').toBeFalsy();
    expect(mine.some((c: any) => /Auto edición/.test(c.note || '')), 'auto editados').toBe(true);
  });

  test('sin errores en la consola', async () => {
    expect(errors).toEqual([]);
  });
});
