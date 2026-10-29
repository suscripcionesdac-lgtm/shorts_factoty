// Tipos de segtime.js (tiempo de los tramos en el video final).
type S = { a: number; b: number; speed?: number; curve?: string; rev?: boolean; hold?: number };
export const CURVES: Record<string, [number, number][]>;
export const CURVE_NAMES: Record<string, string>;
export function pieces(s: S): { a: number; b: number; k: number }[];
export function segPlay(s: S): number;
export function segOut(s: S): number;
export function totalOut(segs: S[]): number;
export function toOut(segs: S[], t: number): number;
export function toSrc(segs: S[], v: number): number;
export function atempo(k: number): string;
