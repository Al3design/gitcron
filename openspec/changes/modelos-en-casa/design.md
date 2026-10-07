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

*Auditado en 6.1 (2026-10-04), importar:* un valor escrito a mano en el archivo de origen (la clave o una
cabecera de un proveedor de `opencode.json`; `env` y `headers` de un servidor MCP de Cursor, LM Studio u
OpenCode) no se copia. El plan pone `{env:NOMBRE}` (`${env:NOMBRE}` en `mcp.json`), al aplicar el valor se
relee del origen y va al baúl, y la pantalla ve sólo nombres (`electron/ai/config/literal-secrets.ts`). El
nombre propuesto (`<PROVEEDOR>_API_KEY`, `<PROVEEDOR>_<CABECERA>`, la variable de `env` tal cual,
`<SERVIDOR>_<CABECERA>`) lleva sufijo si ya lo ocupa otro valor en el baúl, en el sistema o en el mismo plan:
la primera versión pisaba una clave ya guardada y mandaba dos `Authorization` de proveedores distintos a la
misma variable. En la vista previa sólo se esconden los campos secretos; la primera versión escondía todo
texto (también `baseURL` y modelos) con una cadena fija en español que la pantalla comparaba. Los canales no
aceptan rutas de la pantalla: la primera versión dejaba leer cualquier archivo y escribir un `mcp.json` en
cualquier carpeta. La importación MCP va siempre al `mcp.json` global, como la de OpenCode al `gitcron.json`
global, y de cada servidor la pantalla ve el programa o el host, no los argumentos ni la dirección completa
(una URL de base de datos en los argumentos lleva contraseña).

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
  - *Auditoría 21–23 (2026-10-05).* El golpe final del margen (`SIGKILL` a la consola) **espera a que
    `taskkill` termine**. Si no, con la máquina cargada `taskkill` tarda en arrancar más que el margen, la
    consola muere primero, el programa queda sin padre y `taskkill /T` ya no lo encuentra: «Detener» dejaba
    al agente vivo escribiendo en el repositorio. La prueba del huérfano usa un margen de 1 ms para
    provocarlo siempre (sin la espera, falla; comprobado).

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

*Medido el 2026-10-04 antes de la 5.3 (OpenCode 2.0.20, capturas saneadas en
`electron/__tests__/fixtures/modelos-en-casa/opencode-2.0.20-*`):*
- **La lista de modelos no sale de `opencode models`**: sin terminal sigue sin imprimir nada. Sale de la API de su
  servicio: `opencode api model.list --param location[directory]=<repo>` devuelve JSON (447 modelos en la máquina
  de Ale, 18 de sus proveedores propios) con `providerID`, `id`, `name`, `variants` (`[{id: "low"}, …]`),
  `limit.context`, `enabled` y `status`. **También devuelve `headers` y `settings` con los valores ya resueltos**
  (la clave de Unsloth y las dos cabeceras de Cloudflare): esa salida se lee sólo en el proceso principal, se
  descartan esos campos antes de cualquier otro paso y nunca se guarda ni se registra cruda. En Git Bash, las rutas
  `/api/…` necesitan `MSYS_NO_PATHCONV=1`; desde Node no aplica.
- **`run --format json`** emite una línea por evento, todas con `sessionID`: `step_start`; `tool_use` con
  `part.tool` (`read`, …) y `part.state` (`status`, `input`, `output`); `step_finish` con `part.reason`
  (`tool-calls`, …), `cost` y `tokens` (`input`, `output`, `reasoning`, `cache.read`/`write`); y `text` con
  `part.text`. El último paso puede terminar sin `step_finish`: el cierre es el fin del proceso. Leer un archivo y
  contestar tardó 22 s con Qwen 3.8 de `unslothpclocal` en nivel `low`, con 14,3k tokens de entrada en el primer
  paso (casi todo de OpenCode).
- **Las credenciales guardadas** están en la carpeta de datos que da `opencode debug paths` (en Windows,
  `~/.local/share/opencode/auth.json`).
