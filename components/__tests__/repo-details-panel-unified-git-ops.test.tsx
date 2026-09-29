// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoDetailsPanel } from '../RepoDetailsPanel';
import { useGitStore, type GitFile } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { clearDraftLog } from '@/lib/commit-draft-log';

const commitChangesSpy = vi.fn().mockResolvedValue(true);
const stageFileSpy = vi.fn().mockResolvedValue(true);
const stageFilesSpy = vi.fn().mockResolvedValue(true);
const continueRebaseSpy = vi.fn().mockResolvedValue(true);
const abortRebaseSpy = vi.fn().mockResolvedValue(true);
const undoRebaseSpy = vi.fn().mockResolvedValue(true);

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({
    commitChanges: commitChangesSpy,
    stageFile: stageFileSpy,
    stageFiles: stageFilesSpy,
    continueInteractiveRebase: continueRebaseSpy,
    abortInteractiveRebase: abortRebaseSpy,
    undoInteractiveRebase: undoRebaseSpy,
  }),
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  tNow: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const mockFiles: GitFile[] = [
  { path: 'src/main.ts', status: 'modified', staged: true, conflicted: false },
  { path: 'README.md', status: 'modified', staged: false, conflicted: false },
  { path: 'scratch.txt', status: 'untracked', staged: false, conflicted: false },
];

function createDefaultCallbacks() {
  return {
    onResizeStart: vi.fn(),
    onOpenStashModal: vi.fn(),
    onOpenCommitFile: vi.fn(),
    onSelectFile: vi.fn(),
    onDiscardRequest: vi.fn(),
    onRequestAmend: vi.fn(),
    onRequestSquash: vi.fn(),
    onFileContextMenu: vi.fn(),
    onRequestResetAll: vi.fn(),
    onRequestCleanUntracked: vi.fn(),
  };
}

function renderPanelWithStrictMode(
  activeTab: 'Pipeline' | 'Graph',
  callbacks: ReturnType<typeof createDefaultCallbacks>
) {
  return render(
    <React.StrictMode>
      <RepoDetailsPanel
        activeTab={activeTab}
        graphMode="chronometric"
        detailsW={320}
        visible={true}
        isDragging={false}
        {...callbacks}
      />
    </React.StrictMode>
  );
}

