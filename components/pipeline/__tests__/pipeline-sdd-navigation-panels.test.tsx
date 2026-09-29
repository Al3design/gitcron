// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import { RepoDetailsPanel } from '../../RepoDetailsPanel';
import { RepoSidebar } from '../../RepoSidebar';
import { usePipelineStore } from '@/lib/pipeline-store';
import { useGitStore } from '@/lib/git-store';
import { useNewChangeDraftStore } from '@/lib/new-change-draft-store';
import { openSidebarSection, closeSidebarSection } from '@/hooks/use-sidebar-section-state';
import type { PipelineSnapshot } from '../pipeline-view-state';

const testTranslations: Record<string, string> = {
  'pipeline.inbox.title': 'Avisos',
  'pipeline.openspec.attention.title': 'Necesita atención',
  'pipeline.decision.viewEvidence': 'Ver evidencia',
  'pipeline.next.task.action': 'Aplicar {{task}}',
};

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    const val = testTranslations[key];
    if (val !== undefined) {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
          val
        );
      }
      return val;
    }
    return params ? `${key}:${JSON.stringify(params)}` : key;
  },
}));

beforeEach(() => {
  usePipelineStore.getState().reset();
  usePipelineStore.getState().setSnapshot(mockSnapshot());
  useNewChangeDraftStore.getState().clearDraft('C:/repo-test');
  useGitStore.setState({
    repoPath: 'C:/repo-test',
    currentBranch: 'main',
    modifiedFiles: [],
    commits: [],
    selectedCommit: null,
    commitMessage: '',
    selectedFile: null,
    isLoading: false,
    branches: ['main'],
    tags: [],
    remotes: [],
    stashes: [],
  });

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    window.api = {
      gitShowFiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
      shellOpenItem: vi.fn().mockResolvedValue({ success: true }),
      pipelineOpenSpec: {
        getEngineStatus: vi.fn().mockResolvedValue({
          repoState: 'initialized',
          cli: { installed: true, runtimeVersion: '1.13.2' },
          integrationState: 'up-to-date',
        }),
        getUpdatePlan: vi.fn().mockResolvedValue(null),
      },
    } as any;
  }
});

afterEach(() => {
  cleanup();
});

function mockChange(changeId: string) {
  return {
    changeId,
    intent: `Objetivo general del cambio ${changeId}`,
    createdAt: '2026-09-01T10:00:00Z',
    status: {
      available: true,
      artifacts: [
        { id: 'proposal', path: 'proposal.md', state: 'done' as const, requires: [] },
        { id: 'specs', path: 'specs/', state: 'done' as const, requires: ['proposal'] },
        { id: 'design', path: 'design.md', state: 'done' as const, requires: ['proposal'] },
        { id: 'tasks', path: 'tasks.md', state: 'ready' as const, requires: ['specs', 'design'] },
      ],
    },
    tasks: [
      {
        id: 't-1',
        text: '1.1 Tarea principal de integración',
        completed: false,
        line: 10,
        sourceRef: 'tasks.md:10',
      },
      {
        id: 't-2',
        text: '1.2 Segunda tarea complementaria',
        completed: true,
        line: 20,
        sourceRef: 'tasks.md:20',
      },
    ],
    proposalExists: true,
    designExists: true,
    specsCount: 1,
    validation: 'passed' as const,
    artifacts: {
      proposal: '# Propuesta\n\nTexto de objetivo de la propuesta.',
      specs: [{ name: 'spec-1', content: '# Spec 1' }],
      design: '# Diseño\n\nTexto de diseño arquitectónico.',
      tasks: '- [ ] 1.1 Tarea principal\n- [x] 1.2 Tarea complementaria',
    },
  };
}

