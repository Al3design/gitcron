# Plan de integración de GitCron

Actualizado el 2026-09-29. La base del relevamiento fue GitCron 1.18.0 / HEAD `6336fdc`, con OpenSpec 1.13.2. El primer cambio quedó archivado con GitCron 1.19.0; el siguiente es `modelos-en-casa`, propuesto en su propia rama. Plan preparado no significa función terminada.

## Qué conservamos y qué cambia

GitCron sigue siendo un cliente Git completo: menú superior izquierdo para cambiar de vista, inspector fijo para operaciones Git, flotante contextual que cede lugar al fijo, grafo clásico/cronométrico con hover/zoom, Centauro e historial temporal. La integración conecta esas piezas y mejora orientación.

El usuario debe reconocer su objetivo, qué quedó pendiente y la acción disponible al retomar. La IA comparte contexto explícito entre pantallas; navegar no dispara consultas. El mapa de pantallas lleva de una función visible a sus archivos, componentes, estilos y datos con procedencia comprobable. Una capacidad de OpenSpec sólo se presenta como operativa cuando tiene ejecutor, entrada UI y recorrido probado.

WebMCP/MCP Apps no son dependencias de estos cambios: añadir un protocolo no resuelve por sí mismo persistencia, selección ni conexiones entre pantallas.

## Orden de entrega

| Prioridad | Cambio | Resultado y estado |
|---|---|---|
| 1 | [Cerrar conexiones operativas](changes/archive/2026-09-29-cerrar-conexiones-operativas-de-sdd/proposal.md) | Archivado el 2026-09-29 con GitCron 1.19.0: avisos en lugar de decisiones sin destino, toda IA lanzable con las mismas capacidades, navegación y recorrido preparar→confirmar→Graph auditados, inspector de SDD con las operaciones Git de Graph. La sincronización de specs sin archivar pasó a cobertura operativa. |
| 2 | [Modelos en casa](changes/modelos-en-casa/proposal.md) | En curso desde el 2026-09-29, en su rama: `gitcron.json` propio en el formato de OpenCode (editable a mano y reflejado en la pantalla, secretos por variables), MCP en `mcp.json` con la notación compartida, suscripciones por CLI y servidores por API con el estándar de OpenAI en una misma elección, pedido efectivo visible con su procedencia. Empieza por mediciones y un recorrido angosto con Unsloth local y Codex. |
| 3 | [Retomar con asistencia contextual](changes/retomar-trabajo-con-asistencia-contextual/proposal.md) | Contexto/conversación durables, orientación breve y flotante pertinente, consumiendo la gestión de modelos compartida. Candidato para decisiones reales pedidas por una IA durante una sesión (anotado 2026-09-29 en cerrar-conexiones design.md). |
| Intercalable después de 1 | [Retirar cambios obsoletos](changes/retirar-cambios-openspec-obsoletos/proposal.md) | Retiro explícito sin consolidar deltas e historia honesta. |
| Intercalable después de 1 | [Configuración global](changes/administrar-configuracion-global-de-openspec/proposal.md) | Un editor global, alcance claro y estado efectivo por repo. |
| Reevaluar tras probar 1–3 | [Centauro y OpenSpec](changes/vincular-centauro-con-cambios-openspec/proposal.md) | Proponer/vincular desde ideas sin duplicar decisiones ni materialización. |
| Reevaluar tras probar 1–3 | [Pantallas y código](changes/mapear-pantallas-y-su-codigo/proposal.md) | Catálogo funcional y relaciones con evidencia; conservar mapa técnico. |
| Reevaluar tras probar 1–3 | [Cobertura operativa](changes/completar-cobertura-operativa-de-openspec/proposal.md) | Inventariar cobertura real y priorizar operaciones según necesidad, antes de implementar esquemas, stores o worksets avanzados. |

Los últimos tres cambios conservan sus artefactos como propuestas para reevaluar, no como una secuencia comprometida de implementación. Las tareas pueden reformularse a partir del uso de las primeras entregas.

Los cambios de retiro y configuración se reformulan. `explicar-el-ciclo-sin-tecnicismos` queda sustituido por orientación y ayuda contextual: permanece en el histórico con retirement.md, sin sincronizar sus deltas. `automatizar-las-tandas-de-migracion` está diferido; su generador no es requisito para ejecutar tandas pequeñas.

