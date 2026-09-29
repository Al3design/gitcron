# Proposal

## Why

Hoy la IA de GitCron vive en dos mundos que no se hablan. Los usos de texto (redacción de commit,
Cartografía, análisis de versión de OpenSpec, Temporal Agent) tienen cada uno su proveedor fijo: tres
apuntan a LM Studio en `localhost:1234` sin forma de cambiarlo desde la pantalla, y Temporal Agent y
Cartografía sólo conocen OpenRouter o la API de Anthropic. Los agentes de SDD (Claude, Codex, OpenCode)
se lanzan sin modelo: `PipelineRuntimeLauncher` nunca manda `requestedModel`, aunque los adaptadores
lo aceptan, y toca lo que cada CLI tenga configurado. Mientras tanto la persona ya eligió sus motores
fuera de GitCron: tres suscripciones por CLI (Claude Code 2.1.284, Codex 0.144.4, Antigravity `agy`
1.2.13) y servidores propios en `~/.config/opencode/opencode.json` (LM Studio y Unsloth en su PC, por
túnel Cloudflare o por la red local), con las claves en texto plano. Elegir una vez y que valga en toda
la aplicación es el pedido; también es la base que la asistencia contextual va a consumir.

Medido el 2026-09-29: `createUnslothConfig` (`electron/ai/text-client.ts`) arma las cabeceras de
Cloudflare Access pero nadie la llama; `agy` 1.2.13 ya tiene `-p`, `--output-format stream-json`,
`--input-format stream-json`, `--model`, `--mode accept-edits`, `--continue`/`--conversation` y
`agy models`, pero el registro lo declara no lanzable por diseño porque en 1.1.x no tenía salida
estructurada; OpenCode 1.18.33 responde el `initialize` de ACP con protocolo 1, el que el adaptador
exige (la versión exacta ya no se exige).

## What Changes

- **Un catálogo común de motores**, con dos familias que se eligen desde el mismo lugar:
  - *Suscripción por CLI* (la cuenta de la persona, sin tokens): Claude Code, Codex y Antigravity. Sirven
    como agente en SDD y también para tareas de texto (`claude -p`, `codex exec`, `agy -p`), por ejemplo
    Temporal Agent sin OpenRouter.
  - *API o servidor propio* (tokens o gratis): OpenRouter, LM Studio, Unsloth y cualquier servidor
    compatible con OpenAI. Para texto, por la capa `text-client`; como agente, a través de OpenCode.
- **Importar proveedores desde `~/.config/opencode/opencode.json`**: se leen del bloque `provider` la URL,
  las cabeceras, la clave y los modelos declarados. Los secretos pasan al baúl cifrado de GitCron
  (`key-store`, safeStorage) y nunca llegan al renderer. El archivo de OpenCode no se modifica. También se
  puede cargar un proveedor a mano.
- **Lista de modelos por proveedor**: la del servidor (`GET /v1/models`), la del CLI (`agy models`), la de
  OpenRouter, y alta manual cuando el proveedor no lista.
- **Una elección por omisión y excepciones visibles por uso**: redacción de commit, Cartografía, análisis
  de versión, Temporal Agent y agente de SDD. Cada uso puede preferir un modelo rápido o uno de
  razonamiento; una excepción se ve donde se usa, no queda escondida en ajustes.
- **El destino del contexto se declara**: antes de mandar un diff o un repositorio a un modelo, la
  pantalla dice adónde va (esta máquina, la PC de la casa, un servicio externo). No hay caída silenciosa a
  un servicio externo cuando el local no responde.
- **Un mismo proveedor, dos direcciones**: Unsloth en la PC se alcanza por la red local o por el túnel. Se
  prueba primero la dirección local y, si no responde, la remota; la pantalla dice cuál usó.
- **El lanzador de SDD pasa el modelo elegido** (`requestedModel`) a Claude, Codex, Antigravity y OpenCode.
- **Antigravity pasa a ser lanzable** con un adaptador de stream estructurado sobre `agy -p
  --output-format stream-json`, con las mismas capacidades que los demás (lee, escribe y corre comandos)
  y sin opciones «dangerously…».
- **Los controles de carga (`AiModelControls`)** — cargar, expulsar, contexto, TTL — se muestran sólo con
  proveedores que declaran esa capacidad (hoy LM Studio). Los demás no los muestran deshabilitados como
  si faltara algo.

## Capabilities

### New Capabilities
- `ai-model-catalog`: catálogo común de proveedores y modelos de las dos familias, importación desde
  OpenCode, credenciales cifradas, elección por omisión con excepciones por uso, destino del contexto
  declarado y resolución local/remota de un mismo proveedor.

### Modified Capabilities
- `pipeline-runtime-adapters`: Antigravity deja de ser el ejemplo de runtime sin stream estructurado;
  con `stream-json` se consume como stream estructurado y se lanza como los demás.
- `pipeline-guided-workflow`: el selector de modelo del panel elige del catálogo común y no de un
  servidor fijo; estado de carga, contexto y dispositivo se declaran cuando el proveedor los informa.

## Impact

- Main: `electron/ai/key-store.ts` (secretos con nombre por proveedor importado), `electron/ai/text-client.ts`
  (resolución del proveedor por uso), un lector nuevo de `opencode.json`, `electron/ai/providers/*`,
  `electron/ai/carto/*`, `electron/ai/commit-message/local-provider.ts`,
  `electron/pipeline/openspec-version-analysis.ts`, `electron/ipc/ai.ts`, `electron/ipc/commit-message-ai.ts`,
  `electron/preload.ts` (hoy `setKey` descarta el nombre del secreto).
- Runtimes: `electron/pipeline/runtime-adapters/agy-adapter.ts` (reemplazo del wrapper),
  `runtime/runtime-session-hub.ts` (registro), `opencode-acp-adapter.ts` (proveedor y modelo de la sesión),
  `components/pipeline/PipelineRuntimeLauncher.tsx` (`requestedModel`).
- Renderer: `components/TemporalAgentSettings.tsx`, `components/cartography/CartoAISettings.tsx`,
  `components/pipeline/AiModelControls.tsx`, una pantalla de ajustes de motores y modelos.
- Sin dependencias nuevas. OpenCode y los CLI son opcionales: si faltan, se dice cuál y por qué.
- Seguridad: los secretos importados quedan cifrados y fuera del renderer; nada se manda a un destino
  que la pantalla no haya declarado.
