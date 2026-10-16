'use client';

import dynamic from 'next/dynamic';
import { AlertCircle, Check, FolderOpen, GitBranch, GitMerge, Loader2, Monitor, Rows3, Waypoints } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type MouseEvent } from 'react';
import { CommitGraph, type CommitSelectOptions } from '@/components/CommitGraph';
import { GraphColumnHandle, DeferredPanelLoading } from '@/components/PageWidgets';
import {
  BlameView,
  CommitTabView,
  FileDiffView,
  FileHistoryView,
  HistoryView,
  PullRequestDiffView,
} from '@/components/RepoContentViews';
import { ContentHeader } from '@/components/ContentHeader';
import type { HunkActionMode } from '@/components/DiffViewer';
import { RepoStartPanel, type RepoStartMode } from '@/components/RepoModals';
import { SettingsPanel, type SettingsPanelProps } from '@/components/SettingsPanel';
import { HelpPanel, type HelpPanelProps } from '@/components/HelpPanel';
import { ProfilePanel, type ProfilePanelProps } from '@/components/ProfilePanel';
import { CartographyView } from '@/components/cartography/CartographyView';
import { AiHistoryView } from '@/components/ai/AiHistoryView';
import InteractiveRebasePanel from '@/components/InteractiveRebasePanel';
import type { GraphColumnKey } from '@/hooks/use-panel-layout';
import { useT } from '@/hooks/use-translation';
import { useGitStore, type Commit, type GitFile } from '@/lib/git-store';
import { PipelineWorkspace } from '@/components/pipeline/PipelineWorkspace';
import { cn } from '@/lib/utils';
import { useAssistContribution } from '@/lib/assist/use-assist-contribution';
import { graphContribution } from '@/lib/assist/view-contributors';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import type { SpeculativeBranch } from '@/types/temporal-agent';
import type { BlameLine, FileHistoryEntry, PullRequestDiffData, PullRequestEntry } from '@/types/electron';

const ChronometricGraph = dynamic(
  () => import('@/components/ChronometricGraph').then((mod) => mod.ChronometricGraph),
  {
    ssr: false,
    loading: () => <DeferredPanelLoading />,
  },
);

type AppView = 'repository' | 'settings' | 'help' | 'profile';
type GraphMode = 'classic' | 'chronometric';

type RepoStartViewProps = {
  mode: RepoStartMode;
  repoPath: string | null;
  githubConnected: boolean;
  isLoading: boolean;
  onClose: () => void;
  onOpenExisting: () => Promise<void>;
  onPickCreateFolder: () => Promise<string | null>;
  onPickCloneFolder: () => Promise<string | null>;
  onCreate: Parameters<typeof RepoStartPanel>[0]['onCreate'];
  onClone: Parameters<typeof RepoStartPanel>[0]['onClone'];
  onListRepos: Parameters<typeof RepoStartPanel>[0]['onListRepos'];
  onConnectGitHub: () => void;
};

type DiffViewsProps = {
  selectedPullRequest: PullRequestEntry | null;
  pullRequestDiff: PullRequestDiffData | null;
  pullRequestDiffLoading: boolean;
  selectedFile: GitFile | null;
  currentDiff: string;
  wordWrap: boolean;
  fileDiffMode: 'working-tree' | 'commit' | null;
  fileHistoryFile: GitFile | null;
  fileHistoryEntries: FileHistoryEntry[];
  fileHistoryLoading: boolean;
  blameFile: GitFile | null;
  blameLines: BlameLine[];
  blameLoading: boolean;
  selectedBlameLineNo: number | null;
  hunkActionLoading: number | null;
  onToggleWordWrap: () => void;
  onCloseDiff: () => void;
  onSelectFileHistoryEntry: (entry: FileHistoryEntry) => void;
  onFileHistoryContextMenu: (event: MouseEvent, entry: FileHistoryEntry) => void;
  onSelectBlameLine: (line: BlameLine) => void;
  onStageHunk: (hunkIndex: number, selectedLines?: number[]) => void;
  onUnstageHunk: (hunkIndex: number, selectedLines?: number[]) => void;
  onDiscardHunk: (hunkIndex: number, selectedLines?: number[]) => void;
  conflictFileLoading: boolean;
  conflictFileContent: string;
  isSaving: boolean;
  onSaveConflict: (file: GitFile, content: string) => Promise<void> | void;
};

