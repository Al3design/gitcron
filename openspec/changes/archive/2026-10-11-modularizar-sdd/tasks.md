# Tareas — modularizar-sdd

## 1. Medición

- [x] 1.1 **IA local:** Medir el punto de partida: líneas por zona, puntaje de Fallow de `OpenSpecDashboard.tsx` (`fallow health --file-scores`) y capturas reales de cada zona sobre este repo. **Comprobación:** Reporte con los números y las capturas de referencia.

## 2. Zonas

- [x] 2.1 **IA local:** Extraer las vistas del cambio (Resumen, Tareas, Artefactos, Diffs, Actividad) a `components/pipeline/sdd/views/`, con `useSddNavigation` y sus estilos. **Comprobación:** Pruebas de SDD en verde sin cambiar lo que comprueban; cada vista se monta sola en una prueba; capturas iguales a las de referencia.
- [x] 2.2 **IA local:** Extraer la preparación del commit a `SddPrepareCommit` con `usePrepareCommit` y sus estilos. **Comprobación:** Pruebas de redacción y preparación en verde; captura igual a la de referencia.
- [x] 2.3 **IA local:** Extraer la barra de estado (`SddStatusBar`, con `useEngineStatus`) y el encabezado del cambio (`SddChangeHeader`). **Comprobación:** Pruebas en verde; capturas iguales.
- [x] 2.4 **IA local:** Extraer el cambio archivado (`SddArchivedChange`, con `useArchiveFlow`) y las pantallas de inicio (`SddStartScreens`). **Comprobación:** Pruebas en verde; capturas iguales; `OpenSpecDashboard.tsx` queda como armazón.

## 3. Textos

- [x] 3.1 **IA local:** Partir `lib/i18n.ts` por pantalla en `lib/i18n/`, con `useT` y las claves iguales. **Comprobación:** Pruebas de i18n en verde; ninguna clave cambia de valor.

## 4. Cierre

- [x] 4.1 **Orquestador/auditor:** Verificación completa (`pnpm verificar --completa`) sobre el resultado y nueva medición con Fallow. **Comprobación:** Verde; números de antes y después en el reporte.
  - 2026-10-10: `pnpm verificar --completa --desde change/retomar-trabajo-con-asistencia-contextual` en verde (2868 pruebas, 5 e2e, Fallow sin hallazgos nuevos en 32 archivos). `OpenSpecDashboard.tsx`: de 3530 a 1582 líneas; su función ya no está entre las más grandes del proyecto (antes, segunda con 3271); mantenibilidad de Fallow de 77 a 80; depende de 20 módulos en vez de 39. Su CSS: de 5463 a menos de 4860 líneas. La nota general del proyecto queda en 76 (B). En el cierre se corrigieron: el error de lint del archivo, que se había tapado con eslint-disable al mudarlo (vuelve a figurar como conocido en `useEngineStatus.ts`), y las variables de foco y de ancho del cuerpo, que pasan a `app/globals.css` en vez de alias locales de la hoja de SDD. `verificar` ahora ve las trampas de archivos nuevos sin commit y corre las pruebas de estilos cuando se toca un CSS.
