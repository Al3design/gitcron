// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { clearDraftLog, setDraftLogTiming } from '@/lib/commit-draft-log';
import type { DraftChunkEvent } from '@/types/commit-message-ai';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import { RepoDetailsPanel } from '@/components/RepoDetailsPanel';
import { usePipelineStore } from '@/lib/pipeline-store';
import type { PipelineSnapshot } from '../pipeline-view-state';

/**
 * El pensamiento del modelo en el rail derecho, mientras redacta.
 *
 * Lo que se protege: que durante la espera el rail deje de estar vacío —era el
 * defecto que abrió la tarea—, que lo que llega de una redacción cancelada no se
 * mezcle con la nueva, y que el panel **no** se re-renderice con cada pedazo.
 * Ese último punto no es estilo: llegan ~8 avisos por segundo durante hasta 98
 * segundos, y el costo de re-dibujar el panel entero a ese ritmo ya se pagó una
 * vez con el temporizador de la espera.
 */

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({ stageFiles: vi.fn().mockResolvedValue(true), commitChanges: vi.fn() }),
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const catalog = vi.fn();
const draft = vi.fn();
const cancel = vi.fn();
const onChunk = vi.fn();

/** Cómo el proceso principal avisa lo que va llegando. Se guarda para dispararlo a mano. */
let emitir: ((event: DraftChunkEvent) => void) | null = null;

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
    stations: [], decisions: [], agents: [], activity: [],
    economy: { reasoningAvailable: null } as PipelineSnapshot['economy'],
    diffs: [],
    openSpec: {
      selectedChangeId: null, activeChanges: [], archivedChanges: [],
      specifications: [], reports: [], diagnostics: [],
      observedAt: null, latestGate: null,
    },
  } as PipelineSnapshot;
}

/** El rail sólo existe con la columna derecha abierta: ahí es donde va el log. */
function abrirPreparacion() {
  const snap = snapshot();
  usePipelineStore.setState({
    snapshot: snap,
  });
  render(
    <div>
      <OpenSpecDashboard
        snapshot={snap}
        repoPath="C:/repo"
        currentBranch="change/mi-cambio"
        workingTreeClean={false}
        rightOpen={true}
        projection={null} runtimeHistory={[]}
        onRefresh={() => undefined} onPauseAfterTask={() => undefined}
        onRespondDecision={() => undefined}
      />
      <RepoDetailsPanel
        activeTab="Pipeline"
        graphMode="chronometric"
        detailsW={320}
        visible={true}
        isDragging={false}
        onResizeStart={vi.fn()}
        onOpenStashModal={vi.fn()}
        onOpenCommitFile={vi.fn()}
        onSelectFile={vi.fn()}
        onDiscardRequest={vi.fn()}
        onRequestAmend={vi.fn()}
        onRequestSquash={vi.fn()}
        onFileContextMenu={vi.fn()}
        onRequestResetAll={vi.fn()}
        onRequestCleanUntracked={vi.fn()}
      />
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
}

/**
 * Pide una redacción y devuelve con qué marca quedó rotulada.
 *
 * La marca se lee del propio pedido y no se asume: es un contador de la ventana
 * que no se reinicia entre pruebas, y darla por fija haría pasar los tests por
 * el motivo equivocado.
 */
async function pedirRedaccion(): Promise<string> {
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
  await screen.findByRole('option', { name: /gemma-4-e4b/ });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'google/gemma-4-e4b' } });
  fireEvent.click(screen.getByRole('button', { name: /prepare\.aiDraft|prepare\.aiBusy/ }));
  await waitFor(() => expect(draft).toHaveBeenCalled());
  const { draftId } = draft.mock.calls.at(-1)![0] as { draftId: string };
  // El panel tiene que declararla al pedir: los pedazos empiezan a llegar
  // mientras la promesa sigue esperando.
  expect(draftId).toBeTruthy();
  return draftId;
}

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

beforeEach(() => {
  usePipelineStore.getState().reset();
  clearDraftLog();
  emitir = null;
  catalog.mockReset().mockResolvedValue({
    success: true,
    data: [{
      id: 'google/gemma-4-e4b', displayName: 'Gemma 4 E4B', kind: 'llm', loaded: true,
      loadedContextLength: 65536, maxContextLength: 131072, sizeBytes: 6326936720,
      params: '7.5B', quantization: 'Q4_K_M', reasoningDefault: 'on', reasoningCanBeOff: true,
      loadedInstanceId: 'google/gemma-4-e4b', devices: [''],
    }],
  });
  // Queda colgada a propósito: lo que se mira es lo que pasa DURANTE la espera.
  draft.mockReset().mockReturnValue(new Promise(() => undefined));
  cancel.mockReset().mockResolvedValue({ success: true, data: { cancelled: true } });
  onChunk.mockReset().mockImplementation((cb: (event: DraftChunkEvent) => void) => {
    emitir = cb;
    return () => { emitir = null; };
  });
  useGitStore.setState({
    repoPath: 'C:/repo',
    modifiedFiles: [{ path: 'components/algo.tsx', status: 'modified', staged: false }],
    commitMessage: '',
    setCommitMessage: vi.fn(),
  } as Partial<ReturnType<typeof useGitStore.getState>>);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { commitAi: { catalog, draft, cancel, onChunk, load: vi.fn(), unload: vi.fn(), deviceNames: vi.fn().mockResolvedValue({ success: true, data: {} }) } },
  });
});

