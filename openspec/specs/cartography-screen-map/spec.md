# cartography-screen-map Specification

## Purpose
Entender una aplicación desde sus pantallas o funcionalidades y localizar el código relacionado con evidencia y límites de cobertura explícitos.

## Requirements

### Requirement: El catálogo conecta superficies de producto con archivos

Cartografía SHALL ofrecer pantallas/funciones reconocibles con sus componentes, archivos, estilos y fuentes de datos identificados. SHALL representar relaciones muchos-a-muchos y conservar el mapa técnico como profundización.

#### Scenario: Archivo compartido
- **WHEN** dos pantallas usan el mismo componente
- **THEN** ambas lo muestran como compartido sin asignar propiedad exclusiva

#### Scenario: Vista por estado
- **WHEN** una aplicación cambia de pantalla sin cambiar URL
- **THEN** el detector soportado identifica la vista o declara el límite; no presupone una pantalla por ruta

### Requirement: Cada asociación declara procedencia y cobertura

Las asociaciones SHALL distinguir evidencia estática, asociación manual, sugerencia y desconocimiento. El mapa SHALL declarar alcance/exclusiones del análisis. Cero relaciones observadas SHALL NOT afirmarse como ausencia total de dependencias.

#### Scenario: Import dinámico no resuelto
- **WHEN** el analizador no determina qué componente se carga
- **THEN** la relación queda desconocida o inferida con su motivo

#### Scenario: Repo sin interfaz
- **WHEN** el repositorio no contiene pantallas detectables
- **THEN** se ofrece estructura técnica y se declara la vista de pantallas no aplicable

### Requirement: La selección se integra con consulta e inspección

Seleccionar una pantalla SHALL permitir consultar a la asistencia con esa referencia y navegar a archivos/relaciones usando las superficies existentes. Las sugerencias IA SHALL NOT convertirse en asociaciones confirmadas sin evidencia o decisión.

#### Scenario: Pregunta sobre pantalla
- **WHEN** se consulta impacto con una pantalla seleccionada
- **THEN** se usa su contexto y se citan los archivos analizados

#### Scenario: Abrir archivo
- **WHEN** se elige un archivo relacionado
- **THEN** se abre el destino y revisión correspondientes sin perder la referencia a la pantalla

### Requirement: El mapa se actualiza sin perder decisiones manuales

Cambios de HEAD o archivos SHALL invalidar resultados afectados; el análisis SHALL ser cancelable y declarar resultados parciales. Reindexar SHALL preservar asociaciones manuales y detectar destinos movidos. Analizar SHALL NOT ejecutar código del repositorio.

#### Scenario: Renombrado
- **WHEN** se mueve un archivo asociado manualmente
- **THEN** se resuelve con evidencia o se marca pendiente, sin borrar silenciosamente la asociación

#### Scenario: Cancelar
- **WHEN** se cancela la lectura de un repo grande
- **THEN** se conserva el último resultado con su antigüedad y no se declara cobertura completa

### Requirement: Cada pantalla se explica en lenguaje llano

Cartografía SHALL presentar cada pantalla o función como un cuadro que dice qué hace, en lenguaje llano, y qué archivos la forman, para que alguien que no programa entienda el proyecto. Una descripción sugerida por IA SHALL marcarse como sugerida y citar los archivos en que se basa; una descripción manual SHALL reemplazarla.

#### Scenario: Descripción sugerida
- **WHEN** la descripción de una pantalla la escribió la IA
- **THEN** el cuadro la marca como sugerida y nombra los archivos en que se basa

#### Scenario: Sin chat propio
- **WHEN** la persona quiere preguntar sobre una pantalla
- **THEN** lo hace en el panel de asistencia compartido, que recibe la selección de Cartografía; Cartografía no muestra una columna de conversación propia
