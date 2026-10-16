// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ScreenCatalog } from '../ScreenCatalog';
import type { ScreenMap } from '@/types/screen-map';
import { useGitStore } from '@/lib/git-store';

describe('ScreenCatalog', () => {
  const originalApi = window.api;

  const sampleMap: ScreenMap = {
    repoPath: '/mock/repo',
    headSha: 'abc1234',
    detectors: ['next-app-router', 'gitcron-views'],
    coverage: { state: 'complete' },
    readAt: '2026-10-16T12:00:00Z',
    screens: [
      {
        id: 'route:/settings',
        kind: 'route',
        name: 'Ajustes',
        locator: '/settings',
        declaredIn: 'app/settings/page.tsx',
        description: null,
        files: [
          { path: 'app/settings/page.tsx', role: 'screen', provenance: 'static', shared: false },
          { path: 'components/ui/Button.tsx', role: 'component', provenance: 'static', shared: true },
        ],
      },
      {
        id: 'view:graph',
        kind: 'view',
        name: 'Graph',
        locator: 'activeTab=graph',
        declaredIn: 'components/RepoMainView.tsx',
        description: null,
        files: [
          { path: 'components/CommitGraph.tsx', role: 'screen', provenance: 'static', shared: false },
          { path: 'components/ui/Button.tsx', role: 'component', provenance: 'static', shared: true },
        ],
      },
      {
        id: 'view:sdd',
        kind: 'view',
        name: 'SDD',
        locator: 'activeTab=sdd',
        declaredIn: 'components/RepoMainView.tsx',
        description: {
          text: 'Tablero de especificaciones y tareas.',
          source: 'ai',
          citedFiles: ['components/sdd/Board.tsx'],
          model: 'gemini-3.8-flash',
          createdAt: '2026-10-16T12:00:00Z',
        },
        files: [
          { path: 'components/sdd/Board.tsx', role: 'screen', provenance: 'static', shared: false },
          { path: 'lib/sdd-store.ts', role: 'logic', provenance: 'static', shared: false },
          { path: 'styles/sdd.module.css', role: 'style', provenance: 'static', shared: false },
        ],
      },
    ],
  };

  beforeEach(() => {
    useGitStore.setState({ language: 'es' });
    window.api = {
      ...(window.api || {}),
      cartoScreens: {
        get: vi.fn().mockResolvedValue({ success: true, data: sampleMap }),
        describe: vi.fn().mockResolvedValue({ success: true, data: null }),
      },
    } as any;
  });

  afterEach(() => {
    cleanup();
    window.api = originalApi;
    vi.restoreAllMocks();
  });

  it('un mapa con una ruta y dos vistas dibuja tres cuadros', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
      expect(screen.getByTestId('screen-card-view:graph')).toBeTruthy();
      expect(screen.getByTestId('screen-card-view:sdd')).toBeTruthy();
    });

    expect(screen.getByText('Ajustes')).toBeTruthy();
    expect(screen.getByText('Graph')).toBeTruthy();
    expect(screen.getByText('SDD')).toBeTruthy();
  });

  it('un archivo compartido muestra la marca', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-route:/settings');
    const toggleBtn = card.querySelector('[data-testid="toggle-files-button"]')!;
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(card.querySelector('[data-testid="shared-badge"]')).toBeTruthy();
      expect(card.querySelector('[data-testid="shared-badge"]')?.textContent).toBe('compartido');
    });
  });

  it('«Ver archivos» agrupa por rol con los nombres en castellano', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-view:sdd')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-view:sdd');
    const toggleBtn = card.querySelector('[data-testid="toggle-files-button"]')!;
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(card.querySelector('[data-testid="role-group-screen"]')).toBeTruthy();
      expect(card.querySelector('[data-testid="role-group-logic"]')).toBeTruthy();
      expect(card.querySelector('[data-testid="role-group-style"]')).toBeTruthy();
    });

    expect(card.textContent).toContain('Pantalla');
    expect(card.textContent).toContain('Lógica');
    expect(card.textContent).toContain('Estilos');
  });

  it('una descripción ai muestra «Sugerida por IA» y los citados', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-view:sdd')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-view:sdd');
    expect(card.textContent).toContain('Tablero de especificaciones y tareas.');
    expect(card.textContent).toContain('Sugerida por IA');
    expect(card.textContent).toContain('Según:');
    expect(card.textContent).toContain('Board.tsx');
  });

  it('sin descripción hay botón y al tocarlo llama a describe', async () => {
    // Al aparecer, cada cuadro pregunta si hay una explicación guardada (cacheOnly): no hay.
    // La respuesta preparada es para el pedido del botón.
    (window.api.cartoScreens.describe as any).mockImplementation(async (args: { cacheOnly?: boolean }) => args.cacheOnly ? { success: true, data: null } : ({
      success: true,
      data: {
        status: 'ok',
        description: {
          text: 'Configuración de la cuenta y preferencias de la aplicación.',
          source: 'ai',
          citedFiles: ['app/settings/page.tsx'],
          model: 'test-model',
          createdAt: '2026-10-16T12:00:00Z',
        },
      },
    }));

    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-route:/settings');
    const explainBtn = card.querySelector('[data-testid="explain-screen-button"]')!;
    expect(explainBtn).toBeTruthy();

    fireEvent.click(explainBtn);

    await waitFor(() => {
      expect(window.api.cartoScreens.describe).toHaveBeenCalledWith({
        repoPath: '/mock/repo',
        screenId: 'route:/settings',
        language: 'es',
      });
      expect(card.textContent).toContain('Configuración de la cuenta y preferencias de la aplicación.');
    });
  });

  it('cobertura no-ui muestra el aviso y ningún cuadro', async () => {
    (window.api.cartoScreens.get as any).mockResolvedValueOnce({
      success: true,
      data: {
        ...sampleMap,
        coverage: { state: 'unsupported', reason: 'no-ui' },
        screens: [],
      },
    });

    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-coverage-banner')).toBeTruthy();
    });

    expect(screen.getByText('Este proyecto no tiene pantallas: es una biblioteca o un servicio.')).toBeTruthy();
    expect(screen.queryByTestId('screen-catalog-grid')).toBeNull();
    expect(screen.queryByTestId('screen-card-route:/settings')).toBeNull();
  });

  it('un error de describe va a setError', async () => {
    const setErrorSpy = vi.spyOn(useGitStore.getState(), 'setError');

    // Al aparecer, cada cuadro pregunta si hay una explicación guardada (cacheOnly): no hay.
    // La respuesta preparada es para el pedido del botón.
    (window.api.cartoScreens.describe as any).mockImplementation(async (args: { cacheOnly?: boolean }) => args.cacheOnly ? { success: true, data: null } : ({
      success: true,
      data: {
        status: 'unavailable',
        message: 'El modelo elegido no está disponible ahora.',
      },
    }));

    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-route:/settings');
    const explainBtn = card.querySelector('[data-testid="explain-screen-button"]')!;
    fireEvent.click(explainBtn);

    await waitFor(() => {
      expect(setErrorSpy).toHaveBeenCalledWith('El modelo elegido no está disponible ahora.');
    });
  });
});
