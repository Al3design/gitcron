// electron/ipc/ai-config.ts
//
// Sección de ajustes «Motores y modelos» (modelos-en-casa 6.1):
// - Configuración integral de proveedores, modelos, parámetros y destino sin abrir gitcron.json.
// - Claves guardadas en el baúl seguro (nunca vuelven al renderer ni se escriben en el archivo).
// - Contexto guardado en gitcron.json como limit.context del modelo.
// - Tiempo de carga (TTL) guardado en la carpeta de datos en archivo JSON por proveedor y modelo.
// - Apertura de gitcron.json en uso validada contra traversal y archivos ajenos.
// - Importar desde OpenCode y servidores MCP: las rutas las decide este proceso, nunca
//   la pantalla; un valor escrito a mano en el archivo de origen va al baúl y no viaja.

import * as crypto from 'node:crypto';
import * as nodeFs from 'node:fs';
import path from 'node:path';
import { clipboard, ipcMain, shell } from 'electron';
import { findNodeAtLocation, parse, parseTree, type Node, type ParseError } from 'jsonc-parser';
import {
  determineDestination,
  getDefaultConfigPath,
  GitCronConfigError,
  loadGitCronConfig,
  parseGitCronConfigText,
  RESERVED_CLI_IDS,
  substituteReferences,
  type GitCronConfigFileStatus,
  type GitCronProviderConfig,
  type LoadedGitCronConfig,
  type ReservedCliId,
} from '../ai/config/gitcron-config';
import { validateGitCronConfig } from '../ai/config/gitcron-config-validate';
import { updateGitCronConfigValue, type ConfigWriteResult } from '../ai/config/gitcron-config-writer';
import {
  addModelToConfig,
  detectCanLoad,
  listProviderModels,
  removeModelFromConfig,
  serverOrigin,
} from '../ai/config/provider-models';
import { getToolModelsForUse } from '../ai/config/model-catalog';
import { isTextUse, type TextUse } from '../ai/config/resolve-model-for';
import {
  getModelLoadSettings,
  saveModelLoadSettings,
} from '../ai/config/model-load-settings';
import {
  getStoredEnvVar,
  hasStoredEnvVar,
  removeEnvVar,
  setEnvVar,
  validateEnvVarName,
} from '../ai/key-store';
import { leafChanges, type FieldChange } from '../ai/config/config-diff';
import {
  applyOpenCodeImport,
  getDefaultOpenCodePath,
  isProviderSecretField,
  planOpenCodeImport,
  type ImportSourceStatus,
} from '../ai/config/opencode-import';
import {
  applyMcpImport,
  commentAboveServer,
  DISABLED_COMMENT,
  getDefaultMcpPath,
  getDefaultMcpSourcePath,
  isMcpServerMarkedDisabled,
  loadMcpConfig,
  mcpServerKind,
  planMcpImport,
  updateMcpServer,
  type McpImportSource,
  type McpServer,
} from '../ai/config/mcp-config';
import {
  buildMcpExport,
  detectLiteralSecrets,
  type McpExportPlan,
  type McpExportTarget,
} from '../ai/config/mcp-export';
import { isLiteralSecret, referenceName, type SecretNaming } from '../ai/config/literal-secrets';
import { activeConfigPath, loadServerFor, setUseConfigPathForTesting } from '../ai/use-resolution';
import { authorizedRepoRoot } from './authorized-repos';
import { watchGitCronConfigFor } from './commit-message-ai';
import { errMsg } from './shared';

type Result<T> = { success: boolean; data?: T; error?: string };
const ok = <T>(data: T): Result<T> => ({ success: true, data });
const fail = <T>(error: unknown): Result<T> => ({ success: false, error: errMsg(error) });

let configPathOverride: string | null = null;
let openCodePathOverride: string | null = null;
let mcpPathOverride: string | null = null;
const mcpImportSourceOverrides = new Map<McpImportSource, string>();

export function setAiConfigPathForTesting(p: string | null): void {
  configPathOverride = p;
  setUseConfigPathForTesting(p);
}

export function setOpenCodePathForTesting(p: string | null): void {
  openCodePathOverride = p;
}

export function setMcpPathForTesting(p: string | null): void {
  mcpPathOverride = p;
}

export function setMcpImportSourcePathForTesting(source: McpImportSource, p: string | null): void {
  if (p) mcpImportSourceOverrides.set(source, p);
  else mcpImportSourceOverrides.delete(source);
}

function resolveActiveConfigPath(): string {
  return configPathOverride ?? activeConfigPath() ?? getDefaultConfigPath();
}

/** El mcp.json global: el destino de toda importación (como gitcron.json para OpenCode). */
function resolveGlobalMcpPath(): string {
  return mcpPathOverride ?? getDefaultMcpPath();
}

/**
 * Detecta si el archivo gitcron.json tiene valores literales escritos a mano en apiKey o headers (D5).
 * Devuelve si tiene secretos y la línea aproximada donde se detectó el primer secreto.
 * Tolerante a errores de sintaxis (jsonc-parser parse con errores + regex crudo sobre el texto).
 */
