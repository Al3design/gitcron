// electron/__tests__/ai-config-ipc.test.ts
// Pruebas de integración de IPC para la sección de ajustes «Motores y modelos» (tarea 6.1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-aiconfig-test-'));
const handlers = new Map<string, (_event: unknown, ...args: any[]) => Promise<any>>();

const mockShellOpenPath = vi.fn(async (_p: string) => '');
const mockShellShowItemInFolder = vi.fn((_p: string) => {});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join(tempDir, 'userData');
      return tempDir;
    }),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => {
      handlers.set(channel, handler);
    }),
  },
  shell: {
    openPath: (p: string) => mockShellOpenPath(p),
    showItemInFolder: (p: string) => mockShellShowItemInFolder(p),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(`enc:${str}`)),
    decryptString: vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, '')),
  },
}));

import { registerAiConfigHandlers, setAiConfigPathForTesting, setMcpPathForTesting } from '../ipc/ai-config';
import { registerAiHandlers } from '../ipc/ai';
import {
  registerCommitMessageAiHandlers,
  setCommitAiConfigPathForTesting,
  resetCommitAiConfigWatcherForTesting,
  getWatchedConfigReposForTesting,
} from '../ipc/commit-message-ai';
import { setModelLoadSettingsDirForTesting } from '../ai/config/model-load-settings';
import { resetGitCronConfigCacheForTesting } from '../ai/config/gitcron-config';
import { setToolModelsExecutorsForTesting, clearToolModelsCacheForTesting } from '../ai/config/tool-models';
import * as keyStore from '../ai/key-store';
import { authorizedRepoStore } from '../ipc/authorized-repos';

const SECRET_KEY = 'sk-secret-token-never-leak-999';

