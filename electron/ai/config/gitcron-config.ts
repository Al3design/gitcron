// electron/ai/config/gitcron-config.ts
//
// Lectura de la configuración de GitCron: el gitcron.json global
// (~/.config/gitcron/gitcron.json) y, si hay, el de la raíz del repositorio, mezclados
// con prioridad del repositorio y el origen de cada valor (D2, D3). Formato compatible
// con opencode.json (D1, D4, D5, D6). La escritura puntual está en
// gitcron-config-writer.ts y la observación en gitcron-config-watcher.ts.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import schema from './opencode-config.schema.json';

export const SCHEMA_PROVIDER_OPTION_KEYS: readonly string[] = Object.keys(
  (schema as any)?.$defs?.ProviderConfig?.properties?.options?.properties ?? {},
);

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

export interface ResolvedProvenance {
  sourceFile: string;
  /**
   * `gitcron.json` del repositorio, cuando existe y aporta algo (D2). Con los dos
   * archivos en juego, cada valor tiene que decir de cuál sale: la mezcla deja
   * que el del repositorio pise sólo algunos.
   */
  repoFile?: string;
  /**
   * Las claves de procedencia (las mismas cadenas de este objeto: `model`,
   * `options[k]`, `headers[h]`…) cuyo valor salió del archivo del repositorio.
   */
  fromRepo?: string[];
  model: string;
  baseURL?: string;
  temperature?: string;
  max_tokens?: string;
  options: Record<string, string>;
  headers: Record<string, string>;
  auth?: string;
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
  provenance: ResolvedProvenance;
}

export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), '.config', 'gitcron', 'gitcron.json');
}

/** `gitcron.json` en la raíz de un repositorio (D2). */
export function getRepoConfigPath(repoPath: string): string {
  return path.join(repoPath, 'gitcron.json');
}

/**
 * Un archivo que no se pudo interpretar, con datos y no con texto.
 *
 * El texto lo arma la pantalla en el idioma de la persona: el que armaba este
 * módulo («…: Error de sintaxis en la línea 27: CommaExpected») llegaba crudo,
 * con el código interno de jsonc-parser. Ale lo vio el 2026-10-01.
 */
export interface GitCronConfigParseError {
  file: string;
  line: number;
  column: number;
  /** Código de jsonc-parser: `CommaExpected`, `ColonExpected`, `CloseBraceExpected`… */
  code: string;
}

export interface GitCronConfigFileStatus {
  path: string;
  scope: 'global' | 'repo';
  exists: boolean;
  error?: GitCronConfigParseError;
  /** El archivo está roto y se usa la última versión que se leyó bien en esta sesión. */
  usingLastValid?: boolean;
}

export interface LoadedGitCronConfig {
  /** La mezcla de los dos archivos; `null` si ninguno aporta nada. */
  config: GitCronConfig | null;
  files: GitCronConfigFileStatus[];
  /**
   * De qué archivo sale el valor en esa ruta. La ruta va por segmentos y no unida
   * con puntos: los ids de modelo tienen puntos y barras (`unsloth/Qwen3.8-27B-GGUF`).
   */
  originOf(segments: readonly string[]): string | undefined;
}

/**
 * Archivo roto sin una versión anterior que usar. Lleva el error con datos para
 * que la pantalla lo explique; el mensaje es sólo para registros.
 */
export class GitCronConfigError extends Error {
  constructor(public readonly parseError: GitCronConfigParseError) {
    super(`${parseError.file}: línea ${parseError.line}, columna ${parseError.column}: ${parseError.code}`);
    this.name = 'GitCronConfigError';
  }
}

/**
 * La última versión que se leyó bien de cada archivo en esta sesión. Con el
 * archivo roto se sigue con ésta y se dice (requisito «El archivo y la pantalla
 * dicen lo mismo»): un error al guardar a mano no tiene por qué cortar la
 * redacción que andaba un segundo antes.
 */
const lastValidByFile = new Map<string, GitCronConfig>();

/** Sólo para pruebas: olvidar las versiones válidas guardadas. */
export function resetGitCronConfigCacheForTesting(): void {
  lastValidByFile.clear();
}

type ParsedFile =
  | { kind: 'absent' }
  | { kind: 'ok'; config: GitCronConfig }
  | { kind: 'error'; error: GitCronConfigParseError };

