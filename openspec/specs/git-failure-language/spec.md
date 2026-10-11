# git-failure-language Specification

## Purpose
Explicar en el idioma de la aplicación los fallos de Git que se reconocen, y ofrecer la salida para que la ejecute la persona.
## Requirements
### Requirement: Un fallo reconocido se explica en el idioma de la aplicación
Cuando una operación de Git falle con un error que la aplicación reconoce, SHALL mostrar qué pasó en el
idioma de la aplicación, y SHALL conservar el texto original de Git accesible.

El fundamento es lo que le pasó a Ale: apretó PUSH y recibió ocho líneas en inglés nombrando
`push.default` y `branch.autoSetupMerge`. Su primera reacción fue preguntar si era un problema de
conexión — cuando el texto no se entiende, se adivina la causa equivocada, y en Git adivinar mal lleva a
tocar el historial.

El original se conserva porque la explicación puede errar. Cuando acierta sobra, y cuando falla es lo
único que permite entender qué pasó de verdad y lo que hace falta pegar para pedir ayuda afuera.

#### Scenario: Fallo reconocido
- **WHEN** una operación de Git falla con un error que la aplicación reconoce
- **THEN** se muestra la explicación en el idioma de la aplicación, con el texto de Git disponible

#### Scenario: Fallo no reconocido
- **WHEN** el error no coincide con ninguno conocido
- **THEN** se muestra el texto de Git tal como vino, sin explicación inventada

### Requirement: La explicación ofrece la salida, y la ejecuta la persona
Cuando el fallo reconocido tenga una salida que la aplicación puede realizar, SHALL ofrecerla como una
acción explícita. SHALL NOT ejecutarla por su cuenta.

El fundamento es que el episodio no termina en entender: termina en poder seguir. Con el vínculo apuntando
a otro nombre, GitCron obliga hoy a salir a la terminal para algo que puede hacer, y renombrar una rama es
una operación corriente.

No se ejecuta sola porque tocar el remoto lo pide una persona en este proyecto, y porque en este caso hay
dos nombres y sólo ella sabe cuál conservar. Git se negó a adivinarlo con buen criterio; automatizarlo
sería repetir el error del otro lado.

#### Scenario: El vínculo apunta a otro nombre
- **WHEN** el push falla porque el vínculo con el remoto apunta a una rama de otro nombre
- **THEN** se explica eso y se ofrece reapuntarlo, sin hacerlo hasta que la persona lo pida

#### Scenario: Fallo sin salida automatizable
- **WHEN** el fallo reconocido no tiene una salida que la aplicación pueda realizar
- **THEN** se explica qué pasó y qué haría falta, sin ofrecer un botón que no resuelva nada

