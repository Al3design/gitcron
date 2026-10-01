// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PipelineWorkspace } from '../PipelineWorkspace';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import { OpenSpecInspector } from '../OpenSpecInspector';
import { OpenSpecEngineCard } from '../OpenSpecEngineCard';
import { usePipelineStore } from '@/lib/pipeline-store';
import type { OpenSpecEngineStatus } from '../../../types/pipeline';
import type { PipelineSnapshot } from '../pipeline-view-state';
import { OPENSPEC_CYCLE_TARGET_VERSION } from '@/lib/openspec-version';
import { _resetDefaultEngineStatusReader } from '@/lib/engine-status-reader';

vi.mock('@/lib/git-store', () => {
  const state = {
    modifiedFiles: [],
    currentBranch: 'main',
    stageFiles: vi.fn(),
    repoPath: null,
    openRepos: [],
  };
  return {
    useGitStore: Object.assign((selector: any) => selector(state), { getState: () => state }),
  };
});

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({
    stageFiles: vi.fn(),
  }),
}));

vi.mock('@/lib/new-change-draft-store', () => ({
  useNewChangeDraft: () => ({ open: false, mode: null }),
  useNewChangeDraftStore: ((selector?: any) => {
    const state = {
      drafts: {},
      patchDraft: vi.fn(),
      clearDraft: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  }) as any,
}));

describe('OpenSpecDashboard Integration (Ubicación, Jerarquía Visual y Cableado Productivo)', () => {
  afterEach(() => {
    cleanup();
    _resetDefaultEngineStatusReader();
    usePipelineStore.setState({ selectedChangeId: null, openSpecificationId: null, reviewOpen: false });
  });

  const dummySnapshot: PipelineSnapshot = {
    schemaVersion: '1.0',
    repoId: 'repo-1',
    availableSources: ['git', 'openspec'],
    hasPipelineActivity: false,
    decisions: [],
    agents: [],
    activity: [],
    economy: {
      tokens: { input: 0, output: 0, reasoning: null, cacheRead: null },
      costUsd: null,
      costBasis: 'unknown',
      costCoverage: { withCost: 0, total: 0 },
      contextMaxTokens: null,
      contextCurrentTokens: null,
      compactionCount: null,
      reasoningAvailable: null,
    },
    openSpec: {
      selectedChangeId: null,
      activeChanges: [],
      archivedChanges: [],
      specifications: [],
      reports: [],
      diagnostics: [],
      observedAt: null,
      latestGate: null,
    },
  };

  const dummyStatusOutdated: OpenSpecEngineStatus = {
    cli: {
      installed: true,
      runtimeVersion: '1.8.0',
      provenance: 'global',
      displayPath: 'C:\\global\\openspec.cmd',
      supportedRange: { min: '1.5.0', max: '1.8.0' },
      versionClass: 'supported',
      evidenceStatus: 'confirmed',
      diagnostics: [],
    },
    latestAvailable: null,
    globalConfig: null,
    installedIntegration: null,
    repoState: 'initialized',
    integrationState: 'outdated',
  };

  const dummyCliHealthy: OpenSpecEngineStatus['cli'] = {
    installed: true,
    runtimeVersion: '1.14.0',
    provenance: 'global',
    displayPath: 'C:\\global\\openspec.cmd',
    supportedRange: { min: '1.5.0', max: '1.14.0' },
    versionClass: 'supported',
    evidenceStatus: 'confirmed',
    diagnostics: [],
  };

  const dummyStatusHealthy: OpenSpecEngineStatus = {
    cli: dummyCliHealthy,
    latestAvailable: null,
    globalConfig: null,
    installedIntegration: null,
    repoState: 'initialized',
    integrationState: 'up-to-date',
    divergence: { isDivergent: false, reason: null, overallStatus: 'convergent', globalProfileClass: 'core', repoProfileClass: 'core' },
  };

  it('el clic en la píldora de versión abre la revisión en el centro y NO llama a onEnsureRightOpen', async () => {
    const getEngineStatusMock = vi.fn().mockResolvedValue(dummyStatusOutdated);
    const checkLatestVersionMock = vi.fn().mockResolvedValue(null);
    const onEnsureRightOpenMock = vi.fn();

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: checkLatestVersionMock,
        },
      },
    });

    const mockLoader = vi.fn().mockResolvedValue(dummySnapshot);

    const { container } = render(
      <PipelineWorkspace
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onEnsureRightOpen={onEnsureRightOpenMock}
        loadSnapshot={mockLoader}
      />,
    );

    // Clic en insignia de motor en franja de identidad abre la revisión en el centro
    const compactBadge = await screen.findByTitle(/OpenSpec v1.8.0/i, {}, { timeout: 10000 });
    fireEvent.click(compactBadge);

    expect(onEnsureRightOpenMock).not.toHaveBeenCalled();
    const heading = await screen.findByRole('heading', { name: /Configuración de OpenSpec/i });
    expect(heading).toBeDefined();
    const mainSection = container.querySelector('main');
    expect(mainSection).not.toBeNull();
    expect(mainSection!.contains(heading)).toBe(true);

    vi.unstubAllGlobals();
  });

  it('con atención del motor y con herramientas sin configurar, el centro NO monta ningún aviso, en las dos situaciones por separado (7.13, 7.16)', async () => {
    // 1. Situación A: atención del motor (integración desactualizada)
    const getEngineStatusMock = vi.fn().mockResolvedValue(dummyStatusOutdated);
    const checkLatestVersionMock = vi.fn().mockResolvedValue(null);

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: checkLatestVersionMock,
        },
      },
    });

    const { rerender } = render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      // El centro NO monta aviso de atención del motor ni encabezado «Avisos»
      expect(screen.queryByRole('heading', { name: /Avisos/i, level: 4 })).toBeNull();
      expect(screen.queryByText(/OpenSpec requiere atención/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /Abrir Herramientas/i })).toBeNull();
    });

    // 2. Situación B: herramientas sin configurar (motor limpio)
    const dummyStatusClean: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.8.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.8.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: null,
      installedIntegration: null,
      repoState: 'initialized',
      integrationState: 'up-to-date',
      divergence: {
        isDivergent: false,
        overallStatus: 'convergent',
        reason: null,
        globalProfileClass: 'core',
        repoProfileClass: 'core',
      },
    };

    const unconfiguredToolsSnapshot: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        openSpecPresent: true,
        openSpecTools: [
          { toolId: 'custom-tool', label: 'Custom Tool', directory: '.custom', configured: false },
        ],
      },
    };

    getEngineStatusMock.mockResolvedValue(dummyStatusClean);

    rerender(
      <OpenSpecDashboard
        snapshot={unconfiguredToolsSnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      // El centro NO monta aviso de herramientas sin configurar ni encabezado «Avisos»
      expect(screen.queryByRole('heading', { name: /Avisos/i, level: 4 })).toBeNull();
      expect(screen.queryByText(/herramienta.*sin configurar/i)).toBeNull();
    });

    vi.unstubAllGlobals();
  });

  it('los contadores de especificaciones y tareas viven en el cuerpo y no en la franja de identidad, sin duplicar cambios activos ni completados (Ajuste 2)', async () => {
    const getEngineStatusMock = vi.fn().mockResolvedValue(dummyStatusOutdated);
    const checkLatestVersionMock = vi.fn().mockResolvedValue(null);

    (window as any).api = {
      pipelineOpenSpec: {
        getEngineStatus: getEngineStatusMock,
        checkLatestVersion: checkLatestVersionMock,
      },
    };

    const populatedSnapshot: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        activeChanges: [
          {
            changeId: 'change-1',
            status: { schemaName: 'spec-driven', isComplete: false, isPlanningComplete: true, artifacts: [] },
            tasks: [{ id: '1', description: 'Task 1', completed: true }],
          } as any,
        ],
        archivedChanges: [
          { changeId: 'archived-1', completedAt: '2026-08-01' } as any,
        ],
        specifications: [
          { specificationId: 'spec-1', name: 'Spec 1', requirements: 2 } as any,
        ],
      },
    };

    const { container } = render(
      <OpenSpecDashboard
        snapshot={populatedSnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const identityHeader = screen.getByTestId('content-header');
    expect(identityHeader).toBeDefined();

    // 1. La franja de identidad NO contiene contadores de especificaciones ni tareas
    expect(identityHeader.textContent).not.toContain('especificaciones');
    expect(identityHeader.textContent).not.toContain('tareas');

    // 2. La franja de identidad NO duplica cambios activos ni completados
    expect(identityHeader.textContent).not.toContain('cambios activos');
    expect(identityHeader.textContent).not.toContain('completados');

    // 3. Los contadores de especificaciones y progreso de tareas están en el cuerpo (startScreen / center)
    const body = container.querySelector('main');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain('especificaciones');
    expect(body!.textContent).toContain('tareas');

    delete (window as any).api;
  });

  it('muestra la revisión en la columna central al presionar Revisar y restaura la vista al volver/cerrar', async () => {
    const getEngineStatusMock = vi.fn().mockResolvedValue(dummyStatusOutdated);
    const getUpdatePlanMock = vi.fn().mockResolvedValue({
      requiredAction: 'update',
      canExecute: false,
      reason: null,
      suggestedCommand: 'openspec update',
    });

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: vi.fn().mockResolvedValue(null),
          getUpdatePlan: getUpdatePlanMock,
        },
      },
    });

    const TestComponent = () => {
      const reviewOpen = usePipelineStore((s) => s.reviewOpen);
      const toggleReviewOpen = usePipelineStore((s) => s.toggleReviewOpen);
      return (
        <div className="flex">
          <OpenSpecDashboard
            snapshot={dummySnapshot}
            repoPath="C:\\repo"
            currentBranch="main"
            workingTreeClean={true}
            leftOpen={true}
            rightOpen={false}
            leftWidth={340}
            rightWidth={340}
            onResizeLeft={vi.fn()}
            onResizeRight={vi.fn()}
            projection={null}
            runtimeHistory={[]}
            onPauseAfterTask={vi.fn()}
            onRespondDecision={vi.fn()}
          />
          <OpenSpecInspector
            repoPath="C:\\repo"
            snapshot={dummySnapshot}
            sectionState={{
              isOpen: (id) => id === 'details-tools',
              toggle: vi.fn(),
              open: vi.fn(),
              setOpen: vi.fn(),
            }}
            isReviewOpen={reviewOpen}
            onOpenReview={toggleReviewOpen}
          />
        </div>
      );
    };

    usePipelineStore.setState({ reviewOpen: false });

    const { container } = render(<TestComponent />);

    // Esperar a que cargue el estado y se muestre el botón en la sección de herramientas en el inspector
    const reviewBtn = await screen.findByRole('button', { name: /Abrir configuración de OpenSpec|Revisar actualización/i });
    expect(reviewBtn).toBeTruthy();

    // 1. Al presionar "Abrir configuración de OpenSpec", la columna central muestra la sección de revisión
    fireEvent.click(reviewBtn);

    const reviewHeading = await screen.findByRole('heading', { name: /Configuración de OpenSpec/i });
    expect(reviewHeading).toBeTruthy();

    // La revisión está dentro de la columna central (main)
    const mainSection = container.querySelector('main');
    expect(mainSection).not.toBeNull();
    expect(mainSection!.textContent).toContain('Configuración de OpenSpec');

    // 2. Con la revisión abierta, no existe «Cerrar revisión» en la tarjeta; sólo el botón «Cerrar» de la revisión
    expect(screen.queryByRole('button', { name: /Cerrar revisión/i })).toBeNull();
    const closeBtn = screen.getByRole('button', { name: /^Cerrar$/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('heading', { name: /Configuración de OpenSpec/i })).toBeNull();

    // 3. Al volver a entrar, el botón del pie "Cerrar" también la cierra y restaura la vista
    const reOpenBtn = screen.getByRole('button', { name: /Abrir configuración de OpenSpec|Revisar actualización/i });
    fireEvent.click(reOpenBtn);
    expect(await screen.findByRole('heading', { name: /Configuración de OpenSpec/i })).toBeTruthy();

    const footerCloseBtn = screen.getByRole('button', { name: /^Cerrar$/i });
    fireEvent.click(footerCloseBtn);
    expect(screen.queryByRole('heading', { name: /Configuración de OpenSpec/i })).toBeNull();

    delete (window as any).api;
  });

  it('el cuerpo de SDD preserva la zona central y retira las columnas navigator e inspector (5.1)', () => {
    const { container } = render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    // El cuerpo central permanece en el DOM
    const center = container.querySelector('main');
    expect(center).not.toBeNull();

    // Las columnas laterales navigator e inspector fueron retiradas del cuerpo (0 asides)
    const asides = container.querySelectorAll('aside');
    expect(asides.length).toBe(0);
  });

  it('los cinco bloques del centro montan encabezado con la misma clase compartida (7.7, 7.9)', async () => {
    const getEngineStatusMock = vi.fn().mockResolvedValue(dummyStatusOutdated);
    const checkLatestVersionMock = vi.fn().mockResolvedValue(null);

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: checkLatestVersionMock,
          getUpdatePlan: vi.fn().mockResolvedValue(null),
        },
      },
    });

    const snapshotWithChange: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        selectedChangeId: 'change-1',
        activeChanges: [
          {
            changeId: 'change-1',
            status: { schemaName: 'spec-driven', isComplete: false, isPlanningComplete: true, artifacts: [] },
            tasks: [
              { id: '1', line: 10, text: 'Tarea 1', completed: false },
              { id: '2', line: 11, text: 'Tarea 2', completed: true },
            ],
          } as any,
        ],
        specifications: [
          { specificationId: 'spec-1', name: 'Spec 1', requirements: 2 } as any,
        ],
      },
    };

    usePipelineStore.setState({ selectedChangeId: 'change-1' });

    render(
      <OpenSpecDashboard
        snapshot={snapshotWithChange}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    // Entrar al cambio
    const enterBtn = screen.getByRole('button', { name: /Entrar|Abrir/i });
    fireEvent.click(enterBtn);

    // 1. Abrir el lanzador haciendo clic en el CTA de cabecera
    const continueBtn = screen.getByRole('button', { name: /Continuar con/i });
    fireEvent.click(continueBtn);
    const launcherHeading = await screen.findByRole('heading', { name: /Lanzar agente/i, level: 4 });
    expect(launcherHeading).toBeTruthy();
    expect(Array.from(launcherHeading.classList).some((cls) => cls.includes('blockHeader'))).toBe(true);

    const launcherBlock = launcherHeading.parentElement!;
    expect(Array.from(launcherBlock.classList).some((cls) => cls.includes('centerBlock'))).toBe(true);

    const svg = launcherHeading.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');

    // 2. La lista de tareas queda limpia sin el título redundante «Tareas del cambio»
    expect(screen.queryByRole('heading', { name: /Tareas del cambio/i, level: 4 })).toBeNull();

    vi.unstubAllGlobals();
  });

  it('los encabezados de bloque del centro declaran el escalón de título de sección y NO el tamaño de los botones (7.10)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssPath = path.resolve(__dirname, '../OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // Observación 41: Extraemos las declaraciones de font-size de .blockHeader y de los controles vivos del panel (.railActionItem, que reemplaza al histórico .backToStart)
    const blockHeaderMatch = cssContent.match(/\.blockHeader\s*\{[^}]*font-size:\s*var\((--font-size-[a-z0-9-]+)\)/);
    const buttonMatch = cssContent.match(/(?:\.railItem|\.railActionItem)[^{]*\{[^}]*font-size:\s*var\((--font-size-[a-z0-9-]+)\)/);

    expect(blockHeaderMatch).not.toBeNull();
    expect(buttonMatch).not.toBeNull();

    const headerScaleStep = blockHeaderMatch![1];
    const buttonScaleStep = buttonMatch![1];

    // .blockHeader debe declarar el escalón de título de sección (--font-size-md)
    expect(headerScaleStep).toBe('--font-size-md');
    // Y NO debe compartir el mismo tamaño que los botones (--font-size-xs)
    expect(headerScaleStep).not.toBe(buttonScaleStep);
  });

  it('el bloque de avisos retira noticesGroup, noticesList y centerAttentionBanner de la hoja de estilos (7.11, 7.14)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssPath = path.resolve(__dirname, '../OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    expect(cssContent).not.toMatch(/\.noticesGroup/);
    expect(cssContent).not.toMatch(/\.noticesList/);
    expect(cssContent).not.toMatch(/\.centerAttentionBanner/);
  });

  it('el aviso de rama SÍ se monta cuando la rama no coincide, y no lleva el encabezado «Avisos» (7.14, 7.16)', async () => {
    const getEngineStatusMock = vi.fn().mockResolvedValue(dummyStatusOutdated);
    const checkLatestVersionMock = vi.fn().mockResolvedValue(null);

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: checkLatestVersionMock,
        },
      },
    });

    const snapshotWithChange: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        selectedChangeId: 'change-1',
        activeChanges: [
          {
            changeId: 'change-1',
            status: { schemaName: 'spec-driven', isComplete: false, isPlanningComplete: true, artifacts: [] },
            tasks: [{ id: '1', line: 10, text: 'Tarea 1', completed: false }],
          } as any,
        ],
      },
    };

    const { container } = render(
      <OpenSpecDashboard
        snapshot={snapshotWithChange}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const enterBtn = screen.getByRole('button', { name: /Entrar|Abrir/i });
    fireEvent.click(enterBtn);

    // 1. ChangeBranchNotice se monta en la ranura de entorno del panel cuando la rama no coincide
    const branchNotice = container.querySelector('section[data-kind="branch"]');
    expect(branchNotice).not.toBeNull();

    // 2. NO existe ningún encabezado de «Avisos»
    expect(screen.queryByRole('heading', { name: /Avisos/i, level: 4 })).toBeNull();
    expect(screen.queryByText('Avisos')).toBeNull();

    vi.unstubAllGlobals();
  });

  it('sin cambio elegido el centro no monta nada arriba de la pantalla de inicio (7.14, 7.16)', async () => {
    const getEngineStatusMock = vi.fn().mockResolvedValue(dummyStatusOutdated);
    const checkLatestVersionMock = vi.fn().mockResolvedValue(null);

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: checkLatestVersionMock,
        },
      },
    });

    const snapshotWithoutChange: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        selectedChangeId: null,
      },
    };

    usePipelineStore.setState({ selectedChangeId: null });

    const { container } = render(
      <OpenSpecDashboard
        snapshot={snapshotWithoutChange}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    // 1. Sin cambio elegido no hay avisos en el centro
    expect(screen.queryByRole('heading', { name: /Avisos/i, level: 4 })).toBeNull();
    expect(screen.queryByText(/OpenSpec requiere atención/i)).toBeNull();

    // 2. El primer elemento de main es la pantalla de inicio
    const mainEl = container.querySelector('main');
    expect(mainEl).not.toBeNull();
    const firstSectionInMain = mainEl!.firstElementChild;
    expect(firstSectionInMain?.className).toContain('startScreen');

    vi.unstubAllGlobals();
  });

  it('la franja enciende con CADA UNA de las tres causas por separado: desactualizada, sin inicializar, divergente (7.15, 7.16)', async () => {
    // Causa 1: integración desactualizada
    const outdatedStatus: OpenSpecEngineStatus = {
      ...dummyStatusOutdated,
      integrationState: 'outdated',
      repoState: 'initialized',
      divergence: { isDivergent: false, reason: null, overallStatus: 'convergent', globalProfileClass: 'core', repoProfileClass: 'core' },
    };

    const getStatusMock = vi.fn().mockResolvedValue(outdatedStatus);
    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getStatusMock,
          checkLatestVersion: vi.fn().mockResolvedValue(null),
        },
      },
    });

    const { unmount: unmount1 } = render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const chipOutdated = await screen.findByRole('status', { name: /OpenSpec v1\.8\.0/i });
    expect(chipOutdated.className).toMatch(/text-warning/);
    expect(chipOutdated.getAttribute('title')).toMatch(/desactualizada/i);
    unmount1();

    // Causa 2: repositorio sin inicializar
    const notInitStatus: OpenSpecEngineStatus = {
      ...dummyStatusOutdated,
      integrationState: 'up-to-date',
      repoState: 'not-initialized',
      divergence: { isDivergent: false, reason: null, overallStatus: 'convergent', globalProfileClass: 'core', repoProfileClass: 'core' },
    };
    getStatusMock.mockResolvedValue(notInitStatus);

    const { unmount: unmount2 } = render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const chipNotInit = await screen.findByRole('status', { name: /OpenSpec v1\.8\.0/i });
    expect(chipNotInit.className).toMatch(/text-warning/);
    expect(chipNotInit.getAttribute('title')).toMatch(/no está inicializado/i);
    unmount2();

    // Causa 3: divergente
    const divergentStatus: OpenSpecEngineStatus = {
      ...dummyStatusOutdated,
      integrationState: 'up-to-date',
      repoState: 'initialized',
      divergence: {
        isDivergent: true,
        reason: { kind: 'profile-mismatch', globalProfileClass: 'custom', repoProfileClass: 'core' },
        overallStatus: 'divergent',
        globalProfileClass: 'custom',
        repoProfileClass: 'core',
      },
    };
    getStatusMock.mockResolvedValue(divergentStatus);

    const { unmount: unmount3 } = render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const chipDivergent = await screen.findByRole('status', { name: /OpenSpec v1\.8\.0/i });
    expect(chipDivergent.className).toMatch(/text-warning/);
    expect(chipDivergent.getAttribute('title')).toMatch(/divergen/i);
    unmount3();

    // Caso limpio: convergente, al día y con motor alineado al ciclo
    const cleanStatus: OpenSpecEngineStatus = dummyStatusHealthy;
    getStatusMock.mockResolvedValue(cleanStatus);

    const { unmount: unmount4 } = render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const chipClean = await screen.findByRole('status', { name: /OpenSpec v1\.14\.0/i });
    expect(chipClean.className).not.toMatch(/text-warning/);
    unmount4();

    vi.unstubAllGlobals();
  });

  it('la franja superior enciende con advertencia y muestra el aviso cuando el motor está atrasado respecto al ciclo (isBehind / 5.2)', async () => {
    const behindStatus: OpenSpecEngineStatus = {
      ...dummyStatusHealthy,
      cli: {
        ...dummyCliHealthy,
        runtimeVersion: '1.8.0',
      },
    };

    const getStatusMock = vi.fn().mockResolvedValue(behindStatus);
    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getStatusMock,
          checkLatestVersion: vi.fn().mockResolvedValue(null),
        },
      },
    });

    render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const chipBehind = await screen.findByRole('status', { name: /OpenSpec v1\.8\.0/i });
    expect(chipBehind.className).toMatch(/text-warning/);
    expect(chipBehind.getAttribute('title')).toMatch(/anterior al ciclo declarado/i);

    vi.unstubAllGlobals();
  });

  it('cuando el motor está instalado pero runtimeVersion es null, la píldora dice «OpenSpec: sin detectar» con color de aviso y no contiene la versión objetivo (Corrección 1)', async () => {
    const statusNullRuntime: OpenSpecEngineStatus = {
      ...dummyStatusOutdated,
      cli: {
        ...dummyStatusOutdated.cli!,
        installed: true,
        runtimeVersion: null,
      },
    };

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(statusNullRuntime),
          checkLatestVersion: vi.fn().mockResolvedValue(null),
        },
      },
    });

    render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const chipNotDetected = await screen.findByRole('status', { name: /OpenSpec:\s*sin detectar/i });
    expect(chipNotDetected).toBeTruthy();
    expect(chipNotDetected.className).toMatch(/text-warning/);
    expect(chipNotDetected.textContent).not.toContain(OPENSPEC_CYCLE_TARGET_VERSION);
    expect(chipNotDetected.getAttribute('title') ?? '').not.toContain(OPENSPEC_CYCLE_TARGET_VERSION);

    vi.unstubAllGlobals();
  });

  it('cuando el motor no está instalado (cli.installed false), la píldora dice «Ausente» y no contiene la versión objetivo (Corrección 1)', async () => {
    const statusAbsent: OpenSpecEngineStatus = {
      ...dummyStatusOutdated,
      cli: {
        ...dummyStatusOutdated.cli!,
        installed: false,
        runtimeVersion: null,
      },
    };

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(statusAbsent),
          checkLatestVersion: vi.fn().mockResolvedValue(null),
        },
      },
    });

    render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const chipAbsent = await screen.findByRole('status', { name: /Ausente/i });
    expect(chipAbsent).toBeTruthy();
    expect(chipAbsent.className).toMatch(/text-warning/);
    expect(chipAbsent.textContent).not.toContain(OPENSPEC_CYCLE_TARGET_VERSION);
    expect(chipAbsent.getAttribute('title') ?? '').not.toContain(OPENSPEC_CYCLE_TARGET_VERSION);

    vi.unstubAllGlobals();
  });

  it('con divergencia y sin nada más, el centro NO avisa Y la sección enciende el triángulo (7.13, 7.16)', async () => {
    const divergenceStatus: OpenSpecEngineStatus = {
      ...dummyStatusOutdated,
      integrationState: 'up-to-date',
      divergence: {
        isDivergent: true,
        reason: {
          kind: 'profile-mismatch',
          globalProfileClass: 'custom',
          repoProfileClass: 'core',
        },
        overallStatus: 'divergent',
        globalProfileClass: 'custom',
        repoProfileClass: 'core',
      },
    };

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(divergenceStatus),
          checkLatestVersion: vi.fn().mockResolvedValue(null),
        },
      },
    });

    const snapshotDivergent: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        selectedChangeId: null,
        openSpecTools: [{ toolId: 'git', label: 'Git', directory: '.git', configured: true }],
        openSpecPresent: true,
      },
    };

    // 1. Centro (OpenSpecDashboard) -> NO monta avisos
    const { unmount: unmountCenter } = render(
      <OpenSpecDashboard
        snapshot={snapshotDivergent}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    expect(screen.queryByRole('heading', { name: /Avisos/i, level: 4 })).toBeNull();
    expect(screen.queryByText(/OpenSpec requiere atención/i)).toBeNull();

    unmountCenter();

    // 2. Sección lateral (OpenSpecInspector) -> SÍ enciende el triángulo
    const { unmount: unmountSection } = render(
      <OpenSpecInspector repoPath="C:\\repo" snapshot={snapshotDivergent} />,
    );

    const toolsBtn = await screen.findByRole('button', { name: /Herramientas|tools/i });
    const toolsSectionHeader = toolsBtn.parentElement!;
    const warningIcon = await within(toolsSectionHeader).findByRole('img', {
      name: /Necesita atención|needsAttention/i,
    });
    expect(warningIcon).toBeTruthy();
    expect(warningIcon.getAttribute('aria-hidden')).toBeNull();

    unmountSection();
    vi.unstubAllGlobals();
  });

  it('con herramienta sin configurar y sin nada más, el centro NO avisa Y la sección enciende el triángulo (7.13, 7.16)', async () => {
    const cleanEngineStatus: OpenSpecEngineStatus = {
      ...dummyStatusOutdated,
      integrationState: 'up-to-date',
      divergence: {
        isDivergent: false,
        reason: null,
        overallStatus: 'convergent',
        globalProfileClass: 'core',
        repoProfileClass: 'core',
      },
    };

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(cleanEngineStatus),
          checkLatestVersion: vi.fn().mockResolvedValue(null),
        },
      },
    });

    const snapshotUnconfiguredTool: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        selectedChangeId: null,
        openSpecTools: [{ toolId: 'custom-tool', label: 'Custom Tool', directory: '.custom', configured: false }],
        openSpecPresent: true,
      },
    };

    // 1. Centro (OpenSpecDashboard) -> NO monta avisos
    const { unmount: unmountCenter } = render(
      <OpenSpecDashboard
        snapshot={snapshotUnconfiguredTool}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    expect(screen.queryByRole('heading', { name: /Avisos/i, level: 4 })).toBeNull();
    expect(screen.queryByText(/herramienta.*sin configurar/i)).toBeNull();

    unmountCenter();

    // 2. Sección lateral (OpenSpecInspector) -> SÍ enciende el triángulo
    const { unmount: unmountSection } = render(
      <OpenSpecInspector repoPath="C:\\repo" snapshot={snapshotUnconfiguredTool} />,
    );

    const toolsBtn = await screen.findByRole('button', { name: /Herramientas|tools/i });
    const toolsSectionHeader = toolsBtn.parentElement!;
    const warningIcon = await within(toolsSectionHeader).findByRole('img', {
      name: /Necesita atención|needsAttention/i,
    });
    expect(warningIcon).toBeTruthy();
    expect(warningIcon.getAttribute('aria-hidden')).toBeNull();

    unmountSection();
    vi.unstubAllGlobals();
  });

  it('el centro y la sección comparten la misma condición de atención ante estado limpio (7.13, 7.15, 7.16)', async () => {
    const cleanEngineStatus: OpenSpecEngineStatus = {
      ...dummyStatusOutdated,
      integrationState: 'up-to-date',
      divergence: {
        isDivergent: false,
        reason: null,
        overallStatus: 'convergent',
        globalProfileClass: 'core',
        repoProfileClass: 'core',
      },
    };

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(cleanEngineStatus),
          checkLatestVersion: vi.fn().mockResolvedValue(null),
        },
      },
    });

    const snapshotClean: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        selectedChangeId: null,
        openSpecTools: [{ toolId: 'git', label: 'Git', directory: '.git', configured: true }],
        openSpecPresent: true,
      },
    };

    // 1. Centro limpio -> NO muestra sección de avisos
    const { unmount: unmountCenter } = render(
      <OpenSpecDashboard
        snapshot={snapshotClean}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    expect(screen.queryByRole('heading', { name: /Avisos/i, level: 4 })).toBeNull();
    unmountCenter();

    // 2. Sección limpia -> NO muestra ícono de advertencia
    const { unmount: unmountSection } = render(
      <OpenSpecInspector repoPath="C:\\repo" snapshot={snapshotClean} />,
    );

    const toolsBtn = await screen.findByRole('button', { name: /Herramientas|tools/i });
    const toolsSectionHeader = toolsBtn.parentElement!;
    const warningIcon = toolsSectionHeader.querySelector('svg[aria-label="Necesita atención"], svg[aria-label="pipeline.openspec.engine.generalStatus.needsAttention"]');
    expect(warningIcon).toBeNull();

    unmountSection();
    vi.unstubAllGlobals();
  });

  it('dos Inspectors montados con repos distintos: un setProfile exitoso en uno provoca que los dos refetcheen (Parte 5)', async () => {
    const statusWithGlobalConfig = {
      ...dummyStatusHealthy,
      repoState: 'initialized' as const,
      globalConfig: {
        rawProfile: 'core',
        profileState: 'read' as const,
        delivery: 'both' as const,
        deliveryState: 'read' as const,
        configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
        workflowsState: 'read' as const,
        resolvedWorkflows: ['propose', 'explore', 'apply', 'update', 'sync', 'archive'],
        resolvedWorkflowsState: 'read' as const,
        origin: 'cli' as const,
        readAt: '2026-09-11T12:00:00.000Z',
        divergence: { isDivergent: false, reason: null, overallStatus: 'convergent' as const, globalProfileClass: 'core' as const, repoProfileClass: 'core' as const },
      },
    };

    const getEngineStatusMock = vi.fn().mockImplementation((repo: string) => {
      return Promise.resolve(statusWithGlobalConfig);
    });

    const setProfileMock = vi.fn().mockResolvedValue({ ok: true });

    (window as any).api = {
      pipelineOpenSpec: {
        getEngineStatus: getEngineStatusMock,
        checkLatestVersion: vi.fn().mockResolvedValue(null),
        setProfile: setProfileMock,
        setWorkflow: vi.fn().mockResolvedValue({ ok: true }),
      },
    };

    window.localStorage.setItem('gitcron:sidebarSections:C:\\repo1', JSON.stringify({ 'details-tools': true }));
    window.localStorage.setItem('gitcron:sidebarSections:C:\\repo2', JSON.stringify({ 'details-tools': true }));

    const { unmount } = render(
      <div>
        <div data-testid="inspector-1">
          <OpenSpecInspector repoPath="C:\\repo1" snapshot={dummySnapshot} />
          <OpenSpecEngineCard
            repoPath="C:\\repo1"
            status={statusWithGlobalConfig}
            onChanged={() => usePipelineStore.getState().notifyEngineChanged()}
          />
        </div>
        <div data-testid="inspector-2">
          <OpenSpecInspector repoPath="C:\\repo2" snapshot={dummySnapshot} />
        </div>
      </div>,
    );

    expect(await screen.findAllByRole('button', { name: /Herramientas|tools/i })).toBeDefined();
    expect(getEngineStatusMock).toHaveBeenCalledWith(expect.stringContaining('repo1'));
    expect(getEngineStatusMock).toHaveBeenCalledWith(expect.stringContaining('repo2'));
    const callsBefore = getEngineStatusMock.mock.calls.length;

    const inspector1 = screen.getByTestId('inspector-1');
    const toolsBtn = await within(inspector1).findByRole('button', { name: /Herramientas/i });
    fireEvent.click(toolsBtn);

    const advBtn = await within(inspector1).findByRole('button', { name: /Ver diagnóstico avanzado/i });
    fireEvent.click(advBtn);

    const lockBtn = await within(inspector1).findByRole('button', { name: /core/i });
    await fireEvent.click(lockBtn);

    expect(setProfileMock).toHaveBeenCalledTimes(1);

    expect(getEngineStatusMock.mock.calls.length).toBeGreaterThan(callsBefore);
    const callsAfter = getEngineStatusMock.mock.calls.slice(callsBefore);
    expect(callsAfter.some(([repo]) => repo && repo.includes('repo1'))).toBe(true);
    expect(callsAfter.some(([repo]) => repo && repo.includes('repo2'))).toBe(true);

    unmount();
    vi.unstubAllGlobals();
  });

  it('motor 1.14.0 sano y latest 1.15.0: la píldora avisa con punto, texto en title y clase text-warning (6.7-B + decisión 2026-09-14)', async () => {
    const status114Healthy: OpenSpecEngineStatus = {
      ...dummyStatusHealthy,
      cli: {
        ...dummyStatusHealthy.cli,
        runtimeVersion: '1.14.0',
      },
    };

    const getEngineStatusMock = vi.fn().mockResolvedValue(status114Healthy);
    const checkLatestVersionMock = vi.fn().mockResolvedValue({
      status: 'online',
      latestVersion: '1.15.0',
      checkedAt: 'now',
      fromCache: false,
      cacheAgeSeconds: 0,
      freshness: 'fresh',
      error: null,
    });

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: checkLatestVersionMock,
        },
      },
    });

    render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    // La píldora se encuentra por título que contiene «v1.15.0 disponible en npm»
    const pill = await screen.findByTitle(/v1\.15\.0 disponible en npm/i);
    expect(pill).toBeDefined();

    // Existe un elemento con aria-label igual a ese texto
    const dot = screen.getByLabelText('v1.15.0 disponible en npm');
    expect(dot).toBeDefined();
    expect(dot.getAttribute('data-upgrade')).toBe('available');

    // versión nueva → ámbar, decisión de Alejandro 2026-09-14
    expect(pill.className).toContain('text-warning');

    vi.unstubAllGlobals();
  });

  it('motor 1.14.0 y latest 1.13.0 (instalada más nueva que npm): el título NO contiene disponible en npm y no hay data-upgrade (Tarea 6.7-B)', async () => {
    const status114: OpenSpecEngineStatus = {
      ...dummyStatusHealthy,
      cli: {
        ...dummyStatusHealthy.cli,
        runtimeVersion: '1.14.0',
      },
    };

    const getEngineStatusMock = vi.fn().mockResolvedValue(status114);
    const checkLatestVersionMock = vi.fn().mockResolvedValue({
      status: 'online',
      latestVersion: '1.13.0',
      checkedAt: 'now',
      fromCache: false,
      cacheAgeSeconds: 0,
      freshness: 'fresh',
      error: null,
    });

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: checkLatestVersionMock,
        },
      },
    });

    render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    // Esperar a que la píldora se monte con OpenSpec v1.14.0
    const pill = await screen.findByTitle(/OpenSpec v1\.14\.0/i);
    expect(pill).toBeDefined();

    // El título NO contiene «disponible en npm»
    expect(pill.getAttribute('title')).not.toContain('disponible en npm');

    // No existe ningún elemento con data-upgrade
    expect(document.querySelector('[data-upgrade]')).toBeNull();

    vi.unstubAllGlobals();
  });

  it('con getEngineStatus simulado, al llamar a notifyEngineChanged() dentro de act(), getEngineStatus se llama una segunda vez con el mismo repoPath (Tarea 6.11)', async () => {
    const getEngineStatusMock = vi.fn().mockResolvedValue(dummyStatusHealthy);

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: getEngineStatusMock,
          checkLatestVersion: vi.fn().mockResolvedValue(null),
          getInstallPlan: vi.fn().mockResolvedValue(null),
        },
      },
    });

    render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath={'C:\\repo-notify'}
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    await screen.findByTitle(/OpenSpec v1\.14\.0/i);
    expect(getEngineStatusMock).toHaveBeenCalledTimes(1);
    expect(getEngineStatusMock).toHaveBeenCalledWith('C:\\repo-notify');

    act(() => {
      usePipelineStore.getState().notifyEngineChanged();
    });

    await vi.waitFor(() => {
      expect(getEngineStatusMock).toHaveBeenCalledTimes(2);
    });
    expect(getEngineStatusMock).toHaveBeenNthCalledWith(2, 'C:\\repo-notify');

    vi.unstubAllGlobals();
  });

  it('con reviewOpen true y rightOpen false, se ve el riel de vistas junto con la revisión, y al cambiar de vista se cierra la revisión (Tarea 8.22 d)', async () => {
    usePipelineStore.setState({ reviewOpen: true });

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(dummyStatusHealthy),
          checkLatestVersion: vi.fn().mockResolvedValue(null),
          getUpdatePlan: vi.fn().mockResolvedValue(null),
        },
      },
    });

    render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo-review-rail"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    // Se ve el encabezado de la revisión
    expect(await screen.findByRole('heading', { level: 3, name: /Configuración de OpenSpec/i })).toBeTruthy();

    // Se ve el riel de vistas
    const railNav = screen.getByRole('navigation', { name: /pipeline\.switcher\.views|Vistas/i });
    expect(railNav).toBeTruthy();

    // Al pulsar una vista del riel, reviewOpen pasa a false
    const viewButtons = within(railNav).getAllByRole('button');
    expect(viewButtons.length).toBeGreaterThan(0);
    fireEvent.click(viewButtons[0]);

    expect(usePipelineStore.getState().reviewOpen).toBe(false);

    vi.unstubAllGlobals();
  });

  it('con reviewOpen true, el riel muestra «Configuración» con aria-pressed="true" (8.23-a2)', async () => {
    usePipelineStore.setState({ reviewOpen: true });

    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(dummyStatusHealthy),
          checkLatestVersion: vi.fn().mockResolvedValue(null),
          getUpdatePlan: vi.fn().mockResolvedValue(null),
        },
      },
    });

    render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="C:\\repo-review-pressed"
        currentBranch="main"
        workingTreeClean={true}
        leftOpen={true}
        rightOpen={false}
        leftWidth={340}
        rightWidth={340}
        onResizeLeft={vi.fn()}
        onResizeRight={vi.fn()}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    const railNav = screen.getByRole('navigation', { name: /pipeline\.switcher\.views|Vistas/i });
    expect(railNav).toBeTruthy();

    const configBtn = within(railNav).getByRole('button', { name: /Configuración|pipeline\.openspec\.config\.railEntry/i });
    expect(configBtn).toBeTruthy();
    expect(configBtn.getAttribute('data-view-id')).toBe('openspec-config');
    expect(configBtn.getAttribute('aria-pressed')).toBe('true');

    vi.unstubAllGlobals();
  });
});
