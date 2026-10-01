// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeProjection } from '@/types/pipeline';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

/**
 * La preparación del commit vive a nivel del repositorio.
 *
 * Reemplaza al test de la pestaña Commit, que cubría una superficie encerrada
 * dentro del cambio seleccionado. El defecto que ese nivel producía era
 * concreto: después de archivar quedan `openspec/changes/archive/…` y
 * `openspec/specs/…` sin confirmar, el cambio ya no está activo, y para
 * prepararlos había que entrar a un cambio ajeno —o no había ninguno al que
 * entrar—. El caso de cero cambios activos es el que guarda esa regresión.
 */

const stageFiles = vi.fn().mockResolvedValue(true);
const setCommitMessage = vi.fn();

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({ stageFiles, commitChanges: vi.fn() }),
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

function task(id: string, completed: boolean) {
  return { id, text: `${id} tarea ${id}`, completed, line: 1, sourceRef: 'tasks.md:1' };
}

/** Snapshot con los cambios activos que se le pasen. Sin ninguno, es válido. */
function snapshot(changeIds: string[]): PipelineSnapshot {
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
      selectedChangeId: changeIds[0] ?? null,
      activeChanges: changeIds.map((changeId) => ({
        changeId,
        intent: 'una intención',
        tasks: [task('1.1', false)],
        proposalExists: true,
        designExists: true,
        specsCount: 1,
        validation: 'unknown',
        artifacts: null,
      })),
      archivedChanges: [],
      specifications: [],
      reports: [],
      diagnostics: [],
      observedAt: null,
      latestGate: null,
    },
  } as PipelineSnapshot;
}

function renderDashboard(changeIds: string[] = ['demo-change']) {
  return render(
    <OpenSpecDashboard
      snapshot={snapshot(changeIds)}
      repoPath="C:/repo"
      currentBranch="main"
      workingTreeClean={false}
      leftOpen={false}
      rightOpen={false}
      leftWidth={320}
      rightWidth={320}
      onResizeLeft={() => undefined}
      onResizeRight={() => undefined}
      projection={null as RuntimeProjection | null}
      runtimeHistory={[]}
      onRefresh={() => undefined}
      onPauseAfterTask={() => undefined}
      onRespondDecision={() => undefined}
    />,
  );
}

/** El panel se abre desde el estado del árbol, que es lo único del encabezado
 *  que ya habla del repositorio entero. */
const openPrepare = () => fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

function setModified(files: Array<{ path: string; staged: boolean }>) {
  useGitStore.setState({
    modifiedFiles: files.map((file) => ({ ...file, status: 'modified' })),
    commitMessage: '',
    setCommitMessage,
  } as Partial<ReturnType<typeof useGitStore.getState>>);
}

beforeEach(() => {
  usePipelineStore.getState().reset();
  stageFiles.mockClear();
  setCommitMessage.mockClear();
  setModified([
    { path: 'openspec/changes/demo-change/tasks.md', staged: false },
    { path: 'openspec/changes/otro-cambio/proposal.md', staged: false },
    { path: 'components/algo.tsx', staged: false },
  ]);
  Object.defineProperty(window, 'api', { configurable: true, value: {} });
});

