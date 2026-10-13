// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { compareFreshness, stampSources } from '../resume-freshness';
import { WhereYouLeftOffCard } from '../WhereYouLeftOffCard';
import type { OpenSpecChangeSummary } from '../pipeline-view-state';

const CHANGE = {
  changeId: 'retomar',
  intent: 'Objetivo de prueba.',
  tasks: [],
  proposalExists: true,
  designExists: false,
  specsCount: 0,
  validation: 'passed',
  artifacts: { proposal: '# Retomar\n\n## Why\n\nObjetivo de prueba.\n', design: null, tasks: '', specs: [] },
  lastCommit: null,
} as unknown as OpenSpecChangeSummary;

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

function setRepo(head: string, modified: string[]) {
  useGitStore.setState({
    language: 'es',
    currentBranch: 'main',
    commits: [{ hash: head, shortHash: head.slice(0, 7), message: 'x', authorName: 'a', authorEmail: 'a', date: '2026-10-13', parents: [], refs: ['HEAD'] }],
    modifiedFiles: modified.map((path) => ({ path, status: 'modified', staged: false })),
  } as never);
}

describe('resume-freshness', () => {
  beforeEach(() => {
    setRepo(HEAD_A, []);
    usePipelineStore.setState({ snapshot: { openSpec: { observedAt: '2026-10-13T12:00:00.000Z' } } } as never);
  });
  afterEach(() => cleanup());

  it('stampSources toma sólo los archivos del cambio, ordenados', () => {
    const stamp = stampSources(
      '2026-10-13T12:00:00.000Z',
      HEAD_A,
      ['src/x.ts', 'openspec\\changes\\retomar\\tasks.md', 'openspec/changes/retomar/design.md', 'openspec/changes/otro/tasks.md'],
      'retomar',
    );
    expect(stamp.changeFiles).toEqual(['openspec/changes/retomar/design.md', 'openspec/changes/retomar/tasks.md']);
    expect(stamp.headSha).toBe(HEAD_A);
  });

  it('sin lectura previa está al día', () => {
    expect(compareFreshness(null, stampSources(null, HEAD_A, [], 'retomar'))).toEqual({ state: 'fresh' });
  });

  it('cambio de HEAD → pendiente por checkout', () => {
    const before = stampSources('x', HEAD_A, [], 'retomar');
    const now = stampSources('x', HEAD_B, [], 'retomar');
    expect(compareFreshness(before, now)).toEqual({ state: 'pending', reason: 'checkout' });
  });

  it('archivos del cambio editados → pendiente por fuentes', () => {
    const before = stampSources('x', HEAD_A, [], 'retomar');
    const now = stampSources('x', HEAD_A, ['openspec/changes/retomar/tasks.md'], 'retomar');
    expect(compareFreshness(before, now)).toEqual({ state: 'pending', reason: 'sources' });
  });

  it('archivos de otro cambio no cuentan', () => {
    const before = stampSources('x', HEAD_A, [], 'retomar');
    const now = stampSources('x', HEAD_A, ['openspec/changes/otro/tasks.md', 'lib/a.ts'], 'retomar');
    expect(compareFreshness(before, now)).toEqual({ state: 'fresh' });
  });

  it('la tarjeta muestra «Leído …» y ningún aviso al montar', () => {
    render(<WhereYouLeftOffCard repoPath="/r" selectedChange={CHANGE} />);
    expect(screen.getByTestId('resume-read-at').textContent).toMatch(/^Leído /);
    expect(screen.queryByTestId('resume-pending')).toBeNull();
  });

  it('la tarjeta avisa al cambiar de rama y deja de avisar cuando llega la relectura', () => {
    render(<WhereYouLeftOffCard repoPath="/r" selectedChange={CHANGE} />);
    act(() => setRepo(HEAD_B, []));
    expect(screen.getByTestId('resume-pending').textContent).toMatch(/Pendiente de relectura/);
    expect(screen.getByTestId('where-you-left-off-card').getAttribute('data-stale')).toBe('true');
    act(() => usePipelineStore.setState({ snapshot: { openSpec: { observedAt: '2026-10-13T12:05:00.000Z' } } } as never));
    expect(screen.queryByTestId('resume-pending')).toBeNull();
  });
});
