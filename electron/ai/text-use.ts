// electron/ai/text-use.ts
//
// Un pedido de texto para un uso de GitCron (tarea 4.3): toma lo que resolvió
// `resolveModelFor` y lo corre con la familia que corresponda —servidor del estándar
// de OpenAI, API de Anthropic o CLI de suscripción—. Ningún uso arma su propio
// proveedor; todos pasan por acá.
//
// Si el proveedor falla, el error dice el motivo y, si hay, qué otro proveedor
// declara los mismos modelos (D7). Nunca se llama a ese otro sin que la persona lo elija.

import type { DraftChunk, DraftUsage } from '../../types/commit-message-ai';
import { completeAnthropic } from './anthropic-client';
import { cliExecutable, runCliText, type CliTextId, type KillTreeFunction, type ResolveExecutableFunction, type SpawnFunction } from './cli-text-client';
import type { ResolvedUse } from './config/gitcron-config';
import { resolveRuntimeExecutable } from '../pipeline/runtime-adapters/process-runner';
import { TEXT_USE_LABEL, type ModelAlternative, type ResolvedModelFor, type TextUse } from './config/resolve-model-for';
import { completeText, streamText } from './text-client';

export type TextUseErrorReason =
  | 'unset'
  | 'disabled'
  | 'unavailable'
  | 'no-session'
  | 'not-installed'
  | 'timeout'
  | 'cancelled'
  | 'failed';

export class TextUseError extends Error {
  constructor(
    message: string,
    readonly reason: TextUseErrorReason,
    readonly use: TextUse,
    readonly alternatives: ModelAlternative[] = [],
  ) {
    super(message);
    this.name = 'TextUseError';
  }
}

export interface TextUseRequest {
  system: string;
  user: string;
  /** Lo que el uso pide si el modelo no declara `limit.output`. */
  maxTokens?: number;
  /** La temperatura del uso si el archivo no trae una. */
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Con esto, la respuesta llega de a pedazos donde la familia lo permite. */
  onChunk?: (chunks: DraftChunk[]) => void;
}

export interface TextUseResult {
  text: string;
  finishReason: string | null;
  usage: DraftUsage | null;
  /** «Proveedor · modelo», para mostrar y guardar con lo generado. */
  label: string;
  providerId: string;
  modelId: string;
}

export interface TextUseDeps {
  fetchFn?: typeof fetch;
  spawnFn?: SpawnFunction;
  resolveExecutable?: ResolveExecutableFunction;
  killTree?: KillTreeFunction;
}

export function modelLabel(resolved: Pick<ResolvedUse, 'providerName' | 'modelId'>): string {
  return `${resolved.providerName} · ${resolved.modelId}`;
}

/** El uso listo para pedirle texto, o el error que lo explica. */
export function requireResolved(target: ResolvedModelFor): { resolved: ResolvedUse; alternatives: ModelAlternative[] } {
  const label = TEXT_USE_LABEL[target.use];
  if (target.status === 'unset') {
    throw new TextUseError(
      `${label} no tiene modelo en gitcron.json (ni agent.${target.use}.model ni la elección general «model»).`,
      'unset',
      target.use,
    );
  }
  if (target.status === 'disabled') {
    throw new TextUseError(`${label} está desactivado en gitcron.json (agent.${target.use}.disable).`, 'disabled', target.use);
  }
  if (!target.resolved.available) {
    throw new TextUseError(
      `${modelLabel(target.resolved)}: ${target.resolved.unavailableReason ?? 'proveedor no disponible'}.`,
      'unavailable',
      target.use,
      target.alternatives,
    );
  }
  return { resolved: target.resolved, alternatives: target.alternatives };
}

/** Agrega al motivo del fallo qué otro proveedor declara los mismos modelos (D7). */
export function withSameModels(message: string, alternatives: ModelAlternative[]): string {
  if (alternatives.length === 0) return message;
  const names = alternatives.map((a) => `«${a.providerName}»`).join(', ');
  return `${message} ${names} declara${alternatives.length > 1 ? 'n' : ''} los mismos modelos: se puede elegir en gitcron.json.`;
}

