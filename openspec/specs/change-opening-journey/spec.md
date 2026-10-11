# change-opening-journey Specification

## Purpose
Abrir un cambio nuevo como un recorrido de pasos que muestra lo que el motor de OpenSpec contesta en cada uno.

## Requirements

### Requirement: Abrir un cambio SHALL ser un recorrido de pasos con lo que el motor contesta

La conversación que abre un cambio SHALL presentarse como un recorrido de pasos, no como un
formulario: cada paso SHALL decir dónde está parada la persona, qué contestó el motor y qué sigue.
Los pasos SHALL ser los de la rutina del motor (explorar, proponer, aplicar, archivar); lo que el
motor devuelve se muestra tal como llega, lo que no expone se declara, y GitCron SHALL NOT inventar
pasos ni prometer acciones que el motor no hace. El lanzador existente sigue siendo el único que
abre procesos.

#### Scenario: Paso con respuesta del motor
- **WHEN** un paso termina y el motor devolvió una salida
- **THEN** el recorrido muestra esa salida en el paso, marca el paso como hecho y presenta el siguiente

#### Scenario: Paso que el motor no expone
- **WHEN** el motor instalado no expone la operación de un paso
- **THEN** el recorrido lo declara en ese paso y no lo simula

#### Scenario: Nada se abre solo
- **WHEN** la persona llega a un paso que dispara una operación
- **THEN** la operación corre sólo cuando la persona la confirma, a través del lanzador existente
