# Changelog - GitCron

Changes are listed from newest to oldest.

---

## [v1.19.0] - 2026-09-29 - SDD conectado de punta a punta

Primer cambio del plan de integración: lo que SDD mostraba ahora llega a algo real. Las «decisiones» que no tenían a quién responder pasan a ser avisos, toda IA que se lanza desde SDD puede hacer el trabajo completo, y preparar y confirmar un commit desde SDD tiene las mismas operaciones Git que Graph.

### 🤖 Pipeline & Workspace OpenSpec

#### Added
- **Avisos en lugar de decisiones sin destino.** Las auditorías rechazadas de `docs/reports` se muestran en «Avisos» con su resumen y «Ver evidencia», que abre el archivo. Ya no prometen una respuesta que ninguna sesión podía recibir.
- **Entrada «Avisos (n)» en el riel de SDD.** Abre el panel derecho, despliega la sección aunque esté plegada y deja el foco en el aviso.
- **Toda IA lanzable desde SDD lee, escribe y corre comandos**, con una confirmación explícita y sin opciones «dangerously…»: Codex con `--sandbox workspace-write`, Claude con `Bash`. Ver SECURITY.md §9.
- **El inspector de SDD tiene las operaciones Git de Graph:** cambios sin preparar con Stage all, Limpiar y descartar, Unstage all, Commit, Amend, Squash, Deshacer último rebase, Stash y el aviso de rebase en curso. Es el mismo bloque en las dos vistas, con el plegado compartido.

#### Fixed
- **Un aviso ya no frena el siguiente paso.** Con una auditoría rechazada en el repositorio, el riel seguía diciendo «Necesita tu decisión» y dejaba de ofrecer Aplicar y Archivar.
- **La disponibilidad por intención se decide por capacidades declaradas**, no por el nombre de la IA; se retiran «sólo puede leer» y «no puede correr pruebas».
- **La preparación no cruza mensajes entre repositorios.** Cambiar de repo durante una redacción con IA dejaba el mensaje en el campo de commit del otro y el modelo seguía trabajando; ahora la redacción se corta y la sugerencia queda en el repositorio de origen.
- **«Preparar» ya no queda girando en desarrollo.** El doble montaje del modo estricto de React dejaba el panel creyéndose desmontado.
- **Pruebas que dependían de la máquina** (qué runtimes había instalados) comparan contra el motor.

#### Changed
- **Sincronizar specs sin archivar** pasa al cambio `completar-cobertura-operativa-de-openspec`.
- **Plan de integración** en `openspec/EXECUTION.md`; la rutina de tandas vive sólo en `openspec/config.yaml`. Se retira `explicar-el-ciclo-sin-tecnicismos` sin consolidar sus specs.

**Validación:** `build` en 0 · `tsc --noEmit` en 0 · 217 archivos y 2340 pruebas en verde (dos pasadas) · `eslint` limpio sobre lo tocado · `openspec validate --strict` válido · revisión en pantalla sobre gitCronos y odontoPro.

---

## [v1.18.0] - 2026-09-26 - Las herramientas de OpenSpec las decide el motor

GitCron deja de llevar a mano la lista de herramientas de OpenSpec: le pregunta al motor de cada repositorio qué herramientas hay, cuáles están configuradas y cuáles necesitan actualizarse. Con eso desaparecen los «sin configurar» y «desactualizado» que el motor no sostenía, y la pantalla de configuración se lee sin sobresaltos.

### 🤖 Pipeline & Workspace OpenSpec

#### Added
- **Informe de herramientas del motor.** GitCron corre, en un proceso aparte y sin bloquear la app, las funciones con las que OpenSpec decide qué hay en un proyecto (disponibles, configuradas, vigencia y sincronización con el perfil), usando el paquete de la versión que responde en ese repositorio.
- **Respaldo declarado.** Si el motor no se puede leer, GitCron usa una copia de la lista de OpenSpec 1.13 (`electron/pipeline/openspec-tools-snapshot.json`, recapturable con `scripts/capturar-herramientas-openspec.mjs`) y lo avisa en pantalla con el motivo. Una prueba falla si la copia no corresponde a la versión del ciclo SDD.
- **Inicializar y configurar desde la pantalla.** Un repositorio sin OpenSpec ofrece un solo «Inicializar OpenSpec» eligiendo herramientas; uno que ya lo usa muestra «Detectadas sin configurar: …» con un único «Configurar…». Ambos informan qué quedó y cuántos archivos nuevos hay sin confirmar.
- **Precarga como SDD.** Mientras se lee el motor se ve un esqueleto con la forma de la pantalla, sin saltos.

#### Fixed
- **«Al día» según el motor.** La integración está al día cuando las herramientas configuradas lo están y el perfil no pide sincronizar; una herramienta presente sin configurar se muestra aparte y nunca ofrece «Actualizar».
- **Sin «Ausente» ni «Desconocido» mientras se lee.** Sólo se declaran con una medición que los sostenga.
- **Salidas administrables por carpeta**, presentes sólo si tienen instrucciones de OpenSpec (sin `.agents/skills` repetido ni `.github` fantasma). Se retira «GitHub Workflows», que OpenSpec no tiene.
- **Cabecera coherente:** el botón no dice «Todo al día» cuando falta inicializar o hay pendientes.

**Validación:** `build` en 0 · `tsc --noEmit` en 0 · 211 archivos y 2300 pruebas en verde (dos pasadas) · `eslint` limpio sobre lo tocado · `openspec validate --strict` válido · revisión en pantalla sobre OdontoPau, gitCronos, Portfolio y preinscriptos.

---

## [v1.17.0] - 2026-09-25 - Actualizar OpenSpec donde vive y decir la verdad después

Esta versión corrige el botón «Actualizar» de la Configuración de OpenSpec, que en un repositorio con su propia copia del motor actualizaba la del sistema y terminaba en «Listo» sin haber cambiado nada, y hace que la revisión diga lo que realmente pasa después de actualizar.

### 🤖 Pipeline & Workspace OpenSpec

#### Added
- **Retirar copias viejas de las instrucciones.** OpenSpec 1.13 pasa las instrucciones de Codex de `.codex/skills` a `.agents/skills` y deja las viejas (ni `openspec update --force` ni `openspec init --force` las borran si difieren). La revisión las lista y ofrece «Retirar copias viejas» sólo para las que Git puede devolver (seguidas y sin cambios pendientes); los borrados quedan sin confirmar. Reemplaza a la «Limpieza de configuración legacy (--force)», que no limpiaba nada.
- **Confirmación antes de tocar el motor del sistema** también desde el botón «Actualizar»: comando exacto, gestor de paquetes y repositorios abiertos afectados.

#### Fixed
- **El motor se actualiza donde vive.** Si el repositorio tiene su propia copia, se actualiza esa (queda en `package.json` y el lockfile, sin confirmar); si no, la del sistema. El plan lo dice antes de correr, instala la versión anunciada y da el paso por hecho sólo si después responde esa versión. «Volver a la versión anterior» vuelve en el mismo lugar.
- **La fijación exacta se conserva.** Un `package.json` con la versión exacta sigue exacto (`--save-exact` / `--exact`); un rango sigue siendo rango.
- **El motivo de «Actualización detenida» es el real.** Se retiró el texto fijo sobre la POC y la Fase 3/4; ahora dice si conviven copias viejas y nuevas, si hay instrucciones modificadas, si no se pudo leer el repositorio o si la causa no se pudo determinar.
- **«Integración al día» sólo si lo está.** Después de regenerar, se vuelve a medir; si no quedó al día, se dice cuántos archivos se regeneraron y qué falta.
- **Codex servida desde `.agents` cuenta como configurada** en la cabecera, el bloque AGENTES y el perfil de workflows (se lee `.agents/skills/.openspec-target`). **`.github` ya no aparece como herramienta de OpenSpec sin configurar**: OpenSpec no tiene esa herramienta y ninguna acción podía resolverlo.

**Validación:** `build` en 0 · `tsc --noEmit` en 0 · 206 archivos y 2258 pruebas en verde (dos pasadas) · `eslint` limpio sobre lo tocado · `openspec validate --strict` válido · revisión en pantalla sobre OdontoPau.

---

## [v1.16.0] - 2026-09-24 - Tema claro nativo con tokens semánticos y contraste WCAG AA

Esta versión reemplaza definitivamente la inversión global por filtro CSS por un sistema nativo de tema claro basado en tokens semánticos `light-dark()`, calibrando neutros, acentos con contraste WCAG AA, superficies gráficas en vistas Cronométrica y Clásica, y normalizando los campos interactivos de entrada en toda la aplicación.

### 🎨 Diseño, Tokens y Accesibilidad

#### Added
- **Tema claro nativo por tokens semánticos.** Se retira el filtro global `html.light body { filter: ... }` y los atributos de escape `data-keep-color`. El modo claro resuelve sus colores directamente mediante `color-scheme` y la función estándar CSS `light-dark()` bajo `@theme`, preservando imágenes, videos y avatares sin distorsiones ni artefactos de re-inversión.
- **Paleta de neutros Snow Storm / Slate suave.** El lienzo base adopta un tono slate suave `#d0d7e4` (luminancia 0.68) que elimina el encandilamiento de blancos plenos `#ffffff`. Las superficies y marcos adoptan `#c2ccdb`, con tipografía principal `#202632` (10.49:1) y secundaria `#434d5f` (5.89:1), superando WCAG AA en todas las vistas.
- **Seis acentos semánticos calibrados para tema claro.** Ajuste preciso de `--color-primary` (`#065877`, 5.48:1), `--color-error` (`#a81c1c`, 6.30:1), `--color-warning` (`#6d4700`, 5.65:1), `--color-git-add` (`#1e5e22`, 4.81:1), `--color-git-mod` (`#8f3c00`, 5.79:1) y `--color-accent-purple` (`#5929a5`, 6.40:1). Todos cumplen >4.5:1 sobre fondo base y superficie.
- **Carriles cromáticos de grafos de alta visibilidad.** Los doce carriles de ramas (`--color-graph-branch-1` a `12`) incorporan pares `light-dark()`, ofreciendo tonos saturados y contrastados (>5.1:1) sobre el lienzo claro.
- **Normalización integral de inputs (`--color-bg-input`).** Introducción del token interactivo `--color-bg-input: light-dark(#e7edf7, #242933)` (>12:1 de contraste en texto). Se normalizaron inputs, selects y textareas en Ajustes de Temporal Agent, Preparar commit en SDD, modales de ramas, tags, stash, remotos, worktrees y resolución de conflictos, eliminando el aspecto desactivado por mimetización de fondo con las tarjetas.

#### Fixed
- **Puntero de mira TCAR en vista Cronométrica.** Eliminado el blanqueado causado por `mix-blend-mode: screen` en modo claro al transicionar entre nodos. Se establecieron animaciones y opacidad sólida dedicada (`.chrono-tcar-reticle`), junto con enriquecimiento cromático de contraste y saturación para garantizar nitidez y opacidad total tanto durante como después de los commits.
- **Controles nativos y desplegables sin ilegibilidad.** Los elementos `<select>`, `<option>` y `<input>` heredan tokens de color y esquema nativo sin dependencia de transformaciones del documento.

**Validación:** `build` en 0 · `tsc --noEmit` en 0 · 205 archivos y 2194 pruebas en verde · comprobaciones de contraste en 20 pares WCAG AA · `openspec validate --strict` válido.

---

## [v1.15.1] - 2026-09-23 - Grafo de artefactos para cambios archivados

Esta versión corrige la visualización del grafo de artefactos al consultar o completar el archivado de un cambio OpenSpec, evitando el error de búsqueda del CLI sobre cambios que ya no residen en la carpeta activa.

### 🤖 Pipeline & Workspace OpenSpec

#### Fixed
- **Soporte de cambios archivados en el grafo de artefactos.** Al archivar un cambio o navegar por el historial de cambios archivados, la vista de detalle suprime la llamada fallida a `openspec status` y sintetiza de inmediato el grafo canónico completo con todos sus artefactos (`proposal`, `specs`, `design`, `tasks`) en estado `done`.
- **Resolución resiliente en el backend CLI.** En `artifactGraphOpenSpecWithCli`, si la consulta al CLI arroja error porque el cambio ya fue archivado a `openspec/changes/archive/`, el backend detecta su presencia en el archivo y retorna la estructura completada en lugar de propagar un banner rojo de error.

**Validación:** `build` en 0 · `tsc --noEmit` en 0 · 205 archivos y 2193 pruebas en verde · `eslint` limpio sobre lo tocado · `git diff --check` limpio.

---

## [v1.15.0] - 2026-09-23 - El ciclo SDD completo, visible y sin trabas

Esta versión consolida el recorrido de artefactos OpenSpec en GitCron: el ciclo SDD pasa a ser un flujo de trabajo continuo, observable y accionable directamente en la aplicación, con un vigilante de archivos que ya no genera bloqueos en Windows.

### 🤖 Pipeline & Workspace OpenSpec

#### Added
- **Grafo de artefactos cronológico y ordenado por dependencias.** El motor OpenSpec CLI (ciclo SDD 1.13) devuelve directamente el grafo estructurado (`description`, `dependencies`, `unlocks`, `resolvedOutputPath`, `existingOutputPaths`). Se presenta en una línea temporal horizontal continua con selección clara del nodo y una ficha unificada inferior que detalla estado, rutas, acción o motivo de bloqueo.
- **Recorrido estructurado del ciclo de cambio.** Flujo paso a paso para explorar, proponer, aplicar y archivar cambios con seguimiento de la respuesta del modelo en tiempo real. La bitácora cuenta con altura acotada y scroll independiente para no desplazar la pantalla al infinito, e interruptores dedicados para filtrar canales sin solapar estilos.
- **Pase explícito al cambio creado.** Al terminar la sesión de propuesta de un cambio, la aplicación declara la finalización y ofrece pasar al nuevo cambio mediante confirmación explícita, evitando saltos de contexto intempestivos mientras la persona lee los resultados.
- **Editor y visor interactivo de tareas (`tasks.md`).** Sincronización bidireccional entre la lista interactiva de tareas y el archivo Markdown en disco. Ante cualquier desfase de snapshot, la vista rescata de inmediato el contenido exacto de disco vía canal seguro de lectura, garantizando visualización instantánea y sin pantallas en blanco tanto en vista cruda como formateada.
- **Numeración de tareas transparente y editable.** Al crear o editar tareas, el número propuesto se presenta en su propio campo editable y borrable, evitando la síntesis de identificadores internos opacos en el listado visual.
- **Soporte de especificación y ciclo OpenSpec 1.13.0.** Actualización del análisis de versiones y compatibilidad con las últimas capacidades de introspección del CLI.

#### Changed
- **Reorganización del cuerpo SDD para cualquier pantalla.** El contenedor adopta un ancho unificado (`--sdd-body-width: 1100px`) y una transición idéntica de 320 px y curva compartida entre el riel flotante y el panel derecho, garantizando estabilidad visual absoluta sin saltos de maquetación al alternar paneles.
- **Retiro de restricciones artificiales de bordes.** Se retiran las comprobaciones sintéticas de bordes sobre el cuerpo SDD, preservando intactas las aserciones estructurales y visuales de Chronometric Graph.

### 🟢 Vista Clásica & Core

#### Fixed
- **Vigilante recursivo nativo en sustitución de Chokidar.** Observador directo sobre `fs.watch` con lista de exclusión para directorios de soporte y estabilización de eventos de 200 ms. GitCron deja de retener bloqueos `EPERM` en Windows al renombrar carpetas o al archivar cambios desde la terminal o el explorador de archivos.
- **Sincronización robusta de selección de cambios.** La selección manual de cambios en el tablero notifica inmediatamente al backend, asegurando la consistencia de artefactos en memoria entre diferentes pestañas y vistas.

#### Quality
- **Suite de verificación canónica (`pnpm verificar`).** Integración del script de comprobación integral (`scripts/verificar.mjs`) que ejecuta en secuencia canónica `pnpm build`, doble pasada de Vitest, TypeScript, ESLint estricto con control de errores preexistentes, validación estricta de OpenSpec y control de trampas de desarrollo.

**Validación:** `build` en 0 · `tsc --noEmit` en 0 · 205 archivos y 2191 pruebas en verde · `eslint` limpio sobre lo tocado · `openspec validate --strict` válido.

---

## [v1.14.0] - 2026-08-11 - Que borrar no pueda ser un accidente

Borrar una rama en GitCron podía terminar pidiéndole a GitHub que borrara `main`, y frente a un worktree o a un directorio con dependencias sólo volcaba el error crudo de Git. Esta versión cierra esos caminos y, donde la operación no puede completarse, explica por qué y ofrece la salida.

