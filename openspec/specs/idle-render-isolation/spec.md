# idle-render-isolation Specification

## Purpose
Que la aplicación en reposo no se vuelva a dibujar: el store no avisa si nada cambió, la raíz se suscribe sólo a lo que usa y cada optimización se justifica con un mecanismo real.
## Requirements
### Requirement: El store no notifica sin cambios
El store SHALL NOT emitir una nueva referencia de `openRepos` ni notificar a sus
suscriptores cuando un updater recibe un patch que no altera ningún campo del repositorio
afectado. Esto aplica a `updateRepoByPath` y a `updateActiveRepo`.

El fundamento es que en Zustand una referencia nueva equivale a un cambio: cada suscriptor
se evalúa, y si el componente raíz no acota su suscripción, se re-renderiza entero. El latido
de respaldo llama a `refreshStatus` cada 2 segundos y, cuando el árbol no cambió, el resultado
del `git status` es idéntico al estado vigente; reconstruir el array de todos modos produce un
re-render de la aplicación entera sin que nada se haya modificado en pantalla. Es el defecto
que ralentiza la máquina con GitCron abierta.

#### Scenario: Patch sin delta desde el latido
- **WHEN** el latido de respaldo llama a `updateRepoByPath` con un `status` idéntico al que ya
  vive en el repositorio activo
- **THEN** el store no cambia la referencia de `openRepos` y los suscriptores no son notificados

#### Scenario: Patch con delta desde el latido
- **WHEN** el latido llama a `updateRepoByPath` con un `status` que difiere del vigente
- **THEN** el store actualiza `openRepos` con una referencia nueva y notifica a los suscriptores

#### Scenario: Updater por índice sin delta
- **WHEN** se llama a `updateActiveRepo` con un patch que no cambia ningún campo del repositorio
  activo
- **THEN** el store no cambia la referencia de `openRepos` y los suscriptores no son notificados

### Requirement: La raíz se suscribe sólo a lo que usa
El componente raíz `app/page.tsx` SHALL leer el estado del store mediante selectores por campo
o por porción, sin suscribirse al store entero. Cualquier valor que el componente raíz no lea
directamente SHALL poder cambiar sin forzar su re-render.

El fundamento es que la raíz es el ancestro de toda la aplicación: un re-render suyo
re-evalúa a todos sus descendientes, salvo los que estén memoizados. Sin selector, cualquier
`set` del store —incluidos los que vienen del latido— la re-renderiza, y con ella la vista
completa, aunque el campo cambiado no tenga nada que ver con lo que la raíz dibuja. Un selector
acota la suscripción a los campos que el componente realmente consume.

#### Scenario: Cambio en un campo que la raíz no lee
- **WHEN** el store actualiza un campo que el componente raíz no utiliza en su render
- **THEN** el componente raíz no se re-renderiza

#### Scenario: Cambio en un campo que la raíz lee
- **WHEN** el store actualiza un campo que el componente raíz consume vía selector
- **THEN** el componente raíz se re-renderiza y refleja el nuevo valor

### Requirement: Las optimizaciones se justifican con mecanismos reales
Todo comentario que justifique una decisión de rendimiento SHALL referir a un mecanismo
efectivamente presente en el proyecto —una dependencia instalada, una configuración de build
activa, una garantía del runtime— y no a uno cuya existencia se asuma sin verificar. Si la
justificación deja de corresponder, el comentario SHALL retirarse o reescribirse con el
motivo verdadero.

El fundamento es que una justificación falsa no se distingue de una verdadera mientras nadie
la revisa: el código sigue funcionando, y el defecto sólo se nota como lentitud. Un comentario
que invoca un React Compiler inexistente impidió memoizar una derivación que se recalcula en
cada render, y el error sobrevivió porque la afirmación se leía como cierta. La regla obliga a
que la razón escrita sea verificable.

#### Scenario: Justificación invocada pero inexistente
- **WHEN** un comentario justifica no optimizar invocando un mecanismo —un compilador, un plugin,
  una garantía del motor— que no está presente en `package.json` ni en la configuración de build
- **THEN** el comentario se retira o se reescribe con el motivo verdadero, y la optimización se
  decide sobre esa base real

#### Scenario: Decisión de no memoizar con motivo real
- **WHEN** se decide no memoizar una derivación y el motivo verdadero es, por ejemplo, que su costo
  es menor que el de mantener la memoización
- **THEN** el comentario expresa ese motivo y no invoca un mecanismo externo inexistente

