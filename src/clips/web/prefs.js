// Preferencias aprendidas de la revision de la auto edicion. Lo usan el editor (que etiqueta cada propuesta) y el
// director (que deja de proponer lo que el usuario quita casi siempre). Mismos nombres en los dos lados.

/** Tipo de una propuesta: lo que se cuenta al aceptar o quitar. */
export const kindOf = {
  zoom: (scale) => (scale >= 1.3 ? 'zoom-fuerte' : 'zoom-suave'),
  sfx: (file) => 'sonido:' + String(file).replace(/\.\w+$/, ''),
  transition: (id) => 'transicion:' + id,
  captions: (style) => 'subtitulos:' + style,
};
export const KIND_NAME = { marco: 'el marco del canal', 'titulo-gancho': 'el título gancho en el centro', 'zoom-ritmo': 'el zoom con ritmo',
  'zoom-fuerte': 'zooms fuertes', 'zoom-suave': 'zooms suaves', golpe: 'golpes de reacción', sticker: 'stickers', gancho: 'el gancho',
  silencios: 'quitar silencios', muletillas: 'quitar muletillas y repeticiones', final: 'el desvanecido final', luz: 'corregir luz y color', repeticion: 'la repetición a cámara lenta', encuadre: 'el cambio de encuadre', titulo: 'el título', barra: 'la barra de progreso', destello: 'los destellos',
};
export const kindName = (k) => KIND_NAME[k] || (k.startsWith('propuesta:') ? 'la propuesta «' + k.slice(10) + '»' : '') || (k.startsWith('sonido:') ? 'el sonido «' + k.slice(7) + '»' : k.startsWith('transicion:') ? 'esa transición' : k.startsWith('subtitulos:') ? 'ese estilo de subtítulos' : k);

/**
 * Con cuantas decisiones (pesadas) sobre un tipo ya se le hace caso, y por debajo de que proporcion de «conservar» se
 * deja de proponer. Cada revision nueva hace que lo anterior pese un 15 % menos: los gustos cambian y manda lo reciente.
 */
export const MIN_SEEN = 2.5, DROP_BELOW = 0.3, DECAY = 0.85;
/**
 * Lo que el usuario suele quitar: al menos MIN_SEEN decisiones y conservado menos de DROP_BELOW de las veces.
 * `prefs` es { tipo: [conservadas, quitadas] }.
 */
export function disliked(prefs, kind) {
  const [k, r] = (prefs && prefs[kind]) || [0, 0];
  return k + r >= MIN_SEEN && k / (k + r) < DROP_BELOW;
}
/**
 * Suma las decisiones de una revision. Solo pierde peso lo que se vuelve a decidir: lo que ya no se propone (porque se
 * quitaba) conserva su historial; si no, al dejar de proponerlo se olvidaria y volveria a salir.
 */
export function addDecisions(prefs, items) {
  const r3 = (v) => Math.round(v * 1000) / 1000, out = { ...(prefs || {}) }, seen = new Set();
  for (const { kind, on } of items) {
    if (!kind) continue;
    let [k, r] = out[kind] || [0, 0];
    if (!seen.has(kind)) { seen.add(kind); k = r3(k * DECAY); r = r3(r * DECAY); }
    out[kind] = on ? [k + 1, r] : [k, r + 1];
  }
  return out;
}
