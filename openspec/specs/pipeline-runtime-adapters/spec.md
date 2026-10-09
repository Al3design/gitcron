# Pipeline runtime adapters

## Purpose

Definir el contrato común de los adaptadores de runtime (`RuntimeAdapter`) que observan
ejecuciones de runtimes directos y proveedores locales sin requerir Hermes como gateway
obligatorio, con degradación explícita por runtime y conformance parametrizada.

## Requirements

### Requirement: Interfaz común con degradación explícita
Cada `RuntimeAdapter` SHALL declarar identidad, transporte, versión y capabilities negociadas, y SHALL implementar sólo los métodos respaldados por esa declaración.

#### Scenario: Runtime sin resume
- **WHEN** un adapter no posee fixture ni método de resume verificable
- **THEN** declara `resume` como `unavailable` o `pending_fixture` y no simula la operación

### Requirement: Sesión vinculada antes de observar
Toda sesión SHALL recibir identidad explícita de repo, change, task, run y attempt antes de emitir eventos; el adapter SHALL NOT inferir el vínculo desde prosa o cwd solamente.

#### Scenario: Falta repoId
- **WHEN** una solicitud de sesión no incluye `repoId`
- **THEN** el adapter rechaza el inicio antes de crear un proceso

### Requirement: Degradación específica por runtime
Claude, Codex, OpenCode y Antigravity (`agy`) SHALL consumir sólo streams estructurados compatibles; un runtime cuya versión instalada no ofrezca salida estructurada SHALL limitarse a lifecycle/final opaco sin schema; LM Studio SHALL representarse como provider local detrás de un cliente agente.

Medido el 2026-09-29: `agy` 1.2.13 ofrece `-p` con `--output-format stream-json` e `--input-format stream-json`, `--model` y reanudación por `--continue`/`--conversation`. Las versiones 1.1.x que motivaron el trato opaco no tenían ninguna salida estructurada.

#### Scenario: Antigravity con stream estructurado
- **WHEN** la versión instalada de `agy` ofrece `--output-format stream-json`
- **THEN** el adapter consume ese stream, emite los eventos normalizados que el stream respalde y marca como desconocido lo que el stream no informe

#### Scenario: agy sin stream estructurado
- **WHEN** la versión instalada de `agy` (u otro runtime) sólo ofrece salida final humana, como `agy` 1.1.x
- **THEN** el adapter emite lifecycle medido y marca tools, usage, costo, contexto y reasoning como desconocidos o no disponibles

### Requirement: Conformance parametrizada
Cada adapter SHALL pasar una suite común para identidad, orden, dedupe, parciales UTF-8, error, timeout, cleanup, redacción, métricas desconocidas y coherencia de capabilities.

#### Scenario: Capability sin método
- **WHEN** un fixture declara una capability disponible pero el adapter no implementa su método
- **THEN** la conformance falla

### Requirement: Adaptadores sin citas a fixtures retirados
Los adaptadores SHALL NOT citar `evidenceRefs` que apunten a archivos retirados del repositorio. Una capability cuyo único respaldo era un fixture retirado SHALL declararse `pending_fixture` y SHALL seguir siendo lanzable. La detección de versión instalada SHALL continuar para reportar `runtimeVersion`, pero SHALL NOT decidir lanzabilidad ni `evidenceStatus`.

#### Scenario: Adaptador de runtime estructurado tras el retiro
- **WHEN** el adaptador detecta un runtime instalado cuya versión ya no tiene fixture
- **THEN** reporta la versión instalada, declara sus capabilities `pending_fixture` y el runtime es lanzable

#### Scenario: Adaptador sin stream estructurado
- **WHEN** un adaptador no expone stream estructurado en la versión instalada
- **THEN** se declara no lanzable por diseño, se lista con su motivo, y no se le exige fixture

### Requirement: Éxito declarado sólo con ejecución observada
Un adaptador SHALL NOT declarar `success: true` cuando el runtime no ejecutó ningún turno y reportó
un motivo de rechazo, aunque el proceso haya salido con código 0 y sin marca de error. El evento
`run.completed` SHALL llevar `success: false` en ese caso, y el motivo textual reportado por el
runtime SHALL conservarse en la evidencia en vez de descartarse.

