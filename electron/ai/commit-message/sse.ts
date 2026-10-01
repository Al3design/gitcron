// electron/ai/commit-message/sse.ts
//
// Lectura del stream de la redacción.
//
// Medido contra LM Studio: una redacción corta produjo **308 cuadros en 6,9
// segundos** —unos 45 por segundo—, de los cuales **278 eran razonamiento** y 28
// contenido. O sea que lo que se ve pensar al modelo es la mayor parte del
// stream, y es justamente lo que Ale quiere ver.
//
// Esos 45 cuadros por segundo son el dato que manda el diseño: cruzarlos de a
// uno por IPC sería el mismo error que ya trabó la máquina con un temporizador
// de 2,8 segundos. Quien consuma esto agrupa antes de mandar.
//
// Puro y aparte para poder probarlo con cuadros grabados, sin servidor.

// La forma de un pedazo vive en `types/`, no acá: cruza el IPC hasta el panel, y
// el renderer no puede importar nada de `electron/`. Se re-exporta para que
// quien ya la pedía a este módulo la siga encontrando en el mismo lugar.
export type { DraftChunk, DraftUsage } from '../../../types/commit-message-ai';

import type { DraftChunk } from '../../../types/commit-message-ai';

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Lee un cuadro del stream. Devuelve `null` si no aporta nada.
 *
 * El razonamiento llega en `reasoning_content` o `reasoning` según el modelo, y
 * se aceptan los dos: cuál manda cada uno no es algo que se pueda fijar acá.
 *
 * El cuadro de `usage` viene con `choices: []`, así que hay que mirarlo antes de
 * dar por sentado que hay un `choices[0]`.
 */
export function parseChatChunk(payload: unknown): DraftChunk | null {
  const frame = payload as {
    choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: unknown }>;
    usage?: {
      prompt_tokens?: unknown;
      prompt_tokens_details?: { cached_tokens?: unknown };
      completion_tokens?: unknown;
      completion_tokens_details?: { reasoning_tokens?: unknown };
    };
    error?: { message?: unknown };
  };

  // Un error DENTRO del stream. La petición ya contestó 200 y `text/event-stream`,
  // así que el fallo no llega por el código HTTP: llega acá adentro.
  //
  // Sin esto el cuadro se descartaba por no tener `choices`, el stream terminaba
  // sin contenido y se leía como «el modelo no contestó». Medido en la notebook
  // de Ale: la iGPU se cayó con `vk::Device::getFenceStatus: ErrorDeviceLost` y
  // la aplicación dijo «no devolvió un asunto utilizable», que manda a probar
  // otro modelo cuando el problema era la placa.
  const errorMessage = typeof frame?.error?.message === 'string' ? frame.error.message.trim() : '';
  if (errorMessage) return { kind: 'error', detail: errorMessage };

  const usage = frame?.usage
    ? {
      promptTokens: int(frame.usage.prompt_tokens),
      cachedPromptTokens: int(frame.usage.prompt_tokens_details?.cached_tokens),
      completionTokens: int(frame.usage.completion_tokens),
      reasoningTokens: int(frame.usage.completion_tokens_details?.reasoning_tokens),
    }
    : null;

  const choice = Array.isArray(frame?.choices) ? frame.choices[0] : undefined;

  // El cierre: llega con `finish_reason`, o en el cuadro de `usage` que no trae
  // ninguna opción.
  if (choice?.finish_reason || (usage && !choice)) {
    return {
      kind: 'done',
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      usage,
    };
  }

  if (!choice?.delta) return null;
  const reasoning = text(choice.delta.reasoning_content) || text(choice.delta.reasoning);
  if (reasoning) return { kind: 'reasoning', text: reasoning };
  const content = text(choice.delta.content);
  return content ? { kind: 'content', text: content } : null;
}

/**
 * Corta un buffer de SSE en cuadros, devolviendo lo que quedó a medias.
 *
 * Un JSON puede llegar partido entre dos lecturas del socket, así que la cola
 * incompleta vuelve para la próxima vez en lugar de descartarse. Una línea que
 * no se entiende se saltea y se cuenta: una redacción no se pierde entera porque
 * un cuadro viniera mal.
 */
export function readSseFrames(buffer: string): { chunks: DraftChunk[]; rest: string; skipped: number } {
  const lines = buffer.split('\n');
  // La última puede estar incompleta: vuelve al buffer.
  const rest = lines.pop() ?? '';
  const chunks: DraftChunk[] = [];
  let skipped = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (data.length === 0 || data === '[DONE]') continue;
    try {
      const chunk = parseChatChunk(JSON.parse(data));
      if (chunk) chunks.push(chunk);
    } catch {
      skipped += 1;
    }
  }
  return { chunks, rest, skipped };
}

/**
 * Junta los pedazos consecutivos del mismo tipo.
 *
 * A 45 cuadros por segundo, mandar cada uno por IPC repetiría el error que ya
 * costó caro: un `setState` por cuadro re-renderiza el panel decenas de veces
 * por segundo. Concatenar los contiguos deja el mismo texto en una fracción de
 * los mensajes.
 */
export function mergeConsecutive(chunks: DraftChunk[]): DraftChunk[] {
  const merged: DraftChunk[] = [];
  for (const chunk of chunks) {
    const last = merged[merged.length - 1];
    // Sólo se junta lo que ES texto corrido. El cierre y el error son eventos:
    // concatenar dos errores en uno perdería el primero, y son justo lo que hay
    // que poder leer entero.
    const juntable = (chunk.kind === 'reasoning' || chunk.kind === 'content')
      && last?.kind === chunk.kind;
    if (juntable && (last.kind === 'reasoning' || last.kind === 'content')) {
      merged[merged.length - 1] = { kind: chunk.kind, text: last.text + chunk.text };
      continue;
    }
    merged.push(chunk);
  }
  return merged;
}
