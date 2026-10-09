export type EvidenceConfidence = 'confirmed' | 'inferred' | 'unknown';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface PipelineDiagnostic {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  sourceRef: string;
  line?: number;
}

export interface TaskEvidence {
  id: string;
  text: string;
  completed: boolean;
  line: number;
  sourceRef: string;
}

export type OpenSpecValidationStatus = 'passed' | 'failed' | 'unknown';

/**
 * Momento de un hito de un cambio, con la fuente de la que salió.
 *
 * `commit` es la fecha del commit que lo produjo; `disk` es la fecha de creación
 * del directorio, y sólo aparece mientras el cambio no esté confirmado.
 *
 * La fuente viaja con el dato en vez de deducirse porque las dos afirman cosas
 * distintas y quien lee tiene que poder distinguirlas: la de Git es reproducible
 * en cualquier clon, la del disco se pierde al archivar y al clonar. Además el
 * paso de una a otra es información: significa que el trabajo se confirmó.
 */
export interface ChangeTimestamp {
  at: string;
  source: 'commit' | 'disk';
}

/** Evidencia durable de un change activo, leída sólo desde el scaffold OpenSpec. */
export interface OpenSpecChangeEvidence {
  changeId: string;
  intent: string | null;
  tasks: TaskEvidence[];
  proposalExists: boolean;
  designExists: boolean;
  specsCount: number;
  validation: OpenSpecValidationStatus;
  /**
   * Markdown de los artefactos, para poder leerlos sin abrir el repositorio por
   * fuera de la aplicación.
   *
   * Se transporta **sólo para el cambio seleccionado**: el contenido completo de
   * cada change activo haría crecer el snapshot sin que nadie lo mire. `null`
   * distingue "no existe" de "existe y está vacío"; los demás cambios lo dejan
   * en `null` aunque el archivo exista, y para eso está `proposalExists`.
   */
  artifacts: OpenSpecChangeArtifacts | null;
  /**
   * Grafo de artefactos con estados `blocked` / `ready` / `done`, leído del
   * CLI. Opcional para no romper snapshots viejos; `null` para los cambios no
   * seleccionados, porque la lectura cuesta y ningún consumidor la mira en
   * ellos (mismo criterio que `artifacts` y `validation`).
   */
  status?: OpenSpecChangeStatus | null;
  /** Schema del change, leído de su .openspec.yaml si existe. */
  schemaName?: string | null;
  /**
   * Estado de skip_specs:
   * - true: metadata válida y skip_specs: true;
   * - false: metadata válida y ausente o false;
   * - null: metadata ausente, inválida o no leíble.
   */
  skipSpecs?: boolean | null;
  /**
   * Cuándo se creó el cambio. Opcional para no romper snapshots viejos; `null`
   * cuando no se pudo determinar ni por Git ni por disco.
   */
  createdAt?: ChangeTimestamp | null;
  /**
   * Último commit que tocó este cambio (sus archivos de OpenSpec o su rama).
   */
  lastCommit?: ChangeLastCommit | null;
}

export interface ChangeLastCommit {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
}

export interface ChangeCommitsEvidence {
  recentCommits: ChangeLastCommit[];
  commitsAfterLastTask: ChangeLastCommit[];
}

export interface OpenSpecChangeArtifacts {
  proposal: string | null;
  design: string | null;
  tasks: string | null;
  /** Un spec delta por capacidad tocada, en el orden en que están en disco. */
  specs: OpenSpecDeltaSpec[];
}

export interface OpenSpecDeltaSpec {
  capability: string;
  content: string | null;
  sourceRef: string;
}

/**
 * Estado de un artefacto dentro del grafo de dependencias de OpenSpec.
 *
 * `state` es el estado del nodo, no del change: `blocked` cuando le faltan
 * dependencias, `ready` cuando sus dependencias están `done`, y `done` cuando
 * el archivo existe en disco. Es el grafo real que el CLI devuelve, no una
 * derivación propia.
 */
