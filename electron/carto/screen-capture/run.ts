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

interface Candidate {
  screen: ScreenEntry;
  contentKey: string;
}

interface SkippedEntry {
  screenId: string;
  reason: ScreenCaptureSkipReason;
}

async function selectCandidates(
  screens: ScreenEntry[],
  deps: CaptureRunDeps,
): Promise<{ candidates: Candidate[]; skipped: SkippedEntry[] }> {
  const skipped: SkippedEntry[] = [];
  const stored = await deps.stored();
  const candidates: Candidate[] = [];

  for (const screen of screens) {
    if (screen.kind === 'view') {
      skipped.push({ screenId: screen.id, reason: 'view' });
    } else if (screen.kind === 'route') {
      if (screen.locator.includes('[')) {
        skipped.push({ screenId: screen.id, reason: 'dynamic-route' });
      } else {
        const key = await deps.contentKey(screen);
        if (stored.get(screen.id)?.contentKey !== key) {
          candidates.push({ screen, contentKey: key });
        }
      }
    }
  }

  return { candidates, skipped };
}

async function captureOneScreen(
  candidate: Candidate,
  serverUrl: string,
  allowedOrigin: string,
  deps: CaptureRunDeps,
  options: {
    signal?: AbortSignal;
    onScreen?(screenId: string, state: 'running' | 'done' | 'failed', detail?: string): void;
  },
): Promise<{ success: true } | { success: false; reason: ScreenCaptureSkipReason } | { aborted: true }> {
  const { screen, contentKey } = candidate;
  options.onScreen?.(screen.id, 'running');
  try {
    const targetUrl = new URL(screen.locator, serverUrl).toString();
    const image = await deps.capture(targetUrl, allowedOrigin);
    await deps.save(screen.id, contentKey, image);
    options.onScreen?.(screen.id, 'done');
    return { success: true };
  } catch (err) {
    if (options.signal?.aborted) {
      return { aborted: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    const reason: ScreenCaptureSkipReason = /timeout|tiempo de espera/i.test(msg)
      ? 'timeout'
      : 'load-failed';
    options.onScreen?.(screen.id, 'failed', msg);
    return { success: false, reason };
  }
}

async function iterateCaptures(
  candidates: Candidate[],
  server: DevServerHandle,
  allowedOrigin: string,
  deps: CaptureRunDeps,
  options: {
    signal?: AbortSignal;
    onScreen?(screenId: string, state: 'running' | 'done' | 'failed', detail?: string): void;
  },
  skipped: SkippedEntry[],
): Promise<{ captured: number; cancelled: boolean }> {
  let captured = 0;
  let cancelled = false;

  for (const candidate of candidates) {
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }

    const res = await captureOneScreen(candidate, server.url, allowedOrigin, deps, options);
    if ('aborted' in res) {
      cancelled = true;
      break;
    }
    if (res.success) {
      captured++;
    } else {
      skipped.push({ screenId: candidate.screen.id, reason: res.reason });
    }
  }

  return { captured, cancelled };
}

function safeStopServer(server: DevServerHandle | null): void {
  if (!server) return;
  try {
    server.stop();
  } catch {
    // Ignorar fallo al detener servidor ya cerrado
  }
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
  const { candidates, skipped } = await selectCandidates(map.screens, deps);

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

  let allowedOrigin = '';
  try {
    allowedOrigin = new URL(server.url).origin;
  } catch {
    allowedOrigin = server.url;
  }

  try {
    const { captured, cancelled } = await iterateCaptures(
      candidates,
      server,
      allowedOrigin,
      deps,
      options,
      skipped,
    );
    return {
      captured,
      skipped,
      cancelled,
    };
  } finally {
    safeStopServer(server);
  }
}
