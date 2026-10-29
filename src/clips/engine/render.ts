/** Exportar clips y montajes. */
import { CAM_LAYOUTS, camList, censorRanges, fitPlatform, normalizeSegments, PLATFORMS, sanitize, type Spec } from '../media/spec';
import { applyFixes, learnFixes } from '../media/subfix';
import { PUBLIC, slug } from '../../shared/fs';
import path from 'node:path';
import { cutFillers } from '../analysis/fillers';
import { snapToPhrases, storyContext, storyWindow } from '../analysis/story';
import { phrasesOf } from '../analysis/agent';
import { autoCapSize, concatClips, renderSpec } from '../media/fast';
import { probe } from '../media/ff';
import { musicEntry, musicRms } from '../media/music';
import fs from 'node:fs';
import { faceInfo, feedback } from './analysis';
import { autoEdit } from './autoedit';
import { fixSubs, suggestTitles, toSpanish } from './captions';
import { type ClipMeta, clips, CLIPS, enqueueX, key, loadArr, log, notice, save, saveClip, saveSettings, settings, sources } from './core';
import { alertPhone } from './notify';
import { hearingOf, relWords, src, wordsFor } from './preview';
import { prof } from './profile';
import { queueAutoTikTokUpload } from './publish';
import { energyOf } from './sources';
import { getTemplate } from './templates';

