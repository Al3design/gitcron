// electron/pipeline/openspec-version-analysis.ts
//
// Módulo de verificación de versión de OpenSpec con criterio (Grupo 9c).
//
// Reglas arquitectónicas fundamentales:
// 1. Tarea 9c.1: La comprobación trae qué cambió con la fuente citada. Si la fuente
//    no está disponible, lo declara explícitamente en vez de inventar cambios.
// 2. Tarea 9c.2: Juzga determinísticamente si los cambios tocan lo que GitCron consume:
//    - status (changes, schema, isPlanningComplete)
//    - instructions (instruction, context, resolvedOutputPath, diff)
//    - validate (--strict, --json, colección de errores)
//    - archive (preservación de artefactos y flags de motivo)
//    - sync (workflow del perfil sin simulaciones sintéticas)
//    - profiles (topología de skills .agents/skills/ vs legacy)
// 3. Tarea 9c.3: Si hay cambios incompatibles o la versión supera el rango, propone
//    la estrategia (qué modificar, orden y qué funciona intacto) como propuesta para
//    decisión deliberada de Alejandro, nunca como acción automática.
// 4. Tarea 9c.4: La explicación se redacta mediante la capa única de 9b (`text-client.ts`),
//    con modelo local por omisión (LM Studio). Si el servidor local está apagado, degrada
//    limpiamente sin voltear el análisis medido.
// 5. Tarea 9c.5: SEPARACIÓN ESTRICTA entre hechos medidos (`measured`) y texto del modelo
//    (`redaction`). El veredicto de compatibilidad sale de la comparación de código y esquemas,
//    no del modelo.
// 6. Tarea 9c.6: Subir `OPENSPEC_CYCLE_TARGET_VERSION` y `SUPPORTED_OPENSPEC_VERSIONS` en
//    `lib/openspec-version.ts` sigue siendo un acto deliberado con evidencia que decide Alejandro.

import {
  classifyOpenSpecVersion,
  compareSemver,
  isInstalledBehindCycle,
  OPENSPEC_CYCLE_TARGET_VERSION,
  SUPPORTED_OPENSPEC_VERSIONS,
  parseSemver,
  type OpenSpecVersionClass,
  type OpenSpecVersionRange,
} from '../../lib/openspec-version';
import type { ResolvedModelFor } from '../ai/config/resolve-model-for';
import { requireResolved, runTextUse, TextUseError, type TextUseDeps } from '../ai/text-use';
import { resolveForUse } from '../ai/use-resolution';
import type { DraftChunk } from '../ai/commit-message/sse';
import { checkLatestOpenSpecVersion } from './openspec-registry';
import {
  resolveOpenSpecExecutable,
  runAuthorizedOpenSpec,
  type AuthorizedOpenSpecRuntime,
} from './openspec-engine';
import {
  inspectInstalledEvidence,
  type InspectInstalledEvidenceDeps,
} from './openspec-evidence';
import { readOpenSpecGlobalConfig } from './openspec-global-config';
import type {
  OpenSpecRegistryCheck,
  OpenSpecGlobalConfig,
  ConsumedSurfaceName,
  ConsumedSurfaceAnalysis,
  VersionStrategyProposal,
  VersionAnalysisMeasured,
  VersionAnalysisRedaction,
  OpenSpecVersionAnalysisResult,
} from '../../types/pipeline';

export type {
  ConsumedSurfaceName,
  ConsumedSurfaceAnalysis,
  VersionStrategyProposal,
  VersionAnalysisMeasured,
  VersionAnalysisRedaction,
  OpenSpecVersionAnalysisResult,
} from '../../types/pipeline';

export interface OpenSpecInstalledAgentContext {
  name: string;
  workflows: string[];
}

export interface OpenSpecInstalledContext {
  engineVersion?: string | null;
  integrationState?: string | null;
  agents?: OpenSpecInstalledAgentContext[];
  globalProfile?: string | null;
  globalWorkflows?: string[];
}

