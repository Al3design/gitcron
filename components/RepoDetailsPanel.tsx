'use client';

// Panel derecho de detalles: muestra una lista única de secciones plegables
// (SidebarSection) según la circunstancia activa (grafo con commit, grafo sin
// commit o SDD inspector con operaciones Git compartidas). Flota en la vista
// chronometric y es inline en la clásica. Extraído de app/page.tsx.
//
// Es dueño de la carga de archivos del commit (gitShowFiles). Lo que abre
// modales/menus de la página o navega al diff llega por props.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertCircle,
  Brain,
  Check,
  FileDiff,
  Files,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Layers,
  PackageCheck,
  Play,
  RotateCcw,
  Trash2,
  Zap,
} from 'lucide-react';
import { useGitStore, GitFile } from '@/lib/git-store';
import { useGitActions } from '@/hooks/use-git-actions';
import { usePipelineDecisionControl } from '@/hooks/use-pipeline-decision-control';
import { useT } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { formatDate, formatInitials } from '@/lib/display-format';
import { SidebarSection, StagingFileRow } from '@/components/RepoSidebarParts';
import { OpenSpecInspector } from '@/components/pipeline/OpenSpecInspector';
import { CommitDraftLog } from '@/components/pipeline/CommitDraftLog';
import { usePipelineStore } from '@/lib/pipeline-store';
import { DEFAULT_OPEN_RIGHT_PANEL, useSidebarSectionState } from '@/hooks/use-sidebar-section-state';
import { getDraftLogSnapshot, subscribeDraftLog } from '@/lib/commit-draft-log';

type RepoDetailsPanelProps = {
  activeTab?: string;
  // layout (estado de usePanelLayout, que vive en la página)
  graphMode: 'classic' | 'chronometric';
  detailsW: number;
  visible: boolean;
  isDragging: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  // acciones que tocan estado/modales de la página
  onOpenStashModal: () => void;
  onOpenCommitFile: (file: GitFile) => void;
  onSelectFile: (file: GitFile) => void;
  onDiscardRequest: (file: GitFile) => void;
  onRequestAmend: () => void;
  onRequestSquash: () => void;
  onFileContextMenu: (menu: { x: number; y: number; file: GitFile }) => void;
  onRequestResetAll: () => void;
  onRequestCleanUntracked: () => void;
};

