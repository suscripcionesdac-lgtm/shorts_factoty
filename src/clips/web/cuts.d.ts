// Tipos de cuts.js (compartido entre la auto edicion y el editor).
export function cutFillers<T extends { a: number; b: number }>(segs: { a: number; b: number }[], cuts: T[], minPiece?: number): { segments: { a: number; b: number }[]; applied: T[] };
export function cutRange(segs: { a: number; b: number }[], a: number, b: number, minPiece?: number): { a: number; b: number }[];
export function restoreRange(segs: { a: number; b: number }[], a: number, b: number, dur: number): { a: number; b: number }[];
