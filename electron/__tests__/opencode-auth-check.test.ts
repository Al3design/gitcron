// electron/__tests__/opencode-auth-check.test.ts
//
// Pruebas de comprobación de claves entre OpenCode y GitCron (tarea 5.3 segunda parte, D8).
//
// Cuatro casos:
// 1. Igual: nada (status 'match', notice null).
// 2. OpenCode lo ve vacío y GitCron no: missing_env con variableName.
// 3. Distinto y hay una clave en auth.json: auth_json_override con orden para copiar.
// 4. Distinto sin clave en auth.json: mismatch_other.
//
// SEGURIDAD: Ningún valor de clave o secreto aparece en la respuesta del objeto o canal.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkOpenCodeAuth } from '../ai/config/opencode-auth-check';
import type { GitCronConfig } from '../ai/config/gitcron-config';

describe('opencode-auth-check', () => {
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-auth-test-'));

  const SECRET_GITCRON = 'super-secret-gitcron-key-12345';
  const SECRET_OPENCODE_DIFF = 'different-opencode-key-67890';
  const SECRET_AUTH_JSON = 'stale-auth-json-key-99999';

  it('caso 1: igual -> status match y notice null', async () => {
    const dir = tmpDir();
    const configPath = path.join(dir, 'gitcron.json');
    const authPath = path.join(dir, 'auth.json');

    const config: GitCronConfig = {
      model: 'unsloth/Qwen3.8',
      provider: {
        unsloth: {
          name: 'Unsloth CASA',
          options: {
            apiKey: '{env:UNSLOTH_API_KEY}',
            headers: { 'X-Custom-Header': '{env:CUSTOM_HEADER}' },
          },
          models: { 'unsloth/Qwen3.8': { name: 'Qwen 3.8' } },
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      UNSLOTH_API_KEY: SECRET_GITCRON,
      CUSTOM_HEADER: 'header-val',
    };

    const res = await checkOpenCodeAuth({
      providerId: 'unsloth',
      modelId: 'unsloth/Qwen3.8',
      configPath,
      authPath,
      env,
      opencodeResolvedCredentials: {
        apiKey: SECRET_GITCRON,
        headers: { 'X-Custom-Header': 'header-val' },
      },
    });

    expect(res.status).toBe('match');
    expect(res.notice).toBeNull();
  });

  it('caso 2: OpenCode lo ve vacío y GitCron no -> missing_env con variableName', async () => {
    const dir = tmpDir();
    const configPath = path.join(dir, 'gitcron.json');
    const authPath = path.join(dir, 'auth.json');

    const config: GitCronConfig = {
      model: 'unsloth/Qwen3.8',
      provider: {
        unsloth: {
          name: 'Unsloth CASA',
          options: {
            apiKey: '{env:UNSLOTH_API_KEY}',
          },
          models: { 'unsloth/Qwen3.8': { name: 'Qwen 3.8' } },
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      UNSLOTH_API_KEY: SECRET_GITCRON,
    };

    const res = await checkOpenCodeAuth({
      providerId: 'unsloth',
      modelId: 'unsloth/Qwen3.8',
      configPath,
      authPath,
      env,
      // OpenCode lo ve vacío
      opencodeResolvedCredentials: {
        apiKey: '',
        headers: {},
      },
    });

    expect(res.status).toBe('mismatch');
    expect(res.notice).toEqual({
      kind: 'missing_env',
      variableName: 'UNSLOTH_API_KEY',
    });

    // Comprobar que ningún secreto aparece en el resultado devuelto
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(SECRET_GITCRON);
  });

  it('caso 3: distinto y hay clave en auth.json -> auth_json_override con comando de logout', async () => {
    const dir = tmpDir();
    const configPath = path.join(dir, 'gitcron.json');
    const authPath = path.join(dir, 'auth.json');

    const config: GitCronConfig = {
      model: 'unslothpc/Qwen3.8',
      provider: {
        unslothpc: {
          name: 'Unsloth Remoto',
          options: {
            apiKey: '{env:UNSLOTH_REMOTE_KEY}',
          },
          models: { 'unslothpc/Qwen3.8': { name: 'Qwen 3.8' } },
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

    // auth.json de OpenCode con una clave guardada
    fs.writeFileSync(authPath, JSON.stringify({
      unslothpc: {
        type: 'api',
        key: SECRET_AUTH_JSON,
      },
    }), 'utf8');

    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      UNSLOTH_REMOTE_KEY: SECRET_GITCRON,
    };

    const res = await checkOpenCodeAuth({
      providerId: 'unslothpc',
      modelId: 'unslothpc/Qwen3.8',
      configPath,
      authPath,
      env,
      opencodeResolvedCredentials: {
        apiKey: SECRET_AUTH_JSON,
      },
    });

    expect(res.status).toBe('mismatch');
    expect(res.notice).toEqual({
      kind: 'auth_json_override',
      providerId: 'unslothpc',
      logoutCommand: 'opencode auth logout unslothpc',
    });

    // Comprobar que ningún secreto aparece en el resultado devuelto
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(SECRET_GITCRON);
    expect(serialized).not.toContain(SECRET_AUTH_JSON);
  });

  it('caso 4: distinto sin clave en auth.json -> mismatch_other', async () => {
    const dir = tmpDir();
    const configPath = path.join(dir, 'gitcron.json');
    const authPath = path.join(dir, 'auth.json');

    const config: GitCronConfig = {
      model: 'unslothpc/Qwen3.8',
      provider: {
        unslothpc: {
          name: 'Unsloth Remoto',
          options: {
            apiKey: '{env:UNSLOTH_REMOTE_KEY}',
          },
          models: { 'unslothpc/Qwen3.8': { name: 'Qwen 3.8' } },
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

    // auth.json no tiene entrada para unslothpc
    fs.writeFileSync(authPath, JSON.stringify({
      otro_proveedor: { type: 'api', key: 'otra-clave' },
    }), 'utf8');

    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      UNSLOTH_REMOTE_KEY: SECRET_GITCRON,
    };

    const res = await checkOpenCodeAuth({
      providerId: 'unslothpc',
      modelId: 'unslothpc/Qwen3.8',
      configPath,
      authPath,
      env,
      opencodeResolvedCredentials: {
        apiKey: SECRET_OPENCODE_DIFF,
      },
    });

    expect(res.status).toBe('mismatch');
    expect(res.notice).toEqual({
      kind: 'mismatch_other',
      providerId: 'unslothpc',
    });

    // Comprobar que ningún secreto aparece en el resultado devuelto
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(SECRET_GITCRON);
    expect(serialized).not.toContain(SECRET_OPENCODE_DIFF);
  });
});
