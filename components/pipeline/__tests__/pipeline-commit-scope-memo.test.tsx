// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeProjection } from '@/types/pipeline';
import { SddPrepareCommit } from '../sdd';
import type { PipelineSnapshot } from '../pipeline-view-state';
import { useGitStore, type GitFile } from '@/lib/git-store';
import * as changeCommitScope from '@/lib/change-commit-scope';

/**
 * Protege la memoización de `commitScope` (punto d). Antes era una derivación
 * sin memo, y `branchAttribution` —una de sus dependencias— se recreaba en cada
 * render. La memoización ahora estabiliza ambas: con `currentBranch` sin cambiar
 * y `modifiedFiles` sin cambiar, dos renders del componente no recalculan
 * `deriveRepoCommitScope`.
 *
 * Si alguien "simplifica" el `useMemo` o vuelve `branchAttribution` a una IIFE,
 * este test falla: la segunda llamada a `deriveRepoCommitScope` aparece.
 */

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
    hasPipelineActivity: false,
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

const PROPS_BASE = {
  snapshot: snapshot(),
  repoPath: 'C:/repo',
  currentBranch: 'change/mi-cambio',
  workingTreeClean: false,
  leftOpen: false,
  rightOpen: false,
  leftWidth: 320,
  rightWidth: 320,
  onResizeLeft: () => undefined,
  onResizeRight: () => undefined,
  projection: null as RuntimeProjection | null,
  runtimeHistory: [] as RuntimeProjection[],
  onRefresh: () => undefined,
  onSelectChange: () => undefined,
  onPauseAfterTask: () => undefined,
  onRespondDecision: () => undefined,
};

beforeEach(() => {
  // modifiedFiles controlado: un archivo sin stage, el que alimenta commitScope.
  const modifiedFiles: GitFile[] = [
    { path: 'a.ts', status: 'modified', staged: false },
  ];
  useGitStore.setState({ modifiedFiles, repoPath: 'C:/repo' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Preparar commit · commitScope memoizado', () => {
  it('no recalcula deriveRepoCommitScope en un re-render sin cambios', () => {
    const deriveSpy = vi.spyOn(changeCommitScope, 'deriveRepoCommitScope');

    const { rerender } = render(<SddPrepareCommit {...PROPS_BASE} />);

    const llamadasTrasPrimerRender = deriveSpy.mock.calls.length;
    expect(llamadasTrasPrimerRender).toBeGreaterThanOrEqual(1);

    // Re-render con las mismas props: nada cambió, la memo NO se invalida.
    rerender(<SddPrepareCommit {...PROPS_BASE} />);
    expect(deriveSpy.mock.calls.length).toBe(llamadasTrasPrimerRender);
  });

  it('sí recalcula cuando modifiedFiles cambia', () => {
    const deriveSpy = vi.spyOn(changeCommitScope, 'deriveRepoCommitScope');

    const { rerender } = render(<SddPrepareCommit {...PROPS_BASE} />);
    const llamadasTrasPrimerRender = deriveSpy.mock.calls.length;

    // modifiedFiles cambia: la memo se invalida y se recalcula.
    useGitStore.setState({
      modifiedFiles: [
        { path: 'a.ts', status: 'modified', staged: false },
        { path: 'b.ts', status: 'added', staged: false },
      ],
    });
    rerender(<SddPrepareCommit {...PROPS_BASE} />);
    expect(deriveSpy.mock.calls.length).toBeGreaterThan(llamadasTrasPrimerRender);
  });

  it('sí recalcula cuando la rama cambia (branchAttribution se invalida)', () => {
    const deriveSpy = vi.spyOn(changeCommitScope, 'deriveRepoCommitScope');

    const { rerender } = render(<SddPrepareCommit {...PROPS_BASE} />);
    const llamadasTrasPrimerRender = deriveSpy.mock.calls.length;

    rerender(<SddPrepareCommit {...PROPS_BASE} currentBranch="change/otro-cambio" />);
    expect(deriveSpy.mock.calls.length).toBeGreaterThan(llamadasTrasPrimerRender);
  });
});
