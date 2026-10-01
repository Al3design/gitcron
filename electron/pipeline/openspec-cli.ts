import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type {
  InstructionsOpenSpecResult,
  OpenSpecArtifactGraphResult,
  OpenSpecArtifactState,
  OpenSpecArtifactStatus,
  OpenSpecChangeStatus,
  OpenSpecContextBriefData,
  OpenSpecContextBriefResult,
  OpenSpecDoctorData,
  OpenSpecDoctorResult,
  OpenSpecGraphArtifact,
  OpenSpecInstructionsPayload,
  OpenSpecRunUpdateResult,
  OpenSpecValidationStatus,
} from '../../types/pipeline';
import { simpleGit, type SimpleGit } from 'simple-git';
import { withRepoLock } from '../git/repo-queue';
import {
  isValidOpenSpecChangeSlug as isValidChangeId,
  OPENSPEC_CHANGE_SLUG_PATTERN as CHANGE_ID_PATTERN,
} from '../../lib/openspec-slug';
import {
  readOpenSpecChangeMetadata,
  resolveOpenSpecExecutable,
  runAuthorizedOpenSpec,
  type AuthorizedOpenSpecRuntime,
} from './openspec-engine';

export { CHANGE_ID_PATTERN, isValidChangeId };

/**
 * Alfabeto de una herramienta de OpenSpec.
 *
 * En Windows el CLI corre con shell: true si es .cmd/.bat. El único valor variable
 * pasado a `init` queda acotado a letras, dígitos y guiones.
 */
export const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface InitOpenSpecResult {
  ok: boolean;
  /** Motivo real informado por el CLI. `null` sólo cuando inicializó bien. */
  error: string | null;
  /** El CLI no encontró ninguna herramienta y hay que elegir una. */
  needsTool: boolean;
}

export interface CliExecutionOptions {
  runtime?: AuthorizedOpenSpecRuntime | null;
  resolve?: () => AuthorizedOpenSpecRuntime | null;
}

function resolveRuntime(options?: CliExecutionOptions, repoPath?: string): AuthorizedOpenSpecRuntime | null {
  if (options?.runtime !== undefined) return options.runtime;
  if (options?.resolve) return options.resolve();
  return resolveOpenSpecExecutable({ repoPath });
}

/**
 * Inicializa OpenSpec en un repositorio.
 */
