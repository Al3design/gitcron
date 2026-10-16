# work-continuity

## Purpose

Permitir retomar un cambio después de una ausencia entendiendo su objetivo, evidencia disponible y próxima acción sin conocer previamente el vocabulario de SDD.

## ADDED Requirements

### Requirement: Retomar presenta objetivo y siguiente acción con fuentes

Al abrir un cambio la UI SHALL presentar título legible, objetivo breve, trabajo registrado, pendientes/decisiones y acción disponible. Los detalles y artefactos completos SHALL seguir accesibles sin duplicar bloques permanentes. La recomendación SHALL declarar su fundamento.

#### Scenario: Retorno tras ausencia
- **WHEN** se abre un cambio con tareas y una decisión pendientes
- **THEN** se identifican objetivo, decisión y acción siguiente sin leer primero todos los artefactos

#### Scenario: Sin IA
- **WHEN** no hay un modelo habilitado
- **THEN** el resumen de evidencia y la navegación siguen disponibles

### Requirement: El resumen distingue evidencia y antigüedad

Cada afirmación de avance SHALL poder remitirse a su fuente y revisión. Documento existente, tarea marcada, prueba ejecutada y commit SHALL ser estados distintos. Las fuentes cambiadas o ausentes SHALL invalidar las conclusiones dependientes y mostrar qué falta comprobar.

#### Scenario: Archivo editado externamente
- **WHEN** se modifica tasks.md después del resumen
- **THEN** se relee y no se muestra el avance anterior como actual

#### Scenario: Sólo documentos
- **WHEN** existen propuesta y tareas sin implementación verificada
- **THEN** se informa planificación disponible, sin declarar trabajo implementado

### Requirement: El lenguaje acompaña sin saturar

La interfaz SHALL usar etiquetas comprensibles, conservar identificadores técnicos en detalle y ofrecer explicación del vocabulario a demanda. SHALL distinguir redacción de artefactos de ejecución y verificación; no SHALL imponer una secuencia de fases obligatorias.

#### Scenario: Ayuda contextual
- **WHEN** se pide explicación de una spec o archivado
- **THEN** se explica su propósito y efecto donde se trabaja, sin un bloque permanente en todos los controles

#### Scenario: Detalle de tarea
- **WHEN** se abre una tarea resumida
- **THEN** se conserva acceso al texto completo y sus criterios sin perder la selección

### Requirement: La ayuda explica efectos y declara su procedencia

Los controles de entrada y operación SHALL declarar brevemente qué reciben y qué efecto producen; los detalles SHALL quedar disponibles a demanda. La ayuda SHALL conservar acceso a los términos de OpenSpec y distinguir metadata del motor instalado de explicaciones propias de GitCron. No SHALL inventar novedades de versión ni un orden rígido de artefactos cuando el motor no los declara.

#### Scenario: Campo que prepara una instrucción
- **WHEN** un campo sólo compone el prompt de un ejecutor
- **THEN** lo explica sin presentarlo como escritura de una propuesta ya guardada

#### Scenario: Explicación propia y motor cambiante
- **WHEN** GitCron explica un término o muestra artefactos del esquema activo
- **THEN** identifica su explicación propia y lee los artefactos/estados del motor, mostrando desconocido donde no hay evidencia
