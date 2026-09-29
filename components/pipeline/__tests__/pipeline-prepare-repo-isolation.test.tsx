// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore, type RepoState } from '@/lib/git-store';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

const stageFilesMock = vi.fn().mockResolvedValue(true);

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({
    stageFiles: (...args: unknown[]) => stageFilesMock(...args),
    commitChanges: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const catalog = vi.fn();
const draft = vi.fn();
const load = vi.fn();
const cancel = vi.fn();
const unload = vi.fn();
const deviceNames = vi.fn();

function snapshot(repoId = 'repoA'): PipelineSnapshot {
  return {
    schemaVersion: '1.0',
    repoId,
    availableSources: ['git'],
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
    decisions: [],
    agents: [],
    activity: [],
    economy: { reasoningAvailable: null } as PipelineSnapshot['economy'],
    diffs: [],
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
  } as PipelineSnapshot;
}

function renderDashboard(repoPath: string, strict = false) {
  const Wrapper = strict ? StrictMode : ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return render(
    <Wrapper>
    <OpenSpecDashboard
      snapshot={snapshot(repoPath)}
      repoPath={repoPath}
      currentBranch="main"
      workingTreeClean={false}
      leftOpen={false}
      rightOpen={false}
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
    </Wrapper>,
  );
}

function elegirTodo() {
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
}

async function elegirModelo(id = 'google/gemma-4-12b') {
  await screen.findByRole('option', { name: new RegExp(id) });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
}

const botonRedactar = () => screen.getByRole('button', { name: /prepare\.aiDraft|prepare\.aiBusy/ });

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

function makeRepo(path: string, file: string): RepoState {
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    currentBranch: 'main',
    branches: ['main'],
    remoteBranches: [],
    commits: [],
    modifiedFiles: [{ path: file, status: 'modified' as const, staged: false }],
    stashes: [],
    tags: [],
    submodules: [],
    remotes: [],
    branchTracking: {},
    defaultRemoteBranch: null,
    worktrees: [],
    pullRequests: [],
    commitMessage: '',
    selectedCommit: null,
    selectedFile: null,
    currentDiff: '',
    graphShowAllBranches: false,
    graphMode: 'classic',
    cartographyExpandedRoles: [],
    inCartography: false,
    isLoading: false,
    error: null,
    success: null,
    lastFetchError: null,
    mergeInProgress: false,
    rebaseInProgress: false,
  };
}

beforeEach(() => {
  catalog.mockReset().mockResolvedValue({
    success: true,
    data: [
      {
        id: 'google/gemma-4-12b',
        displayName: 'Gemma 4 12B',
        kind: 'llm',
        loaded: true,
        loadedContextLength: 69120,
        maxContextLength: 262144,
        sizeBytes: 7556574286,
        params: '12B',
        quantization: 'Q4_K_M',
        reasoningDefault: 'on',
        reasoningCanBeOff: true,
        loadedInstanceId: 'google/gemma-4-12b',
        devices: ['dev-1'],
      },
    ],
  });
  draft.mockReset();
  load.mockReset().mockResolvedValue({ success: true, data: { output: '' } });
  cancel.mockReset().mockResolvedValue({ success: true, data: { cancelled: true } });
  unload.mockReset().mockResolvedValue({ success: true, data: { unloaded: true } });
  deviceNames.mockReset().mockResolvedValue({ success: true, data: {} });
  stageFilesMock.mockReset().mockResolvedValue(true);

  useGitStore.setState({
    openRepos: [makeRepo('C:/repoA', 'archivoA.ts'), makeRepo('C:/repoB', 'archivoB.ts')],
    activeRepoIdx: 0,
    repoPath: 'C:/repoA',
    repoName: 'repoA',
    currentBranch: 'main',
    commitMessage: '',
    modifiedFiles: [{ path: 'archivoA.ts', status: 'modified' as const, staged: false }],
  });

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { commitAi: { catalog, draft, load, cancel, unload, deviceNames } },
  });
});

