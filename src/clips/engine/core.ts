/** Estado compartido del motor: tipos, fuentes y clips en memoria, ajustes, registro, avisos y colas de trabajo. */
import path from 'node:path';
import { PUBLIC, readJson, ROOT, writeJson } from '../../shared/fs';
import { type Word } from '../../shared/timing';
import { type Features, type Model } from '../analysis/learn';
import { type FaceSignal } from '../analysis/detect';
import { type Spec } from '../media/spec';
import { type StyleSample } from '../analysis/refstyle';
import { type Prefs } from '../web/prefs.js';
import { type Fixes } from '../media/subfix';
import { type Trend } from '../analysis/trends';
import { type TikTokCfg } from '../analysis/school';
import { ChatTap } from '../analysis/chat';
import { setFaceLog } from '../ai/faces';
import fs from 'node:fs';
import { transcribe } from '../ai/transcribe';

export const MEDIA = path.join(ROOT, 'media');
export const CLIPS = path.join(PUBLIC, 'clips');
export const PORT = Number(process.env.PORT || 4300);
export const DATA = path.join(ROOT, 'data');
export const SETTINGS = path.join(DATA, 'settings.json');
export const TEMPLATES = path.join(DATA, 'templates.json');

export type Candidate = {
  id: string; peak: number; z: number; zChat?: number; zVis?: number; start: number; end: number; base?: number;
  score: number; why: string; title: string; text: string; label?: string; by: 'audio' | 'ia' | 'manual' | 'chat' | 'comunidad';
  /** Numero de generacion: el orden en que se creo en su fuente (1 = el primero). */
  n?: number;
  /** Vistas del clip que la comunidad hizo de este momento (Twitch o Kick): sube la nota. */
  clipped?: number;
  /** En directo: hasta donde deberia llegar el tramo cuando haya mas grabado, y si aun falta por avisar o exportar. */
  endWant?: number; wait?: boolean;
  words?: Word[]; features?: Features; hidden?: boolean; exported?: boolean; alerted?: boolean;
  /** Caras: reaccion, gesto, cambios de quien habla por minuto y cuantas camaras hay. */
  face?: FaceSignal & { cams: number };
  /** Se recorto para quitar un anuncio de Twitch. */
  noAds?: boolean;
};
export type Source = {
  id: string; name: string; streamer: string; origin: string; file: string; live: boolean;
  status: 'descargando' | 'grabando' | 'analizando' | 'listo' | 'error';
  progress?: string; error?: string; chat?: string; duration: number; width: number; height: number;
  analyzedTo: number; sceneTo?: number; candidates: Candidate[]; createdAt: string;
  /** «Hacer los clips solo»: al terminar el analisis se auto editan y exportan los mejores (story.ts › pickClips; una vez; nunca se suben). */
  autoClips?: boolean;
  /** Hasta donde se buscaron anuncios, y los tramos encontrados [inicio, fin] en segundos. */
  adsTo?: number; ads?: [number, number][];
  /** Intro y despedida del directo (detect.ts › introSpans): sin momentos, como los anuncios. */
  intro?: [number, number][];
  /** Idioma: 'mix' = en ingles o mezclado: los subtitulos se pasan al español (toSpanish); sin valor, español. */
  lang?: 'mix';
  /** VOD de Twitch o Kick: cuando empezo el directo (ms; 0 = no se sabe) y su canal, para cruzar los clips de la comunidad. */
  streamStart?: number; streamChannel?: string;
  /** Proceso que graba el directo: sigue vivo aunque se cierre la app, y al abrirla se vuelve a enganchar. */
  recPid?: number;
  /** Directo cuya grabacion se corto al cerrar la app. */
  cut?: boolean;
  /** Fuente importada desde los clips de la comunidad. */
  community?: { title: string; views: number; at?: [number, number] };
};
/** Momentos que no se puntuan ni se reajustan solos: los guarda el usuario, los pide el chat o los clipeo la comunidad. */
export const pinned = (c: Candidate) => c.by === 'manual' || c.by === 'chat' || c.by === 'comunidad';
export type ClipMeta = {
  id: string; sid: string; streamer: string; title: string; description?: string; start: number; end: number; seconds?: number;
  layout: string; by?: string; kind: 'clip' | 'montaje';
  status: 'en cola' | 'auto edición' | 'transcribiendo' | 'renderizando' | 'listo' | 'error';
  progress?: number; error?: string; note?: string; file?: string; cover?: string; createdAt: string;
  scheduledAt?: string; youtubeId?: string; viewsYt?: number; viewsOther?: number; /** Vistas en TikTok (a las 24 h) y su video. */ viewsTt?: number; tiktokId?: string; uploading?: boolean; spec?: Spec;
  tiktokAt?: string; tiktokUploading?: boolean; /** Hora a la que se programo en TikTok (Clipper la elige si no se puso una). */ tiktokPlan?: string; /** Progreso de las subidas en curso (0-100) y en que va TikTok. */ ytPct?: number; ttPct?: number; ttStep?: string;
  cand?: string; features?: Features; text?: string; viewLabel?: number;
  variantOf?: string; variant?: string; platform?: string; // prueba de ganchos y versiones por plataforma
};
/** Lo que se mide de un clip de ejemplo: cuanto dura, donde cae el pico, cuanto se habla y cuantos cortes tiene. */
export type Example = { id: string; url: string; title: string; seconds: number; peakPos: number; wps: number; hype: number; cuts: number; at: string; style?: StyleSample };
export type Profile = { words: string[]; counts: Record<string, number>; examples: Example[]; useLength: boolean; names?: string[]; /** Agresividad de la auto edicion: 0 suave, 1 normal, 2 intensa (Laboratorio). */ autoLevel?: number; /** Lo que conserva o quita en la revision de la auto edicion. */ auto?: Prefs; /** Palabras que el modelo de voz oye mal con este streamer y como se escriben (aprendidas de sus correcciones). */ fixes?: Fixes };
export type Settings = {
  notifyScore: number; autoScore: number; cleanDays: number; visual: boolean;
  /** Mirar las caras: camaras de los participantes, quien habla y sus reacciones. */
  faces: boolean;
  watch: { url: string; streamer: string }[];
  models: Record<string, Model>;
  profiles: Record<string, Profile>;
  fast: boolean; discord: string; telegramToken: string; telegramChat: string;
  /** Lo que funciona ahora en Shorts con cada streamer (ver trends.ts). */
  trends?: Record<string, Trend>;
  /** Escuela del agente: estudiar shorts que funcionan en segundo plano (por defecto, si). */
  school?: boolean;
  /** Creadores y hashtags de TikTok que estudia la escuela (con la sesion del usuario, ver tiktok.ts). */
  tiktok?: TikTokCfg;
  /** Subida de clips a TikTok, independiente de la escuela de tendencias. */
  tiktokAccount?: string; tiktokVisibility?: 'everyone' | 'friends' | 'private'; tiktokAuto?: boolean; /** Programar cada subida en la mejor franja y separada de las demas (por defecto, si). */ tiktokSmart?: boolean;
};
export type Template = Omit<Spec, 'sid' | 'start' | 'end'>;