function mockSnapshot(options: {
  selectedChangeId?: string | null;
  decisions?: any[];
} = {}): PipelineSnapshot {
  return {
    schemaVersion: '1.0',
    repoId: 'repo-test',
    availableSources: ['git', 'openspec'],
    hermesConnected: false,
    hasPipelineActivity: true,
    now: {
      headlineKey: 'x',
      runtime: null,
      role: null,
      taskLabel: null,
      tasksDone: null,
      tasksTotal: null,
      elapsedMs: null,
      costUsd: null,
      costBasis: 'unknown',
      needsHuman: false,
    },
    stations: [],
    decisions: options.decisions ?? [],
    agents: [],
    activity: [],
    economy: { reasoningAvailable: null } as PipelineSnapshot['economy'],
    diffs: [],
    openSpec: {
      selectedChangeId: options.selectedChangeId ?? null,
      activeChanges: [mockChange('cambio-operativo')],
      archivedChanges: [],
      specifications: [
        {
          specificationId: 'spec-general',
          requirements: 3,
          sourceRef: 'openspec/specs/spec-general/spec.md',
        },
      ],
      reports: [],
      diagnostics: [],
      observedAt: '2026-09-29T10:00:00Z',
      latestGate: null,
      openSpecPresent: true,
      openSpecTools: [{ toolId: 'git', label: 'Git', directory: '.git', configured: true }],
    },
  } as unknown as PipelineSnapshot;
}

interface HarnessProps {
  snapshot?: PipelineSnapshot;
  initialRightOpen?: boolean;
  initialActiveTab?: string;
  onSelectChange?: (changeId: string) => void;
  onRespondDecision?: (decisionId: string, optionId: string) => void;
}

function SddHarness({
  snapshot: propSnapshot,
  initialRightOpen = false,
  initialActiveTab = 'Pipeline',
  onSelectChange,
  onRespondDecision,
}: HarnessProps) {
  const [rightOpen, setRightOpen] = useState(initialRightOpen);
  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const snap = propSnapshot ?? mockSnapshot();

  React.useEffect(() => {
    if (usePipelineStore.getState().snapshot !== snap) {
      usePipelineStore.getState().setSnapshot(snap);
    }
  }, [snap]);

  return (
    <div data-testid="sdd-harness-frame" className="flex h-screen w-full">
      {/* 1. Menú global izquierdo */}
      <RepoSidebar
        graphMode="chronometric"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        filterText=""
        onFilterTextChange={vi.fn()}
        searchOpen={false}
        onSearchOpenChange={vi.fn()}
        onPullIntent={vi.fn()}
        onPushIntent={vi.fn()}
        onNewBranchRequest={vi.fn()}
        onOpenStashModal={vi.fn()}
        onFetchNow={vi.fn()}
        activeView="repository"
        onViewChange={vi.fn()}
        isRepoStartView={false}
        repoStartMode="open"
        onRepoStartModeChange={vi.fn()}
        onCloseRepoChooser={vi.fn()}
        selectedBranchName="main"
        onCheckoutAttempt={vi.fn()}
        onSelectBranchInGraph={vi.fn()}
        onBranchContextMenu={vi.fn()}
        onRemoteBranchContextMenu={vi.fn()}
        onDeleteBranchRequest={vi.fn()}
        selectedPullRequest={null}
        onSelectPullRequest={vi.fn()}
        onPreviewStash={vi.fn()}
        onCreateTagRequest={vi.fn()}
        onDeleteTagRequest={vi.fn()}
        selectedSettingsSection="general"
        onSettingsSectionChange={vi.fn()}
        selectedHelpSection="general"
        onHelpSectionChange={vi.fn()}
        onToggleCartography={vi.fn()}
      />

      {/* Control para alternar el inspector fijo desde el armazón de la app */}
      <button
        type="button"
        data-testid="toggle-fixed-inspector"
        onClick={() => setRightOpen((prev) => !prev)}
      >
        Alternar inspector fijo
      </button>

      {/* 2. Cuerpo central SDD */}
      <div className="flex-1 flex flex-col min-w-0">
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo-test"
          currentBranch="main"
          workingTreeClean={true}
          leftOpen={true}
          rightOpen={rightOpen}
          leftWidth={280}
          rightWidth={320}
          onResizeLeft={vi.fn()}
          onResizeRight={vi.fn()}
          onEnsureRightOpen={() => setRightOpen(true)}
          projection={null}
          runtimeHistory={[]}
          onRefresh={vi.fn()}
          onSelectChange={onSelectChange}
          onPauseAfterTask={vi.fn()}
          onRespondDecision={onRespondDecision}
        />
      </div>

      {/* 3. Panel derecho fijo (RepoDetailsPanel montando OpenSpecInspector) */}
      <RepoDetailsPanel
        activeTab={activeTab}
        graphMode="chronometric"
        detailsW={320}
        visible={rightOpen}
        isDragging={false}
        onResizeStart={vi.fn()}
        onOpenStashModal={vi.fn()}
        onOpenCommitFile={vi.fn()}
        onSelectFile={vi.fn()}
        onDiscardRequest={vi.fn()}
        onRequestAmend={vi.fn()}
        onRequestSquash={vi.fn()}
        onFileContextMenu={vi.fn()}
        onRequestResetAll={vi.fn()}
        onRequestCleanUntracked={vi.fn()}
      />
    </div>
  );
}

