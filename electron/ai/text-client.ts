// electron/ai/text-client.ts
//
// Capa única para llamadas a modelos de texto (Grupo 9b).
//
// ── DISTINCIÓN FUNDAMENTAL DE ARQUITECTURA (Tarea 9b.2) ──
// En GitCron conviven dos familias de integraciones con IA que NO deben mezclarse:
//
// 1. RUNTIMES DE AGENTE (PipelineRuntime / RuntimeSessionHub):
//    Claude Code, Codex, OpenCode, Qwen, y LM Studio runtime (add-lmstudio-agent-runtime).
//    Son bucles interactivos que ejecutan trabajo sobre el repositorio, ejecutan herramientas,
//    inspeccionan el árbol de trabajo y modifican archivos en disco (`launchable: true`,
//    `modifiesRepo: true`). Tienen contrato propio, ciclo de vida de procesos y manejo de sesiones.
//
// 2. LLAMADAS QUE PRODUCEN TEXTO (este módulo):
//    Invocaciones a APIs compatibles con OpenAI para generar texto plano estructurado o semi-estructurado:
//    - Redacción de asuntos y cuerpos de commit (commit-message).
//    - Explicaciones y respuestas sobre el grafo de dependencias (Cartografía: explain, ask, panorama).
//    - Explicación y análisis de cambios entre versiones de OpenSpec (Tarea 9c).
//
// Este módulo unifica las llamadas HTTP de la familia 2 en una sola forma:
// URL base + clave OPCIONAL sobre una API compatible con OpenAI.

import { mergeConsecutive, readSseFrames, type DraftChunk } from './commit-message/sse';

/**
 * Configuración de un proveedor de texto compatible con OpenAI.
 * Cubre cualquier servidor del estándar sin casos especiales. La dirección, la clave
 * y las cabeceras salen del proveedor que el uso elige en gitcron.json (tarea 4.3):
 * acá no hay ningún proveedor fijo.
 */
export interface TextClientConfig {
  /** URL base que antecede a `/chat/completions`: el `options.baseURL` del proveedor de gitcron.json, con o sin `/v1`. */
  baseUrl: string;
  /** Clave de autenticación opcional (Bearer token). Si está ausente, no se envía cabecera de autorización. */
  apiKey?: string;
  /** Cabeceras HTTP adicionales (ej. 'http-referer', 'x-title' para atribución en OpenRouter). */
  headers?: Record<string, string>;
  /** Tiempo límite por omisión para las peticiones en milisegundos. */
  defaultTimeoutMs?: number;
  /** Etiqueta descriptiva para mensajes de error o diagnósticos. */
  providerLabel?: string;
  /** Mensaje amigable cuando la conexión falla (servidor local apagado, host inalcanzable). */
  friendlyConnError?: string;
  /** Para pruebas: el fetch a usar en lugar del global. */
  fetchFn?: typeof fetch;
}

/** Opciones para una generación de texto. */
export interface TextGenerateOptions {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  options?: Record<string, unknown>;
}

/** Opciones para una generación de texto con streaming SSE. */
export interface TextStreamOptions extends TextGenerateOptions {
  /** Callback invocado con los fragmentos recibidos agrupados consecutivamente por tipo. */
  onChunk?: (chunks: DraftChunk[]) => void;
}

/** Resultado estándar de una llamada de texto. */
export interface TextGenerationResult {
  text: string;
  finishReason?: string | null;
  rawPayload?: unknown;
}

/**
 * Normaliza la URL del endpoint de chat completions.
 * Acepta URLs base con o sin `/v1` o barra final.
 */
export function buildChatCompletionsEndpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) {
    return clean;
  }
  if (clean.endsWith('/v1')) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

/**
 * Combina un timeout defensivo con la señal de cancelación del llamador.
 */
export function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Extrae las cabeceras HTTP necesarias para la llamada.
 * Si hay apiKey, se envía como `Authorization: Bearer <key>`.
 * La clave NUNCA se registra en logs ni se incluye en excepciones.
 */
export function buildHeaders(config: TextClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(config.headers ?? {}),
  };

  if (config.apiKey && config.apiKey.trim().length > 0) {
    headers.authorization = `Bearer ${config.apiKey.trim()}`;
  }

  return headers;
}

function buildRequestBody(
  opts: TextGenerateOptions,
  defaults: { temperature: number; maxTokens: number },
  extra?: { stream?: boolean; stream_options?: Record<string, unknown> },
): Record<string, unknown> {
  const safeOptions = { ...(opts.options ?? {}) };
  delete safeOptions.model;
  delete safeOptions.messages;
  delete safeOptions.stream;
  delete safeOptions.stream_options;

  return {
    temperature: opts.temperature ?? defaults.temperature,
    max_tokens: opts.maxTokens ?? defaults.maxTokens,
    ...safeOptions,
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    ...(extra ?? {}),
  };
}

/**
 * El cuerpo exacto que `streamText` manda. Exportado para que quien muestre
 * «lo enviado» use el mismo armado y no una copia de sus valores por omisión.
 */
