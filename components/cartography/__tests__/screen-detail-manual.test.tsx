// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { ScreenDetail } from '../ScreenDetail';
import type { ScreenEntry } from '@/types/screen-map';
import { useGitStore } from '@/lib/git-store';

describe('ScreenDetail - correcciones a mano', () => {
  const baseScreen: ScreenEntry = {
    id: 'view:settings',
    kind: 'view',
    name: 'Configuración',
    locator: 'activeView=settings',
    declaredIn: 'components/RepoMainView.tsx',
    description: null,
    tags: [],
    primaryTag: null,
    stats: { byRole: { screen: 2 }, lastChangedAt: '2026-10-20T12:00:00Z' },
    removedByHand: [],
    files: [
      {
        path: 'components/Settings.tsx',
        role: 'screen',
        provenance: 'static',
        shared: false,
      },
      {
        path: 'lib/custom-manual.ts',
        role: 'screen',
        provenance: 'manual',
        shared: false,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useGitStore.setState({
      language: 'es',
      error: null,
      modifiedFiles: [],
    });
    // Mock window.api
    (window as any).api = {
      cartoScreens: {
        describe: vi.fn().mockResolvedValue({ success: false }),
        files: vi.fn().mockResolvedValue({ success: true, data: ['components/Settings.tsx', 'lib/custom-manual.ts'] }),
      },
      shellOpenItem: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('«Escribir» -> guardar llama a onManual con describe', () => {
    const onManual = vi.fn();
    render(
      <ScreenDetail
        screen={baseScreen}
        repoPath="/mock/repo"
        onClose={vi.fn()}
        onManual={onManual}
      />,
    );

    const writeBtn = screen.getByRole('button', { name: /Escribir/i });
    fireEvent.click(writeBtn);

    const textarea = screen.getByRole('textbox', { name: /Qué hace/i });
    fireEvent.change(textarea, { target: { value: 'Descripción escrita a mano para pruebas' } });

    const nameInput = screen.getByPlaceholderText(/Nombre/i);
    fireEvent.change(nameInput, { target: { value: 'Ajustes' } });

    const saveBtn = screen.getByRole('button', { name: 'Guardar' });
    fireEvent.click(saveBtn);

    expect(onManual).toHaveBeenCalledWith({
      type: 'describe',
      screenId: 'view:settings',
      text: 'Descripción escrita a mano para pruebas',
      name: 'Ajustes',
    });
  });

  it('«Quitar de esta pantalla» manda link remove o unlink según la procedencia', () => {
    const onManual = vi.fn();
    render(
      <ScreenDetail
        screen={baseScreen}
        repoPath="/mock/repo"
        onClose={vi.fn()}
        onManual={onManual}
      />,
    );

    // 1. Archivo con procedencia static -> manda link remove
    const removeStaticBtn = screen.getByTestId('file-remove-components/Settings.tsx');
    fireEvent.click(removeStaticBtn);
    expect(onManual).toHaveBeenCalledWith({
      type: 'link',
      screenId: 'view:settings',
      path: 'components/Settings.tsx',
      action: 'remove',
    });

    onManual.mockClear();

    // 2. Archivo con procedencia manual -> manda unlink
    const removeManualBtn = screen.getByTestId('file-remove-lib/custom-manual.ts');
    fireEvent.click(removeManualBtn);
    expect(onManual).toHaveBeenCalledWith({
      type: 'unlink',
      screenId: 'view:settings',
      path: 'lib/custom-manual.ts',
    });
  });

  it('«Quitados a mano» se despliega y «Devolver» manda unlink', () => {
    const onManual = vi.fn();
    const screenWithRemoved: ScreenEntry = {
      ...baseScreen,
      removedByHand: ['components/OldHeader.tsx'],
    };

    render(
      <ScreenDetail
        screen={screenWithRemoved}
        repoPath="/mock/repo"
        onClose={vi.fn()}
        onManual={onManual}
      />,
    );

    const toggleBtn = screen.getByTestId('removed-by-hand-toggle');
    expect(toggleBtn).toBeDefined();
    expect(screen.queryByTestId('restore-components/OldHeader.tsx')).toBeNull();

    // Desplegar
    fireEvent.click(toggleBtn);
    const restoreBtn = screen.getByTestId('restore-components/OldHeader.tsx');
    expect(restoreBtn).toBeDefined();

    // Clic en Devolver
    fireEvent.click(restoreBtn);
    expect(onManual).toHaveBeenCalledWith({
      type: 'unlink',
      screenId: 'view:settings',
      path: 'components/OldHeader.tsx',
    });
  });

  it('el aviso de pendientes ofrece «Borrar»', () => {
    const onManual = vi.fn();
    const pending = [
      {
        kind: 'link' as const,
        screenId: 'view:settings',
        path: 'lib/deleted-file.ts',
        reason: 'file-missing' as const,
      },
    ];

    render(
      <ScreenDetail
        screen={baseScreen}
        repoPath="/mock/repo"
        pending={pending}
        onClose={vi.fn()}
        onManual={onManual}
      />,
    );

    expect(screen.getByTestId('screen-pending-notice')).toBeDefined();
    expect(screen.getByText(/El archivo lib\/deleted-file\.ts ya no existe en el proyecto/i)).toBeDefined();

    const deleteBtn = screen.getByRole('button', { name: 'Borrar' });
    fireEvent.click(deleteBtn);

    expect(onManual).toHaveBeenCalledWith({
      type: 'unlink',
      screenId: 'view:settings',
      path: 'lib/deleted-file.ts',
    });
  });
});