export type OpenSpecArtifactState = 'blocked' | 'ready' | 'done' | 'skipped' | 'unknown';

export interface OpenSpecArtifactStatus {
  id: string;
  state: OpenSpecArtifactState;
  /** Estado crudo devuelto por el CLI cuando no coincide con ninguno conocido. */
  rawState?: string;
  /** Artefactos de los que depende y que todavía no están `done`. */
  missingDeps: string[];
  /**
   * Dependencias declaradas del artefacto (1.7+). A diferencia de `missingDeps`,
   * lista todas las que el grafo declara, estén o no `done`, para poder dibujar
   * el grafo real y no sólo lo que falta. Opcional: ausente en versiones <1.7.
   */
  requires?: string[];
}

/**
 * Grafo de artefactos de un change, leído del CLI (`openspec status`).
 *
 * `available` distingue "el CLI no pudo ejecutarse" de "el grafo está vacío":
 * no poder leer el estado real no es lo mismo que saber que no hay nada. En
 * ese caso `artifacts` va vacío y `isComplete` en `false`, y el consumidor
 * sabe que no hay grafo para mostrar en vez de leerlo como "todo listo".
 */
export interface OpenSpecChangeStatus {
  available: boolean;
  artifacts: OpenSpecArtifactStatus[];
  /** Artefactos que `apply` exige que estén `done`. */
  applyRequires: string[];
  /**
   * Planificación completa. OpenSpec 1.8 introdujo `isPlanningComplete` como el
   * estado real de planificación y dejó `isComplete` como alias de compatibilidad;
   * este campo transporte el valor crudo de 1.8 cuando viene, y `null` si no.
   * `isComplete` sigue siendo el campo a consumir: se calcula a partir de
   * cualquiera de los dos para mantener la compatibilidad con 1.5.
   */
  isPlanningComplete?: boolean | null;
  /**
   * Schema del change (hoy `spec-driven`). No asumir que siempre es ése: el
   * panel debe poder dibujar artefactos de cualquier schema. Opcional porque el
   * CLI antiguo no lo trae.
   */
  schemaName?: string | null;
  /** Evidencia de skip_specs combinada para el change. */
  skipSpecs?: boolean | null;
  isComplete: boolean;
}

export interface OpenSpecArchivedChangeEvidence {
  changeId: string;
  /**
   * Fecha del nombre de la carpeta, `YYYY-MM-DD` y sin hora. Ordena la lista de
   * archivados, así que no se reemplaza por la marca con hora: son dos datos con
   * usos distintos.
   */
  archivedAt: string | null;
  sourceRef: string;
  /** Cuándo se creó el cambio, alcanzable aunque hoy esté archivado. */
  createdAt?: ChangeTimestamp | null;
  /** Cuándo se archivó, con hora. Distinto de `archivedAt`, que sólo trae el día. */
  archivedOn?: ChangeTimestamp | null;
  /**
   * Contenido de los artefactos, sólo para el archivado seleccionado.
   *
   * Lo que quedó archivado es el registro de lo que se hizo —incluida la firma
   * humana—, y revisarlo obligaba a salir de la aplicación. Viaja acotado al
   * seleccionado por el mismo motivo que en los activos: transportar el markdown
   * de todos haría crecer el snapshot sin que nadie lo mire.
   */
  artifacts?: OpenSpecChangeArtifacts | null;
  /** Último commit que tocó este cambio archivado. */
  lastCommit?: ChangeLastCommit | null;
}

/**
 * Una herramienta presente en el repositorio y si tiene OpenSpec configurado.
 *
 * `configured` en `false` es el estado que este dato existe para mostrar: la
 * herramienta se usa en el repositorio pero no tiene sus skills instaladas, así
 * que su ejecutor no sabe que el canal de instrucciones existe. Pasó con
 * Antigravity en `odontoPau` y nadie lo vio hasta que un artefacto salió mal.
 */
