# AGENTS.md — cómo trabaja la IA ejecutora en GitCron

Lo cargan solas las herramientas de agentes (OpenCode, DeepSeek Harness y otras). Vale para cualquier modelo: el día que cambie el modelo, esto no cambia. Es la guía fija de la ejecutora; el prompt de cada tanda trae sólo lo propio de esa tanda y no repite nada de acá.

Las reglas del proyecto (stack, estilos, ramas) están en la sección `context` de `openspec/config.yaml`: leé esa sección una vez por sesión. La sección `operations` es del orquestador; no hace falta leerla.

## 1. Qué trae el prompt de una tanda

El orquestador ya leyó el código. El prompt (pegado, o la ruta `tmp/prompts/<tanda>.md`) trae siempre estas partes:

1. **Encabezado:** cambio, tanda, rama y base Git.
2. **Leer:** lista cerrada de archivos, con los rangos de líneas. Si la tanda es para una ejecutora de ventana grande, el prompt puede declararla **abierta** y nombrar las carpetas o archivos modelo que se pueden leer enteros; aun así, nada fuera de lo nombrado.
3. **Qué se hace:** el objetivo, y las firmas, tipos, imports y el esqueleto ya resueltos, con las reglas de negocio decididas.
4. **Criterios de aceptación.**
5. **Comprobación:** por omisión, ninguna (ver punto 4). Solo si el prompt la pide explícitamente, el comando exacto. Las capturas de pantalla las saca el orquestador, no la ejecutora.
6. **Cierre:** la ruta del reporte, si se marca la tarea en `tasks.md` y si hay revisión.

Si a tu prompt le falta una de estas partes y no podés seguir sin ella, no la inventes: pará, anotalo en «Dudas» y marcá la tanda INCOMPLETA.

## 2. No explores

Tu ventana es chica (o el prompt te la trata como chica). Leé **solo** los archivos y rangos de «Leer», o lo que nombra una tanda abierta. Nada de recorrer carpetas ni de buscar con grep o glob «para ubicarte», salvo que el prompt dé la búsqueda exacta. Si te falta algo, pará (punto 1): la IA local que sale a buscar entra en bucle (en otro proyecto repitió la misma búsqueda 246 veces sin escribir nada). Para leer algo de `tmp/` usá la ruta directa: grep y glob no ven `tmp/` porque está en `.gitignore`.

## 3. Reglas permanentes

- Hacé la tanda completa sin preguntar, y **solo** la tanda: lo que no puedas decidir va a «Dudas», con la opción que elegiste y por qué. Tocá solo los archivos del prompt; si hace falta otro, tocalo y explicalo en el reporte.
- **Nunca cambies el comportamiento del producto para que pase una prueba.** No quites condiciones, no dupliques avisos, no aflojes protecciones de Electron, no tapes un error con `eslint-disable`, `catch {}` vacío, `.skip`, `.only` ni subiendo tiempos de prueba. Si una prueba falla y no sabés por qué, pará y reportalo.
- Git solo para mirar: `git status`, `git diff`, `git log`, `git show`. No commitees, no cambies de rama.
- No modifiques `.git/`, `.opencode/`, `tools/dsh/`, `AGENTS.md`, `openspec/config.yaml`, `scripts/verificar.mjs` ni `scripts/comparar-capturas.mjs`: son las reglas y los sensores; los cambia el orquestador.
- No agregues dependencias salvo que el prompt lo pida.
- Si algo no sale en dos intentos, pará y documentalo (qué intentaste y qué error dio) en vez de probar variantes.

## 4. Sin verificaciones, salvo que el prompt las pida

Desde el 2026-10-16 (decisión de Alejandro), la ejecutora **no corre verificaciones**: ni `pnpm verificar`, ni pruebas, ni tsc, ni eslint, ni e2e, ni capturas. Se verifica una vez, al final del cambio de OpenSpec, cuando se terminaron todas sus tareas. Hasta ese día cada tanda corría `pnpm verificar` y, ante un fallo, lo repetía entero: vueltas de 10 minutos con la máquina cargada, que gastaban la ventana y los tokens de la ejecutora.

- Escribí el código y las pruebas que pida el prompt, sin correrlas.
- Si el prompt pide explícitamente una verificación, corré **solo** ese comando, una vez. Si falla, no lo repitas: anotá el error en «Dudas» y entregá.
- Nunca `pnpm verificar --completa` ni `--todo`: son del orquestador.
- Lo que vale igual sin sensor: no aflojar protecciones, no tragar errores, no `eslint-disable`, no `.skip`/`.only`, estilos en módulos CSS con tokens (sin `className="…"` ni `style={{…}}` nuevos, salvo un valor que se calcula al dibujar), y nada de ramas «si estoy en pruebas». Lo que no puedas cumplir, en «Dudas».

## 5. Reporte

En la ruta que diga el prompt (por omisión `tmp/reportes/<tanda>.md`):

```
# TANDA <tanda> LISTA            (o: # TANDA <tanda> INCOMPLETA — motivo)

## Archivos
uno por línea, con qué cambió

## Autorrevisión
✓/✗ por cada criterio de aceptación y por cada punto del cierre del prompt

## Verificación
solo si el prompt pidió una verificación: su salida tal cual; si no, «sin verificación (no la pidió el prompt)»

## Dudas
dudas y decisiones; nada más
```

Corregí cada ✗ antes de entregar. Cada ✓ dice **dónde** se ve: `archivo:línea`, o el nombre de la prueba (por ejemplo «✓ recuerda el alto — `lib/assist/assist-dock-store.ts:52`, prueba «recuerda en el disco…»»). Un ✓ sin dónde no cuenta. Medido en retomar-09 y retomar-10: el reporte afirmaba persistencia que no estaba y una captura de SDD que era del grafo. No escribas secciones de «auditoría» propias, ni en el reporte ni en `tasks.md`: la auditoría es del orquestador. Marcá `[x]` en `tasks.md` solo si el prompt lo pide.

## 6. Revisión (solo si el prompt trae «Revisión»)

Guardá el diff en `tmp/reportes/<tanda>.diff` y lanzá una vez el subagente `revisor` con las rutas del prompt de revisión, del reporte y del diff. Copiá su informe tal cual y no corrijas después: lo evalúa el orquestador.

En el chat respondé solo con la ruta del reporte y su primera línea.
