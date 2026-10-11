# AGENTS.md — cómo trabaja la IA ejecutora en GitCron

Lo cargan solas las herramientas de agentes (OpenCode, DeepSeek Harness y otras). Vale para cualquier modelo: el día que cambie el modelo, esto no cambia. Es la guía fija de la ejecutora; el prompt de cada tanda trae sólo lo propio de esa tanda y no repite nada de acá.

Las reglas del proyecto (stack, estilos, ramas) están en la sección `context` de `openspec/config.yaml`: leé esa sección una vez por sesión. La sección `operations` es del orquestador; no hace falta leerla.

## 1. Qué trae el prompt de una tanda

El orquestador ya leyó el código. El prompt (pegado, o la ruta `tmp/prompts/<tanda>.md`) trae siempre estas partes:

1. **Encabezado:** cambio, tanda, rama y base Git.
2. **Leer:** lista cerrada de archivos, con los rangos de líneas.
3. **Qué se hace:** el objetivo, y las firmas, tipos, imports y el esqueleto ya resueltos, con las reglas de negocio decididas.
4. **Criterios de aceptación.**
5. **Comprobación:** el comando exacto (por omisión `pnpm verificar`) y, si hay pantallas, qué capturas sacar.
6. **Cierre:** la ruta del reporte, si se marca la tarea en `tasks.md` y si hay revisión.

Si a tu prompt le falta una de estas partes y no podés seguir sin ella, no la inventes: pará, anotalo en «Dudas» y marcá la tanda INCOMPLETA.

## 2. No explores

Tu ventana es chica. Leé **solo** los archivos y rangos de «Leer». Nada de recorrer carpetas ni de buscar con grep o glob «para ubicarte», salvo que el prompt dé la búsqueda exacta. Si te falta algo, pará (punto 1): la IA local que sale a buscar entra en bucle (en otro proyecto repitió la misma búsqueda 246 veces sin escribir nada). Para leer algo de `tmp/` usá la ruta directa: grep y glob no ven `tmp/` porque está en `.gitignore`.

## 3. Reglas permanentes

- Hacé la tanda completa sin preguntar, y **solo** la tanda: lo que no puedas decidir va a «Dudas», con la opción que elegiste y por qué. Tocá solo los archivos del prompt; si hace falta otro, tocalo y explicalo en el reporte.
- **Nunca cambies el comportamiento del producto para que pase una prueba.** No quites condiciones, no dupliques avisos, no aflojes protecciones de Electron, no tapes un error con `eslint-disable`, `catch {}` vacío, `.skip`, `.only` ni subiendo tiempos de prueba. Si una prueba falla y no sabés por qué, pará y reportalo.
- Git solo para mirar: `git status`, `git diff`, `git log`, `git show`. No commitees, no cambies de rama.
- No modifiques `.git/`, `.opencode/`, `tools/dsh/`, `AGENTS.md`, `openspec/config.yaml`, `scripts/verificar.mjs` ni `scripts/comparar-capturas.mjs`: son las reglas y los sensores; los cambia el orquestador.
- No agregues dependencias salvo que el prompt lo pida.
- Si algo no sale en dos intentos, pará y documentalo (qué intentaste y qué error dio) en vez de probar variantes.

## 4. Sensores: cómo te enterás de si salió bien

`pnpm verificar` es el sensor de la tanda: corre las pruebas que dependen de lo que tocaste, tsc, eslint, openspec validate, Fallow sobre lo agregado y la búsqueda de trampas, y al final dice el **riesgo** de la tanda. Sus mensajes ya dicen qué corregir.

- Corrélo al terminar de editar: una vez por intento, en primer plano. Si tenés el subagente `verificador`, delegale el comando exacto y esperá sin editar.
- Nunca `pnpm verificar --completa` ni `--todo`: esas son del orquestador.
- Ante un fallo, leé solo el bloque de `tmp/verificacion.log` que corresponde, corregí y volvé a correr. No repitas un verde sin cambios.
- Guardá la salida de cada intento en `tmp/reportes/<tanda>-verificacion-intento-N.md`: el verde no borra el fallo anterior.
- **Trampas** (`!!`): cada aviso se corrige o se explica en «Dudas»; no se esconde.
- **Errores heredados** de eslint (los que ya estaban en la base) no son de tu tanda: no los arregles salvo que el prompt lo pida.
- Si Fallow marca **«export sin uso»** en algo que el prompt pide exportar y que se conecta en una tarea posterior, cubrilo con una prueba que lo use y anotalo en «Dudas». No lo dejes sin exportar ni lo conectes por tu cuenta.
- Si el prompt pide capturas, seguí sus pasos y copiá tal cual la salida de `node scripts/comparar-capturas.mjs tmp/reportes/<tanda>`.

## 5. Reporte

En la ruta que diga el prompt (por omisión `tmp/reportes/<tanda>.md`):

```
# TANDA <tanda> LISTA            (o: # TANDA <tanda> INCOMPLETA — motivo)

## Archivos
uno por línea, con qué cambió

## Autorrevisión
✓/✗ por cada criterio de aceptación y por cada punto del cierre del prompt

## Verificación
el resumen de pnpm verificar tal cual (con la línea de riesgo) y la salida del comparador si hubo capturas

## Dudas
dudas y decisiones; nada más
```

Corregí cada ✗ antes de entregar. No escribas secciones de «auditoría» propias, ni en el reporte ni en `tasks.md`: la auditoría es del orquestador. Marcá `[x]` en `tasks.md` solo si el prompt lo pide.

## 6. Revisión (solo si el prompt trae «Revisión»)

Guardá el diff en `tmp/reportes/<tanda>.diff` y lanzá una vez el subagente `revisor` con las rutas del prompt de revisión, del reporte y del diff. Copiá su informe tal cual y no corrijas después: lo evalúa el orquestador.

En el chat respondé solo con la ruta del reporte y su primera línea.
