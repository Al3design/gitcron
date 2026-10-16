# Ejecución de Retomar trabajo con asistencia contextual

Estado: planificación preparada; implementación sin iniciar.

## Orden y dependencias

Después de cerrar-conexiones-operativas-de-sdd y de la gestión compartida de proveedores/modelos de `modelos-en-casa` (decisión recuperada en [EXECUTION.md](../../EXECUTION.md); propuesta formal pendiente). Sustituye explicar-el-ciclo-sin-tecnicismos. Primer recorrido de aceptación: retomar cambio SDD → consulta → tarea → revisión → commit común. Otros módulos reciben el asistente contextual básico; vínculos temporales y mapa de pantallas son cambios posteriores.


## Mapa de trabajo

Rutina de trabajo: [config.yaml](../../config.yaml). Secuencia del producto: [EXECUTION.md](../../EXECUTION.md). Las rutas de esta tabla son referencias de implementación.

| Tarea | Responsable | Archivos o responsabilidad acotada |
|---|---|---|
| 1.1 | orquestador | Tipos de navegación, binding main y stores identificados en el relevamiento |
| 1.2 | local | Un resolvedor y test |
| 1.3 | local | Registro de contribuciones y test |
| 2.1 | local | Persistencia IA y test de migración |
| 2.2 | local | Handler IPC; preload/tipos correspondientes; tests |
| 2.3 | local | Servicio de consulta y test |
| 2.4 | local | Shell de asistencia y test de montaje |
| 2.5 | local | Dos adaptadores de vista y tests |
| 2.6 | local | Dos adaptadores de vista y tests |
| 2.7 | local | Adaptador Settings; launcher; tests focalizados |
| 3.1 | local | Un selector/resolvedor y tests |
| 3.2 | local | Cache/resolvedor del resumen y tests |
| 3.3 | local | Servicio narrador y tests |
| 3.4 | local | ViewSwitcherRail; shell de paneles; tests |
| 3.5 | local | Componentes de entrada y tarea; i18n; tests focalizados |
| 4.1 | orquestador | Recorrido de aceptación y validación integrada |

## Aceptación (tarea 4.1)

**Parte automática (2026-10-15, orquestador).** Prueba `e2e/tests/retomar-aceptacion.e2e.ts`, que queda en el repo para repetirla. Corre en el perfil aislado, sin ningún modelo configurado, con un cambio de SDD a medio hacer y dos repositorios abiertos:

- Al abrir el cambio, «Dónde quedaste» muestra el objetivo, lo hecho (1.1), en qué estabas (1.2) y lo que queda, sin IA. «Explicarme este resumen» se ofrece y no se dispara solo.
- La conversación guardada se abre con su respuesta tal cual.
- Al reabrir la app, la conversación sigue elegida y la cantidad de mensajes guardados no cambia: nada se mandó al modelo sin pedirlo.
- El otro repositorio no ve esa conversación, ni en la pantalla ni por el canal del proceso principal.

Hallazgo de esta parte: la conversación elegida se recordaba solo mientras la app estaba abierta. Desde ahora se guarda por repositorio (`gitcron:assistConversationByRepo`, solo identificadores) y se descarta si está ilegible o si la conversación ya no existe.

Capturas: `tmp/reportes/retomar-aceptacion/`.

**Parte de Alejandro (pendiente).** Recorrer sobre el repo real: volver al cambio después de unos días, decir dónde quedó y qué sigue mirando «Dónde quedaste», preguntar algo en el chat, seguir con una tarea desde el menú «+» hasta el lanzador, y llegar a «Preparar commit». Se registra acá lo que diga, y recién entonces se marca la 4.1.
