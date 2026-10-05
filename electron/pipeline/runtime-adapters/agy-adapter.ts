// electron/pipeline/runtime-adapters/agy-adapter.ts
//
// Adaptador estructurado de Antigravity (`agy`) para SDD (tarea 5.2, Decisión D9, Opción B).
//
// Reemplaza al anterior wrapper de ciclo de vida (`agy-wrapper`).
// Ejecuta:
// `agy -p <instruccion> --output-format stream-json --mode accept-edits [--model <m>] [--effort <e>] [--conversation <id>]`
//
// Características:
// - `runsCommands: false`: Antigravity lee y modifica archivos del repositorio, pero no ejecuta
//   comandos en modo sin pantalla (-p).
// - Sin `--dangerously-skip-permissions`.
// - Soporta reanudación mediante `--conversation`.
// - Detecta acciones denegadas (`denied_actions`): un comando rechazado termina la corrida con
//   `success: false` y motivo visible aunque el estado final de Antigravity sea `SUCCESS`.

import type { RuntimeDescriptor } from '../../../types/pipeline';
import { isValidCliEffort } from '../../ai/cli-text-client';
import { AgyStreamNormalizer } from './agy-normalizer';
import { RuntimeProcessRunner } from './process-runner';
import type { RuntimeStartRequest } from './runtime-adapter';
import { StructuredCliRuntimeAdapter } from './structured-cli-adapter';

const STREAM_FIXTURE_REF = 'electron/__tests__/fixtures/f03/fixtures/agy-1.2.13-stream.sanitized.jsonl';
const RESUME_FIXTURE_REF = 'electron/__tests__/fixtures/f03/fixtures/agy-1.2.13-resume.sanitized.jsonl';

export const AGY_DESCRIPTOR: RuntimeDescriptor = {
  adapterId: 'agy-cli',
  runtime: 'agy',
  adapterKind: 'structured-cli',
  transport: 'stream-json',
  runtimeVersion: '1.2.13',
  protocolVersion: null,
  capabilities: [
    {
      capabilityId: 'session.start',
      capabilityVersion: null,
      availability: 'available',
      evidenceStatus: 'pending_fixture',
      targetScopes: ['repo', 'run'],
      constraints: ['edita archivos en el repositorio con --mode accept-edits', 'runsCommands: false'],
      evidenceRefs: [STREAM_FIXTURE_REF],
    },
    {
      capabilityId: 'events.stream',
      capabilityVersion: null,
      availability: 'available',
      evidenceStatus: 'pending_fixture',
      targetScopes: ['session'],
      constraints: ['bounded stream-json JSONL'],
      evidenceRefs: [STREAM_FIXTURE_REF],
    },
    {
      capabilityId: 'telemetry.snapshot',
      capabilityVersion: null,
      availability: 'available',
      evidenceStatus: 'pending_fixture',
      targetScopes: ['run', 'session'],
      constraints: ['result usage tokens', 'thinking tokens', 'cost unavailable'],
      evidenceRefs: [STREAM_FIXTURE_REF],
    },
    {
      capabilityId: 'session.resume',
      capabilityVersion: null,
      availability: 'unknown',
      evidenceStatus: 'pending_fixture',
      targetScopes: ['session'],
      constraints: ['--conversation'],
      evidenceRefs: [RESUME_FIXTURE_REF],
    },
  ],
};

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._\-/:@]+$/;

export function isValidAgyModelArg(modelArg: string | undefined | null): boolean {
  return typeof modelArg === 'string' && modelArg.length > 0 && SAFE_IDENTIFIER_PATTERN.test(modelArg);
}

export function isValidAgySessionId(sessionId: string | undefined | null): boolean {
  return typeof sessionId === 'string' && sessionId.length > 0 && SAFE_IDENTIFIER_PATTERN.test(sessionId);
}

export interface AgyStartRequest extends RuntimeStartRequest {
  resumeSessionId?: string | null;
}

export function buildAgyArgs(request: AgyStartRequest): string[] {
  if (request.requestedModel && !isValidAgyModelArg(request.requestedModel)) {
    throw new Error('invalid_model_identifier');
  }

  const args: string[] = [
    '-p',
    request.instruction,
    '--output-format',
    'stream-json',
    '--mode',
    'accept-edits',
  ];

  if (request.reasoningEffort && isValidCliEffort('antigravity', request.reasoningEffort)) {
    args.push('--effort', request.reasoningEffort);
  }

  if (request.requestedModel) {
    args.push('--model', request.requestedModel);
  }

  if (request.resumeSessionId) {
    if (!isValidAgySessionId(request.resumeSessionId)) {
      throw new Error('invalid_session_identifier');
    }
    args.push('--conversation', request.resumeSessionId);
  }

  if (request.timeoutMs && request.timeoutMs > 0) {
    args.push('--print-timeout', `${Math.max(1, Math.ceil(request.timeoutMs / 1000))}s`);
  }

  return args;
}

export function createAgyRuntimeAdapter(
  canonicalRepoPath: string,
  runner = new RuntimeProcessRunner(),
  now?: () => string,
): StructuredCliRuntimeAdapter {
  return new StructuredCliRuntimeAdapter(
    canonicalRepoPath,
    {
      descriptor: AGY_DESCRIPTOR,
      executable: 'agy',
      versionArgs: ['--version'],
      matchesFixtureVersion: (output) => output.trim() === '1.2.13',
      buildArgs: buildAgyArgs,
      createNormalizer: () => new AgyStreamNormalizer(),
      evidenceRef: STREAM_FIXTURE_REF,
    },
    runner,
    now,
  );
}
