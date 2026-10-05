import { describe, expect, it } from 'vitest';
import type { RuntimeDiscoveryEntry } from '@/types/pipeline';
import { resolveIntentCapability } from '../pipeline-intent-capabilities';

function entry(overrides: Partial<RuntimeDiscoveryEntry> = {}): RuntimeDiscoveryEntry {
  return {
    runtime: 'claude',
    adapterId: 'adapter-claude',
    installed: true,
    runtimeVersion: '1.0.0',
    launchable: true,
    evidenceStatus: 'verified',
    startAvailability: 'available',
    startConstraints: [],
    startModifiesRepo: true,
    startRunsCommands: true,
    diagnostics: [],
    ...overrides,
  };
}

describe('resolveIntentCapability (mismas capacidades para toda IA lanzable)', () => {
  describe('caso 1: lectura (explore)', () => {
    it('Claude está disponible para explorar', () => {
      const res = resolveIntentCapability('explore', entry({ runtime: 'claude' }));
      expect(res.status).toBe('available');
      expect(res.canLaunch).toBe(true);
      expect(res.alternativeRuntime).toBeNull();
    });

    it('Codex está disponible para explorar', () => {
      const res = resolveIntentCapability('explore', entry({ runtime: 'codex' }));
      expect(res.status).toBe('available');
      expect(res.canLaunch).toBe(true);
      expect(res.alternativeRuntime).toBeNull();
    });
  });

  describe('caso 2: escritura de artefactos (write-artifact)', () => {
    it('Claude está disponible para escribir propuestas y artefactos', () => {
      const res = resolveIntentCapability(
        'write-artifact',
        entry({ runtime: 'claude', startModifiesRepo: true }),
      );
      expect(res.status).toBe('available');
      expect(res.canLaunch).toBe(true);
      expect(res.alternativeRuntime).toBeNull();
    });

    it('Codex con workspace-write está disponible para escribir propuestas sin alternativa forzada', () => {
      const res = resolveIntentCapability(
        'write-artifact',
        entry({ runtime: 'codex', startModifiesRepo: true }),
      );
      expect(res.status).toBe('available');
      expect(res.canLaunch).toBe(true);
      expect(res.alternativeRuntime).toBeNull();
    });

    it('un runtime que no modifica el repositorio no está disponible para escribir', () => {
      const res = resolveIntentCapability(
        'write-artifact',
        entry({ startModifiesRepo: false }),
      );
      expect(res.status).toBe('unavailable');
      expect(res.canLaunch).toBe(false);
      expect(res.reasonKey).toBe('pipeline.launcher.intent.unavailableWrite');
    });
  });

  describe('caso 3: implementación de tareas (implement-task)', () => {
    it('Claude con Bash está disponible para implementar tareas y correr pruebas', () => {
      const res = resolveIntentCapability(
        'implement-task',
        entry({ runtime: 'claude', startModifiesRepo: true, startRunsCommands: true }),
      );
      expect(res.status).toBe('available');
      expect(res.canLaunch).toBe(true);
      expect(res.alternativeRuntime).toBeNull();
    });

    it('Codex con workspace-write está disponible para implementar tareas y correr comandos', () => {
      const res = resolveIntentCapability(
        'implement-task',
        entry({ runtime: 'codex', startModifiesRepo: true, startRunsCommands: true }),
      );
      expect(res.status).toBe('available');
      expect(res.canLaunch).toBe(true);
      expect(res.alternativeRuntime).toBeNull();
    });

    it('un runtime que modifica archivos pero no corre comandos no está disponible para implementar tareas', () => {
      const res = resolveIntentCapability(
        'implement-task',
        entry({ startModifiesRepo: true, startRunsCommands: false }),
      );
      expect(res.status).toBe('unavailable');
      expect(res.canLaunch).toBe(false);
      expect(res.reasonKey).toBe('pipeline.launcher.intent.unavailableCommands');
    });

    it('un runtime que no modifica archivos no puede implementar tareas', () => {
      const res = resolveIntentCapability(
        'implement-task',
        entry({ startModifiesRepo: false, startRunsCommands: true }),
      );
      expect(res.status).toBe('unavailable');
      expect(res.canLaunch).toBe(false);
      expect(res.reasonKey).toBe('pipeline.launcher.intent.unavailableWrite');
    });
  });

  describe('caso 4: reanudar sesión (resume)', () => {
    it('está sin comprobar con cualquier runtime hasta contar con pruebas', () => {
      const resClaude = resolveIntentCapability('resume', entry({ runtime: 'claude' }));
      expect(resClaude.status).toBe('unverified');
      expect(resClaude.canLaunch).toBe(false);
      expect(resClaude.reasonKey).toBe('pipeline.launcher.intent.resumeUnavailable');

      const resCodex = resolveIntentCapability('resume', entry({ runtime: 'codex' }));
      expect(resCodex.status).toBe('unverified');
      expect(resCodex.canLaunch).toBe(false);
      expect(resCodex.reasonKey).toBe('pipeline.launcher.intent.resumeUnavailable');
    });
  });

  describe('caso 5: OpenCode (sin comprobar, no bloquear por falta de fixture)', () => {
    it('devuelve «sin comprobar» y permite arrancar sin bloquear por pertenecer a pending_fixture', () => {
      const openCodeEntry = entry({
        runtime: 'opencode',
        launchable: true,
        evidenceStatus: 'pending_fixture',
        startModifiesRepo: true,
        startRunsCommands: true,
      });

      for (const intent of ['explore', 'write-artifact', 'implement-task'] as const) {
        const res = resolveIntentCapability(intent, openCodeEntry);
        expect(res.status).toBe('unverified');
        expect(res.canLaunch).toBe(true);
        expect(res.reasonKey).toBe('pipeline.launcher.intent.unverified');
        expect(res.reason).toContain('Capacidad sin comprobar');
      }
    });
  });

  describe('caso 6: runtime no lanzable o entrada nula', () => {
    it('devuelve unavailable si launchable es false (p. ej. agy)', () => {
      const res = resolveIntentCapability(
        'explore',
        entry({ runtime: 'agy', launchable: false, diagnostics: ['agy es solo un wrapper'] }),
      );
      expect(res.status).toBe('unavailable');
      expect(res.canLaunch).toBe(false);
      expect(res.reason).toBe('agy es solo un wrapper');
    });

    it('devuelve unavailable si no hay entrada seleccionada', () => {
      const res = resolveIntentCapability('write-artifact', null);
      expect(res.status).toBe('unavailable');
      expect(res.canLaunch).toBe(false);
    });
  });

  describe('caso 7: Antigravity (explorar y escribir sí, implementar con pruebas no)', () => {
    const agyEntry = entry({
      runtime: 'agy',
      launchable: true,
      startModifiesRepo: true,
      startRunsCommands: false,
      evidenceStatus: 'verified',
    });

    it('está disponible para explorar', () => {
      const res = resolveIntentCapability('explore', agyEntry);
      expect(res.status).toBe('available');
      expect(res.canLaunch).toBe(true);
      expect(res.alternativeRuntime).toBeNull();
    });

    it('está disponible para escribir propuestas y artefactos', () => {
      const res = resolveIntentCapability('write-artifact', agyEntry);
      expect(res.status).toBe('available');
      expect(res.canLaunch).toBe(true);
      expect(res.alternativeRuntime).toBeNull();
    });

    it('no está disponible para implementar tareas porque no puede correr pruebas', () => {
      const res = resolveIntentCapability('implement-task', agyEntry);
      expect(res.status).toBe('unavailable');
      expect(res.canLaunch).toBe(false);
      expect(res.reasonKey).toBe('pipeline.launcher.intent.unavailableCommands');
    });
  });
});
