# ui-theme-light Specification

## Purpose
El tema claro, y cualquier tema, declara sus valores en vez de derivarlos de un filtro, y todos los temas pasan la verificación de contraste AA.

## Requirements

### Requirement: Un tema SHALL declarar sus valores, no derivarlos de un filtro

Cada tema de la aplicación SHALL declarar el valor que toma cada token de color en ese tema. Un tema
NO SHALL obtenerse aplicando una transformación de imagen sobre otro tema.

El fundamento es medido. Hoy `app/globals.css:268` declara
`html.light body { filter: invert(0.92) hue-rotate(180deg); }` y ningún token cambia de valor.
Invertir no es diseñar: `invert(0.92)` deja un ocho por ciento sin invertir y `hue-rotate(180deg)`
sobre un color ya invertido no devuelve el matiz original, así que aproxima los grises y desvía los
saturados. El resultado se lee como un negativo, no como un tema claro.

#### Scenario: Un tema se obtiene invirtiendo otro
- **WHEN** un tema se produce aplicando un filtro de imagen sobre la superficie de otro tema
- **THEN** se reemplaza por una declaración de valores por token

#### Scenario: Un token sin valor declarado para el tema activo
- **WHEN** un tema no declara valor para un token que la interfaz consume
- **THEN** el tema queda incompleto y se declara cuál falta, en vez de heredar el del otro tema

### Requirement: Todo acento SHALL cumplir contraste AA en cada tema donde se usa

Un color de acento SHALL alcanzar el ratio WCAG AA que corresponda a su uso —4.5 para texto normal,
3.0 para texto grande y elementos de interfaz— contra el fondo del tema en que se presenta. Un valor
que cumple en un tema NO SHALL asumirse válido en el otro.

Los casos declarados, medidos el 2026-08-26 contra `#eceff4`: `--color-primary` `#5ed8ff` da 1.43,
`--color-error` `#ff716c` da 2.33, `--color-warning` `#d8a657` da 1.92, `--color-git-add` `#a3be8c`
da 1.77, `--color-git-mod` `#fd9d1a` da 1.82 y `--color-accent-purple` `#b58bf8` da 2.27. Los seis
cumplen holgadamente sobre el fondo oscuro y ninguno sobre el claro.

#### Scenario: Un acento del tema oscuro se reutiliza en el claro
- **WHEN** un acento pensado para fondo oscuro se presenta sobre el fondo claro
- **THEN** recibe un valor propio para ese tema, verificado contra el umbral que corresponde a su uso

#### Scenario: Un acento nuevo sin medir
- **WHEN** se propone un valor de acento para un tema
- **THEN** se declara su ratio contra el fondo de ese tema antes de adoptarlo

### Requirement: La verificación de contraste SHALL recorrer todos los temas declarados

La comprobación automática de contraste SHALL declarar qué temas recorre, y SHALL cubrir todos los
que la aplicación ofrece. Una comprobación que recorre un solo tema NO SHALL presentarse como
verificación de la paleta.

Acá vale la regla de que una comprobación vale lo que abarca, y declara qué archivos recorre, aplicada a este caso: hoy `lib/__tests__/palette-contrast.test.ts` enumera sus
pares bajo el rótulo «Accents as text on dark backgrounds» y pasa en verde mientras los seis acentos
fallan en el tema claro.

#### Scenario: Comprobación que cubre un tema de dos
- **WHEN** la aplicación ofrece más de un tema y la comprobación recorre uno solo
- **THEN** se extiende a los demás, y declara en el propio archivo de prueba cuáles recorre

#### Scenario: Se agrega un tema
- **WHEN** se incorpora un tema nuevo
- **THEN** la comprobación de contraste lo incluye en la misma tanda, no después

### Requirement: Las superficies de datos y visualización SHALL acompañar el tema activo con contraste verificado

Las superficies de visualización gráfica (incluyendo `CommitGraph.tsx` y `ChronometricGraph.tsx`) SHALL responder al tema activo (`color-scheme`) asegurando que sus carriles, conexiones, nodos, insignias y textos satisfagan un ratio de contraste adecuado contra el fondo activo.

En `CommitGraph.tsx`, los textos de mensaje de commit, fecha, autor y etiquetas utilizan tokens semánticos del sistema (`--color-text-primary`, `--color-text-secondary`, `--color-git-add`, `--color-bg-base`), retirando los literales no adaptativos. En `ChronometricGraph.tsx`, el lienzo (`#chronometric-container`) adopta `--color-bg-base`, y los doce colores de carril (`--color-graph-branch-1` a `12`) declaran mediante `light-dark()` valores oscuros saturados de alto contraste para el tema claro y valores luminosos para el tema oscuro. Las imágenes, videos y avatares de usuario se renderizan en sus colores naturales sin transformaciones ni filtros de compensación.

#### Scenario: Visualización de grafos en tema claro
- **WHEN** el usuario activa el tema claro en el grafo clásico o cronométrico
- **THEN** los nodos, conexiones, insignias y comentarios se renderizan con los valores de alto contraste correspondientes al tema activo sobre el fondo claro

#### Scenario: Controles nativos y medios
- **WHEN** se presentan avatares, videos o imágenes
- **THEN** se dibujan con sus colores originales sin sufrir inversiones ni modificaciones cromáticas

### Requirement: Un control nativo NO SHALL depender de una transformación aplicada al documento

Los controles nativos del navegador (como `<select>`, `<option>`, selectores de fecha, casillas de verificación y barras de desplazamiento) que se dibujan fuera del árbol del documento NO SHALL depender de transformaciones visuales o filtros aplicados al DOM para obtener sus colores legibles. La legibilidad de los controles nativos SHALL derivar directamente de los tokens declarados para el tema activo y la directiva `color-scheme`.

#### Scenario: Presentación de opciones en controles nativos desplegables
- **WHEN** se abre un menú desplegable nativo (`<select>`) en cualquier tema soportado
- **THEN** las opciones (`<option>`) toman los colores del tema activo sin requerir reglas de inversión cruzada ni hacks de compensación
