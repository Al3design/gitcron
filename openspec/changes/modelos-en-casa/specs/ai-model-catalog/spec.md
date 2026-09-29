# Spec Delta

## Purpose

Que la persona elija una vez con qué motores y modelos trabaja GitCron —suscripciones por CLI o servidores
por API, propios o externos— en un archivo propio de GitCron con el formato estándar de configuración de
OpenCode, editable a mano y reflejado en la pantalla, con los secretos fuera del archivo y el destino del
contexto siempre declarado.

## ADDED Requirements

### Requirement: GitCron tiene su propio archivo de configuración en el formato de OpenCode
GitCron SHALL leer su configuración de IA de un archivo propio, `gitcron.json`, en la carpeta de
configuración del usuario (`~/.config/gitcron/`), y opcionalmente de un `gitcron.json` en la raíz del
repositorio abierto que se superpone al global, con la misma regla de mezcla que OpenCode aplica a sus
archivos global y de proyecto. El archivo SHALL seguir el esquema de configuración publicado de OpenCode
(`$schema: https://opencode.ai/config.json`), admitir comentarios y comas finales como ese esquema declara,
y usar sus campos sin agregar claves propias de GitCron: `provider` (proveedores y modelos), `model` y
`small_model` (elección general y rápida) y `agent` (una entrada por uso de GitCron). Un bloque
`provider` copiado entre `opencode.json` y `gitcron.json` SHALL significar lo mismo en los dos.

El fundamento es que la persona ya mantiene su configuración en ese formato, y un formato a medida de
GitCron quedaría incompatible con cualquier otra herramienta el día que cambie. Medido el 2026-09-29: el
esquema rechaza claves desconocidas en el nivel superior, y todo lo que GitCron necesita entra en campos
que ya existen.

#### Scenario: Primer arranque sin archivo
- **WHEN** no existe `~/.config/gitcron/gitcron.json`
- **THEN** GitCron lo crea con `$schema` y la configuración que hoy tiene en uso, y lo informa con la ruta

#### Scenario: Bloque copiado desde OpenCode
- **WHEN** la persona pega en `gitcron.json` el bloque `provider.unslothpc` de su `opencode.json`
- **THEN** GitCron muestra ese proveedor con su URL, sus modelos y sus parámetros, sin conversión

#### Scenario: Archivo del repositorio
- **WHEN** el repositorio abierto tiene un `gitcron.json` que elige otro modelo para un uso
- **THEN** en ese repositorio vale la elección del archivo del repositorio y la pantalla dice de qué archivo sale

### Requirement: El archivo y la pantalla dicen lo mismo
GitCron SHALL observar el archivo: un cambio guardado a mano SHALL reflejarse en la pantalla sin
reiniciar. Un cambio hecho desde la pantalla SHALL escribirse en el archivo conservando comentarios,
orden, formato y todo campo que GitCron no conozca. Si el archivo no se puede interpretar, GitCron SHALL
mostrar el error con archivo, línea y motivo, SHALL seguir con la última configuración válida declarándolo,
y SHALL NOT sobrescribir el archivo.

#### Scenario: Edición a mano
- **WHEN** la persona cambia la temperatura de un modelo en el archivo y guarda
- **THEN** la pantalla muestra la temperatura nueva y el próximo pedido la usa

#### Scenario: Edición desde la pantalla
- **WHEN** la persona elige otro modelo para un uso desde GitCron
- **THEN** el archivo cambia sólo en ese valor y sus comentarios siguen donde estaban

#### Scenario: Archivo roto
- **WHEN** el archivo tiene un error de sintaxis
- **THEN** la pantalla muestra dónde está el error, sigue con la última configuración válida y dice que lo está haciendo

### Requirement: Los proveedores por API hablan el estándar de la API de OpenAI
Todo proveedor del bloque `provider` que no sea de protocolo propio SHALL usarse con la API de OpenAI tal
como está publicada: modelos por `GET {baseURL}/models`, generación por `POST {baseURL}/chat/completions`
con `messages`, autenticación `Authorization: Bearer <clave>`, streaming por eventos SSE terminados en
`[DONE]` —con `stream` enviado siempre de forma explícita, `true` o `false`—, y parámetros con sus nombres
y valores de esa API (`temperature`, `top_p`, `max_tokens` o
`max_completion_tokens`, `stop`, `reasoning_effort` con `minimal | low | medium | high`, entre otros). Lo
que el servidor agregue por encima (cabeceras de Cloudflare Access, carga de modelos de LM Studio) SHALL
tratarse como extensión opcional, detectada y nunca requerida. Las variables de entorno convencionales de
OpenAI (`OPENAI_API_KEY`, `OPENAI_BASE_URL`) SHALL reconocerse para el proveedor `openai`. Un valor que no
coincide con el estándar (por ejemplo `reasoning_effort: "High"`) SHALL mostrarse como advertencia con el
valor esperado, y SHALL enviarse tal como está escrito salvo que la persona acepte la corrección.

