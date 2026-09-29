// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoTabs } from '../RepoTabs';
import { RepoSidebar } from '../RepoSidebar';
import { RepoDetailsPanel } from '../RepoDetailsPanel';
import { RepoMainView } from '../RepoMainView';
import { OpenSpecDashboard } from '../pipeline/OpenSpecDashboard';
import { OpenSpecInspector } from '../pipeline/OpenSpecInspector';
import { SidebarSection } from '../RepoSidebarParts';
import { usePanelLayout } from '@/hooks/use-panel-layout';
import { usePipelineStore } from '@/lib/pipeline-store';
import { useGitStore } from '@/lib/git-store';
import { openSidebarSection, useSidebarSectionState } from '@/hooks/use-sidebar-section-state';
import type { PipelineSnapshot } from '../pipeline/pipeline-view-state';

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => () => <div data-testid="mock-dynamic-component" />,
}));

vi.mock('@/components/ChronometricGraph', () => ({
  ChronometricGraph: () => <div data-testid="mock-chronometric-graph" />,
}));

vi.mock('@/components/CommitGraph', () => ({
  CommitGraph: () => <div data-testid="mock-commit-graph" />,
  colorForBranch: () => '#ffffff',
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

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string) => key,
  tNow: (key: string) => key,
}));

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({
    applyPatchFile: vi.fn(),
    openTerminal: vi.fn(),
    stashApply: vi.fn(),
    stashPop: vi.fn(),
    stashDrop: vi.fn(),
    stashClear: vi.fn(),
    pushTag: vi.fn(),
  }),
}));

const INITIAL_GIT_STATE = {
  repoPath: '/test/repo',
  isLoading: false,
  branches: [],
  remoteBranches: [],
  remotes: [],
  tags: [],
  stashes: [],
  pullRequests: [],
  worktrees: [],
  submodules: [],
  modifiedFiles: [] as any[],
  commitMessage: '',
  setCommitMessage: vi.fn(),
  isAIGeneratingMessage: false,
  generateAICommitMessage: vi.fn(),
  abortAIGeneration: vi.fn(),
  githubUser: null,
  enableCartography: false,
  getActiveRepo: () => null,
  openRepos: [],
  activeRepoIdx: 0,
  isFetchingRemote: false,
  lastFetchTime: null,
  autoFetchEnabled: false,
};

let mockGitState = { ...INITIAL_GIT_STATE };

vi.mock('@/lib/git-store', () => {
  const useGitStoreMock: any = (selector?: (s: any) => any) => {
    return selector ? selector(mockGitState) : mockGitState;
  };
  useGitStoreMock.getState = () => mockGitState;
  useGitStoreMock.setState = (partial: any) => Object.assign(mockGitState, typeof partial === 'function' ? partial(mockGitState) : partial);
  return { useGitStore: useGitStoreMock };
});

afterEach(() => {
  cleanup();
  mockGitState = { ...INITIAL_GIT_STATE, modifiedFiles: [] };
  usePipelineStore.setState({ selectedChangeId: null, openSpecificationId: null });
});

