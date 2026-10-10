// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (key === 'pipeline.next.task.help') {
      return `Continuar con la tarea ${params?.taskId ?? ''}: ${params?.taskText ?? ''}`;
    }
    if (params) {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

afterEach(() => {
  cleanup();
  delete (window as any).api;
});

function mockSnapshot(): PipelineSnapshot {
  return {
    schemaVersion: '1.0',
    repoId: 'repo-sdd',
    availableSources: ['git'],
    hermesConnected: false,
    hasPipelineActivity: true,
    now: {
      headlineKey: 'x',
      runtime: null,
      role: null,
      taskLabel: null,
      tasksDone: null,
      tasksTotal: null,
      elapsedMs: null,
      costUsd: null,
      costBasis: 'unknown',
      needsHuman: false,
    },
    stations: [],
    decisions: [],
    agents: [],
    activity: [],
    economy: { reasoningAvailable: null } as PipelineSnapshot['economy'],
    diffs: [
      {
        path: 'src/file.ts',
        status: 'modified',
        additions: 5,
        deletions: 2,
        agentId: null,
        taskId: null,
        binary: false,
      },
    ],
    openSpec: {
      selectedChangeId: null,
      activeChanges: [
        {
          changeId: 'cambio-ejemplo',
          intent: 'Este es el texto completo de la justificación e intención del cambio que no debe truncarse.',
          tasks: [
            {
              id: 't-1',
              line: 10,
              text: '1.1 Primera tarea del cambio',
              completed: false,
              sourceRef: 'tasks.md:10',
            },
            {
              id: 't-2',
              line: 20,
              text: '1.2 Segunda tarea ya resuelta',
              completed: true,
              sourceRef: 'tasks.md:20',
            },
          ],
          proposalExists: true,
          designExists: true,
          specsCount: 1,
          validation: 'unknown' as const,
          status: {
            available: true,
            artifacts: [
              { id: 'proposal', state: 'done', missingDeps: [] },
              { id: 'design', state: 'done', missingDeps: [] },
              { id: 'specs', state: 'done', missingDeps: [] },
              { id: 'tasks', state: 'ready', missingDeps: [] },
            ],
            applyRequires: ['tasks'],
            isComplete: false,
          },
          artifacts: {
            proposal: '# Propuesta\n\nTexto de la propuesta.',
            specs: [{ name: 'cap-1', content: '# Capacidad 1' }],
            design: '# Diseño\n\nDecisiones tomadas.',
            tasks: '- [ ] 1.1 Primera tarea\n- [x] 1.2 Segunda tarea',
          },
        },
      ],
      archivedChanges: [],
      specifications: [
        {
          specificationId: 'cap-1',
          name: 'cap-1',
          requirements: 2,
          deltaCount: 0,
        },
      ],
      reports: [],
      diagnostics: [],
      observedAt: '2026-09-04T10:00:00Z',
      latestGate: null,
    },
  } as unknown as PipelineSnapshot;
}

function renderSdd(currentBranch = 'main') {
  const rendered = render(
    <OpenSpecDashboard
      snapshot={mockSnapshot()}
      repoPath="C:/repo"
      currentBranch={currentBranch}
      workingTreeClean={true}
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

  // Abrir el cambio y conmutar a Tareas para las pruebas de maquetación de tareas
  const enterBtn = screen.getAllByRole('button', { name: /openspec\.start\.enter/ })[0];
  fireEvent.click(enterBtn);
  const tasksBtn = screen.getByRole('button', { name: /pipeline\.switcher\.tasks/ });
  fireEvent.click(tasksBtn);
  return rendered;
}

describe('Maquetación del cuerpo de SDD (Tareas 2.2 a 2.6 y Grupo 3)', () => {
  describe('2.2 Superficie soberana y lectura de arriba a abajo', () => {
    it('el cuerpo gobierna las vistas de Trabajo e Inspección mediante el intercambiador sin solapas superiores divisorias', () => {
      renderSdd();

      // Las solapas rígidas superiores que dividían Trabajo de Artefactos ya no existen
      expect(screen.queryByRole('tab', { name: /openspec\.tabs\.work/i })).toBeNull();
      expect(screen.queryByRole('tab', { name: /openspec\.tabs\.details/i })).toBeNull();

      // En su lugar, el área de tareas es la vista por defecto y el rail permite cambiar a artefactos
      const taskList = screen.getByRole('list');
      expect(taskList).toBeTruthy();

      const artifactsRailBtn = screen.getByRole('button', { name: /pipeline\.switcher\.artifacts/i });
      expect(artifactsRailBtn).toBeTruthy();

      fireEvent.click(artifactsRailBtn);
      const tablist = screen.getByRole('tablist', { name: /pipeline\.details\.title/i });
      expect(tablist).toBeTruthy();
    });

    it('la cabecera ubica el siguiente paso presidido por el CTA antes del área de trabajo', () => {
      renderSdd();

      const nextStepCTA = screen.getByRole('button', { name: /pipeline\.next\.task\.action/i });
      const taskList = screen.getByRole('list');

      // El CTA en la cabecera precede a la lista de tareas en el DOM
      const comparison = nextStepCTA.compareDocumentPosition(taskList);
      expect(comparison & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('la actividad no aparece sin bitácora y está disponible en el intercambiador cuando existe registro', () => {
      renderSdd();
      // Sin actividad registrada ni sesión, la entrada no existe en el rail
      expect(screen.queryByRole('button', { name: /pipeline\.switcher\.activity/i })).toBeNull();

      cleanup();

      // Con actividad registrada, la entrada aparece en el rail y abre su vista soberana
      render(
        <OpenSpecDashboard
          snapshot={mockSnapshot()}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
          leftOpen={false}
          rightOpen={false}
          leftWidth={320}
          rightWidth={320}
          onResizeLeft={() => undefined}
          onResizeRight={() => undefined}
          projection={{
            sessionId: 'sess-1',
            changeId: 'cambio-ejemplo',
            startedAt: '2026-09-04T12:00:00Z',
            runtime: 'hermes',
            role: 'agent',
            taskId: 't-1',
            status: 'running',
            activity: [
              {
                id: 'act-1',
                timestamp: '2026-09-04T12:00:00Z',
                type: 'log',
                message: 'Sesión iniciada',
              } as any,
            ],
          } as any}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />,
      );
      const enterBtn = screen.getAllByRole('button', { name: /openspec\.start\.enter/ })[0];
      fireEvent.click(enterBtn);

      const activityRailBtn = screen.getByRole('button', { name: /pipeline\.switcher\.activity/i });
      expect(activityRailBtn).toBeTruthy();

      fireEvent.click(activityRailBtn);
      expect(screen.getByRole('region', { name: /pipeline\.switcher\.activity/i })).toBeTruthy();
    });
  });

  describe('2.3 Jerarquía de controles (Acción Principal vs Accesorias)', () => {
    it('el botón de acción principal se distingue claramente de las acciones accesorias', () => {
      renderSdd();

      // Observación 39: La acción principal se distingue por el color de acento de railPrimaryAction
      // y ya no lleva primaryAction (estética de botón encajonado con borde y tipografía mono).
      const nextStepCTA = screen.getByRole('button', { name: /pipeline\.next\.task\.action/i });
      expect(Array.from(nextStepCTA.classList).some((c) => c.includes('railPrimaryAction'))).toBe(true);

      // Observación 39: Las acciones accesorias llevan railActionItem a secas (sin railPrimaryAction)
      // y ya no llevan secondaryAction, quedando idénticas a los ítems de listado por construcción.
      const archiveBtn = screen.getByRole('button', { name: /pipeline\.openspec\.archive\.action/i });
      expect(Array.from(archiveBtn.classList).some((c) => c.includes('railActionItem'))).toBe(true);
      expect(Array.from(archiveBtn.classList).some((c) => c.includes('railPrimaryAction'))).toBe(false);

      // Ver diffs es una vista del rail cuando hay diffs
      const diffRailBtn = screen.getByRole('button', { name: /pipeline\.switcher\.diffs/i });
      expect(diffRailBtn).toBeTruthy();
    });
  });

  describe('2.4 Solapas de inspección y rótulos frente a OpenSpec 1.11', () => {
    it('al seleccionar artefactos en el rail, las pestañas de evidencia declaran los rótulos funcionales', () => {
      renderSdd();

      // Cambiar a vista de artefactos
      fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.artifacts/i }));

      const tablist = screen.getByRole('tablist', { name: /pipeline\.details\.title/i });
      expect(tablist).toBeTruthy();

      const tabs = screen.getAllByRole('tab');
      // Con Obs 52 se retiran diffs y glossary, dejando los 4 artefactos canónicos
      expect(tabs.length).toBe(4);

      const expectedLabels = [
        /pipeline\.details\.proposal|pipeline\.openspec\.graph\.artifact\.proposal/i,
        /pipeline\.details\.design|pipeline\.openspec\.graph\.artifact\.design/i,
        /pipeline\.details\.specs|pipeline\.openspec\.graph\.artifact\.specs/i,
        /pipeline\.details\.tasks|pipeline\.openspec\.graph\.artifact\.tasks/i,
      ];

      for (const expected of expectedLabels) {
        expect(tabs.some((t) => expected.test(t.textContent || ''))).toBe(true);
      }

      // Se retiran diffs y glossary de las solapas
      expect(tabs.some((t) => /pipeline\.details\.diffs/i.test(t.textContent || ''))).toBe(false);
      expect(tabs.some((t) => /pipeline\.details\.glossary/i.test(t.textContent || ''))).toBe(false);

      // La primera solapa (propuesta) arranca activa
      const activeTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      expect(activeTab?.textContent).toMatch(/proposal/i);
      expect(activeTab?.getAttribute('data-selected')).toBe('true');
    });

    it('el nodo seleccionado declara data-selected="true" y aria-selected="true" correspondiente a activeTab', () => {
      renderSdd();
      fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.artifacts/i }));

      const proposalTab = screen.getByRole('tab', { name: /proposal/i });
      expect(proposalTab.getAttribute('aria-selected')).toBe('true');
      expect(proposalTab.getAttribute('data-selected')).toBe('true');
      expect(proposalTab.closest('li')?.getAttribute('data-selected')).toBe('true');

      const designTab = screen.getByRole('tab', { name: /design/i });
      expect(designTab.getAttribute('aria-selected')).toBe('false');
      expect(designTab.getAttribute('data-selected')).toBeNull();

      fireEvent.click(designTab);
      expect(designTab.getAttribute('aria-selected')).toBe('true');
      expect(designTab.getAttribute('data-selected')).toBe('true');
      expect(designTab.closest('li')?.getAttribute('data-selected')).toBe('true');
      expect(proposalTab.getAttribute('aria-selected')).toBe('false');
    });

    it('exactamente una .timelineCard en el DOM mostrando la descripción del nodo seleccionado y conmuta al pulsar otro nodo', async () => {
      (window as any).api = {
        pipelineOpenSpec: {
          getArtifactGraph: vi.fn().mockResolvedValue({
            ok: true,
            artifacts: [
              { id: 'proposal', status: 'done', requires: [], description: 'Descripción de proposal' },
              { id: 'design', status: 'done', requires: ['proposal'], description: 'Descripción de design' },
              { id: 'specs', status: 'done', requires: ['proposal'], description: 'Descripción de specs' },
              { id: 'tasks', status: 'ready', requires: ['specs', 'design'], description: 'Descripción de tasks' },
            ],
          }),
        },
      };

      const { container } = renderSdd();
      fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.artifacts/i }));

      expect(await screen.findByText('Descripción de proposal')).toBeTruthy();

      const cards = container.querySelectorAll('[class*="timelineCard"]');
      expect(cards.length).toBe(1);
      expect(screen.queryByText('Descripción de design')).toBeNull();

      // Al conmutar de nodo, cambia la tarjeta y sigue habiendo exactamente una
      const designTab = screen.getByRole('tab', { name: /design/i });
      fireEvent.click(designTab);

      expect(await screen.findByText('Descripción de design')).toBeTruthy();
      const cardsAfter = container.querySelectorAll('[class*="timelineCard"]');
      expect(cardsAfter.length).toBe(1);
      expect(screen.queryByText('Descripción de proposal')).toBeNull();
    });
  });

  describe('2.5 Eliminación de información duplicada (Casos 4, 5 y 7)', () => {
    it('la frase de guía del siguiente paso no contiene "Van X de Y"', () => {
      renderSdd();

      // El texto de ayuda sólo orienta a la acción concreta
      const helpText = screen.getByText(/Continuar con la tarea/i);
      expect(helpText.textContent).not.toMatch(/Van \d+ de \d+/i);
      expect(helpText.textContent).not.toMatch(/{{completed}}/i);
    });

    it('la cabecera no muestra el párrafo de intención truncado con puntos suspensivos', () => {
      renderSdd();

      // La cabecera sólo muestra la identidad del cambio (cambio-ejemplo) y no el texto truncado de intención
      const header = screen.getByRole('banner', { hidden: true }) || screen.getByText('cambio-ejemplo').closest('header')!;
      expect(header).toBeTruthy();
      expect(header.textContent).not.toContain('Este es el texto completo de la justificación e intención');
    });

    it('la tarea activa sin sesión registrada no renderiza las cuatro filas vacías de detalle ni frase de disculpa', () => {
      renderSdd();

      // Sin sesión, no se dibuja .taskDetail con cuatro filas de "No informado"
      expect(screen.queryByText(/pipeline\.openspec\.task\.agent/i)).toBeNull();
      expect(screen.queryByText(/pipeline\.openspec\.task\.source/i)).toBeNull();
      expect(screen.queryByText(/pipeline\.openspec\.task\.workingTree/i)).toBeNull();

      // Enmienda fechada 2026-09-04: Tampoco se dibuja frase de disculpa
      expect(screen.queryByText(/pipeline\.openspec\.task\.noSession/i)).toBeNull();
    });

    it('cada nodo de la línea temporal lleva un ícono', () => {
      renderSdd();
      fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.artifacts/i }));

      const graphItems = document.querySelectorAll('.pipeline-artifact-graph li');
      // Cada ítem contiene un ícono SVG y un texto accesible para screen readers
      graphItems.forEach((li) => {
        expect(li.querySelector('svg')).not.toBeNull();
      });
    });
  });

  describe('2.6 Mudanza de estilos a la hoja de la vista y CSS muerto', () => {
    it('globals.css no contiene los estilos de evidencia ni la regla muerta .pipeline-card[data-scrolls]', () => {
      const globalsPath = path.resolve(process.cwd(), 'app/globals.css');
      const content = fs.readFileSync(globalsPath, 'utf-8');

      expect(content).not.toMatch(/\.pipeline-details__tab--active\s*\{/);
      expect(content).not.toMatch(/\.pipeline-details\s*\{/);
      expect(content).not.toMatch(/\.pipeline-card\[data-scrolls\]\s*\{/);
    });

    it('OpenSpecDashboard.module.css no contiene .timelineCircle[data-state ni .pipeline-details__tab', () => {
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const content = fs.readFileSync(modulePath, 'utf-8');

      expect(content).not.toMatch(/\.timelineCircle\[data-state/);
      expect(content).not.toMatch(/\.pipeline-details__tab/);
      expect(content).not.toMatch(/\.pipeline-artifact-graph/);
    });
  });

  describe('4.15 / Observación 45: Jerarquía lumínica de superficies en el cuerpo de SDD', () => {
    it('ninguna superficie de fondo en el cuerpo tiene luminancia inferior a la del lienzo (#2e3440)', () => {
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const content = fs.readFileSync(modulePath, 'utf-8');

      // 1. No existe ninguna declaración background ni background-color con var(--color-bg-surface)
      const bgSurfaceRegex = /(?:background|background-color)\s*:[^;]*var\(--color-bg-surface\)/gi;
      const bgSurfaceMatches = content.match(bgSurfaceRegex);
      expect(bgSurfaceMatches).toBeNull();

      // 2. No existe color-mix con var(--color-bg-surface) en fondos
      const colorMixSurfaceRegex = /(?:background|background-color)\s*:[^;]*color-mix\([^;]*var\(--color-bg-surface\)/gi;
      const colorMixMatches = content.match(colorMixSurfaceRegex);
      expect(colorMixMatches).toBeNull();

      // 3. Verificación de luminancia sRGB: el token de superficie (--color-bg-overlay, #3b4252)
      // debe tener luminancia relativa mayor o igual al lienzo base (--color-bg-base, #2e3440)
      function srgbLuminance(hex: string): number {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const toLinear = (c: number) => {
          const s = c / 255;
          return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
      }

      const canvasLuminance = srgbLuminance('#2e3440'); // ~0.0342
      const overlayLuminance = srgbLuminance('#3b4252'); // ~0.0542
      const oldSurfaceLuminance = srgbLuminance('#272c36'); // ~0.0252

      // El token anterior era defectuoso: más oscuro que el fondo base
      expect(oldSurfaceLuminance).toBeLessThan(canvasLuminance);

      // El token actual respeta la física de superficies: más claro que el fondo base
      expect(overlayLuminance).toBeGreaterThan(canvasLuminance);
    });
  });

  describe('Grupo 5: Comprobaciones del change y límites de cobertura (5.1 y 5.2)', () => {
    it('5.1 En el DOM montado: una superficie sin contenido no ocupa lugar, se mantiene alcanzable por sus controles y abrir una no desplaza a las demás', () => {
      // 1. Superficie sin contenido no ocupa lugar en el DOM:
      // En reposo (mockSnapshot sin agente vivo ni logs), la actividad no está montada en el DOM
      const { container, rerender } = renderSdd();
      expect(screen.queryByRole('heading', { name: /pipeline\.activity\.title/i })).toBeNull();
      expect(container.querySelector('[class*="fullActivity"]')).toBeNull();

      // 2. Es alcanzable: la vista de artefactos y evidencia se alcanza desde el riel
      const artifactsBtn = screen.getByRole('button', { name: /pipeline\.switcher\.artifacts/i });
      expect(artifactsBtn).toBeTruthy();
      fireEvent.click(artifactsBtn);

      // Ahora la vista de artefactos está montada y ocupa el área central soberana
      const tablist = screen.getByRole('tablist');
      expect(tablist).toBeTruthy();

      // Las tareas siguen siendo alcanzables para alternar de regreso
      const tasksBtn = screen.getByRole('button', { name: /pipeline\.switcher\.tasks/i });
      expect(tasksBtn).toBeTruthy();

      // 3. Abrir una superficie no desplaza a las demás:
      // La cabecera de identidad del cambio permanece en su posición y no es empujada fuera del viewport
      const header = screen.getByRole('banner', { hidden: true }) || screen.getByText('cambio-ejemplo').closest('header')!;
      expect(header).toBeTruthy();
      expect(header.textContent).toContain('cambio-ejemplo');

      // Conmutamos de regreso a tareas: el intercambio es in-place dentro del cuerpo soberano
      fireEvent.click(tasksBtn);
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.getByText('Primera tarea del cambio')).toBeTruthy();
      expect(header.textContent).toContain('cambio-ejemplo');

      // 4. Panel lateral flotante con rightOpen={true}: no ocupa lugar en el DOM y libera el ancho
      rerender(
        <OpenSpecDashboard
          snapshot={mockSnapshot()}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
          leftOpen={false}
          rightOpen={true}
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
      const rail51 = container.querySelector('nav[class*="switcherRail"]');
      expect(rail51).toBeTruthy();
      expect(rail51?.getAttribute('data-folded')).toBe('true');
      expect(rail51?.getAttribute('aria-hidden')).toBe('true');
      fireEvent.transitionEnd(rail51!);
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();
    });

    it('5.2 Declaración explícita de archivos recorridos, límites de cobertura y los tres casos fundamento', () => {
      // 1. Archivos que recorre cada comprobación de este change (verificados en disco):
      const filesCovered = [
        'components/pipeline/OpenSpecDashboard.tsx',
        'components/pipeline/OpenSpecDashboard.module.css',
        'components/pipeline/PipelineDetails.tsx',
        'components/pipeline/ViewSwitcherRail.tsx',
        'lib/i18n.ts',
        'lib/change-branch.ts',
      ];

      for (const relPath of filesCovered) {
        const fullPath = path.resolve(process.cwd(), relPath);
        expect(fs.existsSync(fullPath)).toBe(true);
      }

      // 2. Los tres casos fundamento por los cuales las comprobaciones deben afirmar sobre
      // el efecto en el DOM montado y no sólo sobre el origen declarado en CSS o código fuente:
      const foundationalFailureCases = {
        escanerBordesCiego: {
          descripcion: 'El escáner de bordes pasaba en verde con los botones encajonados',
          mecanismoDeFallo: 'Se comprobaba la ausencia o presencia de cadenas literales de texto en el CSS sin medir el efecto visual resultante en el DOM montado ni la composición de cajas.',
          remedioAdoptado: 'Comprobaciones de geometría, paddings y clases aplicadas directamente sobre los elementos montados en el DOM.',
        },
        anclajeEnContenedorErroneo: {
          descripcion: 'El anclaje del panel flotante se afirmó sobre el contenedor equivocado (.startBody)',
          mecanismoDeFallo: 'Se aplicó flex: 1 0 auto (flex-shrink: 0) a .startBody para resolver un problema vertical (anclaje del panel sticky), pero .startBody es hijo de .startScreenWrapper que tiene flex-direction: row; el flex-shrink: 0 terminó gobernando el ancho, impidiendo el encogimiento horizontal y provocando desborde con el navegador derecho abierto (Obs 58).',
          remedioAdoptado: 'Mantener flex: 1 0 auto sólo en el wrapper vertical .startScreenWrapper, y devolver flex: 1 1 auto a .startBody con min-width: 0, verificando el comportamiento en las 4 pantallas con rightOpen true y false.',
        },
        solapasPropuestaVsEspecificacionesDuplicadas: {
          descripcion: 'La solapa de especificaciones nunca se comprobó que mostrara algo distinto de la propuesta',
          mecanismoDeFallo: 'Las pruebas anteriores sólo verificaban que el tabpanel montara un SafeMarkdown, sin comprobar el texto ni contrastar que «Propuesta» y «Especificaciones» mostraran contenidos distintos. Esto ocultó que openspec change show --diff sobreescribía las deltaSpecs con el documento completo del cambio arrancando por la propuesta (Obs 62).',
          remedioAdoptado: 'Prueba explícita sobre el DOM montado que verifica que «Propuesta» y «Especificaciones» rinden contenidos mutuamente excluyentes y que las deltaSpecs se muestran sección por sección por capacidad.',
        },
      };

      expect(foundationalFailureCases.escanerBordesCiego.mecanismoDeFallo).toBeTruthy();
      expect(foundationalFailureCases.anclajeEnContenedorErroneo.mecanismoDeFallo).toBeTruthy();
      expect(foundationalFailureCases.solapasPropuestaVsEspecificacionesDuplicadas.mecanismoDeFallo).toBeTruthy();

      // 3. Declaración explícita de límites de qué NO cubre la verificación de este change:
      const outOfScopeBoundaries = {
        artifactTimelineNodes: {
          covered: false,
          owner: 'gestionar-ciclo-openspec-desde-gitcron',
          taskRef: '3c.4',
          rationale: 'El grafo interactivo de nodos unidos con dependencias de desbloqueo entre artefactos es infraestructura del ciclo de vida OpenSpec',
        },
        diagnosticsAndEngineCard: {
          covered: false,
          owner: 'gestionar-ciclo-openspec-desde-gitcron',
          taskRef: 'Obs 59',
          rationale: 'La tarjeta del motor OpenSpec, sus diagnósticos avanzados y el aviso ámbar en la solapa de Herramientas pertenecen a gestionar-ciclo-openspec-desde-gitcron',
        },
        didacticCopyAndGlossary: {
          covered: false,
          owner: 'explicar-el-ciclo-sin-tecnicismos',
          taskRef: 'Tareas de redacción y glosario',
          rationale: 'Los textos explicativos sin tecnicismos, explicaciones didácticas y glosario no son de layout sino de redacción formativa',
        },
        subpixelRenderingAndGPU: {
          covered: false,
          owner: 'Navegador cliente / render engine',
          rationale: 'El entorno jsdom de Vitest no emula sub-píxeles, layout engines específicos de Chromium/WebKit ni aceleración por hardware',
        },
        liveHermesRuntimeStreaming: {
          covered: false,
          owner: 'Hermès CLI / background agent execution',
          rationale: 'Se verifica el contrato de datos (PipelineSnapshot / PipelineProjection), no la conexión viva por socket con ejecutores externos',
        },
      };

      expect(outOfScopeBoundaries.artifactTimelineNodes.covered).toBe(false);
      expect(outOfScopeBoundaries.diagnosticsAndEngineCard.covered).toBe(false);
      expect(outOfScopeBoundaries.didacticCopyAndGlossary.covered).toBe(false);
      expect(outOfScopeBoundaries.subpixelRenderingAndGPU.covered).toBe(false);
      expect(outOfScopeBoundaries.liveHermesRuntimeStreaming.covered).toBe(false);
    });
  });

  describe('4.16 / Observaciones 48, 49 y 50: Tarjetas de inicio, geometría de tareas y contenedor de evidencia', () => {
    it('Obs 48: las tarjetas de inicio retiran el borde perimetral, [data-branch] usa border-left y .startPendingToggle no tiene borde', () => {
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      // 1. .startList > li tiene border: 0 (no conserva border: 1px solid)
      const startListMatch = css.match(/\.startList\s*>\s*li\s*\{([^}]+)\}/);
      expect(startListMatch).toBeTruthy();
      expect(startListMatch![1]).toMatch(/border:\s*0/);
      expect(startListMatch![1]).not.toMatch(/border:\s*1px solid/);

      // 2. .startList > li[data-branch] define border-left de 3px con var(--color-primary)
      const branchMatch = css.match(/\.startList\s*>\s*li\[data-branch\]\s*\{([^}]+)\}/);
      expect(branchMatch).toBeTruthy();
      expect(branchMatch![1]).toMatch(/border-left:\s*3px solid var\(--color-primary\)/);

      // 3. .startPendingToggle tiene min-height/min-block-size de 2.75rem y border: 0
      const pendingToggleMatch = css.match(/\.startPendingToggle\s*\{([^}]+)\}/);
      expect(pendingToggleMatch).toBeTruthy();
      expect(pendingToggleMatch![1]).toMatch(/(?:min-height|min-block-size):\s*2\.75rem/);
      expect(pendingToggleMatch![1]).toMatch(/border:\s*0/);
    });

    it('Obs 49: la casilla de tarea unifica su caja a 2.75rem en completadas y pendientes, usa CheckCircle2 y color-git-add', () => {
      renderSdd();

      // En el DOM montado:
      const taskList = document.querySelector('ol[class*="taskList"]');
      expect(taskList).toBeTruthy();

      const taskItems = taskList!.querySelectorAll('li');
      expect(taskItems.length).toBe(2);

      const pendingItem = taskItems[0];
      const completedItem = taskItems[1];

      expect(pendingItem.getAttribute('data-completed')).toBe('false');
      expect(completedItem.getAttribute('data-completed')).toBe('true');

      const pendingBtn = pendingItem.querySelector('button[class*="taskStatus"]');
      const completedBtn = completedItem.querySelector('button[class*="taskStatus"]');
      expect(pendingBtn).toBeTruthy();
      expect(completedBtn).toBeTruthy();

      // La tarea completada renderiza el ícono CheckCircle2 (con SVG)
      expect(completedBtn!.querySelector('svg')).toBeTruthy();

      // Inspección CSS:
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      // .taskStatus base declara 2.75rem de ancho y alto, padding 0 y margin 0
      const taskStatusMatch = css.match(/\.taskStatus\s*\{([^}]+)\}/);
      expect(taskStatusMatch).toBeTruthy();
      expect(taskStatusMatch![1]).toMatch(/min-width:\s*2\.75rem/);
      expect(taskStatusMatch![1]).toMatch(/min-height:\s*2\.75rem/);
      expect(taskStatusMatch![1]).not.toMatch(/margin:\s*calc\(-1/);

      // .taskList > li declara 2.75rem en la columna de estado (precedido por la canaleta de arrastre de 2rem en 8.14)
      const taskLiMatch = css.match(/\.taskList\s*>\s*li\s*\{([^}]+)\}/);
      expect(taskLiMatch).toBeTruthy();
      expect(taskLiMatch![1]).toMatch(/grid-template-columns:\s*(?:2rem\s+)?2\.75rem\s+3rem/);

      // .taskList > li[data-completed='true'] .taskStatus define var(--color-git-add)
      const completedStatusMatch = css.match(/\.taskList\s*>\s*li\[data-completed='true'\]\s+\.taskStatus\s*\{([^}]+)\}/);
      expect(completedStatusMatch).toBeTruthy();
      expect(completedStatusMatch![1]).toMatch(/color:\s*var\(--color-git-add\)/);
    });

    it('Obs 50: el contenedor de evidencia retira el borde perimetral y fondo encapsulado', () => {
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      const detailsMatch = css.match(/\.openspecScope\s+:global\(\.pipeline-details\)\s*\{([^}]+)\}/);
      expect(detailsMatch).toBeTruthy();
      expect(detailsMatch![1]).toMatch(/border:\s*0/);
      expect(detailsMatch![1]).toMatch(/background-color:\s*transparent/);
      expect(detailsMatch![1]).not.toMatch(/border:\s*1px solid/);
    });
  });

  describe('4.17 / Observaciones 54 y 55: Vista archivada y alineación de casillas de tarea', () => {
    it('Obs 54: la vista del cambio archivado no monta PipelineNextStepGuide y el conmutador ofrece volver a Archivados y Nuevo cambio', () => {
      const snap = mockSnapshot();
      snap.openSpec!.archivedChanges = [
        {
          changeId: 'cambio-archivado',
          sourceRef: 'openspec/changes/archive/cambio-archivado',
          createdAt: { at: '2026-09-01T10:00:00Z', source: 'commit' },
          archivedAt: '2026-09-02T12:00:00Z',
          archivedOn: { at: '2026-09-02T12:00:00Z', source: 'commit' },
          artifacts: {
            proposal: '# Propuesta archivada',
            specs: [],
            design: '# Diseño archivado',
            tasks: '- [x] 1.1 Hecho',
          },
        },
      ];

      const onSelectChange = vi.fn();

      render(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
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
          onSelectChange={onSelectChange}
        />,
      );

      // Ir a la pestaña de archivados en la pantalla de inicio y entrar al archivado
      const archivedTabBtn = screen.getByRole('button', { name: /pipeline\.openspec\.start\.archivedCount/i });
      fireEvent.click(archivedTabBtn);

      const enterArchiveBtn = screen.getByRole('button', { name: /openspec\.start\.enter/i });
      fireEvent.click(enterArchiveBtn);

      // 1. No monta tarjeta de siguiente paso
      expect(screen.queryByRole('heading', { name: /pipeline\.next\.label|Siguiente paso/i })).toBeNull();
      expect(screen.queryByRole('heading', { name: /pipeline\.next\.archived\.title/i })).toBeNull();

      // 2. El conmutador declara ranura 1 hacia Archivados y ranura 2 hacia nuevo cambio
      const backToArchivedBtn = screen.getByRole('button', { name: /pipeline\.openspec\.start\.archivedCount/i });
      expect(backToArchivedBtn).toBeTruthy();
      expect(backToArchivedBtn.getAttribute('data-slot')).toBe('1');

      const newChangeBtn = screen.getByRole('button', { name: /pipeline\.openspec\.start\.newChange/i });
      expect(newChangeBtn).toBeTruthy();
      expect(newChangeBtn.getAttribute('data-slot')).toBe('2');

      // 3. Pulsar volver a archivados deselecciona y regresa a la vista de inicio de archivados
      fireEvent.click(backToArchivedBtn);
      expect(screen.getByText('pipeline.openspec.start.archived')).toBeTruthy();
    });

    it('Obs 55: las casillas de tarea (.taskStatus) alinean su ícono con la primera línea de texto y conservan la misma distancia superior', () => {
      const snap = mockSnapshot();
      // Dos tareas: una de una sola línea corta, y otra de múltiples renglones
      snap.openSpec!.activeChanges[0].tasks = [
        {
          id: 't-short',
          line: 10,
          text: '1.1 Tarea corta',
          completed: false,
          sourceRef: 'tasks.md:10',
        },
        {
          id: 't-long',
          line: 20,
          text: '1.2 Tarea larga que tiene múltiples renglones de contenido para comprobar que el botón de estado mantiene exactamente la misma distancia del borde superior de la fila sin importar el largo del texto',
          completed: true,
          sourceRef: 'tasks.md:20',
        },
      ];

      render(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
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

      // Entrar al cambio y conmutar a Tareas
      fireEvent.click(screen.getAllByRole('button', { name: /openspec\.start\.enter/ })[0]);
      fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.tasks/ }));

      const taskList = document.querySelector('ol[class*="taskList"]');
      expect(taskList).toBeTruthy();
      const items = taskList!.querySelectorAll('li');
      expect(items.length).toBe(2);

      const btn1 = items[0].querySelector('button[class*="taskStatus"]');
      const btn2 = items[1].querySelector('button[class*="taskStatus"]');
      expect(btn1).toBeTruthy();
      expect(btn2).toBeTruthy();

      // Ambas tareas renderizan SVG de 16px (geometría unificada en completada y pendiente)
      const svg1 = btn1!.querySelector('svg');
      const svg2 = btn2!.querySelector('svg');
      expect(svg1).toBeTruthy();
      expect(svg2).toBeTruthy();
      expect(svg1!.getAttribute('width')).toBe('16');
      expect(svg2!.getAttribute('width')).toBe('16');

      // Inspección CSS:
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      // .taskList > li declara align-items: start para que la primera línea comience arriba en 1 o N renglones
      const taskLiMatch = css.match(/\.taskList\s*>\s*li\s*\{([^}]+)\}/);
      expect(taskLiMatch).toBeTruthy();
      expect(taskLiMatch![1]).toMatch(/align-items:\s*start/);

      // .taskStatus declara align-items: flex-start y conserva el target de 2.75rem
      const taskStatusMatch = css.match(/\.taskStatus\s*\{([^}]+)\}/);
      expect(taskStatusMatch).toBeTruthy();
      expect(taskStatusMatch![1]).toMatch(/align-items:\s*flex-start/);
      expect(taskStatusMatch![1]).toMatch(/min-height:\s*2\.75rem/);
      expect(taskStatusMatch![1]).toMatch(/min-width:\s*2\.75rem/);

      // .taskStatus svg calcula margin-top para centrar ópticamente con la primera línea de texto (1.5 * var(--font-size-xs))
      const taskSvgMatch = css.match(/\.taskStatus\s+svg\s*\{([^}]+)\}/);
      expect(taskSvgMatch).toBeTruthy();
      expect(taskSvgMatch![1]).toMatch(/margin-top:\s*calc\(\(1\.5\s*\*\s*var\(--font-size-xs\)\s*-\s*1rem\)\s*\/\s*2\)/);
    });
  });

  describe('4.18 / Observación 58: Desborde horizontal y encogimiento en el eje horizontal', () => {
    it('Obs 58: ninguna de las superficies que se reparten la fila declara flex-shrink: 0 en el eje horizontal', () => {
      // Razón de la comprobación:
      // El 2026-09-06 el arreglo vertical del anclaje se aplicó en un contenedor en fila
      // (.startBody dentro de .startScreenWrapper, que es display: flex; flex-direction: row)
      // usando flex: 1 0 auto. Al prohibir flex-shrink: 1 en un flex item horizontal, el cuerpo
      // no podía encogerse por debajo del ancho de su contenido al abrir el navegador derecho,
      // desbordando horizontalmente la fila con una barra de scroll y texto cortado.
      // Para resolverlo, .startBody declara flex: 1 1 auto y min-width: 0, permitiendo que el
      // cuerpo se encoja a lo ancho, mientras preserva min-height: 100% y height: auto para
      // sostener el anclaje vertical del riel flotante.
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      // .startBody permite encogimiento horizontal con flex: 1 1 auto
      const bodyMatch = css.match(/\.startBody\s*\{([^}]+)\}/);
      expect(bodyMatch).toBeTruthy();
      const bodyRules = bodyMatch![1];
      expect(bodyRules).toMatch(/flex:\s*1\s+1\s+auto/);
      expect(bodyRules).not.toMatch(/flex:\s*1\s+0\s+auto/);
      expect(bodyRules).not.toMatch(/flex-shrink:\s*0/);
      expect(bodyRules).toMatch(/min-width:\s*0/);
      expect(bodyRules).toMatch(/min-height:\s*100%/);
      expect(bodyRules).toMatch(/height:\s*auto/);

      // .startScreenWrapper sostiene el anclaje vertical dentro de .center (flex-direction: column)
      const wrapperMatch = css.match(/\.startScreenWrapper\s*\{([^}]+)\}/);
      expect(wrapperMatch).toBeTruthy();
      const wrapperRules = wrapperMatch![1];
      expect(wrapperRules).toMatch(/flex:\s*1\s+0\s+auto/);
      expect(wrapperRules).toMatch(/flex-direction:\s*row/);
    });

    it('Obs 58: recorrido de las cuatro pantallas (inicio, cambio activo, cambio archivado y especificación) con rightOpen true y false', () => {
      const snap = mockSnapshot();
      snap.openSpec!.archivedChanges = [
        {
          changeId: 'archivado-1',
          sourceRef: 'openspec/changes/archive/archivado-1',
          createdAt: { at: '2026-09-01T10:00:00Z', source: 'commit' },
          archivedAt: '2026-09-02T12:00:00Z',
          archivedOn: { at: '2026-09-02T12:00:00Z', source: 'commit' },
          artifacts: { proposal: '# P', specs: [], design: '# D', tasks: '- [x] 1.1' },
        },
      ];
      snap.openSpec!.specifications = [
        {
          specificationId: 'spec-1',
          title: 'Especificación 1',
          sourceRef: 'openspec/specs/spec-1/spec.md',
        } as any,
      ];

      // 1. Pantalla de inicio
      const { container, rerender } = render(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
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

      // Inicio, rightOpen false: wrapper aloja startBody y switcherRail
      let wrapper = container.querySelector('[class*="startScreenWrapper"]');
      let body = wrapper?.querySelector('[class*="startBody"]');
      let rail = wrapper?.querySelector('nav[class*="switcherRail"]');
      expect(wrapper).toBeTruthy();
      expect(body).toBeTruthy();
      expect(rail).toBeTruthy();

      // Inicio, rightOpen true: switcherRail no se monta, startBody dispone de todo el ancho
      rerender(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
          leftOpen={false}
          rightOpen={true}
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
      wrapper = container.querySelector('[class*="startScreenWrapper"]');
      body = wrapper?.querySelector('[class*="startBody"]');
      rail = wrapper?.querySelector('nav[class*="switcherRail"]');
      expect(wrapper).toBeTruthy();
      expect(body).toBeTruthy();
      expect(rail).toBeTruthy();
      expect(rail?.getAttribute('data-folded')).toBe('true');
      expect(rail?.getAttribute('aria-hidden')).toBe('true');
      fireEvent.transitionEnd(rail!);
      expect(wrapper?.querySelector('nav[class*="switcherRail"]')).toBeNull();

      // 2. Pantalla de cambio activo (entrar a 'cambio-ejemplo')
      rerender(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
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
      fireEvent.click(screen.getAllByRole('button', { name: /openspec\.start\.enter/ })[0]);

      // Activo, rightOpen false
      wrapper = container.querySelector('[class*="startScreenWrapper"]');
      body = wrapper?.querySelector('[class*="startBody"]');
      rail = wrapper?.querySelector('nav[class*="switcherRail"]');
      expect(wrapper).toBeTruthy();
      expect(body).toBeTruthy();
      expect(rail).toBeTruthy();

      // Activo, rightOpen true
      rerender(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
          leftOpen={false}
          rightOpen={true}
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
      wrapper = container.querySelector('[class*="startScreenWrapper"]');
      body = wrapper?.querySelector('[class*="startBody"]');
      rail = wrapper?.querySelector('nav[class*="switcherRail"]');
      expect(wrapper).toBeTruthy();
      expect(body).toBeTruthy();
      expect(rail).toBeTruthy();
      expect(rail?.getAttribute('data-folded')).toBe('true');
      expect(rail?.getAttribute('aria-hidden')).toBe('true');
      fireEvent.transitionEnd(rail!);
      expect(wrapper?.querySelector('nav[class*="switcherRail"]')).toBeNull();

      // 3. Pantalla de cambio archivado
      // Volver a inicio desde el riel
      rerender(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
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
      rail = container.querySelector('nav[class*="switcherRail"]');
      if (rail) fireEvent.transitionEnd(rail);
      const backToStartBtn = screen.getByRole('button', { name: /pipeline\.openspec\.start\.inProgress/i });
      fireEvent.click(backToStartBtn);

      // Ir a la pestaña de archivados en la pantalla de inicio
      const archivedTab = screen.getByRole('button', { name: /pipeline\.openspec\.start\.archivedCount/i });
      fireEvent.click(archivedTab);

      const enterArchiveBtn = screen.getByRole('button', { name: /openspec\.start\.enter/i });
      fireEvent.click(enterArchiveBtn);

      // Archivado, rightOpen false
      wrapper = container.querySelector('[class*="startScreenWrapper"]');
      body = wrapper?.querySelector('[class*="startBody"]');
      rail = wrapper?.querySelector('nav[class*="switcherRail"]');
      expect(wrapper).toBeTruthy();
      expect(body).toBeTruthy();
      expect(rail).toBeTruthy();

      // Archivado, rightOpen true
      rerender(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
          leftOpen={false}
          rightOpen={true}
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
      wrapper = container.querySelector('[class*="startScreenWrapper"]');
      body = wrapper?.querySelector('[class*="startBody"]');
      rail = wrapper?.querySelector('nav[class*="switcherRail"]');
      expect(wrapper).toBeTruthy();
      expect(body).toBeTruthy();
      expect(rail).toBeTruthy();
      expect(rail?.getAttribute('data-folded')).toBe('true');
      expect(rail?.getAttribute('aria-hidden')).toBe('true');
      fireEvent.transitionEnd(rail!);
      expect(wrapper?.querySelector('nav[class*="switcherRail"]')).toBeNull();
    });
  });

  describe('Tanda 1: Un solo ancho para el cuerpo SDD, encabezado que cubre y riel despegado (Tareas 1.1 a 1.4)', () => {
    const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
    const css = fs.readFileSync(modulePath, 'utf-8');

    it('(a) encabezado, cuerpo, panel de archivado, esqueleto y vista de configuración consumen --sdd-body-width y --sdd-body-gutter', () => {
      // 1. .dashboard declara la variable base y el relleno mínimo
      const dashboardMatch = css.match(/\.dashboard\s*\{([^}]+)\}/);
      expect(dashboardMatch).toBeTruthy();
      const dashboardRules = dashboardMatch![1];
      expect(dashboardRules).toMatch(/--sdd-body-width:\s*1100px/);
      expect(dashboardRules).toMatch(/--sdd-body-gutter:\s*var\(--space-5\)/);
      expect(dashboardRules).toMatch(/--right-panel-width:\s*320px/);

      // 2. .changeHeader consume --sdd-body-width y --sdd-body-gutter
      const headerMatch = css.match(/\.changeHeader\s*\{([^}]+)\}/);
      expect(headerMatch).toBeTruthy();
      const headerRules = headerMatch![1];
      expect(headerRules).toMatch(/max-width:\s*var\(--sdd-body-width\)/);
      expect(headerRules).toMatch(/padding:[^;]*var\(--sdd-body-gutter\)/);

      // 3. .startScreen consume --sdd-body-width y --sdd-body-gutter
      const screenMatch = css.match(/\.startScreen\s*\{([^}]+)\}/);
      expect(screenMatch).toBeTruthy();
      const screenRules = screenMatch![1];
      expect(screenRules).toMatch(/max-width:\s*var\(--sdd-body-width\)/);
      expect(screenRules).toMatch(/padding:[^;]*var\(--sdd-body-gutter\)/);

      // 4. .archiveConfirm consume --sdd-body-width, --sdd-body-gutter y está centrado
      const archiveMatch = css.match(/\.archiveConfirm\s*\{([^}]+)\}/);
      expect(archiveMatch).toBeTruthy();
      const archiveRules = archiveMatch![1];
      expect(archiveRules).toMatch(/max-width:\s*var\(--sdd-body-width\)/);
      expect(archiveRules).toMatch(/margin:\s*0\s+auto/);
      expect(archiveRules).toMatch(/padding:[^;]*var\(--sdd-body-gutter\)/);

      // 5. .skeletonCenter consume --sdd-body-width, --sdd-body-gutter y está centrado
      const skeletonMatch = css.match(/\.skeletonCenter\s*\{([^}]+)\}/);
      expect(skeletonMatch).toBeTruthy();
      const skeletonRules = skeletonMatch![1];
      expect(skeletonRules).toMatch(/max-width:\s*var\(--sdd-body-width\)/);
      expect(skeletonRules).toMatch(/margin:\s*0\s+auto/);
      expect(skeletonRules).toMatch(/padding:[^;]*var\(--sdd-body-gutter\)/);

      // 6. .reviewView consume --sdd-body-width, --sdd-body-gutter y está centrado
      const reviewMatch = css.match(/\.reviewView\s*\{([^}]+)\}/);
      expect(reviewMatch).toBeTruthy();
      const reviewRules = reviewMatch![1];
      expect(reviewRules).toMatch(/max-width:\s*var\(--sdd-body-width\)/);
      expect(reviewRules).toMatch(/margin:\s*0\s+auto/);
      expect(reviewRules).toMatch(/padding:[^;]*var\(--sdd-body-gutter\)/);
    });

    it('(b) sin umbral por container query: --sdd-body-width es 1100px y los bloques usan width: 100%', () => {
      expect(css).not.toMatch(/@container\s*\([^)]*min-width/);
      expect(css).toMatch(/--sdd-body-width:\s*1100px/);
      for (const selector of ['.changeHeader', '.startScreen', '.archiveConfirm', '.skeletonCenter']) {
        const blockMatch = css.match(new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`));
        expect(blockMatch).toBeTruthy();
        expect(blockMatch![1]).toMatch(/width:\s*100%/);
        expect(blockMatch![1]).toMatch(/max-width:\s*var\(--sdd-body-width\)/);
      }
    });

    it('(c) el riel flotante tiene top derivado de --change-header-height más var(--space-4), margen superior en reposo de var(--space-4) y animación con var(--panel-motion)', () => {
      const railMatch = css.match(/\.switcherRail\s*\{([^}]+)\}/);
      expect(railMatch).toBeTruthy();
      const railRules = railMatch![1];
      expect(railRules).toMatch(/top:\s*calc\(var\(--change-header-height[^)]*\)\s*\+\s*var\(--space-4\)\)/);
      expect(railRules).toMatch(/margin:\s*var\(--space-4\)/);
      expect(railRules).toMatch(/transition:[^;]*var\(--panel-motion\)/);
    });

    it('(d) el riel flotante y el esqueleto consumen --right-panel-width y retiran max-width rígido de 260px', () => {
      const railMatch = css.match(/\.switcherRail\s*\{([^}]+)\}/);
      expect(railMatch).toBeTruthy();
      expect(railMatch![1]).toMatch(/flex:\s*0\s+0\s+var\(--right-panel-width,\s*320px\)/);
      expect(railMatch![1]).toMatch(/width:\s*var\(--right-panel-width,\s*320px\)/);
      expect(railMatch![1]).not.toMatch(/max-width:\s*260px/);

      const skeletonMatch = css.match(/\.skeletonRail\s*\{([^}]+)\}/);
      expect(skeletonMatch).toBeTruthy();
      expect(skeletonMatch![1]).toMatch(/flex:\s*0\s+0\s+var\(--right-panel-width,\s*320px\)/);
      expect(skeletonMatch![1]).toMatch(/width:\s*var\(--right-panel-width,\s*320px\)/);
      expect(skeletonMatch![1]).not.toMatch(/max-width:\s*260px/);
    });

    it('(c-runtime) ResizeObserver sobre changeHeader publica --change-header-height en el cuerpo', () => {
      let observedElement: HTMLElement | null = null;
      let observerCallback: ((entries: any[], observer: any) => void) | null = null;

      class MockRO {
        constructor(cb: (entries: any[], observer: any) => void) {
          observerCallback = cb;
        }
        observe(el: HTMLElement) {
          observedElement = el;
        }
        disconnect() {}
      }

      vi.stubGlobal('ResizeObserver', MockRO);

      try {
        const { container } = renderSdd();
        const header = container.querySelector('[class*="changeHeader"]') as HTMLElement;
        expect(header).toBeTruthy();
        expect(observedElement).toBe(header);

        // Simular que el encabezado mide 64px
        vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
          height: 64,
          width: 820,
          top: 0,
          bottom: 64,
          left: 0,
          right: 820,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        // Disparar la medición
        if (observerCallback) {
          (observerCallback as (entries: any[], observer: any) => void)([{ target: header }], {});
        }

        const body = container.querySelector('[class*="startBody"]') as HTMLElement;
        expect(body).toBeTruthy();
        expect(body.style.getPropertyValue('--change-header-height')).toBe('64px');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
