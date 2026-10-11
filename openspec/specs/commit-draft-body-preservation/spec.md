# commit-draft-body-preservation Specification

## Purpose
Al normalizar un mensaje de commit redactado con IA, conservar el cuerpo y el formato convencional, y poder copiar el resultado.
## Requirements
### Requirement: Preservación de cuerpo y formato convencional en normalización
La función de normalización del mensaje de commit redactado SHALL preservar el cuerpo completo del mensaje separándolo del asunto mediante una línea en blanco, eliminando cercados de código y comillas envolventes del asunto.

#### Scenario: Respuesta con asunto y cuerpo multilínea
- **WHEN** la respuesta del modelo contiene una línea de asunto convencional seguida de párrafos explicativos en el cuerpo
- **THEN** la normalización conserva el asunto limpio, una línea en blanco y el cuerpo íntegro con sus saltos de línea correspondientes

#### Scenario: Respuesta unilínea sin cuerpo
- **WHEN** la respuesta del modelo contiene únicamente una línea de asunto convencional
- **THEN** la normalización devuelve exactamente el asunto limpio sin añadir líneas en blanco ni alterar el comportamiento unilínea

#### Scenario: Respuesta envuelta en bloque de código Markdown
- **WHEN** la respuesta del modelo está delimitada por líneas de cercado ` ``` `
- **THEN** la normalización remueve los delimitadores de bloque de código y preserva tanto el asunto como el cuerpo interior

#### Scenario: Asunto con comillas envolventes y cuerpo
- **WHEN** la primera línea de la respuesta contiene comillas envolventes sobre el asunto seguidas de un cuerpo explicativo
- **THEN** la normalización remueve las comillas del asunto preservando el texto del cuerpo intacto

#### Scenario: Respuesta vacía o compuesta sólo por cercados
- **WHEN** la respuesta no contiene texto utilizable o consiste únicamente en espacios y delimitadores ` ``` `
- **THEN** la normalización devuelve `null`

### Requirement: Control de copiado de resultado redactado
El componente de registro de redacción SHALL proporcionar un control interactivo para copiar el texto completo del resultado redactado (`log.content`) al portapapeles siempre que exista resultado disponible.

#### Scenario: Copiado del resultado generado
- **WHEN** el usuario hace clic en el botón de copiar sobre la sección de resultado
- **THEN** el sistema copia `log.content` al portapapeles y muestra una confirmación visual transitoria en el idioma activo

