import { describe, expect, it } from 'vitest';
import { clipInVod, kickOffset } from '../src/clips/engine';

describe('buscar un clip de la comunidad en su directo', () => {
  it('Kick: el segundo del VOD sale de la hora del clip, la del directo y lo que dura', () => {
    // clip creado a las 22:49:31.9 de un directo que empezo a las 19:38:22 (UTC) y dura 180 s
    expect(kickOffset('2026-10-16T22:49:31.940102Z', '2026-10-16 19:38:22', 180)).toBe(11290);
    expect(kickOffset('2026-10-16T19:38:30Z', '2026-10-16 19:38:22', 30), 'nunca antes del inicio').toBe(0);
  });
  it('solo enlaces de clips de Twitch o Kick', async () => {
    await expect(clipInVod('https://youtube.com/shorts/abc')).rejects.toThrow(/Twitch o Kick/);
  });
});
