# Inventario de funciones: CapCut 9.6 frente a Clipper

Fecha: 15 oct 2026. Revisión antes de tocar código.

## De dónde sale la lista

- **CapCut.** Sale de los 12.393 textos de interfaz (`pc_*`) que lleva dentro `VECreator.dll`. Son los textos que CapCut enseña al usuario: si una función tiene botón, menú o aviso, su texto está ahí. Se usan cuatro grupos:
  - el catálogo de funciones (`pc_feature_*`, 30);
  - las herramientas del asistente (`pc_assistant_*`, 23);
  - el análisis automático con sugerencias (`pc_recommend_*`, 147 textos);
  - las acciones del agente de edición (`pc_edit_agent_*`, 85);
  - además, las operaciones básicas de edición que aparecen en el resto de textos (fotogramas clave, máscaras, congelar, invertir…).
- **Clipper.** Revisado en el código (`src/clips`) y en las pruebas:
  - `tests-ui/app.pw.ts`: 25 pruebas con el navegador;
  - `tests/*.test.ts`: 189 pruebas unitarias.
- Lista completa de textos de CapCut: `capkeys.txt`, en la carpeta temporal de la sesión.
- **Fuera por tu indicación:** música de fondo.

## Qué significa cada estado

| Estado | Significa |
|---|---|
| ✅ Verificado | Existe y una prueba automática comprueba que funciona. Se indica cuál. |
| 🔵 Sin verificar | Está en el código, pero ninguna prueba lo comprueba. No se da por hecho. |
| 🟡 Parcial | Existe, pero con mucha menos capacidad que CapCut. Se indica qué falta. |
| ❌ Falta | No existe. |
| ➖ Fuera (propuesto) | Se propone no hacerlo, con el motivo. Lo decides tú. |

---

## A. Línea de tiempo y edición básica

| Función de CapCut (texto de interfaz) | Clipper hoy | Estado |
|---|---|---|
| Dividir (`split`) | «Cortar» y la tecla S | ✅ «linea de tiempo…», «transicion en un corte…» |
| Recortar por los bordes | Bordes de los tramos, con imán | ✅ «linea de tiempo…» |
| Borrar tramo | «Quitar tramo» | ✅ «herramientas por grupos…» |
| Duplicar, deshacer y rehacer | Ctrl+D, Ctrl+Z y Ctrl+Mayús+Z | ✅ «herramientas por grupos…» |
| Zoom de la línea de tiempo y avance fotograma a fotograma | Botones −/+, Ctrl+rueda y las teclas «,» y «.» | ✅ «linea de tiempo…» |
| Congelar imagen (`freeze`) | «Congelar aquí» (2 s, ajustable hasta 10 s) en Recorte y en el menú del tramo | ✅ «tramos: congelar…» y `tramos.test.ts` (vídeo exportado de verdad: se comparan fotogramas y duraciones) |
| Reproducir al revés (`reverse`) | Por tramo; se ve en el vídeo exportado, no en la vista previa | ✅ «tramos: congelar…» y `tramos.test.ts` (vídeo exportado de verdad: se comparan fotogramas y duraciones) |
| Espejo y voltear (`mirror`, `flip_vertically`) | Por tramo, sin girar los subtítulos | ✅ «tramos: congelar…» y `tramos.test.ts` (vídeo exportado de verdad: se comparan fotogramas y duraciones) |
| Rotar (`rotate`, `rotate_90_degrees`) | Por tramo: ±90° y cualquier ángulo | ✅ «tramos: congelar…» y `tramos.test.ts` (vídeo exportado de verdad: se comparan fotogramas y duraciones) |
| Recortar la imagen con proporción libre (`crop`, `free_crop_mode`) | Solo con los encuadres fijos y el recorte horizontal | 🟡 |
| Velocidad constante (`speed`) | De ×0,75 a ×1,5 para todo el clip | 🔵 |
| Velocidad por tramo y curva de velocidad (`curve_speed`, `velocity_effects`) | ×0,25 a ×4 por tramo y 4 curvas (rampa lenta, subidón, frenazo, tiempo bala); la voz no cambia de tono | ✅ «tramos: congelar…» y `tramos.test.ts` (vídeo exportado de verdad: se comparan fotogramas y duraciones), `segtime.test.ts` |
| Fotogramas clave (`add_keyframes`, 33 textos) | — (los zooms son bloques fijos) | ❌ |
| Máscaras (`color_mask`, formas y pincel; 62 textos) | — | ❌ |
| Croma o pantalla verde (`chroma_matting`) | — | ❌ |
| Opacidad y modos de fusión (`opacity`) | — | ❌ |
| Pistas de superposición con otros medios (`pip_tracks`) | Solo encuadres con el mismo vídeo (cámara + juego, PiP) | 🟡 |
| Importar tus medios: imágenes, vídeos y audio (`import`, `media`) | — (solo el vídeo de origen) | ❌ |
| Clip compuesto (`compound`) | — | ❌ |
| Marcas de ritmo automáticas (`auto_mark_beats`, `beat_sync_videos`) | — | ❌ |
| Multicámara (`multi_camera`) | Detecta las cámaras del directo, «quien habla» y cámaras añadidas a mano | ✅ «Varias cámaras…» |
| Proxy para editar fluido (`performance_proxy`) | Vista previa generada; 60 fps sin perder fotogramas | ✅ «reproducir es fluido…» |
| Fondo del lienzo (`canvas`, `background_color`) | Vídeo difuminado o negro, solo en «Imagen entera» | 🔵 |
| Pista principal magnética, sin huecos (`maintrack`) | Línea de tiempo magnética: muestra el tiempo final, sin huecos; «Ver lo quitado» vuelve al tiempo original | ✅ «linea de tiempo magnetica…» |

