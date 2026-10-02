// @vitest-environment jsdom
// La línea del modelo de un uso de texto (tarea 4.3 de modelos-en-casa): dice qué
// modelo usa según gitcron.json y, sin modelo, ofrece «usar lo que tenías» con un
// botón; sólo el botón escribe.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/lib/git-store';
import type { AiUseStatus } from '@/types/ai-use';
import { AiUseLine } from '../AiUseLine';

const ORIGINAL_API = (globalThis as { window?: { api?: unknown } }).window?.api;
let onChanged: ((event: { repoPath: string | null }) => void) | null = null;

function mountApi(statuses: AiUseStatus[]) {
  const status = vi.fn();
  for (const s of statuses) status.mockResolvedValueOnce({ success: true, data: s });
  status.mockResolvedValue({ success: true, data: statuses[statuses.length - 1] });
  const adopt = vi.fn().mockResolvedValue({ success: true, data: { written: true, modelRef: 'x' } });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      aiUse: { status, adopt },
      commitAi: { onConfigChanged: (cb: typeof onChanged) => { onChanged = cb; return () => { onChanged = null; }; } },
    },
  });
  return { status, adopt };
}

const unset: AiUseStatus = {
  status: 'unset',
  use: 'gitcron-cartography',
  offer: { modelRef: 'openrouter/deepseek/deepseek-v4-pro', label: 'OpenRouter · deepseek/deepseek-v4-pro', addsProvider: 'openrouter', file: 'C:/Users/ale/.config/gitcron/gitcron.json' },
};
const resolved: AiUseStatus = {
  status: 'resolved',
  use: 'gitcron-cartography',
  providerId: 'openrouter',
  providerName: 'OpenRouter',
  modelId: 'deepseek/deepseek-v4-pro',
  kind: 'openai-compatible',
  destination: 'external-service',
  sourceFile: 'C:/Users/ale/.config/gitcron/gitcron.json',
  modelSource: 'agent',
  available: true,
  unavailableReason: null,
  alternatives: [],
};

beforeEach(() => {
  useGitStore.setState({ language: 'es' });
});

afterEach(() => {
  cleanup();
  onChanged = null;
  if (ORIGINAL_API === undefined) delete (window as { api?: unknown }).api;
  else Object.defineProperty(window, 'api', { configurable: true, value: ORIGINAL_API });
});

describe('AiUseLine', () => {
  it('sin modelo ofrece la elección de antes; mostrar no escribe, el botón sí, y después dice el modelo', async () => {
    const api = mountApi([unset, resolved]);
    render(<AiUseLine use="gitcron-cartography" />);

    expect(await screen.findByText('Este uso no tiene modelo en gitcron.json.')).toBeTruthy();
    expect(screen.getByText(/con el proveedor «openrouter», que el archivo no declara/)).toBeTruthy();
    expect(api.adopt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Usar OpenRouter · deepseek/deepseek-v4-pro' }));
    await waitFor(() => expect(api.adopt).toHaveBeenCalledWith({ use: 'gitcron-cartography', repoPath: null, screenModel: null }));
    expect(await screen.findByText(/Usa deepseek\/deepseek-v4-pro de OpenRouter · servicio externo · según/)).toBeTruthy();
  });

  it('guardar gitcron.json a mano vuelve a preguntar', async () => {
    const api = mountApi([unset, resolved]);
    render(<AiUseLine use="gitcron-cartography" />);
    await screen.findByText('Este uso no tiene modelo en gitcron.json.');
    act(() => onChanged?.({ repoPath: null }));
    expect(await screen.findByText(/Usa deepseek\/deepseek-v4-pro/)).toBeTruthy();
    expect(api.status).toHaveBeenCalledTimes(2);
  });

  it('con selector en la pantalla, dice que se usa el elegido abajo', async () => {
    mountApi([{ status: 'unset', use: 'gitcron-commit', offer: null }]);
    render(<AiUseLine use="gitcron-commit" screenChoice />);
    expect(await screen.findByText(/se usa el elegido abajo, con el proveedor «lmstudio» del archivo/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('en inglés y en chino', async () => {
    mountApi([resolved]);
    useGitStore.setState({ language: 'en' });
    const { unmount } = render(<AiUseLine use="gitcron-cartography" />);
    expect(await screen.findByText(/Uses deepseek\/deepseek-v4-pro from OpenRouter · external service/)).toBeTruthy();
    unmount();
    useGitStore.setState({ language: 'zh' });
    render(<AiUseLine use="gitcron-cartography" />);
    expect(await screen.findByText(/使用 OpenRouter 的 deepseek\/deepseek-v4-pro · 外部服务/)).toBeTruthy();
  });

  it('sin el canal no muestra nada ni escucha', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: { commitAi: { onConfigChanged: vi.fn() } } });
    const { container } = render(<AiUseLine use="gitcron-temporal" />);
    expect(container.textContent).toBe('');
    expect((window as any).api.commitAi.onConfigChanged).not.toHaveBeenCalled();
  });
});
