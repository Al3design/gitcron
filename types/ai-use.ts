// types/ai-use.ts
//
// Los usos de texto de GitCron frente a gitcron.json (tarea 4.3 de modelos-en-casa),
// como los ve la pantalla. Sin secretos: nombres, destino y archivo.

export type AiTextUse = 'gitcron-commit' | 'gitcron-cartography' | 'gitcron-openspec-analysis' | 'gitcron-temporal';
export type AiAgentUse = 'gitcron-sdd';
export type AiUse = AiTextUse | AiAgentUse;

export type AiUseDestination = 'this-machine' | 'own-server' | 'external-service';

/** «Usar lo que tenías»: lo que se escribiría en gitcron.json. */
export interface AiUseOffer {
  /** `<proveedor>/<modelo>`, lo que va en `agent.<uso>.model`. */
  modelRef: string;
  /** «Proveedor · modelo», para el botón. */
  label: string;
  /** Si además se agrega el proveedor (no estaba declarado), su id. */
  addsProvider: string | null;
  /** El archivo donde se escribe. */
  file: string;
}

export interface AiUseAlternative {
  providerId: string;
  providerName: string;
  destination: AiUseDestination;
}

import type { CommitAiLastRequest } from './commit-message-ai';
import type { PipelineRuntime } from './pipeline';

export type AiLastRequest = CommitAiLastRequest;

export type OpenCodeAuthNotice =
  | { kind: 'missing_env'; variableName: string }
  | { kind: 'auth_json_override'; providerId: string; logoutCommand: string }
  | { kind: 'mismatch_other'; providerId: string };

export type AiUseStatus =
  | {
      status: 'resolved';
      use: AiUse;
      providerId: string;
      providerName: string;
      modelId: string;
      kind: 'openai-compatible' | 'anthropic' | 'cli';
      destination: AiUseDestination;
      sourceFile: string;
      sourceDir: string;
      /** La entrada del uso o la elección general (`model`). */
      modelSource: 'agent' | 'general';
      /** Es la excepción de ese uso frente a la elección general configurada en el archivo. */
      isException: boolean;
      available: boolean;
      unavailableReason: string | null;
      /** Proveedores que declaran los mismos modelos (D7): se ofrecen, nunca se usan solos. */
      alternatives: AiUseAlternative[];
      /** Capacidad de carga detectada en el servidor (D11, D6). */
      canLoad: boolean;
      /** Dirección del servidor para el catálogo de LM Studio si canLoad es verdadero. */
      serverUrl?: string;
      /** Motor asignado para este modelo (D1, D13). */
      runtime?: PipelineRuntime;
      /** Quién ejecuta las herramientas (D13). */
      toolsExecutor?: string;
      /** Referencia `<proveedor>/<modelo>`. */
      modelRef?: string;
      /** Intensidad de razonamiento efectiva si la hay (D17). */
      effort?: string;
      /** Variante resuelta para OpenCode (D8, D17). */
      variant?: string;
      /** Si OpenCode conoce el modelo para este repo (D8, tarea 5.3). */
      opencodeKnown?: boolean;
      /** Si OpenCode está instalado en el sistema. */
      opencodeInstalled?: boolean;
      /** OpenCode no contestó la lista de modelos: no se sabe si conoce el modelo. */
      opencodeListFailed?: boolean;
      /** Límite de contexto reportado por OpenCode si se conoce (D8). */
      contextLimit?: number | null;
      /** Aviso de desalineación de claves entre OpenCode y GitCron si lo hay (D8, tarea 5.3). */
      opencodeAuthNotice?: OpenCodeAuthNotice | null;
      /**
       * Sólo del agente de SDD: la clave de lo que se lanzaría. El lanzador la devuelve
       * como `expectedModel`; si el archivo cambió, el proceso principal no lanza nada.
       */
      launchKey?: string;
    }
  | {
      status: 'disabled';
      use: AiUse;
      sourceFile: string | null;
      sourceDir?: string;
      canLoad?: boolean;
      serverUrl?: string;
    }
  | {
      status: 'unset';
      use: AiUse;
      offer: AiUseOffer | null;
      canLoad?: boolean;
      serverUrl?: string;
    }
  | {
      status: 'error';
      use: AiUse;
      error: string;
      parseError?: { file: string; line: number; column: number; code: string };
      canLoad?: boolean;
      serverUrl?: string;
    };

/**
 * Para qué uso y repositorio se piden el catálogo, la carga o la expulsión de un
 * modelo de LM Studio (4.4). La dirección la resuelve el proceso principal.
 */
export interface AiLoadTarget {
  use?: AiUse;
  repoPath?: string | null;
}

export interface AiToolModel {
  id: string;
  name?: string;
  supportedLevels?: string[];
  defaultLevel?: string;
  variants?: string[];
}

export interface AiToolProvider {
  id: string;
  name: string;
  kind: 'cli' | 'openai-compatible' | 'anthropic';
  available: boolean;
  unavailableReason?: string;
  models: AiToolModel[];
  agentRuntime?: PipelineRuntime;
  toolsExecutor?: string;
}

export interface AiUseCurrentChoice {
  providerId: string;
  modelId: string;
  fullModelRef: string;
  effort?: string;
  variant?: string;
  sourceFile?: string;
  scope?: 'global' | 'repo';
}

export interface AiUseModelsResult {
  use: AiUse;
  providers: AiToolProvider[];
  current: AiUseCurrentChoice | null;
}

export interface AiUseChoosePayload {
  use: AiUse;
  repoPath?: string | null;
  model: string;
  effort?: string;
  variant?: string;
}

export interface AiUseChooseResult {
  written: boolean;
  file: string;
}
