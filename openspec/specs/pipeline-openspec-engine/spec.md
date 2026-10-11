# pipeline-openspec-engine Specification

## Purpose
Cómo GitCron detecta, diagnostica y usa el motor de OpenSpec: versión y procedencia, configuración e integración como fuentes separadas, instrucciones que vienen del motor y herramientas configuradas leídas del motor que responde en el repositorio.

## Requirements

### Requirement: GitCron detecta versión, procedencia y ruta efectiva del motor de OpenSpec
GitCron SHALL detectar la versión del CLI de OpenSpec que ejecuta (vía `openspec --version`) y su
procedencia —`local`, `global`, `managed` (declarada no disponible) o `unknown`— y SHALL exponer al
renderer un `displayPath` canónico, informativo y de **sólo lectura** con la ruta efectiva. El renderer
SHALL NOT poder enviar ese `displayPath` de vuelta como ejecutable ni elegir una ruta arbitraria: toda
ejecución SHALL usar el runtime resuelto y autorizado por el proceso principal, con argumentos literales
o validados.

El fundamento es que hoy GitCron ejecuta `openspec` sin saber qué versión ni de dónde sale
(`electron/pipeline/openspec-cli.ts:24-26` resuelve por nombre pelado). Mostrar la ruta es útil para
diagnosticar, pero devolverla como input reintroduciría el riesgo de shell/traversal que el
confinamiento de paths del repo ya blinda: el dato es para mostrar, no para ejecutar.

#### Scenario: CLI local al proyecto detectado
- **WHEN** el CLI resuelto proviene de `node_modules/.bin/openspec` dentro del repositorio
- **THEN** la procedencia se declara `local` con precedencia sobre cualquier instalación global

#### Scenario: CLI global detectado
- **WHEN** no hay CLI local en el repositorio y se resuelve desde el `PATH` del sistema
- **THEN** la procedencia se declara `global` y el `displayPath` muestra la ruta efectiva, en sólo lectura

#### Scenario: Procedencia managed declarada no disponible
- **WHEN** se consulta el estado de procedencia administrada
- **THEN** el contrato tipa `managed` pero se declara como no disponible en esta versión

#### Scenario: CLI ausente
- **WHEN** no se encuentra ningún `openspec` ejecutable
- **THEN** la versión se declara desconocida y la procedencia `unknown`, sin trazar como error de Pipeline

#### Scenario: displayPath informativo no ejecutable
- **WHEN** el renderer recibe el `displayPath`
- **THEN** no existe camino de IPC que lo acepte como ejecutable ni como ruta de operación

### Requirement: La consulta de versión disponible tiene timeout, caché y degradación offline
GitCron SHALL consultar la última versión estable de `@fission-ai/openspec` desde el proceso principal,
contra una fuente fija y controlada, con timeout, y SHALL guardarla en caché con su fecha. Sin conexión
SHALL usar la caché declarando que es en caché, SHALL permitir reintento manual, y SHALL NOT afirmar que
hay actualización sin evidencia de la versión remota. La indisponibilidad SHALL NOT bloquear Pipeline.

El fundamento es que declarar «desactualizado» sin haber consultado miente sobre el estado, y que una
consulta colgada o sin red no puede congelar la pantalla: es el mismo criterio por el que un valor
desconocido no se muestra como cero.

#### Scenario: Consulta exitosa
- **WHEN** la fuente responde dentro del timeout
- **THEN** se obtiene la última estable, se cachea con fecha y se declara fresca

#### Scenario: Sin conexión
- **WHEN** la fuente no responde o no hay red
- **THEN** se usa la caché declarando su fecha, o se declara «sin conexión» sin bloquear Pipeline

#### Scenario: Sin evidencia no se afirma desactualizado
- **WHEN** no se obtuvo la versión remota ni hay caché utilizable
- **THEN** la comparación se declara desconocida, no «actualización disponible»

#### Scenario: Fuente controlada
- **WHEN** se consulta
- **THEN** la fuente es fija (npm registry, `@fission-ai/openspec`) y el renderer no impone un registry

### Requirement: La configuración global se lee de forma minimizada y separada de la integración instalada
GitCron SHALL leer, desde el proceso principal y con el runtime autorizado, una **configuración global
efectiva** compuesta sólo por `rawProfile`, `delivery`, `configuredWorkflows` y el origen/timestamp de
lectura, con timeout y límite de salida. SHALL tolerar la salida real de OpenSpec 1.5 y 1.8, SHALL
degradar a `unknown` si no puede interpretarla, y SHALL mantener esta evidencia separada de los
`installedWorkflows` del repositorio. SHALL NOT transportar, loguear ni persistir `anonymousId`,
telemetría u otros campos ajenos, y SHALL NOT leer ni exponer el archivo global completo al renderer.

El fundamento es que la configuración global contiene datos que no le incumben a la integración del
repo (identificadores anónimos, telemetría) y que exponer el archivo entero multiplicaría la superficie
de datos sensibles transportados al renderer. Leer sólo lo que la tarjeta necesita, y separarlo de la
integración instalada, es lo que permite mostrar la divergencia sin mezclar fuentes.

#### Scenario: Campos mínimos leídos
- **WHEN** se lee la configuración global
- **THEN** se obtienen `rawProfile`, `delivery`, `configuredWorkflows` y origen/timestamp, y nada más

#### Scenario: Sin datos sensibles
- **WHEN** la configuración global contiene `anonymousId` o telemetría
- **THEN** esos campos no se transportan, loguean ni persisten

#### Scenario: Salida no interpretable
- **WHEN** la salida de 1.5 o 1.8 no puede parsearse
- **THEN** se declara `unknown`, sin romper la tarjeta

#### Scenario: Separada de la integración instalada
- **WHEN** se transporta la evidencia
- **THEN** la configuración global y los `installedWorkflows` del repo viajan como fuentes independientes

### Requirement: La configuración global y la integración instalada son dos fuentes independientes
GitCron SHALL transportar dos fuentes de evidencia separadas: la **configuración global efectiva** y el
**estado instalado en el repositorio** (tools/targets detectados, `installedWorkflows` por target,
`generatedBy`/version/markers, y archivos faltantes, legacy, personalizados o en conflicto). La tarjeta
SHALL poder declarar la divergencia entre ambas fuentes, y un cambio en cualquiera de las dos SHALL
invalidar la vista previa.