### 🟢 Vista Clásica & Core

#### Fixed
- **Nunca se borra la rama por defecto del remoto.** El borrado remoto resolvía el upstream configurado, y una rama local puede tener `origin/main` como upstream sin que su nombre lo delate: había dos así en este mismo repositorio. Pedirle a GitHub que borrara `main` fallaba sólo por la protección del servidor — que no es una garantía. La guardia vive en el canal IPC y no únicamente en la interfaz, porque el canal es alcanzable por su cuenta.
- **Un upstream `gone` ofrece sólo el borrado local**, en vez de intentar una operación remota que va a fallar.
- **Cuando el nombre remoto difiere del local, la confirmación lo muestra.** Leer que se va a borrar `main` tiene que ser posible antes de aceptar, no deducirlo del nombre de la rama local.
- **Una rama abierta por un worktree se puede borrar desde la aplicación.** Antes aparecía `cannot delete branch used by worktree` y ahí terminaba todo. Ahora se explica y se ofrece soltar el worktree, nombrando el directorio y advirtiendo qué se pierde.
- **Y cuando Git no puede quitar el worktree porque quedan archivos que no gestiona** —`node_modules` casi siempre, o sea el caso normal en un proyecto JavaScript— se dice eso, se cuenta cuánto quedó y se ofrece borrar la carpeta completa. Es una confirmación aparte: borrar decenas de miles de archivos no puede leerse igual que las anteriores.
- **Las carpetas de ramas recuerdan si están abiertas**, por repositorio y entre sesiones. Arrancan cerradas: con decenas de ramas remotas, desplegar todo en cada apertura volvía la lista inmanejable. Saltar a una rama sigue abriendo la carpeta que la contiene.
- **Se retiró un `confirm()` nativo de Windows** al eliminar un worktree con cambios sin confirmar. Además de romper la estética, bloquea el hilo del renderer.
- **El texto ya no se desborda de los diálogos.** Un contenedor flexible sin `min-width: 0` no puede encogerse por debajo de su contenido más largo, y una ruta sin espacios empujaba el texto fuera del recuadro.
- **El botón de maximizar dice en qué estado está la ventana**, y escucha los eventos de la ventana: también cambia por doble clic en la barra o con `Win`+flechas.

#### Quality
- Prueba de la guardia **contra Git real** —repositorio bare como remoto, clon y `remote set-head`— que además comprueba que `main` sigue existiendo tras el rechazo: sin esa aserción, un borrado que ocurre y después informa el error pasaría igual.
- Pruebas de la secuencia soltar → borrar: si el worktree tiene cambios sin confirmar, la rama **no** se borra y el motivo se reporta para pedir la segunda confirmación.
- Pruebas del estado de las carpetas: arrancan cerradas, no se pisan entre repositorios, sobreviven a volver a montar y un valor corrupto en disco no rompe el panel.

**Validación:** `tsc --noEmit` en 0 · 136 archivos y 1067 pruebas en verde · `eslint` limpio sobre lo tocado · `openspec validate --strict` válido.

---

## [v1.13.0] - 2026-08-11 - Dejar de trabajar cuando no hay nada que hacer

> Esta versión no llegó a etiquetarse: `package.json` la declaró y su contenido se publicó, pero no quedó ningún tag `v1.13.0`. Lo que sigue documenta ese cuerpo de trabajo igual.


Tres cambios OpenSpec sobre lo mismo: la aplicación hacía trabajo constante sin que nada hubiera cambiado. Se redibujaba entera cada 2 segundos, preguntaba por el estado del repositorio aunque estuviera quieto, y no se enteraba de la mitad de lo que pasaba en Git salvo preguntando.

Nada de lo que sigue se afirma sin haberlo corrido: cada número tiene el comando que lo produjo.

### 🟢 Vista Clásica & Core

#### Fixed
- **La aplicación entera dejó de redibujarse cada 2 segundos.** Cuatro defectos que se sumaban: un latido que releía el estado sin mirar si algo había cambiado, un store que devolvía un array nuevo en cada llamada aunque el contenido fuera idéntico, el componente raíz suscrito a todo el store sin selectores, y un comentario que justificaba no memoizar invocando un compilador de React que **no está instalado**. Medido: de 10 notificaciones cada 10 latidos ociosos a **0**.
- **El comparador que hace posible lo anterior distingue los cinco campos de un archivo**, no tres. Un archivo que entra en conflicto durante un merge conserva ruta, estado y preparado: sólo cambia su marca de conflicto. Con un comparador de tres campos, la lista se habría congelado justo durante un merge. Un tipo mapeado obliga al compilador a fallar si alguien agrega un campo y no lo compara.
- **Los cambios de Git llegan por evento.** El observador ignoraba `.git/` entero, así que preparar archivos, cambiar de rama, un merge o un commit desde la terminal **no producían ningún evento**: la aplicación se enteraba sólo cuando el temporizador preguntaba. Ahora observa una lista blanca —`index`, `HEAD`, `MERGE_HEAD`, los directorios de rebase y `refs/heads/`— y `git status` deja de ser la única fuente.
- **Y se relee lo que corresponde a cada evento.** Un cambio del árbol se resuelve con `git status`; uno de `.git/` exige releer también ramas y log. Sin esa distinción, una rama creada desde la terminal tardaba en aparecer y una borrada no se iba hasta refrescar a mano.
- **El botón de maximizar dice en qué estado está la ventana.** Mostraba un ícono fijo, y como GitCron arranca maximizada, el caso más frecuente era el que mostraba mal. Ahora alterna, y escucha los eventos de la ventana: también cambia por doble clic en la barra o con `Win`+flechas.

#### Changed
- **El temporizador de respaldo se volvió adaptativo:** frecuente tras actividad reciente, espaciado cuando el repositorio está quieto. En reposo pasa de 30 lecturas por minuto a 6. No se eliminó, y hay evidencia de por qué: durante un `checkout` masivo el observador del árbol sufre ~1.000 errores `EPERM` de Windows y puede no emitir nada. Lo que no se detecta no se nota hasta que alguien confirma un commit con la lista de archivos vieja.
- **Una guardia barata antes de cada relectura**: un `stat` de `.git/index` decide si vale la pena ejecutar `git status`. Sólo puede evitar una lectura, nunca descartar un evento: ante cualquier ambigüedad, se lee.

### 🤖 Pipeline

#### Added
- **La espera de carga de un modelo se muestra en un cuadro con barrido**, con el contador siempre legible debajo. La barra es **indeterminada a propósito**: se capturó el log de una carga real y el servidor no emite ninguna fracción de progreso, sólo hitos. Un relleno que avanzara sin ese dato afirmaría un porcentaje que nadie sabe.
- **Aviso al terminar de cargar y al expulsar**, confirmado contra el catálogo en vez de darse por hecho porque la llamada no falló.
- **Indicador del estado del modelo** con punto de color, para distinguir de un vistazo si está cargado o en disco.

#### Fixed
- **Expulsar comprueba primero si el modelo sigue cargado.** Sacarlo desde LM Studio dejaba a GitCron afirmando «cargado», y el botón animaba una expulsión que no expulsaba nada.
- **El campo del mensaje de commit ya no se autocompleta solo.** La sugerencia estaba en el valor del campo, así que borrarlo la reponía y era imposible escribir uno propio desde cero. Ahora vive en el `placeholder`, que es lo que realmente es.
- Tres avisos que se leían mal o mentían: un mensaje que se renderizaba una palabra por renglón, una etiqueta que decía `MODIFIED` sobre un archivo en conflicto, y una clave de traducción muerta con un valor escrito a mano.

#### Mediciones

| Qué | Resultado |
|---|---|
| Notificaciones del store en 10 latidos ociosos | 10 → **0** |
| `git status --porcelain` | mediana **42 ms** en reposo · **74 ms** bajo carga |
| Guardia (`stat` de `.git/index`) | mediana **16 µs** — 2.600 a 4.600× más barata |
| `checkout` de 1109 archivos, eventos en `.git/` | **2** crudos → **1** tras agrupar |
| Rebase de 5 commits, eventos en `.git/` | **3** crudos → **1** tras agrupar |
| Lecturas por minuto en reposo | 30 → **6** |

**Validación:** `tsc --noEmit` en 0 · 134 archivos y 1048 pruebas en verde · `eslint` limpio sobre lo tocado · `openspec validate --strict` válido en los tres cambios.

---

## [v1.12.0] - 2026-08-10 - Preparar el commit desde Pipeline, con redacción por IA local

El commit deja de ser algo que se arma en otra pestaña. Pipeline pasa a tener un panel donde se elige qué entra, se ve de qué cambio viene cada archivo y se escribe el mensaje; y un modelo local puede redactar el asunto, que es el único dato que ninguna fuente del repositorio contiene.

Cincuenta y un cambios OpenSpec archivados desde la v1.11.0.

### 🤖 Pipeline

#### Added
- **Panel de preparación a nivel del repositorio.** Se elige archivo por archivo qué entra, agrupado por procedencia, y el mensaje se corrige ahí mismo escribiendo en el mismo estado que después se confirma. Preparar no confirma: la confirmación sigue siendo una acción humana desde Commit.
- **Atribución de archivos a su cambio.** Cada archivo declara de dónde viene y con qué fuente: que un archivo viva bajo la carpeta de su cambio es un hecho, que lo diga la rama es una declaración, y el hecho manda. Nada entra preseleccionado.
- **Redacción del asunto del commit con un modelo local.** El tipo convencional —`feat`, `fix`, `chore`— no está en el diff, ni en las rutas, ni en la rama, ni en las tareas: es lo único que un modelo aporta y que ninguna heurística puede deducir. Corre contra LM Studio, con el endpoint declarado, y **el código no sale a ningún tercero**.
- **Elección informada del modelo**, con su estado, contexto real cargado, tamaño, cuantización, si razona y en qué máquina vive. Nada viene preseleccionado: está medido que la función sirve o no según cuál sea el modelo.
- **Carga y expulsión del modelo desde el panel**, declarando el costo antes de tomarlo y con desalojo automático por inactividad configurable. Antes GitCron podía tomar 7 GB de la placa sin ofrecer cómo soltarlos.
- **Lo que el modelo va pensando, a la vista mientras lo piensa.** El asunto llega por SSE y se muestra en el rail derecho según se produce, con el conteo de tokens que explica una espera larga. Medido: de 308 cuadros de una redacción, 278 son razonamiento.
- **Pantalla de inicio de Pipeline**, rama por cambio al crearlo, marcas de creación y archivado, y lectura de los artefactos y las especificaciones dentro de la aplicación.

#### Fixed
- **Fallos de push explicados.** Un push rechazado dice qué pasó y ofrece reapuntar el vínculo de la rama, en vez de volcar la salida cruda de Git.
- **Un fallo del servidor de IA ya no se lee como «el modelo no contestó».** El error llega dentro del stream, después de un 200, así que el código HTTP no lo delata: se reconoce, se muestra el motivo del servidor tal cual, y **se acompaña de qué pasó y qué hacer en castellano llano**. Un error que no se reconoce no recibe consejo inventado.
- **Controles que se apagaban sin decir por qué.** El botón de cargar explica qué valor corregir en vez de quedarse gris, y el estado del modelo declara el contexto y los minutos elegidos en lugar de números escritos a mano que contradecían a los campos de al lado.
- **El piso de contexto baja de 32.768 a 16.384.** El valor anterior no salía de ninguna medición y bloqueaba justamente la salida que hace falta cuando la placa no aguanta: el prompt más grande medido son 4.649 tokens.
- Confirmación de tareas a alto completo, identidad fija del archivado, y declaración explícita del fracaso de un run que el runtime rechazó.

#### Changed
- **Cancelar corta de verdad.** La versión anterior descartaba la respuesta y el modelo seguía trabajando del otro lado.
- Cargar un modelo ya cargado **no se apila**: comprobado que el servidor devuelve una segunda instancia en vez de reemplazar, y eso dejaba dos copias ocupando la placa.
- El estado de la redacción vive **fuera de React**, con ventana de agrupado de 120 ms entre el stream y el IPC. Sin eso, ~45 cuadros por segundo serían 45 re-renderizados por segundo del panel entero durante hasta un minuto.

#### Mediciones
Nada de lo anterior se afirma sin haberlo corrido:

| Qué | Resultado |
|---|---|
| Redacción con un 12B | 25–57 s · un 9B llegó a 98 s |
| Prompt de 12k caracteres | 4.649 tokens (3,18 char/token) |
| Cargar un 12B por HTTP | 8,8–11 s (29,8 s en una notebook sin GPU dedicada) |
| Catálogo de modelos por WebSocket | 42 ms, contra 1,7–37,8 s del CLI que se retiró |
| Cuadros del stream | 45/s con GPU dedicada · 0,7/s por CPU |

Con techo de 200 y de 1.200 tokens la respuesta llega **vacía** con `finish_reason=length`, porque el razonamiento se come el presupuesto; con 3.000 sale. `enable_thinking: false` es ignorado.

### 🟢 Vista Clásica & Core

#### Fixed
- **Grafo:** la capa de nodos se aísla del encuadre y el encuadre se aplica una vez por cuadro en vez de una por evento.
- **Repositorio observado una sola vez**, y no una vez por consumidor.

### 📐 Método

#### Changed
- La metodología viaja por `openspec/config.yaml`, que es el canal por el que el CLI la entrega a cualquier ejecutor. Una regla que sólo existe en un archivo suelto no la ve quien no lo abre — ya pasó acá con un runtime que trabajó con reglas locales sin saberlo.
- **Se auditaron las dieciséis reglas propias del repositorio contra la salida de `openspec instructions` y se retiraron ocho**, que decían lo mismo que el CLI ya entregaba.
- El andamiaje de fases queda retirado; OpenSpec es el único método.

**Validación:** `tsc --noEmit` en 0 · 131 archivos y 1024 pruebas en verde · `eslint` limpio sobre lo tocado · `openspec validate --strict` válido.

---

## [v1.11.0] - 2026-07-30 - Pipeline es un workspace OpenSpec

> Esta versión existió sólo en desarrollo: `package.json` la declaró pero nunca se etiquetó ni se publicó. Queda documentada aparte porque su contenido es un cuerpo de trabajo propio, y lo que sí se publica es la v1.12.0 de más arriba.

Cambio de perspectiva de la pestaña Pipeline. Dejó de ser una torre de control de agentes múltiples —con Hermes como orquestador, delegaciones entre IA, economía y un veto determinístico de gates— y pasó a ser un tablero del ciclo de vida de OpenSpec sobre el repositorio abierto.

La capa de runtime se conserva y se amplió: cualquier proveedor puede ejecutar OpenSpec desde la app. Lo que se retiró es el andamiaje que la rodeaba.

### 🤖 Pipeline

#### Added
- **Workspace OpenSpec de tres zonas:** navegación de cambios a la izquierda, trabajo al centro y actividad a la derecha, con el ciclo Explore → Propose → Apply → Validate → Archive representado como stepper.
- **Guía contextual del próximo paso:** una función pura deriva qué corresponde hacer según el estado real —cambio activo, tarea pendiente, sesión corriendo, validación fallida, listo para archivar— y de ahí salen la etiqueta, el destino y la habilitación de cada botón. Archivar no puede ofrecerse antes de que la validación pase.
- **Flujo guiado para empezar un cambio:** dos ramas, Propose para una tarea definida y Explore para una idea por definir, con objetivo, nombre validado contra el mismo contrato del CLI y restricciones opcionales. La instrucción `/opsx:*` queda bajo divulgación progresiva.
- **Sesiones que aplican de verdad:** el runtime puede editar el repositorio con `Read, Grep, Glob, Edit, Write` y `--permission-mode acceptEdits`. Toda sesión que escriba exige confirmación humana explícita antes de arrancar, y esa condición vive en la compuerta pura que decide si el arranque se habilita.
- **Lectura de artefactos dentro de la app:** `proposal.md`, `design.md`, `tasks.md` y los spec delta por capacidad se abren desde la navegación y se leen en la columna central, sin salir de GitCron. El markdown viaja dentro de la evidencia ya contenida al repositorio; el renderer no lee archivos.
- **Cambios activos plegables** individualmente, para que la columna siga siendo usable cuando se apilan.
- **Alcance declarado antes de ejecutar:** el lanzador informa qué puede hacer el runtime elegido, tomado de las capabilities que el propio adaptador declara, en vez de prometer trabajo que no puede hacer.

