// electron/ai/predict.ts
//
// Orchestrator for a single prediction run (MAIN PROCESS). Ties together:
//   skill text  +  feedback block (decision log)  +  repo context (scoped)
//   →  assembled prompt  →  active provider  →  filtered PredictionResult
//
// Read-only w.r.t. Git: it only READS log / package.json for context. It never
// runs a mutating Git command (brief §0.6). No secrets here — keys live in
// key-store and are read inside the provider adapter.
//
// INTEGRATION NOTE — two one-line edits to the already-scaffolded provider files:
//   • types/temporal-agent.ts: AIPredictionProvider.predictTimelines now takes
//     `AssembledPrompts` (defined below) instead of raw PredictionInput, so the
//     prompt is assembled ONCE here and shared across providers.
//   • electron/ai/providers/claude.ts: drop the dynamic `import('../predict')`
//     hack; the adapter now receives { systemPrompt, userPrompt } directly.

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import simpleGit from 'simple-git';

import {
  applyPrivacyScope,
  renderFeedbackBlock,
  isSuppressed,
  type RawRepoContext,
} from '../../lib/feedback-context';
import type {
  TemporalAgentConfig,
  TemporalAgentNotes,
  PredictionInput,
  PredictionResult,
  AIPredictionProvider,
} from '../../types/temporal-agent';
import type { AssembledPrompts } from './provider-runtime';
import { parseBranches } from './provider-parsing';
import type { ResolvedModelFor } from './config/resolve-model-for';
import { runTextUse, type TextUseDeps } from './text-use';
import { resolveForUse } from './use-resolution';

// --- skill text -------------------------------------------------------------

const SKILL_REL = 'temporal-attention/SKILL.md';
const DOCTRINE_REL = 'temporal-attention/references/FORECASTING-DOCTRINE.md';

/** Minimal embedded fallback if the SKILL.md isn't found on disk. */
const SKILL_FALLBACK =
  'You are GitCron\'s Temporal Agent. Reason only about this repo\'s trajectory ' +
  'and propose 3-6 grounded, speculative future branches. Output only the ' +
  'PredictionResult JSON. Never re-propose rejected ideas. Honesty over hype.';

/** Minimal doctrine fallback (the entropy capstone in one line). */
const DOCTRINE_FALLBACK =
  'Forecasting doctrine: estimate how strongly the repo history constrains what ' +
  'comes next (entropy); confidence = inverse of that estimate. Think fox not ' +
  'hedgehog (3-6 lenses), speak in calibrated probabilities, show an ensemble of ' +
  'futures (low->creative flight), tag incremental vs paradigm, and never treat ' +
  'hype as evidence.';

/** Loads the skill body (frontmatter stripped) from resources or the repo. */
function loadSkillText(): string {
  return loadSkillFile(SKILL_REL, SKILL_FALLBACK);
}

/** Loads the forecasting doctrine (the 7 principles; entropy capstone). */
function loadDoctrineText(): string {
  return loadSkillFile(DOCTRINE_REL, DOCTRINE_FALLBACK);
}

function loadSkillFile(relPath: string, fallback: string): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'skills', relPath),
    path.join(app.getAppPath(), '.agents', 'skills', relPath),
    path.join(process.cwd(), '.agents', 'skills', relPath),
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      return stripFrontmatter(raw);
    } catch {
      /* try next */
    }
  }
  return fallback;
}

function stripFrontmatter(md: string): string {
  if (md.startsWith('---')) {
    const end = md.indexOf('\n---', 3);
    if (end !== -1) return md.slice(md.indexOf('\n', end + 1) + 1).trim();
  }
  return md.trim();
}

// --- repo context (read-only) -----------------------------------------------

async function gatherRawContext(
  repoPath: string,
  commitCount = 40,
): Promise<RawRepoContext> {
  const git = simpleGit(repoPath);

  // Commit messages — read-only log.
  let commitMessages: string[] = [];
  try {
    const log = await git.log({ maxCount: commitCount });
    commitMessages = log.all.map((c) => c.message);
  } catch {
    commitMessages = [];
  }

  // Dependencies + language hints from package.json.
  let dependencies: Record<string, string> = {};
  const languages = new Set<string>();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
    dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (dependencies['typescript']) languages.add('TypeScript');
    if (dependencies['react']) languages.add('React');
    if (dependencies['next']) languages.add('Next.js');
    if (dependencies['electron']) languages.add('Electron');
  } catch {
    /* no package.json — leave empty */
  }

  // Changed filenames (gathered always; the scope decides if they're sent).
  let fileNames: string[] = [];
  try {
    const raw = await git.raw(['log', '-n', '20', '--name-only', '--pretty=format:']);
    fileNames = Array.from(new Set(raw.split('\n').map((s) => s.trim()).filter(Boolean))).slice(0, 60);
  } catch {
    fileNames = [];
  }

  return { commitMessages, languages: [...languages], dependencies, fileNames };
}