El fundamento es que la configuración global y lo instalado en el repo pueden desincronizarse por
caminos que nada anuncia: una selección de workflows que se instaló y después cambió globalmente, o un
repo generado por una versión anterior. Colapsarlas en una sola evidencia esconde justamente el caso en
que la integración ya no refleja la configuración.

#### Scenario: Divergencia global ↔ repo
- **WHEN** la configuración global declara workflows que el repo no tiene instalados (o viceversa)
- **THEN** la tarjeta declara la divergencia entre ambas fuentes

#### Scenario: Repo generado por una versión anterior
- **WHEN** los skills del repo declaran un `generatedBy` menor que el del CLI
- **THEN** la integración instalada se declara desactualizada respecto del motor

#### Scenario: Configuración global sin llamarla del repositorio
- **WHEN** se muestra la configuración global
- **THEN** se la rotula como configuración global efectiva, no como perfil del repositorio

### Requirement: La tarjeta de estado representa motor, repositorio e integración como evidencias independientes
GitCron SHALL computar y mostrar tres ejes independientes: el **motor** (ausente/global/local/
administrado declarado no disponible/desconocido y versión soportada/demasiado vieja/más nueva que el rango),
el **repositorio** (no inicializado/inicializado/desconocido) y la **integración** (al día/desactualizada/requiere
regeneración/herramientas incompletas/personalizada o con conflictos/actualización parcial). La tarjeta
SHALL estar siempre visible, también cuando no hay CLI, cuando el repositorio no tiene `openspec/`,
cuando hay CLI pero falta la integración, sin conexión o todo al día. Podrá existir un estado resumido,
pero SHALL NOT colapsar las evidencias independientes en un único booleano.

El fundamento es que cada eje pide una acción distinta y sus causas no se solapan: un motor ausente no
se resuelve igual que un repo sin inicializar, y una integración con skills personalizados en conflicto
no se lee igual que una desactualizada. Colapsarlos en «ok/no-ok» obliga a adivinar, y hacer desaparecer
la tarjeta cuando todo está bien esconde justamente el dato que confirma que no hay nada que hacer.

#### Scenario: Sin motor y sin openspec/
- **WHEN** no hay CLI y el repo no tiene `openspec/`
- **THEN** la tarjeta muestra ambos ejes en su estado, sin colapsarlos

#### Scenario: Motor global sin integración
- **WHEN** hay CLI global pero el repo no está inicializado
- **THEN** la tarjeta declara motor presente e integración ausente, por separado

#### Scenario: Todo al día
- **WHEN** motor, repositorio e integración están consistentes
- **THEN** la tarjeta sigue visible declarando cada eje, no desaparece

### Requirement: El perfil y los workflows se modelan sobre los conjuntos oficiales 1.8 sin enum cerrado
GitCron SHALL transportar el `rawProfile` informado por OpenSpec (cuyos valores persistidos oficialmente
son `core` o `custom`), la lista de workflows y una **clasificación derivada** calculada por GitCron
sobre una fuente declarada (global o repo). Los conjuntos oficiales 1.8 son: **core** = `propose`,
`explore`, `apply`, `update`, `sync`, `archive`; **ampliado** = los seis anteriores más `new`,
`continue`, `ff`, `verify`, `bulk-archive`, `onboard` (doce en total). `expanded` SHALL ser una
clasificación derivada por GitCron cuando están presentes los doce workflows del conjunto ampliado, y
SHALL NOT presentarse como un tercer valor persistido por OpenSpec. Cualquier otra combinación SHALL
clasificarse `custom`, y cuando no pueda leerse, `unknown`. La **configuración global efectiva
observada** en este host SHALL declararse `custom` con cinco workflows (`propose`, `explore`, `apply`,
`sync`, `archive`); la **integración instalada legacy** en el repo SHALL declararse con cinco workflows
por target (`propose`, `explore`, `apply`, `sync`, `archive`) sobre skills en `.codex`/`.agent`, y
`.agents/skills` SHALL declararse con skills personalizados, no OpenSpec.

El fundamento es que `expanded` no existe como valor persistido: deriva de los workflows instalados, y
calcularlo sin decir sobre qué fuente lo hizo leería «expanded» sobre una configuración global cuando el
repo no tiene esos workflows.

#### Scenario: Perfil crudo transportado
- **WHEN** OpenSpec informa un `rawProfile`
- **THEN** se transporta su valor crudo (`core`/`custom`) junto a los workflows y a la clasificación derivada

#### Scenario: Perfil expandido derivado
- **WHEN** están presentes los doce workflows del conjunto ampliado
- **THEN** la clasificación derivada es `expanded`, sin que el CLI lo persista

#### Scenario: Configuración global observada
- **WHEN** se lee la configuración global efectiva de este host
- **THEN** se declara `custom` con cinco workflows, no `expanded`

#### Scenario: Perfil desconocido
- **WHEN** no puede leerse la fuente
- **THEN** la clasificación es `unknown`, sin romper la tarjeta

### Requirement: Pipeline soporta schemas dinámicos y un grafo de artefactos real
Pipeline SHALL transportar el `schemaName` de cada change y la lista dinámica de artefactos con su
estado, SHALL leer `requires` por artefacto y `applyRequires` devuelto por el CLI, y SHALL representar
las dependencias según el grafo real. SHALL NOT asumir que siempre existen `proposal`/`design`/`specs`/
`tasks` ni que `tasks` es el único gate de apply. Ante un schema o artefacto desconocido SHALL degradar
con un valor declarado en vez de romper. La etiqueta «Spec-Driven» hoy hardcodeada SHALL tratarse como
deuda de presentación, no como fuente del schema real.

El fundamento es que OpenSpec no garantiza un único schema: hoy sólo existe `spec-driven`, pero la
interfaz no puede asumirlo, y un custom schema con artefactos distintos dejaría de dibujarse. La noción
de «completado» además cambió: 1.8 introdujo `isPlanningComplete` (con `isComplete` como alias de
compatibilidad) y `requires` por artefacto, así que derivar el grafo de un modelo propio fijo vuelve a
mentir sobre el estado real.

#### Scenario: Schema de cada change
- **WHEN** se lista o abre un change
- **THEN** se transporta y muestra su `schemaName`, no uno asumido

#### Scenario: Grafo con requires
- **WHEN** el CLI devuelve `requires` por artefacto
- **THEN** Pipeline representa las dependencias según ese grafo

