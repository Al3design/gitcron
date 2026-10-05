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
  {
    runtime: 'agy',
    adapterId: 'adapter-agy',
    installed: true,
    runtimeVersion: '1.2.13',
    launchable: true,
    evidenceStatus: 'verified',
    startAvailability: 'available',
    startConstraints: ['edita archivos en el repositorio con --mode accept-edits', 'runsCommands: false'],
    startModifiesRepo: true,
    startRunsCommands: false,
    diagnostics: [],
  },
];

const launchKeyOf = (modelRef: string, effortOrVariant?: string) => JSON.stringify([modelRef, effortOrVariant ?? null]);

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
  return { ...base, launchKey: overrides.launchKey ?? launchKeyOf(base.modelRef ?? '', overrides.variant ?? base.effort) };
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

  it('modelo con runtime agy (Antigravity) se lanza para escribir artefactos con confirmación de no correr comandos', async () => {
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

    await vi.waitFor(() => expect(screen.getByRole('checkbox')).toBeDefined());

    const confirmLabel = screen.getByText(/confirmWriteAgentNoCommands/);
    expect(confirmLabel).toBeDefined();

    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);

    const confirmCheckbox = screen.getByRole('checkbox');
    fireEvent.click(confirmCheckbox);
    expect(startButton.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(startButton);
    });

    expect(startSpy).toHaveBeenCalledWith({
      repoPath: 'C:/repo-test',
      instruction: 'Escribir algo',
      changeId: 'change-abc',
      taskId: 'task-xyz',
      expectedModel: launchKeyOf('antigravity/gemini-2.5-pro'),
    });
  });

  it('modelo con runtime agy (Antigravity) no está disponible para implementar tareas que requieren pruebas', async () => {
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
        intent="implement-task"
        changeId="change-abc"
        taskId="task-xyz"
        initialInstruction="Implementar con pruebas"
      />,
    );

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toContain('pipeline.launcher.intent.unavailableCommands');

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
      { key: 'pipeline.launcher.unsupportedRuntimeAgy' },
      { key: 'pipeline.launcher.intent.chooseOtherModel' },
      { key: 'pipeline.launcher.intent.unavailableCommands' },
      {
        key: 'pipeline.launcher.confirmWriteAgent',
        vars: { motor: 'Codex', model: 'gpt-5', executor: 'Codex' },
      },
      {
        key: 'pipeline.launcher.confirmWriteAgentNoCommands',
        vars: { motor: 'Antigravity', model: 'gemini-3.8-flash', executor: 'Antigravity' },
      },
      {
        key: 'pipeline.launcher.confirmWriteAgentWithEffort',
        vars: { motor: 'Codex', model: 'gpt-5', effort: 'high', executor: 'Codex' },
      },
      {
        key: 'pipeline.launcher.confirmWriteAgentWithEffortNoCommands',
        vars: { motor: 'Antigravity', model: 'gemini-3.8-flash', effort: 'low', executor: 'Antigravity' },
      },
      { key: 'pipeline.launcher.error.model_mismatch' },
      { key: 'pipeline.launcher.error.no_model' },
      { key: 'pipeline.launcher.error.disabled' },
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
    expect(await screen.findByText('aiUse.pickerAgentExecutor:{"executor":"OpenCode"}')).toBeDefined();
  });

  it('con un modelo de servidor conocido se puede lanzar tras confirmar, y la confirmación nombra modelo, proveedor, variante y OpenCode', async () => {
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'unslothpclocal',
        providerName: 'Unsloth CASA Local',
        modelId: 'unsloth/Qwen3.8-27B-GGUF',
        modelRef: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
        runtime: 'opencode',
        toolsExecutor: 'OpenCode',
        variant: 'high',
        opencodeKnown: true,
        opencodeInstalled: true,
        contextLimit: 110000,
      }),
    });

    render(<PipelineRuntimeLauncher repoPath="C:/repo-test" projection={null} intent="write-artifact" initialInstruction="Hacer tarea" />);

    // Espera a que resuelva la carga y aparezca el checkbox de confirmación
    const checkbox = (await screen.findByRole('checkbox')) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // La confirmación nombra modelo, proveedor, variante y que las herramientas las ejecuta OpenCode
    expect(
      screen.getByText(
        'pipeline.launcher.confirmWriteServerAgentWithVariant:{"model":"unsloth/Qwen3.8-27B-GGUF","provider":"Unsloth CASA Local","variant":"high","executor":"OpenCode"}',
      ),
    ).toBeDefined();

    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);

    // Confirmar habilita el arranque
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(startButton.disabled).toBe(false);

    // Arrancar invoca pipelineRuntime.start con la launchKey exacta
    fireEvent.click(startButton);
    await vi.waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: 'C:/repo-test',
        instruction: 'Hacer tarea',
        expectedModel: launchKeyOf('unslothpclocal/unsloth/Qwen3.8-27B-GGUF', 'high'),
      }),
    );
  });

  it('con contexto chico en OpenCode aparece el aviso de contexto sin bloquear el arranque', async () => {
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'unslothpclocal',
        providerName: 'Unsloth CASA Local',
        modelId: 'unsloth/Qwen3.8-27B-GGUF',
        modelRef: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
        runtime: 'opencode',
        toolsExecutor: 'OpenCode',
        variant: 'low',
        opencodeKnown: true,
        opencodeInstalled: true,
        contextLimit: 8192,
      }),
    });

    render(<PipelineRuntimeLauncher repoPath="C:/repo-test" projection={null} intent="explore" initialInstruction="Explorar" />);

    // Aviso de contexto chico presente
    expect(await screen.findByText('pipeline.launcher.smallContextWarning:{"context":8192}')).toBeDefined();

    // Confirmar y arrancar no está bloqueado
    const checkbox = (await screen.findByRole('checkbox')) as HTMLInputElement;
    fireEvent.click(checkbox);
    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(false);
  });

  it('con modelo de servidor desconocido por OpenCode muestra el motivo y deshabilita Iniciar', async () => {
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'unslothpclocal',
        providerName: 'Unsloth CASA Local',
        modelId: 'unsloth/Qwen3.8-27B-GGUF',
        modelRef: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
        runtime: 'opencode',
        toolsExecutor: 'OpenCode',
        opencodeKnown: false,
        opencodeInstalled: true,
      }),
    });

    render(<PipelineRuntimeLauncher repoPath="C:/repo-test" projection={null} intent="explore" initialInstruction="Explorar" />);

    expect(await screen.findByText('pipeline.launcher.opencodeUnknownModel')).toBeDefined();
    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
  });

  it('con el modelo desconocido o la lista sin contestar hay una salida: volver a preguntar, que repite la consulta', async () => {
    const opencode = (over: Record<string, unknown>) => ({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'unslothpclocal', providerName: 'Unsloth CASA Local', modelId: 'unsloth/Qwen3.8-27B-GGUF',
        modelRef: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF', runtime: 'opencode', toolsExecutor: 'OpenCode', opencodeInstalled: true, ...over,
      }),
    });

    // OpenCode no contestó: no se dice que no conoce el modelo
    aiStatusSpy.mockResolvedValue(opencode({ opencodeListFailed: true }));
    render(<PipelineRuntimeLauncher repoPath="C:/repo-test" projection={null} intent="explore" initialInstruction="Explorar" />);
    expect(await screen.findByText('pipeline.launcher.opencodeListFailed')).toBeDefined();
    expect(screen.queryByText('pipeline.launcher.opencodeUnknownModel')).toBeNull();
    expect((screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement).disabled).toBe(true);

    // Volver a preguntar: el servicio contesta y el modelo se conoce
    const statusCalls = aiStatusSpy.mock.calls.length;
    aiStatusSpy.mockResolvedValue(opencode({ opencodeKnown: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'pipeline.launcher.recheck' })); });
    await vi.waitFor(() => expect(aiStatusSpy.mock.calls.length).toBeGreaterThan(statusCalls));
    await vi.waitFor(() => expect(screen.queryByText('pipeline.launcher.opencodeListFailed')).toBeNull());
    expect(screen.queryByText('pipeline.launcher.opencodeUnknownModel')).toBeNull();
  });

  it('con OpenCode sin instalar muestra el motivo y deshabilita Iniciar', async () => {
    aiStatusSpy.mockResolvedValue({
      success: true,
      data: mockResolvedAgentStatus({
        providerId: 'unslothpclocal',
        providerName: 'Unsloth CASA Local',
        modelId: 'unsloth/Qwen3.8-27B-GGUF',
        modelRef: 'unslothpclocal/unsloth/Qwen3.8-27B-GGUF',
        runtime: 'opencode',
        toolsExecutor: 'OpenCode',
        opencodeKnown: false,
        opencodeInstalled: false,
      }),
    });

    render(<PipelineRuntimeLauncher repoPath="C:/repo-test" projection={null} intent="explore" initialInstruction="Explorar" />);

    expect(await screen.findByText('pipeline.launcher.opencodeNotInstalled')).toBeDefined();
    // Un solo aviso (no se repite con el del motor no lanzable) y con salida: volver a comprobar
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'pipeline.launcher.recheck' })).toBeDefined();
    const startButton = screen.getByRole('button', { name: 'pipeline.launcher.start' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
  });

  it('las cadenas de i18n para OpenCode existen en es, en y zh', () => {
    for (const lang of ['es', 'en', 'zh'] as const) {
      expect(translate('pipeline.launcher.opencodeUnknownModel', lang)).toBeTruthy();
      expect(translate('pipeline.launcher.opencodeNotInstalled', lang)).toBeTruthy();
      expect(translate('pipeline.launcher.smallContextWarning', lang, { context: 8192 })).toContain('8192');
      expect(translate('pipeline.launcher.confirmWriteServerAgent', lang, { model: 'M', provider: 'P', executor: 'E' })).toContain('M');
      expect(translate('pipeline.launcher.confirmWriteServerAgentWithVariant', lang, { model: 'M', provider: 'P', variant: 'V', executor: 'E' })).toContain('V');
      expect(translate('pipeline.launcher.error.opencode_unknown_model', lang)).toBeTruthy();
      expect(translate('pipeline.launcher.error.opencode_not_installed', lang)).toBeTruthy();
      expect(translate('pipeline.launcher.opencodeListFailed', lang)).toBeTruthy();
      expect(translate('pipeline.launcher.error.opencode_list_failed', lang)).toBeTruthy();
      expect(translate('pipeline.launcher.error.invalid_model_identifier', lang)).toBeTruthy();
    }
  });
});
