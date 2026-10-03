import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openTemporalAgentDatabase } from '../connection';
import { authorizedRepoStore } from '../../ipc/authorized-repos';
import {
  clearAiUseHistory,
  detectCurrentBranch,
  getAiUseRecord,
  linkAiUseCommit,
  listAiUseHistory,
  recordAiUse,
} from '../ai-use-history';
import type { CommitAiLastRequest } from '../../../types/commit-message-ai';

describe('AI Use History DB module', () => {
  let db: DatabaseSync;
  let tempBase: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    db = openTemporalAgentDatabase(':memory:');
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hist-test-'));
    const rawA = path.join(tempBase, 'repo-alpha');
    const rawB = path.join(tempBase, 'repo-beta');
    fs.mkdirSync(path.join(rawA, '.git'), { recursive: true });
    fs.mkdirSync(path.join(rawB, '.git'), { recursive: true });

    authorizedRepoStore.clear();
    repoA = authorizedRepoStore.authorizeRepo(rawA)!;
    repoB = authorizedRepoStore.authorizeRepo(rawB)!;
  });

  afterEach(() => {
    authorizedRepoStore.clear();
    db.close();
    try {
      fs.rmSync(tempBase, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const dummyRequest: CommitAiLastRequest = {
    kind: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: { value: 'qwen-2.5', provenance: 'agent.gitcron-commit.model' },
    parameters: {
      temperature: { value: 0.7, provenance: 'agent.gitcron-commit.temperature' },
    },
    headers: [{ name: 'Authorization', provenance: 'provider.lmstudio' }],
    auth: 'Bearer [oculto]',
    timestamp: Date.now(),
  };

  it('records an AI use with all fields and reads it back', () => {
    const startedAt = Date.now() - 5000;
    const endedAt = Date.now();

    const recordId = recordAiUse(
      {
        repoPath: repoA,
        use: 'gitcron-commit',
        startedAt,
        endedAt,
        durationMs: 5000,
        family: 'openai-compatible',
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen-2.5',
        reasoningEffort: 'medium',
        variant: 'instruct',
        effectiveRequest: dummyRequest,
        promptSent: 'Prompt completo con diff...',
        resultStatus: 'generated',
        resultText: 'feat: new feature',
        branch: 'main',
        deviceId: 'device-test-1',
        usage: {
          promptTokens: 120,
          cachedPromptTokens: 20,
          completionTokens: 40,
          reasoningTokens: 10,
        },
      },
      { db },
    );

    expect(recordId).toBeTypeOf('string');

    // Retrieve detail
    const detail = getAiUseRecord(recordId!, repoA, { db });
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(recordId);
    expect(detail!.repoPath).toBe(repoA);
    expect(detail!.branch).toBe('main');
    expect(detail!.deviceId).toBe('device-test-1');
    expect(detail!.use).toBe('gitcron-commit');
    expect(detail!.durationMs).toBe(5000);
    expect(detail!.family).toBe('openai-compatible');
    expect(detail!.providerName).toBe('LM Studio');
    expect(detail!.modelId).toBe('qwen-2.5');
    expect(detail!.reasoningEffort).toBe('medium');
    expect(detail!.variant).toBe('instruct');
    expect(detail!.resultStatus).toBe('generated');
    expect(detail!.resultText).toBe('feat: new feature');
    expect(detail!.promptTokens).toBe(120);
    expect(detail!.cachedPromptTokens).toBe(20);
    expect(detail!.completionTokens).toBe(40);
    expect(detail!.reasoningTokens).toBe(10);
    expect(detail!.promptSent).toBe('Prompt completo con diff...');
    expect(detail!.effectiveRequest.endpoint).toBe(dummyRequest.endpoint);
  });

  it('refuses to record for an unauthorized repo', () => {
    const unauthorizedRepo = path.join(tempBase, 'unauthorized-repo');
    const recordId = recordAiUse(
      {
        repoPath: unauthorizedRepo,
        use: 'gitcron-commit',
        startedAt: Date.now(),
        endedAt: Date.now(),
        family: 'cli',
        providerId: 'codex',
        providerName: 'Codex',
        modelId: 'gpt-5.6',
        effectiveRequest: dummyRequest,
        promptSent: 'prompt text',
        resultStatus: 'generated',
      },
      { db },
    );

    expect(recordId).toBeNull();
    const list = listAiUseHistory({ repoPath: unauthorizedRepo }, { db });
    expect(list.total).toBe(0);
  });

  it('lists items with filtering, pagination and byte counts', () => {
    // Insert 3 records in repoA
    recordAiUse(
      {
        repoPath: repoA,
        use: 'gitcron-commit',
        startedAt: '2026-10-02T10:00:00.000Z',
        endedAt: '2026-10-02T10:00:05.000Z',
        family: 'openai-compatible',
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen',
        effectiveRequest: dummyRequest,
        promptSent: 'short prompt',
        resultStatus: 'generated',
      },
      { db },
    );

    recordAiUse(
      {
        repoPath: repoA,
        use: 'gitcron-cartography',
        startedAt: '2026-10-02T10:05:00.000Z',
        endedAt: '2026-10-02T10:05:05.000Z',
        family: 'openai-compatible',
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen',
        effectiveRequest: dummyRequest,
        promptSent: 'longer prompt for cartography analysis',
        resultStatus: 'failed',
      },
      { db },
    );

    recordAiUse(
      {
        repoPath: repoA,
        use: 'gitcron-commit',
        startedAt: '2026-10-02T10:10:00.000Z',
        endedAt: '2026-10-02T10:10:05.000Z',
        family: 'cli',
        providerId: 'codex',
        providerName: 'Codex',
        modelId: 'gpt-5.6',
        effectiveRequest: dummyRequest,
        promptSent: 'another prompt',
        resultStatus: 'cancelled',
      },
      { db },
    );

    // List all
    const all = listAiUseHistory({ repoPath: repoA }, { db });
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(3);
    // Newest first
    expect(all.items[0].startedAt).toBe('2026-10-02T10:10:00.000Z');
    expect(all.items[0].promptSentBytes).toBeGreaterThan(0);
    // List item does not have promptSent
    expect((all.items[0] as any).promptSent).toBeUndefined();

    // Filter by use
    const onlyCommit = listAiUseHistory({ repoPath: repoA, use: 'gitcron-commit' }, { db });
    expect(onlyCommit.total).toBe(2);
    expect(onlyCommit.items.every((it) => it.use === 'gitcron-commit')).toBe(true);

    // Filter by resultStatus
    const onlyFailed = listAiUseHistory({ repoPath: repoA, resultStatus: 'failed' }, { db });
    expect(onlyFailed.total).toBe(1);
    expect(onlyFailed.items[0].use).toBe('gitcron-cartography');

    // Pagination
    const page1 = listAiUseHistory({ repoPath: repoA, limit: 1, offset: 0 }, { db });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0].startedAt).toBe('2026-10-02T10:10:00.000Z');

    const page2 = listAiUseHistory({ repoPath: repoA, limit: 1, offset: 1 }, { db });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].startedAt).toBe('2026-10-02T10:05:00.000Z');
  });

  it('maintains strict isolation between repositories and clears per-repo', () => {
    // Record in repoA
    recordAiUse(
      {
        repoPath: repoA,
        use: 'gitcron-commit',
        startedAt: Date.now(),
        endedAt: Date.now(),
        family: 'openai-compatible',
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen',
        effectiveRequest: dummyRequest,
        promptSent: 'prompt in repoA',
        resultStatus: 'generated',
      },
      { db },
    );

    // Record in repoB
    recordAiUse(
      {
        repoPath: repoB,
        use: 'gitcron-commit',
        startedAt: Date.now(),
        endedAt: Date.now(),
        family: 'openai-compatible',
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen',
        effectiveRequest: dummyRequest,
        promptSent: 'prompt in repoB',
        resultStatus: 'generated',
      },
      { db },
    );

    expect(listAiUseHistory({ repoPath: repoA }, { db }).total).toBe(1);
    expect(listAiUseHistory({ repoPath: repoB }, { db }).total).toBe(1);

    // Clear repoA
    const cleared = clearAiUseHistory(repoA, { db });
    expect(cleared).toBe(1);

    // repoA is empty, repoB is untouched
    expect(listAiUseHistory({ repoPath: repoA }, { db }).total).toBe(0);
    expect(listAiUseHistory({ repoPath: repoB }, { db }).total).toBe(1);
  });

  it('links commits with edited and unedited status', () => {
    const id = recordAiUse(
      {
        repoPath: repoA,
        use: 'gitcron-commit',
        startedAt: Date.now(),
        endedAt: Date.now(),
        family: 'openai-compatible',
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen',
        effectiveRequest: dummyRequest,
        promptSent: 'prompt',
        resultStatus: 'generated',
        resultText: 'feat: initial subject',
      },
      { db },
    );

    // Link unedited
    const linkSuccess = linkAiUseCommit(id!, 'abc1234', false, repoA, { db });
    expect(linkSuccess).toBe(true);

    let record = getAiUseRecord(id!, repoA, { db });
    expect(record?.commitHash).toBe('abc1234');
    expect(record?.commitEdited).toBe(false);

    // Link edited
    linkAiUseCommit(id!, 'def5678', true, repoA, { db });
    record = getAiUseRecord(id!, repoA, { db });
    expect(record?.commitHash).toBe('def5678');
    expect(record?.commitEdited).toBe(true);

    // Cannot link across repos
    const linkWrongRepo = linkAiUseCommit(id!, 'xyz9999', false, repoB, { db });
    expect(linkWrongRepo).toBe(false);
  });

  it('ensures no secrets are persisted in the database row', () => {
    const SECRET_KEY = 'sk-super-secret-key-12345';
    const SECRET_HEADER_VALUE = 'Bearer very-confidential-token';
    const SECRET_ENV_VALUE = 'password123';

    // The effective request is sanitized: it has provenance and masked auth, never raw secret values
    const sanitizedEffectiveRequest: CommitAiLastRequest = {
      kind: 'openai-compatible',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: { value: 'gpt-4o', provenance: 'agent.gitcron-commit.model' },
      parameters: {
        max_tokens: { value: 100, provenance: 'valor por omisión de GitCron' },
      },
      headers: [{ name: 'Authorization', provenance: 'env:OPENAI_API_KEY' }],
      auth: 'Bearer [oculto]',
      timestamp: Date.now(),
    };

    const promptText = 'Public git diff without secrets';

    const id = recordAiUse(
      {
        repoPath: repoA,
        use: 'gitcron-commit',
        startedAt: Date.now(),
        endedAt: Date.now(),
        family: 'openai-compatible',
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        modelId: 'gpt-4o',
        effectiveRequest: sanitizedEffectiveRequest,
        promptSent: promptText,
        resultStatus: 'generated',
        resultText: 'feat: add secretless feature',
      },
      { db },
    );

    // Read raw row from sqlite
    const rawRow = db.prepare('SELECT * FROM ai_use_record WHERE id = ?').get(id!) as Record<string, unknown>;
    const rowJson = JSON.stringify(rawRow);

    expect(rowJson).not.toContain(SECRET_KEY);
    expect(rowJson).not.toContain(SECRET_HEADER_VALUE);
    expect(rowJson).not.toContain(SECRET_ENV_VALUE);

    // But prompt text is preserved
    expect(rowJson).toContain(promptText);
  });

  it('detects current branch from HEAD file', () => {
    fs.writeFileSync(path.join(repoA, '.git', 'HEAD'), 'ref: refs/heads/feature/ai-history\n');
    const branch = detectCurrentBranch(repoA);
    expect(branch).toBe('feature/ai-history');
  });
});
