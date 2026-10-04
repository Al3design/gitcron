import type { RuntimeDescriptor } from '../../../types/pipeline';
import { isValidCliEffort } from '../../ai/cli-text-client';
import { ClaudeStreamNormalizer } from './claude-normalizer';
import { RuntimeProcessRunner } from './process-runner';
import type { RuntimeStartRequest } from './runtime-adapter';
import { StructuredCliRuntimeAdapter } from './structured-cli-adapter';

const FIXTURE_REF = '';

export const CLAUDE_DESCRIPTOR: RuntimeDescriptor = {
  adapterId: 'claude-code',
  runtime: 'claude',
  adapterKind: 'native-stream',
  transport: 'stream-json',
  runtimeVersion: '2.1.206',
  protocolVersion: null,
  capabilities: [
    { capabilityId: 'session.start', capabilityVersion: null, availability: 'available', evidenceStatus: 'pending_fixture', targetScopes: ['repo', 'run'], constraints: ['edita archivos y corre comandos con Read, Grep, Glob, Edit, Write, Bash', 'permission-mode acceptEdits'], evidenceRefs: [] },
    { capabilityId: 'events.stream', capabilityVersion: null, availability: 'available', evidenceStatus: 'pending_fixture', targetScopes: ['session'], constraints: ['bounded JSONL'], evidenceRefs: [] },
    { capabilityId: 'telemetry.snapshot', capabilityVersion: null, availability: 'available', evidenceStatus: 'pending_fixture', targetScopes: ['run', 'session'], constraints: ['billing semantics remain unknown'], evidenceRefs: [] },
    { capabilityId: 'session.resume', capabilityVersion: null, availability: 'unknown', evidenceStatus: 'pending_fixture', targetScopes: ['session'], constraints: ['effect not tested'], evidenceRefs: [] },
  ],
};

/**
 * Superficie de herramientas de una sesión de Apply.
 *
 * Toda IA lanzable desde SDD tiene las mismas capacidades: leer, escribir en
 * el repositorio y correr comandos/pruebas dentro de él, con confirmación previa
 * de la persona. Se incluye `Bash` junto con herramientas de lectura y edición,
 * manteniendo `--permission-mode acceptEdits`. Se descarta `--dangerously-skip-permissions`.
 */
const CLAUDE_TOOLS = 'Read,Grep,Glob,Edit,Write,Bash';

function buildClaudeArgs(request: RuntimeStartRequest): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    // `manual` es inservible en modo headless: no hay quién responda el pedido
    // de permiso y la sesión se cuelga en la primera escritura. `acceptEdits`
    // acepta ediciones de archivo sin habilitar todo lo demás.
    '--permission-mode', 'acceptEdits',
    `--tools=${CLAUDE_TOOLS}`,
    `--allowedTools=${CLAUDE_TOOLS}`,
  ];
  if (request.reasoningEffort && isValidCliEffort('claude-code', request.reasoningEffort)) {
    args.push('--effort', request.reasoningEffort);
  }
  if (request.requestedModel) args.push('--model', request.requestedModel);
  return args;
}

export function createClaudeRuntimeAdapter(
  canonicalRepoPath: string,
  runner = new RuntimeProcessRunner(),
  now?: () => string,
): StructuredCliRuntimeAdapter {
  return new StructuredCliRuntimeAdapter(canonicalRepoPath, {
    descriptor: CLAUDE_DESCRIPTOR,
    executable: 'claude',
    versionArgs: ['--version'],
    matchesFixtureVersion: (output) => output === '2.1.206 (Claude Code)',
    buildArgs: buildClaudeArgs,
    createNormalizer: () => new ClaudeStreamNormalizer(),
    evidenceRef: FIXTURE_REF,
  }, runner, now);
}
