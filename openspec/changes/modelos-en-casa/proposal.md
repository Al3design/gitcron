# Proposal

## Why

Hoy la IA de GitCron vive en dos mundos que no se hablan. Los usos de texto (redacción de commit,
Cartografía, análisis de versión de OpenSpec, Temporal Agent) tienen cada uno su proveedor fijo: la
redacción y el análisis de versión llaman siempre a LM Studio en `localhost:1234`, sin forma de cambiarlo
desde la pantalla, y Temporal Agent y Cartografía sólo conocen OpenRouter o la API de Anthropic. Los
agentes de SDD (Claude, Codex, OpenCode) se lanzan sin modelo: `PipelineRuntimeLauncher` nunca manda
`requestedModel`, aunque los adaptadores lo aceptan. Mientras tanto la persona ya eligió sus motores fuera
de GitCron: tres suscripciones por CLI (Claude Code 2.1.284, Codex 0.144.4, Antigravity `agy` 1.2.13) y
servidores propios declarados en `~/.config/opencode/opencode.json` —LM Studio, y Unsloth en su PC por
túnel Cloudflare o por la red de la casa—, con claves y cabeceras como variables de entorno (`{env:…}`),
parámetros por modelo (`reasoning_effort`) y servidores MCP. Ese archivo, en un formato con esquema
público, ya es la forma en que la persona administra sus modelos; GitCron necesita el suyo, con el mismo
formato, para que la configuración sea editable a mano, compatible con otras herramientas y absorba
parámetros nuevos sin que haya que cambiar GitCron.

Medido el 2026-09-29: el esquema de OpenCode (`https://opencode.ai/config.json`) admite comentarios,
rechaza claves desconocidas en el nivel superior y ya trae todo lo necesario: `provider` con `options` y
`headers` libres, modelos con `limit`, `temperature`, `options` y `variants`, `model` y `small_model`,
`agent.<nombre>` con modelo y parámetros propios, y `mcp`. `createUnslothConfig` (`electron/ai/text-client.ts`)
arma las cabeceras de Cloudflare Access pero nadie la llama. `agy` 1.2.13 ya tiene `-p`,
`--output-format stream-json`, `--model`, `--mode accept-edits` y `agy models`, pero el registro lo
declara no lanzable porque en 1.1.x no tenía salida estructurada. OpenCode 1.18.33 responde el
`initialize` de ACP con el protocolo que el adaptador exige.

## What Changes

- **`gitcron.json`, el archivo de configuración de IA de GitCron**, en `~/.config/gitcron/` y, opcional,
  en la raíz del repositorio. Mismo formato y mismo `$schema` que `opencode.json`; sin claves inventadas:
  - `provider`: proveedores y modelos con sus parámetros (contexto, temperatura, razonamiento, variantes y
    cualquier `options` nuevo, que se pasa tal cual).
  - `model` / `small_model`: elección general y rápida.
  - `agent.<uso>`: una entrada por uso de GitCron (redacción de commit, Cartografía, análisis de versión,
    Temporal Agent, agente de SDD) para excepciones de modelo y parámetros.
- **`mcp.json` aparte, con la notación `mcpServers`** que comparten Cursor, LM Studio y Claude Code (global y
  por repositorio, variables `${env:NOMBRE}`). Se muestra y se conserva; GitCron todavía no lo usa. Importa
  desde Cursor, LM Studio y el bloque `mcp` de OpenCode, que se convierte.
- **El archivo y la pantalla dicen lo mismo**: GitCron observa el archivo, lo refleja al guardarlo a mano
  y, cuando se cambia algo desde la pantalla, escribe sólo ese valor, conservando comentarios y campos que no
  conoce. Un archivo roto se informa con línea y motivo y nunca se sobrescribe.
- **Secretos por referencia**: `{env:NOMBRE}` y `{file:ruta}` en cualquier valor, incluida la URL base
  (así se elige túnel o red local por variable, como hoy). Una variable se toma del sistema y, si no está,
  de las que la persona guardó cifradas en GitCron. El archivo nunca lleva el valor.
- **Importar desde `opencode.json`**: copia bloques `provider` y `agent` con vista previa,
  conservando las referencias. `opencode.json` no se modifica.
- **Dos familias en la misma elección**: suscripción por CLI (Claude, Codex, Antigravity; sirven como agente
  y para texto, por ejemplo Temporal Agent sin OpenRouter) y API o servidor propio (lo del bloque `provider`).
- **Destino declarado, sin caída silenciosa**: la pantalla dice adónde va el contenido antes de mandarlo. Si
  el proveedor no responde, se informa; si otro declara los mismos modelos (el mismo Unsloth por red local y
  por túnel), se ofrece cambiar con un toque, no solo.
- **El lanzador de SDD pasa el modelo elegido**. Los proveedores propios se lanzan como agente con OpenCode,
  entregándole la definición de `gitcron.json` sin tocar su configuración.
- **Antigravity pasa a ser lanzable** con un adaptador de stream estructurado, con las mismas capacidades que
  los demás y sin opciones «dangerously…».
- **Los controles de carga (`AiModelControls`)** se muestran sólo con proveedores que pueden cargar y
  expulsar modelos (hoy LM Studio).

## Capabilities

### New Capabilities
- `ai-model-catalog`: archivo `gitcron.json` en el formato de OpenCode, sincronía archivo↔pantalla,
  parámetros abiertos, secretos por referencia, importación desde OpenCode, las dos familias de proveedores,
  elección general con excepciones por uso, destino declarado y MCP conservados.

### Modified Capabilities
- `pipeline-runtime-adapters`: Antigravity deja de ser el ejemplo de runtime sin stream estructurado; con
  `stream-json` se consume como stream estructurado y se lanza como los demás.
- `pipeline-connection-security`: ACP deja de ser preferido cuando no deja elegir el modelo; OpenCode 2 se
  lanza por `opencode run --format json` porque su ACP no ofrece los proveedores propios.
- `pipeline-guided-workflow`: el selector de modelo del panel elige de la configuración común y no de un
  servidor fijo; estado de carga, contexto y dispositivo se declaran cuando el proveedor los informa.

## Impact

- Main: módulo nuevo de configuración (lectura con `jsonc-parser`, ya dependencia directa; mezcla global +
  repositorio; sustitución `{env:}`/`{file:}`; observación del archivo; escritura por ediciones puntuales),
  `electron/ai/key-store.ts` (variables guardadas por nombre), `electron/ai/text-client.ts`,
  `electron/ai/providers/*`, `electron/ai/carto/*`, `electron/ai/commit-message/local-provider.ts`,
  `electron/pipeline/openspec-version-analysis.ts`, `electron/ipc/ai.ts`, `electron/ipc/commit-message-ai.ts`,
  `electron/preload.ts`.
- Runtimes: `agy-adapter.ts` (reemplazo del wrapper), `runtime-session-hub.ts`, `opencode-acp-adapter.ts`
  (configuración entregada al proceso), `PipelineRuntimeLauncher.tsx` (`requestedModel`).
- Renderer: `TemporalAgentSettings.tsx`, `CartoAISettings.tsx`, `AiModelControls.tsx`, una sección de
  ajustes «Motores y modelos».
- Archivos nuevos en el disco de la persona: `~/.config/gitcron/gitcron.json`. Sin dependencias nuevas.
- Seguridad: el archivo no lleva secretos; las variables guardadas en GitCron quedan cifradas y fuera del
  renderer; nada se manda a un destino que la pantalla no haya declarado.
