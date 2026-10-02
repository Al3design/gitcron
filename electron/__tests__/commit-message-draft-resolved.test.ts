import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { DraftChunk } from '../../types/commit-message-ai';

const handlers = new Map<string, (_event: any, ...args: any[]) => Promise<any>>();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    raw: vi.fn(async (args: string[]) => {
      if (args.includes('--stat')) return '1 file changed, 10 insertions(+)';
      if (args.length === 4 && args[3] === 'tasks.md') return '+- [x] Tarea completada';
      return '+console.log("hello world");';
    }),
  })),
}));

vi.mock('../git/repo-queue', () => ({
  withRepoLock: vi.fn(async (_path: string, fn: () => Promise<any>) => fn()),
}));

import {
  registerCommitMessageAiHandlers,
  resetCommitAiConfigWatcherForTesting,
  setCommitAiConfigPathForTesting,
  setCodexSpawnForTesting,
  setCodexResolveForTesting,
} from '../ipc/commit-message-ai';

describe('commit-ai:draft con uso resuelto (openai-compatible y codex CLI)', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-commit-test-'));
    registerCommitMessageAiHandlers();
    // En Windows codex es un acceso .cmd que sólo arranca por el shell; la prueba fija la resolución.
    setCodexResolveForTesting(async () => ({ file: 'C:/tools/codex.cmd', viaShell: true }));
  });

  afterEach(() => {
    setCommitAiConfigPathForTesting(null);
    resetCommitAiConfigWatcherForTesting();
    setCodexSpawnForTesting(null);
    setCodexResolveForTesting(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('commit-ai:resolved-model devuelve datos sin secretos o null', async () => {
    const resolvedHandler = handlers.get('commit-ai:resolved-model')!;

    // Sin archivo de configuración
    setCommitAiConfigPathForTesting(path.join(tmpDir, 'no-file.json'));
    // Una llamada real siempre trae quién pregunta: el canal lo usa para avisarle
    // cuando el archivo cambia (D3).
    const event = { sender: { isDestroyed: () => false, send: vi.fn() } };
    const noConfigRes = await resolvedHandler(event);
    expect(noConfigRes).toEqual({ success: true, data: null });

    // Con archivo
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          unslothpc: {
            name: 'Unsloth CASA',
            options: { baseURL: 'https://llm.aledesign.dev/v1', apiKey: 'secret-key' },
          },
        },
        agent: {
          'gitcron-commit': {
            model: 'unslothpc/unsloth/Qwen3.8-27B-GGUF',
          },
        },
      }),
      'utf8',
    );

    setCommitAiConfigPathForTesting(configPath);
    const resolvedRes = await resolvedHandler(event);
    expect(resolvedRes.success).toBe(true);
    expect(resolvedRes.data).toEqual({
      status: 'resolved',
      providerName: 'Unsloth CASA',
      modelId: 'unsloth/Qwen3.8-27B-GGUF',
      kind: 'openai-compatible',
      destination: 'external-service',
      sourceFile: configPath,
      available: true,
      configFiles: [{ path: configPath, scope: 'global', exists: true }],
    });
    // Garantiza que no expone secretos
    expect(resolvedRes.data).not.toHaveProperty('apiKey');
    expect(resolvedRes.data).not.toHaveProperty('headers');
  });

  it('openai-compatible: envía cabeceras Bearer y CF-Access-*, options en cuerpo, stream explícito, y no llama a LM Studio', async () => {
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          unslothpclocal: {
            name: 'Unsloth CASA Local',
            options: {
              baseURL: 'http://192.168.1.7:8888/v1',
              apiKey: 'unsloth-secret-token',
              enterpriseUrl: 'https://enterprise.internal',
              setCacheKey: true,
              headers: {
                'CF-Access-Client-Id': 'cf-client-id-xyz',
                'CF-Access-Client-Secret': 'cf-client-secret-abc',
              },
            },
            models: {
              'unsloth/Qwen3.8-27B-GGUF': {
                limit: { context: 65536, output: 8192 },
              },
            },
          },
        },
        agent: {
          'gitcron-commit': {
            model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
            temperature: 0.2,
            options: {
              model: 'hijacked-model-name',
              reasoning_effort: 'high',
            },
          },
        },
      }),
      'utf8',
    );
    setCommitAiConfigPathForTesting(configPath);

    const capturedCalls: Array<{ url: string; init: RequestInit }> = [];

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      capturedCalls.push({ url, init: init! });

      // Simular SSE stream de OpenAI
      const sseBody = [
        'data: {"choices":[{"delta":{"content":"feat(ai): redacción de commit con unsloth\\n\\nCuerpo del commit"}}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      return new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    vi.stubGlobal('fetch', mockFetch);

    const draftHandler = handlers.get('commit-ai:draft')!;
    const mockSender = { isDestroyed: () => false, send: vi.fn() };

    const result = await draftHandler(
      { sender: mockSender },
      {
        repoPath: tmpDir,
        paths: ['src/file.ts'],
        changeId: 'modelos-en-casa',
        intent: 'probar integración',
        model: 'ignored-when-resolved',
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      status: 'drafted',
      subject: 'feat(ai): redacción de commit con unsloth\n\nCuerpo del commit',
      model: 'unsloth/Qwen3.8-27B-GGUF',
    });

    // 1. No se llamó al catálogo de LM Studio (/api/v1/models)
    const calledCatalog = capturedCalls.some((c) => c.url.includes('/api/v1/models'));
    expect(calledCatalog).toBe(false);

    // 2. Se llamó a /chat/completions con los parámetros exactos
    const chatCall = capturedCalls.find((c) => c.url.includes('/chat/completions'));
    expect(chatCall).toBeDefined();

    const headers = chatCall!.init.headers as Record<string, string>;
    expect(headers['authorization'] || headers['Authorization']).toBe('Bearer unsloth-secret-token');
    expect(headers['CF-Access-Client-Id']).toBe('cf-client-id-xyz');
    expect(headers['CF-Access-Client-Secret']).toBe('cf-client-secret-abc');

    const body = JSON.parse(chatCall!.init.body as string);
    // options en el cuerpo
    expect(body.reasoning_effort).toBe('high');
    // stream explícito
    expect(body.stream).toBe(true);
    // options.model no pisa el modelo esencial
    expect(body.model).toBe('unsloth/Qwen3.8-27B-GGUF');
    // enterpriseUrl y setCacheKey no viajan en el cuerpo
    expect(body).not.toHaveProperty('enterpriseUrl');
    expect(body).not.toHaveProperty('setCacheKey');
    expect(body.temperature).toBe(0.2);
  });

  it('codex CLI: argumentos exactos, prompt por stdin, cwd vacío, y entrega de chunks', async () => {
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent: {
          'gitcron-commit': {
            model: 'codex/gpt-5.6-luna',
          },
        },
      }),
      'utf8',
    );
    setCommitAiConfigPathForTesting(configPath);

    let capturedCommand = '';
    let capturedArgs: string[] = [];
    let capturedOpts: any = null;
    let capturedStdin = '';

    const mockSpawn = vi.fn((cmd: string, args: string[], opts: any) => {
      capturedCommand = cmd;
      capturedArgs = args;
      capturedOpts = opts;

      // Verificar que cwd está vacío al momento de la invocación
      const filesInCwd = fs.readdirSync(opts.cwd);
      expect(filesInCwd.length).toBe(0);

      const emitter = new EventEmitter() as any;
      emitter.stdout = new PassThrough();
      emitter.stderr = new PassThrough();
      emitter.stdin = new PassThrough();
      emitter.killed = false;
      emitter.kill = vi.fn(() => {
        emitter.killed = true;
      });

      emitter.stdin.on('data', (d: Buffer) => {
        capturedStdin += d.toString('utf8');
      });

      // Simular salida de Codex JSONL en el próximo tick
      process.nextTick(() => {
        emitter.stdout.write(
          JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }) + '\n',
        );
        emitter.stdout.write(
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'msg-1',
              type: 'agent_message',
              text: 'fix(core): corrección generada por codex\n\nDetalle de la corrección',
            },
          }) + '\n',
        );
        emitter.stdout.write(
          JSON.stringify({
            type: 'turn.completed',
            usage: { input_tokens: 100, output_tokens: 50 },
          }) + '\n',
        );
        emitter.stdout.end();
        emitter.stderr.end();
        emitter.emit('close', 0);
      });

      return emitter;
    });

    setCodexSpawnForTesting(mockSpawn as any);

    const draftHandler = handlers.get('commit-ai:draft')!;
    const mockSender = { isDestroyed: () => false, send: vi.fn() };

    const result = await draftHandler(
      { sender: mockSender },
      {
        repoPath: tmpDir,
        paths: ['src/file.ts', 'tasks.md'],
        changeId: 'modelos-en-casa',
        intent: 'probar codex',
        model: 'ignored',
        draftId: 'draft-99',
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      status: 'drafted',
      subject: 'fix(core): corrección generada por codex\n\nDetalle de la corrección',
      model: 'gpt-5.6-luna',
    });

    // Argumentos exactos
    expect(capturedCommand).toBe('C:/tools/codex.cmd');
    expect(capturedOpts.shell).toBe(true);
    expect(capturedArgs).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '-m',
      'gpt-5.6-luna',
      '-',
    ]);

    // Prompt pasado por stdin
    expect(capturedStdin).toContain('Tarea completada');
    expect(capturedStdin).toContain('hello world');

    // Chunks emitidos vía IPC pump
    expect(mockSender.send).toHaveBeenCalledWith(
      'commit-ai:chunk',
      expect.objectContaining({
        draftId: 'draft-99',
        chunks: expect.arrayContaining([
          expect.objectContaining({
            kind: 'content',
            text: 'fix(core): corrección generada por codex\n\nDetalle de la corrección',
          }),
        ]),
      }),
    );
  });

  it('codex CLI: cancelación mata el proceso', async () => {
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent: {
          'gitcron-commit': {
            model: 'codex/gpt-5.6-luna',
          },
        },
      }),
      'utf8',
    );
    setCommitAiConfigPathForTesting(configPath);

    let childEmitter: any = null;

    const mockSpawn = vi.fn((_cmd: string, _args: string[], _opts: any) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new PassThrough();
      emitter.stderr = new PassThrough();
      emitter.stdin = new PassThrough();
      emitter.killed = false;
      emitter.kill = vi.fn(() => {
        emitter.killed = true;
        process.nextTick(() => {
          emitter.emit('close', null);
        });
      });
      childEmitter = emitter;
      return emitter;
    });

    setCodexSpawnForTesting(mockSpawn as any);

    const draftHandler = handlers.get('commit-ai:draft')!;
    const cancelHandler = handlers.get('commit-ai:cancel')!;

    const draftPromise = draftHandler(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      {
        repoPath: tmpDir,
        paths: ['src/file.ts'],
        changeId: 'modelos-en-casa',
        intent: 'cancelar',
        model: 'ignored',
      },
    );

    // Dar tiempo para que arranque el proceso y luego cancelar
    await new Promise((r) => setTimeout(r, 10));
    const cancelResult = await cancelHandler({});
    expect(cancelResult).toEqual({ success: true, data: { cancelled: true } });
    expect(childEmitter.kill).toHaveBeenCalled();

    const res = await draftPromise;
    expect(res.data?.status).toBe('unavailable');
    expect(res.data?.detail).toMatch(/cancelada/i);
    expect(res.data?.detail).not.toMatch(/tardó demasiado/i);
  });

  it('codex CLI: tiempo agotado da aviso de tiempo', async () => {
    const mockSpawn = vi.fn((_cmd: string, _args: string[], _opts: any) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new PassThrough();
      emitter.stderr = new PassThrough();
      emitter.stdin = new PassThrough();
      emitter.killed = false;
      emitter.kill = vi.fn(() => {
        emitter.killed = true;
      });
      return emitter;
    });

    const { draftCommitWithCodex } = await import('../ai/commit-message/codex-cli');
    const result = await draftCommitWithCodex({
      model: 'gpt-5.6-luna',
      prompt: 'test prompt',
      timeoutMs: 40,
      spawnFn: mockSpawn as any,
      resolveExecutable: async () => ({ file: 'codex', viaShell: false }),
    });

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.detail).toMatch(/tardó demasiado.*canceló/i);
    }
  });

  // Salidas reales de Codex 0.144.4, medidas el 2026-10-01.
  function spawnEmitting(lines: unknown[], exitCode: number) {
    return vi.fn((_cmd: string, _args: string[], _opts: any) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new PassThrough();
      emitter.stderr = new PassThrough();
      emitter.stdin = new PassThrough();
      emitter.killed = false;
      emitter.kill = vi.fn();
      process.nextTick(() => {
        // Todo en un solo pedazo y el último renglón sin salto: así llega a veces.
        emitter.stdout.write(lines.map((l) => JSON.stringify(l)).join('\n'));
        emitter.stdout.end();
        emitter.stderr.end();
        emitter.stdout.on('end', () => emitter.emit('close', exitCode));
        emitter.stdout.resume();
      });
      return emitter;
    });
  }

  it('codex CLI: un aviso (ítem «error») no tira la respuesta que llega después', async () => {
    const { draftCommitWithCodex } = await import('../ai/commit-message/codex-cli');
    const chunks: DraftChunk[] = [];
    const result = await draftCommitWithCodex({
      model: 'gpt-5.6-luna',
      prompt: 'test prompt',
      onChunk: (c) => chunks.push(...c),
      spawnFn: spawnEmitting(
        [
          { type: 'thread.started', thread_id: 't' },
          { type: 'turn.started' },
          {
            type: 'item.completed',
            item: { id: 'item_0', type: 'error', message: 'Skill descriptions were shortened to fit the 2% skills context budget.' },
          },
          { type: 'item.completed', item: { id: 'item_1', type: 'reasoning', text: 'Mirando el diff' } },
          { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'feat: prueba' } },
          { type: 'turn.completed', usage: { input_tokens: 20847, output_tokens: 7 } },
        ],
        0,
      ) as any,
      resolveExecutable: async () => ({ file: 'codex', viaShell: false }),
    });

    expect(result).toEqual({ status: 'drafted', subject: 'feat: prueba', model: 'gpt-5.6-luna' });
    expect(chunks).toEqual([
      { kind: 'reasoning', text: 'Mirando el diff' },
      { kind: 'content', text: 'feat: prueba' },
      {
        kind: 'done',
        finishReason: null,
        usage: {
          promptTokens: 20847,
          cachedPromptTokens: null,
          completionTokens: 7,
          reasoningTokens: null,
        },
      },
    ]);
  });

  it('codex CLI: con salida medida (2026-10-01), el done llega con los cuatro números y después del contenido', async () => {
    const { draftCommitWithCodex } = await import('../ai/commit-message/codex-cli');
    const chunks: DraftChunk[] = [];
    const result = await draftCommitWithCodex({
      model: 'gpt-5.6-luna',
      prompt: 'test prompt',
      onChunk: (c) => chunks.push(...c),
      spawnFn: spawnEmitting(
        [
          { type: 'thread.started', thread_id: 't' },
          { type: 'turn.started' },
          { type: 'item.completed', item: { id: 'item_1', type: 'reasoning', text: 'Pensando...' } },
          { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'feat: commit listo' } },
          // Salida real medida el 2026-10-01:
          {
            type: 'turn.completed',
            usage: {
              input_tokens: 20847,
              cached_input_tokens: 8960,
              output_tokens: 7,
              reasoning_output_tokens: 0,
            },
          },
        ],
        0,
      ) as any,
      resolveExecutable: async () => ({ file: 'codex', viaShell: false }),
    });

    expect(result).toEqual({ status: 'drafted', subject: 'feat: commit listo', model: 'gpt-5.6-luna' });

    // El done llega después del contenido con los cuatro números
    expect(chunks).toEqual([
      { kind: 'reasoning', text: 'Pensando...' },
      { kind: 'content', text: 'feat: commit listo' },
      {
        kind: 'done',
        finishReason: null,
        usage: {
          promptTokens: 20847,
          cachedPromptTokens: 8960,
          completionTokens: 7,
          reasoningTokens: 0,
        },
      },
    ]);

    const contentIdx = chunks.findIndex((c) => c.kind === 'content');
    const doneIdx = chunks.findIndex((c) => c.kind === 'done');
    expect(contentIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(contentIdx);
  });

  it('codex CLI: sin turn.completed no hay done con conteo', async () => {
    const { draftCommitWithCodex } = await import('../ai/commit-message/codex-cli');
    const chunks: DraftChunk[] = [];
    const result = await draftCommitWithCodex({
      model: 'gpt-5.6-luna',
      prompt: 'test prompt',
      onChunk: (c) => chunks.push(...c),
      spawnFn: spawnEmitting(
        [
          { type: 'thread.started', thread_id: 't' },
          { type: 'turn.started' },
          { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'fix: sin conteo' } },
          // Sin turn.completed
        ],
        0,
      ) as any,
      resolveExecutable: async () => ({ file: 'codex', viaShell: false }),
    });

    expect(result).toEqual({ status: 'drafted', subject: 'fix: sin conteo', model: 'gpt-5.6-luna' });
    expect(chunks).toEqual([
      { kind: 'content', text: 'fix: sin conteo' },
    ]);
    expect(chunks.some((c) => c.kind === 'done')).toBe(false);
  });

  it('codex CLI: el fallo de la API se muestra legible, no como JSON', async () => {
    const apiError = JSON.stringify({
      type: 'error',
      status: 400,
      error: {
        type: 'invalid_request_error',
        message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
      },
    });
    const { draftCommitWithCodex } = await import('../ai/commit-message/codex-cli');
    const result = await draftCommitWithCodex({
      model: 'gpt-6.1-sol',
      prompt: 'test prompt',
      spawnFn: spawnEmitting(
        [
          { type: 'thread.started', thread_id: 't' },
          { type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Model metadata for `gpt-6.1-sol` not found.' } },
          { type: 'turn.started' },
          { type: 'error', message: apiError },
          { type: 'turn.failed', error: { message: apiError } },
        ],
        1,
      ) as any,
      resolveExecutable: async () => ({ file: 'codex', viaShell: false }),
    });

    expect(result).toEqual({
      status: 'unavailable',
      detail: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
    });
  });

  it('codex CLI: error 400 de Codex -> unavailable con el motivo', async () => {
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent: {
          'gitcron-commit': {
            model: 'codex/gpt-6.1-sol',
          },
        },
      }),
      'utf8',
    );
    setCommitAiConfigPathForTesting(configPath);

    const mockSpawn = vi.fn((_cmd: string, _args: string[], _opts: any) => {
      const emitter = new EventEmitter() as any;
      emitter.stdout = new PassThrough();
      emitter.stderr = new PassThrough();
      emitter.stdin = new PassThrough();
      emitter.killed = false;
      emitter.kill = vi.fn();

      process.nextTick(() => {
        emitter.stdout.write(
          JSON.stringify({
            type: 'error',
            message: '400 not supported when using Codex with a ChatGPT account',
          }) + '\n',
        );
        emitter.stdout.end();
        emitter.stderr.end();
        emitter.emit('close', 1);
      });

      return emitter;
    });

    setCodexSpawnForTesting(mockSpawn as any);

    const draftHandler = handlers.get('commit-ai:draft')!;
    const res = await draftHandler(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      {
        repoPath: tmpDir,
        paths: ['src/file.ts'],
        changeId: null,
        intent: null,
        model: 'ignored',
      },
    );

    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unavailable');
    expect(res.data?.detail).toContain('400 not supported when using Codex with a ChatGPT account');
  });

  it('claude-code y antigravity devuelven unavailable con «todavía no conectado»', async () => {
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent: {
          'gitcron-commit': {
            model: 'claude-code/haiku',
          },
        },
      }),
      'utf8',
    );
    setCommitAiConfigPathForTesting(configPath);

    const draftHandler = handlers.get('commit-ai:draft')!;
    const res = await draftHandler(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      {
        repoPath: tmpDir,
        paths: ['src/file.ts'],
        changeId: null,
        intent: null,
        model: 'ignored',
      },
    );

    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('unavailable');
    expect(res.data?.detail).toBe('todavía no conectado');
  });

  it('commit-ai:last-request devuelve el pedido con procedencias y sin secretos, cabeceras secretas ni diff', async () => {
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          unslothpc: {
            name: 'Unsloth PC',
            options: {
              baseURL: 'http://192.168.1.10:8888/v1',
              apiKey: 'super-secret-api-key-999',
              headers: {
                'CF-Access-Client-Id': 'cf-client-public-id',
                'CF-Access-Client-Secret': 'cf-secret-token-xyz',
              },
            },
            models: {
              'unsloth/Qwen3.8-27B-GGUF': {
                limit: { context: 32768, output: 4096 },
                options: { top_k: 40 },
              },
            },
          },
        },
        agent: {
          'gitcron-commit': {
            model: 'unslothpc/unsloth/Qwen3.8-27B-GGUF',
            temperature: 0.3,
            options: {
              reasoning_effort: 'medium',
            },
          },
        },
      }),
      'utf8',
    );
    setCommitAiConfigPathForTesting(configPath);

    const mockFetch = vi.fn(async () => {
      const sseBody = [
        'data: {"choices":[{"delta":{"content":"feat: asunto redactado con éxito"}}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');
      return new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const draftHandler = handlers.get('commit-ai:draft')!;
    const lastRequestHandler = handlers.get('commit-ai:last-request')!;
    const mockSender = { isDestroyed: () => false, send: vi.fn() };

    // Ejecutar redacción
    const draftRes = await draftHandler(
      { sender: mockSender },
      {
        repoPath: tmpDir,
        paths: ['src/file.ts'],
        changeId: 'modelos-en-casa',
        intent: 'probar último pedido',
        model: 'ignored',
      },
    );
    expect(draftRes.success).toBe(true);

    // Consultar el último pedido
    const lastRes = await lastRequestHandler({});
    expect(lastRes.success).toBe(true);
    expect(lastRes.data).toBeDefined();

    const req = lastRes.data;
    expect(req.kind).toBe('openai-compatible');
    expect(req.endpoint).toBe('http://192.168.1.10:8888/v1/chat/completions');
    expect(req.model).toEqual({
      value: 'unsloth/Qwen3.8-27B-GGUF',
      provenance: 'agent.gitcron-commit.model',
    });

    // Parámetros y sus procedencias
    expect(req.parameters.temperature).toEqual({
      value: 0.3,
      provenance: 'agent.gitcron-commit.temperature',
    });
    expect(req.parameters.max_tokens).toEqual({
      value: 4096,
      provenance: 'provider.unslothpc.models.unsloth/Qwen3.8-27B-GGUF.limit.output',
    });
    expect(req.parameters.top_k).toEqual({
      value: 40,
      provenance: 'provider.unslothpc.models.unsloth/Qwen3.8-27B-GGUF.options.top_k',
    });
    expect(req.parameters.reasoning_effort).toEqual({
      value: 'medium',
      provenance: 'agent.gitcron-commit.options.reasoning_effort',
    });

    // Cabeceras: sólo nombre y procedencia
    expect(req.headers).toEqual(
      expect.arrayContaining([
        {
          name: 'CF-Access-Client-Id',
          provenance: 'provider.unslothpc.options.headers.CF-Access-Client-Id',
        },
        {
          name: 'CF-Access-Client-Secret',
          provenance: 'provider.unslothpc.options.headers.CF-Access-Client-Secret',
        },
      ]),
    );

    // Autenticación sin valor
    expect(req.auth).toBe('Bearer, valor escrito en el archivo');

    // Comprobación de seguridad: buscar en el JSON serializado
    const serialized = JSON.stringify(req);
    expect(serialized).not.toContain('super-secret-api-key-999');
    expect(serialized).not.toContain('cf-secret-token-xyz');
    expect(serialized).not.toContain('hello world'); // contenido del diff
    expect(serialized).not.toContain('console.log');
  });

  it('lo enviado coincide con el cuerpo que viajó, aunque options traiga model o stream y falte temperature', async () => {
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          unslothpc: {
            options: { baseURL: 'http://192.168.1.10:8888/v1' },
            models: { 'unsloth/Qwen3.8-27B-GGUF': { options: { model: 'otro-modelo', stream: false, top_k: 40 } } },
          },
        },
        agent: { 'gitcron-commit': { model: 'unslothpc/unsloth/Qwen3.8-27B-GGUF' } },
      }),
      'utf8',
    );
    setCommitAiConfigPathForTesting(configPath);

    const mockFetch = vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"feat: asunto"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', mockFetch);

    await handlers.get('commit-ai:draft')!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { repoPath: tmpDir, paths: ['src/file.ts'], changeId: null, intent: null, model: 'ignored' },
    );
    const req = (await handlers.get('commit-ai:last-request')!({})).data;

    const sent = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    const { model: sentModel, messages: _messages, ...sentParams } = sent;
    expect(sentModel).toBe('unsloth/Qwen3.8-27B-GGUF');
    expect(req.model.value).toBe(sentModel);
    const shownValues = Object.fromEntries(
      Object.entries(req.parameters as Record<string, { value: unknown }>).map(([k, v]) => [k, v.value]),
    );
    expect(shownValues).toEqual(sentParams);
    expect(req.parameters.model).toBeUndefined();
    expect(req.parameters.stream.value).toBe(true);
    expect(req.parameters.temperature.provenance).toBe('valor por omisión de GitCron');
  });

  it('error 400 simulado con options.foo en el cuerpo nombra foo y su procedencia, e hizo un solo pedido', async () => {
    const configPath = path.join(tmpDir, 'gitcron.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          unslothsrv: {
            name: 'Unsloth SRV',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
            },
            models: {
              'llama-3': {
                options: {
                  foo: 'bar-value',
                },
              },
            },
          },
        },
        agent: {
          'gitcron-commit': {
            model: 'unslothsrv/llama-3',
          },
        },
      }),
      'utf8',
    );
    setCommitAiConfigPathForTesting(configPath);

    let fetchCallCount = 0;
    const mockFetch = vi.fn(async () => {
      fetchCallCount++;
      return new Response(JSON.stringify({ error: { message: 'unknown parameter: foo' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const draftHandler = handlers.get('commit-ai:draft')!;
    const mockSender = { isDestroyed: () => false, send: vi.fn() };

    const result = await draftHandler(
      { sender: mockSender },
      {
        repoPath: tmpDir,
        paths: ['src/file.ts'],
        changeId: 'modelos-en-casa',
        intent: 'probar 400',
        model: 'ignored',
      },
    );

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('unavailable');

    // Mensaje nombra 'foo' y su procedencia
    const detail = result.data?.detail ?? '';
    expect(detail).toContain('400');
    expect(detail).toContain('Parámetros enviados fuera del estándar de OpenAI: foo (de provider.unslothsrv.models.llama-3.options.foo)');

    // Se hizo exactamente un solo pedido (no reintenta quitándolos)
    expect(fetchCallCount).toBe(1);
  });
});
