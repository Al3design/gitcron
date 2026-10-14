import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDir } from '@/test-utils/temp-dir';
import type { DatabaseSync } from 'node:sqlite';
import { openTemporalAgentDatabase } from '../../db/connection';
import { authorizedRepoRoot, authorizedRepoStore } from '../../ipc/authorized-repos';
import {
  cancelAssistMessage,
  defaultAssistSendDeps,
  sendAssistMessage,
  type AssistSendDeps,
  ASSIST_HISTORY_CHAR_BUDGET,
} from '../assist-send';
import { TextUseError, type TextUseRequest, type TextUseResult } from '../../ai/text-use';
import type { ModelAlternative, ResolvedModelFor } from '../../ai/config/resolve-model-for';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} from '../../db/assist-conversations';
import type { ContextResolution } from '../context-reference';

describe('assist-send module', () => {
  let db: DatabaseSync;
  let tempBase: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    db = openTemporalAgentDatabase(':memory:');
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-send-test-'));
    const rawA = path.join(tempBase, 'repo-a');
    const rawB = path.join(tempBase, 'repo-b');
    fs.mkdirSync(path.join(rawA, '.git'), { recursive: true });
    fs.mkdirSync(path.join(rawB, '.git'), { recursive: true });

    authorizedRepoStore.clear();
    repoA = authorizedRepoStore.authorizeRepo(rawA)!;
    repoB = authorizedRepoStore.authorizeRepo(rawB)!;
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    db.close();
    removeTempDir(tempBase);
  });

  function createMockDeps(overrides: Partial<AssistSendDeps> = {}): AssistSendDeps {
    const dummyResolved: ResolvedModelFor = {
      status: 'resolved',
      use: 'gitcron-assist',
      resolved: {
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen-2.5',
        kind: 'openai-compatible',
        destination: 'this-machine',
        sourceFile: 'gitcron.json',
        available: true,
        provenance: {
          sourceFile: 'gitcron.json',
          model: 'qwen-2.5',
          options: {},
          headers: {},
        },
      },
      alternatives: [],
    };

    return {
      authorizedRoot: (p) => authorizedRepoRoot(p),
      resolveContext: async (_repo, selection): Promise<ContextResolution> => ({
        status: 'ok',
        checkoutPath: repoA,
        head: { sha: '1234567890abcdef', branch: 'main' },
        selection: selection as any ?? { kind: 'none' },
      }),
      resolveModel: () => dummyResolved,
      runText: async (_model, _req): Promise<TextUseResult> => ({
        text: 'Respuesta simulada del modelo.',
        finishReason: 'stop',
        usage: null,
        label: 'LM Studio · qwen-2.5',
        providerId: 'lmstudio',
        modelId: 'qwen-2.5',
      }),
      db: { db },
      ...overrides,
    };
  }

  it('defaultAssistSendDeps está definido', () => {
    expect(defaultAssistSendDeps).toBeDefined();
    expect(defaultAssistSendDeps.authorizedRoot).toBeTypeOf('function');
  });

  it('1. conversación nueva: guarda pregunta y respuesta, answered, con modelId y providerName; la pregunta tiene su referencia', async () => {
    const deps = createMockDeps();
    const result = await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-1',
        conversationId: null,
        viewId: 'graph',
        question: '¿Qué hace este commit?',
        selection: { kind: 'commit', sha: 'abcdef1' },
      },
      deps,
    );

    expect(result.status).toBe('answered');
    if (result.status !== 'answered') return;

    expect(result.conversationId).toBeDefined();
    expect(result.question.text).toBe('¿Qué hace este commit?');
    expect(result.question.references).toHaveLength(1);
    expect(result.question.references[0].selection).toEqual({ kind: 'commit', sha: 'abcdef1' });
    expect(result.answer.text).toBe('Respuesta simulada del modelo.');
    expect(result.answer.modelId).toBe('qwen-2.5');
    expect(result.answer.providerName).toBe('LM Studio');

    // Verificar en la DB
    const detail = getConversation({ checkoutPath: repoA, conversationId: result.conversationId }, { db });
    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(2);
    expect(detail!.messages[0].id).toBe(result.question.id);
    expect(detail!.messages[1].id).toBe(result.answer.id);
  });

  it('2. repo no autorizado devuelve failed / repo-not-authorized y la base no tiene conversaciones', async () => {
    const deps = createMockDeps();
    const result = await sendAssistMessage(
      {
        repoPath: path.join(tempBase, 'no-autorizado'),
        requestId: 'req-2',
        conversationId: null,
        viewId: null,
        question: 'Hola',
        selection: { kind: 'none' },
      },
      deps,
    );

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('repo-not-authorized');
    }
    expect(listConversations({ checkoutPath: repoA }, { db })).toHaveLength(0);
  });

  it('3. contexto rechazado (path-outside-checkout) devuelve failed / context-path-outside-checkout sin guardar nada', async () => {
    const deps = createMockDeps({
      resolveContext: async () => ({
        status: 'rejected',
        reason: 'path-outside-checkout',
      }),
    });

    const result = await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-3',
        conversationId: null,
        viewId: null,
        question: 'Consulta sobre archivo externo',
        selection: { kind: 'file', path: '../secreto.txt', at: 'worktree', takenAtHead: 'abc' },
      },
      deps,
    );

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('context-path-outside-checkout');
    }
    expect(listConversations({ checkoutPath: repoA }, { db })).toHaveLength(0);
  });

  it('4. cancelación: runText que espera a la señal; cancelAssistMessage cancela el pedido, la pregunta queda y no hay respuesta', async () => {
    let capturedSignal: AbortSignal | undefined;
    const deps = createMockDeps({
      runText: async (_model, req) => {
        capturedSignal = req.signal;
        return new Promise<TextUseResult>((_resolve, reject) => {
          if (req.signal) {
            req.signal.addEventListener('abort', () => {
              reject(new TextUseError('Aborted', 'cancelled', 'gitcron-assist'));
            });
          }
        });
      },
    });

    const promise = sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-cancel',
        conversationId: null,
        viewId: null,
        question: 'Pregunta a cancelar',
        selection: { kind: 'none' },
      },
      deps,
    );

    // Esperar un instante para que se registre el pedido
    await new Promise((r) => setTimeout(r, 20));
    expect(cancelAssistMessage('req-cancel')).toBe(true);

    const result = await promise;
    expect(result.status).toBe('cancelled');
    if (result.status !== 'cancelled') return;

    // La pregunta queda guardada, pero sin respuesta
    const detail = getConversation({ checkoutPath: repoA, conversationId: result.conversationId }, { db });
    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(1);
    expect(detail!.messages[0].text).toBe('Pregunta a cancelar');
    expect(detail!.messages[0].role).toBe('user');
  });

  it('5. proveedor caído: runText tira TextUseError unavailable con alternativa; devuelve failed / unavailable con la alternativa y la pregunta queda sin respuesta', async () => {
    const alternative: ModelAlternative = {
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      destination: 'external-service',
    };

    const deps = createMockDeps({
      runText: async () => {
        throw new TextUseError('Servidor no disponible', 'unavailable', 'gitcron-assist', [alternative]);
      },
    });

    const result = await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-unavailable',
        conversationId: null,
        viewId: null,
        question: 'Pregunta a proveedor caído',
        selection: { kind: 'none' },
      },
      deps,
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('unavailable');
    expect(result.alternatives).toEqual([{ providerId: 'openrouter', providerName: 'OpenRouter' }]);

    const detail = getConversation({ checkoutPath: repoA, conversationId: result.conversationId! }, { db });
    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(1);
    expect(detail!.messages[0].role).toBe('user');
  });

  it('6. destino correcto: se manda en conversación A; mientras piensa, se manda en B; respuestas quedan cada una en la suya', async () => {
    const convA = createConversation({ checkoutPath: repoA, title: 'Conversación A' }, { db });
    const convB = createConversation({ checkoutPath: repoA, title: 'Conversación B' }, { db });

    const deps = createMockDeps({
      runText: async (_model, req) => {
        // Simular un pequeño retardo
        await new Promise((r) => setTimeout(r, 30));
        return {
          text: req.user.includes('Pregunta para A') ? 'Respuesta para A' : 'Respuesta para B',
          finishReason: 'stop',
          usage: null,
          label: 'LM Studio · qwen',
          providerId: 'lmstudio',
          modelId: 'qwen',
        };
      },
    });

    const pA = sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-dest-a',
        conversationId: convA.id,
        viewId: null,
        question: 'Pregunta para A',
        selection: { kind: 'none' },
      },
      deps,
    );

    const pB = sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-dest-b',
        conversationId: convB.id,
        viewId: null,
        question: 'Pregunta para B',
        selection: { kind: 'none' },
      },
      deps,
    );

    const [resA, resB] = await Promise.all([pA, pB]);
    expect(resA.status).toBe('answered');
    expect(resB.status).toBe('answered');

    const detailA = getConversation({ checkoutPath: repoA, conversationId: convA.id }, { db });
    const detailB = getConversation({ checkoutPath: repoA, conversationId: convB.id }, { db });

    expect(detailA!.messages).toHaveLength(2);
    expect(detailA!.messages[1].text).toBe('Respuesta para A');

    expect(detailB!.messages).toHaveLength(2);
    expect(detailB!.messages[1].text).toBe('Respuesta para B');
  });

  it('7. borrada mientras pensaba: se borra antes de que vuelva el modelo -> discarded y no se recrea', async () => {
    let convIdCaptured: string | undefined;

    const deps = createMockDeps({
      runText: async () => {
        // Borrar la conversación mientras piensa
        if (convIdCaptured) {
          deleteConversation({ checkoutPath: repoA, conversationId: convIdCaptured }, { db });
        }
        return {
          text: 'Respuesta tardía',
          finishReason: 'stop',
          usage: null,
          label: 'LM Studio · qwen',
          providerId: 'lmstudio',
          modelId: 'qwen',
        };
      },
    });

    const conv = createConversation({ checkoutPath: repoA, title: 'Para borrar' }, { db });
    convIdCaptured = conv.id;

    const result = await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-delete-midway',
        conversationId: conv.id,
        viewId: null,
        question: '¿Seguís ahí?',
        selection: { kind: 'none' },
      },
      deps,
    );

    expect(result.status).toBe('discarded');
    expect(getConversation({ checkoutPath: repoA, conversationId: conv.id }, { db })).toBeNull();
  });

  it('8. ocupada: dos envíos a la misma conversación a la vez -> el segundo devuelve failed / busy', async () => {
    const conv = createConversation({ checkoutPath: repoA, title: 'Conversación ocupada' }, { db });

    const deps = createMockDeps({
      runText: async () => {
        await new Promise((r) => setTimeout(r, 60));
        return {
          text: 'Respuesta lenta',
          finishReason: 'stop',
          usage: null,
          label: 'LM Studio · qwen',
          providerId: 'lmstudio',
          modelId: 'qwen',
        };
      },
    });

    const p1 = sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-busy-1',
        conversationId: conv.id,
        viewId: null,
        question: 'Pregunta 1',
        selection: { kind: 'none' },
      },
      deps,
    );

    // Intentar segundo envío inmediatamente a la misma conversación
    const res2 = await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-busy-2',
        conversationId: conv.id,
        viewId: null,
        question: 'Pregunta 2 simultánea',
        selection: { kind: 'none' },
      },
      deps,
    );

    expect(res2.status).toBe('failed');
    if (res2.status === 'failed') {
      expect(res2.reason).toBe('busy');
    }

    const res1 = await p1;
    expect(res1.status).toBe('answered');
  });

  it('9. presupuesto: con una conversación de 30 mensajes de 1000 caracteres, el user que recibe runText mide menos de ASSIST_HISTORY_CHAR_BUDGET + 2000 y contiene la pregunta nueva y el mensaje más reciente, pero no el primero', async () => {
    const conv = createConversation({ checkoutPath: repoA, title: 'Conversación larga' }, { db });

    // Insertar 30 mensajes de 1000 caracteres
    for (let i = 1; i <= 30; i++) {
      const padding = 'X'.repeat(970);
      appendMessage(
        {
          checkoutPath: repoA,
          conversationId: conv.id,
          role: i % 2 === 1 ? 'user' : 'assistant',
          text: `Mensaje número ${i} ${padding}`,
        },
        { db },
      );
    }

    let capturedUser = '';
    const deps = createMockDeps({
      runText: async (_model, req) => {
        capturedUser = req.user;
        return {
          text: 'Ok',
          finishReason: 'stop',
          usage: null,
          label: 'LM Studio · qwen',
          providerId: 'lmstudio',
          modelId: 'qwen',
        };
      },
    });

    const result = await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-budget',
        conversationId: conv.id,
        viewId: null,
        question: 'Nueva pregunta final',
        selection: { kind: 'none' },
      },
      deps,
    );

    expect(result.status).toBe('answered');
    expect(capturedUser.length).toBeLessThan(ASSIST_HISTORY_CHAR_BUDGET + 2000);
    expect(capturedUser).toContain('Nueva pregunta final');
    expect(capturedUser).toContain('Mensaje número 30');
    expect(capturedUser).not.toContain('Mensaje número 1 ');
  });

  it('10. una sola elección: resolveModel se llama con el root y siempre para el mismo uso, venga de la vista que venga', async () => {
    const resolveModelMock = vi.fn().mockReturnValue({
      status: 'resolved',
      use: 'gitcron-assist',
      resolved: {
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen-2.5',
        family: 'openai-compatible',
        destination: 'this-machine',
        provenance: { from: 'general' },
      },
      alternatives: [],
    });

    const deps = createMockDeps({ resolveModel: resolveModelMock });

    await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-view-1',
        conversationId: null,
        viewId: 'graph',
        question: 'Pregunta desde Graph',
        selection: { kind: 'none' },
      },
      deps,
    );

    await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-view-2',
        conversationId: null,
        viewId: 'sdd',
        question: 'Pregunta desde SDD',
        selection: { kind: 'none' },
      },
      deps,
    );

    expect(resolveModelMock).toHaveBeenCalledTimes(2);
    expect(resolveModelMock).toHaveBeenNthCalledWith(1, repoA);
    expect(resolveModelMock).toHaveBeenNthCalledWith(2, repoA);
  });

  it('11. sin contenido del repo: el user no contiene el texto de un archivo que existe en el repo de prueba', async () => {
    const secretContent = 'SUPER_SECRET_REPO_FILE_CONTENT_XYZ_987654321';
    fs.writeFileSync(path.join(repoA, 'archivo-privado.txt'), secretContent, 'utf8');

    let capturedUser = '';
    const deps = createMockDeps({
      runText: async (_model, req) => {
        capturedUser = req.user;
        return {
          text: 'Ok',
          finishReason: 'stop',
          usage: null,
          label: 'LM Studio · qwen',
          providerId: 'lmstudio',
          modelId: 'qwen',
        };
      },
    });

    const result = await sendAssistMessage(
      {
        repoPath: repoA,
        requestId: 'req-no-file-content',
        conversationId: null,
        viewId: 'graph',
        question: '¿Qué podés decirme?',
        selection: { kind: 'file', path: 'archivo-privado.txt', at: 'worktree', takenAtHead: '123' },
      },
      deps,
    );

    expect(result.status).toBe('answered');
    expect(capturedUser).not.toContain(secretContent);
  });
  it('el modelo recibe el nombre del repo, no la ruta del disco', async () => {
    let sentUser = '';
    const deps = createMockDeps({
      runText: async (_m, req) => {
        sentUser = req.user;
        return { text: 'ok', finishReason: 'stop', usage: null, label: 'x', providerId: 'lmstudio', modelId: 'qwen-2.5' };
      },
    });
    await sendAssistMessage({ repoPath: repoA, requestId: 'req-ruta', conversationId: null, viewId: null, question: 'hola', selection: { kind: 'none' } }, deps);
    expect(sentUser).toContain(path.basename(repoA));
    expect(sentUser).not.toContain(repoA);
  });

  it('un identificador de pedido ya en curso se rechaza, y el primero sigue cancelable', async () => {
    let release: () => void = () => undefined;
    const deps = createMockDeps({
      runText: (_m, req) => new Promise((resolve, reject) => {
        req.signal?.addEventListener('abort', () => reject(new Error('abort')));
        release = () => resolve({ text: 'ok', finishReason: 'stop', usage: null, label: 'x', providerId: 'lmstudio', modelId: 'qwen-2.5' });
      }),
    });
    const first = sendAssistMessage({ repoPath: repoA, requestId: 'req-dup', conversationId: null, viewId: null, question: 'uno', selection: { kind: 'none' } }, deps);
    await new Promise((r) => setTimeout(r, 0));
    const second = await sendAssistMessage({ repoPath: repoA, requestId: 'req-dup', conversationId: null, viewId: null, question: 'dos', selection: { kind: 'none' } }, deps);
    expect(second.status).toBe('failed');
    expect(cancelAssistMessage('req-dup')).toBe(true);
    expect((await first).status).toBe('cancelled');
    release();
  });

  it('una respuesta que queda vacía al sanearla se descarta, y un error real al guardar no se esconde', async () => {
    const empty = createMockDeps({
      runText: async () => ({ text: '<think>sólo razonamiento</think>', finishReason: 'stop', usage: null, label: 'x', providerId: 'lmstudio', modelId: 'qwen-2.5' }),
    });
    const r1 = await sendAssistMessage({ repoPath: repoA, requestId: 'req-vacia', conversationId: null, viewId: null, question: 'hola', selection: { kind: 'none' } }, empty);
    expect(r1.status).toBe('discarded');

    const broken = createMockDeps({
      runText: async () => {
        db.exec('DROP TABLE assist_message');
        return { text: 'ok', finishReason: 'stop', usage: null, label: 'x', providerId: 'lmstudio', modelId: 'qwen-2.5' };
      },
    });
    const r2 = await sendAssistMessage({ repoPath: repoA, requestId: 'req-rota', conversationId: null, viewId: null, question: 'hola', selection: { kind: 'none' } }, broken);
    expect(r2.status).toBe('failed');
  });

  it('la respuesta guarda durationMs (>= 0), las fichas del usage simulado y contextLength del modelo resuelto', async () => {
    const deps = createMockDeps({
      resolveModel: () => ({
        status: 'resolved',
        use: 'gitcron-assist',
        resolved: {
          providerId: 'lmstudio',
          providerName: 'LM Studio',
          modelId: 'qwen-2.5',
          kind: 'openai-compatible',
          destination: 'this-machine',
          sourceFile: 'gitcron.json',
          available: true,
          contextLength: 64000,
          provenance: { sourceFile: 'gitcron.json', model: 'qwen-2.5', options: {}, headers: {} },
        },
        alternatives: [],
      }),
      runText: async () => ({
        text: 'Respuesta con uso medido.',
        finishReason: 'stop',
        usage: {
          promptTokens: 350,
          cachedPromptTokens: 120,
          completionTokens: 200,
          reasoningTokens: 60,
        },
        label: 'LM Studio · qwen-2.5',
        providerId: 'lmstudio',
        modelId: 'qwen-2.5',
      }),
    });

    const res = await sendAssistMessage(
      { repoPath: repoA, requestId: 'req-usage-1', conversationId: null, viewId: 'graph', question: 'medir', selection: { kind: 'none' } },
      deps,
    );

    expect(res.status).toBe('answered');
    if (res.status !== 'answered') return;
    expect(res.answer.usage).not.toBeNull();
    expect(res.answer.usage!.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.answer.usage!.contextLength).toBe(64000);
    expect(res.answer.usage!.promptTokens).toBe(350);
    expect(res.answer.usage!.cachedPromptTokens).toBe(120);
    expect(res.answer.usage!.completionTokens).toBe(200);
    expect(res.answer.usage!.reasoningTokens).toBe(60);
  });

  it('con usage: null del servidor, las fichas quedan null pero durationMs y contextLength se guardan', async () => {
    const deps = createMockDeps({
      resolveModel: () => ({
        status: 'resolved',
        use: 'gitcron-assist',
        resolved: {
          providerId: 'lmstudio',
          providerName: 'LM Studio',
          modelId: 'qwen-2.5',
          kind: 'openai-compatible',
          destination: 'this-machine',
          sourceFile: 'gitcron.json',
          available: true,
          contextLength: 128000,
          provenance: { sourceFile: 'gitcron.json', model: 'qwen-2.5', options: {}, headers: {} },
        },
        alternatives: [],
      }),
      runText: async () => ({
        text: 'Respuesta sin usage del servidor.',
        finishReason: 'stop',
        usage: null,
        label: 'LM Studio · qwen-2.5',
        providerId: 'lmstudio',
        modelId: 'qwen-2.5',
      }),
    });

    const res = await sendAssistMessage(
      { repoPath: repoA, requestId: 'req-usage-null', conversationId: null, viewId: 'graph', question: 'sin fichas', selection: { kind: 'none' } },
      deps,
    );

    expect(res.status).toBe('answered');
    if (res.status !== 'answered') return;
    expect(res.answer.usage).not.toBeNull();
    expect(res.answer.usage!.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.answer.usage!.contextLength).toBe(128000);
    expect(res.answer.usage!.promptTokens).toBeNull();
    expect(res.answer.usage!.cachedPromptTokens).toBeNull();
    expect(res.answer.usage!.completionTokens).toBeNull();
    expect(res.answer.usage!.reasoningTokens).toBeNull();
  });
});
