// @vitest-environment jsdom
// lib/__tests__/assist-dock-store.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ASSIST_DOCK_MIN_HEIGHT, useAssistDockStore } from '../assist/assist-dock-store';

describe('useAssistDockStore', () => {
  beforeEach(() => {
    useAssistDockStore.setState({
      open: false,
      height: 320,
      chatListOpen: true,
      chatListWidth: 256,
      activeTabId: 'chat',
      registeredTabs: [{ id: 'chat', labelKey: 'assist.tabChat' }],
      slot: null,
      conversationByRepo: {},
    });
  });

  it('controla el estado open y toggle', () => {
    expect(useAssistDockStore.getState().open).toBe(false);
    useAssistDockStore.getState().setOpen(true);
    expect(useAssistDockStore.getState().open).toBe(true);
    useAssistDockStore.getState().toggle();
    expect(useAssistDockStore.getState().open).toBe(false);
  });

  it('nunca baja del alto mínimo; el tope lo pone el panel según su contenedor', () => {
    useAssistDockStore.getState().setHeight(100);
    expect(useAssistDockStore.getState().height).toBe(ASSIST_DOCK_MIN_HEIGHT);
    useAssistDockStore.getState().setHeight(500);
    expect(useAssistDockStore.getState().height).toBe(500);
  });

  it('recuerda en el disco si estaba abierto y su alto', () => {
    localStorage.clear();
    useAssistDockStore.getState().setOpen(true);
    useAssistDockStore.getState().setHeight(450);
    expect(localStorage.getItem('gitcron:assistDockOpen')).toBe('true');
    expect(localStorage.getItem('gitcron:assistDockHeightPx')).toBe('450');
    useAssistDockStore.getState().toggle();
    expect(localStorage.getItem('gitcron:assistDockOpen')).toBe('false');
  });

  it('al arrancar toma lo guardado y, la primera vez, el alto de Centauro', async () => {
    localStorage.clear();
    localStorage.setItem('gitcron:centauroHeightPx', '480');
    vi.resetModules();
    const primera = await import('../assist/assist-dock-store');
    expect(primera.useAssistDockStore.getState().height).toBe(480);
    expect(primera.useAssistDockStore.getState().open).toBe(false);

    localStorage.setItem('gitcron:assistDockHeightPx', '300');
    localStorage.setItem('gitcron:assistDockOpen', 'true');
    vi.resetModules();
    const segunda = await import('../assist/assist-dock-store');
    expect(segunda.useAssistDockStore.getState().height).toBe(300);
    expect(segunda.useAssistDockStore.getState().open).toBe(true);
    localStorage.clear();
  });

  it('cambia a una pestaña registrada e ignora una que no existe', () => {
    useAssistDockStore.getState().setActiveTab('centauro-report');
    expect(useAssistDockStore.getState().activeTabId).toBe('chat');
    useAssistDockStore.getState().registerTabs([{ id: 'centauro-report', labelKey: 'centauro.tabReport' }]);
    useAssistDockStore.getState().setActiveTab('centauro-report');
    expect(useAssistDockStore.getState().activeTabId).toBe('centauro-report');
  });

  it('registra pestañas sin duplicar y limpia al desmontar', () => {
    const unregister = useAssistDockStore.getState().registerTabs([
      { id: 'tab1', labelKey: 'assist.tab1' },
      { id: 'tab2', labelKey: 'assist.tab2' },
    ]);

    expect(useAssistDockStore.getState().registeredTabs).toHaveLength(3);
    expect(useAssistDockStore.getState().registeredTabs.map((t) => t.id)).toEqual(['chat', 'tab1', 'tab2']);

    // Registrar de nuevo la misma no duplica
    useAssistDockStore.getState().registerTabs([{ id: 'tab1', labelKey: 'assist.tab1' }]);
    expect(useAssistDockStore.getState().registeredTabs).toHaveLength(3);

    // Si la activa es tab1 y se desregistra, vuelve a chat
    useAssistDockStore.getState().setActiveTab('tab1');
    unregister();

    expect(useAssistDockStore.getState().registeredTabs.map((t) => t.id)).toEqual(['chat']);
    expect(useAssistDockStore.getState().activeTabId).toBe('chat');
  });

  it('permite fijar y leer el slot', () => {
    const div = document.createElement('div');
    useAssistDockStore.getState().setSlot(div);
    expect(useAssistDockStore.getState().slot).toBe(div);
    useAssistDockStore.getState().setSlot(null);
    expect(useAssistDockStore.getState().slot).toBeNull();
  });

  it('recuerda la conversación por repo', () => {
    useAssistDockStore.getState().rememberConversation('/repo/a', 'conv-1');
    useAssistDockStore.getState().rememberConversation('/repo/b', 'conv-2');
    expect(useAssistDockStore.getState().conversationByRepo['/repo/a']).toBe('conv-1');
    expect(useAssistDockStore.getState().conversationByRepo['/repo/b']).toBe('conv-2');
  });

  it('setTemporalIdea fija la idea en memoria y no la guarda en disco', () => {
    localStorage.clear();
    expect(useAssistDockStore.getState().temporalIdea).toBeNull();

    useAssistDockStore.getState().setTemporalIdea({ runId: 'run-1', branchId: 'br-1' });
    expect(useAssistDockStore.getState().temporalIdea).toEqual({ runId: 'run-1', branchId: 'br-1' });

    // No se guarda en localStorage
    expect(localStorage.getItem('gitcron:temporalIdea')).toBeNull();
    expect(localStorage.getItem('gitcron:assistTemporalIdea')).toBeNull();
    expect(localStorage.length).toBe(0);

    useAssistDockStore.getState().setTemporalIdea(null);
    expect(useAssistDockStore.getState().temporalIdea).toBeNull();
  });

  it('el ancho queda entre 180 y 480 y se guarda en localStorage con gitcron:assistChatListWidthPx', () => {
    localStorage.clear();
    useAssistDockStore.getState().setChatListWidth(100);
    expect(useAssistDockStore.getState().chatListWidth).toBe(180);
    expect(localStorage.getItem('gitcron:assistChatListWidthPx')).toBe('180');

    useAssistDockStore.getState().setChatListWidth(600);
    expect(useAssistDockStore.getState().chatListWidth).toBe(480);
    expect(localStorage.getItem('gitcron:assistChatListWidthPx')).toBe('480');

    useAssistDockStore.getState().setChatListWidth(300);
    expect(useAssistDockStore.getState().chatListWidth).toBe(300);
    expect(localStorage.getItem('gitcron:assistChatListWidthPx')).toBe('300');
  });

  it('setChatListOpen(false) se guarda como false y el valor inicial sin nada guardado es true', async () => {
    localStorage.clear();
    vi.resetModules();
    const mod = await import('../assist/assist-dock-store');
    expect(mod.useAssistDockStore.getState().chatListOpen).toBe(true);

    mod.useAssistDockStore.getState().setChatListOpen(false);
    expect(mod.useAssistDockStore.getState().chatListOpen).toBe(false);
    expect(localStorage.getItem('gitcron:assistChatListOpen')).toBe('false');

    mod.useAssistDockStore.getState().setChatListOpen(true);
    expect(mod.useAssistDockStore.getState().chatListOpen).toBe(true);
    expect(localStorage.getItem('gitcron:assistChatListOpen')).toBe('true');
  });
});
