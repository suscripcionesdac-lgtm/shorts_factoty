import type { Word } from '../../shared/timing';
import { phrasesOf } from './agent';
import { zscores } from './detect';
import { readClip, MOOD_NAME, type Mood } from './director';
import { summarizeStyle, type StyleEvents, type StyleProfile, type StyleSample } from './refstyle';

/**
 * Escuela del agente editor: aprende a editar mirando shorts que funcionan, de cualquier tema (streamers, podcast,
 * entrevistas, humor...). De cada video se mide cuando corta, cuando hace zoom y como empieza, y se cruza con lo que se
 * dice: «tras un grito, zoom a los 0,4 s», «los cortes caen en las pausas», «empieza con una pregunta». El video se borra;
 * solo se guardan esas medidas. Las lecciones (ponderadas por vistas) llegan al agente y al director en cada auto edicion.
 * Aqui solo hay funciones puras; la busqueda y descarga esta en engine.ts.
 */

/** Temas que se estudian: contenido que se monetiza en shorts. Las busquedas rotan para ver de todo. */
export const TOPICS: { topic: string; q: string[] }[] = [
  { topic: 'streamers', q: ['clips streamers español', 'mejores momentos directo twitch', 'clip viral kick español'] },
  { topic: 'podcast', q: ['podcast clips español', 'mejores momentos podcast', 'podcast viral español'] },
  { topic: 'entrevistas', q: ['entrevista clip viral español', 'entrevista calle preguntas', 'entrevista famosos momento'] },
  { topic: 'humor', q: ['humor español shorts', 'comedia stand up español', 'bromas español'] },
  { topic: 'historias', q: ['storytime español', 'historia increible me paso', 'anecdota graciosa'] },
  { topic: 'deporte', q: ['futbol clips viral español', 'momentos deporte increibles', 'reaccion gol narrador'] },
  { topic: 'negocios', q: ['emprendimiento consejos shorts', 'finanzas personales consejos', 'ventas negocio podcast'] },
  { topic: 'gaming', q: ['gaming clips español', 'momentos graciosos videojuegos', 'minecraft español shorts'] },
  { topic: 'curiosidades', q: ['sabias que datos curiosos', 'curiosidades español shorts', 'explicacion ciencia corta'] },
];

export type HookKind = 'pregunta' | 'exclamacion' | 'afirmacion' | 'sin voz';
export const HOOK_NAME: Record<HookKind, string> = { pregunta: 'una pregunta', exclamacion: 'una exclamación', afirmacion: 'una afirmación directa', 'sin voz': 'imagen sin hablar' };

/** Lo que se guarda de cada video estudiado (nada del video en si). */
export type Case = {
  id: string; title: string; views: number; topic: string; at: string;
  style: StyleSample; mood: Mood; wps: number;
  /** Como empieza: la primera frase, de que tipo es y cuanto dura el primer plano. */
  hook: { text: string; kind: HookKind; shot: number };
  /** Momentos fuertes (gritos, risas, palabras clave) y cuantos llevan zoom o corte justo despues. */
  peaks: number; peakZoom: number; peakCut: number; delays: number[];
  /** Cortes secos y cuantos caen en una pausa (no a mitad de palabra). */
  cuts: number; cutPause: number;
  /** Lo eligio el usuario (pego el enlace): un ejemplo de lo que le gusta, pesa mas. */
  mine?: boolean;
};

const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100;
const QUESTION = /^(que|qué|como|cómo|por que|por qué|cuanto|cuánto|cual|cuál|quien|quién|donde|dónde|sabias|sabías|alguna vez|y si)\b/i;

