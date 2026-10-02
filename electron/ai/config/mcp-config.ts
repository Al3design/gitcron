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
  server: McpServer;
  disabled: boolean;
  changes: FieldChange[];
  variables: string[];
}

export interface McpImportPlan {
  source: ImportSourceStatus;
  target: { path: string; error?: GitCronConfigFileStatus['error'] };
  entries: McpImportPlanEntry[];
  /** Servidores de OpenCode que no son locales ni remotos: se dicen y no se importan. */
  skipped: string[];
}

/**
 * Qué entraría en mcp.json desde Cursor o LM Studio (tal cual: ya usan
 * `mcpServers`) o desde el bloque `mcp` de OpenCode (convertido, D12). El archivo
 * de origen sólo se lee.
 */
export function planMcpImport(options: { source: McpImportSource; sourcePath?: string; targetPath?: string }): McpImportPlan {
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

  for (const { name, server, disabled } of incoming) {
    const before = current[name];
    const changes = before === undefined ? [] : diffValues(before, server);
    plan.entries.push({
      name,
      status: before === undefined ? 'new' : changes.length === 0 ? 'same' : 'changed',
      server,
      disabled,
      changes,
      variables: referencedVariables(server),
    });
  }
  return plan;
}

const DISABLED_COMMENT = 'enabled: false en OpenCode: mcpServers no tiene ese campo';

/**
 * Deja un comentario de línea encima de un servidor, una sola vez. Es como D12
 * conserva el `enabled: false` de OpenCode.
 */
function commentAboveServer(filePath: string, name: string, comment: string): void {
  const text = fs.readFileSync(filePath, 'utf8');
  const node = findNodeAtLocation(parseTree(text)!, ['mcpServers', name]);
  const property = node?.parent;
  if (!property) return;
  const lineStart = text.lastIndexOf('\n', property.offset - 1) + 1;
  const indent = text.slice(lineStart, property.offset);
  const { eol } = detectFormatting(text);
  const line = `${indent}// ${comment}${eol}`;
  // Ya está justo encima: no se repite.
  const previousLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
  if (text.slice(previousLineStart, lineStart).trim() === `// ${comment}`) return;
  const next = applyEdits(text, [{ offset: lineStart, length: 0, content: line }]);
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, filePath);
}

/** Escribe en mcp.json los servidores confirmados (pasar la entrada es confirmarla). */
export function applyMcpImport(options: {
  targetPath?: string;
  entries: McpImportPlanEntry[];
}): Array<{ name: string; result: ConfigWriteResult }> {
  const filePath = options.targetPath ?? getDefaultMcpPath();
  return options.entries
    .filter((entry) => entry.status !== 'same')
    .map((entry) => {
      const result = updateMcpServer(filePath, entry.name, entry.server);
      if (result.ok && entry.disabled) commentAboveServer(filePath, entry.name, DISABLED_COMMENT);
      return { name: entry.name, result };
    });
}
