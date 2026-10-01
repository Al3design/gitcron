/**
 * Redactar el asunto de un commit con un modelo local.
 *
 * El tipo de un commit —`feat`, `fix`, `chore`— es el único dato que ninguna
 * fuente del repositorio contiene: no está en el diff, ni en las rutas, ni en la
 * rama, ni en las tareas. Medido, un modelo local lo acierta; también medido, la
 * calidad depende fuerte de cuál sea, así que elegirlo es de la persona.
 */

/**
 * Piso de contexto. Por debajo, el diff de una tanda no entra.
 *
 * Estaba en 32.768 por precaución, y ese número no salía de ninguna medición:
 * el prompt más grande que se midió acá son **4.649 tokens**, y con 16.384 —una
 * vez descontados los 3.000 de salida— quedan más de 13.000 para la entrada. El
 * piso alto impedía bajar el contexto, que es lo que hace falta cuando la placa
 * no aguanta: en la notebook de Ale la iGPU se cayó con `ErrorDeviceLost`
 * procesando un prompt de 4.199 tokens con 65.536 de contexto cargado.
 *
 * Un diff grande se recorta más con un contexto chico, y eso ya se declara en
 * pantalla en lugar de pasar en silencio.
 *
 * Vive acá y no junto al proveedor porque el panel lo necesita para saber desde
 * qué valor puede ofrecer la carga, y el renderer no importa nada de `electron/`.
 * Con el número escrito a mano en los dos lados, cambiarlo en uno dejaba al otro
 * mintiendo.
 */
export const MIN_CONTEXT_LENGTH = 16_384;

/** Lo que se pide al cargar si nadie elige otra cosa. Entra holgado en 12 GB de VRAM. */
export const PREFERRED_CONTEXT_LENGTH = 65_536;

/**
 * Un modelo tal como lo reporta el servidor local.
 *
 * Sale de la API **nativa** `/api/v1/models`, no de la compatible con OpenAI:
 * `/v1/models` sólo devuelve identificadores, y todo lo que hace falta para
 * elegir con criterio —tamaño, cuantización, contexto real, si razona— vive sólo
 * en la nativa.
 */
export interface LocalModel {
  id: string;
  /** Cómo lo llama LM Studio. Más legible que la clave. */
  displayName: string;
  /** `llm` o `embedding`. Los de embeddings no redactan nada. */
  kind: string;
  /** Si hay una instancia en memoria. */
  loaded: boolean;
  /**
   * Con cuánto contexto está cargado ahora mismo. `null` si no está cargado.
   *
   * No es `maxContextLength`, y la diferencia importa: medido, un modelo con
   * máximo 131072 quedó cargado con 65536. El presupuesto real es éste.
   */
  loadedContextLength: number | null;
  /** Lo que el modelo soporta como techo. No es lo que tiene disponible. */
  maxContextLength: number | null;
  /**
   * Cuánto ocupa. Medido contra la estimación del CLI: `size_bytes` de
   * gemma-4-12b son 7.556.574.286, o sea los mismos 7,04 GiB que declaraba
   * `lms load --estimate-only`. Sirve para declarar el costo sin un proceso
   * aparte.
   */
  sizeBytes: number | null;
  /** `12B`, `26B-A4B`. Tal como lo dice el servidor. */
  params: string | null;
  /** `Q4_K_M`, `Q4_0`. */
  quantization: string | null;
  /**
   * Si el modelo razona antes de contestar, y si se puede apagar.
   *
   * Es la explicación del modo de fallo más caro que se midió: un modelo con
   * razonamiento gasta el presupuesto de tokens pensando y devuelve contenido
   * vacío. Declararlo permite avisar antes en vez de que parezca roto.
   */
  reasoningDefault: string | null;
  reasoningCanBeOff: boolean;
  /**
   * Identificadores de las máquinas donde vive. Vacío es «no se sabe».
   *
   * Con LM Link la inferencia puede correr en otra computadora sin que nada lo
   * diga: `localhost:1234` resuelve contra el equipo enlazado. La cadena vacía
   * dentro de la lista significa **esta máquina**; un identificador, otra. Un
   * modelo puede estar en las dos y entonces lleva las dos — eso explica que el
   * catálogo HTTP lo devuelva repetido.
   *
   * Vacío **no** significa local: no saber no es lo mismo que saber que no.
   */
  devices: string[];
  /**
   * Identificador de la instancia cargada, o `null` si no lo está.
   *
   * `POST /api/v1/models/unload` lo pide, y es lo único con lo que se puede
   * liberar la VRAM. Sin esto, cargar un modelo tras otro los apila: Ale terminó
   * con dos de 7 GB tomados a la vez sin haber pedido ninguno de los dos dos
   * veces.
   */
  loadedInstanceId: string | null;
}

/**
 * Determina si un modelo local es apto para redactar mensajes de commit.
 *
 * Criterio de inclusión positivo (allowlist): acepta únicamente modelos de tipo `'llm'`.
 * Los modelos de embeddings (`'embedding'`) y cualquier tipo no reconocido o futuro quedan
 * excluidos por omisión.
 */
export function isDraftableModel(model: LocalModel): boolean {
  return model.kind === 'llm';
}

/**
 * Filtra la lista de modelos locales conservando únicamente los aptos para redacción.
 */
export function filterDraftableModels(models: LocalModel[]): LocalModel[] {
  return models.filter(isDraftableModel);
}

/** Lo que devuelve cargar un modelo. */
export interface LoadOutcome {
  model: string;
  contextLength: number | null;
  loadTimeSeconds: number | null;
}

