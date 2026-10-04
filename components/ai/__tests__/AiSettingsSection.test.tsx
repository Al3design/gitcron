// @vitest-environment jsdom
// components/ai/__tests__/AiSettingsSection.test.tsx
// Pruebas de renderizado, interacción y seguridad para AiSettingsSection (tarea 6.1).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { AiSettingsSection } from '../AiSettingsSection';
import type { AiConfigStatusResult } from '@/types/ai-config';

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
    });
    u1();

    // 2. Inglés
    useGitStore.setState({ language: 'en' });
    const { unmount: u2 } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText('Engines & Models')).toBeDefined();
      expect(screen.getByText('Configuration files in use')).toBeDefined();
      expect(screen.getByText('OpenAI-compatible servers')).toBeDefined();
    });
    u2();

    // 3. Chino
    useGitStore.setState({ language: 'zh' });
    const { unmount: u3 } = render(<AiSettingsSection />);
    await waitFor(() => {
      expect(screen.getByText('引擎与模型')).toBeDefined();
      expect(screen.getByText('正在使用的配置文件')).toBeDefined();
      expect(screen.getByText('OpenAI 兼容服务器')).toBeDefined();
    });
    u3();
  });

  it('un archivo roto muestra su error con línea y no ofrece escribir', async () => {
    const mockApi = {
      aiConfig: {
        status: vi.fn(async () => ({ success: true, data: mockStatusBroken })),
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
});