// --- prompt assembly (pure) -------------------------------------------------

function uiLanguageName(lang: string): string {
  if (lang === 'es') return 'Spanish (Castellano)';
  if (lang === 'zh') return 'Simplified Chinese (中文)';
  return 'English';
}

function uiLanguageStyle(lang: string): string {
  if (lang === 'es') {
    return 'Use clear, professional, warm, and highly accessible Spanish (avoid overly technical jargon where possible, keep it friendly and colloquial).';
  }
  if (lang === 'zh') {
    return 'Use clear, professional, warm, and highly accessible Simplified Chinese (avoid overly technical jargon where possible, keep it natural and concise).';
  }
  return 'Use clear, professional, warm, and highly accessible English (avoid overly technical jargon where possible, keep it friendly and concise).';
}

function assemblePrompts(
  skillText: string,
  doctrineText: string,
  feedbackBlock: string,
  input: PredictionInput,
  lang: string = 'es',
): AssembledPrompts {
  const narrativeLanguage = uiLanguageName(lang);
  const narrativeStyle = uiLanguageStyle(lang);

  // Order matters: skill (who you are) → doctrine (the method, entropy capstone)
  // → feedback (focus) → context (raw material). See CONTEXT-FEEDBACK-FORMAT.md.
  const systemPrompt = [
    skillText,
    '',
    `IMPORTANT: Since the user is using ${narrativeLanguage} as their primary language, you MUST return the main UI narrative fields ("summary", "message", "rationale", "reasoning") in ${narrativeLanguage}. ${narrativeStyle}`,
    '',
    '# Forecasting doctrine (apply before predicting; estimate entropy first)',
    doctrineText,
    '',
    '# User context & feedback',
    feedbackBlock,
  ].join('\n');

  const userPrompt = [
    '# Repository context',
    `Languages: ${input.languages.join(', ') || '—'}`,
    `Dependencies: ${Object.keys(input.dependencies).join(', ') || '—'}`,
    '',
    'Recent commit messages:',
    ...input.commitMessages.map((m) => `- ${m}`),
    ...(input.fileNames?.length
      ? ['', 'Recently changed files:', ...input.fileNames.map((f) => `- ${f}`)]
      : []),
    '',
    '# Output format',
    'Return ONLY a JSON object with this exact schema (no markdown, no explanation):',
    '{',
    '  "summary": "one-paragraph ensemble synthesis of all futures together",',
    '  "branches": [',
    '    {',
    '      "id": "unique-id",',
    '      "message": "short description (max 60 chars)",',
    '      "description": "what the idea IS, concretely, in 1-2 concise sentences. Do not repeat message or rationale.",',
    '      "rationale": "concise technical justification (max 100 chars)",',
    '      "reasoning": "3-5 sentence extended reasoning in plain prose. Ground it in repo signals from the context. Explain: what evidence supports this, whether it is incremental or a paradigm jump, and why this confidence level (confidence = inverse of forecast entropy).",',
    '      "agentPrompt": "A detailed, actionable step-by-step programming prompt in English (so any standard AI coding agent can understand it perfectly and execute it) outlining exactly what changes to make, what files to create or modify, and the concrete implementation strategy for this speculative feature. Must be plain text, ready to be passed directly to a coding assistant like Antigravity.",',
    '      "type": "improvement" | "breakthrough" | "trend",',
    '      "confidence": 0.0 to 1.0',
    '    }',
    '  ]',
    '}',
    'Text-field distinction for each branch: message = the short title; description = what the idea concretely is; rationale = why this future is plausible from repo trajectory. Example: message "Virtualizar el render del grafo"; description "Reemplazar el render completo de la lista de commits por una ventana virtualizada que solo monta los nodos visibles en pantalla."; rationale "El repo viene sumando features de grafo y la performance con cientos de commits ya aparece como preocupación recurrente."',
    'Propose 3-5 branches. Each must have all 8 fields. summary must be one paragraph. Each description must be 1-2 concise sentences. Each reasoning must be 3-5 sentences, plain prose, no markdown.',
    `IMPORTANT: The UI fields ("summary", "message", "description", "rationale", "reasoning") MUST be written in ${narrativeLanguage}. ${narrativeStyle} The "agentPrompt" field must always be written in English as a detailed programming prompt for an AI agent to execute.`,
  ].join('\n');

  return { systemPrompt, userPrompt, input };
}