export interface OpenSpecToolEvidence {
  toolId: string;
  label: string;
  directory: string;
  configured: boolean;
  configuredVia?: 'shared-folder';
}

export interface OpenSpecSpecificationEvidence {
  specificationId: string;
  requirements: number | null;
  sourceRef: string;
}

export interface AuditEvidence {
  verdict: 'approved' | 'rejected' | 'unknown';
  findings: string[];
  sourceRef: string;
  confidence: EvidenceConfidence;
}

export interface JsonlCursor {
  offset: number;
  pending: string;
  generation: string | null;
}

export interface ParsedJsonl<T> {
  records: T[];
  cursor: JsonlCursor;
  diagnostics: PipelineDiagnostic[];
  reset: boolean;
}

export interface ControlEvaluation {
  triggered: boolean | null;
  issueCaught: boolean | null;
  acceptedFinding: boolean | null;
  falsePositive: boolean | null;
  humanWaitMs: number | null;
  humanTouches: number | null;
  retries: number | null;
  cycleTimeMs: number | null;
}

export interface ChangeSelection {
  changeId: string | null;
  confidence: EvidenceConfidence;
  selectionRequired: boolean;
  reason: string;
}

export interface DecisionRequest {
  decisionId: string;
  repoId: string;
  changeId: string | null;
  kind: 'audit-rejected' | 'clarification' | 'dependency-request' | 'unknown';
  status: 'pending' | 'answered' | 'unknown';
  title: string;
  summary: string;
  risk: 'low' | 'medium' | 'high' | 'unknown';
  riskReason: string | null;
  provenance: 'repo' | 'derived' | 'human' | 'runtime';
  evidenceRefs: string[];
  requestedAt: string;
}

export interface PipelineEvidence {
  repoId: string;
  observedAt: string;
  tasks: TaskEvidence[];
  reports: string[];
  decisions: DecisionRequest[];
  activeChanges: string[];
  archivedChanges: string[];
  mergedChanges: string[];
  diagnostics: PipelineDiagnostic[];
  selection: ChangeSelection;
  /**
   * Proyección rica para el dashboard. Son opcionales para poder abrir snapshots
   * SQLite escritos por versiones anteriores sin fingir datos ausentes.
   */
  openSpecChanges?: OpenSpecChangeEvidence[];
  openSpecArchivedChanges?: OpenSpecArchivedChangeEvidence[];
  openSpecSpecifications?: OpenSpecSpecificationEvidence[];
  /**
   * Si el repositorio tiene `openspec/`.
   *
   * Distinto de «no hay cambios activos»: hoy los dos estados coinciden en los
   * contadores, y uno se resuelve creando un cambio mientras el otro no se puede
   * resolver desde el panel sin inicializar primero.
   */
  openSpecPresent?: boolean;
  /**
   * Herramientas presentes en el repositorio, con su estado de configuración.
   * Sólo las que se reconocen: una desconocida no se reporta como faltante.
   */
  openSpecTools?: OpenSpecToolEvidence[];
  /**
   * Cuánto se aparta la rama actual de la base local. Ausente en un snapshot de
   * una versión anterior, que no lo trae.
   */
  branchDivergence?: BranchDivergence;
}

/**
 * Distancia entre la rama actual y la base local, en commits.
 *
 * `measured: false` es "no se pudo medir" y no un cero: sin `main`, en un
 * repositorio recién iniciado o con Git inaccesible, decir cero afirmaría que la
 * rama está al día, que es justo lo contrario de lo que se sabe. Es el mismo
 * principio que `validation: 'unknown'`.
 *
 * `base` se transporta porque la comparación es contra el `main` **local**:
 * saber si `main` mismo está atrasado respecto del remoto exige `git fetch`, que
 * es red y no ocurre en una lectura. Declararlo evita sugerir una frescura que
 * no se midió.
 */
