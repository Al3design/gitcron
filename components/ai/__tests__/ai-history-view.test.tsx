// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import { AiHistoryView } from '../AiHistoryView';
import type { AiUseHistoryDetail, AiUseHistoryItem } from '@/types/electron';

const mockItem: AiUseHistoryItem = {
  id: 'record-1',
  repoPath: 'C:/repo-test',
  branch: 'main',
  deviceId: '4f814c48-0000-4000-8000-000000000001',
  deviceLabel: 'machine-alpha',
  use: 'gitcron-commit',
  startedAt: '2026-10-02T12:00:00.000Z',
  endedAt: '2026-10-02T12:00:02.500Z',
  durationMs: 2500,
  family: 'openai-compatible',
  providerId: 'lmstudio',
  providerName: 'LM Studio',
  modelId: 'qwen-2.5',
  reasoningEffort: 'low',
  variant: null,
  resultStatus: 'generated',
  resultText: 'feat: add ai use history',
  promptTokens: 120,
  cachedPromptTokens: 20,
  completionTokens: 45,
  reasoningTokens: 10,
  commitHash: 'a1b2c3d4e5f6',
  commitEdited: true,
  promptSentBytes: 1540,
  createdAt: '2026-10-02T12:00:02.500Z',
};

const mockDetail: AiUseHistoryDetail = {
  ...mockItem,
  effectiveRequest: {
    kind: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: { value: 'qwen-2.5', provenance: 'agent.gitcron-commit.model' },
    parameters: {
      temperature: { value: 0.2, provenance: 'default' },
    },
    headers: [],
    auth: 'Bearer [oculto]',
    timestamp: 1775000000000,
  },
  promptSent: 'Full prompt content with git diff and instructions...',
};

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;

describe('AiHistoryView Component', () => {
  let listMock: ReturnType<typeof vi.fn>;
  let getMock: ReturnType<typeof vi.fn>;
  let clearMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useGitStore.setState({ language: 'es' });

    listMock = vi.fn().mockResolvedValue({
      success: true,
      data: {
        items: [mockItem],
        total: 1,
      },
    });

    getMock = vi.fn().mockResolvedValue({
      success: true,
      data: mockDetail,
    });

    clearMock = vi.fn().mockResolvedValue({
      success: true,
      data: { cleared: 1 },
    });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        aiUseHistory: {
          list: listMock,
          get: getMock,
          clear: clearMock,
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
    else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
  });

  it('renders history view, shows item metadata and loads details upon expansion', async () => {
    render(<AiHistoryView repoPath="C:/repo-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('ai-history-item')).toBeTruthy();
    });

    expect(screen.getByTestId('ai-history-view')).toBeTruthy();
    expect(screen.getByText(/Historial de IA/)).toBeTruthy();

    const itemEl = screen.getByTestId('ai-history-item');
    expect(within(itemEl).getByText(/Redacción del commit/)).toBeTruthy();
    expect(within(itemEl).getByText(/LM Studio/)).toBeTruthy();
    expect(within(itemEl).getByText(/Generado/)).toBeTruthy();
    // La máquina se nombra por su nombre, no por su identificador.
    expect(within(itemEl).getByText(/machine-alpha/)).toBeTruthy();
    expect(within(itemEl).queryByText(/4f814c48-0000/)).toBeNull();
    expect(within(itemEl).getByText(/2\.5 s/)).toBeTruthy();
    expect(within(itemEl).getByText(/a1b2c3d/)).toBeTruthy();
    expect(within(itemEl).getByText(/editado/)).toBeTruthy();

    // Expand the item
    const toggleButton = within(itemEl).getByRole('button');
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith({ repoPath: 'C:/repo-test', id: 'record-1' });
      expect(screen.getByText('feat: add ai use history')).toBeTruthy();
      expect(screen.getByText('Ver lo enviado (1.5 KB)')).toBeTruthy();
    });

    // Prompt content is folded by default
    expect(screen.queryByText('Full prompt content with git diff and instructions...')).toBeNull();

    // Click to unfold prompt
    const unfoldBtn = screen.getByText('Ver lo enviado (1.5 KB)');
    fireEvent.click(unfoldBtn);

    expect(screen.getByText('Full prompt content with git diff and instructions...')).toBeTruthy();
  });

  it('handles filtering by use and status', async () => {
    render(<AiHistoryView repoPath="C:/repo-test" />);

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath: 'C:/repo-test',
          use: undefined,
          resultStatus: undefined,
        }),
      );
    });

    // Change use filter
    const useSelect = screen.getByTestId('ai-history-filter-use');
    fireEvent.change(useSelect, { target: { value: 'gitcron-cartography' } });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath: 'C:/repo-test',
          use: 'gitcron-cartography',
        }),
      );
    });

    // Change status filter
    const statusSelect = screen.getByTestId('ai-history-filter-status');
    fireEvent.change(statusSelect, { target: { value: 'failed' } });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath: 'C:/repo-test',
          resultStatus: 'failed',
        }),
      );
    });
  });

  it('opens confirmation dialog and clears history on confirm', async () => {
    render(<AiHistoryView repoPath="C:/repo-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('ai-history-clear-btn')).toBeTruthy();
    });

    const clearBtn = screen.getByTestId('ai-history-clear-btn');
    fireEvent.click(clearBtn);

    // Dialog is visible
    expect(screen.getByText('¿Vaciar el historial de IA?')).toBeTruthy();

    const confirmBtn = screen.getByRole('button', { name: 'Vaciar historial de este repositorio' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(clearMock).toHaveBeenCalledWith({ repoPath: 'C:/repo-test' });
      expect(screen.getByText('No hay registros de uso de IA en este repositorio.')).toBeTruthy();
    });
  });

  it('supports multilingual text in es, en, and zh', async () => {
    // 1. English
    useGitStore.setState({ language: 'en' });
    const { unmount: unmountEn } = render(<AiHistoryView repoPath="C:/repo-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('ai-history-item')).toBeTruthy();
    });

    expect(screen.getByText(/AI History/)).toBeTruthy();
    expect(screen.getByText('Clear history')).toBeTruthy();
    const itemEn = screen.getByTestId('ai-history-item');
    expect(within(itemEn).getByText('Commit drafting')).toBeTruthy();
    expect(within(itemEn).getByText('Generated')).toBeTruthy();
    unmountEn();

    // 2. Chinese
    useGitStore.setState({ language: 'zh' });
    render(<AiHistoryView repoPath="C:/repo-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('ai-history-item')).toBeTruthy();
    });

    expect(screen.getByText(/AI 历史/)).toBeTruthy();
    expect(screen.getByText('清空历史')).toBeTruthy();
    const itemZh = screen.getByTestId('ai-history-item');
    expect(within(itemZh).getByText('提交信息起草')).toBeTruthy();
    expect(within(itemZh).getByText('已生成')).toBeTruthy();
  });
});
