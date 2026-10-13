// lib/assist/assist-dock-store.ts
// Store Zustand para el dock inferior de asistencia (chat + pestañas contextuales).

import { create } from 'zustand';

import type { TemporalIdeaRef } from './view-contributors';

export interface AssistDockTab {
  id: string;
  labelKey: string;
}

export interface AssistDockState {
  open: boolean;
  height: number;
  activeTabId: string;
  registeredTabs: AssistDockTab[];
  slot: HTMLElement | null;
  conversationByRepo: Record<string, string>;
  temporalIdea: TemporalIdeaRef | null;

  setOpen: (open: boolean) => void;
  toggle: () => void;
  setHeight: (height: number) => void;
  setActiveTab: (id: string) => void;
  registerTabs: (tabs: AssistDockTab[]) => () => void;
  setSlot: (el: HTMLElement | null) => void;
  rememberConversation: (repoPath: string, conversationId: string) => void;
  setTemporalIdea: (idea: TemporalIdeaRef | null) => void;
}

const DEFAULT_TAB: AssistDockTab = { id: 'chat', labelKey: 'assist.tabChat' };
/** El panel abierto nunca mide menos que esto. El tope (75 % del área) lo pone el panel, que conoce su contenedor. */
export const ASSIST_DOCK_MIN_HEIGHT = 200;
const DEFAULT_HEIGHT = 320;
const OPEN_KEY = 'gitcron:assistDockOpen';
const HEIGHT_KEY = 'gitcron:assistDockHeightPx';
/** El alto que la persona le había dado al panel de Centauro: es el de partida la primera vez. */
const CENTAURO_HEIGHT_KEY = 'gitcron:centauroHeightPx';

function clampHeight(height: number): number {
  return Math.max(ASSIST_DOCK_MIN_HEIGHT, Math.round(height));
}

/** localStorage puede no estar (pruebas, almacenamiento bloqueado): entonces vale el valor por omisión. */
function readStored(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null; // sin almacenamiento, se usa el valor por omisión
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch (error) {
    console.warn('[assist-dock] no se pudo recordar', key, error);
  }
}

function initialHeight(): number {
  for (const key of [HEIGHT_KEY, CENTAURO_HEIGHT_KEY]) {
    const value = Number(readStored(key));
    if (Number.isFinite(value) && value > 0) return clampHeight(value);
  }
  return DEFAULT_HEIGHT;
}

export const useAssistDockStore = create<AssistDockState>((set) => ({
  open: readStored(OPEN_KEY) === 'true',
  height: initialHeight(),
  activeTabId: 'chat',
  registeredTabs: [DEFAULT_TAB],
  slot: null,
  conversationByRepo: {},

  setOpen: (open) => {
    writeStored(OPEN_KEY, String(open));
    set({ open });
  },

  toggle: () => set((state) => {
    writeStored(OPEN_KEY, String(!state.open));
    return { open: !state.open };
  }),

  setHeight: (height) => {
    const next = clampHeight(height);
    writeStored(HEIGHT_KEY, String(next));
    set({ height: next });
  },

  // Una pestaña que no existe (de una vista que ya no está) no se elige.
  setActiveTab: (id) => set((state) => (state.registeredTabs.some((tab) => tab.id === id) ? { activeTabId: id } : {})),

  registerTabs: (newTabs) => {
    set((state) => {
      const existing = [...state.registeredTabs];
      for (const t of newTabs) {
        if (!existing.some((e) => e.id === t.id)) {
          existing.push(t);
        }
      }
      return { registeredTabs: existing };
    });

    return () => {
      const removeIds = new Set(newTabs.map((t) => t.id));
      set((state) => {
        const remaining = state.registeredTabs.filter((t) => !removeIds.has(t.id));
        const activeTabId = removeIds.has(state.activeTabId) ? 'chat' : state.activeTabId;
        return {
          registeredTabs: remaining.length > 0 ? remaining : [DEFAULT_TAB],
          activeTabId,
        };
      });
    };
  },

  setSlot: (slot) => set({ slot }),

  rememberConversation: (repoPath, conversationId) =>
    set((state) => ({
      conversationByRepo: {
        ...state.conversationByRepo,
        [repoPath]: conversationId,
      },
    })),

  temporalIdea: null,
  setTemporalIdea: (temporalIdea) => set({ temporalIdea }),
}));
