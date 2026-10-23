// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PixelCard } from '../PixelCard';

describe('PixelCard', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalIntersectionObserver = window.IntersectionObserver;
  const originalMatchMedia = window.matchMedia;

  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '#fff',
      globalAlpha: 1,
    };
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);

    class FakeIntersectionObserver {
      callback: (entries: any[]) => void;
      constructor(callback: (entries: any[]) => void) {
        this.callback = callback;
        // Notificar visibilidad de inmediato
        this.callback([{ isIntersecting: true }]);
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    window.IntersectionObserver = FakeIntersectionObserver as any;
  });

  afterEach(() => {
    cleanup();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.IntersectionObserver = originalIntersectionObserver;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('dibuja un canvas y muestra los hijos', () => {
    const { container } = render(
      <PixelCard data-testid="pixel-card-root">
        <span data-testid="child-content">Hola Píxeles</span>
      </PixelCard>
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');

    const child = screen.getByTestId('child-content');
    expect(child).toBeTruthy();
    expect(child.textContent).toBe('Hola Píxeles');
  });

  it('con matchMedia("(prefers-reduced-motion: reduce)") en true no pide cuadros de animación (requestAnimationFrame) al pasar el mouse', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
      if (query.includes('prefers-reduced-motion')) {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        };
      }
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    });

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

    render(
      <PixelCard data-testid="pixel-card-reduced">
        <span>Contenido</span>
      </PixelCard>
    );

    const root = screen.getByTestId('pixel-card-reduced');

    // Limpiar llamadas de montaje si hubiese
    rafSpy.mockClear();

    // Pasar el mouse por encima
    fireEvent.pointerEnter(root, { clientX: 100, clientY: 50, pointerType: 'mouse' });

    // No debe solicitar requestAnimationFrame
    expect(rafSpy).not.toHaveBeenCalled();
  });
});
