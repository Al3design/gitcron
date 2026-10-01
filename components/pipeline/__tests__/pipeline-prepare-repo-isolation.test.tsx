// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore, type RepoState } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { getDraftLogSnapshot } from '@/lib/commit-draft-log';
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
let chunkHandler: ((event: unknown) => void) | null = null;
let draftStateHandler: ((event: unknown) => void) | null = null;
const onChunk = vi.fn((cb) => {
  chunkHandler = cb;
  return () => {
    if (chunkHandler === cb) chunkHandler = null;
  };
});
const onDraftState = vi.fn((cb) => {
  draftStateHandler = cb;
  return () => {
    if (draftStateHandler === cb) draftStateHandler = null;
  };
});
const resolvedModel = vi.fn().mockResolvedValue({ success: true, data: null });
const lastRequest = vi.fn().mockResolvedValue({ success: true, data: null });

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
  onChunk.mockClear();
  onDraftState.mockClear();
  resolvedModel.mockReset().mockResolvedValue({ success: true, data: null });
  lastRequest.mockReset().mockResolvedValue({ success: true, data: null });
  chunkHandler = null;
  draftStateHandler = null;
  stageFilesMock.mockReset().mockResolvedValue(true);

  usePipelineStore.getState().reset();
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
    value: {
      commitAi: {
        catalog,
        draft,
        load,
        cancel,
        unload,
        deviceNames,
        onChunk,
        onDraftState,
        resolvedModel,
        lastRequest,
      },
    },
  });
});

afterEach(() => {
  cleanup();
  usePipelineStore.getState().reset();
  useGitStore.setState({ openRepos: [], activeRepoIdx: -1, repoPath: null, commitMessage: '', modifiedFiles: [] });
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('Auditoría 4.2: Aislamiento entre dos repositorios en la preparación del commit', () => {
  it('1. Redacción pedida en A, cambio a B, desmontaje, llega la respuesta: el mensaje de B sigue vacío, el de A recibe el resultado redactado, commitAi.cancel no se llamó y aparece el aviso', async () => {
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

    // Ya no se cancela al cambiar de repositorio (D16 / tarea 2.4)
    expect(cancel).not.toHaveBeenCalled();

    // Llega la respuesta tardía de la redacción de A
    resolveDraft({
      success: true,
      data: {
        status: 'drafted',
        model: 'google/gemma-4-12b',
        subject: 'feat: redactado para A',
      },
    });

    // Esperar a que se procese la resolución diferida en repo A
    await vi.waitFor(() => {
      expect(useGitStore.getState().openRepos[0].commitMessage).toBe('feat: redactado para A');
    });

    const state = useGitStore.getState();
    expect(state.openRepos[1].commitMessage).toBe('');
    expect(state.commitMessage).toBe('');
    expect(state.openRepos[0].commitMessage).toBe('feat: redactado para A');
    expect(cancel).not.toHaveBeenCalled();
    expect(state.success).toContain('repoA');
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

  it('5. Montaje en <StrictMode>: pedir una redacción, desmontar el panel sin cambiar de repositorio, volver a montar: la redacción sigue (no se llamó a commitAi.cancel), se ve en curso con «Cancelar», y al resolver el mensaje llega al repositorio de origen', async () => {
    let resolveDraft!: (value: unknown) => void;
    draft.mockImplementation(() => new Promise((resolve) => {
      resolveDraft = resolve;
    }));

    const { unmount } = renderDashboard('C:/repoA', true);
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
    elegirTodo();
    await elegirModelo();
    fireEvent.click(botonRedactar());

    expect(draft).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ repoPath: 'C:/repoA' }));

    // Desmontar el panel sin cambiar de repositorio
    unmount();

    // No se cancela la redacción
    expect(cancel).not.toHaveBeenCalled();

    // Volver a montar el panel en el mismo repositorio
    renderDashboard('C:/repoA', true);

    // La preparación sigue abierta y la redacción en curso con «Cancelar»
    const cancelButton = screen.getByRole('button', { name: /prepare\.aiCancel/ });
    expect(cancelButton).toBeDefined();

    // Resuelve la redacción
    resolveDraft({
      success: true,
      data: {
        status: 'drafted',
        model: 'google/gemma-4-12b',
        subject: 'feat(repoA): redacción que sobrevivió al desmontaje',
      },
    });

    await vi.waitFor(() => {
      expect(useGitStore.getState().openRepos[0].commitMessage).toBe('feat(repoA): redacción que sobrevivió al desmontaje');
    });

    const state = useGitStore.getState();
    expect(state.commitMessage).toBe('feat(repoA): redacción que sobrevivió al desmontaje');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('6. Montaje en <StrictMode> con dos repositorios abiertos: pedir en A, pasar a B, resolver: el mensaje llega a A y no a B, no se llamó a commitAi.cancel, aparece el aviso con el nombre de A; volver a A muestra el pensamiento y el resultado', async () => {
    let resolveDraft!: (value: unknown) => void;
    draft.mockImplementation(() => new Promise((resolve) => {
      resolveDraft = resolve;
    }));

    // 1. Montar dashboard para A en StrictMode
    const { unmount: unmountA } = renderDashboard('C:/repoA', true);
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
    elegirTodo();
    await elegirModelo();
    fireEvent.click(botonRedactar());

    expect(draft).toHaveBeenCalledTimes(1);
    const draftCall = draft.mock.calls[0][0];
    const draftId = draftCall.draftId;
    expect(draftId).toBeDefined();

    // Simular que llegan pensamientos de la redacción
    if (chunkHandler) {
      chunkHandler({
        draftId,
        chunks: [{ kind: 'reasoning', text: 'Pensando razonamiento para A...' }],
      });
    }

    // 2. Pasar a B (cambiar repositorio activo y desmontar A)
    useGitStore.getState().setActiveRepoIdx(1);
    unmountA();

    // Montar dashboard para B en StrictMode
    const { unmount: unmountB } = renderDashboard('C:/repoB', true);

    // No se llamó a commitAi.cancel
    expect(cancel).not.toHaveBeenCalled();

    // 3. Resolver la redacción de A mientras B está en pantalla
    resolveDraft({
      success: true,
      data: {
        status: 'drafted',
        model: 'google/gemma-4-12b',
        subject: 'feat(repoA): commit completado de fondo',
      },
    });

    // 4. El mensaje llega a A y no a B
    await vi.waitFor(() => {
      expect(useGitStore.getState().openRepos[0].commitMessage).toBe('feat(repoA): commit completado de fondo');
    });
    expect(useGitStore.getState().openRepos[1].commitMessage).toBe('');
    expect(cancel).not.toHaveBeenCalled();

    // Aparece el aviso con el nombre de A
    expect(useGitStore.getState().success).toContain('repoA');

    // 5. Desmontar B y volver a A
    unmountB();
    useGitStore.getState().setActiveRepoIdx(0);

    // Montar dashboard para A en StrictMode
    renderDashboard('C:/repoA', true);

    // La preparación de A sigue abierta y muestra el resultado en el input
    await vi.waitFor(() => {
      const input = screen.getByLabelText(/pipeline\.openspec\.prepare\.message/) as HTMLInputElement;
      expect(input.value).toBe('feat(repoA): commit completado de fondo');
    });

    // Muestra el pensamiento acumulado para A
    const thoughtSnapshot = getDraftLogSnapshot(draftId);
    expect(thoughtSnapshot.reasoning).toContain('Pensando razonamiento para A...');
  });
});
