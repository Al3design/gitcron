// electron/ai/config/opencode-models.ts
//
// Consulta y parseo de modelos conocidos por OpenCode para un repositorio (tarea 5.3, D8, D17).
//
// Se obtienen mediante:
//   opencode api model.list --param location[directory]=<repo>
//
// Seguridad e higiene de datos (D8):
// La respuesta de OpenCode incluye `headers` y `settings` con claves ya resueltas.
// Este módulo descarta inmediatamente todos esos campos y sólo extrae:
//   `providerId`, `id`, `name`, `variantIds`, `contextLimit`, `enabled`, `status`.
// Ninguna cabecera, clave ni credencial es guardada, registrada, enviada a la UI
// ni incluida en mensajes de error.

import { RuntimeProcessRunner } from '../../pipeline/runtime-adapters/process-runner';
import { ensureOpenCodeService } from './opencode-service';

export interface OpenCodeKnownModel {
  providerId: string;
  id: string;
  name: string;
  variantIds: string[];
  contextLimit: number | null;
  enabled: boolean;
  status: string;
}

export interface OpenCodeModelListResult {
  installed: boolean;
  models: OpenCodeKnownModel[];
  /**
   * Por qué no hay lista: `opencode_not_installed` o `opencode_api_failed` (no contestó, o
   * contestó algo que no es la lista). Una lista vacía sin error es «OpenCode no conoce
   * ninguno»; con error no se sabe, y la pantalla no debe decir que no lo conoce.
   */
  error?: 'opencode_not_installed' | 'opencode_api_failed';
}

/**
 * Parsea el JSON devuelto por `opencode api model.list` extrayendo sólo los campos seguros.
 * Descarta de raíz cualquier bloque `settings`, `headers` o datos de autenticación.
 * Devuelve `null` si lo recibido no tiene la forma de la lista (vacío, cortado, otra cosa).
 */
export function parseOpenCodeModelListJson(rawJson: string): OpenCodeKnownModel[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { data?: unknown }).data)) return null;
  const data = (parsed as { data: unknown[] }).data;

  const models: OpenCodeKnownModel[] = [];

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const providerId = typeof rec.providerID === 'string' ? rec.providerID : '';
    const id = typeof rec.id === 'string' ? rec.id : '';
    const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : id;
    const enabled = rec.enabled === true;
    const status = typeof rec.status === 'string' ? rec.status : '';

    // Extraer únicamente los IDs de las variantes
    const variantIds: string[] = [];
    if (Array.isArray(rec.variants)) {
      for (const v of rec.variants) {
        if (v && typeof v === 'object') {
          const vid = (v as Record<string, unknown>).id;
          if (typeof vid === 'string' && vid.trim()) {
            variantIds.push(vid.trim());
          }
        }
      }
    }

    // Extraer límite de contexto
    let contextLimit: number | null = null;
    if (rec.limit && typeof rec.limit === 'object') {
      const limitObj = rec.limit as Record<string, unknown>;
      if (typeof limitObj.context === 'number') {
        contextLimit = limitObj.context;
      }
    }

    if (providerId && id) {
      models.push({
        providerId,
        id,
        name,
        variantIds,
        contextLimit,
        enabled,
        status,
      });
    }
  }

  return models;
}

/**
 * Busca un modelo activo y habilitado en la lista de OpenCode.
 * (D8: `enabled: true` y `status: "active"`).
 */
export function findOpenCodeModel(
  models: OpenCodeKnownModel[],
  providerId: string,
  modelId: string,
): OpenCodeKnownModel | null {
  return (
    models.find(
      (m) => m.providerId === providerId && m.id === modelId && m.enabled && m.status === 'active',
    ) ?? null
  );
}

/**
 * Determina la variante a utilizar para OpenCode (D8, D17, Tanda 20 Decision 4):
 * 1. La variante explícita del uso (`variant` o `#variante` en el modelo).
 * 2. Si no hay, el nivel (`options.reasoning_effort`) si coincide con alguna declarada en OpenCode.
 * 3. Si no coincide o no hay, ninguna (null).
 */
export function resolveOpenCodeVariant(options: {
  explicitVariant?: string | null;
  effort?: string | null;
  declaredVariants?: string[];
}): string | null {
  if (options.explicitVariant && options.explicitVariant.trim()) {
    return options.explicitVariant.trim();
  }
  if (options.effort && options.declaredVariants?.includes(options.effort.trim())) {
    return options.effort.trim();
  }
  return null;
}

export interface FetchOpenCodeModelListOptions {
  /** Consultas en total si la lista viene vacía (por omisión 4). */
  attempts?: number;
  /** Pausa entre consultas, en milisegundos (por omisión 2000). */
  retryDelayMs?: number;
}