/** Estudia un video: cruza su edicion (cortes, zooms) con lo que se dice y con el volumen. */
export function studyCase(o: { id: string; title: string; views: number; topic: string; ev: StyleEvents; words: Word[]; energy: number[]; mine?: boolean }): Case {
  const { ev, words } = o, dur = Math.max(1, ev.seconds);
  const reading = readClip({ words, energyZ: o.energy.length ? zscores(o.energy) : [], dur, react: null });
  // Gancho: la primera frase (si se habla en los 3 primeros segundos).
  const first = phrasesOf(words)[0];
  const text = first && first.a < 3 ? first.text.replace(/\s+/g, ' ').trim().slice(0, 90) : '';
  const startZ = o.energy.length ? Math.max(...zscores(o.energy).slice(0, 2)) : 0;
  const kind: HookKind = !text ? 'sin voz' : /[?¿]/.test(text) || QUESTION.test(text) ? 'pregunta' : /[!¡]/.test(text) || startZ >= 1.5 ? 'exclamacion' : 'afirmacion';
  const hard = ev.changes.filter((c) => !c.gradual);
  // Momentos fuertes: los que el director tambien remarcaria.
  const peaks = reading.beats.filter((b) => b.kind !== 'clave' || b.w >= 1.6);
  let peakZoom = 0, peakCut = 0;
  const delays: number[] = [];
  for (const b of peaks) {
    const z = ev.zooms.find((x) => x.t >= b.t - 0.3 && x.t <= b.t + 1.5);
    if (z) { peakZoom++; delays.push(r1(Math.max(0, z.t - b.t))); }
    if (hard.some((c) => Math.abs(c.t - b.t) <= 0.6)) peakCut++;
  }
  // Un corte cae en una pausa si ninguna palabra se esta diciendo en ese instante (el hueco entre dos palabras
  // seguidas, de unas decimas, no es una pausa).
  const speaking = (t: number) => words.some((w) => w.startMs / 1000 - 0.06 < t && w.endMs / 1000 + 0.06 > t);
  const spoken = words.length ? hard.filter((c) => c.t > (words[0].startMs / 1000) && c.t < words[words.length - 1].endMs / 1000) : [];
  return {
    id: o.id, title: o.title.slice(0, 100), views: o.views, topic: o.topic, at: new Date().toISOString(), ...(o.mine ? { mine: true } : {}),
    style: summarizeStyle(ev), mood: reading.mood, wps: r1(words.length / dur),
    hook: { text, kind, shot: r1(ev.changes[0]?.t ?? dur) },
    peaks: peaks.length, peakZoom, peakCut, delays,
    cuts: spoken.length, cutPause: spoken.filter((c) => !speaking(c.t)).length,
  };
}

/** Lo aprendido de un grupo de videos. Los mas vistos pesan mas. */
export type Lesson = {
  n: number; views: number; style: StyleProfile;
  /** De cada momento fuerte, que parte lleva zoom, a cuantos segundos, y que parte lleva un corte. */
  peakZoom: number | null; delay: number | null; peakCut: number | null;
  /** Parte de los cortes (durante la voz) que caen en una pausa. */
  cutPause: number | null;
  hooks: Partial<Record<HookKind, number>>; hookShot: number; wps: number;
  examples: { text: string; views: number; topic: string }[];
};
export type Knowledge = { n: number; at: string; topics: Record<string, number>; all: Lesson; byMood: Partial<Record<Mood, Lesson>> };

/** Peso de un video: el logaritmo de sus vistas (un video de 10 M no vale 100 veces uno de 100 mil, pero si mas). */
// Lo que elige el usuario pesa como un video de unos 30 M de vistas (o mas, si lo tiene): es lo que quiere imitar.
const weight = (c: Case) => { const w = Math.max(1, Math.log10(Math.max(10, c.views)) - 3); return c.mine ? Math.max(4.5, w * 1.5) : w; };
function wmedian(list: [number, number][]) {
  const s = list.filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]), tot = s.reduce((t, [, w]) => t + w, 0);
  let acc = 0;
  for (const [v, w] of s) { acc += w; if (acc >= tot / 2) return v; }
  return 0;
}
/** Proporcion ponderada: suma de aciertos entre suma de casos (null si casi no hay casos). */
function wratio(cs: Case[], hit: (c: Case) => number, of: (c: Case) => number) {
  let h = 0, n = 0, raw = 0;
  for (const c of cs) { const w = weight(c); h += hit(c) * w; n += of(c) * w; raw += of(c); }
  return raw >= 5 ? r2(h / n) : null;
}

