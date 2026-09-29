# Cerrar conexiones operativas de SDD

## Context

Relevamiento estático 2026-09-28, base 6336fdc. RepoDetailsPanel.tsx monta OpenSpecInspector sin onRespondDecision; éste tiene un default vacío. main.ts registra pipeline-sync sin runner; sus defaults lo declaran indisponible. codex-adapter.ts usa exec --ephemeral --sandbox read-only; claude-adapter.ts limita herramientas a archivos. Pipeline prepara mediante stageFiles y el formulario Git compartido.

Ver proposal.md para alcance y dependencias; specs/ contiene los contratos observables.

## Goals / Non-Goals

**Goals:** completar el recorrido descrito reutilizando servicios y superficies existentes; separar contratos, integración y presentación para que cada tanda local tenga un resultado verificable.

**Non-Goals:** reescribir el cliente Git, alterar la geometría del Cronométrico, introducir WebMCP/MCP Apps como dependencia o ejecutar implementación al redactar estos artefactos.

## Decisions

### 1. Decisión de implementación

Conservar la fachada de acciones Git y los guards main existentes. El inspector obtiene callbacks del mismo controlador que PipelineWorkspace; nunca genera una segunda implementación de decisiones o commit.

El 2026-09-29 se verificó que dispatchRespondDecision valida el envío y registra ACK, pero no despacha la opción al ejecutor. La conexión del renderer es un incremento parcial: falta resolver la opción vigente, ejecutar su efecto y persistir/reconciliar el resultado con idempotencia. El feedback de la UI depende de ese contrato. La decisión sigue pendiente hasta que la proyección la dé resuelta: el ACK del control-bus no la aplica.

**Revisión 2026-09-29 (auditor, decisión de Alejandro «A ahora, B después»):** las únicas solicitudes existentes salen de auditorías rechazadas en docs/reports (repo-evidence-reader.ts:452-510) con la opción informativa «Ver evidencia» (pipeline-adapter.ts:~160), y ningún runtime declara respond-decision (runtime-session-hub.ts:61: sólo cancel-run y kill-process). No hay efecto que aplicar: 1.3 y 1.4 pasan a presentar avisos honestos y retirar la conexión muerta. **Futuro (B):** decisiones reales pedidas por una IA durante una sesión («¿uso esta librería?») y contestadas desde GitCron; requiere medir qué runtime puede pedirlas y recibirlas. Va a retomar-trabajo-con-asistencia-contextual o a modelos-en-casa, no a este cambio.

### 2. Decisión de implementación

Extender la resolución de capacidades por intención. Estar instalado permite aparecer en discovery; implementar exige escritura y verificar con comandos exige ejecución de pruebas. Mantener alternativas de consulta o ejecución externa visibles, sin ampliar permisos silenciosamente.

**Tabla intención→capacidad (tarea 2.1, medida por el auditor el 2026-09-29 sobre los adaptadores; no por nombre del agente):**

| Runtime | Lanzable (`runtime-session-hub.ts`) | Leer el repo | Escribir archivos | Correr comandos / pruebas | Reanudar sesión |
|---|---|---|---|---|---|
| Claude (`claude-adapter.ts:35-50`) | sí (`:92`, `modifiesRepo: true`) | sí (`Read,Grep,Glob`) | sí (`Edit,Write`, `--permission-mode acceptEdits`) | **no**: `--allowedTools` no incluye `Bash` | desconocido (`session.resume` «effect not tested») |
| Codex (`codex-adapter.ts:25`) | sí (`:93`, `modifiesRepo: false`) | sí | **no**: `exec --sandbox read-only` | sólo comandos que no escriban; no probado | **no**: `--ephemeral` |
| OpenCode (`opencode-acp-adapter.ts`) | registrado (`:95-101`) | desconocido: ACP negocia `session/new` pero «prompt execution not initiated» | desconocido | desconocido | desconocido (anunciado, sin probar) |
| agy | **no** (`:94`, `launchable: false`) | — | — | — | — |
| LM Studio | **no**: no está en el registro del hub (es proveedor, no runtime) | — | — | — | — |

Intenciones que lanzan sesiones hoy (`PipelineNewChangeFlow.tsx`: explorar y proponer; `PipelineArtifactGraph.tsx`: escribir un artefacto; `OpenSpecDashboard.tsx` `launchTarget`: implementar una tarea):

| Intención | Requiere | Disponible con | Aviso |
|---|---|---|---|
| Explorar | leer | Claude, Codex | — |
| Proponer / escribir artefactos | leer + escribir | Claude | Codex: «sólo puede leer; para escribir la propuesta usá Claude» |
| Implementar una tarea | leer + escribir + correr pruebas | ninguno completo; Claude parcial | Claude: «escribe el código pero no puede correr pruebas: la verificación queda para vos (`pnpm verificar`)». Codex: no disponible |
| Reanudar | reanudar | ninguno comprobado | no se ofrece hasta tener prueba |

