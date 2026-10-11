# narrow-chat-model-error-pattern Specification

## Purpose
Reconocer, por el contexto del error, cuándo falló una redacción porque el modelo elegido no sirve para redactar.
## Requirements
### Requirement: Reconocimiento contextual de fallos por modelo no apto para redacción
La función de traducción de errores de streaming SHALL identificar fallos por modelos no aptos para redacción exclusivamente cuando el error refiera a un código HTTP 400 de la petición o a la incompatibilidad del modelo como generador de chat.

#### Scenario: Error real de modelo de embeddings
- **WHEN** el detalle del error menciona `embedding model` o que el modelo no soporta generación de chat
- **THEN** la función devuelve `aiAdviceNotChatModel`

#### Scenario: Error 400 explícito de la respuesta HTTP
- **WHEN** el detalle del error reporta `El servidor local respondió 400.` o `HTTP 400`
- **THEN** la función devuelve `aiAdviceNotChatModel`

#### Scenario: Mensaje ajeno con número 400 descontextualizado
- **WHEN** el detalle del error contiene el número 400 en otro contexto (e.g. `timeout after 400ms` o `size 400 bytes`)
- **THEN** la función devuelve `null` sin inventar un consejo

#### Scenario: Mensaje ajeno con término embedding descontextualizado
- **WHEN** el detalle del error contiene el término `embedding` en un contexto ajeno al modelo (e.g. `failed to compute embedding vector in database`)
- **THEN** la función devuelve `null`

