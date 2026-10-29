/** Auto edicion: el agente monta un clip solo a partir de un momento. */
import { autoLevel, BRAND_H, type CapWord, keptDuration, pickSilences, segmentsFromSilences, type Spec } from '../media/spec';
import { probe } from '../media/ff';
import { type FaceInfo } from '../ai/faces';
import { followKeys, handheld, twoShot } from '../media/reframe';
import { disliked, kindName } from '../web/prefs.js';
import { autoCapSize, brandTop, detectSilences, geometry, STYLES } from '../media/fast';
import { gridBoxes } from '../web/place.js';
import { autoColor, measureLook } from '../analysis/look';
import { zscores } from '../analysis/detect';
import { direct, readClip } from '../analysis/director';
import { hookExamples, lessonFor, lessonLines } from '../analysis/school';
import { type AgentPlan, dropFromSegments, norm as normWord, planEdit } from '../analysis/agent';
import { ollamaReady } from '../ai/llm';
import { cutFillers, type FillerCut, findFillers } from '../analysis/fillers';
import { faceInfo, faces, faceTrack, findScenes } from './analysis';
import { fixSubs, suggestTitles } from './captions';
import { key, log, settings } from './core';
import { lastAuto, refreshRefStyle, styleFor } from './lab';
import { src, wordsFor } from './preview';
import { energyOf } from './sources';
import { knowledge, SCHOOL_FROM } from './study';
import { getTemplate } from './templates';
import { assets } from './tools';

