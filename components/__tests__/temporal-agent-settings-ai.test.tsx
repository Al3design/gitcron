// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { TemporalAgentSettings } from '../TemporalAgentSettings';
import type { TemporalAgentConfig } from '@/types/temporal-agent';

const dummyConfig: TemporalAgentConfig = {
  repoHash: 'dummyhash',
  repoName: 'repo',
  enabled: true,
  frequency: 'manual',
  privacyScope: 'metadata',
  lastAnalysis: null,
  model: 'anthropic/claude-sonnet-4.5',
  skillProfile: {
    confidenceThreshold: 0.7,
    focusAreas: ['architecture'],
    avoidTopics: [],
  },
};

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

beforeEach(() => {
  useGitStore.setState({ language: 'es' });
});

afterEach(() => {
  cleanup();
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('TemporalAgentSettings — AI integration', () => {
  it('renderiza AiUseLine y AiSentDetails junto a la acción en la tarjeta de predicción, y aplica brillo ai-thinking-text mientras trabaja', async () => {
    let resolvePredict!: (val: unknown) => void;
    const predictPromise = new Promise((resolve) => {
      resolvePredict = resolve;
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        temporalAgent: {
          loadConfig: vi.fn().mockResolvedValue(dummyConfig),
          saveConfig: vi.fn().mockResolvedValue({ success: true }),
        },
        ai: {
          hasKey: vi.fn().mockResolvedValue({ success: true, data: true }),
          keyFingerprint: vi.fn().mockResolvedValue({ success: true, data: 'abc123' }),
          predictTimelines: vi.fn().mockReturnValue(predictPromise),
          cancelPrediction: vi.fn().mockResolvedValue({ success: true }),
        },
        aiUse: {
          status: vi.fn().mockResolvedValue({
            success: true,
            data: {
              status: 'resolved',
              use: 'gitcron-temporal',
              providerId: 'openrouter',
              providerName: 'OpenRouter',
              modelId: 'anthropic/claude-sonnet-4.5',
              kind: 'openai-compatible',
              destination: 'external-service',
              sourceFile: 'C:/Users/ale/.config/gitcron/gitcron.json',
              sourceDir: 'C:/Users/ale/.config/gitcron',
              modelSource: 'agent',
              isException: false,
              available: true,
              unavailableReason: null,
              alternatives: [],
              canLoad: false,
            },
          }),
          lastRequest: vi.fn().mockResolvedValue({ success: true, data: null }),
        },
        commitAi: {
          onConfigChanged: vi.fn(),
        },
      },
    });

    render(<TemporalAgentSettings repoPath="C:/repo" repoName="repo" />);

    // Esperar a que cargue la configuración y la línea de uso
    expect(await screen.findByRole('button', { name: 'Predecir futuros' })).toBeTruthy();
    expect(await screen.findByText(/Usa anthropic\/claude-sonnet-4.5 de OpenRouter/)).toBeTruthy();

    // La tarjeta de predicción tiene clase ai-panel
    const predictCard = document.querySelector('.ai-panel');
    expect(predictCard).toBeTruthy();
    expect(predictCard?.textContent).toContain('se corre sin herramientas: no toca el repositorio');

    // Disparar predicción
    fireEvent.click(screen.getByRole('button', { name: 'Predecir futuros' }));

    // Durante la predicción: botón dice "generando…" con brillo ai-thinking-text en su propio span
    const generatingText = await screen.findByText('generando…');
    expect(generatingText.classList.contains('ai-thinking-text')).toBe(true);
    expect(generatingText.parentElement?.tagName.toLowerCase()).toBe('span');

    // Resolver la predicción
    resolvePredict({
      success: true,
      data: {
        provider: 'OpenRouter',
        model: 'anthropic/claude-sonnet-4.5',
        branches: [{ id: 'b1', message: 'feat: add temporal support', type: 'feature', confidence: 0.85 }],
      },
    });

    // Al terminar, el brillo no debe estar en texto terminado
    await waitFor(() => {
      expect(screen.queryByText('generando…')).toBeNull();
    });
    expect(screen.getByText('Predecir futuros')).toBeTruthy();
    expect(document.querySelector('.ai-thinking-text')).toBeNull();
  });
});