- **Auditado en la primera parte de 5.3 (2026-10-05):** (1) **la primera consulta de una carpeta que OpenCode no
  conocía devuelve `{"data":[]}`** (lista vacía válida, estado 0) y a los ~4 s trae los 447: una lista vacía se
  reintenta y, si sigue vacía, es un fallo de la consulta, nunca «OpenCode no conoce este modelo»; lo mismo con una
  respuesta vacía, cortada o que no es la lista. (2) **Node une los argumentos de un `.cmd` sin entrecomillar**: una
  carpeta con espacio rompía la consulta (OpenCode ni recibía el pedido) y un `&` en el nombre empezaba otro
  comando; el runner entrecomilla lo que lo necesita y no pasa `"` ni `%`. (3) **Al cortar por tiempo o con
  «Detener», Node mata la consola (`cmd`) y no el programa que lanzó**: `opencode.exe` seguía vivo y trabajando
  (con `--auto`, escribiendo en el repositorio); el runner mata el árbol con `taskkill /T`. (4) La variante
  explícita del uso es `agent.<uso>.variant`, no `options.variant`. (5) Una función `…ForTesting` en código de la
  app; las pruebas simulan el módulo. No se pudo hacer el recorrido real con Qwen ese día: ni el servidor de la
  casa (`192.168.1.7`) ni el túnel contestaban, y no es un fallo del adaptador (las capturas son del 2026-10-04).
- **Medido el 2026-10-05 antes de la segunda parte de 5.3** (en una carpeta temporal con un proveedor de prueba,
  sin tocar la configuración de Ale): (1) **el servicio de OpenCode resuelve `{env:NOMBRE}` con sus propias
  variables**: una variable que existe sólo en el proceso que consulta (o sólo en el baúl de GitCron) le llega vacía;
  (2) **un `opencode.json` nuevo o cambiado no se ve hasta `opencode reload`**; (3) `api … --standalone` no
  contestó la lista; (4) `opencode auth logout <id>` sin la credencial abre un selector interactivo, así que GitCron
  no puede correrlo solo; (5) `opencode service status` imprime la dirección del servicio cuando corre. El almacén
  de credenciales es `{ <id>: { type: "api", key } }` (en la máquina de Ale hay uno para `unslothpc`). El runner de
  GitCron lanza procesos con un entorno reducido: si un `opencode run` o `api` arrancara el servicio compartido, ese
  servicio nacería sin las variables de la persona.
- **Auditado en la segunda parte de 5.3 (2026-10-05):** «el servicio corre» se decidía por cualquier texto en la
  salida de `opencode service status`; ahora sólo cuenta una dirección (`http://…`), que es lo medido. Falta todavía
  retomar sesiones (tanda propia) y el recorrido real con Qwen.
- **Medido el 2026-10-06 antes de retomar sesiones** (OpenCode 2.0.20, modelo gratis de su servicio
  `opencode/ling-3.1-flash-free` en una carpeta temporal, sin `--auto`; capturas
  `opencode-2.0.20-resume-*`): `run --session <id>` con el mismo `-m` **retoma**: devuelve el mismo `sessionID`
  y recuerda lo de la corrida anterior (le pedí recordar 7341 y contestó 7341; 5 s la primera, 2 s la segunda). El
  `sessionID` tiene la forma `ses_…`. **Una sesión que no existe no se avisa como tal**: sale 1 con un único evento
  `{"type":"error","sessionID":<el pedido>,"error":{"type","message",…}}` que habla de otra cosa (ese día, el
  límite del plan gratis); GitCron muestra el mensaje y no lo traduce a «sesión inexistente». El servidor de la
  casa siguió sin contestar: el recorrido con Qwen sigue pendiente.
- **La instrucción va por la entrada estándar**, que se cierra al terminar de escribirla: `run` la toma como
  mensaje (probado con dos renglones y comillas). En la máquina de Ale OpenCode es `opencode.CMD` (instalado con
  pnpm) y corre por la consola, así que la instrucción no va como argumento; los argumentos son fijos salvo el
  modelo y la sesión, que se validan antes.

*Auditoría de la continuación de sesiones (2026-10-07, tanda 27):*
- El descubrimiento productivo devuelve `{ success, data }`, no una lista directa. El mock de la tanda
  devolvía una lista y escondía que «Continuar esta sesión» nunca aparecía en la app. La prueba del formulario
  consume ahora la misma respuesta que el IPC; el recorrido e2e usa preload, IPC e historial SQLite reales.
- `reasoningEffort` era redactado por el sanitizador de persistencia por contener «reasoning»: una sesión
  guardada volvía con `[REDACTED]` en vez de su nivel. Es metadato de configuración y se conserva, igual que
  `reasoningVisibility`; el razonamiento privado y las claves siguen redactados. Se comprobó con una fila
  antigua sin campos nuevos y una fila con modelo, nivel e identificadores, leídas por `PipelineRepository`.
