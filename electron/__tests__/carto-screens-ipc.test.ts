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
});
