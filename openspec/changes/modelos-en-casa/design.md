# Design

## Context

Estado medido el 2026-09-29 (motivación en proposal.md):

| Uso | Hoy | Dónde |
|---|---|---|
| Redacción de commit | LM Studio `localhost:1234`; el renderer nunca manda `baseUrl` | `electron/ipc/commit-message-ai.ts`, `electron/ai/commit-message/local-provider.ts` |
| Cartografía | OpenRouter o LM Studio | `electron/ai/carto/*`, `components/cartography/CartoAISettings.tsx` |
| Análisis de versión de OpenSpec | LM Studio fijo | `electron/pipeline/openspec-version-analysis.ts` (`createLmStudioConfig`) |
| Temporal Agent | OpenRouter o API de Anthropic | `electron/ai/providers/*`, `components/TemporalAgentSettings.tsx` |
| Agente de SDD | Claude, Codex, OpenCode sin modelo; agy no lanzable | `PipelineRuntimeLauncher.tsx`, `runtime-session-hub.ts` |

Piezas que se reutilizan: `text-client.ts` (URL base + clave opcional + cabeceras sobre la API de OpenAI),
`key-store.ts` (safeStorage), `requestedModel` en el hub y en los adaptadores de Claude, Codex y OpenCode,
`AiModelControls` (carga, contexto, TTL de LM Studio), `jsonc-parser` 3.3.1 (dependencia directa).

`~/.config/opencode/opencode.json` de Ale: `lmstudio` (`localhost:1234`), `unslothpc` (túnel
`https://llm.aledesign.dev/v1`) y `unslothpclocal` (`http://192.168.1.7:8888/v1`), los dos Unsloth con
`apiKey` y cabeceras `CF-Access-Client-Id`/`Secret` como `{env:…}` y los mismos siete modelos, uno con
`options.reasoning_effort: "High"`; `agent.tanda` con modelo de `unslothpc`; seis servidores `mcp` locales y
remotos.

Esquema de OpenCode (`https://opencode.ai/config.json`, bajado el 2026-09-29): nivel superior con
`additionalProperties: false`; `provider.<id>` = `api, name, env, id, npm, whitelist, blacklist, options,
models`; `provider.options` = `apiKey, baseURL, timeout, headerTimeout, chunkTimeout…` y abierto; modelo =
`id, name, family, reasoning, temperature, tool_call, cost, limit{context,input,output}, modalities,
options, headers, variants…`; `agent.<nombre>` = `model, variant, temperature, top_p, prompt, tools,
disable, description, mode, options, steps, permission…`; `allowComments: true`.

### Cómo lo resuelven otras herramientas (relevado el 2026-09-29)

| Herramienta | Modelos | Protocolo | MCP | Secretos |
|---|---|---|---|---|
| OpenCode | Bloque `provider` en `opencode.json`, esquema público | Chat Completions vía `@ai-sdk/openai-compatible` (u otros paquetes) | Bloque `mcp` propio (`type: local\|remote`, `command` lista) | `{env:X}`, `{file:ruta}` |
| VS Code (Copilot) | `chatLanguageModels.json`: grupos con `vendor`, `apiKey`, `apiType` y modelos con `id, name, url, maxInputTokens, maxOutputTokens, toolCalling, vision, thinking, requestHeaders, modelOptions` | Elegible por grupo: Chat Completions, Responses o Messages | `.vscode/mcp.json` con `servers`; usuario `~/.copilot/mcp-config.json` con `mcpServers` | `${input:id}` (almacén seguro), `${env:X}`, `envFile` |
| Cursor | Sólo pantalla: clave y «Override OpenAI Base URL» | Chat Completions | `~/.cursor/mcp.json` y `.cursor/mcp.json` con `mcpServers` | `${env:X}`, `envFile`, `${userHome}`, `${workspaceFolder}` |
| LM Studio | Es el servidor | `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`, `/v1/completions`; API nativa aparte para cargar/expulsar | `mcp.json` con `mcpServers` («sigue la notación de Cursor») | — |
| Unsloth | Es el servidor (puerto 8888 por omisión) | `/v1/models` (sólo cargados), `/v1/chat/completions`, `/v1/responses`, `/v1/messages`; Bearer `sk-unsloth-…` | — | — |

