/** Deteccion de momentos a partir del volumen por segundo. Funciones puras, probadas en tests/detect.test.ts */
export type Peak = { t: number; z: number };

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Cuanto se sale cada segundo del volumen normal del directo (puntuacion robusta). */
export function zscores(db: number[]) {
  const voiced = db.filter((d) => d > -60); // ignora silencios y pausas
  const med = median(voiced.length ? voiced : db);
  const mad = median((voiced.length ? voiced : db).map((d) => Math.abs(d - med))) || 1;
  return db.map((d) => (d - med) / (1.4826 * mad));
}

export function smooth(a: number[], radius = 2) {
  return a.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(a.length - 1, i + radius); j++) s += a[j], n++;
    return s / n;
  });
}

/** Picos sobre una serie ya puntuada (volumen, chat o la mezcla de ambos). */
export function peaksOf(z: number[], opts: { max?: number; minGap?: number; threshold?: number } = {}): Peak[] {
  const { max = 15, minGap = 45, threshold = 1.2 } = opts;
  const cand: Peak[] = [];
  for (let i = 1; i < z.length - 1; i++) if (z[i] >= threshold && z[i] >= z[i - 1] && z[i] >= z[i + 1]) cand.push({ t: i, z: z[i] });
  cand.sort((a, b) => b.z - a.z);
  const picked: Peak[] = [];
  for (const c of cand) {
    if (picked.length >= max) break;
    if (picked.every((p) => Math.abs(p.t - c.t) >= minGap)) picked.push(c);
  }
  return picked.sort((a, b) => a.t - b.t);
}

/**
 * De los picos de un analisis, los que son momentos nuevos: se descartan los que caen cerca de un momento
 * que ya estaba en la lista o dentro de su tramo. Lo ya detectado nunca se quita por un analisis posterior.
 */
export function newPeaks(existing: { peak: number; start: number; end: number }[], peaks: Peak[], near = 12): Peak[] {
  return peaks.filter((p) => !existing.some((c) => Math.abs(c.peak - p.t) <= near || (p.t >= c.start && p.t <= c.end)));
}

/**
 * Numero de generacion de un momento: el orden en que se creo en su fuente (1 = el primero). Los que
 * ya tienen numero no se tocan; los de antes de llevarlo lo reciben por orden del video, a continuacion
 * del ultimo numero existente. Devuelve el siguiente numero libre.
 */
export function backfillNumbers(cands: { n?: number; start: number }[]): number {
  let i = cands.reduce((m, c) => Math.max(m, c.n || 0), 0) + 1;
  for (const c of cands.filter((c) => !c.n).sort((a, b) => a.start - b.start)) c.n = i++;
  return i;
}

/** Picos de emocion por volumen: gritos, risas, reacciones. */
export const findPeaks = (db: number[], opts: { max?: number; minGap?: number; threshold?: number } = {}): Peak[] => peaksOf(smooth(zscores(db), 2), opts);

/** Mezcla volumen y chat: el chat suele reaccionar unos segundos despues, asi que se mira hacia adelante. */
export function combine(audioZ: number[], chat: number[] | null, lookahead = 12, visual: number[] | null = null) {
  if (!chat && !visual) return audioZ;
  return audioZ.map((a, i) => {
    let c = 0, v = 0;
    if (chat) for (let j = i; j <= Math.min(chat.length - 1, i + lookahead); j++) c = Math.max(c, chat[j]);
    if (visual) for (let j = Math.max(0, i - 2); j <= Math.min(visual.length - 1, i + 2); j++) v = Math.max(v, visual[j]);
    return Math.max(a, 0) + 0.7 * Math.min(8, Math.max(0, c)) + 0.35 * Math.min(6, Math.max(0, v - 1.5)) + Math.min(a, 0);
  });
}

/** La reaccion suele llegar al final: el clip arranca antes del pico para incluir lo que la provoca. */
export function windowFor(peak: number, total: number, before = 28, after = 12) {
  const start = Math.max(0, peak - before);
  const end = Math.min(total || peak + after, peak + after);
  return { start, end };
}

