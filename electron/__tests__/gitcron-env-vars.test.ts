// Variables de `{env:NOMBRE}` guardadas en GitCron (modelos-en-casa D5, tarea 3.2):
// el baúl y sus canales. Ningún canal devuelve un valor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-envvars-test-'));
const handlers = new Map<string, (_event: unknown, ...args: any[]) => Promise<any>>();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tempDir) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => {
      handlers.set(channel, handler);
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(`enc:${str}`)),
    decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, '')),
  },
}));
vi.mock('../ipc/storage', () => ({ readEncryptedStorage: vi.fn(() => ({})) }));
vi.mock('../temporal-agent-ipc', () => ({
  loadConfig: vi.fn(),
  loadNotes: vi.fn(),
  savePrediction: vi.fn(),
  loadPrediction: vi.fn(),
}));

import * as keyStore from '../ai/key-store';

const SECRET = 'valor-secreto-que-no-vuelve-123';

describe('variables guardadas para {env:} (D5)', () => {
  beforeEach(async () => {
    handlers.clear();
    const file = path.join(tempDir, 'ai-keys.enc');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    delete process.env.GITCRON_TEST_VAR;
    const { registerAiHandlers } = await import('../ipc/ai');
    registerAiHandlers();
  });

  afterEach(() => {
    delete process.env.GITCRON_TEST_VAR;
  });

  it('guardar, consultar y borrar en el baúl, en su propio espacio', () => {
    expect(keyStore.hasStoredEnvVar('GITCRON_TEST_GUARDADA')).toBe(false);
    keyStore.setEnvVar('GITCRON_TEST_GUARDADA', SECRET);
    expect(keyStore.hasStoredEnvVar('GITCRON_TEST_GUARDADA')).toBe(true);
    expect(keyStore.getStoredEnvVar('GITCRON_TEST_GUARDADA')).toBe(SECRET);
    // No pisa ni se confunde con las claves por proveedor.
    expect(keyStore.hasKey('unsloth')).toBe(false);
    keyStore.removeEnvVar('GITCRON_TEST_GUARDADA');
    expect(keyStore.getStoredEnvVar('GITCRON_TEST_GUARDADA')).toBeUndefined();
  });

  it('las claves viejas de OpenRouter y Anthropic se ven como OPENROUTER_API_KEY y ANTHROPIC_API_KEY', () => {
    keyStore.setKey('openrouter', 'sk-or-123');
    keyStore.setKey('claude', 'sk-ant-456');
    expect(keyStore.getStoredEnvVar('OPENROUTER_API_KEY')).toBe('sk-or-123');
    expect(keyStore.getStoredEnvVar('ANTHROPIC_API_KEY')).toBe('sk-ant-456');
    expect(keyStore.hasStoredEnvVar('OPENROUTER_API_KEY')).toBe(true);
    // Borrar la variable no borra la clave del proveedor.
    keyStore.removeEnvVar('OPENROUTER_API_KEY');
    expect(keyStore.getKey('openrouter')).toBe('sk-or-123');
  });

  it('rechaza nombres que no son de variable', () => {
    expect(() => keyStore.setEnvVar('con espacio', 'x')).toThrow('INVALID_ENV_VAR_NAME');
    expect(() => keyStore.setEnvVar('env:X', 'x')).toThrow('INVALID_ENV_VAR_NAME');
    expect(() => keyStore.hasStoredEnvVar('../x')).toThrow('INVALID_ENV_VAR_NAME');
  });

  it('los canales dicen de dónde sale cada variable y nunca devuelven un valor', async () => {
    process.env.GITCRON_TEST_VAR = 'del-sistema-789';
    const set = await handlers.get('ai:set-env-var')!(null, 'GITCRON_TEST_GUARDADA', SECRET);
    expect(set).toEqual({ success: true });

    const status = await handlers.get('ai:env-status')!(null, ['GITCRON_TEST_VAR', 'GITCRON_TEST_GUARDADA', 'NO_EXISTE']);
    expect(status).toEqual({
      success: true,
      data: { GITCRON_TEST_VAR: 'system', GITCRON_TEST_GUARDADA: 'stored', NO_EXISTE: 'missing' },
    });

    const removed = await handlers.get('ai:remove-env-var')!(null, 'GITCRON_TEST_GUARDADA');
    expect(removed).toEqual({ success: true });

    // Ninguna respuesta lleva un valor, ni el guardado ni el del sistema.
    const everything = JSON.stringify([set, status, removed]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('del-sistema-789');
  });

  it('un error al guardar no repite el valor', async () => {
    const res = await handlers.get('ai:set-env-var')!(null, 'nombre inválido', SECRET);
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });
});
