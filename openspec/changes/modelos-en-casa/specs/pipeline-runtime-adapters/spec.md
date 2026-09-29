# Spec Delta

## MODIFIED Requirements

### Requirement: Degradación específica por runtime
Claude, Codex, OpenCode y Antigravity (`agy`) SHALL consumir sólo streams estructurados compatibles; un runtime cuya versión instalada no ofrezca salida estructurada SHALL limitarse a lifecycle/final opaco sin schema; LM Studio SHALL representarse como provider local detrás de un cliente agente.

Medido el 2026-09-29: `agy` 1.2.13 ofrece `-p` con `--output-format stream-json` e `--input-format stream-json`, `--model` y reanudación por `--continue`/`--conversation`. Las versiones 1.1.x que motivaron el trato opaco no tenían ninguna salida estructurada.

#### Scenario: Antigravity con stream estructurado
- **WHEN** la versión instalada de `agy` ofrece `--output-format stream-json`
- **THEN** el adapter consume ese stream, emite los eventos normalizados que el stream respalde y marca como desconocido lo que el stream no informe

#### Scenario: agy sin stream estructurado
- **WHEN** la versión instalada de `agy` (u otro runtime) sólo ofrece salida final humana, como `agy` 1.1.x
- **THEN** el adapter emite lifecycle medido y marca tools, usage, costo, contexto y reasoning como desconocidos o no disponibles

### Requirement: Adaptadores sin citas a fixtures retirados
Los adaptadores SHALL NOT citar `evidenceRefs` que apunten a archivos retirados del repositorio. Una capability cuyo único respaldo era un fixture retirado SHALL declararse `pending_fixture` y SHALL seguir siendo lanzable. La detección de versión instalada SHALL continuar para reportar `runtimeVersion`, pero SHALL NOT decidir lanzabilidad ni `evidenceStatus`.

#### Scenario: Adaptador de runtime estructurado tras el retiro
- **WHEN** el adaptador detecta un runtime instalado cuya versión ya no tiene fixture
- **THEN** reporta la versión instalada, declara sus capabilities `pending_fixture` y el runtime es lanzable

#### Scenario: Adaptador sin stream estructurado
- **WHEN** un adaptador no expone stream estructurado en la versión instalada
- **THEN** se declara no lanzable por diseño, se lista con su motivo, y no se le exige fixture

## ADDED Requirements

### Requirement: Antigravity se lanza con las mismas capacidades que los demás agentes
Con una versión de `agy` que ofrece stream estructurado, el runtime SHALL ser lanzable desde SDD y SHALL
poder leer, escribir y correr comandos en el repositorio, igual que Claude, Codex y OpenCode, tras la
misma confirmación explícita. SHALL NOT lanzarse con opciones que aprueben permisos sin preguntar
(`--dangerously-skip-permissions`). Si en modo no interactivo un permiso no puede concederse sin esa
opción, el adapter SHALL informar el pedido de permiso como motivo de detención en vez de colgarse o
declarar éxito.

#### Scenario: Lanzamiento con modelo
- **WHEN** se lanza Antigravity desde SDD con un modelo elegido
- **THEN** la sesión arranca con ese modelo, en el repositorio, y la confirmación dice que va a poder modificar archivos y correr comandos

#### Scenario: Permiso que requiere intervención
- **WHEN** Antigravity pide un permiso que el modo no interactivo no concede
- **THEN** la sesión termina con ese pedido como motivo visible y `success: false`
