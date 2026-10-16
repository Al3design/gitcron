// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import { usePipelineStore } from '@/lib/pipeline-store';
import type { PipelineSnapshot } from '../pipeline-view-state';

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

afterEach(cleanup);

beforeEach(() => {
  usePipelineStore.setState({
    selectedChangeId: null,
    openSpecificationId: null,
    prepareOpen: false,
  });
});

function mockChange(changeId: string) {
  return {
    changeId,
    intent: `Intención completa del cambio ${changeId}`,
    tasks: [
      {
        id: 't-1',
        text: '1.1 Tarea con un texto descriptivo muy largo que no debe ser cortado por elipsis bajo ninguna circunstancia',
        completed: false,
        line: 10,
        sourceRef: 'tasks.md:10',
      },
      {
        id: 't-2',
        text: '1.2 Segunda tarea ya completada para verificar estado del cambio',
        completed: true,
        line: 20,
        sourceRef: 'tasks.md:20',
      },
    ],
    proposalExists: true,
    designExists: true,
    specsCount: 1,
    validation: 'unknown' as const,
    artifacts: {
      proposal: '# Propuesta\n\nTexto de propuesta.',
      specs: [{ name: 'spec-1', content: '# Spec 1' }],
      design: '# Diseño\n\nTexto de diseño.',
      tasks: '- [ ] 1.1 Tarea\n- [x] 1.2 Tarea',
    },
  };
}

function mockSnapshot(overrides: {
  diffs?: PipelineSnapshot['diffs'];
  activity?: PipelineSnapshot['activity'];
} = {}): PipelineSnapshot {
  return {
    schemaVersion: '1.0',
    repoId: 'repo-test',
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
    activity: overrides.activity ?? [],
    economy: { reasoningAvailable: null } as PipelineSnapshot['economy'],
    diffs: overrides.diffs ?? [],
    openSpec: {
      selectedChangeId: 'cambio-activo',
      activeChanges: [mockChange('cambio-activo')],
      archivedChanges: [],
      specifications: [],
      reports: [],
      diagnostics: [],
      observedAt: null,
      latestGate: null,
    },
  } as unknown as PipelineSnapshot;
}

function renderActiveChange(props: {
  diffs?: PipelineSnapshot['diffs'];
  projection?: any;
  currentBranch?: string;
  rightOpen?: boolean;
} = {}) {
  const rendered = render(
    <OpenSpecDashboard
      snapshot={mockSnapshot({ diffs: props.diffs })}
      repoPath="C:/repo"
      currentBranch={props.currentBranch ?? 'main'}
      workingTreeClean={true}
      leftOpen={false}
      rightOpen={props.rightOpen ?? false}
      leftWidth={320}
      rightWidth={320}
      onResizeLeft={() => undefined}
      onResizeRight={() => undefined}
      projection={props.projection ?? null}
      runtimeHistory={[]}
      onRefresh={() => undefined}
      onPauseAfterTask={() => undefined}
      onRespondDecision={() => undefined}
    />,
  );

  const enterBtns = screen.queryAllByRole('button', { name: /openspec\.start\.enter/ });
  if (enterBtns.length > 0) {
    fireEvent.click(enterBtns[0]);
  }
  return rendered;
}

