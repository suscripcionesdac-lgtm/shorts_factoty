import type { CapWord, Seg } from '../media/spec';
import type { Beat, Mood } from './director';
import { chat } from '../ai/llm';

/**
 * Agente editor: un modelo de lenguaje local (Ollama, gratis) lee la transcripcion como un editor de shorts y decide
 * lo que las reglas no pueden: que frase engancha, que frases sobran para la historia, donde esta el remate que hay
 * que remarcar y que palabras resaltar. No da tiempos: elige frases numeradas, y aqui se convierten en tiempos exactos
 * (asi no puede inventarse un instante). Todo lo que devuelve pasa por la red de seguridad de `checkPlan`.
 */
export type Phrase = { i: number; a: number; b: number; text: string };
export type AgentBeat = { t: number; kind: 'zoom' | 'golpe' | 'sonido'; why: string; word?: string };
export type AgentPlan = {
  mood?: Mood;
  hook?: { seg: Seg; why: string };
  drop: { seg: Seg; why: string }[];
  beats: AgentBeat[];
  highlight: string[];
  title?: string;
};

export const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');
const f1 = (n: number) => n.toFixed(1);

/** Agrupa las palabras en frases: corta en las pausas, en el final de frase o a las 14 palabras. */
export function phrasesOf(words: CapWord[]): Phrase[] {
  const out: Phrase[] = [];
  let cur: CapWord[] = [];
  const close = () => { if (cur.length) out.push({ i: out.length + 1, a: cur[0].startMs / 1000, b: cur[cur.length - 1].endMs / 1000, text: cur.map((w) => w.text).join(' ') }); cur = []; };
  for (const w of words.filter((x) => !x.del && x.text.trim())) {
    const prev = cur[cur.length - 1];
    if (!/[\p{L}\p{N}]/u.test(w.text)) { if (prev) { prev.text += w.text; prev.endMs = w.endMs; } continue; } // «?» suelto: se pega a la palabra anterior
    if (prev && (w.startMs - prev.endMs > 450 || /[.!?¿¡]$/.test(prev.text) || cur.length >= 14)) close();
    cur.push({ ...w });
  }
  close();
  // La transcripcion a veces repite una frase entera: la copia se junta con la original.
  const dedup: Phrase[] = [];
  for (const p of out) { const last = dedup[dedup.length - 1]; if (last && last.text === p.text) last.b = p.b; else dedup.push({ ...p, i: dedup.length + 1 }); }
  return dedup;
}

/** El encargo para el modelo: la transcripcion por frases, las señales medidas y lo que se espera. */
export function buildPrompt(o: { phrases: Phrase[]; beats: Beat[]; dur: number; streamer?: string; maxBeats: number; style?: string; lessons?: string[]; hooks?: string[] }) {
  const system = `Eres un editor experto de clips virales en español (TikTok, Shorts, Reels): streamers, podcast, entrevistas, humor, historias.
Recibes la transcripcion de un clip dividida en frases numeradas, con su tiempo, y señales medidas (gritos, risas, reacciones de la cara).
Si te llega LO APRENDIDO (medido en shorts reales que funcionan), usalo: es como editan los que tienen mas vistas.
Decide como lo editaria un profesional:
- "gancho": el numero de UNA frase de MAS ADELANTE en el clip (no de los primeros segundos) que se pondra tambien al principio, como avance: el momento mas fuerte, sorprendente o gracioso, que se entienda solo. Si no hay ninguno claro, null.
- "quitar": como mucho 3 frases LARGAS que sobran de verdad (divagaciones, repeticiones, leer el chat sin gracia). Nunca la preparacion de un chiste o de una reaccion (lo que pasa justo antes), ni el remate, ni el gancho, ni exclamaciones cortas («¿qué?», «perdón»): cortar cosas cortas trocea el clip.
- "remarcar": como mucho ${o.maxBeats} momentos clave (el remate del chiste, la reaccion, la palabra que lo cambia todo), con la "palabra" exacta de esa frase (una palabra de verdad, no un signo) y el tipo: "zoom" (acercamiento), "golpe" (cara a pantalla completa en una reaccion) o "sonido".
- "resaltar": hasta 6 palabras de la transcripcion que deben destacar en los subtitulos.
- "tono": "risa" solo si hay risas o un chiste claro; "subidon" si hay gritos o emocion; "sorpresa" si hay un susto o giro; si no, "charla".
- "titulo": titulo de hasta 60 caracteres, sin clickbait falso.
Responde SOLO con JSON:
{"tono":"...","gancho":{"frase":N,"por_que":"..."},"quitar":[{"frase":N,"por_que":"..."}],"remarcar":[{"frase":N,"palabra":"...","tipo":"zoom|golpe|sonido","por_que":"..."}],"resaltar":["..."],"titulo":"..."}
Los "por_que" son frases cortas en español, como se las dirias al creador.`;
  const sig = o.beats.length ? o.beats.map((b) => `${f1(b.t)} s: ${b.kind === 'grito' ? 'grito' : b.kind === 'risa' ? 'risa' : b.kind === 'reaccion' ? 'reaccion fuerte de la cara' : 'palabra clave'}`).join('\n') : '(ninguna)';
  const learned = o.lessons?.length ? `\nLO APRENDIDO:\n${o.lessons.map((l) => '- ' + l).join('\n')}${o.hooks?.length ? '\nGanchos que funcionaron:\n' + o.hooks.map((h) => '- ' + h).join('\n') : ''}\n` : '';
  const user = `Clip de ${f1(o.dur)} s${o.streamer ? ' de ' + o.streamer : ''}.${o.style ? ' Estilo de referencia: ' + o.style + '.' : ''}
${learned}
FRASES:
${o.phrases.map((p) => `[${p.i}] ${f1(p.a)}–${f1(p.b)} s: ${p.text}`).join('\n')}

SEÑALES:
${sig}`;
  return { system, user };
}

