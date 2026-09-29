# Ejecución de Cerrar conexiones operativas de SDD

Estado: primera conexión implementada por la IA local, pendiente de cierre del recorrido completo.

## Orden y dependencias

Primer cambio de la secuencia. No depende de los otros planes nuevos. Sync se completa aquí; la cobertura ampliada lo reutiliza.


## Mapa de trabajo

Rutina de trabajo: [config.yaml](../../config.yaml). Secuencia del producto: [EXECUTION.md](../../EXECUTION.md). Las rutas de esta tabla son referencias de implementación.

| Tarea | Responsable | Archivos o responsabilidad acotada |
|---|---|---|
| 1.1 | local | components/pipeline/__tests__/pipeline-decision-response.test.ts (convertir a .tsx si hace falta) |
| 1.2 | local | components/RepoDetailsPanel.tsx; components/pipeline/PipelineWorkspace.tsx; un hook compartido si la extracción resulta necesaria |
| 1.3 | local | components/pipeline/OpenSpecInspector.tsx; components/pipeline/DecisionInbox.tsx; controlador conectado en la tanda anterior |
| 1.4 | orquestador/local | electron/ipc/pipeline-control.ts; electron/pipeline/control/control-bus.ts; consumidor runtime y persistencia de decisiones |
| 2.1 | orquestador | electron/pipeline/runtime-adapters/; electron/pipeline/runtime/; launcher y tipos actuales |
| 2.2 | local | Módulo actual de capabilities y su test (rutas concretas fijadas al emitir prompt) |
| 2.3 | local | Launcher actual; consumidor de próxima acción; i18n si corresponde |
| 3.1 | orquestador | electron/ipc/pipeline-sync.ts; adaptadores runtime; registro en electron/main.ts |
| 3.2 | local | Un módulo runner y su test; adaptador runtime concreto autorizado |
| 3.3 | local | electron/main.ts; electron/ipc/pipeline-sync.ts; electron/__tests__/pipeline-sync-ipc.test.ts |
| 3.4 | local | electron/ipc/pipeline-sync.ts; módulo de plan compartido si existe; test IPC |
| 3.5 | local | Servicio de ejecución sync y test de filesystem temporal |
| 4.1 | local | Tests de selección/navegación y consumidor puntual si falla |
| 4.2 | orquestador | Pruebas de integración sobre repos temporales; documentación de resultados |
