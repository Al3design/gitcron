// electron/ai/config/resolve-agent-for.ts
//
// `resolveAgentFor(options)` (tarea 5.1, D1, D7, D13, D17): resolución del modelo y
// motor para el agente de SDD (`gitcron-sdd`).
//
// El motor sale del modelo:
// - `claude-code/<m>` -> `claude` (Claude Code)
// - `codex/<m>` -> `codex` (Codex)
// - `antigravity/<m>` -> `agy` (Antigravity)
// - Un modelo de un proveedor de gitcron.json -> `opencode` (OpenCode)
//
// Sin direcciones ni secretos en lo que vuelve.

import path from 'node:path';
import type { PipelineRuntime } from '../../../types/pipeline';
import { isValidCliEffort } from '../cli-text-client';
import {
  loadGitCronConfig,
  resolveUse,
  type LoadedGitCronConfig,
  type ProviderDestination,
  type ResolveUseOptions,
} from './gitcron-config';
import { findOpenCodeModel, resolveOpenCodeVariant, type OpenCodeKnownModel } from './opencode-models';

export interface ResolveAgentForOptions extends ResolveUseOptions {
  configPath?: string;
  repoPath?: string | null;
  loaded?: LoadedGitCronConfig;
  stored?: (name: string) => string | undefined;
  env?: NodeJS.ProcessEnv;
  opencodeModels?: OpenCodeKnownModel[];
}

export type ResolvedAgentFor =
  | {
      status: 'resolved';
      use: 'gitcron-sdd';
      modelRef: string;
      providerId: string;
      providerName: string;
      modelId: string;
      effort?: string;
      variant?: string;
      runtime: PipelineRuntime;
      toolsExecutor: string;
      destination: ProviderDestination;
      sourceFile: string;
      sourceDir?: string;
      modelSource: 'agent' | 'general';
      isException: boolean;
      available: boolean;
      unavailableReason?: string;
      opencodeKnown?: boolean;
      contextLimit?: number | null;
      /**
       * Lo que se va a lanzar (modelo y nivel/variante), como una clave opaca. La pantalla la
       * devuelve al arrancar: si el archivo cambió entre que se mostró y se apretó
       * «Iniciar», no coincide y no se lanza nada.
       */
      launchKey: string;
    }
  | {
      status: 'disabled';
      use: 'gitcron-sdd';
      sourceFile?: string;
      sourceDir?: string;
    }
  | {
      status: 'unset';
      use: 'gitcron-sdd';
    };

export function resolveAgentFor(options: ResolveAgentForOptions = {}): ResolvedAgentFor {
  const loaded = options.loaded ?? loadGitCronConfig({ globalPath: options.configPath, repoPath: options.repoPath });
  const entry = loaded.config?.agent?.['gitcron-sdd'];
  if (entry?.disable === true) {
    const sourceFile = loaded.originOf(['agent', 'gitcron-sdd', 'disable']);
    return {
      status: 'disabled',
      use: 'gitcron-sdd',
      sourceFile,
      sourceDir: sourceFile ? path.dirname(sourceFile) : undefined,
    };
  }

  const resolved = resolveUse('gitcron-sdd', {
    ...options,
    loaded,
  });

  if (!resolved) {
    return { status: 'unset', use: 'gitcron-sdd' };
  }

  const { providerId, providerName, destination, available, unavailableReason } = resolved;
  const rawModel = resolved.modelId;
  let cleanModelId = rawModel;
  let explicitVariant = resolved.variant?.trim() || undefined;
  if (rawModel.includes('#')) {
    const [m, v] = rawModel.split('#');
    cleanModelId = m;
    if (!explicitVariant && v) {
      explicitVariant = v.trim();
    }
  }
  const modelId = cleanModelId;
  const modelRef = `${providerId}/${modelId}`;

  let runtime: PipelineRuntime;
  let toolsExecutor: string;

  if (providerId === 'claude-code') {
    runtime = 'claude';
    toolsExecutor = 'Claude Code';
  } else if (providerId === 'codex') {
    runtime = 'codex';
    toolsExecutor = 'Codex';
  } else if (providerId === 'antigravity') {
    runtime = 'agy';
    toolsExecutor = 'Antigravity';
  } else {
    runtime = 'opencode';
    toolsExecutor = 'OpenCode';
  }

  let effort: string | undefined;
  const rawEffort = typeof resolved.options?.reasoning_effort === 'string'
    ? resolved.options.reasoning_effort.trim()
    : undefined;

  if (runtime === 'claude') {
    if (rawEffort && isValidCliEffort('claude-code', rawEffort)) {
      effort = rawEffort;
    }
  } else if (runtime === 'codex') {
    if (rawEffort && isValidCliEffort('codex', rawEffort)) {
      effort = rawEffort;
    }
  } else if (runtime === 'agy') {
    if (rawEffort && isValidCliEffort('antigravity', rawEffort)) {
      effort = rawEffort;
    }
  } else {
    effort = rawEffort;
  }

  let variant: string | undefined;
  let opencodeKnown: boolean | undefined;
  let contextLimit: number | null | undefined;

  if (runtime === 'opencode') {
    if (options.opencodeModels) {
      const known = findOpenCodeModel(options.opencodeModels, providerId, modelId);
      opencodeKnown = Boolean(known);
      contextLimit = known?.contextLimit ?? null;
      const v = resolveOpenCodeVariant({
        explicitVariant,
        effort: rawEffort,
        declaredVariants: known?.variantIds,
      });
      variant = v ?? undefined;
    } else {
      variant = explicitVariant || rawEffort;
    }
  }

  const modelSource = resolved.modelSource === 'general' ? 'general' : 'agent';
  const isException = modelSource === 'agent'
    && Boolean(loaded.config?.model && typeof loaded.config.model === 'string' && loaded.config.model.trim());

  const launchKey = runtime === 'opencode'
    ? JSON.stringify([modelRef, variant ?? null])
    : JSON.stringify([modelRef, effort ?? null]);

  return {
    status: 'resolved',
    use: 'gitcron-sdd',
    modelRef,
    providerId,
    providerName,
    modelId,
    effort,
    variant,
    runtime,
    toolsExecutor,
    destination,
    sourceFile: resolved.sourceFile,
    sourceDir: path.dirname(resolved.sourceFile),
    modelSource,
    isException,
    available,
    unavailableReason,
    opencodeKnown,
    contextLimit,
    launchKey,
  };
}