type TabViewsProps = {
  activeTab: string;
  /** Repo activo. Lo consume el workspace de Pipeline, que scopea todo per-repo. */
  repoPath: string | null;
  commits: Commit[];
  selectedCommit: Commit | null;
  currentBranch?: string;
  filterText: string;
  modifiedFiles: GitFile[];
  hasGithubUser: boolean;
  isLoading: boolean;
  pipelineLayout?: {
    leftOpen?: boolean;
    rightOpen?: boolean;
    leftWidth?: number;
    rightWidth?: number;
    onResizeLeft?: (event: MouseEvent) => void;
    onResizeRight?: (event: MouseEvent) => void;
    onEnsureRightOpen?: () => void;
    onEnsureRightClosed?: () => void;
  };
  onSelectCommit: (commit: Commit, options?: CommitSelectOptions) => void;
  onCommitContextMenu: (event: MouseEvent, commit: Commit) => void;
};

type GraphViewProps = {
  graphMode: GraphMode;
  activeGraphMode: GraphMode;
  isDragging: boolean;
  isStartupGraphReady: boolean;
  sidebarOpen: boolean;
  sidebarW: number;
  repositoryDetailsVisible: boolean;
  detailsW: number;
  graphColumns: Record<GraphColumnKey, number>;
  beginGraphColDrag: (col: GraphColumnKey, event: MouseEvent, direction?: 1 | -1) => void;
  enableCronometric: boolean;
  speculativeBranches: SpeculativeBranch[];
  selectedBranchName: string | null;
  selectedBranchFocusRequest: number;
  showSpeculative: boolean;
  leftGraphSafe: number;
  rightGraphSafe: number;
  branches: string[];
  isAnyContextMenuOpen: boolean;
  onChangeGraphMode: (mode: GraphMode) => void;
  onToggleSpeculative: () => void;
  onClearGraphSelection: () => void;
};

export type RepoMainViewProps = {
  activeView: AppView;
  isRepoStartView: boolean;
  // Cartografía: vista top-level per-repo. Cuando está activa reemplaza al
  // grafo/diffs/tabs dentro de la vista 'repository'.
  cartographyActive: boolean;
  /** Ruta del repo activo: la lente del explorador escanea este working dir. */
  cartographyRepoPath: string | null;
  onExitCartography: () => void;
  settingsPanel: SettingsPanelProps;
  helpPanel: HelpPanelProps;
  profilePanel: ProfilePanelProps;
  repoStart: RepoStartViewProps;
  diffViews: DiffViewsProps;
  tabViews: TabViewsProps;
  graphView: GraphViewProps;
  interactiveRebase: {
    interactiveRebaseFrom: string | null;
    setInteractiveRebaseFrom: (hash: string | null) => void;
  };
};

