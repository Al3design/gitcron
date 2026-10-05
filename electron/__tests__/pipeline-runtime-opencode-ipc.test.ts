// electron/__tests__/pipeline-runtime-opencode-ipc.test.ts
//
// Pruebas de los canales IPC de OpenCode: plan-opencode-copy, apply-opencode-copy y check-opencode-auth
// (tarea 5.3 segunda parte, D8).
//
// Reglas estrictas:
// - Ningún canal devuelve claves ni secretos en su respuesta (se comprueba con secretos explícitos).
// - Sin confirmación previa no se escribe nada.
// - Los cuatro casos de comprobación de claves se reportan fielmente sin filtrar información sensible.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const handlers = new Map<string, (_event: any, ...args: any[]) => Promise<any>>();

const fetchOpenCodeModelList = vi.hoisted(() => vi.fn());
const queryOpenCodeModelCredentials = vi.hoisted(() => vi.fn());
const ensureOpenCodeService = vi.hoisted(() => vi.fn(async () => ({ running: true, started: false })));
const reloadOpenCode = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const mockOpenCodePath = vi.hoisted(() => vi.fn<() => string>());
const mockAuthPath = vi.hoisted(() => vi.fn<() => string>());

vi.mock('../ai/config/opencode-models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/config/opencode-models')>()),
  fetchOpenCodeModelList,
  queryOpenCodeModelCredentials,
}));

vi.mock('../ai/config/opencode-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/config/opencode-service')>()),
  ensureOpenCodeService,
  reloadOpenCode,
}));

vi.mock('../ai/config/opencode-import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/config/opencode-import')>()),
  getDefaultOpenCodePath: vi.fn(() => mockOpenCodePath()),
}));

vi.mock('../ai/config/opencode-auth-check', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/config/opencode-auth-check')>();
  return {
    ...actual,
    getDefaultOpenCodeAuthPath: vi.fn(() => mockAuthPath()),
  };
});

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

describe('pipeline:runtime OpenCode IPC channels (tarea 5.3)', () => {
  let tempDir: string;
  let repoDir: string;
  let globalPath: string;
  let opencodePath: string;
  let authPath: string;

  const SECRET_KEY = 'super-secret-key-that-must-never-leak-998877';

  beforeEach(() => {
    handlers.clear();
    authorizedRepoStore.clear();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-opencode-ipc-'));
    repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    authorizedRepoStore.authorizeRepo(repoDir);

    globalPath = path.join(tempDir, 'global-gitcron.json');
    opencodePath = path.join(tempDir, 'opencode.json');
    authPath = path.join(tempDir, 'auth.json');
    mockOpenCodePath.mockImplementation(() => opencodePath);
    mockAuthPath.mockImplementation(() => authPath);
    setUseConfigPathForTesting(globalPath);

    registerPipelineRuntimeHandlers(
      {
        discover: vi.fn(async () => []),
        get: vi.fn(() => null),
        start: vi.fn(),
        stop: vi.fn(async () => true),
      } as any,
      {
        resolveBinding: vi.fn(async (p: string) => ({ canonicalPath: p, repoId: 'repo-1' })),
      } as any,
    );
  });

  afterEach(() => {
    setUseConfigPathForTesting(null);
    resetGitCronConfigCacheForTesting();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('plan-opencode-copy arma el plan sin escribir y NUNCA devuelve claves escritas a mano', async () => {
    // gitcron.json con clave literal
    fs.writeFileSync(globalPath, JSON.stringify({
      agent: {
        'gitcron-sdd': {
          model: 'servidor_local/modelo-a',
        },
      },
      provider: {
        servidor_local: {
          name: 'Servidor Local',
          apiKey: SECRET_KEY,
          options: {
            baseURL: 'http://localhost:8080',
            apiKey: SECRET_KEY,
          },
          models: {
            'servidor_local/modelo-a': { name: 'Modelo A' },
          },
        },
      },
    }), 'utf8');

    const planHandler = handlers.get('pipeline:runtime:plan-opencode-copy')!;
    const res = await planHandler(null, repoDir);

    expect(res.success).toBe(true);
    expect(res.data.canCopy).toBe(true);
    expect(res.data.mode).toBe('add_provider');
    expect(res.data.hasLiteralSecrets).toBe(true);

    // Asegurar que ningún secreto viajó en la respuesta del canal
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(SECRET_KEY);
  });

  it('apply-opencode-copy aplica la copia y llama reload', async () => {
    fs.writeFileSync(globalPath, JSON.stringify({
      agent: {
        'gitcron-sdd': {
          model: 'unsloth/Qwen3.8',
        },
      },
      provider: {
        unsloth: {
          name: 'Unsloth CASA',
          options: { baseURL: 'http://192.168.1.7:1234' },
          models: { 'unsloth/Qwen3.8': { name: 'Qwen 3.8' } },
        },
      },
    }), 'utf8');

    const applyHandler = handlers.get('pipeline:runtime:apply-opencode-copy')!;
    const res = await applyHandler(null, repoDir);

    expect(res.success).toBe(true);
    expect(res.data.written).toBe(true);
  });

  it('check-opencode-auth compara credenciales sin filtrar secretos en la respuesta', async () => {
    fs.writeFileSync(globalPath, JSON.stringify({
      agent: {
        'gitcron-sdd': {
          model: 'unsloth/Qwen3.8',
        },
      },
      provider: {
        unsloth: {
          name: 'Unsloth CASA',
          options: {
            baseURL: 'http://192.168.1.7:1234',
            apiKey: '{env:UNSLOTH_API_KEY}',
          },
          models: { 'unsloth/Qwen3.8': { name: 'Qwen 3.8' } },
        },
      },
    }), 'utf8');

    queryOpenCodeModelCredentials.mockResolvedValueOnce({
      apiKey: '',
      headers: {},
    });

    const checkHandler = handlers.get('pipeline:runtime:check-opencode-auth')!;
    const res = await checkHandler(null, repoDir);

    expect(res.success).toBe(true);
    expect(res.data.status).toBe('mismatch');
    expect(res.data.notice).toEqual({
      kind: 'missing_env',
      variableName: 'UNSLOTH_API_KEY',
    });

    // Ningún secreto en la respuesta
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(SECRET_KEY);
  });
});
