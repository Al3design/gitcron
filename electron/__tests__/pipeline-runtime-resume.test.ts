// electron/__tests__/pipeline-runtime-resume.test.ts
// Pruebas del canal IPC `pipeline:runtime:resume` (tarea 5.3, tanda 27).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RuntimeProjection } from '../../types/pipeline/projection';

const handlers = new Map<string, (_event: any, ...args: any[]) => Promise<any>>();

const fetchOpenCodeModelList = vi.hoisted(() => vi.fn());
const ensureOpenCodeService = vi.hoisted(() => vi.fn());

vi.mock('../ai/config/opencode-models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/config/opencode-models')>()),
  fetchOpenCodeModelList,
}));

vi.mock('../ai/config/opencode-service', () => ({
  ensureOpenCodeService,
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => handlers.set(channel, handler)),
  },
}));

import { authorizedRepoStore } from '../ipc/authorized-repos';
import { registerPipelineRuntimeHandlers } from '../ipc/pipeline-runtime';
import { resetGitCronConfigCacheForTesting } from '../ai/config/gitcron-config';
import { setUseConfigPathForTesting } from '../ai/use-resolution';

describe('pipeline:runtime:resume (tanda 27)', () => {
  let tempDir: string;
  let repoDir: string;
  let globalPath: string;
  let repoConfigPath: string;
  let hubDiscoverSpy: ReturnType<typeof vi.fn>;
  let hubStartSpy: ReturnType<typeof vi.fn>;
  let hubHistorySpy: ReturnType<typeof vi.fn>;
  let hubGetSpy: ReturnType<typeof vi.fn>;

  const resume = (payload: Record<string, unknown>) =>
    handlers.get('pipeline:runtime:resume')!(null, { repoPath: repoDir, instruction: 'continuar trabajo', ...payload });

  const makeStoredProjection = (overrides: Partial<RuntimeProjection> = {}): RuntimeProjection => ({
    schemaVersion: '1.0',
    repoId: 'repo-1',
    sessionId: 'sess-prev-uuid',
    runtime: 'opencode',
    changeId: 'ch-alpha',
    taskId: '1.1',
    role: 'builder',
    active: false,
    outcome: 'completed',
    startedAt: '2026-10-07T10:00:00.000Z',
    endedAt: '2026-10-07T10:05:00.000Z',
    agents: [],
    activity: [],
    reasoningVisibility: 'unknown',
    telemetry: null,
    controlCapabilities: [],
    droppedActivity: 0,
    diagnostics: [],
    runtimeSessionId: 'ses_opencode_12345',
    requestedModel: 'unslothpclocal/qwen-3',
    reasoningEffort: null,
    continuesSessionId: null,
    ...overrides,
  });

  beforeEach(() => {
    handlers.clear();
    authorizedRepoStore.clear();

    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resume-test-')));
    repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    repoConfigPath = path.join(repoDir, 'gitcron.json');
    globalPath = path.join(tempDir, 'global', 'gitcron.json');
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(globalPath, '{}');
    setUseConfigPathForTesting(globalPath);
    resetGitCronConfigCacheForTesting();

    authorizedRepoStore.authorizeRepo(repoDir);

    hubDiscoverSpy = vi.fn(async () => [
      { runtime: 'opencode', installed: true, launchable: true, canResume: true, diagnostics: [] },
      { runtime: 'agy', installed: true, launchable: true, canResume: true, diagnostics: [] },
      { runtime: 'claude', installed: true, launchable: true, canResume: false, diagnostics: [] },
    ]);
    hubStartSpy = vi.fn(async () => ({ ok: true, sessionId: 'sess-resumed-new-uuid' }));
    hubHistorySpy = vi.fn(() => [makeStoredProjection()]);
    hubGetSpy = vi.fn(() => null);

    ensureOpenCodeService.mockResolvedValue({ running: true, started: false });
    fetchOpenCodeModelList.mockResolvedValue({
      installed: true,
      error: null,
      models: [{ providerId: 'unslothpclocal', id: 'qwen-3', name: 'Qwen 3', enabled: true, status: 'active' }],
    });

    const mockHub = {
      discover: hubDiscoverSpy,
      get: hubGetSpy,
      history: hubHistorySpy,
      start: hubStartSpy,
      stop: vi.fn(async () => ({ stopped: true })),
    };
    const mockService = {
      resolveBinding: vi.fn(async (p: string) => ({ repoId: 'repo-1', canonicalPath: fs.realpathSync(p) })),
    };
    registerPipelineRuntimeHandlers(mockHub as never, mockService as never);
  });

  afterEach(() => {
    setUseConfigPathForTesting(null);
    fetchOpenCodeModelList.mockReset();
    ensureOpenCodeService.mockReset();
    resetGitCronConfigCacheForTesting();
    authorizedRepoStore.clear();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('retoma con el motor y modelo guardados aunque el uso gitcron-sdd configure otro', async () => {
    // Configuramos repo con codex
    fs.writeFileSync(repoConfigPath, JSON.stringify({
      agent: { 'gitcron-sdd': { model: 'codex/gpt-5', options: { reasoning_effort: 'high' } } },
    }));

    const res = await resume({ fromSessionId: 'sess-prev-uuid', instruction: 'siguiente paso' });

    expect(res).toEqual({ success: true, data: { sessionId: 'sess-resumed-new-uuid' } });
    expect(hubStartSpy).toHaveBeenCalledTimes(1);
    expect(hubStartSpy).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'opencode',
      requestedModel: 'unslothpclocal/qwen-3',
      resumeSessionId: 'ses_opencode_12345',
      continuesSessionId: 'sess-prev-uuid',
      instruction: 'siguiente paso',
      changeId: 'ch-alpha',
      taskId: '1.1',
    }));
  });

  it('session_not_found si la sesión no existe en el repositorio o pertenece a otro', async () => {
    // Caso 1: id inexistente
    const res = await resume({ fromSessionId: 'id-que-no-existe' });
    expect(res).toEqual({ success: false, error: 'session_not_found' });

    // Caso 2: hub.history devuelve lista vacía para este repoId
    hubHistorySpy.mockReturnValueOnce([]);
    const res2 = await resume({ fromSessionId: 'sess-prev-uuid' });
    expect(res2).toEqual({ success: false, error: 'session_not_found' });
  });

  it('session_already_active si la sesión previa está activa o hay otra corriendo en el repo', async () => {
    // Sesión previa marcada activa
    hubHistorySpy.mockReturnValueOnce([makeStoredProjection({ active: true })]);
    const res = await resume({ fromSessionId: 'sess-prev-uuid' });
    expect(res).toEqual({ success: false, error: 'session_already_active' });

    // Otra sesión activa en el repositorio
    hubGetSpy.mockReturnValueOnce({ active: true });
    const res2 = await resume({ fromSessionId: 'sess-prev-uuid' });
    expect(res2).toEqual({ success: false, error: 'session_already_active' });
  });

  it('runtime_cannot_resume si el motor no declara canResume (ej. Claude)', async () => {
    hubHistorySpy.mockReturnValueOnce([makeStoredProjection({
      runtime: 'claude',
      runtimeSessionId: 'claude_session_id',
    })]);

    const res = await resume({ fromSessionId: 'sess-prev-uuid' });
    expect(res).toEqual({ success: false, error: 'runtime_cannot_resume' });
  });

  it('session_not_resumable si no tiene runtimeSessionId o no pasa el patrón seguro', async () => {
    // Sin runtimeSessionId
    hubHistorySpy.mockReturnValueOnce([makeStoredProjection({ runtimeSessionId: null })]);
    const res = await resume({ fromSessionId: 'sess-prev-uuid' });
    expect(res).toEqual({ success: false, error: 'session_not_resumable' });

    // Con caracteres no permitidos
    hubHistorySpy.mockReturnValueOnce([makeStoredProjection({ runtimeSessionId: 'bad; id' })]);
    const res2 = await resume({ fromSessionId: 'sess-prev-uuid' });
    expect(res2).toEqual({ success: false, error: 'session_not_resumable' });
  });

  it('opencode_unknown_model si el modelo guardado ya no está en la lista de OpenCode', async () => {
    fetchOpenCodeModelList.mockResolvedValueOnce({
      installed: true,
      error: null,
      models: [{ providerId: 'unslothpclocal', id: 'otro-modelo', name: 'Otro Modelo' }],
    });

    const res = await resume({ fromSessionId: 'sess-prev-uuid' });
    expect(res).toEqual({ success: false, error: 'opencode_unknown_model' });
  });

  it('no consulta modelos ni lanza si el servicio de OpenCode no pudo arrancar', async () => {
    ensureOpenCodeService.mockResolvedValueOnce({ running: false, started: false, error: 'opencode_service_start_failed' });
    expect(await resume({ fromSessionId: 'sess-prev-uuid' })).toEqual({ success: false, error: 'opencode_service_start_failed' });
    expect(fetchOpenCodeModelList).not.toHaveBeenCalled();
    expect(hubStartSpy).not.toHaveBeenCalled();
  });

  it('rechaza una ruta no autorizada antes de consultar historial o motores', async () => {
    authorizedRepoStore.clear();
    expect((await resume({ fromSessionId: 'sess-prev-uuid' })).success).toBe(false);
    expect(hubHistorySpy).not.toHaveBeenCalled();
    expect(hubDiscoverSpy).not.toHaveBeenCalled();
    expect(hubStartSpy).not.toHaveBeenCalled();
  });
});
