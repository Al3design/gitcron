import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEngineStatusSnapshot } from '../ipc/pipeline-openspec';
import { readOpenSpecTooling } from '../pipeline/repo-evidence-reader';
import { deriveProfileWorkflowRows } from '../../lib/openspec-profile';
import { authorizedRepoStore } from '../ipc/authorized-repos';
import { invalidateEngineToolReportCache, locateOpenSpecPackage, readEngineToolReport } from '../pipeline/openspec-engine-tools';
import { resolveOpenSpecExecutable } from '../pipeline/openspec-engine';

describe('OpenSpec Tanda B (Tareas 3.1 y 3.2)', () => {
  let tempDirs: string[] = [];

  const createTempDir = (prefix: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };

  beforeEach(() => {
    authorizedRepoStore.clear();
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tempDirs = [];
  });

  const workflows = ['apply', 'archive', 'explore', 'propose', 'sync', 'update'];
  const officialSkills = [
    'openspec-apply-change',
    'openspec-archive-change',
    'openspec-explore',
    'openspec-propose',
    'openspec-sync-specs',
    'openspec-update-change',
  ];

  it('3.1 y 3.2: OdontoPau → up-to-date, pendingTools vacío, AGENTES muestra sólo Codex configurada y divergencia convergente', async () => {
    const repoPath = createTempDir('odontopau-tanda-b-');
    // .git
    fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    authorizedRepoStore.authorizeRepo(repoPath);

    // openspec
    fs.mkdirSync(path.join(repoPath, 'openspec'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'openspec', 'config.yaml'), 'schema: spec-driven\n');

    // .agents/skills con .openspec-target = codex y 6 skills oficiales 1.13.2
    const agentSkillsDir = path.join(repoPath, '.agents', 'skills');
    fs.mkdirSync(agentSkillsDir, { recursive: true });
    fs.writeFileSync(path.join(agentSkillsDir, '.openspec-target'), 'codex\n');

    for (const sk of officialSkills) {
      const skDir = path.join(agentSkillsDir, sk);
      fs.mkdirSync(skDir, { recursive: true });
      fs.writeFileSync(path.join(skDir, 'SKILL.md'), `---\ngeneratedBy: "1.14.0"\n---\nOdontoPau skill\n`);
    }

    // .codex/config.toml
    const codexDir = path.join(repoPath, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), '# codex\n');

    // .github/workflows/ci.yml (CI, no configurable por OpenSpec)
    const ghDir = path.join(repoPath, '.github', 'workflows');
    fs.mkdirSync(ghDir, { recursive: true });
    fs.writeFileSync(path.join(ghDir, 'ci.yml'), 'name: CI\n');

    invalidateEngineToolReportCache(repoPath);

    // 1. buildEngineStatusSnapshot
    const snapshot = await buildEngineStatusSnapshot(repoPath, {
      discoverCli: async () => ({
        installed: true,
        runtimeVersion: '1.14.0',
        provenance: 'local',
        displayPath: 'node_modules\\.bin\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.14.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      }),
      readGlobalConfig: async () => ({
        rawProfile: 'core',
        configuredWorkflows: workflows,
        origin: 'cli',
        readAt: new Date().toISOString(),
      }),
      runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
      runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
    });

    // Tarea 3.1: integrationState es up-to-date y pendingTools está vacío
    expect(snapshot.integrationState).toBe('up-to-date');
    expect(snapshot.pendingTools).toEqual([]);
    expect(snapshot.toolReport).toBeDefined();

    // Tarea 3.2: Divergencia convergente
    expect(snapshot.divergence?.isDivergent).toBe(false);
    expect(snapshot.divergence?.overallStatus).toBe('convergent');
    expect(snapshot.divergence?.targetConvergences?.['codex']?.status).toBe('convergent');
    expect(snapshot.divergence?.targetConvergences?.['github']).toBeUndefined();

    // 2. readOpenSpecTooling (bloque AGENTES)
    const tooling = await readOpenSpecTooling(repoPath);
    expect(tooling.present).toBe(true);
    const codexTool = tooling.tools.find((t) => t.toolId === 'codex');
    const githubTool = tooling.tools.find((t) => t.toolId === 'github');
    expect(codexTool?.configured).toBe(true);
    expect(githubTool).toBeUndefined();
  });

  it('3.1 y 3.2: gitCronos → up-to-date, pendingTools: [zcode], Zcode aparece sin configurar en AGENTES y no genera «Falta en …» en el perfil', async () => {
    const repoPath = createTempDir('gitcronos-tanda-b-');

    fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    authorizedRepoStore.authorizeRepo(repoPath);

    fs.mkdirSync(path.join(repoPath, 'openspec'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'openspec', 'config.yaml'), 'schema: spec-driven\n');

    // .agents/skills con las 6 skills oficiales 1.13.2
    const agentSkillsDir = path.join(repoPath, '.agents', 'skills');
    fs.mkdirSync(agentSkillsDir, { recursive: true });
    for (const sk of officialSkills) {
      const skDir = path.join(agentSkillsDir, sk);
      fs.mkdirSync(skDir, { recursive: true });
      fs.writeFileSync(path.join(skDir, 'SKILL.md'), `---\ngeneratedBy: "1.14.0"\n---\nGitCron skill\n`);
    }

    // Herramientas configuradas de gitCronos
    // Claude
    fs.mkdirSync(path.join(repoPath, '.claude', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.claude', 'commands', 'opsx.md'), '# Claude command\n');

    // Codex
    fs.mkdirSync(path.join(repoPath, '.codex'), { recursive: true });

    // OpenCode
    fs.mkdirSync(path.join(repoPath, '.opencode', 'command'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.opencode', 'command', 'opsx.md'), '# OpenCode command\n');

    // Qwen
    fs.mkdirSync(path.join(repoPath, '.qwen', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.qwen', 'commands', 'opsx.md'), '# Qwen command\n');

    // Zcode: directorio presente pero SIN configurar (sin skills ni comandos de opsx)
    fs.mkdirSync(path.join(repoPath, '.zcode'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.zcode', 'settings.json'), '{"theme": "dark"}\n');

    invalidateEngineToolReportCache(repoPath);

    const snapshot = await buildEngineStatusSnapshot(repoPath, {
      discoverCli: async () => ({
        installed: true,
        runtimeVersion: '1.14.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.14.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      }),
      readGlobalConfig: async () => ({
        rawProfile: 'core',
        configuredWorkflows: workflows,
        origin: 'cli',
        readAt: new Date().toISOString(),
      }),
      runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
      runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
    });

    // Tarea 3.1: integrationState es up-to-date; zcode queda en pendingTools sin cambiar el estado
    expect(snapshot.integrationState).toBe('up-to-date');
    expect(snapshot.pendingTools).toContain('zcode');

    // Tarea 3.2: divergencia convergente, Zcode NO genera divergencia ni aparece como falta en el perfil
    expect(snapshot.divergence?.isDivergent).toBe(false);
    expect(snapshot.divergence?.overallStatus).toBe('convergent');
    expect(snapshot.divergence?.targetConvergences?.['zcode']).toBeUndefined();

    // Verificación de filas de perfil: ningún workflow acusa falta en zcode
    const installedByTarget = Object.fromEntries(
      Object.entries(snapshot.divergence?.targetConvergences ?? {}).map(([id, c]) => [id, c.installedWorkflows]),
    );
    const rows = deriveProfileWorkflowRows(workflows, workflows, installedByTarget);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.missingByIntegration).not.toContain('zcode');
    }

    // AGENTES (readOpenSpecTooling) muestra Zcode sin configurar
    const tooling = await readOpenSpecTooling(repoPath);
    const zcodeTool = tooling.tools.find((t) => t.toolId === 'zcode');
    expect(zcodeTool).toBeDefined();
    expect(zcodeTool?.configured).toBe(false);
  });

  it('3.1: una herramienta configurada con needsUpdate deriva integrationState como outdated', async () => {
    const repoPath = createTempDir('outdated-tool-tanda-b-');

    fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    authorizedRepoStore.authorizeRepo(repoPath);

    fs.mkdirSync(path.join(repoPath, 'openspec'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'openspec', 'config.yaml'), 'schema: spec-driven\n');

    // .agents/skills generado por versión vieja 1.11.0 mientras el CLI es 1.13.2
    const agentSkillsDir = path.join(repoPath, '.agents', 'skills');
    fs.mkdirSync(agentSkillsDir, { recursive: true });
    for (const sk of officialSkills) {
      const skDir = path.join(agentSkillsDir, sk);
      fs.mkdirSync(skDir, { recursive: true });
      fs.writeFileSync(path.join(skDir, 'SKILL.md'), `---\ngeneratedBy: "1.11.0"\n---\nOld skill\n`);
    }

    invalidateEngineToolReportCache(repoPath);

    const snapshot = await buildEngineStatusSnapshot(repoPath, {
      discoverCli: async () => ({
        installed: true,
        runtimeVersion: '1.13.2',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.13.2' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      }),
      readGlobalConfig: async () => ({
        rawProfile: 'core',
        configuredWorkflows: workflows,
        origin: 'cli',
        readAt: new Date().toISOString(),
      }),
      runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
      runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
    });

    expect(snapshot.integrationState).toBe('outdated');
  });

  it('6.11: sobre C:\\www\\gitCronos real en sólo lectura, el estado del motor da integrationState: up-to-date y pendingTools según el motor', async () => {
    const gitCronosRepo = 'C:\\www\\gitCronos';
    if (!fs.existsSync(gitCronosRepo)) return;

    const runtime = resolveOpenSpecExecutable({ repoPath: gitCronosRepo });
    if (!runtime) return;

    const located = locateOpenSpecPackage({
      repoPath: gitCronosRepo,
      executablePath: runtime.executablePath,
    });
    // Se saltea si no existe el paquete del motor
    if (!located.ok) return;

    authorizedRepoStore.authorizeRepo(gitCronosRepo);
    invalidateEngineToolReportCache(gitCronosRepo);

    const snapshot = await buildEngineStatusSnapshot(gitCronosRepo);
    const engineReport = await readEngineToolReport({
      repoPath: gitCronosRepo,
      executablePath: runtime.executablePath,
      runtimeVersion: snapshot.cli.runtimeVersion ?? '1.14.0',
      nodeExecutable: process.execPath,
    });

    const expectedPendingTools = engineReport.tools
      .filter((t) => t.available && !t.configured)
      .map((t) => t.id)
      .sort();

    expect([...(snapshot.pendingTools ?? [])].sort()).toEqual(expectedPendingTools);

    const motorNeedsUpdateOrSync =
      engineReport.tools.some((t) => t.configured && t.needsUpdate) ||
      (engineReport.profileSyncNeeded && engineReport.profileSyncNeeded.length > 0);

    if (!motorNeedsUpdateOrSync) {
      expect(snapshot.integrationState).toBe('up-to-date');
    }
  }, 25000);
});
