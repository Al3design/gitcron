# ui-visual-system Specification

## Purpose
El sistema visual de GitCron: escalas en tokens para tipografía, espaciado y radios, armazón continuo separado por fondo, accesibilidad (legibilidad, contraste AA, foco, área táctil de 44 px, ampliación al 200 %), prosa sin repeticiones y estilos escritos con un solo sistema (módulos CSS) y piezas compartidas.

## Requirements

### Requirement: La tipografía y el espaciado SHALL derivar de una escala en tokens, sin números sueltos

Todo tamaño de fuente y toda medida de espaciado SHALL declararse mediante variables CSS de una
escala acotada, y no MUST escribirse como valor literal en un componente. La medición que lo motiva:
el proyecto declara hoy veinte tamaños de fuente distintos, con ciento dieciocho declaraciones por
debajo de doce píxeles, y ninguna variable de espaciado ni de tipografía —las cuarenta existentes son
de color, radio o disposición—. Sin escala, cada panel elige su número a ojo y ningún par de
pantallas respira igual: el desorden no es de criterio sino de infraestructura.

#### Scenario: Un componente declara un tamaño
- **WHEN** un componente necesita un tamaño de fuente o una medida de espaciado
- **THEN** lo toma de la escala en tokens y no escribe el valor literal

#### Scenario: Un valor queda fuera de la escala
- **WHEN** una hoja de estilos declara un tamaño o espaciado que no pertenece a la escala
- **THEN** la verificación automática falla identificando archivo y declaración

### Requirement: El texto SHALL respetar un piso de legibilidad y distinguir el cuerpo del dato accesorio

La escala SHALL fijar un tamaño mínimo por debajo del cual ningún texto de la interfaz se declara, y
SHALL distinguir el cuerpo del dato accesorio por más que su tamaño. Hoy el grueso de la aplicación
vive entre nueve y trece píxeles, y a esa altura la jerarquía se pierde: un rótulo, un valor y una
nota al pie se leen igual de chicos, así que la pantalla no dice qué es importante y hay que leerla
entera para encontrar el dato.

#### Scenario: Texto por debajo del piso
- **WHEN** una hoja de estilos declara un texto por debajo del tamaño mínimo de la escala
- **THEN** la verificación automática falla

#### Scenario: Jerarquía perceptible
- **WHEN** una pantalla presenta un dato principal junto a su metadato
- **THEN** se distinguen por peso o color además de por tamaño, sin depender sólo de la diferencia de puntos

### Requirement: El armazón SHALL distinguirse del contenido por fondo y geometría

La barra superior y la barra lateral SHALL compartir el fondo declarado para el armazón, el área de
contenido SHALL apoyarse sobre el fondo de página, y el encuentro entre ambos SHALL resolverse con
una esquina redondeada que separe las dos superficies. La paleta ya declara esa intención
—`--color-bg-surface` documentada como fondo de barras, laterales y paneles de lista, y
`--color-bg-base` como fondo de página— pero no se aplica de forma consistente, de modo que hoy todo
se lee como una superficie continua y nada indica dónde termina la herramienta y empieza aquello
sobre lo que se está trabajando.

#### Scenario: Composición de la pantalla principal
- **WHEN** se muestra cualquier vista de la aplicación
- **THEN** las barras superior y lateral comparten el fondo del armazón, el contenido usa el fondo de página, y el encuentro entre ambos exhibe la esquina redondeada

#### Scenario: Panel lateral oculto
- **WHEN** se oculta un panel lateral
- **THEN** el contenido ocupa el espacio liberado conservando la separación de fondos y la esquina redondeada contra el armazón restante

### Requirement: El armazón SHALL ser una superficie continua y sus paneles SHALL NOT presentarse como cajas