#### Scenario: Artefacto skipped
- **WHEN** un artefacto o etapa figura como `skipped`
- **THEN** se refleja como satisfecho sin escribir, sin marcarlo pendiente o fallido

#### Scenario: Schema o artefacto desconocido
- **WHEN** aparece un schema o artefacto que Pipeline no conoce
- **THEN** no se rompe y degrada con un valor declarado

### Requirement: El parsing soporta OpenSpec 1.8 y degrada ante campos desconocidos
GitCron SHALL adaptar el parsing del JSON de OpenSpec a 1.8 —`isPlanningComplete` (con `isComplete` como
alias de compatibilidad), metadata `skip_specs`, estados `skipped`, target `agents`, skills neutrales
bajo `.agents/skills` y `retire_capabilities`— manteniendo compatibilidad con 1.5. Ante un campo
desconocido SHALL degradar con un valor declarado en vez de romper la pantalla.

El fundamento es que OpenSpec evoluciona entre minors y GitCron consume su JSON; congelar el parsing en
1.5 haría que la actualización a 1.8 rompiera Pipeline. No reemplazar ciegamente `isComplete` por
`isPlanningComplete`: el parsing es compatible con ambas generaciones.

#### Scenario: Status de 1.8
- **WHEN** el CLI devuelve `isPlanningComplete`
- **THEN** Pipeline lo usa como estado de planificación y conserva compatibilidad con `isComplete`

#### Scenario: Metadata skip_specs
- **WHEN** un cambio declara `skip_specs`
- **THEN** Pipeline lo refleja sin marcar la etapa de specs como pendiente o fallida

#### Scenario: Campo desconocido
- **WHEN** el JSON trae un campo que GitCron no conoce
- **THEN** Pipeline no se rompe y degrada con un valor declarado

### Requirement: Los validadores de change-id siguen la gramática de OpenSpec 1.8
GitCron SHALL alinear todos sus validadores de change-id con la gramática real de OpenSpec 1.8: inicial
de letra o número; sólo minúsculas, números y guiones; sin guiones consecutivos ni finales; sin
espacios, mayúsculas, underscores, separadores ni `..`; respetando el límite máximo admitido por
OpenSpec; manteniendo la seguridad frente al shell y al traversal de paths. La alineación SHALL basarse
en verificar qué acepta hoy cada validador, no en aflojar uno sin inspeccionar el resto.

El fundamento es que hoy coexisten dos validadores que no coinciden con 1.8: `CHANGE_ID_PATTERN`
(`openspec-cli.ts:29`) acepta guiones consecutivos y finales, y `CHANGE_SLUG_PATTERN`
(`pipeline-next-action.ts:24`) exige letra inicial y por tanto rechaza los slugs numéricos válidos en
1.8.

#### Scenario: Slug con prefijo numérico
- **WHEN** se valida un slug con prefijo numérico válido en 1.8
- **THEN** se acepta en todos los validadores

#### Scenario: Guiones consecutivos o finales
- **WHEN** un slug tiene guiones consecutivos o un guion final
- **THEN** se rechaza, con el motivo declarado

#### Scenario: Límite y caracteres no admitidos
- **WHEN** un slug excede el límite o usa mayúsculas/underscores/`..`
- **THEN** se rechaza sin degradar la seguridad frente al shell y al traversal

### Requirement: Los outputs administrables se clasifican y los externos al repo se bloquean
GitCron SHALL clasificar cada output administrable por un `init`/`update` como `repo-local` o
`external-global` (p. ej. `minimax-code` escribe en `~/.minimax/skills/openspec-*`), SHALL incluir esa
clasificación en la vista previa y en la invalidación, y SHALL mostrar el target y el path externo sólo
como diagnóstico. En este change, cualquier operación que escribiría fuera del repositorio SHALL
bloquearse; el renderer SHALL NOT autorizar ni suministrar paths arbitrarios. Soportar mutaciones
globales SHALL requerir otro change, con consentimiento, backup y rollback propios. `.github` SHALL
tratarse como `repo-local` aunque tenga efectos posteriores en CI. Git, la rama y el working tree SHALL
NOT presentarse como protección de outputs globales, porque no los tocan.

El fundamento es que un target como `minimax-code` escribe fuera del repo, donde ni Git ni el working
tree alcanzan: ejecutarlo dentro de una operación pensada como repo-local mutaría el entorno global del
usuario sin la rama ni el rollback que sí protegen al repo. Clasificar y bloquear impide que esa
diferencia pase inadvertida; dejarla para otro change evita ampliar el alcance sin un contrato de
backup/rollback propio para lo global.

#### Scenario: Output externo detectado y bloqueado
- **WHEN** la operación intentaría escribir en un path `external-global` (p. ej. `minimax-code`)
- **THEN** se bloquea en este change y se muestra el target y el path sólo como diagnóstico

#### Scenario: Clasificación en preview e invalidación
- **WHEN** se construye la vista previa o el hash del plan
- **THEN** cada output lleva su clase `repo-local`/`external-global`, y un cambio de clase invalida el plan

#### Scenario: .github es repo-local
- **WHEN** la operación escribiría bajo `.github`
- **THEN** se trata como `repo-local` aunque sus efectos posteriores sean de CI

#### Scenario: Sin autorizar paths arbitrarios
- **WHEN** el renderer intenta suministrar un path externo
- **THEN** no se acepta como destino de operación

### Requirement: La vista previa ofrece diagnóstico del CLI e inventario clasificado de inputs y outputs
GitCron SHALL producir una vista previa de diagnóstico del CLI actual e inventario clasificado de
inputs/outputs administrables (`repo-local`/`external-global`). La vista previa destino SHALL declararse
como `parcial` o `no disponible` informando con honestidad el grado de certeza. La vista previa SHALL
analizar la estructura sin ejecutar mutaciones automáticas en el repositorio.

El fundamento es que sin runtime destino autodescargado (tras la decisión de Fase 4), la vista previa no
puede simular una ejecución `exacta` con un binario no presente en disco. Declarar `parcial` o `no disponible`
comunica honestamente qué se puede diagnosticar y qué depende de la ejecución real por el usuario.

#### Scenario: Diagnóstico del CLI e inventario
- **WHEN** se solicita la vista previa
- **THEN** se ofrece el diagnóstico del CLI actual y el inventario de inputs/outputs clasificados

