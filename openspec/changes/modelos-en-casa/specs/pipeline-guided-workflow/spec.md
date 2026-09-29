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
