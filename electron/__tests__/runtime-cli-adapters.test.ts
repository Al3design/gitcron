import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeSessionRequest } from '../../types/pipeline';
import {
  RuntimeProcessRunner,
  createClaudeRuntimeAdapter,
  createCodexRuntimeAdapter,
  type RuntimeProcessHandle,
  type RuntimeProcessResult,
  type RuntimeProcessSpec,
} from '../pipeline/runtime-adapters';

const baseRequest: RuntimeSessionRequest = {
  repoId: 'repo-fixture',
  canonicalRepoPath: 'C:\\fixture\\repo',
  changeId: 'pipeline-fase-03-runtime-adapters',
  taskId: '2.6',
  runId: 'run-fixture',
  attemptId: 'attempt-1',
  parentSessionId: null,
  parentAgentId: null,
  orchestrationMode: 'direct',
  orchestratorRuntime: 'codex',
  provider: null,
  requestedModel: null,
  role: 'builder',
};

class FixtureRunner extends RuntimeProcessRunner {
  capturedSpec: RuntimeProcessSpec | null = null;

  constructor(private readonly fixture: Buffer) {
    super();
  }

  override async start(spec: RuntimeProcessSpec): Promise<RuntimeProcessHandle> {
    this.capturedSpec = spec;
    const result = Promise.resolve().then((): RuntimeProcessResult => {
      const midpoint = Math.floor(this.fixture.length / 2);
      spec.onStdout?.(this.fixture.subarray(0, midpoint));
      spec.onStdout?.(this.fixture.subarray(midpoint));
      return {
        processId: 'fixture-process',
        exitCode: 0,
        signal: null,
        stdout: this.fixture,
        stderr: Buffer.alloc(0),
        durationMs: 10,
        timedOut: false,
        aborted: false,
        outputLimit: null,
      };
    });
    return { processId: 'fixture-process', result, terminate: () => true };
  }

