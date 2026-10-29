// Tipos de pick.js («Sacar clips»).
type Cand = { id: string; peak: number; start: number; end: number; score: number; by: string; text?: string; title?: string; why?: string; label?: string; hidden?: boolean; dup?: boolean; wait?: boolean; exported?: boolean; features?: { chat?: number; hype?: number } };
export const DURS: Record<'auto' | 'corto' | 'medio' | 'largo', [number, number] | null>;
export function fit(c: Cand, dur: keyof typeof DURS, total?: number): { start: number; end: number };
export function pickClips<T extends Cand>(cands: T[], opts?: { kind?: 'fuertes' | 'graciosos' | 'chat' | 'historias'; dur?: keyof typeof DURS; hint?: string; total?: number }, n?: number): { c: T; rank: number; start: number; end: number }[];
