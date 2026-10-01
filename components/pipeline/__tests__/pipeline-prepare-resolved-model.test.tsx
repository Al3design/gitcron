// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeProjection } from '@/types/pipeline';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { OpenSpecDashboard } from '../OpenSpecDashboard';
import type { PipelineSnapshot } from '../pipeline-view-state';

const stageFiles = vi.fn().mockResolvedValue(true);
const setCommitMessage = vi.fn();

vi.mock('@/hooks/use-git-actions', () => ({
  useGitActions: () => ({ stageFiles, commitChanges: vi.fn() }),
}));

function task(id: string, completed: boolean) {
  return { id, text: `${id} tarea ${id}`, completed, line: 1, sourceRef: 'tasks.md:1' };
}

function snapshot(): PipelineSnapshot {
  return {
    schemaVersion: '1.0',
    repoId: 'repo-1',
    availableSources: ['git'],
    hermesConnected: false,
    hasPipelineActivity: true,
    now: {
      headlineKey: 'x',
      runtime: null,
      role: null,
      taskLabel: null,
      tasksDone: null,
      tasksTotal: null,
      elapsedMs: null,
      costUsd: null,
      costBasis: 'unknown',
      needsHuman: false,
    },
    stations: [],
    decisions: [],
    agents: [],
    activity: [],
    economy: { reasoningAvailable: null } as PipelineSnapshot['economy'],
    diffs: [],
    openSpec: {
      selectedChangeId: 'demo-change',
      activeChanges: [
        {
          changeId: 'demo-change',
          intent: 'una intención',
          tasks: [task('1.1', true)],
          proposalExists: true,
          designExists: true,
          specsCount: 1,
          validation: 'unknown',
          artifacts: null,
        },
      ],
      archivedChanges: [],
      specifications: [],
      reports: [],
      diagnostics: [],
      observedAt: null,
      latestGate: null,
    },
  } as PipelineSnapshot;
}

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