## B. Texto y subtítulos

| Función de CapCut | Clipper hoy | Estado |
|---|---|---|
| Subtítulos automáticos (`caption_menu_recognize`) | Whisper en GPU | ✅ «subtitulos…» |
| Estilos de subtítulos | 7 estilos | 🟡 (CapCut tiene cientos) |
| Apartar los subtítulos de las caras y de la zona segura | Lo hace | ✅ «subtitulos: se apartan…» (CapCut no lo hace) |
| Vocabulario propio, hasta 25 palabras (`custom_vocab_max_25`) | Nombres sin límite y correcciones que se aprenden | ✅ «subtitulos: lo que corriges…» (supera a CapCut) |
| Quitar muletillas (`remove_filler_words`) | Lo hace, con revisión | ✅ `fillers.test.ts`, «auto edicion…» |
| Editar el vídeo desde el texto: borras una frase y se corta (`transcript_based_editing`) | Elegir palabras (Mayús + clic) y «Quitar del vídeo» o Supr corta imagen y sonido; salen tachadas y se pueden recuperar. «Ocultar del subtítulo» es aparte | ✅ «editar desde el texto…», `cuts.test.ts` |
| Buscar en los subtítulos (`caption_edit_caption_search`) | Buscador sin tildes ni mayúsculas, una o varias palabras; «Siguiente» y «Quitar las N del vídeo» | ✅ «editar desde el texto…» |
| Dividir o unir bloques de subtítulo | Solo «palabras por bloque» para todo el clip | 🟡 |
| Resaltar palabras clave | Casilla «Resaltar palabras clave» | 🔵 |
| Traducir (`caption_menu_translate`) | Con Ollama; reemplaza el texto | 🔵 |
| Subtítulos bilingües (`bilingual_subtitles`) | — | ❌ |
| Animaciones de texto: entrada, salida y bucle (`text_animation`) | Los subtítulos tienen «resaltar» y «rebote»; los textos no tienen animación | 🟡 |
| Plantillas de texto (`text_template`, 180 textos) | Título en caja o en estilo meme | 🟡 |
| Fuentes propias (`add_fonts`) | — | ❌ |
| Emojis automáticos en los subtítulos (`emoji_auto_captions`) | Stickers según lo que se dice | 🔵 |
| Texto a voz (`tts`, 48 textos) | — | ❌ |
| Letras de canciones (`lyrics_recognition`) | — | ➖ (es para clips musicales, no para directos) |

## C. Audio

