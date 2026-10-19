import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openTemporalAgentDatabase } from '../db/connection';
import * as authRepos from '../ipc/authorized-repos';
import * as startCmdModule from '../carto/screen-capture/start-command';
import * as cartoScreensIpc from '../ipc/carto-screens';
import * as contentKeyModule from '../carto/screen-capture/content-key';
import * as recipesModule from '../carto/screen-capture/recipes';
import * as viewRunnerModule from '../carto/screen-capture/view-runner';
import {
  handleCartoCapturesConsent,
  handleCartoCapturesRun,
  handleCartoCapturesGet,
} from '../ipc/carto-captures';
import {
  getCaptureConsent,
  setCaptureConsent,
  upsertScreenCapture,
} from '../db/carto-captures';
import type { ScreenMap } from '../../types/screen-map';

describe('carto-captures IPC handlers', () => {
  let db: DatabaseSync;
  const repoRoot = '/authorized/repo';

  beforeEach(() => {
    db = openTemporalAgentDatabase(':memory:');
    vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue(repoRoot);
    vi.spyOn(recipesModule, 'readRecipes').mockResolvedValue(null);
    vi.spyOn(viewRunnerModule, 'viewRunnerAvailable').mockReturnValue(false);
  });

  it('consent con una orden distinta de la detectada falla y no guarda', async () => {
    vi.spyOn(startCmdModule, 'detectStartCommand').mockResolvedValue({
      executable: 'npm',
      args: ['run', 'dev'],
      portViaEnv: true,
      display: 'npm run dev',
    });

    const result = await handleCartoCapturesConsent(
      { repoPath: repoRoot, command: 'pnpm run dev' },
      { db },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/la orden cambió; volvé a revisarla/i);

    const saved = getCaptureConsent(repoRoot, { db });
    expect(saved).toBeNull();
  });

  it('con recetas, el permiso pide la orden con las vistas', async () => {
    vi.spyOn(startCmdModule, 'detectStartCommand').mockResolvedValue({
      executable: 'npm',
      args: ['run', 'dev'],
      portViaEnv: true,
      display: 'npm run dev',
    });

    vi.spyOn(recipesModule, 'readRecipes').mockResolvedValue({
      ok: true,
      recipes: {
        version: 1,
        runner: { kind: 'e2e', config: 'e2e/e2e.config.ts', testsDir: 'e2e/tests' },
        setup: [],
        screens: {},
      },
    });
    vi.spyOn(viewRunnerModule, 'viewRunnerAvailable').mockReturnValue(true);

    const result = await handleCartoCapturesGet({ repoPath: repoRoot }, { db });

    expect(result.success).toBe(true);
    expect(result.data?.consent.status).toBe('needs-consent');
    if (result.data?.consent.status !== 'unsupported') {
      expect(result.data?.consent.command).toBe(
        'npm run dev · vistas con pruebas: e2e (e2e/e2e.config.ts)',
      );
    }
    expect(result.data?.viewsRunner).toBe('e2e (e2e/e2e.config.ts)');
    expect(result.data?.hasRecipes).toBe(true);
    expect(result.data?.runnerConfig).toBe('e2e/e2e.config.ts');
  });

  it('run sin permiso vigente falla', async () => {
    vi.spyOn(startCmdModule, 'detectStartCommand').mockResolvedValue({
      executable: 'npm',
      args: ['run', 'dev'],
      portViaEnv: true,
      display: 'npm run dev',
    });

    // Sin consent guardado en la db
    const result = await handleCartoCapturesRun(
      { repoPath: repoRoot },
      undefined,
      { db },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no hay permiso vigente/i);
  });

  it('una vista sin receta queda no-recipe', async () => {
    const fullCommand = 'npm run dev · vistas con pruebas: e2e (e2e/e2e.config.ts)';
    vi.spyOn(startCmdModule, 'detectStartCommand').mockResolvedValue({
      executable: 'npm',
      args: ['run', 'dev'],
      portViaEnv: true,
      display: 'npm run dev',
    });
    vi.spyOn(recipesModule, 'readRecipes').mockResolvedValue({
      ok: true,
      recipes: {
        version: 1,
        runner: { kind: 'e2e', config: 'e2e/e2e.config.ts', testsDir: 'e2e/tests' },
        setup: [],
        screens: {
          'view:with-recipe': { steps: [] },
        },
      },
    });
    vi.spyOn(viewRunnerModule, 'viewRunnerAvailable').mockReturnValue(true);

    // Conceder permiso
    setCaptureConsent(repoRoot, fullCommand, { db });

    const mockMap: ScreenMap = {
      repoPath: repoRoot,
      headSha: 'head1',
      detectors: ['views'],
      coverage: { state: 'complete' },
      readAt: '2026-10-19T12:00:00Z',
      screens: [
        {
          id: 'view:without-recipe',
          kind: 'view',
          name: 'Sin Receta',
          locator: 'activeTab=Orphan',
          declaredIn: 'components/View.tsx',
          description: null,
          files: [],
          tags: [],
          primaryTag: null,
          stats: { byRole: {}, lastChangedAt: null },
        },
      ],
    };

    vi.spyOn(cartoScreensIpc, 'getCachedScreenMap').mockReturnValue(mockMap);

    const fakeRouteRunner = async () => ({ captured: 0, skipped: [], cancelled: false });
    const fakeViewRunner = async () => ({ images: new Map(), failed: [] });

    const result = await handleCartoCapturesRun(
      { repoPath: repoRoot },
      undefined,
      { db },
      fakeRouteRunner as any,
      fakeViewRunner as any,
    );

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toContainEqual({
      screenId: 'view:without-recipe',
      reason: 'no-recipe',
    });
  });

  it('el avance va por el canal: plan, un item por cambio y finished', async () => {
    const fullCommand = 'npm run dev · vistas con pruebas: e2e (e2e/e2e.config.ts)';
    vi.spyOn(startCmdModule, 'detectStartCommand').mockResolvedValue({
      executable: 'npm',
      args: ['run', 'dev'],
      portViaEnv: true,
      display: 'npm run dev',
    });
    vi.spyOn(recipesModule, 'readRecipes').mockResolvedValue({
      ok: true,
      recipes: {
        version: 1,
        runner: { kind: 'e2e', config: 'e2e/e2e.config.ts', testsDir: 'e2e/tests' },
        setup: [],
        screens: { 'view:graph': { steps: [] } },
      },
    });
    vi.spyOn(viewRunnerModule, 'viewRunnerAvailable').mockReturnValue(true);
    vi.spyOn(contentKeyModule, 'screenContentKey').mockResolvedValue('key-1');
    setCaptureConsent(repoRoot, fullCommand, { db });

    const screenBase = {
      description: null,
      files: [],
      tags: [],
      primaryTag: null,
      stats: { byRole: {}, lastChangedAt: null },
    };
    const mockMap: ScreenMap = {
      repoPath: repoRoot,
      headSha: 'head1',
      detectors: ['next-app-router', 'views'],
      coverage: { state: 'complete' },
      readAt: '2026-10-19T12:00:00Z',
      screens: [
        { ...screenBase, id: 'route:/settings', kind: 'route', name: 'Ajustes', locator: '/settings', declaredIn: 'app/settings/page.tsx' },
        { ...screenBase, id: 'view:graph', kind: 'view', name: 'Graph', locator: 'activeTab=graph', declaredIn: 'components/RepoMainView.tsx' },
        { ...screenBase, id: 'view:orphan', kind: 'view', name: 'Huérfana', locator: 'activeTab=orphan', declaredIn: 'components/RepoMainView.tsx' },
      ],
    };
    vi.spyOn(cartoScreensIpc, 'getCachedScreenMap').mockReturnValue(mockMap);

    const fakeRouteRunner = async (
      _map: ScreenMap,
      _deps: unknown,
      opts: { onScreen?(id: string, state: 'running' | 'done' | 'failed', detail?: string): void },
    ) => {
      opts.onScreen?.('route:/settings', 'running');
      opts.onScreen?.('route:/settings', 'done');
      return { captured: 1, skipped: [], cancelled: false };
    };
    const fakeViewRunner = async (
      _root: string,
      _recipes: unknown,
      _screens: unknown,
      opts: { onEvent?(e: { screenId: string; state: 'running' | 'done' | 'failed'; detail?: string }): void },
    ) => {
      opts.onEvent?.({ screenId: 'view:graph', state: 'running' });
      opts.onEvent?.({ screenId: 'view:graph', state: 'failed', detail: 'paso 1: no está' });
      return { images: new Map(), failed: [{ screenId: 'view:graph', detail: 'paso 1: no está' }] };
    };

    const sent: unknown[] = [];
    const sender = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        if (channel === 'carto-captures:progress') sent.push(payload);
      },
    };

    const result = await handleCartoCapturesRun(
      { repoPath: repoRoot },
      { sender } as any,
      { db },
      fakeRouteRunner as any,
      fakeViewRunner as any,
    );

    expect(result.success).toBe(true);
    expect(sent).toEqual([
      {
        repoPath: repoRoot,
        kind: 'plan',
        items: [
          { screenId: 'route:/settings', name: 'Ajustes', via: 'route', state: 'pending' },
          { screenId: 'view:graph', name: 'Graph', via: 'view', state: 'pending' },
          {
            screenId: 'view:orphan',
            name: 'Huérfana',
            via: 'view',
            state: 'skipped',
            detail: 'sin receta en .gitcron/capturas.json',
          },
        ],
      },
      { repoPath: repoRoot, kind: 'item', screenId: 'route:/settings', state: 'running' },
      { repoPath: repoRoot, kind: 'item', screenId: 'route:/settings', state: 'done' },
      { repoPath: repoRoot, kind: 'item', screenId: 'view:graph', state: 'running' },
      { repoPath: repoRoot, kind: 'item', screenId: 'view:graph', state: 'failed', detail: 'paso 1: no está' },
      { repoPath: repoRoot, kind: 'finished' },
    ]);
  });

  it('get marca stale cuando cambia la clave de contenido', async () => {
    vi.spyOn(startCmdModule, 'detectStartCommand').mockResolvedValue({
      executable: 'npm',
      args: ['run', 'dev'],
      portViaEnv: true,
      display: 'npm run dev',
    });

    const mockMap: ScreenMap = {
      repoPath: repoRoot,
      headSha: 'head1',
      detectors: ['next-app-router'],
      coverage: { state: 'complete' },
      readAt: '2026-10-16T12:00:00Z',
      screens: [
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
      ],
    };

    vi.spyOn(cartoScreensIpc, 'getCachedScreenMap').mockReturnValue(mockMap);

    // Guardar una captura previa con clave antigua
    upsertScreenCapture(
      {
        repoPath: repoRoot,
        screenId: 'route:/dashboard',
        contentKey: 'old-content-key',
        image: Buffer.from('fake-jpeg-data'),
      },
      { db },
    );

    // El cálculo actual devuelve una clave nueva
    vi.spyOn(contentKeyModule, 'screenContentKey').mockResolvedValue('new-content-key');

    const result = await handleCartoCapturesGet({ repoPath: repoRoot }, { db });

    expect(result.success).toBe(true);
    expect(result.data?.captures['route:/dashboard']).toBeDefined();
    expect(result.data?.captures['route:/dashboard'].stale).toBe(true);
    expect(result.data?.captures['route:/dashboard'].dataUrl).toContain('data:image/jpeg;base64,');
  });
});
