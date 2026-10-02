// electron/ipc/ai.ts
// Temporal Agent: AI key vault (one-way) + prediction trigger + materialize.
//
// SECURITY: getKey() is NEVER exposed over IPC. The renderer can only ask
// whether a key EXISTS (boolean) and submit a new one (one-way, in-only).
// Keys are encrypted at rest by safeStorage inside key-store (main only).

import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { simpleGit } from 'simple-git';
import { loadConfig as loadTemporalConfig, loadNotes as loadTemporalNotes, savePrediction, loadPrediction } from '../temporal-agent-ipc';
import { runPredictionWithInput } from '../ai/predict';
import { cancelActivePrediction } from '../ai/provider-runtime';
import { persistPredictionRun } from '../ai/prediction-persistence';
import {
  hasKey as hasAiKey,
  setKey as setAiKey,
  removeKey as removeAiKey,
  getKeyFingerprint as getAiKeyFingerprint,
  validateProviderId,
  validateSecretName,
  validateKeyString,
  validateEnvVarName,
  hasStoredEnvVar,
  setEnvVar,
  removeEnvVar,
} from '../ai/key-store';
import type { AIKeyProviderId as ProviderId } from '../ai/key-store';
import type { AIPredictionProvider, PredictionResult, SpeculativeBranch, MaterializeIdeaInput } from '../../types/temporal-agent';
import { buildMaterializationPlan } from '../../lib/materialize-idea';
import { errMsg, sanitizeForLog, validRepoPath } from './shared';

// PHASE 4: stub the provider so we don't spend OpenRouter credit yet. The real
// adapter is wired in Phase 5 — flip this to false then. The mock still runs the
// full orchestrator (read-only git context, privacy scope, feedback, threshold).
const USE_MOCK_PREDICTION = false;