afterEach(() => {
  cleanup();
  usePipelineStore.getState().reset();
  clearDraftLog();
  Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('el rail durante la redacción', () => {
  it('no muestra nada mientras no hay redacción', () => {
    abrirPreparacion();

    // Un bloque vacío permanente enseña a saltear el lugar donde después
    // aparece lo que importa.
    expect(screen.queryByText(/prepare\.aiLogTitle/)).toBeNull();
  });

  it('muestra lo que el modelo va pensando', async () => {
    abrirPreparacion();
    const marca = await pedirRedaccion();

    await waitFor(() => expect(emitir).not.toBeNull());
    act(() => {
      emitir?.({ draftId: marca, chunks: [{ kind: 'reasoning', text: 'el diff toca el proveedor' }] });
    });

    // Esto es lo que el rail no mostraba: durante 25 a 98 segundos no había nada.
    expect(await screen.findByText(/el diff toca el proveedor/)).toBeTruthy();
  });

  it('la respuesta se muestra aparte del razonamiento', async () => {
    abrirPreparacion();
    const marca = await pedirRedaccion();
    await waitFor(() => expect(emitir).not.toBeNull());

    act(() => {
      emitir?.({
        draftId: marca,
        chunks: [{ kind: 'reasoning', text: 'pensando' }, { kind: 'content', text: 'feat(x): algo' }],
      });
    });

    expect(await screen.findByText(/prepare\.aiLogAnswer/)).toBeTruthy();
    expect(screen.getByText('feat(x): algo')).toBeTruthy();
  });

  it('lo de una corrida vieja no se cuela en la nueva', async () => {
    abrirPreparacion();
    const marca = await pedirRedaccion();
    await waitFor(() => expect(emitir).not.toBeNull());

    // Lo que llega con otra marca es de un stream que quedó en vuelo después de
    // cancelar: no puede mezclarse con el de la corrida en curso.
    act(() => {
      emitir?.({ draftId: `${marca}-vieja`, chunks: [{ kind: 'reasoning', text: 'FANTASMA' }] });
      emitir?.({ draftId: marca, chunks: [{ kind: 'reasoning', text: 'lo actual' }] });
    });

    expect(await screen.findByText(/lo actual/)).toBeTruthy();
    expect(screen.queryByText(/FANTASMA/)).toBeNull();
  });

  it('el conteo de tokens explica la espera', async () => {
    abrirPreparacion();
    const marca = await pedirRedaccion();
    await waitFor(() => expect(emitir).not.toBeNull());

    act(() => {
      setDraftLogTiming(marca, { startedAt: 1000, finishedAt: 15000 });
      emitir?.({
        draftId: marca,
        chunks: [
          { kind: 'reasoning', text: 'pensé mucho' },
          { kind: 'done', finishReason: 'stop', usage: { promptTokens: 4649, cachedPromptTokens: null, completionTokens: 311, reasoningTokens: 278 } },
        ],
      });
    });

    // Sin este número, «tardó 98 segundos» no dice por qué.
    expect(await screen.findByText(/278/)).toBeTruthy();
  });

  it('un fallo del servidor se muestra tal cual, y no como «no contestó»', async () => {
    const ERROR = 'decode() failed: vk::Device::getFenceStatus: ErrorDeviceLost';
    // El caso REAL y completo: el error llega por el stream **y** la promesa
    // termina en `unavailable` con el mismo motivo. Con el `draft` colgado no
    // habría aviso, y la prueba del duplicado pasaría sin probar nada.
    draft.mockReturnValue(Promise.resolve({
      success: true,
      data: { status: 'unavailable', detail: ERROR },
    }));
    abrirPreparacion();
    const marca = await pedirRedaccion();
    await waitFor(() => expect(emitir).not.toBeNull());

    act(() => {
      emitir?.({ draftId: marca, chunks: [{ kind: 'error', detail: ERROR }] });
    });

    // El motivo crudo es la única pista que sirve para buscar el problema:
    // suavizarlo dejaría a quien lo lee sin saber que se cayó la placa.
    expect(await screen.findByText(/ErrorDeviceLost/)).toBeTruthy();
    // Y arriba, qué pasó y qué hacer. Sin esto el aviso es correcto e inútil:
    // Ale lo marcó viendo «vk::Device::getFenceStatus» en pantalla.
    // Una sola vez: el aviso general y el bloque del error decían lo mismo, uno
    // encima del otro. Sobra el general, porque el otro trae además el motivo.
    expect(screen.getAllByText(/aiAdviceDeviceLost/)).toHaveLength(1);
  });

  it('un error que no se reconoce no inventa un consejo', async () => {
    abrirPreparacion();
    const marca = await pedirRedaccion();
    await waitFor(() => expect(emitir).not.toBeNull());

    act(() => {
      emitir?.({ draftId: marca, chunks: [{ kind: 'error', detail: 'algo que nunca vimos' }] });
    });

    expect(await screen.findByText(/algo que nunca vimos/)).toBeTruthy();
    expect(screen.queryByText(/aiAdvice/)).toBeNull();
  });

  it('se da de baja del canal al cerrar el panel', async () => {
    abrirPreparacion();
    await pedirRedaccion();
    await waitFor(() => expect(emitir).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /prepare\.close/ }));

    // Sin la baja, el canal sigue vivo con el panel cerrado y no hay nadie que
    // pueda pedir una redacción.
    await waitFor(() => expect(emitir).toBeNull());
  });
});

