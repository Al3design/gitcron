# ui-navigation-layout Specification

## Purpose
Dónde vive cada control según su alcance: la navegación entre vistas en el panel lateral, la barra superior ordenada por frecuencia, desplegables accesibles por teclado y un lienzo que se adapta sin reconstruir los nodos.
## Requirements
### Requirement: Cada control SHALL residir en la superficie que corresponde a su alcance

Un control SHALL ubicarse según sobre qué actúa: la navegación entre vistas y el mantenimiento de la
aplicación en el panel lateral, las acciones sobre el repositorio en el panel lateral junto a ellas, y
los controles que sólo afectan a una vista en el encabezado de esa vista. Un control SHALL NOT
permanecer visible en una pantalla donde no produce efecto, y SHALL NOT reservar espacio en ella.

Un control del armazón SHALL producir el mismo efecto en todas las vistas. SHALL NOT gobernar además
una estructura interna de alguna de ellas, aunque esa estructura se le parezca.

El fundamento es que la barra superior acumulaba cinco categorías distintas en una sola franja, y esa
mezcla obligaba a leerla entera para encontrar cualquier cosa. Cuando el lugar de un control depende
de su alcance, la ubicación deja de memorizarse y pasa a deducirse.

Lo que se agrega es la tercera parte de la regla, y tiene su propia evidencia. El estado de los
paneles del armazón se pasaba sin traducir a la vista del ciclo de especificación, que lo usaba para
su grilla interna: el mismo interruptor abría el panel lateral en una vista y una columna del cuerpo
en otra. Un control que significa dos cosas distintas según la pantalla obliga a aprender ambas, y
deshace lo que las dos primeras partes de esta regla buscaban.

#### Scenario: Selector que sólo aplica a una vista
- **WHEN** se está en una vista distinta de aquella que el selector afecta
- **THEN** ese selector no ocupa lugar ni reserva altura en ninguna superficie

#### Scenario: Selector en la vista que gobierna
- **WHEN** se está en la vista que el selector afecta
- **THEN** el selector aparece en el encabezado de esa vista

#### Scenario: Control del armazón en vistas distintas
- **WHEN** se acciona un control del armazón en cualquier vista
- **THEN** produce el mismo efecto en todas, y ninguno adicional propio de una de ellas

#### Scenario: Mantenimiento de la aplicación
- **WHEN** se presentan la versión de la aplicación y el estado de sus actualizaciones
- **THEN** se ubican junto a los ajustes, la ayuda y el perfil, y no entre las acciones del repositorio

### Requirement: La navegación entre vistas SHALL vivir en el panel lateral, encima de las ramas

Las vistas de la aplicación SHALL presentarse como una sección de navegación en la parte superior del
panel lateral, por encima de la lista de ramas, y SHALL declarar cuál está activa. La barra superior
SHALL NOT contener navegación.

El fundamento es de jerarquía: la vista que se está mirando es la decisión más abarcativa de la
pantalla —determina todo lo demás—, y hoy se toma en una franja compartida con acciones puntuales
como guardar temporalmente o aplicar un parche.

#### Scenario: Cambio de vista
- **WHEN** se elige otra vista en el panel lateral
- **THEN** el contenido cambia y la sección de navegación declara cuál quedó activa

#### Scenario: Panel lateral oculto
- **WHEN** el panel lateral está oculto
- **THEN** la navegación sigue siendo alcanzable, sea reabriéndolo o por teclado, y no queda inaccesible

### Requirement: Las acciones de la barra superior SHALL jerarquizarse por frecuencia de uso

Traer y publicar cambios SHALL permanecer visibles como acciones directas en el panel lateral, bajo
su título y por encima de la lista de ramas; deshacer, rehacer, crear rama, guardar temporalmente y
aplicar parche SHALL agruparse en un desplegable ubicado junto a ellas. Recargar SHALL permanecer
visible junto a las dos primeras. La aplicación SHALL NOT presentar una franja de acciones sobre el
repositorio entre la barra de ventana y el área de contenido.

Esa prohibición SHALL NOT alcanzar al encabezado del área de contenido, que es otra pieza: no
atraviesa el ancho de la ventana sino que empieza a la derecha del panel lateral, no lleva acciones
sobre el repositorio sino el rótulo de la vista y los controles cuyo alcance es esa vista, y
pertenece al contenido en lugar de anteponerse a él.