// ---------- exportar ----------
type ExportMeta = { auto?: boolean; learn?: boolean; variantOf?: string; variant?: string; platform?: string };
export function exportClip(raw: Partial<Spec> & { sid: string; start: number; end: number; edited?: boolean }, meta: ExportMeta = {}) {
  const s = src(raw.sid);
  const spec = sanitize(raw, getTemplate(s.streamer, s));
  // Lo que el usuario corrigio a mano en los subtitulos se aprende para la proxima vez con este streamer.
  const learned = learnFixes((prof(key(s.streamer)).fixes ||= {}), spec.captions.words || []);
  // La marca se quita al aprender: exportar otra vez (o en varias versiones) no cuenta lo mismo dos veces.
  if (spec.captions.words) spec.captions.words = spec.captions.words.map(({ was: _w, ...w }) => w);
  if (learned) { saveSettings(); log(`Subtítulos de ${s.streamer || 'este streamer'}: ${learned} corrección${learned === 1 ? '' : 'es'} aprendida${learned === 1 ? '' : 's'}`); }
  let dur = spec.end - spec.start;
  if (!(dur >= 3 && dur <= 600)) throw new Error('El clip debe durar entre 3 segundos y 10 minutos');
  const cand = s.candidates.find((x) => x.id === spec.candidateId);
  if (!spec.title && cand?.title && raw.title == null) spec.title = cand.title;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${slug(spec.title || s.streamer || s.name).slice(0, 30) || 'clip'}`;
  const c: ClipMeta = { id, sid: s.id, streamer: s.streamer, title: spec.title, description: spec.description, start: spec.start, end: spec.end, layout: spec.layout, by: cand?.by, kind: 'clip', status: 'en cola', createdAt: new Date().toISOString(),
    cand: cand?.id, features: cand?.features, text: cand?.text?.slice(0, 600), variantOf: meta.variantOf, variant: meta.variant || undefined, platform: meta.platform || undefined };
  clips.set(id, c);
  saveClip(c);
  if (cand) cand.exported = true;
  if (meta.learn !== false) feedback(s, cand, 1);
  save(s);
  notice('cola', `En cola para exportar: ${c.title || s.name}`, id);
  enqueueX(`Exportando clip de ${s.name}`, async () => {
    const cdir = path.join(CLIPS, id);
    try {
      // Auto edicion (si esta activada en la plantilla y el clip no viene del editor): lo decide todo antes de exportar.
      // En directo con el modo rapido no se espera a la auto edicion (el aviso tiene que llegar enseguida).
      if (!spec.noAuto && !raw.edited && !(meta.auto && settings.fast)) {
        c.status = 'auto edición';
        try {
          const { patch, done, fillers } = await autoEdit(s.id, spec.start, spec.end, cand?.id, { onStep: (p) => (c.progress = p) });
          if (fillers.length) patch.segments = cutFillers(patch.segments || [{ a: 0, b: spec.end - spec.start }], fillers).segments;
          if (spec.transition) { delete patch.transition; delete patch.transDur; delete patch.transCuts; delete patch.transAt; }
          Object.assign(spec, patch, { title: spec.title || patch.title || '', description: spec.description || patch.description || '', captions: { ...spec.captions, ...(patch.captions || {}) } });
          Object.assign(c, { title: spec.title, description: spec.description, layout: spec.layout, note: 'Auto edición: ' + done.join(', ') });
        } catch (e) { c.note = 'Auto edición incompleta: ' + (e as Error).message.slice(0, 140); }
      }
      // En directo (modo rapido) no hay tiempo para la auto edicion completa, pero si para lo rapido: cortar en frases
      // completas (story.ts). El gancho y los subtitulos grandes, abajo, cuando ya hay transcripcion.
      const live = !!meta.auto && settings.fast && !raw.edited;
      if (live && cand?.by === 'audio') {
        c.status = 'transcribiendo';
        try {
          const rec = s.analyzedTo || s.duration || spec.end, win = storyWindow(cand.peak, rec), ctx = storyContext(cand.peak, rec);
          const heard = await hearingOf(s)(ctx.start, ctx.end), span = snapToPhrases(phrasesOf(heard), win.start, win.end, cand.peak, rec);
          if (span.end - span.start >= 3) {
            Object.assign(spec, span); Object.assign(c, span); dur = span.end - span.start;
            spec.captions.words = await toSpanish(s, applyFixes(relWords(heard, span.start, span.end), settings.profiles[key(s.streamer)]?.fixes));
          }
        } catch (e) { c.note = 'Corte por frases: ' + (e as Error).message.slice(0, 120); }
      }
      // Las palabras hacen falta para los subtitulos, para tapar groserias y para los stickers automaticos.
      const auto = spec.autoStickers && !raw.edited && !spec.stickers.length;
      if ((spec.captions.on || spec.censor.on || auto) && !spec.captions.words) {
        c.status = 'transcribiendo';
        try {
          spec.captions.words = await wordsFor(s.id, spec.start, spec.end);
          // Sin pasar por el editor nadie revisa el texto: se corrige solo (en modo rapido, solo las reglas, que son instantaneas).
          if (!raw.edited && spec.captions.fix !== false) spec.captions.words = (await fixSubs(s.streamer, spec.captions.words, !(meta.auto && settings.fast), 90_000)).words;
        }
        catch (e) { c.note = 'Sin subtítulos: ' + (e as Error).message.slice(0, 160); }
      }
      const words = spec.captions.words || [];
      if (words.length) c.text = words.filter((w) => !w.del).map((w) => w.text).join(' ').slice(0, 600);
      // En directo, tambien rapido: gancho de 5 s (Groq, 2-5 s) si no tiene titulo, y subtitulos del tamaño de OpusClip.
      if (live) {
        spec.captions.size = autoCapSize(spec.captions.style);
        if (!spec.title && c.text) {
          const t = await suggestTitles(s.id, c.text).catch(() => null);
          if (t?.titles[0]) { Object.assign(spec, { title: t.titles[0], titleFor: 5, titleStyle: 'caja' }); c.title = spec.title; }
          if (t && !spec.description) spec.description = c.description = [t.description, t.hashtags.join(' ')].filter(Boolean).join(' ');
        }
      }
      spec.mutes = censorRanges(words, spec.censor, dur);
      if (spec.censor.on && !words.length) c.note = (c.note ? c.note + ' · ' : '') + 'Sin transcripción no se pudieron tapar las groserías';
      // Zoom automatico en la reaccion: un acercamiento suave justo en el pico del momento.
      if (spec.autoZoom && !raw.edited && !spec.zooms.length) {
        let pk = cand && cand.by !== 'manual' ? cand.peak - spec.start : NaN;
        if (!(pk > 1 && pk < dur - 1)) { const e = energyOf(s.id); let best = -Infinity; for (let t = Math.ceil(spec.start) + 2; t < Math.min(e.length, spec.end - 2); t++) if (e[t] > best) (best = e[t]), (pk = t - spec.start); }
        if (pk > 1 && pk < dur - 1) spec.zooms = [{ id: 'auto', scale: 1.3, a: Math.max(0, pk - 0.6), b: Math.min(dur, pk + 2.2) }];
      }
      if (!s.width) Object.assign(s, await probe(s.file).then((p) => ({ width: p.width, height: p.height })));
      // Seguir a quien habla y golpe de reaccion: si el editor no lo dejo hecho (exportar ya, lotes), se mira ahora.
      const wantFollow = spec.follow && CAM_LAYOUTS.includes(spec.layout) && !spec.camTrack?.length;
      const wantPunch = spec.autoPunch && !raw.edited && !spec.punches.length;
      if (wantFollow || wantPunch) {
        try {
          const r = await faceInfo(s, spec.start, spec.end, wantFollow ? 10 : 3, spec.captions.words);
          if (r.cams.length > 1) {
            spec.cams = r.cams;
            // La camara de la plantilla manda si coincide con una de las detectadas; si no, la mayor.
            if (!camList(spec).length) spec.cam = r.cams[0];
            if (wantFollow && r.track.length) spec.camTrack = r.track;
          }
          // Solo una reaccion clara merece el primer plano.
          if (wantPunch && r.cam >= 0 && r.react >= 2.5) spec.punches = [{ id: 'auto', a: Math.max(0, r.at - 0.3), b: Math.min(dur, r.at + 1.2), cam: r.cams.length > 1 ? r.cam : -1 }];
        } catch (e) { c.note = 'Sin caras: ' + (e as Error).message.slice(0, 140); }
      }
      // El gancho son los ~3 segundos mas intensos del tramo.
      let hookAt: number | undefined;
      if (spec.hook) {
        const energy = loadArr(s.id, 'energy');
        let best = -Infinity;
        if (cand && cand.peak > spec.start + 4 && cand.peak < spec.end) hookAt = cand.peak - spec.start;
        else for (let t = Math.ceil(spec.start) + 4; t < Math.min(energy.length, spec.end - 1); t++) if (energy[t] > best) (best = energy[t]), (hookAt = t - spec.start);
      }
      c.status = 'renderizando';
      // La musica entra en su parte con fuerza (no en una intro floja), si nadie eligio ya donde empieza.
      if (spec.music && spec.music.start == null) spec.music.start = await musicRms(path.join(PUBLIC, 'music', spec.music.file)).then((r) => musicEntry(r)).catch(() => 0);
      const run = () => renderSpec({ spec, file: s.file, outDir: cdir, srcW: s.width, srcH: s.height, hookAt, fast: !!meta.auto && settings.fast, onProgress: (p) => (c.progress = p) });
      try { c.seconds = await run(); }
      catch (e) {
        // Segundo intento sin lo mas delicado (subtitulos, textos y acabados), para no perder el clip.
        log(`Reintentando en modo sencillo: ${(e as Error).message.slice(0, 200)}`);
        c.note = 'Se exportó sin subtítulos, textos ni acabados por un error: ' + (e as Error).message.slice(0, 140);
        Object.assign(spec, { quality: 'normal', cleanAudio: false, texts: [], title: '', credit: '', blurs: [], progress: false, speed: 1, fadeIn: 0, fadeOut: 0, mutes: [], color: { brightness: 0, contrast: 1, saturation: 1 } });
        spec.captions.on = false; spec.outro.on = false;
        c.seconds = await run();
      }
      Object.assign(c, { status: 'listo', file: `/clips/${id}/clip.mp4`, cover: fs.existsSync(path.join(cdir, 'cover.jpg')) ? `/clips/${id}/cover.jpg` : undefined, progress: undefined, spec: { ...spec, mutes: undefined, captions: { ...spec.captions, words: undefined } } });
      log(`Clip listo: ${c.title || id}`);
      notice('ok', `Clip exportado: ${c.title || id}`, id);
      if (meta.auto) alertPhone(`Clip listo: ${c.title || s.name} (${Math.round(c.seconds || 0)} s). Está en «Clips y publicación».`).catch(() => {});
    } catch (e) {
      Object.assign(c, { status: 'error', error: (e as Error).message.slice(0, 300), progress: undefined });
      log(`Falló el clip: ${(e as Error).message.slice(0, 200)}`);
      notice('mal', `No se pudo exportar «${c.title || id}»: ${(e as Error).message.slice(0, 140)}`, id);
    }
    saveClip(c);
    if (c.status === 'listo') queueAutoTikTokUpload(c);
  });
  return c;
}

/**
 * Varias versiones del mismo clip: prueba de ganchos (A sin gancho, B con gancho, C directo a la accion)
 * y versiones ajustadas a las zonas seguras de cada plataforma.
 */
export function exportMany(raw: any) {
  const { hookTest, platforms, ...spec } = raw;
  const plats: string[] = (Array.isArray(platforms) ? platforms : []).filter((p) => PLATFORMS[p]);
  if (!hookTest && !plats.length) return [exportClip(spec)];
  const s = src(spec.sid);
  const base = sanitize(spec, getTemplate(s.streamer, s));
  const dur = base.end - base.start;
  if (hookTest && dur < 12) throw new Error('La prueba de ganchos necesita un clip de al menos 12 segundos.');
  const cand = s.candidates.find((x) => x.id === spec.candidateId);
  const peak = cand && cand.peak > base.start + 4 && cand.peak < base.end ? cand.peak - base.start : dur * 0.6;
  const group = Date.now().toString(36);
  const out: ClipMeta[] = [];
  for (const p of plats.length ? plats : ['']) for (const h of hookTest ? ['A', 'B', 'C'] : ['']) {
    let v: any = { ...spec };
    if (h === 'A') v.hook = false;
    if (h === 'B') v.hook = true;
    if (h === 'C') {
      // Directo a la accion: se quita el arranque y el clip empieza unos segundos antes del pico.
      const from = Math.max(0, peak - 7);
      v.hook = false;
      v.segments = normalizeSegments(base.segments, dur).map((x) => ({ a: Math.max(x.a, from), b: x.b })).filter((x) => x.b - x.a > 0.3);
    }
    if (p) {
      v = fitPlatform({ ...v, captions: { ...base.captions, ...(v.captions || {}) }, texts: v.texts || base.texts, creditLift: v.creditLift ?? base.creditLift }, p);
      if (dur > PLATFORMS[p].maxSec) v.end = v.start + PLATFORMS[p].maxSec;
    }
    out.push(exportClip(v, { variantOf: group, variant: h, platform: p, learn: !out.length }));
  }
  return out;
}

/** Une varios clips ya exportados en un solo video. */
export function montage(cids: string[], title: string, trans = '', transDur = 0.4) {
  const list = cids.map((id) => clips.get(id)).filter((c): c is ClipMeta => !!c && c.status === 'listo' && !!c.file);
  if (list.length < 2) throw new Error('Elige al menos dos clips ya exportados');
  const id = `${Date.now().toString(36)}-montaje-${slug(title).slice(0, 24) || 'clips'}`;
  const c: ClipMeta = { id, sid: list[0].sid, streamer: list[0].streamer, title: title || 'Montaje', start: 0, end: 0, seconds: list.reduce((a, x) => a + (x.seconds || 0), 0), layout: 'montaje', kind: 'montaje', status: 'renderizando', createdAt: new Date().toISOString() };
  clips.set(id, c);
  enqueueX('Uniendo clips', async () => {
    try {
      await concatClips(list.map((x) => path.join(CLIPS, x.id, 'clip.mp4')), path.join(CLIPS, id), trans ? { id: trans, dur: Math.max(0.2, Math.min(1.2, +transDur || 0.4)), secs: list.map((x) => x.seconds || 0) } : undefined);
      Object.assign(c, { status: 'listo', file: `/clips/${id}/clip.mp4`, cover: `/clips/${id}/cover.jpg` });
      log(`Montaje listo: ${c.title}`);
      notice('ok', `Montaje listo: ${c.title}`, id);
    } catch (e) {
      Object.assign(c, { status: 'error', error: (e as Error).message.slice(0, 300) });
      notice('mal', `No se pudo unir «${c.title}»: ${(e as Error).message.slice(0, 140)}`, id);
    }
    saveClip(c);
    if (c.status === 'listo') queueAutoTikTokUpload(c);
  });
  return c;
}

/** Ajustes con los que se exporto un clip, para volver a abrirlo en el editor. */
export function clipSpec(cid: string) {
  const c = clips.get(cid);
  if (!c?.spec) throw new Error('Este clip no guardó sus ajustes; ábrelo desde «En vivo».');
  if (!sources.has(c.sid)) throw new Error('La grabación de este clip ya no está: se borró de «En vivo».');
  return c.spec;
}

export function removeClip(cid: string) {
  const c = clips.get(cid);
  if (c?.uploading || c?.tiktokUploading) throw new Error('Este clip se está subiendo; espera a que termine para borrarlo.');
  clips.delete(cid);
  if (cid && !cid.includes('..')) fs.rmSync(path.join(CLIPS, cid), { recursive: true, force: true });
}
