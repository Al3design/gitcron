// hooks/use-screen-captures.ts
//
// Hook para el estado de capturas y permisos de ejecución de Cartografía (decisión 11, tarea 2.7).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CaptureItem,
  ScreenCaptureRunResult,
  ScreenCaptureState,
  ScreenMap,
} from '@/types/screen-map';

/** Como mucho una relectura de las capturas cada tanto, mientras llegan fotos (decisión 14). */
const CAPTURE_REFRESH_MIN_MS = 2000;

const EMPTY_ITEMS: CaptureItem[] = [];

export function useScreenCaptures(
  repoPath: string | null,
  map: ScreenMap | null,
): {
  state: ScreenCaptureState | null;
  /** Las pantallas de la corrida en curso o de la última, con su estado. */
  items: CaptureItem[];
  /** Hay una corrida entre su plan y su fin. */
  active: boolean;
  lastRun: ScreenCaptureRunResult | null;
  grant(): Promise<void>;
  revoke(): Promise<void>;
  run(): Promise<void>;
  cancel(): Promise<void>;
} {
  // El estado guarda de qué repo es: al cambiar de repo no se usa el del anterior, ni para
  // mostrar ni para decidir si corre solo.
  const [stateEntry, setStateEntry] = useState<{ repoPath: string; data: ScreenCaptureState } | null>(null);
  const state = stateEntry && stateEntry.repoPath === repoPath ? stateEntry.data : null;
  // La lista también guarda de qué repo es; `finished` no la borra, así el resumen queda a la vista.
  const [itemsEntry, setItemsEntry] = useState<{ repoPath: string; items: CaptureItem[]; active: boolean } | null>(null);
  const currentItems = itemsEntry && itemsEntry.repoPath === repoPath ? itemsEntry : null;
  const [lastRun, setLastRun] = useState<ScreenCaptureRunResult | null>(null);
  const [fetchKey, setFetchKey] = useState<number>(0);

  const autoRunRef = useRef<string | null>(null);

  const refreshState = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  // Escuchar el avance del IPC: plan, un item por cambio de estado y finished.
  useEffect(() => {
    if (!repoPath || typeof window === 'undefined' || !window.api?.cartoCaptures?.onProgress) {
      return;
    }
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt = 0;
    // Una foto lista se ve en su cuadro al releer el estado; con muchas seguidas, se relee como
    // mucho una vez cada CAPTURE_REFRESH_MIN_MS.
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      const wait = Math.max(0, CAPTURE_REFRESH_MIN_MS - (Date.now() - lastRefreshAt));
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        lastRefreshAt = Date.now();
        refreshState();
      }, wait);
    };

    const unsubscribe = window.api.cartoCaptures.onProgress((payload) => {
      if (payload.repoPath !== repoPath) return;
      if (payload.kind === 'plan') {
        setItemsEntry({ repoPath, items: payload.items, active: true });
      } else if (payload.kind === 'item') {
        setItemsEntry((prev) => {
          if (!prev || prev.repoPath !== repoPath) return prev;
          return {
            ...prev,
            items: prev.items.map((item) =>
              item.screenId === payload.screenId
                ? { ...item, state: payload.state, detail: payload.detail ?? item.detail }
                : item,
            ),
          };
        });
        if (payload.state === 'done') scheduleRefresh();
      } else {
        setItemsEntry((prev) => (prev && prev.repoPath === repoPath ? { ...prev, active: false } : prev));
      }
    });
    return () => {
      unsubscribe();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [repoPath, refreshState]);

  // Cargar estado al cambiar repoPath, map?.headSha o fetchKey
  useEffect(() => {
    if (!repoPath) {
      return;
    }
    let active = true;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.cartoCaptures?.get) {
      return;
    }

    api.cartoCaptures
      .get(repoPath)
      .then((res) => {
        if (!active) return;
        if (res.success && res.data) {
          setStateEntry({ repoPath, data: res.data });
        }
      })
      .catch((err: unknown) => {
        console.warn('[useScreenCaptures] error al consultar estado', err);
      });

    return () => {
      active = false;
    };
  }, [repoPath, map?.headSha, fetchKey]);

  const run = useCallback(async () => {
    if (!repoPath) return;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.cartoCaptures?.run) return;

    try {
      const res = await api.cartoCaptures.run(repoPath);
      if (res.success && res.data) {
        setLastRun(res.data);
      } else if (res.error) {
        setLastRun({
          captured: 0,
          skipped: [],
          cancelled: false,
          error: res.error,
        });
      }
    } catch (err: unknown) {
      setLastRun({
        captured: 0,
        skipped: [],
        cancelled: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      refreshState();
    }
  }, [repoPath, refreshState]);

  const grant = useCallback(async () => {
    if (!repoPath || !state || state.consent.status !== 'needs-consent') return;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.cartoCaptures?.consent) return;

    try {
      const res = await api.cartoCaptures.consent({
        repoPath,
        command: state.consent.command,
      });
      if (res.success && res.data) {
        setStateEntry({ repoPath, data: res.data });
      }
    } finally {
      refreshState();
    }
  }, [repoPath, state, refreshState]);

  const revoke = useCallback(async () => {
    if (!repoPath) return;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.cartoCaptures?.revoke) return;

    try {
      const res = await api.cartoCaptures.revoke(repoPath);
      if (res.success && res.data) {
        setStateEntry({ repoPath, data: res.data });
      }
    } finally {
      refreshState();
    }
  }, [repoPath, refreshState]);

  const cancel = useCallback(async () => {
    if (!repoPath) return;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.cartoCaptures?.cancel) return;

    try {
      await api.cartoCaptures.cancel(repoPath);
    } finally {
      refreshState();
    }
  }, [repoPath, refreshState]);

  // Corre solo: si el permiso está dado, hay al menos una pantalla con dirección (sin `[`)
  // sin captura o con `stale`, y no hay corrida, llama a `run()` una vez por `repoPath + headSha`.
  useEffect(() => {
    if (!repoPath || !map || !state) return;
    if (state.consent.status !== 'granted' || state.running) return;

    const currentKey = `${repoPath}:${map.headSha ?? 'no-sha'}`;
    if (autoRunRef.current === currentKey) return;

    const routeScreens = map.screens.filter(
      (s) => s.kind === 'route' && !s.locator.includes('['),
    );
    const viewScreens = state.hasRecipes ? map.screens.filter((s) => s.kind === 'view') : [];
    const candidateScreens = [...routeScreens, ...viewScreens];
    const needsRun = candidateScreens.some((s) => {
      const cap = state.captures[s.id];
      return !cap || cap.stale;
    });

    if (needsRun) {
      autoRunRef.current = currentKey;
      // Fuera del cuerpo del efecto: `run` cambia estado (react-hooks/set-state-in-effect).
      void Promise.resolve().then(run);
    }
  }, [repoPath, map, state, run]);

  return {
    state,
    items: currentItems?.items ?? EMPTY_ITEMS,
    active: currentItems?.active ?? false,
    lastRun,
    grant,
    revoke,
    run,
    cancel,
  };
}
