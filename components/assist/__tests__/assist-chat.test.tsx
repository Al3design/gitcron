// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { assistContributions } from '@/lib/assist/assist-registry';
import { useAssistContribution } from '@/lib/assist/use-assist-contribution';
import { AssistChat } from '../AssistChat';
import type {
  AssistConversationDetail,
  AssistConversationSummary,
  AssistSendArgs,
} from '@/types/assist-context';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

interface MockApi {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  aiUseStatus: ReturnType<typeof vi.fn>;
}

function mountApi(): MockApi {
  const list = vi.fn().mockResolvedValue({ success: true, data: [] });
  const get = vi.fn().mockResolvedValue({ success: true, data: null });
  const deleteFn = vi.fn().mockResolvedValue({ success: true, data: { deleted: true } });
  const send = vi.fn().mockResolvedValue({
    success: true,
    data: {
      status: 'answered',
      conversationId: 'conv-new-1',
      question: { id: 'q1', text: 'q', role: 'user', references: [] },
      answer: { id: 'a1', text: 'a', role: 'assistant', references: [] },
    },
  });
  const cancel = vi.fn().mockResolvedValue({ success: true, data: { cancelled: true } });

  const aiUseStatus = vi.fn().mockResolvedValue({
    success: true,
    data: {
      status: 'resolved',
      use: 'gitcron-assist',
      providerId: 'lmstudio',
      providerName: 'LM Studio',
      modelId: 'qwen-2.5',
      destination: 'this-machine',
      available: true,
      alternatives: [],
    },
  });

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      assistConversations: {
        list,
        get,
        delete: deleteFn,
        send,
        cancel,
      },
      aiUse: {
        status: aiUseStatus,
        adopt: vi.fn(),
      },
      commitAi: {
        onConfigChanged: vi.fn().mockReturnValue(() => {}),
      },
    },
  });

  return { list, get, delete: deleteFn, send, cancel, aiUseStatus };
}