/** Lee un archivo con comentarios y comas finales. Nunca lo escribe. */
export function parseGitCronConfigFile(filePath: string): ParsedFile {
  if (!fs.existsSync(filePath)) return { kind: 'absent' };
  return parseGitCronConfigText(fs.readFileSync(filePath, 'utf8'), filePath);
}

/** Interpreta el texto de un gitcron.json (`filePath` sólo para el error). */
export function parseGitCronConfigText(rawText: string, filePath: string): Exclude<ParsedFile, { kind: 'absent' }> {
  const errors: ParseError[] = [];
  const parsed = parse(rawText, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    const before = rawText.slice(0, first.offset);
    const lines = before.split(/\r?\n/);
    return {
      kind: 'error',
      error: {
        file: filePath,
        line: lines.length,
        column: lines[lines.length - 1].length + 1,
        code: printParseErrorCode(first.error),
      },
    };
  }
  // Un archivo vacío o con un valor que no es objeto no aporta configuración.
  const config = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as GitCronConfig)
    : {};
  return { kind: 'ok', config };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const segmentsKey = (segments: readonly string[]) => JSON.stringify(segments);

/**
 * Mezcla profunda por clave (D2): los objetos se mezclan y todo lo demás —listas
 * incluidas— se reemplaza entero. Anota el archivo de cada ruta que escribe.
 */
function mergeWithOrigin(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  file: string,
  origins: Map<string, string>,
  prefix: string[] = [],
): void {
  for (const [key, value] of Object.entries(source)) {
    const segments = [...prefix, key];
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeWithOrigin(target[key] as Record<string, unknown>, value, file, origins, segments);
      continue;
    }
    target[key] = isPlainObject(value) ? structuredClone(value) : value;
    markOrigin(value, file, origins, segments);
  }
}

function markOrigin(value: unknown, file: string, origins: Map<string, string>, segments: string[]): void {
  origins.set(segmentsKey(segments), file);
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      markOrigin(child, file, origins, [...segments, key]);
    }
  }
}

/**
 * Carga el `gitcron.json` global y, si se pasa el repositorio, el de su raíz, y
 * los mezcla con prioridad del repositorio (D2). Un archivo roto usa su última
 * versión válida de esta sesión si la hay; si no, no aporta nada y queda su
 * error en `files`.
 */
export function loadGitCronConfig(options: { globalPath?: string; repoPath?: string | null } = {}): LoadedGitCronConfig {
  const sources: Array<{ path: string; scope: 'global' | 'repo' }> = [
    { path: options.globalPath || getDefaultConfigPath(), scope: 'global' },
  ];
  if (options.repoPath) sources.push({ path: getRepoConfigPath(options.repoPath), scope: 'repo' });

  const merged: Record<string, unknown> = {};
  const origins = new Map<string, string>();
  const files: GitCronConfigFileStatus[] = [];
  let contributed = false;

  for (const source of sources) {
    const parsed = parseGitCronConfigFile(source.path);
    let config: GitCronConfig | undefined;
    const status: GitCronConfigFileStatus = { path: source.path, scope: source.scope, exists: parsed.kind !== 'absent' };
    if (parsed.kind === 'ok') {
      config = parsed.config;
      lastValidByFile.set(source.path, parsed.config);
    } else if (parsed.kind === 'error') {
      status.error = parsed.error;
      config = lastValidByFile.get(source.path);
      if (config) status.usingLastValid = true;
    }
    files.push(status);
    if (config) {
      mergeWithOrigin(merged, config, source.path, origins);
      contributed = true;
    }
  }

  return {
    config: contributed ? (merged as GitCronConfig) : null,
    files,
    originOf(segments) {
      for (let i = segments.length; i > 0; i--) {
        const file = origins.get(segmentsKey(segments.slice(0, i)));
        if (file) return file;
      }
      return undefined;
    },
  };
}

/**
 * Lee un solo archivo. Archivo ausente: `null`. Archivo roto: `GitCronConfigError`.
 * Envoltura de `parseGitCronConfigFile` para quien necesita un archivo suelto; la
 * resolución de usos pasa por `loadGitCronConfig`.
 */
