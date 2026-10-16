// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';
import { ScreenCatalog } from '../ScreenCatalog';
import type { ScreenMap } from '@/types/screen-map';
import { useGitStore } from '@/lib/git-store';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import styles from '../ScreenCatalog.module.css';

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
          suggestedName: 'Especificaciones',
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
    useAssistDockStore.setState({ open: false, activeTabId: 'chat', pendingPrompt: null });
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

  it('en la grilla los cuadros son compactos y no hay botón de explicar grande ni «Ver archivos»', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
      expect(screen.getByTestId('screen-card-view:graph')).toBeTruthy();
      expect(screen.getByTestId('screen-card-view:sdd')).toBeTruthy();
    });

    // Cuadro con suggestedName muestra el nombre sugerido
    expect(screen.getByText('Especificaciones')).toBeTruthy();
    expect(screen.getByText('Ajustes')).toBeTruthy();
    expect(screen.getByText('Graph')).toBeTruthy();

    // No hay botones de texto de "Explicar qué hace" ni "Ver archivos" en la grilla
    expect(screen.queryByText('Ver archivos')).toBeNull();
    expect(screen.queryByText('Explicar qué hace')).toBeNull();

    // Los cuadros tienen su lugar de captura 16:10
    const cards = screen.getAllByTestId('card-thumbnail');
    expect(cards.length).toBe(3);
  });

  it('tocar un cuadro muestra el detalle y la columna con los demás', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-route:/settings');
    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByTestId('screen-detail-route:/settings')).toBeTruthy();
      expect(screen.getByTestId('screen-catalog-sidebar')).toBeTruthy();
    });

    // En la columna derecha están los otros dos cuadros
    expect(screen.getByTestId('sidebar-screen-view:graph')).toBeTruthy();
    expect(screen.getByTestId('sidebar-screen-view:sdd')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-screen-route:/settings')).toBeNull();
  });

  it('la X y la tecla Escape vuelven a la grilla', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    // 1. Abrir detalle
    fireEvent.click(screen.getByTestId('screen-card-route:/settings'));
    await waitFor(() => {
      expect(screen.getByTestId('screen-detail-route:/settings')).toBeTruthy();
    });

    // 2. Cerrar con la X
    fireEvent.click(screen.getByTestId('detail-close-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('screen-detail-route:/settings')).toBeNull();
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    // 3. Abrir detalle y cerrar con Escape
    fireEvent.click(screen.getByTestId('screen-card-route:/settings'));
    await waitFor(() => {
      expect(screen.getByTestId('screen-detail-route:/settings')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('screen-detail-route:/settings')).toBeNull();
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });
  });

  it('el ícono de IA no expande el cuadro, publica la pantalla y abre el panel de asistencia', async () => {
    const onSelectScreenSpy = vi.fn();
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} onSelectScreen={onSelectScreenSpy} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-route:/settings');
    const aiBtn = card.querySelector('[data-testid="explain-screen-button"]')!;
    expect(aiBtn).toBeTruthy();

    fireEvent.click(aiBtn);

    // No expandió al detalle (sigue la grilla)
    expect(screen.queryByTestId('screen-detail-route:/settings')).toBeNull();
    expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();

    // Notificó la pantalla seleccionada
    expect(onSelectScreenSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'route:/settings' }),
    );

    // Abrió el panel y configuró el chat
    const dockState = useAssistDockStore.getState();
    expect(dockState.open).toBe(true);
    expect(dockState.activeTabId).toBe('chat');
    expect(dockState.pendingPrompt).toBe('¿Qué hace esta pantalla y para qué sirve?');
  });

  it('detalle: el control por rol muestra solo los roles con archivos y la lista tiene su propio contenedor con desplazamiento', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-view:sdd')).toBeTruthy();
    });

    // Abrir SDD (tiene archivos con roles 'screen', 'logic', 'style')
    fireEvent.click(screen.getByTestId('screen-card-view:sdd'));

    await waitFor(() => {
      expect(screen.getByTestId('screen-detail-view:sdd')).toBeTruthy();
    });

    // Control segmentado muestra solo los 3 roles existentes
    expect(screen.getByTestId('role-tab-screen')).toBeTruthy();
    expect(screen.getByTestId('role-tab-logic')).toBeTruthy();
    expect(screen.getByTestId('role-tab-style')).toBeTruthy();
    expect(screen.queryByTestId('role-tab-component')).toBeNull();
    expect(screen.queryByTestId('role-tab-data')).toBeNull();

    // Contenedor de la lista tiene la clase filesScrollContainer
    const scrollContainer = screen.getByTestId('screen-detail-files-list');
    expect(scrollContainer.className).toContain(styles.filesScrollContainer);

    // Cambiar de rol actualiza los archivos listados
    // (Board.tsx también figura entre los citados de la explicación: se busca en la lista.)
    expect(within(scrollContainer).getByText('Board.tsx')).toBeTruthy();
    fireEvent.click(screen.getByTestId('role-tab-logic'));
    expect(within(screen.getByTestId('screen-detail-files-list')).getByText('sdd-store.ts')).toBeTruthy();
    expect(within(screen.getByTestId('screen-detail-files-list')).queryByText('Board.tsx')).toBeNull();
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
});
