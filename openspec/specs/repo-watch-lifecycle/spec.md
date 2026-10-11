# repo-watch-lifecycle Specification

## Purpose
Observar cada repositorio abierto una sola vez, por eventos y con un único handle recursivo, refrescando sin relecturas redundantes y limpiando al cerrar.

## Requirements

### Requirement: Una sola observación por repositorio abierto
La aplicación SHALL mantener una única suscripción a los eventos de cambio del repositorio y un
único temporizador de respaldo, sin importar cuántos componentes usen las funciones de carga y
refresco. Obtener esas funciones SHALL NOT crear observación alguna.

El fundamento es que la observación es un recurso de alcance global —procesos de Git y eventos de
sistema de archivos— mientras que las funciones de refresco son de uso local. Atarlas en el mismo
hook hace que el costo se multiplique por cada consumidor, y ninguno lo pidió.

#### Scenario: Varios componentes usan las funciones de refresco
- **WHEN** varios componentes obtienen las funciones de carga y refresco del repositorio
- **THEN** no se agrega ninguna suscripción a los eventos de cambio ni ningún temporizador por esas
  obtenciones

#### Scenario: Un cambio de archivo con varios consumidores montados
- **WHEN** el sistema de archivos notifica un cambio y hay varios componentes usando las funciones
  de refresco
- **THEN** el estado del árbol se relee una sola vez

### Requirement: Los disparadores de refresco se conservan
La observación única SHALL conservar los mismos disparadores que existían por consumidor: cambio en
el sistema de archivos, commits hechos por la aplicación, foco de ventana, cambio de visibilidad y
temporizador de respaldo. Ningún disparador SHALL perderse al unificar.

#### Scenario: Commit hecho por la aplicación
- **WHEN** la aplicación confirma commits en el repositorio observado
- **THEN** se releen el log, el estado y las ramas, una sola vez cada uno

#### Scenario: Ventana que recupera el foco
- **WHEN** la ventana vuelve a tener foco o pasa a ser visible
- **THEN** el estado del árbol se relee una sola vez

### Requirement: Montaje duplicado declarado en desarrollo
Si la observación se monta más de una vez para el mismo repositorio, la aplicación SHALL declararlo
en la consola durante el desarrollo. La condición SHALL NOT degradar el rendimiento en silencio.

El fundamento es que este defecto ya ocurrió y sólo se detectó por una advertencia genérica del
emisor de eventos, después de que el costo fuera visible para el usuario.

#### Scenario: Segundo montaje de la observación
- **WHEN** un segundo componente monta la observación del mismo repositorio en desarrollo
- **THEN** se declara la condición en consola identificando el hook responsable

### Requirement: Limpieza al cerrar la observación
Al desmontarse, la observación SHALL cancelar su temporizador, quitar sus listeners y pedir el cese
de la vigilancia del repositorio, sin dejar trabajo pendiente que se ejecute después.

#### Scenario: Desmontaje con un refresco pendiente
- **WHEN** la observación se desmonta con un refresco en espera por debounce
- **THEN** ese refresco no se ejecuta y la vigilancia del repositorio queda cerrada

### Requirement: El estado de Git se observa por evento

La observación SHALL incluir los caminos de `.git/` que declaran un cambio de estado del repositorio,
de modo que preparar archivos, cambiar de rama, iniciar un merge o un rebase y confirmar desde fuera de
la aplicación produzcan un evento en lugar de esperar al temporizador de respaldo.

Hoy `.git/` se ignora entero y esas operaciones son invisibles para el sistema de archivos: la única
forma de enterarse es que el temporizador corra `git status`. Eso convierte al respaldo en la fuente
principal, que es lo contrario de lo que declara ser, e impide espaciarlo sin degradar la aplicación.

Los caminos son una lista cerrada y no el directorio completo: Git escribe en `.git/` con muchísima
frecuencia —objetos, registros de referencias, archivos de bloqueo— y casi nada de eso cambia lo que la
aplicación muestra. Observar todo sería cambiar un costo por otro.

#### Scenario: Archivos preparados desde fuera de la aplicación

- **WHEN** alguien corre `git add` en una terminal sobre el repositorio observado
- **THEN** el sistema de archivos notifica un cambio y el estado del árbol se relee sin esperar al
  temporizador de respaldo

