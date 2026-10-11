# ui-visual-system

## ADDED Requirements

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
