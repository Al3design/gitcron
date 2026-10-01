// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OpenSpecEngineCard, formatInstallErrorCode, formatDivergenceReason } from '../OpenSpecEngineCard';
import { OpenSpecAgentsBlock } from '../OpenSpecAgentsBlock';
import { translate } from '../../../lib/i18n';
import type { OpenSpecEngineStatus, OpenSpecDivergenceReason } from '../../../types/pipeline';
import { deriveUpdateMatrixAction } from '../../../lib/openspec-update-guide';
import { OPENSPEC_UPDATE_COMMAND } from '../../../lib/openspec-profile';
import { hasOpenSpecEngineAttention } from '../pipeline-domain';
import { usePipelineStore } from '../../../lib/pipeline-store';

describe('OpenSpecEngineCard (UI Audit Tests & Jerarquía)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renderiza la insignia compacta cuando compact=true', () => {
    render(<OpenSpecEngineCard status={null} isLoading={true} compact={true} />);
    expect(screen.getByText(new RegExp(translate('pipeline.openspec.engine.reading'), 'i'))).toBeDefined();
  });

  it('renderiza la vista primaria inicial comprensible y accionable', () => {
    const dummyStatus: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.14.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.14.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: {
        status: 'online',
        latestVersion: '1.14.0',
        checkedAt: 'now',
        fromCache: false,
        cacheAgeSeconds: 0,
        freshness: 'fresh',
        error: null,
      },
      globalConfig: null,
      installedIntegration: {
        skills: [],
        generatedBy: '1.14.0',
        markersFound: [],
        outputInventory: [],
        evidenceStatus: 'confirmed',
        tools: ['codex', 'agents'],
        targets: ['codex', 'agents'],
        installedWorkflowsByTarget: {},
        missing: null,
        legacy: [],
        customized: [],
        conflicts: null,
      },
      repoState: 'initialized',
      integrationState: 'up-to-date',
    };

    render(
      <>
        <OpenSpecEngineCard status={dummyStatus} compact={false} />
        <OpenSpecAgentsBlock configuredCount={2} />
      </>,
    );
    expect(screen.getByText(/Listo/i)).toBeDefined();
    expect(screen.getByText(/2 agentes configurados/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i })).toBeDefined();
  });

  it('despliega el diagnóstico avanzado al hacer clic en el botón de alternancia', () => {
    const dummyStatus: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.8.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.8.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: null,
      installedIntegration: null,
      repoState: 'initialized',
      integrationState: 'outdated',
      divergence: {
        isDivergent: true,
        overallStatus: 'divergent',
        reason: {
          kind: 'profile-mismatch',
          globalProfileClass: 'core',
          repoProfileClass: 'custom',
        },
        globalProfileClass: 'core',
        repoProfileClass: 'custom',
      },
    };

    render(<OpenSpecEngineCard status={dummyStatus} compact={false} />);
    
    // Antes de desplegar, la sección avanzada está oculta
    expect(screen.queryByText(/Ruta y Procedencia/i)).toBeNull();

    // Hacer clic en desplegar
    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    // Ahora la información avanzada es visible
    expect(screen.getByText(/Ruta y Procedencia/i)).toBeDefined();
    expect(screen.getByText(/El perfil global \(core\) difiere/i)).toBeDefined();
  });

  it('con isReviewOpen el conmutador NO se muestra; con la revisión cerrada ofrece «Revisar actualización» y el clic llama a onOpenReview una vez', () => {
    const dummyStatus: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.8.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.8.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: null,
      installedIntegration: null,
      repoState: 'initialized',
      integrationState: 'outdated',
    };

    const handleReview = vi.fn();

    // 1. Con isReviewOpen=true -> el conmutador no se muestra
    const { rerender } = render(
      <OpenSpecEngineCard
        status={dummyStatus}
        compact={false}
        onOpenReview={handleReview}
        isReviewOpen={true}
      />,
    );

    expect(screen.queryByRole('button', { name: /Revisar actualización|Cerrar revisión/i })).toBeNull();

    // 2. Con isReviewOpen=false -> ofrece «Revisar actualización» y llama a onOpenReview
    rerender(
      <OpenSpecEngineCard
        status={dummyStatus}
        compact={false}
        onOpenReview={handleReview}
        isReviewOpen={false}
      />,
    );

    const openBtn = screen.getByRole('button', { name: /Revisar actualización/i });
    expect(openBtn).toBeDefined();
    fireEvent.click(openBtn);
    expect(handleReview).toHaveBeenCalledTimes(1);
  });

  it('con motor 1.5.0 atrasado y todo lo demás sano, la insignia general pasa a «Requiere atención» y avisa del desfase', () => {
    const status150With190Npm: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.5.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.9.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: {
        status: 'online',
        latestVersion: '1.9.0',
        checkedAt: 'now',
        fromCache: false,
        cacheAgeSeconds: 0,
        freshness: 'fresh',
        error: null,
      },
      globalConfig: null,
      installedIntegration: {
        skills: [],
        generatedBy: '1.5.0',
        markersFound: [],
        outputInventory: [],
        evidenceStatus: 'confirmed',
        tools: ['agents'],
        targets: ['agents'],
        installedWorkflowsByTarget: {},
        missing: null,
        legacy: [],
        customized: [],
        conflicts: null,
      },
      repoState: 'initialized',
      integrationState: 'up-to-date',
      freshnessState: 'cli-upgrade-available',
    };

    render(<OpenSpecEngineCard status={status150With190Npm} compact={false} />);

    // 1. Con motor 1.5.0 atrasado respecto al ciclo 1.11.0, la insignia general NO puede decir «listo»
    // sino que debe reflejar «Necesita atención» en coherencia con el aviso de desfase
    expect(screen.getByText(/Necesita atención/i)).toBeDefined();
    expect(screen.queryByText(/Listo/i)).toBeNull();

    // 2. La fila de la tarjeta informa el desfase concreto hacia atrás
    expect(screen.getByText(/anterior al ciclo declarado/i)).toBeDefined();

    // 3. Muestra la versión concreta «v1.5.0», «Motor compatible» y «Versión 1.9.0 disponible en npm»
    expect(screen.getAllByText(/v1\.5\.0/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1\.5\.0/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Motor compatible/i)).toBeDefined();
    expect(screen.getByText(/Versión 1.9.0 disponible en npm/i)).toBeDefined();
  });

  it('con motor 1.14.0 alineado al ciclo y todo lo demás sano, la insignia general sigue diciendo «Listo»', () => {
    const status114Healthy: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.14.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.14.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: null,
      installedIntegration: {
        skills: [],
        generatedBy: '1.14.0',
        markersFound: [],
        outputInventory: [],
        evidenceStatus: 'confirmed',
        tools: ['agents'],
        targets: ['agents'],
        installedWorkflowsByTarget: {},
        missing: null,
        legacy: [],
        customized: [],
        conflicts: null,
      },
      repoState: 'initialized',
      integrationState: 'up-to-date',
      freshnessState: 'cli-up-to-date',
    };

    render(<OpenSpecEngineCard status={status114Healthy} compact={false} />);
    expect(screen.getByText(/Listo/i)).toBeDefined();
    expect(screen.queryByText(/Requiere atención/i)).toBeNull();
    expect(screen.queryByText(/anterior al ciclo declarado/i)).toBeNull();
    expect(screen.queryByText(/supera la versión del ciclo/i)).toBeNull();
  });

  it.each([
    {
      versionClass: 'supported' as const,
      expectedText: 'Motor compatible',
    },
    {
      versionClass: 'too-old' as const,
      expectedText: 'Motor obsoleto (requiere ≥ 1.5.0)',
    },
    {
      versionClass: 'supported' as const,
      runtimeVersion: '2.0.0',
      expectedText: 'Motor compatible',
    },
    {
      versionClass: 'unknown' as const,
      expectedText: 'Versión no clasificada',
    },
  ])('renderiza versionClass: $versionClass traduciendo sin literales "pipeline." (Hallazgo B)', ({ versionClass, runtimeVersion, expectedText }) => {
    const testStatus: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: runtimeVersion ?? '1.5.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0' },
        versionClass,
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: null,
      installedIntegration: null,
      repoState: 'initialized',
      integrationState: 'up-to-date',
    };

    const { container } = render(<OpenSpecEngineCard status={testStatus} compact={false} />);

    // 1. El texto visible en la tarjeta NO debe contener claves crudas "pipeline."
    const fullText = container.textContent ?? '';
    expect(fullText).not.toContain('pipeline.');

    // 2. El texto esperado debe estar presente en el render
    expect(screen.getByText(new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))).toBeDefined();
  });

  it('el estado resumido no dice «Al día» ni «Listo» si el detalle informa un target sin configurar (1.3/1.4)', () => {
    const statusWithUnconfiguredTarget: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.11.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.12.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: null,
      installedIntegration: {
        skills: [],
        generatedBy: '1.11.0',
        markersFound: [],
        outputInventory: [],
        evidenceStatus: 'confirmed',
        tools: [],
        targets: [],
        configuredTools: [],
        presentToolDirectories: ['agents'],
        configuredAgentsCount: 0,
        totalPresentAgentsCount: 1,
        installedWorkflowsByTarget: {},
        missing: null,
        legacy: [],
        customized: [],
        conflicts: null,
      },
      repoState: 'initialized',
      integrationState: 'outdated',
    };

    render(
      <>
        <OpenSpecEngineCard status={statusWithUnconfiguredTarget} compact={false} />
        <OpenSpecAgentsBlock
          configuredCount={statusWithUnconfiguredTarget.installedIntegration!.configuredAgentsCount}
          totalCount={statusWithUnconfiguredTarget.installedIntegration!.totalPresentAgentsCount}
        />
      </>,
    );

    // 1. El estado resumido de la integración NO puede decir «Al día»
    expect(screen.queryByText(/^Al día$/i)).toBeNull();
    expect(screen.getByText(/Desactualizado/i)).toBeDefined();

    // 2. La insignia general NO puede decir «Listo», debe decir «Necesita atención»
    expect(screen.queryByText(/Listo/i)).toBeNull();
    expect(screen.getByText(/Necesita atención/i)).toBeDefined();

    // 3. El detalle informa la proporción con target sin configurar
    expect(screen.getByText(/0 de 1 agentes configurados/i)).toBeDefined();
  });

  it('en modo compacto no declara «Al día» si el detalle informa un target sin configurar (1.3/1.4)', () => {
    const statusWithUnconfiguredTarget: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.11.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.12.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: null,
      installedIntegration: {
        skills: [],
        generatedBy: '1.11.0',
        markersFound: [],
        outputInventory: [],
        evidenceStatus: 'confirmed',
        tools: [],
        targets: [],
        configuredTools: [],
        presentToolDirectories: ['agents'],
        configuredAgentsCount: 0,
        totalPresentAgentsCount: 1,
        installedWorkflowsByTarget: {},
        missing: null,
        legacy: [],
        customized: [],
        conflicts: null,
      },
      repoState: 'initialized',
      integrationState: 'outdated',
    };

    render(<OpenSpecEngineCard status={statusWithUnconfiguredTarget} compact={true} />);
    expect(screen.queryByText(/Al día/i)).toBeNull();
    expect(screen.getByText(/Desactualizado/i)).toBeDefined();
  });

  /**
   * Auditoría del 2026-09-07 (Tarea 1.4): Una sola autoridad sobre el estado de integración.
   *
   * Medición y causa del 2026-09-07:
   * Al resolver 1.3 se agregó `deriveEffectiveIntegrationState` en OpenSpecEngineCard.tsx:
   * una segunda derivación en el renderer que degradaba 'up-to-date' a 'outdated' ante targets
   * sin configurar. Sin embargo, los otros dos consumidores del estado leían el valor crudo de main:
   * - `deriveUpdateMatrixAction` devolvía 'none' (no ofreciendo actualizar).
   * - `hasOpenSpecEngineAttention` no encendía el triángulo ámbar del inspector.
   * Se cambió una contradicción por otra: la tarjeta decía «Desactualizado» mientras la app no ofrecía
   * ninguna acción y el inspector no se enteraba.
   *
   * Al unificar la regla en `buildEngineStatusSnapshot` en el proceso principal, los tres consumidores
   * leen exactamente el mismo valor de la única fuente de verdad:
   * 1. La tarjeta muestra «Desactualizado» y «Necesita atención» (nunca «Al día» ni «Listo»).
   * 2. `deriveUpdateMatrixAction(status)` devuelve 'update' (ofreciendo actualizar, nunca 'none').
   * 3. `hasOpenSpecEngineAttention(status)` devuelve true (encendiendo la atención en el inspector).
   */
  it('prueba conjunta (1.4): tarjeta, matriz de actualización e inspector coinciden ante target sin configurar', () => {
    const statusWithUnconfiguredTarget: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.11.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.12.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: null,
      installedIntegration: {
        skills: [],
        generatedBy: '1.11.0',
        markersFound: [],
        outputInventory: [],
        evidenceStatus: 'confirmed',
        tools: [],
        targets: [],
        configuredTools: [],
        presentToolDirectories: ['agents'],
        configuredAgentsCount: 0,
        totalPresentAgentsCount: 1,
        installedWorkflowsByTarget: {},
        missing: null,
        legacy: [],
        customized: [],
        conflicts: null,
      },
      repoState: 'initialized',
      integrationState: 'outdated',
    };

    // 1. La tarjeta muestra «Desactualizado» y «Necesita atención» (y NO «Al día» ni «Listo»)
    const { unmount } = render(<OpenSpecEngineCard status={statusWithUnconfiguredTarget} compact={false} />);
    expect(screen.queryByText(/^Al día$/i)).toBeNull();
    expect(screen.getByText(/Desactualizado/i)).toBeDefined();
    expect(screen.queryByText(/Listo/i)).toBeNull();
    expect(screen.getByText(/Necesita atención/i)).toBeDefined();
    unmount();

    // 2. deriveUpdateMatrixAction devuelve 'update' (y NO 'none')
    const action = deriveUpdateMatrixAction(statusWithUnconfiguredTarget);
    expect(action).toBe('update');
    expect(action).not.toBe('none');

    // 3. hasOpenSpecEngineAttention devuelve true
    const attention = hasOpenSpecEngineAttention(statusWithUnconfiguredTarget);
    expect(attention).toBe(true);
  });

  describe('Diagnósticos del Motor CLI (3b.3)', () => {
    it('muestra diagnóstico limpio sin inventar advertencias con procedencia declarada', () => {
      const statusClean: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.11.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.12.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: null,
        repoState: 'initialized',
        integrationState: 'up-to-date',
        doctor: {
          command: 'openspec doctor --json',
          ok: true,
          error: null,
          data: {
            root: {
              path: 'C:\\www\\gitCronos',
              source: 'nearest',
              healthy: true,
              status: [],
            },
            store: null,
            references: [],
            status: [],
          },
        },
        contextBrief: {
          command: 'openspec context --json',
          ok: true,
          error: null,
          data: {
            root: {
              path: 'C:\\www\\gitCronos',
              source: 'nearest',
              role: 'openspec_root',
            },
            members: [],
            status: [],
          },
        },
      };

      const { container } = render(<OpenSpecEngineCard status={statusClean} compact={false} />);
      fireEvent.click(screen.getByText(/Ver diagnóstico avanzado/i));

      // Comprobar procedencia de comandos declarada
      expect(screen.getByText('openspec doctor --json')).toBeDefined();
      expect(screen.getByText('openspec context --json')).toBeDefined();

      // Diagnóstico limpio: muestra texto limpio y NO inventa advertencias
      const cleanTexts = screen.getAllByText(/Sin problemas reportados/i);
      expect(cleanTexts.length).toBe(2);

      // Ningún badge de gravedad error o warning inventado
      expect(container.querySelector('[data-severity="error"]')).toBeNull();
      expect(container.querySelector('[data-severity="warning"]')).toBeNull();
    });

    it('presenta condiciones reportadas por el CLI respetando exactamente su gravedad declarada', () => {
      const statusWithIssues: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.11.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.12.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: null,
        repoState: 'initialized',
        integrationState: 'outdated',
        doctor: {
          command: 'openspec doctor --json',
          ok: true,
          error: null,
          data: {
            root: {
              path: 'C:\\www\\gitCronos',
              source: 'nearest',
              healthy: false,
              status: [
                {
                  severity: 'error',
                  code: 'store_corrupt',
                  message: 'El almacén de configuración está corrupto',
                  fix: 'Ejecutar openspec init --force',
                },
              ],
            },
            store: null,
            references: [
              {
                store_id: 'ref-repo',
                status: [
                  {
                    severity: 'warning',
                    code: 'drift_detected',
                    message: 'Deriva detectada en la referencia remota',
                  },
                ],
              },
            ],
            status: [],
          },
        },
        contextBrief: {
          command: 'openspec context --json',
          ok: true,
          error: null,
          data: {
            root: {
              path: 'C:\\www\\gitCronos',
              source: 'nearest',
              role: 'openspec_root',
            },
            members: [
              {
                id: 'aux-member',
                role: 'referenced_store',
                status: [
                  {
                    severity: 'info',
                    code: 'member_offline',
                    message: 'Miembro opcional offline',
                  },
                ],
              },
            ],
            status: [],
          },
        },
      };

      const { container } = render(<OpenSpecEngineCard status={statusWithIssues} compact={false} />);
      fireEvent.click(screen.getByText(/Ver diagnóstico avanzado/i));

      // Verificación de mensajes literales
      expect(screen.getByText('El almacén de configuración está corrupto')).toBeDefined();
      expect(screen.getByText('Deriva detectada en la referencia remota')).toBeDefined();
      expect(screen.getByText('Miembro opcional offline')).toBeDefined();
      expect(screen.getByText(/Sugerencia: Ejecutar openspec init --force/i)).toBeDefined();

      // Verificación de gravedad preservada exactamente sin alteración
      const errorBadge = container.querySelector('[data-severity="error"]');
      expect(errorBadge).not.toBeNull();
      expect(errorBadge?.textContent).toBe('error');

      const warningBadge = container.querySelector('[data-severity="warning"]');
      expect(warningBadge).not.toBeNull();
      expect(warningBadge?.textContent).toBe('warning');

      const infoBadge = container.querySelector('[data-severity="info"]');
      expect(infoBadge).not.toBeNull();
      expect(infoBadge?.textContent).toBe('info');
    });

    it('declara explícitamente cuando el diagnóstico falló o no está disponible sin síntesis engañosa', () => {
      const statusUnavailable: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.11.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.12.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: null,
        repoState: 'initialized',
        integrationState: 'unknown',
        doctor: {
          command: 'openspec doctor --json',
          ok: false,
          error: 'openspec doctor fallo: timeout de 15000ms excedido',
          data: null,
        },
        contextBrief: null,
      };

      render(<OpenSpecEngineCard status={statusUnavailable} compact={false} />);
      fireEvent.click(screen.getByText(/Ver diagnóstico avanzado/i));

      expect(screen.getByText('openspec doctor fallo: timeout de 15000ms excedido')).toBeDefined();
      expect(screen.getByText(/Diagnóstico no disponible para este comando/i)).toBeDefined();
    });
  });

  describe('Superficie de motor e instalación honesta (Grupo 9: 9.1, 9.2, 9.3, 9.5)', () => {
    const absentCliStatus: OpenSpecEngineStatus = {
      cli: {
        installed: false,
        runtimeVersion: null,
        provenance: 'unknown',
        displayPath: null,
        supportedRange: { min: '1.5.0', max: '1.12.0' },
        versionClass: 'unknown',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: {
        status: 'online',
        latestVersion: '1.11.0',
        checkedAt: 'now',
        fromCache: false,
        cacheAgeSeconds: 0,
        freshness: 'fresh',
        error: null,
      },
      globalConfig: null,
      installedIntegration: null,
      repoState: 'initialized',
      integrationState: 'unknown',
    };

    it('9.1: las acciones preceden a la caja primaria de diagnóstico', () => {
      const handleReview = vi.fn();
      const dummyStatus: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.11.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.12.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: null,
        repoState: 'initialized',
        integrationState: 'up-to-date',
      };

      const { container } = render(
        <OpenSpecEngineCard
          status={dummyStatus}
          compact={false}
          onOpenReview={handleReview}
        />,
      );

      const actionBtn = screen.getByRole('button', { name: /Revisar actualización/i });
      const summaryBox = container.querySelector('[class*="primarySummaryBox"]');
      expect(actionBtn).toBeDefined();
      expect(summaryBox).toBeDefined();
      expect(actionBtn.compareDocumentPosition(summaryBox!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    const createPipelineOpenSpecMock = () => ({
      getEngineStatus: vi.fn().mockResolvedValue(null),
      checkLatestVersion: vi.fn().mockResolvedValue(null),
      getUpdatePlan: vi.fn().mockResolvedValue(null),
      executeUpdate: vi.fn().mockResolvedValue({ success: true }),
      runUpdate: vi.fn().mockResolvedValue({ success: true }),
      getPreview: vi.fn().mockResolvedValue(null),
      getInstructions: vi.fn().mockResolvedValue(null),
      executeCommand: vi.fn().mockResolvedValue({ exitCode: 0 }),
      installLocal: vi.fn().mockResolvedValue({
        success: true,
        mode: 'local',
        commandExecuted: 'pnpm add -D @fission-ai/openspec@latest',
      }),
      installGlobal: vi.fn().mockResolvedValue({
        success: true,
        mode: 'global',
        commandExecuted: 'pnpm add -g @fission-ai/openspec@latest',
      }),
    });

    it('9.2: ofrece instalación local deshabilitada con motivo de ausencia de package.json cuando hasPackageJson=false', () => {
      (window as any).api = { pipelineOpenSpec: createPipelineOpenSpecMock() };
      render(
        <OpenSpecEngineCard
          status={absentCliStatus}
          compact={false}
          hasPackageJson={false}
          repoPath="C:\\repo"
        />,
      );

      const localBtn = screen.getByRole('button', { name: /Instalación local/i });
      expect(localBtn.hasAttribute('disabled')).toBe(true);
      expect(screen.getByText(/El repositorio no cuenta con un archivo package\.json para instalación local/i)).toBeDefined();
    });

    it('9.2: ofrece instalación local deshabilitada cuando no se cuenta con repoPath o falta IPC', () => {
      delete (window as any).api;
      render(
        <OpenSpecEngineCard
          status={absentCliStatus}
          compact={false}
          hasPackageJson={true}
        />,
      );

      const localBtn = screen.getByRole('button', { name: /Instalación local/i });
      expect(localBtn.hasAttribute('disabled')).toBe(true);
      expect(screen.getByText(/Instalación local no disponible/i)).toBeDefined();
    });

    it('9.2: el clic en «Instalación local» llama a pipelineOpenSpec.installLocal con repoPath', async () => {
      const mockApi = createPipelineOpenSpecMock();
      (window as any).api = { pipelineOpenSpec: mockApi };

      render(
        <OpenSpecEngineCard
          status={absentCliStatus}
          compact={false}
          hasPackageJson={true}
          repoPath={'C:\\repo'}
        />,
      );

      const localBtn = screen.getByRole('button', { name: /Instalación local/i });
      expect(localBtn.hasAttribute('disabled')).toBe(false);

      await fireEvent.click(localBtn);

      expect(mockApi.installLocal).toHaveBeenCalledTimes(1);
      expect(mockApi.installLocal).toHaveBeenCalledWith({ repoPath: 'C:\\repo' });
      expect(await screen.findByText(/Instalación local completada con éxito/i)).toBeDefined();
    });

    it('9.2: muestra estado de ocupado y deshabilita ambos botones durante la instalación local', async () => {
      let resolvePromise: (val: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const mockApi = createPipelineOpenSpecMock();
      mockApi.installLocal.mockReturnValue(pendingPromise);
      (window as any).api = { pipelineOpenSpec: mockApi };

      render(
        <OpenSpecEngineCard
          status={absentCliStatus}
          compact={false}
          hasPackageJson={true}
          repoPath={'C:\\repo'}
        />,
      );

      const localBtn = screen.getByRole('button', { name: /Instalación local/i });
      const globalBtn = screen.getByRole('button', { name: /Instalación global/i });

      fireEvent.click(localBtn);

      // Mientras corre, el botón local muestra ocupado y ambos se deshabilitan
      expect(await screen.findByText(/Instalando localmente…/i)).toBeDefined();
      expect(localBtn.hasAttribute('disabled')).toBe(true);
      expect(globalBtn.hasAttribute('disabled')).toBe(true);

      // Al resolverse se reanuda
      resolvePromise!({ success: true, mode: 'local' });
      expect(await screen.findByText(/Instalación local completada con éxito/i)).toBeDefined();
    });

    it('9.2: traduce cada uno de los 5 códigos de error del backend a mensajes accionables distintos', async () => {
      const errorCodes = [
        'no-manifest',
        'package-manager-not-found',
        'permission-denied',
        'invalid-target-version',
        'install-failed',
      ] as const;

      const expectedMessages = [
        'El repositorio no cuenta con un archivo package.json para instalación local',
        'No se encontró un gestor de paquetes compatible (npm, pnpm, yarn, bun) en el sistema',
        'Permiso denegado al instalar. Ejecute con privilegios elevados o verifique los permisos del directorio.',
        'La versión o especificación del paquete OpenSpec solicitada no es válida',
        'Falló el comando de instalación. Revise la salida de error para más detalles.',
      ];

      // Verificación directa de la función pura formatInstallErrorCode
      errorCodes.forEach((code, idx) => {
        const formatted = formatInstallErrorCode(code, (key) => translate(key as any, 'es'));
        expect(formatted).toBe(expectedMessages[idx]);
      });

      // Verificación en componente para cada código
      for (let i = 0; i < errorCodes.length; i++) {
        cleanup();
        const code = errorCodes[i];
        const mockApi = createPipelineOpenSpecMock();
        mockApi.installLocal.mockResolvedValue({
          success: false,
          mode: 'local',
          code,
          error: 'raw error detail',
        });
        (window as any).api = { pipelineOpenSpec: mockApi };

        render(
          <OpenSpecEngineCard
            status={absentCliStatus}
            compact={false}
            hasPackageJson={true}
            repoPath={'C:\\repo'}
          />,
        );

        const localBtn = screen.getByRole('button', { name: /Instalación local/i });
        await fireEvent.click(localBtn);

        expect(await screen.findByText(expectedMessages[i])).toBeDefined();
      }
    });

    it('9.3: el clic en «Instalación global» muestra la confirmación antes de llamar a pipelineOpenSpec.installGlobal', async () => {
      const mockApi = createPipelineOpenSpecMock();
      (window as any).api = { pipelineOpenSpec: mockApi };

      render(
        <OpenSpecEngineCard
          status={absentCliStatus}
          compact={false}
          repoPath={'C:\\repo'}
          nodePath="C:\\Program Files\\nodejs\\node.exe"
          npmPath="C:\\Program Files\\nodejs\\npm.cmd"
          openRepoPaths={['C:\\repo1', 'C:\\repo2']}
        />,
      );

      const globalBtn = screen.getByRole('button', { name: /Instalación global/i });
      fireEvent.click(globalBtn);

      // No debe haberse llamado inmediatamente al backend
      expect(mockApi.installGlobal).not.toHaveBeenCalled();

      // Debe mostrarse la zona de confirmación con sus detalles
      expect(screen.getByText(/La instalación global modificará el entorno de Node/i)).toBeDefined();
      expect(screen.getByText((content) => content.includes('Node:') && content.includes('node.exe'))).toBeDefined();
      expect(screen.getByText((content) => content.includes('npm:') && content.includes('npm.cmd'))).toBeDefined();
      expect(screen.getByText(/Repositorios afectados \(2\):/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /Confirmar instalación global/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Cancelar/i })).toBeDefined();
    });

    it('9.3: el botón «Cancelar» cierra la confirmación sin ejecutar la instalación global', async () => {
      const mockApi = createPipelineOpenSpecMock();
      (window as any).api = { pipelineOpenSpec: mockApi };

      render(
        <OpenSpecEngineCard
          status={absentCliStatus}
          compact={false}
          repoPath={'C:\\repo'}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Instalación global/i }));
      expect(screen.getByRole('button', { name: /Confirmar instalación global/i })).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));

      expect(mockApi.installGlobal).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /Confirmar instalación global/i })).toBeNull();
      expect(screen.getByRole('button', { name: /Instalación global/i })).toBeDefined();
    });

    it('9.3: al confirmar la instalación global, ejecuta pipelineOpenSpec.installGlobal y reporta resultado', async () => {
      const mockApi = createPipelineOpenSpecMock();
      (window as any).api = { pipelineOpenSpec: mockApi };

      render(
        <OpenSpecEngineCard
          status={absentCliStatus}
          compact={false}
          repoPath={'C:\\repo'}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Instalación global/i }));
      const confirmBtn = screen.getByRole('button', { name: /Confirmar instalación global/i });

      await fireEvent.click(confirmBtn);

      expect(mockApi.installGlobal).toHaveBeenCalledTimes(1);
      expect(mockApi.installGlobal).toHaveBeenCalledWith({ repoPath: 'C:\\repo' });
      expect(await screen.findByText(/Instalación global completada con éxito/i)).toBeDefined();
    });

    it('9.3: el comando mostrado NO es una constante cableada y proviene de props o resultado', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      const dynamicCommand = 'pnpm add -g @fission-ai/openspec@latest';

      render(
        <OpenSpecEngineCard
          status={absentCliStatus}
          compact={false}
          commandExecuted={dynamicCommand}
          nodePath="C:\\node.exe"
          npmPath="C:\\pnpm.cmd"
          openRepoPaths={['C:\\repo1']}
        />,
      );

      // El comando dinámico se muestra fielmente
      expect(screen.getByText(dynamicCommand)).toBeDefined();
      // NO se muestra el viejo npm cableado a fuego
      expect(screen.queryByText(/npm\s+i\s+-g/)).toBeNull();

      // Al copiar, copia el comando dinámico
      const copyBtn = screen.getByRole('button', { name: /Copiar comando/i });
      fireEvent.click(copyBtn);
      expect(writeTextMock).toHaveBeenCalledWith(dynamicCommand);

      // Comprobación de i18n en repositorios afectados
      expect(screen.getByText(/Repositorios afectados \(1\):/i)).toBeDefined();
    });
  });
});

