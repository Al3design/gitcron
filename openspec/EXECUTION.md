# Plan de integración de GitCron

Actualizado el 2026-10-09. La base del relevamiento fue GitCron 1.18.0 / HEAD `6336fdc`, con OpenSpec 1.13.2. El primer cambio quedó archivado con GitCron 1.19.0; `modelos-en-casa` se archivó el 2026-10-09; el siguiente es `retomar-trabajo-con-asistencia-contextual`. Plan preparado no significa función terminada.

## Qué conservamos y qué cambia

GitCron sigue siendo un cliente Git completo: menú superior izquierdo para cambiar de vista, inspector fijo para operaciones Git, flotante contextual que cede lugar al fijo, grafo clásico/cronométrico con hover/zoom, Centauro e historial temporal. La integración conecta esas piezas y mejora orientación.

El usuario debe reconocer su objetivo, qué quedó pendiente y la acción disponible al retomar. La IA comparte contexto explícito entre pantallas; navegar no dispara consultas. El mapa de pantallas lleva de una función visible a sus archivos, componentes, estilos y datos con procedencia comprobable. Una capacidad de OpenSpec sólo se presenta como operativa cuando tiene ejecutor, entrada UI y recorrido probado.

WebMCP/MCP Apps no son dependencias de estos cambios: añadir un protocolo no resuelve por sí mismo persistencia, selección ni conexiones entre pantallas.

## Orden de entrega

