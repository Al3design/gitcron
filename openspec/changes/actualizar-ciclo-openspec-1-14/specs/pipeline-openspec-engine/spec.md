# Spec Delta

## ADDED Requirements

### Requirement: Una carpeta compartida anotada a su propio nombre SHALL contar como configuradas las herramientas que la usan
Cuando la carpeta compartida de instrucciones (`.agents/skills`) está anotada a nombre de la propia carpeta y no
de una herramienta, GitCron SHALL contar como configurada cada herramienta presente cuya carpeta de
instrucciones es esa carpeta compartida, y SHALL decir que lo está por la carpeta compartida. SHALL NOT
presentarla como pendiente de configurar ni volver por eso la integración «no al día».

El fundamento es que desde OpenSpec 1.14 la carpeta compartida se anota a su propio nombre: medido el
2026-10-01 en odontoPro, `.agents/skills/.openspec-target` dice `agents`, el motor da configurada la carpeta
compartida y no configurada a Codex, y GitCron mostraba «Falta configurar: Codex» aunque Codex lee justamente
esas instrucciones. Ninguna acción de la pantalla podía arreglarlo, porque la instalación ya estaba completa.

#### Scenario: Codex servido por la carpeta compartida en 1.14
- **WHEN** `.agents/skills` está anotada a nombre de la carpeta compartida, tiene las instrucciones de OpenSpec y Codex está presente
- **THEN** Codex figura configurada «por la carpeta compartida .agents», no aparece en «Falta configurar» y la integración puede declararse al día

#### Scenario: Otras herramientas de la misma carpeta
- **WHEN** además están presentes Amp o GSD, que también usan `.agents` para sus instrucciones
- **THEN** figuran configuradas por la carpeta compartida, igual que Codex

#### Scenario: Carpeta compartida sin instrucciones
- **WHEN** `.agents/skills` está anotada a su propio nombre pero no tiene las instrucciones de OpenSpec
- **THEN** las herramientas que la usan no cuentan como configuradas por ella

#### Scenario: El motor no se puede leer
- **WHEN** rige la lista propia de GitCron y la carpeta compartida está anotada a su propio nombre con las instrucciones
- **THEN** el resultado es el mismo que con el motor: las herramientas de esa carpeta figuran configuradas por la carpeta compartida

### Requirement: La lista de herramientas SHALL explicar cada una y decir desde qué versión de OpenSpec existe
Donde GitCron lista herramientas de OpenSpec —las configuradas del repositorio y las que se ofrecen al
inicializar o configurar— SHALL mostrar junto a cada una una explicación breve de qué es y desde qué versión de
OpenSpec la reconoce el motor («desde OpenSpec 1.14»). La explicación SHALL salir de un catálogo propio de
GitCron con descripciones verificadas; una herramienta que el catálogo no conoce SHALL decir «sin descripción
todavía» y SHALL NOT recibir una descripción inventada. La versión de aparición SHALL derivarse de comparar las
listas de herramientas del motor entre versiones, no escribirse a mano.

El fundamento es que la lista crece con cada versión —diez herramientas nuevas en 1.14— con nombres que no
dicen qué son («Veai», «GSD», «DeepSeek Harness»), y elegir cuáles configurar sin saberlo es elegir a ciegas.

#### Scenario: Herramienta conocida
- **WHEN** la lista muestra Codex
- **THEN** se ve qué es Codex en una frase y desde qué versión de OpenSpec existe

#### Scenario: Herramienta nueva sin descripción verificada
- **WHEN** la lista muestra una herramienta que el catálogo de GitCron no describe
- **THEN** dice «sin descripción todavía» y igual muestra desde qué versión existe

#### Scenario: Versión nueva del motor
- **WHEN** se captura la lista de una versión nueva de OpenSpec que agrega herramientas
- **THEN** las nuevas quedan marcadas con esa versión y las existentes conservan la suya

#### Scenario: Catálogo con una herramienta que el motor no reconoce
- **WHEN** el catálogo describe una herramienta que no está en la lista del motor
- **THEN** una verificación automática falla, para que el catálogo no describa herramientas fantasma
