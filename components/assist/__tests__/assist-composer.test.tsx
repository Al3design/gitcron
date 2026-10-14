// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { AssistComposer } from '../AssistComposer';

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

function mountApi(statusData?: unknown) {
  const status = vi.fn().mockResolvedValue({
    success: true,
    data: statusData ?? {
      status: 'resolved',
      use: 'gitcron-assist',
      providerId: 'lmstudio',
      providerName: 'LM Studio',
      modelId: 'qwen-2.5',
      effort: 'Medio',
      destination: 'this-machine',
      available: true,
      alternatives: [],
    },
  });
  const models = vi.fn().mockResolvedValue({
    success: true,
    data: {
      providers: [],
    },
  });
  const onConfigChanged = vi.fn().mockReturnValue(() => {});

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      aiUse: { status, models },
      commitAi: { onConfigChanged },
    },
  });

  return { status, models, onConfigChanged };
}

describe('AssistComposer component', () => {
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

  it('Enter envía y Shift+Enter no envía', () => {
    mountApi();
    const onSend = vi.fn();
    const onChange = vi.fn();

    render(
      <AssistComposer
        value="Hola mundo"
        onChange={onChange}
        onSend={onSend}
        thinking={false}
        onStop={vi.fn()}
        sendDisabled={false}
        repoPath="/repo"
        targetLabel={null}
        targetChanged={false}
        onClearTarget={vi.fn()}
        menuItems={[]}
      />,
    );

    const textarea = screen.getByPlaceholderText('Preguntá sobre este repositorio…');

    // Shift+Enter no envía
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    // Enter sin Shift envía
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('mientras thinking el botón es «Detener» y llama a onStop', () => {
    mountApi();
    const onSend = vi.fn();
    const onStop = vi.fn();

    const { rerender } = render(
      <AssistComposer
        value="Pregunta en curso"
        onChange={vi.fn()}
        onSend={onSend}
        thinking={false}
        onStop={onStop}
        sendDisabled={false}
        repoPath="/repo"
        targetLabel={null}
        targetChanged={false}
        onClearTarget={vi.fn()}
        menuItems={[]}
      />,
    );

    // Con thinking=false es botón Enviar
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy();

    // Cambia a thinking=true
    rerender(
      <AssistComposer
        value="Pregunta en curso"
        onChange={vi.fn()}
        onSend={onSend}
        thinking={true}
        onStop={onStop}
        sendDisabled={false}
        repoPath="/repo"
        targetLabel={null}
        targetChanged={false}
        onClearTarget={vi.fn()}
        menuItems={[]}
      />,
    );

    const stopBtn = screen.getByRole('button', { name: 'Detener' });
    expect(stopBtn).toBeTruthy();

    fireEvent.click(stopBtn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('la cruz de la etiqueta de destino llama a onClearTarget', () => {
    mountApi();
    const onClearTarget = vi.fn();

    render(
      <AssistComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        thinking={false}
        onStop={vi.fn()}
        sendDisabled={false}
        repoPath="/repo"
        targetLabel="Sobre: commit abc1234"
        targetChanged={false}
        onClearTarget={onClearTarget}
        menuItems={[]}
      />,
    );

    expect(screen.getByText('Sobre: commit abc1234')).toBeTruthy();

    const clearBtn = screen.getByRole('button', {
      name: 'Quitar: preguntar sobre el repositorio',
    });
    fireEvent.click(clearBtn);
    expect(onClearTarget).toHaveBeenCalledTimes(1);
  });

  it('el menú «+» abre, lista menuItems y Escape lo cierra', () => {
    mountApi();
    const onSelectAction = vi.fn();
    const menuItems = [
      { id: 'item-1', label: '¿Qué hizo este commit?', onSelect: onSelectAction },
      { id: 'item-2', label: 'Nueva conversación', onSelect: vi.fn() },
    ];

    render(
      <AssistComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        thinking={false}
        onStop={vi.fn()}
        sendDisabled={false}
        repoPath="/repo"
        targetLabel={null}
        targetChanged={false}
        onClearTarget={vi.fn()}
        menuItems={menuItems}
      />,
    );

    const menuBtn = screen.getByRole('button', { name: 'Más opciones' });
    expect(screen.queryByRole('menu')).toBeNull();

    // Abre el menú
    fireEvent.click(menuBtn);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '¿Qué hizo este commit?' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Nueva conversación' })).toBeTruthy();

    // Escape lo cierra
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('la vista previa muestra el Markdown y vuelve a escribir', () => {
    mountApi();

    render(
      <AssistComposer
        value="# Título de prueba"
        onChange={vi.fn()}
        onSend={vi.fn()}
        thinking={false}
        onStop={vi.fn()}
        sendDisabled={false}
        repoPath="/repo"
        targetLabel={null}
        targetChanged={false}
        onClearTarget={vi.fn()}
        menuItems={[]}
      />,
    );

    const previewBtn = screen.getByRole('button', { name: 'Ver con formato' });
    expect(screen.getByPlaceholderText('Preguntá sobre este repositorio…')).toBeTruthy();

    // Activar vista previa
    fireEvent.click(previewBtn);
    expect(screen.queryByPlaceholderText('Preguntá sobre este repositorio…')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Título de prueba' })).toBeTruthy();

    // Volver a escribir
    const writeBtn = screen.getByRole('button', { name: 'Volver a escribir' });
    fireEvent.click(writeBtn);
    expect(screen.getByPlaceholderText('Preguntá sobre este repositorio…')).toBeTruthy();
  });

  it('el botón del modelo muestra «modelo · nivel» con un aiUse.status simulado y abre el selector', async () => {
    mountApi({
      status: 'resolved',
      use: 'gitcron-assist',
      providerId: 'lmstudio',
      providerName: 'LM Studio',
      modelId: 'qwen-2.5',
      effort: 'Medio',
      destination: 'this-machine',
      available: true,
      alternatives: [],
    });

    const { container } = render(
      <AssistComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        thinking={false}
        onStop={vi.fn()}
        sendDisabled={false}
        repoPath="/repo"
        targetLabel={null}
        targetChanged={false}
        onClearTarget={vi.fn()}
        menuItems={[]}
      />,
    );

    // Esperar a que el status se resuelva y se muestre en el botón
    const modelBtn = await screen.findByRole('button', { name: /qwen-2\.5.*Medio/ });
    expect(modelBtn.textContent).toContain('qwen-2.5');
    expect(modelBtn.textContent).toContain('Medio');

    // Abre el selector en document.body (portal)
    fireEvent.click(modelBtn);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(document.body.contains(dialog)).toBe(true);
    expect(container.contains(dialog)).toBe(false);
  });
});
