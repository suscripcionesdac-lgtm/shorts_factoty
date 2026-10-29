import type { CapWord, Seg } from '../media/spec';

/**
 * Corte inteligente de video hablado (como el «智能剪口播» de CapCut): quita muletillas y repeticiones palabra a palabra,
 * con los tiempos de la transcripcion. Es prudente a proposito: un corte de mas se nota mucho mas que una muletilla.
 *  - Sonidos de duda («eh», «em», «mmm», «ehm»): siempre.
 *  - Muletillas con significado posible («este», «pues», «bueno», «o sea», «tipo»): solo si van sueltas, con pausa
 *    antes y despues (si no, forman parte de la frase: «este juego», «pues claro»).
 *  - Tartamudeos y arranques en falso: «que que», «yo yo», «es que es que vamos»: se quita la primera vez.
 *    No las repeticiones que dan enfasis («no no no», «sí sí», «vamos vamos»).
 * Funciones puras: las usa la auto edicion (engine.ts) y se prueban en tests/fillers.test.ts.
 */
export type FillerCut = Seg & { kind: 'muletilla' | 'repeticion'; text: string };

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');
/** Sonidos de duda: no son palabras. */
const HESITATION = /^(e+h+|e+m+|eh+m+|m{2,}h*|m+h+|a+h+m*|u+h+|u+m+|ejem)$/;
/** Muletillas que solo se quitan sueltas (con pausa antes y despues). Las de dos palabras van juntas. */
const SOFT = new Set(['este', 'esto', 'pues', 'bueno', 'tipo', 'osea', 'nada', 'vale', 'digamos', 'sabes', 'verdad']);
const SOFT2 = new Set(['o sea', 'o sea que', 'es que', 'a ver']);
/** Repetidas dan enfasis, no son un tartamudeo. */
const EMPHASIS = new Set(['no', 'si', 'ya', 'ja', 'jaja', 'jajaja', 'vamos', 'dale', 'mira', 'oye', 'venga', 'bueno', 'muy', 'mas', 'nunca', 'corre', 'ay', 'uy', 'wow', 'eso', 'toma']);

const PAUSE = 0.25; // s de silencio que convierten una muletilla en una duda
const MIN_CUT = 0.12; // s: menos no se nota y el salto si

/** Muletillas y repeticiones de una transcripcion (tiempos en segundos, relativos al clip). */
export function findFillers(words: CapWord[]): FillerCut[] {
  // Los signos sueltos («...», «?») no son palabras: no cuentan ni rompen una repeticion.
  const ws = words.filter((w) => !w.del && norm(w.text));
  const N = ws.map((w) => norm(w.text));
  const a = (i: number) => ws[i].startMs / 1000, b = (i: number) => ws[i].endMs / 1000;
  const gapBefore = (i: number) => (i === 0 ? 9 : a(i) - b(i - 1)), gapAfter = (i: number) => (i === ws.length - 1 ? 9 : a(i + 1) - b(i));
  // Del principio de la palabra hasta la siguiente, con como mucho 0,3 s de la pausa (el resto lo deciden los silencios).
  const span = (i: number, j: number) => ({ a: a(i), b: j + 1 < ws.length ? Math.min(a(j + 1), b(j) + 0.3) : b(j) });
  const cuts: FillerCut[] = [];
  const used = new Set<number>();
  const push = (i: number, j: number, kind: FillerCut['kind']) => {
    for (let k = i; k <= j; k++) if (used.has(k)) return;
    for (let k = i; k <= j; k++) used.add(k);
    cuts.push({ ...span(i, j), kind, text: ws.slice(i, j + 1).map((w) => w.text).join(' ') });
  };
  for (let i = 0; i < ws.length; i++) {
    if (!N[i]) continue;
    // Sonidos de duda. No si preguntan o exclaman («qué locura, ¿eh?», «¡ah!»): ahi significan algo. «Ah» y «uh» son
    // a menudo una reaccion («ah, no pusieron...»): solo si van sueltos.
    if (HESITATION.test(N[i]) && !/[?¿!¡]/.test(ws[i].text) && (!/^[au]+h+$/.test(N[i]) || (gapBefore(i) >= PAUSE && gapAfter(i) >= PAUSE))) { push(i, i, 'muletilla'); continue; }
    // Muletillas de dos o tres palabras sueltas («o sea», «a ver»).
    for (const n of [3, 2]) {
      const phrase = N.slice(i, i + n).join(' ');
      if (i + n <= ws.length && SOFT2.has(phrase.replace('osea', 'o sea')) && gapBefore(i) >= PAUSE && gapAfter(i + n - 1) >= PAUSE) { push(i, i + n - 1, 'muletilla'); break; }
    }
    if (used.has(i)) continue;
    // Muletillas de una palabra, sueltas (o alargadas con puntos suspensivos: «este...»).
    if (SOFT.has(N[i]) && ((gapBefore(i) >= PAUSE && gapAfter(i) >= PAUSE) || /\.\.\.|…/.test(ws[i].text))) { push(i, i, 'muletilla'); continue; }
    // Arranques en falso: un bloque de 4 a 2 palabras que se repite enseguida, con como mucho una palabra suelta en
    // medio («llevo una racha que... llevo una racha complicada»), o una sola palabra repetida («que que»).
    // Se quita la primera vez (y la palabra suelta).
    found: for (const n of [4, 3, 2, 1]) {
      for (const skip of n === 1 ? [0] : [0, 1]) {
        const j = i + n + skip; // donde empieza la repeticion
        if (j + n > ws.length) continue;
        const x = N.slice(i, i + n);
        if (x.join(' ') !== N.slice(j, j + n).join(' ')) continue;
        if (x.every((t) => EMPHASIS.has(t))) continue; // «no no», «vamos vamos»: enfasis
        if (a(j) - b(j - 1) > (n === 1 ? 1.2 : 2.5)) continue; // con una pausa larga en medio ya es otra frase
        push(i, j - 1, 'repeticion');
        break found;
      }
    }
  }
  return cuts.filter((c) => c.b - c.a >= MIN_CUT).sort((p, q) => p.a - q.a);
}

// Cortar sin perder voz: compartido con el editor.
export { cutFillers } from '../web/cuts.js';
