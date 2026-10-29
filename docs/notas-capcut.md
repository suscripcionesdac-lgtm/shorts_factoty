# Notas: transiciones (referencia CapCut + videos-referencia)

Referencia para diseñar nuestras transiciones. Aquí solo hay nombres, duraciones y la técnica observada; no hay código ni recursos de CapCut.

## Catálogo de CapCut (caché local, versión 9.6, oct 2026)

Fuente: `CapCut\User Data\Cache\ressdk_db\...\rp.db`, tabla `http_cache`, panel de transiciones.
Se extrajeron 242 transiciones (96 gratis). Es parcial: solo están las primeras páginas que CapCut llegó a cargar.

- **Duración por defecto: 2,0 s** en casi todas. Las más cortas son Corte de cómic (0,8 s), Borrado de película (0,8 s) y Falla parpadeante (1,0 s).
- **`isOverlap: true`** en todas: la transición se solapa con el final de un clip y el principio del siguiente, así que el vídeo final dura menos (como `xfade` de FFmpeg).

| Categoría | Total | Gratis | Ejemplos gratis |
|---|---|---|---|
| Luz | 63 | 26 | Flash con zoom, Flash de teletransporte, Portal de neón, Brillo radial, Impacto visual, Haz de colisión |
| Cámara | 57 | 23 | Zoom inicial, Zoom con chasquido, Hacer zoom intenso, Resortera, Latigazo inclinado, Paneo sísmico, Empuje lejano |
| Desenfocar | 54 | 21 | Barrido desenfocado, Deslizamiento con desenfoque, Mancha difuminada, Onda circular, Zoom circular |
| Máscara | 40 | 8 | Pegar Polaroid, Visión inclinada, Confeti de amor |
| Deslizar | 20 | 11 | Deslizamiento de puertas, Pantalla flash, Zoom deslizante, Barrido de escaneo |
| Distorsión | 10 | 4 | Giro elástico, Calor tembloroso, Pulso fragmentado |
| Falla | 9 | 5 | Disipación LED, Estiramiento satinado, Multiverso neón |
| Superposición | 8 | 1 | Escaneo tenue |
| Tendencias | 8 | 0 | — |
| Básico | 5 | 4 | Zoom falso, Desplazar corte diagonal |

## Lo que usan los vídeos de referencia

Análisis de los 10 vídeos de `videos-referencia/`: unos 60 cambios de plano detectados con FFmpeg (`scene > 0.3`) y los dudosos revisados fotograma a fotograma.

- **Unos 85 % son cortes secos.** El ritmo lo dan los cortes rápidos, no las transiciones.
- **Las pocas transiciones son cortas (0,3–0,6 s)**, mucho menos que los 2 s por defecto de CapCut:
  - **Humo o niebla blanca** (cococutz 20,47 s y david_mgo 22,60 s): el humo entra desde abajo, tapa la imagen en blanco y aparece el plano siguiente. Es el estilo de "Portal de humo" o "Impacto de humo".
  - **Destello de luz** (1791835890761, 5,07 s): estallido blanco y amarillo, unos 0,3 s. Es el estilo de "Flash con zoom" o "Pantalla flash".
  - **Zoom de golpe** (david_mgo 22,07 s): corte a un primer plano muy cerrado de la cara para remarcar una reacción.
  - **Corte con movimiento** (juaniquilador 28,67 s): corte seco y después la imagen se aleja y se desplaza (zoom de salida con paneo).
- Cambios de composición (pantalla partida o facecam encima) hechos siempre con corte seco.

## Implementado (`src/clips/transitions.ts`)

83 transiciones en las mismas familias que CapCut: las 57 de `xfade` de FFmpeg con nombre en español y 26 propias:
- **Cámara:** zoom a través, zoom de golpe, giro, latigazos (4 direcciones), sacudida, estirar, rebote, volteo.
- **Desenfocar:** desenfoque, zoom borroso.
- **Luz:** destello, destello con zoom, parpadeo a negro, fuga de luz, quemado.
- **Falla:** falla, separación RGB, apagado de TV.
- **Superposición:** humo blanco, humo negro, tinta.

Dónde se usan:
- Editor → Imagen → Transiciones: unión del gancho con el clip y, opcionalmente, cada corte.
- Clips → montaje: transición entre clips.