El fundamento de la jerarquía no cambia: traer y publicar son las operaciones que se repiten decenas
de veces por jornada, y esconderlas detrás de un menú agrega un paso a lo más frecuente para ahorrar
espacio en lo que se usa de a ratos. Recargar acompaña a esas dos porque es la misma operación
conceptual: sincronizar con el remoto.

Lo que cambia es dónde ocurre. Seis controles no justifican una franja que atraviesa la pantalla
entera antes de que empiece el trabajo, y la referencia declarada resuelve el
caso concentrando el control en el lateral y dejando la ventana con sus pestañas.

Lo que se agrega es la distinción entre las dos franjas. La redacción anterior prohibía «ninguna
franja de controles» entre la ventana y el contenido, y esa prohibición leída al pie alcanzaba al
encabezado de contenido, que sí lleva un control y que las vistas ya usaban antes de este change.
Nombrar las dos piezas por separado evita que la ambigüedad se resuelva sola cada vez que alguien
lea el requisito.

#### Scenario: Acción frecuente
- **WHEN** se quiere traer o publicar cambios
- **THEN** la acción se ejecuta con un solo clic desde el panel lateral, sin abrir ningún menú

#### Scenario: Acción ocasional
- **WHEN** se quiere crear una rama, guardar temporalmente o aplicar un parche
- **THEN** la acción está en el desplegable de acciones del panel lateral, rotulada y alcanzable por teclado

#### Scenario: Composición de la ventana
- **WHEN** se muestra cualquier vista de la aplicación
- **THEN** entre la barra de ventana y el área de contenido no existe ninguna franja de acciones sobre el repositorio

#### Scenario: Encabezado del contenido
- **WHEN** una vista encabeza su contenido con su rótulo y los controles de su alcance
- **THEN** esa franja está permitida, empieza a la derecha del panel lateral y no lleva acciones sobre el repositorio

### Requirement: Las herramientas auxiliares SHALL agruparse en un desplegable con sus atajos visibles

El terminal, el filtro y la búsqueda SHALL presentarse en un desplegable propio, y cada entrada SHALL
mostrar su atajo de teclado junto a su rótulo. El fundamento es doble: son superficies que se abren,
no acciones que se ejecutan, y quien las usa seguido termina usando el teclado —mostrar el atajo
donde está la entrada es lo que hace que se aprenda.

#### Scenario: Apertura de una herramienta
- **WHEN** se elige una herramienta del desplegable
- **THEN** se abre su superficie y el desplegable se cierra

#### Scenario: Atajo de teclado
- **WHEN** se presiona el atajo de una herramienta sin abrir el desplegable
- **THEN** la herramienta se abre igual

### Requirement: Todo desplegable SHALL cerrarse con Escape, con un clic afuera y SHALL ser recorrible por teclado

Un desplegable SHALL abrirse con clic o con teclado, SHALL cerrarse con la tecla de escape y con un
clic fuera de su superficie, SHALL permitir recorrer sus entradas con las flechas y activarlas con
Enter, y SHALL devolver el foco al control que lo abrió al cerrarse. El fundamento es que agrupar
controles detrás de un menú sólo mejora la pantalla si el menú no cuesta más que lo que ahorra: uno
que atrapa el foco o que obliga a alcanzar el mouse para cerrarse empeora lo que vino a resolver.

#### Scenario: Cierre por teclado
- **WHEN** hay un desplegable abierto y se presiona la tecla de escape
- **THEN** se cierra y el foco vuelve al control que lo abrió

#### Scenario: Recorrido por teclado
- **WHEN** hay un desplegable abierto y se recorren sus entradas con las flechas
- **THEN** el foco avanza entrada por entrada y Enter activa la que está enfocada

### Requirement: La barra del lienzo SHALL contraerse en un control y SHALL NOT llevar recuadro

El control ubicado en el extremo inferior derecho del área de contenido SHALL abrir el lector de
ramas futuras de forma directa, y SHALL NOT presentar un menú intermedio. Acercar, alejar y
restablecer el encuadre SHALL presentarse como controles sueltos sobre el lienzo, sin agruparse tras
ningún control. Ninguna de esas superficies SHALL llevar recuadro ni borde propio.

El lector de ramas futuras SHALL conservar su propia superficie desplegable, con sus pestañas y su
alto arrastrable, y SHALL NOT convertirse en una entrada de menú: es un panel de lectura, no una
acción, y necesita superficie para cumplir su función. El interruptor de ramas especulativas SHALL
vivir dentro de ese lector, que es aquello cuyo contenido gobierna.