El fundamento es que es el único contrato que cumplen a la vez OpenRouter, LM Studio, Unsloth, llama.cpp,
vLLM y la propia OpenAI: construir sobre él y no sobre particularidades de un servidor es lo que evita que
un cambio de servidor rompa GitCron. Medido el 2026-09-29: `opencode.json` de Ale declara
`reasoning_effort: "High"`, fuera de los valores del estándar. LM Studio y Unsloth exponen `/v1/models`,
`/v1/chat/completions` y además `/v1/responses` y `/v1/messages`; Cursor sólo admite un servidor con Chat
Completions; VS Code deja elegir entre Chat Completions, Responses y Messages por proveedor. Unsloth
responde en streaming cuando el pedido omite `stream` (issue 5047 de unslothai/unsloth), al revés del
estándar: mandarlo siempre evita depender de ese comportamiento. Unsloth lista en `/v1/models` sólo los
modelos cargados, y LM Studio también los descargados.

#### Scenario: Pedido sin streaming a Unsloth
- **WHEN** GitCron pide una respuesta completa a un servidor Unsloth
- **THEN** el pedido lleva `stream: false` y la respuesta se lee como JSON, no como eventos

#### Scenario: Servidor compatible cualquiera
- **WHEN** la persona declara un servidor compatible con OpenAI que GitCron no conoce por nombre
- **THEN** GitCron lista sus modelos y redacta con él usando sólo la API estándar

#### Scenario: Valor fuera del estándar
- **WHEN** un modelo declara `reasoning_effort: "High"`
- **THEN** la pantalla advierte que el estándar espera `high` y ofrece corregirlo en el archivo, sin cambiarlo solo

#### Scenario: Variables convencionales de OpenAI
- **WHEN** el sistema define `OPENAI_API_KEY` y el archivo declara el proveedor `openai` sin clave
- **THEN** GitCron usa esa variable y la pantalla dice que sale del sistema

### Requirement: Los parámetros nuevos se toman sin cambiar GitCron
GitCron SHALL pasar al proveedor los parámetros declarados en el archivo aunque no los conozca: `options`
del proveedor y del modelo (por ejemplo `reasoning_effort`), `headers`, `temperature`, `limit` (contexto y
salida) y la variante elegida en `variants`. Los que GitCron conoce SHALL editarse con controles propios;
los demás SHALL verse y editarse como campos avanzados. Un campo que el esquema empaquetado no conoce SHALL
mostrarse como advertencia y SHALL NOT borrarse ni bloquear el uso.

#### Scenario: Parámetro que GitCron no conoce
- **WHEN** un modelo declara en `options` un parámetro que GitCron no tiene como control
- **THEN** el pedido al modelo lo incluye y la pantalla lo muestra entre los campos avanzados

#### Scenario: Límite de contexto declarado
- **WHEN** un modelo declara `limit.context`
- **THEN** GitCron usa ese límite para avisar cuando el contenido a mandar no entra

### Requirement: Los secretos se referencian, no se escriben en el archivo
Claves y cabeceras secretas SHALL escribirse en el archivo como referencias con la sintaxis del formato:
`{env:NOMBRE}` o `{file:ruta}`, y la sustitución SHALL aplicarse en cualquier valor del archivo, incluida
la URL base. GitCron SHALL resolver `{env:NOMBRE}` primero con el entorno del sistema y, si no está
definida, con las variables que la persona guardó cifradas en GitCron con el almacenamiento seguro del
sistema operativo. La pantalla SHALL decir de dónde sale cada variable (sistema, guardada en GitCron o
falta) y SHALL NOT mostrar su valor. Si GitCron encuentra un secreto literal en el archivo, SHALL ofrecer
pasarlo a una variable guardada, sin hacerlo sin confirmación.

#### Scenario: Variable del sistema
- **WHEN** el archivo usa `{env:UNSLOTH_API_KEY}` y la variable está definida en el sistema
- **THEN** GitCron la usa y la pantalla dice «del sistema», sin el valor

#### Scenario: Variable guardada en GitCron
- **WHEN** la variable no está en el sistema y la persona la guardó desde GitCron
- **THEN** GitCron la usa, el archivo sigue diciendo `{env:UNSLOTH_API_KEY}` y la pantalla dice «guardada en GitCron»

#### Scenario: Variable faltante
- **WHEN** una referencia no se puede resolver
- **THEN** el proveedor figura no disponible con el nombre de la variable que falta, y nada se manda con un valor vacío

