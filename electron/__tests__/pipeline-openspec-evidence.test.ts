import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  DIR_HASH_MAX_DEPTH,
  DIR_HASH_MAX_ENTRIES,
  extractGeneratedByHeader,
  inspectInstalledEvidence,
  readSharedSkillTarget,
  skillToWorkflowName,
} from '../pipeline/openspec-evidence';
import { buildEngineStatusSnapshot } from '../ipc/pipeline-openspec';
import { authorizedRepoStore } from '../ipc/authorized-repos';
import { classifyOpenSpecProfile, deriveProfileWorkflowRows } from '../../lib/openspec-profile';
import { buildFallbackToolReport, invalidateEngineToolReportCache } from '../pipeline/openspec-engine-tools';

/**
 * Doble de disco anclado a rutas EXACTAS (invariante 19): `readdir` sólo
 * contesta por los directorios declarados y `lstat` sólo reconoce las rutas
 * declaradas. Nunca responde por coincidencia de subcadena ni describe un
 * árbol infinito: un doble que lo hace es un test roto, no una prueba de
 * robustez.
 */
function exactDiskDouble(spec: { dirs?: Record<string, string[]>; files?: string[] }) {
  const dirs = spec.dirs ?? {};
  const files = new Set(spec.files ?? []);
  const dirPaths = new Set(Object.keys(dirs));
  return {
    readdir: (p: string): string[] => (dirs[p] ? [...dirs[p]] : []),
    lstat: (p: string): any => {
      if (dirPaths.has(p) || files.has(p)) {
        return {
          isDirectory: () => dirPaths.has(p),
          isFile: () => files.has(p),
          isSymbolicLink: () => false,
        };
      }
      return null;
    },
  };
}