export type BranchDivergence =
  | { measured: false }
  | {
    measured: true;
    /** Contra qué se comparó. Local, siempre. */
    base: string;
    /** Commits de la base que faltan bajo los pies. */
    behind: number;
    /** Commits propios que la base no tiene. */
    ahead: number;
  };

export interface PipelineState extends PipelineEvidence {
  revision: number;
}

export type SemanticEventKind =
  | 'task.completed'
  | 'report.added'
  | 'gate.changed'
  | 'change.merged'
  | 'change.archived';

export interface PipelineSemanticEvent {
  eventId: string;
  repoId: string;
  kind: SemanticEventKind;
  observedAt: string;
  subjectId: string;
  evidenceRefs: string[];
}

export interface ReductionResult {
  state: PipelineState;
  events: PipelineSemanticEvent[];
}

// --- OpenSpec engine: detección del motor, configuración global e integración ---
// Los tipos canónicos de versión y perfil viven en `lib/` (son utilidades puras
// compartidas por main y renderer); acá se re-exportan para que el snapshot los
// concentre en un solo lugar.
import type { OpenSpecVersionClass, OpenSpecVersionRange } from '../../lib/openspec-version';

export type { OpenSpecVersionClass, OpenSpecVersionRange } from '../../lib/openspec-version';
export type { OpenSpecProfileClass } from '../../lib/openspec-profile';

/** Procedencia del ejecutable de OpenSpec que GitCron resuelve. */
export type OpenSpecCliProvenance = 'global' | 'local' | 'managed' | 'unknown';

/**
 * Detección del motor de OpenSpec resuelto por GitCron.
 *
 * `displayPath` es un diagnóstico de sólo lectura: la ruta efectiva del
 * ejecutable, para mostrar. Nunca debe poder volver desde el renderer como
 * ejecutable ni como ruta de operación; toda ejecución usa el runtime que el
 * proceso principal autorice.
 */
export interface OpenSpecCliDiscovery {
  installed: boolean;
  /** Versión leída de `openspec --version`. `null` si no se pudo leer. */
  runtimeVersion: string | null;
  provenance: OpenSpecCliProvenance;
  /** Ruta efectiva canónica, informativa y de sólo lectura. `null` si no se halló. */
  displayPath: string | null;
  /** Rango soportado por esta versión de GitCron. */
  supportedRange: OpenSpecVersionRange;
  /** Clasificación de `runtimeVersion` frente a `supportedRange`. */
  versionClass: OpenSpecVersionClass;
  evidenceStatus: 'confirmed' | 'inferred' | 'unknown';
  diagnostics: string[];
}

/**
 * Configuración global efectiva de OpenSpec, leída de forma minimizada. Sólo
 * transporta lo que la tarjeta necesita; `anonymousId`, telemetría y otros
 * campos ajenos no se transportan, loguean ni persisten.
 *
 * Representa explícitamente el estado de lectura de cada clave por separado.
 */
export interface OpenSpecGlobalConfig {
  rawProfile: string | null;
  profileState: 'read' | 'failed' | 'unread';
  delivery: string | null;
  deliveryState: 'read' | 'failed' | 'unread';
  /** Workflows tal como están escritos en el archivo de configuración global (`config get workflows`). */
  configuredWorkflows: string[] | null;
  workflowsState: 'read' | 'failed' | 'unread';
  /**
   * Workflows que el perfil vigente RESUELVE (bloque "Profile settings" de
   * `config list`): lo que el motor realmente habilita. Puede diferir de
   * `configuredWorkflows`; son datos distintos con causas distintas.
   */
  resolvedWorkflows: string[] | null;
  resolvedWorkflowsState: 'read' | 'failed' | 'unread';
  /** `cli` cuando al menos una clave produjo evidencia válida; `unknown` si todas fallaron. */
  origin: 'cli' | 'unknown';
  /** ISO-8601 del momento de lectura. */
  readAt: string;
}

