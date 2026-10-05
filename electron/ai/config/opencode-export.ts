// electron/ai/config/opencode-export.ts
//
// Copiar a OpenCode un proveedor o modelo configurado en GitCron (tarea 5.3 segunda parte, D8).
//
// Cuando el modelo elegido para el agente de SDD es de un servidor propio en gitcron.json
// y OpenCode no lo conoce, el lanzador ofrece «Copiar a OpenCode»:
//
// 1. Plan contra el `opencode.json` global de OpenCode (`getDefaultOpenCodePath()`).
//    - Si el proveedor NO está: se copia su bloque entero tal cual (mismo formato D1,
//      con sus referencias `{env:…}`).
//    - Si el proveedor YA está: sólo se agrega el modelo que falta en
//      `provider.<id>.models.<modelo>`; nunca se pisa ni se reordena lo demás.
// 2. Si el bloque trae claves o cabeceras escritas a mano (literales), ese campo NO se copia
//    y el plan indica que debe guardarse en GitCron primero.
// 3. Edición puntual con `updateGitCronConfigValue`: el resto del archivo queda igual byte a byte.
// 4. Tras la escritura se ejecuta `opencode reload` y se puede reconsultar la lista.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDefaultConfigPath, loadGitCronConfig, type GitCronConfig } from './gitcron-config';
import { updateGitCronConfigValue, type ConfigWriteResult } from './gitcron-config-writer';
import { isLiteralSecret } from './literal-secrets';
import { getDefaultOpenCodePath, providerSecretSlots, readJsoncSource } from './opencode-import';
import { reloadOpenCode } from './opencode-service';
import { activeConfigPath } from '../use-resolution';
import type { RuntimeProcessRunner } from '../../pipeline/runtime-adapters/process-runner';

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function valueAt(obj: unknown, segments: readonly string[]): unknown {
  let curr = obj;
  for (const seg of segments) {
    if (!isObject(curr)) return undefined;
    curr = curr[seg];
  }
  return curr;
}

function deleteAt(obj: Record<string, unknown>, segments: readonly string[]): void {
  let curr: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    if (!isObject(curr)) return;
    curr = curr[segments[i]];
  }
  if (isObject(curr)) {
    delete curr[segments[segments.length - 1]];
  }
}

export interface PlanOpenCodeExportOptions {
  providerId: string;
  modelId: string;
  repoPath?: string | null;
  opencodePath?: string;
  gitcronPath?: string;
  config?: GitCronConfig;
}

export interface OpenCodeExportPlan {
  canCopy: boolean;
  reason?: string;
  providerId: string;
  modelId: string;
  targetPath: string;
  mode: 'add_provider' | 'add_model';
  segments: readonly string[];
  value: unknown;
  previewText: string;
  hasLiteralSecrets: boolean;
  omittedSecrets: string[];
}

/**
 * Arma el plan para copiar un proveedor o modelo a opencode.json sin escribir nada.
 */