| Función de CapCut | Clipper hoy | Estado |
|---|---|---|
| Efectos de sonido | 6 sonidos, en el cursor | 🟡 (biblioteca muy pequeña) |
| Efectos de voz (`voice_changer`) | 7 efectos, en todo el clip o solo en la repetición | ✅ «sonido: efecto de voz…» |
| Mejorar la voz y reducir ruido (`enhance_voice`, `reduce_noise`) | «Voz clara» (`arnndn` o `afftdn` + `loudnorm`) | 🔵 |
| Aislar la voz (`isolate_voice`, `vocal_isolation`) | «Voz clara» baja el ruido, pero no separa la voz del juego | 🟡 |
| Normalizar el volumen (`loudness_normalization`) | Solo con «Voz clara» o calidad alta | 🔵 |
| Fundido de audio de entrada y salida (`fade_in`, `fade_out`) | Fundidos del clip (imagen y audio) | 🔵 |
| Volumen por elemento | Los efectos suenan siempre al 100 % y no se puede cambiar | 🟡 |
| Grabar voz en off (`recorder`) | — | ❌ |
| Clonar voz y doblaje con labios sincronizados (`voice_clone`, `lipsync`) | — | ➖ (modelos pesados y riesgo de suplantar voces) |
| Música con IA (`aimusic`) y música de fondo | — | ➖ (fuera por tu indicación) |

## D. Imagen y color

| Función de CapCut | Clipper hoy | Estado |
|---|---|---|
| Luz y color automáticos (`auto_adjust`) | «Luz y color automáticos» | ✅ «imagen: luz y color…» |
| Estabilizar (`video_stabilization`) | `deshake` | ✅ «imagen…» (el resultado exportado no se mide) |
| Filtros (`filters`, 79 textos) | 4 o 5 ajustes predefinidos | 🟡 |
| Ajustes de color (`adjust`, 195 textos: temperatura, tono, HSL, curvas, LUT, nitidez, viñeta, recuperar detalles) | Solo brillo, contraste y saturación | 🟡 |
| Igualar el color entre clips (`color_match`) | — (útil para igualar cámara y juego) | ❌ |
| Reiluminar (`relight`) | La luz automática solo sube el brillo | 🟡 |
| Reducir el ruido de la imagen (`reduce_image_noise`) | `hqdn3d`, solo en calidad alta | 🔵 |
| Quitar parpadeo (`remove_flicker`) | — | ❌ |
| Interpolar fotogramas para cámara lenta suave (`optical_flow`) | Mezcla de fotogramas, solo en la repetición | 🟡 |
| Mejorar o escalar la calidad, HDR (`enhance_quality`) | — | ❌ |
| Quitar el fondo (`remove_bg`, `cutout`) | — | ❌ |
| Retoque de cara, maquillaje y cuerpo (`retouch`, `add_makeup`, `reshape_body`) | — | ➖ (poco útil en clips de directo; se puede reconsiderar) |
| Contacto visual (`eye_contact`) | — | ➖ (modelo generativo pesado) |
| Rellenar o expandir con IA (`inpainting`, `outpainting`) | — | ➖ (modelo generativo pesado) |

## E. Efectos y elementos

| Función de CapCut | Clipper hoy | Estado |
|---|---|---|
| Transiciones | 83, en el gancho, en todos los cortes o en uno concreto | ✅ «transiciones…», «transicion en un corte…» |
| Una transición distinta en cada corte | La misma en todos los cortes | 🟡 |
| Efectos de vídeo (`video_effect`, 136 textos) | Zoom, golpe de reacción, destello y barra de progreso | 🟡 (sin catálogo: sacudida, falla, VHS, desenfoque, pulso…) |
| Efectos de cara y cuerpo | — | ❌ |
| Stickers | 10 PNG y los tuyos en una carpeta | 🟡 |
| Stickers con IA (`aigc_sticker`) | — | ➖ (modelo generativo) |
| Formas (`shape`, 64 textos) | — | ❌ |
| Emojis (`emoji`) | — | ❌ |
| Seguir un objeto para pegarle texto o sticker (`motion_tracking`, `planar_tracking`) | — | ❌ |
| Seguir la cara al recortar (`camera_tracking`) | «Seguir la cara» en el encuadre recortado | 🔵 |
| Reencuadre automático (`auto_reframe`) | Encuadres según las caras y las cámaras | ✅ «encuadres…», «camaras, zoom…» |
| Difuminar zonas y tapar palabrotas | Censura con pitido o silencio, y zonas difuminadas | 🔵 |

## F. IA y automatismos