#### Scenario: Preview parcial declarada
- **WHEN** la versión destino no está instalada en el entorno
- **THEN** la vista previa se declara `parcial` o `no disponible`, no `exacta`

### Requirement: La inspección diagnóstica es exhaustiva y declara su grado de certeza
La inspección diagnóstica SHALL cubrir todos los inputs y outputs administrables —`openspec/`, `.agent`,
`.agents`, `.claude`, `.codex`, `.opencode`, las demás tools configuradas, los archivos raíz administrados
por OpenSpec, `.github` cuando la configuración lo habilite, las preferencias de profile/delivery/workflows
y los archivos personalizados que puedan entrar en conflicto— sin mutar la configuración global. SHALL
preservar la distinción de tipo, permisos, symlinks (sin seguirlos fuera del ámbito), ausencia de archivos,
nombres y casing.

El fundamento es que revisar sólo `openspec/` deja fuera los targets de skills y los archivos de configuración
reales. Declarar el grado de certeza permite decidir si ejecutar la actualización con el dato honesto.

#### Scenario: Cobertura de todos los paths administrables
- **WHEN** se realiza la inspección
- **THEN** se comparan todos los inputs/outputs administrables, no sólo `openspec/`

#### Scenario: Symlinks y permisos no seguidos fuera de ámbito
- **WHEN** la inspección encuentra symlinks
- **THEN** se analizan sin seguirlos fuera del ámbito del repositorio

#### Scenario: Configuración global intacta
- **WHEN** se ejecuta la inspección
- **THEN** la configuración global relevante se consulta pero no se muta

### Requirement: El plan invalida ante cualquier cambio relevante en el estado
El plan SHALL transportar y recomprobar: la ruta canónica del repo, la rama, el HEAD, el estado del
working tree, la ruta/procedencia/versión efectiva del CLI, la versión objetivo, la **configuración global**
(`rawProfile`/`delivery`/`configuredWorkflows` con su fecha/origen) y la **integración instalada**
(tools/`installedWorkflows`/`generatedBy`/markers), la **clase `repo-local`/`external-global`** de cada output,
el schema/config relevante, los symlinks y los archivos ausentes relevantes. Si cualquiera cambió, el plan
SHALL invalidarse y exigir una nueva revisión diagnóstica.

El fundamento es que si el usuario o un proceso externo modifica el árbol o la configuración mientras la
tarjeta está abierta, el diagnóstico mostrado dejaría de coincidir con la realidad.

#### Scenario: Cambio de rama o HEAD
- **WHEN** la rama o el HEAD variaron desde la revisión
- **THEN** el plan se invalida

#### Scenario: Cambio de CLI o de configuración
- **WHEN** la versión/procedencia del CLI o la configuración global variaron
- **THEN** el plan se invalida

### Requirement: La resolución del CLI sigue una estrategia de precedencia local sobre global
GitCron SHALL resolver el ejecutable de OpenSpec siguiendo un orden de precedencia determinístico:
1. **Local al proyecto (`local`):** si existe `node_modules/.bin/openspec` (o `.cmd` en Windows) en el
   repositorio, se utiliza con prioridad máxima.
2. **Global del sistema (`global`):** si no hay binario local, se busca `openspec` en el `PATH` del sistema.
3. **Administrado (`managed`):** el contrato conserva tipada la procedencia pero se declara no disponible.
El renderer SHALL NOT elegir ejecutables ni paths libres: toda ejecución o lectura corre a través del
runtime resuelto por el proceso principal.

El fundamento es que en proyectos Node/TypeScript la versión fijada en el lockfile del repositorio es la
fuente de verdad reproducible, evitando divergencias con CLIs globales desactualizados o incompatibles.

#### Scenario: Precedencia local sobre global
- **WHEN** coexisten un `openspec` en `node_modules/.bin` del repo y uno global en el sistema
- **THEN** GitCron selecciona el binario local y declara procedencia `local`

#### Scenario: Fallback a global
- **WHEN** no existe `openspec` en `node_modules/.bin` pero sí en el `PATH`
- **THEN** GitCron selecciona el binario global y declara procedencia `global`

### Requirement: Las consultas diagnósticas neutralizan el auto-upgrade lateral de OpenSpec
Durante las lecturas de versión y diagnóstico del motor, el proceso SHALL ejecutarse en un entorno no
interactivo con `OPENSPEC_NO_UPDATE_CHECK=1` y telemetría desactivada (`OPENSPEC_TELEMETRY=0` o
`DO_NOT_TRACK=1`), sin TTY interactiva. La consulta de versión disponible en el registry SHALL seguir
siendo responsabilidad separada del motor GitCron.

El fundamento es que OpenSpec no debe disparar chequeos de red ocultos ni telemetría no consentida
mientras GitCron lee el estado diagnóstico del CLI.

#### Scenario: Chequeo interno desactivado
- **WHEN** GitCron ejecuta `openspec --version` o inspecciones diagnósticas
- **THEN** el proceso lleva `OPENSPEC_NO_UPDATE_CHECK=1` y telemetría desactivada

### Requirement: La tarjeta ofrece revisión diagnóstica y declara la operación oficial que corresponde
La interfaz SHALL ofrecer un punto de entrada de revisión en la tarjeta de OpenSpec cuyo primer clic SHALL
abrir un modal o panel de diagnóstico sin mutar nada en el repositorio. La revisión SHALL determinar y
declarar la operación oficial según la matriz:
- Repo sin `openspec/` → declara `openspec init` (con tools allowlisted y flags anti-prompt sugeridos).
- Repo inicializado → declara `openspec update`.
- Todo al día → declara no requerir mutaciones.
La revisión SHALL mostrar al usuario el **comando terminal exacto** que puede copiar y ejecutar en su
entorno, detallando los archivos que creará, modificará o retirará. SHALL NOT ejecutar mutaciones automáticas
ni simular slash commands de chat como comandos de terminal.

El fundamento es que al no contar con un gestor de paquetes interno para un runtime administrado, guiar al
usuario con el comando oficial exacto y los argumentos validados le permite ejecutar la actualización
de forma transparente y bajo su propio control.

#### Scenario: Primer clic abre revisión diagnóstica
- **WHEN** se activa la revisión en la tarjeta
- **THEN** se abre el detalle diagnóstico y no se modifica ningún archivo en disco

