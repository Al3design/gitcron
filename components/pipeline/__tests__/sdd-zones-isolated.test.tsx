// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SddStatusBar,
  SddChangeHeader,
  SddArchivedChange,
  SddStartScreens,
  useEngineStatus,
  useArchiveFlow,
} from '../sdd';
import type { OpenSpecChangeSummary, PipelineSnapshot } from '../pipeline-view-state';
import type { OpenSpecEngineStatus } from '@/types/pipeline';

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (params) {
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        key
      );
    }
    return key;
  },
}));

vi.mock('@/lib/git-store', () => ({
  useGitStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      language: 'es',
      setSuccess: vi.fn(),
      modifiedFiles: [],
      branchTracking: {},
    }),
}));

vi.mock('@/lib/pipeline-store', () => ({
  usePipelineStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        engineChangeToken: 0,
        prepareOpenByRepo: {},
        prepareOpen: false,
        setPrepareOpen: vi.fn(),
      }),
    {
      getState: () => ({
        setSelectedChangeId: vi.fn(),
        setOpenSpecificationId: vi.fn(),
      }),
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

vi.mock('../ChangeTimestampLabel', () => ({
  ChangeTimestampLabel: ({ labelKey, stamp }: { labelKey: string; stamp?: { at: string; source: string } | null }) => (
    <span data-testid="timestamp-label">{labelKey}: {stamp?.at ?? 'none'}</span>
  ),
}));

vi.mock('../WhereYouLeftOffCard', () => ({
  WhereYouLeftOffCard: () => <div data-testid="where-you-left-off" />,
}));

vi.mock('../PipelineDetails', () => ({
  PipelineDetails: () => <div data-testid="pipeline-details" />,
}));

vi.mock('../PipelineNewChangeFlow', () => ({
  PipelineNewChangeFlow: () => <div data-testid="pipeline-new-change-flow" />,
}));

describe('SDD Zones Mounted in Isolation (Tanda 3: Tareas 2.3 y 2.4)', () => {
  describe('SddStatusBar', () => {
    it('se monta y renderiza la rama actual y controles', () => {
      const setPrepareOpen = vi.fn();
      const setIsSwitcherOpen = vi.fn();
      const onOpenReview = vi.fn();

      render(
        <SddStatusBar
          currentBranch="change/mi-cambio"
          workingTreeClean={true}
          modifiedFilesCount={0}
          effectiveEngineLoading={false}
          effectiveEngineStatus={{
            cli: { installed: true, runtimeVersion: '1.2.0' },
            integrationState: 'up-to-date',
            repoState: 'initialized',
          } as OpenSpecEngineStatus}
          attentionReasons={[]}
          attentionReasonSeparator=" y "
          selectedChange={null}
          prepareOpen={false}
          repoPath="/repo"
          setPrepareOpen={setPrepareOpen}
          isSwitcherOpen={true}
          setIsSwitcherOpen={setIsSwitcherOpen}
          isSwitcherVisible={true}
          rightOpen={false}
          onOpenReview={onOpenReview}
        />
      );

      expect(screen.getByText('change/mi-cambio')).toBeTruthy();
      expect(screen.getByText('sidebar.workingTreeClean')).toBeTruthy();
      expect(screen.getByText('OpenSpec v1.2.0')).toBeTruthy();
    });
  });

  describe('SddChangeHeader', () => {
    it('renderiza la identidad del cambio activo y el siguiente paso inline', () => {
      const mockChange: OpenSpecChangeSummary = {
        changeId: 'modularizar-sdd',
        intent: 'Modularizar vistas SDD',
        createdAt: { at: '2026-10-10T10:00:00Z', source: 'commit' },
        tasks: [],
        proposalExists: true,
        designExists: true,
        specsCount: 1,
        validation: 'passed',
        artifacts: null,
      };

      render(
        <SddChangeHeader
          selectedChange={mockChange}
          revalidating={false}
          launchTarget={null}
          nextActionHelpKey="pipeline.openspec.nextStep.apply"
        />
      );

      expect(screen.getByText('modularizar-sdd')).toBeTruthy();
      expect(screen.getByText('pipeline.openspec.nextStep.apply')).toBeTruthy();
    });
  });

  describe('SddArchivedChange', () => {
    it('renderiza la cabecera del cambio archivado con sus marcas y detalles', () => {
      const mockArchive = {
        changeId: 'cambio-cerrado',
        sourceRef: 'archive-ref',
        archivedAt: '2026-10-09',
        createdAt: { at: '2026-10-01', source: 'commit' as const },
        archivedOn: { at: '2026-10-09T12:00:00Z', source: 'commit' as const },
        artifacts: {
          proposal: 'prop.md',
          design: 'design.md',
          specs: [],
          tasks: 'tasks.md',
        },
      };

      render(
        <SddArchivedChange
          repoPath="/repo"
          snapshot={{ diffs: [], activity: [] } as unknown as PipelineSnapshot}
          selectedArchive={mockArchive}
          runtimeSessions={[]}
          evidenceTab="proposal"
          setEvidenceTab={vi.fn()}
          flowMode={null}
          projection={null}
          currentBranch="main"
          workingTreeClean={true}
          onOpenChange={vi.fn()}
          onSetCenterTab={vi.fn()}
        />
      );

      expect(screen.getByText('cambio-cerrado')).toBeTruthy();
      expect(screen.getByText('pipeline.openspec.change.completed')).toBeTruthy();
      expect(screen.getByTestId('pipeline-details')).toBeTruthy();
    });
  });

  describe('SddStartScreens', () => {
    it('renderiza la vista in-progress con las tarjetas de cambio y permite interacción', () => {
      const mockStartChanges = [
        {
          change: {
            changeId: 'feature-alpha',
            intent: 'Nueva feature',
            tasks: [{ id: '1', text: 'Tarea 1', completed: false }],
          } as OpenSpecChangeSummary,
          progress: { completed: 0, total: 1, percent: 0 },
        },
      ];
      const handleCardClick = vi.fn();
      const togglePinChange = vi.fn();

      render(
        <SddStartScreens
          activeStartView="in-progress"
          specifications={[]}
          globalTaskPercent={50}
          activeChanges={mockStartChanges.map((sc) => sc.change)}
          archivedChanges={[]}
          startChanges={mockStartChanges}
          branchChangeId={null}
          pinnedChangeIds={[]}
          togglePinChange={togglePinChange}
          handleCardClick={handleCardClick}
          handleCardKeyDown={vi.fn()}
          onDismissFlow={vi.fn()}
          onSwitchStartView={vi.fn()}
          repoPath="/repo"
          projection={null}
          currentBranch="main"
          snapshot={{ diffs: [], activity: [] } as unknown as PipelineSnapshot}
          workingTreeClean={true}
          onOpenChange={vi.fn()}
          onSetCenterTab={vi.fn()}
        />
      );

      expect(screen.getByText('feature-alpha')).toBeTruthy();
      expect(screen.getByText('Nueva feature')).toBeTruthy();
      
      const card = screen.getByRole('button', { name: /feature-alpha/ });
      fireEvent.click(card);
      expect(handleCardClick).toHaveBeenCalled();
    });
  });
});