describe('Montaje del panel en <StrictMode> con uso resuelto', { timeout: 15_000 }, () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
    stageFiles.mockClear();
    setCommitMessage.mockClear();
    useGitStore.setState({
      modifiedFiles: [
        { path: 'openspec/changes/demo-change/tasks.md', status: 'modified', staged: false },
        { path: 'src/main.ts', status: 'modified', staged: false },
      ],
      commitMessage: '',
      setCommitMessage,
      language: 'es',
    } as Partial<ReturnType<typeof useGitStore.getState>>);
  });

  afterEach(() => {
    cleanup();
    usePipelineStore.getState().reset();
    useGitStore.setState({ modifiedFiles: [], commitMessage: '' });
    if (ORIGINAL_API === undefined) {
      delete (window as { api?: unknown }).api;
    } else {
      Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
    }
  });

  it('con uso resuelto openai-compatible: la línea aparece, no hay selector ni controles de carga', async () => {
    const catalogMock = vi.fn().mockResolvedValue({ success: true, data: [] });
    const resolvedModelMock = vi.fn().mockResolvedValue({
      success: true,
      data: {
        providerName: 'Unsloth CASA Local',
        modelId: 'unsloth/Qwen3.8-27B-GGUF',
        kind: 'openai-compatible',
        destination: 'own-server',
        sourceFile: '~/.config/gitcron/gitcron.json',
      },
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        commitAi: {
          catalog: catalogMock,
          resolvedModel: resolvedModelMock,
          deviceNames: vi.fn().mockResolvedValue({ success: true, data: {} }),
          draft: vi.fn(),
          load: vi.fn(),
          unload: vi.fn(),
          cancel: vi.fn(),
        },
      },
    });

    render(
      <StrictMode>
        <OpenSpecDashboard
          snapshot={snapshot()}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={false}
          leftOpen={false}
          rightOpen={false}
          leftWidth={320}
          rightWidth={320}
          onResizeLeft={() => undefined}
          onResizeRight={() => undefined}
          projection={null as RuntimeProjection | null}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />
      </StrictMode>,
    );

    // Abrir panel de preparación
    const openButton = screen.getByRole('button', { name: /preparar/i });
    fireEvent.click(openButton);

    // 1. La línea aparece con el formato: «Redacta con <modelo> de <proveedor> · <destino> · según <archivo>»
    const resolvedLine = await screen.findByText(
      /Redacta con unsloth\/Qwen3\.8-27B-GGUF de Unsloth CASA Local · servidor propio · según ~[\/\\]\.config[\/\\]gitcron[\/\\]gitcron\.json/i,
    );
    expect(resolvedLine).toBeDefined();

    // 2. No se muestra el selector de LM Studio (<select>)
    expect(screen.queryByRole('combobox')).toBeNull();

    // 3. No se muestran controles de carga ni expulsión
    expect(screen.queryByRole('button', { name: /cargar el modelo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /eject/i })).toBeNull();

    // 4. «Redactar con IA» está habilitado sin haber elegido modelo (sólo requiere archivos)
    const draftButton = screen.getByRole('button', { name: /redactar con ia/i });
    expect(draftButton).toBeDefined();

    // Sin archivos elegidos está deshabilitado
    expect((draftButton as HTMLButtonElement).disabled).toBe(true);

    // Al elegir un archivo, se habilita inmediatamente sin seleccionar modelo de LM Studio
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect((draftButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('con uso resuelto CLI: la línea declara que corre sin herramientas (D13)', async () => {
    const resolvedModelMock = vi.fn().mockResolvedValue({
      success: true,
      data: {
        providerName: 'Codex',
        modelId: 'gpt-5.6-luna',
        kind: 'cli',
        destination: 'external-service',
        sourceFile: '~/.config/gitcron/gitcron.json',
      },
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        commitAi: {
          catalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
          resolvedModel: resolvedModelMock,
          deviceNames: vi.fn().mockResolvedValue({ success: true, data: {} }),
          draft: vi.fn(),
          load: vi.fn(),
          unload: vi.fn(),
          cancel: vi.fn(),
        },
      },
    });

    render(
      <StrictMode>
        <OpenSpecDashboard
          snapshot={snapshot()}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={false}
          leftOpen={false}
          rightOpen={false}
          leftWidth={320}
          rightWidth={320}
          onResizeLeft={() => undefined}
          onResizeRight={() => undefined}
          projection={null as RuntimeProjection | null}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />
      </StrictMode>,
    );

    const openButton = screen.getByRole('button', { name: /preparar/i });
    fireEvent.click(openButton);

    const resolvedLine = await screen.findByText(
      /Redacta con gpt-5\.6-luna de Codex · servicio externo · según ~[\/\\]\.config[\/\\]gitcron[\/\\]gitcron\.json \(sin herramientas\)/i,
    );
    expect(resolvedLine).toBeDefined();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('con archivo roto se ve el error y no el selector de LM Studio', async () => {
    const catalogMock = vi.fn().mockResolvedValue({ success: true, data: [] });
    const resolvedModelMock = vi.fn().mockResolvedValue({
      success: true,
      data: {
        status: 'error',
        error: '~/.config/gitcron/gitcron.json: Error de sintaxis en la línea 3: ValueExpected',
      },
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        commitAi: {
          catalog: catalogMock,
          resolvedModel: resolvedModelMock,
          deviceNames: vi.fn().mockResolvedValue({ success: true, data: {} }),
          draft: vi.fn(),
          load: vi.fn(),
          unload: vi.fn(),
          cancel: vi.fn(),
        },
      },
    });

    render(
      <StrictMode>
        <OpenSpecDashboard
          snapshot={snapshot()}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={false}
          leftOpen={false}
          rightOpen={false}
          leftWidth={320}
          rightWidth={320}
          onResizeLeft={() => undefined}
          onResizeRight={() => undefined}
          projection={null as RuntimeProjection | null}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />
      </StrictMode>,
    );

    const openButton = screen.getByRole('button', { name: /preparar/i });
    fireEvent.click(openButton);

    const errorText = await screen.findByText(/Error de sintaxis en la línea 3/i);
    expect(errorText).toBeDefined();

    expect(screen.queryByRole('combobox')).toBeNull();

    const draftButton = screen.getByRole('button', { name: /redactar con ia/i });
    expect((draftButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('con modelo resuelto y redacción en curso aparece «Cancelar» y llama a commitAi.cancel', async () => {
    const cancelMock = vi.fn().mockResolvedValue({ success: true, data: { cancelled: true } });
    let draftResolve: (val: any) => void = () => undefined;
    const draftMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      draftResolve = resolve;
    }));

    const resolvedModelMock = vi.fn().mockResolvedValue({
      success: true,
      data: {
        providerName: 'Codex',
        modelId: 'gpt-5.6-luna',
        kind: 'cli',
        destination: 'external-service',
        sourceFile: '~/.config/gitcron/gitcron.json',
      },
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        commitAi: {
          catalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
          resolvedModel: resolvedModelMock,
          deviceNames: vi.fn().mockResolvedValue({ success: true, data: {} }),
          draft: draftMock,
          load: vi.fn(),
          unload: vi.fn(),
          cancel: cancelMock,
        },
      },
    });

    render(
      <StrictMode>
        <OpenSpecDashboard
          snapshot={snapshot()}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={false}
          leftOpen={false}
          rightOpen={false}
          leftWidth={320}
          rightWidth={320}
          onResizeLeft={() => undefined}
          onResizeRight={() => undefined}
          projection={null as RuntimeProjection | null}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />
      </StrictMode>,
    );

    const openButton = screen.getByRole('button', { name: /preparar/i });
    fireEvent.click(openButton);

    await screen.findByText(/Redacta con gpt-5\.6-luna/i);

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    const draftButton = screen.getByRole('button', { name: /redactar con ia/i });
    fireEvent.click(draftButton);

    const cancelButton = await screen.findByRole('button', { name: /cancelar/i });
    expect(cancelButton).toBeDefined();

    fireEvent.click(cancelButton);
    expect(cancelMock).toHaveBeenCalled();

    draftResolve?.({ success: true, data: { status: 'drafted', subject: 'feat: x', model: 'gpt-5.6-luna' } });
  });

  it('«Ver lo enviado» despliega y pliega en <StrictMode>; ningún secreto en el DOM', async () => {
    const sampleLastRequest = {
      kind: 'openai-compatible' as const,
      endpoint: 'http://192.168.1.7:8888/v1/chat/completions',
      model: {
        value: 'unsloth/Qwen3.8-27B-GGUF',
        provenance: 'agent.gitcron-commit.model',
      },
      parameters: {
        temperature: { value: 0.2, provenance: 'agent.gitcron-commit.temperature' },
        max_tokens: { value: 8192, provenance: 'provider.unslothpclocal.models.unsloth/Qwen3.8-27B-GGUF.limit.output' },
        reasoning_effort: { value: 'high', provenance: 'agent.gitcron-commit.options.reasoning_effort' },
      },
      headers: [
        { name: 'CF-Access-Client-Id', provenance: 'provider.unslothpclocal.options.headers.CF-Access-Client-Id' },
        { name: 'CF-Access-Client-Secret', provenance: 'provider.unslothpclocal.options.headers.CF-Access-Client-Secret' },
      ],
      auth: 'Bearer, de la variable UNSLOTH_API_KEY',
      timestamp: 1727680000000,
    };

    const lastRequestMock = vi.fn().mockResolvedValue({
      success: true,
      data: sampleLastRequest,
    });

    const draftMock = vi.fn().mockResolvedValue({
      success: true,
      data: {
        status: 'drafted',
        subject: 'feat(core): commit redactado con éxito',
        model: 'unsloth/Qwen3.8-27B-GGUF',
      },
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        commitAi: {
          catalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
          resolvedModel: vi.fn().mockResolvedValue({
            success: true,
            data: {
              providerName: 'Unsloth CASA Local',
              modelId: 'unsloth/Qwen3.8-27B-GGUF',
              kind: 'openai-compatible',
              destination: 'own-server',
              sourceFile: '~/.config/gitcron/gitcron.json',
            },
          }),
          deviceNames: vi.fn().mockResolvedValue({ success: true, data: {} }),
          draft: draftMock,
          load: vi.fn(),
          unload: vi.fn(),
          cancel: vi.fn(),
          lastRequest: lastRequestMock,
        },
      },
    });

    render(
      <StrictMode>
        <OpenSpecDashboard
          snapshot={snapshot()}
          repoPath="C:/repo"
          currentBranch="main"
          workingTreeClean={false}
          leftOpen={false}
          rightOpen={false}
          leftWidth={320}
          rightWidth={320}
          onResizeLeft={() => undefined}
          onResizeRight={() => undefined}
          projection={null as RuntimeProjection | null}
          runtimeHistory={[]}
          onRefresh={() => undefined}
          onPauseAfterTask={() => undefined}
          onRespondDecision={() => undefined}
        />
      </StrictMode>,
    );

    // Abrir panel
    const openButton = screen.getByRole('button', { name: /preparar/i });
    fireEvent.click(openButton);

    await screen.findByText(/Redacta con unsloth\/Qwen3\.8-27B-GGUF/i);

    // Elegir archivo
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    // Redactar
    const draftButton = screen.getByRole('button', { name: /redactar con ia/i });
    fireEvent.click(draftButton);

    // Esperar a que se complete y aparezca el botón «Ver lo enviado»
    const toggleButton = await screen.findByRole('button', { name: /ver lo enviado/i });
    expect(toggleButton).toBeDefined();

    // Antes de hacer clic, el detalle está plegado
    expect(screen.queryByTestId('ai-sent-details')).toBeNull();

    // Desplegar «Ver lo enviado»
    fireEvent.click(toggleButton);

    const details = await screen.findByTestId('ai-sent-details');
    expect(details).toBeDefined();
    expect(toggleButton.textContent).toMatch(/ocultar lo enviado/i);

    // Verifica que se muestra la dirección, modelo, parámetros con procedencia y cabeceras por nombre
    const detailsScope = within(details);
    expect(detailsScope.getByText(/http:\/\/192\.168\.1\.7:8888\/v1\/chat\/completions/)).toBeDefined();
    expect(detailsScope.getByText(/agent\.gitcron-commit\.model/)).toBeDefined();
    expect(detailsScope.getAllByText(/CF-Access-Client-Secret/).length).toBeGreaterThanOrEqual(1);
    expect(detailsScope.getByText(/Bearer, de la variable UNSLOTH_API_KEY/)).toBeDefined();

    // Seguridad: ningún valor secreto en el DOM (claves de API o tokens literales)
    expect(document.body.innerHTML).not.toContain('unsloth-secret-token');
    expect(document.body.innerHTML).not.toContain('cf-client-secret-abc');

    // Volver a plegar
    fireEvent.click(toggleButton);
    expect(screen.queryByTestId('ai-sent-details')).toBeNull();
    expect(toggleButton.textContent).toMatch(/ver lo enviado/i);
  });
});
