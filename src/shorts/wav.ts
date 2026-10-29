import fs from 'node:fs';

/** Escribe un WAV mono de 16 bits. Sin muestras = silencio de la duracion indicada. */
export function writeWav(file: string, seconds: number, sampleRate = 44100, samples?: Int16Array) {
  const n = samples ? samples.length : Math.round(seconds * sampleRate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  if (samples) Buffer.from(samples.buffer, samples.byteOffset, n * 2).copy(buf, 44);
  fs.writeFileSync(file, buf);
}
