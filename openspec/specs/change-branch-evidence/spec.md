# change-branch-evidence Specification

## Purpose
Que la relación entre un cambio de OpenSpec y su rama se vea: el panel avisa si el cambio abierto no está en su rama, crear la rama dice de qué base sale, y no se crea con cambios sin confirmar.
## Requirements
### Requirement: El panel declara cuando el cambio abierto no está en su rama
El panel SHALL declarar que el cambio abierto no se está trabajando en `change/<slug>`, nombrando la rama
actual y la que corresponde, y SHALL NOT impedir seguir trabajando.

El fundamento es que la regla tiene cero cumplimiento medido: `git branch --list "change/*"` devolvió
vacío cuatro días después de escribirla, con unos diez cambios creados en ese lapso y todos trabajados en
`main`. La regla llega por el canal, así que no es un problema de transporte: nada la hace visible en el
momento en que importa. No se bloquea porque los cambios se crean también desde la terminal, donde no hay
nada que bloquear, y porque trabajar en `main` a propósito es una decisión legítima.

#### Scenario: Cambio abierto y rama distinta
- **WHEN** hay un cambio abierto y la rama actual no es `change/<slug>`
- **THEN** el panel lo declara nombrando las dos ramas, y deja seguir

#### Scenario: Cambio abierto en su rama
- **WHEN** la rama actual es la del cambio abierto
- **THEN** el panel no declara nada

### Requirement: Crear la rama declara la base de la que sale
Antes de crear la rama de un cambio, el panel SHALL declarar cuántos commits de `main` faltan en la rama
actual y cuántos commits propios sin fusionar tiene, y SHALL ofrecer crear a partir de `main`. La
comparación SHALL declararse como hecha contra el `main` local.

El fundamento es que `git checkout -b` no dice de dónde sale la rama, y en este repositorio hay 35 ramas
locales, varias deliberadamente sin fusionar: `claude/jolly-khayyam-2be14c` está 501 commits detrás de
`main`, `fix/pipeline-launcher-empty-box` 107, e `imagined/streaming-predicciones-via-ipc` 296 detrás con
un commit propio. Crear un cambio parado en cualquiera de ellas produce una base de meses atrás sin que
nada lo declare.

Son dos números porque distinguen tres situaciones con respuestas distintas: al día, rama vieja ya
fusionada, y rama con trabajo propio sin fusionar. La última puede ser exactamente donde se quiere estar,
y por eso la base no se corrige sola.

La comparación es contra el `main` local porque saber si `main` mismo está atrasado exige `git fetch`, y
este panel no hace red sin que se la pidan. Declararlo evita sugerir una frescura que no se midió.

Al crear la rama, el panel SHALL releer la evidencia del repositorio. El fundamento salió de la
validación: la franja de evidencia siguió mostrando la rama anterior después de que el propio formulario
la cambió. Es el peor modo de fallo posible acá —el panel afirma en qué rama se está y afirmaba la
equivocada— y basta una relectura, que es lo que ya hace inicializar OpenSpec.

#### Scenario: Rama actual atrasada respecto de main
- **WHEN** se va a crear la rama de un cambio y la rama actual está detrás de `main`
- **THEN** el panel declara cuántos commits faltan y ofrece crear a partir de `main`

#### Scenario: Rama actual con trabajo sin fusionar
- **WHEN** la rama actual tiene commits propios que no están en `main`
- **THEN** el panel lo declara, y no elige la base por la persona

#### Scenario: Rama actual al día
- **WHEN** la rama actual no está atrasada ni tiene commits propios
- **THEN** el panel no declara nada sobre la base

#### Scenario: Después de crear la rama
- **WHEN** el panel crea la rama del cambio
- **THEN** relee la evidencia y declara la rama nueva, no la anterior

### Requirement: Con cambios sin confirmar no se crea la rama
El panel SHALL NOT crear la rama de un cambio cuando el árbol de trabajo tiene cambios sin confirmar, y
SHALL declarar ese estado como el motivo.

El fundamento es que `git checkout -b` arrastra lo que está sin confirmar, y la rama se crea al **abrir**
un cambio, que es justo cuando lo que hay sin confirmar pertenece a otro. Pasó al proponer este mismo
cambio: el trabajo de `offer-openspec-init` estaba sin confirmar en `main`, y por eso este cambio se
propuso sin su rama.

#### Scenario: Árbol de trabajo sucio
- **WHEN** se pide crear la rama de un cambio con cambios sin confirmar
- **THEN** la rama no se crea y el panel declara que hay trabajo sin confirmar

#### Scenario: Árbol de trabajo limpio
- **WHEN** no hay cambios sin confirmar
- **THEN** la rama se crea como hasta ahora

