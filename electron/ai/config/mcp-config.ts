// electron/ai/config/mcp-config.ts
//
// Los servidores MCP de GitCron van en un mcp.json aparte, con la notación
// `mcpServers` que comparten Cursor, LM Studio y Claude Code (D12, tarea 3.6b).
//
// Global en ~/.config/gitcron/mcp.json y opcional por repositorio en
// <raíz>/.gitcron/mcp.json, con la misma lectura, escritura puntual y observación
// que gitcron.json (D3): `parseGitCronConfigText`, `updateGitCronConfigValue` y
// `createGitCronConfigWatcher({ fileName: 'mcp.json', repoSubdir: '.gitcron' })`.
//
// Ningún uso de GitCron consume MCP todavía; esto es la lectura y las
// importaciones, para la pantalla de ajustes (6.1).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyEdits, findNodeAtLocation, parseTree } from 'jsonc-parser';
import { diffValues, referencedVariables, type FieldChange } from './config-diff';
import { parseGitCronConfigText, type GitCronConfigFileStatus } from './gitcron-config';
import { detectFormatting, updateGitCronConfigValue, type ConfigWriteResult } from './gitcron-config-writer';
import { getDefaultOpenCodePath, readJsoncSource, type ImportSourceStatus } from './opencode-import';
import {
  envVarNameFrom,
  literalSecretsToSave,
  replaceLiteralSecrets,
  type SecretNaming,
  type SecretSlot,
} from './literal-secrets';

export const MCP_FILE_NAME = 'mcp.json';
export const MCP_REPO_SUBDIR = '.gitcron';
export const MCP_NEW_FILE_TEXT = '{\n  "mcpServers": {}\n}\n';

export function getDefaultMcpPath(): string {
  return path.join(os.homedir(), '.config', 'gitcron', MCP_FILE_NAME);
}

export function getRepoMcpPath(repoPath: string): string {
  return path.join(repoPath, MCP_REPO_SUBDIR, MCP_FILE_NAME);
}

/** Un servidor en la notación `mcpServers` (Cursor): local con `command`, remoto con `url`. */
export interface McpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envFile?: string;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export function mcpServerKind(server: McpServer): 'local' | 'remote' | 'unknown' {
  if (typeof server.command === 'string') return 'local';
  if (typeof server.url === 'string') return 'remote';
  return 'unknown';
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `env` y `headers` de un servidor: suelen traer tokens escritos a mano (un token de
 * GitHub en la configuración de Cursor, por ejemplo). Una variable conserva su nombre;
 * una cabecera lleva delante el del servidor, porque `Authorization` se repite.
 */
export function mcpSecretSlots(name: string, server: unknown): SecretSlot[] {
  const slots: SecretSlot[] = [];
  const env = isObject(server) ? server.env : undefined;
  for (const key of isObject(env) ? Object.keys(env) : []) {
    slots.push({ segments: ['env', key], baseName: envVarNameFrom(key) });
  }
  const headers = isObject(server) ? server.headers : undefined;
  for (const header of isObject(headers) ? Object.keys(headers) : []) {
    slots.push({ segments: ['headers', header], baseName: envVarNameFrom(`${name}_${header}`) });
  }
  return slots;
}

// ─── Lectura y mezcla ───

export interface LoadedMcpConfig {
  /** Los servidores mezclados: uno del repositorio pisa entero al del global con el mismo nombre. */
  servers: Record<string, McpServer>;
  /** De qué archivo sale cada servidor. */
  origins: Record<string, string>;
  files: GitCronConfigFileStatus[];
}

const lastValidMcpByFile = new Map<string, Record<string, McpServer>>();

/** Sólo para pruebas. */
export function resetMcpConfigCacheForTesting(): void {
  lastValidMcpByFile.clear();
}

export function loadMcpConfig(options: { globalPath?: string; repoPath?: string | null } = {}): LoadedMcpConfig {
  const sources: Array<{ path: string; scope: 'global' | 'repo' }> = [
    { path: options.globalPath || getDefaultMcpPath(), scope: 'global' },
  ];
  if (options.repoPath) sources.push({ path: getRepoMcpPath(options.repoPath), scope: 'repo' });

  const loaded: LoadedMcpConfig = { servers: {}, origins: {}, files: [] };
  for (const source of sources) {
    const status: GitCronConfigFileStatus = { path: source.path, scope: source.scope, exists: fs.existsSync(source.path) };
    let servers: Record<string, McpServer> | undefined;
    if (status.exists) {
      const parsed = parseGitCronConfigText(fs.readFileSync(source.path, 'utf8'), source.path);
      if (parsed.kind === 'ok') {
        const raw = (parsed.config as Record<string, unknown>).mcpServers;
        servers = isObject(raw) ? (raw as Record<string, McpServer>) : {};
        lastValidMcpByFile.set(source.path, servers);
      } else {
        status.error = parsed.error;
        servers = lastValidMcpByFile.get(source.path);
        if (servers) status.usingLastValid = true;
      }
    }
    loaded.files.push(status);
    for (const [name, server] of Object.entries(servers ?? {})) {
      loaded.servers[name] = server;
      loaded.origins[name] = source.path;
    }
  }
  return loaded;
}

/** Cambia un servidor (o lo quita con `undefined`) sin tocar el resto del archivo. */
export function updateMcpServer(filePath: string, name: string, server: McpServer | undefined): ConfigWriteResult {
  return updateGitCronConfigValue({ filePath, segments: ['mcpServers', name], value: server, newFileText: MCP_NEW_FILE_TEXT });
}

// ─── Conversión desde OpenCode (D12) ───

/** `{env:X}` de OpenCode → `${env:X}` de la notación `mcpServers`. */
function convertReferences<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/(?<!\$)\{env:([A-Za-z0-9_]+)\}/g, '${env:$1}') as T;
  if (Array.isArray(value)) return value.map(convertReferences) as T;
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convertReferences(v)])) as T;
  return value;
}