#### Scenario: Repositorio sin inicializar declara init
- **WHEN** el repositorio no tiene `openspec/`
- **THEN** la revisión declara `init` y muestra el comando `openspec init --tools ...`

#### Scenario: Repositorio inicializado declara update
- **WHEN** el repositorio ya tiene `openspec/`
- **THEN** la revisión declara `update` y muestra el comando `openspec update`

#### Scenario: Todo al día
- **WHEN** motor e integración están consistentes
- **THEN** la revisión declara que no se requieren cambios

### Requirement: La guía para init muestra los argumentos recomendados
Cuando la operación sugerida sea `init`, la revisión SHALL decidir y mostrar los argumentos recomendados:
path canónico del repo; `--tools <allowlist confirmada>`; `--profile core|custom`; `--no-animation`; y la
opción `--copilot-cloud` o `--no-copilot-cloud`. SHALL advertir explícitamente que `--force` sólo debe usarse
si el usuario desea limpiar archivos legacy preexistentes.

El fundamento es que `openspec init` por defecto es interactivo y requiere flags explícitos para no
detenerse ante prompts. Mostrar la línea de comandos completa facilita la ejecución no interactiva.

#### Scenario: Argumentos recomendados mostrados
- **WHEN** se sugiere `init`
- **THEN** la guía muestra `--tools`, `--profile`, `--no-animation` y opciones aplicables

#### Scenario: Advertencia sobre --force
- **WHEN** se analiza la limpieza de archivos legacy
- **THEN** se advierte que `--force` limpia archivos legacy y debe evaluarse con confirmación humana

### Requirement: El diagnóstico de integración preserva personalizaciones y analiza convivencia .codex/.agents
La inspección diagnóstica de la integración SHALL detectar los skills OpenSpec viejos en `.codex`, los
nuevos en `.agents`, distinguirlos de los skills personalizados ya presentes en `.agents` (que existen en
este repositorio), declarar qué archivos OpenSpec se migran/conservan/retiran y detectar colisiones de
nombres, sin sugerir el borrado de personalizaciones.

El fundamento es que 1.8 migra los skills de Codex a `.agents/skills` y este repositorio ya tiene skills
propios bajo `.agents`: un diagnóstico claro previene que el usuario borre por error personalizaciones vivas.

#### Scenario: Detección y preservación diagnóstica
- **WHEN** se inspecciona `.agents` con skills personalizados preexistentes
- **THEN** se identifican como personalizados y se declara que deben conservarse

### Requirement: GitCron distingue la compatibilidad del motor de la disponibilidad de versiones más recientes en el registro
GitCron SHALL evaluar de manera independiente la compatibilidad del CLI local/global respecto al rango
soportado (`supported`, `too-old`, `too-new`, `absent`) y la existencia de versiones más nuevas en el
registro npm (`cli-up-to-date`, `cli-upgrade-available`, `offline`). GitCron SHALL NOT etiquetar un motor
como «Desactualizado» de forma alarmista cuando su versión instalada está dentro del rango soportado.

El fundamento es que un CLI 1.5.0 es plenamente compatible y funcional para trabajar con las specs del
repositorio. Tratarlo como un error o una desactualización crítica sólo porque en npm existe la versión
1.9.0 confunde al usuario y provoca diagnósticos circulares en la matriz.

#### Scenario: Motor en versión soportada con versión más nueva en npm
- **WHEN** el CLI resuelto tiene versión 1.5.0 y en npm la última publicada es 1.9.0
- **THEN** el motor se clasifica como `supported` en compatibilidad y `cli-upgrade-available` en novedad, indicando claramente que es compatible y que existe una versión superior opcional

#### Scenario: Motor en versión obsoleta
- **WHEN** el CLI resuelto tiene versión 1.4.9 (menor al mínimo 1.5.0)
- **THEN** el motor se clasifica como `too-old` y la matriz requiere actualización del motor antes de operar

### Requirement: La instrucción SHALL venir del motor y no componerse a mano

Cuando GitCron entregue una instrucción a un ejecutor, SHALL usar la que el motor devuelve para esa
operación —el campo `instruction` de `openspec instructions <operación> --change <id> --json`— y NO
SHALL enumerar por su cuenta los comandos del CLI.

La aplicación SHALL agregar encima únicamente lo que el motor no puede saber: el objetivo que
escribió la persona y su alcance declarado.

El fundamento es medido. `components/pipeline/pipeline-next-action.ts` tiene cuatro funciones que
componen el texto a mano, y la de propuesta enumera `openspec new change`, `openspec status` y
`openspec instructions` uno por uno. Esa secuencia la resuelve un solo comando desde la versión 1.6,
y el texto quedó congelado con la forma que los comandos tenían dos versiones atrás. Una instrucción
escrita a mano envejece sin avisar: nada falla cuando el CLI cambia.

#### Scenario: El motor cambia la forma de una operación
- **WHEN** una versión nueva de OpenSpec modifica los pasos de una operación
- **THEN** la instrucción que recibe el ejecutor cambia con ella, sin editar la aplicación

#### Scenario: El motor no responde
- **WHEN** la consulta al motor falla o devuelve un estado bloqueado
- **THEN** la aplicación lo informa con el motivo real y no arranca ninguna sesión

### Requirement: El contexto del proyecto SHALL viajar al ejecutor

GitCron SHALL entregar al ejecutor el `context` y el `operationGuidance` que el motor devuelve
junto con la instrucción, y NO SHALL duplicar en su propio código las reglas que ese canal ya trae.

Hoy la aplicación consume `.state` y `.tasks` del JSON, e ignora los cuatro campos por los que el
CLI entrega el método: `context`, `operationGuidance`, `contextFiles` e `instruction`. El resultado
es que las reglas del proyecto —cómo se cierra una tanda, qué se puede hacer con Git, en qué rama
se trabaja— no llegan a quien ejecuta, salvo que alguien las escriba a mano en cada prompt.

#### Scenario: El proyecto declara una regla nueva en su configuración
- **WHEN** se agrega una regla al `config.yaml` del proyecto
- **THEN** el ejecutor lanzado desde la aplicación la recibe, sin que nadie edite la aplicación

### Requirement: Una escritura en Git SHALL anunciarse antes de ocurrir

Un control que modifica el repositorio SHALL declarar esa consecuencia antes de ejecutarla. Un
botón cuyo rótulo no nombra la escritura NO SHALL realizarla sin confirmación previa.

