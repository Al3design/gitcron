// electron/ai/config/gitcron-config.ts
//
// Lectura mínima de la configuración global de GitCron (~/.config/gitcron/gitcron.json).
// Formato compatible con opencode.json (D1, D4, D5, D6).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';

export type ProviderDestination = 'this-machine' | 'own-server' | 'external-service';
export type ProviderKind = 'openai-compatible' | 'cli';

export const RESERVED_CLI_IDS = ['codex', 'claude-code', 'antigravity'] as const;
export type ReservedCliId = (typeof RESERVED_CLI_IDS)[number];

export interface GitCronModelLimit {
  context?: number;
  input?: number;
  output?: number;
}

export interface GitCronModelConfig {
  name?: string;
  limit?: GitCronModelLimit;
  options?: Record<string, unknown>;
  temperature?: number;
  [key: string]: unknown;
}

export interface GitCronProviderOptions {
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  [key: string]: unknown;
}

export interface GitCronProviderConfig {
  npm?: string;
  name?: string;
  options?: GitCronProviderOptions;
  models?: Record<string, GitCronModelConfig>;
  [key: string]: unknown;
}

export interface GitCronAgentConfig {
  description?: string;
  model?: string;
  temperature?: number;
  options?: Record<string, unknown>;
  maxTokens?: number;
  limit?: {
    output?: number;
  };
  [key: string]: unknown;
}

export interface GitCronConfig {
  $schema?: string;
  model?: string;
  small_model?: string;
  provider?: Record<string, GitCronProviderConfig>;
  agent?: Record<string, GitCronAgentConfig>;
  [key: string]: unknown;
}

export interface ResolvedUse {
  providerId: string;
  providerName: string;
  modelId: string;
  kind: ProviderKind;
  destination: ProviderDestination;
  sourceFile: string;
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  options?: Record<string, unknown>;
  contextLength?: number;
  available: boolean;
  unavailableReason?: string;
}

export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), '.config', 'gitcron', 'gitcron.json');
}

/**
 * Lee la configuración de gitcron.json soportando comentarios y comas finales.
 * Archivo ausente -> null.
 * Archivo roto -> Error con línea y motivo. Nunca se escribe el archivo.
 */
export function readGitCronConfig(customPath?: string): GitCronConfig | null {
  const filePath = customPath || getDefaultConfigPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const rawText = fs.readFileSync(filePath, 'utf8');
  const errors: ParseError[] = [];
  const parsed = parse(rawText, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const first = errors[0];
    const line = rawText.slice(0, first.offset).split(/\r?\n/).length;
    const msg = printParseErrorCode(first.error);
    throw new Error(`Error de sintaxis en la línea ${line}: ${msg}`);
  }

  return parsed as GitCronConfig;
}

/**
 * Determina el destino según la dirección resuelta.
 * localhost -> this-machine
 * IP privada -> own-server
 * resto y CLI -> external-service
 */
export function determineDestination(baseURL?: string, kind?: ProviderKind): ProviderDestination {
  if (kind === 'cli' || !baseURL) {
    return 'external-service';
  }

  try {
    const url = new URL(baseURL);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0'
    ) {
      return 'this-machine';
    }

    // Rangos IPv4 privados: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return 'own-server';
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return 'own-server';
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return 'own-server';

    // IPv6 privado / local
    if (/^fe[89ab][0-9a-f]/i.test(host) || /^fc/i.test(host) || /^fd/i.test(host)) {
      return 'own-server';
    }

    // Hostnames de red local (.local, .lan, etc.)
    if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal')) {
      return 'own-server';
    }

    return 'external-service';
  } catch {
    return 'external-service';
  }
}

/**
 * Sustituye `{env:NOMBRE}` en cadenas. Si una variable falta, nunca se manda un valor vacío
 * y se registra la variable faltante.
 */
export function substituteEnvInValue<T>(
  val: T,
  env: NodeJS.ProcessEnv = process.env,
): { value: T; missingVars: string[] } {
  const missingVars: string[] = [];

  function walk(current: any): any {
    if (typeof current === 'string') {
      const match = current.match(/\{env:([A-Za-z0-9_]+)\}/g);
      if (match) {
        let hasMissing = false;
        const replaced = current.replace(/\{env:([A-Za-z0-9_]+)\}/g, (_m, varName) => {
          const envVal = env[varName];
          if (envVal === undefined || envVal === '') {
            missingVars.push(varName);
            hasMissing = true;
            return '';
          }
          return envVal;
        });
        if (hasMissing) {
          return undefined;
        }
        return replaced;
      }
      return current;
    }
    if (Array.isArray(current)) {
      return current.map(walk).filter((item) => item !== undefined);
    }
    if (current !== null && typeof current === 'object') {
      const result: Record<string, any> = {};
      for (const [key, propVal] of Object.entries(current)) {
        const walked = walk(propVal);
        if (walked !== undefined) {
          result[key] = walked;
        }
      }
      return result;
    }
    return current;
  }

  const substituted = walk(val);
  return { value: substituted, missingVars: [...new Set(missingVars)] };
}

