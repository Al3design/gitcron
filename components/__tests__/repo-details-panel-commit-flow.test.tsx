// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoDetailsPanel } from '../RepoDetailsPanel';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { clearDraftLog, startDraftLog, appendDraftChunks } from '@/lib/commit-draft-log';
import type { GitFile } from '@/lib/git-store';

const commitChangesSpy = vi.fn().mockResolvedValue(true);
const stageFileSpy = vi.fn().mockResolvedValue(true);
const stageFilesSpy = vi.fn().mockResolvedValue(true);

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({
    commitChanges: commitChangesSpy,
    stageFile: stageFileSpy,
    stageFiles: stageFilesSpy,
    continueInteractiveRebase: vi.fn(),
    abortInteractiveRebase: vi.fn(),
    undoInteractiveRebase: vi.fn(),
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
];

function renderPanel(activeTab: 'Pipeline' | 'Graph', overrides?: { detailsW?: number; visible?: boolean }) {
  return render(
    <RepoDetailsPanel
      activeTab={activeTab}
      graphMode="chronometric"
      detailsW={overrides?.detailsW ?? 320}
      visible={overrides?.visible ?? true}
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
}

describe('RepoDetailsPanel — Flujo de Commit Unificado y Cuatro Estados (Fase 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDraftLog();
    usePipelineStore.setState({
      prepareOpen: false,
      aiNotice: null,
      snapshot: null,
      projection: null,
      runtimeHistory: [],
      selectedChangeId: null,
      openSpecificationId: null,
      expandedChanges: {},
      lastPreparedCount: null,
    });
    useGitStore.setState({
      repoPath: 'C:/test-repo',
      currentBranch: 'feature/unify-panels',
      selectedCommit: null,
      modifiedFiles: mockFiles,
      commitMessage: 'feat: unificar paneles',
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    clearDraftLog();
  });

  it('1. Cubre los cuatro estados del panel derecho con rerender real sobre DOM montado', () => {
    // ESTADO 1: SDD con prepareOpen: false -> Monta secciones de SDD (actividad, atención, herramientas) y operaciones Git
    usePipelineStore.setState({ prepareOpen: false });
    useGitStore.setState({ selectedCommit: null });
    const { rerender } = renderPanel('Pipeline');

    expect(screen.getByText('pipeline.openspec.activity.title')).toBeDefined();
    expect(screen.getByText('pipeline.openspec.rail.tools')).toBeDefined();
    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();

    // ESTADO 2: SDD con prepareOpen: true -> Monta secciones de SDD + flujo de commit
    act(() => {
      usePipelineStore.setState({ prepareOpen: true });
    });
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
    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();
    expect(screen.getByText(/staging\.stagedTitle/)).toBeDefined();
    expect(screen.getByText('src/main.ts')).toBeDefined();

    // ESTADO 3: Grafo con selectedCommit != null -> Monta Detalle de Commit
    act(() => {
      usePipelineStore.setState({ prepareOpen: false });
      useGitStore.setState({
        selectedCommit: {
          hash: 'abc123456789',
          shortHash: 'abc1234',
          message: 'commit previo',
          authorName: 'Ale Developer',
          authorEmail: 'ale@gitcron.com',
          date: '2026-08-22T10:00:00Z',
          parents: [],
          refs: [],
        },
      });
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
    expect(screen.getByText(/commit:\s*abc1234/)).toBeDefined();
    expect(screen.queryByText(/staging\.unstagedTitle/)).toBeNull();
    expect(screen.queryByText('pipeline.openspec.activity.title')).toBeNull();

    // ESTADO 4: Grafo con selectedCommit == null -> Monta StagingPanel (flujo libre)
    act(() => {
      useGitStore.setState({ selectedCommit: null });
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

    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();
    expect(screen.getByText(/staging\.stagedTitle/)).toBeDefined();
    expect(screen.queryByText('commit.detailsTitle')).toBeNull();
    expect(screen.queryByText('pipeline.openspec.activity.title')).toBeNull();
  });

  it('2. Confirmar desde la vista SDD invoca EXACTAMENTE la misma función que confirmar desde el grafo', () => {
    // 2.1 Confirmar desde SDD con prepareOpen: true
    usePipelineStore.setState({ prepareOpen: true });
    useGitStore.setState({
      selectedCommit: null,
      modifiedFiles: [{ path: 'file1.ts', status: 'modified', staged: true, conflicted: false }],
      commitMessage: 'commit desde SDD',
    });

    const { unmount } = renderPanel('Pipeline');

    const commitButtonSDD = screen.getByRole('button', { name: /staging\.commitWithCountBtn/ });
    fireEvent.click(commitButtonSDD);

    expect(commitChangesSpy).toHaveBeenCalledTimes(1);

    unmount();

    // 2.2 Confirmar desde Graph con selectedCommit: null
    useGitStore.setState({
      selectedCommit: null,
      modifiedFiles: [{ path: 'file1.ts', status: 'modified', staged: true, conflicted: false }],
      commitMessage: 'commit desde Grafo',
    });

    renderPanel('Graph');

    const commitButtonGraph = screen.getByRole('button', { name: /staging\.commitWithCountBtn/ });
    fireEvent.click(commitButtonGraph);

    // Ambas vistas invocan exactamente el mismo commitChanges de useGitActions
    expect(commitChangesSpy).toHaveBeenCalledTimes(2);
  });

  it('3. La bitácora aparece cuando hay redacción en curso y no ocupa lugar cuando no la hay, en las dos vistas', () => {
    // 3.1 Sin redacción en curso: no ocupa lugar (0 nodos en el DOM)
    usePipelineStore.setState({ prepareOpen: true, aiNotice: null });
    const { rerender } = renderPanel('Pipeline');

    expect(screen.queryByLabelText('pipeline.openspec.prepare.aiLogTitle')).toBeNull();

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
    expect(screen.queryByLabelText('pipeline.openspec.prepare.aiLogTitle')).toBeNull();

    // 3.2 Con redacción en curso: aparece en el DOM en ambas vistas
    act(() => {
      startDraftLog('draft-42');
      appendDraftChunks({
        draftId: 'draft-42',
        chunks: [
          {
            kind: 'reasoning',
            text: 'Analizando archivos preparados para redactar el commit...',
          },
        ],
      });
    });

    // En Graph
    expect(screen.getByLabelText('pipeline.openspec.prepare.aiLogTitle')).toBeDefined();
    expect(screen.getByText(/Analizando archivos preparados/)).toBeDefined();

    // En SDD (con prepareOpen: true)
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
    expect(screen.getByLabelText('pipeline.openspec.prepare.aiLogTitle')).toBeDefined();
    expect(screen.getByText(/Analizando archivos preparados/)).toBeDefined();
  });

  it('4. La rama destino se muestra en el flujo de commit en ambas vistas', () => {
    useGitStore.setState({ currentBranch: 'change/compartir-paneles-laterales' });

    // 4.1 En vista SDD (con prepareOpen: true)
    usePipelineStore.setState({ prepareOpen: true });
    const { rerender } = renderPanel('Pipeline');

    expect(
      screen.getByText(/pipeline\.openspec\.prepare\.toBranch.*"branch":"change\/compartir-paneles-laterales"/)
    ).toBeDefined();

    // 4.2 En vista Grafo
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

    expect(
      screen.getByText(/pipeline\.openspec\.prepare\.toBranch.*"branch":"change\/compartir-paneles-laterales"/)
    ).toBeDefined();
  });
});
