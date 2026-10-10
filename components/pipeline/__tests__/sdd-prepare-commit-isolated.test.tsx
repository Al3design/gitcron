// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SddPrepareCommit, FileStatusBadge, usePrepareCommit } from '../sdd';
import { useGitStore } from '@/lib/git-store';
import { usePipelineStore } from '@/lib/pipeline-store';
import { renderHook } from '@testing-library/react';

vi.mock('@/hooks/use-translation', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock('../AiModelControls', () => ({
  AiModelControls: () => <div data-testid="mock-ai-model-controls" />,
}));

vi.mock('../ai/AiUseLine', () => ({
  AiUseLine: () => <div data-testid="mock-ai-use-line" />,
}));

vi.mock('../ai/AiSentDetails', () => ({
  AiSentDetails: () => <div data-testid="mock-ai-sent-details" />,
}));

vi.mock('../AiElapsed', () => ({
  AiElapsed: () => <div data-testid="mock-ai-elapsed" />,
}));

describe('SddPrepareCommit (Isolated)', () => {
  const repoPath = 'C:/test-repo';

  beforeEach(() => {
    useGitStore.setState({
      repoPath,
      language: 'es',
      commitMessage: '',
      openRepos: [{
        path: repoPath,
        name: 'test-repo',
        currentBranch: 'main',
      } as unknown as import('@/lib/git-store').RepoState],
      modifiedFiles: [
        { path: 'src/index.ts', status: 'modified', staged: false },
        { path: 'openspec/changes/feat/tasks.md', status: 'added', staged: false },
      ],
    });
    usePipelineStore.setState({
      prepareOpen: true,
      prepareOpenByRepo: { [repoPath]: true },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('usePrepareCommit inicializa correctamente el scope y los estados', () => {
    const { result } = renderHook(() => usePrepareCommit({ repoPath, currentBranch: 'main' }));
    expect(result.current.commitScope).toBeDefined();
    expect(result.current.commitScope.groups).toBeDefined();
  });

  it('se monta en aislamiento y muestra el título y la lista de archivos para preparar', () => {
    render(
      <SddPrepareCommit
        repoPath={repoPath}
        currentBranch="change/feat"
        rightOpen={false}
      />,
    );

    expect(screen.getByText('pipeline.openspec.prepare.title')).toBeTruthy();
    expect(screen.getByText('src/index.ts')).toBeTruthy();
    expect(screen.getByText('openspec/changes/feat/tasks.md')).toBeTruthy();
  });

  it('permite seleccionar y deseleccionar archivos', () => {
    render(
      <SddPrepareCommit
        repoPath={repoPath}
        currentBranch="change/feat"
        rightOpen={false}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);

    fireEvent.click(checkboxes[0]);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it('FileStatusBadge renderiza la etiqueta de estado traducida', () => {
    render(
      <FileStatusBadge
        path="src/index.ts"
        files={[{ path: 'src/index.ts', status: 'modified', staged: false }]}
      />,
    );
    expect(screen.getByText('pipeline.openspec.prepare.state.modified')).toBeTruthy();
  });

  it('cierra la preparación al pulsar Cerrar', () => {
    render(
      <SddPrepareCommit
        repoPath={repoPath}
        currentBranch="change/feat"
        rightOpen={false}
      />,
    );

    const closeBtn = screen.getByRole('button', { name: 'pipeline.openspec.prepare.close' });
    fireEvent.click(closeBtn);

    expect(usePipelineStore.getState().prepareOpenByRepo[repoPath]).toBe(false);
  });
});
