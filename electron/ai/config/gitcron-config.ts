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
  /**
   * En el formato de OpenCode es un sí/no: si el modelo admite temperatura. No es
   * la temperatura a usar (ésa va en `agent.<uso>.temperature`). Un número acá se
   * sigue usando por compatibilidad y la validación lo advierte; un sí/no no viaja.
   */
  temperature?: number | boolean;
  /** Cabeceras propias del modelo, encima de las del proveedor (D4). */
  headers?: Record<string, string>;
  /** Variantes del modelo: parámetros que se eligen con `agent.<uso>.variant` (D4). */
  variants?: Record<string, { disabled?: boolean; [key: string]: unknown }>;
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
  /** Variante del modelo que usa este uso (D4). */
  variant?: string;
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
  /**
   * Las variables `{env:}` que usa este uso y de dónde salió cada una (D5): del
   * sistema, guardada en GitCron o falta. Nunca el valor.
   */
  variables?: Array<{ name: string; source: VariableSource | 'missing' }>;
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

/** De dónde salió una variable `{env:}` (D5). La pantalla lo dice; el valor, nunca. */
export type VariableSource = 'system' | 'stored';

export interface MissingReference {
  kind: 'env' | 'file';
  /** El nombre de la variable o la ruta tal como está escrita en el archivo. */
  name: string;
}

export interface ReferenceResolution<T> {
  value: T;
  missing: MissingReference[];
  /** Variable → de dónde salió, sólo las que se resolvieron. */
  sources: Record<string, VariableSource>;
}

export interface ReferenceOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * Variables guardadas en GitCron (`key-store`, espacio `env:<NOMBRE>`). Se inyecta
   * desde el proceso principal: este módulo no depende de Electron.
   */
  stored?: (name: string) => string | undefined;
  /** Carpeta contra la que se resuelven las rutas relativas de `{file:}`: la del archivo que las escribe. */
  baseDir?: string;
}

const ENV_REF = /\{env:([A-Za-z0-9_]+)\}/g;
const FILE_REF = /\{file:([^}]+)\}/g;

/**
 * Sustituye `{env:NOMBRE}` y `{file:ruta}` en cualquier texto del valor, con la
 * sintaxis de OpenCode (D5). `{env:}` se busca primero en el sistema y después en
 * las variables guardadas en GitCron. `{file:}` lee el archivo (sin los espacios de
 * los bordes, como OpenCode), con `~` como la carpeta de la persona y las rutas
 * relativas contra la carpeta del archivo de configuración.
 *
 * Un texto con una referencia que no se resuelve se quita entero: nunca se manda
 * un valor vacío o a medias (requisito «Los secretos se referencian…»).
 */
export function substituteReferences<T>(val: T, options: ReferenceOptions = {}): ReferenceResolution<T> {
  const env = options.env ?? process.env;
  const missing: MissingReference[] = [];
  const sources: Record<string, VariableSource> = {};

  const resolveFile = (raw: string): string | undefined => {
    const trimmed = raw.trim();
    const expanded = trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? path.join(os.homedir(), trimmed.slice(1))
      : trimmed;
    const full = path.isAbsolute(expanded) ? expanded : path.resolve(options.baseDir ?? process.cwd(), expanded);
    try {
      return fs.readFileSync(full, 'utf8').trim();
    } catch {
      return undefined;
    }
  };

  function walkString(current: string): string | undefined {
    let unresolved = false;
    const withEnv = current.replace(ENV_REF, (_m, name: string) => {
      const fromSystem = env[name];
      if (fromSystem !== undefined && fromSystem !== '') {
        sources[name] = 'system';
        return fromSystem;
      }
      const fromStored = options.stored?.(name);
      if (fromStored !== undefined && fromStored !== '') {
        sources[name] = 'stored';
        return fromStored;
      }
      missing.push({ kind: 'env', name });
      unresolved = true;
      return '';
    });
    const withFiles = withEnv.replace(FILE_REF, (_m, ref: string) => {
      const content = resolveFile(ref);
      if (content === undefined || content === '') {
        missing.push({ kind: 'file', name: ref.trim() });
        unresolved = true;
        return '';
      }
      return content;
    });
    return unresolved ? undefined : withFiles;
  }

  function walk(current: unknown): unknown {
    if (typeof current === 'string') return walkString(current);
    if (Array.isArray(current)) return current.map(walk).filter((item) => item !== undefined);
    if (current !== null && typeof current === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, propVal] of Object.entries(current)) {
        const walked = walk(propVal);
        if (walked !== undefined) result[key] = walked;
      }
      return result;
    }
    return current;
  }

  const value = walk(val) as T;
  const unique = new Map(missing.map((m) => [`${m.kind}:${m.name}`, m]));
  return { value, missing: [...unique.values()], sources };
}

