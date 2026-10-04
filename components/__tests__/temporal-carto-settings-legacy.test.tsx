// @vitest-environment jsdom
// components/__tests__/temporal-carto-settings-legacy.test.tsx
// Retiro de los ajustes viejos del Agente Temporal y de Cartografía (tarea 6.1, D11):
// sin clave ni selector de modelo propios; la línea del uso, el acceso a «Motores y
// modelos» y la oferta «usar lo que tenías» siguen.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { TemporalAgentSettings } from '../TemporalAgentSettings';
import { CartoAISettings } from '../cartography/CartoAISettings';
import type { TemporalAgentConfig } from '@/types/temporal-agent';
import type { CartoAISettings as Settings } from '@/types/carto-ai';
import type { AiTextUse, AiUseStatus } from '@/types/ai-use';

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

const temporalConfig = (model?: string): TemporalAgentConfig => ({
  repoHash: 'dummyhash',
  repoName: 'my-repo',
  enabled: true,
  frequency: 'manual',
  privacyScope: 'metadata',
  lastAnalysis: null,
  ...(model ? { model } : {}),
  skillProfile: {
    confidenceThreshold: 0.7,
    focusAreas: ['architecture'],
    avoidTopics: [],
  },
});

const cartoSettings: Settings = {
  enabled: true,
  mode: 'online',
  model: 'deepseek/deepseek-chat',
};

/** Un uso sin modelo en gitcron.json, con la oferta de la elección de antes. */
const unsetWithOffer = (use: AiTextUse): AiUseStatus => ({
  status: 'unset',
  use,
  offer: {
    modelRef: 'openrouter/deepseek/deepseek-chat',
    label: 'OpenRouter · deepseek/deepseek-chat',
    addsProvider: null,
    file: 'C:/Users/test/.config/gitcron/gitcron.json',
  },
});

function mockApi(extra: Record<string, unknown>, status: AiUseStatus) {
  const adopt = vi.fn(async () => ({ success: true, data: { written: true } }));
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      aiUse: { status: vi.fn(async () => ({ success: true, data: status })), adopt },
      commitAi: { onConfigChanged: vi.fn() },
      ...extra,
    },
  });
  return { adopt };
}

beforeEach(() => {
  useGitStore.setState({ language: 'es' });
});

afterEach(() => {
  cleanup();
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('Agente Temporal sin ajustes de IA propios', () => {
  it('sin clave ni selector de modelo; la oferta «usar lo que tenías» sigue y el acceso abre «Motores y modelos»', async () => {
    const onNavigate = vi.fn();
    const { adopt } = mockApi(
      {
        temporalAgent: {
          loadConfig: vi.fn(async () => temporalConfig()),
          saveConfig: vi.fn(async () => ({ success: true })),
        },
      },
      unsetWithOffer('gitcron-temporal'),
    );

    const { container } = render(
      <TemporalAgentSettings repoPath="C:/repos/test" repoName="test" onNavigateToAiModels={onNavigate} />,
    );

    const adoptBtn = await screen.findByRole('button', { name: 'Usar OpenRouter · deepseek/deepseek-chat' });
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(screen.queryByText(/Clave de API/i)).toBeNull();

    fireEvent.click(adoptBtn);
    await waitFor(() => {
      expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ use: 'gitcron-temporal', repoPath: 'C:/repos/test' }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configurar en Motores y modelos' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('sin quien lo lleve a «Motores y modelos», no hay botón (no hay un evento global de reserva)', async () => {
    mockApi(
      { temporalAgent: { loadConfig: vi.fn(async () => temporalConfig()), saveConfig: vi.fn() } },
      unsetWithOffer('gitcron-temporal'),
    );
    render(<TemporalAgentSettings repoPath="C:/repos/test" repoName="test" />);
    expect(await screen.findByRole('button', { name: 'Predecir futuros' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Configurar en Motores y modelos' })).toBeNull();
  });

  it('el modelo elegido antes para el repositorio se ve como dato y «Quitar» lo borra en el acto, sin guardar lo demás', async () => {
    const saveConfig = vi.fn(async () => ({ success: true }));
    const onConfigSaved = vi.fn();
    mockApi(
      {
        temporalAgent: {
          loadConfig: vi.fn(async () => temporalConfig('anthropic/claude-3-opus')),
          saveConfig,
        },
      },
      unsetWithOffer('gitcron-temporal'),
    );

    render(<TemporalAgentSettings repoPath="C:/repos/test" repoName="test" onConfigSaved={onConfigSaved} />);
    expect(await screen.findByText(/Modelo elegido antes para este repositorio: anthropic\/claude-3-opus/)).toBeDefined();

    // Un cambio sin guardar en la pantalla (el umbral) no tiene que viajar con «Quitar».
    const threshold = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(threshold, { target: { value: '0.9' } });

    fireEvent.click(screen.getByRole('button', { name: 'Quitar modelo del repositorio' }));

    await waitFor(() => {
      expect(saveConfig).toHaveBeenCalledTimes(1);
    });
    const saved = (saveConfig.mock.calls[0] as unknown as [string, TemporalAgentConfig])[1];
    expect(saved.model).toBeUndefined();
    expect(saved.skillProfile.confidenceThreshold).toBe(0.7);
    expect(onConfigSaved).toHaveBeenCalledWith(saved);
    expect(screen.queryByText(/Modelo elegido antes para este repositorio/)).toBeNull();
  });
});

describe('Cartografía sin ajustes de IA propios', () => {
  it('queda el interruptor, la oferta «usar lo que tenías», «Probar conexión» y el acceso; sin modos ni clave', async () => {
    const onNavigate = vi.fn();
    const probe = vi.fn(async () => ({ success: true, data: { available: true, model: 'deepseek/deepseek-chat' } }));
    const { adopt } = mockApi(
      {
        cartoAi: {
          getSettings: vi.fn(async () => ({ success: true, data: cartoSettings })),
          setSettings: vi.fn(async (next: Partial<Settings>) => ({ success: true, data: { ...cartoSettings, ...next } })),
          probe,
        },
      },
      unsetWithOffer('gitcron-cartography'),
    );

    const { container } = render(<CartoAISettings onNavigateToAiModels={onNavigate} />);

    expect(await screen.findByText('Asistente de IA')).toBeDefined();
    expect(screen.getByRole('button', { name: /Activa/i })).toBeDefined();
    expect(container.querySelectorAll('input, select')).toHaveLength(0);

    const adoptBtn = await screen.findByRole('button', { name: 'Usar OpenRouter · deepseek/deepseek-chat' });
    fireEvent.click(adoptBtn);
    await waitFor(() => {
      expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ use: 'gitcron-cartography' }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configurar en Motores y modelos' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));
    await waitFor(() => {
      expect(probe).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Disponible/i)).toBeDefined();
    });
  });

  it('con la IA apagada no hay línea del uso ni acceso', async () => {
    mockApi(
      {
        cartoAi: {
          getSettings: vi.fn(async () => ({ success: true, data: { ...cartoSettings, enabled: false } })),
          setSettings: vi.fn(),
          probe: vi.fn(),
        },
      },
      unsetWithOffer('gitcron-cartography'),
    );
    render(<CartoAISettings onNavigateToAiModels={vi.fn()} />);
    expect(await screen.findByText('Asistente de IA')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Configurar en Motores y modelos' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Probar conexión/i })).toBeNull();
  });
});