export function readGitCronConfig(customPath?: string): GitCronConfig | null {
  const parsed = parseGitCronConfigFile(customPath || getDefaultConfigPath());
  if (parsed.kind === 'absent') return null;
  if (parsed.kind === 'error') throw new GitCronConfigError(parsed.error);
  return parsed.config;
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
  customPathOrOptions?:
    | string
    | { configPath?: string; repoPath?: string | null; env?: NodeJS.ProcessEnv; loaded?: LoadedGitCronConfig },
  envArg?: NodeJS.ProcessEnv,
): ResolvedUse | null {
  let configPath: string | undefined;
  let repoPath: string | null | undefined;
  let preloaded: LoadedGitCronConfig | undefined;
  let env: NodeJS.ProcessEnv = process.env;

  if (typeof customPathOrOptions === 'string') {
    configPath = customPathOrOptions;
    if (envArg) env = envArg;
  } else if (customPathOrOptions && typeof customPathOrOptions === 'object') {
    configPath = customPathOrOptions.configPath;
    repoPath = customPathOrOptions.repoPath;
    preloaded = customPathOrOptions.loaded;
    if (customPathOrOptions.env) env = customPathOrOptions.env;
  }

  const loaded = preloaded ?? loadGitCronConfig({ globalPath: configPath, repoPath });
  // Un archivo roto sin versión anterior bloquea: seguir sólo con el otro sería
  // redactar con una configuración que la persona no escribió así (D7).
  const unreadable = loaded.files.find((f) => f.error && !f.usingLastValid);
  if (unreadable?.error) throw new GitCronConfigError(unreadable.error);

  const config = loaded.config;
  if (!config) return null;

  const agentConfig = config.agent?.[use];
  if (!agentConfig?.model || typeof agentConfig.model !== 'string') {
    return null;
  }

  // De qué archivo sale cada valor (D2). `sourceFile` es el del modelo del uso.
  const globalFile = loaded.files.find((f) => f.scope === 'global')?.path ?? (configPath || getDefaultConfigPath());
  const filePath = loaded.originOf(['agent', use, 'model']) ?? globalFile;
  const repoFile = loaded.files.find((f) => f.scope === 'repo')?.path;
  const fromRepo: string[] = [];
  const noteOrigin = (key: string, segments: string[]) => {
    if (repoFile && loaded.originOf(segments) === repoFile) fromRepo.push(key);
  };
  const filesOf = () => (repoFile && fromRepo.length > 0 ? { repoFile, fromRepo: [...fromRepo] } : {});
  noteOrigin('model', ['agent', use, 'model']);

  const modelRef = agentConfig.model.trim();
  const slashIdx = modelRef.indexOf('/');
  if (slashIdx === -1) {
    return {
      providerId: '',
      providerName: 'Desconocido',
      modelId: modelRef,
      kind: 'openai-compatible',
      destination: 'external-service',
      sourceFile: filePath,
      available: false,
      unavailableReason: 'falta el proveedor: se escribe <proveedor>/<modelo>',
      provenance: {
        sourceFile: filePath,
        model: `agent.${use}.model`,
        options: {},
        headers: {},
        ...filesOf(),
      },
    };
  }

  const providerId = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);

  // CLI reservados
  if (RESERVED_CLI_IDS.includes(providerId as ReservedCliId)) {
    const isCodex = providerId === 'codex';
    const cliOptionsProvenance: Record<string, string> = {};
    for (const k of Object.keys(agentConfig.options ?? {})) {
      cliOptionsProvenance[k] = `agent.${use}.options.${k}`;
      noteOrigin(`options.${k}`, ['agent', use, 'options', k]);
    }
    if (agentConfig.temperature !== undefined) noteOrigin('temperature', ['agent', use, 'temperature']);
    return {
      providerId,
      providerName: cliDisplayName(providerId),
      modelId,
      kind: 'cli',
      destination: 'external-service',
      sourceFile: filePath,
      temperature: agentConfig.temperature,
      maxTokens: undefined,
      options: agentConfig.options ?? {},
      available: isCodex,
      unavailableReason: isCodex ? undefined : 'todavía no conectado',
      provenance: {
        sourceFile: filePath,
        model: `agent.${use}.model`,
        temperature: agentConfig.temperature !== undefined ? `agent.${use}.temperature` : undefined,
        options: cliOptionsProvenance,
        headers: {},
        ...filesOf(),
      },
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
      provenance: {
        sourceFile: filePath,
        model: `agent.${use}.model`,
        options: {},
        headers: {},
        ...filesOf(),
      },
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

  let baseURLProvenance: string | undefined;
  if (typeof rawOptions.baseURL === 'string') {
    const baseEnvMatch = rawOptions.baseURL.match(/\{env:([A-Za-z0-9_]+)\}/);
    if (baseEnvMatch) {
      baseURLProvenance = `provider.${providerId}.options.baseURL (variable ${baseEnvMatch[1]})`;
    } else {
      baseURLProvenance = `provider.${providerId}.options.baseURL`;
    }
    noteOrigin('baseURL', ['provider', providerId, 'options', 'baseURL']);
  }

  let authProvenance: string | undefined;
  if (typeof rawOptions.apiKey === 'string') {
    const apiEnvMatch = rawOptions.apiKey.match(/\{env:([A-Za-z0-9_]+)\}/);
    if (apiEnvMatch) {
      authProvenance = `Bearer, de la variable ${apiEnvMatch[1]}`;
    } else if (rawOptions.apiKey.trim().length > 0) {
      authProvenance = 'Bearer, valor escrito en el archivo';
    }
    if (authProvenance) noteOrigin('auth', ['provider', providerId, 'options', 'apiKey']);
  }

  const modelConfig = rawProvider.models?.[modelId];

  // Precedencia: agent encima de model. max_tokens sale de limit.output del modelo o 3000 por omisión.
  let temperature: number | undefined;
  let temperatureProvenance: string | undefined;
  if (agentConfig.temperature !== undefined) {
    temperature = agentConfig.temperature;
    temperatureProvenance = `agent.${use}.temperature`;
    noteOrigin('temperature', ['agent', use, 'temperature']);
  } else if (modelConfig?.temperature !== undefined) {
    temperature = modelConfig.temperature;
    temperatureProvenance = `provider.${providerId}.models.${modelId}.temperature`;
    noteOrigin('temperature', ['provider', providerId, 'models', modelId, 'temperature']);
  }

  let maxTokens: number;
  let maxTokensProvenance: string;
  if (modelConfig?.limit?.output !== undefined) {
    maxTokens = modelConfig.limit.output;
    maxTokensProvenance = `provider.${providerId}.models.${modelId}.limit.output`;
    noteOrigin('max_tokens', ['provider', providerId, 'models', modelId, 'limit', 'output']);
  } else {
    maxTokens = 3000;
    maxTokensProvenance = 'valor por omisión de GitCron (3000)';
  }
  const contextLength = modelConfig?.limit?.context;

  // options: provider.options (excluyendo claves del esquema y headers) + model.options + agent.options
  const connectionKeys = new Set([...SCHEMA_PROVIDER_OPTION_KEYS, 'headers']);
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

  // El último que escribe una clave es el que vale (agent encima de model encima
  // de provider), así que su ruta es la que dice de qué archivo sale.
  const optionsProvenance: Record<string, string> = {};
  const optionSegments: Record<string, string[]> = {};
  for (const k of Object.keys(providerExtraOptions)) {
    optionsProvenance[k] = `provider.${providerId}.options.${k}`;
    optionSegments[k] = ['provider', providerId, 'options', k];
  }
  for (const k of Object.keys(modelConfig?.options ?? {})) {
    optionsProvenance[k] = `provider.${providerId}.models.${modelId}.options.${k}`;
    optionSegments[k] = ['provider', providerId, 'models', modelId, 'options', k];
  }
  for (const k of Object.keys(agentConfig.options ?? {})) {
    optionsProvenance[k] = `agent.${use}.options.${k}`;
    optionSegments[k] = ['agent', use, 'options', k];
  }
  for (const [k, segments] of Object.entries(optionSegments)) noteOrigin(`options.${k}`, segments);

  const headersProvenance: Record<string, string> = {};
  for (const h of Object.keys(rawOptions.headers ?? {})) {
    headersProvenance[h] = `provider.${providerId}.options.headers.${h}`;
    noteOrigin(`headers.${h}`, ['provider', providerId, 'options', 'headers', h]);
  }

  if (!baseURL) {
    return {
      providerId,
      providerName,
      modelId,
      kind: 'openai-compatible',
      destination: 'external-service',
      sourceFile: filePath,
      available: false,
      unavailableReason: `el proveedor ${providerId} no declara options.baseURL`,
      provenance: {
        sourceFile: filePath,
        model: `agent.${use}.model`,
        options: optionsProvenance,
        headers: headersProvenance,
        auth: authProvenance,
        ...filesOf(),
      },
    };
  }

  const destination = determineDestination(baseURL, 'openai-compatible');

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
    provenance: {
      sourceFile: filePath,
      model: `agent.${use}.model`,
      baseURL: baseURLProvenance,
      temperature: temperatureProvenance,
      max_tokens: maxTokensProvenance,
      options: optionsProvenance,
      headers: headersProvenance,
      auth: authProvenance,
      ...filesOf(),
    },
  };
}
