import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendDraftChunks,
  applyChunks,
  clearDraftLog,
  finishDraftLog,
  getDraftLogSnapshot,
  REASONING_LIMIT,
  setActiveDraftLog,
  setDraftLogTiming,
  startDraftLog,
  subscribeDraftLog,
  type DraftLog,
} from '../commit-draft-log';
import type { DraftChunk } from '@/types/commit-message-ai';

/**
 * El log de la redacción, que vive fuera de React.
 *
 * Lo que se prueba: que el texto se acumule entero, que lo de una redacción
 * cancelada no se mezcle con la nueva, y que el snapshot cambie de identidad en
 * cada actualización —`useSyncExternalStore` compara por referencia, y mutar el
 * objeto ya entregado dejaría la vista sin enterarse—.
 */

const razona = (text: string): DraftChunk => ({ kind: 'reasoning', text });
const escribe = (text: string): DraftChunk => ({ kind: 'content', text });

const vacio: DraftLog = {
  draftId: 'x',
  reasoning: '',
  content: '',
  truncated: false,
  finishReason: null,
  usage: null,
  streaming: true,
  error: null,
  startedAt: null,
  finishedAt: null,
};

beforeEach(() => { clearDraftLog(); });

describe('acumular lo que llega', () => {
  it('separa el razonamiento de la respuesta', () => {
    const log = applyChunks(vacio, [razona('a ver'), escribe('feat: x'), razona(' el diff')]);

    // Mezclarlos haría imposible ver cuál de las dos terminó.
    expect(log.reasoning).toBe('a ver el diff');
    expect(log.content).toBe('feat: x');
  });

  it('el cierre apaga el vivo y guarda el conteo', () => {
    const log = applyChunks(vacio, [{
      kind: 'done',
      finishReason: 'stop',
      usage: { promptTokens: 28, cachedPromptTokens: null, completionTokens: 311, reasoningTokens: 278 },
    }]);

    expect(log.streaming).toBe(false);
    expect(log.finishReason).toBe('stop');
    // Es el número que explica una espera larga: cuánto se fue en pensar.
    expect(log.usage?.reasoningTokens).toBe(278);
  });

  it('un cuadro de cierre sin conteo no pisa el que ya había', () => {
    // El motivo y el `usage` pueden venir en cuadros distintos: medido, el de
    // `usage` llega con `choices` vacío y sin `finish_reason`.
    const conConteo = applyChunks(vacio, [{
      kind: 'done',
      finishReason: null,
      usage: { promptTokens: 28, cachedPromptTokens: null, completionTokens: 311, reasoningTokens: 278 },
    }]);
    const despues = applyChunks(conConteo, [{ kind: 'done', finishReason: 'stop', usage: null }]);

    expect(despues.finishReason).toBe('stop');
    expect(despues.usage?.reasoningTokens).toBe(278);
  });

  it('recorta lo más viejo y lo declara', () => {
    const largo = applyChunks(vacio, [razona('A'.repeat(REASONING_LIMIT + 500)), razona('FINAL')]);

    expect(largo.reasoning.length).toBe(REASONING_LIMIT);
    // Lo último es lo que se está mirando: se recorta el principio, no el final.
    expect(largo.reasoning.endsWith('FINAL')).toBe(true);
    // Un texto cortado en silencio hace pensar que el modelo empezó por la mitad.
    expect(largo.truncated).toBe(true);
  });
});

describe('cuando el servidor falla a mitad', () => {
  it('guarda el motivo aparte y corta el vivo', () => {
    // El caso real: la iGPU de la notebook se cayó con `ErrorDeviceLost`.
    const log = applyChunks(vacio, [
      razona('empecé a pensar'),
      { kind: 'error', detail: 'decode() failed: vk::Device::getFenceStatus: ErrorDeviceLost' },
    ]);

    expect(log.error).toBe('decode() failed: vk::Device::getFenceStatus: ErrorDeviceLost');
    expect(log.streaming).toBe(false);
    // Aparte del texto: no es algo que el modelo haya dicho, es lo que le pasó a
    // la máquina. Mezclarlo lo haría leer como parte de la respuesta.
    expect(log.reasoning).toBe('empecé a pensar');
  });

  it('el motivo llega tal cual lo dio el servidor', () => {
    const log = applyChunks(vacio, [{ kind: 'error', detail: 'Engine protocol predict stream returned an error' }]);

    // Sin suavizar: el texto crudo es la única pista que sirve para buscarlo.
    expect(log.error).toBe('Engine protocol predict stream returned an error');
  });
});