El caso declarado: «Revisar y elegir runtime» crea la rama del cambio. La casilla anuncia que la
rama se va a crear, pero la creación ocurre al apretar un botón que dice revisar, de modo que el
repositorio cambia de rama en el momento en que la persona creía estar mirando opciones.

#### Scenario: El control que escribe no nombra la escritura
- **WHEN** un control modifica el repositorio y su rótulo no lo declara
- **THEN** se pide confirmación explícita, o el rótulo se corrige para nombrarla

### Requirement: Cada campo del formulario SHALL declarar dónde termina lo que se escribe

Un campo que compone una instrucción o un artefacto SHALL indicar en qué termina su contenido:
qué queda escrito en el repositorio, qué es texto que sólo lee el ejecutor, y qué nombra una
carpeta o una rama.

Hoy cada campo tiene su texto de ayuda, pero explica el formato y no el destino. La diferencia
importa porque el formulario mezcla las tres cosas: el nombre del cambio crea una carpeta y una
rama, el objetivo es texto para el ejecutor, y ninguno se guarda como artefacto —los artefactos los
escribe el ejecutor después—.

#### Scenario: Un campo escribe en el repositorio
- **WHEN** el contenido de un campo determina una carpeta, una rama o un archivo
- **THEN** el formulario lo declara junto al campo, antes de que se complete

### Requirement: La versión del motor contra la que trabaja el ciclo SHALL estar declarada

La aplicación SHALL declarar contra qué versión de OpenSpec está escrito su ciclo, además de
mostrar la versión detectada en el repositorio.

Hoy la franja muestra la versión instalada, y eso alcanza para saber qué hay pero no para saber si
la aplicación la aprovecha. El desfase con la 1.5 pasó inadvertido porque los comandos viejos
siguieron funcionando: nada falló, y lo que se perdió fue todo lo agregado en seis versiones.

#### Scenario: La versión instalada supera a la declarada
- **WHEN** el repositorio tiene una versión de OpenSpec posterior a la que declara el ciclo
- **THEN** la aplicación lo informa, para que el desfase se vea en vez de descubrirse después

### Requirement: GitCron declara una versión mínima soportada de OpenSpec

GitCron SHALL declarar una versión mínima soportada de OpenSpec (1.5.0) y SHALL clasificar la versión detectada como `supported`, `too-old` o `unknown`. No existe máximo: una versión más nueva que la última probada SHALL clasificarse `supported` y SHALL NOT generar aviso alguno. El aviso de actualización del motor SHALL dispararse únicamente cuando la versión instalada es menor que la última publicada en npm, y SHALL indicar de qué versión a qué versión se pasaría. La clasificación es informativa y SHALL NOT bloquear operaciones; ante `too-old` GitCron SHALL ofrecer actualizar el motor.

#### Scenario: Versión igual o superior al mínimo
- **WHEN** la versión detectada es mayor o igual a 1.5.0, incluida cualquiera superior a la última probada
- **THEN** el estado la declara `supported`, sin aviso de rango

#### Scenario: Hay una versión más nueva en npm
- **WHEN** la versión instalada es menor que la última publicada en npm
- **THEN** se avisa con la versión instalada y la disponible y se ofrece actualizar el motor

#### Scenario: CLI más viejo que el soportado
- **WHEN** la versión es inferior a 1.5.0
- **THEN** el estado la declara `too-old` con el mínimo 1.5.0 y se ofrece actualizar el motor

#### Scenario: Versión ilegible
- **WHEN** la versión no se puede interpretar
- **THEN** el estado la declara `unknown`

### Requirement: El estado de la integración SHALL derivarse de los targets instalados y no del recuento de skills

GitCron SHALL determinar la vigencia de la integración a partir de qué targets tienen instalados sus
workflows —la evidencia `installedWorkflowsByTarget` y `targets` que la inspección ya produce— y no
MUST declararla al día por el solo hecho de que existan skills. La derivación actual cuenta skills
sin mirar dónde están, y eso produce una afirmación falsa comprobada en la aplicación: con diez
skills en el esquema anterior, ninguno en el target oficial vigente, y el propio panel informando
«Agents Multi-Agent sin configurar», la tarjeta declara la integración al día. Una tarjeta que
afirma lo contrario de lo que muestra debajo deja de ser evidencia.

La integración SHALL declararse al día cuando las herramientas configuradas están al día y el perfil
de workflows no requiere sincronizar, según el motor: es lo que `openspec update` puede arreglar, y
por eso es lo único que la acción «Actualizar» SHALL ofrecer resolver. Una herramienta presente sin
configurar SHALL declararse aparte, junto al estado de la integración, con la acción de
inicializarla; SHALL NOT volver la integración desactualizada ni ofrecer «Actualizar», que no
configura herramientas nuevas.

#### Scenario: Skills sólo en targets del esquema anterior
- **WHEN** los workflows están instalados únicamente en targets del esquema anterior y ninguno en el vigente
- **THEN** la integración se declara desactualizada, no al día

#### Scenario: Coherencia entre el estado y el detalle
- **WHEN** el detalle informa que una herramienta presente quedó sin configurar
- **THEN** el estado resumido la declara pendiente junto al de la integración, no lo omite, y ofrece inicializarla

#### Scenario: Herramienta sin configurar no pide actualizar
- **WHEN** las herramientas configuradas están al día y hay una presente sin configurar
- **THEN** no se ofrece «Actualizar» por esa herramienta y se ofrece inicializarla

#### Scenario: Herramienta configurada desactualizada
- **WHEN** el motor informa que una herramienta configurada necesita actualizarse o que el perfil requiere sincronizar
- **THEN** la integración se declara desactualizada y se ofrece «Actualizar»

### Requirement: El perfil de workflows SHALL leerse del CLI y poder editarse desde la aplicación

GitCron SHALL obtener del CLI el perfil vigente y el conjunto de workflows habilitados, SHALL ofrecer
únicamente acciones correspondientes a los habilitados, y SHALL permitir activarlos o desactivarlos
sin recurrir a la terminal. El fundamento es que OpenSpec dejó de imponer un flujo único y pasó a
admitir configuraciones por organización, de modo que el conjunto disponible es un dato del entorno y
no una constante del programa. Ofrecer una acción que el perfil no habilita produce un botón que
falla al apretarlo, y esconder una habilitada obliga a salir de la aplicación para usarla.

