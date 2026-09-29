# Tasks

Lista de resultados y comprobaciones pendientes. Referencias de implementación en [execution.md](execution.md).

## 1. Mediciones antes de código

- [ ] 1.1 **Orquestador/auditor:** Capturar el stream real de `agy` 1.2.13 (`-p --output-format stream-json --model <m> --mode accept-edits`) en un repositorio temporal con un pedido inofensivo que lea un archivo, escriba otro y corra un comando; y el mismo pedido reanudado con `--conversation`. **Comprobación:** Captura saneada en el repo con los tipos de evento, dónde vienen herramientas, uso, id de conversación y resultado final; queda anotado qué pasa cuando corre un comando sin `--dangerously-skip-permissions` (lo corre, lo pide o se detiene).
- [ ] 1.2 **Orquestador/auditor:** Medir cómo se elige proveedor y modelo en una sesión ACP de OpenCode 1.18.33 (parámetros de `session/new`, métodos de modelo, opción del proceso `opencode acp`) usando un proveedor de `opencode.json`. **Comprobación:** Captura saneada y decisión anotada en design.md (D7) con la vía elegida; sin escribir configuración en disco.
- [ ] 1.3 **Orquestador/auditor:** Medir el modo texto de cada CLI de suscripción en un directorio temporal vacío y sin herramientas de escritura: `claude -p --output-format json`, `codex exec` (salida JSON, `--sandbox read-only`), `agy -p --output-format json --mode plan`; con sesión iniciada y sin ella; y si cada uno lista modelos. **Comprobación:** Tabla en design.md (D3) con orden exacta, forma de la salida, mensaje sin sesión y fuente de modelos por CLI.

## 2. Catálogo en main

- [ ] 2.1 **IA local:** Modelo de datos y persistencia del catálogo sin secretos (proveedores de los tres tipos, direcciones, modelos declarados, elección por omisión, excepciones por uso y preferencia rápido/razonamiento) en `userData`. **Comprobación:** Pruebas de lectura/escritura, archivo ausente y archivo corrupto (se informa, no se pisa en silencio).
- [ ] 2.2 **IA local:** Espacio `catalog:<providerId>` con nombres de secreto en `key-store`, e IPC/preload que pasan el nombre del secreto (hoy `setKey` lo descarta) con «existe / reemplazar / borrar» y nunca el valor. **Comprobación:** Pruebas del baúl con id y nombre inválidos; prueba de que ningún canal IPC devuelve un valor de secreto; sin cifrado disponible no se guarda en claro.
- [ ] 2.3 **IA local:** Importador de `~/.config/opencode/opencode.json`: vista previa con secretos enmascarados, unión sugerida de proveedores que difieren sólo en la URL (local = localhost o IP privada), reimportación con diferencias y confirmación; el archivo no se modifica. **Comprobación:** Pruebas con una copia saneada de la forma medida (lmstudio, unslothpc, unslothpclocal), archivo ausente, JSON inválido y reimportación; hash del archivo igual antes y después.
- [ ] 2.4 **IA local:** Lista de modelos por proveedor (`GET /models` para compatibles con OpenAI con el filtro `llm` vigente, OpenRouter, CLI según 1.3) y alta manual; servidor apagado muestra los modelos declarados como no confirmados. **Comprobación:** Pruebas con servidor simulado que responde, que no responde y que devuelve embeddings.
- [ ] 2.5 **IA local:** Resolución de direcciones de un proveedor: local primero con tope de 1,5 s, remota si no, recuerdo de un minuto invalidado ante fallo, y la dirección usada en el resultado. **Comprobación:** Pruebas con reloj falso para local que responde, local que no, ambas caídas (falla con motivo, sin otro proveedor).
- [ ] 2.6 **IA local:** `resolveModelFor(use)` con destino declarado (`this-machine | own-server | external-service`) y la migración D6 idempotente. **Comprobación:** Pruebas de migración desde los ajustes actuales (clave OpenRouter, modelo recordado de redacción, elección de Temporal Agent y de Cartografía) que dejan el comportamiento igual; segunda corrida sin cambios; las claves originales siguen en su lugar.

## 3. Usos de texto

- [ ] 3.1 **IA local:** Cliente de texto por CLI según la tabla de 1.3 (directorio temporal vacío, sin herramientas de escritura, prompt por stdin, salida JSON, cancelación y tiempo límite). **Comprobación:** Pruebas con proceso simulado para salida válida, sin sesión, cancelación y tiempo agotado; ningún proceso queda vivo.
- [ ] 3.2 **IA local:** Redacción de commit, Cartografía, análisis de versión y Temporal Agent usan `resolveModelFor`; se retiran los proveedores fijos (`createLmStudioConfig` directo en análisis de versión, `DEFAULT_LOCAL_BASE_URL` como única dirección de la redacción). **Comprobación:** Pruebas por uso con proveedor de cada familia; proveedor caído falla con motivo y no llama a otro; `rg createLmStudioConfig` sólo en el catálogo.
- [ ] 3.3 **IA local:** Cada pantalla de uso muestra motor, modelo, destino y si es excepción, con acceso a cambiar la excepción de ese uso; `AiModelControls` sólo con proveedores con capacidad de carga. **Comprobación:** Pruebas de montaje: con OpenRouter no aparecen controles de carga; con servicio externo la línea lo dice antes de mandar; i18n es/en/zh.

## 4. Agentes de SDD

- [ ] 4.1 **IA local:** El lanzador manda `requestedModel` con el modelo efectivo del uso «agente de SDD» y la confirmación nombra motor y modelo. **Comprobación:** Prueba del lanzador y del IPC: el hub recibe el modelo; Claude y Codex lo reciben como `--model`.
- [ ] 4.2 **IA local:** Adaptador estructurado de Antigravity según la captura de 1.1 (lanzable, lee/escribe/corre comandos, reanuda por conversación, sin `--dangerously-skip-permissions`, pedido de permiso como motivo de detención con `success: false`); se retira el wrapper y su entrada `launchable: false`. **Comprobación:** Conformance común sobre la captura; prueba del registro; pruebas del caso de permiso.
- [ ] 4.3 **IA local:** OpenCode lanza con `<providerId>/<modelo>` por la vía medida en 1.2; un proveedor dado de alta a mano figura «no disponible como agente» con su motivo; sin OpenCode instalado, el lanzador lo dice y no lanza otro motor. **Comprobación:** Pruebas del adaptador con la captura de 1.2 y del lanzador para los dos casos.

## 5. Ajustes

- [ ] 5.1 **IA local:** Sección «Motores y modelos» en ajustes: catálogo por familia con disponibilidad y motivo, importación con vista previa, alta manual, secretos con reemplazar/borrar, elección por omisión y excepciones por uso con preferencia rápido/razonamiento; los ajustes viejos de Temporal Agent y Cartografía llevan a esta sección. **Comprobación:** Pruebas de montaje del alta, la importación y la excepción; ningún valor de secreto en el DOM; i18n es/en/zh.

## 6. Integración

- [ ] 6.1 **Orquestador/auditor:** Recorrido real en la máquina de Ale: importar su `opencode.json`, redactar un commit con Unsloth por red local y por túnel, Temporal Agent con una suscripción por CLI, lanzar Antigravity y OpenCode con modelo desde SDD, y apagar el servidor para ver el fallo sin caída a otro proveedor. **Comprobación:** `pnpm verificar --change modelos-en-casa` en verde y revisión en pantalla de Ale; no se completa con mocks aislados.
