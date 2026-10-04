// electron/ai/config/opencode-import.ts
//
// Copiar a gitcron.json bloques `provider` y `agent` del opencode.json de la persona
// (tarea 3.6, requisito «Importar desde la configuración de OpenCode»).
//
// Dos pasos: un plan que dice, por bloque, si es nuevo, igual o qué campos cambian,
// y qué variables usa; y aplicar sólo los bloques que la persona confirma. Las
// referencias `{env:…}` y `{file:…}` se copian tal cual: mismo formato (D1), mismo
// significado. opencode.json se lee y NUNCA se escribe.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { diffValues, referencedVariables, type FieldChange } from './config-diff';
import { getDefaultConfigPath, parseGitCronConfigText, type GitCronConfig, type GitCronConfigParseError } from './gitcron-config';
import { updateGitCronConfigValue, type ConfigWriteResult } from './gitcron-config-writer';
import {
  envVarNameFrom,
  literalSecretsToSave,
  replaceLiteralSecrets,
  type SecretNaming,
  type SecretSlot,
} from './literal-secrets';

/** `~/.config/opencode/opencode.json`, o `opencode.jsonc` si sólo existe ése. */
export function getDefaultOpenCodePath(): string {
  const dir = path.join(os.homedir(), '.config', 'opencode');
  const json = path.join(dir, 'opencode.json');
  const jsonc = path.join(dir, 'opencode.jsonc');
  return !fs.existsSync(json) && fs.existsSync(jsonc) ? jsonc : json;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Dónde puede traer un proveedor de opencode.json una clave o una cabecera escrita a mano. */
export function providerSecretSlots(id: string, provider: unknown): SecretSlot[] {
  const apiKeyName = envVarNameFrom(`${id}_API_KEY`);
  const slots: SecretSlot[] = [
    { segments: ['options', 'apiKey'], baseName: apiKeyName },
    { segments: ['apiKey'], baseName: apiKeyName },
  ];
  const headers = isObject(provider) && isObject(provider.options) ? provider.options.headers : undefined;
  for (const header of isObject(headers) ? Object.keys(headers) : []) {
    slots.push({ segments: ['options', 'headers', header], baseName: envVarNameFrom(`${id}_${header}`) });
  }
  return slots;
}

/** Los campos de un proveedor que guardan secretos: la vista previa no muestra sus valores. */
export function isProviderSecretField(segments: string[]): boolean {
  return segments[0] === 'apiKey' || (segments[0] === 'options' && (segments[1] === 'apiKey' || segments[1] === 'headers'));
}

/**
 * El archivo de origen y en qué estado está. «No existe» y «no se puede interpretar»
 * son casos distintos y se dicen distinto: ninguno de los dos significa «no hay
 * proveedores» (escenario «Archivo de OpenCode ausente o ilegible»).
 */
export type ImportSourceStatus =
  | { status: 'absent'; path: string }
  | { status: 'invalid'; path: string; error: GitCronConfigParseError }
  | { status: 'ok'; path: string };

export function readJsoncSource(filePath: string): ImportSourceStatus & { data?: Record<string, unknown> } {
  if (!fs.existsSync(filePath)) return { status: 'absent', path: filePath };
  const parsed = parseGitCronConfigText(fs.readFileSync(filePath, 'utf8'), filePath);
  if (parsed.kind === 'error') return { status: 'invalid', path: filePath, error: parsed.error };
  return { status: 'ok', path: filePath, data: parsed.config as Record<string, unknown> };
}

export interface ImportPlanEntry {
  kind: 'provider' | 'agent';
  id: string;
  /** `new`: no está en gitcron.json; `same`: ya está igual; `changed`: está distinto. */
  status: 'new' | 'same' | 'changed';
  /**
   * El bloque como quedaría en gitcron.json: el de opencode.json con sus referencias,
   * y cada clave o cabecera escrita a mano cambiada por `{env:NOMBRE}` (D5).
   */
  value: unknown;
  /** Para `changed`: qué campos cambian (antes en gitcron.json, después desde OpenCode). */
  changes: FieldChange[];
  /** Variables `{env:}` que usa el bloque, para decir cuáles están definidas y cuáles faltan. */
  variables: string[];
  /** Las variables cuyo valor estaba escrito a mano en opencode.json: van al baúl al aplicar. */
  fromFile: string[];
}

export interface OpenCodeImportPlan {
  source: ImportSourceStatus;
  /** El gitcron.json de destino: si está roto, no se planea ni se escribe nada. */
  target: { path: string; error?: GitCronConfigParseError };
  entries: ImportPlanEntry[];
}

export interface PlanOpenCodeImportOptions {
  opencodePath?: string;
  gitcronPath?: string;
  /** Las variables guardadas en el baúl: un nombre ocupado con otro valor no se pisa. */
  stored?: (name: string) => string | undefined;
  env?: NodeJS.ProcessEnv;
}

export function planOpenCodeImport(options: PlanOpenCodeImportOptions = {}): OpenCodeImportPlan {
  const sourceRead = readJsoncSource(options.opencodePath ?? getDefaultOpenCodePath());
  const { data, ...source } = sourceRead;
  const targetPath = options.gitcronPath ?? getDefaultConfigPath();
  const plan: OpenCodeImportPlan = { source, target: { path: targetPath }, entries: [] };
  if (!data) return plan;

  let current: GitCronConfig = {};
  if (fs.existsSync(targetPath)) {
    const parsed = parseGitCronConfigText(fs.readFileSync(targetPath, 'utf8'), targetPath);
    if (parsed.kind === 'error') {
      plan.target.error = parsed.error;
      return plan;
    }
    current = parsed.config;
  }

  const naming: SecretNaming = {
    stored: options.stored ?? (() => undefined),
    env: options.env ?? process.env,
    taken: new Map(),
  };
  for (const kind of ['provider', 'agent'] as const) {
    const blocks = (data[kind] ?? {}) as Record<string, unknown>;
    const existing = (current[kind] ?? {}) as Record<string, unknown>;
    for (const [id, raw] of Object.entries(blocks)) {
      const before = existing[id];
      const { value, fromFile } = kind === 'provider'
        ? replaceLiteralSecrets(raw, providerSecretSlots(id, raw), before, 'opencode', naming)
        : { value: raw, fromFile: [] };
      const changes = before === undefined ? [] : diffValues(before, value);
      plan.entries.push({
        kind,
        id,
        status: before === undefined ? 'new' : changes.length === 0 ? 'same' : 'changed',
        value,
        changes,
        variables: referencedVariables(value),
        fromFile,
      });
    }
  }
  return plan;
}

/**
 * Escribe en gitcron.json los bloques confirmados. Pasar una entrada es la
 * confirmación: la pantalla muestra el plan y manda sólo lo que la persona aceptó.
 * Los bloques `same` no se reescriben. Cada bloque es una escritura puntual: el
 * resto del archivo (comentarios, otros bloques) no cambia.
 *
 * Si un bloque trae valores escritos a mano (`fromFile`), se releen de opencode.json
 * y se guardan con `saveSecret` antes de escribir: el archivo nunca queda apuntando
 * a una variable que no se guardó. opencode.json sólo se lee.
 */
export function applyOpenCodeImport(options: {
  gitcronPath?: string;
  entries: ImportPlanEntry[];
  opencodePath?: string;
  saveSecret?: (name: string, value: string) => void;
}): Array<{ kind: ImportPlanEntry['kind']; id: string; result: ConfigWriteResult }> {
  const filePath = options.gitcronPath ?? getDefaultConfigPath();
  const toWrite = options.entries.filter((entry) => entry.status !== 'same');

  if (toWrite.some((entry) => entry.fromFile.length > 0)) {
    if (!options.saveSecret) throw new Error('applyOpenCodeImport: falta saveSecret para los valores escritos a mano');
    const providers = readJsoncSource(options.opencodePath ?? getDefaultOpenCodePath()).data?.provider;
    for (const entry of toWrite) {
      if (entry.kind !== 'provider' || entry.fromFile.length === 0) continue;
      const raw = isObject(providers) ? providers[entry.id] : undefined;
      for (const { name, value } of literalSecretsToSave(raw, entry.value, providerSecretSlots(entry.id, raw))) {
        options.saveSecret(name, value);
      }
    }
  }

  return toWrite.map((entry) => ({
    kind: entry.kind,
    id: entry.id,
    result: updateGitCronConfigValue({ filePath, segments: [entry.kind, entry.id], value: entry.value }),
  }));
}
