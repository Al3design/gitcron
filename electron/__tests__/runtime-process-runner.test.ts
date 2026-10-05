import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeProcessRunner, resolveRuntimeExecutable } from '../pipeline/runtime-adapters';
import { quoteForShell } from '../pipeline/runtime-adapters/process-runner';

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gitcron-runtime-runner-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('RuntimeProcessRunner', () => {
  it('runs executable and args without a shell and cleans ownership', async () => {
    const cwd = await fixtureDirectory();
    const runner = new RuntimeProcessRunner();
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', 'SAFE;NOT_A_SHELL'],
      cwd,
      expectedCanonicalCwd: cwd,
      timeoutMs: 5_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('SAFE;NOT_A_SHELL');
    expect(result.timedOut).toBe(false);
    expect(runner.ownedProcessCount()).toBe(0);
  });

  it('rejects a cwd that does not match the bound repository', async () => {
    const cwd = await fixtureDirectory();
    const other = await fixtureDirectory();
    const runner = new RuntimeProcessRunner();
    await expect(runner.run({
      executable: process.execPath,
      args: ['-e', 'process.exit(0)'],
      cwd,
      expectedCanonicalCwd: other,
    })).rejects.toThrow('Runtime cwd does not match the bound repository');
    expect(runner.ownedProcessCount()).toBe(0);
  });

  it('terminates an owned process on timeout and waits for close', async () => {
    const cwd = await fixtureDirectory();
    const runner = new RuntimeProcessRunner();
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd,
      expectedCanonicalCwd: cwd,
      timeoutMs: 50,
      killGraceMs: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(runner.ownedProcessCount()).toBe(0);
  });

  it('terminates when bounded stdout is exceeded', async () => {
    const cwd = await fixtureDirectory();
    const runner = new RuntimeProcessRunner();
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(4096)); setInterval(() => {}, 1000)'],
      cwd,
      expectedCanonicalCwd: cwd,
      maxStdoutBytes: 128,
      timeoutMs: 5_000,
    });
    expect(result.outputLimit).toBe('stdout');
    expect(result.stdout).toHaveLength(128);
    expect(runner.ownedProcessCount()).toBe(0);
  });

  it('supports AbortSignal and never controls unknown process ids', async () => {
    const cwd = await fixtureDirectory();
    const runner = new RuntimeProcessRunner();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await runner.run({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd,
      expectedCanonicalCwd: cwd,
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    expect(result.aborted).toBe(true);
    expect(runner.terminateOwned('external-pid')).toBe(false);
  });
});