El fundamento es que el código de salida y la marca de error del CLI describen el proceso, no el
trabajo. Un runtime que rechaza la instrucción antes de empezar sale limpio, y tomar eso como éxito
convierte un rechazo en una afirmación falsa que el usuario no tiene forma de contradecir.

#### Scenario: Comando inexistente con salida limpia
- **WHEN** el resultado del runtime informa cero turnos y un motivo que empieza con `Unknown command:`
- **THEN** el adaptador emite `run.completed` con `success: false`, conserva el motivo textual y no
  declara la sesión exitosa

#### Scenario: Ejecución real con turnos
- **WHEN** el resultado del runtime informa al menos un turno y ninguna marca de error
- **THEN** el adaptador emite `run.completed` con `success: true` sin cambios respecto del
  comportamiento previo

#### Scenario: Motivo distinto del rechazo de comando
- **WHEN** el resultado informa cero turnos pero el motivo no corresponde a un comando inexistente
- **THEN** el adaptador no inventa un fallo y conserva la derivación basada en la marca de error del
  runtime

### Requirement: Factory de adaptador con ejecutable resuelto por el hub
El hub SHALL poder pasar un `executable` resuelto al factory del adaptador cuando el adaptador lo requiera. Los adaptadores que resuelven su propio binario internamente (claude, codex, agy) SHALL ignorar el parámetro. Un adaptador cuyo binario pueda variar (opencode) SHALL recibir el ejecutable del hub en vez de hardcodearlo.

#### Scenario: OpenCode registrado como lanzable
- **WHEN** el hub construye los adaptadores para discovery
- **THEN** OpenCode aparece con `launchable: true` cuando el binario `opencode` está instalado y responde `opencode --version` y `opencode models`

#### Scenario: OpenCode ausente
- **WHEN** el binario `opencode` no está en PATH
- **THEN** se lista con `installed: false` y su diagnóstico, sin romper el listado de los demás runtimes

#### Scenario: Sesión que modifica el repo
- **WHEN** una sesión de OpenCode arranca
- **THEN** el launcher exige confirmación explícita, porque `modifiesRepo` es `true`

### Requirement: Antigravity se lanza para leer y escribir, sin correr comandos
Con una versión de `agy` que ofrece stream estructurado, el runtime SHALL ser lanzable desde SDD con
`--mode accept-edits` y SHALL declararse con `runsCommands: false`: lee y escribe archivos del
repositorio, y no se ofrece para intenciones que requieren correr comandos o pruebas. SHALL NOT lanzarse
con opciones que aprueben permisos sin preguntar (`--dangerously-skip-permissions`). Si durante la sesión
un comando se rechaza (`result.denied_actions` con `action: "command"`), el adapter SHALL terminar la
corrida con `success: false` y ese motivo visible, aunque `result.status` diga `SUCCESS`.

El fundamento está medido el 2026-09-29 con `agy` 1.2.13: en modo `-p` los comandos se rechazan solos,
`permissions.allow` en su `settings.json` se ignora (issue 548 de google-antigravity/antigravity-cli,
abierto) y la única vía es `--dangerously-skip-permissions`, que quita la contención. Decisión de Ale del
mismo día: opción B, sin comandos hasta que el modo sin pantalla respete los permisos. Cuando lo haga,
este requisito se revisa para darle las mismas capacidades que al resto.

#### Scenario: Lanzamiento con modelo
- **WHEN** se lanza Antigravity desde SDD con un modelo elegido
- **THEN** la sesión arranca con ese modelo, en el repositorio, y la confirmación dice que va a poder modificar archivos pero no correr comandos

#### Scenario: Intención que requiere pruebas
- **WHEN** la intención elegida requiere correr comandos o pruebas
- **THEN** Antigravity figura no disponible para esa intención, con el motivo, y las demás IAs siguen disponibles

#### Scenario: Comando rechazado a mitad de sesión
- **WHEN** Antigravity intenta un comando y queda en `denied_actions`
- **THEN** la corrida termina con `success: false` y el motivo visible, aunque el estado de Antigravity diga `SUCCESS`