export function RepoMainView({
  activeView,
  isRepoStartView,
  cartographyActive,
  cartographyRepoPath,
  onExitCartography,
  settingsPanel,
  helpPanel,
  profilePanel,
  repoStart,
  diffViews,
  tabViews,
  graphView,
  interactiveRebase,
}: RepoMainViewProps) {
  useEffect(() => {
    const repoPath = tabViews.repoPath;
    if (!repoPath) return;
    void window.api?.pipelinePrewarm?.(repoPath);
  }, [tabViews.repoPath]);

  const pipelineFixturePreview = process.env.NODE_ENV === 'development'
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('pipelineFixture');

  if (cartographyActive) return <CartographyView repoPath={cartographyRepoPath} onExit={onExitCartography} />;
  if (interactiveRebase.interactiveRebaseFrom) {
    return (
      <InteractiveRebasePanel
        baseCommitHash={interactiveRebase.interactiveRebaseFrom}
        onClose={() => interactiveRebase.setInteractiveRebaseFrom(null)}
      />
    );
  }
  if (activeView === 'settings') return <SettingsPanel {...settingsPanel} />;
  if (activeView === 'help') return <HelpPanel {...helpPanel} />;
  if (activeView === 'profile') return <ProfilePanel {...profilePanel} />;
  // QA visual sin Electron: conserva el topbar real y monta sólo el interior de
  // Pipeline con el fixture indicado por query string. Producción elimina esta
  // rama y jamás recibe una ruta de repositorio inventada.
  if (pipelineFixturePreview && tabViews.activeTab === 'Pipeline') {
    return (
      <PipelineWorkspace
        key="pipeline-fixture-preview"
        repoPath={tabViews.repoPath ?? 'C:\\gitcron-pipeline-preview'}
        currentBranch={tabViews.currentBranch || 'feature/resume-builder'}
        workingTreeClean={true}
        leftOpen={tabViews.pipelineLayout?.leftOpen}
        rightOpen={tabViews.pipelineLayout?.rightOpen}
        leftWidth={tabViews.pipelineLayout?.leftWidth}
        rightWidth={tabViews.pipelineLayout?.rightWidth}
        onResizeLeft={tabViews.pipelineLayout?.onResizeLeft}
        onResizeRight={tabViews.pipelineLayout?.onResizeRight}
        onEnsureRightOpen={tabViews.pipelineLayout?.onEnsureRightOpen}
        onEnsureRightClosed={tabViews.pipelineLayout?.onEnsureRightClosed}
      />
    );
  }
  if (isRepoStartView) return <RepoStartView {...repoStart} />;
  if (diffViews.selectedPullRequest) {
    return (
      <PullRequestDiffView
        pullRequest={diffViews.selectedPullRequest}
        pullRequestDiff={diffViews.pullRequestDiff}
        pullRequestDiffLoading={diffViews.pullRequestDiffLoading}
        wordWrap={diffViews.wordWrap}
        onBack={diffViews.onCloseDiff}
      />
    );
  }
  if (diffViews.fileHistoryFile) {
    return (
      <FileHistoryView
        file={diffViews.fileHistoryFile}
        entries={diffViews.fileHistoryEntries}
        selectedHash={tabViews.selectedCommit?.hash}
        isLoading={diffViews.fileHistoryLoading}
        onBack={diffViews.onCloseDiff}
        onSelect={diffViews.onSelectFileHistoryEntry}
        onContextMenu={diffViews.onFileHistoryContextMenu}
      />
    );
  }
  if (diffViews.blameFile) {
    return (
      <BlameView
        file={diffViews.blameFile}
        lines={diffViews.blameLines}
        selectedLineNo={diffViews.selectedBlameLineNo}
        isLoading={diffViews.blameLoading}
        onBack={diffViews.onCloseDiff}
        onSelectLine={diffViews.onSelectBlameLine}
      />
    );
  }
  if (diffViews.selectedFile) {
    const hunkActionMode: HunkActionMode | undefined =
      diffViews.fileDiffMode === 'working-tree'
        ? diffViews.selectedFile.staged ? 'unstage' : 'stage'
        : undefined;

    return (
      <FileDiffView
        file={diffViews.selectedFile}
        currentDiff={diffViews.currentDiff}
        wordWrap={diffViews.wordWrap}
        hunkActionMode={hunkActionMode}
        hunkActionLoading={diffViews.hunkActionLoading}
        onToggleWordWrap={diffViews.onToggleWordWrap}
        onBack={diffViews.onCloseDiff}
        onStageHunk={diffViews.onStageHunk}
        onUnstageHunk={diffViews.onUnstageHunk}
        onDiscardHunk={diffViews.onDiscardHunk}
        conflictFileLoading={diffViews.conflictFileLoading}
        conflictFileContent={diffViews.conflictFileContent}
        isSaving={diffViews.isSaving}
        onSaveConflict={(content) => diffViews.onSaveConflict(diffViews.selectedFile!, content)}
      />
    );
  }
  if (tabViews.activeTab === 'History') return <HistoryTabView {...tabViews} />;
  if (tabViews.activeTab === 'Commit') return <CommitWorkspaceView {...tabViews} />;
  if (tabViews.activeTab === 'AiHistory') return <AiHistoryView repoPath={tabViews.repoPath} />;
  // `key` per-repo: cambiar de repositorio desmonta y remonta el workspace, así
  // no se muestra el snapshot del repo anterior mientras carga el nuevo.
  if (tabViews.activeTab === 'Pipeline') {
    return (
      <PipelineWorkspace
        key={tabViews.repoPath ?? 'no-repo'}
        repoPath={tabViews.repoPath}
        currentBranch={tabViews.currentBranch}
        workingTreeClean={tabViews.modifiedFiles.length === 0}
        leftOpen={tabViews.pipelineLayout?.leftOpen}
        rightOpen={tabViews.pipelineLayout?.rightOpen}
        leftWidth={tabViews.pipelineLayout?.leftWidth}
        rightWidth={tabViews.pipelineLayout?.rightWidth}
        onResizeLeft={tabViews.pipelineLayout?.onResizeLeft}
        onResizeRight={tabViews.pipelineLayout?.onResizeRight}
        onEnsureRightOpen={tabViews.pipelineLayout?.onEnsureRightOpen}
        onEnsureRightClosed={tabViews.pipelineLayout?.onEnsureRightClosed}
      />
    );
  }
  return <GraphTabView tabViews={tabViews} graphView={graphView} />;
}

