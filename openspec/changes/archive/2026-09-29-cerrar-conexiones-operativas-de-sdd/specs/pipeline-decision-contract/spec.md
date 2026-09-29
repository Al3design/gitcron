# Pipeline decision contract

## ADDED Requirements

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
