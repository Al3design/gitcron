# Retomar trabajo con asistencia contextual

## Context

CartoAskBox conserva turnos locales y envía sólo repo/pregunta/idioma; no transporta selección. Pipeline conserva historial de runs en SQLite pero StartRuntimeSessionInput no es una conversación reanudable. ViewSwitcherRail ya deriva alternativas y se oculta al abrir inspector. Se preservan esas decisiones de producto.

Ver proposal.md para alcance y dependencias; specs/ contiene los contratos observables.

## Goals / Non-Goals

**Goals:** completar el recorrido descrito reutilizando servicios y superficies existentes; separar contratos, integración y presentación para que cada tanda local tenga un resultado verificable.

**Non-Goals:** reescribir el cliente Git, alterar la geometría del Cronométrico, introducir WebMCP/MCP Apps como dependencia o ejecutar implementación al redactar estos artefactos.

## Decisions

### 1. Decisión de implementación

Usar identidad repo de main junto a checkout/worktree, HEAD, rama y selección discriminada (commit, archivo, change/task, propuesta temporal, nodo). Cada vista aporta referencias, no copias enormes de su estado; main valida referencias antes de leer o actuar.

#### Contrato de contexto (tarea 1.1, 2026-10-09)

**Identidad.** Se reutiliza la resolución que ya hace `PipelineService.resolveBinding`, sin una segunda:

| Campo | Qué es | De dónde sale |
|---|---|---|
| `repoKey` | El repositorio, compartido por todos sus worktrees | `gitCommonDirDigest` del binding (`git rev-parse --git-common-dir`, resumido) |
| `checkoutId` | Una carpeta de trabajo concreta: el repo principal o un worktree | El `repoId` actual de `pipeline_repo`, que ya es uno por ruta canónica |
| `checkoutPath` | Ruta canónica (`realpath`) de esa carpeta | `canonicalPath` del binding; además tiene que estar autorizada en `authorizedRepoStore` |
| `head` | `{ sha, branch }`; `branch` es `null` con HEAD separado | Se lee en main al capturar el contexto |

Una conversación y un resumen pertenecen a un `checkoutId`: dos worktrees del mismo repo tienen conversaciones separadas, y `repoKey` sólo sirve para ofrecer lo del repo hermano, nunca para mezclarlo en silencio. El renderer no manda rutas sueltas: manda la ruta del repo abierto (`activeRepoPath`), y main la resuelve y la autoriza como hoy.

En SQLite (tareas 2.1 y 2.2) la conversación se guarda por la **ruta canónica del checkout** (`checkout_path`), que es la misma identidad que `checkoutId` —uno por ruta canónica— sin depender de que el SDD haya creado antes la fila de `pipeline_repo` (decisión del orquestador, 2026-10-13). Es la misma clave que usa `ai_use_record.repo_path`.

**Selección discriminada.** Cada vista aporta como mucho una referencia, desde el estado que ya tiene, sin store nuevo:

| `kind` | Campos | Fuente actual |
|---|---|---|
| `none` | — | Ninguna selección |
| `commit` | `sha` | `selectedCommit` de git-store (Graph) y `selectedHash` del Cronométrico |
| `file` | `path` relativo al checkout, `at`: `'worktree'` o un `sha` | `selectedFile` de git-store |
| `change` | `changeId`, `taskId?` | `selectedChangeId` de pipeline-store y la tarea resaltada de SDD |
| `temporal-idea` | `runId`, `branchId` | Rama especulativa elegida en el Agente Temporal (`speculative_branch`, por corrida) |
| `carto-node` | `nodeId` | `selectedNode` de CartographyView |

Una referencia viaja con el `head.sha` en el que se tomó. Antes de leer o de actuar, main la revalida contra el checkout actual: si HEAD cambió y la referencia depende de él (un archivo en el worktree, un nodo del grafo), o si lo señalado ya no existe, la selección queda **obsoleta**. Una selección obsoleta se muestra como tal y no se usa en silencio. Las rutas se resuelven dentro del checkout autorizado; una que sale de él se rechaza sin leer nada. El contenido nunca viaja desde el renderer: main lo lee recién cuando la referencia pasó la validación.

