import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';

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

const mockDraftCommitSubject = vi.fn();
const mockFetchModelCatalog = vi.fn();

vi.mock('../ai/commit-message/local-provider', () => ({
  DEFAULT_LOCAL_BASE_URL: 'http://localhost:1234',
  DEFAULT_TTL_SECONDS: 600,
  MIN_CONTEXT_LENGTH: 16384,
  PREFERRED_CONTEXT_LENGTH: 65536,
  fetchModelCatalog: (...args: any[]) => mockFetchModelCatalog(...args),
  hasEnoughContext: () => true,
  draftCommitSubject: (...args: any[]) => mockDraftCommitSubject(...args),
  loadLocalModel: vi.fn(),
  unloadLocalModel: vi.fn(),
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
    setCommitAiConfigPathForTesting(os.tmpdir() + '/no-gitcron-config.json');
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

    // Verificamos que el segundo quedó en fila (queued) y nombra a repoA como el activo
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
    });

    // Al terminar el primero, el segundo pasa a running
    await vi.waitFor(() => {
      expect(mockDraftCommitSubject).toHaveBeenCalledTimes(2);
    });
    expect(sender.send).toHaveBeenCalledWith('commit-ai:draft-state', {
      draftId: 'draft-2',
      repoPath: 'C:/repoB',
      status: 'running',
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
    });
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
