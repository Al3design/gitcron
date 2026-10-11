# Tareas — un-solo-sistema-de-estilos

## 1. Decisión y regla

- [x] 1.1 **Alejandro:** Elegir el sistema de estilos del proyecto entre módulos CSS (recomendado) y Tailwind, según la tabla de design.md. **Comprobación:** Decisión anotada en design.md con fecha.
- [x] 1.2 **Orquestador/auditor:** Escribir la regla en `openspec/config.yaml`: sistema para el código nuevo, umbral de tres repeticiones para una pieza compartida y la regla de los módulos CSS. **Comprobación:** Regla en un solo lugar, sin repetirla en prompts (DESIGN.MD es el pedido original de la maqueta, no un documento de reglas).

## 2. Piezas compartidas

- [x] 2.1 **IA local:** Crear `Stack`, `Row`, `PlainList` y `Text` en `components/ui/`, cada una con su módulo y sólo tokens de `@theme`. **Comprobación:** Prueba de cada pieza; las pruebas de paleta y sintaxis CSS las recorren.

## 3. Reemplazo por zonas

- [x] 3.1 **IA local:** Reemplazar en SDD (`components/pipeline/sdd/` y `OpenSpecDashboard.module.css`) los bloques repetidos por las piezas, y los alias `--sp-N` por `--space-N`. **Comprobación:** Capturas reales iguales antes y después; pruebas sin cambiar lo que comprueban; menos líneas de CSS.
  - 2026-10-10: piezas usadas en los bloques que sólo declaraban un acomodo y alias `--sp-N` eliminados (`OpenSpecDashboard.module.css` de 4853 a 4728 líneas). Quedan para la 3.2, porque se pueden reemplazar igual: `.draftLogReasoningBox` y `.startHeaderTitleGroup` (columna, separación 1), `.rawEditorContainer`, `.markdownFormattedContainer`, `.skeletonBlock` y `.journeyNext` (columna, separación 2, ancho completo), `.sessionRanAt`, `.sessionContinues` y `.flowHint` (texto técnico chico) y las listas `.aiSentParamList` / `.whereYouLeftOff*List`.
- [x] 3.2 **IA local:** Lo mismo en `components/ai/`, y dejar en un solo módulo las reglas copiadas entre `AiSentDetails.module.css` y `OpenSpecDashboard.module.css`. **Comprobación:** Capturas iguales de Motores y modelos y del detalle de lo enviado; pruebas en verde.
  - 2026-10-10: clases remanentes de SDD y de `components/ai/` (`AiModelPicker`, `AiSentDetails`, `AiUseLine`) migradas a `Stack`, `Row`, `PlainList` y `Text`. Reglas copiadas de `.aiSent*` eliminadas de `OpenSpecDashboard.module.css`. Reducción neta de 120 líneas de CSS y bloques repetidos reducidos de 36 a 30. Capturas de Motores y modelos y Lo enviado con 0.00% de diferencia.

## 4. Cierre

- [ ] 4.1 **Orquestador/auditor:** Medir de nuevo bloques repetidos, líneas de CSS y nota de Fallow, y verificación completa. **Comprobación:** Números de antes y después en el reporte; `pnpm verificar --completa` en verde.
