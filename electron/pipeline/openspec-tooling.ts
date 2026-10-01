/**
 * Herramientas y targets reconocidos por GitCron para OpenSpec 1.8.
 *
 * Fuente única de verdad para la tabla de herramientas, directorios, clases de outputs,
 * conjuntos oficiales de workflows y bloqueo de seguridad.
 */

import snapshot from './openspec-tools-snapshot.json';

export const OPENSPEC_CORE_WORKFLOW_SET = new Set([
  'propose',
  'explore',
  'apply',
  'update',
  'sync',
  'archive',
]);

export const OPENSPEC_EXPANDED_WORKFLOW_SET = new Set([
  'propose',
  'explore',
  'apply',
  'update',
  'sync',
  'archive',
  'new',
  'continue',
  'ff',
  'verify',
  'bulk-archive',
  'onboard',
]);

/**
 * Mapeo canónico exacto de nombres de artefactos/skills oficiales a sus nombres de workflow.
 * Ningún skill fuera de este mapeo es considerado oficial (ej. `openspec-mi-flujo` no lo es).
 */
export const OFFICIAL_WORKFLOW_MAP: Readonly<Record<string, string>> = {
  'openspec-propose': 'propose',
  'openspec-explore': 'explore',
  'openspec-apply-change': 'apply',
  'openspec-apply': 'apply',
  'openspec-update-plan': 'update',
  'openspec-update-change': 'update',
  'openspec-update': 'update',
  'openspec-sync-specs': 'sync',
  'openspec-sync': 'sync',
  'openspec-archive-change': 'archive',
  'openspec-archive': 'archive',
  'openspec-new-change': 'new',
  'openspec-new': 'new',
  'openspec-continue-change': 'continue',
  'openspec-continue': 'continue',
  'openspec-ff-change': 'ff',
  'openspec-ff': 'ff',
  'openspec-verify-change': 'verify',
  'openspec-verify': 'verify',
  'openspec-bulk-archive': 'bulk-archive',
  'openspec-onboard': 'onboard',
};

export const OFFICIAL_OPENSPEC_SKILL_SLUGS = new Set(Object.keys(OFFICIAL_WORKFLOW_MAP));

export type OpenSpecToolCategory = 'interactive-agent' | 'global-agent';

export interface OpenSpecToolPresentation {
  label?: string;
  descriptionKey: string;
  blocked?: boolean;
  kind?: 'repo-local' | 'external-global';
}

export const OPENSPEC_TOOL_PRESENTATION: Readonly<Record<string, OpenSpecToolPresentation>> = {
  agents: { label: 'Carpeta compartida .agents', descriptionKey: 'pipeline.openspec.engine.output.agentsDesc' },
  codex: { descriptionKey: 'pipeline.openspec.engine.output.codexDesc' },
  claude: { descriptionKey: 'pipeline.openspec.engine.output.claudeDesc' },
  antigravity: { descriptionKey: 'pipeline.openspec.engine.output.antigravityDesc' },
  opencode: { descriptionKey: 'pipeline.openspec.engine.output.opencodeDesc' },
  'minimax-code': { descriptionKey: 'pipeline.openspec.engine.output.minimaxDesc', blocked: true, kind: 'external-global' },
  cursor: { descriptionKey: 'pipeline.openspec.engine.output.cursorDesc' },
  gemini: { descriptionKey: 'pipeline.openspec.engine.output.geminiDesc' },
  'github-copilot': { descriptionKey: 'pipeline.openspec.engine.output.copilotDesc' },
  'amazon-q': { descriptionKey: 'pipeline.openspec.engine.output.amazonqDesc' },
  auggie: { descriptionKey: 'pipeline.openspec.engine.output.auggieDesc' },
  cline: { descriptionKey: 'pipeline.openspec.engine.output.clineDesc' },
  crush: { descriptionKey: 'pipeline.openspec.engine.output.crushDesc' },
  junie: { descriptionKey: 'pipeline.openspec.engine.output.junieDesc' },
  kilocode: { descriptionKey: 'pipeline.openspec.engine.output.kilocodeDesc' },
  kiro: { descriptionKey: 'pipeline.openspec.engine.output.kiroDesc' },
  qwen: { descriptionKey: 'pipeline.openspec.engine.output.qwenDesc' },
  roocode: { descriptionKey: 'pipeline.openspec.engine.output.roocodeDesc' },
  trae: { descriptionKey: 'pipeline.openspec.engine.output.traeDesc' },
  windsurf: { descriptionKey: 'pipeline.openspec.engine.output.windsurfDesc' },
};

export interface OpenSpecToolDef {
  toolId: string;
  directory: string;
  label: string;
  kind: 'repo-local' | 'external-global';
  category: OpenSpecToolCategory;
  isInteractiveAgent: boolean;
  displayPath: string;
  blocked: boolean;
  descriptionKey: string;
  skillsDir?: string;
  legacySkillsDirs?: string[];
  detectionPaths?: string[];
  globalSkillsDir?: string;
  addedIn?: string;
  addedInOrEarlier?: boolean;
}

export const OPENSPEC_TOOL_DIRECTORIES: ReadonlyArray<OpenSpecToolDef> = snapshot.tools.map((tool) => {
  const pres = OPENSPEC_TOOL_PRESENTATION[tool.id];
  const isGlobal = pres?.kind === 'external-global' || Boolean(tool.globalSkillsDir);
  const directory = tool.skillsDir ?? tool.globalSkillsDir ?? `.${tool.id}`;
  const label = pres?.label ?? tool.label;
  const displayPath = isGlobal
    ? `~/${tool.globalSkillsDir ?? directory}/skills/openspec-*`
    : `${directory}/skills/openspec-*`;

  return {
    toolId: tool.id,
    directory,
    label,
    kind: isGlobal ? 'external-global' : 'repo-local',
    category: isGlobal ? 'global-agent' : 'interactive-agent',
    isInteractiveAgent: !isGlobal,
    displayPath,
    blocked: pres?.blocked ?? false,
    descriptionKey: pres?.descriptionKey ?? `pipeline.openspec.engine.output.${tool.id}Desc`,
    skillsDir: tool.skillsDir,
    legacySkillsDirs: tool.legacySkillsDirs,
    detectionPaths: tool.detectionPaths,
    globalSkillsDir: tool.globalSkillsDir,
    addedIn: (tool as { addedIn?: string }).addedIn,
    addedInOrEarlier: (tool as { addedInOrEarlier?: boolean }).addedInOrEarlier,
  };
});

export function getToolDef(toolId: string): OpenSpecToolDef | undefined {
  return OPENSPEC_TOOL_DIRECTORIES.find((t) => t.toolId === toolId);
}

/** Comprueba si una entrada corresponde a una skill oficial o declarada de OpenSpec. */
export function isOpenSpecSkillEntry(entry: string): boolean {
  return OFFICIAL_OPENSPEC_SKILL_SLUGS.has(entry);
}

export type ToolPresence = {
  present: boolean;
  configured: boolean;
};

export function resolveToolStates(
  presence: ReadonlyMap<string, ToolPresence>,
): Array<{ toolId: string; label: string; directory: string; configured: boolean }> {
  return OPENSPEC_TOOL_DIRECTORIES
    .filter((tool) => presence.get(tool.toolId)?.present)
    .map((tool) => ({
      toolId: tool.toolId,
      label: tool.label,
      directory: tool.directory,
      configured: presence.get(tool.toolId)?.configured ?? false,
    }));
}