| Prioridad | Cambio | Resultado y estado |
|---|---|---|
| 1 | [Cerrar conexiones operativas](changes/archive/2026-09-29-cerrar-conexiones-operativas-de-sdd/proposal.md) | Archivado el 2026-09-29 con GitCron 1.19.0: avisos en lugar de decisiones sin destino, toda IA lanzable con las mismas capacidades, navegación y recorrido preparar→confirmar→Graph auditados, inspector de SDD con las operaciones Git de Graph. La sincronización de specs sin archivar pasó a cobertura operativa. |
| 2 | [Modelos en casa](changes/archive/2026-10-09-modelos-en-casa/proposal.md) | Archivado el 2026-10-09 (del 2026-09-29 en su rama). Pendientes anotados en su tasks.md: Consola por red local y Temporal con Codex por pantalla. Alcance: `gitcron.json` propio en el formato de OpenCode (editable a mano y reflejado en la pantalla, secretos por variables), MCP en `mcp.json` con la notación compartida, suscripciones por CLI y servidores por API con el estándar de OpenAI en una misma elección, pedido efectivo visible con su procedencia. Empieza por mediciones y un recorrido angosto con Unsloth local y Codex. |
| 3 | [Retomar con asistencia contextual](changes/retomar-trabajo-con-asistencia-contextual/proposal.md) | Contexto/conversación durables, orientación breve y flotante pertinente, consumiendo la gestión de modelos compartida. Candidato para decisiones reales pedidas por una IA durante una sesión (anotado 2026-09-29 en cerrar-conexiones design.md). |
| 3b | [Modularizar SDD](changes/modularizar-sdd/proposal.md) | Desde el 2026-10-09, en su rama sobre la de Retomar: partir la pantalla de SDD por zonas y vistas, sin cambios de comportamiento, para que cada tanda y su verificación abarquen sólo lo que tocan. Después, los textos por pantalla. |
| 3c | [Un solo sistema de estilos](changes/un-solo-sistema-de-estilos/proposal.md) | Desde el 2026-10-10, en su rama sobre la de Modularizar SDD: un solo sistema para escribir estilos (lo elige Alejandro), piezas compartidas para los acomodos que se repiten y limpieza de alias y reglas copiadas, sin cambios visibles. |
| Intercalable después de 1 | [Retirar cambios obsoletos](changes/retirar-cambios-openspec-obsoletos/proposal.md) | Retiro explícito sin consolidar deltas e historia honesta. |
| Intercalable después de 1 | [Configuración global](changes/administrar-configuracion-global-de-openspec/proposal.md) | Un editor global, alcance claro y estado efectivo por repo. |
| Reevaluar tras probar 1–3 | [Centauro y OpenSpec](changes/vincular-centauro-con-cambios-openspec/proposal.md) | Proponer/vincular desde ideas sin duplicar decisiones ni materialización. |
| Reevaluar tras probar 1–3 | [Pantallas y código](changes/mapear-pantallas-y-su-codigo/proposal.md) | Catálogo funcional y relaciones con evidencia; conservar mapa técnico. |
| Reevaluar tras probar 1–3 | [Cobertura operativa](changes/completar-cobertura-operativa-de-openspec/proposal.md) | Inventariar cobertura real y priorizar operaciones según necesidad, antes de implementar esquemas, stores o worksets avanzados. |
| Idea, después de 2 (sin propuesta) | La IA aprende de lo que hacés | Anotada el 2026-10-02 a pedido de Ale, a partir de [autoharness](https://github.com/tigerless-labs/autoharness) (un complemento de Claude Code que arma y poda solo sus habilidades). No se integra: sólo corre dentro de Claude Code, en Python, en Linux y macOS, y se dispara solo. Se toman tres ideas sobre el historial de usos de IA de modelos-en-casa (D19): **redacción del commit**, aprender el estilo de cada repositorio de las redacciones que se editaron antes de confirmar; **Agente Temporal**, juntar una idea nueva con su parecida de predicciones anteriores en vez de repetirla, y calibrar las próximas con las ideas aceptadas, descartadas y materializadas (`branch_decision`). Lo aprendido guarda de dónde sale (como el registro con evidencia de autoharness), se ve en pantalla y se aplica con un botón: la IA no aprende ni se dispara sola. |
| Idea, después de 2 (sin propuesta) | Agregar cosas por separado (plugins) | Anotada el 2026-10-04 a pedido de Ale, a partir de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), donde todo es un plugin sobre [Cordis](https://github.com/cordiverse/cordis). Investigación en [plugins de DeepSeek Harness](investigaciones/2026-10-04-plugins-de-deepseek-harness.md). Recomendación: no adoptar Cordis entero ni abrir plugins de terceros todavía (en dsh corren en el mismo proceso con permisos totales; en GitCron ese proceso tiene el baúl de claves y puede hacer `git push`). Primero un punto de extensión interno con registro y registros que se deshacen solos (los adaptadores de runtime de Pipeline) y que GitCron use los servidores de `mcp.json`, que ya son plugins del estándar en su propio proceso; con eso medido se decide la base. Los slots de pantalla son el camino para «una IA en todas las pantallas». |
| Idea, en medición (sin propuesta) | Pruebas que usan la app de verdad | Anotada el 2026-10-06 a pedido de Ale, que quiere implementar [e2e](https://github.com/tester-army/e2e) (un agente que maneja la app y graba lo que hizo para repetirlo sin modelo). Motivo: en la tanda 24 de modelos-en-casa dos errores de pantalla pasaron las pruebas porque simulan el proceso principal. Investigación en [e2e sobre GitCron](investigaciones/2026-10-06-e2e-sobre-gitcron.md): no tiene motor para Electron, pero su motor web se engancha por CDP a un navegador abierto (modo persistente, un GitCron nuevo por intento); en Windows pide WSL; el modelo puede ser la suscripción de ChatGPT (la de Claude no sirve). Siguiente paso: una prueba de concepto con GitCron aislado (datos, configuración y baúl de prueba). La alternativa sin modelo es Playwright con `_electron.launch`. |
| Idea, para la IA en todas las pantallas (sin propuesta) | Cada pantalla le dice a la IA qué puede hacer | Anotada el 2026-10-06 a pedido de Ale, a partir de [WebMCP](https://developer.chrome.com/docs/ai/webmcp?hl=es-419) (propuesta de estándar de Chrome: una página declara herramientas con `navigator.modelContext` o anotando formularios, y el agente del navegador las llama sin hacer clic). No sirve para auditar (saltea la pantalla, que es donde se escapan los errores) ni conviene depender de él (prueba de origen desde Chrome 149, sin estándar cerrado). Sí sirve su forma para «una IA en todas las pantallas»: cada pantalla registra sus herramientas (elegir modelo para un uso, lanzar el agente, marcar una tarea) y la IA de GitCron sabe qué puede hacer donde está la persona. GitCron controla la pantalla y el proceso principal, así que puede hacerlo con su propio registro, junto con el punto de extensión de la fila «Agregar cosas por separado». |

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