#### Fixed
- **Cambios activos invisibles en Windows.** `execFile('openspec', ...)` no resuelve `openspec.CMD` (ENOENT) y con la extensión explícita Node lo rechaza con EINVAL por la mitigación de CVE-2024-27980. Había tres copias de esa llamada y las tres fallaban: el lector caía siempre en su `catch` y reportaba cero cambios activos aunque el scaffold existiera. El listado pasa a leerse del disco, sin subproceso, y la validación a un módulo único con resolución por plataforma.
- **Panel central desbordado.** El encabezado y las pestañas no declaraban `flex-shrink: 0` dentro de un contenedor con `overflow: hidden`: con un intent largo el bloque se comprimía y el texto se derramaba por encima del contenido.
- **Numeración de tareas ilegible.** `parseMarkdownTasks` asigna a `id` un hash estable y deja el `2.1` dentro del texto. La interfaz mostraba el hash y, peor, la instrucción enviada al agente decía `Continuar con 0bbbc5c…` en vez de `Continuar con 1.1`.
- **Narrativa partida en fragmentos.** Cada delta de texto del runtime se guardaba como una entrada separada, así que un mensaje aparecía cortado en varios pedazos a mitad de palabra. Ahora se acumulan por mensaje, y las sesiones ya persistidas se reparan al cargarlas sin exigir volver a ejecutarlas.
- **Marcadores de i18n sin resolver** en la frase de ayuda del próximo paso.
- **Vista previa capaz de iniciar procesos reales:** `fixtureActive` se calculaba pero no se propagaba hasta el lanzador.

#### Changed
- **Método de trabajo:** OpenSpec es el único. `AGENTS.md` se reescribió en consecuencia y las comprobaciones obligatorias de cierre pasan a ser `tsc --noEmit` en cero, `pnpm test` en verde y `openspec validate --strict` válido. Fallow y CodeGraph quedan como rutinas que pide Ale, no como automatismos.
- **Esquema SQLite v6:** se elimina `pipeline_cursor` mediante migración aditiva.

#### Removed
- **Andamiaje multi-agente:** Hermes, el track de fases F00–F08 con sus briefs y prompts, el veto determinístico `gates.ps1`/`gates.sh`, la constitución y el perfil de repositorio.
- **Capa de evidencia del kit:** `GateRecord`, `DelegationRecord`, `VisualDiffRecord`, `hermesConnected`, `stations` y `now`, de punta a punta —parsers, reducer, lector, adaptador, tipos, i18n y vista— junto con `GateHistory` y `AuditorFindings`.
- **Módulos sin ningún consumidor de producción:** presupuestos, catálogo y routing de modelos, salud de contexto, replay, anomalías, estimación, explicación y retención. Tenían pruebas propias, así que la suite pasaba en verde y su desuso no se notaba.

Se conservan los fixtures de `docs/pipeline/f03`, que no son documentación sino evidencia citada por los adaptadores y leída por la suite de conformance.

**Validación:** `tsc --noEmit` en 0 · 76 archivos y 547 pruebas en verde · `openspec validate --strict` válido.

---

## [v1.10.9] - 2026-07-20 - Avisos de staging claros y accionables

### 🟢 Vista Clásica & Core

#### Added
- **Recuperación de archivos ignorados**: cuando `.gitignore` impide preparar un archivo, GitCron muestra un aviso coloquial con las acciones “Agregar igual” y “Dejar afuera”, además del cierre habitual.

#### Fixed
- **Salida de Git explicada**: las advertencias normales de conversión LF → CRLF se separan del motivo real del bloqueo y dejan de mostrarse como un bloque técnico en rojo.
- **Force-add acotado**: aunque Git informe una carpeta ignorada como `.astro`, “Agregar igual” usa `git add --force` únicamente sobre los archivos que el usuario había seleccionado, sin incorporar el resto de la carpeta.
- **Errores desconocidos preservados**: cualquier fallo que no coincida con este caso sigue usando el aviso genérico existente, sin ocultar información útil para diagnóstico.

#### Quality
- Pruebas unitarias para interpretar la salida combinada de `.gitignore` y LF/CRLF.
- Prueba IPC con un repositorio temporal que confirma el rechazo normal y el force-add de una ruta exacta.
- TypeScript, ESLint focalizado y build de producción verificados para la release.

#### Changed
- `package.json` sube a `1.10.9` para preparar los instaladores y el draft release.

---

## [v1.10.8] - 2026-07-19 - Recuperación segura de remotos con historial

### 🟢 Vista Clásica & Core

#### Added
- **Recuperación guiada “Conservar remoto y vincular”**: si el remoto ya tiene historial, GitCron puede adoptarlo sin force-push. Los archivos locales permanecen intactos y, cuando ya había un commit local, se crea antes una rama `gitcron/local-before-link-*` de respaldo.

#### Fixed
- **Remoto existente detectado antes del primer commit**: al inicializar y vincular una carpeta, GitCron consulta primero si GitHub ya tiene `main`. Evita crear y subir un historial paralelo con todos los archivos de una carpeta no vacía.

#### Quality
- Cobertura de regresión para la detección preventiva de `main` remoto, la adopción con reset mixto y las carpetas que todavía no fueron inicializadas.
- TypeScript, suite completa y build de Electron verificados para la release.

#### Changed
- `package.json` sube a `1.10.8` para preparar los instaladores y el draft release.

---

## [v1.10.7] - 2026-07-19 - Apertura segura de raíces Git y errores de creación claros

### 🟢 Vista Clásica & Core

#### Fixed
- **La carpeta elegida debe ser la raíz real del repo**: Abrir existente y los reintentos de creación usan `checkIsRepo('root')`, evitando confundir una subcarpeta con un repositorio Git ubicado más arriba. Esto impide que `git status`, `remote add` o Push actúen accidentalmente sobre el repo padre.
- **“Abriendo…” recuperable**: las validaciones Git del selector tienen un timeout de 15 segundos y devuelven una explicación accionable en lugar de dejar el panel cargando indefinidamente.
- **Push inicial sin `main` explicado**: `src refspec main does not match any` ahora informa que no existe una rama `main` publicable —normalmente porque falta el primer commit— y aclara que GitHub no recibió archivos.
- **Remoto existente detectado antes del primer commit**: al inicializar y vincular una carpeta, GitCron consulta primero si GitHub ya tiene `main`. Evita crear y subir un historial paralelo con todos los archivos de una carpeta no vacía.

#### Added
- **Recuperación guiada “Conservar remoto y vincular”**: si el remoto ya tiene historial, GitCron puede adoptarlo sin force-push. Los archivos locales permanecen intactos y, cuando ya había un commit local, se crea antes una rama `gitcron/local-before-link-*` de respaldo.

#### Quality
- Cobertura de regresión para carpetas anidadas dentro de otro repositorio, errores de source ref inexistente, detección preventiva de `main` remoto y adopción con reset mixto.

#### Changed
- `package.json` sube a `1.10.7` para preparar los instaladores y el draft release.

---

## [v1.10.6] - 2026-07-17 - Rebase visual, parches y loading por repositorio

### 🟢 Vista Clásica & Core

#### Added
- **Aplicar archivos de parche**: la topbar incorpora un selector nativo para archivos `.patch` y `.diff`, ejecuta `git apply` sobre el repositorio activo y refresca inmediatamente el working tree.

#### Fixed
- **Rebase interactivo con ancho útil**: el panel deja de heredar el layout angosto reservado para las vistas laterales, evitando textos y acciones comprimidos.
- **Tipografía coherente en menús contextuales**: sus textos usan unidades relativas y respetan los tres tamaños de fuente configurables.
- **Spinner aislado por repositorio**: las operaciones asíncronas actualizan el estado de carga de la solapa que las inició, incluso si el usuario cambia de repo antes de que terminen.

#### Quality
- Cobertura de IPC para aplicar parches y prueba de regresión para el cambio de solapa durante una operación pendiente.
- TypeScript, build web y build de Electron verificados para la release.

#### Changed
- `package.json` sube a `1.10.6` para preparar los instaladores y el draft release.

---


## [v1.10.5] - 2026-07-16 - Push preventivo con tracking remoto fresco

### 🟢 Vista Clásica & Core

#### Fixed
- **Flechas y decisión de Push actualizadas**: antes de publicar, GitCron ejecuta Fetch sobre el repo activo, refresca `ahead/behind` y abre el aviso existente de fast-forward, rebase o merge cuando hay commits remotos pendientes.
- **Recuperación de `fetch first`**: si el remoto cambia entre el chequeo y el Push, GitCron vuelve a sincronizar el tracking y reemplaza el error crudo por el aviso de integración correspondiente.

#### Quality
- Tests unitarios para decisiones `behind`/`diverged` y detección de rechazos `fetch first`/`non-fast-forward`.

#### Changed
- `package.json` sube a `1.10.5` para preparar el instalador y el draft release de producción.

---

## [v1.10.4] - 2026-07-11 - Working tree en vivo y operaciones remotas resilientes

### 🟢 Vista Clásica & Core

#### Fixed
- **Cambios locales realmente en vivo**: el watcher serializa `watch/unwatch` para que un cambio rápido de solapas no deje al repo activo sin observación. Mientras la ventana está enfocada, un heartbeat de `git status` cada 2 segundos recupera eventos que Windows o los guardados atómicos puedan omitir.
- **Working tree visible al inspeccionar commits**: el panel derecho muestra una sección viva con los archivos locales actuales aunque haya un commit histórico seleccionado, con acceso directo al diff y al área completa de staging.
- **Borrado remoto por upstream real**: “Borrar local y remota” usa el nombre exacto del upstream. Una local `feat/astro-scaffold` que sigue `origin/feat/astro.scaffold` elimina ahora ambas referencias correctas.
- **Confirmación al borrar ramas**: los borrados local, remoto y combinado muestran un toast de éxito con las referencias exactas eliminadas.
- **Confirmación de `reset --hard` legible**: “Borrar TODOS los cambios” deja de aparecer debajo del topbar y usa el mismo viewport inferior que el resto de los avisos, con título, descripción y acciones visibles.
- **Reintento de publicación en GitHub**: si el paso remoto falla después de crear el repo local, un nuevo intento detecta el `.git` existente y continúa desde GitHub sin ejecutar nuevamente `git init`.
- **Push sin destino guiado**: al intentar publicar un repo local que todavía no tiene `origin`, GitCron evita el error crudo de Git y ofrece crear un repo privado en GitHub o vincular una URL existente; luego configura el upstream y ejecuta el primer push.

#### Changed
- **Auto-fetch remoto explícito**: Settings y el tooltip de la barra aclaran que esta función busca commits y ramas en GitHub; no controla la detección de archivos locales.
- **Notificaciones globales consistentes**: éxito, decisiones y errores comparten un contenedor inferior apilable por encima del shell de la aplicación, con roles accesibles y cierre explícito.
- `package.json` sube a `1.10.4` para preparar el instalador y el draft release de producción.

#### Quality
- Tests nuevos para upstreams con nombres distintos y para la carrera `unwatch → rewatch` del mismo repositorio.

---

## [v1.10.3] - 2026-07-07 - Git-core: init local con vinculo a remoto existente

### 🟢 Vista Clásica & Core

#### Added
- **Inicializar y vincular a un remoto existente**: al abrir una carpeta sin Git, el cartel de inicialización ahora ofrece dos caminos: solo `git:init` local o inicializar y conectar un repo de GitHub ya creado por el usuario.
- **Input de remoto validado**: el flujo acepta URLs `https://github.com/owner/repo(.git)` y `git@github.com:owner/repo(.git)`, validando antes de tocar Git para evitar crear un repo local cuando el input ya es inválido.
- **Primer push guiado**: el camino remoto hace `git remote add origin <url>` y `git push --set-upstream origin main`, reutilizando el manejo de credenciales existente del push.

#### Fixed
- **Errores de push accionables**: si GitHub rechaza el primer push por permisos, autenticación o repo inexistente, GitCron muestra un error legible, conserva el repo local inicializado y permite reintentar el vínculo sin recrearlo.

#### Security
- **Sin tokens en URLs**: la autenticación HTTPS de GitHub sigue usando `http.extraheader` desde main process; no se escriben credenciales en `origin`, storage del renderer ni parámetros de URL.

#### Changed
- `package.json` sube a `1.10.3` para preparar el draft release de producción.
- Crear repos nuevos en GitHub vía Octokit queda fuera de esta versión; el flujo actual asume que el repo remoto ya existe.

---

## [v1.10.2] - 2026-07-07 - Hotfix: Cartografía carga el motor en el `.exe` empaquetado

### 🧭 Cartografía

#### Fixed
- **El motor de análisis ya carga en producción**: en el `.exe`, Cartografía mostraba "El motor de análisis no está disponible en esta instalación". Causa raíz: el bundle nativo `@colbymchenry/codegraph-win32-x64` trae sus deps runtime (`web-tree-sitter`, `commander`, `ignore`, `jsonc-parser`, `picomatch`) en un `lib/node_modules` **anidado**, y electron-builder descarta los `node_modules` anidados de un paquete al empaquetar (no existe opción para incluirlos en la 26.x). El intento previo de copiarlos con `extraResources` ponía los archivos en disco pero **fuera del índice del `app.asar`**, así que el `require` de Electron (que consulta ese índice) no los encontraba.

#### Build
- **Deps runtime del motor promovidas a dependencias directas** del app (`web-tree-sitter@0.25.10`, `commander@14.0.3`, `ignore@7.0.5`, `jsonc-parser@3.3.1`, `picomatch@4.0.3`, versiones exactas = las vendorizadas). Así electron-builder las colecta al `node_modules` top-level del `app.asar` (con entrada en el índice), y la resolución de Node desde `codegraph-win32-x64/lib/dist/` sube y las encuentra. `web-tree-sitter` va a `asarUnpack` completo (por su `.wasm` + emscripten).
- Se retira el `extraResources` de `lib/node_modules` (no registraba en el índice del asar) y los patrones `asarUnpack` de `.pnpm/**` (no aplican al layout plano del paquete).
- Verificado extrayendo el `app.asar` final: `require('@colbymchenry/codegraph')` devuelve `CodeGraph` e `isInitialized()` corre sin tirar (o sea, `web-tree-sitter` resuelve y carga).

---

## [v1.10.1] - 2026-07-06 - Hotfix: la app ya no se cae al arrancar sin el motor de CodeGraph

### 🧭 Cartografía

#### Fixed
- **La app abre siempre**: el motor de análisis de Cartografía (`@colbymchenry/codegraph`) se carga ahora de forma diferida. Antes, su import estático corría al arranque del proceso main y, si el módulo nativo (`web-tree-sitter`) no resolvía en el empaquetado, tumbaba toda la aplicación antes de mostrar la ventana.
- **Cartografía degrada con gracia**: si el motor no está disponible en la instalación, Cartografía muestra un aviso ("El motor de análisis no está disponible en esta instalación") en lugar de romper. El cliente Git (Commit, Graph, History, ramas) sigue funcionando con normalidad.
- **Interop del import dinámico**: `@colbymchenry/codegraph` es CommonJS y re-exporta un bundle por plataforma con un `require` dinámico, así que `await import()` deja la clase bajo `.default.CodeGraph` (el cjs-module-lexer no puede detectar el named export). Se resuelve el export tolerando ambas formas (`.CodeGraph` y `.default.CodeGraph`); antes daba `TypeError: Cannot read properties of undefined (reading 'isInitialized')` al abrir Cartografía.

#### Changed
- El motor CodeGraph se carga bajo demanda (la primera vez que se usa Cartografía), cacheado y detrás de un guard con `try-catch`; un fallo de carga se traduce al estado `engine-unavailable` en vez de a un error genérico.
- `package.json` sube a `1.10.1`.

#### Build
- **Empaquetado del motor nativo**: `@colbymchenry/codegraph-win32-x64` se hoistea a dependencia directa y `asarUnpack` suma el layout de pnpm (`.pnpm/**/@colbymchenry`, `web-tree-sitter`, `tree-sitter-wasms`) y los binarios `**/*.wasm` / `**/*.node`, para que el motor pueda resolverse dentro del `.exe`.
- **Deps vendorizadas del bundle win32** (intento incompleto, reemplazado en v1.10.2): se probó copiar el `lib/node_modules` del bundle con `extraResources` hacia `app.asar.unpacked`. No funcionó: `extraResources` deja los archivos en disco pero fuera del índice del `app.asar`, así que el `require` de Electron no los veía. El fix real (deps directas) está en v1.10.2.

> Nota: la app **abre siempre** aunque el motor falte (carga diferida + guard). Que Cartografía **funcione** en el `.exe` se resolvió recién en v1.10.2.

---

## [v1.10.0] - 2026-07-06 - Cartografía: cierre del track de comprensión de repos con IA

### 🧭 Cartografía

