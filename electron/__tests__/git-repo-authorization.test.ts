import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDir } from '@/test-utils/temp-dir';
import { simpleGit } from 'simple-git';
import { authorizedRepoStore } from '../ipc/authorized-repos';

type IpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

const mockIpc = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  handle: vi.fn((channel: string, handler: IpcHandler) => {
    mockIpc.handlers.set(channel, handler);
  }),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpc.handle },
  dialog: {},
}));

describe('git-repo IPC — autorización de repositorios (sonda vs apertura)', () => {
  let tempRoot: string;
  let handler: (channel: string) => IpcHandler;
  let registerOpenSpecIpcHandlers: typeof import('../ipc/pipeline-openspec').registerOpenSpecIpcHandlers;

  // Cargar el módulo de OpenSpec es preparación, no lo que se prueba, y cuesta ~0,9 s:
  // dentro de la prueba de revocación se comía la mitad de su tope de 5 s, y bajo la
  // suite completa la hacía fallar por tiempo (medido el 2026-10-01).
  beforeAll(async () => {
    ({ registerOpenSpecIpcHandlers } = await import('../ipc/pipeline-openspec'));
  });

  const makeRepo = async (name: string): Promise<string> => {
    const repoDir = path.join(tempRoot, name);
    fs.mkdirSync(repoDir, { recursive: true });
    await simpleGit(repoDir).init(['--initial-branch=main']);
    return repoDir;
  };

  beforeEach(async () => {
    mockIpc.handlers.clear();
    mockIpc.handle.mockClear();
    authorizedRepoStore.clear();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-authz-ipc-'));
    const { registerGitRepoHandlers } = await import('../ipc/git-repo');
    registerGitRepoHandlers();
    handler = (channel: string) => {
      const h = mockIpc.handlers.get(channel);
      if (!h) throw new Error(`No handler registered for channel: ${channel}`);
      return h;
    };
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    removeTempDir(tempRoot);
  });

  it('la sonda git:check-repo-path comprueba sin conceder autorización', async () => {
    const repoDir = await makeRepo('sondado');

    const check = handler('git:check-repo-path');
    const result = await check(null, repoDir) as { success: boolean; data?: { isGitRepo: boolean } };
    expect(result.success).toBe(true);
    expect(result.data?.isGitRepo).toBe(true);

    // Sondado pero nunca abierto: NO queda autorizado.
    expect(authorizedRepoStore.isAuthorized(repoDir)).toBe(false);
  });

  it('la sonda clasifica carpetas inexistentes y no-repos sin autorizar', async () => {
    const check = handler('git:check-repo-path');

    const missing = await check(null, path.join(tempRoot, 'no-existe')) as { success: boolean; reason?: string };
    expect(missing.success).toBe(false);
    expect(missing.reason).toBe('missing');

    const notARepo = path.join(tempRoot, 'sin-git');
    fs.mkdirSync(notARepo);
    const notRepo = await check(null, notARepo) as { success: boolean; reason?: string };
    expect(notRepo.success).toBe(false);
    expect(notRepo.reason).toBe('not-a-repo');

    expect(authorizedRepoStore.getAuthorizedRoots()).toEqual([]);
  });

  it('abrir el mismo repo dos veces y cerrarlo una vez no deja autorización huérfana', async () => {
    const repoDir = await makeRepo('reabierto');
    const openPath = handler('git:open-path');

    const r1 = await openPath(null, repoDir) as { success: boolean };
    const r2 = await openPath(null, repoDir) as { success: boolean };
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // El renderer deduplica a una sola pestaña: la reapertura es idempotente.
    expect(authorizedRepoStore.getAuthorizedRoots().filter((root) => path.basename(root) === 'reabierto')).toHaveLength(1);

    const close = handler('git:close-repo');
    await close(null, repoDir);
    expect(authorizedRepoStore.isAuthorized(repoDir)).toBe(false);
  });

  it('cerrar la última pestaña revoca y los IPC de pipeline:openspec:* rechazan esa ruta', async () => {
    const repoDir = await makeRepo('revocado');
    const openPath = handler('git:open-path');
    const opened = await openPath(null, repoDir) as { success: boolean };
    expect(opened.success).toBe(true);

    // Registrar los handlers de openspec con DI y validar ANTES de cerrar.
    const openspecHandlers = new Map<string, IpcHandler>();
    registerOpenSpecIpcHandlers({
      ipcMain: { handle: (channel: string, listener: IpcHandler) => openspecHandlers.set(channel, listener) } as any,
      getUserDataDir: () => null,
      discoverCli: async () => ({
        installed: false,
        runtimeVersion: null,
        provenance: 'unknown',
        displayPath: null,
        supportedRange: { min: '1.5.0', max: '1.8.0' },
        versionClass: 'unknown',
        evidenceStatus: 'unknown',
        diagnostics: [],
      }),
      readGlobalConfig: async () => null,
      // Lo que se prueba es la autorización de la ruta, que queda real. El resto del
      // estado del motor —lista de herramientas por un proceso aparte, última versión en
      // npm, `doctor`, `context`— no cambia el resultado y costaba
      // 1,35 s de los 5 s de tope; reemplazado, 0,02 s (medido el 2026-10-01).
      checkLatest: async () => ({ status: 'unavailable' }) as any,
      readEngineToolReport: async () => ({
        source: 'gitcron-fallback',
        engineVersion: null,
        fallbackReason: 'package-not-found',
        tools: [],
        profileSyncNeeded: [],
      }) as any,
      runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }) as any,
      runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }) as any,
    });
    const statusHandler = openspecHandlers.get('pipeline:openspec:engine-status')!;
    const reopened = await openPath(null, repoDir) as { data?: { path?: string } };
    const activeRepo = reopened.data?.path ?? repoDir;
    await expect(statusHandler(null, { repoPath: activeRepo })).resolves.toBeDefined();

    const close = handler('git:close-repo');
    await close(null, repoDir);
    expect(authorizedRepoStore.isAuthorized(repoDir)).toBe(false);
    await expect(statusHandler(null, { repoPath: activeRepo })).rejects.toThrow('Invalid or unauthorized repository path');
  });

  it('worktree con .git como archivo autoriza y revoca igual', () => {
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-authz-worktree-'));
    try {
      // En un worktree .git es un archivo, no un directorio.
      fs.writeFileSync(path.join(worktreeDir, '.git'), 'gitdir: /path/to/main/.git/worktrees/test\n');

      const canonical = authorizedRepoStore.authorizeRepo(worktreeDir);
      expect(canonical).not.toBeNull();
      expect(authorizedRepoStore.isAuthorized(worktreeDir)).toBe(true);

      authorizedRepoStore.deauthorizeRepo(worktreeDir);
      expect(authorizedRepoStore.isAuthorized(worktreeDir)).toBe(false);
    } finally {
      try {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('git:init devuelve error explícito cuando la autorización falla, no éxito con ruta no autorizada', async () => {
    // Control positivo: el flujo normal autoriza y abre.
    const okParent = path.join(tempRoot, 'init-ok');
    fs.mkdirSync(okParent, { recursive: true });
    const ok = await handler('git:init')(null, okParent, 'repo-ok', false) as { success: boolean; data?: { path?: string } };
    expect(ok.success).toBe(true);
    expect(ok.data?.path).toBeDefined();
    expect(authorizedRepoStore.isAuthorized(path.join(okParent, 'repo-ok'))).toBe(true);

    // Fallo de autorización: el handler debe declararlo, no devolver éxito.
    const spy = vi.spyOn(authorizedRepoStore, 'authorizeRepo').mockReturnValue(null);
    try {
      const failParent = path.join(tempRoot, 'init-fail');
      fs.mkdirSync(failParent, { recursive: true });
      const result = await handler('git:init')(null, failParent, 'repo-fail', false) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain('No se pudo autorizar');
    } finally {
      spy.mockRestore();
    }
  });

  it('git:clone devuelve error explícito cuando la autorización falla', async () => {
    const srcRepo = await makeRepo('fuente-clon');
    const cloneParent = path.join(tempRoot, 'clone-dest');
    fs.mkdirSync(cloneParent, { recursive: true });

    const spy = vi.spyOn(authorizedRepoStore, 'authorizeRepo').mockReturnValue(null);
    try {
      const result = await handler('git:clone')(null, srcRepo, cloneParent, 'clon', undefined) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain('No se pudo autorizar');
    } finally {
      spy.mockRestore();
    }
  });
});
