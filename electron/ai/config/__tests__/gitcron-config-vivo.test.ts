// Tareas 3.1, 3.3 y 3.4 de modelos-en-casa: el gitcron.json global y el del
// repositorio, mezclados con su origen, observados y editables sin tocar el resto.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  GitCronConfigError,
  loadGitCronConfig,
  resetGitCronConfigCacheForTesting,
  resolveUse,
} from '../gitcron-config';
import { detectFormatting, updateGitCronConfigValue, type ConfigWriterFs } from '../gitcron-config-writer';
import { createGitCronConfigWatcher } from '../gitcron-config-watcher';

const GLOBAL = `{
  // Mi configuración
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "unslothpc": {
      "name": "Unsloth CASA",
      "options": { "baseURL": "https://llm.example.dev/v1", "headers": { "CF-Access-Client-Id": "abc" } },
      "models": {
        "unsloth/Qwen3.8-27B-GGUF": { "limit": { "context": 120000, "output": 3000 }, "options": { "reasoning_effort": "medium" } },
      },
    },
  },
  "agent": {
    "gitcron-commit": { "model": "unslothpc/unsloth/Qwen3.8-27B-GGUF", "temperature": 0.2 },
  },
}
`;

let dir: string;
let globalPath: string;
let repoPath: string;

