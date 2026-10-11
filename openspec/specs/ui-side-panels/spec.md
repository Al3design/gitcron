# ui-side-panels Specification

## Purpose
Los paneles laterales son parte del armazón y las vistas sólo aportan su contenido; el panel derecho es una tarjeta que se puede redimensionar.
## Requirements
### Requirement: Los lugares de panel SHALL pertenecer al armazón y las vistas SHALL aportar contenido

El armazón SHALL declarar dos lugares de panel, uno a cada lado del área de contenido. Cada vista
SHALL poblarlos con su contenido y SHALL NOT declarar estructura propia de paneles dentro de su
cuerpo.

El fundamento es que hoy hay dos sistemas conviviendo. El armazón tiene su panel lateral y su panel
de detalles; la vista del ciclo de especificación dibuja además tres columnas propias dentro del área
de contenido. En esa vista se ven cuatro columnas y ninguna declaración dice cuál corresponde a cuál,
de modo que plegar un panel produce efectos distintos según la vista. Cuando el lugar es del armazón
y el contenido de la vista, la estructura se lee una sola vez.

#### Scenario: Vista con contexto de lo seleccionado
- **WHEN** una vista necesita mostrar el detalle de aquello que la persona eligió
- **THEN** lo aporta al lugar derecho del armazón, y no abre una columna propia

#### Scenario: Cambio de vista
- **WHEN** se pasa de una vista a otra
- **THEN** los paneles conservan si estaban abiertos o cerrados, y sólo cambia lo que muestran

### Requirement: Un control del armazón SHALL NOT gobernar la estructura interna de una vista

El estado abierto o cerrado de cada lugar de panel SHALL gobernar únicamente ese lugar. SHALL NOT
gobernar además ninguna estructura interna de una vista, y plegar un panel SHALL producir el mismo
efecto en todas.

El fundamento es una línea concreta: el estado de los paneles del armazón se pasa hoy sin traducir a
la vista del ciclo de especificación, que lo usa para su grilla interna. El mismo interruptor abre el
panel lateral en una vista y una columna interna en otra. Quien lo usa aprende dos comportamientos
para un mismo control, y termina ocultando paneles a mano cada vez que cambia de pantalla.

#### Scenario: Plegar un panel
- **WHEN** se pliega uno de los dos paneles del armazón, en cualquier vista
- **THEN** se pliega ese panel y nada más

#### Scenario: Estructura interna de una vista
- **WHEN** una vista organiza su cuerpo en zonas
- **THEN** esas zonas no dependen del estado de los paneles del armazón

### Requirement: El panel derecho SHALL ser una tarjeta de ancho y alto arrastrables

El panel derecho SHALL repartir el ancho con el área de contenido, que SHALL reacomodarse al
plegarlo o al cambiar su ancho. SHALL NOT superponerse al contenido.

Su alto SHALL ser propio y menor que el de su columna, y SHALL poder ajustarse arrastrando con el
puntero, del mismo modo que su ancho. Ambas medidas SHALL acotarse entre un mínimo y un máximo
declarados, y SHALL restituirse al volver a abrir la aplicación.

El fundamento es que el contenido de esta aplicación es un grafo que se quiere ver entero: un panel
que se superponga tapa a mitad de lectura y molesta más de lo que suma. Lo que sí falta es poder
darle al panel el alto que cada momento pide —un detalle de commit corto no necesita la columna
entera—, y esa medida hoy no se puede tocar.

La mecánica ya existe en la aplicación: el panel de relaciones de la vista de cartografía y el lector
de ramas futuras del grafo cronométrico ajustan su alto arrastrando, acotado y persistido. Este
requisito no introduce una forma nueva de interactuar; extiende una que ya se usa.

#### Scenario: Ajuste de alto
- **WHEN** se arrastra el borde del panel derecho en vertical
- **THEN** su alto cambia dentro de sus límites y el contenido de al lado no se desplaza

#### Scenario: Ajuste de ancho
- **WHEN** se arrastra el borde del panel derecho en horizontal
- **THEN** el área de contenido se reacomoda, sin que el panel se superponga

#### Scenario: Reapertura de la aplicación
- **WHEN** se cierra y se vuelve a abrir la aplicación
- **THEN** el panel derecho recupera el ancho y el alto que tenía

