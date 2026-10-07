// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeProjection, PipelineDiscoveryEntry } from '@/types/pipeline';
import { PipelineSessionResume } from '../PipelineSessionResume';
import { OpenSpecInspector, formatSessionOption } from '../OpenSpecInspector';
import { translate } from '@/lib/i18n';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';

describe('PipelineSessionResume y reanudación de sesiones (tanda 27)', () => {
  const opencodeDiscovery: PipelineDiscoveryEntry = {
    runtime: 'opencode',
    adapterId: 'opencode',
    installed: true,
    runtimeVersion: '2.0.20',
    launchable: true,
    canResume: true,
    startModifiesRepo: true,
    startRunsCommands: true,
    startAvailability: 'available',
    startConstraints: [],
    diagnostics: [],
  };

  const agyDiscovery: PipelineDiscoveryEntry = {
    runtime: 'agy',
    adapterId: 'antigravity',
    installed: true,
    runtimeVersion: '1.2.13',
    launchable: true,
    canResume: true,
    startModifiesRepo: true,
    startRunsCommands: false,
    startAvailability: 'available',
    startConstraints: [],
    diagnostics: [],
  };

  const claudeDiscovery: PipelineDiscoveryEntry = {
    runtime: 'claude',
    adapterId: 'claude-code',
    installed: true,
    runtimeVersion: '1.0.0',
    launchable: true,
    canResume: false,
    startModifiesRepo: false,
    startAvailability: 'degraded',
    startConstraints: [],
    diagnostics: [],
  };

  const makeSession = (overrides: Partial<RuntimeProjection> = {}): RuntimeProjection => ({
    schemaVersion: '1.0',
    repoId: 'repo-1',
    sessionId: 'cronos-session-1',
    runtime: 'opencode',
    changeId: 'ch-1',
    taskId: '1.1',
    role: 'builder',
    active: false,
    outcome: 'completed',
    startedAt: '2026-10-07T14:30:00.000Z',
    endedAt: '2026-10-07T14:35:00.000Z',
    agents: [],
    activity: [],
    reasoningVisibility: 'unknown',
    telemetry: null,
    controlCapabilities: [],
    droppedActivity: 0,
    diagnostics: [],
    runtimeSessionId: 'ses_tool_123',
    requestedModel: 'unslothpclocal/qwen-3',
    reasoningEffort: null,
    continuesSessionId: null,
    ...overrides,
  });

  beforeEach(() => {
    useGitStore.setState({ language: 'es' });
    usePipelineStore.setState({ selectedChangeId: null, runtimeHistory: [], projection: null });
    (window as any).api = {
      pipelineRuntime: {
        resume: vi.fn().mockResolvedValue({ success: true, data: { sessionId: 'cronos-session-2' } }),
        discover: vi.fn().mockResolvedValue({ success: true, data: [opencodeDiscovery, agyDiscovery, claudeDiscovery] }),
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as any).api;
  });

  describe('Visibilidad del botón «Continuar esta sesión»', () => {
    it('consume la respuesta real del IPC discover, sin inyectar discovery por props', async () => {
      render(<PipelineSessionResume repoPath="C:/repo" session={makeSession()} />);
      expect(await screen.findByRole('button', { name: 'Continuar esta sesión' })).toBeDefined();
    });
    it('se muestra para sesión terminada de OpenCode con runtimeSessionId y canResume', () => {
      render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession()}
          discovery={[opencodeDiscovery]}
        />
      );

      expect(screen.getByRole('button', { name: /Continuar esta sesión/i })).toBeDefined();
    });

    it('se muestra para sesión terminada de Antigravity con runtimeSessionId', () => {
      render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession({ runtime: 'agy', runtimeSessionId: 'conv_123' })}
          discovery={[agyDiscovery]}
        />
      );

      expect(screen.getByRole('button', { name: /Continuar esta sesión/i })).toBeDefined();
    });

    it('no se muestra si la sesión está activa', () => {
      const { container } = render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession({ active: true })}
          discovery={[opencodeDiscovery]}
        />
      );

      expect(container.innerHTML).toBe('');
      expect(screen.queryByRole('button', { name: /Continuar esta sesión/i })).toBeNull();
    });

    it('no se muestra si el runtime no declara canResume (ej. Claude), sin mensajes de «no disponible»', () => {
      const { container } = render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession({ runtime: 'claude' })}
          discovery={[claudeDiscovery]}
        />
      );

      expect(container.innerHTML).toBe('');
      expect(screen.queryByRole('button', { name: /Continuar esta sesión/i })).toBeNull();
      expect(screen.queryByText(/no disponible/i)).toBeNull();
    });

    it('no se muestra si la sesión no tiene runtimeSessionId persistido', () => {
      const { container } = render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession({ runtimeSessionId: null })}
          discovery={[opencodeDiscovery]}
        />
      );

      expect(container.innerHTML).toBe('');
      expect(screen.queryByRole('button', { name: /Continuar esta sesión/i })).toBeNull();
    });
  });

  describe('Interacción con el formulario en el lugar (.ai-surface)', () => {
    it('el aviso de Antigravity distingue editar archivos de ejecutar comandos', () => {
      render(<PipelineSessionResume repoPath="C:/repo" session={makeSession({ runtime: 'agy' })} discovery={[agyDiscovery]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Continuar esta sesión' }));
      expect(screen.getByText('Esta IA puede modificar archivos, pero no ejecuta comandos en tu repositorio.')).toBeDefined();
    });
    it('un rechazo del IPC permite corregir o reintentar, sin dejar el envío trabado', async () => {
      window.api!.pipelineRuntime.resume = vi.fn().mockRejectedValue(new Error('IPC desconectado'));
      render(<PipelineSessionResume repoPath="C:/repo" session={makeSession()} discovery={[opencodeDiscovery]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Continuar esta sesión' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'seguí' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
      expect(await screen.findByRole('alert')).toBeDefined();
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
    });

    it('Escape no simula una cancelación mientras el proceso principal está iniciando', async () => {
      let resolve!: (value: { success: false; error: string }) => void;
      window.api!.pipelineRuntime.resume = vi.fn(() => new Promise<{ success: false; error: string }>((done) => { resolve = done; }));
      render(<PipelineSessionResume repoPath="C:/repo" session={makeSession()} discovery={[opencodeDiscovery]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Continuar esta sesión' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'seguí' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
      fireEvent.keyDown(screen.getByRole('form'), { key: 'Escape' });
      expect(screen.getByRole('form')).toBeDefined();
      resolve({ success: false, error: 'session_already_active' });
      await screen.findByRole('alert');
    });

    it('cambiar de sesión en el inspector descarta el formulario de la conversación anterior', async () => {
      const first = makeSession();
      const second = makeSession({ sessionId: 'second', startedAt: '2026-10-07T14:00:00.000Z' });
      render(<OpenSpecInspector repoPath="C:/repo" projection={first} runtimeHistory={[first, second]} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Continuar esta sesión' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'instrucción para primera sesión' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Elegir sesión de actividad' }), { target: { value: 'second' } });
      expect(screen.queryByRole('form', { name: 'Continuar sesión' })).toBeNull();
    });

    it.each(['es', 'en', 'zh'] as const)('monta el formulario y sus errores traducidos en %s', async (lang) => {
      useGitStore.setState({ language: lang });
      window.api!.pipelineRuntime.resume = vi.fn().mockResolvedValue({ success: false, error: 'session_not_resumable' });
      render(<PipelineSessionResume repoPath="C:/repo" session={makeSession()} discovery={[opencodeDiscovery]} />);
      fireEvent.click(screen.getByRole('button', { name: translate('pipeline.openspec.resume.button', lang) }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'seguí' } });
      fireEvent.click(screen.getByRole('button', { name: translate('pipeline.openspec.resume.submit', lang) }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).not.toContain('session_not_resumable');
      window.api!.pipelineRuntime.resume = vi.fn().mockResolvedValue({ success: false, error: 'opencode_service_start_failed' });
      fireEvent.click(screen.getByRole('button', { name: translate('pipeline.openspec.resume.submit', lang) }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(translate('pipeline.launcher.error.opencode_service_start_failed', lang)));
    });
    it('al tocar «Continuar esta sesión» se despliega el formulario, muestra motor/modelo fijos, aviso de permisos y autofocus en instrucción', () => {
      render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession()}
          discovery={[opencodeDiscovery]}
        />
      );

      const triggerBtn = screen.getByRole('button', { name: /Continuar esta sesión/i });
      fireEvent.click(triggerBtn);

      // Formulario dentro de .ai-surface
      const form = screen.getByRole('form', { name: /Continuar sesión/i });
      expect(form.className).toContain('ai-surface');

      // Motor y modelo fijos
      expect(screen.getByText(/unslothpclocal\/qwen-3/i)).toBeDefined();

      // Aviso de permisos
      expect(screen.getByText(/Esta IA puede modificar archivos y correr comandos en tu repositorio/i)).toBeDefined();

      // Textarea con foco automático
      const textarea = screen.getByRole('textbox', { name: /Instrucción/i });
      expect(document.activeElement).toBe(textarea);
    });

    it('presionar Escape cancela el formulario y restaura el foco en el botón disparador', async () => {
      render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession()}
          discovery={[opencodeDiscovery]}
        />
      );

      const triggerBtn = screen.getByRole('button', { name: /Continuar esta sesión/i });
      fireEvent.click(triggerBtn);

      const textarea = screen.getByRole('textbox', { name: /Instrucción/i });
      fireEvent.keyDown(textarea, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('form', { name: /Continuar sesión/i })).toBeNull();
      });

      const reopenedBtn = screen.getByRole('button', { name: /Continuar esta sesión/i });
      expect(document.activeElement).toBe(reopenedBtn);
    });

    it('presionar botón Cancelar cierra el formulario y restaura el foco en el botón disparador', async () => {
      render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession()}
          discovery={[opencodeDiscovery]}
        />
      );

      const triggerBtn = screen.getByRole('button', { name: /Continuar esta sesión/i });
      fireEvent.click(triggerBtn);

      const cancelBtn = screen.getByRole('button', { name: /Cancelar/i });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByRole('form', { name: /Continuar sesión/i })).toBeNull();
      });

      const reopenedBtn = screen.getByRole('button', { name: /Continuar esta sesión/i });
      expect(document.activeElement).toBe(reopenedBtn);
    });

    it('escribir instrucción y tocar Continuar llama al canal resume con fromSessionId y la instrucción', async () => {
      const onStarted = vi.fn();
      render(
        <PipelineSessionResume
          repoPath="C:/repo"
          session={makeSession()}
          discovery={[opencodeDiscovery]}
          onStarted={onStarted}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Continuar esta sesión/i }));

      const textarea = screen.getByRole('textbox', { name: /Instrucción/i });
      fireEvent.change(textarea, { target: { value: 'agrega los tests que faltaban' } });

      const submitBtn = screen.getByRole('button', { name: /^Continuar$/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect((window as any).api.pipelineRuntime.resume).toHaveBeenCalledWith({
          repoPath: 'C:/repo',
          fromSessionId: 'cronos-session-1',
          instruction: 'agrega los tests que faltaban',
        });
        expect(onStarted).toHaveBeenCalledWith('cronos-session-2');
      });
    });
  });

  describe('Leyenda «continúa la sesión de <hora>»', () => {
    it('formatSessionOption incluye «continúa la sesión de <hora>» cuando continuesSessionId está presente', () => {
      const parentSession = makeSession({
        sessionId: 'parent-1',
        startedAt: '2026-10-07T14:30:00.000Z',
      });
      const continuedSession = makeSession({
        sessionId: 'child-1',
        startedAt: '2026-10-07T14:45:00.000Z',
        continuesSessionId: 'parent-1',
      });

      const parentDate = new Date(parentSession.startedAt);
      const expectedTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(parentDate);

      const optTextEs = formatSessionOption(continuedSession, [parentSession, continuedSession], (k, p) => translate(k, 'es', p));
      expect(optTextEs).toContain(`continúa la sesión de ${expectedTime}`);

      // Idioma inglés
      const optTextEn = formatSessionOption(continuedSession, [parentSession, continuedSession], (k, p) => translate(k, 'en', p));
      expect(optTextEn).toContain(`continues session from ${expectedTime}`);

      // Idioma chino
      const optTextZh = formatSessionOption(continuedSession, [parentSession, continuedSession], (k, p) => translate(k, 'zh', p));
      expect(optTextZh).toContain(`延续 ${expectedTime} 的会话`);
    });

    it('OpenSpecInspector renderiza la leyenda en la cabecera cuando la sesión seleccionada continúa a otra', () => {
      const parentSession = makeSession({
        sessionId: 'parent-1',
        startedAt: '2026-10-07T14:30:00.000Z',
      });
      const parentDate = new Date(parentSession.startedAt);
      const expectedTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(parentDate);

      const continuedSession = makeSession({
        sessionId: 'child-1',
        startedAt: '2026-10-07T14:45:00.000Z',
        continuesSessionId: 'parent-1',
      });

      render(
        <OpenSpecInspector
          repoPath="C:/repo"
          projection={continuedSession}
          runtimeHistory={[parentSession, continuedSession]}
        />
      );

      const matches = screen.getAllByText(new RegExp(`continúa la sesión de ${expectedTime}`, 'i'));
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
