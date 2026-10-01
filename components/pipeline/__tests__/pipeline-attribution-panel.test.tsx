// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

/**
 * La atribución, vista desde el panel de preparación.
 *
 * El riesgo central de este trabajo no es técnico: una atribución que parece
 * cierta y no lo es lleva a confirmar en Git archivos que no corresponden,
 * creyendo que la aplicación lo verificó. Por eso lo que se comprueba acá no es
 * sólo que atribuya, sino **cómo lo dice**: la fuente en el rótulo, el punto
 * ciego a la vista, y nada preseleccionado.
 */

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({ stageFiles: vi.fn().mockResolvedValue(true), commitChanges: vi.fn() }),
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

function snapshot(): PipelineSnapshot {
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

function renderOn(currentBranch: string) {
  render(
    <OpenSpecDashboard
      snapshot={snapshot()}
      repoPath="C:/repo"
      currentBranch={currentBranch}
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
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
}

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

beforeEach(() => {
  usePipelineStore.getState().reset();
  useGitStore.setState({
    modifiedFiles: [{ path: 'components/algo.tsx', status: 'modified', staged: false }],
    commitMessage: '',
    setCommitMessage: vi.fn(),
  } as Partial<ReturnType<typeof useGitStore.getState>>);
  Object.defineProperty(window, 'api', { configurable: true, value: {} });
});

afterEach(() => {
  cleanup();
  usePipelineStore.getState().reset();
  useGitStore.setState({ modifiedFiles: [], commitMessage: '' });
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('la atribución en el panel de preparación', () => {
  it('parado en la rama de un cambio, el código se atribuye y la fuente se ve', () => {
    renderOn('change/mi-cambio');

    expect(screen.getByText(/prepare\.groupBranch:.*"change":"mi-cambio"/)).toBeTruthy();
    // El punto ciego se declara donde se atribuye, no en un reporte que nadie
    // abre al confirmar.
    expect(screen.getByText(/prepare\.groupBranchHelp:.*"branch":"change\/mi-cambio"/)).toBeTruthy();
  });

  it('en cualquier otra rama el código queda sin atribuir', () => {
    // No hereda el cambio que esté seleccionado: no saber no es saber que no.
    renderOn('main');

    expect(screen.getAllByText(/prepare\.groupUnattributed/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/prepare\.groupBranch/)).toBeNull();
  });

  it('la atribución no preselecciona nada', () => {
    // Preseleccionar reintroduce que el commit dependa de dónde esté el foco, y
    // acá además haría entrar por defecto lo que una declaración —no un hecho—
    // reclama.
    renderOn('change/mi-cambio');

    for (const box of screen.getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
  });
});