- Dos pedidos durante el arranque asíncrono podían abrir dos procesos antes de registrar la sesión viva.
  El hub reserva la carpeta antes de esperar evidencia o al adaptador y libera la reserva aun si falla.
  La prueba concurrente falla sin esa reserva. El canal tampoco continúa si falla el arranque del servicio
  de OpenCode; su mock apuntaba a un módulo distinto del import productivo y fue corregido.
- El método `resume` del adaptador exige una instrucción en su contrato tipado. La continuación por el hub
  conserva modelo, nivel, id de herramienta y vínculo con la corrida anterior. Capturas de OpenCode y
  Antigravity pasan por normalizadores, adaptadores y proyección; un evento `error` de OpenCode conserva
  el mensaje del proveedor y fija desenlace fallido aunque el proceso termine con cero.
- Cambiar de conversación descarta el formulario anterior; un rechazo del IPC deja reintentar; Escape no
  simula cancelar un pedido ya enviado. Los errores se muestran traducidos en es/en/zh. El aviso distingue
  editar archivos de correr comandos según las capacidades declaradas: Antigravity no promete comandos.
- `e2e/tests/continuar-sesion.e2e.ts` continúa una conversación sembrada en un repositorio temporal con
  un CLI simulado y comprueba foco, argumentos recibidos, modelo/nivel originales, actividad y vínculo.
  Los motores simulados viven sólo en el PATH del perfil de prueba; no se usan cuentas, configuración
  personal ni el servicio real de OpenCode. Las capturas mostraron que la leyenda nueva comprimía el nombre
  del motor en el panel lateral: fecha y procedencia deben ocupar renglones propios.
- Se retiraron temporalmente los arreglos para comprobar los fallos de regresión; evidencia en
  `tmp/auditoria-27-ui-*-rojo.log`, `tmp/auditoria-27-backend-*-rojo.log` y
  `tmp/auditoria-27-permisos-rojo.log`. En ese momento faltaba el recorrido real con Qwen:
  la prueba e2e del CLI simulado no lo reemplazaba. Se realizó después, como se registra abajo.

*Recorrido real desde la notebook por Cloudflare (2026-10-07, pedido de Ale):*
- Se usa `unslothpc`, configurado tanto en DSH como en OpenCode y GitCron con
  `https://llm.aledesign.dev/v1`, el modelo `unsloth/Qwen3.8-27B-GGUF` y referencias a
  `UNSLOTH_API_KEY`, `CF_ACCESS_CLIENT_ID` y `CF_ACCESS_CLIENT_SECRET`. El catálogo remoto respondió
  HTTP 200 y declaró Qwen cargado. `unslothpclocal` es el acceso por LAN; desde la notebook se comprueba
  el mismo modelo del servidor de la PC por el proveedor del túnel, según la instrucción actual de Ale.
- El perfil aislado de GitCron cambia HOME/USERPROFILE y por eso el CLI no encontraba el servicio de
  OpenCode que ya estaba abierto: `service status` no daba dirección y `model.list` vencía. Con el entorno
  normal, el catálogo dio 447 modelos (tras una primera respuesta vacía) y reconoció Qwen remoto.
  `--server` explícito requiere la contraseña interna del servicio y no reemplaza su descubrimiento.
  La comprobación manual mantiene aislados GitCron y el repositorio, pero el delegado del CLI conserva
  únicamente las rutas de usuario de OpenCode para reutilizar el servicio y su autenticación existentes.
  No se inicia, detiene ni reinicia ese servicio; no se modifican las configuraciones personales.
- Primera corrida real: `pipelineRuntime.start` productivo, con la clave devuelta por `aiUse.status`
  (sin inventar `expectedModel`), motor OpenCode 2.0.20 y el modelo del túnel. Qwen leyó `semilla.txt`,
  escribió `comprobacion-qwen.txt` y recordó 762941. La prueba verificó el contenido escrito en disco.
  En la repetición final el arranque respondió a los 7,3 s y la corrida terminó a los 56,1 s desde el pedido.
- Continuación desde el formulario visible de SDD: se pidió el código sin releer archivos. Respondió
  exactamente `762941`, con otra corrida de GitCron y el mismo id de OpenCode
  `ses_ee9999f5cffehoH9NXL2jQdhP1`, el mismo modelo y `continuesSessionId` apuntando a la primera corrida.
  El recorrido completo hasta la segunda respuesta tardó 62,5 s desde el pedido inicial.
