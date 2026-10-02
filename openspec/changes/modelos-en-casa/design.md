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

*Medido el 2026-10-02 (tarea 4.3, «usar lo que tenías»):* `modify` con formato vuelve a formatear las líneas
donde cae la edición. Al agregar `provider.openrouter` después de `"casa": { "options": {…} }` escrito en una
línea, y `agent` después de `"mcp": { "x": {…} }`, desplegaba esos dos bloques ajenos. La escritura arma ahora
el tramo nuevo con la sangría de la línea donde va (`pointEdits` en `gitcron-config-writer.ts`) y sólo usa
`modify` para quitar una clave. Las pruebas de 3.3 no lo vieron porque sus archivos estaban desplegados.

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
| Codex 0.144.4 | `codex exec --json --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules -m <m> -`, prompt por stdin | JSONL: `item.completed` con `agent_message.text`, `turn.completed` con `usage` | 13 s | ~12,5 mil tokens | Sin `--ignore-user-config` y `--ignore-rules` carga el config.toml (MCP de la persona, que fallan sin sesión) y sus skills: ~21 mil tokens por la misma línea (medido 2026-10-01). **Un `item.completed` con `item.type: "error"` es un aviso, no un fallo** (p. ej. «Skill descriptions were shortened…»): la respuesta llega en el ítem siguiente; el fallo real viene como `type: "error"` y `turn.failed`, con el motivo de la API como JSON dentro del texto. Tratar el aviso como fallo tiró la primera redacción de Ale. **`-m` es obligatorio en la máquina de Ale:** su `~/.codex/config.toml` fija `gpt-6.1-sol`, que no está en su catálogo y da 400 «not supported when using Codex with a ChatGPT account». Catálogo vivo: `codex debug models` (campo `visibility: "list"`); `models_cache.json` puede estar viejo. |
| Antigravity 1.2.13 | `agy -p <prompt> --output-format json --mode plan --model <m> --print-timeout <n>s` | un JSON: `response`, `status`, `usage`, `conversation_id` | 16 s | ~13 mil tokens | Lista de modelos: `agy models` (id y nombre separados por tabulación). |

Ninguno escribió en la carpeta temporal.

*Medido al implementar el cliente de texto por CLI (2026-10-02, tarea 4.2):*
- **Antigravity no lee el pedido de stdin con `-p`**: toma la opción siguiente como pedido («-p took
  "--output-format" as its prompt») o `-` como texto literal. Por stdin entra con `-p= --input-format
  stream-json --output-format stream-json` y una línea `{"event":"user","message":{"role":"user","content":
  [{"type":"text","text":…}]}}`; la respuesta llega de a pedazos en `step_update` (`text_delta`) y entera
  en `result`. Con `--disable-slash-commands` avisa que `--mode plan` no tiene efecto, así que no se usa.
  Un pedido corto lo llevó a intentar un comando: se niega solo y `result` trae `denied_actions` con la
  respuesta vacía. La salida sin sesión no se pudo medir (cambiar la carpeta de la persona no le quita la
  sesión).
- **Claude Code**: `--tools=` y `--setting-sources=` pegados dan lo mismo que con el argumento vacío
  aparte (6,8 mil tokens), y no se pierden al pasar por el shell de Windows. Sin sesión (con
  `CLAUDE_CONFIG_DIR` vacío): `is_error: true` y «Not logged in · Please run /login».
- **Codex** sin sesión (`CODEX_HOME` vacío): cinco `type: "error"` «Reconnecting… n/5» y recién después
  `turn.failed` con «401 Unauthorized: Missing bearer». Los «Reconnecting» son reintentos: si después llega
  la respuesta, vale la respuesta.
- Cancelar o vencer el tiempo termina el árbol del proceso (`taskkill /T` en Windows: detrás de un acceso de
  npm el proceso real es hijo de `cmd.exe`) y espera a que cierre antes de devolver.

`resolveModelFor(uso)` devuelve `{provider, model, params, destination, source}`; `destination` es
`this-machine | own-server | external-service` por la dirección resuelta (localhost; IP privada; resto), y
las suscripciones cuentan como `external-service`.

### D7. Sin caída a otro proveedor
Si el proveedor no responde, el uso falla con el motivo. Si otro proveedor declara el mismo conjunto de ids
de modelo, la pantalla ofrece usarlo ahora (una vez) o hacerlo la elección del uso (escribe el archivo).
*Alternativas descartadas:* cadena automática Unsloth → LM Studio → OpenRouter (manda contenido a un
destino no elegido); un campo de «dirección alternativa» dentro del proveedor (no existe en el formato).

*Implementado en 4.3 (2026-10-02):* `resolveModelFor` devuelve esas alternativas y el error del uso las
nombra («"Unsloth CASA (túnel)" declara los mismos modelos: se puede elegir en gitcron.json»); nunca se llama
al otro. Los botones de «usarlo ahora» y «hacerlo la elección» son de la pantalla de cada uso (4.4).

