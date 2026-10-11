# speculative-branches-preference Specification

## Purpose
Mostrar las ramas especulativas sólo cuando la persona lo pide, recordando la elección por repositorio, con un interruptor que refleja el estado real.
## Requirements
### Requirement: Las ramas especulativas SHALL mostrarse sólo cuando la persona lo pide

La capa de ramas especulativas SHALL permanecer oculta mientras no exista una elección explícita de
mostrarla, y la aplicación SHALL NOT encenderla por su cuenta al detectar predicciones guardadas ni
al recibir predicciones nuevas.

Todo elemento de interfaz que anuncie la existencia de ramas especulativas SHALL consultar esa misma
elección antes de mostrarse, y SHALL NOT quedar sujeto únicamente a que la representación cronométrica
del grafo esté habilitada. Su rótulo y su tooltip SHALL provenir de la capa de traducción.

El fundamento es que las ramas especulativas son conjeturas de un agente sobre trabajo que no
ocurrió, y lo especulativo jamás puede confundirse visualmente con lo real.
Encenderlas automáticamente invierte quién decide: quien genera la conjetura termina decidiendo que
se vea.

Lo que se agrega alcanza al anuncio, no a la capa. El botón que informa cuántas ramas especulativas
hay disponibles se muestra hoy en función de que la representación cronométrica esté habilitada y de
que existan predicciones, sin leer nunca la preferencia por repositorio; sólo la escribe, al recibir
el clic. Quien eligió ocultar las ramas especulativas sigue viendo su anuncio, y la única forma de
retirarlo es deshabilitar la representación cronométrica entera, lo que además se lleva puesto el
selector de modo del grafo. La elección de no ver conjeturas debe alcanzar también al aviso de que
existen.

#### Scenario: Repositorio con predicciones guardadas
- **WHEN** se abre un repositorio que tiene predicciones guardadas y no hay elección previa registrada
- **THEN** la capa de ramas especulativas permanece oculta y su interruptor se muestra apagado

#### Scenario: Llega una predicción nueva
- **WHEN** el agente produce predicciones nuevas mientras la capa está oculta
- **THEN** las predicciones se guardan y la capa permanece oculta

#### Scenario: Anuncio con la capa oculta
- **WHEN** existen ramas especulativas y la elección registrada para ese repositorio es ocultarlas
- **THEN** el anuncio de su existencia no se muestra en ninguna representación del grafo

#### Scenario: Anuncio con la capa visible
- **WHEN** existen ramas especulativas y la elección registrada para ese repositorio es mostrarlas
- **THEN** el anuncio se muestra y lleva a la representación cronométrica con la capa visible

#### Scenario: Idioma del anuncio
- **WHEN** se cambia el idioma de la aplicación
- **THEN** el rótulo del anuncio y su tooltip cambian con él

### Requirement: La elección de ver ramas especulativas SHALL recordarse por repositorio

La aplicación SHALL registrar por repositorio si la capa de ramas especulativas se muestra u oculta,
SHALL restituir esa elección al abrir ese repositorio, y SHALL NOT propagarla a los demás.

El fundamento es que la utilidad de las conjeturas depende del proyecto: en uno donde se está
explorando ayudan, y en otro estable son ruido permanente sobre la línea de tiempo. Una preferencia
única obliga a decidir de nuevo cada vez que se cambia de pestaña de repositorio, que es algo que
ocurre muchas veces por jornada.

El registro SHALL seguir el mecanismo que la aplicación ya usa para las preferencias por repositorio
—una clave por ruta de repositorio— y SHALL NOT introducir un mecanismo de persistencia nuevo.

#### Scenario: Elección recordada
- **WHEN** se muestra la capa en un repositorio, se cambia a otro y se vuelve al primero
- **THEN** la capa vuelve a mostrarse en el primero sin volver a pedirlo

#### Scenario: La elección no se propaga
- **WHEN** se muestra la capa en un repositorio y se abre otro sin elección previa
- **THEN** el segundo mantiene la capa oculta

#### Scenario: Sin elección registrada
- **WHEN** se abre un repositorio del que no hay elección registrada
- **THEN** la capa permanece oculta, que es el estado por omisión

### Requirement: El interruptor SHALL reflejar el estado real de la capa

El interruptor de ramas especulativas SHALL declarar si la capa está visible u oculta, y ese rótulo
SHALL corresponder al estado efectivo en todo momento, incluido el instante de abrir un repositorio.
Un interruptor que dice estar encendido mientras nada se muestra —o al revés— deja de ser un control
y pasa a ser una afirmación falsa sobre el estado.

#### Scenario: Apertura de un repositorio con la capa oculta
- **WHEN** se abre un repositorio cuya elección registrada es mantener la capa oculta
- **THEN** el interruptor se muestra apagado y ninguna rama especulativa aparece sobre el lienzo

