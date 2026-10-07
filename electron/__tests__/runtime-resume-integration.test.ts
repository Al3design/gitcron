import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createOpenCodeRuntimeAdapter } from '../pipeline/runtime-adapters/opencode-adapter';
import { createAgyRuntimeAdapter } from '../pipeline/runtime-adapters/agy-adapter';
import { RuntimeProcessRunner, type RuntimeProcessSpec, type RuntimeProcessResult } from '../pipeline/runtime-adapters/process-runner';
import { RuntimeSessionHub } from '../pipeline/runtime/runtime-session-hub';
import type { RuntimeProjection } from '../../types/pipeline';

class CapturedRunner extends RuntimeProcessRunner {
  specs: RuntimeProcessSpec[] = [];
  constructor(private readonly fixture: string, private readonly version: string, private readonly exitCode = 0) { super(); }
  private result(stdout = ''): RuntimeProcessResult {
    return { processId: 'fixture', exitCode: this.exitCode, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0), durationMs: 1, timedOut: false, aborted: false, outputLimit: null };
  }
  override async run() { return this.result(this.version); }
  override async start(spec: RuntimeProcessSpec) {
    this.specs.push(spec);
    return {
      processId: 'fixture', terminate: () => true,
      result: new Promise<RuntimeProcessResult>((resolve) => {
        setTimeout(() => { spec.onStdout?.(Buffer.from(fs.readFileSync(this.fixture))); resolve(this.result()); }, 0);
      }),
    };
  }
}

function fixture(relative: string) { return path.join(__dirname, 'fixtures', relative); }

describe('continuación: hub → adaptador real → captura → historial', () => {
  it('el método resume admite una instrucción tipada y valida el identificador antes de abrir el proceso', async () => {
    const runner = new CapturedRunner(fixture('modelos-en-casa/opencode-2.0.20-resume-continuacion.jsonl'), '2.0.20');
    const adapter = createOpenCodeRuntimeAdapter('C:/repo', runner);
    const request = {
      repoId: 'repo-1', canonicalRepoPath: 'C:/repo', changeId: null, taskId: null,
      runId: 'run', attemptId: 'attempt', parentSessionId: null, parentAgentId: null,
      orchestrationMode: 'direct' as const, orchestratorRuntime: null, provider: null,
      requestedModel: 'provider/model#high', reasoningEffort: 'high', role: 'builder' as const,
      instruction: 'continuá con esta instrucción', sessionId: 'ses_safe', resumeToken: null,
    };
    await expect(adapter.resume({ ...request, sessionId: 'bad; id' })).rejects.toThrow('invalid_session_identifier');
    expect(runner.specs).toHaveLength(0);
    const session = await adapter.resume(request);
    for await (const _event of adapter.events(session)) { /* consumir el stream real */ }
    expect(runner.specs[0].stdin).toBe(request.instruction);
    expect(runner.specs[0].args).toContain('ses_safe');
  });
  it.each(['opencode', 'agy'] as const)('conserva identificador, modelo y vínculo en %s', async (runtime) => {
    const file = runtime === 'opencode'
      ? fixture('modelos-en-casa/opencode-2.0.20-resume-continuacion.jsonl')
      : fixture('f03/fixtures/agy-1.2.13-resume.sanitized.jsonl');
    const runner = new CapturedRunner(file, runtime === 'opencode' ? '2.0.20' : '1.2.13');
    const adapter = runtime === 'opencode' ? createOpenCodeRuntimeAdapter('C:/repo', runner) : createAgyRuntimeAdapter('C:/repo', runner);
    const persisted: RuntimeProjection[] = [];
    const hub = new RuntimeSessionHub(
      { registerSession: vi.fn(), unregisterSession: vi.fn() }, vi.fn(), undefined,
      [{ runtime, create: () => adapter, launchable: true, modifiesRepo: false, controlCapabilities: [] }],
      { persistRuntimeProjection: (value) => persisted.push(value), loadRuntimeProjections: () => persisted },
    );
    const toolId = runtime === 'opencode' ? 'ses_eee02d47effe6J6Faf58inqdZl' : 'conv-safe-id';
    const model = runtime === 'opencode' ? 'provider/model#high' : 'gemini-3.8-flash-low';
    const result = await hub.start({
      canonicalRepoPath: 'C:/repo', repoId: 'repo-1', runtime, instruction: 'continuá', role: 'builder',
      requestedModel: model, reasoningEffort: 'high', changeId: 'change', taskId: '1.1', resumeSessionId: toolId, continuesSessionId: 'parent',
    });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(hub.get('C:/repo')?.active).toBe(false));
    expect(runner.specs[0].args).toContain(runtime === 'opencode' ? '--session' : '--conversation');
    expect(runner.specs[0].args).toContain(toolId);
    expect(runner.specs[0].args).toContain(model);
    expect(persisted.at(-1)).toMatchObject({ runtimeSessionId: toolId, requestedModel: model, reasoningEffort: 'high', continuesSessionId: 'parent', outcome: 'completed' });
  });

  it('un error de OpenCode conserva el mensaje y termina failed aunque el proceso salga cero', async () => {
    const runner = new CapturedRunner(fixture('modelos-en-casa/opencode-2.0.20-resume-sesion-inexistente.jsonl'), '2.0.20');
    const adapter = createOpenCodeRuntimeAdapter('C:/repo', runner);
    const hub = new RuntimeSessionHub(
      { registerSession: vi.fn(), unregisterSession: vi.fn() }, vi.fn(), undefined,
      [{ runtime: 'opencode', create: () => adapter, launchable: true, modifiesRepo: false, controlCapabilities: [] }],
    );
    await hub.start({ canonicalRepoPath: 'C:/repo', repoId: 'repo-1', runtime: 'opencode', instruction: 'continuá', role: 'builder', requestedModel: 'provider/model', changeId: null, taskId: null, resumeSessionId: 'ses_noexiste000000000000000' });
    await vi.waitFor(() => expect(hub.get('C:/repo')?.active).toBe(false));
    expect(hub.get('C:/repo')?.outcome).toBe('failed');
    expect(hub.get('C:/repo')?.activity.map((entry) => entry.text).join('\n')).toContain("Error from provider (Console): OpenCode's free tier can only be used from within OpenCode");
  });
});
