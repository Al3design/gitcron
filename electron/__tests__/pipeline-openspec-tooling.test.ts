import { describe, expect, it } from 'vitest';
import {
  isOpenSpecSkillEntry,
  OPENSPEC_TOOL_DIRECTORIES,
  resolveToolStates,
  type ToolPresence,
} from '../pipeline/openspec-tooling';

/**
 * Qué herramientas usa un repositorio y cuáles tienen OpenSpec configurado.
 *
 * El estado que esto existe para mostrar es «presente pero sin configurar»: la
 * herramienta se usa en el repositorio y su ejecutor no sabe que el canal de
 * instrucciones existe. Pasó con Antigravity en `odontoPau`.
 */

function presence(entries: Record<string, ToolPresence>): Map<string, ToolPresence> {
  return new Map(Object.entries(entries));
}

describe('herramientas con OpenSpec configurado', () => {
  it('lista sólo las herramientas presentes en el repositorio', () => {
    const result = resolveToolStates(presence({
      codex: { present: true, configured: true },
      claude: { present: false, configured: false },
    }));
    expect(result.map((tool) => tool.toolId)).toEqual(['codex']);
  });

  it('marca como no configurada la que está presente y no tiene skills', () => {
    // En OpenSpec 1.13, tanto Codex como Antigravity usan .agents como directorio de skills.
    const result = resolveToolStates(presence({
      codex: { present: true, configured: true },
      antigravity: { present: true, configured: false },
    }));
    expect(result).toEqual([
      { toolId: 'antigravity', label: 'Antigravity', directory: '.agents', configured: false },
      { toolId: 'codex', label: 'Codex', directory: '.agents', configured: true },
    ]);
  });

  it('una herramienta desconocida no se reporta como faltante', () => {
    // No reconocerla deja el panel como estaba; reportarla sería afirmar algo
    // que no se sabe.
    const result = resolveToolStates(presence({
      'una-herramienta-nueva': { present: true, configured: false },
    }));
    expect(result).toEqual([]);
  });

  it('sin ninguna herramienta presente no devuelve nada', () => {
    expect(resolveToolStates(presence({}))).toEqual([]);
  });

  it('reconoce una skill de OpenSpec por su prefijo', () => {
    expect(isOpenSpecSkillEntry('openspec-propose')).toBe(true);
    expect(isOpenSpecSkillEntry('openspec-archive-change')).toBe(true);
    // Una skill del usuario en el mismo directorio no cuenta como configuración.
    expect(isOpenSpecSkillEntry('mi-skill-propia')).toBe(false);
    expect(isOpenSpecSkillEntry('')).toBe(false);
  });

  it('cada herramienta conocida tiene identificador único y no incluye github', () => {
    const ids = OPENSPEC_TOOL_DIRECTORIES.map((tool) => tool.toolId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('github');
    expect(ids.length).toBe(50);
  });
});
