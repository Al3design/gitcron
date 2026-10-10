# Un solo sistema de estilos y piezas compartidas

## Why

GitCron tiene una sola fuente de valores de diseño: los tokens de `@theme` en `app/globals.css` (colores, espaciado, tipografía, bordes), cuidados por las pruebas de paleta. Pero escribe las reglas de dos maneras. 38 componentes usan módulos CSS (`*.module.css`), 19 usan clases de Tailwind dentro del JSX y 2 mezclan las dos (medido el 2026-10-10 sobre 71 componentes). Cada IA que entra elige una y la pantalla se vuelve más difícil de revisar y de mantener pareja.

Además, los acomodos básicos se reescriben en cada lugar: en las hojas de SDD e IA hay 34 bloques de reglas idénticos repetidos. «Columna con separación chica» aparece 10 veces con nombres distintos, «fila centrada con separación» otras 10 y «fila que envuelve» 8. Hay también reglas copiadas entre `AiSentDetails.module.css` y `OpenSpecDashboard.module.css`, y alias locales (`--sp-N`) que repiten los tokens globales (`--space-N`).

## What Changes

- Elegir un solo sistema para escribir estilos (decisión de Alejandro, tarea 1.1) y dejarlo como regla del proyecto.
- Crear piezas compartidas para los acomodos que se repiten (columna, fila, fila que envuelve, lista sin viñetas) y para los estilos de texto repetidos (texto secundario chico, texto técnico en monoespaciado), con nombres que digan qué son.
- Reemplazar los bloques repetidos por esas piezas, sin cambiar lo que se ve.
- Quitar los alias locales que duplican tokens globales y las reglas copiadas entre módulos.
- Migrar al sistema elegido los componentes del otro sistema cuando una tanda los toque, no todos de una vez.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `ui-visual-system`: un solo sistema para escribir estilos, con piezas compartidas para los acomodos que se repiten.

## Impact

Hojas de estilo de `components/pipeline/`, `components/pipeline/sdd/` y `components/ai/`, una carpeta nueva de piezas compartidas (`components/ui/`), y las pruebas de paleta y sintaxis CSS. Sin cambios de comportamiento ni de lo que se ve.

## Dependencies

Va después de `modularizar-sdd`, en una rama sobre la suya: trabaja sobre las zonas ya partidas.
