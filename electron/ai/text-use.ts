// electron/ai/text-use.ts
//
// Un pedido de texto para un uso de GitCron (tarea 4.3): toma lo que resolvió
// `resolveModelFor` y lo corre con la familia que corresponda —servidor del estándar
// de OpenAI, API de Anthropic o CLI de suscripción—. Ningún uso arma su propio
// proveedor; todos pasan por acá.
//
// Si el proveedor falla, el error dice el motivo y, si hay, qué otro proveedor
// declara los mismos modelos (D7). Nunca se llama a ese otro sin que la persona lo elija.

import type { CommitAiLastRequest, DraftChunk, DraftUsage, HeaderProvenance, ParameterProvenance } from '../../types/commit-message-ai';
import { anthropicMessagesEndpoint, buildAnthropicBody, completeAnthropic } from './anthropic-client';
import { cliExecutable, describeCliTextCommand, runCliText, type CliTextId, type KillTreeFunction, type ResolveExecutableFunction, type SpawnFunction } from './cli-text-client';
import type { ResolvedUse } from './config/gitcron-config';
import { resolveRuntimeExecutable } from '../pipeline/runtime-adapters/process-runner';
import { TEXT_USE_LABEL, type ModelAlternative, type ResolvedModelFor, type TextUse } from './config/resolve-model-for';
import { buildChatCompletionsEndpoint, buildCompleteRequestBody, buildStreamRequestBody, completeText, streamText } from './text-client';
import { recordAiUse } from '../db/ai-use-history';

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
  /** El repositorio del uso (si es una pestaña abierta, se registra el historial D19). */
  repoPath?: string | null;
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

/** El archivo del repositorio, si de ahí sale el valor con esa clave de procedencia (D2). */
function repoFileFor(resolved: ResolvedUse, key: string): { file?: string } {
  const { repoFile, fromRepo } = resolved.provenance;
  return repoFile && fromRepo?.includes(key) ? { file: repoFile } : {};
}

/**
 * Pedido efectivo guardado en memoria por uso (D14).
 * Nunca contiene claves, valores de cabeceras secretas ni el prompt.
 */
const lastRequestsByUse = new Map<TextUse, CommitAiLastRequest>();

export function getLastRequestForUse(use: TextUse): CommitAiLastRequest | null {
  return lastRequestsByUse.get(use) ?? null;
}

export function setLastRequestForUse(use: TextUse, req: CommitAiLastRequest | null): void {
  if (req) {
    lastRequestsByUse.set(use, req);
  } else {
    lastRequestsByUse.delete(use);
  }
}

