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
  sourceDir: 'C:/Users/ale/.config/gitcron',
  modelSource: 'agent',
  isException: false,
  available: true,
  unavailableReason: null,
  alternatives: [],
  canLoad: false,
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
    mountApi([{ status: 'unset', use: 'gitcron-commit', offer: null, canLoad: true }]);
    render(<AiUseLine use="gitcron-commit" screenChoice />);
    expect(await screen.findByText(/se usa el elegido abajo, con el proveedor «lmstudio» del archivo/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sin servidor que cargue modelos no promete un selector que no está: dice qué escribir', async () => {
    mountApi([{ status: 'unset', use: 'gitcron-commit', offer: null, canLoad: false }]);
    render(<AiUseLine use="gitcron-commit" screenChoice />);
    expect(await screen.findByText('Este uso no tiene modelo en gitcron.json.')).toBeTruthy();
    expect(screen.getByText(/Escribí agent.gitcron-commit.model/)).toBeTruthy();
    expect(screen.queryByText(/se usa el elegido abajo/)).toBeNull();
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

  it('con destino externo muestra aviso de salida de la máquina y sin herramientas; con esta máquina no', async () => {
    // Destino externo
    mountApi([resolved]);
    const { unmount } = render(<AiUseLine use="gitcron-cartography" />);
    expect(await screen.findByText('Lo que se pida sale de esta máquina hacia OpenRouter.')).toBeTruthy();
    expect(screen.getByText(/se corre sin herramientas: no toca el repositorio/)).toBeTruthy();
    unmount();

    // Destino this-machine
    const localResolved: AiUseStatus = {
      ...resolved,
      destination: 'this-machine' as const,
      providerId: 'lmstudio',
      providerName: 'LM Studio',
    };
    mountApi([localResolved]);
    render(<AiUseLine use="gitcron-cartography" />);
    expect(await screen.findByText(/esta máquina/)).toBeTruthy();
    expect(screen.queryByText('Lo que se pida sale de esta máquina hacia OpenRouter.')).toBeNull();
    expect(screen.getByText(/se corre sin herramientas: no toca el repositorio/)).toBeTruthy();
  });

  it('«Mostrar en la carpeta» llama a shellOpenPath con la carpeta del archivo y no escribe nada', async () => {
    const shellOpenPath = vi.fn();
    const api = mountApi([{
      ...resolved,
      sourceDir: 'C:/Users/ale/.config/gitcron',
      isException: true,
    }]);
    (window as any).api.shellOpenPath = shellOpenPath;

    render(<AiUseLine use="gitcron-cartography" />);

    expect(await screen.findByText(/\(la excepción de este uso\)/)).toBeTruthy();
    const folderBtn = screen.getByRole('button', { name: 'Mostrar en la carpeta' });
    expect(folderBtn).toBeTruthy();

    fireEvent.click(folderBtn);
    expect(shellOpenPath).toHaveBeenCalledWith('C:/Users/ale/.config/gitcron');
    expect(api.adopt).not.toHaveBeenCalled();
  });

  it('nombra proveedores alternativos cuando el elegido no está disponible', async () => {
    mountApi([{
      ...resolved,
      available: false,
      unavailableReason: 'LM Studio no está corriendo en http://127.0.0.1:1234',
      alternatives: [
        { providerId: 'ollama', providerName: 'Ollama', destination: 'this-machine' as const },
        { providerId: 'openrouter', providerName: 'OpenRouter', destination: 'external-service' as const },
      ],
    }]);

    render(<AiUseLine use="gitcron-cartography" />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/LM Studio no está corriendo/)).toBeTruthy();
    expect(screen.getByText(/declaran los mismos modelos/)).toBeTruthy();
  });

  it('sin el canal no muestra nada ni escucha', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: { commitAi: { onConfigChanged: vi.fn() } } });
    const { container } = render(<AiUseLine use="gitcron-temporal" />);
    expect(container.textContent).toBe('');
    expect((window as any).api.commitAi.onConfigChanged).not.toHaveBeenCalled();
  });

  it('prop showChooseModel=false oculta el botón Elegir modelo propio de la línea', async () => {
    mountApi([resolved]);
    render(<AiUseLine use="gitcron-cartography" showChooseModel={false} />);
    expect(await screen.findByText(/Usa deepseek\/deepseek-v4-pro de OpenRouter/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Elegir modelo' })).toBeNull();
  });
});
