# Entender pantallas a través del código que las construye

## Context

graph-engine combina snapshot CodeGraph con scanRepoFilePaths; node detail ya consulta callers/callees/impact. GitCron cambia superficies en RepoMainView sin necesitar una ruta web distinta por pantalla: un detector basado sólo en rutas omitiría varias vistas.

Ver proposal.md para alcance y dependencias; specs/ contiene los contratos observables.

## Goals / Non-Goals

**Goals:** completar el recorrido descrito reutilizando servicios y superficies existentes; separar contratos, integración y presentación para que cada tanda local tenga un resultado verificable.

**Non-Goals:** reescribir el cliente Git, alterar la geometría del Cronométrico, introducir WebMCP/MCP Apps como dependencia o ejecutar implementación al redactar estos artefactos.

## Decisions

### 1. Decisión de implementación

Agregar adaptadores de descubrimiento por stack, empezando por Next/React y switches de vistas de GitCron, con contrato de cobertura explícito. Resolver estáticamente imports/rutas cuando posible; condiciones runtime y composición dinámica permanecen desconocidas o requieren asociación manual.

### 2. Decisión de implementación

Catálogo por nombre de producto; una pantalla puede usar muchos archivos y un archivo muchas pantallas. Mostrar piezas compartidas separadas de específicas, no asignar propiedad exclusiva a la primera coincidencia.

### 3. Decisión de implementación

Mantener asociaciones manuales portables y auditables con origen manual, separadas de resultados generados. IA puede sugerir asociaciones con fuentes, pero no elevar una sugerencia a relación comprobada.

### 4. Decisión de implementación

Navegación catálogo→detalle→relaciones/impacto→archivo/diff mediante rutas existentes. Mostrar conteos de cobertura, excluidos y errores; cero relaciones observadas no significa inexistencia de dependencias.

### 5. Decisión de implementación

Indexado reutiliza motor y cache existentes, incremental y cancelable; invalidar por cambios de archivos/HEAD. No iniciar app externa, capturar pantalla ni ejecutar código del repo para completar el mapa.

### 6. Decisión de Alejandro (2026-10-13)

La vista se rehace para alguien que no programa. La entrada es el catálogo de pantallas en cuadros; cada cuadro dice en una o dos frases qué hace esa pantalla, en lenguaje llano, y cuántos y cuáles archivos la forman, separando los propios de los compartidos. La descripción puede venir de la IA (uso `gitcron-cartography`), pero se marca como sugerida y cita los archivos en que se basa; una descripción manual la reemplaza. El mapa técnico de símbolos y relaciones queda como profundización, no como primera pantalla.

La columna derecha del chat se quita: preguntar sobre una pantalla o un archivo se hace en el panel de Centauro de retomar, donde Cartografía publica su selección y sus acciones por el registro de contribuciones (`lib/assist/view-contributions.ts`). La estética se rediseña entera con módulos CSS y tokens de `@theme`, como el resto de la app; un componente de Cartografía con Tailwind se pasa a módulos cuando se toca.

### 7. Contrato pantalla ↔ archivos (tarea 1.1, 2026-10-16)

El contrato está en `types/screen-map.ts`. Una pantalla (`ScreenEntry`) es una ruta web (`kind: 'route'`) o una vista elegida por estado sin URL propia (`kind: 'view'`, como Graph, SDD o Cartografía en GitCron, que se eligen con `activeView`/`activeTab`). Tiene un nombre legible, el lugar donde se declara y una lista de vínculos a archivos (`ScreenFileLink`). La relación es de muchos a muchos: `shared` lo calcula el catálogo cuando un archivo aparece en más de una pantalla, y ninguna pantalla «se queda» con un compartido. Cada vínculo dice su procedencia: `static` (leído en el código), `inferred` (por una regla que puede fallar), `manual` (lo puso una persona; ninguna regla lo pisa) o `unknown` (un import dinámico o una ruta calculada que no se resolvió, con el texto de lo que faltó). El rol del archivo (`screen`, `component`, `style`, `data`, `logic`, `text`, `other`) es la categoría que se muestra en el cuadro, en palabras de todos los días. La descripción en lenguaje llano es manual o sugerida por IA; la sugerida guarda modelo, fecha y archivos citados, y sin citas no se muestra. La cobertura (`ScreenMapCoverage`) distingue completo, parcial (con no resueltos, excluidos y errores), no aplicable (repo sin interfaz o stack desconocido) e indexando: un vacío nunca se lee como respuesta. Las asociaciones manuales (`ManualScreenLink`) viven fuera de la caché regenerable y, si su pantalla o archivo desaparecen, quedan pendientes en vez de reasignarse solas.

### 8. Cuadros de pantallas (tanda 03, 2026-10-16)

El selector Simple/Técnico que ya tenía Cartografía decide la entrada: en Simple (el de omisión) se ve el catálogo de cuadros; en Técnico, el panorama y el grafo de siempre. Cada cuadro lleva el nombre, dónde se elige (la ruta, o «Vista dentro de la app»), qué hace y qué archivos la forman, con los propios separados de los compartidos y agrupados por rol en palabras de todos los días. La explicación de qué hace la pide la persona con un botón (no se llama sola, y por ser un pedido explícito no depende del interruptor de IA de Cartografía); usa el uso `gitcron-cartography`, manda un contexto acotado (los archivos y el comienzo de hasta tres archivos de entrada, 12.000 caracteres como tope), exige JSON con texto y archivos citados que sean de esa pantalla, y se guarda en la caché de Cartografía por contenido, así que no se vuelve a pedir mientras los archivos no cambien. Una explicación sin citas válidas no se muestra. La descripción manual y las asociaciones manuales llegan con la tanda 04 (tarea 1.5).

