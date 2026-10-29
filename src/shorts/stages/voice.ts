import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { PUBLIC, addCost, hash, loadScript, loadState, markStage, readJson, runDir, runFile, writeJson } from '../runs';
import { estimateSeconds } from '../../shared/timing';
import type { VoiceBeat, VoiceFile, VoiceMode } from '../types';
import { writeWav } from '../wav';
import { recordBeats } from '../recorder/server';

const rel = (abs: string) => path.relative(PUBLIC, abs).split(path.sep).join('/');

async function duration(file: string) {
  const m = await parseFile(file, { duration: true });
  if (!m.format.duration) throw new Error(`No pude leer la duracion de ${file}`);
  return m.format.duration;
}

async function elevenlabs(text: string, outFile: string) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) throw new Error('Faltan ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en .env (crea tu voz con "voice-clone").');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2' }),
  });
  if (!res.ok) throw new Error(`ElevenLabs respondio ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as any;
  fs.writeFileSync(outFile, Buffer.from(j.audio_base64, 'base64'));
  const a = j.alignment;
  return a ? { chars: a.characters, starts: a.character_start_times_seconds, ends: a.character_end_times_seconds } : undefined;
}

export async function voiceStage(id: string, mode: VoiceMode, opts: { redo?: number[] } = {}) {
  const script = loadScript(id);
  const prevFile = runFile(id, 'voice.json');
  const prev: VoiceFile | null = fs.existsSync(prevFile) ? readJson<VoiceFile>(prevFile) : null;
  const ext = mode === 'clone' ? 'mp3' : 'wav';
  const fileFor = (i: number) => path.join(runDir(id), `beat-${i}.${ext}`);
  const hashes = script.beats.map((b) => hash([mode, b.narration]));

  // Solo se rehacen las frases cuyo texto cambio (o las pedidas con --redo).
  const pending = script.beats
    .map((_, i) => i)
    .filter((i) => {
      if (opts.redo?.includes(i + 1)) return true;
      const p = prev?.mode === mode ? prev.beats[i] : undefined;
      return !(p && p.hash === hashes[i] && fs.existsSync(path.join(PUBLIC, p.file)));
    });

  const alignments = new Map<number, VoiceBeat['alignment']>();
  if (mode === 'none') {
    for (const i of pending) writeWav(fileFor(i), estimateSeconds(script.beats[i].narration));
  } else if (mode === 'clone') {
    for (const i of pending) {
      const text = script.beats[i].narration;
      process.stdout.write(`  voz ${i + 1}/${script.beats.length}... `);
      alignments.set(i, await elevenlabs(text, fileFor(i)));
      addCost(id, 'voice', 'elevenlabs', text.length, 'caracteres', 0);
      console.log('ok');
    }
  } else if (pending.length) {
    await recordBeats(id, script.beats.map((b) => b.narration), pending, fileFor);
  }

  const beats: VoiceBeat[] = [];
  for (let i = 0; i < script.beats.length; i++) {
    const f = fileFor(i);
    if (!fs.existsSync(f)) throw new Error(`Falta el audio de la frase ${i + 1}. Vuelve a ejecutar "voice".`);
    const old = prev?.mode === mode ? prev.beats[i] : undefined;
    beats.push({
      file: rel(f),
      durationSec: await duration(f),
      hash: hashes[i],
      alignment: alignments.get(i) ?? (pending.includes(i) ? undefined : old?.alignment),
    });
  }
  const out: VoiceFile = { mode, beats };
  writeJson(prevFile, out);
  // Si nada cambio, no se invalidan el render ni el control ya hechos.
  if (loadState(id).stages.voice?.hash !== hash(out)) markStage(id, 'voice', { hash: hash(out), info: { mode } });
  return { total: beats.reduce((a, b) => a + b.durationSec, 0), regenerated: pending.length };
}

/** Crea una voz clonada en ElevenLabs a partir de tus grabaciones y devuelve su id. */
export async function cloneVoice(name: string, files: string[]) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Falta ELEVENLABS_API_KEY en .env');
  const form = new FormData();
  form.append('name', name);
  for (const f of files) form.append('files', new Blob([fs.readFileSync(f)]), path.basename(f));
  const res = await fetch('https://api.elevenlabs.io/v1/voices/add', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs respondio ${res.status}: ${await res.text()}`);
  return ((await res.json()) as any).voice_id as string;
}