export async function initOpenSpecWithCli(
  repoPath: string,
  tools?: string[],
  options?: CliExecutionOptions,
): Promise<InitOpenSpecResult> {
  const requested = tools?.filter((tool) => TOOL_ID_PATTERN.test(tool)) ?? [];
  if (tools && requested.length !== tools.length) {
    return { ok: false, error: 'invalid-tool-id', needsTool: false };
  }

  const runtime = resolveRuntime(options, repoPath);
  if (!runtime) {
    return { ok: false, error: 'openspec-cli-not-found', needsTool: false };
  }

  const args = requested.length > 0 ? ['init', '--tools', requested.join(',')] : ['init'];

  try {
    await runAuthorizedOpenSpec(runtime, args, {
      cwd: repoPath,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, error: null, needsTool: false };
  } catch (error) {
    const detail = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const reason = [detail.stderr, detail.stdout, detail.message]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .find((part) => part.length > 0) ?? 'unknown';
    return { ok: false, error: reason, needsTool: /no tools detected/i.test(reason) };
  }
}

/**
 * Valida un change con `--strict`.
 */
export async function validateOpenSpecChangeWithCli(
  repoPath: string,
  changeId: string,
  options?: CliExecutionOptions,
): Promise<OpenSpecValidationStatus> {
  if (!isValidChangeId(changeId)) return 'unknown';

  const runtime = resolveRuntime(options, repoPath);
  if (!runtime) return 'unknown';

  try {
    await runAuthorizedOpenSpec(runtime, ['validate', changeId, '--strict', '--no-interactive'], {
      cwd: repoPath,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return 'passed';
  } catch (error) {
    return typeof (error as { code?: unknown })?.code === 'number' ? 'failed' : 'unknown';
  }
}

interface OpenSpecStatusCliArtifact {
  id?: unknown;
  status?: unknown;
  missingDeps?: unknown;
  requires?: unknown;
}

interface OpenSpecStatusCliOutput {
  artifacts?: unknown;
  applyRequires?: unknown;
  isComplete?: unknown;
  isPlanningComplete?: unknown;
  schemaName?: unknown;
  skip_specs?: unknown;
  skipSpecs?: unknown;
}

const KNOWN_ARTIFACT_STATES: ReadonlySet<string> = new Set(['blocked', 'ready', 'done', 'skipped']);

/**
 * Mapea el `status` del CLI al `state` del tipo propio.
 * Tolera elementos que no son objetos válidos (primitivos, null, arrays) descartándolos.
 * Preserva artefactos con estados futuros/desconocidos asignando `state: 'unknown'`
 * y `rawState`. Sólo descarta artefactos sin `id` válido.
 */
function mapCliArtifact(raw: unknown): OpenSpecArtifactStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const item = raw as OpenSpecStatusCliArtifact;
  if (typeof item.id !== 'string' || item.id.length === 0) return null;

  let state: OpenSpecArtifactState = 'unknown';
  let rawState: string | undefined = undefined;

  if (typeof item.status === 'string') {
    if (KNOWN_ARTIFACT_STATES.has(item.status)) {
      state = item.status as OpenSpecArtifactState;
    } else {
      state = 'unknown';
      rawState = item.status.slice(0, 100);
    }
  }

  const missingDeps = Array.isArray(item.missingDeps)
    ? item.missingDeps.filter((dep): dep is string => typeof dep === 'string')
    : [];

  const requires = Array.isArray(item.requires)
    ? item.requires.filter((dep): dep is string => typeof dep === 'string')
    : [];

  return { id: item.id, state, rawState, missingDeps, requires };
}

/**
 * Lee el grafo de artefactos de un change con `openspec status --json`.
 */
export async function statusOpenSpecChangeWithCli(
  repoPath: string,
  changeId: string,
  options?: CliExecutionOptions,
): Promise<OpenSpecChangeStatus> {
  const unavailable: OpenSpecChangeStatus = {
    available: false,
    artifacts: [],
    applyRequires: [],
    isComplete: false,
  };

  if (!isValidChangeId(changeId)) return unavailable;

  const runtime = resolveRuntime(options, repoPath);
  if (!runtime) return unavailable;

  try {
    const { stdout } = await runAuthorizedOpenSpec(runtime, ['status', '--change', changeId, '--json'], {
      cwd: repoPath,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const parsed = JSON.parse(stdout) as OpenSpecStatusCliOutput;
    const artifacts = Array.isArray(parsed.artifacts)
      ? parsed.artifacts
        .map((raw) => mapCliArtifact(raw))
        .filter((artifact): artifact is OpenSpecArtifactStatus => artifact !== null)
      : [];

    const applyRequires = Array.isArray(parsed.applyRequires)
      ? parsed.applyRequires.filter((req): req is string => typeof req === 'string')
      : [];

    // Precedencia explícita de `isPlanningComplete` (1.8) sobre alias legacy:
    const isPlanningComplete =
      typeof parsed.isPlanningComplete === 'boolean' ? parsed.isPlanningComplete : null;
    const isComplete = isPlanningComplete ?? (parsed.isComplete === true);

    // Metadata del change desde .openspec.yaml (evidencia independiente de status)
    const fileMeta = await readOpenSpecChangeMetadata(repoPath, changeId);

    // Combinar schemaName del status JSON o de .openspec.yaml
    const schemaName =
      (typeof parsed.schemaName === 'string' && parsed.schemaName.length > 0
        ? parsed.schemaName
        : fileMeta.schemaName) ?? null;

    // Precedencia de skipSpecs (contrato tri-estado: boolean | null):
    // 1. Campo top-level booleano del status JSON (skip_specs o skipSpecs) tiene máxima precedencia.
    // 2. Si no viene en status JSON, se utiliza fileMeta.skipSpecs desde .openspec.yaml (boolean o null).
    // 3. Si ambos están ausentes o son inválidos, resulta en null.
    let skipSpecs: boolean | null = null;
    if (typeof (parsed as any).skip_specs === 'boolean') {
      skipSpecs = (parsed as any).skip_specs;
    } else if (typeof (parsed as any).skipSpecs === 'boolean') {
      skipSpecs = (parsed as any).skipSpecs;
    } else {
      skipSpecs = fileMeta.skipSpecs;
    }

    return {
      available: true,
      artifacts,
      applyRequires,
      isPlanningComplete,
      schemaName,
      skipSpecs,
      isComplete,
    };
  } catch {
    return unavailable;
  }
}

/**
 * Determina si una ruta de archivo corresponde a las generadas o gestionadas por OpenSpec (Hallazgo 6).
 */
export function isOpenSpecManagedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const targetPrefixes = [
    'openspec/',
    '.agents/',
    '.claude/',
    '.codex/',
    '.opencode/',
    '.cursor/',
    '.github/',
    '.gitlab/',
    '.gemini/',
    '.factory/',
    '.windsurf/',
    '.cline/',
    '.devin/',
    '.continue/',
    '.amazonq/',
    '.copilot/',
    '.roocline/',
  ];
  if (targetPrefixes.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`))) {
    return true;
  }
  const rootFiles = ['.openspec.yaml', 'openspec.yaml', '.cursorrules', 'AGENTS.md'];
  const base = normalized.split('/').pop() ?? '';
  return rootFiles.includes(base);
}

export interface RunOpenSpecUpdateOptions {
  runtime?: AuthorizedOpenSpecRuntime | null;
  force?: boolean;
}

/**
 * Toma una foto de los archivos administrados por OpenSpec que difieren de HEAD
 * (`git status --porcelain -z --untracked-files=all`), con el hash de su contenido (Decisión 3).
 */
export async function captureOpenSpecManagedFilesSnapshot(
  repoPath: string,
  gitInstance?: SimpleGit,
): Promise<Map<string, string>> {
  const git = gitInstance ?? simpleGit(repoPath);
  const raw = await git.raw(['status', '--porcelain', '-z', '--untracked-files=all']);
  const snapshot = new Map<string, string>();
  if (!raw) return snapshot;

  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;

    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);

    // En rename ('R') o copy ('C'), la siguiente entrada de \0 es la ruta origen
    if (status.includes('R') || status.includes('C')) {
      i++;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    if (!isOpenSpecManagedPath(normalizedPath)) {
      continue;
    }

    const fullPath = path.join(repoPath, filePath);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        const content = await fs.readFile(fullPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        snapshot.set(normalizedPath, hash);
      } else {
        snapshot.set(normalizedPath, '__deleted__');
      }
    } catch {
      snapshot.set(normalizedPath, '__deleted__');
    }
  }

  return snapshot;
}

/**
 * Compara dos fotos y devuelve las rutas de archivos que cambiaron por la actualización:
 * nuevos después, presentes en las dos con otro hash, y presentes antes y no después (Decisión 3).
 */
export function diffOpenSpecSnapshots(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const changed = new Set<string>();

  for (const [filePath, hashAfter] of after) {
    if (!before.has(filePath)) {
      changed.add(filePath);
    } else if (before.get(filePath) !== hashAfter) {
      changed.add(filePath);
    }
  }

  for (const [filePath] of before) {
    if (!after.has(filePath)) {
      changed.add(filePath);
    }
  }

  return Array.from(changed).sort();
}

/**
 * Función común para capturar la foto posterior y calcular los archivos actualizados
 * comparándolos contra la foto previa, bajo el cerrojo del repositorio (Decisión 3).
 */
export async function computeUpdatedManagedFiles(
  repoPath: string,
  beforeSnapshot: Map<string, string>,
): Promise<string[]> {
  try {
    const afterSnapshot = await withRepoLock(repoPath, () =>
      captureOpenSpecManagedFilesSnapshot(repoPath),
    );
    return diffOpenSpecSnapshots(beforeSnapshot, afterSnapshot);
  } catch {
    return [];
  }
}

/**
 * Ejecuta openspec update en el repositorio autorizado con variables de entorno controladas.
 */
export async function runOpenSpecUpdate(
  repoPath: string,
  options?: RunOpenSpecUpdateOptions,
): Promise<OpenSpecRunUpdateResult> {
  const runtime = resolveRuntime(options, repoPath);
  if (!runtime) {
    return {
      success: false,
      status: 'error',
      filesUpdated: [],
      errors: ['openspec-cli-not-found'],
    };
  }

  // Foto previa antes de correr openspec update bajo cerrojo (Decisión 3)
  const beforeSnapshot = await withRepoLock(repoPath, () =>
    captureOpenSpecManagedFilesSnapshot(repoPath),
  ).catch(() => new Map<string, string>());

  const args = options?.force ? ['update', '--force'] : ['update'];

  try {
    const { stderr } = await runAuthorizedOpenSpec(runtime, args, {
      cwd: repoPath,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const filesUpdated = await computeUpdatedManagedFiles(repoPath, beforeSnapshot);

    return {
      success: true,
      status: 'completed',
      filesUpdated,
      errors: stderr ? [stderr.trim()].filter(Boolean) : [],
    };
  } catch (error) {
    const detail = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const reason = [detail.stderr, detail.stdout, detail.message]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .find((part) => part.length > 0) ?? 'update-failed';

    const filesUpdated = await computeUpdatedManagedFiles(repoPath, beforeSnapshot);

    const isIncomplete = filesUpdated.length > 0;
    return {
      success: false,
      status: isIncomplete ? 'update-incomplete' : 'error',
      filesUpdated,
      errors: [reason.slice(0, 4000)],
    };
  }
}

export interface InstructionsOpenSpecOptions extends CliExecutionOptions {
  changeId?: string | null;
  schema?: string | null;
}

/**
 * Obtiene las instrucciones enriquecidas del CLI con `openspec instructions <target> --json`.
 */
export async function instructionsOpenSpecWithCli(
  repoPath: string,
  target: string,
  options?: InstructionsOpenSpecOptions,
): Promise<InstructionsOpenSpecResult> {
  const runtime = resolveRuntime(options, repoPath);
  if (!runtime) return { ok: false, error: 'openspec-cli-not-found', data: null };

  const args = ['instructions', target];
  if (options?.changeId && isValidChangeId(options.changeId)) {
    args.push('--change', options.changeId);
  }
  if (options?.schema && typeof options.schema === 'string' && options.schema.trim().length > 0) {
    args.push('--schema', options.schema.trim());
  }
  args.push('--json');

  try {
    const { stdout } = await runAuthorizedOpenSpec(runtime, args, {
      cwd: repoPath,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as OpenSpecInstructionsPayload;
    if (Array.isArray(parsed.status) && parsed.status.some((s) => s.severity === 'error')) {
      const errorMsg = parsed.status.find((s) => s.severity === 'error')?.message ?? 'instructions-error';
      return { ok: false, error: errorMsg, data: parsed };
    }
    return { ok: true, error: null, data: parsed };
  } catch (error) {
    const detail = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    let reason = [detail.stderr, detail.stdout, detail.message]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .find((part) => part.length > 0) ?? 'instructions-failed';
    try {
      if (typeof detail.stdout === 'string') {
        const parsed = JSON.parse(detail.stdout) as OpenSpecInstructionsPayload;
        if (Array.isArray(parsed.status) && parsed.status.some((s) => s.severity === 'error')) {
          reason = parsed.status.find((s) => s.severity === 'error')?.message ?? reason;
          return { ok: false, error: reason, data: parsed };
        }
      }
    } catch {
      // ignore
    }
    return { ok: false, error: reason.slice(0, 4000), data: null };
  }
}

export interface ValidateArchivedResult {
  ok: boolean;
  error: string | null;
  output: string | null;
}

/**
 * Consulta el diagnóstico de salud de relaciones que el motor entrega
 * en formato legible por máquina (`openspec doctor --json`) (Tarea 3b.1).
 * Transporta su resultado como datos estructurados sin recomponerlo en prosa.
 */
export async function doctorOpenSpecWithCli(
  repoPath: string,
  options?: CliExecutionOptions,
): Promise<OpenSpecDoctorResult> {
  const runtime = resolveRuntime(options, repoPath);
  if (!runtime) {
    return {
      command: 'openspec doctor --json',
      ok: false,
      error: 'openspec-cli-not-found',
      data: null,
    };
  }

  try {
    const { stdout } = await runAuthorizedOpenSpec(runtime, ['doctor', '--json'], {
      cwd: repoPath,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as OpenSpecDoctorData;
    return {
      command: 'openspec doctor --json',
      ok: true,
      error: null,
      data: parsed,
    };
  } catch (error) {
    const detail = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    if (typeof detail.stdout === 'string') {
      try {
        const parsed = JSON.parse(detail.stdout) as OpenSpecDoctorData;
        if (parsed && typeof parsed === 'object') {
          return {
            command: 'openspec doctor --json',
            ok: false,
            error: null,
            data: parsed,
          };
        }
      } catch {
        // ignore
      }
    }
    const reason = [detail.stderr, detail.stdout, detail.message]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .find((part) => part.length > 0) ?? 'doctor-command-failed';
    return {
      command: 'openspec doctor --json',
      ok: false,
      error: reason.slice(0, 4000),
      data: null,
    };
  }
}

/**
 * Consulta el contexto de trabajo resuelto que el motor produce para agentes
 * (`openspec context --json`) (Tarea 3b.2).
 * Transporta su resultado como datos estructurados sin recomponerlo en prosa.
 */
export async function contextOpenSpecWithCli(
  repoPath: string,
  options?: CliExecutionOptions,
): Promise<OpenSpecContextBriefResult> {
  const runtime = resolveRuntime(options, repoPath);
  if (!runtime) {
    return {
      command: 'openspec context --json',
      ok: false,
      error: 'openspec-cli-not-found',
      data: null,
    };
  }

  try {
    const { stdout } = await runAuthorizedOpenSpec(runtime, ['context', '--json'], {
      cwd: repoPath,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as OpenSpecContextBriefData;
    return {
      command: 'openspec context --json',
      ok: true,
      error: null,
      data: parsed,
    };
  } catch (error) {
    const detail = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    if (typeof detail.stdout === 'string') {
      try {
        const parsed = JSON.parse(detail.stdout) as OpenSpecContextBriefData;
        if (parsed && typeof parsed === 'object') {
          return {
            command: 'openspec context --json',
            ok: false,
            error: null,
            data: parsed,
          };
        }
      } catch {
        // ignore
      }
    }
    const reason = [detail.stderr, detail.stdout, detail.message]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .find((part) => part.length > 0) ?? 'context-command-failed';
    return {
      command: 'openspec context --json',
      ok: false,
      error: reason.slice(0, 4000),
      data: null,
    };
  }
}

/**
 * Obtiene el grafo de artefactos de un cambio mediante status e instructions del CLI.
 */
export async function artifactGraphOpenSpecWithCli(
  repoPath: string,
  changeId: string,
  options?: CliExecutionOptions,
): Promise<OpenSpecArtifactGraphResult> {
  if (!isValidChangeId(changeId)) {
    return { ok: false, error: 'invalid-change-id' };
  }

  const runtime = resolveRuntime(options, repoPath);
  if (!runtime) {
    return { ok: false, error: 'openspec-cli-not-found' };
  }

  let parsedStatus: any;
  try {
    const { stdout } = await runAuthorizedOpenSpec(runtime, ['status', '--change', changeId, '--json'], {
      cwd: repoPath,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    parsedStatus = JSON.parse(stdout);
  } catch (error) {
    // Si status falla porque el cambio ya fue archivado, verificar si reside en archive/
    try {
      const archiveBase = path.join(repoPath, 'openspec', 'changes', 'archive');
      const entries = await fs.readdir(archiveBase);
      const isArchived = entries.some((entry) => entry === changeId || entry.endsWith(`-${changeId}`));
      if (isArchived) {
        return {
          ok: true,
          artifacts: [
            { id: 'proposal', status: 'done', requires: [] },
            { id: 'specs', status: 'done', requires: ['proposal'] },
            { id: 'design', status: 'done', requires: ['proposal'] },
            { id: 'tasks', status: 'done', requires: ['proposal'] },
          ],
        };
      }
    } catch {
      // Ignorar fallo de lectura de archive y propagar el error original del CLI
    }

    const detail = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const reason = [detail.stderr, detail.stdout, detail.message]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .find((part) => part.length > 0) ?? 'status-failed';
    return { ok: false, error: reason.slice(0, 4000) };
  }

  if (!parsedStatus || !Array.isArray(parsedStatus.artifacts)) {
    return { ok: false, error: 'invalid-status-output' };
  }

  const rawArtifacts = parsedStatus.artifacts.filter(
    (art: any) => art && typeof art === 'object' && typeof art.id === 'string' && art.id.length > 0,
  );

  const instructionResults = await Promise.all(
    rawArtifacts.map(async (art: any) => {
      const res = await instructionsOpenSpecWithCli(repoPath, art.id, {
        changeId,
        runtime,
      });
      return { art, res };
    }),
  );

  const firstError = instructionResults.find(({ res }) => !res.ok);
  if (firstError) {
    return { ok: false, error: firstError.res.error ?? 'instructions-failed' };
  }

  const artifacts: OpenSpecGraphArtifact[] = instructionResults.map(({ art, res }) => {
    const data = res.data;
    const item: OpenSpecGraphArtifact = {
      id: art.id,
      status: typeof art.status === 'string' ? art.status : 'unknown',
      requires: Array.isArray(art.requires)
        ? art.requires.filter((r: any): r is string => typeof r === 'string')
        : [],
    };

    const outPath =
      typeof data?.outputPath === 'string'
        ? data.outputPath
        : typeof art.outputPath === 'string'
          ? art.outputPath
          : undefined;
    if (outPath) item.outputPath = outPath;
    if (typeof data?.resolvedOutputPath === 'string') item.resolvedOutputPath = data.resolvedOutputPath;
    if (Array.isArray(data?.existingOutputPaths)) {
      item.existingOutputPaths = data.existingOutputPaths.filter((p: any): p is string => typeof p === 'string');
    }
    if (typeof data?.description === 'string') item.description = data.description;
    if (Array.isArray(data?.dependencies)) item.dependencies = data.dependencies;
    if (Array.isArray(data?.unlocks)) {
      item.unlocks = data.unlocks.filter((u: any): u is string => typeof u === 'string');
    }
    if (typeof data?.instruction === 'string') item.instruction = data.instruction;

    return item;
  });

  return {
    ok: true,
    artifacts,
    nextSteps: Array.isArray(parsedStatus.nextSteps)
      ? parsedStatus.nextSteps.filter((s: any): s is string => typeof s === 'string')
      : undefined,
    applyRequires: Array.isArray(parsedStatus.applyRequires)
      ? parsedStatus.applyRequires.filter((r: any): r is string => typeof r === 'string')
      : undefined,
  };
}
