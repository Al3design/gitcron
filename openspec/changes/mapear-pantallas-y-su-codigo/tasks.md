# Tasks

Lista de resultados y comprobaciones pendientes. Referencias de implementación en [execution.md](execution.md).

## 1. Modelo

- [x] 1.1 **Orquestador/auditor:** Definir contrato pantalla/función y asociación muchos-a-muchos con evidencia. **Comprobación:** Incluye archivos compartidos, estados sin URL y procedencia manual/estática/inferida/desconocida.
- [ ] 1.2 **IA local:** Agregar extractor de rutas Next/React sin ejecutar el repo. **Comprobación:** Fixture de rutas/layouts demuestra archivos propios y compartidos; import dinámico no resuelto queda desconocido.
- [ ] 1.3 **IA local:** Agregar detección de vistas por switches de GitCron. **Comprobación:** Reconoce Graph, SDD y Cartografía como vistas aunque no tengan URL propia.
- [ ] 1.4 **IA local:** Unir asociaciones con relaciones del grafo y niveles de cobertura. **Comprobación:** Ausencia de aristas no se interpreta como ausencia de dependencias.
- [ ] 1.5 **IA local:** Persistir asociaciones manuales fuera del cache reconstruible. **Comprobación:** Reindexado conserva asociación manual; ruta renombrada queda pendiente de resolver, no se reasigna por intuición.
- [ ] 1.6 **IA local:** Agregar indexación incremental cancelable y exclusiones. **Comprobación:** Cambio de rama/repo descarta resultado viejo; medir sobre fixture grande sin ejecutar código.

## 2. Interfaz

- [ ] 2.1 **IA local:** Construir catálogo de pantallas con estado de cobertura. **Comprobación:** Repo sin UI muestra módulos/no aplica; incompleto se distingue de vacío.
- [ ] 2.2 **IA local:** Construir detalle con archivos, estilos, datos y compartidos. **Comprobación:** Una pantalla puede tener múltiples archivos y uno pertenecer a varias; mapa técnico sigue accesible.
- [ ] 2.3 **IA local:** Conectar abrir archivo/diff y consulta contextual de pantalla. **Comprobación:** Usa referencias verificadas y rechaza selección obsoleta; IA distingue evidencia de inferencia.

- [ ] 2.4 **IA local:** Quitar la columna derecha del chat de Cartografía y publicar su selección y herramientas en el panel de asistencia (requiere retomar 2.4 y 2.6). **Comprobación:** No queda otra superficie de conversación en Cartografía; preguntar sobre una pantalla o archivo desde el panel cita esa selección.
- [ ] 2.5 **IA local:** Rediseñar la estética de Cartografía con módulos CSS y tokens de `@theme`. **Comprobación:** Sin clases de Tailwind ni colores fuera de la paleta en Cartografía; capturas antes y después revisadas por Alejandro en su ronda de UX.
- [ ] 2.6 **IA local:** Mostrar en cada cuadro de pantalla qué hace, en lenguaje llano, y qué archivos la forman. **Comprobación:** Alejandro identifica qué hace cada pantalla de GitCron y dónde está su código sin conocer carpetas; una descripción sugerida por IA se distingue de una manual y cita sus archivos.

## 3. Aceptación

- [ ] 3.1 **Orquestador/auditor:** Comprobar localización de código desde una pantalla con Alejandro. **Comprobación:** Identifica archivos sin conocer carpetas; comprobar renombrado, layout compartido, cancelación y vista técnica.
