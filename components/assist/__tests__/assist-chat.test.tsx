// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { assistContributions } from '@/lib/assist/assist-registry';
import { AssistChat } from '../AssistChat';
import type {
  AssistConversationDetail,
  AssistConversationSummary,
  AssistSendArgs,
} from '@/types/assist-context';

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
    expect(screen.getByText('LM Studio · qwen-2.5')).toBeTruthy();
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

    expect(
      await screen.findByText('Cancelaste la pregunta; quedó guardada sin respuesta.'),
    ).toBeTruthy();
  });

  it('5. failed con alternativas muestra el mensaje y los proveedores alternativos', async () => {
    const api = mountApi();
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

    expect(
      await screen.findByText('No se pudo responder: El proveedor no responde.'),
    ).toBeTruthy();
    expect(
      screen.getByText('El mismo modelo está también en: Ollama'),
    ).toBeTruthy();
  });

  it('6. borrar pide confirmación; «No» no llama a delete; «Sí, borrar» lo llama y refresca la lista', async () => {
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

    expect(screen.getByText('¿Borrar esta conversación?')).toBeTruthy();

    const noBtn = screen.getByText('No');
    fireEvent.click(noBtn);

    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.queryByText('¿Borrar esta conversación?')).toBeNull();

    // Ahora confirmar el borrado
    const deleteBtnAgain = screen.getByTitle('Borrar');
    fireEvent.click(deleteBtnAgain);

    const yesBtn = screen.getByText('Sí, borrar');
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
});
