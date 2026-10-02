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
      /** La entrada del uso o la elección general (`model`). */
      modelSource: 'agent' | 'general';
      available: boolean;
      unavailableReason: string | null;
      /** Proveedores que declaran los mismos modelos (D7): se ofrecen, nunca se usan solos. */
      alternatives: AiUseAlternative[];
    }
  | { status: 'disabled'; use: AiTextUse; sourceFile: string | null }
  | { status: 'unset'; use: AiTextUse; offer: AiUseOffer | null }
  | {
      status: 'error';
      use: AiTextUse;
      error: string;
      parseError?: { file: string; line: number; column: number; code: string };
    };
