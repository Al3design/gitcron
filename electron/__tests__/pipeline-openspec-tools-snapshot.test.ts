import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPENSPEC_CYCLE_TARGET_VERSION, parseSemver } from '../../lib/openspec-version';
import { mergeToolVersionMetadata } from '../../scripts/capturar-herramientas-openspec.mjs';

export function verifySnapshotVersionCompatibility(
  snapshotVersion: string,
  targetVersion: string = OPENSPEC_CYCLE_TARGET_VERSION,
): { valid: boolean; error?: string } {
  const snapSemver = parseSemver(snapshotVersion);
  const targetSemver = parseSemver(targetVersion);

  if (!snapSemver || !targetSemver) {
    return {
      valid: false,
      error: `Versión semver inválida: snapshot=${snapshotVersion}, target=${targetVersion}`,
    };
  }

  const isSameMajorMinor =
    snapSemver.major === targetSemver.major && snapSemver.minor === targetSemver.minor;

  if (!isSameMajorMinor) {
    return {
      valid: false,
      error: `La copia propia de herramientas (${snapshotVersion}) está desfasada respecto a la versión del ciclo SDD (${targetVersion}). Ejecutá "node scripts/capturar-herramientas-openspec.mjs" para actualizarla.`,
    };
  }

  return { valid: true };
}

describe('openspec-tools-snapshot (2.1)', () => {
  const snapshotPath = path.resolve(__dirname, '../pipeline/openspec-tools-snapshot.json');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));

  it('la versión del JSON coincide en mayor.menor con OPENSPEC_CYCLE_TARGET_VERSION (1.14)', () => {
    const check = verifySnapshotVersionCompatibility(snapshot.version, OPENSPEC_CYCLE_TARGET_VERSION);
    if (!check.valid) {
      throw new Error(check.error);
    }
    expect(check.valid).toBe(true);
  });

  it('falla con mensaje descriptivo y comando de captura si se simula un ciclo 1.15', () => {
    const check = verifySnapshotVersionCompatibility(snapshot.version, '1.15.0');
    expect(check.valid).toBe(false);
    expect(check.error).toContain('desfasada respecto a la versión del ciclo SDD (1.15.0)');
    expect(check.error).toContain('node scripts/capturar-herramientas-openspec.mjs');
  });

  it('el JSON contiene la estructura esperada: 50 herramientas, amp desde 1.14.0, codex desde 1.0.0 o antes, bob «IBM Bob»', () => {
    expect(snapshot.tools).toHaveLength(50);
    expect(snapshot.skillNames).toHaveLength(12);

    const amp = snapshot.tools.find((t: { id: string }) => t.id === 'amp');
    expect(amp).toBeDefined();
    expect(amp.addedIn).toBe('1.14.0');

    const codex = snapshot.tools.find((t: { id: string }) => t.id === 'codex');
    expect(codex).toBeDefined();
    expect(codex.skillsDir).toBe('.agents');
    expect(codex.legacySkillsDirs).toContain('.codex');
    expect(codex.addedIn).toBe('1.0.0');
    expect(codex.addedInOrEarlier).toBe(true);

    const bob = snapshot.tools.find((t: { id: string }) => t.id === 'bob');
    expect(bob).toBeDefined();
    expect(bob.label).toBe('IBM Bob');

    const github = snapshot.tools.find((t: { id: string }) => t.id === 'github');
    expect(github).toBeUndefined();
  });

  it('mergeToolVersionMetadata conserva addedIn de la lista anterior y marca las nuevas con la versión capturada', () => {
    const previousSnapshot = {
      version: '1.13.2',
      tools: [
        { id: 'tool-a', label: 'Tool A', addedIn: '1.3.0' },
        { id: 'tool-b', label: 'Tool B', addedIn: '1.0.0', addedInOrEarlier: true },
      ],
      skillNames: [],
    };
    const incomingTools = [
      { id: 'tool-a', label: 'Tool A' },
      { id: 'tool-b', label: 'Tool B' },
      { id: 'tool-new', label: 'Tool New' },
    ];
    const initialMeasurements = {
      desde: {
        'tool-a': '1.3.0',
        'tool-b': '1.0.0',
      },
    };

    const merged = mergeToolVersionMetadata(incomingTools, previousSnapshot, initialMeasurements, '1.14.0');
    expect(merged).toHaveLength(3);

    const a = merged.find((t: { id: string }) => t.id === 'tool-a');
    expect(a?.addedIn).toBe('1.3.0');
    expect(a?.addedInOrEarlier).toBeUndefined();

    const b = merged.find((t: { id: string }) => t.id === 'tool-b');
    expect(b?.addedIn).toBe('1.0.0');
    expect(b?.addedInOrEarlier).toBe(true);

    const newTool = merged.find((t: { id: string }) => t.id === 'tool-new');
    expect(newTool?.addedIn).toBe('1.14.0');
    expect(newTool?.addedInOrEarlier).toBeUndefined();
  });
});