Lecciones de rendimiento:
- `xfade=custom` con expresiones por píxel es demasiado lento a 1080x1920 (hasta 98 s por transición). Las propias usan filtros nativos solo en la ventana de la transición (unos 0,3–1,5 s).
- Los filtros que cambian el tamaño del cuadro en cada fotograma descolocan a `crop`. Se trabaja con tamaños fijos o con `overlay` sobre un fondo negro.
- Las máscaras (humo, tinta, fuga de luz) se calculan con `geq` a 54x96 y se amplían.

## Equivalentes propios (diseño inicial)

| Estilo | Cómo hacerlo nosotros |
|---|---|
| Destello de luz | `xfade=transition=fadewhite`, 0,3 s, más un brillo (`eq=brightness`) en el pico |
| Humo o niebla | Superposición de un vídeo de humo libre de derechos con máscara de luminancia, o `fadewhite` con `noise` y `gblur` como aproximación |
| Zoom de golpe | Escalado y recorte animado (`zoompan` o `scale`+`crop` con expresión) dentro del clip, sin `xfade` |
| Empuje o deslizamiento | `xfade=slideleft/smoothleft`, 0,3–0,4 s |
| Desenfoque | `xfade=hblur`, o `gblur` animado en las dos mitades |
| Falla | `rgbashift` y `noise` durante 3–5 fotogramas alrededor del corte |
| Corte seco | Lo actual (`concatClips` con `-c copy`) |

Puntos de integración: `concatClips` en `src/clips/fast.ts:446` (unión de clips, hoy sin recodificar) y la unión del gancho en `fast.ts:372`.

## Investigación de la línea de tiempo (oct 2026)

### Lo que REA puede y no puede en este PC (Windows)
- **No disponible:** observar la interfaz nativa de CapCut (`observe_native_ui`, `capture_native_ui_scenario`, `capture_process_scenario`). Estas herramientas solo funcionan en macOS.
- **Instalado:** Ghidra 12.1.4 en `C:\Users\Alejandro\tools\ghidra_12.1.4_PUBLIC`, con `GHIDRA_INSTALL_DIR` definida. REA lo da por correcto tras reiniciar Claude Code.
  - Sirve para descompilar funciones concretas de las DLL. No sirve para la interfaz: la línea de tiempo está en Qt/QML empaquetado dentro de las DLL.
- **Evidencia usada en su lugar:** el archivo de proyecto `draft_content.json` (JSON legible) y el comportamiento observable.

### Modelo de línea de tiempo de CapCut (según draft_content.json)
- Tiempos en microsegundos.
- Pistas por tipo (`video`, `audio`, `text`, `effect`, `sticker`…), con orden de capas (`render_index`).
- Cada segmento tiene `source_timerange` (trozo del medio) y `target_timerange` (posición en la línea de tiempo), más velocidad, transformación (`clip`) y fotogramas clave.
- Los efectos, la velocidad, el lienzo y las transiciones son materiales enlazados por id (`extra_material_refs`).
- `config.maintrack_adsorb: true`: pista principal magnética. `subtitle_sync: true`: los subtítulos siguen al vídeo al editarlo.
- El único proyecto guardado es el ejemplo de bienvenida (`oobe/example.mp4`). Hace falta un proyecto real auto editado para estudiar sus decisiones.

