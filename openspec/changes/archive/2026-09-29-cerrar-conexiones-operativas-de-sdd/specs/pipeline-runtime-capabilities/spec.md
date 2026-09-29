# pipeline-runtime-capabilities

## MODIFIED Requirements

### Requirement: Capabilities negociadas por instancia y sesión
F03 SHALL resolver capabilities desde runtime, versión, transporte y sesión observados; SHALL NOT derivarlas únicamente del nombre comercial del runtime.

#### Scenario: Nueva versión con schema desconocido
- **WHEN** discovery encuentra una versión sin fixture compatible
- **THEN** la instancia queda degradada o `pending_fixture` aunque otra versión del mismo runtime esté verificada

La operación solicitada SHALL declarar las capacidades que necesita, separando consultar, editar, ejecutar pruebas y reanudar. Un runtime lanzable SHALL NOT ofrecer una operación que sus restricciones impiden. La falta de fixture de versión SHALL seguir siendo metadato, no un bloqueo universal de instalación.

#### Scenario: Implementación con runtime de lectura
- **WHEN** se pide implementar y el runtime sólo puede leer
- **THEN** se ofrece consultar o elegir un ejecutor con escritura, sin lanzar implementación ni ampliar permisos silenciosamente

#### Scenario: Verificación sin shell
- **WHEN** la verificación requiere ejecutar pruebas y el adaptador no permite shell ni una herramienta equivalente
- **THEN** se declara ese límite y no se informa ejecución de pruebas inexistente