describe('inspectInstalledEvidence (Audit Points 5, 6, 7, 8 Tests)', () => {
  it('extrae la cabecera generatedBy en formatos 1.5.0 y 1.8.0', () => {
    expect(extractGeneratedByHeader('generatedBy: "1.5.0"')).toBe('1.5.0');
    expect(extractGeneratedByHeader('generatedBy: "openspec@1.8.0"')).toBe('1.8.0');
    expect(extractGeneratedByHeader('generatedBy: openspec/1.8.0')).toBe('1.8.0');
    expect(extractGeneratedByHeader('')).toBeNull();
  });

  it('valida exclusivamente los nombres oficiales 1.8 y rechaza openspec-mi-flujo', () => {
    expect(skillToWorkflowName('openspec-apply-change')).toBe('apply');
    expect(skillToWorkflowName('openspec-explore')).toBe('explore');
    expect(skillToWorkflowName('openspec-propose')).toBe('propose');
    expect(skillToWorkflowName('openspec-sync-specs')).toBe('sync');
    expect(skillToWorkflowName('openspec-archive-change')).toBe('archive');
    expect(skillToWorkflowName('openspec-update-plan')).toBe('update');
    expect(skillToWorkflowName('openspec-update-change')).toBe('update');
    expect(skillToWorkflowName('openspec-new-change')).toBe('new');
    expect(skillToWorkflowName('openspec-continue-change')).toBe('continue');
    expect(skillToWorkflowName('openspec-ff-change')).toBe('ff');
    expect(skillToWorkflowName('openspec-verify-change')).toBe('verify');
    expect(skillToWorkflowName('openspec-bulk-archive')).toBe('bulk-archive');
    expect(skillToWorkflowName('openspec-onboard')).toBe('onboard');

    // Nombres no oficiales
    expect(skillToWorkflowName('openspec-mi-flujo')).toBeNull();
    expect(skillToWorkflowName('openspec-custom-task')).toBeNull();
    expect(skillToWorkflowName('custom-agent')).toBeNull();
  });

  it('no cuenta un agente como configurado si sólo tiene skills personalizadas o openspec-mi-flujo', () => {
    const repo = 'C:\\repo';
    const customSkills = ['accessibility', 'seo', 'dex', 'openspec-mi-flujo'];
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: customSkills,
      },
    });
    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => '',
    });

    // .agents está presente como directorio, pero NO está configurado para OpenSpec oficial
    expect(evidence.presentToolDirectories).toContain('agents');
    expect(evidence.configuredTools).not.toContain('agents');
    expect(evidence.configuredCount).toBe(0);
    expect(evidence.configuredAgentsCount).toBe(0);
    expect(evidence.totalPresentAgentsCount).toBeGreaterThanOrEqual(1);
    expect(evidence.customized).toEqual(expect.arrayContaining(['accessibility', 'seo', 'dex', 'openspec-mi-flujo']));
  });

  it('separa agentes interactivos de integraciones CI como GitHub Workflows', () => {
    const repo = 'C:\\repo';
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents', '.github'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: ['openspec-apply-change'],
        [`${repo}\\.github`]: ['workflows'],
        [`${repo}\\.github\\workflows`]: ['openspec-apply-change.yml'],
      },
      files: [
        `${repo}\\.agents\\skills\\openspec-apply-change\\SKILL.md`,
        `${repo}\\.github\\workflows\\openspec-apply-change.yml`,
      ],
    });
    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => 'generatedBy: "1.8.0"',
    });

    // .agents cuenta en configuredTools y configuredAgentsCount; github ya no es una herramienta de OpenSpec (1.3)
    expect(evidence.configuredTools).not.toContain('github');
    expect(evidence.configuredTools).toContain('agents');
    expect(evidence.configuredAgentsCount).toBe(1);
    expect(evidence.configuredCount).toBe(1);
  });

  it('cambia el contentHash cuando se modifica el contenido de SKILL.md conservando el mismo nombre', () => {
    let skillContent = 'description: version 1';

    const fakeLstat = (p: string) => {
      if (p.endsWith('SKILL.md')) {
        return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false } as any;
      }
      return { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false } as any;
    };

    const fakeReaddir = (p: string) => {
      if (p.endsWith('.agents') || p.endsWith('skills')) return ['openspec-apply-change'];
      if (p.endsWith('openspec-apply-change')) return ['SKILL.md'];
      return [];
    };

    const ev1 = inspectInstalledEvidence('C:\\repo', {
      realpath: (p) => p,
      lstat: fakeLstat,
      readdir: fakeReaddir,
      readFile: () => skillContent,
    });

    const hash1 = ev1.outputInventory.find((o) => o.id === 'output-agents')?.contentHash;
    expect(hash1).not.toBeNull();

    // Modificar contenido conservando el mismo archivo y nombre
    skillContent = 'description: version 2 con modificaciones';

    const ev2 = inspectInstalledEvidence('C:\\repo', {
      realpath: (p) => p,
      lstat: fakeLstat,
      readdir: fakeReaddir,
      readFile: () => skillContent,
    });

    const hash2 = ev2.outputInventory.find((o) => o.id === 'output-agents')?.contentHash;
    expect(hash2).not.toBeNull();
    expect(hash1).not.toBe(hash2);
  });

  it('clasifica las skills oficiales de OpenSpec en .agents como new-agents', () => {
    const repo = 'C:\\repo';
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: ['openspec-apply-change', 'openspec-propose'],
      },
      files: [
        `${repo}\\.agents\\skills\\openspec-apply-change\\SKILL.md`,
        `${repo}\\.agents\\skills\\openspec-propose\\SKILL.md`,
      ],
    });
    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => 'generatedBy: "1.8.0"',
    });

    expect(evidence.configuredTools).toContain('agents');
    expect(evidence.configuredCount).toBe(1);

    const applySkill = evidence.skills.find((s) => s.name === 'openspec-apply-change');
    expect(applySkill?.origin).toBe('new-agents');
    expect(applySkill?.isOfficial).toBe(true);
  });

  it('detecta conflictos cuando existen ambas carpetas legacy y new skills simultáneamente', () => {
    const repo = 'C:\\repo';
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents', '.codex'],
        [`${repo}\\.codex`]: ['skills'],
        [`${repo}\\.codex\\skills`]: ['openspec-explore'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: ['openspec-apply-change'],
      },
      files: [
        `${repo}\\.codex\\skills\\openspec-explore\\SKILL.md`,
        `${repo}\\.agents\\skills\\openspec-apply-change\\SKILL.md`,
      ],
    });
    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => 'generatedBy: "1.5.0"',
    });

    expect(evidence.legacy).toContain('codex');
    expect(evidence.skills.some((s) => s.name === 'openspec-explore')).toBe(true);
    expect(evidence.conflicts).not.toBeNull();
    expect(evidence.conflicts?.length).toBeGreaterThan(0);
  });

  it('construye el inventario dinámico de outputs para todos los targets soportados', () => {
    const evidence = inspectInstalledEvidence('C:\\repo', {
      lstat: (p) => {
        if (p.includes('.github') || p.includes('.minimax')) {
          return { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false } as any;
        }
        return null;
      },
      readdir: (p) => (p.includes('.minimax') ? ['openspec-apply-change'] : []),
      readFile: () => '',
    });

    expect(evidence.outputInventory.length).toBeGreaterThan(15);
    const minimax = evidence.outputInventory.find((o) => o.targetName === 'MiniMax Code' || o.id === 'output-minimax-code');
    expect(minimax?.kind).toBe('external-global');
    expect(minimax?.blocked).toBe(true);
    expect(minimax?.presenceState).toBe('present');

    const github = evidence.outputInventory.find((o) => o.targetName === 'GitHub Workflows' || o.id === 'output-github');
    expect(github).toBeUndefined();

    const cursor = evidence.outputInventory.find((o) => o.targetName === 'Cursor' || o.id === 'output-cursor');
    expect(cursor?.presenceState).toBe('absent');
  });

  it('detecta symlinks apuntando a directorios hermanos fuera del repositorio y los marca como conflicto', () => {
    const evidence = inspectInstalledEvidence('C:\\repo', {
      realpath: (p) => {
        if (p === 'C:\\repo') return 'C:\\repo';
        if (p.includes('.agents')) return 'C:\\repo-sibling\\external-agents';
        return p;
      },
      lstat: (p) => {
        if (p.includes('.agents')) {
          return { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => true } as any;
        }
        return { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false } as any;
      },
      readdir: () => [],
      readFile: () => '',
    });

    expect(evidence.conflicts).not.toBeNull();
    expect(evidence.conflicts?.some((c) => c.includes('apunta fuera del repositorio'))).toBe(true);
    const agentsOutput = evidence.outputInventory.find((o) => o.id === 'output-agents');
    expect(agentsOutput?.presenceState).toBe('conflicting');
    expect(agentsOutput?.isSymlink).toBe(true);
  });

  it('reproduce en disco real el caso exacto de Alejandro: CLI 1.5, legacy skills 1.5, custom skills y global config 5 workflows', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-alejandro-test-'));
    try {
      // 1. Crear estructura real del repositorio
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

      const openspecDir = path.join(tempDir, 'openspec');
      fs.mkdirSync(openspecDir, { recursive: true });
      fs.writeFileSync(path.join(openspecDir, 'config.yaml'), 'schema: spec-driven\n');

      // Legacy skills en .codex/skills/
      const codexSkillDir = path.join(tempDir, '.codex', 'skills', 'openspec-apply-change');
      fs.mkdirSync(codexSkillDir, { recursive: true });
      fs.writeFileSync(path.join(codexSkillDir, 'SKILL.md'), '---\ngeneratedBy: "1.5.0"\n---\nLegacy skill\n');

      // Custom skills en .agents/skills/ (sin skills oficiales)
      const customSkillDir = path.join(tempDir, '.agents', 'skills', 'custom-helper');
      fs.mkdirSync(customSkillDir, { recursive: true });
      fs.writeFileSync(path.join(customSkillDir, 'SKILL.md'), '---\nname: custom-helper\n---\nCustom\n');

      // 2. Autorizar repositorio
      authorizedRepoStore.clear();
      const canonical = authorizedRepoStore.authorizeRepo(tempDir);
      expect(canonical).not.toBeNull();

      // 3. Inspeccionar evidencia real en disco
      const evidence = inspectInstalledEvidence(tempDir);
      expect(evidence.generatedBy).toBe('1.5.0');
      expect(evidence.legacy).toContain('codex');
      expect(evidence.customized).toContain('custom-helper');

      // 4. Evaluar snapshot diagnóstico completo
      const snapshot = await buildEngineStatusSnapshot(tempDir, {
        discoverCli: async () => ({
          installed: true,
          runtimeVersion: '1.5.0',
          provenance: 'global',
          displayPath: 'C:\\Users\\apdel\\AppData\\Roaming\\npm\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.8.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        }),
        readGlobalConfig: async () => ({
          rawProfile: 'core',
          configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
          origin: 'cli',
          readAt: new Date().toISOString(),
        }),
        runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
        runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
      });

      expect(snapshot.cli.runtimeVersion).toBe('1.5.0');
      expect(snapshot.repoState).toBe('initialized');
      expect(snapshot.integrationState).toBe('outdated');
      expect(snapshot.divergence?.isDivergent).toBe(true);
      expect(snapshot.divergence?.overallStatus).toBe('divergent');
      expect(typeof snapshot.divergence?.reason).toBe('object');
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('declara integrationState como no up-to-date (outdated) con workflows sólo en .codex/.agent y ninguno en .agents', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-legacy-only-'));
    try {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

      const openspecDir = path.join(tempDir, 'openspec');
      fs.mkdirSync(openspecDir, { recursive: true });
      fs.writeFileSync(path.join(openspecDir, 'config.yaml'), 'schema: spec-driven\n');

      const codexSkillDir = path.join(tempDir, '.codex', 'skills', 'openspec-apply-change');
      fs.mkdirSync(codexSkillDir, { recursive: true });
      fs.writeFileSync(path.join(codexSkillDir, 'SKILL.md'), '---\ngeneratedBy: "1.11.0"\n---\nLegacy codex skill\n');

      const agentSkillDir = path.join(tempDir, '.agent', 'skills', 'openspec-apply-change');
      fs.mkdirSync(agentSkillDir, { recursive: true });
      fs.writeFileSync(path.join(agentSkillDir, 'SKILL.md'), '---\ngeneratedBy: "1.11.0"\n---\nLegacy agent skill\n');

      const customAgentDir = path.join(tempDir, '.agents', 'skills', 'custom-tool');
      fs.mkdirSync(customAgentDir, { recursive: true });
      fs.writeFileSync(path.join(customAgentDir, 'SKILL.md'), '---\nname: custom-tool\n---\nCustom skill\n');

      authorizedRepoStore.clear();
      authorizedRepoStore.authorizeRepo(tempDir);

      const snapshot = await buildEngineStatusSnapshot(tempDir, {
        discoverCli: async () => ({
          installed: true,
          runtimeVersion: '1.11.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.11.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        }),
        readGlobalConfig: async () => ({
          rawProfile: 'core',
          configuredWorkflows: ['apply'],
          origin: 'cli',
          readAt: new Date().toISOString(),
        }),
        runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
        runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
      });

      expect(snapshot.integrationState).not.toBe('up-to-date');
      expect(snapshot.integrationState).toBe('outdated');
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('buildEngineStatusSnapshot deriva integrationState como outdated si hay targets sin configurar (1.4)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-unconfigured-target-'));
    try {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

      const openspecDir = path.join(tempDir, 'openspec');
      fs.mkdirSync(openspecDir, { recursive: true });
      fs.writeFileSync(path.join(openspecDir, 'config.yaml'), 'schema: spec-driven\n');

      // .agents con workflows oficiales
      const agentSkillDir = path.join(tempDir, '.agents', 'skills', 'openspec-apply-change');
      fs.mkdirSync(agentSkillDir, { recursive: true });
      fs.writeFileSync(path.join(agentSkillDir, 'SKILL.md'), '---\ngeneratedBy: "1.11.0"\n---\nOfficial agent skill\n');

      // Un directorio de herramientas presente en disco que no está en las configuradas
      const claudeDir = path.join(tempDir, '.claude', 'commands');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'test.md'), 'cmd');

      authorizedRepoStore.clear();
      authorizedRepoStore.authorizeRepo(tempDir);

      const snapshot = await buildEngineStatusSnapshot(tempDir, {
        discoverCli: async () => ({
          installed: true,
          runtimeVersion: '1.11.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.11.0' },
          versionClass: 'supported',
          evidenceStatus: 'confirmed',
          diagnostics: [],
        }),
        readGlobalConfig: async () => ({
          rawProfile: 'core',
          configuredWorkflows: ['apply'],
          origin: 'cli',
          readAt: new Date().toISOString(),
        }),
        runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
        runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
      });

      // La autoridad única en main deriva outdated porque .claude está presente pero sin configurar
      expect(snapshot.integrationState).toBe('outdated');
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('6.6: el estado medido de OdontoPau sin copias viejas (configuredTools: agents+codex, presentToolDirectories: agents+codex+github) da up-to-date', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-odontopau-up-to-date-'));
    try {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

      const openspecDir = path.join(tempDir, 'openspec');
      fs.mkdirSync(openspecDir, { recursive: true });
      fs.writeFileSync(path.join(openspecDir, 'config.yaml'), 'schema: spec-driven\n');

      // .agents con workflows oficiales y marca .openspec-target con 'codex'
      const agentSkillsDir = path.join(tempDir, '.agents', 'skills');
      fs.mkdirSync(agentSkillsDir, { recursive: true });
      fs.writeFileSync(path.join(agentSkillsDir, '.openspec-target'), 'codex\n');

      const workflows = ['apply', 'archive', 'explore', 'propose', 'sync', 'update'];
      const officialSkills = [
        'openspec-apply-change',
        'openspec-archive-change',
        'openspec-explore',
        'openspec-propose',
        'openspec-sync-specs',
        'openspec-update-change',
      ];
      for (const sk of officialSkills) {
        const wfDir = path.join(agentSkillsDir, sk);
        fs.mkdirSync(wfDir, { recursive: true });
        fs.writeFileSync(path.join(wfDir, 'SKILL.md'), `---\ngeneratedBy: "1.13.2"\n---\nOfficial agent skill\n`);
      }

      // .codex/config.toml (sin skills en .codex)
      const codexDir = path.join(tempDir, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(path.join(codexDir, 'config.toml'), '# codex config\n');

      // .github/workflows/ci.yml (directorio CI, no configurado por openspec)
      const githubDir = path.join(tempDir, '.github', 'workflows');
      fs.mkdirSync(githubDir, { recursive: true });
      fs.writeFileSync(path.join(githubDir, 'ci.yml'), 'name: CI\n');

      authorizedRepoStore.clear();
      authorizedRepoStore.authorizeRepo(tempDir);

      const snapshot = await buildEngineStatusSnapshot(tempDir, {
        discoverCli: async () => ({
          installed: true,
          runtimeVersion: '1.13.2',
          provenance: 'local',
          displayPath: 'node_modules\\.bin\\openspec.cmd',
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
        // El informe de herramientas se fija a la copia 1.13.2: sin esto la prueba consultaba
        // el paquete de OpenSpec instalado en la máquina, y con 1.14.0 instalado (2026-10-01)
        // marcaba Codex para actualizar aunque el motor simulado diga 1.13.2.
        readEngineToolReport: async ({ repoPath }) => buildFallbackToolReport({ repoPath, engineVersion: '1.13.2' }),
      });

      // Verificamos estado exacto medido de OdontoPau (sólo Codex configurada, decisión 3 y 4)
      expect(snapshot.installedIntegration?.configuredTools).toEqual(['codex']);
      expect(snapshot.installedIntegration?.presentToolDirectories).toContain('codex');
      expect(snapshot.installedIntegration?.conflicts).toBeNull();
      // .github no debe provocar 'outdated'
      expect(snapshot.integrationState).toBe('up-to-date');

      // Requisito 6.6: una sola fila para .agents/skills y .github no presente
      const agentSkillsOutputs = snapshot.installedIntegration?.outputInventory.filter((o) =>
        o.displayPath.includes('.agents/skills'),
      );
      expect(agentSkillsOutputs).toHaveLength(1);
      const githubOutput = snapshot.installedIntegration?.outputInventory.find((o) =>
        o.displayPath.includes('.github'),
      );
      expect(githubOutput?.presenceState).toBe('absent');

      // Tarea 6.10 / Decisión 12: convergencia de targets
      // Codex servida desde .agents/skills es convergente; github (CI) queda fuera de la divergencia
      expect(snapshot.divergence?.isDivergent).toBe(false);
      expect(snapshot.divergence?.overallStatus).toBe('convergent');
      expect(snapshot.divergence?.targetConvergences?.['codex']?.status).toBe('convergent');
      expect(snapshot.divergence?.targetConvergences?.['github']).toBeUndefined();

      // Perfil de workflows: ningún workflow acusa falta en Codex ni en GitHub Workflows
      const installedByTarget = Object.fromEntries(
        Object.entries(snapshot.divergence?.targetConvergences ?? {}).map(([id, c]) => [id, c.installedWorkflows]),
      );
      const rows = deriveProfileWorkflowRows(workflows, workflows, installedByTarget);
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect(row.missingByIntegration).toEqual([]);
      }

      // Con el nuevo diseño (registro-de-herramientas-desde-el-motor, Decisiones 3, 4 y 5):
      // Si se retira .openspec-target, .agents/skills pasa a pertenecer a 'agents' (Universal).
      // Codex queda disponible (por .codex) pero sin configurar (pendingTools), y no genera
      // divergencia en el perfil ni vuelve la integración 'outdated'.
      fs.unlinkSync(path.join(agentSkillsDir, '.openspec-target'));
      invalidateEngineToolReportCache(tempDir);
      const snapshotWithoutMarker = await buildEngineStatusSnapshot(tempDir, {
        discoverCli: async () => ({
          installed: true,
          runtimeVersion: '1.13.2',
          provenance: 'local',
          displayPath: 'node_modules\\.bin\\openspec.cmd',
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
        // Informe medido con el paquete real de OpenSpec 1.13.2 sobre este mismo armado
        // (2026-10-01): sin la marca .openspec-target, Codex no figura disponible y la
        // configurada es «agents». Antes la prueba consultaba el motor instalado en la
        // máquina, y con 1.14.0 marcaba Codex como pendiente; qué hace GitCron con la
        // 1.14 se revisa en el cambio del ciclo 1.14, no en esta prueba.
        readEngineToolReport: async ({ repoPath }) => {
          const report = buildFallbackToolReport({ repoPath, engineVersion: '1.13.2' });
          return {
            ...report,
            tools: report.tools.map((t) => {
              if (t.id === 'codex') return { ...t, available: false, configured: false };
              if (t.id === 'agents') return { ...t, available: true, configured: true };
              return t;
            }),
          };
        },
      });

      expect(snapshotWithoutMarker.installedIntegration?.configuredTools).toEqual(['agents']);
      expect(snapshotWithoutMarker.pendingTools).toEqual([]);
      expect(snapshotWithoutMarker.integrationState).toBe('up-to-date');
      expect(snapshotWithoutMarker.divergence?.isDivergent).toBe(false);
      expect(snapshotWithoutMarker.divergence?.overallStatus).toBe('convergent');
      expect(snapshotWithoutMarker.divergence?.targetConvergences?.['agents']?.status).toBe('convergent');
      expect(snapshotWithoutMarker.divergence?.targetConvergences?.['codex']).toBeUndefined();
      expect(snapshotWithoutMarker.divergence?.targetConvergences?.['github']).toBeUndefined();
      const rowsWithoutMarker = deriveProfileWorkflowRows(
        workflows,
        workflows,
        Object.fromEntries(
          Object.entries(snapshotWithoutMarker.divergence?.targetConvergences ?? {}).map(([id, c]) => [id, c.installedWorkflows]),
        ),
      );
      for (const row of rowsWithoutMarker) {
        expect(row.missingByIntegration).toEqual([]);
      }
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  describe('convergencia por target y perfiles (2.9 / Invariantes 8 & 19)', () => {
    it('target presente con cero workflows oficiales (.agents con custom skills) participa del cálculo e impide convergencia', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-target-conv-neg-'));
      try {
        // 1. Repositorio con .git, openspec y .agents con sólo custom skills
        fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
        fs.mkdirSync(path.join(tempDir, 'openspec'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');

        const customDir = path.join(tempDir, '.agents', 'skills', 'custom-helper');
        fs.mkdirSync(customDir, { recursive: true });
        fs.writeFileSync(path.join(customDir, 'SKILL.md'), '---\nname: custom-helper\n---\nCustom skill\n');

        authorizedRepoStore.clear();
        authorizedRepoStore.authorizeRepo(tempDir);

        const snapshot = await buildEngineStatusSnapshot(tempDir, {
          discoverCli: async () => ({
            installed: true,
            runtimeVersion: '1.8.0',
            provenance: 'global',
            displayPath: 'C:\\global\\openspec.cmd',
            supportedRange: { min: '1.5.0', max: '1.8.0' },
            versionClass: 'supported',
            evidenceStatus: 'confirmed',
            diagnostics: [],
          }),
          readGlobalConfig: async () => ({
            rawProfile: 'core',
            configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
            origin: 'cli',
            readAt: new Date().toISOString(),
          }),
          runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
          runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
        });

        // Target presente con 0 workflows oficiales NO puede ser convergent
        expect(snapshot.divergence?.isDivergent).toBe(true);
        expect(snapshot.divergence?.overallStatus).toBe('divergent');
        expect(snapshot.divergence?.targetConvergences?.['agents']?.status).toBe('divergent');
        expect(snapshot.divergence?.targetConvergences?.['agents']?.installedWorkflows).toEqual([]);

        // El motivo que cruza IPC es estructurado y tipado sin prosa en castellano ni inglés
        expect(typeof snapshot.divergence?.reason).toBe('object');
        expect(snapshot.divergence?.reason).toEqual({
          kind: 'target-workflows-mismatch',
          toolId: 'agents',
          label: 'Carpeta compartida .agents',
          targetCount: 0,
          targetWorkflows: [],
          globalCount: 5,
          globalWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync'],
        });
      } finally {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    });

    it('control positivo: todos los targets presentes con los mismos workflows que la global declaran convergencia', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-target-conv-pos-'));
      try {
        fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
        fs.mkdirSync(path.join(tempDir, 'openspec'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');

        const officialSkills = [
          'openspec-propose',
          'openspec-explore',
          'openspec-apply-change',
          'openspec-sync-specs',
          'openspec-archive-change',
        ];
        for (const sk of officialSkills) {
          const skDir = path.join(tempDir, '.agents', 'skills', sk);
          fs.mkdirSync(skDir, { recursive: true });
          fs.writeFileSync(path.join(skDir, 'SKILL.md'), '---\ngeneratedBy: "1.8.0"\n---\nOfficial skill\n');
        }

        authorizedRepoStore.clear();
        authorizedRepoStore.authorizeRepo(tempDir);

        const snapshot = await buildEngineStatusSnapshot(tempDir, {
          discoverCli: async () => ({
            installed: true,
            runtimeVersion: '1.8.0',
            provenance: 'global',
            displayPath: 'C:\\global\\openspec.cmd',
            supportedRange: { min: '1.5.0', max: '1.8.0' },
            versionClass: 'supported',
            evidenceStatus: 'confirmed',
            diagnostics: [],
          }),
          readGlobalConfig: async () => ({
            rawProfile: 'core',
            configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
            origin: 'cli',
            readAt: new Date().toISOString(),
          }),
          runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
          runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
        });

        // Todos los targets coinciden exactamente con la global
        expect(snapshot.divergence?.isDivergent).toBe(false);
        expect(snapshot.divergence?.overallStatus).toBe('convergent');
        expect(snapshot.divergence?.targetConvergences?.['agents']?.status).toBe('convergent');
        expect(snapshot.divergence?.reason).toBeNull();
      } finally {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    });

    it('cuando la evidencia de integración no es confirmada (unknown), la convergencia queda unknown y no afirma convergent', async () => {
      const repo = 'C:\\repo';
      const disk = exactDiskDouble({
        dirs: {
          [repo]: ['.agents'],
          [`${repo}\\.agents`]: ['skills'],
        },
      });

      authorizedRepoStore.clear();
      authorizedRepoStore.authorizeRepo(repo);

      // Usando dobles anclados a rutas exactas (Invariante 19)
      const snapshot = await buildEngineStatusSnapshot(repo, {
        validateRepoPath: () => repo,
        discoverCli: async () => ({
          installed: true,
          runtimeVersion: '1.8.0',
          provenance: 'global',
          displayPath: 'C:\\global\\openspec.cmd',
          supportedRange: { min: '1.5.0', max: '1.8.0' },
          versionClass: 'supported',
          evidenceStatus: 'unknown',
          diagnostics: [],
        }),
        readGlobalConfig: async () => ({
          rawProfile: 'core',
          configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
          origin: 'cli',
          readAt: new Date().toISOString(),
        }),
        runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
        runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
      });

      // Nunca puede declararse convergente si la evidencia no está confirmada
      expect(snapshot.divergence?.overallStatus).toBe('unknown');
      expect(snapshot.divergence?.isDivergent).toBe(false);
    });

    describe('7.4a: clasificación y convergencia contra los workflows RESUELTOS del perfil', () => {
      const fiveSkills = [
        'openspec-propose',
        'openspec-explore',
        'openspec-apply-change',
        'openspec-sync-specs',
        'openspec-archive-change',
      ];

      function makeRepoWithAgentsSkills(tempDir: string, skills: string[]): void {
        fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
        fs.mkdirSync(path.join(tempDir, 'openspec'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
        for (const sk of skills) {
          const skDir = path.join(tempDir, '.agents', 'skills', sk);
          fs.mkdirSync(skDir, { recursive: true });
          fs.writeFileSync(path.join(skDir, 'SKILL.md'), '---\ngeneratedBy: "1.8.0"\n---\nOfficial skill\n');
        }
      }

      const cliDouble = () => async () => ({
        installed: true,
        runtimeVersion: '1.8.0',
        provenance: 'global',
        displayPath: 'C:\\global\\openspec.cmd',
        supportedRange: { min: '1.5.0', max: '1.8.0' },
        versionClass: 'supported',
        evidenceStatus: 'confirmed',
        diagnostics: [],
      });

      it('caso A: configured=5 (sin update) y resolved=6 (con update) -> globalProfileClass core y target agents con 5 queda divergente', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-74a-case-a-'));
        try {
          makeRepoWithAgentsSkills(tempDir, fiveSkills);

          authorizedRepoStore.clear();
          authorizedRepoStore.authorizeRepo(tempDir);

          const snapshot = await buildEngineStatusSnapshot(tempDir, {
            discoverCli: cliDouble(),
            readGlobalConfig: async () => ({
              rawProfile: 'core',
              configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
              resolvedWorkflows: ['propose', 'explore', 'apply', 'update', 'sync', 'archive'],
              resolvedWorkflowsState: 'read',
              origin: 'cli',
              readAt: new Date().toISOString(),
            }),
            runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
            runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
          });

          expect(snapshot.divergence?.globalProfileClass).toBe('core');
          expect(snapshot.divergence?.targetConvergences?.['agents']?.status).toBe('divergent');
          // La divergencia se mide contra lo RESUELTO (6), no contra lo escrito (5)
          expect(snapshot.divergence?.reason).toEqual({
            kind: 'target-workflows-mismatch',
            toolId: 'agents',
            label: 'Carpeta compartida .agents',
            targetCount: 5,
            targetWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync'],
            globalCount: 6,
            globalWorkflows: ['apply', 'archive', 'explore', 'propose', 'sync', 'update'],
          });
        } finally {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      });

      it('caso B: mismo perfil resuelto a 6 y target agents con los 6 workflows -> convergent', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-74a-case-b-'));
        try {
          makeRepoWithAgentsSkills(tempDir, [...fiveSkills, 'openspec-update-plan']);

          authorizedRepoStore.clear();
          authorizedRepoStore.authorizeRepo(tempDir);

          const snapshot = await buildEngineStatusSnapshot(tempDir, {
            discoverCli: cliDouble(),
            readGlobalConfig: async () => ({
              rawProfile: 'core',
              configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
              resolvedWorkflows: ['propose', 'explore', 'apply', 'update', 'sync', 'archive'],
              resolvedWorkflowsState: 'read',
              origin: 'cli',
              readAt: new Date().toISOString(),
            }),
            runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
            runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
          });

          expect(snapshot.divergence?.globalProfileClass).toBe('core');
          expect(snapshot.divergence?.targetConvergences?.['agents']?.status).toBe('convergent');
          expect(snapshot.divergence?.isDivergent).toBe(false);
          expect(snapshot.divergence?.overallStatus).toBe('convergent');
        } finally {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      });

      it('caso C (fallback): resolvedWorkflows=null y state failed -> clasifica igual que hoy usando configured', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-74a-case-c-'));
        try {
          makeRepoWithAgentsSkills(tempDir, fiveSkills);

          authorizedRepoStore.clear();
          authorizedRepoStore.authorizeRepo(tempDir);

          const snapshot = await buildEngineStatusSnapshot(tempDir, {
            discoverCli: cliDouble(),
            readGlobalConfig: async () => ({
              rawProfile: 'core',
              configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
              resolvedWorkflows: null,
              resolvedWorkflowsState: 'failed',
              origin: 'cli',
              readAt: new Date().toISOString(),
            }),
            runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
            runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
          });

          // Comportamiento actual: 5 workflows escritos -> custom, y target idéntico converge
          expect(snapshot.divergence?.globalProfileClass).toBe('custom');
          expect(snapshot.divergence?.targetConvergences?.['agents']?.status).toBe('convergent');
        } finally {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      });

      it('caso con dos agentes divergentes -> produce reason con kind multiple-target-divergences', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-multiple-target-div-'));
        try {
          makeRepoWithAgentsSkills(tempDir, fiveSkills);
          for (const sk of fiveSkills) {
            const skDir = path.join(tempDir, '.claude', 'skills', sk);
            fs.mkdirSync(skDir, { recursive: true });
            fs.writeFileSync(path.join(skDir, 'SKILL.md'), '---\ngeneratedBy: "1.8.0"\n---\nOfficial skill\n');
          }

          authorizedRepoStore.clear();
          authorizedRepoStore.authorizeRepo(tempDir);

          const snapshot = await buildEngineStatusSnapshot(tempDir, {
            discoverCli: cliDouble(),
            readGlobalConfig: async () => ({
              rawProfile: 'core',
              configuredWorkflows: ['propose', 'explore', 'apply', 'sync', 'archive'],
              resolvedWorkflows: ['propose', 'explore', 'apply', 'update', 'sync', 'archive'],
              resolvedWorkflowsState: 'read',
              origin: 'cli',
              readAt: new Date().toISOString(),
            }),
            runDoctor: async () => ({ command: 'openspec doctor --json', ok: true, error: null, data: null }),
            runContext: async () => ({ command: 'openspec context --json', ok: true, error: null, data: null }),
          });

          expect(snapshot.divergence?.isDivergent).toBe(true);
          expect(snapshot.divergence?.overallStatus).toBe('divergent');
          expect(snapshot.divergence?.targetConvergences?.['agents']?.status).toBe('divergent');
          expect(snapshot.divergence?.targetConvergences?.['claude']?.status).toBe('divergent');
          expect(snapshot.divergence?.reason?.kind).toBe('multiple-target-divergences');
          if (snapshot.divergence?.reason?.kind === 'multiple-target-divergences') {
            expect(snapshot.divergence.reason.targets).toHaveLength(2);
            expect(snapshot.divergence.reason.targets.map((t) => t.toolId).sort()).toEqual(['agents', 'claude']);
          }
        } finally {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      });
    });
  });
});

describe('computeDirContentHash — recorrido acotado (invariante 19)', () => {
  it('termina y marca la evidencia como truncada cuando el árbol excede el tope de profundidad', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcron-deep-tree-'));
    try {
      // Disco real: cadena de directorios más profunda que DIR_HASH_MAX_DEPTH
      const skillsDir = path.join(tempDir, '.agents', 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });
      let current = skillsDir;
      for (let i = 0; i < DIR_HASH_MAX_DEPTH + 4; i++) {
        current = path.join(current, `nivel-${i}`);
        fs.mkdirSync(current);
      }
      fs.writeFileSync(path.join(current, 'SKILL.md'), 'contenido profundo');

      const evidence = inspectInstalledEvidence(tempDir);
      const agentsOutput = evidence.outputInventory.find((o) => o.id === 'output-agents');
      expect(agentsOutput?.hashTruncated).toBe(true);
      expect(agentsOutput?.contentHash).toBeNull();
      expect(evidence.evidenceStatus).toBe('unknown');
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('termina y marca la evidencia como truncada cuando el árbol excede el tope de entradas', () => {
    const repo = 'C:\\repo';
    const skillsDir = `${repo}\\.agents\\skills`;
    const wideNames = Array.from({ length: DIR_HASH_MAX_ENTRIES + 5 }, (_, i) => `archivo-${i}`);
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents'],
        [`${repo}\\.agents`]: ['skills'],
        [skillsDir]: wideNames,
      },
      // Árbol ancho pero finito: un archivo por entrada, a nivel 1.
      files: wideNames.map((n) => `${skillsDir}\\${n}`),
    });
    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => 'contenido',
    });

    const agentsOutput = evidence.outputInventory.find((o) => o.id === 'output-agents');
    expect(agentsOutput?.hashTruncated).toBe(true);
    expect(agentsOutput?.contentHash).toBeNull();
    expect(evidence.evidenceStatus).toBe('unknown');
  });

  it('termina ante un doble de disco cíclico (una carpeta que se contiene a sí misma)', () => {
    const repo = 'C:\\repo';
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: ['self'],
        // `path.join('self', '.') === 'self'`: sin corte de reentrada, el
        // recorrido vuelve a entrar en la misma carpeta para siempre.
        [`${repo}\\.agents\\skills\\self`]: ['.', '..'],
      },
    });
    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => '',
    });

    // El corte por reentrada no es pérdida de datos: el recorrido no queda truncado.
    const agentsOutput = evidence.outputInventory.find((o) => o.id === 'output-agents');
    expect(agentsOutput?.hashTruncated).toBe(false);
    expect(evidence.evidenceStatus).not.toBe('unknown');
  });

  it('un árbol dentro de los topes sigue produciendo hash completo sin truncar', () => {
    const repo = 'C:\\repo';
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: ['openspec-apply-change'],
        [`${repo}\\.agents\\skills\\openspec-apply-change`]: ['SKILL.md'],
      },
      files: [`${repo}\\.agents\\skills\\openspec-apply-change\\SKILL.md`],
    });
    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => 'generatedBy: "1.8.0"',
    });

    const agentsOutput = evidence.outputInventory.find((o) => o.id === 'output-agents');
    expect(agentsOutput?.hashTruncated).toBe(false);
    expect(agentsOutput?.contentHash).not.toBeNull();
    expect(evidence.evidenceStatus).toBe('confirmed');
  });

  it('clasifica skills en la taxonomía exacta de origin sin caer en custom-agents por omisión', () => {
    const repo = 'C:\\repo';
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.codex', '.agent', '.agents', '.claude', '.opencode'],
        [`${repo}\\.codex`]: ['skills'],
        [`${repo}\\.codex\\skills`]: [
          'openspec-propose',
          'openspec-explore',
          'openspec-apply-change',
          'openspec-sync-specs',
          'openspec-archive-change',
        ],
        [`${repo}\\.agent`]: ['skills'],
        [`${repo}\\.agent\\skills`]: [
          'openspec-propose',
          'openspec-explore',
          'openspec-apply-change',
          'openspec-sync-specs',
          'openspec-archive-change',
        ],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: ['accessibility', 'seo', 'dex'],
        [`${repo}\\.claude`]: ['skills'],
        [`${repo}\\.claude\\skills`]: [
          'openspec-propose',
          'openspec-explore',
          'openspec-apply-change',
          'openspec-sync-specs',
          'openspec-archive-change',
        ],
        [`${repo}\\.opencode`]: ['skills'],
        [`${repo}\\.opencode\\skills`]: [
          'openspec-propose',
          'openspec-explore',
          'openspec-apply-change',
          'openspec-sync-specs',
          'openspec-archive-change',
        ],
      },
    });

    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => '',
    });

    // 10 legacy skills (5 codex, 5 agent)
    const legacyCodex = evidence.skills.filter((s) => s.origin === 'legacy-codex');
    const legacyAgent = evidence.skills.filter((s) => s.origin === 'legacy-agent');
    expect(legacyCodex).toHaveLength(5);
    expect(legacyAgent).toHaveLength(5);
    expect(evidence.legacy).toEqual(expect.arrayContaining(['codex', 'antigravity']));

    // 10 official skills en otras herramientas (5 claude, 5 opencode)
    const officialOther = evidence.skills.filter((s) => s.origin === 'official-other');
    expect(officialOther).toHaveLength(10);
    expect(officialOther.every((s) => s.isOfficial)).toBe(true);

    // .agents sólo tiene personalizados, ninguno es openspec-*
    const customAgents = evidence.skills.filter((s) => s.origin === 'custom-agents');
    expect(customAgents.map((s) => s.name).sort()).toEqual(['accessibility', 'dex', 'seo']);
    expect(customAgents.every((s) => !s.isOfficial)).toBe(true);
    expect(customAgents.some((s) => s.name.startsWith('openspec-'))).toBe(false);
  });

  it('reconoce openspec-update-change en target .agents y clasifica el perfil como core cuando tiene los 6 skills', () => {
    const repo = 'C:\\repo';
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: [
          'openspec-apply-change',
          'openspec-archive-change',
          'openspec-explore',
          'openspec-propose',
          'openspec-sync-specs',
          'openspec-update-change',
        ],
      },
    });

    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => '',
    });

    expect(evidence.installedWorkflowsByTarget.agents).toEqual(
      expect.arrayContaining(['apply', 'archive', 'explore', 'propose', 'sync', 'update'])
    );
    expect(evidence.installedWorkflowsByTarget.agents).toHaveLength(6);
    const profile = classifyOpenSpecProfile({
      workflows: evidence.installedWorkflowsByTarget.agents,
      source: 'installed-integration',
    });
    expect(profile.profileClass).toBe('core');
  });

  it('detecta que a un agente con sólo openspec-update-change le falta el resto de core pero tiene update', () => {
    const repo = 'C:\\repo';
    const disk = exactDiskDouble({
      dirs: {
        [repo]: ['.agents'],
        [`${repo}\\.agents`]: ['skills'],
        [`${repo}\\.agents\\skills`]: ['openspec-update-change'],
      },
    });

    const evidence = inspectInstalledEvidence(repo, {
      realpath: (p) => p,
      ...disk,
      readFile: () => '',
    });

    expect(evidence.installedWorkflowsByTarget.agents).toEqual(['update']);
    const profile = classifyOpenSpecProfile({
      workflows: evidence.installedWorkflowsByTarget.agents,
      source: 'installed-integration',
    });
    expect(profile.profileClass).toBe('custom');
  });

  describe('6.2: marca de carpeta compartida (.openspec-target) y convivencia legacy', () => {
    it('(a) .agents/skills con marca codex + .codex/config.toml sin skills -> Codex configurada, sin conflicto y sin targets desconfigurados', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-evidence-62a-'));
      try {
        const agentsSkillsDir = path.join(tmpDir, '.agents', 'skills');
        fs.mkdirSync(agentsSkillsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsSkillsDir, '.openspec-target'), 'codex\n', 'utf-8');

        const agentSkill = path.join(agentsSkillsDir, 'openspec-explore');
        fs.mkdirSync(agentSkill, { recursive: true });
        fs.writeFileSync(path.join(agentSkill, 'SKILL.md'), '---\ngeneratedBy: "1.13.2"\n---\n', 'utf-8');

        const codexDir = path.join(tmpDir, '.codex');
        fs.mkdirSync(codexDir, { recursive: true });
        fs.writeFileSync(path.join(codexDir, 'config.toml'), '# config propia\n', 'utf-8');

        const evidence = inspectInstalledEvidence(tmpDir);

        // Codex figura en configuredTools gracias a .openspec-target (decisión 3 y 4)
        expect(evidence.configuredTools).toContain('codex');
        expect(evidence.configuredTools).not.toContain('agents');
        // No hay conflicto de convivencia
        expect(evidence.conflicts).toBeNull();
        // .codex está en presentToolDirectories pero al estar configurada no deja targets sin configurar
        expect(evidence.presentToolDirectories).toContain('codex');
        const presentDirs = evidence.presentToolDirectories ?? [];
        const confTools = evidence.configuredTools ?? [];
        const hasUnconfiguredTarget = presentDirs.some((t) => !confTools.includes(t));
        expect(hasUnconfiguredTarget).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('(b) lo mismo + .codex/skills/openspec-explore/SKILL.md -> conflicto de convivencia y copia informada como legacy-codex', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-evidence-62b-'));
      try {
        const agentsSkillsDir = path.join(tmpDir, '.agents', 'skills');
        fs.mkdirSync(agentsSkillsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsSkillsDir, '.openspec-target'), 'codex\n', 'utf-8');

        const agentSkill = path.join(agentsSkillsDir, 'openspec-explore');
        fs.mkdirSync(agentSkill, { recursive: true });
        fs.writeFileSync(path.join(agentSkill, 'SKILL.md'), '---\ngeneratedBy: "1.13.2"\n---\n', 'utf-8');

        const codexSkillDir = path.join(tmpDir, '.codex', 'skills', 'openspec-explore');
        fs.mkdirSync(codexSkillDir, { recursive: true });
        fs.writeFileSync(path.join(codexSkillDir, 'SKILL.md'), '---\ngeneratedBy: "1.5.0"\n---\n', 'utf-8');

        const evidence = inspectInstalledEvidence(tmpDir);

        // Conflicto de convivencia detectado
        expect(evidence.conflicts).toContain('Coexistencia de configuración legacy (.codex/.agent) y nueva (.agents).');
        // La copia en .codex se clasifica con origin legacy-codex
        const legacySkill = evidence.skills.find((s) => s.path.includes('.codex'));
        expect(legacySkill?.origin).toBe('legacy-codex');
        expect(legacySkill?.name).toBe('openspec-explore');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('(c) marca con un valor que no está en el registro -> se ignora', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-evidence-62c-'));
      try {
        const agentsSkillsDir = path.join(tmpDir, '.agents', 'skills');
        fs.mkdirSync(agentsSkillsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsSkillsDir, '.openspec-target'), 'herramienta-inventada-desconocida\n', 'utf-8');

        const evidence = inspectInstalledEvidence(tmpDir);

        expect(evidence.configuredTools).not.toContain('herramienta-inventada-desconocida');
        expect(evidence.targets).not.toContain('herramienta-inventada-desconocida');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('6.10: función compartida readSharedSkillTarget', () => {
    it('(a) resuelve herramienta válida y configurable', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-target-valid-'));
      try {
        const skillsDir = path.join(tmpDir, '.agents', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.writeFileSync(path.join(skillsDir, '.openspec-target'), 'codex\n', 'utf-8');

        expect(readSharedSkillTarget(tmpDir)).toBe('codex');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('(b) ignora herramienta no configurable (ej. github / ci)', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-target-ci-'));
      try {
        const skillsDir = path.join(tmpDir, '.agents', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.writeFileSync(path.join(skillsDir, '.openspec-target'), 'github\n', 'utf-8');

        expect(readSharedSkillTarget(tmpDir)).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('(c) ignora herramienta desconocida o archivo vacío', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-target-unknown-'));
      try {
        const skillsDir = path.join(tmpDir, '.agents', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.writeFileSync(path.join(skillsDir, '.openspec-target'), 'inventada\n', 'utf-8');
        expect(readSharedSkillTarget(tmpDir)).toBeNull();

        fs.writeFileSync(path.join(skillsDir, '.openspec-target'), '   \n', 'utf-8');
        expect(readSharedSkillTarget(tmpDir)).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('(d) devuelve null si el archivo no existe', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-target-none-'));
      try {
        expect(readSharedSkillTarget(tmpDir)).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('(e) detecta escape de contención y llama a onEscape', () => {
      let escapedPath: string | null = null;
      const target = readSharedSkillTarget('C:\\repo', {
        realpath: (p) => {
          if (p.includes('.openspec-target')) return 'C:\\outside\\target';
          return 'C:\\repo';
        },
        lstat: () => ({ isFile: () => true } as any),
        readFile: () => 'codex',
        onEscape: (p) => {
          escapedPath = p;
        },
      });

      expect(target).toBeNull();
      expect(escapedPath).toBe('C:\\outside\\target');
    });
  });
});
