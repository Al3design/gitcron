# Ejecución de Modelos en casa

Estado: propuesta escrita el 2026-09-29, sin implementación.

## Orden y dependencias

Segundo cambio de la secuencia, después de cerrar conexiones operativas de SDD. El grupo 1 va primero: sus mediciones fijan el formato de Antigravity, cómo OpenCode recibe la configuración de GitCron, el modo texto de los CLI y el esquema con el que se valida. El grupo 2 (archivo) va antes que los usos; los grupos 3 y 4 pueden alternarse. La asistencia contextual consume esta configuración.

## Mapa de trabajo

Rutina de trabajo: [config.yaml](../../config.yaml). Secuencia del producto: [EXECUTION.md](../../EXECUTION.md). Las rutas de esta tabla son referencias de implementación.

| Tarea | Responsable | Archivos o responsabilidad acotada |
|---|---|---|
| 1.1 | orquestador | Captura saneada de `agy` en repo temporal, junto a las demás capturas de runtimes |
| 1.2 | orquestador | `scripts/capture-opencode-acp-handshake.mjs` extendido o hermano; `opencode-acp-adapter.ts` sólo lectura |
| 1.3 | orquestador | Tabla en design.md (D6) |
| 1.4 | orquestador | Copia del esquema de OpenCode y `gitcron.json` de ejemplo |
| 2.1–2.5 | local | Módulo nuevo de configuración en `electron/ai/` y sus tests; `electron/ai/key-store.ts`; `electron/ipc/ai.ts`; `electron/preload.ts`; `types/electron.d.ts` |
| 2.6 | local | Importador en el módulo de configuración y su test con fixture saneado |
| 2.7 | local | Módulo de configuración; `lib/ai-model-memory.ts` y ajustes actuales como fuente |
| 3.1, 3.1b | local | `electron/ai/commit-message/local-provider.ts` (catálogo), módulo de configuración |
| 3.2 | local | Cliente de texto por CLI en `electron/ai/` y su test |
| 3.3 | local | `electron/ipc/commit-message-ai.ts`; `electron/ai/carto/*`; `electron/pipeline/openspec-version-analysis.ts`; `electron/ai/providers/*`; `electron/ai/text-client.ts` |
| 3.4 | local | `components/pipeline/AiModelControls.tsx`; pantallas de cada uso; `lib/i18n.ts` |
| 4.1 | local | `components/pipeline/PipelineRuntimeLauncher.tsx`; `electron/ipc/pipeline-runtime.ts` |
| 4.2 | local | `electron/pipeline/runtime-adapters/agy-adapter.ts`; `runtime/runtime-session-hub.ts`; conformance |
| 4.3 | local | `electron/pipeline/runtime-adapters/opencode-acp-adapter.ts`; lanzador |
| 5.1 | local | Sección de ajustes nueva; `components/TemporalAgentSettings.tsx`; `components/cartography/CartoAISettings.tsx` |
| 6.1 | orquestador | Recorrido real y reporte |
