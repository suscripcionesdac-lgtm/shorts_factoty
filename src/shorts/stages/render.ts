import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { PUBLIC, ROOT, loadState, markStage, readJson, runFile } from '../runs';
import type { ShortProps } from '../remotion/props';

export async function renderStage(id: string) {
  const st = loadState(id);
  const out = runFile(id, 'video.mp4');
  const buildHash = st.stages.build?.hash;
  const inputProps = readJson<ShortProps>(runFile(id, 'props.json')) as unknown as Record<string, unknown>;
  const browserExecutable = process.env.BROWSER_EXECUTABLE || undefined;

  console.log('  empaquetando plantilla...');
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'src/shorts/remotion/index.ts'), publicDir: PUBLIC });
  const composition = await selectComposition({ serveUrl, id: 'Short', inputProps, browserExecutable });
  let last = -1;
  await renderMedia({
    composition, serveUrl, inputProps, browserExecutable,
    codec: 'h264', audioCodec: 'aac', outputLocation: out, crf: 18, enforceAudioTrack: true,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10);
      if (p !== last) process.stdout.write(`  render ${p * 10}%\r`), (last = p);
    },
  });
  console.log('  render 100%');
  markStage(id, 'render', { hash: buildHash });
  return out;
}