### Comparación con Clipper y plan por etapas
| Etapa | Qué | Estado |
|---|---|---|
| 1 | Zoom de la línea de tiempo (Ctrl+rueda, −/+, Ajustar) con desplazamiento que sigue al cursor; arrastrar el cursor; recortar tramos por sus bordes; imán con guía (Alt lo desactiva); «,» y «.» por fotograma | **Hecho** y probado (`tests-ui`: «linea de tiempo: zoom…») |
| 2 | Subtítulos que esquivan caras: cada bloque a la altura preferida si no tapa una cara (zonas según el encuadre y las cámaras detectadas; durante los golpes, la cara a pantalla completa) y dentro de la zona segura elegida. Misma lógica en exportación y vista previa (`src/clips/web/place.js`) | **Hecho** y probado (`tests/place.test.ts`, `tests-ui`: «subtitulos: se apartan…») |
| 3 | Revisar antes de aplicar: panel «Revisar la auto edición» con una casilla por propuesta (encuadre, cortes, gancho, transición, cada zoom, golpe, sonido y sticker, estilo de subtítulos, título, acabado); la vista previa se actualiza al marcar o desmarcar; «Aplicar» (un solo Ctrl+Z) o «Descartar»; opción «Revisar siempre antes de aplicar» | **Hecho** y probado (`tests-ui`: «auto edicion de un clic…») |
| 4 | Perfiles de estilo desde referencias: `refstyle.ts` mide cortes por minuto, duración de planos, % de transiciones, zooms (acercamientos y zooms de golpe con búsqueda de escala y posición) y LUFS. Perfil = media de frecuencias y mediana de los editados. La carpeta `videos-referencia` se mide sola en segundo plano (`data/style-refs.json`); los ejemplos de cada streamer también, y mandan si hay 2 o más. El director ajusta cuántos efectos, su intensidad, si el gancho lleva transición y lo agresivo de quitar silencios | **Hecho** y probado (`tests/refstyle.test.ts`). Perfil medido de tus 10 referencias: 70 % editadas, 9 cortes/min, planos de 3,7 s, 5 % transiciones, 0,8 zooms/min, zooms de golpe ×2,5 |
| 5 | Preferencias: al «Aplicar» la revisión se guarda por streamer qué tipos se conservan o quitan (`web/prefs.js`, compartido); lo que se conserva menos del 30 % de las veces (con unas 3 decisiones) deja de proponerse y se dice por qué; lo reciente pesa más, lo ya descartado no reaparece solo; «Olvidar lo aprendido» | **Hecho** y probado (`tests/prefs.test.ts`, `tests-ui`: «aprende de la revision…») |
| 6 | Tiempo de salida en la línea de tiempo (como la pista magnética de CapCut: sin huecos de lo cortado) y miniaturas de vídeo en la pista | Pendiente (cambio grande del modelo) |

### Arquitectura de la auto edición: qué estrategia para qué
- **Reglas deterministas** (director): ritmo, separación mínima, zonas cortadas y límites. Rápidas, predecibles y probables.
- **Perfiles de referencia** (etapa 4): números medidos en vídeos que funcionan, no copiados. Ajustan las reglas.
- **Preferencias** (etapa 5): lo que el usuario acepta o rechaza. Pocos datos, así que se usan como pesos, no para entrenar un modelo.
- **Ollama** (opcional): elegir el gancho y el tono leyendo la transcripción cuando las reglas dudan. Con ejemplos en el prompt; no hace falta reentrenar.
- **Entrenar o ajustar un modelo:** no compensa con los datos actuales (decenas de clips). Se reconsidera con cientos de ediciones aceptadas.

## Agente editor (IA local gratis)

- **Ollama 0.40.4 + `qwen2.5:7b`** (4,7 GB, GTX 1660 Super 6 GB). `llm.ts`: Ollama primero; Claude solo como último recurso (sin Ollama y con clave). `CLIPPER_NO_AI=1` desactiva la IA (lo usa la suite de interfaz para ser reproducible).
- **`agent.ts`:** el modelo recibe la transcripción por frases numeradas, con tiempos y señales, y elige **frases** (no tiempos): gancho, frases que sobran, momentos a remarcar (palabra exacta + zoom/golpe/sonido), palabras a resaltar, tono y título, cada uno con su porqué.
- **Red de seguridad (`checkPlan`):**
  - gancho solo a partir del segundo 4;
  - como mucho 3 frases quitadas, de 1,2 s o más, nunca la preparación (6 s antes de un remate o del gancho) ni el remate, y como mucho ¼ del clip;
  - un «?» suelto no es una palabra;
  - frases repetidas por la transcripción se juntan;
  - se rechaza lo que su propio motivo llama «preparación»;
  - no se resaltan palabras vacías;
  - un fallo puntual se reintenta una vez;
  - el motor nunca deja el clip en menos de la mitad.
- **Medido con 5 momentos reales de Auronplay:** 13–25 s por clip. Elige ganchos de más adelante («¡Qué susto!», «¡Pero, aquí, Paula!»), quita pocas frases largas y titula bien. **Límite:** algún gancho flojo (modelo de 7B), por eso la revisión manda.
- **Pendiente:** aprender de las ediciones aceptadas (ejemplos en el encargo) y probar un modelo mayor si se cambia de gráfica.