export async function runTextUse(target: ResolvedModelFor, req: TextUseRequest, deps: TextUseDeps = {}): Promise<TextUseResult> {
  const { resolved, alternatives } = requireResolved(target);
  const base = { label: modelLabel(resolved), providerId: resolved.providerId, modelId: resolved.modelId };
  const maxTokens = resolved.maxTokensFromModel ? resolved.maxTokens : (req.maxTokens ?? resolved.maxTokens);
  const temperature = resolved.temperature ?? req.temperature;

  if (resolved.kind === 'cli') {
    const result = await runCliText({
      cli: resolved.providerId as CliTextId,
      model: resolved.modelId,
      prompt: `${req.system}\n\n${req.user}`,
      signal: req.signal,
      timeoutMs: req.timeoutMs,
      onChunk: req.onChunk,
      spawnFn: deps.spawnFn,
      resolveExecutable: deps.resolveExecutable,
      killTree: deps.killTree,
    });
    if (result.status === 'failed') {
      const reason: TextUseErrorReason = result.reason === 'invalid-model' || result.reason === 'error' ? 'failed' : result.reason;
      throw new TextUseError(`${resolved.providerName}: ${result.detail}`, reason, target.use);
    }
    return { ...base, text: result.text.trim(), finishReason: null, usage: result.usage };
  }

  try {
    if (resolved.kind === 'anthropic') {
      const result = await completeAnthropic({
        baseURL: resolved.baseURL!,
        apiKey: resolved.apiKey,
        headers: resolved.headers,
        providerLabel: resolved.providerName,
        model: resolved.modelId,
        system: req.system,
        user: req.user,
        maxTokens: maxTokens ?? 3000,
        temperature,
        options: resolved.options,
        timeoutMs: req.timeoutMs,
        signal: req.signal,
        fetchFn: deps.fetchFn,
      });
      if (result.text) req.onChunk?.([{ kind: 'content', text: result.text }]);
      return { ...base, text: result.text, finishReason: result.finishReason, usage: result.usage };
    }

    const config = {
      baseUrl: resolved.baseURL!,
      apiKey: resolved.apiKey,
      headers: resolved.headers,
      providerLabel: resolved.providerName,
      friendlyConnError: `${resolved.providerName} no responde en ${resolved.baseURL}.`,
      fetchFn: deps.fetchFn,
    };
    const opts = {
      model: resolved.modelId,
      system: req.system,
      user: req.user,
      temperature,
      maxTokens,
      options: resolved.options,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
    };
    let usage: DraftUsage | null = null;
    const result = req.onChunk
      ? await streamText(config, {
          ...opts,
          onChunk: (chunks) => {
            for (const c of chunks) if (c.kind === 'done' && c.usage) usage = c.usage;
            req.onChunk?.(chunks);
          },
        })
      : await completeText(config, opts);
    return { ...base, text: result.text, finishReason: result.finishReason ?? null, usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason: TextUseErrorReason = /cancelad/i.test(message) ? 'cancelled' : /tardó demasiado/i.test(message) ? 'timeout' : 'failed';
    throw new TextUseError(reason === 'failed' ? withSameModels(message, alternatives) : message, reason, target.use, alternatives);
  }
}

/**
 * Comprobar que el uso se puede usar sin gastar una generación: el CLI instalado,
 * o que el servidor conteste su lista de modelos del estándar. Lanza con el motivo
 * y, si el servidor no responde, con los que declaran los mismos modelos (D7).
 */
export async function probeTextUse(target: ResolvedModelFor, deps: TextUseDeps = {}): Promise<void> {
  const { resolved, alternatives } = requireResolved(target);
  if (resolved.kind === 'cli') {
    const cli = resolved.providerId as CliTextId;
    try {
      await (deps.resolveExecutable ?? resolveRuntimeExecutable)(cliExecutable(cli), process.env);
    } catch {
      throw new TextUseError(`${resolved.providerName} no está instalado o no está en el PATH.`, 'not-installed', target.use);
    }
    return;
  }
  // Anthropic no tiene una lista barata sin gastar: alcanza con la clave, que
  // `requireResolved` ya comprobó.
  if (resolved.kind === 'anthropic') return;
  const url = `${resolved.baseURL!.replace(/\/+$/, '')}/models`;
  let res: Response;
  try {
    res = await (deps.fetchFn ?? fetch)(url, {
      method: 'GET',
      headers: {
        ...(resolved.headers ?? {}),
        ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TextUseError(
      withSameModels(`${resolved.providerName} no responde en ${resolved.baseURL}.`, alternatives),
      'failed',
      target.use,
      alternatives,
    );
  }
  if (!res.ok) throw new TextUseError(`${resolved.providerName} respondió ${res.status}.`, 'failed', target.use, alternatives);
}
