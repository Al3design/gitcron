import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildChatCompletionsEndpoint,
  buildHeaders,
  completeText,
  streamText,
  type TextClientConfig,
} from '../ai/text-client';

// Desde la tarea 4.3 el cliente no trae proveedores armados: la dirección, la clave
// y las cabeceras salen del proveedor de gitcron.json. Estas son las formas que la
// resolución le pasa para los tres casos de siempre.
const lmStudio = (extra: Partial<TextClientConfig> = {}): TextClientConfig => ({
  baseUrl: 'http://localhost:1234/v1',
  providerLabel: 'LM Studio',
  ...extra,
});
const openRouter = (apiKey: string): TextClientConfig => ({
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey,
  providerLabel: 'OpenRouter',
  headers: { 'HTTP-Referer': 'https://github.com/Al3design/gitcron', 'X-Title': 'GitCron' },
  friendlyConnError: 'OpenRouter no responde en https://openrouter.ai/api/v1.',
});
const unsloth = (o: { apiKey: string; id: string; secret: string }): TextClientConfig => ({
  baseUrl: 'https://llm.aledesign.dev/v1',
  apiKey: o.apiKey,
  providerLabel: 'Unsloth CASA',
  headers: { 'CF-Access-Client-Id': o.id, 'CF-Access-Client-Secret': o.secret },
  friendlyConnError: 'Unsloth CASA no responde en https://llm.aledesign.dev/v1.',
});

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('Cliente unificado de texto (Grupo 9b)', () => {
  describe('normalización de endpoints', () => {
    it('agrega /chat/completions a una base que termina en /v1', () => {
      expect(buildChatCompletionsEndpoint('http://localhost:1234/v1')).toBe('http://localhost:1234/v1/chat/completions');
      expect(buildChatCompletionsEndpoint('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1/chat/completions');
    });

    it('agrega /v1/chat/completions si la base no tiene versión', () => {
      expect(buildChatCompletionsEndpoint('http://localhost:1234')).toBe('http://localhost:1234/v1/chat/completions');
    });

    it('respeta un endpoint completo que ya incluye /chat/completions', () => {
      expect(buildChatCompletionsEndpoint('https://openrouter.ai/api/v1/chat/completions')).toBe(
        'https://openrouter.ai/api/v1/chat/completions',
      );
    });
  });

  describe('las tres formas de proveedor (Tarea 9b.3 y 9b.4, armadas por gitcron.json desde 4.3)', () => {
    it('LM Studio: petición local sin cabecera authorization', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Respuesta local' }, finish_reason: 'stop' }],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const config = lmStudio();
      await completeText(config, {
        model: 'local-model',
        system: 'Eres un asistente',
        user: 'Hola',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://localhost:1234/v1/chat/completions');
      expect(calledInit.headers['content-type']).toBe('application/json');
      expect(calledInit.headers.authorization).toBeUndefined();

      const body = JSON.parse(calledInit.body);
      expect(body.model).toBe('local-model');
      expect(body.messages).toEqual([
        { role: 'system', content: 'Eres un asistente' },
        { role: 'user', content: 'Hola' },
      ]);
    });

    it('OpenRouter: petición online con Bearer token y cabeceras de atribución', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Respuesta OpenRouter' }, finish_reason: 'stop' }],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const config = openRouter('sk-or-v1-secret-token-12345');

      await completeText(config, {
        model: 'anthropic/claude-sonnet-4.5',
        system: 'System prompt',
        user: 'User prompt',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(calledInit.headers['content-type']).toBe('application/json');
      expect(calledInit.headers.authorization).toBe('Bearer sk-or-v1-secret-token-12345');
      expect(calledInit.headers['HTTP-Referer']).toBe('https://github.com/Al3design/gitcron');
      expect(calledInit.headers['X-Title']).toBe('GitCron');

      const body = JSON.parse(calledInit.body);
      expect(body.model).toBe('anthropic/claude-sonnet-4.5');
    });

    it('Unsloth Desktop: petición remota con TRES credenciales (modelo + Cloudflare Access) (Tarea 9b.4 corregida)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Respuesta Unsloth' }, finish_reason: 'stop' }],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const config = unsloth({ apiKey: 'cf-tunnel-bearer-xyz', id: 'cf-client-id-123.access', secret: 'cf-client-secret-456.access' });

      await completeText(config, {
        model: 'unsloth/gemma-3-12b',
        system: 'System unsloth',
        user: 'User unsloth',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('https://llm.aledesign.dev/v1/chat/completions');
      expect(calledInit.headers['content-type']).toBe('application/json');
      expect(calledInit.headers.authorization).toBe('Bearer cf-tunnel-bearer-xyz');
      expect(calledInit.headers['CF-Access-Client-Id']).toBe('cf-client-id-123.access');
      expect(calledInit.headers['CF-Access-Client-Secret']).toBe('cf-client-secret-456.access');
    });
  });

  describe('seguridad de las claves (Tarea 9b.5 y 9b.7)', () => {
    it('la clave NO sale del proceso ni se fuga en mensajes de error HTTP', async () => {
      const SECRET_KEY = 'super-secret-key-that-must-never-leak';
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: `Unauthorized: ${SECRET_KEY}` } }),
      }) as unknown as typeof fetch;

      const config = openRouter(SECRET_KEY);

      await expect(
        completeText(config, {
          model: 'model',
          system: 's',
          user: 'u',
        }),
      ).rejects.toThrowError(/OpenRouter respondió 401/);

      try {
        await completeText(config, { model: 'm', system: 's', user: 'u' });
      } catch (err) {
        const errorMsg = String(err);
        expect(errorMsg).not.toContain(SECRET_KEY);
      }
    });

    it('la clave NO se filtra cuando falla la red', async () => {
      const SECRET_KEY = 'another-sensitive-token';
      globalThis.fetch = vi.fn().mockRejectedValue(new Error(`fetch failed for token ${SECRET_KEY}`)) as unknown as typeof fetch;

      const config = openRouter(SECRET_KEY);

      try {
        await completeText(config, { model: 'm', system: 's', user: 'u' });
        expect.fail('Debería haber lanzado error');
      } catch (err) {
        const errorMsg = String(err);
        expect(errorMsg).not.toContain(SECRET_KEY);
        expect(errorMsg).toContain('OpenRouter no responde');
      }
    });

    it('ninguna de las tres credenciales de Unsloth se filtra en mensajes de error de red o HTTP', async () => {
      const MODEL_KEY = 'super-secret-model-token';
      const CF_ID = 'cf-id-sensitive-123456';
      const CF_SECRET = 'cf-secret-sensitive-789012';

      // 1. Error HTTP 403 Forbidden
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden' }),
      }) as unknown as typeof fetch;

      const config = unsloth({ apiKey: MODEL_KEY, id: CF_ID, secret: CF_SECRET });

      try {
        await completeText(config, { model: 'm', system: 's', user: 'u' });
        expect.fail('Debería haber lanzado');
      } catch (err) {
        const msg = String(err);
        expect(msg).toContain('Unsloth CASA respondió 403');
        expect(msg).not.toContain(MODEL_KEY);
        expect(msg).not.toContain(CF_ID);
        expect(msg).not.toContain(CF_SECRET);
      }

      // 2. Error de red (fetch failed)
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed ECONNREFUSED')) as unknown as typeof fetch;
      try {
        await completeText(config, { model: 'm', system: 's', user: 'u' });
        expect.fail('Debería haber lanzado');
      } catch (err) {
        const msg = String(err);
        expect(msg).toContain('Unsloth CASA no responde');
        expect(msg).not.toContain(MODEL_KEY);
        expect(msg).not.toContain(CF_ID);
        expect(msg).not.toContain(CF_SECRET);
      }
    });
  });

  describe('modos duales: respuesta única y streaming SSE (Tarea 9b.3)', () => {
    it('completeText devuelve el texto consolidado y finishReason', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Texto completo y final' }, finish_reason: 'stop' }],
        }),
      }) as unknown as typeof fetch;

      const config = lmStudio();
      const res = await completeText(config, { model: 'm', system: 's', user: 'u' });

      expect(res.text).toBe('Texto completo y final');
      expect(res.finishReason).toBe('stop');
    });

    it('streamText procesa SSE acumulando chunks y emitiendo onChunk', async () => {
      const sseStream = [
        'data: {"choices":[{"delta":{"reasoning":"Pensando paso 1...\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"feat: asunto\\n\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Cuerpo descriptivo."}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      let index = 0;
      const customReadable = new ReadableStream({
        pull(controller) {
          if (index < sseStream.length) {
            controller.enqueue(encoder.encode(sseStream[index++]));
          } else {
            controller.close();
          }
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: customReadable,
      }) as unknown as typeof fetch;

      const receivedChunks: any[] = [];
      const config = lmStudio();
      const res = await streamText(config, {
        model: 'm',
        system: 's',
        user: 'u',
        onChunk: (chunks) => receivedChunks.push(...chunks),
      });

      expect(res.text).toBe('feat: asunto\n\nCuerpo descriptivo.');
      expect(res.finishReason).toBe('stop');
      expect(receivedChunks.length).toBeGreaterThan(0);
      expect(receivedChunks.some((c) => c.kind === 'reasoning')).toBe(true);
      expect(receivedChunks.some((c) => c.kind === 'content')).toBe(true);
    });

    it('streamText degrada limpiamente a respuesta única si el servidor responde con JSON plano', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          choices: [{ message: { content: 'Fallback a JSON sin stream' }, finish_reason: 'stop' }],
        }),
      }) as unknown as typeof fetch;

      const config = lmStudio();
      const res = await streamText(config, { model: 'm', system: 's', user: 'u' });

      expect(res.text).toBe('Fallback a JSON sin stream');
      expect(res.finishReason).toBe('stop');
    });
  });

  describe('manejo de TimeoutError y cancelación (Tanda 9c.4 c)', () => {
    it('completeText transforma TimeoutError en mensaje de timeout amigable', async () => {
      const timeoutErr = new Error('The operation was aborted due to timeout');
      timeoutErr.name = 'TimeoutError';
      globalThis.fetch = vi.fn().mockRejectedValue(timeoutErr) as unknown as typeof fetch;

      const config = lmStudio();
      await expect(
        completeText(config, { model: 'm', system: 's', user: 'u', timeoutMs: 5000 }),
      ).rejects.toThrow(/LM Studio: la petición tardó demasiado \(5s\) y se canceló\./);
    });

    it('streamText transforma TimeoutError en mensaje de timeout amigable', async () => {
      const timeoutErr = new Error('The operation was aborted due to timeout');
      timeoutErr.name = 'TimeoutError';
      globalThis.fetch = vi.fn().mockRejectedValue(timeoutErr) as unknown as typeof fetch;

      const config = lmStudio();
      await expect(
        streamText(config, { model: 'm', system: 's', user: 'u', timeoutMs: 10000 }),
      ).rejects.toThrow(/LM Studio: la petición tardó demasiado \(10s\) y se canceló\./);
    });

    it('completeText y streamText distinguen cancelación explícita del usuario cuando signal está abortado', async () => {
      const abortErr = new Error('The user aborted a request.');
      abortErr.name = 'AbortError';
      globalThis.fetch = vi.fn().mockRejectedValue(abortErr) as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      const config = lmStudio();
      await expect(
        completeText(config, { model: 'm', system: 's', user: 'u', signal: controller.signal }),
      ).rejects.toThrow(/LM Studio: operación cancelada por el usuario\./);

      await expect(
        streamText(config, { model: 'm', system: 's', user: 'u', signal: controller.signal }),
      ).rejects.toThrow(/LM Studio: operación cancelada por el usuario\./);
    });
  });
});