#### Added
- **Vista única de comprensión del repo**: Cartografía queda consolidada como un lienzo integrado de tarjetas por rol, archivos clave y relaciones ponderadas, con expansión on-demand para profundizar sin saltar entre superficies separadas.
- **Panorama integrado**: El resumen top-down del repositorio combina estructura determinística, grupos por rol y flechas entre áreas, con narración de IA cacheada por repo, idioma y hash estructural.
- **Grounding CodeGraph + filesystem**: El mapa toma símbolos, relaciones y archivos del repositorio para incluir UI, estilos, lógica, configuración, docs y assets dentro de la lectura estructural.
- **Explicame esto + Preguntar a la IA**: Detalle de nodos con impacto, callers/callees y explicación de IA; Q&A sobre el repo activo con citas de archivos y símbolos consultados.
- **Providers OpenRouter / LM Studio**: Soporte opt-in para IA online o local, reutilizando la key cifrada del Temporal Agent para OpenRouter y manteniendo secretos fuera del renderer.

#### Changed
- Cartografía se documenta como una sola experiencia de producto: mapa por roles, detalle contextual, Q&A y ajustes de IA dentro del mismo workspace.
- `package.json` sube a `1.10.0` para preparar el release, sin taggear ni publicar desde esta fase.

#### Removed
- Código muerto confirmado por Fallow y CodeGraph dentro del área Cartografía: panel textual legado de relaciones, export público innecesario de `disposeGraph` y helper `roleColor` sin consumidores.
- Claves i18n huérfanas ES/EN/ZH asociadas al panel textual legado y placeholders ya no usados.

#### Quality
- Fallow queda sin dead files ni dead exports dentro del área Cartografía; los hallazgos heredados fuera de scope se reportan en `docs/reports/`.
- TypeScript y Vitest se validan como parte del cierre de fase.

---

## [v1.9.1] - 2026-06-17 - Fix: Visual formatting of Pull Success Toast

### 🟢 Vista Clásica & Core

#### Added
- **Toast de éxito de Pull Mejorado**: Nueva maquetación estructurada para el toast de Pull exitoso. Cuando el pull trae cambios, se muestra un encabezado fijo localizado ("Pull exitoso · {n} archivos") con el botón de cerrar cruz (`X`) anclado en la parte superior derecha (nunca flotando en el centro vertical) y una lista de archivos modificados en un contenedor interno con límite de altura y scroll vertical (`max-h-40 overflow-y-auto`), evitando que el toast se estire desproporcionadamente.
- **Pausa de Auto-dismiss al Hover**: En toasts de pull con lista de archivos, el temporizador de auto-dismiss (extendido a 10 segundos para dar tiempo de lectura) se detiene al pasar el puntero del mouse (`hover`) sobre el toast, y se reanuda al quitarlo.

#### Changed
- La lógica de temporizador de auto-dismiss de éxito se trasladó de `app/page.tsx` a `components/PageToasts.tsx` para permitir comportamientos interactivos específicos según el tipo de toast.

#### Quality
- TypeScript compila limpio con `tsc --noEmit`.
- Suite Vitest verde (178 tests pasados, incluyendo unit tests específicos en `remotes-parse.test.ts` para verificar la extracción de archivos modificados a partir de la salida diffstat de Git).

## [v1.9.0] - 2026-06-14 - F6: Dashboard Estadístico (Brier Score) del Temporal Agent

### 🟡 Temporal Agent

#### Added
- **Dashboard Estadístico (Brier Score)**: Nueva sección "Dashboard temporal" en los ajustes de configuración y pestaña "Estadísticas" integrada en el panel HUD Centauro. Muestra:
  - Brier Score del agente (con una escala de color que indica la precisión: verde, cian, naranja).
  - Gráfico interactivo SVG de la **Curva de Calibración** con la línea ideal diagonal y puntos de acierto con tamaño proporcional a la raíz cuadrada de las muestras $n$ del bin.
  - Gráfico interactivo SVG de **Historial de Decisiones** en formato de barras apiladas verticales.
  - Ratio de aceptación según el tipo de sugerencia (Mejora, Hito o Tendencia).
  - Lista comparativa de Brier Score por proveedor y modelo de IA (OpenRouter).
- **Control de Ámbito (Repo vs Unificado)**: Toggle superior en el dashboard para alternar entre el historial del repositorio actual o unificado para todos los repositorios en base a los datos acumulados en SQLite.
- **i18n Trilingüe**: Traducción completa de las claves de visualización y explicaciones del dashboard en Español, Inglés y Chino.

#### Changed
- La consulta de historial `getPredictionHistory` en el proceso Main de Electron ahora admite llamadas sin ruta de repositorio, recurriendo a `getAllRuns()` para recopilar datos de todos los repositorios.

#### Quality
- TypeScript compila limpio con `npx.cmd tsc --noEmit`.
- Suite Vitest verde: **176 tests pasados** (+17 nuevos tests específicos para cálculos estadísticos y agrupamientos de Brier/calibración en `agent-stats.test.ts`).

---

## [v1.8.4] - 2026-06-14 - F5: Remotes, Worktrees y Submódulos

### 🟢 Vista Clásica & Core

#### Added
- **Gestión de Remotos**: Soporte para agregar, renombrar, editar URL y eliminar remotos directamente desde el sidebar. Cuenta con diálogos de confirmación para evitar la remoción accidental de configuraciones.
- **Operaciones de Worktrees**: Soporte interactivo para agregar nuevos worktrees. Al eliminar un worktree, la aplicación valida el estado del directorio de trabajo; si hay cambios sin confirmar, se bloquea la remoción solicitando confirmación de fuerza (`--force`).
- **Ciclo de Vida de Submódulos**: Listado de submódulos, adición de nuevos submódulos desde el sidebar (con URL y ruta relativas), sincronización y actualización recursiva.

#### Changed
- La barra lateral (`RepoSidebar`) muestra permanentemente las secciones de `WORKTREES`, `SUBMODULES` y `REMOTES` si hay un repositorio activo, facilitando el acceso rápido a las nuevas operaciones.
- Los handlers IPC del proceso Main concentran el flujo seguro y el control de llamadas a `simple-git`.

#### Quality
- TypeScript compila limpio con `npx.cmd tsc --noEmit`.
- Suite Vitest verde: **159 tests pasados** (+6 nuevos tests de integración específicos de F5).

---

## [v1.8.3] - 2026-06-14 - F4: Visual Interactive Rebase

### 🟢 Vista Clásica & Core

#### Added
- **Rebase Interactivo Visual**: Nueva interfaz de Rebase Interactivo integrada en la columna central (en lugar de un modal overlay). Permite reordenar commits localmente mediante drag-and-drop (`motion/react`) y editar acciones (`pick`, `reword`, `squash`, `fixup`, `drop`) y mensajes de commit de manera visual.
- **Dropdown de Acción Custom (`RebaseActionDropdown`)**: Reemplazo de los selectores nativos por un menú desplegable premium con estilo oscuro transparente (`glass-overlay`), tildes verdes y colores correspondientes por acción.
- **Soporte de Layout y Redimensionado**: El panel respeta los márgenes y paddings dinámicos de las barras laterales y responde de forma suave al arrastre y redimensionado de las mismas.

#### Changed
- La capa de modales `RepoOverlayLayer.tsx` ahora delega el renderizado al panel principal `RepoMainView.tsx` cuando se detecta un rebase interactivo en curso.
- Se configuró el panel decorativo `LcarsDecorPanel` para ocultarse automáticamente cuando el rebase interactivo está activo, garantizando una visibilidad limpia.

#### Quality
- TypeScript compila limpio con `npx.cmd tsc --noEmit`.
- Suite Vitest verde: **153 tests pasados**.

---

## [v1.8.2] - 2026-06-13 - Staging granular + File History/Blame

### 🟢 Vista Clásica & Core

#### Added
- **Staging por hunk y líneas seleccionadas**: el diff viewer permite preparar, des-preparar y descartar cambios desde bloques o líneas seleccionadas, usando patches aplicados de forma acotada sobre el índice o el working tree.
- **File History por archivo**: el menú contextual de archivos abre un historial read-only basado en `git log --follow -- <file>`, con acceso al diff de cada commit para ese path.
- **Blame por archivo**: el menú contextual suma una vista read-only basada en `git blame --line-porcelain`, agrupando línea, autor, fecha, resumen y hash corto.

#### Changed
- `RepoContentViews.tsx` ahora concentra también las vistas de historial de archivo y blame, además de History/Commit/PR diff/file diff.
- Los handlers IPC de Git agregan operaciones read-only para historial/blame y mantienen validación de paths dentro del repositorio.

#### Quality
- TypeScript compila limpio con `npx.cmd tsc --noEmit`.
- Suite Vitest verde: **18 archivos / 142 tests**.
- Fallow queda en la deuda conocida: 3 issues de dead code (2 exports + 1 type), 8 clone groups, health 261 sobre umbral, MI 90.2.

---

## [v1.8.1] - 2026-06-13 - F1: Cierre de la descomposición de `app/page.tsx`

> Fase de refactor pura, **sin cambios de comportamiento ni de i18n**. Cada tanda cerró con
> `tsc` en 0, **122/122 tests**, Fallow sin regresión (dupes 8, dead-code 4 = baseline) y commit propio.

### 🧱 Modularización (sin cambios de comportamiento)

#### Changed
- **`app/page.tsx`: 2.166 → 1.711 líneas** (−455, −21% en esta fase). Extracciones:
  - **5 modales restantes → `components/RepoActionModals.tsx`**: New Branch, Create Tag, Merge-needs-checkout, Rename Branch y Force Push. Comparten un `ModalShell` interno (backdrop + panel glass + click-outside) para no introducir duplicación nueva.
  - **Panel decorativo LCAR → `components/PageWidgets.tsx`** (`LcarsDecorPanel`), pixel-idéntico.
  - **Lógica del repo chooser → `hooks/use-repo-chooser.ts`** (abrir existente / crear —opcionalmente en GitHub— / clonar, incluyendo el flujo de confirmación de force-push). El hook recibe las funciones del loader por props para no duplicar el watcher de filesystem.
  - **Vistas de diff → `components/RepoContentViews.tsx`** (`PullRequestDiffView` y `FileDiffView`), junto a las ya existentes History/Commit.
- Los handlers que tocan Git permanecen en `page.tsx` y se pasan por props a los componentes/hook extraídos; las claves i18n no cambiaron.

#### Removed
- 2 `useState` muertos en `page.tsx` (`amendCurrentMessage`, `showStashClearConfirm` — este último sigue vivo y en uso en `RepoSidebar.tsx`).
- Bloque grande de imports `lucide-react` sin uso en `page.tsx` (orfanados por las extracciones de esta fase y de fases previas) + imports de `DiffViewer`/`ConflictResolver` ya no usados directamente desde la página.

#### Notes
- La meta de `page.tsx < 1.400 LOC` quedó **pendiente**: el resto vive en el view-switcher central (graph tab clásico + cronométrico), cuya extracción toca área visualmente sensible del grafo y se difiere a una fase futura con validación visual. Reporte completo en [docs/reports/F1_REPORT.md](/docs/reports/F1_REPORT.md).

---

## [v1.8.0] - 2026-06-12 - Modularización Integral + Hardening de Seguridad

### 🛡️ Seguridad (Electron)

#### Added
- **Guard de navegación**: la ventana queda fijada a su origen (`localhost` en dev, `app://` en prod); todo link http(s) externo se abre en el navegador del SO vía `shell.openExternal` y los popups arbitrarios se bloquean (`setWindowOpenHandler` + `will-navigate`/`will-redirect`).
- **Contención de paths en el protocolo `app://`**: el handler valida que el archivo resuelto quede dentro de `out/` (bloquea traversal con `../`) y usa `pathToFileURL` para rutas Windows correctas.
- **Hardening de handlers shell**: `shell:show-in-folder` y `shell:open-item` validan contención dentro del repo; `shell:open-path` enruta URLs https por `openExternal` y solo acepta directorios existentes (ya no puede lanzar ejecutables arbitrarios).

### 🧱 Modularización (sin cambios de comportamiento)

#### Changed
- **`electron/main.ts`: 2.542 → 285 líneas**. Los ~55 handlers IPC ahora viven en `electron/ipc/` por dominio: `git-ops`, `git-sync`, `git-repo`, `github`, `ai`, `shell`, `storage`, `watchers`, `app-window`, con helpers compartidos en `shared.ts`.
- **`hooks/use-git-actions.ts`: 1.272 → 33 líneas**. Ahora es una fachada que compone 6 sub-hooks por dominio en `hooks/git-actions/` (working-tree, branches, history, remote, github-auth, preferences). API pública intacta.
- **`app/page.tsx`: 3.984 → ~2.430 líneas**. Extraídos: `usePanelLayout` (layout/resize persistido), `useAppUpdate` (flujo de updates), `UpdateControls`, `GraphSearchControl`, `BranchFilterDropdown`, `RepoSidebar`, `RepoDetailsPanel`, `PageToasts`, `PageWidgets` y helpers puros en `lib/page-helpers.ts`.

#### Fixed
- **`use-shortcuts`**: el ref de handlers se actualiza en un `useEffect` (antes se escribía durante el render, incompatible con concurrent rendering de React 19).

### 🧹 Limpieza

#### Removed
- 10 exports muertos detectados por Fallow (`runPrediction`, `openingTurnFromBranch`, constantes SQL internas, etc.); Fallow queda en 0 issues con `node:sqlite` y el barrel de `ProviderId` documentados en `.fallowrc.json`.


### 🔵 Vista Cronométrica

#### Changed
- **Viewport estable al crear commits**: La vista cronométrica deja de recentrar el canvas cuando solo cambia el tamaño del mundo por un commit nuevo; el reset visual se mantiene al cambiar de repositorio.

#### Added
- **Entrada animada de commits nuevos**: Los hashes recién incorporados entran con fade y el conector principal se dibuja progresivamente desde el commit padre, respetando `prefers-reduced-motion`.

---

## [v1.7.0] - 2026-06-03 - Optimización Estructural: Componentización de Paneles, Modales y Correcciones de Visibilidad

### 🔵 Vista Cronométrica — Temporal Agent

#### Changed
- **Brief copiable en Materializar Futuro**: El preview de materialización separa la metadata fija (`branch`, `tag`, nivel de vuelo, tipo, confianza y commit) del bloque copiable para agentes. El `IDEA.md` creado en la rama real conserva el contenido completo, pero el botón de copiar ahora toma solo el brief de ejecución.

### 🟢 Vista Clásica & Core