beforeEach(() => {
  resetGitCronConfigCacheForTesting();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-vivo-'));
  globalPath = path.join(dir, 'global', 'gitcron.json');
  repoPath = path.join(dir, 'repo');
  fs.mkdirSync(path.dirname(globalPath), { recursive: true });
  fs.mkdirSync(repoPath, { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('3.1 lectura y mezcla', () => {
  it('sólo global, con comentarios y comas finales', () => {
    fs.writeFileSync(globalPath, GLOBAL);
    const loaded = loadGitCronConfig({ globalPath, repoPath });
    expect(loaded.config?.agent?.['gitcron-commit']?.model).toBe('unslothpc/unsloth/Qwen3.8-27B-GGUF');
    expect(loaded.files).toEqual([
      { path: globalPath, scope: 'global', exists: true },
      { path: path.join(repoPath, 'gitcron.json'), scope: 'repo', exists: false },
    ]);
  });

  it('el repositorio gana por clave y el origen lo dice, con un id de modelo con puntos y barras', () => {
    fs.writeFileSync(globalPath, GLOBAL);
    const repoFile = path.join(repoPath, 'gitcron.json');
    fs.writeFileSync(repoFile, JSON.stringify({
      provider: { unslothpc: { models: { 'unsloth/Qwen3.8-27B-GGUF': { options: { reasoning_effort: 'high' } } } } },
    }));
    const loaded = loadGitCronConfig({ globalPath, repoPath });
    const model = loaded.config?.provider?.unslothpc?.models?.['unsloth/Qwen3.8-27B-GGUF'];
    // El repositorio pisa sólo lo que trae; el resto del modelo sigue siendo del global.
    expect(model?.options).toEqual({ reasoning_effort: 'high' });
    expect(model?.limit).toEqual({ context: 120000, output: 3000 });
    expect(loaded.originOf(['provider', 'unslothpc', 'models', 'unsloth/Qwen3.8-27B-GGUF', 'options', 'reasoning_effort'])).toBe(repoFile);
    expect(loaded.originOf(['provider', 'unslothpc', 'models', 'unsloth/Qwen3.8-27B-GGUF', 'limit', 'output'])).toBe(globalPath);
    expect(loaded.originOf(['agent', 'gitcron-commit', 'model'])).toBe(globalPath);
  });

  it('archivo ausente: no hay configuración', () => {
    const loaded = loadGitCronConfig({ globalPath });
    expect(loaded.config).toBeNull();
    expect(loaded.files[0]).toEqual({ path: globalPath, scope: 'global', exists: false });
  });

  it('roto sin versión anterior: error con línea, columna y código, y no aporta nada', () => {
    fs.writeFileSync(globalPath, '{\n  "agent": {\n    "gitcron-commit": { "model": "a/b" }\n    "x": 1\n  }\n}\n');
    const loaded = loadGitCronConfig({ globalPath });
    expect(loaded.config).toBeNull();
    expect(loaded.files[0].error).toEqual({ file: globalPath, line: 4, column: 5, code: 'CommaExpected' });
    expect(loaded.files[0].usingLastValid).toBeUndefined();
    expect(() => resolveUse('gitcron-commit', { configPath: globalPath })).toThrow(GitCronConfigError);
  });

  it('roto después de una lectura buena: sigue con la última versión válida y lo marca', () => {
    fs.writeFileSync(globalPath, GLOBAL);
    expect(loadGitCronConfig({ globalPath }).config).not.toBeNull();
    // Ale sacando una coma, como en su prueba del 2026-10-01.
    fs.writeFileSync(globalPath, GLOBAL.replace('"Unsloth CASA",', '"Unsloth CASA"'));
    const loaded = loadGitCronConfig({ globalPath });
    expect(loaded.files[0].usingLastValid).toBe(true);
    expect(loaded.files[0].error?.code).toBe('CommaExpected');
    expect(loaded.config?.agent?.['gitcron-commit']?.model).toBe('unslothpc/unsloth/Qwen3.8-27B-GGUF');
    // No bloquea: resuelve con la versión anterior.
    expect(resolveUse('gitcron-commit', { configPath: globalPath, env: {} as NodeJS.ProcessEnv })?.modelId).toBe('unsloth/Qwen3.8-27B-GGUF');
  });

  it('resolveUse con repositorio: cada valor dice de qué archivo sale', () => {
    fs.writeFileSync(globalPath, GLOBAL);
    const repoFile = path.join(repoPath, 'gitcron.json');
    fs.writeFileSync(repoFile, JSON.stringify({ agent: { 'gitcron-commit': { temperature: 0.7 } } }));
    const resolved = resolveUse('gitcron-commit', { configPath: globalPath, repoPath, env: {} as NodeJS.ProcessEnv });
    expect(resolved?.temperature).toBe(0.7);
    expect(resolved?.sourceFile).toBe(globalPath);
    expect(resolved?.provenance.repoFile).toBe(repoFile);
    expect(resolved?.provenance.fromRepo).toEqual(['temperature']);
  });

  it('el modelo elegido en el repositorio: sourceFile es el del repositorio', () => {
    fs.writeFileSync(globalPath, GLOBAL);
    const repoFile = path.join(repoPath, 'gitcron.json');
    fs.writeFileSync(repoFile, JSON.stringify({ agent: { 'gitcron-commit': { model: 'codex/gpt-5.6-luna' } } }));
    const resolved = resolveUse('gitcron-commit', { configPath: globalPath, repoPath, env: {} as NodeJS.ProcessEnv });
    expect(resolved?.providerId).toBe('codex');
    expect(resolved?.sourceFile).toBe(repoFile);
    expect(resolved?.provenance.fromRepo).toContain('model');
  });
});

describe('3.3 escritura puntual', () => {
  it('cambia un valor y deja el resto del texto igual byte a byte', () => {
    const text = GLOBAL.replace('"agent": {', '"mcp": { "fs": { "type": "local", "command": ["npx", "x"] } },\n  // uso de GitCron\n  "agent": {');
    fs.writeFileSync(globalPath, text);
    const result = updateGitCronConfigValue({ filePath: globalPath, segments: ['agent', 'gitcron-commit', 'temperature'], value: 0.5 });
    expect(result).toEqual({ ok: true, created: false });
    const after = fs.readFileSync(globalPath, 'utf8');
    expect(after).toBe(text.replace('"temperature": 0.2', '"temperature": 0.5'));
  });

  it('agrega una clave nueva con la sangría del archivo y quita otra', () => {
    fs.writeFileSync(globalPath, GLOBAL);
    updateGitCronConfigValue({ filePath: globalPath, segments: ['agent', 'gitcron-commit', 'temperature'], value: undefined });
    let after = fs.readFileSync(globalPath, 'utf8');
    expect(after).not.toContain('"temperature"');
    expect(after).toContain('// Mi configuración');
    updateGitCronConfigValue({ filePath: globalPath, segments: ['small_model'], value: 'unslothpc/rapido' });
    after = fs.readFileSync(globalPath, 'utf8');
    expect(after).toContain('\n  "small_model": "unslothpc/rapido"');
  });

  it('respeta tabulaciones y fin de línea de Windows', () => {
    expect(detectFormatting('{\r\n\t"a": 1\r\n}')).toEqual({ insertSpaces: false, tabSize: 1, eol: '\r\n' });
    expect(detectFormatting('{\n    "a": 1\n}')).toEqual({ insertSpaces: true, tabSize: 4, eol: '\n' });
  });

  it('un archivo roto no se toca', () => {
    const broken = '{ "agent": { "a": 1 "b": 2 } }';
    fs.writeFileSync(globalPath, broken);
    const result = updateGitCronConfigValue({ filePath: globalPath, segments: ['model'], value: 'x/y' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('broken');
    expect(fs.readFileSync(globalPath, 'utf8')).toBe(broken);
  });

  it('crea el archivo del repositorio con $schema', () => {
    const repoFile = path.join(repoPath, 'gitcron.json');
    const result = updateGitCronConfigValue({ filePath: repoFile, segments: ['agent', 'gitcron-commit', 'model'], value: 'codex/gpt-5.6-luna' });
    expect(result).toEqual({ ok: true, created: true });
    const parsed = JSON.parse(fs.readFileSync(repoFile, 'utf8'));
    expect(parsed).toEqual({ $schema: 'https://opencode.ai/config.json', agent: { 'gitcron-commit': { model: 'codex/gpt-5.6-luna' } } });
  });

  it('si el archivo cambia mientras se escribe, edita sobre el texto nuevo', () => {
    fs.writeFileSync(globalPath, GLOBAL);
    let reads = 0;
    // Otro proceso guarda el archivo justo entre la lectura y la escritura.
    const racingFs: ConfigWriterFs = {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, enc) => {
        reads++;
        if (p === globalPath && reads === 2) {
          fs.writeFileSync(globalPath, GLOBAL.replace('"Unsloth CASA"', '"Unsloth OTRA"'));
        }
        return fs.readFileSync(p, enc);
      },
      writeFileSync: (p, data, enc) => fs.writeFileSync(p, data, enc),
      renameSync: (a, b) => fs.renameSync(a, b),
      unlinkSync: (p) => fs.unlinkSync(p),
    };
    const result = updateGitCronConfigValue({ filePath: globalPath, segments: ['agent', 'gitcron-commit', 'temperature'], value: 0.9, fs: racingFs });
    expect(result).toEqual({ ok: true, created: false });
    const after = fs.readFileSync(globalPath, 'utf8');
    // Quedan los dos cambios: el del otro proceso y el nuestro.
    expect(after).toContain('"Unsloth OTRA"');
    expect(after).toContain('"temperature": 0.9');
    // Y no quedan temporales.
    expect(fs.readdirSync(path.dirname(globalPath)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('3.4 observación', () => {
  const waitFor = async (check: () => boolean, ms = 3000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('no llegó el aviso');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('guardar el global a mano avisa con repoPath null, y el cambio se lee', async () => {
    fs.writeFileSync(globalPath, GLOBAL);
    const events: Array<string | null> = [];
    const watcher = createGitCronConfigWatcher({ globalPath, onChange: (r) => events.push(r), debounceMs: 30 });
    watcher.watchGlobal();
    try {
      fs.writeFileSync(globalPath, GLOBAL.replace('0.2', '0.4'));
      await waitFor(() => events.length > 0);
      expect(events[0]).toBeNull();
      expect(resolveUse('gitcron-commit', { configPath: globalPath, env: {} as NodeJS.ProcessEnv })?.temperature).toBe(0.4);
    } finally {
      watcher.close();
    }
  });

  it('crear el archivo del repositorio después de empezar a observar también avisa, y dejar de observar lo corta', async () => {
    const events: Array<string | null> = [];
    const watcher = createGitCronConfigWatcher({ globalPath, onChange: (r) => events.push(r), debounceMs: 30 });
    watcher.watchRepo(repoPath);
    try {
      expect(watcher.watchedRepos()).toEqual([repoPath]);
      fs.writeFileSync(path.join(repoPath, 'gitcron.json'), '{}');
      await waitFor(() => events.includes(repoPath));
      // Otro archivo de la raíz no avisa.
      events.length = 0;
      fs.writeFileSync(path.join(repoPath, 'README.md'), 'hola');
      await new Promise((r) => setTimeout(r, 150));
      expect(events).toEqual([]);
      watcher.unwatchRepo(repoPath);
      expect(watcher.watchedRepos()).toEqual([]);
      fs.writeFileSync(path.join(repoPath, 'gitcron.json'), '{"model":"a/b"}');
      await new Promise((r) => setTimeout(r, 150));
      expect(events).toEqual([]);
    } finally {
      watcher.close();
    }
  });
});
