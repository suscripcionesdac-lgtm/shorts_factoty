// Efectos de voz (como el cambiador de voz de CapCut), con filtros de audio de FFmpeg. Compartido entre el exportador
// (fast.ts) y el editor (nombres). El tono se cambia sin cambiar la velocidad: se remuestrea y se compensa con atempo.

/** id -> [nombre, filtro de FFmpeg para audio a 48 kHz] */
export const VOICES = {
  ardilla: ['Ardilla (aguda)', 'asetrate=69600,aresample=48000,atempo=0.6897'],
  grave: ['Grave (monstruo)', 'asetrate=36000,aresample=48000,atempo=1.3333'],
  robot: ['Robot', "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75"],
  eco: ['Eco', 'aecho=0.8:0.88:60|120:0.4|0.25'],
  cueva: ['Cueva', 'aecho=0.8:0.9:500|1000:0.3|0.2'],
  radio: ['Radio / teléfono', 'highpass=f=300,lowpass=f=3400,acompressor=threshold=-20dB:ratio=4:makeup=3'],
  megafono: ['Megáfono', 'highpass=f=500,lowpass=f=3000,volume=1.6,alimiter=limit=0.9'],
};
/** Filtro de un efecto (cadena vacia si no existe). */
export const voiceFilter = (id) => (VOICES[id] ? VOICES[id][1] : '');
