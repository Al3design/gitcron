// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/lib/i18n';
import type { AiUseStatus } from '@/types/ai-use';
import type { RuntimeDiscoveryEntry } from '@/types/pipeline';
import { PipelineRuntimeLauncher } from '../PipelineRuntimeLauncher';

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    if (key.startsWith('pipeline.launcher.error.')) {
      return `tr(${key})`;
    }
    return key;
  },
}));

const DISCOVERY_FIXTURE: RuntimeDiscoveryEntry[] = [
  {
    runtime: 'claude',
    adapterId: 'adapter-claude',
    installed: true,
    runtimeVersion: '1.0.0',
    launchable: true,
    evidenceStatus: 'verified',
    startAvailability: 'available',
    startConstraints: ['edita archivos y corre comandos con Read, Grep, Glob, Edit, Write, Bash'],
    startModifiesRepo: true,
    startRunsCommands: true,
    diagnostics: [],
  },
  {
    runtime: 'codex',
    adapterId: 'adapter-codex',
    installed: true,
    runtimeVersion: '0.143.0',
    launchable: true,
    evidenceStatus: 'verified',
    startAvailability: 'available',
    startConstraints: ['workspace-write sandbox'],
    startModifiesRepo: true,
    startRunsCommands: true,
    diagnostics: [],
  },
];

const launchKeyOf = (modelRef: string, effort?: string) => JSON.stringify([modelRef, effort ?? null]);

function mockResolvedAgentStatus(overrides: Partial<Extract<AiUseStatus, { status: 'resolved' }>> = {}): AiUseStatus {
  const base: Extract<AiUseStatus, { status: 'resolved' }> = {
    use: 'gitcron-sdd',
    status: 'resolved',
    providerId: 'codex',
    providerName: 'Codex',
    modelId: 'gpt-5.6-sol',
    modelRef: 'codex/gpt-5.6-sol',
    kind: 'cli',
    destination: 'external-service',
    sourceFile: 'C:/repo-test/.gitcron/gitcron.json',
    sourceDir: 'C:/repo-test/.gitcron',
    modelSource: 'agent',
    isException: true,
    available: true,
    unavailableReason: null,
    alternatives: [],
    canLoad: false,
    runtime: 'codex',
    toolsExecutor: 'Codex',
    effort: 'high',
    ...overrides,
  };
  return { ...base, launchKey: overrides.launchKey ?? launchKeyOf(base.modelRef ?? '', base.effort) };
}

