import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDir } from '@/test-utils/temp-dir';
import { simpleGit } from 'simple-git';
import { authorizedRepoStore } from '../ipc/authorized-repos';
import type { PipelineState } from '../../types/pipeline';

type Handler = (_event: unknown, ...args: unknown[]) => unknown;

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  handle: vi.fn((channel: string, handler: Handler) => ipc.handlers.set(channel, handler)),
}));

vi.mock('electron', () => ({ ipcMain: { handle: ipc.handle } }));

const snapshot: PipelineState = {
  repoId: 'repo-1', revision: 1, observedAt: '2026-08-14T12:00:00.000Z', tasks: [], reports: [],
  activeChanges: [], archivedChanges: [], mergedChanges: [], diagnostics: [], decisions: [],
  selection: { changeId: null, confidence: 'unknown', selectionRequired: false, reason: 'no-active-change' },
};

/**
 * Candado de autorización sobre los canales `pipeline:*`. A diferencia de
 * `pipeline-ipc.test.ts` (que usa un doble del store), acá se ejercita el
 * store real: sin el chequeo de `isAuthorized` en `validRepoPath`, una ruta
 * bien formada llegaría al lector de evidencia.
 */
describe('Pipeline IPC — candado de autorización sobre pipeline:*', () => {
  let tempRoot: string;
  let repoDir: string;
  let refresh: ReturnType<typeof vi.fn>;

  const get = (channel: string): Handler => {
    const h = ipc.handlers.get(channel);
    if (!h) throw new Error(`No handler registered for channel: ${channel}`);
    return h;
  };

  beforeEach(async () => {
    ipc.handlers.clear();
    ipc.handle.mockClear();
    authorizedRepoStore.clear();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-pipeline-authz-'));
    repoDir = path.join(tempRoot, 'repo-vigilado');
    fs.mkdirSync(repoDir, { recursive: true });
    await simpleGit(repoDir).init(['--initial-branch=main']);

    refresh = vi.fn(async () => snapshot);
    const { registerPipelineHandlers } = await import('../ipc/pipeline');
    registerPipelineHandlers(() => null as never, { refresh } as never);
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    removeTempDir(tempRoot);
  });

  it('rechaza una ruta bien formada pero no autorizada en los tres canales, sin leer el repo', async () => {
    const event = { sender: { id: 1, once: vi.fn() } };

    // El repo existe y es una raíz Git válida: lo único que lo frena es que
    // nadie lo abrió/autorizó. Ese es exactamente el candado bajo prueba.
    await expect(get('pipeline:get-snapshot')(null, repoDir)).resolves.toEqual({
      success: false,
      error: 'Ruta de repositorio inválida o no autorizada',
    });
    await expect(get('pipeline:subscribe')(event, repoDir)).resolves.toEqual({
      success: false,
      error: 'Ruta de repositorio inválida o no autorizada',
    });
    // El handler de unsubscribe es sincrónico: devuelve el objeto directo.
    const unsubRejected = await get('pipeline:unsubscribe')(event, repoDir);
    expect(unsubRejected).toEqual({
      success: false,
      error: 'Ruta de repositorio inválida o no autorizada',
    });

    // El lector de evidencia no se invocó: el rechazo es del candado, no un
    // error de lectura disfrazado.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('la ruta autorizada pasa en los tres canales y llega al lector', async () => {
    const canonical = authorizedRepoStore.authorizeRepo(repoDir);
    expect(canonical).not.toBeNull();

    await expect(get('pipeline:get-snapshot')(null, repoDir)).resolves.toEqual({
      success: true,
      data: snapshot,
    });
    expect(refresh).toHaveBeenCalledWith(repoDir, null);

    const event = { sender: { id: 1, once: vi.fn() } };
    await expect(get('pipeline:subscribe')(event, repoDir)).resolves.toMatchObject({ success: true });
    const unsubOk = await get('pipeline:unsubscribe')(event, repoDir);
    expect(unsubOk).toEqual({ success: true });
  });

  it('al cerrar la última pestaña el canal vuelve a rechazar la ruta', async () => {
    authorizedRepoStore.authorizeRepo(repoDir);
    await expect(get('pipeline:get-snapshot')(null, repoDir)).resolves.toMatchObject({ success: true });

    authorizedRepoStore.deauthorizeRepo(repoDir);
    refresh.mockClear();
    await expect(get('pipeline:get-snapshot')(null, repoDir)).resolves.toMatchObject({ success: false });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('Pipeline Archive IPC — candado de autorización sobre pipeline:archive-*', () => {
  let tempRoot: string;
  let repoDir: string;
  let archiveSpy: ReturnType<typeof vi.fn>;
  let resolveBindingSpy: ReturnType<typeof vi.fn>;

  const get = (channel: string): Handler => {
    const h = ipc.handlers.get(channel);
    if (!h) throw new Error(`No handler registered for channel: ${channel}`);
    return h;
  };

  beforeEach(async () => {
    ipc.handlers.clear();
    ipc.handle.mockClear();
    authorizedRepoStore.clear();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-archive-authz-'));
    repoDir = path.join(tempRoot, 'repo-archive');
    fs.mkdirSync(repoDir, { recursive: true });
    await simpleGit(repoDir).init(['--initial-branch=main']);

    archiveSpy = vi.fn(async () => ({ ok: true, error: null }));
    resolveBindingSpy = vi.fn(async (p: string) => ({ repoId: 'r1', canonicalPath: fs.realpathSync(p) }));

    const { registerPipelineArchiveHandlers } = await import('../ipc/pipeline-archive');
    registerPipelineArchiveHandlers(() => null, archiveSpy as never, { resolveBinding: resolveBindingSpy } as never);
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    removeTempDir(tempRoot);
  });

  it('rechaza una ruta bien formada pero no autorizada en pipeline:archive-plan y pipeline:archive-change sin tocar CLI ni servicio', async () => {
    // 1. archive-plan sin autorización
    const planRes = await get('pipeline:archive-plan')(null, repoDir, 'mi-cambio');
    expect(planRes).toEqual({
      success: false,
      error: 'Ruta de repositorio inválida o no autorizada',
    });
    expect(resolveBindingSpy).not.toHaveBeenCalled();
    expect(archiveSpy).not.toHaveBeenCalled();

    // 2. archive-change sin autorización
    const changeRes = await get('pipeline:archive-change')(null, repoDir, 'mi-cambio');
    expect(changeRes).toEqual({
      success: false,
      error: 'Ruta de repositorio inválida o no autorizada',
    });
    expect(resolveBindingSpy).not.toHaveBeenCalled();
    expect(archiveSpy).not.toHaveBeenCalled();
  });

  it('la ruta autorizada pasa en ambos canales y ejecuta el CLI sobre la ruta canónica', async () => {
    const canonical = authorizedRepoStore.authorizeRepo(repoDir);
    expect(canonical).not.toBeNull();

    const planRes = await get('pipeline:archive-plan')(null, repoDir, 'mi-cambio');
    expect(planRes).toMatchObject({
      success: true,
      data: { archiveCommand: 'openspec archive mi-cambio --yes' },
    });
    expect(resolveBindingSpy).toHaveBeenCalledWith(repoDir);
    expect(archiveSpy).not.toHaveBeenCalled();

    resolveBindingSpy.mockClear();
    const changeRes = await get('pipeline:archive-change')(null, repoDir, 'mi-cambio');
    expect(changeRes).toEqual({ success: true });
    expect(resolveBindingSpy).toHaveBeenCalledWith(repoDir);
    expect(archiveSpy).toHaveBeenCalledWith(canonical, 'mi-cambio');
  });
});

describe('Pipeline Specs IPC — candado de autorización sobre pipeline:init-openspec, pipeline:read-specification y pipeline:write-artifact', () => {
  let tempRoot: string;
  let repoDir: string;
  let resolveBindingSpy: ReturnType<typeof vi.fn>;

  const get = (channel: string): Handler => {
    const h = ipc.handlers.get(channel);
    if (!h) throw new Error(`No handler registered for channel: ${channel}`);
    return h;
  };

  beforeEach(async () => {
    ipc.handlers.clear();
    ipc.handle.mockClear();
    authorizedRepoStore.clear();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-specs-authz-'));
    repoDir = path.join(tempRoot, 'repo-specs');
    fs.mkdirSync(repoDir, { recursive: true });
    await simpleGit(repoDir).init(['--initial-branch=main']);

    const specDir = path.join(repoDir, 'openspec', 'specs', 'mi-spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), '## Requisito\n\nEspecificación de prueba.', 'utf8');

    resolveBindingSpy = vi.fn(async (p: string) => ({ canonicalPath: fs.realpathSync(p) }));

    const { registerPipelineSpecHandlers } = await import('../ipc/pipeline-specs');
    registerPipelineSpecHandlers({ resolveBinding: resolveBindingSpy } as never);
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    removeTempDir(tempRoot);
  });

  it('rechaza una ruta no autorizada en pipeline:init-openspec, pipeline:read-specification y pipeline:write-artifact sin invocar binding ni lectura', async () => {
    const initRes = await get('pipeline:init-openspec')(null, repoDir, ['claude']);
    expect(initRes).toEqual({
      success: false,
      error: 'invalid_repo_path',
      needsTool: false,
    });
    expect(resolveBindingSpy).not.toHaveBeenCalled();

    const readRes = await get('pipeline:read-specification')(null, repoDir, 'mi-spec');
    expect(readRes).toEqual({
      success: false,
      error: 'invalid_repo_path',
    });
    expect(resolveBindingSpy).not.toHaveBeenCalled();

    const writeRes = await get('pipeline:write-artifact')(null, repoDir, 'mi-cambio', 'proposal', '# Propuesta');
    expect(writeRes).toEqual({
      success: false,
      error: 'Ruta de repositorio inválida o no autorizada',
      stage: 'auth',
    });
    expect(resolveBindingSpy).not.toHaveBeenCalled();
  });

  it('la ruta autorizada pasa y lee la especificación correctamente', async () => {
    authorizedRepoStore.authorizeRepo(repoDir);

    const readRes = await get('pipeline:read-specification')(null, repoDir, 'mi-spec');
    expect(readRes).toEqual({
      success: true,
      content: '## Requisito\n\nEspecificación de prueba.',
    });
    expect(resolveBindingSpy).toHaveBeenCalledWith(repoDir);
  });
});

describe('Pipeline Tasks IPC — candado de autorización sobre pipeline:set-task-checked', () => {
  let tempRoot: string;
  let repoDir: string;
  let readSpy: ReturnType<typeof vi.fn>;
  let writeSpy: ReturnType<typeof vi.fn>;
  let resolveBindingSpy: ReturnType<typeof vi.fn>;

  const get = (channel: string): Handler => {
    const h = ipc.handlers.get(channel);
    if (!h) throw new Error(`No handler registered for channel: ${channel}`);
    return h;
  };

  beforeEach(async () => {
    ipc.handlers.clear();
    ipc.handle.mockClear();
    authorizedRepoStore.clear();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-tasks-authz-'));
    repoDir = path.join(tempRoot, 'repo-tasks');
    fs.mkdirSync(repoDir, { recursive: true });
    await simpleGit(repoDir).init(['--initial-branch=main']);

    const tasksContent = ['## 1. Tanda', '', '- [ ] 1.1 tarea de prueba', ''].join('\n');
    readSpy = vi.fn(async () => tasksContent);
    writeSpy = vi.fn(async () => {});
    resolveBindingSpy = vi.fn(async (p: string) => ({ repoId: 'r1', canonicalPath: fs.realpathSync(p) }));

    const { registerPipelineTaskHandlers } = await import('../ipc/pipeline-tasks');
    registerPipelineTaskHandlers(
      { resolveBinding: resolveBindingSpy } as never,
      readSpy as never,
      writeSpy as never,
      () => '2026-08-16T12:00:00.000Z',
    );
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    removeTempDir(tempRoot);
  });

  it('rechaza una ruta no autorizada en pipeline:set-task-checked sin tocar binding, lectura ni escritura', async () => {
    const res = await get('pipeline:set-task-checked')(null, repoDir, 'mi-cambio', 3, '1.1 tarea de prueba', true);
    expect(res).toEqual({
      success: false,
      error: 'Ruta de repositorio inválida o no autorizada',
    });
    expect(resolveBindingSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('la ruta autorizada pasa y escribe el cambio de estado de la tarea', async () => {
    authorizedRepoStore.authorizeRepo(repoDir);

    const res = await get('pipeline:set-task-checked')(null, repoDir, 'mi-cambio', 3, '1.1 tarea de prueba', true, 'persona');
    expect(res).toEqual({ success: true });
    expect(resolveBindingSpy).toHaveBeenCalledWith(repoDir);
    expect(readSpy).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalled();
  });

  it('rechaza una ruta no autorizada en pipeline:add-task, edit-task, move-task y remove-task', async () => {
    const addRes = await get('pipeline:add-task')(null, repoDir, 'mi-cambio', '1.2 nueva');
    expect(addRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });

    const editRes = await get('pipeline:edit-task')(null, repoDir, 'mi-cambio', 3, '1.1 tarea de prueba', 'nueva');
    expect(editRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });

    const moveRes = await get('pipeline:move-task')(null, repoDir, 'mi-cambio', 3, 4, '1.1 tarea de prueba');
    expect(moveRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });

    const removeRes = await get('pipeline:remove-task')(null, repoDir, 'mi-cambio', 3, '1.1 tarea de prueba');
    expect(removeRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });

    expect(resolveBindingSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('Pipeline Runtime IPC — candado de autorización sobre pipeline:runtime:*', () => {
  let tempRoot: string;
  let repoDir: string;
  let resolveBindingSpy: ReturnType<typeof vi.fn>;
  let hubDiscoverSpy: ReturnType<typeof vi.fn>;
  let hubGetSpy: ReturnType<typeof vi.fn>;
  let hubHistorySpy: ReturnType<typeof vi.fn>;
  let hubStartSpy: ReturnType<typeof vi.fn>;
  let hubStopSpy: ReturnType<typeof vi.fn>;

  const get = (channel: string): Handler => {
    const h = ipc.handlers.get(channel);
    if (!h) throw new Error(`No handler registered for channel: ${channel}`);
    return h;
  };

  beforeEach(async () => {
    ipc.handlers.clear();
    ipc.handle.mockClear();
    authorizedRepoStore.clear();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-runtime-authz-'));
    repoDir = path.join(tempRoot, 'repo-runtime');
    fs.mkdirSync(repoDir, { recursive: true });
    await simpleGit(repoDir).init(['--initial-branch=main']);
    fs.writeFileSync(path.join(repoDir, 'gitcron.json'), JSON.stringify({
      agent: {
        'gitcron-sdd': {
          model: 'claude-code/claude-3-7-sonnet',
        },
      },
    }));

    // Un gitcron.json global de prueba: nunca el de la máquina.
    const { setUseConfigPathForTesting } = await import('../ai/use-resolution');
    setUseConfigPathForTesting(path.join(tempRoot, 'gitcron-global.json'));

    resolveBindingSpy = vi.fn(async (p: string) => ({ repoId: 'r1', canonicalPath: fs.realpathSync(p) }));
    hubDiscoverSpy = vi.fn(async () => [{ runtime: 'claude', installed: true, launchable: true, diagnostics: [] }]);
    hubGetSpy = vi.fn(() => null);
    hubHistorySpy = vi.fn(() => []);
    hubStartSpy = vi.fn(async () => ({ ok: true, sessionId: 's-123' }));
    hubStopSpy = vi.fn(async () => ({ stopped: true }));

    const mockHub = {
      discover: hubDiscoverSpy,
      get: hubGetSpy,
      history: hubHistorySpy,
      start: hubStartSpy,
      stop: hubStopSpy,
    };

    const { registerPipelineRuntimeHandlers } = await import('../ipc/pipeline-runtime');
    registerPipelineRuntimeHandlers(mockHub as never, { resolveBinding: resolveBindingSpy } as never);
  });

  afterEach(async () => {
    const { setUseConfigPathForTesting } = await import('../ai/use-resolution');
    setUseConfigPathForTesting(null);
    authorizedRepoStore.clear();
    removeTempDir(tempRoot);
  });

  it('rechaza una ruta no autorizada en los cinco canales de pipeline:runtime:* sin invocar el hub', async () => {
    // 1. discover
    const discoverRes = await get('pipeline:runtime:discover')(null, repoDir);
    expect(discoverRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });
    expect(hubDiscoverSpy).not.toHaveBeenCalled();

    // 2. get
    const getRes = await get('pipeline:runtime:get')(null, repoDir);
    expect(getRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });
    expect(hubGetSpy).not.toHaveBeenCalled();

    // 3. history
    const historyRes = await get('pipeline:runtime:history')(null, repoDir, 10);
    expect(historyRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });
    expect(hubHistorySpy).not.toHaveBeenCalled();

    // 4. start
    const startRes = await get('pipeline:runtime:start')(null, {
      repoPath: repoDir,
      runtime: 'claude',
      role: 'builder',
      instruction: 'hacer algo seguro',
    });
    expect(startRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });
    expect(hubStartSpy).not.toHaveBeenCalled();

    // 5. stop
    const stopRes = await get('pipeline:runtime:stop')(null, repoDir);
    expect(stopRes).toEqual({ success: false, error: 'Ruta de repositorio inválida o no autorizada' });
    expect(hubStopSpy).not.toHaveBeenCalled();

    expect(resolveBindingSpy).not.toHaveBeenCalled();
  });

  it('la ruta autorizada pasa en los cinco canales y ejecuta sobre el hub', async () => {
    const canonical = authorizedRepoStore.authorizeRepo(repoDir);
    expect(canonical).not.toBeNull();

    // 1. discover
    const discoverRes = await get('pipeline:runtime:discover')(null, repoDir);
    expect(discoverRes).toEqual({ success: true, data: [{ runtime: 'claude', installed: true, launchable: true, diagnostics: [] }] });
    expect(hubDiscoverSpy).toHaveBeenCalledWith(canonical);

    // 2. get
    const getRes = await get('pipeline:runtime:get')(null, repoDir);
    expect(getRes).toEqual({ success: true, data: null });
    expect(hubGetSpy).toHaveBeenCalledWith(canonical);

    // 3. history
    const historyRes = await get('pipeline:runtime:history')(null, repoDir, 10);
    expect(historyRes).toEqual({ success: true, data: [] });
    expect(hubHistorySpy).toHaveBeenCalledWith('r1', 10);

    // 4. start: el motor sale del modelo del uso gitcron-sdd, no de lo que mande la pantalla
    const startRes = await get('pipeline:runtime:start')(null, {
      repoPath: repoDir,
      role: 'builder',
      instruction: 'hacer algo seguro',
      expectedModel: JSON.stringify(['claude-code/claude-3-7-sonnet', null]),
    });
    expect(startRes).toEqual({ success: true, data: { sessionId: 's-123' } });
    expect(hubStartSpy).toHaveBeenCalledWith(expect.objectContaining({
      canonicalRepoPath: canonical,
      repoId: 'r1',
      runtime: 'claude',
      role: 'builder',
      instruction: 'hacer algo seguro',
    }));

    // 5. stop
    const stopRes = await get('pipeline:runtime:stop')(null, repoDir);
    expect(stopRes).toEqual({ success: true, data: { stopped: true } });
    expect(hubStopSpy).toHaveBeenCalledWith(canonical);
  });
});
