import { hash, loadAssets, loadScript, markStage, readJson, runFile, writeJson } from '../runs';
import { buildTimeline, chunkWords, wordsFromAlignment, wordsProportional, type Word } from '../../shared/timing';
import type { VoiceFile } from '../types';
import { FPS, type ShortProps } from '../remotion/props';

/** Calcula la linea de tiempo y los subtitulos y escribe props.json para Remotion. */
export function buildStage(id: string) {
  const script = loadScript(id);
  const voice = readJson<VoiceFile>(runFile(id, 'voice.json'));
  if (voice.beats.length !== script.beats.length) throw new Error('El guion cambio de numero de frases. Ejecuta "voice" otra vez.');
  const assets = new Map(loadAssets().map((a) => [a.file, a]));
  const { slots, totalFrames } = buildTimeline(voice.beats.map((b) => b.durationSec), FPS);

  const words: Word[] = [];
  script.beats.forEach((b, i) => {
    const v = voice.beats[i];
    const s = slots[i];
    words.push(...(v.alignment ? wordsFromAlignment(v.alignment, s.startMs) : wordsProportional(b.narration, s.startMs, s.durationMs)));
  });

  const props: ShortProps = {
    fps: FPS,
    totalFrames,
    accent: '#FFD400',
    chunks: chunkWords(words),
    beats: script.beats.map((b, i) => {
      const a = b.visual.asset ? assets.get(b.visual.asset) : undefined;
      return {
        audio: voice.mode === 'none' ? null : voice.beats[i].file,
        startFrame: slots[i].startFrame,
        durationFrames: slots[i].durationFrames,
        visual: b.visual,
        credit: a && a.origen !== 'propio' && a.autor ? `Clip: ${a.autor}` : undefined,
      };
    }),
  };
  writeJson(runFile(id, 'props.json'), props);
  markStage(id, 'build', { hash: hash(props) });
  return { seconds: totalFrames / FPS, words: words.length };
}
