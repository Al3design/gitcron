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

*Medido en la tarea 1.4 (2026-09-29):* el esquema es draft 2020-12 y el único validador del repo (ajv 6,
transitivo) no lo soporta. No se suma dependencia: GitCron compara las claves de cada nivel que usa
(superior, `provider`, modelo, `limit`, `agent`) con las listas de propiedades del esquema empaquetado
(`electron/ai/config/opencode-config.schema.json`, con fecha y sha256 en su `.meta.json`), y valida los
tipos de los campos que consume. `gitcron.example.jsonc` y el `opencode.json` de Ale pasan; una clave
propia en el nivel superior se detecta. OpenCode, al leer, es tolerante: acepta esa clave igual.

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
  JSON. Para agente, el runtime del hub.

*Medido en la tarea 1.3 (2026-09-29), carpeta temporal vacía, pedido de una línea:*

| CLI | Orden | Salida | Tiempo | Contexto | Notas |
|---|---|---|---|---|---|
| Claude Code 2.1.284 | `claude -p --output-format json --tools "" --no-session-persistence --setting-sources "" --strict-mcp-config --disable-slash-commands --model <m>`, prompt por stdin | un JSON: `result`, `is_error`, `usage`, `total_cost_usd`, `modelUsage` | 4,5 s | ~7 mil tokens | Sin `--setting-sources ""` y `--strict-mcp-config` carga CLAUDE.md, skills y MCP de la persona: 131 mil tokens, 0,26 USD y 10 s por la misma línea. `--bare` no sirve: ignora la sesión de suscripción («Not logged in»). |
| Codex 0.144.4 | `codex exec --json --sandbox read-only --skip-git-repo-check --ephemeral -m <m> -`, prompt por stdin | JSONL: `item.completed` con `agent_message.text`, `turn.completed` con `usage` | 13 s | ~21 mil tokens | **`-m` es obligatorio en la máquina de Ale:** su `~/.codex/config.toml` fija `gpt-6.1-sol`, que no está en su catálogo y da 400 «not supported when using Codex with a ChatGPT account». Catálogo vivo: `codex debug models` (campo `visibility: "list"`); `models_cache.json` puede estar viejo. |
| Antigravity 1.2.13 | `agy -p <prompt> --output-format json --mode plan --model <m> --print-timeout <n>s` | un JSON: `response`, `status`, `usage`, `conversation_id` | 16 s | ~13 mil tokens | Lista de modelos: `agy models` (id y nombre separados por tabulación). |

Ninguno escribió en la carpeta temporal.
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
con `OPENCODE_CONFIG=<ruta de gitcron.json>`, y las variables guardadas en GitCron se pasan en el entorno de
ese proceso. No se escribe nada en la configuración de OpenCode.

*Medido en la tarea 1.2 (2026-09-29, captura `opencode-1.18.33-acp-config.sanitized.json`):*
`OPENCODE_CONFIG` (ruta, admite comentarios) y `OPENCODE_CONFIG_CONTENT` suman la configuración encima de la
del usuario, sin reemplazarla ni tocar su archivo. `session/new` no trae `models`: el modelo es una
`configOption` con `id: "model"` que arranca en `opencode/big-pickle`; se fija con
`session/set_config_option` (`configId: "model"`, `value: "<providerId>/<modelo>"`), que devuelve el valor
vigente. `session/set_model` responde `{}` sin confirmar: no se usa. Si `set_config_option` no devuelve el
modelo pedido, la sesión no arranca y se dice por qué.

### D9. Antigravity: adaptador estructurado con captura real antes que código
Se reemplaza el wrapper por un adaptador sobre `agy -p --output-format stream-json --model <m> --mode
accept-edits`, con reanudación por `--conversation`. El formato de eventos se fija con una captura real
saneada (tarea 1.1). Sin `--dangerously-skip-permissions`: si un comando necesita aprobación en modo no
interactivo, el adaptador lo reporta como motivo de detención.