export function findConfigFileLiteralSecret(
  rawText: string,
  filePath?: string,
): { hasSecret: boolean; line?: number } {
  if (!rawText || typeof rawText !== 'string') return { hasSecret: false };

  // 1. Árbol AST para determinar líneas exactas si el parser puede estructurar nodos
  const root = parseTree(rawText);
  if (root) {
    let foundLine: number | undefined;
    const inspect = (node: Node): boolean => {
      if (node.type === 'property' && node.children && node.children.length >= 2) {
        const keyNode = node.children[0];
        const valNode = node.children[1];
        if (keyNode.value === 'apiKey') {
          if (valNode.type === 'string' && isLiteralSecret(valNode.value)) {
            foundLine = rawText.slice(0, valNode.offset).split('\n').length;
            return true;
          }
        } else if (keyNode.value === 'headers' && valNode.type === 'object' && valNode.children) {
          for (const headerProp of valNode.children) {
            const hValNode = headerProp.children?.[1];
            if (hValNode?.type === 'string' && isLiteralSecret(hValNode.value)) {
              foundLine = rawText.slice(0, hValNode.offset).split('\n').length;
              return true;
            }
          }
        }
      }
      if (node.children) {
        for (const child of node.children) {
          if (inspect(child)) return true;
        }
      }
      return false;
    };
    if (inspect(root)) {
      return { hasSecret: true, line: foundLine };
    }
  }

  // 2. Lectura tolerante de jsonc-parser para objetos recuperados aunque haya errores de sintaxis
  const errors: ParseError[] = [];
  try {
    const parsed = parse(rawText, errors, { allowTrailingComma: true });
    const searchObj = (obj: unknown): boolean => {
      if (!obj || typeof obj !== 'object') return false;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (searchObj(item)) return true;
        }
        return false;
      }
      const rec = obj as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        if (k === 'apiKey') {
          if (typeof v === 'string' && isLiteralSecret(v)) return true;
        } else if (k === 'headers' && v && typeof v === 'object' && !Array.isArray(v)) {
          for (const hVal of Object.values(v as Record<string, unknown>)) {
            if (typeof hVal === 'string' && isLiteralSecret(hVal)) return true;
          }
        }
        if (typeof v === 'object' && searchObj(v)) return true;
      }
      return false;
    };
    if (searchObj(parsed)) {
      const line = rawText.slice(0, rawText.indexOf('apiKey')).split('\n').length;
      return { hasSecret: true, line: line > 0 ? line : 1 };
    }
  } catch {
    // Continuar a regex ante error catastrófico de parse
  }

  // 3. Expresión sobre el texto crudo para "apiKey" o cabeceras que no sean referencias {env:...} ni {file:...}
  const apiKeyRegex = /"apiKey"\s*:\s*["']([^"'\\]*(?:\\.[^"'\\]*)*)["']?/g;
  let match: RegExpExecArray | null;
  while ((match = apiKeyRegex.exec(rawText)) !== null) {
    if (isLiteralSecret(match[1])) {
      const line = rawText.slice(0, match.index).split('\n').length;
      return { hasSecret: true, line };
    }
  }

  const headersRegex = /"headers"\s*:\s*\{([^}]+)\}/g;
  while ((match = headersRegex.exec(rawText)) !== null) {
    const headersBlock = match[1];
    const headerItemRegex = /["'][^"']+["']\s*:\s*["']([^"'\\]*(?:\\.[^"'\\]*)*)["']/g;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = headerItemRegex.exec(headersBlock)) !== null) {
      if (isLiteralSecret(itemMatch[1])) {
        const line = rawText.slice(0, match.index + itemMatch.index).split('\n').length;
        return { hasSecret: true, line };
      }
    }
  }

  return { hasSecret: false };
}

export function detectConfigFileLiteralSecrets(rawText: string, filePath?: string): boolean {
  return findConfigFileLiteralSecret(rawText, filePath).hasSecret;
}

const MCP_IMPORT_SOURCES: readonly McpImportSource[] = ['cursor', 'lmstudio', 'opencode'];

function mcpImportSourceArg(rawArgs: unknown): McpImportSource {
  const source = (rawArgs as { source?: unknown } | null)?.source;
  if (!MCP_IMPORT_SOURCES.includes(source as McpImportSource)) {
    throw new Error(`Origen de importación MCP desconocido: ${String(source)}`);
  }
  return source as McpImportSource;
}

/** Variables de sistema primero: le ganan a las guardadas al resolver `{env:}` (D5). */
function envVarStatus(name: string): 'system' | 'stored' | 'missing' {
  const fromSystem = process.env[name];
  if (fromSystem !== undefined && fromSystem !== '') return 'system';
  try {
    return hasStoredEnvVar(name) ? 'stored' : 'missing';
  } catch {
    // Un nombre que el baúl no admite (empieza con un número, por ejemplo) no puede estar guardado.
    return 'missing';
  }
}

/** Ausente e ilegible se dicen distinto; la ruta va siempre. */
function importSourceInfo(source: ImportSourceStatus) {
  return source.status === 'invalid'
    ? { status: source.status, path: source.path, error: { ...source.error } }
    : { status: source.status, path: source.path };
}

/** Un cambio de campo para la pantalla: en un campo secreto, un valor escrito a mano no viaja. */
function rendererChange(change: FieldChange, secretField: boolean) {
  const hidden = (value: unknown) => secretField && value !== undefined && referenceName(value) === undefined;
  return {
    segments: change.segments,
    ...(hidden(change.before) ? { beforeHidden: true } : { before: change.before }),
    ...(hidden(change.after) ? { afterHidden: true } : { after: change.after }),
  };
}

/**
 * Lo que la pantalla ve de un servidor MCP: el programa (sin carpeta) o el host,
 * y los nombres de sus variables y cabeceras. Ni los argumentos ni la dirección
 * completa: también pueden llevar tokens (una contraseña en una URL de base de datos).
 */
function mcpServerSummary(server: McpServer) {
  let host: string | undefined;
  if (typeof server.url === 'string') {
    try {
      host = new URL(server.url).host || undefined;
    } catch {
      host = undefined;
    }
  }
  const keysOf = (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  return {
    kind: mcpServerKind(server),
    command: typeof server.command === 'string' ? path.basename(server.command) : undefined,
    host,
    envVarNames: keysOf(server.env),
    headerNames: keysOf(server.headers),
  };
}

function throwIfNotWritten(results: Array<{ result: ConfigWriteResult }>): void {
  const failed = results.find((r) => !r.result.ok)?.result;
  if (failed && !failed.ok) {
    throw new Error(failed.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
  }
}

const sameFile = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function extractEnvVarNames(value: unknown): string[] {
  const vars: string[] = [];
  const regex = /\{env:([A-Za-z_][A-Za-z0-9_]{0,127})\}/g;
  const scan = (val: unknown) => {
    if (typeof val === 'string') {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(val)) !== null) {
        if (!vars.includes(match[1])) vars.push(match[1]);
      }
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const v of Object.values(val as Record<string, unknown>)) scan(v);
    }
  };
  scan(value);
  return vars;
}

