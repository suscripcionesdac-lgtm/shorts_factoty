// Tipos de tracks.js (compartido entre el editor y la exportacion).
type Tracks = { tracks?: Record<string, { hide?: boolean; mute?: boolean; lock?: boolean }> };
export const TRACKS: Record<string, 'hide' | 'mute'>;
export function applyTracks<T extends Tracks>(s: T): T;
export function videoMuted(s: Tracks): boolean;
