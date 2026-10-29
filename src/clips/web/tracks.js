// Pistas de la linea de tiempo ocultas o silenciadas: lo que queda fuera de la vista previa y del video exportado.
// Compartido por el editor y la exportacion, para que se vea igual en los dos sitios.

/** Lo que se puede hacer con cada pista ademas de bloquearla: ocultar lo que se ve o silenciar lo que suena. */
export const TRACKS = { video: 'mute', subs: 'hide', txt: 'hide', stk: 'hide', sfx: 'mute', punch: 'hide', zoom: 'hide', blur: 'hide', scene: 'hide' };

const off = (s, k) => !!s.tracks?.[k]?.[TRACKS[k]];

const shown = (l) => l && l.filter((x) => !x.hide);

/** El spec tal como se ve y se oye: sin lo de las pistas ocultas o silenciadas, ni los elementos ocultos uno a uno (el original no se toca). */
export function applyTracks(s) {
  const o = { ...s, texts: shown(s.texts), stickers: shown(s.stickers), zooms: shown(s.zooms) };
  if (!s.tracks) return o;
  if (off(s, 'subs')) o.captions = { ...s.captions, on: false };
  if (off(s, 'txt')) o.texts = [];
  if (off(s, 'stk')) o.stickers = [];
  if (off(s, 'sfx')) o.sfx = [];
  if (off(s, 'punch')) o.punches = [];
  if (off(s, 'zoom')) o.zooms = [];
  if (off(s, 'blur')) o.blurs = [];
  if (off(s, 'scene')) o.scenes = [];
  return o;
}

/** El sonido original del video esta silenciado. */
export const videoMuted = (s) => off(s, 'video');
