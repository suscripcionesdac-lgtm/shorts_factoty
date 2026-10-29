# Reglas de desarrollo (obligatorias)

Consulta estas reglas antes de cada tarea de desarrollo en este proyecto.

## Herramientas disponibles en este proyecto

- **Pruebas de interfaz:** no hay un servidor MCP de Playwright instalado. Se usan:
  - `npm run test:ui`: la suite de Playwright del proyecto (`tests-ui/app.pw.ts`). Recorre la app real en Edge: importar, editar, exportar, rendimiento y errores de consola.
  - La skill `playwright-cli`, para inspecciones puntuales en el navegador (capturas, clics, flujos sueltos).
  - Si en algún momento se instala Playwright MCP, úsalo además de lo anterior.
- **Pruebas unitarias:** `npx vitest run` (`tests/`).
- **Comprobación de tipos:** `npx tsc --noEmit -p .`
- **UX/UI:** skill `apple-design` (`anthropic-skills:apple-design`).
- **Ingeniería inversa:** servidor MCP `rea` y skill `reverse-engineer-anything`.

Si alguna de estas herramientas no está disponible o falla, dilo claramente. No simules su uso.

## 1. Pruebas obligatorias con Playwright

- Después de cada cambio, valida con Playwright las funcionalidades afectadas (`npm run test:ui` y, si hace falta, `playwright-cli`).
- Ejecuta los flujos principales y las pruebas de regresión cuando corresponda.
- Verifica interacciones, navegación, estados, errores y el comportamiento real de la interfaz.
- Por cada fallo encontrado, añade una prueba que lo cubra.
- No des por terminado un cambio sin validar su funcionamiento. Si no puedes ejecutar las pruebas, indica claramente la limitación.

## 2. UX/UI con Apple Design

- Usa siempre la skill `apple-design` para evaluar y orientar los cambios de interfaz.
- Mantén consistencia visual, jerarquía clara, accesibilidad y patrones de interacción intuitivos.
- Reutiliza los tokens y estilos de `src/clips/web/app.css` (colores, radios, `--acc`, `--fill`, etc.).
- Evita interfaces sobrecargadas, interacciones innecesarias y comportamientos inconsistentes.
- Comprueba que cada modificación mejore o preserve la experiencia de usuario. Revisa capturas reales, no solo el código.

## 3. Rendimiento y fluidez

- Prioriza tiempos de respuesta rápidos, animaciones fluidas y una experiencia sin bloqueos.
- Evita renderizados, cálculos, solicitudes y operaciones innecesarias.
- Identifica los posibles cuellos de botella **midiendo** antes de añadir complejidad.
- Valida el rendimiento después de los cambios que puedan afectarlo y compara antes y después cuando sea posible.
- La prueba «reproducir es fluido en todos los encuadres» de `tests-ui/app.pw.ts` debe seguir pasando (60 fps, sin perder fotogramas).

## 4. Flujo de trabajo obligatorio

Para cada modificación:

1. Inspecciona la implementación existente y determina el impacto del cambio.
2. Implementa la solución más sencilla y eficiente que cumpla el objetivo.
3. Revisa la UX/UI con `apple-design`.
4. Prueba con Playwright los flujos afectados y las regresiones relevantes.
5. Corrige los problemas encontrados y repite las pruebas.
6. Resume los cambios, las pruebas ejecutadas y los problemas pendientes.

## 5. Principios generales

- Preserva las funcionalidades existentes y evita regresiones.
- Reutiliza los componentes y patrones establecidos en el proyecto.
- Evita refactorizaciones innecesarias y complejidad accidental.
- No afirmes que una prueba pasó si no se ejecutó y verificó.
- Prioriza calidad, mantenibilidad, rendimiento y experiencia de usuario sobre la velocidad de implementación.
- La IA va primero en local (Ollama y modelos locales); no dependas de servicios externos para las funciones principales.

## 6. Ingeniería inversa funcional con REA

Cuando se pida hacer ingeniería inversa de una funcionalidad con **REA**, sigue este proceso:

- **Reconocimiento:** inspecciona la funcionalidad de referencia para comprender su propósito, interfaz, comportamiento, interacciones, estados, validaciones y reglas de negocio.
- **Exploración y análisis:** investiga cómo funciona realmente, identifica sus componentes y flujos principales, y determina qué comportamientos deben reproducirse.
- **Aplicación e implementación:** adapta e implementa las funcionalidades identificadas en este proyecto, respetando su arquitectura, tecnologías y convenciones.

No te limites a describir la funcionalidad ni a proponer un diseño: **implementa lo solicitado**.

Durante el proceso:

1. Analiza la funcionalidad de referencia y recopila evidencias de su comportamiento.
2. Identifica sus capacidades principales, casos límite, estados de error y detalles relevantes de UX/UI.
3. Traduce los hallazgos en requisitos funcionales concretos.
4. Implementa una solución equivalente en comportamiento, adaptada al proyecto. El código, los shaders, los modelos y los recursos propietarios de la referencia no se copian: se reproduce el comportamiento con código propio.
5. Usa `apple-design` para mantener una experiencia intuitiva, coherente y visualmente cuidada.
6. Usa Playwright para probar los flujos, las interacciones y los casos relevantes, comparando el resultado con el comportamiento esperado.
7. Corrige los defectos encontrados y valida las regresiones.

Si no hay acceso suficiente a la funcionalidad de referencia, pide la URL, capturas, acceso o la información que haga falta. No inventes comportamientos que no se hayan podido verificar. Si la lógica de la referencia no está en local (por ejemplo, porque se ejecuta en servidores del fabricante), dilo y reprodúcela a partir de su comportamiento observable.

**Criterio de aceptación:** la funcionalidad queda implementada y probada, con un comportamiento equivalente al requerido, buena experiencia de usuario y rendimiento adecuado. Documenta las diferencias inevitables y las limitaciones pendientes.
