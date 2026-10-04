// electron/ai/config/model-load-settings.ts
//
// Tiempo que queda cargado cada modelo (TTL) guardado en los ajustes propios de
// GitCron en la carpeta de datos (D4, D6, D11).
//
// No va en gitcron.json: el formato de OpenCode no tiene ese campo y viajaría en
// options como parámetro desconocido. Va en un archivo JSON por proveedor y modelo
// en app.getPath('userData')/model-load-settings/.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { app } from 'electron';

export interface StoredModelLoadSettings {
  providerId: string;
  modelId: string;
  ttlSeconds: number;
}

let dataDirOverride: string | null = null;

export function setModelLoadSettingsDirForTesting(dir: string | null): void {
  dataDirOverride = dir;
}

export function getModelLoadSettingsDir(): string {
  if (dataDirOverride) return dataDirOverride;
  return path.join(app.getPath('userData'), 'model-load-settings');
}

export function modelLoadSettingsFilePath(providerId: string, modelId: string, dir = getModelLoadSettingsDir()): string {
  const safeP = providerId.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const safeM = modelId.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const hash = createHash('sha256').update(`${providerId}:::${modelId}`).digest('hex').slice(0, 8);
  return path.join(dir, `${safeP}__${safeM}__${hash}.json`);
}

export function getModelLoadSettings(
  providerId: string,
  modelId: string,
  options: { dir?: string } = {},
): { ttlSeconds: number; ttlMinutes: number } | null {
  const filePath = modelLoadSettingsFilePath(providerId, modelId, options.dir);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as Partial<StoredModelLoadSettings>;
    if (typeof data.ttlSeconds === 'number' && Number.isFinite(data.ttlSeconds) && data.ttlSeconds > 0) {
      return {
        ttlSeconds: data.ttlSeconds,
        ttlMinutes: Math.round(data.ttlSeconds / 60),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveModelLoadSettings(
  providerId: string,
  modelId: string,
  settings: { ttlSeconds?: number; ttlMinutes?: number },
  options: { dir?: string } = {},
): void {
  const dir = options.dir ?? getModelLoadSettingsDir();
  fs.mkdirSync(dir, { recursive: true });
  const ttlSeconds = typeof settings.ttlSeconds === 'number' && settings.ttlSeconds > 0
    ? settings.ttlSeconds
    : typeof settings.ttlMinutes === 'number' && settings.ttlMinutes > 0
      ? settings.ttlMinutes * 60
      : 1800;
  const payload: StoredModelLoadSettings = {
    providerId,
    modelId,
    ttlSeconds,
  };
  const filePath = modelLoadSettingsFilePath(providerId, modelId, dir);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}
