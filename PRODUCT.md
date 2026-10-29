# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Un clipero que cobra por vistas: graba directos de streamers (por ejemplo auronplay o westcol, en Twitch y Kick), saca los mejores momentos en vertical y los sube a TikTok o YouTube Shorts para cobrar campañas por vistas. Muchas veces trabaja mientras el directo sigue en marcha, con prisa por publicar antes que nadie.

## Product Purpose

Clipper lleva un momento del directo hasta el dinero: detectarlo, guardarlo, editarlo en vertical, publicarlo y cobrar la campaña. El éxito es publicar más clips buenos, antes y con menos trabajo manual.

## Positioning

- Detecta momentos en directo: mide en vivo el volumen, el chat y la imagen (el «Hype») y guarda lo que acaba de pasar con un botón o una tecla.
- Edita solo y aprende de ti: auto edición de un clic (subtítulos, cámaras, zooms, cortes) que aprende de tus correcciones y de shorts que funcionan.
- Del directo a cobrar: publica en TikTok y YouTube y lleva las campañas (requisitos, vistas, lo ganado).
- Todo gratis y local: corre en el PC con IA local (Ollama); Claude solo como último recurso.

## Operating Context

- Se usa en el navegador del PC (localhost, Windows) y desde el celular en la misma wifi.
- Fuentes: directos y VODs de Twitch y Kick, archivos locales y clips de la comunidad (Twitch/Kick), que se pueden buscar en el VOD con margen.
- Flujo: En vivo (grabar, Hype, guardar 30/45/60/90 s, momentos) → Editor (encuadres fit/split/duo/float/crop, subtítulos, textos, stickers, sonidos, zoom, transiciones, velocidad, imagen, censura, línea de tiempo con pistas) → Clips (galería, detalles, descargar, publicar, calendario, montajes) → Campañas (requisitos, vistas, enviado, ganado) → Agente y Laboratorio (escuela de shorts, perfiles por streamer, medir el parecido de la auto edición) → Ajustes.
- Avisos en la app, en el navegador y al celular (Discord, Telegram).

## Capabilities and Constraints

- La interfaz es JavaScript sin frameworks (src/clips/web), servida por un servidor Node (src/clips/server.ts); exporta con FFmpeg.
- La calidad del clip exportado no se puede bajar en ningún encuadre; la vista previa debe verse bien.
- Todo en español claro: «que lo entienda un niño», con una explicación por herramienta (ayuda y recorrido).
- Cada cambio se verifica con las pruebas de Playwright (npm run test:ui).

## Brand Commitments

- Nombre: Clipper.
- Referencia de estructura y aspecto pedida por el usuario: DaVinci Resolve (páginas por pasos del trabajo, paneles que se muestran u ocultan, visor, inspector, línea de tiempo). Las páginas van arriba, no abajo.

## Evidence on Hand

- Capturas reales de DaVinci Resolve 21 y CapCut tomadas en esta máquina (scratchpad de la sesión, refs/resolve.png, refs/capcut.png).
- No hay testimonios, clientes ni cifras de negocio reales: no inventarlos.

## Product Principles

1. Lo que acaba de pasar en el directo se guarda en un gesto, desde donde estés.
2. La máquina propone y el usuario decide; lo que corrige, se aprende.
3. Nada baja la calidad del clip.
4. Gratis y en el PC del usuario antes que cualquier servicio de pago.
5. Cada pantalla se entiende sin leer un manual.

## Accessibility & Inclusion

WCAG AA: contraste de texto 4,5:1 (3:1 en componentes), teclado completo, foco visible, movimiento reducido respetado, objetivos táctiles de 44 px en el celular.
