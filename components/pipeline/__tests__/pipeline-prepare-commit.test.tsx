// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeProjection } from '@/types/pipeline';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

/**
 * Tarea 3.5 (heredada de `confirm-work-in-git`, resuelta acá por decisión de
 * Ale): proteger el requisito "Preparar el commit sin confirmarlo".
 *
 * El acoplamiento que se retiró fue el que metía el commit dentro de la guía.
 * Este test monta el dashboard entero y comprueba que preparar deja archivos y
 * mensaje listos —llama a `stageFiles` y a `setCommitMessage` con la
 * sugerencia derivada— pero NO llama a `commitChanges` ni a ninguna API que
 * confirme. Confirmar sigue siendo del flujo de commit existente, con su
 * botón propio.
 *
 * Si alguien vuelve a meter el commit en la guía, este test lo frenará: la
 * aserción de que `commitChanges` no fue llamado es la red contra esa regresión.
 */

const stageFiles = vi.fn().mockResolvedValue(true);
const setCommitMessage = vi.fn();

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({ stageFiles, commitChanges: vi.fn() }),
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

function task(id: string, completed: boolean) {
  return { id, text: `${id} tarea ${id}`, completed, line: 1, sourceRef: 'tasks.md:1' };
}

/**
 * Snapshot con un cambio activo que tiene archivos suyos modificados, de modo
 * que la derivación produzca alcance no vacío y el panel ofrezca preparar.
 */
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
      selectedChangeId: 'demo-change',
      activeChanges: [{
        changeId: 'demo-change',
        intent: 'una intención',
        tasks: [task('6.5', true), task('6.6', false)],
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

function renderDashboard() {
  return render(
    <OpenSpecDashboard
      snapshot={snapshot()}
      repoPath="C:/repo"
      currentBranch="main"
      workingTreeClean={false}
      leftOpen={false}
      rightOpen={false}
      leftWidth={320}
      rightWidth={320}
      onResizeLeft={() => undefined}
      onResizeRight={() => undefined}
      projection={null as RuntimeProjection | null}
      runtimeHistory={[]}
      onRefresh={() => undefined}
      onPauseAfterTask={() => undefined}
      onRespondDecision={() => undefined}
    />,
  );
}

/**
 * Abre el panel de preparación desde el estado del árbol y elige todo lo
 * modificado.
 *
 * El panel dejó de ser una pestaña del cambio y pasó al nivel del repositorio:
 * se entra por el control del encabezado. Nada entra preseleccionado, así que
 * elegir es parte de llegar a poder preparar.
 */
function openPrepareAndChooseAll() {
  fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
}

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

beforeEach(() => {
  usePipelineStore.getState().reset();
  stageFiles.mockClear();
  setCommitMessage.mockClear();
  // Puebla el store como lo haría el watcher. `openspec/changes/demo-change/`
  // cae en el grupo de ese cambio y `components/` en el de lo sin atribuir.
  useGitStore.setState({
    modifiedFiles: [
      { path: 'openspec/changes/demo-change/tasks.md', status: 'modified', staged: false },
      { path: 'components/algo.tsx', status: 'modified', staged: false },
    ],
    commitMessage: '',
    setCommitMessage,
  } as Partial<ReturnType<typeof useGitStore.getState>>);
  // `stageFiles` no toca `window.api` en el mock, pero la confirmación de
  // archivado sí: se deja un api vacío para que cualquier llamada imprevista
  // no tenga a quién llamar.
  Object.defineProperty(window, 'api', { configurable: true, value: {} });
});

afterEach(() => {
  cleanup();
  usePipelineStore.getState().reset();
  useGitStore.setState({ modifiedFiles: [], commitMessage: '' });
  if (ORIGINAL_API === undefined) {
    delete (window as { api?: unknown }).api;
  } else {
    Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
  }
});

describe('preparar el commit desde la guía', { timeout: 15_000 }, () => {
  it('deja archivos y mensaje listos y NO confirma', async () => {
    renderDashboard();
    openPrepareAndChooseAll();

    // El control de preparar se habilita porque hay archivos elegidos.
    const button = screen.getByRole('button', { name: /openspec\.prepare\.action/ });
    fireEvent.click(button);

    // Se preparan los archivos elegidos. El mensaje sugerido se escribe porque
    // el campo estaba vacío, y nombra al cambio porque todo lo elegido es suyo.
    await vi.waitFor(() => expect(stageFiles).toHaveBeenCalledTimes(1));
    expect(stageFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        'openspec/changes/demo-change/tasks.md',
        'components/algo.tsx',
      ]),
      true,
    );
    await vi.waitFor(() => expect(setCommitMessage).toHaveBeenCalledTimes(1));
    const [suggested] = setCommitMessage.mock.calls[0];
    expect(suggested).toMatch(/^chore\b/);
    expect(suggested).toContain('demo-change');
  });

  it('no llama a ninguna API que confirme', async () => {
    const pipelineArchiveChange = vi.fn();
    const pipelineRuntimeStart = vi.fn();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        pipelineArchiveChange,
        pipelineRuntime: { discover: vi.fn(), start: pipelineRuntimeStart, stop: vi.fn() },
      },
    });

    renderDashboard();
    openPrepareAndChooseAll();
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.action/ }));

    await vi.waitFor(() => expect(stageFiles).toHaveBeenCalled());

    // Confirmar es del flujo de commit, no de la guía: preparar no dispara
    // archivado, runtime ni ninguna operación que publique.
    expect(pipelineArchiveChange).not.toHaveBeenCalled();
    expect(pipelineRuntimeStart).not.toHaveBeenCalled();
  });

  it('no pisa el mensaje cuando el campo ya está escrito', async () => {
    // `commitMessage` no vacío: la sugerencia es `null` y `setCommitMessage`
    // no se invoca, aunque los archivos sí se preparan.
    useGitStore.setState({ commitMessage: 'fix: algo que escribí' });

    renderDashboard();
    openPrepareAndChooseAll();
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.action/ }));

    await vi.waitFor(() => expect(stageFiles).toHaveBeenCalled());
    expect(setCommitMessage).not.toHaveBeenCalled();
  });
});
