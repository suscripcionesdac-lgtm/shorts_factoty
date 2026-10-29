/** Plantilla de estilo de cada streamer. */
import { defaultTemplate } from '../media/spec';
import { writeJson } from '../../shared/fs';
import { key, type Source, type Template, templates, TEMPLATES } from './core';

// ---------- plantillas por streamer ----------
export function getTemplate(streamer: string, s?: Source): Template {
  const { transition, transDur, transCuts, transAt, markers, tracks, progress, hook, hookSeg, replay, scenes, ...saved } = (templates[key(streamer)] || {}) as any; // las guardadas por versiones anteriores no cuentan
  return { ...defaultTemplate(s?.width || 1920, s?.height || 1080, streamer), ...saved };
}
export function setTemplate(streamer: string, t: Partial<Template>) {
  // La plantilla guarda el estilo, no el contenido de un clip concreto.
  // Las transiciones tambien son de cada clip: guardadas en la plantilla se repetian en todos los clips y en cada corte.
  // La barra de progreso tampoco: la pone a veces la auto edicion y, guardada, salia sola en todos los clips del streamer.
  // El gancho y la repeticion lenta tampoco: son de un momento concreto del clip y salian solos en todos los demas.
  const { hook, hookSeg, replay, texts, stickers, sfx, zooms, punches, segments, scenes, reframe, title, titleY, description, mutes, cams, camTrack, transition, transDur, transCuts, transAt, markers, tracks, volume, progress, ...keep } = t as any;
  // De las zonas difuminadas solo se recuerdan las de todo el clip (el chat, un nombre fijo en pantalla).
  if (keep.blurs) keep.blurs = keep.blurs.filter((b: any) => b.all);
  if (keep.captions) keep.captions = { ...keep.captions, words: undefined };
  const { transition: _t, transDur: _d, transCuts: _c, transAt: _ta, markers: _mk, tracks: _tk, progress: _p, scenes: _sc, hook: _h, hookSeg: _hs, replay: _r, ...old } = (templates[key(streamer)] || {}) as any;
  templates[key(streamer)] = { ...old, ...keep };
  writeJson(TEMPLATES, templates);
}
