import type {
  TemporalAgentConfig,
  TemporalAgentNotes,
  TemporalAgentDecision,
  PredictionResult,
  MaterializeIdeaInput,
  MaterializationResult,
} from './temporal-agent';
import type { PredictionHistoryEntry } from '../electron/db/types';
import type { PipelineState, RuntimeDiscoveryEntry, RuntimeProjection } from './pipeline';
import type { CommitAiLastRequest, CommitAiResolvedModel, CommitAiResolvedResult, CommitDraftResult, DraftChunkEvent, DraftStateEvent, LoadOutcome, LocalModel } from './commit-message-ai';
import type { ApplyHunkOptions, FileDiff } from '../lib/hunk-patch';
import type {
  CartoGraphStatus,
  CartoGraph,
  CartoSearchHit,
  CartoRelatedSymbol,
  CartoImpact,
  CartoFileRelations,
  CartoNode,
} from '../lib/carto-types';
import type {
  CartoAINodeRef,
  CartoAIContext,
  CartoAIResponse,
  CartoAISettings,
  CartoAIProbe,
  CartoExplainNodeResult,
  CartoAskResult,
  CartoPanoramaResult,
} from './carto-ai';

interface GitResult<T = unknown> {
  success: boolean;
  ok?: boolean;
  reason?: 'not-a-repo';
  path?: string;
  data?: T;
  error?: string;
  isAuthError?: boolean;
  status?: number;
  mergeInProgress?: boolean;
  rebaseInProgress?: boolean;
}

export interface RebaseCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  isPushed: boolean;
}

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export interface RebasePlanItem {
  hash: string;
  action: RebaseAction;
  newMessage?: string;
}


export interface RepoInfo {
  path: string;
  name: string;
  currentBranch: string;
  isGitRepo: boolean;
}

export interface CommitData {
  hash: string;
  shortHash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs?: string[]; // branch/tag pointers at this commit
}

export interface StatusFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
  oldPath?: string;
  conflicted?: boolean;
}

interface GitCleanResult {
  files: string[];
  deleted?: string[];
}

export interface BranchTrackingInfo {
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;       // true when upstream was deleted
  hasRemote: boolean;  // true when the branch has a live upstream (configured and not gone)
}

export interface BranchData {
  local: string[];
  remote: string[];
  current: string;
  tracking?: Record<string, BranchTrackingInfo>;
}

export interface WorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
}

export interface PullRequestEntry {
  number: number;
  title: string;
  author: string;
  branch: string;
  baseBranch: string;
  url: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PullRequestDiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  previousFilename?: string;
}

export interface PullRequestDiffData extends PullRequestEntry {
  diff: string;
  files: PullRequestDiffFile[];
}

export interface FileHistoryEntry extends CommitData {
  filePath: string;
}

export interface BlameLine {
  lineNo: number;
  content: string;
  commitHash: string;
  shortHash: string;
  author: string;
  authorEmail?: string;
  authorTime: string;
  summary: string;
  previousCommitHash?: string;
  previousPath?: string;
  isUncommitted: boolean;
}

interface RemoteOpResult {
  success: boolean;
  error?: string;
  authRequired?: boolean;
  conflict?: boolean;
  summary?: string;
  files?: string[];
}

interface ExistingGitHubRemoteLinkResult {
  success: boolean;
  code?: 'invalid-remote-url' | 'remote-add-failed' | 'remote-check-failed' | 'remote-has-history' | 'first-push-failed' | 'remote-adopt-failed';
  authRequired?: boolean;
  localRepoReady?: boolean;
  retryable?: boolean;
  remoteAdded?: boolean;
  remoteRolledBack?: boolean;
  rollbackError?: string;
  remoteHasHistory?: boolean;
  adoptedRemoteHistory?: boolean;
  preservedWorkingTree?: boolean;
  backupBranch?: string;
  error?: string;
}

export interface StashEntry {
  index: number;
  message: string;
  hash: string;
  date: string;
}

interface StashPreviewData {
  files: string[];
  diff: string;
}

export interface SubmoduleEntry {
  hash: string;
  path: string;
  describe?: string;
}