#### Scenario: Acción no habilitada por el perfil
- **WHEN** el perfil vigente no incluye un workflow
- **THEN** su acción no se ofrece, y se puede consultar que está deshabilitada

#### Scenario: Cambio del perfil desde la aplicación
- **WHEN** se habilita o deshabilita un workflow desde la aplicación
- **THEN** la configuración del CLI queda modificada y las acciones ofrecidas se recalculan desde ella

### Requirement: Una actualización detenida SHALL declarar su causa real

Cuando la revisión de actualización declara que no se puede actualizar, GitCron SHALL mostrar el
motivo que efectivamente la detiene —un conflicto entre instrucciones viejas y nuevas, instrucciones
modificadas a mano, un motor ausente o de versión ilegible, una lectura incompleta del
repositorio— en palabras de la persona y sin nombres internos. GitCron SHALL NOT mostrar un motivo
fijo que no se derive del estado medido. Un motivo que no corresponde manda a la persona a buscar un
problema que no existe y le esconde el que sí.

#### Scenario: Instrucciones viejas y nuevas conviven
- **WHEN** la integración queda detenida porque hay instrucciones de OpenSpec en la carpeta vieja de una herramienta y en la nueva a la vez
- **THEN** el motivo dice que conviven copias viejas y nuevas, dónde están, y remite a retirarlas

#### Scenario: Causa no reconocida
- **WHEN** la actualización está detenida por una causa que GitCron no clasifica
- **THEN** el motivo lo dice así —que no se pudo determinar la causa— en lugar de mostrar un texto ajeno al estado

### Requirement: Las copias viejas de las instrucciones SHALL poder retirarse desde la revisión cuando se pueden recuperar

Cuando OpenSpec pasó las instrucciones de una herramienta a una carpeta nueva y quedaron las copias
viejas, la revisión SHALL listar esas copias y SHALL ofrecer retirarlas desde GitCron, sólo las que
Git puede devolver: seguidas en el repositorio y sin cambios sin confirmar. Las que no cumplen SHALL
listarse aparte con el motivo, para revisarlas a mano. El retiro SHALL dejar los borrados sin
confirmar en Git y volver a medir el estado de la integración.

La revisión SHALL NOT presentar `--force` de `openspec update` como forma de limpiar esas copias:
en ese comando significa regenerar aunque todo esté al día, y no borra nada. OpenSpec tampoco las
borra al inicializar cuando difieren de las nuevas: deja esa decisión a la persona.

#### Scenario: Copias viejas recuperables
- **WHEN** hay copias viejas de instrucciones de OpenSpec seguidas en Git y sin cambios sin confirmar, y la persona confirma retirarlas
- **THEN** GitCron las borra del árbol de trabajo, no confirma nada en Git, enumera lo borrado y vuelve a medir la integración

#### Scenario: Copias viejas no recuperables
- **WHEN** una copia vieja no está seguida en Git o tiene cambios sin confirmar
- **THEN** no se ofrece retirarla desde GitCron y se lista con el motivo para revisarla a mano

#### Scenario: No se promete limpiar con --force
- **WHEN** la revisión muestra copias viejas
- **THEN** no ofrece `--force` como forma de limpiarlas

### Requirement: Una herramienta servida desde la carpeta compartida SHALL contarse como configurada

Cuando la carpeta compartida de instrucciones (`.agents/skills`) declara qué herramienta la atiende,
GitCron SHALL contar esa herramienta como configurada, aunque su carpeta propia exista sin
instrucciones de OpenSpec. La carpeta propia de una herramienta puede existir por su configuración
propia, ajena a OpenSpec; contarla como «sin configurar» deja la integración desactualizada para
siempre, sin que ninguna actualización pueda arreglarla.

#### Scenario: Codex servido desde .agents
- **WHEN** `.agents/skills` declara que la atiende Codex y `.codex/` existe sólo con la configuración propia de Codex
- **THEN** Codex cuenta como configurada y la integración no queda desactualizada por esa carpeta

#### Scenario: Toda la pantalla dice lo mismo
- **WHEN** Codex está servida desde `.agents` y OdontoPau tiene `.github` con su integración continua
- **THEN** ni el bloque de agentes muestra a Codex «sin configurar», ni el perfil de workflows dice que les falta algo a Codex o a `.github`, ni ofrece «Actualizar» por eso

#### Scenario: Carpeta propia con instrucciones viejas
- **WHEN** además `.codex/skills` todavía tiene copias viejas de las instrucciones de OpenSpec
- **THEN** esas copias se informan como viejas y retirables, no como una herramienta sin configurar

### Requirement: Una carpeta que OpenSpec no configura SHALL NOT contarse como herramienta sin configurar

GitCron SHALL contar como «sin configurar» sólo las herramientas que el motor de OpenSpec puede
configurar. Una carpeta que el repositorio usa para otra cosa —por ejemplo `.github` con su
integración continua— y que OpenSpec no reconoce como herramienta SHALL NOT volver la integración
«no al día» ni mostrarse como pendiente de configurar. Medido con OpenSpec 1.13.2: sus herramientas
configurables no incluyen una de flujos de GitHub; contarla deja la integración desactualizada para
siempre, y ni actualizar ni inicializar la pueden arreglar.

#### Scenario: Repositorio con integración continua propia
- **WHEN** el repositorio tiene `.github` con sus propios flujos y las herramientas de OpenSpec presentes están configuradas
- **THEN** la integración se declara al día y `.github` no aparece como pendiente de configurar

#### Scenario: Herramienta real sin configurar
- **WHEN** hay una carpeta de una herramienta que OpenSpec sí configura y no tiene sus instrucciones
- **THEN** la integración no se declara al día, como hasta ahora

### Requirement: El cierre de una actualización de la integración SHALL verificarse con el estado medido otra vez

Después de regenerar la integración, GitCron SHALL volver a medir su estado y SHALL decir
«integración al día» sólo si la medición lo confirma. Que el comando termine bien prueba que escribió
archivos, no que la integración haya quedado al día.

#### Scenario: Regenera pero no queda al día
- **WHEN** la actualización de la integración termina sin error y la nueva medición no la da al día
- **THEN** GitCron informa cuántos archivos regeneró y que todavía no quedó al día, con el motivo, y no muestra «integración al día»

