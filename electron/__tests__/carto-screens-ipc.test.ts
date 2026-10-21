import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  clearScreenMapCache,
  handleCartoScreensGet,
  handleCartoScreensManual,
} from '../ipc/carto-screens';
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
    clearScreenMapCache();

    // Mock buildScreenMap
    const buildModule = await import('../carto/screen-map/build');
    let buildCalls = 0;
    vi.spyOn(buildModule, 'buildScreenMap').mockImplementation(async () => {
      buildCalls++;
      return {
        repoPath: '/authorized/repo',
        screens: [],
        detectors: ['next-app-router'],
        coverage: { state: 'complete' as const },
        pending: [],
        readAt: '2026-10-16T12:00:00Z',
        headSha: 'mock-sha',
      };
    });

    // Mock graph status
    const graphEngine = await import('../carto/graph-engine');
    vi.spyOn(graphEngine, 'getGraphStatus').mockReturnValue({
      state: 'ready',
      stats: { files: 10, nodes: 20, edges: 15 },
      lastIndexedAt: '2026-10-16T12:00:00Z',
    } as any);

    const mockDeps = {
      listFiles: async () => ({ paths: [], truncated: false }),
      readFile: async () => null,
      statFile: async () => null,
      fileDependencies: () => [],
      headSha: async () => 'mock-sha',
      now: () => '2026-10-16T12:00:00Z',
      readManual: async () => ({ version: 1 as const, links: [], descriptions: {} }),
    };

    const res1 = await handleCartoScreensGet({ repoPath: '/authorized/repo' }, mockDeps);
    expect(res1.success).toBe(true);
    expect(buildCalls).toBe(1);

    const res2 = await handleCartoScreensGet({ repoPath: '/authorized/repo' }, mockDeps);
    expect(res2.success).toBe(true);
    expect(buildCalls).toBe(1); // No volvió a llamar a buildScreenMap
  });

  describe('con repo temporal en disco', () => {
    async function createTempRepo(): Promise<string> {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'carto-ipc-'));
      return tmp;
    }

    it('manual escribe el archivo, y borrar lo último lo elimina', async () => {
      const repoDir = await createTempRepo();
      vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue(repoDir);
      clearScreenMapCache();

      const manualFilePath = path.join(repoDir, '.gitcron', 'pantallas.json');

      // 1. Agregar un vínculo
      const resAdd = await handleCartoScreensManual({
        repoPath: repoDir,
        op: {
          type: 'link',
          screenId: 'view:settings',
          path: 'lib/store.ts',
          action: 'add',
        },
      });
      expect(resAdd.success).toBe(true);

      const existsAfterAdd = await fs
        .stat(manualFilePath)
        .then(() => true)
        .catch(() => false);
      expect(existsAfterAdd).toBe(true);

      const contentAfterAdd = await fs.readFile(manualFilePath, 'utf8');
      expect(contentAfterAdd).toContain('view:settings');
      expect(contentAfterAdd).toContain('lib/store.ts');

      // 2. Borrar lo último (unlink)
      const resUnlink = await handleCartoScreensManual({
        repoPath: repoDir,
        op: {
          type: 'unlink',
          screenId: 'view:settings',
          path: 'lib/store.ts',
        },
      });
      expect(resUnlink.success).toBe(true);

      const existsAfterUnlink = await fs
        .stat(manualFilePath)
        .then(() => true)
        .catch(() => false);
      expect(existsAfterUnlink).toBe(false);

      await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('una ruta con .. falla', async () => {
      const repoDir = await createTempRepo();
      vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue(repoDir);

      const res = await handleCartoScreensManual({
        repoPath: repoDir,
        op: {
          type: 'link',
          screenId: 'view:settings',
          path: '../secret.ts',
          action: 'add',
        },
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/\.\.|fuera del repositorio/i);

      await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('con el archivo roto, la escritura se niega y el archivo queda igual', async () => {
      const repoDir = await createTempRepo();
      vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue(repoDir);

      const dotGitcron = path.join(repoDir, '.gitcron');
      await fs.mkdir(dotGitcron, { recursive: true });
      const manualFilePath = path.join(dotGitcron, 'pantallas.json');
      const brokenContent = '{ json roto';
      await fs.writeFile(manualFilePath, brokenContent, 'utf8');

      const res = await handleCartoScreensManual({
        repoPath: repoDir,
        op: {
          type: 'describe',
          screenId: 'view:settings',
          text: 'Nueva descripción',
        },
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('El archivo .gitcron/pantallas.json tiene un error');

      // El archivo no se pisó
      const contentAfter = await fs.readFile(manualFilePath, 'utf8');
      expect(contentAfter).toBe(brokenContent);

      await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('la clave de la caché cambia al cambiar el archivo', async () => {
      const repoDir = await createTempRepo();
      vi.spyOn(authRepos, 'authorizedRepoRoot').mockReturnValue(repoDir);
      clearScreenMapCache();

      let buildCount = 0;
      const fakeBuilder = async () => {
        buildCount++;
        return {
          repoPath: repoDir,
          screens: [],
          detectors: [],
          coverage: { state: 'complete' as const },
          pending: [],
          readAt: '2026-10-20T12:00:00Z',
          headSha: 'head-sha',
        };
      };

      const dotGitcron = path.join(repoDir, '.gitcron');
      await fs.mkdir(dotGitcron, { recursive: true });
      const manualFilePath = path.join(dotGitcron, 'pantallas.json');

      await fs.writeFile(
        manualFilePath,
        JSON.stringify({ version: 1, links: [], descriptions: { 's1': { text: 'v1', updatedAt: '2026' } } }),
        'utf8',
      );

      // Primera lectura
      const res1 = await handleCartoScreensGet({ repoPath: repoDir }, undefined, fakeBuilder as any);
      expect(res1.success).toBe(true);
      expect(buildCount).toBe(1);

      // Segunda lectura sin cambios -> caché
      const res2 = await handleCartoScreensGet({ repoPath: repoDir }, undefined, fakeBuilder as any);
      expect(res2.success).toBe(true);
      expect(buildCount).toBe(1);

      // Modificamos el archivo en disco
      await fs.writeFile(
        manualFilePath,
        JSON.stringify({ version: 1, links: [], descriptions: { 's1': { text: 'v2 modificado', updatedAt: '2026' } } }),
        'utf8',
      );

      // Tercera lectura -> detecta cambio de hash y reconstruye
      const res3 = await handleCartoScreensGet({ repoPath: repoDir }, undefined, fakeBuilder as any);
      expect(res3.success).toBe(true);
      expect(buildCount).toBe(2);

      await fs.rm(repoDir, { recursive: true, force: true });
    });
  });
});

