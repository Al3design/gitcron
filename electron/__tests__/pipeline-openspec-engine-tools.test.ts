import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  annotateSharedFolderTools,
  buildFallbackToolReport,
  getCachedToolReport,
  invalidateEngineToolReportCache,
  locateOpenSpecPackage,
  readEngineToolReport,
  validateEngineToolReport,
  type OpenSpecToolReport,
} from '../pipeline/openspec-engine-tools';

describe('openspec-engine-tools (Grupo 2)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gitcron-engine-tools-test-'));
    invalidateEngineToolReportCache();
  });

  // =========================================================================
  // 2.1 Ubicación del paquete (decisión 2)
  // =========================================================================
  describe('2.1 Ubicación del paquete (decisión 2)', () => {
    it('ubica copia del repositorio por node_modules/@fission-ai/openspec', async () => {
      const repoPath = path.join(tempDir, 'my-repo');
      const pkgDir = path.join(repoPath, 'node_modules', '@fission-ai', 'openspec');
      await fsp.mkdir(pkgDir, { recursive: true });
      await fsp.writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2' }),
      );

      const result = locateOpenSpecPackage({ repoPath, runtimeVersion: '1.13.2' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(path.normalize(result.packageDir)).toBe(path.normalize(pkgDir));
        expect(result.version).toBe('1.13.2');
      }
    });

    it('devuelve version-mismatch si la versión del paquete del repositorio no coincide con la esperada', async () => {
      const repoPath = path.join(tempDir, 'my-repo');
      const pkgDir = path.join(repoPath, 'node_modules', '@fission-ai', 'openspec');
      await fsp.mkdir(pkgDir, { recursive: true });
      await fsp.writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@fission-ai/openspec', version: '1.12.0' }),
      );

      const result = locateOpenSpecPackage({ repoPath, runtimeVersion: '1.13.2' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('version-mismatch');
        expect(result.packageVersion).toBe('1.12.0');
      }
    });

    it('ubica motor del sistema cuando realpath termina en bin/openspec.js (enlace POSIX)', async () => {
      const pkgDir = path.join(tempDir, 'global-pkg');
      const binDir = path.join(pkgDir, 'bin');
      await fsp.mkdir(binDir, { recursive: true });
      await fsp.writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2' }),
      );
      const jsFile = path.join(binDir, 'openspec.js');
      await fsp.writeFile(jsFile, '#!/usr/bin/env node\n');

      const result = locateOpenSpecPackage({
        executablePath: jsFile,
        runtimeVersion: '1.13.2',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(path.normalize(result.packageDir)).toBe(path.normalize(pkgDir));
      }
    });

    it('ubica motor del sistema leyendo lanzador .cmd de pnpm (%~dp0\\..\\global\\v11\\<hash>\\node_modules\\@fission-ai\\openspec\\bin\\openspec.js)', async () => {
      const pnpmBinDir = path.join(tempDir, 'pnpm-bin');
      const pkgDir = path.join(tempDir, 'global', 'v11', '7598-hash', 'node_modules', '@fission-ai', 'openspec');
      const binDir = path.join(pkgDir, 'bin');
      await fsp.mkdir(pnpmBinDir, { recursive: true });
      await fsp.mkdir(binDir, { recursive: true });
      await fsp.writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2' }),
      );
      await fsp.writeFile(path.join(binDir, 'openspec.js'), '// openspec js\n');

      const cmdPath = path.join(pnpmBinDir, 'openspec.cmd');
      const cmdContent = `@SETLOCAL\r\nnode "%~dp0\\..\\global\\v11\\7598-hash\\node_modules\\@fission-ai\\openspec\\bin\\openspec.js" %*\r\n`;
      await fsp.writeFile(cmdPath, cmdContent);

      const result = locateOpenSpecPackage({
        executablePath: cmdPath,
        runtimeVersion: '1.13.2',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(path.normalize(result.packageDir)).toBe(path.normalize(pkgDir));
      }
    });

    it('ubica motor del sistema leyendo lanzador sh de npm ($basedir/...)', async () => {
      const binDir = path.join(tempDir, 'bin');
      const pkgDir = path.join(tempDir, 'lib', 'node_modules', '@fission-ai', 'openspec');
      await fsp.mkdir(binDir, { recursive: true });
      await fsp.mkdir(path.join(pkgDir, 'bin'), { recursive: true });
      await fsp.writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2' }),
      );
      await fsp.writeFile(path.join(pkgDir, 'bin', 'openspec.js'), '#!/usr/bin/env node\n');

      const shPath = path.join(binDir, 'openspec');
      const shContent = `#!/bin/sh\nbasedir=$(dirname "$0")\nexec node "$basedir/../lib/node_modules/@fission-ai/openspec/bin/openspec.js" "$@"\n`;
      await fsp.writeFile(shPath, shContent);

      const result = locateOpenSpecPackage({
        executablePath: shPath,
        runtimeVersion: '1.13.2',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(path.normalize(result.packageDir)).toBe(path.normalize(pkgDir));
      }
    });

    it('devuelve package-not-found si el lanzador tiene dos candidatas diferentes', async () => {
      const binDir = path.join(tempDir, 'bin');
      const pkg1 = path.join(tempDir, 'v1', 'node_modules', '@fission-ai', 'openspec');
      const pkg2 = path.join(tempDir, 'v2', 'node_modules', '@fission-ai', 'openspec');
      await fsp.mkdir(binDir, { recursive: true });
      await fsp.mkdir(path.join(pkg1, 'bin'), { recursive: true });
      await fsp.mkdir(path.join(pkg2, 'bin'), { recursive: true });
      await fsp.writeFile(path.join(pkg1, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2' }));
      await fsp.writeFile(path.join(pkg2, 'package.json'), JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2' }));
      await fsp.writeFile(path.join(pkg1, 'bin', 'openspec.js'), '');
      await fsp.writeFile(path.join(pkg2, 'bin', 'openspec.js'), '');

      const cmdPath = path.join(binDir, 'openspec.cmd');
      const cmdContent = `
        node "%~dp0\\..\\v1\\node_modules\\@fission-ai\\openspec\\bin\\openspec.js"
        node "%~dp0\\..\\v2\\node_modules\\@fission-ai\\openspec\\bin\\openspec.js"
      `;
      await fsp.writeFile(cmdPath, cmdContent);

      const result = locateOpenSpecPackage({ executablePath: cmdPath });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('package-not-found');
      }
    });
  });

  async function createFakeOpenSpecPackage(targetDir: string, version: string = '1.13.2') {
    const coreDir = path.join(targetDir, 'dist', 'core');
    const sharedDir = path.join(coreDir, 'shared');
    await fsp.mkdir(sharedDir, { recursive: true });

    await fsp.writeFile(
      path.join(targetDir, 'package.json'),
      JSON.stringify({ name: '@fission-ai/openspec', version }),
    );

    // dist/core/config.js
    await fsp.writeFile(
      path.join(coreDir, 'config.js'),
      `export const AI_TOOLS = [
        { name: 'Codex', value: 'codex', skillsDir: '.agents', legacySkillsDirs: ['.codex'] }
      ];
      export const OPENSPEC_SKILL_NAMES = ['openspec-propose'];
      `,
    );

    // dist/core/available-tools.js
    await fsp.writeFile(
      path.join(coreDir, 'available-tools.js'),
      `export function getAvailableTools(projectPath) {
        return [{ name: 'Codex', value: 'codex' }];
      }
      `,
    );

    // dist/core/shared/tool-detection.js
    await fsp.writeFile(
      path.join(sharedDir, 'tool-detection.js'),
      `export function getToolStates(projectRoot) {
        return new Map([['codex', { configured: true, fullyConfigured: true, skillCount: 1 }]]);
      }
      export function getAllToolVersionStatus(projectRoot, currentVersion) {
        return [{
          toolId: 'codex',
          toolName: 'Codex',
          configured: true,
          generatedByVersion: currentVersion,
          needsUpdate: false
        }];
      }
      export function getConfiguredTools(projectRoot) {
        return ['codex'];
      }
      `,
    );

    // dist/core/profile-sync-drift.js
    await fsp.writeFile(
      path.join(coreDir, 'profile-sync-drift.js'),
      `export function getToolsNeedingProfileSync(projectPath, workflows, delivery, configuredTools) {
        return [];
      }
      `,
    );
  }

  // =========================================================================
  // 2.2 Ejecución en subproceso aislado (decisión 1)
  // =========================================================================
  describe('2.2 Ejecución en subproceso aislado (decisión 1)', () => {
    it('paquete válido con los cuatro módulos emite informe con source: engine', async () => {
      const pkgDir = path.join(tempDir, 'fake-openspec');
      await createFakeOpenSpecPackage(pkgDir, '1.13.2');

      const repoPath = path.join(tempDir, 'repo');
      await fsp.mkdir(repoPath, { recursive: true });

      const report = await readEngineToolReport({
        repoPath,
        executablePath: path.join(pkgDir, 'bin', 'openspec.js'),
        runtimeVersion: '1.13.2',
        nodeExecutable: process.execPath,
      });

      expect(report.source).toBe('engine');
      expect(report.engineVersion).toBe('1.13.2');
      expect(report.fallbackReason).toBeUndefined();
      expect(report.tools).toHaveLength(1);
      expect(report.tools[0]).toEqual({
        id: 'codex',
        label: 'Codex',
        skillsDir: '.agents',
        legacySkillsDirs: ['.codex'],
        available: true,
        configured: true,
        needsUpdate: false,
        generatedBy: '1.13.2',
      });
      expect(report.profileSyncNeeded).toEqual([]);
    });

    it('módulo que falta o cambia de forma produce engine-api-changed y usa respaldo', async () => {
      const pkgDir = path.join(tempDir, 'broken-openspec');
      await createFakeOpenSpecPackage(pkgDir, '1.13.2');

      // Romper available-tools.js eliminando la exportación requerida
      await fsp.writeFile(path.join(pkgDir, 'dist', 'core', 'available-tools.js'), `export const algoRoto = 123;`);

      const repoPath = path.join(tempDir, 'repo');
      await fsp.mkdir(repoPath, { recursive: true });

      const report = await readEngineToolReport({
        repoPath,
        executablePath: path.join(pkgDir, 'bin', 'openspec.js'),
        runtimeVersion: '1.13.2',
        nodeExecutable: process.execPath,
      });

      expect(report.source).toBe('gitcron-fallback');
      expect(report.fallbackReason).toBe('engine-api-changed');
      expect(report.tools.length).toBeGreaterThan(0);
    });

    it('script que excede el tiempo límite produce timeout y usa respaldo', async () => {
      const pkgDir = path.join(tempDir, 'hanging-openspec');
      await createFakeOpenSpecPackage(pkgDir, '1.13.2');

      // Poner un bucle infinito en config.js
      await fsp.writeFile(
        path.join(pkgDir, 'dist', 'core', 'config.js'),
        `const end = Date.now() + 50000; while(Date.now() < end) {} export const AI_TOOLS = [];`,
      );

      const repoPath = path.join(tempDir, 'repo');
      await fsp.mkdir(repoPath, { recursive: true });

      const report = await readEngineToolReport({
        repoPath,
        executablePath: path.join(pkgDir, 'bin', 'openspec.js'),
        runtimeVersion: '1.13.2',
        nodeExecutable: process.execPath,
        timeoutMs: 300, // Timeout corto para la prueba
      });

      expect(report.source).toBe('gitcron-fallback');
      expect(report.fallbackReason).toBe('timeout');
    });

    it('mientras el proceso hijo corre, el bucle de eventos sigue atendiendo (no bloquea)', async () => {
      const pkgDir = path.join(tempDir, 'slow-openspec');
      await createFakeOpenSpecPackage(pkgDir, '1.13.2');

      // config.js tarda 300 ms con top-level await en ESM
      await fsp.writeFile(
        path.join(pkgDir, 'dist', 'core', 'config.js'),
        `await new Promise((r) => setTimeout(r, 300)); export const AI_TOOLS = [{ name: 'Codex', value: 'codex', skillsDir: '.agents' }]; export const OPENSPEC_SKILL_NAMES = [];`,
      );

      const repoPath = path.join(tempDir, 'repo');
      await fsp.mkdir(repoPath, { recursive: true });

      let eventLoopServiced = false;
      setTimeout(() => {
        eventLoopServiced = true;
      }, 0);

      const reportPromise = readEngineToolReport({
        repoPath,
        executablePath: path.join(pkgDir, 'bin', 'openspec.js'),
        runtimeVersion: '1.13.2',
        nodeExecutable: process.execPath,
        timeoutMs: 5000,
      });

      // El setTimeout(0) debe resolverse mientras el proceso hijo de 300 ms sigue en vuelo
      await new Promise((r) => setTimeout(r, 50));
      expect(eventLoopServiced).toBe(true);

      const report = await reportPromise;
      expect(report.source).toBe('engine');
    });

    it('validador estricto validateEngineToolReport rechaza tipos incorrectos', () => {
      expect(validateEngineToolReport(null, '1.13.2')).toBeNull();
      expect(validateEngineToolReport({}, '1.13.2')).toBeNull();
      expect(validateEngineToolReport({ source: 'engine', engineVersion: '1.12.0' }, '1.13.2')).toBeNull();
      expect(
        validateEngineToolReport(
          {
            source: 'engine',
            engineVersion: '1.13.2',
            tools: [{ id: 123 }], // id no string
            profileSyncNeeded: [],
          },
          '1.13.2',
        ),
      ).toBeNull();
    });

    it('comparación obligatoria sobre C:\\www\\odontoPau y C:\\www\\gitCronos: readEngineToolReport y buildFallbackToolReport coinciden por herramienta', async () => {
      const realPkg = 'C:\\www\\odontoPau\\node_modules\\@fission-ai\\openspec';
      const odontoPauRepo = 'C:\\www\\odontoPau';
      const gitCronosRepo = 'C:\\www\\gitCronos';

      if (!fs.existsSync(realPkg)) {
        console.warn('Prueba comparativa omitida: paquete real no encontrado en C:\\www\\odontoPau\\node_modules\\@fission-ai\\openspec');
        return;
      }

      // 1. Verificación sobre C:\www\odontoPau
      if (fs.existsSync(odontoPauRepo)) {
        const engineReport = await readEngineToolReport({
          repoPath: odontoPauRepo,
          executablePath: path.join(realPkg, 'bin', 'openspec.js'),
          runtimeVersion: '1.13.2',
          nodeExecutable: process.execPath,
        });
        const fallbackReport = buildFallbackToolReport({
          repoPath: odontoPauRepo,
          reason: 'package-not-found',
          engineVersion: '1.13.2',
        });

        expect(engineReport.source).toBe('engine');
        expect(fallbackReport.source).toBe('gitcron-fallback');

        const engineAvail = engineReport.tools.filter((t) => t.available).map((t) => t.id).sort();
        const fallbackAvail = fallbackReport.tools.filter((t) => t.available).map((t) => t.id).sort();
        expect(engineAvail).toEqual(['codex']);
        expect(fallbackAvail).toEqual(engineAvail);

        const engineConf = engineReport.tools.filter((t) => t.configured).map((t) => t.id).sort();
        const fallbackConf = fallbackReport.tools.filter((t) => t.configured).map((t) => t.id).sort();
        expect(engineConf).toEqual(['codex']);
        expect(fallbackConf).toEqual(engineConf);

        // Comparación herramienta por herramienta
        for (const engineTool of engineReport.tools) {
          const fallbackTool = fallbackReport.tools.find((t) => t.id === engineTool.id);
          expect(fallbackTool).toBeDefined();
          expect(fallbackTool?.available).toBe(engineTool.available);
          expect(fallbackTool?.configured).toBe(engineTool.configured);
        }
      }

      // 2. Verificación sobre C:\www\gitCronos
      if (fs.existsSync(gitCronosRepo)) {
        const engineReport = await readEngineToolReport({
          repoPath: gitCronosRepo,
          executablePath: path.join(realPkg, 'bin', 'openspec.js'),
          runtimeVersion: '1.13.2',
          nodeExecutable: process.execPath,
        });
        const fallbackReport = buildFallbackToolReport({
          repoPath: gitCronosRepo,
          reason: 'package-not-found',
          engineVersion: '1.13.2',
        });

        expect(engineReport.source).toBe('engine');
        expect(fallbackReport.source).toBe('gitcron-fallback');

        const engineAvail = engineReport.tools.filter((t) => t.available).map((t) => t.id).sort();
        const fallbackAvail = fallbackReport.tools.filter((t) => t.available).map((t) => t.id).sort();
        expect(engineAvail.length).toBeGreaterThan(0);
        expect(fallbackAvail).toEqual(engineAvail);

        const engineConf = engineReport.tools.filter((t) => t.configured).map((t) => t.id).sort();
        const fallbackConf = fallbackReport.tools.filter((t) => t.configured).map((t) => t.id).sort();
        expect(fallbackConf).toEqual(engineConf);

        // Comparación herramienta por herramienta
        for (const engineTool of engineReport.tools) {
          const fallbackTool = fallbackReport.tools.find((t) => t.id === engineTool.id);
          expect(fallbackTool).toBeDefined();
          expect(fallbackTool?.available).toBe(engineTool.available);
          expect(fallbackTool?.configured).toBe(engineTool.configured);
        }
      }
    });
  });

  // =========================================================================
  // 2.3 Respaldo con la copia (decisión 4)
  // =========================================================================
  describe('2.3 Respaldo con la copia (decisión 4)', () => {
    it('árbol reproducido de OdontoPau en respaldo da disponibles [codex], configuradas [codex], al día', async () => {
      const repoPath = path.join(tempDir, 'odontoPau-tree');
      // .agents con skills y marca codex
      const agentsSkillsDir = path.join(repoPath, '.agents', 'skills');
      await fsp.mkdir(path.join(agentsSkillsDir, 'openspec-apply-change'), { recursive: true });
      await fsp.writeFile(
        path.join(agentsSkillsDir, 'openspec-apply-change', 'SKILL.md'),
        '---\ngeneratedBy: "1.14.0"\n---\n',
      );
      await fsp.writeFile(path.join(agentsSkillsDir, '.openspec-target'), 'codex\n');

      // .codex con config.toml y carpeta skills vacía
      await fsp.mkdir(path.join(repoPath, '.codex', 'skills'), { recursive: true });
      await fsp.writeFile(path.join(repoPath, '.codex', 'config.toml'), '# codex config\n');

      // .github con CI
      await fsp.mkdir(path.join(repoPath, '.github', 'workflows'), { recursive: true });
      await fsp.writeFile(path.join(repoPath, '.github', 'workflows', 'ci.yml'), 'name: CI\n');

      const report = buildFallbackToolReport({
        repoPath,
        reason: 'package-not-found',
        engineVersion: '1.14.0',
      });

      expect(report.source).toBe('gitcron-fallback');
      expect(report.fallbackReason).toBe('package-not-found');

      const codex = report.tools.find((t) => t.id === 'codex');
      expect(codex).toBeDefined();
      expect(codex?.available).toBe(true);
      expect(codex?.configured).toBe(true);
      expect(codex?.needsUpdate).toBe(false);

      const available = report.tools.filter((t) => t.available).map((t) => t.id);
      expect(available).toEqual(['codex']);

      const configured = report.tools.filter((t) => t.configured).map((t) => t.id);
      expect(configured).toEqual(['codex']);
      expect(report.profileSyncNeeded).toEqual([]);
    });

    it('árbol reproducido de gitCronos en respaldo da disponibles [antigravity, claude, codex, opencode, qwen, zcode] y configuradas menos zcode', async () => {
      const repoPath = path.join(tempDir, 'gitcronos-tree');

      // Carpetas presentes según detectionPaths o skillsDir:
      // antigravity (.agent), claude (.claude), codex (.codex), opencode (.opencode), qwen (.qwen), zcode (.zcode)
      await fsp.mkdir(path.join(repoPath, '.agent'), { recursive: true });
      await fsp.mkdir(path.join(repoPath, '.claude', 'skills', 'openspec-apply-change'), { recursive: true });
      await fsp.mkdir(path.join(repoPath, '.codex', 'skills', 'openspec-apply-change'), { recursive: true });
      await fsp.mkdir(path.join(repoPath, '.opencode', 'skills', 'openspec-apply-change'), { recursive: true });
      await fsp.mkdir(path.join(repoPath, '.qwen', 'skills', 'openspec-apply-change'), { recursive: true });
      await fsp.mkdir(path.join(repoPath, '.zcode'), { recursive: true }); // Zcode presente sin skills!

      // Escribir SKILL.md en las configuradas
      const skillContent = '---\ngeneratedBy: "1.13.2"\n---\n';
      await fsp.writeFile(path.join(repoPath, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md'), skillContent);
      await fsp.writeFile(path.join(repoPath, '.codex', 'skills', 'openspec-apply-change', 'SKILL.md'), skillContent);
      await fsp.writeFile(path.join(repoPath, '.opencode', 'skills', 'openspec-apply-change', 'SKILL.md'), skillContent);
      await fsp.writeFile(path.join(repoPath, '.qwen', 'skills', 'openspec-apply-change', 'SKILL.md'), skillContent);

      // En gitCronos real: .openspec-target es codex, y antigravity está configurada por workflows
      await fsp.mkdir(path.join(repoPath, '.agents', 'workflows'), { recursive: true });
      await fsp.writeFile(path.join(repoPath, '.agents', 'workflows', 'opsx-explore.md'), '# explore\n');
      await fsp.mkdir(path.join(repoPath, '.agents', 'skills', 'openspec-apply-change'), { recursive: true });
      await fsp.writeFile(path.join(repoPath, '.agents', 'skills', 'openspec-apply-change', 'SKILL.md'), skillContent);
      await fsp.writeFile(path.join(repoPath, '.agents', 'skills', '.openspec-target'), 'codex\n');

      const report = buildFallbackToolReport({
        repoPath,
        reason: 'failed',
        engineVersion: '1.13.2',
      });

      expect(report.source).toBe('gitcron-fallback');
      const available = report.tools.filter((t) => t.available).map((t) => t.id).sort();
      expect(available).toEqual(['antigravity', 'claude', 'codex', 'opencode', 'qwen', 'zcode'].sort());

      const configured = report.tools.filter((t) => t.configured).map((t) => t.id).sort();
      expect(configured).toEqual(['antigravity', 'claude', 'codex', 'opencode', 'qwen'].sort());

      // Zcode debe estar disponible pero NO configurada
      const zcode = report.tools.find((t) => t.id === 'zcode');
      expect(zcode?.available).toBe(true);
      expect(zcode?.configured).toBe(false);
    });
  });

  // =========================================================================
  // 2.4 Caché del informe e invalidación
  // =========================================================================
  describe('2.4 Caché del informe e invalidación', () => {
    it('dos lecturas seguidas lanzan un solo proceso; tras invalidación, lanzan otro', async () => {
      const pkgDir = path.join(tempDir, 'cache-openspec');
      const coreDir = path.join(pkgDir, 'dist', 'core');
      const sharedDir = path.join(coreDir, 'shared');
      await fsp.mkdir(sharedDir, { recursive: true });

      await fsp.writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@fission-ai/openspec', version: '1.13.2' }),
      );

      await fsp.writeFile(
        path.join(coreDir, 'config.js'),
        `export const AI_TOOLS = [{ name: 'Codex', value: 'codex', skillsDir: '.agents' }]; export const OPENSPEC_SKILL_NAMES = [];`,
      );
      await fsp.writeFile(path.join(coreDir, 'available-tools.js'), `export function getAvailableTools() { return []; }`);
      await fsp.writeFile(
        path.join(sharedDir, 'tool-detection.js'),
        `export function getToolStates() { return new Map(); } export function getAllToolVersionStatus() { return []; } export function getConfiguredTools() { return []; }`,
      );
      await fsp.writeFile(
        path.join(coreDir, 'profile-sync-drift.js'),
        `export function getToolsNeedingProfileSync() { return []; }`,
      );

      const repoPath = path.join(tempDir, 'repo');
      await fsp.mkdir(repoPath, { recursive: true });

      let spawnCount = 0;
      const customSpawn: typeof import('node:child_process').spawn = ((cmd: string, args: string[], opts: any) => {
        spawnCount++;
        const { spawn } = require('node:child_process');
        return spawn(cmd, args, opts);
      }) as any;

      const opts = {
        repoPath,
        executablePath: path.join(pkgDir, 'bin', 'openspec.js'),
        runtimeVersion: '1.13.2',
        nodeExecutable: process.execPath,
        deps: { spawn: customSpawn },
      };

      // Primera lectura -> ejecuta subproceso
      const report1 = await readEngineToolReport(opts);
      expect(report1.source).toBe('engine');
      expect(spawnCount).toBe(1);

      // Segunda lectura inmediata -> proviene de caché
      const report2 = await readEngineToolReport(opts);
      expect(report2.source).toBe('engine');
      expect(spawnCount).toBe(1);

      // Invalidación para el repositorio
      invalidateEngineToolReportCache(repoPath);

      // Tercera lectura -> lanza nuevo subproceso
      const report3 = await readEngineToolReport(opts);
      expect(report3.source).toBe('engine');
      expect(spawnCount).toBe(2);
    });

    it('tras un timeout, la lectura siguiente no se sirve de caché y vuelve a lanzar el proceso', async () => {
      const pkgDir = path.join(tempDir, 'cache-timeout-openspec');
      await createFakeOpenSpecPackage(pkgDir, '1.13.2');

      // config.js entra en bucle para exceder timeoutMs
      await fsp.writeFile(
        path.join(pkgDir, 'dist', 'core', 'config.js'),
        `const end = Date.now() + 10000; while(Date.now() < end) {} export const AI_TOOLS = [];`,
      );

      const repoPath = path.join(tempDir, 'repo-timeout');
      await fsp.mkdir(repoPath, { recursive: true });

      let spawnCount = 0;
      const customSpawn: typeof import('node:child_process').spawn = ((cmd: string, args: string[], opts: any) => {
        spawnCount++;
        const { spawn } = require('node:child_process');
        return spawn(cmd, args, opts);
      }) as any;

      const opts = {
        repoPath,
        executablePath: path.join(pkgDir, 'bin', 'openspec.js'),
        runtimeVersion: '1.13.2',
        nodeExecutable: process.execPath,
        timeoutMs: 150,
        deps: { spawn: customSpawn },
      };

      // Primera lectura -> produce timeout
      const report1 = await readEngineToolReport(opts);
      expect(report1.source).toBe('gitcron-fallback');
      expect(report1.fallbackReason).toBe('timeout');
      expect(spawnCount).toBe(1);

      // Segunda lectura -> no debe ser servida de caché; vuelve a lanzar el proceso
      const report2 = await readEngineToolReport(opts);
      expect(report2.source).toBe('gitcron-fallback');
      expect(report2.fallbackReason).toBe('timeout');
      expect(spawnCount).toBe(2);
    });
  });

  describe('3.1 Carpeta compartida anotada a su propio nombre (D2)', () => {
    it('odontoPro con OpenSpec 1.14: agents configurada, codex y amp presentes -> salen configuradas por shared-folder', () => {
      const mockRawEngineReport: OpenSpecToolReport = {
        source: 'engine',
        engineVersion: '1.14.0',
        tools: [
          { id: 'claude', label: 'Claude Code', available: true, configured: true, needsUpdate: false, generatedBy: '1.14.0' },
          { id: 'agents', label: 'Carpeta compartida .agents', available: true, configured: true, needsUpdate: false, generatedBy: '1.14.0' },
          { id: 'codex', label: 'Codex', skillsDir: '.agents', available: true, configured: false, needsUpdate: false, generatedBy: null },
          { id: 'amp', label: 'Amp', skillsDir: '.agents', available: true, configured: false, needsUpdate: false, generatedBy: null },
          { id: 'zed', label: 'Zed Agent', skillsDir: '.agents', available: false, configured: false, needsUpdate: false, generatedBy: null },
        ],
        profileSyncNeeded: [],
      };

      const report = annotateSharedFolderTools(mockRawEngineReport);
      const codex = report.tools.find((t) => t.id === 'codex');
      expect(codex?.configured).toBe(true);
      expect(codex?.configuredVia).toBe('shared-folder');
      expect(codex?.generatedBy).toBe('1.14.0');
      expect(codex?.needsUpdate).toBe(false);

      const amp = report.tools.find((t) => t.id === 'amp');
      expect(amp?.configured).toBe(true);
      expect(amp?.configuredVia).toBe('shared-folder');

      // Herramienta no presente (available: false) no pasa a configurada
      const zed = report.tools.find((t) => t.id === 'zed');
      expect(zed?.configured).toBe(false);
      expect(zed?.configuredVia).toBeUndefined();
    });

    it('sin instrucciones en .agents/skills no cuenta como configurada en el respaldo', async () => {
      const repoPath = path.join(tempDir, 'repo-empty-agents');
      await fsp.mkdir(path.join(repoPath, '.agents', 'skills'), { recursive: true });
      await fsp.writeFile(path.join(repoPath, '.agents', 'skills', '.openspec-target'), 'agents');
      // No se crean carpetas de skills de OpenSpec

      const report = buildFallbackToolReport({ repoPath });
      const codex = report.tools.find((t) => t.id === 'codex');
      expect(codex?.configured).toBe(false);
      expect(codex?.configuredVia).toBeUndefined();
      const agents = report.tools.find((t) => t.id === 'agents');
      expect(agents?.configured).toBe(false);
    });

    it('con la carpeta anotada a codex (.openspec-target = codex) rige lo anterior: codex configurada directa y otras no', async () => {
      const repoPath = path.join(tempDir, 'repo-target-codex');
      await fsp.mkdir(path.join(repoPath, '.agents', 'skills', 'openspec-propose'), { recursive: true });
      await fsp.writeFile(path.join(repoPath, '.agents', 'skills', '.openspec-target'), 'codex');
      // Marcador de presencia de amp
      await fsp.mkdir(path.join(repoPath, '.amp'), { recursive: true });

      const report = buildFallbackToolReport({ repoPath });
      const codex = report.tools.find((t) => t.id === 'codex');
      expect(codex?.configured).toBe(true);
      expect(codex?.configuredVia).toBeUndefined(); // directa, no por shared-folder

      const amp = report.tools.find((t) => t.id === 'amp');
      expect(amp?.available).toBe(true);
      expect(amp?.configured).toBe(false);
      expect(amp?.configuredVia).toBeUndefined();
    });

    it('el respaldo da el mismo resultado que el motor cuando .openspec-target = agents', async () => {
      const repoPath = path.join(tempDir, 'repo-fallback-agents');
      await fsp.mkdir(path.join(repoPath, '.agents', 'skills', 'openspec-propose'), { recursive: true });
      await fsp.writeFile(path.join(repoPath, '.agents', 'skills', '.openspec-target'), 'agents');
      // Presencia de codex y amp
      await fsp.mkdir(path.join(repoPath, '.codex'), { recursive: true });
      await fsp.mkdir(path.join(repoPath, '.amp'), { recursive: true });

      const report = buildFallbackToolReport({ repoPath });
      const codex = report.tools.find((t) => t.id === 'codex');
      expect(codex?.available).toBe(true);
      expect(codex?.configured).toBe(true);
      expect(codex?.configuredVia).toBe('shared-folder');

      const amp = report.tools.find((t) => t.id === 'amp');
      expect(amp?.available).toBe(true);
      expect(amp?.configured).toBe(true);
      expect(amp?.configuredVia).toBe('shared-folder');
    });

    // Sin marca, el respaldo deduce el dueño como el motor. Medido con OpenSpec 1.14.0 el
    // 2026-10-01 sobre un repositorio con las instrucciones de odontoPro y sin .openspec-target:
    // `getConfiguredTools` da ["agents"] con o sin carpeta .codex, y ["codex"] cuando las
    // instrucciones usan la sintaxis `$openspec-` de Codex.
    it('sin marca y sin sintaxis de Codex: dueño agents aunque exista .codex, y Codex por la carpeta compartida', async () => {
      const repoPath = path.join(tempDir, 'repo-sin-marca-agents');
      const skillDir = path.join(repoPath, '.agents', 'skills', 'openspec-propose');
      await fsp.mkdir(skillDir, { recursive: true });
      await fsp.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: openspec-propose\n---\nUsar con /opsx:propose\n');
      await fsp.mkdir(path.join(repoPath, '.codex'), { recursive: true });

      const report = buildFallbackToolReport({ repoPath });
      expect(report.tools.find((t) => t.id === 'agents')?.configured).toBe(true);
      const codex = report.tools.find((t) => t.id === 'codex');
      expect(codex?.available).toBe(true);
      expect(codex?.configured).toBe(true);
      expect(codex?.configuredVia).toBe('shared-folder');
    });

    it('sin marca y con sintaxis de Codex: dueño codex, configurada directa como dice el motor', async () => {
      const repoPath = path.join(tempDir, 'repo-sin-marca-codex');
      const skillDir = path.join(repoPath, '.agents', 'skills', 'openspec-propose');
      await fsp.mkdir(skillDir, { recursive: true });
      await fsp.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: openspec-propose\n---\nUsar con $openspec-propose\n');

      const report = buildFallbackToolReport({ repoPath });
      const codex = report.tools.find((t) => t.id === 'codex');
      expect(codex?.configured).toBe(true);
      expect(codex?.configuredVia).toBeUndefined();
    });
  });
});