## Escuela del agente editor (src/clips/school.ts)

El agente aprende a editar mirando shorts que funcionan, de cualquier tema (streamers, podcast, entrevistas, humor,
historias, deporte, negocios, gaming, curiosidades y los streamers del usuario). Todo gratis y local.

- Busqueda: YouTube filtrado a shorts (`sp=EgIQCQ%3D%3D`); si devuelve menos de 5, `ytsearch50`. Shorts de 8 s a 3 min,
  con 50 mil vistas o mas, titulo no claramente en ingles. Tras descargar (480p) se descarta lo que no es vertical.
- Por video: `measureEvents` (cortes, transiciones y zooms con su instante), volumen por segundo y Whisper. `studyCase`
  cruza edicion y voz: tipo de gancho, duracion del primer plano, zoom/corte tras gritos y risas (y a cuantos s),
  cortes en pausas. El video se borra; solo se guardan las medidas en `data/school.json` (como mucho 600 casos).
- `learnFrom`: lecciones ponderadas por log(vistas), generales y por tono (risa, subidon, sorpresa, charla; 6 videos o mas).
- Uso: el agente recibe «LO APRENDIDO» y ganchos reales en su encargo; el director usa el estilo del tono si no hay
  ejemplos del streamer ni videos de referencia. Los cortes por silencio nunca pasan de ~5/min aunque el estilo sea rapido.
- Ritmo: tandas de 5 cada 30 min, hasta 40 al dia, cediendo el paso a lo que hace el usuario. Ajustes > Escuela del
  agente editor (pausar, «Estudiar ahora»). Desactivada en las pruebas (`CLIPPER_NO_AI=1`).
- Medido en real: descarga ~3-4 s, medicion 1-14 s, transcripcion 10-60 s por short (CPU).
- Limites: la busqueda filtrada de YouTube a veces no devuelve nada (se usa la normal); YouTube puede traducir titulos.
- TikTok (src/clips/tiktok.ts, opcional): «Conectar TikTok» abre una ventana propia de Clipper (perfil en
  data/tiktok-perfil, Edge o Chromium de Playwright) donde el usuario inicia sesion el mismo. Clipper no ve la
  contraseña ni exporta la sesion: solo mira en esa ventana las paginas de creadores/hashtags elegidos y apunta enlaces
  y vistas; yt-dlp baja cada video publico sin sesion. Una vuelta de cada dos, como mucho 12 al dia, 60 s entre videos.
  Sin probar aun con una cuenta real: los selectores de la pagina (a[href*="/video/"], data-e2e="video-views") pueden
  cambiar; si TikTok pide captcha, se resuelve en «Abrir la ventana».

## Subtitulos automaticos de CapCut (speechsdk.dll, 9.6.0.4097)

- REA (Ghidra) no termina: el analisis de speechsdk.dll tarda ~304 s y el limite de REA es 330 s (dos intentos,
  `provider_timeout`). Se extrajeron las cadenas del binario directamente (nombres de clases RTTI). No se decompilo nada.
- Lo que muestran las clases (`lab::speech::petrel`, inferencia con `panther::lite` de ByteDance):
  - Modelo propio tipo RNNT (`RNNTDecoderInference`, `RNNTBeamSearchDecoder`) con busqueda en haz.
  - Sesgo de contexto / palabras favorecidas: `DeepBiasConfig`, `BoostingConfig`.
  - Modelo de lenguaje neuronal para repuntuar: `NnlmConfig`.
  - Dos pasadas: `DualASRPipeline`, `CascadedASRPipeline`, `NonCausalEncoderProcessor`.
  - Subtitulos: `SentenceSegment`, `ClauseProcessor`, `CaptionPostProcessActor`, `OutputValidateProcessor`.
  - Deteccion de eventos de audio (`aed`: `MusicPostProcessor`) para no transcribir musica.
- Sin confirmar: si para español usa este motor local o su servicio en la nube (VECreator.dll, 271 MB, no se pudo
  revisar a tiempo).
- Equivalentes libres para Clipper: Whisper large-v3-turbo en GPU (whisper.cpp), «prompt» inicial con el vocabulario
  del streamer (sesgo de contexto), diccionario de correcciones aprendido de lo que corrige el usuario, y repaso con
  el agente corrector (Ollama).