describe('dónde vive el aviso de la redacción', () => {
  /** Una redacción que termina de verdad: el aviso sale de su resultado. */
  function draftQueContesta() {
    draft.mockReturnValue(Promise.resolve({
      success: true,
      data: { status: 'drafted', subject: 'feat(x): algo', model: 'google/gemma-4-e4b' },
    }));
  }

  it('con el rail a la vista, va al rail y no se repite en el centro', async () => {
    draftQueContesta();
    abrirPreparacion();
    await pedirRedaccion();

    // La rotulación de autoría: quien confirma tiene que ver que lo escribió un
    // modelo. Antes estaba en las dos columnas a la vez, diciendo lo mismo.
    const avisos = await screen.findAllByText(/prepare\.aiWrote/);
    expect(avisos).toHaveLength(1);
  });

  it('con el rail cerrado NO desaparece: vuelve al centro', async () => {
    draftQueContesta();
    render(
      <OpenSpecDashboard
        snapshot={snapshot()}
        repoPath="C:/repo"
        currentBranch="change/mi-cambio"
        workingTreeClean={false}
        leftOpen={false} rightOpen={false} leftWidth={320} rightWidth={320}
        onResizeLeft={() => undefined} onResizeRight={() => undefined}
        projection={null} runtimeHistory={[]}
        onRefresh={() => undefined} onPauseAfterTask={() => undefined}
        onRespondDecision={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /openspec\.prepare\.open/ }));
    await pedirRedaccion();

    // No puede perderse porque alguien plegó un panel: es la declaración de que
    // el mensaje no lo escribió la aplicación.
    expect(await screen.findByText(/prepare\.aiWrote/)).toBeTruthy();
  });
});

describe('cuando el contexto elegido no alcanza', () => {
  /** Un modelo en disco: es el único caso donde se ofrece cargarlo. */
  function catalogoEnDisco() {
    catalog.mockResolvedValue({
      success: true,
      data: [{
        id: 'google/gemma-4-e4b', displayName: 'Gemma 4 E4B', kind: 'llm', loaded: false,
        loadedContextLength: null, maxContextLength: 131072, sizeBytes: 6326936720,
        params: '7.5B', quantization: 'Q4_K_M', reasoningDefault: 'on', reasoningCanBeOff: true,
        loadedInstanceId: null, devices: [''],
      }],
    });
  }

  it('explica qué falta en vez de apagarse en silencio', async () => {
    catalogoEnDisco();
    abrirPreparacion();
    const contexto = await screen.findByLabelText(/aiContextLabel|Contexto/i).catch(() => null)
      ?? screen.getAllByRole('spinbutton')[0];

    // 16.328 fue el número real que puso Ale para que la placa aguantara: quedó
    // por debajo del piso y el botón se puso gris sin decir nada.
    fireEvent.change(contexto, { target: { value: '16328' } });

    expect(await screen.findByText(/aiContextTooLow/)).toBeTruthy();
  });

  it('con un contexto válido no hay nada que explicar', async () => {
    catalogoEnDisco();
    abrirPreparacion();
    const contexto = (await screen.findAllByRole('spinbutton'))[0];

    fireEvent.change(contexto, { target: { value: '16384' } });

    expect(screen.queryByText(/aiContextTooLow/)).toBeNull();
  });

  it('el estado declara los valores ELEGIDOS, no unos escritos a mano', async () => {
    catalogoEnDisco();
    abrirPreparacion();
    const campos = await screen.findAllByRole('spinbutton');

    fireEvent.change(campos[0], { target: { value: '32768' } });
    fireEvent.change(campos[1], { target: { value: '5' } });

    // Decía «se va a cargar con 65536» con el campo en otra cosa, y «tras media
    // hora sin uso» con el TTL en 5 minutos. Esta frase promete lo que va a
    // hacer, así que tiene que leer de donde salen los valores.
    const estado = await screen.findByText(/aiFactOnDisk/);
    expect(estado.textContent).toContain('32768');
    expect(estado.textContent).toContain('"minutes":5');
  });
});

