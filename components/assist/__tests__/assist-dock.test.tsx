// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { useAssistDockStore } from '@/lib/assist/assist-dock-store';
import { AssistDock } from '../AssistDock';

describe('AssistDock component', () => {
  beforeEach(() => {
    useGitStore.setState({ language: 'es' });
    useAssistDockStore.setState({
      open: false,
      height: 320,
      activeTabId: 'chat',
      registeredTabs: [{ id: 'chat', labelKey: 'assist.tabChat' }],
      slot: null,
      conversationByRepo: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('1. cerrado es sólo una manija; abierto muestra la pestaña Chat por omisión', () => {
    render(<AssistDock repoPath="/repo/test" />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Abrir panel de asistencia/ }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].textContent).toBe('Chat');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('2. el botón toggle abre y cierra el panel', () => {
    render(<AssistDock repoPath="/repo/test" />);
    const openBtn = screen.getByRole('button', { name: 'Abrir panel de asistencia' });
    expect(openBtn).toBeTruthy();

    fireEvent.click(openBtn);
    expect(useAssistDockStore.getState().open).toBe(true);

    const closeBtn = screen.getByRole('button', { name: 'Cerrar panel de asistencia' });
    expect(closeBtn).toBeTruthy();

    fireEvent.click(closeBtn);
    expect(useAssistDockStore.getState().open).toBe(false);
  });

  it('3. muestra el chat cuando activeTabId es "chat" y está abierto', () => {
    useAssistDockStore.setState({ open: true, activeTabId: 'chat' });
    render(<AssistDock repoPath="/repo/test" />);

    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe('assist-dock-panel-chat');
  });

  it('4. expone el slot en el store cuando una pestaña contextual está activa', () => {
    useAssistDockStore.setState({
      open: true,
      registeredTabs: [
        { id: 'chat', labelKey: 'assist.tabChat' },
        { id: 'centauro-report', labelKey: 'centauro.tabReport' },
      ],
      activeTabId: 'centauro-report',
    });

    render(<AssistDock repoPath="/repo/test" />);

    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe('assist-dock-panel-centauro-report');
    expect(useAssistDockStore.getState().slot).toBe(panel);
  });

  it('5. el resizer tiene rol separator y aria-orientation horizontal', () => {
    useAssistDockStore.setState({ open: true });
    render(<AssistDock repoPath="/repo/test" />);

    const resizer = screen.getByRole('separator', { name: 'Cambiar tamaño del panel de asistencia' });
    expect(resizer.getAttribute('aria-orientation')).toBe('horizontal');
    expect(resizer.getAttribute('aria-label')).toBe('Cambiar tamaño del panel de asistencia');

    fireEvent.mouseDown(resizer, { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 400 });
    fireEvent.mouseUp(window);

    // Arrancar en 500 y mover a 400 sube 100px: 320 + 100 = 420
    expect(useAssistDockStore.getState().height).toBe(420);
  });

  it('6. cambiar de pestaña actualiza activeTabId', () => {
    useAssistDockStore.setState({
      open: true,
      registeredTabs: [
        { id: 'chat', labelKey: 'assist.tabChat' },
        { id: 'centauro-stats', labelKey: 'centauro.tabStats' },
      ],
      activeTabId: 'chat',
    });

    render(<AssistDock repoPath="/repo/test" />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);

    fireEvent.click(tabs[1]);

    expect(useAssistDockStore.getState().activeTabId).toBe('centauro-stats');
    expect(useAssistDockStore.getState().open).toBe(true);
  });

  it('7. el botón de barra lateral está en la barra de pestañas con Chat activo y conmuta chatListOpen', () => {
    useAssistDockStore.setState({ open: true, activeTabId: 'chat', chatListOpen: true });
    render(<AssistDock repoPath="/repo/test" />);

    const toggleBtn = screen.getByRole('button', { name: 'Ocultar las conversaciones' });
    expect(toggleBtn).toBeTruthy();

    fireEvent.click(toggleBtn);
    expect(useAssistDockStore.getState().chatListOpen).toBe(false);
  });

  it('8. el botón de barra lateral no se muestra cuando una pestaña de Centauro está activa', () => {
    useAssistDockStore.setState({
      open: true,
      registeredTabs: [
        { id: 'chat', labelKey: 'assist.tabChat' },
        { id: 'centauro-report', labelKey: 'centauro.tabReport' },
      ],
      activeTabId: 'centauro-report',
      chatListOpen: true,
    });

    render(<AssistDock repoPath="/repo/test" />);

    expect(screen.queryByRole('button', { name: /conversaciones/ })).toBeNull();
  });

  it('9. onOpenAiSettings llega al chat', () => {
    useAssistDockStore.setState({ open: true, activeTabId: 'chat' });
    const onOpenAiSettings = vi.fn();

    render(<AssistDock repoPath="/repo/test" onOpenAiSettings={onOpenAiSettings} />);

    const menuBtn = screen.getByRole('button', { name: 'Más opciones' });
    fireEvent.click(menuBtn);

    const settingsItem = screen.getByRole('menuitem', { name: 'Motores y modelos' });
    expect(settingsItem).toBeTruthy();

    fireEvent.click(settingsItem);
    expect(onOpenAiSettings).toHaveBeenCalledTimes(1);
  });
});
