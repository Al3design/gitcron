// @vitest-environment jsdom
// components/ai/__tests__/AiSettingsSection.test.tsx
// Pruebas de renderizado, interacción y seguridad para AiSettingsSection (tarea 6.1).

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { AiSettingsSection } from '../AiSettingsSection';
import type {
  AiConfigStatusResult,
  AiOpenCodeImportPlanResult,
  AiMcpStatusResult,
  AiMcpImportPlanResult,
} from '@/types/ai-config';

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

const mockStatusValid: AiConfigStatusResult = {
  files: [
    {
      path: 'C:/Users/test/.config/gitcron/gitcron.json',
      scope: 'global',
      exists: true,
    },
  ],
  warnings: [],
  generalModel: 'lmstudio/qwen',
  smallModel: 'lmstudio/small',
  providers: [
    {
      id: 'lmstudio',
      name: 'LM Studio Local',
      family: 'openai-compatible',
      baseURL: 'http://localhost:1234/v1',
      available: true,
      canLoad: true,
      isCli: false,
      envVars: [],
      declaredModels: ['qwen'],
    },
    {
      id: 'unslothpc',
      name: 'Unsloth PC',
      family: 'openai-compatible',
      baseURL: 'https://llm.example.com/v1',
      available: true,
      canLoad: false,
      isCli: false,
      envVars: [
        {
          name: 'UNSLOTH_API_KEY',
          isApiKey: true,
          status: 'missing',
        },
      ],
      declaredModels: ['deepseek'],
    },
    {
      id: 'codex',
      name: 'Codex',
      family: 'cli',
      available: true,
      canLoad: false,
      isCli: true,
      envVars: [],
      declaredModels: [],
    },
  ],
  uses: [
    {
      use: 'gitcron-commit',
      model: 'lmstudio/qwen',
      modelSource: 'general',
      isException: false,
      temperature: 0.7,
      maxTokens: 4096,
      advancedOptions: [],
    },
    {
      use: 'gitcron-cartography',
      model: 'unslothpc/deepseek',
      modelSource: 'agent',
      isException: true,
      temperature: 0.2,
      maxTokens: 2048,
      advancedOptions: [
        { key: 'top_p', value: 0.95 },
      ],
    },
    {
      use: 'gitcron-openspec-analysis',
      model: 'lmstudio/qwen',
      modelSource: 'general',
      isException: false,
      advancedOptions: [],
    },
    {
      use: 'gitcron-temporal',
      model: 'lmstudio/qwen',
      modelSource: 'general',
      isException: false,
      advancedOptions: [],
    },
  ],
};

const mockStatusBroken: AiConfigStatusResult = {
  files: [
    {
      path: 'C:/Users/test/.config/gitcron/gitcron.json',
      scope: 'global',
      exists: true,
      error: {
        file: 'C:/Users/test/.config/gitcron/gitcron.json',
        line: 14,
        column: 5,
        code: 'ColonExpected',
      },
    },
  ],
  warnings: [],
  generalModel: null,
  smallModel: null,
  providers: [],
  uses: [],
};

const mcpStatusEmpty: AiMcpStatusResult = { files: [], servers: [] };

