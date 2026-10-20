// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ScreenDetail } from '../ScreenDetail';
import type { ScreenEntry } from '@/types/screen-map';
import { useGitStore } from '@/lib/git-store';

describe('ScreenDetail - acciones de archivos y procedencia', () => {
  const mockScreen: ScreenEntry = {
    id: 'view:carto',
    kind: 'view',
    name: 'Cartografía',
    locator: 'activeTab=carto',
    declaredIn: 'components/RepoMainView.tsx',
    description: null,
    tags: [],
    primaryTag: null,
    stats: { byRole: { screen: 3 }, lastChangedAt: '2026-10-20T12:00:00Z' },
    files: [
      {
        path: 'app/page.tsx',
        role: 'screen',
        provenance: 'static',
        shared: false,
      },
      {
        path: 'components/Button.tsx',
        role: 'screen',
        provenance: 'inferred',
        shared: true,
      },
      {
        path: 'lib/custom.ts',
        role: 'screen',
        provenance: 'manual',
        shared: false,
      },
    ],
  };

  const sampleDiff = `diff --git a/components/Button.tsx b/components/Button.tsx
index 1111111..2222222 100644
--- a/components/Button.tsx
+++ b/components/Button.tsx
@@ -1,2 +1,2 @@
-old code
+new code
`;

  beforeEach(() => {
    vi.clearAllMocks();
    useGitStore.setState({
      language: 'es',
      error: null,
      modifiedFiles: [
        { path: 'components/Button.tsx', status: 'modified', staged: false },
      ],
    });

    window.api = {
      ...(window.api || {}),
      gitDiff: vi.fn().mockResolvedValue({
        success: true,
        data: sampleDiff,
      }),
      shellOpenItem: vi.fn().mockResolvedValue({
        success: true,
      }),
      cartoScreens: {
        describe: vi.fn().mockResolvedValue({ success: true, data: null }),
      },
    } as unknown as typeof window.api;
  });

  afterEach(() => {
    cleanup();
  });

  it('«Ver cambios» aparece solo en el archivo modificado; al tocarlo pide gitDiff y muestra el visor; al tocarlo otra vez lo cierra', async () => {
    render(
      <ScreenDetail
        screen={mockScreen}
        repoPath="/test/repo"
        onClose={vi.fn()}
      />,
    );

    // app/page.tsx no está en modifiedFiles -> sin botón de diff
    expect(screen.queryByTestId('file-diff-app/page.tsx')).toBeNull();

    // components/Button.tsx sí está modificado -> botón presente
    const diffBtn = screen.getByTestId('file-diff-components/Button.tsx');
    expect(diffBtn).toBeTruthy();
    expect(diffBtn.getAttribute('aria-pressed')).toBe('false');

    // Tocar «Ver cambios» pide gitDiff y despliega el visor
    fireEvent.click(diffBtn);
    expect(window.api.gitDiff).toHaveBeenCalledWith('/test/repo', 'components/Button.tsx');

    await waitFor(() => {
      expect(screen.getByTestId('screen-detail-diff-container')).toBeTruthy();
    });
    expect(diffBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Cambios en Button.tsx')).toBeTruthy();

    // Tocar otra vez «Ver cambios» cierra el visor
    fireEvent.click(diffBtn);
    expect(screen.queryByTestId('screen-detail-diff-container')).toBeNull();
    expect(diffBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('«Abrir» llama a shellOpenItem; si falla, setError recibe el texto', async () => {
    render(
      <ScreenDetail
        screen={mockScreen}
        repoPath="/test/repo"
        onClose={vi.fn()}
      />,
    );

    const openBtn = screen.getByTestId('file-open-app/page.tsx');
    expect(openBtn).toBeTruthy();

    // Llamada exitosa
    fireEvent.click(openBtn);
    expect(window.api.shellOpenItem).toHaveBeenCalledWith('/test/repo', 'app/page.tsx');
    expect(useGitStore.getState().error).toBeNull();

    // Llamada con fallo
    (window.api.shellOpenItem as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: 'Archivo no encontrado',
    });

    fireEvent.click(openBtn);
    await waitFor(() => {
      expect(useGitStore.getState().error).toContain('Archivo no encontrado');
    });
  });

  it('«Preguntar a la IA» llama a onAskFile con la ruta', () => {
    const onAskFile = vi.fn();
    render(
      <ScreenDetail
        screen={mockScreen}
        repoPath="/test/repo"
        onClose={vi.fn()}
        onAskFile={onAskFile}
      />,
    );

    const askBtn = screen.getByTestId('file-ask-app/page.tsx');
    expect(askBtn).toBeTruthy();

    fireEvent.click(askBtn);
    expect(onAskFile).toHaveBeenCalledWith('app/page.tsx');
  });

  it('cada fila muestra su procedencia en palabras', () => {
    render(
      <ScreenDetail
        screen={mockScreen}
        repoPath="/test/repo"
        onClose={vi.fn()}
      />,
    );

    // static -> 'leído en el código'
    const staticItem = screen.getByTestId('file-provenance-app/page.tsx');
    expect(staticItem.textContent).toBe('leído en el código');

    // inferred -> 'deducido'
    const inferredItem = screen.getByTestId('file-provenance-components/Button.tsx');
    expect(inferredItem.textContent).toBe('deducido');

    // manual -> 'puesto a mano'
    const manualItem = screen.getByTestId('file-provenance-lib/custom.ts');
    expect(manualItem.textContent).toBe('puesto a mano');
  });
});
