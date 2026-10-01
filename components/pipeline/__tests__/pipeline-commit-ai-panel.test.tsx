// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

/**
 * Redactar el asunto del commit con un modelo local, desde el panel.
 *
 * Lo que se protege acá no es que funcione, sino **cómo lo dice**: que el
 * mensaje quede rotulado como escrito por un modelo y no por la aplicación, que
 * «no contestó» no se confunda con «contestó vacío», y que una frase de espera
 * no termine nunca siendo el mensaje del commit.
 */

const setCommitMessage = vi.fn();

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({ stageFiles: vi.fn().mockResolvedValue(true), commitChanges: vi.fn() }),
}));

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const catalog = vi.fn();
const draft = vi.fn();
const load = vi.fn();
const cancel = vi.fn();
const unload = vi.fn();
const deviceNames = vi.fn();

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

function abrirPreparacion() {
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
}

/** Elegir al menos un archivo: sin nada elegido no hay nada que describir. */
function elegirTodo() {
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
}

/** Elegir el modelo: nada viene puesto de antemano, esa decisión es de la persona. */
async function elegirModelo(id = 'google/gemma-4-12b') {
  await screen.findByRole('option', { name: new RegExp(id) });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
}

const botonRedactar = () => screen.getByRole('button', { name: /prepare\.aiDraft|prepare\.aiBusy/ });

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

beforeEach(() => {
  usePipelineStore.getState().reset();
  setCommitMessage.mockClear();
  catalog.mockReset().mockResolvedValue({
    success: true,
    data: [
      { id: 'google/gemma-4-12b', displayName: 'Gemma 4 12B', kind: 'llm', loaded: true, loadedContextLength: 69120, maxContextLength: 262144, sizeBytes: 7556574286, params: '12B', quantization: 'Q4_K_M', reasoningDefault: 'on', reasoningCanBeOff: true, loadedInstanceId: 'google/gemma-4-12b', devices: ['4f814c48de176d603d6e0efb16617c71'] },
      { id: 'ornith-1.0-9b', displayName: 'Ornith 9B', kind: 'llm', loaded: false, loadedContextLength: null, maxContextLength: 262144, sizeBytes: 5630000000, params: '9B', quantization: 'Q4_K_M', reasoningDefault: 'on', reasoningCanBeOff: false, loadedInstanceId: null, devices: [''] },
      { id: 'text-embedding-nomic', displayName: 'Nomic', kind: 'embedding', loaded: false, loadedContextLength: null, maxContextLength: 2048, sizeBytes: null, params: null, quantization: null, reasoningDefault: null, reasoningCanBeOff: false, loadedInstanceId: null, devices: [] },
      { id: 'custom-vision-model', displayName: 'Vision', kind: 'vlm', loaded: false, loadedContextLength: null, maxContextLength: 4096, sizeBytes: null, params: null, quantization: null, reasoningDefault: null, reasoningCanBeOff: false, loadedInstanceId: null, devices: [] },
    ],
  });
  draft.mockReset();
  load.mockReset().mockResolvedValue({ success: true, data: { output: '' } });
  cancel.mockReset().mockResolvedValue({ success: true, data: { cancelled: true } });
  unload.mockReset().mockResolvedValue({ success: true, data: { unloaded: true } });
  deviceNames.mockReset().mockResolvedValue({ success: true, data: {} });
  useGitStore.setState({
    modifiedFiles: [{ path: 'components/algo.tsx', status: 'modified', staged: false }],
    commitMessage: '',
    setCommitMessage,
  } as Partial<ReturnType<typeof useGitStore.getState>>);
  Object.defineProperty(window, 'api', { configurable: true, value: { commitAi: { catalog, draft, load, cancel, unload, deviceNames } } });
});

