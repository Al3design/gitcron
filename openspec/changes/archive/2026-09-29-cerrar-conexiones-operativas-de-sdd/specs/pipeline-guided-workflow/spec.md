# pipeline-guided-workflow

## MODIFIED Requirements

### Requirement: Siguiente paso derivado por función pura
La guía contextual SHALL calcularse con una función pura y determinística que reciba el snapshot observado, la selección y la proyección de runtime, y devuelva un único siguiente paso. La UI SHALL NOT derivar el estado con condicionales repartidos en JSX ni con estado local que no provenga de la evidencia.

#### Scenario: Misma evidencia produce la misma guía
- **WHEN** la función recibe dos veces el mismo snapshot, selección y proyección
- **THEN** devuelve el mismo siguiente paso, sin depender de reloj, orden de render ni estado previo

#### Scenario: Estados superpuestos resuelven por prioridad declarada
- **WHEN** coinciden una sesión activa, un reintento y una tarea pendiente
- **THEN** se aplica el orden sesión activa > fallo o reintento > tarea pendiente > validación > archivo, y se expone un solo siguiente paso

#### Scenario: Un aviso no detiene el siguiente paso
- **WHEN** existe un aviso en el repositorio y una tarea pendiente en el cambio seleccionado
- **THEN** el siguiente paso derivado sigue siendo aplicar la tarea y el aviso se ofrece aparte, sin detener el flujo principal

### Requirement: Validación y archivo aparecen sólo en su momento

La acción de archivar SHALL habilitarse únicamente con validación aprobada. Con tareas completas y
validación desconocida, la guía SHALL pedir comprobar el cambio. Con validación fallida, SHALL
dirigir a corregir y SHALL NOT habilitar el archivo.

La validación aprobada SHALL ser necesaria junto con las precondiciones Git y de concurrencia vigentes; SHALL NOT habilitar archivo sobre la rama principal ni con un plan vencido. Tareas pendientes y sesiones
persistidas SHALL NOT bloquearlo: la convención de trabajo cierra cada cambio con una tarea de
handoff humano que ningún runtime tilda, así que condicionar el archivo a que no queden tareas lo
vuelve inalcanzable. Cuando queden tareas sin tildar, el control SHALL declarar cuántas son, para
que la decisión se tome con el dato a la vista y no por omisión.

#### Scenario: Validación fallida

- **WHEN** la validación del cambio seleccionado es fallida
- **THEN** la acción primaria lleva a corregir con los diagnósticos reales y la acción de archivar permanece deshabilitada

#### Scenario: Validación desconocida con tareas completas

- **WHEN** todas las tareas figuran completas y la validación es desconocida
- **THEN** la guía pide actualizar la validación en lugar de ofrecer el archivo

#### Scenario: Validación aprobada

- **WHEN** la validación es aprobada, el cambio no está archivado y se cumplen las precondiciones Git y de concurrencia
- **THEN** la acción primaria ofrece archivar el cambio

#### Scenario: Validación aprobada con tareas pendientes

- **WHEN** la validación es aprobada, se cumplen las precondiciones y quedan tareas sin tildar
- **THEN** el control de archivado está disponible y declara cuántas tareas quedan pendientes

#### Scenario: Validación aprobada con una sesión persistida sobre una tarea pendiente

- **WHEN** existe una sesión cerrada que apunta a una tarea que sigue sin tildar y la validación es aprobada y se cumplen las precondiciones Git y de concurrencia
- **THEN** el control de archivado sigue disponible, sin que la sesión lo bloquee

#### Scenario: Cambio ya archivado

- **WHEN** el cambio seleccionado está archivado
- **THEN** el control de archivado no se ofrece

#### Scenario: Rama principal o plan vencido
- **WHEN** la validación pasa pero la rama está protegida para el archivo o el plan quedó vencido
- **THEN** se mantiene el bloqueo con su causa concreta y una salida para resolverlo


### Requirement: Sin runtime lanzable la salida es accionable
Cuando ningún runtime resulta lanzable, la guía SHALL mostrar los diagnósticos reales del descubrimiento, indicando qué runtime falta o es incompatible y cómo volver a comprobarlo. SHALL NOT simular una instalación ni ejecutar shells arbitrarios desde el renderer.

