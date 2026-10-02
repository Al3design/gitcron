// electron/ai/cli-text-client.ts
//
// Cliente de texto por CLI de suscripción (tarea 4.2 de modelos-en-casa, D6).
// Corre Codex, Claude Code o Antigravity sin interacción, en una carpeta
// temporal vacía, sin herramientas que escriban, con el pedido por stdin y la
// salida en JSON; con tope de tiempo y cancelación que terminan el proceso y
// todo lo que haya lanzado.
//
// Medido el 2026-10-01 en la máquina de Ale (las órdenes salen de la tabla de D6):
// - Claude Code 2.1.284: un JSON con `result`, `is_error` y `usage`. Sin sesión
//   contesta `is_error: true` y «Not logged in · Please run /login». Las opciones
//   vacías van pegadas (`--tools=`, `--setting-sources=`): por el shell de Windows
//   un argumento vacío se pierde, y así el resultado es el mismo (6,8 mil tokens).
// - Codex 0.144.4: JSONL. Sin sesión reintenta cinco veces con «Reconnecting… n/5»
//   (`type: "error"`, que NO es el fallo final) y cierra con `turn.failed` y
//   «401 Unauthorized: Missing bearer or basic authentication».
// - Antigravity 1.2.13: `-p` no lee stdin (toma la opción siguiente como pedido, o
//   `-` como texto). El pedido entra por stdin con `--input-format stream-json`:
//   una línea `{"event":"user","message":{"role":"user","content":[{"type":"text",
//   "text":…}]}}`; la respuesta llega en `step_update` (`text_delta`) y `result`.
//   Con un pedido corto intentó correr un comando: el modo sin interacción lo
//   niega, `result.status` dice SUCCESS con `denied_actions` y la respuesta vacía.
//   La salida sin sesión no se pudo medir (la sesión no vive en la carpeta de la
//   persona): un `status: "ERROR"` se informa con su texto.
//
// Ninguno escribió en la carpeta temporal.

import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DraftChunk, DraftUsage } from '../../types/commit-message-ai';
import {
  resolveRuntimeExecutable,
  type RuntimeExecutableResolution,
} from '../pipeline/runtime-adapters/process-runner';

export type CliTextId = 'codex' | 'claude-code' | 'antigravity';
export type SpawnFunction = typeof spawn;
export type ResolveExecutableFunction = (
  name: string,
  env: Record<string, string | undefined>,
) => Promise<RuntimeExecutableResolution>;
/** Termina el proceso y lo que haya lanzado. */
export type KillTreeFunction = (child: ChildProcess) => void;

/**
 * Con un `.cmd` el proceso pasa por el shell: el modelo, que viene del archivo
 * de la persona, sólo puede tener caracteres de un identificador de modelo.
 */
export const SAFE_MODEL_ID = /^[A-Za-z0-9._:/-]+$/;

const CLI_LABEL: Record<CliTextId, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  antigravity: 'Antigravity',
};

const CLI_EXECUTABLE: Record<CliTextId, string> = {
  codex: 'codex',
  'claude-code': 'claude',
  antigravity: 'agy',
};

/** Cómo iniciar sesión en cada CLI, para el motivo «sin sesión». */
const CLI_LOGIN_HINT: Record<CliTextId, string> = {
  codex: 'corré «codex login» en una terminal',
  'claude-code': 'corré «claude» en una terminal y usá /login',
  antigravity: 'corré «agy» en una terminal e iniciá sesión',
};

export function cliLabel(cli: CliTextId): string {
  return CLI_LABEL[cli];
}

export function cliExecutable(cli: CliTextId): string {
  return CLI_EXECUTABLE[cli];
}

/**
 * Los argumentos de Codex. Exportados para que «Ver lo enviado» muestre los
 * mismos que corren y no una copia que se desactualice.
 *
 * `--ignore-user-config` y `--ignore-rules`: sin ellos Codex carga el
 * `config.toml` de la persona —sus conectores MCP, que fallan sin sesión y
 * ensucian la salida— y sus skills. Medido el 2026-10-01 con «Respondé sólo
 * con: feat: prueba»: 20 847 tokens de entrada y un aviso de skills recortadas;
 * con los dos, 12 556 y sin avisos. La sesión de la cuenta sigue andando
 * (vive en `CODEX_HOME`, no en el archivo).
 */
export function buildCodexTextArgs(model: string): string[] {
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
 * Claude Code sin herramientas, sin guardar la sesión y sin cargar los ajustes,
 * CLAUDE.md, skills ni MCP de la persona: con ellos, la misma línea costó 131 mil
 * tokens (D6). `--bare` no sirve: ignora la sesión de suscripción.
 */
export function buildClaudeTextArgs(model: string): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--tools=',
    '--no-session-persistence',
    '--setting-sources=',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--model',
    model,
  ];
}