## Mapa completo de CapCut 9.6.0.4097 (15-10-2026)

Metodo: inventario de la instalacion (1,8 GB, 205 binarios), nombres de clases C++ (RTTI) de cada binario agrupados por
espacio de nombres (~50.000 clases, >7.000 de edicion), cadenas de texto de los modulos del agente y lectura de las
configuraciones en texto de `Resources`. No se decompilo codigo: REA/Ghidra no termina con binarios grandes (speechsdk.dll,
8 MB, ya excede el limite de 330 s; VECreator.dll pesa 259 MB). Se estudia el funcionamiento; no se copia nada.

### Modulos
| Binario | MB | Que es |
|---|---|---|
| VECreator.dll | 259 | Aplicacion: agente (`agent`, `deepagents_service`), `clipflow::shell`, `lyra`, `lvve`, borradores en la nube, exportacion, timeline, `aigc::task` |
| cccreator.dll | 151 | Motor de efectos/render: `Bach` (algoritmos), `BEF`, `AmazingEngine`, `espresso` (red neuronal), `mobilecv2`, codecs bytevc1 |
| videoeditor.dll | 69 | Modelo de edicion: `lyra`, `lvve` (borrador, presets, reparacion de borradores, lens) |
| lens.dll | 84 | Mejora de video: interpolacion de fotogramas (`umvfi`), HDR (`vhdr`), flujo optico, TensorRT (`nvinfer1`) |
| deepagents_capi.dll / DeepAgentsService.dll | 40 / 4 | Agente de IA: sesiones, `ModelHost::ModelGenerate`, `ExecutionGate`, transcripcion de rondas, herramientas remotas |
| clipflow_sdk.dll | 3 | Flujos de edicion del agente: `RunAgentToolsExecutor`, tareas por borrador |
| audioeffect.dll | 13 | Audio: `mammon` (efectos de voz), `sami`, `Jukedeck::MusicDSP` (sintesis/generacion musical), `mobile_asr` |
| speechsdk.dll | 8 | Reconocimiento de voz local (ver seccion de subtitulos) |
| EffectPlatform.dll | 1,5 | Catalogo de efectos (`davinci::effectplatform`, loki, heycan: busqueda y recomendaciones) |
| Tracking.dll | 1,6 | Telemetria (no es seguimiento de objetos) |
| smart_cut.ofx.bundle | 0,6 | Plugin OFX de corte inteligente |

Funciones inteligentes vistas por nombre: `AIRoughCut2HighlightInfo`, `AIRough2HighlightChapterInfo`, `AudioToSmartRoughCut`,
`lvve::HighlightCutResult`, `AttachmentSmartTemplate{Prompt,Script,Shot,Video}Info` (plantillas con guion y planos),
`MaterialSmartCrop` (encuadre automatico), `SmartRelight`, `TESmartStabilizationUnit`, `TEBachSmartObjectTrackingAlgorithm`,
`TEPSmartCutImpl`, recomendacion de musica (`MusicRecommendsRequest`).

### El agente de CapCut
- Arquitectura: sesion de agente + modelo de lenguaje remoto (`ModelGenerate`) + herramientas que se piden al servidor
  (`list_tools`, `list_subagents`, `query_skills`). Los encargos y la lista de herramientas viven en la nube de ByteDance:
  no estan en los binarios. Herramienta local vista: `material_asr` (transcribir el material).
- Modos de la interfaz: corte inteligente (`smart_cut`), guion de edicion (`editing_script`), voz en off, revisar subtitulos.
- Habilidades incluidas (`Resources/builtin_skills/*/SKILL.md`, en chino; resumen propio):
  - highlight: transcripcion + vision (VLM) para localizar frases clave y picos de emocion, incluyendo la preparacion
    logica previa y el «calor emocional» posterior.
  - material_understanding: resumen semantico del material (voz + imagen).
  - script: varios planes de edicion candidatos; por defecto solo propone, no aplica a la linea de tiempo.
  - speaker («corte inteligente de video hablado»): quitar muletillas, pausas y repeticiones; divide videos muy largos.
  - align_bgm_with_video: ajustar la musica al final, efectos de sonido en los golpes de ritmo, desvanecido final.
  - lvc: condensar un video largo a uno corto con duracion objetivo.