function lessonOf(cs: Case[]): Lesson {
  const W = (f: (c: Case) => number) => wmedian(cs.map((c) => [f(c), weight(c)]));
  const edited = cs.filter((c) => c.style.cutsPerMin > 0), zoomed = cs.filter((c) => c.style.zoomsPerMin > 0);
  const wmean = (f: (c: Case) => number) => { const t = cs.reduce((s, c) => s + weight(c), 0); return cs.reduce((s, c) => s + f(c) * weight(c), 0) / t; };
  const loud = cs.filter((c) => c.style.lufs != null);
  const style: StyleProfile = {
    n: cs.length, edited: r2(edited.length / cs.length), seconds: Math.round(W((c) => c.style.seconds)),
    cutsPerMin: r1(wmedian(edited.map((c) => [c.style.cutsPerMin, weight(c)]))), shotMed: r1(wmedian(edited.map((c) => [c.style.shotMed, weight(c)]))),
    transRatio: r2(wmean((c) => c.style.transRatio)), zoomsPerMin: r1(wmean((c) => c.style.zoomsPerMin)),
    zoomScale: zoomed.length ? r2(wmedian(zoomed.map((c) => [c.style.zoomScale, weight(c)]))) : 1,
    lufs: loud.length ? r1(wmedian(loud.map((c) => [c.style.lufs!, weight(c)]))) : null,
  };
  const hooks: Lesson['hooks'] = {}, tw = cs.reduce((s, c) => s + weight(c), 0);
  for (const c of cs) hooks[c.hook.kind] = (hooks[c.hook.kind] || 0) + weight(c) / tw;
  for (const k of Object.keys(hooks) as HookKind[]) hooks[k] = r2(hooks[k]!);
  const delays = cs.flatMap((c) => c.delays.map((d) => [d, weight(c)] as [number, number]));
  return {
    n: cs.length, views: Math.round(W((c) => c.views)), style,
    peakZoom: wratio(cs, (c) => c.peakZoom, (c) => c.peaks), delay: delays.length >= 5 ? r1(wmedian(delays)) : null,
    peakCut: wratio(cs, (c) => c.peakCut, (c) => c.peaks), cutPause: wratio(cs, (c) => c.cutPause, (c) => c.cuts),
    hooks, hookShot: r1(W((c) => c.hook.shot)), wps: r1(W((c) => c.wps)),
    examples: [...cs].filter((c) => c.hook.text.split(' ').length >= 3).sort((a, b) => b.views - a.views).slice(0, 4).map((c) => ({ text: c.hook.text, views: c.views, topic: c.topic })),
  };
}

/** Un tono necesita al menos estos videos para tener lecciones propias; si no, se usan las de todos. */
export const MIN_MOOD = 6;
/** Todo lo aprendido. Hacen falta al menos 3 videos. */
export function learnFrom(cases: Case[]): Knowledge | null {
  if (cases.length < 3) return null;
  const topics: Record<string, number> = {};
  for (const c of cases) topics[c.topic] = (topics[c.topic] || 0) + 1;
  const byMood: Knowledge['byMood'] = {};
  for (const m of ['risa', 'hype', 'sorpresa', 'charla'] as Mood[]) { const cs = cases.filter((c) => c.mood === m); if (cs.length >= MIN_MOOD) byMood[m] = lessonOf(cs); }
  return { n: cases.length, at: new Date().toISOString(), topics, all: lessonOf(cases), byMood };
}
export const lessonFor = (k: Knowledge | null, mood?: Mood) => (k ? (mood && k.byMood[mood]) || k.all : null);

const pct = (v: number) => Math.round(v * 100) + ' %';
const num = (v: number) => String(v).replace('.', ',');
export const fmtViews = (v: number) => (v >= 1e6 ? num(r1(v / 1e6)) + ' M' : v >= 1e3 ? Math.round(v / 1e3) + ' mil' : String(v));

