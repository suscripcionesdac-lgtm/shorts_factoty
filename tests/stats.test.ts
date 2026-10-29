import { describe, expect, it } from 'vitest';
import { analyze, bestHours, merge, nextSlot, tagsOf, titleOf, viewsAtDay, type TtVideo } from '../src/clips/analysis/stats';

const H = 3600, D = 86400, now = 100 * D;
const utc = { now, tz: 'UTC', localHour: (ts: number) => new Date(ts * 1000).getUTCHours(), localDay: (ts: number) => new Date(ts * 1000).getUTCDay() };
const vid = (id: string, ts: number, views: number, o: Partial<TtVideo> = {}): TtVideo => ({ id, desc: 'clip #auronplay', ts, dur: 30, snaps: [[now, views, views / 20, 0, 0, 0]], ...o });

describe('resultados de TikTok', () => {
  it('vistas a las 24 h: interpola el historial; sin el, las de ahora', () => {
    const v = vid('a', 0, 0, { snaps: [[12 * H, 100, 0, 0, 0, 0], [36 * H, 300, 0, 0, 0, 0]] });
    expect(viewsAtDay(v)).toBe(200);
    expect(viewsAtDay(vid('b', 0, 50))).toBe(50);
  });
  it('titulo y hashtags', () => {
    expect(tagsOf('traicion#clip #AuronPlay #clip')).toEqual(['#clip', '#auronplay']);
    expect(titleOf('¿Qué pena?#clip #westcol')).toBe('¿Qué pena?');
  });
  it('solo compara los videos con 24 h o mas, y saca la mejor franja y la mejor duracion', () => {
    const vs: TtVideo[] = [];
    // De noche (22 h) van mucho mejor que por la tarde (15 h); los de 20-30 s, mejor que los largos.
    for (let i = 0; i < 6; i++) vs.push(vid('n' + i, (10 + i) * D + 22 * H, 1000 + i, { dur: 25 }));
    for (let i = 0; i < 6; i++) vs.push(vid('t' + i, (20 + i) * D + 15 * H, 100 + i, { dur: 70 }));
    vs.push(vid('nuevo', now - 2 * H, 5)); // recien subido: no cuenta
    const r = analyze(vs, utc);
    expect(r.n).toBe(13);
    expect(r.mature).toBe(12);
    expect(r.hours[r.hours.length - 1].key).toBe('21-24');
    expect(r.findings.some((f) => /21-24 h/.test(f.text) && f.strength === 'fuerte')).toBe(true);
    expect(r.next[0]).toMatch(/21-24/);
    expect(r.next.some((t) => /20-30 s/.test(t))).toBe(true);
  });
  it('detecta las subidas en tanda y el efecto de la edicion', () => {
    const vs: TtVideo[] = [];
    for (let i = 0; i < 4; i++) vs.push(vid('s' + i, (10 + i) * D, 900));
    for (let i = 0; i < 4; i++) vs.push(vid('b' + i, 30 * D + i * 600, 100)); // cuatro en 30 min
    const edits = Object.fromEntries(vs.map((v) => [v.id, { captions: v.id.startsWith('s'), fps60: false }]));
    const r = analyze(vs, { ...utc, edits });
    expect(r.batch.find((g) => g.key.startsWith('en tanda'))!.n).toBe(3); // el primero de la tanda va separado del anterior
    expect(r.next.some((t) => /Separa las subidas/.test(t))).toBe(true);
    expect(r.edits.find((g) => g.key === 'con subtítulos')!.median).toBe(900);
  });
  it('el historial guarda un punto por lectura (como mucho cada 30 min)', () => {
    const h = merge({}, [{ id: 'a', desc: 'x', ts: 0, dur: 30, views: 10, likes: 1, comments: 0, shares: 0, saves: 0 }], 1000);
    merge(h, [{ id: 'a', desc: 'x', ts: 0, dur: 30, views: 20, likes: 1, comments: 0, shares: 0, saves: 0 }], 1500);
    merge(h, [{ id: 'a', desc: 'x', ts: 0, dur: 30, views: 40, likes: 2, comments: 0, shares: 0, saves: 0 }], 4000);
    expect(h.a.snaps.map((s) => s[1])).toEqual([20, 40]);
  });
  it('programar: en la mejor franja, nunca a menos de 1 h de otro video, y ya si se puede', () => {
    const M = 60_000, t0 = Date.UTC(2026, 9, 23, 12, 0); // 12:00
    const local = (base: number, d: number, h: number, m: number) => { const x = new Date(base); x.setUTCDate(x.getUTCDate() + d); x.setUTCHours(h, m, 0, 0); return +x; };
    expect(nextSlot(t0, [t0 - 90 * M], null, local)).toBeNull(); // el anterior hace 1,5 h: ya
    // Hace 20 min: en cuanto pase 1 h desde el anterior (en pasos de 10 min desde el margen de 15 de TikTok).
    expect(nextSlot(t0, [t0 - 20 * M], null, local)).toBe(t0 + 46 * M);
    const s = nextSlot(t0, [t0 - 20 * M], null, local)!;
    expect(s - (t0 - 20 * M)).toBeGreaterThanOrEqual(60 * M);
    // Mejor franja 18-21: hoy a las 18:00; si ya hay uno a las 18:10, a las 19:30 (18:30 y 19:00 quedan a menos de 1 h).
    expect(nextSlot(t0, [], [18, 21], local)).toBe(Date.UTC(2026, 9, 23, 18, 0));
    expect(nextSlot(t0, [Date.UTC(2026, 9, 23, 18, 10)], [18, 21], local)).toBe(Date.UTC(2026, 9, 23, 19, 30));
    // Pasada la franja de hoy: mañana.
    expect(nextSlot(Date.UTC(2026, 9, 23, 22, 0), [], [18, 21], local)).toBe(Date.UTC(2026, 9, 24, 18, 0));
    expect(bestHours({ hours: [{ key: '18-21', label: '', n: 4, median: 500, ratio: 1.6 }, { key: '9-12', label: '', n: 2, median: 900, ratio: 3 }] })).toEqual([18, 21]);
    expect(bestHours({ hours: [{ key: '18-21', label: '', n: 4, median: 500, ratio: 1.1 }] })).toBeNull();
  });
});
