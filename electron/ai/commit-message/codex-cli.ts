// electron/ai/commit-message/codex-cli.ts
//
// Ejecución de Codex CLI para redacción de mensajes de commit (D6, D13, D15).
// Corre en una carpeta temporal vacía, prompt por stdin, con tope de tiempo y
// cancelación que mata el proceso.
//
// El ejecutable se resuelve como lo hace el lanzador de SDD
// (`resolveRuntimeExecutable`): en Windows `codex` suele ser un acceso `.cmd`
// de npm o pnpm, que `spawn('codex', { shell: false })` no encuentra (ENOENT,
// medido en la máquina de Ale el 2026-10-01) y que sólo puede lanzarse a
// través del shell.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CommitDraftResult, DraftChunk } from '../../../types/commit-message-ai';
import {
  resolveRuntimeExecutable,
  type RuntimeExecutableResolution,
} from '../../pipeline/runtime-adapters/process-runner';
import { parseDraftResponse } from './local-provider';

export type SpawnFunction = typeof spawn;
export type ResolveExecutableFunction = (
  name: string,
  env: Record<string, string | undefined>,
) => Promise<RuntimeExecutableResolution>;

/**
 * Con un `.cmd` el proceso pasa por el shell: el modelo, que viene del archivo
 * de la persona, sólo puede tener caracteres de un identificador de modelo.
 */
const SAFE_MODEL_ID = /^[A-Za-z0-9._:/-]+$/;

export interface CodexDraftOptions {
  model: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onChunk?: (chunks: DraftChunk[]) => void;
  spawnFn?: SpawnFunction;
  resolveExecutable?: ResolveExecutableFunction;
}

export async function draftCommitWithCodex(options: CodexDraftOptions): Promise<CommitDraftResult> {
  const {
    model,
    prompt,
    signal,
    timeoutMs = 120_000,
    onChunk,
    spawnFn = spawn,
    resolveExecutable = resolveRuntimeExecutable,
  } = options;

  if (!SAFE_MODEL_ID.test(model)) {
    return { status: 'unavailable', detail: `El modelo «${model}» tiene caracteres que no corresponden a un identificador de modelo.` };
  }

  let resolution: RuntimeExecutableResolution;
  try {
    resolution = await resolveExecutable('codex', process.env);
  } catch (err: any) {
    return { status: 'unavailable', detail: err?.message ?? String(err) };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitcron-codex-'));
  try {
    const args = [
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '-m',
      model,
      '-',
    ];

    return await new Promise<CommitDraftResult>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnFn(resolution.file, args, {
          cwd: tempDir,
          shell: resolution.viaShell,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcessWithoutNullStreams;
      } catch (err: any) {
        resolve({
          status: 'unavailable',
          detail: err?.message ?? String(err),
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: CommitDraftResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      const killProcess = () => {
        if (!child.killed) {
          try {
            child.kill('SIGTERM');
            const forceKill = setTimeout(() => {
              if (!child.killed) child.kill('SIGKILL');
            }, 1000);
            forceKill.unref?.();
          } catch {
            // Ignorar errores al matar el proceso
          }
        }
      };

      const timer = setTimeout(() => {
        killProcess();
        finish({
          status: 'unavailable',
          detail: `Codex tardó demasiado (${Math.round(timeoutMs / 1000)}s) y se canceló.`,
        });
      }, timeoutMs);
      timer.unref?.();

      const onAbort = () => {
        killProcess();
        finish({
          status: 'unavailable',
          detail: 'Redacción cancelada.',
        });
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err: Error) => {
        finish({
          status: 'unavailable',
          detail: err.message,
        });
      });

      child.on('close', (code: number | null) => {
        if (settled) return;

        const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
        let lastAgentMessage: string | null = null;
        let errorMessage: string | null = null;

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'error') {
              errorMessage = parsed.message || line;
            } else if (parsed.item?.type === 'error') {
              errorMessage = parsed.item.message || line;
            } else if (
              parsed.type === 'item.completed' &&
              parsed.item?.type === 'agent_message' &&
              typeof parsed.item.text === 'string'
            ) {
              lastAgentMessage = parsed.item.text;
            }
          } catch {
            // Línea no JSON
          }
        }

        if (errorMessage) {
          finish({ status: 'unavailable', detail: errorMessage });
          return;
        }

        if (code !== 0 && !lastAgentMessage) {
          const detail = stderr.trim() || `Codex finalizó con código ${code}`;
          finish({ status: 'unavailable', detail });
          return;
        }

        if (!lastAgentMessage) {
          finish({
            status: 'unavailable',
            detail: stderr.trim() || 'Codex no devolvió ningún mensaje.',
          });
          return;
        }

        onChunk?.([{ kind: 'content', text: lastAgentMessage }]);

        const payload = {
          choices: [{ message: { content: lastAgentMessage } }],
        };
        finish(parseDraftResponse(payload, model));
      });

      if (child.stdin) {
        child.stdin.end(prompt);
      }
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