#### Refactored
- **Extracción de Ajustes (SettingsPanel)**: Movimos todas las secciones de configuración (idioma, tema, tamaño de fuente, carpeta predeterminada, vista cronométrica, auto-fetch, notificaciones del sistema, atajos de teclado, seguridad, actualizaciones, temporal agent y acerca de) a un componente separado en [SettingsPanel.tsx](file:///c:/www/gitCronos/components/SettingsPanel.tsx). Esto limpia también las funciones auxiliares de renderizado del tope del archivo.
- **Extracción de Ayuda (HelpPanel)**: Mapeamos la documentación y los tutoriales de flujo Git a [HelpPanel.tsx](file:///c:/www/gitCronos/components/HelpPanel.tsx).
- **Extracción de Perfil de GitHub (ProfilePanel)**: Centralizamos los flujos de inicio de sesión mediante OAuth (código de dispositivo) y Token Personal de GitHub a [ProfilePanel.tsx](file:///c:/www/gitCronos/components/ProfilePanel.tsx).
- **Extracción de Modales de Acción (RepoActionModals)**: Modulamos los modales de Checkout Conflict, Reset All Confirmation, Clean Untracked, Amend Last Commit y Squash Commits en [RepoActionModals.tsx](file:///c:/www/gitCronos/components/RepoActionModals.tsx).
- **Reducción de Complejidad de `app/page.tsx`**: El archivo monolito principal bajó de **4883 LOC** a **3926 LOC** (un ahorro neto acumulado de **957 líneas de código**), bajando la complejidad cognitiva del componente principal a **398**.

#### Fixed
- **Chip de Futuros en Vista Clásica**: Corregimos el bug por el cual el tag cyan `"N futuros →"` se seguía mostrando en la cabecera del grafo clásico aun cuando el usuario desactivaba la línea de tiempo cronométrica desde la configuración de preferencias.

#### Quality
- **Type Safety intacta**: TypeScript compila de forma perfectamente limpia con `npx.cmd tsc --noEmit`.
- **Suite de Pruebas**: Confirmamos que las 80 pruebas unitarias en 9 archivos pasan con éxito total.
- **Mantenibilidad Global**: Fallow confirma que el maintainability index general del proyecto se mantiene excelente en `90.9 (good)`.

## [v1.6.8] - 2026-06-02 - Optimización, Componentización y Handoff de Mantenibilidad

### 🟢 Vista Clásica & Core

#### Refactored
- **Componentización de `app/page.tsx` sin pérdida funcional**: Extrajimos piezas de UI vivas hacia componentes dedicados para reducir el tamaño de la página principal sin tocar los flujos de idioma, predicción de futuros, grafo clásico/cronométrico, stash avanzado, limpieza de untracked ni resolución de conflictos.
- **Tab bar modular**: Las pestañas multi-repo con drag-to-reorder viven ahora en `components/RepoTabs.tsx`, conservando `motion/react`, mitigación de clicks durante drag y controles de ventana Electron.
- **Sidebar modular**: La navegación lateral de ramas locales/remotas, agrupadores, stashes, tags y submódulos se concentró en `components/RepoSidebarParts.tsx`, manteniendo colores de rama, ahead/behind, checkout remoto, acciones hover y descarte de branches `imagined/*`.
- **Confirmaciones destructivas reutilizables**: Los diálogos de eliminar branch/futuro materializado, eliminar tag y descartar archivo usan `components/DangerConfirmDialog.tsx`, reduciendo JSX repetido y manteniendo los callbacks async originales.
- **Vistas internas separadas**: `HistoryView` y `CommitTabView` viven en `components/RepoContentViews.tsx`, con `lib/display-format.ts` como helper común de fechas e iniciales.
- **Parsing de proveedores de IA centralizado**: `electron/ai/provider-parsing.ts` concentra normalización, extracción de JSON tolerante y shape mapping para Claude/OpenRouter, evitando duplicación entre adapters.
- **Loader de repos más selectivo**: `hooks/use-repo-loader.ts` usa selectores más granulares de Zustand y helpers de refresh/persistencia, reduciendo renders derivados de suscripciones amplias.
- **Helpers del flujo Crear Repo/GitHub**: `app/page.tsx` ahora nombra explícitamente la construcción de path, detección de push rechazado y recuperación de clone URL ante repos GitHub existentes, bajando la complejidad del handler de creación.

#### Quality
- **Validación estática y tests verdes**: `npx.cmd tsc --noEmit` y `pnpm test` pasaron después de la tanda de refactors. La suite reportó 9 archivos de test y 80 tests OK.
- **Fallow actualizado**: No hay dead files ni dead exports. La mantenibilidad global queda en `90.9 (good)`. La duplicación baja de `4.5%` a `4.3%`, aunque Fallow todavía falla por deuda de duplicación y complejidad conocida.
- **`app/page.tsx` reducido**: El cuerpo principal bajó de aproximadamente 5.4k LOC a 4.8k LOC durante esta optimización, pero sigue siendo el objetivo principal para próximas extracciones.

#### Remaining
- **Pendientes principales de saneamiento**: Fallow sigue marcando `app/page.tsx`, `hooks/use-git-actions.ts`, `hooks/use-repo-loader.ts`, `components/ChronometricGraph.tsx`, `components/StagingPanel.tsx` y tests diagnósticos de grafo como próximos objetivos.
- **Duplicación aún presente**: Persisten clone groups entre `CommitGraph.tsx`/tests diagnósticos, `ChronometricGraph.tsx`/tests diagnósticos, algunas ramas de error en `electron/main.ts` y operaciones parecidas en `use-git-actions.ts`.

---

## [v1.6.7] - 2026-06-02 - Auditoría General de Operaciones Git

### 🟢 Vista Clásica & Core

#### Added
- **Auditoría Exhaustiva de Operaciones Git**: Completamos un inventario profundo del código vivo de la aplicación (v1.6.5/v1.6.6) para mapear el estado real de las funcionalidades básicas de Git.
- **Plan de Backlog**: Registramos en la documentación el listado completo de operaciones Git faltantes o parcialmente implementadas para priorizar futuros desarrollos sin duplicados.
- **Clean untracked en bloque**: El panel de staging ahora muestra `Limpiar...` cuando hay archivos sin trackear. La acción abre un modal con checklist basado en un dry-run fresco de `git clean -n -d`, permite seleccionar archivos individuales y borra únicamente los paths elegidos después de una advertencia explícita de eliminación física del disco.
- **Stash avanzado**: El botón Stash ahora abre un modal para nombrar opcionalmente el stash. Cada stash en la barra lateral suma acciones hover para previsualizar archivos/diff, aplicar sin remover, hacer `pop` aplicando y removiendo, o eliminarlo.
- **Editor interactivo de conflictos**: Los archivos con conflictos ahora muestran un resolver por bloques dentro del Diff Viewer. Cada hunk permite elegir Local, Entrante, combinar ambos órdenes o editar el resultado final; al guardar, GitCron escribe el archivo resuelto, valida que no queden marcadores y lo stagea automáticamente.

---

## [v1.6.6] - 2026-05-31 - Temporal Agent — Predicción de Ramas Futuras con IA

### 🔵 Vista Cronométrica — Temporal Agent (Beta)

#### Added
- **Temporal Agent funcional end-to-end**: La feature de predicción de ramas especulativas ahora funciona completamente. El agente envía contexto del repositorio a OpenRouter, recibe predicciones de la IA y las dibuja como ramas punteadas semitransparentes sobre la diagonal cronométrica.
- **Dropdown de modelos de IA**: Selector de modelo en Settings → Temporal Agent con 7 modelos verificados de OpenRouter — Gemini 3 Flash, Gemini 3.5 Flash, DeepSeek V4 Pro, MiMo V2.5 Pro, MiniMax M2.7, Claude Sonnet 4.5 y GPT-5.5, más opción "Custom" para modelos no listados. Cada modelo muestra su precio por millón de tokens.
- **Fingerprint de API key (SHA-256)**: La validación de API key ahora usa un hash criptográfico irreversible en lugar de enviar caracteres reales al renderer. El usuario ve una huella de 8 hex que permite identificar cuál key está cargada sin exponer el secreto.
- **Feedback de guardado en Settings**: Toast "Guardado ✓" (se auto-oculta a los 3s) y resumen persistente de la configuración activa (modelo, scope, threshold, frequency, focus areas) debajo del botón Save.
- **Auto-prender FUTUROS tras predicción**: Al disparar "Predecir futuros", el toggle FUTUROS se activa automáticamente si la IA devuelve ramas. No hay que ir al grafo a prenderlo manualmente.
- **Chip "N futuros →" en vista clásica**: Cuando hay predicciones disponibles, la cabecera del grafo clásico muestra un chip cyan que al clickear cambia a vista cronométrica y prende FUTUROS automáticamente.
- **Labels especulativas legibles**: Los textos de las ramas futuras ahora usan word-wrap multilínea (sin truncamiento con puntos suspensivos). Mayor espaciado entre ramas (`reach: 320`, `fanFactor: 60`) para evitar amontonamiento.
- **Parser de IA tolerante**: `parseBranches()` ahora extrae JSON de respuestas con markdown, texto adicional o formato impreciso. Loguea ramas válidas y descartadas para diagnóstico.

#### Changed
- **Panel CENTAURO sin competencia**: Se eliminó la card `CHRONO_DEPTH` (radar verde con conteo de nodos y rango de fechas) del HUD inferior. El panel CENTAURO ahora ocupa ese espacio sin competir visualmente con los detalles de commit del panel derecho.
- **Prompt de IA más explícito**: El system prompt ahora incluye el schema JSON exacto esperado (`id`, `message`, `rationale`, `type`, `confidence`) y pide rationales de máximo 100 caracteres para evitar truncamiento.
- **`max_tokens` ampliado**: De 1024 a 2048 tokens. El modelo anteriormente truncaba el JSON a mitad de una string.

#### Fixed
- **Error handling en Settings**: El botón Save ahora tiene try/catch y muestra mensajes de error visibles en naranja si falla la persistencia.
- **Toggle FUTUROS corregido**: Se revirtió un cambio que movía `showSpeculative` al store de Zustand, lo cual impedía que el toggle funcionara al cambiar de vista. Ahora usa `useState` local que sobrevive correctamente entre Settings y Graph.
- **Puerto 3001 EADDRINUSE**: El servidor Next.js en dev ahora usa puerto 3001. Si queda un proceso zombie, matarlo con `netstat -ano | findstr :3001` + `taskkill /PID <pid> /F`.

---

## [v1.6.5] - 2026-05-26 - Changelog Integrado en Buscar Actualizaciones

### 🟢 Vista Clásica & Core

#### Added
- **Cambios Recientes dentro de Buscar Actualizaciones**: La pantalla de Configuración → Buscar actualizaciones ahora muestra una sección de **Cambios recientes** alimentada desde el `CHANGELOG.md` local. La última versión queda expandida por defecto y las versiones anteriores se muestran como historial colapsable para una lectura rápida, contextual y sin salir de GitCron.
- **Parser de Changelog para UI de Usuario**: Se incorporó un parser liviano que transforma el Markdown del changelog en tarjetas legibles, agrupando cambios por versión, fecha, área y tipo de cambio (`Novedades`, `Correcciones`, `Mejoras internas`, etc.) en lugar de mostrar el archivo crudo.
- **Bridge IPC para Changelog Local**: Electron expone `app:get-changelog` mediante preload seguro (`window.api.getChangelog()`), leyendo el changelog desde el workspace en desarrollo y desde recursos empaquetados en producción.

#### Changed
- **GitHub Releases como Acción Secundaria**: La experiencia principal para entender qué cambió queda dentro de la app, mientras que GitHub Releases se mantiene como enlace complementario de historial completo para usuarios técnicos.
- **Empaquetado del Changelog**: `CHANGELOG.md` se incluye en `extraResources` para que la vista de Cambios recientes funcione también en builds instalados, sin depender de red ni de GitHub.
- **Flujo de Inicio de Repositorios Integrado**: Las acciones **Abrir existente**, **Crear nuevo** y **Clonar de GitHub** reemplazan el chooser central y los modales flotantes por una navegación real desde el sidebar izquierdo, usando la misma arquitectura visual que Configuración, Ayuda y Perfil.
- **Panel Central de Repositorios**: Los formularios de creación, apertura y clonado ahora se muestran en un cuerpo central acotado, con card glass, fondo de sección consistente y contenido preparado para lectura y operación sin estirarse a todo el ancho.

#### Fixed
- **Aislamiento Visual de Repositorios**: Al entrar en Abrir / Crear / Clonar se ocultan el TCAR/LCAR y el selector Clásico/Cronométrico para evitar superposiciones y mantener el mismo fondo limpio de las vistas de Perfil, Ayuda y Configuración.
- **Transición de Regreso al Graph**: Se corrigió la animación de resize/slide al volver al repositorio desde las vistas de repositorios, incluyendo el botón **Volver al Repositorio** y la flecha del sidebar izquierdo. El cambio ahora se comporta como el resto de paneles integrados, con salida sin deformar el contenido.

---

## [v1.6.4] - 2026-05-26 - Máscara Curva Bézier de Precisión en Grafo Cronométrico y Reordenamiento Dinámico de Pestañas

### 🟢 Vista Clásica & Core

#### Added
- **Reordenamiento de Pestañas por Arrastre (Drag-to-Reorder Repo Tabs)**: Integración de la API `<Reorder.Group>` y `<Reorder.Item>` de `motion/react` sobre las pestañas de repositorios abiertos en la barra superior. Los usuarios ahora pueden ordenar visualmente sus pestañas arrastrándolas horizontalmente, con mitigación de clics falsos mediante referencias de estado durante el arrastre (`isDraggingRef`), previniendo autoselecciones indeseadas al reordenar pestañas.
- **Paneles Laterales Integrados para Configuración, Ayuda y Usuario**: Reemplazo completo de los antiguos modales flotantes por paneles semánticos integrados en el layout principal. Los contenidos se adaptan fluidamente a la anchura del contenedor (`w-full` y `max-w-2xl` para el perfil de usuario), eliminando límites heredados del contenedor modal.
- **Transición Suave de Desvanecimiento Puro (Fade-Only)**: Eliminación definitiva de las distorsiones de escalado bruscas por defecto. Implementación de transiciones puras basadas en opacidad para una experiencia visual de alta gama al abrir/cerrar paneles de Ajustes, Ayuda o Perfil de usuario.
- **Guardia de Hidratación de Josh W. Comeau**: Implementación de una barrera de renderizado síncrono en el cliente para erradicar discrepancias de hidratación SSR, introduciendo una pantalla de carga y esqueleto premium durante la sincronización inicial.

### 🔵 Vista Cronométrica (Beta)

#### Added
- **Máscara en Curva Bézier de Precisión (Solid Curved Bézier Backing Mask)**: Rediseño completo del sólido de ocultación derecho usando curvas Bézier cúbicas (`C`) en lugar de segmentos poligonales rígidos. Logramos una silueta perfectamente fluida, orgánica y circular que calza de manera idéntica al milímetro con el barrido del arco del SVG LCARS decorativo de la consola.
- **Enmascarado con Degradado sobre el Canvas del Grafo (Linear Gradient Canvas Masking)**: Implementación de un `mask-image` / `-webkit-mask-image` de CSS directamente sobre el `<svg>` del lienzo del grafo cronométrico (`components/ChronometricGraph.tsx`). Las líneas y commits ahora se desvanecen suavemente a transparente (`opacity: 0`) entre los `370px` y `220px` antes del borde derecho, ocultándolos por completo antes de aproximarse al panel.
- **Bordes y Esquinas Ultra-Nítidos (Cero Neblinas de Borde)**: Eliminamos los filtros de desenfoque y capas de corte del fondo decorativo que desbordaban la pantalla superior, inferior y lateral. La máscara curvo-vectorial ahora es 100% sólida y perfectamente nítida, permitiendo que el grafo se funde de forma invisible antes de tocar la consola.

#### Fixed
- **Visualización Condicional por Contexto (Context-Aware Layout Mounting)**: Restringimos la visualización del panel decorativo e interactivo LCARS y su máscara de ocultación para que solo se rendericen en el DOM si el usuario está activamente en la solapa de **`Graph`** (`activeTab === 'Graph'`) y no hay ningún visualizador de Diff de archivos (`selectedFile`) o Pull Request abierto. Esto soluciona la superposición visual en las vistas de **Commit**, **History** y lectura de diferencias de código.
- **Comportamiento Cohesivo del TCAR y Sidebar**: Ocultamiento dinámico inteligente de la barra lateral técnica derecha (TCAR) y el switch clásico/cronométrico al navegar hacia los paneles de Configuración, Ayuda o Ajustes de Usuario. Ahora la interfaz se comporta de manera simétrica en todas las vistas de administración y configuración global.

---

## [v1.6.3] - 2026-05-25 - Tooltips Flotantes Premium, Control de Word-Wrap en Diff y Transición Suave de Layout

### 🟢 Vista Clásica & Core

#### Added
- **Word-Wrap Toggle en Diff Viewer**: Incorporación de un botón interactivo premium en la cabecera del visor de diferencias (a la izquierda de la etiqueta 'MODIFIED') que permite alternar instantáneamente entre modo de ajuste de línea ("wrap text") y modo continuo ("align left"). Incluye iconos interactivos customizados (`<WrapText>` y `<AlignLeft>`).
- **Atajo de Teclado Global `Alt+Z`**: Implementación de una escucha global de teclado (`Alt+Z` o `Option+Z`) para alternar rápidamente el modo de ajuste de línea en el visor de diferencias actual, emulando la experiencia del editor de Visual Studio Code.

#### Fixed
- **Fondo de Líneas Completas en Diff Viewer**: Corrección de la anchura del fondo destacado de las líneas agregadas (verde) y eliminadas (rojo) en `components/DiffViewer.tsx`. El color de fondo ahora se expande horizontalmente a lo largo de toda la extensión del texto con scroll horizontal, eliminando el corte abrupto del color al desplazarse a la derecha.
- **Transición Suave de Layout en Cambio de Vistas**: Implementación de la técnica de diseño de Josh W. Comeau para evitar distorsiones visuales ("squishing" / encogimiento) en el lienzo del grafo y en el visor de diferencias. Extendimos el bypass de transición temporal (`isTabChanging`) activándolo de forma síncrona e instantánea directamente en los controladores de eventos principales: cambio de solapas (`handleTabChange`), selección de archivos/diffs (`handleSelectFile` y el click en la lista de archivos de un commit), selección de Pull Requests (`handleSelectPullRequest`) y cierre del diff (`handleCloseDiff`). Esto asegura de manera absoluta que al alternar vistas, el tamaño del contenedor principal `<main>` cambie síncronamente en 0ms y el contenido se revele con una animación fluida de opacidad sin deformaciones.
- **Animación de Fundido (Fade-In) en Visor de Diferencias**: Envolvimos las secciones del panel de detalles de Pull Request (`selectedPullRequest`) y visor de diferencias de archivos (`selectedFile`) en elementos `<motion.div>` con claves e inicializadores de Framer Motion. Esto elimina la aparición instantánea o la distorsión física por defecto, logrando que el diff del archivo se hidrate con un fundido de opacidad impecable y fluido.

### 🔵 Vista Cronométrica (Beta)

#### Added
- **Tooltips Flotantes de Altísima Fidelidad con React Portal**: Rediseñamos los tooltips de información interactiva en `components/ChronometricGraph.tsx` para proyectarse en la raíz del documento (`document.body`) mediante `createPortal`. Esto garantiza de forma absoluta que los tooltips floten sobre cualquier barra lateral o elemento z-index, eliminando superposiciones o recortes visuales.
- **Líneas Conectoras de Curva Bezier Cúbica en Amarillo**: Implementación de elegantes curvas Bezier interactivas en color amarillo vibrante (`git-mod` de `DESIGN.MD`) que conectan dinámicamente el nodo enfocado con su tooltip flotante correspondiente.
- **Efecto Radial Breath en Nodo Seleccionado**: Se añadió un aro circular concéntrico más grande con un `radialGradient` animado que realiza una transición de respiración ("breathing effect") suave al seleccionar un nodo en la línea de tiempo.

---

## [v1.6.2] - 2026-05-25 - Saneamiento Estático de Fallow y Simplificación Visual Cronométrica

### 🟢 Vista Clásica & Core

#### Refactored
- **Modularización de Preferencias (Análisis de Fallow)**: Extrajimos la hidratación individual de preferencias desde storageGet en `use-git-actions.ts` hacia helpers puros e independientes a nivel de módulo (`bootstrapLanguage`, `bootstrapFontSize`, `bootstrapDefaultFolder`, `bootstrapAutoFetch`, `bootstrapOsNotifications`, `bootstrapShortcuts`, `bootstrapTheme`, `bootstrapCronometric`), simplificando `bootstrapPreferences` de forma drástica y reduciendo su complejidad cognitiva en un 90%.
- **Optimización Algorítmica del Grafo (`computeGraph`)**: Extrajimos la lógica matemática de asignación de carriles (`getOrCreateLaneForCommit`) y propagación de conexiones de commits padres (`calculateConnections`) en `components/CommitGraph.tsx` hacia funciones puras externas a nivel de módulo, reduciendo su complejidad cognitiva de `30` a menos de `8` y removiendo este componente de la lista de hotspots críticos de Fallow.
- **Remoción de Exportaciones Muertas**: Saneamos quirúrgicamente interfaces y constantes de `CommitGraph.tsx` sin uso externo para limpiar el árbol de dependencias públicas.
- **Maintainability Score de 90.0%**: La suite completa de saneamiento e incremento de calidad de código elevó el índice de mantenibilidad global de GitCron al **90.0% ("Good")**.

### 🔵 Vista Cronométrica (Beta)

#### Added
- **Simplificación Visual y Declutter del HUD**: Removimos elementos estéticos decorativos invasivos del lienzo cronométrico para una visualización inmersiva ultra-limpia y moderna:
  * Eliminamos la red de radar de círculos punteados concéntricos de fondo sobre toda la vista.
  * Eliminamos las guías y marcos angulares sólidos de color neón en las 4 esquinas perimetrales de la pantalla, logrando una sensación minimalista y espaciosa de "Full Bleed" que prioriza el árbol de commits.

---

## [v1.6.1] - 2026-05-25 - Preservación de Layout Flotante y Corrección de Vista por Defecto

### 🔵 Vista Cronométrica (Beta)

#### Fixed
- **Preservación del Layout Flotante Unificado**: Rediseñamos `graphMode` en `app/page.tsx` para ser estrictamente `'chronometric'` en todo momento. Esto asegura que la envoltura premium glassmorphic de la aplicación (RepoTabs, Header y Sidebars izquierdo/derecho flotantes) permanezca activa de forma permanente, independientemente del estado del Feature Flag en Ajustes. Se eliminó la regresión visual al antiguo layout plano e inline.
- **Comportamiento por Defecto en Nuevos Proyectos**: Implementamos la variable reactiva `activeGraphMode = enableCronometric ? rawGraphMode : 'classic'` y la utilizamos para renderizar condicionalmente el `<CommitGraph>` clásico o el `<ChronometricGraph>` diagonal. Esto soluciona un problema por el cual proyectos recién abiertos o sin preferencia guardada (como `odontoPau`) arrancaban de forma predeterminada en la vista cronométrica al tener la bandera experimental activada en Ajustes, respetando ahora la vista clásica vertical por defecto.
- **Chequeo de Tipos TypeScript**: Envolvimos la definición de `graphMode` en un helper de función `getGraphMode()` para evitar que el motor de inferencia de control de flujo de TypeScript estreche el tipo a un único literal `'chronometric'`, resolviendo un error de compilación estática al compararlo con `'classic'`.

---

## [v1.6.0] - 2026-05-25 - Vista Cronométrica Avanzada: Nodo HEAD Agrandado, HUD de Alta Fidelidad y Animación Temporal

### 🔵 Vista Cronométrica (Beta)

#### Added
- **Nodo HEAD Agrandado al Doble**: Rediseñamos el nodo HEAD activo en la línea de tiempo cronométrica para otorgar una presencia imponente en el lienzo:
  * El círculo core del commit ahora posee un radio de `21` (diámetro de `42px`) y su grosor de borde se incrementó a `4` (o `6` cuando está seleccionado).
  * Las iniciales de autoría del comitente dentro del círculo se escalaron proporcionalmente de un tamaño de fuente de `fs(7.5)` a `fs(15)` para una legibilidad superior.
  * Las guías concéntricas de hover y selección se incrementaron a radios de `28` y `30` respectivamente.
- **Retículo Star Trek LCARS Táctico Estático**: Reemplazamos el indicador concéntrico por defecto con la intrincada e increíblemente detallada geometría del SVG LCARS personalizado (`lcar-29-main-branch.svg`):
  * Centrado quirúrgicamente en las coordenadas de HEAD y escalado a `scale(0.18)` para enmarcar con holgura al nuevo nodo gigante.
  * Se removió por completo la animación de rotación (`animation: 'spin 28s...'`) haciéndolo estable y estático para lograr una estética de radar militar de alta precisión de ciencia ficción.
- **HUD de Telemetría con Mayor Aire**: Ampliamos la visualización de metadatos del HUD de telemetría de HEAD:
  * Incrementamos la separación vertical entre líneas de texto de `12` a `16` para darles un aspecto mucho más espacioso y premium.
  * Elevamos la separación física (`baseClearance`) de la primera línea respecto al centro de `52` a `78`, extendiendo dinámicamente la línea de conexión HUD punteada.
- **Evasión Dinámica de Fechas y Ticks (`isNearHead`)**: Añadimos un desvío inteligente en el canvas para evitar solapamientos de texto con el retículo:
  * Las etiquetas técnicas extremas del canvas (`[CHRONO_START // T_MIN]` y `[CHRONO_END // T_MAX]`) se separaron a `95px` de distancia de las puntas de la diagonal.
  * Implementamos un cálculo que evalúa si la marca cronológica (ej. `T+005`, `24 may`) está a menos de `80px` de HEAD; si es así, la desplaza automáticamente `95px` hacia abajo y estira su dotted guía de conexión a `90px`.
- **Animación del Flujo Cronológico en las Conexiones**: Diseñamos una corriente de datos luminosa que recorre la línea de tiempo principal:
  * Declaramos una animación keyframe `@keyframes chrono-flow` que modula la opacidad (entre `0.18` y `0.9`) y desplaza el `stroke-dashoffset` en un loop continuo de 3 segundos.
  * Dividimos los conectores del grafo en una base sólida y una sobrecapa punteada (`strokeDasharray="4 6"` y `"3 3"` para fusiones) que transporta el flujo de luz.
  * Revertimos el trazado del overlay punteado de padre (`px, py`) a hijo (`cx, cy`) para forzar a los impulsos de luz a fluir visualmente de forma cronológica (del pasado al presente).
  * Aplicamos un retardo dinámico de inicio (`animationDelay`) calculado con el residuo del índice del commit (`${(node.chronologicalIndex * 0.4) % 3}s`) para crear una onda staggered que viaja tramo a tramo.

#### Fixed
- **Área Interactiva y Hit-Testing de HEAD**: Solucionamos un bloqueo de clics e interacciones sobre el nodo HEAD:
  * Añadimos la clase `pointer-events-none` al contenedor del retículo LCARS para que los clics pasen a través del overlay.
  * Cambiamos el relleno y el trazo del círculo core de HEAD de `'none'` a `'transparent'`, logrando que el círculo sea 100% invisible para apreciar el fondo y las iniciales libres, pero manteniendo activa su superficie física interactiva para el hit-testing. Esto habilita perfectamente la manito de selección (`cursor-pointer`) y la apertura del panel de detalles al hacer clic.

---

## [v1.5.0] - 2026-05-24 - Unificación en Rama Única con Feature Flags & Aislamiento Estético

### 🟢 Vista Clásica & Core

#### Added
- **Unificación Segura bajo Feature Flags (Trunk-Based Development)**: Integración completa de la vista clásica estable y el nuevo motor cronométrico interactivo en un único flujo de trabajo unificado (`16-FlagToggle`), eliminando la necesidad de mantener ramas paralelas propensas a desajustes de versiones y conflictos de código:
  * **Feature Flag Core (`enableCronometric`)**: Variable global en el store Zustand persistida de forma encriptada en el llavero de Electron (`safeStorage` con la clave `'enableCronometric'`), apagada por defecto (`false`) para resguardar con total garantía la estabilidad de la vista clásica en producción.
  * **Toggles de Activación**: Añadido un interruptor ilustrado en el modal de Ajustes / Settings para que los desarrolladores activen dinámicamente la vista cronométrica en sus entornos locales.
  * **Ocultamiento Inteligente de UI**: El segmented switch del topbar se oculta y la app fuerza síncronamente el modo clásico si el feature flag está apagado.
  * **Integración del Lienzo Cronométrico**: Importados de forma segura `components/ChronometricGraph.tsx`, proyecciones visuales espaciales, hooks y tests unitarios.

#### Docs
- **Guía de Flujo de Trabajo en Rama Única (Single-Branch Workflow)**:
  * *Cómo desarrollar*: Todo nuevo componente o funcionalidad experimental debe desarrollarse directamente en la rama principal, pero protegido detrás de una Feature Flag condicional: `{showFeature && <NewFeature />}`.
  * *Cómo probar*: En desarrollo local, activa el toggle respectivo. En producción, permanece apagado por defecto hasta que esté 100% probado y listo para liberarse.
- **Lineamientos de Aislamiento Estético (Evitar Conflictos de Estilos)**:
  * **Uso de Namespaces en `globals.css`**: Todos los tokens de diseño de Tailwind v4 en [globals.css](file:///c:/www/gitcron/app/globals.css) se dividen y etiquetan en namespaces explícitos (`Shared / Global`, `Classic Specific`, `Cronometric Specific`). Cualquier cambio en estilos o colores de la vista cronométrica debe usar el prefijo `--crono-` o `--cronometric-`.
  * **Layouts Aislados**: Estructurar los insets flotantes y manejadores de layouts dentro de condicionales limpios o shells aislados en `app/page.tsx` para evitar colisiones de márgenes y paddings.
  * **Detección y Limpieza de Código Muerto**: Al compilar para producción (`npm run build`), Tailwind v4 analiza las dependencias activas del árbol JSX. Si una vista se desactiva o elimina, el compilador remueve automáticamente del CSS final cualquier clase que ya no se utilice.

---

## [v1.4.1] - 2026-05-24 - Support for Selective Text Selection

### 🟢 Vista Clásica & Core

#### Added
- **Soporte de Selección y Copia de Texto Quirúrgico**: Habilitación selectiva de la propiedad `select-text` (`user-select: text` de Tailwind) exclusivamente en elementos que renderizan textos legibles y metadatos clave para permitir su copia nativa al portapapeles sin sacrificar la sensación de aplicación de escritorio:
  * **Barra Lateral Izquierda**: Nombres de ramas locales y remotas (incluyendo carpetas de agrupación recursivas), tags, submódulos y mensajes de stashes (`StashItem`).
  * **Panel de Detalles de Commit (Derecha)**: Hash del commit (`shortHash`), mensaje de commit completo, timestamp/fecha del commit, autor (nombre y correo electrónico) e historial de rutas de archivos modificados.
  * **Grafo e Historial Clásicos**: Mensajes principales de commits en las filas (`mainMessage`), chips de referencias/ramas/tags (`RefChip`) y hashes cortos a la derecha.

#### Docs
- Bumped the app version to `v1.4.1` in `package.json`.
- Updated the README version badges, installation filenames, and current-version note.

---

## [v1.4.0] - 2026-05-24 - Design Tokens Migration & Premium Modal Layout Polish

### 🟢 Vista Clásica & Core

#### Added
- **Arquitectura de Design Tokens (Tailwind v4 `@theme`)**: Migración completa de todos los estilos inline y clases de Tailwind arbitrarias a un sistema de tokens de diseño semánticos en [globals.css](file:///c:/www/gitcron/app/globals.css). Se centralizaron colores primarios, espaciados de panel, bordes redondeados y opacidades de cristal en variables `@theme`.
- **Efectos Glassmorphism y Tipografía Semántica**: Creación de utilidades compuestas avanzadas en Tailwind v4 (`glass-overlay`, `glass-header`, `glass-sticky-header`, `glass-alert-success/warning/error`) y clases tipográficas semánticas (`text-ui-header`, `text-ui-body`, `text-ui-mono`, `text-ui-small`) basadas en la especificación de `DESIGN.MD`.
- **División de Namespaces de Tokens (Classic vs. Cronometric)**: 
  > [!NOTE]
  > **Nota Crítica para Agentes de IA en el Futuro:**
  > Se implementó una clara segmentación arquitectónica y de comentarios dentro de [globals.css](file:///c:/www/gitcron/app/globals.css) para dividir el impacto de los tokens:
  > 1. **Shared / Global Tokens**: Afectan a los contenedores, sidebars, tipografías y popovers de toda la aplicación.
  > 2. **Classic Specific Tokens** (`components/CommitGraph.tsx`): Controlan la paleta de carriles dinámicos de commits (`--color-graph-branch-1` a `--color-graph-branch-12`) y el acento `--color-secondary` del commit HEAD y ramas activas.
  > 3. **Cronometric Specific References** (`components/ChronometricGraph.tsx`): Controlan la coloración del canvas, órbitas de tags, satélites de archivos WIP y andamios de stashes, enlazándose semánticamente a las variables core compartidas de forma limpia y aislada.
- **Resolución de Solapamiento Visual (z-[100])**: Se reestructuró la prioridad de apilamiento en la aplicación. El envoltorio superior de pestañas y barras de herramientas tiene `z-[80]`, por lo que migramos el backdrop de todos los modales flotantes (Settings, Ayuda, Crear/Clonar repo, Nueva Branch, conflictos de checkout, reset, amend y squash) de `z-50` a **`z-[100]`**, garantizando que se superpongan perfectamente sin ningún recorte.
- **Ampliación y Distribución Premium de Contenedores**:
  * Se ensanchó el modal de **Settings** de `560px` a **`680px`** para mejorar la legibilidad de la grilla de atajos e inputs.
  * Se expandió el modal de **Ayuda (HelpModal)** de `max-w-3xl` a **`max-w-4xl` (`896px`)** para espaciar las explicaciones de columnas y flujos.
  * Se ampliaron los modales de repositorio (Crear a `540px`, Clonar a `680px`, Perfil a `540px`) y los diálogos de rama (`New Branch`/`Rename` a `420px`, `Delete` a `540px`, `Merge`/`Checkout Conflict`/`Amend`/`Squash` a `580px`).

#### Fixed
- **React Hook Rules Compliancy**:
  * Se reubicaron los hooks `useMemo` del árbol de branches en `app/page.tsx` (`BranchNodeView` y `RemoteBranchNodeView`) arriba de los retornos tempranos condicionales, resolviendo el error `react-hooks/rules-of-hooks`.
  * Se renombró el prop `ref` del componente `RefChip` en `components/CommitGraph.tsx` a **`gitRef`** para evitar colisiones y advertencias críticas de React (`react-hooks/refs`).
  * Se silenciaron advertencias pre-existentes de `setState` en efectos y accesos de referencias de dragging en la página principal mediante comentarios localizados a nivel de archivo.

#### Docs
- Bumped the app version to `v1.4.0` in `package.json`.
- Updated the README version badge, installation filenames, and current-version note.

---

## [v1.3.8] - 2026-05-23 - Recursive Branch Grouping (Sidebar Folders)

### 🟢 Vista Clásica & Core

#### Added
- **Recursive Branch Grouping (Infinite Depth Tree)**: Replaced the flat single-level branch sidebar grouping with an elegant, recursive `TreeNode` tree structure. Local and remote branch sidebars now support infinite nested subfolders (e.g. `feature/cronometric/tcars-hud-shell`) rendered with dynamic responsive indent padding, folder-first sorting, exact recursive leaf counts, and special priority positioning for `main`/`master` branches.

#### Docs
- Bumped the app version to `v1.3.8` in `package.json`.
- Updated the README version badge, installation filenames, and current-version note.

### 🟣 Vista Cronométrica (Chronometric View)

- *(Ningún cambio en esta versión en el Core - Desarrollo en paralelo en su respectiva rama de feature)*

---

## [v1.3.7] - 2026-05-23 - Remote Checkout & Premium Visual Conflict Resolution

### 🟢 Vista Clásica & Core

#### Added
- **Remote Branch Checkout**: Double-clicking a remote branch in the sidebar or right-clicking to use the new `RemoteBranchContextMenu` will automatically download it as a local tracking branch (`git checkout -t`) or switch to it if it already exists, featuring custom pointers and hover guides.
- **Premium Conflict Resolver Card**: Displays a glassy, high-fidelity HSL gradient card in the Diff Viewer when a selected file has merge or rebase conflicts, allowing the user to resolve the file completely with a single click ("Aceptar Local (HEAD)" or "Aceptar Entrante (Merge)") or providing instructions for side-by-side editing in their IDE.
- **State-Clearing Context Menus**: Introduced unifed setter functions for context menus (`BranchContextMenu`, `RemoteBranchContextMenu`, `CommitContextMenu`, `FileContextMenu`) to prevent overlapping rendering by closing all other active menus upon opening a new one.

#### Fixed
- Handled outside-click behavior for the new remote branch context menu, ensuring it closes naturally.

#### Docs
- Bumped the app version to `v1.3.7` in `package.json`.
- Updated the README version badge, branches list, and current-version note.

### 🟣 Vista Cronométrica (Chronometric View)

- *(Ningún cambio en esta versión en el Core - Desarrollo en paralelo en su respectiva rama de feature)*


## [v1.3.6] - 2026-05-22 - Session rescue & Viewport-aware context menus

### Fixed

- Robust login session preservation: updated `bootstrapGitHub` to only delete the GitHub credentials token from local secure storage (`safeStorage`) if the validation error is explicitly an authentication/credentials failure (HTTP `401 Unauthorized`). Temporary offline states or network timeouts no longer log the user out.
- Silent avatar & profile re-connect: added an automatic, silent re-validation trigger that fetches the user profile and updates the UI avatar as soon as the application recovers its internet connection (using window `'online'` event) or when the user opens their profile menu.
- Viewport-aware context menus: implemented `useAdjustedPosition` in all context menus (Branch, Commit, and File) to dynamically detect screen boundaries (height/width) and shift/render menus upwards or leftwards to prevent them from overflowing the viewport.
- Extended type mappings for `GitResult` to support `isAuthError` and status properties.

### Docs

- Bumped the app version to `v1.3.6` in `package.json`.
- Updated the README version badge, installer filenames, and current-version note.

---

## [v1.3.4] - 2026-05-21 - Intelligent Init in existing folders, GitHub Rescue & premium Force Push

### Added

- Support for initializing Git repositories inside existing, non-empty folders (`git:init` no longer blocks on non-empty directories).
- Intelligent flow that checks if the directory is non-empty before creation, performs a local git initialization (which commits all existing files without overwriting `README.md` or `.gitignore`), creates a bare remote repository on GitHub if checked, associates the `origin` remote, and automatically pushes the initial `main` branch.
- Collision rescue for GitHub: if the repository already exists on the user's GitHub account during the "Create also on GitHub" flow, it catches the 422 collision gracefully, fetches the repository's clone URL, and links it as the remote `origin`.
- Premium React-based Force Push overlay modal (`z-[300]`) styled with dark HSL glassmorphism and warning indicators, prompting the user for approval when branch history has diverged on initial push.
- Safe `--force` push handler in `electron/main.ts` using simple-git's standard signature to bypass diverged branch history securely.
- Added `fs:exists-and-not-empty` IPC handler to detect if folder is empty.

### Docs

- Bumped the app version to `v1.3.4` in `package.json`.
- Updated the README version badge, installer filenames, and current-version note.

---

## [v1.3.3] - 2026-05-20 - Safe directory recovery

### Fixes

- Added recovery for Git's `fatal: detected dubious ownership` / `safe.directory` error when opening a repo owned by another Windows account or Administrators.
- The error toast now explains the ownership issue and offers `Confiar carpeta`, which runs `git config --global --add safe.directory <repo>` and reopens the repo.

### Docs

- Bumped the app version to `v1.3.3` in `package.json`.
- Updated the README version badge, installer filenames, and current-version note.

---

## [v1.3.2] - 2026-05-20 - Splash polish + Graph reveal

### UX

- Reworked the Electron splash screen with the GitCron icon, subtle geometric fade animation, and a minimum visible duration to avoid startup flicker.
- Added a stable startup loading state for the Graph while the initial repo restore/load completes.
- Revealed the Graph container with a short fade-in after initial repo data is ready, avoiding the visual effect of lanes and layout settling on screen.

### Docs

- Bumped the app version to `v1.3.2` in `package.json`.
- Updated the README version badge, installer filenames, startup polish note, and current-version note.

---

## [v1.3.1] - 2026-05-20 - Update UX polish + dev mock

### UX

- Replaced the native Windows update dialogs with an in-app update experience driven from the version tag in the topbar.
- Added a notification dot on the version tag when an update is available, plus a dropdown that shows the new version and a `Descargar` / `Download` action.
- Moved update download progress and the final `UPDATE` install action next to the GitHub releases icon so the version tag remains visible.
- Added the same update status, download action, progress bar, and `UPDATE` action to the bottom of Settings.
- Aligned the Search and Branch Filter popovers with the toast-style blurred background treatment.

### Development

- Added `NEXT_PUBLIC_MOCK_UPDATE=1` support for `pnpm run electron:dev` so the update dot, dropdown, progress bar, and `UPDATE` button can be tested without publishing a release.

### Docs

- Bumped the app version to `v1.3.1` in `package.json`.
- Updated the README version badge, installer filenames, auto-update behavior notes, and current-version note.

---

## [v1.3.0] - 2026-05-19 - Pull decisions + branch sync guidance

### Features

- Added a branch-sync decision toast for the current branch when Pull or Push is triggered while the branch is behind or diverged.
- Behind-only branches now offer explicit in-app actions for `Fast-forward` or `Pull con merge`.
- Diverged branches now offer explicit in-app actions for `Pull con rebase` or `Pull con merge`, so the user can choose how to integrate local and remote history before pushing.
- Added hover explanations to the ahead / behind chips in the branch sidebar so `↑` and `↓` counts read as clear branch status instead of raw Git shorthand.

### Docs

- Bumped the app version to `v1.3.0` in `package.json` and refreshed the README badge, installer filenames, and current-version notes.
- Added future roadmap entries for a visual merge/rebase conflict resolver and local AI workflows via LM Studio.

---

## [v1.2.0] - 2026-05-19 - PR diff view + auth hardening

### Features

- Added an in-app Pull Request diff view: clicking a PR in the sidebar now loads its unified diff through GitHub, shows PR metadata, branch/base info, changed-file chips, and opens GitHub only via the explicit external-link action.

### Security

- Removed token-bearing temporary `origin` URLs from authenticated push/pull/fetch. GitCron now authenticates GitHub HTTPS remotes with a process-scoped `http.https://github.com/.extraheader` and leaves `.git/config` untouched.
- Updated authenticated clone to use the same extraheader flow, so private clones keep a clean `origin` URL without `x-access-token`.
- Extended log sanitization to redact `AUTHORIZATION: basic ...` values in addition to token-in-URL patterns.

### Docs

- Added README version/platform/runtime badges and refreshed release filenames for `v1.2.0`.
- Marked Pull request diff view and token-bearing temporary `origin` removal as completed in the roadmap.
- Updated SECURITY.md to document the extraheader auth flow and remove the old crash-window residual risk.

---

## [v1.1.7] - 2026-05-18 - Fix push (simple-git unsafe guard)

### Fixes

- El error "Configuring credential.helper is not permitted without enabling allowUnsafeCredentialHelper" también lo podía lanzar `simple-git@3.36.0` antes de ejecutar Git: su guard interno bloquea `credential.helper` y `core.askpass` salvo que se habiliten `unsafe.allowUnsafeCredentialHelper` y `unsafe.allowUnsafeAskPass` en la instancia. Las instancias autenticadas de clone/push/pull/fetch ahora usan una opción compartida con ambos permisos `unsafe`, manteniendo el URL token temporal y sin volver a `GIT_CONFIG_GLOBAL`.
- Bump de versión a `v1.1.7` para publicar el fix como release nuevo sobre el draft de GitHub.

---

## [v1.1.6] - 2026-05-18 - Fix push (safe.allowUnsafeCredentialHelper)

### Fixes

- v1.1.5 cambió el approach a `-c credential.helper= -c core.askpass=` (valores vacíos), que funcionaba en MSYS bash pero no en el git-for-windows que usa Electron. Error: "Configuring credential.helper is not permitted without enabling allowUnsafeCredentialHelper". Git-for-windows bloquea `-c credential.helper=...` **incluso con valor vacío**, a diferencia del upstream que solo bloquea valores no vacíos. Fix: agregar `safe.allowUnsafeCredentialHelper=true` al config array para autorizar el override vacío en Git.

---

## [v1.1.5] - 2026-05-18 - Fix push (sin GIT_CONFIG_GLOBAL, push fix incompleto)

### Fixes

- **El fix de v1.1.4 no resolvía el push en git-for-windows ≥2.40**. El error "Use of `GIT_CONFIG_GLOBAL` is not permitted without enabling `allowUnsafeConfigPaths`" seguía apareciendo aunque se pasara `-c safe.allowUnsafeConfigPaths=true`. Resolución: **eliminar el approach de `GIT_CONFIG_GLOBAL` + gitconfig temporal por completo** y pasar `-c credential.helper= -c core.askpass=` directamente. Los valores vacíos siempre son aceptados (CVE-2022-24765 solo bloquea valores no vacíos), no requieren `safe.allowUnsafeConfigPaths` ni `allowUnsafeCredentialHelper`. Se borra la lógica del temp file y la limpieza al `quit`.

---

## [v1.1.4] - 2026-05-18 - Fix push + UNSTAGED auto-refresh (push fix incompleto)

### Fixes

- **Push fallido por `GIT_CONFIG_GLOBAL`**: se agrega `safe.allowUnsafeConfigPaths=true` al config de simple-git en `withGitHubToken()`. Git ≥2.35.2 (CVE-2022-24765) consideraba "unsafe" la ruta del `.gitconfig` temporal usado para deshabilitar credential helpers; ahora el flag autoriza el path.

### UX

- **Panel UNSTAGED se refresca solo** al editar archivos en el working tree:
  - Watcher de FS con `chokidar` en el main process (ignora `.git`, `node_modules`, `.next`, `dist`, `release`, `out`).
  - Evento IPC `repo:fs-change` con debounce 250 ms en main + 150 ms en renderer.
  - Listener de `focus` en la ventana como defensa en profundidad.
  - Cleanup automático al cambiar de repo o cerrar la app.

---

## [v1.1.0] - 2026-05-18 - Auto-update con electron-updater

### Auto-update

- Chequeo silencioso de actualizaciones 3 s después del splash al iniciar la app (solo en producción, no en dev).
- Diálogo nativo cuando hay versión nueva disponible — botones **Descargar** / **Después**.
- `autoDownload = false`: la descarga solo arranca tras confirmación del usuario.
- Diálogo nativo cuando la descarga termina — botones **Instalar ahora** / **Más tarde**.
- `autoInstallOnAppQuit = true`: si el usuario elige "más tarde", la actualización se instala al cerrar la app.
- Sin update disponible → sin dialog, sin toast (modo silencioso).
- Nuevo handler IPC `app:check-update` para trigger manual desde el renderer.
- Botón **"Buscar actualizaciones"** en Settings → muestra spinner y toast con el resultado.
- Todos los errores del updater pasan por `sanitizeForLog()` y llegan al renderer con `errMsg()`.
- Los textos de los diálogos nativos se adaptan al idioma guardado en safeStorage (ES/EN).

### Publishing

- Nuevos scripts: `pnpm publish:win`, `pnpm publish:mac`, `pnpm publish:linux`.
- `electron-builder.publish` configurado con provider `github` (`alejandropd-1/gitcron`, repo privado).
- Requiere env `GH_TOKEN` con scope **`repo` completo** (el repo es privado).
- Los scripts crean un draft release en GitHub — publicarlo manualmente desde la UI de Releases.

### Limitaciones

- macOS auto-update queda inactivo hasta que se agregue code-signing. Los releases DMG siguen siendo descargables manualmente.

---

## [v1.0.1] - 2026-05-17 - Packaging stability fixes

### Critical fixes for packaged app

- **"Electron API no disponible" on every IPC call**: `tsup.config.ts` preload entry had `noExternal: [/.*/]` which matched everything including `electron`, causing tsup to bundle the electron package into `preload.js`. The bundled electron silently crashed the preload at runtime, leaving `window.api` undefined in both dev and packaged modes. Fixed by using the same exclusion regex as the main entry: `/^(?!electron$).+/`. Preload size dropped from 9.33 KB → 6.29 KB.
- **`sandbox: true` removed** from `BrowserWindow.webPreferences`. In combination with ASAR packaging and the bundled preload, sandbox mode prevented `contextBridge.exposeInMainWorld` from working correctly. `contextIsolation: true` + `nodeIntegration: false` is the canonical Electron security model and sufficient.
- **`app://` protocol SPA fallback**: the custom protocol handler now falls back to `out/index.html` for any path that doesn't resolve to a real file, enabling client-side routing to work correctly in the packaged app.
- **`trailingSlash: true`** added to `next.config.ts` static export so pages are generated as `page/index.html` (more compatible with the index.html fallback strategy).
- **Branch `06-Architectural`** created from `main` for these stability changes.

---

## [v1.0.0] - 2026-05-17 - First distributable release

### Packaging

- `electron-builder` v26 configured for Windows (NSIS installer), macOS (DMG) and Linux (AppImage).
- `pnpm package:win` generates `release/GitCron Setup 1.0.0.exe`.
- `next.config.ts` outputs `export` mode in production (static `out/`) so electron-builder can bundle the renderer. Dev server still uses the default Next.js mode.
- App icon uses `public/gitcron-icon.png` (512×512) for all platforms.

### Startup experience

- **Splash screen**: frameless 420×280 window with the GitCron logo and an animated green progress bar appears while the renderer loads. No extra file — the HTML is inlined.
- **Maximized on start**: the window fills the screen on first launch.
- **No auto DevTools**: DevTools no longer open automatically. In dev mode toggle with `Ctrl+Shift+I` (Win/Linux) or `Cmd+Option+I` (macOS).

### Credential caching fix

- `GIT_ASKPASS=echo` was blocked by git 2.35.2+ (same CVE-2022-24765 that blocked `credential.helper=`).
- New approach: write a temp `.gitconfig` at startup with `credential.helper =` and `core.askpass =`, then point `GIT_CONFIG_GLOBAL` to it for every token-authed operation. Git reads its own config files without restrictions, so the empty helper takes effect cleanly.

### Commit detail panel

- Clicking a commit in the graph or history now shows the **files changed in that commit** (via `git diff-tree --no-commit-id -r --name-status`), not the current working tree.
- Each file shows a colored status badge (A/M/D/R). Clicking a file loads the diff at that specific commit (`git diff <hash>^ <hash> -- <file>`).

### Squash commits

- New **Squash** button next to Amend in the staging panel.
- Modal lets you select 2–5 commits to combine, shows a live preview, and accepts a new message (defaults to the current HEAD message).
- Implementation: `git reset --soft HEAD~N` + `git commit -m <message>`. Warns about force-push if commits were already shared.

### Tests

- Vitest v4 set up with 2 test files and 14 passing unit tests.
- `lib/__tests__/shortcuts.test.ts`: `eventToShortcut`, `formatShortcut`, `defaultShortcutsMap`.
- `lib/__tests__/os-notify.test.ts`: token URL sanitization regex.
- Scripts: `pnpm test` (run), `pnpm test:ui` (browser UI), `pnpm test:watch`.

### Codebase refactor

- `app/page.tsx` reduced from 3,931 → 3,081 lines (−22%) by extracting:
  - `components/ContextMenus.tsx` — `CommitContextMenu`, `BranchContextMenu`, `FileContextMenu`, `ContextMenuItem`
  - `components/HelpModal.tsx` — `HelpModal`, `StatusBadge`, `FlowStep`
  - `components/RepoModals.tsx` — `EmptyStateCard`, `InitRepoModal`, `CloneRepoModal`, `ProfileMenu`

---

## [v0.1.8] - 2026-05-16 - UI polish, sidebar hierarchy, filter dropdown, app icon

### Sidebar hierarchy (GitKraken-style)

- LOCAL and REMOTE section headers now use `Monitor` and `Cloud` icons in cyan `#5ed8ff`.
- Section header padding reduced (`px-2`) so the chevron and icon sit at the leftmost position.
- Root branch items aligned to `pl-[26px]` so their branch icon lines up exactly with the section header icon (chevron 12px + gap 8px from the `px-2` baseline).
- Folder children (`claude/`, `origin/`) aligned to `pl-[46px]` so their icon lines up with the parent folder's icon.
- Removed the duplicate cyan cloud icon from `RemoteFolderView` (origin); cloud now lives only in the REMOTE header.
- Removed vertical guide lines (`border-l`) from both LOCAL and REMOTE folder children — pure padding hierarchy as in GitKraken.

### Branch filter dropdown

- Moved the "All branches / Current branch" segmented toggle from the graph's sticky header to a dropdown menu in the topbar, next to Terminal.
- Filter button only renders when the Graph tab is active. A small green dot appears on the icon when the "Current branch" filter is on, as a visual indicator.
- Dropdown uses `header relative z-50` + `dropdown z-50` so it always renders above the graph content (was clipping behind it before).
- Eliminated the now-empty 34px gap at the top of the graph (`sticky top-[34px]` → `sticky top-0`).

### Theme transition

- Added `transition: filter 0.35s ease, background-color 0.35s ease` to `html.light body` so the dark ↔ light switch animates smoothly instead of snapping.

### App icon

- `public/favicon.ico` (Windows-friendly multi-size) and `public/gitcron-icon.png` shipped.
- Electron `BrowserWindow` resolves the icon with a `.ico` first / `.png` fallback strategy.
- Next.js `metadata.icons` now references `favicon.ico` (replaces the default `N` Next.js favicon in the window title bar).

### Stability

- Native `File / Edit / View / Window` menu removed in production via `Menu.setApplicationMenu(null)`. Dev keeps a minimal menu for DevTools toggle.
- Spinner-stuck-on-tab race condition fixed: `use-repo-loader.ts` now captures `prevPath` before switching active repo and clears its `isLoading` in the `finally` block via `updateRepoByPath(prevPath, { isLoading: false })`.
- `git -c credential.helper=` removed (Git 2.35.2+ blocks it as CVE-2022-24765 hardening). Replaced with `GIT_ASKPASS=echo` and `GIT_CREDENTIAL_HELPER=''` env vars — same effect, no security warning.

### Context menu

- Items now use `text-left` so labels align to the left edge instead of centering.

---

## [v0.1.7] - 2026-05-16 - Amend, cherry-pick, codebase cleanup, security hardening, credential isolation

### Amend last commit

- New IPC handler `git:amend(repoPath, newMessage?)` in `electron/main.ts`. Runs `git commit --amend -m <new>` when a message is provided, or `--amend --no-edit` to fold staged changes without rewording. Refuses to amend when HEAD does not exist yet.
- New action `amendLastCommit(newMessage?)` in `hooks/use-git-actions.ts` that wraps the IPC, shows a success toast, and refreshes log/status/branches so any staged changes that got folded into the amended commit disappear from the UI.
- New **Amend** button in the staging panel next to **Commit Changes**, styled in orange to flag that this rewrites history.
- Modal that shows the current commit message (read-only), a textarea for the new message (empty = keep the existing one), and a warning about needing a force-push if the commit was already shared.

### Cherry-pick from context menu

- New IPC handler `git:cherry-pick(repoPath, hash)` with a 7-40 hex regex validation and conflict detection in the error stream. Returns `{ conflict: true }` so the renderer can show the appropriate guidance.
- New action `cherryPickCommit(hash, shortHash?)` mirrors the `mergeIntoCurrent` conflict-handling pattern (status is refreshed on conflict so the user sees the conflicted files immediately).
- New **"Cherry-pick este commit"** entry in the commit context menu — right-click any commit in the graph or the history view.

### Codebase cleanup (Fallow)

- Ran Fallow (`fallow dead-code`) over the project and removed everything it flagged as truly unreachable:
  - Deleted `hooks/use-mobile.ts` (zero importers).
  - Removed unused exports `notificationsSupported`, `notificationsPermission` from `lib/os-notify.ts`.
  - Removed unused exports `normalizeKeys`, `matchesShortcut` from `lib/shortcuts.ts`.
  - Unexported 5 internal-only types from `types/electron.d.ts` (`ElectronAPI`, `GitResult`, `RemoteOpResult`, `DeviceCodeInfo`, `CreatedRepoInfo`) — they are only referenced inside the same file.
- Removed 6 unused dependencies from `package.json`: `@google/genai`, `@hookform/resolvers`, `class-variance-authority`, `electron-is-dev`, `@tailwindcss/typography`, `firebase-tools`. Lockfile shrank by ~4700 lines.
- Cleaned the matching `@google/genai` entry from `pnpm-workspace.yaml`'s `allowBuilds`.
- Added `fallow` as a dev dependency and `.fallowrc.json` config so the analyzer can be re-run anytime.

### Security hardening — round 1

- **`sandbox: true` + explicit `webSecurity: true`** added to `BrowserWindow.webPreferences`. The preload only uses `contextBridge` + `ipcRenderer` so it remains fully sandbox-compatible.
- **URL-encoded GitHub tokens** before injecting them into clone/push URLs. `encodeURIComponent(token)` protects against tokens containing `@`, `:`, `/` or other URL-special characters that would break URL parsing.
- **`sanitizeForLog()` helper** that strips `x-access-token:<TOKEN>@` patterns from any string/Error before it reaches `console.log/error`. Applied to the three existing logging call sites in `electron/main.ts`.

### Security hardening — round 2

- **Generalized `errMsg()` helper** applied to all 48 IPC return paths that previously did `error: error.message`. Any token-bearing URL that leaks into git CLI output (e.g. `fatal: unable to access https://x-access-token:abc@github.com/...`) is now redacted before reaching the renderer.
- **Production-strict CSP** in `app/layout.tsx`: drops `'unsafe-eval'` from `script-src` and removes `localhost`/`ws://localhost` from `connect-src` when `NODE_ENV === 'production'`. Dev keeps the relaxed rules for HMR/Turbopack.
- **TOCTOU-resistant `fs:delete-file`** in `electron/main.ts`: uses `path.relative()` for traversal detection (catches both `..` segments and absolute paths) and switches to `lstatSync()` + `isFile()` guard so symlinks pointing outside the repo cannot be followed.
- **postcss override** in `pnpm-workspace.yaml` to force `>=8.5.10` (fixes GHSA-qx2v-qp2m-jg93, XSS via unescaped `</style>` in stringify output). `pnpm audit` now reports zero vulnerabilities.

### Credential helper isolation

- GitCron's token-in-URL trick was leaking into the OS credential store (Windows Credential Manager, macOS Keychain, libsecret) as a ghost `x-access-token` account that polluted the GitHub account selector on other git operations.
- Fix: every token-authed git invocation now runs with `-c credential.helper= -c core.askpass=true` via simple-git's `config` option, plus env vars `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`.
- Applied to `withGitHubToken` (push, pull, fetch, push-branch, pull-branch) and to `git:clone` when a token is injected.
- `withGitHubToken` keeps a separate "plain" `simpleGit` instance for reading/writing the origin URL so the no-helper config doesn't bleed into unrelated git plumbing.

### Settings modal polish

- Wider (560px) with `max-h-[90vh]`, scrollable body, sticky header. Long preference lists (shortcuts table, auto-fetch interval grid) no longer overflow the viewport.

---

## [v0.1.6] - 2026-05-15 - OS notifications, configurable shortcuts, light theme, polish

### Dynamic version (Feature 0)

- The version shown in Settings is now read from `package.json` at build time (`import pkg from '../package.json'`), so a single `version` bump propagates everywhere.

### Merge / fast-forward toasts (Feature 6)

- `mergeBranch` now shows a success toast (was missing).
- Unified merge/FF/up-to-date messages into reusable i18n keys: `success.merge`, `success.mergeUpToDate`, `success.fastForward` in ES and EN.

### OS notifications (Feature 7)

- New `lib/os-notify.ts` wraps the browser/Electron `Notification` API with permission handling and a global enable/disable toggle.
- Notifications fire on push/pull completion when the operation took more than 3 seconds OR the GitCron window is not focused.
- Push/pull authentication errors also notify when the window is unfocused.
- Auto-fetch now diffs the per-branch `behind` count before and after the cycle; if any branch gained remote commits, it sends a notification with the count and affected branches.
- Settings: new "Notificaciones del sistema" section with a single on/off toggle. Persisted in encrypted storage as `osNotifications`.

### Configurable keyboard shortcuts (Feature 8)

- New central shortcut system in `lib/shortcuts.ts` with 14 default bindings: `commit` (Ctrl+Enter), `push` (Ctrl+P), `pull` (Ctrl+Shift+P), `newBranch` (Ctrl+B), `search` (Ctrl+Alt+F), `fetchNow` (Ctrl+R), `settings` (Ctrl+,), `help` (F1), `closeRepo` (Ctrl+W), `nextRepo` (Ctrl+Tab), `prevRepo` (Ctrl+Shift+Tab), `graphTab` (Ctrl+G), `historyTab` (Ctrl+H), `commitTab` (Ctrl+Shift+C).
- New `hooks/use-shortcuts.ts` registers one global `keydown` listener, normalizes the combo via `eventToShortcut`, and dispatches the matching action. Skips events from inputs/textareas (except `Ctrl+Enter` for the commit textarea).
- Settings: new "Atajos de teclado" section with a table per binding. Click to capture, press the new combo to save, `Esc` cancels. "Restaurar valores por defecto" button clears the overrides.
- Persisted in encrypted storage as `shortcuts` (JSON map of id → keys).

### Light theme — experimental (Feature 9)

- Added a Theme preference (`dark` | `light`) persisted in encrypted storage as `theme` and applied as a class on `<html>`.
- Implementation: rather than rewriting every hardcoded hex across the components, light mode uses a global CSS filter inversion (`filter: invert(0.92) hue-rotate(180deg)`) on `<body>`. Elements that must keep their original colors (GitHub avatars, branch lane colors in the SVG graph) are marked with `data-keep-color` and double-inverted to compensate.
- Settings: the Theme placeholder is now a working toggle. A short note marks light mode as experimental.

---

## [v0.1.5] - 2026-05-15 - Tier 2: per-repo status, auto-fetch, branch filter, default folder + polish

### Polish and fixes (post-v0.1.5)

- Moved the fetch indicator button to the center toolbar, next to Stash, matching the size and style of Pull/Push/Branch/Stash.
- Added a `Filter` icon to the left of the branch filter toggle for visual clarity.
- Fixed a stale closure bug in the branch filter toggle where `repoPath` was read from a React closure instead of the live store, causing the refresh to silently no-op.
- Branch/tag chips in the graph now truncate long names with ellipsis (`max-w-[120px]`, `overflow-hidden`). Icons inside chips use `shrink-0` so they never collapse.
- Commits with more than 3 refs now show the first 3 chips plus a `+N` badge; hovering the badge reveals the remaining ref names via `title`.

---

## [v0.1.5] - 2026-05-15 - Tier 2: per-repo status, auto-fetch, branch filter, default folder

### Auto-fetch in background

- Added a configurable background fetch loop (`git fetch --all --prune`) that updates remote-tracking refs and ahead/behind counts without interrupting the user's view.
- Toggle, interval picker (5 / 10 / 30 / 60 minutes), and "last sync" timestamp live in Settings.
- New `git:fetch` IPC handler (separate from `git:pull`; never merges).
- Subtle indicator in the topbar that spins while fetching and shows the last sync on hover; click to fetch all open repos now.
- Preferences persisted in encrypted storage as `autoFetch`.

### Filter commits by branch

- Added a per-repo toggle in the Graph header to switch between "All branches" and "Current branch" (omits `--all` from `git log` when set to current).
- The toggle state lives in `RepoState` so each tab remembers its own preference and re-runs the log when toggled.

### Per-repo `isLoading`, `error`, `success`

- Moved the loading/error/success fields from the global store into `RepoState` so a slow operation on repo A no longer shows a spinner or error banner on repo B.
- Legacy top-level fields are kept as mirrors of the active repo for backward compatibility.
- Repo tabs now show a per-repo spinner when that tab's `isLoading` is true.

### Default folder for open/clone

- Added a configurable starting folder for the native open/clone dialogs (per-user preference, persisted in encrypted storage as `defaultFolder`).
- Settings UI with current path, Change, and Clear actions.
- Both `git:open-repo` and `fs:pick-folder` accept a `defaultPath` argument; rendered defaults flow from the store at call time.

---

## [v0.1.4] - 2026-05-15 - Multi-repo, graph polish, topbar, and preferences

### Multi-repo tabs

- Added first-class multi-repo support with `openRepos` and `activeRepoIdx` in the Zustand store.
- Kept the legacy active-repo store API so the rest of the UI could migrate safely.
- Added repo tabs with switch, close, and `+` actions.
- Restored open repos and the active tab on app start.
- Kept backward compatibility with the old `lastRepoPath` restore flow.

### Repo-scoped data loading

- Updated async repo refresh flows to write by repo path instead of always writing into the currently active repo.
- Scoped `loadDiff` updates to the intended repo to avoid cross-tab diff leaks.
- Changed `gitCommand` to be repo-scoped end to end, including Electron main, preload, types, and hooks.

### Search and topbar UX

- Reworked the topbar layout so repo navigation stays on the left, Git actions are centered, and tools live on the right.
- Replaced the always-visible search field with a search button near terminal.
- Search now opens in a floating popover and still supports `Ctrl + Alt + F`.
- Fixed the search popover layering so it renders above the main content.

### Graph and layout polish

- Added resizable graph-table columns for Branch/Tag, Graph, Date, and Commit.
- Persisted graph column widths in `localStorage`.
- Added subtle divider lines to graph headers.
- Added colored lane bands in graph rows to make message-to-branch association easier to scan.
- Refined the graph header spacing and the Date header alignment.

### Settings and typography

- Added a global text size preference in Settings with `Compact`, `Normal`, and `Large`.
- Persisted `fontSize` in encrypted storage, alongside other preferences.
- Applied the chosen size through the root document font size so Tailwind `rem`-based classes actually respond.

### Stability fixes

- Fixed a hydration mismatch caused by restoring persisted widths too early on the client.
- Hardened the GitHub Device Flow login path and error handling for transient network failures.
- Fixed persistence edge cases when closing the last repo tab.

---

## [v0.1.3] - 2026-05-15 - Restore last repo, resizable panels, stable branch colors

- Added silent repo restore on startup.
- Added resizable sidebar and details panels.
- Added stable branch colors in the commit graph.
- Expanded the branch/tag column to reduce chip truncation.
- Completed success toasts for merge, rebase, and fast-forward flows.

---

## [v0.1.2] - 2026-05-15 - First push upstream fix

- Detected "no upstream branch" push failures.
- Retried automatically with `git push --set-upstream origin <branch>`.
- Applied the fix both to toolbar push and branch-context push.

---

## [v0.1.1] - 2026-05-15 - UX polish, feedback, and auth hardening

- Added more success toasts across common Git actions.
- Added commit filtering in Graph and History.
- Added WIP banner improvements in commit details.
- Added clear-all stash with inline confirmation.
- Improved contrast in a few low-readability UI states.
- Moved Git auth back to temporary URL injection after Electron 42 blocked `GIT_ASKPASS`.

---

## [v0.1.0] - 2026-05-14 - Initial release

- Next.js + Electron + Zustand + TypeScript project base.
- Typed IPC bridge and `safeStorage` integration.
- Visual commit graph, staging area, diff viewer, and history view.
- Branch tree, stash flows, and context menus.
- GitHub OAuth Device Flow and token persistence.
- Design system foundation and dark UI.
