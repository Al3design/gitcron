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

/**
 * Los argumentos de la redacción. Exportados para que «Ver lo enviado» muestre
 * los mismos que corren y no una copia que se desactualice.
 *
 * `--ignore-user-config` y `--ignore-rules`: sin ellos Codex carga el
 * `config.toml` de la persona —sus conectores MCP, que fallan sin sesión y
 * ensucian la salida— y sus skills. Medido el 2026-10-01 con «Respondé sólo
 * con: feat: prueba»: 20 847 tokens de entrada y un aviso de skills recortadas;
 * con los dos, 12 556 y sin avisos. La sesión de la cuenta sigue andando
 * (vive en `CODEX_HOME`, no en el archivo). Apagar además las funciones de
 * fábrica (`--disable plugins`, `apps`…) ahorra 1 300 más y pierde la caché.
 */
export function buildCodexDraftArgs(model: string): string[] {
  return [
    'exec',
    '--json',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '-m',
    model,
    '-',
  ];
}

/**
 * Codex manda el motivo de un fallo de la API como JSON dentro del texto
 * (`{"type":"error","status":400,"error":{"message":"…"}}`). Se saca el mensaje
 * legible; si no tiene esa forma, va tal cual.
 */
function readableCodexError(message: string): string {
  try {
    const inner = JSON.parse(message);
    if (typeof inner?.error?.message === 'string') return inner.error.message;
  } catch {
    // No era JSON: el texto ya es legible.
  }
  return message;
}

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
    const args = buildCodexDraftArgs(model);

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

      let lastAgentMessage: string | null = null;
      let errorMessage: string | null = null;
      const warnings: string[] = [];

      // Qué es cada evento, medido con Codex 0.144.4 el 2026-10-01:
      // - `item.completed` con `item.type: "error"` es un AVISO, no un fallo: la
      //   respuesta llega igual en el ítem siguiente. Tratarlo como fallo tiraba
      //   la respuesta buena y mostraba el aviso de skills recortadas (lo vio Ale
      //   en su primera redacción con Codex).
      // - El fallo de verdad viene arriba de todo (`type: "error"`) y en
      //   `turn.failed`, con salida 1.
      const handleLine = (line: string) => {
        if (line.trim().length === 0) return;
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          return; // Línea no JSON
        }
        if (parsed.type === 'error' && typeof parsed.message === 'string') {
          errorMessage = readableCodexError(parsed.message);
        } else if (parsed.type === 'turn.failed') {
          errorMessage ??= readableCodexError(parsed.error?.message ?? line);
        } else if (parsed.type === 'item.completed' && typeof parsed.item?.text === 'string') {
          if (parsed.item.type === 'agent_message') {
            lastAgentMessage = parsed.item.text;
          } else if (parsed.item.type === 'reasoning') {
            onChunk?.([{ kind: 'reasoning', text: parsed.item.text }]);
          }
        } else if (parsed.type === 'item.completed' && parsed.item?.type === 'error') {
          if (typeof parsed.item.message === 'string') warnings.push(parsed.item.message);
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() ?? '';
        lines.forEach(handleLine);
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
        handleLine(stdout);

        if (errorMessage) {
          finish({ status: 'unavailable', detail: errorMessage });
          return;
        }

        // Sin respuesta, los avisos son la mejor pista de qué pasó; con
        // respuesta, no hacen falta.
        if (!lastAgentMessage) {
          const detail =
            [...warnings, stderr.trim()].filter(Boolean).join('\n') ||
            (code !== 0 ? `Codex finalizó con código ${code}` : 'Codex no devolvió ningún mensaje.');
          finish({ status: 'unavailable', detail });
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