/** Las lecciones en frases cortas: para el agente (en su encargo) y para que el usuario vea lo aprendido. */
export function lessonLines(k: Knowledge | null, mood?: Mood): string[] {
  const l = lessonFor(k, mood);
  if (!k || !l) return [];
  const own = mood && k.byMood[mood] === l;
  const out = [`Aprendido de ${l.n} shorts que funcionan${own ? ` con tono de ${MOOD_NAME[mood!]}` : ''} (mediana ${fmtViews(l.views)} vistas).`];
  out.push(`Duran unos ${l.style.seconds} s y cambian de plano cada ${num(l.style.shotMed)} s; ${pct(l.style.transRatio)} de los cambios son transiciones, el resto cortes secos.`);
  if (l.peakZoom != null) out.push(`Tras un grito, una risa o la frase clave, ${pct(l.peakZoom)} de las veces hay zoom${l.delay != null ? ` (a los ${num(l.delay)} s)` : ''}${l.peakCut != null ? ` y ${pct(l.peakCut)} un corte` : ''}.`);
  if (l.style.zoomsPerMin > 0) out.push(`Hacen ${num(l.style.zoomsPerMin)} zooms por minuto, de x${num(l.style.zoomScale)}.`);
  if (l.cutPause != null) out.push(`${pct(l.cutPause)} de los cortes caen en una pausa, no a mitad de palabra.`);
  const hk = (Object.entries(l.hooks) as [HookKind, number][]).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 0.1);
  if (hk.length) out.push(`Empiezan con ${hk.map(([h, v]) => `${HOOK_NAME[h]} (${pct(v)})`).join(', ')}; el primer plano dura ${num(l.hookShot)} s.`);
  return out;
}
/** Ganchos reales de los mas vistos, como ejemplo para el agente. */
export const hookExamples = (k: Knowledge | null, mood?: Mood) => (lessonFor(k, mood)?.examples || []).map((e) => `«${e.text}» (${fmtViews(e.views)} vistas, ${e.topic})`);

/**
 * Que buscar ahora: el tema menos estudiado y, dentro, la busqueda que toca. Asi se ve de todo y no solo lo primero.
 * `extra` son los streamers del usuario, que tambien cuentan como tema.
 */
export function nextSearch(cases: Case[], round: number, extra: string[] = []) {
  const topics = [...TOPICS, ...(extra.length ? [{ topic: 'tus streamers', q: extra.map((s) => `${s} clips`) }] : [])];
  const count = (t: string) => cases.filter((c) => c.topic === t).length;
  const t = [...topics].sort((a, b) => count(a.topic) - count(b.topic) || a.topic.localeCompare(b.topic))[0];
  return { topic: t.topic, q: t.q[round % t.q.length] };
}

const ES = new Set('el la los las un una de del que y en es se no por con para lo le me mi su como pero cuando porque este esta esto muy mas más ya yo tu te nos al si así asi todo nada nunca siempre hoy aqui aquí'.split(' '));
const EN = new Set('the and you your my is are of with this that what how when why to for it in on was he she they we be have just'.split(' '));
/**
 * El titulo no esta claramente en ingles (dos o mas palabras tipicas del ingles y menos del español). Los ganchos y la
 * transcripcion (forzada a español) solo sirven de videos en español. Es indulgente a proposito: las busquedas ya son
 * en español, y YouTube a veces traduce al ingles el titulo de un video en español.
 */
