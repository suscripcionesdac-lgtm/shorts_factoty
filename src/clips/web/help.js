// Ayuda dentro de la app: botones «?» que abren una hoja lateral con pasos, y un recorrido guiado la primera vez.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Cada tema: titulo, para que sirve, y los pasos. `g` es el grupo en el indice. */
export const HELP = {
  empezar: { g: 'Primeros pasos', t: 'Sacar tu primer clip', d: 'De un enlace a un clip vertical listo para subir.', s: [
    'Pega arriba el enlace del canal (Kick, Twitch o YouTube) o de un video ya terminado, y pulsa «Añadir».',
    'Si es un canal en directo, la app lo graba mientras emite. Si es un video, lo descarga y lo analiza entero.',
    'A la derecha van apareciendo los «Momentos», ordenados por puntuación. Haz clic en uno para abrirlo.',
    'Pulsa «Editar» para ajustarlo, o «Exportar ya» para sacarlo con la plantilla de ese streamer.',
    'El clip aparece en «Clips», donde lo descargas o lo programas.'] },
  grabar: { g: 'Primeros pasos', t: 'Grabar un directo', d: 'Qué hace la app mientras el streamer está en vivo.', s: [
    'Pega el enlace del canal con «en vivo» marcado. La etiqueta roja REC indica que está grabando.',
    'Cada cierto tiempo revisa lo nuevo y añade momentos a la lista. En «Ajustes» puedes activar el modo rápido, que revisa cada 20 segundos.',
    'Si ves algo bueno, pulsa 30, 45, 60 o 90 s para guardar lo que acaba de pasar. La barra espaciadora guarda los últimos 45 s.',
    'Con «Guardar por voz» basta decir «clip» (Chrome o Edge).',
    'Al terminar pulsa «Detener grabación». La grabación queda disponible para seguir sacando clips.'] },
  vigilar: { g: 'Primeros pasos', t: 'Vigilar canales', d: 'Que la app grabe sola cuando un streamer entra en directo.', s: [
    'Pulsa el ojo de la barra de arriba y escribe el canal, por ejemplo kick.com/canal.',
    'La app comprueba cada pocos minutos si está en vivo y empieza a grabar sola.',
    'Deja abierta la ventana negra de Clipper: si la cierras, deja de vigilar.'] },
  momentos: { g: 'Media', t: 'Entender los momentos', d: 'Por qué la app elige cada tramo y cómo corregirla.', s: [
    'La puntuación (0 a 10) sale de varias señales: volumen, chat, reacción en lo que se dice, imagen y caras (gestos de sorpresa, risa o susto en las cámaras, y conversaciones con idas y vueltas). Al abrir un momento ves cuánto pesó cada una.',
    '«Sin exportar» esconde lo que ya sacaste y lo repetido. «Tuyos» deja solo los que guardaste tú o pidió el chat.',
    '«Por generación» numera los momentos en orden (#1, #2…) y separa los generados por Clipper de los importados de la comunidad.',
    '«Por minuto» los agrupa en bloques de 10 minutos que se pueden plegar.',
    '«Descartar» quita un momento y le enseña a la app que ese tipo no te sirve. Exportar le enseña lo contrario.',
    'Marca varios con el círculo de la izquierda y pulsa «Exportar el lote» para sacarlos juntos.'] },
  directo: { g: 'Media', t: 'El directo en tiempo real', d: 'Imagen, repetición, medidor de hype y chat mientras se graba.', s: [
    'La imagen se actualiza cada pocos segundos. La etiqueta dice con cuántos segundos de retraso va respecto al directo real.',
    '«Hype ahora» va de 0 a 100: mezcla el volumen y el ritmo del chat de los últimos segundos, comparados con lo normal de ese directo. Las barras son el volumen de los últimos 2 minutos; la línea azul, el chat.',
    'Cuando el medidor se dispara, la app analiza en ese instante en vez de esperar: el momento aparece en la lista a los pocos segundos, con la etiqueta «en curso» hasta que termina de grabarse su final.',
    '«Repetir» 15 s, 30 s, 1 min o 2 min reproduce lo que acaba de pasar sin dejar de grabar. Si te sirve, pulsa «Guardar este tramo». La tecla R repite los últimos 30 s.',
    'El chat se ve tal cual llega; en verde, los mensajes de risa, sorpresa o que piden clip. Funciona con Kick y Twitch.',
    'No es un reproductor en vivo: para ver el directo con sonido deja abierta la pestaña del canal. Aquí tienes la repetición y las señales.'] },
  ortografia: { g: 'Editor', t: 'Corregir los subtítulos', d: 'Ortografía, tildes, mayúsculas y nombres mal transcritos, sin perder la sincronía.', s: [
    'En «Subtítulos», pulsa «Corregir ortografía». Las palabras que cambian quedan subrayadas; Ctrl+Z lo deshace.',
    'Sin IA corrige lo seguro: tildes que no admiten duda (también, había, después), abreviaturas de chat, mayúscula inicial, signos ¿ ¡ que faltan y marcas como [Música].',
    'Con Ollama activo (OLLAMA_MODEL en el archivo .env) corrige además palabras mal reconocidas por el contexto. Si la IA reescribe el texto en vez de corregirlo, se descarta y queda lo básico.',
    'En «Nombres y palabras propias» apunta cómo se escriben el streamer, sus amigos, el juego o su jerga: Westcol, Kick, parcero. Se guardan por streamer y se respetan siempre.',
    'Con «Corregir también en Exportar ya» la corrección se aplica sola a los clips que salen sin pasar por el editor.',
    'Nunca cambia lo que se dijo ni tapa groserías: para eso está «Censura».'] },
  disco: { g: 'Ajustes', t: 'Liberar espacio en disco', d: 'Una hora de directo ocupa entre 1 y 3 GB.', s: [
    '«Espacio en disco» muestra cuánto queda libre y cuánto ocupa cada grabación.',
    '«Borrar vistas previas» quita archivos temporales; se vuelven a crear solos cuando hacen falta.',
    '«Quitar grabaciones ya aprovechadas» borra las terminadas que ya tienen clips y ningún momento pendiente. Los clips exportados no se tocan.',
    'Para que se limpie sola, pon un número de días en «Borrar grabaciones con más de estos días».',
    'Si mientras grabas quedan menos de 5 GB, la app avisa; con menos de 1 GB detiene la grabación para no perderla.'] },
  comunidad: { g: 'Media', t: 'Clips de la comunidad', d: 'Los clips que la gente hizo en Twitch o Kick.', s: [
    'En una fuente de Twitch o Kick, pulsa «Ver los clips de la comunidad»: salen los más vistos de la semana de ese canal.',
    '«Importar» lo trae como una fuente más, con el clip entero ya marcado como momento: ábrelo en el editor para pasarlo a vertical.',
    'Al analizar una grabación tuya de Twitch o Kick, si la gente hizo un clip mientras grababas, ese momento sube de nota y lo dice («la comunidad lo clipeó»).',
    'Son clips del streamer: úsalos dentro de sus campañas o con su permiso, y con el crédito.'] },
  linea: { g: 'Media', t: 'La línea de tiempo del directo', d: 'Todo el directo de un vistazo.', s: [
    'Las barras son el volumen; en verde, lo que se sale de lo normal.',
    'La línea azul es el ritmo del chat y las marcas rosadas arriba, los cambios bruscos de imagen.',
    'Las franjas verdes son los momentos detectados.',
    'Haz clic en cualquier punto para crear un momento ahí y abrirlo en el editor.'] },
  recorte: { g: 'Editor', t: 'Recortar el clip', d: 'Elegir dónde empieza y termina, y quitar lo que sobra.', s: [
    'Mueve el inicio y el fin con los botones −5, −1, +1 y +5 segundos.',
    'Pon el cursor donde quieras cortar y pulsa «Cortar» (o la tecla S). Selecciona el tramo que sobra y pulsa «Quitar tramo».',
    '«Quitar silencios» elimina de golpe las pausas de más de medio segundo.',
    '«Gancho» pone al principio los 3 segundos más intensos, para retener al que va pasando videos.'] },
  encuadre: { g: 'Editor', t: 'Cámara arriba y juego abajo', d: 'Cómo se reparte la pantalla vertical.', s: [
    'Elige un encuadre. «Cámara + juego» pone al streamer arriba y la partida abajo; «Varias cámaras» apila a los streamers (hasta 4); «Cámaras flotantes» las pone con esquinas redondeadas sobre el juego.',
    '«Estilos rápidos» aplica de un clic un estilo completo (Charla 2 streamers, Juego + cámaras flotantes o Meme) y queda guardado para ese streamer.',
    'Pulsa «Dibujar zonas en grande»: se abre el fotograma a pantalla completa.',
    'Arrastra para marcar la cámara. Cambia a «Juego» arriba y marca la parte de la partida.',
    'Ajusta por los puntos blancos o con las flechas del teclado, y pulsa «Listo».',
    '«Detectar cámaras» busca solas las cámaras de todos los que salen (por ejemplo, varios streamers jugando juntos) y ajusta cada zona a su marco. Las fotos fijas del juego no cuentan como cámara.',
    'En «Cámaras», «Quien habla» pasa sola a la cámara de la persona que habla (planos de al menos 2,4 s, que empiezan con la frase). «Fija» deja siempre la cámara que marques.',
    'Para cambiarla a mano: pon el cursor y pulsa la cámara en «Desde el cursor, pasar a», o pulsa un tramo del carril «Cámara» de la línea de tiempo para pasarlo a la siguiente.',
    'Lo que marques se recuerda para ese streamer, también el modo de cámara para «Exportar ya» y los lotes.'] },
  imagen: { g: 'Editor', t: 'Color, velocidad y acabado', d: 'Retoques que afectan a todo el clip.', s: [
    'Elige un color predefinido (Vivo, Cine, Blanco y negro) o mueve brillo, contraste y saturación.',
    'La velocidad acelera o frena el clip sin cambiar el tono de la voz.',
    'La barra de progreso arriba ayuda a que la gente vea el clip hasta el final.',
    'Los fundidos solo se ven en el clip exportado.'] },
  subs: { g: 'Editor', t: 'Subtítulos', d: 'El texto palabra por palabra.', s: [
    'Elige un estilo, el tamaño y la altura. La vista previa cambia al instante.',
    'Toca una palabra de la transcripción para corregirla, resaltarla, borrarla o taparla.',
    '«Reescribir todo el texto» abre un cuadro para pegar o corregir todo de una vez.',
    'Si no hay transcripción, el modelo de voz aún no se descargó: revisa el registro en «Ajustes».'] },
  texto: { g: 'Editor', t: 'Textos, título y cierre', d: 'Lo que se escribe encima del video.', s: [
    '«Añadir texto en el cursor» crea un texto que puedes arrastrar sobre la vista previa.',
    'Su duración se cambia estirando su bloque en la línea de tiempo.',
    'El «título fijo» se queda todo el clip; el «título de entrada» sale solo los primeros segundos.',
    'La «tarjeta de cierre» añade al final un «Sígueme para más clips» con tu crédito.',
    'El crédito o marca puede ir abajo al centro o en una esquina.'] },
  stickers: { g: 'Editor', t: 'Stickers', d: 'Imágenes que aparecen un momento.', s: [
    'Pulsa un sticker y se añade donde está el cursor, durante 2,5 segundos.',
    'Arrástralo en la vista previa y cambia su duración en la línea de tiempo.',
    '«Poner stickers según lo que se dice» los coloca solos cuando suenan «jajaja», «nooo», «gg» o «wtf».',
    'Puedes añadir los tuyos (PNG) en la carpeta public/stickers.'] },
  sonido: { g: 'Editor', t: 'Sonido y voz clara', d: 'Efectos, música y limpieza de la voz.', s: [
    'Los efectos se añaden en el cursor; muévelos en la pista «Sonido».',
    'Para música, pon tus pistas con licencia en public/music y elígela aquí. Baja sola cuando alguien habla.',
    '«Voz clara» reduce el ruido y el sonido del juego para que se entienda al streamer, y nivela el volumen.'] },
  zoom: { g: 'Editor', t: 'Zoom', d: 'Acercar la imagen en un instante concreto.', s: [
    '«Zoom en el cursor» acerca durante 2 segundos, con entrada y salida suaves.',
    '«Zoom en la reacción» lo pone justo en el pico del momento.',
    'En los encuadres con cámara se acerca la cara del streamer; en los demás, toda la imagen.'] },
  censura: { g: 'Editor', t: 'Tapar groserías y difuminar', d: 'Para que no te bajen el video.', s: [
    'Activa «Tapar groserías». Elige pitido o silencio, y si también se ocultan en los subtítulos.',
    'Añade tus propias palabras separadas por comas. Para una palabra suelta, selecciónala en «Subtítulos» y pulsa «Tapar».',
    '«Dibujar zona a difuminar» sirve para el chat, nombres o donaciones del video original.',
    'Las zonas marcadas «siempre» se recuerdan para los próximos clips de ese streamer.'] },
  publicar: { g: 'Editor', t: 'Exportar y versiones', d: 'El último paso antes de subir.', s: [
    'Escribe el título y la descripción. Si tienes la IA activada, «Sugerir con IA» propone tres títulos.',
    '«Zonas seguras» marca en rojo lo que taparán los botones de TikTok, Shorts o Reels.',
    '«Calidad alta» tarda más pero aguanta mejor la compresión de las plataformas.',
    '«Prueba de ganchos» saca tres versiones con distinto inicio para comparar cuál rinde más.'] },
  tiempo: { g: 'Editor', t: 'La línea de tiempo del clip', d: 'Dónde está cada cosa y cuánto dura.', s: [
    'Haz clic o arrastra sobre la regla o una pista para mover el cursor viendo cada fotograma. Espacio reproduce; «,» y «.» retroceden y avanzan un fotograma.',
    'Ctrl + rueda acerca o aleja la línea de tiempo alrededor del puntero (también con − y +). «Ajustar» vuelve a mostrar el clip entero.',
    'Cada pista tiene su color: video, subtítulos, texto, stickers, sonido y zoom. Solo se muestran las que tienen algo.',
    'Arrastra un bloque para moverlo, o sus bordes para cambiar cuánto dura. Los bordes de los tramos de video también se arrastran para recortarlos.',
    'Con el imán activado, los bordes se pegan al cursor, a los cortes y a otros bloques, y aparece una guía amarilla. Mantén Alt para moverlos libremente.',
    'Al tocar un bloque se abre su herramienta y arriba aparecen «Duplicar» (Ctrl+D) y «Borrar» (Supr). Esc lo deselecciona.',
    'Ctrl+Z deshace y Ctrl+Mayús+Z rehace.'] },
  clips: { g: 'Publicar', t: 'Clips y calendario', d: 'Lo que ya exportaste.', s: [
    'Cada tarjeta es un clip: puedes cambiarle el título, descargarlo o subirlo a Shorts.',
    'Arrastra un clip a un hueco del calendario para programarlo.',
    'Marca varios y pulsa «Unir en un montaje» para hacer un video más largo.',
    'Pulsa «TikTok» para subir el clip, o configura la subida automática en Ajustes. La primera vez instala la librería y conecta tu cuenta.'] },
  aprende: { g: 'Ajustes', t: 'Enseñarle a la app', d: 'Tres formas de que acierte más.', s: [
    'Exporta lo bueno y descarta lo malo: a partir de 6 decisiones por streamer empieza a notarse.',
    'Escribe las palabras típicas del streamer (muletillas, apodos). Cuando se dicen, el momento sube.',
    'Pega enlaces de clips que te gusten como «clips de ejemplo»: los momentos nuevos se cortarán con esa duración.'] },
  escuela: { g: 'Ajustes', t: 'Escuela del agente editor', d: 'Aprende a editar solo, mirando shorts que funcionan.', s: [
    'Busca en YouTube los shorts más vistos de muchos temas (podcast, entrevistas, streamers, humor, historias, deporte, negocios) y de tus streamers.',
    'De cada uno mide cuándo corta, cuándo hace zoom, qué transiciones usa y cómo empieza, y lo cruza con lo que se dice: zoom tras un grito, cortes en las pausas, ganchos con pregunta.',
    'Los más vistos pesan más. Lo aprendido se usa en cada auto edición, según el tono del clip (risa, subidón, sorpresa o charla).',
    'Gratis y sin cuenta. Solo guarda las medidas: cada video se borra al terminar. Cede el paso a lo que estés haciendo.',
    'Enséñale con enlaces: pega enlaces de videos bien editados (TikTok, YouTube Shorts, Reels). Lo que eliges tú pesa más.',
    'TikTok: pulsa «Conectar TikTok» e inicia sesión. Después, «Mirar TikTok» abre la ventana: navega como siempre y Clipper apunta lo que ves; al cerrarla estudia los de 100 mil vistas o más.'] },
  atajos: { g: 'Ajustes', t: 'Atajos de teclado', d: 'Para ir más rápido.', s: [
    'Media: Espacio guarda los últimos 45 segundos.',
    'Editor: Espacio reproduce, S corta, las flechas mueven 1 segundo (con Mayús, 5), «,» y «.» van fotograma a fotograma, Inicio y Fin saltan a los extremos.',
    'Editor: las teclas 1 a 0 abren las herramientas en orden. Supr borra lo seleccionado, Ctrl+D lo duplica y Esc lo deselecciona.',
    'Editor: Ctrl+Z deshace y Ctrl+Mayús+Z (o Ctrl+Y) rehace.',
    'Selector de zonas: las flechas mueven la zona (con Mayús, más rápido), Intro acepta y Esc cancela.',
    'En cualquier pantalla: la tecla ? abre esta ayuda.'] },
};

