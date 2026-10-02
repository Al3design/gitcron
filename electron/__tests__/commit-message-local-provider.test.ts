import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatEndpoint,
  fetchModelCatalog,
  loadLocalModel,
  modelsEndpoint,
  normalizeSubject,
  parseDraftResponse,
  parseModelCatalog,
  serverErrorMessage,
} from '../ai/commit-message/local-provider';
import { filterDraftableModels, isDraftableModel, type CommitDraftResult, type DraftChunk, type LocalModel } from '../../types/commit-message-ai';
import { streamText } from '../ai/text-client';

/**
 * La redacción por el estándar, como la corre `commit-ai:draft` desde la tarea 4.3:
 * `streamText` con el proveedor de gitcron.json y `parseDraftResponse` sobre lo
 * acumulado. Antes era `draftCommitSubject`, atado a la dirección fija de LM Studio.
 */
async function draftCommitSubject(request: {
  baseUrl?: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  onChunk?: (chunks: DraftChunk[]) => void;
}): Promise<CommitDraftResult> {
  const { baseUrl = 'http://localhost:1234', ...opts } = request;
  try {
    const result = await streamText(
      { baseUrl, providerLabel: 'El servidor local', friendlyConnError: `LM Studio no responde en ${baseUrl}.` },
      opts,
    );
    return parseDraftResponse(result.rawPayload, request.model);
  } catch (error) {
    return { status: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * El proveedor local que redacta el asunto de un commit.
 *
 * Las tres formas que hay que distinguir salieron de medir contra LM Studio, no
 * de imaginarlas: un asunto, «no contestó» —contenido vacío porque el
 * razonamiento agotó el presupuesto— y el servidor caído. La del medio es la que
 * más importa: mostrarla como «devolvió un mensaje vacío» haría pensar que la
 * función está rota cuando lo que falta es techo de tokens.
 */

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function respondWith(payload: unknown, ok = true, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  }) as unknown as typeof fetch;
}

describe('los endpoints', () => {
  it('usa la API nativa para el catálogo, no la compatible con OpenAI', () => {
    // `/v1/models` sólo devuelve identificadores; el estado, los contextos y el
    // contexto están únicamente en `/api/v0/models`.
    expect(modelsEndpoint('http://localhost:1234')).toBe('http://localhost:1234/api/v1/models');
    expect(chatEndpoint('http://localhost:1234')).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('tolera una barra final en el endpoint configurado', () => {
    expect(modelsEndpoint('http://192.168.0.20:1234/')).toBe('http://192.168.0.20:1234/api/v1/models');
  });
});

/** Forma real de `/api/v1/models`, recortada de la respuesta del servidor. */
const CATALOGO_REAL = {
  models: [
    {
      type: 'llm',
      key: 'google/gemma-4-12b',
      display_name: 'Gemma 4 12B',
      quantization: { name: 'Q4_K_M', bits_per_weight: 4 },
      size_bytes: 7556574286,
      params_string: '12B',
      loaded_instances: [{ id: 'google/gemma-4-12b', config: { context_length: 65536 } }],
      max_context_length: 131072,
      capabilities: { vision: true, trained_for_tool_use: true, reasoning: { allowed_options: ['off', 'on'], default: 'on' } },
    },
    {
      type: 'llm',
      key: 'ornith-1.0-9b',
      display_name: 'Ornith 1.0 9B',
      quantization: { name: 'Q4_K_M' },
      size_bytes: 5630000000,
      params_string: '9B',
      loaded_instances: [],
      max_context_length: 262144,
      capabilities: { reasoning: { allowed_options: ['on'], default: 'on' } },
    },
    {
      type: 'embedding',
      key: 'text-embedding-nomic',
      display_name: 'Nomic Embed',
      loaded_instances: [],
      max_context_length: 2048,
    },
  ],
};

describe('el catálogo', () => {
  it('el contexto real sale de la instancia cargada, no del máximo del modelo', () => {
    // Medido: un modelo con máximo 131072 quedó cargado con 65536. El
    // presupuesto real es el de la instancia.
    const [gemma] = parseModelCatalog(CATALOGO_REAL);

    expect(gemma).toEqual({
      id: 'google/gemma-4-12b',
      displayName: 'Gemma 4 12B',
      kind: 'llm',
      loaded: true,
      loadedContextLength: 65536,
      maxContextLength: 131072,
      sizeBytes: 7556574286,
      params: '12B',
      quantization: 'Q4_K_M',
      reasoningDefault: 'on',
      reasoningCanBeOff: true,
      loadedInstanceId: 'google/gemma-4-12b',
      // En qué máquina vive llega por otra vía —el WebSocket del servidor— y no
      // en el catálogo HTTP: acá todavía está vacío.
      devices: [],
    });
  });

  it('en disco no hay contexto: lo decide la carga', () => {
    const ornith = parseModelCatalog(CATALOGO_REAL)[1];
    expect(ornith.loaded).toBe(false);
    expect(ornith.loadedContextLength).toBeNull();
    // Y este no puede apagar el razonamiento, que es lo que explica que gaste
    // el presupuesto pensando.
    expect(ornith.reasoningCanBeOff).toBe(false);
  });

  it('el tamaño sirve para declarar el costo sin un proceso aparte', () => {
    // Medido contra el CLI: `size_bytes` de gemma-4-12b son los mismos 7,04 GiB
    // que estimaba `lms load --estimate-only`.
    const [gemma] = parseModelCatalog(CATALOGO_REAL);
    expect(gemma.sizeBytes! / 1024 ** 3).toBeCloseTo(7.04, 1);
  });

  it('conserva los de embeddings con su tipo, en vez de esconderlos', () => {
    // Para que la vista pueda explicar por qué no sirven.
    expect(parseModelCatalog(CATALOGO_REAL)[2].kind).toBe('embedding');
  });

  it('une el mismo modelo repetido por dispositivo, y gana el cargado', () => {
    // Con LM Link un modelo que está en la notebook y en la PC llega dos veces
    // con la misma clave. Medido: 16 entradas para 14 modelos. Sin unirlos el
    // desplegable los muestra dos veces y React protesta por claves duplicadas.
    const models = parseModelCatalog({
      models: [
        { type: 'llm', key: 'repetido', display_name: 'R', loaded_instances: [], max_context_length: 4096 },
        {
          type: 'llm', key: 'repetido', display_name: 'R', max_context_length: 4096,
          loaded_instances: [{ id: 'repetido', config: { context_length: 32768 } }],
        },
        { type: 'llm', key: 'otro', display_name: 'O', loaded_instances: [], max_context_length: 4096 },
      ],
    });

    expect(models).toHaveLength(2);
    // Elegir la copia en disco mostraría «en disco» sobre un modelo disponible.
    expect(models[0]).toMatchObject({ id: 'repetido', loaded: true, loadedContextLength: 32768 });
  });

  it('el orden de las copias no cambia el resultado', () => {
    const alReves = parseModelCatalog({
      models: [
        {
          type: 'llm', key: 'repetido', display_name: 'R', max_context_length: 4096,
          loaded_instances: [{ id: 'repetido', config: { context_length: 32768 } }],
        },
        { type: 'llm', key: 'repetido', display_name: 'R', loaded_instances: [], max_context_length: 4096 },
      ],
    });
    expect(alReves).toHaveLength(1);
    expect(alReves[0].loaded).toBe(true);
  });

  it('descarta lo que no tiene clave y sobrevive a una forma inesperada', () => {
    expect(parseModelCatalog({ models: [{ type: 'llm' }, { key: '   ' }] })).toEqual([]);
    // La forma vieja de `/api/v0/models` ya no se entiende, y eso es correcto:
    // devolver algo a medias sería peor que devolver nada.
    expect(parseModelCatalog({ data: [{ id: 'x' }] })).toEqual([]);
    expect(parseModelCatalog(null)).toEqual([]);
  });
});

describe('la carga', () => {
  it('pide que el servidor lo desaloje solo tras un rato sin uso', async () => {
    // Mejor que descargarlo al terminar cada redacción: dos mensajes seguidos
    // reusan el modelo y no pagan los 11 segundos de recarga, y si no se usa más
    // la VRAM se libera sin que nadie haga nada.
    respondWith({ instance_id: 'm', load_time_seconds: 9 });
    await loadLocalModel('http://localhost:1234', 'm', 65536);

    const body = JSON.parse((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // El nombre está comprobado contra el servidor: `ttl` y `unload_after` los
    // rechaza por nombre, `ttl_seconds` no.
    expect(body.ttl_seconds).toBe(1800);
    expect(body.context_length).toBe(65536);
  });

  it('un rechazo del servidor se lee sin el JSON alrededor', async () => {
    respondWith('{"error":{"message":"LM Link connection closed"}}', false, 400);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"LM Link connection closed"}}',
    }) as unknown as typeof fetch;

    await expect(loadLocalModel('http://localhost:1234', 'm', 65536))
      .rejects.toThrow('LM Link connection closed');
  });
});

/** Sirve una respuesta como stream de SSE, con la forma real del servidor. */
function respondWithStream(frames: unknown[]) {
  const cuerpo = frames.map((f) => `data: ${JSON.stringify(f)}\n`).join('') + 'data: [DONE]\n';
  const bytes = new TextEncoder().encode(cuerpo);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => {
        let entregado = false;
        return {
          read: async () => (entregado
            ? { done: true, value: undefined }
            : ((entregado = true), { done: false, value: bytes })),
        };
      },
    },
  }) as unknown as typeof fetch;
}

