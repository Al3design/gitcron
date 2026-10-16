import { describe, expect, it, vi } from 'vitest';
import { handleCartoScreensGet } from '../ipc/carto-screens';
import * as authRepos from '../ipc/authorized-repos';

describe('carto-screens IPC handler', () => {
  it('rechaza un repositorio no autorizado devolviendo success: false', async () => {
    vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue(null);

    const result = await handleCartoScreensGet({ repoPath: '/unauthorized/path' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no autorizado/i);
  });

  it('rechaza un payload con ruta vacía o inválida', async () => {
    vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue(null);

    const result = await handleCartoScreensGet('');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no autorizado/i);
  });

  it('dos llamadas consecutivas sin cambios devuelven el mapa desde caché sin reconstruir', async () => {
    vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue('/authorized/repo');
    const { clearScreenMapCache } = await import('../ipc/carto-screens');
    clearScreenMapCache();

    // Mock buildScreenMap
    const buildModule = await import('../carto/screen-map/build');
    let buildCalls = 0;
    vi.spyOn(buildModule, 'buildScreenMap').mockImplementation(async () => {
      buildCalls++;
      return {
        repoPath: '/repo',
        screens: [],
        detectors: ['next-app-router'],
        coverage: { state: 'complete' as const },
        readAt: '2026-10-16T12:00:00Z',
        headSha: 'mock-sha',
      };
    });

    // Mock graph status
    const graphEngine = await import('../carto/graph-engine');
    vi.spyOn(graphEngine, 'getGraphStatus').mockReturnValue({
      status: 'ready',
      indexedAt: '2026-10-16T12:00:00Z',
      indexedHead: 'mock-sha',
      fileCount: 10,
    } as any);

    const res1 = await handleCartoScreensGet({ repoPath: '/authorized/repo' });
    expect(res1.success).toBe(true);
    expect(buildCalls).toBe(1);

    const res2 = await handleCartoScreensGet({ repoPath: '/authorized/repo' });
    expect(res2.success).toBe(true);
    expect(buildCalls).toBe(1); // No volvió a llamar a buildScreenMap
  });
});

