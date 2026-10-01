import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { CheckRepoActions, simpleGit } from 'simple-git';
import { withRepoLock } from '../git/repo-queue';
import type {
  BranchDivergence,
  ChangeSelection,
  ChangeTimestamp,
  DecisionRequest,
  OpenSpecArchivedChangeEvidence,
  OpenSpecChangeEvidence,
  OpenSpecChangeStatus,
  OpenSpecDeltaSpec,
  OpenSpecSpecificationEvidence,
  OpenSpecToolEvidence,
  OpenSpecValidationStatus,
  PipelineDiagnostic,
  PipelineEvidence,
} from '../../types/pipeline';
import { readBranchDivergence } from './branch-divergence';
import { selectPipelineChange } from './change-selection';
import { parseAudit, parseMarkdownTasks } from './parsers';
import { statusOpenSpecChangeWithCli, validateOpenSpecChangeWithCli } from './openspec-cli';
import { isValidOpenSpecChangeSlug } from '../../lib/openspec-slug';
import { readOpenSpecChangeMetadata } from './openspec-engine';
import { resolveContainedRepoPath, safeListRepoDirectory, safeReadRepoFile } from './repo-paths';
import { buildFallbackToolReport, readEngineToolReport } from './openspec-engine-tools';
import type { OpenSpecToolReport } from '../../types/pipeline';

const execFileAsync = promisify(execFile);

export interface RepoEvidenceReaderDependencies {
  listOpenSpecChanges(repoPath: string): Promise<string[]>;
  currentBranch(repoPath: string): Promise<string>;
  mergedChanges(repoPath: string, candidates: string[]): Promise<string[]>;
  validateOpenSpecChange?(repoPath: string, changeId: string): Promise<OpenSpecValidationStatus>;
  /**
   * Grafo de artefactos del change (`openspec status --json`). Igual que
   * `validateOpenSpecChange` y `artifacts`, se invoca sólo para el cambio
   * seleccionado: el spawn del CLI cuesta y ningún consumidor lo mira en los
   * demás.
   */
  statusOpenSpecChange?(repoPath: string, changeId: string): Promise<OpenSpecChangeStatus>;
  /**
   * Marcas de creación y archivado de todos los cambios, resueltas juntas.
   *
   * Opcional: sin ella el snapshot simplemente no lleva marcas, que es el
   * comportamiento anterior. Un repositorio sin historia tampoco falla.
   */
  changeHistory?(repoPath: string): Promise<ChangeHistoryStamps>;
  /**
   * Fecha de creación del directorio de un cambio, para los que todavía no
   * tienen ningún commit. Es el único caso donde el disco decide.
   */
  changeDirCreatedAt?(repoPath: string, relative: string): Promise<string | null>;
  /**
   * Distancia entre la rama actual y la base local. Opcional: sin ella el
   * snapshot no la lleva, y la vista no afirma nada sobre la base.
   */
  branchDivergence?(repoPath: string): Promise<BranchDivergence>;
  now(): string;
}

export interface RepoEvidenceSnapshot {
  evidence: PipelineEvidence;
  selection: ChangeSelection;
}

function issue(code: string, message: string, sourceRef: string): PipelineDiagnostic {
  return { code, message, severity: 'warning', sourceRef };
}

/**
 * Cambios activos leídos del scaffold, sin subproceso.
 *
 * Antes esto invocaba `openspec list --json` con `execFile`. En Windows el CLI
 * se instala como `openspec.cmd`, que `execFile` no puede resolver (ENOENT), y
 * si se lo nombra con extensión Node lo rechaza por la mitigación de
 * CVE-2024-27980 (EINVAL) salvo que se habilite un shell. El resultado era que
 * el lector caía siempre en su `catch` y reportaba cero cambios activos, aunque
 * el scaffold existiera: los archivados aparecían —se leen del disco— y los
 * activos no.
 *
 * Leerlo del disco elimina la dependencia del PATH, del CLI instalado y de un
 * shell, y usa el mismo camino contenido que ya se usa para `archive`.
 */
