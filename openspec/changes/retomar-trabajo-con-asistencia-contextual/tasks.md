# Tasks

Lista de resultados y comprobaciones pendientes. Referencias de implementación en [execution.md](execution.md).

## 1. Contrato de contexto

- [x] 1.1 **Orquestador/auditor:** Fijar identidad repo+checkout+HEAD y selección discriminada reutilizando stores existentes. **Comprobación:** Contrato en design distingue conversación consultiva de sesión de ejecución; conserva el límite existente de una ejecución por repo.
- [x] 1.2 **IA local:** Implementar el resolvedor de referencias de contexto autorizado en main. **Comprobación:** Rechaza otro repo, rutas fuera de scope y selección obsoleta sin leer archivos externos.
- [x] 1.3 **IA local:** Publicar contribuciones tipadas de vista y acciones disponibles. **Comprobación:** Prueba dos vistas y una extensión desconocida; no agrega un switch monolítico de todas las pantallas.

## 2. Conversación durable

- [x] 2.1 **IA local:** Agregar esquema y migración SQLite para conversaciones, mensajes y referencias saneadas. **Comprobación:** Reabrir conserva mensajes; migración idempotente no guarda secretos ni razonamiento interno.
- [x] 2.2 **IA local:** Agregar lectura y eliminación de conversaciones por repo mediante IPC autorizado. **Comprobación:** Eliminar conversación no borra artefactos ni decisiones y otro repo no puede leerla.
- [x] 2.3 **IA local:** Agregar envío cancelable usando la gestión de proveedor/modelo de modelos-en-casa, presupuesto y descarte de resultados obsoletos. **Comprobación:** Cancelación, proveedor caído y cambio de selección no anexan respuesta al destino incorrecto; no envía el repo completo y cambiar de vista conserva la política compartida sin crear ajustes independientes.
- [x] 2.4 **IA local:** Integrar panel de conversación con alcance visible, fuentes y recuperación sin reejecución. **Comprobación:** Cerrar/reabrir recupera texto sin ejecutar herramientas ni iniciar proceso runtime.
- [x] 2.5 **IA local:** Conectar contexto de Graph y SDD al shell de asistencia. **Comprobación:** Pregunta sobre commit histórico o tarea seleccionada cita ese destino, no HEAD por defecto.
- [x] 2.6 **IA local:** Conectar contexto de Cartografía y Centauro al mismo shell. **Comprobación:** Nodo/idea seleccionado viaja como referencia; navegación conserva conversación y explicita cambio de alcance.
- [ ] 2.7 **IA local:** Conectar Configuración y acciones de ejecución mediante contratos existentes. **Comprobación:** Acciones usan disponibilidad real y confirmaciones existentes; consulta persistida no promete resume del proceso.

- [ ] 2.8 **IA local:** Rehacer el cuadro de texto del chat como el de Claude escritorio: empieza en una línea y crece con el texto; abajo a la derecha el modelo y el nivel de razonamiento, y enviar o detener; abajo a la izquierda lo de la pantalla (qué tenés elegido, quitarlo, y el menú «+»); las preguntas sugeridas arriba del cuadro cuando la conversación está vacía; y vista previa del Markdown como en Tareas de SDD (decisión de Alejandro, 2026-10-13). **Comprobación:** Capturas en grafo, SDD y Cartografía; el cuadro crece y vuelve a una línea al enviar; el modelo y el nivel se eligen sin salir del chat y se guardan en el uso `gitcron-assist`.
- [ ] 2.9 **IA local:** Registrar y mostrar el uso de cada respuesta como lo hace DeepSeek Harness: fecha y hora, fichas de entrada, de salida, de razonamiento y de caché, duración y velocidad, y contexto ocupado sobre el límite del modelo; y el total de la conversación al pie (decisión de Alejandro, 2026-10-13). **Comprobación:** Una respuesta guardada conserva sus números al reabrir; sin datos del servidor se dice «sin datos» en vez de cero; el porcentaje de contexto usa el `limit.context` del modelo y, si no lo declara, no se inventa.

## 3. Retomar y orientación

- [x] 3.1 **IA local:** Construir resumen determinista del cambio con objetivo, evidencia y próximo paso. **Comprobación:** Funciona sin IA; distingue documentos presentes, tareas marcadas, pruebas verificadas y commit.
- [ ] 3.2 **IA local:** Invalidar el resumen por cambios de fuentes y exponer referencias fechadas. **Comprobación:** Edición externa y cambio de checkout muestran pendiente de relectura, nunca un resumen viejo como vigente.
- [ ] 3.3 **IA local:** Añadir narración opcional limitada del resumen con fallback. **Comprobación:** No consulta modelo durante navegación pasiva; fallo conserva resumen determinista y fuentes.
- [ ] 3.4 **IA local:** Adaptar flotante contextual y alternancia con inspector conservando acciones alcanzables. **Comprobación:** Con panel fijo abierto se preservan contexto y vías de navegación; sin pendientes no presenta alertas vacías.
- [x] 3.5 **IA local:** Aplicar títulos legibles, tareas resumidas y detalle a demanda en entrada/detalle SDD. **Comprobación:** Texto original sigue accesible, estado documental no parece implementación completa y no fuerza fases fijas.
- [x] 3.6 **IA local:** Hacer del resumen la pantalla de inicio de un cambio: vista «Resumen» primera y por omisión en el menú de vistas de SDD, la lista de tareas como otra vista, y desde el resumen se llega a la tarea en curso o a una sección pendiente (decisión de Alejandro, 2026-10-09). **Comprobación:** Abrir un cambio, activo o archivado, muestra el resumen; tocar la tarea en curso abre Tareas con esa tarea resaltada; ninguna entrada del menú se duplica ni desaparece al cambiar de vista.

## 4. Aceptación

- [ ] 4.1 **Orquestador/auditor:** Recorrer retorno tras ausencia, consulta y ejecución compatible hasta revisión Git. **Comprobación:** Alejandro identifica dónde quedó y qué sigue; verificar dos repos, offline, persistencia y ningún envío IA implícito. Registrar resultados.