Las barras y los paneles laterales SHALL leerse como una única superficie continua, sin borde propio,
sin radio propio y sin separación respecto del borde de la ventana. La geometría SHALL aparecer
únicamente en el encuentro entre armazón y contenido. Hoy conviven dos gramáticas opuestas: en la
vista de grafo los dos paneles son tarjetas con borde que flotan sobre el lienzo, mientras que en
otras vistas las columnas se pegan a los bordes; el resultado es que el mismo elemento se presenta de
dos maneras según dónde se lo mire, y la persona no puede aprender la composición una vez. La
referencia declarada —aplicaciones de trabajo del estilo de Codex o Unsloth—
resuelve esto con una sola superficie de armazón y una sola arista contra el contenido.

Esta regla alcanza al armazón, no al contenido: dentro del área de trabajo las tarjetas que agrupan
información SHALL poder conservar borde y radio, porque ahí sí distinguen unidades de información
entre sí.

#### Scenario: Panel lateral en cualquier vista
- **WHEN** se muestra un panel lateral, incluida la vista de grafo
- **THEN** se presenta sin borde ni radio propios, continuo con el resto del armazón, y sin separación respecto del borde de la ventana

#### Scenario: Vista de grafo, en cualquiera de sus modos
- **WHEN** se muestra la vista de grafo, tanto en su modo clásico como en el cronométrico
- **THEN** los paneles integran el armazón y el lienzo del grafo se comporta como contenido apoyado, con la misma arista que el resto de las vistas

#### Scenario: Composición condicionada por un modo de vista
- **WHEN** la composición de un panel o de una barra depende de un modo de vista
- **THEN** todas las ramas de esa condición cumplen esta regla, y la verificación ejercita el modo que la aplicación resuelve por omisión

#### Scenario: Agrupación dentro del contenido
- **WHEN** el área de contenido agrupa información en tarjetas
- **THEN** esas tarjetas conservan borde y radio, tomados de la escala de radios existente

### Requirement: La separación entre superficies SHALL darse por fondo, y el armazón SHALL NOT usar líneas divisorias

Las barras, las solapas, los paneles laterales y los controles del armazón SHALL distinguirse entre
sí por su fondo y por el espacio que los separa, y SHALL NOT llevar líneas divisorias ni contornos.
Hoy hay veintitrés declaraciones de borde repartidas en cinco opacidades distintas —del diez al
cuarenta por ciento— sin criterio que las gobierne: cada una se eligió para el elemento que se estaba
escribiendo, y juntas producen una retícula de líneas tenues que fragmenta la pantalla sin separar
nada que el fondo no separe mejor.

Quedan exceptuados el indicador de foco, que necesita un contorno para cumplir su función, y las
tarjetas dentro del área de contenido, que agrupan unidades de información entre sí.

Cuando dos superficies contiguas se distinguen sólo por su fondo, la diferencia entre ambos SHALL ser
perceptible: sin línea que las separe, un contraste insuficiente entre fondos deja de comunicar el
límite en lugar de sugerirlo con discreción.

#### Scenario: Encuentro entre dos zonas del armazón
- **WHEN** dos zonas del armazón se tocan —barra con panel, panel con contenido, solapa con barra—
- **THEN** se distinguen por fondo y espacio, sin línea divisoria entre ellas

#### Scenario: Control interactivo en el armazón
- **WHEN** se presenta un botón o una solapa en el armazón
- **THEN** su condición de control se comunica por fondo, por estado y por su área, no por un contorno

#### Scenario: Indicador de foco
- **WHEN** un control recibe el foco por teclado
- **THEN** exhibe su contorno, que es la única línea que el armazón conserva

### Requirement: La vista cronométrica SHALL prescindir del decorado que no representa datos del repositorio

La vista cronométrica SHALL mostrar únicamente elementos que representen información real —la
diagonal temporal, los nodos de commit, sus rótulos, las órbitas de rama, las reglas métricas, la
retícula del nodo activo y las ramas especulativas— y SHALL NOT incorporar decorado ajeno a los
datos: paneles ilustrativos de fondo ni rótulos técnicos inventados. El decorado se concibió para una
composición donde los paneles flotaban por encima y lo tapaban en parte; con los paneles convertidos
en columnas queda expuesto entero, ocupa superficie que el grafo necesita y presenta como
instrumentación lo que no mide nada.

