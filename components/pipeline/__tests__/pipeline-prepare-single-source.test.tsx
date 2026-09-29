// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import { RepoDetailsPanel } from '../../RepoDetailsPanel';
import { useGitStore, type GitFile } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { clearDraftLog } from '@/lib/commit-draft-log';
import type { PipelineSnapshot } from '../pipeline-view-state';
import type { OpenSpecEngineStatus, OpenSpecUpdatePlan } from '@/types/pipeline';

const stageFilesSpy = vi.fn().mockResolvedValue(true);
const commitChangesSpy = vi.fn().mockResolvedValue(true);

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({
    stageFiles: stageFilesSpy,
    stageFile: vi.fn().mockResolvedValue(true),
    commitChanges: commitChangesSpy,
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

function task(id: string, completed: boolean) {
  return { id, text: `${id} tarea ${id}`, completed, line: 1, sourceRef: 'tasks.md:1' };
}

function makeSnapshot(): PipelineSnapshot {
  return {
    schemaVersion: '1.0',
    repoId: 'repo-1',
    availableSources: ['git'],
    hermesConnected: false,
    hasPipelineActivity: true,
    now: {
      headlineKey: 'x', runtime: null, role: null, taskLabel: null,
      tasksDone: null, tasksTotal: null, elapsedMs: null,
      costUsd: null, costBasis: 'unknown', needsHuman: false,
    },
    stations: [],
    decisions: [],
    agents: [],
    activity: [],
    economy: { reasoningAvailable: null } as PipelineSnapshot['economy'],
    diffs: [],
    openSpec: {
      selectedChangeId: 'demo-change',
      activeChanges: [{
        changeId: 'demo-change',
        intent: 'una intención',
        tasks: [task('1.1', false)],
        proposalExists: true,
        designExists: true,
        specsCount: 1,
        validation: 'unknown',
        artifacts: null,
      }],
      archivedChanges: [],
      specifications: [],
      reports: [],
      diagnostics: [],
      observedAt: null,
      latestGate: null,
    },
  } as PipelineSnapshot;
}

const mockEngineStatus: OpenSpecEngineStatus = {
  cli: {
    installed: true,
    runtimeVersion: '1.5.0',
    provenance: 'local',
    displayPath: 'node_modules/.bin/openspec',
    supportedRange: { min: '1.5.0', max: '1.8.0' },
    versionClass: 'supported',
    evidenceStatus: 'confirmed',
    diagnostics: [],
  },
  latestAvailable: {
    status: 'online',
    latestVersion: '1.8.0',
    checkedAt: new Date().toISOString(),
    fromCache: false,
    cacheAgeSeconds: 0,
    freshness: 'fresh',
    error: null,
  },
  globalConfig: null,
  installedIntegration: null,
  repoState: 'initialized',
  integrationState: 'outdated',
};

const mockUpdatePlan: OpenSpecUpdatePlan | null = null;

function IntegratedPipelineView({ workingTreeClean = true }: { workingTreeClean?: boolean } = {}) {
  return (
    <div data-testid="integrated-container">
      <OpenSpecDashboard
        snapshot={makeSnapshot()}
        repoPath="C:/repo"
        currentBranch="change/demo-change"
        workingTreeClean={workingTreeClean}
        leftOpen={false}
        rightOpen={true}
        leftWidth={320}
        rightWidth={320}
        onResizeLeft={() => undefined}
        onResizeRight={() => undefined}
        projection={null}
        runtimeHistory={[]}
        onRefresh={() => undefined}
        onPauseAfterTask={() => undefined}
        onRespondDecision={() => undefined}
      />
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
    </div>
  );
}

describe('OpenSpecDashboard / RepoDetailsPanel — Única fuente de verdad para prepareOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDraftLog();
    vi.stubGlobal('window', {
      api: {
        pipelineOpenSpec: {
          getEngineStatus: vi.fn().mockResolvedValue(mockEngineStatus),
          checkLatestVersion: vi.fn().mockResolvedValue(null),
          getUpdatePlan: vi.fn().mockResolvedValue(mockUpdatePlan),
          installLocal: vi.fn().mockResolvedValue({
            success: true,
            engineStatus: {
              ...mockEngineStatus,
              cli: {
                ...mockEngineStatus.cli,
                runtimeVersion: '1.8.0',
              },
            },
          }),
          installGlobal: vi.fn().mockResolvedValue({
            success: true,
            engineStatus: {
              ...mockEngineStatus,
              cli: {
                ...mockEngineStatus.cli,
                runtimeVersion: '1.8.0',
              },
            },
          }),
          runUpdate: vi.fn().mockResolvedValue({
            success: true,
            status: 'completed',
            filesUpdated: ['openspec/config.yaml'],
            errors: [],
          }),
        },
        commitAi: {
          catalog: vi.fn().mockResolvedValue({ data: [] }),
          deviceNames: vi.fn().mockResolvedValue({ data: {} }),
          onChunk: vi.fn(() => () => {}),
        },
      },
    });
    usePipelineStore.setState({
      prepareOpen: false,
      reviewOpen: false,
      aiNotice: null,
      snapshot: makeSnapshot(),
      projection: null,
      runtimeHistory: [],
      selectedChangeId: 'demo-change',
      openSpecificationId: null,
      expandedChanges: {},
      lastPreparedCount: null,
    });
    useGitStore.setState({
      repoPath: 'C:/repo',
      currentBranch: 'change/demo-change',
      selectedCommit: null,
      modifiedFiles: mockFiles,
      commitMessage: '',
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    clearDraftLog();
  });

  it('1. Abrir la preparación desde la franja -> el panel derecho muestra el flujo de commit', () => {
    render(<IntegratedPipelineView />);

    // Inicialmente: panel derecho con secciones de SDD y flujo Git unificado; cuerpo sin vista de preparación
    expect(screen.getByText('pipeline.openspec.activity.title')).toBeDefined();
    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();
    expect(screen.queryByText('pipeline.openspec.prepare.close')).toBeNull();

    // Abrir preparación desde el botón de la franja
    const stripButton = screen.getByTitle('pipeline.openspec.prepare.open');
    fireEvent.click(stripButton);

    // Se abre la vista de preparación en el cuerpo y el panel derecho mantiene el flujo de commit
    expect(screen.getByText('pipeline.openspec.prepare.close')).toBeDefined();
    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();
    expect(screen.getByText(/staging\.stagedTitle/)).toBeDefined();
    expect(usePipelineStore.getState().prepareOpen).toBe(true);
  });

  it('2. Cerrarla con «Cerrar» desde el cuerpo -> el panel derecho VUELVE al inspector', () => {
    render(<IntegratedPipelineView />);

    // Abrir preparación desde la franja
    const stripButton = screen.getByTitle('pipeline.openspec.prepare.open');
    fireEvent.click(stripButton);

    // Verificar que abrió flujo de preparación en el cuerpo central
    expect(screen.getByText('pipeline.openspec.prepare.close')).toBeDefined();
    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();

    // Cerrar preparación usando el botón «Cerrar» del cuerpo central
    const closeButton = screen.getByText('pipeline.openspec.prepare.close');
    fireEvent.click(closeButton);

    // El cuerpo central cierra la preparación; el panel derecho conserva el inspector con operaciones Git
    expect(screen.getByText('pipeline.openspec.activity.title')).toBeDefined();
    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();
    expect(screen.queryByText('pipeline.openspec.prepare.close')).toBeNull();
    expect(usePipelineStore.getState().prepareOpen).toBe(false);
  });

  it('3. Abrirla desde el cuerpo (camino línea 1631) y cerrarla desde la franja -> vuelve al inspector', async () => {
    render(<IntegratedPipelineView />);

    // Abrir sección herramientas en el inspector y luego abrir revisión
    fireEvent.click(screen.getByRole('button', { name: /rail\.tools/ }));
    const reviewButton = await screen.findByText('pipeline.openspec.config.open');
    fireEvent.click(reviewButton);

    // Ejecutar actualización para habilitar la preparación
    const executeBtn = await screen.findByText('pipeline.openspec.engine.summary.updateAll');
    fireEvent.click(executeBtn);

    // Click en botón de preparar commit dentro de la revisión (onPrepareCommit / línea 1631)
    const prepareCommitFromReviewBtn = await screen.findByText('pipeline.openspec.engine.review.prepareCommit');
    fireEvent.click(prepareCommitFromReviewBtn);

    // La preparación se abre en el cuerpo central
    expect(screen.getByText('pipeline.openspec.prepare.close')).toBeDefined();
    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();
    expect(usePipelineStore.getState().prepareOpen).toBe(true);

    // Cerrar preparación desde el botón de la franja
    const stripButton = screen.getByTitle('pipeline.openspec.prepare.open');
    fireEvent.click(stripButton);

    // Se cierra la preparación en el cuerpo central; el panel derecho conserva el inspector
    expect(screen.getByText('pipeline.openspec.activity.title')).toBeDefined();
    expect(screen.getByPlaceholderText('staging.commitMsgPlaceholder')).toBeDefined();
    expect(screen.queryByText('pipeline.openspec.prepare.close')).toBeNull();
    expect(usePipelineStore.getState().prepareOpen).toBe(false);
  });

  it('4. Que exista UNA sola fuente: tras cerrar por cualquiera de los dos caminos, el valor en store es false', async () => {
    const { unmount } = render(<IntegratedPipelineView />);

    // Camino A: Abrir desde franja, cerrar desde cuerpo con «Cerrar»
    fireEvent.click(screen.getByTitle('pipeline.openspec.prepare.open'));
    expect(usePipelineStore.getState().prepareOpen).toBe(true);
    fireEvent.click(screen.getByText('pipeline.openspec.prepare.close'));
    expect(usePipelineStore.getState().prepareOpen).toBe(false);

    unmount();

    // Camino B: Abrir desde cuerpo (revisión), cerrar desde franja
    render(<IntegratedPipelineView />);
    fireEvent.click(screen.getByRole('button', { name: /rail\.tools/ }));
    const reviewButton = await screen.findByText('pipeline.openspec.config.open');
    fireEvent.click(reviewButton);
    const executeBtn = await screen.findByText('pipeline.openspec.engine.summary.updateAll');
    fireEvent.click(executeBtn);
    const prepareCommitBtn = await screen.findByText('pipeline.openspec.engine.review.prepareCommit');
    fireEvent.click(prepareCommitBtn);
    expect(usePipelineStore.getState().prepareOpen).toBe(true);
    fireEvent.click(screen.getByTitle('pipeline.openspec.prepare.open'));
    expect(usePipelineStore.getState().prepareOpen).toBe(false);
  });
});
