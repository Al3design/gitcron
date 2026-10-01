# Proposal

## Why

Ale tiene OpenSpec 1.14.0 instalado y GitCron sigue escrito contra 1.13: la franja dice «Ciclo SDD v1.13.0», la
lista propia de herramientas es la de 1.13.2 (le faltan diez), y la pantalla afirma cosas que no son: Codex figura
«Falta configurar: Codex» en odontoPro aunque Codex lee las instrucciones que OpenSpec dejó en `.agents/skills`,
y al terminar una actualización dice «8 archivos actualizados» cuando cambiaron 16. Medido el 2026-10-01 con
OpenSpec 1.14.0 sobre odontoPro y el repositorio de GitCron.

## What Changes

- El ciclo SDD declara OpenSpec 1.14.0 y la lista propia de herramientas pasa a la de 1.14.0: diez herramientas
  nuevas (Amp, AtomCode, DeepSeek Harness, Code Studio, EasyCode, GigaCode, Grok Build, GSD, Veai y Warp) y
  «Bob Shell» renombrado «IBM Bob».
- Con 1.14, OpenSpec anota la carpeta compartida `.agents/skills` a nombre de la carpeta (`.openspec-target`
  dice `agents`) y no de una herramienta. Las herramientas que leen de esa carpeta (Codex, Amp, GSD,
  Antigravity) se muestran configuradas «por la carpeta compartida .agents» en vez de pendientes.
- El resumen de una actualización cuenta los archivos que la actualización cambió, uno por uno, comparando antes
  y después: hoy cuenta lo que Git agrupa (una carpeta nueva entera vale uno) y suma cambios que ya estaban
  antes de actualizar.
- La lista de herramientas explica qué es cada una, desde un catálogo de GitCron con descripciones verificadas;
  una herramienta que el catálogo no conoce dice «sin descripción todavía».
- Cada herramienta muestra desde qué versión de OpenSpec existe («desde OpenSpec 1.14»), derivado de comparar
  las listas del motor entre versiones.
- Se hace en la rama `change/modelos-en-casa`, por decisión de Ale del 2026-10-01 (opción B): llega a `main`
  junto con modelos-en-casa en vez de por una rama propia.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `pipeline-openspec-engine`: una carpeta compartida anotada a su propio nombre cuenta como configuradas las
  herramientas que la usan; la lista de herramientas explica cada una y dice desde qué versión de OpenSpec
  existe.
- `pipeline-openspec-update-execution`: el resumen al terminar una actualización cuenta los archivos que la
  actualización cambió, uno por uno.

## Impact

- `lib/openspec-version.ts` (versión del ciclo) y las pruebas que la fijan.
- `electron/pipeline/openspec-tools-snapshot.json` y `scripts/capturar-herramientas-openspec.mjs` (lista propia,
  con la versión en que apareció cada herramienta).
- `electron/pipeline/openspec-engine-tools.ts` (estado de las herramientas de la carpeta compartida, por el motor
  y por el respaldo).
- `electron/pipeline/openspec-cli.ts` y `components/pipeline/OpenSpecUpdateRunner.tsx` (conteo de archivos).
- Un catálogo nuevo de descripciones en `lib/` y las pantallas que listan herramientas
  (`components/pipeline/OpenSpecAgentsBlock.tsx`, la elección de herramientas de `OpenSpecReadiness.tsx`), con
  textos en es/en/zh.
- Sin dependencias nuevas.