// --- provider ---------------------------------------------------------------

/**
 * El modelo elegido por repositorio en los ajustes del Agente Temporal sale del
 * catálogo de OpenRouter, así que sólo vale cuando el uso va a OpenRouter (D10:
 * «el modelo de cada repositorio queda donde está»). Con otro proveedor manda
 * gitcron.json, que tiene su propio archivo por repositorio (D2).
 */
function withRepoModel(target: ResolvedModelFor, repoModel?: string): ResolvedModelFor {
  const model = repoModel?.trim();
  if (target.status !== 'resolved' || !model) return target;
  const { resolved } = target;
  const isOpenRouter = typeof resolved.baseURL === 'string' && /(^|\.)openrouter\.ai$/i.test(safeHost(resolved.baseURL));
  if (!isOpenRouter) return target;
  return {
    ...target,
    resolved: {
      ...resolved,
      modelId: model,
      provenance: { ...resolved.provenance, model: 'modelo elegido en el Agente Temporal para este repositorio' },
    },
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** El proveedor del uso `gitcron-temporal`, por el camino común de texto (4.3). */
export function createTemporalProvider(target: ResolvedModelFor, deps: TextUseDeps = {}): AIPredictionProvider {
  const label = target.status === 'resolved' ? `${target.resolved.providerName} · ${target.resolved.modelId}` : 'gitcron-temporal';
  return {
    id: target.status === 'resolved' ? target.resolved.providerId : 'gitcron-temporal',
    label,
    kind: target.status === 'resolved' && target.resolved.destination !== 'external-service' ? 'local' : 'cloud',
    async predictTimelines(prompts: AssembledPrompts): Promise<PredictionResult> {
      const result = await runTextUse(target, { system: prompts.systemPrompt, user: prompts.userPrompt, maxTokens: 4096 }, deps);
      if (!result.text && result.finishReason === 'length') {
        throw new Error('La respuesta del modelo quedó cortada (max_tokens muy bajo).');
      }
      return {
        branches: parseBranches(result.text),
        provider: `${result.providerId}:${result.modelId}`,
        generatedAt: new Date().toISOString(),
      };
    },
  };
}

// --- orchestrator -----------------------------------------------------------

export interface RunPredictionArgs {
  repoPath: string;
  config: TemporalAgentConfig;
  notes: TemporalAgentNotes;
  lang?: string;
  /**
   * Optional adapter override. When present, it replaces the registry lookup —
   * used to inject a mock provider (no network) while still exercising the full
   * orchestrator: read-only context gather, privacy scope, feedback, threshold.
   */
  providerOverride?: AIPredictionProvider;
}

export interface RunPredictionWithInputResult {
  result: PredictionResult;
  input: PredictionInput;
}

export async function runPredictionWithInput(args: RunPredictionArgs): Promise<RunPredictionWithInputResult> {
  const { repoPath, config, notes, lang = 'es', providerOverride } = args;

  const raw = await gatherRawContext(repoPath);
  const input = applyPrivacyScope(raw, config.privacyScope);
  const feedbackBlock = renderFeedbackBlock(config.skillProfile, notes);
  const prompts = assemblePrompts(loadSkillText(), loadDoctrineText(), feedbackBlock, input, lang);

  const provider =
    providerOverride ?? createTemporalProvider(withRepoModel(resolveForUse('gitcron-temporal', repoPath), config.model));
  const result = await provider.predictTimelines(prompts);

  // Tag each branch with its 1-based index from the original prediction array.
  // This index is the stable identity for numbering in the graph and panel,
  // surviving any runtime threshold filter.
  result.branches.forEach((b, i) => {
    b.predictionIndex = i + 1;
  });

  // Belt-and-suspenders: never surface an idea the user already rejected.
  // Confidence threshold is applied at render time (page.tsx), not here,
  // so the user can adjust it dynamically and see stable numbering.
  const branches = result.branches.filter(
    (b) => !isSuppressed(b.message, notes),
  );

  return { result: { ...result, branches, lang }, input };
}