export function RepoDetailsPanel({
  activeTab,
  detailsW, visible, isDragging, onResizeStart,
  onOpenStashModal, onOpenCommitFile, onSelectFile, onDiscardRequest,
  onRequestAmend, onRequestSquash, onFileContextMenu,
  onRequestResetAll, onRequestCleanUntracked,
}: RepoDetailsPanelProps) {
  const t = useT();
  const {
    repoPath, selectedCommit, setSelectedCommit,
    modifiedFiles, commitMessage, setCommitMessage,
    selectedFile, isLoading, currentBranch,
    rebaseInProgress,
  } = useGitStore();
  const {
    commitChanges, stageFile, stageFiles,
    continueInteractiveRebase, abortInteractiveRebase, undoInteractiveRebase,
  } = useGitActions();

  const reviewOpen = usePipelineStore((s) => s.reviewOpen);
  const toggleReviewOpen = usePipelineStore((s) => s.toggleReviewOpen);
  const aiNotice = usePipelineStore((s) => s.aiNotice);
  // La sesión activa la entrega el workspace Pipeline (mismo repo, keyeado por
  // él): el panel no arranca otra lectura ni conserva su propia.
  const projection = usePipelineStore((s) => s.projection);
  const {
    respondDecision: handleRespondDecision,
    controlNotice: decisionNotice,
    sendingDecisions,
  } = usePipelineDecisionControl(repoPath, projection);
  const draftLog = useSyncExternalStore(subscribeDraftLog, getDraftLogSnapshot, getDraftLogSnapshot);
  const hasDraftLog = draftLog.draftId !== null || Boolean(aiNotice);

  const sectionState = useSidebarSectionState(repoPath, DEFAULT_OPEN_RIGHT_PANEL);

  // Files changed in the selected commit (lazy-loaded per selection).
  const [commitFiles, setCommitFiles] = useState<GitFile[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selectedCommit || !repoPath || !window.api) {
      setCommitFiles([]);
      return;
    }
    setCommitFilesLoading(true);
    window.api.gitShowFiles(repoPath, selectedCommit.hash)
      .then((r) => {
        if (r.success && r.data) setCommitFiles(r.data as GitFile[]);
        else setCommitFiles([]);
      })
      .catch(() => setCommitFiles([]))
      .finally(() => setCommitFilesLoading(false));
  }, [selectedCommit?.hash, repoPath]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  const { unstaged, staged, untrackedCount } = useMemo(() => {
    const nextUnstaged = modifiedFiles.filter((file) => !file.staged);
    const nextStaged = modifiedFiles.filter((file) => file.staged);
    return {
      unstaged: nextUnstaged,
      staged: nextStaged,
      untrackedCount: nextUnstaged.filter((file) => file.status === 'untracked').length,
    };
  }, [modifiedFiles]);

  const stageAll = () => stageFiles(unstaged.map((file) => file.path), true);
  const unstageAll = () => stageFiles(staged.map((file) => file.path), false);

  const isPipeline = activeTab === 'Pipeline';

  const renderCommitBox = () => (
    <SidebarSection
      title={t('staging.commitSectionTitle')}
      icon={<Check size={13} aria-hidden="true" />}
      isOpen={sectionState.isOpen('details-commit-box')}
      onToggle={() => sectionState.toggle('details-commit-box')}
    >
      <div className="p-3 bg-bg-surface/75 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <GitBranch size={12} className="text-secondary shrink-0" />
          <span className="truncate">
            {t('pipeline.openspec.prepare.toBranch', {
              branch: currentBranch || t('pipeline.openspec.repo.branchUnknown'),
            })}
          </span>
        </div>
        <textarea
          className="w-full bg-bg-input border border-border-subtle rounded p-2 text-sm text-text-primary h-16 focus:outline-none focus:border-primary/50 resize-none"
          placeholder={t('staging.commitMsgPlaceholder')}
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
        />
        <button
          type="button"
          onClick={commitChanges}
          disabled={isLoading || !commitMessage.trim() || staged.length === 0 || !repoPath}
          className="w-full py-2 bg-git-add hover:bg-git-add/90 shadow-lg shadow-git-add/20 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-bg-base rounded transition-colors"
        >
          {isLoading
            ? t('staging.committingState')
            : staged.length > 0
              ? t('staging.commitWithCountBtn', { count: staged.length })
              : t('staging.commitBtn')}
        </button>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={onRequestAmend}
            disabled={isLoading}
            className="flex-1 py-1.5 px-2 bg-bg-surface/75 border border-border-subtle/15 hover:bg-border-subtle/50 text-text-secondary hover:text-text-primary rounded text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
            title={t('staging.amendTooltip')}
          >
            <RotateCcw size={12} />
            {t('staging.amendBtn')}
          </button>
          <button
            type="button"
            onClick={onRequestSquash}
            disabled={isLoading}
            className="flex-1 py-1.5 px-2 bg-bg-surface/75 border border-border-subtle/15 hover:bg-border-subtle/50 text-text-secondary hover:text-text-primary rounded text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40"
            title={t('staging.squashTooltip')}
          >
            <Layers size={12} />
            {t('staging.squashBtn')}
          </button>
        </div>
        <div className="mt-1 text-right">
          <button
            type="button"
            onClick={async () => {
              if (confirm(t('rebase.banner.btn.undo') + '?')) {
                await undoInteractiveRebase('refs/gitcron/pre-rebase');
              }
            }}
            disabled={isLoading}
            className="text-[length:var(--font-size-xs)] text-text-secondary hover:text-secondary hover:underline transition-colors disabled:opacity-40 font-semibold"
          >
            {t('rebase.banner.btn.undo')}
          </button>
        </div>
      </div>
    </SidebarSection>
  );

  const renderWorkingTreeBlock = () => (
    <>
      {/* Alerta de rebase interactivo en curso */}
      {rebaseInProgress && (
        <div className="p-3 bg-git-mod/10 border-b border-git-mod/30 flex flex-col gap-2 shrink-0">
          <div className="flex items-start gap-2 text-git-mod">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold block">{t('rebase.banner.title')}</span>
              <span className="text-[length:var(--font-size-xs)] text-text-secondary leading-normal block mt-0.5">
                {t('rebase.banner.desc')}
              </span>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={async () => {
                await abortInteractiveRebase();
              }}
              disabled={isLoading}
              className="px-2.5 py-1 text-[length:var(--font-size-xs)] font-semibold text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 rounded transition-colors disabled:opacity-40"
            >
              {t('rebase.banner.btn.abort')}
            </button>
            <button
              type="button"
              onClick={async () => {
                await continueInteractiveRebase();
              }}
              disabled={isLoading}
              className="px-2.5 py-1 text-[length:var(--font-size-xs)] font-bold bg-git-mod hover:bg-git-mod/90 text-bg-base rounded transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              {isLoading ? (
                <div className="w-3 h-3 rounded-full border border-black border-t-transparent animate-spin" />
              ) : (
                <Play size={10} className="fill-black" />
              )}
              {t('rebase.banner.btn.continue')}
            </button>
          </div>
        </div>
      )}

      <SidebarSection
        title={t('staging.unstagedTitle')}
        count={unstaged.length}
        icon={<FileDiff size={13} aria-hidden="true" />}
        extra={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenStashModal}
              disabled={isLoading}
              className="text-[length:var(--font-size-xs)] font-bold text-git-mod hover:text-bg-base hover:bg-git-mod px-2 py-0.5 rounded transition-colors disabled:opacity-50"
              title={t('commit.stashTooltip')}
            >
              Stash
            </button>
            {untrackedCount > 0 && (
              <button
                type="button"
                onClick={onRequestCleanUntracked}
                disabled={isLoading}
                className="text-[length:var(--font-size-xs)] text-warning hover:text-bg-base px-2 py-0.5 rounded border border-warning/40 hover:bg-warning transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={t('staging.cleanUntrackedTooltip')}
              >
                {t('staging.cleanUntrackedBtn')}
              </button>
            )}
            {modifiedFiles.length > 0 && (
              <button
                type="button"
                onClick={onRequestResetAll}
                className="p-1 text-text-secondary hover:text-error hover:bg-error/10 rounded transition-colors"
                title={t('staging.discardAllTooltip')}
              >
                <Trash2 size={12} />
              </button>
            )}
            {unstaged.length > 0 && (
              <button
                type="button"
                onClick={stageAll}
                className="text-[length:var(--font-size-xs)] text-secondary hover:text-bg-base px-2 py-0.5 rounded border border-secondary/40 hover:bg-secondary transition-colors"
              >
                {t('staging.stageAllBtn')}
              </button>
            )}
          </div>
        }
        isOpen={sectionState.isOpen('details-unstaged')}
        onToggle={() => sectionState.toggle('details-unstaged')}
      >
        {unstaged.length === 0 ? (
          <p className="px-4 py-3 text-xs text-text-secondary/70 italic">{t('staging.noUnstagedChanges')}</p>
        ) : (
          <div className="p-1">
            {unstaged.map((file) => (
              <StagingFileRow
                key={file.path}
                file={file}
                selected={selectedFile?.path === file.path}
                direction="stage"
                onClick={() => onSelectFile(file)}
                onAction={() => stageFile(file.path, true)}
                onDiscard={() => onDiscardRequest(file)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onFileContextMenu({ x: event.clientX, y: event.clientY, file });
                }}
              />
            ))}
          </div>
        )}
      </SidebarSection>

      <SidebarSection
        title={t('staging.stagedTitle')}
        count={staged.length}
        icon={<PackageCheck size={13} aria-hidden="true" />}
        extra={
          staged.length > 0 && (
            <button
              type="button"
              onClick={unstageAll}
              className="text-[length:var(--font-size-xs)] text-text-secondary hover:text-bg-base px-2 py-0.5 rounded border border-border-subtle hover:bg-border-subtle transition-colors"
            >
              {t('staging.unstageAllBtn')}
            </button>
          )
        }
        isOpen={sectionState.isOpen('details-staged')}
        onToggle={() => sectionState.toggle('details-staged')}
      >
        {staged.length === 0 ? (
          <p className="px-4 py-3 text-xs text-text-secondary/70 italic">{t('staging.noStagedChanges')}</p>
        ) : (
          <div className="p-1">
            {staged.map((file) => (
              <StagingFileRow
                key={file.path}
                file={file}
                selected={selectedFile?.path === file.path}
                direction="unstage"
                onClick={() => onSelectFile(file)}
                onAction={() => stageFile(file.path, false)}
                onDiscard={() => onDiscardRequest(file)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onFileContextMenu({ x: event.clientX, y: event.clientY, file });
                }}
              />
            ))}
          </div>
        )}
      </SidebarSection>

      {hasDraftLog && (
        <SidebarSection
          title={t('pipeline.openspec.prepare.aiLogTitle')}
          icon={<Brain size={13} aria-hidden="true" />}
          isOpen={sectionState.isOpen('details-draft-log')}
          onToggle={() => sectionState.toggle('details-draft-log')}
        >
          <CommitDraftLog notice={aiNotice} />
        </SidebarSection>
      )}

      {renderCommitBox()}
    </>
  );

  return (
    <aside
      data-testid="repo-details-panel"
      className={cn(
        "flex flex-col overflow-hidden z-30 relative bg-bg-surface shrink-0"
      )}
      style={{
        width: visible ? detailsW : 0,
        opacity: visible ? 1 : 0,
        visibility: visible ? 'visible' : 'hidden',
        transition: !isDragging ? 'all var(--panel-motion)' : undefined,
      }}
    >
      {/* Left-edge resize handle */}
      <div
        onMouseDown={onResizeStart}
        className="group absolute top-0 left-0 h-full w-2 cursor-col-resize z-40"
        title="Arrastrar para redimensionar"
      >
        <div className="absolute inset-y-3 left-0.5 w-px bg-transparent group-hover:bg-secondary/45 group-active:bg-secondary/70 transition-colors" />
      </div>

      {isPipeline ? (
        <OpenSpecInspector
          sectionState={sectionState}
          isReviewOpen={reviewOpen}
          onOpenReview={toggleReviewOpen}
          onRespondDecision={handleRespondDecision}
          controlNotice={decisionNotice}
          sendingDecisions={sendingDecisions}
        >
          {renderWorkingTreeBlock()}
        </OpenSpecInspector>
      ) : selectedCommit ? (
        <div className="flex flex-col h-full">
          {/* Header bar: solo cuando hay commit elegido en vista Grafo */}
          <div className="px-4 py-2 bg-bg-surface/75 flex items-center justify-between shrink-0">
            <span className="text-[length:var(--font-size-2xs)] font-bold text-text-secondary uppercase tracking-wider">
              {t('commit.detailsTitle')}
            </span>
            <button
              type="button"
              onClick={() => setSelectedCommit(null)}
              className="text-[length:var(--font-size-xs)] text-text-secondary hover:text-bg-base px-2 py-0.5 rounded hover:bg-secondary transition-colors"
              title={t('commit.goToStagingTooltip')}
            >
              {t('commit.viewChangesBtn')}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            <SidebarSection
              title={t('commit.detailsTitle')}
              icon={<GitCommitHorizontal size={13} aria-hidden="true" />}
              isOpen={sectionState.isOpen('details-commit')}
              onToggle={() => sectionState.toggle('details-commit')}
            >
              <div className="p-4 bg-bg-surface/75">
                <div className="flex justify-between items-start mb-2">
                  <div className="text-[length:var(--font-size-xs)] font-mono text-secondary select-text">commit: {selectedCommit.shortHash}</div>
                  <button type="button" className="flex items-center gap-1.5 px-2 py-1 rounded bg-border-subtle text-xs hover:bg-bg-surface/70 transition-colors">
                    <Zap size={12} className="text-git-mod" /> {t('commit.explainBtn')}
                  </button>
                </div>
                <h2 className="font-semibold mb-1 select-text">{selectedCommit.message}</h2>
                <div className="text-xs text-text-secondary mb-4 select-text">{formatDate(selectedCommit.date)}</div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">
                    {formatInitials(selectedCommit.authorName)}
                  </div>
                  <div>
                    <div className="text-sm font-medium select-text">{selectedCommit.authorName}</div>
                    <div className="text-[length:var(--font-size-xs)] text-text-secondary select-text">{selectedCommit.authorEmail}</div>
                  </div>
                </div>
              </div>
            </SidebarSection>

            <SidebarSection
              title={t('commit.filesSectionTitle')}
              count={commitFiles.length}
              icon={<Files size={13} aria-hidden="true" />}
              isOpen={sectionState.isOpen('details-commit-files')}
              onToggle={() => sectionState.toggle('details-commit-files')}
            >
              <div className="p-1">
                {commitFilesLoading ? (
                  <p className="px-4 py-3 text-xs text-text-secondary/70 italic">{t('commit.loadingFiles')}</p>
                ) : commitFiles.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-text-secondary/70 text-center">{t('commit.noFiles')}</p>
                ) : (
                  commitFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => onOpenCommitFile(file)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                        selectedFile?.path === file.path
                          ? 'bg-secondary/10 text-secondary'
                          : 'text-text-secondary hover:bg-bg-surface/70 hover:text-text-primary',
                      )}
                    >
                      <span className={cn(
                        'text-[length:var(--font-size-2xs)] font-bold w-4 shrink-0',
                        file.status === 'added' ? 'text-secondary' :
                        file.status === 'deleted' ? 'text-error' :
                        file.status === 'renamed' ? 'text-primary' :
                        'text-git-mod',
                      )}>
                        {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M'}
                      </span>
                      <span className="truncate text-xs select-text">{file.path}</span>
                    </button>
                  ))
                )}
              </div>
            </SidebarSection>

            {modifiedFiles.length > 0 && (
              <SidebarSection
                title={t('commit.worktreeSectionTitle')}
                count={modifiedFiles.length}
                icon={<FolderGit2 size={13} aria-hidden="true" />}
                extra={
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedCommit(null)}
                      className="text-[length:var(--font-size-xs)] font-bold text-git-mod hover:text-bg-base hover:bg-git-mod px-2 py-0.5 rounded transition-colors"
                    >
                      {t('commit.viewChangesBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={onOpenStashModal}
                      disabled={isLoading}
                      className="text-[length:var(--font-size-xs)] font-bold text-git-mod hover:text-bg-base hover:bg-git-mod px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                      title={t('commit.stashTooltip')}
                    >
                      Stash
                    </button>
                  </div>
                }
                isOpen={sectionState.isOpen('details-worktree')}
                onToggle={() => sectionState.toggle('details-worktree')}
              >
                <div className="p-1">
                  {modifiedFiles.map((file) => (
                    <button
                      key={`${file.staged ? 'staged' : 'unstaged'}:${file.path}`}
                      type="button"
                      onClick={() => {
                        setSelectedCommit(null);
                        onSelectFile(file);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1 text-left text-text-secondary hover:bg-git-mod/10 hover:text-text-primary transition-colors"
                      title={file.path}
                    >
                      <span className={cn(
                        'w-4 shrink-0 text-[length:var(--font-size-2xs)] font-bold',
                        file.status === 'deleted' ? 'text-error' : file.status === 'modified' ? 'text-git-mod' : 'text-secondary',
                      )}>
                        {file.status === 'added' || file.status === 'untracked'
                          ? 'A'
                          : file.status === 'deleted'
                            ? 'D'
                            : file.status === 'renamed' ? 'R' : 'M'}
                      </span>
                      <span className="truncate text-[length:var(--font-size-xs)] flex-1">{file.path}</span>
                      {file.staged && <span className="text-[length:var(--font-size-2xs)] text-secondary">{t('commitTab.staged')}</span>}
                    </button>
                  ))}
                </div>
              </SidebarSection>
            )}

            {renderCommitBox()}
          </div>
        </div>
      ) : (
        <div className="flex flex-col h-full">
          <div className="flex-1 overflow-y-auto min-h-0">
            {renderWorkingTreeBlock()}
          </div>
        </div>
      )}
    </aside>
  );
}
