/** Subtitulos: correccion, titulos y traduccion con IA. */
import { applyText, type CapWord } from '../media/spec';
import { aiFix, applyFixes, countChanges, ruleFix } from '../media/subfix';
import { chat as llmChat, llmName } from '../ai/llm';
import { localTitles, trendHashtags } from '../analysis/trends';
import { HYPE } from '../analysis/detect';
import { key, log, save, settings, type Source, sources } from './core';
import { src } from './preview';
import { trendFor } from './profile';
import { ownBestTitles } from './publish';

// ---------- correccion de subtitulos ----------
const namesFor = (streamer: string) => [...new Set([...(settings.profiles[key(streamer)]?.names || []), ...(key(streamer) !== 'general' ? settings.profiles.general?.names || [] : [])])];
const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('la IA tardó demasiado')), ms).unref())]);
/**
 * Corrige ortografia, tildes, mayusculas y nombres propios sin perder los tiempos de cada palabra.
 * Siempre aplica las reglas; si hay IA (Ollama o API) la usa despues, y descarta su resultado si reescribe el texto.
 */
export async function fixSubs(streamer: string, words: CapWord[], useAi = true, ms = 180_000) {
  const names = namesFor(streamer);
  let out = ruleFix(applyFixes(words, settings.profiles[key(streamer)]?.fixes), names), ai = false, note = '';
  if (useAi && llmName() && out.some((w) => !w.del)) {
    try {
      const r = await within(aiFix(out, names, streamer, llmChat), ms);
      // Tras la IA se repasan las reglas: sus puntos nuevos crean frases nuevas que piden mayuscula.
      if (r.applied) { out = ruleFix(r.words, names); ai = true; }
      if (r.rejected) note = r.applied ? 'En una parte la IA cambiaba demasiado el texto y se dejó como estaba.' : 'La IA cambiaba demasiado el texto y no se aplicó: quedaron las correcciones básicas.';
    } catch (e) { note = 'La IA no respondió (' + (e as Error).message.slice(0, 80) + '): quedaron las correcciones básicas.'; }
  }
  return { words: out, changed: countChanges(words, out), ai, hasAi: !!llmName(), note };
}

// ---------- IA: titulos y traduccion ----------
export async function suggestTitles(sid: string, text: string) {
  if (!text.trim()) throw new Error('Hace falta la transcripción del momento.');
  const streamer = sources.get(sid)?.streamer || '', t = trendFor(streamer), tags = trendHashtags(t, streamer), own = ownBestTitles();
  // Sin IA (o si falla): titulos a partir de la frase mas intensa, con el estilo de los Shorts que funcionan.
  const local = () => ({ titles: localTitles(text, streamer, t, HYPE), description: '', hashtags: tags });
  if (!llmName()) return local();
  try {
    const raw = await llmChat(
      'Eres editor de clips virales de streamers en espanol (como los canales de clips de TikTok que mas crecen). Responde SOLO con JSON: {"titles":["...","...","..."],"description":"...","hashtags":["#...","#...","#..."]}. ' +
        'titles: el gancho que se ve en los primeros segundos del video (pregunta o frase que de curiosidad, como «¿BAILAR CON UN ROBOT EN PLENO DIRECTO?»): maximo 45 caracteres, con el nombre de quien sale y lo que pasa, que de curiosidad (ej: "FABIANA DE BRUYNE??", "AURON EL HUMILDE"), sin prometer nada que no ocurra. ' +
        'description: UNA frase que cuenta lo que pasa como una noticia, con los nombres (ej: "Auron reacciona a la muerte del cura que muere por una cruz", "Pique quiere hablar con Auron por su chiste de la Kings League"). ' +
        'hashtags: 4 o 5, incluyendo los nombres de las personas que salen en el clip sin espacios (ej: #favianasevillano #pereira7).' +
        (t?.titles.length ? ` Imita el estilo de estos titulos que tienen muchas vistas ahora: ${t.titles.slice(0, 5).map((x) => '"' + x.t + '"').join(', ')}.` : '') +
        (own.length ? ` En la cuenta del usuario, los que mejor le funcionaron fueron: ${own.map((x) => '"' + x.t + '" (' + x.v + ' vistas)').join(', ')}: es su publico, tenlos muy en cuenta.` : ''),
      `Streamer: ${streamer || 'desconocido'}\nTranscripcion del clip:\n${text.slice(0, 3000)}`,
      { smart: true },
    );
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    return { titles: (j.titles || []).slice(0, 3).map(String), description: String(j.description || ''), hashtags: [...new Set([...(j.hashtags || []).slice(0, 4).map(String), ...tags])].slice(0, 6) };
  } catch (e) { log('Títulos con IA: ' + (e as Error).message.slice(0, 120)); return local(); }
}

/**
 * Subtitulos de un directo en ingles o mezclado, en español: se traduce lo que esta en otro idioma y lo que ya esta en
 * español se deja igual (Groq si hay clave; si no, la IA local). Los tiempos se reparten como en «Traducir».
 */
const spanishCache = new Map<string, CapWord[]>();
export async function toSpanish(s: Source, words: CapWord[]): Promise<CapWord[]> {
  if (s.lang !== 'mix' || !words.length || !llmName()) return words;
  const text = words.map((w) => w.text).join(' '), k = s.id + '|' + text;
  if (!spanishCache.has(k)) {
    try {
      // Los nombres no se traducen: «Foolish» (un jugador) salia como «¡Tonto!».
      const names = [s.streamer, ...namesFor(s.streamer)].filter(Boolean).slice(0, 40).join(', ');
      const raw = await llmChat(`Pasa al español unos subtitulos de un directo. Lo que ya esta en español se deja igual; lo que esta en otro idioma (sobre todo ingles) se traduce, con tono coloquial y frases cortas. No traduzcas nombres propios ni apodos de personas o jugadores${names ? ' (por ejemplo: ' + names + ')' : ''}: aunque parezcan palabras en ingles, se dejan igual. Una palabra en ingles suelta, con mayuscula o entre exclamaciones (como «¡Quackity!»), casi siempre es un nombre. No resumas ni añadas nada. Responde SOLO con JSON: {"text":"..."}`, text, { smart: true });
      const out = String(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).text || '');
      spanishCache.set(k, out ? applyText(words, out, words[words.length - 1].endMs) : words);
    } catch (e) { log('Traducir al español: ' + (e as Error).message.slice(0, 120)); return words; }
  }
  return spanishCache.get(k)!;
}
/** Cambia el idioma de un directo (solo cambia los subtitulos: lo escuchado sirve igual). */
export function setSourceLang(sid: string, lang: string) {
  const s = src(sid);
  s.lang = lang === 'mix' ? 'mix' : undefined;
  save(s);
  log(`${s.name}: idioma ${s.lang ? 'inglés o mezclado (subtítulos en español)' : 'español'}`);
  return s;
}
export async function translate(words: CapWord[], lang: string) {
  if (!llmName()) throw new Error('Para traducir hace falta la IA local gratuita: instala Ollama y el modelo qwen2.5:7b.');
  const text = words.map((w) => w.text).join(' ');
  const raw = await llmChat(`Traduce al ${lang} el texto de unos subtitulos, con tono coloquial. Responde SOLO con JSON: {"text":"..."}`, text);
  const out = String(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).text || '');
  return applyText(words, out, words[words.length - 1]?.endMs ?? 0);
}
