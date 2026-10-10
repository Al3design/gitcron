// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SddTasksView,
  SddOverviewView,
  SddArtifactsView,
  SddDiffsView,
  SddActivityView,
  useSddNavigation,
} from '../sdd';
import type { OpenSpecChangeSummary, PipelineSnapshot } from '../pipeline-view-state';

vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock('../PipelineRuntimeLauncher', () => ({
  PipelineRuntimeLauncher: ({ changeId, taskId }: { changeId?: string; taskId?: string }) => (
    <div data-testid="mock-launcher">{changeId}:{taskId}</div>
  ),
}));

vi.mock('../OpenSpecTasksView', () => ({
  OpenSpecTasksView: ({ selectedChange }: { selectedChange: OpenSpecChangeSummary }) => (
    <div data-testid="mock-tasks-view">{selectedChange.changeId} ({selectedChange.tasks.length} tareas)</div>
  ),
}));

vi.mock('../WhereYouLeftOffCard', () => ({
  WhereYouLeftOffCard: ({ selectedChange }: { selectedChange: OpenSpecChangeSummary }) => (
    <div data-testid="mock-overview-card">{selectedChange.changeId}</div>
  ),
}));

vi.mock('../PipelineDetails', () => ({
  PipelineDetails: ({ selectedChange, tab }: { selectedChange: OpenSpecChangeSummary; tab: string }) => (
    <div data-testid="mock-pipeline-details">{selectedChange.changeId} tab:{tab}</div>
  ),
}));

vi.mock('../LazyDiffViewer', () => ({
  LazyDiffViewer: ({ diffs }: { diffs: readonly unknown[] }) => (
    <div data-testid="mock-diff-viewer">{diffs.length} diffs</div>
  ),
}));

vi.mock('../ActivityFeed', () => ({
  ActivityFeed: ({ entries }: { entries: readonly unknown[] }) => (
    <div data-testid="mock-activity-feed">{entries.length} entries</div>
  ),
}));

const mockChange: OpenSpecChangeSummary = {
  changeId: 'modularizar-sdd',
  createdAt: { at: '2026-10-09T22:00:00Z', source: 'commit' },
  intent: 'Modularizar la pantalla de SDD',
  proposalExists: true,
  designExists: true,
  specsCount: 0,
  validation: 'passed',
  tasks: [
    { id: '1.1', text: 'Medir', completed: true, line: 10, sourceRef: 'tasks.md' },
    { id: '2.1', text: 'Sacar vistas', completed: false, line: 11, sourceRef: 'tasks.md' },
  ],
  artifacts: {
    proposal: 'proposal.md',
    design: 'design.md',
    tasks: 'tasks.md',
    specs: [],
  },
};

describe('Vistas de SDD montadas en aislamiento (Tarea 2.1)', () => {
  afterEach(cleanup);

  it('monta SddTasksView sola sin montar la pantalla entera y responde a navegación', () => {
    const handleBack = vi.fn();
    const handleLaunch = vi.fn();

    render(
      <SddTasksView
        repoPath="/repo/test"
        selectedChange={mockChange}
        onBackToOverview={handleBack}
        onLaunchStarted={handleLaunch}
      />
    );

    // Contenedor accesible de la vista tareas
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(screen.getByTestId('mock-tasks-view')).toBeTruthy();
    expect(screen.getByText('modularizar-sdd (2 tareas)')).toBeTruthy();

    // El botón para volver al resumen está presente y llama a onBackToOverview
    const backBtn = screen.getByRole('button', { name: /pipeline\.switcher\.backToOverview/ });
    fireEvent.click(backBtn);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('monta SddTasksView en modo lanzador cuando existe launchTarget', () => {
    render(
      <SddTasksView
        repoPath="/repo/test"
        selectedChange={mockChange}
        launchTarget={{ taskId: '2.1', instruction: 'Hacer tanda' }}
        onBackToOverview={vi.fn()}
        onLaunchStarted={vi.fn()}
      />
    );

    expect(screen.getByRole('region', { name: 'pipeline.openspec.launcher.title' })).toBeTruthy();
    expect(screen.getByTestId('mock-launcher')).toBeTruthy();
    expect(screen.getByText('modularizar-sdd:2.1')).toBeTruthy();
  });

  it('monta SddOverviewView sola con su tarjeta WhereYouLeftOffCard', () => {
    const handleNavTask = vi.fn();

    render(
      <SddOverviewView
        repoPath="/repo/test"
        selectedChange={mockChange}
        onNavigateToTask={handleNavTask}
      />
    );

    expect(screen.getByRole('region', { name: 'pipeline.switcher.overview' })).toBeTruthy();
    expect(screen.getByTestId('mock-overview-card')).toBeTruthy();
  });

  it('monta SddArtifactsView sola con su visor de detalles', () => {
    const handleTabChange = vi.fn();

    render(
      <SddArtifactsView
        snapshot={{} as PipelineSnapshot}
        repoPath="/repo/test"
        selectedChange={mockChange}
        tab="proposal"
        onTabChange={handleTabChange}
      />
    );

    expect(screen.getByRole('region', { name: 'pipeline.switcher.artifacts' })).toBeTruthy();
    expect(screen.getByTestId('mock-pipeline-details')).toBeTruthy();
  });

  it('monta SddDiffsView sola con sus diffs', () => {
    render(
      <SddDiffsView
        diffs={[{ file: 'a.ts' } as any]}
        agentRuntimes={{}}
      />
    );

    expect(screen.getByRole('region', { name: 'pipeline.switcher.diffs' })).toBeTruthy();
    expect(screen.getByTestId('mock-diff-viewer')).toBeTruthy();
  });

  it('monta SddActivityView sola con sus entradas de actividad', () => {
    render(
      <SddActivityView
        entries={[{ id: '1', text: 'Evento' } as any]}
        reasoningAvailable={false}
        agentRuntimes={{}}
      />
    );

    expect(screen.getByRole('region', { name: 'pipeline.switcher.activity' })).toBeTruthy();
    expect(screen.getByTestId('mock-activity-feed')).toBeTruthy();
  });

  it('hook useSddNavigation gestiona el menú de vistas, vista activa y resaltado de tarea', () => {
    const { result } = renderHook(() =>
      useSddNavigation({
        selectedChange: mockChange,
        hasDiffs: true,
        hasActivity: true,
        diffCount: 3,
        activityCount: 5,
      })
    );

    // Por defecto inicia en 'overview'
    expect(result.current.activeChangeView).toBe('overview');
    expect(result.current.highlightedTaskId).toBeNull();

    // changeViews no incluye 'overview' porque está activo; incluye start, tasks, artifacts, diffs, activity
    const viewIds = result.current.changeViews.map((v) => v.id);
    expect(viewIds).toContain('start');
    expect(viewIds).toContain('tasks');
    expect(viewIds).toContain('artifacts');
    expect(viewIds).toContain('diffs');
    expect(viewIds).toContain('activity');
    expect(viewIds).not.toContain('overview');

    // Navegar a una tarea pasa a 'tasks' y guarda el ID de la tarea
    act(() => {
      result.current.handleNavigateToTask('2.1');
    });

    expect(result.current.activeChangeView).toBe('tasks');
    expect(result.current.highlightedTaskId).toBe('2.1');

    // Ahora changeViews incluye 'overview' y no incluye 'tasks'
    const newViewIds = result.current.changeViews.map((v) => v.id);
    expect(newViewIds).toContain('overview');
    expect(newViewIds).not.toContain('tasks');
  });
});