function RepoStartView({
  mode,
  repoPath,
  githubConnected,
  isLoading,
  onClose,
  onOpenExisting,
  onPickCreateFolder,
  onPickCloneFolder,
  onCreate,
  onClone,
  onListRepos,
  onConnectGitHub,
}: RepoStartViewProps) {
  const t = useT();

  return (
    <div className="relative z-10 flex-1 flex flex-col min-h-0 overflow-hidden bg-bg-base/40">
      <div className="shrink-0">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <FolderOpen size={18} className="text-secondary shrink-0" />
            <h2 className="truncate text-[length:var(--font-size-lg)] font-bold text-text-primary">
              {mode === 'open' && 'Abrir repositorio existente'}
              {mode === 'create' && 'Crear repositorio nuevo'}
              {mode === 'clone' && 'Clonar repositorio'}
            </h2>
          </div>
          {repoPath && (
            <button
              onClick={onClose}
              className="shrink-0 text-text-secondary hover:text-text-primary px-3 py-1 rounded text-xs font-semibold tracking-wide transition-colors"
            >
              {t('common.backToRepo')}
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto w-full select-text">
        <div className="mx-auto w-full max-w-4xl p-6">
          <RepoStartPanel
            mode={mode}
            githubConnected={githubConnected}
            isLoading={isLoading}
            onOpenExisting={onOpenExisting}
            onPickCreateFolder={onPickCreateFolder}
            onPickCloneFolder={onPickCloneFolder}
            onCreate={onCreate}
            onClone={onClone}
            onListRepos={onListRepos}
            onConnectGitHub={onConnectGitHub}
            onComplete={onClose}
          />
        </div>
      </div>
    </div>
  );
}

function HistoryTabView({
  commits,
  selectedCommit,
  currentBranch,
  filterText,
  isLoading,
  onSelectCommit,
  onCommitContextMenu,
}: TabViewsProps) {
  return (
    <motion.div
      key="history-tab"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
    >
      <HistoryView
        commits={commits}
        selectedHash={selectedCommit?.hash}
        currentBranch={currentBranch}
        filterText={filterText}
        onSelect={onSelectCommit}
        onContextMenu={onCommitContextMenu}
        isLoading={isLoading}
      />
    </motion.div>
  );
}

function CommitWorkspaceView({ modifiedFiles, hasGithubUser }: TabViewsProps) {
  return (
    <motion.div
      key="commit-tab"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
    >
      <CommitTabView modifiedFiles={modifiedFiles} hasGithubUser={hasGithubUser} />
    </motion.div>
  );
}

function GraphTabView({ tabViews, graphView }: { tabViews: TabViewsProps; graphView: GraphViewProps }) {
  const t = useT();
  const branchTracking = useGitStore((s) => s.branchTracking);
  const currentBranch = tabViews.currentBranch;
  const modifiedFiles = tabViews.modifiedFiles;

  // Se escucha la idea de Centauro (no sólo se lee): así esta vista se redibuja al elegir
  // una, y el chat se entera y actualiza «Vas a preguntar sobre…».
  const temporalIdea = useAssistDockStore((s) => s.temporalIdea);
  useAssistContribution('graph', () =>
    graphContribution(
      useGitStore.getState().getActiveRepo()?.selectedCommit ?? null,
      temporalIdea,
    )
  );

  return (
    <div data-testid="graph-tab-container" className="flex-1 flex flex-col relative min-h-0 bg-bg-base overflow-hidden">
      <ContentHeader className="h-11 border-b border-border-subtle/15 flex items-center justify-between gap-3 normal-case font-normal shrink-0">
        {/* Left: Branch name and repo status indicators */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Branch name */}
          <div className="flex items-center gap-1.5 min-w-0 shrink">
            <GitBranch size={13} className="shrink-0 text-text-secondary/70" />
            <span
              className="font-mono font-semibold text-xs text-text-primary truncate"
              title={currentBranch || '-'}
            >
              {currentBranch || '-'}
            </span>
          </div>

          {/* Indicators */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Working tree state */}
            <div
              role="status"
              title={modifiedFiles.length === 0 ? t('pipeline.openspec.repo.clean') : t('pipeline.openspec.repo.changed')}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0',
                modifiedFiles.length === 0
                  ? 'bg-secondary/10 text-secondary'
                  : 'bg-git-mod/15 text-git-mod'
              )}
            >
              {modifiedFiles.length === 0 ? (
                <Check size={11} strokeWidth={2.5} className="shrink-0" />
              ) : (
                <AlertCircle size={11} className="shrink-0" />
              )}
              <span>
                {modifiedFiles.length === 0
                  ? t('sidebar.workingTreeClean')
                  : `${modifiedFiles.length} ${t('sidebar.workingTreeModified')}`}
              </span>
            </div>

            {/* Tracking / validation status */}
            {(() => {
              const tracking = currentBranch ? branchTracking[currentBranch] : undefined;
              if (tracking?.gone) {
                return (
                  <div
                    role="status"
                    title={t('sidebar.branchStatus.gone', { upstream: tracking.upstream ?? '' })}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-error/15 text-error"
                  >
                    <AlertCircle size={11} className="shrink-0" />
                    <span>{t('sidebar.upstreamGone')}</span>
                  </div>
                );
              }
              if (tracking && (tracking.ahead > 0 || tracking.behind > 0)) {
                return (
                  <div
                    role="status"
                    title={t('sidebar.branchStatus.diverged', {
                      upstream: tracking.upstream ?? '',
                      ahead: tracking.ahead,
                      behind: tracking.behind,
                    })}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-secondary/10 text-secondary font-mono"
                  >
                    <GitMerge size={11} className="shrink-0" />
                    <span>+{tracking.ahead} -{tracking.behind}</span>
                  </div>
                );
              }
              if (tracking) {
                return (
                  <div
                    role="status"
                    title={t('sidebar.branchStatus.synced', { upstream: tracking.upstream ?? '' })}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-secondary/10 text-secondary"
                  >
                    <Check size={11} strokeWidth={2.5} className="shrink-0" />
                    <span>{t('sidebar.branchStatus.syncedShort')}</span>
                  </div>
                );
              }
              return (
                <div
                  role="status"
                  title={t('sidebar.branchStatus.local')}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--font-size-2xs)] font-semibold shrink-0 bg-text-primary/[0.035] text-text-secondary/80"
                >
                  <Monitor size={11} className="shrink-0" />
                  <span>{t('sidebar.branchStatus.localShort')}</span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right: Graph mode selector */}
        {graphView.enableCronometric && (
          <div data-testid="graph-mode-selector" className="shrink-0 ml-auto flex items-center">
            <div className="bg-bg-base/80 border border-border-subtle/30 rounded-lg flex items-center p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => graphView.onChangeGraphMode('classic')}
                aria-pressed={graphView.activeGraphMode === 'classic'}
                className={cn(
                  "h-7 px-2 py-1 rounded-md transition-all duration-150 flex items-center justify-center gap-1.5",
                  graphView.activeGraphMode === 'classic'
                    ? "bg-secondary/15 text-secondary shadow-[0_0_6px_color-mix(in_srgb,var(--color-git-add)_25%,transparent)]"
                    : "text-text-secondary hover:text-text-primary hover:bg-border-subtle/50"
                )}
                title={t('toolbar.viewClassicTooltip')}
                aria-label={t('toolbar.viewClassicBtn')}
              >
                <Rows3 size={13} className="shrink-0" />
                <span className="text-[length:var(--font-size-xs)] leading-none font-semibold">{t('toolbar.viewClassicBtn')}</span>
              </button>
              <button
                type="button"
                onClick={() => graphView.onChangeGraphMode('chronometric')}
                aria-pressed={graphView.activeGraphMode === 'chronometric'}
                className={cn(
                  "h-7 px-2 py-1 rounded-md transition-all duration-150 flex items-center justify-center gap-1.5",
                  graphView.activeGraphMode === 'chronometric'
                    ? "bg-secondary/15 text-secondary shadow-[0_0_6px_color-mix(in_srgb,var(--color-git-add)_25%,transparent)]"
                    : "text-text-secondary hover:text-text-primary hover:bg-border-subtle/50"
                )}
                title={t('toolbar.viewChronometricTooltip')}
                aria-label={t('toolbar.viewChronometricBtn')}
              >
                <Waypoints size={13} className="shrink-0" />
                <span className="text-[length:var(--font-size-xs)] leading-none font-semibold">{t('toolbar.viewChronometricBtn')}</span>
              </button>
            </div>
          </div>
        )}
      </ContentHeader>

      <div className="flex-1 relative min-h-0 overflow-hidden">
        <AnimatePresence>
          {graphView.activeGraphMode === 'classic' && (
            <ClassicGraphView tabViews={tabViews} graphView={graphView} />
          )}
          {graphView.activeGraphMode === 'chronometric' && (
            <ChronometricGraphView tabViews={tabViews} graphView={graphView} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ClassicGraphView({ tabViews, graphView }: { tabViews: TabViewsProps; graphView: GraphViewProps }) {
  const t = useT();
  return (
    <motion.div
      key="classic-graph"
      className="absolute inset-0 flex flex-col overflow-hidden bg-bg-base"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <ContentHeader className="flex items-center">
          <div className="shrink-0 text-right pl-3 pr-3" style={{ width: graphView.graphColumns.refs }}>
            {t('graph.colBranchTag')}
          </div>
          <GraphColumnHandle onMouseDown={(event) => graphView.beginGraphColDrag('refs', event)} />
          <div className="shrink-0 text-left px-2" style={{ width: graphView.graphColumns.graph }}>
            {t('graph.colGraph')}
          </div>
          <GraphColumnHandle onMouseDown={(event) => graphView.beginGraphColDrag('graph', event)} />
          <div className="flex-1 flex items-center gap-2 pl-5 min-w-0">
            <span className="shrink-0">{t('graph.colMessage')}</span>
            {graphView.enableCronometric && graphView.showSpeculative && graphView.speculativeBranches.length > 0 && (
              <button
                onClick={() => {
                  graphView.onChangeGraphMode('chronometric');
                  if (!graphView.showSpeculative) graphView.onToggleSpeculative();
                }}
                className="text-[length:var(--font-size-2xs)] normal-case px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors font-mono"
                title={t('graph.speculativeBadgeTooltip', { count: graphView.speculativeBranches.length })}
              >
                {t('graph.speculativeBadge', { count: graphView.speculativeBranches.length })}
              </button>
            )}
            {tabViews.filterText.trim() && (
              <span className="text-[length:var(--font-size-2xs)] normal-case px-1.5 py-0.5 rounded bg-secondary/15 text-secondary border border-secondary/30">
                {t('graph.filterActive')}
              </span>
            )}
          </div>
          <GraphColumnHandle onMouseDown={(event) => graphView.beginGraphColDrag('date', event, -1)} />
          <div className="flex items-center pr-3 text-right shrink-0 self-stretch">
            <span className="pr-3" style={{ width: graphView.graphColumns.date }}>
              {t('graph.colDate')}
            </span>
            <GraphColumnHandle onMouseDown={(event) => graphView.beginGraphColDrag('date', event)} />
            <span style={{ width: graphView.graphColumns.hash }}>
              {t('graph.colCommit')}
            </span>
          </div>
        </ContentHeader>

        <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin relative">
          <AnimatePresence mode="wait">
            {!graphView.isStartupGraphReady ? (
              <GraphLoadingState keyName="classic-loading" label="Cargando graph..." />
            ) : tabViews.commits.length === 0 && tabViews.isLoading ? (
              <CommitsLoadingState keyName="classic-loading-commits" />
            ) : tabViews.commits.length > 0 ? (
              <motion.div
                key="classic-commits"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <CommitGraph
                  commits={tabViews.commits}
                  selectedHash={tabViews.selectedCommit?.hash}
                  selectedBranchName={graphView.selectedBranchName}
                  currentBranch={tabViews.currentBranch}
                  workingTreeFiles={tabViews.modifiedFiles}
                  filterText={tabViews.filterText}
                  columnWidths={graphView.graphColumns}
                  onSelect={tabViews.onSelectCommit}
                  onContextMenu={tabViews.onCommitContextMenu}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function ChronometricGraphView({ tabViews, graphView }: { tabViews: TabViewsProps; graphView: GraphViewProps }) {
  return (
    <motion.div
      key="chronometric-graph"
      className="absolute inset-0 flex flex-col overflow-visible"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      <AnimatePresence mode="wait">
        {!graphView.isStartupGraphReady ? (
          <GraphLoadingState keyName="chrono-loading" label="Cargando graph..." />
        ) : tabViews.commits.length === 0 && tabViews.isLoading ? (
          <CommitsLoadingState keyName="chrono-loading-commits" />
        ) : tabViews.commits.length > 0 ? (
          <motion.div
            key="chrono-commits"
            className="absolute inset-0 flex flex-col overflow-visible"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <ChronometricGraph
              commits={tabViews.commits}
              selectedHash={tabViews.selectedCommit?.hash}
              selectedBranchName={graphView.selectedBranchName}
              selectedBranchFocusRequest={graphView.selectedBranchFocusRequest}
              currentBranch={tabViews.currentBranch}
              filterText={tabViews.filterText}
              onSelect={tabViews.onSelectCommit}
              onClearSelection={graphView.onClearGraphSelection}
              onContextMenu={tabViews.onCommitContextMenu}
              speculativeBranches={graphView.speculativeBranches}
              showSpeculative={graphView.showSpeculative}
              onToggleSpeculative={graphView.onToggleSpeculative}
              hudLeft={graphView.leftGraphSafe}
              hudRight={graphView.rightGraphSafe}
              localBranches={graphView.branches}
              isContextMenuOpen={graphView.isAnyContextMenuOpen}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function GraphLoadingState({ keyName, label }: { keyName: string; label: string }) {
  return (
    <motion.div
      key={keyName}
      className="absolute inset-0 flex flex-col items-center justify-center text-text-secondary text-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Loader2 size={18} className="animate-spin mb-3 text-secondary" />
      <p>{label}</p>
    </motion.div>
  );
}

function CommitsLoadingState({ keyName }: { keyName: string }) {
  return (
    <motion.div
      key={keyName}
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <p className="text-text-secondary text-sm">Cargando commits...</p>
    </motion.div>
  );
}
