// Resultados de tu cuenta de TikTok: que les va bien a TUS videos (hora, dia, duracion, titulo, hashtags, streamer y,
// en los hechos con Clipper, como se editaron). Solo funciones puras; leer TikTok y guardar el historial esta en engine.ts.
// Un video recien subido aun no ha tenido su oportunidad: para comparar solo cuentan los que tienen al menos 24 h (TikTok
// reparte casi todas las vistas el primer dia), con las vistas que llevaban a las 24 h si el historial lo sabe (si no, las de ahora).

export type Snap = [t: number, views: number, likes: number, comments: number, shares: number, saves: number];
export type TtVideo = { id: string; desc: string; ts: number; dur: number; snaps: Snap[] };
/** Lo que llevaba el clip de Clipper que se subio como este video (si se sabe). */
export type EditInfo = { layout?: string; captions?: boolean; capStyle?: string; zooms?: number; punches?: number; transition?: boolean; scenes?: number; music?: boolean; fps60?: boolean; hook?: boolean };
export type Group = { key: string; label: string; n: number; median: number; ratio: number };
export type Finding = { text: string; strength: 'fuerte' | 'indicio' };
export type Report = {
  at: number; n: number; mature: number; /** Videos de cuando la cuenta empezaba (antes del primero con 100 vistas): no cuentan. */ warmup: number; totalViews: number; median: number; tz: string;
  top: { id: string; desc: string; views: number; likes: number; at: number; perDay: number }[];
  engagement: { likes: number; comments: number; shares: number; saves: number };
  hours: Group[]; days: Group[]; durations: Group[]; title: Group[]; tags: Group[]; streamers: Group[]; batch: Group[]; edits: Group[];
  findings: Finding[]; next: string[];
};

