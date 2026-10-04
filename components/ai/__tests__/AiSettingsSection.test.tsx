// @vitest-environment jsdom
// components/ai/__tests__/AiSettingsSection.test.tsx
// Pruebas de renderizado, interacción y seguridad para AiSettingsSection (tarea 6.1).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    useGitStore.setState({ language: 'es' });
  });

  afterEach(() => {
    cleanup();
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
      expect(screen.getByText('Archivos de configuración en uso')).toBeDefined();
      expect(screen.getByText('Servidores compatibles con OpenAI')).toBeDefined();
      expect(screen.getByText('Importar desde OpenCode')).toBeDefined();
      expect(screen.getByText('Servidores MCP')).toBeDefined();
    });
    u1();

    // 2. Inglés
    useGitStore.setState({ language: 'en' });
    const { unmount: u2 } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText('Engines & Models')).toBeDefined();
      expect(screen.getByText('Configuration files in use')).toBeDefined();
      expect(screen.getByText('OpenAI-compatible servers')).toBeDefined();
      expect(screen.getByText('Import from OpenCode')).toBeDefined();
      expect(screen.getByText('MCP Servers')).toBeDefined();
    });
    u2();

    // 3. Chino
    useGitStore.setState({ language: 'zh' });
    const { unmount: u3 } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText('引擎与模型')).toBeDefined();
      expect(screen.getByText('正在使用的配置文件')).toBeDefined();
      expect(screen.getByText('OpenAI 兼容服务器')).toBeDefined();
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
      // Muestra la línea del error y el motivo
      expect(screen.getByText(/ColonExpected/i)).toBeDefined();
      // El botón de agregar proveedor está deshabilitado
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

    await waitFor(() => {
      expect(screen.getByText('{env:UNSLOTH_API_KEY}')).toBeDefined();
    });

    // Encontrar input de clave
    const passwordInputs = screen.getAllByPlaceholderText(/Pegar clave/i);
    expect(passwordInputs.length).toBeGreaterThan(0);
    const keyInput = passwordInputs[0] as HTMLInputElement;

    // Escribir el secreto en el input
    fireEvent.change(keyInput, { target: { value: SUPER_SECRET } });

    // Guardar
    const saveKeyBtns = screen.getAllByRole('button', { name: /Guardar/i });
    const saveKeyBtn = saveKeyBtns[0];
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

    await waitFor(() => {
      expect(screen.getByText('Unsloth PC')).toBeDefined();
    });

    // Botón de eliminar Unsloth PC
    const removeBtns = screen.getAllByTitle(/Quitar proveedor/i);
    expect(removeBtns.length).toBe(2);
    fireEvent.click(removeBtns[1]);
    expect(document.body.innerHTML.includes('¿Quitar')).toBe(true);

    // Debe abrir DangerConfirmDialog y listar el uso afectado (Cartografía usa unslothpc)
    await waitFor(() => {
      expect(screen.getByText(/¿Quitar el proveedor «Unsloth PC»\?/i)).toBeDefined();
      expect(screen.getAllByText(/Cartografía/i).length).toBeGreaterThanOrEqual(2);
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
});