describe('formatDivergenceReason (multiple-target-divergences)', () => {
  const createTranslator = (lang: 'es' | 'en' | 'zh' = 'es') => {
    return (key: string, params?: Record<string, string | number>) => translate(key, lang, params);
  };

  it('3b: unifica en una sola frase cuando a todos los agentes les falta lo mismo', () => {
    const t = createTranslator('es');
    const reason: OpenSpecDivergenceReason = {
      kind: 'multiple-target-divergences',
      targets: [
        {
          kind: 'target-workflows-mismatch',
          toolId: 'agents',
          label: 'Agents Multi-Agent',
          targetCount: 5,
          targetWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync'],
          globalCount: 6,
          globalWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync', 'update'],
        },
        {
          kind: 'target-workflows-mismatch',
          toolId: 'claude',
          label: 'Claude Code',
          targetCount: 5,
          targetWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync'],
          globalCount: 6,
          globalWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync', 'update'],
        },
        {
          kind: 'target-workflows-mismatch',
          toolId: 'opencode',
          label: 'OpenCode',
          targetCount: 5,
          targetWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync'],
          globalCount: 6,
          globalWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync', 'update'],
        },
      ],
    };

    const formatted = formatDivergenceReason(reason, t);

    // Nombra a los tres con la conjunción correcta
    expect(formatted).toContain('Agents Multi-Agent, Claude Code y OpenCode');
    // Menciona 'update' UNA sola vez
    const updateMatches = formatted.match(/update/g) || [];
    expect(updateMatches).toHaveLength(1);
    // Menciona la recomendación UNA sola vez
    const recommendationText = t('pipeline.openspec.engine.divergence.recommendation');
    const recCount = formatted.split(recommendationText).length - 1;
    expect(recCount).toBe(1);
    // NO repite la frase larga (debe ser el texto unificado exacto)
    expect(formatted).toBe(
      'Agents Multi-Agent, Claude Code y OpenCode tienen la integración desactualizada: les falta «update». Actualizá la integración para que operen con los comandos vigentes.',
    );
  });

  it('3c: emite una línea por agente cuando les faltan flujos distintos y la recomendación una sola vez al final', () => {
    const t = createTranslator('es');
    const reason: OpenSpecDivergenceReason = {
      kind: 'multiple-target-divergences',
      targets: [
        {
          kind: 'target-workflows-mismatch',
          toolId: 'agents',
          label: 'Agents Multi-Agent',
          targetCount: 5,
          targetWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync'],
          globalCount: 6,
          globalWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync', 'update'],
        },
        {
          kind: 'target-workflows-mismatch',
          toolId: 'claude',
          label: 'Claude Code',
          targetCount: 5,
          targetWorkflows: ['apply', 'archive', 'explore', 'propose', 'update'],
          globalCount: 6,
          globalWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync', 'update'],
        },
      ],
    };

    const formatted = formatDivergenceReason(reason, t);
    const lines = formatted.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Agents Multi-Agent: le falta «update».');
    expect(lines[1]).toBe('Claude Code: le falta «sync».');
    expect(lines[2]).toBe('Actualizá la integración para que operen con los comandos vigentes.');

    const recommendationText = t('pipeline.openspec.engine.divergence.recommendation');
    const recCount = formatted.split(recommendationText).length - 1;
    expect(recCount).toBe(1);
  });
});

