// electron/pipeline/runtime-adapters/opencode-normalizer.ts
//
// Normalizador de eventos de `opencode run --format json` (tarea 5.3, D7, D8, D18).
// Procesa líneas JSONL con eventos:
// - `step_start`: inicio de paso / sesión
// - `text`: texto generado por el modelo (`agent.message`)
// - `tool_use`: herramienta con su estado (`tool.started`, `tool.completed`)
// - `step_finish`: tokens y costo acumulados a lo largo de los pasos (D18)
// - Eventos desconocidos: se contabilizan sin interrumpir la ejecución.

import type { PipelineEventEnvelope, PipelineIdentity, RuntimeTelemetrySnapshot } from '../../../types/pipeline';
import {
  asRecord,
  envelope,
  metricSample,
  numberValue,
  sourceIdValue,
  stringValue,
  unknownTelemetry,
  type EventNormalizationContext,
} from './normalization';
import type { RuntimeStreamNormalizer } from './stream-normalizer';

export class OpencodeStreamNormalizer implements RuntimeStreamNormalizer {
  private sessionStarted = false;
  private unknownEventCount = 0;
  private hasTokens = false;
  private inputTokens = 0;
  private outputTokens = 0;
  private reasoningTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private costUsd = 0;
  private readonly startedTools = new Set<string>();
  private readonly completedTools = new Set<string>();

  normalize(recordValue: unknown, context: EventNormalizationContext): PipelineEventEnvelope[] {
    const record = asRecord(recordValue);
    if (!record) {
      return [envelope(context, 'runtime.schema.degraded', { reason: 'record_not_object' }, 'unknown')];
    }

    const type = stringValue(record.type);
    const sessionId = stringValue(record.sessionID);
    if (sessionId) {
      context.identity.sessionId = sessionId;
    }

    const part = asRecord(record.part);
    const partId = sourceIdValue(part?.id) ?? sourceIdValue(part?.partID);
    const sourceEventId = partId ? `${partId}:${type ?? 'unknown'}` : sourceIdValue(record.sessionID);
    const scopedContext: EventNormalizationContext = { ...context, sourceEventId };

    if (type === 'step_start') {
      const events: PipelineEventEnvelope[] = [];
      if (!this.sessionStarted) {
        this.sessionStarted = true;
        events.push(
          envelope(scopedContext, 'session.started', {
            reportedModel: context.identity.reportedModel,
            runtimeVersion: '2.0.20',
          }),
        );
      }
      return events;
    }

    if (type === 'text') {
      const text = stringValue(part?.text);
      if (text !== null) {
        return [envelope(scopedContext, 'agent.message', { text })];
      }
      return [];
    }

    if (type === 'tool_use') {
      const toolName = stringValue(part?.tool) ?? 'tool';
      const toolUseId = sourceIdValue(part?.id) ?? sourceIdValue(part?.partID) ?? `${context.instanceId}:tool:${context.sequence}`;
      const state = asRecord(part?.state);
      const status = stringValue(state?.status) ?? 'completed';

      const events: PipelineEventEnvelope[] = [];
      if (!this.startedTools.has(toolUseId)) {
        this.startedTools.add(toolUseId);
        events.push(envelope(scopedContext, 'tool.started', { toolUseId, name: toolName, input: state?.input }));
      }

      if (status === 'completed' && !this.completedTools.has(toolUseId)) {
        this.completedTools.add(toolUseId);
        events.push(
          envelope(scopedContext, 'tool.completed', {
            toolUseId,
            name: toolName,
            status,
            output: state?.output,
          }),
        );
      }
      return events;
    }

    if (type === 'step_finish') {
      const tokens = asRecord(part?.tokens);
      const cache = asRecord(tokens?.cache);
      const cost = numberValue(part?.cost) ?? 0;

      this.hasTokens = true;
      this.inputTokens += numberValue(tokens?.input) ?? 0;
      this.outputTokens += numberValue(tokens?.output) ?? 0;
      this.reasoningTokens += numberValue(tokens?.reasoning) ?? 0;
      this.cacheReadTokens += numberValue(cache?.read) ?? 0;
      this.cacheWriteTokens += numberValue(cache?.write) ?? 0;
      this.costUsd += cost;

      return [];
    }

    // Tipo de evento desconocido: se cuenta y no corta la corrida (D8, Tanda 20 Decision 7)
    this.unknownEventCount++;
    return [
      envelope(
        scopedContext,
        'runtime.schema.degraded',
        { sourceType: type, unknownCount: this.unknownEventCount },
        'unknown',
      ),
    ];
  }

  getUnknownEventCount(): number {
    return this.unknownEventCount;
  }

  telemetry(identity: PipelineIdentity): RuntimeTelemetrySnapshot {
    if (!this.hasTokens) {
      return unknownTelemetry(identity, 'opencode:process.completed');
    }

    const snapshot = unknownTelemetry(identity, 'opencode:step_finish');
    const reported = (name: Parameters<typeof metricSample>[1], value: number | null) =>
      metricSample(
        identity,
        name,
        'tokens',
        'tokens',
        value,
        value === null ? 'unknown' : 'runtime_reported',
        value === null ? 'unknown' : 'verified',
        'opencode:step_finish',
      );

    snapshot.usage.inputTokens = reported('tokens.input', this.inputTokens);
    snapshot.usage.outputTokens = reported('tokens.output', this.outputTokens);
    snapshot.usage.cacheReadTokens = reported('tokens.cache_read', this.cacheReadTokens);
    snapshot.usage.reasoningTokens = reported('tokens.reasoning', this.reasoningTokens);
    snapshot.cost.usd = metricSample(
      identity,
      'cost.usd',
      'cost',
      'USD',
      this.costUsd,
      'runtime_reported',
      'verified',
      'opencode:step_finish',
    );
    snapshot.cost.billingStatus = 'reported';
    snapshot.reasoningVisibility = this.reasoningTokens > 0 ? 'emitted' : 'unavailable';
    return snapshot;
  }
}