La distinción es entre representar y ambientar, no entre útil y adornado: la retícula del nodo activo
y las órbitas de rama son dibujo, y se quedan, porque señalan algo que existe en el repositorio.

#### Scenario: Vista cronométrica
- **WHEN** se muestra la vista cronométrica
- **THEN** se ven la diagonal, los nodos, sus rótulos, las órbitas de rama y las ramas especulativas, sin paneles ilustrativos de fondo ni rótulos técnicos que no correspondan a una medición

#### Scenario: Rótulo que no mide nada
- **WHEN** un rótulo de la vista presenta un valor con apariencia de medición
- **THEN** ese valor proviene del repositorio o del estado real, y no es un texto fijo de ambientación

### Requirement: Los radios SHALL tomarse de la escala existente y no declararse literales

Toda esquina redondeada SHALL usar una de las variables de radio ya definidas en `app/globals.css`
—de `--radius-sm` a `--radius-full`— y no MUST escribirse como valor literal. La escala existe desde
antes de este change y aun así hay paneles declarando `border-radius: 8px` y `6px` a mano: es el
mismo defecto que los tamaños de fuente, en la geometría, y produce el mismo efecto de que dos
elementos equivalentes no se vean iguales.

#### Scenario: Radio literal en una hoja de estilos
- **WHEN** una hoja de estilos declara un `border-radius` que no proviene de la escala
- **THEN** la verificación automática falla identificando archivo y declaración

### Requirement: Los controles de mostrar y ocultar paneles SHALL ser visibles y consistentes

Los controles que muestran u ocultan los paneles laterales SHALL estar visibles en el armazón, SHALL
declarar su estado actual mediante texto accesible, y SHALL cumplir el área objetivo mínima. Ya
existen y funcionan; lo que este requisito fija es que no se escondan ni cambien de lugar según la
vista, porque un control de disposición que aparece y desaparece obliga a buscarlo cada vez en lugar
de aprenderlo una.

#### Scenario: Estado del control
- **WHEN** un panel lateral está visible u oculto
- **THEN** su control declara la acción que ejecutaría y permanece en la misma posición del armazón

### Requirement: Todo control interactivo SHALL alcanzar un área objetivo de 44 por 44 píxeles

Cualquier elemento que reciba clic, toque o activación por teclado SHALL ofrecer un área de al menos
cuarenta y cuatro por cuarenta y cuatro píxeles CSS, contando el relleno alrededor de su contenido
visible. El mínimo exigible del estándar es veinticuatro, y este proyecto adopta el valor reforzado
porque la aplicación es de uso sostenido y sus controles conviven muy juntos: cuando dos acciones
distintas quedan a pocos píxeles, errar el clic no es una molestia sino una acción no deseada.

#### Scenario: Control por debajo del área
- **WHEN** un control queda con un área menor a cuarenta y cuatro píxeles en cualquiera de sus lados
- **THEN** la verificación automática falla identificando el control

#### Scenario: Controles contiguos
- **WHEN** dos controles se presentan uno junto al otro
- **THEN** sus áreas objetivo no se superponen y existe separación suficiente para no confundirlos

### Requirement: El contraste SHALL cumplir el nivel AA para texto y para elementos que no son texto

El texto SHALL alcanzar una relación de contraste de al menos 4,5 a 1 contra su fondo, y 3 a 1 cuando
sea texto grande; los bordes de controles, los indicadores de estado y el indicador de foco SHALL
alcanzar al menos 3 a 1. Sobre fondo oscuro es fácil quedar corto sin notarlo: un gris tenue se ve
elegante en la pantalla de quien lo eligió y desaparece en otra, y un estado que sólo se distingue
por un color apagado deja de comunicar.

#### Scenario: Texto con contraste insuficiente
- **WHEN** una combinación de color de texto y fondo no alcanza la relación exigida
- **THEN** la verificación automática falla informando el par de colores y la relación obtenida

#### Scenario: Estado señalado sólo por color
- **WHEN** un estado se comunica mediante color
- **THEN** existe además un rótulo, ícono o forma que lo distingue sin depender del color

