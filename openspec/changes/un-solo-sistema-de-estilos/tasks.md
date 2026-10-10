# Tareas — un-solo-sistema-de-estilos

## 1. Decisión y regla

- [ ] 1.1 **Alejandro:** Elegir el sistema de estilos del proyecto entre módulos CSS (recomendado) y Tailwind, según la tabla de design.md. **Comprobación:** Decisión anotada en design.md con fecha.
- [ ] 1.2 **Orquestador/auditor:** Escribir la regla en `openspec/config.yaml` y `DESIGN.MD`: sistema para el código nuevo, umbral de tres repeticiones para una pieza compartida y la regla de los módulos CSS. **Comprobación:** Regla en un solo lugar de cada documento, sin repetirla en prompts.

## 2. Piezas compartidas

- [ ] 2.1 **IA local:** Crear `Stack`, `Row`, `PlainList` y `Text` en `components/ui/`, cada una con su módulo y sólo tokens de `@theme`. **Comprobación:** Prueba de cada pieza; las pruebas de paleta y sintaxis CSS las recorren.

## 3. Reemplazo por zonas

- [ ] 3.1 **IA local:** Reemplazar en SDD (`components/pipeline/sdd/` y `OpenSpecDashboard.module.css`) los bloques repetidos por las piezas, y los alias `--sp-N` por `--space-N`. **Comprobación:** Capturas reales iguales antes y después; pruebas sin cambiar lo que comprueban; menos líneas de CSS.
- [ ] 3.2 **IA local:** Lo mismo en `components/ai/`, y dejar en un solo módulo las reglas copiadas entre `AiSentDetails.module.css` y `OpenSpecDashboard.module.css`. **Comprobación:** Capturas iguales de Motores y modelos y del detalle de lo enviado; pruebas en verde.

## 4. Cierre

- [ ] 4.1 **Orquestador/auditor:** Medir de nuevo bloques repetidos, líneas de CSS y nota de Fallow, y verificación completa. **Comprobación:** Números de antes y después en el reporte; `pnpm verificar --completa` en verde.
