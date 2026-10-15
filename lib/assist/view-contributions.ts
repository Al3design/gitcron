import type { ContextSelection } from '@/types/assist-context';

/** Qué hace una acción: consultar no cambia nada; preparar deja algo listo sin confirmarlo; ejecutar sí cambia. */
export type AssistActionScope = 'consult' | 'prepare' | 'execute';

export interface AssistAction {
  /** Único dentro de la vista, por ejemplo 'explain-commit'. */
  id: string;
  /** Clave de traducción del rótulo (no el texto). */
  labelKey: string;
  /** Parámetros del rótulo, como los de `t(key, params)`. */
  labelParams?: Record<string, string | number>;
  scope: AssistActionScope;
  /** Si hoy se puede usar. */
  available: boolean;
  /** Clave de traducción de por qué no se puede; obligatoria cuando `available` es false. */
  unavailableReasonKey?: string;
  /** Si al ejecutarla se pide la confirmación que ya existe para esa operación. */
  requiresConfirmation: boolean;
  /**
   * Qué hace al elegirla, en la pantalla (nunca en el proceso principal). Obligatorio para
   * `prepare` y `execute`: es el mismo manejador del botón de la vista, con su confirmación.
   */
  run?: () => void;
}

export interface ViewContribution {
  viewId: string;
  selection: ContextSelection;
  actions: AssistAction[];
}

/** Lo que registra cada vista: una función que lee su estado actual al momento de preguntar. */
export type ViewContributor = () => { selection: ContextSelection; actions: AssistAction[] };

export interface ContributionRegistry {
  /** Registra la vista. Devuelve la baja. */
  register(viewId: string, contributor: ViewContributor): () => void;
  /** Lo que la vista aporta ahora. Nunca tira. */
  contributionFor(viewId: string): ViewContribution;
  /** Las vistas registradas, en el orden en que se registraron. */
  registeredViews(): string[];
  /** Avisa a quien escucha que alguna vista cambió lo que tiene elegido. */
  notify(): void;
  /** Escucha esos avisos. Devuelve la baja. */
  subscribe(listener: () => void): () => void;
}

function isValidAction(action: AssistAction): boolean {
  if (!action.id || action.id.trim() === '') {
    return false;
  }
  if (!action.available) {
    if (!action.unavailableReasonKey || action.unavailableReasonKey.trim() === '') {
      return false;
    }
  }
  if ((action.scope === 'prepare' || action.scope === 'execute') && typeof action.run !== 'function') {
    return false;
  }
  return true;
}

function normalizeActions(actions: AssistAction[]): AssistAction[] {
  const seenIds = new Set<string>();
  const normalized: AssistAction[] = [];

  for (const action of actions) {
    if (!isValidAction(action)) {
      continue;
    }
    if (seenIds.has(action.id)) {
      continue;
    }
    seenIds.add(action.id);
    normalized.push({ ...action });
  }

  return normalized;
}

function fallbackContribution(viewId: string): ViewContribution {
  return {
    viewId,
    selection: { kind: 'none' },
    actions: [],
  };
}

export function createContributionRegistry(): ContributionRegistry {
  const contributors = new Map<string, ViewContributor>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.warn('Error en oyente de assistContributions:', error);
      }
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function register(viewId: string, contributor: ViewContributor): () => void {
    if (viewId.trim() === '') {
      throw new Error('viewId vacío');
    }
    contributors.set(viewId, contributor);
    notify();
    return () => {
      if (contributors.get(viewId) === contributor) {
        contributors.delete(viewId);
        notify();
      }
    };
  }

  function contributionFor(viewId: string): ViewContribution {
    const contributor = contributors.get(viewId);
    if (!contributor) {
      return fallbackContribution(viewId);
    }
    try {
      const current = contributor();
      return {
        viewId,
        selection: current.selection ?? { kind: 'none' },
        actions: normalizeActions(current.actions ?? []),
      };
    } catch (_error) {
      return fallbackContribution(viewId);
    }
  }

  function registeredViews(): string[] {
    return [...contributors.keys()];
  }

  return {
    register,
    contributionFor,
    registeredViews,
    notify,
    subscribe,
  };
}
