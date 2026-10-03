import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { bootstrapDatabase, closeDatabase } from '../../db/connection';
import { authorizedRepoStore } from '../../ipc/authorized-repos';
import { listAiUseHistory, getAiUseRecord } from '../../db/ai-use-history';
import { resolveModelFor } from '../config/resolve-model-for';
import { resetGitCronConfigCacheForTesting } from '../config/gitcron-config';
import { runTextUse } from '../text-use';
import { draftVersionRedaction } from '../../pipeline/openspec-version-analysis';
import { setCommitAiConfigPathForTesting, resetLastCommitAiRequestForTesting } from '../../ipc/commit-message-ai';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    getAppPath: vi.fn(() => process.cwd()),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}));

describe('AI Use History Integration (4 uses)', () => {
  let db: DatabaseSync;
  let tempDir: string;
  let repoPath: string;
  let configPath: string;

  beforeEach(() => {
    db = bootstrapDatabase(':memory:');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-use-hist-integ-'));
    repoPath = path.join(tempDir, 'repo');
    fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });

    try {
      execSync('git init -b main', { cwd: repoPath, stdio: 'ignore' });
    } catch {
      fs.writeFileSync(path.join(repoPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    }

    configPath = path.join(tempDir, 'gitcron.json');
    setCommitAiConfigPathForTesting(configPath);
    resetGitCronConfigCacheForTesting();
    resetLastCommitAiRequestForTesting();

    authorizedRepoStore.clear();
    authorizedRepoStore.authorizeRepo(repoPath);
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    closeDatabase();
    setCommitAiConfigPathForTesting(null);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const writeConfig = (config: unknown) => {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  };

  const dummyServer = (answer: string = 'Generated text response', usage = { prompt_tokens: 15, completion_tokens: 8 }) => {
    const fetchFn = (async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: answer }, finish_reason: 'stop' }],
          usage,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    return { fetchFn };
  };

  it('records successful run for Cartography, Version Analysis, Temporal, and Commit uses', async () => {
    writeConfig({
      model: 'test-prov/test-model',
      provider: {
        'test-prov': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Test Provider',
          options: { baseURL: 'http://localhost:9999/v1' },
          models: { 'test-model': { name: 'Test Model' } },
        },
      },
    });

    const srv = dummyServer('Respuesta exitosa de prueba', { prompt_tokens: 50, completion_tokens: 25 });

    // 1. Cartography
    const cartoTarget = resolveModelFor('gitcron-cartography', { configPath });
    await runTextUse(
      cartoTarget,
      {
        system: 'System carto',
        user: 'User carto query',
        repoPath,
      },
      { fetchFn: srv.fetchFn },
    );

    // 2. OpenSpec Version Analysis
    const analysisTarget = resolveModelFor('gitcron-openspec-analysis', { configPath });
    await draftVersionRedaction(
      {
        installedVersion: '1.2.3',
        availableVersion: '1.3.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.14.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'local',
          sourceUrl: null,
          fetched: true,
          rawText: 'v1.3.0 changes',
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      {
        repoPath,
        target: analysisTarget,
        textDeps: { fetchFn: srv.fetchFn },
      },
    );

    // 3. Temporal Agent
    const temporalTarget = resolveModelFor('gitcron-temporal', { configPath });
    await runTextUse(
      temporalTarget,
      {
        system: 'System temporal',
        user: 'User temporal input',
        repoPath,
      },
      { fetchFn: srv.fetchFn },
    );

    // 4. Commit draft text use
    const commitTarget = resolveModelFor('gitcron-commit', { configPath });
    await runTextUse(
      commitTarget,
      {
        system: 'System commit',
        user: 'User commit diff',
        repoPath,
      },
      { fetchFn: srv.fetchFn },
    );

    // Verify all 4 records were saved in SQLite
    const history = listAiUseHistory({ repoPath });
    expect(history.total).toBe(4);

    const uses = history.items.map((i) => i.use);
    expect(uses).toContain('gitcron-cartography');
    expect(uses).toContain('gitcron-openspec-analysis');
    expect(uses).toContain('gitcron-temporal');
    expect(uses).toContain('gitcron-commit');

    for (const item of history.items) {
      expect(item.resultStatus).toBe('generated');
      expect(item.providerName).toBe('Test Provider');
      expect(item.modelId).toBe('test-model');
      expect(item.durationMs).toBeGreaterThanOrEqual(0);
      expect(item.promptTokens).toBe(50);
      expect(item.completionTokens).toBe(25);
    }
  });

  it('records failed run when provider throws', async () => {
    writeConfig({
      model: 'test-prov/test-model',
      provider: {
        'test-prov': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Test Provider',
          options: { baseURL: 'http://localhost:9999/v1' },
          models: { 'test-model': { name: 'Test Model' } },
        },
      },
    });

    const failingFetch = (async () => {
      throw new Error('Connection refused to mock host');
    }) as unknown as typeof fetch;

    const cartoTarget = resolveModelFor('gitcron-cartography', { configPath });
    await expect(
      runTextUse(
        cartoTarget,
        {
          system: 'System fail',
          user: 'User fail',
          repoPath,
        },
        { fetchFn: failingFetch },
      ),
    ).rejects.toThrow();

    const history = listAiUseHistory({ repoPath, use: 'gitcron-cartography' });
    expect(history.total).toBe(1);
    expect(history.items[0].resultStatus).toBe('failed');
    expect(history.items[0].resultText).toContain('Connection refused');
  });

  it('records cancelled run when AbortController aborts', async () => {
    writeConfig({
      model: 'test-prov/test-model',
      provider: {
        'test-prov': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Test Provider',
          options: { baseURL: 'http://localhost:9999/v1' },
          models: { 'test-model': { name: 'Test Model' } },
        },
      },
    });

    const controller = new AbortController();
    const abortingFetch = (async () => {
      controller.abort();
      throw new Error('Petición cancelada.');
    }) as unknown as typeof fetch;

    const temporalTarget = resolveModelFor('gitcron-temporal', { configPath });
    await expect(
      runTextUse(
        temporalTarget,
        {
          system: 'System cancel',
          user: 'User cancel',
          repoPath,
          signal: controller.signal,
        },
        { fetchFn: abortingFetch },
      ),
    ).rejects.toThrow();

    const history = listAiUseHistory({ repoPath, use: 'gitcron-temporal' });
    expect(history.total).toBe(1);
    expect(history.items[0].resultStatus).toBe('cancelled');
  });

  it('does NOT record anything when repository is unauthorized', async () => {
    writeConfig({
      model: 'test-prov/test-model',
      provider: {
        'test-prov': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Test Provider',
          options: { baseURL: 'http://localhost:9999/v1' },
          models: { 'test-model': { name: 'Test Model' } },
        },
      },
    });

    const unauthorizedRepo = path.join(tempDir, 'other-unauthorized-repo');
    const srv = dummyServer('ok');

    const cartoTarget = resolveModelFor('gitcron-cartography', { configPath });
    await runTextUse(
      cartoTarget,
      {
        system: 'System unauth',
        user: 'User unauth',
        repoPath: unauthorizedRepo,
      },
      { fetchFn: srv.fetchFn },
    );

    const history = listAiUseHistory({ repoPath: unauthorizedRepo });
    expect(history.total).toBe(0);
  });

  it('leaves git working tree untouched before and after recording AI uses', async () => {
    writeConfig({
      model: 'test-prov/test-model',
      provider: {
        'test-prov': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Test Provider',
          options: { baseURL: 'http://localhost:9999/v1' },
          models: { 'test-model': { name: 'Test Model' } },
        },
      },
    });

    const getStatus = () => {
      try {
        return execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf8' }).trim();
      } catch {
        return '';
      }
    };

    const beforeStatus = getStatus();

    const srv = dummyServer('Diff description response');
    const target = resolveModelFor('gitcron-cartography', { configPath });
    await runTextUse(
      target,
      {
        system: 'System',
        user: 'User',
        repoPath,
      },
      { fetchFn: srv.fetchFn },
    );

    const afterStatus = getStatus();
    expect(afterStatus).toBe(beforeStatus);
  });

  it('guarda la variante elegida y el nombre de la máquina', async () => {
    writeConfig({
      provider: {
        'test-prov': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Test Provider',
          options: { baseURL: 'http://localhost:9999/v1' },
          models: { 'test-model': { variants: { alto: { reasoning_effort: 'high' } } } },
        },
      },
      agent: { 'gitcron-temporal': { model: 'test-prov/test-model', variant: 'alto' } },
    });
    const srv = dummyServer();
    await runTextUse(resolveModelFor('gitcron-temporal', { configPath }), { system: 's', user: 'u', repoPath }, { fetchFn: srv.fetchFn });
    const row = db.prepare('SELECT variant, device_id, device_label FROM ai_use_record').get() as Record<string, unknown>;
    expect(row.variant).toBe('alto');
    expect(typeof row.device_id).toBe('string');
    expect('device_label' in row).toBe(true);
  });
});
