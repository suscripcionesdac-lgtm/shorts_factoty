import { isKeyword, type CapWord, type Seg, type SfxItem, type Spec, type ZoomItem, type PunchItem } from '../media/spec';
import type { StyleProfile } from './refstyle';
import type { AgentPlan } from './agent';
import { disliked, kindName, kindOf, type Prefs } from '../web/prefs.js';

/**
 * El «director» de la auto edicion, como las ediciones automaticas de los editores de shorts:
 * 1) lee el clip (risas, gritos, sorpresas, reaccion de las caras, ritmo al hablar),
 * 2) decide el tono y con el una receta (subtitulos, zooms, sonidos, transicion),
 * 3) reparte los efectos a ritmo en los momentos de enfasis, alternando y sin amontonarlos.
 * Cada clip tiene su semilla: dos clips distintos salen distintos, y el mismo clip sale siempre igual.
 * Todo es local y sin IA: funciona igual sin conexion.
 */
export type Mood = 'risa' | 'hype' | 'sorpresa' | 'charla';
export type Beat = { t: number; kind: 'risa' | 'grito' | 'clave' | 'reaccion'; w: number; why?: string };
export type Reading = { mood: Mood; beats: Beat[]; scores: Record<Mood, number> };
export type DirectorInput = {
  words: CapWord[];
  /** Volumen del clip, un valor por segundo, ya normalizado (z: 0 = lo normal, 2+ = grito). */
  energyZ: number[];
  dur: number;
  /** Reaccion mas fuerte de las caras: instante, intensidad 0..5 y camara (-1 si no se sabe). */
  react?: { at: number; react: number; cam: number } | null;
  /** Hay varias camaras en el encuadre (para el golpe de reaccion). */
  multiCam: boolean;
  segments?: Seg[];
  hook: boolean;
  sfx: string[];
  /** Estilos de subtitulos disponibles (claves de STYLES). */
  styles: string[];
  /** Semilla de variedad (id del clip). */
  seed: string;
  /** Lo que se uso en el clip anterior de este streamer, para no repetirlo. */
  last?: { style?: string; transition?: string };
  /** Estilo medido en los videos de referencia: manda sobre las recetas en cuantos efectos, cuanto acercan y si hay transicion. */
  style?: StyleProfile | null;
  /** Lo que el usuario conserva o quita al revisar: lo que quita casi siempre no se propone. */
  prefs?: Prefs | null;
  /** Plan del agente editor (IA local): su tono y sus momentos a remarcar mandan sobre lo deducido por reglas. */
  agent?: AgentPlan | null;
  /** Intensidad de la edicion (1 = normal): multiplica los efectos por minuto. Para las propuestas «dinamica» y «sobria». */
  intensity?: number;
};

type Recipe = {
  name: string;
  styles: string[]; anim: Spec['captions']['anim']; perChunk: number[];
  /** Separacion minima entre efectos y cuantos por minuto como mucho. */
  gap: number; perMin: number;
  zoom: [number, number]; zoomLen: [number, number];
  hooks: string[];
  flash: boolean;
};
const RECIPES: Record<Mood, Recipe> = {
  risa: { name: 'risa', styles: ['amarillo', 'impacto', 'neon'], anim: 'pop', perChunk: [2, 3], gap: 2.6, perMin: 14, zoom: [1.22, 1.35], zoomLen: [0.9, 1.6], hooks: ['zoom-punch', 'flash', 'bounce', 'shake'], flash: false },
  hype: { name: 'hype', styles: ['impacto', 'neon', 'amarillo'], anim: 'pop', perChunk: [1, 2], gap: 2.0, perMin: 18, zoom: [1.3, 1.5], zoomLen: [0.6, 1.1], hooks: ['flash-zoom', 'glitch', 'whip-left', 'zoom-through', 'rgb-split'], flash: false },
  sorpresa: { name: 'sorpresa', styles: ['caja', 'recuadro', 'impacto'], anim: 'resaltar', perChunk: [2, 3], gap: 3.2, perMin: 10, zoom: [1.18, 1.32], zoomLen: [1.6, 2.6], hooks: ['zoom-through', 'smoke', 'flash-black', 'spin'], flash: false },
  charla: { name: 'charla', styles: ['limpio', 'cursiva', 'recuadro', 'amarillo'], anim: 'resaltar', perChunk: [3, 2], gap: 4.5, perMin: 8, zoom: [1.1, 1.18], zoomLen: [2.5, 4], hooks: ['fade', 'blur', 'smoothleft', 'light-leak'], flash: false },
};
export const MOOD_NAME: Record<Mood, string> = { risa: 'risa', hype: 'subidón', sorpresa: 'sorpresa', charla: 'charla' };

