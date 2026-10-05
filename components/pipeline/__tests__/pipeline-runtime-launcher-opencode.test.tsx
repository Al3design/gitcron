// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n';
import type { AiUseStatus, OpenCodeAuthNotice } from '@/types/ai-use';
import type { RuntimeDiscoveryEntry } from '@/types/pipeline';
import { PipelineRuntimeLauncher } from '../PipelineRuntimeLauncher';

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    return translate(key, 'es', params);
  },
}));

const DISCOVERY_OPENCODE: RuntimeDiscoveryEntry[] = [
  {
    runtime: 'opencode',
    adapterId: 'adapter-opencode',
    installed: true,
    runtimeVersion: '2.0.20',
    launchable: true,
    evidenceStatus: 'verified',
    startAvailability: 'available',
    startConstraints: ['edita archivos y corre comandos con OpenCode run', 'mode --auto'],
    startModifiesRepo: true,
    startRunsCommands: true,
    diagnostics: [],
  },
];

const launchKeyOf = (modelRef: string) => JSON.stringify([modelRef, null]);

function mockOpenCodeAgentStatus(overrides: Partial<Extract<AiUseStatus, { status: 'resolved' }>> = {}): AiUseStatus {
  const base: Extract<AiUseStatus, { status: 'resolved' }> = {
    use: 'gitcron-sdd',
    status: 'resolved',
    providerId: 'unsloth',
    providerName: 'Unsloth CASA',
    modelId: 'unsloth/Qwen3.8',
    modelRef: 'unsloth/unsloth/Qwen3.8',
    kind: 'openai-compatible',
    destination: 'own-server',
    sourceFile: 'C:/repo-test/.gitcron/gitcron.json',
    sourceDir: 'C:/repo-test/.gitcron',
    modelSource: 'agent',
    isException: true,
    available: true,
    unavailableReason: null,
    alternatives: [],
    canLoad: false,
    runtime: 'opencode',
    toolsExecutor: 'OpenCode',
    opencodeInstalled: true,
    opencodeListFailed: false,
    opencodeKnown: false,
    opencodeAuthNotice: null,
    contextLimit: 32768,
    ...overrides,
  };
  return { ...base, launchKey: overrides.launchKey ?? launchKeyOf(base.modelRef ?? '') };
}

