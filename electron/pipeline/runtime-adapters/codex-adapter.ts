import type { RuntimeDescriptor } from '../../../types/pipeline';
import { isValidCliEffort } from '../../ai/cli-text-client';
import { CodexStreamNormalizer } from './codex-normalizer';
import { RuntimeProcessRunner } from './process-runner';
import type { RuntimeStartRequest } from './runtime-adapter';
import { StructuredCliRuntimeAdapter } from './structured-cli-adapter';

const FIXTURE_REF = '';

export const CODEX_DESCRIPTOR: RuntimeDescriptor = {
  adapterId: 'codex-cli',
  runtime: 'codex',
  adapterKind: 'structured-cli',
  transport: 'exec-jsonl',
  runtimeVersion: '0.143.0',
  protocolVersion: null,
  capabilities: [
    { capabilityId: 'session.start', capabilityVersion: null, availability: 'available', evidenceStatus: 'pending_fixture', targetScopes: ['repo', 'run'], constraints: ['workspace-write sandbox', 'escribe y ejecuta dentro del repositorio', 'red bloqueada por el sandbox'], evidenceRefs: [] },
    { capabilityId: 'events.stream', capabilityVersion: null, availability: 'available', evidenceStatus: 'pending_fixture', targetScopes: ['session'], constraints: ['bounded JSONL'], evidenceRefs: [] },
    { capabilityId: 'telemetry.snapshot', capabilityVersion: null, availability: 'degraded', evidenceStatus: 'pending_fixture', targetScopes: ['run', 'session'], constraints: ['cost and context unavailable'], evidenceRefs: [] },
    { capabilityId: 'session.resume', capabilityVersion: null, availability: 'unknown', evidenceStatus: 'pending_fixture', targetScopes: ['session'], constraints: ['ephemeral capture does not prove resume'], evidenceRefs: [] },
  ],
};

function buildCodexArgs(request: RuntimeStartRequest): string[] {
  const args = ['exec', '--ephemeral', '--sandbox', 'workspace-write', '--json'];
  if (request.reasoningEffort && isValidCliEffort('codex', request.reasoningEffort)) {
    args.push('-c', `model_reasoning_effort=${request.reasoningEffort}`);
  }
  if (request.requestedModel) args.push('--model', request.requestedModel);
  args.push('-');
  return args;
}

export function createCodexRuntimeAdapter(
  canonicalRepoPath: string,
  runner = new RuntimeProcessRunner(),
  now?: () => string,
): StructuredCliRuntimeAdapter {
  return new StructuredCliRuntimeAdapter(canonicalRepoPath, {
    descriptor: CODEX_DESCRIPTOR,
    executable: 'codex',
    versionArgs: ['--version'],
    matchesFixtureVersion: (output) => output === 'codex-cli 0.143.0',
    buildArgs: buildCodexArgs,
    createNormalizer: () => new CodexStreamNormalizer(),
    evidenceRef: FIXTURE_REF,
  }, runner, now);
}
