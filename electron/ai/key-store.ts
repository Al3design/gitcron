// electron/ai/key-store.ts
// Multi-provider API-key vault. MAIN PROCESS ONLY.
//
// SECURITY (brief §0 / §6.5 / SECURITY.md):
//  - Keys encrypted with Electron safeStorage (DPAPI / Keychain / libsecret),
//    same mechanism as the GitHub token.
//  - One key per provider. Keys live and are used ONLY in main.
//  - The renderer NEVER receives a key. It can only ask "is there a key for X?"
//    (boolean) and submit a new key to be stored (one-way: in, encrypted, never out).
//  - getKey() is NOT exposed over IPC — it's internal, called only by the
//    provider adapters when assembling a request in main.
//  - OpenCode (local/gateway) may have NO key — callers must tolerate undefined.

import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { AIPredictionProvider } from '../../types/temporal-agent';

export const KNOWN_AI_KEY_PROVIDERS = [
  'claude',
  'openrouter',
  'openai',
  'gemini',
  'opencode',
  'unsloth',
] as const;

/**
 * Identificadores de proveedores con claves en el baúl seguro.
 * Desacoplado de AIPredictionProvider['id'] para admitir proveedores de texto
 * (LM Studio/local, OpenRouter, Unsloth Desktop, etc.) sin refactorizar el almacenamiento.
 */
export type AIKeyProviderId = (typeof KNOWN_AI_KEY_PROVIDERS)[number];

type ProviderId = AIKeyProviderId;

const SECRET_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export function validateProviderId(provider: unknown): asserts provider is AIKeyProviderId {
  if (typeof provider !== 'string' || !KNOWN_AI_KEY_PROVIDERS.includes(provider as any)) {
    throw new Error('INVALID_PROVIDER');
  }
}

export function validateSecretName(secretName: unknown): asserts secretName is string | undefined {
  if (secretName === undefined || secretName === null) {
    return;
  }
  if (typeof secretName !== 'string' || !SECRET_NAME_REGEX.test(secretName)) {
    throw new Error('INVALID_SECRET_NAME');
  }
}

export function validateKeyString(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 8192) {
    throw new Error('INVALID_KEY');
  }
}

interface KeyFile {
  // provider id or provider:secretName -> base64 of safeStorage-encrypted key bytes
  [storageKey: string]: string;
}

function keyFilePath(): string {
  return path.join(app.getPath('userData'), 'ai-keys.enc');
}

function readFile(): KeyFile {
  try {
    return JSON.parse(fs.readFileSync(keyFilePath(), 'utf8')) as KeyFile;
  } catch {
    return {};
  }
}

function writeFile(data: KeyFile): void {
  fs.writeFileSync(keyFilePath(), JSON.stringify(data), { mode: 0o600 });
}

/**
 * Compone la clave de almacenamiento interna en el baúl.
 * Valida provider y secretName estrictamente para evitar colisiones y nombres inválidos.
 * Si secretName está ausente, se indexa por provider directamente (compatibilidad hacia atrás).
 * Si secretName está presente, se indexa como `${provider}:${secretName}`.
 */
export function buildSecretKey(provider: ProviderId, secretName?: string): string {
  validateProviderId(provider);
  validateSecretName(secretName);
  const p = provider.trim();
  const s = secretName?.trim();
  return s ? `${p}:${s}` : p;
}

/** Store/replace a provider key or named secret (encrypted at rest). One-way from the renderer's view. */
export function setKey(provider: ProviderId, key: string, secretName?: string): void {
  validateProviderId(provider);
  validateSecretName(secretName);
  validateKeyString(key);
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption unavailable; refusing to store key in plaintext');
  }
  const data = readFile();
  const targetKey = buildSecretKey(provider, secretName);
  data[targetKey] = safeStorage.encryptString(key).toString('base64');
  writeFile(data);
}

/** INTERNAL ONLY — never expose over IPC. Used by adapters inside main. */
export function getKey(provider: ProviderId, secretName?: string): string | undefined {
  const data = readFile();
  const targetKey = buildSecretKey(provider, secretName);
  const enc = data[targetKey];
  if (!enc) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return undefined;
  }
}

/** Safe to expose: tells the renderer only whether a key exists. */
export function hasKey(provider: ProviderId, secretName?: string): boolean {
  const targetKey = buildSecretKey(provider, secretName);
  return Boolean(readFile()[targetKey]);
}

/**
 * Elimina una clave o secreto nombrado del baúl.
 * Si se especifica secretName, elimina sólo ese secreto nombrado.
 * Si no se especifica secretName, elimina la clave principal del proveedor y todos sus secretos nombrados (`${provider}:*`).
 */