export function usesChoosingProvider(providerId: string, loaded: LoadedGitCronConfig): string[] {
  const affected: string[] = [];
  const prefix = `${providerId}/`;
  if (
    typeof loaded.config?.model === 'string' &&
    (loaded.config.model === providerId || loaded.config.model.startsWith(prefix))
  ) {
    affected.push('general');
  }
  const textUses: TextUse[] = [
    'gitcron-commit',
    'gitcron-cartography',
    'gitcron-openspec-analysis',
    'gitcron-temporal',
    'gitcron-assist',
  ];
  for (const use of textUses) {
    const agentModel = loaded.config?.agent?.[use]?.model;
    if (
      typeof agentModel === 'string' &&
      (agentModel === providerId || agentModel.startsWith(prefix))
    ) {
      affected.push(use);
    }
  }
  return affected;
}

export function removeAgentOptionClean(filePath: string, use: string, optionKey: string): ConfigWriteResult {
  if (nodeFs.existsSync(filePath)) {
    try {
      const content = nodeFs.readFileSync(filePath, 'utf8');
      const root = parseTree(content);
      const optionsNode = root ? findNodeAtLocation(root, ['agent', use, 'options']) : null;
      if (optionsNode && optionsNode.type === 'object') {
        const props = optionsNode.children ?? [];
        const remaining = props.filter((p) => p.children?.[0]?.value !== optionKey);
        if (remaining.length === 0) {
          return updateGitCronConfigValue({ filePath, segments: ['agent', use, 'options'], value: undefined });
        }
      }
    } catch {
      // continuar con borrado directo
    }
  }
  return updateGitCronConfigValue({ filePath, segments: ['agent', use, 'options', optionKey], value: undefined });
}

/**
 * El proveedor donde va el contexto de un modelo: el que se pasa (la sección lo sabe), el
 * del servidor de carga del uso (`loadServerFor`), o el que declara ese modelo. Sólo un
 * proveedor declarado en el archivo: escribir `limit.context` en uno que no está crearía
 * un bloque a medias, sin dirección.
 */
function loadProviderFor(
  rawProviderId: unknown,
  rawUse: unknown,
  repoPath: string | null,
  modelId: string,
  loaded: LoadedGitCronConfig,
): string | null {
  const declared = loaded.config?.provider ?? {};
  const explicit = typeof rawProviderId === 'string' ? rawProviderId.trim() : '';
  if (explicit) return declared[explicit] ? explicit : null;
  if (isTextUse(rawUse)) {
    const found = loadServerFor(rawUse, repoPath);
    if ('server' in found && declared[found.server.providerId]) return found.server.providerId;
  }
  for (const [pId, pConfig] of Object.entries(declared)) {
    if (pConfig?.models && pConfig.models[modelId]) return pId;
  }
  return null;
}