### Requirement: El foco SHALL ser visible, alcanzable y no quedar tapado

Todo control alcanzable por teclado SHALL exhibir un indicador de foco visible que cumpla el
contraste exigido, y ninguna barra fija, encabezado pegajoso ni superposición SHALL ocultarlo. Un
foco invisible deja la navegación por teclado sin punto de referencia, y uno tapado por una barra
obliga a desplazar a ciegas para saber dónde se está parado.

#### Scenario: Recorrido por teclado
- **WHEN** se recorre una pantalla con el tabulador
- **THEN** cada control enfocado muestra su indicador y queda completamente a la vista

### Requirement: La interfaz SHALL sostener el ajuste de espaciado de texto y la ampliación al 200 por ciento

La aplicación SHALL conservar todo su contenido y sus funciones cuando se aumenta el interlineado a
1,5 veces el tamaño de fuente, el espaciado entre letras a 0,12 em y entre palabras a 0,16 em, y
cuando la interfaz se amplía al doble. El fundamento es que un alto fijo en píxeles alrededor de un
texto recorta ese texto en cuanto crece, y un panel apretado se rompe antes que uno con ritmo: el
espaciado ajustable es también la prueba de que la escala está bien construida.

#### Scenario: Aumento de espaciado
- **WHEN** se aplican los valores de espaciado de texto exigidos
- **THEN** ningún contenido se recorta, superpone ni deja de ser alcanzable

#### Scenario: Ampliación al doble
- **WHEN** la interfaz se amplía al doscientos por ciento
- **THEN** todas las acciones siguen disponibles sin desplazamiento horizontal de la página

### Requirement: La prosa de la interfaz SHALL no repetirse ni competir con la acción

Un texto que orienta sobre lo que hace una pantalla SHALL poder mostrarse, y SHALL NOT repetirse
dentro de la misma vista ni ubicarse por delante de la acción que la persona vino a ejecutar. El caso
que lo motiva es concreto: `pipeline.openspec.engine.review.safetyHelp` —veintisiete palabras— se
renderiza dos veces en la misma pantalla, en `components/pipeline/OpenSpecUpdateReview.tsx:138` y
`:147`. Repetir un párrafo no refuerza: entrena a saltearlo, y con él se saltea lo que sí importaba.

#### Scenario: Texto repetido en una vista
- **WHEN** una vista renderiza dos veces el mismo texto de orientación
- **THEN** se conserva una sola aparición, ubicada donde acompaña a la acción y no delante de ella

#### Scenario: Orientación extensa
- **WHEN** un texto de orientación excede lo que se lee de un vistazo
- **THEN** se presenta de forma que no desplace a las acciones fuera de la primera pantalla

### Requirement: Los estilos SHALL escribirse con un solo sistema y piezas compartidas

El código nuevo SHALL escribir sus estilos con el sistema elegido para el proyecto, usando sólo tokens de `@theme` como valores. Un acomodo o estilo de texto que se repite tres veces o más SHALL resolverse con una pieza compartida de `components/ui/` en lugar de reescribir sus reglas. Una clase SHALL vivir en un solo módulo CSS, y una regla combinada SHALL quedar en el módulo donde viven sus clases. Ningún módulo SHALL declarar alias locales que repitan un token global.

#### Scenario: Acomodo repetido
- **WHEN** una vista necesita una columna con separación de la escala
- **THEN** usa la pieza compartida en lugar de declarar `display: flex`, `flex-direction: column` y `gap` en su módulo

#### Scenario: Sin cambios visibles
- **WHEN** una zona reemplaza sus bloques repetidos por piezas compartidas
- **THEN** las capturas de esa zona antes y después son iguales y las pruebas existentes pasan sin cambiar lo que comprueban

#### Scenario: Sin alias de tokens
- **WHEN** una hoja de estilos necesita un espaciado de la escala
- **THEN** usa `var(--space-N)` de `@theme` y no un alias local como `--sp-N`
