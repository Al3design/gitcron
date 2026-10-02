import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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
    raw: vi.fn(async () => 'mock diff'),
  })),
}));

vi.mock('../git/repo-queue', () => ({
  withRepoLock: vi.fn(async (_path: string, fn: () => Promise<any>) => fn()),
}));

/**
 * Lo que contesta el servidor en cada pedido. Desde la tarea 4.3 la redacción va
 * por el proveedor de gitcron.json (acá, el `lmstudio` del archivo con el modelo
 * del selector), así que se simula `streamText`: recibe las opciones del pedido,
 * con su señal, y devuelve una redacción o un fallo.
 */
const mockDraftCommitSubject = vi.fn();
const mockFetchModelCatalog = vi.fn();

vi.mock('../ai/commit-message/local-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/commit-message/local-provider')>()),
  fetchModelCatalog: (...args: any[]) => mockFetchModelCatalog(...args),
  hasEnoughContext: () => true,
  loadLocalModel: vi.fn(),
  unloadLocalModel: vi.fn(),
}));

vi.mock('../ai/text-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/text-client')>()),
  streamText: async (_config: unknown, opts: any) => {
    const result = await mockDraftCommitSubject(opts);
    if (result.status !== 'drafted') throw new Error(result.detail ?? 'falló');
    return { text: result.subject, rawPayload: { choices: [{ message: { content: result.subject } }] } };
  },
}));

const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-cola-'));
const CONFIG_PATH = path.join(CONFIG_DIR, 'gitcron.json');
fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  provider: { lmstudio: { npm: '@ai-sdk/openai-compatible', name: 'LM Studio', options: { baseURL: 'http://localhost:1234/v1' } } },
}));

import {
  registerCommitMessageAiHandlers,
  resetDraftQueueForTesting,
  setCommitAiConfigPathForTesting,
} from '../ipc/commit-message-ai';