export function removeKey(provider: ProviderId, secretName?: string): void {
  validateProviderId(provider);
  validateSecretName(secretName);
  const data = readFile();
  if (secretName && secretName.trim()) {
    delete data[buildSecretKey(provider, secretName)];
  } else {
    const cleanProvider = provider.trim();
    const prefix = `${cleanProvider}:`;
    delete data[cleanProvider];
    for (const k of Object.keys(data)) {
      if (k.startsWith(prefix)) {
        delete data[k];
      }
    }
  }
  writeFile(data);
}

/**
 * Safe-to-expose stable identifier of WHICH key is stored — NOT any part of the
 * secret. We hash the full key with SHA-256 and return only the first 8 hex
 * chars.
 */
export function getKeyFingerprint(provider: ProviderId, secretName?: string): string | null {
  const key = getKey(provider, secretName);
  if (!key) return null;
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

// ─── Variables guardadas para `{env:NOMBRE}` (modelos-en-casa D5, tarea 3.2) ───
//
// `gitcron.json` referencia los secretos con `{env:NOMBRE}`, como OpenCode. Si la
// variable no está en el sistema, se busca acá: la persona la guardó desde GitCron,
// cifrada igual que las claves. Mismo contrato que las claves: el renderer puede
// preguntar si existe, guardarla y borrarla; el valor no sale nunca del proceso
// principal. Van en su propio espacio (`env:<NOMBRE>`) porque no son de un
// proveedor: una misma variable puede usarla más de uno.

const ENV_VAR_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function validateEnvVarName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !ENV_VAR_NAME_REGEX.test(name)) {
    throw new Error('INVALID_ENV_VAR_NAME');
  }
}

const envStorageKey = (name: string) => `env:${name}`;

/**
 * Las claves que GitCron ya guardaba por proveedor se ven también como variables
 * (D5): un `gitcron.json` que dice `{env:OPENROUTER_API_KEY}` usa la clave de
 * OpenRouter que la persona ya cargó, sin tener que volver a escribirla.
 */
export const LEGACY_ENV_ALIASES: Readonly<Record<string, AIKeyProviderId>> = {
  OPENROUTER_API_KEY: 'openrouter',
  ANTHROPIC_API_KEY: 'claude',
};

/** Guarda o reemplaza una variable (cifrada). De ida, desde la vista del renderer. */
export function setEnvVar(name: string, value: string): void {
  validateEnvVarName(name);
  validateKeyString(value);
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption unavailable; refusing to store key in plaintext');
  }
  const data = readFile();
  data[envStorageKey(name)] = safeStorage.encryptString(value).toString('base64');
  writeFile(data);
}

/** SÓLO INTERNO — nunca por IPC. Lo usa la resolución de `{env:}` en main. */
export function getStoredEnvVar(name: string): string | undefined {
  if (!ENV_VAR_NAME_REGEX.test(name)) return undefined;
  const enc = readFile()[envStorageKey(name)];
  if (enc) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return undefined;
    }
  }
  const alias = LEGACY_ENV_ALIASES[name];
  return alias ? getKey(alias) : undefined;
}

/** Seguro de exponer: si la variable está guardada (propia o por alias de una clave vieja). */
export function hasStoredEnvVar(name: string): boolean {
  validateEnvVarName(name);
  if (readFile()[envStorageKey(name)]) return true;
  const alias = LEGACY_ENV_ALIASES[name];
  return alias ? hasKey(alias) : false;
}

/** Borra la variable guardada. No toca las claves de proveedor que hacen de alias. */
export function removeEnvVar(name: string): void {
  validateEnvVarName(name);
  const data = readFile();
  delete data[envStorageKey(name)];
  writeFile(data);
}

/**
 * Recupera las credenciales de Unsloth Desktop guardadas en el baúl seguro:
 * token del modelo, ID de cliente de Cloudflare Access y secreto de cliente de Cloudflare Access.
 */
export function getUnslothCredentials(): {
  apiKey?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
} {
  return {
    apiKey: getKey('unsloth') ?? getKey('unsloth', 'apiKey') ?? getKey('unsloth', 'token'),
    cfAccessClientId: getKey('unsloth', 'cf-client-id') ?? getKey('unsloth', 'cf-access-client-id'),
    cfAccessClientSecret:
      getKey('unsloth', 'cf-client-secret') ?? getKey('unsloth', 'cf-access-client-secret'),
  };
}