export interface ConvertedMcpServer {
  server: McpServer;
  /** `enabled: false` en OpenCode: `mcpServers` no tiene ese campo y se deja como comentario. */
  disabled: boolean;
}

/**
 * Un servidor del bloque `mcp` de OpenCode en la notación `mcpServers` (D12):
 * `type: "local"` con `command: [cmd, ...args]` → `command` + `args`;
 * `environment` → `env`; `type: "remote"` → `url` + `headers`; `{env:X}` → `${env:X}`.
 * Devuelve `null` si no es local ni remoto: no se inventa una conversión.
 */
export function convertOpenCodeMcpServer(entry: unknown): ConvertedMcpServer | null {
  if (!isObject(entry)) return null;
  const disabled = entry.enabled === false;
  if (entry.type === 'local' && Array.isArray(entry.command) && typeof entry.command[0] === 'string') {
    const [command, ...args] = entry.command as string[];
    const server: McpServer = { command, args };
    if (isObject(entry.environment) && Object.keys(entry.environment).length > 0) {
      server.env = entry.environment as Record<string, string>;
    }
    return { server: convertReferences(server), disabled };
  }
  if (entry.type === 'remote' && typeof entry.url === 'string') {
    const server: McpServer = { url: entry.url };
    if (isObject(entry.headers) && Object.keys(entry.headers).length > 0) {
      server.headers = entry.headers as Record<string, string>;
    }
    return { server: convertReferences(server), disabled };
  }
  return null;
}

// ─── Importación ───

export type McpImportSource = 'cursor' | 'lmstudio' | 'opencode';

export function getDefaultMcpSourcePath(source: McpImportSource): string {
  if (source === 'cursor') return path.join(os.homedir(), '.cursor', 'mcp.json');
  if (source === 'lmstudio') return path.join(os.homedir(), '.lmstudio', 'mcp.json');
  return getDefaultOpenCodePath();
}

export interface McpImportPlanEntry {
  name: string;
  status: 'new' | 'same' | 'changed';
  /** El servidor como quedaría en mcp.json: cada valor escrito a mano pasa a `${env:NOMBRE}`. */
  server: McpServer;
  disabled: boolean;
  changes: FieldChange[];
  variables: string[];
  /** Las variables cuyo valor estaba escrito a mano en el origen: van al baúl al aplicar. */
  fromFile: string[];
}

export interface McpImportPlan {
  source: ImportSourceStatus;
  target: { path: string; error?: GitCronConfigFileStatus['error'] };
  entries: McpImportPlanEntry[];
  /** Servidores de OpenCode que no son locales ni remotos: se dicen y no se importan. */
  skipped: string[];
}

export interface PlanMcpImportOptions {
  source: McpImportSource;
  sourcePath?: string;
  targetPath?: string;
  /** Las variables guardadas en el baúl: un nombre ocupado con otro valor no se pisa. */
  stored?: (name: string) => string | undefined;
  env?: NodeJS.ProcessEnv;
}

/**
 * Qué entraría en mcp.json desde Cursor o LM Studio (tal cual: ya usan
 * `mcpServers`) o desde el bloque `mcp` de OpenCode (convertido, D12). El archivo
 * de origen sólo se lee. Los valores escritos a mano en `env` y `headers` no se
 * copian: el plan pone `${env:NOMBRE}` y los nombra en `fromFile`.
 */