describe('Panel layout armazón & separación de fondos (modo por omisión: chronometric)', () => {
  it('RepoTabs renderiza controles accesibles de 44px para plegar paneles', () => {
    render(
      <RepoTabs
        repos={[{ path: '/test/repo', name: 'repo', isLoading: false } as any]}
        activeIdx={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onReorder={vi.fn()}
        sidebarOpen={true}
        onToggleSidebar={vi.fn()}
        detailsOpen={true}
        onToggleDetails={vi.fn()}
      />
    );

    const sidebarToggle = screen.getByRole('button', { name: 'toolbar.hideSidebar' });
    expect(sidebarToggle.className).toContain('min-h-[44px]');
    expect(sidebarToggle.className).toContain('min-w-[44px]');

    const detailsToggle = screen.getByRole('button', { name: 'toolbar.hideDetails' });
    expect(detailsToggle.className).toContain('min-h-[44px]');
    expect(detailsToggle.className).toContain('min-w-[44px]');
  });

  it('RepoSidebar utiliza bg-bg-surface continuo en modo cronométrico sin flotar ni radio propio', () => {
    const { container } = render(
      <RepoSidebar
        graphMode="chronometric"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
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
        onAddRemoteRequest={vi.fn()}
        onRenameRemoteRequest={vi.fn()}
        onSetRemoteUrlRequest={vi.fn()}
        onDeleteRemoteRequest={vi.fn()}
        onAddWorktreeRequest={vi.fn()}
        onDeleteWorktreeRequest={vi.fn()}
        onAddSubmoduleRequest={vi.fn()}
        onUpdateSubmodule={vi.fn()}
        onSyncSubmodules={vi.fn()}
      />
    );

    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside?.className).toContain('bg-bg-surface');
    expect(aside?.className).toContain('relative');
    expect(aside?.className).not.toContain('absolute');
    expect(aside?.className).not.toContain('backdrop-blur');
    expect(aside?.className).not.toContain('rounded-xl');
  });

  it('RepoDetailsPanel utiliza bg-bg-surface continuo en modo cronométrico sin flotar ni radio propio', () => {
    const { container } = render(
      <RepoDetailsPanel
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside?.className).toContain('bg-bg-surface');
    expect(aside?.className).toContain('relative');
    expect(aside?.className).not.toContain('absolute');
    expect(aside?.className).not.toContain('backdrop-blur');
    expect(aside?.className).not.toContain('rounded-xl');
  });

  it('ocultar el panel lateral conserva la composición de armazón y esquina redondeada en modo cronométrico', () => {
    const { container } = render(
      <div className="flex flex-col h-screen bg-bg-surface">
        <RepoTabs
          repos={[{ path: '/test/repo', name: 'repo', isLoading: false } as any]}
          activeIdx={0}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
          onReorder={vi.fn()}
          sidebarOpen={false}
          onToggleSidebar={vi.fn()}
          detailsOpen={false}
          onToggleDetails={vi.fn()}
        />
        <div className="flex-1 flex overflow-hidden relative">
          <main className="relative flex-1 min-h-0 bg-bg-base rounded-tl-xl rounded-tr-xl">
            <div data-testid="content">Contenido</div>
          </main>
        </div>
      </div>
    );

    const sidebarToggle = screen.getByRole('button', { name: 'toolbar.showSidebar' });
    expect(sidebarToggle.getAttribute('aria-pressed')).toBe('false');

    const main = container.querySelector('main');
    expect(main?.className).toContain('bg-bg-base');
    expect(main?.className).toContain('rounded-tl-xl');
    expect(main?.className).toContain('rounded-tr-xl');
    expect(main?.className).not.toContain('border-t');
  });

  it('los componentes del armazón no declaran líneas de borde de maqueta', () => {
    const { container } = render(
      <div className="flex flex-col h-screen bg-bg-surface">
        <RepoTabs
          repos={[{ path: '/test/repo', name: 'repo', isLoading: false } as any]}
          activeIdx={0}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onOpen={vi.fn()}
          onReorder={vi.fn()}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          detailsOpen={true}
          onToggleDetails={vi.fn()}
        />
        <div className="flex-1 flex overflow-hidden relative">
          <RepoSidebar
            graphMode="chronometric"
            sidebarW={280}
            sidebarOpen={true}
            isDragging={false}
            onResizeStart={vi.fn()}
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
            onAddRemoteRequest={vi.fn()}
            onRenameRemoteRequest={vi.fn()}
            onSetRemoteUrlRequest={vi.fn()}
            onDeleteRemoteRequest={vi.fn()}
            onAddWorktreeRequest={vi.fn()}
            onDeleteWorktreeRequest={vi.fn()}
            onAddSubmoduleRequest={vi.fn()}
            onUpdateSubmodule={vi.fn()}
            onSyncSubmodules={vi.fn()}
          />
          <main className="relative flex-1 min-h-0 bg-bg-base rounded-tl-xl rounded-tr-xl">
            <div data-testid="content">Contenido</div>
          </main>
          <RepoDetailsPanel
            graphMode="chronometric"
            detailsW={320}
            visible={true}
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
      </div>
    );

    const titlebar = container.querySelector('.app-titlebar');
    expect(titlebar?.className).not.toContain('border-b');

    const asides = container.querySelectorAll('aside');
    expect(asides.length).toBe(2);
    expect(asides[0].className).not.toContain('border-r');
    expect(asides[1].className).not.toContain('border-l');

    const main = container.querySelector('main');
    expect(main?.className).not.toContain('border-t');

    // Interior del panel derecho y centro de SDD: no declaran líneas divisorias ni bordes de maqueta
    const rightPanelInterior = asides[1].querySelectorAll('*');
    for (const el of Array.from(rightPanelInterior)) {
      const cls = el.className;
      if (typeof cls === 'string') {
        expect(cls).not.toContain('divide-y');
        expect(cls).not.toContain('divide-border-subtle');
        expect(cls).not.toContain('border-b border-border-subtle');
      }
    }

    const sddCenterInterior = main ? main.querySelectorAll('*') : [];
    for (const el of Array.from(sddCenterInterior)) {
      const cls = el.className;
      if (typeof cls === 'string') {
        expect(cls).not.toContain('divide-y');
        expect(cls).not.toContain('divide-border-subtle');
        expect(cls).not.toContain('border-b border-border-subtle');
      }
    }

    // Interior del centro de SDD (OpenSpecDashboard): no declara líneas divisorias ni bordes de maqueta
    const sddSnapshot: PipelineSnapshot = {
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
      diffs: [],
      openSpec: {
        selectedChangeId: 'change-1',
        activeChanges: [
          {
            changeId: 'change-1',
            status: { schemaName: 'spec-driven', isComplete: false, isPlanningComplete: true, artifacts: [] },
            tasks: [{ id: '1', line: 10, text: 'Task 1', completed: false }],
          } as any,
        ],
        archivedChanges: [],
        specifications: [],
        reports: [],
        diagnostics: [],
        observedAt: '2026-08-24T12:00:00Z',
        latestGate: null,
      },
    };

    usePipelineStore.setState({ selectedChangeId: 'change-1' });

    const { container: sddContainer } = render(
      <OpenSpecDashboard
        snapshot={sddSnapshot}
        repoPath="/test/repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />
    );

    const enterBtn = screen.getByRole('button', { name: /openspec\.start\.(enter|openBranch)|Entrar|Abrir/i });
    expect(enterBtn).toBeTruthy();
    fireEvent.click(enterBtn);

    const sddMain = sddContainer.querySelector('main');
    const sddCenterInteriorNodes = sddMain ? sddMain.querySelectorAll('*') : [];
    for (const el of Array.from(sddCenterInteriorNodes)) {
      const cls = el.className;
      if (typeof cls === 'string') {
        expect(cls).not.toContain('divide-y');
        expect(cls).not.toContain('divide-border-subtle');
        expect(cls).not.toContain('border-b border-border-subtle');
      }
    }
  });

  it('el contenedor del grafo en RepoMainView lleva bg-bg-base en modo cronométrico', () => {
    const tabViews: any = {
      activeTab: 'Graph',
      repoPath: '/test/repo',
      commits: [],
      selectedCommit: null,
      filterText: '',
      modifiedFiles: [],
      hasGithubUser: false,
      isLoading: false,
      pipelineLayout: {
        leftOpen: true,
        rightOpen: true,
        leftWidth: 240,
        rightWidth: 320,
        onResizeLeft: vi.fn(),
        onResizeRight: vi.fn(),
      },
      onSelectCommit: vi.fn(),
      onCommitContextMenu: vi.fn(),
    };

    const graphView: any = {
      graphMode: 'chronometric',
      activeGraphMode: 'chronometric',
      isDragging: false,
      isStartupGraphReady: true,
      sidebarOpen: true,
      sidebarW: 240,
      repositoryDetailsVisible: true,
      detailsW: 320,
      graphColumns: { refs: 260, graph: 88, date: 80, hash: 64 },
      beginGraphColDrag: vi.fn(),
      enableCronometric: true,
      speculativeBranches: [],
      selectedBranchName: null,
      selectedBranchFocusRequest: 0,
      showSpeculative: false,
      leftGraphSafe: 0,
      rightGraphSafe: 0,
      branches: [],
      isAnyContextMenuOpen: false,
      onChangeGraphMode: vi.fn(),
      onToggleSpeculative: vi.fn(),
      onClearGraphSelection: vi.fn(),
    };

    render(
      <RepoMainView
        activeView="repository"
        isRepoStartView={false}
        cartographyActive={false}
        cartographyRepoPath={null}
        onExitCartography={vi.fn()}
        settingsPanel={{} as any}
        helpPanel={{} as any}
        profilePanel={{} as any}
        repoStart={{} as any}
        diffViews={{ selectedFile: null } as any}
        tabViews={tabViews}
        graphView={graphView}
        interactiveRebase={{} as any}
      />
    );

    const graphContainer = screen.getByTestId('graph-tab-container');
    expect(graphContainer).not.toBeNull();
    expect(graphContainer.className).toContain('bg-bg-base');
  });

  it('RepoMainView en modo clásico no declara border-b en el header de columnas', () => {
    const tabViews: any = {
      activeTab: 'Graph',
      repoPath: '/test/repo',
      commits: [],
      selectedCommit: null,
      filterText: '',
      modifiedFiles: [],
      hasGithubUser: false,
      isLoading: false,
      pipelineLayout: {
        leftOpen: true,
        rightOpen: true,
        leftWidth: 240,
        rightWidth: 320,
        onResizeLeft: vi.fn(),
        onResizeRight: vi.fn(),
      },
      onSelectCommit: vi.fn(),
      onCommitContextMenu: vi.fn(),
    };

    const graphView: any = {
      graphMode: 'classic',
      activeGraphMode: 'classic',
      isDragging: false,
      isStartupGraphReady: true,
      sidebarOpen: true,
      sidebarW: 240,
      repositoryDetailsVisible: true,
      detailsW: 320,
      graphColumns: { refs: 260, graph: 88, date: 80, hash: 64 },
      beginGraphColDrag: vi.fn(),
      enableCronometric: false,
      speculativeBranches: [],
      selectedBranchName: null,
      selectedBranchFocusRequest: 0,
      showSpeculative: false,
      leftGraphSafe: 0,
      rightGraphSafe: 0,
      branches: [],
      isAnyContextMenuOpen: false,
      onChangeGraphMode: vi.fn(),
      onToggleSpeculative: vi.fn(),
      onClearGraphSelection: vi.fn(),
    };

    const { container } = render(
      <RepoMainView
        activeView="repository"
        isRepoStartView={false}
        cartographyActive={false}
        cartographyRepoPath={null}
        onExitCartography={vi.fn()}
        settingsPanel={{} as any}
        helpPanel={{} as any}
        profilePanel={{} as any}
        repoStart={{} as any}
        diffViews={{ selectedFile: null } as any}
        tabViews={tabViews}
        graphView={graphView}
        interactiveRebase={{} as any}
      />
    );

    const allSticky = container.querySelectorAll('.sticky.top-0');
    const columnHeaders = allSticky[allSticky.length - 1];
    expect(columnHeaders).not.toBeNull();
    expect(columnHeaders?.className).not.toContain('border-b');
  });

  it('HistoryView no declara border-b en su encabezado', () => {
    const tabViews: any = {
      activeTab: 'History',
      repoPath: '/test/repo',
      commits: [],
      selectedCommit: null,
      filterText: '',
      modifiedFiles: [],
      hasGithubUser: false,
      isLoading: false,
      pipelineLayout: {
        leftOpen: true,
        rightOpen: true,
        leftWidth: 240,
        rightWidth: 320,
        onResizeLeft: vi.fn(),
        onResizeRight: vi.fn(),
      },
      onSelectCommit: vi.fn(),
      onCommitContextMenu: vi.fn(),
    };

    const { container } = render(
      <RepoMainView
        activeView="repository"
        isRepoStartView={false}
        cartographyActive={false}
        cartographyRepoPath={null}
        onExitCartography={vi.fn()}
        settingsPanel={{} as any}
        helpPanel={{} as any}
        profilePanel={{} as any}
        repoStart={{} as any}
        diffViews={{ selectedFile: null } as any}
        tabViews={tabViews}
        graphView={{} as any}
        interactiveRebase={{} as any}
      />
    );

    const historyHeader = container.querySelector('.sticky.top-0');
    expect(historyHeader).not.toBeNull();
    expect(historyHeader?.className).not.toContain('border-b');
  });

  it('BlameView no declara border-b en su encabezado', () => {
    const diffViews: any = {
      selectedFile: null,
      blameFile: { path: 'file.ts', staged: false, status: 'modified' },
      blameLines: [],
      blameLoading: false,
      selectedBlameLineNo: null,
      onCloseDiff: vi.fn(),
      onSelectBlameLine: vi.fn(),
    };

    const { container } = render(
      <RepoMainView
        activeView="repository"
        isRepoStartView={false}
        cartographyActive={false}
        cartographyRepoPath={null}
        onExitCartography={vi.fn()}
        settingsPanel={{} as any}
        helpPanel={{} as any}
        profilePanel={{} as any}
        repoStart={{} as any}
        diffViews={diffViews}
        tabViews={{ activeTab: 'Graph' } as any}
        graphView={{} as any}
        interactiveRebase={{} as any}
      />
    );

    const blameHeader = container.querySelector('[data-testid="content-header"]');
    expect(blameHeader).not.toBeNull();
    expect(blameHeader?.className).not.toContain('border-b');
  });

  it('RepoStartView en RepoMainView no declara bordes de maqueta en su cabecera', () => {
    const { container } = render(
      <RepoMainView
        activeView="repository"
        isRepoStartView={true}
        cartographyActive={false}
        cartographyRepoPath={null}
        onExitCartography={vi.fn()}
        settingsPanel={{} as any}
        helpPanel={{} as any}
        profilePanel={{} as any}
        repoStart={{
          mode: 'open',
          repoPath: '/test/repo',
          githubConnected: false,
          isLoading: false,
          onClose: vi.fn(),
          onOpenExisting: vi.fn(),
          onPickCreateFolder: vi.fn(),
          onPickCloneFolder: vi.fn(),
          onCreate: vi.fn(),
          onClone: vi.fn(),
          onListRepos: vi.fn(),
          onConnectGitHub: vi.fn(),
        }}
        diffViews={{ selectedFile: null } as any}
        tabViews={{ activeTab: 'Graph', repoPath: '/test/repo', commits: [] } as any}
        graphView={{} as any}
        interactiveRebase={{} as any}
      />
    );

    const backButton = screen.getByRole('button', { name: 'common.backToRepo' });
    expect(backButton.className).not.toContain('border');
    const headerContainer = backButton.closest('.shrink-0');
    expect(headerContainer?.className).not.toContain('border-b');
  });
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
    activeChanges: [
      {
        changeId: 'change-auth-flow',
        validation: 'passed',
        tasks: [
          { id: '2.1', text: 'Task 2.1', completed: true, line: 1, sourceRef: 'tasks.md:1' },
          { id: '2.2', text: 'Task 2.2', completed: false, line: 2, sourceRef: 'tasks.md:2' },
        ],
        proposalExists: true,
        designExists: true,
        specsCount: 1,
        artifacts: { proposal: null, design: null, tasks: null, specs: [] },
        intent: 'Unify auth tokens',
      },
    ],
    archivedChanges: [
      {
        changeId: 'change-login-v1',
        sourceRef: 'openspec/changes/archive/change-login-v1',
        archivedAt: '2026-08-20',
      },
    ],
    specifications: [
      {
        specificationId: 'auth-tokens',
        sourceRef: 'specs/auth-tokens/spec.md',
        requirements: 5,
      },
    ],
    reports: [],
    diagnostics: [],
    observedAt: null,
    latestGate: null,
  },
};