### D8. Agente sobre un servidor propio: OpenCode por `run`, con los modelos que OpenCode conoce
*Revisado el 2026-09-29 tras migrar Ale a OpenCode 2.0.20 (decisión de Ale).* La v1 sumaba la configuración
de GitCron con `OPENCODE_CONFIG`; la v2 no: probadas `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`,
`OPENCODE_CONFIG_DIR` y `XDG_CONFIG_HOME`, ninguna agrega proveedores (la v2 corre un servicio de fondo
compartido y lee sólo la configuración global y el `opencode.json` de la carpeta y sus superiores). Además
su ACP ofrece 419 modelos sin los proveedores propios (`opencode models` lista 442).

Por eso:
- **Transporte:** `opencode run -m <proveedor>/<modelo>#<variante> --format json` en el repositorio, con la
  **entrada estándar cerrada** (sin eso se cuelga), `--session` para retomar. Eventos medidos:
  `step_start` y `text` (`part.text`); sin uso ni cierre en un pedido simple → «no informado». Qwen 3.8
  de `unslothpclocal` respondió en 22 s con la carga y en 5 s cargado, también con `#high`. Un modelo con
  menos de ~16k de contexto cargado falla: OpenCode manda ~15k tokens propios (LM Studio con 8k lo rechazó
  con 400); GitCron lo dice antes de lanzar si conoce el contexto.
- **Modelos:** como agente se ofrecen los que lista `opencode models`. Un proveedor que sólo está en
  `gitcron.json` figura «no disponible como agente» con la oferta de copiar su bloque a
  `~/.config/opencode/opencode.json` (vista previa, confirmación, edición puntual con `jsonc-parser` que
  conserva el resto). Los formatos son el mismo, así que el bloque se copia tal cual.
- **Formato:** el esquema publicado (`https://opencode.ai/config.json`) sigue siendo el de la v1, igual a
  la copia empaquetada (mismo sha256); no hay esquema v2 publicado (`/v2/config.json` da 404). La v2 lee el
  formato v1 y lo normaliza; D1 se mantiene.
- **Credenciales guardadas de OpenCode:** una clave en su almacén (`opencode auth`,
  `~/.local/share/opencode/auth.json`) le gana al `apiKey` del `opencode.json`, aunque éste diga
  `{env:…}`. Medido el 2026-09-30 en la notebook de Ale: `unslothpc` tenía guardada una clave vieja,
  distinta de `UNSLOTH_API_KEY`, y Unsloth respondía 401 «Invalid or expired API key» mientras curl con la
  variable daba 200; `unslothpclocal`, sin clave guardada, andaba. `opencode auth list` muestra el nombre
  visible («Unsloth CASA»), no el id. Por eso GitCron, al ofrecer un proveedor como agente o al copiar su
  bloque, SHALL avisar si el almacén de OpenCode tiene una clave para ese id y si difiere de la que resuelve
  la configuración (comparando sin mostrar valores), y ofrecer la orden `opencode auth logout <id>`.
- **Permisos:** `--auto` aprueba lo que no esté negado explícitamente; se usa con la confirmación del
  lanzador, igual que `acceptEdits`/`workspace-write` en Claude y Codex.

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

**Antes de la decisión** (cambiaba qué promete el lanzador): la documentación oficial dice que una regla
`permissions.allow` (por ejemplo `command(git)`) en `~/.gemini/antigravity-cli/settings.json` concede
comandos en `-p`; el issue 548 de google-antigravity/antigravity-cli (abierto) dice que `-p` la ignora.
*Medido el 2026-09-29 con autorización de Ale* (su archivo respaldado y restaurado con el mismo sha256): con
`permissions.allow: ["command(git)"]` el comando `git status --short` se rechazó igual en `-p`. Confirma el issue
548: en modo sin pantalla la única vía para correr comandos es `--dangerously-skip-permissions`. Una regla que
aprueba todo se descartó por la misma razón: quita la contención. Hasta que Ale decida, Antigravity se declara
con `runsCommands: false`: se ofrece para explorar y escribir, no para implementar con pruebas.

**Decisión de Ale (2026-09-29): opción B.** Antigravity se lanza con `--mode accept-edits` y
`runsCommands: false` hasta que su modo sin pantalla respete los permisos. Ver el requisito
«Antigravity se lanza para leer y escribir, sin correr comandos» (delta de pipeline-runtime-adapters).