/**
 * Resultado de alternar (activar/desactivar) UN workflow en la configuración
 * global de OpenSpec (`config set workflows`).
 *
 * `config` es el estado RE-LEÍDO tras la operación (o el último estado conocido
 * si la operación falló). `appliedWorkflows` es la lista confirmada por esa
 * re-lectura; `null` cuando no se pudo confirmar. El nombre del workflow no se
 * valida contra ningún conjunto: lo alterable es lo que el CLI ya informó.
 */
export interface SetOpenSpecWorkflowResult {
  ok: boolean;
  appliedWorkflows: string[] | null;
  config: OpenSpecGlobalConfig | null;
  error?: string;
}

/**
 * Resultado de cambiar el perfil global a 'core' o 'custom'.
 */
export interface SetOpenSpecProfileResult {
  ok: boolean;
  config: OpenSpecGlobalConfig | null;
  error?: string;
}

/**
 * Estado instalado en el repositorio (segunda fuente, independiente de la
 * configuración global). Declara explícitamente los campos tipados del contrato.
 */
export interface OpenSpecInstalledIntegration {
  tools: string[];
  targets: string[];
  installedWorkflowsByTarget: Record<string, string[]> | null;
  generatedByVersion: string | null;
  markers: Record<string, boolean> | null;
  missing: string[] | null;
  legacy: string[] | null;
  customized: string[] | null;
  conflicts: string[] | null;
  evidenceStatus: 'confirmed' | 'inferred' | 'unknown';
  origin: 'installed-integration' | 'unknown';
}

/**
 * Estado del motor de OpenSpec para el snapshot. Agrega la detección del CLI, la
 * última versión disponible (con su origen), la configuración global y la
 * integración instalada, como fuentes independientes.
 */
export interface OpenSpecRegistryCheck {
  status: 'online' | 'cached' | 'offline' | 'unknown';
  latestVersion: string | null;
  checkedAt: string;
  fromCache: boolean;
  cacheAgeSeconds: number | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  error: string | null;
}

export type OpenSpecOutputKind = 'repo-local' | 'external-global';

export interface OpenSpecOutputItem {
  id: string;
  targetName: string;
  kind: OpenSpecOutputKind;
  displayPath: string;
  descriptionKey: string;
  blocked: boolean;
  presenceState?: 'present' | 'absent' | 'unreadable' | 'conflicting' | 'error';
  entryType?: 'file' | 'directory' | 'symlink' | 'absent';
  isSymlink?: boolean;
  symlinkTarget?: string | null;
  casing?: string;
  contentHash?: string | null;
  /** `true` cuando el recorrido de contenido alcanzó un tope y `contentHash` es parcial (queda `null`). */
  hashTruncated?: boolean;
}

export interface OpenSpecInstalledSkill {
  name: string;
  path: string;
  origin:
    | 'legacy-codex'
    | 'legacy-agent'
    | 'new-agents'
    | 'custom-agents'
    | 'official-other'
    | 'custom-other'
    | 'unknown';
  isOfficial: boolean;
}

export interface OpenSpecTargetDivergenceDetail {
  kind: 'target-workflows-mismatch';
  toolId: string;
  label: string;
  targetCount: number;
  targetWorkflows: string[];
  globalCount: number;
  globalWorkflows: string[];
}

export type OpenSpecDivergenceReason =
  | {
      kind: 'profile-mismatch';
      globalProfileClass: 'core' | 'expanded' | 'custom' | 'unknown';
      repoProfileClass: 'core' | 'expanded' | 'custom' | 'unknown';
    }
  | {
      kind: 'target-workflows-mismatch';
      toolId: string;
      label: string;
      targetCount: number;
      targetWorkflows: string[];
      globalCount: number;
      globalWorkflows: string[];
    }
  | {
      kind: 'multiple-target-divergences';
      targets: OpenSpecTargetDivergenceDetail[];
    };

export interface OpenSpecTargetConvergence {
  toolId: string;
  label: string;
  status: 'convergent' | 'divergent' | 'unknown';
  targetProfileClass: 'core' | 'expanded' | 'custom' | 'unknown';
  installedWorkflows: string[];
  reason?: OpenSpecTargetDivergenceDetail | null;
}