export function looksSpanish(title: string) {
  const w = title.toLowerCase().replace(/#\S+/g, ' ').split(/[^\p{L}]+/u).filter(Boolean);
  const es = w.filter((x) => ES.has(x)).length + (/[ñ¿¡áéíóú]/i.test(title) ? 1 : 0), en = w.filter((x) => EN.has(x)).length;
  return !(en >= 2 && en > es);
}
/** De los resultados de una busqueda, los que vale la pena estudiar: shorts (hasta 3 min) en español con vistas que aun no se han visto. */
export function pickVideos<T extends { id: string; title: string; views: number; seconds: number }>(list: T[], tried: Set<string>, n: number, minViews = 50_000) {
  // Duracion 0: no se sabe (TikTok no la da en la lista); se comprueba al descargarlo.
  return list.filter((x) => x.id && !tried.has(x.id) && (x.seconds === 0 || (x.seconds >= 8 && x.seconds <= 180)) && x.views >= minViews && looksSpanish(x.title)).sort((a, b) => b.views - a.views).slice(0, n);
}

// ---------- TikTok, con la sesion del usuario ----------
// TikTok no deja listar videos sin sesion. El usuario inicia sesion el mismo en una ventana de Clipper (ver tiktok.ts) y
// con ella se miran los creadores y hashtags que elige. Va despacio: TikTok limita a las cuentas que ven muchos videos
// de forma automatica.
export type TikTokCfg = { creators: string[]; tags: string[] };
/** Como mucho, TikToks al dia en automatico. */
export const TIKTOK_DAY = 12;
/** «@uno, https://www.tiktok.com/@dos/video/1» → ['uno', 'dos']; «#podcast humor» → ['podcast', 'humor']. */
export function parseHandles(v: string | string[] | undefined, kind: 'creator' | 'tag') {
  const parts = (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
  const out = parts.map((x) => {
    const m = x.match(kind === 'creator' ? /tiktok\.com\/@([\w.]+)/i : /tiktok\.com\/tag\/([^/?#\s]+)/i);
    return (m ? m[1] : x).replace(kind === 'creator' ? /^@/ : /^#/, '').toLowerCase();
  }).filter((x) => (kind === 'creator' ? /^[\w.]{2,24}$/ : /^[\p{L}\p{N}_]{2,40}$/u).test(x));
  return [...new Set(out)].slice(0, 20);
}
export function cleanTiktok(p: { creators?: string | string[]; tags?: string | string[] } | undefined): TikTokCfg {
  return { creators: parseHandles(p?.creators, 'creator'), tags: parseHandles(p?.tags, 'tag') };
}
/** «1.2M», «12,3 K», «850.4K», «1,2 M», «15 mil», «9876» → numero de vistas. */
export function parseCount(s: string) {
  const m = String(s || '').replace(/\s+/g, '').match(/^([\d.,]+)(mill|mil|k|m|b)?/i);
  if (!m) return 0;
  const suf = (m[2] || '').toLowerCase(), mul = suf === 'k' || suf === 'mil' ? 1e3 : suf === 'm' || suf === 'mill' ? 1e6 : suf === 'b' ? 1e9 : 1;
  // Con sufijo, la coma o el punto son decimales; sin el, son separadores de miles.
  const n = mul > 1 ? parseFloat(m[1].replace(',', '.')) : parseFloat(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * mul) : 0;
}
/** Que pagina de TikTok toca mirar ahora: rota por creadores y hashtags. */
export function nextTiktok(cfg: TikTokCfg | undefined, round: number) {
  const all = [...(cfg?.creators || []).map((c) => ({ topic: 'tiktok @' + c, url: `https://www.tiktok.com/@${c}` })), ...(cfg?.tags || []).map((t) => ({ topic: 'tiktok #' + t, url: `https://www.tiktok.com/tag/${encodeURIComponent(t)}` }))];
  return all.length ? all[round % all.length] : null;
}

/** Como mucho se guardan estos videos: si hay mas, salen los menos vistos (de los temas con mas videos). */
export const MAX_CASES = 600;
export function keepBest(cases: Case[]) {
  if (cases.length <= MAX_CASES) return cases;
  const out = [...cases];
  while (out.length > MAX_CASES) {
    const counts = new Map<string, number>();
    for (const c of out) counts.set(c.topic, (counts.get(c.topic) || 0) + 1);
    const big = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    let worst = -1;
    out.forEach((c, i) => { if (c.topic === big && (worst < 0 || c.views < out[worst].views)) worst = i; });
    out.splice(worst, 1);
  }
  return out;
}

/** Enlaces de videos pegados por el usuario (TikTok, YouTube, Instagram), sin repetir; como mucho 50. */
export function parseLinks(text: string) {
  const urls = String(text || '').match(/https?:\/\/[^\s<>"']+/g) || [];
  const ok = urls.map((u) => u.replace(/[),.;]+$/, '')).filter((u) => /^https?:\/\/([\w-]+\.)*(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\//i.test(u));
  return [...new Set(ok)].slice(0, 50);
}
