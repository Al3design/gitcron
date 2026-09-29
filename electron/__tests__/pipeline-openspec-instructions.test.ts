import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizedOpenSpecRuntime } from '../pipeline/openspec-engine';

const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { instructionsOpenSpecWithCli } = await import('../pipeline/openspec-cli');
const {
  composeApplyInstruction,
  composeArchiveInstruction,
  composeExploreInstruction,
  composeProposeInstruction,
  derivePipelineNextAction,
} = await import('../../components/pipeline/pipeline-next-action');
const {
  validateExploreForm,
  validateProposeForm,
} = await import('../../components/pipeline/pipeline-guided-forms');
const { registerOpenSpecIpcHandlers } = await import('../ipc/pipeline-openspec');
const { translate } = await import('../../lib/i18n');

describe('OpenSpec Instructions (Group 2)', () => {
  const mockRuntime: AuthorizedOpenSpecRuntime = {
    executablePath: 'C:\\custom\\path\\openspec.cmd',
    command: 'openspec.cmd',
    shell: true,
    displayPath: 'C:\\custom\\path\\openspec.cmd',
    provenance: 'global',
  };

  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('instructionsOpenSpecWithCli', () => {
    it('ejecuta openspec instructions sobre un change existente y parsea la respuesta JSON correctamente', async () => {
      execFileMock.mockImplementation((_cmd, _args, _opts, callback: (e: unknown, r: { stdout: string; stderr: string }) => void) => {
        callback(null, {
          stdout: JSON.stringify({
            changeName: 'actualizar-ciclo-sdd-a-openspec-1-11',
            instruction: 'Create proposal, specs, design, tasks.',
            context: 'Language: es\nGitCron context',
            state: 'ready',
          }),
          stderr: '',
        });
      });

      const result = await instructionsOpenSpecWithCli(
        'C:/repo',
        'proposal',
        { runtime: mockRuntime, changeId: 'actualizar-ciclo-sdd-a-openspec-1-11' },
      );

      expect(result.ok).toBe(true);
      expect(result.error).toBeNull();
      expect(result.data).not.toBeNull();
      expect(result.data?.instruction).toBe('Create proposal, specs, design, tasks.');
      expect(result.data?.context).toContain('GitCron context');
    });

    it('devuelve error descriptivo cuando el CLI no existe', async () => {
      const result = await instructionsOpenSpecWithCli(
        'C:/invalid-repo',
        'apply',
        { runtime: null },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBe('openspec-cli-not-found');
      expect(result.data).toBeNull();
    });

    it('devuelve error descriptivo cuando el change no existe', async () => {
      execFileMock.mockImplementation((_cmd, _args, _opts, callback: (e: unknown, r?: { stdout: string; stderr: string }) => void) => {
        const error = new Error('Command failed');
        (error as any).stdout = JSON.stringify({
          status: [
            { severity: 'error', code: 'change_error', message: "Change 'cambio-inexistente-xyz' not found" },
          ],
        });
        callback(error);
      });

      const result = await instructionsOpenSpecWithCli(
        'C:/repo',
        'apply',
        { runtime: mockRuntime, changeId: 'cambio-inexistente-xyz' },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Change 'cambio-inexistente-xyz' not found");
    });
  });

  describe('IPC pipeline:openspec:instructions', () => {
    it('valida estrictamente las claves del payload y rechaza claves ajenas', async () => {
      const handlers = new Map<string, Function>();
      const mockIpc = {
        handle: (channel: string, listener: Function) => {
          handlers.set(channel, listener);
        },
      };

      registerOpenSpecIpcHandlers({
        ipcMain: mockIpc,
        getUserDataDir: () => 'C:/userData',
        getAuthorizedRepoRoots: () => ['C:/valid-repo'],
        validateRepoPath: (p: unknown) => (p === 'C:/valid-repo' ? 'C:/valid-repo' : null),
        getInstructions: vi.fn().mockResolvedValue({ ok: true, error: null, data: { instruction: 'test' } }),
      });

      const handler = handlers.get('pipeline:openspec:instructions');
      expect(handler).toBeDefined();

      // Payload con clave maliciosa/desconocida
      await expect(
        handler!({}, { repoPath: 'C:/valid-repo', target: 'apply', evilKey: true }),
      ).rejects.toThrow(/IPC Security Error/);

      // Payload con repo inválido
      await expect(
        handler!({}, { repoPath: 'C:/unauthorized-repo', target: 'apply' }),
      ).rejects.toThrow(/IPC Security Error/);

      // Payload válido
      const response = await handler!({}, { repoPath: 'C:/valid-repo', target: 'apply', changeId: 'cambio-1' });
      expect(response).toEqual({ ok: true, error: null, data: { instruction: 'test' } });
    });
  });

  describe('La instrucción sale del motor (2.1 a 2.3)', () => {
    it('composeProposeInstruction no enumera comandos a mano e integra instruction y context del motor', () => {
      const composed = composeProposeInstruction('nuevo-change', 'Construir X', 'Sin tocar Y', {
        instruction: 'Create proposal, specs, design, tasks.',
        context: 'Language: es\nRegla de arquitectura: React 19',
      });

      expect(composed).toContain('nuevo-change');
      expect(composed).toContain('Objetivo: Construir X');
      expect(composed).toContain('Alcance y restricciones: Sin tocar Y');
      expect(composed).toContain('Create proposal, specs, design, tasks.');
      expect(composed).toContain('Contexto del proyecto:\nLanguage: es\nRegla de arquitectura: React 19');

      // No contiene comandos hardcodeados
      expect(composed).not.toContain('openspec new change');
      expect(composed).not.toContain('openspec status');
    });

    it('composeApplyInstruction entrega la tarea y consume context sin comandos manuales', () => {
      const composed = composeApplyInstruction('mi-change', '2.1', 'Implementar función Z', {
        instruction: 'Read context files, work through tasks, mark complete.',
        context: 'Rama por cambio: git checkout -b change/<slug>',
      });

      expect(composed).toContain('Implementá la tarea 2.1 del change «mi-change»');
      expect(composed).toContain('Tarea 2.1: Implementar función Z');
      expect(composed).toContain('Read context files, work through tasks, mark complete.');
      expect(composed).toContain('Contexto del proyecto:\nRama por cambio: git checkout -b change/<slug>');

      // No hardcodea openspec status ni openspec instructions tasks
      expect(composed).not.toContain('openspec status --change');
      expect(composed).not.toContain('openspec instructions tasks');
    });

    it('composeArchiveInstruction y composeExploreInstruction consumen contexto del motor', () => {
      const archive = composeArchiveInstruction('mi-change');
      expect(archive).toBe('openspec archive mi-change --yes');

      const explore = composeExploreInstruction('Investigar nueva lib', {
        context: 'Contexto general',
        instruction: 'Analizar pros y contras',
      });
      expect(explore).toContain('Quiero explorar: Investigar nueva lib');
      expect(explore).toContain('Analizar pros y contras');
      expect(explore).toContain('Contexto del proyecto:\nContexto general');
    });
  });

  describe('Casos reales de Proponer, Explorar y canal de errores (Puntos 1, 2, 3)', () => {
    it('proponer un change nuevo que todavía no existe en disco entrega instrucción válida', () => {
      const result = validateProposeForm({
        objective: 'Reemplazar tema visual',
        slug: 'nuevo-tema-oscuro',
        constraints: 'Sin tocar iconos',
      });

      expect(result.errors).toEqual({});
      expect(result.focus).toBeNull();
      expect(result.instruction).not.toBeNull();
      expect(result.instruction).toContain('«nuevo-tema-oscuro»');
      expect(result.instruction).toContain('Objetivo: Reemplazar tema visual');
      expect(result.instruction).toContain('Alcance y restricciones: Sin tocar iconos');
      // No contiene comandos manuales enumerados
      expect(result.instruction).not.toContain('openspec new change');
      expect(result.instruction).not.toContain('openspec status');
    });

    it('explorar sin change asociado entrega instrucción válida', () => {
      const result = validateExploreForm({
        description: 'Evaluar rendimiento de SQLite nativo',
      });

      expect(result.errors).toEqual({});
      expect(result.focus).toBeNull();
      expect(result.instruction).not.toBeNull();
      expect(result.instruction).toContain('Quiero explorar: Evaluar rendimiento de SQLite nativo');
      expect(result.instruction).toContain('sin crear ningún change ni artefacto');
      expect(result.instruction).not.toContain('openspec new change');
    });

    it('el canal de error del motor en instrucciones informa el error con su propia clave i18n', () => {
      const langs = ['es', 'en', 'zh'] as const;
      for (const lang of langs) {
        const branchMsg = translate('pipeline.newChange.propose.branchFailed', lang);
        const engineMsg = translate('pipeline.next.engineError', lang, { error: 'test-error' });

        expect(branchMsg).toBeDefined();
        expect(engineMsg).toBeDefined();
        expect(branchMsg).not.toBe(engineMsg);
        expect(engineMsg).toContain('test-error');
      }
    });

    it('un fallo del motor o estado bloqueado informa el motivo real y no arranca ninguna sesión (2.4)', () => {
      const pendingTask = {
        id: '1.2',
        description: 'Tarea pendiente',
        completed: false,
        line: 10,
        slug: '1.2',
      };
      const changeSummary: any = {
        changeId: 'mi-change',
        tasks: [pendingTask],
        validation: 'passed',
      };

      const result = derivePipelineNextAction({
        fixtureActive: false,
        selectedChange: changeSummary,
        selectedArchivedChangeId: null,
        projection: null,
        engineInstructions: {
          instruction: null,
          context: null,
          error: 'Change is blocked by dependency: specs missing',
        },
      });

      expect(result.helpKey).toBe('pipeline.next.engineError');
      expect(result.helpParams?.error).toBe('Change is blocked by dependency: specs missing');
      expect(result.primary).toBeNull();
      expect(result.instruction).toBeNull();
    });
  });

  describe('Reglas de config.yaml llegan al ejecutor sin tocar la app (2.5)', () => {
    it('una regla nueva en el contexto del motor viaja en la instrucción', () => {
      const newCustomRule = 'Nueva regla agregada a config.yaml el 2026-09-02: No usar dependencias externas para X';
      const engineData = {
        instruction: 'Instrucción estándar 1.11',
        context: `Language: es\n${newCustomRule}`,
      };

      const instruction = composeApplyInstruction('c-test', '1.1', 'Hacer algo', engineData);
      expect(instruction).toContain(newCustomRule);
    });
  });
});