export interface RemoteEntry {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface GitHubRepoInfo {
  name: string;
  fullName: string;
  cloneUrl: string;
  private: boolean;
  description: string | null;
  updatedAt: string | null;
}

interface CreatedRepoInfo {
  cloneUrl: string;
  htmlUrl: string;
  fullName: string;
  name: string;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  email: string | null;
}

interface ElectronAPI {
  gitCommand: (repoPath: string, args: string[]) => Promise<GitResult<string>>;
  githubTest: (token: string, owner: string, repo: string) => Promise<GitResult>;
  githubAuth: (token: string) => Promise<GitResult<GitHubUser>>;
  githubDeviceStart: () => Promise<GitResult<DeviceCodeInfo>>;
  githubDevicePoll: (deviceCode: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  openRepo: (defaultPath?: string) => Promise<{ success: boolean; data?: RepoInfo; reason?: string; path?: string; error?: string }>;
  openPath: (dirPath: string) => Promise<{ success: boolean; data?: RepoInfo; reason?: string; path?: string; error?: string }>;
  /** Sonda: comprueba si una carpeta es raíz Git SIN conceder autorización. */
  checkRepoPath: (dirPath: string) => Promise<{ success: boolean; data?: { isGitRepo: boolean }; reason?: string; path?: string; error?: string }>;
  closeRepo: (repoPath: string) => Promise<{ success: boolean; error?: string }>;
  pickFolder: (title?: string, defaultPath?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  gitApplyPatchFile: (repoPath: string) => Promise<GitResult<{ fileName: string }> & { canceled?: boolean }>;
  gitInit: (parentPath: string, name: string, withInitialCommit?: boolean) => Promise<GitResult<RepoInfo>>;
  gitClone: (url: string, parentPath: string, folderName: string, token?: string) => Promise<GitResult<RepoInfo>>;
  githubCreateRepo: (token: string, name: string, isPrivate: boolean, description?: string, autoInit?: boolean) => Promise<GitResult<CreatedRepoInfo>>;
  fsExistsAndNotEmpty: (parentPath: string, name: string) => Promise<GitResult<boolean>>;
  githubListUserRepos: (token: string) => Promise<GitResult<GitHubRepoInfo[]>>;
  gitLog: (repoPath: string, opts?: { allBranches?: boolean }) => Promise<GitResult<CommitData[]>>;
  gitStatus: (repoPath: string) => Promise<GitResult<StatusFile[]>>;
  gitIndexSignature: (
    repoPath: string,
  ) => Promise<GitResult<{ mtimeMs: number; size: number; ino: number } | null>>;
  gitBranches: (repoPath: string) => Promise<GitResult<BranchData>>;
  gitDefaultBranch: (repoPath: string, remote: string) => Promise<GitResult<string | null>>;
  gitCheckout: (repoPath: string, branch: string) => Promise<GitResult>;
  gitCreateBranch: (repoPath: string, name: string, fromHash?: string) => Promise<GitResult>;
  gitRestoreMaterializedBranch: (
    repoPath: string,
    branchName: string,
    sourceTag: string,
  ) => Promise<GitResult<{ branchName: string; sourceTag: string }>>;
  gitMergeBranch: (repoPath: string, sourceBranch: string) => Promise<GitResult>;
  gitRebase: (repoPath: string, ontoBranch: string) => Promise<GitResult>;
  gitFastForward: (repoPath: string, branch: string, toRef: string) => Promise<GitResult>;
  gitRenameBranch: (repoPath: string, oldName: string, newName: string) => Promise<GitResult>;
  gitDeleteBranch: (repoPath: string, branch: string, force?: boolean) => Promise<GitResult<{ notMerged?: boolean }>>;
  /** Publica la rama con su nombre actual y reapunta el vínculo con el remoto. */
  gitRepointUpstream: (repoPath: string, branch: string, token?: string) => Promise<GitResult<{ branch: string; previousUpstream: string | null; upstream: string; authRequired?: boolean }>>;
  gitDeleteRemoteBranch: (repoPath: string, remote: string, branch: string, token?: string) => Promise<GitResult<{ authRequired?: boolean }>>;
  gitIsBranchMerged: (repoPath: string, branch: string, base?: string) => Promise<GitResult<{ merged: boolean; base: string }>>;
  gitPullBranch: (repoPath: string, branch: string, token?: string) => Promise<GitResult>;
  gitPushBranch: (repoPath: string, branch: string, token?: string, force?: boolean) => Promise<GitResult>;
  gitPush: (repoPath: string, token?: string) => Promise<GitResult<RemoteOpResult>>;
  gitPull: (repoPath: string, token?: string) => Promise<GitResult<RemoteOpResult>>;
  gitPullFastForward: (repoPath: string, token?: string) => Promise<GitResult<RemoteOpResult>>;
  gitPullRebase: (repoPath: string, token?: string) => Promise<GitResult<RemoteOpResult>>;
  gitPullMerge: (repoPath: string, token?: string) => Promise<GitResult<RemoteOpResult>>;
  gitFetch: (repoPath: string, token?: string) => Promise<GitResult<RemoteOpResult>>;
  gitStage: (repoPath: string, filePath: string) => Promise<GitResult>;
  gitUnstage: (repoPath: string, filePath: string) => Promise<GitResult>;
  gitStageBatch: (repoPath: string, filePaths: string[], force?: boolean) => Promise<GitResult>;
  gitUnstageBatch: (repoPath: string, filePaths: string[]) => Promise<GitResult>;
  gitRemoveLock: (repoPath: string) => Promise<GitResult<{ removed: boolean }>>;
  gitTrustSafeDirectory: (repoPath: string) => Promise<GitResult<{ path: string }>>;
  gitAmend: (repoPath: string, newMessage?: string) => Promise<GitResult<{ hash: string; shortHash: string }>>;
  gitCherryPick: (repoPath: string, hash: string) => Promise<GitResult>;
  gitSquash: (repoPath: string, n: number, message: string) => Promise<GitResult<{ hash: string; shortHash: string }>>;
  gitRebasePrepare: (repoPath: string, commitHash: string) => Promise<GitResult<RebaseCommitInfo[]>>;
  gitRebaseStart: (
    repoPath: string,
    baseHash: string,
    plan: RebasePlanItem[],
  ) => Promise<GitResult<{ success: boolean; conflict?: boolean }>>;
  gitRebaseContinue: (repoPath: string) => Promise<GitResult<{ success: boolean; conflict?: boolean }>>;
  gitRebaseAbort: (repoPath: string) => Promise<GitResult>;
  gitRebaseUndo: (repoPath: string, targetRef: string) => Promise<GitResult>;
  gitShowFiles: (repoPath: string, hash: string) => Promise<GitResult<StatusFile[]>>;
  gitDiffAtCommit: (repoPath: string, filePath: string, hash: string) => Promise<GitResult<string>>;
  gitFileHistory: (repoPath: string, filePath: string, limit?: number) => Promise<GitResult<FileHistoryEntry[]>>;
  gitBlame: (repoPath: string, filePath: string, rev?: string) => Promise<GitResult<BlameLine[]>>;
  gitAddToGitignore: (repoPath: string, filePath: string) => Promise<GitResult<{ alreadyIgnored: boolean }>>;
  gitResetAll: (repoPath: string) => Promise<GitResult>;
  gitClean: (repoPath: string, files?: string[]) => Promise<GitResult<GitCleanResult>>;
  gitReadFile: (repoPath: string, filePath: string) => Promise<GitResult<string>>;
  gitResolveConflictFile: (repoPath: string, filePath: string, content: string) => Promise<GitResult>;
  gitStashFile: (repoPath: string, filePath: string) => Promise<GitResult>;
  shellShowInFolder: (repoPath: string, relativeFilePath: string) => Promise<GitResult>;
  shellOpenItem: (repoPath: string, relativeFilePath: string) => Promise<GitResult>;
  fsDeleteFile: (repoPath: string, relativeFilePath: string) => Promise<GitResult>;
  gitDiff: (repoPath: string, filePath: string, staged?: boolean) => Promise<GitResult<string>>;
  gitDiffHunks: (repoPath: string, filePath: string, staged?: boolean) => Promise<GitResult<FileDiff>>;
  gitApplyHunk: (
    repoPath: string,
    filePath: string,
    hunkPatch: string,
    options: ApplyHunkOptions,
  ) => Promise<GitResult>;
  gitStashList: (repoPath: string) => Promise<GitResult<StashEntry[]>>;
  gitStashPush: (repoPath: string, message?: string) => Promise<GitResult>;
  gitStashApply: (repoPath: string, index: number) => Promise<GitResult>;
  gitStashPop: (repoPath: string, index: number) => Promise<GitResult>;
  gitStashDrop: (repoPath: string, index: number) => Promise<GitResult>;
  gitStashPreview: (repoPath: string, index: number) => Promise<GitResult<StashPreviewData>>;
  gitStashClear: (repoPath: string) => Promise<GitResult>;
  gitDeleteTag: (repoPath: string, tagName: string) => Promise<GitResult>;
  gitCreateTag: (repoPath: string, tagName: string, commitHash: string, message?: string) => Promise<GitResult>;
  gitPushTag: (repoPath: string, tagName: string, token?: string) => Promise<GitResult>;
  gitResetCommit: (repoPath: string, commitHash: string, mode: 'soft' | 'mixed' | 'hard') => Promise<GitResult>;
  gitTags: (repoPath: string) => Promise<GitResult<string[]>>;
  gitSubmodules: (repoPath: string) => Promise<GitResult<SubmoduleEntry[]>>;
  gitWorktrees: (repoPath: string) => Promise<GitResult<WorktreeEntry[]>>;

  // Remotes
  gitRemotesList: (repoPath: string) => Promise<GitResult<RemoteEntry[]>>;
  gitRemoteAdd: (repoPath: string, name: string, url: string) => Promise<GitResult>;
  gitAddExistingGitHubRemote: (repoPath: string, remoteUrl: string, token?: string) => Promise<GitResult<ExistingGitHubRemoteLinkResult>>;
  gitInspectExistingGitHubRemote: (repoPath: string, remoteUrl: string, token?: string) => Promise<GitResult<ExistingGitHubRemoteLinkResult>>;
  gitAdoptExistingGitHubRemote: (repoPath: string, remoteUrl: string, token?: string) => Promise<GitResult<ExistingGitHubRemoteLinkResult>>;
  gitRemoteRemove: (repoPath: string, name: string) => Promise<GitResult>;
  gitRemoteSetUrl: (repoPath: string, name: string, url: string) => Promise<GitResult>;
  gitRemoteRename: (repoPath: string, oldName: string, newName: string) => Promise<GitResult>;

  // Worktrees
  gitWorktreeAdd: (repoPath: string, path: string, branch: string) => Promise<GitResult>;
  gitWorktreeRemove: (repoPath: string, path: string, force?: boolean) => Promise<GitResult>;
  /** Borra el directorio del worktree y poda el registro. Destructivo. */
  gitWorktreePurge: (repoPath: string, worktreePath: string) => Promise<GitResult>;

  // Submodules
  gitSubmoduleUpdate: (repoPath: string, path?: string, init?: boolean) => Promise<GitResult>;
  gitSubmoduleAdd: (repoPath: string, url: string, path: string) => Promise<GitResult>;
  gitSubmoduleSync: (repoPath: string) => Promise<GitResult>;
  githubListPRs: (token: string, repoPath: string) => Promise<GitResult<PullRequestEntry[]>>;
  githubGetPRDiff: (token: string, repoPath: string, number: number) => Promise<GitResult<PullRequestDiffData>>;
  terminalOpen: (repoPath: string) => Promise<GitResult>;
  shellOpenPath: (targetPath: string) => Promise<GitResult>;
  shellOpenExternal: (url: string) => Promise<GitResult>;
  storageSet: (key: string, value: string) => Promise<GitResult>;
  storageGet: (key: string) => Promise<GitResult<string | null>>;
  storageDelete: (key: string) => Promise<GitResult>;
  checkForUpdate: () => Promise<GitResult>;
  downloadUpdate: () => Promise<GitResult>;
  installUpdate: () => Promise<GitResult>;
  getChangelog: () => Promise<GitResult<string>>;
  windowMinimize: () => Promise<GitResult>;
  windowToggleMaximize: () => Promise<GitResult<{ maximized: boolean }>>;
  windowIsMaximized: () => Promise<GitResult<{ maximized: boolean }>>;
  onWindowState: (cb: (state: { maximized: boolean }) => void) => () => void;
  windowClose: () => Promise<GitResult>;
  onUpdateNotAvailable: (cb: () => void) => () => void;
  onUpdateAvailable: (cb: (info: { version: string; currentVersion: string; releaseDate?: string }) => void) => () => void;
  onUpdateDownloaded: (cb: (info: { version: string; currentVersion: string; releaseDate?: string }) => void) => () => void;
  onUpdateError: (cb: (msg: string) => void) => () => void;
  onDownloadProgress: (cb: (info: { percent: number; transferred: number; total: number }) => void) => () => void;
  /**
   * Redactar el asunto del commit con un modelo local.
   *
   * Ninguno de estos canales se dispara solo: todos responden a un botón. Un
   * refresco del panel no puede costar 47 segundos de GPU ni ocupar 7 GB de VRAM.
   */
  commitAi: {
    /** Modelos disponibles, con su estado y su contexto real. Barato. */
    catalog(baseUrl?: string): Promise<GitResult<LocalModel[]>>;
    /** La acción con costo. Va siempre después de haberlo declarado. */
    load(model: string, baseUrl?: string, contextLength?: number, ttlSeconds?: number): Promise<GitResult<LoadOutcome>>;
    /** Corta la redacción en vuelo de verdad, no sólo descarta su respuesta. */
    cancel(draftId?: string): Promise<GitResult<{ cancelled: boolean }>>;
    /** Descarga el modelo a mano, sin esperar a que venza su TTL. */
    unload(model: string, baseUrl?: string): Promise<GitResult<{ unloaded: boolean }>>;
    /** Identificador de máquina → nombre legible. Resuelto una vez y guardado. */
    deviceNames(): Promise<GitResult<Record<string, string>>>;
    draft(args: {
      repoPath: string;
      paths: string[];
      changeId: string | null;
      intent: string | null;
      model: string;
      baseUrl?: string;
      maxTokens?: number;
      /** Con qué marca rotular lo que se transmita de esta redacción. */
      draftId?: string;
    }): Promise<GitResult<CommitDraftResult>>;
    /**
     * Lo que el modelo va produciendo, ya agrupado por el proceso principal.
     *
     * Devuelve cómo darse de baja. Sin suscribirse la redacción funciona igual y
     * en silencio, que es como funcionaba antes.
     */
    onChunk(cb: (event: DraftChunkEvent) => void): () => void;
    /** Avisos de estado de cada pedido de redacción (en fila, en curso, terminado, cancelado). */
    onDraftState(cb: (event: DraftStateEvent) => void): () => void;
    /** Modelo resuelto según la configuración de gitcron.json, error si está roto, o null si no aplica. */
    /** Con el repositorio, mezcla su gitcron.json sobre el global (D2). */
    resolvedModel(repoPath?: string | null): Promise<GitResult<CommitAiResolvedResult>>;
    /** Cambió un gitcron.json: el global (`repoPath: null`) o el de ese repositorio (D3). */
    onConfigChanged?(cb: (event: { repoPath: string | null }) => void): () => void;
    /** Último pedido efectivo enviado al proveedor (con procedencias y sin secretos), o null si no hubo. */
    lastRequest(): Promise<GitResult<CommitAiLastRequest | null>>;
  };
  /**
   * Cartografía Fase 3: motor CodeGraph embebido (local, solo lectura). Devuelve
   * SIEMPRE el contrato normalizado (lib/carto-types), nunca la forma cruda del motor.
   * Las queries devuelven `data: null` mientras el índice no esté `ready`.
   */
  cartoGraph: {
    /** Abre/indexa el repo en background. No bloquea; el avance llega por onProgress. */
    ensure(repoPath: string): Promise<GitResult<CartoGraphStatus>>;
    status(repoPath: string): Promise<GitResult<CartoGraphStatus>>;
    search(repoPath: string, query: string, limit?: number): Promise<GitResult<CartoSearchHit[] | null>>;
    callers(repoPath: string, nodeId: string): Promise<GitResult<CartoRelatedSymbol[] | null>>;
    callees(repoPath: string, nodeId: string): Promise<GitResult<CartoRelatedSymbol[] | null>>;
    impact(repoPath: string, nodeId: string): Promise<GitResult<CartoImpact | null>>;
    fileRelations(repoPath: string, filePath: string): Promise<GitResult<CartoFileRelations | null>>;
    /** Símbolos de un archivo (selector de nodos del panel de detalle). `null` si el índice no está listo. */
    fileSymbols(repoPath: string, filePath: string): Promise<GitResult<CartoNode[] | null>>;
    /** Foto global normalizada para la lente Grafo semántico. `null` si el índice no está listo. */
    snapshot(repoPath: string): Promise<GitResult<CartoGraph | null>>;
    /** Avance del indexado del repo. Devuelve un disposer. */
    onProgress(cb: (payload: { repoPath: string; status: CartoGraphStatus }) => void): () => void;
    /** El watch re-sincronizó el índice del repo (relaciones frescas). Devuelve un disposer. */
    onUpdated(cb: (payload: { repoPath: string }) => void): () => void;
  };
  /**
   * Cartografía Fase 4: capa de proveedor de IA (local LM Studio / online).
   * Opt-in y apagada por defecto. Las API keys nunca cruzan al renderer: se usan
   * sólo en main. Con la IA apagada o el proveedor caído, los métodos devuelven
   * `success: false` con un mensaje claro y la vista sigue funcionando sin IA.
   */
  cartoAi: {
    getSettings(): Promise<GitResult<CartoAISettings>>;
    setSettings(patch: Partial<CartoAISettings>): Promise<GitResult<CartoAISettings>>;
    /** Sondea disponibilidad sin gastar una generación (servidor local / key online). */
    probe(): Promise<GitResult<CartoAIProbe>>;
    explain(node: CartoAINodeRef, context: CartoAIContext): Promise<GitResult<CartoAIResponse>>;
    /**
     * Cartografía Fase 5: explica un NODO del grafo. Arma el contexto mínimo en main
     * (código + callers/callees/impacto), cachea por contenido y devuelve SIEMPRE la
     * estructura — la explicación de la IA sólo si está activa y disponible.
     */
    explainNode(repoPath: string, nodeId: string, lang?: string): Promise<GitResult<CartoExplainNodeResult>>;
    ask(question: string, context: CartoAIContext): Promise<GitResult<CartoAIResponse>>;
    /**
     * Cartografía Fase 6: pregunta libre scoped al repo activo. Recupera del grafo
     * los nodos que tocan la pregunta (búsqueda por nombre + vecinos por relación),
     * arma un contexto chico y responde citando archivos reales. Devuelve también
     * los nodos/archivos usados, para mostrarlos clickeables y abrir su detalle.
     */
    askRepo(repoPath: string, question: string, lang?: string): Promise<GitResult<CartoAskResult>>;
    /** Cartografía Fase 8: resumen top-down + recorridos guiados, cacheados por estructura. */
    panorama(repoPath: string, lang?: string, forceRefresh?: boolean): Promise<GitResult<CartoPanoramaResult>>;
  };
  repoWatch: (targetPath: string) => Promise<GitResult>;
  repoUnwatch: (targetPath: string) => Promise<GitResult>;
  onRepoFsChange: (cb: (repoPath: string, gitState?: boolean) => void) => () => void;
  onRepoCommitsChanged: (cb: (repoPath: string) => void) => () => void;
  pipelinePrewarm?: (repoPath: string) => Promise<{ success: boolean }>;
  pipelineGetSnapshot: (repoPath: string, selectedChangeId?: string | null) => Promise<GitResult<PipelineState>>;
  pipelineSubscribe: (repoPath: string, selectedChangeId?: string | null) => Promise<GitResult<PipelineState>>;
  pipelineUnsubscribe: (repoPath: string) => Promise<GitResult>;
  /** Plan del archivado: el comando que se va a ejecutar. No ejecuta nada. */
  pipelineArchivePlan: (repoPath: string, changeId: string) => Promise<GitResult<import('./pipeline').ArchivePlan>>;
  /** Archiva un change desde el proceso principal. No toca Git. Acepta motivo opcional. */
  pipelineArchiveChange: (repoPath: string, changeId: string, reason?: string) => Promise<GitResult & { watcherWarning?: string }>;
  /** Vista previa de sincronización de specs con openspec-sync-specs (Alternativa B). No escribe en disco. */
  pipelineSyncPreview: (
    repoPath: string,
    changeId: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    reason?: string;
    data?: {
      changeId: string;
      workflow: string;
      items: Array<{
        capability: string;
        mainSpecPath: string;
        deltaSpecPath: string;
        originalContent: string;
        proposedContent: string;
        diff: string;
      }>;
    };
  }>;
  /** Ejecución de sincronización de specs. Requiere confirmación explícita previa. No hace commit en Git. */
  pipelineSyncExecute: (
    repoPath: string,
    changeId: string,
    acceptedItems: Array<{ capability: string; content: string }>,
    options?: { confirmed?: boolean },
  ) => Promise<{ success: boolean; error?: string; stage?: string; filesWritten?: string[] }>;
  /** Cambia el estado de una tarea del change. `expectedText` verifica que sea la misma. */
  pipelineSetTaskChecked: (
    repoPath: string,
    changeId: string,
    line: number,
    expectedText: string,
    completed: boolean,
    actor?: 'persona' | 'agente',
  ) => Promise<GitResult>;
  /** Agrega una tarea al archivo tasks.md. */
  pipelineAddTask: (
    repoPath: string,
    changeId: string,
    text: string,
    options?: { line?: number; position?: 'above' | 'below' | 'end'; expectedText?: string; actor?: 'persona' | 'agente' },
    actor?: 'persona' | 'agente',
  ) => Promise<GitResult>;
  /** Edita el texto de una tarea. `expectedText` verifica coincidencia exacta previa. */
  pipelineEditTask: (
    repoPath: string,
    changeId: string,
    line: number,
    expectedText: string,
    newText: string,
    actor?: 'persona' | 'agente',
  ) => Promise<GitResult>;
  /** Mueve una tarea entre líneas. `expectedText` verifica coincidencia exacta previa. */
  pipelineMoveTask: (
    repoPath: string,
    changeId: string,
    fromLine: number,
    toLine: number,
    expectedText: string,
    actor?: 'persona' | 'agente',
  ) => Promise<GitResult>;
  /** Elimina una tarea. `expectedText` verifica coincidencia exacta previa. */
  pipelineRemoveTask: (
    repoPath: string,
    changeId: string,
    line: number,
    expectedText: string,
    actor?: 'persona' | 'agente',
  ) => Promise<GitResult>;
  /** Escribe el contenido de un artefacto del cambio validando contención en el proceso principal. */
  pipelineWriteArtifact: (
    repoPath: string,
    changeId: string,
    artifactId: string,
    content: string,
    options?: { overwrite?: boolean; actor?: 'persona' | 'agente'; targetFile?: string },
  ) => Promise<{ success: boolean; error?: string; stage?: string }>;
  /**
   * Contenido de una especificación consolidada, leído bajo demanda.
   *
   * No viaja en el snapshot por peso: las de un repositorio grande suman
   * cientos de kilobytes y el snapshot se rearma en cada refresco.
   */
  pipelineReadSpecification: (
    repoPath: string,
    specificationId: string,
  ) => Promise<{ success: true; content: string } | { success: false; error: string }>;
  /**
   * Inicializa OpenSpec en el repositorio. `needsTool` distingue «no encontró
   * ninguna herramienta que configurar» de un fallo: en ese caso hay que elegir.
   */
  pipelineInitOpenSpec: (
    repoPath: string,
    tools?: string[],
  ) => Promise<
    | { success: true; needsTool: false }
    | { success: false; error: string; needsTool: boolean }
  >;
  onPipelineSnapshotUpdated: (cb: (repoPath: string, snapshot: PipelineState) => void) => () => void;
  pipelineRuntime: {
    discover: (repoPath: string) => Promise<GitResult<RuntimeDiscoveryEntry[]>>;
    get: (repoPath: string) => Promise<GitResult<RuntimeProjection | null>>;
    history: (repoPath: string, limit?: number) => Promise<GitResult<RuntimeProjection[]>>;
    start: (payload: {
      repoPath: string;
      runtime: string;
      instruction: string;
      role?: string;
      requestedModel?: string | null;
      changeId?: string | null;
      taskId?: string | null;
    }) => Promise<GitResult<{ sessionId: string }>>;
    stop: (repoPath: string) => Promise<GitResult<boolean>>;
  };
  onPipelineRuntimeUpdated: (
    cb: (repoPath: string, projection: RuntimeProjection | null) => void,
  ) => () => void;
  pipelineControl: {
    pause: (payload: unknown) => Promise<unknown>;
    steer: (payload: unknown) => Promise<unknown>;
    queue: (payload: unknown) => Promise<unknown>;
    interrupt: (payload: unknown) => Promise<unknown>;
    killProcess: (payload: unknown) => Promise<unknown>;
    cancel: (payload: unknown) => Promise<unknown>;
    respondDecision: (payload: unknown) => Promise<unknown>;
  };
  materializeIdea(repoPath: string, idea: MaterializeIdeaInput): Promise<GitResult<MaterializationResult>>;
  ai: {
    predictTimelines(repoPath: string, repoName: string, lang?: string): Promise<GitResult<PredictionResult>>;
    loadPrediction(repoPath: string): Promise<GitResult<PredictionResult | null>>;
    hasKey(provider: string): Promise<GitResult<boolean>>;
    keyFingerprint(provider: string): Promise<GitResult<string | null>>;
    /** One-way: submits a key to be encrypted in main. The key never comes back. */
    setKey(provider: string, key: string): Promise<GitResult>;
    removeKey(provider: string): Promise<GitResult>;
    /** De dónde sale cada variable de `{env:}`: del sistema, guardada en GitCron o falta. Nunca el valor (D5). */
    envStatus(names: string[]): Promise<GitResult<Record<string, 'system' | 'stored' | 'missing'>>>;
    /** De ida: guarda la variable cifrada en main. El valor no vuelve. */
    setEnvVar(name: string, value: string): Promise<GitResult>;
    removeEnvVar(name: string): Promise<GitResult>;
    cancelPrediction(): Promise<GitResult>;
  };
  temporalAgent: {
    loadConfig(repoPath: string, repoName: string): Promise<TemporalAgentConfig>;
    saveConfig(repoPath: string, config: TemporalAgentConfig): Promise<{ success: true }>;
    loadNotes(repoPath: string, repoName: string): Promise<TemporalAgentNotes>;
    getNotesMarkdown(repoPath: string, repoName: string): Promise<string>;
    recordDecision(
      repoPath: string,
      repoName: string,
      decision: TemporalAgentDecision,
    ): Promise<TemporalAgentNotes>;
    removeDecision(
      repoPath: string,
      repoName: string,
      suggestionTitle: string,
    ): Promise<TemporalAgentNotes>;
    getHistory(repoPath?: string | null): Promise<PredictionHistoryEntry[]>;
  };
  pipelineOpenSpec: {
    getEngineStatus(repoPath?: string): Promise<import('./pipeline').OpenSpecEngineStatus>;
    checkLatestVersion(): Promise<import('./pipeline').OpenSpecRegistryCheck>;
    getUpdatePlan(repoPath: string): Promise<import('./pipeline').OpenSpecUpdatePlan>;
    executeUpdate(repoPath: string): Promise<import('./pipeline').OpenSpecExecuteResult>;
    runUpdate(repoPath: string, plan?: import('./pipeline').OpenSpecUpdatePlan, force?: boolean): Promise<import('./pipeline').OpenSpecRunUpdateResult>;
    getPreview(repoPath: string): Promise<import('./pipeline').OpenSpecPreviewResult>;
    getInstructions(options: {
      repoPath: string;
      target: string;
      changeId?: string | null;
      schema?: string | null;
    }): Promise<import('./pipeline').InstructionsOpenSpecResult>;
    getArtifactGraph(options: {
      repoPath: string;
      changeId: string;
    }): Promise<import('./pipeline').OpenSpecArtifactGraphResult>;
    executeCommand?: (options: {
      repoPath: string;
      command: string;
    }) => Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>;
    installLocal: (options: { repoPath: string; targetVersion?: string }) => Promise<import('./pipeline').OpenSpecInstallResult>;
    installGlobal: (options?: { repoPath?: string; targetVersion?: string }) => Promise<import('./pipeline').OpenSpecInstallResult>;
    getInstallPlan: (options?: string | { repoPath?: string; targetVersion?: string }) => Promise<import('./pipeline').OpenSpecInstallPlan>;
    /** Canal de escritura 7.2a. Opcional: cuando el preload aún no lo expone, el toggle del panel de perfil queda deshabilitado con motivo. */
    setWorkflow?: (options: { workflow: string; enabled: boolean }) => Promise<import('./pipeline').SetOpenSpecWorkflowResult>;
    /** Canal de escritura: cambia el perfil global a 'core' o 'custom'. */
    setProfile?: (payload: { profile: string }) => Promise<import('./pipeline').SetOpenSpecProfileResult>;
    getLegacySkillsPlan: (repoPath: string) => Promise<import('./pipeline').OpenSpecLegacySkillsPlan>;
    removeLegacySkills: (repoPath: string) => Promise<import('./pipeline').OpenSpecRemoveLegacySkillsResult>;
    versionAnalysis?: (
      repoPath: string,
      optionsOrForceRefresh?: boolean | { forceRefresh?: boolean; model?: string },
    ) => Promise<import('./pipeline').OpenSpecVersionAnalysisResult>;
    versionRedactionCancel?: () => Promise<{ cancelled: boolean }>;
    onRedactionChunk?: (
      cb: (event: { chunks: import('./commit-message-ai').DraftChunk[] }) => void,
    ) => () => void;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