#### Scenario: URL por variable
- **WHEN** la URL base de un proveedor es `{env:UNSLOTH_BASE_URL}`
- **THEN** GitCron usa la dirección que la variable tenga en ese momento y la muestra resuelta

### Requirement: Importar desde la configuración de OpenCode
GitCron SHALL ofrecer copiar a `gitcron.json` bloques `provider` y `agent` de
`~/.config/opencode/opencode.json`, con una vista previa de qué entra y qué cambia. Las referencias
`{env:…}` y `{file:…}` SHALL copiarse como referencias. SHALL NOT modificar `opencode.json`.

#### Scenario: Importación de proveedores con variables
- **WHEN** se importan `unslothpc` y `unslothpclocal`, cuyas claves y cabeceras son `{env:…}`
- **THEN** `gitcron.json` recibe los dos bloques con las mismas referencias, y la pantalla dice qué variables están definidas y cuáles faltan

#### Scenario: Reimportar
- **WHEN** se importa un proveedor que ya existe en `gitcron.json`
- **THEN** se muestran los campos que cambian y se escribe sólo con confirmación

#### Scenario: Archivo de OpenCode ausente o ilegible
- **WHEN** `opencode.json` no existe o no se puede interpretar
- **THEN** se dice cuál de los dos casos es, sin afirmar que no hay proveedores

### Requirement: Un catálogo con dos familias de proveedores
La pantalla SHALL presentar los proveedores de dos familias: *suscripción por CLI* (Claude Code, Codex y
Antigravity, con la cuenta con la que la persona inició sesión en cada CLI) y *API o servidor propio* (los
del bloque `provider`: OpenRouter, LM Studio, Unsloth y cualquier compatible con OpenAI). Cada proveedor
SHALL declarar si está disponible y, si no, el motivo medido. Un CLI no instalado o sin sesión SHALL
figurar con ese motivo, no omitirse. Los CLI de suscripción SHALL poder elegirse en `model` y en
`agent.<uso>.model` con un identificador de proveedor reservado por CLI.

#### Scenario: Máquina con suscripciones y servidores propios
- **WHEN** están instalados Claude Code, Codex y Antigravity, y el archivo declara LM Studio y Unsloth
- **THEN** la pantalla los lista a todos, agrupados por familia, cada uno con su disponibilidad

#### Scenario: CLI instalado sin sesión
- **WHEN** un CLI está instalado pero su cuenta no tiene sesión iniciada
- **THEN** figura no disponible con el motivo y la orden para iniciar sesión

### Requirement: Cada proveedor lista sus modelos
GitCron SHALL mostrar los modelos declarados en el archivo y, cuando el proveedor responde, los que
reporta en el momento (`GET /models` para compatibles con OpenAI, la lista del CLI cuando la expone). Un
modelo reportado que no está en el archivo SHALL poder agregarse al archivo con un toque. El criterio de
inclusión de modelos de texto vigente para la redacción (sólo tipo `llm` cuando el servidor informa el
tipo) SHALL aplicarse igual.

#### Scenario: Servidor que responde
- **WHEN** un servidor compatible con OpenAI responde con modelos que el archivo no declara
- **THEN** se muestran como disponibles sin declarar, con la opción de agregarlos al archivo

#### Scenario: Servidor apagado
- **WHEN** el servidor no responde
- **THEN** se informa que no respondió y los modelos del archivo se muestran como no confirmados

### Requirement: Una elección general con excepciones visibles por uso
`model` SHALL ser la elección general y `small_model` la rápida. Cada uso de GitCron —redacción de commit,
Cartografía, análisis de versión de OpenSpec, Temporal Agent y agente de SDD— SHALL tener su entrada en
`agent` con nombre fijo y documentado; si declara `model`, `variant`, `temperature` u `options`, eso es
una excepción para ese uso. El modelo, el proveedor y el origen de la elección (general, rápida o
excepción, y de qué archivo) SHALL verse en la pantalla donde ocurre el uso.

#### Scenario: Sin excepciones
- **WHEN** ningún uso declara modelo propio
- **THEN** todos usan `model`, salvo los que el archivo marca como rápidos, que usan `small_model`, y cada pantalla lo nombra

#### Scenario: Excepción en un uso
- **WHEN** la entrada de Temporal Agent en `agent` declara un modelo de suscripción por CLI
- **THEN** Temporal Agent usa ese modelo, su pantalla lo nombra como excepción, y los demás usos siguen con la elección general

### Requirement: El destino del contexto se declara y no hay caída silenciosa a otro proveedor
Antes de mandar contenido del repositorio a un modelo, la pantalla SHALL declarar adónde va: esta máquina,
un servidor propio en otra máquina o un servicio externo. Si el proveedor elegido no responde, GitCron
SHALL informarlo y SHALL NOT pasar a otro proveedor sin una acción humana. Cuando otro proveedor declara
los mismos modelos (por ejemplo el mismo servidor por la red de la casa y por un túnel), GitCron SHALL
ofrecer usarlo en ese momento, con un toque.

