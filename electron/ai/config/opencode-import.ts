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

/** `~/.config/opencode/opencode.json`, o `opencode.jsonc` si sólo existe ése. */
export function getDefaultOpenCodePath(): string {
  const dir = path.join(os.homedir(), '.config', 'opencode');
  const json = path.join(dir, 'opencode.json');
  const jsonc = path.join(dir, 'opencode.jsonc');
  return !fs.existsSync(json) && fs.existsSync(jsonc) ? jsonc : json;
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
  /** El bloque tal como está en opencode.json, con sus referencias. */
  value: unknown;
  /** Para `changed`: qué campos cambian (antes en gitcron.json, después desde OpenCode). */
  changes: FieldChange[];
  /** Variables `{env:}` que usa el bloque, para decir cuáles están definidas y cuáles faltan. */
  variables: string[];
}

export interface OpenCodeImportPlan {
  source: ImportSourceStatus;
  /** El gitcron.json de destino: si está roto, no se planea ni se escribe nada. */
  target: { path: string; error?: GitCronConfigParseError };
  entries: ImportPlanEntry[];
}

export function planOpenCodeImport(options: { opencodePath?: string; gitcronPath?: string } = {}): OpenCodeImportPlan {
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

  for (const kind of ['provider', 'agent'] as const) {
    const blocks = (data[kind] ?? {}) as Record<string, unknown>;
    const existing = (current[kind] ?? {}) as Record<string, unknown>;
    for (const [id, value] of Object.entries(blocks)) {
      const before = existing[id];
      const changes = before === undefined ? [] : diffValues(before, value);
      plan.entries.push({
        kind,
        id,
        status: before === undefined ? 'new' : changes.length === 0 ? 'same' : 'changed',
        value,
        changes,
        variables: referencedVariables(value),
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
 */
export function applyOpenCodeImport(options: {
  gitcronPath?: string;
  entries: ImportPlanEntry[];
}): Array<{ kind: ImportPlanEntry['kind']; id: string; result: ConfigWriteResult }> {
  const filePath = options.gitcronPath ?? getDefaultConfigPath();
  return options.entries
    .filter((entry) => entry.status !== 'same')
    .map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      result: updateGitCronConfigValue({ filePath, segments: [entry.kind, entry.id], value: entry.value }),
    }));
}