**Conversación consultiva y sesión de ejecución.**

- Una **conversación consultiva** es texto: pregunta, respuesta, el contexto usado y sus referencias. Se guarda en SQLite por `checkoutId` (tareas 2.1 y 2.2), no abre procesos ni ejecuta herramientas, y puede convivir con cualquier otra cosa que pase en el repo. Retomarla restaura sus mensajes y nada más.
- Una **sesión de ejecución** es un proceso de IA lanzado por `runtime-session-hub`. Sigue el límite que ya existe: una sesión activa por ruta canónica de checkout, y una segunda se rechaza con `session_already_active`. Esta regla no cambia.
- Una conversación puede **proponer** lanzar una sesión. El lanzamiento va por el mismo controlador y la misma confirmación que el lanzador de SDD, y queda sujeto a ese límite. La conversación nunca abre un proceso propio para esquivarlo, y continuar una conversación no continúa un proceso.

### 2. Decisión de implementación

Conversaciones en SQLite versionado y particionado; mensajes, contexto usado, referencias, operaciones y resultados. Guardar texto visible saneado, no razonamiento privado ni secretos. El usuario puede consultar y eliminar una conversación. El replay no relanza herramientas.

### 3. Decisión de implementación

Una superficie de asistencia del armazón con entradas desde cualquier vista. Si otra superficie ocupa el lateral se alterna conservando el estado; no agregar columnas simultáneas. El flotante ofrece acciones con razones derivadas del contexto, y la IA recomienda dentro de ese catálogo validado.

### 4. Decisión de implementación

Adaptar las operaciones existentes a descriptores con alcance, precondiciones, resultado y confirmación vigente. Revalidar en main al ejecutar; mantener la separación consulta/preparación/ejecución. Los datos de repo y respuestas de modelos son contenido, no autorización.

### 5. Decisión de implementación

Crear resumen determinista utilizable sin IA; narración opcional con citas a evidencia. Fecha y huella de fuentes permiten invalidarlo. Título legible con slug secundario, tareas breves con detalle desplegable y ayuda de vocabulario a demanda; preservar lectura completa del original.

### 6. Decisión de implementación

**Narración opcional del resumen (tarea 3.3, criterio de implementación del orquestador, 2026-10-15).** En «Dónde quedaste», una acción explícita «Explicarme este resumen» pide una explicación breve al modelo compartido de `gitcron-assist`. La explicación se agrega como contenido de IA y no reemplaza los datos ni sus fuentes. El proceso principal lee únicamente propuesta y tareas del cambio elegido, valida el checkout y registra HEAD y huella de esas fuentes; reutiliza los extractores deterministas existentes. Una tarea marcada se describe como tal, no como prueba de implementación ni de verificación. La narración lleva fuentes relativas, fecha y modelo; no abre una conversación ni una ejecución, no incorpora otro ajuste de modelos y no se persiste como verdad del proyecto. Navegar, reabrir o actualizar el resumen no llama al modelo. Se descarta una respuesta si cambió el destino o sus fuentes, y un fallo deja el resumen original utilizable. Los cambios archivados usan sus fuentes archivadas contenidas en el checkout, sin confundirlos con un cambio activo del mismo nombre.

Resume de conversación restaura mensajes; resume del proceso sólo si adaptador lo soporta. Al iniciar otro proceso mostrarlo. Presupuesto de contexto y recuperación selectiva evitan reenviar repo completo; provider/modelo y alcance compartido quedan visibles.

Una consulta sin ejecución puede coexistir con el trabajo del repositorio. Cualquier acción que lance un runtime respeta el límite existente de una ejecución activa por repo y pasa por su controlador; la conversación no abre un segundo proceso para sortear ese límite.

### Gestión compartida de modelos

La asistencia consume la selección, capacidades y ciclo de carga que entregue `modelos-en-casa`. No agrega ajustes de proveedor por pantalla ni almacena otra copia de credenciales. El historial conversacional sigue siendo responsabilidad de este cambio; la sesión compartida de un modelo no implica resume de un proceso.

