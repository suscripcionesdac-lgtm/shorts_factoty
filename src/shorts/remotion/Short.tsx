import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Captions } from './Captions';
import type { BeatProps, ShortProps } from './props';

const FONT = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const GRADIENTS = [
  ['#1b1035', '#5b1a8a', '#e0338a'],
  ['#06202b', '#0b5563', '#19c3a5'],
  ['#2a0d0d', '#8a2a1a', '#f08a24'],
  ['#0d1330', '#243b8a', '#4aa3f0'],
];

const Background: React.FC<{ beat: BeatProps; index: number }> = ({ beat, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = interpolate(frame, [0, beat.durationFrames], [1.04, 1.14]);
  const v = beat.visual;
  const src = v.asset ? staticFile(`assets/${v.asset}`) : null;

  if (v.kind === 'image' && src) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <Img src={src} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px) brightness(0.5)', transform: 'scale(1.2)' }} />
        <Img src={src} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
      </AbsoluteFill>
    );
  }
  if (v.kind === 'clip' && src) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <OffthreadVideo src={src} muted startFrom={Math.round((v.startSec ?? 0) * fps)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
    );
  }
  const g = GRADIENTS[index % GRADIENTS.length];
  const angle = 160 + interpolate(frame, [0, beat.durationFrames], [0, 25]);
  return <AbsoluteFill style={{ background: `linear-gradient(${angle}deg, ${g[0]} 0%, ${g[1]} 55%, ${g[2]} 100%)` }} />;
};

const Label: React.FC<{ beat: BeatProps; accent: string }> = ({ beat, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!beat.visual.text) return null;
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 160 } });
  const isCard = beat.visual.kind === 'card';
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: isCard ? 'center' : 'flex-start', padding: isCard ? '0 80px 520px' : '260px 70px 0' }}>
      <div
        style={{
          fontFamily: FONT, fontWeight: 900, textAlign: 'center', lineHeight: 1.05, textTransform: 'uppercase',
          fontSize: isCard ? 118 : 62, color: isCard ? '#fff' : '#111', letterSpacing: -1,
          background: isCard ? 'none' : accent, padding: isCard ? 0 : '14px 28px', borderRadius: 14,
          textShadow: isCard ? '0 6px 30px rgba(0,0,0,0.45)' : 'none',
          transform: `scale(${interpolate(pop, [0, 1], [0.85, 1])})`, opacity: pop,
        }}
      >
        {beat.visual.text}
      </div>
    </AbsoluteFill>
  );
};

export const Short: React.FC<ShortProps> = ({ beats, chunks, totalFrames, accent }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {beats.map((b, i) => {
        const last = i === beats.length - 1;
        return (
          <Sequence key={i} from={b.startFrame} durationInFrames={last ? totalFrames - b.startFrame : b.durationFrames}>
            <Background beat={b} index={i} />
            <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.6) 100%)' }} />
            <Label beat={b} accent={accent} />
            {b.credit ? (
              <div style={{ position: 'absolute', left: 48, top: 170, fontFamily: FONT, fontSize: 30, fontWeight: 600, color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '6px 16px', borderRadius: 8 }}>
                {b.credit}
              </div>
            ) : null}
            {b.audio ? <Audio src={staticFile(b.audio)} /> : null}
          </Sequence>
        );
      })}
      <Captions chunks={chunks} accent={accent} font={FONT} />
      <div style={{ position: 'absolute', left: 0, top: 0, height: 8, width: `${(frame / totalFrames) * 100}%`, background: accent }} />
    </AbsoluteFill>
  );
};
