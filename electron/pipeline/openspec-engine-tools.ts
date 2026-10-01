import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import snapshot from './openspec-tools-snapshot.json';
import { OPENSPEC_TOOL_PRESENTATION } from './openspec-tooling';

import type {
  EngineToolReportSource,
  EngineToolFallbackReason,
  OpenSpecToolReportItem,
  OpenSpecToolReport,
} from '../../types/pipeline';

export type {
  EngineToolReportSource,
  EngineToolFallbackReason,
  OpenSpecToolReportItem,
  OpenSpecToolReport,
};

export interface LocatePackageDeps {
  realpath?: (p: string) => string | null;
  readFile?: (p: string, limit?: number) => string | null;
  readPackageJson?: (pkgJsonPath: string) => { name?: string; version?: string } | null;
  existsSync?: (p: string) => boolean;
}

export interface LocatePackageOptions {
  repoPath?: string | null;
  executablePath?: string | null;
  runtimeVersion?: string | null;
  deps?: LocatePackageDeps;
}

export type LocatePackageResult =
  | { ok: true; packageDir: string; version: string }
  | { ok: false; error: 'package-not-found' | 'version-mismatch'; packageDir?: string; packageVersion?: string };

function defaultRealpath(p: string): string | null {
  try {
    return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
  } catch {
    return null;
  }
}

function defaultReadFile(p: string, limit: number = 64 * 1024): string | null {
  try {
    const fd = readFileSync(p);
    return fd.subarray(0, limit).toString('utf8');
  } catch {
    return null;
  }
}