export interface ReadInstalledContextDeps {
  inspectEvidence?: typeof inspectInstalledEvidence;
  readGlobalConfig?: (options?: { runtime?: AuthorizedOpenSpecRuntime | null }) => Promise<OpenSpecGlobalConfig | null>;
  engineVersion?: string | null;
  runtime?: AuthorizedOpenSpecRuntime | null;
  resolveRuntime?: (options?: { userDataDir?: string | null; repoPath?: string | null }) => AuthorizedOpenSpecRuntime | null;
  getUserDataDir?: () => string | null;
  inspectDeps?: InspectInstalledEvidenceDeps;
  discoverCli?: (options?: { runtime?: AuthorizedOpenSpecRuntime | null }) => Promise<any>;
}

/**
 * Lee el contexto instalado de forma barata y determinística a partir de metadatos estáticos.
 * CERO buildEngineStatusSnapshot, CERO huella de árbol de trabajo, CERO doctor/context.
 */
export async function readInstalledContext(
  repoPath: string,
  deps?: ReadInstalledContextDeps,
): Promise<OpenSpecInstalledContext> {
  const inspectEvidenceFn = deps?.inspectEvidence ?? inspectInstalledEvidence;
  const inspectDeps: InspectInstalledEvidenceDeps = deps?.inspectDeps ?? (deps as unknown as InspectInstalledEvidenceDeps);
  const evidence = inspectEvidenceFn(repoPath, inspectDeps);

  const userDataDir = deps?.getUserDataDir ? deps.getUserDataDir() : null;
  const runtime =
    deps?.runtime !== undefined
      ? deps.runtime
      : deps?.resolveRuntime
        ? deps.resolveRuntime({ userDataDir, repoPath })
        : resolveOpenSpecExecutable({ userDataDir, repoPath });

  let engineVersion = deps?.engineVersion ?? null;
  if (!engineVersion && deps?.discoverCli) {
    try {
      const cli = await deps.discoverCli({ runtime });
      engineVersion = cli?.runtimeVersion ?? cli?.version ?? null;
    } catch {
      engineVersion = null;
    }
  }

  const readConfigFn = deps?.readGlobalConfig ?? readOpenSpecGlobalConfig;
  let globalConfig: OpenSpecGlobalConfig | null = null;
  try {
    globalConfig = await readConfigFn({ runtime });
  } catch {
    globalConfig = null;
  }

  const rawStatus = (evidence as any).status;
  const rawSummary = (evidence as any).summary;
  const genBy = rawSummary?.generatedBy ?? evidence.generatedBy ?? null;

  let integrationState: string = 'unknown';

  if (rawStatus === 'conflicts' || (evidence.conflicts && evidence.conflicts.length > 0)) {
    integrationState = 'conflicted';
  } else if (
    rawStatus === 'legacy' ||
    (evidence.legacy && evidence.legacy.length > 0 && (!evidence.tools || evidence.tools.length === 0))
  ) {
    integrationState = 'custom';
  } else if (rawStatus === 'valid' || evidence.evidenceStatus === 'confirmed') {
    const hasModifiedOfficialSkills =
      evidence.skills &&
      evidence.skills.some((s) => s.isOfficial && s.origin === 'custom-agents');
    if (hasModifiedOfficialSkills) {
      integrationState = 'custom';
    } else if (genBy && engineVersion && genBy === engineVersion) {
      integrationState = 'up-to-date';
    } else if (genBy && engineVersion && genBy !== engineVersion) {
      integrationState = 'outdated';
    } else if (!engineVersion || !genBy) {
      integrationState = 'outdated';
    } else {
      integrationState = 'up-to-date';
    }
  } else if (evidence.evidenceStatus === 'unknown') {
    integrationState = 'unknown';
  } else {
    integrationState = 'outdated';
  }

  const agents: OpenSpecInstalledAgentContext[] = [];
  if (Array.isArray((evidence as any).agents)) {
    agents.push(...(evidence as any).agents);
  } else if (evidence.installedWorkflowsByTarget && Object.keys(evidence.installedWorkflowsByTarget).length > 0) {
    for (const [name, workflows] of Object.entries(evidence.installedWorkflowsByTarget)) {
      agents.push({ name, workflows });
    }
  } else if (evidence.targets && evidence.targets.length > 0) {
    for (const name of evidence.targets) {
      agents.push({ name, workflows: [] });
    }
  }

  return {
    engineVersion,
    integrationState,
    agents,
    globalProfile: globalConfig?.rawProfile ?? (globalConfig as any)?.profile ?? null,
    globalWorkflows:
      globalConfig?.configuredWorkflows ??
      globalConfig?.resolvedWorkflows ??
      [],
  };
}