| Función de CapCut | Clipper hoy | Estado |
|---|---|---|
| De vídeo largo a cortos (`ai_clipper`, 195 textos) | Momentos con volumen, chat, caras e imagen, incluso en directo; «Sacar clips» | ✅ «importar…», «sacar clips…» (supera a CapCut: directo y chat) |
| Mejores momentos (`auto_highlight`) | Lo mismo, con nota | ✅ |
| Corte inteligente: silencios y muletillas (`smart_cut`) | Lo hace | ✅ `silences.test.ts`, `fillers.test.ts` |
| Varias propuestas de edición (`editing_script`) | Sobria, Equilibrada y Dinámica | ✅ «auto edicion…» |
| Condensar a una duración (`lvc`) | 15–60 s | ✅ «condensar…» |
| Análisis con sugerencias y deshacer en cada una (`recommend_*`: volumen desigual, ruido, calidad, parpadeo, color, subtítulos) | La auto edición propone cambios, pero no detecta problemas de calidad ni de volumen | 🟡 |
| Agente conversacional: «pon este filtro», «quita esto» (`edit_agent_*`, 85 textos) | El agente planifica la auto edición; no se le pueden dar órdenes | ❌ |
| Escribir títulos (`ai_writing`) | «Sugerir títulos» | 🔵 |
| Plantillas de edición (`template`, 656 textos) | Plantilla por streamer y estilos de un clic | 🟡 |
| Avatares, traductor de vídeo, generar imagen o vídeo (`avatar`, `video_translator`, `seedance`) | — | ➖ (modelos generativos o nube; no es lo que necesitas) |

## G. Exportar y publicar

| Función de CapCut | Clipper hoy | Estado |
|---|---|---|
| Resolución, fps, bitrate y formato (`export_*`) | Calidad normal o alta, 1080x1920 a 30 fps | 🟡 (sin 60 fps, 4K, GIF ni exportar solo el audio) |
| Marca de agua o crédito (`watermark`) | Texto de crédito o marca con su posición | 🔵 |
| Versiones por plataforma | Zonas seguras de TikTok, Shorts y Reels | 🔵 |
| Publicar y programar | YouTube, con programación | 🔵 |
| Kit de marca (`brand_kit`) | Plantilla por streamer (crédito, estilos) | 🟡 |
| Equipos, nube, revisión compartida (`teams`, `cloud`, `sharereview`) | — | ➖ (es la parte de pago de CapCut) |

## H. La línea de tiempo en detalle

Fuentes en los textos de CapCut: `timeline_*`, `track_*`, `maintrack_linkage_*`, `audiopreview_timeline_*`, `menu_*` y `shortcut_*`.