Conclusiones que fijan las decisiones:
- **Protocolo:** todos convergen en Chat Completions de OpenAI; Responses y Messages son opcionales. →
  D11b.
- **Archivo de modelos:** no hay uno común. VS Code y OpenCode tienen el suyo con campos equivalentes
  (`maxInputTokens`/`limit.context`, `maxOutputTokens`/`limit.output`, `requestHeaders`/`headers`,
  `modelOptions`/`options`); Cursor no tiene archivo. El de OpenCode es el único con esquema público que Ale
  ya usa. → D1 se mantiene; importar desde `chatLanguageModels.json` de VS Code queda como mejora posterior,
  porque los campos se corresponden uno a uno.
- **MCP:** la notación mayoritaria es `mcpServers` en un `mcp.json` aparte (Cursor, LM Studio, Claude Code,
  el archivo portable de VS Code). La de OpenCode es minoritaria. → D12: MCP no va en `gitcron.json`.
- **Secretos:** cada herramienta referencia en vez de escribir el valor; VS Code guarda en su almacén
  seguro lo que el archivo nombra como `${input:…}`. Las «variables guardadas en GitCron» de D5 son la misma
  idea con la sintaxis del formato de cada archivo.

Fuentes: [LM Studio MCP](https://lmstudio.ai/docs/app/mcp), [LM Studio OpenAI compat](https://lmstudio.ai/docs/developer/openai-compat),
[VS Code MCP](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration),
[VS Code modelos](https://code.visualstudio.com/docs/agent-customization/language-models),
[Cursor MCP](https://cursor.com/docs/context/mcp), [Unsloth API](https://unsloth.ai/docs/basics/api),
[Unsloth issue 5047](https://github.com/unslothai/unsloth/issues/5047).

## Goals / Non-Goals

**Goals:**
- Un único punto en main que responde «¿qué proveedor, modelo, parámetros y destino usa este uso?»,
  alimentado por `gitcron.json`.
- Día uno sin sorpresas: al instalar la versión, cada uso sigue con lo que tenía hasta que la persona
  cambie algo, y eso queda escrito en el archivo.

**Non-Goals:**
- Conversación, memoria o recuperación de fuentes: son de `retomar-trabajo-con-asistencia-contextual`.
- Usar los servidores MCP desde GitCron: sólo se conservan y se muestran.
- Modificar `opencode.json` o la configuración de los CLI; gestionar cuentas de suscripción.
- Definir claves propias de GitCron en el archivo.

## Decisions

### D1. Formato: el de OpenCode, sin extensiones
`gitcron.json` valida contra el esquema de OpenCode. Todo lo de GitCron entra en campos existentes:
`agent.<uso>` para cada uso, con nombres fijos (`gitcron-commit`, `gitcron-cartography`,
`gitcron-openspec-analysis`, `gitcron-temporal`, `gitcron-sdd`) y `description` que explica qué uso es. El
prefijo evita chocar con agentes de OpenCode si alguien copia el bloque entero. *Alternativas
descartadas:* un formato propio (se rompe con cualquier otra herramienta, que es lo que Ale no quiere);
LiteLLM `config.yaml` o Continue `config.yaml` (Ale no los usa, y ninguno cubre `mcp` y agentes a la vez);
una clave `gitcron` en el nivel superior (el esquema la rechaza).

### D2. Ubicación y mezcla
Global en `~/.config/gitcron/gitcron.json` (en Windows, `%USERPROFILE%\.config\gitcron\`, igual que
OpenCode); de repositorio en `<raíz>/gitcron.json`. Mezcla profunda por clave con prioridad del
repositorio, como OpenCode. La pantalla dice de qué archivo sale cada valor y escribe en el global salvo
que la persona elija el del repositorio.

### D3. Lectura y escritura
Lectura con `jsonc-parser` (comentarios y comas finales). Observación con `fs.watch` sobre la carpeta y
relectura con un pequeño retardo; si la relectura falla, se conserva la última configuración válida y se
muestra el error con línea. Escritura con `jsonc-parser.modify` + `applyEdits` sobre el texto: sólo cambia
el valor tocado, y los comentarios, el orden y los campos desconocidos quedan. Escritura atómica (archivo
temporal + renombrar); si el archivo cambió en disco desde la última lectura, se relee antes de editar.

### D4. Parámetros abiertos
Petición = parámetros conocidos (`temperature`, `limit.output` como `max_tokens`) + `provider.options`
fuera de las claves de conexión + `model.options` + la variante elegida, en ese orden de precedencia, y el
`agent.<uso>` encima. Lo desconocido se pasa tal cual en el cuerpo de la petición. `stream` va siempre explícito: Unsloth transmite en eventos si se omite. Validación contra una
copia del esquema empaquetada: un campo desconocido es advertencia, nunca error ni borrado. La copia se
actualiza con cada versión de GitCron; no se baja en tiempo de ejecución.

### D5. Secretos
Sustitución de `{env:NOMBRE}` y `{file:ruta}` en cualquier valor de texto, con la sintaxis de OpenCode.
`{env:}` se resuelve con `process.env` y, si falta, con las variables guardadas en `key-store` bajo un
espacio `env:<NOMBRE>` (cifradas; la interfaz sólo puede ver si existen, reemplazarlas y borrarlas). Las
claves ya guardadas de OpenRouter y Anthropic se exponen como `OPENROUTER_API_KEY` y `ANTHROPIC_API_KEY`
guardadas, y el archivo inicial las referencia así. *Alternativa descartada:* un `{secret:…}` propio;
rompería la compatibilidad del archivo.

### D6. Tipos de proveedor y resolución por uso
- Bloque `provider` con `npm` `@ai-sdk/openai-compatible` u OpenRouter: `text-client` con la URL, cabeceras
  y clave resueltas; lista por `GET /models`. Capacidad de carga sólo si el servidor expone la API nativa
  de LM Studio (se detecta, no se supone por el nombre).
- `@ai-sdk/anthropic`: la excepción que ya existe en `providers/claude.ts`.
- CLI de suscripción: identificadores reservados `claude-code`, `codex` y `antigravity` como proveedor en
  `model` (`codex/gpt-5.5`, por ejemplo); no se declaran en `provider`. Para texto se corre el CLI en modo no
  interactivo en un directorio temporal vacío, sin herramientas de escritura, prompt por stdin y salida
  JSON (forma exacta según tarea 1.3). Para agente, el runtime del hub.
`resolveModelFor(uso)` devuelve `{provider, model, params, destination, source}`; `destination` es
`this-machine | own-server | external-service` por la dirección resuelta (localhost; IP privada; resto), y
las suscripciones cuentan como `external-service`.

### D7. Sin caída a otro proveedor
Si el proveedor no responde, el uso falla con el motivo. Si otro proveedor declara el mismo conjunto de ids
de modelo, la pantalla ofrece usarlo ahora (una vez) o hacerlo la elección del uso (escribe el archivo).
*Alternativas descartadas:* cadena automática Unsloth → LM Studio → OpenRouter (manda contenido a un
destino no elegido); un campo de «dirección alternativa» dentro del proveedor (no existe en el formato).

### D8. Agente sobre un servidor propio: OpenCode lee la misma definición
Como `gitcron.json` tiene el formato de OpenCode, el proceso `opencode acp` recibe la configuración de GitCron
por la vía que OpenCode ofrezca para una configuración adicional (variable de entorno con ruta o contenido;
se mide en la tarea 1.2), y las variables guardadas en GitCron se pasan en el entorno de ese proceso. El
modelo de la sesión se elige como `<providerId>/<modelo>`. No se escribe nada en la configuración de
OpenCode.

### D9. Antigravity: adaptador estructurado con captura real antes que código
Se reemplaza el wrapper por un adaptador sobre `agy -p --output-format stream-json --model <m> --mode
accept-edits`, con reanudación por `--conversation`. El formato de eventos se fija con una captura real
saneada (tarea 1.1). Sin `--dangerously-skip-permissions`: si un comando necesita aprobación en modo no
interactivo, el adaptador lo reporta como motivo de detención.

### D10. Migración sin cambio de comportamiento
Primer arranque sin `gitcron.json`: se crea con `$schema`, `provider.lmstudio` (`localhost:1234`),
`provider.openrouter` con `{env:OPENROUTER_API_KEY}` si hay clave guardada, `model` = el modelo recordado
de la redacción, y entradas `agent.gitcron-temporal` y `agent.gitcron-cartography` con su elección actual.
Nada cambia hasta que la persona toca algo, y lo que estaba escondido en ajustes queda escrito. Si el
archivo ya existe, no se toca.

### D11b. El estándar de OpenAI como piso, las extensiones como capas
Pedido de Ale: que cumpla con el estándar de OpenAI. Se separan dos cosas que suelen confundirse:
- **El protocolo** es el de la API de OpenAI (`/models`, `/chat/completions`, Bearer, SSE, nombres y
  valores de parámetros). `text-client.ts` ya habla Chat Completions con Bearer y `max_tokens`; lo que hoy
  se sale del estándar es el catálogo de la redacción, que lee la API nativa de LM Studio (tipo de modelo,
  carga, contexto cargado, dispositivo) como si fuera la única fuente. Eso pasa a ser una capa opcional:
  primero `GET /models` estándar; si el servidor además responde la API nativa de LM Studio, se suman
  estado de carga y los controles de carga.
- **El archivo** no tiene estándar de OpenAI: OpenAI no publica un formato de configuración de clientes.
  El bloque `provider` con `npm: "@ai-sdk/openai-compatible"` de OpenCode es justamente la declaración de
  un endpoint con la API de OpenAI (`baseURL`, `apiKey`, `headers`), y por eso se mantiene D1.
Se usa Chat Completions y no Responses porque es lo que implementan todos los servidores de Ale (LM Studio,
Unsloth/llama.cpp, OpenRouter); si un proveedor declara la API Responses, queda como mejora posterior.
Los valores de parámetros se validan contra el estándar (advertencia con el valor esperado, D4); no se
normalizan en silencio.

### D12. MCP en `mcp.json` con la notación `mcpServers`
`~/.config/gitcron/mcp.json` y `<raíz>/.gitcron/mcp.json`, con `mcpServers` y los campos de Cursor
(`command`, `args`, `env`, `envFile`; `url`, `headers`) y `${env:NOMBRE}`. Misma lectura, escritura
puntual y observación que `gitcron.json` (D3). La conversión desde OpenCode: `type: "local"` +
`command: [cmd, ...args]` → `command` + `args`; `environment` → `env`; `type: "remote"` → `url` +
`headers`; `{env:X}` → `${env:X}`; `enabled: false` se conserva como comentario porque `mcpServers` no
tiene ese campo. *Alternativa descartada:* el bloque `mcp` de OpenCode dentro de `gitcron.json`; lo lee sólo
OpenCode.

### D11. Dónde se ve
Sección de ajustes «Motores y modelos»: proveedores por familia con disponibilidad y variables, modelos
(declarados y reportados), elección general y rápida, usos con su excepción, MCP, y «Abrir el archivo» /
«Mostrar en la carpeta». En cada uso, una línea con motor, modelo, destino y origen, con acceso a su
excepción. `AiModelControls` sólo con capacidad de carga.

## Risks / Trade-offs

- [OpenCode cambia su esquema] → la copia empaquetada se actualiza con cada versión; mientras tanto lo
  nuevo es advertencia, no error, y se pasa tal cual.
- [Dos procesos editan el archivo a la vez] → relectura antes de cada edición y escritura atómica; si el
  archivo cambió entre medio, se reaplica la edición puntual sobre el texto nuevo.
- [Variables del sistema que cambian sin reiniciar GitCron] → Windows no las propaga a procesos ya
  abiertos; la pantalla dice «del sistema al abrir GitCron» y ofrece guardarla en GitCron.
- [El stream de `agy` cambia entre versiones] → versión reportada; eventos desconocidos se cuentan y se
  ignoran; la conformance común corre sobre la captura.
- [Un CLI no expone lista de modelos] → se escribe el id a mano en el archivo o en la pantalla.

## Migration Plan

D10 en el primer arranque de la versión, sólo si el archivo no existe. Volver atrás: la versión anterior
ignora `gitcron.json` y el espacio `env:*` del baúl; las claves originales no se borran.

## Open Questions

- Nombre visible de las familias en inglés y chino (se decide al escribir i18n).
