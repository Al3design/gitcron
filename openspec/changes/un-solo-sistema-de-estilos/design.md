# Un solo sistema de estilos y piezas compartidas

## Context

- **Valores:** `@theme` en `app/globals.css` (Tailwind 4) declara los tokens. Las pruebas `ui-color-scan`, `css-syntax-scan`, `visual-scale-scan` y `tailwind-token-classes` cuidan que no aparezcan valores fuera de ellos. Esto ya es una sola fuente y no cambia.
- **Reglas, medido el 2026-10-10 sobre 71 componentes:** 38 sólo con módulos CSS, 19 sólo con Tailwind y 2 con los dos. Los módulos se concentran en `components/pipeline/` y `components/ai/`. Tailwind, en las pantallas más viejas (Graph, barra lateral, modales).
- **Repetición:** 34 bloques de tres o más declaraciones idénticas en las hojas de SDD e IA. Los más frecuentes son acomodos: `flex` en columna con `gap: var(--space-1)` (10 veces), fila centrada con `gap: var(--space-2)` (10), fila que envuelve (8) y lista sin viñetas en columna (4). Les siguen estilos de texto: secundario chico, técnico en monoespaciado (3 cada uno).
- **Lección de `modularizar-sdd`:** con módulos CSS, una clase copiada a otro archivo es otra clase, y una regla combinada sólo funciona si sus clases viven en el mismo módulo.

## Goals / Non-Goals

**Goals:** una sola forma de escribir estilos para el código nuevo; piezas compartidas con nombre para lo que se repite; menos CSS que leer por tanda; nombres que una IA y Cartografía puedan reconocer.

**Non-Goals:** rediseñar pantallas; cambiar los tokens; migrar de golpe todos los componentes del otro sistema; adoptar una biblioteca nueva (StyleX u otra).

## Decisions

### 1. El sistema: lo decide Alejandro (tarea 1.1)

| Opción | A favor | En contra |
|---|---|---|
| **A. Módulos CSS** (recomendada) | Es la mayoría (38 de 71). Las clases tienen nombre (`.taskRow`), que una IA y Cartografía pueden buscar y relacionar. Las pruebas de paleta ya recorren los `.css`. | Hay que migrar los 19 componentes con Tailwind cuando se toquen. |
| **B. Tailwind** | Los acomodos básicos (`flex flex-col gap-1`) se escriben sin CSS aparte. Las pantallas viejas ya lo usan. | Hay que migrar 38 componentes y unas 6000 líneas de CSS. Las clases utilitarias no dicen qué es la pieza. Las reglas combinadas y los estados se escriben peor. |

Recomendación: **A**, con los tokens de `@theme` como única fuente de valores. Tailwind sigue instalado, porque `@theme` lo usa, y las pantallas que lo usan se migran sólo cuando una tanda las toque.

### 2. Piezas compartidas para lo que se repite

En `components/ui/`, cada una con su módulo:

- `Stack`: columna con separación de la escala (`gap="1" | "2" | "3" | "4"`).
- `Row`: fila centrada con separación, y `wrap` para que envuelva.
- `PlainList`: lista sin viñetas en columna.
- `Text`: variantes `secondary-xs` y `mono-xs` para los dos estilos de texto repetidos.

Pocas piezas y chicas. Una pieza nueva entra sólo si su patrón aparece tres veces o más.

### 3. Reemplazo sin cambios visibles

Cada tanda reemplaza los bloques repetidos de una zona por las piezas compartidas y borra las reglas que quedan sin uso. Se comprueba con capturas reales antes y después de la zona, y con las pruebas existentes sin cambiar lo que comprueban.

### 4. Limpieza de duplicados

- Alias `--sp-N` de `OpenSpecDashboard.module.css` → `--space-N`, en todos sus usos, y se borran los alias.
- Reglas copiadas entre `AiSentDetails.module.css` y `OpenSpecDashboard.module.css` → quedan en un solo módulo.

### 5. La regla queda escrita

En `openspec/config.yaml` y en `DESIGN.MD`: con qué sistema se escribe el código nuevo, cuándo se crea una pieza compartida y la regla de los módulos CSS (una clase vive en un solo módulo, y una regla combinada se queda donde viven sus clases).

## Risks / Trade-offs

- Reemplazar un bloque por una pieza puede cambiar la especificidad de una regla. Por eso, capturas antes y después de cada zona.
- Demasiadas piezas compartidas vuelven a esconder dónde está cada estilo. Por eso, el umbral de tres repeticiones.

## Migration Plan

Por zonas, una tanda por zona, empezando por SDD (ya partida). Los componentes del otro sistema se migran al tocarlos.

## Open Questions

La elección del sistema (decisión 1), que es de Alejandro.