/** Por donde va cada auto edicion (sid:inicio), para que el editor muestre el porcentaje y el paso. */
const autoSteps = new Map<string, { pct: number; label: string }>();
export const autoProgress = (sid: string, start: number) => autoSteps.get(`${sid}:${Math.round(start)}`) || null;
export async function autoEdit(sid: string, start: number, end: number, candidateId?: string, opts: { level?: number; onStep?: (pct: number, label: string) => void } = {}) {
  const s = src(sid), dur = end - start, cand = s.candidates.find((c) => c.id === candidateId), done: string[] = [];
  const patch: Partial<Spec> = {};
  // El avance va por pasos (lo que tarda cada uno depende del clip): el porcentaje es aproximado.
  const pk = `${sid}:${Math.round(start)}`, step = (pct: number, label: string) => { autoSteps.set(pk, { pct, label }); opts.onStep?.(pct, label); };
  step(5, 'escuchando lo que se dice');
  try { return await autoEditSteps(); } finally { setTimeout(() => autoSteps.delete(pk), 5000).unref(); }
  async function autoEditSteps() {
  // Lo que se dice: subtitulos, stickers y titulo. Sin modelo de voz se sigue con lo demas.
  let words: CapWord[] = [];
  try { words = (await fixSubs(s.streamer, await wordsFor(sid, start, end), false)).words; } catch { /* sin voz */ }
  if (words.length) {
    patch.captions = { ...getTemplate(s.streamer, s).captions, on: true, keywords: true, words } as Spec['captions'];
    done.push('subtítulos');
    // Sin stickers ni gancho: en los clips que funcionan (Westcol, Juansguarnizo) no se usan. Se pueden poner a mano.
  }
  step(25, 'mirando las caras');
  // Camaras y reaccion.
  if (!s.width) Object.assign(s, await probe(s.file).then((p) => ({ width: p.width, height: p.height })));
  let react: FaceInfo | null = null, irl = false; // irl: toda la imagen es la camara (no hay webcam sobre un juego)
  if (settings.faces) {
    try {
      // Primero las caras cada ~1 s (rapido). Si la cara principal se mueve es una camara en la mano (IRL): no hay webcams
      // que buscar ni hace falta mirar quien habla a 10 fps (lo lento); trataba caras del publico como webcams fijas.
      const tr = await faceTrack(sid, start, end).catch(() => null);
      if (tr && handheld(tr.frames)) {
        irl = true;
        const two = twoShot(tr.frames, tr.aspect);
        if (two) { Object.assign(patch, { layout: 'duo', cams: two, cam: two[0], follow: false, camTrack: null }); done.push('dos personas: una arriba y otra abajo'); }
        else {
          const keys = followKeys(tr.frames, tr.w);
          Object.assign(patch, { layout: 'crop', cropX: keys[0]?.x ?? 0.5, cams: undefined, follow: false, camTrack: null, reframe: keys.length > 1 ? keys : null });
          done.push('cámara en la mano: el recorte sigue a la persona');
        }
      } else {
      react = await faceInfo(s, start, end, 10, words);
      // Varias camaras solo si de verdad se turnan al hablar; si habla una sola (o son dos vistas de la misma
      // persona), su camara arriba y el juego abajo.
      const talkers = new Set(react.track.map((k) => k.cam)).size;
      if (react.cams.length >= 2 && talkers < 2) { const c = react.cams[react.track[0]?.cam ?? 0] || react.cams[0]; Object.assign(patch, { layout: 'split', cams: [c], cam: c, follow: false, camTrack: null }); done.push('cámara de quien habla arriba y juego abajo'); }
      else if (react.cams.length >= 4) { Object.assign(patch, { layout: 'grid', cams: react.cams.slice(0, 12), cam: react.cams[0], follow: true, camTrack: react.track.length ? react.track : null }); done.push(`cuadrícula de ${Math.min(12, react.cams.length)} cámaras`); }
      else if (react.cams.length >= 2) { Object.assign(patch, { layout: 'duo', cams: react.cams.slice(0, 4), cam: react.cams[0], follow: true, camTrack: react.track.length ? react.track : null }); done.push(`${Math.min(4, react.cams.length)} cámaras siguiendo a quien habla`); }
      // Una camara que ocupa casi toda la imagen (clip de la comunidad con la camara a pantalla completa): sola, no partida en dos.
      // Si la unica «camara» es mas alta que ancha, no hay recuadro de webcam: toda la imagen es la camara (clip de la
      // comunidad a pantalla completa). Pantalla llena centrada en la cara, no camara arriba y «juego» (la misma persona) abajo.
      else if (react.cams.length === 1 && (react.cams[0].w * (s.width || 1920)) / (react.cams[0].h * (s.height || 1080)) < 1.05) {
        const c = react.cams[0], sw = Math.min(1, 1080 / 1920 / ((s.width || 1920) / (s.height || 1080)));
        Object.assign(patch, { layout: 'crop', cropX: Math.max(0, Math.min(1, (c.x + c.w / 2 - sw / 2) / Math.max(0.01, 1 - sw))), cams: undefined, follow: false, camTrack: null });
        done.push('pantalla llena centrada en la cara');
        irl = true;
        // Dos personas quietas hablando: una arriba y otra abajo. Si no, el recorte sigue a la principal (reframe.ts).
        try {
          const { frames, aspect, w } = tr || (await faceTrack(sid, start, end)), two = twoShot(frames, aspect);
          if (two) { Object.assign(patch, { layout: 'duo', cams: two, cam: two[0], follow: false, camTrack: null }); done.push('dos personas: una arriba y otra abajo'); }
          else {
            const keys = followKeys(frames, w);
            if (new Set(keys.map((k) => k.x)).size > 1) { patch.reframe = keys; done.push('el recorte sigue a la persona'); }
          }
        } catch (e) { log('Auto edición, seguir a la persona: ' + (e as Error).message.slice(0, 120)); }
      }
      else if (react.cams.length === 1 && react.cams[0].w * react.cams[0].h >= 0.35) { Object.assign(patch, { layout: 'cam', cams: react.cams, cam: react.cams[0], follow: false, camTrack: null }); done.push('solo la cámara'); }
      else if (react.cams.length === 1) { Object.assign(patch, { layout: 'split', cams: react.cams, cam: react.cams[0], follow: false, camTrack: null }); done.push('cámara arriba y juego abajo'); }
      }
    } catch (e) { log('Auto edición, caras: ' + (e as Error).message.slice(0, 120)); }
  }
  if (!patch.layout) { patch.layout = 'fit'; done.push('imagen completa'); }
  // Si el directo cambia de escena dentro del clip, cada parte con su encuadre (si no, quedan camaras en negro).
  // En un directo IRL (pantalla llena: toda la imagen es la camara) un «cambio de escena» es la misma camara que se
  // mueve: lo cubre el seguimiento, y partirlo trataba las caras como webcams sobre un juego (recortes borrosos).
  if (settings.faces && !irl) try {
    step(45, 'buscando cambios de escena');
    const sc = await findScenes(s, start, end, patch.cams || [], patch.layout);
    if (sc.length) { patch.scenes = sc; done.push(`${sc.length} cambio${sc.length > 1 ? 's' : ''} de escena con su propio encuadre`); }
  } catch (e) { log('Auto edición, escenas: ' + (e as Error).message.slice(0, 120)); }
  // Estilo a imitar: el de los ejemplos del streamer o el de los videos de referencia (si ya estan medidos).
  // Si se añadieron referencias nuevas se miden en segundo plano para la proxima vez.
  void refreshRefStyle().catch(() => {});
  const style = styleFor(s.streamer), prefs = settings.profiles[key(s.streamer)]?.auto;
  // Lo que el usuario suele quitar al revisar no se propone (y se dice por que).
  const skip = (kind: string) => { if (!disliked(prefs, kind)) return false; done.push(`sin ${kindName(kind)}: sueles quitarlo`); return true; };
  // Como los canales de clips que crecen (terry_play1, clipreel99): el marco con tu @, que hace el video tuyo, y el
  // titulo como gancho amarillo fijo entre las camaras (o bajo la franja de arriba con una sola).
  if (settings.tiktokAccount && !skip('marco')) { patch.brand = { on: true, text: '@' + settings.tiktokAccount.replace(/^@/, '') }; done.push('marco de tu canal'); }
  if (!skip('titulo-gancho')) {
    const lay = patch.layout || 'fit', cams = patch.cams?.length || 0, geo = geometry(lay, s.width || 1920, s.height || 1080, patch.cam || getTemplate(s.streamer, s).cam);
    // Gancho en caja blanca solo los primeros 5 s, como OpusClip (se cambia a «todo el clip» en el editor).
    Object.assign(patch, { titleStyle: 'caja', titleFor: 5 });
    patch.titleY = Math.round(lay === 'split' || lay === 'half' ? geo.camH + (patch.brand?.on && brandTop(lay) ? BRAND_H : 0) : lay === 'duo' && cams >= 2 ? 1920 / Math.min(4, cams) : lay === 'grid' && cams >= 2 ? Math.max(BRAND_H + 70, gridBoxes(Math.min(12, cams)).xy[0][1] - 60) : lay === 'fit' ? geo.titleY : BRAND_H + 110);
  }
  // Fuera los silencios largos (antes que los efectos, para que caigan en lo que se conserva).
  if (!skip('silencios')) try {
    // Solo las pausas que de verdad sobran, segun la agresividad del streamer (Laboratorio; por defecto «Normal»: de
    // mas de 1 s, 3 cortes por minuto, como mucho el 15 % del clip, 0,25 s de margen), con menos cortes si el estilo
    // corta poco, y nunca alrededor del momento fuerte (el silencio antes de una reaccion es parte del chiste).
    const lv = autoLevel(opts.level ?? settings.profiles[key(s.streamer)]?.autoLevel);
    const cpm = style?.profile.cutsPerMin || 8, maxCuts = Math.max(1, Math.round((dur / 60) * Math.min(cpm * 0.4, lv.perMin)));
    const peak0 = cand && cand.by !== 'manual' ? cand.peak - start : NaN;
    const protect = Number.isFinite(peak0) ? [{ a: Math.max(0, peak0 - 3), b: Math.min(dur, peak0 + 2.5) }] : [];
    step(55, 'quitando silencios');
    const raw = await detectSilences(s.file, start, dur), long = raw.filter((x) => x.b - x.a >= lv.minSil);
    const pad = lv.pad, sil = pickSilences(raw, dur, { maxCuts, minSeg: lv.minSeg, minSil: lv.minSil, pad, maxRemove: dur * lv.maxRemove, protect });
    if (!sil.length) done.push(!long.length ? 'sin pausas largas que quitar' : long.every((x) => protect.some((p) => x.a < p.b && x.b > p.a)) ? 'pausas respetadas: están junto al momento fuerte' : 'pausas respetadas: quitarlas troceaba el clip');
    if (sil.length) {
      const segs = segmentsFromSilences(sil, dur, pad);
      patch.segments = segs;
      done.push(`${sil.length} pausa${sil.length > 1 ? 's' : ''} larga${sil.length > 1 ? 's' : ''} fuera (${(dur - keptDuration(segs)).toFixed(1)} s)`);
    }
  } catch { /* sin silencios */ }
  // Luz y color: solo si la imagen lo pide (oscura, plana, apagada o quemada), como el ajuste automatico de CapCut.
  if (!skip('luz')) try {
    step(62, 'ajustando la luz y el color');
    const look = autoColor(await measureLook(s.file, start, dur));
    if (look.needed) { patch.color = look.color; done.push('luz y color corregidos (' + look.why.join(', ') + ')'); }
  } catch { /* sin medida, sin cambio */ }
  // Final cuidado: un desvanecido corto (imagen y sonido), como el que pone CapCut al final de la pista principal.
  if (!(getTemplate(s.streamer, s).fadeOut > 0) && !skip('final')) { patch.fadeOut = 0.5; done.push('desvanecido al final'); }
  const who = (s.streamer || '').toLowerCase(), energy = energyOf(sid).slice(Math.max(0, Math.floor(start)), Math.ceil(end));
  const energyZ = energy.length ? zscores(energy) : [], reactIn = react && react.react > 0 ? { at: react.at, react: react.react, cam: react.cam } : null;
  // El agente editor (IA local y gratis con Ollama): que frase engancha, que frases sobran, donde esta el remate, que
  // palabras resaltar y el titulo. Sin Ollama, o si falla, todo sigue como antes con las reglas.
  // Lo aprendido en la escuela, para el tono de este clip. Si el estilo viene de la escuela, el de ese tono.
  const reading = readClip({ words, energyZ, dur, react: reactIn });
  const lesson = lessonFor(knowledge, reading.mood);
  const dstyle = lesson && style?.from === SCHOOL_FROM(knowledge!.n) ? { profile: lesson.style, from: style.from } : style;
  let plan: AgentPlan | null = null;
  if (words.length >= 6 && (await ollamaReady())) {
    try {
      const maxBeats = Math.max(2, Math.round((dur / 60) * Math.max(3, (dstyle?.profile.zoomsPerMin || 2) * 3)));
      const desc = dstyle ? `planos de ${dstyle.profile.shotMed} s, ${dstyle.profile.zoomsPerMin} zooms por minuto, ${Math.round(dstyle.profile.transRatio * 100)} % de transiciones` : undefined;
      step(70, 'el agente decide la edición');
      plan = await planEdit({ words, beats: reading.beats, dur, streamer: s.streamer, maxBeats, style: desc, lessons: lessonLines(knowledge, reading.mood), hooks: hookExamples(knowledge, reading.mood).slice(0, 3) });
      if (plan && knowledge) done.push(`agente con lo aprendido de ${knowledge.n} shorts`);
    } catch (e) { log('Agente editor: ' + (e as Error).message.slice(0, 140)); }
  }
  if (plan) {
    if (plan.drop.length) {
      // Red de seguridad: nunca dejar el clip en menos de la mitad.
      const segs = dropFromSegments(patch.segments || [{ a: 0, b: dur }], plan.drop.map((x) => x.seg));
      if (segs.reduce((t, x) => t + x.b - x.a, 0) >= dur * 0.5) { patch.segments = segs; done.push(`${plan.drop.length} frase${plan.drop.length > 1 ? 's' : ''} que no aporta${plan.drop.length > 1 ? 'n' : ''} fuera`); }
      else plan.drop = [];
    }
    if (plan.highlight.length && patch.captions?.words) {
      const hl = new Set(plan.highlight);
      patch.captions = { ...patch.captions, words: patch.captions.words.map((w) => (hl.has(normWord(w.text)) ? { ...w, hi: true } : w)) };
    }
  }
  // Muletillas y repeticiones (el «corte de video hablado» de CapCut). Van aparte de los silencios para revisarlas aparte.
  let fillers: FillerCut[] = [];
  if (words.length && !skip('muletillas')) {
    fillers = cutFillers(patch.segments || [{ a: 0, b: dur }], findFillers(words)).applied;
    const m = fillers.filter((f) => f.kind === 'muletilla').length, r = fillers.length - m;
    if (fillers.length) done.push([m ? `${m} muletilla${m > 1 ? 's' : ''}` : '', r ? `${r} repetici${r > 1 ? 'ones' : 'ón'}` : ''].filter(Boolean).join(' y ') + ' fuera');
  }
  const kept = fillers.length ? cutFillers(patch.segments || [{ a: 0, b: dur }], fillers).segments : patch.segments;
  // El director lee el tono del clip y reparte zooms, golpes, sonidos y transiciones a ritmo (con el plan del agente si lo hay).
  // Repeticion a camara lenta del momento mas fuerte, al final (como las repeticiones de CapCut y del deporte): solo
  // con algo que repetir (risa, subidon, sorpresa; en una charla no pega) y en clips cortos.
  if (reading.mood !== 'charla' && dur >= 15 && dur <= 75 && !skip('repeticion')) {
    const inKept = (t: number) => !kept?.length || kept.some((x) => t - 1.2 >= x.a && t + 1.3 <= x.b);
    const top = [...reading.beats].filter((b) => b.kind !== 'clave' && inKept(b.t)).sort((x, y) => y.w - x.w)[0];
    if (top && top.w >= 2) { patch.replay = { a: Math.max(0, top.t - 1.2), b: Math.min(dur, top.t + 1.3), speed: 0.5 }; done.push('repetición a cámara lenta del mejor momento'); }
  }
  // Tres propuestas (como los planes candidatos de CapCut): comparten lo caro (voz, caras, silencios, agente) y solo
  // cambia cuanto se edita. La equilibrada es la principal.
  const shared = JSON.parse(JSON.stringify(patch)) as Partial<Spec>;
  // Con una sola camara a la vista, el zoom cambia cada ~3,5 s (acerca y vuelve), como clipreel99; sin pisar los que ya hay.
  const zoomBeat = (p: Partial<Spec>, d: string[]) => {
    if (!['cam', 'crop'].includes(p.layout || '') || skip('zoom-ritmo')) return;
    const have = [...(p.zooms || []), ...(p.punches || [])], add: Spec['zooms'] = [];
    for (let t = 1.5, i = 0; t + 3.5 <= dur - 0.5; t += 3.5, i++) {
      if (i % 2) continue; // uno si y uno no: acerca y vuelve
      const a = t, b = t + 3.5;
      if (have.some((z) => z.a < b + 0.3 && z.b > a - 0.3)) continue;
      add.push({ id: 'zr' + i, a, b, scale: i % 4 ? 1.12 : 1.2, why: 'ritmo' });
    }
    if (add.length) { p.zooms = [...(p.zooms || []), ...add].sort((x, y) => x.a - y.a); d.push(`zoom con ritmo cada 3,5 s (${add.length})`); }
  };
  // Transiciones solo en los cambios de escena (como Juansguarnizo): en los cortes normales, corte seco.
  const sceneTr = (p: Partial<Spec>, d: string[]) => {
    const at = [...new Set((p.scenes || []).flatMap((x) => [x.a, x.b]))].filter((t) => t > 0.6 && t < dur - 0.6);
    if (!at.length) return;
    Object.assign(p, { transition: 'fade', transDur: 0.35, transCuts: false, transAt: at });
    d.push(`fundido en ${at.length === 1 ? 'el cambio' : `los ${at.length} cambios`} de escena`);
  };
  const directed = (intensity: number, seedTag: string) => {
    const d = direct({
      // Sin golpe de reaccion en un directo IRL (pantalla llena): acercaba a un recuadro de webcam que ahi no existe.
      words, energyZ, dur, react: irl ? null : reactIn, agent: plan, intensity,
      multiCam: (shared.cams?.length || 0) > 1, segments: kept, hook: !!shared.hook, sfx: assets().sfx, styles: Object.keys(STYLES), style: dstyle?.profile, prefs,
      seed: `${sid}:${Math.round(start)}${seedTag}`, last: lastAuto.get(who),
    });
    const { captions: dc, ...rest } = d.patch, p: Partial<Spec> = { ...JSON.parse(JSON.stringify(shared)), ...rest };
    if (p.captions && dc) p.captions = { ...p.captions, ...dc };
    if (p.captions?.style) p.captions.size = autoCapSize(p.captions.style);
    zoomBeat(p, d.done);
    sceneTr(p, d.done);
    return { patch: p, done: d.done };
  };
  const main = directed(1, '');
  Object.assign(patch, main.patch);
  done.push(...main.done);
  const variants = [{ id: 'equilibrada', name: 'Equilibrada', patch }, { id: 'dinamica', name: 'Dinámica', ...directed(1.8, ':d') }, { id: 'sobria', name: 'Sobria', ...directed(0.4, ':s') }]
    .map(({ id, name, patch: p }) => ({ id, name, patch: p }));
  lastAuto.set(who, { style: patch.captions?.style, transition: patch.transition });
  // Titulo y descripcion con el estilo de las tendencias.
  const text = words.filter((w) => !w.del).map((w) => w.text).join(' ');
  if (text) {
    step(90, 'escribiendo el título');
    const t = await suggestTitles(sid, text).catch(() => null);
    if (plan?.title) { patch.title = plan.title; done.push('título del agente'); }
    else if (t?.titles[0]) { patch.title = t.titles[0]; done.push('título'); }
    if (t) patch.description = [t.description, t.hashtags.join(' ')].filter(Boolean).join(' ');
  }
  for (const v of variants.slice(1)) Object.assign(v.patch, { title: patch.title, description: patch.description });
  // La propuesta que el usuario suele elegir (con al menos unas cuantas revisiones) se le muestra primero.
  const share = (id: string) => { const [k, r] = prefs?.['propuesta:' + id] || [0, 0]; return k + r >= 2.5 ? k / (k + r) : -1; };
  const prefer = [...variants].sort((x, y) => share(y.id) - share(x.id))[0].id;
  return { patch, done, fillers, variants, prefer, style: dstyle ? { ...dstyle.profile, from: dstyle.from } : null, agent: plan ? { hook: plan.hook?.why || null, drops: plan.drop.map((x) => ({ ...x.seg, why: x.why })) } : null };
  }
}
