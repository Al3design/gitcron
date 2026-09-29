# Ejecución de Modelos en casa

Estado: propuesta escrita el 2026-09-29, sin implementación.

## Orden y dependencias

Segundo cambio de la secuencia, después de cerrar conexiones operativas de SDD. El grupo 1 va primero: sus mediciones fijan el formato de Antigravity, la elección de modelo en OpenCode y el modo texto de los CLI, y los grupos 3 y 4 se escriben contra esas capturas. La asistencia contextual consume este catálogo.

## Mapa de trabajo

Rutina de trabajo: [config.yaml](../../config.yaml). Secuencia del producto: [EXECUTION.md](../../EXECUTION.md). Las rutas de esta tabla son referencias de implementación.

| Tarea | Responsable | Archivos o responsabilidad acotada |
|---|---|---|
| 1.1 | orquestador | Captura saneada de `agy` en repo temporal; destino junto a las demás capturas de runtimes |
| 1.2 | orquestador | `scripts/capture-opencode-acp-handshake.mjs` extendido o hermano; `opencode-acp-adapter.ts` sólo lectura |
| 1.3 | orquestador | Tabla en design.md (D3) |
| 2.1 | local | Módulo nuevo del catálogo en `electron/ai/` y su test |
| 2.2 | local | `electron/ai/key-store.ts`; `electron/ipc/ai.ts`; `electron/preload.ts`; `types/electron.d.ts` |
| 2.3 | local | Importador en `electron/ai/` y su test con fixture saneado |
| 2.4 | local | `electron/ai/commit-message/local-provider.ts` (catálogo), módulo del catálogo |
| 2.5 | local | Módulo del catálogo; `electron/ai/text-client.ts` |
| 2.6 | local | Módulo del catálogo; `lib/ai-model-memory.ts` como fuente de migración |
| 3.1 | local | Cliente de texto por CLI en `electron/ai/` y su test |
| 3.2 | local | `electron/ipc/commit-message-ai.ts`; `electron/ai/carto/*`; `electron/pipeline/openspec-version-analysis.ts`; `electron/ai/providers/*` |
| 3.3 | local | `components/pipeline/AiModelControls.tsx`; pantallas de cada uso; `lib/i18n.ts` |
| 4.1 | local | `components/pipeline/PipelineRuntimeLauncher.tsx`; `electron/ipc/pipeline-runtime.ts` |
| 4.2 | local | `electron/pipeline/runtime-adapters/agy-adapter.ts`; `runtime/runtime-session-hub.ts`; conformance |
| 4.3 | local | `electron/pipeline/runtime-adapters/opencode-acp-adapter.ts`; lanzador |
| 5.1 | local | Sección de ajustes nueva; `components/TemporalAgentSettings.tsx`; `components/cartography/CartoAISettings.tsx` |
| 6.1 | orquestador | Recorrido real y reporte |
