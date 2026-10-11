# task-checkbox-editing Specification

## Purpose
Marcar, desmarcar, editar y borrar tareas de un tasks.md desde la aplicación, con confirmación donde hace falta, todo registrado en el repositorio y sin tocar cambios archivados.

## Requirements

### Requirement: Cambiar el estado de una tarea desde la aplicación
Una persona SHALL poder marcar y desmarcar cualquier tarea de un cambio activo desde donde la está
mirando, y SHALL poder además agregar una tarea, corregir su texto, reordenarla y eliminarla. Toda
operación SHALL escribirse en el archivo de tareas del cambio, y SHALL NOT alterar ninguna otra línea
de ese archivo más allá de la que la operación afecta.

El fundamento original se mantiene y se extiende. Marcar desde la aplicación existía porque abrir el
archivo a mano dejaba sin marcar tareas ya validadas, y un registro que dice que quedó pendiente algo
que se hizo es peor que no tener registro. La misma distancia aparece al redactar: una tarea mal
enunciada, una que sobra o una que falta obligan a salir de la herramienta que se usa justamente para
llevar la cuenta, y en la práctica no se corrigen.

Cada operación SHALL verificar que la línea sobre la que va a escribir sigue diciendo lo que decía
cuando se dibujó la pantalla, y SHALL rechazarse si no coincide. El archivo lo puede cambiar otro
proceso —un agente trabajando, o una edición externa— entre que se muestra y llega la orden, y
escribir igual modificaría la tarea equivocada sin que nadie lo note.

#### Scenario: Marcar una tarea cumplida
- **WHEN** una persona marca una tarea pendiente de un cambio activo
- **THEN** la tarea queda marcada en el archivo de tareas y el resto del archivo no cambia

#### Scenario: Desmarcar una tarea
- **WHEN** una persona desmarca una tarea marcada y confirma la acción
- **THEN** la tarea queda sin marcar en el archivo de tareas

#### Scenario: Agregar una tarea
- **WHEN** una persona agrega una tarea en un grupo
- **THEN** la tarea se escribe con el formato de casilla vigente, en la posición indicada, sin alterar las demás

#### Scenario: Corregir el texto de una tarea
- **WHEN** una persona corrige el texto de una tarea
- **THEN** cambia únicamente su texto, conservando su estado, su sangría y su numeración

#### Scenario: Reordenar una tarea
- **WHEN** una persona mueve una tarea dentro de su grupo
- **THEN** cambia su posición y ninguna otra línea del archivo se altera

#### Scenario: La línea dejó de coincidir
- **WHEN** el archivo cambió y la línea afectada ya no dice lo que decía al mostrarse
- **THEN** la operación se rechaza sin escribir, y se informa que el archivo cambió

### Requirement: Desmarcar exige confirmación
Desmarcar una tarea ya marcada SHALL pedir confirmación explícita antes de aplicarse. Marcar una
tarea pendiente SHALL NOT pedirla.

El fundamento es la asimetría entre las dos acciones: marcar agrega una afirmación que su autor está
haciendo en ese momento, mientras que desmarcar borra la constancia de algo que alguien afirmó haber
hecho antes. Además, cada cambio queda registrado, y un clic accidental escribiría en el registro
algo que nadie quiso.

#### Scenario: Intento de desmarcar
- **WHEN** una persona desmarca una tarea marcada
- **THEN** se pide confirmación y nada se escribe hasta obtenerla

#### Scenario: Confirmación rechazada
- **WHEN** la confirmación de desmarcar se cancela
- **THEN** la tarea conserva su estado y no se registra ningún cambio

### Requirement: Cada cambio de estado queda registrado en el repositorio
Toda operación sobre las tareas de un cambio SHALL registrarse en un archivo del propio cambio, con
la fecha, la tarea afectada, qué ocurrió y si la originó una persona o un agente. El registro SHALL
vivir en el repositorio, y SHALL NOT guardarse únicamente en almacenamiento local de la aplicación.

