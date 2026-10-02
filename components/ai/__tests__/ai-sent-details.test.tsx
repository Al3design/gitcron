// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import type { CommitAiLastRequest } from '@/types/commit-message-ai';
import { AiSentDetails } from '../AiSentDetails';

const sampleRequest: CommitAiLastRequest = {
  kind: 'openai-compatible',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  model: {
    value: 'anthropic/claude-sonnet-4.5',
    provenance: 'agent.gitcron-commit.model',
  },
  headers: [
    { name: 'Authorization', provenance: 'environment (OPENROUTER_API_KEY)' },
    { name: 'HTTP-Referer', provenance: 'default' },
  ],
  parameters: {
    temperature: { value: 0.2, provenance: 'default' },
    max_tokens: { value: 400, provenance: 'default' },
  },
  timestamp: 1775000000000,
};

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

beforeEach(() => {
  useGitStore.setState({ language: 'es' });
});

afterEach(() => {
  cleanup();
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('AiSentDetails', () => {
  it('no muestra nada si no hay pedido y no está ocupado', () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: { lastRequest: vi.fn().mockResolvedValue({ success: true, data: null }) },
      },
    });

    const { container } = render(<AiSentDetails use="gitcron-cartography" />);
    expect(container.textContent).toBe('');
  });

  it('muestra el pedido provisto por props y permite desplegarlo', async () => {
    render(<AiSentDetails request={sampleRequest} />);

    expect(screen.queryByTestId('ai-sent-details')).toBeNull();

    const summary = screen.getByText('Ver lo enviado');
    expect(summary).toBeTruthy();

    // Click to expand
    fireEvent.click(summary);

    const details = screen.getByTestId('ai-sent-details');
    expect(details).toBeTruthy();

    expect(screen.getByText('https://openrouter.ai/api/v1/chat/completions')).toBeTruthy();
    expect(screen.getByText(/anthropic\/claude-sonnet-4.5/)).toBeTruthy();
    expect(screen.getByText('Cabeceras:')).toBeTruthy();
    expect(screen.getByText('Parámetros:')).toBeTruthy();
  });

  it('consulta lastRequest por IPC cuando se le pasa use', async () => {
    const lastRequestMock = vi.fn().mockResolvedValue({ success: true, data: sampleRequest });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUse: { lastRequest: lastRequestMock },
      },
    });

    render(<AiSentDetails use="gitcron-temporal" />);

    await waitFor(() => {
      expect(lastRequestMock).toHaveBeenCalledWith({ use: 'gitcron-temporal' });
    });

    expect(await screen.findByText('Ver lo enviado')).toBeTruthy();
  });

  it('muestra el texto de brillo ai-thinking-text en un span propio cuando busy es true', () => {
    render(<AiSentDetails use="gitcron-commit" busy={true} />);

    const sendingSpan = screen.getByText('Enviando…');
    expect(sendingSpan.classList.contains('ai-thinking-text')).toBe(true);
  });

  it('soporta inglés y chino', async () => {
    useGitStore.setState({ language: 'en' });
    const { unmount } = render(<AiSentDetails request={sampleRequest} />);
    expect(screen.getByText('View sent request')).toBeTruthy();
    unmount();

    useGitStore.setState({ language: 'zh' });
    render(<AiSentDetails request={sampleRequest} />);
    expect(screen.getByText('查看已发送内容')).toBeTruthy();
  });

  it('un uso con CLI y nivel muestra el argumento del nivel en «Ver lo enviado»', async () => {
    const cliRequest: CommitAiLastRequest = {
      kind: 'cli',
      endpoint: 'codex exec --model gpt-5.6-sol -c model_reasoning_effort=ultra --json',
      model: {
        value: 'gpt-5.6-sol',
        provenance: 'agent.gitcron-commit.model',
      },
      headers: [],
      parameters: {
        command: {
          value: 'codex exec --model gpt-5.6-sol -c model_reasoning_effort=ultra --json',
          provenance: 'cli',
        },
        effort: {
          value: 'ultra',
          provenance: 'agent.gitcron-commit.options.reasoning_effort',
        },
      },
      timestamp: 1775000000000,
    };

    render(<AiSentDetails request={cliRequest} />);
    const summary = screen.getByText('Ver lo enviado');
    fireEvent.click(summary);

    const details = screen.getByTestId('ai-sent-details');
    expect(details.textContent).toContain('-c model_reasoning_effort=ultra');
    expect(details.textContent).toContain('ultra');
  });
});