#### Scenario: En casa con el túnel elegido
- **WHEN** el uso tiene elegido `unslothpc` (túnel) y no responde, y `unslothpclocal` declara los mismos modelos y sí responde
- **THEN** se informa que el túnel no respondió y se ofrece usar el local, sin cambiar solo

#### Scenario: Servidor propio apagado con un servicio externo configurado
- **WHEN** el proveedor elegido no responde y OpenRouter también está configurado
- **THEN** se informa que no respondió y no se manda nada a OpenRouter

### Requirement: El lanzador de SDD manda el modelo elegido
Al lanzar un agente desde SDD, GitCron SHALL pasarle el modelo efectivo del uso «agente de SDD». Los
proveedores del bloque `provider` SHALL lanzarse como agente a través de OpenCode, entregándole esa misma
definición de proveedor sin escribirla en la configuración de OpenCode. La confirmación de lanzamiento
SHALL nombrar el motor y el modelo.

#### Scenario: Agente de suscripción con modelo elegido
- **WHEN** se lanza Codex con un modelo elegido
- **THEN** la sesión arranca con ese modelo y la confirmación lo nombra

#### Scenario: Agente sobre un servidor propio
- **WHEN** el uso «agente de SDD» tiene elegido un modelo de Unsloth
- **THEN** la sesión se lanza con OpenCode usando ese proveedor y ese modelo, y `opencode.json` no cambia

#### Scenario: OpenCode ausente
- **WHEN** el modelo elegido es de un servidor propio y OpenCode no está instalado
- **THEN** el lanzador informa que hace falta OpenCode para usarlo como agente, sin lanzar otro motor

### Requirement: Los controles de carga aparecen sólo donde el proveedor los tiene
Cargar, expulsar y elegir contexto y tiempo de vida de un modelo SHALL ofrecerse sólo para proveedores que
exponen esa capacidad. Con un proveedor que no la tiene, esos controles SHALL NOT mostrarse deshabilitados
como si faltara algo.

#### Scenario: Proveedor sin carga explícita
- **WHEN** el modelo elegido es de OpenRouter o de un CLI de suscripción
- **THEN** el panel no muestra los controles de carga y expulsión

### Requirement: Los servidores MCP van en un `mcp.json` con la notación compartida
Los servidores MCP de GitCron SHALL declararse en un archivo `mcp.json` aparte, global
(`~/.config/gitcron/mcp.json`) y opcional por repositorio (`<raíz>/.gitcron/mcp.json`), con la notación
`mcpServers` que comparten Cursor, LM Studio y Claude Code: por servidor, `command`, `args`, `env` y
`envFile` para los locales, y `url` y `headers` para los remotos, con variables `${env:NOMBRE}`. SHALL
mostrarse en la pantalla con su tipo, conservarse intacto en toda escritura y reflejar los cambios hechos
a mano, igual que `gitcron.json`. GitCron SHALL ofrecer importar servidores desde `~/.cursor/mcp.json`,
el `mcp.json` de LM Studio y el bloque `mcp` de `opencode.json`, convirtiendo este último a la notación
compartida. Mientras ningún uso de GitCron consuma MCP, la pantalla SHALL decirlo. Un bloque `mcp` dentro
de `gitcron.json` SHALL advertirse con la oferta de moverlo a `mcp.json`, sin leerlo como fuente.

El fundamento está medido el 2026-09-29: Cursor (`~/.cursor/mcp.json`, `.cursor/mcp.json`), LM Studio
(«sigue la notación `mcp.json` de Cursor») y Claude Code usan `mcpServers`; VS Code usa `servers` en
`.vscode/mcp.json` y `mcpServers` en su archivo de usuario portable; OpenCode usa un bloque `mcp` propio,
con `type: local | remote` y el comando como lista. La notación de la mayoría es la que sobrevive a un
cambio de herramienta.

#### Scenario: MCP declarados
- **WHEN** `mcp.json` declara servidores locales y remotos
- **THEN** la pantalla los lista con tipo y aclara que GitCron todavía no los usa

#### Scenario: Importar desde OpenCode
- **WHEN** se importan los servidores del bloque `mcp` de `opencode.json`
- **THEN** `mcp.json` los recibe en la notación `mcpServers`, con las referencias de variables convertidas a `${env:NOMBRE}`, y `opencode.json` no cambia

#### Scenario: Copiar desde Cursor
- **WHEN** la persona pega en `mcp.json` un servidor copiado de `~/.cursor/mcp.json`
- **THEN** GitCron lo muestra tal cual, sin conversión