function defaultReadPackageJson(pkgJsonPath: string): { name?: string; version?: string } | null {
  try {
    const content = readFileSync(pkgJsonPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Ubica el paquete de OpenSpec del motor del repositorio o del sistema
 * según la Decisión 2 de design.md.
 */
export function locateOpenSpecPackage(options: LocatePackageOptions): LocatePackageResult {
  const deps = options.deps;
  const realpathFn = deps?.realpath ?? defaultRealpath;
  const readFileFn = deps?.readFile ?? defaultReadFile;
  const readPackageJsonFn = deps?.readPackageJson ?? defaultReadPackageJson;
  const existsFn = deps?.existsSync ?? existsSync;

  // 1. Copia del repositorio (<repo>/node_modules/@fission-ai/openspec)
  if (options.repoPath && typeof options.repoPath === 'string' && options.repoPath.trim()) {
    const repoPkgCandidate = path.join(options.repoPath.trim(), 'node_modules', '@fission-ai', 'openspec');
    const canonicalRepoPkg = realpathFn(repoPkgCandidate);
    if (canonicalRepoPkg && existsFn(canonicalRepoPkg)) {
      const pkg = readPackageJsonFn(path.join(canonicalRepoPkg, 'package.json'));
      if (pkg && pkg.name === '@fission-ai/openspec' && typeof pkg.version === 'string') {
        if (options.runtimeVersion && pkg.version !== options.runtimeVersion) {
          return {
            ok: false,
            error: 'version-mismatch',
            packageDir: canonicalRepoPkg,
            packageVersion: pkg.version,
          };
        }
        return { ok: true, packageDir: canonicalRepoPkg, version: pkg.version };
      }
    }
  }

  // 2. Motor del sistema a partir del ejecutable resuelto
  if (options.executablePath && typeof options.executablePath === 'string' && options.executablePath.trim()) {
    const execPath = options.executablePath.trim();
    const canonicalExec = realpathFn(execPath) ?? execPath;
    const normExec = canonicalExec.replace(/\\/g, '/');

    // Si el enlace o ejecutable termina directamente en bin/openspec.js
    if (normExec.endsWith('/bin/openspec.js')) {
      const packageDir = path.dirname(path.dirname(canonicalExec));
      const pkg = readPackageJsonFn(path.join(packageDir, 'package.json'));
      if (pkg && pkg.name === '@fission-ai/openspec' && typeof pkg.version === 'string') {
        if (options.runtimeVersion && pkg.version !== options.runtimeVersion) {
          return {
            ok: false,
            error: 'version-mismatch',
            packageDir,
            packageVersion: pkg.version,
          };
        }
        return { ok: true, packageDir, version: pkg.version };
      }
      return { ok: false, error: 'package-not-found' };
    }

    // Si es un lanzador (.cmd, sh, etc.), leer hasta 64 KB
    const launcherContent = readFileFn(execPath, 64 * 1024);
    if (launcherContent) {
      // Buscar rutas que terminen en @fission-ai/openspec/bin/openspec.js
      const regex = /(?:["'`]|^|(?<=[=\s]))([^\r\n"'`]*?@fission-ai[/\\]openspec[/\\]bin[/\\]openspec\.js)(?:["'`]|$|(?=[\s\r\n]))/gi;
      const rawMatches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(launcherContent)) !== null) {
        rawMatches.push(match[1].trim());
      }

      const execDir = path.dirname(execPath);
      const canonicalTargets = new Set<string>();

      for (const raw of rawMatches) {
        let cleaned = raw.replace(/^%~dp0[/\\]?/, '').replace(/^\$basedir[/\\]?/, '');
        let fullPath: string;
        if (raw.includes('%~dp0') || raw.includes('$basedir')) {
          fullPath = path.resolve(execDir, cleaned);
        } else if (path.isAbsolute(cleaned)) {
          fullPath = path.resolve(cleaned);
        } else {
          fullPath = path.resolve(execDir, cleaned);
        }

        const canonical = realpathFn(fullPath) ?? (existsFn(fullPath) ? path.normalize(fullPath) : null);
        if (canonical && existsFn(canonical)) {
          canonicalTargets.add(path.normalize(canonical));
        }
      }

      if (canonicalTargets.size === 1) {
        const [singleTarget] = Array.from(canonicalTargets);
        const packageDir = path.dirname(path.dirname(singleTarget));
        const pkg = readPackageJsonFn(path.join(packageDir, 'package.json'));
        if (pkg && pkg.name === '@fission-ai/openspec' && typeof pkg.version === 'string') {
          if (options.runtimeVersion && pkg.version !== options.runtimeVersion) {
            return {
              ok: false,
              error: 'version-mismatch',
              packageDir,
              packageVersion: pkg.version,
            };
          }
          return { ok: true, packageDir, version: pkg.version };
        }
      }
    }
  }

  return { ok: false, error: 'package-not-found' };
}

/**
 * Script embebido en formato ESM que corre en un subproceso aislado con Node.
 * Importa los módulos internos del paquete por URL de archivo y escribe el JSON a stdout.
 */
const RUNNER_SCRIPT = `
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const { packageDir, repoPath, engineVersion, workflows = [], delivery = 'both' } = input;

  const normPkg = packageDir.replace(/\\\\/g, '/');
  const configUrl = pathToFileURL(normPkg + '/dist/core/config.js').href;
  const availUrl = pathToFileURL(normPkg + '/dist/core/available-tools.js').href;
  const detectUrl = pathToFileURL(normPkg + '/dist/core/shared/tool-detection.js').href;
  const driftUrl = pathToFileURL(normPkg + '/dist/core/profile-sync-drift.js').href;

  const { AI_TOOLS } = await import(configUrl);
  const { getAvailableTools } = await import(availUrl);
  const { getToolStates, getAllToolVersionStatus, getConfiguredTools } = await import(detectUrl);
  const { getToolsNeedingProfileSync } = await import(driftUrl);

  if (!Array.isArray(AI_TOOLS) || typeof getAvailableTools !== 'function' || typeof getToolStates !== 'function' || typeof getAllToolVersionStatus !== 'function' || typeof getToolsNeedingProfileSync !== 'function') {
    process.stderr.write('ENGINE_API_CHANGED');
    process.exit(2);
  }

  const availableList = getAvailableTools(repoPath);
  const availableSet = new Set(Array.isArray(availableList) ? availableList.map(t => t.value) : []);

  const toolStates = getToolStates(repoPath);
  const versionStatuses = getAllToolVersionStatus(repoPath, engineVersion);
  const versionStatusMap = new Map(Array.isArray(versionStatuses) ? versionStatuses.map(v => [v.toolId, v]) : []);

  const configuredTools = typeof getConfiguredTools === 'function' ? getConfiguredTools(repoPath) : [];
  const profileSyncNeeded = (Array.isArray(workflows) && workflows.length > 0)
    ? getToolsNeedingProfileSync(repoPath, workflows, delivery, configuredTools)
    : [];

  const tools = AI_TOOLS.map(t => {
    const vStatus = versionStatusMap.get(t.value);
    const state = toolStates?.get ? toolStates.get(t.value) : undefined;
    const configured = Boolean(state?.configured || vStatus?.configured);
    return {
      id: t.value,
      label: t.name,
      skillsDir: t.skillsDir,
      legacySkillsDirs: t.legacySkillsDirs,
      available: availableSet.has(t.value),
      configured,
      needsUpdate: Boolean(vStatus?.needsUpdate),
      generatedBy: vStatus?.generatedByVersion ?? null,
    };
  });

  const report = {
    source: 'engine',
    engineVersion,
    tools,
    profileSyncNeeded: Array.isArray(profileSyncNeeded) ? profileSyncNeeded : [],
  };

  process.stdout.write(JSON.stringify(report));
  process.exit(0);
} catch (err) {
  process.stderr.write(String(err?.stack || err?.message || err));
  process.exit(1);
}
`;

/** Validador estricto de la forma del informe emitido por el motor. */
export function validateEngineToolReport(
  obj: unknown,
  expectedVersion: string,
): OpenSpecToolReport | null {
  if (!obj || typeof obj !== 'object') return null;
  const r = obj as Record<string, unknown>;
  if (r.source !== 'engine') return null;
  if (r.engineVersion !== expectedVersion) return null;
  if (!Array.isArray(r.tools)) return null;
  if (!Array.isArray(r.profileSyncNeeded)) return null;

  for (const syncId of r.profileSyncNeeded) {
    if (typeof syncId !== 'string') return null;
  }

  for (const t of r.tools) {
    if (!t || typeof t !== 'object') return null;
    const tool = t as Record<string, unknown>;
    if (typeof tool.id !== 'string') return null;
    if (typeof tool.label !== 'string') return null;
    if (typeof tool.available !== 'boolean') return null;
    if (typeof tool.configured !== 'boolean') return null;
    if (typeof tool.needsUpdate !== 'boolean') return null;
    if (tool.generatedBy !== null && typeof tool.generatedBy !== 'string') return null;
    if (tool.skillsDir !== undefined && typeof tool.skillsDir !== 'string') return null;
    if (tool.legacySkillsDirs !== undefined && !Array.isArray(tool.legacySkillsDirs)) return null;
    if (tool.configuredVia !== undefined && typeof tool.configuredVia !== 'string') return null;
  }

  return obj as OpenSpecToolReport;
}

/**
 * Si la herramienta `agents` figura configurada, cada herramienta presente (`available`)
 * con `skillsDir === '.agents'` que no figura configurada pasa a `configured: true`,
 * con `configuredVia: 'shared-folder'`, y toma `needsUpdate` y `generatedBy` de `agents` (Decisión 2).
 */
export function annotateSharedFolderTools(report: OpenSpecToolReport): OpenSpecToolReport {
  const agentsTool = report.tools.find((t) => t.id === 'agents');
  if (!agentsTool || !agentsTool.configured) {
    return report;
  }

  for (const tool of report.tools) {
    if (tool.id !== 'agents' && tool.available && !tool.configured && tool.skillsDir === '.agents') {
      tool.configured = true;
      tool.configuredVia = 'shared-folder';
      tool.needsUpdate = agentsTool.needsUpdate;
      tool.generatedBy = agentsTool.generatedBy;
    }
  }

  return report;
}

export interface FallbackDeps {
  existsSync?: (p: string) => boolean;
  readFileSync?: (p: string, encoding?: string) => string;
  readFile?: (p: string, encoding?: string) => string;
  readdirSync?: (p: string) => string[];
  readdir?: (p: string) => string[];
  realpath?: (p: string) => string | null;
}

export const COMMAND_IDS = [
  'explore',
  'new',
  'continue',
  'apply',
  'update',
  'ff',
  'sync',
  'archive',
  'bulk-archive',
  'verify',
  'onboard',
  'propose',
];

export const TOOL_COMMAND_TEMPLATES: Record<string, (cmd: string) => string> = {
  'amazon-q': (c) => path.join('.amazonq', 'prompts', `opsx-${c}.md`),
  antigravity: (c) => path.join('.agents', 'workflows', `opsx-${c}.md`),
  auggie: (c) => path.join('.augment', 'commands', `opsx-${c}.md`),
  bob: (c) => path.join('.bob', 'commands', `opsx-${c}.md`),
  claude: (c) => path.join('.claude', 'commands', 'opsx', `${c}.md`),
  cline: (c) => path.join('.clinerules', 'workflows', `opsx-${c}.md`),
  'command-code': (c) => path.join('.commandcode', 'commands', `opsx-${c}.md`),
  devin: (c) => path.join('.devin', 'workflows', `opsx-${c}.md`),
  codebuddy: (c) => path.join('.codebuddy', 'commands', 'opsx', `${c}.md`),
  continue: (c) => path.join('.continue', 'prompts', `opsx-${c}.prompt`),
  costrict: (c) => path.join('.cospec', 'openspec', 'commands', `opsx-${c}.md`),
  crush: (c) => path.join('.crush', 'commands', 'opsx', `${c}.md`),
  cursor: (c) => path.join('.cursor', 'commands', `opsx-${c}.md`),
  factory: (c) => path.join('.factory', 'commands', `opsx-${c}.md`),
  gemini: (c) => path.join('.gemini', 'commands', 'opsx', `${c}.toml`),
  'github-copilot': (c) => path.join('.github', 'prompts', `opsx-${c}.prompt.md`),
  iflow: (c) => path.join('.iflow', 'commands', `opsx-${c}.md`),
  junie: (c) => path.join('.junie', 'commands', `opsx-${c}.md`),
  kilocode: (c) => path.join('.kilo', 'command', `opsx-${c}.md`),
  kiro: (c) => path.join('.kiro', 'prompts', `opsx-${c}.prompt.md`),
  'oh-my-pi': (c) => path.join('.omp', 'commands', `opsx-${c}.md`),
  opencode: (c) => path.join('.opencode', 'commands', `opsx-${c}.md`),
  pi: (c) => path.join('.pi', 'prompts', `opsx-${c}.md`),
  codeassistant: (c) => path.join('.codeassistant', 'commands', `opsx-${c}.md`),
  qoder: (c) => path.join('.qoder', 'commands', 'opsx', `${c}.md`),
  lingma: (c) => path.join('.lingma', 'commands', 'opsx', `${c}.md`),
  qwen: (c) => path.join('.qwen', 'commands', `opsx-${c}.md`),
  roocode: (c) => path.join('.roo', 'commands', `opsx-${c}.md`),
  trae: (c) => path.join('.trae', 'commands', `opsx-${c}.md`),
  zcode: (c) => path.join('.zcode', 'commands', 'opsx', `${c}.md`),
};

/**
 * Comprueba si una herramienta tiene al menos un comando OpenSpec configurado,
 * con las mismas plantillas que toolHasAnyConfiguredCommand del motor.
 */
export function toolHasAnyConfiguredCommand(
  repoPath: string,
  toolId: string,
  existsFn: (p: string) => boolean = existsSync,
): boolean {
  const template = TOOL_COMMAND_TEMPLATES[toolId];
  if (!template) return false;
  return COMMAND_IDS.some((cmdId) => existsFn(path.join(repoPath, template(cmdId))));
}

/**
 * Genera el informe de respaldo utilizando la copia propia de la versión del ciclo SDD (Decisión 4).
 */
export function buildFallbackToolReport(options: {
  repoPath: string;
  reason?: EngineToolFallbackReason;
  engineVersion?: string | null;
  deps?: FallbackDeps;
}): OpenSpecToolReport {
  const existsFn = options.deps?.existsSync ?? existsSync;
  const readFileFn = options.deps?.readFileSync ?? options.deps?.readFile ?? readFileSync;
  const readdirFn =
    options.deps?.readdirSync ??
    options.deps?.readdir ??
    ((p: string) => {
      try {
        const fs = require('node:fs');
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    });

  const { repoPath, engineVersion } = options;
  const reason: EngineToolFallbackReason = options.reason ?? 'package-not-found';

  // 1. Detectar si existe una marca de carpeta compartida en .agents/skills/.openspec-target
  let sharedTarget: string | null = null;
  const markerPath = path.join(repoPath, '.agents', 'skills', '.openspec-target');
  if (existsFn(markerPath)) {
    try {
      const content = readFileFn(markerPath, 'utf8').trim();
      if (content) sharedTarget = content;
    } catch {
      // Ignorar error de lectura de marca
    }
  }

  // Comprobar si hay skills en .agents/skills
  const agentsSkillsDir = path.join(repoPath, '.agents', 'skills');
  let hasAgentsSkills = false;
  if (existsFn(agentsSkillsDir)) {
    try {
      const entries = readdirFn(agentsSkillsDir);
      hasAgentsSkills = entries.some((e: string) => (snapshot.skillNames as string[]).includes(e));
    } catch {
      hasAgentsSkills = false;
    }
  }

  // Determinar propietario de .agents si no hay marca explícita
  let activeAgentsOwner = sharedTarget;
  if (!activeAgentsOwner) {
    const codexLegacy = path.join(repoPath, '.codex', 'skills');
    let hasCodexLegacy = false;
    if (existsFn(codexLegacy)) {
      try {
        const entries = readdirFn(codexLegacy);
        hasCodexLegacy = entries.some((e: string) => (snapshot.skillNames as string[]).includes(e));
      } catch {
        hasCodexLegacy = false;
      }
    }
    if (hasCodexLegacy) {
      activeAgentsOwner = 'codex';
    } else if (hasAgentsSkills) {
      // Sin marca, el dueño se deduce como lo hace el motor. Medido con OpenSpec 1.14.0 el
      // 2026-10-01: con instrucciones que usan la sintaxis de Codex (`$openspec-`) el motor da
      // configurada a `codex`; sin ella, a `agents`, haya o no una carpeta `.codex`. La tanda 01
      // de actualizar-ciclo-openspec-1-14 había cambiado esto por «sin dueño si hay otra
      // herramienta presente», y el respaldo pasaba a decir otra cosa que el motor.
      let inferred = 'agents';
      for (const skill of snapshot.skillNames) {
        const file = path.join(agentsSkillsDir, skill, 'SKILL.md');
        if (existsFn(file)) {
          try {
            const txt = readFileFn(file, 'utf8');
            if (txt.includes('$openspec-')) {
              inferred = 'codex';
              break;
            }
          } catch {
            // Ignorar
          }
        }
      }
      activeAgentsOwner = inferred;
    } else {
      activeAgentsOwner = 'agents';
    }
  }

  const tools: OpenSpecToolReportItem[] = snapshot.tools.map((tool) => {
    // Señal de presencia independiente (detección que no termine en /skills o \skills)
    const hasIndependentDetectionPath =
      Boolean(tool.detectionPaths && tool.detectionPaths.length > 0) &&
      tool.detectionPaths!.some((p: string) => {
        const norm = p.replace(/\\/g, '/');
        if (norm.endsWith('/skills')) return false;
        return existsFn(path.join(repoPath, p));
      });

    const hasAnyDetectionPath = Boolean(
      tool.detectionPaths && tool.detectionPaths.length > 0 &&
      tool.detectionPaths!.some((p: string) => existsFn(path.join(repoPath, p))),
    );

    const hasAnyLegacySkillsDir = Boolean(
      tool.legacySkillsDirs && tool.legacySkillsDirs.length > 0 &&
      tool.legacySkillsDirs!.some((p: string) => existsFn(path.join(repoPath, p))),
    );

    // A) Presencia (available)
    let available = false;
    if (tool.skillsDir === '.agents') {
      const isAgentsRootPresent = existsFn(path.join(repoPath, '.agents'));
      const isOwner = activeAgentsOwner === tool.id;
      if (isOwner) {
        available = isAgentsRootPresent || hasIndependentDetectionPath || hasAnyDetectionPath || hasAnyLegacySkillsDir;
      } else {
        available = hasIndependentDetectionPath || hasAnyLegacySkillsDir;
      }
    } else if (tool.detectionPaths && tool.detectionPaths.length > 0) {
      available = hasAnyDetectionPath;
    } else if (tool.skillsDir) {
      available = existsFn(path.join(repoPath, tool.skillsDir));
    }

    // B) Configuración (configured)
    let configured = false;
    let generatedBy: string | null = null;

    // 1) Comprobación de comandos configurados según toolHasAnyConfiguredCommand del motor
    const hasCommand = toolHasAnyConfiguredCommand(repoPath, tool.id, existsFn);

    // 2) Comprobación de skills en carpeta canónica
    let hasSkill = false;
    if (tool.skillsDir === '.agents') {
      if (activeAgentsOwner === tool.id && hasAgentsSkills) {
        hasSkill = true;
      }
    } else if (tool.skillsDir) {
      const skillsDir = path.join(repoPath, tool.skillsDir, 'skills');
      if (existsFn(skillsDir)) {
        try {
          const entries = readdirFn(skillsDir);
          if (entries.some((e: string) => (snapshot.skillNames as string[]).includes(e))) {
            hasSkill = true;
          }
        } catch {
          // Ignorar
        }
      }
    }

    // 3) Comprobar carpetas heredadas (legacySkillsDirs)
    const checkDirs: string[] = [];
    if (tool.skillsDir) {
      checkDirs.push(path.join(repoPath, tool.skillsDir, 'skills'));
    }
    if (tool.legacySkillsDirs) {
      for (const legacy of tool.legacySkillsDirs) {
        const legacySkills = path.join(repoPath, legacy, 'skills');
        checkDirs.push(legacySkills);
        if (existsFn(legacySkills)) {
          try {
            const entries = readdirFn(legacySkills);
            if (entries.some((e: string) => (snapshot.skillNames as string[]).includes(e))) {
              hasSkill = true;
            }
          } catch {
            // Ignorar
          }
        }
      }
    }

    configured = hasSkill || hasCommand;
    if (configured) {
      available = true;
    }

    // C) Extraer generatedBy de SKILL.md de la primera skill que exista
    for (const dir of checkDirs) {
      if (generatedBy) break;
      for (const skillName of snapshot.skillNames) {
        const skillFile = path.join(dir, skillName, 'SKILL.md');
        if (existsFn(skillFile)) {
          try {
            const content = readFileFn(skillFile, 'utf8');
            for (const line of content.split(/\r?\n/)) {
              const m = line.match(/^[ \t]*generatedBy:[ \t]*["']?([^"'\r\n]+)["']?[ \t]*$/);
              if (m && m[1]) {
                generatedBy = m[1].trim();
                break;
              }
            }
          } catch {
            // Ignorar
          }
          if (generatedBy) break;
        }
      }
    }

    const needsUpdate =
      configured &&
      (generatedBy === null || generatedBy !== snapshot.version);

    const pres = OPENSPEC_TOOL_PRESENTATION[tool.id];
    return {
      id: tool.id,
      label: pres?.label ?? tool.label,
      skillsDir: tool.skillsDir,
      legacySkillsDirs: tool.legacySkillsDirs,
      available,
      configured,
      needsUpdate,
      generatedBy,
    };
  });

  const report: OpenSpecToolReport = {
    source: 'gitcron-fallback',
    engineVersion: engineVersion ?? null,
    fallbackReason: reason,
    tools,
    profileSyncNeeded: [],
  };

  return annotateSharedFolderTools(report);
}

export interface ReadEngineToolReportOptions {
  repoPath: string;
  executablePath?: string | null;
  runtimeVersion?: string | null;
  workflows?: string[];
  delivery?: 'skills' | 'commands' | 'both';
  nodeExecutable?: string;
  timeoutMs?: number;
  deps?: LocatePackageDeps & FallbackDeps & {
    spawn?: typeof spawn;
  };
}

/** Caché en memoria por clave: `${packageDir}::${engineVersion}::${repoPath}` */
const reportCache = new Map<string, OpenSpecToolReport>();

export function getCachedToolReport(key: string): OpenSpecToolReport | undefined {
  return reportCache.get(key);
}

export function setCachedToolReport(key: string, report: OpenSpecToolReport): void {
  reportCache.set(key, report);
}

export function invalidateEngineToolReportCache(repoPath?: string): void {
  if (!repoPath) {
    reportCache.clear();
    return;
  }
  const normRepo = path.normalize(repoPath);
  for (const key of Array.from(reportCache.keys())) {
    const parts = key.split('::');
    if (parts.length >= 3 && path.normalize(parts[2]) === normRepo) {
      reportCache.delete(key);
    }
  }
}

interface ProcessExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error & { code?: string };
}

function runRunnerProcessAsync(
  nodeExec: string,
  args: string[],
  payload: string,
  timeoutMs: number,
  spawnFn: typeof spawn = spawn,
): Promise<ProcessExecResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(nodeExec, args, {
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
      });
    } catch (err) {
      resolve({
        status: null,
        stdout: '',
        stderr: '',
        error: err instanceof Error ? err : new Error(String(err)),
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killedForBuffer = false;
    const maxBuffer = 1024 * 1024;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Ignorar
      }
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < maxBuffer) {
        stdout += chunk;
      } else if (!killedForBuffer) {
        killedForBuffer = true;
        try {
          child.kill();
        } catch {
          // Ignorar
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < maxBuffer) {
        stderr += chunk;
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({
        status: null,
        stdout,
        stderr,
        error: err,
      });
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (timedOut) {
        const timeoutErr = Object.assign(new Error('Process timed out'), { code: 'ETIMEDOUT' });
        resolve({
          status: code,
          stdout,
          stderr,
          error: timeoutErr,
        });
      } else {
        resolve({
          status: code,
          stdout,
          stderr,
        });
      }
    });

    try {
      if (child.stdin) {
        child.stdin.on('error', () => {
          // Ignorar errores de stream si el proceso termina antes de leer
        });
        child.stdin.end(payload, 'utf8');
      }
    } catch {
      // Ignorar errores de escritura
    }
  });
}

/**
 * Lee el informe de herramientas llamando a las funciones internas del motor
 * en un subproceso aislado asíncrono, o mediante el respaldo si falla (Decisiones 1 a 4).
 */
export async function readEngineToolReport(options: ReadEngineToolReportOptions): Promise<OpenSpecToolReport> {
  const { repoPath, executablePath, runtimeVersion, workflows = [], delivery = 'both' } = options;

  // 1. Ubicar el paquete
  const located = locateOpenSpecPackage({
    repoPath,
    executablePath,
    runtimeVersion,
    deps: options.deps,
  });

  if (!located.ok) {
    return buildFallbackToolReport({
      repoPath,
      reason: located.error,
      engineVersion: runtimeVersion ?? null,
      deps: options.deps,
    });
  }

  const { packageDir, version } = located;
  const wfKey = Array.isArray(workflows) ? [...workflows].sort().join(',') : '';
  const cacheKey = `${packageDir}::${version}::${path.normalize(repoPath)}::${wfKey}::${delivery}`;

  const cached = reportCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Ejecutar en subproceso aislado con Node
  const nodeExec = options.nodeExecutable ?? process.execPath;
  const spawnFn = options.deps?.spawn ?? spawn;
  const timeoutMs = options.timeoutMs ?? 10000;

  const payload = JSON.stringify({
    packageDir,
    repoPath,
    engineVersion: version,
    workflows,
    delivery,
  });

  const result = await runRunnerProcessAsync(
    nodeExec,
    ['--input-type=module', '-e', RUNNER_SCRIPT],
    payload,
    timeoutMs,
    spawnFn,
  );

  // 3. Manejo de errores y timeout
  if (result.error) {
    const isTimeout = (result.error as { code?: string }).code === 'ETIMEDOUT';
    const fallback = buildFallbackToolReport({
      repoPath,
      reason: isTimeout ? 'timeout' : 'failed',
      engineVersion: version,
      deps: options.deps,
    });
    // No cachear fallas transitorias ('timeout' ni 'failed')
    return fallback;
  }

  if (result.status !== 0) {
    const stderr = result.stderr ?? '';
    const isApiChanged =
      result.status === 2 ||
      stderr.includes('ENGINE_API_CHANGED') ||
      stderr.includes('MODULE_NOT_FOUND') ||
      stderr.includes('Cannot find module') ||
      stderr.includes('TypeError');

    const fallback = buildFallbackToolReport({
      repoPath,
      reason: isApiChanged ? 'engine-api-changed' : 'failed',
      engineVersion: version,
      deps: options.deps,
    });

    if (isApiChanged) {
      reportCache.set(cacheKey, fallback);
    }
    return fallback;
  }

  // 4. Validar estrictamente el JSON recibido
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    const fallback = buildFallbackToolReport({
      repoPath,
      reason: 'engine-api-changed',
      engineVersion: version,
      deps: options.deps,
    });
    reportCache.set(cacheKey, fallback);
    return fallback;
  }

  const validated = validateEngineToolReport(parsed, version);
  if (!validated) {
    const fallback = buildFallbackToolReport({
      repoPath,
      reason: 'engine-api-changed',
      engineVersion: version,
      deps: options.deps,
    });
    reportCache.set(cacheKey, fallback);
    return fallback;
  }

  for (const tool of validated.tools) {
    const pres = OPENSPEC_TOOL_PRESENTATION[tool.id];
    if (pres?.label) {
      tool.label = pres.label;
    }
  }

  const finalReport = annotateSharedFolderTools(validated);
  reportCache.set(cacheKey, finalReport);
  return finalReport;
}