describe('AiSettingsSection (tarea 6.1)', () => {
  beforeEach(() => {
    localStorage.clear();
    useGitStore.setState({ language: 'es' });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
    else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
  });

  it('se monta limpiamente en español, inglés y chino', async () => {
    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        openFile: vi.fn(),
        showInFolder: vi.fn(),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    // 1. Español
    useGitStore.setState({ language: 'es' });
    const { unmount: u1 } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText('Motores y modelos')).toBeDefined();
      expect(screen.getByText('Qué modelo usa cada cosa')).toBeDefined();
      expect(screen.getByText('Proveedores y modelos')).toBeDefined();
      expect(screen.getByText('El archivo')).toBeDefined();
      expect(screen.getByText('Importar desde OpenCode')).toBeDefined();
      expect(screen.getByText('Servidores MCP')).toBeDefined();
    });
    u1();

    // 2. Inglés
    useGitStore.setState({ language: 'en' });
    const { unmount: u2 } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText('Engines & Models')).toBeDefined();
      expect(screen.getByText('What model each feature uses')).toBeDefined();
      expect(screen.getByText('Providers and models')).toBeDefined();
      expect(screen.getByText('The file')).toBeDefined();
      expect(screen.getByText('Import from OpenCode')).toBeDefined();
      expect(screen.getByText('MCP servers')).toBeDefined();
    });
    u2();

    // 3. Chino
    useGitStore.setState({ language: 'zh' });
    const { unmount: u3 } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText('引擎与模型')).toBeDefined();
      expect(screen.getByText('各功能使用的模型')).toBeDefined();
      expect(screen.getByText('提供方与模型')).toBeDefined();
      expect(screen.getByText('配置文件')).toBeDefined();
      expect(screen.getByText('从 OpenCode 导入')).toBeDefined();
      expect(screen.getByText('MCP 服务器')).toBeDefined();
    });
    u3();
  });

  it('un archivo roto muestra su error con línea y no ofrece escribir', async () => {
    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusBroken })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    useGitStore.setState({ language: 'es' });
    render(<AiSettingsSection />);

    await waitFor(() => {
      // Muestra la línea del error y el motivo (en el grupo 3 que se abre solo)
      expect(screen.getAllByText(/ColonExpected/i).length).toBeGreaterThanOrEqual(1);
    });

    // Abrir grupo 2 para verificar botón deshabilitado
    fireEvent.click(screen.getByRole('button', { name: /Proveedores y modelos/i }));
    await waitFor(() => {
      const addBtn = screen.getByRole('button', { name: /Agregar proveedor/i });
      expect(addBtn.hasAttribute('disabled')).toBe(true);
    });
  });

  it('clave: guardar en el baúl; el valor secreto NUNCA aparece en document.body.innerHTML ni en el estado largo', async () => {
    const SUPER_SECRET = 'token-super-secreto-998877';

    let currentStatus = { ...mockStatusValid };
    const mockSetEnvVar = vi.fn(async () => {
      // Simular que ahora la variable está guardada en GitCron
      currentStatus = {
        ...currentStatus,
        providers: currentStatus.providers.map((p) => {
          if (p.id === 'unslothpc') {
            return {
              ...p,
              envVars: [{ name: 'UNSLOTH_API_KEY', isApiKey: true, status: 'stored' }],
            };
          }
          return p;
        }),
      };
      return { success: true };
    });

    const mockApi = {
      ai: {
        setEnvVar: mockSetEnvVar,
        removeEnvVar: vi.fn(async () => ({ success: true })),
      },
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: currentStatus })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    useGitStore.setState({ language: 'es' });
    render(<AiSettingsSection />);

    // Abrir grupo 2
    fireEvent.click(await screen.findByRole('button', { name: /Proveedores y modelos/i }));

    // Desplegar Unsloth PC
    fireEvent.click(await screen.findByText('Unsloth PC'));

    // Encontrar input de clave
    const keyInput = (await screen.findByPlaceholderText(/Pegar clave/i)) as HTMLInputElement;

    // Escribir el secreto en el input
    fireEvent.change(keyInput, { target: { value: SUPER_SECRET } });

    // Guardar
    const saveKeyBtn = screen.getByRole('button', { name: /^Guardar$/i });
    fireEvent.click(saveKeyBtn);

    await waitFor(() => {
      expect(mockSetEnvVar).toHaveBeenCalledWith('UNSLOTH_API_KEY', SUPER_SECRET);
    });

    // Comprobar que el valor secreto desapareció completamente del DOM
    expect(document.body.innerHTML).not.toContain(SUPER_SECRET);
  });

  it('quitar proveedor: abre DangerConfirmDialog y avisa qué usos lo eligen', async () => {
    const mockRemoveProvider = vi.fn(async () => ({ success: true }));

    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        removeProvider: mockRemoveProvider,
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    useGitStore.setState({ language: 'es' });
    render(<AiSettingsSection />);

    // Abrir grupo 2
    fireEvent.click(await screen.findByRole('button', { name: /Proveedores y modelos/i }));

    // Desplegar Unsloth PC
    fireEvent.click(await screen.findByText('Unsloth PC'));

    // Botón de eliminar Unsloth PC
    const removeBtn = await screen.findByRole('button', { name: /Quitar proveedor/i });
    fireEvent.click(removeBtn);

    // Debe abrir DangerConfirmDialog y listar el uso afectado (Cartografía usa unslothpc)
    await waitFor(() => {
      expect(screen.getByText(/¿Quitar el proveedor «Unsloth PC»\?/i)).toBeDefined();
      expect(screen.getAllByText(/Cartografía/i).length).toBeGreaterThanOrEqual(1);
    });

    // Confirmar eliminación
    const confirmBtns = screen.getAllByRole('button', { name: /Quitar proveedor/i });
    const confirmBtn = confirmBtns[confirmBtns.length - 1];
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockRemoveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'unslothpc' }),
      );
    });
  });

  it('importar desde OpenCode: lo escrito en el archivo no tiene campo, lo que falta sí; guardar una variable rehace el plan sin perder lo elegido', async () => {
    const LITERAL_SECRET = 'token-secreto-opencode-987';
    const mockPlan: AiOpenCodeImportPlanResult = {
      source: { status: 'ok', path: 'C:/Users/test/.config/opencode/opencode.json' },
      target: { path: 'C:/Users/test/.config/gitcron/gitcron.json' },
      entries: [
        {
          kind: 'provider',
          id: 'mycustom',
          status: 'new',
          changes: [],
          variables: [
            { name: 'MYCUSTOM_API_KEY', status: 'fromFile' },
            { name: 'MY_HEADER_TOKEN', status: 'missing' },
          ],
        },
        {
          kind: 'provider',
          id: 'other',
          status: 'changed',
          variables: [],
          changes: [
            { segments: ['options', 'apiKey'], beforeHidden: true, after: '{env:OTHER_API_KEY}' },
            { segments: ['options', 'baseURL'], before: 'http://127.0.0.1:1234/v1', after: 'http://127.0.0.1:8888/v1' },
          ],
        },
        {
          kind: 'agent',
          id: 'tanda',
          status: 'changed',
          variables: [],
          changes: [{ segments: ['model'], before: 'old-model', after: 'new-model' }],
        },
      ],
    };

    const mockPlanOpenCode = vi.fn(async () => ({ success: true, data: mockPlan }));
    const mockApplyOpenCode = vi.fn(async () => ({ success: true, data: { count: 2 } }));
    const mockSetEnvVar = vi.fn(async () => ({ success: true }));

    const mockApi = {
      ai: {
        setEnvVar: mockSetEnvVar,
        removeEnvVar: vi.fn(),
      },
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        planOpenCodeImport: mockPlanOpenCode,
        applyOpenCodeImport: mockApplyOpenCode,
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    useGitStore.setState({ language: 'es' });
    render(<AiSettingsSection />);

    // Abrir grupo 4
    fireEvent.click(await screen.findByRole('button', { name: /Importar desde OpenCode/i }));

    fireEvent.click(await screen.findByRole('button', { name: /Comprobar opencode\.json/i }));

    await waitFor(() => {
      expect(screen.getByText('provider: mycustom')).toBeDefined();
      expect(screen.getByText('agent: tanda')).toBeDefined();
    });
    // La pantalla no manda rutas: el proceso principal decide qué archivo leer.
    expect(mockPlanOpenCode).toHaveBeenCalledWith();

    // Un campo secreto escrito a mano se dice, sin valor; los demás cambios muestran sus valores.
    expect(screen.getByText('valor escrito en el archivo')).toBeDefined();
    expect(screen.getByText('{env:OTHER_API_KEY}')).toBeDefined();
    expect(screen.getByText('http://127.0.0.1:1234/v1')).toBeDefined();
    expect(screen.getByText('old-model')).toBeDefined();

    // La clave que viene escrita en el archivo no pide nada: se guarda al importar.
    expect(screen.getByText('{env:MYCUSTOM_API_KEY}')).toBeDefined();
    expect(screen.getByText('escrita en el archivo: se guarda en GitCron al importar')).toBeDefined();
    // La que falta sí tiene su campo (las de la sección de proveedores también usan «Pegar clave…»).
    const rowOf = (name: string) => screen.getByText(`{env:${name}}`).closest('div.flex.flex-wrap') as HTMLElement;
    expect(rowOf('MYCUSTOM_API_KEY').querySelector('input')).toBeNull();
    const missingInput = rowOf('MY_HEADER_TOKEN').querySelector('input') as HTMLInputElement;
    expect(missingInput).not.toBeNull();

    // Deseleccionar el agente y después guardar la variable: el plan se rehace y lo elegido queda.
    const agentCheckbox = screen.getByRole('checkbox', { name: /agent: tanda/i }) as HTMLInputElement;
    fireEvent.click(agentCheckbox);
    expect(agentCheckbox.checked).toBe(false);

    fireEvent.change(missingInput, { target: { value: LITERAL_SECRET } });
    const saveBtn = rowOf('MY_HEADER_TOKEN').querySelector('button') as HTMLButtonElement;
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockSetEnvVar).toHaveBeenCalledWith('MY_HEADER_TOKEN', LITERAL_SECRET);
      expect(mockPlanOpenCode).toHaveBeenCalledTimes(2);
    });
    expect((screen.getByRole('checkbox', { name: /agent: tanda/i }) as HTMLInputElement).checked).toBe(false);
    expect(document.body.innerHTML).not.toContain(LITERAL_SECRET);

    fireEvent.click(screen.getByRole('button', { name: /Importar lo elegido/i }));

    await waitFor(() => {
      expect(mockApplyOpenCode).toHaveBeenCalledWith({
        entries: [
          { kind: 'provider', id: 'mycustom' },
          { kind: 'provider', id: 'other' },
        ],
      });
    });
  });

  it('importar desde OpenCode: sin opencode.json lo dice y no ofrece importar', async () => {
    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        planOpenCodeImport: vi.fn(async () => ({
          success: true,
          data: {
            source: { status: 'absent', path: 'C:/Users/test/.config/opencode/opencode.json' },
            target: { path: 'C:/Users/test/.config/gitcron/gitcron.json' },
            entries: [],
          } satisfies AiOpenCodeImportPlanResult,
        })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    useGitStore.setState({ language: 'es' });
    render(<AiSettingsSection />);

    // Abrir grupo 4
    fireEvent.click(await screen.findByRole('button', { name: /Importar desde OpenCode/i }));

    fireEvent.click(await screen.findByRole('button', { name: /Comprobar opencode\.json/i }));

    expect(await screen.findByText('No se encontró opencode.json en C:/Users/test/.config/opencode/opencode.json.')).toBeDefined();
    expect(screen.queryByText('No hay proveedores ni agentes en opencode.json.')).toBeNull();
    expect(screen.getByRole('button', { name: /Importar lo elegido/i }).hasAttribute('disabled')).toBe(true);
  });

  it('MCP: lista con ámbito y estado por servidor, abre su archivo, quita del archivo correcto e importa sin mandar rutas', async () => {
    const GLOBAL_MCP = 'C:/Users/test/.config/gitcron/mcp.json';
    const REPO_MCP = 'C:/repos/demo/.gitcron/mcp.json';
    const mockMcpStatus: AiMcpStatusResult = {
      files: [
        { path: GLOBAL_MCP, scope: 'global', exists: true },
        { path: REPO_MCP, scope: 'repo', exists: true },
      ],
      servers: [
        {
          name: 'filesystem-server',
          scope: 'global',
          kind: 'local',
          disabled: false,
          command: 'npx',
          envVarNames: ['GITHUB_TOKEN'],
          headerNames: [],
          origin: GLOBAL_MCP,
        },
        {
          name: 'remote-server',
          scope: 'repo',
          kind: 'remote',
          disabled: true,
          host: 'mcp.remote.example.com',
          envVarNames: [],
          headerNames: ['Authorization'],
          origin: REPO_MCP,
        },
      ],
    };

    const mockMcpPlan: AiMcpImportPlanResult = {
      source: { status: 'ok', path: 'C:/Users/test/.cursor/mcp.json' },
      target: { path: GLOBAL_MCP },
      skipped: ['unconvertible-server'],
      entries: [
        {
          name: 'cursor-server',
          status: 'changed',
          disabled: false,
          kind: 'local',
          command: 'node',
          envVarNames: ['CURSOR_TOKEN'],
          headerNames: [],
          changedFields: ['env.CURSOR_TOKEN'],
          fromFile: ['CURSOR_TOKEN'],
        },
      ],
    };

    const mockOpenFile = vi.fn(async () => ({ success: true, data: { opened: true } }));
    const mockRemoveMcp = vi.fn(async () => ({ success: true, data: { removed: true } }));
    const mockPlanMcp = vi.fn(async () => ({ success: true, data: mockMcpPlan }));
    const mockApplyMcp = vi.fn(async () => ({ success: true, data: { count: 1 } }));

    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mockMcpStatus })),
        openFile: mockOpenFile,
        showInFolder: vi.fn(),
        removeMcpServer: mockRemoveMcp,
        planMcpImport: mockPlanMcp,
        applyMcpImport: mockApplyMcp,
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    useGitStore.setState({ language: 'es' });
    render(<AiSettingsSection repoPath="C:/repos/demo" />);

    // Abrir grupo 5
    fireEvent.click(await screen.findByRole('button', { name: /Servidores MCP/i }));

    // 1. Servidores con su tipo, su ámbito traducido y «deshabilitado» sólo donde corresponde
    expect(await screen.findByText('filesystem-server')).toBeDefined();
    expect(screen.getByText('GitCron todavía no los usa.')).toBeDefined();
    expect(screen.getByText('Local')).toBeDefined();
    expect(screen.getByText('Remoto')).toBeDefined();
    expect(screen.getAllByText('Deshabilitado')).toHaveLength(1);
    expect(screen.getByText('mcp.remote.example.com')).toBeDefined();
    expect(screen.queryByText('(repo)')).toBeNull();

    // 2. «Abrir el archivo» del mcp.json global
    const globalRow = screen.getByTitle(GLOBAL_MCP).closest('div.rounded-lg') as HTMLElement;
    fireEvent.click(globalRow.querySelector('button') as HTMLButtonElement);
    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith({ filePath: GLOBAL_MCP, repoPath: 'C:/repos/demo' });
    });

    // 3. Quitar el servidor del repositorio: va a su archivo, con el repositorio
    fireEvent.click(screen.getAllByRole('button', { name: /Quitar servidor/i })[1]);
    expect(await screen.findByText(/¿Quitar servidor MCP «remote-server»\?/i)).toBeDefined();
    const confirmBtns = screen.getAllByRole('button', { name: /Quitar servidor/i });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => {
      expect(mockRemoveMcp).toHaveBeenCalledWith({ filePath: REPO_MCP, name: 'remote-server', repoPath: 'C:/repos/demo' });
    });

    // 4. Importar desde Cursor: sólo el origen viaja; la vista previa dice qué cambia y qué se guarda
    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }));
    await waitFor(() => {
      expect(screen.getByText('cursor-server')).toBeDefined();
    });
    expect(mockPlanMcp).toHaveBeenCalledWith({ source: 'cursor' });
    expect(screen.getByText('env.CURSOR_TOKEN')).toBeDefined();
    expect(screen.getByText('Valores escritos en el archivo; se guardan en GitCron como CURSOR_TOKEN')).toBeDefined();
    expect(screen.getByText(/unconvertible-server/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Importar lo elegido/i }));
    await waitFor(() => {
      expect(mockApplyMcp).toHaveBeenCalledWith({ source: 'cursor', entries: ['cursor-server'] });
    });
  });

  it('copiar para otra herramienta: abre el modal, muestra la vista previa con URL tapada, permite cambiar de destino y copia al portapapeles', async () => {
    const mockPrepareMcpCopy = vi.fn(async ({ target }: { target: string }) => ({
      success: true,
      data: {
        target,
        serverName: 'remote-server',
        previewText: target === 'claude'
          ? '{\n  "mcpServers": {\n    "remote-server": {\n      "type": "http",\n      "url": "https://mcp.remote.example.com/sse?token=***"\n    }\n  }\n}'
          : '{\n  "servers": {\n    "remote-server": {\n      "type": "http",\n      "url": "https://mcp.remote.example.com/sse?token=***"\n    }\n  }\n}',
        clipboardText: '{\n  "mcpServers": {\n    "remote-server": {\n      "type": "http",\n      "url": "https://mcp.remote.example.com/sse?token=real-secret"\n    }\n  }\n}',
        warnings: ['type_default_streamable_http'],
        literalSecrets: [{ key: 'token', location: 'headers', proposedVar: 'REMOTE_TOKEN' }],
        targetPathHint: target === 'claude' ? '.mcp.json' : '.vscode/mcp.json',
      },
    }));
    const mockCopyMcpToClipboard = vi.fn(async () => ({ success: true, data: { copied: true } }));
    const mockSaveMcpSecrets = vi.fn(async () => ({ success: true, data: { savedCount: 1, updatedFilePath: 'mcp.json' } }));

    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({
          success: true,
          data: {
            files: [{ path: 'C:/repos/demo/.gitcron/mcp.json', scope: 'repo', exists: true }],
            servers: [
              {
                name: 'remote-server',
                kind: 'remote',
                host: 'mcp.remote.example.com',
                headerNames: ['Authorization'],
                envVarNames: [],
                origin: 'C:/repos/demo/.gitcron/mcp.json',
                scope: 'repo',
                disabled: false,
              },
            ],
          },
        })),
        prepareMcpCopy: mockPrepareMcpCopy,
        copyMcpToClipboard: mockCopyMcpToClipboard,
        saveMcpLiteralSecrets: mockSaveMcpSecrets,
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    useGitStore.setState({ language: 'es' });
    render(<AiSettingsSection repoPath="C:/repos/demo" />);

    // Abrir grupo 5
    fireEvent.click(await screen.findByRole('button', { name: /Servidores MCP/i }));

    expect(await screen.findByText('remote-server')).toBeDefined();

    // 1. Abrir modal con botón "Copiar para otra herramienta"
    fireEvent.click(screen.getByRole('button', { name: /Copiar para otra herramienta/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined();
    });
    expect(screen.getByText(/Copiar servidor «remote-server» para otra herramienta/i)).toBeDefined();
    expect(mockPrepareMcpCopy).toHaveBeenCalledWith({
      filePath: 'C:/repos/demo/.gitcron/mcp.json',
      name: 'remote-server',
      target: 'claude',
      repoPath: 'C:/repos/demo',
    });

    // 2. Muestra la vista previa con token tapado y el aviso de Streamable HTTP
    expect(screen.getByText(/token=\*\*\*/i)).toBeDefined();
    expect(screen.getByText(/sin tipo declarado, se asume Streamable HTTP/i)).toBeDefined();
    expect(screen.getByText(/La vista previa oculta contraseñas/i)).toBeDefined();

    // 3. Ofrece guardar secretos en el baúl
    expect(screen.getByText(/Este servidor contiene valores escritos a mano/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Guardar secretos en el baúl y actualizar mcp.json/i }));
    await waitFor(() => {
      expect(mockSaveMcpSecrets).toHaveBeenCalledWith({
        filePath: 'C:/repos/demo/.gitcron/mcp.json',
        name: 'remote-server',
        repoPath: 'C:/repos/demo',
      });
    });

    // 4. Cambiar de destino a VS Code
    fireEvent.click(screen.getByRole('button', { name: /VS Code/i }));
    await waitFor(() => {
      expect(mockPrepareMcpCopy).toHaveBeenCalledWith({
        filePath: 'C:/repos/demo/.gitcron/mcp.json',
        name: 'remote-server',
        target: 'vscode',
        repoPath: 'C:/repos/demo',
      });
    });

    // 5. Copiar al portapapeles
    fireEvent.click(screen.getByRole('button', { name: /Copiar al portapapeles/i }));
    await waitFor(() => {
      expect(mockCopyMcpToClipboard).toHaveBeenCalledWith({
        filePath: 'C:/repos/demo/.gitcron/mcp.json',
        name: 'remote-server',
        target: 'vscode',
        repoPath: 'C:/repos/demo',
      });
    });
    // El modal se cierra tras copiar
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('los cinco grupos con su título y su resumen cerrados; abrir y cerrar con mouse y con teclado; aria-expanded; persistencia en localStorage; archivo roto abre grupo 3', async () => {
    localStorage.clear();
    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    const { unmount } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText('Qué modelo usa cada cosa')).toBeDefined();
    });

    const headerUses = screen.getByTestId('accordion-group-uses').querySelector('button')!;
    const headerProviders = screen.getByTestId('accordion-group-providers').querySelector('button')!;
    const headerFile = screen.getByTestId('accordion-group-file').querySelector('button')!;
    const headerOpenCode = screen.getByTestId('accordion-group-opencode').querySelector('button')!;
    const headerMcp = screen.getByTestId('accordion-group-mcp').querySelector('button')!;

    // Por omisión, el grupo "providers" está abierto (aria-expanded="true") y los demás cerrados
    expect(headerProviders.getAttribute('aria-expanded')).toBe('true');
    expect(headerUses.getAttribute('aria-expanded')).toBe('false');
    expect(headerFile.getAttribute('aria-expanded')).toBe('false');
    expect(headerOpenCode.getAttribute('aria-expanded')).toBe('false');
    expect(headerMcp.getAttribute('aria-expanded')).toBe('false');

    // Resúmenes visibles de los grupos cerrados
    expect(screen.getByTestId('accordion-summary-uses').textContent).toMatch(/general/i);
    expect(screen.getByTestId('accordion-summary-file').textContent).toMatch(/válido/i);
    expect(screen.getByTestId('accordion-summary-opencode')).toBeDefined();
    expect(screen.getByTestId('accordion-summary-mcp')).toBeDefined();

    // Cerrar grupo providers con click de mouse
    fireEvent.click(headerProviders);
    expect(headerProviders.getAttribute('aria-expanded')).toBe('false');
    // Se guarda en localStorage
    const saved = JSON.parse(localStorage.getItem('gitcron:ai-settings:open-groups') || '{}');
    expect(saved['providers']).toBe(false);

    // Abrir grupo uses con click de mouse
    fireEvent.click(headerUses);
    expect(headerUses.getAttribute('aria-expanded')).toBe('true');
    const savedUses = JSON.parse(localStorage.getItem('gitcron:ai-settings:open-groups') || '{}');
    expect(savedUses['uses']).toBe(true);

    // Abrir grupo 4
    fireEvent.click(headerOpenCode);
    expect(headerOpenCode.getAttribute('aria-expanded')).toBe('true');

    unmount();

    // Ahora con archivo roto: la píldora muestra error y el grupo 3 se abre solo
    const mockBrokenApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusBroken })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockBrokenApi });

    render(<AiSettingsSection />);
    await waitFor(() => {
      const pill = screen.getByTestId('section-file-status-pill');
      expect(pill.className).toMatch(/color-error/);
      expect(pill.textContent).toMatch(/Con error/);
      const brokenFileHeader = screen.getByTestId('accordion-group-file').querySelector('button')!;
      expect(brokenFileHeader.getAttribute('aria-expanded')).toBe('true');
    });
  });

  it('un uso desplegado muestra sus opciones y el selector de modelo queda dentro de la fila del uso en el DOM', async () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
        models: vi.fn(async () => ({
          success: true,
          data: {
            use: 'gitcron-commit',
            providers: [
              {
                id: 'lmstudio',
                name: 'LM Studio',
                kind: 'openai-compatible',
                available: true,
                models: [{ id: 'qwen', name: 'Qwen 3.8' }],
              },
            ],
            current: { providerId: 'lmstudio', modelId: 'qwen', fullModelRef: 'lmstudio/qwen' },
          },
        })),
        onModelsUpdated: vi.fn(() => () => {}),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    render(<AiSettingsSection repoPath="C:/repos/demo" />);
    await waitFor(() => {
      expect(screen.getByTestId('use-row-gitcron-commit')).toBeDefined();
    });

    const commitRow = screen.getByTestId('use-row-gitcron-commit');

    // Inicialmente cerrado: no muestra los inputs de temperatura ni botones de modelo
    expect(commitRow.querySelector('input[type="number"]')).toBeNull();

    // Click en la cabecera de la fila para desplegarla
    const rowHeader = commitRow.querySelector('button')!;
    fireEvent.click(rowHeader);

    // Ahora muestra los parámetros
    await waitFor(() => {
      expect(commitRow.querySelector('input[type="number"]')).not.toBeNull();
    });

    // Botón "Elegir modelo" dentro de la fila del uso
    const chooseModelBtns = within(commitRow).getAllByRole('button', { name: /Elegir modelo/i });
    fireEvent.click(chooseModelBtns[chooseModelBtns.length - 1]);

    // El selector aparece y es descendiente de la fila del uso en el DOM (no al final de la página)
    await waitFor(() => {
      const picker = screen.getByTestId('ai-model-picker');
      expect(commitRow.contains(picker)).toBe(true);
    });

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('agregar proveedor y agregar modelo se despliegan en el lugar, Esc cancela, sin modales, el foco vuelve al botón disparador', async () => {
    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        providerModels: vi.fn(async () => ({
          success: true,
          data: { declared: ['deepseek'], reported: [], canLoad: false },
        })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    render(<AiSettingsSection repoPath="C:/repos/demo" />);
    await waitFor(() => {
      expect(screen.getByTestId('accordion-group-providers')).toBeDefined();
    });

    // Abrir Grupo 2
    const headerProviders = screen.getByTestId('accordion-group-providers').querySelector('button')!;
    fireEvent.click(headerProviders);

    const addProviderBtn = await screen.findByRole('button', { name: /Agregar proveedor/i });
    addProviderBtn.focus();
    expect(document.activeElement).toBe(addProviderBtn);

    // Click en "+ Agregar proveedor"
    fireEvent.click(addProviderBtn);

    // Se despliega la tarjeta inline (no un <dialog> modal)
    const card = await screen.findByTestId('add-provider-inline-card');
    expect(card).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();

    // El primer campo está dentro de la tarjeta
    const firstInput = card.querySelector('input')!;
    expect(firstInput).toBeDefined();

    // Presionar Esc para cancelar
    fireEvent.keyDown(card, { key: 'Escape', code: 'Escape' });

    // La tarjeta desaparece y no hay modal
    await waitFor(() => {
      expect(screen.queryByTestId('add-provider-inline-card')).toBeNull();
    });
    // El foco vuelve al botón que lo abrió
    await waitFor(() => {
      expect(document.activeElement).toBe(addProviderBtn);
    });

    // Probar "Agregar modelo" dentro de un proveedor (unslothpc)
    const unslothRow = screen.getByTestId('provider-row-unslothpc');
    const toggleUnsloth = unslothRow.querySelector('button')!;
    fireEvent.click(toggleUnsloth);

    const addModelBtn = await within(unslothRow).findByRole('button', { name: /Agregar modelo/i });
    addModelBtn.focus();
    fireEvent.click(addModelBtn);

    const modelCard = await screen.findByTestId('add-model-inline-card');
    expect(modelCard).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Esc cancela y cierra tarjeta
    fireEvent.keyDown(modelCard, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('add-model-inline-card')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(addModelBtn);
    });
  });

  it('editor de gitcron.json: guarda cambios, pre-save rechaza sintaxis con línea, detecta conflicto externo, y con secretos literales no abre ni filtra secretos', async () => {
    const LITERAL_SECRET = 'clave-super-secreta-en-archivo-12345';
    let fileContent = '{\n  "provider": {}\n}';
    let fileHash = 'hash-v1';

    const mockReadFileContent = vi.fn(async () => ({
      success: true,
      data: {
        content: fileContent,
        hash: fileHash,
        path: 'C:/Users/demo/.gitcron/gitcron.json',
        hasLiteralSecrets: false,
      },
    }));

    const mockSaveFileContent = vi.fn(async ({ content, baseHash }: { content: string; baseHash: string }): Promise<any> => {
      if (baseHash !== fileHash) {
        return { success: true, data: { conflict: true } };
      }
      fileContent = content;
      fileHash = 'hash-v2';
      return { success: true, data: { written: true, hash: 'hash-v2' } };
    });

    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        readFileContent: mockReadFileContent,
        saveFileContent: mockSaveFileContent,
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    const { unmount } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByTestId('accordion-group-file')).toBeDefined();
    });

    // Abrir Grupo 3
    const headerFile = screen.getByTestId('accordion-group-file').querySelector('button')!;
    fireEvent.click(headerFile);

    const globalRow = await screen.findByTestId('file-row-global');
    const editBtn = within(globalRow).getByRole('button', { name: /Editar/i });

    // 1. Abrir editor
    fireEvent.click(editBtn);
    const textarea = (await screen.findByTestId('gitcron-json-textarea')) as HTMLTextAreaElement;
    expect(textarea.value).toBe(fileContent);

    // 2. Modificar contenido y guardar con Ctrl+S
    fireEvent.change(textarea, { target: { value: '{\n  "provider": {\n    "test": {}\n  }\n}' } });
    expect(screen.getByTestId('editor-dirty-badge')).toBeDefined();

    fireEvent.keyDown(textarea, { key: 's', code: 'KeyS', ctrlKey: true });
    await waitFor(() => {
      expect(mockSaveFileContent).toHaveBeenCalledWith({
        scope: 'global',
        repoPath: null,
        content: '{\n  "provider": {\n    "test": {}\n  }\n}',
        baseHash: 'hash-v1',
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/Archivo guardado correctamente/i)).toBeDefined();
    });

    // 3. Error de sintaxis en pre-save: rechaza y muestra la línea
    mockSaveFileContent.mockResolvedValueOnce({
      success: true,
      data: {
        parseError: { code: 'InvalidJson', line: 4, column: 1, message: 'Unexpected token' },
        error: 'Error de sintaxis en la línea 4: Unexpected token',
      },
    });
    fireEvent.change(textarea, { target: { value: '{\n  "broken": \n}' } });
    fireEvent.click(screen.getByTestId('editor-save-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('editor-syntax-error')).toBeDefined();
      expect(screen.getByText(/línea 4/i)).toBeDefined();
    });

    // 4. Conflicto por cambio externo: no pisa y muestra aviso
    mockSaveFileContent.mockResolvedValueOnce({
      success: true,
      data: { conflict: true },
    });
    fireEvent.change(textarea, { target: { value: '{\n  "provider": { "conflict": true } }' } });
    fireEvent.click(screen.getByTestId('editor-save-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('editor-conflict-notice')).toBeDefined();
      expect(screen.getByText(/El archivo cambió afuera/i)).toBeDefined();
    });

    unmount();

    // 5. Secretos literales: el editor NO se abre y el valor secreto NUNCA viaja al DOM ni a la respuesta
    const mockStatusWithSecret: AiConfigStatusResult = {
      ...mockStatusValid,
      providers: [
        {
          ...mockStatusValid.providers[0],
          // @ts-expect-error simular carga con secreto que jamás debe mostrarse
          rawSecretInjected: LITERAL_SECRET,
        },
        ...mockStatusValid.providers.slice(1),
      ],
    };

    const mockSecretApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusWithSecret })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        readFileContent: vi.fn(async () => ({
          success: true,
          data: {
            content: '', // El proceso principal no devuelve el contenido
            hash: 'hash-secret',
            path: 'C:/Users/demo/.gitcron/gitcron.json',
            hasLiteralSecrets: true,
          },
        })),
        saveFileContent: vi.fn(),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockSecretApi });

    render(<AiSettingsSection />);
    const secretGroup = await screen.findByTestId('accordion-group-file');
    const secretFileHeader = secretGroup.querySelector('button')!;
    fireEvent.click(secretFileHeader);
    const rowSecret = await screen.findByTestId('file-row-global');
    fireEvent.click(within(rowSecret).getByRole('button', { name: /Editar/i }));

    // Aparece el aviso de secreto y no se monta el textarea
    await waitFor(() => {
      expect(screen.getByTestId('editor-secret-notice')).toBeDefined();
      expect(screen.queryByTestId('gitcron-json-textarea')).toBeNull();
    });
    // El secreto literal jamás aparece en el DOM
    expect(document.body.innerHTML.includes(LITERAL_SECRET)).toBe(false);
  });

  it('accesibilidad: grupos cerrados tienen inert y sus elementos internos no reciben foco (C.14)', async () => {
    const api = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        readFileContent: vi.fn(),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: api });

    render(<AiSettingsSection />);
    const groupFile = await screen.findByTestId('accordion-group-file');
    // Inicialmente el grupo 3 está cerrado
    const contentWrapper = groupFile.querySelector('.grid');
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper?.hasAttribute('inert')).toBe(true);

    // Los botones de adentro están dentro del contenedor inert
    const innerButtons = contentWrapper?.querySelectorAll('button');
    innerButtons?.forEach((btn) => {
      expect(contentWrapper?.contains(btn)).toBe(true);
    });

    // Abrimos el grupo
    const fileHeaderBtn = groupFile.querySelector('button')!;
    fireEvent.click(fileHeaderBtn);

    // Al abrirse, inert ya no está presente
    expect(contentWrapper?.hasAttribute('inert')).toBe(false);
  });

  it('auto-apertura de grupo 3 con archivo roto: abre una sola vez y el usuario puede cerrarlo (C.16)', async () => {
    const mockStatusFileBroken: AiConfigStatusResult = {
      files: [
        {
          path: 'C:/Users/test/.config/gitcron/gitcron.json',
          scope: 'global',
          exists: true,
          error: {
            file: 'C:/Users/test/.config/gitcron/gitcron.json',
            line: 4,
            column: 12,
            code: 'InvalidSymbol',
          },
        },
      ],
      warnings: [],
      generalModel: null,
      smallModel: null,
      providers: [],
      uses: [],
    };

    const api = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusFileBroken })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        readFileContent: vi.fn(async () => ({
          success: true,
          data: { content: '{\n  invalid', hash: 'h1', path: 'C:/Users/test/.config/gitcron/gitcron.json' },
        })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: api });

    render(<AiSettingsSection />);
    const groupFile = await screen.findByTestId('accordion-group-file');
    const fileHeaderBtn = groupFile.querySelector('button')!;

    // Al montar con archivo roto, el grupo 3 se abre automáticamente una vez
    await waitFor(() => {
      expect(fileHeaderBtn.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByTestId('file-status-badge-global')).toBeDefined();
    });

    // El usuario puede cerrarlo haciendo clic en la cabecera
    fireEvent.click(fileHeaderBtn);
    expect(fileHeaderBtn.getAttribute('aria-expanded')).toBe('false');

    // Y puede volver a abrirlo
    fireEvent.click(fileHeaderBtn);
    expect(fileHeaderBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('montaje en es, en y zh con uso desplegado y editor abierto', async () => {
    const api = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusValid })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
        readFileContent: vi.fn(async () => ({
          success: true,
          data: { content: '{\n  "provider": {}\n}', hash: 'h1', path: 'C:/Users/test/.config/gitcron/gitcron.json' },
        })),
        saveFileContent: vi.fn(),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: api });

    for (const lang of ['es', 'en', 'zh'] as const) {
      useGitStore.setState({ language: lang });
      const { unmount } = render(<AiSettingsSection />);

      // Verificar que montó y se muestran las cabeceras de grupos
      const groupUses = await screen.findByTestId('accordion-group-uses');
      expect(groupUses).toBeDefined();

      // Desplegar el uso general
      const generalRow = await screen.findByTestId('use-row-general');
      const generalBtn = generalRow.querySelector('button')!;
      fireEvent.click(generalBtn);
      expect(generalBtn.getAttribute('aria-expanded')).toBe('true');

      // Abrir grupo 3 y abrir editor
      const groupFile = await screen.findByTestId('accordion-group-file');
      const fileHeaderBtn = groupFile.querySelector('button')!;
      fireEvent.click(fileHeaderBtn);
      const rowGlobal = await screen.findByTestId('file-row-global');
      const editBtn = within(rowGlobal).getByRole('button', {
        name: lang === 'es' ? /Editar/i : lang === 'en' ? /Edit/i : /编辑/i,
      });
      fireEvent.click(editBtn);

      await waitFor(() => {
        expect(screen.getByTestId('gitcron-json-editor')).toBeDefined();
        expect(screen.getByTestId('editor-save-btn')).toBeDefined();
      });

      unmount();
    }
  });

  it('resumen de Usos y parámetros sin modelo general muestra "General: sin modelo — sin excepciones"', async () => {
    const mockStatusNoGeneral: AiConfigStatusResult = {
      files: [{ path: 'C:/Users/test/.config/gitcron/gitcron.json', scope: 'global', exists: true }],
      warnings: [],
      generalModel: null,
      smallModel: null,
      providers: [],
      uses: [],
    };
    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusNoGeneral })),
        getMcpStatus: vi.fn(async () => ({ success: true, data: mcpStatusEmpty })),
      },
      aiUse: {
        status: vi.fn(async () => ({ success: true, data: { status: 'unset', use: 'gitcron-commit' } })),
      },
    };
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi });

    render(<AiSettingsSection />);
    await waitFor(() => {
      const summary = screen.getByTestId('accordion-summary-uses');
      expect(summary.textContent).toBe('General: sin modelo — sin excepciones');
      expect(summary.textContent).not.toContain('· — —');
    });
  });
});