export function clearLastRequestsForTesting(): void {
  lastRequestsByUse.clear();
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
  const effectiveTimeoutMs = req.timeoutMs ?? (typeof resolved.options?.timeout === 'number' ? resolved.options.timeout : undefined) ?? resolved.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  const saveHistory = (
    resultStatus: 'generated' | 'failed' | 'cancelled',
    resultText: string | null,
    usage: DraftUsage | null,
  ) => {
    if (!req.repoPath) return;
    const finishedAt = Date.now();
    const effectiveReq = getLastRequestForUse(target.use);
    if (!effectiveReq) return;
    recordAiUse({
      repoPath: req.repoPath,
      use: target.use,
      startedAt,
      endedAt: finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      family: resolved.kind,
      providerId: resolved.providerId,
      providerName: resolved.providerName,
      modelId: resolved.modelId,
      reasoningEffort: typeof resolved.options?.reasoning_effort === 'string' ? resolved.options.reasoning_effort : null,
      variant: resolved.variant ?? null,
      effectiveRequest: effectiveReq,
      promptSent: `${req.system}\n\n${req.user}`,
      resultStatus,
      resultText,
      usage,
    });
  };

  const modelProvenance = {
    value: resolved.modelId,
    provenance: resolved.provenance.model,
    ...repoFileFor(resolved, 'model'),
  };

  if (resolved.kind === 'cli') {
    const cli = resolved.providerId as CliTextId;
    const cliParams: Record<string, ParameterProvenance> = {};
    if (temperature !== undefined) {
      cliParams.temperature = {
        value: temperature,
        provenance: resolved.provenance.temperature ?? `agent.${target.use}.temperature`,
        ...repoFileFor(resolved, 'temperature'),
      };
    }
    for (const [k, v] of Object.entries(resolved.options ?? {})) {
      cliParams[k] = {
        value: v,
        provenance: resolved.provenance.options[k] ?? `agent.${target.use}.options.${k}`,
        ...repoFileFor(resolved, `options.${k}`),
      };
    }
    const effort = typeof resolved.options?.reasoning_effort === 'string'
      ? resolved.options.reasoning_effort
      : undefined;
    const effectiveReq: CommitAiLastRequest = {
      kind: 'cli',
      endpoint: describeCliTextCommand(cli, resolved.modelId, effort),
      model: modelProvenance,
      parameters: cliParams,
      headers: [],
      timestamp: Date.now(),
    };
    setLastRequestForUse(target.use, effectiveReq);

    let result;
    try {
      result = await runCliText({
        cli,
        model: resolved.modelId,
        effort,
        prompt: `${req.system}\n\n${req.user}`,
        signal: req.signal,
        timeoutMs: effectiveTimeoutMs,
        onChunk: req.onChunk,
        spawnFn: deps.spawnFn,
        resolveExecutable: deps.resolveExecutable,
        killTree: deps.killTree,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isCancelled = req.signal?.aborted || /cancelad/i.test(message);
      saveHistory(isCancelled ? 'cancelled' : 'failed', message, null);
      throw error;
    }

    if (result.status === 'failed') {
      const isCancelled = result.reason === 'cancelled' || req.signal?.aborted;
      saveHistory(isCancelled ? 'cancelled' : 'failed', result.detail, null);
      const reason: TextUseErrorReason = result.reason === 'invalid-model' || result.reason === 'error' ? 'failed' : result.reason;
      throw new TextUseError(`${resolved.providerName}: ${result.detail}`, reason, target.use);
    }
    saveHistory('generated', result.text.trim(), result.usage);
    return { ...base, text: result.text.trim(), finishReason: null, usage: result.usage };
  }

  try {
    if (resolved.kind === 'anthropic') {
      const effectiveMaxTokens = maxTokens ?? 3000;
      const anthropicRequest = {
        baseURL: resolved.baseURL!,
        apiKey: resolved.apiKey,
        headers: resolved.headers,
        providerLabel: resolved.providerName,
        model: resolved.modelId,
        system: req.system,
        user: req.user,
        maxTokens: effectiveMaxTokens,
        temperature,
        options: resolved.options,
        timeoutMs: effectiveTimeoutMs,
        signal: req.signal,
        fetchFn: deps.fetchFn,
      };
      const sentBody = buildAnthropicBody(anthropicRequest);
      const anthropicParams: Record<string, ParameterProvenance> = {};
      for (const [key, value] of Object.entries(sentBody)) {
        if (key === 'model' || key === 'messages' || key === 'system') continue;
        const fromOptions = key in (resolved.options ?? {});
        anthropicParams[key] = {
          value,
          provenance: fromOptions
            ? (resolved.provenance.options[key] ?? `options.${key}`)
            : key === 'temperature'
              ? (resolved.provenance.temperature ?? 'valor por omisión de GitCron')
              : (resolved.provenance.max_tokens ?? `valor por omisión de GitCron (${effectiveMaxTokens})`),
          ...repoFileFor(resolved, fromOptions ? `options.${key}` : key),
        };
      }
      const effectiveReq: CommitAiLastRequest = {
        kind: 'anthropic',
        endpoint: anthropicMessagesEndpoint(resolved.baseURL!),
        model: modelProvenance,
        parameters: anthropicParams,
        headers: Object.keys(resolved.headers ?? {}).map((name) => ({
          name,
          provenance: resolved.provenance.headers[name] ?? `provider.${resolved.providerId}.options.headers.${name}`,
          ...repoFileFor(resolved, `headers.${name}`),
        })),
        auth: resolved.provenance.auth,
        timestamp: Date.now(),
      };
      setLastRequestForUse(target.use, effectiveReq);

      const result = await completeAnthropic(anthropicRequest);
      if (result.text) req.onChunk?.([{ kind: 'content', text: result.text }]);
      saveHistory('generated', result.text, result.usage);
      return { ...base, text: result.text, finishReason: result.finishReason, usage: result.usage };
    }

    const effectiveMaxTokens = maxTokens;
    const sentBody = req.onChunk
      ? buildStreamRequestBody({
          model: resolved.modelId,
          system: req.system,
          user: req.user,
          temperature,
          maxTokens: effectiveMaxTokens,
          options: resolved.options,
        })
      : buildCompleteRequestBody({
          model: resolved.modelId,
          system: req.system,
          user: req.user,
          temperature,
          maxTokens: effectiveMaxTokens,
          options: resolved.options,
        });

    const provenanceOf = (key: string): string => {
      if (key in (resolved.options ?? {})) return resolved.provenance.options[key] ?? `options.${key}`;
      if (key === 'temperature') return resolved.provenance.temperature ?? 'valor por omisión de GitCron';
      if (key === 'max_tokens') return resolved.provenance.max_tokens ?? (effectiveMaxTokens !== undefined ? `valor por omisión de GitCron (${effectiveMaxTokens})` : 'valor por omisión de GitCron');
      return 'parámetro de GitCron';
    };
    const openAiParams: Record<string, ParameterProvenance> = {};
    for (const [key, value] of Object.entries(sentBody)) {
      if (key === 'model' || key === 'messages') continue;
      const originKey = key in (resolved.options ?? {}) ? `options.${key}` : key;
      openAiParams[key] = { value, provenance: provenanceOf(key), ...repoFileFor(resolved, originKey) };
    }
    const headerList: HeaderProvenance[] = Object.keys(resolved.headers ?? {}).map((name) => ({
      name,
      provenance: resolved.provenance.headers[name] ?? `provider.${resolved.providerId}.options.headers.${name}`,
      ...repoFileFor(resolved, `headers.${name}`),
    }));

    const effectiveReq: CommitAiLastRequest = {
      kind: 'openai-compatible',
      endpoint: buildChatCompletionsEndpoint(resolved.baseURL!),
      model: modelProvenance,
      parameters: openAiParams,
      headers: headerList,
      auth: resolved.provenance.auth,
      timestamp: Date.now(),
    };
    setLastRequestForUse(target.use, effectiveReq);

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
      maxTokens: effectiveMaxTokens,
      options: resolved.options,
      timeoutMs: effectiveTimeoutMs,
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
    if (!usage && result.rawPayload && typeof result.rawPayload === 'object' && (result.rawPayload as any).usage) {
      const u = (result.rawPayload as any).usage;
      const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null);
      const promptTokens = int(u.prompt_tokens);
      const completionTokens = int(u.completion_tokens);
      const cachedPromptTokens = int(u.prompt_tokens_details?.cached_tokens);
      const reasoningTokens = int(u.completion_tokens_details?.reasoning_tokens);
      if (promptTokens !== null || completionTokens !== null) {
        usage = { promptTokens, cachedPromptTokens, completionTokens, reasoningTokens };
      }
    }
    saveHistory('generated', result.text, usage);
    return { ...base, text: result.text, finishReason: result.finishReason ?? null, usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason: TextUseErrorReason = /cancelad/i.test(message) ? 'cancelled' : /tardó demasiado/i.test(message) ? 'timeout' : 'failed';
    saveHistory(reason === 'cancelled' ? 'cancelled' : 'failed', message, null);
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
