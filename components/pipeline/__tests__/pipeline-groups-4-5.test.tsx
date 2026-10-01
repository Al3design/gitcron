// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineNewChangeFlow } from '../PipelineNewChangeFlow';
import { OpenSpecEngineCard } from '../OpenSpecEngineCard';
import type { OpenSpecEngineStatus } from '@/types/pipeline';

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

describe('OpenSpec Groups 4 y 5 — Formulario transparente y declaración de versión', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Grupo 4 — El formulario declara qué hace (4.1, 4.2)', () => {
    it('el botón declara explícitamente la creación de la rama cuando withBranch está activo (4.2)', () => {
      render(
        <PipelineNewChangeFlow
          repoPath="C:/repo"
          projection={null}
        />,
      );

      // Por omisión withBranch está activo: el botón debe nombrar la creación de rama
      const button = screen.getByRole('button', { name: 'pipeline.newChange.propose.createBranchAndReview' });
      expect(button).toBeTruthy();

      // Al desmarcar withBranch, el botón pasa a decir sólo "Elegir runtime"
      const checkbox = screen.getByRole('checkbox', { name: /pipeline\.newChange\.propose\.branch/ });
      fireEvent.click(checkbox);

      expect(screen.getByRole('button', { name: 'pipeline.newChange.propose.review' })).toBeTruthy();
    });

    it('cada campo indica dónde termina su contenido con sus hints declarados (4.1)', () => {
      render(
        <PipelineNewChangeFlow
          repoPath="C:/repo"
          projection={null}
        />,
      );

      expect(screen.getByText('pipeline.newChange.propose.nature')).toBeTruthy();
      expect(screen.getByText('pipeline.newChange.propose.objectiveHelp')).toBeTruthy();
      expect(screen.getByText(/pipeline\.newChange\.propose\.slugTarget/)).toBeTruthy();
      expect(screen.getByText('pipeline.newChange.propose.constraintsHelp')).toBeTruthy();
    });

    it('el modo explorar declara que su texto no crea carpetas ni ramas ni se guarda en archivos (4.1)', () => {
      render(
        <PipelineNewChangeFlow
          repoPath="C:/repo"
          projection={null}
        />,
      );

      // Cambiar a explorar
      const exploreBtn = screen.getByRole('button', { name: /pipeline\.journey\.step\.explore/ });
      fireEvent.click(exploreBtn);

      expect(screen.getByText('pipeline.newChange.explore.descriptionHelp')).toBeTruthy();
    });
  });

  describe('Grupo 5 — La versión deja de ser un supuesto (5.1, 5.2)', () => {
    const baseStatus: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.14.0',
        provenance: 'global',
        versionClass: 'supported',
        supportedRange: { min: '1.5.0', max: '1.14.0' },
        displayPath: '/usr/local/bin/openspec',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      repoState: 'initialized',
      integrationState: 'up-to-date',
      installedIntegration: null,
      globalConfig: null,
      freshnessState: 'cli-up-to-date',
      latestAvailable: null,
      divergence: null,
    };

    it('declara la versión objetivo del ciclo en la tarjeta del motor (5.1)', () => {
      render(<OpenSpecEngineCard status={baseStatus} />);
      expect(screen.getByText('pipeline.openspec.engine.cycleVersion:{"version":"1.14.0"}')).toBeTruthy();
    });

    it('no avisa cuando la versión instalada es posterior a la del ciclo (decisión 2026-09-14)', () => {
      const aheadStatus: OpenSpecEngineStatus = {
        ...baseStatus,
        cli: {
          ...baseStatus.cli,
          runtimeVersion: '1.15.0',
        },
      };

      render(<OpenSpecEngineCard status={aheadStatus} />);
      expect(screen.queryByText(/versionAheadOfCycle/)).toBeNull();
      expect(screen.queryByText(/versionBehindCycle/)).toBeNull();
      expect(screen.queryByText('pipeline.openspec.engine.generalStatus.needsAttention')).toBeNull();
    });

    it('informa cuando la versión instalada es anterior a la versión declarada del ciclo (5.2)', () => {
      const behindStatus: OpenSpecEngineStatus = {
        ...baseStatus,
        cli: {
          ...baseStatus.cli,
          runtimeVersion: '1.5.0',
        },
      };

      render(<OpenSpecEngineCard status={behindStatus} />);
      expect(
        screen.getByText('pipeline.openspec.engine.versionBehindCycle:{"installed":"1.5.0","cycle":"1.14.0"}'),
      ).toBeTruthy();
    });

    it('no muestra advertencias de desfase cuando la versión instalada es exactamente igual a la del ciclo', () => {
      render(<OpenSpecEngineCard status={baseStatus} />);
      expect(screen.queryByText(/pipeline\.openspec\.engine\.versionAheadOfCycle/)).toBeNull();
      expect(screen.queryByText(/pipeline\.openspec\.engine\.versionBehindCycle/)).toBeNull();
    });
  });
});