| Función de CapCut | Clipper hoy | Estado |
|---|---|---|
| Miniaturas del vídeo en la pista | Tira de 8 fotogramas reales | ✅ «linea de tiempo…» |
| Forma de onda del audio | Barras sobre la pista de vídeo | 🔵 |
| Cursor arrastrable, imán con guía, zoom (`timeline_amplification` / `reduction`) | Lo hace | ✅ «linea de tiempo…» |
| Ver lo que hay al pasar el ratón por la línea de tiempo, con imagen y audio o solo imagen (`audiopreview_timeline_*`, `preview_axis`) | Al pasar el ratón, el visor enseña ese fotograma sin mover el cursor; solo imagen, sin audio | 🟡 «linea de tiempo como CapCut…» |
| Marcadores con color, nombre e ir al anterior o siguiente (`timeline_mark_tag_*`) | M para añadir; Ctrl+← / Ctrl+→ para saltar; clic derecho para nombre, color y borrar; el pico del momento aparece marcado solo | ✅ «linea de tiempo como CapCut…» |
| Marcas de ritmo (`timeline_mark_beat_*`) | — | ❌ |
| Pista principal vinculada: lo de encima se mueve con el vídeo al cortar o mover, eligiendo qué tipos (`maintrack_linkage_*`) | Al quitar o recortar un tramo, todo lo de encima se mueve con el vídeo (en la vista y en el vídeo exportado). Siempre van todos los tipos; CapCut deja elegir cuáles | ✅ «linea de tiempo magnetica…» |
| Ocultar, bloquear y silenciar cada pista (`track_hidden` / `locked` / `muted`) | Candado y ojo o altavoz en cada pista; igual en la vista previa y en el vídeo exportado | ✅ «linea de tiempo como CapCut…», `tracks.test.ts` y medido en un vídeo exportado: audio de -5,6 dB con la pista normal y -91 dB con la pista de vídeo silenciada |
| Altura de las pistas (`track_hight_low` / `default` / `high`) | Dos alturas (botón ↕) | ✅ «linea de tiempo como CapCut…» |
| Volumen de la pista y separar el audio del vídeo (`track_volume`, `extract_audio`, `track_separation`) | Se puede silenciar la pista de vídeo; no hay volumen por tramo ni se separa el audio | 🟡 |
| Menú contextual con clic derecho (`menu_*`, `more_actions`) | En tramos, elementos, subtítulos, marcadores y pistas vacías; «Más…» lo abre desde el teclado | ✅ «linea de tiempo como CapCut…» |
| Copiar y pegar atributos: estilo, animación, posición de los fotogramas clave (`copy_paste_attributes`, `copy_attribute`) | Ctrl+Alt+C / Ctrl+Alt+V y en el menú: tamaño, color y caja de textos; tamaño de stickers; escala de zooms; volumen de sonidos (sin animaciones ni fotogramas clave porque aún no existen) | ✅ «linea de tiempo como CapCut…» |
| Selección múltiple (`select_start`, `audio_tracks_selected`) | Mayús o Ctrl + clic, rectángulo sobre una pista y Ctrl+A; borrar, duplicar, mover y pegar atributos a todos a la vez | ✅ «linea de tiempo como CapCut…» |
| Arrastrar con Alt para duplicar (`shortcut_drag_duplicate`) | Ctrl + arrastrar (en Clipper, Alt ya sirve para mover sin imán) | ✅ «linea de tiempo como CapCut…» |
| J, K y L para ir atrás, parar y adelante; ±10 fotogramas (`shortcut_shuttle_*`, `ten_frames_*`) | J atrás, K parar, L adelante (×1, ×2, ×4); Mayús+«,»/«.»: 10 fotogramas | ✅ «linea de tiempo como CapCut…» |
| Zoom del visor y pantalla completa (`shortcut_player_zoom_*`, `full_screen`) | Pantalla completa (botón y F); falta el zoom del visor | 🟡 «linea de tiempo como CapCut…» |
| Guías y regla en el visor (`reference_shortcut_line` / `ruler`) | Zona segura y guías de plataforma | 🟡 |

## Donde Clipper ya supera a CapCut

Grabar directos y encontrar momentos mientras se emiten, usando el chat de Kick y Twitch. Esquivar anuncios. Revisión que aprende lo que aceptas. Escuela del agente con vídeos de TikTok y YouTube. Correcciones de subtítulos aprendidas por streamer. Campañas con sus requisitos. Subtítulos que esquivan las caras.

---

## Resumen de brechas

| | ✅ | 🔵 | 🟡 | ❌ | ➖ |
|---|---|---|---|---|---|
| Funciones | 40 | 16 | 24 | 21 | 9 |

Las 🔵 funcionan en el código, pero no hay una prueba que lo demuestre, así que no cuentan como hechas. Las 🟡 y las ❌ son el trabajo pendiente.

## Plan priorizado

Criterio: primero lo que más se usa al editar clips de streamers, después lo que se puede hacer gratis en local con FFmpeg u ONNX y rápido. Cada etapa termina con estas pruebas:

- **En el navegador** (`npm run test:ui`): el usuario lo encuentra, lo usa y lo ve en la vista previa.
- **Sobre el archivo exportado:** `ffprobe` y comparación de fotogramas. Así se comprueba que de verdad sale en el vídeo y no solo en la interfaz.
- **Verificar las 🔵 de esa área**, para que pasen a ✅ o se arreglen.

### Etapa 1: línea de tiempo y edición básica (la más usada)

**1A. Línea de tiempo**

1. **Menú contextual** (clic derecho) en tramos y elementos: cortar, duplicar, borrar, copiar y pegar atributos, y las operaciones de 1B.
2. **Ver al pasar el ratón** por la línea de tiempo: el fotograma bajo el ratón en el visor, sin mover el cursor; con audio como opción.
3. **Marcadores** con color y nombre: M para añadir, Mayús+← / Mayús+→ para saltar entre ellos. Se crean solos donde están el pico del momento y los mensajes del chat.
4. **Pistas** que se ocultan, bloquean o silencian, con dos alturas. Volumen del audio original por tramo.
5. **Selección múltiple** (Mayús o Ctrl + clic, y arrastrando un rectángulo), **Alt+arrastrar para duplicar**, **J/K/L** y **±10 fotogramas**, **zoom del visor** y **pantalla completa**.
6. **Pista principal vinculada:** la línea de tiempo pasa a mostrar el tiempo final, sin huecos. Al quitar o mover un tramo, los textos, stickers, zooms, sonidos y subtítulos de encima se mueven con él, y se elige qué tipos.

