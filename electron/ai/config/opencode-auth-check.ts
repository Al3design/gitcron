// electron/ai/config/opencode-auth-check.ts
//
// Comprobación de que OpenCode use la misma clave que GitCron (tarea 5.3 segunda parte, D8).
//
// Antes de lanzar con un modelo de servidor (y después de copiar), el proceso principal
// compara lo que OpenCode va a mandar (`settings.apiKey` y cabeceras en `model.list`)
// con lo que resuelve GitCron para ese proveedor (`resolveUse`, con el baúl).
//
// SEGURIDAD E HIGIENE:
// Ningún valor de clave, secreto ni cabecera sale nunca de este módulo ni viaja hacia el
// renderer o logs. Sólo se devuelven los tipos de aviso y nombres de variables / comandos.
//
// Cuatro casos:
// 1. Igual -> Sin aviso.
// 2. OpenCode lo ve vacío y GitCron no -> 'missing_env' (variable no vista por el servicio).
// 3. Distinto y hay una clave en auth.json -> 'auth_json_override' (con orden logout).
// 4. Distinto sin clave en auth.json -> 'mismatch_other' (OpenCode resuelve otra clave).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadGitCronConfig, resolveUse, substituteReferences, type GitCronConfig } from './gitcron-config';
import { envVarNameFrom } from './literal-secrets';
import { queryOpenCodeModelCredentials, type OpenCodeResolvedCredentials } from './opencode-models';
import { activeConfigPath } from '../use-resolution';
import { getStoredEnvVar } from '../key-store';
import type { RuntimeProcessRunner } from '../../pipeline/runtime-adapters/process-runner';

/**
 * `<data>/auth.json` de OpenCode (en Windows `~/.local/share/opencode/auth.json`).
 */
export function getDefaultOpenCodeAuthPath(): string {
  const baseDir = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim()
    ? process.env.XDG_DATA_HOME.trim()
    : path.join(os.homedir(), '.local', 'share');
  return path.join(baseDir, 'opencode', 'auth.json');
}

export type OpenCodeAuthNotice =
  | { kind: 'missing_env'; variableName: string }
  | { kind: 'auth_json_override'; providerId: string; logoutCommand: string }
  | { kind: 'mismatch_other'; providerId: string };

export interface OpenCodeAuthCheckResult {
  status: 'match' | 'mismatch';
  notice: OpenCodeAuthNotice | null;
}

export interface CheckOpenCodeAuthOptions {
  repoPath?: string | null;
  providerId: string;
  modelId: string;
  configPath?: string;
  authPath?: string;
  runner?: RuntimeProcessRunner;
  stored?: (name: string) => string | undefined;
  env?: NodeJS.ProcessEnv;
  /** Para pruebas o cuando las credenciales de OpenCode ya fueron consultadas */
  opencodeResolvedCredentials?: OpenCodeResolvedCredentials | null;
  /** Configuración cargada directamente para pruebas */
  config?: GitCronConfig;
}

const isObject = (val: unknown): val is Record<string, unknown> =>
  val !== null && typeof val === 'object' && !Array.isArray(val);

function compareHeaders(
  gitcron: Record<string, string>,
  opencode: Record<string, string>,
): boolean {
  const gKeys = Object.keys(gitcron);
  const oKeys = Object.keys(opencode);
  for (const k of gKeys) {
    const gVal = (gitcron[k] ?? '').trim();
    const oVal = (opencode[k] ?? '').trim();
    if (gVal !== oVal) return false;
  }
  for (const k of oKeys) {
    if (!gKeys.includes(k) && (opencode[k] ?? '').trim() !== '') return false;
  }
  return true;
}

