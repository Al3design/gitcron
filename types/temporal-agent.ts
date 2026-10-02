// types/temporal-agent.ts
// Shared types for GitCron's Temporal Agent (Feature B foundation, Phase 0).
// No secrets are ever stored in these structures — see TEMPORAL_AGENT_DESIGN.md §4.

// AssembledPrompts lives with the provider request runtime.
// Type-only import: erased at compile, so no runtime cycle.
import type { AssembledPrompts } from '../electron/ai/provider-runtime';

/** What the agent leans toward / away from. Nudged by the decision log. */
export interface TemporalAgentSkillProfile {
  /** Topics to up-weight, e.g. ['security', 'performance', 'timeline']. */
  focusAreas: string[];
  /** Topics to down-weight, e.g. ['refactoring', 'state-management rewrites']. */
  avoidTopics: string[];
  /** Predictions below this confidence are hidden. 0..1. */
  confidenceThreshold: number;
}

export type AnalysisFrequency = 'on-demand' | 'manual' | 'daily' | 'weekly';

/** Per-repo privacy scope. Default is the conservative one; never auto-escalates. */
export type PrivacyScope = 'metadata' | 'metadata-plus-files';

/** Machine state for one repo. Lives in {userData}/temporal-agent/{repoHash}/config.json */
export interface TemporalAgentConfig {
  /** Deterministic id = sha256(path.resolve(repoPath)). */
  repoHash: string;
  /** Human label only (display); not used to build file paths. */
  repoName: string;
  enabled: boolean;
  frequency: AnalysisFrequency;
  privacyScope: PrivacyScope;
  /** ISO timestamp of last successful analysis, or null. */
  lastAnalysis: string | null;
  skillProfile: TemporalAgentSkillProfile;
  /**
   * OpenRouter model id (e.g. "anthropic/claude-sonnet-4.5"). NOT a secret —
   * stored in plain config, never in the encrypted key-store. Empty = use the
   * adapter's default.
   */
  model?: string;
}

export type DecisionOutcome = 'accepted' | 'rejected' | 'deferred';
export type PersistedDecisionKind = 'accepted' | 'materialized' | 'rejected' | 'deferred';
export type SpeculativeType = 'improvement' | 'breakthrough' | 'trend';

/** One logged decision. Canonical data lives in notes.json. */
export interface TemporalAgentDecision {
  /** ISO timestamp. */
  date: string;
  /** GitCron-minted UUID of the speculative branch being decided. */
  branchId: string;
  /** The prediction's title at the time it was shown. */
  suggestionTitle: string;
  type: SpeculativeType;
  outcome: DecisionOutcome;
  /** Agent's confidence when it made the suggestion. 0..1. */
  confidence: number;
  /** Optional free-text reason the user gave. */
  reasoning?: string;
  /** Optional SQLite decision override for actions distinct from judge buttons. */
  persistenceDecision?: PersistedDecisionKind;
  /** Real ref created when the idea was materialized, if available. */
  materializedRef?: string;
  /** Optional note on how this should shape future analysis. */
  impact?: string;
}

/** Rolled-up counts for decisions older than the cap. */
export interface DecisionSummary {
  accepted: number;
  rejected: number;
  deferred: number;
  /** Recurring themes among rejected items, for cheap prompt context. */
  rejectedThemes: string[];
}

/** Canonical per-repo notes. {userData}/temporal-agent/{repoHash}/notes.json */
export interface TemporalAgentNotes {
  repoName: string;
  lastUpdated: string;
  /** Newest-first, capped to `decisionLogCap`. */
  decisions: TemporalAgentDecision[];
  summary: DecisionSummary;
}

// ---------------------------------------------------------------------------
// DEFERRED — Feature B proper (after A + A′ + C). Defined here so the storage
// and UI scaffold is forward-compatible. NOT used by Phase 0 code.
// ---------------------------------------------------------------------------

/** Built in MAIN according to the repo + its privacy scope. */
export interface PredictionInput {
  commitMessages: string[];
  languages: string[];
  dependencies: Record<string, string>;
  /** Present ONLY when privacyScope === 'metadata-plus-files'. */
  fileNames?: string[];
  /** Whether web-trend lookup is enabled (optional sub-phase). */
  webTrends?: boolean;
}

