import { create } from 'zustand';
import type {
  StashEntry, SubmoduleEntry, GitHubUser,
  BranchTrackingInfo, WorktreeEntry, PullRequestEntry, RepoInfo, RemoteEntry,
} from '@/types/electron';
import type { CartoRoleId } from '@/lib/carto-roles';
import type { Lang } from '@/lib/i18n';

export type FontSize = 'compact' | 'normal' | 'large';
export type Theme = 'dark' | 'light';

export interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs?: string[];
}

export interface GitFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
  oldPath?: string;
  conflicted?: boolean;
}

export interface RepoState {
  path: string;
  name: string;
  currentBranch: string;
  branches: string[];
  remoteBranches: string[];
  commits: Commit[];
  modifiedFiles: GitFile[];
  stashes: StashEntry[];
  tags: string[];
  submodules: SubmoduleEntry[];
  remotes: RemoteEntry[];
  branchTracking: Record<string, BranchTrackingInfo>;
  defaultRemoteBranch: string | null;
  worktrees: WorktreeEntry[];
  pullRequests: PullRequestEntry[];
  commitMessage: string;
  selectedCommit: Commit | null;
  selectedFile: GitFile | null;
  currentDiff: string;
  graphShowAllBranches: boolean;
  graphMode: 'classic' | 'chronometric';
  cartographyExpandedRoles: CartoRoleId[];
  // Cartografía: sub-estado per-repo de "estoy en la vista Cartografía".
  // Sobrevive el cambio de tab de repo porque vive en RepoState, no en el
  // estado local de la página. Volver al grafo = ponerlo en false.
  inCartography: boolean;
  isLoading: boolean;
  error: string | null;
  success: string | null;
  lastFetchError: string | null;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  aiDraftRecord?: {
    recordId: string;
    originalSubject: string;
  } | null;
}

interface GitStore {
  openRepos: RepoState[];
  activeRepoIdx: number;
  getActiveRepo: () => RepoState | null;
  updateActiveRepo: (patch: Partial<RepoState>) => void;
  updateRepoByPath: (path: string, patch: Partial<RepoState>) => void;
  addOrActivateRepo: (info: RepoInfo) => void;
  setActiveRepoIdx: (idx: number) => void;
  closeRepo: (idx: number) => void;
  setOpenRepos: (openRepos: RepoState[]) => void;

  // Legacy active-repo API. These fields mirror openRepos[activeRepoIdx] so
  // existing hooks/components can keep working while multi-repo lands in steps.
  repoPath: string | null;
  repoName: string | null;
  currentBranch: string;
  branches: string[];
  remoteBranches: string[];
  commits: Commit[];
  modifiedFiles: GitFile[];
  stashes: StashEntry[];
  tags: string[];
  submodules: SubmoduleEntry[];
  remotes: RemoteEntry[];
  branchTracking: Record<string, BranchTrackingInfo>;
  defaultRemoteBranch: string | null;
  worktrees: WorktreeEntry[];
  pullRequests: PullRequestEntry[];
  commitMessage: string;
  selectedCommit: Commit | null;
  selectedFile: GitFile | null;
  currentDiff: string;
  isLoading: boolean;
  error: string | null;
  success: string | null;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  // GitHub auth
  githubToken: string | null;
  githubUser: GitHubUser | null;
  // Preferences
  language: Lang;
  fontSize: FontSize;
  defaultFolder: string | null;
  autoFetchEnabled: boolean;
  autoFetchIntervalMinutes: number;
  lastFetchTime: number | null;
  isFetchingRemote: boolean;
  osNotificationsEnabled: boolean;
  shortcuts: Record<string, string>;
  theme: Theme;
  enableCronometric: boolean;
  enableCartography: boolean;
  centauroReaderActive: boolean;

