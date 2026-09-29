# Tasks

Lista de resultados y comprobaciones pendientes. Referencias de implementación en [execution.md](execution.md).

## 1. Decisiones y avisos

- [x] 1.1 **IA local:** Reemplazar la prueba que sólo invoca un mock por una prueba que monta RepoDetailsPanel y pulsa una opción real de DecisionInbox. **Comprobación:** La prueba de montaje acredita el envío real desde el inspector; completar la sustitución del test original y demostrar que detecta una desconexión, sin revertir la corrección productiva.
- [x] 1.2 **IA local:** Conectar el inspector fijo al controlador de decisiones compartido sin crear una segunda implementación del protocolo. **Comprobación:** La prueba de montaje pasa y verifica payload ligado al repo/decisión, no sólo la invocación de un callback artificial.
- [x] 1.3 **IA local:** Avisos en lugar de decisiones sin destino (requisito «Un aviso informativo…» del delta pipeline-decision-contract): cuando todas las opciones de una solicitud son informativas (hoy, las auditorías rechazadas de docs/reports con «Ver evidencia», components/pipeline/pipeline-adapter.ts:~160), DecisionInbox/DecisionCard la presentan como aviso (título de la bandeja y rótulo en criollo, es/en/zh) y «Ver evidencia» abre el archivo con window.api.shellOpenItem(repoPath, ruta relativa); no se llama a pipelineControl.respondDecision ni aparece «respondUnsupported». Si el archivo no se abre, se informa. El hook use-pipeline-decision-control sólo envía opciones con availability ejecutable (hoy ninguna). **Comprobación:** Pruebas de montaje en el inspector: tocar «Ver evidencia» llama a shellOpenItem con la ruta y nunca a respondDecision; archivo inexistente → aviso de no encontrado.

- [x] 1.4 **IA local:** Retirar la conexión muerta y dejar anotado el camino futuro: OpenSpecDashboard.tsx recibe onRespondDecision (:170, :272) sin usarlo; sacarlo junto con su paso desde PipelineWorkspace. El estado «enviando» y la protección de doble clic del hook quedan para opciones ejecutables futuras, sin rehabilitar botones tras un acuse. **Comprobación:** tsc y pruebas del workspace sin la prop; ninguna ruta de UI llama a respondDecision con una opción informativa.

## 2. Capacidades según operación

- [x] 2.1 **Orquestador/auditor:** Fijar la tabla intención→capacidad a partir de los adaptadores reales antes de delegar cambios del launcher. **Comprobación:** Entregar tabla en este design: lectura, escritura, pruebas y resume; demostrar Codex read-only y Claude sin shell, sin inferir capacidad por nombre del agente.
- [x] 2.2 **IA local:** Extraer o ampliar el cálculo puro de disponibilidad por intención usando la tabla auditada. **Comprobación:** Casos lectura permitida/escritura ausente/pruebas ausentes/runtime desconocido; no bloquear por no pertenecer a fixtures.
- [x] 2.3 **IA local:** Conectar el launcher al cálculo de disponibilidad y mostrar la alternativa aplicable a la intención original. **Comprobación:** Prueba de montaje conserva cambio/tarea destino al seleccionar runtime; alternativa no cambia silenciosamente la intención.
- [x] 2.4 **IA local:** Las mismas capacidades para toda IA lanzable (design.md decisión 2, «Revisión 2026-09-29»): Codex pasa a `exec --sandbox workspace-write` (codex-adapter.ts:25) y Claude suma `Bash` a `--allowedTools` (claude-adapter.ts:35); las capacidades declaradas de cada adaptador (`session.start` y sus `constraints`) dicen lo que realmente puede hacer; `modifiesRepo` de Codex pasa a `true` (runtime-session-hub.ts:93). La confirmación previa dice que la IA va a poder modificar archivos y correr comandos en el repositorio. **Comprobación:** pruebas de los argumentos de cada adaptador; prueba del lanzador: sin confirmación no arranca y el texto nombra archivos y comandos; ningún adaptador usa las opciones «dangerously…».
- [x] 2.5 **IA local:** La disponibilidad por intención (`pipeline-intent-capabilities.ts`) deja de ramificar por nombre de runtime: resuelve con las capacidades que declara la entrada (lanzable, escribe, corre comandos, reanuda). Con 2.4, Claude y Codex quedan disponibles para explorar, escribir artefactos e implementar; reanudar y OpenCode siguen «sin comprobar»; agy y LM Studio, no lanzables. Se retiran los textos «sólo puede leer» y «no puede correr pruebas». **Comprobación:** pruebas de la función sin nombres de runtime en su lógica; prueba de montaje del lanzador con Codex para escribir la propuesta sin alternativa forzada.

## 3. Sync aislado y aplicación

Trasladado el 2026-09-29 a completar-cobertura-operativa-de-openspec (grupo 5), con su requisito, por decisión de Alejandro: se cierra este cambio y se prioriza modelos-en-casa.

## 4. Integración

- [x] 4.1 **IA local:** Cubrir navegación entre objetivo, tarea, artefactos y revisión alternando flotante/fijo. **Comprobación:** Se conserva selección, el menú global sigue accesible y ninguna acción queda únicamente en un panel oculto.
- [x] 4.2 **Orquestador/auditor:** Auditar el recorrido SDD preparar→inspector confirmar→Graph y la evidencia de capacidades/sync en composición productiva. **Comprobación:** Stage/commit usan operaciones Git existentes; aislar dos repos, cancelación y selección obsoleta. Ejecutar validación integrada del proyecto y revisión visual, sin completar tareas por mocks aislados.