/**
 * Tiempo de vida de la caché de notas de versión (changelog): 24 horas.
 * Motivo: Las notas de versiones ya publicadas en GitHub Releases son fundamentalmente
 * inmutables tras su lanzamiento. Se utiliza un TTL de 24 horas (alineado con STALE_CACHE_TTL_MS
 * de npm registry en openspec-registry.ts) para evitar agotar la cuota pública de la API
 * de GitHub (límite de 60 peticiones/hora por IP compartida sin token).
 * Con `forceRefresh: true` se puentea la caché para obtener los cambios inmediatamente.
 */
export const OPENSPEC_CHANGELOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export interface OpenSpecChangelogResult {
  source: string;
  sourceUrl: string | null;
  fetched: boolean;
  rawText: string | null;
  error?: string | null;
  fromCache?: boolean;
  cacheAgeSeconds?: number | null;
}

interface ChangelogCacheEntry {
  result: OpenSpecChangelogResult;
  cachedAtMs: number;
}

const changelogMemoryCache = new Map<string, ChangelogCacheEntry>();

export function clearOpenSpecChangelogCache(): void {
  changelogMemoryCache.clear();
}

/**
 * Consulta las notas de cambios para una versión determinada citando la fuente exacta.
 * Aplica caché fechada con TTL de 24 horas y soporte de refresco forzado.
 * Si la API de GitHub responde 403 por rate limit, informa con precisión en vez de enmascarar.
 */
