# Pipeline connection security

## Purpose

Definir transportes, aislamiento, negociación y controles seguros para todas las fuentes de Pipeline.

## Requirements

### Requirement: Selección de transporte por fuente
Pipeline SHALL preferir protocolo estructurado/versionado, luego ACP, luego CLI JSON/JSONL y finalmente hooks/filesystem como degradación, entre los transportes que exponen lo que la sesión necesita (como mínimo, elegir el modelo que la persona eligió). Un transporte preferido que no lo expone SHALL descartarse con el motivo medido. Pipeline SHALL NOT depender de un gateway orquestador para abrir sesiones directas, y SHALL NOT exponer estado de conexión con uno.

Medido el 2026-09-29 con OpenCode 2.0.20: por ACP la sesión ofrece 419 modelos y no incluye los proveedores propios de la persona (`unslothpc`, `unslothpclocal`), que `opencode models` sí lista (442); `opencode run -m <proveedor>/<modelo>#<variante> --format json` los usa. Por eso OpenCode se lanza por CLI JSON.

#### Scenario: Codex directo
- **WHEN** una sesión Codex expone JSONL o app-server
- **THEN** el adaptador directo normaliza sus eventos bajo el mismo contrato, sin intermediarios

#### Scenario: Sin estado de gateway en el renderer
- **WHEN** el renderer recibe un snapshot de Pipeline
- **THEN** no contiene ningún campo que declare conexión o desconexión con un orquestador externo

#### Scenario: Transporte preferido que no deja elegir el modelo
- **WHEN** el transporte ACP de un runtime no ofrece el modelo elegido y su CLI JSON sí
- **THEN** la sesión se abre por CLI JSON y el descarte de ACP queda anotado con su motivo

### Requirement: Auth y scoping main-only
Conexiones, tokens, sockets y procesos SHALL vivir en Electron main. Cada sesión/control SHALL vincularse explícitamente a repo/run/session y el renderer SHALL recibir sólo DTOs sanitizados y métodos allowlisted.

#### Scenario: Token de companion local
- **WHEN** GitCron conecta a un servicio loopback
- **THEN** usa autenticación explícita almacenada con safeStorage y nunca expone el secreto al renderer o logs

#### Scenario: Backend local sin auth nativa
- **WHEN** un backend loopback no ofrece autenticación comprobada
- **THEN** main interpone un wrapper autenticado o marca la integración degraded sin exponer el socket al renderer

### Requirement: Version negotiation y degradación
El handshake SHALL negociar rango de protocolo y capabilities. Una incompatibilidad major SHALL deshabilitar controles y conservar evidencia local disponible.

#### Scenario: Runtime más nuevo incompatible
- **WHEN** no existe versión de protocolo común
- **THEN** Pipeline muestra conexión incompatible, no envía comandos y sigue mostrando Git/OpenSpec/filesystem

### Requirement: Reconexión, backpressure y ownership
El connector SHALL aplicar backoff con jitter, dedupe, límites de stream y batching. Sólo SHALL controlar procesos registrados como creados por GitCron.

#### Scenario: Kill sobre proceso externo
- **WHEN** una sesión observada pertenece a un proceso que GitCron no creó
- **THEN** `kill` queda unavailable aunque exista un PID observable

### Requirement: Gate base previo a código Pipeline
El repositorio SHALL versionar instrucciones agnósticas, constitución/perfil y un gate determinístico antes de iniciar escrituras de producto F01. Un estado rojo o pendiente SHALL NOT presentarse verde.

#### Scenario: Gobernanza modificada localmente
- **WHEN** un agente cambia AGENTS, gate, constitución o perfil sin commit humano
- **THEN** el gate fast queda rojo y F01 no inicia escrituras de producto

### Requirement: Ejecución confinada de runtimes locales
Los procesos de F03 SHALL iniciarse desde Electron main con executable y args separados, `shell: false`, cwd canónico validado, entorno mínimo y sin secretos en argumentos o logs.

#### Scenario: Cwd fuera del repositorio vinculado
- **WHEN** una solicitud intenta iniciar una sesión con cwd no equivalente al repo canónico
- **THEN** el runner la rechaza antes de ejecutar el binario

### Requirement: Límites, cancelación y cleanup
Cada proceso creado por F03 SHALL tener límites de stream, timeout o señal de cancelación y cleanup esperado; sólo procesos registrados como owned SHALL poder recibir señales internas.

#### Scenario: Timeout de runtime
- **WHEN** una ejecución supera su timeout
- **THEN** el runner solicita terminación del proceso owned, espera su exit y emite resultado timeout sin dejarlo huérfano

#### Scenario: Proceso externo observado
- **WHEN** Pipeline conoce una sesión que GitCron no creó
- **THEN** ninguna capability de señal o kill queda disponible