## Recuperación de modelos-en-casa

La decisión de un cambio separado consta en [el historial del ciclo OpenSpec](changes/archive/2026-09-18-gestionar-ciclo-openspec-desde-gitcron/tasks.md): integración Unsloth, resolución de proveedor reutilizada por consumidores y controles compartidos de modelo/contexto/TTL. Incluye la intención de mantener el modelo cargado y poder usar tamaños distintos según la tarea.

El alcance a formalizar es una gestión común de configuración, capacidades, credenciales existentes y ciclo de carga del modelo. Una elección común no obliga a usar un único modelo para toda clase de tarea; las excepciones deben ser visibles. La política local/remota debe declarar el destino del contexto, sin un fallback externo silencioso. Los controles compartidos se integran respetando el inspector Git y el flotante contextual.

La asistencia contextual consumirá esa gestión. Será responsable de conversación, selección y recuperación de fuentes; mantener un modelo cargado no equivale a recuperar una conversación ni a reanudar un proceso ejecutor. La propuesta de `modelos-en-casa` requiere contrastar el alcance histórico con sus consumidores actuales antes de su implementación.

## Base del relevamiento

| Conexión observada | Evidencia para retomar |
|---|---|
| Hallazgo inicial: inspector sin respuesta; controlador extraído posteriormente | `components/RepoDetailsPanel.tsx` → `components/pipeline/OpenSpecInspector.tsx` / `PipelineWorkspace.tsx`. El test original sólo llama a su propio mock; la nueva prueba .tsx monta el inspector real. |
| Sync tiene handler pero registro sin runner | `electron/main.ts:registerPipelineSyncHandlers` → `electron/ipc/pipeline-sync.ts:SyncDeps`. Disponibilidad por defecto falsa. |
| Restricciones de ejecución distintas por adaptador | `electron/pipeline/runtime-adapters/codex-adapter.ts`, `claude-adapter.ts` y `runtime/runtime-session-hub.ts`. |
| Preparación y confirmación reutilizan Git | `OpenSpecDashboard.tsx` → `hooks/use-git-actions.ts`; `RepoDetailsPanel.tsx` confirma. |
| Flotante condicionado por inspector | `OpenSpecDashboard.tsx` → `ViewSwitcherRail.tsx`; no reemplazar menú global ni superponer ambos. |
| Ideas, decisiones e historial ya existen | `components/ChronometricGraph.tsx`, `electron/ipc/ai.ts`, persistencia temporal JSON/SQLite. Materializar no es crear propuesta. |
| Cartografía técnica y consulta existen | `CartographyView`, `CartoAskBox` y `electron/ai/carto/`; consulta y grafo no acreditan un mapa de pantallas. |

Hallazgo adicional del 2026-09-29: `electron/ipc/pipeline-control.ts` delega en `dispatchRespondDecision` del control-bus. Ese método valida y registra un acuse de recibo, pero no despacha el efecto de la opción al runtime. Conectar el inspector al IPC no cierra el recorrido de decisión.

## Seguimiento de la entrega

La rutina común de tandas, validación y reporte está en [config.yaml](config.yaml). Los execution.md conservan mapas de responsabilidades y dependencias; los criterios observables están en specs y tasks.

El prompt 2 inicial se ejecutó antes del 1. Los dos archivos en prompts/ quedan como notas históricas, no como instrucciones vigentes. El efecto de la decisión no se implementó: la medición mostró que las únicas «decisiones» eran avisos informativos, y se presentaron como tales.

La planificación y el código se registran en commits separados, sobre `change/cerrar-conexiones-operativas-de-sdd`. Los artefactos de futuros cambios guardados en esa rama son planificación; tener una rama con su nombre no significa que contenga una implementación propia.

## Evidencia documental

El retiro de `explicar-el-ciclo-sin-tecnicismos` se realizó el 2026-09-28 con `--skip-specs`: las 39 specs canónicas conservaron sus hashes y los cuatro archivos originales se conservaron, agregando retirement.md. El código, la evidencia de validación y los pendientes de la primera tanda se registran por separado en el cambio de conexiones operativas y en su reporte local.