describe('Tarea 4.1: Navegación de SDD entre objetivo, tarea, artefactos y revisión alternando flotante/fijo', () => {
  it('1. Recorrido de navegación completo entre Objetivo, Tarea, Artefactos y Revisión en modo flotante', () => {
    render(<SddHarness initialRightOpen={false} />);

    // 1.1 Objetivo: Pantalla de inicio con el cambio en lista y su objetivo
    expect(screen.getByRole('region', { name: 'pipeline.openspec.start.title' })).toBeTruthy();
    expect(screen.getByText('cambio-operativo')).toBeTruthy();

    // 1.2 Tarea: Entrar al cambio conduce a la vista de tareas
    const enterBtn = screen.getByRole('button', { name: /openspec\.start\.enter/ });
    fireEvent.click(enterBtn);

    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(screen.getByText('1.1')).toBeTruthy();
    expect(screen.getByText(/Tarea principal de integración/)).toBeTruthy();

    // 1.3 Artefactos: Pulsar en el riel flotante conmuta a la vista de artefactos
    const artifactsRailBtn = screen.getByRole('button', { name: 'pipeline.switcher.artifacts' });
    expect(artifactsRailBtn).toBeTruthy();
    fireEvent.click(artifactsRailBtn);

    expect(screen.getByRole('region', { name: 'pipeline.switcher.artifacts' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'pipeline.details.title' })).toBeTruthy();
    expect(screen.getByText('Texto de objetivo de la propuesta.')).toBeTruthy();

    // 1.4 Revisión: Abrir la revisión de configuración/herramientas desde el riel
    const configBtn = screen.getByRole('button', { name: /pipeline\.openspec\.config\.railEntry/ });
    fireEvent.click(configBtn);

    expect(screen.getByRole('heading', { name: /pipeline\.openspec\.engine\.review\.title/ })).toBeTruthy();

    // 1.5 Cierre de revisión y regreso
    const closeReviewBtn = screen.getByRole('button', { name: 'pipeline.openspec.engine.review.close' });
    fireEvent.click(closeReviewBtn);

    expect(screen.getByRole('region', { name: 'pipeline.switcher.artifacts' })).toBeTruthy();

    // Volver a tareas
    const tasksRailBtn = screen.getByRole('button', { name: /pipeline\.switcher\.tasks/ });
    fireEvent.click(tasksRailBtn);
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();

    // Regresar al Objetivo general (inicio)
    const backToStartBtn = screen.getByRole('button', { name: 'pipeline.openspec.start.inProgress' });
    fireEvent.click(backToStartBtn);
    expect(screen.getByRole('region', { name: 'pipeline.openspec.start.title' })).toBeTruthy();
  });

  it('2. Conservación de la selección (cambio y tarea) al alternar entre panel flotante e inspector fijo', () => {
    const onSelectChange = vi.fn();
    const { container } = render(<SddHarness initialRightOpen={false} onSelectChange={onSelectChange} />);

    // Entrar al cambio
    fireEvent.click(screen.getByRole('button', { name: /openspec\.start\.enter/ }));
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(usePipelineStore.getState().selectedChangeId).toBe('cambio-operativo');

    // Estado inicial: flotante montado, inspector fijo oculto
    const railInitial = container.querySelector('nav[class*="switcherRail"]');
    expect(railInitial).toBeTruthy();
    const detailsPanel = container.querySelector('[data-testid="repo-details-panel"]') as HTMLElement;
    expect(detailsPanel.style.visibility).toBe('hidden');

    // Alternar al inspector fijo (abrir panel derecho)
    const toggleFixedBtn = screen.getByTestId('toggle-fixed-inspector');
    fireEvent.click(toggleFixedBtn);

    // Verificaciones con inspector fijo abierto:
    // a) El inspector derecho está visible y monta OpenSpecInspector
    expect(detailsPanel.style.visibility).toBe('visible');
    expect(screen.getByRole('button', { name: /pipeline\.openspec\.activity\.title/ })).toBeTruthy();

    // b) La selección de cambio se conserva rigurosamente
    expect(usePipelineStore.getState().selectedChangeId).toBe('cambio-operativo');
    expect(screen.getByText('cambio-operativo')).toBeTruthy();

    // c) La vista de tareas del cambio sigue montada en el centro
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(screen.getByText('1.1')).toBeTruthy();
    expect(screen.getByText(/Tarea principal de integración/)).toBeTruthy();

    // d) El panel flotante cedió su lugar al inspector fijo
    const foldedRail = container.querySelector('nav[class*="switcherRail"]');
    if (foldedRail) {
      fireEvent.transitionEnd(foldedRail);
    }
    expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();

    // Alternar nuevamente de regreso al panel flotante (cerrar panel derecho)
    fireEvent.click(toggleFixedBtn);

    // a) El inspector derecho vuelve a ocultarse
    expect(detailsPanel.style.visibility).toBe('hidden');

    // b) El riel flotante vuelve a montarse en el cuerpo central
    expect(container.querySelector('nav[class*="switcherRail"]')).toBeTruthy();

    // c) La selección de cambio y la tarea siguen idénticas
    expect(usePipelineStore.getState().selectedChangeId).toBe('cambio-operativo');
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(screen.getByText('1.1')).toBeTruthy();
    expect(screen.getByText(/Tarea principal de integración/)).toBeTruthy();
  });

  it('3. El menú global sigue accesible e interactivo en ambos modos (flotante y fijo)', () => {
    const { container } = render(<SddHarness initialRightOpen={false} />);

    // 3.1 Con panel flotante (rightOpen: false)
    const sidebar = container.querySelector('aside');
    expect(sidebar).toBeTruthy();

    // Abrir sección de ramas locales en el menú global
    openSidebarSection('C:/repo-test', 'local');
    const localSectionBtn = screen.getByRole('button', { name: /sidebar\.local/ });
    expect(localSectionBtn).toBeTruthy();

    // 3.2 Alternar a inspector fijo (rightOpen: true)
    fireEvent.click(screen.getByTestId('toggle-fixed-inspector'));

    // El menú global sigue en su lugar, accesible y sin obstrucción
    expect(container.querySelector('aside')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sidebar\.local/ })).toBeTruthy();

    // 3.3 Alternar pestaña global y volver
    // Abrir el selector de vistas global en RepoSidebar
    const viewSelectorBtn = screen.getByRole('button', { name: /tab\.pipeline/ });
    expect(viewSelectorBtn).toBeTruthy();
    fireEvent.click(viewSelectorBtn);

    // Cambiar a la vista Graph
    const graphMenuItem = screen.getByRole('menuitem', { name: /tab\.graph/ });
    expect(graphMenuItem).toBeTruthy();
    fireEvent.click(graphMenuItem);

    // Volver a abrir el selector y regresar a Pipeline
    const viewSelectorGraphBtn = screen.getByRole('button', { name: /tab\.graph/ });
    expect(viewSelectorGraphBtn).toBeTruthy();
    fireEvent.click(viewSelectorGraphBtn);

    const pipelineMenuItem = screen.getByRole('menuitem', { name: /tab\.pipeline/ });
    expect(pipelineMenuItem).toBeTruthy();
    fireEvent.click(pipelineMenuItem);

    expect(screen.getByRole('region', { name: 'pipeline.openspec.start.title' })).toBeTruthy();
  });

  it('4. Los avisos no detienen el flujo: el riel mantiene la tarea pendiente y ofrece entrada a los avisos', () => {
    closeSidebarSection('C:/repo-test', 'details-attention');

    const snapshotWithNotice = mockSnapshot({
      selectedChangeId: 'cambio-operativo',
      decisions: [
        {
          decisionId: 'dec-1',
          changeId: 'cambio-operativo',
          title: 'Aviso sobre evidencia rechazada',
          prompt: 'Se rechazó la auditoría de evidencia',
          evidenceRefs: ['docs/reports/eval.md'],
          options: [
            {
              id: 'opt-evidencia',
              labelKey: 'pipeline.decision.viewEvidence',
              availability: 'informational',
              consequence: 'Visualizar documentación de evaluación',
            },
          ],
        },
      ],
    });

    usePipelineStore.getState().setSnapshot(snapshotWithNotice);
    const { container } = render(
      <SddHarness snapshot={snapshotWithNotice} initialRightOpen={false} />
    );

    // Entrar al cambio para acceder al contexto activo
    fireEvent.click(screen.getByRole('button', { name: /openspec\.start\.enter/ }));

    // Con initialRightOpen: false, el inspector derecho está oculto
    const detailsPanel = container.querySelector('[data-testid="repo-details-panel"]') as HTMLElement;
    expect(detailsPanel.style.visibility).toBe('hidden');

    // (a) El riel sigue ofreciendo la acción de aplicar la tarea 1.1
    const applyTaskBtn = screen.getByRole('button', { name: /Aplicar 1\.1/ });
    expect(applyTaskBtn).toBeTruthy();

    // (b) Existe «Avisos (1)» en el riel
    const noticesBtn = screen.getByRole('button', { name: /Avisos \(1\)/ });
    expect(noticesBtn).toBeTruthy();

    // La sección quedó plegada desde el montaje: el aviso todavía no está a mano
    expect(screen.queryByRole('button', { name: /Ver evidencia/ })).toBeNull();

    // (c) Tocar «Avisos» deja el inspector visible, la sección desplegada y document.activeElement es la sección «Necesita atención»
    fireEvent.click(noticesBtn);

    expect(detailsPanel.style.visibility).toBe('visible');
    const attentionSection = screen.getByRole('region', { name: 'Necesita atención' });
    expect(attentionSection).toBeTruthy();
    expect(document.activeElement).toBe(attentionSection);

    // (d) «Ver evidencia» está visible
    expect(screen.getByRole('button', { name: /Ver evidencia/ })).toBeTruthy();
  });

  it('5. La preparación y commit abren el inspector fijo asegurando que la acción de confirmación no quede oculta', () => {
    const { container } = render(<SddHarness initialRightOpen={false} />);

    const detailsPanel = container.querySelector('[data-testid="repo-details-panel"]') as HTMLElement;
    expect(detailsPanel.style.visibility).toBe('hidden');

    // Botón de preparación en el encabezado común de SDD
    const prepareToggleBtn = screen.getByRole('button', { name: 'pipeline.openspec.prepare.open' });
    fireEvent.click(prepareToggleBtn);

    // Asegura apertura del inspector fijo
    expect(detailsPanel.style.visibility).toBe('visible');
    expect(usePipelineStore.getState().prepareOpen).toBe(true);
    expect(screen.getByRole('region', { name: 'pipeline.openspec.prepare.title' })).toBeTruthy();
  });
});
