# sdd-body-layout Specification

## Purpose
Cómo se arma el cuerpo de la pantalla SDD: jerarquía visible, controles que se ven como lo que son, cada dato una sola vez, un único ancho derivado del contenedor, encabezado y riel que no se pisan, y cada zona o vista de SDD como un módulo propio.

## Requirements

### Requirement: La presentación SHALL declarar su jerarquía

Un cuerpo de contenido SHALL presentar sus bloques en un orden que corresponda a lo que se va a
hacer, y SHALL distinguir por tamaño, peso y posición lo que importa de lo accesorio. La jerarquía
NO SHALL depender del color: el color identifica o comunica un dato, no ordena.

El fundamento es medido. Con las columnas retiradas, el cuerpo de la vista del ciclo quedó con la
cabecera ocupando el primer tercio de la pantalla —volver, nombre, fecha, intención recortada con
puntos suspensivos, tres solapas y tres botones del mismo peso— y la lista de tareas abajo del
pliegue. Lo primero que se lee no es lo primero que se hace.

#### Scenario: Un bloque accesorio por encima del principal
- **WHEN** un bloque que informa una condición permanente se presenta antes que el trabajo en curso
- **THEN** se reordena para que el trabajo se lea primero, o el bloque se pliega

#### Scenario: Controles de distinto peso presentados igual
- **WHEN** una fila reúne la acción principal y acciones accesorias
- **THEN** la principal se distingue por tratamiento, y las accesorias no compiten con ella

### Requirement: Un control SHALL verse como lo que es

Un control SHALL presentarse con la forma que corresponde a su función. Una solapa SHALL verse como
solapa y no como botón, aunque su semántica ya sea correcta.

El caso declarado: `components/pipeline/PipelineDetails.tsx:61` ya declara `role="tab"` dentro de un
`role="tablist"`, pero cada solapa lleva borde, fondo y radio propios, así que la fila se lee como
cinco botones sueltos. La semántica estaba bien y la forma decía otra cosa.

#### Scenario: Forma que contradice la función
- **WHEN** un control declara un rol y se presenta con la forma de otro
- **THEN** la forma se corrige, no el rol

### Requirement: Un dato NO SHALL presentarse dos veces en la misma pantalla

Cuando un dato ya se declara en la franja de identidad o en el panel lateral, el cuerpo NO SHALL
repetirlo. Cuando un estado se puede decir con un ícono, NO SHALL ocupar además una palabra por
ficha.

Casos declarados: el avance del cambio aparece en la barra del lateral y otra vez en el texto del
siguiente paso; el aviso de rama repite lo que la franja ya dice; la ficha de tarea informa «No
informado» en tres de sus cuatro filas; y las fichas de artefactos repiten la palabra «HECHO» cuatro
veces seguidas donde alcanzaría un ícono.

#### Scenario: Dato repetido entre franja y cuerpo
- **WHEN** un dato ya presentado en la franja de identidad vuelve a presentarse en el cuerpo
- **THEN** se retira del cuerpo

#### Scenario: Estado repetido en fichas contiguas
- **WHEN** varias fichas contiguas declaran el mismo estado con la misma palabra
- **THEN** el estado se presenta con un ícono

### Requirement: El ancho del cuerpo SHALL derivarse del contenedor y ser uno solo

El cuerpo SDD SHALL declarar un único ancho de contenido, consumido por el encabezado del cambio,
el cuerpo, sus paneles y el esqueleto de carga, y SHALL derivarlo del ancho del contenedor: crece
en contenedores anchos y conserva un relleno lateral propio en todos los casos. Tres anchos
independientes para el mismo cuerpo es lo que hoy hace que un panel asome por los costados del
encabezado y que en un monitor grande el contenido quede flotando en una columna angosta.

#### Scenario: Contenedor ancho
- **WHEN** el contenedor del cuerpo mide 1400 px o más
- **THEN** el contenido usa un ancho mayor que el base y conserva relleno lateral; ningún texto toca los bordes del contenedor

#### Scenario: Contenedor angosto
- **WHEN** el contenedor mide menos que el ancho base
- **THEN** el contenido ocupa el ancho disponible con el mismo relleno lateral, sin desborde horizontal

#### Scenario: Un solo ancho
- **WHEN** se mide el ancho del encabezado, del cuerpo, de un panel del cuerpo y del esqueleto de carga
- **THEN** los cuatro coinciden

### Requirement: El encabezado pegajoso SHALL cubrir el ancho del cuerpo

El encabezado del cambio SHALL seguir pegajoso al scrollear y SHALL cubrir con fondo opaco el
ancho del cuerpo, de modo que ningún contenido del cuerpo se vea por debajo ni por los costados.

#### Scenario: Scroll con un panel abierto
- **WHEN** el panel «Confirmar archivado» está abierto y la lista de tareas se scrollea
- **THEN** el panel pasa por debajo del encabezado sin asomar por los costados

### Requirement: El riel flotante SHALL mantener separación del encabezado

El riel flotante SHALL quedar separado de la línea inferior del encabezado por un espacio de la
escala, tanto pegado al scrollear como en reposo.

#### Scenario: Riel en reposo y pegado
- **WHEN** el cuerpo está arriba del todo y cuando está scrolleado
- **THEN** entre el borde inferior del encabezado y el borde superior del riel hay el mismo espacio, mayor que cero

### Requirement: Cada zona y vista de SDD SHALL ser un módulo propio

La pantalla de SDD SHALL componerse de módulos separados por zona (barra de estado, preparación del commit, encabezado del cambio, cada vista del cambio, cambio archivado, pantallas de inicio). Cada módulo SHALL recibir por props o por un hook con nombre sólo los datos que muestra, y SHALL tener su propio módulo de estilos. Una vista SHALL poder montarse en una prueba sin montar la pantalla entera. La partición NO SHALL cambiar lo que se ve, los textos, los nombres accesibles ni la navegación.

#### Scenario: Probar una vista sola
- **WHEN** una prueba monta la vista Tareas con un cambio de ejemplo
- **THEN** la vista se muestra sin montar la barra de estado, la preparación del commit ni las otras vistas

#### Scenario: Cambio acotado
- **WHEN** una tanda modifica sólo la vista Resumen
- **THEN** los archivos tocados son los de esa vista y sus estilos, y la verificación de lo tocado no arrastra las pruebas de las otras zonas

#### Scenario: Misma pantalla
- **WHEN** se abre un cambio antes y después de la partición
- **THEN** la vista inicial, las entradas del menú de vistas, los textos y los nombres accesibles son los mismos
