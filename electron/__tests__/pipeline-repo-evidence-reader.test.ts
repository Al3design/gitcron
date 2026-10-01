import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultListOpenSpecChanges,
  getRealGitInfo,
  readOpenSpecTooling,
  RepoEvidenceReader,
} from '../pipeline/repo-evidence-reader';

describe('RepoEvidenceReader', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitcron-evidence-reader-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('degrades a repo without the method kit while preserving a snapshot', async () => {
    const reader = new RepoEvidenceReader({
      listOpenSpecChanges: async () => { throw new Error('missing'); },
      currentBranch: async () => 'main',
      mergedChanges: async () => [],
      now: () => '2026-07-23T20:00:00.000Z',
    });
    const snapshot = await reader.read(root, 'repo-1');
    expect(snapshot.evidence).toMatchObject({ repoId: 'repo-1', activeChanges: [], tasks: [] });
    expect(snapshot.evidence.diagnostics.map((item) => item.code)).toContain('openspec.unavailable');
    expect(snapshot.selection).toMatchObject({ changeId: null, selectionRequired: false });
  });

  // Regresión: esto salía por `execFile('openspec', ...)`, que en Windows no
  // resuelve `openspec.cmd` (ENOENT), y con la extensión Node lo rechaza por la
  // mitigación de CVE-2024-27980 (EINVAL). El lector caía en su `catch` y
  // reportaba cero cambios activos aunque el scaffold existiera.
  it('lists active changes from the scaffold without spawning the OpenSpec CLI', async () => {
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-a'), { recursive: true });
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-b'), { recursive: true });
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'archive', '2026-07-23-old-change'), { recursive: true });

    const active = await defaultListOpenSpecChanges(root);

    expect(active).toEqual(['feature-a', 'feature-b']);
    // `archive` es el contenedor de los cerrados, no un cambio activo.
    expect(active).not.toContain('archive');
  });

  it('reports no active changes when the scaffold is absent', async () => {
    expect(await defaultListOpenSpecChanges(root)).toEqual([]);
  });

  describe('marcas de creación y archivado', () => {
    async function readWith(history: {
      created?: Record<string, string>;
      archived?: Record<string, string>;
    }, onDisk: string | null = null) {
      await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-a'), { recursive: true });
      await fs.mkdir(path.join(root, 'openspec', 'changes', 'archive', '2026-07-23-old-change'), { recursive: true });
      const reader = new RepoEvidenceReader({
        listOpenSpecChanges: async () => ['feature-a'],
        currentBranch: async () => 'main',
        mergedChanges: async () => [],
        changeHistory: async () => ({
          created: new Map(Object.entries(history.created ?? {})),
          archived: new Map(Object.entries(history.archived ?? {})),
        }),
        changeDirCreatedAt: async () => onDisk,
        now: () => '2026-08-06T20:00:00.000Z',
      });
      return reader.read(root, 'repo-1');
    }

    it('un cambio confirmado toma la marca del commit', async () => {
      const snapshot = await readWith({ created: { 'feature-a': '2026-08-01T10:00:00-03:00' } }, '2026-01-01T00:00:00.000Z');
      expect(snapshot.evidence.openSpecChanges?.[0].createdAt)
        .toEqual({ at: '2026-08-01T10:00:00-03:00', source: 'commit' });
    });

    it('un cambio sin ningún commit cae al disco, declarado como tal', async () => {
      // Un cambio recién creado no está confirmado, y es justo cuando la marca
      // más sirve. Va rotulada para que no se lea como una fecha de Git.
      const snapshot = await readWith({}, '2026-08-06T14:51:34.000Z');
      expect(snapshot.evidence.openSpecChanges?.[0].createdAt)
        .toEqual({ at: '2026-08-06T14:51:34.000Z', source: 'disk' });
    });

    it('sin Git y sin disco la marca queda nula, no inventada', async () => {
      const snapshot = await readWith({}, null);
      expect(snapshot.evidence.openSpecChanges?.[0].createdAt).toBeNull();
    });

    it('un archivado conserva su creación y suma la hora de archivado', async () => {
      const snapshot = await readWith({
        created: { 'old-change': '2026-07-20T09:00:00-03:00' },
        archived: { 'old-change': '2026-07-23T18:30:00-03:00' },
      });
      const archived = snapshot.evidence.openSpecArchivedChanges?.[0];
      expect(archived?.createdAt).toEqual({ at: '2026-07-20T09:00:00-03:00', source: 'commit' });
      expect(archived?.archivedOn).toEqual({ at: '2026-07-23T18:30:00-03:00', source: 'commit' });
      // El día del nombre de la carpeta se conserva: es lo que ordena la lista.
      expect(archived?.archivedAt).toBe('2026-07-23');
    });

    it('un fallo leyendo la historia no rompe el snapshot', async () => {
      await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-a'), { recursive: true });
      const reader = new RepoEvidenceReader({
        listOpenSpecChanges: async () => ['feature-a'],
        currentBranch: async () => 'main',
        mergedChanges: async () => [],
        changeHistory: async () => { throw new Error('sin historia'); },
        changeDirCreatedAt: async () => null,
        now: () => '2026-08-06T20:00:00.000Z',
      });
      const snapshot = await reader.read(root, 'repo-1');
      expect(snapshot.evidence.openSpecChanges?.[0].changeId).toBe('feature-a');
      expect(snapshot.evidence.diagnostics.map((item) => item.code)).toContain('git.change-history-unavailable');
    });
  });

  describe('estado de OpenSpec en el repositorio', () => {
    /**
     * Sin `openspec/` y con OpenSpec vacío se ven igual en los contadores
     * —cuatro ceros— y piden respuestas distintas: uno se resuelve creando un
     * cambio y el otro no se puede resolver desde el panel sin inicializar. El
     * lector los distingue para que la vista no tenga que deducirlo.
     */
    function readerFor(root: string) {
      return new RepoEvidenceReader({
        listOpenSpecChanges: async () => [],
        currentBranch: async () => 'main',
        mergedChanges: async () => [],
        now: () => '2026-08-07T20:00:00.000Z',
      }).read(root, 'repo-1');
    }

    it('un repositorio sin openspec/ queda distinguible', async () => {
      const snapshot = await readerFor(root);
      expect(snapshot.evidence.openSpecPresent).toBe(false);
      expect(snapshot.evidence.openSpecTools).toEqual([]);
    });

    it('con openspec/ lo declara presente', async () => {
      await fs.mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });
      const snapshot = await readerFor(root);
      expect(snapshot.evidence.openSpecPresent).toBe(true);
    });

    it('una herramienta presente sin skills queda sin configurar', async () => {
      // El caso de `odontoPau`: `.codex` con skills y `.agent` sin ninguna, en un
      // repositorio por lo demás correctamente inicializado.
      await fs.mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });
      await fs.mkdir(path.join(root, '.codex', 'skills', 'openspec-propose'), { recursive: true });
      await fs.mkdir(path.join(root, '.agent', 'workflows'), { recursive: true });
      const snapshot = await readerFor(root);
      expect(snapshot.evidence.openSpecTools).toEqual([
        { toolId: 'antigravity', label: 'Antigravity', directory: '.agents', configured: false },
        { toolId: 'codex', label: 'Codex', directory: '.agents', configured: true },
      ]);
    });

    it('6.10: estado OdontoPau - Codex servido desde .agents/skills con marca .openspec-target da configurada, .github informativa', async () => {
      await fs.mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });

      // .agents con skills y marca codex
      const agentsSkillsDir = path.join(root, '.agents', 'skills');
      await fs.mkdir(path.join(agentsSkillsDir, 'openspec-apply-change'), { recursive: true });
      await fs.writeFile(path.join(agentsSkillsDir, 'openspec-apply-change', 'SKILL.md'), '---\ngeneratedBy: "1.13.2"\n---\n');
      await fs.writeFile(path.join(agentsSkillsDir, '.openspec-target'), 'codex\n');

      // .codex con config.toml y carpeta skills vacía
      await fs.mkdir(path.join(root, '.codex', 'skills'), { recursive: true });
      await fs.writeFile(path.join(root, '.codex', 'config.toml'), '# codex config\n');

      // .github con workflow de CI
      await fs.mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
      await fs.writeFile(path.join(root, '.github', 'workflows', 'quality-gates.yml'), 'name: CI\n');

      const tooling = await readOpenSpecTooling(root);
      expect(tooling.present).toBe(true);

      const codexTool = tooling.tools.find((t) => t.toolId === 'codex');
      const agentsTool = tooling.tools.find((t) => t.toolId === 'agents');
      const githubTool = tooling.tools.find((t) => t.toolId === 'github');

      // Codex está configurada gracias a la marca en .agents/skills/.openspec-target
      expect(codexTool).toEqual({ toolId: 'codex', label: 'Codex', directory: '.agents', configured: true });
      // En OdontoPau, AGENTES muestra sólo Codex configurada
      expect(agentsTool).toBeUndefined();
      // GitHub ya no pertenece al registro de herramientas de OpenSpec (1.3)
      expect(githubTool).toBeUndefined();

      const snapshot = await readerFor(root);
      expect(snapshot.evidence.openSpecTools).toEqual(tooling.tools);

      // Si se retira la marca .openspec-target, la carpeta compartida queda a nombre de
      // `agents` y Codex, que la lee, figura configurada por ella. Antes de OpenSpec 1.14
      // esta prueba esperaba Codex sin configurar; medido con 1.14.0 el 2026-10-01, sin
      // marca y sin la sintaxis `$openspec-` el motor da configurada a `agents`
      // (actualizar-ciclo-openspec-1-14, D2).
      await fs.unlink(path.join(agentsSkillsDir, '.openspec-target'));
      const toolingWithoutTarget = await readOpenSpecTooling(root);
      const codexWithoutTarget = toolingWithoutTarget.tools.find((t) => t.toolId === 'codex');
      expect(codexWithoutTarget?.configured).toBe(true);
      expect(codexWithoutTarget?.configuredVia).toBe('shared-folder');
    });
  });

  it('reads tasks, reports and archives for one selected change', async () => {
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-a'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-a', 'tasks.md'), '- [x] done\n- [ ] open\n');
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-a', 'proposal.md'), '## Why\n\nShip one grounded workflow.\n\n## What Changes\n\n- UI\n');
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-a', 'design.md'), '## Context\n\nDesign.\n');
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-a', 'specs', 'feature-a'), { recursive: true });
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'archive', '2026-07-23-old-change'), { recursive: true });
    await fs.mkdir(path.join(root, 'openspec', 'specs', 'feature-a'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'specs', 'feature-a', 'spec.md'), '### Requirement: First\n\n### Requirement: Second\n');
    await fs.mkdir(path.join(root, 'docs', 'reports'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'reports', 'report.md'), '# report');
    await fs.writeFile(path.join(root, 'docs', 'reports', 'audit.md'), '## Veredicto: RECHAZADO\n\n- Hallazgo concreto\n');
    const reader = new RepoEvidenceReader({
      listOpenSpecChanges: async () => ['feature-a'],
      currentBranch: async () => 'feature/feature-a',
      mergedChanges: async (_repoPath, candidates) => candidates.filter((candidate) => candidate === 'old-change'),
      validateOpenSpecChange: async () => 'passed',
      now: () => '2026-07-23T20:00:00.000Z',
    });
    const snapshot = await reader.read(root, 'repo-1');
    expect(snapshot.selection).toMatchObject({ changeId: 'feature-a', confidence: 'confirmed' });
    expect(snapshot.evidence.tasks).toHaveLength(2);
    expect(snapshot.evidence.reports).toEqual(['docs/reports/audit.md', 'docs/reports/report.md']);
    expect(snapshot.evidence.decisions).toMatchObject([{ kind: 'audit-rejected', risk: 'unknown', evidenceRefs: ['docs/reports/audit.md'] }]);
    expect(snapshot.evidence.archivedChanges).toEqual(['old-change']);
    expect(snapshot.evidence.mergedChanges).toEqual(['old-change']);
    expect(snapshot.evidence.openSpecChanges).toMatchObject([{
      changeId: 'feature-a',
      intent: 'Ship one grounded workflow.',
      proposalExists: true,
      designExists: true,
      specsCount: 1,
      validation: 'passed',
    }]);
    expect(snapshot.evidence.openSpecArchivedChanges).toEqual([{
      changeId: 'old-change',
      archivedAt: '2026-07-23',
      sourceRef: 'openspec/changes/archive/2026-07-23-old-change',
      // Sin dependencia de historia no hay marcas, y quedan nulas en vez de
      // ausentes: no saber cuándo pasó algo es un dato, no un hueco.
      createdAt: null,
      archivedOn: null,
    }]);
    expect(snapshot.evidence.openSpecSpecifications).toEqual([{
      specificationId: 'feature-a',
      requirements: 2,
      sourceRef: 'openspec/specs/feature-a/spec.md',
    }]);
  });

  it('does not choose among multiple unmatched active changes', async () => {
    const reader = new RepoEvidenceReader({
      listOpenSpecChanges: async () => ['one', 'two'],
      currentBranch: async () => 'main',
      mergedChanges: async () => [],
      now: () => '2026-07-23T20:00:00.000Z',
    });
    const snapshot = await reader.read(root, 'repo-1');
    expect(snapshot.selection).toMatchObject({ changeId: null, selectionRequired: true });
    expect(snapshot.evidence.tasks).toEqual([]);
  });

  // Escenario declarado en la spec: un repositorio puede conservar los registros
  // del kit retirado en disco, y Pipeline debe ignorarlos por completo.
  it('ignores leftover kit logs still present on disk', async () => {
    await fs.mkdir(path.join(root, 'docs', 'ai', 'logs'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'ai', 'logs', 'gates.jsonl'), '{"ts":"1","mode":"fast","result":"ROJO"}\n');
    const reader = new RepoEvidenceReader({
      listOpenSpecChanges: async () => [], currentBranch: async () => 'main', mergedChanges: async () => [],
      now: () => '2026-07-23T20:00:00.000Z',
    });
    const snapshot = await reader.read(root, 'repo-1');
    expect(snapshot.evidence).not.toHaveProperty('gates');
    expect(snapshot.evidence).not.toHaveProperty('delegations');
    expect(snapshot.evidence).not.toHaveProperty('visualDiffs');
  });

  it('honors a manual selection over the automatic branch match', async () => {
    // Dos changes activos en `main`: la selección automática es null (la rama
    // no coincide con ninguno y hay varios). Con selección manual, ése es el
    // que transporta contenido.
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-a'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-a', 'tasks.md'), '- [ ] one\n');
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-a', 'proposal.md'), '## Why\n\nA\n');
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-b'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-b', 'tasks.md'), '- [ ] two\n');
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-b', 'proposal.md'), '## Why\n\nB\n');

    const reader = new RepoEvidenceReader({
      listOpenSpecChanges: async () => ['feature-a', 'feature-b'],
      currentBranch: async () => 'main',
      mergedChanges: async () => [],
      validateOpenSpecChange: async () => 'unknown',
      now: () => '2026-07-23T20:00:00.000Z',
    });

    // Sin selección manual: ningún change transporta contenido (ambos null).
    const automatic = await reader.read(root, 'repo-1');
    expect(automatic.selection.changeId).toBeNull();

    // Con selección manual de feature-b: ése transporta su contenido, el otro no.
    const manual = await reader.read(root, 'repo-1', 'feature-b');
    expect(manual.selection).toMatchObject({ changeId: 'feature-b', confidence: 'confirmed', reason: 'manual' });
    const changes = manual.evidence.openSpecChanges ?? [];
    const b = changes.find((c) => c.changeId === 'feature-b');
    const a = changes.find((c) => c.changeId === 'feature-a');
    expect(b?.artifacts?.proposal).toBe('## Why\n\nB\n');
    // El change no seleccionado no transporta contenido (artifacts ausente).
    expect(a?.artifacts?.proposal ?? null).toBeNull();

    // Un selectedChangeId que no está entre los activos se ignora (fallback).
    const ignored = await reader.read(root, 'repo-1', 'does-not-exist');
    expect(ignored.selection.changeId).toBeNull();
  });

  it('todos los changes transportan schemaName y skipSpecs desde .openspec.yaml sin ejecutar status para los no seleccionados', async () => {
    await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-a'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-a', '.openspec.yaml'), 'schema: spec-driven\nskip_specs: true\n');

    await fs.mkdir(path.join(root, 'openspec', 'changes', 'feature-b'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'changes', 'feature-b', '.openspec.yaml'), 'schema: custom-schema\nskip_specs: false\n');

    const statusOpenSpecChange = vi.fn();

    const reader = new RepoEvidenceReader({
      listOpenSpecChanges: async () => ['feature-a', 'feature-b'],
      currentBranch: async () => 'main',
      mergedChanges: async () => [],
      statusOpenSpecChange,
      now: () => '2026-07-23T20:00:00.000Z',
    });

    const snapshot = await reader.read(root, 'repo-1', 'feature-a');
    const changes = snapshot.evidence.openSpecChanges ?? [];

    const a = changes.find((c) => c.changeId === 'feature-a');
    const b = changes.find((c) => c.changeId === 'feature-b');

    expect(a?.schemaName).toBe('spec-driven');
    expect(a?.skipSpecs).toBe(true);

    expect(b?.schemaName).toBe('custom-schema');
    expect(b?.skipSpecs).toBe(false);

    // statusOpenSpecChange se invocó únicamente para el seleccionado (feature-a)
    expect(statusOpenSpecChange).toHaveBeenCalledTimes(1);
    expect(statusOpenSpecChange).toHaveBeenCalledWith(root, 'feature-a');
  });
});

