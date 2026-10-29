/** Estado compartido del editor, constantes y setters. */
import { icon } from '/web/icons.js';

export const ICON = {"lento": "M12 5a8 8 0 100 16 8 8 0 000-16zM12 9v4l2.5 2.5M9.5 2.5h5", "trans": "M3 5h7v14H3zM14 5h7v14h-7zM8 12h8M14 9.5l2.5 2.5-2.5 2.5", "recorte": "M6 3a3 3 0 100 6 3 3 0 000-6zM6 15a3 3 0 100 6 3 3 0 000-6zM20 4L8.5 16M20 20L8.5 8", "encuadre": "M8 3h8a2 2 0 012 2v14a2 2 0 01-2 2H8a2 2 0 01-2-2V5a2 2 0 012-2zM6 10h12", "imagen": "M12 4a8 8 0 100 16 8 8 0 000-16zM12 4v16M12 12l6-5", "subs": "M6 5h12a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3V8a3 3 0 013-3zM7 14h4M13 14h4M7 10h10", "texto": "M5 6V4h14v2M12 4v16M9 20h6", "stickers": "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h7l7-7zM13 20v-5a2 2 0 012-2h5", "sonido": "M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4", "zoom": "M11 5a6 6 0 100 12 6 6 0 000-12zM20 20l-4.5-4.5M11 8v6M8 11h6", "censura": "M3 3l18 18M10.6 6.2A9 9 0 0121 12a13 13 0 01-2.3 3M6.3 7.6A13 13 0 003 12a9 9 0 0012 5.4", "publicar": "M12 15V4M7 9l5-5 5 5M5 20h14"};