- Encuadre inteligente (`Resources/lvop_intelligent_crop/algo/reframe_plugin.json`): grafo cara -> tensor -> inferencia
  sobre fotogramas de 512x512.
- Subtitulos: vocabulario propio del usuario de hasta 25 palabras (`subtitle_recognition_upgrade_custom_vocab`, `max_25`).

### Comparado con Clipper
Ya lo hace: momentos con preparacion y remate (agente + guardas de checkPlan), revision antes de aplicar, silencios,
encuadre por caras, vision con Ollama, gancho. Falta: quitar muletillas y repeticiones (palabra a palabra), varios planes
candidatos, musica ajustada al final con efectos en los golpes y desvanecido, condensar con duracion objetivo.

### Funciones de CapCut en Clipper (por etapas)
| Etapa | Funcion de CapCut | Estado |
|---|---|---|
| 1 | Corte inteligente de video hablado (muletillas, repeticiones) | Hecho: `fillers.ts` + `web/cuts.js`; fila propia en la revision («muletillas»), se aprende si se suele quitar |
| 2 | Cuadrar musica y final | Hecho: desvanecido final propuesto; la musica entra en su golpe (`music.ts`) |
| 3 | Guion de edicion: varias propuestas | Hecho: Equilibrada / Dinamica / Sobria en la revision; se aprende la elegida |
| 4 | Condensar video largo a una duracion | Hecho: `condense.ts` + agente; Sugerencias > Condensar a N s |
| 5 | Estabilizacion y luz/color automaticos | Hecho: `look.ts` (panel Imagen y auto edicion); `deshake` opcional |
| 6 | Camara lenta suave | Hecho: repeticion a camara lenta al final (`spec.replay`; `framerate` mezcla fotogramas) |
| 7 | Efectos de voz | Hecho: 7 efectos (`web/voices.js`), en todo el clip o solo en la repeticion |

Etapa 1, notas: Whisper grande apenas escribe «eh/em» (los limpia al transcribir), asi que lo que mas se quita son
arranques en falso («llevo una racha que... llevo una racha complicada»). No se cortan «¿eh?» de pregunta, el «ah» de una
reaccion, ni repeticiones de enfasis («no no no», «vamos vamos»). Un corte nunca deja un trozo de menos de 0,5 s ni se
lleva mas de 0,3 s de pausa.

Etapas 2-5 (15-10-2026):
- 2 Final y musica: desvanecido de 0,5 s propuesto en la auto edicion (fila «final»); la musica empieza en su golpe de
  entrada (`music.ts`: volumen cada 50 ms, primer golpe tras el que suena al 60 % de su nivel alto; `music.start` en el
  spec, `-ss` antes de `-stream_loop`). Medido: con el inicio calculado los 2 primeros s suenan a -29 dB; sin el, -91 dB.
  Sin hacer: efectos de sonido en los golpes de la musica (la carpeta public/music esta vacia de momento).
- 3 Propuestas: el director acepta `intensity`; la auto edicion devuelve Equilibrada (1), Dinamica (1,8: rellena los
  tramos tranquilos con zooms de ritmo) y Sobria (0,4). Selector en la revision; se aprende cual se elige (`propuesta:*`).
- 4 Condensar (`condense.ts` + `pickPhrases` del agente): menu Sugerencias, 15/20/30/45/60 s (las 3 mas largas que
  quepan). Prueba real: 34 s -> 17 s pidiendo 15.
- 5 Luz/color (`look.ts`, signalstats en 6 fotogramas, ~1,4 s) en el panel Imagen y propuesto en la auto edicion si hace
  falta; estabilizar con `deshake` (opcional; lento: ~1,65x la duracion del clip a 1080p).

Etapas 6-7: repeticion a camara lenta (`spec.replay`, 0,8-4 s, velocidad 0,3-0,8; render real: 10 s + 2 s a 0,5 = 14,00 s en 7 s de
exportacion); la auto edicion la propone en risa/subidon/sorpresa sobre el momento mas fuerte. Efectos de voz probados con
FFmpeg los 7. Ni la repeticion ni los efectos de voz se ven/oyen en la vista previa: solo al exportar.

