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
        tags: [{ tag: 'settings', files: ['app/settings/page.tsx'], ownCount: 1 }],
        primaryTag: 'settings',
        stats: { byRole: { screen: 1, component: 1 }, lastChangedAt: '2026-10-16T10:00:00Z' },
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
        tags: [{ tag: 'graphics', files: ['components/CommitGraph.tsx'], ownCount: 1 }],
        primaryTag: 'graphics',
        stats: { byRole: { screen: 1, component: 1 }, lastChangedAt: '2026-10-16T11:00:00Z' },
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
        tags: [{ tag: 'data', files: ['lib/sdd-store.ts'], ownCount: 1 }],
        primaryTag: 'data',
        stats: { byRole: { screen: 1, logic: 1, style: 1 }, lastChangedAt: '2026-10-16T12:00:00Z' },
        files: [
          { path: 'components/sdd/Board.tsx', role: 'screen', provenance: 'static', shared: false },
          { path: 'lib/sdd-store.ts', role: 'logic', provenance: 'static', shared: false },
          { path: 'styles/sdd.module.css', role: 'style', provenance: 'static', shared: false },
        ],
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    useGitStore.setState({ language: 'es' });
    useAssistDockStore.setState({ open: false, activeTabId: 'chat', pendingPrompt: null });
    window.api = {
      ...(window.api || {}),
      cartoScreens: {
        get: vi.fn().mockResolvedValue({ success: true, data: sampleMap }),
        describe: vi.fn().mockResolvedValue({ success: true, data: null }),
      },
      cartoCaptures: {
        get: vi.fn().mockResolvedValue({
          success: true,
          data: {
            consent: { status: 'unsupported', reason: 'no-package' },
            captures: {},
            running: false,
          },
        }),
        consent: vi.fn().mockResolvedValue({ success: true, data: null }),
        revoke: vi.fn().mockResolvedValue({ success: true, data: null }),
        run: vi.fn().mockResolvedValue({ success: true, data: { captured: 0, skipped: [], cancelled: false } }),
        cancel: vi.fn().mockResolvedValue({ success: true, data: true }),
        onProgress: vi.fn().mockReturnValue(() => {}),
      },
    } as any;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
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

  it('el control de tamaño cambia la clase de la grilla y lo recuerda; en Mínimo no se ve la línea de archivos', async () => {
    localStorage.clear();
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-catalog-grid')).toBeTruthy();
    });

    const grid = screen.getByTestId('screen-catalog-grid');
    // Por omisión, Mediano
    expect(grid.className).toContain(styles.grid_medium);

    // Cambiar a Grande
    const largeBtn = screen.getByTestId('card-size-large');
    fireEvent.click(largeBtn);
    expect(grid.className).toContain(styles.grid_large);
    expect(localStorage.getItem('gitcron:cartoCardSize')).toBe('large');

    // Cambiar a Mínimo
    const minimalBtn = screen.getByTestId('card-size-minimal');
    fireEvent.click(minimalBtn);
    expect(grid.className).toContain(styles.grid_minimal);
    expect(localStorage.getItem('gitcron:cartoCardSize')).toBe('minimal');

    // En Mínimo no se ve la línea de archivos
    expect(screen.queryByTestId('screen-file-counts')).toBeNull();
  });

  it('con needs-consent, la franja muestra la orden y los dos botones', async () => {
    (window.api.cartoCaptures.get as any).mockResolvedValue({
      success: true,
      data: {
        consent: { status: 'needs-consent', command: 'pnpm run dev' },
        captures: {},
        running: false,
      },
    });

    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('capture-banner')).toBeTruthy();
    });

    expect(screen.getByText(/pnpm run dev/)).toBeTruthy();
    expect(screen.getByTestId('capture-allow-button')).toBeTruthy();
    expect(screen.getByTestId('capture-not-now-button')).toBeTruthy();
  });

  it('con una captura, el cuadro muestra un img', async () => {
    (window.api.cartoCaptures.get as any).mockResolvedValue({
      success: true,
      data: {
        consent: { status: 'granted', command: 'pnpm run dev', grantedAt: '2026-10-16T12:00:00Z' },
        captures: {
          'route:/settings': {
            screenId: 'route:/settings',
            dataUrl: 'data:image/jpeg;base64,mockimagedata',
            capturedAt: '2026-10-16T12:00:00Z',
            stale: false,
          },
        },
        running: false,
      },
    });

    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-route:/settings');
    const thumbnail = within(card).getByTestId('card-thumbnail');
    const img = thumbnail.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('data:image/jpeg;base64,mockimagedata');
  });

  it('con stale, aparece el sello', async () => {
    (window.api.cartoCaptures.get as any).mockResolvedValue({
      success: true,
      data: {
        consent: { status: 'granted', command: 'pnpm run dev', grantedAt: '2026-10-16T12:00:00Z' },
        captures: {
          'route:/settings': {
            screenId: 'route:/settings',
            dataUrl: 'data:image/jpeg;base64,mockimagedata',
            capturedAt: '2026-10-16T12:00:00Z',
            stale: true,
          },
        },
        running: false,
      },
    });

    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    const card = screen.getByTestId('screen-card-route:/settings');
    const badge = within(card).getByTestId('stale-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('Desactualizada');
  });

  it('con fotos ya sacadas, aunque estén desactualizadas, no captura sola y dice cuándo fue la última', async () => {
    (window.api.cartoCaptures.get as any).mockResolvedValue({
      success: true,
      data: {
        consent: { status: 'granted', command: 'pnpm run dev', grantedAt: '2026-10-16T12:00:00Z' },
        captures: {
          'route:/settings': {
            screenId: 'route:/settings',
            dataUrl: 'data:image/jpeg;base64,mockimagedata',
            capturedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
            stale: true,
          },
        },
        running: false,
      },
    });

    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/última captura/)).toBeTruthy();
    });
    expect(window.api.cartoCaptures.run).not.toHaveBeenCalled();
  });

  it('el filtro por tema deja solo esas pantallas y «Todas» las vuelve', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
      expect(screen.getByTestId('screen-card-view:graph')).toBeTruthy();
      expect(screen.getByTestId('screen-card-view:sdd')).toBeTruthy();
    });

    // Filtrar por 'graphics'
    const graphicsFilter = screen.getByTestId('screen-tag-filter-graphics');
    fireEvent.click(graphicsFilter);

    // Solo se ve Graph
    expect(screen.getByTestId('screen-card-view:graph')).toBeTruthy();
    expect(screen.queryByTestId('screen-card-route:/settings')).toBeNull();
    expect(screen.queryByTestId('screen-card-view:sdd')).toBeNull();

    // Tocar 'Todas' vuelve a mostrar todas
    const allFilter = screen.getByTestId('screen-tag-filter-all');
    fireEvent.click(allFilter);

    expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    expect(screen.getByTestId('screen-card-view:graph')).toBeTruthy();
    expect(screen.getByTestId('screen-card-view:sdd')).toBeTruthy();
  });

  it('«Por tema» crea las secciones', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    // Activar agrupado por tema
    const groupByTagBtn = screen.getByTestId('screen-group-tag');
    fireEvent.click(groupByTagBtn);

    // Se crean las secciones correspondientes a los temas presentes
    expect(screen.getByTestId('screen-group-graphics')).toBeTruthy();
    expect(screen.getByTestId('screen-group-settings')).toBeTruthy();
    expect(screen.getByTestId('screen-group-data')).toBeTruthy();

    // Volver a sin agrupar
    const groupNoneBtn = screen.getByTestId('screen-group-none');
    fireEvent.click(groupNoneBtn);

    expect(screen.queryByTestId('screen-group-graphics')).toBeNull();
    expect(screen.getByTestId('screen-catalog-grid')).toBeTruthy();
  });

  it('en Mínimo no hay barra ni estadísticas', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    // En Mediano sí hay estadísticas y barra
    expect(screen.getAllByTestId('screen-file-counts').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('screen-composition-bar').length).toBeGreaterThan(0);

    // Cambiar a Mínimo
    fireEvent.click(screen.getByTestId('card-size-minimal'));

    // En Mínimo no hay barra ni estadísticas
    expect(screen.queryByTestId('screen-file-counts')).toBeNull();
    expect(screen.queryByTestId('screen-composition-bar')).toBeNull();
  });

  it('el chip del tema principal se ve sobre la captura', async () => {
    render(<ScreenCatalog repoPath="/mock/repo" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('screen-card-route:/settings')).toBeTruthy();
    });

    const settingsCard = screen.getByTestId('screen-card-route:/settings');
    const primaryTagEl = within(settingsCard).getByTestId('screen-primary-tag');
    expect(primaryTagEl).toBeTruthy();
    expect(primaryTagEl.textContent).toContain('Configuración');

    const graphCard = screen.getByTestId('screen-card-view:graph');
    const graphPrimaryTag = within(graphCard).getByTestId('screen-primary-tag');
    expect(graphPrimaryTag).toBeTruthy();
    expect(graphPrimaryTag.textContent).toContain('Gráficos');
  });
});

