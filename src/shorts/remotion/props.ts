export type WordT = { text: string; startMs: number; endMs: number };
export type BeatProps = {
  audio: string | null; // ruta relativa a public/
  startFrame: number;
  durationFrames: number;
  visual: { kind: 'card' | 'image' | 'clip'; asset?: string; startSec?: number; text?: string };
  credit?: string;
};
export type ShortProps = {
  fps: number;
  totalFrames: number;
  beats: BeatProps[];
  chunks: WordT[][];
  accent: string;
};
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