function hasNonEmptyHeaders(headers: Record<string, string>): boolean {
  return Object.values(headers).some((v) => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Busca el nombre de la variable de entorno que define la clave o cabecera en el proveedor.
 */
function findVariableName(provider: unknown, providerId: string): string {
  if (!isObject(provider)) return envVarNameFrom(`${providerId}_API_KEY`);

  const options = isObject(provider.options) ? provider.options : {};
  if (typeof options.apiKey === 'string') {
    const match = options.apiKey.match(/\{env:([A-Za-z0-9_]+)\}/);
    if (match) return match[1];
  }

  if (typeof provider.apiKey === 'string') {
    const match = provider.apiKey.match(/\{env:([A-Za-z0-9_]+)\}/);
    if (match) return match[1];
  }

  if (isObject(options.headers)) {
    for (const val of Object.values(options.headers)) {
      if (typeof val === 'string') {
        const match = val.match(/\{env:([A-Za-z0-9_]+)\}/);
        if (match) return match[1];
      }
    }
  }

  return envVarNameFrom(`${providerId}_API_KEY`);
}

/**
 * Comprueba si el almacén de credenciales de OpenCode (`auth.json`) tiene una clave para este id.
 */
function hasAuthJsonKey(authPath: string, providerId: string): boolean {
  if (!fs.existsSync(authPath)) return false;
  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (isObject(parsed) && isObject(parsed[providerId])) {
      const entry = parsed[providerId] as Record<string, unknown>;
      return typeof entry.key === 'string' && entry.key.trim().length > 0;
    }
  } catch {
    // Si auth.json no es un JSON legible, se considera ausente
  }
  return false;
}

/**
 * Realiza la comparación entre lo que GitCron resuelve y lo que OpenCode va a mandar.
 */
export async function checkOpenCodeAuth(
  options: CheckOpenCodeAuthOptions,
): Promise<OpenCodeAuthCheckResult> {
  const { providerId, modelId } = options;
  const configPath = options.configPath ?? activeConfigPath();
  const repoPath = options.repoPath ?? null;
  const stored = options.stored ?? getStoredEnvVar;
  const env = options.env ?? process.env;
  const authPath = options.authPath ?? getDefaultOpenCodeAuthPath();
  const loaded = options.config
    ? { config: options.config }
    : loadGitCronConfig({ globalPath: configPath, repoPath });
  const rawProvider = loaded.config?.provider?.[providerId];

  // 1. Obtener lo que resuelve GitCron (con el baúl de claves)
  const resolved = resolveUse('gitcron-sdd', {
    configPath,
    repoPath,
    stored,
    env,
  });

  let gitcronApiKey = resolved?.apiKey ? String(resolved.apiKey).trim() : '';
  const gitcronHeaders: Record<string, string> = {};
  if (resolved?.headers && isObject(resolved.headers)) {
    for (const [k, v] of Object.entries(resolved.headers)) {
      if (typeof v === 'string') gitcronHeaders[k] = v;
    }
  }

  // Si resolveUse no devolvió apiKey porque faltaba baseURL u otro campo, resolver directamente de rawProvider
  if (!gitcronApiKey && rawProvider && isObject(rawProvider)) {
    const rawOptions = isObject(rawProvider.options) ? rawProvider.options : {};
    const keyRef = typeof rawOptions.apiKey === 'string' ? rawOptions.apiKey : typeof rawProvider.apiKey === 'string' ? rawProvider.apiKey : undefined;
    if (keyRef) {
      const sub = substituteReferences(keyRef, { env, stored });
      if (typeof sub.value === 'string') gitcronApiKey = sub.value.trim();
    }
    if (Object.keys(gitcronHeaders).length === 0 && isObject(rawOptions.headers)) {
      const sub = substituteReferences(rawOptions.headers, { env, stored });
      if (isObject(sub.value)) {
        for (const [k, v] of Object.entries(sub.value)) {
          if (typeof v === 'string') gitcronHeaders[k] = v;
        }
      }
    }
  }

  // 2. Obtener lo que OpenCode va a mandar
  let opencodeCreds = options.opencodeResolvedCredentials;
  if (opencodeCreds === undefined && repoPath) {
    opencodeCreds = await queryOpenCodeModelCredentials(
      repoPath,
      providerId,
      modelId,
      options.runner,
    );
  }

  const opencodeApiKey = opencodeCreds?.apiKey ? String(opencodeCreds.apiKey).trim() : '';
  const opencodeHeaders: Record<string, string> = {};
  if (opencodeCreds?.headers && isObject(opencodeCreds.headers)) {
    for (const [k, v] of Object.entries(opencodeCreds.headers)) {
      if (typeof v === 'string') opencodeHeaders[k] = v;
    }
  }

  // 3. Comparación de igualdad
  const keysEqual = gitcronApiKey === opencodeApiKey;
  const headersEqual = compareHeaders(gitcronHeaders, opencodeHeaders);

  if (keysEqual && headersEqual) {
    return { status: 'match', notice: null };
  }

  // 4. Caso 2: OpenCode lo ve vacío y GitCron no
  const gitcronHasCredentials = gitcronApiKey.length > 0 || hasNonEmptyHeaders(gitcronHeaders);
  const opencodeIsEmpty = opencodeApiKey.length === 0 && !hasNonEmptyHeaders(opencodeHeaders);

  if (gitcronHasCredentials && opencodeIsEmpty) {
    const loaded = options.config
      ? { config: options.config }
      : loadGitCronConfig({ globalPath: configPath, repoPath });
    const rawProvider = loaded.config?.provider?.[providerId];
    const variableName = findVariableName(rawProvider, providerId);

    return {
      status: 'mismatch',
      notice: {
        kind: 'missing_env',
        variableName,
      },
    };
  }

  // 5. Caso 3: Distinto y hay una clave para ese id en auth.json
  const hasSavedAuth = hasAuthJsonKey(authPath, providerId);
  if (hasSavedAuth) {
    return {
      status: 'mismatch',
      notice: {
        kind: 'auth_json_override',
        providerId,
        logoutCommand: `opencode auth logout ${providerId}`,
      },
    };
  }

  // 6. Caso 4: Distinto sin clave en auth.json
  return {
    status: 'mismatch',
    notice: {
      kind: 'mismatch_other',
      providerId,
    },
  };
}
