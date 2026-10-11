# branch-delete-safety Specification

## Purpose
Borrar una rama sin llevarse por delante lo que no corresponde: nunca la rama por defecto del remoto, sólo con un upstream que existe, con el nombre remoto a la vista en la confirmación y resolviendo antes el worktree que la tenga abierta.
## Requirements
### Requirement: El borrado remoto no apunta a la rama por defecto del remoto

La aplicación SHALL no ofrecer ni ejecutar el borrado remoto de una rama cuando el objetivo remoto resuelto
de su upstream es la rama por defecto del remoto, porque borrar la rama por defecto no puede ser el efecto
colateral de limpiar una rama de trabajo: destruye el punto de partida del repositorio y, si la protección
de GitHub no está puesta, se ejecuta sin más aviso.

La rama por defecto se obtiene localmente con `git symbolic-ref refs/remotes/<remote>/HEAD`, sin ir a la
red. Una guardia en el handler de borrado remoto la rechaza aunque la interfaz no lo haya hecho, porque el
camino IPC es alcanzable por su cuenta.

#### Scenario: El upstream de la rama local apunta a la rama por defecto del remoto

- **WHEN** la rama por defecto del remoto está resuelta y el upstream configurado de la rama local resuelve
  ese mismo nombre
- **THEN** la aplicación no ofrece el borrado remoto ni el «ambas», y muestra por qué

#### Scenario: El borrado remoto se invoca contra la rama por defecto igual

- **WHEN** se pide borrar remotamente la rama por defecto del remoto, aunque sea por fuera del flujo de la
  interfaz
- **THEN** el handler lo rechaza sin ejecutar `git push --delete`, y nombra la rama por defecto en el motivo

#### Scenario: La rama por defecto del remoto no está resuelta

- **WHEN** `refs/remotes/<remote>/HEAD` no existe y no se puede determinar la rama por defecto
- **THEN** no se aplica el bloqueo por defecto, pero el nombre remoto a borrar se muestra en la confirmación
  según el requisito de confirmación con nombre remoto, de modo que apuntar a `main` se vuelva visible

### Requirement: El upstream gone o ausente no ofrece el borrado remoto

La aplicación SHALL ofrecer sólo el borrado local cuando el upstream de la rama está `gone` o la rama no
existe en el remoto, y SHALL no intentar un borrado remoto que se sabe que va a fallar, porque ofrecer una
acción que no puede completarse y después volcar el error técnico es justo lo que este cambio corrige.

#### Scenario: El upstream está marcado como gone

- **WHEN** la rama local tiene upstream configurado pero marcado `gone`
- **THEN** la aplicación ofrece sólo el borrado local y dice que no hay nada que borrar en el remoto

#### Scenario: La rama no tiene upstream configurado

- **WHEN** la rama local no tiene upstream configurado
- **THEN** la aplicación ofrece sólo el borrado local

### Requirement: El nombre remoto distinto se muestra en la confirmación

La aplicación SHALL mostrar el remote y el nombre exacto de la rama remota que se va a borrar en la
confirmación cuando ese nombre difiera del local, porque la persona tiene que leer qué se borra antes de
aceptar, no deducirlo del nombre local. Esto cubre el caso en que la rama por defecto no se pudo determinar:
`claude/x` con upstream `origin/main` muestra que se borraría `main` en `origin`.

#### Scenario: El nombre remoto difiere del local

- **WHEN** el objetivo remoto resuelto tiene un nombre de rama distinto al de la rama local
- **THEN** la confirmación nombra el remote y la rama remota exacta antes de poder aceptar

#### Scenario: El nombre remoto coincide con el local

- **WHEN** el objetivo remoto resuelto tiene el mismo nombre que la rama local
- **THEN** la confirmación no agrega la advertencia de nombre distinto

### Requirement: La rama abierta por un worktree se reconoce y se ofrece resolverla

La aplicación SHALL reconocer, antes de ofrecer el borrado de una rama local, cuando esa rama está abierta
por un worktree, y en ese caso SHALL explicarlo en el idioma de la aplicación y SHALL ofrecer soltar ese
worktree y borrar la rama en un solo paso, con una confirmación explícita que nombre el directorio que se
elimina y advierta que los cambios sin confirmar de esa copia de trabajo se pierden. La acción no se ejecuta
sin esa confirmación, porque soltar un worktree borra una copia de trabajo completa y perder trabajo sin
avisar es exactamente la clase de fallo silencioso que este cambio evita.

Soltar el worktree queda excluido para el worktree cuyo path es el del repositorio abierto: ése no se
ofrece a borrar.

#### Scenario: La rama está abierta por un worktree

- **WHEN** se pide borrar una rama local que un worktree (que no es el principal) tiene abierta
- **THEN** la aplicación no ofrece el borrado directo; explica que la rama está en uso por ese worktree y
  ofrece soltarlo y borrar la rama

#### Scenario: El worktree tiene cambios sin confirmar

- **WHEN** el worktree que tiene abierta la rama contiene archivos modificados sin confirmar
- **THEN** la confirmación lo dice con la cantidad de archivos y advierte que se pierden, y la acción no se
  ejecuta hasta aceptarla

#### Scenario: Se confirma soltar el worktree y borrar la rama

- **WHEN** la persona acepta la confirmación explícita
- **THEN** la aplicación suelta el worktree (con `--force` sólo si se confirmó sabiendo los cambios) y, si
  eso sale bien, borra la rama local; si soltar falla, no se borra la rama y se reporta

#### Scenario: La rama abierta por el worktree principal

- **WHEN** la rama abierta es la del propio repositorio abierto (worktree principal)
- **THEN** la aplicación no ofrece soltar el worktree principal; ofrece el borrado sólo si la rama no es la
  actual, o lo explica si lo es