#### Scenario: Cambio de rama desde fuera de la aplicación

- **WHEN** alguien corre `git checkout` sobre el repositorio observado
- **THEN** el sistema de archivos notifica un cambio y la rama vigente se relee

#### Scenario: Un merge que deja conflictos

- **WHEN** un merge iniciado fuera de la aplicación deja el repositorio con conflictos
- **THEN** el sistema de archivos notifica un cambio y el estado refleja el merge en curso

#### Scenario: Escritura interna de Git que no cambia el estado

- **WHEN** Git escribe objetos, registros de referencias o archivos de bloqueo dentro de `.git/`
- **THEN** esa escritura no produce por sí sola una relectura del estado

### Requirement: Una relectura redundante no paga el costo completo

El sistema SHALL comprobar con una operación barata si hubo un cambio efectivo antes de releer el
estado completo del repositorio, de modo que un disparo redundante no ejecute `git status`.

Medido sobre este repositorio, `git status --porcelain` tiene una mediana de 42 ms. Con el temporizador
cada 2 segundos y la ventana enfocada, eso son unos 76 segundos de CPU por hora dedicados a preguntar
por algo que la mayoría de las veces no cambió.

#### Scenario: Disparo sin ningún cambio desde la lectura anterior

- **WHEN** el temporizador de respaldo dispara y nada cambió desde la última lectura
- **THEN** no se ejecuta la lectura completa del estado

#### Scenario: Disparo con un cambio real

- **WHEN** el temporizador de respaldo dispara y hubo un cambio desde la última lectura
- **THEN** el estado se relee completo

### Requirement: El temporizador de respaldo ajusta su cadencia

El temporizador SHALL espaciar sus disparos cuando el repositorio lleva tiempo sin actividad, y volver a
una cadencia frecuente cuando la hay, en lugar de disparar siempre al mismo intervalo.

Con el estado de Git ya observado por evento, el temporizador deja de ser la fuente principal y pasa a
cubrir lo que el sistema de archivos no informó —Windows, algunos editores y los guardados atómicos
pierden eventos de verdad—. Un respaldo no necesita la misma frecuencia que una fuente.

El temporizador no se elimina: cambiar un costo medible por un fallo silencioso sería peor, porque lo
que no se detecta no se nota hasta que alguien confirma un commit con la lista de archivos vieja.

#### Scenario: Repositorio sin actividad reciente

- **WHEN** el repositorio observado no registra cambios durante un período prolongado
- **THEN** el temporizador de respaldo dispara con menor frecuencia que inmediatamente después de un
  cambio

#### Scenario: Actividad después de un período quieto

- **WHEN** se detecta un cambio en un repositorio que estaba quieto
- **THEN** el temporizador vuelve a su cadencia frecuente

#### Scenario: La ventana deja de estar enfocada

- **WHEN** la ventana de la aplicación pierde el foco o deja de estar visible
- **THEN** el temporizador de respaldo no ejecuta ninguna lectura del estado

### Requirement: La observación SHALL usar un único handle recursivo en la raíz

La observación de un repositorio SHALL abrirse con un único handle recursivo sobre la raíz del
repositorio, y SHALL NOT abrir un handle por carpeta. Un handle por carpeta impide que cualquier
otro programa renombre o mueva carpetas del repositorio mientras GitCron lo observa; con un solo
handle en la raíz, GitCron observa sin trabar a nadie. Se conservan el filtro de rutas ignoradas,
la estabilización de escrituras y la interfaz que consumen quienes reaccionan a los eventos.

#### Scenario: Otro programa renombra una carpeta
- **WHEN** GitCron observa un repositorio y otro programa renombra una carpeta de ese repositorio
- **THEN** el renombre se completa y GitCron recibe el evento

#### Scenario: Los consumidores no cambian
- **WHEN** se reemplaza el mecanismo de observación
- **THEN** git-ops y el pipeline reciben los mismos eventos con la misma interfaz, y sus pruebas corren sin cambios

#### Scenario: Ráfaga de eventos
- **WHEN** se producen muchos cambios en poco tiempo y el sistema operativo omite parte de los eventos
- **THEN** el temporizador de respaldo de git-ops lleva el estado a converger, como ya exige esta capacidad
