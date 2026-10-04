// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeProjection } from '@/types/pipeline';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import { composeApplyInstruction } from '../pipeline-next-action';
import type { PipelineSnapshot } from '../pipeline-view-state';

/**
 * Cableado de props, no lógica.
 *
 * La lógica ya está cubierta sin DOM en `pipeline-next-action.test.ts` y
 * `pipeline-guided-forms.test.ts`. Lo que sólo se puede comprobar montando es
 * que las props lleguen efectivamente hasta el lanzador: el defecto original
 * era exactamente ese, una prop implementada que nadie pasaba.
 */

vi.mock('@/hooks/use-translation', () => ({
  // La traducción se reemplaza por la clave más sus params, así el test afirma
  // sobre el contrato de i18n y no sobre el texto en español.
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

function task(id: string, completed: boolean) {
  return { id, text: `tarea ${id}`, completed, line: 1, sourceRef: 'tasks.md:1' };
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
        tasks: [task('1.1', true), task('1.2', false)],
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

function renderDashboard(overrides: { fixtureActive?: boolean; projection?: RuntimeProjection | null } = {}) {
  return render(
    <OpenSpecDashboard
      snapshot={snapshot()}
      repoPath="C:/repo"
      currentBranch="main"
      workingTreeClean
      leftOpen={false}
      rightOpen={false}
      leftWidth={320}
      rightWidth={320}
      onResizeLeft={() => undefined}
      onResizeRight={() => undefined}
      projection={overrides.projection ?? null}
      runtimeHistory={[]}
      fixtureActive={overrides.fixtureActive ?? false}
      onRefresh={() => undefined}
      onPauseAfterTask={() => undefined}
      onRespondDecision={() => undefined}
    />,
  );
}

afterEach(() => {
  cleanup();
  delete (window as any).api;
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
}

describe('cableado de la guía con el lanzador', { timeout: 15_000 }, () => {
  it('ofrece continuar la próxima tarea con su identificador', () => {
    renderDashboard();
    enterChange();
    const action = screen.getByRole('button', { name: /pipeline\.next\.task\.action/ });
    expect(action.textContent).toContain('1.2');
    expect((action as HTMLButtonElement).disabled).toBe(false);
  });

  it('deshabilita la acción ejecutable cuando hay datos de vista previa', () => {
    renderDashboard({ fixtureActive: true });
    enterChange();
    // Con fixture el estado deja de ser "tarea pendiente": se declara vista
    // previa y no queda ninguna acción capaz de abrir un runtime.
    expect(screen.queryByRole('button', { name: /pipeline\.next\.task\.action/ })).toBeNull();
    expect(screen.getByText(/pipeline\.next\.fixture\.help/)).toBeTruthy();
  });

  it('no ofrece archivar mientras la validación no pasó', () => {
    renderDashboard();
    enterChange();
    expect(screen.queryByRole('button', { name: /readyToArchive\.action/ })).toBeNull();
  });

  it('conserva cambio y tarea al abrir el lanzador desde continuar', async () => {
    const discover = vi.fn().mockResolvedValue({
      success: true,
      data: [{
        runtime: 'claude',
        adapterId: 'a',
        installed: true,
        runtimeVersion: '1.0',
        launchable: true,
        startAvailability: 'available',
        startConstraints: ['edita archivos con Read, Grep, Glob, Edit y Write'],
        startModifiesRepo: true,
        diagnostics: [],
      }],
    });
    const start = vi.fn().mockResolvedValue({ success: true, data: { sessionId: 'sess-guided' } });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        pipelineRuntime: { discover, start, stop: vi.fn() },
        aiUse: {
          status: vi.fn().mockResolvedValue({
            success: true,
            data: {
              use: 'gitcron-sdd',
              status: 'resolved',
              modelRef: 'claude-code/claude-3-7-sonnet',
              modelId: 'claude-3-7-sonnet',
              providerName: 'Claude Code',
              modelSource: 'agent',
              isException: true,
              sourceFile: 'C:/repo/.gitcron/gitcron.json',
              runtime: 'claude',
              toolsExecutor: 'Claude Code',
              destination: 'external-service',
              available: true,
              // La clave que Main da a la línea del uso; el lanzador la devuelve al arrancar.
              launchKey: JSON.stringify(['claude-code/claude-3-7-sonnet', null]),
            },
          }),
          models: vi.fn().mockResolvedValue({ success: true, data: [] }),
          choose: vi.fn(),
        },
        commitAi: {
          onConfigChanged: vi.fn().mockReturnValue(() => {}),
        },
      },
    });

    renderDashboard();

    enterChange();
    screen.getByRole('button', { name: /pipeline\.next\.task\.action/ }).click();
    // El discovery del lanzador es asíncrono; se espera a que resuelva.
    await vi.waitFor(() => expect(discover).toHaveBeenCalledWith('C:/repo'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /launcher\.startApply/ })).toBeTruthy());

    // La sesión escribe en el repositorio: sin confirmar, el arranque no se
    // habilita por más que todo lo demás esté en orden.
    const startButton = screen.getByRole('button', { name: /launcher\.startApply/ }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    startButton.click();
    expect(start).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy());
    screen.getByRole('checkbox').click();
    await vi.waitFor(() => expect((screen.getByRole('button', { name: /launcher\.startApply/ }) as HTMLButtonElement).disabled).toBe(false));

    screen.getByRole('button', { name: /launcher\.startApply/ }).click();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0]).toMatchObject({
      repoPath: 'C:/repo',
      changeId: 'demo-change',
      taskId: '1.2',
      expectedModel: JSON.stringify(['claude-code/claude-3-7-sonnet', null]),
    });
    // Lo que se lanza es exactamente lo que la guía compuso: si se recompusiera
    // acá, lo mostrado bajo "Ver instrucción" y lo ejecutado podrían divergir.
    expect(start.mock.calls[0][0].instruction).toBe(composeApplyInstruction('demo-change', '1.2', 'tarea 1.2'));
  });

  it('no permite arrancar una sesión real desde datos de vista previa', async () => {
    const discover = vi.fn().mockResolvedValue({
      success: true,
      data: [{
        runtime: 'claude',
        adapterId: 'a',
        installed: true,
        runtimeVersion: '1.0',
        launchable: true,
        startAvailability: 'available',
        startConstraints: ['edita archivos con Read, Grep, Glob, Edit y Write'],
        startModifiesRepo: true,
        diagnostics: [],
      }],
    });
    const start = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pipelineRuntime: { discover, start, stop: vi.fn() } },
    });

    renderDashboard({ fixtureActive: true });

    enterChange();
    // Ni siquiera existe un camino hasta el lanzador, así que nunca se llama a start.
    expect(screen.queryByRole('button', { name: /launcher\.startApply/ })).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('muestra un estado de carga y no un panel con marco vacío mientras discover no resolvió', async () => {
    // discover que nunca resuelve: el launcher queda en discovery === null, que
    // es justo el estado que antes devolvía null dentro de un panel con marco.
    let neverResolve: () => void = () => undefined;
    const discover = vi.fn().mockImplementation(
      () => new Promise((resolve) => { neverResolve = () => resolve({ success: true, data: [] }); }),
    );
    const start = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pipelineRuntime: { discover, start, stop: vi.fn() } },
    });

    renderDashboard();

    enterChange();
    screen.getByRole('button', { name: /pipeline\.next\.task\.action/ }).click();

    // El descubrimiento está en curso: hay un mensaje de carga accionable.
    await vi.waitFor(() => expect(screen.getByText('pipeline.launcher.discovering')).toBeTruthy());
    // Y el panel contenedor no pinta su marco mientras carga.
    const loadingPanel = document.querySelector('[data-launcher-loading]');
    expect(loadingPanel).not.toBeNull();

    // Al resolver, el estado de carga desaparece y no queda marco vacío.
    neverResolve();
    await vi.waitFor(() => expect(screen.queryByText('pipeline.launcher.discovering')).toBeNull());
    const stillLoading = document.querySelector('[data-launcher-loading]');
    expect(stillLoading).toBeNull();
  });
});
