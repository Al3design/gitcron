# commit-message-ai-generation Specification

## Purpose
Generar con IA un mensaje de commit con asunto y cuerpo, sin contar caracteres, y validar el formato convencional sin bloquear a la persona.
## Requirements
### Requirement: Generación de mensaje con asunto y cuerpo sin conteo de caracteres
El sistema SHALL solicitar al modelo de lenguaje local un mensaje de commit compuesto por un asunto convencional conciso, una línea en blanco y un cuerpo explicativo en prosa en español cuando exista contexto suficiente, sin exigirle al modelo un conteo de caracteres.

#### Scenario: Generación exitosa con contexto de cambio y diff
- **WHEN** se construye el prompt de commit con diff e intención de cambio disponible
- **THEN** el system prompt instruye al modelo a responder con un asunto convencional conciso y directo al grano, una línea en blanco y un cuerpo breve que explique qué cambia y por qué sin inventar hechos no presentes en el contexto

#### Scenario: Ausencia de información para redactar cuerpo
- **WHEN** el contexto del cambio o el diff no contienen información suficiente para justificar un cuerpo explicativo
- **THEN** el modelo devuelve únicamente la línea de asunto convencional sin forzar explicaciones vacías

### Requirement: Validación no bloqueante de formato convencional
El validador de formato de mensajes de commit SHALL evaluar exclusivamente la primera línea del mensaje generado contra la convención de prefijos.

#### Scenario: Mensaje multilínea con asunto válido y cuerpo
- **WHEN** el validador recibe un mensaje compuesto por una primera línea `feat(pipeline): agregar guarda` seguida de saltos de línea y texto explicativo en el cuerpo
- **THEN** el validador identifica el mensaje como convencional (`isConventionalSubject` devuelve true) y no lo clasifica como malformado

#### Scenario: Mensaje de una sola línea válido
- **WHEN** el validador recibe un mensaje de una sola línea `fix(security): endurecer verificación de rutas`
- **THEN** el validador confirma la estructura convencional de forma idéntica al comportamiento unilínea previo

#### Scenario: Mensaje con asunto no convencional
- **WHEN** el validador recibe un mensaje cuya primera línea no inicia con un tipo convencional permitido (ejemplo: `actualización de archivos`)
- **THEN** el validador determina que la primera línea no cumple el formato convencional (`isConventionalSubject` devuelve false)