export const sources = new Map<string, Source>();
export const clips = new Map<string, ClipMeta>();
/** Siguiente numero de momento de cada fuente: el orden en que se van creando. */
export const momSeq = new Map<string, number>();
// Procesos de descarga o grabacion. Una grabacion de directo puede venir de una sesion anterior de la app (solo su pid).
type Proc = { pid?: number; kill: (sig?: NodeJS.Signals) => boolean };
export const procs = new Map<string, Proc>();
export const taps = new Map<string, ChatTap>();
export const settings: Settings = { notifyScore: 7.5, autoScore: 0, cleanDays: 0, visual: true, faces: true, watch: [], models: {}, profiles: {}, fast: false, discord: '', telegramToken: '', telegramChat: '', tiktokAccount: '', tiktokVisibility: 'everyone', tiktokAuto: false };
export let templates: Record<string, Template> = {};
/** `templates` solo se reasigna aqui: los demas modulos la leen como enlace vivo. */
export const replaceTemplates = (t: Record<string, Template>) => { templates = t; };

/** Registro visible en la app, para saber que esta pasando y poder copiar los errores. */
export const logs: { at: string; msg: string }[] = [];
export function log(msg: string) {
  logs.push({ at: new Date().toTimeString().slice(0, 8), msg: msg.slice(0, 400) });
  if (logs.length > 200) logs.shift();
  console.log('  ' + msg);
}
type Notice = { at: string; kind: 'cola' | 'curso' | 'ok' | 'mal'; msg: string; cid?: string; link?: string };
export const notices: Notice[] = [];
let noticeSeq = 0;
/** Aviso para la campana: lo que el usuario quiere saber sin mirar el registro. */
export function notice(kind: Notice['kind'], msg: string, cid?: string, link?: string) {
  // La hora lleva milisegundos unicos para que el navegador sepa cuales no ha visto.
  const at = new Date(Math.max(Date.now(), noticeSeq + 1));
  noticeSeq = +at;
  notices.push({ at: at.toISOString(), kind, msg: msg.slice(0, 200), cid, link });
  if (notices.length > 100) notices.shift();
}
setFaceLog(log);

export const dir = (sid: string) => path.join(MEDIA, sid);
export const save = (s: Source) => writeJson(path.join(dir(s.id), 'meta.json'), s);
export const saveClip = (c: ClipMeta) => writeJson(path.join(CLIPS, c.id, 'meta.json'), c);
export const saveSettings = () => writeJson(SETTINGS, settings);
export const jsonFile = (sid: string, name: string) => path.join(dir(sid), name + '.json');
export const loadArr = (sid: string, name: string): number[] => (fs.existsSync(jsonFile(sid, name)) ? readJson(jsonFile(sid, name)) : []);
export const key = (streamer: string) => (streamer || 'general').toLowerCase().replace(/^@/, '');
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
export const nextMom = (s: Source) => { const n = (momSeq.get(s.id) || 0) + 1; momSeq.set(s.id, n); return n; };

// ---------- colas de trabajo ----------
// El analisis y la exportacion van por colas distintas: exportar un clip nunca espera a que termine un analisis.
export const active = new Set<string>();
export function makeQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(label: string, fn: () => Promise<T>) => {
    const p = chain.then(async () => {
      active.add(label);
      try { return await fn(); } finally { active.delete(label); }
    });
    chain = p.catch(() => {});
    return p;
  };
}
export const enqueueA = makeQueue();
export const enqueueX = makeQueue();
const asrQueue = makeQueue();
export const analyzing = new Set<string>();
/** El reconocimiento de voz se usa de uno en uno. */
export const listen = (file: string, start: number, dur: number) => asrQueue('', () => transcribe(file, start, dur));
