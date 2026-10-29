# Shorts Factory

Dos herramientas en un proyecto:

- **Clipper** (`npm start`): aplicacion web local para sacar clips verticales de directos y VODs de streamers, con deteccion automatica de momentos.
- **Fabrica de videos narrados** (`npm run shorts`): videos con guion y tu voz. Se explica mas abajo.

## Clipper

```bash
npm install
npm start          # abre http://localhost:4300
```

En Windows no hace falta la consola: abre `Instalar Clipper.bat` una vez (instala y deja un acceso
directo "Clipper" en el escritorio) y despues entra siempre por ese acceso directo.

Solo necesitas Node.js 20 o superior y Chrome o Edge. La primera vez que pegas un enlace, la app
descarga sola la herramienta yt-dlp (queda en `tools/`).

### Interfaz

Paneles de cristal flotantes, controles redondeados y animaciones al estilo iOS. La navegacion es un
riel de iconos a la izquierda; "Vigilar" abre los canales que se graban solos. El editor tiene las
herramientas en un riel, sus opciones a la izquierda, el visor al centro con el encuadre siempre a
mano, y a la derecha por que se eligio el momento, la duracion final y los requisitos de la campana.
Las confirmaciones y los cuadros de texto son ventanas propias de la app.

Sigue las guias de diseno de Apple: el cristal se usa solo en la navegacion y en los controles que
flotan, el contenido va sobre paneles opacos, hay un unico color de acento y, en el editor, el propio
video se extiende desenfocado por detras de las barras. Las transiciones usan la API View Transitions
del navegador (Chrome o Edge): las pantallas se deslizan, la miniatura de un momento se convierte en
el visor del editor y vuelve a ella al salir, el selector de zonas crece desde su miniatura, las
pastillas de los selectores se deslizan y el encuadre cambia con un fundido. Con "reducir movimiento"
activado en el sistema, todo cambia sin animacion.

### Las cuatro pantallas

**En vivo.** Pegas un enlace de Kick, Twitch o YouTube (o la ruta de un archivo). Si es un canal,
graba el directo mientras emite. Ves el estado de la grabacion con el boton Detener, botones para
guardar los ultimos 30, 45, 60 o 90 segundos (o la barra espaciadora), la linea de tiempo con
volumen, chat e imagen, y la lista de momentos con "Editar", "Exportar ya" y el lote.

**Editor.** Vista previa vertical en vivo y linea de tiempo por pistas. Herramientas:

- *Recorte*: inicio y fin, cortar en el cursor, quitar tramos, quitar silencios, gancho al inicio.
- *Encuadre*: camara + juego, completo con fondo borroso o negro, pantalla llena, camara redonda sobre el
  juego, mitad y mitad, solo camara, varias camaras apiladas (hasta 4) y camaras flotantes redondeadas. "Estilos rapidos"
  aplica los estilos vistos en clips de TikTok de referencia (Charla 2 streamers, Juego + camaras flotantes, Meme).
  En *Zoom*, "Golpe de reaccion" corta a primer plano de quien reacciona (tambien automatico al exportar), y en
  *Imagen* hay un destello opcional en los cambios de camara. Subtitulos nuevos: "Recuadro activo" y "Cursiva";
  el titulo puede ir en estilo meme. Las zonas se dibujan sobre un fotograma, o se detectan solas
  con "Detectar camaras", que encuentra la camara de cada participante cuando juegan varios streamers juntos.
  En "Camaras", el modo "Quien habla" pasa a la persona que esta hablando (planos de 2,4 s o mas, que empiezan
  con la frase) y se puede corregir a mano en el carril "Camara" de la linea de tiempo; "Fija" deja una sola. En pantalla llena, "Seguir la cara" mueve el recorte con el streamer.
- *Subtitulos*: 5 estilos, tamano, altura, palabras por bloque, animacion, palabras clave en otro
  color, correccion palabra por palabra, reescritura completa y traduccion (con IA).
