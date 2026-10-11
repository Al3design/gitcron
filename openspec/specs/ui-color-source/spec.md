# ui-color-source Specification

## Purpose
Que todo color salga de la paleta declarada, con acentos de la misma familia que los fondos, y que una prueba automática lo verifique.
## Requirements
### Requirement: Todo color de la aplicación SHALL provenir de la paleta declarada

Cualquier color usado en la interfaz SHALL declararse como token en `app/globals.css` y consumirse
desde ahí. Ninguna vista, panel, componente ni hoja de estilos SHALL definir colores propios, ni
mediante tokens locales ni como valores literales.

El fundamento es medido: la vista Pipeline definió diez tokens de color en su propia hoja de estilos
—fondos, superficies, verde, cian, ámbar, violeta y bordes— y al cambiar la paleta general quedó
desafinada respecto del resto de la aplicación, porque nadie recordó que tenía la suya. Una paleta
que se respeta en cuatro pantallas y se reinventa en la quinta no gobierna nada: describe una de las
cinco.

Cuando una vista necesite un matiz que la paleta no tiene, ese matiz SHALL incorporarse a la paleta
con nombre general, y no resolverse dentro de la vista. Agregar un token es una decisión humana.

#### Scenario: Color declarado en una vista
- **WHEN** una hoja de estilos o un componente declara un color que no proviene de un token de la paleta
- **THEN** la verificación automática falla identificando archivo, línea y valor

#### Scenario: Matiz que la paleta no cubre
- **WHEN** una vista requiere un color que la paleta no tiene
- **THEN** se incorpora a la paleta con nombre general, y la vista lo consume desde ahí

### Requirement: Los acentos SHALL pertenecer a la misma familia que los fondos

Los colores de acento —éxito, error, advertencia, información y los estados de Git— SHALL elegirse en
relación con los fondos vigentes, y SHALL conservar tanto su significado como el contraste exigido.

El fundamento es que la verificación automática de contraste mide legibilidad, no pertenencia: un
color puede alcanzar la relación exigida contra su fondo y aun así provenir de otra paleta. El caso
concreto es el verde de éxito `#a3f185`, un lima saturado elegido contra un fondo azul marino, que
sobre grises carbón desentona sin que ninguna comprobación lo advierta.

Los acentos SHALL seguir distinguiéndose entre sí, y no sólo de su fondo: su significado depende de
que no se confundan unos con otros.

#### Scenario: Acento heredado de otra paleta
- **WHEN** un acento fue elegido contra fondos que ya no existen
- **THEN** se revisa contra los vigentes, conservando su significado

#### Scenario: Acentos que se acercan entre sí
- **WHEN** dos acentos con significados distintos quedan difíciles de distinguir entre ellos
- **THEN** se separan, aunque cada uno cumpla el contraste contra su fondo

### Requirement: La procedencia del color SHALL verificarse automáticamente

El conjunto de verificaciones que ya recorre las hojas de estilo SHALL comprobar también la
procedencia del color, con la misma forma que las existentes: función pura sobre el texto de la hoja,
sin dependencias nuevas ni acceso al sistema de archivos.

El fundamento es el mismo que llevó a verificar tamaños y espaciados: una regla que no falla sola no
es una regla, es una intención. Los diez tokens propios de Pipeline no se agregaron por descuido de
criterio sino porque nada los detenía.

#### Scenario: Verificación al escribirse
- **WHEN** la comprobación de procedencia de color se agrega al conjunto
- **THEN** falla enumerando los colores declarados fuera de la paleta, y ese número queda registrado como medición de partida

#### Scenario: Color literal introducido más adelante
- **WHEN** una hoja de estilos incorpora un color literal después de la migración
- **THEN** la verificación falla identificándolo