export async function defaultListOpenSpecChanges(repoPath: string): Promise<string[]> {
  const entries = await safeListRepoDirectory(repoPath, 'openspec/changes');
  // `archive` es el contenedor de los cerrados, no un cambio.
  return entries.filter((entry) => entry !== 'archive');
}

async function defaultCurrentBranch(repoPath: string): Promise<string> {
  // Por la cola: el watcher relee mientras la persona commitea o archiva, y
  // esas lecturas también tocan el índice.
  return withRepoLock(repoPath, async () => {
    const git = simpleGit(repoPath, { timeout: { block: 10_000 } });
    if (!await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)) throw new Error('not-a-repo-root');
    return (await git.branchLocal()).current;
  });
}

async function defaultMergedChanges(repoPath: string, candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const messages = await withRepoLock(repoPath, () => (
    simpleGit(repoPath, { timeout: { block: 10_000 } }).raw(['log', '--merges', '--format=%B%x00', '-n', '200'])
  ));
  return candidates.filter((candidate) => messages.split('\0').some((message) => message.includes(candidate)));
}

async function defaultValidateOpenSpecChange(
  repoPath: string,
  changeId: string,
): Promise<OpenSpecValidationStatus> {
  return validateOpenSpecChangeWithCli(repoPath, changeId);
}

function archivedChangeId(entry: string): string | null {
  const match = /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(entry);
  return match?.[1] ?? null;
}

function archivedChange(entry: string): OpenSpecArchivedChangeEvidence | null {
  const match = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(entry);
  if (!match) return null;
  return {
    changeId: match[2],
    archivedAt: match[1],
    sourceRef: `openspec/changes/archive/${entry}`,
  };
}

/**
 * Estado de OpenSpec en el repositorio: si está, y qué herramientas lo tienen
 * configurado.
 *
 * Lee del disco y no del CLI porque no hay comando que informe esto: `openspec
 * init` lo sabe, pero lo aplica configurando, y correrlo para averiguar el
 * estado escribiría archivos.
 */
export async function readOpenSpecTooling(
  repoPath: string,
  options?: {
    toolReport?: OpenSpecToolReport | null;
    readToolReport?: typeof readEngineToolReport;
  },
): Promise<{
  present: boolean;
  tools: OpenSpecToolEvidence[];
}> {
  const present = (await safeListRepoDirectory(repoPath, 'openspec')).length > 0;
  const reportFn = options?.readToolReport ?? readEngineToolReport;
  let report = options?.toolReport;
  if (!report) {
    try {
      report = await reportFn({ repoPath });
    } catch {
      report = buildFallbackToolReport({ repoPath });
    }
  }

  const safeReport = report ?? buildFallbackToolReport({ repoPath });
  const tools: OpenSpecToolEvidence[] = safeReport.tools
    .filter((t) => t.available)
    .map((t) => ({
      toolId: t.id,
      label: t.label,
      directory: t.skillsDir ?? `.${t.id}`,
      configured: t.configured,
      configuredVia: t.configuredVia,
    }));

  return { present, tools };
}

/** Cuándo se creó y cuándo se archivó cada cambio, por identificador. */
export interface ChangeHistoryStamps {
  created: Map<string, string>;
  archived: Map<string, string>;
}

const CHANGES_PREFIX = 'openspec/changes/';
const ARCHIVE_PREFIX = `${CHANGES_PREFIX}archive/`;

