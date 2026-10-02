// Tarea 4.2 de modelos-en-casa: cliente de texto por CLI (D6). Las salidas son las
// medidas el 2026-10-01 con Codex 0.144.4, Claude Code 2.1.284 y Antigravity 1.2.13.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import type { DraftChunk } from '../../../types/commit-message-ai';
import { buildAntigravityStdin, runCliText, type CliTextId } from '../cli-text-client';

const resolveExecutable = async (name: string) => ({ file: `C:/tools/${name}.exe`, viaShell: false });

interface FakeRun {
  spawnFn: ReturnType<typeof vi.fn>;
  stdin: () => string;
  cwd: () => string;
  args: () => string[];
  command: () => string;
}

/** Un proceso simulado que escribe `stdout` y termina con `exitCode`. */
function fakeProcess(stdout: string, exitCode: number, stderr = ''): FakeRun {
  let stdinText = '';
  let cwd = '';
  let args: string[] = [];
  let command = '';
  const spawnFn = vi.fn((cmd: string, a: string[], opts: any) => {
    command = cmd;
    args = a;
    cwd = opts.cwd;
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdin.on('data', (d: Buffer) => { stdinText += d.toString('utf8'); });
    child.kill = vi.fn();
    child.stdin.on('finish', () => {
      // El directorio existe y está vacío mientras corre.
      expect(fs.readdirSync(cwd)).toEqual([]);
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      child.stdout.on('end', () => setImmediate(() => child.emit('close', exitCode)));
      child.stdout.resume();
    });
    return child;
  });
  return { spawnFn, stdin: () => stdinText, cwd: () => cwd, args: () => args, command: () => command };
}

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n');

async function run(cli: CliTextId, fake: FakeRun, extra: Partial<Parameters<typeof runCliText>[0]> = {}) {
  const chunks: DraftChunk[] = [];
  const result = await runCliText({
    cli,
    model: cli === 'codex' ? 'gpt-5.5' : cli === 'claude-code' ? 'haiku' : 'gemini-3.8-flash-low',
    prompt: 'Respondé sólo con: ok',
    spawnFn: fake.spawnFn as any,
    resolveExecutable,
    onChunk: (c) => chunks.push(...c),
    ...extra,
  });
  return { result, chunks };
}

