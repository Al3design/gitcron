# Tareas — modularizar-sdd

## 1. Medición

- [x] 1.1 **IA local:** Medir el punto de partida: líneas por zona, puntaje de Fallow de `OpenSpecDashboard.tsx` (`fallow health --file-scores`) y capturas reales de cada zona sobre este repo. **Comprobación:** Reporte con los números y las capturas de referencia.

## 2. Zonas

- [x] 2.1 **IA local:** Extraer las vistas del cambio (Resumen, Tareas, Artefactos, Diffs, Actividad) a `components/pipeline/sdd/views/`, con `useSddNavigation` y sus estilos. **Comprobación:** Pruebas de SDD en verde sin cambiar lo que comprueban; cada vista se monta sola en una prueba; capturas iguales a las de referencia.
- [ ] 2.2 **IA local:** Extraer la preparación del commit a `SddPrepareCommit` con `usePrepareCommit` y sus estilos. **Comprobación:** Pruebas de redacción y preparación en verde; captura igual a la de referencia.
- [ ] 2.3 **IA local:** Extraer la barra de estado (`SddStatusBar`, con `useEngineStatus`) y el encabezado del cambio (`SddChangeHeader`). **Comprobación:** Pruebas en verde; capturas iguales.
- [ ] 2.4 **IA local:** Extraer el cambio archivado (`SddArchivedChange`, con `useArchiveFlow`) y las pantallas de inicio (`SddStartScreens`). **Comprobación:** Pruebas en verde; capturas iguales; `OpenSpecDashboard.tsx` queda como armazón.

## 3. Textos

- [ ] 3.1 **IA local:** Partir `lib/i18n.ts` por pantalla en `lib/i18n/`, con `useT` y las claves iguales. **Comprobación:** Pruebas de i18n en verde; ninguna clave cambia de valor.

## 4. Cierre

- [ ] 4.1 **Orquestador/auditor:** Verificación completa (`pnpm verificar --completa`) sobre el resultado y nueva medición con Fallow. **Comprobación:** Verde; números de antes y después en el reporte.