/** Antigravity en modo plan, con el pedido por stdin en su formato de eventos. */
export function buildAntigravityTextArgs(model: string, timeoutMs: number): string[] {
  return [
    '-p=',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--mode',
    'plan',
    '--model',
    model,
    '--print-timeout',
    `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
  ];
}

export function buildAntigravityStdin(prompt: string): string {
  return `${JSON.stringify({ event: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } })}\n`;
}

export interface CliTextCommand {
  executable: string;
  args: string[];
  stdin: string;
}

export function buildCliTextCommand(cli: CliTextId, model: string, prompt: string, timeoutMs: number): CliTextCommand {
  switch (cli) {
    case 'codex':
      return { executable: CLI_EXECUTABLE.codex, args: buildCodexTextArgs(model), stdin: prompt };
    case 'claude-code':
      return { executable: CLI_EXECUTABLE['claude-code'], args: buildClaudeTextArgs(model), stdin: prompt };
    case 'antigravity':
      return {
        executable: CLI_EXECUTABLE.antigravity,
        args: buildAntigravityTextArgs(model, timeoutMs),
        stdin: buildAntigravityStdin(prompt),
      };
  }
}

/** La orden como se muestra en «Ver lo enviado» (D14), sin el pedido. */
export function describeCliTextCommand(cli: CliTextId, model: string, timeoutMs = DEFAULT_CLI_TIMEOUT_MS): string {
  const { executable, args } = buildCliTextCommand(cli, model, '', timeoutMs);
  return [executable, ...args].join(' ');
}

export type CliFailReason = 'not-installed' | 'no-session' | 'timeout' | 'cancelled' | 'invalid-model' | 'error';

export type CliTextResult =
  | { status: 'ok'; text: string; usage: DraftUsage | null; warnings: string[] }
  | { status: 'failed'; reason: CliFailReason; detail: string };

export interface CliTextOptions {
  cli: CliTextId;
  model: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onChunk?: (chunks: DraftChunk[]) => void;
  spawnFn?: SpawnFunction;
  resolveExecutable?: ResolveExecutableFunction;
  killTree?: KillTreeFunction;
  /** Cuánto se espera a que el proceso termine después de matarlo. */
  exitGraceMs?: number;
}

export const DEFAULT_CLI_TIMEOUT_MS = 120_000;

/**
 * En Windows un CLI de npm corre detrás de `cmd.exe`: matar sólo al hijo deja
 * vivo al proceso real. `taskkill /T` termina el árbol entero.
 */
const hasExited = (child: ChildProcess) => typeof child.exitCode === 'number' || typeof child.signalCode === 'string';

export const defaultKillTree: KillTreeFunction = (child) => {
  if (hasExited(child)) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => {
        try { child.kill(); } catch { /* ya terminó */ }
      });
      return;
    } catch {
      // Sin taskkill: al menos el hijo.
    }
  }
  try {
    child.kill('SIGTERM');
    const force = setTimeout(() => {
      if (!hasExited(child)) child.kill('SIGKILL');
    }, 1000);
    force.unref?.();
  } catch {
    // Ya terminó.
  }
};

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

const intVal = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sumOrNull = (...values: Array<number | null>): number | null =>
  values.every((v) => v === null) ? null : values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

function codexUsage(raw: any): DraftUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    promptTokens: intVal(raw.input_tokens),
    cachedPromptTokens: intVal(raw.cached_input_tokens),
    completionTokens: intVal(raw.output_tokens),
    reasoningTokens: intVal(raw.reasoning_output_tokens),
  };
}

/** Claude informa la entrada en tres partes: sin caché, escrita en caché y leída de caché. */
function claudeUsage(raw: any): DraftUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const cached = intVal(raw.cache_read_input_tokens);
  return {
    promptTokens: sumOrNull(intVal(raw.input_tokens), intVal(raw.cache_creation_input_tokens), cached),
    cachedPromptTokens: cached,
    completionTokens: intVal(raw.output_tokens),
    reasoningTokens: intVal(raw.output_tokens_details?.thinking_tokens),
  };
}

function antigravityUsage(raw: any): DraftUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    promptTokens: intVal(raw.input_tokens),
    cachedPromptTokens: intVal(raw.cache_read_tokens),
    completionTokens: intVal(raw.output_tokens),
    reasoningTokens: intVal(raw.thinking_tokens),
  };
}

const NO_SESSION = {
  codex: /401 Unauthorized|Missing bearer|not logged in|codex login/i,
  'claude-code': /not logged in|\/login|invalid api key/i,
  antigravity: /not (signed|logged) in|sign in|log ?in|unauthenticated|credentials/i,
} satisfies Record<CliTextId, RegExp>;

/** Lo que va armando cada CLI a partir de su salida. */
interface OutputParser {
  line(line: string): void;
  /** Al cerrar: la respuesta o el motivo del fallo. */
  end(code: number | null, stderr: string): CliTextResult;
}

function codexParser(onChunk?: (chunks: DraftChunk[]) => void): OutputParser {
  let message: string | null = null;
  let failure: string | null = null;
  let lastError: string | null = null;
  const warnings: string[] = [];
  let usage: DraftUsage | null = null;
  return {
    // Medido con Codex 0.144.4:
    // - `item.completed` con `item.type: "error"` es un AVISO: la respuesta llega
    //   igual en el ítem siguiente (tratarlo como fallo tiró la primera redacción
    //   de Ale).
    // - `type: "error"` con «Reconnecting… n/5» es un reintento, no el final: si
    //   después llega la respuesta, vale la respuesta.
    // - El fallo de verdad es `turn.failed`, con salida 1.
    line(line) {
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { return; }
      if (parsed.type === 'error' && typeof parsed.message === 'string') {
        lastError = readableCodexError(parsed.message);
      } else if (parsed.type === 'turn.failed') {
        failure = readableCodexError(parsed.error?.message ?? lastError ?? line);
      } else if (parsed.type === 'item.completed' && typeof parsed.item?.text === 'string') {
        if (parsed.item.type === 'agent_message') message = parsed.item.text;
        else if (parsed.item.type === 'reasoning') onChunk?.([{ kind: 'reasoning', text: parsed.item.text }]);
      } else if (parsed.type === 'item.completed' && parsed.item?.type === 'error') {
        if (typeof parsed.item.message === 'string') warnings.push(parsed.item.message);
      } else if (parsed.type === 'turn.completed') {
        usage = codexUsage(parsed.usage);
      }
    },
    end(code, stderr) {
      if (failure) return { status: 'failed', reason: NO_SESSION.codex.test(failure) ? 'no-session' : 'error', detail: failure };
      if (message) return { status: 'ok', text: message, usage, warnings };
      // Sin respuesta, los avisos son la mejor pista de qué pasó.
      const detail = [lastError, ...warnings, stderr.trim()].filter(Boolean).join('\n')
        || (code !== 0 ? `Codex terminó con código ${code}` : 'Codex no devolvió ningún mensaje.');
      return { status: 'failed', reason: NO_SESSION.codex.test(detail) ? 'no-session' : 'error', detail };
    },
  };
}

function claudeParser(): OutputParser {
  let result: any = null;
  return {
    line(line) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && 'result' in parsed) result = parsed;
      } catch {
        // No es el JSON final.
      }
    },
    end(code, stderr) {
      if (!result) {
        const detail = stderr.trim() || `Claude Code terminó con código ${code} sin respuesta.`;
        return { status: 'failed', reason: NO_SESSION['claude-code'].test(detail) ? 'no-session' : 'error', detail };
      }
      const text = typeof result.result === 'string' ? result.result : '';
      if (result.is_error === true) {
        return { status: 'failed', reason: NO_SESSION['claude-code'].test(text) ? 'no-session' : 'error', detail: text || 'Claude Code informó un error.' };
      }
      if (!text.trim()) return { status: 'failed', reason: 'error', detail: 'Claude Code no devolvió ningún mensaje.' };
      return { status: 'ok', text, usage: claudeUsage(result.usage), warnings: [] };
    },
  };
}

function antigravityParser(onChunk?: (chunks: DraftChunk[]) => void): OutputParser {
  let result: any = null;
  let streamed = '';
  return {
    line(line) {
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { return; }
      if (parsed.event === 'step_update') {
        const step = parsed.step_update;
        if (step?.step_type === 'agent_response' && typeof step.text_delta === 'string' && step.text_delta) {
          streamed += step.text_delta;
          onChunk?.([{ kind: 'content', text: step.text_delta }]);
        }
      } else if (parsed.event === 'result') {
        result = parsed.result;
      }
    },
    end(code, stderr) {
      if (!result) {
        const detail = stderr.trim() || `Antigravity terminó con código ${code} sin respuesta.`;
        return { status: 'failed', reason: NO_SESSION.antigravity.test(detail) ? 'no-session' : 'error', detail };
      }
      if (result.status !== 'SUCCESS') {
        const detail = typeof result.error === 'string' && result.error ? result.error : `Antigravity terminó con estado ${result.status}.`;
        return { status: 'failed', reason: NO_SESSION.antigravity.test(detail) ? 'no-session' : 'error', detail };
      }
      const text = typeof result.response === 'string' ? result.response : streamed;
      if (!text.trim()) {
        const denied = Array.isArray(result.denied_actions)
          ? result.denied_actions.map((a: any) => a?.display_name ?? a?.action).filter(Boolean)
          : [];
        const detail = denied.length > 0
          ? `Antigravity quiso usar ${denied.join(', ')}, que en modo texto no se permite, y no dio respuesta.`
          : 'Antigravity no devolvió ningún mensaje.';
        return { status: 'failed', reason: 'error', detail };
      }
      return { status: 'ok', text, usage: antigravityUsage(result.usage), warnings: [] };
    },
  };
}

/**
 * Corre el CLI y devuelve el texto de la respuesta. Nunca lanza: un fallo vuelve
 * con su motivo. Al cancelar o vencer el tiempo, espera a que el proceso termine
 * (con un tope) antes de devolver, así no queda nada vivo ni la carpeta tomada.
 */
export async function runCliText(options: CliTextOptions): Promise<CliTextResult> {
  const {
    cli,
    model,
    prompt,
    signal,
    timeoutMs = DEFAULT_CLI_TIMEOUT_MS,
    onChunk,
    spawnFn = spawn,
    resolveExecutable = resolveRuntimeExecutable,
    killTree = defaultKillTree,
    exitGraceMs = 2000,
  } = options;
  const label = CLI_LABEL[cli];

  if (!SAFE_MODEL_ID.test(model)) {
    return { status: 'failed', reason: 'invalid-model', detail: `El modelo «${model}» tiene caracteres que no corresponden a un identificador de modelo.` };
  }
  if (signal?.aborted) return { status: 'failed', reason: 'cancelled', detail: 'Cancelado.' };

  const command = buildCliTextCommand(cli, model, prompt, timeoutMs);
  let resolution: RuntimeExecutableResolution;
  try {
    resolution = await resolveExecutable(command.executable, process.env);
  } catch (err: any) {
    return { status: 'failed', reason: 'not-installed', detail: `${label} no está instalado o no está en el PATH (${err?.message ?? String(err)}).` };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `gitcron-${cli}-`));
  try {
    return await new Promise<CliTextResult>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnFn(resolution.file, command.args, {
          cwd: tempDir,
          shell: resolution.viaShell,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }) as ChildProcessWithoutNullStreams;
      } catch (err: any) {
        resolve({ status: 'failed', reason: 'not-installed', detail: err?.message ?? String(err) });
        return;
      }

      const parser = cli === 'codex' ? codexParser(onChunk) : cli === 'claude-code' ? claudeParser() : antigravityParser(onChunk);
      let stdout = '';
      let stderr = '';
      let settled = false;
      let exited = false;
      let pending: CliTextResult | null = null;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: CliTextResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      // Cortar: se mata el árbol y se devuelve cuando el proceso terminó de verdad.
      const stop = (result: CliTextResult) => {
        if (settled || pending) return;
        pending = result;
        killTree(child);
        if (exited) {
          finish(result);
          return;
        }
        graceTimer = setTimeout(() => finish(result), exitGraceMs);
        graceTimer.unref?.();
      };

      const timer = setTimeout(() => {
        stop({ status: 'failed', reason: 'timeout', detail: `${label} tardó demasiado (${Math.round(timeoutMs / 1000)} s) y se canceló.` });
      }, timeoutMs);
      timer.unref?.();

      const onAbort = () => stop({ status: 'failed', reason: 'cancelled', detail: 'Cancelado.' });
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        if (pending) return;
        stdout += chunk.toString('utf8');
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) parser.line(line);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err: Error) => {
        exited = true;
        if (pending) finish(pending);
        else finish({ status: 'failed', reason: 'not-installed', detail: err.message });
      });
      child.on('close', (code: number | null) => {
        exited = true;
        if (pending) {
          finish(pending);
          return;
        }
        if (stdout.trim()) parser.line(stdout);
        const result = parser.end(code, stderr);
        if (result.status === 'ok') {
          // La respuesta va al panel recién confirmada; el conteo, después de ella:
          // si llegara antes, el registro la daría por terminada sin mostrarla.
          if (cli !== 'antigravity') onChunk?.([{ kind: 'content', text: result.text }]);
          if (result.usage) onChunk?.([{ kind: 'done', finishReason: null, usage: result.usage }]);
        }
        finish(result);
      });

      child.stdin.on('error', () => undefined);
      child.stdin.end(command.stdin);
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