function mockProvider(id: string): AIPredictionProvider {
  const branches: SpeculativeBranch[] = [
    {
      id: 'mock-1',
      sourceId: null,
      message: 'Extract IPC layer into a typed contract module',
      description: null,
      rationale:
        'The recent commits keep touching electron/main.ts to add handlers. A shared, typed IPC contract would cut that churn and de-risk the preload bridge.',
      type: 'improvement',
      confidence: 0.82,
    },
    {
      id: 'mock-2',
      sourceId: null,
      message: 'Add a streaming prediction mode for large repos',
      description: null,
      rationale:
        'Context assembly already reads up to 40 commits; streaming the model output would keep the UI responsive on big histories.',
      type: 'breakthrough',
      confidence: 0.66,
    },
    {
      id: 'mock-3',
      sourceId: null,
      message: 'Surface forecasting-doctrine confidence inline on the diagonal',
      description: null,
      rationale:
        'The doctrine ties confidence to repo entropy. Showing the "why 0.7 not 0.9" reasoning next to each branch reinforces honest calibration.',
      type: 'trend',
      confidence: 0.74,
    },
  ];
  return {
    id,
    label: `${id} (MOCK)`,
    kind: 'cloud',
    async predictTimelines(): Promise<PredictionResult> {
      return { branches, provider: `${id}:mock`, generatedAt: new Date().toISOString() };
    },
  };
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:predict-timelines', async (_event, repoPath: string, repoName: string, lang = 'es') => {
    try {
      if (!repoPath || typeof repoPath !== 'string' || !validRepoPath(repoPath)) {
        return { success: false, error: 'INVALID_REPO_PATH' };
      }
      if (typeof repoName !== 'string' || repoName.length === 0 || repoName.length > 256) {
        return { success: false, error: 'INVALID_REPO_NAME' };
      }
      if (typeof lang !== 'string' || !/^[a-zA-Z-]{2,10}$/.test(lang)) {
        return { success: false, error: 'INVALID_LANG' };
      }
      // El proveedor y el modelo salen de gitcron.json (agent.gitcron-temporal o la
      // elección general), tarea 4.3 de modelos-en-casa.
      const config = await loadTemporalConfig(repoPath, repoName);
      const notes = await loadTemporalNotes(repoPath, repoName);
      const { result, input } = await runPredictionWithInput({
        repoPath,
        config,
        notes,
        lang,
        providerOverride: USE_MOCK_PREDICTION ? mockProvider('mock') : undefined,
      });
      const providerId = result.provider.split(':')[0] || 'desconocido';
      // Capa 1: persist the last prediction per-repo so it survives close/reopen.
      try { await savePrediction(repoPath, result); } catch { /* non-fatal */ }
      void persistPredictionRun({
        repoPath,
        config,
        providerId,
        predictionInput: input,
        result,
      }, {
        logError: (error) => {
          console.error('[temporal-agent-db] prediction persistence error:', sanitizeForLog(error));
        },
      });
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // Load the last persisted prediction for a repo (no network, no extra credits).
  ipcMain.handle('ai:load-prediction', async (_event, repoPath: string) => {
    try {
      if (!repoPath || typeof repoPath !== 'string' || !validRepoPath(repoPath)) {
        return { success: false, error: 'INVALID_REPO_PATH' };
      }
      const data = await loadPrediction(repoPath);
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('ai:has-key', async (_event, provider: ProviderId, secretName?: string) => {
    try {
      validateProviderId(provider);
      validateSecretName(secretName);
      return { success: true, data: hasAiKey(provider, secretName) };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('ai:set-key', async (_event, provider: ProviderId, key: string, secretName?: string) => {
    try {
      validateProviderId(provider);
      validateSecretName(secretName);
      validateKeyString(key);
      setAiKey(provider, key, secretName);
      return { success: true };
    } catch (error: any) {
      // Never echo the key in the error.
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('ai:remove-key', async (_event, provider: ProviderId, secretName?: string) => {
    try {
      validateProviderId(provider);
      validateSecretName(secretName);
      removeAiKey(provider, secretName);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('ai:key-fingerprint', async (_event, provider: ProviderId, secretName?: string) => {
    try {
      validateProviderId(provider);
      validateSecretName(secretName);
      // Returns a SHA-256-derived id (8 hex chars), never any part of the key.
      return { success: true, data: getAiKeyFingerprint(provider, secretName) };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ─── Variables de `{env:NOMBRE}` (modelos-en-casa D5, tarea 3.2) ───
  // Mismo contrato que las claves: se pregunta si existe y de dónde sale, se
  // guarda y se borra. El valor no vuelve nunca al renderer, ni siquiera el del
  // sistema: la pantalla sólo necesita saber si está y dónde.
  ipcMain.handle('ai:env-status', async (_event, names: unknown) => {
    try {
      if (!Array.isArray(names) || names.length > 64) throw new Error('INVALID_ENV_VAR_NAME');
      const status: Record<string, 'system' | 'stored' | 'missing'> = {};
      for (const name of names) {
        validateEnvVarName(name);
        const fromSystem = process.env[name];
        status[name] = fromSystem !== undefined && fromSystem !== ''
          ? 'system'
          : hasStoredEnvVar(name) ? 'stored' : 'missing';
      }
      return { success: true, data: status };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('ai:set-env-var', async (_event, name: unknown, value: unknown) => {
    try {
      validateEnvVarName(name);
      validateKeyString(value);
      setEnvVar(name, value);
      return { success: true };
    } catch (error: any) {
      // Nunca se repite el valor en el error.
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('ai:remove-env-var', async (_event, name: unknown) => {
    try {
      validateEnvVarName(name);
      removeEnvVar(name);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  ipcMain.handle('ai:cancel-prediction', async (_event) => {
    try {
      cancelActivePrediction();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    }
  });

  // ---------------------------------------------------------------------------
  // Temporal Agent: materialize a speculative idea into a REAL branch.
  //
  // THE ONLY NEW GIT WRITE in the whole feature. It runs ONLY after the renderer
  // has shown the user the exact plan and the user confirmed (the confirmation
  // lives in the UI; this handler is the executor).
  //
  // SAFETY: uses pure plumbing — a TEMPORARY index file (GIT_INDEX_FILE), then
  // write-tree / commit-tree / branch / tag. It NEVER checks out, NEVER stages,
  // NEVER touches the working tree or the current branch. So a dirty working tree
  // and every existing flow (commit/push/pull/merge/…) are completely unaffected.
  // The plan is re-derived here from the idea via the SAME pure builder the UI
  // used, so the renderer cannot inject an arbitrary branch/tag/ref string.
  // ---------------------------------------------------------------------------
  ipcMain.handle('git:materialize-idea', async (_event, repoPath: string, idea: MaterializeIdeaInput) => {
    let tmpIndex: string | null = null;
    let tmpFile: string | null = null;
    try {
      if (!repoPath || typeof repoPath !== 'string' || !validRepoPath(repoPath)) {
        return { success: false, error: 'INVALID_REPO_PATH' };
      }
      if (!idea || typeof idea !== 'object' || !idea.title || typeof idea.title !== 'string') {
        return { success: false, error: 'INVALID_IDEA' };
      }

      // Child env for git: inherit the process env but DROP the vars simple-git's
      // safety guard refuses (editor/ssh/askpass/diff hooks leaking from the
      // launching shell, e.g. GIT_EDITOR="code --wait", SSH_ASKPASS, …). Our
      // plumbing commands invoke none of these, so removing them is safe.
      const baseEnv: Record<string, string> = { ...(process.env as Record<string, string>), GIT_TERMINAL_PROMPT: '0' };
      for (const k of [
        'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_ASKPASS', 'SSH_ASKPASS',
        'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_EXTERNAL_DIFF', 'GIT_PROXY_COMMAND',
      ]) {
        delete baseEnv[k];
      }

      const g = simpleGit(repoPath).env(baseEnv);

      // Refuse if the branch or flight tag already exist (don't clobber). Checked
      // BEFORE any write, so a collision can never leave partial state.
      const branches = await g.branchLocal();
      const tags = await g.tags();
      const plan = buildMaterializationPlan(idea, branches.all, tags.all);

      if (branches.all.includes(plan.branchName)) {
        return { success: false, error: `Branch "${plan.branchName}" already exists` };
      }
      if (tags.all.includes(plan.tagName)) {
        return {
          success: false,
          error: `Tag "${plan.tagName}" already exists — pick a different flight level or remove it first`,
        };
      }

      const headSha = (await g.revparse(['HEAD'])).trim();

      // 1) Write IDEA.md content to a blob (object DB only; no working-tree file).
      tmpFile = path.join(app.getPath('temp'), `gitcron-idea-${Date.now()}.md`);
      fs.writeFileSync(tmpFile, plan.ideaMarkdown, 'utf8');
      const blobSha = (await g.raw(['hash-object', '-w', tmpFile])).trim();

      // 2) Build a tree = HEAD's tree + IDEA.md, using a TEMP index (never the real one).
      tmpIndex = path.join(app.getPath('temp'), `gitcron-index-${Date.now()}`);
      const gi = simpleGit(repoPath).env({ ...baseEnv, GIT_INDEX_FILE: tmpIndex });
      await gi.raw(['read-tree', headSha]);
      await gi.raw(['update-index', '--add', '--cacheinfo', `100644,${blobSha},IDEA.md`]);
      const treeSha = (await gi.raw(['write-tree'])).trim();

      // 3) Commit the tree with HEAD as parent (no branch ref moved yet).
      const commitSha = (
        await g.raw(['commit-tree', treeSha, '-p', headSha, '-m', plan.commitMessage])
      ).trim();

      // 4) Point the new branch + flight tag at that commit. Working tree untouched.
      await g.raw(['branch', plan.branchName, commitSha]);
      await g.raw(['tag', plan.tagName, commitSha]);

      return {
        success: true,
        data: { branchName: plan.branchName, tagName: plan.tagName, commitHash: commitSha },
      };
    } catch (error: any) {
      return { success: false, error: errMsg(error) };
    } finally {
      if (tmpIndex) { try { fs.unlinkSync(tmpIndex); } catch { /* ignore */ } }
      if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch { /* ignore */ } }
    }
  });
}