afterEach(() => {
  cleanup();
  usePipelineStore.getState().reset();
  useGitStore.setState({ modifiedFiles: [], commitMessage: '' });
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('preparación a nivel del repositorio', { timeout: 15_000 }, () => {
  it('se alcanza sin ningún cambio activo', async () => {
    // El caso que motivó subir el commit de nivel: sólo quedan los restos de un
    // archivado y no hay ningún cambio desde el cual mirar.
    setModified([
      { path: 'openspec/changes/archive/2026-08-01-viejo/tasks.md', staged: false },
      { path: 'openspec/specs/una-capacidad/spec.md', staged: false },
    ]);
    renderDashboard([]);

    openPrepare();

    // El rótulo del grupo lleva la cuenta entre paréntesis; su descripción es
    // otro nodo con la misma raíz de clave, así que se busca el rótulo exacto.
    expect(screen.getByText(/^pipeline\.openspec\.prepare\.groupArchived \(/)).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);

    for (const box of boxes) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.action/ }));

    await vi.waitFor(() => expect(stageFiles).toHaveBeenCalledWith([
      'openspec/changes/archive/2026-08-01-viejo/tasks.md',
      'openspec/specs/una-capacidad/spec.md',
    ], true));
  });

  it('no está abierta hasta que se pide, y no ocupa una pestaña', () => {
    renderDashboard();

    expect(screen.queryByRole('button', { name: /openspec\.prepare\.action/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /openspec\.tabs\.commit/ })).toBeNull();

    openPrepare();
    expect(screen.getByRole('button', { name: /openspec\.prepare\.action/ })).toBeTruthy();
  });

  it('ningún grupo entra preseleccionado', () => {
    // Sin un cambio de referencia no hay criterio para privilegiar uno, y
    // hacerlo produciría un commit distinto según dónde estuviera el foco.
    renderDashboard();
    openPrepare();

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((box) => !box.checked)).toBe(true);
    // Sin nada elegido, preparar se anuncia deshabilitada pero sigue alcanzable
    // con el teclado: con el `disabled` nativo salía del orden de foco, y el
    // panel se abre justo en este estado.
    const action = screen.getByRole('button', { name: /openspec\.prepare\.action/ });
    expect(action.getAttribute('aria-disabled')).toBe('true');
    expect((action as HTMLButtonElement).disabled).toBe(false);
  });

  it('preparar sin archivos elegidos no envía nada', () => {
    // La garantía real detrás del estado deshabilitado: alcanzable no es
    // accionable.
    renderDashboard();
    openPrepare();

    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.action/ }));
    expect(stageFiles).not.toHaveBeenCalled();
  });

  it('el control de sumar todos alcanza al total y el de cada grupo sólo al suyo', () => {
    renderDashboard();
    openPrepare();

    const boxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[];
    // El primero de la lista es el del encabezado, que opera sobre el total; los
    // que siguen pertenecen a cada grupo.
    fireEvent.click(screen.getAllByRole('button', { name: /openspec\.prepare\.selectAll/ })[0]);
    expect(boxes().every((box) => box.checked)).toBe(true);

    fireEvent.click(screen.getAllByRole('button', { name: /openspec\.prepare\.deselectAll/ })[0]);
    expect(boxes().every((box) => !box.checked)).toBe(true);

    // El control del primer grupo suma sólo su archivo.
    fireEvent.click(screen.getAllByRole('button', { name: /openspec\.prepare\.selectAll/ })[1]);
    expect(boxes().filter((box) => box.checked)).toHaveLength(1);
  });

  it('agrupa por procedencia, nombra el cambio y muestra el estado de cada archivo', () => {
    setModified([
      { path: 'openspec/changes/demo-change/tasks.md', staged: false },
      { path: 'openspec/changes/otro-cambio/proposal.md', staged: false },
      { path: 'openspec/changes/archive/2026-08-01-viejo/tasks.md', staged: false },
      { path: 'components/algo.tsx', staged: false },
    ]);
    renderDashboard();
    openPrepare();

    // Cada cambio tiene su propio grupo, rotulado con su identificador: no hay
    // uno propio y una bolsa ajena.
    expect(screen.getByText(/groupChange.*demo-change/)).toBeTruthy();
    expect(screen.getByText(/groupChange.*otro-cambio/)).toBeTruthy();
    expect(screen.getByText(/^pipeline\.openspec\.prepare\.groupArchived \(/)).toBeTruthy();
    expect(screen.getByText(/^pipeline\.openspec\.prepare\.groupUnattributed \(/)).toBeTruthy();
    // Cada grupo declara además qué contiene: un rótulo solo no permite auditarlo.
    expect(screen.getAllByText('pipeline.openspec.prepare.groupChangeHelp')).toHaveLength(2);
    expect(screen.getByText(/groupArchivedHelp.*"change":"viejo"/)).toBeTruthy();
    expect(screen.getByText('pipeline.openspec.prepare.groupUnattributedHelp')).toBeTruthy();
    // Y el estado de cada archivo se lee con palabra, sin pasar el mouse.
    expect(screen.getAllByText('pipeline.openspec.prepare.state.modified')).toHaveLength(4);
  });

  it('el tipo de archivo se declara sólo donde no hay otra información', () => {
    setModified([
      { path: 'openspec/changes/demo-change/tasks.md', staged: false },
      { path: 'components/algo.tsx', staged: false },
      { path: 'lib/__tests__/algo.test.ts', staged: false },
      { path: 'docs/reports/algo.md', staged: false },
    ]);
    renderDashboard();
    openPrepare();

    // En el grupo sin atribuir, que es donde la procedencia no dice nada.
    expect(screen.getByText('pipeline.openspec.prepare.kind.code')).toBeTruthy();
    expect(screen.getByText('pipeline.openspec.prepare.kind.test')).toBeTruthy();
    expect(screen.getByText('pipeline.openspec.prepare.kind.docs')).toBeTruthy();
    // En el del cambio no: repetirlo por fila sería ruido sobre lo que el grupo
    // ya dijo una vez.
    expect(screen.queryByText('pipeline.openspec.prepare.kind.artifact')).toBeNull();
  });

  it('el mensaje sugerido deja de nombrar un cambio cuando la elección mezcla dos', () => {
    renderDashboard();
    openPrepare();

    const field = () => screen.getByRole('textbox') as HTMLInputElement;
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // La sugerencia se lee del `placeholder` y ya no del `value`.
    //
    // Antes el valor era `commitMessage || sugerencia`, así que la propuesta se
    // veía como texto escrito sin serlo —el estado estaba vacío— y borrar el
    // campo a mano la reponía sola: era imposible dejarlo en blanco para
    // escribir otro. Ale lo encontró queriendo poner el suyo. Lo que se afirma
    // sigue siendo lo mismo: qué sugiere el panel según lo elegido.
    fireEvent.click(boxes[0]);
    expect(field().placeholder).toBe('chore: demo-change');
    expect(field().value).toBe('');

    // Al sumar el artefacto del otro cambio, la descripción se vacía. Es la
    // señal de que el commit está mezclando trabajos, y llega antes de confirmar.
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(field().placeholder).toBe('chore: ');
  });

  it('lo que se borra a mano queda borrado y no se repone solo', async () => {
    renderDashboard();
    openPrepare();
    const field = () => screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    // `setCommitMessage` está mockeado en esta suite, así que el estado se
    // simula igual que en la prueba de al lado: lo que se afirma es cómo se
    // pinta el campo para un estado dado, que es donde vivía el defecto.
    useGitStore.setState({ commitMessage: 'feat: lo mío' });
    await vi.waitFor(() => expect(field().value).toBe('feat: lo mío'));

    // Vaciarlo lo deja vacío. Con la sugerencia en el `value`, este mismo estado
    // pintaba «chore: demo-change» y no había forma de escribir uno propio desde
    // cero: borrar todo la reponía sola.
    useGitStore.setState({ commitMessage: '' });
    await vi.waitFor(() => expect(field().value).toBe(''));
    // La sugerencia se sigue ofreciendo, pero como propuesta y no como texto.
    expect(field().placeholder).toBe('chore: demo-change');
  });

  it('el mensaje se corrige en el panel y es el que queda para confirmar', async () => {
    // Era un texto de sólo lectura: obligaba a recordar la corrección hasta la
    // vista de Commit. Una sola fuente, así lo que se lee es lo que se confirma.
    renderDashboard();
    openPrepare();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fix(pipeline): lo escribí yo' } });
    expect(setCommitMessage).toHaveBeenCalledWith('fix(pipeline): lo escribí yo');

    // Y la sugerencia no lo pisa al cambiar la selección.
    useGitStore.setState({ commitMessage: 'fix(pipeline): lo escribí yo' });
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    await vi.waitFor(() => expect((screen.getByRole('textbox') as HTMLInputElement).value)
      .toBe('fix(pipeline): lo escribí yo'));
  });

  it('la franja de identidad declara la rama junto al control de preparación, sin duplicarla en el botón', () => {
    // La rama es el destino del commit: se lee en la misma franja de identidad
    // que la acción de preparar commit (a la izquierda), pero ya no dentro del
    // botón, para no duplicar el dato en la misma línea.
    renderDashboard();

    const header = screen.getByTestId('content-header');
    const control = screen.getByRole('button', { name: /openspec\.prepare\.open/ });

    // 1. La franja de identidad contiene la rama actual
    expect(header.textContent).toContain('main');

    // 2. La franja de identidad contiene el control de preparación
    expect(header.contains(control)).toBe(true);
    expect(control.textContent).toContain('pipeline.openspec.prepare.open');

    // 3. El botón NO contiene la rama
    expect(control.textContent).not.toContain('main');

    // 4. La rama aparece UNA sola vez en la franja de identidad (contando nodos)
    const branchElements = Array.from(header.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && el.textContent === 'main',
    );
    expect(branchElements).toHaveLength(1);
  });

  it('declara la rama a la que va el commit', () => {
    // Un commit lo definen tres cosas: qué archivos, con qué mensaje y a qué
    // rama. La tercera no estaba en la superficie donde se deciden las otras.
    renderDashboard();
    openPrepare();

    expect(screen.getByText(/openspec\.prepare\.toBranch.*"branch":"main"/)).toBeTruthy();
  });

  it('sin archivos por preparar muestra el resumen en vez de la lista', async () => {
    renderDashboard();
    openPrepare();
    // Todo preparado: el watcher los reporta ya en staged, así que la
    // derivación los saca del cálculo y no queda nada pendiente.
    setModified([
      { path: 'openspec/changes/demo-change/tasks.md', staged: true },
      { path: 'components/algo.tsx', staged: true },
    ]);

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /openspec\.prepare\.action/ })).toBeNull();
    });
    expect(screen.getByText(/openspec\.prepare\.empty/)).toBeTruthy();
  });
});