export interface OpenSpecInstalledEvidence {
  skills: OpenSpecInstalledSkill[];
  generatedBy: string | null;
  markersFound: string[];
  outputInventory: OpenSpecOutputItem[];
  evidenceStatus: 'confirmed' | 'unconfirmed' | 'unknown';
  tools: string[];
  targets: string[];
  configuredTools?: string[];
  presentToolDirectories?: string[];
  configuredAgentsCount?: number;
  totalPresentAgentsCount?: number;
  configuredCount?: number;
  totalPresentCount?: number;
  installedWorkflowsByTarget: Record<string, string[]>;
  missing: string[] | null;
  legacy: string[];
  customized: string[];
  conflicts: string[] | null;
}

export interface OpenSpecDivergenceInfo {
  isDivergent: boolean;
  reason: OpenSpecDivergenceReason | null;
  overallStatus: 'convergent' | 'divergent' | 'unknown';
  globalProfileClass: 'core' | 'expanded' | 'custom' | 'unknown';
  repoProfileClass: 'core' | 'expanded' | 'custom' | 'unknown';
  targetConvergences?: Record<string, OpenSpecTargetConvergence>;
}

export type OpenSpecFreshnessState = 'cli-up-to-date' | 'cli-upgrade-available' | 'offline' | 'unknown';

export type OpenSpecStoreDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface OpenSpecStoreDiagnostic {
  severity: OpenSpecStoreDiagnosticSeverity;
  code: string;
  message: string;
  target?: string;
  fix?: string;
}

export interface OpenSpecDoctorRoot {
  path: string;
  source: string;
  store_id?: string;
  healthy: boolean;
  status: OpenSpecStoreDiagnostic[];
}

export interface OpenSpecDoctorStore {
  id: string;
  metadata: {
    present: boolean;
    valid: boolean;
    remote?: string;
  };
  origin_url?: string;
  drift?: {
    ahead: number;
    behind: number;
  };
  status: OpenSpecStoreDiagnostic[];
}

export interface OpenSpecDoctorReference {
  store_id: string;
  root?: string;
  status: OpenSpecStoreDiagnostic[];
}

export interface OpenSpecDoctorData {
  root: OpenSpecDoctorRoot | null;
  store: OpenSpecDoctorStore | null;
  references: OpenSpecDoctorReference[];
  status: OpenSpecStoreDiagnostic[];
}

export interface OpenSpecDoctorResult {
  command: 'openspec doctor --json';
  ok: boolean;
  error?: string | null;
  data: OpenSpecDoctorData | null;
}

export interface OpenSpecContextMember {
  role: string;
  id: string;
  path?: string;
  remote?: string;
  fetch?: string;
  status: OpenSpecStoreDiagnostic[];
}

export interface OpenSpecContextBriefData {
  root: {
    path: string;
    source: string;
    store_id?: string;
    role: 'openspec_root';
  } | null;
  members: OpenSpecContextMember[];
  status: OpenSpecStoreDiagnostic[];
}

export interface OpenSpecContextBriefResult {
  command: 'openspec context --json';
  ok: boolean;
  error?: string | null;
  data: OpenSpecContextBriefData | null;
}

export type EngineToolReportSource = 'engine' | 'gitcron-fallback';

export type EngineToolFallbackReason =
  | 'package-not-found'
  | 'version-mismatch'
  | 'engine-api-changed'
  | 'timeout'
  | 'failed';

export interface OpenSpecToolReportItem {
  id: string;
  label: string;
  skillsDir?: string;
  legacySkillsDirs?: string[];
  available: boolean;
  configured: boolean;
  configuredVia?: 'shared-folder';
  needsUpdate: boolean;
  generatedBy: string | null;
}

