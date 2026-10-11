# model-selection-allowlist Specification

## Purpose
Qué modelos se ofrecen para redactar, con un criterio único de inclusión, y un mensaje que diga qué hacer cuando el servidor rechaza el pedido con un 400.
## Requirements
### Requirement: Criterio unificado de inclusión positiva para modelos de redacción
El selector de modelos para redacción con IA SHALL aceptar exclusivamente modelos cuyo tipo sea explícitamente `'llm'`, descartando por omisión modelos de tipo `'embedding'` o cualquier tipo desconocido.

#### Scenario: Modelo de embeddings en el catálogo
- **WHEN** el catálogo de modelos contiene un elemento con `kind: "embedding"` tal como lo emite la API
- **THEN** el elemento no aparece entre los modelos disponibles en el selector

#### Scenario: Modelo LLM válido en el catálogo
- **WHEN** el catálogo de modelos contiene un elemento con `kind: "llm"`
- **THEN** el elemento aparece disponible en el selector

#### Scenario: Modelo con tipo desconocido o futuro en el catálogo
- **WHEN** el catálogo de modelos contiene un elemento con un tipo no reconocido (e.g. `"vlm"`)
- **THEN** el elemento no aparece disponible en el selector

### Requirement: Mensaje de error accionable ante fallo 400 del servidor
El sistema SHALL traducir respuestas HTTP 400 o fallos de modelo no compatible a una explicación clara y accionable que indique que el modelo seleccionado no puede redactar mensajes.

#### Scenario: Respuesta HTTP 400 al solicitar redacción
- **WHEN** la solicitud de redacción falla con código HTTP 400 o error de modelo no soportado
- **THEN** la interfaz muestra el aviso explicativo traducido según el idioma activo indicando que el modelo no es apto para redacción