/**
 * Sustituye sólo `{env:NOMBRE}` del entorno dado. Envoltura de `substituteReferences`
 * para quien no necesita las variables guardadas ni `{file:}`.
 */
export function substituteEnvInValue<T>(
  val: T,
  env: NodeJS.ProcessEnv = process.env,
): { value: T; missingVars: string[] } {
  const { value, missing } = substituteReferences(val, { env });
  return { value, missingVars: missing.filter((m) => m.kind === 'env').map((m) => m.name) };
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

export interface ResolveUseOptions {
  /** Ruta del gitcron.json global (por omisión, el de la carpeta de la persona). */
  configPath?: string;
  /** Raíz del repositorio: su gitcron.json se mezcla encima del global (D2). */
  repoPath?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Variables guardadas en GitCron (D5); el proceso principal pasa las del key-store. */
  stored?: (name: string) => string | undefined;
  /** Configuración ya cargada, para no leer los archivos dos veces. */
  loaded?: LoadedGitCronConfig;
}

/**
 * Resuelve el proveedor, modelo y parámetros para un uso específico.
 * Para `gitcron-commit`, lee `agent['gitcron-commit'].model`.
 */
export function resolveUse(
  use: string = 'gitcron-commit',
  customPathOrOptions?: string | ResolveUseOptions,
  envArg?: NodeJS.ProcessEnv,
): ResolvedUse | null {
  let configPath: string | undefined;
  let repoPath: string | null | undefined;
  let preloaded: LoadedGitCronConfig | undefined;
  let stored: ResolveUseOptions['stored'];
  let env: NodeJS.ProcessEnv = process.env;

  if (typeof customPathOrOptions === 'string') {
    configPath = customPathOrOptions;
    if (envArg) env = envArg;
  } else if (customPathOrOptions && typeof customPathOrOptions === 'object') {
    configPath = customPathOrOptions.configPath;
    repoPath = customPathOrOptions.repoPath;
    preloaded = customPathOrOptions.loaded;
    stored = customPathOrOptions.stored;
    if (customPathOrOptions.env) env = customPathOrOptions.env;
  }

  const loaded = preloaded ?? loadGitCronConfig({ globalPath: configPath, repoPath });
  // Un archivo roto sin versión anterior bloquea: seguir sólo con el otro sería
  // redactar con una configuración que la persona no escribió así (D7).
  const unreadable = loaded.files.find((f) => f.error && !f.usingLastValid);
  if (unreadable?.error) throw new GitCronConfigError(unreadable.error);

  const config = loaded.config;
  if (!config) return null;

  const rawAgent = config.agent?.[use];
  if (!rawAgent?.model || typeof rawAgent.model !== 'string') {
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

  // Referencias `{env:}` y `{file:}` (D5). Las rutas relativas de `{file:}` van
  // contra la carpeta del archivo que escribe ese valor.
  const variables = new Map<string, VariableSource | 'missing'>();
  const missingRefs: MissingReference[] = [];
  const resolveRefs = <T>(value: T, segments: string[]): T => {
    const result = substituteReferences(value, {
      env,
      stored,
      baseDir: path.dirname(loaded.originOf(segments) ?? globalFile),
    });
    for (const [name, source] of Object.entries(result.sources)) variables.set(name, source);
    for (const ref of result.missing) {
      missingRefs.push(ref);
      if (ref.kind === 'env') variables.set(ref.name, 'missing');
    }
    return result.value;
  };
  const varsOf = () => (variables.size > 0 ? { variables: [...variables].map(([name, source]) => ({ name, source })) } : {});
  const missingReason = (): string | undefined => {
    const first = missingRefs[0];
    if (!first) return undefined;
    return first.kind === 'env'
      ? `Variable de entorno ${first.name} no definida`
      : `Archivo ${first.name} no encontrado ({file:${first.name}})`;
  };
  // «del sistema» o «guardada en GitCron»: la pantalla dice de dónde sale cada variable, nunca su valor.
  const sourceLabel = (name: string) => {
    const source = variables.get(name);
    return source === 'system' ? 'del sistema' : source === 'stored' ? 'guardada en GitCron' : 'falta';
  };
  const withVariable = (base: string, raw: unknown): string => {
    if (typeof raw !== 'string') return base;
    const match = raw.match(/\{env:([A-Za-z0-9_]+)\}/);
    return match ? `${base} (variable ${match[1]}, ${sourceLabel(match[1])})` : base;
  };

  const agentConfig = resolveRefs({ ...rawAgent }, ['agent', use]);

  const modelRef = rawAgent.model.trim();
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
      ...varsOf(),
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
    const missing = missingReason();
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
      available: isCodex && !missing,
      unavailableReason: missing ?? (isCodex ? undefined : 'todavía no conectado'),
      provenance: {
        sourceFile: filePath,
        model: `agent.${use}.model`,
        temperature: agentConfig.temperature !== undefined ? `agent.${use}.temperature` : undefined,
        options: cliOptionsProvenance,
        headers: {},
        ...filesOf(),
      },
      ...varsOf(),
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
      ...varsOf(),
    };
  }

  const providerName = rawProvider.name || providerId;
  const rawOptions = rawProvider.options ?? {};
  const substitutedOptions = resolveRefs(rawOptions, ['provider', providerId, 'options']);
  const rawModel = rawProvider.models?.[modelId];
  const modelConfig = rawModel ? resolveRefs(rawModel, ['provider', providerId, 'models', modelId]) : undefined;

  // Variante elegida por el uso (D4): sus parámetros van entre los del modelo y los del agente.
  const variantName = typeof rawAgent.variant === 'string' && rawAgent.variant.trim() ? rawAgent.variant.trim() : undefined;
  let variantParams: Record<string, unknown> = {};
  let variantProblem: string | undefined;
  if (variantName) {
    const variant = modelConfig?.variants?.[variantName];
    if (!variant || typeof variant !== 'object') {
      variantProblem = `la variante «${variantName}» no existe en provider.${providerId}.models.${modelId}.variants`;
    } else if (variant.disabled === true) {
      variantProblem = `la variante «${variantName}» está deshabilitada`;
    } else {
      const { disabled: _disabled, ...rest } = variant;
      variantParams = rest;
    }
  }

  const missing = missingReason();
  const available = !missing && !variantProblem;
  const unavailableReason = variantProblem ?? missing;

  const baseURL = typeof substitutedOptions?.baseURL === 'string' ? substitutedOptions.baseURL : undefined;
  const apiKey = typeof substitutedOptions?.apiKey === 'string' ? substitutedOptions.apiKey : undefined;

  let baseURLProvenance: string | undefined;
  if (typeof rawOptions.baseURL === 'string') {
    baseURLProvenance = withVariable(`provider.${providerId}.options.baseURL`, rawOptions.baseURL);
    noteOrigin('baseURL', ['provider', providerId, 'options', 'baseURL']);
  }

  let authProvenance: string | undefined;
  if (typeof rawOptions.apiKey === 'string') {
    const apiEnvMatch = rawOptions.apiKey.match(/\{env:([A-Za-z0-9_]+)\}/);
    if (apiEnvMatch) {
      authProvenance = `Bearer, de la variable ${apiEnvMatch[1]} (${sourceLabel(apiEnvMatch[1])})`;
    } else if (/\{file:[^}]+\}/.test(rawOptions.apiKey)) {
      authProvenance = 'Bearer, de un archivo ({file:})';
    } else if (rawOptions.apiKey.trim().length > 0) {
      authProvenance = 'Bearer, valor escrito en el archivo';
    }
    if (authProvenance) noteOrigin('auth', ['provider', providerId, 'options', 'apiKey']);
  }

  // Precedencia: agent encima de model. max_tokens sale de limit.output del modelo o 3000 por omisión.
  // `temperature` del modelo es un sí/no en el formato de OpenCode («admite temperatura»):
  // un sí/no nunca viaja como temperatura; un número se sigue usando y la validación lo advierte.
  let temperature: number | undefined;
  let temperatureProvenance: string | undefined;
  if (agentConfig.temperature !== undefined) {
    temperature = agentConfig.temperature;
    temperatureProvenance = `agent.${use}.temperature`;
    noteOrigin('temperature', ['agent', use, 'temperature']);
  } else if (typeof modelConfig?.temperature === 'number') {
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

  // options: provider.options (excluyendo claves del esquema y headers) + model.options
  // + la variante + agent.options, en ese orden (D4).
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
    ...variantParams,
    ...(agentConfig.options ?? {}),
  };

  // El último que escribe una clave es el que vale (agent encima de la variante, del
  // modelo y del proveedor), así que su ruta es la que dice de qué archivo sale.
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
  for (const k of Object.keys(variantParams)) {
    optionsProvenance[k] = `provider.${providerId}.models.${modelId}.variants.${variantName}.${k}`;
    optionSegments[k] = ['provider', providerId, 'models', modelId, 'variants', variantName as string, k];
  }
  for (const k of Object.keys(agentConfig.options ?? {})) {
    optionsProvenance[k] = `agent.${use}.options.${k}`;
    optionSegments[k] = ['agent', use, 'options', k];
  }
  for (const [k, segments] of Object.entries(optionSegments)) noteOrigin(`options.${k}`, segments);

  // Cabeceras: las del modelo encima de las del proveedor (D4).
  const providerHeaders = (substitutedOptions?.headers ?? {}) as Record<string, string>;
  const modelHeaders = (modelConfig?.headers ?? {}) as Record<string, string>;
  const mergedHeaders = { ...providerHeaders, ...modelHeaders };
  const headers = Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined;
  const headersProvenance: Record<string, string> = {};
  for (const [h, raw] of Object.entries((rawOptions.headers ?? {}) as Record<string, unknown>)) {
    headersProvenance[h] = withVariable(`provider.${providerId}.options.headers.${h}`, raw);
    noteOrigin(`headers.${h}`, ['provider', providerId, 'options', 'headers', h]);
  }
  for (const [h, raw] of Object.entries((rawModel?.headers ?? {}) as Record<string, unknown>)) {
    headersProvenance[h] = withVariable(`provider.${providerId}.models.${modelId}.headers.${h}`, raw);
    noteOrigin(`headers.${h}`, ['provider', providerId, 'models', modelId, 'headers', h]);
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
      // Si la dirección venía de una variable que falta, eso es lo que hay que decir.
      unavailableReason: unavailableReason ?? `el proveedor ${providerId} no declara options.baseURL`,
      provenance: {
        sourceFile: filePath,
        model: `agent.${use}.model`,
        options: optionsProvenance,
        headers: headersProvenance,
        auth: authProvenance,
        ...filesOf(),
      },
      ...varsOf(),
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
    ...varsOf(),
  };
}