afterEach(() => {
  cleanup();
  usePipelineStore.getState().reset();
  useGitStore.setState({ modifiedFiles: [], commitMessage: '' });
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('el selector de modelos', { timeout: 15_000 }, () => {
  it('muestra el estado y el contexto real de cada uno', async () => {
    abrirPreparacion();

    // El contexto que se declara es el de la carga, no el máximo del modelo:
    // medido, uno con máximo 262144 estaba cargado con 69120.
    const cargado = await screen.findByRole('option', { name: /gemma-4-12b · 69120/ });
    expect(cargado).toBeTruthy();
    // Elegir uno en disco significa esperar la carga, y eso se dice antes.
    expect(screen.getByRole('option', { name: /ornith.*aiNotLoaded/ })).toBeTruthy();
  });

  it('arranca sin nada elegido', async () => {
    // Elegir el modelo es de la persona: está medido que la función sirve o no
    // según cuál sea. Dejar uno puesto convertiría esa decisión en un descuido.
    abrirPreparacion();
    await screen.findByRole('option', { name: /gemma-4-12b/ });

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect((botonRedactar() as HTMLButtonElement).disabled).toBe(true);
  });

  it('dice en qué máquina vive cada modelo', async () => {
    // Con LM Link la inferencia puede correr en otra computadora sin que nada lo
    // diga: medido, 13 de los 16 modelos de Ale viven en la PC con la placa, y
    // los 25–47 segundos de redacción ya corrían del otro lado.
    abrirPreparacion();

    expect(await screen.findByRole('option', { name: /gemma-4-12b.*aiDeviceOther/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /ornith.*aiDeviceHere/ })).toBeTruthy();
  });

  it('usa el nombre de la máquina cuando se resuelve', async () => {
    // «Ale-CasaNew» en vez de «4f814c…». El nombre llega por su propio canal
    // porque cuesta un proceso —300 a 700 ms medidos— y el catálogo sale en 42
    // ms: mezclarlos haría que abrir el panel pague el proceso.
    deviceNames.mockResolvedValue({
      success: true,
      data: { '': 'Ale-Book', '4f814c48de176d603d6e0efb16617c71': 'Ale-CasaNew' },
    });
    abrirPreparacion();

    expect(await screen.findByRole('option', { name: /gemma-4-12b.*Ale-CasaNew/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /ornith.*Ale-Book/ })).toBeTruthy();
  });

  it('sin el dato no dice «esta máquina» por omisión', async () => {
    // No saber no es lo mismo que saber que no. Si el servidor no contesta el
    // canal, el modelo se muestra sin dispositivo en vez de inventarle uno.
    catalog.mockResolvedValue({
      success: true,
      data: [{
        id: 'solo', displayName: 'Solo', kind: 'llm', loaded: false, loadedContextLength: null,
        maxContextLength: 4096, sizeBytes: null, params: null, quantization: null,
        reasoningDefault: null, reasoningCanBeOff: false, loadedInstanceId: null, devices: [],
      }],
    });
    abrirPreparacion();

    const opcion = await screen.findByRole('option', { name: /solo/ });
    expect(opcion.textContent).not.toMatch(/aiDevice/);
  });

  it('deja afuera los de embeddings y tipos no-llm, que no redactan nada', async () => {
    abrirPreparacion();
    await screen.findByRole('option', { name: /gemma-4-12b/ });
    expect(screen.queryByRole('option', { name: /nomic/i })).toBeNull();
    expect(screen.queryByRole('option', { name: /vision/i })).toBeNull();
  });

  it('sin servidor local lo dice y no ofrece redactar', async () => {
    // La preparación sigue funcionando sin IA, igual que Cartografía.
    catalog.mockRejectedValue(new Error('fetch failed'));
    abrirPreparacion();
    elegirTodo();

    expect(await screen.findByRole('option', { name: /aiNoModels/ })).toBeTruthy();
    expect((botonRedactar() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('lo que devuelve el modelo', () => {
  it('el asunto redactado se escribe y queda rotulado con el modelo', async () => {
    draft.mockResolvedValue({
      success: true,
      data: { status: 'drafted', subject: 'feat(pipeline): atribuir por la rama', model: 'google/gemma-4-12b' },
    });
    abrirPreparacion();
    await elegirModelo();
    elegirTodo();
    fireEvent.click(botonRedactar());

    await vi.waitFor(() => expect(setCommitMessage).toHaveBeenCalledWith('feat(pipeline): atribuir por la rama'));
    // Quien confirma tiene que poder ver que esto lo escribió un modelo.
    expect(await screen.findByText(/prepare\.aiWrote.*gemma-4-12b/)).toBeTruthy();
  });

  it('«no contestó» por presupuesto se explica como tal, y no pisa el mensaje', async () => {
    // Decir «devolvió un mensaje vacío» haría pensar que la función está rota
    // cuando lo que falta es techo de tokens.
    draft.mockResolvedValue({
      success: true,
      data: { status: 'no-answer', reason: 'budget', model: 'qwen/qwen3.5-9b' },
    });
    abrirPreparacion();
    await elegirModelo();
    elegirTodo();
    fireEvent.click(botonRedactar());

    expect(await screen.findByText(/prepare\.aiNoAnswerBudget/)).toBeTruthy();
    expect(setCommitMessage).not.toHaveBeenCalled();
  });

  it('un fallo se declara con su motivo y deja el mensaje como estaba', async () => {
    draft.mockResolvedValue({ success: false, error: 'servidor caído' });
    abrirPreparacion();
    await elegirModelo();
    elegirTodo();
    fireEvent.click(botonRedactar());

    expect(await screen.findByText(/prepare\.aiFailed/)).toBeTruthy();
    expect(setCommitMessage).not.toHaveBeenCalled();
  });
});

describe('cargar el modelo desde el panel', () => {
  it('con uno en disco ofrece cargarlo, en vez de dejar el callejón sin salida', async () => {
    // Ale lo encontró validando: el aviso de contexto insuficiente explicaba el
    // problema y no daba la salida, con `commit-ai:load` construido y sin
    // conectar.
    abrirPreparacion();
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'ornith-1.0-9b' } });

    expect(screen.getByRole('button', { name: /prepare\.aiLoad$|prepare\.aiLoad:/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /prepare\.aiDraft/ })).toBeNull();
  });

  it('declara lo que va a ocupar antes de que nadie lo apriete', async () => {
    // Cargar toma GB de VRAM. El costo sale del propio catálogo —`sizeBytes`,
    // medido igual a lo que estimaba el CLI— así que puede estar a la vista sin
    // un paso de estimación aparte.
    abrirPreparacion();
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'ornith-1.0-9b' } });

    expect(screen.getByText('5.24 GiB')).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
  });

  it('declara si el modelo razona, que es lo que decide si va a contestar', async () => {
    // Es la explicación del modo de fallo más caro medido: gasta el presupuesto
    // pensando y devuelve vacío.
    abrirPreparacion();
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'ornith-1.0-9b' } });

    expect(screen.getByText(/prepare\.aiFactReasons/)).toBeTruthy();
  });

  it('carga con el contexto pedido y relee el catálogo', async () => {
    abrirPreparacion();
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'ornith-1.0-9b' } });
    catalog.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /prepare\.aiLoad$|prepare\.aiLoad:/ }));

    // El contexto y el TTL viajan con la carga: los dos se fijan ahí y no se
    // pueden cambiar después.
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith('ornith-1.0-9b', undefined, 65536, 1800));
    // Sin releer, el desplegable seguiría diciendo «en disco» sobre un modelo
    // que ya está cargado.
    await vi.waitFor(() => expect(catalog).toHaveBeenCalled());
  });
});