  setRepoPath: (path: string | null) => void;
  setRepoName: (name: string | null) => void;
  setCurrentBranch: (branch: string) => void;
  setCommitMessage: (message: string) => void;
  setSelectedCommit: (commit: Commit | null) => void;
  setSelectedFile: (file: GitFile | null) => void;
  setCurrentDiff: (diff: string) => void;
  setModifiedFiles: (files: GitFile[]) => void;
  setCommits: (commits: Commit[]) => void;
  setBranches: (branches: string[]) => void;
  setRemoteBranches: (branches: string[]) => void;
  setStashes: (stashes: StashEntry[]) => void;
  setTags: (tags: string[]) => void;
  setSubmodules: (submodules: SubmoduleEntry[]) => void;
  setRemotes: (remotes: RemoteEntry[]) => void;
  setBranchTracking: (tracking: Record<string, BranchTrackingInfo>) => void;
  setDefaultRemoteBranch: (defaultRemoteBranch: string | null) => void;
  setWorktrees: (worktrees: WorktreeEntry[]) => void;
  setPullRequests: (prs: PullRequestEntry[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSuccess: (message: string | null) => void;
  setGithubToken: (token: string | null) => void;
  setGithubUser: (user: GitHubUser | null) => void;
  setLanguage: (lang: Lang) => void;
  setFontSize: (size: FontSize) => void;
  setDefaultFolder: (folder: string | null) => void;
  setAutoFetchEnabled: (enabled: boolean) => void;
  setAutoFetchIntervalMinutes: (minutes: number) => void;
  setLastFetchTime: (ts: number | null) => void;
  setFetchingRemote: (fetching: boolean) => void;
  setOsNotificationsEnabled: (enabled: boolean) => void;
  setShortcuts: (shortcuts: Record<string, string>) => void;
  updateShortcut: (id: string, keys: string) => void;
  resetShortcuts: () => void;
  setTheme: (theme: Theme) => void;
  setEnableCronometric: (enabled: boolean) => void;
  setEnableCartography: (enabled: boolean) => void;
  setInCartography: (active: boolean) => void;
  setCentauroReaderActive: (active: boolean) => void;
  setMergeInProgress: (inProgress: boolean) => void;
  setRebaseInProgress: (inProgress: boolean) => void;
}

type EmptyRepoFields = Omit<RepoState, 'path' | 'name'>;

function createEmptyRepoFields(): EmptyRepoFields {
  return {
    currentBranch: '',
    branches: [],
    remoteBranches: [],
    commits: [],
    modifiedFiles: [],
    stashes: [],
    tags: [],
    submodules: [],
    remotes: [],
    branchTracking: {},
    defaultRemoteBranch: null,
    worktrees: [],
    pullRequests: [],
    commitMessage: '',
    selectedCommit: null,
    selectedFile: null,
    currentDiff: '',
    graphShowAllBranches: true,
    graphMode: 'classic',
    cartographyExpandedRoles: [],
    inCartography: false,
    isLoading: false,
    error: null,
    success: null,
    lastFetchError: null,
    mergeInProgress: false,
    rebaseInProgress: false,
    aiDraftRecord: null,
  };
}

const emptyLegacyRepoState = {
  repoPath: null,
  repoName: null,
  ...createEmptyRepoFields(),
};

function repoNameFromPath(repoPath: string): string {
  return repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath;
}

function createRepoState(info: RepoInfo): RepoState {
  return {
    path: info.path,
    name: info.name,
    ...createEmptyRepoFields(),
    currentBranch: info.currentBranch,
  };
}

function legacyFromRepo(repo: RepoState | null) {
  if (!repo) return emptyLegacyRepoState;
  return {
    repoPath: repo.path,
    repoName: repo.name,
    currentBranch: repo.currentBranch,
    branches: repo.branches,
    remoteBranches: repo.remoteBranches,
    commits: repo.commits,
    modifiedFiles: repo.modifiedFiles,
    stashes: repo.stashes,
    tags: repo.tags,
    submodules: repo.submodules,
    remotes: repo.remotes,
    branchTracking: repo.branchTracking,
    defaultRemoteBranch: repo.defaultRemoteBranch,
    worktrees: repo.worktrees,
    pullRequests: repo.pullRequests,
    commitMessage: repo.commitMessage,
    selectedCommit: repo.selectedCommit,
    selectedFile: repo.selectedFile,
    currentDiff: repo.currentDiff,
    isLoading: repo.isLoading,
    error: repo.error,
    success: repo.success,
    mergeInProgress: repo.mergeInProgress,
    rebaseInProgress: repo.rebaseInProgress,
  };
}

function activeRepoFrom(openRepos: RepoState[], activeRepoIdx: number): RepoState | null {
  return openRepos[activeRepoIdx] ?? null;
}

/**
 * Campos de `GitFile` que se comparan por valor cuando `modifiedFiles` viene en
 * un patch. El tipo `Required<GitFile>` obliga a enumerar **todos** los campos:
 * si `GitFile` gana uno, `tsc --noEmit` falla aquí y nadie puede olvidarse de
 * compararlo. Sin esto, una omisión silenciaría el store ante un cambio real y
 * la UI no se actualizaría — el defecto se nota como vista desactualizada, no
 * como error.
 *
 * Los cinco se comparan: `path`, `status`, `staged`, `oldPath` y `conflicted`.
 * `conflicted` es el peligroso: un archivo que entra en conflicto durante un
 * merge conserva `path`, `status` y `staged`, sólo cambia `conflicted`. Un
 * comparador de tres campos diría «sin delta» y la UI no mostraría el conflicto.
 */
const GIT_FILE_CAMPOS_COMPARADOS: Record<keyof Required<GitFile>, true> = {
  path: true,
  status: true,
  staged: true,
  oldPath: true,
  conflicted: true,
};

/**
 * Igualdad por contenido para dos arrays de `GitFile`. Trata ausencia y
 * `undefined` como iguales (campos opcionales), para no notificar sin necesidad.
 * Medido: ≤475 ns para 100 archivos; despreciable frente a los 42 ms del
 * `git status` que dispara el latido.
 */
function gitFilesIguales(a: GitFile[], b: GitFile[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    for (const campo in GIT_FILE_CAMPOS_COMPARADOS) {
      const vx = x[campo as keyof GitFile];
      const vy = y[campo as keyof GitFile];
      // `undefined` y ausente son lo mismo para los opcionales.
      if ((vx ?? undefined) !== (vy ?? undefined)) return false;
    }
  }
  return true;
}

/**
 * ¿El patch cambia algo respecto del repo actual?
 *
 * Devuelve `false` si ningún valor del `patch` difiere del campo homólogo en
 * `repo`. Es la defensa contra el re-render ocioso: el latido de `use-repo-loader`
 * llama a `refreshStatus` cada 2 s, y cuando `git status` devuelve lo que ya vive
 * en el store, este guard evita reconstruir `openRepos` y notificar.
 *
 * La regla de comparación: `Object.is` para todo campo, **salvo `modifiedFiles`**,
 * que se compara por contenido. La excepción existe porque el IPC de `gitStatus`
 * siempre devuelve un array nuevo aunque el contenido sea idéntico, y ése es
 * justamente el campo que el latido mueve cada 2 s. Compararlo por referencia
 * anularía el guard para el caso que vino a cubrir. Los demás arrays del patch
 * (`commits`, `branches`, etc.) son referencias nuevas del IPC también, pero
 * llegan por acción de la persona o por un evento real de filesystem, no cada 2
 * segundos, así que no reciben el mismo trato. Si el próximo array del IPC
 * llegara a moverse en un latido, hay que decidir si merece su propia excepción:
 * copiar este patrón a ciegas sin esa consideración es el modo de silenciar un
 * cambio real.
 */
function repoPatchHasDelta(repo: RepoState, patch: Partial<RepoState>): boolean {
  for (const key in patch) {
    const k = key as keyof RepoState;
    if (k === 'modifiedFiles') {
      if (!gitFilesIguales(repo.modifiedFiles, patch.modifiedFiles as GitFile[])) return true;
    } else if (!Object.is(patch[k], repo[k])) {
      return true;
    }
  }
  return false;
}

export const useGitStore = create<GitStore>((set, get) => ({
  openRepos: [],
  activeRepoIdx: -1,
  getActiveRepo: () => activeRepoFrom(get().openRepos, get().activeRepoIdx),
  updateActiveRepo: (patch) => {
    // Verificación con `get()` antes de `set`: Zustand notifica siempre que se
    // llama a `set`, aunque el updater devuelva `{}` o el mismo estado. La
    // única forma de no notificar es no llamar a `set`. `repoPatchHasDelta`
    // decide si hay algo que escribir.
    const state = get();
    const activeRepo = activeRepoFrom(state.openRepos, state.activeRepoIdx);
    if (!activeRepo || !repoPatchHasDelta(activeRepo, patch)) return;

    set(() => {
      const openRepos = state.openRepos.map((repo, idx) => (
        idx === state.activeRepoIdx ? { ...repo, ...patch } : repo
      ));
      return {
        openRepos,
        ...legacyFromRepo(activeRepoFrom(openRepos, state.activeRepoIdx)),
      };
    });
  },
  updateRepoByPath: (path, patch) => {
    const state = get();
    const repoIdx = state.openRepos.findIndex((repo) => repo.path === path);
    if (repoIdx === -1) return;

    const existing = state.openRepos[repoIdx];
    if (!repoPatchHasDelta(existing, patch)) return;

    set(() => {
      const openRepos = state.openRepos.map((repo, idx) => (
        idx === repoIdx ? { ...repo, ...patch } : repo
      ));
      return {
        openRepos,
        ...legacyFromRepo(activeRepoFrom(openRepos, state.activeRepoIdx)),
      };
    });
  },
  addOrActivateRepo: (info) => set((state) => {
    const existingIdx = state.openRepos.findIndex((repo) => repo.path === info.path);
    const activeRepoIdx = existingIdx >= 0 ? existingIdx : state.openRepos.length;
    const openRepos = existingIdx >= 0
      ? state.openRepos.map((repo, idx) => (
        idx === existingIdx
          ? { ...repo, name: info.name, currentBranch: info.currentBranch }
          : repo
      ))
      : [...state.openRepos, createRepoState(info)];

    return {
      openRepos,
      activeRepoIdx,
      ...legacyFromRepo(activeRepoFrom(openRepos, activeRepoIdx)),
    };
  }),
  setActiveRepoIdx: (idx) => set((state) => {
    if (idx < 0 || idx >= state.openRepos.length) return {};
    return {
      activeRepoIdx: idx,
      ...legacyFromRepo(activeRepoFrom(state.openRepos, idx)),
    };
  }),
  closeRepo: (idx) => set((state) => {
    if (idx < 0 || idx >= state.openRepos.length) return {};

    const openRepos = state.openRepos.filter((_, repoIdx) => repoIdx !== idx);
    const activeRepoIdx = openRepos.length === 0
      ? -1
      : idx < state.activeRepoIdx
        ? state.activeRepoIdx - 1
        : Math.min(state.activeRepoIdx, openRepos.length - 1);

    return {
      openRepos,
      activeRepoIdx,
      ...legacyFromRepo(activeRepoFrom(openRepos, activeRepoIdx)),
    };
  }),

  repoPath: null,
  repoName: null,
  currentBranch: '',
  branches: [],
  remoteBranches: [],
  commits: [],
  modifiedFiles: [],
  stashes: [],
  tags: [],
  submodules: [],
  remotes: [],
  branchTracking: {},
  defaultRemoteBranch: null,
  worktrees: [],
  pullRequests: [],
  commitMessage: '',
  selectedCommit: null,
  selectedFile: null,
  currentDiff: '',
  isLoading: false,
  error: null,
  success: null,
  mergeInProgress: false,
  rebaseInProgress: false,
  // Token starts null. It's hydrated asynchronously on app mount via
  // bootstrapGitHub() -> window.api.storageGet(). We DO NOT use localStorage:
  // tokens live encrypted at-rest via Electron's safeStorage (OS keychain).
  githubToken: null,
  githubUser: null,
  language: 'es',
  fontSize: 'compact',
  defaultFolder: null,
  autoFetchEnabled: true,
  autoFetchIntervalMinutes: 10,
  lastFetchTime: null,
  isFetchingRemote: false,
  osNotificationsEnabled: true,
  shortcuts: {},
  theme: 'dark',
  enableCronometric: false,
  enableCartography: false,
  centauroReaderActive: false,

  setRepoPath: (repoPath) => set((state) => {
    if (!repoPath) {
      return { openRepos: [], activeRepoIdx: -1, ...emptyLegacyRepoState };
    }

    const existingIdx = state.openRepos.findIndex((repo) => repo.path === repoPath);
    const activeRepoIdx = existingIdx >= 0 ? existingIdx : state.openRepos.length;
    const openRepos = existingIdx >= 0
      ? state.openRepos
      : [
        ...state.openRepos,
        {
          path: repoPath,
          name: repoNameFromPath(repoPath),
          ...createEmptyRepoFields(),
        },
      ];

    return {
      openRepos,
      activeRepoIdx,
      ...legacyFromRepo(activeRepoFrom(openRepos, activeRepoIdx)),
    };
  }),
  setRepoName: (repoName) => get().updateActiveRepo({ name: repoName ?? '' }),
  setCurrentBranch: (currentBranch) => get().updateActiveRepo({ currentBranch }),
  setCommitMessage: (commitMessage) => get().updateActiveRepo({ commitMessage }),
  setSelectedCommit: (selectedCommit) => get().updateActiveRepo({ selectedCommit }),
  setSelectedFile: (selectedFile) => get().updateActiveRepo({ selectedFile }),
  setCurrentDiff: (currentDiff) => get().updateActiveRepo({ currentDiff }),
  setModifiedFiles: (modifiedFiles) => get().updateActiveRepo({ modifiedFiles }),
  setCommits: (commits) => get().updateActiveRepo({ commits }),
  setBranches: (branches) => get().updateActiveRepo({ branches }),
  setRemoteBranches: (remoteBranches) => get().updateActiveRepo({ remoteBranches }),
  setStashes: (stashes) => get().updateActiveRepo({ stashes }),
  setTags: (tags) => get().updateActiveRepo({ tags }),
  setSubmodules: (submodules) => get().updateActiveRepo({ submodules }),
  setRemotes: (remotes) => get().updateActiveRepo({ remotes }),
  setBranchTracking: (branchTracking) => get().updateActiveRepo({ branchTracking }),
  setDefaultRemoteBranch: (defaultRemoteBranch) => get().updateActiveRepo({ defaultRemoteBranch }),
  setWorktrees: (worktrees) => get().updateActiveRepo({ worktrees }),
  setPullRequests: (pullRequests) => get().updateActiveRepo({ pullRequests }),
  setMergeInProgress: (mergeInProgress) => get().updateActiveRepo({ mergeInProgress }),
  setRebaseInProgress: (rebaseInProgress) => get().updateActiveRepo({ rebaseInProgress }),
  setLoading: (isLoading) => {
    const state = get();
    if (state.activeRepoIdx >= 0) state.updateActiveRepo({ isLoading });
    else set({ isLoading });
  },
  setError: (error) => {
    const state = get();
    if (state.activeRepoIdx >= 0) state.updateActiveRepo({ error });
    else set({ error });
  },
  setSuccess: (success) => {
    const state = get();
    if (state.activeRepoIdx >= 0) state.updateActiveRepo({ success });
    else set({ success });
  },
  // Pure state setter — persistence is handled by hooks via IPC (safeStorage)
  setGithubToken: (githubToken) => set({ githubToken }),
  setLanguage: (language) => set({ language }),
  setFontSize: (fontSize) => set({ fontSize }),
  setDefaultFolder: (defaultFolder) => set({ defaultFolder }),
  setAutoFetchEnabled: (autoFetchEnabled) => set({ autoFetchEnabled }),
  setAutoFetchIntervalMinutes: (autoFetchIntervalMinutes) => set({ autoFetchIntervalMinutes }),
  setLastFetchTime: (lastFetchTime) => set({ lastFetchTime }),
  setFetchingRemote: (isFetchingRemote) => set({ isFetchingRemote }),
  setOsNotificationsEnabled: (osNotificationsEnabled) => set({ osNotificationsEnabled }),
  setShortcuts: (shortcuts) => set({ shortcuts }),
  updateShortcut: (id, keys) => set((s) => ({ shortcuts: { ...s.shortcuts, [id]: keys } })),
  resetShortcuts: () => set({ shortcuts: {} }),
  setTheme: (theme) => set({ theme }),
  setEnableCronometric: (enableCronometric) => set({ enableCronometric }),
  setEnableCartography: (enableCartography) => set({ enableCartography }),
  setInCartography: (inCartography) => get().updateActiveRepo({ inCartography }),
  setCentauroReaderActive: (centauroReaderActive) => set({ centauroReaderActive }),
  setGithubUser: (githubUser) => set({ githubUser }),
  setOpenRepos: (openRepos) => set((state) => {
    const activeRepo = state.openRepos[state.activeRepoIdx] ?? null;
    const activeRepoIdx = activeRepo
      ? openRepos.findIndex((r) => r.path === activeRepo.path)
      : -1;
    return {
      openRepos,
      activeRepoIdx,
      ...legacyFromRepo(activeRepoFrom(openRepos, activeRepoIdx)),
    };
  }),
}));
