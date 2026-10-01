// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenSpecToolList } from '../OpenSpecReadiness';

/**
 * Lo que le falta al repositorio para que el método funcione.
 *
 * El estado que esto existe para mostrar convive con un repositorio
 * correctamente inicializado: una herramienta presente sin sus skills. Su
 * ejecutor no sabe que el canal de instrucciones existe, así que trabaja sin el
 * método y sin avisar. Pasó con Antigravity en `odontoPau`.
 */

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

afterEach(cleanup);

const tool = (toolId: string, configured: boolean) => ({
  toolId,
  label: toolId,
  directory: `.${toolId}`,
  configured,
});

describe('detalle de herramientas en el rail', () => {
  it('lista las configuradas junto a las que faltan', () => {
    // El contraste es lo que hace legible lo que falta, y sin las que están bien
    // el rail estaría vacío casi siempre.
    render(<OpenSpecToolList present tools={[tool('codex', true), tool('antigravity', false)]} />);

    expect(screen.getByText('codex')).toBeTruthy();
    expect(screen.getByText('antigravity')).toBeTruthy();
    expect(screen.getByText(/readiness\.configured/)).toBeTruthy();
    expect(screen.getByText(/engine\.pendingTool:/)).toBeTruthy();
  });

  it('con todo en orden sigue mostrando la lista', () => {
    // A diferencia del aviso, la referencia no desaparece: se consulta.
    render(<OpenSpecToolList present tools={[tool('codex', true)]} />);
    expect(screen.getByText('codex')).toBeTruthy();
  });

  it('herramienta con configuredVia shared-folder muestra configuredViaSharedFolder y no pendingTool', () => {
    render(
      <OpenSpecToolList
        present
        tools={[{ toolId: 'codex', label: 'Codex', directory: '.agents', configured: true, configuredVia: 'shared-folder' }]}
      />,
    );

    expect(screen.getByText('Codex')).toBeTruthy();
    expect(screen.getByText(/readiness\.configuredViaSharedFolder/)).toBeTruthy();
    expect(screen.queryByText(/engine\.pendingTool:/)).toBeNull();
  });

  it('sin OpenSpec lo declara en vez de listar nada', () => {
    render(<OpenSpecToolList present={false} tools={[]} />);
    expect(screen.getByText(/readiness\.missingTitle/)).toBeTruthy();
  });

  it('sin herramientas reconocidas lo dice, en vez de quedar en blanco', () => {
    render(<OpenSpecToolList present tools={[]} />);
    expect(screen.getByText(/rail\.noTools/)).toBeTruthy();
  });

  it('ofrece inicializar cuando el repositorio no está inicializado, declarando qué escribe', () => {
    render(<OpenSpecToolList present={false} tools={[tool('antigravity', false)]} onInitialize={() => undefined} />);

    expect(screen.getByRole('button', { name: /rail\.init/ })).toBeTruthy();
    // Qué se va a escribir, antes de escribirlo.
    expect(screen.getByText(/rail\.initWrites/)).toBeTruthy();
  });

  it('con repo inicializado y herramientas pendientes no ofrece inicializar en AGENTES (6.9)', () => {
    render(<OpenSpecToolList present tools={[tool('antigravity', false)]} onInitialize={() => undefined} />);
    expect(screen.queryByRole('button', { name: /rail\.init/ })).toBeNull();
  });

  it('con todo configurado no ofrece inicializar', () => {
    render(<OpenSpecToolList present tools={[tool('codex', true)]} onInitialize={() => undefined} />);
    expect(screen.queryByRole('button', { name: /rail\.init/ })).toBeNull();
  });

  it('sin OpenSpec sí lo ofrece', () => {
    render(<OpenSpecToolList present={false} tools={[]} onInitialize={() => undefined} />);
    expect(screen.getByRole('button', { name: /rail\.init/ })).toBeTruthy();
  });

  it('muestra el motivo real de un fallo, sin normalizarlo', () => {
    render(<OpenSpecToolList present tools={[tool('antigravity', false)]} error="No tools detected" />);
    expect(screen.getByRole('alert').textContent).toContain('No tools detected');
  });

  it('pide elegir herramienta cuando el CLI no detectó ninguna', () => {
    // No es un fallo: es el único caso en que `openspec init` exige `--tools`.
    render(<OpenSpecToolList present={false} tools={[]} needsTool onInitialize={() => undefined} onInitializeWith={() => undefined} />);

    expect(screen.getByText(/rail\.chooseToolHelp/)).toBeTruthy();
    // Nada preseleccionado: esto escribe en el repositorio.
    expect(screen.getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect((screen.getByRole('button', { name: /rail\.chooseToolConfirm/ }) as HTMLButtonElement).disabled)
      .toBe(true);
    // El botón que detecta no se ofrece: ya se sabe que volvería a fallar igual.
    expect(screen.queryByRole('button', { name: /rail\.init$/ })).toBeNull();
  });

  it('inicializa con varias herramientas a la vez', () => {
    // El CLI las toma juntas —`--tools a,b`— y un repositorio trabajado con dos
    // ejecutores las necesita a las dos.
    const chosen = vi.fn();
    render(<OpenSpecToolList present={false} tools={[]} needsTool onInitializeWith={chosen} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Antigravity/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Claude Code/ }));
    fireEvent.click(screen.getByRole('button', { name: /rail\.chooseToolConfirm/ }));

    expect(chosen).toHaveBeenCalledWith(['antigravity', 'claude']);
  });

  it('desmarcar quita la herramienta de la elección', () => {
    const chosen = vi.fn();
    render(<OpenSpecToolList present={false} tools={[]} needsTool onInitializeWith={chosen} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Codex/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Cursor/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Codex/ }));
    fireEvent.click(screen.getByRole('button', { name: /rail\.chooseToolConfirm/ }));

    expect(chosen).toHaveBeenCalledWith(['cursor']);
  });

  it('mientras inicializa no se puede volver a pedir', () => {
    render(<OpenSpecToolList present={false} tools={[tool('antigravity', false)]} busy onInitialize={() => undefined} />);
    expect((screen.getByRole('button', { name: /rail\.initBusy/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('las herramientas pendientes muestran «Falta configurar» en su fila, sin botón configurar ni actualizar en AGENTES (6.9)', () => {
    render(<OpenSpecToolList present tools={[tool('antigravity', false)]} onInitialize={() => undefined} />);
    expect(screen.getByText('antigravity')).toBeTruthy();
    expect(screen.getByText(/engine\.pendingTool:/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /engine\.configureAction/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /update/i })).toBeNull();
  });
});
