// electron/ai/anthropic-client.ts
//
// La excepción de D6: un proveedor con `npm` `@ai-sdk/anthropic` habla la API de
// mensajes de Anthropic (`POST {baseURL}/messages`, clave en `x-api-key`, versión en
// `anthropic-version`), que no es el estándar de OpenAI. Antes vivía dentro del
// adaptador del Agente Temporal; ahora lo usa cualquier uso que lo elija en
// gitcron.json. La clave nunca se registra ni aparece en un error.

import { combineSignals } from './text-client';

export interface AnthropicRequest {
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
  providerLabel: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  options?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export interface AnthropicResult {
  text: string;
  finishReason: string | null;
  usage: { promptTokens: number | null; cachedPromptTokens: number | null; completionTokens: number | null; reasoningTokens: null } | null;
}

export function anthropicMessagesEndpoint(baseURL: string): string {
  const clean = baseURL.trim().replace(/\/+$/, '');
  if (clean.endsWith('/messages')) return clean;
  return clean.endsWith('/v1') ? `${clean}/messages` : `${clean}/v1/messages`;
}

/** El cuerpo que viaja: los parámetros abiertos del archivo van, los propios del pedido no se pisan. */
export function buildAnthropicBody(req: AnthropicRequest): Record<string, unknown> {
  const extra = { ...(req.options ?? {}) };
  for (const key of ['model', 'messages', 'system', 'stream']) delete extra[key];
  return {
    max_tokens: req.maxTokens,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...extra,
    model: req.model,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function completeAnthropic(req: AnthropicRequest): Promise<AnthropicResult> {
  const timeoutMs = req.timeoutMs ?? 120_000;
  const fetchFn = req.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(anthropicMessagesEndpoint(req.baseURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...(req.headers ?? {}),
        ...(req.apiKey ? { 'x-api-key': req.apiKey } : {}),
      },
      body: JSON.stringify(buildAnthropicBody(req)),
      signal: combineSignals(timeoutMs, req.signal),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      if (req.signal?.aborted) throw new Error(`${req.providerLabel}: operación cancelada por el usuario.`);
      throw new Error(`${req.providerLabel}: la petición tardó demasiado (${Math.round(timeoutMs / 1000)}s) y se canceló.`);
    }
    throw new Error(`${req.providerLabel} no disponible (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!res.ok) {
    // Nunca el cuerpo crudo: el estado alcanza.
    throw new Error(`${req.providerLabel} respondió ${res.status}.`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: unknown;
    usage?: Record<string, unknown>;
  };
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim();
  const u = data.usage;
  const cached = num(u?.cache_read_input_tokens);
  const input = [num(u?.input_tokens), num(u?.cache_creation_input_tokens), cached];
  return {
    text,
    finishReason: typeof data.stop_reason === 'string' ? data.stop_reason : null,
    usage: u
      ? {
          promptTokens: input.every((v) => v === null) ? null : input.reduce<number>((a, v) => a + (v ?? 0), 0),
          cachedPromptTokens: cached,
          completionTokens: num(u.output_tokens),
          reasoningTokens: null,
        }
      : null,
  };
}