El fundamento del cambio es de uso observado: agrupar los cinco controles tras un menú puso el lector
—que es una superficie de trabajo— detrás de dos clics y de una lista donde figuraba como si fuera
una acción más. Un menú cuya entrada principal abre otro panel es un rodeo, no una simplificación.

#### Scenario: Apertura del lector
- **WHEN** se activa el control del extremo inferior derecho
- **THEN** el lector de ramas futuras se despliega directamente, sin menú previo

#### Scenario: Controles de encuadre
- **WHEN** se muestra el lienzo
- **THEN** acercar, alejar y restablecer están disponibles como controles sueltos, sin recuadro y sin agrupamiento

#### Scenario: Interruptor de ramas especulativas
- **WHEN** se abre el lector de ramas futuras
- **THEN** el interruptor de ramas especulativas está dentro de él

### Requirement: El lienzo SHALL readaptarse al ancho de su contenedor sin reconstruir la capa de nodos

El lienzo cronométrico SHALL observar el tamaño de su contenedor y recalcular el encuadre cuando
cambie —al mostrar u ocultar un panel lateral, al arrastrar su separador o al redimensionar la
ventana—, y ese recálculo SHALL alterar únicamente la transformación del encuadre, sin reconstruir la
capa de nodos de commit.

El fundamento del primer punto es que hoy el lienzo no reacciona: el problema quedaba oculto porque
el panel derecho flotaba por encima y una máscara desvanecía el grafo justo debajo, y al retirar
ambos el dibujo quedó tapado. El fundamento del segundo es el requisito ya vigente en
`graph-render-isolation`: los nodos no cambian de posición en coordenadas de mundo cuando cambia el
encuadre, y reconstruirlos produce elementos idénticos a los anteriores, que es el trabajo que impide
sostener el cuadro. Un ajuste de ancho que reconstruya nodos convierte una mejora de composición en
una caída de rendimiento.

La observación SHALL hacerse sobre el contenedor y no mediante escuchas de tamaño de ventana, porque
el ancho del lienzo cambia también cuando la ventana no cambia.

El recálculo SHALL preservar el punto del grafo que ocupaba el centro del área visible: restringir
los desplazamientos a los nuevos límites no alcanza, porque deja el contenido anclado a las
coordenadas del ancho anterior y el dibujo se corre al plegar un panel. Preservar el centro es
además lo que evita perder la posición cuando alguien desplazó el encuadre para mirar una parte
distinta del historial.

El encuadre inicial SHALL centrarse cuando el contenedor tenga su tamaño estable, y no con el ancho
del primer instante: los paneles laterales se montan después, de modo que centrar antes deja el
contenido descentrado sin que nada vuelva a corregirlo.

La compensación SHALL aplicarse en el mismo cuadro en que el contenedor cambia, y SHALL NOT esperar
un ciclo de estado. El fundamento es que el contenedor se mueve por animación del navegador mientras
la compensación pasa por el estado de la interfaz: ese ciclo de diferencia hace que el contenido
viaje con el contenedor y vuelva un cuadro después. Se percibe como un rebote, y no se corrige con
aritmética porque el cálculo ya es correcto: llega tarde. Es visible sólo cuando el contenedor además
se desplaza —al plegar el panel izquierdo—, no cuando únicamente cambia de ancho.

#### Scenario: Plegado del panel que desplaza el contenedor
- **WHEN** se pliega o despliega el panel lateral izquierdo, que desplaza el contenedor además de cambiar su ancho
- **THEN** el contenido se mantiene en su lugar durante toda la animación, sin desviarse y volver

#### Scenario: Se muestra u oculta un panel lateral
- **WHEN** se muestra u oculta un panel lateral y el ancho del lienzo cambia
- **THEN** el punto que ocupaba el centro del área visible sigue ocupándolo, y el contenido no se desplaza

#### Scenario: Apertura de un repositorio
- **WHEN** se abre un repositorio y el lienzo se dibuja por primera vez
- **THEN** el encuadre queda centrado sobre el nodo activo una vez que el área de contenido alcanzó su tamaño estable

#### Scenario: Arrastre del separador
- **WHEN** se arrastra el separador de un panel lateral
- **THEN** el lienzo acompaña el cambio de ancho sin reconstruir la capa de nodos

#### Scenario: Redimensionado sin cambio de contenido
- **WHEN** cambia el tamaño del contenedor y no cambian los commits, la selección ni el hover
- **THEN** la capa de nodos no se vuelve a construir

### Requirement: La barra de ventana SHALL alojar los controles de plegado y la búsqueda

