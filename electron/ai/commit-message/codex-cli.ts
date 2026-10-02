// electron/ai/commit-message/codex-cli.ts
//
// Redacción del mensaje de commit con un CLI de suscripción (D6, D13, D15). La
// ejecución es la del cliente de texto por CLI (tarea 4.2): carpeta temporal
// vacía, pedido por stdin, tope de tiempo y cancelación que terminan el proceso.
// Acá sólo se traduce su resultado al de la redacción.
//
// El ejecutable se resuelve como lo hace el lanzador de SDD
// (`resolveRuntimeExecutable`): en Windows `codex` suele ser un acceso `.cmd`
// de npm o pnpm, que `spawn('codex', { shell: false })` no encuentra (ENOENT,
// medido en la máquina de Ale el 2026-10-01) y que sólo puede lanzarse a
// través del shell.

import type { CommitDraftResult, DraftChunk } from '../../../types/commit-message-ai';
import {
  buildCodexTextArgs,
  runCliText,
  type CliTextId,
  type KillTreeFunction,
  type ResolveExecutableFunction,
  type SpawnFunction,
} from '../cli-text-client';
import { parseDraftResponse } from './local-provider';

export type { ResolveExecutableFunction, SpawnFunction } from '../cli-text-client';

/** Los argumentos de Codex para la redacción: los mismos del cliente de texto. */
export const buildCodexDraftArgs = buildCodexTextArgs;

export interface CliDraftOptions {
  cli: CliTextId;
  model: string;
  prompt: string;
  effort?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onChunk?: (chunks: DraftChunk[]) => void;
  spawnFn?: SpawnFunction;
  resolveExecutable?: ResolveExecutableFunction;
  killTree?: KillTreeFunction;
}

export async function draftCommitWithCli(options: CliDraftOptions): Promise<CommitDraftResult> {
  const result = await runCliText(options);
  if (result.status === 'failed') {
    return { status: 'unavailable', detail: result.reason === 'cancelled' ? 'Redacción cancelada.' : result.detail };
  }
  return parseDraftResponse({ choices: [{ message: { content: result.text } }] }, options.model);
}

export type CodexDraftOptions = Omit<CliDraftOptions, 'cli'>;

export function draftCommitWithCodex(options: CodexDraftOptions): Promise<CommitDraftResult> {
  return draftCommitWithCli({ ...options, cli: 'codex' });
}
