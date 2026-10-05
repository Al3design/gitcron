// electron/pipeline/runtime-adapters/agy-normalizer.ts
//
// Normalizador de eventos de `agy -p <prompt> --output-format stream-json --mode accept-edits`
// (tarea 5.2, Decisión D9, Opción B).
//
// Formato de eventos medido en la tarea 1.1 (capturas saneadas agy-1.2.13-stream y agy-1.2.13-resume):
// - `init`: inicialización con `conversation_id`, `init.model`, `init.cwd`, `init.tools`, `init.permission_mode`.
// - `step_update`:
//    - `step_type: 'user_input'`: marca el inicio de la corrida (`run.started`).
//    - `step_type: 'agent_response'`: mensaje o fragmento (`agent.message`), con tokens por paso en `usage`.
//    - `step_type: 'tool'`: herramientas ejecutadas (`tool.started`, `tool.completed`).
// - `result`:
//    - `status: 'SUCCESS'` o `'ERROR'`.
//    - `usage`: tokens acumulados (`input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `total_tokens`).
//    - `denied_actions`: lista de acciones denegadas (p. ej. `[{ action: "command", display_name: "RunCommand" }]`).
//    - REGLA CRÍTICA D9: si `denied_actions` contiene un comando denegado, la corrida concluye con
//      `success: false` y el motivo de rechazo visible, aunque `result.status` sea `'SUCCESS'`.

import type {
  PipelineEventEnvelope,
  PipelineIdentity,
  RuntimeTelemetrySnapshot,
} from '../../../types/pipeline';
import {
  asRecord,
  envelope,
  metricSample,
  numberValue,
  stringValue,
  unknownTelemetry,
  type EventNormalizationContext,
} from './normalization';
import type { RuntimeStreamNormalizer } from './stream-normalizer';

export class AgyStreamNormalizer implements RuntimeStreamNormalizer {
  private runStarted = false;
  private unknownEventCount = 0;
  private usage: Record<string, unknown> | null = null;
  private lastDeniedCommand: string | null = null;
  private readonly startedTools = new Set<string>();
  private readonly completedTools = new Set<string>();