export const HYPE = /\b(no+ puede ser|qu[eé] es esto|no+ me jodas|mierda|hpta|hijueputa|gonorrea|marica|parce|jajaj\w*|jaja|nooo+|siii+|vamos+|gol+|clip\w*|rep[ií]telo|incre[ií]ble|imposible|lo mat[oóe]|gan[eéó]|perd[ií]|qu[eé] locura|brutal|wtf|omg|bro|literal)\b/gi;

/** Muletillas y palabras propias de un streamer, que cuentan como expresiones de reaccion. */
export function extraWords(words: string[] | undefined): RegExp | null {
  const list = (words || []).map((w) => w.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter((w) => w.length >= 2).slice(0, 40);
  return list.length ? new RegExp(`(^|[^\\p{L}])(${list.join('|')})(?=$|[^\\p{L}])`, 'giu') : null;
}

/**
 * Hasta 8 la puntuacion es la suma de señales; por encima se comprime, para que los mejores momentos
 * no empaten todos en 10 y se puedan ordenar entre si.
 */
export const squash = (s: number) => (s <= 8 ? Math.max(0, s) : 8 + 2 * (1 - Math.exp(-(s - 8) / 3)));

/** Lo que dicen las caras de un momento (ver faces.ts): reaccion 0..5, gesto, cambios de quien habla por minuto. */
export type FaceSignal = { react: number; label: string; turns: number; together: boolean };
/** Lo que se cuenta de las caras en el "por que" de un momento. */
export function faceWhy(face: FaceSignal | null | undefined) {
  const out: string[] = [];
  if (!face) return out;
  if (face.react >= 2.5) out.push(face.label ? `${face.label} en cámara` : 'reacción en cámara');
  if (face.together && face.react >= 2) out.push('reaccionan varios a la vez');
  if (face.turns >= 8) out.push('conversación con idas y vueltas');
  return out;
}

/** Puntuacion 0-10 sin IA: volumen del pico + palabras de reaccion + densidad de habla + caras. */
export function heuristicScore(z: number, text: string, seconds: number, chat = 0, visual = 0, extra: RegExp | null = null, face: FaceSignal | null = null) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const own = extra ? (text.match(extra) || []).length : 0;
  const hype = (text.match(HYPE) || []).length + own;
  const exclam = (text.match(/[!?¡¿]/g) || []).length;
  const density = seconds ? words / seconds : 0;
  const react = face?.react || 0, turns = face?.turns || 0;
  // Una reaccion clara en la cara, que reaccionen varios a la vez y una conversacion con idas y vueltas.
  const faceS = Math.min(2, Math.max(0, react - 1) * 0.6) + (face?.together && react >= 2 ? 0.5 : 0) + Math.min(1, Math.max(0, turns - 4) / 8);
  const s = Math.min(chat > 1.5 ? 4 : 5, z * 1.4) + Math.min(3, hype * 0.8 + exclam * 0.2) + Math.min(2, density * 0.7) + Math.min(3, Math.max(0, chat) * 0.6) + Math.min(1.5, Math.max(0, visual - 1.5) * 0.4) + faceS;
  const why = [z >= 4 ? 'pico de volumen muy alto' : z >= 2 ? 'pico de volumen alto' : 'pico de volumen moderado'];
  if (chat > 1.5) why.push('el chat se disparó');
  if (visual > 3) why.push('cambio brusco en la imagen');
  why.push(...faceWhy(face));
  if (hype) why.push(hype === 1 ? '1 expresión de reacción' : `${hype} expresiones de reacción`);
  if (own) why.push(own === 1 ? '1 palabra típica del streamer' : `${own} palabras típicas del streamer`);
  if (text && density > 2.2) why.push('habla rápida');
  return { score: Math.round(squash(s) * 10) / 10, why: why.join(', '), features: { audio: z, chat, hype, density, visual, ...(face ? { face: react, turns } : {}) } };
}

export const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
};