### 9. Cuadros que se expanden, IA por el chat general y capturas reales (Alejandro, 2026-10-16)

Al ver la tanda 03, Alejandro pidió:

- **Interacción:** los cuadros no se empujan entre sí. Al tocar uno, se expande a la izquierda como detalle y el resto pasa a una columna angosta a la derecha, uno debajo del otro; tocar otro de la columna lo cambia, y cerrar vuelve a la grilla. Sin modal y con animación (que respeta el movimiento reducido). La lista de archivos vive dentro del detalle, con su propio desplazamiento y agrupada por rol, nunca empujando la página.
- **IA:** nada de un botón grande repetido en cada cuadro. Un ícono de IA chico arriba a la derecha de cada cuadro, con la ayuda «Explicar qué hace», **abre el chat general** (el panel de abajo, el de toda la app) con esa pantalla como tema. Para eso se suma el destino `carto-screen` al contrato de contexto de la asistencia. No hay un chat por cuadro.
- **Captura de cada pantalla, automática:** cada cuadro muestra cómo se ve la pantalla. Una captura real exige que la app esté corriendo, y por eso esta decisión **reemplaza** lo de «no iniciar la app externa» de la decisión 5, con un resguardo: GitCron pide permiso **una vez por proyecto** antes de arrancarlo. Las pantallas con dirección se capturan arrancando el proyecto con su propio comando de inicio y visitando cada dirección en una ventana oculta de Electron; las vistas sin dirección, con las pruebas de pantalla que tenga el proyecto (como las e2e de GitCron) o pidiéndole a la IA que llegue a esa pantalla navegando la app. Las capturas se guardan y solo se rehacen cuando cambian los archivos de esa pantalla. Es la tanda 05; la 04 deja el lugar de la captura listo.

### 10. Qué archivos son de una pantalla (2026-10-16, medido sobre GitCron)

Una sonda sobre el mapa real mostró que Graph listaba 55 archivos y ninguno era suyo: faltaban `CommitGraph` y `ChronometricGraph`, y aparecían archivos del proceso principal, pruebas y scripts. Dos causas. Primera: para una vista definida en el mismo archivo que la elige, se usaron las llamadas del índice, y el índice resuelve una llamada por su nombre (`get`, `run`) hacia cualquier archivo; desde ahora el primer nivel sale de lo que **dibuja** el componente (sus etiquetas JSX resueltas por los imports del archivo), que es exacto. Segunda: el índice cuenta los `import type`, y una pantalla parecía usar el proceso principal; desde ahora una pantalla nunca suma archivos de prueba, `scripts/` ni, si su entrada no está en `electron/`, nada del proceso principal. Además, a pedido de Alejandro: los cuadros llevan el efecto de píxeles de React Bits (Pixel Card, MIT + Commons Clause: se usa dentro de GitCron, no se redistribuye suelto) con los colores de la IA y respetando el movimiento reducido, y la grilla tiene cuatro tamaños de cuadro que se recuerdan.

### 11. Capturas reales de las pantallas con dirección (tanda 05b, 2026-10-16)

Concreta la parte de capturas de la decisión 9. Se capturan primero las pantallas con dirección (`kind: 'route'` sin partes variables como `[id]`); las vistas sin dirección y las direcciones variables quedan con el ícono y llegan en otra tanda (tarea 2.8), porque necesitan navegar la app.

- **Cómo se arranca el proyecto:** si usa Next, con su propio `next dev -p <puerto libre>` desde `node_modules/.bin`; si usa Vite, `vite --port <puerto> --strictPort`; si no, su script `dev` (o `start`) con el gestor de paquetes que indique su archivo de bloqueo y `PORT` en el entorno. Si no hay nada de eso, no se ofrece capturar.
- **Permiso:** una vez por proyecto y atado a la orden exacta que se muestra. Si la orden cambia (por ejemplo, cambió el script), se vuelve a pedir. El permiso se puede quitar (control completo). Se pide en una franja dentro del catálogo, no en un modal.
- **Captura:** cada dirección se abre en una ventana oculta de Electron sin acceso al sistema (sandbox, sin preload, partición propia, sin ventanas nuevas, sin salir del servidor local, permisos denegados). Se guarda en JPEG achicado en la base de GitCron (tabla nueva, fuera del repo). El servidor se detiene siempre al terminar, al cancelar y al cerrar GitCron.
- **Cuándo se rehace:** cada captura guarda una clave hecha con tamaño y fecha de cambio de los archivos de esa pantalla. Si cambia, la captura sigue mostrándose marcada como vieja y se rehace. Con permiso dado, al abrir el catálogo se capturan solas las que falten o estén viejas; también hay un botón para actualizarlas y otro para detener.

### Alternativas

Se descarta construir un subsistema paralelo porque las operaciones y evidencias actuales ya cubren parte del recorrido.

## Risks / Trade-offs

- Heurísticas por framework son parciales: fixtures cubren repos con rutas, vistas por estado, imports dinámicos y no-UI; fallback técnico y asociación manual.
- Un canvas grande vuelve a esconder lo importante: catálogo/lista y detalle legibles por defecto, grafo técnico a demanda.

## Migration Plan

Entrada nueva sobre Cartografía existente; conservar preferencia de vista técnica y referencias a nodos. Cache versionada regenerable, asociaciones manuales fuera de la cache. Sin migrar código de repos analizados.

## Open Questions

Repositorios sin interfaz muestran módulos/funciones y cobertura no aplicable; no se inventan pantallas. Inspección visual futura requiere diseño de instrumentación y consentimiento separado.
