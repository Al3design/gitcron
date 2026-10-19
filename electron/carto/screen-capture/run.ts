// electron/carto/screen-capture/run.ts
//
// Orquestación del proceso de captura de pantallas para un ScreenMap (decisión 11).

import type {
  ScreenEntry,
  ScreenMap,
  ScreenCaptureRunResult,
  ScreenCaptureSkipReason,
} from '../../../types/screen-map';
import type { DevServerHandle } from './dev-server';

export interface CaptureRunDeps {
  startServer(): Promise<DevServerHandle>;
  capture(url: string, allowedOrigin: string): Promise<Buffer>;
  contentKey(screen: ScreenEntry): Promise<string>;
  stored(): Promise<Map<string, { contentKey: string }>>;
  save(screenId: string, contentKey: string, image: Buffer): Promise<void>;
}

export async function runScreenCaptures(
  map: ScreenMap,
  deps: CaptureRunDeps,
  options: {
    signal?: AbortSignal;
    /** Avisa cada dirección: `running` antes de capturarla, `done` o `failed` después (decisión 14). */
    onScreen?(screenId: string, state: 'running' | 'done' | 'failed', detail?: string): void;
  } = {},
): Promise<ScreenCaptureRunResult> {
  const skipped: { screenId: string; reason: ScreenCaptureSkipReason }[] = [];
  const stored = await deps.stored();

  const candidates: { screen: ScreenEntry; contentKey: string }[] = [];

  for (const screen of map.screens) {
    if (screen.kind === 'view') {
      skipped.push({ screenId: screen.id, reason: 'view' });
    } else if (screen.kind === 'route') {
      if (screen.locator.includes('[')) {
        skipped.push({ screenId: screen.id, reason: 'dynamic-route' });
      } else {
        const key = await deps.contentKey(screen);
        if (stored.get(screen.id)?.contentKey === key) {
          // Ya está al día, no requiere captura
          continue;
        }
        candidates.push({ screen, contentKey: key });
      }
    }
  }

  // Si no queda ninguna candidata, no se arranca el servidor
  if (candidates.length === 0) {
    return {
      captured: 0,
      skipped,
      cancelled: Boolean(options.signal?.aborted),
    };
  }

  if (options.signal?.aborted) {
    return {
      captured: 0,
      skipped,
      cancelled: true,
    };
  }

  let server: DevServerHandle | null = null;
  try {
    server = await deps.startServer();
  } catch (err) {
    return {
      captured: 0,
      skipped,
      cancelled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let captured = 0;
  let cancelled = false;
  const total = candidates.length;
  let allowedOrigin = '';
  try {
    allowedOrigin = new URL(server.url).origin;
  } catch {
    allowedOrigin = server.url;
  }

  try {
    for (let i = 0; i < total; i++) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }

      const { screen, contentKey } = candidates[i];
      options.onScreen?.(screen.id, 'running');
      try {
        const targetUrl = new URL(screen.locator, server.url).toString();
        const image = await deps.capture(targetUrl, allowedOrigin);
        await deps.save(screen.id, contentKey, image);
        captured++;
        options.onScreen?.(screen.id, 'done');
      } catch (err) {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        const msg = err instanceof Error ? err.message : String(err);
        const reason: ScreenCaptureSkipReason = /timeout|tiempo de espera/i.test(msg)
          ? 'timeout'
          : 'load-failed';
        skipped.push({ screenId: screen.id, reason });
        options.onScreen?.(screen.id, 'failed', msg);
      }
    }
  } finally {
    if (server) {
      try {
        server.stop();
      } catch {
        // Ignorar fallo al detener servidor ya cerrado
      }
    }
  }

  return {
    captured,
    skipped,
    cancelled,
  };
}
