import type {
  PipelineEventEnvelope,
  RuntimeDescriptor,
  RuntimeDiscovery,
  RuntimeHealth,
  RuntimeSession,
  RuntimeSessionRequest,
  RuntimeTelemetrySnapshot,
} from '../../../types/pipeline';

export interface RuntimeAttachRequest extends RuntimeSessionRequest {
  sessionId: string;
}

export interface RuntimeResumeRequest extends RuntimeStartRequest {
  sessionId: string;
  resumeToken: string | null;
}

export interface RuntimeStartRequest extends RuntimeSessionRequest {
  instruction: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RuntimeAdapter {
  readonly descriptor: RuntimeDescriptor;
  discover(): Promise<RuntimeDiscovery>;
  health(): Promise<RuntimeHealth>;
  start?(request: RuntimeStartRequest): Promise<RuntimeSession>;
  attach?(request: RuntimeAttachRequest): Promise<RuntimeSession>;
  resume?(request: RuntimeResumeRequest): Promise<RuntimeSession>;
  events(session: RuntimeSession, signal?: AbortSignal): AsyncIterable<PipelineEventEnvelope>;
  telemetry(session: RuntimeSession): Promise<RuntimeTelemetrySnapshot>;
  shutdown(session: RuntimeSession): Promise<void>;
}

export interface RuntimeTransport {
  readonly transportId: string;
  open(request: RuntimeSessionRequest, signal?: AbortSignal): Promise<RuntimeSession>;
  events(session: RuntimeSession, signal?: AbortSignal): AsyncIterable<unknown>;
  close(session: RuntimeSession): Promise<void>;
}