/** Botón «?» para poner junto a un título. */
export const helpBtn = (topic) => `<button class="q fix" data-help="${topic}" aria-label="Ayuda: ${esc(HELP[topic]?.t || '')}" title="Cómo funciona">?</button>`;

export function closeHelp() {
  const s = document.getElementById('sheet');
  if (!s) return;
  s.classList.add('out');
  setTimeout(() => s.remove(), calm() ? 0 : 220);
}

/** Abre la hoja de ayuda en un tema (o en el índice si no se indica). */
export function openHelp(topic) {
  let s = document.getElementById('sheet');
  if (!s) {
    s = document.createElement('aside');
    s.id = 'sheet';
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-label', 'Ayuda');
    document.body.appendChild(s);
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-topic],[data-x]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.x === 'close') return closeHelp();
      if (b.dataset.x === 'tour') { closeHelp(); return tourHere(true); }
      if (b.dataset.x === 'index') return paint('');
      paint(b.dataset.topic);
    });
    s.addEventListener('input', (e) => { if (e.target.id === 'helpQ') list(e.target.value); });
  }
  const groups = () => { const m = new Map(); for (const [k, h] of Object.entries(HELP)) m.set(h.g, [...(m.get(h.g) || []), [k, h]]); return m; };
  const list = (query = '') => {
    const q = query.trim().toLowerCase(), box = s.querySelector('#helpList');
    if (!box) return;
    const hit = ([, h]) => !q || `${h.t} ${h.d} ${h.s.join(' ')}`.toLowerCase().includes(q);
    box.innerHTML = [...groups()].map(([g, items]) => { const l = items.filter(hit); return l.length ? `<h3>${esc(g)}</h3>${l.map(([k, h]) => `<button class="hrow" data-topic="${k}"><span><b>${esc(h.t)}</b><span class="mut">${esc(h.d)}</span></span><span aria-hidden="true">›</span></button>`).join('')}` : ''; }).join('') || '<div class="empty">No encontré nada con esas palabras.</div>';
  };
  const paint = (k) => {
    const h = HELP[k];
    s.innerHTML = h
      ? `<div class="row"><button class="ghost fix sm" data-x="index">‹ Ayuda</button><span class="grow"></span><button class="icon fix sm" data-x="close" aria-label="Cerrar la ayuda">×</button></div>
         <div class="hbody"><h2 style="font-size:20px">${esc(h.t)}</h2><p class="mut" style="font-size:14px;margin:6px 0 14px">${esc(h.d)}</p><ol class="steps">${h.s.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`
      : `<div class="row"><h2 class="grow" style="font-size:20px">Ayuda</h2><button class="icon fix sm" data-x="close" aria-label="Cerrar la ayuda">×</button></div>
         <input type="text" id="helpQ" placeholder="Buscar: subtítulos, cámara, gancho…" aria-label="Buscar en la ayuda" />
         <button class="pri" data-x="tour">Ver el recorrido guiado</button>
         <div class="hbody" id="helpList"></div>`;
    if (!h) { list(); s.querySelector('#helpQ').focus(); }
    s.querySelector('.hbody').scrollTop = 0;
  };
  paint(HELP[topic] ? topic : '');
}

