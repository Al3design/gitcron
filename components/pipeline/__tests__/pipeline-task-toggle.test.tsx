// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeProjection } from '@/types/pipeline';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

/**
 * Marcar y desmarcar desde la aplicación.
 *
 * La asimetría es el punto: marcar agrega una afirmación que su autor hace en
 * ese momento, y desmarcar borra la constancia de algo que alguien afirmó antes
 * —además de quedar escrito en el registro—. Por eso sólo una dirección
 * pregunta.
 */

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({ stageFiles: vi.fn(), commitChanges: vi.fn() }),
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

function task(id: string, text: string, completed: boolean, line: number) {
  return { id, text, completed, line, sourceRef: `tasks.md:${line}` };
}

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
        tasks: [
          task('t1', '1.1 pendiente', false, 3),
          task('t2', '1.2 ya hecha', true, 4),
        ],
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

const pipelineSetTaskChecked = vi.fn().mockResolvedValue({ success: true });
const onRefresh = vi.fn();

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
      onRefresh={onRefresh}
      onPauseAfterTask={() => undefined}
      onRespondDecision={() => undefined}
    />,
  );
}

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

beforeEach(() => {
  pipelineSetTaskChecked.mockClear();
  onRefresh.mockClear();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { pipelineSetTaskChecked, pipelineRuntime: { discover: vi.fn(), start: vi.fn(), stop: vi.fn() } },
  });
});

afterEach(() => {
  cleanup();
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

/**
 * Entra al cambio desde la pantalla de entrada.
 *
 * El panel abre en el estado del repositorio y ya no cae al primer cambio de la
 * lista: entrar es una elección, así que los casos que miran el interior de un
 * cambio tienen que entrar primero.
 */
function enterChange() {
  const [enter] = screen.getAllByRole('button', { name: /openspec\.start\.enter/ });
  fireEvent.click(enter);
  // El cambio abre por defecto en Resumen; navegar a Tareas para interactuar con la lista
  const tasksBtn = screen.queryByRole('button', { name: /pipeline\.switcher\.tasks/ });
  if (tasksBtn) {
    fireEvent.click(tasksBtn);
  }
}

describe('cambiar el estado de una tarea desde la guía', { timeout: 15_000 }, () => {
  it('marcar escribe inmediatamente sin pedir confirmación', async () => {
    renderDashboard();
    enterChange();

    fireEvent.click(screen.getByRole('button', { name: /openspec\.task\.check$/ }));

    // Se envía la línea y el texto: el texto es lo que permite verificar que
    // sigue siendo la misma tarea.
    await vi.waitFor(() => expect(pipelineSetTaskChecked)
      .toHaveBeenCalledWith('C:/repo', 'demo-change', 3, '1.1 pendiente', true, 'persona'));
    // Y la lista se relee del disco, no se asume el resultado.
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('desmarcar pide confirmación y no escribe hasta obtenerla', async () => {
    renderDashboard();
    enterChange();

    fireEvent.click(screen.getByRole('button', { name: /openspec\.task\.uncheck$/ }));
    expect(pipelineSetTaskChecked).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /openspec\.task\.uncheckConfirm/ }));
    await vi.waitFor(() => expect(pipelineSetTaskChecked)
      .toHaveBeenCalledWith('C:/repo', 'demo-change', 4, '1.2 ya hecha', false, 'persona'));
  });

  it('la confirmación va en una superficie fija, no en el encabezado del panel', async () => {
    renderDashboard();
    enterChange();

    fireEvent.click(screen.getByRole('button', { name: /openspec\.task\.uncheck$/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.closest('.fixed')).not.toBeNull();
  });

  it('el aviso de desmarcado explica que borra la constancia', async () => {
    renderDashboard();
    enterChange();

    fireEvent.click(screen.getByRole('button', { name: /openspec\.task\.uncheck$/ }));

    expect(await screen.findByText(/openspec\.task\.uncheckHelp/)).toBeTruthy();
  });

  it('cancelar la confirmación deja la tarea como estaba', async () => {
    renderDashboard();
    enterChange();

    fireEvent.click(screen.getByRole('button', { name: /openspec\.task\.uncheck$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /openspec\.archive\.cancel/ }));

    expect(pipelineSetTaskChecked).not.toHaveBeenCalled();
  });

  it('un rechazo del IPC al marcar muestra el aviso de error al usuario y no deja rechazo sin manejar', async () => {
    pipelineSetTaskChecked.mockRejectedValueOnce(new Error('Permiso denegado'));
    renderDashboard();
    enterChange();

    fireEvent.click(screen.getByRole('button', { name: /openspec\.task\.check$/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Permiso denegado')).toBeTruthy();
  });

  it('un rechazo del IPC al desmarcar muestra el aviso de error tras confirmar', async () => {
    pipelineSetTaskChecked.mockRejectedValueOnce(new Error('Fallo en desmarcado'));
    renderDashboard();
    enterChange();

    fireEvent.click(screen.getByRole('button', { name: /openspec\.task\.uncheck$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /openspec\.task\.uncheckConfirm/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Fallo en desmarcado')).toBeTruthy();
  });
});
