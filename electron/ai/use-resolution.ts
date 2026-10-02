// electron/ai/use-resolution.ts
//
// Resolver un uso de texto desde el proceso principal (tarea 4.3): el gitcron.json
// global en uso, el del repositorio sólo si es una pestaña abierta, y `{env:}` del
// sistema y de las variables guardadas en GitCron (D5). Las cuatro pantallas de
// texto pasan por acá; ninguna elige proveedor por su cuenta.

import { authorizedRepoRoot } from '../ipc/authorized-repos';
import { getDefaultConfigPath } from './config/gitcron-config';
import { resolveModelFor, type ResolvedModelFor, type TextUse } from './config/resolve-model-for';
import { getStoredEnvVar } from './key-store';
import { serverOrigin } from './config/provider-models';

let configPathOverride: string | null = null;

/** Para pruebas: otro gitcron.json global. */
export function setUseConfigPathForTesting(p: string | null): void {
  configPathOverride = p;
}

export function activeConfigPath(): string {
  return configPathOverride ?? getDefaultConfigPath();
}

/**
 * El repositorio cuenta sólo si es una pestaña abierta; si no, se usa el global
 * solo (una ruta suelta del renderer no alcanza para leer su gitcron.json).
 */
export function resolveForUse(use: TextUse, repoPath?: unknown, screenModel?: string | null): ResolvedModelFor {
  const repo = repoPath === undefined || repoPath === null ? null : authorizedRepoRoot(repoPath);
  return resolveModelFor(use, { configPath: activeConfigPath(), repoPath: repo, stored: getStoredEnvVar, screenModel });
}

/** El servidor donde se listan, cargan y expulsan modelos de LM Studio para un uso. */
export interface LoadServer {
  /** Origen del servidor, sin `/v1`. */
  serverUrl: string;
  /** Cabeceras del proveedor y la clave como Bearer, para preguntar si tiene la API nativa. */
  headers: Record<string, string>;
}

/**
 * Lo que el selector usa cuando el uso no tiene modelo en el archivo: cualquier
 * identificador sirve, sólo importa el proveedor `lmstudio` que declare el archivo.
 */
const SCREEN_PROBE_MODEL = 'selector';

/**
 * El servidor de carga de un uso (D6, D11): el de su proveedor si es un servidor del
 * estándar, o, sin modelo en el archivo, el del proveedor `lmstudio` que declare
 * gitcron.json (el del selector). Nunca una dirección fija: sin proveedor, el motivo.
 */
export function loadServerFor(use: TextUse, repoPath?: unknown): { server: LoadServer } | { error: string } {
  let target: ResolvedModelFor;
  try {
    target = resolveForUse(use, repoPath);
    if (target.status === 'unset') target = resolveForUse(use, repoPath, SCREEN_PROBE_MODEL);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (target.status === 'disabled') return { error: 'Este uso está desactivado en gitcron.json.' };
  if (target.status !== 'resolved') return { error: 'Este uso no tiene modelo en gitcron.json.' };
  const resolved = target.resolved;
  if (resolved.kind !== 'openai-compatible') {
    return { error: `${resolved.providerName} no es un servidor donde se carguen modelos.` };
  }
  if (!resolved.available || !resolved.baseURL) {
    return { error: resolved.unavailableReason ?? `${resolved.providerName} no declara options.baseURL.` };
  }
  return {
    server: {
      serverUrl: serverOrigin(resolved.baseURL),
      headers: {
        ...(resolved.headers ?? {}),
        ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {}),
      },
    },
  };
}