// Los literales incluyen NODE_ENV porque next/types/global.d.ts lo declara requerido en NodeJS.ProcessEnv; el resolver solo lee PATH y PATHEXT.
describe('resolveRuntimeExecutable', () => {
  it('resolves a bare name to the first PATHEXT match of each directory, not exe-first', async () => {
    const dir = await fixtureDirectory();
    await fs.writeFile(path.join(dir, 'probe.cmd'), '@echo cmd\r\n');
    await fs.writeFile(path.join(dir, 'probe.exe'), 'not-used');
    // La extensión conserva el caso que declara PATHEXT: en Windows la
    // resolución es insensible a mayúsculas.
    const resolution = await resolveRuntimeExecutable('probe', { PATH: dir, PATHEXT: '.CMD;.EXE' });
    expect(resolution).toEqual({ file: path.join(dir, 'probe.CMD'), viaShell: true });
  });

  it('walks PATH directories in order and lets an earlier .cmd beat a later .exe', async () => {
    const first = await fixtureDirectory();
    const second = await fixtureDirectory();
    await fs.writeFile(path.join(first, 'probe.cmd'), '@echo cmd\r\n');
    await fs.writeFile(path.join(second, 'probe.exe'), 'not-used');
    const resolution = await resolveRuntimeExecutable('probe', {
      PATH: `${first};${second}`,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    });
    expect(resolution).toEqual({ file: path.join(first, 'probe.CMD'), viaShell: true });
  });

  it('resolves a bare name to a direct .exe without the shell', async () => {
    const dir = await fixtureDirectory();
    await fs.writeFile(path.join(dir, 'probe.exe'), 'not-used');
    const resolution = await resolveRuntimeExecutable('probe', { PATH: dir, PATHEXT: '.COM;.EXE' });
    expect(resolution).toEqual({ file: path.join(dir, 'probe.EXE'), viaShell: false });
  });

  it('passes a full path through without searching PATH', async () => {
    const direct = await resolveRuntimeExecutable('C:\\tools\\probe.exe', { PATH: '' });
    expect(direct).toEqual({ file: 'C:\\tools\\probe.exe', viaShell: false });
    const batch = await resolveRuntimeExecutable('C:\\tools\\probe.cmd', { PATH: '' });
    expect(batch).toEqual({ file: 'C:\\tools\\probe.cmd', viaShell: true });
  });

  it('reports a name whose extension this application cannot launch, with the measured path', async () => {
    const dir = await fixtureDirectory();
    await fs.writeFile(path.join(dir, 'weird.tool'), 'not-used');
    await expect(resolveRuntimeExecutable('weird.tool', { PATH: dir, PATHEXT: '.CMD' }))
      .rejects.toThrow(/resolved to .*weird\.tool.* cannot launch/);
  });

  it('reports a bare name that only exists as an extensionless shim with the measured path', async () => {
    const dir = await fixtureDirectory();
    await fs.writeFile(path.join(dir, 'probe'), '#!/bin/sh\n');
    await expect(resolveRuntimeExecutable('probe', { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }))
      .rejects.toThrow(`was found as ${path.join(dir, 'probe')}`);
  });

  it('reports a missing bare name with the environment that was searched', async () => {
    const dir = await fixtureDirectory();
    await expect(resolveRuntimeExecutable('probe', { PATH: dir, PATHEXT: '.COM;.EXE' }))
      .rejects.toThrow(/not found in the application environment PATH \(1 directories/);
  });
});

describe.skipIf(process.platform !== 'win32')('batch shim launch', () => {
  it('runs a resolved .cmd through the shell and captures its output', async () => {
    const bin = await fixtureDirectory();
    const cwd = await fixtureDirectory();
    await fs.writeFile(path.join(bin, 'probe.cmd'), '@echo SAFE;NOT_A_SHELL\r\n');
    const runner = new RuntimeProcessRunner();
    const result = await runner.run({
      executable: 'probe',
      args: [],
      cwd,
      expectedCanonicalCwd: cwd,
      env: { PATH: bin, PATHEXT: '.CMD' },
      timeoutMs: 5_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe('SAFE;NOT_A_SHELL');
    expect(runner.ownedProcessCount()).toBe(0);
  });

  it('rejects an unresolvable bare name with the measured reason before spawning', async () => {
    const cwd = await fixtureDirectory();
    const runner = new RuntimeProcessRunner();
    await expect(runner.run({
      executable: 'definitely-missing-runtime',
      args: [],
      cwd,
      expectedCanonicalCwd: cwd,
      env: { PATH: '', PATHEXT: '.COM;.EXE' },
      timeoutMs: 5_000,
    })).rejects.toThrow(/not found in the application environment PATH/);
    expect(runner.ownedProcessCount()).toBe(0);
  });
});

describe('argumentos de un .cmd (pasan por el shell)', () => {
  // El .cmd devuelve, uno por renglón, los argumentos que recibe: lo que llega es lo que se mandó.
  async function echoCmd(directory: string): Promise<string> {
    const script = path.join(directory, 'args.js');
    await fs.writeFile(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    const cmd = path.join(directory, 'echo-args.cmd');
    await fs.writeFile(cmd, `@echo off
"${process.execPath}" "${script}" %*
`);
    return cmd;
  }

  it.skipIf(process.platform !== 'win32')('un argumento con espacio, `&` o paréntesis llega entero, y el comando con espacio también', async () => {
    const base = await fixtureDirectory();
    const directory = path.join(base, 'Mis Proyectos & Co (1)');
    await fs.mkdir(directory);
    const cmd = await echoCmd(directory);
    const runner = new RuntimeProcessRunner();
    const result = await runner.run({
      executable: cmd,
      args: ['api', 'model.list', '--param', `location[directory]=${directory}`, 'plano', ''],
      cwd: directory,
      expectedCanonicalCwd: directory,
      timeoutMs: 15_000,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual(['api', 'model.list', '--param', `location[directory]=${directory}`, 'plano', '']);
  });

  it.skipIf(process.platform !== 'win32')('un argumento con comillas o % no se pasa al shell y no se lanza nada', async () => {
    const directory = await fixtureDirectory();
    const cmd = await echoCmd(directory);
    const runner = new RuntimeProcessRunner();
    for (const arg of ['a"b', '%PATH%']) {
      await expect(runner.run({ executable: cmd, args: [arg], cwd: directory, expectedCanonicalCwd: directory, timeoutMs: 5_000 }))
        .rejects.toThrow(/not safe for the shell/);
    }
    expect(runner.ownedProcessCount()).toBe(0);
  });

  it.skipIf(process.platform !== 'win32')('al detener, también muere el programa que lanzó el .cmd (no queda un huérfano trabajando)', async () => {
    const directory = await fixtureDirectory();
    const pidFile = path.join(directory, 'pid.txt');
    const script = path.join(directory, 'largo.js');
    // El programa de verdad escribe su pid y se queda vivo; el .cmd sólo lo lanza.
    await fs.writeFile(script, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
    const cmd = path.join(directory, 'largo.cmd');
    await fs.writeFile(cmd, `@echo off\r\n"${process.execPath}" "${script}"\r\n`);
    const runner = new RuntimeProcessRunner();
    const abort = new AbortController();
    // Margen de 1 ms: el golpe final vence antes de que `taskkill` arranque, que es lo que pasa
    // con la máquina cargada. Si no espera a `taskkill`, mata la consola y el programa queda suelto.
    const running = runner.run({ executable: cmd, args: [], cwd: directory, expectedCanonicalCwd: directory, timeoutMs: 60_000, killGraceMs: 1, signal: abort.signal });

    // Se detiene un programa que ya está trabajando, como «Detener» a mitad de una corrida:
    // cortar mientras la consola todavía lo está lanzando es otra cosa (ver el margen del runner).
    let started = false;
    for (let i = 0; i < 150 && !started; i++) {
      started = await fs.access(pidFile).then(() => true, () => false);
      if (!started) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(started).toBe(true);
    abort.abort();
    const result = await running;
    expect(result.aborted).toBe(true);

    const pid = Number(await fs.readFile(pidFile, 'utf8'));
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 40 && alive(); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    const stillAlive = alive();
    if (stillAlive) process.kill(pid, 'SIGKILL'); // no dejar basura si la prueba falla
    expect(stillAlive).toBe(false);
  }, 30_000);

  it('quoteForShell sólo entrecomilla lo que lo necesita', () => {
    expect(quoteForShell('--format')).toBe('--format');
    expect(quoteForShell('unslothpclocal/unsloth/Qwen3.8-27B-GGUF#high')).toBe('unslothpclocal/unsloth/Qwen3.8-27B-GGUF#high');
    expect(quoteForShell(String.raw`C:\Mis Proyectos\repo`)).toBe(String.raw`"C:\Mis Proyectos\repo"`);
    expect(quoteForShell('a&b')).toBe('"a&b"');
    expect(quoteForShell('')).toBe('""');
    expect(() => quoteForShell('50%')).toThrow();
    expect(() => quoteForShell('di"jo')).toThrow();
  });
});
