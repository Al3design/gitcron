# testing-harness Specification

## Purpose
Que el resultado de las pruebas no dependa de la limpieza ni de la concurrencia: una prueba que pasó no falla por lo que hace al terminar.
## Requirements
### Requirement: Un test que pasó no falla por su propia limpieza

Una prueba que pasó sus aserciones SHALL NOT reportarse como fallida por un error ocurrido en su
limpieza. La liberación de recursos temporales —directorios, repositorios Git de prueba, bases
SQLite— SHALL ser resistente a la demora del sistema operativo en soltar handles, reintentando
ante los errores propios de esa condición (`EBUSY`, `EPERM`, `ENOTEMPTY`) en lugar de fallar al
primer intento.

En Windows, `simple-git` levanta procesos hijos y `node:sqlite` abre archivos cuyos handles pueden
seguir tomados milisegundos después de que el proceso salió o la conexión se cerró. Un borrado
inmediato choca contra ese handle.

Esta tolerancia SHALL limitarse a la liberación de recursos posterior a las aserciones, y SHALL
NOT usarse para reintentar una comprobación fallida: un test que falla tiene que seguir fallando.

#### Scenario: Handle todavía tomado al borrar el temporal

- **WHEN** una prueba termina sus aserciones y el sistema operativo aún no liberó el handle de su directorio temporal
- **THEN** la limpieza reintenta hasta que el borrado tiene éxito, y la prueba se reporta según sus aserciones

#### Scenario: Aserción fallida

- **WHEN** una aserción de la prueba falla
- **THEN** la prueba se reporta como fallida, sin que la tolerancia de la limpieza lo oculte ni lo reintente

### Requirement: El resultado de la suite no depende de la concurrencia

Una prueba SHALL producir el mismo resultado corrida aislada que dentro de la suite completa. Una
diferencia entre ambas formas SHALL tratarse como defecto del arnés y corregirse, y la suite SHALL
NOT declararse en verde mientras la diferencia exista.

Un resultado que cambia según la carga no es una comprobación: enseña a ignorar el rojo.

#### Scenario: Prueba que sólo falla bajo carga

- **WHEN** una prueba pasa aislada pero falla dentro de la suite completa
- **THEN** se corrige la causa en el arnés, y la suite no se declara verde mientras la diferencia persista