export function planOpenCodeExport(options: PlanOpenCodeExportOptions): OpenCodeExportPlan {
  const { providerId, modelId } = options;
  const targetPath = options.opencodePath ?? getDefaultOpenCodePath();

  const sourceRead = readJsoncSource(targetPath);
  if (sourceRead.status === 'invalid') {
    return {
      canCopy: false,
      reason: 'opencode_json_invalid',
      providerId,
      modelId,
      targetPath,
      mode: 'add_provider',
      segments: [],
      value: null,
      previewText: '',
      hasLiteralSecrets: false,
      omittedSecrets: [],
    };
  }

  const loaded = options.config
    ? { config: options.config }
    : loadGitCronConfig({
      globalPath: options.gitcronPath ?? activeConfigPath(),
      repoPath: options.repoPath ?? null,
    });

  const rawProvider = loaded.config?.provider?.[providerId];
  if (!rawProvider || !isObject(rawProvider)) {
    return {
      canCopy: false,
      reason: 'provider_not_found',
      providerId,
      modelId,
      targetPath,
      mode: 'add_provider',
      segments: [],
      value: null,
      previewText: '',
      hasLiteralSecrets: false,
      omittedSecrets: [],
    };
  }

  const opencodeData = sourceRead.status === 'ok' ? sourceRead.data : {};
  const existingProviders = isObject(opencodeData?.provider) ? opencodeData!.provider : {};
  const targetProvider = existingProviders[providerId];

  // Caso 1: El proveedor NO existe en OpenCode -> Copiar bloque entero
  if (targetProvider === undefined) {
    const omittedSecrets: string[] = [];
    const clonedProvider = structuredClone(rawProvider) as Record<string, unknown>;

    // Inspeccionar slots de secretos y eliminar cualquier clave o cabecera literal
    const slots = providerSecretSlots(providerId, clonedProvider);
    for (const slot of slots) {
      const val = valueAt(clonedProvider, slot.segments);
      if (isLiteralSecret(val)) {
        omittedSecrets.push(slot.segments.join('.'));
        deleteAt(clonedProvider, slot.segments);
      }
    }

    // Si options.headers quedó vacío como objeto, podemos conservarlo o dejarlo limpio
    if (isObject(clonedProvider.options) && isObject(clonedProvider.options.headers)) {
      if (Object.keys(clonedProvider.options.headers).length === 0) {
        delete (clonedProvider.options as Record<string, unknown>).headers;
      }
    }

    // Asegurar que el modelo elegido figure en models
    if (!clonedProvider.models || !isObject(clonedProvider.models)) {
      clonedProvider.models = {};
    }
    const modelsRec = clonedProvider.models as Record<string, unknown>;
    if (!modelsRec[modelId]) {
      const origModel = isObject(rawProvider.models) ? rawProvider.models[modelId] : undefined;
      modelsRec[modelId] = origModel && isObject(origModel) ? origModel : { name: modelId };
    }

    const previewObj = { [providerId]: clonedProvider };
    const previewText = JSON.stringify(previewObj, null, 2);

    return {
      canCopy: true,
      providerId,
      modelId,
      targetPath,
      mode: 'add_provider',
      segments: ['provider', providerId],
      value: clonedProvider,
      previewText,
      hasLiteralSecrets: omittedSecrets.length > 0,
      omittedSecrets,
    };
  }

  // Caso 2: El proveedor YA existe en OpenCode -> Sólo agregar el modelo que falta
  const origModel = isObject(rawProvider.models) ? rawProvider.models[modelId] : undefined;
  const modelValue = origModel && isObject(origModel) ? structuredClone(origModel) : { name: modelId };

  const previewObj = { [modelId]: modelValue };
  const previewText = JSON.stringify(previewObj, null, 2);

  return {
    canCopy: true,
    providerId,
    modelId,
    targetPath,
    mode: 'add_model',
    segments: ['provider', providerId, 'models', modelId],
    value: modelValue,
    previewText,
    hasLiteralSecrets: false,
    omittedSecrets: [],
  };
}

export interface ApplyOpenCodeExportOptions {
  runner?: RuntimeProcessRunner;
  cwd?: string;
}

export interface ApplyOpenCodeExportResult {
  ok: boolean;
  created?: boolean;
  error?: string;
}

/**
 * Aplica el plan confirmado escribiendo de forma puntual con updateGitCronConfigValue,
 * conservando el resto del archivo byte a byte. Luego ejecuta `opencode reload`.
 */
export async function applyOpenCodeExport(
  plan: OpenCodeExportPlan,
  options: ApplyOpenCodeExportOptions = {},
): Promise<ApplyOpenCodeExportResult> {
  if (!plan.canCopy) {
    return { ok: false, error: plan.reason ?? 'cannot_copy' };
  }

  const targetDir = path.dirname(plan.targetPath);
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const writeResult: ConfigWriteResult = updateGitCronConfigValue({
    filePath: plan.targetPath,
    segments: plan.segments,
    value: plan.value,
    newFileText: '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
  });

  if (!writeResult.ok) {
    const errorMsg = writeResult.reason === 'broken'
      ? 'opencode_json_broken'
      : writeResult.reason === 'changed-while-writing'
        ? 'changed_while_writing'
        : writeResult.message;
    return { ok: false, error: errorMsg };
  }

  // Tras escribir, recargar configuración en el servicio de OpenCode
  const cwd = options.cwd ?? os.homedir();
  const reloadRes = await reloadOpenCode(cwd, options.runner);
  if (!reloadRes.ok) {
    return { ok: true, created: writeResult.created, error: reloadRes.error };
  }

  return { ok: true, created: writeResult.created };
}