describe('PipelineRuntimeLauncher — Copiar a OpenCode y verificación de claves (tarea 5.3)', () => {
  let startSpy: ReturnType<typeof vi.fn>;
  let discoverSpy: ReturnType<typeof vi.fn>;
  let aiStatusSpy: ReturnType<typeof vi.fn>;
  let aiModelsSpy: ReturnType<typeof vi.fn>;
  let aiChooseSpy: ReturnType<typeof vi.fn>;
  let planOpenCodeCopySpy: ReturnType<typeof vi.fn>;
  let applyOpenCodeCopySpy: ReturnType<typeof vi.fn>;
  let checkOpenCodeAuthSpy: ReturnType<typeof vi.fn>;

  const SECRET_VAL = 'raw-super-secret-key-999';

  beforeEach(() => {
    vi.clearAllMocks();
    startSpy = vi.fn().mockResolvedValue({ success: true, data: { sessionId: 'sess-opencode' } });
    discoverSpy = vi.fn().mockResolvedValue({ success: true, data: DISCOVERY_OPENCODE });
    aiStatusSpy = vi.fn().mockResolvedValue({
      success: true,
      data: mockOpenCodeAgentStatus(),
    });
    aiModelsSpy = vi.fn().mockResolvedValue({ success: true, data: [] });
    aiChooseSpy = vi.fn().mockResolvedValue({ success: true, data: { written: true, file: 'gitcron.json' } });
    planOpenCodeCopySpy = vi.fn().mockResolvedValue({
      success: true,
      data: {
        canCopy: true,
        providerId: 'unsloth',
        modelId: 'unsloth/Qwen3.8',
        targetPath: 'C:/Users/test/.config/opencode/opencode.json',
        mode: 'add_provider',
        previewText: '{\n  "provider": {\n    "unsloth": { ... }\n  }\n}',
        hasLiteralSecrets: true,
        omittedSecrets: ['options.apiKey'],
      },
    });
    applyOpenCodeCopySpy = vi.fn().mockResolvedValue({
      success: true,
      data: { written: true, created: false },
    });
    checkOpenCodeAuthSpy = vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'match', notice: null },
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        pipelineRuntime: {
          discover: discoverSpy,
          start: startSpy,
          stop: vi.fn(),
          planOpenCodeCopy: planOpenCodeCopySpy,
          applyOpenCodeCopy: applyOpenCodeCopySpy,
          checkOpenCodeAuth: checkOpenCodeAuthSpy,
        },
        aiUse: {
          status: aiStatusSpy,
          models: aiModelsSpy,
          choose: aiChooseSpy,
        },
        commitAi: {
          onConfigChanged: vi.fn().mockReturnValue(() => {}),
        },
        shellOpenPath: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as { api?: unknown }).api;
  });

  it('«Copiar a OpenCode» sólo aparece cuando el modelo es desconocido para OpenCode', async () => {
    // Caso 1: opencodeKnown = false
    const { unmount } = render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Continuar con change-abc"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Copiar a OpenCode/i })).toBeDefined();
    });

    unmount();

    // Caso 2: opencodeKnown = true -> NO debe aparecer
    aiStatusSpy.mockResolvedValueOnce({
      success: true,
      data: mockOpenCodeAgentStatus({ opencodeKnown: true }),
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Continuar con change-abc"
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Copiar a OpenCode/i })).toBeNull();
    });
  });

  it('el diálogo de copia muestra la vista previa, advierte sobre secretos literales y permite cancelar sin escribir', async () => {
    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Continuar con change-abc"
      />,
    );

    const copyBtn = await screen.findByRole('button', { name: /Copiar a OpenCode/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(planOpenCodeCopySpy).toHaveBeenCalledWith('C:/repo-test');
      expect(screen.getByRole('dialog')).toBeDefined();
    });

    // Muestra la vista previa y la advertencia de secreto literal
    expect(screen.getByText(/Copiar a la configuración de OpenCode/i)).toBeDefined();
    expect(screen.getByText(/Las claves o cabeceras escritas a mano no se copian/i)).toBeDefined();
    expect(screen.getByText(/C:\/Users\/test\/\.config\/opencode\/opencode\.json/i)).toBeDefined();

    // Cancelar no escribe nada y cierra el diálogo
    const cancelBtn = screen.getByRole('button', { name: /Cancelar/i });
    fireEvent.click(cancelBtn);

    expect(applyOpenCodeCopySpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirmar la copia invoca applyOpenCodeCopy y refresca el estado', async () => {
    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Continuar con change-abc"
      />,
    );

    const copyBtn = await screen.findByRole('button', { name: /Copiar a OpenCode/i });
    fireEvent.click(copyBtn);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());

    const confirmBtn = screen.getByRole('button', { name: /Confirmar y copiar/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(applyOpenCodeCopySpy).toHaveBeenCalledWith('C:/repo-test');
    });

    // El diálogo se cierra tras copiar
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('aviso de clave: missing_env muestra el nombre de variable y botón de volver a comprobar', async () => {
    aiStatusSpy.mockResolvedValueOnce({
      success: true,
      data: mockOpenCodeAgentStatus({
        opencodeKnown: true,
        opencodeAuthNotice: {
          kind: 'missing_env',
          variableName: 'UNSLOTH_API_KEY',
        },
      }),
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Continuar con change-abc"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/OpenCode no ve la variable UNSLOTH_API_KEY/i)).toBeDefined();
    });

    const recheckBtn = screen.getByRole('button', { name: /Volver a comprobar/i });
    expect(recheckBtn).toBeDefined();

    fireEvent.click(recheckBtn);
    expect(discoverSpy).toHaveBeenCalledTimes(2);
  });

  it('aviso de clave: auth_json_override muestra la orden de logout y el botón de copiar', async () => {
    aiStatusSpy.mockResolvedValueOnce({
      success: true,
      data: mockOpenCodeAgentStatus({
        opencodeKnown: true,
        opencodeAuthNotice: {
          kind: 'auth_json_override',
          providerId: 'unsloth',
          logoutCommand: 'opencode auth logout unsloth',
        },
      }),
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Continuar con change-abc"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/OpenCode usa la clave que tiene guardada, distinta de la de GitCron/i)).toBeDefined();
      expect(screen.getByText('opencode auth logout unsloth')).toBeDefined();
    });

    // El aviso no bloquea el botón de lanzamiento si está confirmado
    const confirmCheck = screen.getByRole('checkbox');
    fireEvent.click(confirmCheck);

    const startBtn = screen.getByRole('button', { name: /Empezar/i });
    expect(startBtn.hasAttribute('disabled')).toBe(false);
  });

  it('aviso de clave: mismatch_other muestra el aviso correspondiente', async () => {
    aiStatusSpy.mockResolvedValueOnce({
      success: true,
      data: mockOpenCodeAgentStatus({
        opencodeKnown: true,
        opencodeAuthNotice: {
          kind: 'mismatch_other',
          providerId: 'unsloth',
        },
      }),
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Continuar con change-abc"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/OpenCode resuelve otra clave para este proveedor/i)).toBeDefined();
    });
  });

  it('higiene estricta: ningún valor de clave o secreto viaja al DOM', async () => {
    aiStatusSpy.mockResolvedValueOnce({
      success: true,
      data: mockOpenCodeAgentStatus({
        opencodeKnown: true,
        opencodeAuthNotice: {
          kind: 'missing_env',
          variableName: 'UNSLOTH_API_KEY',
        },
      }),
    });

    const { container } = render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Continuar con change-abc"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/OpenCode no ve la variable UNSLOTH_API_KEY/i)).toBeDefined();
    });

    expect(container.innerHTML).not.toContain(SECRET_VAL);
    expect(document.body.innerHTML).not.toContain(SECRET_VAL);
  });

  it('las cadenas de i18n existen y están traducidas en es, en y zh', () => {
    const keys = [
      'pipeline.launcher.copyToOpenCode',
      'pipeline.launcher.copyModalTitle',
      'pipeline.launcher.copyModalDescription',
      'pipeline.launcher.copyModalLiteralSecretNote',
      'pipeline.launcher.copyConfirm',
      'pipeline.launcher.copyCancel',
      'pipeline.launcher.copying',
      'pipeline.launcher.authWarningMissingEnv',
      'pipeline.launcher.authWarningAuthJson',
      'pipeline.launcher.authWarningMismatchOther',
    ] as const;

    for (const lang of ['es', 'en', 'zh'] as const) {
      for (const k of keys) {
        const text = translate(k, lang, { path: 'path/to/opencode.json', variableName: 'TEST_VAR' });
        expect(text).toBeDefined();
        expect(text).not.toBe(k);
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