OpenCode queda como «capacidad sin comprobar» en todas las intenciones hasta `modelos-en-casa` (handshake ACP pendiente); se muestra, no se bloquea por no tener fixture, y lo dice.

**Revisión 2026-09-29 (decisión de Alejandro):** los límites de la tabla anterior no son de las IAs sino de cómo GitCron las lanza: Codex con `--sandbox read-only`, Claude sin `Bash` en `--allowedTools`. Desde sus propias aplicaciones o la terminal, todas leen, escriben y corren comandos. Por lo tanto **toda IA lanzable desde SDD tiene las mismas capacidades**: leer, escribir en el repositorio y correr comandos (pruebas incluidas) dentro de él, y ninguna se clasifica por rol (explorador, planificador, auditor, orquestador…). Esto rige para **usar la IA dentro de GitCron**; los roles con que se reparte el desarrollo de GitCron (las etiquetas de tasks.md y la rutina de config.yaml) son otra cosa y se mantienen. Medido con `codex exec --help` y `claude --help` (2026-09-29):

- Codex: `exec --sandbox workspace-write` (escribe y ejecuta comandos dentro del repositorio; la red queda bloqueada por el sandbox, lo que se declara). Se descarta `--dangerously-bypass-approvals-and-sandbox`: quita toda contención y la propia herramienta la reserva a entornos ya aislados.
- Claude: `--allowedTools` suma `Bash` a `Read,Grep,Glob,Edit,Write`, con `--permission-mode acceptEdits`. Se descarta `--dangerously-skip-permissions` por lo mismo.
- La confirmación que ya existe antes de una sesión que escribe pasa a decir, en criollo, que la IA va a poder modificar archivos **y correr comandos** en ese repositorio. Sin confirmación no arranca.
- La disponibilidad por intención (2.2) deja de mirar el nombre del runtime: lee las capacidades que cada adaptador declara. Lo que sigue sin comprobarse (OpenCode, reanudar) se dice como «sin comprobar», no como límite de la IA.



### 3. Decisión de implementación

Conectar sync-preview al runner de workflow existente, separando generación de propuesta y aplicación. El runner no escribe las specs canónicas durante preview: usar espacio temporal aislado, importar sólo una propuesta acotada y verificarlo. Revalidar hashes, repositorio y cambio al aplicar bajo exclusión mutua.

### 4. Decisión de implementación

Releer evidencia tras acciones y errores. Una respuesta aceptada por transporte no prueba efecto; el estado pendiente permanece hasta resultado. Cubrir el montaje productivo, no sólo un handler con dependencias inyectadas.

### 5. Decisión de implementación

Mantener alternancia fijo/flotante y menú izquierdo. Una acción pertinente puede cambiar de superficie pero conserva ruta alcanzable y selección; registrar matriz de transiciones como evidencia de pruebas.

### Alternativas

Se descarta construir un subsistema paralelo porque las operaciones y evidencias actuales ya cubren parte del recorrido.

## Risks / Trade-offs

- Los adaptadores disponibles no ofrecen lo mismo: no anunciar implementación o pruebas cuando falta soporte; una prueba de integración debe demostrar cada capacidad nueva.
- Sync puede producir cambios fuera de alcance: confinar outputs y rechazar rutas/estado cambiados; no aplicar parcialmente un plan vencido.
- Una marca de «montado» que se apaga al desmontar tiene que volver a prenderse al montar. La app corre en desarrollo con el modo estricto de React (`reactStrictMode: true`), que monta, desmonta y remonta cada efecto; las pruebas con `render` sin `StrictMode` no lo reproducen. Medido el 2026-09-29 en la auditoría 4.2: el arreglo del cruce entre repositorios dejaba `isMountedRef` en `false` desde el primer montaje y «Preparar» quedaba girando en la pantalla de Ale, con 2336 pruebas en verde. La prueba de aislamiento monta ahora también en `StrictMode`.

## Migration Plan

Cambio incremental sobre contratos y consumidores existentes; no migración de Git. Los estados antiguos sin evidencia de capacidad siguen unknown. La reversión del wiring conserva archivos y sesiones, sin revertir trabajo del usuario.

## Open Questions

Ninguna decisión de producto bloqueante. Durante implementación se debe demostrar qué ejecutor instalado satisface sync; si ninguno lo hace, se informa el bloqueo y no se declara esta entrega completa.