describe('transmitir no cambia el resultado', () => {
  const CUADROS = [
    { choices: [{ delta: { reasoning_content: 'a ver, el diff toca el panel' } }] },
    { choices: [{ delta: { content: 'feat(pipeline): ' } }] },
    { choices: [{ delta: { content: 'mostrar el log del modelo' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ];

  it('el mismo contenido servido en pedazos da el mismo asunto', async () => {
    // Es el contrato que sostiene todo: `parseDraftResponse` no se tocó, así que
    // la taxonomía de «no contestó» sigue valiendo igual con stream que sin él.
    respondWithStream(CUADROS);
    const result = await draftCommitSubject({
      baseUrl: 'http://localhost:1234', model: 'm', system: 's', user: 'u', maxTokens: 3000,
    });

    expect(result).toEqual({
      status: 'drafted',
      subject: 'feat(pipeline): mostrar el log del modelo',
      model: 'm',
    });
  });

  it('avisa lo que va llegando, ya agrupado por tipo', async () => {
    // Agrupado y no de a uno: medido, son unos 45 cuadros por segundo, y un
    // aviso por cuadro es el error que ya trabó la máquina.
    respondWithStream(CUADROS);
    const recibido: unknown[] = [];
    await draftCommitSubject({
      baseUrl: 'http://localhost:1234', model: 'm', system: 's', user: 'u', maxTokens: 3000,
      onChunk: (chunks) => recibido.push(...chunks),
    });

    expect(recibido).toEqual([
      { kind: 'reasoning', text: 'a ver, el diff toca el panel' },
      { kind: 'content', text: 'feat(pipeline): mostrar el log del modelo' },
      { kind: 'done', finishReason: 'stop', usage: null },
    ]);
  });

  it('el razonamiento que se come el presupuesto sigue siendo «no contestó»', async () => {
    respondWithStream([
      { choices: [{ delta: { reasoning_content: 'pensando y pensando' } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
    ]);
    const result = await draftCommitSubject({
      baseUrl: 'http://localhost:1234', model: 'qwen', system: 's', user: 'u', maxTokens: 3000,
    });

    expect(result).toEqual({ status: 'no-answer', reason: 'budget', model: 'qwen' });
  });

  it('un servidor que no transmite se lee como respuesta única', async () => {
    // Una versión vieja, o un proxy en el medio: no puede romper la redacción.
    respondWith({ choices: [{ message: { content: 'chore: algo' }, finish_reason: 'stop' }] });
    const result = await draftCommitSubject({
      baseUrl: 'http://localhost:1234', model: 'm', system: 's', user: 'u', maxTokens: 3000,
    });
    expect(result).toMatchObject({ status: 'drafted', subject: 'chore: algo' });
  });
});

describe('los techos de tiempo', () => {
  it('toda petición lleva señal: sin techo, un servidor colgado espera para siempre', async () => {
    // `LOCAL_TIMEOUT_MS` estaba declarado con su justificación medida y no se
    // usaba en ninguna parte. Peor: el mensaje de error hablaba de un timeout
    // que no existía.
    respondWith({ models: [] });
    await fetchModelCatalog('http://localhost:1234');
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].signal)
      .toBeInstanceOf(AbortSignal);
  });

  it('la carga acepta la cancelación de quien llama', async () => {
    // Era literalmente incancelable: el botón aparecía durante los 11 segundos
    // y no cortaba nada.
    respondWith({ instance_id: 'm', load_time_seconds: 9 });
    const propia = new AbortController();
    await loadLocalModel('http://localhost:1234', 'm', 65536, 1800, propia.signal);

    const enviada = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].signal;
    expect(enviada).toBeInstanceOf(AbortSignal);
    propia.abort();
    expect(enviada.aborted).toBe(true);
  });
});

describe('la instancia cargada', () => {
  it('se transporta para poder descargarla', () => {
    // Sin esto, cargar un modelo tras otro los apila: Ale terminó con dos de
    // 7 GB tomados a la vez sin haber pedido ninguno dos veces.
    const [gemma, ornith] = parseModelCatalog(CATALOGO_REAL);
    expect(gemma.loadedInstanceId).toBe('google/gemma-4-12b');
    // En disco no hay instancia que descargar.
    expect(ornith.loadedInstanceId).toBeNull();
  });
});

describe('el motivo que da el servidor', () => {
  it('se queda con el mensaje, sin el JSON alrededor', () => {
    // Volcarlo crudo puso llaves y comillas en el aviso de la pantalla.
    expect(serverErrorMessage(
      '{"error":{"type":"model_load_failed","message":"Failed to load LLM: LM Link connection closed"}}',
    )).toBe('Failed to load LLM: LM Link connection closed');
  });

  it('una forma que no se entiende no se inventa', () => {
    // Quien llama pone su propio motivo; inventar uno sería peor.
    expect(serverErrorMessage('no es json')).toBeNull();
    expect(serverErrorMessage('{"error":{}}')).toBeNull();
    expect(serverErrorMessage('')).toBeNull();
  });
});

describe('la respuesta del modelo', () => {
  it('devuelve el asunto cuando contestó', () => {
    const result = parseDraftResponse(
      { choices: [{ message: { content: 'feat(pipeline): atribuir archivos por la rama' }, finish_reason: 'stop' }] },
      'google/gemma-4-12b',
    );
    expect(result).toEqual({
      status: 'drafted',
      subject: 'feat(pipeline): atribuir archivos por la rama',
      model: 'google/gemma-4-12b',
    });
  });

  it('el contenido vacío por presupuesto es «no contestó», no un asunto vacío', () => {
    // Medido: qwen3.5-9b hizo exactamente esto en los tres commits de la prueba
    // con techo 3.000, gastando todo el presupuesto en razonar.
    expect(parseDraftResponse(
      { choices: [{ message: { content: '' }, finish_reason: 'length' }] },
      'qwen/qwen3.5-9b',
    )).toEqual({ status: 'no-answer', reason: 'budget', model: 'qwen/qwen3.5-9b' });
  });

  it('distingue el vacío sin motivo de presupuesto', () => {
    expect(parseDraftResponse(
      { choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] },
      'modelo',
    )).toEqual({ status: 'no-answer', reason: 'empty', model: 'modelo' });
  });

  it('una respuesta sin opciones no se lee como un asunto', () => {
    expect(parseDraftResponse({}, 'modelo').status).toBe('unavailable');
  });
});

describe('la normalización del mensaje de commit', () => {
  it('conserva asunto y cuerpo con línea en blanco de separación', () => {
    expect(normalizeSubject('feat(x): algo\n\nCuerpo explicativo con detalles.')).toBe('feat(x): algo\n\nCuerpo explicativo con detalles.');
    expect(normalizeSubject('feat(x): algo\nCuerpo sin linea en blanco previa')).toBe('feat(x): algo\n\nCuerpo sin linea en blanco previa');
    expect(normalizeSubject('feat(x): algo\n\n\nCuerpo con múltiples saltos\n\nSegundo párrafo\n\n')).toBe(
      'feat(x): algo\n\nCuerpo con múltiples saltos\n\nSegundo párrafo',
    );
  });

  it('mantiene idéntica una respuesta de una sola línea', () => {
    expect(normalizeSubject('fix(ipc): corregir timeout')).toBe('fix(ipc): corregir timeout');
    expect(normalizeSubject('  chore(deps): actualizar vitest  ')).toBe('chore(deps): actualizar vitest');
  });

  it('descarta cercado de código y conserva el cuerpo interior', () => {
    expect(normalizeSubject('```\nfix(y): corregir el borde\n\nExplicación del fix\n```')).toBe(
      'fix(y): corregir el borde\n\nExplicación del fix',
    );
    expect(normalizeSubject('```markdown\nchore(z): mover cosas\n```')).toBe('chore(z): mover cosas');
  });

  it('sin contenido o sólo con cercados devuelve nulo', () => {
    expect(normalizeSubject('   \n\n  ')).toBeNull();
    expect(normalizeSubject('```\n```')).toBeNull();
    expect(normalizeSubject('""')).toBeNull();
    expect(normalizeSubject('')).toBeNull();
  });

  it('limpia las comillas del asunto sin romper el cuerpo', () => {
    expect(normalizeSubject('"chore(z): mover cosas"\n\nCuerpo del commit')).toBe('chore(z): mover cosas\n\nCuerpo del commit');
    expect(normalizeSubject('\'feat(a): nuevo\'')).toBe('feat(a): nuevo');
    expect(normalizeSubject('`fix(b): detalle`\n\nTexto adicional')).toBe('fix(b): detalle\n\nTexto adicional');
  });
});

describe('la llamada completa', () => {
  it('el servidor caído degrada con un motivo accionable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;
    const result = await draftCommitSubject({ model: 'm', system: 's', user: 'u', maxTokens: 3000 });

    expect(result.status).toBe('unavailable');
    // El motivo nombra qué hacer, no el error crudo de red.
    expect(result).toMatchObject({ detail: expect.stringContaining('LM Studio') });
  });

  it('un estado HTTP de error no se lee como respuesta', async () => {
    respondWith({}, false, 503);
    const result = await draftCommitSubject({ model: 'm', system: 's', user: 'u', maxTokens: 3000 });
    expect(result).toEqual({ status: 'unavailable', detail: 'El servidor local respondió 503.' });
  });

  it('manda el techo de tokens que se le pida, sin constante propia', async () => {
    // No puede ser un número del código: medido, 3.000 alcanza para gemma-4-12b
    // y no para qwen3.5-9b.
    respondWith({ choices: [{ message: { content: 'feat(a): b' }, finish_reason: 'stop' }] });
    await draftCommitSubject({ model: 'm', system: 's', user: 'u', maxTokens: 8000 });

    const body = JSON.parse((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(8000);
    expect(body.model).toBe('m');
  });
});

describe('la elegibilidad de modelos (allowlist)', () => {
  const modelLlm = { id: 'gemma', displayName: 'Gemma', kind: 'llm' } as LocalModel;
  const modelEmbedding = { id: 'nomic', displayName: 'Nomic', kind: 'embedding' } as LocalModel;
  const modelVlm = { id: 'vision', displayName: 'Vision', kind: 'vlm' } as LocalModel;
  const modelUnknown = { id: 'audio', displayName: 'Audio', kind: 'audio' } as LocalModel;

  it('acepta únicamente modelos con kind === "llm"', () => {
    expect(isDraftableModel(modelLlm)).toBe(true);
    expect(isDraftableModel(modelEmbedding)).toBe(false);
    expect(isDraftableModel(modelVlm)).toBe(false);
    expect(isDraftableModel(modelUnknown)).toBe(false);
  });

  it('filterDraftableModels excluye embeddings y tipos desconocidos', () => {
    const list = [modelLlm, modelEmbedding, modelVlm, modelUnknown];
    const filtered = filterDraftableModels(list);
    expect(filtered).toEqual([modelLlm]);
  });
});
