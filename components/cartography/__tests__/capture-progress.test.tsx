// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { CaptureProgress } from '../CaptureProgress';
import type { CaptureItem } from '@/types/screen-map';
import { useGitStore } from '@/lib/git-store';

describe('CaptureProgress', () => {
  beforeEach(() => {
    useGitStore.setState({ language: 'es' });
  });

  afterEach(() => {
    cleanup();
  });

  const plan: CaptureItem[] = [
    { screenId: 'route:/a', name: 'A', via: 'route', state: 'pending' },
    { screenId: 'view:b', name: 'B', via: 'view', state: 'running' },
    { screenId: 'view:c', name: 'C', via: 'view', state: 'pending' },
  ];

  it('con un plan de tres y uno en curso, muestra la pantalla en curso y «1 de 3»', () => {
    render(<CaptureProgress items={plan} running />);

    expect(screen.getByTestId('capture-progress-text').textContent).toBe('Capturando “B”… 1 de 3');
  });

  it('«Ver detalle» despliega la lista con un ícono por estado y «Ocultar detalle» la pliega', () => {
    const items: CaptureItem[] = [
      { screenId: 'route:/a', name: 'A', via: 'route', state: 'done' },
      { screenId: 'view:b', name: 'B', via: 'view', state: 'running' },
      { screenId: 'view:c', name: 'C', via: 'view', state: 'pending' },
      { screenId: 'view:d', name: 'D', via: 'view', state: 'failed', detail: 'paso 1: no está' },
      { screenId: 'view:e', name: 'E', via: 'view', state: 'skipped', detail: 'sin receta' },
    ];
    render(<CaptureProgress items={items} running />);

    const toggle = screen.getByRole('button', { name: /Ver detalle/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('capture-progress-list')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByTestId('capture-progress-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(screen.getByTestId('capture-progress-item-route:/a')).getByRole('img', { name: 'Lista' })).toBeTruthy();
    expect(within(screen.getByTestId('capture-progress-item-view:b')).getByRole('img', { name: 'En curso' })).toBeTruthy();
    expect(within(screen.getByTestId('capture-progress-item-view:c')).getByRole('img', { name: 'Pendiente' })).toBeTruthy();
    const failedRow = screen.getByTestId('capture-progress-item-view:d');
    expect(within(failedRow).getByRole('img', { name: 'Falló' })).toBeTruthy();
    expect(within(failedRow).getByText('paso 1: no está')).toBeTruthy();
    expect(within(screen.getByTestId('capture-progress-item-view:e')).getByRole('img', { name: 'Sin receta' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Ocultar detalle/ }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('capture-progress-list')).toBeNull();
  });

  it('terminado con una falla, el resumen la cuenta y el círculo muestra el número', () => {
    const items: CaptureItem[] = [
      { screenId: 'route:/a', name: 'A', via: 'route', state: 'done' },
      { screenId: 'view:b', name: 'B', via: 'view', state: 'done' },
      { screenId: 'view:c', name: 'C', via: 'view', state: 'failed', detail: 'paso 2: no está' },
      { screenId: 'view:d', name: 'D', via: 'view', state: 'skipped', detail: 'sin receta' },
    ];
    render(<CaptureProgress items={items} running={false} />);

    expect(screen.getByTestId('capture-progress-text').textContent).toBe('2 listas · 1 falló · 1 sin receta');
    expect(screen.getByTestId('capture-progress-fail-count').textContent).toBe('1');
  });

  it('detenida no cuenta como falla: «1 lista · 2 detenidas»', () => {
    const items: CaptureItem[] = [
      { screenId: 'route:/a', name: 'A', via: 'route', state: 'done' },
      { screenId: 'view:b', name: 'B', via: 'view', state: 'stopped', detail: 'detenida antes de llegar' },
      { screenId: 'view:c', name: 'C', via: 'view', state: 'stopped', detail: 'detenida antes de llegar' },
    ];
    render(<CaptureProgress items={items} running={false} />);

    expect(screen.getByTestId('capture-progress-text').textContent).toBe('1 lista · 2 detenidas');
    expect(screen.queryByTestId('capture-progress-fail-count')).toBeNull();
  });
});