// ---------- recorrido guiado ----------
const STEPS = [
  ['.addbar', 'Empieza aquí', 'Pega el enlace de un canal en directo o de un video ya terminado. También vale la ruta de un archivo de tu PC.'],
  ['.srcs', 'Tus fuentes', 'Cada directo o video que añades queda aquí. Con dos o más aparece «Todos», que mezcla sus momentos.'],
  ['.livebox', 'El directo', 'Mientras grabas, debajo tienes los botones para guardar lo que acaba de pasar.'],
  ['canvas.tl', 'El directo de un vistazo', 'Volumen, chat e imagen a lo largo del tiempo. Haz clic en cualquier punto para crear un momento ahí.'],
  ['.moms', 'Los momentos', 'Lo que la app cree que vale la pena, por puntuación. Haz clic en uno para ver por qué lo eligió y editarlo o exportarlo.'],
  ['[data-view=editor]', 'El editor', 'Aquí recortas, eliges el encuadre, corriges subtítulos y exportas. Se abre al pulsar «Editar» en un momento.'],
  ['[data-view=clips]', 'Tus clips', 'Los clips exportados: descárgalos, publícalos o prográmalos en el calendario.'],
  ['#flyBtn', 'Vigilar canales', 'Añade canales y la app los graba sola cuando entran en directo.'],
  ['#helpBtn', 'Ayuda siempre a mano', 'Este botón abre la ayuda completa. Y cada «?» que veas explica justo esa parte.'],
];
// Recorrido del editor: corto, se ve la primera vez que se abre un clip.
const EDITOR_STEPS = [
  ['#elib', 'La biblioteca', 'Textos, stickers, sonidos, transiciones y efectos. Pasa el ratón para verlos en el vídeo y toca uno para añadirlo.'],
  ['#epanel', 'El inspector', 'Aquí se ajusta lo que estás editando. Sin nada elegido muestra el clip y todas las herramientas. Cada cambio se ve al instante y se guarda solo como plantilla del streamer.'],
  ['#phone', 'La vista previa', 'Así queda el clip. Los textos y stickers se arrastran directamente aquí.'],
  ['.transport', 'Reproducir', 'Espacio reproduce. Las flechas mueven 1 s (con Mayús, 5 s) y las teclas , y . avanzan fotograma a fotograma.'],
  ['#tracks', 'La línea de tiempo', 'Toca un bloque para seleccionarlo: se abre su herramienta y arriba aparecen «Duplicar» y «Borrar». Arrastra sus bordes para cambiar cuánto dura.'],
  ['[data-e=undo]', 'Sin miedo a probar', 'Ctrl+Z deshace y Ctrl+Mayús+Z rehace. Este recorrido se repite desde el botón ?, a la derecha.'],
  ['[data-e=export]', 'Exportar', 'Cuando te guste, exporta. En «Publicar» tienes título, calidad y versiones.'],
];
/** El recorrido de la pantalla que se esta viendo: el del editor si esta abierto, si no el general. */
export const tourHere = (force = false) => (document.getElementById('epanel')?.offsetParent ? tour(force, EDITOR_STEPS, 'tourEditor') : tour(force));
export function tour(force = false, all = STEPS, seen = 'tourVisto') {
  try { if (!force && localStorage.getItem(seen)) return; localStorage.setItem(seen, '1'); } catch { if (!force) return; }
  const steps = all.filter(([sel]) => { const el = document.querySelector(sel); return el && el.offsetParent !== null; });
  if (!steps.length) return;
  document.getElementById('tour')?.remove();
  const root = document.createElement('div');
  root.id = 'tour';
  root.innerHTML = '<div class="hole"></div><div class="tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  let i = 0;
  const hole = root.querySelector('.hole'), tip = root.querySelector('.tip');
  const end = () => { root.remove(); removeEventListener('resize', place); removeEventListener('keydown', key, true); };
  function place() {
    const [sel, title, text] = steps[i], el = document.querySelector(sel);
    if (!el) return end();
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(), pad = 8;
    Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    tip.innerHTML = `<div class="mut">${i + 1} de ${steps.length}</div><h2 style="font-size:17px;margin:2px 0 6px">${esc(title)}</h2><p>${esc(text)}</p>
      <div class="row" style="margin-top:12px"><button class="ghost fix sm" data-t="skip">Saltar</button><span class="grow"></span>${i ? '<button class="fix sm" data-t="prev">Atrás</button>' : ''}<button class="pri fix sm" data-t="next" style="min-width:96px">${i === steps.length - 1 ? 'Listo' : 'Siguiente'}</button></div>`;
    // El globo va al lado donde hay sitio: a la derecha, a la izquierda o debajo.
    const w = 320, h = tip.offsetHeight || 170, vw = innerWidth, vh = innerHeight;
    let x = r.right + 18, y = r.top;
    if (x + w > vw - 12) x = r.left - w - 18;
    if (x < 12) { x = Math.min(Math.max(12, r.left), vw - w - 12); y = r.bottom + 18; if (y + h > vh - 12) y = Math.max(12, r.top - h - 18); }
    y = Math.min(Math.max(12, y), vh - h - 12);
    Object.assign(tip.style, { left: x + 'px', top: y + 'px', width: w + 'px' });
    tip.querySelector('[data-t=next]').focus();
  }
  const go = (d) => { i += d; if (i >= steps.length || i < 0) return end(); place(); };
  function key(e) { e.stopPropagation(); if (e.key === 'Escape') end(); else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') go(-1); }
  root.addEventListener('click', (e) => { e.stopPropagation(); const t = e.target.closest('[data-t]')?.dataset.t; if (t === 'skip') end(); else if (t === 'next') go(1); else if (t === 'prev') go(-1); });
  addEventListener('resize', place);
  addEventListener('keydown', key, true);
  place();
}