**1B. Edición básica**

7. **Editar desde el texto.** Borrar palabras o frases en los subtítulos corta esos trozos de imagen y audio, reutilizando `cuts.js`. Incluye buscar en los subtítulos.
8. **Congelar imagen** en el cursor (`tpad` / `loop`), **reproducir al revés** un tramo (`reverse` / `areverse`), **espejo** y **rotar** (`hflip`, `vflip`, `transpose`).
9. **Velocidad por tramo**, con rampas (lento → normal) y la voz sin cambiar de tono (`setpts` + `atempo` por tramo).

### Etapa 2: movimiento y capas

5. **Fotogramas clave** de posición, escala, giro y opacidad para textos, stickers y zoom, con curvas suaves. En la vista previa y al exportar (`overlay` y `scale` con expresiones por tramo).
6. **Importar tus imágenes, vídeos y sonidos** como capas encima del vídeo, con opacidad.
7. **Máscaras** (círculo, rectángulo, degradado; `alphamerge`) y **croma** (`colorkey` / `chromakey`).
8. **Formas** y **emojis** como elementos, y una **biblioteca de stickers** ampliable con categorías.

### Etapa 3: texto

9. **Animaciones de entrada, salida y bucle** para textos y subtítulos: aparecer, escribir, rebotar, deslizar, zoom, sacudir.
10. **Plantillas de texto**, unas 20 propias: título, pregunta, reacción, contador… También **fuentes propias** desde una carpeta.
11. **Subtítulos bilingües** (con Ollama), **dividir y unir bloques**, y **emojis automáticos** en los subtítulos.
12. **Texto a voz** local y gratis (Piper, modelos en español).

### Etapa 4: imagen, color y efectos

13. **Ajustes completos:**
    - temperatura, tono, HSL básico, nitidez, viñeta, sombras y luces (`eq`, `colorbalance`, `huesaturation`, `unsharp`, `vignette`);
    - **filtros** como LUT `.cube` propios, unos 20;
    - **igualar el color** de la cámara y el juego.
14. **Catálogo de efectos de vídeo**, unos 25 en categorías como las transiciones: sacudida, falla, VHS, desenfoque, pulso, blanco y negro, brillo, zoom pulsante… Con vista previa al pasar el ratón, como los estilos de subtítulos.
15. **Una transición distinta en cada corte.**
16. **Quitar parpadeo** (`deflicker`), **interpolar fotogramas** para una cámara lenta suave (`minterpolate` solo en el tramo lento) y **reducir el ruido** de la imagen como opción.

### Etapa 5: audio

17. **Volumen por elemento** y fundidos en cada sonido. **Aislar la voz** de verdad con un modelo local de separación (ONNX). **Normalizar** como opción visible.
18. **Marcas de ritmo automáticas** (golpes del audio del clip), donde se ajustan los cortes y los zooms. **Grabar voz en off** con el micrófono.

### Etapa 6: inteligencia

19. **Análisis con sugerencias**, como el «recommend» de CapCut. Detecta volumen desigual, ruido, poca luz, parpadeo, subtítulos dudosos y cortes bruscos. Cada punto se aplica o se deshace por separado.
20. **Agente con órdenes en lenguaje normal** (Ollama), por ejemplo «pon zoom cuando grita» o «quita lo del minuto 3». Convierte la orden en cambios y te los enseña en la revisión antes de aplicarlos.
21. **Quitar el fondo** de la cámara (modelo ONNX local) y **seguir un objeto** para pegarle texto o un sticker.

### Etapa 7: exportación

22. **60 fps, bitrate, 1440p/4K** si el original lo tiene, **GIF** y **solo el audio**.

### Lo que propongo dejar fuera (➖)

Avatares, generar imágenes o vídeos con IA, clonar voces y doblaje con labios, maquillaje y retoque de cuerpo, contacto visual, rellenar o expandir con IA, letras de canciones, música con IA y nube o equipos.

Motivos: necesitan modelos generativos pesados o servicios de pago, no aportan a clips de directos, y en el caso de las voces existe el riesgo de suplantar a alguien. Si quieres alguno, se añade al plan.
