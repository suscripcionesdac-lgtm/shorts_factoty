// Tipos de place.js (compartido entre el exportador y el editor).
export type Box = { x: number; y: number; w: number; h: number };
export const OUT_W: number;
export const OUT_H: number;
export const SAFE: Record<'todas' | 'tiktok' | 'shorts' | 'reels' | 'ninguna', [number, number]>;
export function faceZones(sp: { layout: string; pipPos?: string; cam?: Box }, geo: { camH: number; top: number; vh: number }, cams?: Box[]): Box[];
export function titleZone(sp: { title?: string; titleY?: number }, geo?: { titleY: number }): Box | null;
export function zonesAt(sp: { punches?: { a: number; b: number }[] }, base: Box[], a: number, b: number): Box[];
export function captionBox(text: string, size: number): { w: number; h: number };
export function hookLines(text: string, max?: number): string[];
export function captionY(zones: Box[], prefY: number, cap: { w: number; h: number }, safe?: [number, number]): number;
export function gridBoxes(n: number): { cw: number; ch: number; xy: [number, number][] };
