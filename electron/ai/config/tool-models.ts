// electron/ai/config/tool-models.ts
//
// Los modelos y niveles de intensidad que ofrece cada herramienta (tarea 4.5, D17).
// No se usa una lista fija en GitCron: Codex y Antigravity informan sus modelos
// con sus órdenes de catálogo vivo (`codex debug models`, `agy models`); Claude Code
// no tiene orden de catálogo y ofrece sus alias; los proveedores compatibles con
// OpenAI listan con el estándar y suman `variants` (D4) o `reasoning_effort`.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AiToolModel, AiToolProvider, AiUse, AiUseModelsResult } from '../../../types/ai-use';
import {
  CLI_EFFORT_LEVELS,
  defaultKillTree,
  type CliTextId,
  type ResolveExecutableFunction,
  type SpawnFunction,
} from '../cli-text-client';
import {
  loadGitCronConfig,
  RESERVED_CLI_IDS,
  type GitCronProviderConfig,
  type LoadedGitCronConfig,
} from './gitcron-config';
import { listProviderModels } from './provider-models';
import { resolveAgentFor } from './resolve-agent-for';
import { resolveModelFor } from './resolve-model-for';
import { resolveRuntimeExecutable } from '../../pipeline/runtime-adapters/process-runner';

/** Niveles de razonamiento estándar de OpenAI (minimal, low, medium, high). */
export const STANDARD_OPENAI_EFFORT_LEVELS: readonly string[] = ['minimal', 'low', 'medium', 'high'] as const;

/** Los 4 alias estándar que documenta Claude Code 2.1.284. */
export const CLAUDE_CODE_ALIASES: readonly { id: string; name: string }[] = [
  { id: 'fable', name: 'Claude Fable' },
  { id: 'opus', name: 'Claude Opus' },
  { id: 'sonnet', name: 'Claude Sonnet' },
  { id: 'haiku', name: 'Claude Haiku' },
] as const;

/**
 * Lee la salida de `codex debug models` (el catálogo vivo).
 * Ofrece sólo los de `visibility: "list"`.
 */
export function parseCodexModels(payload: unknown): AiToolModel[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as any).models)) {
    return [];
  }
  const result: AiToolModel[] = [];
  for (const m of (payload as any).models) {
    if (!m || typeof m !== 'object') continue;
    if (m.visibility !== 'list') continue;
    const slug = typeof m.slug === 'string' ? m.slug.trim() : '';
    if (!slug) continue;
    const name = typeof m.display_name === 'string' && m.display_name.trim() ? m.display_name.trim() : slug;
    const supportedLevels: string[] = [];
    if (Array.isArray(m.supported_reasoning_levels)) {
      for (const level of m.supported_reasoning_levels) {
        if (typeof level?.effort === 'string' && /^[a-z]+$/.test(level.effort)) {
          supportedLevels.push(level.effort);
        }
      }
    }
    const defaultLevel =
      typeof m.default_reasoning_level === 'string' && /^[a-z]+$/.test(m.default_reasoning_level)
        ? m.default_reasoning_level
        : undefined;

    result.push({
      id: slug,
      name,
      supportedLevels: supportedLevels.length > 0 ? supportedLevels : [...CLI_EFFORT_LEVELS.codex],
      defaultLevel,
    });
  }
  return result;
}

/**
 * Lee la salida de `agy models`.
 * Saltea el encabezado («Fetching available models...») y extrae `id\tname`.
 */
export function parseAgyModels(text: string): AiToolModel[] {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const result: AiToolModel[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.toLowerCase().startsWith('fetching available models')) continue;
    const tabIdx = line.indexOf('\t');
    let id: string;
    let name: string;
    if (tabIdx !== -1) {
      id = line.slice(0, tabIdx).trim();
      name = line.slice(tabIdx + 1).trim() || id;
    } else {
      id = line;
      name = line;
    }
    if (!id) continue;
    result.push({
      id,
      name,
      supportedLevels: [...CLI_EFFORT_LEVELS.antigravity],
    });
  }
  return result;
}

/** Modelos fijos (alias) para Claude Code. */
export function getClaudeCodeModels(): AiToolModel[] {
  return CLAUDE_CODE_ALIASES.map((alias) => ({
    id: alias.id,
    name: alias.name,
    supportedLevels: [...CLI_EFFORT_LEVELS['claude-code']],
  }));
}

interface CliCacheEntry {
  models: AiToolModel[];
  timestamp: number;
}

const cliCache = new Map<CliTextId, CliCacheEntry>();
const CLI_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

let defaultResolveExecutable: ResolveExecutableFunction | null = null;
let defaultSpawnFn: SpawnFunction | null = null;

/** Para pruebas: olvidar los catálogos ya pedidos. */
export function clearToolModelsCacheForTesting(): void {
  cliCache.clear();
}

