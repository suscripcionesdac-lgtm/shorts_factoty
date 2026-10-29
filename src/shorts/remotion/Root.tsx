import React from 'react';
import { Composition } from 'remotion';
import { Short } from './Short';
import { FPS, HEIGHT, WIDTH, type ShortProps } from './props';

const preview: ShortProps = {
  fps: FPS,
  totalFrames: 150,
  accent: '#FFD400',
  beats: [
    { audio: null, startFrame: 0, durationFrames: 75, visual: { kind: 'card', text: 'VISTA PREVIA' } },
    { audio: null, startFrame: 75, durationFrames: 75, visual: { kind: 'card', text: 'SEGUNDA TARJETA' } },
  ],
  chunks: [
    [{ text: 'Esto', startMs: 0, endMs: 400 }, { text: 'es', startMs: 400, endMs: 700 }, { text: 'una', startMs: 700, endMs: 1100 }],
    [{ text: 'vista', startMs: 1100, endMs: 1700 }, { text: 'previa.', startMs: 1700, endMs: 2500 }],
  ],
};

export const Root: React.FC = () => (
  <>
  <Composition
    id="Short"
    component={Short as unknown as React.FC<Record<string, unknown>>}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={150}
    defaultProps={preview as unknown as Record<string, unknown>}
    calculateMetadata={({ props }) => ({ durationInFrames: (props as unknown as ShortProps).totalFrames })}
  />
  </>
);
