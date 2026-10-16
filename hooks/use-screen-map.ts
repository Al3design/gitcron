import { useEffect, useState } from 'react';
import type { ScreenMap } from '@/types/screen-map';

interface ScreenMapResult {
  /** De qué pedido es la respuesta: repo y vuelta de actualización. */
  key: string;
  map: ScreenMap | null;
  error: string | null;
}

/**
 * Lee el mapa de pantallas del repo (carto-screens:get). «Cargando» se deduce de que la
 * última respuesta todavía no es la del pedido actual: así el efecto no cambia el estado
 * de golpe al arrancar (regla react-hooks/set-state-in-effect).
 */
export function useScreenMap(
  repoPath: string | null,
  refreshKey: number,
): {
  map: ScreenMap | null;
  loading: boolean;
  error: string | null;
} {
  const requestKey = repoPath ? `${repoPath}#${refreshKey}` : '';
  const [result, setResult] = useState<ScreenMapResult | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    let active = true;
    const key = `${repoPath}#${refreshKey}`;
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.cartoScreens?.get) {
      void Promise.resolve().then(() => {
        if (active) setResult({ key, map: null, error: 'La lectura de pantallas no está disponible.' });
      });
      return () => {
        active = false;
      };
    }

    api.cartoScreens
      .get(repoPath)
      .then((res) => {
        if (!active) return;
        if (res.success && res.data) setResult({ key, map: res.data, error: null });
        else setResult({ key, map: null, error: res.error ?? 'No se pudo cargar el mapa de pantallas.' });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setResult({ key, map: null, error: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      active = false;
    };
  }, [repoPath, refreshKey]);

  if (!repoPath) return { map: null, loading: false, error: null };
  const current = result?.key === requestKey ? result : null;
  return { map: current?.map ?? null, loading: current === null, error: current?.error ?? null };
}