El fundamento original se mantiene: un registro que sólo existe dentro de la aplicación no lo puede
leer quien trabaje sobre el repositorio sin ella —incluido cualquier ejecutor automático— y
desaparece al cambiar de máquina. Viajando con el cambio, acompaña al trabajo que describe. La
extensión responde a que ahora las tareas se redactan y se eliminan además de marcarse: sin
constancia, una tarea borrada desaparece sin dejar rastro de que existió, y quien lea después no
puede distinguir lo que nunca se planteó de lo que se descartó. Declarar el origen importa porque en
este repositorio conviven personas y agentes escribiendo sobre los mismos archivos.

#### Scenario: Marcar deja constancia
- **WHEN** se marca o desmarca una tarea
- **THEN** se agrega una línea al registro del cambio indicando fecha, tarea y dirección

#### Scenario: Redactar deja constancia
- **WHEN** se agrega, corrige, reordena o elimina una tarea
- **THEN** se agrega una línea al registro indicando fecha, qué ocurrió y sobre qué tarea

#### Scenario: El registro declara el origen
- **WHEN** una operación la origina un agente en lugar de una persona
- **THEN** la línea del registro lo declara

#### Scenario: El registro acompaña al cambio
- **WHEN** el cambio se archiva
- **THEN** su registro viaja con él, junto al resto de sus artefactos

### Requirement: Un cambio archivado no se edita
Las tareas de un cambio archivado SHALL NOT poder modificarse desde la aplicación, y la interfaz
SHALL declarar el motivo.

El fundamento es que un archivado es el registro de cómo se trabajó entonces. Editarlo después haría
que describa algo que no ocurrió.

#### Scenario: Tarea de un cambio archivado
- **WHEN** se muestra una tarea de un cambio ya archivado
- **THEN** su estado no se puede modificar, y se indica que está archivado

### Requirement: Eliminar una tarea SHALL exigir confirmación explícita

Eliminar una tarea SHALL pedir confirmación antes de aplicarse, mostrando su texto. Corregir o
reordenar SHALL NOT pedirla. El criterio es el mismo que ya rige para desmarcar: una operación que
borra la constancia de algo que alguien planteó no puede ocurrir por un clic accidental, mientras
que las que sólo reacomodan lo existente son reversibles a la vista.

#### Scenario: Intento de eliminar
- **WHEN** una persona elimina una tarea
- **THEN** se pide confirmación mostrando el texto de la tarea y nada se escribe hasta obtenerla

### Requirement: Las tareas SHALL poder verse y editarse como lista y como texto del archivo

La aplicación SHALL ofrecer dos vistas sobre el mismo archivo de tareas: una lista donde cada tarea
es una fila operable, y el texto del archivo tal cual está. Las dos SHALL escribir sobre el mismo
archivo y reflejar de inmediato lo que hizo la otra. La lista cubre lo habitual sin exponer sintaxis;
el texto cubre lo que la lista no anticipa —reordenar grupos, escribir una nota, arreglar algo que
quedó mal— sin obligar a salir de la aplicación para hacerlo.

#### Scenario: Alternar entre vistas
- **WHEN** se opera en una vista y se cambia a la otra
- **THEN** la otra muestra el resultado de esa operación

### Requirement: La aplicación SHALL advertir sobre líneas que aparentan una tarea mal formada, y SHALL NOT objetar el texto libre

La aplicación SHALL señalar las líneas que aparentan ser una tarea pero no cumplen el formato de
casilla que el motor reconoce, y SHALL NOT señalar encabezados, párrafos ni notas, que son contenido
válido del archivo. El motor declara que una tarea fuera del formato de casilla no se contabiliza, de
modo que una casilla mal escrita desaparece del recuento sin aviso: eso es precisamente lo que la
metodología se usa para evitar. Advertir sobre todo lo que no sea una casilla tendría el efecto
opuesto —volvería ruido el aviso y se dejaría de mirar—.

#### Scenario: Casilla mal formada
- **WHEN** una línea empieza como tarea pero su casilla no cumple el formato reconocido
- **THEN** se la señala advirtiendo que no va a contabilizarse

#### Scenario: Texto libre legítimo
- **WHEN** el archivo contiene encabezados, párrafos o notas
- **THEN** no se los señala ni se impide guardarlos
