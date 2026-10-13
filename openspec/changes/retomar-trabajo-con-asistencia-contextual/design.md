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

Resume de conversación restaura mensajes; resume del proceso sólo si adaptador lo soporta. Al iniciar otro proceso mostrarlo. Presupuesto de contexto y recuperación selectiva evitan reenviar repo completo; provider/modelo y alcance compartido quedan visibles.

Una consulta sin ejecución puede coexistir con el trabajo del repositorio. Cualquier acción que lance un runtime respeta el límite existente de una ejecución activa por repo y pasa por su controlador; la conversación no abre un segundo proceso para sortear ese límite.

### Gestión compartida de modelos

La asistencia consume la selección, capacidades y ciclo de carga que entregue `modelos-en-casa`. No agrega ajustes de proveedor por pantalla ni almacena otra copia de credenciales. El historial conversacional sigue siendo responsabilidad de este cambio; la sesión compartida de un modelo no implica resume de un proceso.

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