/** Palabras sin contenido: no vale la pena resaltarlas en los subtitulos. */
const EMPTY = new Set('que mas oh ah eh pues bueno vale osea esto eso esta este como para pero porque cuando donde muy tan nos les los las del con por una uno unos unas sus mis tus ese esa asi ahi aqui alli tio tia'.split(' '));
const MOODS: Record<string, Mood> = { risa: 'risa', subidon: 'hype', subidón: 'hype', hype: 'hype', sorpresa: 'sorpresa', charla: 'charla' };

/**
 * Red de seguridad: convierte la respuesta del modelo en un plan valido o la descarta por partes. Frases que no existen,
 * tipos desconocidos, quitar el gancho o el remate, quitar mas de una cuarta parte, remarcar demasiado o demasiado
 * junto: todo eso se ignora. Lo que queda es seguro de aplicar.
 */
export function checkPlan(raw: unknown, phrases: Phrase[], words: CapWord[], dur: number, maxBeats: number, minGap = 1.8): AgentPlan {
  const j = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const byI = new Map(phrases.map((p) => [p.i, p]));
  const ph = (n: unknown) => byI.get(Math.round(Number(n)));
  const why = (x: any) => String(x?.por_que || x?.why || '').trim().slice(0, 120);
  const plan: AgentPlan = { drop: [], beats: [], highlight: [] };
  plan.mood = MOODS[norm(String(j.tono || ''))] || MOODS[String(j.tono || '').toLowerCase()];
  // Gancho: la frase elegida, entre 1,5 y 3,5 s.
  // Gancho: un momento de mas adelante que se adelanta (empezar por la primera frase no es un gancho).
  const g0 = ph(j.gancho?.frase ?? j.gancho), g = g0 && g0.a >= 4 ? g0 : undefined;
  if (g) plan.hook = { seg: { a: Math.max(0, g.a - 0.15), b: Math.min(dur, Math.max(g.b + 0.25, g.a + 1.5), g.a + 3.5) }, why: why(j.gancho) || 'la frase más fuerte para empezar' };
  // Remarcar: en la palabra exacta si esta en la frase; si no, a mitad de la frase.
  const live = words.filter((w) => !w.del);
  for (const r of Array.isArray(j.remarcar) ? j.remarcar : []) {
    const p = ph(r?.frase), kind = ['zoom', 'golpe', 'sonido'].includes(r?.tipo) ? (r.tipo as AgentBeat['kind']) : null;
    if (!p || !kind || plan.beats.length >= maxBeats) continue;
    const want = norm(String(r.palabra || ''));
    const w = want ? live.find((x) => x.startMs / 1000 >= p.a - 0.05 && x.endMs / 1000 <= p.b + 0.05 && norm(x.text) === want) : undefined;
    const t = w ? w.startMs / 1000 : (p.a + p.b) / 2;
    if (plan.beats.some((b) => Math.abs(b.t - t) < minGap)) continue;
    plan.beats.push({ t, kind, why: why(r) || 'momento clave', word: w?.text });
  }
  plan.beats.sort((a, b) => a.t - b.t);
  // Quitar: como mucho 3 frases de 1,2 s o mas (cortar exclamaciones cortas trocea el clip); nunca el gancho, ni una
  // frase con un momento remarcado, ni la preparacion (lo que termina en los 6 s anteriores); como mucho un cuarto del clip.
  const keepT = [...plan.beats.map((b) => b.t), ...(g ? [g.a] : [])];
  let removed = 0;
  for (const q of Array.isArray(j.quitar) ? j.quitar : []) {
    const p = ph(q?.frase);
    if (!p || p === g || plan.drop.length >= 3 || p.b - p.a < 1.2 || plan.drop.some((d) => d.seg.a === p.a)) continue;
    if (keepT.some((t) => (t >= p.a - 0.1 && t <= p.b + 0.1) || (p.b <= t + 0.1 && t - p.b < 6))) continue;
    if (removed + (p.b - p.a) > dur * 0.25 || /prepar|contexto necesario|antes del (chiste|remate)/i.test(why(q))) continue;
    removed += p.b - p.a;
    plan.drop.push({ seg: { a: p.a, b: p.b }, why: why(q) || 'no aporta a la historia' });
  }
  plan.drop.sort((a, b) => a.seg.a - b.seg.a);
  const vocab = new Set(live.map((w) => norm(w.text)));
  plan.highlight = [...new Set((Array.isArray(j.resaltar) ? j.resaltar : []).map((x: unknown) => norm(String(x))).filter((x: string) => x.length >= 2 && !EMPTY.has(x) && vocab.has(x)))].slice(0, 6) as string[];
  const title = String(j.titulo || '').trim();
  if (title) plan.title = title.slice(0, 70);
  return plan;
}