describe('alto acotado y control de despliegue en la bitácora (4.21)', () => {
  it('no muestra degradado ni botón de desplegar cuando el razonamiento no desborda', async () => {
    // En jsdom configuramos getters para simular que el contenido cabe dentro de la altura visible
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

    try {
      abrirPreparacion();
      const marca = await pedirRedaccion();
      await waitFor(() => expect(emitir).not.toBeNull());

      act(() => {
        emitir?.({ draftId: marca, chunks: [{ kind: 'reasoning', text: 'razonamiento corto' }] });
      });

      expect(await screen.findByText(/razonamiento corto/)).toBeTruthy();

      // No debe existir el botón de desplegar/plegar
      expect(screen.queryByRole('button', { name: /aiLogExpand|aiLogCollapse/ })).toBeNull();
      // El pre no tiene data-expanded
      const pre = screen.getByText('razonamiento corto');
      expect(pre.getAttribute('data-expanded')).toBeNull();
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
  });

  it('presenta el control sólo cuando el razonamiento desborda y al accionarlo retira el tope de altura', async () => {
    // En jsdom configuramos getters para simular que el razonamiento desborda la caja (scrollHeight > clientHeight)
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 500 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 });

    try {
      abrirPreparacion();
      const marca = await pedirRedaccion();
      await waitFor(() => expect(emitir).not.toBeNull());

      act(() => {
        emitir?.({ draftId: marca, chunks: [{ kind: 'reasoning', text: 'razonamiento largo que desborda el recuadro' }] });
      });

      expect(await screen.findByText(/razonamiento largo que desborda/)).toBeTruthy();

      // 1. Desborda: aparece el botón para desplegar
      const toggleBtn = await screen.findByRole('button', { name: /aiLogExpand/ });
      expect(toggleBtn).toBeTruthy();

      const pre = screen.getByText('razonamiento largo que desborda el recuadro');
      // Inicialmente plegado
      expect(pre.getAttribute('data-expanded')).toBeNull();

      // 2. Al hacer clic, se despliega
      fireEvent.click(toggleBtn);

      // El botón ahora dice plegar
      expect(screen.getByRole('button', { name: /aiLogCollapse/ })).toBeTruthy();
      // El pre ahora declara data-expanded="true" para retirar el tope de altura
      expect(pre.getAttribute('data-expanded')).toBe('true');

      // 3. Al volver a hacer clic, se pliega de nuevo
      fireEvent.click(toggleBtn);
      expect(screen.getByRole('button', { name: /aiLogExpand/ })).toBeTruthy();
      expect(pre.getAttribute('data-expanded')).toBeNull();
    } finally {
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
  });

  it('declara alto fijo (8rem) en la hoja de estilos y degradado inferior (4.24)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const cssPath = path.resolve(__dirname, '../OpenSpecDashboard.module.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // 1. draftLogStream declara alto FIJO (8rem), overflow hidden, y NO max-height (4.24)
    expect(cssContent).toMatch(/\.draftLogStream\s*\{[^}]*height:\s*8rem/);
    expect(cssContent).not.toMatch(/\.draftLogStream\s*\{[^}]*max-height:/);
    expect(cssContent).toMatch(/\.draftLogStream\s*\{[^}]*overflow:\s*hidden/);

    // 2. draftLogStream[data-expanded='true'] pasa a height: auto (4.24)
    expect(cssContent).toMatch(/\.draftLogStream\[data-expanded='true'\]\s*\{[^}]*height:\s*auto/);

    // 3. draftLogFade declara degradado hacia el fondo y se ancla en el borde inferior (bottom: 0) (4.24)
    expect(cssContent).toMatch(/\.draftLogFade\s*\{[^}]*background:\s*linear-gradient\(to bottom,\s*transparent/);
    expect(cssContent).toMatch(/\.draftLogFade\s*\{[^}]*bottom:\s*0/);
    expect(cssContent).not.toMatch(/\.draftLogFade\s*\{[^}]*top:\s*0/);
  });
});