function renderArchivedChange(archivedChangeId = 'cambio-archivado', options: { rightOpen?: boolean } = {}) {
  const snap = mockSnapshot();
  if (snap.openSpec) {
    snap.openSpec.selectedChangeId = archivedChangeId;
    snap.openSpec.activeChanges = [];
    snap.openSpec.archivedChanges = [
      {
        changeId: archivedChangeId,
        createdAt: '2026-08-01T10:00:00Z',
        archivedOn: '2026-08-05T10:00:00Z',
        archivedAt: '2026-08-05 10:00',
        artifacts: {
          proposal: '# Propuesta archivada',
          specs: [],
          design: '# Diseño archivado',
          tasks: '- [x] 1.1 Completada',
        },
      } as any,
    ];
  }

  const rendered = render(
    <OpenSpecDashboard
      snapshot={snap}
      repoPath="C:/repo"
      currentBranch="main"
      workingTreeClean={true}
      leftOpen={false}
      rightOpen={options.rightOpen ?? false}
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

  act(() => {
    usePipelineStore.setState({
      selectedChangeId: archivedChangeId,
      openSpecificationId: null,
    });
  });

  return rendered;
}

function renderSpecification(specId = 'spec-1', options: { rightOpen?: boolean } = {}) {
  const snap = mockSnapshot();
  if (snap.openSpec) {
    snap.openSpec.selectedChangeId = null;
    snap.openSpec.activeChanges = [];
    snap.openSpec.specifications = [
      {
        specificationId: specId,
        requirements: 5,
        sourceRef: `openspec/specs/${specId}/spec.md`,
      },
    ];
  }

  const rendered = render(
    <OpenSpecDashboard
      snapshot={snap}
      repoPath="C:/repo"
      currentBranch="main"
      workingTreeClean={true}
      leftOpen={false}
      rightOpen={options.rightOpen ?? false}
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

  act(() => {
    usePipelineStore.setState({
      selectedChangeId: null,
      openSpecificationId: specId,
    });
  });

  return rendered;
}

function renderStartScreen(options: { rightOpen?: boolean } = {}) {
  const snap = mockSnapshot();
  if (snap.openSpec) {
    snap.openSpec.selectedChangeId = null;
  }
  act(() => {
    usePipelineStore.setState({
      selectedChangeId: null,
      openSpecificationId: null,
    });
  });

  return render(
    <OpenSpecDashboard
      snapshot={snap}
      repoPath="C:/repo"
      currentBranch="main"
      workingTreeClean={true}
      leftOpen={false}
      rightOpen={options.rightOpen ?? false}
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
}

describe('Intercambiador de vistas en la pantalla del cambio activo', () => {
  it('elegir una entrada del panel intercambia la vista del cuerpo entre resumen, tareas y artefactos', () => {
    renderActiveChange();

    // 1. Por defecto en el cuerpo se monta la vista soberana de resumen
    expect(screen.getByRole('region', { name: 'pipeline.switcher.overview' })).toBeTruthy();
    expect(screen.getByTestId('where-you-left-off-card')).toBeTruthy();

    // 2. El rail ofrece tareas y artefactos
    const tasksBtn = screen.getByRole('button', { name: /pipeline\.switcher\.tasks/ });
    expect(tasksBtn).toBeTruthy();
    const artifactsBtn = screen.getByRole('button', { name: 'pipeline.switcher.artifacts' });
    expect(artifactsBtn).toBeTruthy();

    // 3. Al hacer clic en tareas, el cuerpo pasa a mostrar la lista de tareas
    fireEvent.click(tasksBtn);
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(screen.getByRole('list')).toBeTruthy();

    // 4. El rail ahora ofrece resumen para poder volver
    const overviewBtn = screen.getByRole('button', { name: 'pipeline.switcher.overview' });
    expect(overviewBtn).toBeTruthy();

    // 5. Al hacer clic en artefactos, el cuerpo pasa a mostrar artefactos y evidencia
    fireEvent.click(screen.getByRole('button', { name: 'pipeline.switcher.artifacts' }));
    expect(screen.getByRole('region', { name: 'pipeline.switcher.artifacts' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'pipeline.details.title' })).toBeTruthy();

    // 6. Al hacer clic en resumen, vuelve a la vista de resumen
    fireEvent.click(screen.getByRole('button', { name: 'pipeline.switcher.overview' }));
    expect(screen.getByRole('region', { name: 'pipeline.switcher.overview' })).toBeTruthy();
  });

  it('sin diffs la entrada de diffs no existe en el panel y con diffs permite verlos', () => {
    // Caso 1: Sin diffs, no existe la entrada en el rail
    const { unmount } = renderActiveChange({ diffs: [] });
    expect(screen.queryByRole('button', { name: /pipeline\.switcher\.diffs/ })).toBeNull();
    unmount();

    // Caso 2: Con diffs, la entrada existe y conmuta a la vista de diffs
    renderActiveChange({
      diffs: [
        {
          filePath: 'src/archivo.ts',
          diffContent: '@@ -1 +1 @@\n-old\n+new',
          agentId: null,
          taskId: null,
        },
      ],
    });
    const diffsBtn = screen.getByRole('button', { name: /pipeline\.switcher\.diffs/ });
    expect(diffsBtn).toBeTruthy();

    fireEvent.click(diffsBtn);
    expect(screen.getByRole('region', { name: 'pipeline.switcher.diffs' })).toBeTruthy();
  });

  it('sin sesión la entrada de actividad no existe en el panel y con sesión permite verla', () => {
    // Caso 1: Sin sesión ni actividad, no existe la entrada en el rail
    const { unmount } = renderActiveChange({ projection: null });
    expect(screen.queryByRole('button', { name: /pipeline\.switcher\.activity/ })).toBeNull();
    unmount();

    // Caso 2: Con sesión para este cambio, la entrada existe y conmuta a actividad
    renderActiveChange({
      projection: {
        sessionId: 'session-1',
        changeId: 'cambio-activo',
        startedAt: '2026-09-05T10:00:00Z',
        runtime: 'hermes',
        role: 'agent',
        taskId: 't-1',
        status: 'running',
        activity: [
          {
            id: 'act-1',
            timestamp: '2026-09-05T10:00:00Z',
            channel: 'narrative',
            text: 'Iniciando tarea 1.1',
          },
        ],
      },
    });
    const activityBtn = screen.getByRole('button', { name: /pipeline\.switcher\.activity/ });
    expect(activityBtn).toBeTruthy();

    fireEvent.click(activityBtn);
    expect(screen.getByRole('region', { name: 'pipeline.switcher.activity' })).toBeTruthy();
  });

  it('los textos de las tareas no se cortan con elipsis ni nowrap en los estilos', () => {
    renderActiveChange();

    // Navegar a Tareas para ver la lista de tareas
    fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.tasks/ }));

    // La tarea con texto largo se renderiza en el DOM completamente (número en strong, texto en span)
    const taskLabel = screen.getByText('1.1');
    expect(taskLabel).toBeTruthy();
    const longTaskText = screen.getAllByText(/Tarea con un texto descriptivo muy largo que no debe ser cortado/)[0];
    expect(longTaskText).toBeTruthy();

    // Verificación estricta en el CSS: no existe nowrap ni text-overflow: ellipsis en .taskList > li > strong
    const cssPath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    const strongRuleMatch = cssContent.match(/\.taskList\s*>\s*li\s*>\s*strong\s*\{([^}]+)\}/);
    expect(strongRuleMatch).not.toBeNull();
    const strongRuleBody = strongRuleMatch![1];
    expect(strongRuleBody).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(strongRuleBody).not.toMatch(/white-space:\s*nowrap/);
  });

  it('una tarea sin sesión no dibuja ficha de detalle ni frase de disculpa', () => {
    renderActiveChange({ projection: null });

    // No se dibuja ningún dl ni fichas de información no reportada
    expect(screen.queryByText(/pipeline\.openspec\.task\.agent/i)).toBeNull();
    expect(screen.queryByText(/pipeline\.openspec\.task\.source/i)).toBeNull();
    expect(screen.queryByText(/pipeline\.openspec\.task\.workingTree/i)).toBeNull();

    // Enmienda fechada 2026-09-04: Tampoco se dibuja frase de disculpa
    expect(screen.queryByText(/pipeline\.openspec\.task\.noSession/i)).toBeNull();
  });

  it('la cabecera desinflada no contiene botón de glosario ni botones fijos de archivar o ver diff', () => {
    renderActiveChange({
      diffs: [
        {
          filePath: 'src/archivo.ts',
          diffContent: '@@ -1 +1 @@\n-old\n+new',
          agentId: null,
          taskId: null,
        },
      ],
    });

    const header = screen.getByRole('banner');
    expect(header).toBeTruthy();

    // No hay botón de glosario
    expect(screen.queryByRole('button', { name: /glosario/i })).toBeNull();
    expect(screen.queryByText(/pipeline\.details\.glossary/i)).toBeNull();

    // No hay botones fijos de archivar o ver diff dentro de la cabecera
    const headerButtons = header.querySelectorAll('button');
    const headerButtonTexts = Array.from(headerButtons).map((btn) => btn.textContent || '');
    expect(headerButtonTexts.some((txt) => /pipeline\.openspec\.archive/i.test(txt))).toBe(false);
    expect(headerButtonTexts.some((txt) => /pipeline\.openspec\.actions\.diff/i.test(txt))).toBe(false);

    // Archivar vive en la ranura de entorno del panel (environmentSlot)
    const rail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    const archiveBtnInRail = rail.querySelector('button[title*="pipeline.openspec.archive"]');
    expect(archiveBtnInRail).not.toBeNull();
  });

  it('la vista de artefactos reserva el contenedor para la línea de tiempo con data-slot="artifact-timeline"', () => {
    const { container } = renderActiveChange();

    // Cambiar a vista de artefactos
    fireEvent.click(screen.getByRole('button', { name: 'pipeline.switcher.artifacts' }));

    // El contenedor reservado para la línea de tiempo existe con su identificador de ranura
    const timelineSlot = container.querySelector('div[data-slot="artifact-timeline"]');
    expect(timelineSlot).not.toBeNull();
    expect(timelineSlot?.getAttribute('aria-label')).toBe('pipeline.openspec.artifacts.timelineSlot');
  });

  it('el sidebar flotante dinámico ofrece volver al inicio y la cabecera no tiene botón ver el repositorio', () => {
    renderActiveChange();

    const header = screen.getByRole('banner');
    // En la cabecera no está el botón "Ver el repositorio"
    expect(header.querySelector('button[class*="backToStart"]')).toBeNull();

    // El panel dinámico ofrece la opción de volver a los cambios en curso
    const backToStartOption = screen.getByRole('button', { name: 'pipeline.openspec.start.inProgress' });
    expect(backToStartOption).toBeTruthy();

    // Al clickear volver a en curso, regresa a la pantalla de entrada del repositorio
    fireEvent.click(backToStartOption);
    expect(screen.getByRole('region', { name: 'pipeline.openspec.start.title' })).toBeTruthy();
  });

  it('el sidebar flotante presenta encabezados de rótulo no plegables para Vistas y Acciones, y Continuar con tarea vive en Acciones', () => {
    renderActiveChange();

    const rail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    expect(rail).toBeTruthy();

    // Los encabezados de sección quedan como rótulos y no como controles plegables (no tienen button ni aria-expanded)
    const collapsibleButtons = rail.querySelectorAll('button[aria-expanded]');
    expect(collapsibleButtons.length).toBe(0);

    // Rótulos de Vistas y Acciones presentes en el riel
    expect(rail.textContent).toContain('pipeline.switcher.views');
    expect(rail.textContent).toContain('pipeline.switcher.actions');

    // "Continuar con..." está en el rail bajo la sección de Acciones, no en el banner del header
    const header = screen.getByRole('banner');
    expect(header.querySelector('button[class*="primaryAction"]')).toBeNull();

    const continueBtn = rail.querySelector('button[class*="railPrimaryAction"]');
    expect(continueBtn).toBeTruthy();
    expect(continueBtn?.textContent).toContain('pipeline.next.task.action');

    // "Archivar cambio" también está dentro del rail
    const archiveBtn = rail.querySelector('button[title*="pipeline.openspec.archive"]');
    expect(archiveBtn).toBeTruthy();
  });

  it('continuar con tarea abre pantalla dedicada de lanzador sin empujar tareas, y el riel ofrece volver a tareas o cancelar', () => {
    renderActiveChange();

    // 1. Inicialmente se muestra el resumen, y se puede navegar a tareas
    expect(screen.getByRole('region', { name: 'pipeline.switcher.overview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.tasks/ }));
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(screen.getByRole('list')).toBeTruthy();

    // 2. Pulsar "Continuar con..." en el riel
    const rail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    const continueBtn = rail.querySelector('button[class*="railPrimaryAction"]') as HTMLButtonElement;
    expect(continueBtn).toBeTruthy();
    fireEvent.click(continueBtn);

    // 3. Ahora se muestra la pantalla dedicada del lanzador, y la lista de tareas NO está en el cuerpo
    expect(screen.getByRole('region', { name: 'pipeline.openspec.launcher.title' })).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();

    // 4. El riel se actualizó dinámicamente:
    // - En Vistas ofrece "Volver a tareas"
    const returnToTasksBtn = screen.getByRole('button', { name: /pipeline\.switcher\.tasksReturn/ });
    expect(returnToTasksBtn).toBeTruthy();

    // - En Acciones ofrece "Cancelar"
    const cancelBtn = rail.querySelector('button[title="pipeline.openspec.archive.cancel"]') as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();

    // 5. Al pulsar "Cancelar", se cierra el lanzador y se restaura la lista de tareas
    fireEvent.click(cancelBtn);
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(screen.getByRole('list')).toBeTruthy();
  });

  it('el encabezado alinea el título del cambio y la descripción dentro de changeTitleGroup', () => {
    const { container } = renderActiveChange();

    const titleGroup = container.querySelector('[class*="changeTitleGroup"]');
    expect(titleGroup).toBeTruthy();

    const title = titleGroup?.querySelector('h3');
    expect(title?.textContent).toContain('pipeline.openspec.change.active');

    const desc = titleGroup?.querySelector('p[class*="nextStepInline"]');
    expect(desc?.textContent).toContain('pipeline.next.task.help');
  });

  it('el panel sigue anclado con el cuerpo desplazado a fondo', () => {
    const cssPath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // 1. No lleva relleno de compensación artificial (calc(100vh))
    expect(cssContent).not.toMatch(/\.startScreen\s*\{[^}]*calc\(100vh/);

    // 2. El panel está configurado con anclaje sticky superior
    expect(cssContent).toMatch(/\.switcherRail\s*\{[^}]*position:\s*sticky/);
    expect(cssContent).toMatch(/\.switcherRail\s*\{[^}]*top:\s*calc\(var\(--change-header-height/);

    // 3. Montado en el DOM, el panel permanece visible en el contenedor al simular scroll profundo
    const { container } = renderActiveChange();
    const rail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    expect(rail).toBeTruthy();

    const center = container.querySelector('[class*="center"]');
    if (center) {
      fireEvent.scroll(center, { target: { scrollTop: 3000 } });
    }

    // El riel permanece anclado y accesible en el DOM
    expect(screen.getByRole('navigation', { name: 'pipeline.switcher.views' })).toBeTruthy();
  });

  it('los ítems del panel no declaran borde propio', () => {
    // Caso medido el 2026-09-06: la prueba anterior pasaba en verde mientras las dos acciones del panel
    // se veían encajonadas porque sólo inspeccionaba selectores con nombre de riel (.railItem, .switcherRail)
    // en vez de las clases que el elemento efectivamente lleva puestas (.primaryAction, .secondaryAction agregaban borde y tipografía mono).
    renderActiveChange();
    const rail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    const buttons = Array.from(rail.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);

    const appliedClasses = Array.from(new Set(buttons.flatMap((btn) => Array.from(btn.classList))));
    const cssPath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const ruleRegex = /([^{]+)\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    const unexpectedBorders: string[] = [];

    while ((match = ruleRegex.exec(cssContent)) !== null) {
      const selector = match[1].trim();
      const body = match[2];

      const targetsClass = appliedClasses.some((cls) => {
        const pattern = new RegExp(`\\.${cls}(?:[:\\s,\\[>]|$)`);
        return pattern.test(selector);
      });

      if (targetsClass) {
        const borderProps = body
          .split(';')
          .map((s) => s.trim())
          .filter(
            (s) =>
              s &&
              /^(border|border-top|border-bottom|border-left|border-right|border-color|border-block|border-inline)/i.test(s) &&
              !s.startsWith('border-radius')
          );
        if (borderProps.length > 0) {
          unexpectedBorders.push(`${selector}: ${borderProps.join(', ')}`);
        }
      }
    }

    expect(unexpectedBorders).toEqual([]);
  });

  it('el escáner de bordes pasa sin excepciones nuevas', () => {
    // 1. Las 4 excepciones fueron revertidas de commit-graph-frame.test.tsx
    const testPath = path.resolve(process.cwd(), 'components/__tests__/commit-graph-frame.test.tsx');
    const testContent = fs.readFileSync(testPath, 'utf-8');
    expect(testContent).not.toMatch(/\/\.railItem\//);
    expect(testContent).not.toMatch(/\/\.railActionItem\//);
    expect(testContent).not.toMatch(/\/\.railPrimaryAction\//);
    expect(testContent).not.toMatch(/\/\.switcherRail\//);

    // Caso medido el 2026-09-06: la prueba anterior pasaba en verde mientras las dos acciones del panel
    // se veían encajonadas porque sólo inspeccionaba selectores con nombre de riel (.railItem, .switcherRail)
    // en vez de las clases reales del elemento (.primaryAction, .secondaryAction agregaban borde,
    // border-color, box-shadow de contorno y tipografía monoespaciada).
    renderActiveChange();
    const rail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    const buttons = Array.from(rail.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);

    const appliedClasses = Array.from(new Set(buttons.flatMap((btn) => Array.from(btn.classList))));
    const cssPath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const ruleRegex = /([^{]+)\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    const defects: string[] = [];

    while ((match = ruleRegex.exec(cssContent)) !== null) {
      const selector = match[1].trim();
      const body = match[2];

      const targetsClass = appliedClasses.some((cls) => {
        const pattern = new RegExp(`\\.${cls}(?:[:\\s,\\[>]|$)`);
        return pattern.test(selector);
      });

      if (targetsClass) {
        const decls = body.split(';').map((s) => s.trim()).filter(Boolean);
        for (const decl of decls) {
          if (/^(border|border-top|border-bottom|border-left|border-right|border-color|border-block|border-inline)/i.test(decl) && !decl.startsWith('border-radius')) {
            defects.push(`${selector} [border]: ${decl}`);
          }
          if (/^box-shadow\s*:\s*.*(?:1px|inset)/i.test(decl)) {
            defects.push(`${selector} [contour box-shadow]: ${decl}`);
          }
          if (/^font-family\s*:\s*.*(?:--font-mono|monospace|ui-monospace)/i.test(decl)) {
            defects.push(`${selector} [monospace font]: ${decl}`);
          }
        }
      }
    }

    expect(defects).toEqual([]);
  });

  it('el contenedor que ancla al panel no se encoge por debajo del alto de su contenido', () => {
    const cssPath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // 1. .startScreenWrapper está declarado con flex: 1 0 auto (prohibiendo flex-shrink: 1)
    const wrapperMatch = cssContent.match(/\.startScreenWrapper\s*\{([^}]+)\}/);
    expect(wrapperMatch).not.toBeNull();
    const wrapperBody = wrapperMatch![1];
    expect(wrapperBody).toMatch(/flex:\s*1\s+0\s+auto/);
    expect(wrapperBody).not.toMatch(/flex:\s*1\s+1\s+auto/);
    expect(wrapperBody).not.toMatch(/flex-shrink:\s*1/);

    // 2. No lleva rellenos mágicos de compensación atados a la ventana
    expect(cssContent).not.toMatch(/\.startScreen\s*\{[^}]*calc\(100vh/);
    expect(cssContent).not.toMatch(/\.startScreenWrapper\s*\{[^}]*calc\(100vh/);

    // 3. Montado en el DOM, .startScreenWrapper aloja a .switcherRail y .startBody como hermanos
    const { container } = renderActiveChange();
    const wrapper = container.querySelector('[class*="startScreenWrapper"]');
    expect(wrapper).toBeTruthy();
    const rail = wrapper?.querySelector('nav[class*="switcherRail"]');
    const body = wrapper?.querySelector('div[class*="startBody"]');
    expect(rail).toBeTruthy();
    expect(body).toBeTruthy();
  });

  it('un cambio activo o archivado abre por omisión en Resumen', () => {
    // Activo
    const { unmount } = renderActiveChange();
    expect(screen.getByRole('region', { name: 'pipeline.switcher.overview' })).toBeTruthy();
    expect(screen.getByTestId('where-you-left-off-card')).toBeTruthy();
    unmount();

    // Archivado
    renderArchivedChange('cambio-archivado');
    expect(screen.getByTestId('where-you-left-off-card')).toBeTruthy();
  });

  it('desde el Resumen, tocar la tarea en curso o una sección lleva a Tareas con la tarea resaltada', () => {
    renderActiveChange();
    expect(screen.getByRole('region', { name: 'pipeline.switcher.overview' })).toBeTruthy();

    // Tocar la tarea en curso
    const currentTaskBtn = screen.getByTestId('resume-current-task-title');
    fireEvent.click(currentTaskBtn);

    // Conduce a la vista de Tareas
    expect(screen.getByRole('region', { name: 'pipeline.switcher.tasks' })).toBeTruthy();
    expect(screen.getByRole('list')).toBeTruthy();
    const highlightedLi = document.querySelector('li[data-highlighted="true"]');
    expect(highlightedLi).toBeTruthy();
    expect(highlightedLi?.getAttribute('data-task-id')).toBe('t-1');
  });

  it('ninguna entrada del menú se duplica ni desaparece al alternar entre vistas', () => {
    renderActiveChange();

    // En Resumen: rail tiene start, tasks, artifacts (más openspec-config)
    const rail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    const viewButtonsInOverview = rail.querySelectorAll('button[data-view-id]');
    const idsInOverview = Array.from(viewButtonsInOverview).map((b) => b.getAttribute('data-view-id'));
    expect(idsInOverview).toEqual(['start', 'tasks', 'artifacts', 'openspec-config']);

    // Ir a Tareas
    fireEvent.click(screen.getByRole('button', { name: /pipeline\.switcher\.tasks/ }));
    const idsInTasks = Array.from(rail.querySelectorAll('button[data-view-id]')).map((b) => b.getAttribute('data-view-id'));
    expect(idsInTasks).toEqual(['start', 'overview', 'artifacts', 'openspec-config']);

    // Ir a Artefactos
    fireEvent.click(screen.getByRole('button', { name: 'pipeline.switcher.artifacts' }));
    const idsInArtifacts = Array.from(rail.querySelectorAll('button[data-view-id]')).map((b) => b.getAttribute('data-view-id'));
    expect(idsInArtifacts).toEqual(['start', 'overview', 'tasks', 'openspec-config']);

    // Volver a Resumen
    fireEvent.click(screen.getByRole('button', { name: 'pipeline.switcher.overview' }));
    const idsBackToOverview = Array.from(rail.querySelectorAll('button[data-view-id]')).map((b) => b.getAttribute('data-view-id'));
    expect(idsBackToOverview).toEqual(['start', 'tasks', 'artifacts', 'openspec-config']);
  });

  it('desde un cambio archivado y desde una especificación, el panel ofrece la salida adecuada', () => {
    // 1. Desde un cambio archivado: la ranura 1 ofrece volver a Archivados y la ranura 2 ofrece Nuevo cambio
    const { unmount: unmountArchive } = renderArchivedChange('cambio-archivado');

    // El riel de navegación del intercambiador está presente
    const archiveRail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    expect(archiveRail).toBeTruthy();

    // Ofrece "Archivados" (ranura 1) y "Nuevo cambio" (ranura 2)
    const backFromArchiveBtn = screen.getByRole('button', { name: /pipeline\.openspec\.start\.archivedCount/ });
    expect(backFromArchiveBtn).toBeTruthy();
    expect(backFromArchiveBtn.getAttribute('data-slot')).toBe('1');

    const newChangeBtn = screen.getByRole('button', { name: /pipeline\.openspec\.start\.newChange/ });
    expect(newChangeBtn).toBeTruthy();
    expect(newChangeBtn.getAttribute('data-slot')).toBe('2');

    // Al clickear, regresa a la vista de archivados del repositorio
    fireEvent.click(backFromArchiveBtn);
    expect(screen.getByRole('region', { name: /pipeline\.openspec\.start\.archived/ })).toBeTruthy();
    unmountArchive();

    // 2. Desde una especificación:
    const { unmount: unmountSpec } = renderSpecification('spec-prueba');

    // El riel de navegación del intercambiador está presente
    const specRail = screen.getByRole('navigation', { name: 'pipeline.switcher.views' });
    expect(specRail).toBeTruthy();

    // Ofrece "Volver al inicio"
    const backFromSpecBtn = screen.getByRole('button', { name: 'pipeline.switcher.start' });
    expect(backFromSpecBtn).toBeTruthy();

    // Al clickear, cierra la especificación y regresa a la pantalla de entrada del repositorio
    fireEvent.click(backFromSpecBtn);
    expect(screen.getByRole('region', { name: 'pipeline.openspec.start.title' })).toBeTruthy();
    unmountSpec();
  });

  it('ninguna de esas dos vistas conserva controles de la maqueta anterior', () => {
    // 1. En la vista de especificación, no existe el botón .backToStart («VER EL REPOSITORIO»)
    const { unmount: unmountSpec } = renderSpecification('spec-prueba');
    expect(screen.queryByRole('button', { name: /pipeline\.openspec\.start\.back/ })).toBeNull();
    const specHeader = screen.getByRole('heading', { name: /spec-prueba/ }).closest('header');
    expect(specHeader?.querySelector('button[class*="backToStart"]')).toBeNull();
    unmountSpec();

    // 2. En la vista de cambio archivado, el control de regreso está en el riel y no como botón suelto de cabecera
    const { unmount: unmountArchive } = renderArchivedChange('cambio-archivado');
    const header = screen.getByRole('heading', { name: 'cambio-archivado' }).closest('div');
    expect(header?.querySelector('button[class*="backToStart"]')).toBeNull();
    unmountArchive();
  });

  describe('4.14 / Observación 43: Incompatibilidad de convivencia entre el panel flotante y el navegador derecho (rightOpen)', () => {
    it('en las 4 pantallas (inicio, cambio activo, cambio archivado, especificación), si rightOpen es true el panel flotante se desactiva y el botón superior se deshabilita', () => {
      // 1. Pantalla de inicio
      const { container: startContainer, unmount: unmountStart } = renderStartScreen({ rightOpen: true });
      expect(startContainer.querySelector('nav[class*="switcherRail"]')).toBeNull();
      const startBtn = screen.getByTestId('pipeline.switcher.toggle');
      expect(startBtn.getAttribute('disabled')).not.toBeNull();
      expect(startBtn.getAttribute('aria-disabled')).toBe('true');
      expect(startBtn.getAttribute('aria-expanded')).toBe('false');
      expect(startBtn.getAttribute('title')).toBe('pipeline.switcher.toggleDisabledHelp');
      expect(startBtn.className).toMatch(/toggleBtnDisabled|opacity-50/);
      unmountStart();

      // 2. Cambio activo
      const { container: activeContainer, unmount: unmountActive } = renderActiveChange({ rightOpen: true });
      expect(activeContainer.querySelector('nav[class*="switcherRail"]')).toBeNull();
      const activeBtn = screen.getByTestId('pipeline.switcher.toggle');
      expect(activeBtn.getAttribute('disabled')).not.toBeNull();
      expect(activeBtn.getAttribute('aria-disabled')).toBe('true');
      expect(activeBtn.getAttribute('aria-expanded')).toBe('false');
      expect(activeBtn.getAttribute('title')).toBe('pipeline.switcher.toggleDisabledHelp');
      unmountActive();

      // 3. Cambio archivado
      const { container: archiveContainer, unmount: unmountArchive } = renderArchivedChange('cambio-archivado', { rightOpen: true });
      expect(archiveContainer.querySelector('nav[class*="switcherRail"]')).toBeNull();
      const archiveBtn = screen.getByTestId('pipeline.switcher.toggle');
      expect(archiveBtn.getAttribute('disabled')).not.toBeNull();
      expect(archiveBtn.getAttribute('aria-disabled')).toBe('true');
      expect(archiveBtn.getAttribute('aria-expanded')).toBe('false');
      expect(archiveBtn.getAttribute('title')).toBe('pipeline.switcher.toggleDisabledHelp');
      unmountArchive();

      // 4. Visor de especificación
      const { container: specContainer, unmount: unmountSpec } = renderSpecification('spec-prueba', { rightOpen: true });
      expect(specContainer.querySelector('nav[class*="switcherRail"]')).toBeNull();
      const specBtn = screen.getByTestId('pipeline.switcher.toggle');
      expect(specBtn.getAttribute('disabled')).not.toBeNull();
      expect(specBtn.getAttribute('aria-disabled')).toBe('true');
      expect(specBtn.getAttribute('aria-expanded')).toBe('false');
      expect(specBtn.getAttribute('title')).toBe('pipeline.switcher.toggleDisabledHelp');
      unmountSpec();
    });


    it('con inspector abierto y onEnsureRightClosed provisto, el botón está habilitado, cierra el inspector y muestra el riel', () => {
      const onEnsureRightClosed = vi.fn();
      const snap = mockSnapshot();
      const { container, rerender } = render(
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
          onEnsureRightClosed={onEnsureRightClosed}
          projection={null}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />,
      );

      const toggleBtn = screen.getByTestId('pipeline.switcher.toggle');
      expect(toggleBtn.getAttribute('disabled')).toBeNull();
      expect(toggleBtn.getAttribute('aria-disabled')).toBe('false');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
      expect(toggleBtn.getAttribute('title')).toBe('pipeline.switcher.showNavClosesInspector');
      expect(toggleBtn.getAttribute('aria-label')).toBe('pipeline.switcher.showNav');

      // Al pulsar, invoca onEnsureRightClosed
      fireEvent.click(toggleBtn);
      expect(onEnsureRightClosed).toHaveBeenCalledTimes(1);

      // Simulando que el armazón responde cerrando rightOpen a false
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
          onEnsureRightClosed={onEnsureRightClosed}
          projection={null}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />,
      );

      expect(container.querySelector('nav[class*="switcherRail"]')).toBeTruthy();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(toggleBtn.getAttribute('aria-label')).toBe('pipeline.switcher.hideNav');

      // Segunda pulsación lo oculta
      fireEvent.click(toggleBtn);
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
      expect(toggleBtn.getAttribute('aria-label')).toBe('pipeline.switcher.showNav');

      // Tercera pulsación lo vuelve a mostrar
      fireEvent.click(toggleBtn);
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeTruthy();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(toggleBtn.getAttribute('aria-label')).toBe('pipeline.switcher.hideNav');
    });
    it('al pulsar el botón cuando está deshabilitado por rightOpen, no alterna el estado y el panel no se monta', () => {
      const { container } = renderStartScreen({ rightOpen: true });
      const toggleBtn = screen.getByTestId('pipeline.switcher.toggle');
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();

      fireEvent.click(toggleBtn);
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    });

    it('al cerrar el navegador derecho (rightOpen pasa a false), el panel vuelve a activarse y el botón se rehabilita', () => {
      const snap = mockSnapshot();
      if (snap.openSpec) {
        snap.openSpec.selectedChangeId = null;
      }
      act(() => {
        usePipelineStore.setState({
          selectedChangeId: null,
          openSpecificationId: null,
        });
      });

      const { container, rerender } = render(
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

      // Con rightOpen=true: panel ausente, botón deshabilitado
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();
      const btnInitial = screen.getByTestId('pipeline.switcher.toggle');
      expect(btnInitial.getAttribute('disabled')).not.toBeNull();

      // Rerender con rightOpen=false: panel presente, botón habilitado
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

      expect(container.querySelector('nav[class*="switcherRail"]')).toBeTruthy();
      const btnRestored = screen.getByTestId('pipeline.switcher.toggle');
      expect(btnRestored.getAttribute('disabled')).toBeNull();
      expect(btnRestored.getAttribute('aria-disabled')).toBe('false');
      expect(btnRestored.getAttribute('aria-expanded')).toBe('true');
      expect(btnRestored.getAttribute('title')).toBe('pipeline.switcher.hideNav');
    });

    it('al pasar rightOpen a verdadero, el riel sigue en el DOM en estado de plegado hasta transitionend', () => {
      const snap = mockSnapshot();
      if (snap.openSpec) {
        snap.openSpec.selectedChangeId = null;
      }
      act(() => {
        usePipelineStore.setState({
          selectedChangeId: null,
          openSpecificationId: null,
        });
      });

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

      // Con rightOpen=false: el riel está montado y visible (no plegado)
      const rail = container.querySelector('nav[class*="switcherRail"]');
      expect(rail).not.toBeNull();
      expect(rail?.getAttribute('data-folded')).toBeNull();

      // Al pasar rightOpen a true: el riel sigue montado pero en estado de plegado
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

      // Sigue en el DOM durante la animación con data-folded="true"
      const closingRail = container.querySelector('nav[class*="switcherRail"]');
      expect(closingRail).not.toBeNull();
      expect(closingRail?.getAttribute('data-folded')).toBe('true');

      // Al dispararse transitionend en el riel, se desmonta
      fireEvent.transitionEnd(closingRail!);
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();
    });

    it('si el usuario cerró voluntariamente el panel con rightOpen=false, abrir y cerrar el navegador derecho respeta su decisión manteniéndolo cerrado', () => {
      const snap = mockSnapshot();
      if (snap.openSpec) {
        snap.openSpec.selectedChangeId = null;
      }
      act(() => {
        usePipelineStore.setState({
          selectedChangeId: null,
          openSpecificationId: null,
        });
      });

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

      // Estado inicial: panel abierto
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeTruthy();
      const toggleBtn = screen.getByTestId('pipeline.switcher.toggle');

      // Usuario cierra voluntariamente el panel
      fireEvent.click(toggleBtn);
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

      // Se abre el sidebar derecho (rightOpen=true)
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
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();
      expect(toggleBtn.getAttribute('disabled')).not.toBeNull();

      // Se vuelve a cerrar el sidebar derecho (rightOpen=false): el panel NO se reactiva solo
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
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();
      expect(toggleBtn.getAttribute('disabled')).toBeNull();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

      // Si el usuario decide volver a abrirlo explícitamente, se abre
      fireEvent.click(toggleBtn);
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeTruthy();
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    });

    it('al pasar rightOpen de true a false, el riel arranca con data-folded="true" y luego pasa a desplegado', async () => {
      const snap = mockSnapshot();
      const { container, rerender } = render(
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

      // Con rightOpen=true e isSwitcherOpen=true, el riel está desmontado
      expect(container.querySelector('nav[class*="switcherRail"]')).toBeNull();

      // Al cerrar el panel derecho (rightOpen pasa de true a false), el riel se monta plegado suavemente
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

      const rail = container.querySelector('nav[class*="switcherRail"]');
      expect(rail).toBeTruthy();
      expect(rail?.getAttribute('data-folded')).toBe('true');

      // En el siguiente tick de render / raf, pasa a desplegado (sin data-folded)
      await vi.waitFor(() => {
        expect(rail?.getAttribute('data-folded')).toBeNull();
      });
    });
  });

  describe('4.15 / Observación 46: Encabezado sticky (.changeHeader) con scroll en el cuerpo', () => {
    it('el encabezado permanece fijo y opaco sobre el lienzo cuando el cuerpo se desplaza en scroll profundo', () => {
      const headerCssPath = path.resolve(process.cwd(), 'components/pipeline/sdd/SddChangeHeader.module.css');
      const headerCssContent = fs.readFileSync(headerCssPath, 'utf-8');
      const cssPath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      // 1. .changeHeader está declarado con position: sticky, top: 0, z-index >= 4 y background opaco var(--color-bg-base)
      const headerMatch = headerCssContent.match(/\.changeHeader\s*\{([^}]+)\}/);
      expect(headerMatch).not.toBeNull();
      const headerBody = headerMatch![1];
      expect(headerBody).toMatch(/position:\s*sticky/);
      expect(headerBody).toMatch(/top:\s*0/);
      expect(headerBody).toMatch(/z-index:\s*[4-9]/);
      expect(headerBody).toMatch(/background:\s*var\(--color-bg-base\)/);

      // 2. .startBody sostiene el alto del anclaje (min-height: 100%, height: auto) pero permite
      // encogerse en el eje horizontal (flex: 1 1 auto) para evitar desbordes con el navegador derecho abierto (Obs 58)
      const bodyMatch = cssContent.match(/\.startBody\s*\{([^}]+)\}/);
      expect(bodyMatch).not.toBeNull();
      const bodyCss = bodyMatch![1];
      expect(bodyCss).toMatch(/flex:\s*1\s+1\s+auto/);
      expect(bodyCss).toMatch(/min-height:\s*100%/);
      expect(bodyCss).toMatch(/height:\s*auto/);

      // 3. Montado en el DOM: .changeHeader permanece montado, visible y accesible tras scroll profundo en .center
      const { container } = renderActiveChange();
      const header = container.querySelector('[class*="changeHeader"]');
      expect(header).toBeTruthy();
      expect(header?.textContent).toContain('pipeline.openspec.change.active');

      const center = container.querySelector('[class*="center"]');
      if (center) {
        fireEvent.scroll(center, { target: { scrollTop: 3000 } });
      }

      // Sigue montado y legible
      expect(container.querySelector('[class*="changeHeader"]')).toBeTruthy();
      expect(header?.textContent).toContain('pipeline.openspec.change.active');
    });
  });

  describe('Tanda 1c: El riel flotante mide y anima igual que el panel derecho', () => {
    it('el riel toma su ancho de --right-panel-width y con rightWidth={400} la variable vale 400px', () => {
      const snap = mockSnapshot();
      const { container } = render(
        <OpenSpecDashboard
          snapshot={snap}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={true}
          leftOpen={false}
          rightOpen={false}
          leftWidth={320}
          rightWidth={400}
          onResizeLeft={() => undefined}
          onResizeRight={() => undefined}
          projection={null}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />,
      );

      const dashboard = container.querySelector('[class*="dashboard"]') as HTMLElement;
      expect(dashboard).toBeTruthy();
      expect(dashboard.style.getPropertyValue('--right-panel-width')).toBe('400px');

      const cssPath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');
      const railMatch = cssContent.match(/\.switcherRail\s*\{([^}]+)\}/);
      expect(railMatch).toBeTruthy();
      expect(railMatch![1]).toMatch(/var\(--right-panel-width,\s*320px\)/);
    });
  });
});
