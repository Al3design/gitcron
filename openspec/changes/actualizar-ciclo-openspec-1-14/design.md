# Design

## Context

Ver proposal.md (Why). Estado medido el 2026-10-01 con OpenSpec 1.14.0:

- `lib/openspec-version.ts` fija `OPENSPEC_CYCLE_TARGET_VERSION = '1.13.0'`; dos pruebas lo fijan también.
- `electron/pipeline/openspec-tools-snapshot.json` es la lista de 1.13.2 (40 herramientas). Recapturada con
  `scripts/capturar-herramientas-openspec.mjs` sobre 1.14.0 da 50: diez nuevas y `bob` con otro nombre. Los
  nombres de las instrucciones (`skillNames`) no cambiaron.
- `electron/pipeline/openspec-engine-tools.ts` le pregunta al paquete de OpenSpec instalado (`getToolStates`,
  `getAllToolVersionStatus`, `getConfiguredTools`, `getToolsNeedingProfileSync`) y, si no puede, usa la lista
  propia (respaldo). Sondeado sobre odontoPro con 1.14.0: `getConfiguredTools` devuelve
  `["claude","cline","continue","opencode","agents"]`; `codex`, `amp`, `gsd` y `antigravity` salen
  `configured: false`; `getToolsNeedingProfileSync` devuelve `[]`. `.agents/skills/.openspec-target` dice
  `agents`. En AI_TOOLS de 1.14, `codex`, `amp`, `gsd` y `antigravity` tienen `skillsDir: '.agents'`.
- `electron/pipeline/openspec-cli.ts` (`runOpenSpecUpdate`, dos ramas: éxito y error) cuenta los archivos
  actualizados con `git status` después del comando, filtrado por `isOpenSpecManagedPath`. Git agrupa una
  carpeta sin seguimiento en una entrada; en odontoPro: 14 entradas agrupadas contra 55 con `-uall`.
- OpenSpec no trae descripciones de sus herramientas: AI_TOOLS tiene `name`, `value`, `skillsDir` y
  `detectionPaths`, nada más.
- Medición de en qué versión apareció cada herramienta, de 1.0.0 a 1.14.0:
  `mediciones/herramientas-por-version.json` en este cambio.

## Goals / Non-Goals

**Goals:** que la pantalla diga lo que el motor 1.14 sostiene, sin falsos pendientes ni conteos falsos, y que
la lista de herramientas se entienda.

**Non-Goals:**
- No se escribe ni se cambia `.openspec-target` ni ningún archivo del repositorio de la persona para «arreglar»
  la anotación: es de OpenSpec.
- No se describe una herramienta sin verificar qué es.
- No se cambia el mínimo soportado (1.5.0) ni el aviso de versión nueva en npm.

## Decisions

### D1. Ciclo en 1.14.0 y lista propia con la versión de aparición
Se sube `OPENSPEC_CYCLE_TARGET_VERSION` a `'1.14.0'` y se recaptura la lista propia. Cada herramienta de la
lista propia suma `addedIn` (la primera versión medida en que el motor la reconoce) y, para las que ya estaban
en la primera versión medida, `addedInOrEarlier: true` («desde OpenSpec 1.0 o antes»). El script de captura
conserva el `addedIn` de las que ya estaban en la lista anterior y pone la versión capturada a las nuevas; los
valores iniciales salen de `mediciones/herramientas-por-version.json`.

Alternativas: guardar una lista por versión y comparar en tiempo de ejecución (22 archivos para derivar un
campo); escribir la versión a mano (el spec lo prohíbe: se desfasa).

Una herramienta que el motor reconoce y la lista propia no tiene (motor más nuevo que el ciclo) se muestra
«posterior a OpenSpec 1.14»: es lo que se sabe con certeza.

### D2. Carpeta compartida anotada a su propio nombre
Una sola regla, aplicada después de leer el estado —por el motor o por el respaldo, para que los dos caminos
digan lo mismo—: si la herramienta `agents` (la carpeta compartida) figura configurada, cada herramienta
presente con `skillsDir: '.agents'` que no figura configurada pasa a configurada con un origen
«por la carpeta compartida». Su vigencia (`needsUpdate`, versión que la generó) es la de `agents`. La pantalla
dice «configurada · por la carpeta compartida .agents». Con la carpeta anotada a una herramienta concreta
(`codex`, como en 1.13) rige lo de siempre: la configurada es la que el motor resuelve.

Alternativas: escribir `codex` en `.openspec-target` (toca el repositorio de la persona y pelea con OpenSpec);
ocultar a Codex (mentiría por omisión: Codex está y tiene las instrucciones).

### D3. Conteo de una actualización por comparación antes y después
Antes de correr `openspec update` se toma una foto de los archivos administrados por OpenSpec que difieren de
`HEAD` (`git status --porcelain -z --untracked-files=all`, filtrado por `isOpenSpecManagedPath`) con el hash de
su contenido; después, otra igual. Cambió por la actualización: lo que aparece después y no estaba antes, lo que
estaba en las dos con otro hash, y lo que estaba antes y ya no (volvió a `HEAD`). La foto y la comparación
viven en una función usada por las dos ramas de `runOpenSpecUpdate` (hoy el conteo está duplicado). Ambas fotos
se toman dentro del mismo cerrojo del repositorio que ya se usa.

Alternativa: contar lo que informa OpenSpec en su salida (no la estructura; no es contrato).

### D4. Catálogo de descripciones de GitCron
Un módulo en `lib/` con, por id de herramienta, una frase en es/en/zh de qué es. Los textos los investiga y
verifica el orquestador antes de la tanda de código (tarea 1.2) y la implementación los copia tal cual. Una
verificación automática falla si el catálogo describe un id que la lista propia no tiene. Se muestra en el
bloque de agentes configurados y en la elección de herramientas al inicializar o configurar, con la
explicación y la versión de aparición en el gris atenuado de la app.

## Risks / Trade-offs

- [El paquete de OpenSpec cambia la anotación otra vez en 1.15] → D2 depende de `agents` configurada y de
  `skillsDir`, que son datos del motor; la prueba usa la forma medida en 1.14 y un cambio de forma la rompe.
- [Una descripción queda vieja cuando una herramienta cambia de nombre o de dueño] → se describe qué es, no
  sus características; y `bob` muestra cómo el nombre cambia sin que cambie el id.
- [Contar con hash cuesta en repositorios con muchos archivos sucios] → sólo se calcula para archivos
  administrados por OpenSpec que difieren de `HEAD`.

## Migration Plan

Nada que migrar: la lista propia se regenera y el resto es lectura. Volver atrás es revertir los commits.