#### Scenario: Queda al día
- **WHEN** la nueva medición la da al día
- **THEN** GitCron muestra «integración al día»

### Requirement: La lista y el estado de las herramientas SHALL salir del motor que responde en el repositorio

GitCron SHALL obtener del motor de OpenSpec que responde en cada repositorio qué herramientas
reconoce, cuáles están presentes, cuáles configuradas, cuáles necesitan actualizarse y si el perfil
de workflows requiere sincronizar, y SHALL usar esa respuesta en todos los lugares que muestran o
derivan el estado de las herramientas. SHALL hacerlo sólo si el paquete leído es la misma versión que
responde, en un proceso aparte y con un tope de tiempo.

Una lista propia mantenida a mano se desfasa con cada versión nueva del motor y hace que la pantalla
afirme cosas que el motor no sostiene: una herramienta «sin configurar» que el motor da por
configurada, o una que el motor ni reconoce.

#### Scenario: El motor contesta
- **WHEN** el motor del repositorio se puede leer y su versión coincide con la que responde
- **THEN** la lista, la presencia, la configuración y la vigencia de cada herramienta son las que el motor informa, y la pantalla no muestra herramientas que el motor no reconoce

#### Scenario: Carpeta compartida
- **WHEN** varias herramientas comparten la misma carpeta de instrucciones y el motor resuelve cuál la atiende
- **THEN** GitCron muestra configurada la que el motor resuelve y no presenta a las otras como pendientes por esa carpeta

#### Scenario: Paquete de otra versión
- **WHEN** el paquete encontrado no es la versión que responde el motor
- **THEN** no se usa y rige el respaldo, declarando el motivo

### Requirement: Si el motor no se puede leer, SHALL usarse la lista propia declarándolo

Cuando el motor no se puede leer —no se encuentra su paquete, la versión no coincide, su parte
interna cambió o no contesta a tiempo—, GitCron SHALL usar su lista propia, que es una copia de la
del motor en la versión del ciclo SDD, y SHALL avisarlo en pantalla con el motivo. La copia propia
SHALL corresponder a la versión del ciclo SDD; una verificación automática SHALL fallar cuando no.

#### Scenario: Respaldo en uso
- **WHEN** GitCron no puede leer el motor
- **THEN** la pantalla de herramientas indica que usa la lista propia de GitCron y por qué

#### Scenario: Copia propia desfasada
- **WHEN** se sube la versión del ciclo SDD y la copia propia sigue siendo de la anterior
- **THEN** la verificación automática falla indicando cómo volver a capturarla

### Requirement: Mientras se lee el motor, la pantalla SHALL decir que está leyendo

Hasta que llegue la primera medición del motor de un repositorio, y mientras se vuelve a medir después
de una acción, GitCron SHALL mostrar que está leyendo, ocupando el mismo lugar que ocupará el
resultado. SHALL NOT mostrar «Ausente», «Desconocido», «No se puede determinar» ni «El CLI de
OpenSpec no está instalado» sin una medición que lo sostenga: son afirmaciones sobre la máquina y,
mostradas por falta de datos, se leen como un error que no existe.

#### Scenario: Primera carga
- **WHEN** se abre la configuración de OpenSpec de un repositorio y el estado del motor todavía no llegó
- **THEN** se ve «Leyendo OpenSpec…» en el lugar del resultado, sin «Ausente» ni «Desconocido», y al llegar el resultado la pantalla no salta

#### Scenario: Motor realmente ausente
- **WHEN** la medición termina y no hay motor de OpenSpec
- **THEN** recién entonces se declara ausente, con el motivo

### Requirement: Un repositorio sin OpenSpec SHALL ofrecer inicializarlo una sola vez, eligiendo herramientas

En un repositorio que no usa OpenSpec, GitCron SHALL ofrecer una única acción de inicializar, que
muestra qué herramientas detectó, deja elegir cuáles configurar y declara qué va a escribir. SHALL NOT
ofrecer un «Configurar» por herramienta: cada uno inicializa OpenSpec en el repositorio aunque diga
otra cosa. Al terminar SHALL decir qué quedó: las herramientas configuradas y los archivos nuevos sin
confirmar.

#### Scenario: Repositorio que no usa OpenSpec
- **WHEN** el repositorio no tiene OpenSpec inicializado y hay herramientas detectadas
- **THEN** se ve un solo bloque «Este repositorio no usa OpenSpec» con la lista de herramientas para elegir y un botón «Inicializar OpenSpec», sin botones por herramienta

#### Scenario: Resultado de inicializar
- **WHEN** termina la inicialización
- **THEN** se informa con qué herramientas quedó y cuántos archivos nuevos quedaron sin confirmar

### Requirement: Las herramientas sin configurar SHALL resumirse con una sola acción

En un repositorio que ya usa OpenSpec, las herramientas presentes sin configurar SHALL mostrarse en
un solo resumen con una única acción «Configurar…» que deja elegir cuáles, y SHALL informar el
resultado. La lista, los nombres y las carpetas SHALL leerse sin superponerse y sin que la pantalla
salte al terminar.

#### Scenario: Varias pendientes
- **WHEN** el motor informa dos o más herramientas presentes sin configurar
- **THEN** se ve una línea «Detectadas sin configurar: …» y un solo botón «Configurar…», que abre la elección

### Requirement: La cabecera y su botón SHALL decir lo mismo

El texto del estado de la integración y el del botón de la cabecera SHALL derivarse de la misma
medición. SHALL NOT mostrarse «Todo al día» cuando el estado declara que falta inicializar, que hay
herramientas pendientes o que la actualización está detenida.

#### Scenario: Repositorio sin inicializar
- **WHEN** el estado de la integración es «Inicialización del repositorio»
- **THEN** el botón no dice «Todo al día»

### Requirement: Las salidas administrables SHALL listarse por carpeta y presentes sólo con instrucciones

La lista de salidas administrables SHALL tener una fila por carpeta física, nombrando las
herramientas que la usan, y SHALL marcarla presente sólo si contiene instrucciones de OpenSpec, no
porque la carpeta exista.

#### Scenario: Carpeta compartida
- **WHEN** varias herramientas comparten `.agents/skills`
- **THEN** hay una sola fila para esa carpeta, con las herramientas que la usan

#### Scenario: Carpeta sin instrucciones
- **WHEN** existe `.github` pero no tiene instrucciones de OpenSpec
- **THEN** su salida no figura como presente

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