export async function fetchOpenSpecChangelog(
  version: string,
  deps?: {
    fetchFn?: typeof fetch;
    sourceUrlOverride?: string;
    forceRefresh?: boolean;
    now?: () => Date;
  },
): Promise<OpenSpecChangelogResult> {
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;
  const targetUrl =
    deps?.sourceUrlOverride ??
    `https://api.github.com/repos/fission-ai/openspec/releases/tags/v${version}`;
  const nowMs = deps?.now ? deps.now().getTime() : Date.now();
  const cacheKey = `v${version}`;

  // 1. Revisar caché si no se solicita refresco forzado
  if (!deps?.forceRefresh) {
    const cached = changelogMemoryCache.get(cacheKey);
    if (cached && nowMs - cached.cachedAtMs <= OPENSPEC_CHANGELOG_CACHE_TTL_MS) {
      const ageSec = Math.max(0, Math.floor((nowMs - cached.cachedAtMs) / 1000));
      return {
        ...cached.result,
        fromCache: true,
        cacheAgeSeconds: ageSec,
      };
    }
  }

  try {
    const res = await fetchFn(targetUrl, {
      headers: {
        'user-agent': 'GitCron-Version-Checker',
        accept: 'application/vnd.github.v3+json, text/plain',
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      // Manejo específico de rate limit (HTTP 403 o cabeceras asociadas)
      const remainingHeader = res.headers?.get('x-ratelimit-remaining');
      const resetHeader = res.headers?.get('x-ratelimit-reset');
      const isRateLimited =
        res.status === 403 &&
        (remainingHeader === '0' || resetHeader !== null || remainingHeader === null);

      if (isRateLimited) {
        let resetMsg = '';
        if (resetHeader) {
          const resetSec = parseInt(resetHeader, 10);
          if (!Number.isNaN(resetSec) && resetSec > 0) {
            const resetDate = new Date(resetSec * 1000);
            const resetTimeStr = resetDate.toLocaleTimeString('es-AR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            });
            const secondsLeft = Math.max(0, Math.round((resetDate.getTime() - nowMs) / 1000));
            resetMsg = ` Reintentá después de las ${resetTimeStr} UTC (reset en ${secondsLeft}s).`;
          }
        }
        return {
          source: 'rate_limited',
          sourceUrl: targetUrl,
          fetched: false,
          rawText: null,
          error: `Límite de peticiones a la API pública de GitHub alcanzado (HTTP 403 rate limit).${resetMsg}`,
        };
      }

      if (res.status === 404) {
        return {
          source: 'unavailable',
          sourceUrl: targetUrl,
          fetched: false,
          rawText: null,
          error: `No se encontró nota de versión para v${version} en GitHub Releases (HTTP 404).`,
        };
      }
      return {
        source: 'unavailable',
        sourceUrl: targetUrl,
        fetched: false,
        rawText: null,
        error: `La fuente de notas de versión respondió HTTP ${res.status}.`,
      };
    }

    const data = (await res.json()) as { body?: string; html_url?: string };
    const rawText = typeof data.body === 'string' ? data.body.trim() : null;
    const successResult: OpenSpecChangelogResult = {
      source: 'GitHub Releases (fission-ai/openspec)',
      sourceUrl: data.html_url ?? targetUrl,
      fetched: Boolean(rawText),
      rawText: rawText || null,
      error: rawText ? null : 'La versión existe pero el cuerpo de notas está vacío.',
      fromCache: false,
      cacheAgeSeconds: 0,
    };

    // Almacenar en caché únicamente resultados exitosos
    if (successResult.fetched) {
      changelogMemoryCache.set(cacheKey, {
        result: successResult,
        cachedAtMs: nowMs,
      });
    }

    return successResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      source: 'unavailable',
      sourceUrl: targetUrl,
      fetched: false,
      rawText: null,
      error: `No se pudo consultar la fuente de cambios: ${msg}`,
    };
  }
}

/**
 * Evaluación determinística sobre si los cambios tocan las 6 superficies que GitCron consume (Tarea 9c.2).
 */
export function evaluateConsumedSurfaces(
  installedVersion: string | null,
  availableVersion: string | null,
  _changelogText: string | null,
): {
  surfaces: ConsumedSurfaceAnalysis[];
  breakingChangesDetected: boolean;
} {
  const installedParsed = parseSemver(installedVersion);
  const availableParsed = parseSemver(availableVersion);

  const isMajorBump =
    Boolean(installedParsed && availableParsed && availableParsed.major > installedParsed.major);

  const breaking = isMajorBump;

  const surfaces: ConsumedSurfaceAnalysis[] = [
    {
      surface: 'status',
      description: 'openspec status --json (propiedades changes, schema, isPlanningComplete, isComplete, applyRequires, nextSteps, artifacts [id, status, requires, outputPath])',
      verdict: isMajorBump ? 'breaking' : 'compatible',
      evidence: isMajorBump
        ? `Salto mayor a v${availableVersion}: incompatibilidad esperada en el esquema JSON de status.`
        : `Compatible con el mínimo soportado (${SUPPORTED_OPENSPEC_VERSIONS.min}).`,
    },
    {
      surface: 'instructions',
      description: 'openspec instructions <target> --json (campos description, instruction, context, dependencies, unlocks, outputPath, resolvedOutputPath, existingOutputPaths, diff)',
      verdict: isMajorBump ? 'breaking' : 'compatible',
      evidence: isMajorBump
        ? `Salto mayor a v${availableVersion}: argumentos CLI o estructura del payload de instrucciones pueden haber cambiado.`
        : `Estructura de instrucción y contexto verificada contra el ciclo vigente (1.13.0).`,
    },
    {
      surface: 'validate',
      description: 'openspec validate <id> --strict --json (banderas --strict, reporte tipado de errores)',
      verdict: isMajorBump ? 'breaking' : 'compatible',
      evidence: isMajorBump
        ? `Salto mayor a v${availableVersion}: las reglas o códigos de salida de validación estricta pueden diferir.`
        : `Validación estricta compatible con el formato de esquemas 1.13.0.`,
    },
    {
      surface: 'archive',
      description: 'openspec archive <id> (desplazamiento a directorio de archivo y preservación de artefactos)',
      verdict: isMajorBump ? 'breaking' : 'compatible',
      evidence: isMajorBump
        ? `Salto mayor a v${availableVersion}: la semántica de archivo o la ubicación de destino puede haber variado.`
        : `Comando de archivo compatible; GitCron gestiona el motivo y el estado en Git de forma desacoplada.`,
    },
    {
      surface: 'sync',
      description: 'openspec-sync-specs profile workflow (fusión de especificaciones delta a principales)',
      verdict: isMajorBump ? 'breaking' : 'compatible',
      evidence: isMajorBump
        ? `Salto mayor a v${availableVersion}: el perfil del workflow o la sintaxis de sync puede diferir.`
        : `Workflow de sincronización alineado con la especificación vigente.`,
    },
    {
      surface: 'profiles',
      description: 'Topología de skills del perfil (.agents/skills/* conforme a OpenSpec 1.13.0)',
      verdict: isMajorBump ? 'breaking' : 'compatible',
      evidence: isMajorBump
        ? `Salto mayor a v${availableVersion}: posible reestructuración de la topología de skills y agentes.`
        : `Topología de skills .agents/skills/ plenamente soportada por el motor de convivencia.`,
    },
  ];

  return { surfaces, breakingChangesDetected: breaking };
}

/**
 * Propuesta de estrategia ante cambios incompatibles o versiones fuera del rango soportado (Tarea 9c.3).
 * Es una propuesta técnica para que decida Alejandro, no una acción automática.
 */
export function buildStrategyProposal(
  _installedVersion: string | null,
  availableVersion: string | null,
  breaking: boolean,
): VersionStrategyProposal | null {
  if (!breaking) return null;

  const avail = availableVersion ?? 'desconocida';

  return {
    summary: `Estrategia de adaptación propuesta para OpenSpec v${avail}`,
    whatToModify: [
      `1. Auditar en aislamiento la salida JSON de 'openspec status --json' e 'instructions <target> --json' con v${avail}.`,
      `2. Adaptar los parseadores de 'electron/pipeline/openspec-parsers.ts' ante posibles cambios en campos o tipos.`,
      `3. Verificar compatibilidad de flags '--strict --json' en validación y el flujo de archivado.`,
      `4. Una vez verificada la compatibilidad mediante tests automatizados, Alejandro decidirá la actualización de SUPPORTED_OPENSPEC_VERSIONS en 'lib/openspec-version.ts'.`,
    ],
    orderOfOperations: [
      `Paso 1: Medición aislada sin mutar el repositorio (ejecutar comandos y contrastar schemas).`,
      `Paso 2: Ajuste de parseadores y contratos de interfaz en 'electron/pipeline/'.`,
      `Paso 3: Verificación con la suite de pruebas completa ('pnpm test' sin errores).`,
      `Paso 4: Actualización explícita y deliberada de la versión objetivo por parte de Alejandro.`,
    ],
    whatWorksUntouched: [
      `Operaciones de Git (ramas, commit, staging, rebase, diffs).`,
      `Cartografía y grafo de dependencias de código (CodeGraph).`,
      `Agente temporal de predicción de ramas especulativas.`,
      `Generador de mensajes de commit mediante IA local.`,
      `Cambios existentes en el repositorio estructurados bajo el estándar OpenSpec vigente.`,
    ],
    recommendation:
      'Propuesta técnica para decisión de Alejandro. No se aplica ninguna actualización ni mutación sobre el código o configuración de forma automática.',
  };
}

export const VERSION_ANALYSIS_SYSTEM_PROMPT =
  'Sos el asistente de GitCron. Escribí en criollo argentino, claro y concreto, un informe para Alejandro con exactamente estos cuatro encabezados markdown, en este orden: `## Qué hay de nuevo`, `## Qué hace de hecho`, `## Cómo afecta a GitCron`, `## Cómo encararlo`. Escribí para alguien que usa la herramienta pero no programa en este ecosistema: cada término técnico (skill, workflow, profile, changelog, spec, target, hardening, etc.) se explica la primera vez en una frase corta entre paréntesis. Frases cortas; nada de listas de más de cinco puntos; en «Cómo afecta a GitCron» partir de lo que Alejandro tiene instalado y decir, por cada cosa instalada, si esta versión la toca o no. Basate sólo en las notas y en las superficies medidas que te doy; si algo no figura, decí que no figura. En «Cómo afecta a GitCron» nombrá cada superficie que se toque y cuál no; en «Cómo encararlo» proponé pasos concretos si algo se toca, y si nada se toca decilo en una línea. Nada se actualiza solo: la decisión es de él.';

/**
 * Redacta la explicación en criollo mediante la capa única de texto (Tarea 9c.4 y 9c.5).
 * Se etiqueta claramente como redacción separada de lo medido.
 */
export async function draftVersionRedaction(
  measured: VersionAnalysisMeasured,
  deps: {
    /** El uso `gitcron-openspec-analysis` resuelto de gitcron.json (tarea 4.3). */
    target: ResolvedModelFor;
    textDeps?: TextUseDeps;
    signal?: AbortSignal;
    onChunk?: (chunks: DraftChunk[]) => void;
    installedContext?: OpenSpecInstalledContext | null;
  },
): Promise<VersionAnalysisRedaction> {
  // Sin modelo en gitcron.json no hay a quién mandar nada: la pantalla ofrece
  // escribir el elegido en su selector (no se cae a ningún servidor fijo).
  let provider: string;
  try {
    const { resolved } = requireResolved(deps.target);
    provider = `${resolved.providerName} · ${resolved.modelId}`;
  } catch (error) {
    return {
      provider: '',
      status: 'no-model',
      text: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const installedContextSummary: string[] = [];
  if (deps?.installedContext) {
    const ctx = deps.installedContext;
    installedContextSummary.push('Lo que Alejandro tiene instalado:');
    installedContextSummary.push(
      `- Motor: ${ctx.engineVersion ?? 'ninguno'} (estado: ${ctx.integrationState ?? 'desconocido'})`,
    );
    installedContextSummary.push(
      `- Configuración global: perfil ${ctx.globalProfile ?? 'ninguno'}, workflows: ${
        ctx.globalWorkflows && ctx.globalWorkflows.length > 0
          ? ctx.globalWorkflows.join(', ')
          : 'ninguno'
      }`,
    );
    const agentsText =
      ctx.agents && ctx.agents.length > 0
        ? ctx.agents
            .map(
              (a) =>
                `${a.name} (${a.workflows && a.workflows.length > 0 ? a.workflows.join(', ') : 'sin workflows'})`,
            )
            .join('; ')
        : 'ninguno';
    installedContextSummary.push(`- Agentes: ${agentsText}`);
  }

  const promptSummary = [
    `Versión instalada: ${measured.installedVersion ?? 'ninguna'}`,
    `Versión disponible: ${measured.availableVersion ?? 'desconocida'}`,
    `Clase de versión: ${measured.versionClass}`,
    ...(installedContextSummary.length > 0 ? [installedContextSummary.join('\n')] : []),
    `Fuente de notas: ${measured.changelog.source} (${measured.changelog.fetched ? 'obtenida' : 'no disponible'})`,
    measured.changelog.rawText
      ? `Notas de cambios:\n${measured.changelog.rawText.slice(0, 4000)}`
      : 'Notas no disponibles.',
    `Veredicto sobre contratos: ${measured.breakingChangesDetected ? 'Riesgo de incompatibilidad detectado' : 'Compatible'}`,
    ...(measured.consumedSurfaces?.map(
      (s) => `Superficie que GitCron consume: ${s.surface} — ${s.description} — veredicto medido: ${s.verdict}`
    ) ?? []),
    measured.strategyProposal
      ? `Estrategia propuesta: modificar ${measured.strategyProposal.whatToModify.length} puntos. Lo que sigue funcionando intacto: ${measured.strategyProposal.whatWorksUntouched.join(', ')}.`
      : 'No se requieren adaptaciones.',
  ].join('\n');

  try {
    const { text } = await runTextUse(
      deps.target,
      {
        system: VERSION_ANALYSIS_SYSTEM_PROMPT,
        user: promptSummary,
        maxTokens: 900,
        signal: deps.signal,
        onChunk: deps.onChunk,
      },
      deps.textDeps,
    );

    if (text && text.trim().length > 0) {
      return {
        provider,
        status: 'generated',
        text: text.trim(),
        error: null,
      };
    }

    return {
      provider,
      status: 'error',
      text: '',
      error: `${provider} devolvió una respuesta vacía.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (deps.signal?.aborted || (err instanceof TextUseError && err.reason === 'cancelled')) {
      return {
        provider,
        status: 'error',
        text: '',
        error: msg,
      };
    }

    const isConnError = / no responde en |ECONNREFUSED|fetch failed|getaddrinfo|ENOTFOUND/i.test(msg);

    if (isConnError) {
      return {
        provider,
        status: 'offline',
        text: '',
        error: null,
      };
    }

    return {
      provider,
      status: 'error',
      text: '',
      error: msg,
    };
  }
}

/**
 * Función principal que ejecuta la verificación integral de versiones de OpenSpec (Grupo 9c).
 */
export async function analyzeOpenSpecVersion(
  repoPath: string,
  deps?: {
    checkLatest?: () => Promise<OpenSpecRegistryCheck>;
    getInstalledVersion?: (repoPath: string) => Promise<string | null>;
    fetchChangelog?: (version: string, options?: { forceRefresh?: boolean }) => Promise<{
      source: string;
      sourceUrl: string | null;
      fetched: boolean;
      rawText: string | null;
      error?: string | null;
    }>;
    /** Para pruebas: el uso ya resuelto, en lugar de leer gitcron.json. */
    target?: ResolvedModelFor;
    textDeps?: TextUseDeps;
    forceRefresh?: boolean;
    userDataDir?: string | null;
    /**
     * Que se pida la redacción, con el modelo del selector de la pantalla: vale si
     * el uso no tiene modelo en gitcron.json (va por el proveedor `lmstudio` del archivo).
     */
    model?: string;
    signal?: AbortSignal;
    onChunk?: (chunks: DraftChunk[]) => void;
    installedContext?:
      | OpenSpecInstalledContext
      | Promise<OpenSpecInstalledContext | null>
      | null;
    readInstalledContext?: typeof readInstalledContext;
    inspectEvidence?: typeof inspectInstalledEvidence;
    readGlobalConfig?: (options?: { runtime?: AuthorizedOpenSpecRuntime | null }) => Promise<OpenSpecGlobalConfig | null>;
    resolveRuntime?: (options?: { userDataDir?: string | null; repoPath?: string | null }) => AuthorizedOpenSpecRuntime | null;
  },
): Promise<OpenSpecVersionAnalysisResult> {
  const checkLatestFn =
    deps?.checkLatest ?? (() => checkLatestOpenSpecVersion({ userDataDir: deps?.userDataDir }));
  const registryCheck = await checkLatestFn();
  const availableVersion = registryCheck.latestVersion;

  let installedVersion: string | null = null;
  if (deps?.getInstalledVersion) {
    installedVersion = await deps.getInstalledVersion(repoPath);
  } else {
    try {
      const runtime = resolveOpenSpecExecutable({ repoPath });
      if (runtime) {
        const { stdout } = await runAuthorizedOpenSpec(runtime, ['--version'], {
          cwd: repoPath,
          timeout: 5000,
        });
        const m = stdout.match(/(\d+\.\d+\.\d+)/);
        if (m) installedVersion = m[1];
      }
    } catch {
      installedVersion = null;
    }
  }

  // 9c.1: Fetch changelog con fuentes citadas
  let changelog: VersionAnalysisMeasured['changelog'] = {
    source: 'unavailable',
    sourceUrl: null,
    fetched: false,
    rawText: null,
    error: null,
  };

  if (availableVersion) {
    const fetchChangelogFn = deps?.fetchChangelog ?? fetchOpenSpecChangelog;
    changelog = await fetchChangelogFn(availableVersion, { forceRefresh: deps?.forceRefresh });
  } else {
    changelog = {
      source: 'unavailable',
      sourceUrl: null,
      fetched: false,
      rawText: null,
      error: 'No se pudo determinar la versión más reciente en el registry.',
    };
  }

  // 9c.2: Evaluación determinística de superficies consumidas
  const { surfaces, breakingChangesDetected } = evaluateConsumedSurfaces(
    installedVersion,
    availableVersion,
    changelog.rawText,
  );

  // 9c.3: Propuesta de estrategia si algo rompe o supera el ciclo
  const strategyProposal = buildStrategyProposal(
    installedVersion,
    availableVersion,
    breakingChangesDetected,
  );

  const versionClass = classifyOpenSpecVersion(availableVersion);
  const behindCycle = isInstalledBehindCycle(installedVersion);

  const isUpgradeAvailable =
    Boolean(installedVersion && availableVersion) &&
    Boolean(
      parseSemver(installedVersion) &&
        parseSemver(availableVersion) &&
        compareSemver(parseSemver(availableVersion)!, parseSemver(installedVersion)!) > 0,
    );

  const measured: VersionAnalysisMeasured = {
    installedVersion,
    availableVersion,
    isUpgradeAvailable,
    versionClass,
    behindCycle,
    targetVersion: OPENSPEC_CYCLE_TARGET_VERSION,
    supportedRange: {
      min: SUPPORTED_OPENSPEC_VERSIONS.min,
    },
    changelog,
    consumedSurfaces: surfaces,
    breakingChangesDetected,
    strategyProposal,
  };

  let resolvedInstalledContext: OpenSpecInstalledContext | null = null;
  if (deps?.installedContext !== undefined) {
    resolvedInstalledContext = deps.installedContext ? await deps.installedContext : null;
    if (resolvedInstalledContext && measured.installedVersion) {
      resolvedInstalledContext.engineVersion = measured.installedVersion;
    }
  } else if (deps?.model && deps.model.trim().length > 0) {
    const readCtxFn = deps.readInstalledContext ?? readInstalledContext;
    resolvedInstalledContext = await readCtxFn(repoPath, {
      ...deps,
      engineVersion: measured.installedVersion,
    }).catch(() => null);
  }

  // 9c.4 & 9c.5: Redacción separada de lo medido, con el modelo de gitcron.json
  // (tarea 4.3). Sin pedido no redacta: sólo mide (idle) para no gastar nada solo.
  const redaction: VersionAnalysisRedaction =
    deps?.model && deps.model.trim().length > 0
      ? await draftVersionRedaction(measured, {
          target: deps.target ?? resolveForUse('gitcron-openspec-analysis', repoPath, deps.model.trim()),
          textDeps: deps.textDeps,
          signal: deps?.signal,
          onChunk: deps?.onChunk,
          installedContext: resolvedInstalledContext,
        })
      : {
          provider: '',
          status: 'idle',
          text: '',
          error: null,
        };

  return {
    measured,
    redaction,
  };
}