/** Quita del montaje los tramos que el agente dice que sobran, sin dejar trozos sueltos de menos de `minSeg` s. */
export function dropFromSegments(segs: Seg[], drops: Seg[], minSeg = 1.5): Seg[] {
  let out = segs.map((s) => ({ ...s }));
  for (const d of drops) out = out.flatMap((s) => (d.b <= s.a || d.a >= s.b ? [s] : [...(d.a > s.a ? [{ a: s.a, b: d.a }] : []), ...(d.b < s.b ? [{ a: d.b, b: s.b }] : [])]));
  return out.filter((s) => s.b - s.a >= minSeg);
}

/** Pide el plan al modelo local. Si no hay IA, tarda demasiado o responde algo inservible, devuelve null. */
export async function planEdit(o: { words: CapWord[]; beats: Beat[]; dur: number; streamer?: string; maxBeats: number; style?: string; lessons?: string[]; hooks?: string[] }): Promise<AgentPlan | null> {
  const phrases = phrasesOf(o.words);
  if (phrases.length < 2) return null;
  const { system, user } = buildPrompt({ ...o, phrases });
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await chat(system, user, { temperature: attempt ? 0.2 : 0.4, timeoutMs: 180_000, smart: true });
      return checkPlan(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)), phrases, o.words, o.dur, o.maxBeats);
    } catch (e) { if (attempt >= 1 || /timeout|aborted/i.test((e as Error).message)) throw e; }
  }
}

/**
 * Para condensar (ver condense.ts): el modelo elige que frases cuentan la historia en unos `target` segundos. Devuelve
 * los numeros de frase o null (sin IA, si tarda o si responde algo inservible; entonces mandan las reglas).
 */
export async function pickPhrases(phrases: Phrase[], target: number, streamer = ''): Promise<number[] | null> {
  if (phrases.length < 3) return null;
  const system = `Eres un editor experto de shorts en español. Te dan la transcripcion de un tramo largo${streamer ? ' de ' + streamer : ''}, en frases numeradas con su duracion.
Elige las frases que forman un short de unos ${Math.round(target)} segundos que se entienda solo: el momento mas fuerte (el remate, la reaccion, el giro), con lo justo de antes para entenderlo (la preparacion). Quita lo que sobra: divagaciones, leer el chat sin gracia, repeticiones.
Mantente cerca de ${Math.round(target)} segundos sumando las duraciones. Responde SOLO con JSON: {"frases":[N,N,...],"por_que":"una frase corta"}`;
  const user = phrases.map((p) => `[${p.i}] (${(p.b - p.a).toFixed(1)} s) ${p.text}`).join('\n');
  try {
    const raw = await chat(system, user, { temperature: 0.3, timeoutMs: 120_000 });
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const ids = (Array.isArray(j.frases) ? j.frases : []).map((x: unknown) => Math.round(Number(x))).filter((n: number) => phrases.some((p) => p.i === n));
    return ids.length ? [...new Set(ids as number[])] : null;
  } catch { return null; }
}