## Organizacion de la edicion: CapCut y DaVinci Resolve (REA, 15-10-2026)

- REA (Ghidra) si termino con binarios de interfaz pequeños: `BMDDavUI.dll` de Resolve (2,7 MB) y `FusionUI.dll` de
  CapCut (2,3 MB). Resultados guardados en tool-results de la sesion.
- Resolve: componentes de interfaz `UiDrawerWidget` (cajones plegables), `UiToolBubbleDialog` (burbuja junto a la
  herramienta), `UiRadioButtonsNavigator` (cambio de modo por botones), `UiPulloutMenu`, `UiFontBrowserModel` (fuentes con
  favoritas y vista previa), zoom propio de linea de tiempo y visor, modo claro/oscuro. Trabajo separado en paginas
  (FusionPage.dll, FairlightPage.dll... una DLL por pagina). El manual PDF (>100 MB) no se pudo leer como texto.
- CapCut: `MaterialPanel` (biblioteca) y `FunctionPanel` (ajustes del elemento), `ToolTip`, `VETextWithTip`. 12.393 textos
  de interfaz (`pc_*` en VECreator.dll). Tiene un «Clipper» propio (156 textos): elegir video -> opciones en palabras
  (duracion auto/15 s/30 s/1 min..., numero de clips, estilo cronologico/montaje/narrativo/por lo que se dice, «mas
  indicaciones» en texto libre) -> progreso en 6 pasos con nombre y cancelar -> resultados (clips y capitulos, arrastrar
  para ordenar, volver a sacar, guardar en la linea de tiempo). Guias por funcion (`*_onboarding`, `*_tooltip`, «Probar»).
- Mockups (sin implementar todavia): https://claude.ai/artifact/FVYWPgkCjVeZWgnrpq7JNn — A: editar en 4 pasos;
  B: modo Facil y Pro; C: «lo que hice» + tocar en el video para cambiar; D: sacar clips en 3 pasos.

## Rediseño «Estudio» implementado (15 oct 2026)
- Etapa 1 (base visual): capa Estudio al final de `app.css`; un solo acento ámbar (Exportar, reproducir, selección); estados activos neutros; pistas en tonos apagados; la pista de vídeo muestra 8 fotogramas reales (`img.film`, `/api/frame?…&sm=1`); fuera el brillo violeta y el fondo con el vídeo desenfocado (`#bgx`).
- Etapa 2 (inspector): `#esum` se ve por defecto; con la auto edición, la revisión (Sobria/Equilibrada/Dinámica, cambios por grupos con su minuto, Aplicar/Descartar) vive ahí y el panel de la herramienta sigue a mano. Avisos centrados sobre la vista previa.
- Pendiente de esa etapa: las propiedades del elemento seleccionado siguen en el panel de la herramienta (no se movieron al inspector).
- Etapa 4 («Sacar clips» en En vivo): botón en «Momentos» → duración (Automática / 15–30 s / 30–60 s / 1–3 min), qué momentos (fuertes / graciosos / pidió el chat / historias), indicaciones; resultados al instante con `web/pick.js` (sin volver a analizar), los 3 mejores sin exportar ya marcados; «Editar los N» exporta con la plantilla (auto edición) y se revisan en «Clips».
- Arreglos encontrados al probar: una detección de cámaras tardía ya no pisa las cámaras añadidas/quitadas a mano (`E.camsTouched`); reabrir el selector de zonas mientras se cierra con animación ya no deja dos abiertos (`closePicker(keep, M)`).
- 15 oct (2.ª pasada, tras «solo cambiaste colores»): el editor ya es de cuatro zonas de verdad. Biblioteca a la izquierda (`#elib`, `renderLib`: Textos/Stickers/Sonidos/Transición/Efectos con tarjetas; pasar el ratón por un estilo de subtítulos lo muestra en el vídeo), visor, inspector a la derecha (`#epanel` dentro de `.einsp`; por defecto «Clip» = resumen + todas las herramientas por grupos; cada herramienta con «‹ Clip»; la revisión de la auto edición también va aquí) y línea de tiempo abajo. Sin la barra vertical de herramientas. «Rápido/Completo» en la cabecera oculta o muestra la biblioteca. Pruebas: helper `tool(k)` en `app.pw.ts`.