afterEach(() => {
  cleanup();
  useGitStore.setState({ openRepos: [], activeRepoIdx: -1, repoPath: null, commitMessage: '', modifiedFiles: [] });
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('Auditoría 4.2: Aislamiento entre dos repositorios en la preparación del commit', () => {
  it('1. Redacción pedida en A, cambio a B, desmontaje, llega la respuesta: el mensaje de B sigue vacío, el de A no recibe un asunto de una redacción cancelada (queda como estaba), y commitAi.cancel se llamó una vez', async () => {
    let resolveDraft!: (value: unknown) => void;
    draft.mockImplementation(() => new Promise((resolve) => {
      resolveDraft = resolve;
    }));

    const { unmount } = renderDashboard('C:/repoA');
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
    elegirTodo();
    await elegirModelo();
    fireEvent.click(botonRedactar());

    expect(draft).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ repoPath: 'C:/repoA' }));

    // Cambio a B y desmontaje de A
    useGitStore.getState().setActiveRepoIdx(1);
    unmount();

    expect(cancel).toHaveBeenCalledTimes(1);

    // Llega la respuesta tardía de la redacción de A
    resolveDraft({
      success: true,
      data: {
        status: 'drafted',
        model: 'google/gemma-4-12b',
        subject: 'feat: redactado para A',
      },
    });

    // Esperar a que se procese la resolución diferida
    await new Promise((resolve) => setTimeout(resolve, 10));

    const state = useGitStore.getState();
    expect(state.openRepos[1].commitMessage).toBe('');
    expect(state.commitMessage).toBe('');
    expect(state.openRepos[0].commitMessage).toBe('');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('2. prepareCommit en A con stageFiles diferido, cambio a B antes de que resuelva: el mensaje de B sigue vacío y el de A recibe la sugerencia', async () => {
    let resolveStageFiles!: (value: boolean) => void;
    stageFilesMock.mockImplementation(() => new Promise((resolve) => {
      resolveStageFiles = resolve;
    }));

    const { unmount } = renderDashboard('C:/repoA');
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
    elegirTodo();

    const prepareBtn = screen.getByRole('button', { name: /pipeline\.openspec\.prepare\.action/ });
    fireEvent.click(prepareBtn);

    expect(stageFilesMock).toHaveBeenCalledTimes(1);

    // Cambio a B antes de que resuelva stageFiles
    useGitStore.getState().setActiveRepoIdx(1);
    unmount();

    // stageFiles resuelve con éxito
    resolveStageFiles(true);

    // Esperar a que prepareCommit escriba la sugerencia en repo A
    await vi.waitFor(() => {
      expect(useGitStore.getState().openRepos[0].commitMessage.trim().length).toBeGreaterThan(0);
    });

    const state = useGitStore.getState();
    expect(state.openRepos[1].commitMessage).toBe('');
    expect(state.commitMessage).toBe('');
    expect(state.openRepos[0].commitMessage).toMatch(/chore/);
  });

  it('3. Sin cambio de repo, la redacción escribe en A como hoy', async () => {
    draft.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'drafted',
        model: 'google/gemma-4-12b',
        subject: 'feat(repoA): mensaje redactado en A',
      },
    });

    renderDashboard('C:/repoA');
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
    elegirTodo();
    await elegirModelo();
    fireEvent.click(botonRedactar());

    await vi.waitFor(() => {
      expect(useGitStore.getState().openRepos[0].commitMessage).toBe('feat(repoA): mensaje redactado en A');
    });

    const state = useGitStore.getState();
    expect(state.commitMessage).toBe('feat(repoA): mensaje redactado en A');
    expect(state.openRepos[1].commitMessage).toBe('');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('4. En modo estricto de React (la app en desarrollo), Preparar termina: apaga el spinner y escribe la sugerencia', async () => {
    // Ale lo vio el 2026-09-29: el doble montaje de desarrollo dejaba el panel
    // creyéndose desmontado y el botón girando para siempre.
    stageFilesMock.mockResolvedValue(true);
    renderDashboard('C:/repoA', true);
    fireEvent.click(screen.getByRole('button', { name: /openspec.prepare.open/ }));
    elegirTodo();
    fireEvent.click(screen.getByRole('button', { name: /pipeline.openspec.prepare.action/ }));

    await vi.waitFor(() => {
      expect(useGitStore.getState().commitMessage).toMatch(/chore/);
    });
    // El botón deja de girar y lo elegido se vacía: la preparación terminó.
    await vi.waitFor(() => {
      const boton = screen.getByRole('button', { name: /pipeline.openspec.prepare.action/ });
      expect(boton.querySelector('[class*="spin"]')).toBeNull();
      expect(boton.getAttribute('aria-disabled')).toBe('true');
    });
  });
});