/**
 * Intro y despedida del directo (el video con musica que el streamer pone antes de empezar o al acabar): desde el
 * principio, o hasta el final, al menos 2 minutos seguidos con muchos mas cambios de plano de lo normal. Medido en un
 * directo de Westcol: su intro de 13 min tenia 3,5-4,3 veces los cambios de plano de la mediana; hablando, 1-1,6 (y
 * se llevaba 12 de los 15 momentos). Devuelve tramos [inicio, fin] en segundos, como los anuncios.
 */
export function introSpans(scene: number[], energy: number[] = [], o = { ratio: 2.5, minMin: 2, maxMin: 30 }): [number, number][] {
  const M = Math.floor(scene.length / 60);
  if (M < 10) return [];
  const mean = (a: number, b: number) => { let s = 0; for (let t = a; t < b; t++) s += scene[t] || 0; return s / Math.max(1, b - a); };
  const per = Array.from({ length: M }, (_, m) => mean(m * 60, m * 60 + 60));
  const med = [...per].sort((x, y) => x - y)[Math.floor(M / 2)], hi = o.ratio * Math.max(med, 0.02);
  const run = (mins: number[]) => { let k = 0; while (k < mins.length && per[mins[k]] >= hi) k++; return k; };
  // El borde, al segundo: donde mas cambia el volumen entre los 10 s de un lado y los del otro (la musica de la intro
  // corta de golpe: en Westcol, de -12 a -42 dB); sin volumen, los cambios de plano (30 s: van a golpes).
  const sig = energy.length >= scene.length ? energy : scene, w = sig === energy ? 10 : 30;
  const avg = (a: number, b: number) => { let s = 0; for (let t = a; t < b; t++) s += sig[t] || 0; return s / Math.max(1, b - a); };
  const edge = (from: number, to: number, sign: 1 | -1) => {
    let best = from, bd = -Infinity;
    for (let t = Math.max(w, from); t <= Math.min(sig.length - w, to); t++) { const d = sign * (avg(t - w, t) - avg(t, t + w)); if (d > bd) (bd = d), (best = t); }
    return best;
  };
  const out: [number, number][] = [];
  const head = run(per.map((_, m) => m));
  if (head >= o.minMin && head <= o.maxMin) out.push([0, edge((head - 1) * 60, (head + 1) * 60, 1)]);
  const tail = run(per.map((_, m) => M - 1 - m));
  if (tail >= o.minMin && tail <= o.maxMin && tail < M - head) out.push([edge((M - tail - 1) * 60, (M - tail + 1) * 60, -1), scene.length]);
  return out;
}

/**
 * Los momentos que clipeo la comunidad: cuantas personas clipearon cada instante (un clip suelto no dice nada; 20 a la
 * vez, que ahi paso algo). En un directo de Westcol hubo 757 clips y momentos con 40 personas clipeando a la vez.
 * `spans`: el tramo de cada clip en la grabacion (segundos). Devuelve los picos (separados `gap` s) con al menos `min`
 * personas, con el tramo tipico de los clips que lo cubren (la mediana de sus inicios y finales).
 */
export function clipCrowd(spans: { a: number; b: number }[], total: number, o = { min: 2, gap: 60 }): { t: number; n: number; a: number; b: number }[] {
  const n = new Array(Math.ceil(total) + 1).fill(0);
  for (const s of spans) for (let t = Math.max(0, Math.floor(s.a)); t < Math.min(n.length, Math.ceil(s.b)); t++) n[t]++;
  const med = (a: number[]) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };
  const out: { t: number; n: number; a: number; b: number }[] = [];
  for (const t of [...n.keys()].sort((p, q) => n[q] - n[p] || p - q)) {
    if (n[t] < o.min) break;
    if (out.some((p) => Math.abs(p.t - t) < o.gap)) continue;
    const cov = spans.filter((s) => s.a <= t && s.b > t);
    out.push({ t, n: n[t], a: Math.max(0, med(cov.map((s) => s.a))), b: Math.min(total, med(cov.map((s) => s.b))) });
  }
  return out.sort((p, q) => p.t - q.t);
}
