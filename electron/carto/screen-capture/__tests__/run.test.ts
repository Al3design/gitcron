import { describe, expect, it, vi } from 'vitest';
import { runScreenCaptures, type CaptureRunDeps } from '../run';
import type { ScreenMap } from '../../../../types/screen-map';

describe('runScreenCaptures', () => {
  const sampleMap: ScreenMap = {
    repoPath: '/mock/repo',
    headSha: 'head123',
    detectors: ['next-app-router'],
    coverage: { state: 'complete' },
    readAt: '2026-10-16T12:00:00Z',
    screens: [
      {
        id: 'view:graph',
        kind: 'view',
        name: 'Graph',
        locator: 'activeTab=graph',
        declaredIn: 'components/RepoMainView.tsx',
        description: null,
        files: [],
        tags: [],
        primaryTag: null,
        stats: { byRole: {}, lastChangedAt: null },
      },
      {
        id: 'route:/users/[id]',
        kind: 'route',
        name: 'User Detail',
        locator: '/users/[id]',
        declaredIn: 'app/users/[id]/page.tsx',
        description: null,
        files: [],
        tags: [],
        primaryTag: null,
        stats: { byRole: {}, lastChangedAt: null },
      },
      {
        id: 'route:/dashboard',
        kind: 'route',
        name: 'Dashboard',
        locator: '/dashboard',
        declaredIn: 'app/dashboard/page.tsx',
        description: null,
        files: [],
        tags: [],
        primaryTag: null,
        stats: { byRole: {}, lastChangedAt: null },
      },
      {
        id: 'route:/settings',
        kind: 'route',
        name: 'Settings',
        locator: '/settings',
        declaredIn: 'app/settings/page.tsx',
        description: null,
        files: [],
        tags: [],
        primaryTag: null,
        stats: { byRole: {}, lastChangedAt: null },
      },
    ],
  };

  it('las vistas y las rutas con [ quedan en skipped', async () => {
    const stopFn = vi.fn();
    const deps: CaptureRunDeps = {
      startServer: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:3000', stop: stopFn }),
      capture: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
      contentKey: vi.fn().mockResolvedValue('key-new'),
      stored: vi.fn().mockResolvedValue(new Map()),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const res = await runScreenCaptures(sampleMap, deps);

    expect(res.skipped).toContainEqual({ screenId: 'view:graph', reason: 'view' });
    expect(res.skipped).toContainEqual({ screenId: 'route:/users/[id]', reason: 'dynamic-route' });
    expect(res.captured).toBe(2);
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it('si todas están al día, no se llama a startServer', async () => {
    const startServerFn = vi.fn();
    const deps: CaptureRunDeps = {
      startServer: startServerFn,
      capture: vi.fn(),
      contentKey: vi.fn().mockResolvedValue('key-same'),
      stored: vi.fn().mockResolvedValue(
        new Map([
          ['route:/dashboard', { contentKey: 'key-same' }],
          ['route:/settings', { contentKey: 'key-same' }],
        ]),
      ),
      save: vi.fn(),
    };

    const res = await runScreenCaptures(sampleMap, deps);

    expect(startServerFn).not.toHaveBeenCalled();
    expect(res.captured).toBe(0);
    expect(res.skipped).toEqual([
      { screenId: 'view:graph', reason: 'view' },
      { screenId: 'route:/users/[id]', reason: 'dynamic-route' },
    ]);
  });

  it('una captura que falla no corta las demás', async () => {
    const stopFn = vi.fn();
    const deps: CaptureRunDeps = {
      startServer: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:3000', stop: stopFn }),
      capture: vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/dashboard')) {
          throw new Error('Connection timeout');
        }
        return Buffer.from('fake-image');
      }),
      contentKey: vi.fn().mockResolvedValue('key-new'),
      stored: vi.fn().mockResolvedValue(new Map()),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const res = await runScreenCaptures(sampleMap, deps);

    expect(res.captured).toBe(1);
    expect(res.skipped).toContainEqual({ screenId: 'route:/dashboard', reason: 'timeout' });
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it('stop se llama también cuando capture tira error y cuando se cancela', async () => {
    const stopFn = vi.fn();
    const controller = new AbortController();

    const deps: CaptureRunDeps = {
      startServer: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:3000', stop: stopFn }),
      capture: vi.fn().mockImplementation(async () => {
        controller.abort();
        throw new Error('Aborted');
      }),
      contentKey: vi.fn().mockResolvedValue('key-new'),
      stored: vi.fn().mockResolvedValue(new Map()),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const res = await runScreenCaptures(sampleMap, deps, { signal: controller.signal });

    expect(res.cancelled).toBe(true);
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it('si el servidor no arranca, se devuelve error', async () => {
    const deps: CaptureRunDeps = {
      startServer: vi.fn().mockRejectedValue(new Error('Port already in use')),
      capture: vi.fn(),
      contentKey: vi.fn().mockResolvedValue('key-new'),
      stored: vi.fn().mockResolvedValue(new Map()),
      save: vi.fn(),
    };

    const res = await runScreenCaptures(sampleMap, deps);

    expect(res.captured).toBe(0);
    expect(res.error).toMatch(/Port already in use/);
  });

  it('onScreen avisa running y done por dirección, y failed cuando falla', async () => {
    const deps: CaptureRunDeps = {
      startServer: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:3000', stop: vi.fn() }),
      capture: vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/settings')) throw new Error('no cargó');
        return Buffer.from('fake-image');
      }),
      contentKey: vi.fn().mockResolvedValue('key-new'),
      stored: vi.fn().mockResolvedValue(new Map()),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const calls: string[] = [];

    await runScreenCaptures(sampleMap, deps, {
      onScreen: (screenId, state, detail) => calls.push(detail ? `${state} ${screenId} ${detail}` : `${state} ${screenId}`),
    });

    expect(calls).toEqual([
      'running route:/dashboard',
      'done route:/dashboard',
      'running route:/settings',
      'failed route:/settings no cargó',
    ]);
  });
});