describe('AssistChat component', () => {
  beforeEach(() => {
    useGitStore.setState({ language: 'es' });
  });

  afterEach(() => {
    cleanup();
    if (ORIGINAL_API === undefined) {
      delete (window as { api?: unknown }).api;
    } else {
      Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
    }
  });

  it('1. sin repo muestra assist.noRepo y no llama a list', async () => {
    const api = mountApi();
    render(<AssistChat repoPath={null} viewId="test-view" />);

    expect(screen.getByText('Abrí un repositorio para conversar con la IA sobre él.')).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('2. lista las conversaciones del repo; elegir una llama a get y muestra sus mensajes, con «Sobre: commit …» en la pregunta', async () => {
    const api = mountApi();
    const convs: AssistConversationSummary[] = [
      {
        id: 'conv-1',
        title: 'Conversación sobre refactor',
        viewId: 'test-view',
        createdAt: '2026-10-13T10:00:00Z',
        updatedAt: '2026-10-13T10:00:00Z',
        messageCount: 2,
      },
    ];
    api.list.mockResolvedValueOnce({ success: true, data: convs });

    const detail: AssistConversationDetail = {
      conversation: convs[0],
      messages: [
        {
          id: 'msg-1',
          seq: 1,
          role: 'user',
          text: '¿Qué cambios hay acá?',
          providerName: null,
          modelId: null,
          createdAt: '2026-10-13T10:00:00Z',
          references: [
            {
              selection: { kind: 'commit', sha: 'abcdef1' },
              headSha: 'abcdef1',
              status: 'ok',
            },
          ],
        },
        {
          id: 'msg-2',
          seq: 2,
          role: 'assistant',
          text: 'Acá se refactorizó el resolvedor.',
          providerName: 'LM Studio',
          modelId: 'qwen-2.5',
          createdAt: '2026-10-13T10:01:00Z',
          references: [],
        },
      ],
    };
    api.get.mockResolvedValueOnce({ success: true, data: detail });

    render(<AssistChat repoPath="/repo/a" viewId="test-view" />);

    const item = await screen.findByText('Conversación sobre refactor');
    expect(item).toBeTruthy();

    fireEvent.click(item);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith({
        repoPath: '/repo/a',
        conversationId: 'conv-1',
      });
    });

    expect(await screen.findByText(/Sobre: commit abcdef1/)).toBeTruthy();
    expect(screen.getByText('¿Qué cambios hay acá?')).toBeTruthy();
    expect(screen.getByText('Acá se refactorizó el resolvedor.')).toBeTruthy();
  });

  it('3. enviar con Ctrl+Enter: muestra la pregunta y «Pensando…»; al responder answered, muestra la respuesta y el modelo', async () => {
    const api = mountApi();
    let resolveSend: (val: unknown) => void = () => {};
    const sendPromise = new Promise((resolve) => {
      resolveSend = resolve;
    });
    api.send.mockReturnValueOnce(sendPromise);

    render(<AssistChat repoPath="/repo/a" viewId="test-view" />);

    const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…');
    fireEvent.change(textarea, { target: { value: '¿Cómo funciona esto?' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(screen.getByText('¿Cómo funciona esto?')).toBeTruthy();
    expect(screen.getByText('Pensando…')).toBeTruthy();

    const detail: AssistConversationDetail = {
      conversation: {
        id: 'conv-123',
        title: '¿Cómo funciona esto?',
        viewId: 'test-view',
        createdAt: '2026-10-13T10:00:00Z',
        updatedAt: '2026-10-13T10:00:00Z',
        messageCount: 2,
      },
      messages: [
        {
          id: 'm1',
          seq: 1,
          role: 'user',
          text: '¿Cómo funciona esto?',
          providerName: null,
          modelId: null,
          createdAt: '2026-10-13T10:00:00Z',
          references: [],
        },
        {
          id: 'm2',
          seq: 2,
          role: 'assistant',
          text: 'Funciona paso a paso con dobles.',
          providerName: 'LM Studio',
          modelId: 'qwen-2.5',
          createdAt: '2026-10-13T10:01:00Z',
          references: [],
        },
      ],
    };
    api.get.mockResolvedValueOnce({ success: true, data: detail });

    await act(async () => {
      resolveSend({
        success: true,
        data: {
          status: 'answered',
          conversationId: 'conv-123',
          question: detail.messages[0],
          answer: detail.messages[1],
        },
      });
    });

    expect(await screen.findByText('Funciona paso a paso con dobles.')).toBeTruthy();
    expect(screen.getByText(/LM Studio · qwen-2.5/)).toBeTruthy();
  });

  it('4. cancelar llama a cancel con el mismo requestId que send, y al volver cancelled muestra el aviso', async () => {
    const api = mountApi();
    let capturedRequestId: string | null = null;
    let resolveSend: (val: unknown) => void = () => {};
    const sendPromise = new Promise((resolve) => {
      resolveSend = resolve;
    });

    api.send.mockImplementationOnce((args: AssistSendArgs) => {
      capturedRequestId = args.requestId;
      return sendPromise;
    });

    render(<AssistChat repoPath="/repo/a" viewId="test-view" />);

    const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…');
    fireEvent.change(textarea, { target: { value: 'Una pregunta larga' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(await screen.findByText('Pensando…')).toBeTruthy();

    const cancelBtn = screen.getByText('Cancelar');
    fireEvent.click(cancelBtn);

    expect(api.cancel).toHaveBeenCalledWith({ requestId: capturedRequestId });

    await act(async () => {
      resolveSend({
        success: true,
        data: {
          status: 'cancelled',
          conversationId: 'conv-1',
        },
      });
    });

    await waitFor(() => {
      expect(useGitStore.getState().success).toBe(
        'Cancelaste la pregunta; quedó guardada sin respuesta.',
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('5. failed con alternativas llama a setError del store y no dibuja el recuadro noticeAlert', async () => {
    const api = mountApi();
    useGitStore.setState({ error: null });
    api.send.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'failed',
        conversationId: 'conv-1',
        reason: 'unavailable',
        message: 'El proveedor no responde.',
        alternatives: [{ providerId: 'ollama', providerName: 'Ollama' }],
      },
    });

    render(<AssistChat repoPath="/repo/a" viewId="test-view" />);

    const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…');
    fireEvent.change(textarea, { target: { value: 'Pregunta fallida' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(useGitStore.getState().error).toBe(
        'No se pudo responder: El proveedor no responde. El mismo modelo está también en: Ollama',
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('6. borrar pide confirmación con TaskConfirmToast; «No» no llama a delete; «Sí, borrar» lo llama y refresca la lista', async () => {
    const api = mountApi();
    const convs: AssistConversationSummary[] = [
      {
        id: 'conv-borrar-1',
        title: 'Conversación a borrar',
        viewId: 'test-view',
        createdAt: '2026-10-13T10:00:00Z',
        updatedAt: '2026-10-13T10:00:00Z',
        messageCount: 1,
      },
    ];
    api.list.mockResolvedValue({ success: true, data: convs });

    render(<AssistChat repoPath="/repo/a" viewId="test-view" />);

    const deleteBtn = await screen.findByTitle('Borrar');
    fireEvent.click(deleteBtn);

    expect(screen.getByText('Borrar «Conversación a borrar»')).toBeTruthy();
    expect(screen.getByText('Se borran sus mensajes. No se puede deshacer.')).toBeTruthy();

    const noBtn = screen.getByRole('button', { name: 'No' });
    fireEvent.click(noBtn);

    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.queryByText('Borrar «Conversación a borrar»')).toBeNull();

    // Ahora desde el menú de tres puntos
    const moreBtn = screen.getByTitle('Más acciones');
    fireEvent.click(moreBtn);

    const menuDeleteBtn = screen.getByRole('menuitem', { name: 'Borrar' });
    fireEvent.click(menuDeleteBtn);

    expect(screen.getByText('Borrar «Conversación a borrar»')).toBeTruthy();

    const yesBtn = screen.getByRole('button', { name: 'Sí, borrar' });
    fireEvent.click(yesBtn);

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith({
        repoPath: '/repo/a',
        conversationId: 'conv-borrar-1',
      });
    });
  });

  it('7. cambio de repo mientras pensaba: se envía en el repo A, se cambia el prop a B antes de que vuelva send; la respuesta no aparece en B', async () => {
    const api = mountApi();
    let resolveSend: (val: unknown) => void = () => {};
    const sendPromise = new Promise((resolve) => {
      resolveSend = resolve;
    });
    api.send.mockReturnValueOnce(sendPromise);

    const { rerender } = render(<AssistChat repoPath="/repo-a" viewId="test-view" />);

    const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…');
    fireEvent.change(textarea, { target: { value: 'Pregunta para repo A' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(screen.getByText('Pregunta para repo A')).toBeTruthy();

    // Cambiar prop repoPath a repo-b antes de que vuelva send
    rerender(<AssistChat repoPath="/repo-b" viewId="test-view" />);

    // En B no se ve la pregunta que espera respuesta en A, ni «Pensando…», y el cuadro de B no queda bloqueado.
    expect(screen.queryByText('Pregunta para repo A')).toBeNull();
    expect(screen.queryByText('Pensando…')).toBeNull();
    expect((screen.getByPlaceholderText('Preguntá sobre este repositorio…') as HTMLTextAreaElement).disabled).toBe(false);

    // Ahora responde send del repo A
    await act(async () => {
      resolveSend({
        success: true,
        data: {
          status: 'answered',
          conversationId: 'conv-repo-a',
          question: { id: 'q-a', text: 'Pregunta para repo A', role: 'user', references: [] },
          answer: { id: 'a-a', text: 'Respuesta secreta de repo A', role: 'assistant', references: [] },
        },
      });
    });

    // En repo B no debe mostrarse la respuesta del repo A
    expect(screen.queryByText('Respuesta secreta de repo A')).toBeNull();
  });

  it('8. la selección enviada es la de la contribución de la vista: registrar en assistContributions un contribuyente para viewId con { kind: "commit", sha: "abcdef1" } y comprobar que send la recibe. Dar de baja el contribuyente al final.', async () => {
    const api = mountApi();
    const unregister = assistContributions.register('custom-view', () => ({
      selection: { kind: 'commit', sha: 'abcdef1' },
      actions: [],
    }));

    try {
      render(<AssistChat repoPath="/repo/a" viewId="custom-view" />);

      const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…');
      fireEvent.change(textarea, { target: { value: 'Pregunta con selección' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

      expect(api.send).toHaveBeenCalledWith(
        expect.objectContaining({
          selection: { kind: 'commit', sha: 'abcdef1' },
          viewId: 'custom-view',
        }),
      );
    } finally {
      unregister();
    }
  });

  it('9. una acción consult disponible aparece en «Para preguntar acá» y al tocarla escribe su texto en el cuadro sin enviar; una execute no aparece.', async () => {
    mountApi();
    const unregister = assistContributions.register('suggestions-view', () => ({
      selection: { kind: 'none' },
      actions: [
        {
          id: 'action-consult',
          labelKey: 'assist.title',
          scope: 'consult',
          available: true,
          requiresConfirmation: false,
        },
        {
          id: 'action-execute',
          labelKey: 'assist.newConversation',
          scope: 'execute',
          available: true,
          requiresConfirmation: true,
        },
      ],
    }));

    try {
      render(<AssistChat repoPath="/repo/a" viewId="suggestions-view" />);

      expect(screen.getByText('Para preguntar acá')).toBeTruthy();

      // La acción consult ("Asistente") debe aparecer como sugerencia
      const suggestionButtons = screen.getAllByRole('button', { name: 'Asistente' });
      expect(suggestionButtons.length).toBeGreaterThan(0);

      // La acción execute no debe aparecer dentro de las sugerencias
      const executeInSuggestions = screen
        .queryAllByRole('button', { name: 'Nueva conversación' })
        .filter((btn) => btn.className.includes('suggestionBtn'));
      expect(executeInSuggestions).toHaveLength(0);

      // Al tocar la acción de sugerencia, se escribe en el cuadro sin enviar
      const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…') as HTMLTextAreaElement;
      fireEvent.click(suggestionButtons[0]);

      expect(textarea.value).toBe('Asistente');
    } finally {
      unregister();
    }
  });

  it('10. registrar con useAssistContribution la vista graph con un commit viejo, enviar pregunta y comprobar que send recibe ese sha y la burbuja muestra «Sobre: commit …».', async () => {
    const api = mountApi();
    let resolveSend: (val: unknown) => void = () => {};
    const sendPromise = new Promise((resolve) => {
      resolveSend = resolve;
    });
    api.send.mockReturnValueOnce(sendPromise);

    const olderCommitSha = '9876543210abcdef9876543210abcdef98765432';

    function TestContainer() {
      useAssistContribution('graph', () => ({
        selection: { kind: 'commit', sha: olderCommitSha },
        actions: [
          {
            id: 'explain-commit',
            labelKey: 'assist.ask.explainCommit',
            scope: 'consult',
            available: true,
            requiresConfirmation: false,
          },
        ],
      }));

      return <AssistChat repoPath="/repo/a" viewId="graph" />;
    }

    render(<TestContainer />);

    const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…');
    fireEvent.change(textarea, { target: { value: '¿Qué cambió acá?' } });

    const sendBtn = screen.getByRole('button', { name: 'Enviar' });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(api.send).toHaveBeenCalledTimes(1);
    });

    const sendCallArgs = api.send.mock.calls[0][0] as AssistSendArgs;
    expect(sendCallArgs.selection).toEqual({
      kind: 'commit',
      sha: olderCommitSha,
    });

    expect(screen.getAllByText(`Sobre: commit ${olderCommitSha.slice(0, 7)}`).length).toBeGreaterThanOrEqual(1);

    resolveSend({
      success: true,
      data: {
        status: 'answered',
        conversationId: 'conv-new-1',
        question: {
          id: 'q1',
          text: '¿Qué cambió acá?',
          role: 'user',
          references: [{ selection: { kind: 'commit', sha: olderCommitSha }, headSha: null, status: 'ok' }],
        },
        answer: { id: 'a1', text: 'Respuesta', role: 'assistant', references: [] },
      },
    });
  });

  it('11. muestra «Sobre el repositorio» cuando la vista no tiene selección', async () => {
    mountApi();
    render(<AssistChat repoPath="/repo/a" viewId="unregistered-view" />);
    expect(screen.getByText('Sobre el repositorio')).toBeTruthy();
  });

  it('12. muestra el alcance correspondiente para commit, carto-node y temporal-idea', async () => {
    mountApi();
    let currentSelection = { kind: 'commit' as const, sha: 'abcdef1' };
    const unregister = assistContributions.register('multi-target-view', () => ({
      selection: currentSelection,
      actions: [],
    }));

    try {
      render(<AssistChat repoPath="/repo/a" viewId="multi-target-view" />);
      expect(screen.getByText('Sobre: commit abcdef1')).toBeTruthy();

      act(() => {
        currentSelection = { kind: 'carto-node' as const, nodeId: 'sym:App' } as any;
        assistContributions.notify();
      });
      expect(screen.getByText('Sobre: pieza del mapa sym:App')).toBeTruthy();

      act(() => {
        currentSelection = { kind: 'temporal-idea' as const, branchId: 'b1', runId: 'r1' } as any;
        assistContributions.notify();
      });
      expect(screen.getByText('Sobre: idea del Agente Temporal')).toBeTruthy();
    } finally {
      unregister();
    }
  });

  it('13. cuando assistContributions.notify() se llama, el texto se actualiza sin remontar', async () => {
    mountApi();
    let currentSha = '1111111';
    const unregister = assistContributions.register('dynamic-view', () => ({
      selection: { kind: 'commit', sha: currentSha },
      actions: [],
    }));

    try {
      render(<AssistChat repoPath="/repo/a" viewId="dynamic-view" />);
      expect(screen.getByText('Sobre: commit 1111111')).toBeTruthy();

      act(() => {
        currentSha = '2222222';
        assistContributions.notify();
      });
      expect(screen.getByText('Sobre: commit 2222222')).toBeTruthy();
    } finally {
      unregister();
    }
  });

  it('14. si hay mensajes previos y cambia el target, añade la clase targetBadgeChanged', async () => {
    const api = mountApi();
    const convs: AssistConversationSummary[] = [
      {
        id: 'c1',
        title: 'Charla 1',
        viewId: 'change-highlight-view',
        createdAt: '2026-04-10T10:00:00Z',
        updatedAt: '2026-04-10T10:00:00Z',
        messageCount: 1,
      },
    ];
    api.list.mockResolvedValueOnce({ success: true, data: convs });
    const detail: AssistConversationDetail = {
      conversation: convs[0],
      messages: [
        {
          id: 'm1',
          seq: 1,
          role: 'user',
          text: 'Hola',
          providerName: null,
          modelId: null,
          createdAt: '2026-04-10T10:00:00Z',
          references: [],
        },
      ],
    };
    api.get.mockResolvedValueOnce({ success: true, data: detail });

    let currentSelection = { kind: 'commit' as const, sha: '1111111' };
    const unregister = assistContributions.register('change-highlight-view', () => ({
      selection: currentSelection,
      actions: [],
    }));

    try {
      render(<AssistChat repoPath="/repo/a" viewId="change-highlight-view" />);
      const convButton = await screen.findByRole('button', { name: /Charla 1/ });
      fireEvent.click(convButton);

      await screen.findByText('Hola');

      const scopeEl = screen.getByText('Sobre: commit 1111111').closest('div');
      expect(scopeEl?.className).not.toMatch(/targetBadgeChanged/);

      act(() => {
        currentSelection = { kind: 'commit', sha: '2222222' };
        assistContributions.notify();
      });

      const updatedScope = screen.getByText('Sobre: commit 2222222').closest('div');
      expect(updatedScope?.className).toMatch(/targetBadgeChanged/);
    } finally {
      unregister();
    }
  });

  it('15. con la conversación vacía las sugerencias aparecen arriba del cuadro', async () => {
    mountApi();
    const unregister = assistContributions.register('suggestions-top-view', () => ({
      selection: { kind: 'none' },
      actions: [
        {
          id: 'action-suggest-top',
          labelKey: 'assist.title',
          scope: 'consult',
          available: true,
          requiresConfirmation: false,
        },
      ],
    }));

    try {
      render(<AssistChat repoPath="/repo/a" viewId="suggestions-top-view" />);
      expect(screen.getByText('Para preguntar acá')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Asistente' })).toBeTruthy();
    } finally {
      unregister();
    }
  });

  it('16. quitar el destino hace que send reciba { kind: "none" }', async () => {
    const api = mountApi();
    const olderCommitSha = 'abcdef1234567890abcdef1234567890abcdef12';

    const unregister = assistContributions.register('clear-target-view', () => ({
      selection: { kind: 'commit', sha: olderCommitSha },
      actions: [],
    }));

    try {
      render(<AssistChat repoPath="/repo/a" viewId="clear-target-view" />);

      expect(screen.getByText(`Sobre: commit ${olderCommitSha.slice(0, 7)}`)).toBeTruthy();

      const clearBtn = screen.getByRole('button', {
        name: 'Quitar: preguntar sobre el repositorio',
      });
      fireEvent.click(clearBtn);

      expect(screen.queryByText(`Sobre: commit ${olderCommitSha.slice(0, 7)}`)).toBeNull();
      expect(screen.getByText('Sobre el repositorio')).toBeTruthy();

      const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…');
      fireEvent.change(textarea, { target: { value: 'Pregunta general' } });

      const sendBtn = screen.getByRole('button', { name: 'Enviar' });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(api.send).toHaveBeenCalledTimes(1);
      });

      const sendCallArgs = api.send.mock.calls[0][0] as AssistSendArgs;
      expect(sendCallArgs.selection).toEqual({ kind: 'none' });
    } finally {
      unregister();
    }
  });

  it('la columna de conversaciones se oculta o muestra según chatListOpen del store', async () => {
    useAssistDockStore.setState({ chatListOpen: true, chatListWidth: 256 });
    mountApi();
    const { rerender } = render(<AssistChat repoPath="/repo/a" />);

    expect(screen.getByRole('button', { name: 'Nueva conversación' })).toBeTruthy();

    act(() => {
      useAssistDockStore.setState({ chatListOpen: false });
    });
    rerender(<AssistChat repoPath="/repo/a" />);

    expect(screen.queryByRole('button', { name: 'Nueva conversación' })).toBeNull();

    act(() => {
      useAssistDockStore.setState({ chatListOpen: true });
    });
    rerender(<AssistChat repoPath="/repo/a" />);

    expect(screen.getByRole('button', { name: 'Nueva conversación' })).toBeTruthy();
  });

  it('con el foco en el borde, ArrowRight sube el ancho del store en 16', async () => {
    useAssistDockStore.setState({ chatListOpen: true, chatListWidth: 256 });
    mountApi();
    render(<AssistChat repoPath="/repo/a" />);

    const resizer = screen.getByRole('separator', { name: /cambiar el ancho/ });
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });

    expect(useAssistDockStore.getState().chatListWidth).toBe(272);
  });

  it('17. una respuesta con uso muestra «… de entrada» y «% del contexto», y el total aparece al pie', async () => {
    const api = mountApi();
    const convs: AssistConversationSummary[] = [
      { id: 'conv-usage', title: 'Con uso', viewId: 'test', createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z', messageCount: 2 },
    ];
    api.list.mockResolvedValueOnce({ success: true, data: convs });

    const detail: AssistConversationDetail = {
      conversation: convs[0],
      messages: [
        { id: 'm1', seq: 1, role: 'user', text: 'pregunta', providerName: null, modelId: null, createdAt: '2026-10-14T10:00:00Z', references: [], usage: null },
        {
          id: 'm2',
          seq: 2,
          role: 'assistant',
          text: 'respuesta con uso',
          providerName: 'LM Studio',
          modelId: 'qwen-2.5',
          createdAt: '2026-10-14T10:01:00Z',
          references: [],
          usage: {
            promptTokens: 500,
            cachedPromptTokens: 200,
            completionTokens: 150,
            reasoningTokens: 30,
            durationMs: 2000,
            contextLength: 50000,
          },
        },
      ],
    };
    api.get.mockResolvedValueOnce({ success: true, data: detail });

    render(<AssistChat repoPath="/repo/a" />);

    const item = await screen.findByText('Con uso');
    fireEvent.click(item);

    expect((await screen.findAllByText(/500 de entrada/)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/% del contexto/)).toBeTruthy();
    expect(screen.getByText(/Total de la conversación:/)).toBeTruthy();
  });

  it('18. una respuesta sin uso muestra «Sin datos de uso del servidor»', async () => {
    const api = mountApi();
    const convs: AssistConversationSummary[] = [
      { id: 'conv-no-usage', title: 'Sin uso', viewId: 'test', createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z', messageCount: 2 },
    ];
    api.list.mockResolvedValueOnce({ success: true, data: convs });

    const detail: AssistConversationDetail = {
      conversation: convs[0],
      messages: [
        { id: 'm1', seq: 1, role: 'user', text: 'pregunta', providerName: null, modelId: null, createdAt: '2026-10-14T10:00:00Z', references: [], usage: null },
        {
          id: 'm2',
          seq: 2,
          role: 'assistant',
          text: 'respuesta sin datos de uso',
          providerName: 'LM Studio',
          modelId: 'qwen-2.5',
          createdAt: '2026-10-14T10:01:00Z',
          references: [],
          usage: null,
        },
      ],
    };
    api.get.mockResolvedValueOnce({ success: true, data: detail });

    render(<AssistChat repoPath="/repo/a" />);

    const item = await screen.findByText('Sin uso');
    fireEvent.click(item);

    expect((await screen.findAllByText(/Sin datos de uso del servidor/)).length).toBeGreaterThanOrEqual(1);
  });
});