Los controles que muestran u ocultan los paneles laterales, y el acceso a la búsqueda, SHALL ubicarse
en la barra de ventana, a la derecha de las pestañas de repositorio. SHALL permanecer alcanzables
cuando cualquiera de los paneles esté plegado.

El fundamento es que un control de disposición no puede vivir dentro de aquello que dispone: si el
control que reabre el panel lateral estuviera en el panel lateral, plegarlo lo dejaría inalcanzable.
La barra de ventana es la única superficie que no se pliega, y es donde la referencia declarada ubica sus propios controles equivalentes.

#### Scenario: Panel lateral plegado
- **WHEN** el panel lateral está plegado
- **THEN** su control de despliegue sigue visible en la barra de ventana

#### Scenario: Posición estable
- **WHEN** se cambia de vista o de repositorio
- **THEN** los controles de plegado y la búsqueda permanecen en la misma posición

### Requirement: La navegación entre vistas SHALL presentarse como un desplegable encabezado por la vista activa

La navegación SHALL mostrar la vista actual como encabezado del panel lateral y SHALL desplegar las
demás al activarse; al elegir una, el encabezado SHALL pasar a nombrarla. SHALL cumplir el
comportamiento de teclado que rige para todo desplegable de la aplicación.

La vista del ciclo de especificación SHALL nombrarse `SDD` en toda superficie donde la persona lea
su nombre, y esa sigla SHALL NOT traducirse: se lee igual en los tres idiomas. El nombre que la
persona lee SHALL poder diferir del identificador que el código usa para esa misma vista.

El fundamento es que cuatro filas permanentes ocupan altura para una decisión que se toma de a una
por vez y que cambia pocas veces por sesión, mientras la lista de ramas —que se recorre
continuamente— compite por ese mismo espacio. El encabezado que nombra la vista activa cumple además
una segunda función: declara dónde se está, que hoy sólo se deduce de cuál pestaña está resaltada.

Y si declara dónde se está, tiene que decirlo bien. «Pipeline» viene de la integración continua,
donde una tubería encadena etapas automáticas de compilación y despliegue; lo que la vista muestra
es el ciclo de proponer un cambio, especificarlo, implementarlo y archivarlo. En chino el nombre
llegó a leerse `流水线`, «línea de producción», que agrava el mismo malentendido. La sigla queda sin
traducir porque nombra la práctica del oficio, como ya ocurre con «Commit» y «Stash».

La divergencia entre el nombre leído y el interno queda declarada a propósito: las claves de
traducción, las capacidades y los componentes siguen diciendo `pipeline`, porque renombrarlos
arrastraría los deltas, los tests y la historia de archivo de doce capacidades sin que nadie note la
diferencia en pantalla.

Las vistas SHALL seguir siendo alcanzables por atajo de teclado sin abrir el desplegable, como ya lo
son hoy.

#### Scenario: Cambio de vista
- **WHEN** se elige otra vista en el desplegable
- **THEN** el contenido cambia y el encabezado pasa a nombrar la vista elegida

#### Scenario: Atajo de teclado
- **WHEN** se usa el atajo de una vista sin abrir el desplegable
- **THEN** la vista cambia igual y el encabezado la refleja

#### Scenario: Nombre de la vista del ciclo de especificación
- **WHEN** se muestra el nombre de esa vista en cualquier superficie y en cualquiera de los tres idiomas
- **THEN** dice SDD, y no dice Pipeline ni su traducción

#### Scenario: Identificador interno
- **WHEN** el código nombra esa vista en una clave de traducción, una capacidad o un componente
- **THEN** puede seguir diciendo pipeline, porque ese nombre no llega a pantalla

### Requirement: El estado del repositorio SHALL mostrarse junto a su nombre en el panel lateral

La rama actual, el estado del árbol de trabajo y el de validación SHALL presentarse como indicadores
junto al nombre del repositorio en el panel lateral, disponibles en todas las vistas.

El fundamento es que hoy esa información vive dentro de una sola vista, y sirve en todas: al preparar
un commit importa en qué rama se está, y al mirar el historial también. Presentarla como indicador
—del mismo modo que las ramas ya declaran su estado de sincronización— la hace legible de un vistazo
sin ocupar una franja propia.

#### Scenario: Estado visible en cualquier vista
- **WHEN** se está en cualquier vista de la aplicación
- **THEN** la rama actual y el estado del árbol de trabajo se leen junto al nombre del repositorio

#### Scenario: Estado señalado sin depender del color
- **WHEN** un indicador comunica una condición del repositorio
- **THEN** se distingue por forma o rótulo además de por color

