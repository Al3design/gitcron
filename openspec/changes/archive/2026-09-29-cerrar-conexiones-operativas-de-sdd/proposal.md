# Cerrar conexiones operativas de SDD

## Why

SDD ya comparte navegación, staging y commit con GitCron, pero algunas acciones visibles no llegan a un ejecutor productivo o no expresan sus capacidades reales. Antes de ampliar la experiencia necesitamos que decisiones, ejecución, sincronización y regreso a Git formen recorridos comprobables.

## What Changes

- Presentar como avisos las solicitudes que sólo tienen opciones informativas (auditorías rechazadas), con «Ver evidencia» que abre el archivo, y retirar el envío de respuestas que no tienen destino.
- Seleccionar ejecutores según la operación solicitada; separar instalación, lectura, escritura, pruebas y reanudación.
- (Trasladado a completar-cobertura-operativa-de-openspec: la sincronización de specs sin archivar.)
- Comprobar accesibilidad de acciones al alternar flotante, inspector y centro, preservando navegación y cierre Git comunes.
- Reconciliar cláusulas canónicas contradictorias sobre archivado, validación y runtime.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `pipeline-decision-contract`: una solicitud con opciones sólo informativas se presenta como aviso y no envía comandos de control.
- `pipeline-guided-workflow`: recorridos productivos y contratos coherentes de archivo y retorno a Git.
- `pipeline-runtime-capabilities`: compatibilidad entre intención y capacidades del ejecutor.

## Impact

PipelineWorkspace, OpenSpecInspector, OpenSpecDashboard, RepoDetailsPanel, pipeline-next-action, runtime-session-hub, adaptadores y pipeline-sync/main/preload. Reutiliza use-git-actions y el registro de sesiones. Sin sustitución del núcleo Git ni protocolos nuevos.

## Dependencies

Primer cambio de la secuencia. No depende de los otros planes nuevos. Sync se completa aquí; la cobertura ampliada lo reutiliza.
