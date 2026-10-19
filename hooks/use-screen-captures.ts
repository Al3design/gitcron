// hooks/use-screen-captures.ts
//
// Hook para el estado de capturas y permisos de ejecución de Cartografía (decisión 11, tarea 2.7).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenCaptureRunResult, ScreenCaptureState, ScreenMap } from '@/types/screen-map';

export function useScreenCaptures(
  repoPath: string | null,
  map: ScreenMap | null,
): {
  state: ScreenCaptureState | null;
  progress: { done: number; total: number; phase?: 'routes' | 'views' } | null;
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
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: 'routes' | 'views' } | null>(null);
  const [lastRun, setLastRun] = useState<ScreenCaptureRunResult | null>(null);
  const [fetchKey, setFetchKey] = useState<number>(0);

  const autoRunRef = useRef<string | null>(null);

  const refreshState = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  // Escuchar progreso del IPC
  useEffect(() => {
    if (!repoPath || typeof window === 'undefined' || !window.api?.cartoCaptures?.onProgress) {
      return;
    }
    const unsubscribe = window.api.cartoCaptures.onProgress((payload) => {
      if (payload.repoPath === repoPath) {
        setProgress({ done: payload.done, total: payload.total, phase: payload.phase });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [repoPath]);

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
      setProgress(null);
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
      setProgress(null);
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
    progress,
    lastRun,
    grant,
    revoke,
    run,
    cancel,
  };
}
