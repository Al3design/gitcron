// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useGitStore } from '@/lib/git-store';
import { ScreenCard } from '../ScreenCard';
import type { ScreenEntry } from '@/types/screen-map';

const entry: ScreenEntry = {
  id: 'view:graph',
  kind: 'view',
  name: 'Graph',
  locator: 'default',
  declaredIn: 'components/RepoMainView.tsx',
  files: [],
  description: null,
  tags: [],
  primaryTag: null,
  stats: { byRole: {}, lastChangedAt: null },
};

describe('ScreenCard mientras se saca su foto', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalIntersectionObserver = window.IntersectionObserver;

  beforeEach(() => {
    useGitStore.setState({ language: 'es' });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0) })),
      fillStyle: '#fff',
      globalAlpha: 1,
    }) as never;
    class FakeIntersectionObserver {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        cb([{ isIntersecting: true }]);
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    window.IntersectionObserver = FakeIntersectionObserver as never;
  });

  afterEach(() => {
    cleanup();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.IntersectionObserver = originalIntersectionObserver;
  });

  it('muestra el efecto de píxeles sobre la imagen solo mientras se captura', () => {
    const { rerender } = render(<ScreenCard screen={entry} repoPath="C:/r" capturing />);
    expect(screen.getByTestId('card-capturing-overlay')).toBeTruthy();

    rerender(<ScreenCard screen={entry} repoPath="C:/r" capturing={false} />);
    expect(screen.queryByTestId('card-capturing-overlay')).toBeNull();
  });
});
