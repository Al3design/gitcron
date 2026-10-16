// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import type { AiToolProvider, AiUseModelsResult } from '@/types/ai-use';
import { AiModelPicker } from '../AiModelPicker';

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

const mockProviders: AiToolProvider[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    kind: 'cli',
    available: true,
    models: [
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6-Sol',
        supportedLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        defaultLevel: 'low',
      },
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        supportedLevels: ['low', 'medium', 'high', 'xhigh'],
        defaultLevel: 'medium',
      },
    ],
  },
  {
    id: 'antigravity',
    name: 'Antigravity CLI',
    kind: 'cli',
    available: true,
    models: [
      {
        id: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        supportedLevels: ['low', 'medium', 'high', 'max'],
      },
    ],
  },
  {
    id: 'casa',
    name: 'Mi Servidor',
    kind: 'openai-compatible',
    available: true,
    models: [
      {
        id: 'qwen',
        name: 'Qwen 2.5',
        variants: ['alta'],
      },
    ],
  },
];

const mockModelsResult: AiUseModelsResult = {
  use: 'gitcron-commit',
  providers: mockProviders,
  current: {
    providerId: 'codex',
    modelId: 'gpt-5.6-sol',
    fullModelRef: 'codex/gpt-5.6-sol',
    effort: 'ultra',
  },
};