export function registerAiConfigHandlers(): void {
  // ─── Estado general de la sección Motores y Modelos ───
  ipcMain.handle('ai-config:status', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { repoPath?: unknown };
      const rawRepo = args.repoPath;
      const repoPath = typeof rawRepo === 'string' && rawRepo.trim() ? authorizedRepoRoot(rawRepo) : null;
      if (_e?.sender) watchGitCronConfigFor(_e.sender, repoPath);
      const globalPath = resolveActiveConfigPath();

      let loaded: LoadedGitCronConfig;
      let parseError: GitCronConfigError['parseError'] | undefined;
      try {
        loaded = loadGitCronConfig({ globalPath, repoPath });
      } catch (err: any) {
        if (err instanceof GitCronConfigError) {
          parseError = err.parseError;
          loaded = {
            config: null,
            files: [
              {
                path: globalPath,
                scope: 'global',
                exists: nodeFs.existsSync(globalPath),
                error: parseError,
              },
            ],
            originOf: () => undefined,
          };
        } else {
          throw err;
        }
      }

      const files = loaded.files.map((f) => ({
        path: f.path,
        scope: f.scope,
        exists: f.exists,
        error: f.error ? { ...f.error } : undefined,
        usingLastValid: f.usingLastValid,
      }));

      const warnings = loaded.config ? validateGitCronConfig(loaded.config, loaded.originOf) : [];
      const generalModel = typeof loaded.config?.model === 'string' ? loaded.config.model : null;
      const smallModel = typeof loaded.config?.small_model === 'string' ? loaded.config.small_model : null;

      // Proveedores declarados en gitcron.json
      const providers: import('../../types/ai-config').AiConfigProviderInfo[] = [];

      const declaredProviders = (loaded.config?.provider ?? {}) as Record<string, GitCronProviderConfig>;
      for (const [pId, p] of Object.entries(declaredProviders)) {
        if (!p || typeof p !== 'object') continue;
        const family: 'openai-compatible' | 'anthropic' | 'cli' =
          p.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai-compatible';
        const rawBaseURL = typeof p.options?.baseURL === 'string' ? p.options.baseURL : undefined;

        // Variables de entorno referenciadas
        const allVars = extractEnvVarNames(p.options ?? {});
        const apiKeyVars = extractEnvVarNames(p.options?.apiKey);

        const envVars = allVars.map((name) => ({
          name,
          isApiKey: apiKeyVars.includes(name),
          status: envVarStatus(name),
        }));

        const missingRequired = envVars.some((v) => v.status === 'missing');
        let available = true;
        let unavailableReason: string | null = null;
        if (!rawBaseURL && family === 'openai-compatible') {
          available = false;
          unavailableReason = `El proveedor «${pId}» no declara options.baseURL`;
        } else if (missingRequired) {
          available = false;
          const missingNames = envVars.filter((v) => v.status === 'missing').map((v) => v.name).join(', ');
          unavailableReason = `Variable faltante: ${missingNames}`;
        }

        let canLoad = false;
        if (rawBaseURL && available) {
          const resolved = substituteReferences(p.options ?? {}, { env: process.env, stored: getStoredEnvVar });
          const baseURL = typeof resolved.value.baseURL === 'string' ? resolved.value.baseURL : rawBaseURL;
          canLoad = await detectCanLoad(baseURL, {
            headers: (resolved.value.headers as Record<string, string>) ?? {},
          }).catch(() => false);
        }

        providers.push({
          id: pId,
          name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : pId,
          family,
          baseURL: rawBaseURL,
          destination: determineDestination(rawBaseURL, family),
          available,
          unavailableReason,
          canLoad,
          isCli: false,
          envVars,
          declaredModels: Object.keys(p.models ?? {}),
        });
      }

      // Proveedores CLI reservados (Codex, Claude Code, Antigravity)
      let toolModels: any = null;
      try {
        toolModels = await getToolModelsForUse({
          use: 'gitcron-commit',
          repoPath,
          configPath: globalPath,
          loaded,
          stored: getStoredEnvVar,
        });
      } catch {
        // En caso de fallo en CLI, continuar con datos básicos
      }

      for (const cliId of RESERVED_CLI_IDS) {
        const found = toolModels?.providers?.find((p: any) => p.id === cliId);
        const name =
          cliId === 'codex' ? 'Codex' : cliId === 'claude-code' ? 'Claude Code' : 'Antigravity';
        providers.push({
          id: cliId,
          name: found?.name ?? name,
          family: 'cli',
          destination: determineDestination(undefined, 'cli'),
          available: Boolean(found?.available),
          unavailableReason: found?.unavailableReason ?? null,
          canLoad: false,
          isCli: true,
          envVars: [],
          declaredModels: [],
        });
      }

      // Usos de IA (incluido el agente de SDD, pedido de Ale, tarea 24)
      const allAiUses: import('../ai/config/resolve-model-for').AiUse[] = [
        'gitcron-commit',
        'gitcron-cartography',
        'gitcron-openspec-analysis',
        'gitcron-temporal',
        'gitcron-assist',
        'gitcron-sdd',
      ];
      const uses = allAiUses.map((use) => {
        const agentEntry = loaded.config?.agent?.[use];
        const agentModel = typeof agentEntry?.model === 'string' && agentEntry.model.trim() ? agentEntry.model.trim() : null;
        const model = agentModel ?? generalModel;
        const isException = agentModel !== null && Boolean(generalModel);
        const modelSource: 'general' | 'agent' = agentModel !== null ? 'agent' : 'general';

        const temperature = typeof agentEntry?.temperature === 'number' ? agentEntry.temperature : undefined;
        const maxTokens =
          typeof agentEntry?.options?.max_tokens === 'number'
            ? agentEntry.options.max_tokens
            : undefined;

        // Opciones avanzadas (excluyendo max_tokens y reasoning_effort)
        const advancedOptions: Array<{ key: string; value: unknown; warning?: string }> = [];
        if (agentEntry?.options && typeof agentEntry.options === 'object') {
          for (const [k, v] of Object.entries(agentEntry.options)) {
            if (k === 'max_tokens' || k === 'reasoning_effort') continue;
            let warning: string | undefined;
            if (k === 'reasoning_effort' && typeof v === 'string' && !['minimal', 'low', 'medium', 'high'].includes(v)) {
              warning = `El estándar de OpenAI espera: minimal, low, medium, high`;
            }
            advancedOptions.push({ key: k, value: v, warning });
          }
        }

        const variant = typeof agentEntry?.variant === 'string' && agentEntry.variant.trim() ? agentEntry.variant.trim() : undefined;
        const effort = typeof agentEntry?.options?.reasoning_effort === 'string' && agentEntry.options.reasoning_effort.trim()
          ? agentEntry.options.reasoning_effort.trim()
          : undefined;

        return {
          use,
          model,
          modelSource,
          isException,
          variant,
          effort,
          temperature,
          maxTokens,
          advancedOptions,
        };
      });

      return ok({
        files,
        warnings,
        generalModel,
        smallModel,
        providers,
        uses,
      });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Modelos de un proveedor (declarados y reportados por el servidor) ───
  ipcMain.handle('ai-config:provider-models', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { providerId?: unknown; repoPath?: unknown };
      const providerId = typeof args.providerId === 'string' ? args.providerId.trim() : '';
      if (!providerId) throw new Error('Debe especificar un providerId.');

      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const globalPath = resolveActiveConfigPath();
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const list = await listProviderModels(providerId, {
        configPath: globalPath,
        repoPath,
        loaded,
        stored: getStoredEnvVar,
        env: process.env,
      });

      // Sumar tiempos de carga guardados por modelo
      const modelsWithTtl = list.models.map((m) => {
        const savedTtl = getModelLoadSettings(providerId, m.id);
        return {
          ...m,
          ttlMinutes: savedTtl?.ttlMinutes ?? 30,
        };
      });

      return ok({
        ...list,
        models: modelsWithTtl,
      });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Agregar proveedor del estándar compatible con OpenAI ───
  ipcMain.handle('ai-config:add-provider', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        id?: unknown;
        name?: unknown;
        baseURL?: unknown;
        apiKey?: unknown;
        repoPath?: unknown;
      };
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        throw new Error('El identificador del proveedor debe contener sólo letras, números, guiones y guiones bajos (1-64 caracteres).');
      }
      if (RESERVED_CLI_IDS.includes(id as ReservedCliId)) {
        throw new Error(`El identificador «${id}» está reservado para una suscripción por CLI.`);
      }

      const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : id;
      const baseURL = typeof args.baseURL === 'string' ? args.baseURL.trim() : '';
      if (!baseURL) {
        throw new Error('Debe especificar la dirección del proveedor (options.baseURL).');
      }

      // D2: se escribe en el gitcron.json global; el del repositorio queda para editarlo a mano.
      const globalPath = resolveActiveConfigPath();
      const existing = loadGitCronConfig({ globalPath, repoPath: null });
      if (existing.config?.provider?.[id]) {
        throw new Error(`Ya hay un proveedor «${id}». Elegí otro identificador.`);
      }

      const apiKey = typeof args.apiKey === 'string' && args.apiKey.trim() ? args.apiKey.trim() : undefined;
      let envVarName: string | undefined;

      if (apiKey) {
        // Derivar nombre de variable válido para el baúl
        let clean = id.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        if (/^[0-9]/.test(clean)) clean = `AI_${clean}`;
        envVarName = `${clean}_API_KEY`;
        validateEnvVarName(envVarName);

        // Guardar la clave en el baúl seguro; NUNCA al archivo
        setEnvVar(envVarName, apiKey);
      }

      const providerBlock: Record<string, unknown> = {
        name,
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL,
          ...(envVarName ? { apiKey: `{env:${envVarName}}` } : {}),
        },
      };

      const res = updateGitCronConfigValue({
        filePath: globalPath,
        segments: ['provider', id],
        value: providerBlock,
      });

      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }

      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Quitar proveedor ───
  ipcMain.handle('ai-config:remove-provider', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        id?: unknown;
        repoPath?: unknown;
        deleteStoredVar?: unknown;
      };
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) throw new Error('Debe especificar un id de proveedor.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const targetFile = loaded.originOf(['provider', id]) ?? globalPath;
      const provider = loaded.config?.provider?.[id];

      // Si la persona pide borrar la variable guardada en GitCron
      // Sólo las variables que no usa nadie más: dos proveedores pueden compartir clave
      // (el mismo servidor por la red de la casa y por el túnel, por ejemplo).
      if (args.deleteStoredVar && provider?.options) {
        const rest = { ...(loaded.config ?? {}), provider: { ...(loaded.config?.provider ?? {}) } };
        delete (rest.provider as Record<string, unknown>)[id];
        const stillUsed = new Set(extractEnvVarNames(rest));
        for (const v of extractEnvVarNames(provider.options)) {
          if (!stillUsed.has(v) && hasStoredEnvVar(v)) removeEnvVar(v);
        }
      }

      const res = updateGitCronConfigValue({
        filePath: targetFile,
        segments: ['provider', id],
        value: undefined,
      });

      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }

      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Agregar modelo a gitcron.json ───
  ipcMain.handle('ai-config:add-model', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        providerId?: unknown;
        modelId?: unknown;
        name?: unknown;
        repoPath?: unknown;
      };
      const providerId = typeof args.providerId === 'string' ? args.providerId.trim() : '';
      const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
      const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined;
      if (!providerId || !modelId) throw new Error('Debe especificar providerId y modelId.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const res = addModelToConfig({ providerId, modelId, name, loaded });
      if (!res.ok) {
        throw new Error(
          res.reason === 'no-provider'
            ? `El proveedor «${providerId}» no está declarado en el archivo.`
            : res.reason === 'broken'
              ? 'El archivo tiene un error de sintaxis.'
              : 'No se pudo escribir el archivo.',
        );
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Quitar modelo de gitcron.json ───
  ipcMain.handle('ai-config:remove-model', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        providerId?: unknown;
        modelId?: unknown;
        repoPath?: unknown;
      };
      const providerId = typeof args.providerId === 'string' ? args.providerId.trim() : '';
      const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
      if (!providerId || !modelId) throw new Error('Debe especificar providerId y modelId.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const res = removeModelFromConfig({ providerId, modelId, loaded });
      if (!res.ok) {
        throw new Error(
          res.reason === 'no-provider'
            ? `El proveedor «${providerId}» no está declarado en el archivo.`
            : res.reason === 'broken'
              ? 'El archivo tiene un error de sintaxis.'
              : 'No se pudo escribir el archivo.',
        );
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Contexto y tiempo de carga (TTL) ───
  ipcMain.handle('ai-config:get-model-load-settings', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        providerId?: unknown;
        modelId?: unknown;
        use?: unknown;
        repoPath?: unknown;
      };
      const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
      if (!modelId) throw new Error('Debe especificar un modelId.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const providerId = loadProviderFor(args.providerId, args.use, repoPath, modelId, loaded);

      if (!providerId) return ok({ contextLength: 65536, ttlMinutes: 30 });
      const declaredContext = loaded.config?.provider?.[providerId]?.models?.[modelId]?.limit?.context;
      const savedTtl = getModelLoadSettings(providerId, modelId);

      return ok({
        contextLength: typeof declaredContext === 'number' && declaredContext > 0 ? declaredContext : 65536,
        ttlMinutes: savedTtl?.ttlMinutes ?? 30,
      });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:set-model-load-settings', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        providerId?: unknown;
        modelId?: unknown;
        use?: unknown;
        repoPath?: unknown;
        contextLength?: unknown;
        ttlMinutes?: unknown;
      };
      const modelId = typeof args.modelId === 'string' ? args.modelId.trim() : '';
      if (!modelId) throw new Error('Debe especificar un modelId.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });

      const providerId = loadProviderFor(args.providerId, args.use, repoPath, modelId, loaded);

      if (!providerId) {
        throw new Error('Este uso no carga modelos en un servidor declarado en gitcron.json.');
      }
      // 1. Contexto -> gitcron.json limit.context del modelo
      if (typeof args.contextLength === 'number' && args.contextLength > 0) {
        const targetFile = loaded.originOf(['provider', providerId]) ?? globalPath;
        const res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['provider', providerId, 'models', modelId, 'limit', 'context'],
          value: Math.round(args.contextLength),
        });
        if (!res.ok) {
          throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
        }
      }

      // 2. Tiempo de carga (TTL) -> archivo JSON en userData (NUNCA en gitcron.json)
      if (typeof args.ttlMinutes === 'number' && args.ttlMinutes > 0) {
        saveModelLoadSettings(providerId, modelId, { ttlMinutes: Math.round(args.ttlMinutes) });
      }

      return ok({ saved: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Elección general ───
  ipcMain.handle('ai-config:set-general-model', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        model?: unknown;
        effort?: unknown;
        variant?: unknown;
        repoPath?: unknown;
      };
      const model = typeof args.model === 'string' ? args.model.trim() : '';
      if (!model) throw new Error('Debe especificar un modelo.');

      const globalPath = resolveActiveConfigPath();
      const res = updateGitCronConfigValue({
        filePath: globalPath,
        segments: ['model'],
        value: model,
      });
      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Volver a la elección general (borra excepción de uso) ───
  ipcMain.handle('ai-config:clear-use-exception', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { use?: unknown; repoPath?: unknown };
      const use = args.use;
      if (!isTextUse(use)) throw new Error('Uso de IA desconocido.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });
      const targetFile = loaded.originOf(['agent', use]) ?? globalPath;

      // Borrar model y variant del agente
      updateGitCronConfigValue({ filePath: targetFile, segments: ['agent', use, 'model'], value: undefined });
      updateGitCronConfigValue({ filePath: targetFile, segments: ['agent', use, 'variant'], value: undefined });
      removeAgentOptionClean(targetFile, use, 'reasoning_effort');

      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Modificar / quitar parámetro de uso ───
  ipcMain.handle('ai-config:set-use-param', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        use?: unknown;
        param?: unknown;
        value?: unknown;
        repoPath?: unknown;
      };
      const use = args.use;
      if (!isTextUse(use)) throw new Error('Uso de IA desconocido.');
      const param = typeof args.param === 'string' ? args.param.trim() : '';
      if (!param) throw new Error('Debe especificar un nombre de parámetro.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });
      const targetFile = loaded.originOf(['agent', use]) ?? globalPath;

      let res: ConfigWriteResult;
      if (param === 'temperature') {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'temperature'],
          value: Number(args.value),
        });
      } else if (param === 'max_tokens') {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'options', 'max_tokens'],
          value: Number(args.value),
        });
      } else {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'options', param],
          value: args.value,
        });
      }

      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:remove-use-param', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        use?: unknown;
        param?: unknown;
        repoPath?: unknown;
      };
      const use = args.use;
      if (!isTextUse(use)) throw new Error('Uso de IA desconocido.');
      const param = typeof args.param === 'string' ? args.param.trim() : '';
      if (!param) throw new Error('Debe especificar un nombre de parámetro.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });
      const targetFile = loaded.originOf(['agent', use]) ?? globalPath;

      let res: ConfigWriteResult;
      if (param === 'temperature') {
        res = updateGitCronConfigValue({
          filePath: targetFile,
          segments: ['agent', use, 'temperature'],
          value: undefined,
        });
      } else {
        res = removeAgentOptionClean(targetFile, use, param);
      }

      if (!res.ok) {
        throw new Error(res.reason === 'broken' ? 'El archivo tiene un error de sintaxis.' : 'No se pudo escribir el archivo.');
      }
      return ok({ written: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── «Abrir el archivo» (rechaza cualquier ruta que no sea un gitcron.json o mcp.json en uso) ───
  ipcMain.handle('ai-config:open-file', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { filePath?: unknown; repoPath?: unknown };
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      if (!filePath) throw new Error('Ruta de archivo inválida.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });
      const mcpLoaded = loadMcpConfig({ globalPath: resolveGlobalMcpPath(), repoPath });

      const matched = loaded.files.find((f) => f.exists && sameFile(f.path, filePath))
        || mcpLoaded.files.find((f) => f.exists && sameFile(f.path, filePath));
      if (!matched) {
        throw new Error('IPC Security Error: el archivo no es un gitcron.json ni un mcp.json en uso');
      }

      const err = await shell.openPath(matched.path);
      if (err) throw new Error(err);
      return ok({ opened: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── «Mostrar en la carpeta» ───
  ipcMain.handle('ai-config:show-in-folder', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { filePath?: unknown; repoPath?: unknown };
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      if (!filePath) throw new Error('Ruta de archivo inválida.');

      const globalPath = resolveActiveConfigPath();
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadGitCronConfig({ globalPath, repoPath });
      const mcpLoaded = loadMcpConfig({ globalPath: resolveGlobalMcpPath(), repoPath });

      const matched = loaded.files.find((f) => f.exists && sameFile(f.path, filePath))
        || mcpLoaded.files.find((f) => f.exists && sameFile(f.path, filePath));
      if (!matched) {
        throw new Error('IPC Security Error: el archivo no es un gitcron.json ni un mcp.json en uso');
      }

      shell.showItemInFolder(matched.path);
      return ok({ shown: true });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── 4. Importar desde OpenCode (opencode.json, tarea 3.6) ───
  // Sólo hacia el gitcron.json global en uso. El plan ya trae `{env:NOMBRE}` en lugar de
  // cada clave o cabecera escrita a mano; al aplicar, el valor se relee y va al baúl.
  const openCodeImportPaths = () => ({
    opencodePath: openCodePathOverride ?? getDefaultOpenCodePath(),
    gitcronPath: resolveActiveConfigPath(),
  });

  ipcMain.handle('ai-config:plan-opencode-import', async () => {
    try {
      const plan = planOpenCodeImport({ ...openCodeImportPaths(), stored: getStoredEnvVar });
      return ok({
        source: importSourceInfo(plan.source),
        target: plan.target,
        entries: plan.entries.map((entry) => ({
          kind: entry.kind,
          id: entry.id,
          status: entry.status,
          changes: entry.changes.flatMap(leafChanges).map((change) =>
            rendererChange(change, entry.kind === 'provider' && isProviderSecretField(change.segments)),
          ),
          variables: entry.variables.map((name) => {
            const status = envVarStatus(name);
            return { name, status: status === 'missing' && entry.fromFile.includes(name) ? ('fromFile' as const) : status };
          }),
        })),
      });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:apply-opencode-import', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { entries?: unknown };
      const chosen = Array.isArray(args.entries) ? (args.entries as Array<{ kind?: unknown; id?: unknown }>) : [];
      const paths = openCodeImportPaths();
      const plan = planOpenCodeImport({ ...paths, stored: getStoredEnvVar });
      const results = applyOpenCodeImport({
        ...paths,
        entries: plan.entries.filter((entry) => chosen.some((c) => c?.kind === entry.kind && c?.id === entry.id)),
        saveSecret: setEnvVar,
      });
      throwIfNotWritten(results);
      return ok({ count: results.length });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── 5. Servidores MCP (mcp.json, D12) ───
  // Ningún uso de GitCron los consume todavía. La pantalla ve nombres, tipo, programa
  // o host y los nombres de `env` y `headers`; nunca sus valores.
  ipcMain.handle('ai-config:get-mcp-status', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { repoPath?: unknown };
      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadMcpConfig({ globalPath: resolveGlobalMcpPath(), repoPath });

      const texts = new Map<string, string>();
      const textOf = (filePath: string) => {
        if (!texts.has(filePath)) {
          try {
            texts.set(filePath, nodeFs.readFileSync(filePath, 'utf8'));
          } catch {
            texts.set(filePath, '');
          }
        }
        return texts.get(filePath)!;
      };

      const servers = Object.entries(loaded.servers).map(([name, server]) => {
        const origin = loaded.origins[name];
        return {
          name,
          ...mcpServerSummary(server),
          disabled: server.disabled === true || isMcpServerMarkedDisabled(textOf(origin), name),
          origin,
          scope: loaded.files.find((f) => f.path === origin)?.scope ?? ('global' as const),
        };
      });

      const files = loaded.files.map((f) => ({
        path: f.path,
        scope: f.scope,
        exists: f.exists,
        error: f.error ? { ...f.error } : undefined,
        usingLastValid: f.usingLastValid,
      }));

      return ok({ servers, files });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:remove-mcp-server', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { filePath?: unknown; name?: unknown; repoPath?: unknown };
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!filePath || !name) throw new Error('Parámetros inválidos para quitar servidor MCP.');

      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadMcpConfig({ globalPath: resolveGlobalMcpPath(), repoPath });
      const matched = loaded.files.find((f) => f.exists && sameFile(f.path, filePath));
      if (!matched) {
        throw new Error('IPC Security Error: el archivo no es un mcp.json en uso');
      }

      throwIfNotWritten([{ result: updateMcpServer(matched.path, name, undefined) }]);
      return ok({ removed: true });
    } catch (error) {
      return fail(error);
    }
  });

  // Importar va siempre al mcp.json global: lo de Cursor, LM Studio y OpenCode es de la
  // persona, no del repositorio (el del repositorio se puede versionar).
  const mcpImportPaths = (source: McpImportSource) => ({
    sourcePath: mcpImportSourceOverrides.get(source) ?? getDefaultMcpSourcePath(source),
    targetPath: resolveGlobalMcpPath(),
  });

  ipcMain.handle('ai-config:plan-mcp-import', async (_e, rawArgs: unknown) => {
    try {
      const source = mcpImportSourceArg(rawArgs);
      const plan = planMcpImport({ source, ...mcpImportPaths(source), stored: getStoredEnvVar });
      return ok({
        source: importSourceInfo(plan.source),
        target: plan.target,
        entries: plan.entries.map((entry) => ({
          name: entry.name,
          status: entry.status,
          disabled: entry.disabled,
          ...mcpServerSummary(entry.server),
          // Sólo qué campos cambian: los argumentos y la dirección pueden llevar tokens.
          changedFields: [...new Set(entry.changes.flatMap(leafChanges).map((change) => change.segments.join('.')))],
          fromFile: entry.fromFile,
        })),
        skipped: plan.skipped,
      });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:apply-mcp-import', async (_e, rawArgs: unknown) => {
    try {
      const source = mcpImportSourceArg(rawArgs);
      const args = (rawArgs ?? {}) as { entries?: unknown };
      const chosen = Array.isArray(args.entries) ? args.entries.filter((n): n is string => typeof n === 'string') : [];
      const paths = mcpImportPaths(source);
      const plan = planMcpImport({ source, ...paths, stored: getStoredEnvVar });
      const results = applyMcpImport({
        ...paths,
        source,
        entries: plan.entries.filter((entry) => chosen.includes(entry.name)),
        saveSecret: setEnvVar,
      });
      throwIfNotWritten(results);
      return ok({ count: results.length });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── «Copiar para otra herramienta» de servidores MCP (tarea 6.2, D12) ───

  ipcMain.handle('ai-config:prepare-mcp-copy', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { filePath?: unknown; name?: unknown; target?: unknown; repoPath?: unknown };
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      const target = typeof args.target === 'string' ? (args.target as McpExportTarget) : 'claude';
      if (!filePath || !name) throw new Error('Parámetros inválidos para preparar la copia MCP.');
      if (target !== 'claude' && target !== 'vscode' && target !== 'opencode') {
        throw new Error('Herramienta de destino inválida.');
      }

      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadMcpConfig({ globalPath: resolveGlobalMcpPath(), repoPath });
      const matched = loaded.files.find((f) => f.exists && sameFile(f.path, filePath));
      if (!matched) {
        throw new Error('IPC Security Error: el archivo no es un mcp.json en uso');
      }

      const server = loaded.servers[name];
      if (!server) {
        throw new Error(`Servidor MCP «${name}» no encontrado.`);
      }

      let text = '';
      try {
        text = nodeFs.readFileSync(matched.path, 'utf8');
      } catch {
        text = '';
      }
      const disabled = server.disabled === true || isMcpServerMarkedDisabled(text, name);

      const naming: SecretNaming = {
        stored: getStoredEnvVar,
        env: process.env,
        taken: new Map(),
      };

      const { exportPlan } = buildMcpExport({
        serverName: name,
        server,
        disabled,
        target,
        naming,
      });

      // El texto del portapapeles lleva la dirección completa (con su contraseña o tokens de
      // consulta): no sale del proceso principal. La pantalla ve sólo la vista previa tapada.
      const { clipboardText: _clipboardText, ...forScreen } = exportPlan;
      return ok(forScreen);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:copy-mcp-to-clipboard', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { filePath?: unknown; name?: unknown; target?: unknown; repoPath?: unknown };
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      const target = typeof args.target === 'string' ? (args.target as McpExportTarget) : 'claude';
      if (!filePath || !name) throw new Error('Parámetros inválidos para copiar servidor MCP.');
      if (target !== 'claude' && target !== 'vscode' && target !== 'opencode') {
        throw new Error('Herramienta de destino inválida.');
      }

      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadMcpConfig({ globalPath: resolveGlobalMcpPath(), repoPath });
      const matched = loaded.files.find((f) => f.exists && sameFile(f.path, filePath));
      if (!matched) {
        throw new Error('IPC Security Error: el archivo no es un mcp.json en uso');
      }

      const server = loaded.servers[name];
      if (!server) {
        throw new Error(`Servidor MCP «${name}» no encontrado.`);
      }

      let text = '';
      try {
        text = nodeFs.readFileSync(matched.path, 'utf8');
      } catch {
        text = '';
      }
      const disabled = server.disabled === true || isMcpServerMarkedDisabled(text, name);

      const naming: SecretNaming = {
        stored: getStoredEnvVar,
        env: process.env,
        taken: new Map(),
      };

      const { exportPlan } = buildMcpExport({
        serverName: name,
        server,
        disabled,
        target,
        naming,
      });

      clipboard.writeText(exportPlan.clipboardText);
      return ok({ copied: true });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('ai-config:save-mcp-literal-secrets', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { filePath?: unknown; name?: unknown; repoPath?: unknown };
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!filePath || !name) throw new Error('Parámetros inválidos para guardar secretos de servidor MCP.');

      const repoPath = typeof args.repoPath === 'string' && args.repoPath.trim() ? authorizedRepoRoot(args.repoPath) : null;
      const loaded = loadMcpConfig({ globalPath: resolveGlobalMcpPath(), repoPath });
      const matched = loaded.files.find((f) => f.exists && sameFile(f.path, filePath));
      if (!matched) {
        throw new Error('IPC Security Error: el archivo no es un mcp.json en uso');
      }

      const server = loaded.servers[name];
      if (!server) {
        throw new Error(`Servidor MCP «${name}» no encontrado.`);
      }

      let text = '';
      try {
        text = nodeFs.readFileSync(matched.path, 'utf8');
      } catch {
        text = '';
      }
      const disabled = server.disabled === true || isMcpServerMarkedDisabled(text, name);

      const naming: SecretNaming = {
        stored: getStoredEnvVar,
        env: process.env,
        taken: new Map(),
      };

      const { sanitizedServer, literalSecrets } = detectLiteralSecrets(name, server, naming);
      if (literalSecrets.length === 0) {
        return ok({ savedCount: 0, updatedFilePath: matched.path });
      }

      // Guardar en el baúl
      for (const secret of literalSecrets) {
        setEnvVar(secret.proposedVar, secret.value);
      }

      // Actualizar mcp.json con el servidor sanitizado puntual
      const writeRes = updateMcpServer(matched.path, name, sanitizedServer);
      throwIfNotWritten([{ result: writeRes }]);
      if (disabled) {
        commentAboveServer(matched.path, name, DISABLED_COMMENT);
      }

      return ok({ savedCount: literalSecrets.length, updatedFilePath: matched.path });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Leer archivo gitcron.json para el editor en pantalla (tarea 24) ───
  // Si tiene secretos literales en apiKey o headers, NO devuelve el contenido ni valores,
  // sólo indica hasLiteralSecrets: true. La ruta la decide este proceso, nunca la pantalla.
  ipcMain.handle('ai-config:read-file-content', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as { scope?: 'global' | 'repo'; repoPath?: string | null };
      const scope = args.scope === 'repo' ? 'repo' : 'global';
      let resolvedPath: string;
      if (scope === 'repo') {
        const repo = args.repoPath ? authorizedRepoRoot(args.repoPath) : null;
        if (!repo) throw new Error('Repositorio no autorizado o no especificado.');
        resolvedPath = path.join(repo, 'gitcron.json');
      } else {
        resolvedPath = resolveActiveConfigPath();
      }

      if (!nodeFs.existsSync(resolvedPath)) {
        return fail('El archivo no existe aún.');
      }

      const rawText = nodeFs.readFileSync(resolvedPath, 'utf8');

      if (detectConfigFileLiteralSecrets(rawText, resolvedPath)) {
        return ok({
          path: resolvedPath,
          scope,
          hasLiteralSecrets: true,
        });
      }

      const hash = crypto.createHash('sha256').update(rawText, 'utf8').digest('hex');
      return ok({
        path: resolvedPath,
        scope,
        content: rawText,
        hash,
        hasLiteralSecrets: false,
      });
    } catch (error) {
      return fail(error);
    }
  });

  // ─── Guardar archivo gitcron.json desde el editor (tarea 24) ───
  // Verifica colisión con el disco mediante hash base, sintaxis con parseGitCronConfigText,
  // advertencias con validateGitCronConfig y escritura atómica con temporal + renombrar.
  ipcMain.handle('ai-config:save-file-content', async (_e, rawArgs: unknown) => {
    try {
      const args = (rawArgs ?? {}) as {
        scope?: 'global' | 'repo';
        repoPath?: string | null;
        content?: string;
        baseHash?: string;
      };
      const scope = args.scope === 'repo' ? 'repo' : 'global';
      let resolvedPath: string;
      if (scope === 'repo') {
        const repo = args.repoPath ? authorizedRepoRoot(args.repoPath) : null;
        if (!repo) throw new Error('Repositorio no autorizado o no especificado.');
        resolvedPath = path.join(repo, 'gitcron.json');
      } else {
        resolvedPath = resolveActiveConfigPath();
      }

      const content = typeof args.content === 'string' ? args.content : '';

      // 1. baseHash es obligatorio; si el archivo no existe o su hash no coincide -> conflicto
      if (!args.baseHash || typeof args.baseHash !== 'string' || !args.baseHash.trim()) {
        return ok({ conflict: true });
      }

      if (!nodeFs.existsSync(resolvedPath)) {
        return ok({ conflict: true });
      }

      const currentDisk = nodeFs.readFileSync(resolvedPath, 'utf8');
      const diskHash = crypto.createHash('sha256').update(currentDisk, 'utf8').digest('hex');
      if (diskHash !== args.baseHash.trim()) {
        return ok({ conflict: true });
      }

      // 2. Secretos literales en el texto a guardar: NO se guarda y se indica la línea
      const secretCheck = findConfigFileLiteralSecret(content, resolvedPath);
      if (secretCheck.hasSecret) {
        return ok({
          secretRejected: true,
          secretLine: secretCheck.line,
        });
      }

      // 3. Error de sintaxis: NO se guarda y se envía parseError estructurado
      const parsed = parseGitCronConfigText(content, resolvedPath);
      if (parsed.kind === 'error') {
        return ok({
          parseError: parsed.error,
        });
      }

      // 3. Advertencias del esquema: SE GUARDA y se muestran
      const warnings = validateGitCronConfig(parsed.config, () => resolvedPath);

      // 4. Escritura atómica (temporal en la misma carpeta y renombrar encima)
      const dir = path.dirname(resolvedPath);
      if (!nodeFs.existsSync(dir)) {
        nodeFs.mkdirSync(dir, { recursive: true });
      }
      const tmp = path.join(dir, `.${path.basename(resolvedPath)}.${process.pid}.${Date.now()}.tmp`);
      try {
        nodeFs.writeFileSync(tmp, content, 'utf8');
        nodeFs.renameSync(tmp, resolvedPath);
      } catch (writeErr) {
        try {
          if (nodeFs.existsSync(tmp)) nodeFs.unlinkSync(tmp);
        } catch {
          // ignore
        }
        throw writeErr;
      }

      const newHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
      return ok({
        hash: newHash,
        warnings,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