export function setToolModelsExecutorsForTesting(
  resolve?: ResolveExecutableFunction | null,
  spawn?: SpawnFunction | null,
): void {
  defaultResolveExecutable = resolve ?? null;
  defaultSpawnFn = spawn ?? null;
}

/** Ejecuta un CLI en directorio temporal y devuelve su salida limpia. */
async function runCliCatalog(
  executableName: string,
  args: string[],
  options: {
    timeoutMs?: number;
    resolveExecutable?: ResolveExecutableFunction;
    spawnFn?: SpawnFunction;
  } = {},
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const resolve = options.resolveExecutable ?? defaultResolveExecutable ?? resolveRuntimeExecutable;
  const spawnFunc = options.spawnFn ?? defaultSpawnFn ?? spawn;
  // `agy models` va a la red («Fetching available models...»): 30 s de tope.
  const timeoutMs = options.timeoutMs ?? 30_000;

  let resolution;
  try {
    resolution = await resolve(executableName, process.env);
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `gitcron-${executableName}-catalog-`));
  try {
    return await new Promise((res) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const child = spawnFunc(resolution.file, args, {
        cwd: tempDir,
        shell: resolution.viaShell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        // El árbol entero: detrás de un acceso .cmd de npm el CLI real es hijo de cmd.exe.
        defaultKillTree(child);
        res({ ok: false, error: 'Tiempo agotado al consultar modelos' });
      }, timeoutMs);

      child.stdout?.on('data', (d) => { stdout += d.toString('utf8'); });
      child.stderr?.on('data', (d) => { stderr += d.toString('utf8'); });

      child.on('error', (err) => {
        clearTimeout(timer);
        res({ ok: false, error: err.message });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (code === 0) {
          res({ ok: true, stdout });
        } else {
          res({ ok: false, error: stderr.trim() || `Salió con código ${code}` });
        }
      });
    });
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export async function fetchCodexModels(
  options: {
    resolveExecutable?: ResolveExecutableFunction;
    spawnFn?: SpawnFunction;
    timeoutMs?: number;
    bypassCache?: boolean;
  } = {},
): Promise<{ ok: true; models: AiToolModel[] } | { ok: false; error: string }> {
  const cached = cliCache.get('codex');
  if (!options.bypassCache && cached && Date.now() - cached.timestamp < CLI_CACHE_TTL_MS) {
    return { ok: true, models: cached.models };
  }

  const res = await runCliCatalog('codex', ['debug', 'models'], options);
  if (!res.ok) return res;

  try {
    const parsed = JSON.parse(res.stdout);
    const models = parseCodexModels(parsed);
    cliCache.set('codex', { models, timestamp: Date.now() });
    return { ok: true, models };
  } catch (err: any) {
    return { ok: false, error: `Salida de Codex no es JSON válido: ${err?.message}` };
  }
}

export async function fetchAgyModels(
  options: {
    resolveExecutable?: ResolveExecutableFunction;
    spawnFn?: SpawnFunction;
    timeoutMs?: number;
    bypassCache?: boolean;
  } = {},
): Promise<{ ok: true; models: AiToolModel[] } | { ok: false; error: string }> {
  const cached = cliCache.get('antigravity');
  if (!options.bypassCache && cached && Date.now() - cached.timestamp < CLI_CACHE_TTL_MS) {
    return { ok: true, models: cached.models };
  }

  const res = await runCliCatalog('agy', ['models'], options);
  if (!res.ok) return res;

  const models = parseAgyModels(res.stdout);
  cliCache.set('antigravity', { models, timestamp: Date.now() });
  return { ok: true, models };
}

/**
 * Arma la lista completa de proveedores y modelos disponibles para un uso dado,
 * más la elección actual.
 */