describe('las fases, que Ale pidió separadas', () => {
  it('las frases de espera NO aparecen mientras carga el modelo', async () => {
    // Eran un solo booleano para las dos operaciones, así que arrancaban en la
    // carga. Ale lo marcó: tienen que aparecer al apretar «Redactar con IA».
    load.mockReturnValue(new Promise(() => undefined));
    abrirPreparacion();
    await elegirModelo('ornith-1.0-9b');
    fireEvent.click(screen.getByRole('button', { name: /prepare\.aiLoad/ }));

    expect(await screen.findByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText(/thoughts\./)).toBeNull();
  });

  it('la barra NO aparece mientras redacta, y el contador sí', async () => {
    draft.mockReturnValue(new Promise(() => undefined));
    abrirPreparacion();
    await elegirModelo();
    elegirTodo();
    fireEvent.click(botonRedactar());

    await vi.waitFor(() => expect(screen.getByText(/aiElapsedDrafting/)).toBeTruthy());
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('la salida manual', () => {
  it('ofrece descargar el modelo cuando está cargado', async () => {
    // GitCron tomaba 7 GB de la placa y no daba ninguna salida: había que
    // esperar el TTL o ir a LM Studio. Ale lo pidió.
    abrirPreparacion();
    await elegirModelo();

    fireEvent.click(screen.getByRole('button', { name: /prepare\.aiEject/ }));
    await vi.waitFor(() => expect(unload).toHaveBeenCalledWith('google/gemma-4-12b'));
  });

  it('no la ofrece si el modelo está en disco: no hay nada que descargar', async () => {
    abrirPreparacion();
    await elegirModelo('ornith-1.0-9b');
    expect(screen.queryByRole('button', { name: /prepare\.aiEject/ })).toBeNull();
  });
});

describe('cancelar', () => {
  it('corta la petición del otro lado, no sólo descarta la respuesta', async () => {
    // Un control que dice cancelar y no cancela es peor que no tenerlo: el
    // modelo seguía trabajando y ocupando la placa después de apretarlo.
    draft.mockReturnValue(new Promise(() => undefined));
    abrirPreparacion();
    await elegirModelo();
    elegirTodo();
    fireEvent.click(botonRedactar());

    fireEvent.click(await screen.findByRole('button', { name: /prepare\.aiCancel/ }));

    expect(cancel).toHaveBeenCalled();
  });
});

describe('la espera', () => {
  it('la frase que rota nunca es el valor del campo', async () => {
    // Es un estado, no un valor. Va encima del campo y el input no la toca, así
    // que no puede terminar siendo el mensaje del commit.
    let resolver: (value: unknown) => void = () => undefined;
    draft.mockReturnValue(new Promise((resolve) => { resolver = resolve; }));

    abrirPreparacion();
    await elegirModelo();
    elegirTodo();
    const campo = screen.getByRole('textbox') as HTMLInputElement;
    const antes = campo.value;
    fireEvent.click(botonRedactar());

    // Mientras redacta, el campo conserva su valor y nadie llamó a escribirlo.
    await screen.findByText(/prepare\.aiBusy/);
    expect(campo.value).toBe(antes);
    expect(setCommitMessage).not.toHaveBeenCalled();

    resolver({ success: true, data: { status: 'no-answer', reason: 'empty', model: 'm' } });
    await screen.findByText(/prepare\.aiNoAnswer/);
    expect(setCommitMessage).not.toHaveBeenCalled();
  });

  it('el texto del botón lleva ai-thinking-text mientras redacta, y en reposo no (D20)', async () => {
    let resolver: (value: unknown) => void = () => undefined;
    draft.mockReturnValue(new Promise((resolve) => { resolver = resolve; }));

    abrirPreparacion();
    await elegirModelo();
    elegirTodo();

    const boton = botonRedactar();
    expect(boton.classList.contains('ai-thinking-text')).toBe(false);
    expect(boton.querySelector('.ai-thinking-text')).toBeNull();

    fireEvent.click(boton);

    // Mientras redacta, el texto lleva ai-thinking-text
    const textoOcupado = await screen.findByText(/prepare\.aiBusy/);
    expect(textoOcupado.classList.contains('ai-thinking-text')).toBe(true);
    expect(boton.classList.contains('ai-thinking-text')).toBe(false);

    // Al terminar, el botón y su texto ya no la llevan
    resolver({ success: true, data: { status: 'no-answer', reason: 'empty', model: 'm' } });
    await screen.findByRole('button', { name: /prepare\.aiDraft/ });
    expect(botonRedactar().classList.contains('ai-thinking-text')).toBe(false);
    expect(botonRedactar().querySelector('.ai-thinking-text')).toBeNull();
  });
});
