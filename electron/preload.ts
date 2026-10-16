import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  gitCommand: (repoPath: string, args: string[]) => ipcRenderer.invoke('git:command', repoPath, args),
  githubTest: (token: string, owner: string, repo: string) =>
    ipcRenderer.invoke('github:test', { token, owner, repo }),
  githubAuth: (token: string) => ipcRenderer.invoke('github:auth', token),
  githubDeviceStart: () => ipcRenderer.invoke('github:device-start'),
  githubDevicePoll: (deviceCode: string) => ipcRenderer.invoke('github:device-poll', deviceCode),
  openRepo: (defaultPath?: string) => ipcRenderer.invoke('git:open-repo', defaultPath),
  openPath: (dirPath: string) => ipcRenderer.invoke('git:open-path', dirPath),
  checkRepoPath: (dirPath: string) => ipcRenderer.invoke('git:check-repo-path', dirPath),
  closeRepo: (repoPath: string) => ipcRenderer.invoke('git:close-repo', repoPath),
  pickFolder: (title?: string, defaultPath?: string) => ipcRenderer.invoke('fs:pick-folder', title, defaultPath),
  gitApplyPatchFile: (repoPath: string) => ipcRenderer.invoke('git:apply-patch-file', repoPath),
  gitInit: (parentPath: string, name: string, withInitialCommit?: boolean) =>
    ipcRenderer.invoke('git:init', parentPath, name, withInitialCommit ?? true),
  gitClone: (url: string, parentPath: string, folderName: string, token?: string) =>
    ipcRenderer.invoke('git:clone', url, parentPath, folderName, token),
  githubCreateRepo: (token: string, name: string, isPrivate: boolean, description?: string, autoInit?: boolean) =>
    ipcRenderer.invoke('github:create-repo', token, name, isPrivate, description, autoInit),
  fsExistsAndNotEmpty: (parentPath: string, name: string) =>
    ipcRenderer.invoke('fs:exists-and-not-empty', parentPath, name),
  githubListUserRepos: (token: string) =>
    ipcRenderer.invoke('github:list-user-repos', token),
  gitLog: (repoPath: string, opts?: { allBranches?: boolean }) => ipcRenderer.invoke('git:log', repoPath, opts),
  gitFileHistory: (repoPath: string, filePath: string, limit?: number) =>
    ipcRenderer.invoke('git:file-history', repoPath, filePath, limit),
  gitBlame: (repoPath: string, filePath: string, rev?: string) =>
    ipcRenderer.invoke('git:blame', repoPath, filePath, rev),
  gitStatus: (repoPath: string) => ipcRenderer.invoke('git:status', repoPath),
  gitIndexSignature: (repoPath: string) => ipcRenderer.invoke('git:index-signature', repoPath),
  gitBranches: (repoPath: string) => ipcRenderer.invoke('git:branches', repoPath),
  gitDefaultBranch: (repoPath: string, remote: string) =>
    ipcRenderer.invoke('git:default-branch', repoPath, remote),
  gitCheckout: (repoPath: string, branch: string) =>
    ipcRenderer.invoke('git:checkout', repoPath, branch),
  gitCreateBranch: (repoPath: string, name: string, fromHash?: string) =>
    ipcRenderer.invoke('git:create-branch', repoPath, name, fromHash),
  gitRestoreMaterializedBranch: (repoPath: string, branchName: string, sourceTag: string) =>
    ipcRenderer.invoke('git:restore-materialized-branch', repoPath, branchName, sourceTag),
  gitMergeBranch: (repoPath: string, sourceBranch: string) =>
    ipcRenderer.invoke('git:merge-branch', repoPath, sourceBranch),
  gitRebase: (repoPath: string, ontoBranch: string) =>
    ipcRenderer.invoke('git:rebase', repoPath, ontoBranch),
  gitFastForward: (repoPath: string, branch: string, toRef: string) =>
    ipcRenderer.invoke('git:fast-forward', repoPath, branch, toRef),
  gitRenameBranch: (repoPath: string, oldName: string, newName: string) =>
    ipcRenderer.invoke('git:rename-branch', repoPath, oldName, newName),
  gitDeleteBranch: (repoPath: string, branch: string, force?: boolean) =>
    ipcRenderer.invoke('git:delete-branch', repoPath, branch, force ?? false),
  gitRepointUpstream: (repoPath: string, branch: string, token?: string) =>
    ipcRenderer.invoke('git:repoint-upstream', repoPath, branch, token),
  gitDeleteRemoteBranch: (repoPath: string, remote: string, branch: string, token?: string) =>
    ipcRenderer.invoke('git:delete-remote-branch', repoPath, remote, branch, token),
  gitIsBranchMerged: (repoPath: string, branch: string, base?: string) =>
    ipcRenderer.invoke('git:is-branch-merged', repoPath, branch, base),
  gitPullBranch: (repoPath: string, branch: string, token?: string) =>
    ipcRenderer.invoke('git:pull-branch', repoPath, branch, token),
  gitPushBranch: (repoPath: string, branch: string, token?: string, force?: boolean) =>
    ipcRenderer.invoke('git:push-branch', repoPath, branch, token, force),
  gitPush: (repoPath: string, token?: string) => ipcRenderer.invoke('git:push', repoPath, token),
  gitPull: (repoPath: string, token?: string) => ipcRenderer.invoke('git:pull', repoPath, token),
  gitPullFastForward: (repoPath: string, token?: string) =>
    ipcRenderer.invoke('git:pull-ff-only', repoPath, token),
  gitPullRebase: (repoPath: string, token?: string) =>
    ipcRenderer.invoke('git:pull-rebase', repoPath, token),
  gitPullMerge: (repoPath: string, token?: string) =>
    ipcRenderer.invoke('git:pull-merge', repoPath, token),
  gitFetch: (repoPath: string, token?: string) => ipcRenderer.invoke('git:fetch', repoPath, token),
  gitStage: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('git:stage', repoPath, filePath),
  gitUnstage: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('git:unstage', repoPath, filePath),
  gitStageBatch: (repoPath: string, filePaths: string[], force?: boolean) =>
    ipcRenderer.invoke('git:stage-batch', repoPath, filePaths, force),
  gitUnstageBatch: (repoPath: string, filePaths: string[]) =>
    ipcRenderer.invoke('git:unstage-batch', repoPath, filePaths),
  gitRemoveLock: (repoPath: string) =>
    ipcRenderer.invoke('git:remove-lock', repoPath),
  gitTrustSafeDirectory: (repoPath: string) =>
    ipcRenderer.invoke('git:trust-safe-directory', repoPath),
  gitAmend: (repoPath: string, newMessage?: string) =>
    ipcRenderer.invoke('git:amend', repoPath, newMessage),
  gitCherryPick: (repoPath: string, hash: string) =>
    ipcRenderer.invoke('git:cherry-pick', repoPath, hash),
  gitSquash: (repoPath: string, n: number, message: string) =>
    ipcRenderer.invoke('git:squash', repoPath, n, message),
  gitRebasePrepare: (repoPath: string, commitHash: string) =>
    ipcRenderer.invoke('git:rebase-prepare', repoPath, commitHash),
  gitRebaseStart: (repoPath: string, baseHash: string, plan: any[]) =>
    ipcRenderer.invoke('git:rebase-start', repoPath, baseHash, plan),
  gitRebaseContinue: (repoPath: string) =>
    ipcRenderer.invoke('git:rebase-continue', repoPath),
  gitRebaseAbort: (repoPath: string) =>
    ipcRenderer.invoke('git:rebase-abort', repoPath),
  gitRebaseUndo: (repoPath: string, targetRef: string) =>
    ipcRenderer.invoke('git:rebase-undo', repoPath, targetRef),
  gitShowFiles: (repoPath: string, hash: string) =>
    ipcRenderer.invoke('git:show-files', repoPath, hash),
  gitDiffAtCommit: (repoPath: string, filePath: string, hash: string) =>
    ipcRenderer.invoke('git:diff-at-commit', repoPath, filePath, hash),
  gitAddToGitignore: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('git:add-to-gitignore', repoPath, filePath),
  gitResetAll: (repoPath: string) =>
    ipcRenderer.invoke('git:reset-all', repoPath),
  gitClean: (repoPath: string, files?: string[]) =>
    ipcRenderer.invoke('git:clean', repoPath, files),
  gitReadFile: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('git:read-file', repoPath, filePath),
  gitResolveConflictFile: (repoPath: string, filePath: string, content: string) =>
    ipcRenderer.invoke('git:resolve-conflict-file', repoPath, filePath, content),
  gitStashFile: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('git:stash-file', repoPath, filePath),
  shellShowInFolder: (repoPath: string, relativeFilePath: string) =>
    ipcRenderer.invoke('shell:show-in-folder', repoPath, relativeFilePath),
  shellOpenItem: (repoPath: string, relativeFilePath: string) =>
    ipcRenderer.invoke('shell:open-item', repoPath, relativeFilePath),
  fsDeleteFile: (repoPath: string, relativeFilePath: string) =>
    ipcRenderer.invoke('fs:delete-file', repoPath, relativeFilePath),
  gitDiff: (repoPath: string, filePath: string, staged?: boolean) =>
    ipcRenderer.invoke('git:diff', repoPath, filePath, staged ?? false),
  gitDiffHunks: (repoPath: string, filePath: string, staged?: boolean) =>
    ipcRenderer.invoke('git:diff-hunks', repoPath, filePath, staged ?? false),
  gitApplyHunk: (repoPath: string, filePath: string, hunkPatch: string, options: unknown) =>
    ipcRenderer.invoke('git:apply-hunk', repoPath, filePath, hunkPatch, options),
  gitStashList: (repoPath: string) => ipcRenderer.invoke('git:stash-list', repoPath),
  gitStashPush: (repoPath: string, message?: string) =>
    ipcRenderer.invoke('git:stash-push', repoPath, message),
  gitStashApply: (repoPath: string, index: number) =>
    ipcRenderer.invoke('git:stash-apply', repoPath, index),
  gitStashPop: (repoPath: string, index: number) =>
    ipcRenderer.invoke('git:stash-pop', repoPath, index),
  gitStashDrop: (repoPath: string, index: number) =>
    ipcRenderer.invoke('git:stash-drop', repoPath, index),
  gitStashPreview: (repoPath: string, index: number) =>
    ipcRenderer.invoke('git:stash-preview', repoPath, index),
  gitStashClear: (repoPath: string) =>
    ipcRenderer.invoke('git:stash-clear', repoPath),
  gitDeleteTag: (repoPath: string, tagName: string) =>
    ipcRenderer.invoke('git:delete-tag', repoPath, tagName),
  gitCreateTag: (repoPath: string, tagName: string, commitHash: string, message?: string) =>
    ipcRenderer.invoke('git:create-tag', repoPath, tagName, commitHash, message),
  gitPushTag: (repoPath: string, tagName: string, token?: string) =>
    ipcRenderer.invoke('git:push-tag', repoPath, tagName, token),
  gitResetCommit: (repoPath: string, commitHash: string, mode: 'soft' | 'mixed' | 'hard') =>
    ipcRenderer.invoke('git:reset-commit', repoPath, commitHash, mode),
  gitTags: (repoPath: string) => ipcRenderer.invoke('git:tags', repoPath),
  gitSubmodules: (repoPath: string) => ipcRenderer.invoke('git:submodules', repoPath),
  gitWorktrees: (repoPath: string) => ipcRenderer.invoke('git:worktrees', repoPath),
  gitRemotesList: (repoPath: string) => ipcRenderer.invoke('git:remotes-list', repoPath),
  gitRemoteAdd: (repoPath: string, name: string, url: string) => ipcRenderer.invoke('git:remote-add', repoPath, name, url),
  gitAddExistingGitHubRemote: (repoPath: string, remoteUrl: string, token?: string) =>
    ipcRenderer.invoke('git:add-existing-github-remote', repoPath, remoteUrl, token),
  gitInspectExistingGitHubRemote: (repoPath: string, remoteUrl: string, token?: string) =>
    ipcRenderer.invoke('git:inspect-existing-github-remote', repoPath, remoteUrl, token),
  gitAdoptExistingGitHubRemote: (repoPath: string, remoteUrl: string, token?: string) =>
    ipcRenderer.invoke('git:adopt-existing-github-remote', repoPath, remoteUrl, token),
  gitRemoteRemove: (repoPath: string, name: string) => ipcRenderer.invoke('git:remote-remove', repoPath, name),
  gitRemoteSetUrl: (repoPath: string, name: string, url: string) => ipcRenderer.invoke('git:remote-set-url', repoPath, name, url),
  gitRemoteRename: (repoPath: string, oldName: string, newName: string) => ipcRenderer.invoke('git:remote-rename', repoPath, oldName, newName),
  gitWorktreeAdd: (repoPath: string, path: string, branch: string) => ipcRenderer.invoke('git:worktree-add', repoPath, path, branch),
  gitWorktreeRemove: (repoPath: string, path: string, force?: boolean) => ipcRenderer.invoke('git:worktree-remove', repoPath, path, force),
  gitWorktreePurge: (repoPath: string, worktreePath: string) =>
    ipcRenderer.invoke('git:worktree-purge', repoPath, worktreePath),
  gitSubmoduleUpdate: (repoPath: string, path?: string, init?: boolean) => ipcRenderer.invoke('git:submodule-update', repoPath, path, init),
  gitSubmoduleAdd: (repoPath: string, url: string, path: string) => ipcRenderer.invoke('git:submodule-add', repoPath, url, path),
  gitSubmoduleSync: (repoPath: string) => ipcRenderer.invoke('git:submodule-sync', repoPath),
  githubListPRs: (token: string, repoPath: string) => ipcRenderer.invoke('github:list-prs', token, repoPath),
  githubGetPRDiff: (token: string, repoPath: string, number: number) =>
    ipcRenderer.invoke('github:get-pr-diff', token, repoPath, number),
  terminalOpen: (repoPath: string) => ipcRenderer.invoke('terminal:open', repoPath),
  shellOpenPath: (targetPath: string) => ipcRenderer.invoke('shell:open-path', targetPath),
  shellOpenExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  storageSet: (key: string, value: string) => ipcRenderer.invoke('storage:set', key, value),
  storageGet: (key: string) => ipcRenderer.invoke('storage:get', key),
  storageDelete: (key: string) => ipcRenderer.invoke('storage:delete', key),
  checkForUpdate: () => ipcRenderer.invoke('app:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  getChangelog: () => ipcRenderer.invoke('app:get-changelog'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  // La ventana también cambia de estado por fuera del botón —doble clic en la
  // barra, `Win`+flechas, arrastrar contra un borde—, así que el ícono se
  // entera por evento y no sólo por el resultado de su propio clic.
  onWindowState: (cb: (state: { maximized: boolean }) => void) => {
    const handler = (_e: unknown, state: { maximized: boolean }) => cb(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  },
  windowClose: () => ipcRenderer.invoke('window:close'),
  onUpdateNotAvailable: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('update:not-available', handler);
    return () => ipcRenderer.removeListener('update:not-available', handler);
  },
  onUpdateAvailable: (cb: (info: { version: string; currentVersion: string; releaseDate?: string }) => void) => {
    const handler = (_e: unknown, info: { version: string; currentVersion: string; releaseDate?: string }) => cb(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateDownloaded: (cb: (info: { version: string; currentVersion: string; releaseDate?: string }) => void) => {
    const handler = (_e: unknown, info: { version: string; currentVersion: string; releaseDate?: string }) => cb(info);
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
  onUpdateError: (cb: (msg: string) => void) => {
    const handler = (_e: unknown, msg: string) => cb(msg);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },
  onDownloadProgress: (cb: (info: { percent: number; transferred: number; total: number }) => void) => {
    const handler = (_e: unknown, info: { percent: number; transferred: number; total: number }) => cb(info);
    ipcRenderer.on('update:download-progress', handler);
    return () => ipcRenderer.removeListener('update:download-progress', handler);
  },
  // Qué modelo usa cada uso de texto según gitcron.json, y «usar lo que tenías»
  // (tarea 4.3 de modelos-en-casa). Sin secretos.
  aiUse: {
    status: (args: { use: string; repoPath?: string | null; screenModel?: string | null }) =>
      ipcRenderer.invoke('ai-use:status', args),
    models: (args: { use: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-use:models', args),
    refreshModels: (args: { use: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-use:refresh-models', args),
    onModelsUpdated: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on('ai-use:models-updated', listener);
      return () => ipcRenderer.off('ai-use:models-updated', listener);
    },
    choose: (args: { use: string; repoPath?: string | null; model: string; effort?: string; variant?: string }) =>
      ipcRenderer.invoke('ai-use:choose', args),
    adopt: (args: { use: string; repoPath?: string | null; screenModel?: string | null }) =>
      ipcRenderer.invoke('ai-use:adopt', args),
    lastRequest: (args: { use: string }) =>
      ipcRenderer.invoke('ai-use:last-request', args),
  },
  aiConfig: {
    status: (args?: { repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:status', args),
    providerModels: (args: { providerId: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:provider-models', args),
    addProvider: (args: { id: string; name: string; baseURL: string; apiKey?: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:add-provider', args),
    removeProvider: (args: { id: string; repoPath?: string | null; deleteStoredVar?: boolean }) =>
      ipcRenderer.invoke('ai-config:remove-provider', args),
    addModel: (args: { providerId: string; modelId: string; name?: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:add-model', args),
    removeModel: (args: { providerId: string; modelId: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:remove-model', args),
    getModelLoadSettings: (args: { providerId?: string; modelId: string; use?: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:get-model-load-settings', args),
    setModelLoadSettings: (args: { providerId?: string; modelId: string; use?: string; repoPath?: string | null; contextLength?: number; ttlMinutes?: number }) =>
      ipcRenderer.invoke('ai-config:set-model-load-settings', args),
    setGeneralModel: (args: { model: string; effort?: string; variant?: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:set-general-model', args),
    clearUseException: (args: { use: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:clear-use-exception', args),
    setUseParam: (args: { use: string; param: string; value: unknown; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:set-use-param', args),
    removeUseParam: (args: { use: string; param: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:remove-use-param', args),
    openFile: (args: { filePath: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:open-file', args),
    showInFolder: (args: { filePath: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:show-in-folder', args),
    readFileContent: (args: { scope?: 'global' | 'repo'; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:read-file-content', args),
    saveFileContent: (args: { scope?: 'global' | 'repo'; repoPath?: string | null; content?: string; baseHash?: string }) =>
      ipcRenderer.invoke('ai-config:save-file-content', args),
    // Importar desde OpenCode y servidores MCP: las rutas las decide el proceso principal.
    planOpenCodeImport: () =>
      ipcRenderer.invoke('ai-config:plan-opencode-import'),
    applyOpenCodeImport: (args: { entries: Array<{ kind: 'provider' | 'agent'; id: string }> }) =>
      ipcRenderer.invoke('ai-config:apply-opencode-import', args),
    getMcpStatus: (args?: { repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:get-mcp-status', args),
    removeMcpServer: (args: { filePath: string; name: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:remove-mcp-server', args),
    planMcpImport: (args: { source: 'cursor' | 'lmstudio' | 'opencode' }) =>
      ipcRenderer.invoke('ai-config:plan-mcp-import', args),
    applyMcpImport: (args: { source: 'cursor' | 'lmstudio' | 'opencode'; entries: string[] }) =>
      ipcRenderer.invoke('ai-config:apply-mcp-import', args),
    prepareMcpCopy: (args: { filePath: string; name: string; target: 'claude' | 'vscode' | 'opencode'; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:prepare-mcp-copy', args),
    copyMcpToClipboard: (args: { filePath: string; name: string; target: 'claude' | 'vscode' | 'opencode'; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:copy-mcp-to-clipboard', args),
    saveMcpLiteralSecrets: (args: { filePath: string; name: string; repoPath?: string | null }) =>
      ipcRenderer.invoke('ai-config:save-mcp-literal-secrets', args),
    onConfigChanged: (cb: (event: { repoPath: string | null }) => void) => {
      const handler = (_e: unknown, payload: { repoPath: string | null }) => cb(payload);
      ipcRenderer.on('gitcron-config:changed', handler);
      return () => ipcRenderer.removeListener('gitcron-config:changed', handler);
    },
  },
  // Redactar el asunto del commit con un modelo local. Nunca se dispara solo:
  // cada uno de estos canales responde a un botón.
  commitAi: {
    // Catálogo, carga y expulsión van al servidor del uso según gitcron.json (4.4):
    // se dice para qué uso y repositorio; la dirección la resuelve el proceso principal.
    catalog: (target?: { use?: string; repoPath?: string | null }) => ipcRenderer.invoke('commit-ai:catalog', target),
    load: (model: string, target?: { use?: string; repoPath?: string | null }, contextLength?: number, ttlSeconds?: number) =>
      ipcRenderer.invoke('commit-ai:load', model, target, contextLength, ttlSeconds),
    cancel: (draftId?: string) => ipcRenderer.invoke('commit-ai:cancel', draftId),
    unload: (model: string, target?: { use?: string; repoPath?: string | null }) => ipcRenderer.invoke('commit-ai:unload', model, target),
    deviceNames: () => ipcRenderer.invoke('commit-ai:device-names'),
    draft: (args: {
      repoPath: string;
      paths: string[];
      changeId: string | null;
      intent: string | null;
      model: string;
      baseUrl?: string;
      maxTokens?: number;
      draftId?: string;
    }) => ipcRenderer.invoke('commit-ai:draft', args),
    /**
     * Lo que el modelo va produciendo, mientras lo produce.
     *
     * Un canal aparte y no el resultado del `invoke`: lo que llega durante la
     * espera no es el resultado, y esperarlo entero es justamente lo que hacía
     * que 40 segundos fueran una pantalla quieta.
     *
     * Ya viene agrupado por el proceso principal —medido, 45 cuadros por
     * segundo se convierten en ~8 mensajes—, así que acá no hace falta filtrar
     * nada más. Devuelve cómo darse de baja.
     */
    onChunk: (cb: (event: { draftId: string | null; chunks: unknown[] }) => void) => {
      const handler = (_e: unknown, payload: { draftId: string | null; chunks: unknown[] }) => cb(payload);
      ipcRenderer.on('commit-ai:chunk', handler);
      return () => ipcRenderer.removeListener('commit-ai:chunk', handler);
    },
    /**
     * Cambios de estado de cada pedido de redacción (en fila, en curso, terminado, cancelado).
     */
    onDraftState: (cb: (event: { draftId: string; repoPath: string; status: 'queued' | 'running' | 'completed' | 'cancelled'; activeRepoPath?: string | null; startedAt?: number; finishedAt?: number }) => void) => {
      const handler = (_e: unknown, payload: { draftId: string; repoPath: string; status: 'queued' | 'running' | 'completed' | 'cancelled'; activeRepoPath?: string | null; startedAt?: number; finishedAt?: number }) => cb(payload);
      ipcRenderer.on('commit-ai:draft-state', handler);
      return () => ipcRenderer.removeListener('commit-ai:draft-state', handler);
    },
    resolvedModel: (repoPath?: string | null) => ipcRenderer.invoke('commit-ai:resolved-model', repoPath ?? null),
    /**
     * Cambió un gitcron.json: el global (`repoPath: null`) o el de ese repositorio (D3).
     */
    onConfigChanged: (cb: (event: { repoPath: string | null }) => void) => {
      const handler = (_e: unknown, payload: { repoPath: string | null }) => cb(payload);
      ipcRenderer.on('gitcron-config:changed', handler);
      return () => ipcRenderer.removeListener('gitcron-config:changed', handler);
    },
    lastRequest: () => ipcRenderer.invoke('commit-ai:last-request'),
    /** Corregir un valor fuera del estándar en el archivo, sólo si la persona lo acepta (D11b). */
    fixParam: (args: { repoPath?: string | null; file: string; segments: string[]; value: string | number | boolean }) =>
      ipcRenderer.invoke('commit-ai:fix-param', args),
  },
  aiUseHistory: {
    list: (args: { repoPath: string; use?: string; resultStatus?: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('ai-use-history:list', args),
    get: (args: { repoPath: string; id: string }) =>
      ipcRenderer.invoke('ai-use-history:get', args),
    clear: (args: { repoPath: string }) =>
      ipcRenderer.invoke('ai-use-history:clear', args),
    linkCommit: (args: { repoPath: string; recordId: string; commitHash: string; edited: boolean }) =>
      ipcRenderer.invoke('ai-use-history:link-commit', args),
  },
  assistConversations: {
    send: (args: import('../types/assist-context').AssistSendArgs) =>
      ipcRenderer.invoke('assist:send', args),
    cancel: (args: { requestId: string }) =>
      ipcRenderer.invoke('assist:cancel', args),
    list: (args: { repoPath: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('assist-conversation:list', args),
    get: (args: { repoPath: string; conversationId: string }) =>
      ipcRenderer.invoke('assist-conversation:get', args),
    delete: (args: { repoPath: string; conversationId: string }) =>
      ipcRenderer.invoke('assist-conversation:delete', args),
    pin: (args: { repoPath: string; conversationId: string; pinned: boolean }) =>
      ipcRenderer.invoke('assist-conversation:pin', args),
    archive: (args: { repoPath: string; conversationId: string; archived: boolean }) =>
      ipcRenderer.invoke('assist-conversation:archive', args),
    narrateResume: (args: import('../types/resume-narration').ResumeNarrationArgs) =>
      ipcRenderer.invoke('assist:narrate-resume', args),
  },
  cartoGraph: {
    ensure: (repoPath: string) => ipcRenderer.invoke('carto:graph-ensure', repoPath),
    status: (repoPath: string) => ipcRenderer.invoke('carto:graph-status', repoPath),
    search: (repoPath: string, query: string, limit?: number) =>
      ipcRenderer.invoke('carto:graph-search', repoPath, query, limit),
    callers: (repoPath: string, nodeId: string) =>
      ipcRenderer.invoke('carto:graph-callers', repoPath, nodeId),
    callees: (repoPath: string, nodeId: string) =>
      ipcRenderer.invoke('carto:graph-callees', repoPath, nodeId),
    impact: (repoPath: string, nodeId: string) =>
      ipcRenderer.invoke('carto:graph-impact', repoPath, nodeId),
    fileRelations: (repoPath: string, filePath: string) =>
      ipcRenderer.invoke('carto:graph-file-relations', repoPath, filePath),
    fileSymbols: (repoPath: string, filePath: string) =>
      ipcRenderer.invoke('carto:graph-file-symbols', repoPath, filePath),
    snapshot: (repoPath: string) =>
      ipcRenderer.invoke('carto:graph-snapshot', repoPath),
    onProgress: (cb: (payload: { repoPath: string; status: unknown }) => void) => {
      const handler = (_e: unknown, payload: { repoPath: string; status: unknown }) => cb(payload);
      ipcRenderer.on('carto:graph-progress', handler);
      return () => ipcRenderer.removeListener('carto:graph-progress', handler);
    },
    onUpdated: (cb: (payload: { repoPath: string }) => void) => {
      const handler = (_e: unknown, payload: { repoPath: string }) => cb(payload);
      ipcRenderer.on('carto:graph-updated', handler);
      return () => ipcRenderer.removeListener('carto:graph-updated', handler);
    },
  },
  cartoScreens: {
    get: (repoPath: string) => ipcRenderer.invoke('carto-screens:get', { repoPath }),
    describe: (args: { repoPath: string; screenId: string; language: 'es' | 'en' | 'zh'; cacheOnly?: boolean }) =>
      ipcRenderer.invoke('carto-screens:describe', args),
  },
  // Cartografía Fase 4: capa de proveedor de IA (local LM Studio / online).
  // Opt-in, apagada por defecto. Las keys nunca cruzan este límite.
  cartoAi: {
    getSettings: () => ipcRenderer.invoke('carto:ai-get-settings'),
    setSettings: (patch: unknown) => ipcRenderer.invoke('carto:ai-set-settings', patch),
    probe: () => ipcRenderer.invoke('carto:ai-probe'),
    explain: (node: unknown, context: unknown) =>
      ipcRenderer.invoke('carto:ai-explain', node, context),
    explainNode: (repoPath: string, nodeId: string, lang?: string) =>
      ipcRenderer.invoke('carto:ai-explain-node', repoPath, nodeId, lang),
    ask: (question: string, context: unknown) =>
      ipcRenderer.invoke('carto:ai-ask', question, context),
    askRepo: (repoPath: string, question: string, lang?: string) =>
      ipcRenderer.invoke('carto:ai-ask-repo', repoPath, question, lang),
    panorama: (repoPath: string, lang?: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke('carto:ai-panorama', repoPath, lang, forceRefresh),
  },
  repoWatch: (targetPath: string) => ipcRenderer.invoke('repo:watch', targetPath),
  repoUnwatch: (targetPath: string) => ipcRenderer.invoke('repo:unwatch', targetPath),
  // `gitState` dice si lo agrupado tocó `.git/`. Segundo argumento y no un
  // cambio de forma: quien no lo mire sigue funcionando igual que antes.
  onRepoFsChange: (cb: (repoPath: string, gitState?: boolean) => void) => {
    const handler = (_e: unknown, payload: { repoPath: string; gitState?: boolean }) => (
      cb(payload.repoPath, payload.gitState)
    );
    ipcRenderer.on('repo:fs-change', handler);
    return () => ipcRenderer.removeListener('repo:fs-change', handler);
  },
  pipelinePrewarm: (repoPath: string) => ipcRenderer.invoke('pipeline:prewarm', repoPath),
  pipelineGetSnapshot: (repoPath: string, selectedChangeId?: string | null) => ipcRenderer.invoke('pipeline:get-snapshot', repoPath, selectedChangeId ?? null),
  pipelineSubscribe: (repoPath: string, selectedChangeId?: string | null) => ipcRenderer.invoke('pipeline:subscribe', repoPath, selectedChangeId ?? null),
  pipelineUnsubscribe: (repoPath: string) => ipcRenderer.invoke('pipeline:unsubscribe', repoPath),
  pipelineGetChangeLastCommit: (repoPath: string, changeId: string) =>
    ipcRenderer.invoke('pipeline:get-change-last-commit', repoPath, changeId),
  pipelineGetChangeCommits: (repoPath: string, changeId: string) =>
    ipcRenderer.invoke('pipeline:get-change-commits', repoPath, changeId),
  /** Plan del archivado: el comando que se va a ejecutar. No ejecuta nada. */
  pipelineArchivePlan: (repoPath: string, changeId: string) => ipcRenderer.invoke('pipeline:archive-plan', repoPath, changeId),
  /** Archiva un change: mueve el cambio y consolida specs. No toca Git. Acepta motivo opcional. */
  pipelineArchiveChange: (repoPath: string, changeId: string, reason?: string) =>
    ipcRenderer.invoke('pipeline:archive-change', repoPath, changeId, reason),
  /** Vista previa de sincronización de specs con openspec-sync-specs (Alternativa B). No escribe en disco. */
  pipelineSyncPreview: (repoPath: string, changeId: string) =>
    ipcRenderer.invoke('pipeline:sync-preview', repoPath, changeId),
  /** Ejecución de sincronización de specs. Requiere confirmación explícita previa. No hace commit en Git. */
  pipelineSyncExecute: (
    repoPath: string,
    changeId: string,
    acceptedItems: Array<{ capability: string; content: string }>,
    options?: { confirmed?: boolean },
  ) => ipcRenderer.invoke('pipeline:sync-execute', repoPath, changeId, acceptedItems, options),
  /** Cambia el estado de una tarea. `expectedText` verifica que sea la misma. */
  pipelineSetTaskChecked: (
    repoPath: string,
    changeId: string,
    line: number,
    expectedText: string,
    completed: boolean,
    actor?: 'persona' | 'agente',
  ) => ipcRenderer.invoke('pipeline:set-task-checked', repoPath, changeId, line, expectedText, completed, actor),
  /** Agrega una tarea al archivo tasks.md. */
  pipelineAddTask: (
    repoPath: string,
    changeId: string,
    text: string,
    options?: { line?: number; position?: 'above' | 'below' | 'end'; expectedText?: string; actor?: 'persona' | 'agente' },
    actor?: 'persona' | 'agente',
  ) => ipcRenderer.invoke('pipeline:add-task', repoPath, changeId, text, options, actor),
  /** Edita el texto de una tarea. `expectedText` verifica coincidencia previa. */
  pipelineEditTask: (
    repoPath: string,
    changeId: string,
    line: number,
    expectedText: string,
    newText: string,
    actor?: 'persona' | 'agente',
  ) => ipcRenderer.invoke('pipeline:edit-task', repoPath, changeId, line, expectedText, newText, actor),
  /** Mueve una tarea entre líneas sin alterar líneas ajenas. */
  pipelineMoveTask: (
    repoPath: string,
    changeId: string,
    fromLine: number,
    toLine: number,
    expectedText: string,
    actor?: 'persona' | 'agente',
  ) => ipcRenderer.invoke('pipeline:move-task', repoPath, changeId, fromLine, toLine, expectedText, actor),
  /** Elimina una tarea de tasks.md. */
  pipelineRemoveTask: (
    repoPath: string,
    changeId: string,
    line: number,
    expectedText: string,
    actor?: 'persona' | 'agente',
  ) => ipcRenderer.invoke('pipeline:remove-task', repoPath, changeId, line, expectedText, actor),
  /** Escribe el contenido de un artefacto del cambio validando contención en el proceso principal. */
  pipelineWriteArtifact: (
    repoPath: string,
    changeId: string,
    artifactId: string,
    content: string,
    options?: { overwrite?: boolean; actor?: 'persona' | 'agente'; targetFile?: string },
  ) => ipcRenderer.invoke('pipeline:write-artifact', repoPath, changeId, artifactId, content, options),
  /**
   * Contenido de una especificación consolidada, por su identificador.
   *
   * Va aparte del snapshot a propósito: las specs de un repositorio grande pesan
   * cientos de kilobytes y el snapshot se rearma en cada refresco. Se manda el
   * identificador, no una ruta: el proceso principal la compone y la valida.
   */
  pipelineReadSpecification: (repoPath: string, specificationId: string) =>
    ipcRenderer.invoke('pipeline:read-specification', repoPath, specificationId),
  /**
   * Inicializa OpenSpec en el repositorio. Escribe, así que sólo se invoca
   * detrás de una acción humana. Sin `tools`, el CLI detecta las presentes.
   */
  pipelineInitOpenSpec: (repoPath: string, tools?: string[]) =>
    ipcRenderer.invoke('pipeline:init-openspec', repoPath, tools),
  /** El historial cambió: hay commits nuevos hechos por la aplicación. */
  onRepoCommitsChanged: (cb: (repoPath: string) => void) => {
    const handler = (_e: unknown, payload: { repoPath: string }) => cb(payload.repoPath);
    ipcRenderer.on('repo:commits-changed', handler);
    return () => ipcRenderer.removeListener('repo:commits-changed', handler);
  },
  onPipelineSnapshotUpdated: (cb: (repoPath: string, snapshot: unknown) => void) => {
    const handler = (_e: unknown, payload: { repoPath: string; snapshot: unknown }) => cb(payload.repoPath, payload.snapshot);
    ipcRenderer.on('pipeline:snapshot-updated', handler);
    return () => ipcRenderer.removeListener('pipeline:snapshot-updated', handler);
  },
  pipelineRuntime: {
    discover: (repoPath: string) => ipcRenderer.invoke('pipeline:runtime:discover', repoPath),
    get: (repoPath: string) => ipcRenderer.invoke('pipeline:runtime:get', repoPath),
    history: (repoPath: string, limit?: number) => ipcRenderer.invoke('pipeline:runtime:history', repoPath, limit),
    start: (payload: unknown) => ipcRenderer.invoke('pipeline:runtime:start', payload),
    resume: (payload: unknown) => ipcRenderer.invoke('pipeline:runtime:resume', payload),
    stop: (repoPath: string) => ipcRenderer.invoke('pipeline:runtime:stop', repoPath),
    planOpenCodeCopy: (repoPath: string) => ipcRenderer.invoke('pipeline:runtime:plan-opencode-copy', repoPath),
    applyOpenCodeCopy: (repoPath: string) => ipcRenderer.invoke('pipeline:runtime:apply-opencode-copy', repoPath),
    checkOpenCodeAuth: (repoPath: string) => ipcRenderer.invoke('pipeline:runtime:check-opencode-auth', repoPath),
  },
  onPipelineRuntimeUpdated: (cb: (repoPath: string, projection: unknown) => void) => {
    const handler = (_e: unknown, payload: { repoPath: string; projection: unknown }) => cb(payload.repoPath, payload.projection);
    ipcRenderer.on('pipeline:runtime:updated', handler);
    return () => ipcRenderer.removeListener('pipeline:runtime:updated', handler);
  },
  pipelineControl: {
    pause: (payload: unknown) => ipcRenderer.invoke('pipeline:control:pause', payload),
    steer: (payload: unknown) => ipcRenderer.invoke('pipeline:control:steer', payload),
    queue: (payload: unknown) => ipcRenderer.invoke('pipeline:control:queue', payload),
    interrupt: (payload: unknown) => ipcRenderer.invoke('pipeline:control:interrupt', payload),
    killProcess: (payload: unknown) => ipcRenderer.invoke('pipeline:control:kill-process', payload),
    cancel: (payload: unknown) => ipcRenderer.invoke('pipeline:control:cancel', payload),
    respondDecision: (payload: unknown) => ipcRenderer.invoke('pipeline:control:respond-decision', payload),
  },
  materializeIdea: (repoPath: string, idea: unknown) =>
    ipcRenderer.invoke('git:materialize-idea', repoPath, idea),
  ai: {
    predictTimelines: (repoPath: string, repoName: string, lang?: string) =>
      ipcRenderer.invoke('ai:predict-timelines', repoPath, repoName, lang),
    loadPrediction: (repoPath: string) =>
      ipcRenderer.invoke('ai:load-prediction', repoPath),
    hasKey: (provider: string) => ipcRenderer.invoke('ai:has-key', provider),
    keyFingerprint: (provider: string) => ipcRenderer.invoke('ai:key-fingerprint', provider),
    // One-way: the key goes IN to be encrypted; it never comes back out.
    setKey: (provider: string, key: string) => ipcRenderer.invoke('ai:set-key', provider, key),
    removeKey: (provider: string) => ipcRenderer.invoke('ai:remove-key', provider),
    // Variables de {env:} (D5): si existen y de dónde salen, guardar y borrar. El valor no vuelve.
    envStatus: (names: string[]) => ipcRenderer.invoke('ai:env-status', names),
    setEnvVar: (name: string, value: string) => ipcRenderer.invoke('ai:set-env-var', name, value),
    removeEnvVar: (name: string) => ipcRenderer.invoke('ai:remove-env-var', name),
    cancelPrediction: () => ipcRenderer.invoke('ai:cancel-prediction'),
  },
  temporalAgent: {
    loadConfig: (repoPath: string, repoName: string) =>
      ipcRenderer.invoke('temporal-agent:load-config', repoPath, repoName),
    saveConfig: (repoPath: string, config: unknown) =>
      ipcRenderer.invoke('temporal-agent:save-config', repoPath, config),
    loadNotes: (repoPath: string, repoName: string) =>
      ipcRenderer.invoke('temporal-agent:load-notes', repoPath, repoName),
    getNotesMarkdown: (repoPath: string, repoName: string) =>
      ipcRenderer.invoke('temporal-agent:get-notes-markdown', repoPath, repoName),
    recordDecision: (repoPath: string, repoName: string, decision: unknown) =>
      ipcRenderer.invoke('temporal-agent:record-decision', repoPath, repoName, decision),
    removeDecision: (repoPath: string, repoName: string, suggestionTitle: string) =>
      ipcRenderer.invoke('temporal-agent:remove-decision', repoPath, repoName, suggestionTitle),
    getHistory: (repoPath?: string | null) =>
      ipcRenderer.invoke('temporal-agent:get-history', repoPath),
  },
  pipelineOpenSpec: {
    getEngineStatus: (repoPath?: string) =>
      ipcRenderer.invoke('pipeline:openspec:engine-status', { repoPath }),
    checkLatestVersion: () =>
      ipcRenderer.invoke('pipeline:openspec:check-latest'),
    getUpdatePlan: (repoPath: string) =>
      ipcRenderer.invoke('pipeline:openspec:update-plan', { repoPath }),
    executeUpdate: (repoPath: string) =>
      ipcRenderer.invoke('pipeline:openspec:update-execute', { repoPath }),
    runUpdate: (repoPath: string, plan?: unknown, force?: boolean) =>
      ipcRenderer.invoke('pipeline:openspec:run-update', { repoPath, plan, force }),
    getPreview: (repoPath: string) =>
      ipcRenderer.invoke('pipeline:openspec:preview', { repoPath }),
    getInstructions: (options: { repoPath: string; target: string; changeId?: string | null; schema?: string | null }) =>
      ipcRenderer.invoke('pipeline:openspec:instructions', options),
    getArtifactGraph: (options: { repoPath: string; changeId: string }) =>
      ipcRenderer.invoke('pipeline:openspec:artifact-graph', options),
    executeCommand: (options: { repoPath: string; command: string }) =>
      ipcRenderer.invoke('pipeline:openspec:execute-command', options),
    installLocal: (options: { repoPath: string; targetVersion?: string }) =>
      ipcRenderer.invoke('pipeline:openspec:install-local', options),
    installGlobal: (options?: { repoPath?: string; targetVersion?: string }) =>
      ipcRenderer.invoke('pipeline:openspec:install-global', options),
    getInstallPlan: (options?: string | { repoPath?: string; targetVersion?: string }) =>
      ipcRenderer.invoke('pipeline:openspec:install-plan', typeof options === 'string' ? { repoPath: options } : options),
    setWorkflow: (options: { workflow: string; enabled: boolean }) =>
      ipcRenderer.invoke('pipeline:openspec:set-workflow', options),
    setProfile: (payload: { profile: string }) =>
      ipcRenderer.invoke('pipeline:openspec:set-profile', payload),
    getLegacySkillsPlan: (repoPath: string) =>
      ipcRenderer.invoke('pipeline:openspec:legacy-skills-plan', { repoPath }),
    removeLegacySkills: (repoPath: string) =>
      ipcRenderer.invoke('pipeline:openspec:remove-legacy-skills', { repoPath }),
    versionAnalysis: (
      repoPath: string,
      optionsOrForceRefresh?: boolean | { forceRefresh?: boolean; model?: string },
    ) => {
      const opts =
        typeof optionsOrForceRefresh === 'boolean'
          ? { forceRefresh: optionsOrForceRefresh }
          : (optionsOrForceRefresh ?? {});
      return ipcRenderer.invoke('pipeline:openspec:version-analysis', {
        repoPath,
        ...(opts.forceRefresh ? { forceRefresh: true } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      });
    },
    versionRedactionCancel: () => ipcRenderer.invoke('pipeline:openspec:version-redaction-cancel'),
    onRedactionChunk: (cb: (event: { chunks: unknown[] }) => void) => {
      const handler = (_e: unknown, payload: { chunks: unknown[] }) => cb(payload);
      ipcRenderer.on('pipeline:openspec:redaction-chunk', handler);
      return () => {
        ipcRenderer.removeListener('pipeline:openspec:redaction-chunk', handler);
      };
    },
  },
});