export interface SpeculativeBranch {
  /** GitCron-minted UUID shared by the HUD, notes JSON, and SQLite PK. */
  id: string;
  /** Provider/LLM-emitted id when present; provenance only. */
  sourceId: string | null;
  message: string;
  /** Concrete "what this idea is" description. Optional for older/model outputs. */
  description: string | null;
  rationale: string;
  /** Extended reasoning (3-5 sentences of plain prose). Optional for backward compatibility. */
  reasoning?: string;
  /** Ready-to-use coding prompt for an AI agent to implement this speculative feature. */
  agentPrompt?: string;
  /** 1-based index in the original prediction array, before any filter. Stable across sessions. */
  predictionIndex?: number;
  type: SpeculativeType;
  /** 0..1 — drives opacity / dash styling on the diagonal graph. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// CENTAUR DIALOGUE — the bottom-center panel (human + AI, "voz y voto").
//
// Designed so TODAY it renders a static report (a thread with ONE message) and
// TOMORROW becomes a real back-and-forth (append more turns) with ZERO rewrite.
// The unit is a THREAD, never a single message — that is the whole trick.
// ---------------------------------------------------------------------------

export type DialogueRole = 'agent' | 'user';

export interface DialogueTurn {
  id: string;
  role: DialogueRole;
  /** Natural-language body shown in the panel. */
  text: string;
  /** ISO timestamp. */
  at: string;
}

/**
 * One conversation thread, tied to a speculative branch. Phase "report" = the
 * thread holds a single agent turn (the explanation). Phase "conversation" =
 * user/agent turns accrue. The shape never changes between phases.
 */
export interface SpeculativeDialogue {
  /** Same id as the SpeculativeBranch this explains. */
  branchId: string;
  /** Newest-last (chat order). Starts with one agent turn. */
  turns: DialogueTurn[];
}

export interface PredictionResult {
  branches: SpeculativeBranch[];
  provider: string;
  generatedAt: string;
  /** Ensemble summary — one paragraph synthesizing the full set of futures. */
  summary?: string;
  lang?: string;
}

/**
 * Quien contesta la predicción. Desde la tarea 4.3 de modelos-en-casa, `id` es el
 * proveedor de gitcron.json que eligió el uso `gitcron-temporal` (`openrouter`,
 * `anthropic`, `codex`…), no una lista fija.
 */
export interface AIPredictionProvider {
  id: string;
  label: string;
  kind: 'cloud' | 'local';
  predictTimelines(prompts: AssembledPrompts): Promise<PredictionResult>;
}

// ---------------------------------------------------------------------------
// MATERIALIZATION (Phase 6) — turn a dreamed branch into a REAL branch.
//
// This is the ONLY new Git write in the whole feature. It runs only after an
// explicit user confirmation that previews exactly what will be created. The
// plan is built by a PURE function (lib/materialize-idea.ts) so the UI preview
// and the main-process writer never diverge.
// ---------------------------------------------------------------------------

/** How speculative/ambitious the idea is. Drives the `flight/<level>` tag. */
export type FlightLevel = 'conservative' | 'grounded' | 'high' | 'creative';

/** The minimal idea the user accepts. Mirrors a SpeculativeBranch. */
export interface MaterializeIdeaInput {
  id: string;
  title: string;
  rationale: string;
  type: SpeculativeType;
  confidence: number;
  reasoning?: string;
  agentPrompt?: string;
}

/** Exactly what will be created — shown to the user BEFORE any Git write. */
export interface MaterializationPlan {
  branchName: string;
  tagName: string;
  flightLevel: FlightLevel;
  commitMessage: string;
  ideaMarkdown: string;
  agentBriefMarkdown: string;
}

/** What main returns after a successful materialization. */
export interface MaterializationResult {
  branchName: string;
  tagName: string;
  commitHash: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SKILL_PROFILE: TemporalAgentSkillProfile = {
  focusAreas: [],
  avoidTopics: [],
  confidenceThreshold: 0.5,
};

export function defaultConfig(repoHash: string, repoName: string): TemporalAgentConfig {
  return {
    repoHash,
    repoName,
    enabled: false,
    frequency: 'on-demand',
    privacyScope: 'metadata',
    lastAnalysis: null,
    skillProfile: { ...DEFAULT_SKILL_PROFILE },
    model: '',
  };
}

export function emptyNotes(repoName: string): TemporalAgentNotes {
  return {
    repoName,
    lastUpdated: new Date().toISOString(),
    decisions: [],
    summary: { accepted: 0, rejected: 0, deferred: 0, rejectedThemes: [] },
  };
}

/** Keep this many full decisions; older ones collapse into `summary`. */
export const DECISION_LOG_CAP = 200;
