import { describe, expect, it } from 'vitest';
import { mergeConsecutive, parseChatChunk, readSseFrames } from '../ai/commit-message/sse';

/**
 * La lectura del stream de la redacción.
 *
 * Los cuadros de estas tablas tienen la forma real de LM Studio, capturada
 * midiendo una redacción: 308 cuadros en 6,9 segundos, 278 de razonamiento y 28
 * de contenido, más un cuadro final de `usage` con `choices` vacío.
 */

const cuadroRazonamiento = {
  choices: [{ index: 0, delta: { reasoning_content: 'a ver, el diff toca...' } }],
};
const cuadroContenido = { choices: [{ index: 0, delta: { content: 'feat(pipeline):' } }] };
const cuadroCierre = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
const cuadroUsage = {
  choices: [],
  usage: {
    prompt_tokens: 28,
    completion_tokens: 311,
    completion_tokens_details: { reasoning_tokens: 278 },
  },
};

describe('un error adentro del stream', () => {
  it('se reconoce en vez de descartarse', () => {
    // La petición ya contestó 200 con `text/event-stream`: el fallo NO llega por
    // el código HTTP, llega acá adentro. Medido en la notebook de Ale, la iGPU se
    // cayó así. Sin reconocerlo, el cuadro se descartaba por no tener `choices`,
    // el stream terminaba vacío y se reportaba «el modelo no contestó», que manda
    // a probar otro modelo cuando el problema era la placa.
    const cuadroError = {
      error: { message: 'decode() failed: vk::Device::getFenceStatus: ErrorDeviceLost', type: 'server_error' },
    };

    expect(parseChatChunk(cuadroError)).toEqual({
      kind: 'error',
      detail: 'decode() failed: vk::Device::getFenceStatus: ErrorDeviceLost',
    });
  });

  it('dos errores no se funden en uno', () => {
    const uno = { kind: 'error', detail: 'primero' } as const;
    const dos = { kind: 'error', detail: 'segundo' } as const;

    // El cierre y el error son eventos, no texto corrido: juntarlos perdería el
    // primero, y son justo lo que hay que poder leer entero.
    expect(mergeConsecutive([uno, dos])).toEqual([uno, dos]);
  });
});

describe('un cuadro suelto', () => {
  it('distingue el razonamiento del contenido', () => {
    expect(parseChatChunk(cuadroRazonamiento)).toEqual({ kind: 'reasoning', text: 'a ver, el diff toca...' });
    expect(parseChatChunk(cuadroContenido)).toEqual({ kind: 'content', text: 'feat(pipeline):' });
  });

  it('acepta las dos formas de nombrar el razonamiento', () => {
    // Cuál manda depende del modelo, y no es algo que se pueda fijar acá.
    expect(parseChatChunk({ choices: [{ delta: { reasoning: 'pensando' } }] }))
      .toEqual({ kind: 'reasoning', text: 'pensando' });
  });

  it('el cierre trae el motivo', () => {
    expect(parseChatChunk(cuadroCierre)).toEqual({ kind: 'done', finishReason: 'stop', usage: null });
  });

  it('el cuadro de usage llega sin ninguna opción y no rompe (sin caché)', () => {
    // Viene con `choices: []`: mirar `choices[0]` a ciegas explotaría justo en el
    // cuadro que trae los números.
    expect(parseChatChunk(cuadroUsage)).toEqual({
      kind: 'done',
      finishReason: null,
      usage: { promptTokens: 28, cachedPromptTokens: null, completionTokens: 311, reasoningTokens: 278 },
    });
  });

  it('el cuadro de usage lee prompt_tokens_details.cached_tokens si está presente', () => {
    const cuadroUsageCached = {
      choices: [],
      usage: {
        prompt_tokens: 20847,
        prompt_tokens_details: { cached_tokens: 8960 },
        completion_tokens: 7,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    };
    expect(parseChatChunk(cuadroUsageCached)).toEqual({
      kind: 'done',
      finishReason: null,
      usage: {
        promptTokens: 20847,
        cachedPromptTokens: 8960,
        completionTokens: 7,
        reasoningTokens: 0,
      },
    });
  });

  it('un cuadro sin nada útil no aporta', () => {
    expect(parseChatChunk({ choices: [{ delta: { role: 'assistant' } }] })).toBeNull();
    expect(parseChatChunk({})).toBeNull();
    expect(parseChatChunk(null)).toBeNull();
  });
});

describe('el corte del buffer', () => {
  it('lee los cuadros completos y devuelve la cola a medias', () => {
    // Un JSON puede llegar partido entre dos lecturas del socket: descartarlo
    // perdería texto en silencio.
    const buffer = `data: ${JSON.stringify(cuadroContenido)}\ndata: {"choices":[{"delta":{"cont`;
    const leido = readSseFrames(buffer);

    expect(leido.chunks).toEqual([{ kind: 'content', text: 'feat(pipeline):' }]);
    expect(leido.rest).toBe('data: {"choices":[{"delta":{"cont');
  });

  it('saltea lo ilegible y lo cuenta, en vez de perder la redacción entera', () => {
    const buffer = 'data: {esto no es json}\ndata: ' + JSON.stringify(cuadroContenido) + '\n';
    const leido = readSseFrames(buffer);

    expect(leido.skipped).toBe(1);
    expect(leido.chunks).toHaveLength(1);
  });

  it('ignora el marcador de fin y las líneas que no son datos', () => {
    const leido = readSseFrames('data: [DONE]\n\n: comentario\n');
    expect(leido.chunks).toEqual([]);
    expect(leido.skipped).toBe(0);
  });
});

describe('el agrupado', () => {
  it('junta los contiguos del mismo tipo', () => {
    // A 45 cuadros por segundo, mandar cada uno por IPC repetiría el error que ya
    // costó caro: un `setState` por cuadro re-renderiza el panel decenas de
    // veces por segundo.
    const juntados = mergeConsecutive([
      { kind: 'reasoning', text: 'a ver' },
      { kind: 'reasoning', text: ', el diff' },
      { kind: 'content', text: 'feat' },
      { kind: 'content', text: '(pipeline):' },
    ]);

    expect(juntados).toEqual([
      { kind: 'reasoning', text: 'a ver, el diff' },
      { kind: 'content', text: 'feat(pipeline):' },
    ]);
  });

  it('no junta a través de un cambio de tipo', () => {
    const juntados = mergeConsecutive([
      { kind: 'reasoning', text: 'pensando' },
      { kind: 'content', text: 'listo' },
      { kind: 'reasoning', text: 'otra vez' },
    ]);
    expect(juntados).toHaveLength(3);
  });

  it('el cierre nunca se funde con nada', () => {
    const juntados = mergeConsecutive([
      { kind: 'done', finishReason: 'stop', usage: null },
      { kind: 'done', finishReason: null, usage: { promptTokens: 1, cachedPromptTokens: null, completionTokens: 2, reasoningTokens: 3 } },
    ]);
    expect(juntados).toHaveLength(2);
  });
});
