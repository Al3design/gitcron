import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  determineDestination,
  readGitCronConfig,
  resolveUse,
  substituteEnvInValue,
} from '../gitcron-config';

describe('gitcron-config', () => {
  it('soporta comentarios y comas finales', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-test-'));
    const configPath = path.join(tmpDir, 'gitcron.json');
    const content = `{
      // Comentario de cabecera
      "model": "unslothpclocal/model-1",
      /* Bloque de proveedores */
      "provider": {
        "local": {
          "name": "Local Server",
          "options": {
            "baseURL": "http://localhost:1234/v1",
          },
        },
      },
      "agent": {
        "gitcron-commit": {
          "model": "local/model-1",
        },
      },
    }`;
    fs.writeFileSync(configPath, content, 'utf8');

    try {
      const config = readGitCronConfig(configPath);
      expect(config).not.toBeNull();
      expect(config?.model).toBe('unslothpclocal/model-1');
      expect(config?.provider?.local?.name).toBe('Local Server');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('archivo ausente devuelve null', () => {
    const config = readGitCronConfig(path.join(os.tmpdir(), 'non-existent-gitcron-file.json'));
    expect(config).toBeNull();

    const resolved = resolveUse('gitcron-commit', path.join(os.tmpdir(), 'non-existent-gitcron-file.json'));
    expect(resolved).toBeNull();
  });

  it('archivo roto lanza error con número de línea y motivo', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-test-'));
    const configPath = path.join(tmpDir, 'gitcron.json');
    const malformed = `{\n  "model": \n}`;
    fs.writeFileSync(configPath, malformed, 'utf8');

    try {
      expect(() => readGitCronConfig(configPath)).toThrow(/línea 3.*ValueExpected/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sustituye {env:NOMBRE} si está presente y deja proveedor no disponible con el nombre si falta', () => {
    const envPresent = { MY_API_KEY: 'secret-123', CF_ID: 'cf-id-456' };
    const rawOptions = {
      apiKey: '{env:MY_API_KEY}',
      headers: {
        'CF-Access-Client-Id': '{env:CF_ID}',
        'CF-Access-Client-Secret': '{env:CF_SECRET_MISSING}',
      },
    };

    const res = substituteEnvInValue(rawOptions, envPresent as any);
    expect(res.value.apiKey).toBe('secret-123');
    expect(res.value.headers['CF-Access-Client-Id']).toBe('cf-id-456');
    // Nunca manda valor vacío para la faltante
    expect(res.value.headers['CF-Access-Client-Secret']).toBeUndefined();
    expect(res.missingVars).toEqual(['CF_SECRET_MISSING']);

    // Probado a través de resolveUse
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-test-'));
    const configPath = path.join(tmpDir, 'gitcron.json');
    const content = JSON.stringify({
      provider: {
        unsloth: {
          name: 'Unsloth Local',
          options: {
            baseURL: 'http://192.168.1.5:8888/v1',
            apiKey: '{env:MISSING_KEY}',
          },
          models: {
            'qwen/27b': { limit: { context: 32768 } },
          },
        },
      },
      agent: {
        'gitcron-commit': {
          model: 'unsloth/qwen/27b',
        },
      },
    });
    fs.writeFileSync(configPath, content, 'utf8');

    try {
      const resolved = resolveUse('gitcron-commit', configPath, {} as any);
      expect(resolved).not.toBeNull();
      expect(resolved?.available).toBe(false);
      expect(resolved?.unavailableReason).toContain('MISSING_KEY');
      expect(resolved?.apiKey).toBeUndefined();

      // Ahora con la variable presente
      const resolvedOk = resolveUse('gitcron-commit', configPath, { MISSING_KEY: 'unsloth-secret' } as any);
      expect(resolvedOk?.available).toBe(true);
      expect(resolvedOk?.apiKey).toBe('unsloth-secret');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('separa proveedor y modelo por la primera barra', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-test-'));
    const configPath = path.join(tmpDir, 'gitcron.json');
    const content = JSON.stringify({
      provider: {
        unslothpclocal: {
          name: 'Unsloth CASA Local',
          options: { baseURL: 'http://192.168.1.7:8888/v1' },
          models: {
            'unsloth/Qwen3.8-27B-GGUF': { limit: { context: 65536 } },
          },
        },
      },
      agent: {
        'gitcron-commit': {
          model: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
        },
      },
    });
    fs.writeFileSync(configPath, content, 'utf8');

    try {
      const resolved = resolveUse('gitcron-commit', configPath);
      expect(resolved).not.toBeNull();
      expect(resolved?.providerId).toBe('unslothpclocal');
      expect(resolved?.modelId).toBe('unsloth/Qwen3.8-27B-GGUF');
      expect(resolved?.contextLength).toBe(65536);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reconoce ids reservados de CLI sin buscarlos en provider', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-test-'));
    const configPath = path.join(tmpDir, 'gitcron.json');
    const content = JSON.stringify({
      agent: {
        'gitcron-commit': {
          model: 'codex/gpt-5.6-luna',
          temperature: 0.1,
        },
        'gitcron-temporal': {
          model: 'claude-code/haiku',
        },
        'gitcron-sdd': {
          model: 'antigravity/gemini-pro',
        },
      },
    });
    fs.writeFileSync(configPath, content, 'utf8');

    try {
      const codexResolved = resolveUse('gitcron-commit', configPath);
      expect(codexResolved).not.toBeNull();
      expect(codexResolved?.kind).toBe('cli');
      expect(codexResolved?.providerId).toBe('codex');
      expect(codexResolved?.providerName).toBe('Codex');
      expect(codexResolved?.modelId).toBe('gpt-5.6-luna');
      expect(codexResolved?.destination).toBe('external-service');
      expect(codexResolved?.available).toBe(true);
      expect(codexResolved?.temperature).toBe(0.1);

      const claudeResolved = resolveUse('gitcron-temporal', configPath);
      expect(claudeResolved?.kind).toBe('cli');
      expect(claudeResolved?.providerId).toBe('claude-code');
      expect(claudeResolved?.available).toBe(false);
      expect(claudeResolved?.unavailableReason).toBe('todavía no conectado');

      const agyResolved = resolveUse('gitcron-sdd', configPath);
      expect(agyResolved?.kind).toBe('cli');
      expect(agyResolved?.providerId).toBe('antigravity');
      expect(agyResolved?.available).toBe(false);
      expect(agyResolved?.unavailableReason).toBe('todavía no conectado');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('respeta la precedencia agente > modelo en temperature y options', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-test-'));
    const configPath = path.join(tmpDir, 'gitcron.json');
    const content = JSON.stringify({
      provider: {
        srv: {
          options: {
            baseURL: 'http://localhost:1234/v1',
            custom_provider_opt: 123,
          },
          models: {
            'qwen/27b': {
              temperature: 0.7,
              options: { reasoning_effort: 'low', top_p: 0.9 },
              limit: { output: 4096, context: 32768 },
            },
          },
        },
      },
      agent: {
        'gitcron-commit': {
          model: 'srv/qwen/27b',
          temperature: 0.2, // gana sobre 0.7
          options: { reasoning_effort: 'high' }, // gana sobre 'low'
        },
      },
    });
    fs.writeFileSync(configPath, content, 'utf8');

    try {
      const resolved = resolveUse('gitcron-commit', configPath);
      expect(resolved?.temperature).toBe(0.2);
      expect(resolved?.maxTokens).toBe(4096);
      expect(resolved?.contextLength).toBe(32768);
      expect(resolved?.options).toEqual({
        custom_provider_opt: 123,
        top_p: 0.9,
        reasoning_effort: 'high',
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('determina destino por dirección: localhost -> this-machine, IP privada -> own-server, resto -> external-service', () => {
    expect(determineDestination('http://localhost:1234/v1')).toBe('this-machine');
    expect(determineDestination('http://127.0.0.1:1234/v1')).toBe('this-machine');
    expect(determineDestination('http://[::1]:1234/v1')).toBe('this-machine');

    expect(determineDestination('http://192.168.1.7:8888/v1')).toBe('own-server');
    expect(determineDestination('http://10.0.0.4:8000/v1')).toBe('own-server');
    expect(determineDestination('http://172.20.1.2:8000/v1')).toBe('own-server');
    expect(determineDestination('http://my-pc.local:8888/v1')).toBe('own-server');

    expect(determineDestination('https://llm.aledesign.dev/v1')).toBe('external-service');
    expect(determineDestination('https://openrouter.ai/api/v1')).toBe('external-service');
    expect(determineDestination(undefined, 'cli')).toBe('external-service');
  });
});