  normalize(recordValue: unknown, context: EventNormalizationContext): PipelineEventEnvelope[] {
    const record = asRecord(recordValue);
    if (!record) {
      return [envelope(context, 'runtime.schema.degraded', { reason: 'record_not_object' }, 'unknown')];
    }

    const eventName = stringValue(record.event);
    const conversationId = stringValue(record.conversation_id);
    if (conversationId) {
      context.identity.sessionId = conversationId;
    }

    const scopedContext: EventNormalizationContext = {
      ...context,
      sourceEventId: conversationId ? `${conversationId}:${eventName ?? 'unknown'}:${context.sequence}` : null,
    };

    if (eventName === 'init') {
      const init = asRecord(record.init);
      const reportedModel = stringValue(init?.model);
      if (reportedModel) {
        context.identity.reportedModel = reportedModel;
        context.identity.effectiveModel = reportedModel;
      }
      return [
        envelope(scopedContext, 'session.started', {
          runtimeVersion: '1.2.13',
          model: reportedModel,
          cwd: stringValue(init?.cwd),
          permissionMode: stringValue(init?.permission_mode),
        }),
      ];
    }

    if (eventName === 'step_update') {
      const step = asRecord(record.step_update);
      if (!step) return [];

      const stepConvId = stringValue(step.conversation_id);
      if (stepConvId) {
        context.identity.sessionId = stepConvId;
      }

      const stepType = stringValue(step.step_type);
      const state = stringValue(step.state);
      const stepIndex = step.step_index != null ? String(step.step_index) : String(context.sequence);
      const stepContext: EventNormalizationContext = {
        ...context,
        sourceEventId: `${stepConvId ?? context.instanceId}:${stepIndex}:${stepType ?? 'unknown'}`,
      };

      if (stepType === 'user_input') {
        if (!this.runStarted) {
          this.runStarted = true;
          return [envelope(stepContext, 'run.started', {})];
        }
        return [];
      }

      if (stepType === 'agent_response') {
        const events: PipelineEventEnvelope[] = [];
        if (!this.runStarted) {
          this.runStarted = true;
          events.push(envelope(stepContext, 'run.started', {}));
        }

        const textDelta = stringValue(step.text_delta);
        if (textDelta !== null && textDelta !== '') {
          events.push(envelope(stepContext, 'agent.message', { text: textDelta }));
        }

        if (step.usage) {
          this.usage = asRecord(step.usage);
        }

        return events;
      }

      if (stepType === 'tool') {
        const toolInfo = asRecord(step.tool_info);
        const toolName = stringValue(step.tool_name) ?? stringValue(toolInfo?.name) ?? 'tool';
        const toolUseId = `${context.instanceId}:step:${stepIndex}`;

        const events: PipelineEventEnvelope[] = [];
        if (!this.runStarted) {
          this.runStarted = true;
          events.push(envelope(stepContext, 'run.started', {}));
        }

        if (state === 'ACTIVE' && !this.startedTools.has(toolUseId)) {
          this.startedTools.add(toolUseId);
          events.push(
            envelope(stepContext, 'tool.started', {
              toolUseId,
              name: toolName,
              input: toolInfo?.parameters,
            }),
          );
        }

        if (state === 'DONE' && !this.completedTools.has(toolUseId)) {
          this.completedTools.add(toolUseId);
          events.push(
            envelope(stepContext, 'tool.completed', {
              toolUseId,
              name: toolName,
              status: 'completed',
              output: toolInfo?.output,
            }),
          );
        }

        if (state === 'ERROR' && !this.completedTools.has(toolUseId)) {
          this.completedTools.add(toolUseId);
          const errorObj = asRecord(toolInfo?.error);
          const errorMsg = stringValue(errorObj?.message) ?? stringValue(toolInfo?.error) ?? 'Tool execution error';
          if (toolName === 'run_command' || errorMsg.includes('permission check failed for command')) {
            this.lastDeniedCommand = errorMsg;
          }
          events.push(
            envelope(stepContext, 'tool.completed', {
              toolUseId,
              name: toolName,
              status: 'error',
              error: errorMsg,
            }),
          );
        }

        return events;
      }

      return [];
    }

    if (eventName === 'result') {
      const result = asRecord(record.result);
      if (!result) return [];

      const resultConvId = stringValue(result.conversation_id);
      if (resultConvId) {
        context.identity.sessionId = resultConvId;
      }

      if (result.usage) {
        this.usage = asRecord(result.usage);
      }

      const deniedActions = Array.isArray(result.denied_actions)
        ? result.denied_actions.map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
        : [];
      const hasDeniedCommand = deniedActions.some((da) => stringValue(da.action) === 'command');

      const events: PipelineEventEnvelope[] = [];
      const responseText = stringValue(result.response);
      if (responseText && responseText.trim().length > 0) {
        events.push(envelope(scopedContext, 'agent.message', { text: responseText }));
      }

      const status = stringValue(result.status);
      const durationSeconds = numberValue(result.duration_seconds);
      const turns = numberValue(result.num_turns);

      if (hasDeniedCommand) {
        const reason =
          this.lastDeniedCommand ??
          'command_denied: a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied';
        events.push(
          envelope(
            { ...scopedContext, sourceEventId: `${scopedContext.sourceEventId ?? context.instanceId}:denied` },
            'runtime.error',
            { message: reason },
          ),
        );
        events.push(
          envelope(scopedContext, 'run.completed', {
            success: false,
            status,
            reason,
            deniedActions,
            durationSeconds,
            turns,
          }),
        );
      } else if (status !== 'SUCCESS') {
        const reason = stringValue(result.error) ?? 'run_failed';
        events.push(
          envelope(
            { ...scopedContext, sourceEventId: `${scopedContext.sourceEventId ?? context.instanceId}:error` },
            'runtime.error',
            { message: reason },
          ),
        );
        events.push(
          envelope(scopedContext, 'run.completed', {
            success: false,
            status,
            reason,
            durationSeconds,
            turns,
          }),
        );
      } else {
        events.push(
          envelope(scopedContext, 'run.completed', {
            success: true,
            status,
            durationSeconds,
            turns,
          }),
        );
      }

      return events;
    }

    this.unknownEventCount++;
    return [
      envelope(
        scopedContext,
        'runtime.schema.degraded',
        { sourceType: eventName, unknownCount: this.unknownEventCount },
        'unknown',
      ),
    ];
  }

  getUnknownEventCount(): number {
    return this.unknownEventCount;
  }

  telemetry(identity: PipelineIdentity): RuntimeTelemetrySnapshot {
    if (!this.usage) {
      return unknownTelemetry(identity, 'agy:stream-json');
    }

    const snapshot = unknownTelemetry(identity, 'agy:result');
    const reported = (name: Parameters<typeof metricSample>[1], value: number | null) =>
      metricSample(
        identity,
        name,
        name.startsWith('cost.') ? 'cost' : name.startsWith('context.') ? 'context' : 'tokens',
        name === 'cost.usd' ? 'USD' : 'tokens',
        value,
        value === null ? 'unknown' : 'runtime_reported',
        value === null ? 'unknown' : 'verified',
        'agy:result',
      );

    snapshot.usage.inputTokens = reported('tokens.input', numberValue(this.usage.input_tokens));
    snapshot.usage.outputTokens = reported('tokens.output', numberValue(this.usage.output_tokens));
    snapshot.usage.cacheReadTokens = reported('tokens.cache_read', numberValue(this.usage.cache_read_tokens));
    snapshot.usage.reasoningTokens = reported('tokens.reasoning', numberValue(this.usage.thinking_tokens));
    snapshot.usage.cacheWriteTokens = reported('tokens.cache_write', null);
    snapshot.cost.usd = reported('cost.usd', null);
    snapshot.cost.billingStatus = 'unknown';
    snapshot.context.maxTokens = reported('context.max_tokens', null);

    const thinkingTokens = numberValue(this.usage.thinking_tokens);
    snapshot.reasoningVisibility = thinkingTokens !== null && thinkingTokens > 0 ? 'summary' : 'unavailable';

    return snapshot;
  }
}
