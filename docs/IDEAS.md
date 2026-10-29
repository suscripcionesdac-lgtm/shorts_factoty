# Clipper — ideas

## Hechas en esta version

- Selector de zonas a pantalla completa (camara, juego, difuminado).
- Entrenar con clips de ejemplo, con las vistas de tus clips y con las palabras de cada streamer.
- Versiones por plataforma con zonas seguras, prueba de ganchos, panel de campañas con ganado y
  clips sin enviar, y requisitos de campaña en el editor.
- Modo en vivo rapido, detector de repetidos, chat guardado de resubidos (Twitch y YouTube),
  vista "Todos" para varios directos.
- Censura opcional (pitido o silencio, texto oculto, zonas difuminadas), stickers automaticos,
  musica que baja sola, titulo de entrada y cierre, barra de progreso, color, velocidad y fundidos.
- Acceso directo de Windows con icono, avisos al celular (Discord o Telegram), copia de seguridad,
  guardar por voz ("clip").
- Puntuacion sin empates en 10.

## Pendientes

- Emojis de color dentro del subtitulo. El motor de subtitulos del exportador no los pinta; por ahora
  se resuelve con stickers automaticos.
- Chat guardado de Kick: Kick no lo ofrece para directos terminados.
- Modelo propio afinado (una IA entrenada solo con tus clips). Hace falta mucho mas material del que
  genera una cuenta; hoy la app usa un modelo pequeño por streamer que aprende de tus decisiones y vistas.
- Entender eventos del juego (muertes, victorias) sin IA de vision.
- Instalador de Windows de un solo archivo (.exe) que traiga Node incluido.
- Subida directa a TikTok: su API no la permite para cuentas normales; se sube a mano.
- Sugerir la plantilla (encuadre y estilo de subtitulos) a partir de los clips de ejemplo: hoy los
  ejemplos solo marcan la duracion, el punto del pico y las palabras.
- Musica incluida: hay que añadir pistas propias con licencia en public/music.

## Hecho en la versión 10
- Directo en tiempo real (medidor, chat, repetición, detección al instante)
- Abrir desde el celular en la misma wifi, con clave
- Panel de espacio en disco y copia automática diaria
- Campañas: fecha de cierre, enlace y comprobación por clip
- Zoom automático en la reacción

## Pendientes nuevos
- Buscar por palabra dentro del directo (necesita la transcripción completa)
- Seguimiento automático de la cara en el encuadre
- Título y descripción sugeridos sin IA externa
- Instalador de un solo archivo (.exe)
