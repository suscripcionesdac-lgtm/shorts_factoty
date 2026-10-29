import { describe, expect, it } from 'vitest';
import { TIKTOK_STEPS, bridgeError } from '../src/clips/publish/subirtiktok';

describe('error de la subida a TikTok', () => {
  it('prefiere lo que explica el puente sobre el registro de reintentos', () => {
    const out = 'Uploading\nTIKTOK_DETALLE: no pude pulsar button:has-text("Post"); lo tapa <div class="modal-mask">\n  - retrying click action\n    - waiting 500ms';
    expect(bridgeError(out)).toBe('no pude pulsar button:has-text("Post"); lo tapa <div class="modal-mask">');
  });
  it('sin explicacion propia, da el error de Python y que boton esperaba', () => {
    const out = 'Traceback\nphantomwright_driver._impl._errors.TimeoutError: Page.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator("button:has-text(\'Cancel\')")\n  - retrying click action\n    - waiting 500ms';
    expect(bridgeError(out)).toBe('TimeoutError: Page.click: Timeout 30000ms exceeded. · - waiting for locator("button:has-text(\'Cancel\')")');
  });
  it('si no hay nada mejor, las dos ultimas lineas', () => {
    expect(bridgeError('a\nb\nc')).toBe('b · c');
  });
  it('las etapas de la subida van en porcentaje creciente y reconocen lo que dice el puente', () => {
    const pcts = TIKTOK_STEPS.map((x) => x[1]);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    const said = ["Uploading to account 'x'", 'Entered File, waiting for tiktok', 'Description and Hashtags added', 'Tik tok done loading file onto servers', 'Esperando a que TikTok termine de revisar el vídeo', 'Confirmado: TikTok muestra el vídeo'];
    expect(said.map((m) => TIKTOK_STEPS.find(([re]) => re.test(m))?.[1])).toEqual(pcts);
    // la espera propia (sin depender del idioma de TikTok Studio) sigue en «TikTok procesa el vídeo»
    expect(TIKTOK_STEPS.find(([re]) => re.test('TikTok sigue procesando el vídeo (30 s)'))?.[2]).toBe('TikTok procesa el vídeo');
  });
});
