// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveChangeBranchState } from '@/lib/change-branch';
import { BranchBaseNotice, ChangeBranchNotice } from '../ChangeBranchNotice';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

/**
 * Lo que Git dice sobre la rama de un cambio.
 *
 * La regla de la rama por cambio tenía cero cumplimiento medido —`git branch
 * --list "change/*"` vacío cuatro días después de escribirla, con unos diez
 * cambios creados en ese lapso— y llega por el canal, así que no era un problema
 * de transporte: nada la hacía visible cuando importa. Esto la hace visible sin
 * bloquear.
 */

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

afterEach(cleanup);

describe('correspondencia entre la rama y el cambio', () => {
  it('deriva la rama que le toca a un cambio', () => {
    expect(deriveChangeBranchState('main', 'declare-change-branch')).toEqual({
      expected: 'change/declare-change-branch',
      actual: 'main',
      matches: false,
    });
    expect(deriveChangeBranchState('change/algo', 'algo')?.matches).toBe(true);
  });

  it('sin cambio abierto o sin rama no afirma nada', () => {
    // No saber dónde se está parado no es estar en la rama equivocada.
    expect(deriveChangeBranchState('main', null)).toBeNull();
    expect(deriveChangeBranchState('', 'algo')).toBeNull();
    expect(deriveChangeBranchState(null, 'algo')).toBeNull();
  });
});

describe('aviso de rama del cambio', () => {
  it('declara las dos ramas cuando no coinciden', () => {
    render(<ChangeBranchNotice branch="main" changeId="declare-change-branch" />);

    expect(screen.getByText(/branch\.mismatchTitle.*main/)).toBeTruthy();
    expect(screen.getByText(/change\/declare-change-branch/)).toBeTruthy();
  });

  it('no declara nada cuando la rama es la del cambio', () => {
    // Un bloque que siempre está enseña a saltearlo, incluido el día que dice algo.
    const { container } = render(
      <ChangeBranchNotice branch="change/declare-change-branch" changeId="declare-change-branch" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('sin cambio abierto no declara nada', () => {
    const { container } = render(<ChangeBranchNotice branch="main" changeId={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('base de la que sale la rama', () => {
  it('declara los commits que faltan y contra qué se comparó', () => {
    render(<BranchBaseNotice branch="vieja" divergence={{ measured: true, base: 'main', behind: 501, ahead: 0 }} />);

    expect(screen.getByText(/branch\.baseBehind/)).toBeTruthy();
    // La comparación es contra el `main` local, y se declara como tal.
    expect(screen.getByText(/branch\.baseLocalOnly/)).toBeTruthy();
  });

  it('declara aparte los commits propios sin fusionar', () => {
    // Pueden ser trabajo deprecado a propósito: se dice, no se corrige.
    render(<BranchBaseNotice branch="vieja" divergence={{ measured: true, base: 'main', behind: 296, ahead: 1 }} />);
    expect(screen.getByText(/branch\.baseAhead/)).toBeTruthy();
  });

  it('al día no dice nada sobre la base', () => {
    const { container } = render(
      <BranchBaseNotice branch="main" divergence={{ measured: true, base: 'main', behind: 0, ahead: 0 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('sin medición lo declara, en vez de afirmar que está al día', () => {
    render(<BranchBaseNotice branch="main" divergence={{ measured: false }} />);
    expect(screen.getByText(/branch\.baseUnknown/)).toBeTruthy();
  });

  it('sin el dato no muestra nada', () => {
    // Un snapshot de una versión anterior no lo trae.
    const { container } = render(<BranchBaseNotice branch="main" />);
    expect(container.firstChild).toBeNull();
  });
});

/** Snapshot mínimo con un cambio activo, para mirar el panel entero. */
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
      activeChanges: [{
        changeId: 'declare-change-branch',
        intent: 'una intención',
        tasks: [{ id: 't-1', text: '1.1 tarea', completed: false, line: 1, sourceRef: 'tasks.md:1' }],
        proposalExists: true,
        designExists: true,
        specsCount: 1,
        validation: 'unknown' as const,
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

function renderDashboard(currentBranch: string) {
  render(
    <OpenSpecDashboard
      snapshot={snapshot()}
      repoPath="C:/repo"
      currentBranch={currentBranch}
      workingTreeClean
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
  // El panel abre en su pantalla de entrada: hay que entrar al cambio.
  fireEvent.click(screen.getAllByRole('button', { name: /openspec\.start\.enter/ })[0]);
  fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.tasks/ }));
}

describe('el panel, con un cambio abierto', () => {
  it('declara la discrepancia suelta y el trabajo sigue disponible', () => {
    renderDashboard('main');

    const notice = screen.getByText(/branch\.mismatchTitle.*main/);
    expect(notice).toBeTruthy();
    expect(notice.closest('section')?.getAttribute('data-kind')).toBe('branch');
    expect(screen.getByText(/change\/declare-change-branch/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /notices\.title/ })).toBeNull();

    // No bloquea: el cambio abierto sigue siendo trabajable (superficie soberana con tareas).
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getAllByText('declare-change-branch').length).toBeGreaterThan(0);
  });

  it('en la rama del cambio no declara nada y no renderiza el aviso si no hay otros', () => {
    renderDashboard('change/declare-change-branch');
    expect(screen.queryByText(/branch\.mismatchTitle/)).toBeNull();
    expect(screen.queryByRole('region', { name: /notices\.title/ })).toBeNull();
  });
});
