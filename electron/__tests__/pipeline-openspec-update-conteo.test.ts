import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  captureOpenSpecManagedFilesSnapshot,
  computeUpdatedManagedFiles,
  diffOpenSpecSnapshots,
} from '../pipeline/openspec-cli';
import { withRepoLock } from '../git/repo-queue';

describe('Conteo de una actualización comparando antes y después (D3 / Tarea 4.1)', () => {
  let tempDir: string;
  let git: SimpleGit;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitcron-update-conteo-'));
    git = simpleGit(tempDir);
    await git.init(['--initial-branch=main']);
    await git.addConfig('user.name', 'GitCron Test');
    await git.addConfig('user.email', 'test@gitcronos.local');
    await git.addConfig('commit.gpgsign', 'false');

    // Estado inicial en HEAD
    await fs.mkdir(path.join(tempDir, 'openspec', 'changes', 'mi-cambio'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'openspec', 'config.yaml'), 'schema: spec-driven\nversion: 1.0\n');
    await fs.writeFile(path.join(tempDir, 'openspec', 'changes', 'mi-cambio', 'tasks.md'), '- [ ] Tarea inicial\n');

    const proposeDir = path.join(tempDir, '.agents', 'skills', 'openspec-propose');
    await fs.mkdir(proposeDir, { recursive: true });
    await fs.writeFile(path.join(proposeDir, 'SKILL.md'), '---\ngeneratedBy: "1.13.0"\n---\nContenido original en HEAD\n');

    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), '// código ajeno\n');

    await git.add(['.']);
    await git.commit('Commit inicial base');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('una carpeta nueva con tres archivos cuenta tres', async () => {
    // Foto previa: árbol limpio
    const before = await withRepoLock(tempDir, () => captureOpenSpecManagedFilesSnapshot(tempDir, git));
    expect(before.size).toBe(0);

    // Se crea una carpeta nueva con tres archivos administrados por OpenSpec
    const exploreDir = path.join(tempDir, '.agents', 'skills', 'openspec-explore');
    await fs.mkdir(exploreDir, { recursive: true });
    await fs.writeFile(path.join(exploreDir, 'SKILL.md'), 'skill');
    await fs.writeFile(path.join(exploreDir, 'rules.md'), 'rules');
    await fs.writeFile(path.join(exploreDir, 'context.md'), 'context');

    // Foto posterior
    const updated = await computeUpdatedManagedFiles(tempDir, before);

    expect(updated).toHaveLength(3);
    expect(updated).toEqual([
      '.agents/skills/openspec-explore/SKILL.md',
      '.agents/skills/openspec-explore/context.md',
      '.agents/skills/openspec-explore/rules.md',
    ]);
  });

  it('un tasks.md modificado antes y no tocado por la actualización no cuenta', async () => {
    // 1. Modificación previa: la persona ya tenía tasks.md sucio
    const tasksPath = path.join(tempDir, 'openspec', 'changes', 'mi-cambio', 'tasks.md');
    await fs.writeFile(tasksPath, '- [x] Tarea marcada por la persona\n');

    // Foto previa: registra tasks.md sucio
    const before = await withRepoLock(tempDir, () => captureOpenSpecManagedFilesSnapshot(tempDir, git));
    expect(before.has('openspec/changes/mi-cambio/tasks.md')).toBe(true);

    // 2. La actualización crea/modifica otro archivo y NO toca tasks.md
    const newSkillDir = path.join(tempDir, '.agents', 'skills', 'openspec-apply-change');
    await fs.mkdir(newSkillDir, { recursive: true });
    await fs.writeFile(path.join(newSkillDir, 'SKILL.md'), 'nuevo skill');

    // Foto posterior
    const updated = await computeUpdatedManagedFiles(tempDir, before);

    // tasks.md no cambió de hash, por ende no se cuenta
    expect(updated).toEqual(['.agents/skills/openspec-apply-change/SKILL.md']);
    expect(updated).not.toContain('openspec/changes/mi-cambio/tasks.md');
  });

  it('un archivo administrado ya modificado y reescrito con otro contenido cuenta', async () => {
    const configPath = path.join(tempDir, 'openspec', 'config.yaml');
    // Ya estaba modificado antes de la actualización
    await fs.writeFile(configPath, 'schema: spec-driven\n# modificado previo\n');

    // Foto previa
    const before = await withRepoLock(tempDir, () => captureOpenSpecManagedFilesSnapshot(tempDir, git));
    expect(before.has('openspec/config.yaml')).toBe(true);

    // La actualización lo reescribe con otro contenido
    await fs.writeFile(configPath, 'schema: spec-driven\nversion: 1.14.0\n# reescrito por update\n');

    // Foto posterior
    const updated = await computeUpdatedManagedFiles(tempDir, before);

    expect(updated).toContain('openspec/config.yaml');
  });

  it('un archivo devuelto a HEAD cuenta como cambiado', async () => {
    const skillPath = path.join(tempDir, '.agents', 'skills', 'openspec-propose', 'SKILL.md');
    // Modificado previo a la actualización
    await fs.writeFile(skillPath, 'contenido sucio que no coincide con HEAD');

    // Foto previa: está presente porque difiere de HEAD
    const before = await withRepoLock(tempDir, () => captureOpenSpecManagedFilesSnapshot(tempDir, git));
    expect(before.has('.agents/skills/openspec-propose/SKILL.md')).toBe(true);

    // La actualización restaura el contenido idéntico a HEAD
    await fs.writeFile(skillPath, '---\ngeneratedBy: "1.13.0"\n---\nContenido original en HEAD\n');

    // Foto posterior: Git ya no lo lista en git status porque está limpio respecto a HEAD
    const updated = await computeUpdatedManagedFiles(tempDir, before);

    expect(updated).toContain('.agents/skills/openspec-propose/SKILL.md');
  });

  it('archivos ajenos a OpenSpec no se cuentan en las fotos ni en el resumen', async () => {
    const before = await withRepoLock(tempDir, () => captureOpenSpecManagedFilesSnapshot(tempDir, git));

    // Modificar un archivo de código de la app (no administrado por OpenSpec)
    await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), '// cambio en src\n');
    await fs.writeFile(path.join(tempDir, 'package.json'), '{"name": "app"}\n');

    const updated = await computeUpdatedManagedFiles(tempDir, before);
    expect(updated).toEqual([]);
  });
});
