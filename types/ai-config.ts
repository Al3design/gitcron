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
