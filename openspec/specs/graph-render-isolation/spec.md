# graph-render-isolation Specification

## Purpose
Que mover el encuadre del grafo no reconstruya los nodos: sólo los cambios de contenido reconstruyen, y las manijas de interacción no rompen la memoización.
## Requirements
### Requirement: Mover el encuadre no reconstruye los nodos
La capa de nodos de commit SHALL NOT reconstruirse cuando lo único que cambia es el encuadre del
grafo. El desplazamiento y el zoom SHALL aplicarse sobre la transformación que envuelve a esa capa,
sin recrear sus elementos.

El fundamento es que el encuadre ya se aplica como una única transformación sobre el contenedor: los
nodos no cambian de posición en coordenadas de mundo cuando el usuario arrastra. Reconstruirlos
produce elementos idénticos a los anteriores, y ese trabajo es el que impide sostener el cuadro.

#### Scenario: Arrastre continuo
- **WHEN** cambia el desplazamiento del encuadre y no cambian los commits, la selección ni el hover
- **THEN** la capa de nodos no se vuelve a construir

#### Scenario: Zoom
- **WHEN** cambia la escala del encuadre y nada más
- **THEN** la capa de nodos no se vuelve a construir

### Requirement: Los cambios de contenido sí reconstruyen
La capa de nodos SHALL reconstruirse cuando cambia algo que sí afecta lo que dibuja: los commits
proyectados, el commit seleccionado, el commit bajo el cursor, la rama resaltada o los commits que
están entrando.

#### Scenario: Selección de un commit
- **WHEN** cambia el commit seleccionado
- **THEN** la capa de nodos se reconstruye y refleja la nueva selección

#### Scenario: Llegada de un commit nuevo
- **WHEN** cambia el conjunto de commits proyectados
- **THEN** la capa de nodos se reconstruye

### Requirement: Las manijas de interacción no invalidan la memoización
Las funciones que la capa de nodos recibe para selección, menú contextual y hover SHALL conservar su
identidad entre renders mientras el componente esté montado. Ningún valor que se recree en cada
render SHALL pasarse a esa capa.

El fundamento es que una sola función recreada por render anula la memoización por completo, y lo
hace en silencio: el resultado sigue siendo correcto y sólo se nota como lentitud.

#### Scenario: Render del contenedor sin cambios de contenido
- **WHEN** el contenedor del grafo se vuelve a renderizar sin que cambien los datos de los nodos
- **THEN** las funciones que recibe la capa de nodos son las mismas de antes

#### Scenario: Interacción después de varios renders del contenedor
- **WHEN** el usuario selecciona un commit tras varios renders del contenedor
- **THEN** la selección se aplica sobre el estado vigente y no sobre el del primer render

