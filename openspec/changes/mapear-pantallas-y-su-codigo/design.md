# Entender pantallas a través del código que las construye

## Context

graph-engine combina snapshot CodeGraph con scanRepoFilePaths; node detail ya consulta callers/callees/impact. GitCron cambia superficies en RepoMainView sin necesitar una ruta web distinta por pantalla: un detector basado sólo en rutas omitiría varias vistas.

Ver proposal.md para alcance y dependencias; specs/ contiene los contratos observables.

## Goals / Non-Goals

**Goals:** completar el recorrido descrito reutilizando servicios y superficies existentes; separar contratos, integración y presentación para que cada tanda local tenga un resultado verificable.

**Non-Goals:** reescribir el cliente Git, alterar la geometría del Cronométrico, introducir WebMCP/MCP Apps como dependencia o ejecutar implementación al redactar estos artefactos.

## Decisions

### 1. Decisión de implementación

Agregar adaptadores de descubrimiento por stack, empezando por Next/React y switches de vistas de GitCron, con contrato de cobertura explícito. Resolver estáticamente imports/rutas cuando posible; condiciones runtime y composición dinámica permanecen desconocidas o requieren asociación manual.

### 2. Decisión de implementación

Catálogo por nombre de producto; una pantalla puede usar muchos archivos y un archivo muchas pantallas. Mostrar piezas compartidas separadas de específicas, no asignar propiedad exclusiva a la primera coincidencia.

### 3. Decisión de implementación

Mantener asociaciones manuales portables y auditables con origen manual, separadas de resultados generados. IA puede sugerir asociaciones con fuentes, pero no elevar una sugerencia a relación comprobada.

### 4. Decisión de implementación

Navegación catálogo→detalle→relaciones/impacto→archivo/diff mediante rutas existentes. Mostrar conteos de cobertura, excluidos y errores; cero relaciones observadas no significa inexistencia de dependencias.

### 5. Decisión de implementación

Indexado reutiliza motor y cache existentes, incremental y cancelable; invalidar por cambios de archivos/HEAD. No iniciar app externa, capturar pantalla ni ejecutar código del repo para completar el mapa.

### 6. Decisión de Alejandro (2026-10-13)

La vista se rehace para alguien que no programa. La entrada es el catálogo de pantallas en cuadros; cada cuadro dice en una o dos frases qué hace esa pantalla, en lenguaje llano, y cuántos y cuáles archivos la forman, separando los propios de los compartidos. La descripción puede venir de la IA (uso `gitcron-cartography`), pero se marca como sugerida y cita los archivos en que se basa; una descripción manual la reemplaza. El mapa técnico de símbolos y relaciones queda como profundización, no como primera pantalla.

La columna derecha del chat se quita: preguntar sobre una pantalla o un archivo se hace en el panel de Centauro de retomar, donde Cartografía publica su selección y sus acciones por el registro de contribuciones (`lib/assist/view-contributions.ts`). La estética se rediseña entera con módulos CSS y tokens de `@theme`, como el resto de la app; un componente de Cartografía con Tailwind se pasa a módulos cuando se toca.

### 7. Contrato pantalla ↔ archivos (tarea 1.1, 2026-10-16)

El contrato está en `types/screen-map.ts`. Una pantalla (`ScreenEntry`) es una ruta web (`kind: 'route'`) o una vista elegida por estado sin URL propia (`kind: 'view'`, como Graph, SDD o Cartografía en GitCron, que se eligen con `activeView`/`activeTab`). Tiene un nombre legible, el lugar donde se declara y una lista de vínculos a archivos (`ScreenFileLink`). La relación es de muchos a muchos: `shared` lo calcula el catálogo cuando un archivo aparece en más de una pantalla, y ninguna pantalla «se queda» con un compartido. Cada vínculo dice su procedencia: `static` (leído en el código), `inferred` (por una regla que puede fallar), `manual` (lo puso una persona; ninguna regla lo pisa) o `unknown` (un import dinámico o una ruta calculada que no se resolvió, con el texto de lo que faltó). El rol del archivo (`screen`, `component`, `style`, `data`, `logic`, `text`, `other`) es la categoría que se muestra en el cuadro, en palabras de todos los días. La descripción en lenguaje llano es manual o sugerida por IA; la sugerida guarda modelo, fecha y archivos citados, y sin citas no se muestra. La cobertura (`ScreenMapCoverage`) distingue completo, parcial (con no resueltos, excluidos y errores), no aplicable (repo sin interfaz o stack desconocido) e indexando: un vacío nunca se lee como respuesta. Las asociaciones manuales (`ManualScreenLink`) viven fuera de la caché regenerable y, si su pantalla o archivo desaparecen, quedan pendientes en vez de reasignarse solas.

### Alternativas

Se descarta construir un subsistema paralelo porque las operaciones y evidencias actuales ya cubren parte del recorrido.

## Risks / Trade-offs

- Heurísticas por framework son parciales: fixtures cubren repos con rutas, vistas por estado, imports dinámicos y no-UI; fallback técnico y asociación manual.
- Un canvas grande vuelve a esconder lo importante: catálogo/lista y detalle legibles por defecto, grafo técnico a demanda.

## Migration Plan

Entrada nueva sobre Cartografía existente; conservar preferencia de vista técnica y referencias a nodos. Cache versionada regenerable, asociaciones manuales fuera de la cache. Sin migrar código de repos analizados.

## Open Questions

Repositorios sin interfaz muestran módulos/funciones y cobertura no aplicable; no se inventan pantallas. Inspección visual futura requiere diseño de instrumentación y consentimiento separado.
