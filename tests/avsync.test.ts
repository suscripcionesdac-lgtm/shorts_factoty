import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FFMPEG } from '../src/clips/media/ff';
import { buildArgs, renderSpec } from '../src/clips/media/fast';
import { defaultTemplate, sanitize } from '../src/clips/media/spec';

function command(args: string[]) {
  const result = spawnSync(FFMPEG, args, { maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return result.stdout;
}

function runs(active: boolean[], fps: number) {
  const out: number[] = [];
  for (let i = 0; i < active.length; i++) {
    if (active[i] && (i === 0 || !active[i - 1])) out.push(i / fps);
  }
  return out;
}

describe('sincronización A/V al exportar desde una fuente TS', () => {
  it('mantiene sincronizados audio y video después de buscar y cortar segmentos', async () => {
    const root = path.resolve('test-results');
    fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, 'avsync-'));
    try {
      const input = path.join(dir, 'sync.ts');
      const output = path.join(dir, 'clip.mp4');
      const generated = spawnSync(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=14',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=14',
        '-filter_complex',
        "[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,8,8.3)+between(t,10,10.3)+between(t,12,12.3)'[v];" +
          "[1:a]volume='if(between(t,8,8.3)+between(t,10,10.3)+between(t,12,12.3),1,0)':eval=frame[a]",
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast',
        '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-c:a', 'aac',
        '-b:a', '128k', '-output_ts_offset', '1.4', '-f', 'mpegts', input,
      ], { maxBuffer: 32 * 1024 * 1024 });
      if (generated.status !== 0) throw new Error(String(generated.stderr));

      const base = defaultTemplate(640, 360);
      const spec = sanitize({
        sid: 'sync', start: 6, end: 13,
        segments: [{ a: 0, b: 2.5 }, { a: 3, b: 7 }],
        captions: { ...base.captions, on: false },
      }, base);
      await renderSpec({ spec, file: input, outDir: dir, srcW: 640, srcH: 360, fast: true });

      const video = command(['-hide_banner', '-loglevel', 'error', '-i', output, '-vf', 'scale=8:8:flags=area,format=gray', '-an', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
      const pixelsPerFrame = 64;
      const frameCount = Math.floor(video.length / pixelsPerFrame);
      const bright = Array.from({ length: frameCount }, (_, i) => {
        const frame = video.subarray(i * pixelsPerFrame, (i + 1) * pixelsPerFrame);
        return frame.reduce((sum, p) => sum + p, 0) / pixelsPerFrame > 100;
      });

      const audio = command(['-hide_banner', '-loglevel', 'error', '-i', output, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1']);
      const samples = new Int16Array(audio.buffer, audio.byteOffset, Math.floor(audio.length / 2));
      const window = 80;
      const rms = Array.from({ length: Math.floor(samples.length / window) }, (_, i) => {
        let sum = 0;
        for (let j = 0; j < window; j++) sum += samples[i * window + j] ** 2;
        return Math.sqrt(sum / window);
      });
      const threshold = Math.max(...rms) * 0.15;
      const audioActive = rms.map((v) => v > threshold);
      const videoStarts = runs(bright, 30), audioStarts = runs(audioActive, 100);

      expect(videoStarts).toHaveLength(3);
      expect(audioStarts).toHaveLength(3);
      videoStarts.forEach((start, i) => {
        expect(Math.abs(start - audioStarts[i]), `pulso ${i + 1}: video ${start}s, audio ${audioStarts[i]}s`).toBeLessThan(0.08);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
