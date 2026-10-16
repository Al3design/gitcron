// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartographyView } from '../CartographyView';
import type { CartoGraphStatus } from '@/lib/carto-types';

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

// Mock de subcomponentes visuales internos que no se tocan en esta tanda
vi.mock('../CartoPanoramaHeader', () => ({
  CartoPanoramaHeader: () => <div data-testid="panorama-header" />,
}));

vi.mock('../SemanticGraphLens', () => ({
  SemanticGraphLens: () => <div data-testid="semantic-graph-lens" />,
}));

vi.mock('../CartoNodeDetail', () => ({
  CartoNodeDetail: () => <div data-testid="carto-node-detail" />,
}));

describe('CartographyView', () => {
  const originalApi = typeof window !== 'undefined' ? window.api : undefined;
  const originalLocalStorage = typeof window !== 'undefined' ? window.localStorage : undefined;

  let mockGraphStatus: CartoGraphStatus | null = null;
  let mockProgressCb: ((data: { repoPath: string; status: CartoGraphStatus }) => void) | null = null;
  let mockUpdatedCb: ((data: { repoPath: string }) => void) | null = null;

  beforeEach(() => {
    mockGraphStatus = {
      state: 'ready',
      stats: {
        nodes: 42,
        edges: 84,
        files: 20,
      },
    };
    mockProgressCb = null;
    mockUpdatedCb = null;

    localStorage.clear();

    const mockApi = {
      cartoAi: {
        getSettings: vi.fn().mockResolvedValue({
          success: true,
          data: {
            enabled: true, // IA activa
            model: 'test-model',
          },
        }),
      },
      cartoGraph: {
        ensure: vi.fn().mockImplementation(async () => ({
          success: true,
          data: mockGraphStatus,
        })),
        onProgress: vi.fn().mockImplementation((cb) => {
          mockProgressCb = cb;
          return () => {
            mockProgressCb = null;
          };
        }),
        onUpdated: vi.fn().mockImplementation((cb) => {
          mockUpdatedCb = cb;
          return () => {
            mockUpdatedCb = null;
          };
        }),
      },
    };

    // Asignar al window
    (window as any).api = mockApi;
  });

  afterEach(() => {
    cleanup();
    (window as any).api = originalApi;
  });

  it('no hay ningún elemento de chat (ni la caja de pregunta ni el divisor de columnas), con la IA de Cartografía activa', async () => {
    render(<CartographyView repoPath="/path/to/test-repo" onExit={() => {}} />);

    // Esperar a que monte y cargue los settings de IA
    await waitFor(() => {
      expect((window as any).api.cartoAi.getSettings).toHaveBeenCalled();
    });

    // Verificamos que no existe la caja de entrada ni botones de chat
    expect(screen.queryByPlaceholderText('cartography.ai.askPlaceholder')).toBeNull();
    expect(screen.queryByText('cartography.ai.askTitle')).toBeNull();
    expect(screen.queryByText('cartography.ai.send')).toBeNull();
    // Verificamos que no existe el título del divisor de columnas
    expect(screen.queryByTitle('cartography.resizeCols')).toBeNull();
  });

  it('hay una sola cabecera con «Cartografía» una vez, el selector Simple/Técnico y «Volver al grafo», que llama a onExit', async () => {
    const handleExit = vi.fn();
    render(<CartographyView repoPath="/path/to/test-repo" onExit={handleExit} />);

    // Solo debe aparecer una vez en la cabecera
    const titleElements = screen.getAllByText('cartography.title');
    expect(titleElements).toHaveLength(1);

    // Controles presentes en la cabecera
    expect(screen.getByText('cartography.mode.simple')).toBeDefined();
    expect(screen.getByText('cartography.mode.technical')).toBeDefined();

    const backButton = screen.getByRole('button', { name: /cartography.backToGraph/i });
    expect(backButton).toBeDefined();

    // Click en volver al grafo dispara onExit
    fireEvent.click(backButton);
    expect(handleExit).toHaveBeenCalledTimes(1);
  });

  it('elegir «Técnico» lo recuerda (gitcron:cartographyPersonaMode)', async () => {
    render(<CartographyView repoPath="/path/to/test-repo" onExit={() => {}} />);

    const simpleBtn = screen.getByText('cartography.mode.simple');
    const technicalBtn = screen.getByText('cartography.mode.technical');

    // Por omisión es simple
    expect(simpleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(technicalBtn.getAttribute('aria-pressed')).toBe('false');

    // Seleccionar técnico
    fireEvent.click(technicalBtn);

    expect(technicalBtn.getAttribute('aria-pressed')).toBe('true');
    expect(simpleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('gitcron:cartographyPersonaMode')).toBe('technical');
  });
});
