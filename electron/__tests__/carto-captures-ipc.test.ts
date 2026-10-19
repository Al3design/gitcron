import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openTemporalAgentDatabase } from '../db/connection';
import * as authRepos from '../ipc/authorized-repos';
import * as startCmdModule from '../carto/screen-capture/start-command';
import * as cartoScreensIpc from '../ipc/carto-screens';
import * as contentKeyModule from '../carto/screen-capture/content-key';
import {
  handleCartoCapturesConsent,
  handleCartoCapturesRun,
  handleCartoCapturesGet,
} from '../ipc/carto-captures';
import {
  getCaptureConsent,
  upsertScreenCapture,
} from '../db/carto-captures';
import type { ScreenMap } from '../../types/screen-map';

describe('carto-captures IPC handlers', () => {
  let db: DatabaseSync;
  const repoRoot = '/authorized/repo';

  beforeEach(() => {
    db = openTemporalAgentDatabase(':memory:');
    vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue(repoRoot);
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
