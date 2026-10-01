// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitDraftLog, CommitDraftLogStatus } from '../CommitDraftLog';
import { DraftingThought } from '../DraftingThought';
import { clearDraftLog, startDraftLog, appendDraftChunks, setDraftLogTiming, finishDraftLog } from '@/lib/commit-draft-log';
import { translate } from '@/lib/i18n';
import { useGitStore } from '@/lib/git-store';

describe('CommitDraftLog — control de copiado de razonamiento', () => {
  const originalClipboard = navigator.clipboard;
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearDraftLog();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });
  });

  afterEach(() => {
    cleanup();
    clearDraftLog();
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it('con razonamiento presente, el control aparece y copia el texto completo', async () => {
    const pensamientoLargo = [
      'Analizando el diff del repositorio...',
      'Línea 1: Se unifica validRepoPath en shared.ts',
      'Línea 2: Se agrega defensa en profundidad en openspec-engine.ts',
      'Conclusión: redactar fix(pipeline): validar repos autorizados',
    ].join('\n');

    startDraftLog('draft-1');
    appendDraftChunks({
      draftId: 'draft-1',
      chunks: [{ kind: 'reasoning', text: pensamientoLargo }],
    });

    render(<CommitDraftLog />);

    const botonCopiar = screen.getByRole('button', { name: /copiar/i });
    expect(botonCopiar).toBeTruthy();

    await act(async () => {
      fireEvent.click(botonCopiar);
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(pensamientoLargo);

    // Estado transitorio de confirmación
    await waitFor(() => {
      expect(screen.getByText(/copiado/i)).toBeTruthy();
    });
  });

  it('sin razonamiento pero con contenido, no se renderiza el botón de razonamiento pero sí el de resultado', async () => {
    const respuestaTexto = 'feat(pipeline): agregar nueva función\n\nCuerpo de la respuesta.';
    startDraftLog('draft-2');
    appendDraftChunks({
      draftId: 'draft-2',
      chunks: [{ kind: 'content', text: respuestaTexto }],
    });

    render(<CommitDraftLog />);

    // El botón de copiar razonamiento NO está
    expect(screen.queryByTitle(/copiar razonamiento/i)).toBeNull();

    // El botón de copiar resultado SÍ está
    const botonCopiarResultado = screen.getByTitle(/copiar resultado/i);
    expect(botonCopiarResultado).toBeTruthy();

    await act(async () => {
      fireEvent.click(botonCopiarResultado);
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(respuestaTexto);

    await waitFor(() => {
      expect(screen.getByText(/copiado/i)).toBeTruthy();
    });
  });

  it('con ambos presentes, ambos controles aparecen y copian su texto respectivo', async () => {
    const pensamiento = 'Pensando en el diff...';
    const respuesta = 'fix(ipc): corregir timeout\n\nDetalles del fix.';

    startDraftLog('draft-3');
    appendDraftChunks({
      draftId: 'draft-3',
      chunks: [
        { kind: 'reasoning', text: pensamiento },
        { kind: 'content', text: respuesta },
      ],
    });

    render(<CommitDraftLog />);

    const botonRazonamiento = screen.getByTitle(/copiar razonamiento/i);
    const botonResultado = screen.getByTitle(/copiar resultado/i);

    expect(botonRazonamiento).toBeTruthy();
    expect(botonResultado).toBeTruthy();

    await act(async () => {
      fireEvent.click(botonResultado);
    });

    expect(writeTextMock).toHaveBeenCalledWith(respuesta);
  });

  it('sin redacción pero con aviso, los controles no se renderizan', () => {
    render(<CommitDraftLog notice="Modelo cargado correctamente" />);
    expect(screen.queryByRole('button', { name: /copiar/i })).toBeNull();
  });

  it('las claves nuevas existen en los tres idiomas (ES, EN, ZH)', () => {
    const languages = ['es', 'en', 'zh'] as const;
    const keys = [
      'pipeline.openspec.prepare.aiLogCopy',
      'pipeline.openspec.prepare.aiLogCopied',
      'pipeline.openspec.prepare.aiLogResultCopy',
      'pipeline.openspec.prepare.aiLogResultCopied',
      'pipeline.openspec.prepare.aiLogElapsed',
      'pipeline.openspec.prepare.aiLogNoTokens',
      'pipeline.openspec.prepare.aiLogTokensInput',
      'pipeline.openspec.prepare.aiLogTokensInputCached',
      'pipeline.openspec.prepare.aiLogTokensOutput',
      'pipeline.openspec.prepare.aiLogTokensOutputAndReasoning',
      'pipeline.openspec.prepare.aiLogTokensReasoning',
    ] as const;

    for (const lang of languages) {
      for (const key of keys) {
        const translation = translate(key, lang);
        expect(translation).toBeTruthy();
        expect(translation).not.toBe(key);
        expect(translation.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('CommitDraftLog — tiempo y tokens (tarea 2.5 / D18)', () => {
  beforeEach(() => {
    clearDraftLog();
    useGitStore.setState({ language: 'es' });
  });

  afterEach(() => {
    cleanup();
    clearDraftLog();
    useGitStore.setState({ language: 'es' });
  });

  it('montaje del panel: conteo completo con caché y razonamiento', () => {
    startDraftLog('draft-complete');
    appendDraftChunks({
      draftId: 'draft-complete',
      chunks: [
        { kind: 'content', text: 'feat(core): nueva funcionalidad' },
        {
          kind: 'done',
          finishReason: 'stop',
          usage: {
            promptTokens: 20847,
            cachedPromptTokens: 8960,
            completionTokens: 7,
            reasoningTokens: 0,
          },
        },
      ],
    });
    setDraftLogTiming('draft-complete', { startedAt: 1000, finishedAt: 15000 });
    finishDraftLog('draft-complete');

    render(<CommitDraftLog draftId="draft-complete" />);

    // «Tardó 14 s» · «20.847 tokens de entrada (8960 en caché)» · «7 de salida, 0 en pensar»
    expect(screen.getByText('Tardó 14 s · 20.847 tokens de entrada (8960 en caché) · 7 de salida, 0 en pensar')).toBeTruthy();
  });

  it('montaje del panel: conteo parcial (sólo entrada y salida, sin pensar: tiene que verse)', () => {
    startDraftLog('draft-partial');
    appendDraftChunks({
      draftId: 'draft-partial',
      chunks: [
        { kind: 'content', text: 'fix(core): corrección' },
        {
          kind: 'done',
          finishReason: 'stop',
          usage: {
            promptTokens: 1234,
            cachedPromptTokens: null,
            completionTokens: 56,
            reasoningTokens: null,
          },
        },
      ],
    });
    setDraftLogTiming('draft-partial', { startedAt: 1000, finishedAt: 15000 });
    finishDraftLog('draft-partial');

    render(<CommitDraftLog draftId="draft-partial" />);

    // Se ve entrada y salida sin pensar
    expect(screen.getByText('Tardó 14 s · 1234 tokens de entrada · 56 de salida')).toBeTruthy();
  });

  it('montaje del panel: conteo ausente («sin conteo de tokens»)', () => {
    startDraftLog('draft-notokens');
    appendDraftChunks({
      draftId: 'draft-notokens',
      chunks: [
        { kind: 'content', text: 'chore: tarea' },
        { kind: 'done', finishReason: 'stop', usage: null },
      ],
    });
    setDraftLogTiming('draft-notokens', { startedAt: 1000, finishedAt: 15000 });
    finishDraftLog('draft-notokens');

    render(<CommitDraftLog draftId="draft-notokens" />);

    // «Tardó 14 s · sin conteo de tokens»
    expect(screen.getByText('Tardó 14 s · sin conteo de tokens')).toBeTruthy();
  });

  it('montaje del panel: sin tiempo (redacción vieja) no muestra la línea', () => {
    startDraftLog('draft-old');
    appendDraftChunks({
      draftId: 'draft-old',
      chunks: [
        { kind: 'content', text: 'feat: viejo' },
        {
          kind: 'done',
          finishReason: 'stop',
          usage: {
            promptTokens: 20847,
            cachedPromptTokens: 8960,
            completionTokens: 7,
            reasoningTokens: 0,
          },
        },
      ],
    });
    // No llamamos a setDraftLogTiming: startedAt y finishedAt quedan en null
    finishDraftLog('draft-old');

    render(<CommitDraftLog draftId="draft-old" />);

    // No debe mostrar la línea de tiempo ni tokens
    expect(screen.queryByText(/Tardó/)).toBeNull();
    expect(screen.queryByText(/entrada/)).toBeNull();
    expect(screen.queryByText(/conteo/)).toBeNull();
  });

  it('montaje del panel: formato de tiempo desde un minuto (98 s → «1 min 38 s»)', () => {
    startDraftLog('draft-minute');
    appendDraftChunks({
      draftId: 'draft-minute',
      chunks: [
        { kind: 'content', text: 'feat: largo' },
        {
          kind: 'done',
          finishReason: 'stop',
          usage: {
            promptTokens: 100,
            cachedPromptTokens: null,
            completionTokens: 20,
            reasoningTokens: null,
          },
        },
      ],
    });
    // 98 segundos de diferencia
    setDraftLogTiming('draft-minute', { startedAt: 1000, finishedAt: 99000 });
    finishDraftLog('draft-minute');

    render(<CommitDraftLog draftId="draft-minute" />);

    expect(screen.getByText('Tardó 1 min 38 s · 100 tokens de entrada · 20 de salida')).toBeTruthy();
  });

  it('montaje del panel: separador de miles según idioma (20847 → «20.847» en es y «20,847» en en)', () => {
    startDraftLog('draft-i18n');
    appendDraftChunks({
      draftId: 'draft-i18n',
      chunks: [
        { kind: 'content', text: 'feat: i18n test' },
        {
          kind: 'done',
          finishReason: 'stop',
          usage: {
            promptTokens: 20847,
            cachedPromptTokens: 8960,
            completionTokens: 7,
            reasoningTokens: 0,
          },
        },
      ],
    });
    setDraftLogTiming('draft-i18n', { startedAt: 1000, finishedAt: 15000 });
    finishDraftLog('draft-i18n');

    // 1. En español: «20.847» y «8960»
    useGitStore.setState({ language: 'es' });
    const { unmount } = render(<CommitDraftLog draftId="draft-i18n" />);
    expect(screen.getByText('Tardó 14 s · 20.847 tokens de entrada (8960 en caché) · 7 de salida, 0 en pensar')).toBeTruthy();
    unmount();

    // 2. En inglés: «20,847» y «8,960»
    useGitStore.setState({ language: 'en' });
    const en = render(<CommitDraftLog draftId="draft-i18n" />);
    expect(screen.getByText('Took 14 s · 20,847 input tokens (8,960 cached) · 7 output, 0 thinking')).toBeTruthy();
    en.unmount();

    // 3. En chino las unidades del tiempo también se traducen: 秒, no «s».
    useGitStore.setState({ language: 'zh' });
    render(<CommitDraftLog draftId="draft-i18n" />);
    expect(screen.getByText('耗时 14 秒 · 20,847 个输入 token（8,960 缓存） · 7 输出，0 思考')).toBeTruthy();
  });
});

describe('CommitDraftLog — la IA tiene su color y brillo al pensar (D20 / tanda 08)', () => {
  beforeEach(() => {
    clearDraftLog();
    useGitStore.setState({ language: 'es' });
  });

  afterEach(() => {
    cleanup();
    clearDraftLog();
  });

  it('mientras redacta, la frase que rota y «en vivo» llevan ai-thinking-text', () => {
    startDraftLog('draft-live');
    appendDraftChunks({
      draftId: 'draft-live',
      chunks: [{ kind: 'reasoning', text: 'Analizando...' }],
    });

    // La frase que rota lleva ai-thinking-text
    const { container: thoughtContainer } = render(<DraftingThought active language="es" />);
    // En un span propio: sobre el <p>, el brillo apagaba el fundido entre frases.
    const thoughtEl = thoughtContainer.querySelector('p > span.ai-thinking-text');
    expect(thoughtEl?.className).toBe('ai-thinking-text');

    // «en vivo» lleva ai-thinking-text
    const { container: statusContainer } = render(<CommitDraftLogStatus draftId="draft-live" />);
    // En un span propio: sobre el <em>, su color violeta tapaba el brillo.
    const statusEm = statusContainer.querySelector('em');
    expect(statusEm?.querySelector('span.ai-thinking-text')?.className).toBe('ai-thinking-text');
    expect(statusEm?.textContent).toBe('en vivo');
  });

  it('al terminar, «terminó» no lleva ai-thinking-text, la respuesta no la lleva y el razonamiento nunca', () => {
    startDraftLog('draft-done');
    appendDraftChunks({
      draftId: 'draft-done',
      chunks: [
        { kind: 'reasoning', text: 'Razonamiento largo que no debe brillar' },
        { kind: 'content', text: 'feat(core): respuesta lista' },
      ],
    });
    finishDraftLog('draft-done');

    // «terminó» va en violeta quieto, sin brillo
    const { container: statusContainer } = render(<CommitDraftLogStatus draftId="draft-done" />);
    const statusEm = statusContainer.querySelector('em');
    expect(statusEm?.querySelector('.ai-thinking-text')).toBeNull();
    expect(statusEm?.textContent).toBe('terminó');

    render(<CommitDraftLog draftId="draft-done" />);

    // El razonamiento nunca lleva ai-thinking-text
    const reasoningText = screen.getByText('Razonamiento largo que no debe brillar');
    expect(reasoningText.classList.contains('ai-thinking-text')).toBe(false);

    // La respuesta no lleva ai-thinking-text
    const answerText = screen.getByText('feat(core): respuesta lista');
    expect(answerText.classList.contains('ai-thinking-text')).toBe(false);
  });

  it('el aviso de autoría ya no usa la clase o el color de advertencia', () => {
    render(
      <CommitDraftLog notice="Lo escribió Gemma 4, no la aplicación. Revisalo antes de confirmar." />,
    );
    const notice = screen.getByText(/Lo escribió Gemma 4/);
    expect(notice).toBeDefined();
    // No usa clases ni nombres de advertencia
    expect(notice.className).not.toMatch(/warning/i);
    expect(notice.className).not.toMatch(/alert/i);
  });
});