// El lienzo a 2/3 de la resolucion final: a la mitad (540) se veia borroso en el visor; a 1080 «crop» perdia fluidez.
export const W = 1080, H = 1920, CW = 720, CH = 1280;
// Herramientas en el orden de trabajo, por grupos: [grupo, [clave, nombre]...]. Las teclas 1-9 abren las nueve primeras y 0 la ultima (Publicar).
export const GROUPS = [['Clip', [['recorte', 'Recorte'], ['encuadre', 'Encuadre']]], ['Contenido', [['subs', 'Subtítulos'], ['texto', 'Texto'], ['stickers', 'Stickers'], ['sonido', 'Sonido']]], ['Efectos', [['zoom', 'Zoom'], ['trans', 'Transiciones'], ['lento', 'Lento'], ['imagen', 'Imagen']]], ['Final', [['censura', 'Censura'], ['publicar', 'Publicar']]]];
export const TOOLS = GROUPS.flatMap(([, t]) => t);
// Lo que se ajusta de todo el clip, siempre a la vista en la barra de arriba (como la barra de herramientas de DaVinci).
// Lo que se añade (textos, stickers, sonidos, transiciones, efectos) esta en la biblioteca de la izquierda, como en CapCut.
export const ticon = (k) => icon({ lento: 'slow', capas: 'layers', efectos: 'efectos' }[k] || k) || `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
// codigo de cada pista, como en Resolve (V1 video, S1 subtitulos, A1 audio...)
export const TCODE = { scene: 'V2', video: 'V1', subs: 'S1', spk: 'C1', txt: 'T1', stk: 'T2', sfx: 'A1', punch: 'E1', zoom: 'E2', blur: 'E3', cen: 'E4' };
export const FN_TOOLS = ['recorte', 'encuadre', 'subs', 'zoom', 'lento', 'imagen', 'censura', 'publicar'];
// Que herramienta edita cada tipo de bloque de la linea de tiempo.
export const KIND_TOOL = { scenes: 'encuadre', seg: 'recorte', texts: 'texto', stickers: 'stickers', sfx: 'sonido', zooms: 'zoom', punches: 'zoom', blurs: 'censura', title: 'texto', captions: 'subs', frame: 'encuadre' };
export const KIND_NAME = { scenes: 'Encuadre', seg: 'Tramo', texts: 'Texto', stickers: 'Sticker', sfx: 'Efecto de sonido', zooms: 'Zoom', punches: 'Golpe', blurs: 'Zona difuminada', title: 'Título', captions: 'Subtítulos', frame: 'Zona del vídeo' };
/** Lo que se toca directamente en la vista previa: se selecciona ahi y el inspector enseña sus propiedades. */
export const CANVAS_KINDS = ['texts', 'stickers', 'zooms', 'title', 'captions', 'frame'];
// Las mismas letras que el exportador (spec.ts TEXT_FONTS).
export const FONTS = ['Montserrat Black', 'Anton', 'Bebas Neue'];
export const SWATCHES = [['#FFFFFF', 'Blanco'], ['#FFB020', 'Ámbar'], ['#FF642E', 'Naranja'], ['#FF4267', 'Coral'], ['#34D399', 'Verde'], ['#60A5FA', 'Azul']];
export const PRESETS = { normal: ['Normal', { brightness: 0, contrast: 1, saturation: 1 }], vivo: ['Vivo', { brightness: 0.02, contrast: 1.08, saturation: 1.35 }], cine: ['Cine', { brightness: -0.03, contrast: 1.15, saturation: 0.85 }], bn: ['Blanco y negro', { brightness: 0, contrast: 1.1, saturation: 0 }] };
export const ZC = { cam: ['#FFB020', 'Cámara'], game: ['#60A5FA', 'Juego'], blur: ['#FF4267', 'Difuminar'] };
export const LAYOUTS = [['split', 'Cámara + juego', [0, 0, 100, 36]], ['fit', 'Completo', [0, 34, 100, 32]], ['crop', 'Pantalla llena', [0, 0, 100, 100]], ['pip', 'Cámara redonda', [56, 6, 36, 21, 50]], ['half', 'Mitad y mitad', [0, 0, 100, 50]], ['cam', 'Solo cámara', [10, 20, 80, 60]], ['duo', 'Varias cámaras', [8, 4, 84, 44]], ['float', 'Cámaras flotantes', [12, 8, 76, 26, 14]], ['grid', 'Cuadrícula', [4, 22, 44, 26]]];
/** Estilos rapidos sacados de los clips de referencia; se guardan como plantilla del streamer. */
export const STYLE_PRESETS = {
  charla: ['Charla 2 streamers', { layout: 'duo', follow: true, autoPunch: true, flash: false, titleStyle: 'caja', captions: { style: 'amarillo', perChunk: 1, posY: 50 } }],
  flotantes: ['Juego + cámaras flotantes', { layout: 'float', follow: true, autoPunch: true, flash: true, titleStyle: 'caja', captions: { style: 'cursiva', perChunk: 1, posY: 66 } }],
  meme: ['Meme', { layout: 'fit', fitBg: 'negro', autoPunch: false, flash: false, titleStyle: 'meme', captions: { style: 'recuadro', perChunk: 3, posY: 70 } }],
};
export const SFX_NAMES = { boom: 'Golpe grave', ding: 'Campana', pop: 'Pop', whoosh: 'Barrido', riser: 'Subida', error: 'Error' };
export const uid = () => Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const KEY = /^(no+|nunca|jam[aá]s|incre[ií]ble|imposible|brutal|locura|loco|gan[eéó]|perd[ií]|muerto|mat[oóe]|mierda|wtf|omg|dios|clip\w*|[a-záéíóúñ]*jaj\w*|\d+k?)$/i;
export const isKeyword = (w) => KEY.test(w.replace(/[^\p{L}\p{N}]/gu, '')) || /[!?]$/.test(w);

export let E = null, assetsCache = null, raf = 0, tplTimer = 0;
/** Arrastre en curso (linea de tiempo, zonas o vista previa): `move` en cada pointermove, `up` al soltar. */
export let drag = null;
// Los modulos del editor leen estas variables como enlaces vivos; solo se reasignan con estos setters.
export const setE = (v) => (E = v);
export const setAssetsCache = (v) => (assetsCache = v);
export const setRaf = (v) => (raf = v);
export const setTplTimer = (v) => (tplTimer = v);
export const setDrag = (v) => (drag = v);