/**
 * Consulta la API de OpenCode para obtener los modelos disponibles en el repositorio.
 *
 * Medido el 2026-10-05 (OpenCode 2.0.20): la primera consulta de una carpeta que OpenCode
 * todavía no conocía devuelve `{"data":[]}` (una lista vacía válida, estado 0) y a los pocos
 * segundos trae todos. OpenCode siempre conoce cientos de modelos, así que una lista vacía
 * es «todavía no cargó», no «no conoce ninguno»: se reintenta, y si sigue vacía es un fallo
 * de la consulta (`opencode_api_failed`), nunca «el modelo no está».
 */
export async function fetchOpenCodeModelList(
  repoPath: string,
  runner: RuntimeProcessRunner = new RuntimeProcessRunner(),
  options: FetchOpenCodeModelListOptions = {},
): Promise<OpenCodeModelListResult> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const retryDelayMs = options.retryDelayMs ?? 2000;
  let last: OpenCodeModelListResult = { installed: true, models: [], error: 'opencode_api_failed' };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await queryOpenCodeModelList(repoPath, runner);
    // Sólo una lista vacía sin error se reintenta: un fallo real o una lista con modelos se devuelven ya.
    if (last.error || last.models.length > 0) return last;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return { installed: true, models: [], error: 'opencode_api_failed' };
}

async function queryOpenCodeModelList(repoPath: string, runner: RuntimeProcessRunner): Promise<OpenCodeModelListResult> {
  try {
    const result = await runner.run({
      executable: 'opencode',
      args: ['api', 'model.list', '--param', `location[directory]=${repoPath}`],
      cwd: repoPath,
      expectedCanonicalCwd: repoPath,
      timeoutMs: 15_000,
      maxStdoutBytes: 5 * 1024 * 1024,
    });

    if (result.exitCode !== 0 || result.timedOut) {
      return { installed: true, models: [], error: 'opencode_api_failed' };
    }

    const models = parseOpenCodeModelListJson(result.stdout.toString('utf8'));
    if (models === null) return { installed: true, models: [], error: 'opencode_api_failed' };
    return { installed: true, models };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.includes('was not found') || message.includes('unavailable');
    return {
      installed: !notFound,
      models: [],
      error: notFound ? 'opencode_not_installed' : 'opencode_api_failed',
    };
  }
}

export interface OpenCodeResolvedCredentials {
  apiKey?: string;
  headers?: Record<string, string>;
}

/**
 * Extrae las credenciales resueltas por OpenCode para un modelo específico (proceso principal únicamente).
 * NUNCA se envía al renderer, no se guarda y no se registra.
 */
export function extractOpenCodeModelCredentials(
  rawJson: string,
  providerId: string,
  modelId: string,
): OpenCodeResolvedCredentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { data?: unknown }).data)) return null;
  const data = (parsed as { data: unknown[] }).data;
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (rec.providerID === providerId && rec.id === modelId) {
      let apiKey: string | undefined;
      if (rec.settings && typeof rec.settings === 'object') {
        const settings = rec.settings as Record<string, unknown>;
        if (typeof settings.apiKey === 'string') apiKey = settings.apiKey;
      }
      let headers: Record<string, string> | undefined;
      if (rec.headers && typeof rec.headers === 'object' && !Array.isArray(rec.headers)) {
        headers = {};
        for (const [hk, hv] of Object.entries(rec.headers as Record<string, unknown>)) {
          if (typeof hv === 'string') headers[hk] = hv;
        }
      }
      return { apiKey, headers };
    }
  }
  return null;
}

/**
 * Consulta las credenciales que OpenCode va a mandar para un modelo específico (sólo proceso principal).
 */
export async function queryOpenCodeModelCredentials(
  repoPath: string,
  providerId: string,
  modelId: string,
  runner: RuntimeProcessRunner = new RuntimeProcessRunner(),
): Promise<OpenCodeResolvedCredentials | null> {
  await ensureOpenCodeService({ runner, cwd: repoPath });
  try {
    const result = await runner.run({
      executable: 'opencode',
      args: ['api', 'model.list', '--param', `location[directory]=${repoPath}`],
      cwd: repoPath,
      expectedCanonicalCwd: repoPath,
      timeoutMs: 15_000,
      maxStdoutBytes: 5 * 1024 * 1024,
    });
    if (result.exitCode !== 0 || result.timedOut) return null;
    return extractOpenCodeModelCredentials(result.stdout.toString('utf8'), providerId, modelId);
  } catch {
    return null;
  }
}
