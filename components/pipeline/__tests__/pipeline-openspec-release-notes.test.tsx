// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenSpecReleaseNotes } from '../OpenSpecReleaseNotes';
import type { OpenSpecVersionAnalysisResult } from '@/types/pipeline';
import { useGitStore } from '@/lib/git-store';
import { rememberAiModel, rememberAiSettings } from '@/lib/ai-model-memory';
import styles from '../OpenSpecDashboard.module.css';

describe('OpenSpecReleaseNotes', () => {
  let mockShellOpenExternal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useGitStore.setState({ language: 'es' });
    mockShellOpenExternal = vi.fn();
    (window as unknown as { api: unknown }).api = {
      shellOpenExternal: mockShellOpenExternal,
      aiUse: {
        status: vi.fn().mockResolvedValue({
          success: true,
          data: {
            status: 'unset',
            use: 'gitcron-openspec-analysis',
            available: true,
            canLoad: true,
            source: 'none',
          },
        }),
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { api?: unknown }).api;
    vi.restoreAllMocks();
  });

  it('muestra estado de carga cuando loading es true', () => {
    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={null}
        loading={true}
        error={null}
      />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Qué trae la v1.13.0' })).toBeTruthy();
    expect(screen.getByText('Buscando las notas de la versión…')).toBeTruthy();
  });

  it('muestra changelog obtenido con viñetas, botón para ver notas completas y veredicto compatible', () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: 'https://github.com/fission-ai/openspec/releases/tag/v1.13.0',
          fetched: true,
          rawText: `## What's New in v1.13.0

Actualizaciones importantes en el motor.

### Cambios
- **Comando status** - ahora incluye diagnósticos
- **Instrucciones** - formato simplificado`,
          error: null,
        },
        consumedSurfaces: [
          { surface: 'status', description: 'Status checks', verdict: 'compatible', evidence: 'sin cambios' },
        ],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'lmstudio:local-model',
        status: 'offline',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Qué trae la v1.13.0' })).toBeTruthy();
    expect(screen.getByText('Actualizaciones importantes en el motor.')).toBeTruthy();
    expect(screen.getByText('Comando status — ahora incluye diagnósticos')).toBeTruthy();
    expect(screen.getByText('Instrucciones — formato simplificado')).toBeTruthy();
    expect(screen.getByText('No toca lo que GitCron usa')).toBeTruthy();
    expect(screen.getByText('Fuente: GitHub Releases (fission-ai/openspec)')).toBeTruthy();

    const viewFullBtn = screen.getByRole('button', { name: /Ver las notas completas/i });
    expect(viewFullBtn).toBeTruthy();
    fireEvent.click(viewFullBtn);
    expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com/fission-ai/openspec/releases/tag/v1.13.0');
  });

  it('muestra alerta cuando se detectan breaking changes en superficies consumidas', () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: 'https://github.com/fission-ai/openspec/releases/tag/v1.13.0',
          fetched: true,
          rawText: `## What's New in v1.13.0\n\nCambio mayor.\n\n- Flag deprecada`,
          error: null,
        },
        consumedSurfaces: [
          { surface: 'status', description: 'Status output', verdict: 'breaking', evidence: 'flags removed' },
          { surface: 'instructions', description: 'Instruction template', verdict: 'potential-break', evidence: 'format changed' },
          { surface: 'archive', description: 'Archive command', verdict: 'compatible', evidence: 'unchanged' },
        ],
        breakingChangesDetected: true,
        strategyProposal: null,
      },
      redaction: {
        provider: 'lmstudio:local-model',
        status: 'offline',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Puede afectar a lo que GitCron usa: status, instructions');
  });

  it('muestra motivo de no disponibilidad cuando fetched es false', () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'unavailable',
          sourceUrl: 'https://github.com/fission-ai/openspec/releases/tag/v1.13.0',
          fetched: false,
          rawText: null,
          error: 'HTTP 404',
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'lmstudio:local-model',
        status: 'offline',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByText(/No se pudieron leer las notas de la versión\.\s*HTTP 404/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ver las notas completas/i })).toBeTruthy();
  });

  it('muestra texto redactado y proveedor cuando status es generated', () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: null,
          fetched: true,
          rawText: `## v1.13.0\n\nNotas.`,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'LM Studio · qwen2.5-coder-7b',
        status: 'generated',
        text: `## Qué hay de nuevo\nNotas del release.\n\n## Qué hace de hecho\nComportamiento medido.\n\n## Cómo afecta a GitCron\nSin impacto.\n\n## Cómo encararlo\nActualización sugerida.`,
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByRole('heading', { name: /Qué hay de nuevo/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Qué hace de hecho/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Cómo afecta a GitCron/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Cómo encararlo/i })).toBeTruthy();
    expect(screen.getByText('Explicación redactada por LM Studio · qwen2.5-coder-7b')).toBeTruthy();
  });

  it('no muestra atribución de redacción cuando status es offline', () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: null,
          fetched: true,
          rawText: `## v1.13.0\n\nNotas.`,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'LM Studio · qwen2.5-coder-7b',
        status: 'offline',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    expect(screen.queryByText(/redactada/i)).toBeNull();
  });

  it('muestra mensaje declarando que el informe no está disponible cuando el estado es offline', () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases (fission-ai/openspec)',
          sourceUrl: null,
          fetched: true,
          rawText: `## v1.13.0\n\nNotas.`,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'LM Studio · qwen2.5-coder-7b',
        status: 'offline',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    expect(
      screen.getByText('Informe asistido no disponible: el modelo local está apagado o no respondió.')
    ).toBeTruthy();
  });

  it('deshabilita el botón con motivo «Elegí un modelo» cuando no hay modelo elegido', () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'unavailable',
          sourceUrl: null,
          fetched: false,
          rawText: null,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: '',
        status: 'idle',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
        repoPath="/test/repo-no-model"
      />
    );

    const btn = screen.getByRole('button', { name: 'Redactar informe' });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Elegí un modelo');
  });

  it('muestra el mensaje del servidor cuando status es error', () => {
    const serverError = '400 {"error":{"message":"No models loaded in LM Studio"}}';
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'unavailable',
          sourceUrl: null,
          fetched: false,
          rawText: null,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'LM Studio · qwen2.5-coder-7b',
        status: 'error',
        text: '',
        error: serverError,
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByText(serverError)).toBeTruthy();
  });

  it('con modelo cargado permite redactar llamando a onRedact', async () => {
    const onRedact = vi.fn().mockResolvedValue(undefined);
    (window as any).api.commitAi = {
      catalog: vi.fn().mockResolvedValue({
        data: [{ id: 'qwen2.5-coder-7b', kind: 'llm', loaded: true, loadedContextLength: 32768 }],
      }),
      deviceNames: vi.fn().mockResolvedValue({ data: {} }),
      load: vi.fn().mockResolvedValue({ success: true }),
    };

    rememberAiModel('/test/repo-loaded', 'qwen2.5-coder-7b');

    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'unavailable',
          sourceUrl: null,
          fetched: false,
          rawText: null,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: '',
        status: 'idle',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
        repoPath="/test/repo-loaded"
        onRedact={onRedact}
      />
    );

    const btn = await screen.findByRole('button', { name: 'Redactar informe' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(onRedact).toHaveBeenCalledWith('qwen2.5-coder-7b');
  });

  it('muestra botón Cancelar habilitado y AiElapsed cuando redacting es true, y llama a onCancelRedact al click', async () => {
    const onCancelRedact = vi.fn();
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'unavailable',
          sourceUrl: null,
          fetched: false,
          rawText: null,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'LM Studio · qwen2.5-coder-7b',
        status: 'idle',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
        repoPath="/test/repo-loaded"
        redacting={true}
        startedAt={Date.now() - 2000}
        onCancelRedact={onCancelRedact}
      />
    );

    const cancelBtn = await screen.findByRole('button', { name: 'Cancelar' });
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cancelBtn);
    expect(onCancelRedact).toHaveBeenCalledTimes(1);

    // AiElapsed se dibuja con contador de redacción
    expect(screen.getByText(/Redactando/)).toBeTruthy();
  });

  it('renderiza MarkdownViewer con el texto parcial mientras redacting es true', async () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'unavailable',
          sourceUrl: null,
          fetched: false,
          rawText: null,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'LM Studio · qwen2.5-coder-7b',
        status: 'idle',
        text: '',
      },
    };

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
        repoPath="/test/repo-loaded"
        redacting={true}
        startedAt={Date.now()}
        partialText="## Avance del informe en tiempo real"
      />
    );

    expect(await screen.findByRole('heading', { name: 'Avance del informe en tiempo real' })).toBeTruthy();
  });

  it('integra AiModelControls mostrando inputs de contexto y ttl, deshabilitados con modelo cargado, y lista de hechos aiFacts', async () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'unavailable',
          sourceUrl: null,
          fetched: false,
          rawText: null,
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'LM Studio · loaded-model',
        status: 'idle',
        text: '',
      },
    };

    (window as unknown as { api: unknown }).api = {
      ...((window as unknown as { api: unknown }).api as any),
      commitAi: {
        catalog: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'loaded-model',
              name: 'Loaded Model',
              kind: 'llm',
              loaded: true,
              loadedContextLength: 65536,
              devices: [],
            },
          ],
        }),
      },
    };

    rememberAiSettings('/test/repo-controls', { model: 'loaded-model' });

    render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
        repoPath="/test/repo-controls"
      />
    );

    const contextInput = (await screen.findByLabelText(/contexto/i)) as HTMLInputElement;
    const ttlInput = screen.getByLabelText(/se cierra a los/i) as HTMLInputElement;

    expect(contextInput).toBeTruthy();
    expect(ttlInput).toBeTruthy();
    expect(contextInput.disabled).toBe(true);
    expect(ttlInput.disabled).toBe(true);

    // Renderiza aiFacts y estado del modelo
    expect(screen.getByText('modelo cargado')).toBeTruthy();
    expect(screen.getByText('cargado, 65536 de contexto')).toBeTruthy();

    // Botón expulsar presente
    expect(screen.getByRole('button', { name: 'Eject' })).toBeTruthy();
  });

  it('envuelve el borrador streaming en releaseNotesReportBox con data-state="streaming"', () => {
    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases',
          sourceUrl: null,
          fetched: true,
          rawText: '## v1.13.0',
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'lmstudio:test-model',
        status: 'idle',
        text: '',
      },
    };

    const { container } = render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
        redacting={true}
        partialText="Redactando la primera línea del informe..."
      />
    );

    const reportBox = container.querySelector('[data-state="streaming"]');
    expect(reportBox).toBeTruthy();
    expect(screen.getByText('Redactando la primera línea del informe...')).toBeTruthy();
  });

  it('permite desplegar y colapsar informe largo generado con botón Ver más / Ver menos', () => {
    const longReport = [
      'Línea 1: Se actualizó el CLI con mejoras sustanciales.',
      'Línea 2: Se verificaron las superficies de integración y compatibilidad.',
      'Línea 3: Los diagnósticos de doctor y context ahora operan en formato JSON estructurado.',
      'Línea 4: No se detectaron breaking changes que afecten el flujo de trabajo.',
    ].join('\n');

    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases',
          sourceUrl: null,
          fetched: true,
          rawText: '## v1.13.0',
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'lmstudio:test-model',
        status: 'generated',
        text: longReport,
      },
    };

    const { container } = render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    const reportBox = container.querySelector(`.${styles.releaseNotesReportBox}`);
    expect(reportBox).toBeTruthy();
    expect(reportBox?.getAttribute('data-state')).toBe('collapsed');

    const toggleBtn = screen.getByRole('button', { name: /ver más/i });
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

    // Click para desplegar
    fireEvent.click(toggleBtn);
    expect(reportBox?.getAttribute('data-state')).toBe('expanded');
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /ver menos/i })).toBeTruthy();

    // Click para colapsar
    fireEvent.click(screen.getByRole('button', { name: /ver menos/i }));
    expect(reportBox?.getAttribute('data-state')).toBe('collapsed');
    expect(screen.getByRole('button', { name: /ver más/i })).toBeTruthy();
  });

  it('no muestra el botón de alternar cuando el informe generado es corto', () => {
    const shortReport = 'Breve resumen de una línea.';

    const analysis: OpenSpecVersionAnalysisResult = {
      measured: {
        installedVersion: '1.11.0',
        availableVersion: '1.13.0',
        isUpgradeAvailable: true,
        versionClass: 'supported',
        behindCycle: false,
        targetVersion: '1.13.0',
        supportedRange: { min: '1.5.0' },
        changelog: {
          source: 'GitHub Releases',
          sourceUrl: null,
          fetched: true,
          rawText: '## v1.13.0',
          error: null,
        },
        consumedSurfaces: [],
        breakingChangesDetected: false,
        strategyProposal: null,
      },
      redaction: {
        provider: 'lmstudio:test-model',
        status: 'generated',
        text: shortReport,
      },
    };

    const { container } = render(
      <OpenSpecReleaseNotes
        latest="1.13.0"
        analysis={analysis}
        loading={false}
        error={null}
      />
    );

    const reportBox = container.querySelector(`.${styles.releaseNotesReportBox}`);
    expect(reportBox).toBeTruthy();
    expect(reportBox?.getAttribute('data-state')).toBe('collapsed');

    expect(screen.queryByRole('button', { name: /ver más/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /ver menos/i })).toBeNull();
  });
});
