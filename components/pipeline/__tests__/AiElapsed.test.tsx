// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiElapsed } from '../AiElapsed';

/**
 * El indicador de carga del modelo.
 *
 * Lo que se protege acá no es la animación —eso es CSS y el ojo—, sino lo que el
 * componente **afirma**: que durante la carga hay un `progressbar` indeterminado
 * **sin** `aria-valuenow` (el servidor no expone la fracción; un porcentaje
 * colgado miente a un lector de pantalla), y que durante la redacción no hay
 * barra —el vivo llega al rail—. Cambiar la forma del feedback sin tocar estas
 * aserciones es lo que se busca: el efecto puede evolucionar, la honestidad no.
 */

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

afterEach(() => cleanup());

describe('AiElapsed', () => {
  it('no renderiza nada en idle', () => {
    const { container } = render(<AiElapsed phase="idle" startedAt={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('durante la carga muestra un progressbar indeterminado con el contador, y sin aria-valuenow', () => {
    render(<AiElapsed phase="loading" startedAt={Date.now() - 3_000} />);
    const bar = document.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-busy')).toBe('true');
    // Indeterminado a propósito: el servidor no emite la fracción de carga.
    // Un valor colgado aquí es el mismo defecto que el change corrige, en otro canal.
    expect(bar?.getAttribute('aria-valuenow')).toBeNull();
    expect(bar?.getAttribute('aria-valuemin')).toBeNull();
    expect(bar?.getAttribute('aria-valuemax')).toBeNull();
    // El contador viaja dentro del cuadro; el texto usa la clave de carga.
    expect(bar?.textContent ?? '').toContain('aiElapsedLoading');
  });

  it('durante la redacción muestra el contador y NO hay progressbar', () => {
    const { container } = render(<AiElapsed phase="drafting" startedAt={Date.now()} />);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent ?? '').toContain('aiElapsedDrafting');
  });

  it('durante la redacción el contador lleva ai-thinking-text, y en carga no (D20)', () => {
    const { container: draftingContainer } = render(<AiElapsed phase="drafting" startedAt={Date.now()} />);
    // El brillo va en un span propio, sin otra clase: puesto sobre el <em>, que
    // tiene su color, uno de los dos pisaba al otro.
    const brillo = draftingContainer.querySelector('em > span.ai-thinking-text');
    expect(brillo?.className).toBe('ai-thinking-text');

    const { container: loadingContainer } = render(<AiElapsed phase="loading" startedAt={Date.now()} />);
    expect(loadingContainer.querySelector('.ai-thinking-text')).toBeNull();
  });
});