**El asistente es un uso más (tarea 2.3, 2026-10-13).** Se suma `gitcron-assist` a los usos de texto, al lado de `gitcron-commit`, `gitcron-cartography`, `gitcron-openspec-analysis` y `gitcron-temporal`. Así toma el modelo de `agent.gitcron-assist` en `gitcron.json` o, si no hay, la elección general, aparece en Ajustes → Motores y modelos y en el historial de usos, y el pedido va por `runTextUse` como todos. Hay una sola elección para el asistente en toda la app: la vista de la que sale la pregunta no la cambia.

**Envío (tarea 2.3).** El proceso principal recibe la pregunta, la selección de la vista y un identificador de pedido que pone la pantalla. Valida la selección con el resolvedor (1.2), guarda la pregunta, arma el contexto con presupuesto —la referencia (qué es y en qué HEAD), no el contenido del repo, y los últimos mensajes de esa conversación hasta un tope— y llama al modelo. La respuesta se guarda en la conversación **de la que salió la pregunta**, nunca en «la que esté abierta ahora». Si se cancela, si la conversación se borró mientras tanto o si llegó una pregunta más nueva a la misma conversación, la respuesta se descarta. Si el proveedor falla, la pregunta queda guardada sin respuesta y el error dice el motivo y las alternativas, como en los demás usos.

**Dónde se ve la conversación (tarea 2.4, decisión de Alejandro, 2026-10-13).** Se usa **el panel de Centauro**, el inferior que se muestra y se oculta y se agranda arrastrando, y desde ahora su contenido por omisión es **la conversación con la IA**, como el chat de la aplicación de escritorio de Claude: a la izquierda la lista de conversaciones del repo, y a la derecha la conversación elegida. Debajo del cuadro de texto van las opciones: elegir el modelo (la elección de `gitcron-assist`) y las demás funciones. Para eso el panel deja de vivir sólo dentro de la vista Cronométrica y pasa al armazón, disponible en todas las vistas. Lo que hoy muestra Centauro (informe, historial y estadísticas del Agente Temporal) no se pierde: aparece en el mismo panel cuando la persona está en la vista Cronométrica o en el Agente Temporal. Esto reemplaza, para la conversación, la «superficie del armazón en el lateral» de la decisión 3.

**El cuadro de texto del chat (tarea 2.8, decisión de Alejandro, 2026-10-13).** Como el de Claude escritorio. El cuadro empieza en una línea y crece con lo escrito hasta un tope, con `field-sizing: content` y alto máximo, sin calcular el alto a mano. Abajo, dentro del mismo recuadro: a la derecha, el modelo y el nivel de razonamiento como un botón compacto («Qwen 3.8 · Medio») que abre el selector que ya existe (`AiModelPicker` del uso `gitcron-assist`), y enviar, que pasa a detener mientras la IA piensa. A la izquierda, lo de la pantalla: el destino elegido como una etiqueta que se puede quitar (y entonces la pregunta va sobre el repo), y un menú «+» con lo que esa vista ofrece; en la 2.7 ahí entran las acciones que ejecutan, con su confirmación. Las preguntas sugeridas pasan arriba del cuadro y se ven cuando la conversación está vacía. Un botón alterna entre escribir y la vista previa del Markdown, con el mismo visor que Tareas de SDD (`MarkdownViewer`). No se adopta MCP Apps (MCP UI) para esto: sirve para mostrar interfaces que mandan servidores MCP de terceros, y estas piezas son de GitCron; se hacen como componentes propios con los tokens de la app. Si más adelante el asistente consume servidores MCP con interfaz, se evalúa entonces.

**El uso de cada respuesta (tarea 2.9, decisión de Alejandro, 2026-10-13).** Como la barra de DeepSeek Harness: cada respuesta guarda y muestra, en letra chica debajo, la fecha y la hora, las fichas de entrada, salida, razonamiento y caché que devuelve el servidor (`DraftUsage` de `runTextUse`), cuánto tardó y a cuántas fichas por segundo, y qué parte del contexto del modelo ocupó la entrada (`contextLength`, que sale de `limit.context` del modelo en `gitcron.json`). Al pie de la conversación, los totales. Se guardan en columnas nuevas de `assist_message` con una migración aparte. Un dato que el servidor no devolvió se muestra como «sin datos», nunca como cero, y sin `limit.context` no se muestra porcentaje.