describe('getRealGitInfo (Content-Sensitive Fingerprint & Repo Lock)', () => {
  it('genera huellas diferentes para dos archivos con mismo tamaño y mtime pero distinto contenido', async () => {
    const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'gitcron-fingerprint-test-'));
    try {
      const { simpleGit } = await import('simple-git');
      const git = simpleGit(tempRepo);
      await git.init();

      // Crear archivo A (tamaño 5 bytes)
      const testFile = path.join(tempRepo, 'file.txt');
      await fs.writeFile(testFile, 'AAAAA');
      const fixedTime = new Date('2026-08-13T12:00:00Z');
      const { utimesSync } = await import('node:fs');
      utimesSync(testFile, fixedTime, fixedTime);

      const info1 = await getRealGitInfo(tempRepo);
      expect(info1.workingTreeFingerprint).not.toBe('unknown:error');

      // Modificar archivo con contenido distinto pero MISMO TAMAÑO (5 bytes) y restaurar mtime
      await fs.writeFile(testFile, 'BBBBB');
      utimesSync(testFile, fixedTime, fixedTime);

      const info2 = await getRealGitInfo(tempRepo);
      expect(info2.workingTreeFingerprint).not.toBe('unknown:error');

      // El fingerprint sensible al contenido DEBE ser distinto a pesar de igual tamaño y timestamp
      expect(info1.workingTreeFingerprint).not.toBe(info2.workingTreeFingerprint);
    } finally {
      await fs.rm(tempRepo, { recursive: true, force: true });
    }
  });
});
