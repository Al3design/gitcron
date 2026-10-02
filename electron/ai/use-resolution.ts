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
