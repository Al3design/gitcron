# Design

## Context

Estado medido el 2026-09-29 (motivación en proposal.md):

| Uso | Hoy | Dónde |
|---|---|---|
| Redacción de commit | LM Studio `localhost:1234`; el renderer nunca manda `baseUrl` | `electron/ipc/commit-message-ai.ts`, `electron/ai/commit-message/local-provider.ts` |
| Cartografía | OpenRouter o LM Studio | `electron/ai/carto/*`, `components/cartography/CartoAISettings.tsx` |
| Análisis de versión de OpenSpec | LM Studio fijo | `electron/pipeline/openspec-version-analysis.ts` (`createLmStudioConfig`) |
| Temporal Agent | OpenRouter o API de Anthropic | `electron/ai/providers/*`, `components/TemporalAgentSettings.tsx` |
| Agente de SDD | Claude, Codex, OpenCode sin modelo; agy no lanzable | `PipelineRuntimeLauncher.tsx`, `runtime-session-hub.ts` |

Piezas que ya existen y se reutilizan: `text-client.ts` (URL base + clave opcional + cabeceras sobre la API
de OpenAI; `createUnslothConfig` sin llamadores), `key-store.ts` (safeStorage, un secreto por proveedor de
una lista cerrada, con nombre opcional; el preload descarta el nombre), `requestedModel` en el hub y en los
adaptadores de Claude, Codex y OpenCode, `AiModelControls` (carga, contexto, TTL de LM Studio).

`~/.config/opencode/opencode.json` de Ale declara `lmstudio` (`localhost:1234`), `unslothpc` (túnel
`https://llm.aledesign.dev/v1`, clave y cabeceras `CF-Access-Client-Id`/`Secret`) y `unslothpclocal`
(`http://192.168.1.7:8888/v1`, mismos secretos y mismos siete modelos). OpenCode 1.18.33 responde ACP
protocolo 1. `agy` 1.2.13 tiene `-p`, `stream-json`, `--model`, `--mode accept-edits|plan` y `agy models`.

## Goals / Non-Goals

**Goals:**
- Un único punto en main que responde «¿qué proveedor, modelo y dirección usa este uso?», consumido por
  los cinco usos.
- Día uno sin sorpresas: al instalar la versión, cada uso sigue con lo que tenía hasta que la persona
  cambie algo.

**Non-Goals:**
- Conversación, memoria o recuperación de fuentes: son de `retomar-trabajo-con-asistencia-contextual`, que
  consume este catálogo.
- Editar `opencode.json` o la configuración de los CLI.
- Gestionar cuentas de suscripción (iniciar sesión, cuotas): se informa el estado y la orden, no se opera.
- Proveedores con protocolo propio nuevos más allá de la API de Anthropic que ya existe.

## Decisions

### D1. El catálogo vive en main y se persiste en dos partes
Datos no secretos (proveedores, direcciones, modelos declarados, elección por omisión, excepciones por
uso) en un JSON de `userData`; secretos en `key-store`. El renderer recibe el catálogo sin secretos y sólo
puede pedir «existe / reemplazar / borrar». *Alternativa descartada:* guardar todo en el store de
preferencias del renderer; los secretos no pueden pasar por ahí.

### D2. Secretos con nombre por proveedor del catálogo
`key-store` suma un espacio `catalog:<providerId>` con nombres de secreto (`apiKey`, y una entrada por
cabecera secreta), validando `providerId` con el mismo criterio que los nombres de secreto. Los espacios
actuales (`openrouter`, `claude`, `unsloth`…) siguen leyéndose para migrar. El preload pasa el nombre del
secreto que hoy descarta. *Alternativa descartada:* ampliar la lista cerrada con cada proveedor importado;
los ids los elige la persona.

### D3. Tres tipos de proveedor, una sola interfaz de uso
- `openai-compatible`: una o dos direcciones, cabeceras, clave opcional, lista por `GET /models`. Capacidad
  `load` sólo si el servidor expone la API nativa de LM Studio (se detecta, no se supone por el nombre).
  OpenRouter es un preset de este tipo.
- `anthropic-api`: la excepción que ya existe en `providers/claude.ts`.
- `cli`: Claude, Codex, Antigravity. Para texto se corre el CLI en modo no interactivo en un directorio
  temporal vacío, sin herramientas de escritura (Claude sin herramientas, Codex `--sandbox read-only`,
  agy `--mode plan`), con el prompt por stdin y salida JSON. Para agente, el runtime del hub.