describe('4.2 cliente de texto por CLI: salida válida', () => {
  it('Codex: orden exacta, pedido por stdin, carpeta vacía que se borra al terminar', async () => {
    const fake = fakeProcess(jsonl([
      { type: 'thread.started', thread_id: 't' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'Pienso.' } },
      { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'ok' } },
      { type: 'turn.completed', usage: { input_tokens: 12556, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } },
    ]), 0);
    const { result, chunks } = await run('codex', fake);
    expect(result).toEqual({
      status: 'ok',
      text: 'ok',
      usage: { promptTokens: 12556, cachedPromptTokens: 0, completionTokens: 5, reasoningTokens: 0 },
      warnings: [],
    });
    expect(fake.command()).toBe('C:/tools/codex.exe');
    expect(fake.args()).toEqual(['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-m', 'gpt-5.5', '-']);
    expect(fake.stdin()).toBe('Respondé sólo con: ok');
    expect(fs.existsSync(fake.cwd())).toBe(false);
    // Pensamiento mientras corre; respuesta y conteo al final, en ese orden.
    expect(chunks.map((c) => c.kind)).toEqual(['reasoning', 'content', 'done']);
  });

  it('Codex: los «Reconnecting… n/5» son reintentos, y si después llega la respuesta, vale la respuesta', async () => {
    const fake = fakeProcess(jsonl([
      { type: 'turn.started' },
      { type: 'error', message: 'Reconnecting... 2/5 (stream disconnected)' },
      { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'ok' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 1 } },
    ]), 0);
    const { result } = await run('codex', fake);
    expect(result).toMatchObject({ status: 'ok', text: 'ok' });
  });

  it('Claude Code: sin herramientas ni ajustes de la persona, opciones vacías pegadas, y el conteo suma las tres entradas', async () => {
    const fake = fakeProcess(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      usage: {
        input_tokens: 9,
        cache_creation_input_tokens: 6783,
        cache_read_input_tokens: 0,
        output_tokens: 78,
        output_tokens_details: { thinking_tokens: 72 },
      },
      total_cost_usd: 0.013965,
    }), 0);
    const { result, chunks } = await run('claude-code', fake);
    expect(result).toEqual({
      status: 'ok',
      text: 'ok',
      usage: { promptTokens: 6792, cachedPromptTokens: 0, completionTokens: 78, reasoningTokens: 72 },
      warnings: [],
    });
    expect(fake.command()).toBe('C:/tools/claude.exe');
    expect(fake.args()).toEqual([
      '-p', '--output-format', 'json', '--tools=', '--no-session-persistence', '--setting-sources=',
      '--strict-mcp-config', '--disable-slash-commands', '--model', 'haiku',
    ]);
    expect(fake.stdin()).toBe('Respondé sólo con: ok');
    expect(chunks.map((c) => c.kind)).toEqual(['content', 'done']);
  });

  it('Antigravity: el pedido entra por stdin en su formato de eventos y la respuesta llega de a pedazos', async () => {
    const fake = fakeProcess(jsonl([
      { event: 'init', conversation_id: 'c', init: { model: 'gemini-3.8-flash-low' } },
      { event: 'step_update', step_update: { step_index: 0, state: 'DONE', step_type: 'user_input' } },
      { event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'ok' } },
      { event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '\n' } },
      { event: 'result', result: { status: 'SUCCESS', response: 'ok\n', usage: { input_tokens: 13126, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 13127 } } },
    ]), 0);
    const { result, chunks } = await run('antigravity', fake, { timeoutMs: 90_000 });
    expect(result).toEqual({
      status: 'ok',
      text: 'ok\n',
      usage: { promptTokens: 13126, cachedPromptTokens: 0, completionTokens: 1, reasoningTokens: 0 },
      warnings: [],
    });
    expect(fake.args()).toEqual([
      '-p=', '--input-format', 'stream-json', '--output-format', 'stream-json', '--mode', 'plan',
      '--model', 'gemini-3.8-flash-low', '--print-timeout', '90s',
    ]);
    expect(fake.stdin()).toBe(buildAntigravityStdin('Respondé sólo con: ok'));
    expect(JSON.parse(fake.stdin())).toEqual({ event: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Respondé sólo con: ok' }] } });
    expect(chunks).toEqual([
      { kind: 'content', text: 'ok' },
      { kind: 'content', text: '\n' },
      { kind: 'done', finishReason: null, usage: { promptTokens: 13126, cachedPromptTokens: 0, completionTokens: 1, reasoningTokens: 0 } },
    ]);
  });

  it('Antigravity: si quiso correr un comando y no respondió, lo dice', async () => {
    const fake = fakeProcess(jsonl([
      { event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } },
    ]), 0);
    const { result } = await run('antigravity', fake);
    expect(result).toEqual({ status: 'failed', reason: 'error', detail: 'Antigravity quiso usar RunCommand, que en modo texto no se permite, y no dio respuesta.' });
  });

  it('un modelo con caracteres raros no lanza ningún proceso', async () => {
    const fake = fakeProcess('', 0);
    const result = await runCliText({ cli: 'codex', model: 'gpt & del', prompt: 'x', spawnFn: fake.spawnFn as any, resolveExecutable });
    expect(result).toMatchObject({ status: 'failed', reason: 'invalid-model' });
    expect(fake.spawnFn).not.toHaveBeenCalled();
  });

  it('sin el CLI instalado: lo dice, sin lanzar nada', async () => {
    const fake = fakeProcess('', 0);
    const result = await runCliText({
      cli: 'antigravity',
      model: 'm',
      prompt: 'x',
      spawnFn: fake.spawnFn as any,
      resolveExecutable: async () => { throw new Error("Runtime executable 'agy' was not found"); },
    });
    expect(result).toMatchObject({ status: 'failed', reason: 'not-installed' });
    expect(fake.spawnFn).not.toHaveBeenCalled();
  });
});