describe('Compartir paneles laterales entre vistas (Fase 3 & fundición de laterales)', () => {
  it('1. El marco derecho monta la pieza común RepoDetailsPanel tanto en Graph como en SDD', () => {
    // Render en Graph
    const { container, rerender } = render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    const asideGraph = container.querySelector('aside');
    expect(asideGraph).not.toBeNull();
    expect(asideGraph?.getAttribute('data-testid')).toBe('repo-details-panel');

    // Rerender en SDD (Pipeline)
    rerender(
      <RepoDetailsPanel
        activeTab="Pipeline"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    const asidePipeline = container.querySelector('aside');
    expect(asidePipeline).not.toBeNull();
    expect(asidePipeline?.getAttribute('data-testid')).toBe('repo-details-panel');
  });

  it('2. En Graph muestra detalle de commit / preparación y en SDD muestra inspector con rail / herramientas', () => {
    // En Graph: muestra sección de staging / commit o mensaje vacío
    const { rerender } = render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    expect(screen.getByText('staging.unstagedTitle')).toBeDefined();
    expect(screen.queryByText('pipeline.openspec.activity.title')).toBeNull();

    // En SDD: monta OpenSpecInspector con secciones de Actividad y Herramientas
    rerender(
      <RepoDetailsPanel
        activeTab="Pipeline"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    expect(screen.getByText('pipeline.openspec.activity.title')).toBeDefined();
    expect(screen.getByText('pipeline.openspec.rail.tools')).toBeDefined();
  });

  it('3. detailsOpen: false oculta el panel derecho en AMBAS vistas con rerender real', () => {
    const { container, rerender } = render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={false}
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
    );

    // En Graph con visible=false, se oculta (width: 0, visibility: hidden)
    const asideGraph = container.querySelector('aside');
    expect(asideGraph).not.toBeNull();
    expect(asideGraph?.style.visibility).toBe('hidden');
    expect(asideGraph?.style.width).toBe('0px');

    // En SDD con visible=false, también se oculta
    rerender(
      <RepoDetailsPanel
        activeTab="Pipeline"
        graphMode="chronometric"
        detailsW={320}
        visible={false}
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
    );

    const asidePipeline = container.querySelector('aside');
    expect(asidePipeline).not.toBeNull();
    expect(asidePipeline?.style.visibility).toBe('hidden');
    expect(asidePipeline?.style.width).toBe('0px');
  });

  it('4. El botón de la barra de título de la ventana conmuta el panel en ambas vistas', () => {
    const onToggleDetails = vi.fn();
    const { rerender } = render(
      <RepoTabs
        repos={[{ path: '/test/repo', name: 'repo', isLoading: false } as any]}
        activeIdx={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onReorder={vi.fn()}
        sidebarOpen={true}
        onToggleSidebar={vi.fn()}
        detailsOpen={true}
        onToggleDetails={onToggleDetails}
      />
    );

    const toggleBtn = screen.getByRole('button', { name: 'toolbar.hideDetails' });
    fireEvent.click(toggleBtn);
    expect(onToggleDetails).toHaveBeenCalledTimes(1);

    // Al estar cerrado
    rerender(
      <RepoTabs
        repos={[{ path: '/test/repo', name: 'repo', isLoading: false } as any]}
        activeIdx={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onReorder={vi.fn()}
        sidebarOpen={true}
        onToggleSidebar={vi.fn()}
        detailsOpen={false}
        onToggleDetails={onToggleDetails}
      />
    );

    const showBtn = screen.getByRole('button', { name: 'toolbar.showDetails' });
    fireEvent.click(showBtn);
    expect(onToggleDetails).toHaveBeenCalledTimes(2);
  });

  it('5. En SDD (Pipeline), el panel lateral RepoSidebar muestra las secciones de ramas/referencias igual que en Graph (4.11)', () => {
    const { container } = render(
      <RepoSidebar
        activeTab="Pipeline"
        graphMode="classic"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
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
        onAddRemoteRequest={vi.fn()}
        onRenameRemoteRequest={vi.fn()}
        onSetRemoteUrlRequest={vi.fn()}
        onDeleteRemoteRequest={vi.fn()}
        onAddWorktreeRequest={vi.fn()}
        onDeleteWorktreeRequest={vi.fn()}
        onAddSubmoduleRequest={vi.fn()}
        onUpdateSubmodule={vi.fn()}
        onSyncSubmodules={vi.fn()}
      />
    );

    // Ya no contiene el contenedor de navegación de OpenSpec (4.11)
    const sddNav = container.querySelector('[data-testid="openspec-sidebar-nav"]');
    expect(sddNav).toBeNull();
    // Contiene el contenedor de ramas/referencias clásicas igual que Graph
    const graphNav = container.querySelector('[data-testid="sidebar-branches-sections"]');
    expect(graphNav).not.toBeNull();
  });

  it('6. En Graph, el panel lateral RepoSidebar muestra las secciones de ramas/referencias', () => {
    const { container } = render(
      <RepoSidebar
        activeTab="Graph"
        graphMode="chronometric"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
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
        onAddRemoteRequest={vi.fn()}
        onRenameRemoteRequest={vi.fn()}
        onSetRemoteUrlRequest={vi.fn()}
        onDeleteRemoteRequest={vi.fn()}
        onAddWorktreeRequest={vi.fn()}
        onDeleteWorktreeRequest={vi.fn()}
        onAddSubmoduleRequest={vi.fn()}
        onUpdateSubmodule={vi.fn()}
        onSyncSubmodules={vi.fn()}
      />
    );

    // Debe contener el contenedor de ramas/referencias clásicas
    const graphNav = container.querySelector('[data-testid="sidebar-branches-sections"]');
    expect(graphNav).not.toBeNull();
    // No debe contener el contenedor de navegación de OpenSpec
    const sddNav = container.querySelector('[data-testid="openspec-sidebar-nav"]');
    expect(sddNav).toBeNull();
  });

  it('7. En AMBAS vistas, el lateral preserva el selector de vistas, la rama actual y la fila de 5 acciones (Pull, Push, etc.)', () => {
    const { rerender } = render(
      <RepoSidebar
        activeTab="Graph"
        graphMode="chronometric"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
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
        onAddRemoteRequest={vi.fn()}
        onRenameRemoteRequest={vi.fn()}
        onSetRemoteUrlRequest={vi.fn()}
        onDeleteRemoteRequest={vi.fn()}
        onAddWorktreeRequest={vi.fn()}
        onDeleteWorktreeRequest={vi.fn()}
        onAddSubmoduleRequest={vi.fn()}
        onUpdateSubmodule={vi.fn()}
        onSyncSubmodules={vi.fn()}
      />
    );

    // Graph view: actions are present
    expect(screen.getByRole('button', { name: 'toolbar.pull' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'toolbar.push' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'toolbar.newBranch' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'toolbar.stash' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'toolbar.applyPatchTooltip' })).toBeDefined();

    // SDD view (Pipeline): actions MUST remain present
    rerender(
      <RepoSidebar
        activeTab="Pipeline"
        graphMode="chronometric"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
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
        onAddRemoteRequest={vi.fn()}
        onRenameRemoteRequest={vi.fn()}
        onSetRemoteUrlRequest={vi.fn()}
        onDeleteRemoteRequest={vi.fn()}
        onAddWorktreeRequest={vi.fn()}
        onDeleteWorktreeRequest={vi.fn()}
        onAddSubmoduleRequest={vi.fn()}
        onUpdateSubmodule={vi.fn()}
        onSyncSubmodules={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'toolbar.pull' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'toolbar.push' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'toolbar.newBranch' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'toolbar.stash' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'toolbar.applyPatchTooltip' })).toBeDefined();
  });

  it('8. El cuerpo de SDD (OpenSpecDashboard) contiene exactamente 0 elementos aside', () => {
    const { container } = render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="/test/repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />
    );

    const asides = container.querySelectorAll('aside');
    expect(asides.length).toBe(0);
  });

  it('9. La resolución de estado de sesión resuelve a textos traducidos reales para todos los estados posibles y nunca a la clave cruda', async () => {
    const { translate } = await import('@/lib/i18n');
    const { SESSION_STATUS_KEYS, resolveSessionStatusI18nKey } = await import('../pipeline/pipeline-domain');
    const langs = ['es', 'en', 'zh'] as const;

    for (const lang of langs) {
      for (const status of SESSION_STATUS_KEYS) {
        const key = resolveSessionStatusI18nKey(status);
        const text = translate(key, lang);
        expect(text).toBeTruthy();
        expect(text).not.toBe(key);
        expect(text).not.toBe(status);
        expect(text).not.toContain('pipeline.openspec.activity.status');
      }

      // Probar fallback de estado desconocido o no mapeado
      const fallbackKey = resolveSessionStatusI18nKey('unrecognized_state');
      const fallbackText = translate(fallbackKey, lang);
      expect(fallbackText).toBeTruthy();
      expect(fallbackText).not.toBe(fallbackKey);
      expect(fallbackText).not.toBe('unrecognized_state');
      expect(fallbackText).not.toContain('pipeline.openspec.activity.status');
    }
  });

  it('10. Los contadores en el cuerpo se retiraron y el porcentaje se presenta visible en el lateral con clases de utilidad', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssPath = path.resolve(__dirname, '../pipeline/OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // La hoja de estilos ya no contiene reglas de summaryFacts ni evidenceStrip por haber quedado sin consumidor
    expect(cssContent).not.toMatch(/\.summaryFacts/);
    expect(cssContent).not.toMatch(/\.evidenceStrip/);

    const { container } = render(
      <OpenSpecDashboard
        snapshot={dummySnapshot}
        repoPath="/test/repo"
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />,
    );

    // Los contadores del cuerpo ya no se montan
    const factsDl = container.querySelector('dl[class*="summaryFacts"]');
    expect(factsDl).toBeNull();
  });

  it('11. El valor de rightOpen que llega al cuerpo de SDD es el del armazón (pipelineLayout.rightOpen): en falso el aviso de autoría se presenta en el centro y en verdadero no', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const pageSrc = fs.readFileSync(path.resolve(__dirname, '../../app/page.tsx'), 'utf-8');

    // Guarda del cableado de app/page.tsx: el único salto que la parte de DOM
    // de esta misma prueba no alcanza —porque construye tabViews a mano—.
    // No es una prueba de comportamiento y asegura que app/page.tsx conecte
    // rightOpen a repositoryDetailsVisible dentro de pipelineLayout.
    const pipelineLayoutMatch = /pipelineLayout:\s*\{((?:[^{}]|\{[^{}]*\})+)\}/.exec(pageSrc);
    expect(pipelineLayoutMatch).not.toBeNull();
    expect(pipelineLayoutMatch![1]).toMatch(/rightOpen:\s*repositoryDetailsVisible/);

    const originalApi = (window as any).api;
    const dummyPipelineState = {
      repoId: 'repo-1',
      observedAt: '2026-07-25T00:00:00.000Z',
      revision: 1,
      tasks: [],
      reports: [],
      decisions: [],
      activeChanges: ['change-auth-flow'],
      archivedChanges: [],
      mergedChanges: [],
      diagnostics: [],
      selection: { changeId: 'change-auth-flow', confidence: 'confirmed', selectionRequired: false, reason: '' },
      openSpecPresent: true,
      openSpecChanges: [
        {
          changeId: 'change-auth-flow',
          intent: 'Auth flow',
          tasks: [{ id: '1', text: 'T1', completed: false, line: 1, sourceRef: 'tasks.md' }],
          proposalExists: true,
          designExists: true,
          specsCount: 1,
          validation: 'passed',
          artifacts: null,
        },
      ],
    };
    (window as any).api = {
      pipelineGetSnapshot: vi.fn().mockResolvedValue({ success: true, data: dummyPipelineState }),
      pipelineOpenSpec: {
        getEngineStatus: vi.fn().mockResolvedValue({
          cli: { installed: true, runtimeVersion: '1.8.0', diagnostics: [] },
          repoState: 'initialized',
          integrationState: 'up-to-date',
        }),
      },
      pipelineSubscribe: vi.fn(),
      pipelineUnsubscribe: vi.fn(),
      onPipelineSnapshotUpdated: vi.fn(),
      pipelineRuntime: {
        get: vi.fn().mockResolvedValue({ success: true, data: null }),
        history: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
    };

    try {
      // 2. Verificación del DOM montado a través de RepoMainView
      useGitStore.setState({
        modifiedFiles: [{ path: 'file.ts', status: 'modified', staged: false }],
      });
      usePipelineStore.setState({
        snapshot: dummySnapshot,
        prepareOpen: true,
        aiNotice: 'Escrito por modelo Gemma 4',
      });

      const createTabViews = (rightOpen: boolean): any => ({
        activeTab: 'Pipeline',
        repoPath: '/test/repo',
        commits: [],
        selectedCommit: null,
        filterText: '',
        modifiedFiles: [{ path: 'file.ts', status: 'modified', staged: false }],
        hasGithubUser: false,
        isLoading: false,
        currentBranch: 'main',
        pipelineLayout: {
          rightOpen,
          onEnsureRightOpen: vi.fn(),
        },
        onSelectCommit: vi.fn(),
        onCommitContextMenu: vi.fn(),
      });

      // Caso A: con rightOpen en false, el aviso de autoría se presenta en el centro del DOM
      const { unmount } = render(
        <RepoMainView
          activeView="repository"
          isRepoStartView={false}
          cartographyActive={false}
          cartographyRepoPath={null}
          onExitCartography={vi.fn()}
          settingsPanel={{} as any}
          helpPanel={{} as any}
          profilePanel={{} as any}
          repoStart={{} as any}
          diffViews={{ selectedFile: null } as any}
          tabViews={createTabViews(false)}
          graphView={{} as any}
          interactiveRebase={{} as any}
        />
      );

      expect(await screen.findByText('Escrito por modelo Gemma 4')).toBeTruthy();

      unmount();

      // Caso B: con rightOpen en true, el aviso de autoría NO se presenta en el centro del DOM
      usePipelineStore.setState({
        prepareOpen: true,
      });
      render(
        <RepoMainView
          activeView="repository"
          isRepoStartView={false}
          cartographyActive={false}
          cartographyRepoPath={null}
          onExitCartography={vi.fn()}
          settingsPanel={{} as any}
          helpPanel={{} as any}
          profilePanel={{} as any}
          repoStart={{} as any}
          diffViews={{ selectedFile: null } as any}
          tabViews={createTabViews(true)}
          graphView={{} as any}
          interactiveRebase={{} as any}
        />
      );

      // Esperar que termine de cargar el workspace
      await screen.findByRole('region', { name: 'pipeline.openspec.prepare.title' });
      expect(screen.queryByText('Escrito por modelo Gemma 4')).toBeNull();
    } finally {
      (window as any).api = originalApi;
    }
  });
});

describe('Fase 4 · Rediseño del panel derecho como lista de secciones plegables', () => {
  it('1. Que la pieza que se monta en el panel derecho sea SidebarSection (misma aria-expanded y estructura que en el lateral)', () => {
    useGitStore.setState({
      repoPath: 'C:/test-sidebar-section',
      modifiedFiles: [{ path: 'mod.ts', status: 'modified', staged: false }],
      selectedCommit: null,
    });

    const { container } = render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    // SidebarSection monta botones con aria-expanded para cada sección plegable
    const sectionButtons = container.querySelectorAll('button[aria-expanded]');
    expect(sectionButtons.length).toBeGreaterThanOrEqual(1);
    const unstagedButton = screen.getByRole('button', { name: /staging\.unstagedTitle/ });
    expect(unstagedButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('2. Que colapsar y expandir secciones del panel derecho persiste entre desmontajes', () => {
    const repo = 'C:/test-persist-sections';
    window.localStorage.removeItem(`gitcron:sidebarSections:${repo}`);

    useGitStore.setState({
      repoPath: repo,
      modifiedFiles: [{ path: 'mod.ts', status: 'modified', staged: false }],
      selectedCommit: null,
    });

    const { unmount } = render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    // Abierta por omisión
    const btn = screen.getByRole('button', { name: /staging\.unstagedTitle/ });
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    // Colapsar
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    // Desmontar y volver a montar
    unmount();

    render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    const btnRemounted = screen.getByRole('button', { name: /staging\.unstagedTitle/ });
    expect(btnRemounted.getAttribute('aria-expanded')).toBe('false');
  });

  it('3. Que la composición de secciones por circunstancia coincide con la especificación en ambas vistas', () => {
    // 3.1 Grafo sin commit
    usePipelineStore.setState({ prepareOpen: false });
    useGitStore.setState({
      repoPath: 'C:/spec-repo',
      selectedCommit: null,
      modifiedFiles: [{ path: 'f.ts', status: 'modified', staged: false }],
    });
    const { rerender } = render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    expect(screen.getByText('staging.unstagedTitle')).toBeDefined();
    expect(screen.getByText('staging.stagedTitle')).toBeDefined();
    expect(screen.getByText('staging.commitSectionTitle')).toBeDefined();
    expect(screen.queryByText('commit.filesSectionTitle')).toBeNull();
    expect(screen.queryByText('pipeline.openspec.activity.title')).toBeNull();

    // 3.2 Grafo con commit
    useGitStore.setState({
      selectedCommit: {
        hash: '1234567890',
        shortHash: '1234567',
        message: 'c1',
        authorName: 'A',
        authorEmail: 'a@a.com',
        date: '2026-08-22T00:00:00Z',
        parents: [],
        refs: [],
      },
      modifiedFiles: [{ path: 'live.ts', status: 'modified', staged: false }],
    });
    rerender(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    expect(screen.getAllByText('commit.detailsTitle').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('commit.filesSectionTitle')).toBeDefined();
    expect(screen.getByText('commit.worktreeSectionTitle')).toBeDefined();
    expect(screen.getByText('staging.commitSectionTitle')).toBeDefined();
    expect(screen.queryByText('staging.unstagedTitle')).toBeNull();

    // 3.3 SDD sin preparar
    useGitStore.setState({ selectedCommit: null });
    usePipelineStore.setState({ prepareOpen: false });
    rerender(
      <RepoDetailsPanel
        activeTab="Pipeline"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    expect(screen.getByText('pipeline.openspec.activity.title')).toBeDefined();
    expect(screen.getByText('pipeline.openspec.attention.title')).toBeDefined();
    expect(screen.getByText('pipeline.openspec.rail.tools')).toBeDefined();
    expect(screen.getByText('staging.unstagedTitle')).toBeDefined();
    expect(screen.getByText('staging.stagedTitle')).toBeDefined();
    expect(screen.getByText('staging.commitSectionTitle')).toBeDefined();
    expect(screen.queryByText('commit.detailsTitle')).toBeNull();

    // 3.4 SDD preparando
    usePipelineStore.setState({ prepareOpen: true });
    rerender(
      <RepoDetailsPanel
        activeTab="Pipeline"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    expect(screen.getByText('pipeline.openspec.activity.title')).toBeDefined();
    expect(screen.getByText('pipeline.openspec.attention.title')).toBeDefined();
    expect(screen.getByText('pipeline.openspec.rail.tools')).toBeDefined();
    expect(screen.getByText('staging.unstagedTitle')).toBeDefined();
    expect(screen.getByText('staging.stagedTitle')).toBeDefined();
    expect(screen.getByText('staging.commitSectionTitle')).toBeDefined();
    expect(screen.queryByText('commit.detailsTitle')).toBeNull();
  });

  it('4. Que la migración desde un array viejo ([\'local\', \'remoto\']) en localStorage funciona y persiste como Record', () => {
    const repo = 'C:/mig-repo-test';
    window.localStorage.setItem(`gitcron:sidebarSections:${repo}`, JSON.stringify(['local', 'remoto']));

    const { result } = renderHook(() => useSidebarSectionState(repo));

    expect(result.current.isOpen('local')).toBe(true);
    expect(result.current.isOpen('remoto')).toBe(true);
    expect(result.current.isOpen('otro')).toBe(false);

    act(() => {
      result.current.toggle('otro');
    });

    expect(result.current.isOpen('otro')).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem(`gitcron:sidebarSections:${repo}`) || '{}');
    expect(stored).toEqual({ local: true, remoto: true, otro: true });
  });

  it('5. Que useSidebarSectionState sin defaults se comporta igual que antes: todo cerrado por omisión', () => {
    const repo = 'C:/clean-defaults-repo';
    window.localStorage.removeItem(`gitcron:sidebarSections:${repo}`);

    const { result } = renderHook(() => useSidebarSectionState(repo));

    expect(result.current.isOpen('details-unstaged')).toBe(false);
    expect(result.current.isOpen('local')).toBe(false);
    expect(result.current.isOpen('remoto')).toBe(false);
  });

  it('6. Que la sección de herramientas se gobierna únicamente con sectionState (4.10: un solo clic en el encabezado la cierra)', () => {
    const repo = 'C:/tools-single-source-repo';
    window.localStorage.removeItem(`gitcron:sidebarSections:${repo}`);

    useGitStore.setState({ repoPath: repo });

    const { rerender } = render(<OpenSpecInspector repoPath={repo} />);

    // Por omisión, details-tools está cerrada
    const toolsBtn = screen.getByRole('button', { name: /pipeline\.openspec\.rail\.tools/ });
    expect(toolsBtn.getAttribute('aria-expanded')).toBe('false');

    // Se simula la acción del aviso del centro "Abrir herramientas"
    act(() => {
      openSidebarSection(repo, 'details-tools');
    });

    rerender(<OpenSpecInspector repoPath={repo} />);
    expect(toolsBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'pipeline.openspec.config.open' })).toBeDefined();
    expect(screen.getByText('pipeline.openspec.config.statusLine')).toBeDefined();

    // El primer clic en el encabezado DEBE cerrarla inmediatamente (sin estado paralelo)
    fireEvent.click(toolsBtn);
    expect(toolsBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('7. Que el encabezado de SidebarSection presenta el ícono antes del título y el control de plegado después (4.15)', () => {
    const { container } = render(
      <SidebarSection
        title="Sección de prueba"
        icon={<span data-testid="custom-section-icon">ICON</span>}
      >
        <div>Contenido</div>
      </SidebarSection>
    );

    const toggleButton = screen.getByRole('button', { name: /Sección de prueba/ });
    const children = Array.from(toggleButton.children);
    expect(children.length).toBe(3);

    // 1. Ícono
    expect(children[0].querySelector('[data-testid="custom-section-icon"]')).not.toBeNull();
    // 2. Título
    expect(children[1].textContent).toBe('Sección de prueba');
    // 3. Control de plegado (ChevronRight)
    expect(children[2].tagName.toLowerCase()).toBe('svg');

    // Espacio flexible inmediatamente después del botón en el contenedor del encabezado
    const headerContainer = toggleButton.parentElement;
    expect(headerContainer?.children[1]?.className).toContain('flex-1');
  });

  it('8. Que ninguna de las veintiuna secciones queda sin ícono y ningún ícono de sección declara clase de color (4.15)', () => {
    const repo = 'C:/all-sections-repo';
    useGitStore.setState({
      repoPath: repo,
      branches: ['main'],
      remoteBranches: ['origin/main'],
      githubUser: { login: 'octocat' } as any,
      pullRequests: [{ number: 1, title: 'PR 1', branch: 'feat', additions: 1, deletions: 0, draft: false, url: '' } as any],
      stashes: [{ index: 0, message: 'stash 0', date: '2026-08-24' } as any],
      tags: ['v1.0.0'],
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/test/repo', pushUrl: 'https://github.com/test/repo' }],
      worktrees: [{ path: 'C:/wt', branch: 'wt-branch' } as any],
      submodules: [{ name: 'sub', path: 'sub', url: 'https://github.com/test/sub' } as any],
      selectedCommit: {
        hash: '1234567890abcdef',
        shortHash: '1234567',
        message: 'commit msg',
        authorName: 'Ale',
        authorEmail: 'ale@example.com',
        date: '2026-08-24T12:00:00Z',
      } as any,
      modifiedFiles: [{ path: 'file1.ts', status: 'modified', staged: false }],
    });

    const mockSnapshot: PipelineSnapshot = {
      openSpec: {
        activeChanges: [{ changeId: 'change-1', intent: 'intent', tasks: [], proposalExists: true, designExists: true, specsCount: 1, validation: 'passed', artifacts: null, status: null } as any],
        archivedChanges: [{ changeId: 'change-archived', archivedAt: '2026-08-24' } as any],
        specifications: [{ specificationId: 'spec-1', sourceRef: 'ref', requirements: 1 }],
      } as any,
      decisions: [{ decisionId: 'dec-1', repoId: 'repo', changeId: 'change-1', title: 'dec', kind: 'clarification', status: 'pending', summary: 'sum', risk: 'low', riskReason: null, provenance: 'human', evidenceRefs: [], options: [], requestedAt: '2026-08-24' } as any],
    } as any;

    const { container: sidebarContainer } = render(
      <RepoSidebar
        graphMode="chronometric"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
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
    );

    const { container: detailsWithCommitContainer } = render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    useGitStore.setState({ selectedCommit: null });
    const { container: detailsStagingContainer } = render(
      <RepoDetailsPanel
        activeTab="Graph"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
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
    );

    const { container: inspectorContainer } = render(
      <OpenSpecInspector snapshot={mockSnapshot} />
    );

    const allContainers = [
      sidebarContainer,
      detailsWithCommitContainer,
      detailsStagingContainer,
      inspectorContainer,
    ];

    const forbiddenColorClasses = ['text-primary', 'text-secondary', 'text-git-mod', 'text-error', 'text-amber', 'text-cyan', 'text-blue', 'text-red', 'text-green', 'text-yellow'];

    let totalSectionHeadersFound = 0;
    const seenTitles = new Set<string>();

    for (const cnt of allContainers) {
      const headerButtons = cnt.querySelectorAll('button[aria-expanded]');
      for (const btn of Array.from(headerButtons)) {
        // Ignora botones que no sean encabezados de SidebarSection (por ejemplo changeToggle en lista interna)
        const iconSpan = btn.children[0];
        const titleSpan = btn.children[1];
        const chevronSvg = btn.children[2];

        if (!titleSpan || !chevronSvg || chevronSvg.tagName.toLowerCase() !== 'svg') continue;

        const titleText = titleSpan.textContent?.trim() || '';
        if (seenTitles.has(titleText)) continue;
        seenTitles.add(titleText);
        totalSectionHeadersFound++;

        // 1. Tiene ícono antes del título
        expect(iconSpan).toBeDefined();
        const iconSvg = iconSpan.querySelector('svg') || (iconSpan.tagName.toLowerCase() === 'svg' ? iconSpan : null);
        expect(iconSvg).not.toBeNull();

        // 2. Ningún ícono ni su contenedor declara clase de color propia
        const iconClass = (iconSvg as Element)?.getAttribute('class') || '';
        const iconSpanClass = iconSpan.getAttribute('class') || '';
        for (const forbidden of forbiddenColorClasses) {
          expect(iconClass).not.toContain(forbidden);
          expect(iconSpanClass).not.toContain(forbidden);
        }
      }
    }

    // Comprobamos que se cubrieron las 18 secciones únicas (21 menos las 3 de OpenSpecSidebarNav retiradas)
    expect(totalSectionHeadersFound).toBe(18);
  });

  it('9. Que las filas de primer nivel y el encabezado de sección declaran el mismo desplazamiento izquierdo (4.17)', () => {
    const repo = 'C:/alignment-repo';
    useGitStore.setState({
      repoPath: repo,
      branches: ['main', 'feature/login'],
      currentBranch: 'main',
      remoteBranches: [],
      branchTracking: {},
      stashes: [],
      tags: [],
      remotes: [],
      worktrees: [],
      submodules: [],
      pullRequests: [],
      githubUser: null,
      selectedCommit: null,
      modifiedFiles: [],
      isLoading: false,
    });

    openSidebarSection(repo, 'local');

    const { container } = render(
      <RepoSidebar
        graphMode="chronometric"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
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
    );

    // 1. Leer desplazamiento del encabezado de la sección 'local'
    const sectionToggle = screen.getByRole('button', { name: /sidebar\.local/ });
    const sectionHeaderDiv = sectionToggle.parentElement!;
    const headerClasses = sectionHeaderDiv.className.split(/\s+/);
    const headerPaddingLeft = headerClasses.find((c) => c.startsWith('pl-') || c.startsWith('px-'));
    expect(headerPaddingLeft).toBe('px-3'); // 12px

    // 2. Fila de rama raíz ('main'): tiene que declarar el mismo desplazamiento (12px)
    const mainBranchRow = screen.getByText('main').closest('div')!;
    const mainRowClasses = mainBranchRow.className.split(/\s+/);
    const mainRowPaddingLeft = mainRowClasses.find((c) => c.startsWith('pl-') || c.startsWith('px-'));
    expect(mainRowPaddingLeft).toBe('pl-3');
    // Ambos equivalen a 12px desde el borde izquierdo
    expect(mainRowPaddingLeft).toBe('pl-3');

    // 3. Botón de carpeta raíz ('feature'): tiene que declarar 12px
    const folderButton = screen.getByText('feature').closest('button')!;
    const folderClasses = folderButton.className.split(/\s+/);
    const folderPaddingLeft = folderClasses.find((c) => c.startsWith('pl-') || c.startsWith('px-'));
    expect(folderPaddingLeft).toBe('pl-3');

    // 4. Desplegar carpeta 'feature' y verificar el nivel anidado (32px = 12px + 20px escalón)
    fireEvent.click(folderButton);
    const nestedBranchRow = screen.getByText('login').closest('div')!;
    const nestedRowClasses = nestedBranchRow.className.split(/\s+/);
    const nestedRowPaddingLeft = nestedRowClasses.find((c) => c.startsWith('pl-') || c.startsWith('px-'));
    expect(nestedRowPaddingLeft).toBe('pl-8'); // 32px
  });

  it('10. Que el control de plegado está siempre visible y la fila del encabezado comparte las clases de hover de las acciones del lateral (4.18)', () => {
    const repo = 'C:/hover-classes-repo';
    useGitStore.setState({
      repoPath: repo,
      branches: ['main'],
      currentBranch: 'main',
      remoteBranches: [],
      branchTracking: {},
      stashes: [],
      tags: [],
      remotes: [],
      worktrees: [],
      submodules: [],
      pullRequests: [],
      githubUser: null,
      selectedCommit: null,
      modifiedFiles: [],
      isLoading: false,
    });

    render(
      <RepoSidebar
        graphMode="chronometric"
        sidebarW={280}
        sidebarOpen={true}
        isDragging={false}
        onResizeStart={vi.fn()}
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
    );

    // 1. El chevron está siempre visible (sin opacity-0 ni group-hover:opacity-100) y tiene transition-transform
    const localSectionToggle = screen.getByRole('button', { name: /sidebar\.local/ });
    const chevronSvg = localSectionToggle.children[2];
    expect(chevronSvg.tagName.toLowerCase()).toBe('svg');
    const chevronClasses = chevronSvg.getAttribute('class') || '';
    expect(chevronClasses).not.toContain('opacity-0');
    expect(chevronClasses).not.toContain('group-hover:opacity-100');
    expect(chevronClasses).toContain('transition-transform');

    // 2. La fila del encabezado y un botón de quickActions declaran las MISMAS clases de hover leídas dinámicamente del DOM
    const quickActionButton = screen.getByRole('button', { name: 'toolbar.pull' });
    const sectionHeaderDiv = localSectionToggle.parentElement!;

    const actionHoverClasses = quickActionButton.className
      .split(/\s+/)
      .filter((c) => c.startsWith('hover:'))
      .sort();
    const sectionHoverClasses = sectionHeaderDiv.className
      .split(/\s+/)
      .filter((c) => c.startsWith('hover:'))
      .sort();

    expect(sectionHoverClasses).toEqual(actionHoverClasses);
    expect(sectionHoverClasses).toContain('hover:bg-text-primary/10');
    expect(sectionHoverClasses).toContain('hover:text-text-primary');
  });

  it('11. Que apretar la insignia del motor abre la revisión en el centro y NO despliega el panel derecho (decisión 8.22)', async () => {
    const repo = 'C:/center-tools-btn-repo';
    window.localStorage.removeItem(`gitcron:sidebarSections:${repo}`);
    usePipelineStore.getState().reset();

    (window as any).api = {
      ...((window as any).api || {}),
      pipelineOpenSpec: {
        ...((window as any).api?.pipelineOpenSpec || {}),
        getEngineStatus: vi.fn().mockResolvedValue({
          version: '1.8.0',
          versionClass: 'supported',
          integrationState: 'outdated',
          repoState: 'ready',
          cli: {
            installed: true,
            runtimeVersion: '1.8.0',
            diagnostics: [],
          },
          divergence: { isDivergent: false, divergedFiles: [] },
        }),
        checkLatestVersion: vi.fn().mockResolvedValue(null),
      },
    };

    useGitStore.setState({
      repoPath: repo,
      currentBranch: 'main',
      branches: ['main'],
      remoteBranches: [],
      branchTracking: {},
      modifiedFiles: [],
      isLoading: false,
    });

    const onEnsureRightOpenMock = vi.fn();

    const mockSnapshotWithNotice: PipelineSnapshot = {
      schemaVersion: '1.0',
      repoId: 'repo-test',
      availableSources: ['git', 'runtime', 'openspec'],
      hasPipelineActivity: false,
      decisions: [],
      agents: [],
      activity: [],
      diffs: [],
      economy: { reasoningAvailable: null } as PipelineSnapshot['economy'],
      openSpec: {
        selectedChangeId: null,
        activeChanges: [],
        archivedChanges: [],
        specifications: [],
        reports: [],
        diagnostics: [],
        observedAt: '2026-08-25T08:00:00Z',
        latestGate: null,
        openSpecPresent: true,
        openSpecTools: [{ toolId: 'git', label: 'Git', directory: '.git', configured: true }],
      },
    };

    render(
      <div className="flex">
        <OpenSpecDashboard
          repoPath={repo}
          currentBranch="main"
          workingTreeClean={true}
          snapshot={mockSnapshotWithNotice}
          projection={null}
          runtimeHistory={[]}
          onPauseAfterTask={vi.fn()}
          onRespondDecision={vi.fn()}
          onEnsureRightOpen={onEnsureRightOpenMock}
        />
        <OpenSpecInspector repoPath={repo} snapshot={mockSnapshotWithNotice} />
      </div>
    );

    // 1. Inicialmente details-tools está cerrada
    const toolsSectionBtn = screen.getByRole('button', { name: /pipeline\.openspec\.rail\.tools/ });
    expect(toolsSectionBtn.getAttribute('aria-expanded')).toBe('false');

    // 2. Se encuentra la insignia en la franja
    const engineChip = await screen.findByTitle(/OpenSpec v1\.8\.0/i);
    // 3. Se hace clic en la insignia
    fireEvent.click(engineChip);
    expect(onEnsureRightOpenMock).not.toHaveBeenCalled();
    expect(toolsSectionBtn.getAttribute('aria-expanded')).toBe('false');
    expect(usePipelineStore.getState().reviewOpen).toBe(true);
    expect(await screen.findByRole('heading', { name: /pipeline\.openspec\.engine\.review\.title/ })).toBeTruthy();

    // 5. El centro NO monta el botón huérfano
    expect(screen.queryByRole('button', { name: /openToolsTab/i })).toBeNull();
    usePipelineStore.getState().reset();
  });

  it('12. Que con pendingToolCount en cero la sección Herramientas NO presenta número ni advertencia, y con uno o más presenta la advertencia con nombre accesible y ningún número (4.20)', async () => {
    const repo = 'C:/test-tools-section';

    // Caso A: pendingToolCount en 0 (sin herramientas faltantes ni integración desactualizada)
    (window as any).api = {
      ...((window as any).api || {}),
      pipelineOpenSpec: {
        ...((window as any).api?.pipelineOpenSpec || {}),
        getEngineStatus: vi.fn().mockResolvedValue({
          version: '1.8.0',
          versionClass: 'supported',
          integrationState: 'up-to-date',
          repoState: 'initialized',
          cli: {
            installed: true,
            runtimeVersion: '1.8.0',
            diagnostics: [],
          },
          divergence: { isDivergent: false, divergedFiles: [] },
        }),
        checkLatestVersion: vi.fn().mockResolvedValue(null),
      },
    };

    const snapshotClean: PipelineSnapshot = {
      ...dummySnapshot,
      openSpec: {
        ...dummySnapshot.openSpec!,
        selectedChangeId: null,
        activeChanges: [],
        archivedChanges: [],
        specifications: [],
        reports: [],
        diagnostics: [],
        observedAt: '2026-08-25T08:00:00Z',
        latestGate: null,
        openSpecPresent: true,
        openSpecTools: [{ toolId: 'git', label: 'Git', directory: '.git', configured: true }],
      },
    };

    const { unmount } = render(<OpenSpecInspector repoPath={repo} snapshot={snapshotClean} />);

    // El botón de la sección "Herramientas"
    const toolsBtn = await screen.findByRole('button', { name: /pipeline\.openspec\.rail\.tools/ });
    const toolsSectionHeader = toolsBtn.parentElement!;

    // 1. No hay número (span con count de tipo mono/badge)
    const countBadge = toolsSectionHeader.querySelector('span.font-mono, span.bg-border-subtle');
    expect(countBadge).toBeNull();

    // 2. No hay ícono de advertencia
    const warningIcon = toolsSectionHeader.querySelector('svg[aria-label="pipeline.openspec.engine.generalStatus.needsAttention"]');
    expect(warningIcon).toBeNull();

    unmount();

    // Caso B: pendingToolCount > 0 (integrationState: 'outdated')
    (window as any).api.pipelineOpenSpec.getEngineStatus = vi.fn().mockResolvedValue({
      version: '1.8.0',
      versionClass: 'supported',
      integrationState: 'outdated',
      repoState: 'initialized',
      cli: {
        installed: true,
        runtimeVersion: '1.8.0',
        diagnostics: [],
      },
      divergence: { isDivergent: false, divergedFiles: [] },
    });

    render(<OpenSpecInspector repoPath={repo} snapshot={snapshotClean} />);

    const toolsBtnWithPending = await screen.findByRole('button', { name: /pipeline\.openspec\.rail\.tools/ });
    const toolsSectionHeaderWithPending = toolsBtnWithPending.parentElement!;

    // 1. NO hay número
    const countBadgeWithPending = toolsSectionHeaderWithPending.querySelector('span.font-mono, span.bg-border-subtle');
    expect(countBadgeWithPending).toBeNull();

    // 2. SÍ presenta el ícono AlertTriangle con su nombre accesible y sin aria-hidden
    const warningIconWithPending = await within(toolsSectionHeaderWithPending).findByRole('img', { name: 'pipeline.openspec.engine.generalStatus.needsAttention' });
    expect(warningIconWithPending).not.toBeNull();
    expect(warningIconWithPending.getAttribute('aria-hidden')).toBeNull();
  });

  it('13. Que el riel de inicio muestra el bloque OpenSpec con la entrada Configuración y al pulsarlo abre la revisión (8.23-a2)', () => {
    const repo = 'C:/test-rail-entry';
    usePipelineStore.getState().reset();

    render(
      <OpenSpecDashboard
        repoPath={repo}
        snapshot={dummySnapshot}
        currentBranch="main"
        workingTreeClean={true}
        projection={null}
        runtimeHistory={[]}
        onPauseAfterTask={vi.fn()}
        onRespondDecision={vi.fn()}
      />
    );

    // El riel de vistas presenta el encabezado OpenSpec y el botón Configuración
    expect(screen.getByText('pipeline.openspec.config.railTitle')).toBeDefined();
    const configBtn = screen.getByRole('button', { name: /pipeline\.openspec\.config\.railEntry/ });
    expect(configBtn).toBeDefined();
    expect(configBtn.getAttribute('data-view-id')).toBe('openspec-config');
    expect(configBtn.getAttribute('aria-pressed')).toBe('false');

    // Al pulsar Configuración, se abre la revisión en el store
    fireEvent.click(configBtn);
    expect(usePipelineStore.getState().reviewOpen).toBe(true);

    usePipelineStore.getState().reset();
  });
});
