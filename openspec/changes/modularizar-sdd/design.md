# Modularizar la pantalla de SDD

## Context

`OpenSpecDashboard.tsx` (3500 líneas, rama `change/modularizar-sdd` sobre 2568827) es una única función. Zonas del render, con sus líneas aproximadas en ese commit:

| Zona | Líneas | Destino |
|---|---|---|
| Barra de estado: rama, indicadores, motor, validación, acciones | 2221–2490 | `sdd/SddStatusBar.tsx` |
| Preparación del commit, con la redacción por IA | 2574–2960 | `sdd/SddPrepareCommit.tsx` |
| Encabezado del cambio activo | 2962–3074 | `sdd/SddChangeHeader.tsx` |
| Vistas del cambio: Resumen, Tareas, Artefactos, Diffs, Actividad | 3075–3210 | `sdd/views/Sdd<Vista>View.tsx`, una por vista |
| Cambio archivado | 3214–3305 | `sdd/SddArchivedChange.tsx` |
| Pantallas de inicio: en curso, archivados, cambio nuevo | 3310–3500 | `sdd/SddStartScreens.tsx` |

La lógica previa al render (líneas 300–2080) mezcla navegación entre vistas, estado del motor de OpenSpec, archivado, preparación del commit y selección. `OpenSpecDashboard.module.css` (5400 líneas) tiene las clases de todas esas zonas juntas.

## Goals / Non-Goals

**Goals:** que una tanda sobre una vista toque esa vista y sus estilos; que cada vista se pruebe sola; que Cartografía vea piezas con nombre.

**Non-Goals:** cambiar comportamiento, textos o diseño; introducir un store nuevo; partir la vista Cronométrica o el estado de Git (se hacen sólo cuando una tanda los toque).

## Decisions

### 1. Partición mecánica, por zonas y de a una

Cada tanda extrae una zona: mueve el JSX y las clases tal como están, y le pasa por props lo que usa. No se reescribe lógica en la misma tanda en que se mueve. `OpenSpecDashboard` queda como armazón: estado compartido, hooks y composición de las zonas.

### 2. Hooks con nombre para la lógica compartida

- `useSddNavigation`: vista activa, menú de vistas, tarea resaltada.
- `useEngineStatus`: estado del motor de OpenSpec y sus avisos.
- `useArchiveFlow`: plan y ejecución del archivado.
- `usePrepareCommit`: selección de archivos, mensaje y redacción por IA.

Se crean cuando la zona que los usa se extrae, no antes.

### 3. Estilos junto a su componente

Cada componente importa su propio `*.module.css` con las clases que usa, copiadas sin cambios. Las variables de diseño comunes (`--sdd-body-width`, `--sdd-body-gutter`) quedan en el armazón. Las pruebas de paleta (`ui-color-scan`) cubren los archivos nuevos.

### 4. Cómo se comprueba que no cambió nada

Las pruebas actuales de SDD siguen pasando sin cambiar lo que comprueban; sólo pueden cambiar sus imports. Antes y después de cada extracción, una captura real de la zona sobre este repo, tomada en el mismo estado, tiene que coincidir.

### 5. Textos por pantalla, al final

`lib/i18n.ts` (7400 líneas) se parte en `lib/i18n/<pantalla>.ts`, con `useT` y las claves iguales. Va en una tanda aparte, después de las zonas.

## Risks / Trade-offs

- Pasar demasiadas props entre el armazón y las zonas vuelve a acoplar todo: si una zona necesita más de diez, su lógica va a un hook.
- Mover clases de CSS puede romper selectores anidados entre zonas: buscar cada clase antes de moverla.
- Choques con otras tandas sobre los mismos archivos: no correr esta partición en paralelo con trabajo en SDD.

## Migration Plan

Sin datos que migrar. Cada extracción es un commit independiente que se puede revertir solo.

## Open Questions

Ninguna. La medición con Fallow (puntaje del archivo, funciones más complejas) se toma antes y después de la partición, como dato y no como requisito.