#### Scenario: Ningún runtime disponible
- **WHEN** el descubrimiento no devuelve runtimes lanzables
- **THEN** se muestran los diagnósticos por runtime y una forma de reintentar la comprobación, sin ofrecer un arranque que fallaría

#### Scenario: Runtime instalado sin fixture de esa versión
- **WHEN** un runtime está instalado y es lanzable pero su versión queda fuera de la base auditada
- **THEN** aparece con evidencia no verificada sin bloquear su lanzamiento sólo por faltar fixture; cada operación verifica sus capacidades requeridas

#### Scenario: Runtime instalado pero incompatible
- **WHEN** un runtime está instalado pero hay evidencia de incompatibilidad del protocolo o faltan capacidades necesarias para la operación solicitada
- **THEN** esa operación no se inicia, se explica la incompatibilidad comprobada y se ofrecen sólo alternativas compatibles; la ausencia de fixture no constituye por sí sola esa evidencia

### Requirement: El arranque respeta el destino de la acción que lo abrió

Al abrir el lanzador de runtime, el cambio y la tarea asociados SHALL ser los de la acción que lo abrió, y SHALL NOT volver a derivarse de una selección posterior. Si el contexto ya no es válido, SHALL pedirse renovar la acción. El archivado SHALL usar la operación del proceso principal sin crear una sesión de agente.

#### Scenario: Archivado con tareas pendientes
- **WHEN** se confirma el archivado de un cambio con tareas pendientes y precondiciones satisfechas
- **THEN** se ejecuta el archivado main con su cambio explícito y sin sesión ni tarea de runtime

#### Scenario: Continuación de tarea
- **WHEN** se confirma continuar una tarea pendiente
- **THEN** la sesión arranca asociada a esa tarea y con la etiqueta de continuación

#### Scenario: Selección cambió
- **WHEN** la selección actual difiere del destino preparado
- **THEN** se conserva el destino explícito si sigue válido y se lo muestra; si no, se invalida la acción


### Requirement: El estado de los artefactos se lee del grafo de OpenSpec

El panel SHALL mostrar, para el cambio seleccionado, el estado de cada artefacto de planificación
tal como lo devuelve `openspec status --json`, y SHALL NOT derivarlo de un modelo propio. El estado
de cada artefacto (`done`, `ready` o `blocked`) SHALL leerse del campo `status.artifacts` del cambio
seleccionado, y cuando un artefacto esté `blocked` SHALL declarar qué dependencias le faltan.

La superficie del grafo SHALL mostrarse junto a los artefactos del cambio seleccionado. Cuando el
grafo no exista —`status` ausente, o `available: false` por un CLI que no pudo correr— la superficie
SHALL NOT renderizarse, y SHALL NOT inventarse un estado derivado de las tareas o la validación como
sustituto. SHALL NOT conservarse una barra de fases fijas ni un contador «Paso N de 5»; el error del motor se declara junto al lugar de inspección.

Lo que se rompe si no se cumple: el dato que `consume-openspec-status` cableó hasta el renderer
sigue sin consumirse, y el panel continúa mostrando progreso por un modelo de fases que OpenSpec
abandonó, perdiendo la información de qué artefacto bloquea a cuál —que es justo lo que el grafo
trae y la derivación propia no puede producir.

#### Scenario: Cambio seleccionado con grafo completo

- **WHEN** el cambio seleccionado tiene `status` con todos sus artefactos en `done`
- **THEN** la superficie muestra cada artefacto declarado como `done` y no muestra dependencias faltantes

#### Scenario: Artefacto bloqueado declara qué lo bloquea

- **WHEN** un artefacto del cambio seleccionado está en `blocked` con `missingDeps` no vacío
- **THEN** la superficie muestra ese artefacto como `blocked` y declara las dependencias que le faltan

#### Scenario: Sin grafo no se dibuja la superficie

- **WHEN** el cambio seleccionado tiene `status` ausente o `available: false`
- **THEN** la superficie del grafo no se renderiza y no aparece ningún estado inventado en su lugar

#### Scenario: Cambio no seleccionado

- **WHEN** no hay cambio seleccionado
- **THEN** la superficie del grafo no se renderiza, porque el grafo sólo existe para el cambio seleccionado
