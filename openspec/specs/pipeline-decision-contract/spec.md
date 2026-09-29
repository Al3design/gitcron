# Pipeline decision contract

## Purpose

Definir solicitudes, opciones y efectos de decisiones humanas con evidencia y trazabilidad.

## Requirements

### Requirement: Solicitud humana respaldada por evidencia
Cada `DecisionRequest` SHALL identificar repo/change/task/run/session/agent, clase de decisión, estado, explicación, opciones, riesgo con procedencia, refs de evidencia, digest de scope y expiración.

#### Scenario: Dependencia solicitada
- **WHEN** se deriva una solicitud de dependencia
- **THEN** debe existir diff confirmado del manifest y regla aplicable; un gate global rojo por sí solo no alcanza

#### Scenario: Resolución trazable
- **WHEN** una persona elige una opción disponible
- **THEN** la resolución conserva option, actor, timestamp y commandId nullable sin sobrescribir el request original

### Requirement: Opciones condicionadas por capability
Una opción SHALL ser ejecutable sólo si referencia una capability negociada, target vigente y precondiciones válidas. De otro modo SHALL explicar por qué no está disponible.

#### Scenario: Control no soportado
- **WHEN** una decisión ofrece pausar pero la sesión no negoció `run.pause`
- **THEN** la opción permanece informativa con `available: false` y razón explícita

### Requirement: Ack separado de efecto
El estado de un comando SHALL distinguir solicitud, aceptación, acknowledgement, efecto observado, fallo y resultado desconocido.

#### Scenario: Interrupción reconocida
- **WHEN** un runtime confirma recepción de interrupt
- **THEN** Pipeline muestra ACK y espera reconciliación de sesión y working tree antes de declarar el efecto

### Requirement: Decisiones derivadas sólo desde señales verificables
F01 SHALL normalizar decisiones pendientes desde OpenSpec, auditorías, escaladas y evidencia estructurada, conservando procedencia y dejando riesgo o consecuencias como `unknown` cuando no exista una regla versionada.

#### Scenario: Gate global rojo sin diff
- **WHEN** un gate global falla pero no existe diff confirmado de dependencias ni señal estructurada equivalente
- **THEN** Pipeline no inventa una `dependency-request`

#### Scenario: Auditoría rechazada
- **WHEN** un reporte verificable contiene veredicto `RECHAZADO` y hallazgos accionables
- **THEN** Pipeline crea una decisión enlazada al reporte y conserva los hallazgos sin convertirlos en comandos

### Requirement: Aprobación protegida con scope exacto
Una decisión de aprobación de diff protegido SHALL conservar lista de archivos, digest y alcance exactos; texto ambiguo SHALL NOT habilitar disponibilidad ejecutable.

#### Scenario: Aprobación sin digest
- **WHEN** una fuente sólo dice que un cambio está aprobado pero no identifica archivos y digest
- **THEN** la decisión permanece informativa con opción ejecutable no disponible

### Requirement: Un aviso informativo SHALL NOT presentarse como una decisión que se responde

Cuando todas las opciones de una solicitud son informativas —ninguna referencia una capability
negociada con un ejecutor—, GitCron SHALL presentarla como un aviso, no como una decisión pendiente
de respuesta. «Ver evidencia» SHALL abrir el archivo de evidencia referido, y SHALL NOT enviarse
ningún comando de control ni mostrarse un «este ejecutor no admite respuestas». Medido el
2026-09-29: las únicas solicitudes que existen salen de auditorías rechazadas en `docs/reports/`,
con la sola opción informativa «Ver evidencia», y ningún runtime declara `respond-decision`;
presentarlas como decisiones promete una respuesta que no tiene destino.

#### Scenario: Auditoría rechazada
- **WHEN** hay una auditoría rechazada en la evidencia del repositorio
- **THEN** se muestra como aviso con su resumen y «Ver evidencia», que abre el archivo del reporte

#### Scenario: Sin comando de control
- **WHEN** la persona toca «Ver evidencia» en un aviso
- **THEN** no se envía ningún comando al canal de control y no aparece un mensaje de respuesta no admitida

#### Scenario: Evidencia que ya no existe
- **WHEN** el archivo de evidencia referido no se puede abrir
- **THEN** se informa que no se encontró, sin afirmar que el aviso se resolvió
