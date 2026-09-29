# Pipeline runtime capabilities

## Purpose

Definir evidencia y degradación para capacidades de runtimes, proveedores y adaptadores.

## Requirements

### Requirement: Matriz con procedencia por celda
La matriz SHALL cubrir Hermes, Claude, Codex, `agy`, OpenCode, Z.ai vía OpenCode y LM Studio para observación, reasoning, tools, usage, costo, contexto, selección de modelo, pausa, interrupt, kill, resume, auth y estabilidad de schema. Cada afirmación SHALL tener estado y evidencia.

#### Scenario: Ayuda anuncia una opción sin fixture
- **WHEN** `--help` anuncia una capability pero no existe payload real capturado
- **THEN** la celda se marca inferida o pendiente de fixture, no verificada end-to-end

### Requirement: Runtime y proveedor no se confunden
La matriz SHALL separar runtime/transport de proveedor/model family y SHALL permitir relaciones muchos-a-muchos.

#### Scenario: Z.AI Coding Plan configurado
- **WHEN** OpenCode lista una credencial Z.AI Coding Plan sin exponer su secreto
- **THEN** Z.ai se registra como proveedor accesible por OpenCode y su CLI standalone queda no aplicable, no falsamente ausente

### Requirement: Degradación sin parsing frágil
Un adaptador SHALL usar sólo protocolos o salidas estructuradas versionables. Ausencia de esa superficie SHALL degradar capabilities sin parsear texto humano.

#### Scenario: agy sólo anuncia print final
- **WHEN** `agy` no expone stream JSON estable
- **THEN** Pipeline limita observación a lifecycle grueso y evidencia repo hasta disponer de hook/wrapper probado

### Requirement: Orden de implementación guiado por evidencia
El camino core SHALL implementar primero las fuentes directas con fixtures verificados. El adaptador Hermes SHALL ser opcional y su bloqueo SHALL NOT impedir F03 ni fases core posteriores.

#### Scenario: Companion Hermes sin handshake seguro
- **WHEN** F02 no puede negociar un contrato autenticado/versionado
- **THEN** F02 queda bloqueada y F03 continúa desde F01 con adaptadores directos

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

### Requirement: Coherencia entre anuncio y efecto
Una capability SHALL ser `available` sólo cuando exista método implementado y evidencia compatible; interfaz anunciada sin efecto probado SHALL conservar `pending_fixture`.

#### Scenario: Resume anunciado por help
- **WHEN** el CLI lista resume pero la suite no contiene fixture de efecto
- **THEN** Pipeline conserva evidencia de interfaz y no afirma resume end-to-end

### Requirement: Descubrimiento de runtimes sin panel vacío
Mientras el descubrimiento de runtimes para el repositorio abierto no resolvió, la superficie de arranque SHALL mostrar un estado de carga explícito y accionable, y SHALL NOT pintar un panel con marco cuyo interior esté vacío. El contenido del launcher SHALL aparecer dentro del mismo marco que ya estaba visible, sin un salto visual desde un recuadro vacío a un recuadro lleno.

#### Scenario: Discover en curso al montar el launcher
- **WHEN** el launcher se monta y el descubrimiento IPC aún no respondió
- **THEN** la vista muestra un mensaje de carga accionable y no renderiza un panel con marco vacío

#### Scenario: Discover resuelto
- **WHEN** el descubrimiento responde con la lista de runtimes
- **THEN** el formulario del launcher reemplaza al estado de carga dentro del mismo contenedor, sin pintar un marco nuevo

#### Scenario: Remontaje del launcher al cambiar de change o tarea
- **WHEN** se selecciona otro cambio activo o se pasa a otra tarea y el launcher se remonta con un nuevo descubrimiento en curso
- **THEN** mientras ese descubrimiento no resolvió se muestra el estado de carga, no un recuadro vacío

### Requirement: Diagnóstico de OpenSpec sin referencias a andamiaje retirado
Cuando el lector de evidencia no puede determinar la disponibilidad de OpenSpec o no encuentra changes, el diagnóstico que llega al usuario SHALL describir la causa real (OpenSpec no responde o no hay `openspec/changes`) y SHALL NOT mencionar mecanismos de andamiaje ya retirados del producto.

#### Scenario: OpenSpec no disponible
- **WHEN** el lector no puede invocar la validación de OpenSpec
- **THEN** el diagnóstico describe la indisponibilidad de OpenSpec sin nombrar "scaffold"

### Requirement: Lanzabilidad basada en instalación, no en fixture
Un runtime SHALL ser lanzable cuando el adaptador lo declara lanzable y el binario está instalado.
La coincidencia exacta de versión con un fixture auditado SHALL NOT ser condición de lanzamiento.
`evidenceStatus` SHALL ser un metadato informativo que la UI muestra; SHALL NOT bloquear el
arranque. La resolución del ejecutable SHALL declarar con qué entorno se hizo, y un runtime que el
sistema tiene instalado pero la aplicación no resuelve SHALL aparecer con el motivo medido en vez
de omitirse.

#### Scenario: Versión instalada distinta de la de referencia
- **WHEN** discovery encuentra un runtime instalado cuya versión difiere de cualquier referencia previa
- **THEN** el runtime es lanzable y la UI muestra que no está verificado, en vez de negar el arranque

#### Scenario: Runtime verificado
- **WHEN** la versión instalada coincide con una referencia verificada
- **THEN** el runtime es lanzable y se muestra como verificado

#### Scenario: Adaptador sin `start()`
- **WHEN** un adaptador no implementa `start()` o se declara no lanzable
- **THEN** el runtime no es lanzable y se lista con su motivo, sin depender de la versión

#### Scenario: Instalado en el sistema pero no resuelto por la aplicación
- **WHEN** un runtime cuyo adaptador se declara lanzable está instalado y es invocable fuera de la aplicación, y el descubrimiento de la aplicación no lo resuelve
- **THEN** el runtime aparece en la superficie de arranque con el motivo por el que no se pudo resolver, y no se omite de la lista

### Requirement: `evidenceStatus` informativo y honesto
Una capability SHALL conservar `evidenceStatus` como metadato que refleja si existe evidencia respaldadora. Sin fixture o referencia que la respalde, SHALL declararse `pending_fixture`; SHALL NEVER declararse `verified` sin evidencia. Este estado SHALL mostrarse al usuario sin impedir el lanzamiento.

#### Scenario: Capability sin evidencia respaldadora
- **WHEN** los `evidenceRefs` de una capability apuntaban a un fixture retirado
- **THEN** la capability se declara `pending_fixture` y el runtime sigue siendo lanzable

#### Scenario: Capability con evidencia respaldadora
- **WHEN** existe referencia verificada para la capability
- **THEN** se declara `verified` y el runtime es lanzable