/** Generador pseudoaleatorio con semilla (mulberry32). */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); const t = (h ^= h >>> 16) >>> 0; return t / 4294967296; };
}
const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');
const LAUGH = /^(?:[jh][aeiou]){2,}[jh]?$|^ja+j|^je+j|^xd+$|^lo+l$|^lmao$/;
const SURPRISE = /^(no+|que+|wtf|como|dios|mierda|what|enserio|nooo+|ay+|uff+|hostia|madre)$/;

/** Lee el clip: momentos de enfasis y tono. */
export function readClip(i: Pick<DirectorInput, 'words' | 'energyZ' | 'dur' | 'react'>): Reading {
  const beats: Beat[] = [];
  let laughs = 0, surprise = 0, bangs = 0;
  for (const w of i.words) {
    if (w.del) continue;
    const t = w.startMs / 1000, n = norm(w.text), bang = /[!¡]/.test(w.text);
    if (bang) bangs++;
    if (LAUGH.test(n)) { laughs++; beats.push({ t, kind: 'risa', w: 2 }); }
    else if (SURPRISE.test(n) && (bang || /[?¿]/.test(w.text) || n.length > 3)) { surprise++; beats.push({ t, kind: 'clave', w: 2 }); }
    else if (isKeyword(w.text)) beats.push({ t, kind: 'clave', w: bang ? 1.6 : 1 });
  }
  // Gritos: segundos claramente mas fuertes que lo normal del clip y mas que sus vecinos.
  let shouts = 0;
  i.energyZ.forEach((z, s) => {
    if (z < 1.8 || z < (i.energyZ[s - 1] ?? -9) || z < (i.energyZ[s + 1] ?? -9)) return;
    shouts++;
    beats.push({ t: s + 0.2, kind: 'grito', w: Math.min(4, z / 1.5) });
  });
  const r = i.react;
  if (r && r.react >= 1.5) beats.push({ t: r.at, kind: 'reaccion', w: 1 + r.react });
  // Varios enfasis casi juntos cuentan como uno (el mas fuerte).
  beats.sort((a, b) => a.t - b.t);
  const merged: Beat[] = [];
  for (const b of beats) {
    if (b.t < 0.3 || b.t > i.dur - 0.5) continue;
    const last = merged[merged.length - 1];
    if (last && b.t - last.t < 0.7) { if (b.w > last.w) merged[merged.length - 1] = b; } else merged.push(b);
  }
  const perMin = 60 / Math.max(10, i.dur);
  const scores: Record<Mood, number> = {
    risa: laughs * 1.6 * perMin,
    hype: (shouts * 0.9 + bangs * 0.35) * perMin + (r && r.react >= 3 ? 2 : 0),
    sorpresa: surprise * 1.3 * perMin + (r && r.react >= 2.5 ? 1.2 : 0),
    charla: 2.2,
  };
  const mood = (Object.keys(scores) as Mood[]).reduce((a, b) => (scores[b] > scores[a] ? b : a), 'charla');
  return { mood, beats: merged, scores };
}

