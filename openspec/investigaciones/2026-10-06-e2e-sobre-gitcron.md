# Pruebas que usan la app de verdad: `e2e` (tester-army) sobre GitCron

Investigación pedida por Ale el 2026-10-06: «¿esto sirve para mejorar las revisiones o auditorías?» y, después,
«quiero ver de implementar e2e». Leído en el repositorio [`tester-army/e2e`](https://github.com/tester-army/e2e)
(último cambio el 2026-10-06, licencia Apache-2.0, antes de la 1.0, unas 5.400 estrellas), en su documentación
(`docs/` del repositorio) y en el código del motor web (`packages/web/src`). No es una propuesta: es la base para
decidir una medición y, con ella, si se abre un cambio.

## Por qué interesa

En la tanda 24 de modelos-en-casa se escaparon dos errores de pantalla que sólo encontró la lectura del código: el
selector de modelo se caía al llegar un aviso del proceso principal, y otro aviso borraba lo que la persona estaba
eligiendo. Las pruebas no los vieron porque simulan el proceso principal y la simulación tenía la misma
equivocación que el código. Una prueba que usa la app real, como una persona, los habría encontrado sola.

## Qué es

Un marco de pruebas de punta a punta escrito en TypeScript. Una prueba mezcla pasos de código (localizadores y
`expect`, como Playwright) con pasos en lenguaje común que hace un agente: `agent.act('abrí Motores y modelos y
elegí un modelo')`, `agent.assert('el uso muestra el modelo elegido')`. Un paso del agente que una verificación
posterior confirma **se graba**; las corridas siguientes lo repiten sin llamar al modelo hasta que la pantalla
cambia. Deja un reporte con pasos, fallas, capturas y video que una persona o un agente de código puede leer.
Trae un servidor MCP (`e2e mcp`) para que un agente de código abra la app y la maneje.

Motores: web (Playwright: Chromium, Firefox, WebKit) y celular (simuladores de iOS y Android). **No tiene motor
para escritorio ni menciona Electron.** El contrato de motores es público (`observe`, `locate`, `perform`,
`session`) por si alguien quiere escribir uno.

## Cómo podría manejar GitCron

El motor web tiene un modo que **se engancha por CDP** (el protocolo de depuración de Chrome) a un navegador ya
abierto en vez de lanzar uno (`web({ connect: { cdpEndpoint, reconnectEndpoint } })` en `surface.ts`). Electron se
puede abrir con `--remote-debugging-port`, que expone ese mismo protocolo. Lo leído en el código:

- Sin `reconnectEndpoint`, cada intento crea un contexto nuevo (`browser.newContext`): Electron no lo admite por
  CDP. **Hay que usar el modo persistente** (con `reconnectEndpoint`).
- En el modo persistente (`attachPersistent` en `cdp-recovery.ts`) el navegador tiene que tener sólo su contexto
  por omisión (Electron lo cumple) y la primera pestaña pasa a ser la página del intento: la lleva a
  `about:blank` y después a la dirección de la app (`app.url`). En GitCron, la ventana principal iría a la
  dirección de la pantalla (en desarrollo, el servidor de Next); la precarga de Electron (`window.api`) se vuelve
  a poner en cada navegación, así que la pantalla tendría su puente al proceso principal.
- **Rechaza reusar el mismo navegador en dos intentos** («provision a fresh browser»). El `cdpEndpoint` tiene que
  lanzar **un GitCron nuevo por intento** y devolver su dirección: unos segundos de arranque por prueba.

Nada de esto está probado: es lo que dice el código. Por eso lo primero es medir.

## Lo que pide y lo que choca

- **Windows: la documentación pide correrlo dentro de WSL.** GitCron corre en Windows. Habría que medir si el
  corredor anda igual en Windows nativo y, si no, correrlo en WSL enganchado a un GitCron de Windows (con la red de
  WSL en modo espejo, `localhost` es compartido).
- **Modelo:** tiene que aceptar herramientas e imágenes (mira capturas). Admite claves de API (Anthropic, OpenAI y
  otras), servidores locales compatibles con OpenAI (LM Studio, Ollama, vLLM, llama-server) y suscripciones:
  **ChatGPT Plus o Pro** (`npx e2e login openai`), GitHub Copilot, OpenCode Console y SuperGrok. **La suscripción
  de Claude no sirve.** Ale tiene ChatGPT por Codex: no habría costo nuevo. Un modelo local sirve sólo si acepta
  imágenes (Qwen 3.8 de Unsloth: a confirmar).
- **Aislamiento:** el GitCron que se prueba no puede usar la configuración, el baúl ni los repositorios de Ale.
  Hace falta arrancarlo con datos propios (`userData`, `gitcron.json` global, baúl y repositorios de prueba).
  Hoy GitCron no tiene una forma documentada de arrancar así: es la primera pieza a resolver.
- **Telemetría:** el CLI manda estadísticas anónimas por omisión (no el contenido de las pruebas ni de la app). Se
  apaga con `e2e telemetry disable` o una variable de entorno; en GitCron, apagada siempre.
- **Mantenimiento:** es una capa nueva de pruebas. Lo grabado vive en el repositorio y se vuelve a grabar cuando
  la pantalla cambia; el proyecto todavía no es 1.0.

## Sin modelo: el auditor como agente (corregido el 2026-10-06, a pregunta de Ale)

El modelo sólo hace falta para los pasos en lenguaje común (`agent.act`, `agent.assert`). El servidor MCP
(`e2e mcp`, `docs/reference/mcp.mdx`) **no necesita modelo**: un agente de código (el auditor, en Claude Code) abre
una sesión, maneja la app con herramientas fijas y su herramienta `locate` devuelve el código de prueba del
elemento que encontró. Las pruebas que salen de ahí usan `screen` y `expect` (localizadores y verificaciones, como
Playwright) y corren sin modelo, sin cuenta y sin costo. Se pierde que el paso se arregle solo cuando la pantalla
cambia: se actualiza a mano, cosa que la auditoría de cada tanda ya hace. Los pasos con modelo quedan para después,
si hacen falta (con un modelo local que acepte imágenes, o una suscripción).

## Prueba de concepto (2026-10-06): anda en Windows, sin WSL

Medido con e2e 0.17.0 y `@e2e-dev/web` 0.12.0 sobre Node 24.21.0 (pide 22.22.3 o más), en Windows nativo:

- **GitCron aislado:** `GITCRON_PROFILE_DIR` (`electron/profile.ts`, `3dc69bb`) saca de una carpeta de prueba
  `userData` y la carpeta de usuario; convive con el GitCron de todos los días.
- **Enganche:** un proveedor de navegadores con `scope: 'attempt'` abre un GitCron nuevo por intento con
  `--remote-debugging-port` libre, espera a que la única página sea la pantalla, y al soltar mata el árbol
  (`taskkill /T`) y borra el perfil. El modo persistente y la navegación funcionan con Electron 42.
- **La pantalla:** `app.command` levanta `next dev -p 3001` (con `reuseExisting`, usa el de quien esté
  trabajando). El entorno del comando es mínimo: en Windows hay que pasarle `PATH` y `SystemRoot`, y la ruta de
  Node completa.
- **Trampa:** el indicador de Next.js en modo desarrollo («N») tapa el botón de Configuración y se lleva los
  clics. Se oculta con un `initScripts` que adopta una hoja de estilos (un `<style>` agregado se pierde al hidratar).
- **Tiempos:** ~8 s el arranque del servidor si ya compiló (30 s la primera vez) y ~7 s por prueba con GitCron
  incluido. No queda nada abierto ni carpetas sueltas.
- **Lo que encontró en la primera corrida**, que ninguna prueba veía: la pantalla de inicio sin repositorios con
  claves de traducción en crudo (desde `887dfecc`); al buscar el resto con una prueba nueva
  (`lib/__tests__/i18n-claves-usadas.test.ts`), el diálogo de descartar cambios sin textos desde que existe
  (`c26c8485`) y tres claves más; en «Motores y modelos», un uso con modelo propio sin elección general decía
  «Sigue la general»; y la fila desplegada de un uso muestra dos botones «Elegir modelo».

Lo guardado de la prueba de concepto está en `C:/www/gitcron-e2e-poc`, fuera del repositorio (dentro, `tsc` y el build
revisan sus pruebas y no tienen el paquete `e2e`): configuración, proveedor y dos
pruebas. Para correrlo: `npm install` ahí y `npx e2e run` con `E2E_TELEMETRY_DISABLED=1`.

## Recomendación

Medir antes de decidir, con una tanda de prueba de concepto fuera de las dependencias de GitCron:

1. Una forma de arrancar GitCron aislado (datos, configuración y baúl de prueba) con `--remote-debugging-port`.
2. `e2e` instalado en una carpeta aparte, con la telemetría apagada y sin modelo (el auditor maneja la app por `e2e mcp`).
3. Una sola prueba: abrir Configuración → «Motores y modelos», desplegar un uso, elegir un modelo, guardar y ver
   que quedó; y la misma prueba sobre el error del selector de la tanda 24, para comprobar que lo habría visto.
4. Anotar: si anda en Windows nativo o pide WSL, si el enganche por CDP y la navegación funcionan con Electron
   y cuánto tarda cada prueba.

Con eso se decide si se suma a `pnpm verificar` (o como paso aparte de las auditorías) o si se queda Playwright
solo, que maneja Electron sin agregados (`_electron.launch`) y no necesita modelo. Mientras tanto, `e2e mcp` sirve
para que el auditor maneje la app real durante una auditoría.