/**
 * Marcas de creación y archivado de todos los cambios, en **una sola** pasada de
 * historia.
 *
 * Recorriendo de más viejo a más nuevo, la primera aparición de un archivo bajo
 * `openspec/changes/<slug>/` fecha la creación del cambio, y la primera bajo
 * `openspec/changes/archive/<fecha>-<slug>/` fecha su archivado.
 *
 * `--no-renames` es lo que hace que el archivado aparezca. Con la detección
 * activa, mover un cambio a `archive/` se reconoce como `R100` y
 * `--diff-filter=A` no cuenta un renombre como alta, así que la marca de
 * archivado salía vacía. Desactivándola, el movimiento se ve como el alta del
 * destino, que es justo lo que hace falta.
 *
 * Se resuelve todo junto y no con una consulta por cambio: son dos invocaciones
 * por cambio sobre decenas de archivados, contra una sola para el repositorio
 * entero.
 */
export function parseChangeHistory(raw: string): ChangeHistoryStamps {
  const created = new Map<string, string>();
  const archived = new Map<string, string>();
  let stamp: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('\0')) { stamp = line.slice(1); continue; }
    if (!stamp || !line.startsWith(CHANGES_PREFIX)) continue;
    if (line.startsWith(ARCHIVE_PREFIX)) {
      const [folder] = line.slice(ARCHIVE_PREFIX.length).split('/');
      const id = archivedChangeId(folder ?? '');
      if (id && !archived.has(id)) archived.set(id, stamp);
      continue;
    }
    const [id] = line.slice(CHANGES_PREFIX.length).split('/');
    if (id && !created.has(id)) created.set(id, stamp);
  }
  return { created, archived };
}

/**
 * Fecha de creación del directorio en disco.
 *
 * Sólo se usa para un cambio sin ningún commit. La marca no sobrevive al
 * archivado —el directorio bajo `archive/` se crea nuevo— ni a un clon, así que
 * no sirve como fuente general; para lo todavía no confirmado es lo único que
 * hay.
 */
async function defaultChangeDirCreatedAt(repoPath: string, relative: string): Promise<string | null> {
  try {
    const resolved = await resolveContainedRepoPath(repoPath, relative);
    const stats = await stat(resolved);
    return stats.birthtime.toISOString();
  } catch {
    return null;
  }
}

async function defaultChangeHistory(repoPath: string): Promise<ChangeHistoryStamps> {
  return withRepoLock(repoPath, async () => {
    const git = simpleGit(repoPath, { timeout: { block: 10_000 } });
    const raw = await git.raw([
      'log', '--diff-filter=A', '--no-renames', '--name-only', '--reverse',
      '--format=%x00%aI', '--', 'openspec/changes',
    ]);
    return parseChangeHistory(raw);
  });
}

function firstWhyParagraph(markdown: string): string | null {
  const section = /^## Why\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(markdown)?.[1] ?? '';
  const paragraph = section
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part.length > 0 && !part.startsWith('#'));
  return paragraph || null;
}