/** Decide la edicion completa del clip a partir de lo que se lee en el. */
export function direct(i: DirectorInput) {
  const read = readClip(i);
  if (i.agent?.mood) read.mood = i.agent.mood;
  const R = RECIPES[read.mood], rand = rng(i.seed);
  const pick = <T>(list: T[], avoid?: T) => { const l = list.length > 1 && avoid != null ? list.filter((x) => x !== avoid) : list; return l[Math.floor(rand() * l.length)] ?? list[0]; };
  const between = ([a, b]: [number, number]) => a + (b - a) * rand();
  const kept = (t: number) => !i.segments?.length || i.segments.some((s) => t >= s.a + 0.1 && t <= s.b - 0.1);
  const patch: Partial<Spec> = {}, done: string[] = [`tono de ${MOOD_NAME[read.mood]}`];
  // Lo que el usuario suele quitar al revisar: no se propone, y se dice una vez por que.
  const told = new Set<string>(), no = (kind: string) => { if (!disliked(i.prefs, kind)) return false; if (!told.has(kind)) { told.add(kind); done.push(`sin ${kindName(kind)}: sueles quitarlo`); } return true; };
  const keep = <T>(list: T[], kind: (x: T) => string) => { const ok = list.filter((x) => !disliked(i.prefs, kind(x))); return ok.length ? ok : list; };

  // Subtitulos con el estilo del tono (distinto al del clip anterior si se puede).
  const style = pick(keep(R.styles.filter((s) => i.styles.includes(s)), kindOf.captions), i.last?.style);
  patch.captions = { style, anim: R.anim, perChunk: pick(R.perChunk), keywords: true } as Spec['captions'];

  // Efectos al ritmo: los enfasis mas fuertes primero, con separacion minima y un tope por minuto.
  // Con un perfil de referencias, cuantos efectos por minuto lo dicen ellas (mas en un subidon, menos en una charla).
  const st = i.style, MUL: Record<Mood, number> = { hype: 1.6, risa: 1.3, sorpresa: 1.2, charla: 0.8 };
  const k = Math.min(2.5, Math.max(0.2, i.intensity ?? 1));
  const perMin = (st ? Math.min(R.perMin, Math.max(1, Math.max(0.8, st.zoomsPerMin) * MUL[read.mood] * 1.5)) : R.perMin) * k;
  const gap = (st ? Math.max(R.gap, (60 / perMin) * 0.5) : R.gap) / Math.sqrt(k);
  const max = Math.max(1, Math.round((perMin * i.dur) / 60));
  if (st) done.push(`estilo aprendido de ${st.n} video${st.n === 1 ? '' : 's'}`);
  const chosen: Beat[] = [];
  const agentBeats = (i.agent?.beats || []).filter((b) => b.kind !== 'sonido' && kept(b.t)).map((b): Beat => ({ t: b.t, kind: b.kind === 'golpe' ? 'reaccion' : 'grito', w: 5, why: b.why }));
  if (agentBeats.length) done.push('momentos elegidos por el agente editor');
  for (const b of [...(agentBeats.length ? agentBeats : read.beats)].filter((x) => kept(x.t)).sort((a, b) => b.w - a.w)) {
    if (chosen.length >= max) break;
    if (chosen.every((c) => Math.abs(c.t - b.t) >= gap)) chosen.push(b);
  }
  // Mas intensidad que momentos fuertes (propuesta «dinamica»): zooms de ritmo en los tramos tranquilos, al empezar
  // frase (o cada pocos segundos si no hay pausas claras), como hace un editor de clips muy movidos.
  if (k > 1.2 && chosen.length < max) {
    const starts = i.words.filter((w, n, a) => !w.del && (n === 0 || w.startMs - a[n - 1].endMs > 350)).map((w) => w.startMs / 1000);
    const grid = Array.from({ length: Math.floor(i.dur / 3) }, (_, n) => 1.5 + n * 3);
    for (const t of [...starts, ...grid]) {
      if (chosen.length >= max) break;
      if (t > 0.3 && t < i.dur - 0.8 && kept(t) && chosen.every((c) => Math.abs(c.t - t) >= gap)) chosen.push({ t, kind: 'clave', w: 0.5, why: 'ritmo' });
    }
  }
  chosen.sort((a, b) => a.t - b.t);
  const zooms: ZoomItem[] = [], punches: PunchItem[] = [];
  const top = chosen.reduce<Beat | null>((m, b) => (!m || b.w > m.w ? b : m), null);
  chosen.forEach((b, n) => {
    // La reaccion mas fuerte con varias camaras: golpe a pantalla completa de esa cara.
    if (b.kind === 'reaccion' && i.react && i.react.cam >= 0 && punches.length < 2 && !no('golpe')) {
      punches.push({ id: 'ap' + n, a: Math.max(0, b.t - 0.3), b: Math.min(i.dur, b.t + 1.2), cam: i.multiCam ? i.react.cam : -1, ...(b.why ? { why: b.why } : {}) });
      return;
    }
    // Alterna zooms cortos y fuertes con otros mas suaves y largos (como un editor que no repite el mismo golpe).
    const strong = b === top || b.kind === 'grito' || (n % 2 === 0 && b.w >= 1.6);
    // El momento mas fuerte se remarca un poco mas, salvo en las charlas, que piden calma.
    // Si las referencias hacen zooms de golpe (acercan mucho de una vez), los fuertes van en esa linea: mas cerca y mas cortos.
    const punchy = !!st && st.zoomScale >= 1.8 && read.mood !== 'charla';
    const scale = strong ? (punchy ? Math.min(1.75, 1 + (st!.zoomScale - 1) * 0.5) : R.zoom[1] + (b === top && read.mood !== 'charla' ? 0.08 : 0)) : between(R.zoom);
    const len = strong ? (punchy ? 0.7 : R.zoomLen[0]) : between(R.zoomLen);
    const a = Math.max(0, b.t - (strong ? 0.12 : 0.35)), z: ZoomItem = { id: 'az' + n, a, b: Math.min(i.dur, a + Math.max(0.5, len)), scale: Math.round(scale * 100) / 100, ...(b.why ? { why: b.why } : {}) };
    if (no(kindOf.zoom(z.scale))) return;
    if (zooms.every((x) => z.a >= x.b + 0.2 || z.b <= x.a - 0.2)) zooms.push(z);
  });
  if (zooms.length) { patch.zooms = zooms; done.push(`${zooms.length} zoom${zooms.length > 1 ? 's' : ''} al ritmo`); }
  if (punches.length) { patch.punches = punches; done.push(`golpe en la reacción`); }

  // Sonidos en los momentos clave, segun el tono.
  const has = (f: string) => i.sfx.includes(f);
  const sfx: SfxItem[] = [];
  const add = (file: string, t: number, vol: number, why?: string) => { if (has(file) && !no(kindOf.sfx(file)) && t >= 0 && t < i.dur && kept(t) && sfx.every((x) => Math.abs(x.t - t) > 0.5)) sfx.push({ id: 'as' + sfx.length, file, t: Math.round(t * 100) / 100, vol, ...(why ? { why } : {}) }); };
  const agentSfx = (i.agent?.beats || []).filter((b) => b.kind === 'sonido');
  const SFX_FOR: Record<Mood, string> = { risa: 'pop.wav', hype: 'boom.wav', sorpresa: 'boom.wav', charla: 'ding.wav' };
  if (agentSfx.length) agentSfx.forEach((b) => add(SFX_FOR[read.mood], b.t, 0.55, b.why));
  else if (top) {
    if (read.mood === 'hype') { add('riser.wav', top.t - 1.4, 0.45); add('boom.wav', top.t, 0.7); }
    else if (read.mood === 'sorpresa') { add('riser.wav', top.t - 1.4, 0.4); add('boom.wav', top.t, 0.55); }
    else if (read.mood === 'risa') chosen.filter((b) => b.kind === 'risa').slice(0, 2).forEach((b) => add('pop.wav', b.t, 0.5));
    else add('ding.wav', top.t, 0.4);
  }
  // Un barrido en algun corte de en medio (no en todos: los clips buenos casi siempre cortan en seco).
  const cuts = (i.segments || []).slice(1).map((s) => s.a);
  if (cuts.length && read.mood !== 'charla') add('whoosh.wav', cuts[Math.floor(rand() * cuts.length)], 0.35);
  if (sfx.length) { patch.sfx = sfx; done.push(`${sfx.length} sonido${sfx.length > 1 ? 's' : ''}`); }

  // Transicion: solo la del gancho, segun el tono.
  // Con referencias, solo con la frecuencia con que ellas usan transiciones (casi siempre cortan en seco).
  const useTrans = !st || rand() < Math.min(0.9, Math.max(0.1, st.transRatio * 4));
  if (i.hook && useTrans) {
    patch.transition = pick(keep(R.hooks, kindOf.transition), i.last?.transition);
    patch.transDur = read.mood === 'charla' ? 0.45 : read.mood === 'sorpresa' ? 0.5 : 0.3;
    done.push('transición en el gancho');
  }
  // En los cortes nunca: los clips que funcionan cortan en seco, y la misma transicion en cada corte cansa.
  patch.transCuts = false;
  patch.flash = R.flash;
  // Sin barra de progreso: los canales de clips que crecen no la usan (y se puede poner a mano en «Acabado»).
  patch.progress = false;
  return { patch, done, read };
}