describe('OpenSpecEngineCard (Perfil de workflows y cambio a custom - Tarea 7.6)', () => {
  afterEach(() => {
    cleanup();
    delete (window as any).api;
  });

  const baseStatusWithProfile = (profile: string): OpenSpecEngineStatus => ({
    cli: {
      installed: true,
      runtimeVersion: '1.12.0',
      provenance: 'global',
      displayPath: 'C:\\global\\openspec.cmd',
      supportedRange: { min: '1.5.0', max: '1.12.0' },
      versionClass: 'supported',
      evidenceStatus: 'confirmed',
      diagnostics: [],
    },
    latestAvailable: null,
    globalConfig: {
      rawProfile: profile,
      profileState: 'read',
      delivery: 'both',
      deliveryState: 'read',
      configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
      workflowsState: 'read',
      resolvedWorkflows: ['propose', 'explore', 'apply', 'update', 'sync', 'archive'],
      resolvedWorkflowsState: 'read',
      origin: 'cli',
      readAt: '2026-09-11T12:00:00.000Z',
    },
    installedIntegration: null,
    repoState: 'initialized',
    integrationState: 'up-to-date',
  });

  it('perfil core → el candado está cerrado (aria-pressed false), muestra «core», los switches tienen disabled, y NO existe ningún botón «Cambiar a custom»', () => {
    const mockApi = {
      setWorkflow: vi.fn(),
      setProfile: vi.fn(),
    };
    (window as any).api = { pipelineOpenSpec: mockApi };

    render(
      <OpenSpecEngineCard
        status={baseStatusWithProfile('core')}
        compact={false}
        repoPath={'C:\\repo'}
      />,
    );

    // Desplegar diagnóstico avanzado para ver la sección de workflows
    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    // El candado está cerrado (aria-pressed false), muestra «core» y está habilitado
    const lockBtn = screen.getByRole('button', { name: /core/i });
    expect(lockBtn.getAttribute('aria-pressed')).toBe('false');
    expect(lockBtn.textContent).toContain('core');
    expect(lockBtn.hasAttribute('disabled')).toBe(false);

    // Los switches tienen disabled
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    switches.forEach((s) => {
      expect(s.hasAttribute('disabled')).toBe(true);
    });

    // El motivo nombra «core»
    expect(screen.getByText(/El perfil «core» fija los workflows/i)).toBeDefined();

    // NO existe ningún botón «Cambiar a custom»
    expect(screen.queryByRole('button', { name: /Cambiar a custom/i })).toBeNull();
  });

  it('clic en el candado cerrado → llama al canal UNA vez con { profile: \'custom\' } y después a onChanged', async () => {
    const setProfileMock = vi.fn().mockResolvedValue({ ok: true });
    (window as any).api = {
      pipelineOpenSpec: {
        setWorkflow: vi.fn(),
        setProfile: setProfileMock,
      },
    };
    const onChanged = vi.fn();

    render(
      <OpenSpecEngineCard
        status={baseStatusWithProfile('core')}
        compact={false}
        repoPath={'C:\\repo'}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    const lockBtn = screen.getByRole('button', { name: /core/i });
    await fireEvent.click(lockBtn);

    expect(setProfileMock).toHaveBeenCalledTimes(1);
    expect(setProfileMock).toHaveBeenCalledWith({ profile: 'custom' });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('perfil custom → candado abierto (aria-pressed true), muestra «custom», switches sin disabled, y candado habilitado', () => {
    const mockApi = {
      setWorkflow: vi.fn(),
      setProfile: vi.fn(),
    };
    (window as any).api = { pipelineOpenSpec: mockApi };

    render(
      <OpenSpecEngineCard
        status={baseStatusWithProfile('custom')}
        compact={false}
        repoPath={'C:\\repo'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    // Candado abierto (aria-pressed true), muestra «custom» y está habilitado
    const lockBtn = screen.getByRole('button', { name: /custom/i });
    expect(lockBtn.getAttribute('aria-pressed')).toBe('true');
    expect(lockBtn.textContent).toContain('custom');
    expect(lockBtn.hasAttribute('disabled')).toBe(false);

    // Los switches NO tienen disabled
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    switches.forEach((s) => {
      expect(s.hasAttribute('disabled')).toBe(false);
    });

    // NO existe ningún botón «Cambiar a custom»
    expect(screen.queryByRole('button', { name: /Cambiar a custom/i })).toBeNull();
  });

  it('clic en el candado abierto → llama al canal UNA vez con { profile: \'core\' } y después a onChanged', async () => {
    const setProfileMock = vi.fn().mockResolvedValue({ ok: true });
    (window as any).api = {
      pipelineOpenSpec: {
        setWorkflow: vi.fn(),
        setProfile: setProfileMock,
      },
    };
    const onChanged = vi.fn();

    render(
      <OpenSpecEngineCard
        status={baseStatusWithProfile('custom')}
        compact={false}
        repoPath={'C:\\repo'}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    const lockBtn = screen.getByRole('button', { name: /custom/i });
    await fireEvent.click(lockBtn);

    expect(setProfileMock).toHaveBeenCalledTimes(1);
    expect(setProfileMock).toHaveBeenCalledWith({ profile: 'core' });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('perfil no leído (profileState failed) → muestra sin datos de perfil, no muestra motivo con core ni botón custom', () => {
    const mockApi = {
      setWorkflow: vi.fn(),
      setProfile: vi.fn(),
    };
    (window as any).api = { pipelineOpenSpec: mockApi };

    const statusFailedProfile: OpenSpecEngineStatus = {
      ...baseStatusWithProfile('core'),
      globalConfig: {
        rawProfile: null,
        profileState: 'failed',
        delivery: 'both',
        deliveryState: 'read',
        configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
        workflowsState: 'read',
        resolvedWorkflows: ['propose', 'explore', 'apply', 'update', 'sync', 'archive'],
        resolvedWorkflowsState: 'read',
        origin: 'cli',
        readAt: '2026-09-11T12:00:00.000Z',
      },
    };

    render(
      <OpenSpecEngineCard
        status={statusFailedProfile}
        compact={false}
        repoPath={'C:\\repo'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    // Muestra sin datos de perfil
    expect(screen.getByText(/Sin datos de perfil/i)).toBeDefined();

    // NO muestra el motivo con «core»
    expect(screen.queryByText(/El perfil «core» fija los workflows/i)).toBeNull();

    // NO muestra el botón «Cambiar a custom» ni candado
    expect(screen.queryByRole('button', { name: /Cambiar a custom/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /core/i })).toBeNull();
  });
});

describe('OpenSpecEngineCard (Resolución de divergencia en el banner)', () => {
  afterEach(() => {
    cleanup();
  });

  const baseDivergentStatus: OpenSpecEngineStatus = {
    cli: {
      installed: true,
      runtimeVersion: '1.12.0',
      displayPath: 'C:\\fake\\openspec.cmd',
      provenance: 'global',
      versionClass: 'supported',
      evidenceStatus: 'confirmed',
      supportedRange: { min: '1.5.0', max: '1.12.0' },
      diagnostics: [],
    },
    latestAvailable: null,
    globalConfig: null,
    installedIntegration: null,
    repoState: 'initialized',
    integrationState: 'outdated',
    divergence: {
      isDivergent: true,
      overallStatus: 'divergent',
      reason: {
        kind: 'profile-mismatch',
        globalProfileClass: 'core',
        repoProfileClass: 'custom',
      },
      globalProfileClass: 'core',
      repoProfileClass: 'custom',
    },
  };

  const convergentStatus: OpenSpecEngineStatus = {
    ...baseDivergentStatus,
    divergence: {
      isDivergent: false,
      overallStatus: 'convergent',
      reason: null,
      globalProfileClass: 'core',
      repoProfileClass: 'core',
    },
  };

  it('con divergencia: se ve el texto de divergencia, y NO existe ningún botón «Actualizar la integración» ni el título «Cómo resolverlo» (las acciones viven en la revisión)', () => {
    const onOpenReview = vi.fn();
    render(
      <OpenSpecEngineCard
        status={baseDivergentStatus}
        compact={false}
        onOpenReview={onOpenReview}
      />,
    );

    // Desplegar diagnóstico avanzado
    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    // Se ve el texto de advertencia de divergencia
    expect(screen.getByText(/⚠️/i)).toBeDefined();

    // NO existe ningún botón «Actualizar la integración» ni el título «Cómo resolverlo»
    expect(screen.queryByRole('button', { name: /Actualizar la integración/i })).toBeNull();
    expect(screen.queryByText(/Cómo resolverlo/i)).toBeNull();

    // onOpenReview sigue pasándose y NO se llama
    expect(onOpenReview).not.toHaveBeenCalled();
  });

  it('con divergencia y SIN onOpenReview: el botón NO existe, ni el comando manual', () => {
    render(
      <OpenSpecEngineCard
        status={baseDivergentStatus}
        compact={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    // El botón NO existe
    expect(screen.queryByRole('button', { name: /Actualizar la integración/i })).toBeNull();

    // El comando manual tampoco se renderiza
    expect(screen.queryByText(OPENSPEC_UPDATE_COMMAND)).toBeNull();
    expect(screen.queryByText(/O desde la terminal, en la carpeta del repositorio:/i)).toBeNull();
  });

  it('sin divergencia: nada de esto se renderiza', () => {
    render(
      <OpenSpecEngineCard
        status={convergentStatus}
        compact={false}
        onOpenReview={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

    // Nada de la resolución se renderiza
    expect(screen.queryByRole('button', { name: /Actualizar la integración/i })).toBeNull();
    expect(screen.queryByText(OPENSPEC_UPDATE_COMMAND)).toBeNull();
    expect(screen.queryByText(/O desde la terminal, en la carpeta del repositorio:/i)).toBeNull();
  });
});

describe('OpenSpecEngineCard - La tarjeta no ofrece la actualización del motor (8.22)', () => {
  afterEach(() => {
    cleanup();
    delete (window as any).api;
  });

  const status112With113Npm: OpenSpecEngineStatus = {
    cli: {
      installed: true,
      runtimeVersion: '1.12.0',
      provenance: 'global',
      displayPath: 'C:\\global\\openspec.cmd',
      supportedRange: { min: '1.5.0', max: '1.12.0' },
      versionClass: 'supported',
      evidenceStatus: 'confirmed',
      diagnostics: [],
    },
    latestAvailable: {
      status: 'online',
      latestVersion: '1.13.0',
      checkedAt: 'now',
      fromCache: false,
      cacheAgeSeconds: 0,
      freshness: 'fresh',
      error: null,
    },
    globalConfig: null,
    installedIntegration: {
      skills: [],
      generatedBy: '1.12.0',
      markersFound: [],
      outputInventory: [],
      evidenceStatus: 'confirmed',
      tools: ['agents'],
      targets: ['agents'],
      installedWorkflowsByTarget: {},
      missing: null,
      legacy: [],
      customized: [],
      conflicts: null,
    },
    repoState: 'initialized',
    integrationState: 'up-to-date',
    freshnessState: 'cli-upgrade-available',
  };

  it('con motor 1.12.0 y latest 1.13.0, NO existe «Actualizar el motor» ni «Motor v1.12.0 instalado»; pipelineOpenSpec.installGlobal NO se llama', async () => {
    const installGlobalMock = vi.fn().mockResolvedValue({
      success: true,
      mode: 'global',
      commandExecuted: 'npm i -g @fission-ai/openspec@latest',
    });
    (window as any).api = {
      pipelineOpenSpec: {
        installGlobal: installGlobalMock,
      },
    };

    const onChangedMock = vi.fn();

    render(
      <OpenSpecEngineCard
        status={status112With113Npm}
        compact={false}
        repoPath={'C:\\repo'}
        onChanged={onChangedMock}
      />,
    );

    expect(screen.queryByRole('button', { name: /Actualizar el motor/i })).toBeNull();
    expect(screen.queryByText(/Motor v1\.12\.0 instalado/i)).toBeNull();
    expect(installGlobalMock).not.toHaveBeenCalled();
  });

  it('con motor 1.13.0 y latest 1.12.0, el botón NO existe', () => {
    const status113With112Npm: OpenSpecEngineStatus = {
      ...status112With113Npm,
      cli: {
        ...status112With113Npm.cli,
        installed: true,
        runtimeVersion: '1.13.0',
      },
      latestAvailable: {
        ...status112With113Npm.latestAvailable!,
        latestVersion: '1.12.0',
      },
    };

    render(
      <OpenSpecEngineCard
        status={status113With112Npm}
        compact={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /Actualizar el motor/i })).toBeNull();
    expect(screen.queryByLabelText('Actualización del motor en el sistema host')).toBeNull();
  });

  describe('Releer estado y lectura incompleta (Tarea 6.11)', () => {
    it('con status incompleto se ve el texto de lectura incompleta y el botón «Releer estado»; el clic incrementa engineChangeToken y llama a onChanged', () => {
      const incompleteStatus: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: null,
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0' },
          versionClass: 'unknown',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: null,
        repoState: 'initialized',
        integrationState: 'up-to-date',
      };

      const onChangedMock = vi.fn();
      const initialToken = usePipelineStore.getState().engineChangeToken;

      render(
        <OpenSpecEngineCard
          status={incompleteStatus}
          compact={false}
          onChanged={onChangedMock}
        />,
      );

      expect(screen.getByText(/La lectura del motor quedó incompleta/i)).toBeDefined();
      const rereadBtn = screen.getByRole('button', { name: /Releer estado/i });
      expect(rereadBtn).toBeDefined();

      fireEvent.click(rereadBtn);

      expect(usePipelineStore.getState().engineChangeToken).toBe(initialToken + 1);
      expect(onChangedMock).toHaveBeenCalledTimes(1);
    });

    it('con status completo el texto de lectura incompleta NO aparece pero el botón SÍ', () => {
      const completeStatus: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.12.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: {
          rawProfile: 'core',
          profileState: 'read',
          delivery: 'both',
          deliveryState: 'read',
          configuredWorkflows: ['propose', 'apply'],
          workflowsState: 'read',
          resolvedWorkflows: ['propose', 'apply'],
          resolvedWorkflowsState: 'read',
          origin: 'cli',
          readAt: 'now',
        },
        installedIntegration: null,
        repoState: 'initialized',
        integrationState: 'up-to-date',
      };

      render(
        <OpenSpecEngineCard
          status={completeStatus}
          compact={false}
        />,
      );

      expect(screen.queryByText(/La lectura del motor quedó incompleta/i)).toBeNull();
      expect(screen.getByRole('button', { name: /Releer estado/i })).toBeDefined();
    });
  });

  describe('Tarea 8.21: deduplicación de acciones cuando la revisión está abierta', () => {
    const combinedDivergentUpgradeStatus: OpenSpecEngineStatus = {
      cli: {
        installed: true,
        runtimeVersion: '1.12.0',
        displayPath: 'C:\\fake\\openspec.cmd',
        provenance: 'global',
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        supportedRange: { min: '1.5.0' },
        diagnostics: [],
      },
      latestAvailable: {
        status: 'online',
        latestVersion: '1.13.0',
        checkedAt: 'now',
        fromCache: false,
        cacheAgeSeconds: 0,
        freshness: 'fresh',
        error: null,
      },
      globalConfig: null,
      installedIntegration: null,
      repoState: 'initialized',
      integrationState: 'outdated',
      divergence: {
        isDivergent: true,
        overallStatus: 'divergent',
        reason: {
          kind: 'profile-mismatch',
          globalProfileClass: 'core',
          repoProfileClass: 'custom',
        },
        globalProfileClass: 'core',
        repoProfileClass: 'custom',
      },
    };

    it('con isReviewOpen true y con isReviewOpen false: en ambos casos NO existen «Actualizar la integración», «Cómo resolverlo» ni «Actualizar el motor»; con false existe «Revisar actualización», con true no', () => {
      // 1. Con isReviewOpen={false}
      const { rerender } = render(
        <OpenSpecEngineCard
          status={combinedDivergentUpgradeStatus}
          compact={false}
          onOpenReview={vi.fn()}
          isReviewOpen={false}
        />,
      );

      // Existe «Revisar actualización»
      expect(screen.getByRole('button', { name: /Revisar actualización/i })).toBeDefined();
      // NO existe «Actualizar el motor»
      expect(screen.queryByRole('button', { name: /Actualizar el motor/i })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Ver diagnóstico avanzado/i }));

      // NO existen «Actualizar la integración» ni «Cómo resolverlo»
      expect(screen.queryByRole('button', { name: /Actualizar la integración/i })).toBeNull();
      expect(screen.queryByText(/Cómo resolverlo/i)).toBeNull();

      // 2. Con isReviewOpen={true}
      rerender(
        <OpenSpecEngineCard
          status={combinedDivergentUpgradeStatus}
          compact={false}
          onOpenReview={vi.fn()}
          isReviewOpen={true}
        />,
      );

      // NO existe «Revisar actualización»
      expect(screen.queryByRole('button', { name: /Revisar actualización|Cerrar revisión/i })).toBeNull();
      // NO existe «Actualizar el motor»
      expect(screen.queryByRole('button', { name: /Actualizar el motor/i })).toBeNull();
      // NO existen «Actualizar la integración» ni «Cómo resolverlo»
      expect(screen.queryByRole('button', { name: /Actualizar la integración/i })).toBeNull();
      expect(screen.queryByText(/Cómo resolverlo/i)).toBeNull();
      expect(screen.getByText(/⚠️/i)).toBeDefined();
    });
  });

  describe('defaultAdvancedOpen (Tanda 8.23 b)', () => {
    it('con defaultAdvancedOpen el bloque «Perfil de Workflows Global» se ve sin pulsar el botón de alternancia', () => {
      const dummyStatus: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.8.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.8.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: null,
        repoState: 'initialized',
        integrationState: 'up-to-date',
        divergence: null,
      };

      render(<OpenSpecEngineCard status={dummyStatus} defaultAdvancedOpen={true} />);

      expect(screen.getByText('Perfil de Workflows Global')).toBeDefined();
    });
  });

  describe('OpenSpecEngineCard (Causas missingByIntegration y missingByProfile - Tarea 7.4)', () => {
    afterEach(() => {
      cleanup();
      delete (window as any).api;
    });

    const baseStatusWithProfile = (profile: string): OpenSpecEngineStatus => ({
      cli: {
        installed: true,
        runtimeVersion: '1.12.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.12.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      },
      latestAvailable: null,
      globalConfig: {
        rawProfile: profile,
        profileState: 'read',
        delivery: 'both',
        deliveryState: 'read',
        configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
        workflowsState: 'read',
        resolvedWorkflows: ['propose', 'explore', 'apply', 'update', 'sync', 'archive'],
        resolvedWorkflowsState: 'read',
        origin: 'cli',
        readAt: '2026-09-11T12:00:00.000Z',
      },
      installedIntegration: null,
      repoState: 'initialized',
      integrationState: 'up-to-date',
    });

    it('con targetConvergences desactualizado y onRequestUpdate: muestra causa integración y botón Actualizar lo llama', async () => {
      const onRequestUpdate = vi.fn();
      const status: OpenSpecEngineStatus = {
        ...baseStatusWithProfile('core'),
        divergence: {
          isDivergent: true,
          reason: null,
          overallStatus: 'divergent',
          globalProfileClass: 'core',
          repoProfileClass: 'custom',
          targetConvergences: {
            claude: {
              toolId: 'claude',
              label: 'Claude Code',
              status: 'divergent',
              targetProfileClass: 'custom',
              installedWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
            },
          },
        },
      };

      render(
        <OpenSpecEngineCard
          status={status}
          compact={false}
          defaultAdvancedOpen={true}
          onRequestUpdate={onRequestUpdate}
        />,
      );

      expect(
        screen.getByText('Falta en Claude Code: la integración está desactualizada.'),
      ).toBeDefined();

      const updateBtn = screen.getByRole('button', { name: 'Actualizar' });
      fireEvent.click(updateBtn);
      expect(onRequestUpdate).toHaveBeenCalledTimes(1);
    });

    it('con perfil core y configured con verify: muestra causa perfil y Cambiar a custom llama a setProfile', async () => {
      const setProfileMock = vi.fn().mockResolvedValue({ ok: true });
      (window as any).api = {
        pipelineOpenSpec: {
          setWorkflow: vi.fn(),
          setProfile: setProfileMock,
        },
      };

      const base = baseStatusWithProfile('core');
      const status: OpenSpecEngineStatus = {
        ...base,
        globalConfig: {
          ...base.globalConfig!,
          configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive', 'verify'],
        },
        divergence: {
          isDivergent: true,
          reason: null,
          overallStatus: 'divergent',
          globalProfileClass: 'core',
          repoProfileClass: 'custom',
          targetConvergences: {
            claude: {
              toolId: 'claude',
              label: 'Claude Code',
              status: 'divergent',
              targetProfileClass: 'custom',
              installedWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
            },
          },
        },
      };

      render(
        <OpenSpecEngineCard
          status={status}
          compact={false}
          defaultAdvancedOpen={true}
          repoPath="C:\\repo"
        />,
      );

      expect(
        screen.getByText(/el perfil no lo habilita\./i),
      ).toBeDefined();

      const switchBtn = screen.getByRole('button', { name: 'Cambiar a custom' });
      fireEvent.click(switchBtn);

      expect(setProfileMock).toHaveBeenCalledTimes(1);
      expect(setProfileMock).toHaveBeenCalledWith({ profile: 'custom' });
    });

    it('con perfil custom y configured con verify: botón dice Activar verify y llama a setWorkflow', async () => {
      const setWorkflowMock = vi.fn().mockResolvedValue({ ok: true });
      (window as any).api = {
        pipelineOpenSpec: {
          setWorkflow: setWorkflowMock,
          setProfile: vi.fn(),
        },
      };

      const base = baseStatusWithProfile('custom');
      const status: OpenSpecEngineStatus = {
        ...base,
        globalConfig: {
          ...base.globalConfig!,
          rawProfile: 'custom',
          configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive', 'verify'],
        },
        divergence: {
          isDivergent: true,
          reason: null,
          overallStatus: 'divergent',
          globalProfileClass: 'custom',
          repoProfileClass: 'custom',
          targetConvergences: {
            claude: {
              toolId: 'claude',
              label: 'Claude Code',
              status: 'divergent',
              targetProfileClass: 'custom',
              installedWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
            },
          },
        },
      };

      render(
        <OpenSpecEngineCard
          status={status}
          compact={false}
          defaultAdvancedOpen={true}
          repoPath="C:\\repo"
        />,
      );

      const toggleBtn = screen.getByRole('button', { name: 'Activar verify' });
      fireEvent.click(toggleBtn);

      expect(setWorkflowMock).toHaveBeenCalledTimes(1);
      expect(setWorkflowMock).toHaveBeenCalledWith({ workflow: 'verify', enabled: true });
    });

    it('con targetConvergences donde claude tiene los seis: no existe ningún elemento con data-cause', () => {
      const status: OpenSpecEngineStatus = {
        ...baseStatusWithProfile('core'),
        divergence: {
          isDivergent: false,
          reason: null,
          overallStatus: 'convergent',
          globalProfileClass: 'core',
          repoProfileClass: 'core',
          targetConvergences: {
            claude: {
              toolId: 'claude',
              label: 'Claude Code',
              status: 'convergent',
              targetProfileClass: 'core',
              installedWorkflows: ['propose', 'explore', 'apply', 'update', 'sync', 'archive'],
            },
          },
        },
      };

      const { container } = render(
        <OpenSpecEngineCard
          status={status}
          compact={false}
          defaultAdvancedOpen={true}
        />,
      );

      expect(container.querySelectorAll('[data-cause]').length).toBe(0);
    });
  });

  describe('Diagnóstico avanzado en una sola columna y explicaciones', () => {
    it('muestra encabezados, explicaciones y paths completos para outputs presentes y ausentes', () => {
      const status: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.12.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.12.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: {
          skills: [],
          generatedBy: '1.12.0',
          markersFound: [],
          outputInventory: [
            {
              id: 'present-1',
              targetName: 'minimax',
              kind: 'external-global',
              displayPath: 'C:\\Users\\test\\.gemini\\antigravity\\skills\\openspec-explore',
              presenceState: 'present',
              blocked: false,
              descriptionKey: 'pipeline.openspec.engine.output.minimaxDesc',
            },
            {
              id: 'absent-1',
              targetName: 'github',
              kind: 'repo-local',
              displayPath: '.github/workflows/openspec.yml',
              presenceState: 'absent',
              blocked: false,
              descriptionKey: 'pipeline.openspec.engine.output.githubDesc',
            },
          ],
          evidenceStatus: 'confirmed',
          tools: [],
          targets: [],
          installedWorkflowsByTarget: {},
          missing: null,
          legacy: [],
          customized: [],
          conflicts: null,
        },
        repoState: 'initialized',
        integrationState: 'up-to-date',
      };

      render(
        <OpenSpecAgentsBlock
          outputInventory={status.installedIntegration!.outputInventory}
        />,
      );

      // Outputs presentes: título con h4, explicación de una frase, y path en <code>
      expect(screen.getByText('Archivos y carpetas que OpenSpec genera para cada agente; si están, ese agente tiene la integración instalada.')).toBeDefined();
      const codePresent = screen.getByText('C:\\Users\\test\\.gemini\\antigravity\\skills\\openspec-explore');
      expect(codePresent.tagName.toLowerCase()).toBe('code');

      // Outputs ausentes: expandir y verificar explicación y path en <code>
      const toggleAbsentBtn = screen.getByRole('button', { name: /Ver outputs ausentes/i });
      fireEvent.click(toggleAbsentBtn);

      expect(screen.getByText('Destinos que OpenSpec puede generar y este repositorio no usa; es normal.')).toBeDefined();
      const codeAbsent = screen.getByText('.github/workflows/openspec.yml');
      expect(codeAbsent.tagName.toLowerCase()).toBe('code');
    });

    it('muestra explicaciones y comandos en línea propia para openspec doctor y openspec context', () => {
      const status: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.12.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.12.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: null,
        repoState: 'initialized',
        integrationState: 'up-to-date',
        doctor: {
          command: 'openspec doctor --json',
          ok: true,
          error: null,
          data: {
            root: {
              path: 'C:\\www\\gitCronos',
              source: 'nearest',
              healthy: true,
              status: [],
            },
            store: null,
            references: [],
            status: [],
          },
        },
        contextBrief: {
          command: 'openspec context --json',
          ok: true,
          error: null,
          data: {
            root: {
              path: 'C:\\www\\gitCronos',
              source: 'nearest',
              role: 'openspec_root',
            },
            status: [],
            members: [],
          },
        },
      };

      render(
        <OpenSpecEngineCard
          status={status}
          compact={false}
          defaultAdvancedOpen={true}
        />,
      );

      // Doctor: encabezado, explicación y comando
      expect(screen.getByText('openspec doctor revisa que specs, changes y archivos generados se correspondan entre sí; si reporta algo, la integración está rota en ese punto.')).toBeDefined();
      const doctorSection = screen.getByTestId('openspec-doctor-section');
      expect(doctorSection.querySelector('code')?.textContent).toBe('openspec doctor --json');

      // Context: encabezado, explicación y comando
      expect(screen.getByText('openspec context resuelve con qué configuración y perfil trabaja el motor en este repositorio; sirve para confirmar que GitCron y el CLI ven lo mismo.')).toBeDefined();
      const contextSection = screen.getByTestId('openspec-context-section');
      expect(contextSection.querySelector('code')?.textContent).toBe('openspec context --json');
    });

    it('las secciones de diagnóstico avanzado (outputs, doctor, context) usan encabezados h3 con reviewSectionTitle y outputs en OpenSpecOutputsList', () => {
      const status: OpenSpecEngineStatus = {
        cli: {
          installed: true,
          runtimeVersion: '1.12.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.12.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        },
        latestAvailable: null,
        globalConfig: null,
        installedIntegration: {
          skills: [],
          generatedBy: '1.12.0',
          markersFound: [],
          outputInventory: [
            {
              id: 'output-present-1',
              targetName: 'Gemini Skills',
              kind: 'external-global',
              displayPath: 'C:\\Users\\test\\.gemini\\antigravity\\skills\\openspec-explore',
              descriptionKey: 'pipeline.openspec.engine.output.geminiSkillsDesc',
              blocked: false,
              presenceState: 'present',
            },
            {
              id: 'output-absent-1',
              targetName: 'GitHub Workflows',
              kind: 'repo-local',
              displayPath: '.github/workflows/openspec.yml',
              descriptionKey: 'pipeline.openspec.engine.output.githubWorkflowsDesc',
              blocked: false,
              presenceState: 'absent',
            },
          ],
          evidenceStatus: 'confirmed',
          tools: ['agents'],
          targets: ['agents'],
          installedWorkflowsByTarget: {},
          missing: null,
          legacy: [],
          customized: [],
          conflicts: null,
        },
        repoState: 'initialized',
        integrationState: 'up-to-date',
        doctor: {
          command: 'openspec doctor --json',
          ok: true,
          error: null,
          data: {
            root: null,
            store: null,
            references: [],
            status: [],
          },
        },
        contextBrief: {
          command: 'openspec context --json',
          ok: true,
          error: null,
          data: {
            root: null,
            members: [],
            status: [],
          },
        },
      };

      render(
        <>
          <OpenSpecEngineCard
            status={status}
            compact={false}
            defaultAdvancedOpen={true}
          />
          <OpenSpecAgentsBlock
            outputInventory={status.installedIntegration!.outputInventory}
          />
        </>,
      );

      // Los encabezados de doctor y context usan h3 con reviewSectionTitle
      const doctorSection = screen.getByTestId('openspec-doctor-section');
      const doctorH3 = doctorSection.querySelector('h3');
      expect(doctorH3).toBeTruthy();
      expect(doctorH3?.className).toContain('reviewSectionTitle');

      const contextSection = screen.getByTestId('openspec-context-section');
      const contextH3 = contextSection.querySelector('h3');
      expect(contextH3).toBeTruthy();
      expect(contextH3?.className).toContain('reviewSectionTitle');

      // Outputs presentes renderizan en OpenSpecOutputsList con h3 reviewSectionTitle
      const outputsTitle = screen.getByText(/Outputs Administrables/i);
      expect(outputsTitle.tagName.toLowerCase()).toBe('h3');
      expect(outputsTitle.className).toContain('reviewSectionTitle');

      // Fila en una línea con kind, code path y presence
      const codePresent = screen.getByText('C:\\Users\\test\\.gemini\\antigravity\\skills\\openspec-explore');
      expect(codePresent.tagName.toLowerCase()).toBe('code');
      expect(screen.getByText(/Global externo/i)).toBeTruthy();
      expect(screen.getByText(/Presente/i)).toBeTruthy();
    });
  });
});
