// types/ai-use.ts
//
// Los usos de texto de GitCron frente a gitcron.json (tarea 4.3 de modelos-en-casa),
// como los ve la pantalla. Sin secretos: nombres, destino y archivo.

export type AiTextUse = 'gitcron-commit' | 'gitcron-cartography' | 'gitcron-openspec-analysis' | 'gitcron-temporal';

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

export type AiLastRequest = CommitAiLastRequest;

export type AiUseStatus =
  | {
      status: 'resolved';
      use: AiTextUse;
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
    }
  | {
      status: 'disabled';
      use: AiTextUse;
      sourceFile: string | null;
      sourceDir?: string;
      canLoad?: boolean;
      serverUrl?: string;
    }
  | {
      status: 'unset';
      use: AiTextUse;
      offer: AiUseOffer | null;
      canLoad?: boolean;
      serverUrl?: string;
    }
  | {
      status: 'error';
      use: AiTextUse;
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
  use?: AiTextUse;
  repoPath?: string | null;
}