function cliDisplayName(cliId: string): string {
  switch (cliId) {
    case 'codex':
      return 'Codex';
    case 'claude-code':
      return 'Claude Code';
    case 'antigravity':
      return 'Antigravity';
    default:
      return cliId;
  }
}

/**
 * Resuelve el proveedor, modelo y parámetros para un uso específico.
 * Para `gitcron-commit`, lee `agent['gitcron-commit'].model`.
 */
export function resolveUse(
  use: string = 'gitcron-commit',
  customPathOrOptions?: string | { configPath?: string; env?: NodeJS.ProcessEnv },
  envArg?: NodeJS.ProcessEnv,
): ResolvedUse | null {
  let configPath: string | undefined;
  let env: NodeJS.ProcessEnv = process.env;

  if (typeof customPathOrOptions === 'string') {
    configPath = customPathOrOptions;
    if (envArg) env = envArg;
  } else if (customPathOrOptions && typeof customPathOrOptions === 'object') {
    configPath = customPathOrOptions.configPath;
    if (customPathOrOptions.env) env = customPathOrOptions.env;
  }

  const filePath = configPath || getDefaultConfigPath();
  const config = readGitCronConfig(filePath);
  if (!config) return null;

  const agentConfig = config.agent?.[use];
  if (!agentConfig?.model || typeof agentConfig.model !== 'string') {
    return null;
  }

  const modelRef = agentConfig.model.trim();
  const slashIdx = modelRef.indexOf('/');
  if (slashIdx === -1) {
    return null;
  }

  const providerId = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);

  // CLI reservados
  if (RESERVED_CLI_IDS.includes(providerId as ReservedCliId)) {
    const isCodex = providerId === 'codex';
    return {
      providerId,
      providerName: cliDisplayName(providerId),
      modelId,
      kind: 'cli',
      destination: 'external-service',
      sourceFile: filePath,
      temperature: agentConfig.temperature,
      maxTokens: agentConfig.limit?.output ?? agentConfig.maxTokens,
      options: agentConfig.options ?? {},
      available: isCodex,
      unavailableReason: isCodex ? undefined : 'todavía no conectado',
    };
  }

  // Proveedor estándar en config.provider
  const rawProvider = config.provider?.[providerId];
  if (!rawProvider) {
    return {
      providerId,
      providerName: providerId,
      modelId,
      kind: 'openai-compatible',
      destination: 'external-service',
      sourceFile: filePath,
      available: false,
      unavailableReason: `Proveedor «${providerId}» no declarado en provider`,
    };
  }

  const providerName = rawProvider.name || providerId;
  const rawOptions = rawProvider.options ?? {};
  const { value: substitutedOptions, missingVars } = substituteEnvInValue(rawOptions, env);

  const available = missingVars.length === 0;
  const unavailableReason = available
    ? undefined
    : `Variable de entorno ${missingVars[0]} no definida`;

  const baseURL = substitutedOptions?.baseURL;
  const apiKey = substitutedOptions?.apiKey;
  const headers = substitutedOptions?.headers as Record<string, string> | undefined;

  const destination = determineDestination(baseURL, 'openai-compatible');

  const modelConfig = rawProvider.models?.[modelId];

  // Precedencia: agent encima de model
  const temperature = agentConfig.temperature !== undefined ? agentConfig.temperature : modelConfig?.temperature;
  const maxTokens = agentConfig.limit?.output ?? agentConfig.maxTokens ?? modelConfig?.limit?.output;
  const contextLength = modelConfig?.limit?.context;

  // options: provider.options (fuera de claves de conexión) + model.options + agent.options
  const connectionKeys = new Set(['baseURL', 'apiKey', 'headers', 'timeout', 'npm']);
  const providerExtraOptions: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(substitutedOptions ?? {})) {
    if (!connectionKeys.has(k)) {
      providerExtraOptions[k] = v;
    }
  }

  const mergedOptions = {
    ...providerExtraOptions,
    ...(modelConfig?.options ?? {}),
    ...(agentConfig.options ?? {}),
  };

  return {
    providerId,
    providerName,
    modelId,
    kind: 'openai-compatible',
    destination,
    sourceFile: filePath,
    baseURL,
    apiKey,
    headers,
    temperature,
    maxTokens,
    options: Object.keys(mergedOptions).length > 0 ? mergedOptions : undefined,
    contextLength,
    available,
    unavailableReason,
  };
}
