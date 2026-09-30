// electron/ai/commit-message/codex-cli.ts
//
// Ejecución de Codex CLI para redacción de mensajes de commit (D6, D13, D15).
// Corre en una carpeta temporal vacía, sin shell, prompt por stdin,
// con tope de tiempo y cancelación que mata el proceso.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CommitDraftResult, DraftChunk } from '../../../types/commit-message-ai';
import { parseDraftResponse } from './local-provider';

export type SpawnFunction = typeof spawn;

export interface CodexDraftOptions {
  model: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onChunk?: (chunks: DraftChunk[]) => void;
  spawnFn?: SpawnFunction;
}

export async function draftCommitWithCodex(options: CodexDraftOptions): Promise<CommitDraftResult> {
  const { model, prompt, signal, timeoutMs = 120_000, onChunk, spawnFn = spawn } = options;

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
        child = spawnFn('codex', args, {
          cwd: tempDir,
          shell: false,
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