describe('AiModelPicker (tarea 4.5)', () => {
  beforeEach(() => {
    useGitStore.setState({ language: 'es' });
  });

  afterEach(() => {
    cleanup();
    if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
    else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
  });

  it('montaje del selector: gpt-5.6-sol suma ultra y gpt-5.5 no; el por omisión marcado', async () => {
    const modelsMock = vi.fn().mockResolvedValue({ success: true, data: mockModelsResult });
    const chooseMock = vi.fn().mockResolvedValue({ success: true, data: { written: true } });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: {
          models: modelsMock,
          choose: chooseMock,
        },
      },
    });

    render(<AiModelPicker use="gitcron-commit" onClose={vi.fn()} />);

    expect(await screen.findByTestId('ai-model-picker')).toBeTruthy();
    expect(modelsMock).toHaveBeenCalledWith({ use: 'gitcron-commit', repoPath: null });

    // gpt-5.6-sol tiene ultra
    expect(screen.getByRole('option', { name: 'ultra' })).toBeTruthy();
    // low está marcado como por omisión
    expect(screen.getByRole('option', { name: 'low (por omisión)' })).toBeTruthy();

    // Cambiar modelo a gpt-5.5
    const modelSelect = screen.getByLabelText('Modelo');
    fireEvent.change(modelSelect, { target: { value: 'gpt-5.5' } });

    // En gpt-5.5 NO está ultra
    expect(screen.queryByRole('option', { name: 'ultra' })).toBeNull();
    // medium está marcado como por omisión en gpt-5.5
    expect(screen.getByRole('option', { name: 'medium (por omisión)' })).toBeTruthy();
  });

  it('herramienta sin nivel por omisión ofrece «El de la herramienta»', async () => {
    const modelsMock = vi.fn().mockResolvedValue({
      success: true,
      data: {
        use: 'gitcron-cartography',
        providers: mockProviders,
        current: {
          providerId: 'antigravity',
          modelId: 'gemini-3.8-flash',
          fullModelRef: 'antigravity/gemini-3.8-flash',
        },
      },
    });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: {
          models: modelsMock,
          choose: vi.fn(),
        },
      },
    });

    render(<AiModelPicker use="gitcron-cartography" onClose={vi.fn()} />);

    expect(await screen.findByTestId('ai-model-picker')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'El de la herramienta' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'max' })).toBeTruthy();
  });

  it('nada se escribe hasta apretar «Guardar en gitcron.json»', async () => {
    const chooseMock = vi.fn().mockResolvedValue({ success: true, data: { written: true } });
    const onCloseMock = vi.fn();
    const onSavedMock = vi.fn();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: {
          models: vi.fn().mockResolvedValue({ success: true, data: mockModelsResult }),
          choose: chooseMock,
        },
      },
    });

    render(<AiModelPicker use="gitcron-commit" onClose={onCloseMock} onSaved={onSavedMock} />);
    expect(await screen.findByTestId('ai-model-picker')).toBeTruthy();

    // Cambiar modelo y esfuerzo en la UI
    const modelSelect = screen.getByLabelText('Modelo');
    fireEvent.change(modelSelect, { target: { value: 'gpt-5.5' } });
    const effortSelect = screen.getByLabelText('Intensidad de razonamiento');
    fireEvent.change(effortSelect, { target: { value: 'high' } });

    // Cancelar no escribe
    expect(chooseMock).not.toHaveBeenCalled();
    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    fireEvent.click(cancelBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);
    expect(chooseMock).not.toHaveBeenCalled();

    // Guardar escribe con los valores elegidos
    const saveBtn = screen.getByRole('button', { name: 'Usar este modelo' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(chooseMock).toHaveBeenCalledWith({
        use: 'gitcron-commit',
        repoPath: null,
        model: 'codex/gpt-5.5',
        effort: 'high',
        variant: undefined,
      });
    });
    expect(onSavedMock).toHaveBeenCalledTimes(1);
  });

  it('ofrece variantes cuando el modelo las declara (D4)', async () => {
    const chooseMock = vi.fn().mockResolvedValue({ success: true, data: { written: true } });
    const onCloseMock = vi.fn();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: {
          models: vi.fn().mockResolvedValue({
            success: true,
            data: {
              use: 'gitcron-temporal',
              providers: mockProviders,
              current: { providerId: 'casa', modelId: 'qwen', fullModelRef: 'casa/qwen' },
            },
          }),
          choose: chooseMock,
        },
      },
    });

    render(<AiModelPicker use="gitcron-temporal" onClose={onCloseMock} />);
    expect(await screen.findByTestId('ai-model-picker')).toBeTruthy();

    const variantSelect = screen.getByLabelText('Variante');
    expect(variantSelect).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Sin variante' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'alta' })).toBeTruthy();

    fireEvent.change(variantSelect, { target: { value: 'alta' } });

    const saveBtn = screen.getByRole('button', { name: 'Usar este modelo' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(chooseMock).toHaveBeenCalledWith({
        use: 'gitcron-temporal',
        repoPath: null,
        model: 'casa/qwen',
        effort: undefined,
        variant: 'alta',
      });
    });
  });

  it('muestra textos en es, en y zh', async () => {
    const api = {
      models: vi.fn().mockResolvedValue({ success: true, data: mockModelsResult }),
      choose: vi.fn(),
    };
    Object.defineProperty(window, 'api', { configurable: true, value: { aiUse: api } });

    // Español
    useGitStore.setState({ language: 'es' });
    const { unmount: unmountEs } = render(<AiModelPicker use="gitcron-commit" onClose={vi.fn()} />);
    expect(await screen.findByText('Elegir modelo para este uso')).toBeTruthy();
    expect(screen.getByText('Proveedor')).toBeTruthy();
    expect(screen.getByText('Intensidad de razonamiento')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usar este modelo' })).toBeTruthy();
    expect(screen.getByText('Vale para todo GitCron. Para usar otro en una sola función, entrá a Motores y modelos.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    unmountEs();

    // English
    useGitStore.setState({ language: 'en' });
    const { unmount: unmountEn } = render(<AiModelPicker use="gitcron-commit" onClose={vi.fn()} />);
    expect(await screen.findByText('Choose model for this use')).toBeTruthy();
    expect(screen.getByText('Provider')).toBeTruthy();
    expect(screen.getByText('Reasoning effort')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this model' })).toBeTruthy();
    expect(screen.getByText('Applies to all of GitCron. To use a different one for a single feature, go to Engines and models.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'low (default)' })).toBeTruthy();
    unmountEn();

    // Chinese
    useGitStore.setState({ language: 'zh' });
    render(<AiModelPicker use="gitcron-commit" onClose={vi.fn()} />);
    expect(await screen.findByText('为此用途选择模型')).toBeTruthy();
    expect(screen.getByText('提供方')).toBeTruthy();
    expect(screen.getByText('推理强度')).toBeTruthy();
    expect(screen.getByRole('button', { name: '使用此模型' })).toBeTruthy();
    expect(screen.getByText('适用于整个 GitCron。如需在单个功能中使用其他模型，请进入引擎与模型。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'low (默认)' })).toBeTruthy();
  });

  it('evento onModelsUpdated: vuelve a pedir models y muestra el modelo nuevo (A.1)', async () => {
    let savedCallback: (() => void) | null = null;
    const onModelsUpdatedMock = vi.fn((cb: () => void) => {
      savedCallback = cb;
      return () => {
        savedCallback = null;
      };
    });

    let currentModelsResult = mockModelsResult;
    const modelsMock = vi.fn().mockImplementation(async () => ({
      success: true,
      data: currentModelsResult,
    }));

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: {
          models: modelsMock,
          onModelsUpdated: onModelsUpdatedMock,
        },
      },
    });

    render(<AiModelPicker use="gitcron-commit" onClose={vi.fn()} />);
    expect(await screen.findByTestId('ai-model-picker')).toBeTruthy();
    expect(modelsMock).toHaveBeenCalledTimes(1);
    expect(onModelsUpdatedMock).toHaveBeenCalledTimes(1);

    // Actualizamos los datos para que cuando vuelva a pedir models traiga el nuevo proveedor
    currentModelsResult = {
      ...mockModelsResult,
      providers: [
        ...mockProviders,
        {
          id: 'nuevo-prov',
          name: 'Proveedor Nuevo',
          kind: 'openai-compatible',
          available: true,
          models: [{ id: 'modelo-nuevo', name: 'Modelo Nuevo' }],
        },
      ],
    };

    // Disparamos el aviso sin datos
    expect(savedCallback).toBeTruthy();
    savedCallback!();

    await waitFor(() => {
      expect(modelsMock).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('option', { name: 'Proveedor Nuevo' })).toBeTruthy();
    });
  });

  it('un aviso de catálogo nuevo no borra lo que la persona está eligiendo', async () => {
    // Abrir el selector ya pide una actualización de fondo: su aviso llega mientras se elige.
    let savedCallback: (() => void) | null = null;
    const modelsMock = vi.fn().mockResolvedValue({ success: true, data: mockModelsResult });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: {
          models: modelsMock,
          onModelsUpdated: vi.fn((cb: () => void) => {
            savedCallback = cb;
            return () => undefined;
          }),
        },
      },
    });

    render(<AiModelPicker use="gitcron-commit" onClose={vi.fn()} />);
    expect(await screen.findByTestId('ai-model-picker')).toBeTruthy();
    const modelSelect = screen.getByLabelText('Modelo') as HTMLSelectElement;
    fireEvent.change(modelSelect, { target: { value: 'gpt-5.5' } });
    const effortSelect = screen.getByLabelText('Intensidad de razonamiento') as HTMLSelectElement;
    fireEvent.change(effortSelect, { target: { value: 'high' } });

    savedCallback!();
    await waitFor(() => expect(modelsMock).toHaveBeenCalledTimes(2));

    expect((screen.getByLabelText('Modelo') as HTMLSelectElement).value).toBe('gpt-5.5');
    expect((screen.getByLabelText('Intensidad de razonamiento') as HTMLSelectElement).value).toBe('high');
  });

  it('un proveedor al que todavía no se le preguntó dice «sin confirmar», no «no respondió»', async () => {
    const pending: AiToolProvider = {
      id: 'nuevo',
      name: 'Servidor Nuevo',
      kind: 'openai-compatible',
      available: false,
      unconfirmed: true,
      models: [{ id: 'm1', name: 'M1', unconfirmed: true }],
    };
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: {
          models: vi.fn().mockResolvedValue({
            success: true,
            data: { use: 'gitcron-commit', providers: [pending], current: null },
          }),
          onModelsUpdated: vi.fn(() => () => undefined),
        },
      },
    });

    render(<AiModelPicker use="gitcron-commit" onClose={vi.fn()} />);
    expect(await screen.findByTestId('ai-model-picker')).toBeTruthy();
    expect(screen.queryByText(/no respondió/)).toBeNull();
    expect(screen.getAllByText(/sin confirmar/).length).toBeGreaterThan(0);
  });

  it('botón Actualizar llama a refreshModels con use y repoPath y usa res.data.providers (A.1)', async () => {
    const refreshMock = vi.fn().mockResolvedValue({
      success: true,
      data: {
        use: 'gitcron-commit',
        providers: [
          ...mockProviders,
          {
            id: 'refrescado',
            name: 'Servidor Refrescado',
            kind: 'openai-compatible',
            available: true,
            models: [{ id: 'ref-1', name: 'Ref Model 1' }],
          },
        ],
        current: mockModelsResult.current,
      },
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: {
          models: vi.fn().mockResolvedValue({ success: true, data: mockModelsResult }),
          refreshModels: refreshMock,
          onModelsUpdated: vi.fn(() => () => {}),
        },
      },
    });

    render(<AiModelPicker use="gitcron-commit" repoPath="c:/repo/test" onClose={vi.fn()} />);
    expect(await screen.findByTestId('ai-model-picker')).toBeTruthy();

    const refreshBtn = screen.getByRole('button', { name: /Actualizar/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledWith({ use: 'gitcron-commit', repoPath: 'c:/repo/test' });
      expect(screen.getByRole('option', { name: 'Servidor Refrescado' })).toBeTruthy();
    });
  });
});