describe('commit-ai queue en proceso principal (tarea 2.4 / D16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    resetDraftQueueForTesting();
    setCommitAiConfigPathForTesting(CONFIG_PATH);
    registerCommitMessageAiHandlers();

    mockFetchModelCatalog.mockResolvedValue([
      {
        id: 'google/gemma-4-12b',
        displayName: 'Gemma 4 12B',
        loaded: true,
        loadedContextLength: 65536,
      },
    ]);
  });

  afterEach(() => {
    resetDraftQueueForTesting();
    setCommitAiConfigPathForTesting(null);
    vi.restoreAllMocks();
  });

  it('dos pedidos seguidos: el segundo queda en fila y no corta al primero; al terminar el primero corre el segundo', async () => {
    const draftHandler = handlers.get('commit-ai:draft')!;
    const sender = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    let resolveFirstDraft!: (val: any) => void;
    let resolveSecondDraft!: (val: any) => void;

    mockDraftCommitSubject
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstDraft = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondDraft = resolve; }));

    // Disparamos pedido 1 en repoA
    const p1 = draftHandler(
      { sender },
      {
        repoPath: 'C:/repoA',
        paths: ['a.ts'],
        model: 'google/gemma-4-12b',
        draftId: 'draft-1',
      },
    );

    // Verificamos que se notificó running para draft-1
    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-1',
      repoPath: 'C:/repoA',
      status: 'running',
      startedAt: expect.any(Number),
    });

    // Disparamos pedido 2 en repoB mientras el primero sigue en curso
    const p2 = draftHandler(
      { sender },
      {
        repoPath: 'C:/repoB',
        paths: ['b.ts'],
        model: 'google/gemma-4-12b',
        draftId: 'draft-2',
      },
    );

    // Verificamos que el segundo quedó en fila (queued) y nombra a repoA como el activo (sin tiempos)
    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-2',
      repoPath: 'C:/repoB',
      status: 'queued',
      activeRepoPath: 'C:/repoA',
    });

    // Esperamos que el primer pedido haya alcanzado la ejecución de la redacción
    await vi.waitFor(() => {
      expect(mockDraftCommitSubject).toHaveBeenCalledTimes(1);
    });

    // Resolvemos el primer pedido
    resolveFirstDraft({ status: 'drafted', subject: 'feat(a): commit a', model: 'google/gemma-4-12b' });
    const res1 = await p1;
    expect(res1).toEqual({
      success: true,
      data: { status: 'drafted', subject: 'feat(a): commit a', model: 'google/gemma-4-12b' },
    });

    // Primer pedido terminó (completed)
    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-1',
      repoPath: 'C:/repoA',
      status: 'completed',
      startedAt: expect.any(Number),
      finishedAt: expect.any(Number),
    });

    // Al terminar el primero, el segundo pasa a running
    await vi.waitFor(() => {
      expect(mockDraftCommitSubject).toHaveBeenCalledTimes(2);
    });
    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-2',
      repoPath: 'C:/repoB',
      status: 'running',
      startedAt: expect.any(Number),
    });

    // Resolvemos el segundo pedido
    resolveSecondDraft({ status: 'drafted', subject: 'fix(b): commit b', model: 'google/gemma-4-12b' });
    const res2 = await p2;
    expect(res2).toEqual({
      success: true,
      data: { status: 'drafted', subject: 'fix(b): commit b', model: 'google/gemma-4-12b' },
    });

    // Segundo pedido completado
    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-2',
      repoPath: 'C:/repoB',
      status: 'completed',
      startedAt: expect.any(Number),
      finishedAt: expect.any(Number),
    });

    // Comprobaciones de tiempos medidos en el proceso principal:
    // - startedAt <= finishedAt en ambos
    // - el segundo, que esperó en fila, tiene startedAt posterior (o igual) al finishedAt del primero
    // - el pedido mientras estuvo en fila no llevó tiempos
    const stateCalls = sender.send.mock.calls
      .filter((c: any[]) => c[0] === 'commit-ai:draft-state')
      .map((c: any[]) => c[1]);

    const d1Running = stateCalls.find((e: any) => e.draftId === 'draft-1' && e.status === 'running')!;
    const d1Completed = stateCalls.find((e: any) => e.draftId === 'draft-1' && e.status === 'completed')!;
    const d2Queued = stateCalls.find((e: any) => e.draftId === 'draft-2' && e.status === 'queued')!;
    const d2Running = stateCalls.find((e: any) => e.draftId === 'draft-2' && e.status === 'running')!;
    const d2Completed = stateCalls.find((e: any) => e.draftId === 'draft-2' && e.status === 'completed')!;

    expect(d1Running.startedAt).toBeDefined();
    expect(d1Completed.startedAt).toBe(d1Running.startedAt);
    expect(d1Completed.startedAt).toBeLessThanOrEqual(d1Completed.finishedAt);

    expect(d2Queued.startedAt).toBeUndefined();
    expect(d2Queued.finishedAt).toBeUndefined();

    expect(d2Running.startedAt).toBeDefined();
    expect(d2Completed.startedAt).toBe(d2Running.startedAt);
    expect(d2Completed.startedAt).toBeLessThanOrEqual(d2Completed.finishedAt);

    expect(d2Running.startedAt).toBeGreaterThanOrEqual(d1Completed.finishedAt);
  });

  it('cancelar el pedido que está en fila no toca al que está corriendo', async () => {
    const draftHandler = handlers.get('commit-ai:draft')!;
    const cancelHandler = handlers.get('commit-ai:cancel')!;
    const sender = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    let resolveFirstDraft!: (val: any) => void;
    mockDraftCommitSubject.mockImplementationOnce(() => new Promise((resolve) => { resolveFirstDraft = resolve; }));

    // Pedido 1 en repoA (corriendo)
    const p1 = draftHandler(
      { sender },
      {
        repoPath: 'C:/repoA',
        paths: ['a.ts'],
        model: 'google/gemma-4-12b',
        draftId: 'draft-1',
      },
    );

    // Pedido 2 en repoB (en fila)
    const p2 = draftHandler(
      { sender },
      {
        repoPath: 'C:/repoB',
        paths: ['b.ts'],
        model: 'google/gemma-4-12b',
        draftId: 'draft-2',
      },
    );

    // Esperamos que el primer pedido esté en ejecución
    await vi.waitFor(() => {
      expect(mockDraftCommitSubject).toHaveBeenCalledTimes(1);
    });

    // Cancelamos el pedido 2 con su draftId
    const cancelRes = await cancelHandler({}, 'draft-2');
    expect(cancelRes).toEqual({ success: true, data: { cancelled: true } });

    // p2 se resuelve como cancelado
    const res2 = await p2;
    expect(res2.data?.status).toBe('unavailable');
    expect(res2.data?.detail).toContain('cancelada');

    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-2',
      repoPath: 'C:/repoB',
      status: 'cancelled',
    });

    // Un pedido cancelado mientras estaba en fila no corrió: va sin tiempos
    const d2Cancelled = sender.send.mock.calls
      .filter((c: any[]) => c[0] === 'commit-ai:draft-state')
      .map((c: any[]) => c[1])
      .find((e: any) => e.draftId === 'draft-2' && e.status === 'cancelled')!;
    expect(d2Cancelled.startedAt).toBeUndefined();
    expect(d2Cancelled.finishedAt).toBeUndefined();

    // El pedido 1 sigue corriendo intacto
    expect(mockDraftCommitSubject).toHaveBeenCalledTimes(1);
    resolveFirstDraft({ status: 'drafted', subject: 'feat(a): commit a', model: 'google/gemma-4-12b' });
    const res1 = await p1;
    expect(res1.data?.status).toBe('drafted');
    expect(res1.data?.subject).toBe('feat(a): commit a');
  });

  it('cancelar sin draftId corta todo (en curso y en fila) como hoy', async () => {
    const draftHandler = handlers.get('commit-ai:draft')!;
    const cancelHandler = handlers.get('commit-ai:cancel')!;
    const sender = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    let abortSignalSeen: AbortSignal | null = null;
    mockDraftCommitSubject.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      abortSignalSeen = signal;
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          resolve({ status: 'unavailable', detail: 'Redacción cancelada.' });
        });
      });
    });

    // Pedido 1 en repoA
    const p1 = draftHandler(
      { sender },
      {
        repoPath: 'C:/repoA',
        paths: ['a.ts'],
        model: 'google/gemma-4-12b',
        draftId: 'draft-1',
      },
    );

    // Pedido 2 en repoB
    const p2 = draftHandler(
      { sender },
      {
        repoPath: 'C:/repoB',
        paths: ['b.ts'],
        model: 'google/gemma-4-12b',
        draftId: 'draft-2',
      },
    );

    // Esperamos que el primer pedido esté en ejecución
    await vi.waitFor(() => {
      expect(mockDraftCommitSubject).toHaveBeenCalledTimes(1);
    });

    // Cancelar sin argumentos corta todo
    const cancelRes = await cancelHandler({});
    expect(cancelRes).toEqual({ success: true, data: { cancelled: true } });

    expect(abortSignalSeen).toBeDefined();
    expect((abortSignalSeen as AbortSignal | null)?.aborted).toBe(true);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.data?.status).toBe('unavailable');
    expect(res2.data?.status).toBe('unavailable');

    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-1',
      repoPath: 'C:/repoA',
      status: 'cancelled',
    });
    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-2',
      repoPath: 'C:/repoB',
      status: 'cancelled',
    });
  });
});
