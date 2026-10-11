# commit-draft-reasoning-clipboard Specification

## Purpose
Poder copiar el razonamiento de una redacción de commit, con los mensajes de copiado traducidos.
## Requirements
### Requirement: Control de copiado de razonamiento
El componente de registro de redacción SHALL proporcionar un control interactivo para copiar el texto completo del razonamiento del modelo al portapapeles siempre que exista razonamiento disponible.

#### Scenario: Copiado exitoso del razonamiento completo
- **WHEN** el usuario hace clic en el botón de copiar sobre un bloque de razonamiento con texto
- **THEN** el sistema copia el texto completo de `log.reasoning` al portapapeles mediante la API del navegador y muestra una confirmación visual transitoria

#### Scenario: Ocultamiento ante ausencia de razonamiento
- **WHEN** no existe texto de razonamiento (`log.reasoning` vacío o ausente)
- **THEN** el botón de copiar no se renderiza en la interfaz

### Requirement: Internacionalización de mensajes de copiado
El sistema SHALL disponer de las cadenas de texto del control de copiado y su confirmación en español, inglés y chino dentro del diccionario de traducción.

#### Scenario: Traducciones completas en ES, EN y ZH
- **WHEN** se consulta el diccionario de traducción `lib/i18n.ts` para las claves `pipeline.openspec.prepare.aiLogCopy` y `pipeline.openspec.prepare.aiLogCopied`
- **THEN** existen traducciones válidas y no vacías en los tres idiomas soportados