  override async run(spec: RuntimeProcessSpec): Promise<RuntimeProcessResult> {
    const stdout = spec.executable === 'claude'
      ? Buffer.from('2.1.206 (Claude Code)\n')
      : Buffer.from('codex-cli 0.143.0\n');
    return {
      processId: 'version-probe',
      exitCode: 0,
      signal: null,
      stdout,
      stderr: Buffer.alloc(0),
      durationMs: 1,
      timedOut: false,
      aborted: false,
      outputLimit: null,
    };
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe('structured CLI runtime adapters', () => {
  it.each([
    {
      name: 'claude',
      fixture: 'claude-2.1.206-stream.sanitized.jsonl',
      create: createClaudeRuntimeAdapter,
      expectedKind: 'reasoning.delta',
      expectedInputTokens: 1280,
    },
    {
      name: 'codex',
      fixture: 'codex-0.143.0-exec.sanitized.jsonl',
      create: createCodexRuntimeAdapter,
      expectedKind: 'tool.completed',
      expectedInputTokens: 41220,
    },
  ])('streams and normalizes $name without placing the instruction in argv', async ({ fixture, create, expectedKind, expectedInputTokens }) => {
    const bytes = fs.readFileSync(path.resolve('electron/__tests__/fixtures/f03/fixtures', fixture));
    const runner = new FixtureRunner(bytes);
    const adapter = create(baseRequest.canonicalRepoPath, runner, () => '2026-07-24T00:00:00.000Z');
    const instruction = 'PRIVATE_FIXTURE_INSTRUCTION';
    const session = await adapter.start?.({ ...baseRequest, instruction, timeoutMs: 5_000 });
    expect(session).toBeDefined();
    if (!session) throw new Error('adapter did not create a session');

    const events = await collect(adapter.events(session));
    const telemetry = await adapter.telemetry(session);
    expect(events.map(({ kind }) => kind)).toContain(expectedKind);
    expect(events.at(-1)).toMatchObject({
      kind: 'runtime.process.completed',
      provenance: 'derived',
      payload: { exitCode: 0, stderrBytes: 0 },
    });
    expect(telemetry.usage.inputTokens.value).toBe(expectedInputTokens);
    expect(runner.capturedSpec?.stdin).toBe(instruction);
    expect(runner.capturedSpec?.args).not.toContain(instruction);
    expect(runner.capturedSpec?.cwd).toBe(baseRequest.canonicalRepoPath);
    await adapter.shutdown(session);
  });

  it('rejects missing identity before a runner is invoked', async () => {
    const runner = new FixtureRunner(Buffer.alloc(0));
    const adapter = createCodexRuntimeAdapter(baseRequest.canonicalRepoPath, runner);
    await expect(adapter.start?.({ ...baseRequest, repoId: '', instruction: 'safe' })).rejects.toThrow('repoId is required');
    expect(runner.capturedSpec).toBeNull();
  });

  it('launches an installed runtime whose version has no matching reference, degrading evidence', async () => {
    // Tras retirar el gate de versión, un runtime instalado arranca aunque su
    // evidencia sea `pending_fixture`. La degradación es informativa, no un
    // rechazo: el gate que abortaba con "no compatible verified fixture" se quitó.
    class NewVersionRunner extends FixtureRunner {
      override async run(spec: RuntimeProcessSpec): Promise<RuntimeProcessResult> {
        return { ...(await super.run(spec)), stdout: Buffer.from('codex-cli 0.144.0\n') };
      }
    }
    const runner = new NewVersionRunner(Buffer.alloc(0));
    const adapter = createCodexRuntimeAdapter(baseRequest.canonicalRepoPath, runner);
    await expect(adapter.health()).resolves.toMatchObject({ status: 'degraded', evidenceStatus: 'pending_fixture' });
    // El arranque procede: ya no se rechaza por falta de fixture.
    const session = await adapter.start?.({ ...baseRequest, instruction: 'safe' });
    expect(session).toBeDefined();
  });

  it('configures Codex CLI with workspace-write sandbox and no dangerously-bypass options', async () => {
    const runner = new FixtureRunner(Buffer.alloc(0));
    const adapter = createCodexRuntimeAdapter(baseRequest.canonicalRepoPath, runner);
    await adapter.start?.({ ...baseRequest, instruction: 'test-instruction' });

    const args = runner.capturedSpec?.args ?? [];
    expect(args).toContain('--sandbox');
    expect(args).toContain('workspace-write');
    expect(args).not.toContain('read-only');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).not.toContain('--dangerously-skip-permissions');

    const startCap = adapter.descriptor.capabilities.find((c) => c.capabilityId === 'session.start');
    expect(startCap?.availability).toBe('available');
    expect(startCap?.constraints.some((c) => c.includes('workspace-write'))).toBe(true);
    expect(startCap?.constraints.some((c) => c.includes('red bloqueada'))).toBe(true);
  });

  it('configures Claude CLI with Bash tool in allowedTools and no dangerously-skip-permissions', async () => {
    const runner = new FixtureRunner(Buffer.alloc(0));
    const adapter = createClaudeRuntimeAdapter(baseRequest.canonicalRepoPath, runner);
    await adapter.start?.({ ...baseRequest, instruction: 'test-instruction' });

    const args = runner.capturedSpec?.args ?? [];
    expect(args).toContain('--permission-mode');
    expect(args).toContain('acceptEdits');
    expect(args).toContain('--tools=Read,Grep,Glob,Edit,Write,Bash');
    expect(args).toContain('--allowedTools=Read,Grep,Glob,Edit,Write,Bash');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');

    const startCap = adapter.descriptor.capabilities.find((c) => c.capabilityId === 'session.start');
    expect(startCap?.availability).toBe('available');
    expect(startCap?.constraints.some((c) => c.includes('Bash'))).toBe(true);
    expect(startCap?.constraints.some((c) => c.includes('sin acceso a shell'))).toBe(false);
  });

  it('los argumentos de Claude llevan --model y --effort con nivel válido, y omiten un nivel fuera de la lista', async () => {
    const runner = new FixtureRunner(Buffer.alloc(0));
    const adapter = createClaudeRuntimeAdapter(baseRequest.canonicalRepoPath, runner);
    await adapter.start?.({
      ...baseRequest,
      instruction: 'test-instruction',
      requestedModel: 'claude-3-7-sonnet',
      reasoningEffort: 'high',
    });

    const args = runner.capturedSpec?.args ?? [];
    expect(args).toContain('--model');
    expect(args).toContain('claude-3-7-sonnet');
    expect(args).toContain('--effort');
    expect(args).toContain('high');

    // Nivel fuera de la lista no se manda
    await adapter.start?.({
      ...baseRequest,
      instruction: 'test-instruction',
      requestedModel: 'claude-3-7-sonnet',
      reasoningEffort: 'ultra-invalid',
    });
    const argsInvalid = runner.capturedSpec?.args ?? [];
    expect(argsInvalid).not.toContain('--effort');
    expect(argsInvalid).not.toContain('ultra-invalid');
  });

  it('los argumentos de Codex llevan --model y -c model_reasoning_effort=... con nivel válido, y omiten un nivel fuera de la lista', async () => {
    const runner = new FixtureRunner(Buffer.alloc(0));
    const adapter = createCodexRuntimeAdapter(baseRequest.canonicalRepoPath, runner);
    await adapter.start?.({
      ...baseRequest,
      instruction: 'test-instruction',
      requestedModel: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    });

    const args = runner.capturedSpec?.args ?? [];
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5.6-sol');
    expect(args).toContain('-c');
    expect(args).toContain('model_reasoning_effort=medium');

    // Nivel fuera de la lista no se manda
    await adapter.start?.({
      ...baseRequest,
      instruction: 'test-instruction',
      requestedModel: 'gpt-5.6-sol',
      reasoningEffort: 'ultra-invalid',
    });
    const argsInvalid = runner.capturedSpec?.args ?? [];
    expect(argsInvalid.some((a) => a.includes('model_reasoning_effort'))).toBe(false);
  });
});
