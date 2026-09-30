# Spec Delta

## MODIFIED Requirements

### Requirement: El modelo se elige de lo que la máquina tiene, con su estado a la vista
El panel SHALL ofrecer elegir entre los modelos del catálogo común que el proveedor elegido reporta en el
momento, y SHALL arrancar con el modelo efectivo del uso correspondiente. Cuando el proveedor lo informa,
SHALL declarar por cada modelo si está cargado, con qué contexto lo está y en qué dispositivo vive; cuando
no lo informa, SHALL decir que el proveedor no lo informa en vez de inventarlo. SHALL NOT fijar un modelo
ni un servidor en el código: el proveedor y su dirección salen del catálogo común.

El fundamento es que el catálogo es de la máquina y cambia: un modelo fijo falla el día que no está, y el
criterio de elección depende de qué equipo tiene la placa y qué está cargado, que la aplicación no puede
decidir. El contexto declarado tiene que ser el de la carga y no el máximo del modelo: está medido que un
modelo con `max_context_length` de 262144 puede estar cargado con 65536, y el presupuesto real es el
segundo. El dispositivo importa porque con LM Link el catálogo mezcla máquinas y «cargado» no dice en
cuál. Medido el 2026-09-29: la redacción desde este panel llamaba siempre a `localhost:1234`, sin forma de
elegir otro servidor desde la pantalla.

#### Scenario: Catálogo con modelos en distintos estados
- **WHEN** se abre el selector con un proveedor que informa carga, contexto y dispositivo
- **THEN** cada modelo declara su estado, su contexto cargado y su dispositivo

#### Scenario: Proveedor que no informa carga
- **WHEN** se abre el selector con un proveedor que no informa estado de carga
- **THEN** los modelos se listan sin estado inventado y el panel dice que ese proveedor no lo informa

#### Scenario: Servidor en otra máquina
- **WHEN** el servidor del proveedor elegido no está en la misma máquina que la aplicación
- **THEN** se lo alcanza por la dirección declarada en el catálogo, sin depender de una ruta fija

## ADDED Requirements

### Requirement: Una redacción en curso no se pierde al cambiar de vista o de repositorio
Una redacción del mensaje de commit pedida en un repositorio SHALL seguir en curso aunque la persona pase a
otra vista o a la solapa de otro repositorio, y su resultado SHALL escribirse en el campo de commit del
repositorio donde se pidió, nunca en el que está abierto. Cada repositorio SHALL conservar su propia
redacción: al volver a su solapa se ve en curso (tiempo transcurrido, lo que va pensando, «Cancelar») o su
resultado. Cuando termina una redacción de un repositorio que no está a la vista, la aplicación SHALL avisarlo
por su superficie de notificaciones, nombrando el repositorio. Si se pide una redacción mientras otra está en
curso, la nueva SHALL esperar en fila y decirlo («esperando a que termine la de <repositorio>»), sin cortar la
anterior; cancelar una redacción SHALL cortar sólo esa.

El fundamento es de Ale (2026-09-30): el hilo de lo que piensa la IA no tiene que perderse por moverse entre
solapas. El corte al cambiar de repositorio existía sólo porque el mensaje caía en el repositorio equivocado;
escribir por el repositorio de origen resuelve eso sin cortar. La fila evita que dos redacciones compitan por
el mismo servidor, que en el caso de Unsloth atiende un pedido por vez. Es la primera pieza de una IA que
acompaña en todas las pantallas sabiendo en qué repositorio está, que generaliza
`retomar-trabajo-con-asistencia-contextual`.

#### Scenario: Cambio de solapa durante una redacción
- **WHEN** se pide una redacción en odontoPro y la persona pasa a la solapa de gitCronos
- **THEN** la redacción sigue, el mensaje llega al campo de commit de odontoPro, y al volver a odontoPro se ve el resultado y lo que pensó

#### Scenario: Aviso al terminar fuera de la vista
- **WHEN** termina una redacción de un repositorio que no está a la vista
- **THEN** aparece un aviso de la aplicación que nombra ese repositorio

#### Scenario: Dos redacciones seguidas
- **WHEN** hay una redacción en curso en odontoPro y se pide otra en gitCronos
- **THEN** la de gitCronos espera en fila y lo dice; la de odontoPro no se corta

#### Scenario: Cancelar una sola
- **WHEN** hay una redacción en curso y otra en fila, y se cancela la que está en fila
- **THEN** sólo esa se cancela y la que está en curso sigue
