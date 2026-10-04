import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveAgentFor } from '../ai/config/resolve-agent-for';

describe('resolveAgentFor (tarea 5.1)', () => {
  it('resuelve claude-code/opus -> runtime claude, ejecutor Claude Code', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resolve-agent-'));
    const configPath = path.join(tempDir, 'gitcron.json');
    fs.writeFileSync(configPath, JSON.stringify({
      agent: {
        'gitcron-sdd': {
          model: 'claude-code/opus',
        },
      },
    }));

    try {
      const res = resolveAgentFor({ configPath });
      expect(res).toMatchObject({
        status: 'resolved',
        use: 'gitcron-sdd',
        providerId: 'claude-code',
        providerName: 'Claude Code',
        modelId: 'opus',
        modelRef: 'claude-code/opus',
        runtime: 'claude',
        toolsExecutor: 'Claude Code',
        destination: 'external-service',
      });
      expect(JSON.stringify(res)).not.toContain('apiKey');
      expect(JSON.stringify(res)).not.toContain('baseURL');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resuelve codex/gpt-5.6-sol con nivel de razonamiento válido y filtra nivel inválido', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resolve-agent-'));
    const configPath = path.join(tempDir, 'gitcron.json');
    fs.writeFileSync(configPath, JSON.stringify({
      agent: {
        'gitcron-sdd': {
          model: 'codex/gpt-5.6-sol',
          options: {
            reasoning_effort: 'high',
          },
        },
      },
    }));

    try {
      const res = resolveAgentFor({ configPath });
      expect(res).toMatchObject({
        status: 'resolved',
        use: 'gitcron-sdd',
        providerId: 'codex',
        modelId: 'gpt-5.6-sol',
        effort: 'high',
        runtime: 'codex',
        toolsExecutor: 'Codex',
      });

      // Con nivel inválido para codex: no viaja
      fs.writeFileSync(configPath, JSON.stringify({
        agent: {
          'gitcron-sdd': {
            model: 'codex/gpt-5.6-sol',
            options: {
              reasoning_effort: 'invalido',
            },
          },
        },
      }));
      const resInvalid = resolveAgentFor({ configPath });
      expect(resInvalid.status).toBe('resolved');
      if (resInvalid.status === 'resolved') {
        expect(resInvalid.effort).toBeUndefined();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resuelve antigravity/... -> runtime agy, ejecutor Antigravity', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resolve-agent-'));
    const configPath = path.join(tempDir, 'gitcron.json');
    fs.writeFileSync(configPath, JSON.stringify({
      agent: {
        'gitcron-sdd': {
          model: 'antigravity/gemini-3.8-flash-high',
        },
      },
    }));

    try {
      const res = resolveAgentFor({ configPath });
      expect(res).toMatchObject({
        status: 'resolved',
        use: 'gitcron-sdd',
        providerId: 'antigravity',
        modelId: 'gemini-3.8-flash-high',
        runtime: 'agy',
        toolsExecutor: 'Antigravity',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resuelve un modelo de un proveedor del archivo -> runtime opencode, ejecutor OpenCode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resolve-agent-'));
    const configPath = path.join(tempDir, 'gitcron.json');
    fs.writeFileSync(configPath, JSON.stringify({
      provider: {
        unslothpc: {
          type: 'openai-compatible',
          options: { baseURL: 'https://llm.example.com/v1', apiKey: 'secret-key-123' },
          models: { 'qwen-3': {} },
        },
      },
      agent: {
        'gitcron-sdd': {
          model: 'unslothpc/qwen-3',
        },
      },
    }));

    try {
      const res = resolveAgentFor({ configPath });
      expect(res).toMatchObject({
        status: 'resolved',
        use: 'gitcron-sdd',
        providerId: 'unslothpc',
        modelId: 'qwen-3',
        runtime: 'opencode',
        toolsExecutor: 'OpenCode',
      });
      // Sin secretos en lo que vuelve
      expect(JSON.stringify(res)).not.toContain('secret-key-123');
      expect(JSON.stringify(res)).not.toContain('llm.example.com');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resuelve la elección general cuando no hay excepción para el uso', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resolve-agent-'));
    const configPath = path.join(tempDir, 'gitcron.json');
    fs.writeFileSync(configPath, JSON.stringify({
      model: 'claude-code/sonnet',
    }));

    try {
      const res = resolveAgentFor({ configPath });
      expect(res).toMatchObject({
        status: 'resolved',
        use: 'gitcron-sdd',
        modelId: 'sonnet',
        runtime: 'claude',
        modelSource: 'general',
        isException: false,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('marca excepción cuando hay model general y el uso declara su propio modelo', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resolve-agent-'));
    const configPath = path.join(tempDir, 'gitcron.json');
    fs.writeFileSync(configPath, JSON.stringify({
      model: 'codex/gpt-5.5',
      agent: {
        'gitcron-sdd': {
          model: 'claude-code/opus',
        },
      },
    }));

    try {
      const res = resolveAgentFor({ configPath });
      expect(res).toMatchObject({
        status: 'resolved',
        use: 'gitcron-sdd',
        modelId: 'opus',
        runtime: 'claude',
        modelSource: 'agent',
        isException: true,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('devuelve disabled cuando agent.gitcron-sdd.disable es true', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resolve-agent-'));
    const configPath = path.join(tempDir, 'gitcron.json');
    fs.writeFileSync(configPath, JSON.stringify({
      model: 'codex/gpt-5.5',
      agent: {
        'gitcron-sdd': {
          disable: true,
        },
      },
    }));

    try {
      const res = resolveAgentFor({ configPath });
      expect(res).toMatchObject({
        status: 'disabled',
        use: 'gitcron-sdd',
        sourceFile: configPath,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('devuelve unset cuando no hay modelo en agent ni general', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-resolve-agent-'));
    const configPath = path.join(tempDir, 'gitcron.json');
    fs.writeFileSync(configPath, JSON.stringify({
      provider: {},
    }));

    try {
      const res = resolveAgentFor({ configPath });
      expect(res).toEqual({
        status: 'unset',
        use: 'gitcron-sdd',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