describe('a qué redacción pertenece lo que llega', () => {
  it('lo de otra corrida se descarta', () => {
    startDraftLog('2');
    appendDraftChunks({ draftId: '1', chunks: [razona('lo de la corrida cancelada')] });
    appendDraftChunks({ draftId: '2', chunks: [razona('lo de la nueva')] });

    // Sin esta guardia, cancelar y volver a pedir mezclaba los dos streams.
    expect(getDraftLogSnapshot().reasoning).toBe('lo de la nueva');
  });

  it('sin marca no se aplica nada', () => {
    startDraftLog('1');
    appendDraftChunks({ draftId: null, chunks: [razona('de nadie')] });

    expect(getDraftLogSnapshot().reasoning).toBe('');
  });

  it('empezar otra deja el log en blanco', () => {
    startDraftLog('1');
    appendDraftChunks({ draftId: '1', chunks: [razona('lo viejo')] });
    startDraftLog('2');

    expect(getDraftLogSnapshot().reasoning).toBe('');
    expect(getDraftLogSnapshot().streaming).toBe(true);
  });

  it('conserva registros independientes por draftId', () => {
    startDraftLog('repoA-1');
    appendDraftChunks({ draftId: 'repoA-1', chunks: [razona('pensamiento A')] });

    startDraftLog('repoB-1');
    appendDraftChunks({ draftId: 'repoB-1', chunks: [razona('pensamiento B')] });

    expect(getDraftLogSnapshot('repoA-1').reasoning).toBe('pensamiento A');
    expect(getDraftLogSnapshot('repoB-1').reasoning).toBe('pensamiento B');
  });
});

describe('avisar a quien mira', () => {
  it('cada actualización entrega un objeto nuevo', () => {
    startDraftLog('1');
    const antes = getDraftLogSnapshot();
    appendDraftChunks({ draftId: '1', chunks: [razona('algo')] });

    // `useSyncExternalStore` compara por identidad.
    expect(getDraftLogSnapshot()).not.toBe(antes);
  });

  it('lo descartado no despierta a nadie', () => {
    startDraftLog('1');
    const escucha = vi.fn();
    const baja = subscribeDraftLog(escucha);

    appendDraftChunks({ draftId: 'otra', chunks: [razona('nada que ver')] });
    expect(escucha).not.toHaveBeenCalled();

    appendDraftChunks({ draftId: '1', chunks: [razona('sí')] });
    expect(escucha).toHaveBeenCalledTimes(1);
    baja();
  });

  it('darse de baja corta los avisos', () => {
    startDraftLog('1');
    const escucha = vi.fn();
    subscribeDraftLog(escucha)();

    appendDraftChunks({ draftId: '1', chunks: [razona('algo')] });
    expect(escucha).not.toHaveBeenCalled();
  });
});

describe('terminar', () => {
  it('apaga el vivo aunque el cierre no haya llegado', () => {
    // Un servidor que corta a mitad dejaría el rail diciendo «en vivo» para
    // siempre.
    startDraftLog('1');
    appendDraftChunks({ draftId: '1', chunks: [razona('a medias')] });
    finishDraftLog();

    expect(getDraftLogSnapshot().streaming).toBe(false);
    // Lo pensado se queda: el momento de leerlo es justo después de que termina.
    expect(getDraftLogSnapshot().reasoning).toBe('a medias');
  });

  it('terminar dos veces no avisa de más', () => {
    startDraftLog('1');
    finishDraftLog();
    const escucha = vi.fn();
    subscribeDraftLog(escucha);
    finishDraftLog();

    expect(escucha).not.toHaveBeenCalled();
  });
});

describe('tiempos de ejecución (tarea 2.5 / D18)', () => {
  it('fijar tiempos de A no cambia B; el snapshot del activo los muestra', () => {
    startDraftLog('A');
    startDraftLog('B');

    // Inicialmente vacíos
    expect(getDraftLogSnapshot('A').startedAt).toBeNull();
    expect(getDraftLogSnapshot('A').finishedAt).toBeNull();
    expect(getDraftLogSnapshot('B').startedAt).toBeNull();
    expect(getDraftLogSnapshot('B').finishedAt).toBeNull();

    // Fijamos tiempos sólo para A
    setDraftLogTiming('A', { startedAt: 1000, finishedAt: 5000 });

    // B no cambia
    expect(getDraftLogSnapshot('B').startedAt).toBeNull();
    expect(getDraftLogSnapshot('B').finishedAt).toBeNull();

    // A sí cambió
    expect(getDraftLogSnapshot('A').startedAt).toBe(1000);
    expect(getDraftLogSnapshot('A').finishedAt).toBe(5000);

    // Si el activo es B (el último iniciado), el snapshot activo no muestra los de A
    expect(getDraftLogSnapshot().startedAt).toBeNull();
    expect(getDraftLogSnapshot().finishedAt).toBeNull();

    // Pasamos el activo a A y el snapshot del activo los muestra
    setActiveDraftLog('A');
    expect(getDraftLogSnapshot().startedAt).toBe(1000);
    expect(getDraftLogSnapshot().finishedAt).toBe(5000);
  });
});
