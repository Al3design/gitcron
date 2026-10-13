# Entender pantallas a través del código que las construye

## Why

Cartografía ofrece grupos técnicos, relaciones y consultas con citas, pero el usuario quiere partir de una pantalla o función reconocible. Hace falta una entrada de producto que conecte esas superficies con sus componentes y archivos sin fingir relaciones que el análisis no puede demostrar.

## What Changes

- Decisión de Alejandro (2026-10-13): Cartografía, como está, no le sirve. El objetivo es que una persona sin conocimientos de programación entienda el proyecto entero: cuadros por pantalla que dicen **qué hace cada una** en lenguaje llano y **qué archivos la forman**.
- Quitar la columna derecha de Cartografía donde estaba el chat: la conversación con la IA pasa al panel de Centauro (retomar, tareas 2.4 y 2.6) y Cartografía publica ahí su selección y sus herramientas.
- Rediseñar toda la estética de Cartografía respetando la estética general y los tokens de `@theme` (módulos CSS, piezas compartidas de components/ui).

- Agregar catálogo de pantallas y funcionalidades con nombre legible y evidencia de descubrimiento.
- Mostrar componentes, archivos compartidos, estilos, datos y conexiones relevantes al seleccionar una pantalla.
- Conservar mapa técnico e impacto como profundización y pasar selección a la asistencia compartida.
- Distinguir relaciones verificadas, inferidas y desconocidas; actualización incremental con estado de cobertura.

## Capabilities

### New Capabilities

- `cartography-screen-map`: navegación pantalla/función hacia código con procedencia.

### Modified Capabilities

Ninguna.

## Impact

CartographyView, carto-panorama/groups/roles, graph-engine, CartoNodeDetail, IPC de grafo e integración de contexto. Usa CodeGraph y filesystem actuales; no reemplaza el motor ni agrega proveedor.

## Dependencies

Después de retomar-trabajo-con-asistencia-contextual. Primera entrega: catálogo navegable. La selección visual de elementos sobre una app ejecutándose queda como futura extensión, no prometida por este change.
