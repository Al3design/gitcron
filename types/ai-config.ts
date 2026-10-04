// types/ai-config.ts
// Tipos para la sección de ajustes «Motores y modelos» (tarea 6.1).

import type { AiTextUse } from './ai-use';
import type { CommitAiConfigFileStatus, CommitAiConfigParseError, CommitAiConfigWarning } from './commit-message-ai';

export interface AiConfigFileInfo {
  path: string;
  scope: 'global' | 'repo';
  exists: boolean;
  error?: CommitAiConfigParseError;
  usingLastValid?: boolean;
}

export interface AiConfigProviderEnvVar {
  name: string;
  isApiKey: boolean;
  status: 'system' | 'stored' | 'missing';
}

export interface AiConfigProviderInfo {
  id: string;
  name: string;
  family: 'openai-compatible' | 'anthropic' | 'cli';
  baseURL?: string;
  available: boolean;
  unavailableReason?: string | null;
  canLoad: boolean;
  isCli: boolean;
  envVars: AiConfigProviderEnvVar[];
  declaredModels: string[];
}

export interface AiConfigAdvancedOption {
  key: string;
  value: unknown;
  warning?: string;
}

export interface AiConfigUseInfo {
  use: AiTextUse;
  model: string | null;
  modelSource: 'general' | 'agent';
  isException: boolean;
  temperature?: number;
  maxTokens?: number;
  advancedOptions: AiConfigAdvancedOption[];
}

export interface AiConfigStatusResult {
  files: AiConfigFileInfo[];
  warnings: CommitAiConfigWarning[];
  generalModel: string | null;
  smallModel: string | null;
  providers: AiConfigProviderInfo[];
  uses: AiConfigUseInfo[];
}

export interface AddProviderPayload {
  id: string;
  name: string;
  baseURL: string;
  apiKey?: string;
  repoPath?: string | null;
}

export interface RemoveProviderPayload {
  id: string;
  repoPath?: string | null;
  deleteStoredVar?: boolean;
}

export interface AddModelPayload {
  providerId: string;
  modelId: string;
  name?: string;
  repoPath?: string | null;
}

export interface RemoveModelPayload {
  providerId: string;
  modelId: string;
  repoPath?: string | null;
}

export interface ModelLoadSettingsResult {
  contextLength: number;
  ttlMinutes: number;
}

export interface SetModelLoadSettingsPayload {
  providerId?: string;
  modelId: string;
  use?: string;
  repoPath?: string | null;
  contextLength?: number;
  ttlMinutes?: number;
}

// ─── Importar desde OpenCode y servidores MCP (6.1, segunda parte) ───
// Nada de esto trae un valor secreto: de una clave o un token sólo viaja el nombre
// de la variable donde queda guardado.

export interface AiImportVariable {
  name: string;
  /** `fromFile`: el valor estaba escrito a mano en el archivo de origen; se guarda en GitCron al importar. */
  status: 'system' | 'stored' | 'missing' | 'fromFile';
}

/** Un campo que cambia. En un campo secreto, un valor escrito a mano no viaja: sólo la marca `…Hidden`. */
export interface AiImportFieldChange {
  segments: string[];
  before?: unknown;
  after?: unknown;
  beforeHidden?: boolean;
  afterHidden?: boolean;
}

/** El archivo de origen: ausente e ilegible se dicen distinto (ninguno quiere decir «vacío»). */
export interface AiImportSourceInfo {
  status: 'absent' | 'invalid' | 'ok';
  path: string;
  error?: CommitAiConfigParseError;
}

/** El archivo de destino: si está roto, no hay plan. */
export interface AiImportTargetInfo {
  path: string;
  error?: CommitAiConfigParseError;
}

export interface AiOpenCodeImportPlanEntry {
  kind: 'provider' | 'agent';
  id: string;
  status: 'new' | 'same' | 'changed';
  changes: AiImportFieldChange[];
  variables: AiImportVariable[];
}

export interface AiOpenCodeImportPlanResult {
  source: AiImportSourceInfo;
  target: AiImportTargetInfo;
  entries: AiOpenCodeImportPlanEntry[];
}

export interface ApplyOpenCodeImportPayload {
  entries: Array<{ kind: 'provider' | 'agent'; id: string }>;
}

export type AiMcpImportSource = 'cursor' | 'lmstudio' | 'opencode';

/**
 * Lo que la pantalla ve de un servidor MCP: el programa (sin carpeta) o el host, y
 * los nombres de `env` y `headers`. Ni sus valores ni los argumentos ni la dirección
 * completa, que también pueden llevar tokens.
 */
export interface AiMcpServerSummary {
  kind: 'local' | 'remote' | 'unknown';
  command?: string;
  host?: string;
  envVarNames: string[];
  headerNames: string[];
}

export interface AiMcpServerInfo extends AiMcpServerSummary {
  name: string;
  disabled: boolean;
  /** El mcp.json de donde sale. */
  origin: string;
  scope: 'global' | 'repo';
}

export interface AiMcpStatusResult {
  servers: AiMcpServerInfo[];
  files: AiConfigFileInfo[];
}

export interface RemoveMcpServerPayload {
  filePath: string;
  name: string;
  repoPath?: string | null;
}

export interface AiMcpImportPlanEntry extends AiMcpServerSummary {
  name: string;
  status: 'new' | 'same' | 'changed';
  disabled: boolean;
  /** Los campos que cambian, sin sus valores. */
  changedFields: string[];
  /** Variables cuyo valor estaba escrito a mano en el origen: se guardan en GitCron al importar. */
  fromFile: string[];
}

export interface AiMcpImportPlanResult {
  source: AiImportSourceInfo;
  target: AiImportTargetInfo;
  entries: AiMcpImportPlanEntry[];
  /** Servidores de OpenCode que no son locales ni remotos: no se convierten. */
  skipped: string[];
}

export interface PlanMcpImportPayload {
  source: AiMcpImportSource;
}

export interface ApplyMcpImportPayload {
  source: AiMcpImportSource;
  entries: string[];
}
