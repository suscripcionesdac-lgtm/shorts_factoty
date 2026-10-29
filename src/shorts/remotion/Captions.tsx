import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { WordT } from './props';

/** Subtitulos por bloques cortos; la palabra que suena se resalta. */
export const Captions: React.FC<{ chunks: WordT[][]; accent: string; font: string; bottom?: number; size?: number }> = ({ chunks, accent, font, bottom = 520, size = 88 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  // Un bloque se muestra desde su primera palabra hasta que empieza el siguiente (maximo 600 ms de cola).
  const idx = chunks.findIndex((c, i) => {
    const start = c[0].startMs;
    const next = chunks[i + 1]?.[0].startMs ?? Infinity;
    const end = Math.min(next, c[c.length - 1].endMs + 600);
    return ms >= start && ms < end;
  });
  if (idx < 0) return null;
  const chunk = chunks[idx];
  const sinceStart = ms - chunk[0].startMs;
  const scale = interpolate(sinceStart, [0, 90], [0.88, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: `0 70px ${bottom}px` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 22px', transform: `scale(${scale})` }}>
        {chunk.map((w, i) => {
          const on = ms >= w.startMs && ms < (chunk[i + 1]?.startMs ?? w.endMs + 600);
          return (
            <span
              key={i}
              style={{
                fontFamily: font, fontWeight: 900, fontSize: size, lineHeight: 1.12, textTransform: 'uppercase',
                color: on ? accent : '#fff', WebkitTextStroke: '10px #000', paintOrder: 'stroke fill',
                textShadow: '0 8px 24px rgba(0,0,0,0.6)',
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