export const AGE = 24 * 3600;
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const last = (v: TtVideo) => v.snaps[v.snaps.length - 1] || ([0, 0, 0, 0, 0, 0] as Snap);
/** Vistas a las 24 h de publicarse: del historial (interpolando), o las de ahora si no hay datos de entonces. */
export function viewsAtDay(v: TtVideo) {
  const t = v.ts + AGE, s = v.snaps;
  const before = [...s].reverse().find((x) => x[0] <= t), after = s.find((x) => x[0] >= t);
  if (before && after && after[0] > before[0]) return before[1] + ((after[1] - before[1]) * (t - before[0])) / (after[0] - before[0]);
  return (after || before || last(v))[1];
}
export const tagsOf = (d: string) => [...new Set((d.match(/#[\p{L}\p{N}_]+/gu) || []).map((x) => x.toLowerCase()))];
/** El titulo sin hashtags. */
export const titleOf = (d: string) => d.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/\s+/g, ' ').trim();
const EMOJI = /\p{Extended_Pictographic}/u;

/** Agrupa (solo los videos ya maduros) y compara la mediana de cada grupo con la de todos. */
function groups<T>(rows: { v: number; x: T }[], keyOf: (x: T) => string | string[] | null, labelOf: (k: string) => string, order?: string[]): Group[] {
  const all = median(rows.map((r) => r.v)) || 1, by = new Map<string, number[]>();
  for (const r of rows) for (const k of [keyOf(r.x)].flat()) if (k) by.set(k, [...(by.get(k) || []), r.v]);
  const out = [...by].map(([key, vs]) => ({ key, label: labelOf(key), n: vs.length, median: Math.round(median(vs)), ratio: Math.round((median(vs) / all) * 100) / 100 }));
  return order ? out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : out.sort((a, b) => b.median - a.median);
}

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const HOURS = ['0-3', '3-6', '6-9', '9-12', '12-15', '15-18', '18-21', '21-24'];
const DURS = ['<20 s', '20-30 s', '30-45 s', '45-60 s', '>60 s'];
const durKey = (s: number) => (s < 20 ? DURS[0] : s < 30 ? DURS[1] : s < 45 ? DURS[2] : s <= 60 ? DURS[3] : DURS[4]);

/**
 * El informe. `localHour`/`localDay` dan la hora y el dia en el huso del usuario (en el servidor, la hora del PC);
 * `edits` dice como se edito cada video hecho con Clipper; `streamers` son los nombres que se buscan en el texto.
 */
export function analyze(videos: TtVideo[], o: { now: number; tz: string; localHour: (ts: number) => number; localDay: (ts: number) => number; edits?: Record<string, EditInfo>; streamers?: string[] }): Report {
  const vids = [...videos].sort((a, b) => a.ts - b.ts);
  // Una cuenta nueva casi no sale al principio: lo de antes de su primer video con 100 vistas no se compara.
  const start = vids.find((v) => viewsAtDay(v) >= 100)?.ts ?? 0, warm = vids.filter((v) => v.ts < start).length;
  const mature = vids.filter((v) => o.now - v.ts >= AGE && v.ts >= start);
  const rows = mature.map((v) => ({ v: viewsAtDay(v), x: v }));
  const streamers = (o.streamers || []).map((s) => s.toLowerCase().replace(/^@/, '')).filter(Boolean);
  const who = (v: TtVideo) => { const t = v.desc.toLowerCase(); const hit = streamers.filter((s) => t.includes(s)); return hit.length ? hit : null; };
  // Subidos en tanda: a menos de 30 min del anterior.
  const gap = new Map(vids.map((v, i) => [v.id, i ? v.ts - vids[i - 1].ts : Infinity]));
  const tot = (k: number) => vids.reduce((s, v) => s + last(v)[k], 0), views = tot(1) || 1;
  const rep: Report = {
    at: o.now, n: vids.length, mature: mature.length, warmup: warm, totalViews: tot(1), median: Math.round(median(rows.map((r) => r.v))), tz: o.tz,
    top: [...vids].sort((a, b) => last(b)[1] - last(a)[1]).slice(0, 8).map((v) => ({ id: v.id, desc: v.desc, views: last(v)[1], likes: last(v)[2], at: v.ts, perDay: Math.round(last(v)[1] / Math.max(1, (o.now - v.ts) / 86400)) })),
    engagement: { likes: tot(2) / views, comments: tot(3) / views, shares: tot(4) / views, saves: tot(5) / views },
    hours: groups(rows, (v) => HOURS[Math.floor(o.localHour(v.ts) / 3)], (k) => k + ' h', HOURS),
    days: groups(rows, (v) => DAYS[o.localDay(v.ts)], (k) => k, DAYS),
    durations: groups(rows, (v) => durKey(v.dur), (k) => k, DURS),
    title: groups(rows, (v) => {
      const t = titleOf(v.desc), k: string[] = [];
      k.push(!t ? 'sin título (solo hashtags)' : t.length < 25 ? 'título corto (<25)' : t.length <= 50 ? 'título medio (25-50)' : 'título largo (>50)');
      if (/[¿?]/.test(t)) k.push('con pregunta');
      if (/[¡!]/.test(t)) k.push('con exclamación');
      if (EMOJI.test(t)) k.push('con emoji');
      if (t && t === t.toUpperCase() && /\p{L}/u.test(t)) k.push('en MAYÚSCULAS');
      return k;
    }, (k) => k),
    tags: groups(rows, (v) => tagsOf(v.desc), (k) => k).filter((g) => g.n >= 2),
    streamers: groups(rows, who, (k) => k),
    batch: groups(rows, (v) => (gap.get(v.id)! < 1800 ? 'en tanda (<30 min del anterior)' : 'separado'), (k) => k),
    edits: o.edits ? groups(rows.filter((r) => o.edits![r.x.id]), (v) => {
      const e = o.edits![v.id], k: string[] = [];
      if (e.layout) k.push('encuadre: ' + e.layout);
      k.push(e.captions ? 'con subtítulos' : 'sin subtítulos');
      if (e.capStyle && e.captions) k.push('subtítulos: ' + e.capStyle);
      k.push((e.zooms || 0) + (e.punches || 0) ? 'con zooms' : 'sin zooms');
      if (e.transition) k.push('con transición');
      if (e.scenes) k.push('con cambios de cámara');
      if (e.music) k.push('con música');
      if (e.fps60 != null) k.push(e.fps60 ? 'a 60 fps' : 'a 30 fps');
      if (e.hook) k.push('con gancho');
      return k;
    }, (k) => k) : [],
    findings: [] as (Finding & { w: number })[], next: [],
  };
  // Conclusiones: solo grupos con al menos 3 videos, y que se distingan de verdad (x1,5 o x0,67).
  const say = (list: Group[], what: (g: Group) => string) => {
    for (const g of list) {
      if (g.n < 3 || (g.ratio < 1.5 && g.ratio > 0.67)) continue;
      (rep.findings as (Finding & { w: number })[]).push({ text: what(g), strength: g.n >= 6 ? 'fuerte' : 'indicio', w: Math.abs(Math.log(Math.max(0.01, g.ratio))) });
    }
  };
  const x = (g: Group) => (g.ratio >= 1 ? `${g.ratio >= 10 ? Math.round(g.ratio) : String(Math.round(g.ratio * 10) / 10).replace('.', ',')} veces más vistas` : `${Math.round((1 - g.ratio) * 100)} % menos vistas`);
  say(rep.hours, (g) => `Publicado de ${g.label}: ${x(g)} que tu mediana (${g.n} videos).`);
  say(rep.days, (g) => `Publicado en ${g.label}: ${x(g)} (${g.n} videos).`);
  say(rep.durations, (g) => `Videos de ${g.label}: ${x(g)} (${g.n} videos).`);
  say(rep.title, (g) => `Con ${g.label.replace(/^con /, '')}: ${x(g)} (${g.n} videos).`);
  say(rep.tags, (g) => `Con ${g.label}: ${x(g)} (${g.n} videos).`);
  say(rep.streamers, (g) => `Clips de ${g.label}: ${x(g)} (${g.n} videos).`);
  say(rep.batch, (g) => `Subidos ${g.label}: ${x(g)} (${g.n} videos).`);
  say(rep.edits, (g) => `Editados ${g.label}: ${x(g)} (${g.n} videos).`);
  // Las 8 que mas destacan (cuanto se alejan de tu mediana), primero las claras.
  rep.findings = (rep.findings as (Finding & { w: number })[]).sort((a, b) => (a.strength === b.strength ? b.w - a.w : a.strength === 'fuerte' ? -1 : 1)).slice(0, 8).map(({ text, strength }) => ({ text, strength }));
  // Que hacer ahora.
  // Solo se recomienda lo que destaca de verdad (x1,3 sobre tu mediana, con 3 videos o mas).
  const best = (list: Group[]) => list.filter((g) => g.n >= 3 && g.ratio >= 1.3).sort((a, b) => b.median - a.median)[0];
  const bh = best(rep.hours), bd = best(rep.durations), bdays = best(rep.days);
  if (bh) rep.next.push(`Publica entre las ${bh.label.replace(' h', '')} h: es tu mejor franja hasta ahora (mediana ${bh.median.toLocaleString('es')} vistas el primer día, ${bh.n} videos).`);
  if (bdays) rep.next.push(`El ${bdays.label} es tu mejor día (${bdays.n} videos).`);
  if (bd) rep.next.push(`Haz los clips de ${bd.label}: es la duración que mejor te funciona (${bd.n} videos).`);
  const batch = rep.batch.find((g) => g.key.startsWith('en tanda')), sep = rep.batch.find((g) => g.key === 'separado');
  if (batch && sep && batch.n >= 3 && sep.n >= 3 && sep.median > batch.median * 1.3) rep.next.push(`Separa las subidas: los videos subidos en tanda tienen una mediana de ${batch.median.toLocaleString('es')} vistas frente a ${sep.median.toLocaleString('es')} los separados.`);
  if (mature.length < 20) rep.next.push(`Con ${mature.length} videos de más de un día aún son indicios. Desde unos 20-30 las conclusiones se vuelven fiables; sigue subiendo y vuelve a mirar.`);
  return rep;
}

/**
 * Cuando publicar el siguiente video: en la mejor franja si los datos la señalan (`hours` = [desde, hasta) en horas
 * locales), y nunca a menos de `gap` ms de otro video publicado o programado (`busy`, en ms). TikTok solo programa con
 * al menos 15 min de margen y hasta 10 dias; si se puede ya, devuelve null (publicar ahora).
 * `local` da una fecha local a partir de dia, hora y minuto (en el servidor, la hora del PC).
 */
export function nextSlot(now: number, busy: number[], hours: [number, number] | null, local: (base: number, dayOffset: number, h: number, m: number) => number, gap = 3600_000): number | null {
  const ok = (t: number) => busy.every((b) => Math.abs(b - t) >= gap), soon = now + 16 * 60_000;
  if (!hours) {
    if (ok(now)) return null;
    let t = soon;
    for (let i = 0; i < 300 && !ok(t); i++) t += 10 * 60_000;
    return t;
  }
  for (let d = 0; d < 10; d++) for (let h = hours[0]; h < hours[1]; h++) for (const m of [0, 30]) {
    const t = local(now, d, h, m);
    if (t >= soon && ok(t)) return t;
  }
  return nextSlot(now, busy, null, local, gap); // la franja esta llena estos dias: solo separadas
}

/** La franja que mejor funciona, si destaca de verdad (como en «Qué hacer»): [desde, hasta). */
export function bestHours(r: Pick<Report, 'hours'> | null): [number, number] | null {
  const g = (r?.hours || []).filter((x) => x.n >= 3 && x.ratio >= 1.3).sort((a, b) => b.median - a.median)[0];
  const m = g?.key.match(/^(\d+)-(\d+)$/);
  return m ? [+m[1], +m[2]] : null;
}

/** Junta lo leido ahora con el historial (un punto por lectura, como mucho uno cada 30 min por video). */
export function merge(hist: Record<string, TtVideo>, now: { id: string; desc: string; ts: number; dur: number; views: number; likes: number; comments: number; shares: number; saves: number }[], t: number) {
  for (const x of now) {
    const v = (hist[x.id] ||= { id: x.id, desc: x.desc, ts: x.ts, dur: x.dur, snaps: [] });
    v.desc = x.desc || v.desc; v.dur = x.dur || v.dur;
    const s: Snap = [t, x.views, x.likes, x.comments, x.shares, x.saves], p = v.snaps[v.snaps.length - 1];
    if (p && t - p[0] < 1800) v.snaps[v.snaps.length - 1] = s; else v.snaps.push(s);
    if (v.snaps.length > 200) v.snaps.splice(1, v.snaps.length - 200); // se guarda el primero (el arranque)
  }
  return hist;
}