describe('PipelineRuntimeLauncher — capacidades unificadas y confirmación explícita', { timeout: 15_000 }, () => {
  let startSpy: ReturnType<typeof vi.fn>;
  let discoverSpy: ReturnType<typeof vi.fn>;
  let aiStatusSpy: ReturnType<typeof vi.fn>;
  let aiModelsSpy: ReturnType<typeof vi.fn>;
  let aiChooseSpy: ReturnType<typeof vi.fn>;
  let configChangedSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    startSpy = vi.fn().mockResolvedValue({ success: true, data: { sessionId: 'sess-test' } });
    discoverSpy = vi.fn().mockResolvedValue({ success: true, data: DISCOVERY_FIXTURE });
    aiStatusSpy = vi.fn().mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus(),
    });
    aiModelsSpy = vi.fn().mockResolvedValue({ success: true, data: [] });
    aiChooseSpy = vi.fn().mockResolvedValue({ success: true, data: { written: true, file: 'gitcron.json' } });
    configChangedSpy = vi.fn().mockReturnValue(() => {});

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        pipelineRuntime: {
          discover: discoverSpy,
          start: startSpy,
          stop: vi.fn(),
        },
        aiUse: {
          status: aiStatusSpy,
          models: aiModelsSpy,
          choose: aiChooseSpy,
        },
        commitAi: {
          onConfigChanged: configChangedSpy,
        },
        shellOpenPath: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as { api?: unknown }).api;
  });

  it('montaje con Codex para escribir una propuesta: disponible sin alternativa forzada y exige confirmación que nombra archivos y comandos', async () => {
    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Escribir la propuesta para change-abc"
      />,
    );

    // Espera a que resuelvan el discovery y el estado de IA
    await vi.waitFor(() => expect(screen.getByRole('checkbox')).toBeDefined());

    // El motor sale del modelo: ya no existe combobox de selección de motores
    expect(screen.queryByRole('combobox')).toBeNull();

    // Codex admite workspace-write: NO muestra alerta de indisponibilidad ni fuerza alternativa
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /pipeline\.launcher\.intent\.useAlternative/ })).toBeNull();

    // Muestra la confirmación previa que nombra motor, modelo, nivel y ejecutor de herramientas
    const confirmCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(confirmCheckbox).toBeDefined();
    expect(
      screen.getByText(
        'pipeline.launcher.confirmWriteAgentWithEffort:{"motor":"Codex","model":"gpt-5.6-sol","effort":"high","executor":"Codex"}',
      ),
    ).toBeDefined();

    // El botón de inicio está deshabilitado mientras no se confirme
    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);

    // Confirmar que la IA modificará archivos y correrá comandos
    fireEvent.click(confirmCheckbox);
    expect(startButton.disabled).toBe(false);

    // Iniciar la sesión
    await act(async () => {
      fireEvent.click(startButton);
    });

    // El contrato enviado a start manda expectedModel con nivel y NO manda runtime
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith({
      repoPath: 'C:/repo-test',
      instruction: 'Escribir la propuesta para change-abc',
      changeId: 'change-abc',
      taskId: 'task-xyz',
      expectedModel: launchKeyOf('codex/gpt-5.6-sol', 'high'),
    });
  });

  it('«implementar una tarea» con Claude está disponible para correr pruebas sin aviso de degradación', async () => {
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'claude-code',
        providerName: 'Claude Code',
        modelRef: 'claude-code/claude-3-7-sonnet',
        modelId: 'claude-3-7-sonnet',
        runtime: 'claude',
        toolsExecutor: 'Claude Code',
        effort: undefined,
      }),
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="implement-task"
        changeId="change-implement"
        taskId="task-1.2"
        initialInstruction="Implementar la tarea 1.2"
      />,
    );

    await vi.waitFor(() => expect(screen.getByRole('checkbox')).toBeDefined());

    // Sin combobox de motores
    expect(screen.queryByRole('combobox')).toBeNull();

    // Con Claude y Bash habilitado: no hay aviso de pruebas ausentes ni alert
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    // Exige confirmación explícita nombrando motor, modelo y ejecutor
    const confirmCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(
      screen.getByText(
        'pipeline.launcher.confirmWriteAgent:{"motor":"Claude","model":"claude-3-7-sonnet","executor":"Claude Code"}',
      ),
    ).toBeDefined();

    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);

    fireEvent.click(confirmCheckbox);
    expect(startButton.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(startButton);
    });

    expect(startSpy).toHaveBeenCalledWith({
      repoPath: 'C:/repo-test',
      instruction: 'Implementar la tarea 1.2',
      changeId: 'change-implement',
      taskId: 'task-1.2',
      expectedModel: launchKeyOf('claude-code/claude-3-7-sonnet'),
    });
  });

  it('modelo con runtime opencode muestra aviso de no soportado y deshabilita Iniciar', async () => {
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'my-custom',
        providerName: 'Custom Provider',
        modelRef: 'my-custom/my-model',
        modelId: 'my-model',
        modelSource: 'general',
        isException: false,
        sourceFile: 'gitcron.json',
        sourceDir: 'C:/repo-test',
        runtime: 'opencode',
        toolsExecutor: 'OpenCode',
        effort: undefined,
      }),
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Escribir algo"
      />,
    );

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeDefined());

    expect(screen.getByRole('alert').textContent).toContain('pipeline.launcher.unsupportedRuntimeOpenCode');
    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('modelo con runtime agy (Antigravity) muestra aviso de no soportado y deshabilita Iniciar', async () => {
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'antigravity',
        providerName: 'Antigravity',
        modelRef: 'antigravity/gemini-2.5-pro',
        modelId: 'gemini-2.5-pro',
        modelSource: 'agent',
        isException: false,
        sourceFile: 'gitcron.json',
        sourceDir: 'C:/repo-test',
        runtime: 'agy',
        toolsExecutor: 'Antigravity',
        effort: undefined,
      }),
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Escribir algo"
      />,
    );

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeDefined());

    expect(screen.getByRole('alert').textContent).toContain('pipeline.launcher.unsupportedRuntimeAgy');
    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('sin modelo configurado: muestra aviso, ofrece elegir y el botón Iniciar queda deshabilitado', async () => {
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: {
        use: 'gitcron-sdd',
        status: 'unset',
        offer: null,
      } satisfies AiUseStatus,
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Escribir algo"
      />,
    );

    await vi.waitFor(() => expect(screen.getByText('aiUse.unsetAgent')).toBeDefined());

    expect(screen.getByRole('button', { name: 'aiUse.chooseModel' })).toBeDefined();
    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('rechazo por model_mismatch: muestra el error traducido y refresca el estado del modelo', async () => {
    startSpy.mockResolvedValueOnce({
      success: false,
      error: 'model_mismatch',
    });

    render(
      <PipelineRuntimeLauncher
        repoPath="C:/repo-test"
        projection={null}
        intent="write-artifact"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Escribir la propuesta para change-abc"
      />,
    );

    await vi.waitFor(() => expect(screen.getByRole('checkbox')).toBeDefined());

    const confirmCheckbox = screen.getByRole('checkbox');
    fireEvent.click(confirmCheckbox);

    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' });
    const initialCallCount = aiStatusSpy.mock.calls.length;

    await act(async () => {
      fireEvent.click(startButton);
    });

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toContain('pipeline.launcher.error.model_mismatch');

    // Comprueba que se haya vuelto a consultar aiUse.status debido al refresco
    await vi.waitFor(() => expect(aiStatusSpy.mock.calls.length).toBeGreaterThan(initialCallCount));
  });

  it('diccionarios i18n: las claves de tanda 19 existen en es, en y zh sin variables sin resolver', () => {
    const keysToCheck: { key: string; vars?: Record<string, string | number> }[] = [
      { key: 'pipeline.launcher.unsupportedRuntimeOpenCode' },
      { key: 'pipeline.launcher.unsupportedRuntimeAgy' },
      { key: 'pipeline.launcher.intent.chooseOtherModel' },
      {
        key: 'pipeline.launcher.confirmWriteAgent',
        vars: { motor: 'Codex', model: 'gpt-5', executor: 'Codex' },
      },
      {
        key: 'pipeline.launcher.confirmWriteAgentWithEffort',
        vars: { motor: 'Codex', model: 'gpt-5', effort: 'high', executor: 'Codex' },
      },
      { key: 'pipeline.launcher.error.model_mismatch' },
      { key: 'pipeline.launcher.error.no_model' },
      { key: 'pipeline.launcher.error.disabled' },
      { key: 'pipeline.launcher.error.unsupported_runtime_opencode' },
      { key: 'pipeline.launcher.error.unsupported_runtime_agy' },
      { key: 'pipeline.launcher.error.runtime_not_installed' },
      { key: 'pipeline.launcher.error.runtime_not_launchable' },
      {
        key: 'aiUse.resolvedAgent',
        vars: { model: 'm', provider: 'p', motor: 'mot', destination: 'd', file: 'f' },
      },
      {
        key: 'aiUse.resolvedAgentWithEffort',
        vars: { model: 'm', provider: 'p', motor: 'mot', destination: 'd', file: 'f', effort: 'high' },
      },
      {
        key: 'aiUse.toolsAgent',
        vars: { executor: 'ex' },
      },
      { key: 'aiUse.unsetAgent' },
      { key: 'aiUse.pickerAgentExecutor', vars: { executor: 'Codex' } },
      { key: 'aiUse.pickerAgentNotYet', vars: { executor: 'OpenCode' } },
    ];

    for (const lang of ['es', 'en', 'zh'] as const) {
      for (const item of keysToCheck) {
        const text = translate(item.key, lang, item.vars);
        expect(text, `Clave ${item.key} no encontrada en ${lang}`).not.toBe(item.key);
        expect(text, `Variable sin interpolar en ${item.key} para ${lang}`).not.toMatch(/\{\{.*\}\}/);
      }
    }
  });

  it('si el modelo cambia después de confirmar, la confirmación se desmarca y hay que volver a confirmar', async () => {
    render(
      <PipelineRuntimeLauncher repoPath="C:/repo-test" projection={null} intent="write-artifact" initialInstruction="Escribir" />,
    );
    await vi.waitFor(() => expect(screen.getByRole('checkbox')).toBeDefined());
    fireEvent.click(screen.getByRole('checkbox'));
    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(false);

    // Alguien cambia la elección (en otra pantalla o a mano en gitcron.json): la línea vuelve a preguntar.
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'claude-code', providerName: 'Claude Code', modelRef: 'claude-code/opus', modelId: 'opus',
        runtime: 'claude', toolsExecutor: 'Claude Code', effort: undefined,
      }),
    });
    const onChanged = configChangedSpy.mock.calls[0][0] as () => void;
    await act(async () => { onChanged(); });

    await vi.waitFor(() => expect(
      screen.getByText('pipeline.launcher.confirmWriteAgent:{"motor":"Claude","model":"opus","executor":"Claude Code"}'),
    ).toBeDefined());
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(startButton.disabled).toBe(true);
  });

  it('con el motor del modelo sin instalar lo dice y ofrece volver a comprobar', async () => {
    discoverSpy.mockResolvedValueOnce({ success: true, data: [DISCOVERY_FIXTURE[0]] });
    render(<PipelineRuntimeLauncher repoPath="C:/repo-test" projection={null} intent="explore" initialInstruction="Mirar" />);

    await vi.waitFor(() => expect(screen.getByText('tr(pipeline.launcher.error.runtime_not_installed)')).toBeDefined());
    expect((screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'pipeline.launcher.recheck' })); });
    await vi.waitFor(() => expect(discoverSpy).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByText('tr(pipeline.launcher.error.runtime_not_installed)')).toBeNull());
  });

  it('el selector del agente lista los servidores de gitcron.json y dice por dónde corre cada uno', async () => {
    aiModelsSpy.mockResolvedValue({
      success: true,
      data: {
        use: 'gitcron-sdd',
        current: { providerId: 'codex', modelId: 'gpt-5.6-sol', fullModelRef: 'codex/gpt-5.6-sol', sourceFile: 'g.json', scope: 'global' },
        providers: [
          { id: 'codex', name: 'Codex', kind: 'cli', available: true, models: [{ id: 'gpt-5.6-sol', name: 'gpt-5.6-sol' }], agentRuntime: 'codex', toolsExecutor: 'Codex' },
          { id: 'unslothpclocal', name: 'Unsloth CASA Local', kind: 'openai-compatible', available: true, models: [{ id: 'unsloth/Qwen3.8-27B-GGUF', name: 'Qwen 3.8 27B' }], agentRuntime: 'opencode', toolsExecutor: 'OpenCode' },
        ],
      },
    });
    render(<PipelineRuntimeLauncher repoPath="C:/repo-test" projection={null} intent="explore" initialInstruction="Mirar" />);

    fireEvent.click(await screen.findByRole('button', { name: 'aiUse.chooseModel' }));
    expect(await screen.findByText('aiUse.pickerAgentExecutor:{"executor":"Codex"}')).toBeDefined();

    const providerSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect([...providerSelect.options].map((o) => o.value)).toEqual(['codex', 'unslothpclocal']);
    fireEvent.change(providerSelect, { target: { value: 'unslothpclocal' } });
    expect(await screen.findByText('aiUse.pickerAgentNotYet:{"executor":"OpenCode"}')).toBeDefined();
  });
});