describe('RepoDetailsPanel — Operaciones Git unificadas entre Graph y SDD (Tanda 09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDraftLog();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('window', {
      api: {
        gitShowFiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(null),
        },
      },
    });

    usePipelineStore.setState({
      prepareOpen: false,
      reviewOpen: false,
      aiNotice: null,
      projection: null,
      runtimeHistory: [],
      selectedChangeId: 'test-change',
      openSpecificationId: null,
      expandedChanges: {},
      lastPreparedCount: null,
    });

    useGitStore.getState().setRepoPath('C:/test-repo');
    useGitStore.setState({
      repoPath: 'C:/test-repo',
      currentBranch: 'change/cerrar-conexiones-operativas-de-sdd',
      selectedCommit: null,
      modifiedFiles: mockFiles,
      commitMessage: 'feat: unificar operaciones git',
      isLoading: false,
      rebaseInProgress: true,
      selectedFile: null,
    });
  });

  afterEach(() => {
    cleanup();
    clearDraftLog();
  });

  it('1. En vista Graph (sin commit): expone los mismos controles Git y conectan a los mismos callbacks', () => {
    const callbacks = createDefaultCallbacks();
    renderPanelWithStrictMode('Graph', callbacks);

    // Controles por rol y nombre / texto
    const stageAllBtn = screen.getByRole('button', { name: 'staging.stageAllBtn' });
    const cleanBtn = screen.getByRole('button', { name: 'staging.cleanUntrackedBtn' });
    const unstageAllBtn = screen.getByRole('button', { name: 'staging.unstageAllBtn' });
    const commitBtn = screen.getByRole('button', { name: /staging\.commitWithCountBtn/ });
    const amendBtn = screen.getByRole('button', { name: 'staging.amendBtn' });
    const squashBtn = screen.getByRole('button', { name: 'staging.squashBtn' });
    const undoRebaseBtn = screen.getByRole('button', { name: 'rebase.banner.btn.undo' });
    const abortRebaseBtn = screen.getByRole('button', { name: 'rebase.banner.btn.abort' });
    const continueRebaseBtn = screen.getByRole('button', { name: 'rebase.banner.btn.continue' });
    const stashBtn = screen.getByRole('button', { name: 'Stash' });

    expect(stageAllBtn).toBeDefined();
    expect(cleanBtn).toBeDefined();
    expect(unstageAllBtn).toBeDefined();
    expect(commitBtn).toBeDefined();
    expect(amendBtn).toBeDefined();
    expect(squashBtn).toBeDefined();
    expect(undoRebaseBtn).toBeDefined();
    expect(abortRebaseBtn).toBeDefined();
    expect(continueRebaseBtn).toBeDefined();
    expect(stashBtn).toBeDefined();

    // Invocaciones de callbacks y acciones Git
    fireEvent.click(stageAllBtn);
    expect(stageFilesSpy).toHaveBeenCalledWith(['README.md', 'scratch.txt'], true);

    fireEvent.click(cleanBtn);
    expect(callbacks.onRequestCleanUntracked).toHaveBeenCalledTimes(1);

    fireEvent.click(unstageAllBtn);
    expect(stageFilesSpy).toHaveBeenCalledWith(['src/main.ts'], false);

    fireEvent.click(commitBtn);
    expect(commitChangesSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(amendBtn);
    expect(callbacks.onRequestAmend).toHaveBeenCalledTimes(1);

    fireEvent.click(squashBtn);
    expect(callbacks.onRequestSquash).toHaveBeenCalledTimes(1);

    fireEvent.click(undoRebaseBtn);
    expect(undoRebaseSpy).toHaveBeenCalledWith('refs/gitcron/pre-rebase');

    fireEvent.click(abortRebaseBtn);
    expect(abortRebaseSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(continueRebaseBtn);
    expect(continueRebaseSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(stashBtn);
    expect(callbacks.onOpenStashModal).toHaveBeenCalledTimes(1);
  });

  it('2. En vista Pipeline con prepareOpen = false: el bloque Git está presente SIEMPRE y con los mismos controles y callbacks', () => {
    usePipelineStore.setState({ prepareOpen: false });
    const callbacks = createDefaultCallbacks();
    renderPanelWithStrictMode('Pipeline', callbacks);

    // Secciones superiores de SDD permanecen montadas
    expect(screen.getByText('pipeline.openspec.activity.title')).toBeDefined();
    expect(screen.getByText('pipeline.openspec.rail.tools')).toBeDefined();

    // Controles Git presentes en el inspector con preparación cerrada
    const stageAllBtn = screen.getByRole('button', { name: 'staging.stageAllBtn' });
    const cleanBtn = screen.getByRole('button', { name: 'staging.cleanUntrackedBtn' });
    const unstageAllBtn = screen.getByRole('button', { name: 'staging.unstageAllBtn' });
    const commitBtn = screen.getByRole('button', { name: /staging\.commitWithCountBtn/ });
    const amendBtn = screen.getByRole('button', { name: 'staging.amendBtn' });
    const squashBtn = screen.getByRole('button', { name: 'staging.squashBtn' });
    const undoRebaseBtn = screen.getByRole('button', { name: 'rebase.banner.btn.undo' });
    const abortRebaseBtn = screen.getByRole('button', { name: 'rebase.banner.btn.abort' });
    const continueRebaseBtn = screen.getByRole('button', { name: 'rebase.banner.btn.continue' });
    const stashBtn = screen.getByRole('button', { name: 'Stash' });

    expect(stageAllBtn).toBeDefined();
    expect(cleanBtn).toBeDefined();
    expect(unstageAllBtn).toBeDefined();
    expect(commitBtn).toBeDefined();
    expect(amendBtn).toBeDefined();
    expect(squashBtn).toBeDefined();
    expect(undoRebaseBtn).toBeDefined();
    expect(abortRebaseBtn).toBeDefined();
    expect(continueRebaseBtn).toBeDefined();
    expect(stashBtn).toBeDefined();

    // Todos los callbacks se invocan idénticamente en Pipeline
    fireEvent.click(stageAllBtn);
    expect(stageFilesSpy).toHaveBeenCalledWith(['README.md', 'scratch.txt'], true);

    fireEvent.click(cleanBtn);
    expect(callbacks.onRequestCleanUntracked).toHaveBeenCalledTimes(1);

    fireEvent.click(unstageAllBtn);
    expect(stageFilesSpy).toHaveBeenCalledWith(['src/main.ts'], false);

    fireEvent.click(commitBtn);
    expect(commitChangesSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(amendBtn);
    expect(callbacks.onRequestAmend).toHaveBeenCalledTimes(1);

    fireEvent.click(squashBtn);
    expect(callbacks.onRequestSquash).toHaveBeenCalledTimes(1);

    fireEvent.click(undoRebaseBtn);
    expect(undoRebaseSpy).toHaveBeenCalledWith('refs/gitcron/pre-rebase');

    fireEvent.click(abortRebaseBtn);
    expect(abortRebaseSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(continueRebaseBtn);
    expect(continueRebaseSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(stashBtn);
    expect(callbacks.onOpenStashModal).toHaveBeenCalledTimes(1);
  });

  it('3. En vista Pipeline con prepareOpen = true: mantiene los mismos controles y la caja de commit editable', () => {
    usePipelineStore.setState({ prepareOpen: true });
    const callbacks = createDefaultCallbacks();
    renderPanelWithStrictMode('Pipeline', callbacks);

    expect(screen.getByRole('button', { name: 'staging.stageAllBtn' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'staging.cleanUntrackedBtn' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'staging.unstageAllBtn' })).toBeDefined();
    expect(screen.getByRole('button', { name: /staging\.commitWithCountBtn/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'staging.amendBtn' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'staging.squashBtn' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'rebase.banner.btn.undo' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'rebase.banner.btn.abort' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'rebase.banner.btn.continue' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Stash' })).toBeDefined();

    const textarea = screen.getByPlaceholderText('staging.commitMsgPlaceholder');
    expect(textarea).toBeDefined();
    fireEvent.change(textarea, { target: { value: 'nueva nota' } });
    expect(useGitStore.getState().commitMessage).toBe('nueva nota');
  });
});
