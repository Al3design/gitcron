export type PipelineEvidenceStatus =
  | 'verified'
  | 'inferred'
  | 'unknown'
  | 'blocked'
  | 'pending_fixture';

export type OrchestrationMode = 'direct' | 'hermes' | 'external' | 'unknown';
export type PipelineRuntime = 'hermes' | 'claude' | 'codex' | 'agy' | 'opencode' | 'unknown';
export type PipelineAgentRole =
  | 'scout'
  | 'planner'
  | 'builder'
  | 'auditor'
  | 'fixer'
  | 'orchestrator'
  | 'unknown';

export interface PipelineIdentity {
  repoId: string;
  repoPath: string | null;
  changeId: string | null;
  taskId: string | null;
  runId: string;
  attemptId: string;
  sessionId: string;
  parentSessionId: string | null;
  agentId: string;
  parentAgentId: string | null;
  orchestrationMode: OrchestrationMode;
  orchestratorRuntime: string | null;
  runtime: PipelineRuntime;
  provider: string | null;
  requestedModel: string | null;
  effectiveModel: string | null;
  reportedModel: string | null;
  role: PipelineAgentRole;
}

export type RuntimeAdapterKind =
  | 'native-stream'
  | 'structured-cli'
  | 'wrapper'
  | 'openai-compatible';

export type RuntimeCapabilityAvailability = 'available' | 'degraded' | 'unavailable' | 'unknown';
export type RuntimeCapabilityScope = 'repo' | 'run' | 'session' | 'agent';

export interface RuntimeCapability {
  capabilityId: string;
  capabilityVersion: string | null;
  availability: RuntimeCapabilityAvailability;
  evidenceStatus: PipelineEvidenceStatus;
  targetScopes: RuntimeCapabilityScope[];
  constraints: string[];
  evidenceRefs: string[];
}

export interface RuntimeDescriptor {
  adapterId: string;
  runtime: PipelineRuntime;
  adapterKind: RuntimeAdapterKind;
  transport: string;
  runtimeVersion: string | null;
  protocolVersion: string | null;
  capabilities: RuntimeCapability[];
}

export interface RuntimeDiscovery {
  installed: boolean;
  executable: string | null;
  runtimeVersion: string | null;
  evidenceStatus: PipelineEvidenceStatus;
  evidenceRefs: string[];
  diagnostics: string[];
}

export interface RuntimeHealth {
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  checkedAt: string;
  latencyMs: number | null;
  evidenceStatus: PipelineEvidenceStatus;
  evidenceRefs: string[];
  diagnostics: string[];
}

export interface RuntimeSessionRequest {
  repoId: string;
  canonicalRepoPath: string;
  changeId: string | null;
  taskId: string | null;
  runId: string;
  attemptId: string;
  parentSessionId: string | null;
  parentAgentId: string | null;
  orchestrationMode: OrchestrationMode;
  orchestratorRuntime: string | null;
  provider: string | null;
  requestedModel: string | null;
  role: PipelineAgentRole;
  reasoningEffort?: string | null;
}

export interface RuntimeSession {
  identity: PipelineIdentity;
  descriptor: RuntimeDescriptor;
  ownedProcess: boolean;
  startedAt: string;
}

export type PipelineDataProvenance = 'runtime' | 'repo' | 'derived' | 'human';

export interface PipelineEventEnvelope<T = unknown> {
  schemaVersion: '1.0';
  eventId: string;
  sequence: number | null;
  sequenceScope: string | null;
  emittedAt: string | null;
  observedAt: string;
  identity: PipelineIdentity;
  kind: string;
  source: {
    adapterId: string;
    instanceId: string;
    transport: string;
    protocolVersion: string | null;
  };
  payload: T;
  provenance: PipelineDataProvenance;
  evidenceStatus: PipelineEvidenceStatus;
  evidenceRefs: string[];
  redactionVersion: string;
}

export type MetricClassification =
  | 'runtime_reported'
  | 'locally_measured'
  | 'estimated'
  | 'included_plan'
  | 'local_unpriced'
  | 'unknown';

export type MetricDimension =
  | 'tokens'
  | 'cost'
  | 'duration'
  | 'context'
  | 'retries'
  | 'human_wait'
  | 'human_touch';

export type MetricName =
  | 'tokens.input'
  | 'tokens.output'
  | 'tokens.cache_read'
  | 'tokens.cache_write'
  | 'tokens.reasoning'
  | 'cost.usd'
  | 'duration.wall_ms'
  | 'duration.active_ms'
  | 'duration.tool_ms'
  | 'duration.human_wait_ms'
  | 'duration.retry_ms'
  | 'duration.pause_ms'
  | 'context.max_tokens'
  | 'context.current_tokens'
  | 'context.historical_tokens'
  | 'context.compaction_count'
  | 'retry.count'
  | 'human_touch.count';

export interface MetricSample {
  metricId: string;
  identity: PipelineIdentity;
  dimension: MetricDimension;
  metricName: MetricName;
  value: number | null;
  unit: string;
  classification: MetricClassification;
  periodStart: string | null;
  periodEnd: string | null;
  sourceRef: string;
  formula: string | null;
  pricingSource: string | null;
  pricingAsOf: string | null;
  dedupeScope: string | null;
  evidenceStatus: PipelineEvidenceStatus;
  evidenceRefs: string[];
}

export interface UsageSnapshot {
  inputTokens: MetricSample;
  outputTokens: MetricSample;
  cacheReadTokens: MetricSample;
  cacheWriteTokens: MetricSample;
  reasoningTokens: MetricSample;
}

export interface ContextSnapshot {
  maxTokens: MetricSample;
  currentTokens: MetricSample;
  historicalTokens: MetricSample;
  compactionCount: MetricSample;
}

export interface CostSnapshot {
  usd: MetricSample;
  billingStatus: 'reported' | 'estimated' | 'included_plan' | 'local_unpriced' | 'unknown';
}

export interface RuntimeTelemetrySnapshot {
  usage: UsageSnapshot;
  context: ContextSnapshot;
  cost: CostSnapshot;
  reasoningVisibility: 'emitted' | 'summary' | 'unavailable';
}