*Medido en la tarea 1.1 (2026-09-29, capturas `agy-1.2.13-*`):* eventos `init` (modelo, cwd, herramientas),
`step_update` (`user_input`, `agent_response` con `usage`, `tool` con `ACTIVE`/`DONE`/`ERROR` y
parámetros) y `result` (`status`, `response`, `usage`, `denied_actions`). Leer y escribir funcionan con
`accept-edits`. **Correr comandos no:** en `-p` se rechazan solos, el paso queda en `ERROR`, stderr lo
explica, el proceso sale 0 y `result.status` dice `SUCCESS` con `denied_actions: [{action: "command"}]`.
`--sandbox` no lo cambia. Por eso el adaptador SHALL leer `denied_actions`: con un comando rechazado, la
corrida es `success: false` con ese motivo, aunque el estado diga `SUCCESS`. Retomar con
`--conversation` conserva el contexto (126 s contra 30 s de la corrida inicial).

**Decisión pendiente de Ale** (cambia qué promete el lanzador): la documentación oficial dice que una regla
`permissions.allow` (por ejemplo `command(git)`) en `~/.gemini/antigravity-cli/settings.json` concede
comandos en `-p`; el issue 548 de google-antigravity/antigravity-cli (abierto) dice que `-p` la ignora.
*Medido el 2026-09-29 con autorización de Ale* (su archivo respaldado y restaurado con el mismo sha256): con
`permissions.allow: ["command(git)"]` el comando `git status --short` se rechazó igual en `-p`. Confirma el issue
548: en modo sin pantalla la única vía para correr comandos es `--dangerously-skip-permissions`. Una regla que
aprueba todo se descartó por la misma razón: quita la contención. Hasta que Ale decida, Antigravity se declara
con `runsCommands: false`: se ofrece para explorar y escribir, no para implementar con pruebas.

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

### D13. Quién conversa y quién ejecuta (sugerencia de Codex, aceptada el 2026-09-29)
Una sola elección para la persona, adaptadores distintos por detrás:

| Uso | Conversa | Ejecuta herramientas |
|---|---|---|
| Redacción, Cartografía, análisis de versión, Temporal Agent | el modelo elegido (servidor o CLI) | nadie: se corren sin herramientas |
| Agente de SDD con CLI de suscripción | el modelo del CLI | el mismo CLI (Claude Code, Codex, Antigravity) |
| Agente de SDD con modelo de servidor | el modelo del servidor | OpenCode, con la configuración de GitCron (D8) |

No son roles: cualquier modelo va a cualquier uso. Es la respuesta a «¿qué programa toca mi repositorio?»,
y la pantalla la muestra en la confirmación.

### D14. Pedido efectivo con procedencia (sugerencia de Codex, aceptada)
Cada uso guarda en memoria el último pedido armado (dirección resuelta, modelo, parámetros) con la
procedencia de cada valor, calculada en la misma mezcla de D4 (archivo y bloque de donde salió). Se muestra
a pedido, sin secretos ni contenido del repositorio. No se persiste en disco. Si el proveedor rechaza el
pedido, el error lista los parámetros enviados fuera del estándar con su procedencia; no hay reintento que
los quite en silencio. La «versión» de la configuración es su `$schema` más la copia fechada del esquema
con la que valida GitCron (tarea 1.4): el formato no admite un campo de versión propio (D1).

### D15. Primero un recorrido completo angosto (sugerencia de Codex, aceptada)
Antes de generalizar, un recorrido de punta a punta con un servidor local (Unsloth por la red de la casa)
y un CLI (Codex): `gitcron.json` mínimo, redacción de commit con cada uno, pedido efectivo visible,
cancelar, cambiar de vista y volver con la elección conservada. Si la unificación falla en una de las dos
familias, se ve ahí y no después de construir importación, MCP y ajustes. Las tareas quedan ordenadas así.

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