export function planMcpImport(options: PlanMcpImportOptions): McpImportPlan {
  const read = readJsoncSource(options.sourcePath ?? getDefaultMcpSourcePath(options.source));
  const { data, ...source } = read;
  const targetPath = options.targetPath ?? getDefaultMcpPath();
  const plan: McpImportPlan = { source, target: { path: targetPath }, entries: [], skipped: [] };
  if (!data) return plan;

  let current: Record<string, unknown> = {};
  if (fs.existsSync(targetPath)) {
    const parsed = parseGitCronConfigText(fs.readFileSync(targetPath, 'utf8'), targetPath);
    if (parsed.kind === 'error') {
      plan.target.error = parsed.error;
      return plan;
    }
    const raw = (parsed.config as Record<string, unknown>).mcpServers;
    current = isObject(raw) ? raw : {};
  }

  const incoming: Array<{ name: string; server: McpServer; disabled: boolean }> = [];
  if (options.source === 'opencode') {
    for (const [name, entry] of Object.entries(isObject(data.mcp) ? data.mcp : {})) {
      const converted = convertOpenCodeMcpServer(entry);
      if (converted) incoming.push({ name, ...converted });
      else plan.skipped.push(name);
    }
  } else {
    for (const [name, server] of Object.entries(isObject(data.mcpServers) ? data.mcpServers : {})) {
      if (isObject(server)) incoming.push({ name, server: server as McpServer, disabled: false });
    }
  }

  const naming: SecretNaming = {
    stored: options.stored ?? (() => undefined),
    env: options.env ?? process.env,
    taken: new Map(),
  };
  for (const { name, server: raw, disabled } of incoming) {
    const before = current[name];
    const replaced = replaceLiteralSecrets(raw, mcpSecretSlots(name, raw), before, 'mcp', naming);
    const server = replaced.value as McpServer;
    const changes = before === undefined ? [] : diffValues(before, server);
    plan.entries.push({
      name,
      status: before === undefined ? 'new' : changes.length === 0 ? 'same' : 'changed',
      server,
      disabled,
      changes,
      variables: referencedVariables(server),
      fromFile: replaced.fromFile,
    });
  }
  return plan;
}

const DISABLED_COMMENT = 'enabled: false en OpenCode: mcpServers no tiene ese campo';

/** Dónde empieza la línea en que se declara un servidor, y la de arriba. */
function serverLineStarts(text: string, name: string): { offset: number; lineStart: number; previousLineStart: number } | null {
  const tree = parseTree(text);
  const property = tree ? findNodeAtLocation(tree, ['mcpServers', name])?.parent : undefined;
  if (!property) return null;
  const lineStart = text.lastIndexOf('\n', property.offset - 1) + 1;
  return { offset: property.offset, lineStart, previousLineStart: text.lastIndexOf('\n', lineStart - 2) + 1 };
}

/** Si un servidor lleva justo encima el comentario del `enabled: false` de OpenCode (D12). */
export function isMcpServerMarkedDisabled(text: string, name: string): boolean {
  const lines = serverLineStarts(text, name);
  return lines !== null && text.slice(lines.previousLineStart, lines.lineStart).trim() === `// ${DISABLED_COMMENT}`;
}

/**
 * Deja un comentario de línea encima de un servidor, una sola vez. Es como D12
 * conserva el `enabled: false` de OpenCode.
 */
function commentAboveServer(filePath: string, name: string, comment: string): void {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = serverLineStarts(text, name);
  if (!lines) return;
  const { offset, lineStart, previousLineStart } = lines;
  const indent = text.slice(lineStart, offset);
  const { eol } = detectFormatting(text);
  const line = `${indent}// ${comment}${eol}`;
  // Ya está justo encima: no se repite.
  if (text.slice(previousLineStart, lineStart).trim() === `// ${comment}`) return;
  const next = applyEdits(text, [{ offset: lineStart, length: 0, content: line }]);
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Escribe en mcp.json los servidores confirmados (pasar la entrada es confirmarla).
 * Si un servidor trae valores escritos a mano (`fromFile`), se releen del origen y
 * se guardan con `saveSecret` antes de escribir: mcp.json recibe sólo `${env:NOMBRE}`.
 * El archivo de origen sólo se lee.
 */
export function applyMcpImport(options: {
  targetPath?: string;
  entries: McpImportPlanEntry[];
  source?: McpImportSource;
  sourcePath?: string;
  saveSecret?: (name: string, value: string) => void;
}): Array<{ name: string; result: ConfigWriteResult }> {
  const filePath = options.targetPath ?? getDefaultMcpPath();
  const toWrite = options.entries.filter((entry) => entry.status !== 'same');

  if (toWrite.some((entry) => entry.fromFile.length > 0)) {
    if (!options.saveSecret || !options.source) {
      throw new Error('applyMcpImport: falta saveSecret o source para los valores escritos a mano');
    }
    const data = readJsoncSource(options.sourcePath ?? getDefaultMcpSourcePath(options.source)).data ?? {};
    for (const entry of toWrite) {
      if (entry.fromFile.length === 0) continue;
      const raw = options.source === 'opencode'
        ? convertOpenCodeMcpServer(isObject(data.mcp) ? data.mcp[entry.name] : undefined)?.server
        : isObject(data.mcpServers) ? data.mcpServers[entry.name] : undefined;
      for (const { name, value } of literalSecretsToSave(raw, entry.server, mcpSecretSlots(entry.name, raw))) {
        options.saveSecret(name, value);
      }
    }
  }

  return toWrite.map((entry) => {
    const result = updateMcpServer(filePath, entry.name, entry.server);
    if (result.ok && entry.disabled) commentAboveServer(filePath, entry.name, DISABLED_COMMENT);
    return { name: entry.name, result };
  });
}
