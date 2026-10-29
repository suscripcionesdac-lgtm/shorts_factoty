// Tipos de prefs.js (compartido entre el director y el editor).
export type Prefs = Record<string, [number, number]>;
export const kindOf: { zoom: (scale: number) => string; sfx: (file: string) => string; transition: (id: string) => string; captions: (style: string) => string };
export const KIND_NAME: Record<string, string>;
export function kindName(kind: string): string;
export const MIN_SEEN: number;
export const DROP_BELOW: number;
export const DECAY: number;
export function disliked(prefs: Prefs | null | undefined, kind: string): boolean;
export function addDecisions(prefs: Prefs | null | undefined, items: { kind?: string; on: boolean }[]): Prefs;
