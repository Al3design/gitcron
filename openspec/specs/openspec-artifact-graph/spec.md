# openspec-artifact-graph Specification

## Purpose
Mostrar el grafo de artefactos de un cambio tal como lo devuelve el motor, y avisar qué se sobrescribiría antes de disparar la operación de un artefacto.

## Requirements

### Requirement: El grafo de artefactos SHALL presentarse tal como lo devuelve el motor

Para un cambio en curso, GitCron SHALL presentar cada artefacto con su estado, su descripción, de
qué artefactos depende, qué artefactos desbloquea al completarse y en qué ruta va a escribir, tal
como lo devuelven `openspec instructions <artefacto> --change <id> --json` y
`openspec status --json`. Ningún texto de esta vista se escribe a mano, y un campo que el motor no
devuelve no se inventa. La forma SHALL ser una línea temporal con nodos unidos por una línea,
ordenados por dependencias.

#### Scenario: Grafo completo
- **WHEN** el motor devuelve los artefactos de un cambio con sus dependencias y desbloqueos
- **THEN** la vista muestra un nodo por artefacto, unido a los que lo desbloquean, con estado, descripción y ruta de salida

#### Scenario: Campo ausente
- **WHEN** el motor no devuelve un campo para un artefacto
- **THEN** la vista no lo muestra ni lo rellena

#### Scenario: Motor que falla
- **WHEN** el motor falla al devolver el grafo
- **THEN** la vista muestra el fallo y no dibuja un grafo vacío que se lea como «no falta nada»

### Requirement: Disparar la operación de un artefacto SHALL mostrar antes qué sobrescribiría

Desde un artefacto habilitado, GitCron SHALL ofrecer disparar su operación con el lanzador
existente, mostrando antes las rutas que ya existen (`existingOutputPaths`) para que sobrescribir
nunca sea silencioso. Un artefacto bloqueado SHALL NOT ofrecer la operación y SHALL mostrar qué lo
bloquea. No hay orden obligatorio: se ofrece lo que el motor declara habilitado.

#### Scenario: Artefacto habilitado con salida existente
- **WHEN** la persona elige un artefacto habilitado cuya ruta de salida ya existe
- **THEN** se muestran las rutas existentes antes de disparar, y la operación recién corre al confirmar

#### Scenario: Artefacto bloqueado
- **WHEN** un artefacto depende de otro que no está completo
- **THEN** no ofrece acción y muestra qué artefacto lo bloquea