- *Texto*: textos libres con color o caja, arrastrables sobre la vista previa.
- *Stickers*: 10 incluidos; anade los tuyos (PNG) en `public/stickers`.
- *Sonido*: 6 efectos incluidos, musica de fondo desde `public/music`, y limpieza de audio.
- *Zoom*: acercamientos con entrada y salida suaves; "Zoom en la reaccion" lo pone en el pico.
- *Publicar*: titulo (sugerido con IA), descripcion, requisitos de la campana del streamer (duracion,
  hashtag y mencion), guia de zonas seguras de TikTok, Shorts y Reels, versiones por plataforma y
  prueba de ganchos (3 versiones con distinto inicio).
- *Imagen*: color (normal, vivo, cine, blanco y negro, o a mano), velocidad sin cambiar el tono de la
  voz, barra de progreso y fundidos.
- *Texto y cierre*: ademas de los textos, titulo de entrada, tarjeta de cierre ("Sigueme para mas
  clips") y posicion del credito o marca.
- *Censura* (opcional, por streamer): tapa groserias con pitido o silencio y las oculta en los
  subtitulos; zonas difuminadas para el chat, nombres o donaciones.

Las zonas (camara, juego y difuminado) se dibujan en un selector a pantalla completa: se arrastra
sobre el fotograma, se estiran por los puntos blancos y se afinan con las flechas del teclado.
En *Stickers* hay stickers automaticos segun lo que se dice, y en *Sonido* la musica baja sola
cuando alguien habla.

Atajos: Espacio reproduce, S corta, Supr borra lo seleccionado, flechas mueven 1 s, Ctrl+Z deshace.
Lo que ajustas se guarda como plantilla del streamer y se aplica a "Exportar ya", al lote y a la
exportacion automatica.

**Clips y publicacion.** Clips por estado, portada automatica, titulo editable, descarga, subida a
Shorts, montaje (une varios clips en uno), calendario de 7 dias (arrastra un clip a un hueco),
campanas con lo ganado por 1.000 vistas e informe de que origen, encuadre, duracion y hora rinden mas.

**Ajustes y registro.** Aviso sonoro, exportacion automatica por puntuacion, modo en vivo rapido,
avisos al celular (webhook de Discord o bot de Telegram), limpieza de disco, deteccion por imagen,
perfil por streamer (sus palabras y clips de ejemplo), copia de seguridad y el registro.

Con dos fuentes o mas aparece **Todos** en "En vivo": los momentos de todos los directos mezclados
por puntuacion. Mientras grabas puedes activar "Guardar por voz" y decir "clip" (Chrome o Edge).

### Calidad y ayuda

- *Calidad alta* (en Publicar): suaviza los bloques de compresion del directo, amplia la camara con un
  escalado mas fino y nitidez, comprime menos y nivela el volumen. Tarda el doble o mas en exportar.
  No usa tarjeta grafica.
- *Voz clara* (en Sonido): un modelo pequeno de reduccion de ruido (RNNoise, de Xiph.org, licencia
  BSD; archivo `public/models/voz.rnnn`) separa la voz del ruido y del juego; despues se realza y se
  nivela. Si borras ese archivo se usa un filtro clasico.
- Junto al nombre de la fuente se ve la resolucion con la que llega el video (en amarillo si es
  menor de 720p).
- *Ayuda*: el boton de la barra izquierda (o la tecla ?) abre una hoja con 20 temas paso a paso y
  buscador; cada "?" junto a un titulo abre el tema de esa parte. La primera vez se muestra un
  recorrido guiado, que se puede repetir desde la ayuda.

### Lo que aprende

- De lo que exportas y descartas (por streamer, a partir de 6 decisiones).
- De las vistas de tus clips: con 4 clips con vistas o mas, los que superan la mediana cuentan como
  acierto y la puntuacion se ajusta.
- De clips de ejemplo (enlace o archivo): se mide cuanto duran y donde cae el momento fuerte, y los
  momentos nuevos se cortan igual. El video de ejemplo no se guarda.
- De las palabras del streamer: las escribes tu o aceptas las que la app ve repetirse en tus clips.

### Como elige los momentos

| Senal | Que detecta | Requiere |
| --- | --- | --- |
| Volumen | Gritos, risas, reacciones | Nada |
| Chat | Estallidos de mensajes, y varios "clip" seguidos (se guarda solo) | Directo de Twitch o Kick; en resubidos, el chat guardado de Twitch y YouTube |
| Imagen | Cambios bruscos: pantalla de muerte o victoria, explosion, cambio de escena | Nada |
| Palabras | Expresiones de reaccion y ritmo de habla en la transcripcion | Modelo de voz (se descarga solo) |
| IA de texto | Descarta relleno, pone titulo y ajusta el corte | Ollama (`OLLAMA_MODEL`) o API |
| IA de vision | Etiqueta lo que se ve: muerte, victoria, jugada, susto | `OLLAMA_VISION_MODEL` o `VISION_IA=1` |
| Caras | Gestos en las camaras (sorpresa, risa, susto, enfado), varios reaccionando a la vez y conversaciones con idas y vueltas | Nada (ver abajo) |
| Tu criterio | Aprende de lo que exportas y descartas, por streamer | 6 decisiones |

### Limites conocidos

- La deteccion por imagen ve cambios bruscos, no entiende el juego: no sabe que fue una baja salvo
  que actives la IA de vision.
- "Clip it" funciona por chat (varios mensajes con "clip"). Por voz solo cuenta si la palabra sale
  en la transcripcion de un momento ya detectado; no hay escucha continua.
- "Detectar camaras", quien habla y las reacciones usan los modelos de face-api que ya trae el proyecto, en un hilo
  aparte del servidor y sin tarjeta grafica. La primera vez se descarga un archivo de 425 KB (el motor WebAssembly
  de TensorFlow.js 4.22.0, comprobado por su huella) a `models/tfjs-wasm`; sin el, funciona igual pero unas
  20 veces mas lento y con menos muestras. Buscar las camaras tarda unos 8 s por fuente (se guarda en `cams.json`);
  despues, cada momento cuesta unos 3-4 s y seguir a quien habla al exportar, unos 0,4 s por segundo de clip.
- Quien habla se decide por el movimiento de los labios: con una cara de perfil o muy pequeña acierta menos, y una
  voz sin camara (otro jugador) no cambia la camara. En un directo real de dos camaras coincidio con el tono de voz
  (hombre/mujer) en el 79 % de los segundos.
- "Seguir la cara" usa un detector de caras ligero en el navegador: con caras
  muy pequenas o de perfil puede fallar, y entonces se dibuja la zona a mano.
- No trae musica: usa pistas con licencia en `public/music`.
- TikTok: instala la librería y conecta tu cuenta en Ajustes. Después puedes subir cada clip con el botón
  "TikTok" o activar la subida automática. Las cookies de sesión se guardan localmente en `secrets/`.
- Recorta contenido que tengas permiso para usar y pon el credito que pida la campana.

### Clips de la comunidad

En una fuente de Twitch o Kick, "Ver los clips de la comunidad" lista los clips que la gente hizo esa semana, ordenados
por vistas, e "Importar" los trae como fuente con el clip entero ya marcado como momento. Al analizar una grabacion
propia, los clips que la gente hizo mientras se grababa suben la nota de ese momento (o lo crean). Twitch se lee con
yt-dlp; Kick, con su lista publica a traves de curl (incluido en Windows 10 y 11). TikTok no tiene clips de espectadores.

### Pruebas en el navegador

`npm run test:ui` recorre la app en Edge (unos 70 s): importa un minuto de video, abre el editor (con la vista
previa nueva y ya generada), prueba encuadres, estilos, colores, camaras, zoom, texto y golpe de reaccion, salta,
reproduce, recorta, exporta y reabre el clip desde "Clips". Falla si algo se rompe, si hay errores en la consola o
si algo va lento (abrir el editor en mas de 2 s, aplicar un efecto en mas de 150 ms...). Usa su propia carpeta
temporal y el puerto 4399: no toca tus grabaciones ni tus clips. El video sale de una grabacion tuya; para usar otro,
`CLIPPER_TEST_VIDEO=ruta npm run test:ui`.

### Que se probo

Probado de extremo a extremo con un directo sintetico y un navegador automatizado: deteccion por
volumen e imagen, grabacion en vivo simulada con Detener, el editor completo (los 6 encuadres,
deteccion de camara y seguimiento de cara con una foto real, subtitulos en 5 estilos, texto,
sticker, efecto de sonido, zoom, cortes, gancho, limpieza de audio), exportacion, portada, montaje,
calendario, campanas e informe. La vista previa del editor coincide con el clip exportado.

**Sin probar**, porque el entorno de desarrollo no llega a esos servicios: lectura real del chat
de Kick y Twitch (incluido el pedido de clip), reconocimiento de voz, titulos, traduccion e IA de
vision, canales vigilados contra una plataforma real, y subida a YouTube. Tampoco se probo en
Windows ni con WebGL, que es como correra el detector de caras en tu PC. Si algo falla, el mensaje
aparece en pantalla o en el registro y el resto sigue funcionando.

---

# Fabrica de videos narrados

Programa de linea de comandos que convierte un tema en un video vertical 1080x1920 con tu voz,
subtitulos palabra a palabra y metadatos, y lo sube a YouTube programado.

## 1. Instalar

Necesitas Node.js 20 o superior. Nada mas: no hace falta FFmpeg ni Python.

```bash
npm install
copy .env.example .env      # en macOS/Linux: cp .env.example .env
npm run demo                # genera un video mudo de prueba (la primera vez descarga un navegador)
```

Si `npm run demo` termina con "Video listo", la instalacion funciona. El video queda en `public/runs/<id>/video.mp4`.

## 2. Hacer un video

```bash
# 1) Guion. Con IA (necesita ANTHROPIC_API_KEY) o a mano:
npm run shorts -- new "Lo confirmado de GTA 6 a un mes del lanzamiento"
npm run shorts -- new "Mi tema" --manual

# 2) Revisa y edita public/runs/<id>/script.json. Luego apruebalo:
npm run shorts -- approve <id>

# 3) Voz + render + control de calidad, todo seguido:
npm run shorts -- voice <id> --mode recorded    # grabas tu en el navegador
npm run shorts -- voice <id> --mode clone       # tu voz clonada (ElevenLabs)

# 4) Mira el video. Si te gusta, subelo:
npm run shorts -- publish <id> --at 2026-10-12T18:00:00-05:00
```

`<id>` puede ser un trozo del nombre (por ejemplo `confirmado`). Otros comandos: `list`, `show <id>`,
`render <id>`, `metrics`, y `npm run studio` para ver la plantilla en vivo.

Si cambias una frase del guion, vuelve a aprobar y a ejecutar `voice`: solo se regraba o regenera
esa frase. Para repetir una toma concreta: `voice <id> --redo 2,5`.

## 3. Tu voz

- **Grabada (`recorded`)**: se abre http://localhost:4321 con el guion frase a frase. Pulsa Grabar,
  lee, pulsa Parar. Puedes repetir cada frase. La pagina recorta silencios y normaliza el volumen.
- **Clonada (`clone`)**: graba 2 o 3 minutos leyendo con naturalidad (wav o mp3) y ejecuta
  `npm run shorts -- voice-clone "Mi voz" muestra1.wav muestra2.wav`. Copia el id que devuelve
  en `.env` como `ELEVENLABS_VOICE_ID`. Requiere un plan de pago de ElevenLabs.

## 4. Imagenes y clips

Copia los archivos a `public/assets/` y registralos:

```bash
npm run shorts -- asset mi-captura.mp4 --origen propio --nota "persecucion en GTA V de noche"
npm run shorts -- asset clip-fulano.mp4 --origen permiso --autor "@Fulano" --url https://... --nota "llegada a Vice City"
```

En el guion, cada frase elige su fondo: `{"kind":"clip","asset":"clip-fulano.mp4","startSec":12}`,
`{"kind":"image","asset":"foto.png"}` o `{"kind":"card","text":"TEXTO"}`. Los clips se silencian
y el autor aparece en pantalla. El guionista con IA solo usa archivos registrados, y la `nota` le
dice que hay en cada uno.

## 5. YouTube

1. En https://console.cloud.google.com crea un proyecto y habilita **YouTube Data API v3**.
2. Pantalla de consentimiento OAuth: tipo Externo, y anadete como usuario de prueba.
3. Credenciales > Crear ID de cliente OAuth > **App de escritorio**. Descarga el JSON a `secrets/client_secret.json`.
4. La primera vez que ejecutes `publish` se abre el navegador para autorizar. En modo de prueba
   Google caduca el permiso cada 7 dias y habra que autorizar otra vez.

Sin `--at` el video queda en privado para revisarlo en YouTube Studio. Para TikTok, abre Clipper > Ajustes,
instala la librería y conecta tu cuenta; luego puedes publicar clips desde "Clips y publicación" o activar
la subida automática. La sesión se conserva en `secrets/TK_cookies_<cuenta>.json`; no compartas ese archivo.

## 6. Estructura

```
channel.md              guia editorial que lee el guionista (editala)
public/assets/          tus capturas, clips e imagenes + assets.json
public/runs/<id>/       script.json, voice.json, beat-N.wav, props.json, video.mp4, qa.json, state.json
src/shared/             lo comun a las dos apps: rutas y JSON (fs.ts), tiempos de palabras (timing.ts)
src/shorts/cli.ts       comandos
src/shorts/runs.ts      estado de cada video (public/runs)
src/shorts/stages/      script, voice, build, render, qa, publish
src/shorts/remotion/    plantilla del video (Short.tsx, Captions.tsx)
src/shorts/recorder/    grabadora de voz local
src/clips/server.ts     servidor de Clipper (npm start)
src/clips/engine/       motor: index.ts es la fachada; un modulo por responsabilidad
src/clips/ai/           IA local primero: LLM, voz a texto, caras, vision
src/clips/analysis/     deteccion de momentos, historia, estilo, escuela, estadisticas
src/clips/media/        ffmpeg, render rapido, encuadre, transiciones, spec del clip
src/clips/publish/      TikTok
src/clips/web/          la app del navegador; editor.js es la fachada de web/editor/
tests/                  npm test
tests-ui/               npm run test:ui (Playwright)
docs/                   notas e ideas
```

## Estado de las pruebas

Probado de extremo a extremo: demo, guion manual, grabadora (servidor y guardado), fondos de tarjeta,
imagen y clip, subtitulos, render con audio, control de calidad y reanudacion.

Escrito pero **sin ejecutar contra el servicio real** (no habia claves): guion con IA, voz clonada
de ElevenLabs, subida y metricas de YouTube. Si alguno falla en el primer uso, el mensaje de error
indica el servicio y la respuesta recibida.

## Novedades de la versión 10

- **Directo en tiempo real.** Mientras se graba: imagen que se actualiza cada pocos segundos, medidor «Hype ahora» (volumen + chat), chat visible y «Repetir» los últimos 15 s a 2 min sin dejar de grabar. Cuando el medidor se dispara, la app analiza en ese instante; el momento aparece con la etiqueta «en curso» hasta que termina de grabarse.
- **Abrir desde el celular.** En Ajustes → «Abrir desde el celular»: código QR y clave. Solo en la misma wifi (puerto 4301 por defecto, el siguiente al de la app). Desde el celular no se pueden leer archivos del PC, borrar grabaciones ni tocar copias o claves.
- **Espacio en disco.** Ajustes muestra lo libre y lo que ocupa cada grabación; avisa con menos de 5 GB y detiene la grabación con menos de 1 GB.
- **Copia automática.** Una copia diaria de ajustes, plantillas y campañas en `data/backups` (las 7 últimas).
- **Campañas.** Fecha de cierre y enlace; cada clip indica si cumple los requisitos, y «Exportar ya» avisa antes si la duración queda fuera.
- **Zoom automático en la reacción** para «Exportar ya» y lotes (Editor → Zoom).

## Corrección de subtítulos (versión 12)

Editor → Subtítulos → «Corregir ortografía». Sin IA corrige tildes seguras, mayúsculas, signos de apertura y los nombres propios que apuntes por streamer. Con Ollama (`OLLAMA_MODEL` en `.env`, por ejemplo `llama3.1` o `qwen2.5:3b`) corrige además palabras mal reconocidas; si la IA reescribe el texto, su resultado se descarta. Los tiempos de cada palabra se conservan. También se aplica sola en «Exportar ya» y lotes (se puede desactivar).

## Accesibilidad e interfaz (versión 13)

Auditoría contra las guías de Apple: controles de 28 px o más (44 px al tacto), navegación inferior en el teléfono, errores que no desaparecen solos, Intro/Espacio en todo lo pulsable, respeto a «Reducir transparencia», «Aumentar contraste» y «Reducir movimiento» del sistema, y un color por significado en las señales (volumen, chat, reacción, imagen).
