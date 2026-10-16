import React from 'react';
import {
  GitBranch,
  Loader2,
  MinusSquare,
  PlusSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGitStore, type GitFile } from '@/lib/git-store';
import { suggestCommitMessage, fileKind, type CommitFileOrigin } from '@/lib/change-commit-scope';
import { useT } from '@/hooks/use-translation';
import {
  configWarningLines,
  lastValidNotices,
  paramWarningText,
} from '@/lib/gitcron-config-messages';
import type {
  CommitAiLastRequest,
  CommitAiParamWarning,
  CommitAiResolvedModel,
  CommitAiResolvedResult,
  LocalModel,
} from '@/types/commit-message-ai';
import { AiElapsed } from '../AiElapsed';
import { AiModelControls } from '../AiModelControls';
import { AiUseLine } from '../../ai/AiUseLine';
import { AiSentDetails } from '../../ai/AiSentDetails';
import type { OpenSpecChangeSummary } from '../pipeline-view-state';
import { usePrepareCommit } from './usePrepareCommit';
import styles from './SddPrepareCommit.module.css';
import shared from '../OpenSpecDashboard.module.css';

export function FileStatusBadge({ path, files }: { path: string; files: GitFile[] }) {
  const t = useT();
  const status = files.find((file) => file.path === path)?.status ?? 'modified';
  const label = t(`pipeline.openspec.prepare.state.${status}`);
  return (
    <span className={styles.fileStatus} data-status={status}>{label}</span>
  );
}