export function buildStreamRequestBody(opts: TextGenerateOptions): Record<string, unknown> {
  return buildRequestBody(
    opts,
    { temperature: 0.2, maxTokens: 2048 },
    { stream: true, stream_options: { include_usage: true } },
  );
}

/**
 * El cuerpo exacto que `completeText` manda. `stream: false` va siempre explícito
 * (D11b): Unsloth contesta en eventos si el pedido omite `stream` (issue 5047 de
 * unslothai/unsloth), al revés del estándar, y la respuesta dejaría de ser un JSON.
 */
export function buildCompleteRequestBody(opts: TextGenerateOptions): Record<string, unknown> {
  return buildRequestBody(opts, { temperature: 0.4, maxTokens: 1024 }, { stream: false });
}

/**
 * Genera texto en una sola respuesta (modo síncrono / no streaming).
 */
export async function completeText(
  config: TextClientConfig,
  opts: TextGenerateOptions,
): Promise<TextGenerationResult> {
  const endpoint = buildChatCompletionsEndpoint(config.baseUrl);
  const timeoutMs = opts.timeoutMs ?? config.defaultTimeoutMs ?? 60_000;
  const signal = combineSignals(timeoutMs, opts.signal);
  const providerLabel = config.providerLabel ?? 'Servicio de IA';

  let res: Response;
  try {
    res = await (config.fetchFn ?? fetch)(endpoint, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(buildCompleteRequestBody(opts)),
      signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      if (opts.signal?.aborted) {
        throw new Error(`${providerLabel}: operación cancelada por el usuario.`);
      }
      throw new Error(`${providerLabel}: la petición tardó demasiado (${Math.round(timeoutMs / 1000)}s) y se canceló.`);
    }
    if (/tardó demasiado|cancelad/i.test(msg)) throw err;
    if (/fetch failed|ECONNREFUSED|getaddrinfo|ENOTFOUND/i.test(msg)) {
      throw new Error(
        config.friendlyConnError ?? `${providerLabel} no disponible. Verificá tu conexión o que el servidor esté activo.`,
      );
    }
    throw err;
  }

  if (!res.ok) {
    // Seguridad: jamás volcar el cuerpo crudo que podría contener tokens o rutas
    throw new Error(`${providerLabel} respondió ${res.status}.`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  };

  const choice = data.choices?.[0];
  const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;

  return { text, finishReason, rawPayload: data };
}

/**
 * Genera texto con soporte de streaming SSE.
 * Si el servidor responde con `text/event-stream`, acumula y emite los pedazos vía `onChunk`.
 * Si el servidor responde con JSON estándar (sin stream), degrada limpiamente a respuesta única.
 */
export async function streamText(
  config: TextClientConfig,
  opts: TextStreamOptions,
): Promise<TextGenerationResult> {
  const endpoint = buildChatCompletionsEndpoint(config.baseUrl);
  const timeoutMs = opts.timeoutMs ?? config.defaultTimeoutMs ?? 300_000;
  const signal = combineSignals(timeoutMs, opts.signal);
  const providerLabel = config.providerLabel ?? 'Servicio de IA';

  let res: Response;
  try {
    res = await (config.fetchFn ?? fetch)(endpoint, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(buildStreamRequestBody(opts)),
      signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      if (opts.signal?.aborted) {
        throw new Error(`${providerLabel}: operación cancelada por el usuario.`);
      }
      throw new Error(`${providerLabel}: la petición tardó demasiado (${Math.round(timeoutMs / 1000)}s) y se canceló.`);
    }
    if (/tardó demasiado|cancelad/i.test(msg)) throw err;
    if (/fetch failed|ECONNREFUSED|getaddrinfo|ENOTFOUND/i.test(msg)) {
      throw new Error(
        config.friendlyConnError ?? `${providerLabel} no disponible. Verificá tu conexión o que el servidor esté activo.`,
      );
    }
    throw err;
  }

  if (!res.ok) {
    throw new Error(`${providerLabel} respondió ${res.status}.`);
  }

  const isStream = (res.headers?.get('content-type') ?? '').includes('text/event-stream');
  if (!isStream || !res.body) {
    // Si no es stream, leemos como respuesta única
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
    };
    const choice = data.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    return { text, finishReason, rawPayload: data };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedText = '';
  let finishReason: string | null = null;
  let streamError: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { chunks, rest } = readSseFrames(buffer);
    buffer = rest;

    const merged = mergeConsecutive(chunks);
    for (const chunk of merged) {
      if (chunk.kind === 'content') accumulatedText += chunk.text;
      if (chunk.kind === 'done' && chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.kind === 'error') streamError = chunk.detail;
    }

    if (merged.length > 0 && opts.onChunk) {
      opts.onChunk(merged);
    }

    if (streamError) break;
  }

  if (streamError) {
    throw new Error(`${providerLabel}: ${streamError}`);
  }

  return {
    text: accumulatedText.trim(),
    finishReason,
    rawPayload: {
      choices: [{ message: { content: accumulatedText }, finish_reason: finishReason }],
    },
  };
}
