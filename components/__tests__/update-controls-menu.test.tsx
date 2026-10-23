// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateControls, updateMenuPosition } from '../UpdateControls';
import { useAppUpdate } from '@/hooks/use-app-update';

/**
 * El desplegable de la versión, abajo a la izquierda del sidebar.
 *
 * Lo que se protege: que no lo recorte el pie del sidebar (se dibuja suelto,
 * encima de todo), que no se salga de la ventana, y que tocarlo no lo cierre.
 */

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

function Pie() {
  const u = useAppUpdate();
  return (
    <div data-testid="pie" style={{ overflow: 'hidden' }}>
      <UpdateControls
        updateStatus={u.updateStatus}
        updateInfo={u.updateInfo}
        downloadProgress={u.downloadProgress}
        showUpdateMenu={u.showUpdateMenu}
        setShowUpdateMenu={u.setShowUpdateMenu}
        updateMenuRef={u.updateMenuRef}
        onCheckForUpdate={u.handleCheckForUpdate}
        onDownloadUpdate={u.handleDownloadUpdate}
        onInstallUpdate={u.handleInstallUpdate}
      />
      <p>grafo</p>
    </div>
  );
}

function abrir() {
  render(<Pie />);
  fireEvent.click(screen.getByTitle('settings.version'));
  return screen.getByText('update.currentTitle').closest('[data-update-menu]') as HTMLElement;
}

describe('el desplegable de actualización', () => {
  it('se dibuja fuera del pie del sidebar, así no lo recorta', () => {
    const menu = abrir();
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByTestId('pie').contains(menu)).toBe(false);
  });

  it('tocar adentro no lo cierra; tocar afuera sí', async () => {
    abrir();
    fireEvent.mouseDown(screen.getByText('update.currentDesc'));
    expect(screen.queryByText('update.currentTitle')).toBeTruthy();

    // Se va con la animación de salida.
    fireEvent.mouseDown(screen.getByText('grafo'));
    await waitFor(() => expect(screen.queryByText('update.currentTitle')).toBeNull());
  });
});

describe('dónde aparece', () => {
  const ventana = { width: 1200, height: 800 };

  it('arriba del botón y alineado a su izquierda', () => {
    expect(updateMenuPosition({ left: 100, top: 760 }, ventana)).toEqual({ left: 100, bottom: 48 });
  });

  it('no se sale por la derecha ni por la izquierda de la ventana', () => {
    expect(updateMenuPosition({ left: 1100, top: 760 }, ventana).left).toBe(1200 - 256 - 8);
    expect(updateMenuPosition({ left: -20, top: 760 }, ventana).left).toBe(8);
  });
});