describe('ai-config IPC handlers (tarea 6.1)', () => {
  let dir: string;
  let globalPath: string;
  let userDataDir: string;
  const originalFetch = global.fetch;
  const sender = { isDestroyed: () => false, send: vi.fn() };

  beforeEach(() => {
    handlers.clear();
    mockShellOpenPath.mockClear();
    mockShellShowItemInFolder.mockClear();
    clearToolModelsCacheForTesting();

    // Mock fetch inmediato
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));

    // Mock CLI no ejecutados en prueba
    setToolModelsExecutorsForTesting(
      async () => { throw new Error('Not installed'); },
      vi.fn() as any,
    );

    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-cfg-test-')));
    globalPath = path.join(dir, 'gitcron.json');
    userDataDir = path.join(tempDir, 'userData');
    fs.mkdirSync(userDataDir, { recursive: true });

    setAiConfigPathForTesting(globalPath);
    setCommitAiConfigPathForTesting(globalPath);
    setModelLoadSettingsDirForTesting(path.join(userDataDir, 'model-load-settings'));
    resetGitCronConfigCacheForTesting();

    registerAiHandlers();
    registerCommitMessageAiHandlers();
    registerAiConfigHandlers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearToolModelsCacheForTesting();
    setToolModelsExecutorsForTesting(null, null);
    resetCommitAiConfigWatcherForTesting();
    setAiConfigPathForTesting(null);
    setMcpPathForTesting(null);
    setCommitAiConfigPathForTesting(null);
    setModelLoadSettingsDirForTesting(null);
    resetGitCronConfigCacheForTesting();
    authorizedRepoStore.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('«Abrir el archivo» y «Mostrar en la carpeta» rechazan cualquier ruta que no sea un gitcron.json o un mcp.json en uso', async () => {
    fs.writeFileSync(globalPath, JSON.stringify({ model: 'casa/qwen' }, null, 2));

    const openFile = handlers.get('ai-config:open-file')!;
    const showInFolder = handlers.get('ai-config:show-in-folder')!;

    // 1. Ruta arbitraria rechazada
    const badPath = path.join(dir, 'malicioso.txt');
    fs.writeFileSync(badPath, 'hola');
    const resBad = await openFile({ sender }, { filePath: badPath });
    expect(resBad.success).toBe(false);
    expect(resBad.error).toContain('no es un gitcron.json ni un mcp.json en uso');
    expect(mockShellOpenPath).not.toHaveBeenCalled();

    // 2. Directorio rechazado
    const resDir = await openFile({ sender }, { filePath: dir });
    expect(resDir.success).toBe(false);
    expect(mockShellOpenPath).not.toHaveBeenCalled();

    // 3. Archivo gitcron.json activo en uso aceptado
    const resGood = await openFile({ sender }, { filePath: globalPath });
    expect(resGood.success).toBe(true);
    expect(mockShellOpenPath).toHaveBeenCalledWith(globalPath);

    // 4. showInFolder también rechaza rutas ajenas y acepta las activas
    const resShowBad = await showInFolder({ sender }, { filePath: badPath });
    expect(resShowBad.success).toBe(false);
    expect(mockShellShowItemInFolder).not.toHaveBeenCalled();

    const resShowGood = await showInFolder({ sender }, { filePath: globalPath });
    expect(resShowGood.success).toBe(true);
    expect(mockShellShowItemInFolder).toHaveBeenCalledWith(globalPath);

    // 5. El mcp.json global en uso también se acepta (sección de servidores MCP)
    const mcpPath = path.join(dir, 'mcp.json');
    setMcpPathForTesting(mcpPath);
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }, null, 2));
    const resMcp = await openFile({ sender }, { filePath: mcpPath });
    expect(resMcp.success).toBe(true);
    expect(mockShellOpenPath).toHaveBeenCalledWith(mcpPath);
  });

  it('Contexto y tiempo de carga: se guardan y se releen tras reiniciar; el tiempo NUNCA aparece en gitcron.json', async () => {
    const initialContent = `// Archivo con comentarios
{
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:1234/v1"
      },
      "models": {
        "qwen-2.5-coder": {
          "name": "Qwen 2.5 Coder"
        }
      }
    }
  }
}`;
    fs.writeFileSync(globalPath, initialContent, 'utf-8');

    const setSettings = handlers.get('ai-config:set-model-load-settings')!;
    const getSettings = handlers.get('ai-config:get-model-load-settings')!;

    // Guardar contexto (8192) y TTL (30 minutos)
    const saveRes = await setSettings({ sender }, {
      providerId: 'lmstudio',
      modelId: 'qwen-2.5-coder',
      contextLength: 8192,
      ttlMinutes: 30,
    });
    expect(saveRes.success).toBe(true);

    // Verificar contenido de gitcron.json
    const fileAfter = fs.readFileSync(globalPath, 'utf-8');
    // Contexto se guardó en limit.context
    expect(fileAfter).toContain('"context": 8192');
    // Comentario inicial se conservó
    expect(fileAfter).toContain('// Archivo con comentarios');
    // TTL NUNCA se guardó en gitcron.json
    expect(fileAfter).not.toContain('ttlMinutes');
    expect(fileAfter).not.toContain('ttl');
    expect(fileAfter).not.toContain('30');

    // Simular reinicio: resetear caches y re-consultar
    resetGitCronConfigCacheForTesting();
    const readBack = await getSettings({ sender }, {
      providerId: 'lmstudio',
      modelId: 'qwen-2.5-coder',
    });

    expect(readBack.success).toBe(true);
    expect(readBack.data).toEqual({
      contextLength: 8192,
      ttlMinutes: 30,
    });
  });

  it('Agregar un proveedor: archivo queda igual salvo el bloque, clave va como {env:…} y el valor al baúl', async () => {
    const initialContent = `// Configuración personal
{
  "model": "codex/gpt-5.5"
}`;
    fs.writeFileSync(globalPath, initialContent, 'utf-8');

    const addProvider = handlers.get('ai-config:add-provider')!;
    const addRes = await addProvider({ sender }, {
      id: 'unslothpc',
      name: 'Unsloth PC',
      baseURL: 'https://llm.example.com/v1',
      apiKey: SECRET_KEY,
    });

    expect(addRes.error).toBeUndefined();
    expect(addRes.success).toBe(true);

    // 1. Archivo en disco:
    const fileContent = fs.readFileSync(globalPath, 'utf-8');
    expect(fileContent).toContain('// Configuración personal');
    expect(fileContent).toContain('"unslothpc"');
    expect(fileContent).toContain('"baseURL": "https://llm.example.com/v1"');
    expect(fileContent).toContain('"apiKey": "{env:UNSLOTHPC_API_KEY}"');

    // NUNCA escribir el valor de la clave en gitcron.json
    expect(fileContent).not.toContain(SECRET_KEY);

    // 2. El valor secreto está en el baúl:
    expect(keyStore.hasStoredEnvVar('UNSLOTHPC_API_KEY')).toBe(true);
    expect(keyStore.getStoredEnvVar('UNSLOTHPC_API_KEY')).toBe(SECRET_KEY);

    // 3. Consultar status: el valor secreto NUNCA vuelve en el JSON
    const statusHandler = handlers.get('ai-config:status')!;
    const statusRes = await statusHandler({ sender }, {});
    expect(statusRes.success).toBe(true);
    const jsonStr = JSON.stringify(statusRes);
    expect(jsonStr).not.toContain(SECRET_KEY);

    const providerInfo = statusRes.data.providers.find((p: any) => p.id === 'unslothpc');
    expect(providerInfo).toBeDefined();
    expect(providerInfo.envVars).toEqual([
      { name: 'UNSLOTHPC_API_KEY', isApiKey: true, status: 'stored' },
    ]);

    // 4. Quitar el proveedor: remueve el bloque y con deleteStoredVar borra del baúl
    const removeProvider = handlers.get('ai-config:remove-provider')!;
    const remRes = await removeProvider({ sender }, {
      id: 'unslothpc',
      deleteStoredVar: true,
    });
    expect(remRes.success).toBe(true);

    const fileAfterRemove = fs.readFileSync(globalPath, 'utf-8');
    expect(fileAfterRemove).toContain('// Configuración personal');
    expect(fileAfterRemove).toContain('"model": "codex/gpt-5.5"');
    expect(fileAfterRemove).not.toContain('unslothpc');
    expect(keyStore.hasStoredEnvVar('UNSLOTHPC_API_KEY')).toBe(false);
  });

  it('Parámetro avanzado: agregar, cambiar y quitar sin dejar options: {}', async () => {
    const initialContent = `{
  "agent": {
    "gitcron-commit": {
      "model": "codex/gpt-5.5"
    }
  }
}`;
    fs.writeFileSync(globalPath, initialContent, 'utf-8');

    const setParam = handlers.get('ai-config:set-use-param')!;
    const removeParam = handlers.get('ai-config:remove-use-param')!;

    // 1. Agregar un parámetro avanzado (p. ej. reasoning_effort)
    const res1 = await setParam({ sender }, {
      use: 'gitcron-commit',
      param: 'reasoning_effort',
      value: 'high',
    });
    expect(res1.success).toBe(true);
    let content = fs.readFileSync(globalPath, 'utf-8');
    expect(content).toContain('"reasoning_effort": "high"');

    // 2. Modificar el parámetro
    const res2 = await setParam({ sender }, {
      use: 'gitcron-commit',
      param: 'reasoning_effort',
      value: 'ultra',
    });
    expect(res2.success).toBe(true);
    content = fs.readFileSync(globalPath, 'utf-8');
    expect(content).toContain('"reasoning_effort": "ultra"');

    // 3. Quitar el parámetro: debe limpiar options si quedó vacío (D4)
    const res3 = await removeParam({ sender }, {
      use: 'gitcron-commit',
      param: 'reasoning_effort',
    });
    expect(res3.success).toBe(true);
    content = fs.readFileSync(globalPath, 'utf-8');
    expect(content).not.toContain('reasoning_effort');
    expect(content).not.toContain('"options": {}');
    expect(content).not.toContain('"options"');
  });

  it('Un cambio desde la pantalla (setGeneralModel) deja el resto del archivo idéntico byte a byte', async () => {
    const initialContent = `{
  // Comentario de cabecera
  "provider": {
    "lmstudio": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "http://localhost:1234/v1" } }
  },
  "model": "lmstudio/qwen"
}`;
    fs.writeFileSync(globalPath, initialContent, 'utf-8');

    const setGeneralModel = handlers.get('ai-config:set-general-model')!;
    const res = await setGeneralModel({ sender }, { model: 'codex/gpt-5.6-sol' });
    expect(res.success).toBe(true);

    const fileContent = fs.readFileSync(globalPath, 'utf-8');
    expect(fileContent).toContain('// Comentario de cabecera');
    expect(fileContent).toContain('"model": "codex/gpt-5.6-sol"');
    expect(fileContent).toContain('"lmstudio": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "http://localhost:1234/v1" } }');
  });

  it('agregar un proveedor no pisa uno existente y va al global aunque haya un repositorio abierto (D2)', async () => {
    fs.writeFileSync(globalPath, '{ "provider": { "casa": { "options": { "baseURL": "http://192.168.1.7:8888/v1" } } } }', 'utf-8');
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    authorizedRepoStore.authorizeRepo(repo);
    const addProvider = handlers.get('ai-config:add-provider')!;

    const dup = await addProvider({ sender }, { id: 'casa', baseURL: 'http://otra/v1' });
    expect(dup.success).toBe(false);
    expect(dup.error).toMatch(/Ya hay un proveedor «casa»/);
    expect(fs.readFileSync(globalPath, 'utf-8')).toContain('192.168.1.7');

    const res = await addProvider({ sender }, { id: 'nuevo', baseURL: 'http://10.0.0.5/v1', repoPath: repo });
    expect(res.success).toBe(true);
    expect(fs.readFileSync(globalPath, 'utf-8')).toContain('"nuevo"');
    // Nada se escribe dentro del repositorio.
    expect(fs.existsSync(path.join(repo, 'gitcron.json'))).toBe(false);
  });

  it('quitar un proveedor «con su clave» no borra las variables que usa otro proveedor', async () => {
    fs.writeFileSync(globalPath, JSON.stringify({
      provider: {
        casalocal: { options: { baseURL: 'http://192.168.1.7:8888/v1', apiKey: '{env:GITCRON_TEST_COMPARTIDA}', headers: { 'X-Propia': '{env:GITCRON_TEST_PROPIA}' } } },
        casatunel: { options: { baseURL: 'https://llm.example.dev/v1', apiKey: '{env:GITCRON_TEST_COMPARTIDA}' } },
      },
    }, null, 2), 'utf-8');
    keyStore.setEnvVar('GITCRON_TEST_COMPARTIDA', 'valor-compartido');
    keyStore.setEnvVar('GITCRON_TEST_PROPIA', 'valor-propio');
    try {
      const res = await handlers.get('ai-config:remove-provider')!({ sender }, { id: 'casalocal', deleteStoredVar: true });
      expect(res.success).toBe(true);
      expect(keyStore.hasStoredEnvVar('GITCRON_TEST_COMPARTIDA')).toBe(true);
      expect(keyStore.hasStoredEnvVar('GITCRON_TEST_PROPIA')).toBe(false);
    } finally {
      keyStore.removeEnvVar('GITCRON_TEST_COMPARTIDA');
    }
  });

  it('el contexto va al proveedor del uso y nunca crea un proveedor a medias', async () => {
    const initial = JSON.stringify({
      provider: { casa: { options: { baseURL: 'http://192.168.1.7:8888/v1' }, models: { qwen: {} } } },
      agent: { 'gitcron-commit': { model: 'casa/qwen' } },
    }, null, 2);
    fs.writeFileSync(globalPath, initial, 'utf-8');
    const set = handlers.get('ai-config:set-model-load-settings')!;

    // Sin proveedor explícito: sale del uso (casa), no de un «lmstudio» supuesto.
    expect((await set({ sender }, { modelId: 'qwen', use: 'gitcron-commit', contextLength: 32768 })).success).toBe(true);
    const after = JSON.parse(fs.readFileSync(globalPath, 'utf-8'));
    expect(after.provider.casa.models.qwen.limit.context).toBe(32768);
    expect(after.provider.lmstudio).toBeUndefined();

    // Un modelo de un uso sin servidor declarado: se dice y el archivo no cambia.
    const before = fs.readFileSync(globalPath, 'utf-8');
    const res = await set({ sender }, { modelId: 'otro', use: 'gitcron-temporal', contextLength: 32768 });
    expect(res.success).toBe(false);
    expect(fs.readFileSync(globalPath, 'utf-8')).toBe(before);
  });

  describe('Editor IPC: read-file-content y save-file-content (tarea 24b)', () => {
    it('archivo roto con apiKey literal nunca devuelve el secreto ni el contenido', async () => {
      const brokenWithSecret = '{\n  "provider": {\n    "test": {\n      "apiKey": "sk-prueba-123",\n';
      fs.writeFileSync(globalPath, brokenWithSecret, 'utf-8');

      const readFileContent = handlers.get('ai-config:read-file-content')!;
      const res = await readFileContent({ sender }, { scope: 'global' });
      expect(res.success).toBe(true);
      expect(res.data.hasLiteralSecrets).toBe(true);
      expect(res.data.content).toBeUndefined();
      expect(JSON.stringify(res)).not.toContain('sk-prueba-123');
    });

    it('guardar escribe el texto exacto en disco y limpia archivos temporales atómicos', async () => {
      const initialText = '{\n  "provider": {}\n}';
      fs.writeFileSync(globalPath, initialText, 'utf-8');
      const baseHash = require('node:crypto').createHash('sha256').update(initialText, 'utf8').digest('hex');

      const saveFileContent = handlers.get('ai-config:save-file-content')!;
      const newText = '{\n  "provider": {},\n  "model": "codex/gpt-5.6-sol"\n}';
      const res = await saveFileContent({ sender }, {
        scope: 'global',
        content: newText,
        baseHash,
      });

      expect(res.success).toBe(true);
      expect(res.data.conflict).toBeUndefined();
      expect(res.data.hash).toBeDefined();
      expect(fs.readFileSync(globalPath, 'utf-8')).toBe(newText);

      // Comprobar que no quedó ningún archivo .tmp en el directorio
      const tmpFiles = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('pre-save: error de sintaxis no toca el archivo y devuelve datos estructurados con la línea', async () => {
      const initialText = '{\n  "model": "codex/gpt-5.6-sol"\n}';
      fs.writeFileSync(globalPath, initialText, 'utf-8');
      const baseHash = require('node:crypto').createHash('sha256').update(initialText, 'utf8').digest('hex');

      const brokenText = '{\n  "model": "codex/gpt-5.6-sol",,\n}';
      const saveFileContent = handlers.get('ai-config:save-file-content')!;
      const res = await saveFileContent({ sender }, {
        scope: 'global',
        content: brokenText,
        baseHash,
      });

      expect(res.success).toBe(true);
      expect(res.data.parseError).toBeDefined();
      expect(res.data.parseError.line).toBe(2);
      expect(fs.readFileSync(globalPath, 'utf-8')).toBe(initialText);
    });

    it('pre-save: rechaza guardar una clave escrita a mano con la línea y no toca el archivo', async () => {
      const initialText = '{\n  "provider": {}\n}';
      fs.writeFileSync(globalPath, initialText, 'utf-8');
      const baseHash = require('node:crypto').createHash('sha256').update(initialText, 'utf8').digest('hex');

      const secretText = '{\n  "provider": {\n    "casa": {\n      "apiKey": "sk-secreto-en-editor"\n    }\n  }\n}';
      const saveFileContent = handlers.get('ai-config:save-file-content')!;
      const res = await saveFileContent({ sender }, {
        scope: 'global',
        content: secretText,
        baseHash,
      });

      expect(res.success).toBe(true);
      expect(res.data.secretRejected).toBe(true);
      expect(res.data.secretLine).toBe(4);
      expect(fs.readFileSync(globalPath, 'utf-8')).toBe(initialText);
    });

    it('conflicto: si el archivo cambió afuera, o no hay baseHash, o el archivo no existe, devuelve conflict y no pisa', async () => {
      const initialText = '{\n  "provider": {}\n}';
      fs.writeFileSync(globalPath, initialText, 'utf-8');
      const saveFileContent = handlers.get('ai-config:save-file-content')!;

      // 1. Sin baseHash
      const noHash = await saveFileContent({ sender }, {
        scope: 'global',
        content: '{\n  "model": "test"\n}',
      });
      expect(noHash.success).toBe(true);
      expect(noHash.data.conflict).toBe(true);
      expect(fs.readFileSync(globalPath, 'utf-8')).toBe(initialText);

      // 2. Hash desactualizado (cambio externo)
      const conflict = await saveFileContent({ sender }, {
        scope: 'global',
        content: '{\n  "model": "test"\n}',
        baseHash: 'hash-viejo-que-no-coincide',
      });
      expect(conflict.success).toBe(true);
      expect(conflict.data.conflict).toBe(true);
      expect(fs.readFileSync(globalPath, 'utf-8')).toBe(initialText);

      // 3. Archivo borrado afuera
      fs.unlinkSync(globalPath);
      const deleted = await saveFileContent({ sender }, {
        scope: 'global',
        content: '{\n  "model": "test"\n}',
        baseHash: 'hash-cualquiera',
      });
      expect(deleted.success).toBe(true);
      expect(deleted.data.conflict).toBe(true);
      expect(fs.existsSync(globalPath)).toBe(false);
    });

    it('scope repo con repositorio no autorizado falla de forma segura', async () => {
      const unauthorizedRepo = path.join(dir, 'unauthorized-repo');
      fs.mkdirSync(unauthorizedRepo, { recursive: true });

      const readFileContent = handlers.get('ai-config:read-file-content')!;
      const readRes = await readFileContent({ sender }, {
        scope: 'repo',
        repoPath: unauthorizedRepo,
      });
      expect(readRes.success).toBe(false);
      expect(readRes.error).toMatch(/Repositorio no autorizado/);

      const saveFileContent = handlers.get('ai-config:save-file-content')!;
      const saveRes = await saveFileContent({ sender }, {
        scope: 'repo',
        repoPath: unauthorizedRepo,
        content: '{}',
        baseHash: 'hash',
      });
      expect(saveRes.success).toBe(false);
      expect(saveRes.error).toMatch(/Repositorio no autorizado/);
    });

    it('ai-config:status registra la observación de configuración para la ventana sin depender de otros canales', async () => {
      resetCommitAiConfigWatcherForTesting();
      const testSender = { isDestroyed: () => false, send: vi.fn() };

      const statusHandler = handlers.get('ai-config:status')!;
      const res = await statusHandler({ sender: testSender }, { repoPath: null });
      expect(res.success).toBe(true);

      // Comportamiento observable: una edición externa en el archivo temporal notifica al sender
      fs.writeFileSync(globalPath, JSON.stringify({ provider: { test: { name: 'Observado' } } }));
      await vi.waitFor(() => {
        expect(testSender.send).toHaveBeenCalledWith('gitcron-config:changed', { repoPath: null });
      }, { timeout: 1500 });

      // Deduplicación observable: invocar ai-config:status de nuevo con el mismo sender no genera doble notificación
      testSender.send.mockClear();
      await statusHandler({ sender: testSender }, { repoPath: null });
      fs.writeFileSync(globalPath, JSON.stringify({ provider: { test: { name: 'Observado 2' } } }));
      await vi.waitFor(() => {
        expect(testSender.send).toHaveBeenCalledWith('gitcron-config:changed', { repoPath: null });
      }, { timeout: 1500 });
      expect(testSender.send).toHaveBeenCalledTimes(1);

      // Autorización: si se pasa un repositorio no autorizado, no se observa en el watcher
      const unauthorizedRepo = path.join(dir, 'no-autorizado');
      fs.mkdirSync(path.join(unauthorizedRepo, '.git'), { recursive: true });
      await statusHandler({ sender: testSender }, { repoPath: unauthorizedRepo });
      expect(getWatchedConfigReposForTesting()).not.toContain(unauthorizedRepo);

      // Si además se pasa un repositorio autorizado, queda registrado en el watcher y notifica con su ruta
      const authorizedDir = path.join(dir, 'repo-autorizado');
      fs.mkdirSync(path.join(authorizedDir, '.git'), { recursive: true });
      const canonical = authorizedRepoStore.authorizeRepo(authorizedDir);
      expect(canonical).not.toBeNull();

      testSender.send.mockClear();
      const resRepo = await statusHandler({ sender: testSender }, { repoPath: canonical });
      expect(resRepo.success).toBe(true);
      expect(getWatchedConfigReposForTesting()).toContain(canonical);

      fs.writeFileSync(path.join(canonical!, 'gitcron.json'), JSON.stringify({ provider: { r: { name: 'En Repo' } } }));
      await vi.waitFor(() => {
        expect(testSender.send).toHaveBeenCalledWith('gitcron-config:changed', { repoPath: canonical });
      }, { timeout: 1500 });
    });
  });
});
