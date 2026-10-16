// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useGitStore } from '@/lib/git-store';
import { ResumeNarration } from '../ResumeNarration';
import type { ResumeNarrationArgs, ResumeNarrationResult } from '@/types/resume-narration';

describe('ResumeNarration UI (Tarea 3.3)', () => {
  const sampleArgs: ResumeNarrationArgs = {
    repoPath: '/repo/test',
    changeId: 'mi-cambio',
    archivedAt: null,
    language: 'es',
  };

  const sampleSuccessResult: ResumeNarrationResult = {
    status: 'narrated',
    data: {
      paragraphs: [
        {
          text: 'Este cambio implementa la explicación opcional del resumen.',
          sourceIds: ['proposal', 'tasks'],
        },
      ],
      sources: [
        { id: 'proposal', ref: 'openspec/changes/mi-cambio/proposal.md' },
        { id: 'tasks', ref: 'openspec/changes/mi-cambio/tasks.md' },
        { id: 'head', ref: 'HEAD:1234567' },
      ],
      fingerprint: 'abcd1234abcd1234',
      createdAt: '2026-10-15T12:00:00.000Z',
      providerName: 'LM Studio',
      modelId: 'qwen-2.5-coder',
    },
  };

  beforeEach(() => {
    useGitStore.setState({ error: null, language: 'es' });
    (window as unknown as { api?: unknown }).api = {
      assistConversations: {
        narrateResume: vi.fn(),
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { api?: unknown }).api;
  });

  it('montar no llama a narrateResume', () => {
    const mockNarrate = vi.fn();
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-1"
        disabled={false}
      />,
    );

    expect(screen.getByTestId('request-resume-narration')).toBeTruthy();
    expect(mockNarrate).not.toHaveBeenCalled();
  });

  it('un clic llama una vez y bloquea duplicados mientras está en curso', async () => {
    let resolvePromise: (value: any) => void = () => {};
    const mockNarrate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
    );
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-1"
        disabled={false}
      />,
    );

    const btn = screen.getByTestId('request-resume-narration');
    fireEvent.click(btn);

    expect(mockNarrate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('resume-narration-loading')).toBeTruthy();

    // Clic duplicado mientras espera
    const loadingBtn = screen.getByTestId('resume-narration-loading');
    fireEvent.click(loadingBtn);
    expect(mockNarrate).toHaveBeenCalledTimes(1);

    // Resolver
    await act(async () => {
      resolvePromise({ success: true, data: sampleSuccessResult });
    });

    expect(screen.getByTestId('resume-narration-content')).toBeTruthy();
  });

  it('fallo mantiene la UI y emite el aviso en useGitStore.setError sin bloque de error permanente', async () => {
    const mockNarrate = vi.fn().mockResolvedValue({
      success: false,
      error: 'Proveedor LM Studio caído',
    });
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-1"
        disabled={false}
      />,
    );

    const btn = screen.getByTestId('request-resume-narration');
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(useGitStore.getState().error).toContain('Proveedor LM Studio caído');
    // Vuelve al botón original, sin caja de error permanente
    expect(screen.getByTestId('request-resume-narration')).toBeTruthy();
    expect(screen.queryByTestId('resume-narration-content')).toBeNull();
  });

  it('estado unavailable o stale emite el mensaje a useGitStore.setError', async () => {
    const mockNarrate = vi.fn().mockResolvedValue({
      success: true,
      data: {
        status: 'unavailable',
        message: 'No hay modelo configurado para gitcron-assist.',
      },
    });
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-1"
        disabled={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('request-resume-narration'));
    });

    expect(useGitStore.getState().error).toBe('No hay modelo configurado para gitcron-assist.');
  });

  it('éxito muestra explicación con IA, párrafos, fuentes y modelo real', async () => {
    const mockNarrate = vi.fn().mockResolvedValue({
      success: true,
      data: sampleSuccessResult,
    });
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-1"
        disabled={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('request-resume-narration'));
    });

    expect(screen.getByText('Explicación con IA')).toBeTruthy();
    expect(
      screen.getByText('Este cambio implementa la explicación opcional del resumen.'),
    ).toBeTruthy();
    expect(screen.getByText('openspec/changes/mi-cambio/proposal.md')).toBeTruthy();
    expect(screen.getByText('openspec/changes/mi-cambio/tasks.md')).toBeTruthy();
    expect(screen.getByTestId('narration-model').textContent).toContain('LM Studio · qwen-2.5-coder');
  });

  it('ocultar y reabrir no vuelve a enviar; volver a explicar sí envía', async () => {
    const mockNarrate = vi.fn().mockResolvedValue({
      success: true,
      data: sampleSuccessResult,
    });
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-1"
        disabled={false}
      />,
    );

    // 1. Envío inicial
    await act(async () => {
      fireEvent.click(screen.getByTestId('request-resume-narration'));
    });
    expect(mockNarrate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('resume-narration-content')).toBeTruthy();

    // 2. Ocultar explicación
    fireEvent.click(screen.getByTestId('hide-resume-narration'));
    expect(screen.queryByTestId('resume-narration-content')).toBeNull();
    expect(screen.getByTestId('show-resume-narration')).toBeTruthy();
    expect(mockNarrate).toHaveBeenCalledTimes(1);

    // 3. Mostrar explicación: recupera el texto sin otro envío
    fireEvent.click(screen.getByTestId('show-resume-narration'));
    expect(screen.getByTestId('resume-narration-content')).toBeTruthy();
    expect(mockNarrate).toHaveBeenCalledTimes(1);

    // 4. Volver a explicar: sí dispara otro envío
    await act(async () => {
      fireEvent.click(screen.getByTestId('reexplain-resume-narration'));
    });
    expect(mockNarrate).toHaveBeenCalledTimes(2);
  });

  it('respuesta tardía tras cambio de clave se descarta', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const mockNarrate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    const { rerender } = render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-A"
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByTestId('request-resume-narration'));
    expect(mockNarrate).toHaveBeenCalledTimes(1);

    // Cambio de fuentes o destino: nueva clave
    rerender(
      <ResumeNarration
        args={{ ...sampleArgs, changeId: 'otro-cambio' }}
        sourceKey="key-B"
        disabled={false}
      />,
    );

    // La petición anterior termina tarde
    await act(async () => {
      resolveFirst({ success: true, data: sampleSuccessResult });
    });

    // Como la clave actual es key-B, la respuesta vieja de key-A quedó descartada
    expect(screen.queryByTestId('resume-narration-content')).toBeNull();
    expect(screen.getByTestId('request-resume-narration')).toBeTruthy();
  });

  it('respuesta tardía tras ida y vuelta (A -> B -> A) sigue descartada', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const mockNarrate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    const { rerender } = render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-A"
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByTestId('request-resume-narration'));

    // Cambiar a B y luego volver a A
    rerender(
      <ResumeNarration
        args={{ ...sampleArgs, changeId: 'otro-cambio' }}
        sourceKey="key-B"
        disabled={false}
      />,
    );
    rerender(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-A"
        disabled={false}
      />,
    );

    // Llega la respuesta de la primera petición
    await act(async () => {
      resolveFirst({ success: true, data: sampleSuccessResult });
    });

    // La respuesta vieja sigue descartada por contador de pedido
    expect(screen.queryByTestId('resume-narration-content')).toBeNull();
    expect(screen.getByTestId('request-resume-narration')).toBeTruthy();
  });

  it('retira la explicación al quedar las fuentes pendientes y no la recupera sin otro clic', async () => {
    const mockNarrate = vi.fn().mockResolvedValue({ success: true, data: sampleSuccessResult });
    window.api!.assistConversations!.narrateResume = mockNarrate;
    const { rerender } = render(<ResumeNarration args={sampleArgs} sourceKey="same-key" disabled={false} />);
    await act(async () => { fireEvent.click(screen.getByTestId('request-resume-narration')); });
    expect(screen.getByTestId('resume-narration-content')).toBeTruthy();
    rerender(<ResumeNarration args={sampleArgs} sourceKey="same-key" disabled />);
    expect(screen.queryByTestId('resume-narration-content')).toBeNull();
    rerender(<ResumeNarration args={sampleArgs} sourceKey="same-key" disabled={false} />);
    expect(screen.queryByTestId('resume-narration-content')).toBeNull();
    expect(mockNarrate).toHaveBeenCalledTimes(1);
  });

  it('descarta el pedido si hubo una relectura pendiente aunque la clave no haya cambiado', async () => {
    let finish!: (value: { success: true; data: ResumeNarrationResult }) => void;
    const mockNarrate = vi.fn(() => new Promise<{ success: true; data: ResumeNarrationResult }>((resolve) => { finish = resolve; }));
    window.api!.assistConversations!.narrateResume = mockNarrate;
    const { rerender } = render(<ResumeNarration args={sampleArgs} sourceKey="same-key" disabled={false} />);
    fireEvent.click(screen.getByTestId('request-resume-narration'));
    rerender(<ResumeNarration args={sampleArgs} sourceKey="same-key" disabled />);
    rerender(<ResumeNarration args={sampleArgs} sourceKey="same-key" disabled={false} />);
    await act(async () => { finish({ success: true, data: sampleSuccessResult }); });
    expect(screen.queryByTestId('resume-narration-content')).toBeNull();
    expect(mockNarrate).toHaveBeenCalledTimes(1);
  });

  it('desmontar durante la petición no produce errores por respuesta tardía', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const mockNarrate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    (window as any).api.assistConversations.narrateResume = mockNarrate;

    const { unmount } = render(
      <ResumeNarration
        args={sampleArgs}
        sourceKey="key-A"
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByTestId('request-resume-narration'));

    unmount();

    await act(async () => {
      resolveFirst({ success: true, data: sampleSuccessResult });
    });
    // Si no hubo crash ni warning de setState en componente desmontado, pasa
  });
});