### D10. Migración sin cambio de comportamiento
Primer arranque sin `gitcron.json`: se crea con `$schema`, `provider.lmstudio` (`localhost:1234`),
`provider.openrouter` con `{env:OPENROUTER_API_KEY}` si hay clave guardada, `model` = el modelo recordado
de la redacción, y entradas `agent.gitcron-temporal` y `agent.gitcron-cartography` con su elección actual.
Nada cambia hasta que la persona toca algo, y lo que estaba escondido en ajustes queda escrito. Si el
archivo ya existe, no se toca.

*Medido al implementarlo (2026-10-01, tarea 3.7):* el modelo recordado de la redacción vive sólo en memoria
mientras la app está abierta (`lib/ai-model-memory.ts`), así que no hay `model` que migrar y no se escribe
`agent.gitcron-commit`: la redacción sigue por su camino de siempre hasta que la persona lo configure. El
Agente Temporal guarda su proveedor en el almacenamiento cifrado (`ai.activeProvider`, OpenRouter si no hay)
y su modelo **por repositorio**; el archivo recibe el proveedor con su modelo por omisión y el de cada
repositorio queda donde está. Cartografía apagada se escribe con `disable: true` (campo del formato). Como
esos usos leen `gitcron.json` recién con 4.3, la migración no cambia ningún comportamiento hoy.

*Decidido por Ale al llegar a 4.3 (2026-10-01):* un archivo que ya existía puede no tener entrada para un uso
que antes andaba (el de Ale no tenía Cartografía, que usaba OpenRouter · deepseek desde `carto-ai.json`).
Ese uso no cae a la elección vieja ni se completa el archivo solo: la pantalla dice «Este uso no tiene modelo
en gitcron.json» y ofrece «Usar OpenRouter · deepseek…» con un botón, que escribe la entrada y, si falta, el
proveedor en el archivo global (`legacy-choice.ts`, canal `ai-use:adopt`). Las direcciones de los
proveedores de antes viven sólo en el módulo de configuración (`LEGACY_PROVIDER_BLOCKS`).

*El selector de LM Studio de la redacción y del análisis* sigue redactando cuando el uso no tiene modelo,
como «elección de la pantalla», pero por el proveedor `lmstudio` que declare el archivo: sin ese bloque no
hay dirección y el pedido falla con el motivo; la línea del uso ofrece agregarlo. Con modelo en el archivo,
manda el archivo. El selector pasa a escribir en el archivo con la elección por herramienta (4.5).

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

### D16. Una redacción por repositorio, en fila, que sobrevive a vistas y solapas (pedido de Ale, 2026-09-30)
Idea final de Ale: una IA que acompaña en todas las pantallas y sabe en qué repositorio está, sin perder el hilo
al moverse entre solapas; eso lo construye `retomar-trabajo-con-asistencia-contextual`. Esta pieza es la primera
y debe quedar compatible con ese cambio:
- **Estado por repositorio** en el renderer: un mapa `repoPath → { fase, inicio, draftId, estado en fila }` y un
  registro de pensamiento por `draftId` (hoy `lib/commit-draft-log.ts` guarda uno solo). Nada de un «draft»
  global.
- **Fila en el proceso principal:** `commit-ai:draft` deja de cortar la redacción anterior
  (`inFlightDraft?.abort()`); encola por orden de llegada, corre una por vez y avisa al renderer cuándo una pasa de
  «en fila» a «en curso». `commit-ai:cancel` recibe el `draftId` y corta sólo esa (en curso o en fila); sin
  `draftId` mantiene el comportamiento actual para los llamadores existentes.
- **Resultado por origen:** siempre por `updateRepoByPath(origen)`; si el repositorio de origen se cerró, no se
  escribe en ningún lado.
- **Sin corte al desmontar:** el panel deja de cortar al desmontarse, también al cambiar de repositorio; la
  protección de la tanda 08 (no cruzar mensajes) la da el punto anterior.
- **Aviso:** por la superficie de notificaciones de la aplicación (`setSuccess`/toasts existentes), nombrando el
  repositorio, sólo cuando termina con el repositorio fuera de la vista.
- **Límite declarado:** la carga y expulsión de modelos de LM Studio siguen siendo una a la vez; no entran en la fila.

### D17. Modelos e intensidad de pensamiento: la lista la da cada herramienta (pedido de Ale, 2026-10-01)
Ale quiere elegir entre los modelos que haya disponibles y la intensidad de pensamiento que ofrezca cada
herramienta (bajo, medio, alto, ultra…), sin una lista fija en GitCron. Fuentes medidas el 2026-10-01:

| Herramienta | Modelos | Intensidad | Cómo se pide |
|---|---|---|---|
| Codex 0.144.4 | `codex debug models` (sólo `visibility: "list"`; la caché puede tener modelos que la cuenta ya no admite: `gpt-6.1-sol` y `gpt-6-luna` responden 400 «not supported when using Codex with a ChatGPT account») | `supported_reasoning_levels` por modelo: `gpt-5.6-luna` low…max; `gpt-5.6-sol`/`terra` suman `ultra`; `gpt-5.5` hasta xhigh; y `default_reasoning_level` | `-c model_reasoning_effort=<nivel>` |
| Antigravity 1.2.13 | `agy models` (id y nombre; algunos ya traen el nivel en el id: `gemini-3.8-flash-high`) | `--effort low\|medium\|high\|max` | `--effort` |
| OpenCode 2.0.20 | `opencode models` | variantes del modelo | `-m proveedor/modelo#variante` |
| Servidores con la API de OpenAI | `GET /models` y el archivo | `reasoning_effort` del estándar (minimal, low, medium, high) | cuerpo del pedido |
| Claude Code 2.1.284 | por medir | por medir | por medir |

GitCron muestra, para el modelo elegido, sólo los niveles que esa herramienta declara para ese modelo, con su
nivel por omisión marcado; un nivel que el modelo no admite no se ofrece. La elección se guarda en
`gitcron.json` con campos del formato: el nivel en `agent.<uso>.options.reasoning_effort` (o la variante
`#nivel` cuando la herramienta usa variantes). La lista de modelos de Codex se toma del catálogo vivo, no de la
caché, por los modelos que la cuenta ya no admite.

### D18. Cuánto tardó y cuántos tokens gastó (pedido de Ale, 2026-10-01)
Al terminar una redacción el panel dice cuánto tardó y cuántos tokens se fueron, con cualquier motor.
- **El tiempo lo mide el proceso principal**, desde que el pedido empieza a correr hasta que termina: el que
  esperó en fila (D16) no suma la espera. Viaja en `commit-ai:draft-state` (`startedAt`, `finishedAt`), no se
  calcula en el renderer, que puede no haber estado mirando.
- **Los tokens salen de lo que informa cada motor**, sin estimar: el estándar de OpenAI con
  `stream_options.include_usage` (`prompt_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens`,
  `completion_tokens_details.reasoning_tokens`); Codex en `turn.completed.usage` (`input_tokens`,
  `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`; medido el 2026-10-01: 20 847 / 8 960 / 7 / 0).
  Lo que el motor no informa no se muestra, y si no informa nada se dice «sin conteo de tokens». Hasta ahora el
  panel sólo mostraba la línea si venían los tokens de pensar, así que un servidor que informaba entrada y
  salida pero no pensamiento no mostraba nada.

### D19. Historial de usos de IA por repositorio (pedido de Ale, 2026-10-01; diseño a cerrar en 4.6)
Ale quiere que quede guardado qué escribió la IA, quién, cuándo, cuánto tardó y cuánto gastó. Va pensado para
todos los usos de IA y no sólo la redacción, en línea con una IA en todas las pantallas que guarda estado por
repositorio. Propuesta a confirmar al empezar 4.6:
- Un registro por uso: uso (`gitcron-commit`, …), repositorio y rama, inicio y fin, motor, modelo y
  procedencia (D14, sin secretos), tokens (D18), resultado (texto propuesto, o el fallo o la cancelación) y
  destino (si terminó en un commit, cuál; si se descartó).
- Guardado fuera del repositorio, en la carpeta de datos de GitCron, separado por repositorio, para no ensuciar
  el árbol de trabajo ni mezclarse con lo que se versiona.
- Pendiente de decidir con Ale: si se guarda también lo enviado (el diff puede ser grande y tener datos
  sensibles), cuánto tiempo se conserva, y dónde se mira (un panel por repositorio, o junto a cada commit en
  Graph).

### D20. La IA tiene su color (pedido de Ale, 2026-10-01)
Todo lo que hace o escribió una IA se distingue de un vistazo, sin colores nuevos:
- **Violeta = IA.** `--color-accent-purple` ya se usaba sólo para eso (revisión de propuestas de un agente,
  marca «propuesto» en el diff). Se nombra como token de uso (`--color-ai`) apuntando a él.
- **Degradé de la IA:** del violeta al `--color-primary`, para bordes y fondos suaves de los bloques de IA (con
  `color-mix` a baja opacidad, como los degradés que ya tiene la app).
- **Mientras piensa, el texto brilla:** las frases y el estado «en vivo» llevan un brillo que recorre las
  letras de izquierda a derecha (texto recortado sobre un degradé que se desplaza), como los IDE de Codex,
  Claude y OpenCode. Sólo CSS; con `prefers-reduced-motion` queda quieto en violeta; con `forced-colors` vuelve
  al color del sistema (un texto transparente sobre fondo recortado desaparece en ese modo).
- **La autoría pasa a violeta:** «Lo escribió <modelo>, no la aplicación» dice quién escribió, no pide atención.
  El ámbar queda para lo que sí la pide.
- Se aplica primero en la preparación del commit; 4.4 lo lleva a las demás pantallas de uso.

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