**Fijar, archivar y agrupar (tarea 2.11, decisión de Alejandro, 2026-10-14).** Como en Codex. Cada conversación se fija o se archiva desde el menú de tres puntos de su fila, y cada acción tiene su vuelta (desfijar, desarchivar). La lista se arma en este orden: primero las **fijadas**; después las agrupadas por el **cambio de SDD** sobre el que se preguntó (el de la primera pregunta cuya referencia es un destino `change`), un grupo por cambio con su nombre; después las **generales**; y al final las **archivadas**, plegadas. Archivar saca la conversación de las fijadas. Los grupos salen de las referencias guardadas, sin preguntarle al modelo. Fijar y archivar se guardan como fecha (`pinned_at`, `archived_at`) en `assist_conversation`, con una migración aparte.

**Acciones desde el chat (tarea 2.7, 2026-10-15).** El menú «+» del cuadro ofrece, además de las preguntas, lo que la vista **hace**: en SDD, los mismos botones del siguiente paso (`derivePipelineNextAction`: seguir con la tarea, archivar, ver actividad…), con su disponibilidad real. Elegir uno llama al mismo `handleIntent` que el botón de la pantalla, así que pasa por el mismo camino y la misma confirmación (seguir con una tarea abre el lanzador, archivar pide confirmar el comando); el chat no agrega un camino nuevo a `pipelineRuntime.start` ni otra confirmación. Lo dispara siempre la persona: la respuesta de la IA nunca ejecuta nada. Una acción que hoy no se puede usar aparece apagada con el motivo. Configuración entra como un ítem fijo, «Motores y modelos», que abre esa sección de Ajustes. Reabrir una conversación no ejecuta ni promete continuar un proceso. Los grupos de la lista muestran el cambio con un título legible («Retomar trabajo con asistencia contextual») y el identificador como ayuda al pasar el mouse.

**Las pestañas de Centauro solo en la vista Cronométrica (decisión de Alejandro, 2026-10-14).** En las demás vistas el panel muestra sólo el chat; informe, historial y estadísticas del Agente Temporal siguen apareciendo en la Cronométrica, que es donde tienen sentido.

**Las opciones siguen al contexto (decisión de Alejandro, 2026-10-13: la idea que rige todo).** Como ya hace el riel flotante de la derecha en SDD, lo que el panel ofrece cambia según dónde está la persona: en Cartografía aparecen las herramientas de Cartografía; en el Agente Temporal, las de Centauro; en SDD, las del cambio y la tarea. La IA percibe ese contexto y lo usa para ofrecer ayuda. El mecanismo ya existe: cada vista publica en el registro de la 1.3 (`lib/assist/view-contributions.ts`) qué tiene seleccionado y qué acciones ofrece, y el panel muestra esas acciones debajo del cuadro de texto y se las pasa a la IA como el catálogo validado del que puede recomendar (decisión 3). Una vista que no publica nada recibe la conversación sola, sin opciones de más.

### Alternativas

Se descarta construir un subsistema paralelo porque las operaciones y evidencias actuales ya cubren parte del recorrido.

## Risks / Trade-offs

- Un resumen viejo puede inducir acciones incorrectas: recalcular evidencia antes de proponer acción y marcar fuentes faltantes/obsoletas.
- Confundir repos/worktrees o instrucciones incrustadas puede causar escrituras erróneas: resolver identidad y precondiciones en main y nunca convertir texto recuperado en permisos.
- Demasiadas tarjetas o texto recrearían el problema: validar una primera pantalla breve y detalles progresivos.

## Migration Plan

Tablas nuevas aditivas; los historiales Pipeline/Temporal existentes se enlazan como evidencia sin inventar conversaciones antiguas. Adoptar por vista conservando fallback a acciones manuales. Sin copia de API keys.

## Open Questions

La forma visual precisa se revisa con un prototipo del recorrido, usando identidad visual existente. Esa revisión no cambia las responsabilidades de los paneles ni habilita un rediseño global.
