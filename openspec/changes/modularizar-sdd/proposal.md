# Modularizar la pantalla de SDD

## Why

`components/pipeline/OpenSpecDashboard.tsx` tiene 3500 líneas en una sola función y su hoja de estilos `OpenSpecDashboard.module.css` otras 5400. Ahí conviven la barra de estado, la preparación del commit con IA, las vistas de un cambio (Resumen, Tareas, Artefactos, Diffs, Actividad), el cambio archivado y las pantallas de inicio. Toda tanda de SDD toca ese archivo, así que cada revisión y cada verificación abarcan la pantalla entera aunque el cambio sea de una sola vista. El 2026-10-09 una tanda tardó más de 30 minutos de reloj y otra rompió el aviso de la redacción en un lugar que no se estaba tocando. Además, para Cartografía el SDD es hoy un único bloque que hace de todo, en vez de piezas con nombre y sus conexiones.

## What Changes

- Partir `OpenSpecDashboard.tsx` en componentes por zona: barra de estado, preparación del commit, encabezado y vistas del cambio (una por vista), cambio archivado y pantallas de inicio. Cada componente tiene su propio módulo de estilos.
- Sacar la lógica a hooks con nombre (navegación entre vistas, estado del motor, flujo de archivado, preparación del commit), para que cada vista reciba sólo lo que usa.
- Repartir `OpenSpecDashboard.module.css` entre los componentes nuevos, sin tokens ni colores propios fuera de la paleta.
- Sin cambios de comportamiento ni de lo que se ve: misma navegación, mismos textos, mismos nombres accesibles.
- Después, en un paso aparte, partir `lib/i18n.ts` por pantalla, con la misma forma de usarlo.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `sdd-body-layout`: las zonas y vistas de SDD se montan y se prueban por separado.

## Impact

`components/pipeline/OpenSpecDashboard.tsx` y su CSS, componentes nuevos en `components/pipeline/sdd/`, y las pruebas de SDD que importan la pantalla entera. No toca el proceso principal ni el formato de datos.

## Dependencies

Se trabaja sobre la rama de `retomar-trabajo-con-asistencia-contextual` (incluye la vista Resumen, tarea 3.6). Las tareas siguientes de ese cambio (conversación, asistente) conviene hacerlas sobre la pantalla ya partida.
