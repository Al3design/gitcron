# Retomar trabajo con asistencia contextual

## Why

Los historiales actuales registran ejecuciones y decisiones, pero no ofrecen una conversación continua ni una entrada que permita recuperar de inmediato el objetivo y el siguiente paso. El usuario necesita retomar tras semanas y consultar desde cualquier pantalla sin reconstruir manualmente todo el contexto.

## What Changes

- Introducir contexto de trabajo compartido y explícito entre vistas, particionado por repositorio y checkout.
- Persistir conversaciones con referencias verificables y reanudación de la conversación independiente de resume nativo del ejecutor.
- Mostrar al abrir un cambio un resumen breve de objetivo, avance comprobado, decisiones, pendientes y siguiente acción.
- Evolucionar el flotante mediante contribuciones contextuales; mantener el menú global y el inspector Git.
- Absorber explicar-el-ciclo-sin-tecnicismos en el recorrido de orientación: lenguaje claro, efecto de cada acción y ayuda a demanda con procedencia, sin multiplicar texto permanente.

## Capabilities

### New Capabilities

- `workspace-assistance`: contexto, conversación y acciones compartidas.
- `work-continuity`: orientación y recuperación de un trabajo con fuentes.

### Modified Capabilities

Ninguna.

## Impact

Shell app/page, RepoMainView, stores Git/Pipeline, CartoAskBox, launcher/sesiones y persistencia SQLite main. Reutiliza proveedores y credenciales existentes. Cambios UI/i18n y tests; sin reemplazar Graph, Centauro o staging.

## Dependencies

Después de cerrar-conexiones-operativas-de-sdd y de la gestión compartida de proveedores/modelos de `modelos-en-casa` (decisión recuperada en [EXECUTION.md](../../EXECUTION.md); propuesta formal pendiente). Sustituye explicar-el-ciclo-sin-tecnicismos. Primer recorrido de aceptación: retomar cambio SDD → consulta → tarea → revisión → commit común. Otros módulos reciben el asistente contextual básico; vínculos temporales y mapa de pantallas son cambios posteriores.