Cada uso llama a `resolveModelFor(use)` y recibe `{provider, model, address, destination}`; `destination`
es `this-machine | own-server | external-service` y la pantalla lo muestra. Las suscripciones por CLI
cuentan como `external-service`: el contenido sale de la máquina.

### D4. Sin caída a otro proveedor; sí entre direcciones del mismo
Si el proveedor no responde, el uso falla con el motivo. La única alternancia automática es local → remota
del mismo proveedor: sondeo `GET /models` a la local con tope de 1,5 s; el resultado se recuerda un minuto
y se invalida ante un fallo. *Alternativa descartada:* cadena Unsloth → LM Studio → OpenRouter (la de la
nota del 2026-09-14): manda contenido a un destino que la persona no eligió.

### D5. Importación: vista previa, unión sugerida, sin tocar el archivo
Se lee `provider.*`: `options.baseURL`, `options.apiKey`, `options.headers`, `models`. Una cabecera cuyo
nombre contiene `secret`, `key`, `token`, `authorization` o `client-id` se trata como secreto. Dos
proveedores con la misma lista de modelos y los mismos secretos que difieren sólo en la URL se proponen
como uno con dos direcciones; local es la de `localhost`, `127.0.0.1` o una IP privada. El id del
proveedor en OpenCode se conserva: sirve para D7.

### D6. Migración sin cambio de comportamiento
En el primer arranque: proveedor LM Studio en `localhost:1234`; OpenRouter y Anthropic con sus claves
existentes si las hay; la elección por omisión es LM Studio con el modelo recordado de la redacción
(`lib/ai-model-memory`), y Temporal Agent y Cartografía quedan con una excepción que reproduce su
elección actual. Así nada cambia hasta que la persona toca algo, y lo que antes estaba escondido queda a
la vista como excepción.

### D7. Agente sobre un servidor propio: OpenCode con el proveedor que ya conoce
Un proveedor importado desde `opencode.json` ya existe para OpenCode con el mismo id; el lanzador le pide
`<providerId>/<modelo>`. Un proveedor dado de alta a mano en GitCron no existe para OpenCode: en esta
entrega figura como «no disponible como agente» con ese motivo. Cómo se elige el modelo de una sesión ACP
se mide antes de implementar (tarea 1.2); si ACP no lo permite, se pasa por la opción de modelo del
proceso `opencode acp`, sin escribir configuración en disco.

### D8. Antigravity: adaptador estructurado nuevo, con fixture real antes que código
Se reemplaza el wrapper por un adaptador sobre `agy -p --output-format stream-json --model <m> --mode
accept-edits`, con reanudación por `--conversation`. El formato de eventos se fija con una captura real
saneada (tarea 1.1), no por analogía con Claude. Sin `--dangerously-skip-permissions`: si un comando
necesita aprobación en modo no interactivo, el adaptador lo reporta como motivo de detención (spec).

### D9. Dónde se ve la elección
Una sección de ajustes «Motores y modelos» (catálogo, importación, elección por omisión, excepciones). En
cada uso, una línea con motor, modelo y destino, con un acceso para cambiar la excepción de ese uso.
`AiModelControls` se monta sólo si el proveedor tiene capacidad `load`.

## Risks / Trade-offs

- [El stream de `agy` cambia entre versiones] → versión instalada reportada; eventos desconocidos se
  ignoran y se cuentan; la conformance común corre sobre la captura.
- [Un CLI de suscripción no expone lista de modelos] → alta manual y el modelo por omisión del CLI
  nombrado como tal.
- [Sondeo local lento en redes con pérdida] → tope corto y recuerdo por un minuto; la pantalla dice cuál
  dirección usó.
- [Texto por CLI tarda más que una API] → el uso lo declara con su tiempo transcurrido, como ya hace la
  redacción local.
- [Importar secretos de un archivo en claro] → GitCron no borra ni modifica el archivo; la pantalla sugiere
  quitar las claves de `opencode.json` si la persona ya no lo usa, sin hacerlo.

## Migration Plan

D6 en el primer arranque de la versión, idempotente. Volver atrás: la versión anterior ignora el JSON del
catálogo y el espacio `catalog:*` del baúl; sus claves originales no se borran durante la migración.

## Open Questions

- Nombre visible de las familias en inglés y chino (se decide al escribir i18n).
