// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { OpenSpecUpdateReview } from '../OpenSpecUpdateReview';
import type { OpenSpecEngineStatus, OpenSpecUpdatePlan } from '@/types/pipeline';
import { usePipelineStore } from '@/lib/pipeline-store';

describe('OpenSpecUpdateReview (Fase 6: Revisión sin mutación en columna central)', () => {
  const mockStatus: OpenSpecEngineStatus = {
    cli: {
      installed: true,
      runtimeVersion: '1.8.0',
      provenance: 'global',
      displayPath: 'C:\\Users\\user\\AppData\\Roaming\\npm\\openspec.cmd',
      supportedRange: { min: '1.5.0', max: '1.8.0' },
      versionClass: 'supported',
      evidenceStatus: 'confirmed',
      diagnostics: [],
    },
    latestAvailable: {
      status: 'online',
      latestVersion: '1.8.0',
      checkedAt: new Date().toISOString(),
      fromCache: false,
      cacheAgeSeconds: 0,
      freshness: 'fresh',
      error: null,
    },
    globalConfig: null,
    installedIntegration: {
      skills: [
        {
          name: 'openspec-propose',
          path: 'C:\\repo\\.codex\\skills\\openspec-propose',
          origin: 'legacy-codex',
          isOfficial: true,
        },
        {
          name: 'openspec-apply-change',
          path: 'C:\\repo\\.claude\\skills\\openspec-apply-change',
          origin: 'official-other',
          isOfficial: true,
        },
        {
          name: 'accessibility',
          path: 'C:\\repo\\.agents\\skills\\accessibility',
          origin: 'custom-agents',
          isOfficial: false,
        },
      ],
      generatedBy: '1.8.0',
      markersFound: [],
      outputInventory: [
        {
          id: 'output-agents',
          targetName: 'Agents Multi-Agent',
          kind: 'repo-local',
          displayPath: '.agents/skills/openspec-*',
          descriptionKey: 'pipeline.openspec.engine.output.agentsDesc',
          blocked: false,
          presenceState: 'present',
        },
      ],
      evidenceStatus: 'confirmed',
      tools: ['agents', 'codex', 'claude'],
      targets: ['agents', 'codex', 'claude'],
      presentToolDirectories: ['agents', 'codex', 'claude'],
      installedWorkflowsByTarget: {},
      missing: null,
      legacy: ['codex'],
      customized: ['accessibility'],
      conflicts: null,
    },
    repoState: 'initialized',
    integrationState: 'outdated',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    delete (window as any).api;
  });

  it('renderiza la revisión en la columna central con hechos del motor', () => {
    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    // Banner de seguridad retirado
    expect(screen.queryByText(/Revisión declarativa de sólo lectura/i)).toBeNull();

    // Hechos del motor (al día)
    expect(screen.getByText(/Motor v1\.8\.0 · al día/i)).toBeTruthy();

    // Diagnóstico avanzado abierto por omisión en la revisión (Tanda 8.23 b)
    expect(screen.getByRole('button', { name: /Ocultar diagnóstico avanzado/i })).toBeTruthy();
    expect(screen.getByText('Global (PATH)')).toBeTruthy();
  });

  it('muestra el comando sugerido exacto no traducido con botón de copiado', () => {
    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    const termToggle = screen.getByRole('button', { name: /Desde la terminal/i });
    fireEvent.click(termToggle);
    expect(screen.getByText('openspec update')).toBeTruthy();
  });

  it('no renderiza botón Ver el repositorio y llama a onBack con el botón Cerrar de abajo', () => {
    const handleBack = vi.fn();
    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        onBack={handleBack}
      />,
    );

    // No existe botón "Ver el repositorio" ni "Volver"
    expect(screen.queryByRole('button', { name: /Ver el repositorio/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Volver/i })).toBeNull();

    // Botón Cerrar del pie
    const closeBtn = screen.getByRole('button', { name: /Cerrar/i });
    fireEvent.click(closeBtn);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('renderiza la matriz de convivencia como tabla semántica con tipos y marcas por carpeta', () => {
    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    const techToggle = screen.getByRole('button', { name: /Detalle técnico/i });
    fireEvent.click(techToggle);

    expect(screen.getByText('Matriz de convivencia de skills')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^Skill$/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^Tipo$/i })).toBeTruthy();

    expect(screen.getByText('openspec-propose')).toBeTruthy();
    expect(screen.getByText('openspec-apply-change')).toBeTruthy();
    expect(screen.getByText('accessibility')).toBeTruthy();

    expect(screen.getByText('Legacy')).toBeTruthy();
    expect(screen.getByText('Oficial')).toBeTruthy();
    expect(screen.getByText('Personalizado')).toBeTruthy();
  });

  it('con status null, el bloque AGENTES existe y muestra el aviso de readiness y la lista de herramientas', () => {
    const snapshotWithTools = {
      openSpec: {
        openSpecPresent: false,
        openSpecTools: [
          { toolId: 'claude', label: 'Claude Code', directory: '.claude', configured: true },
        ],
      },
    } as any;

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={null}
        snapshot={snapshotWithTools}
        onBack={vi.fn()}
      />,
    );

    const agentsRegion = screen.getByRole('region', { name: /^Agentes$/i });
    expect(agentsRegion).toBeTruthy();
    expect(within(agentsRegion).getByText(/Este repositorio no usa OpenSpec/i)).toBeTruthy();
    expect(within(agentsRegion).getByRole('button', { name: /Inicializar OpenSpec/i })).toBeTruthy();
  });

  it('la tabla de convivencia tiene una fila por skill y una columna por carpeta, y un skill oficial en .agents y .claude aparece UNA sola vez con dos marcas', () => {
    const statusWithMultiSkills: OpenSpecEngineStatus = {
      ...mockStatus,
      installedIntegration: {
        ...mockStatus.installedIntegration!,
        skills: [
          {
            name: 'openspec-explore',
            path: 'C:\\repo\\.agents\\skills\\openspec-explore',
            origin: 'new-agents',
            isOfficial: true,
          },
          {
            name: 'openspec-explore',
            path: 'C:\\repo\\.claude\\skills\\openspec-explore',
            origin: 'official-other',
            isOfficial: true,
          },
          {
            name: 'custom-skill',
            path: 'C:\\repo\\.agents\\skills\\custom-skill',
            origin: 'custom-agents',
            isOfficial: false,
          },
        ],
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={statusWithMultiSkills}
        onBack={vi.fn()}
      />,
    );

    const techToggle = screen.getByRole('button', { name: /Detalle técnico/i });
    fireEvent.click(techToggle);

    // Tabla con caption semántico
    expect(screen.getByText('Matriz de convivencia de skills')).toBeTruthy();

    // Columnas detectadas: Skill, .agents, .claude, Tipo (.agents primero)
    expect(screen.getByRole('columnheader', { name: /^Skill$/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^\.agents$/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^\.claude$/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^Tipo$/i })).toBeTruthy();

    // openspec-explore aparece UNA SOLA VEZ en la tabla (una fila por skill)
    const exploreCells = screen.getAllByText('openspec-explore');
    expect(exploreCells).toHaveLength(1);

    // La fila de openspec-explore contiene dos marcas de verificación (✓)
    const exploreRow = exploreCells[0].closest('tr');
    expect(exploreRow).toBeTruthy();
    if (exploreRow) {
      const marks = within(exploreRow).getAllByText('✓');
      expect(marks).toHaveLength(2);
      expect(within(exploreRow).getByText('Oficial')).toBeTruthy();
    }
  });

  it('copia el comando oficial al portapapeles al hacer clic', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    const termToggle = screen.getByRole('button', { name: /Desde la terminal/i });
    fireEvent.click(termToggle);

    const copyBtn = screen.getByRole('button', { name: /Copiar comando/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('openspec update');
  });

  it('muestra aviso de confirmación en main, Cancelar no ejecuta y Actualizar igual ejecuta', async () => {
    const runUpdateMock = vi.fn().mockResolvedValue({ success: true, status: 'completed', filesUpdated: [], errors: [] });
    (window as any).api = {
      pipelineOpenSpec: {
        runUpdate: runUpdateMock,
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        currentBranch="main"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    const updateBtn = screen.getByRole('button', { name: /^Actualizar$/i });
    expect(updateBtn.hasAttribute('disabled')).toBe(false);

    // Al hacer clic, aparece el aviso en el mismo lugar
    fireEvent.click(updateBtn);
    expect(screen.getByText(/Estás en «main»\. La actualización va a escribir directo en esta rama\./)).toBeTruthy();

    const cancelBtn = screen.getByRole('button', { name: /Cancelar/i });
    const confirmBtn = screen.getByRole('button', { name: /Actualizar igual/i });
    expect(cancelBtn).toBeTruthy();
    expect(confirmBtn).toBeTruthy();

    // Cancelar no llama al canal y vuelve a la vista normal
    fireEvent.click(cancelBtn);
    expect(runUpdateMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Estás en «main»/)).toBeNull();

    // Clic de nuevo y confirmar con Actualizar igual
    const updateBtnAgain = screen.getByRole('button', { name: /^Actualizar$/i });
    fireEvent.click(updateBtnAgain);
    const confirmBtnAgain = screen.getByRole('button', { name: /Actualizar igual/i });
    fireEvent.click(confirmBtnAgain);
    expect(runUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('muestra aviso de confirmación con árbol sucio, Cancelar no ejecuta y Actualizar igual ejecuta', async () => {
    const runUpdateMock = vi.fn().mockResolvedValue({ success: true, status: 'completed', filesUpdated: [], errors: [] });
    (window as any).api = {
      pipelineOpenSpec: {
        runUpdate: runUpdateMock,
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        currentBranch="feature/test"
        isClean={false}
        uncommittedCount={4}
        onBack={vi.fn()}
      />,
    );

    const updateBtn = screen.getByRole('button', { name: /^Actualizar$/i });
    expect(updateBtn.hasAttribute('disabled')).toBe(false);

    // Al hacer clic, aparece el aviso con la cantidad de archivos
    fireEvent.click(updateBtn);
    expect(screen.getByText(/Tenés 4 archivos sin confirmar/)).toBeTruthy();

    const cancelBtn = screen.getByRole('button', { name: /Cancelar/i });
    fireEvent.click(cancelBtn);
    expect(runUpdateMock).not.toHaveBeenCalled();

    // Confirmar ejecuta
    fireEvent.click(screen.getByRole('button', { name: /^Actualizar$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Actualizar igual/i }));
    expect(runUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('con copias viejas no aparece «--force» y con getLegacySkillsPlan pendiente no hay botón de retiro y muestra comprobando', () => {
    (window as any).api = {
      pipelineOpenSpec: {
        getLegacySkillsPlan: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    };
    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        currentBranch="change/test"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    expect(screen.queryByText(/--force/i)).toBeNull();
    expect(screen.queryByText(/Limpieza de configuración legacy/i)).toBeNull();
    expect(screen.getByText('Copias viejas de las instrucciones')).toBeTruthy();
    expect(screen.getByText('C:\\repo\\.codex\\skills\\openspec-propose')).toBeTruthy();
    expect(screen.getByText(/Comprobando si se pueden recuperar con Git…/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retirar copias viejas' })).toBeNull();
  });

  it('con fallo en getLegacySkillsPlan avisa que no se pudo comprobar y no ofrece el botón de retiro', async () => {
    const getLegacySkillsPlanMock = vi.fn().mockRejectedValue(new Error('Fallo de lectura'));
    (window as any).api = {
      pipelineOpenSpec: {
        getLegacySkillsPlan: getLegacySkillsPlanMock,
      },
    };
    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        currentBranch="change/test"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByText(/No se pudo comprobar si las copias se pueden recuperar con Git/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retirar copias viejas' })).toBeNull();
  });

  it('con getLegacySkillsPlan resuelto muestra las acciones del plan y ofrece el botón «Retirar copias viejas»', async () => {
    const getLegacySkillsPlanMock = vi.fn().mockResolvedValue({
      items: [
        {
          name: 'openspec-propose',
          path: 'C:\\repo\\.codex\\skills\\openspec-propose',
          origin: 'legacy-codex',
          removable: true,
        },
        {
          name: 'openspec-custom',
          path: 'C:\\repo\\.codex\\skills\\openspec-custom',
          origin: 'legacy-codex',
          removable: false,
          reason: 'untracked',
        },
      ],
    });
    (window as any).api = {
      pipelineOpenSpec: {
        getLegacySkillsPlan: getLegacySkillsPlanMock,
      },
    };
    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        currentBranch="change/test"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Retirar copias viejas' })).toBeTruthy();
    expect(screen.getByText('C:\\repo\\.codex\\skills\\openspec-propose')).toBeTruthy();
    expect(screen.getByText('C:\\repo\\.codex\\skills\\openspec-custom')).toBeTruthy();
    expect(screen.getByText(/No está seguida en Git/i)).toBeTruthy();
  });

  it('flujo de retiro de copias viejas: confirmar llama al canal una vez, muestra lo borrado y el estado recalculado; cancelar llama cero veces', async () => {
    const getLegacySkillsPlanMock = vi.fn().mockResolvedValue({
      items: [
        {
          name: 'openspec-propose',
          path: 'C:\\repo\\.codex\\skills\\openspec-propose',
          origin: 'legacy-codex',
          removable: true,
        },
      ],
    });
    const removeLegacySkillsMock = vi.fn().mockResolvedValue({
      removed: ['C:\\repo\\.codex\\skills\\openspec-propose'],
      skipped: [],
      engineStatus: {
        ...mockStatus,
        installedIntegration: {
          ...mockStatus.installedIntegration,
          skills: [],
          legacy: [],
        },
        integrationState: 'up-to-date',
      },
    });

    (window as any).api = {
      pipelineOpenSpec: {
        getLegacySkillsPlan: getLegacySkillsPlanMock,
        removeLegacySkills: removeLegacySkillsMock,
      },
    };

    const repoPath = 'C:/repo';
    render(
      <OpenSpecUpdateReview
        repoPath={repoPath}
        status={mockStatus}
        currentBranch="change/test"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    // 1. Abrir diálogo de confirmación
    const removeBtn = await screen.findByRole('button', { name: 'Retirar copias viejas' });
    await waitFor(() => {
      expect(removeBtn.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(removeBtn);

    expect(screen.getByText('Confirmar retiro de copias viejas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar retiro' })).toBeTruthy();
    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancelBtn).toBeTruthy();

    // 2. Cancelar retiro: no llama a removeLegacySkills y cierra la confirmación
    fireEvent.click(cancelBtn);
    expect(removeLegacySkillsMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Confirmar retiro de copias viejas')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retirar copias viejas' })).toBeTruthy();

    // 3. Volver a abrir y confirmar retiro
    fireEvent.click(screen.getByRole('button', { name: 'Retirar copias viejas' }));
    await React.act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar retiro' }));
    });

    // 4. Verifica llamada única al canal con el repoPath
    expect(removeLegacySkillsMock).toHaveBeenCalledTimes(1);
    expect(removeLegacySkillsMock).toHaveBeenCalledWith(repoPath);

    // 5. Muestra la línea reducida y no la lista de archivos inicialmente (6.8)
    expect(screen.getByText(/Se retiraron 1 copias viejas; quedan como borradas sin confirmar en Git/i)).toBeTruthy();
    expect(screen.queryByText('C:\\repo\\.codex\\skills\\openspec-propose')).toBeNull();

    // 6. Al tocar «Ver lista» se muestra la lista de archivos borrados
    const viewListBtn = screen.getByRole('button', { name: 'Ver lista' });
    fireEvent.click(viewListBtn);
    expect(screen.getByText('C:\\repo\\.codex\\skills\\openspec-propose')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ocultar lista' })).toBeTruthy();

    // 7. Al tocar «Ocultar lista» se vuelve a ocultar
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar lista' }));
    expect(screen.queryByText('C:\\repo\\.codex\\skills\\openspec-propose')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver lista' })).toBeTruthy();

    // 8. Al tocar «Cerrar» se quita la sección completamente
    const legacySection = screen.getByRole('region', { name: 'Copias viejas de las instrucciones' });
    const closeBtn = within(legacySection).getByRole('button', { name: 'Cerrar' });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('region', { name: 'Copias viejas de las instrucciones' })).toBeNull();
  });

  it('el retiro que falla muestra el error y deja el botón disponible para reintentar', async () => {
    const getLegacySkillsPlanMock = vi.fn().mockResolvedValue({
      items: [
        {
          name: 'openspec-propose',
          path: 'C:\\repo\\.codex\\skills\\openspec-propose',
          origin: 'legacy-codex',
          removable: true,
        },
      ],
    });
    const removeLegacySkillsMock = vi.fn().mockRejectedValue(new Error('Permiso denegado'));

    (window as any).api = {
      pipelineOpenSpec: {
        getLegacySkillsPlan: getLegacySkillsPlanMock,
        removeLegacySkills: removeLegacySkillsMock,
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        currentBranch="change/test"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    const removeBtn = await screen.findByRole('button', { name: 'Retirar copias viejas' });
    fireEvent.click(removeBtn);

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar retiro' });
    await React.act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(screen.getByText(/Permiso denegado/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retirar copias viejas' })).toBeTruthy();
  });

  it('con updatePlan "blocked" y un retiro cuyo engineStatus queda al día, la cabecera deja de decir «detenida» y notifyEngineChanged se llamó una vez', async () => {
    const notifySpy = vi.spyOn(usePipelineStore.getState(), 'notifyEngineChanged');
    const getLegacySkillsPlanMock = vi.fn().mockResolvedValue({
      items: [
        {
          name: 'openspec-propose',
          path: 'C:\\repo\\.codex\\skills\\openspec-propose',
          origin: 'legacy-codex',
          removable: true,
        },
      ],
    });
    const removeLegacySkillsMock = vi.fn().mockResolvedValue({
      removed: ['C:\\repo\\.codex\\skills\\openspec-propose'],
      skipped: [],
      engineStatus: {
        ...mockStatus,
        installedIntegration: {
          ...mockStatus.installedIntegration,
          skills: [],
          legacy: [],
        },
        integrationState: 'up-to-date',
      },
    });

    (window as any).api = {
      pipelineOpenSpec: {
        getLegacySkillsPlan: getLegacySkillsPlanMock,
        removeLegacySkills: removeLegacySkillsMock,
      },
    };

    const blockedPlan = {
      repoPath: 'C:\\repo',
      requiredAction: 'blocked',
      reason: 'Hay copias viejas',
      canExecute: false,
    } as unknown as OpenSpecUpdatePlan;

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        updatePlan={blockedPlan}
        currentBranch="change/test"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/detenida/i)).toBeTruthy();

    const removeBtn = await screen.findByRole('button', { name: 'Retirar copias viejas' });
    fireEvent.click(removeBtn);

    await React.act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar retiro' }));
    });

    expect(screen.queryByText(/detenida/i)).toBeNull();
    expect(screen.getByText('Al día')).toBeTruthy();
    expect(notifySpy).toHaveBeenCalledTimes(1);
    notifySpy.mockRestore();
  });

  const statusWithOlderEngine: OpenSpecEngineStatus = {
    ...mockStatus,
    cli: {
      ...mockStatus.cli,
      runtimeVersion: '1.5.0',
    },
    latestAvailable: {
      status: 'online',
      latestVersion: '1.9.0',
      checkedAt: new Date().toISOString(),
      fromCache: false,
      cacheAgeSeconds: 0,
      freshness: 'fresh',
      error: null,
    },
  };

  it('ofrece botón Actualizar, la línea de plan menciona actualizar el motor a v1.9.0 y el comando está dentro de «Desde la terminal»', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const pnpmCommand = 'pnpm add -g @fission-ai/openspec@latest';
    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={statusWithOlderEngine}
        installPlan={{
          globalCommand: pnpmCommand,
          localCommand: null,
          hasManifest: false,
          nodePath: 'C:\\node.exe',
          packageManagerPath: 'C:\\pnpm.cmd',
          detectedManager: 'pnpm',
        }}
        currentBranch="change/test"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    // Hecho superior con la oferta de actualización del motor host
    expect(screen.getByText(/Motor v1\.5\.0 instalado · v1\.9\.0 disponible en npm/)).toBeTruthy();

    // Botón Actualizar presente
    const updateBtn = screen.getByRole('button', { name: /^Actualizar$/i });
    expect(updateBtn).toBeTruthy();

    // La línea de plan menciona actualizar el motor a v1.9.0
    expect(screen.getByText(/actualizar el motor en toda la máquina a v1\.9\.0/i)).toBeTruthy();

    // Abrir comando desde la terminal
    const termToggle = screen.getByRole('button', { name: /Desde la terminal/i });
    fireEvent.click(termToggle);
    expect(screen.getByText('O desde la terminal:')).toBeTruthy();
    expect(screen.getByText(pnpmCommand)).toBeTruthy();

    // Copiar comando
    const copyButtons = screen.getAllByRole('button', { name: /Copiar comando/i });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(copyButtons[0]);
    expect(writeTextMock).toHaveBeenCalledWith(pnpmCommand);
  });

  it('al apretar «Actualizar» con motor desactualizado se llama a installGlobal y la fila del motor queda en listo', async () => {
    const installGlobalMock = vi.fn().mockResolvedValue({
      success: true,
      engineStatus: {
        cli: { installed: true, runtimeVersion: '1.9.0' },
        doctor: { data: {} },
        globalConfig: { profileState: 'ready' },
      },
    });
    const runUpdateMock = vi.fn().mockResolvedValue({
      success: true,
      filesUpdated: [],
    });
    (window as any).api = {
      pipelineOpenSpec: {
        installGlobal: installGlobalMock,
        runUpdate: runUpdateMock,
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={statusWithOlderEngine}
        installPlan={{
          globalCommand: 'npm i -g @fission-ai/openspec@latest',
          localCommand: null,
          hasManifest: false,
          nodePath: 'C:\\node.exe',
          packageManagerPath: 'C:\\npm.cmd',
          detectedManager: 'npm',
        }}
        currentBranch="change/test"
        isClean={true}
        onBack={vi.fn()}
      />,
    );

    const updateBtn = screen.getByRole('button', { name: /^Actualizar$/i });
    fireEvent.click(updateBtn);

    const confirmGlobalBtn = await screen.findByRole('button', { name: /Confirmar instalación global/i });
    fireEvent.click(confirmGlobalBtn);

    await screen.findByText(/Motor v1\.9\.0 instalado y respondiendo\./i);
    expect(installGlobalMock).toHaveBeenCalledTimes(1);
    expect(installGlobalMock).toHaveBeenCalledWith({ repoPath: 'C:\\\\repo', targetVersion: '1.9.0' });
  });

  it('con CLI no instalado, el motivo de bloqueo explica la causa real y no contiene POC', () => {
    const statusNoCli: OpenSpecEngineStatus = {
      ...mockStatus,
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
      repoState: 'initialized',
      integrationState: 'outdated',
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={statusNoCli}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/El CLI de OpenSpec no está instalado en el sistema/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/POC/i)).toBeNull();
  });

  it('ejecuta la actualización end-to-end con estado de carga, reporte de archivos y botón de preparar commit (Hallazgo 5)', async () => {
    let resolveRunUpdate!: (val: any) => void;
    const runUpdatePromise = new Promise((resolve) => {
      resolveRunUpdate = resolve;
    });

    const runUpdateMock = vi.fn().mockReturnValue(runUpdatePromise);
    (window as any).api = {
      pipelineOpenSpec: {
        runUpdate: runUpdateMock,
      },
    };

    const handlePrepareCommit = vi.fn();
    const handleUpdateCompleted = vi.fn();

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={mockStatus}
        currentBranch="change/actualizar-openspec"
        isClean={true}
        onBack={vi.fn()}
        onPrepareCommit={handlePrepareCommit}
        onUpdateCompleted={handleUpdateCompleted}
      />,
    );

    // 1. Botón Actualizar está habilitado
    const updateBtn = screen.getByRole('button', { name: /^Actualizar$/i });
    expect(updateBtn.hasAttribute('disabled')).toBe(false);

    // 2. Hacer clic en ejecutar
    fireEvent.click(updateBtn);
    expect(runUpdateMock).toHaveBeenCalledWith('C:/repo', undefined, false);

    // 3. Verifica estado de carga durante la ejecución
    expect(screen.getByText(/Actualizando integración…/i)).toBeTruthy();

    // 4. Resolver la promesa exitosamente
    await React.act(async () => {
      resolveRunUpdate({
        success: true,
        status: 'completed',
        filesUpdated: [
          'a.md',
          'b.md',
        ],
        errors: [],
        engineStatus: {
          cli: { installed: true, runtimeVersion: '1.9.0', provenance: 'global', versionClass: 'supported' },
          integrationState: 'up-to-date',
        },
      });
    });

    // 5. Render de la lista de archivos actualizados y título de éxito
    expect(await screen.findByText(/Integración actualizada/i)).toBeTruthy();
    expect(screen.getByText(/2 archivos actualizados/i)).toBeTruthy();
    expect(screen.getByText(/Listo: integración al día/i)).toBeTruthy();
    expect(handleUpdateCompleted).toHaveBeenCalled();

    // 6. Botón «Preparar commit» presente y funcional
    const prepareBtn = screen.getByRole('button', { name: /Preparar commit/i });
    expect(prepareBtn).toBeTruthy();
    fireEvent.click(prepareBtn);
    expect(handlePrepareCommit).toHaveBeenCalledTimes(1);

    // 7. Al abrir «Detalle técnico» se ven a.md y b.md bajo «Archivos tocados por la última actualización»
    const techToggle = screen.getByRole('button', { name: /Detalle técnico/i });
    fireEvent.click(techToggle);
    expect(screen.getByText('Archivos tocados por la última actualización')).toBeTruthy();
    expect(screen.getByText('a.md')).toBeTruthy();
    expect(screen.getByText('b.md')).toBeTruthy();
  });

  it('con motor al día e integración al día ("none") el botón dice «Todo al día» y está deshabilitado', () => {
    const statusUpToDate: OpenSpecEngineStatus = {
      ...mockStatus,
      installedIntegration: {
        ...mockStatus.installedIntegration!,
        skills: [
          { name: 'openspec-propose', path: 'C:/repo/.codex/skills/openspec-propose', origin: 'legacy-codex', isOfficial: true },
          { name: 'openspec-apply-change', path: 'C:/repo/.codex/skills/openspec-apply-change', origin: 'legacy-codex', isOfficial: true },
        ],
        generatedBy: '1.8.0',
        markersFound: [],
        outputInventory: [],
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={statusUpToDate}
        updatePlan={{ requiredAction: 'none', reason: null, items: [], blockers: [] } as any}
        onBack={vi.fn()}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Todo al día' });
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Motor v1\.8\.0 · al día/)).toBeTruthy();
  });

  it('por omisión los plegables «Desde la terminal» y «Detalle técnico» están cerrados y la matriz/convivencia no se muestran', () => {
    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    // Los botones de plegado están cerrados (aria-expanded="false")
    const terminalBtn = screen.getByRole('button', { name: /Desde la terminal/i });
    const techBtn = screen.getByRole('button', { name: /Detalle técnico/i });
    expect(terminalBtn.getAttribute('aria-expanded')).toBe('false');
    expect(techBtn.getAttribute('aria-expanded')).toBe('false');

    // La matriz y los bloques de convivencia no están en el DOM
    expect(screen.queryByText(/Skills legacy \(\.codex \/ \.agent\)/)).toBeNull();
    expect(screen.queryByText('openspec update')).toBeNull();

    // Pero los dos hechos superiores sí están visibles
    expect(screen.getByText(/Motor v1\.8\.0 · al día/)).toBeTruthy();
    expect(screen.getByText(/Integración de este repositorio/)).toBeTruthy();
  });

  it('con motor desactualizado e integración desactualizada muestra ambos hechos arriba en el resumen y la línea de plan', () => {
    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={statusWithOlderEngine}
        onBack={vi.fn()}
      />,
    );

    // Hecho 1: motor con versión disponible
    expect(screen.getByText(/Motor v1\.5\.0 instalado · v1\.9\.0 disponible en npm/)).toBeTruthy();

    // Hecho 2: integración desactualizada
    expect(screen.getByText(/Integración de este repositorio/)).toBeTruthy();
    expect(screen.getByText('Actualización de flujos instalados')).toBeTruthy();

    // Línea de plan
    expect(
      screen.getByText(/Va a: .*actualizar el motor en toda la máquina a v1\.9\.0.*actualizar la integración de este repositorio/i)
    ).toBeTruthy();
  });

  it('con action "blocked" el botón «Actualizar» está deshabilitado y se ve el motivo derivado del estado', () => {
    const blockedStatus: OpenSpecEngineStatus = {
      ...mockStatus,
      integrationState: 'conflicted',
    };
    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={blockedStatus}
        onBack={vi.fn()}
      />,
    );

    const updateBtn = screen.getByRole('button', { name: /^Actualizar$/i });
    expect(updateBtn.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Conviven copias viejas de las instrucciones con las nuevas/i)).toBeTruthy();
  });

  it('alterna el plegable «Desde la terminal» actualizando aria-expanded', () => {
    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    const terminalBtn = screen.getByRole('button', { name: /Desde la terminal/i });
    expect(terminalBtn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('openspec update')).toBeNull();

    fireEvent.click(terminalBtn);
    expect(terminalBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('openspec update')).toBeTruthy();

    fireEvent.click(terminalBtn);
    expect(terminalBtn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('openspec update')).toBeNull();
  });

  it('con status sano y snapshot con herramientas, los bloques «Motor» y «Agentes» muestran el estado y la lista de herramientas', () => {
    const mockSnapshot = {
      openSpec: {
        openSpecPresent: true,
        openSpecTools: [
          { toolId: 'claude', label: 'Claude Code', directory: '.claude', configured: true },
          { toolId: 'cursor', label: 'Cursor IDE', directory: '.cursor', configured: false },
        ],
      },
    } as any;

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={mockStatus}
        snapshot={mockSnapshot}
        onBack={vi.fn()}
      />,
    );

    const motorSection = screen.getByRole('region', { name: /^Motor$/i });
    expect(motorSection).toBeTruthy();
    expect(within(motorSection).getByRole('heading', { level: 3, name: /^Motor$/i })).toBeTruthy();
    expect(within(motorSection).queryByRole('heading', { level: 3, name: /Tarjeta de Diagnóstico del Motor OpenSpec/i })).toBeNull();

    const agentesSection = screen.getByRole('region', { name: /^Agentes$/i });
    expect(agentesSection).toBeTruthy();
    expect(within(agentesSection).getByRole('heading', { level: 3, name: /^Agentes$/i })).toBeTruthy();
    // Contiene la lista de herramientas vía agentsSlot
    expect(within(agentesSection).getByText('Claude Code')).toBeTruthy();
    expect(within(agentesSection).getByText('Cursor IDE')).toBeTruthy();
  });

  it('«Detalle técnico» desplegado NO contiene una segunda tarjeta (los bloques de motor y agentes aparecen una sola vez)', () => {
    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    // Abrir Detalle técnico
    const techBtn = screen.getByRole('button', { name: /Detalle técnico/i });
    fireEvent.click(techBtn);
    expect(techBtn.getAttribute('aria-expanded')).toBe('true');

    // Las secciones de motor y agentes aparecen una sola vez en todo el documento
    const motorRegions = screen.getAllByRole('region', { name: /^Motor$/i });
    expect(motorRegions).toHaveLength(1);
    const agentesRegions = screen.getAllByRole('region', { name: /^Agentes$/i });
    expect(agentesRegions).toHaveLength(1);
  });

  it('(a) con motor 1.12.0 y latest 1.13.0 y versionAnalysis simulado con notas reales, muestra encabezado «Qué trae la v1.13.0», resumen y veredicto', async () => {
    const rawText = `## What's New in v1.13.0

Archive and the delta parser stop quietly changing or dropping what you wrote, and apply now tells you when a change has no specs.

### New

- **Apply flags a change with no delta specs** - \`openspec instructions apply\` used to report a change as ready whenever its tasks existed, even with no spec deltas at all, which is the state \`openspec validate\` rejects. It now warns in both text and \`--json\`, and names both ways out: write the specs, or declare \`skip_specs: true\`.

### Improved

- **Explore finds your existing specs** - Generated guidance never named \`openspec list --specs\`, so an agent asked to read the current specs enumerated in-flight changes instead and reported the step done against the wrong thing. Explore now lists the spec inventory beside the change list, and reads a capability with the store-aware command.
- **Init and update name the workflows your profile left out** - A \`/opsx:\` command that was never installed used to read as a broken setup. Both commands now say which workflows are missing and how to add them.
- **Propose reads project context before planning** - Context is loaded from the selected project or store root before any planning decision. In a directory with no OpenSpec root, propose stops without writing and offers to initialize rather than creating one silently.

**Full Changelog**: https://github.com/Fission-AI/OpenSpec/compare/v1.12.0...v1.13.0`;

    const versionAnalysisMock = vi.fn().mockResolvedValue({
      measured: {
        installedVersion: '1.12.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: 'https://github.com/Fission-AI/OpenSpec/releases/tag/v1.13.0',
          fetched: true,
          rawText,
          error: null,
        },
        consumedSurfaces: [
          { surface: 'status', description: 'Status checks', verdict: 'compatible', evidence: 'sin cambios' },
        ],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'lmstudio:local-model',
        status: 'offline',
        text: '',
        error: null,
      },
    });

    (window as any).api = {
      ...((window as any).api ?? {}),
      pipelineOpenSpec: {
        ...((window as any).api?.pipelineOpenSpec ?? {}),
        versionAnalysis: versionAnalysisMock,
      },
    };

    const upgradeStatus: OpenSpecEngineStatus = {
      ...mockStatus,
      cli: {
        ...mockStatus.cli!,
        runtimeVersion: '1.12.0',
      },
      latestAvailable: {
        ...mockStatus.latestAvailable!,
        latestVersion: '1.13.0',
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath={'C:\\repo'}
        status={upgradeStatus}
        onBack={vi.fn()}
      />,
    );

    expect(versionAnalysisMock).toHaveBeenCalledTimes(1);
    expect(versionAnalysisMock).toHaveBeenCalledWith('C:\\repo');

    expect(await screen.findByRole('heading', { level: 3, name: 'Qué trae la v1.13.0' })).toBeTruthy();
    expect(screen.getByText(/Archive and the delta parser stop quietly/i)).toBeTruthy();
    expect(screen.getByText('No toca lo que GitCron usa')).toBeTruthy();
  });

  it('(b) con motor al día (sin upgrade), versionAnalysis NO se llama y NO existe «Qué trae la v»', () => {
    const versionAnalysisMock = vi.fn();
    (window as any).api = {
      ...((window as any).api ?? {}),
      pipelineOpenSpec: {
        ...((window as any).api?.pipelineOpenSpec ?? {}),
        versionAnalysis: versionAnalysisMock,
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    expect(versionAnalysisMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Qué trae la v/i)).toBeNull();
  });

  it('(c) mientras la promesa de versionAnalysis no resuelve, el botón «Actualizar» existe y está habilitado', () => {
    const pendingPromise = new Promise(() => {});
    const versionAnalysisMock = vi.fn().mockReturnValue(pendingPromise);

    (window as any).api = {
      ...((window as any).api ?? {}),
      pipelineOpenSpec: {
        ...((window as any).api?.pipelineOpenSpec ?? {}),
        versionAnalysis: versionAnalysisMock,
      },
    };

    const upgradeStatus: OpenSpecEngineStatus = {
      ...mockStatus,
      cli: {
        ...mockStatus.cli!,
        runtimeVersion: '1.12.0',
      },
      latestAvailable: {
        ...mockStatus.latestAvailable!,
        latestVersion: '1.13.0',
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:\\repo"
        status={upgradeStatus}
        onBack={vi.fn()}
      />,
    );

    const updateBtn = screen.getByRole('button', { name: 'Actualizar' });
    expect(updateBtn).toBeTruthy();
    expect(updateBtn.hasAttribute('disabled')).toBe(false);

    expect(screen.getByText('Buscando las notas de la versión…')).toBeTruthy();
  });

  it('el bloque «Perfil de workflows» muestra «Perfil de Workflows Global» sin pulsar nada', () => {
    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={mockStatus}
        onBack={vi.fn()}
      />,
    );

    const profileSection = screen.getByRole('region', { name: /Perfil de workflows/i });
    expect(profileSection).toBeTruthy();
    expect(within(profileSection).getByText('Perfil de Workflows Global')).toBeTruthy();
  });

  it('renderiza el inventario de outputs usando OpenSpecOutputsList en el bloque AGENTES, sin duplicarlo en Detalle técnico', () => {
    const statusWithOutputs: OpenSpecEngineStatus = {
      ...mockStatus,
      installedIntegration: {
        ...mockStatus.installedIntegration!,
        outputInventory: [
          {
            id: 'output-1',
            targetName: 'Cursor Rules',
            kind: 'repo-local',
            displayPath: '.cursor/rules/openspec-*',
            descriptionKey: 'pipeline.openspec.engine.output.cursorRulesDesc',
            blocked: false,
            presenceState: 'present',
          },
        ],
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={statusWithOutputs}
        onBack={vi.fn()}
      />,
    );

    const agentesSection = screen.getByRole('region', { name: /^Agentes$/i });
    expect(agentesSection).toBeTruthy();

    const titles = within(agentesSection).getAllByText(/Outputs Administrables/i);
    expect(titles.length).toBeGreaterThanOrEqual(1);
    expect(titles[0].tagName.toLowerCase()).toBe('h3');

    const codePaths = within(agentesSection).getAllByText('.cursor/rules/openspec-*');
    expect(codePaths.length).toBeGreaterThanOrEqual(1);
    expect(codePaths[0].tagName.toLowerCase()).toBe('code');

    expect(within(agentesSection).getAllByText(/Local del repo/i).length).toBeGreaterThanOrEqual(1);
    expect(within(agentesSection).getAllByText(/Presente/i).length).toBeGreaterThanOrEqual(1);

    // Al abrir Detalle técnico, NO hay lista duplicada de outputs
    const techBtn = screen.getByRole('button', { name: /Detalle técnico/i });
    fireEvent.click(techBtn);

    const allTitles = screen.getAllByText(/Outputs Administrables/i);
    expect(allTitles).toHaveLength(1);
  });

  it('renderiza título del bloque MOTOR con badge y botón de refrescar en la misma fila, sin duplicar Motor OpenSpec', () => {
    const readyStatus: OpenSpecEngineStatus = {
      ...mockStatus,
      cli: {
        ...mockStatus.cli,
        runtimeVersion: '1.14.0',
      },
      repoState: 'initialized',
      integrationState: 'up-to-date',
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={readyStatus}
        onBack={vi.fn()}
      />,
    );

    // 1. Título del bloque "Motor" como h3
    const sectionHeadings = screen.getAllByRole('heading', { level: 3, name: /^motor$/i });
    expect(sectionHeadings.length).toBe(1);

    // 2. NO existe encabezado "Motor OpenSpec" ni "Motor y agentes"
    const duplicateCardTitle = screen.queryByRole('heading', { level: 3, name: /motor openspec/i });
    expect(duplicateCardTitle).toBeNull();

    // 3. Fila del título contiene el badge de estado y el botón de refrescar
    const refreshBtn = screen.getByRole('button', { name: /releer estado/i });
    expect(refreshBtn).toBeTruthy();

    const titleContainer = sectionHeadings[0].closest('header');
    expect(titleContainer).toBeTruthy();
    if (titleContainer) {
      expect(within(titleContainer).getByText(/listo/i)).toBeTruthy();
      expect(within(titleContainer).getByRole('button', { name: /releer estado/i })).toBe(refreshBtn);
    }
  });

  it('el plan anuncia los dos pasos (motor → integración) cuando hay motor nuevo y repo inicializado (8.22 c)', () => {
    const upgradeStatus: OpenSpecEngineStatus = {
      ...mockStatus,
      cli: {
        ...mockStatus.cli!,
        runtimeVersion: '1.13.0',
      },
      latestAvailable: {
        ...mockStatus.latestAvailable!,
        latestVersion: '1.13.1',
      },
      installedIntegration: {
        ...mockStatus.installedIntegration!,
        generatedBy: '1.13.0',
      },
      repoState: 'initialized',
      integrationState: 'up-to-date',
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={upgradeStatus}
        onBack={vi.fn()}
      />,
    );

    // La línea «Va a: …» anuncia los dos pasos antes del clic
    expect(
      screen.getByText('Va a: actualizar el motor en toda la máquina a v1.13.1 · actualizar la integración de este repositorio')
    ).toBeTruthy();

    const updateBtn = screen.getByRole('button', { name: /^Actualizar$/i });
    expect(updateBtn).toBeTruthy();
    expect(updateBtn.hasAttribute('disabled')).toBe(false);
  });

  it('con motor nuevo pero repo no inicializado, el plan sólo anuncia el paso del motor (8.22 c)', () => {
    const uninitUpgradeStatus: OpenSpecEngineStatus = {
      ...mockStatus,
      cli: {
        ...mockStatus.cli!,
        runtimeVersion: '1.13.0',
      },
      latestAvailable: {
        ...mockStatus.latestAvailable!,
        latestVersion: '1.13.1',
      },
      repoState: 'not-initialized',
      integrationState: 'unknown',
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={uninitUpgradeStatus}
        onBack={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/actualizar la integración de este repositorio/i)
    ).toBeNull();
  });

  it('6.1: OdontoPau con copias viejas muestra el motivo real de convivencia legacy sin mencionar POC', () => {
    const odontoPauStatus: OpenSpecEngineStatus = {
      ...mockStatus,
      cli: {
        ...mockStatus.cli!,
        runtimeVersion: '1.13.2',
        provenance: 'local',
        versionClass: 'supported',
      },
      repoState: 'initialized',
      integrationState: 'conflicted',
      installedIntegration: {
        skills: [
          { name: 'openspec-explore', path: 'C:/repo/.codex/skills/openspec-explore', origin: 'legacy-codex', isOfficial: true },
          { name: 'openspec-apply-change', path: 'C:/repo/.agents/skills/openspec-apply-change', origin: 'new-agents', isOfficial: true },
        ],
        generatedBy: '1.5.0',
        markersFound: [],
        outputInventory: [],
        evidenceStatus: 'confirmed',
        tools: ['agents', 'codex'],
        targets: ['agents', 'codex'],
        configuredTools: ['agents', 'codex'],
        presentToolDirectories: ['agents', 'codex'],
        configuredAgentsCount: 2,
        totalPresentAgentsCount: 2,
        conflicts: ['Coexistencia de configuración legacy (.codex/.agent) y nueva (.agents).'],
        installedWorkflowsByTarget: {},
        missing: [],
        legacy: ['codex'],
        customized: [],
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={odontoPauStatus}
        onBack={vi.fn()}
      />,
    );

    // Muestra el motivo real en criollo
    expect(
      screen.getByText(/Conviven copias viejas de las instrucciones con las nuevas/i)
    ).toBeTruthy();
    // No debe contener «POC» en ningún lugar
    expect(screen.queryByText(/POC/i)).toBeNull();
  });

  it('6.1: un estado bloqueado no clasificado muestra el texto de causa no determinada sin texto de POC', () => {
    const unclassifiedStatus: OpenSpecEngineStatus = {
      ...mockStatus,
      cli: {
        ...mockStatus.cli!,
        versionClass: 'supported',
      },
      repoState: 'initialized',
      integrationState: 'conflicted',
      installedIntegration: {
        skills: [],
        generatedBy: '1.14.0',
        markersFound: [],
        outputInventory: [],
        evidenceStatus: 'confirmed',
        tools: [],
        targets: [],
        configuredTools: [],
        presentToolDirectories: [],
        configuredAgentsCount: 0,
        totalPresentAgentsCount: 0,
        conflicts: ['Otro conflicto'],
        installedWorkflowsByTarget: {},
        missing: [],
        legacy: [],
        customized: [],
      },
    };

    render(
      <OpenSpecUpdateReview
        repoPath="C:/repo"
        status={unclassifiedStatus}
        onBack={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/No se pudo determinar la causa de la detención/i)
    ).toBeTruthy();
    expect(screen.queryByText(/POC/i)).toBeNull();
  });
});