function countRequirements(markdown: string): number {
  return Array.from(markdown.matchAll(/^### Requirement:\s+.+$/gm)).length;
}

export class RepoEvidenceReader {
  constructor(private readonly dependencies: RepoEvidenceReaderDependencies = {
    listOpenSpecChanges: defaultListOpenSpecChanges,
    currentBranch: defaultCurrentBranch,
    mergedChanges: defaultMergedChanges,
    validateOpenSpecChange: defaultValidateOpenSpecChange,
    statusOpenSpecChange: statusOpenSpecChangeWithCli,
    changeHistory: defaultChangeHistory,
    changeDirCreatedAt: defaultChangeDirCreatedAt,
    branchDivergence: readBranchDivergence,
    now: () => new Date().toISOString(),
  }) {}

  /**
   * Cuándo se creó un cambio activo.
   *
   * El commit manda; el disco sólo aparece mientras no haya ninguno, y se
   * declara en el propio dato. Un cambio recién creado no está confirmado, así
   * que sin el respaldo la pantalla no mostraría nada justo cuando la marca es
   * más útil.
   */
  private async resolveCreatedAt(
    repoPath: string,
    changeId: string,
    changeRoot: string,
    history: ChangeHistoryStamps,
  ): Promise<ChangeTimestamp | null> {
    const committed = history.created.get(changeId);
    if (committed) return { at: committed, source: 'commit' };
    const onDisk = await this.dependencies.changeDirCreatedAt?.(repoPath, changeRoot) ?? null;
    return onDisk ? { at: onDisk, source: 'disk' } : null;
  }

  /**
   * Lee el `spec.md` de cada capacidad tocada por el cambio.
   *
   * Sólo corre para el cambio seleccionado, así que la cantidad de lecturas
   * está acotada por las capacidades de un único change. Una capacidad sin
   * `spec.md` conserva su nombre con contenido `null`: existe la carpeta y eso
   * es evidencia, aunque el archivo falte.
   */
  private async readDeltaSpecs(
    repoPath: string,
    changeRoot: string,
    capabilities: string[],
    diagnostics: PipelineDiagnostic[],
  ): Promise<OpenSpecDeltaSpec[]> {
    return Promise.all(capabilities.map(async (capability) => {
      const sourceRef = `${changeRoot}/specs/${capability}/spec.md`;
      const file = await safeReadRepoFile(repoPath, sourceRef);
      if (file.status !== 'missing') diagnostics.push(...file.diagnostics);
      return { capability, content: file.content, sourceRef };
    }));
  }

  async read(repoPath: string, repoId: string, selectedChangeId?: string | null): Promise<RepoEvidenceSnapshot> {
    const diagnostics: PipelineDiagnostic[] = [];
    let branch = '';
    try {
      branch = await this.dependencies.currentBranch(repoPath);
    } catch {
      diagnostics.push(issue('git.unavailable', 'No se pudo confirmar la branch del repositorio.', 'git'));
    }

    let activeChanges: string[] = [];
    try {
      activeChanges = await this.dependencies.listOpenSpecChanges(repoPath);
    } catch {
      diagnostics.push(issue('openspec.unavailable', 'OpenSpec no está disponible o el repositorio no tiene openspec/changes.', 'openspec'));
    }
    // La selección manual (del renderer) tiene precedencia sobre la automática
    // por rama. Sin ella, se conserva el comportamiento histórico: la rama
    // decide, y si no hay match el changeId queda null y ningún change
    // transporta contenido.
    const autoSelection = selectPipelineChange(branch, activeChanges);
    const manualValid = typeof selectedChangeId === 'string'
      && activeChanges.includes(selectedChangeId);
    const selection = manualValid
      ? { changeId: selectedChangeId as string, confidence: 'confirmed' as const, selectionRequired: false, reason: 'manual' as const }
      : autoSelection;

    const safeActiveChanges = activeChanges.filter((changeId) => isValidOpenSpecChangeSlug(changeId));
    // Una sola pasada de historia para todos los cambios, activos y archivados.
    // Si falla, el snapshot va sin marcas: no tenerlas degrada la pantalla, no
    // la rompe, y no justifica perder el resto de la evidencia.
    let history: ChangeHistoryStamps = { created: new Map(), archived: new Map() };
    try {
      history = await this.dependencies.changeHistory?.(repoPath) ?? history;
    } catch {
      diagnostics.push(issue('git.change-history-unavailable', 'No se pudo leer cuándo se crearon los cambios.', 'git'));
    }

    // Un fallo acá degrada la pantalla y no la rompe: sin este dato el panel
    // queda como estaba, que es preferible a perder el resto de la evidencia.
    let tooling: { present: boolean; tools: OpenSpecToolEvidence[] } = { present: false, tools: [] };
    try {
      tooling = await readOpenSpecTooling(repoPath);
    } catch {
      diagnostics.push(issue('openspec.tooling-unavailable', 'No se pudo leer qué herramientas usa el repositorio.', 'openspec'));
    }

    // No medirla no rompe nada: el snapshot va sin el dato y la vista no afirma
    // nada sobre la base. Decir cero sería afirmar que la rama está al día.
    let branchDivergence: BranchDivergence = { measured: false };
    try {
      branchDivergence = await this.dependencies.branchDivergence?.(repoPath) ?? branchDivergence;
    } catch {
      diagnostics.push(issue('git.branch-divergence-unavailable', 'No se pudo medir la distancia con la base.', 'git'));
    }
    const openSpecChanges: OpenSpecChangeEvidence[] = [];
    for (const changeId of safeActiveChanges) {
      const changeRoot = `openspec/changes/${changeId}`;
      const taskRef = `${changeRoot}/tasks.md`;
      const proposalRef = `${changeRoot}/proposal.md`;
      const designRef = `${changeRoot}/design.md`;
      // El trabajo caro se paga sólo por el cambio que la vista muestra.
      //
      // Validar con el CLI cuesta ~2,4 s por change (en Windows cada invocación
      // es `cmd.exe → node → openspec`), y el bucle es secuencial: con cuatro
      // changes activos eran ~9 s por refresco, y el watcher refresca en cada
      // guardado de archivo. Ningún consumidor lee `validation` de un change que
      // no sea el seleccionado, así que tres cuartos de ese costo no alimentaban
      // nada. Es el mismo criterio que ya regía para `artifacts`.
      const isSelected = changeId === selection.changeId;
      const [taskFile, proposalFile, designFile, deltaSpecs, fileMeta, validation, status] = await Promise.all([
        safeReadRepoFile(repoPath, taskRef),
        safeReadRepoFile(repoPath, proposalRef),
        safeReadRepoFile(repoPath, designRef),
        safeListRepoDirectory(repoPath, `${changeRoot}/specs`),
        readOpenSpecChangeMetadata(repoPath, changeId),
        // `unknown` no es un default optimista: es lo que el propio wrapper del
        // CLI devuelve cuando no pudo ejecutarse. No saber si un cambio es
        // válido no es lo mismo que saber que no lo es.
        isSelected
          ? this.dependencies.validateOpenSpecChange?.(repoPath, changeId) ?? Promise.resolve('unknown' as const)
          : Promise.resolve('unknown' as const),
        // El grafo de artefactos sigue el mismo criterio que `validate` y
        // `artifacts`: sólo para el seleccionado. Para los demás queda en
        // `null`, que es distinto de un grafo vacío o indisponible.
        isSelected
          ? this.dependencies.statusOpenSpecChange?.(repoPath, changeId) ?? Promise.resolve(null as OpenSpecChangeStatus | null)
          : Promise.resolve(null as OpenSpecChangeStatus | null),
      ]);
      if (taskFile.status !== 'missing') diagnostics.push(...taskFile.diagnostics);
      if (proposalFile.status !== 'missing') diagnostics.push(...proposalFile.diagnostics);
      if (designFile.status !== 'missing') diagnostics.push(...designFile.diagnostics);
      const effectiveSchemaName = status?.schemaName ?? fileMeta.schemaName;
      const effectiveSkipSpecs = status?.skipSpecs ?? fileMeta.skipSpecs;

      openSpecChanges.push({
        changeId,
        intent: proposalFile.content ? firstWhyParagraph(proposalFile.content) : null,
        tasks: taskFile.content ? parseMarkdownTasks(taskFile.content, taskRef) : [],
        proposalExists: proposalFile.content !== null,
        designExists: designFile.content !== null,
        specsCount: deltaSpecs.length,
        validation,
        schemaName: effectiveSchemaName,
        skipSpecs: effectiveSkipSpecs,
        // El markdown ya está leído: hasta ahora se descartaba después de
        // extraer el intent. Se conserva sólo para el cambio seleccionado.
        artifacts: isSelected
          ? {
            proposal: proposalFile.content,
            design: designFile.content,
            tasks: taskFile.content,
            specs: await this.readDeltaSpecs(repoPath, changeRoot, deltaSpecs, diagnostics),
          }
          : null,
        status: status ? { ...status, schemaName: effectiveSchemaName, skipSpecs: effectiveSkipSpecs } : null,
        // Git primero. El disco sólo cubre el cambio que todavía no se confirmó,
        // y va marcado como tal para que no se lea como una fecha confirmada.
        createdAt: await this.resolveCreatedAt(repoPath, changeId, changeRoot, history),
      });
    }

    const tasks = selection.changeId
      ? openSpecChanges.find((change) => change.changeId === selection.changeId)?.tasks ?? []
      : [];

    let reports: string[] = [];
    let archivedChanges: string[] = [];
    let openSpecArchivedChanges: OpenSpecArchivedChangeEvidence[] = [];
    const decisions: DecisionRequest[] = [];
    try {
      reports = (await safeListRepoDirectory(repoPath, 'docs/reports')).filter((name) => name.endsWith('.md')).map((name) => `docs/reports/${name}`);
      const archiveEntries = await safeListRepoDirectory(repoPath, 'openspec/changes/archive');
      archivedChanges = archiveEntries.map(archivedChangeId).filter((id): id is string => id !== null);
      openSpecArchivedChanges = archiveEntries
        .map(archivedChange)
        .filter((entry): entry is OpenSpecArchivedChangeEvidence => entry !== null)
        // La creación sigue siendo alcanzable después de archivar porque la
        // pasada de historia la fechó por su ruta original, que existió antes
        // del movimiento. El orden sigue saliendo de `archivedAt`, que es el día
        // del nombre de la carpeta y no cambia.
        .map((entry) => {
          const created = history.created.get(entry.changeId);
          const archivedOn = history.archived.get(entry.changeId);
          return {
            ...entry,
            createdAt: created ? { at: created, source: 'commit' as const } : null,
            archivedOn: archivedOn ? { at: archivedOn, source: 'commit' as const } : null,
          };
        })
        .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
      // El archivado seleccionado transporta sus artefactos: lo archivado es el
      // registro de lo que se hizo, y revisarlo no debería obligar a salir de la
      // aplicación. Acotado al seleccionado, como en los activos.
      const selectedArchived = openSpecArchivedChanges
        .find((entry) => entry.changeId === selectedChangeId);
      if (selectedArchived) {
        const root = selectedArchived.sourceRef;
        const [proposal, design, tasks, capabilities] = await Promise.all([
          safeReadRepoFile(repoPath, `${root}/proposal.md`),
          safeReadRepoFile(repoPath, `${root}/design.md`),
          safeReadRepoFile(repoPath, `${root}/tasks.md`),
          safeListRepoDirectory(repoPath, `${root}/specs`),
        ]);
        selectedArchived.artifacts = {
          proposal: proposal.content,
          design: design.content,
          tasks: tasks.content,
          specs: await this.readDeltaSpecs(repoPath, root, capabilities, diagnostics),
        };
      }
      for (const report of reports) {
        const file = await safeReadRepoFile(repoPath, report, { maxBytes: 512 * 1024 });
        if (file.content === null) continue;
        const audit = parseAudit(file.content, report);
        if (audit.verdict === 'rejected') {
          decisions.push({
            decisionId: createHash('sha256').update(`${repoId}\0audit-rejected\0${report}`).digest('hex'),
            repoId,
            changeId: selection.changeId,
            kind: 'audit-rejected',
            status: 'pending',
            title: 'Auditoría rechazada',
            summary: audit.findings.join('; ') || 'La auditoría requiere revisión humana.',
            risk: 'unknown',
            riskReason: null,
            provenance: 'repo',
            evidenceRefs: [report],
            requestedAt: this.dependencies.now(),
          });
        }
      }
    } catch {
      diagnostics.push(issue('filesystem.directory-unavailable', 'No se pudo listar una fuente local.', 'filesystem'));
    }

    let mergedChanges: string[] = [];
    try {
      mergedChanges = await this.dependencies.mergedChanges(repoPath, [...new Set([...activeChanges, ...archivedChanges])]);
    } catch {
      diagnostics.push(issue('git.merge-evidence-unavailable', 'No se pudo comprobar evidencia de merges.', 'git'));
    }

    const openSpecSpecifications: OpenSpecSpecificationEvidence[] = [];
    try {
      const specificationIds = await safeListRepoDirectory(repoPath, 'openspec/specs');
      for (const specificationId of specificationIds.filter((id) => /^[a-z0-9][a-z0-9-]*$/.test(id))) {
        const sourceRef = `openspec/specs/${specificationId}/spec.md`;
        const specFile = await safeReadRepoFile(repoPath, sourceRef);
        if (specFile.status !== 'missing') diagnostics.push(...specFile.diagnostics);
        openSpecSpecifications.push({
          specificationId,
          requirements: specFile.content === null ? null : countRequirements(specFile.content),
          sourceRef,
        });
      }
    } catch {
      diagnostics.push(issue('openspec.specifications-unavailable', 'No se pudieron listar las especificaciones OpenSpec.', 'openspec/specs'));
    }

    return {
      selection,
      evidence: {
        repoId,
        observedAt: this.dependencies.now(),
        tasks,
        reports,
        decisions,
        activeChanges,
        archivedChanges,
        mergedChanges,
        diagnostics,
        selection,
        openSpecChanges,
        openSpecArchivedChanges,
        openSpecSpecifications,
        openSpecPresent: tooling.present,
        openSpecTools: tooling.tools,
        branchDivergence,
      },
    };
  }
}

export interface RealGitInfo {
  branch: string | null;
  headCommit: string | null; // Full 40-char commit SHA
  isClean: boolean;
  workingTreeFingerprint: string;
}

/**
 * Obtiene la evidencia real del árbol de trabajo Git.
 * Satisface el Punto 3 de auditoría:
 * - Raíz canónica, branch real y HEAD completo de 40 caracteres (sin truncar a 12).
 * - Soporta .git dir, .git file (worktree), refs empaquetadas, detached HEAD, staged, untracked, eliminados y conflictos.
 * - Genera una huella SHA-256 determinista del working tree.
 * - Ante error de I/O o permisos devuelve status 'unknown:error' y NUNCA 'clean'.
 */
export async function getRealGitInfo(repoPath: string): Promise<RealGitInfo> {
  try {
    return await withRepoLock(repoPath, async () => {
      const git = simpleGit(repoPath);
      const [status, headCommit] = await Promise.all([
        git.status(),
        git.revparse(['HEAD']).catch(() => null),
      ]);

      const branch = status.current || null;
      const clean = status.isClean();
      const fullHead = typeof headCommit === 'string' && headCommit.trim() ? headCommit.trim() : null;

      const fileEntries = (
        await Promise.all(
          status.files.map(async (f) => {
            let meta = '';
            try {
              const fullPath = path.join(repoPath, f.path);
              const content = await readFile(fullPath);
              const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
              meta = `:${content.length}:${contentHash}`;
            } catch {
              meta = ':absent';
            }
            return `${f.path}:${f.index}:${f.working_dir}${meta}`;
          }),
        )
      )
        .sort()
        .join('\n');

      const rawFingerprint = `branch=${branch};head=${fullHead};clean=${clean};files=${fileEntries}`;
      const hash = createHash('sha256').update(rawFingerprint).digest('hex').slice(0, 16);

      return {
        branch,
        headCommit: fullHead,
        isClean: clean,
        workingTreeFingerprint: `${clean ? 'clean' : 'dirty'}:${status.files.length}:${hash}`,
      };
    });
  } catch {
    return {
      branch: null,
      headCommit: null,
      isClean: false,
      workingTreeFingerprint: 'unknown:error',
    };
  }
}