- Comprobación manual reutilizable (requiere Windows, OpenCode abierto y el proveedor remoto configurado):
  `node scripts/e2e.mjs run qwen-tests/qwen-remoto.e2e.ts --config e2e/qwen-remoto.config.ts`.
  Está separada de la suite habitual sin servidores. Evidencia: `tmp/qwen-remoto-recorrido-final.log`
  y las capturas de primera corrida, formulario y continuación. Esto completa la 5.3; no completa la 7.1,
  que incluye importación, edición manual, otros usos/motores y comprobaciones con Ale.

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

*Implementado en 5.2 (2026-10-05), auditado con una corrida real:* Antigravity 1.2.17 (las capturas son de la
1.2.13, así que figura «sin verificar» pero se lanza) leyó un archivo en una carpeta temporal y contestó en 24 s con
24k tokens de entrada. Es un `.exe`, no pasa por la consola: la instrucción va como argumento de `-p` sin riesgo de
inyección.

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

*Medido el 2026-10-04 para «copiar para otra herramienta» (tarea 6.2), en las fuentes de cada uno:*
- **El estándar de MCP** ([especificación](https://modelcontextprotocol.io/specification/versioning), versión
  vigente `2026-07-28`, repositorio `modelcontextprotocol/modelcontextprotocol`) define dos transportes: `stdio` (el
  cliente lanza el servidor como subproceso) y Streamable HTTP (un punto de entrada que recibe POST). El HTTP+SSE de
  `2024-11-05` está **deprecado** desde `2025-03-26` ([registro de deprecados](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)).
  La especificación **no define un archivo de configuración del cliente**: `mcpServers` con `command`, `args` y
  `env` nace en `claude_desktop_config.json`, el ejemplo de la [guía oficial](https://modelcontextprotocol.io/docs/develop/connect-local-servers).
  Lo que sí publica MCP para describir un servidor es el `server.json` de su
  [registro](https://github.com/modelcontextprotocol/registry) (esquema `2025-12-11`): `packages` con
  `transport.type` `stdio`, `remotes` con `type` `streamable-http` o `sse`, y variables y cabeceras con
  `isSecret`. Sirve para publicar un servidor, no para configurar un cliente; no es un destino de la copia.
- **Claude Code** (`.mcp.json` y `claude mcp add-json`): `mcpServers`, `type` `stdio` | `http` | `sse` | `ws`
  (`streamable-http` es otro nombre de `http`), obligatorio con `url`; variables como `${NOMBRE}` o
  `${NOMBRE:-valor}`; **no entiende `${env:NOMBRE}`**: lo manda tal cual.
- **VS Code** (`.vscode/mcp.json`): `servers`, `type` obligatorio (`stdio` | `http` | `sse`; `http` cae a SSE si el
  servidor no lo admite), `command`/`args`/`env`/`envFile`/`cwd` o `url`/`headers`; variables `${env:NOMBRE}` y
  `${input:id}` (con `inputs` y `password: true` para pedir un secreto).
- **OpenCode** (`opencode.json`): `mcp`, `type` `local` (con `command` como lista, `environment`, `cwd`) o `remote`
  (`url`, `headers`, `oauth`), más `enabled` y `timeout`; variables `{env:NOMBRE}`.
- **Cursor** y **LM Studio**: la misma notación que `mcp.json` de GitCron (`type: "stdio"` opcional, remoto por
  `url`), variables `${env:NOMBRE}`: se copia tal cual.

Por eso la copia convierte, además de la envoltura, **las referencias** (`${env:X}` → `${X}` en Claude Code,
`{env:X}` en OpenCode, igual en VS Code) y **el tipo**: un `type` del servidor se respeta; sin él, `command` es
`stdio` y `url` es Streamable HTTP (`http`), el transporte del estándar, y la vista previa lo dice para que un
servidor sólo SSE se corrija a mano.

*Auditado en 6.2 (2026-10-05):* el canal que arma la vista previa devolvía a la pantalla todo el plan, incluido el
texto del portapapeles con la dirección completa (contraseña y tokens de consulta sin tapar). Lo completo existe
sólo en el proceso principal y va directo al portapapeles; la pantalla recibe la vista previa tapada.

### D13. Quién conversa y quién ejecuta (sugerencia de Codex, aceptada el 2026-09-29)
Una sola elección para la persona, adaptadores distintos por detrás:

| Uso | Conversa | Ejecuta herramientas |
|---|---|---|
| Redacción, Cartografía, análisis de versión, Temporal Agent | el modelo elegido (servidor o CLI) | nadie: se corren sin herramientas |
| Agente de SDD con CLI de suscripción | el modelo del CLI | el mismo CLI (Claude Code, Codex, Antigravity) |
| Agente de SDD con modelo de servidor | el modelo del servidor | OpenCode, con la configuración de GitCron (D8) |

No son roles: cualquier modelo va a cualquier uso. Es la respuesta a «¿qué programa toca mi repositorio?»,
y la pantalla la muestra en la confirmación.

*Implementado en 5.1 (2026-10-04), auditado:* el lanzador de SDD no tiene lista de motores: el motor sale del
modelo del uso `gitcron-sdd` (`claude-code/…` Claude, `codex/…` Codex, `antigravity/…` Antigravity, un proveedor de
`gitcron.json` OpenCode), que se elige en el mismo lanzador con el selector de todas las pantallas (cualquier
modelo de cualquier proveedor o CLI; Ale, 2026-10-04: «elegir el modelo que quiera usar, por el servidor que
elija»). Qué se lanza lo resuelve el proceso principal (`resolveAgentFor`); la pantalla devuelve la `launchKey`
que mostró y, si el archivo cambió, no se lanza nada; la confirmación de escritura nombra motor, modelo, nivel y
quién ejecuta, y se desmarca si la elección cambia. El nivel viaja como `--effort` (Claude) o
`-c model_reasoning_effort` (Codex). Antigravity y OpenCode dicen que todavía no se lanzan (5.2, 5.3), sin otro
motor en su lugar. La auditoría encontró: un arranque que leía el `gitcron.json` global real de la máquina en las
pruebas (en la app, el por omisión en lugar del que está en uso), `expectedModel` opcional (sin él no se
comparaba nada), la confirmación que seguía tildada después de cambiar de modelo, «Volver a comprobar» borrado, y
que elegir escribía en el global aunque el repositorio declarara la entrada del uso, donde no cambiaba nada (el
destino de la elección se decide por el origen de `agent.<uso>.model`, no del objeto, para todos los usos).

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
| Claude Code 2.1.284 | sin orden para listar: alias `fable`, `opus`, `sonnet`, `haiku` o el nombre completo (`modelUsage` de la salida JSON trae el que respondió) | `--effort low|medium|high|xhigh|max`, la misma lista para todo modelo; no declara el de por omisión | `--effort` |

*Medido el 2026-10-02 (antes de 4.5):* capturas recortadas en `electron/__tests__/fixtures/modelos-en-casa/`. Codex
hoy trae seis modelos, cuatro con `visibility: "list"`; `gpt-5.6-sol` viene por omisión en `low`. La caché ya no
tiene `gpt-6.1-sol` (el catálogo se actualizó); la captura de la caché lo conserva con la forma del 2026-10-01
para probar que un modelo de la caché que la cuenta no admite no se ofrece. En Claude Code un nivel desconocido
no falla: avisa por stderr, usa el de por omisión y contesta, así que GitCron no puede mandar uno que no esté en
la lista. `opencode models` (2.0.20) no imprime nada fuera de una terminal, ni con `--standalone`: OpenCode no
corre usos de texto (D13), así que su lista queda para el lanzador del agente de SDD (grupo 5).

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

*Decidido por Ale el 2026-10-02 (antes de 4.6):*
- **Lo enviado se guarda completo**: el pedido entero que se le mandó al modelo (instrucciones y contenido:
  el diff, las notas de la versión, el código de Cartografía). Nunca claves, valores de cabeceras ni
  variables: el pedido efectivo (D14) se guarda como ya se muestra, con procedencias.
- **Se conserva para siempre**: no se borra nada solo; se puede vaciar a mano el historial de un repositorio
  desde la pantalla, con confirmación.
- **Se mira en un panel por repositorio**: una vista más del repositorio («Historial de IA»), con todos los
  usos y filtros por uso y resultado. No va junto a cada commit en Graph.
- Va en la base SQLite de la carpeta de datos de GitCron (la de las predicciones y la caché de Cartografía),
  con una migración nueva; nada se escribe en el repositorio.

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

*Ampliado a pedido de Ale (2026-10-06):* el violeta se queda como el color de la IA, pero la IA pasa a tener un
**degradé de varios colores suaves**, como el marco de la pantalla de perfiles de Chrome. Reemplaza al degradé
violeta → `--color-primary` de arriba.
- **Colores propios de la IA:** violeta, azul, verde agua y rosa, como tokens `--color-ai-*` con `light-dark()`.
  No se usan los colores que ya significan algo (rojo de error, ámbar de atención, verde de agregado, naranja de
  modificado): mezclados en la IA confundirían lo que avisan.
- **Contenedores de IA:** borde con el degradé y, adentro, un velo muy suave de esos colores que nace de las
  esquinas (≤ 10 % de opacidad), sobre el fondo de siempre. Una sola clase compartida (sucesora de `.ai-panel`).
- **Letras:** el degradé va sólo en títulos y marcas (seminegrita o más, tamaño `sm` o mayor), nunca en el texto
  corrido ni en metadatos chicos. **Cada color del degradé cumple 4,5:1** contra `--color-bg-base`,
  `--color-bg-surface` y `--color-bg-overlay` en los dos temas, y lo comprueba una prueba que lee los valores de
  `app/globals.css`. Con `forced-colors` vuelve al color del sistema; sin soporte de texto recortado, al violeta.
- **El brillo de «pensando»** recorre el mismo degradé de varios colores; con `prefers-reduced-motion` queda
  quieto.

### D11. Dónde se ve
*Ampliado a pedido de Ale (2026-10-03):* la sección se piensa como la del Agente Temporal, para que nada
obligue a abrir `gitcron.json`: la clave de cada proveedor se carga desde la pantalla (al baúl, D5) y, donde
hay capacidad de carga, el contexto y el tiempo de carga del modelo se eligen y se guardan ahí. El archivo
sigue siendo la fuente y se puede editar a mano; la pantalla lo escribe con escritura puntual (D3). La sección
va antes de los agentes de SDD (grupo 5).

Sección de ajustes «Motores y modelos»: proveedores por familia con disponibilidad y variables, modelos
(declarados y reportados), elección general y rápida, usos con su excepción, MCP, y «Abrir el archivo» /
«Mostrar en la carpeta». En cada uso, una línea con motor, modelo, destino y origen, con acceso a su
excepción. `AiModelControls` sólo con capacidad de carga.

*Auditado en 4.4 (2026-10-02):* el catálogo, la carga y la expulsión se piden **por uso** (`{ use, repoPath }`)
y el proceso principal resuelve el servidor con `loadServerFor`: el del proveedor del uso o, sin modelo, el
`lmstudio` del archivo. La primera versión de la tanda resolvía siempre con el uso de la redacción, así que el
análisis de versión le habría pedido la lista de LM Studio al servidor de la redacción (en la máquina de Ale,
Unsloth). El renderer ya no manda direcciones.

*Rediseño a pedido de Ale (2026-10-05, tandas 24 y 24b):* la sección son cinco grupos que se abren y cierran
(qué modelo usa cada cosa, proveedores y modelos, el archivo, importar desde OpenCode, MCP), cada uno con su
resumen visible cerrado; las filas de usos y proveedores se despliegan; el selector de modelo se abre dentro de
la fila que lo pidió; agregar proveedor o modelo se despliega en el lugar; `gitcron.json` se edita desde la
sección (el proceso principal decide la ruta, no guarda con error de sintaxis, con un cambio hecho afuera ni
con una clave escrita a mano, y no manda el texto si encuentra una clave, aunque el archivo esté roto). Los
modelos salen de un **catálogo en el proceso principal** (`electron/ai/config/model-catalog.ts`): se llena al
arrancar, cuando cambia el archivo y cada 10 minutos, con consultas en paralelo; contesta al instante y un
servidor que no responde conserva su lista «sin confirmar». La lista de proveedores sale siempre del archivo de
ese pedido (el catálogo sólo aporta lo último que se supo); la clave de un servidor es id + dirección.
- *Auditoría 24 y 24b.* (1) El aviso de catálogo nuevo **no lleva datos** y el selector vuelve a pedir; la
  primera versión mandaba la lista con otra forma y el selector se caía, sin que las pruebas lo vieran porque
  los mocks copiaban los tipos mal declarados: los mocks de un canal tienen la forma de lo que el proceso
  principal manda. (2) Ese aviso **sólo refresca las listas**, no reelige: abrir el selector dispara una
  actualización de fondo, así que reelegir borraba lo que la persona estaba eligiendo a los pocos segundos.
  (3) Un proveedor al que todavía no se le preguntó no tiene fecha de consulta y dice «sin confirmar», no «no
  respondió». (4) El catálogo arma su contexto con el baúl en el momento (`setModelCatalogContextProvider`):
  sin eso, al arrancar consultaba sin clave y los servidores quedaban caídos.

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
