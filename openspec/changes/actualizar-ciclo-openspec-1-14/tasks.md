# Tasks

## 1. Mediciones

- [x] 1.1 **Orquestador/auditor:** Medir en qué versión de OpenSpec aparece cada herramienta, leyendo AI_TOOLS de cada versión publicada de 1.0.0 a 1.14.0. **Comprobación:** `mediciones/herramientas-por-version.json` con las 50 herramientas de 1.14.0 y la fuente declarada.
- [ ] 1.2 **Orquestador/auditor:** Investigar y escribir una descripción verificada de cada herramienta de la lista de 1.14.0, en es/en/zh, con la fuente consultada; las que no se puedan confirmar quedan sin descripción. **Comprobación:** `mediciones/descripciones.md` con una fila por id (descripción y fuente, o «sin confirmar») y ningún id fuera de la lista de 1.14.0.

## 2. Ciclo 1.14 y lista propia

- [ ] 2.1 **IA local:** Subir el ciclo SDD a OpenSpec 1.14.0 y recapturar la lista propia con la versión de aparición de cada herramienta (D1): `addedIn` y `addedInOrEarlier` en la lista, el script de captura que conserva los de la lista anterior y marca las nuevas con la versión capturada, valores iniciales desde la medición 1.1. **Comprobación:** Las pruebas que fijaban 1.13.0 pasan con 1.14.0; prueba de la lista (50 herramientas, `amp` desde 1.14.0, `codex` desde 1.0.0 o antes, `bob` «IBM Bob»); prueba del script con una lista anterior simulada (conserva `addedIn`, marca las nuevas).

## 3. Carpeta compartida

- [ ] 3.1 **IA local:** Herramientas de la carpeta compartida anotada a su propio nombre (D2), por el motor y por el respaldo, y la pantalla que lo dice. **Comprobación:** Pruebas con la forma medida en odontoPro (`agents` configurada, `codex` presente y no configurada, `.openspec-target` = `agents`): Codex sale configurada por la carpeta compartida y no está en «Falta configurar»; lo mismo con Amp; sin instrucciones en `.agents/skills` no cuenta; con la carpeta anotada a `codex` rige lo anterior; el respaldo da el mismo resultado; montaje del bloque de agentes con «por la carpeta compartida .agents» en es/en/zh.

## 4. Conteo de una actualización

- [ ] 4.1 **IA local:** Contar los archivos que cambió la actualización comparando antes y después (D3), en una función común a las dos ramas de `runOpenSpecUpdate`. **Comprobación:** Pruebas con un repositorio temporal real: una carpeta nueva con tres archivos cuenta tres; un `tasks.md` modificado antes y no tocado no cuenta; un archivo administrado ya modificado y reescrito con otro contenido cuenta; un archivo devuelto a `HEAD` cuenta; el resumen en pantalla usa ese número.

## 5. Lista explicada

- [ ] 5.1 **IA local:** Catálogo de descripciones con los textos de 1.2 copiados tal cual (D4), y la explicación y la versión de aparición en el bloque de agentes y en la elección de herramientas al inicializar o configurar. **Comprobación:** Prueba que falla si el catálogo describe un id ausente de la lista propia; montaje con una herramienta descrita (Codex), una sin descripción («sin descripción todavía») y una del motor ausente de la lista propia («posterior a OpenSpec 1.14»); textos en es/en/zh.

## 6. Integración

- [ ] 6.1 **Orquestador/auditor:** Recorrido en la máquina de Ale con OpenSpec 1.14.0: la franja dice «Ciclo SDD v1.14.0»; en odontoPro Codex figura configurada por la carpeta compartida y la integración al día; una actualización real muestra el número de archivos que coincide con `git status --untracked-files=all` de lo que cambió; la lista se lee con sus explicaciones. **Comprobación:** `pnpm verificar --change actualizar-ciclo-openspec-1-14` en verde y revisión en pantalla de Ale.