/**
 * Resultado de pedirle un asunto al modelo.
 *
 * `no-answer` existe aparte de un mensaje vacío porque es lo que efectivamente
 * pasa: los modelos con razonamiento se comen el presupuesto de tokens pensando
 * y devuelven `finish_reason: 'length'` con el contenido en blanco. Medido:
 * qwen3.5-9b hizo eso en los tres commits de la prueba con techo 3.000, y recién
 * contestó con 8.000. Mostrarlo como «el modelo devolvió un mensaje vacío» haría
 * pensar que la función está rota cuando lo que falta es presupuesto.
 */
/**
 * Contestó, pero sin la forma pedida.
 *
 * Es distinto de «no contestó»: hay texto, y puede ser una buena descripción a
 * la que sólo le falta el prefijo convencional. No se impone en el campo —eso
 * obligaría a corregirlo a mano— pero se muestra, porque tirarlo y decir que no
 * contestó es mentir sobre lo que pasó.
 */
export type CommitDraftResult =
  | { status: 'drafted'; subject: string; model: string }
  | { status: 'no-answer'; reason: 'budget' | 'empty'; model: string }
  | { status: 'malformed'; subject: string; model: string }
  | { status: 'unavailable'; detail: string };

/**
 * Un pedazo de lo que el modelo va produciendo, mientras lo produce.
 *
 * Vive acá y no junto al lector de SSE porque **cruza el IPC**: lo produce el
 * proceso principal y lo consume el panel. Un tipo compartido tiene que estar
 * donde los dos lados lo puedan importar sin que el renderer alcance nada de
 * `electron/`.
 */
export type DraftChunk =
  /** El modelo razonando. Medido: 278 de 308 cuadros. Es la mayor parte. */
  | { kind: 'reasoning'; text: string }
  /** La respuesta propiamente dicha. */
  | { kind: 'content'; text: string }
  /** El cierre, con el motivo y —si vino— el conteo de tokens. */
  | { kind: 'done'; finishReason: string | null; usage: DraftUsage | null }
  /**
   * El servidor falló a mitad del stream.
   *
   * Existe porque el fallo no siempre llega por el código HTTP: la petición ya
   * contestó 200 con `text/event-stream` y el error viene adentro. Sin este
   * tipo, el stream terminaba sin contenido y se reportaba como «el modelo no
   * contestó» —que manda a probar otro modelo cuando el problema es otro—.
   */
  | { kind: 'error'; detail: string };

export interface DraftUsage {
  promptTokens: number | null;
  /** Tokens de la entrada que el servidor encontró ya en su caché. */
  cachedPromptTokens: number | null;
  completionTokens: number | null;
  /** Cuántos se fueron en pensar. Es el número que explica las esperas largas. */
  reasoningTokens: number | null;
}

/** Lo que viaja en `commit-ai:chunk`. */
export interface DraftChunkEvent {
  /**
   * Cuál redacción lo produjo. `null` si quien pidió no declaró ninguna.
   *
   * Sin esto, cancelar y volver a redactar mezcla el pensamiento de la corrida
   * muerta con el de la nueva en el mismo panel.
   */
  draftId: string | null;
  chunks: DraftChunk[];
}

export type DraftStatus = 'queued' | 'running' | 'completed' | 'cancelled';

/** Lo que viaja en `commit-ai:draft-state`. */
export interface DraftStateEvent {
  draftId: string;
  repoPath: string;
  status: DraftStatus;
  /** Si está en fila, qué repositorio está corriendo actualmente. */
  activeRepoPath?: string | null;
  /** Momento en que la redacción empezó a correr (ms de época). */
  startedAt?: number;
  /** Momento en que la redacción terminó (ms de época). */
  finishedAt?: number;
}

/**
 * Modelo resuelto según la configuración de gitcron.json para redacción de commits.
 * Sin secretos (D6, D13).
 */
export interface CommitAiResolvedModel {
  status?: 'resolved';
  providerName: string;
  modelId: string;
  kind: 'openai-compatible' | 'cli';
  destination: 'this-machine' | 'own-server' | 'external-service';
  sourceFile: string;
  available?: boolean;
  unavailableReason?: string;
}

/**
 * Error al resolver el modelo de gitcron.json (archivo roto, sintaxis, etc.).
 */
export interface CommitAiResolvedError {
  status?: 'error';
  error: string;
  sourceFile?: string;
}

/**
 * Los tres casos de resolución según gitcron.json:
 * - Sin configurar: `null` (archivo ausente o sin agent['gitcron-commit'].model).
 * - Resuelto: CommitAiResolvedModel.
 * - Error: CommitAiResolvedError (archivo roto, error de sintaxis, etc.).
 */
export type CommitAiResolvedResult =
  | CommitAiResolvedModel
  | CommitAiResolvedError
  | null;

/**
 * Procedencia de un parámetro del pedido efectivo (D14).
 */
export interface ParameterProvenance {
  value: unknown;
  provenance: string;
}

/**
 * Nombre y procedencia de una cabecera enviada al proveedor (sin el valor).
 */
export interface HeaderProvenance {
  name: string;
  provenance: string;
}

/**
 * Último pedido efectivo del uso gitcron-commit guardado en memoria (D14).
 * Nunca contiene claves, valores de cabeceras secretas, ni el prompt o el diff.
 */
export interface CommitAiLastRequest {
  kind: 'openai-compatible' | 'cli';
  endpoint: string;
  model: {
    value: string;
    provenance: string;
  };
  parameters: Record<string, ParameterProvenance>;
  headers: HeaderProvenance[];
  auth?: string;
  timestamp: number;
}