export interface OpenSpecToolReport {
  source: EngineToolReportSource;
  engineVersion: string | null;
  fallbackReason?: EngineToolFallbackReason;
  tools: OpenSpecToolReportItem[];
  profileSyncNeeded: string[];
}

export interface OpenSpecEngineStatus {
  cli: OpenSpecCliDiscovery;
  latestAvailable: OpenSpecRegistryCheck | null;
  globalConfig: OpenSpecGlobalConfig | null;
  installedIntegration: OpenSpecInstalledEvidence | null;
  repoState: 'initialized' | 'not-initialized' | 'unknown';
  integrationState: 'up-to-date' | 'outdated' | 'custom' | 'conflicted' | 'unknown';
  freshnessState?: OpenSpecFreshnessState;
  divergence?: OpenSpecDivergenceInfo | null;
  doctor?: OpenSpecDoctorResult | null;
  contextBrief?: OpenSpecContextBriefResult | null;
  toolReport?: OpenSpecToolReport | null;
  pendingTools?: string[];
}

export interface OpenSpecPreviewResult {
  previewClass: 'not-available' | 'partial';
  summary: string;
  capturedAt: string;
  /**
   * Inventario clasificado que fundamenta esta vista previa (2.11). Va completo
   * y no sólo su huella: quien consuma el preview aislado ve la clasificación
   * que la huella `outputInventoryFingerprint` va a recomprobar — lo que se
   * muestra es exactamente lo que invalida.
   */
  outputInventory: OpenSpecOutputItem[];
  invalidationParams: {
    repoPath: string;
    branch: string | null;
    headCommit: string | null;
    workingTreeFingerprint: string;
    cliPath: string | null;
    cliProvenance: OpenSpecCliProvenance;
    cliVersion: string | null;
    targetVersion: string;
    packageIntegrity: string | null;
    globalConfigFingerprint: string;
    installedEvidenceFingerprint: string;
    outputInventoryFingerprint: string;
    /** Huella del schema del change (`openspec/config.yaml`) y su configuración (2.12). */
    schemaConfigFingerprint: string;
  };
}

export interface OpenSpecUpdatePlan {
  repoPath: string;
  requiredAction: 'init' | 'update' | 'upgrade-init' | 'upgrade-update' | 'none' | 'blocked';
  preview: OpenSpecPreviewResult;
  canExecute: false;
  reason: string;
}

export interface OpenSpecExecuteResult {
  success: false;
  status: 'blocked';
  reason: 'poc-required';
  message: string;
}

export type OpenSpecUpdateExecutionStatus = 'completed' | 'update-incomplete' | 'blocked' | 'error';

export interface OpenSpecRunUpdateResult {
  success: boolean;
  status: OpenSpecUpdateExecutionStatus;
  filesUpdated: string[];
  errors: string[];
  message?: string;
  engineStatus?: OpenSpecEngineStatus;
}

export interface OpenSpecLegacySkillPlanItem {
  name: string;
  path: string;
  origin: 'legacy-codex' | 'legacy-agent';
  removable: boolean;
  reason?: 'untracked' | 'modified' | 'remove-failed';
}

export interface OpenSpecLegacySkillsPlan {
  items: OpenSpecLegacySkillPlanItem[];
}

export interface OpenSpecRemoveLegacySkillsResult {
  removed: string[];
  skipped: Array<{ path: string; reason: 'untracked' | 'modified' | 'remove-failed' }>;
  engineStatus: OpenSpecEngineStatus;
}

export interface OpenSpecInstructionsPayload {
  changeName?: string;
  artifactId?: string;
  schemaName?: string;
  changeDir?: string;
  planningHome?: {
    kind: string;
    root: string;
    changesDir: string;
    defaultSchema: string;
  };
  description?: string;
  contextFiles?: Record<string, string[]>;
  progress?: { total: number; complete: number; remaining: number };
  tasks?: Array<{ id: string; description: string; done: boolean }>;
  state?: string;
  instruction?: string;
  context?: string;
  template?: string;
  dependencies?: Array<{ id: string; done: boolean; path: string; description: string }>;
  unlocks?: string[];
  outputPath?: string;
  resolvedOutputPath?: string;
  existingOutputPaths?: string[];
  root?: { path: string; source: string };
  status?: Array<{ severity: string; code: string; message: string }>;
}