export async function getToolModelsForUse(options: {
  use: AiUse;
  repoPath?: string | null;
  configPath?: string;
  loaded?: LoadedGitCronConfig;
  /** Variables guardadas en GitCron (D5), para `{env:}` en claves y direcciones. */
  stored?: (name: string) => string | undefined;
  resolveExecutable?: ResolveExecutableFunction;
  spawnFn?: SpawnFunction;
}): Promise<AiUseModelsResult> {
  const loaded = options.loaded ?? loadGitCronConfig({ globalPath: options.configPath, repoPath: options.repoPath });
  const providers: AiToolProvider[] = [];

  // Codex y Antigravity se consultan a la vez: cada catálogo tarda segundos.
  const [codexRes, agyRes] = await Promise.all([fetchCodexModels(options), fetchAgyModels(options)]);

  // 1. Codex
  providers.push({
    id: 'codex',
    name: 'Codex',
    kind: 'cli',
    available: codexRes.ok,
    unavailableReason: codexRes.ok ? undefined : codexRes.error,
    models: codexRes.ok ? codexRes.models : [],
    agentRuntime: 'codex',
    toolsExecutor: 'Codex',
  });

  // 2. Antigravity
  providers.push({
    id: 'antigravity',
    name: 'Antigravity',
    kind: 'cli',
    available: agyRes.ok,
    unavailableReason: agyRes.ok ? undefined : agyRes.error,
    models: agyRes.ok ? agyRes.models : [],
    agentRuntime: 'agy',
    toolsExecutor: 'Antigravity',
  });

  // 3. Claude Code
  let claudeAvailable = true;
  let claudeError: string | undefined;
  const resolve = options.resolveExecutable ?? defaultResolveExecutable ?? resolveRuntimeExecutable;
  try {
    await resolve('claude', process.env);
  } catch (err: any) {
    claudeAvailable = false;
    claudeError = err?.message ?? String(err);
  }
  providers.push({
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'cli',
    available: claudeAvailable,
    unavailableReason: claudeError,
    models: getClaudeCodeModels(),
    agentRuntime: 'claude',
    toolsExecutor: 'Claude Code',
  });

  // 4. Proveedores declarados en gitcron.json
  const configProviders = loaded.config?.provider ?? {};
  for (const [providerId, rawProvider] of Object.entries(configProviders)) {
    if (!rawProvider || typeof rawProvider !== 'object') continue;
    if (RESERVED_CLI_IDS.includes(providerId as any)) continue;
    const providerConfig = rawProvider as GitCronProviderConfig;
    const kind = providerConfig.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai-compatible';
    const providerName = providerConfig.name || providerId;

    // Obtener modelos declarados y reportados
    const declaredModels = providerConfig.models ?? {};
    const modelEntries: AiToolModel[] = [];

    for (const [modelId, modelDef] of Object.entries(declaredModels)) {
      const activeVariants: string[] = [];
      if (modelDef?.variants && typeof modelDef.variants === 'object') {
        for (const [vName, vVal] of Object.entries(modelDef.variants)) {
          if ((vVal as any)?.disabled !== true) {
            activeVariants.push(vName);
          }
        }
      }

      modelEntries.push({
        id: modelId,
        name: typeof modelDef?.name === 'string' ? modelDef.name : modelId,
        variants: activeVariants.length > 0 ? activeVariants : undefined,
        supportedLevels:
          kind === 'openai-compatible' && activeVariants.length === 0
            ? [...STANDARD_OPENAI_EFFORT_LEVELS]
            : undefined,
      });
    }

    // Además listamos los reportados si es posible
    try {
      const listed = await listProviderModels(providerId, {
        configPath: options.configPath,
        repoPath: options.repoPath,
        loaded,
        stored: options.stored,
      });
      if (listed.status === 'ok') {
        for (const m of listed.models) {
          if (!modelEntries.some((existing) => existing.id === m.id)) {
            modelEntries.push({
              id: m.id,
              name: m.name ?? m.id,
              supportedLevels: kind === 'openai-compatible' ? [...STANDARD_OPENAI_EFFORT_LEVELS] : undefined,
            });
          }
        }
      }
    } catch {
      // Ignorar fallos de red al listar modelos
    }

    providers.push({
      id: providerId,
      name: providerName,
      kind,
      available: true,
      models: modelEntries,
      agentRuntime: 'opencode',
      toolsExecutor: 'OpenCode',
    });
  }

  // 5. Elección actual del uso
  let current: AiUseModelsResult['current'] = null;
  try {
    if (options.use === 'gitcron-sdd') {
      const agentRes = resolveAgentFor({
        configPath: options.configPath,
        repoPath: options.repoPath,
        loaded,
        stored: options.stored,
      });
      if (agentRes.status === 'resolved') {
        current = {
          providerId: agentRes.providerId,
          modelId: agentRes.modelId,
          fullModelRef: agentRes.modelRef,
          effort: agentRes.effort,
          sourceFile: agentRes.sourceFile,
          scope: loaded.files.find((f) => f.scope === 'repo')?.path === agentRes.sourceFile ? 'repo' : 'global',
        };
      }
    } else {
      const resolvedTarget = resolveModelFor(options.use, {
        configPath: options.configPath,
        repoPath: options.repoPath,
        loaded,
        stored: options.stored,
      });
      if (resolvedTarget.status === 'resolved') {
        const { resolved } = resolvedTarget;
        current = {
          providerId: resolved.providerId,
          modelId: resolved.modelId,
          fullModelRef: `${resolved.providerId}/${resolved.modelId}`,
          effort:
            typeof resolved.options?.reasoning_effort === 'string'
              ? resolved.options.reasoning_effort
              : undefined,
          variant: resolved.variant,
          sourceFile: resolved.sourceFile,
          scope: resolved.provenance.repoFile ? 'repo' : 'global',
        };
      }
    }
  } catch {
    // Si no se puede resolver, queda current en null
  }

  return {
    use: options.use,
    providers,
    current,
  };
}
