/** Aprende de lo que exportas y descartas: una regresion logistica pequeña por streamer. */
export type Features = { audio: number; chat: number; hype: number; density: number; visual?: number; face?: number; turns?: number };
export type Model = { w: number[]; b: number; n: number };

export const newModel = (): Model => ({ w: [0, 0, 0, 0, 0, 0, 0], b: 0, n: 0 });
// Los modelos guardados antes de añadir una señal tienen menos pesos: los que faltan valen 0.
const vec = (f: Features) => [Math.min(1.5, f.audio / 5), Math.min(1.5, f.chat / 5), Math.min(1.5, f.hype / 3), Math.min(1.5, f.density / 3), Math.min(1.5, (f.visual || 0) / 5), Math.min(1.5, (f.face || 0) / 4), Math.min(1.5, (f.turns || 0) / 12)];
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function predict(m: Model, f: Features) {
  const x = vec(f);
  return sigmoid(m.b + x.reduce((a, v, i) => a + (m.w[i] || 0) * v, 0));
}

/** label 1 = exportado, 0 = descartado. */
export function train(m: Model, f: Features, label: 0 | 1, lr = 0.6): Model {
  const x = vec(f);
  const err = label - predict(m, f);
  return { w: x.map((v, i) => (m.w[i] || 0) + lr * err * v), b: m.b + lr * err, n: m.n + 1 };
}

/** Mezcla la puntuacion base con lo aprendido; hasta tener 6 ejemplos manda la base. */
export function blend(base: number, m: Model | undefined, f: Features) {
  if (!m || m.n < 6) return base;
  const k = Math.min(0.5, m.n / 40 + 0.2);
  return Math.round((base * (1 - k) + 10 * predict(m, f) * k) * 10) / 10;
}
