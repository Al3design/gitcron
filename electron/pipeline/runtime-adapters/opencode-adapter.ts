// electron/pipeline/runtime-adapters/opencode-adapter.ts
//
// Adaptador de runtime para OpenCode mediante `opencode run` (tarea 5.3, D1, D7, D8, D13, D17).
//
// Reemplaza al anterior adaptador de ACP.
// Ejecuta:
// `opencode run -m <proveedor>/<modelo>[#variante] --format json --auto [--session <id>]`
//
// La instrucción se envía exclusivamente por la entrada estándar (stdin), la cual se
// cierra inmediatamente para evitar bloqueos del CLI.
// El modelo, la variante y el identificador de sesión se validan con un patrón conservador
// antes de lanzar el subproceso.

import type { RuntimeDescriptor } from '../../../types/pipeline';
import { OpencodeStreamNormalizer } from './opencode-normalizer';
import { RuntimeProcessRunner } from './process-runner';
import type { RuntimeStartRequest } from './runtime-adapter';
import { StructuredCliRuntimeAdapter } from './structured-cli-adapter';

// La evidencia de la corrida son las dos capturas de `opencode run --format json` (2.0.20, 2026-10-04).
const RUN_FIXTURE_REFS = [
  'electron/__tests__/fixtures/modelos-en-casa/opencode-2.0.20-run-simple.jsonl',
  'electron/__tests__/fixtures/modelos-en-casa/opencode-2.0.20-run-lee-archivo.jsonl',
];

export const OPENCODE_DESCRIPTOR: RuntimeDescriptor = {
  adapterId: 'opencode-cli',
  runtime: 'opencode',
  adapterKind: 'structured-cli',
  transport: 'exec-jsonl',
  runtimeVersion: '2.0.20',
  protocolVersion: null,
  capabilities: [
    {
      capabilityId: 'session.start',
      capabilityVersion: null,
      availability: 'available',
      evidenceStatus: 'pending_fixture',
      targetScopes: ['repo', 'run'],
      constraints: ['edita archivos y corre comandos con OpenCode run', 'mode --auto'],
      evidenceRefs: RUN_FIXTURE_REFS,
    },
    {
      capabilityId: 'events.stream',
      capabilityVersion: null,
      availability: 'available',
      evidenceStatus: 'pending_fixture',
      targetScopes: ['session'],
      constraints: ['bounded JSONL'],
      evidenceRefs: RUN_FIXTURE_REFS,
    },
    {
      capabilityId: 'telemetry.snapshot',
      capabilityVersion: null,
      availability: 'available',
      evidenceStatus: 'pending_fixture',
      targetScopes: ['run', 'session'],
      constraints: ['step_finish tokens and cost'],
      evidenceRefs: RUN_FIXTURE_REFS,
    },
    {
      capabilityId: 'session.resume',
      capabilityVersion: null,
      availability: 'available',
      evidenceStatus: 'verified',
      targetScopes: ['session'],
      constraints: ['--session'],
      evidenceRefs: [
        'electron/__tests__/fixtures/modelos-en-casa/opencode-2.0.20-resume-inicial.jsonl',
        'electron/__tests__/fixtures/modelos-en-casa/opencode-2.0.20-resume-continuacion.jsonl',
        'electron/__tests__/fixtures/modelos-en-casa/opencode-2.0.20-resume-sesion-inexistente.jsonl',
      ],
    },
  ],
};

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._\-/:@]+$/;

/**
 * Valida el argumento de modelo para OpenCode (`<proveedor>/<modelo>[#<variante>]`).
 * Conservador: letras, números, '.', '_', '-', '/', ':', '@'; variante tras un único '#'.
 */
export function isValidOpenCodeModelArg(modelArg: string | undefined | null): boolean {
  if (!modelArg || typeof modelArg !== 'string') return false;
  const parts = modelArg.split('#');
  if (parts.length > 2) return false;
  if (!SAFE_IDENTIFIER_PATTERN.test(parts[0])) return false;
  if (parts.length === 2 && (!parts[1] || !SAFE_IDENTIFIER_PATTERN.test(parts[1]))) return false;
  return true;
}

/**
 * Valida un identificador de sesión para `--session`.
 */
export function isValidOpenCodeSessionId(sessionId: string | undefined | null): boolean {
  return typeof sessionId === 'string' && sessionId.length > 0 && SAFE_IDENTIFIER_PATTERN.test(sessionId);
}

export interface OpenCodeStartRequest extends RuntimeStartRequest {
  resumeSessionId?: string | null;
}

export function buildOpenCodeArgs(request: OpenCodeStartRequest): string[] {
  const modelArg = request.requestedModel;
  if (!isValidOpenCodeModelArg(modelArg)) {
    throw new Error('invalid_model_identifier');
  }

  // `--auto` va siempre, porque el lanzador ya exige la confirmación de escritura (D8)
  const args = ['run', '-m', modelArg!, '--format', 'json', '--auto'];

  if (request.resumeSessionId) {
    if (!isValidOpenCodeSessionId(request.resumeSessionId)) {
      throw new Error('invalid_session_identifier');
    }
    args.push('--session', request.resumeSessionId);
  }

  return args;
}

export function createOpenCodeRuntimeAdapter(
  canonicalRepoPath: string,
  runner = new RuntimeProcessRunner(),
  now?: () => string,
): StructuredCliRuntimeAdapter {
  return new StructuredCliRuntimeAdapter(
    canonicalRepoPath,
    {
      descriptor: OPENCODE_DESCRIPTOR,
      executable: 'opencode',
      versionArgs: ['--version'],
      matchesFixtureVersion: (output) => output.includes('2.0.20'),
      buildArgs: buildOpenCodeArgs,
      createNormalizer: () => new OpencodeStreamNormalizer(),
      evidenceRef: RUN_FIXTURE_REFS[0],
    },
    runner,
    now,
  );
}