export interface InstructionsOpenSpecResult {
  ok: boolean;
  error: string | null;
  data: OpenSpecInstructionsPayload | null;
}

export interface ShowOpenSpecChangeResult {
  ok: boolean;
  error: string | null;
  content: string | null;
  data?: unknown;
}

export interface DeltaSpecRequirementIssue {
  capability: string;
  requirement: string;
  type: 'MODIFIED' | 'REMOVED';
  reason: string;
}

export interface IncompleteTaskIssue {
  id: string;
  description: string;
  line: number;
}

export interface ArchivePlan {
  archiveCommand: string;
  canArchive?: boolean;
  errors?: string[];
  requirementIssues?: DeltaSpecRequirementIssue[];
  incompleteTasks?: IncompleteTaskIssue[];
}

export type PackageManagerType = 'pnpm' | 'npm' | 'yarn' | 'bun';

export interface OpenSpecInstallResult {
  success: boolean;
  mode: 'local' | 'global';
  code?: string;
  commandExecuted?: string;
  packageManager?: PackageManagerType;
  packageManagerPath?: string;
  nodePath?: string | null;
  filesUpdated?: string[];
  stdout?: string;
  stderr?: string;
  error?: string;
  engineStatus?: OpenSpecEngineStatus | null;
}

export interface OpenSpecInstallPlan {
  detectedManager: PackageManagerType | null;
  packageManagerPath: string | null;
  nodePath: string | null;
  localCommand: string | null;
  globalCommand: string | null;
  hasManifest: boolean;
}

export type ConsumedSurfaceName =
  | 'status'
  | 'instructions'
  | 'validate'
  | 'archive'
  | 'sync'
  | 'profiles';

export interface ConsumedSurfaceAnalysis {
  surface: ConsumedSurfaceName;
  description: string;
  verdict: 'compatible' | 'breaking' | 'potential-break' | 'unchanged';
  evidence: string;
}

export interface VersionStrategyProposal {
  summary: string;
  whatToModify: string[];
  orderOfOperations: string[];
  whatWorksUntouched: string[];
  recommendation: string;
}

export interface VersionAnalysisMeasured {
  installedVersion: string | null;
  availableVersion: string | null;
  isUpgradeAvailable: boolean;
  versionClass: OpenSpecVersionClass;
  behindCycle: boolean;
  targetVersion: string;
  supportedRange: OpenSpecVersionRange;
  changelog: {
    source: string;
    sourceUrl: string | null;
    fetched: boolean;
    rawText: string | null;
    error?: string | null;
  };
  consumedSurfaces: ConsumedSurfaceAnalysis[];
  breakingChangesDetected: boolean;
  strategyProposal: VersionStrategyProposal | null;
}

export interface VersionAnalysisRedaction {
  provider: string;
  status: 'idle' | 'no-model' | 'generated' | 'offline' | 'error';
  text: string;
  error?: string | null;
}

export interface OpenSpecVersionAnalysisResult {
  measured: VersionAnalysisMeasured;
  redaction: VersionAnalysisRedaction;
}

export interface OpenSpecGraphArtifact {
  id: string;
  status: string;
  requires: string[];
  outputPath?: string;
  resolvedOutputPath?: string;
  existingOutputPaths?: string[];
  description?: string;
  dependencies?: Array<{ id: string; done: boolean; path: string; description: string }>;
  unlocks?: string[];
  instruction?: string;
}

export interface OpenSpecArtifactGraphResult {
  ok: boolean;
  artifacts?: OpenSpecGraphArtifact[];
  nextSteps?: string[];
  applyRequires?: string[];
  error?: string | null;
}

export * from './runtime';
export * from './projection';