describe('4.2 sin sesión', () => {
  it('Codex: los 401 de la salida medida terminan en «sin sesión»', async () => {
    const fake = fakeProcess(jsonl([
      { type: 'turn.started' },
      { type: 'error', message: 'Reconnecting... 5/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses)' },
      { type: 'error', message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses' },
      { type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses' } },
    ]), 1);
    const { result } = await run('codex', fake);
    expect(result).toMatchObject({ status: 'failed', reason: 'no-session' });
  });

  it('Claude Code: «Not logged in» con is_error', async () => {
    const fake = fakeProcess(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login', usage: {} }), 0);
    const { result } = await run('claude-code', fake);
    expect(result).toEqual({ status: 'failed', reason: 'no-session', detail: 'Not logged in · Please run /login' });
  });

  it('Antigravity: un estado ERROR se informa con su texto', async () => {
    const fake = fakeProcess(jsonl([{ event: 'result', result: { status: 'ERROR', response: '', error: 'stream input message is missing the "event" field' } }]), 1);
    const { result } = await run('antigravity', fake);
    expect(result).toEqual({ status: 'failed', reason: 'error', detail: 'stream input message is missing the "event" field' });
  });
});

describe('4.2 cancelación y tiempo agotado', () => {
  afterEach(() => vi.useRealTimers());

  it('cancelar termina el proceso y devuelve recién cuando cerró', async () => {
    let child: any;
    const killTree = vi.fn((c: any) => setTimeout(() => c.emit('close', null), 20));
    const spawnFn = vi.fn(() => {
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      return child;
    });
    const controller = new AbortController();
    const promise = runCliText({ cli: 'codex', model: 'gpt-5.5', prompt: 'x', signal: controller.signal, spawnFn: spawnFn as any, resolveExecutable, killTree });
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalled());
    let done = false;
    void promise.then(() => { done = true; });
    controller.abort();
    expect(killTree).toHaveBeenCalledWith(child);
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false);
    expect(await promise).toEqual({ status: 'failed', reason: 'cancelled', detail: 'Cancelado.' });
  });

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('tiempo agotado con un proceso de verdad: no queda vivo', async () => {
    let pid = 0;
    const spawnFn = ((_file: string, _args: string[], opts: any) => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], opts);
      pid = child.pid!;
      return child;
    }) as any;
    const result = await runCliText({
      cli: 'claude-code',
      model: 'haiku',
      prompt: 'x',
      timeoutMs: 300,
      spawnFn,
      resolveExecutable: async () => ({ file: process.execPath, viaShell: false }),
    });
    expect(result).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(result.status === 'failed' && result.detail).toMatch(/Claude Code tardó demasiado/);
    expect(pid).toBeGreaterThan(0);
    expect(alive(pid)).toBe(false);
  });

  it.runIf(process.platform === 'win32')('cancelar termina también lo que el CLI lanzó (como el cmd.exe de un acceso de npm)', async () => {
    let pid = 0;
    let grandchild = 0;
    const script = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)";
    const spawnFn = ((_file: string, _args: string[], opts: any) => {
      const child = spawn(process.execPath, ['-e', script], opts);
      pid = child.pid!;
      child.stdout.on('data', (d: Buffer) => { grandchild = Number(String(d).trim()) || grandchild; });
      return child;
    }) as any;
    const controller = new AbortController();
    const promise = runCliText({
      cli: 'codex',
      model: 'gpt-5.5',
      prompt: 'x',
      signal: controller.signal,
      spawnFn,
      resolveExecutable: async () => ({ file: process.execPath, viaShell: false }),
    });
    await vi.waitFor(() => expect(grandchild).toBeGreaterThan(0), { timeout: 5000 });
    controller.abort();
    expect(await promise).toMatchObject({ status: 'failed', reason: 'cancelled' });
    await vi.waitFor(() => {
      expect(alive(pid)).toBe(false);
      expect(alive(grandchild)).toBe(false);
    }, { timeout: 5000 });
  });
});