interface SddPrepareCommitHeaderProps {
  currentBranch: string;
  nothingLeftToPrepare: boolean;
  chosenLength: number;
  totalFiles: number;
  allChosen: boolean;
  prepareBusy: boolean;
  fixtureActive: boolean;
  onToggleAll: () => void;
  onPrepareCommit: () => void;
  onClose: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function SddPrepareCommitHeader({
  currentBranch,
  nothingLeftToPrepare,
  chosenLength,
  totalFiles,
  allChosen,
  prepareBusy,
  fixtureActive,
  onToggleAll,
  onPrepareCommit,
  onClose,
  t,
}: SddPrepareCommitHeaderProps) {
  return (
    <div className={styles.prepareHead}>
      <div className={shared.archiveConfirmHead}>
        <strong>{t('pipeline.openspec.prepare.title')}</strong>
        <span>{t('pipeline.openspec.prepare.help')}</span>
        <em className={styles.prepareBranch}>
          <GitBranch size={11} />
          {t('pipeline.openspec.prepare.toBranch', {
            branch: currentBranch || t('pipeline.openspec.repo.branchUnknown'),
          })}
        </em>
      </div>
      <div className={styles.prepareActions}>
        {!nothingLeftToPrepare && (
          <>
            <span className={styles.prepareCount}>
              {t('pipeline.openspec.prepare.selected', {
                count: chosenLength,
                total: totalFiles,
              })}
            </span>
            <button
              type="button"
              className={shared.secondaryAction}
              disabled={prepareBusy}
              onClick={onToggleAll}
            >
              {allChosen
                ? t('pipeline.openspec.prepare.deselectAll')
                : t('pipeline.openspec.prepare.selectAll')}
            </button>
            <button
              type="button"
              className={shared.primaryAction}
              aria-disabled={prepareBusy || fixtureActive || chosenLength === 0}
              onClick={onPrepareCommit}
            >
              {prepareBusy ? <Loader2 size={14} className={shared.spin} /> : <GitBranch size={14} />}
              {t('pipeline.openspec.prepare.action')}
            </button>
          </>
        )}
        <button
          type="button"
          className={shared.secondaryAction}
          onClick={onClose}
        >
          {t('pipeline.openspec.prepare.close')}
        </button>
      </div>
    </div>
  );
}

function SddPrepareCommitResolvedError({
  resolvedErrorText,
  rightOpen,
  aiNotice,
  t,
}: {
  resolvedErrorText: string;
  rightOpen: boolean;
  aiNotice: string | null;
  t: (key: string) => string;
}) {
  return (
    <section className={shared.aiPanel}>
      <div className={shared.aiRow}>
        <p className={styles.aiResolvedError} role="alert">
          {resolvedErrorText}
        </p>
        <button
          type="button"
          className={cn(shared.secondaryAction, shared.aiDraftAction)}
          disabled={true}
          title={resolvedErrorText}
        >
          {t('pipeline.openspec.prepare.aiDraft')}
        </button>
      </div>
      {!rightOpen && aiNotice && (
        <p className={shared.aiNotice} role="status">
          {aiNotice}
        </p>
      )}
    </section>
  );
}

function SddPrepareCommitWarnings({
  resolvedCommitModel,
  fixParamInFile,
  t,
}: {
  resolvedCommitModel: CommitAiResolvedModel;
  fixParamInFile: (warning: CommitAiParamWarning) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <>
      {lastValidNotices(resolvedCommitModel.configFiles, t).map((text) => (
        <p key={text} className={shared.aiNotice} role="status">
          {text}
        </p>
      ))}
      {configWarningLines(resolvedCommitModel.configWarnings, t).map((text) => (
        <p key={text} className={styles.aiConfigWarning}>
          {text}
        </p>
      ))}
      {resolvedCommitModel.paramWarnings?.map((warning: CommitAiParamWarning) => (
        <p key={warning.segments.join('.')} className={styles.aiConfigWarning}>
          {paramWarningText(warning, t)}
          {warning.file && warning.suggestion !== undefined && (
            <>
              {' '}
              <button
                type="button"
                className={styles.aiSentToggle}
                onClick={() => { void fixParamInFile(warning); }}
              >
                {t('pipeline.openspec.prepare.aiParamFix', { value: JSON.stringify(warning.suggestion) })}
              </button>
            </>
          )}
        </p>
      ))}
    </>
  );
}

function resolveQueueRepoName(queueRunningRepoPath: string | null): string | null {
  if (!queueRunningRepoPath) return null;
  const match = useGitStore.getState().openRepos.find((r) => r.path === queueRunningRepoPath);
  return match?.name ?? queueRunningRepoPath.split(/[\\/]/).filter(Boolean).pop() ?? queueRunningRepoPath;
}

interface SddPrepareCommitConfiguredAiProps {
  repoPath: string;
  resolvedCommitModel: CommitAiResolvedModel;
  resolvedFilesText: string;
  aiBusy: boolean;
  chosenLength: number;
  draftWithAi: () => Promise<void>;
  aiPhase: 'idle' | 'loading' | 'drafting' | 'queued';
  cancelAiDraft: () => void;
  rightOpen: boolean;
  aiNotice: string | null;
  aiStartedAt: number | null;
  aiOpKind: 'load' | 'draft' | 'eject' | undefined;
  queueRunningRepoPath: string | null;
  lastAiRequest: CommitAiLastRequest | null;
  fixParamInFile: (warning: CommitAiParamWarning) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function SddPrepareCommitConfiguredAi({
  repoPath,
  resolvedCommitModel,
  resolvedFilesText,
  aiBusy,
  chosenLength,
  draftWithAi,
  aiPhase,
  cancelAiDraft,
  rightOpen,
  aiNotice,
  aiStartedAt,
  aiOpKind,
  queueRunningRepoPath,
  lastAiRequest,
  fixParamInFile,
  t,
}: SddPrepareCommitConfiguredAiProps) {
  return (
    <section className={shared.aiPanel}>
      <AiUseLine
        use="gitcron-commit"
        repoPath={repoPath}
        sourceFile={resolvedFilesText || undefined}
        actions={
          <>
            <button
              type="button"
              className={cn(shared.secondaryAction, shared.aiDraftAction)}
              disabled={aiBusy || chosenLength === 0}
              onClick={draftWithAi}
            >
              <span className={aiPhase === 'drafting' ? 'ai-thinking-text' : undefined}>
                {aiPhase === 'drafting' || aiPhase === 'queued'
                  ? t('pipeline.openspec.prepare.aiBusy')
                  : t('pipeline.openspec.prepare.aiDraft')}
              </span>
            </button>
            {aiBusy && (
              <button type="button" className={shared.secondaryAction} onClick={cancelAiDraft}>
                {t('pipeline.openspec.prepare.aiCancel')}
              </button>
            )}
          </>
        }
      />
      <SddPrepareCommitWarnings
        resolvedCommitModel={resolvedCommitModel}
        fixParamInFile={fixParamInFile}
        t={t}
      />
      {!rightOpen && aiNotice && (
        <p className={shared.aiNotice} role="status">
          {aiNotice}
        </p>
      )}
      {aiBusy && (
        <AiElapsed
          phase={aiPhase}
          startedAt={aiStartedAt}
          kind={aiOpKind === 'eject' ? 'eject' : 'load'}
          queueRunningRepoName={resolveQueueRepoName(queueRunningRepoPath)}
        />
      )}
      <AiSentDetails use="gitcron-commit" request={lastAiRequest} />
    </section>
  );
}

function DynamicAiModelActions({
  aiNeedsLoad,
  aiBusy,
  chosenLength,
  aiModel,
  aiPhase,
  draftWithAi,
  cancelAiDraft,
  t,
}: {
  aiNeedsLoad: boolean;
  aiBusy: boolean;
  chosenLength: number;
  aiModel: string;
  aiPhase: string;
  draftWithAi: () => Promise<void>;
  cancelAiDraft: () => void;
  t: (key: string) => string;
}) {
  const isThinking = aiPhase === 'drafting';
  const isBusyDrafting = isThinking || aiPhase === 'queued';
  return (
    <>
      {!aiNeedsLoad && (
        <button
          type="button"
          className={cn(shared.secondaryAction, shared.aiDraftAction)}
          disabled={aiBusy || chosenLength === 0 || !aiModel}
          onClick={draftWithAi}
        >
          <span className={isThinking ? 'ai-thinking-text' : undefined}>
            {isBusyDrafting
              ? t('pipeline.openspec.prepare.aiBusy')
              : t('pipeline.openspec.prepare.aiDraft')}
          </span>
        </button>
      )}
      {aiBusy && (
        <button type="button" className={shared.secondaryAction} onClick={cancelAiDraft}>
          {t('pipeline.openspec.prepare.aiCancel')}
        </button>
      )}
    </>
  );
}

function DynamicAiFallbackControls({
  showNotice,
  aiNotice,
  showCancel,
  cancelAiDraft,
  t,
}: {
  showNotice: boolean;
  aiNotice: string | null;
  showCancel: boolean;
  cancelAiDraft: () => void;
  t: (key: string) => string;
}) {
  return (
    <>
      {showNotice && aiNotice && (
        <p className={shared.aiNotice} role="status">
          {aiNotice}
        </p>
      )}
      {showCancel && (
        <button type="button" className={shared.secondaryAction} onClick={cancelAiDraft}>
          {t('pipeline.openspec.prepare.aiCancel')}
        </button>
      )}
    </>
  );
}

interface SddPrepareCommitDynamicAiProps {
  repoPath: string;
  aiModel: string;
  commitUseStatus: ReturnType<typeof usePrepareCommit>['commitUseStatus'];
  setCommitUseStatus: ReturnType<typeof usePrepareCommit>['setCommitUseStatus'];
  aiModels: LocalModel[];
  setAiModels: React.Dispatch<React.SetStateAction<LocalModel[]>>;
  aiDeviceNames: Record<string, string>;
  aiBusy: boolean;
  aiPhase: 'idle' | 'loading' | 'drafting' | 'queued';
  aiStartedAt: number | null;
  aiOpKind: 'load' | 'draft' | 'eject' | undefined;
  queueRunningRepoPath: string | null;
  rightOpen: boolean;
  aiNotice: string | null;
  setAiNotice: (notice: string | null, repoPath?: string) => void;
  confirmAiLoad: () => Promise<void>;
  unloadAiModel: () => Promise<void>;
  aiNeedsLoad: boolean;
  chosenLength: number;
  draftWithAi: () => Promise<void>;
  cancelAiDraft: () => void;
  lastAiRequest: CommitAiLastRequest | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function SddPrepareCommitDynamicAi({
  repoPath,
  aiModel,
  commitUseStatus,
  setCommitUseStatus,
  aiModels,
  setAiModels,
  aiDeviceNames,
  aiBusy,
  aiPhase,
  aiStartedAt,
  aiOpKind,
  queueRunningRepoPath,
  rightOpen,
  aiNotice,
  setAiNotice,
  confirmAiLoad,
  unloadAiModel,
  aiNeedsLoad,
  chosenLength,
  draftWithAi,
  cancelAiDraft,
  lastAiRequest,
  t,
}: SddPrepareCommitDynamicAiProps) {
  return (
    <>
      <AiUseLine
        use="gitcron-commit"
        repoPath={repoPath}
        screenModel={aiModel || null}
        screenChoice
        onStatus={setCommitUseStatus}
      />
      {commitUseStatus?.canLoad && (
        <AiModelControls
          repoPath={repoPath}
          models={aiModels}
          deviceNames={aiDeviceNames}
          onModelsChange={setAiModels}
          busy={aiBusy}
          phase={aiPhase}
          startedAt={aiStartedAt}
          opKind={aiOpKind}
          queueRunningRepoPath={queueRunningRepoPath}
          notice={!rightOpen ? aiNotice : null}
          onNoticeChange={setAiNotice}
          onLoad={confirmAiLoad}
          onUnload={unloadAiModel}
          actions={
            <DynamicAiModelActions
              aiNeedsLoad={aiNeedsLoad}
              aiBusy={aiBusy}
              chosenLength={chosenLength}
              aiModel={aiModel}
              aiPhase={aiPhase}
              draftWithAi={draftWithAi}
              cancelAiDraft={cancelAiDraft}
              t={t}
            />
          }
        />
      )}
      <DynamicAiFallbackControls
        showNotice={!commitUseStatus?.canLoad && !rightOpen}
        aiNotice={aiNotice}
        showCancel={aiBusy && !commitUseStatus?.canLoad}
        cancelAiDraft={cancelAiDraft}
        t={t}
      />
      <AiSentDetails use="gitcron-commit" request={lastAiRequest} />
    </>
  );
}

interface SddPrepareCommitGroupProps {
  group: ReturnType<typeof usePrepareCommit>['commitScope']['groups'][number];
  chosenFiles: string[];
  modifiedFiles: GitFile[];
  prepareBusy: boolean;
  onToggleMany: (paths: string[]) => void;
  onToggleFile: (path: string, checked: boolean) => void;
  groupLabel: (origin: CommitFileOrigin) => string;
  groupHelp: (group: ReturnType<typeof usePrepareCommit>['commitScope']['groups'][number]) => string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function SddPrepareCommitGroup({
  group,
  chosenFiles,
  modifiedFiles,
  prepareBusy,
  onToggleMany,
  onToggleFile,
  groupLabel,
  groupHelp,
  t,
}: SddPrepareCommitGroupProps) {
  const paths = group.entries.map((entry) => entry.path);
  const allChosen = paths.every((path) => chosenFiles.includes(path));

  return (
    <div className={styles.fileGroup}>
      <p>
        <strong>{groupLabel(group.origin)} ({group.entries.length})</strong>
        <button
          type="button"
          className={styles.groupToggle}
          disabled={prepareBusy}
          onClick={() => onToggleMany(paths)}
        >
          {allChosen ? <MinusSquare size={12} /> : <PlusSquare size={12} />}
          {allChosen
            ? t('pipeline.openspec.prepare.deselectAll')
            : t('pipeline.openspec.prepare.selectAll')}
        </button>
      </p>
      <p className={styles.groupHelp}>{groupHelp(group)}</p>
      <ul className={styles.fileList}>
        {group.entries.map((entry) => (
          <li key={entry.path}>
            <label className={styles.fileChoice}>
              <input
                type="checkbox"
                checked={chosenFiles.includes(entry.path)}
                disabled={prepareBusy}
                onChange={(event) => onToggleFile(entry.path, event.target.checked)}
              />
              <FileStatusBadge path={entry.path} files={modifiedFiles} />
              <span>{entry.path}</span>
              {group.origin.kind === 'unattributed' && (
                <em className={styles.fileKind}>
                  {t(`pipeline.openspec.prepare.kind.${fileKind(entry.path)}`)}
                </em>
              )}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SddPrepareCommitProps {
  repoPath: string;
  currentBranch: string;
  selectedChange?: OpenSpecChangeSummary | null;
  fixtureActive?: boolean;
  rightOpen?: boolean;
}

export function SddPrepareCommit({
  repoPath,
  currentBranch,
  selectedChange = null,
  fixtureActive = false,
  rightOpen = false,
}: SddPrepareCommitProps) {
  const {
    t,
    tCount,
    commitMessage,
    setCommitMessage,
    modifiedFiles,
    chosenFiles,
    setChosenFiles,
    prepareBusy,
    lastPreparedCount,
    closePrepare,
    commitScope,
    nothingLeftToPrepare,
    chosen,
    toggleMany,
    prepareCommit,
    branchAttribution,
    groupLabel,
    groupHelp,
    aiModels,
    setAiModels,
    aiModel,
    aiDeviceNames,
    resolvedCommitModel,
    resolvedErrorText,
    resolvedFilesText,
    aiBusy,
    aiPhase,
    aiStartedAt,
    aiOpKind,
    queueRunningRepoPath,
    aiNotice,
    setAiNotice,
    lastAiRequest,
    commitUseStatus,
    setCommitUseStatus,
    aiNeedsLoad,
    confirmAiLoad,
    unloadAiModel,
    draftWithAi,
    cancelAiDraft,
    fixParamInFile,
  } = usePrepareCommit({
    repoPath,
    currentBranch,
    selectedChange,
    fixtureActive,
    rightOpen,
  });

  const handleToggleFile = (path: string, checked: boolean) => {
    setChosenFiles((current) => (
      checked ? [...current, path] : current.filter((file) => file !== path)
    ));
  };

  const handlePrepareCommit = () => {
    void prepareCommit().catch((error: unknown) => {
      setAiNotice(error instanceof Error ? error.message : t('pipeline.openspec.prepare.aiFailed', { detail: '—' }));
    });
  };

  return (
    <section className={styles.prepareArea} aria-label={t('pipeline.openspec.prepare.title')}>
      <SddPrepareCommitHeader
        currentBranch={currentBranch}
        nothingLeftToPrepare={nothingLeftToPrepare}
        chosenLength={chosen.length}
        totalFiles={commitScope.files.length}
        allChosen={chosen.length === commitScope.files.length}
        prepareBusy={prepareBusy}
        fixtureActive={fixtureActive}
        onToggleAll={() => toggleMany(commitScope.files.map((entry) => entry.path))}
        onPrepareCommit={handlePrepareCommit}
        onClose={closePrepare}
        t={t}
      />

      {nothingLeftToPrepare ? (
        <p className={styles.prepareEmpty}>
          {lastPreparedCount === null
            ? t('pipeline.openspec.prepare.empty')
            : tCount('pipeline.openspec.prepare.preparedSummary', lastPreparedCount)}
        </p>
      ) : (
        <>
          <label className={styles.messageField}>
            <strong>{t('pipeline.openspec.prepare.message')}</strong>
            <textarea
              rows={1}
              value={commitMessage}
              disabled={prepareBusy || aiBusy}
              placeholder={chosen.length > 0
                ? suggestCommitMessage(chosen, branchAttribution)
                : t('pipeline.openspec.prepare.messagePlaceholder')}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
          </label>

          {resolvedCommitModel && 'error' in resolvedCommitModel ? (
            <SddPrepareCommitResolvedError
              resolvedErrorText={resolvedErrorText}
              rightOpen={rightOpen}
              aiNotice={aiNotice}
              t={t}
            />
          ) : resolvedCommitModel ? (
            <SddPrepareCommitConfiguredAi
              repoPath={repoPath}
              resolvedCommitModel={resolvedCommitModel}
              resolvedFilesText={resolvedFilesText}
              aiBusy={aiBusy}
              chosenLength={chosen.length}
              draftWithAi={draftWithAi}
              aiPhase={aiPhase}
              cancelAiDraft={cancelAiDraft}
              rightOpen={rightOpen}
              aiNotice={aiNotice}
              aiStartedAt={aiStartedAt}
              aiOpKind={aiOpKind}
              queueRunningRepoPath={queueRunningRepoPath}
              lastAiRequest={lastAiRequest}
              fixParamInFile={fixParamInFile}
              t={t}
            />
          ) : (
            <SddPrepareCommitDynamicAi
              repoPath={repoPath}
              aiModel={aiModel}
              commitUseStatus={commitUseStatus}
              setCommitUseStatus={setCommitUseStatus}
              aiModels={aiModels}
              setAiModels={setAiModels}
              aiDeviceNames={aiDeviceNames}
              aiBusy={aiBusy}
              aiPhase={aiPhase}
              aiStartedAt={aiStartedAt}
              aiOpKind={aiOpKind}
              queueRunningRepoPath={queueRunningRepoPath}
              rightOpen={rightOpen}
              aiNotice={aiNotice}
              setAiNotice={setAiNotice}
              confirmAiLoad={confirmAiLoad}
              unloadAiModel={unloadAiModel}
              aiNeedsLoad={aiNeedsLoad}
              chosenLength={chosen.length}
              draftWithAi={draftWithAi}
              cancelAiDraft={cancelAiDraft}
              lastAiRequest={lastAiRequest}
              t={t}
            />
          )}

          {commitScope.groups.map((group) => (
            <SddPrepareCommitGroup
              key={group.key}
              group={group}
              chosenFiles={chosenFiles}
              modifiedFiles={modifiedFiles}
              prepareBusy={prepareBusy}
              onToggleMany={toggleMany}
              onToggleFile={handleToggleFile}
              groupLabel={groupLabel}
              groupHelp={groupHelp}
              t={t}
            />
          ))}
        </>
      )}
    </section>
  );
}
